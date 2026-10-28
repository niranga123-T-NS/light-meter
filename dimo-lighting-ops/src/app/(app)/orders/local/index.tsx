import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { OrdersTabs } from '@/components/OrdersTabs';
import { TestingBanner } from '@/components/Testing';
import { Button, colors, ErrorBanner, Grid, Loading, Muted, Pill, Row, Screen, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { todayIso } from '@/lib/foreignOrders';
import { useLoad, usePeople } from '@/lib/hooks';
import {
  fmtLkr,
  INVOICE_POINTS,
  invoiceChain,
  invoiceNext,
  KIND_LABEL,
  LO_KEEPER,
  LO_REQUESTERS,
  LO_SHORT,
  loRoute,
  loStanding,
  termLabel,
  type LoInvoice,
  type LoOrder,
  type LoRequest,
  type LoStep,
  type LoStepDef,
} from '@/lib/localOrders';
import { supabase } from '@/lib/supabase';

type Tab = 'requests' | 'orders' | 'payments' | 'done';

function StageBar({ stage, late }: { stage: number; late: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {LO_SHORT.map((_, i) => (
        <View key={i} style={{ flex: 1, height: 5, borderRadius: 2, backgroundColor: i + 1 < stage ? colors.green : i + 1 === stage ? (late ? colors.red : colors.blue) : colors.line }} />
      ))}
    </View>
  );
}

/** Local orders board: requests (with what Ops needs to check), supplier orders by stage, invoices in approval, and what runs late. */
export default function LocalOrders() {
  const me = useMe();
  const people = usePeople();
  const keeper = LO_KEEPER.includes(me.role);
  const [tab, setTab] = useState<Tab>('requests');
  const { data, error } = useLoad(async () => {
    const [r, o, s, d, rv, ov, inv, hol] = await Promise.all([
      supabase.from('lo_requests').select('*').order('received_on', { ascending: false }),
      supabase.from('lo_orders').select('*').order('created_at'),
      supabase.from('lo_steps').select('*'),
      supabase.from('lo_step_defs').select('*').order('seq'),
      supabase.from('lo_request_values').select('request_id, pr_value'),
      supabase.from('lo_order_values').select('order_id, value'),
      supabase.from('lo_invoices').select('*').order('received_on'),
      supabase.from('holidays').select('day'),
    ]);
    if (r.error) throw new Error(r.error.message);
    return {
      reqs: (r.data ?? []) as LoRequest[],
      orders: (o.data ?? []) as LoOrder[],
      steps: (s.data ?? []) as LoStep[],
      defs: (d.data ?? []) as LoStepDef[],
      prv: Object.fromEntries(((rv.data ?? []) as { request_id: string; pr_value: number | null }[]).map((x) => [x.request_id, x.pr_value])),
      ov: Object.fromEntries(((ov.data ?? []) as { order_id: string; value: number | null }[]).map((x) => [x.order_id, x.value])),
      invoices: (inv.data ?? []) as LoInvoice[],
      holidays: new Set(((hol.data ?? []) as { day: string }[]).map((x) => x.day)),
    };
  }, [keeper]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { reqs, orders, steps, defs, prv, ov, invoices, holidays } = data;
  const today = todayIso();
  const reqOf = (id: string) => reqs.find((r) => r.id === id)!;

  // a request stands at its own steps until it is split into orders
  const reqRows = reqs.map((r) => {
    const st = loStanding(loRoute(defs, prv[r.id] ?? null, null, null, steps.filter((s) => s.request_id === r.id), holidays, today).filter((l) => l.def.scope === 'r'));
    const os = orders.filter((o) => o.request_id === r.id);
    return { r, st, os, overdue: r.status === 'open' && !!r.required_on && r.required_on < today };
  });
  const orderRows = orders
    .filter((o) => reqOf(o.request_id))
    .map((o) => {
      const r = reqOf(o.request_id);
      const st = loStanding(loRoute(defs, prv[r.id] ?? null, o, ov[o.id] ?? null, steps.filter((s) => s.request_id === r.id), holidays, today).filter((l) => l.def.scope === 'o'));
      const delivered = steps.some((s) => s.order_id === o.id && s.step === 'delivered');
      const done = delivered || steps.some((s) => s.order_id === o.id && s.step === 'work_done');
      return {
        o,
        r,
        st,
        overdue: o.status === 'open' && !done && !!r.required_on && r.required_on < today,
        behind: o.status === 'open' && !done && !!o.expected_on && !!r.required_on && o.expected_on > r.required_on,
      };
    });
  const openReqs = reqRows.filter((x) => x.r.status === 'open' || x.r.status === 'returned');
  const openOrders = orderRows.filter((x) => x.o.status === 'open' && x.r.status === 'open');
  const invRows = invoices
    .filter((i) => i.status === 'open')
    .map((i) => {
      const o = orders.find((x) => x.id === i.order_id)!;
      const r = o ? reqOf(o.request_id) : null;
      return { i, o, r, next: r ? invoiceNext(i, invoiceChain(r)) : null };
    })
    .filter((x) => x.o && x.r);
  const toCheck = openReqs.filter((x) => x.r.status === 'open' && x.st.stage <= 2).length;

  return (
    <Screen maxWidth={1300}>
      <Stack.Screen options={{ title: 'Foreign & local orders' }} />
      <OrdersTabs value="local" />
      <TestingBanner what="Local orders" always />
      <Muted>
        Materials and services bought in Sri Lanka, from the request to payment. The SEE, Sales or Operations raises the request; the Operations Executive records each step from
        e-mail and SAP, and the app counts the working days each step takes.
      </Muted>
      <Grid min={150} max={6}>
        <Stat label="Requests to check" value={String(toCheck)} tone={toCheck ? 'amber' : undefined} />
        <Stat label="Returned – waiting on requester" value={String(openReqs.filter((x) => x.r.status === 'returned').length)} />
        <Stat label="PR approval / sourcing" value={String(openReqs.filter((x) => x.r.status === 'open' && x.st.stage >= 3 && x.st.stage <= 4).length)} />
        <Stat label="Orders in approval / delivery" value={String(openOrders.length)} />
        <Stat label="Invoices in approval" value={String(invRows.length)} />
        <Stat label="After / past required date" value={String(openOrders.filter((x) => x.overdue || x.behind).length)} tone={openOrders.some((x) => x.overdue || x.behind) ? 'red' : 'green'} />
      </Grid>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'requests', label: 'Requests', badge: toCheck },
            { value: 'orders', label: 'Supplier orders', badge: openOrders.filter((x) => x.st.late || x.overdue || x.behind).length },
            { value: 'payments', label: 'Invoices', badge: invRows.length },
            { value: 'done', label: 'Closed / cancelled' },
          ]}
        />
        <Row wrap gap={8}>
          <Button small variant="secondary" title="Performance" onPress={() => router.push('/orders/local/performance')} />
          <Button small variant="secondary" title="Node report" onPress={() => router.push('/orders/nodes')} />
          {LO_REQUESTERS.includes(me.role) ? <Button small title="+ Request" onPress={() => router.push('/orders/local/request-form')} /> : null}
        </Row>
      </Row>

      {tab === 'requests' || tab === 'done' ? (
        <DataTable
          rows={tab === 'requests' ? openReqs : reqRows.filter((x) => x.r.status === 'closed' || x.r.status === 'cancelled')}
          keyOf={(x) => x.r.id}
          onPress={(x) => router.push(`/orders/local/r/${x.r.id}`)}
          edge={(x) => (x.r.status === 'returned' ? colors.amber : x.st.late || x.overdue ? colors.red : undefined)}
          emptyTitle={tab === 'requests' ? 'No open requests' : 'Nothing closed yet'}
          columns={[
            { h: 'Request', w: 160, v: (x) => `${x.r.code}\n${fmtDate(x.r.received_on)}\n${KIND_LABEL[x.r.kind]}` },
            { h: 'What · project', w: 260, grow: true, v: (x) => `${x.r.title}\n${x.r.project_name}${x.r.requested_by ? `\nfrom ${people[x.r.requested_by]?.full_name ?? ''}` : ''}` },
            {
              h: 'Stage · with',
              w: 190,
              v: (x) =>
                x.r.status === 'returned' ? (
                  <Pill label="Returned – details needed" tone={colors.amber} />
                ) : x.r.status !== 'open' ? (
                  <Pill label={x.r.status === 'closed' ? 'Closed' : 'Cancelled'} tone={x.r.status === 'closed' ? colors.green : colors.grey} />
                ) : (
                  <View style={{ gap: 4 }}>
                    <Text style={{ fontSize: 13, color: colors.text }}>{x.st.stage <= 4 ? `${x.st.stage} · ${LO_SHORT[x.st.stage - 1]}` : 'Split into orders'}</Text>
                    <StageBar stage={x.st.stage <= 4 ? x.st.stage : 5} late={x.st.late} />
                    <Text style={{ fontSize: 12, color: colors.muted }}>{x.st.stage <= 4 && x.st.with ? `With ${x.st.with}` : ''}</Text>
                  </View>
                ),
            },
            { h: 'Orders', w: 150, v: (x) => (x.os.length ? x.os.map((o) => `${o.code} · ${o.supplier}`).join('\n') : '—') },
            { h: 'Required by', w: 110, v: (x) => (x.r.required_on ? fmtDate(x.r.required_on) : '—'), tone: (x) => (x.overdue ? colors.red : undefined) },
          ]}
        />
      ) : tab === 'orders' ? (
        <DataTable
          rows={openOrders}
          keyOf={(x) => x.o.id}
          onPress={(x) => router.push(`/orders/local/${x.o.id}`)}
          edge={(x) => (x.overdue || x.behind || x.st.late ? colors.red : undefined)}
          emptyTitle="No open supplier orders"
          columns={[
            { h: 'Order', w: 160, v: (x) => `${x.o.code}\n${x.o.title}\n${x.r.code}` },
            { h: 'Project', w: 200, grow: true, v: (x) => x.r.project_name },
            { h: 'Supplier · term', w: 200, v: (x) => `${x.o.supplier}${x.o.supplier_new ? ' (new)' : ''}\n${x.o.kind === 'service' ? 'Service' : 'Material'} · ${termLabel(x.o)}${ov[x.o.id] != null ? `\n${fmtLkr(ov[x.o.id])}` : ''}` },
            {
              h: 'Stage · with',
              w: 190,
              v: (x) => (
                <View style={{ gap: 4 }}>
                  <Text style={{ fontSize: 13, color: colors.text }}>{`${Math.min(x.st.stage, 7)} · ${LO_SHORT[Math.min(x.st.stage, 7) - 1]}`}</Text>
                  <StageBar stage={x.st.stage} late={x.st.late} />
                  <Text style={{ fontSize: 12, color: colors.muted }}>{x.st.with ? `With ${x.st.with}` : ''}</Text>
                </View>
              ),
            },
            {
              h: 'Expected / required',
              w: 130,
              v: (x) => `${x.o.expected_on ? fmtDate(x.o.expected_on) : '—'}${x.o.committed_on && x.o.expected_on !== x.o.committed_on ? `\n(committed ${fmtDate(x.o.committed_on)})` : ''}${x.r.required_on ? `\nreq. ${fmtDate(x.r.required_on)}` : ''}`,
              tone: (x) => (x.overdue || x.behind ? colors.red : undefined),
            },
            { h: '', w: 130, v: (x) => (x.overdue ? <Pill label="Past required date" tone={colors.red} /> : x.behind ? <Pill label="After required date" tone={colors.red} /> : x.st.late ? <Pill label="Past SLA" tone={colors.red} /> : <Pill label="On track" tone={colors.green} />) },
          ]}
        />
      ) : (
        <DataTable
          rows={invRows}
          keyOf={(x) => x.i.id}
          onPress={(x) => router.push(`/orders/local/${x.o.id}`)}
          emptyTitle="No invoices in approval"
          columns={[
            { h: 'Invoice', w: 170, v: (x) => `${x.i.invoice_no}\n${x.i.kind === 'ipc' ? 'IPC invoice' : x.i.kind === 'advance' ? 'Advance invoice' : 'Invoice'} · ${fmtDate(x.i.invoice_date)}` },
            { h: 'Order · supplier', w: 230, grow: true, v: (x) => `${x.o.code} · ${x.o.supplier}\n${x.r!.project_name}` },
            { h: 'Amount', w: 140, v: (x) => fmtLkr(x.i.amount) },
            { h: 'Received', w: 110, v: (x) => fmtDate(x.i.received_on) },
            { h: 'With', w: 150, v: (x) => <Pill label={x.next && x.next !== 'paid' ? INVOICE_POINTS[x.next].who : 'Awaiting payment'} tone={colors.blue} /> },
          ]}
        />
      )}
    </Screen>
  );
}
