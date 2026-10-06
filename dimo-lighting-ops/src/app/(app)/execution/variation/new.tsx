import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, ErrorBanner, Field, Row, Screen, Section, Select } from '@/components/ui';
import { VAR_REASONS, VAR_TYPES, type ExecProject } from '@/lib/execution';
import { pickDocument, pickImage, uploadAttachment, type PickedFile } from '@/lib/files';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** Raise a variation from site: what, why, quantities, client instruction, photos and documents. */
export default function NewVariation() {
  const dialog = useDialog();
  const params = useLocalSearchParams<{ project?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [f, setF] = useState({ project: params.project ?? (null as string | null), vtype: 'addition', reason: 'client_instruction', title: '', description: '', quantities: '', client_ref: '' });
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
      const id = await rpc<string>('raise_variation', { p_exec: proj, p: f });
      for (const x of files) await uploadAttachment('variation', id, x.mimeType?.startsWith('image/') ? 'var_photo' : 'var_doc', x);
      router.replace(`/execution/variation/${id}`);
    }, 'Raised – the Senior Electrical Engineer screens it');
  };
  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'Raise a variation' }} />
      <TestingBanner what="Variations" />
      <ErrorBanner message={error} />
      <Section title="Variation">
        <Card>
          <Select label="Project" required value={proj} onChange={(v) => set('project', v)} options={(projects ?? []).map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))} />
          <Select label="Type" required value={f.vtype} onChange={(v) => set('vtype', v)} options={VAR_TYPES} />
          <Select label="Reason" required value={f.reason} onChange={(v) => set('reason', v)} options={VAR_REASONS} />
          <Field label="Title" required value={f.title} onChangeText={(v) => set('title', v)} />
          <Field label="Description" required multiline value={f.description} onChangeText={(v) => set('description', v)} />
          <Field label="Quantities (rough)" multiline value={f.quantities} onChangeText={(v) => set('quantities', v)} />
          <Field label="Client instruction reference" value={f.client_ref} onChangeText={(v) => set('client_ref', v)} />
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
        <Button title="Raise" onPress={save} />
      </Row>
    </Screen>
  );
}
