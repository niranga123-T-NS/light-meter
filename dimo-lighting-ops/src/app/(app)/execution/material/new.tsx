import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, DateField, ErrorBanner, Field, Muted, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Line = { item: string; unit: string; qty: number | null };

/** Material request from site: items, quantities and the date needed – SEE approves (SM Projects too above the limit), Operations orders. */
export default function NewMaterialRequest() {
  const dialog = useDialog();
  const me = useMe();
  const sub = me.role === 'sub_supervisor';
  const params = useLocalSearchParams<{ project?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(params.project ?? null);
  const [required, setRequired] = useState<string | null>(null);
  const [purpose, setPurpose] = useState('');
  const [value, setValue] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([{ item: '', unit: 'nos', qty: null }]);
  const { data: projects } = useLoad(async () => {
    const { data } = await supabase.from('exec_projects').select('*').eq('status', 'active').order('name');
    return (data ?? []) as ExecProject[];
  });
  const proj = project ?? projects?.[0]?.id ?? null;
  const setLine = (i: number, l: Partial<Line>) => setLines((s) => s.map((x, k) => (k === i ? { ...x, ...l } : x)));
  const save = async () => {
    setError(null);
    if (!proj) return setError('Choose the project');
    if (!required) return setError('Set the date the material is needed on site');
    await dialog.run(async () => {
      const id = await rpc<string>('raise_material_request', {
        p_exec: proj,
        p: { required_date: required, purpose, est_value: value ?? '', lines: lines.map((l) => ({ ...l, qty: l.qty ?? '' })) },
      });
      router.replace(`/execution/material/${id}`);
    }, sub ? 'Sent to the Assistant Engineer' : 'Requested – the Senior Electrical Engineer approves it');
  };
  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'Material request' }} />
      <TestingBanner what="Materials and stores" />
      <ErrorBanner message={error} />
      <Section title="Request">
        <Card>
          <Select label="Project" required value={proj} onChange={setProject} options={(projects ?? []).map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))} />
          <DateField label="Needed on site by" required value={required} onChange={setRequired} quick={[3, 7, 14]} />
          <Field label="For (area / activity)" value={purpose} onChangeText={setPurpose} />
          {sub ? (
            <Muted>The Assistant Engineer checks your request and sends it for approval.</Muted>
          ) : (
            <>
              <NumberField label="Estimated value (LKR)" value={value} onChange={setValue} />
              <Muted>Above LKR 1 Mn SM Projects approves too.</Muted>
            </>
          )}
        </Card>
      </Section>
      <Section title="Items" right={<Button small variant="secondary" title="+ Item" onPress={() => setLines((s) => [...s, { item: '', unit: 'nos', qty: null }])} />}>
        {lines.map((l, i) => (
          <Card key={i} style={{ marginBottom: 6 }}>
            <Field label={`Item ${i + 1}`} value={l.item} onChangeText={(v) => setLine(i, { item: v })} />
            <Row gap={8}>
              <Field label="Unit" value={l.unit} onChangeText={(v) => setLine(i, { unit: v })} />
              <NumberField label="Quantity" value={l.qty} onChange={(v) => setLine(i, { qty: v })} />
            </Row>
            {lines.length > 1 ? <Button small variant="ghost" title="Remove" onPress={() => setLines((s) => s.filter((_, k) => k !== i))} /> : null}
          </Card>
        ))}
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Request" onPress={save} />
      </Row>
    </Screen>
  );
}
