import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { editShipment, orderOption, rpc } from '@/components/foreign/actions';
import { FoNotes } from '@/components/foreign/Notes';
import { ShipmentRoute, type FoPosition } from '@/components/foreign/ShipmentRoute';
import { StepList } from '@/components/foreign/StepList';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Grid, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section, useWide } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtAmount, fmtDate } from '@/lib/format';
import {
  CURRENCIES,
  FO_KEEPER,
  PAYMENT_KIND,
  route,
  SHORT_STAGES,
  standing,
  todayIso,
  workdays,
  type FoNote,
  type FoOrder,
  type Handover,
  type OrderValues,
  type Payment,
  type Shipment,
  type Step,
  type StepDef,
} from '@/lib/foreignOrders';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** An import order: where it stands, its steps with the working days each took, the shipment, and (for those who see them) the values and payments. */
export default function ForeignOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const keeper = FO_KEEPER.includes(me.role);
  const wide = useWide();
  const { data, error, reload } = useLoad(async () => {
    const o = await supabase.from('fo_orders').select('*').eq('id', id).maybeSingle();
    if (o.error) throw new Error(o.error.message);
    if (!o.data) throw new Error('Import order not found');
    const order = o.data as FoOrder;
    const [h, sib, s, d, v, p, so, hol, nt] = await Promise.all([
      supabase.from('fo_handovers').select('*').eq('id', order.handover_id).single(),
      supabase.from('fo_orders').select('*').eq('handover_id', order.handover_id).order('seq_no'),
      supabase.from('fo_steps').select('*').eq('handover_id', order.handover_id),
      supabase.from('fo_step_defs').select('*').order('seq'),
      supabase.from('fo_order_values').select('*').eq('order_id', id).maybeSingle(),
      supabase.from('fo_payments').select('*').eq('order_id', id).order('paid_on'),
      supabase.from('fo_shipment_orders').select('shipment_id').eq('order_id', id),
      supabase.from('holidays').select('day'),
      supabase.from('fo_notes').select('*').eq('order_id', id).order('occurred_on', { ascending: false }),
    ]);
    const shipIds = ((so.data ?? []) as { shipment_id: string }[]).map((x) => x.shipment_id);
    const positions = shipIds.length ? (((await supabase.from('fo_positions').select('*').in('shipment_id', shipIds)).data ?? []) as FoPosition[]) : [];
    const ships = shipIds.length ? ((await supabase.from('fo_shipments').select('*').in('id', shipIds).order('eta')).data ?? []) as Shipment[] : [];
    // open material orders a new shipment can also carry
    const openOrders = keeper ? ((await supabase.from('fo_orders').select('*').eq('status', 'open').eq('kind', 'material')).data ?? []) as FoOrder[] : [];
    return {
      o: order,
      h: h.data as Handover,
      sib: (sib.data ?? []) as FoOrder[],
      steps: (s.data ?? []) as Step[],
      defs: (d.data ?? []) as StepDef[],
      values: (v.data ?? null) as OrderValues | null,
      payments: (p.data ?? []) as Payment[],
      ships,
      positions,
      openOrders,
      notes: (nt.data ?? []) as FoNote[],
      holidays: new Set(((hol.data ?? []) as { day: string }[]).map((x) => x.day)),
    };
  }, [id, keeper]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { o, h, sib, steps, defs, values, payments, ships, positions, openOrders, notes, holidays } = data;
  const all = route(defs, h, o, steps, sib, holidays);
  const st = standing(all);
  // a service order closes when the service is accepted, not delivered to a location
  const lines = all
    .filter((l) => l.def.scope === 'o')
    .map((l) => (o.kind === 'service' && l.def.key === 'delivered' ? { ...l, def: { ...l.def, label: 'Service accepted – order closed', node: 'Sales · Operations' } } : l));
  const hDone = all.filter((l) => l.def.scope === 'h').every((l) => l.done);
  const open = o.status === 'open' && h.status === 'open';
  const total = workdays(h.received_on, steps.find((s) => s.order_id === o.id && s.step === 'delivered')?.done_on ?? todayIso(), holidays);
  const cur = values?.currency ?? 'USD';

  const addPayment = async () => {
    const r = await dialog.prompt({
      title: 'Record a payment',
      fields: [
        { key: 'kind', label: 'Payment', type: 'select', options: Object.entries(PAYMENT_KIND).map(([value, label]) => ({ value, label })), required: true, initial: o.payment === 'LC' ? 'advance' : 'full' },
        { key: 'amount', label: 'Amount', required: true },
        { key: 'currency', label: 'Currency', type: 'select', options: CURRENCIES, initial: cur },
        { key: 'paid_on', label: 'Paid on', type: 'date', required: true, initial: todayIso() },
        { key: 'ref', label: 'Reference' },
        { key: 'note', label: 'Note' },
      ],
      confirmLabel: 'Record',
    });
    if (r) await dialog.run(async () => { await rpc('fo_add_payment', { p_order: o.id, p: { ...r, amount: r.amount.replace(/,/g, '') } }); await reload(); }, 'Recorded');
  };
  const rounds = async () => {
    const r = await dialog.prompt({ title: 'CI / PL correction rounds', fields: [{ key: 'n', label: 'Rounds so far', initial: String(o.cipl_rounds) }], confirmLabel: 'Save' });
    if (r) await dialog.run(async () => { await rpc('fo_set_cipl_rounds', { p_order: o.id, p_rounds: Number(r.n) }); await reload(); }, 'Saved');
  };
  const cancel = async () => {
    const r = await dialog.prompt({ title: `Cancel ${o.code}`, fields: [{ key: 'reason', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Cancel order', danger: true });
    if (r) await dialog.run(async () => { await rpc('fo_cancel_order', { p_id: o.id, p_reason: r.reason }); await reload(); }, 'Cancelled');
  };
  const newShipment = async () => {
    const sid = await editShipment(dialog, openOrders.map((x) => orderOption(x)), null, [o.id], o.planned_mode);
    if (sid) router.push(`/orders/foreign/shipment/${sid}`);
  };

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: o.code ?? 'Import order' }} />
      <TestingBanner what="Foreign orders" always />
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <Muted>{`${o.code} · ${o.kind === 'service' ? 'Service' : 'Material'} · hand-over ${h.code}, order ${o.seq_no} of ${sib.length}`}</Muted>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.ink }}>{`${o.title} – ${h.project_name}`}</Text>
          <Row gap={6} wrap style={{ marginTop: 4 }}>
            {o.kind === 'material' ? <Pill label={o.incoterm ?? ''} tone={colors.blue} /> : <Pill label="Service" tone={colors.blue} />}
            <Pill label={o.payment} tone={colors.blue} />
            {o.dangerous ? <Pill label="⚠ Dangerous goods" tone={colors.red} solid /> : null}
            {o.duty ? <Pill label={o.duty === 'free' ? 'Duty free' : 'Duty paid'} tone={colors.amber} /> : null}
            {o.status !== 'open' ? <Pill label={o.status === 'delivered' ? (o.kind === 'service' ? 'Completed' : 'Delivered') : 'Cancelled'} tone={o.status === 'delivered' ? colors.green : colors.grey} solid /> : null}
          </Row>
        </View>
        {keeper && open ? (
          <Row gap={8} wrap>
            <Button small variant="ghost" title="Cancel" onPress={cancel} />
            <Button small variant="secondary" title="Edit" onPress={() => router.push({ pathname: '/orders/foreign/order-form', params: { id: o.id } })} />
          </Row>
        ) : null}
      </Row>
      {o.cancel_reason ? <Notice tone={colors.grey}>{`Cancelled: ${o.cancel_reason}`}</Notice> : null}
      {o.dangerous ? <Notice tone={colors.red}>{`⚠ DANGEROUS GOODS – ${o.dg_details ?? ''}. Handle with the dangerous-goods documents and declarations at every stage.`}</Notice> : null}
      {keeper && o.kind === 'material' && o.dangerous == null && o.status === 'open' ? <Notice tone={colors.amber}>Dangerous goods not set – edit the order and choose Yes or No.</Notice> : null}

      {/* the nine stages */}
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {SHORT_STAGES.map((s, i) => {
          const n = i + 1;
          const tone = n < st.stage ? colors.green : n === st.stage ? (st.late ? colors.red : colors.blue) : colors.line;
          return (
            <View key={s} style={{ flex: 1, gap: 4 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: tone }} />
              {wide ? <Text style={{ fontSize: 10.5, textAlign: 'center', color: n === st.stage ? tone : colors.muted, fontWeight: n === st.stage ? '700' : '400' }}>{s}</Text> : null}
            </View>
          );
        })}
      </View>
      {!wide && st.stage <= 9 ? <Text style={{ fontWeight: '700', color: st.late ? colors.red : colors.blue }}>{`Stage ${st.stage} of 9 · ${SHORT_STAGES[st.stage - 1]}`}</Text> : null}
      <Grid min={200}>
        <KeyValue label="Now with" value={o.status === 'open' ? st.with || '—' : '—'} />
        <KeyValue label="Vendor" value={o.vendor} />
        <KeyValue label="Required at site" value={o.required_on ? fmtDate(o.required_on) : '—'} />
        <KeyValue label={o.status === 'delivered' ? 'Hand-over to delivery' : 'Since hand-over'} value={total != null ? `${total} working days` : '—'} />
        <KeyValue label="SAP project / PR nos." value={[h.sap_project_no, o.pr_nos].filter(Boolean).join(' · ') || '—'} />
        <KeyValue label="DIC approval" value={o.value_usd_note ?? (o.dic_required === false ? 'Not needed' : 'Needed')} />
        <KeyValue label="PO / LC" value={[o.po_no, o.lc_no].filter(Boolean).join(' · ') || '—'} />
        <KeyValue label="Deliver to" value={h.delivery_location} />
        {o.kind === 'material' ? (
          <KeyValue label="CI / PL corrections" value={<Row gap={6} style={{ alignItems: 'center' }}><Text style={{ color: o.cipl_rounds > 2 ? colors.red : colors.text }}>{String(o.cipl_rounds)}</Text>{keeper && open ? <Button small variant="ghost" title="Change" onPress={rounds} /> : null}</Row>} />
        ) : null}
      </Grid>
      {!hDone ? (
        <Notice tone={colors.amber}>{`The hand-over's own steps (stages 1–3) are not all recorded yet.`}</Notice>
      ) : null}
      <Button small variant="ghost" title={`Hand-over ${h.code} – client, SAP project, delivery location ›`} onPress={() => router.push(`/orders/foreign/ho/${h.id}`)} />

      {o.kind === 'material' ? (
        <Section title="Shipment" right={keeper && open ? <Button small variant="secondary" title="+ Shipment" onPress={newShipment} /> : null}>
          {ships.length ? (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {ships.map((s) => (
                <ListRow
                  key={s.id}
                  title={`${s.code} · ${s.vessel_flight ?? s.mode}${s.voyage ? ` ${s.voyage}` : ''}`}
                  subtitle={`${[s.pol, s.via, s.pod].filter(Boolean).join(' → ') || 'Route not entered'}\nETD ${fmtDate(s.etd)} · ${s.arrived_on ? `arrived ${fmtDate(s.arrived_on)}` : `ETA ${fmtDate(s.eta)}`}${s.last_checked_on ? ` · checked ${fmtDate(s.last_checked_on)}` : ''}`}
                  right={<Pill label={s.arrived_on ? 'Arrived' : s.etd && s.etd <= todayIso() ? 'In transit' : 'Booked'} tone={s.arrived_on ? colors.green : colors.blue} />}
                  wrapRight
                  onPress={() => router.push(`/orders/foreign/shipment/${s.id}`)}
                />
              ))}
            </Card>
          ) : (
            <Muted>No shipment yet. Add it when the forwarder confirms the booking; one shipment can carry several import orders.</Muted>
          )}
          {ships.length ? (
            <ShipmentRoute
              shipment={ships[ships.length - 1]}
              orders={[o]}
              site={h.delivery_location}
              positions={positions.filter((x) => x.shipment_id === ships[ships.length - 1].id)}
              keeper={keeper && open}
              onChange={reload}
            />
          ) : null}
        </Section>
      ) : null}

      <Section title="Steps">
        <StepList lines={lines} keeper={keeper && open} handoverId={h.id} orderId={o.id} people={people} onChange={reload} skip={ships.length ? ['shipped', 'arrived'] : []} />
        {ships.length && keeper ? <Muted>Shipped and arrival are recorded on the shipment, for every order it carries.</Muted> : null}
      </Section>

      <FoNotes notes={notes} lines={lines} handoverId={h.id} orderId={o.id} keeper={keeper && o.status !== 'cancelled'} people={people} onChange={reload} />

      {values || keeper ? (
        <Section title="Values and payments" right={keeper && o.status !== 'cancelled' ? <Button small variant="secondary" title="+ Payment" onPress={addPayment} /> : null}>
          <Card>
            <Grid min={180}>
              <KeyValue label="PI value" value={values?.pi_value != null ? `${cur} ${fmtAmount(values.pi_value)}` : '—'} />
              {o.payment === 'LC' ? <KeyValue label="LC amount" value={values?.lc_amount != null ? `${cur} ${fmtAmount(values.lc_amount)}` : '—'} /> : null}
              {o.duty === 'paid' ? <KeyValue label="Duty" value={values?.duty_lkr != null ? `LKR ${fmtAmount(values.duty_lkr)}` : '—'} /> : null}
              <KeyValue label="Paid so far" value={payments.length ? payments.map((p) => `${p.currency} ${fmtAmount(p.amount)}`).join(' + ') : '—'} />
            </Grid>
            {payments.map((p) => (
              <Row key={p.id} gap={8} style={{ alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6 }}>
                <Muted>{`${fmtDate(p.paid_on)} · ${PAYMENT_KIND[p.kind]} · ${p.currency} ${fmtAmount(p.amount)}${p.ref ? ` · ${p.ref}` : ''}${p.note ? ` · ${p.note}` : ''}`}</Muted>
                {keeper ? (
                  <Button small variant="ghost" title="Remove" onPress={async () => { if (await dialog.confirm('Remove this payment?')) await dialog.run(async () => { await rpc('fo_remove_payment', { p_id: p.id }); await reload(); }, 'Removed'); }} />
                ) : null}
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}
      {o.notes ? <Muted>{o.notes}</Muted> : null}
    </Screen>
  );
}
