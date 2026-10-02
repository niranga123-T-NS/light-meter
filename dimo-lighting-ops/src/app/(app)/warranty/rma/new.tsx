import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Field, Loading, Muted, NumberField, Row, Screen, Section, Select, Toggle } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Manufacturer, Warranty, WarrantyClaim, WarrantyLine } from '@/lib/types';

type Item = { key: string; claim_id: string | null; label: string; product: string; quantity: number | null; batch_code: string; value_claimed: number | null; on: boolean };
let seq = 0;

/** Raise a back-to-back claim to the manufacturer (warranty officer – Senior Electrical Engineer; Operations as back-up). */
export default function RmaNew() {
  const { claim } = useLocalSearchParams<{ claim?: string }>();
  const dialog = useDialog();
  const [mfr, setMfr] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data, error: loadErr } = useLoad(async () => {
    const [m, c, l, w] = await Promise.all([
      supabase.from('manufacturers').select('*').eq('active', true).order('name'),
      supabase.from('warranty_claims').select('*').eq('decision', 'covered').in('supplier_status', ['none', 'rejected']).neq('status', 'cancelled'),
      supabase.from('warranty_lines').select('*'),
      supabase.from('warranties').select('id, code, project_name, customer'),
    ]);
    return {
      manufacturers: (m.data ?? []) as Manufacturer[],
      claims: (c.data ?? []) as WarrantyClaim[],
      lines: (l.data ?? []) as WarrantyLine[],
      warranties: (w.data ?? []) as Pick<Warranty, 'id' | 'code' | 'project_name' | 'customer'>[],
    };
  }, []);
  if (!data) return <Screen>{loadErr ? <ErrorBanner message={loadErr} /> : <Loading />}</Screen>;
  const lineOf = (c: WarrantyClaim) => data.lines.find((l) => l.id === c.line_id);
  const wOf = (c: WarrantyClaim) => data.warranties.find((w) => w.id === c.warranty_id);
  const first = data.claims.find((c) => c.id === claim);
  const manufacturerId = mfr ?? (first ? (lineOf(first)?.manufacturer_id ?? null) : null);
  const m = data.manufacturers.find((x) => x.id === manufacturerId);
  // Covered customer claims for this manufacturer that have no manufacturer claim yet
  const candidates = data.claims.filter((c) => c.id === claim || (manufacturerId && lineOf(c)?.manufacturer_id === manufacturerId));
  const list: Item[] =
    items ??
    candidates.map((c) => {
      const l = lineOf(c);
      return {
        key: c.id,
        claim_id: c.id,
        label: `${c.code} · ${wOf(c)?.project_name ?? ''} · ${wOf(c)?.customer ?? ''} · logged ${fmtDate(c.logged_at)}`,
        product: l ? `${l.product_group}${l.brand ? ` – ${l.brand}` : ''}` : c.description,
        quantity: c.quantity,
        batch_code: '',
        value_claimed: null,
        on: c.id === claim,
      };
    });
  const setItem = (key: string, patch: Partial<Item>) => setItems(list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const save = () => {
    setError(null);
    if (!manufacturerId) return setError('Choose the manufacturer');
    const chosen = list.filter((i) => i.on);
    if (!chosen.length) return setError('Tick at least one item');
    const bad = chosen.findIndex((i) => !i.product.trim() || !i.quantity);
    if (bad >= 0) return setError(`Item ${bad + 1}: enter the product and quantity`);
    return dialog.run(async () => {
      const id = await rpc<string>('create_manufacturer_claim', {
        p_manufacturer: manufacturerId,
        p_items: chosen.map((i) => ({
          claim_id: i.claim_id ?? '',
          product: i.product,
          quantity: String(i.quantity),
          batch_code: i.batch_code,
          value_claimed: i.value_claimed == null ? '' : String(i.value_claimed),
        })),
        p_evidence: evidence || null,
      });
      router.replace(`/warranty/rma/${id}`);
    }, 'Manufacturer claim created – contact the manufacturer and record it');
  };

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: 'Manufacturer claim (RMA)' }} />
      <ErrorBanner message={error} />
      <Section title="Manufacturer">
        <Card>
          <Select
            label="Manufacturer"
            required
            searchable
            value={manufacturerId}
            onChange={(v) => {
              setMfr(v || null);
              setItems(null);
            }}
            options={data.manufacturers.map((x) => ({ value: x.id, label: x.name, hint: x.local_agent ?? undefined }))}
          />
          {!data.manufacturers.length ? <Muted>Add the manufacturer first under Warranty → Manufacturers.</Muted> : null}
          {m ? (
            <Muted>
              {[m.local_agent ? `Agent: ${m.local_agent}` : null, m.contact ? `Contact: ${m.contact}` : null, m.warranty_terms ? `Terms: ${m.warranty_terms}` : null]
                .filter(Boolean)
                .join(' · ') || 'No contact details recorded'}
            </Muted>
          ) : null}
        </Card>
      </Section>
      <Section
        title="Items claimed"
        right={
          <Button
            small
            title="+ Item"
            onPress={() => setItems([...list, { key: `n${++seq}`, claim_id: null, label: 'Item not linked to a customer claim', product: '', quantity: null, batch_code: '', value_claimed: null, on: true }])}
          />
        }
      >
        {list.map((i) => (
          <Card key={i.key} style={{ marginBottom: 8, opacity: i.on ? 1 : 0.6 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '600', flex: 1, color: colors.text }}>{i.label}</Text>
              <Toggle label="Include" value={i.on} onChange={(v) => setItem(i.key, { on: v })} />
            </Row>
            {i.on ? (
              <>
                <Field label="Product" required value={i.product} onChangeText={(v) => setItem(i.key, { product: v })} />
                <Row wrap gap={8}>
                  <View style={{ flex: 1, minWidth: 120 }}>
                    <NumberField label="Quantity" required value={i.quantity} onChange={(v) => setItem(i.key, { quantity: v })} />
                  </View>
                  <View style={{ flex: 1, minWidth: 140 }}>
                    <Field label="Batch / date code" value={i.batch_code} onChangeText={(v) => setItem(i.key, { batch_code: v })} />
                  </View>
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <NumberField label="Value claimed" value={i.value_claimed} onChange={(v) => setItem(i.key, { value_claimed: v })} />
                  </View>
                </Row>
              </>
            ) : null}
          </Card>
        ))}
        {!list.length ? <Muted>No covered claims for this manufacturer – add an item.</Muted> : null}
      </Section>
      <Section title="Evidence">
        <Card>
          <Field label="Evidence collected" multiline value={evidence} onChangeText={setEvidence} hint={m?.evidence_required ? `Required: ${m.evidence_required}` : 'e.g. photos, failure report, batch codes, purchase invoice copy'} />
          <Muted>Upload the evidence and the letters from the manufacturer on the claim after saving. Contact with the manufacturer is made manually.</Muted>
        </Card>
      </Section>
      <Row style={{ marginTop: 12 }}>
        <Button title="Create manufacturer claim" onPress={save} />
      </Row>
    </Screen>
  );
}
