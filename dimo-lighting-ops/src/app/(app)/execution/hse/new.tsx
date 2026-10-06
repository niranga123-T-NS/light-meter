import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, ErrorBanner, Field, Muted, NumberField, Row, Screen, Section, Select, Toggle } from '@/components/ui';
import { captureLocation } from '@/components/VisitBits';
import { HSE_KINDS, HSE_SEVERITY, type ExecProject } from '@/lib/execution';
import { pickDocument, pickImage, uploadAttachment, type PickedFile } from '@/lib/files';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** HSE report: what, how serious, where, with photos – the Senior Electrical Engineer and SM Projects are told at once. */
export default function NewHse() {
  const dialog = useDialog();
  const params = useLocalSearchParams<{ project?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [f, setF] = useState({
    project: params.project ?? (null as string | null),
    kind: 'near_miss',
    severity: 'medium',
    location: '',
    description: '',
    immediate_action: '',
    injured: 0 as number | null,
    lost_time: false,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const { data: projects } = useLoad(async () => {
    const { data } = await supabase.from('exec_projects').select('*').eq('status', 'active').order('name');
    return (data ?? []) as ExecProject[];
  });
  const proj = f.project ?? projects?.[0]?.id ?? null;
  const addFile = async (camera: boolean) => {
    const x = camera ? await pickImage(true) : Platform.OS === 'web' ? await pickDocument() : await pickImage(false);
    if (x) setFiles((s) => [...s, x]);
  };
  const save = async () => {
    setError(null);
    if (!proj) return setError('Choose the project');
    await dialog.run(async () => {
      const pos = await captureLocation().catch(() => null);
      const id = await rpc<string>('report_hse', {
        p_exec: proj,
        p: { ...f, occurred_at: new Date().toISOString(), injured: f.injured ?? 0, lat: pos?.lat ?? '', lng: pos?.lng ?? '' },
      });
      for (const x of files) await uploadAttachment('hse_report', id, 'hse_photo', x);
      router.replace(`/execution/hse/${id}`);
    }, 'Reported – the Senior Electrical Engineer and SM Projects are told');
  };
  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'HSE report' }} />
      <TestingBanner what="HSE reporting" />
      <ErrorBanner message={error} />
      <Section title="What happened">
        <Card>
          <Select label="Project" required value={proj} onChange={(v) => set('project', v)} options={(projects ?? []).map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))} />
          <Select label="Type" required value={f.kind} onChange={(v) => set('kind', v)} options={HSE_KINDS} />
          <Select label="Severity" required value={f.severity} onChange={(v) => set('severity', v)} options={HSE_SEVERITY} />
          <Field label="Where (zone, floor, chainage…)" required value={f.location} onChangeText={(v) => set('location', v)} />
          <Field label="Description" required multiline value={f.description} onChangeText={(v) => set('description', v)} />
          <Field label="Immediate action taken" multiline value={f.immediate_action} onChangeText={(v) => set('immediate_action', v)} />
          {f.kind === 'incident' ? (
            <>
              <NumberField label="People injured" value={f.injured} onChange={(v) => set('injured', v)} />
              <Toggle label="Lost-time injury (LTI)" value={f.lost_time} onChange={(v) => set('lost_time', v)} />
            </>
          ) : null}
          <Row wrap gap={6}>
            <Button small variant="secondary" title="+ Photo" onPress={() => dialog.run(() => addFile(false))} />
            {Platform.OS !== 'web' ? <Button small variant="secondary" title="📷 Take photo" onPress={() => dialog.run(() => addFile(true))} /> : null}
            {files.map((x, i) => (
              <Button key={`${x.name}-${i}`} small variant="ghost" title={`✕ ${x.name}`} onPress={() => setFiles(files.filter((_, k) => k !== i))} />
            ))}
          </Row>
          <Muted>Your location is recorded with the report. Mind the site camera rules (e.g. airside).</Muted>
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Report" onPress={save} />
      </Row>
    </Screen>
  );
}
