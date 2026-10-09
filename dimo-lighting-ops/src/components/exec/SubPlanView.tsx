import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Loading, Muted, Notice, Pill, Row, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { weekOf, type ExecProject } from '@/lib/execution';
import { addDaysISO, fmtDate, fmtDateTime, fmtTime, todayISO } from '@/lib/format';
import { siteFix } from '@/lib/site';
import { formName, loadHseForms, PERMIT_STATUS, type HseRecord } from '@/lib/hse';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type SubPlan = { id: string; exec_project_id: string; supervisor_id: string; week_start: string; status: 'draft' | 'submitted' | 'approved' | 'returned'; submitted_at: string | null; decided_by: string | null; decided_at: string | null; decision_note: string | null };
type Item = { id: string; day: string; ae_item_id: string | null; title: string; zone: string | null; qty: number | null; unit: string | null; crew: number | null; additional: boolean; status: 'planned' | 'done' | 'partial' | 'not_done'; done_qty: number | null; result_note: string | null; activity_id: string | null };
type AeItem = { id: string; day: string; kind: string; title: string; zone: string | null; qty: number | null; unit: string | null; engineer: string; mine: boolean; picked: boolean; activity: string | null };
type Link = { item_id: string; permit_id: string };
type Permit = Pick<HseRecord, 'id' | 'code' | 'status' | 'starts_at' | 'ends_at' | 'header' | 'late_request' | 'created_by'>;
type Checkin = { id: string; day: string; at: string; distance_m: number; within: boolean };
type Tbt = { id: string; code: string; starts_at: string; tbt_late: boolean };

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

/** The Sri Lanka date of a timestamp */
const slDay = (ts: string | null) => (ts ? new Date(new Date(ts).getTime() + 330 * 60000).toISOString().slice(0, 10) : '');
const covers = (r: Permit, day: string) => !!r.starts_at && !!r.ends_at && slDay(r.starts_at) <= day && day <= slDay(r.ends_at);

/** Subcontractor weekly / daily plan: items picked from the engineers' approved plans, the programme activities given to the
 *  company and additional works; the AE approves. Each day the supervisor requests the work permits for the planned work. With `fixedProject` it
 *  is the supervisor's plan of that project (the project's Planning tab). */
export function SubPlanView({ plan: planParam, project: projectParam, week: weekParam, fixedProject }: { plan?: string; project?: string; week?: string; fixedProject?: boolean }) {
  const params = { plan: planParam, project: projectParam, week: weekParam };
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
    if (!planId) return { projects, plan: null, items: [] as Item[], ae: [] as AeItem[], permits: [] as Permit[], links: [] as Link[], checkins: [] as Checkin[], tbts: [] as Tbt[], projectName: '' };
    const [{ data: pl, error: e }, { data: it }, ae] = await Promise.all([
      supabase.from('sub_plans').select('*, exec_projects(code, name)').eq('id', planId).single(),
      supabase.from('sub_plan_items').select('*').eq('sub_plan_id', planId).order('day').order('created_at'),
      rpc<AeItem[]>('sub_plan_ae_items', { p_plan: planId }),
    ]);
    if (e) throw new Error(e.message);
    const p = pl as SubPlan & { exec_projects: { code: string | null; name: string } | null };
    const items = (it ?? []) as Item[];
    const { data: ln } = items.length ? await supabase.from('sub_plan_item_permits').select('*').in('item_id', items.map((x) => x.id)) : { data: [] };
    const { data: pm } = await supabase
      .from('hse_records')
      .select('id, code, status, starts_at, ends_at, header, late_request, created_by')
      .eq('exec_project_id', p.exec_project_id)
      .like('code', 'PTW-%')
      .in('status', ['submitted', 'active', 'closed'])
      .order('starts_at', { ascending: false })
      .limit(300);
    // Site check-ins and toolbox meetings of the supervisor this week
    const end = addDaysISO(p.week_start, 7);
    const [{ data: ck }, { data: tb }] = await Promise.all([
      supabase.from('site_checkins').select('id, day, at, distance_m, within').eq('exec_project_id', p.exec_project_id).eq('user_id', p.supervisor_id)
        .gte('day', p.week_start).lt('day', end).order('at'),
      supabase.from('hse_records').select('id, code, starts_at, tbt_late').eq('exec_project_id', p.exec_project_id).eq('form_code', 'TBT-01').eq('created_by', p.supervisor_id)
        .gte('starts_at', `${p.week_start}T00:00:00+05:30`).lt('starts_at', `${end}T00:00:00+05:30`).order('starts_at'),
    ]);
    return { projects, plan: p as SubPlan, items, ae, permits: (pm ?? []) as Permit[], links: (ln ?? []) as Link[], checkins: (ck ?? []) as Checkin[], tbts: (tb ?? []) as Tbt[], projectName: `${p.exec_projects?.code ?? ''} ${p.exec_projects?.name ?? ''}` };
  }, [params.plan, project, week]);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
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

  // Work permits requested for a planned work (only those covering its day count)
  const permitsOf = (x: Item) =>
    data.links.filter((l) => l.item_id === x.id).map((l) => data.permits.find((r) => r.id === l.permit_id)).filter((r): r is Permit => !!r && covers(r, x.day));
  const requestPermit = async (d: string, items: Item[]) => {
    const forms = (await loadHseForms()).filter((f) => f.kind === 'permit');
    const r = await dialog.prompt({
      title: `Work permit – ${fmtDate(d)}`,
      message: `For: ${items.map((x) => x.title).join(' · ')}. Choose one or more permit types – each is filled in and submitted in turn; an Assistant Engineer approves each.`,
      fields: [{ key: 'f', label: 'Permit types', type: 'multiselect', required: true, options: forms.map((f) => ({ value: f.code, label: `${f.code} ${formName(f)}` })) }],
      confirmLabel: 'Continue',
    });
    if (r?.f) router.push({ pathname: '/execution/hse/permit', params: { project: plan!.exec_project_id, form: r.f, day: d, items: items.map((x) => x.id).join(',') } });
  };

  // Check in on site (location verified against the site) – before the toolbox meeting
  const checkin = async () => {
    const fix = await siteFix();
    if (!fix) return dialog.toast('Location could not be read – allow location access and try again', 'error');
    await dialog.run(async () => {
      const r = await rpc<{ within: boolean; distance_m: number; radius_m: number }>('site_checkin', { p_exec: plan!.exec_project_id, p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy });
      await reload();
      if (!r.within) throw new Error(`You are ${dist(r.distance_m)} from the site (check-in within ${r.radius_m} m) – check in at the site`);
    }, 'Checked in on site – the AE and the SEE are told');
  };
  const dist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
  const siteRow = (d: string) => {
    const ck = data.checkins.filter((x) => x.day === d);
    const ok = ck.filter((x) => x.within);
    const tb = data.tbts.filter((t) => slDay(t.starts_at) === d);
    const permitToday = data.permits.some((r) => r.created_by === plan!.supervisor_id && (r.status === 'active' || r.status === 'closed') && covers(r, d));
    const isToday = d === today;
    if (!mine && !ck.length && !tb.length) return null;
    if (mine && d < today && !ck.length && !tb.length) return null;
    const why = !ok.length ? 'check in on site first' : !permitToday ? 'needs an approved work permit for today' : '';
    return (
      <Row wrap gap={6} style={{ alignItems: 'center', marginBottom: 6 }}>
        {ok.length ? <Pill label={`Checked in ${fmtTime(ok[0].at)} · ${dist(ok[0].distance_m)}`} tone={colors.green} /> : ck.length ? <Pill label={`Away from site · ${dist(ck[ck.length - 1].distance_m)}`} tone={colors.red} /> : null}
        {tb.map((t) => (
          <Pressable key={t.id} onPress={() => router.push(`/execution/hse/form/${t.id}`)}>
            <Pill label={`Toolbox ${t.code} · ${fmtTime(t.starts_at)}${t.tbt_late ? ' · late' : ''}`} tone={t.tbt_late ? colors.red : colors.green} />
          </Pressable>
        ))}
        {mine && isToday && !ok.length ? <Button small variant="secondary" title="📍 Check in on site" onPress={checkin} /> : null}
        {mine && d >= today && !tb.length ? (
          <Button
            small
            title="Toolbox meeting (08:30)"
            disabled={!isToday || !!why}
            onPress={() => router.push({ pathname: '/execution/hse/tbt', params: { project: plan!.exec_project_id } })}
          />
        ) : null}
        {mine && d >= today && !tb.length ? <Muted>{!isToday ? 'opens on the day' : why}</Muted> : null}
      </Row>
    );
  };

  const days = plan ? Array.from({ length: 7 }, (_, i) => addDaysISO(plan.week_start, i)) : [];
  const today = todayISO();

  return (
    <View style={{ gap: 10 }}>
      <TestingBanner what="Subcontractor plans" />
      {sup ? (
        <Card>
          <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
            {fixedProject ? (
              <View style={{ flex: 1 }} />
            ) : (
              <View style={{ flex: 1, minWidth: 240 }}>
                <Select label="Project" value={project ?? data.projects[0]?.id ?? null} onChange={setProject} options={data.projects.map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))} />
              </View>
            )}
            <Button small variant="secondary" title="◀ Week" onPress={() => setWeek(addDaysISO(week, -7))} />
            <Text style={{ fontWeight: '700', color: colors.ink, paddingBottom: 8 }}>{`Week of ${fmtDate(week)}`}</Text>
            <Button small variant="secondary" title="Week ▶" onPress={() => setWeek(addDaysISO(week, 7))} />
          </Row>
          {!fixedProject && !data.projects.length ? <Muted>No project yet – it shows here once you are appointed to one.</Muted> : null}
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
            <Notice tone={colors.blue}>Each day, tick the work the Assistant Engineers planned for your team and add any additional work – then submit; an Assistant Engineer of the project approves it. Work permits are requested day by day: the next day&apos;s permits go to the AE before 20:00.</Notice>
          ) : null}
          {!data.ae.length && editable ? <Muted>No work planned for your team by the Assistant Engineers this week yet – it appears here once their plans are approved (work given to you, or of a programme activity given to your company). You can still add additional work.</Muted> : null}

          {days.map((d, i) => {
            const aeDay = data.ae.filter((x) => x.day === d);
            const items = data.items.filter((x) => x.day === d);
            const siteDay = data.checkins.some((x) => x.day === d) || data.tbts.some((t) => slDay(t.starts_at) === d) || (mine && d === today);
            if (!editable && !items.length && !siteDay) return null;
            return (
              <Section key={d} title={`${DAY[i]} ${fmtDate(d)}${d === today ? ' · today' : ''}`}>
                <Card>
                  {plan.status !== 'draft' ? siteRow(d) : null}
                  {editable && aeDay.length ? (
                    <>
                      <Muted>Planned for your team by the engineers</Muted>
                      {aeDay.map((x) => (
                        <Pressable key={x.id} onPress={() => run('pick_sub_plan_item', { p_plan: plan.id, p_ae_item: x.id, p_on: !x.picked })}>
                          <Row gap={8} style={{ paddingVertical: 5, alignItems: 'center' }}>
                            <Text style={{ fontSize: 18, color: x.picked ? colors.green : colors.muted }}>{x.picked ? '☑' : '☐'}</Text>
                            <Text style={{ color: colors.ink, flexShrink: 1 }}>
                              {`${x.title}${x.zone ? ` · ${x.zone}` : ''}${x.qty != null ? ` · ${x.qty} ${x.unit ?? ''}` : ''}`}
                            </Text>
                            <Muted>{`${x.engineer}${x.activity ? ` · ${x.activity}` : ''}${x.mine ? ' · given to you' : ''}`}</Muted>
                          </Row>
                        </Pressable>
                      ))}
                    </>
                  ) : null}
                  {items.filter((x) => !editable || !x.ae_item_id).length ? (
                    <>
                      {editable ? <Muted style={{ marginTop: 6 }}>Additional work</Muted> : null}
                      {items.filter((x) => !editable || !x.ae_item_id).map((x) => {
                        const pms = permitsOf(x);
                        return (
                          <Row key={x.id} wrap gap={8} style={{ paddingVertical: 5, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line }}>
                            {x.additional ? <Pill label="Additional" tone={colors.blue} /> : x.activity_id ? <Pill label="Programme" tone={colors.grey} /> : <Pill label="Engineer plan" tone={colors.grey} />}
                            <Text style={{ color: colors.ink, flexShrink: 1 }}>
                              {`${x.title}${x.zone ? ` · ${x.zone}` : ''}${x.qty != null ? ` · ${x.qty} ${x.unit ?? ''}` : ''}${x.crew ? ` · crew ${x.crew}` : ''}`}
                            </Text>
                            {pms.map((pm) => (
                              <Pressable key={pm.id} onPress={() => router.push(`/execution/hse/form/${pm.id}`)}>
                                <Pill
                                  label={`${pm.code} · ${PERMIT_STATUS[pm.status].label}${pm.late_request ? ' · late' : ''}`}
                                  tone={pm.status === 'active' || pm.status === 'closed' ? colors.green : colors.amber}
                                />
                              </Pressable>
                            ))}
                            {!pms.length && plan.status !== 'draft' && x.status === 'planned' && d >= today ? <Pill label="No work permit yet" tone={colors.grey} /> : null}
                            {plan.status === 'approved' ? <Pill label={RESULT[x.status].label} tone={RESULT[x.status].tone} /> : null}
                            {x.result_note ? <Muted>{x.result_note}</Muted> : null}
                            {editable ? (
                              <Row gap={4}>
                                {x.additional ? <Button small variant="ghost" title="Edit" onPress={() => extra(d, x)} /> : null}
                                <Button small variant="ghost" title="Remove" onPress={() => run('delete_sub_plan_item', { p_id: x.id })} />
                              </Row>
                            ) : null}
                            {mine && plan.status === 'approved' && d <= today ? <Button small variant="secondary" title="Update" onPress={() => result(x)} /> : null}
                          </Row>
                        );
                      })}
                    </>
                  ) : null}
                  {editable || (mine && plan.status !== 'draft' && d >= today && items.length) ? (
                    <Row wrap gap={6} style={{ marginTop: 6 }}>
                      {editable ? <Button small variant="secondary" title="+ Additional work" onPress={() => extra(d)} /> : null}
                      {mine && plan.status !== 'draft' && d >= today && items.some((x) => x.status === 'planned' && !permitsOf(x).length) ? (
                        <Button small title="Request work permit for this day" onPress={() => requestPermit(d, items.filter((x) => x.status === 'planned' && !permitsOf(x).length))} />
                      ) : null}
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
            {!sup && !fixedProject ? <Button variant="ghost" title="Back to plans" onPress={() => router.push('/execution/plans')} /> : null}
          </Row>
        </>
      ) : null}
    </View>
  );
}
