import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, DateField, ErrorBanner, Field, Muted, NumberField, Row, Screen, Section, Select, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { ITEM_STATUS, type ExecProject, type ExecReport, type PlanItem } from '@/lib/execution';
import { pickDocument, pickImage, uploadAttachment, type PickedFile } from '@/lib/files';
import { todayISO } from '@/lib/format';
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
    const [its, reps] = await Promise.all([
      supabase.from('exec_plan_items').select('*').eq('exec_project_id', proj).eq('day', f.date),
      sup ? Promise.resolve({ data: [] }) : supabase.from('exec_reports').select('*').eq('exec_project_id', proj).eq('report_date', f.date).eq('level', 'supervisor'),
    ]);
    return { items: (its.data ?? []) as PlanItem[], reps: (reps.data ?? []) as ExecReport[] };
  }, [proj, f.date, sup]);
  // Pre-fill once per project and day (guarded set during render instead of an effect)
  const prefillKey = day ? `${proj}|${f.date}` : null;
  const [filled, setFilled] = useState<string | null>(null);
  if (day && prefillKey && filled !== prefillKey) {
    setFilled(prefillKey);
    const mine = day.items.filter((i) => !sup || i.supervisor_id === me.id);
    const planLines = mine.map((i) => `• ${i.title}${i.qty != null ? ` – ${i.done_qty ?? 0}/${i.qty} ${i.unit ?? ''}` : ''}: ${ITEM_STATUS[i.status]}${i.result_note ? ` (${i.result_note})` : ''}`);
    const supLines = day.reps.map((r) => `• ${people[r.author_id]?.full_name ?? ''} (${r.crew_count ?? 0} crew, ${r.status}): ${r.work_done}`);
    if (!f.work_done)
      setF((s) => ({
        ...s,
        work_done: [planLines.length ? `Plan results:\n${planLines.join('\n')}` : '', supLines.length ? `Supervisor reports:\n${supLines.join('\n')}` : ''].filter(Boolean).join('\n\n'),
      }));
  }

  const addFile = async (camera: boolean) => {
    const x = camera ? await pickImage(true) : Platform.OS === 'web' ? await pickDocument() : await pickImage(false);
    if (x) setFiles((s) => [...s, x]);
  };

  const save = async () => {
    setError(null);
    if (!proj) return setError('Choose the project');
    await dialog.run(async () => {
      const id = await rpc<string>('submit_exec_report', { p_exec: proj, p_date: f.date, p: { ...f, crew_count: f.crew_count ?? '' } });
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
