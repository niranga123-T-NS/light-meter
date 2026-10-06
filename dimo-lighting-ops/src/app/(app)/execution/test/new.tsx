import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Field, Muted, Notice, Row, Screen, Section, Select } from '@/components/ui';
import { EXEC_AREAS, type ExecProject, type Instrument } from '@/lib/execution';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Line = { param: string; unit: string; min: string; max: string; value: string };
const blank = (): Line => ({ param: '', unit: '', min: '', max: '', value: '' });

/** Common tests with their readings pre-filled as rows (limits can be changed). */
const TEMPLATES: Record<string, Line[]> = {
  'Insulation resistance': [
    { param: 'L-N', unit: 'MΩ', min: '1', max: '', value: '' },
    { param: 'L-E', unit: 'MΩ', min: '1', max: '', value: '' },
    { param: 'N-E', unit: 'MΩ', min: '1', max: '', value: '' },
  ],
  'Earth continuity': [{ param: 'R1+R2', unit: 'Ω', min: '', max: '1', value: '' }],
  'Earth electrode resistance': [{ param: 'Electrode', unit: 'Ω', min: '', max: '10', value: '' }],
  'Lux level': [
    { param: 'Average', unit: 'lx', min: '', max: '', value: '' },
    { param: 'Uniformity Uo', unit: '', min: '0.4', max: '', value: '' },
  ],
  'Emergency duration': [{ param: 'Duration', unit: 'min', min: '180', max: '', value: '' }],
  'Voltage drop': [{ param: 'At farthest point', unit: '%', min: '', max: '4', value: '' }],
  'RCD trip time': [{ param: 'At 1×IΔn', unit: 'ms', min: '', max: '300', value: '' }],
  'DALI / control addressing': [{ param: 'Devices responding', unit: '%', min: '100', max: '', value: '' }],
};

/** Record an inspection / test: readings are checked against the limits; a failure raises an NCR automatically. */
export default function NewTest() {
  const dialog = useDialog();
  const params = useLocalSearchParams<{ project?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(params.project ?? null);
  const [f, setF] = useState({ area: null as string | null, system: '', test_type: 'Insulation resistance', instrument_id: null as string | null, witness: '', note: '' });
  const [lines, setLines] = useState<Line[]>(TEMPLATES['Insulation resistance']);
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
  const setLine = (i: number, l: Partial<Line>) => setLines((s) => s.map((x, k) => (k === i ? { ...x, ...l } : x)));
  const pass = (l: Line) => {
    const v = Number(l.value);
    if (l.value === '' || Number.isNaN(v)) return null;
    return (l.min === '' || v >= Number(l.min)) && (l.max === '' || v <= Number(l.max));
  };
  const save = async () => {
    setError(null);
    if (!proj) return setError('Choose the project');
    await dialog.run(async () => {
      await rpc('record_test', { p_exec: proj, p: { ...f, area: f.area ?? '', instrument_id: f.instrument_id ?? '', rows: lines } });
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
          <Select label="Area" value={f.area} onChange={(v) => set('area', v)} options={EXEC_AREAS.filter((a) => areas.includes(a.value)).map((a) => ({ value: a.value, label: a.label }))} />
          <Field label="System / circuit (e.g. DB-2, Level 3 emergency)" required value={f.system} onChangeText={(v) => set('system', v)} />
          <Select
            label="Test"
            required
            value={f.test_type}
            onChange={(v) => {
              set('test_type', v);
              setLines(TEMPLATES[v] ?? [blank()]);
            }}
            options={[...Object.keys(TEMPLATES), 'Other'].map((k) => ({ value: k, label: k }))}
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
      <Section title="Readings" right={<Button small variant="secondary" title="+ Reading" onPress={() => setLines((s) => [...s, blank()])} />}>
        {lines.map((l, i) => {
          const ok = pass(l);
          return (
            <Card key={i} style={{ marginBottom: 6, borderLeftWidth: 4, borderLeftColor: ok == null ? colors.line : ok ? colors.green : colors.red }}>
              <Row gap={8} wrap>
                <Field label="Parameter" value={l.param} onChangeText={(v) => setLine(i, { param: v })} />
                <Field label="Unit" value={l.unit} onChangeText={(v) => setLine(i, { unit: v })} />
              </Row>
              <Row gap={8} wrap>
                <Field label="Min" keyboardType="numeric" value={l.min} onChangeText={(v) => setLine(i, { min: v })} />
                <Field label="Max" keyboardType="numeric" value={l.max} onChangeText={(v) => setLine(i, { max: v })} />
                <Field label="Measured" keyboardType="numeric" value={l.value} onChangeText={(v) => setLine(i, { value: v })} />
              </Row>
              <Row style={{ justifyContent: 'space-between' }}>
                <Muted>{ok == null ? '' : ok ? '✓ Within limits' : '✕ Outside limits – an NCR will be raised'}</Muted>
                {lines.length > 1 ? <Button small variant="ghost" title="Remove" onPress={() => setLines((s) => s.filter((_, k) => k !== i))} /> : null}
              </Row>
            </Card>
          );
        })}
        <Field label="Note" multiline value={f.note} onChangeText={(v) => set('note', v)} />
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Save test" onPress={save} disabled={expired} />
      </Row>
    </Screen>
  );
}
