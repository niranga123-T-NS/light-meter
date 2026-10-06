import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { mrTone } from '@/components/exec/MaterialRows';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Field, KeyValue, ListRow, Loading, Muted, Notice, NumberField, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { MR_STATUS, type MaterialRequest, type MrLine } from '@/lib/execution';
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
  const { data, error, reload } = useLoad(async () => {
    const { data: m, error: e } = await supabase.from('material_requests').select('*, exec_projects(name, code)').eq('id', id).single();
    if (e) throw new Error(e.message);
    const { data: l } = await supabase.from('material_request_lines').select('*').eq('mr_id', id);
    return { m: m as MaterialRequest & { exec_projects: { name: string; code: string } | null }, lines: (l ?? []) as MrLine[] };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { m, lines } = data;
  const canDecide = (m.status === 'submitted' && me.role === 'senior_elec_engineer') || (m.status === 'pending_smp' && me.role === 'sm_projects');
  const canOrder = m.status === 'approved' && me.role === 'operations_exec';
  const canReceive = ['ordered', 'part_received'].includes(m.status) && me.role !== 'gm' && me.role !== 'sm_projects';

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
      await rpc('receive_material', { p_id: m.id, p_lines: Object.entries(recv).map(([line_id, qty]) => ({ line_id, qty: qty ?? 0 })), p_note: recvNote || null });
      setRecv(null);
      setRecvNote('');
      await reload();
    }, 'Received into the site store');
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
          {canDecide ? <Button title="Approve" onPress={() => decide(true)} /> : null}
          {canDecide ? <Button variant="secondary" title="Reject" onPress={() => decide(false)} /> : null}
          {canOrder ? <Button title="Record the order" onPress={order} /> : null}
          {canReceive && !recv ? <Button title="Record a delivery" onPress={() => setRecv(Object.fromEntries(lines.map((l) => [l.id, null])))} /> : null}
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
            <Field label="Shortages / damages" multiline value={recvNote} onChangeText={setRecvNote} />
            <Muted>A note on shortages or damage is sent to Operations and the Senior Electrical Engineer.</Muted>
            <Row gap={8} style={{ justifyContent: 'flex-end' }}>
              <Button variant="secondary" title="Cancel" onPress={() => setRecv(null)} />
              <Button title="Receive" onPress={receive} />
            </Row>
          </Card>
        ) : null}
      </Section>
      <Attachments entityType="material_request" entityId={m.id} kinds={['mr_doc', 'grn_photo']} title="Delivery notes and photos" allowCamera canUpload={me.role !== 'gm'} />
    </Screen>
  );
}
