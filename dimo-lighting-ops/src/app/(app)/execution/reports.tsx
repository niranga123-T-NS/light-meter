import { router, Stack } from 'expo-router';
import { ReportRows } from '@/components/exec/ReportRows';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Loading, Muted, Pill, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecMember, ExecProject, ExecReport } from '@/lib/execution';
import { addDaysISO, fmtDate, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Late = { exec_project_id: string; user_id: string; report_date: string; level: string; kind: 'missing' | 'late' };

/** Daily reports: write today's, verify the supervisors' (AE), review the engineers' and see who is late (SEE). */
export default function Reports() {
  const me = useMe();
  const people = usePeople();
  const writer = me.role === 'sub_supervisor' || me.role === 'assistant_engineer';
  const { data, error, reload, loading } = useLoad(async () => {
    const since = addDaysISO(todayISO(), -14);
    const [rep, pr, mem, late] = await Promise.all([
      supabase.from('exec_reports').select('*').gte('report_date', since).order('report_date', { ascending: false }).order('submitted_at', { ascending: false }),
      supabase.from('exec_projects').select('*').eq('status', 'active'),
      supabase.from('exec_members').select('*').eq('active', true).eq('user_id', me.id),
      supabase.from('exec_report_lateness').select('*').gte('report_date', since).order('report_date', { ascending: false }),
    ]);
    if (rep.error) throw new Error(rep.error.message);
    return { reports: (rep.data ?? []) as ExecReport[], projects: (pr.data ?? []) as ExecProject[], mine: (mem.data ?? []) as ExecMember[], late: (late.data ?? []) as Late[] };
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const today = todayISO();
  const pname = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '';
  const toVerify = data.reports.filter((r) => r.status === 'submitted' && r.author_id !== me.id && (me.role === 'senior_elec_engineer' ? r.level === 'ae' : me.role === 'assistant_engineer' && r.level === 'supervisor'));
  const mineToday = data.mine.map((m) => ({ m, r: data.reports.find((r) => r.exec_project_id === m.exec_project_id && r.author_id === me.id && r.report_date === today) }));
  const byPerson = [...new Set(data.late.map((l) => l.user_id))].map((u) => ({ u, rows: data.late.filter((l) => l.user_id === u) }));

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Daily reports' }} />
      <TestingBanner what="Daily reports" />
      {writer ? (
        <Section title={`Today – due ${me.role === 'sub_supervisor' ? '18:00' : '20:00'}`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {mineToday.map(({ m, r }) => (
              <ListRow
                key={m.id}
                wrapRight
                title={pname(m.exec_project_id)}
                subtitle={r ? `Submitted · ${r.status}` : 'Not submitted yet'}
                highlight={r ? undefined : colors.amber}
                right={
                  r ? (
                    <Button small variant="secondary" title="Open" onPress={() => router.push(`/execution/report/${r.id}`)} />
                  ) : (
                    <Button small title="Write report" onPress={() => router.push({ pathname: '/execution/report/new', params: { project: m.exec_project_id, date: today } })} />
                  )
                }
              />
            ))}
            {!mineToday.length ? <Muted style={{ padding: 12 }}>You are not on any execution project</Muted> : null}
          </Card>
        </Section>
      ) : null}
      {me.role === 'assistant_engineer' || me.role === 'senior_elec_engineer' ? (
        <Section title={`${me.role === 'senior_elec_engineer' ? 'Engineer reports to review' : 'Supervisor reports to verify'} (${toVerify.length})`}>
          <ReportRows rows={toVerify} projectName={pname} empty="Nothing waiting" />
        </Section>
      ) : null}
      {me.role === 'senior_elec_engineer' || me.role === 'sm_projects' || me.role === 'gm' ? (
        <Section title="Late or missing – last 14 days">
          {byPerson.length ? (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {byPerson.map(({ u, rows }) => (
                <ListRow
                  key={u}
                  wrapRight
                  highlight={rows.length >= 3 ? colors.red : colors.amber}
                  title={people[u]?.full_name ?? '—'}
                  subtitle={rows.map((l) => `${fmtDate(l.report_date)} ${l.kind}`).join(' · ')}
                  right={<Pill label={`${rows.length} days`} tone={rows.length >= 3 ? colors.red : colors.amber} />}
                />
              ))}
            </Card>
          ) : (
            <Empty title="Everyone on time" />
          )}
        </Section>
      ) : null}
      <Section title="Recent reports">
        <ReportRows rows={data.reports.slice(0, 60)} projectName={pname} />
      </Section>
    </Screen>
  );
}
