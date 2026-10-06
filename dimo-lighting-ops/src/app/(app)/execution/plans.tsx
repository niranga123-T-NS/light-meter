import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { PlanItemRow } from '@/components/exec/PlanItemRow';
import { PlanWeek } from '@/components/exec/PlanWeek';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { PLAN_STATUS, weekOf, type ExecMember, type ExecPlan, type ExecProject, type PlanItem } from '@/lib/execution';
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** Weekly plans: Assistant Engineers plan each project week (due Saturday 17:00); the Senior Electrical Engineer approves. */
export default function Plans() {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const params = useLocalSearchParams<{ project?: string; week?: string }>();
  const ae = me.role === 'assistant_engineer';
  const nextWeek = addDaysISO(weekOf(todayISO()), 7);
  const [week, setWeek] = useState(params.week ?? nextWeek);
  const [project, setProject] = useState<string | null>(params.project ?? null);
  const { data, error, reload, loading } = useLoad(async () => {
    const [pr, pl, mem, items] = await Promise.all([
      supabase.from('exec_projects').select('*').eq('status', 'active').order('name'),
      supabase.from('exec_plans').select('*').gte('week_start', addDaysISO(weekOf(todayISO()), -7)).order('week_start'),
      supabase.from('exec_members').select('*').eq('active', true),
      supabase.from('exec_plan_items').select('*').eq('source', 'supervisor').eq('acceptance', 'pending'),
    ]);
    if (pr.error) throw new Error(pr.error.message);
    return { projects: (pr.data ?? []) as ExecProject[], plans: (pl.data ?? []) as ExecPlan[], members: (mem.data ?? []) as ExecMember[], pendingAdds: (items.data ?? []) as PlanItem[] };
  });
  const myProjects = (data?.projects ?? []).filter((p) => !ae || data?.members.some((m) => m.exec_project_id === p.id && m.user_id === me.id));
  const proj = project ?? myProjects[0]?.id ?? null;
  const { data: weekData, reload: reloadWeek } = useLoad(async () => {
    if (!ae || !proj) return null;
    const { data: pl } = await supabase.from('exec_plans').select('*').eq('exec_project_id', proj).eq('ae_id', me.id).eq('week_start', week).maybeSingle();
    const { data: its } = pl ? await supabase.from('exec_plan_items').select('*').eq('plan_id', pl.id).order('day') : { data: [] };
    return { plan: pl as ExecPlan | null, items: (its ?? []) as PlanItem[] };
  }, [proj, week, ae]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const refresh = async () => {
    await reload();
    await reloadWeek();
  };
  const toApprove = data.plans.filter((p) => p.status === 'submitted');
  const pname = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '';
  const supervisors = data.members.filter((m) => m.exec_project_id === proj && m.member_role === 'sub_supervisor');
  const plan = weekData?.plan ?? null;
  const editable = !plan || plan.status === 'draft' || plan.status === 'returned' || plan.status === 'approved';
  const deadline = addDaysISO(week, -2);

  return (
    <Screen refreshing={loading} onRefresh={refresh}>
      <Stack.Screen options={{ title: 'Plans' }} />
      <TestingBanner what="Weekly and daily plans" />
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
              {plan ? <Pill label={PLAN_STATUS[plan.status]} tone={plan.status === 'approved' ? colors.green : plan.status === 'returned' ? colors.red : colors.amber} /> : null}
            </Row>
            {plan?.decision_note ? <Notice tone={plan.status === 'returned' ? colors.red : colors.blue}>{plan.decision_note}</Notice> : null}
            <Muted>{`Submit by Saturday ${fmtDate(deadline)} 17:00 – the Senior Electrical Engineer approves. Supervisors see their items each day.`}</Muted>
          </Card>
          {proj ? (
            <PlanWeek week={week} items={weekData?.items ?? []} edit={editable} project={proj} supervisors={supervisors} canResult onChange={refresh} />
          ) : (
            <Empty title="You are not on any execution project" />
          )}
          {plan && (plan.status === 'draft' || plan.status === 'returned') && weekData?.items.length ? (
            <Row style={{ justifyContent: 'flex-end' }}>
              <Button title="Submit for approval" onPress={() => dialog.run(async () => { await rpc('submit_plan', { p_plan: plan.id }); await refresh(); }, 'Submitted to the Senior Electrical Engineer')} />
            </Row>
          ) : null}
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
