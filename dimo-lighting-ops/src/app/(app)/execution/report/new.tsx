import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { useDialog } from '@/components/dialog';
import { itemChanged, ReportItems, type ItemEdit } from '@/components/exec/ReportItems';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, DateField, ErrorBanner, Field, Muted, NumberField, Row, Screen, Section, Select, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecPlan, ExecProject, ExecReport, PlanItem } from '@/lib/execution';
import { pickDocument, pickImage, uploadAttachment, type PickedFile } from '@/lib/files';
import { addDaysISO, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

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
    const [its, earlier, reps, plans] = await Promise.all([
      supabase.from('exec_plan_items').select('*').eq('exec_project_id', proj).eq('day', f.date).order('created_at'),
      // earlier activities of the last two weeks still without a result
      supabase.from('exec_plan_items').select('*').eq('exec_project_id', proj).eq('status', 'planned').lt('day', f.date).gte('day', addDaysISO(f.date, -14)).order('day'),
      sup ? Promise.resolve({ data: [] }) : supabase.from('exec_reports').select('*').eq('exec_project_id', proj).eq('report_date', f.date).eq('level', 'supervisor'),
      sup ? Promise.resolve({ data: [] }) : supabase.from('exec_plans').select('id, ae_id, status').eq('exec_project_id', proj),
    ]);
    const myPlans = new Set(((plans.data ?? []) as Pick<ExecPlan, 'id' | 'ae_id' | 'status'>[]).filter((x) => x.ae_id === me.id && x.status === 'approved').map((x) => x.id));
    const okPlans = new Set(((plans.data ?? []) as Pick<ExecPlan, 'id' | 'status'>[]).filter((x) => x.status === 'approved').map((x) => x.id));
    // Supervisor: own activities. Assistant Engineer: activities of the own approved plan and accepted supervisor additions.
    const mine = (i: PlanItem) =>
      i.source === 'supervisor' ? i.acceptance === 'accepted' && (!sup || i.supervisor_id === me.id) : sup ? i.supervisor_id === me.id : !!i.plan_id && myPlans.has(i.plan_id) && okPlans.has(i.plan_id);
    const seen = new Set<string>();
    const items = [...((earlier.data ?? []) as PlanItem[]).filter((i) => i.day < f.date), ...((its.data ?? []) as PlanItem[])].filter((i) => mine(i) && !seen.has(i.id) && !!seen.add(i.id));
    return { items, reps: (reps.data ?? []) as ExecReport[] };
  }, [proj, f.date, sup]);
  // Pre-fill once per project and day (guarded set during render instead of an effect)
  const prefillKey = day ? `${proj}|${f.date}` : null;
  const [filled, setFilled] = useState<string | null>(null);
  if (day && prefillKey && filled !== prefillKey) {
    setFilled(prefillKey);
    setEdits({});
    const supLines = day.reps.map((r) => `• ${people[r.author_id]?.full_name ?? ''} (${r.crew_count ?? 0} crew, ${r.status}): ${r.work_done}`);
    if (!f.work_done && supLines.length) setF((s) => ({ ...s, work_done: `Supervisor reports:\n${supLines.join('\n')}` }));
  }

  const addFile = async (camera: boolean) => {
    const x = camera ? await pickImage(true) : Platform.OS === 'web' ? await pickDocument() : await pickImage(false);
    if (x) setFiles((s) => [...s, x]);
  };

  const save = async () => {
    setError(null);
    if (!proj) return setError('Choose the project');
    const changed = (day?.items ?? []).filter((it) => itemChanged(it, edits[it.id]));
    const noReason = changed.find((it) => (edits[it.id].status === 'partial' || edits[it.id].status === 'not_done') && !edits[it.id].note.trim());
    if (noReason) return setError(`Give the reason for “${noReason.title}”`);
    await dialog.run(async () => {
      const items = changed.map((it) => ({ id: it.id, status: edits[it.id].status, done_qty: edits[it.id].done_qty ?? '', note: edits[it.id].note }));
      const id = await rpc<string>('submit_exec_report', { p_exec: proj, p_date: f.date, p: { ...f, crew_count: f.crew_count ?? '', items } });
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
      <Stack.Screen options={{ title: 'Daily report' }} />
      <TestingBanner what="Daily reports" />
      <ErrorBanner message={error} />
      <Section title={sup ? 'Due by 18:00 – goes to the Assistant Engineers' : 'Due by 20:00 – goes to the Senior Electrical Engineer'}>
        <Card>
          <Select label="Project" required value={proj} onChange={(v) => set('project', v)} options={(projects ?? []).map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))} />
          <DateField label="Day" required value={f.date} onChange={(v) => set('date', v ?? todayISO())} quick={[0, -1]} />
          {sup ? (
            <>
              <NumberField label="Crew on site" required value={f.crew_count} onChange={(v) => set('crew_count', v)} />
              <Field label="Crew by trade (electricians, helpers…)" value={f.crew} onChangeText={(v) => set('crew', v)} />
            </>
          ) : null}
        </Card>
      </Section>
      <Section title={`Planned activities – update the status (${day?.items.length ?? 0})`}>
        <ReportItems items={day?.items ?? []} edits={edits} onChange={(id, e) => setEdits((s) => ({ ...s, [id]: e }))} people={people} day={f.date} />
      </Section>
      <Section title="Work on site">
        <Card>
          <Field label="Work done" required multiline value={f.work_done} onChangeText={(v) => set('work_done', v)} />
          {!sup ? <Field label="Inspections and tests" multiline value={f.inspections} onChangeText={(v) => set('inspections', v)} /> : null}
          <Field label="Delays and reasons" multiline value={f.delays} onChangeText={(v) => set('delays', v)} />
          <Field label="Issues / needs (materials, access, drawings)" multiline value={f.issues} onChangeText={(v) => set('issues', v)} />
          <Field label="Planned for tomorrow" multiline value={f.work_next} onChangeText={(v) => set('work_next', v)} />
        </Card>
      </Section>
      <Section title="Safety">
        <Card>
          <Toggle label="Toolbox talk held" value={f.toolbox_talk} onChange={(v) => set('toolbox_talk', v)} />
          {f.toolbox_talk ? <Field label="Toolbox talk topic" required value={f.toolbox_topic} onChangeText={(v) => set('toolbox_topic', v)} /> : null}
          <Toggle label="Daily safety check done" value={f.safety_check} onChange={(v) => set('safety_check', v)} />
          <Field label="HSE notes" multiline value={f.hse_notes} onChangeText={(v) => set('hse_notes', v)} />
          <Muted>Report incidents, near misses and unsafe acts separately under HSE – SM Projects is told at once.</Muted>
        </Card>
      </Section>
      <Section title="Other">
        <Card>
          <Field label="Weather" value={f.weather} onChangeText={(v) => set('weather', v)} />
          <Field label="Visitors" value={f.visitors} onChangeText={(v) => set('visitors', v)} />
          <Row wrap gap={6}>
            <Button small variant="secondary" title="+ Photo / document" onPress={() => dialog.run(() => addFile(false))} />
            {Platform.OS !== 'web' ? <Button small variant="secondary" title="📷 Take photo" onPress={() => dialog.run(() => addFile(true))} /> : null}
            {files.map((x, i) => (
              <Button key={`${x.name}-${i}`} small variant="ghost" title={`✕ ${x.name}`} onPress={() => setFiles(files.filter((_, k) => k !== i))} />
            ))}
          </Row>
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Submit report" onPress={save} />
      </Row>
    </Screen>
  );
}
