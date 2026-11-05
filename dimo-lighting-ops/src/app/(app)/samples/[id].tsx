import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, human } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Sample, SampleItem } from '@/lib/types';
import { sampleOverdue } from '@/lib/constants';

export default function SampleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const { data: s, error: e } = await supabase.from('samples').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const { data: items } = await supabase.from('sample_items').select('*').eq('sample_id', id);
    return { sample: s as Sample, items: (items ?? []) as SampleItem[] };
  }, [id]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const s = data.sample;
  const mine = s.sales_person_id === me.id;
  const ops = me.role === 'operations_exec';
  const smp = me.role === 'sm_projects' || me.role === 'gm';
  const est = me.role === 'sm_estimation' || me.role === 'gm';
  const os = s.order_status ?? null;
  const ORDER_STEP: Record<string, [string, string]> = {
    requested: ['With SM Estimation', colors.amber], accepted: ['With SM Projects for approval', colors.amber], approved: ['On order – supply order with SM Estimation / Operations', colors.blue],
    arrived: ['Arrived – continues as a normal sample request', colors.green], declined: ['Declined by SM Estimation', colors.red], rejected: ['Not approved by SM Projects', colors.red], cancelled: ['Ordering request cancelled', colors.grey],
  };
  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: s.code }} />
      <Card>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{s.client_name}</Text>
          <Pill label={sampleOverdue(s) ? 'Overdue' : human(s.status)} tone={sampleOverdue(s) ? colors.red : colors.blue} solid />
        </Row>
        <Muted>{s.project_name}</Muted>
        <Row wrap style={{ marginTop: 8 }}>
          <KeyValue label="Requested by" value={people[s.sales_person_id]?.full_name ?? '—'} />
          <KeyValue label="Type" value={s.sample_type === 'returnable' ? 'Returnable' : `Non-returnable · ${s.nr_disposition === 'sell' ? 'Sell' : s.nr_disposition === 'foc' ? 'FOC' : '—'}`} />
          <KeyValue label="Purpose" value={s.purpose} />
          <KeyValue label="Required by" value={fmtDateTime(s.required_by)} />
          <KeyValue label="Expected return" value={fmtDate(s.expected_return_date)} />
          <KeyValue label="Total value" value={fmtMoney(s.total_value, s.currency)} />
          <KeyValue label="Handover location" value={s.handover_location} />
          <KeyValue label="Handover person" value={[s.handover_person?.name, s.handover_person?.designation, s.handover_person?.organization, s.handover_person?.phone].filter(Boolean).join(' · ') || '—'} />
          {s.availability ? <KeyValue label="Availability" value={`${human(s.availability)}${s.availability_note ? ` · ${s.availability_note}` : ''}`} /> : null}
          {s.handed_over_at ? <KeyValue label="Handed over" value={`${fmtDateTime(s.handed_over_at)} · by ${s.handed_over_by} · to ${s.received_by}`} /> : null}
          {s.return_reported_at ? <KeyValue label="Return reported" value={`${fmtDateTime(s.return_reported_at)}${s.return_report_note ? ` · ${s.return_report_note}` : ''}`} /> : null}
          {s.returned_at ? <KeyValue label="Return confirmed" value={`${fmtDateTime(s.returned_at)} · ${human(s.return_condition)}`} /> : null}
          {s.cleared_at ? <KeyValue label="Cleared" value={`${fmtDateTime(s.cleared_at)}${s.clear_note ? ` · ${s.clear_note}` : ''}`} /> : null}
        </Row>
        {s.approval_comment ? <Notice>Approval comments: {s.approval_comment}</Notice> : null}
        {s.status === 'gm_approval' ? <Notice tone={colors.amber}>Approved by SM Projects – above LKR 100,000.00, so DGM approves next.</Notice> : null}
        {s.status === 'availability_confirmed' && me.role === 'gm' ? <Notice>Waiting for SM Projects. DGM approves only requests above LKR 100,000.00, after SM Projects.</Notice> : null}
        {s.status === 'return_reported' ? <Notice tone={colors.amber}>Reported returned by the sales person – waiting for the Operations Executive to confirm and clear it.</Notice> : null}
        {s.status === 'sold_unpaid' ? <Notice tone={colors.amber}>Sold – in the debtors list until it is collected. The sample clears automatically when the debt is cleared.</Notice> : null}
        {s.status === 'damaged_lost' ? <Notice tone={colors.red}>Returned {human(s.return_condition)} – stays open until the Operations Executive clears it.</Notice> : null}
        {s.debt_id ? <Button small variant="ghost" title="Open the debt in Debtors ›" onPress={() => router.push(`/debtors/${s.debt_id}`)} /> : null}
        {os ? (
          <Card style={{ marginTop: 10, borderColor: ORDER_STEP[os][1], gap: 4 }}>
            <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', color: colors.ink }}>Ordering the sample items</Text>
              <Pill label={ORDER_STEP[os][0]} tone={ORDER_STEP[os][1]} solid={os === 'requested' || os === 'accepted'} />
            </Row>
            {s.order_reason ? <Muted>{`Why: ${s.order_reason}${s.order_needed_by ? ` · needed by ${fmtDate(s.order_needed_by)}` : ''} · asked ${fmtDateTime(s.order_requested_at)}`}</Muted> : null}
            {s.order_supplier ? <Muted>{`SM Estimation: ${[s.order_supplier, s.order_cost != null ? `${s.order_currency ?? 'USD'} ${Number(s.order_cost).toLocaleString('en-US')}` : null, s.order_lead].filter(Boolean).join(' · ')} · ${people[s.order_accepted_by ?? '']?.full_name ?? ''} ${fmtDateTime(s.order_accepted_at)}`}</Muted> : null}
            {s.order_note ? <Muted>{`Note: ${s.order_note}`}</Muted> : null}
            {s.supply_order_id ? <Button small variant="secondary" title="Supply order ›" onPress={() => router.push(`/supply-orders/${s.supply_order_id}`)} /> : null}
          </Card>
        ) : null}
        <Row wrap gap={8} style={{ marginTop: 8 }}>
          {mine && ['draft', 'returned_for_changes'].includes(s.status) ? <Button title="Submit request" onPress={() => run('submit_sample', { p_sample: s.id }, 'Submitted')} /> : null}
          {mine && s.status === 'not_available' && (!os || ['declined', 'rejected', 'cancelled'].includes(os)) ? (
            <Button
              title="Request ordering from SM Estimation"
              onPress={async () => {
                const r = await dialog.prompt({
                  title: 'Ask SM Estimation to order the items',
                  message: 'SM Estimation accepts it (supplier, cost, lead time), then SM Projects approves, and a supply order opens. When the items arrive the request continues as a normal sample.',
                  fields: [
                    { key: 'why', label: 'Why it is needed (client, consultant, approval …)', type: 'multiline', required: true },
                    { key: 'by', label: 'Needed by', type: 'date', initial: s.required_by?.slice(0, 10) },
                  ],
                });
                if (r) await run('sample_order_request', { p_sample: s.id, p_reason: r.why, p_needed_by: r.by || null }, 'Sent to SM Estimation');
              }}
            />
          ) : null}
          {mine && os === 'requested' ? <Button variant="secondary" title="Cancel the ordering request" onPress={() => run('sample_order_cancel', { p_sample: s.id }, 'Cancelled')} /> : null}
          {est && os === 'requested' ? (
            <>
              <Button
                title="Accept – send to SM Projects"
                onPress={async () => {
                  const r = await dialog.prompt({
                    title: `Order the items of ${s.code}`,
                    fields: [
                      { key: 'supplier', label: 'Supplier / manufacturer', required: true },
                      { key: 'cost', label: 'Estimated cost incl. freight' },
                      { key: 'currency', label: 'Currency', type: 'select', initial: 'USD', options: [{ value: 'USD', label: 'USD' }, { value: 'LKR', label: 'LKR' }, { value: 'EUR', label: 'EUR' }, { value: 'CNY', label: 'CNY' }] },
                      { key: 'lead', label: 'Lead time (e.g. 3 weeks)', required: true },
                      { key: 'note', label: 'Note', type: 'multiline' },
                    ],
                  });
                  if (r) await run('sample_order_accept', { p_sample: s.id, p: { supplier: r.supplier, cost: r.cost?.replace(/[^\d.]/g, '') || null, currency: r.currency, lead: r.lead, note: r.note } }, 'Sent to SM Projects');
                }}
              />
              <Button
                variant="danger"
                title="Decline"
                onPress={async () => {
                  const r = await dialog.prompt({ title: 'Decline the ordering', fields: [{ key: 'c', label: 'Reason', type: 'multiline', required: true }] });
                  if (r) await run('sample_order_decline', { p_sample: s.id, p_reason: r.c }, 'Declined');
                }}
              />
            </>
          ) : null}
          {smp && os === 'accepted' ? (
            <>
              <Button title="Approve – open the supply order" onPress={() => run('sample_order_decide', { p_sample: s.id, p_approve: true }, 'Approved – supply order opened with SM Estimation')} />
              <Button
                variant="danger"
                title="Reject"
                onPress={async () => {
                  const r = await dialog.prompt({ title: 'Reject the ordering', fields: [{ key: 'c', label: 'Reason', type: 'multiline', required: true }] });
                  if (r) await run('sample_order_decide', { p_sample: s.id, p_approve: false, p_note: r.c }, 'Rejected');
                }}
              />
            </>
          ) : null}
          {ops && os === 'approved' ? (
            <Button
              title="Ordered items arrived"
              onPress={async () => {
                const r = await dialog.prompt({ title: 'Items arrived', message: 'The sample becomes available and goes to SM Projects for approval, as a normal sample request.', fields: [{ key: 'n', label: 'Note (date received, GRN …)', type: 'multiline' }] });
                if (r) await run('sample_order_arrived', { p_sample: s.id, p_note: r.n || null }, 'Recorded – with SM Projects');
              }}
            />
          ) : null}
          {ops && s.status === 'submitted' ? (
            <Button
              title="Record availability"
              onPress={async () => {
                const r = await dialog.prompt({
                  title: 'Stock check',
                  fields: [
                    {
                      key: 'a',
                      label: 'Availability',
                      type: 'select',
                      required: true,
                      options: [
                        { value: 'available', label: 'Available' },
                        { value: 'partly_available', label: 'Partly available (give quantities in the note)' },
                        { value: 'not_available', label: 'Not available' },
                      ],
                    },
                    { key: 'n', label: 'Note / reason / expected date', type: 'multiline' },
                  ],
                });
                if (r) await run('check_sample_availability', { p_sample: s.id, p_availability: r.a, p_note: r.n || null }, 'Recorded');
              }}
            />
          ) : null}
          {(me.role === 'sm_projects' && s.status === 'availability_confirmed') || (me.role === 'gm' && s.status === 'gm_approval') ? (
            <>
              <Button title="Approve" onPress={() => run('decide_sample', { p_sample: s.id, p_decision: 'approved' }, me.role === 'sm_projects' ? 'Approved (above LKR 100,000.00 it goes to DGM next)' : 'Approved')} />
              <Button
                variant="secondary"
                title="Return with comment"
                onPress={async () => {
                  const r = await dialog.prompt({ title: 'Return request', fields: [{ key: 'c', label: 'Comment', type: 'multiline', required: true }] });
                  if (r) await run('decide_sample', { p_sample: s.id, p_decision: 'returned_for_changes', p_comment: r.c }, 'Returned');
                }}
              />
              <Button
                variant="danger"
                title="Reject"
                onPress={async () => {
                  const r = await dialog.prompt({ title: 'Reject request', fields: [{ key: 'c', label: 'Reason', type: 'multiline', required: true }] });
                  if (r) await run('decide_sample', { p_sample: s.id, p_decision: 'rejected', p_comment: r.c }, 'Rejected');
                }}
              />
            </>
          ) : null}
          {ops && s.status === 'approved' ? (
            <Button
              title="Record handover"
              onPress={async () => {
                const sell = s.sample_type === 'non_returnable' && s.nr_disposition === 'sell';
                const r = await dialog.prompt({
                  title: 'Handed over',
                  message: `Attach a photo or the signed delivery note below first.${sell ? ` This is a sale: ${fmtMoney(s.total_value, s.currency)} is added to the sales person's debtors.` : s.sample_type === 'non_returnable' ? ' Free of charge: the sample is cleared at handover.' : ''}`,
                  fields: [
                    { key: 'by', label: 'Handed over by', required: true },
                    { key: 'to', label: 'Received by', required: true, initial: s.handover_person?.name ?? '' },
                    ...(sell ? [{ key: 'inv', label: `Invoice number (optional – ${s.code} if blank)` }] : []),
                  ],
                });
                if (r) await run('record_sample_handover', { p_sample: s.id, p_handed_over_by: r.by, p_received_by: r.to, p_invoice_no: r.inv || null }, 'Handover recorded');
              }}
            />
          ) : null}
          {(mine || smp) && s.status === 'out' ? (
            <Button
              title="Report returned"
              onPress={async () => {
                const r = await dialog.prompt({
                  title: 'Sample returned',
                  message: 'The Operations Executive confirms the return and clears the sample.',
                  fields: [{ key: 'n', label: 'Note (where / to whom it was returned)', type: 'multiline' }],
                });
                if (r) await run('report_sample_returned', { p_sample: s.id, p_note: r.n || null }, 'Reported – Operations will confirm');
              }}
            />
          ) : null}
          {ops && ['out', 'return_reported'].includes(s.status) ? (
            <Button
              title="Confirm return & clear"
              onPress={async () => {
                const r = await dialog.prompt({
                  title: 'Sample returned',
                  fields: [
                    {
                      key: 'c',
                      label: 'Condition',
                      type: 'select',
                      required: true,
                      options: [
                        { value: 'good', label: 'Good' },
                        { value: 'damaged', label: 'Damaged' },
                        { value: 'incomplete', label: 'Incomplete' },
                      ],
                    },
                    { key: 'n', label: 'Note (required if damaged / incomplete)', type: 'multiline' },
                  ],
                });
                if (r) await run('record_sample_return', { p_sample: s.id, p_condition: r.c, p_note: r.n || null }, 'Return recorded');
              }}
            />
          ) : null}
          {ops && s.status === 'damaged_lost' ? (
            <Button
              title="Clear sample"
              onPress={async () => {
                const r = await dialog.prompt({ title: 'Clear sample', fields: [{ key: 'n', label: 'How was it settled (recovered, charged, written off …)', type: 'multiline', required: true }] });
                if (r) await run('clear_sample', { p_sample: s.id, p_note: r.n }, 'Cleared');
              }}
            />
          ) : null}
          {mine && s.status === 'out' ? (
            <Button
              variant="secondary"
              title="Request new return date"
              onPress={async () => {
                const r = await dialog.prompt({
                  title: 'New return date (SM Projects approves)',
                  fields: [
                    { key: 'd', label: 'New date', type: 'date', required: true },
                    { key: 'r', label: 'Reason', type: 'multiline', required: true },
                  ],
                });
                if (r) await run('request_sample_return_date', { p_sample: s.id, p_new_date: r.d, p_reason: r.r }, 'Request sent');
              }}
            />
          ) : null}
        </Row>
      </Card>
      <Section title="Items">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {data.items.map((i) => (
            <ListRow
              key={i.id}
              title={i.description}
              subtitle={[i.product_code, i.brand, `qty ${i.quantity}${i.quantity_available != null ? ` (available ${i.quantity_available})` : ''}`].filter(Boolean).join(' · ')}
              right={<Text>{fmtMoney(i.total_value, s.currency)}</Text>}
            />
          ))}
        </Card>
      </Section>
      <Attachments entityType="sample" entityId={s.id} kinds={ops ? ['delivery_note', 'sample_doc'] : ['sample_doc']} title="Documents and delivery note" canUpload={mine || ops} allowCamera />
    </Screen>
  );
}
