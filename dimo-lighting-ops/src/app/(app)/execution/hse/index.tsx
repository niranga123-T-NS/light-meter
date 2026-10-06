import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { HseRows } from '@/components/exec/HseRows';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Grid, ListRow, Loading, Pill, Row, Screen, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject, HseAction, HseReport } from '@/lib/execution';
import { addDaysISO, fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** HSE: report an incident / near miss / unsafe act or condition, follow corrective actions, safety figures. */
export default function Hse() {
  const me = useMe();
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const { data, error, reload, loading } = useLoad(async () => {
    const [r, a, p] = await Promise.all([
      supabase.from('hse_reports').select('*').order('occurred_at', { ascending: false }).limit(500),
      supabase.from('hse_actions').select('*').eq('status', 'open').order('due_date'),
      supabase.from('exec_projects').select('*'),
    ]);
    if (r.error) throw new Error(r.error.message);
    return { reports: (r.data ?? []) as HseReport[], actions: (a.data ?? []) as HseAction[], projects: (p.data ?? []) as ExecProject[] };
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const pname = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '';
  const since = addDaysISO(todayISO(), -90);
  const recent = data.reports.filter((r) => r.occurred_at.slice(0, 10) >= since);
  const lastLti = data.reports.filter((r) => r.lost_time).map((r) => r.occurred_at.slice(0, 10)).sort().pop();
  const mine = data.actions.filter((a) => a.assignee_id === me.id);
  const lead = me.role === 'senior_elec_engineer' || me.role === 'sm_projects' || me.role === 'gm';
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'HSE' }} />
      <TestingBanner what="HSE reporting" />
      <Row wrap gap={6}>
        {me.role !== 'gm' ? <Button title="+ Report incident / near miss / unsafe act" onPress={() => router.push('/execution/hse/new')} /> : null}
      </Row>
      {lead ? (
        <Grid min={150}>
          <Stat label="Open reports" value={data.reports.filter((r) => r.status === 'open').length} tone={data.reports.some((r) => r.status === 'open') ? 'amber' : 'green'} />
          <Stat label="Incidents (90 days)" value={recent.filter((r) => r.kind === 'incident').length} />
          <Stat label="Near misses (90 days)" value={recent.filter((r) => r.kind === 'near_miss').length} />
          <Stat label="Lost-time injuries" value={data.reports.filter((r) => r.lost_time).length} tone={data.reports.some((r) => r.lost_time) ? 'red' : 'green'} />
          <Stat label="Days since last LTI" value={lastLti ? Math.round((Date.parse(todayISO()) - Date.parse(lastLti)) / 864e5) : '—'} />
          <Stat label="Open actions" value={data.actions.length} tone={data.actions.some((a) => a.due_date < todayISO()) ? 'red' : undefined} />
        </Grid>
      ) : null}
      {mine.length ? (
        <Section title={`My corrective actions (${mine.length})`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {mine.map((a) => (
              <ListRow
                key={a.id}
                wrapRight
                onPress={() => router.push(`/execution/hse/${a.report_id}`)}
                highlight={a.due_date < todayISO() ? colors.red : undefined}
                title={a.action}
                subtitle={`due ${fmtDate(a.due_date)}`}
                right={<Pill label={a.due_date < todayISO() ? 'Overdue' : 'Open'} tone={a.due_date < todayISO() ? colors.red : colors.amber} />}
              />
            ))}
          </Card>
        </Section>
      ) : null}
      <Section title="Reports">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'open', label: 'Open', badge: data.reports.filter((r) => r.status === 'open').length }, { value: 'closed', label: 'Closed' }]} />
        <HseRows rows={data.reports.filter((r) => r.status === tab)} projectName={pname} />
      </Section>
    </Screen>
  );
}
