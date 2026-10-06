import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { useShellCounts } from '@/components/AppShell';
import { useDialog } from '@/components/dialog';
import { PlanWeek } from '@/components/exec/PlanWeek';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Loading, Muted, Notice, Pill, Row, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { PLAN_STATUS, type ExecMember, type ExecPlan, type PlanItem } from '@/lib/execution';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { loadProgramme, type Dep } from '@/lib/programme';
import { rpc, supabase } from '@/lib/supabase';

/** One weekly plan: the Senior Electrical Engineer approves or returns it; the owner edits it on the Plans page. */
export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { refresh } = useShellCounts();
  const { data, error, reload } = useLoad(async () => {
    const { data: pl, error: e } = await supabase.from('exec_plans').select('*, exec_projects(name, code)').eq('id', id).single();
    if (e) throw new Error(e.message);
    const plan = pl as ExecPlan & { exec_projects: { name: string; code: string } | null };
    const [its, mem] = await Promise.all([
      supabase.from('exec_plan_items').select('*').eq('plan_id', id).order('day'),
      supabase.from('exec_members').select('*').eq('exec_project_id', plan.exec_project_id).eq('active', true),
    ]);
    const programme = await loadProgramme(plan.exec_project_id);
    const ids = programme.acts.map((a) => a.id);
    const { data: dp } = ids.length ? await supabase.from('exec_activity_deps').select('*').in('succ_id', ids) : { data: [] };
    return { plan, items: (its.data ?? []) as PlanItem[], members: (mem.data ?? []) as ExecMember[], programme, deps: (dp ?? []) as Dep[] };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { plan, programme, deps } = data;
  const act = (aid: string) => programme.acts.find((a) => a.id === aid);
  const skipped = Object.entries(plan.skip_reasons ?? {});
  // Planned work on an activity whose finish-to-start predecessor is not finished yet
  const blocked = [...new Set(data.items.map((i) => i.activity_id).filter(Boolean) as string[])]
    .map((aid) => ({
      a: act(aid),
      open: deps.filter((d) => d.succ_id === aid && d.dep_type === 'FS').map((d) => act(d.pred_id)).filter((pr) => pr && !pr.actual_finish),
    }))
    .filter((x) => x.a && !x.a.actual_start && x.open.length);
  const unlinked = programme.live ? data.items.filter((i) => !i.activity_id).length : 0;
  const decide = async (approve: boolean) => {
    const r = await dialog.prompt({
      title: approve ? 'Approve the plan' : 'Return the plan',
      fields: [{ key: 'n', label: approve ? 'Comment (optional)' : 'What needs to change', type: 'multiline', required: !approve }],
      confirmLabel: approve ? 'Approve' : 'Return',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('decide_plan', { p_plan: plan.id, p_approve: approve, p_note: r.n || null });
        await reload();
        refresh();
      }, approve ? 'Approved – the engineer and supervisors are told' : 'Returned to the engineer');
  };
  return (
    <Screen onRefresh={reload} maxWidth={1000}>
      <Stack.Screen options={{ title: 'Weekly plan' }} />
      <TestingBanner what="Weekly and daily plans" />
      <Card>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{`${plan.exec_projects?.name ?? ''} · week of ${fmtDate(plan.week_start)}`}</Text>
          <Pill label={PLAN_STATUS[plan.status]} tone={plan.status === 'approved' ? colors.green : plan.status === 'returned' ? colors.red : colors.amber} solid />
        </Row>
        <Muted>{`${people[plan.ae_id]?.full_name ?? ''}${plan.submitted_at ? ` · submitted ${fmtDateTime(plan.submitted_at)}` : ''}${plan.is_late ? ' · late (after Saturday 17:00)' : ''}`}</Muted>
        {plan.decision_note ? <Notice tone={plan.status === 'returned' ? colors.red : colors.blue}>{plan.decision_note}</Notice> : null}
        {skipped.length ? (
          <Notice tone={colors.red}>
            {`Critical activities due this week but not planned:\n${skipped.map(([aid, why]) => `• ${act(aid)?.code ?? ''} ${act(aid)?.name ?? ''} – ${why}`).join('\n')}`}
          </Notice>
        ) : null}
        {blocked.length ? (
          <Notice tone={colors.amber}>
            {`Planned before the preceding work is finished:\n${blocked.map((b) => `• ${b.a?.code} ${b.a?.name} – waits for ${b.open.map((o) => `${o?.code} (${Math.round(Number(o?.pct ?? 0))}%)`).join(', ')}`).join('\n')}`}
          </Notice>
        ) : null}
        {unlinked ? <Notice tone={colors.amber}>{`${unlinked} item(s) not linked to a programme activity`}</Notice> : null}
        <Row wrap gap={6} style={{ marginTop: 8 }}>
          {plan.status === 'submitted' && me.role === 'senior_elec_engineer' ? (
            <>
              <Button title="Approve" onPress={() => decide(true)} />
              <Button variant="secondary" title="Return" onPress={() => decide(false)} />
            </>
          ) : null}
          {plan.ae_id === me.id ? (
            <Button variant="secondary" title="Edit on the Plans page" onPress={() => router.push({ pathname: '/execution/plans', params: { project: plan.exec_project_id, week: plan.week_start } })} />
          ) : null}
        </Row>
      </Card>
      <PlanWeek
        week={plan.week_start}
        items={data.items}
        project={plan.exec_project_id}
        supervisors={data.members.filter((m) => m.member_role === 'sub_supervisor')}
        canResult={plan.ae_id === me.id || me.role === 'senior_elec_engineer'}
        onChange={reload}
        programme={programme}
      />
    </Screen>
  );
}
