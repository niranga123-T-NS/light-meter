import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { editShipment, orderOption, rpc } from '@/components/foreign/actions';
import { FoNotes } from '@/components/foreign/Notes';
import { RouteMap } from '@/components/foreign/RouteMap';
import { ShipmentRoute, type FoPosition } from '@/components/foreign/ShipmentRoute';
import { StepList } from '@/components/foreign/StepList';
import { OrderDates } from '@/components/OrderDates';
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
  expectedSite,
  type DateChange,
  type FoNote,
  type FoOrder,
  type Handover,
  type OrderValues,
  type Payment,
  type Shipment,
  type FlightLeg,
  multiLegOpen,
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
    const [h, sib, s, d, v, p, so, hol, nt, dc] = await Promise.all([
      supabase.from('fo_handovers').select('*').eq('id', order.handover_id).single(),
      supabase.from('fo_orders').select('*').eq('handover_id', order.handover_id).order('seq_no'),
      supabase.from('fo_steps').select('*').eq('handover_id', order.handover_id),
      supabase.from('fo_step_defs').select('*').order('seq'),
      supabase.from('fo_order_values').select('*').eq('order_id', id).maybeSingle(),
      supabase.from('fo_payments').select('*').eq('order_id', id).order('paid_on'),
      supabase.from('fo_shipment_orders').select('shipment_id').eq('order_id', id),
      supabase.from('holidays').select('day'),
      supabase.from('fo_notes').select('*').eq('order_id', id).order('occurred_on', { ascending: false }),
      supabase.from('order_date_changes').select('*').eq('module', 'fo').eq('order_id', id),
    ]);
    const shipIds = ((so.data ?? []) as { shipment_id: string }[]).map((x) => x.shipment_id);
    const positions = shipIds.length ? (((await supabase.from('fo_positions').select('*').in('shipment_id', shipIds)).data ?? []) as FoPosition[]) : [];
    const ships = shipIds.length ? ((await supabase.from('fo_shipments').select('*').in('id', shipIds).order('eta')).data ?? []) as Shipment[] : [];
    const airLine = ships.some((x) => x.mode === 'air') ? (((await supabase.rpc('fo_air_lines', { p_orders: [id] })).data ?? []) as { line: string | null }[]).map((x) => x.line).filter(Boolean).join(' | ') : '';
    const legs = ships.some((x) => x.multi_leg) ? (((await supabase.from('fo_flight_legs').select('*').in('shipment_id', shipIds)).data ?? []) as FlightLeg[]) : [];
    // open material orders a new shipment can also carry
    const openOrders = keeper ? ((await supabase.from('fo_orders').select('*').eq('status', 'open').eq('kind', 'material')).data ?? []) as FoOrder[] : [];
    return {
      airLine,
      legs,
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
      dateChanges: (dc.data ?? []) as DateChange[],
      holidays: new Set(((hol.data ?? []) as { day: string }[]).map((x) => x.day)),
    };
  }, [id, keeper]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { o, h, sib, steps, defs, values, payments, ships, positions, openOrders, notes, holidays, dateChanges, legs, airLine } = data;
  const shipEta = ships.length ? ships[ships.length - 1].eta : null;
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
  const ciplDone = steps.some((x) => x.order_id === o.id && x.step === 'cipl_confirmed');
  const joinShipment = async () => {
    const { data: open } = await supabase.from('fo_shipments').select('id, code, mode, vessel_flight, eta').is('arrived_on', null).order('created_at', { ascending: false });
    const list = (open ?? []) as { id: string; code: string; mode: string; vessel_flight: string | null; eta: string | null }[];
    if (!list.length) return dialog.toast('No shipment waiting – book a new one', 'error');
    const r = await dialog.prompt({
      title: 'Add to an existing shipment',
      fields: [{ key: 'sid', label: 'Shipment', type: 'select', required: true, options: list.map((x) => ({ value: x.id, label: `${x.code} · ${x.vessel_flight ?? x.mode}${x.eta ? ` · ETA ${fmtDate(x.eta)}` : ''}` })) }],
      confirmLabel: 'Add',
    });
    if (r) await dialog.run(async () => { await rpc('fo_add_to_shipment', { p_shipment: r.sid, p_order: o.id }); await reload(); }, 'Added to the shipment');
  };
  const newShipment = async () => {
    const sid = await editShipment(dialog, openOrders.map((x) => orderOption(x)), null, [o.id], o.planned_mode, o.loading_port);
    if (sid) router.push(`/orders/foreign/shipment/${sid}`);
  };

  // the shipment and its route map, inside stage 7 – booked once the CI and PL are confirmed
  const shipmentPanel = (
    <>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>Shipment</Text>
        {keeper && open ? (
          <Row wrap gap={8}>
            <Button small variant="secondary" title="Add to an existing shipment" onPress={joinShipment} disabled={!ciplDone} />
            {!ships.length ? <Button small title="+ Book shipment" onPress={newShipment} disabled={!ciplDone} /> : null}
          </Row>
        ) : null}
      </Row>
      {airLine ? <Text style={{ color: colors.ink, fontWeight: '600' }}>{airLine}</Text> : null}
      {ships
        .filter((sh) => sh.mode === 'air' && sh.multi_leg && !sh.arrived_on)
        .map((sh) => (
          <Notice key={`ml-${sh.id}`} tone={colors.amber}>
            {multiLegOpen(sh, legs.filter((l) => l.shipment_id === sh.id))
              ? keeper
                ? `⚠ ${sh.code}: multi-flight warning – please check. The flight to Colombo is not entered yet; check the AWB on the airline site and add the next flight.`
                : `✈ ${sh.code}: transshipment possible – the onward flight is not confirmed yet. Contact Ops for updates.`
              : keeper
                ? `${sh.code}: more than one flight – check the AWB on the airline site at each transit.`
                : `✈ ${sh.code}: transshipment – the cargo changes flights on the way. Contact Ops for updates.`}
          </Notice>
        ))}
      {!ciplDone && !ships.length ? <Muted>Booked once the commercial invoice and packing list are confirmed (stage 6).</Muted> : null}
      {ships.map((sh) => (
        <ListRow
          key={sh.id}
          title={`${sh.code} · ${sh.vessel_flight ?? sh.mode}${sh.voyage ? ` ${sh.voyage}` : ''}`}
          subtitle={`${[sh.pol, sh.via, sh.pod].filter(Boolean).join(' → ') || 'Route not entered'}\nETD ${fmtDate(sh.etd)} · ${sh.arrived_on ? `arrived ${fmtDate(sh.arrived_on)}` : `ETA ${fmtDate(sh.eta)}`}${sh.last_checked_on ? ` · checked ${fmtDate(sh.last_checked_on)}` : ''}`}
          right={<Pill label={sh.arrived_on ? 'Arrived' : sh.etd && sh.etd <= todayIso() ? 'In transit' : 'Booked'} tone={sh.arrived_on ? colors.green : colors.blue} />}
          wrapRight
          onPress={() => router.push(`/orders/foreign/shipment/${sh.id}`)}
        />
      ))}
      {ships.length ? (
        <>
          <ShipmentRoute
            shipment={ships[ships.length - 1]}
            orders={[o]}
            site={h.delivery_location}
            positions={positions.filter((x) => x.shipment_id === ships[ships.length - 1].id)}
            keeper={keeper && open}
            onChange={reload}
          />
          {keeper ? <Muted>Sailed and arrival are recorded on the shipment page, for every order it carries.</Muted> : null}
        </>
      ) : o.factory_location || o.loading_port ? (
        // before the shipment: the planned route from the order (factory → loading port → Sri Lanka)
        <RouteMap
          mode={o.planned_mode ?? 'sea'}
          factories={[{ label: `${o.code} ${o.vendor}`, location: o.factory_location, lat: o.factory_lat, lng: o.factory_lng, inland: o.incoterm === 'CIF' ? 'manufacturer' : 'forwarder' }]}
          pol={o.loading_port ?? null}
          vias={[]}
          pod={null}
          site={h.delivery_location}
          arrived={false}
          etd={null}
          eta={null}
          positions={[]}
          height={300}
        />
      ) : null}
    </>
  );

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: o.code ?? 'Import order' }} />
      <TestingBanner what="Foreign orders" always />
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <Muted>{`${o.code} · ${o.kind === 'service' ? 'Service' : 'Material'} · import request ${h.code}, order ${o.seq_no} of ${sib.length}`}</Muted>
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
        <KeyValue label="Vendor" value={o.mfr_address ? `${o.vendor}\n${o.mfr_address}` : o.vendor} />
        {o.kind === 'material' ? <KeyValue label={o.planned_mode === 'air' ? 'Airport of loading' : 'Port of loading'} value={o.loading_port ?? '—'} /> : null}
        <KeyValue label="Required at site" value={o.required_on ? fmtDate(o.required_on) : '—'} />
        <KeyValue label={o.status === 'delivered' ? 'Import request to delivery' : 'Since import request'} value={total != null ? `${total} working days` : '—'} />
        <KeyValue label="SAP project / PR nos." value={[h.sap_project_no, o.pr_nos].filter(Boolean).join(' · ') || '—'} />
        <KeyValue label="DIC approval" value={o.value_usd_note ?? (o.dic_required === false ? 'Not needed' : 'Needed')} />
        <KeyValue label="PO / LC" value={[o.po_no, o.lc_no].filter(Boolean).join(' · ') || '—'} />
        <KeyValue label="Deliver to" value={h.delivery_location} />
        {o.kind === 'material' ? (
          <KeyValue label="CI / PL corrections" value={<Row gap={6} style={{ alignItems: 'center' }}><Text style={{ color: o.cipl_rounds > 2 ? colors.red : colors.text }}>{String(o.cipl_rounds)}</Text>{keeper && open ? <Button small variant="ghost" title="Change" onPress={rounds} /> : null}</Row>} />
        ) : null}
      </Grid>
      {o.kind === 'material' ? (
        <OrderDates
          module="fo"
          orderId={o.id}
          label="Expected ready at the factory"
          expected={o.expected_ready}
          committed={o.committed_ready}
          required={o.required_on}
          site={expectedSite(o, shipEta)}
          siteNote={shipEta ? 'Shipment ETA + clearing and delivery' : o.expected_ready ? `Estimate: ready date + ${o.planned_mode === 'air' ? 'air' : o.planned_mode === 'courier' ? 'courier' : 'sea'} transit + clearing` : undefined}
          changes={dateChanges}
          keeper={keeper && open}
          holidays={holidays}
          people={people}
          onChange={reload}
        />
      ) : null}
      {!hDone ? (
        <Notice tone={colors.amber}>{`The import request's own steps (stages 1–3) are not all recorded yet.`}</Notice>
      ) : null}
      <Button small variant="ghost" title={`Import request ${h.code} – client, SAP project, delivery location ›`} onPress={() => router.push(`/orders/foreign/ho/${h.id}`)} />

      <Section title="Steps">
        <StepList
          lines={lines}
          keeper={keeper && open}
          handoverId={h.id}
          orderId={o.id}
          people={people}
          onChange={reload}
          skip={ships.length ? ['shipped', 'arrived'] : []}
          extra={o.kind === 'material' ? { 7: shipmentPanel } : undefined}
        />
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
