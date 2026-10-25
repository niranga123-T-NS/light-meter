import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import type { Attachment } from '@/lib/types';
import { useMe } from '@/lib/auth';
import type { ExecMember, ExecProject } from '@/lib/execution';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { conditionLabel, SCRAP_METHOD, SCRAP_SOURCE, SCRAP_STATUS, type ScrapDisposal, type ScrapLine, type ScrapQuote } from '@/lib/scrap';
import { rpc, supabase } from '@/lib/supabase';

/** One scrap disposal: items, photos, quotations, the SM Projects → DGM approval, and the record of the disposal. */
export default function ScrapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [photos, setPhotos] = useState<Attachment[] | null>(null);
  const [quoteDocs, setQuoteDocs] = useState<Record<string, number>>({});
  const { data, error, reload } = useLoad(async () => {
    const { data: d, error: e } = await supabase.from('scrap_disposals').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const sd = d as ScrapDisposal;
    const [l, q, p, m] = await Promise.all([
      supabase.from('scrap_lines').select('*').eq('disposal_id', id).order('seq'),
      supabase.from('scrap_quotes').select('*').eq('disposal_id', id).order('amount_lkr', { ascending: false }),
      sd.exec_project_id ? supabase.from('exec_projects').select('id, code, name').eq('id', sd.exec_project_id).maybeSingle() : Promise.resolve({ data: null }),
      sd.exec_project_id ? supabase.from('exec_members').select('*').eq('exec_project_id', sd.exec_project_id).eq('active', true) : Promise.resolve({ data: [] }),
    ]);
    return {
      d: sd,
      lines: (l.data ?? []) as ScrapLine[],
      quotes: (q.data ?? []) as ScrapQuote[],
      project: p.data as Pick<ExecProject, 'id' | 'code' | 'name'> | null,
      members: (m.data ?? []) as ExecMember[],
    };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { d, lines, quotes, project, members } = data;
  const st = SCRAP_STATUS[d.status];
  const isAe = me.role === 'assistant_engineer' && members.some((x) => x.user_id === me.id && x.member_role === 'assistant_engineer');
  const canEdit = ['draft', 'returned'].includes(d.status) && (d.requested_by === me.id || me.role === 'senior_elec_engineer' || isAe);
  const canDecide = (d.status === 'pending_smp' && me.role === 'sm_projects') || (d.status === 'pending_dgm' && me.role === 'gm');
  const canRecord = d.status === 'approved' && (d.requested_by === me.id || me.role === 'senior_elec_engineer' || isAe);
  const canCancel = ['draft', 'returned', 'pending_smp', 'pending_dgm', 'approved'].includes(d.status) && (d.requested_by === me.id || me.role === 'senior_elec_engineer');
  const best = quotes.reduce((m, q) => Math.max(m, Number(q.amount_lkr)), 0);
  const chosen = quotes.find((q) => q.id === d.selected_quote_id);
  const pn = (u: string | null) => (u ? (people[u]?.full_name ?? '') : '');
  const missing = [
    !photos?.some((f) => f.kind === 'scrap_photo') ? 'a photo of the scrap' : null,
    d.method === 'foc' && !d.foc_to ? 'who takes it' : null,
    d.method === 'foc' && !d.foc_reason ? 'the reason for free of charge' : null,
    d.method === 'sell' && !quotes.length ? 'the quotations' : null,
    d.method === 'sell' && quotes.some((q) => !quoteDocs[q.id]) ? 'the quotation document for every quotation' : null,
  ].filter(Boolean) as string[];

  const addQuote = async () => {
    const r = await dialog.prompt({
      title: 'Add a quotation',
      fields: [
        { key: 'buyer', label: 'Buyer', required: true },
        { key: 'amount', label: 'Amount offered (LKR)', required: true },
        { key: 'valid', label: 'Valid until', type: 'date' },
        { key: 'note', label: 'Note (collection, payment terms …)', type: 'multiline' },
      ],
      confirmLabel: 'Add',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('add_scrap_quote', { p_id: d.id, p: { buyer: r.buyer, amount_lkr: Number(r.amount.replace(/,/g, '')), valid_until: r.valid || null, note: r.note || null } });
        await reload();
      }, 'Quotation added – attach the quotation document');
  };
  const submit = async () => {
    let quote: string | null = null;
    let reason: string | null = null;
    if (d.method === 'sell') {
      const r = await dialog.prompt({
        title: 'Submit to SM Projects',
        message: 'Choose the quotation to accept. A quotation that is not the highest needs the reason.',
        fields: [
          {
            key: 'q',
            label: 'Accept',
            type: 'select',
            required: true,
            initial: quotes.find((q) => Number(q.amount_lkr) === best)?.id,
            options: quotes.map((q) => ({ value: q.id, label: `${q.buyer} – ${fmtMoney(q.amount_lkr, 'LKR')}${Number(q.amount_lkr) === best ? ' (highest)' : ''}` })),
          },
          { key: 'reason', label: 'Reason (if not the highest)', type: 'multiline' },
        ],
        confirmLabel: 'Submit',
      });
      if (!r) return;
      quote = r.q;
      reason = r.reason || null;
    } else if (!(await dialog.confirm('Submit to SM Projects', `${d.code} – free of charge to ${d.foc_to}. SM Projects and then the DGM approve it.`, { confirmLabel: 'Submit' }))) return;
    await dialog.run(async () => {
      await rpc('submit_scrap_disposal', { p_id: d.id, p_quote: quote, p_reason: reason });
      await reload();
    }, 'Submitted to SM Projects');
  };
  const decide = async (action: 'approve' | 'return' | 'reject') => {
    const r = await dialog.prompt({
      title: action === 'approve' ? (d.status === 'pending_smp' ? 'Approve – send to the DGM' : 'Approve the disposal') : action === 'return' ? 'Return for changes' : 'Reject',
      fields: [{ key: 'n', label: action === 'approve' ? 'Note' : 'Reason', type: 'multiline', required: action !== 'approve' }],
      confirmLabel: action === 'approve' ? 'Approve' : action === 'return' ? 'Return' : 'Reject',
      danger: action !== 'approve',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('decide_scrap_disposal', { p_id: d.id, p_action: action, p_note: r.n || null });
        await reload();
      }, action === 'approve' ? 'Approved' : action === 'return' ? 'Returned' : 'Rejected');
  };
  const record = async () => {
    const r = await dialog.prompt({
      title: 'Record the disposal',
      message: 'Attach the evidence first (gate pass, receipt or photo). Site-store and Project-returns items are booked out.',
      fields: [
        { key: 'date', label: 'Disposed on', type: 'date', required: true, initial: todayISO() },
        { key: 'ref', label: d.method === 'sell' ? 'Receipt / invoice reference' : 'Gate pass / reference', required: d.method === 'sell' },
        ...(d.method === 'sell'
          ? [{ key: 'amount', label: 'Amount received (LKR)', required: true, initial: chosen ? String(chosen.amount_lkr) : '' }]
          : []),
        { key: 'note', label: 'Note', type: 'multiline' as const },
      ],
      confirmLabel: 'Record',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('record_scrap_disposal', { p_id: d.id, p: { date: r.date, ref: r.ref || null, amount: r.amount ? Number(r.amount.replace(/,/g, '')) : null, note: r.note || null } });
        await reload();
      }, 'Disposal recorded');
  };
  const cancel = async () => {
    const r = await dialog.prompt({ title: `Cancel ${d.code}?`, fields: [{ key: 'n', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Cancel the request', danger: true });
    if (r)
      await dialog.run(async () => {
        await rpc('cancel_scrap_disposal', { p_id: d.id, p_reason: r.n });
        await reload();
      }, 'Cancelled');
  };

  return (
    <Screen maxWidth={1000} onRefresh={reload}>
      <Stack.Screen options={{ title: d.code }} />
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink, flex: 1 }}>{`Scrap disposal ${d.code}`}</Text>
        <Pill label={st.label} tone={st.tone} solid />
      </Row>
      {d.status === 'returned' && d.return_note ? <Notice tone={colors.red}>{`Returned by ${pn(d.returned_by)}: ${d.return_note}`}</Notice> : null}
      {d.status === 'rejected' && d.return_note ? <Notice tone={colors.red}>{`Rejected by ${pn(d.returned_by)}: ${d.return_note}`}</Notice> : null}
      {d.status === 'cancelled' ? <Notice tone={colors.grey}>{`Cancelled: ${d.cancel_reason ?? ''}`}</Notice> : null}
      {canEdit && missing.length ? <Notice tone={colors.amber}>{`Before submitting, add: ${missing.join(' · ')}.`}</Notice> : null}

      <Card>
        <KeyValue label="Project" value={project ? `${project.code} ${project.name}` : 'No project – central store'} />
        <KeyValue label="Kept at" value={d.location} />
        <KeyValue label="Why it is scrap" value={d.scrap_reason} />
        <KeyValue
          label="Disposal"
          value={
            d.method === 'foc'
              ? `${SCRAP_METHOD.foc} – to ${d.foc_to ?? '—'}${d.foc_reason ? ` · reason: ${d.foc_reason}` : ''}`
              : `${SCRAP_METHOD.sell}${chosen ? ` – ${chosen.buyer}, ${fmtMoney(chosen.amount_lkr, 'LKR')}` : ''}${d.quote_reason ? ` · not the highest: ${d.quote_reason}` : ''}`
          }
        />
        <KeyValue label="Raised by" value={`${pn(d.requested_by)} · ${fmtDateTime(d.requested_at)}`} />
      </Card>

      <Section title={`Items (${lines.length})`}>
        <DataTable
          rows={lines}
          keyOf={(l, i) => l.id ?? String(i)}
          columns={[
            { h: 'Item', w: 260, grow: true, v: (l) => l.item },
            { h: 'From', w: 120, v: (l) => SCRAP_SOURCE[l.source] },
            { h: 'Qty', w: 90, right: true, v: (l) => `${fmtNumber(Number(l.qty), 2)} ${l.unit}` },
            { h: 'Condition', w: 160, v: (l) => conditionLabel(l.condition) },
            { h: 'Note', w: 200, v: (l) => l.note ?? '' },
          ]}
        />
      </Section>
      {canEdit ? (
        <Row>
          <Button variant="secondary" title="Change items or details" onPress={() => router.push({ pathname: '/execution/scrap/new', params: { id: d.id } })} />
        </Row>
      ) : null}

      <Attachments
        entityType="scrap_disposal"
        entityId={d.id}
        kinds={canEdit ? ['scrap_photo'] : canRecord ? ['scrap_evidence'] : []}
        title="Photos and evidence"
        allowCamera
        canUpload={canEdit || canRecord}
        onChange={setPhotos}
      />

      {d.method === 'sell' ? (
        <Section title={`Quotations (${quotes.length})`} right={canEdit ? <Button small title="+ Quotation" onPress={addQuote} /> : null}>
          {quotes.length ? (
            quotes.map((q) => (
              <Card key={q.id} style={{ gap: 4, borderWidth: q.id === d.selected_quote_id ? 2 : 0, borderColor: colors.green }}>
                <Row wrap gap={8} style={{ alignItems: 'center' }}>
                  <Text style={{ fontWeight: '700', color: colors.ink, flex: 1 }}>{`${q.buyer} – ${fmtMoney(q.amount_lkr, 'LKR')}`}</Text>
                  {Number(q.amount_lkr) === best ? <Pill label="Highest" tone={colors.green} /> : null}
                  {q.id === d.selected_quote_id ? <Pill label="Accepted" tone={colors.green} solid /> : null}
                  {canEdit ? (
                    <Button
                      small
                      variant="ghost"
                      title="Remove"
                      onPress={() =>
                        dialog.run(async () => {
                          await rpc('remove_scrap_quote', { p_quote: q.id });
                          await reload();
                        }, 'Removed')
                      }
                    />
                  ) : null}
                </Row>
                <Muted>{[q.valid_until ? `valid until ${fmtDate(q.valid_until)}` : null, q.note, `added by ${pn(q.added_by)}`].filter(Boolean).join(' · ')}</Muted>
                <View>
                  <Attachments
                    entityType="scrap_quote"
                    entityId={q.id}
                    kinds={['scrap_quote']}
                    title="Quotation document"
                    canUpload={canEdit}
                    onChange={(fs) => setQuoteDocs((x) => (x[q.id] === fs.length ? x : { ...x, [q.id]: fs.length }))}
                  />
                </View>
              </Card>
            ))
          ) : (
            <Muted>No quotations yet{canEdit ? ' – add each buyer’s offer and attach the quotation document.' : '.'}</Muted>
          )}
        </Section>
      ) : null}

      <Section title="Approval">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <ListRow
            title="1 · SM Projects"
            subtitle={d.smp_at ? `${pn(d.smp_by)} · ${fmtDateTime(d.smp_at)}${d.smp_note ? ` · ${d.smp_note}` : ''}` : d.status === 'pending_smp' ? 'Waiting' : '—'}
            right={<Pill label={d.status === 'pending_smp' ? 'Waiting' : d.smp_at && d.status !== 'returned' && d.status !== 'rejected' ? 'Approved' : '—'} tone={d.status === 'pending_smp' ? colors.amber : colors.green} />}
          />
          <ListRow
            title="2 · DGM"
            subtitle={d.dgm_at ? `${pn(d.dgm_by)} · ${fmtDateTime(d.dgm_at)}${d.dgm_note ? ` · ${d.dgm_note}` : ''}` : d.status === 'pending_dgm' ? 'Waiting' : '—'}
            right={<Pill label={d.status === 'pending_dgm' ? 'Waiting' : ['approved', 'disposed'].includes(d.status) ? 'Approved' : '—'} tone={d.status === 'pending_dgm' ? colors.amber : colors.green} />}
          />
          {d.status === 'disposed' ? (
            <ListRow
              title="3 · Disposed"
              subtitle={[
                `${fmtDate(d.disposed_on)} by ${pn(d.disposed_by)}`,
                d.disposal_ref ? `ref ${d.disposal_ref}` : null,
                d.amount_received != null ? `${fmtMoney(d.amount_received, 'LKR')} received` : null,
                d.disposal_note,
              ]
                .filter(Boolean)
                .join(' · ')}
              right={<Pill label="Done" tone={colors.green} solid />}
            />
          ) : null}
        </Card>
      </Section>

      <Row wrap gap={8}>
        {canEdit ? <Button title="Submit to SM Projects" onPress={submit} disabled={missing.length > 0} /> : null}
        {canDecide ? (
          <>
            <Button title={d.status === 'pending_smp' ? 'Approve – to the DGM' : 'Approve'} onPress={() => decide('approve')} />
            <Button variant="secondary" title="Return for changes" onPress={() => decide('return')} />
            <Button variant="danger" title="Reject" onPress={() => decide('reject')} />
          </>
        ) : null}
        {canRecord ? <Button title="Record the disposal" onPress={record} disabled={!photos?.some((f) => f.kind === 'scrap_evidence')} /> : null}
        {canCancel ? <Button variant="ghost" title="Cancel request" onPress={cancel} /> : null}
      </Row>
      {canRecord && !photos?.some((f) => f.kind === 'scrap_evidence') ? <Muted>Attach the evidence above (gate pass, receipt or a photo of the removal) to record the disposal.</Muted> : null}
    </Screen>
  );
}
