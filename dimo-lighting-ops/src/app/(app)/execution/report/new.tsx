import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { itemChanged, ReportItems, type ItemEdit } from '@/components/exec/ReportItems';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, DateField, ErrorBanner, Field, Grid, Muted, Notice, NumberField, Pill, Row, Screen, Section, Select, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecPlan, ExecProject, ExecReport, PlanItem } from '@/lib/execution';
import { pickDocument, pickImage, uploadAttachment, type PickedFile } from '@/lib/files';
import { addDaysISO, fmtDate, fmtTime, todayISO } from '@/lib/format';
import type { HseRecord } from '@/lib/hse';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type SubItem = { id: string; ae_item_id: string | null; title: string; zone: string | null; qty: number | null; unit: string | null; additional: boolean; status: 'planned' | 'done' | 'partial' | 'not_done'; done_qty: number | null; result_note: string | null };
type SubEdit = { status: string; done_qty: number | null; note: string };
/** The Sri Lanka date of a timestamp */
const slDay = (ts: string | null) => (ts ? new Date(new Date(ts).getTime() + 330 * 60000).toISOString().slice(0, 10) : '');

/** Daily report: supervisors by 18:00 (to the Assistant Engineers), Assistant Engineers by 20:00 (to the Senior Electrical Engineer). */
export default function NewReport() {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const params = useLocalSearchParams<{ project?: string; date?: string }>();
  const sup = me.role === 'sub_supervisor';
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [edits, setEdits] = useState<Record<string, ItemEdit>>({});
  const [tbt, setTbt] = useState<string[]>([]);
  const [subEdits, setSubEdits] = useState<Record<string, SubEdit>>({});
  const [permitSel, setPermitSel] = useState<string[]>([]);
  const [tbtSeen, setTbtSeen] = useState('');
  const [f, setF] = useState({
    project: params.project ?? null as string | null,
    date: params.date ?? todayISO(),
    crew_count: null as number | null,
    crew: '',
    work_done: '',
    work_next: '',
    delays: '',
    inspections: '',
    issues: '',
    hse_notes: '',
    toolbox_talk: false,
    toolbox_topic: '',
    safety_check: false,
    weather: '',
    visitors: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const { data: projects } = useLoad(async () => {
    const { data } = await supabase.from('exec_projects').select('*').eq('status', 'active').order('name');
    return (data ?? []) as ExecProject[];
  });
  const proj = f.project ?? projects?.[0]?.id ?? null;

  // Pre-fill from the day's plan results and (for an Assistant Engineer) the supervisors' reports
  const { data: day } = useLoad(async () => {
    if (!proj) return null;
    const [its, earlier, reps, plans, talks, subs, ptws] = await Promise.all([
      supabase.from('exec_plan_items').select('*').eq('exec_project_id', proj).eq('day', f.date).order('created_at'),
      // earlier activities of the last two weeks still without a result
      supabase.from('exec_plan_items').select('*').eq('exec_project_id', proj).eq('status', 'planned').lt('day', f.date).gte('day', addDaysISO(f.date, -14)).order('day'),
      sup ? Promise.resolve({ data: [] }) : supabase.from('exec_reports').select('*').eq('exec_project_id', proj).eq('report_date', f.date).eq('level', 'supervisor'),
      sup ? Promise.resolve({ data: [] }) : supabase.from('exec_plans').select('id, ae_id, status').eq('exec_project_id', proj),
      // toolbox talks recorded on the TBT form that day (numbered automatically)
      supabase.from('hse_records').select('*').eq('exec_project_id', proj).eq('form_code', 'TBT-01')
        .gte('starts_at', `${f.date}T00:00:00+05:30`).lt('starts_at', `${addDaysISO(f.date, 1)}T00:00:00+05:30`).order('starts_at'),
      // Supervisor: the day's works of the own approved plan, and the own approved work permits of the day
      sup
        ? supabase.from('sub_plan_items').select('*, sub_plans!inner(supervisor_id, exec_project_id, status)').eq('day', f.date)
            .eq('sub_plans.supervisor_id', me.id).eq('sub_plans.exec_project_id', proj).eq('sub_plans.status', 'approved').order('created_at')
        : Promise.resolve({ data: [] }),
      sup
        ? supabase.from('hse_records').select('*').eq('exec_project_id', proj).eq('created_by', me.id).like('code', 'PTW-%').in('status', ['active', 'closed'])
            .lt('starts_at', `${addDaysISO(f.date, 1)}T00:00:00+05:30`).gte('ends_at', `${f.date}T00:00:00+05:30`).order('starts_at')
        : Promise.resolve({ data: [] }),
    ]);
    const subItems = (subs.data ?? []) as unknown as SubItem[];
    const permits = ((ptws.data ?? []) as HseRecord[]).filter((r) => slDay(r.starts_at) <= f.date && f.date <= slDay(r.ends_at));
    const { data: ln } = subItems.length ? await supabase.from('sub_plan_item_permits').select('*').in('item_id', subItems.map((x) => x.id)) : { data: [] };
    // Supervisor: own toolbox talks. Assistant Engineer: every toolbox talk of the project that day.
    const tbts = ((talks.data ?? []) as HseRecord[]).filter((t) => !sup || t.created_by === me.id);
    const myPlans = new Set(((plans.data ?? []) as Pick<ExecPlan, 'id' | 'ae_id' | 'status'>[]).filter((x) => x.ae_id === me.id && x.status === 'approved').map((x) => x.id));
    const okPlans = new Set(((plans.data ?? []) as Pick<ExecPlan, 'id' | 'status'>[]).filter((x) => x.status === 'approved').map((x) => x.id));
    // Supervisor: own activities. Assistant Engineer: activities of the own approved plan and accepted supervisor additions.
    const mine = (i: PlanItem) =>
      i.source === 'supervisor' ? i.acceptance === 'accepted' && (!sup || i.supervisor_id === me.id) : sup ? i.supervisor_id === me.id : !!i.plan_id && myPlans.has(i.plan_id) && okPlans.has(i.plan_id);
    const seen = new Set<string>();
    const items = [...((earlier.data ?? []) as PlanItem[]).filter((i) => i.day < f.date), ...((its.data ?? []) as PlanItem[])].filter((i) => mine(i) && !seen.has(i.id) && !!seen.add(i.id));
    // Activities of the day that cannot be updated yet: own plan not approved / supervisor addition not accepted
    const allPlans = (plans.data ?? []) as Pick<ExecPlan, 'id' | 'ae_id' | 'status'>[];
    const waiting = ((its.data ?? []) as PlanItem[]).filter((i) =>
      i.source === 'supervisor' ? i.acceptance === 'pending' && (!sup || i.supervisor_id === me.id) : !sup && !!allPlans.find((x) => x.id === i.plan_id && x.ae_id === me.id && x.status !== 'approved'),
    );
    return { items, waiting, tbts, reps: (reps.data ?? []) as ExecReport[], subItems, permits, links: (ln ?? []) as { item_id: string; permit_id: string }[] };
  }, [proj, f.date, sup]);
  // Pre-fill once per project and day (guarded set during render instead of an effect)
  const prefillKey = day ? `${proj}|${f.date}` : null;
  const [filled, setFilled] = useState<string | null>(null);
  if (day && prefillKey && filled !== prefillKey) {
    setFilled(prefillKey);
    setEdits({});
    setSubEdits(Object.fromEntries(day.subItems.filter((x) => x.status !== 'planned').map((x) => [x.id, { status: x.status, done_qty: x.done_qty, note: x.result_note ?? '' }])));
    setPermitSel(day.permits.map((r) => r.id));
  }
  // Toolbox talks recorded for the day are ticked and linked automatically (also ones recorded after opening the form)
  const tbtKey = day ? `${prefillKey}|${day.tbts.map((t) => t.id).join(',')}` : '';
  if (day && tbtKey !== tbtSeen) {
    setTbtSeen(tbtKey);
    const fresh = day.tbts.map((t) => t.id).filter((x) => !tbtSeen.includes(x));
    if (fresh.length) {
      setTbt((sel) => [...new Set([...(tbtSeen.startsWith(`${prefillKey}|`) ? sel : []), ...fresh])]);
      setF((st) => ({ ...st, toolbox_talk: true }));
    } else if (!tbtSeen.startsWith(`${prefillKey}|`)) setTbt([]);
  }

  // Supervisor: no daily report without the day's toolbox meeting
  const needTbt = sup && !!day && !day.tbts.length;

  const addFile = async (camera: boolean) => {
    const x = camera ? await pickImage(true) : Platform.OS === 'web' ? await pickDocument() : await pickImage(false);
    if (x) setFiles((s) => [...s, x]);
  };

  const save = async () => {
    setError(null);
    if (!proj) return setError('Choose the project');
    if (needTbt) return setError('Hold and record the day’s toolbox meeting first – no daily report without it');
    const changed = (day?.items ?? []).filter((it) => itemChanged(it, edits[it.id]));
    const linked = f.toolbox_talk ? tbt.filter((x) => day?.tbts.some((t) => t.id === x)) : [];
    if (f.toolbox_talk && !linked.length && !f.toolbox_topic.trim()) return setError(day?.tbts.length ? 'Tick the toolbox talk held' : 'Record the toolbox talk (TBT form) or enter the topic');
    // Supervisor: every work of the day's plan gets a result (works from the engineers' plan reported in A carry that result)
    const inA = new Set((day?.items ?? []).map((i) => i.id));
    const subOwn = (day?.subItems ?? []).filter((x) => !x.ae_item_id || !inA.has(x.ae_item_id));
    const noResult = subOwn.find((x) => !subEdits[x.id]?.status || subEdits[x.id].status === 'planned');
    if (sup && noResult) return setError(`Give the result of “${noResult.title}” (your plan for the day)`);
    const noWhy = subOwn.find((x) => (subEdits[x.id]?.status === 'partial' || subEdits[x.id]?.status === 'not_done') && !subEdits[x.id].note.trim());
    if (sup && noWhy) return setError(`Give the reason for “${noWhy.title}”`);
    const worked = subOwn.some((x) => subEdits[x.id]?.status === 'done' || subEdits[x.id]?.status === 'partial') || changed.some((it) => edits[it.id].status === 'done' || edits[it.id].status === 'partial');
    if (sup && worked && !permitSel.length) return setError(day?.permits.length ? 'Tick the work permit(s) the work was done under' : 'No approved work permit of yours for this day – work needs a permit');
    const noReason = changed.find((it) => (edits[it.id].status === 'partial' || edits[it.id].status === 'not_done') && !edits[it.id].note.trim());
    if (noReason) return setError(`Give the reason for “${noReason.title}”`);
    await dialog.run(async () => {
      const items = changed.map((it) => ({ id: it.id, status: edits[it.id].status, done_qty: edits[it.id].done_qty ?? '', note: edits[it.id].note }));
      const subItems = subOwn.map((x) => ({ id: x.id, status: subEdits[x.id].status, done_qty: subEdits[x.id].done_qty ?? '', note: subEdits[x.id].note }));
      const id = await rpc<string>('submit_exec_report', {
        p_exec: proj,
        p_date: f.date,
        p: { ...f, crew_count: f.crew_count ?? '', items, toolbox_records: linked, toolbox_topic: linked.length ? '' : f.toolbox_topic, sub_items: subItems, permit_ids: permitSel },
      });
      for (const it of changed) {
        const ids: string[] = [];
        for (const x of edits[it.id].photos) ids.push((await uploadAttachment('exec_report', id, 'item_photo', x)).id);
        if (ids.length) await rpc('attach_report_item_photos', { p_report: id, p_item: it.id, p_attachments: ids });
      }
      for (const x of files) await uploadAttachment('exec_report', id, x.mimeType?.startsWith('image/') ? 'daily_photo' : 'daily_doc', x);
      router.replace(`/execution/report/${id}`);
    }, sup ? 'Submitted – the Assistant Engineers verify it' : 'Submitted to the Senior Electrical Engineer');
  };

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'Daily progress report' }} />
      <TestingBanner what="Daily reports" />
      <ErrorBanner message={error} />
      <Card style={{ gap: 2, marginBottom: 4 }}>
        <Text style={{ fontSize: 17, fontWeight: '800', color: colors.ink }}>Daily progress report</Text>
        <Muted>{`${sup ? 'Subcontractor supervisor report – due by 18:00, goes to the Assistant Engineers' : 'Assistant Engineer report – due by 20:00, goes to the Senior Electrical Engineer'}. Same sections as the PDF report.`}</Muted>
      </Card>
      {needTbt ? (
        <Notice tone={colors.red}>{`No toolbox meeting recorded for ${fmtDate(f.date)} – hold it first (Planning tab: check in on site, then Toolbox meeting). No daily report without it.`}</Notice>
      ) : null}
      <Section title="Report details">
        <Card>
          <Select label="Project" required value={proj} onChange={(v) => set('project', v)} options={(projects ?? []).map((p) => ({ value: p.id, label: `${p.wbs_no || p.code || ''} ${p.name}` }))} />
          <Grid min={220}>
            <DateField label="Report date" required value={f.date} onChange={(v) => set('date', v ?? todayISO())} quick={[0, -1]} />
            <Field label="Weather" value={f.weather} onChangeText={(v) => set('weather', v)} placeholder="e.g. Sunny, rain after 16:00" />
          </Grid>
          {sup ? (
            <Grid min={220}>
              <NumberField label="Crew on site" required value={f.crew_count} onChange={(v) => set('crew_count', v)} />
              <Field label="Crew by trade (electricians, helpers…)" value={f.crew} onChangeText={(v) => set('crew', v)} />
            </Grid>
          ) : null}
          <Field label="Visitors" value={f.visitors} onChangeText={(v) => set('visitors', v)} placeholder="Client, consultant, inspectors…" />
        </Card>
      </Section>
      <Section title={`A. Planned activities – progress (${day?.items.length ?? 0})`}>
        <Muted style={{ marginBottom: 6 }}>Set the result of each activity, the quantity done, details or the reason, and add photos of it. Earlier activities still without a result are listed too.</Muted>
        {day?.waiting.length ? (
          <Notice tone={colors.amber}>
            {`${day.waiting.length} ${day.waiting.length === 1 ? 'activity' : 'activities'} for this day cannot be updated yet – ${sup ? 'waiting for an Assistant Engineer to accept your additions' : 'your weekly plan is not approved yet (or a supervisor addition is not accepted)'}: ${day.waiting.map((i) => i.title).join(' · ')}`}
          </Notice>
        ) : null}
        {day && !day.items.length && !day.waiting.length ? (
          <Notice tone={colors.blue}>{sup ? 'No activities assigned to you for this day.' : 'No activities in your approved plan for this day – add them in the Plan tab, or describe the work below.'}</Notice>
        ) : null}
        {day?.items.length ? <ReportItems items={day.items} edits={edits} onChange={(id, e) => setEdits((s) => ({ ...s, [id]: e }))} people={people} day={f.date} /> : null}
      </Section>
      {sup ? (
        <Section title={`My plan and work permits of the day (${day?.subItems.length ?? 0})`}>
          <Card style={{ gap: 6 }}>
            {day?.subItems.length ? (
              day.subItems.map((x) => {
                const fromA = !!x.ae_item_id && day.items.some((i) => i.id === x.ae_item_id);
                const e = subEdits[x.id] ?? { status: '', done_qty: null, note: '' };
                const pms = day.links.filter((l) => l.item_id === x.id).map((l) => day.permits.find((r) => r.id === l.permit_id)?.code).filter(Boolean);
                return (
                  <View key={x.id} style={{ gap: 4, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                    <Row wrap gap={6} style={{ alignItems: 'center' }}>
                      <Text style={{ color: colors.ink, fontWeight: '600', flexShrink: 1 }}>{`${x.title}${x.zone ? ` · ${x.zone}` : ''}${x.qty != null ? ` · ${x.qty} ${x.unit ?? ''}` : ''}`}</Text>
                      {x.additional ? <Pill label="Additional" tone={colors.blue} /> : null}
                      <Pill label={pms.length ? `Permit ${pms.join(', ')}` : 'No permit linked'} tone={pms.length ? colors.green : colors.amber} />
                    </Row>
                    {fromA ? (
                      <Muted>Result taken from section A (engineers&apos; plan).</Muted>
                    ) : (
                      <Grid min={180}>
                        <Select
                          label="Result"
                          required
                          value={e.status || null}
                          onChange={(v) => setSubEdits((s) => ({ ...s, [x.id]: { ...e, status: v ?? '' } }))}
                          options={[{ value: 'done', label: 'Done' }, { value: 'partial', label: 'Partly done' }, { value: 'not_done', label: 'Not done' }]}
                        />
                        <NumberField label={`Quantity done${x.unit ? ` (${x.unit})` : ''}`} value={e.done_qty} onChange={(v) => setSubEdits((s) => ({ ...s, [x.id]: { ...e, done_qty: v } }))} />
                        <Field label="Details / reason" value={e.note} onChangeText={(v) => setSubEdits((s) => ({ ...s, [x.id]: { ...e, note: v } }))} />
                      </Grid>
                    )}
                  </View>
                );
              })
            ) : (
              <Muted>No approved plan of yours for this day.</Muted>
            )}
            <Muted style={{ marginTop: 4 }}>Work permits the work was done under</Muted>
            {day?.permits.length ? (
              day.permits.map((r) => (
                <Toggle
                  key={r.id}
                  value={permitSel.includes(r.id)}
                  onChange={(v) => setPermitSel((s) => (v ? [...s, r.id] : s.filter((x) => x !== r.id)))}
                  label={`${r.code} · ${String(r.header.location ?? '')} · ${fmtTime(r.starts_at)}–${fmtTime(r.ends_at)}${r.status === 'closed' ? ' · closed' : ''}`}
                />
              ))
            ) : (
              <Notice tone={colors.amber}>{`No approved work permit of yours for ${fmtDate(f.date)}.`}</Notice>
            )}
          </Card>
        </Section>
      ) : null}
      <Section title="B. Work on site">
        <Card>
          <Field label="Work done" required multiline value={f.work_done} onChangeText={(v) => set('work_done', v)} placeholder="Summary of the day's work" />
          {!sup ? <Field label="Inspections and tests" multiline value={f.inspections} onChangeText={(v) => set('inspections', v)} /> : null}
          <Field label="Delays and reasons" multiline value={f.delays} onChangeText={(v) => set('delays', v)} />
          <Field label="Issues / needs (materials, access, drawings)" multiline value={f.issues} onChangeText={(v) => set('issues', v)} />
          <Field label="Planned for tomorrow" multiline value={f.work_next} onChangeText={(v) => set('work_next', v)} />
        </Card>
      </Section>
      {!sup ? (
        <Section title={`C. Subcontractor supervisor reports (${day?.reps.length ?? 0})`}>
          <Card style={{ gap: 6 }}>
            {day?.reps.length ? (
              day.reps.map((x) => (
                <Row key={x.id} gap={8} wrap style={{ alignItems: 'flex-start', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                  <Pill label={x.status === 'verified' ? 'Verified' : x.status === 'returned' ? 'Returned' : 'To verify'} tone={x.status === 'verified' ? colors.green : colors.amber} />
                  <Text style={{ flex: 1, minWidth: 200, color: colors.ink }}>{`${people[x.author_id]?.full_name ?? ''} · ${x.crew_count ?? 0} crew · ${x.work_done}`}</Text>
                  {x.status === 'submitted' ? <Button small variant="ghost" title="Verify ›" onPress={() => router.push(`/execution/report/${x.id}`)} /> : null}
                </Row>
              ))
            ) : (
              <Muted>No supervisor reports for this day yet – they appear here and in the PDF as they come in.</Muted>
            )}
          </Card>
        </Section>
      ) : null}
      <Section title={`${sup ? 'C' : 'D'}. Health and safety`}>
        <Card>
          <Toggle label="Toolbox talk held" value={f.toolbox_talk} onChange={(v) => set('toolbox_talk', v)} />
          {f.toolbox_talk && day?.tbts.length ? (
            <View style={{ gap: 4 }}>
              <Muted>{`Toolbox talk ${day.tbts.length > 1 ? 'records' : 'record'} of this day – number taken from the TBT form`}</Muted>
              {day.tbts.map((t) => (
                <Toggle
                  key={t.id}
                  value={tbt.includes(t.id)}
                  onChange={(v) => setTbt((sel) => (v ? [...sel, t.id] : sel.filter((x) => x !== t.id)))}
                  label={`${t.code} · ${fmtTime(t.starts_at)} · ${String(t.header.activity ?? '').split('\n')[0].replace(/^[•\s]+/, '').slice(0, 70)} · ${people[t.created_by]?.full_name ?? ''} · ${(t.participants ?? []).length} present`}
                />
              ))}
            </View>
          ) : null}
          {f.toolbox_talk && day && !day.tbts.length ? (
            <View style={{ gap: 6 }}>
              <Notice tone={colors.amber}>{`No toolbox talk recorded for ${fmtDate(f.date)} yet. Record it on the TBT form – its number is then linked here automatically.`}</Notice>
              {proj ? <Button small title="Record toolbox talk (TBT form)" onPress={() => router.push({ pathname: '/execution/hse/tbt', params: { project: proj } })} /> : null}
              <Field label="…or type the topic (if no TBT record)" value={f.toolbox_topic} onChangeText={(v) => set('toolbox_topic', v)} />
            </View>
          ) : null}
          <Toggle label="Daily safety check done" value={f.safety_check} onChange={(v) => set('safety_check', v)} />
          <Field label="HSE notes" multiline value={f.hse_notes} onChangeText={(v) => set('hse_notes', v)} />
          <Muted>Report incidents, near misses and unsafe acts separately under HSE – SM Projects is told at once.</Muted>
        </Card>
      </Section>
      <Section title={`${sup ? 'D' : 'E'}. Photos and documents`}>
        <Card>
          <Muted>General site photos and documents. Photos of a planned activity are added on the activity in section A.</Muted>
          <Row wrap gap={6}>
            {Platform.OS !== 'web' ? <Button small variant="secondary" title="📷 Take photo" onPress={() => dialog.run(() => addFile(true))} /> : null}
            <Button small variant="secondary" title="+ Photo / document" onPress={() => dialog.run(() => addFile(false))} />
            {files.map((x, i) => (
              <Button key={`${x.name}-${i}`} small variant="ghost" title={`✕ ${x.name}`} onPress={() => setFiles(files.filter((_, k) => k !== i))} />
            ))}
          </Row>
        </Card>
      </Section>
      <Muted style={{ marginTop: 4 }}>{`After you submit, the PDF report is available on the report${sup ? '' : ' to you and the Senior Electrical Engineer'}.`}</Muted>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Submit report" disabled={needTbt} onPress={save} />
      </Row>
    </Screen>
  );
}
