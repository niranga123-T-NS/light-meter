import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { ProjectPicker } from '@/components/pickers';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, Chip, colors, DateField, ErrorBanner, Field, Muted, Row, Screen, Section } from '@/components/ui';
import { EXEC_AREAS, type ExecFamily, type ExecProject } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const FAMILIES: ExecFamily[] = ['Building & architectural', 'Electrical', 'Controls & measurement', 'Infrastructure', 'Airport systems'];

/** Start execution on a project (or edit its areas, site and dates): any of the 18 project areas, combined. */
export default function StartExecution() {
  const dialog = useDialog();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ project_id: null as string | null, areas: [] as string[], site_address: '', start_date: null as string | null, end_date: null as string | null });
  const { data: existing } = useLoad(async () => {
    if (!id) return null;
    const { data } = await supabase.from('exec_projects').select('*').eq('id', id).maybeSingle();
    const e = data as ExecProject | null;
    if (e) setF({ project_id: e.project_id, areas: e.areas, site_address: e.site_address ?? '', start_date: e.start_date, end_date: e.end_date });
    return e;
  }, [id]);
  const toggle = (a: string) => setF((s) => ({ ...s, areas: s.areas.includes(a) ? s.areas.filter((x) => x !== a) : [...s.areas, a] }));

  const save = async () => {
    setError(null);
    if (!id && !f.project_id) return setError('Choose the project');
    if (!f.areas.length) return setError('Choose at least one project area');
    const p = { areas: f.areas, site_address: f.site_address, start_date: f.start_date ?? '', end_date: f.end_date ?? '', lat: existing?.lat ?? '', lng: existing?.lng ?? '' };
    await dialog.run(async () => {
      if (id) {
        await rpc('update_exec_project', { p_id: id, p });
        router.back();
      } else {
        const eid = await rpc<string>('start_execution', { p_project: f.project_id, p });
        router.replace(`/execution/${eid}`);
      }
    }, id ? 'Saved' : 'Execution started – SM Projects and the sales person are told');
  };

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: id ? 'Execution details' : 'Start execution' }} />
      <TestingBanner what="The execution module" />
      <ErrorBanner message={error} />
      {!id ? (
        <Section title="Project">
          <Card>
            <ProjectPicker value={f.project_id} onChange={(p) => setF((s) => ({ ...s, project_id: p?.id ?? null, site_address: s.site_address || [p?.location, p?.city].filter(Boolean).join(', ') }))} required />
            <Muted>Usually the won project from sales. Execution can be started once per project.</Muted>
          </Card>
        </Section>
      ) : null}
      <Section title={`Project areas (${f.areas.length} chosen)`}>
        <Card>
          <Muted>One project can combine several areas; each area brings its own checks and handover list.</Muted>
          {FAMILIES.map((fam) => (
            <View key={fam} style={{ gap: 6, marginTop: 8 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{fam}</Text>
              <Row wrap gap={6}>
                {EXEC_AREAS.filter((a) => a.family === fam).map((a) => (
                  <Chip key={a.value} label={a.label} on={f.areas.includes(a.value)} onPress={() => toggle(a.value)} />
                ))}
              </Row>
            </View>
          ))}
        </Card>
      </Section>
      <Section title="Site and dates">
        <Card>
          <Field label="Site address" multiline value={f.site_address} onChangeText={(v) => setF({ ...f, site_address: v })} />
          <Row wrap gap={8}>
            <DateField label="Start" value={f.start_date} onChange={(v) => setF({ ...f, start_date: v })} quick={[0]} />
            <DateField label="Planned finish" value={f.end_date} onChange={(v) => setF({ ...f, end_date: v })} quick={[]} />
          </Row>
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title={id ? 'Save' : 'Start execution'} onPress={save} />
      </Row>
    </Screen>
  );
}
