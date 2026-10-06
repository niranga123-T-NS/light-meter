import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { mrTone } from '@/components/exec/MaterialRows';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Field, KeyValue, ListRow, Loading, Muted, Notice, NumberField, Pill, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { MR_STATUS, type ExecMember, type MaterialReceipt, type MaterialRequest, type MrLine } from '@/lib/execution';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** One material request: approvals, the order (PO), and deliveries received into the site store. */
export default function MaterialScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [recv, setRecv] = useState<Record<string, number | null> | null>(null);
  const [recvNote, setRecvNote] = useState('');
  const [recvSup, setRecvSup] = useState<string | null>(null);
  const { data, error, reload } = useLoad(async () => {
    const { data: m, error: e } = await supabase.from('material_requests').select('*, exec_projects(name, code)').eq('id', id).single();
    if (e) throw new Error(e.message);
    const mr = m as MaterialRequest & { exec_projects: { name: string; code: string } | null };
    const [l, rc, mem] = await Promise.all([
      supabase.from('material_request_lines').select('*').eq('mr_id', id),
      supabase.from('material_receipts').select('*').eq('mr_id', id).order('recorded_at', { ascending: false }),
      supabase.from('exec_members').select('*').eq('exec_project_id', mr.exec_project_id).eq('active', true),
    ]);
    return { m: mr, lines: (l.data ?? []) as MrLine[], receipts: (rc.data ?? []) as MaterialReceipt[], members: (mem.data ?? []) as ExecMember[] };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { m, lines, receipts, members } = data;
  const isAe = me.role === 'assistant_engineer' && members.some((x) => x.user_id === me.id);
  const isSub = me.role === 'sub_supervisor';
  const supervisors = members.filter((x) => x.member_role === 'sub_supervisor');
  const pendingReceipt = receipts.find((r) => r.status === 'pending');
  const canAeReview = m.status === 'ae_review' && (isAe || me.role === 'senior_elec_engineer');
  const canDecide = (m.status === 'submitted' && me.role === 'senior_elec_engineer') || (m.status === 'pending_smp' && me.role === 'sm_projects');
  const canOrder = m.status === 'approved' && me.role === 'operations_exec';
  const canReceive = ['ordered', 'part_received'].includes(m.status) && !pendingReceipt && (isAe || isSub || me.role === 'senior_elec_engineer' || me.role === 'operations_exec');
  // Who acknowledges a pending delivery: the AE side (if not yet) and the named supervisor (if not yet)
  const canAck = (r: MaterialReceipt) =>
    r.status === 'pending' && ((!r.ae_ack_at && (isAe || me.role === 'senior_elec_engineer')) || (!r.sub_ack_at && r.supervisor_id === me.id));

  const aeReview = async (forward: boolean) => {
    const res = await dialog.prompt({
      title: forward ? 'Forward to the Senior Electrical Engineer' : 'Return to the supervisor',
      fields: forward
        ? [
            { key: 'v', label: 'Estimated value (LKR)', required: true },
            { key: 'n', label: 'Note', type: 'multiline' },
          ]
        : [{ key: 'n', label: 'Reason', type: 'multiline', required: true }],
      confirmLabel: forward ? 'Forward' : 'Return',
      danger: !forward,
    });
    if (res)
      await dialog.run(async () => {
        await rpc('ae_review_material_request', { p_id: m.id, p_forward: forward, p_note: res.n || null, p_est_value: res.v ? Number(res.v.replace(/,/g, '')) : null });
        await reload();
      }, forward ? 'Sent to the Senior Electrical Engineer' : 'Returned');
  };
  const ack = async (r: MaterialReceipt, ok: boolean) => {
    const res = ok
      ? await dialog.confirm('Acknowledge the delivery', r.lines.map((x) => `${x.item}: ${fmtNumber(x.qty)} ${x.unit}`).join('\n'), { confirmLabel: 'Acknowledge' })
      : await dialog.prompt({ title: 'Dispute the delivery', fields: [{ key: 'n', label: 'What is wrong (quantity, damage…)', type: 'multiline', required: true }], confirmLabel: 'Dispute', danger: true });
    if (!res) return;
    await dialog.run(async () => {
      const out = await rpc<string>('acknowledge_delivery', { p_receipt: r.id, p_ok: ok, p_note: typeof res === 'object' ? res.n : null });
      await reload();
      if (out === 'accepted') dialog.toast('Acknowledged by both – in the site store');
    }, ok ? 'Acknowledged' : 'Disputed – the SEE and Operations are told');
  };

  const decide = async (ok: boolean) => {
    const res = await dialog.prompt({ title: ok ? 'Approve' : 'Reject', fields: [{ key: 'n', label: ok ? 'Note' : 'Reason', type: 'multiline', required: !ok }], confirmLabel: ok ? 'Approve' : 'Reject', danger: !ok });
    if (res) await dialog.run(async () => { await rpc('decide_material_request', { p_id: m.id, p_approve: ok, p_note: res.n || null }); await reload(); }, ok ? 'Approved' : 'Rejected');
  };
  const order = async () => {
    const res = await dialog.prompt({
      title: 'Order placed',
      fields: [
        { key: 'po', label: 'PO number', required: true },
        { key: 's', label: 'Supplier' },
        { key: 'd', label: 'Expected delivery', type: 'date', required: true, initial: m.required_date },
      ],
      confirmLabel: 'Save',
    });
    if (res) await dialog.run(async () => { await rpc('order_material_request', { p_id: m.id, p_po: res.po, p_supplier: res.s || null, p_expected: res.d }); await reload(); }, 'The site is told');
  };
  const receive = async () => {
    if (!recv) return;
    await dialog.run(async () => {
      await rpc('receive_material', {
        p_id: m.id,
        p_lines: Object.entries(recv).map(([line_id, qty]) => ({ line_id, qty: qty ?? 0 })),
        p_note: recvNote || null,
        p_supervisor: isSub ? null : recvSup,
      });
      setRecv(null);
      setRecvNote('');
      await reload();
    }, isSub ? 'Recorded – the Assistant Engineer acknowledges it' : recvSup ? 'Recorded – the supervisor acknowledges it' : 'Received into the site store');
  };

  return (
    <Screen maxWidth={860} onRefresh={reload}>
      <Stack.Screen options={{ title: m.code }} />
      <TestingBanner what="Materials and stores" />
      <Card style={{ borderLeftWidth: 4, borderLeftColor: mrTone(m.status) }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{`${m.code} · ${m.exec_projects?.name ?? ''}`}</Text>
          <Pill label={MR_STATUS[m.status]} tone={mrTone(m.status)} solid />
        </Row>
        <KeyValue label="Needed on site by" value={fmtDate(m.required_date)} />
        {m.purpose ? <KeyValue label="For" value={m.purpose} /> : null}
        {m.est_value_lkr ? <KeyValue label="Estimated value" value={fmtMoney(m.est_value_lkr, 'LKR')} /> : null}
        <KeyValue label="Requested by" value={`${people[m.requested_by]?.full_name ?? ''} · ${fmtDateTime(m.requested_at)}`} />
        {m.po_no ? <KeyValue label="Order" value={`PO ${m.po_no}${m.supplier ? ` · ${m.supplier}` : ''} · expected ${fmtDate(m.expected_date)}`} /> : null}
        {m.decision_note ? <Notice tone={m.status === 'rejected' ? colors.red : colors.blue}>{m.decision_note}</Notice> : null}
        {m.expected_date && ['ordered', 'part_received'].includes(m.status) && m.expected_date < todayISO() ? <Notice tone={colors.red}>Delivery is late</Notice> : null}
        <Row wrap gap={6} style={{ marginTop: 8 }}>
          {canAeReview ? <Button title="Forward to SEE" onPress={() => aeReview(true)} /> : null}
          {canAeReview ? <Button variant="secondary" title="Return" onPress={() => aeReview(false)} /> : null}
          {canDecide ? <Button title="Approve" onPress={() => decide(true)} /> : null}
          {canDecide ? <Button variant="secondary" title="Reject" onPress={() => decide(false)} /> : null}
          {canOrder ? <Button title="Record the order" onPress={order} /> : null}
          {canReceive && !recv ? (
            <Button
              title="Record a delivery"
              onPress={() => {
                setRecv(Object.fromEntries(lines.map((l) => [l.id, null])));
                setRecvSup(supervisors.some((x) => x.user_id === m.requested_by) ? m.requested_by : (supervisors[0]?.user_id ?? null));
              }}
            />
          ) : null}
        </Row>
      </Card>
      <Section title="Items">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {lines.map((l) => (
            <ListRow
              key={l.id}
              wrapRight
              title={l.item}
              subtitle={`${fmtNumber(l.qty)} ${l.unit} requested · ${fmtNumber(l.received_qty)} received`}
              right={
                recv ? (
                  <NumberField label="Received now" value={recv[l.id] ?? null} onChange={(v) => setRecv((s) => ({ ...(s ?? {}), [l.id]: v }))} />
                ) : (
                  <Pill label={l.received_qty >= l.qty ? 'Complete' : 'Open'} tone={l.received_qty >= l.qty ? colors.green : colors.amber} />
                )
              }
            />
          ))}
        </Card>
        {recv ? (
          <Card style={{ marginTop: 8 }}>
            {!isSub && supervisors.length ? (
              <Select
                label="Acknowledged by subcontractor supervisor"
                value={recvSup ?? ''}
                onChange={(v) => setRecvSup(v || null)}
                options={[{ value: '', label: 'No subcontractor involved' }, ...supervisors.map((x) => ({ value: x.user_id, label: people[x.user_id]?.full_name ?? '—' }))]}
              />
            ) : null}
            <Field label="Shortages / damages" multiline value={recvNote} onChangeText={setRecvNote} />
            <Muted>
              {isSub
                ? 'The Assistant Engineer acknowledges it; then it goes into the site store.'
                : recvSup
                  ? 'The supervisor acknowledges it; then it goes into the site store.'
                  : 'It goes into the site store now.'}{' '}
              A note on shortages or damage is sent to Operations and the Senior Electrical Engineer.
            </Muted>
            <Row gap={8} style={{ justifyContent: 'flex-end' }}>
              <Button variant="secondary" title="Cancel" onPress={() => setRecv(null)} />
              <Button title="Receive" onPress={receive} />
            </Row>
          </Card>
        ) : null}
      </Section>
      {receipts.length ? (
        <Section title={`Deliveries (${receipts.length})`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {receipts.map((r) => (
              <ListRow
                key={r.id}
                wrapRight
                highlight={r.status === 'pending' ? colors.amber : r.status === 'disputed' ? colors.red : undefined}
                title={r.lines.map((x) => `${x.item}: ${fmtNumber(x.qty)} ${x.unit}`).join(' · ')}
                subtitle={[
                  `recorded by ${people[r.recorded_by]?.full_name ?? ''} · ${fmtDateTime(r.recorded_at)}`,
                  r.ae_ack_at ? `engineer ✓ ${people[r.ae_ack_by ?? '']?.full_name ?? ''}` : 'engineer to acknowledge',
                  r.supervisor_id ? (r.sub_ack_at ? `supervisor ✓ ${people[r.supervisor_id]?.full_name ?? ''}` : `${people[r.supervisor_id]?.full_name ?? 'supervisor'} to acknowledge`) : null,
                  r.note,
                  r.dispute_note ? `disputed by ${people[r.dispute_by ?? '']?.full_name ?? ''}: ${r.dispute_note}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  <Row gap={4} wrap>
                    <Pill
                      label={r.status === 'accepted' ? 'In the store' : r.status === 'disputed' ? 'Disputed' : 'Waiting acknowledgement'}
                      tone={r.status === 'accepted' ? colors.green : r.status === 'disputed' ? colors.red : colors.amber}
                    />
                    {canAck(r) ? <Button small title="Acknowledge" onPress={() => ack(r, true)} /> : null}
                    {canAck(r) ? <Button small variant="secondary" title="Dispute" onPress={() => ack(r, false)} /> : null}
                  </Row>
                }
              />
            ))}
          </Card>
        </Section>
      ) : null}
      <Attachments entityType="material_request" entityId={m.id} kinds={['mr_doc', 'grn_photo']} title="Delivery notes and photos" allowCamera canUpload={me.role !== 'gm'} />
    </Screen>
  );
}
