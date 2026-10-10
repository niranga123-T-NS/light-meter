import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { MaterialRows } from '@/components/exec/MaterialRows';
import { TestingBanner } from '@/components/Testing';
import { Button, colors, ErrorBanner, Field, Grid, Loading, Muted, Pill, Row, Screen, Segmented, Select, Stat, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { MR_STATUS, mrDaysLate, type ExecProject, type MaterialRequest, type MrLine } from '@/lib/execution';
import { fmtDate, fmtTime, todayISO } from '@/lib/format';
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
/** Colour of a request: red when late, amber when due soon or waiting for approval, blue on order, green when delivered. */
const toneOf = (m: MaterialRequest, late: number, today: string) => {
  if (late > 0) return colors.red;
  if (m.status === 'received') return colors.green;
  if (m.status === 'rejected' || m.status === 'cancelled') return colors.grey;
  const due = (m.delivery_at ?? m.required_date).slice(0, 10);
  if (Date.parse(due) - Date.parse(today) <= 2 * 864e5) return colors.amber;
  if (m.status === 'ordered' || m.status === 'part_received') return colors.blue;
  return colors.amber;
};

/** Materials across execution projects: the status of every order (SM Projects, GM, Operations), and what waits for each person. */
export default function Materials() {
  const me = useMe();
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
    return { rows: (m.data ?? []) as MaterialRequest[], projects: (p.data ?? []) as ExecProject[], lines: (l.data ?? []) as MrLine[] };
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const pname = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '';
  const pcode = (id: string) => data.projects.find((p) => p.id === id)?.code ?? '';
  const pn = (id: string) => people[id]?.full_name ?? '—';
  // Approvers see what waits for their step; Assistant Engineers see their own open requests (to follow up and receive)
  const mine = (m: MaterialRequest) =>
    (m.status === 'submitted' && me.role === 'senior_elec_engineer') ||
    (m.status === 'pending_smp' && me.role === 'sm_projects') ||
    (m.status === 'approved' && me.role === 'operations_exec') ||
    (me.role === 'operations_exec' && m.status === 'ordered' && !m.delivery_at) ||
    (me.role === 'assistant_engineer' && (m.status === 'ae_review' || (m.requested_by === me.id && !['received', 'rejected', 'cancelled'].includes(m.status)))) ||
    (me.role === 'sub_supervisor' && !['received', 'rejected', 'cancelled'].includes(m.status));
  const action = data.rows.filter(mine);
  const open = data.rows.filter((m) => GROUPS.open!.includes(m.status));
  const transit = data.rows.filter((m) => m.status === 'ordered' || m.status === 'part_received');
  const late = data.rows.filter((m) => mrDaysLate(m, today) > 0);
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
    .filter(
      (m) =>
        !ql ||
        `${m.code} ${pname(m.exec_project_id)} ${pn(m.requested_by)} ${m.po_no ?? ''} ${m.supplier ?? ''} ${lines(m.id).map((l) => l.item).join(' ')}`.toLowerCase().includes(ql),
    )
    .sort((a, b) => mrDaysLate(b, today) - mrDaysLate(a, today) || (a.delivery_at ?? a.required_date).localeCompare(b.delivery_at ?? b.required_date));
  return (
    <Screen refreshing={loading} onRefresh={reload} maxWidth={1400}>
      <Stack.Screen options={{ title: 'Materials & stores' }} />
      <TestingBanner what="Materials and stores" />
      <Grid min={150}>
        <Stat label={me.role === 'assistant_engineer' || me.role === 'sub_supervisor' ? 'My open requests' : 'Waiting for you'} value={action.length} tone={action.length ? 'amber' : undefined} onPress={() => setTab('action')} />
        <Stat label="Open orders" value={open.length} onPress={() => { setTab('status'); setGroup('open'); setLateOnly(false); }} />
        <Stat label="On order" value={transit.length} onPress={() => { setTab('status'); setGroup('order'); setLateOnly(false); }} />
        <Stat label="Deliveries late" value={late.length} tone={late.length ? 'red' : undefined} onPress={() => { setTab('status'); setGroup('open'); setLateOnly(true); }} />
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
        {['senior_elec_engineer', 'assistant_engineer', 'sub_supervisor'].includes(me.role) ? <Button title="+ Material request" onPress={() => router.push('/execution/material/new')} /> : null}
      </Row>
      {tab === 'action' ? (
        <MaterialRows rows={action} projectName={pname} />
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
            <Field label="Search" value={q} onChangeText={setQ} placeholder="MR no., item, requester, PO, supplier" />
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
            <Toggle label="Late only" value={lateOnly} onChange={setLateOnly} />
          </Row>
          <Row wrap gap={6}>
            <Pill label="Late" tone={colors.red} />
            <Pill label="Due within 2 days / waiting" tone={colors.amber} />
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
              { h: 'MR', w: 110, v: (m) => m.code, bold: true },
              { h: 'Project', w: 190, v: (m) => `${pcode(m.exec_project_id)}\n${pname(m.exec_project_id)}`.trim() },
              { h: 'Status', w: 210, v: (m) => <Pill label={MR_STATUS[m.status]} tone={toneOf(m, mrDaysLate(m, today), today)} /> },
              { h: 'Delivery', w: 140, v: (m) => (m.delivery_at ? `${fmtDate(m.delivery_at)} ${fmtTime(m.delivery_at)}${m.reschedules ? `\nmoved ${m.reschedules}×` : ''}` : '— not set —') },
              { h: 'Late', w: 70, right: true, v: (m) => (mrDaysLate(m, today) ? `${mrDaysLate(m, today)} d` : ''), bold: true, tone: () => colors.red },
              { h: 'Needed by', w: 100, v: (m) => fmtDate(m.required_date) },
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
              { h: 'SAP PO / supplier', w: 170, v: (m) => [m.po_no, m.supplier].filter(Boolean).join(' · ') || '—' },
            ]}
          />
          <Muted>{`${shown.length} of ${data.rows.length} requests · late counts from the delivery date, or the needed-by date until Operations sets one`}</Muted>
        </View>
      )}
    </Screen>
  );
}
