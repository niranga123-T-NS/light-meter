import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Loading, Muted, Notice, Pill, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { weekOf, type ExecProject } from '@/lib/execution';
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type SubPlan = { id: string; exec_project_id: string; supervisor_id: string; week_start: string; status: 'draft' | 'submitted' | 'approved' | 'returned'; submitted_at: string | null; decided_by: string | null; decided_at: string | null; decision_note: string | null };
type Item = { id: string; day: string; ae_item_id: string | null; title: string; zone: string | null; qty: number | null; unit: string | null; crew: number | null; additional: boolean; status: 'planned' | 'done' | 'partial' | 'not_done'; done_qty: number | null; result_note: string | null };
type AeItem = { id: string; day: string; kind: string; title: string; zone: string | null; qty: number | null; unit: string | null; engineer: string; mine: boolean; picked: boolean };

const STATUS: Record<SubPlan['status'], { label: string; tone: string }> = {
  draft: { label: 'Draft – pick the work and submit', tone: colors.grey },
  submitted: { label: 'With the Assistant Engineer to approve', tone: colors.amber },
  approved: { label: 'Approved', tone: colors.green },
  returned: { label: 'Returned with comments', tone: colors.red },
};
const RESULT: Record<Item['status'], { label: string; tone: string }> = {
  planned: { label: 'Planned', tone: colors.grey },
  done: { label: 'Done', tone: colors.green },
  partial: { label: 'Partly done', tone: colors.amber },
  not_done: { label: 'Not done', tone: colors.red },
};
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Subcontractor weekly / daily plan: items picked from the engineers' approved plans + additional works; the AE approves. */
export default function SubPlanScreen() {
  const params = useLocalSearchParams<{ plan?: string; project?: string; week?: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const sup = me.role === 'sub_supervisor';
  const [project, setProject] = useState<string | null>(params.project ?? null);
  const [week, setWeek] = useState(params.week ?? weekOf(todayISO()));
  const { data, error, reload } = useLoad(async () => {
    const projects = sup ? (((await supabase.from('exec_projects').select('*').eq('status', 'active').order('name')).data ?? []) as ExecProject[]) : [];
    let planId = params.plan ?? null;
    const proj = project ?? projects[0]?.id ?? null;
    if (!planId && sup && proj) planId = await rpc<string>('my_sub_plan', { p_exec: proj, p_week: week });
    if (!planId) return { projects, plan: null, items: [] as Item[], ae: [] as AeItem[], projectName: '' };
    const [{ data: pl, error: e }, { data: it }, ae] = await Promise.all([
      supabase.from('sub_plans').select('*, exec_projects(code, name)').eq('id', planId).single(),
      supabase.from('sub_plan_items').select('*').eq('sub_plan_id', planId).order('day').order('created_at'),
      rpc<AeItem[]>('sub_plan_ae_items', { p_plan: planId }),
    ]);
    if (e) throw new Error(e.message);
    const p = pl as SubPlan & { exec_projects: { code: string | null; name: string } | null };
    return { projects, plan: p as SubPlan, items: (it ?? []) as Item[], ae, projectName: `${p.exec_projects?.code ?? ''} ${p.exec_projects?.name ?? ''}` };
  }, [params.plan, project, week]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { plan } = data;
  const mine = !!plan && plan.supervisor_id === me.id;
  const editable = mine && (plan.status === 'draft' || plan.status === 'returned');
  const approver = !!plan && plan.status === 'submitted' && (me.role === 'assistant_engineer' || me.role === 'senior_elec_engineer');
  const run = (fn: string, args: Record<string, unknown>, ok?: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);

  const extra = async (day: string, it?: Item) => {
    const r = await dialog.prompt({
      title: it ? 'Edit additional work' : `Additional work – ${DAY[(new Date(`${day}T00:00:00`).getDay() + 6) % 7]} ${fmtDate(day)}`,
      fields: [
        { key: 'title', label: 'Work', required: true, initial: it?.title ?? '' },
        { key: 'zone', label: 'Zone / location', initial: it?.zone ?? '' },
        { key: 'qty', label: 'Quantity', initial: it?.qty != null ? String(it.qty) : '' },
        { key: 'unit', label: 'Unit', initial: it?.unit ?? '' },
        { key: 'crew', label: 'Crew (people)', initial: it?.crew != null ? String(it.crew) : '' },
      ],
      confirmLabel: 'Save',
    });
    if (r) await run('save_sub_plan_extra', { p_plan: plan!.id, p_id: it?.id ?? null, p: { ...r, day } }, 'Saved');
  };
  const result = async (it: Item) => {
    const r = await dialog.prompt({
      title: it.title,
      fields: [
        { key: 's', label: 'Result', type: 'select', required: true, initial: it.status === 'planned' ? 'done' : it.status, options: [{ value: 'done', label: 'Done' }, { value: 'partial', label: 'Partly done' }, { value: 'not_done', label: 'Not done' }, { value: 'planned', label: 'Still planned' }] },
        { key: 'q', label: `Quantity done${it.unit ? ` (${it.unit})` : ''}`, initial: it.done_qty != null ? String(it.done_qty) : '' },
        { key: 'n', label: 'Note / reason (needed if partly or not done)', type: 'multiline', initial: it.result_note ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (r) await run('update_sub_plan_item', { p_id: it.id, p_status: r.s, p_qty: r.q ? Number(r.q) : null, p_note: r.n || null }, 'Updated');
  };

  const days = plan ? Array.from({ length: 7 }, (_, i) => addDaysISO(plan.week_start, i)) : [];
  const today = todayISO();

  return (
    <Screen maxWidth={980} onRefresh={reload}>
      <Stack.Screen options={{ title: sup ? 'My plan' : 'Subcontractor plan' }} />
      <TestingBanner what="Subcontractor plans" />
      {sup ? (
        <Card>
          <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 1, minWidth: 240 }}>
              <Select label="Project" value={project ?? data.projects[0]?.id ?? null} onChange={setProject} options={data.projects.map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))} />
            </View>
            <Button small variant="secondary" title="◀ Week" onPress={() => setWeek(addDaysISO(week, -7))} />
            <Text style={{ fontWeight: '700', color: colors.ink, paddingBottom: 8 }}>{`Week of ${fmtDate(week)}`}</Text>
            <Button small variant="secondary" title="Week ▶" onPress={() => setWeek(addDaysISO(week, 7))} />
          </Row>
          {!data.projects.length ? <Muted>No project yet – it shows here once you are appointed to one.</Muted> : null}
        </Card>
      ) : null}
      {plan ? (
        <>
          <Card>
            <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{`${people[plan.supervisor_id]?.full_name ?? ''} · week of ${fmtDate(plan.week_start)}`}</Text>
              <Pill label={STATUS[plan.status].label} tone={STATUS[plan.status].tone} solid={plan.status === 'approved'} />
            </Row>
            <Muted>{data.projectName}</Muted>
            {plan.submitted_at ? <Muted>{`Submitted ${fmtDateTime(plan.submitted_at)}`}</Muted> : null}
            {plan.decided_at ? <Muted>{`${plan.status === 'returned' ? 'Returned' : 'Approved'} by ${people[plan.decided_by ?? '']?.full_name ?? ''} · ${fmtDateTime(plan.decided_at)}${plan.decision_note ? ` – ${plan.decision_note}` : ''}`}</Muted> : null}
          </Card>
          {plan.status === 'returned' ? <Notice tone={colors.red}>{`Returned: ${plan.decision_note ?? ''} – correct the plan and submit again.`}</Notice> : null}
          {editable ? (
            <Notice tone={colors.blue}>Tick the items of the engineers&apos; approved plan your team will do each day, add any additional work, then submit – an Assistant Engineer of the project approves it.</Notice>
          ) : null}
          {!data.ae.length && editable ? <Muted>No approved engineer plan for this week yet – the items appear here once the Senior Electrical Engineer approves the engineers&apos; plans.</Muted> : null}

          {days.map((d, i) => {
            const aeDay = data.ae.filter((x) => x.day === d);
            const items = data.items.filter((x) => x.day === d);
            if (!editable && !items.length) return null;
            return (
              <Section key={d} title={`${DAY[i]} ${fmtDate(d)}${d === today ? ' · today' : ''}`}>
                <Card>
                  {editable && aeDay.length ? (
                    <>
                      <Muted>From the engineers&apos; approved plan</Muted>
                      {aeDay.map((x) => (
                        <Pressable key={x.id} onPress={() => run('pick_sub_plan_item', { p_plan: plan.id, p_ae_item: x.id, p_on: !x.picked })}>
                          <Row gap={8} style={{ paddingVertical: 5, alignItems: 'center' }}>
                            <Text style={{ fontSize: 18, color: x.picked ? colors.green : colors.muted }}>{x.picked ? '☑' : '☐'}</Text>
                            <Text style={{ color: colors.ink, flexShrink: 1 }}>
                              {`${x.title}${x.zone ? ` · ${x.zone}` : ''}${x.qty != null ? ` · ${x.qty} ${x.unit ?? ''}` : ''}`}
                            </Text>
                            <Muted>{`${x.engineer}${x.mine ? ' · given to you' : ''}`}</Muted>
                          </Row>
                        </Pressable>
                      ))}
                    </>
                  ) : null}
                  {items.filter((x) => !editable || x.additional).length ? (
                    <>
                      {editable ? <Muted style={{ marginTop: 6 }}>Additional work</Muted> : null}
                      {items
                        .filter((x) => !editable || x.additional)
                        .map((x) => (
                          <Row key={x.id} wrap gap={8} style={{ paddingVertical: 5, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line }}>
                            {x.additional ? <Pill label="Additional" tone={colors.blue} /> : <Pill label="Engineer plan" tone={colors.grey} />}
                            <Text style={{ color: colors.ink, flexShrink: 1 }}>
                              {`${x.title}${x.zone ? ` · ${x.zone}` : ''}${x.qty != null ? ` · ${x.qty} ${x.unit ?? ''}` : ''}${x.crew ? ` · crew ${x.crew}` : ''}`}
                            </Text>
                            {plan.status === 'approved' ? <Pill label={RESULT[x.status].label} tone={RESULT[x.status].tone} /> : null}
                            {x.result_note ? <Muted>{x.result_note}</Muted> : null}
                            {editable && x.additional ? (
                              <Row gap={4}>
                                <Button small variant="ghost" title="Edit" onPress={() => extra(d, x)} />
                                <Button small variant="ghost" title="Remove" onPress={() => run('delete_sub_plan_item', { p_id: x.id })} />
                              </Row>
                            ) : null}
                            {mine && plan.status === 'approved' && d <= today ? <Button small variant="secondary" title="Update" onPress={() => result(x)} /> : null}
                          </Row>
                        ))}
                    </>
                  ) : null}
                  {editable ? (
                    <Row style={{ marginTop: 6 }}>
                      <Button small variant="secondary" title="+ Additional work" onPress={() => extra(d)} />
                    </Row>
                  ) : null}
                </Card>
              </Section>
            );
          })}
          {!editable && !data.items.length ? <Muted>Nothing planned this week.</Muted> : null}

          <Row wrap gap={8}>
            {editable ? <Button title={plan.status === 'returned' ? 'Submit again' : 'Submit to the Assistant Engineer'} disabled={!data.items.length} onPress={() => run('submit_sub_plan', { p_plan: plan.id }, 'Submitted')} /> : null}
            {approver ? (
              <>
                <Button title="Approve" onPress={() => run('decide_sub_plan', { p_plan: plan.id, p_ok: true }, 'Approved')} />
                <Button
                  variant="danger"
                  title="Return with comments"
                  onPress={async () => {
                    const r = await dialog.prompt({ title: 'Return the plan', fields: [{ key: 'n', label: 'Comments', type: 'multiline', required: true }], confirmLabel: 'Return', danger: true });
                    if (r) await run('decide_sub_plan', { p_plan: plan.id, p_ok: false, p_note: r.n }, 'Returned');
                  }}
                />
              </>
            ) : null}
            {!sup ? <Button variant="ghost" title="Back to plans" onPress={() => router.push('/execution/plans')} /> : null}
          </Row>
        </>
      ) : null}
    </Screen>
  );
}
