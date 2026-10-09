import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { PlanItemRow } from '@/components/exec/PlanItemRow';
import { MyPlanEditor } from '@/components/exec/MyPlanEditor';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Loading, Muted, Pill, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { PLAN_STATUS, weekOf, type ExecMember, type ExecPlan, type ExecProject, type PlanItem } from '@/lib/execution';
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** Weekly plans: Assistant Engineers plan each project week (due Saturday 17:00); the Senior Electrical Engineer approves. */
export default function Plans() {
  const me = useMe();
  const people = usePeople();
  const params = useLocalSearchParams<{ project?: string; week?: string }>();
  const ae = me.role === 'assistant_engineer';
  const nextWeek = addDaysISO(weekOf(todayISO()), 7);
  const [week, setWeek] = useState(params.week ?? nextWeek);
  const [project, setProject] = useState<string | null>(params.project ?? null);
  const { data, error, reload, loading } = useLoad(async () => {
    const [pr, pl, mem, items, subPlans] = await Promise.all([
      supabase.from('exec_projects').select('*').eq('status', 'active').order('name'),
      supabase.from('exec_plans').select('*').gte('week_start', addDaysISO(weekOf(todayISO()), -7)).order('week_start'),
      supabase.from('exec_members').select('*').eq('active', true),
      supabase.from('exec_plan_items').select('*').eq('source', 'supervisor').eq('acceptance', 'pending'),
      supabase.rpc('sub_plans_to_approve'),
    ]);
    if (pr.error) throw new Error(pr.error.message);
    return { projects: (pr.data ?? []) as ExecProject[], plans: (pl.data ?? []) as ExecPlan[], members: (mem.data ?? []) as ExecMember[], pendingAdds: (items.data ?? []) as PlanItem[], subPlans: (subPlans.data ?? []) as { id: string; exec_project_id: string; supervisor_id: string; week_start: string; submitted_at: string; items: number }[] };
  });
  const myProjects = (data?.projects ?? []).filter((p) => !ae || data?.members.some((m) => m.exec_project_id === p.id && m.user_id === me.id));
  const proj = project ?? myProjects[0]?.id ?? null;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const refresh = reload;
  const toApprove = data.plans.filter((p) => p.status === 'submitted');
  const pname = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '';
  return (
    <Screen refreshing={loading} onRefresh={refresh}>
      <Stack.Screen options={{ title: 'Plans' }} />
      <TestingBanner what="Weekly and daily plans" />
      {data.subPlans.length ? (
        <Section title={`Subcontractor plans to approve (${data.subPlans.length})`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.subPlans.map((p) => (
              <ListRow
                key={p.id}
                onPress={() => router.push({ pathname: '/execution/sub-plan', params: { plan: p.id } })}
                title={`${people[p.supervisor_id]?.full_name ?? ''} · week of ${fmtDate(p.week_start)}`}
                subtitle={`${pname(p.exec_project_id)} · ${p.items} item(s) · submitted ${fmtDateTime(p.submitted_at)}`}
              />
            ))}
          </Card>
        </Section>
      ) : null}
      {data.pendingAdds.length ? (
        <Section title={`Tasks added by supervisors – accept or reject (${data.pendingAdds.length})`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.pendingAdds.map((it) => (
              <PlanItemRow key={it.id} it={it} onChange={refresh} canResult={false} showDay />
            ))}
          </Card>
        </Section>
      ) : null}
      {me.role === 'senior_elec_engineer' ? (
        <Section title={`To approve (${toApprove.length})`}>
          {toApprove.length ? (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {toApprove.map((p) => (
                <ListRow
                  key={p.id}
                  onPress={() => router.push(`/execution/plan/${p.id}`)}
                  title={`${people[p.ae_id]?.full_name ?? ''} · week of ${fmtDate(p.week_start)}`}
                  subtitle={`${pname(p.exec_project_id)} · submitted ${fmtDateTime(p.submitted_at)}${p.is_late ? ' · late' : ''}`}
                  highlight={p.is_late ? colors.red : undefined}
                />
              ))}
            </Card>
          ) : (
            <Empty title="No plans waiting" />
          )}
        </Section>
      ) : null}
      {ae ? (
        <Section title="My weekly plan">
          <Card>
            <Select label="Project" value={proj} onChange={setProject} options={myProjects.map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))} />
            <Row wrap gap={6} style={{ alignItems: 'center' }}>
              <Button small variant="secondary" title="‹ Week" onPress={() => setWeek(addDaysISO(week, -7))} />
              <Muted>{`Week of ${fmtDate(week)}`}</Muted>
              <Button small variant="secondary" title="Week ›" onPress={() => setWeek(addDaysISO(week, 7))} />
            </Row>
          </Card>
          {proj ? <MyPlanEditor project={proj} week={week} onChange={reload} /> : <Empty title="You are not on any execution project" />}
        </Section>
      ) : null}
      <Section title="Plans this week and next">
        {data.plans.filter((p) => p.week_start >= weekOf(todayISO())).length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.plans
              .filter((p) => p.week_start >= weekOf(todayISO()))
              .map((p) => (
                <ListRow
                  key={p.id}
                  wrapRight
                  onPress={() => router.push(`/execution/plan/${p.id}`)}
                  title={`${pname(p.exec_project_id)} · week of ${fmtDate(p.week_start)}`}
                  subtitle={people[p.ae_id]?.full_name}
                  right={<Pill label={PLAN_STATUS[p.status]} tone={p.status === 'approved' ? colors.green : p.status === 'returned' ? colors.red : colors.amber} />}
                />
              ))}
          </Card>
        ) : (
          <Empty title="No plans yet" />
        )}
      </Section>
    </Screen>
  );
}
