import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { pickTestDoc, TEST_DOC_KINDS } from '@/components/exec/TestDocs';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Field, Muted, Notice, Row, Screen, Section, Select } from '@/components/ui';
import { EXEC_AREAS, type ExecProject, type Instrument } from '@/lib/execution';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import { uploadAttachment, type PickedFile } from '@/lib/files';

type Queued = { kind: string; file: PickedFile };
const TESTS = ['Insulation resistance', 'Earth continuity', 'Earth electrode resistance', 'Lux level', 'Emergency duration', 'Voltage drop', 'RCD trip time', 'DALI / control addressing', 'Other'];

/** Record an inspection / test: the readings are uploaded as documents (several per category); the engineer states the result – a failure raises an NCR. */
export default function NewTest() {
  const dialog = useDialog();
  const params = useLocalSearchParams<{ project?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(params.project ?? null);
  const [f, setF] = useState({ area: null as string | null, system: '', test_type: 'Insulation resistance', instrument_id: null as string | null, witness: '', note: '', result: null as string | null });
  const [queue, setQueue] = useState<Queued[]>([]);
  const [customArea, setCustomArea] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const { data } = useLoad(async () => {
    const [p, i] = await Promise.all([
      supabase.from('exec_projects').select('*').eq('status', 'active').order('name'),
      supabase.from('test_instruments').select('*').eq('active', true).order('name'),
    ]);
    return { projects: (p.data ?? []) as ExecProject[], instruments: (i.data ?? []) as Instrument[] };
  });
  const proj = project ?? data?.projects[0]?.id ?? null;
  const areas = data?.projects.find((p) => p.id === proj)?.areas ?? [];
  const inst = data?.instruments.find((i) => i.id === f.instrument_id);
  const expired = !!inst && inst.calibration_due < todayISO();
  const add = async (kind: string, photo: boolean, camera = false) => {
    try {
      const file = await pickTestDoc(photo, camera);
      if (file) setQueue((q) => [...q, { kind, file }]);
    } catch (e) {
      dialog.toast((e as Error).message, 'error');
    }
  };
  const save = async () => {
    setError(null);
    if (!proj) return setError('Choose the project');
    if (!queue.length) return setError('Upload the reading documents (at least one)');
    if (!f.result) return setError('State the result – pass or fail');
    if (customArea && !f.area?.trim()) return setError('Type the area, or choose one from the list');
    await dialog.run(async () => {
      const id = await rpc<string>('record_test', { p_exec: proj, p: { ...f, area: f.area ?? '', instrument_id: f.instrument_id ?? '', rows: [] } });
      for (const q of queue) await uploadAttachment('test_record', id, q.kind, q.file);
      router.replace({ pathname: '/execution/[id]', params: { id: proj, tab: 'qa' } });
    }, 'Recorded – the Senior Electrical Engineer verifies it');
  };
  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: 'Record a test' }} />
      <TestingBanner what="QA / QC" />
      <ErrorBanner message={error} />
      <Section title="Test">
        <Card>
          <Select label="Project" required value={proj} onChange={setProject} options={(data?.projects ?? []).map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))} />
          <Select
            label="Area"
            searchable
            value={customArea ? '__other' : f.area}
            onChange={(v) => {
              setCustomArea(v === '__other');
              set('area', v === '__other' ? '' : v);
            }}
            options={[
              ...EXEC_AREAS.filter((a) => areas.includes(a.value)).map((a) => ({ value: a.value, label: `${a.label} · project area` })),
              ...EXEC_AREAS.filter((a) => !areas.includes(a.value)).map((a) => ({ value: a.value, label: a.label })),
              { value: '__other', label: 'Other – type your own…' },
            ]}
          />
          {customArea ? <Field label="Area (your own)" required value={f.area ?? ''} onChangeText={(v) => set('area', v)} placeholder="e.g. Basement car park, Guard house, Pump room" /> : null}
          <Field label="System / circuit (e.g. DB-2, Level 3 emergency)" required value={f.system} onChangeText={(v) => set('system', v)} />
          <Select
            label="Test"
            required
            value={f.test_type}
            onChange={(v) => set('test_type', v)}
            options={TESTS.map((k) => ({ value: k, label: k }))}
          />
          <Select
            label="Instrument"
            value={f.instrument_id}
            onChange={(v) => set('instrument_id', v)}
            options={(data?.instruments ?? []).map((i) => ({ value: i.id, label: `${i.name} · ${i.serial_no} · calibrated to ${fmtDate(i.calibration_due)}` }))}
          />
          {expired ? <Notice tone={colors.red}>{`Calibration of ${inst?.name} expired on ${fmtDate(inst?.calibration_due)} – the test cannot be saved with it.`}</Notice> : null}
          <Field label="Witness (client / consultant)" value={f.witness} onChangeText={(v) => set('witness', v)} />
        </Card>
      </Section>
      <Section title="Reading documents">
        <Muted style={{ marginBottom: 6 }}>Upload the readings – several files per category (PDF, Excel, photos). They are kept with the test, grouped by category and downloadable.</Muted>
        {TEST_DOC_KINDS.map((k) => {
          const mine = queue.filter((q) => q.kind === k.kind);
          return (
            <Card key={k.kind} style={{ marginBottom: 6, borderLeftWidth: 4, borderLeftColor: mine.length ? colors.green : colors.line }}>
              <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{`${k.label}${mine.length ? ` (${mine.length})` : ''}`}</Text>
                  <Muted>{k.hint}</Muted>
                </View>
                <Row gap={6}>
                  <Button small variant="secondary" title="+ PDF / file" onPress={() => add(k.kind, false)} />
                  <Button small variant="secondary" title="+ Photo" onPress={() => add(k.kind, true)} />
                  {Platform.OS !== 'web' ? <Button small variant="secondary" title="📷 Take photo" onPress={() => add(k.kind, true, true)} /> : null}
                </Row>
              </Row>
              {mine.map((q) => (
                <Row key={q.file.uri + q.file.name} gap={8} style={{ justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
                  <Text style={{ color: colors.ink, flexShrink: 1 }}>{`📄 ${q.file.name}`}</Text>
                  <Button small variant="ghost" title="Remove" onPress={() => setQueue((s) => s.filter((x) => x !== q))} />
                </Row>
              ))}
            </Card>
          );
        })}
        <Select
          label="Result"
          required
          value={f.result}
          onChange={(v) => set('result', v)}
          options={[
            { value: 'pass', label: 'Pass – all readings within limits' },
            { value: 'fail', label: 'Fail – an NCR is raised' },
          ]}
        />
        <Field label="Note" multiline value={f.note} onChangeText={(v) => set('note', v)} />
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Save test" onPress={save} disabled={expired || !queue.length || !f.result} />
      </Row>
    </Screen>
  );
}
