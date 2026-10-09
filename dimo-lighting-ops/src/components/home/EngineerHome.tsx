import { router, Stack } from 'expo-router';
import { Text } from 'react-native';
import { EngJobRows } from '@/components/EngJobRows';
import { TodayPlan } from '@/components/exec/TodayPlan';
import { SubProgress } from '@/components/home/SubProgress';
import { Button, Card, colors, ErrorBanner, Grid, ListRow, Loading, Muted, Notice, Row, Screen, Section, Stat } from '@/components/ui';
import { MyDayMeetings } from '@/components/WeekMeetings';
import { useMe } from '@/lib/auth';
import { ENG_SELECT, isOpen, isOverdue, type EngJob } from '@/lib/engJobs';
import { addDaysISO, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** My Day for the Senior Electrical Engineer and Assistant Engineers: what needs action, today, this week, the team, meetings, warranty. */
export function EngineerHome() {
  const me = useMe();
  const people = usePeople();
  const lead = me.role === 'senior_elec_engineer';
  const { data, error, reload } = useLoad(async () => {
    const [jobs, claims, hse] = await Promise.all([
      supabase.from('eng_jobs').select(ENG_SELECT).in('status', ['assigned', 'in_progress', 'on_hold']).order('due_date').limit(2000),
      supabase.from('warranty_claims').select('id, assignee_id, inspected_on, status').eq('status', 'open').limit(3000),
      supabase.from('hse_actions').select('id, report_id, action, due_date, assignee_id').eq('status', 'open').eq('assignee_id', me.id),
    ]);
    if (jobs.error) throw new Error(jobs.error.message);
    return { jobs: (jobs.data ?? []) as EngJob[], claims: (claims.data ?? []) as { id: string; assignee_id: string | null; inspected_on: string | null }[],
      hse: (hse.data ?? []) as { id: string; report_id: string; action: string; due_date: string }[] };
  });
  if (!data)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'My Day' }} />
        {error ? <ErrorBanner message={error} /> : <Loading />}
      </Screen>
    );

  const today = todayISO();
  const week = addDaysISO(today, 7);
  const mine = data.jobs.filter((j) => j.assignee_id === me.id);
  const scope = lead ? data.jobs : mine;
  // Subcontractor supervisors see engineering-job counters only when a job is assigned to them
  const showJobs = me.role !== 'sub_supervisor' || scope.length > 0;
  const toAccept = mine.filter((j) => j.status === 'assigned');
  const holds = scope.filter((j) => j.status === 'on_hold');
  const overdue = scope.filter(isOverdue);
  const todayList = scope.filter((j) => isOpen(j) && j.due_date <= today);
  const weekList = scope.filter((j) => isOpen(j) && j.due_date > today && j.due_date <= week);
  const ongoing = scope.filter((j) => j.status === 'in_progress');
  const noLocation = lead ? data.jobs.filter((j) => !j.site_address) : [];
  const myClaims = data.claims.filter((c) => c.assignee_id === me.id && !c.inspected_on);
  const unassignedClaims = lead ? data.claims.filter((c) => !c.assignee_id) : [];
  const engineers = [...new Set(data.jobs.map((j) => j.assignee_id))];
  const hello = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'My Day' }} />
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{`${hello}, ${me.full_name.split(' ')[0]}`}</Text>
      <Muted>{lead ? 'Your team’s engineering jobs, holds to review and deadlines.' : 'Your jobs for today and this week.'}</Muted>

      {showJobs ? (
      <Grid min={150}>
        {lead ? (
          <Stat label="Holds to review" value={holds.length} tone={holds.length ? 'red' : undefined} onPress={() => router.push({ pathname: '/engineering', params: { tab: 'on_hold' } })} />
        ) : (
          <Stat label="To accept" value={toAccept.length} tone={toAccept.length ? 'amber' : undefined} onPress={() => router.push({ pathname: '/engineering', params: { tab: 'assigned' } })} />
        )}
        <Stat label={lead ? 'Awaiting acceptance' : 'On hold'} value={lead ? scope.filter((j) => j.status === 'assigned').length : holds.length} tone="amber" onPress={() => router.push({ pathname: '/engineering', params: { tab: lead ? 'assigned' : 'on_hold' } })} />
        <Stat label="Ongoing" value={ongoing.length} onPress={() => router.push({ pathname: '/engineering', params: { tab: 'in_progress' } })} />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'red' : 'green'} onPress={() => router.push({ pathname: '/engineering', params: { tab: 'overdue' } })} />
        <Stat label="Due in 7 days" value={weekList.length} />
        {me.role === 'sub_supervisor' || me.role === 'trainee' ? null : <Stat label={lead ? 'Claims not assigned' : 'Claims to inspect'} value={lead ? unassignedClaims.length : myClaims.length} tone={(lead ? unassignedClaims : myClaims).length ? 'amber' : undefined} onPress={() => router.push('/warranty')} />}
      </Grid>
      ) : null}

      {lead ? (
        <Row wrap gap={6}>
          <Button title="+ Assign a job" onPress={() => router.push('/engineering/new')} />
          <Button variant="secondary" title="All jobs" onPress={() => router.push('/engineering')} />
          <Button variant="secondary" title="Execution projects" onPress={() => router.push('/execution')} />
          <Button variant="secondary" title="Team & access" onPress={() => router.push('/execution/team')} />
          <Button variant="secondary" title="Warranty" onPress={() => router.push('/warranty')} />
        </Row>
      ) : null}

      {me.role === 'sub_supervisor' || me.role === 'assistant_engineer' ? (
        <Row wrap gap={6}>
          <Button title="Daily report" onPress={() => router.push('/execution/reports')} />
          {me.role === 'assistant_engineer' ? <Button variant="secondary" title="Weekly plan" onPress={() => router.push('/execution/plans')} /> : null}
          <Button variant="secondary" title={me.role === 'sub_supervisor' ? 'My work' : 'My projects'} onPress={() => router.push('/execution')} />
        </Row>
      ) : null}
      {me.role === 'sub_supervisor' ? <SubProgress /> : null}
      <TodayPlan />

      {data.hse.length ? (
        <Section title={`HSE actions for you (${data.hse.length})`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.hse.map((h) => (
              <ListRow key={h.id} onPress={() => router.push(`/execution/hse/${h.report_id}`)} highlight={h.due_date < today ? colors.red : colors.amber} title={h.action} subtitle={`due ${h.due_date}`} />
            ))}
          </Card>
        </Section>
      ) : null}

      {!lead && toAccept.length ? (
        <Section title={`To accept (${toAccept.length})`}>
          <Notice tone={colors.amber}>Accept each job, or put it on hold with the reason – not accepting is reported to the Senior Electrical Engineer and SM Projects.</Notice>
          <EngJobRows jobs={toAccept} />
        </Section>
      ) : null}
      {lead && holds.length ? (
        <Section title={`On hold – review (${holds.length})`}>
          <EngJobRows jobs={holds} showEngineer />
        </Section>
      ) : null}
      {noLocation.length ? (
        <Section title={`Site location not set (${noLocation.length})`}>
          <Muted>Jobs from earlier meeting actions – set the job type and site location with Edit details so site visits can be GPS-checked.</Muted>
          <EngJobRows jobs={noLocation} showEngineer />
        </Section>
      ) : null}

      {showJobs ? (
      <>
      <Section title={`Today – due or overdue (${todayList.length})`}>
        <EngJobRows jobs={todayList} showEngineer={lead} empty="Nothing due today" />
      </Section>
      <Section title={`This week (${weekList.length})`}>
        <EngJobRows jobs={weekList} showEngineer={lead} empty="Nothing else due this week" />
      </Section>
      {!lead && holds.length ? (
        <Section title={`On hold – waiting for review (${holds.length})`}>
          <EngJobRows jobs={holds} />
        </Section>
      ) : null}
      <Section title={`Ongoing (${ongoing.length})`}>
        <EngJobRows jobs={ongoing} showEngineer={lead} empty="No ongoing jobs" />
      </Section>
      </>
      ) : null}

      {lead && engineers.length ? (
        <Section title="Team workload">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {engineers.map((id) => {
              const js = data.jobs.filter((j) => j.assignee_id === id);
              const late = js.filter(isOverdue).length;
              return (
                <ListRow
                  key={id}
                  highlight={late ? colors.red : undefined}
                  title={people[id]?.full_name ?? '—'}
                  subtitle={`${js.filter((j) => j.status === 'assigned').length} to accept · ${js.filter((j) => j.status === 'in_progress').length} ongoing · ${js.filter((j) => j.status === 'on_hold').length} on hold · ${late} overdue`}
                />
              );
            })}
          </Card>
        </Section>
      ) : null}

      <MyDayMeetings />
    </Screen>
  );
}
