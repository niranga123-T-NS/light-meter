import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking, Platform, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { editShipment, orderOption, rpc } from '@/components/foreign/actions';
import { ShipmentRoute, type FoPosition } from '@/components/foreign/ShipmentRoute';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Grid, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { awbTracking, CARGO_STATUS, FLIGHT_STATUS, FO_KEEPER, isDestination, multiLegOpen, todayIso, type FlightLeg, type FoOrder, type Handover, type Shipment } from '@/lib/foreignOrders';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** A shipment (B/L or AWB): the booking, the route with ETD / ETA, the ETA history, and every import order it carries. */
export default function ShipmentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const keeper = FO_KEEPER.includes(me.role);
  const { data, error, reload } = useLoad(async () => {
    const [s, so, log, pos, lg] = await Promise.all([
      supabase.from('fo_shipments').select('*').eq('id', id).maybeSingle(),
      supabase.from('fo_shipment_orders').select('order_id').eq('shipment_id', id),
      supabase.from('fo_eta_log').select('*').eq('shipment_id', id).order('changed_at', { ascending: false }),
      supabase.from('fo_positions').select('*').eq('shipment_id', id),
      supabase.from('fo_flight_legs').select('*').eq('shipment_id', id).order('seq'),
    ]);
    if (s.error) throw new Error(s.error.message);
    if (!s.data) throw new Error('Shipment not found');
    const ids = ((so.data ?? []) as { order_id: string }[]).map((x) => x.order_id);
    const orders = ids.length ? (((await supabase.from('fo_orders').select('*').in('id', ids)).data ?? []) as FoOrder[]) : [];
    const hos = orders.length ? (((await supabase.from('fo_handovers').select('*').in('id', [...new Set(orders.map((o) => o.handover_id))])).data ?? []) as Handover[]) : [];
    const openOrders = keeper ? (((await supabase.from('fo_orders').select('*').eq('kind', 'material').neq('status', 'cancelled')).data ?? []) as FoOrder[]) : [];
    return { s: s.data as Shipment, orders, hos, openOrders, positions: (pos.data ?? []) as FoPosition[], legs: (lg.data ?? []) as FlightLeg[], log: (log.data ?? []) as { id: string; eta: string | null; note: string | null; changed_at: string }[] };
  }, [id, keeper]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { s, orders, hos, openOrders, positions, log, legs } = data;
  const multiOpen = multiLegOpen(s, legs);
  const trk = awbTracking(s.bl_awb);
  const ho = (o: FoOrder) => hos.find((h) => h.id === o.handover_id);
  const sailed = !!s.etd && s.etd <= todayIso();

  const edit = async () => {
    const opts = [...openOrders.filter((o) => o.status === 'open' || orders.some((x) => x.id === o.id))].map((o) => orderOption(o));
    if (await editShipment(dialog, opts, s, orders.map((o) => o.id))) await reload();
  };
  const ship = async () => {
    const r = await dialog.prompt({
      title: 'Sailed / departed',
      message: 'Records "Shipped" on every order on this shipment and tells the sales person and the SEE, with the ETA.',
      fields: [{ key: 'date', label: 'Departed on', type: 'date', required: true, initial: s.etd ?? todayIso() }],
      confirmLabel: 'Record',
    });
    if (r) await dialog.run(async () => { await rpc('fo_ship', { p_shipment: s.id, p_date: r.date }); await reload(); }, 'Recorded');
  };
  const arrive = async () => {
    const r = await dialog.prompt({
      title: 'Arrival notice',
      message: 'Records the arrival on every order on this shipment; clearing starts and Sales is told.',
      fields: [{ key: 'date', label: 'Arrived on', type: 'date', required: true, initial: todayIso() }],
      confirmLabel: 'Record',
    });
    if (r) await dialog.run(async () => { await rpc('fo_arrive', { p_shipment: s.id, p_date: r.date }); await reload(); }, 'Recorded');
  };
  const check = async () => {
    const r = await dialog.prompt({
      title: 'Tracking checked',
      message: 'Checked online, or heard from Logistics. Change the ETA with Edit if it moved.',
      fields: [{ key: 'note', label: 'What it shows', type: 'multiline', initial: s.last_check_note ?? '' }],
      confirmLabel: 'Save',
    });
    if (r) await dialog.run(async () => { await rpc('fo_check_shipment', { p_shipment: s.id, p_note: r.note }); await reload(); }, 'Saved');
  };

  // more than one flight: the next flights (entered when known), the airline's AWB tracking, what it shows
  const saveLeg = async (l?: FlightLeg) => {
    const last = legs[legs.length - 1];
    const r = await dialog.prompt({
      title: l ? `Flight ${l.seq} – change` : `Next flight (flight ${legs.length + 2})`,
      message: l ? 'A changed flight (rebooked by the airline or the forwarder) is told to Ops, Sales and the SEE.' : 'From the forwarder or the airline’s AWB tracking. It is checked automatically like the first flight; the one to Colombo sets the ETA.',
      fields: [
        { key: 'flight', label: 'Flight no.', required: true, initial: l?.flight ?? '', hint: 'e.g. EK 650' },
        { key: 'etd', label: 'Flight date', type: 'date', required: true, initial: l?.etd ?? '' },
        { key: 'from', label: 'From', initial: l?.from_ap ?? last?.to_ap ?? s.via ?? '', hint: 'the transit airport, e.g. DXB' },
        { key: 'to', label: 'To', initial: l?.to_ap ?? 'CMB', hint: 'CMB for the flight to Colombo; else the next transit airport' },
        ...(l ? [{ key: 'note', label: 'Reason for the change', type: 'multiline' as const, hint: 'Needed when the flight or its date changes' }] : []),
      ],
      confirmLabel: 'Save',
    });
    if (r) await dialog.run(async () => { await rpc('fo_save_leg', { p_id: l?.id ?? null, p: { ...r, shipment_id: s.id } }); await reload(); }, 'Saved – Sales and the SEE are told');
  };
  const removeLeg = async (l: FlightLeg) => {
    if (await dialog.confirm(`Remove flight ${l.seq} (${l.flight})?`)) await dialog.run(async () => { await rpc('fo_remove_leg', { p_id: l.id }); await reload(); }, 'Removed');
  };
  const openAwb = async () => {
    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(trk.awb);
      } catch {
        // the AWB is shown in the message anyway
      }
    }
    dialog.toast(`AWB ${trk.awb}${Platform.OS === 'web' ? ' copied' : ''} – enter it on ${trk.airline ?? 'the tracking page'}`);
    await Linking.openURL(trk.url);
  };
  const cargo = async () => {
    const r = await dialog.prompt({
      title: 'What the airline’s AWB tracking shows',
      message: `AWB ${trk.awb}${trk.airline ? ` · ${trk.airline}` : ''}. Offloaded / rebooked is told to Sales, the SEE and SM Projects – add the new flight too.`,
      fields: [
        { key: 'status', label: 'Cargo', type: 'select', required: true, options: Object.entries(CARGO_STATUS).map(([value, label]) => ({ value, label })) },
        { key: 'note', label: 'Details', type: 'multiline', hint: 'e.g. booked on EK 650 21 Oct; offloaded at DXB, rebooked EK 652 22 Oct' },
      ],
      confirmLabel: 'Save',
    });
    if (r) await dialog.run(async () => { await rpc('fo_cargo_check', { p_shipment: s.id, p_status: r.status, p_note: r.note || null }); await reload(); }, 'Saved');
  };
  const legLine = (flight: string, from: string | null | undefined, to: string | null | undefined, etd: string | null | undefined, st: string | null | undefined, dep: string | null | undefined, arr: string | null | undefined, landed: string | null | undefined) =>
    [`${flight} ${from ?? '?'} → ${to ?? '?'}`, etd ? fmtDate(etd) : null, st ? FLIGHT_STATUS[st] ?? st : null, dep ? `departed ${fmtDateTime(dep)}` : null, landed ? `landed ${fmtDateTime(landed)}` : arr ? `expected ${fmtDateTime(arr)}` : null]
      .filter(Boolean)
      .join(' · ');

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: s.code ?? 'Shipment' }} />
      <TestingBanner what="Foreign orders" always />
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <Muted>{`${s.code} · ${s.mode === 'sea' ? 'Sea' : s.mode === 'air' ? 'Air' : 'Courier'}`}</Muted>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.ink }}>{s.mode === 'courier' ? `${s.carrier ?? 'Courier'}${s.bl_awb ? ` · ${s.bl_awb}` : ''}` : `${s.vessel_flight ?? (s.mode === 'sea' ? 'Vessel not entered' : 'Flight not entered')}${s.voyage ? ` · voyage ${s.voyage}` : ''}`}</Text>
          <Row gap={6} style={{ marginTop: 4 }}>
            <Pill label={s.arrived_on ? 'Arrived' : sailed ? 'In transit' : 'Booked'} tone={s.arrived_on ? colors.green : colors.blue} />
          </Row>
        </View>
        {keeper ? (
          <Row gap={8} wrap>
            <Button small variant="secondary" title="Edit / ETA" onPress={edit} />
            <Button small variant="secondary" title="Tracking checked" onPress={check} />
            {!s.arrived_on ? <Button small variant="secondary" title={s.mode === 'sea' ? 'Sailed' : s.mode === 'air' ? 'Departed' : 'Dispatched'} onPress={ship} /> : null}
            {!s.arrived_on ? <Button small title="Arrived" onPress={arrive} /> : null}
          </Row>
        ) : null}
      </Row>

      {orders.some((o) => o.dangerous) ? (
        <Notice tone={colors.red}>{`⚠ DANGEROUS GOODS on this shipment – ${orders.filter((o) => o.dangerous).map((o) => `${o.code}: ${o.dg_details ?? ''}`).join('; ')}`}</Notice>
      ) : null}
      {s.mode === 'air' && s.multi_leg && !s.arrived_on ? (
        keeper ? (
          multiOpen ? (
            <Notice tone={colors.amber}>⚠ Multi-flight warning – please check: the flight to Colombo is not entered yet. Check the AWB on the airline site and add the next flight when known (at each transit until the cargo reaches Sri Lanka).</Notice>
          ) : (
            <Notice tone={colors.blue}>More than one flight – each is checked automatically; check the AWB on the airline site at each transit.</Notice>
          )
        ) : (
          <Notice tone={colors.amber}>{`✈ Transshipment possible – the cargo changes flights on the way${multiOpen ? '; the onward flight is not confirmed yet' : ''}. Contact Ops for updates.`}</Notice>
        )
      ) : null}
      {s.mode === 'air' ? (
        <Notice tone={s.flight_status === 'Canceled' || s.flight_status === 'Diverted' ? colors.red : s.flight_landed_at ? colors.green : colors.blue}>
          {s.flight_checked_at
            ? `Flight ${s.vessel_flight ?? ''}${s.flight_route ? ` (${s.flight_route})` : ''}: ${FLIGHT_STATUS[s.flight_status ?? ''] ?? s.flight_status ?? '—'}${s.flight_departed_at ? ` · departed ${fmtDateTime(s.flight_departed_at)}` : ''}${s.flight_landed_at ? ` · landed ${fmtDateTime(s.flight_landed_at)}` : s.flight_arrival_at ? ` · expected ${fmtDateTime(s.flight_arrival_at)}` : ''} · checked automatically ${fmtDateTime(s.flight_checked_at)}`
            : s.vessel_flight && s.etd
              ? `Flight ${s.vessel_flight} is checked automatically every 3 hours from the day before the ETD until it lands.`
              : 'Enter the flight no. and the ETD (Edit / ETA) – the flight is then checked automatically.'}
        </Notice>
      ) : null}
      {s.mode === 'sea' && !s.arrived_on ? (
        <Notice tone={colors.blue}>
          {s.ais_seen_at
            ? `AIS: last heard ${fmtDateTime(s.ais_seen_at)}${s.ais_status ? ` · ${s.ais_status}` : ''}${s.ais_speed != null ? ` · ${s.ais_speed} kn` : ''}${s.ais_destination ? ` · reports destination ${s.ais_destination}` : ''}${s.ais_eta ? `, ETA ${fmtDateTime(s.ais_eta)}` : ''}${s.ais_checked_at && s.ais_checked_at > s.ais_seen_at ? ` · not heard at the last check (${fmtDateTime(s.ais_checked_at)}) – probably out of receiver range at sea` : ''}`
            : s.mmsi
              ? `Position checked automatically morning and evening once sailed (MMSI ${s.mmsi}).${s.ais_checked_at ? ` Not heard yet – last check ${fmtDateTime(s.ais_checked_at)}; ships far out at sea are heard again near the coast.` : ''}`
              : 'Enter the vessel’s MMSI no. (Edit / ETA) – its position is then recorded automatically morning and evening.'}
        </Notice>
      ) : null}
      {s.mode === 'air' && (s.multi_leg || s.bl_awb) ? (
        <Section
          title={s.multi_leg ? `Flights · ${legs.length + 1}` : 'AWB'}
          right={
            <Row gap={6} wrap>
              {s.bl_awb ? <Button small variant="secondary" title="Check AWB on airline site" onPress={openAwb} /> : null}
              {keeper && s.bl_awb && !s.arrived_on ? <Button small variant="ghost" title="Cargo status…" onPress={cargo} /> : null}
              {keeper && s.multi_leg && !s.arrived_on ? <Button small title="+ Next flight" onPress={() => saveLeg()} /> : null}
            </Row>
          }
        >
          <Card style={{ gap: 6 }}>
            {s.multi_leg ? (
              <>
                <Muted>{`1. ${legLine(s.vessel_flight ?? 'Flight not entered', s.pol, s.via, s.etd, s.flight_status, s.flight_departed_at, s.flight_arrival_at, s.flight_landed_at)}`}</Muted>
                {legs.map((l) => (
                  <Row key={l.id} wrap gap={6} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: isDestination(l.to_ap) ? colors.ink : colors.muted, flexShrink: 1 }}>{`${l.seq}. ${legLine(l.flight, l.from_ap, l.to_ap, l.etd, l.flight_status, l.departed_at, l.arrival_at, l.landed_at)}${l.note ? ` · ${l.note}` : ''}`}</Text>
                    {keeper && !s.arrived_on && !l.landed_at ? (
                      <Row gap={4}>
                        <Button small variant="ghost" title="Change" onPress={() => saveLeg(l)} />
                        {!l.departed_at ? <Button small variant="ghost" title="Remove" onPress={() => removeLeg(l)} /> : null}
                      </Row>
                    ) : null}
                  </Row>
                ))}
                {multiOpen ? <Muted>Next: the flight to Colombo – not entered yet.</Muted> : null}
              </>
            ) : null}
            <Muted>
              {[`AWB ${trk.awb || '—'}${trk.airline ? ` · ${trk.airline}` : ''}`, s.cargo_status ? `airline shows: ${CARGO_STATUS[s.cargo_status]}${s.cargo_note ? ` – ${s.cargo_note}` : ''} (${fmtDateTime(s.cargo_checked_at)})` : 'cargo status not checked yet']
                .join(' · ')}
            </Muted>
          </Card>
        </Section>
      ) : null}
      <ShipmentRoute shipment={s} orders={orders} site={hos.length === 1 ? hos[0].delivery_location : null} positions={positions} keeper={keeper} onChange={reload} />
      <Grid min={200}>
        {s.mode === 'sea' ? (
          <>
            <KeyValue label="B/L no." value={s.bl_awb ?? '—'} />
            <KeyValue label="Shipping line" value={s.carrier ?? '—'} />
            <KeyValue label="Containers" value={s.containers ?? '—'} />
            <KeyValue label="Container nos." value={s.container_nos ?? '—'} />
            <KeyValue label="IMO / MMSI" value={s.imo ?? s.mmsi ?? '—'} />
            <KeyValue label="On board" value={s.onboard_at ? fmtDateTime(s.onboard_at) : '—'} />
            <KeyValue label="Forwarder" value={s.forwarder ?? '—'} />
          </>
        ) : s.mode === 'air' ? (
          <>
            <KeyValue label="AWB no." value={s.bl_awb ?? '—'} />
            <KeyValue label="Airline" value={s.carrier ?? '—'} />
            <KeyValue label="Pieces and weight" value={s.containers ?? '—'} />
            <KeyValue label="Departed" value={s.onboard_at ? fmtDateTime(s.onboard_at) : '—'} />
            <KeyValue label="Forwarder" value={s.forwarder ?? '—'} />
          </>
        ) : (
          <>
            <KeyValue label="Tracking no." value={s.bl_awb ?? '—'} />
            <KeyValue label="Parcels and weight" value={s.containers ?? '—'} />
          </>
        )}
        <KeyValue label="Clearing agent" value={s.clearing_agent ?? '—'} />
        <KeyValue label="Last checked" value={s.last_checked_on ? `${fmtDate(s.last_checked_on)}${s.last_check_note ? ` – ${s.last_check_note}` : ''}` : '—'} />
      </Grid>
      {s.notes ? <Muted>{s.notes}</Muted> : null}

      <Section title={`Import orders on this shipment · ${orders.length}`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {orders.map((o) => (
            <ListRow
              key={o.id}
              title={`${o.dangerous ? '⚠ DG · ' : ''}${o.code} · ${o.title}`}
              subtitle={`${ho(o)?.project_name ?? ''} · ${o.vendor}${o.required_on ? `\nRequired at site ${fmtDate(o.required_on)}` : ''}`}
              right={s.eta && o.required_on && !s.arrived_on && s.eta > o.required_on ? <Pill label="ETA after required" tone={colors.red} /> : undefined}
              wrapRight
              onPress={() => router.push(`/orders/foreign/${o.id}`)}
            />
          ))}
        </Card>
      </Section>
      {log.length ? (
        <Section title="ETA history">
          {log.map((l) => (
            <Muted key={l.id}>{`${fmtDateTime(l.changed_at)} · ETA ${fmtDate(l.eta)}${l.note ? ` · ${l.note}` : ''}`}</Muted>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
