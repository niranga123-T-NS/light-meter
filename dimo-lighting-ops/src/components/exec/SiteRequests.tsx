import { router, Stack } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { MaterialRows } from './MaterialRows';
import { TestingBanner } from '@/components/Testing';
import { Button, colors, ErrorBanner, Field, Grid, Loading, Muted, Pill, Row, Screen, Segmented, Select, Stat, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { MR_BILLING, MR_ROUTES, MR_STATUS, mrDaysLate, routeLabel, type ExecProject, type MaterialRequest, type MrLine, type MrRoute } from '@/lib/execution';
import { STAGES as FO_STAGES } from '@/lib/foreignOrders';
import { LO_STAGES } from '@/lib/localOrders';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Group = 'open' | 'approval' | 'order' | 'delivered' | 'all';
const GROUPS: Record<Group, MaterialRequest['status'][] | null> = {
  open: ['ae_review', 'submitted', 'pending_smp', 'approved', 'ordered', 'part_received'],
  approval: ['ae_review', 'submitted', 'pending_smp'],
  order: ['approved', 'ordered', 'part_received'],
  delivered: ['received'],
  all: null,
};
type Stage = { mr_id: string; module: 'lo' | 'fo'; order_id: string; code: string | null; stage: number; stages: number; delivered: boolean };
/** Still to come, and expected after the date the site needs it */
const afterRequired = (m: MaterialRequest) => ['approved', 'ordered', 'part_received'].includes(m.status) && !!m.expected_date && m.expected_date > m.required_date;
/** Colour of a request: red when late, amber when due soon, after the required date or waiting for approval, blue on order, green when delivered. */
const toneOf = (m: MaterialRequest, late: number, today: string) => {
  if (late > 0) return colors.red;
  if (m.status === 'received') return colors.green;
  if (m.status === 'rejected' || m.status === 'cancelled') return colors.grey;
  if (afterRequired(m)) return colors.amber;
  const due = (m.expected_date ?? m.required_date).slice(0, 10);
  if (Date.parse(due) - Date.parse(today) <= 2 * 864e5) return colors.amber;
  if (m.status === 'ordered' || m.status === 'part_received') return colors.blue;
  return colors.amber;
};

/** Material and service requests across execution projects: every request from the site to its order and receipt, and what
 *  waits for each person. Under Foreign & local orders (with `tabs`) it is the office's "Site requests". */
export function SiteRequestsView({ tabs }: { tabs?: ReactNode }) {
  const me = useMe();
  const [kind, setKind] = useState<'all' | 'material' | 'service'>('all');
  const people = usePeople();
  const lead = ['sm_projects', 'gm', 'operations_exec', 'senior_elec_engineer'].includes(me.role);
  const [tab, setTab] = useState<'action' | 'status'>(lead && me.role !== 'senior_elec_engineer' ? 'status' : 'action');
  const [project, setProject] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>('open');
  const [lateOnly, setLateOnly] = useState(false);
  const [q, setQ] = useState('');
  const today = todayISO();
  const { data, error, reload, loading } = useLoad(async () => {
    const [m, p, l] = await Promise.all([
      supabase.from('material_requests').select('*').order('required_date'),
      supabase.from('exec_projects').select('*'),
      supabase.from('material_request_lines').select('id, mr_id, item, unit, qty, received_qty'),
    ]);
    if (m.error) throw new Error(m.error.message);
    const rows = (m.data ?? []) as MaterialRequest[];
    const ids = rows.filter((x) => ['approved', 'ordered', 'part_received', 'received'].includes(x.status)).map((x) => x.id);
    const [rt, st] = ids.length ? await Promise.all([supabase.rpc('mr_routes', { p_ids: ids }), supabase.rpc('mr_order_stage', { p_ids: ids })]) : [{ data: [] }, { data: [] }];
    return { rows, projects: (p.data ?? []) as ExecProject[], lines: (l.data ?? []) as MrLine[], routes: (rt.data ?? []) as MrRoute[], stages: (st.data ?? []) as Stage[] };
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const pname = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '';
  const pcode = (id: string) => data.projects.find((p) => p.id === id)?.code ?? '';
  const pn = (id: string) => people[id]?.full_name ?? '—';
  const route = (id: string) => data.routes.find((r) => r.mr_id === id) ?? null;
  // the order furthest behind (not yet delivered) – where the request is now
  const behind = (id: string) =>
    data.stages.filter((x) => x.mr_id === id && !x.delivered).sort((a, b) => a.stage / a.stages - b.stage / b.stages)[0] ?? null;
  const stageText = (x: Stage) => `${x.code ?? ''} · ${(x.module === 'lo' ? LO_STAGES : FO_STAGES)[x.stage - 1] ?? ''} (${x.stage}/${x.stages})`;
  // Operations' to-do: SAP to order, local / import still without a supplier order, expected date passed
  const sap = (m: MaterialRequest) => !route(m.id) && (m.route ?? 'sap') === 'sap';
  const opsToOrder = data.rows.filter((m) => m.status === 'approved' && sap(m));
  const opsNoOrder = data.rows.filter((m) => m.status === 'approved' && !!route(m.id) && route(m.id)!.orders === 0);
  const opsLate = data.rows.filter((m) => ['ordered', 'part_received'].includes(m.status) && mrDaysLate(m, today) > 0);
  const ops = me.role === 'operations_exec';
  // Approvers see what waits for their step; Assistant Engineers see their own open requests (to follow up and receive)
  const mine = (m: MaterialRequest) =>
    (m.status === 'submitted' && me.role === 'senior_elec_engineer') ||
    (m.status === 'pending_smp' && me.role === 'sm_projects') ||
    // sent to local or foreign orders, it is followed there
    (ops && (opsToOrder.includes(m) || opsNoOrder.includes(m) || opsLate.includes(m))) ||
    (me.role === 'assistant_engineer' && (m.status === 'ae_review' || (m.requested_by === me.id && !['received', 'rejected', 'cancelled'].includes(m.status)))) ||
    (me.role === 'sub_supervisor' && !['received', 'rejected', 'cancelled'].includes(m.status));
  const action = data.rows.filter(mine);
  const transit = data.rows.filter((m) => m.status === 'ordered' || m.status === 'part_received');
  const late = data.rows.filter((m) => mrDaysLate(m, today) > 0);
  const after = data.rows.filter(afterRequired);
  const lines = (id: string) => data.lines.filter((l) => l.mr_id === id);
  const pct = (id: string) => {
    const ls = lines(id);
    const t = ls.reduce((s, l) => s + Number(l.qty), 0);
    return t ? Math.round((100 * ls.reduce((s, l) => s + Math.min(Number(l.received_qty), Number(l.qty)), 0)) / t) : 0;
  };
  const ql = q.trim().toLowerCase();
  const shown = data.rows
    .filter((m) => !project || m.exec_project_id === project)
    .filter((m) => !GROUPS[group] || GROUPS[group]!.includes(m.status))
    .filter((m) => !lateOnly || mrDaysLate(m, today) > 0)
    .filter((m) => kind === 'all' || (m.kind ?? 'material') === kind)
    .filter(
      (m) =>
        !ql ||
        `${m.code} ${pname(m.exec_project_id)} ${pn(m.requested_by)} ${m.po_no ?? ''} ${m.supplier ?? ''} ${route(m.id)?.code ?? ''} ${lines(m.id).map((l) => l.item).join(' ')}`.toLowerCase().includes(ql),
    )
    .sort((a, b) => mrDaysLate(b, today) - mrDaysLate(a, today) || (a.expected_date ?? a.required_date).localeCompare(b.expected_date ?? b.required_date));
  return (
    <Screen refreshing={loading} onRefresh={reload} maxWidth={1400}>
      <Stack.Screen options={{ title: tabs ? 'Site requests' : 'Materials, services & stores' }} />
      {tabs}
      <TestingBanner what={tabs ? 'Site requests' : 'Materials and stores'} />
      <Grid min={150}>
        {ops ? (
          <Stat label="To order" value={opsToOrder.length + opsNoOrder.length} tone={opsToOrder.length + opsNoOrder.length ? 'amber' : undefined} onPress={() => setTab('action')} />
        ) : (
          <Stat label={me.role === 'assistant_engineer' || me.role === 'sub_supervisor' ? 'My open requests' : 'Waiting for you'} value={action.length} tone={action.length ? 'amber' : undefined} onPress={() => setTab('action')} />
        )}
        <Stat label="On order" value={transit.length} onPress={() => { setTab('status'); setGroup('order'); setLateOnly(false); }} />
        <Stat label="After required date" value={after.length} tone={after.length ? 'amber' : undefined} onPress={() => { setTab('status'); setGroup('order'); setLateOnly(false); }} />
        <Stat label="Late" value={late.length} tone={late.length ? 'red' : undefined} onPress={() => { setTab('status'); setGroup('open'); setLateOnly(true); }} />
      </Grid>
      <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'action', label: 'For me', badge: action.length },
            { value: 'status', label: 'Order status' },
          ]}
        />
        {['senior_elec_engineer', 'assistant_engineer', 'sub_supervisor'].includes(me.role) ? <Button title="+ Request (materials / services)" onPress={() => router.push('/execution/material/new')} /> : null}
      </Row>
      {tab === 'action' && ops ? (
        <View style={{ gap: 10 }}>
          <Muted>{`SAP to order (${opsToOrder.length}) – order in SAP with the expected date`}</Muted>
          <MaterialRows rows={opsToOrder} projectName={pname} routes={data.routes} />
          <Muted>{`Local / import – no supplier order yet (${opsNoOrder.length}) – open the LR / IR under Local or Foreign orders`}</Muted>
          <MaterialRows rows={opsNoOrder} projectName={pname} routes={data.routes} />
          <Muted>{`Expected date passed (${opsLate.length}) – move the expected date (with the reason) or record the delivery`}</Muted>
          <MaterialRows rows={opsLate} projectName={pname} routes={data.routes} />
        </View>
      ) : tab === 'action' ? (
        <MaterialRows rows={action} projectName={pname} routes={data.routes} />
      ) : (
        <View style={{ gap: 8 }}>
          <Grid min={220}>
            <Select
              label="Project"
              searchable
              value={project ?? ''}
              onChange={(v) => setProject(v || null)}
              options={[{ value: '', label: 'All projects' }, ...data.projects.map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))]}
            />
            <Field label="Search" value={q} onChangeText={setQ} placeholder="MR no., item, requester, PO, supplier, LR / IR" />
          </Grid>
          <Row wrap gap={8} style={{ alignItems: 'center' }}>
            <Segmented
              value={group}
              onChange={setGroup}
              options={[
                { value: 'open', label: 'Open' },
                { value: 'approval', label: 'Approval' },
                { value: 'order', label: 'Ordered' },
                { value: 'delivered', label: 'Delivered' },
                { value: 'all', label: 'All' },
              ]}
            />
            <Segmented
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'All' },
                { value: 'material', label: 'Materials' },
                { value: 'service', label: 'Services' },
              ]}
            />
            <Toggle label="Late only" value={lateOnly} onChange={setLateOnly} />
          </Row>
          <Row wrap gap={6}>
            <Pill label="Late" tone={colors.red} />
            <Pill label="Due within 2 days / after the required date / waiting" tone={colors.amber} />
            <Pill label="On order" tone={colors.blue} />
            <Pill label="Delivered" tone={colors.green} />
          </Row>
          <DataTable
            rows={shown}
            keyOf={(m) => m.id}
            onPress={(m) => router.push(`/execution/material/${m.id}`)}
            edge={(m) => toneOf(m, mrDaysLate(m, today), today)}
            emptyTitle="No orders match the filters"
            columns={[
              { h: 'MR', w: 110, v: (m) => `${m.code}${m.kind === 'service' ? '\nService' : ''}`, bold: true },
              { h: 'Project', w: 190, v: (m) => `${pcode(m.exec_project_id)}\n${pname(m.exec_project_id)}`.trim() },
              { h: 'Status', w: 210, v: (m) => <Pill label={MR_STATUS[m.status]} tone={toneOf(m, mrDaysLate(m, today), today)} /> },
              {
                h: 'Route & order',
                w: 240,
                v: (m) => {
                  const r = route(m.id);
                  const b = behind(m.id);
                  return r ? `${routeLabel(r)}${b ? `\n${stageText(b)}` : ''}` : m.po_no ? `SAP ${m.po_no}` : MR_ROUTES.find((x) => x.value === (m.route ?? 'sap'))?.label ?? '';
                },
              },
              {
                h: 'Expected · needed by',
                w: 170,
                v: (m) =>
                  `${m.expected_date ? fmtDate(m.expected_date) : '— not set —'}${m.reschedules ? ` · moved ${m.reschedules}×` : ''}\nneeded ${fmtDate(m.required_date)}${afterRequired(m) ? ' · AFTER' : ''}`,
                tone: (m) => (afterRequired(m) ? colors.amber : undefined),
              },
              { h: 'Late', w: 70, right: true, v: (m) => (mrDaysLate(m, today) ? `${mrDaysLate(m, today)} d` : ''), bold: true, tone: () => colors.red },
              { h: 'Paid by', w: 130, v: (m) => (m.kind === 'service' ? MR_BILLING.find((x) => x.value === m.billing)?.label ?? '—' : '') },
              { h: 'Received', w: 80, right: true, v: (m) => `${pct(m.id)}%`, tone: (m) => (pct(m.id) >= 100 ? colors.green : undefined) },
              {
                h: 'Items',
                w: 260,
                v: (m) => {
                  const ls = lines(m.id);
                  return ls.length ? `${ls.slice(0, 2).map((l) => `${l.item} × ${l.qty} ${l.unit}`).join('\n')}${ls.length > 2 ? `\n+ ${ls.length - 2} more` : ''}` : '—';
                },
              },
              { h: 'Requested by', w: 150, v: (m) => `${pn(m.requested_by)}\n${fmtDate(m.requested_at)}` },
              { h: 'PO / supplier', w: 170, v: (m) => [m.po_no, m.supplier].filter(Boolean).join(' · ') || '—' },
            ]}
          />
          <Muted>{`${shown.length} of ${data.rows.length} requests · late counts from the expected date (the order’s), or the needed-by date until there is one`}</Muted>
        </View>
      )}
    </Screen>
  );
}
