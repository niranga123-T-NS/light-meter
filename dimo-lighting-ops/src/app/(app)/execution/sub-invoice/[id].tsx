import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { SINV_NOTICE, SINV_STATUS, type SubInvoice } from '@/lib/execution';
import { listAttachments, openAttachment, pickDocument, pickImage, uploadAttachment } from '@/lib/files';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Attachment } from '@/lib/types';

type Log = { id: number; at: string; by: string | null; action: string; note: string | null };
const ACTION: Record<string, string> = {
  created: 'Recorded',
  submitted: 'Submitted',
  resubmitted: 'Submitted again',
  approved_see_approved: 'Approved by the Senior Electrical Engineer',
  approved_approved: 'Approved by Operations – physical documents can be submitted',
  returned: 'Returned with comments',
  docs_received: 'Physical documents received',
  cancelled: 'Withdrawn',
};
const STEPS: { key: SubInvoice['status'][]; label: string }[] = [
  { key: ['submitted', 'see_approved', 'approved', 'docs_received'], label: 'Recorded' },
  { key: ['see_approved', 'approved', 'docs_received'], label: 'SEE approved' },
  { key: ['approved', 'docs_received'], label: 'Operations approved' },
  { key: ['docs_received'], label: 'Documents received' },
];

/** One subcontractor invoice: the copy, the red-marked copies, approvals by the SEE and Operations, and what to do next. */
export default function SubInvoicePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const [v, l, f] = await Promise.all([
      supabase.from('sub_invoices').select('*, exec_projects(code, name), sub_certs(code, period, net)').eq('id', id).single(),
      supabase.from('sub_invoice_log').select('*').eq('invoice_id', id).order('at'),
      listAttachments('sub_invoice', [id]),
    ]);
    if (v.error) throw new Error(v.error.message);
    return {
      v: v.data as SubInvoice & { exec_projects: { code: string | null; name: string } | null; sub_certs: { code: string; period: string; net: number } | null },
      log: (l.data ?? []) as Log[],
      files: f as Attachment[],
    };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { v, log, files } = data;
  const docs = files.filter((x) => x.kind === 'sinv_doc');
  const marked = files.filter((x) => x.kind === 'sinv_markup');
  const st = SINV_STATUS[v.status];
  const tone = { grey: colors.grey, amber: colors.amber, blue: colors.blue, green: colors.green, red: colors.red }[st.tone];
  const recorder = v.created_by === me.id || me.role === 'assistant_engineer' || me.role === 'senior_elec_engineer';
  const editable = recorder && (v.status === 'draft' || v.status === 'returned');
  const reviewer = (v.status === 'submitted' && me.role === 'senior_elec_engineer') || (v.status === 'see_approved' && me.role === 'operations_exec');
  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);

  const add = async (photo: boolean, camera = false) => {
    const f = photo ? await pickImage(camera) : await pickDocument();
    if (!f) return;
    await dialog.run(async () => {
      await uploadAttachment('sub_invoice', v.id, 'sinv_doc', f);
      await reload();
    }, 'Copy attached');
  };
  const submit = async () => {
    const again = v.status === 'returned';
    const r = again
      ? await dialog.prompt({
          title: 'Submit again',
          message: 'Attach the corrected copy first if the comments asked for one.',
          fields: [
            { key: 'amount', label: 'Invoice amount (LKR)', initial: String(v.amount) },
            { key: 'note', label: 'What was corrected', type: 'multiline', required: true },
          ],
          confirmLabel: 'Submit',
        })
      : (await dialog.confirm('Submit the invoice?', SINV_NOTICE, { confirmLabel: 'Submit' }))
        ? {}
        : null;
    if (r) await run('submit_sub_invoice', { p_id: v.id, p: r }, 'Submitted – recorded for reference');
  };
  const decide = async (ok: boolean) => {
    const r = await dialog.prompt({
      title: ok ? (me.role === 'operations_exec' ? 'Approve – the subcontractor may submit the physical documents' : 'Approve – goes to Operations') : 'Return with comments',
      message: ok ? undefined : marked.length ? 'Your marked-up copy goes with it.' : 'Tip: mark your comments in red on the copy first (✎ Mark up), then return.',
      fields: [{ key: 'n', label: ok ? 'Note (optional)' : 'Reason', type: 'multiline', required: !ok }],
      confirmLabel: ok ? 'Approve' : 'Return',
      danger: !ok,
    });
    if (r) await run('decide_sub_invoice', { p_id: v.id, p_ok: ok, p_note: r.n || null }, ok ? 'Approved' : 'Returned – the submitter is told');
  };

  return (
    <Screen maxWidth={900} onRefresh={reload}>
      <Stack.Screen options={{ title: v.code }} />
      <Card>
        <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{`${v.code} · ${v.subcontractor}`}</Text>
          <Pill label={st.label} tone={tone} solid={v.status === 'approved' || v.status === 'returned'} />
        </Row>
        <Muted>{`${v.exec_projects?.code ?? ''} ${v.exec_projects?.name ?? ''}`}</Muted>
        <Row wrap gap={6} style={{ marginTop: 8 }}>
          {STEPS.map((s) => (
            <Pill key={s.label} label={`${s.key.includes(v.status) ? '✓ ' : ''}${s.label}`} tone={s.key.includes(v.status) ? colors.green : colors.grey} />
          ))}
        </Row>
        <Row wrap gap={16} style={{ marginTop: 8 }}>
          <KeyValue label="Invoice" value={`${v.invoice_no} · ${fmtDate(v.invoice_date)}`} />
          <KeyValue label="Amount" value={fmtMoney(v.amount, 'LKR')} />
          <KeyValue label="Payment certificate" value={v.sub_certs ? `${v.sub_certs.code} · ${v.sub_certs.period} · net ${fmtMoney(v.sub_certs.net, 'LKR')}` : '—'} />
          <KeyValue label="Recorded by" value={`${people[v.created_by]?.full_name ?? '—'}${v.revision ? ` · revision ${v.revision}` : ''}`} />
        </Row>
        {v.note ? <Muted>{v.note}</Muted> : null}
      </Card>

      {v.status === 'approved' ? (
        <Notice tone={colors.green}>
          Approved by the Senior Electrical Engineer and Operations. Submit the original invoice with the IPC and measurement sheets to the DIMO Lighting Solutions office for processing.
        </Notice>
      ) : v.status === 'returned' ? (
        <Notice tone={colors.red}>{`Returned: ${v.return_note ?? ''}\nSee the comments marked in red on the copy below, correct and submit again. Do not send the physical documents yet.`}</Notice>
      ) : v.status === 'docs_received' ? (
        <Notice tone={colors.green}>{`Physical documents received ${fmtDateTime(v.docs_received_at)}${v.docs_note ? ` · ${v.docs_note}` : ''}`}</Notice>
      ) : v.status !== 'cancelled' ? (
        <Notice tone={colors.blue}>{SINV_NOTICE}</Notice>
      ) : null}

      <Section title="Invoice copy">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {docs.length ? (
            docs.map((f) => (
              <ListRow
                key={f.id}
                title={f.file_name}
                subtitle={`${people[f.uploaded_by]?.full_name ?? ''} · ${fmtDateTime(f.uploaded_at)}`}
                right={
                  <Row gap={6}>
                    <Button small variant="secondary" title="Open" onPress={() => dialog.run(() => openAttachment(f))} />
                    {reviewer ? (
                      <Button
                        small
                        title="✎ Mark up"
                        onPress={() =>
                          Platform.OS === 'web'
                            ? router.push({ pathname: '/execution/sub-invoice/markup', params: { id: v.id, att: f.id } })
                            : dialog.toast('Mark up the copy on the website (computer or tablet browser)', 'error')
                        }
                      />
                    ) : null}
                  </Row>
                }
              />
            ))
          ) : (
            <View style={{ padding: 12 }}>
              <Muted>No copy attached yet.</Muted>
            </View>
          )}
        </Card>
        {editable ? (
          <Row wrap gap={8} style={{ marginTop: 8 }}>
            <Button small variant="secondary" title="+ PDF / file" onPress={() => add(false)} />
            <Button small variant="secondary" title="+ Photo" onPress={() => add(true)} />
            {Platform.OS !== 'web' ? <Button small variant="secondary" title="📷 Take photo" onPress={() => add(true, true)} /> : null}
          </Row>
        ) : null}
      </Section>

      {marked.length ? (
        <Section title="Comments marked on the copy">
          <Card style={{ padding: 0, overflow: 'hidden', borderColor: colors.red, borderWidth: 1 }}>
            {marked.map((f) => (
              <ListRow
                key={f.id}
                highlight={colors.red}
                title={<Text style={{ color: colors.red, fontWeight: '700' }}>{f.file_name}</Text>}
                subtitle={`${people[f.uploaded_by]?.full_name ?? ''} · ${fmtDateTime(f.uploaded_at)}`}
                right={<Button small variant="secondary" title="Open" onPress={() => dialog.run(() => openAttachment(f))} />}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      <Row wrap gap={8}>
        {editable ? <Button title={v.status === 'returned' ? 'Submit again' : 'Submit'} disabled={!docs.length} onPress={submit} /> : null}
        {editable ? (
          <Button
            variant="ghost"
            title="Withdraw"
            onPress={async () => {
              const r = await dialog.prompt({ title: 'Withdraw this invoice record', fields: [{ key: 'r', label: 'Reason', required: true }], confirmLabel: 'Withdraw', danger: true });
              if (r) await run('cancel_sub_invoice', { p_id: v.id, p_reason: r.r }, 'Withdrawn');
            }}
          />
        ) : null}
        {reviewer ? <Button title="Approve" onPress={() => decide(true)} /> : null}
        {reviewer ? <Button variant="danger" title="Return with comments" onPress={() => decide(false)} /> : null}
        {v.status === 'approved' && me.role === 'operations_exec' ? (
          <Button
            title="Physical documents received"
            onPress={async () => {
              const r = await dialog.prompt({ title: 'Physical documents received', fields: [{ key: 'n', label: 'Note (optional)' }], confirmLabel: 'Record' });
              if (r) await run('receive_sub_invoice_docs', { p_id: v.id, p_note: r.n || null }, 'Recorded');
            }}
          />
        ) : null}
      </Row>
      {editable && !docs.length ? <Muted>Attach the invoice copy (PDF or photos) to submit.</Muted> : null}

      <Section title="History">
        <Card>
          {log.map((l) => (
            <Row key={l.id} wrap gap={8} style={{ paddingVertical: 3 }}>
              <Muted>{fmtDateTime(l.at)}</Muted>
              <Text style={{ color: l.action === 'returned' ? colors.red : colors.ink }}>
                {`${ACTION[l.action] ?? l.action} · ${people[l.by ?? '']?.full_name ?? ''}${l.note ? ` · ${l.note}` : ''}`}
              </Text>
            </Row>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
