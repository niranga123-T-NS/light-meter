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
    const adds: { id: string; name: string; day: string }[] = [];
    if (missing.length) {
      // Each activity: add it to this plan on one of its days this week, or say why not
      const dayOptions = (m: { es: string; ef: string }) => {
        const out: { value: string; label: string }[] = [];
        for (let d = m.es > week ? m.es : week; d <= addDaysISO(week, 6) && d <= m.ef; d = addDaysISO(d, 1)) out.push({ value: d, label: `Add to the plan on ${fmtDate(d)}` });
        return out;
      };
      const r = await dialog.prompt({
        title: 'Critical activities not in this plan',
        message: 'These critical activities of yours are due this week. Add each to the plan in one step, or choose "Not this week" and give the reason – the Senior Electrical Engineer sees it.',
        fields: missing.flatMap((m) => {
          const days = dayOptions(m);
          return [
            {
              key: `${m.activity_id}:a`,
              label: `${m.code} ${m.name} (${fmtDate(m.es)} → ${fmtDate(m.ef)})`,
              type: 'select' as const,
              required: true,
              initial: days[0]?.value ?? 'reason',
              options: [...days, { value: 'reason', label: 'Not this week – give the reason' }],
            },
            { key: `${m.activity_id}:r`, label: 'Reason (only if not this week)', type: 'multiline' as const },
          ];
        }),
        confirmLabel: 'Submit plan',
      });
      if (!r) return;
      for (const m of missing) {
        const choice = r[`${m.activity_id}:a`];
        if (choice && choice !== 'reason') adds.push({ id: m.activity_id, name: m.name, day: choice });
        else if (!r[`${m.activity_id}:r`]?.trim()) return dialog.toast(`Give the reason for ${m.code} ${m.name}, or add it to the plan`, 'error');
        else reasons[m.activity_id] = r[`${m.activity_id}:r`].trim();
      }
    }
    await dialog.run(async () => {
      for (const x of adds) await rpc('save_plan_item', { p_exec: project, p_week: week, p: { id: '', day: x.day, kind: 'task', title: x.name, activity_id: x.id } });
      await rpc('submit_plan', { p_plan: plan.id, p_reasons: reasons });
      await refresh();
    }, adds.length ? `${adds.length} critical ${adds.length === 1 ? 'activity' : 'activities'} added – submitted to the Senior Electrical Engineer` : 'Submitted to the Senior Electrical Engineer');
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
