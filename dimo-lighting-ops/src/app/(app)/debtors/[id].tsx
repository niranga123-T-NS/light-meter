import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { AgeingChip } from '@/components/Ageing';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { daysBetween, fmtDate, fmtDateTime, fmtMoney, human, todayISO } from '@/lib/format';
import { useLoad, useMasters, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Debt } from '@/lib/types';

type Collection = { id: string; amount: number; collected_on: string; ref: string | null; note: string; outstanding_before: number; against_upload_id: string | null; recorded_by: string; recorded_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null };
type LogRow = { id: number; kind: string; from_status: string | null; to_status: string | null; note: string | null; legal_description: string | null; next_hearing_date: string | null; user_id: string | null; at: string };

export default function DebtDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const masters = useMasters();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const { data: d, error: e } = await supabase.from('debts').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const [{ data: log }, { data: col }] = await Promise.all([
      supabase.from('debt_log').select('*').eq('debt_id', id).order('at', { ascending: false }),
      supabase.from('debt_collections').select('*').eq('debt_id', id).order('recorded_at', { ascending: false }),
    ]);
    return { debt: d as Debt, log: (log ?? []) as LogRow[], collections: (col ?? []) as Collection[] };
  }, [id]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const d = data.debt;
  const canUpdate = d.sales_person_id === me.id || me.role === 'sm_projects' || me.role === 'gm';
  const ops = me.role === 'operations_exec';
  const canAssign = ops || me.role === 'sm_projects' || me.role === 'gm';
  // Part collections counted against the outstanding amount of the latest upload
  const current = data.collections.filter((c) => !c.voided_at && c.against_upload_id === (d.last_upload_id ?? null));
  const collected = current.reduce((a, c) => a + Number(c.amount), 0);
  const balance = Number(d.amount) - collected;
  const open = !['collected_confirmed', 'cleared'].includes(d.status);

  const recordCollection = async () => {
    const r = await dialog.prompt({
      title: 'Record amount collected',
      message: `Outstanding ${fmtMoney(d.amount, d.currency)}${collected ? ` · collected so far ${fmtMoney(collected, d.currency)}` : ''} · balance ${fmtMoney(balance, d.currency)}`,
      fields: [
        { key: 'amount', label: `Amount collected (${d.currency})`, required: true, initial: '' },
        { key: 'date', label: 'Collection date', type: 'date', required: true, initial: todayISO() },
        { key: 'ref', label: 'Reference (cheque / transfer / receipt no.)' },
        { key: 'note', label: 'Note', type: 'multiline', required: true, hint: 'How it was paid and what remains, e.g. "Cheque deposited – balance promised end of month"' },
      ],
      confirmLabel: 'Record',
    });
    if (!r) return;
    const amt = Number(String(r.amount).replace(/,/g, ''));
    if (!(amt > 0)) return dialog.toast('Enter the amount collected', 'error');
    if (amt > balance) return dialog.toast(`More than the balance of ${fmtMoney(balance, d.currency)}`, 'error');
    await dialog.run(async () => {
      await rpc('record_debt_collection', { p_debt: d.id, p_amount: amt, p_date: r.date, p_note: r.note, p_ref: r.ref || null });
      await reload();
    }, amt >= balance ? 'Collected in full' : `Part collection recorded – balance ${fmtMoney(balance - amt, d.currency)}`);
  };
  const voidCollection = async (c: Collection) => {
    const r = await dialog.prompt({ title: 'Cancel this collection entry', message: `${fmtMoney(c.amount, d.currency)} on ${fmtDate(c.collected_on)}`, fields: [{ key: 'reason', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Cancel entry' });
    if (r) await dialog.run(async () => { await rpc('void_debt_collection', { p_id: c.id, p_reason: r.reason }); await reload(); }, 'Entry cancelled');
  };

  // The debtors list stands on its own (accounts system); the only assignment is the sales person who follows it up
  const assign = async () => {
    const { data: sales } = await supabase.from('profiles').select('id, full_name').in('role', ['asm_building', 'asm_infra']).eq('active', true).order('full_name');
    const r = await dialog.prompt({
      title: d.sales_person_id ? 'Change sales person' : 'Assign sales person',
      message: 'The sales person follows this invoice up and sees it in My Debtors.',
      fields: [{ key: 'sp', label: 'Sales person', type: 'select', required: true, initial: d.sales_person_id ?? undefined, options: (sales ?? []).map((x) => ({ value: x.id, label: x.full_name })) }],
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('set_debt_sales_person', { p_debt: d.id, p_sales_person: r.sp });
      await reload();
    }, 'Sales person assigned');
  };

  // Correct an uploaded debt (Operations Executive, with a reason); the next upload still updates it from the file
  const editDetails = async () => {
    const r = await dialog.prompt({
      title: `Edit debtor – ${d.invoice_no}`,
      message: 'Correct what was uploaded. The change and reason go to the history; the next upload still updates it from the file.',
      fields: [
        { key: 'client_name', label: 'Client name', required: true, initial: d.client_name ?? '' },
        { key: 'project_name', label: 'Project', initial: d.project_name ?? '' },
        { key: 'invoice_no', label: 'Invoice number', required: true, initial: d.invoice_no },
        { key: 'invoice_date', label: 'Invoice date', type: 'date', initial: d.invoice_date ?? undefined },
        { key: 'amount', label: 'Outstanding amount', required: true, initial: String(d.amount) },
        {
          key: 'currency',
          label: 'Currency',
          type: 'select',
          required: true,
          initial: d.currency,
          options: [
            { value: 'LKR', label: 'LKR' },
            { value: 'USD', label: 'USD' },
          ],
        },
        { key: 'outstanding_days', label: 'Outstanding days', required: true, initial: String(d.outstanding_days) },
        { key: 'reason', label: 'Reason for the change', type: 'multiline', required: true },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    const { reason, ...rest } = r;
    await dialog.run(async () => {
      await rpc('edit_debt', { p_debt: d.id, p_data: { ...rest, invoice_date: rest.invoice_date || null }, p_reason: reason });
      await reload();
    }, 'Debtor updated');
  };

  const updateStatus = async () => {
    const r = await dialog.prompt({
      title: 'Update debt status',
      fields: [
        {
          key: 's',
          label: 'Status',
          type: 'select',
          required: true,
          options: [
            { value: 'follow_up', label: 'Follow-up done' },
            { value: 'payment_promised', label: 'Payment promised' },
            { value: 'collected', label: 'Collected' },
            { value: 'disputed', label: 'Disputed' },
          ],
        },
        { key: 'note', label: 'Note / dispute reason', type: 'multiline' },
        { key: 'next', label: 'Next follow-up date (follow-up)', type: 'date' },
        { key: 'promised', label: 'Promised date (payment promised)', type: 'date' },
        { key: 'amount', label: `Amount collected (${d.currency})` },
        { key: 'date', label: 'Collection date (collected)', type: 'date', initial: todayISO() },
        { key: 'ref', label: 'Reference (optional)' },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('update_debt_status', {
        p_debt: d.id,
        p_status: r.s,
        p_note: r.note || null,
        p_next_follow_up: r.next || null,
        p_promised_date: r.promised || null,
        p_collected_amount: r.amount ? Number(r.amount) : null,
        p_collected_date: r.s === 'collected' ? r.date || null : null,
        p_ref: r.ref || null,
      });
      await reload();
    }, r.s === 'collected' ? 'Marked collected – awaiting confirmation by the next upload' : 'Status updated');
  };

  const hearingOverdue = d.is_legal && !d.legal_outcome && !!d.next_hearing_date && d.next_hearing_date < todayISO();
  const legal = async (close: boolean) => {
    const r = await dialog.prompt({
      title: close ? 'Close legal case' : d.is_legal ? 'Update legal status' : 'Place under Legal',
      fields: [
        { key: 'desc', label: 'Short description (case, court, lawyer, stage)', type: 'multiline', required: true, maxLength: 180, initial: d.legal_description ?? '' },
        ...(close
          ? [
              {
                key: 'outcome',
                label: 'Outcome',
                type: 'select' as const,
                required: true,
                options: [
                  { value: 'Settled / Collected', label: 'Settled / Collected' },
                  { value: 'Written off', label: 'Written off' },
                  { value: 'Other', label: 'Other' },
                ],
              },
            ]
          : [
              { key: 'hearing', label: 'Next hearing date', type: 'date' as const, required: true },
              ...(d.is_legal ? [{ key: 'comment', label: 'Comments on this update (what happened / current status)', type: 'multiline' as const, required: true }] : []),
            ]),
      ],
    });
    if (!r) return;
    if (r.hearing && r.hearing < todayISO()) return dialog.toast('The next hearing date cannot be in the past', 'error');
    await dialog.run(async () => {
      await rpc('set_debt_legal', { p_debt: d.id, p_is_legal: !close, p_description: r.desc, p_next_hearing: r.hearing || null, p_outcome: r.outcome || null, p_comment: r.comment || null });
      await reload();
    }, 'Legal status saved');
  };

  return (
    <Screen maxWidth={800}>
      <Stack.Screen options={{ title: d.invoice_no }} />
      <Card>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{d.client_name}</Text>
          <AgeingChip bucket={d.ageing_bucket} legal={d.is_legal} />
        </Row>
        {d.project_name ? <Muted>{d.project_name}</Muted> : null}
        {d.sample_id ? (
          <Button small variant="ghost" title="Sample sale – open the sample ›" onPress={() => router.push(`/samples/${d.sample_id}`)} />
        ) : null}
        {d.client_name ? (
          <Button small variant="ghost" title="Customer profile & payment history ›" onPress={() => router.push({ pathname: '/debtors/customer', params: { name: d.client_name ?? '' } })} />
        ) : null}
        {!d.sales_person_id ? <Notice tone={colors.amber}>No sales person assigned – nobody is following this invoice up yet.</Notice> : null}
        <Row wrap style={{ marginTop: 8 }}>
          <KeyValue label="Outstanding" value={fmtMoney(d.amount, d.currency)} />
          {collected ? <KeyValue label="Collected" value={fmtMoney(collected, d.currency)} /> : null}
          {collected ? <KeyValue label="Balance" value={fmtMoney(balance, d.currency)} /> : null}
          <KeyValue label="Outstanding days" value={String(d.outstanding_days)} />
          <KeyValue label="Invoice date" value={fmtDate(d.invoice_date)} />
          <KeyValue label="Sales person" value={people[d.sales_person_id ?? '']?.full_name ?? '—'} />
          <KeyValue label="Status" value={d.status === 'collected' ? 'Collected – awaiting confirmation' : human(d.status)} />
          <KeyValue label="Last update" value={fmtDateTime(d.last_status_at)} />
          {d.promised_date ? <KeyValue label="Promised" value={fmtDate(d.promised_date)} /> : null}
          {d.next_follow_up_date ? <KeyValue label="Next follow-up" value={fmtDate(d.next_follow_up_date)} /> : null}
        </Row>
        {d.collection_mismatch ? <Notice tone={colors.red}>Marked collected but still in the latest debtors upload – check with Operations.</Notice> : null}
        {hearingOverdue ? (
          <Notice tone={colors.red}>
            Hearing date {fmtDate(d.next_hearing_date)} has passed ({daysBetween(d.next_hearing_date!, todayISO())} days ago) – {ops ? 'update the status, next hearing date and comments now.' : 'waiting for the Operations Executive to update it.'} A reminder is sent every day until it is updated.
          </Notice>
        ) : null}
        {d.is_legal ? (
          <Notice tone={colors.ink}>
            Legal: {d.legal_description} · next hearing {fmtDate(d.next_hearing_date)}
          </Notice>
        ) : null}
        {d.legal_outcome ? <Muted>Legal outcome: {d.legal_outcome}</Muted> : null}
        <Row wrap gap={8} style={{ marginTop: 8 }}>
          {ops && open && balance > 0 ? <Button title="Record amount collected" onPress={recordCollection} /> : null}
          {canUpdate && !d.is_legal && !['collected_confirmed', 'cleared'].includes(d.status) ? <Button variant={ops ? 'secondary' : 'primary'} title="Update status" onPress={updateStatus} /> : null}
          {ops ? <Button variant={hearingOverdue ? 'primary' : 'secondary'} title={d.is_legal ? 'Update legal / next hearing' : 'Place under Legal'} onPress={() => legal(false)} /> : null}
          {ops && d.is_legal ? <Button variant="secondary" title="Close legal case" onPress={() => legal(true)} /> : null}
          {canAssign ? <Button variant="secondary" title={d.sales_person_id ? 'Change sales person' : 'Assign sales person'} onPress={assign} /> : null}
          {ops && d.source !== 'sample' ? <Button variant="secondary" title="Edit details" onPress={editDetails} /> : null}
        </Row>
        {!ops && d.is_legal ? <Muted>Legal status is maintained by the Operations Executive.</Muted> : null}
      </Card>
      {data.collections.length ? (
        <Section title={`Collections${collected ? ` – ${fmtMoney(collected, d.currency)} collected, balance ${fmtMoney(balance, d.currency)}` : ''}`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.collections.map((c) => {
              const counts = !c.voided_at && c.against_upload_id === (d.last_upload_id ?? null);
              return (
                <Row key={c.id} wrap gap={8} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.line, alignItems: 'center', opacity: c.voided_at ? 0.55 : 1 }}>
                  <Text style={{ width: 150, fontWeight: '700', color: c.voided_at ? colors.muted : colors.green, textDecorationLine: c.voided_at ? 'line-through' : 'none' }}>{fmtMoney(c.amount, d.currency)}</Text>
                  <Text style={{ flex: 1, minWidth: 220, color: colors.ink }}>
                    {`${fmtDate(c.collected_on)}${c.ref ? ` · ref ${c.ref}` : ''} · ${c.note}`}
                    <Text style={{ color: colors.muted }}>
                      {`\nRecorded by ${people[c.recorded_by]?.full_name ?? ''} · ${fmtDateTime(c.recorded_at)} · outstanding before ${fmtMoney(c.outstanding_before, d.currency)}${c.voided_at ? ` · cancelled by ${people[c.voided_by ?? '']?.full_name ?? ''}: ${c.void_reason ?? ''}` : !counts ? ' · taken into the accounts in a later upload' : ''}`}
                    </Text>
                  </Text>
                  {ops && counts && open ? <Button small variant="ghost" title="Cancel entry" onPress={() => voidCollection(c)} /> : null}
                </Row>
              );
            })}
          </Card>
        </Section>
      ) : null}
      <Section title="History">
        <Card>
          {data.log.map((l) => (
            <Muted key={l.id}>
              {fmtDateTime(l.at)} · {people[l.user_id ?? '']?.full_name ?? 'Upload'} · {l.kind === 'legal'
                ? `Legal: ${l.legal_description ?? ''} ${l.next_hearing_date ? `(hearing ${fmtDate(l.next_hearing_date)})` : ''}`
                : l.kind === 'edit'
                  ? 'Details corrected'
                  : l.kind === 'collection'
                    ? `Collection · ${human(l.from_status)} → ${human(l.to_status)}`
                  : `${human(l.from_status)} → ${human(l.to_status)}`}
              {l.note ? ` · ${l.note}` : ''}
            </Muted>
          ))}
          {!data.log.length ? <Muted>No history</Muted> : null}
        </Card>
      </Section>
      <Muted>Dispute reasons: {masters.values('debt_dispute_reason').join(', ')}</Muted>
    </Screen>
  );
}
