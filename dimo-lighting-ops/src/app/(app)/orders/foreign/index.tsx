import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { TestingBanner } from '@/components/Testing';
import { Button, colors, ErrorBanner, Grid, Loading, Muted, Pill, Row, Screen, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import {
  FO_KEEPER,
  latestShipment,
  route,
  SHORT_STAGES,
  standing,
  termsLabel,
  todayIso,
  type FoOrder,
  type Handover,
  type Shipment,
  type Step,
  type StepDef,
} from '@/lib/foreignOrders';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Tab = 'orders' | 'handovers' | 'shipments' | 'done';

/** Foreign orders board: every open import order with its stage, who has it now, the ETA against the site's required date, and what runs late. */
export default function ForeignOrders() {
  const me = useMe();
  const people = usePeople();
  const keeper = FO_KEEPER.includes(me.role);
  const [tab, setTab] = useState<Tab>('orders');
  const { data, error } = useLoad(async () => {
    const [h, o, s, d, sh, so, hol, nt] = await Promise.all([
      supabase.from('fo_handovers').select('*').order('received_on', { ascending: false }),
      supabase.from('fo_orders').select('*').order('created_at'),
      supabase.from('fo_steps').select('*'),
      supabase.from('fo_step_defs').select('*').order('seq'),
      supabase.from('fo_shipments').select('*').order('eta', { ascending: false }),
      supabase.from('fo_shipment_orders').select('*'),
      supabase.from('holidays').select('day'),
      supabase.from('fo_notes').select('order_id, handover_id, status').eq('status', 'open'),
    ]);
    if (h.error) throw new Error(h.error.message);
    return {
      hos: (h.data ?? []) as Handover[],
      orders: (o.data ?? []) as FoOrder[],
      steps: (s.data ?? []) as Step[],
      defs: (d.data ?? []) as StepDef[],
      ships: (sh.data ?? []) as Shipment[],
      links: (so.data ?? []) as { shipment_id: string; order_id: string }[],
      holidays: new Set(((hol.data ?? []) as { day: string }[]).map((x) => x.day)),
      openNotes: (nt.data ?? []) as { order_id: string | null; handover_id: string }[],
    };
  }, [keeper]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { hos, orders, steps, defs, ships, links, holidays, openNotes } = data;
  const today = todayIso();
  const hoOf = (id: string) => hos.find((h) => h.id === id)!;
  const rows = orders
    .filter((o) => hoOf(o.handover_id))
    .map((o) => {
      const h = hoOf(o.handover_id);
      const hs = steps.filter((s) => s.handover_id === h.id);
      const sib = orders.filter((x) => x.handover_id === h.id);
      const st = standing(route(defs, h, o, hs, sib, holidays, today));
      const ship = latestShipment(o.id, links, ships);
      const eta = ship && !ship.arrived_on ? ship.eta : null;
      const overdue = o.status === 'open' && !!o.required_on && o.required_on < today;
      const issues = openNotes.filter((n) => n.order_id === o.id).length;
      return { o, h, st, ship, eta, behind: !!(eta && o.required_on && eta > o.required_on), overdue, issues, sib: sib.length };
    });
  const open = rows.filter((r) => r.o.status === 'open' && r.h.status === 'open');
  // hand-overs not split yet
  const empty = hos.filter((h) => h.status === 'open' && !orders.some((o) => o.handover_id === h.id));
  const count = (f: (r: (typeof rows)[number]) => boolean) => open.filter(f).length;
  const shown = tab === 'done' ? rows.filter((r) => r.o.status !== 'open') : open;

  const newHandover = () => router.push('/orders/foreign/handover-form');

  return (
    <Screen maxWidth={1300}>
      <Stack.Screen options={{ title: 'Foreign orders' }} />
      <TestingBanner what="Foreign orders" always />
      <Muted>
        Foreign material and service orders from the Estimation Manager&apos;s hand-over to delivery. The work happens in e-mail and SAP; the Operations Executive records each
        step here, and the app counts the working days each step takes.
      </Muted>
      <Grid min={150} max={6}>
        <Stat label="New hand-overs to split" value={String(empty.length)} tone={empty.length ? 'amber' : undefined} />
        <Stat label="SAP set-up and project" value={String(count((r) => r.st.stage <= 3))} />
        <Stat label="Import order and PO" value={String(count((r) => r.st.stage === 4 || r.st.stage === 5))} />
        <Stat label="In production" value={String(count((r) => r.st.stage === 6))} />
        <Stat label="Shipped / at clearing" value={String(count((r) => r.st.stage === 7 || r.st.stage === 8))} />
        <Stat label="ETA after required date" value={String(count((r) => r.behind))} tone={count((r) => r.behind) ? 'red' : 'green'} />
      </Grid>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'orders', label: 'Open orders', badge: count((r) => r.st.late || r.behind || r.overdue) },
            { value: 'handovers', label: 'Hand-overs', badge: empty.length },
            { value: 'shipments', label: 'Shipments' },
            { value: 'done', label: 'Delivered / cancelled' },
          ]}
        />
        <Row wrap gap={8}>
          <Button small variant="secondary" title="Performance" onPress={() => router.push('/orders/foreign/performance')} />
          {keeper ? <Button small title="+ Hand-over" onPress={newHandover} /> : null}
        </Row>
      </Row>

      {tab === 'orders' || tab === 'done' ? (
        <DataTable
          rows={shown}
          keyOf={(r) => r.o.id}
          onPress={(r) => router.push(`/orders/foreign/${r.o.id}`)}
          edge={(r) => (r.o.status !== 'open' ? undefined : r.overdue || r.behind || r.st.late ? colors.red : undefined)}
          emptyTitle={tab === 'done' ? 'Nothing delivered yet' : 'No open import orders'}
          columns={[
            { h: 'Order', w: 175, tone: (r) => (r.o.dangerous ? colors.red : undefined), v: (r) => `${r.o.dangerous ? '⚠ DANGEROUS GOODS\n' : ''}${r.o.code}\n${r.o.title}\n${r.h.code} · ${r.o.seq_no} of ${r.sib}${r.issues ? `\n⚠ ${r.issues} open issue${r.issues > 1 ? 's' : ''}` : ''}` },
            { h: 'Project · client', w: 190, grow: true, v: (r) => `${r.h.project_name}\n${r.h.client}${r.h.sap_project_no ? `\n${r.h.sap_project_no}` : ''}` },
            { h: 'Vendor · terms', w: 165, v: (r) => `${r.o.vendor}\n${termsLabel(r.o)}` },
            {
              h: 'Stage · with',
              w: 185,
              v: (r) =>
                r.o.status !== 'open' ? (
                  <Pill label={r.o.status === 'delivered' ? (r.o.kind === 'service' ? 'Completed' : 'Delivered') : 'Cancelled'} tone={r.o.status === 'delivered' ? colors.green : colors.grey} />
                ) : (
                  <View style={{ gap: 4 }}>
                    <Text style={{ fontSize: 13, color: colors.text }}>{`${Math.min(r.st.stage, 9)} · ${SHORT_STAGES[Math.min(r.st.stage, 9) - 1]}`}</Text>
                    <View style={{ flexDirection: 'row', gap: 2 }}>
                      {SHORT_STAGES.map((_, i) => (
                        <View key={i} style={{ flex: 1, height: 5, borderRadius: 2, backgroundColor: i + 1 < r.st.stage ? colors.green : i + 1 === r.st.stage ? (r.st.late ? colors.red : colors.blue) : colors.line }} />
                      ))}
                    </View>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{r.st.with === 'In transit' ? 'In transit' : r.st.with ? `With ${r.st.with}` : ''}</Text>
                  </View>
                ),
            },
            {
              h: 'ETA / required',
              w: 115,
              v: (r) =>
                r.ship?.arrived_on ? `Arrived ${fmtDate(r.ship.arrived_on)}${r.o.required_on ? `\nreq. ${fmtDate(r.o.required_on)}` : ''}` : `${r.eta ? fmtDate(r.eta) : '—'}${r.o.required_on ? `\nreq. ${fmtDate(r.o.required_on)}` : ''}`,
              tone: (r) => (r.behind || r.overdue ? colors.red : undefined),
            },
            {
              h: '',
              w: 135,
              v: (r) =>
                r.o.status !== 'open' ? null : r.overdue ? (
                  <Pill label="Past required date" tone={colors.red} />
                ) : r.behind ? (
                  <Pill label="ETA after required" tone={colors.red} />
                ) : r.st.late ? (
                  <Pill label="Past SLA" tone={colors.red} />
                ) : r.o.kind === 'service' ? (
                  <Pill label="Service" tone={colors.blue} />
                ) : (
                  <Pill label="On track" tone={colors.green} />
                ),
            },
          ]}
        />
      ) : tab === 'handovers' ? (
        <DataTable
          rows={hos}
          keyOf={(h) => h.id}
          onPress={(h) => router.push(`/orders/foreign/ho/${h.id}`)}
          edge={(h) => (empty.includes(h) ? colors.amber : undefined)}
          emptyTitle="No hand-overs yet"
          columns={[
            { h: 'Hand-over', w: 150, v: (h) => `${h.code}\n${fmtDate(h.received_on)}` },
            { h: 'Project · client', w: 260, grow: true, v: (h) => `${h.project_name}\n${h.client}` },
            { h: 'Sales person', w: 160, v: (h) => (h.sales_person_id ? people[h.sales_person_id]?.full_name ?? '' : '') },
            { h: 'SAP project', w: 130, v: (h) => h.sap_project_no ?? '—' },
            {
              h: 'Import orders',
              w: 170,
              v: (h) => {
                const os = orders.filter((o) => o.handover_id === h.id);
                return os.length ? `${os.length} · ${os.filter((o) => o.status === 'delivered').length} delivered` : 'Not split yet';
              },
            },
            { h: 'Status', w: 110, v: (h) => <Pill label={h.status === 'open' ? 'Open' : h.status === 'closed' ? 'Closed' : 'Cancelled'} tone={h.status === 'open' ? colors.blue : h.status === 'closed' ? colors.green : colors.grey} /> },
          ]}
        />
      ) : (
        <DataTable
          rows={ships}
          keyOf={(s) => s.id}
          onPress={(s) => router.push(`/orders/foreign/shipment/${s.id}`)}
          emptyTitle="No shipments yet"
          columns={[
            { h: 'Shipment', w: 150, v: (s) => `${s.code}\n${s.mode === 'sea' ? 'Sea' : s.mode === 'air' ? 'Air' : 'Courier'}` },
            { h: 'Vessel / flight', w: 200, grow: true, v: (s) => `${s.vessel_flight ?? (s.mode === 'courier' ? s.carrier ?? 'Courier' : '—')}${s.voyage ? ` · ${s.voyage}` : ''}\n${s.bl_awb ?? ''}` },
            { h: 'Route', w: 220, v: (s) => [s.pol, s.via, s.pod].filter(Boolean).join(' → ') || '—' },
            { h: 'ETD', w: 100, v: (s) => fmtDate(s.etd) },
            { h: 'ETA', w: 100, v: (s) => (s.arrived_on ? `Arrived ${fmtDate(s.arrived_on)}` : fmtDate(s.eta)) },
            { h: 'Orders', w: 170, v: (s) => links.filter((l) => l.shipment_id === s.id).map((l) => orders.find((o) => o.id === l.order_id)?.code ?? '').join('\n') },
          ]}
        />
      )}
    </Screen>
  );
}
