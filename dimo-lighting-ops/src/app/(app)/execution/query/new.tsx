import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, ErrorBanner, Field, Muted, Row, Screen, Section, Select } from '@/components/ui';
import type { ExecProject } from '@/lib/execution';
import { pickDocument, pickImage, uploadAttachment, type PickedFile } from '@/lib/files';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** Design query from site with sketches, photos and marked-up drawings attached. */
export default function NewQuery() {
  const dialog = useDialog();
  const params = useLocalSearchParams<{ project?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [f, setF] = useState({ project: params.project ?? (null as string | null), question: '', drawing: '', blocks: '' });
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
    if (!f.question.trim()) return setError('Write the question');
    await dialog.run(async () => {
      const id = await rpc<string>('raise_design_query', { p_exec: proj, p_question: f.question, p_drawing: f.drawing || null, p_blocks: f.blocks || null });
      for (const x of files) await uploadAttachment('design_query', id, 'dq_file', x);
      router.replace(`/execution/query/${id}`);
    }, 'Raised');
  };
  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'Design query' }} />
      <TestingBanner what="Design queries" />
      <ErrorBanner message={error} />
      <Section title="Question">
        <Card>
          <Select label="Project" required value={proj} onChange={(v) => set('project', v)} options={(projects ?? []).map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))} />
          <Field label="Question" required multiline value={f.question} onChangeText={(v) => set('question', v)} />
          <Field label="Drawing / document reference" value={f.drawing} onChangeText={(v) => set('drawing', v)} />
          <Field label="Work it holds up" value={f.blocks} onChangeText={(v) => set('blocks', v)} />
          <Row wrap gap={6}>
            <Button small variant="secondary" title="+ Sketch / drawing / photo" onPress={() => dialog.run(() => addFile(false))} />
            {Platform.OS !== 'web' ? <Button small variant="secondary" title="📷 Take photo" onPress={() => dialog.run(() => addFile(true))} /> : null}
            {files.map((x, i) => (
              <Button key={`${x.name}-${i}`} small variant="ghost" title={`✕ ${x.name}`} onPress={() => setFiles(files.filter((_, k) => k !== i))} />
            ))}
          </Row>
          <Muted>From the SEE it goes straight to the Design Manager with a target date; from an AE the SEE screens it first.</Muted>
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Raise" onPress={save} />
      </Row>
    </Screen>
  );
}
