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
    const { data: log } = await supabase.from('debt_log').select('*').eq('debt_id', id).order('at', { ascending: false });
    return { debt: d as Debt, log: (log ?? []) as LogRow[] };
  }, [id]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const d = data.debt;
  const canUpdate = d.sales_person_id === me.id || me.role === 'sm_projects' || me.role === 'gm';
  const ops = me.role === 'operations_exec';
  const canAssign = ops || me.role === 'sm_projects' || me.role === 'gm';

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
            { value: 'partially_collected', label: 'Partially collected' },
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
          {canUpdate && !d.is_legal && !['collected_confirmed', 'cleared'].includes(d.status) ? <Button title="Update status" onPress={updateStatus} /> : null}
          {ops ? <Button variant={hearingOverdue ? 'primary' : 'secondary'} title={d.is_legal ? 'Update legal / next hearing' : 'Place under Legal'} onPress={() => legal(false)} /> : null}
          {ops && d.is_legal ? <Button variant="secondary" title="Close legal case" onPress={() => legal(true)} /> : null}
          {canAssign ? <Button variant="secondary" title={d.sales_person_id ? 'Change sales person' : 'Assign sales person'} onPress={assign} /> : null}
        </Row>
        {!ops && d.is_legal ? <Muted>Legal status is maintained by the Operations Executive.</Muted> : null}
      </Card>
      <Section title="History">
        <Card>
          {data.log.map((l) => (
            <Muted key={l.id}>
              {fmtDateTime(l.at)} · {people[l.user_id ?? '']?.full_name ?? 'Upload'} · {l.kind === 'legal' ? `Legal: ${l.legal_description ?? ''} ${l.next_hearing_date ? `(hearing ${fmtDate(l.next_hearing_date)})` : ''}` : `${human(l.from_status)} → ${human(l.to_status)}`}
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
