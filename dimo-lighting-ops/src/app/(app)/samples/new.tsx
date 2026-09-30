import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { ProjectPicker } from '@/components/pickers';
import { Button, Card, colors, DateField, ErrorBanner, Field, Muted, NumberField, Row, Screen, Section, Segmented, Select } from '@/components/ui';
import { captureLocation } from '@/components/VisitBits';
import { endOfWorkDay, fmtMoney } from '@/lib/format';
import { useMasters } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import type { Currency } from '@/lib/types';

type Item = { description: string; product_code: string; brand: string; quantity: number | null; unit_value: number | null };

/** Sample request (Section 13.1) – sales people only. */
export default function NewSample() {
  const dialog = useDialog();
  const masters = useMasters();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    project_id: null as string | null,
    sample_type: 'returnable' as 'returnable' | 'non_returnable',
    expected_return_date: null as string | null,
    purpose: null as string | null,
    required_by: null as string | null,
    handover_location: '',
    handover_lat: null as number | null,
    handover_lng: null as number | null,
    person: { name: '', designation: '', organization: '', phone: '' },
    notes: '',
    currency: 'LKR' as Currency,
  });
  const [items, setItems] = useState<Item[]>([{ description: '', product_code: '', brand: '', quantity: 1, unit_value: null }]);
  const total = items.reduce((a, i) => a + (i.quantity ?? 0) * (i.unit_value ?? 0), 0);

  const save = async (submit: boolean) => {
    setError(null);
    if (!f.project_id || !f.purpose || !f.required_by || !f.handover_location.trim()) return setError('Project, purpose, required-by date and handover location are required');
    if (f.sample_type === 'returnable' && !f.expected_return_date) return setError('Expected return date is mandatory for returnable samples');
    const good = items.filter((i) => i.description.trim() && i.quantity);
    if (!good.length) return setError('Add at least one item');
    await dialog.run(async () => {
      const { data, error: e } = await supabase
        .from('samples')
        .insert({
          project_id: f.project_id,
          sample_type: f.sample_type,
          expected_return_date: f.sample_type === 'returnable' ? f.expected_return_date : null,
          purpose: f.purpose,
          required_by: endOfWorkDay(f.required_by as string),
          handover_location: f.handover_location,
          handover_lat: f.handover_lat,
          handover_lng: f.handover_lng,
          handover_person: f.person,
          notes: f.notes || null,
          currency: f.currency,
        })
        .select('id')
        .single();
      if (e) throw new Error(e.message);
      const { error: ie } = await supabase.from('sample_items').insert(
        good.map((i) => ({ sample_id: data.id, description: i.description, product_code: i.product_code || null, brand: i.brand || null, quantity: i.quantity, unit_value: i.unit_value ?? 0 })),
      );
      if (ie) throw new Error(ie.message);
      if (submit) {
        const { error: se } = await supabase.rpc('submit_sample', { p_sample: data.id });
        if (se) throw new Error(se.message);
      }
      router.replace(`/samples/${data.id}`);
    }, submit ? 'Submitted – Operations will check availability' : 'Draft saved');
  };

  return (
    <Screen maxWidth={820}>
      <Stack.Screen options={{ title: 'Request sample' }} />
      <ErrorBanner message={error} />
      <Card>
        <ProjectPicker required value={f.project_id} onChange={(p) => setF((s) => ({ ...s, project_id: p?.id ?? null, currency: p?.currency ?? s.currency }))} />
        <Segmented
          value={f.sample_type}
          onChange={(v) => setF((s) => ({ ...s, sample_type: v }))}
          options={[
            { value: 'returnable', label: 'Returnable' },
            { value: 'non_returnable', label: 'Non-returnable' },
          ]}
        />
        {f.sample_type === 'returnable' ? <DateField label="Expected return date" required value={f.expected_return_date} onChange={(v) => setF((s) => ({ ...s, expected_return_date: v }))} quick={[7, 14, 30]} /> : null}
        <Select label="Purpose" required value={f.purpose} options={masters.values('sample_purpose').map((v) => ({ value: v, label: v }))} onChange={(v) => setF((s) => ({ ...s, purpose: v }))} />
        <DateField label="Required at site by" required value={f.required_by} onChange={(v) => setF((s) => ({ ...s, required_by: v }))} quick={[1, 2, 5]} />
      </Card>

      <Section title="Items" right={<Muted>Total {fmtMoney(total, f.currency)}</Muted>}>
        {items.map((it, i) => (
          <Card key={i} style={{ marginBottom: 8, backgroundColor: colors.soft }}>
            <Field label="Product description" required value={it.description} onChangeText={(t) => setItems((s) => s.map((x, j) => (j === i ? { ...x, description: t } : x)))} />
            <Row wrap gap={8}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Field label="Code" value={it.product_code} onChangeText={(t) => setItems((s) => s.map((x, j) => (j === i ? { ...x, product_code: t } : x)))} />
              </View>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Field label="Brand" value={it.brand} onChangeText={(t) => setItems((s) => s.map((x, j) => (j === i ? { ...x, brand: t } : x)))} />
              </View>
            </Row>
            <Row wrap gap={8}>
              <View style={{ flex: 1, minWidth: 120 }}>
                <NumberField label="Quantity" value={it.quantity} onChange={(v) => setItems((s) => s.map((x, j) => (j === i ? { ...x, quantity: v } : x)))} />
              </View>
              <View style={{ flex: 1, minWidth: 120 }}>
                <NumberField label="Unit value" suffix={f.currency} value={it.unit_value} onChange={(v) => setItems((s) => s.map((x, j) => (j === i ? { ...x, unit_value: v } : x)))} />
              </View>
            </Row>
            {items.length > 1 ? <Button small variant="ghost" title="Remove item" onPress={() => setItems((s) => s.filter((_, j) => j !== i))} /> : null}
          </Card>
        ))}
        <Button small variant="secondary" title="+ Item" onPress={() => setItems((s) => [...s, { description: '', product_code: '', brand: '', quantity: 1, unit_value: null }])} />
        <Select
          label="Currency"
          value={f.currency}
          onChange={(v) => setF((s) => ({ ...s, currency: v as Currency }))}
          options={[
            { value: 'LKR', label: 'LKR' },
            { value: 'USD', label: 'USD' },
          ]}
        />
      </Section>

      <Section title="Handover">
        <Card>
          <Field label="Handover location (address)" required value={f.handover_location} onChangeText={(t) => setF((s) => ({ ...s, handover_location: t }))} />
          <Button
            small
            variant="secondary"
            title={f.handover_lat ? '📍 Map pin set' : '📍 Use my location as the pin'}
            onPress={async () => {
              const pos = await captureLocation();
              if (pos) setF((s) => ({ ...s, handover_lat: pos.lat, handover_lng: pos.lng }));
            }}
          />
          <View style={{ height: 8 }} />
          {(['name', 'designation', 'organization', 'phone'] as const).map((k) => (
            <Field key={k} label={`Handover person – ${k}`} value={f.person[k]} onChangeText={(t) => setF((s) => ({ ...s, person: { ...s.person, [k]: t } }))} />
          ))}
          <Field label="Notes" multiline value={f.notes} onChangeText={(t) => setF((s) => ({ ...s, notes: t }))} />
        </Card>
      </Section>
      <Row gap={8} style={{ marginTop: 16 }}>
        <Button variant="secondary" title="Save draft" onPress={() => save(false)} />
        <Button title="Submit request" onPress={() => save(true)} />
      </Row>
    </Screen>
  );
}
