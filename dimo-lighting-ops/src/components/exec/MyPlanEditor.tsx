import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Muted, Notice, Pill, Row } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { PLAN_STATUS, type ExecMember, type ExecPlan, type PlanItem } from '@/lib/execution';
import { addDaysISO, fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { loadProgramme } from '@/lib/programme';
import { rpc, supabase } from '@/lib/supabase';
import { PlanWeek } from './PlanWeek';

/**
 * The Assistant Engineer's own plan for one project week: add, change and remove items day by day, then submit to the
 * Senior Electrical Engineer (due Saturday 17:00 before the week). Used on the project's Plan tab and on the Plans screen.
 */
export function MyPlanEditor({ project, week, onChange }: { project: string; week: string; onChange?: () => void }) {
  const me = useMe();
  const dialog = useDialog();
  const { data, reload } = useLoad(async () => {
    const [{ data: pl }, mem] = await Promise.all([
      supabase.from('exec_plans').select('*').eq('exec_project_id', project).eq('ae_id', me.id).eq('week_start', week).maybeSingle(),
      supabase.from('exec_members').select('*').eq('exec_project_id', project).eq('active', true),
    ]);
    const { data: its } = pl ? await supabase.from('exec_plan_items').select('*').eq('plan_id', pl.id).order('day') : { data: [] };
    return {
      plan: pl as ExecPlan | null,
      items: (its ?? []) as PlanItem[],
      supervisors: ((mem.data ?? []) as ExecMember[]).filter((m) => m.member_role === 'sub_supervisor'),
      programme: await loadProgramme(project),
    };
  }, [project, week, me.id]);
  const refresh = async () => {
    await reload();
    onChange?.();
  };
  const plan = data?.plan ?? null;
  const editable = !plan || plan.status === 'draft' || plan.status === 'returned' || plan.status === 'approved';
  const deadline = addDaysISO(week, -2);

  // Critical activities due this week must be planned, or the reason given (shown to the SEE)
  const submit = async () => {
    if (!plan) return;
    const missing = await rpc<{ activity_id: string; code: string; name: string; es: string; ef: string }[]>('plan_missing_critical', { p_plan: plan.id });
    let reasons: Record<string, string> = {};
    if (missing.length) {
      const r = await dialog.prompt({
        title: 'Critical activities not in this plan',
        message: 'These critical activities are due this week. Cancel and plan them, or give the reason for each – the Senior Electrical Engineer sees it.',
        fields: missing.map((m) => ({ key: m.activity_id, label: `${m.code} ${m.name} (${fmtDate(m.es)} → ${fmtDate(m.ef)})`, type: 'multiline' as const, required: true })),
        confirmLabel: 'Submit with reasons',
      });
      if (!r) return;
      reasons = r;
    }
    await dialog.run(async () => {
      await rpc('submit_plan', { p_plan: plan.id, p_reasons: reasons });
      await refresh();
    }, 'Submitted to the Senior Electrical Engineer');
  };

  return (
    <>
      <Card style={{ gap: 4, borderLeftWidth: 4, borderLeftColor: colors.brand }}>
        <Row wrap gap={8} style={{ alignItems: 'center' }}>
          <Muted style={{ fontWeight: '700', color: colors.ink }}>{`My plan – week of ${fmtDate(week)}`}</Muted>
          <Pill
            label={plan ? PLAN_STATUS[plan.status] : 'Not started'}
            tone={plan?.status === 'approved' ? colors.green : plan?.status === 'returned' ? colors.red : plan ? colors.amber : colors.grey}
          />
        </Row>
        {plan?.decision_note ? <Notice tone={plan.status === 'returned' ? colors.red : colors.blue}>{plan.decision_note}</Notice> : null}
        <Muted>
          {plan?.status === 'submitted'
            ? 'Waiting for the Senior Electrical Engineer – it can change after the decision.'
            : week <= todayISO()
              ? 'This week is under way – tap “+ Add” to plan the remaining days. Supervisors see their items each day.'
              : `Tap “+ Add” on a day to plan the work. Submit by Saturday ${fmtDate(deadline)} 17:00 – the Senior Electrical Engineer approves; supervisors see their items each day.`}
        </Muted>
      </Card>
      <PlanWeek week={week} items={data?.items ?? []} edit={editable} project={project} supervisors={data?.supervisors ?? []} canResult onChange={refresh} programme={data?.programme} />
      {plan && (plan.status === 'draft' || plan.status === 'returned') && data?.items.length ? (
        <Row style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <Button title="Submit for approval" onPress={submit} />
        </Row>
      ) : null}
    </>
  );
}
