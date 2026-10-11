import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { CatalogPicker, type CatalogItem } from '@/components/CatalogPicker';
import { AddItemSteps } from '@/components/AddItemSteps';
import { StockMatches } from '@/components/StockMatches';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, DateField, ErrorBanner, Field, Grid, Muted, NumberField, Pill, Row, Screen, Section, Segmented, Select, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import type { StockMatch } from '@/lib/returns';
import { pickDocument, type PickedFile, uploadAttachment } from '@/lib/files';
import { rpc, supabase } from '@/lib/supabase';

type Line = {
  /** How the item was added: taken from Project returns, from SAP stock, or a new item (only after both stocks were checked) */
  kind: 'returns' | 'sap' | 'new';
  catalog: CatalogItem | null;
  custom: boolean;
  item: string;
  category: string | null;
  spec: string;
  brand: string;
  unit: string;
  qty: number | null;
  rate: number | null;
  note: string;
  /** Taken from the Project returns stock (reserved) */
  fromReturn: StockMatch | null;
  /** An SAP stock item to issue instead of buying */
  fromSap: StockMatch | null;
  /** Stock matched, but the engineer orders new – with the reason */
  orderNew: boolean;
  newReason: string;
  /** Stock matched this line (a choice is then required) */
  matched: boolean;
  /** Datasheets, drawings, photos – uploaded with the request */
  files: PickedFile[];
};
const blank = (): Line => ({ kind: 'new', catalog: null, custom: false, item: '', category: null, spec: '', brand: '', unit: '', qty: null, rate: null, note: '', fromReturn: null, fromSap: null, orderNew: false, newReason: '', matched: false, files: [] });
const CATEGORIES = [
  'Indoor luminaires', 'Outdoor luminaires', 'Road lighting', 'Floodlighting', 'Sports lighting', 'Tunnel lighting', 'Facade lighting', 'Emergency lighting',
  'Central battery systems', 'Airport systems (AGL)', 'Airport systems', 'Cables', 'Cable accessories', 'Containment', 'Switchgear',
  'Earthing & lightning protection', 'Underground cabling', 'Lighting control & drivers', 'Measurement & testing', 'Fixings & hardware', 'Civil for lighting',
  'Batteries & spares', 'Other',
].map((c) => ({ value: c, label: c }));

/** Material request from site: catalogue items (or ticked custom items) with specification, make and quantity – SEE approves (SM Projects too above the limit), Operations orders. */
export default function NewMaterialRequest() {
  const dialog = useDialog();
  const me = useMe();
  const sub = me.role === 'sub_supervisor';
  const params = useLocalSearchParams<{ project?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(params.project ?? null);
  const [required, setRequired] = useState<string | null>(null);
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [activity, setActivity] = useState<string | null>(null);
  const [purpose, setPurpose] = useState('');
  const [deliverTo, setDeliverTo] = useState('');
  const [contact, setContact] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [adding, setAdding] = useState(true);
  const [picking, setPicking] = useState<number | null>(null);
  const { data: projects } = useLoad(async () => {
    const { data } = await supabase.from('exec_projects').select('*').eq('status', 'active').order('name');
    return (data ?? []) as ExecProject[];
  });
  const proj = project ?? projects?.[0]?.id ?? null;
  const areas = projects?.find((p) => p.id === proj)?.areas ?? [];
  const { data: acts } = useLoad(async () => {
    if (!proj) return [];
    const { data } = await supabase.from('exec_activities').select('id, code, name, es, actual_finish').eq('exec_project_id', proj).is('actual_finish', null).order('code');
    return (data ?? []) as { id: string; code: string; name: string; es: string | null }[];
  }, [proj]);
  const setLine = (i: number, l: Partial<Line>) => setLines((s) => s.map((x, k) => (k === i ? { ...x, ...l } : x)));
  // Each line's matches box reports whether stock matched (stable callbacks, so it does not loop)
  const onFound = useMemo(
    () => lines.map((_, i) => (found: boolean) => setLines((s) => s.map((x, k) => (k === i && x.matched !== found ? { ...x, matched: found } : x)))),
    [lines.length], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const save = async () => {
    setError(null);
    if (!proj) return setError('Choose the project');
    if (!required) return setError('Set the date the material is needed on site');
    const empty = lines.findIndex((l) => l.kind === 'new' && !l.catalog && !l.custom);
    if (empty >= 0) return setError(`Item ${empty + 1}: choose it from the catalogue, or tick “Not in the catalogue” and describe it`);
    const used = lines.filter((l) => l.kind !== 'new' || l.catalog || l.custom);
    if (!used.length) return setError('Add at least one item – check the Project returns and the SAP stock first, then add a new item if needed');
    const bad = used.findIndex((l) => (l.custom && !l.fromReturn && !l.item.trim()) || !l.qty || !(l.unit || l.catalog?.unit || l.fromReturn?.unit));
    const undecided = used.findIndex((l) => l.matched && !l.fromReturn && !l.fromSap && !(l.orderNew && l.newReason.trim()));
    if (undecided >= 0) return setError(`Item ${lines.indexOf(used[undecided]) + 1} is in stock – take it from Project returns or SAP stock, or choose “Order new” with the reason`);
    const over = used.findIndex((l) => l.fromReturn && (l.qty ?? 0) > l.fromReturn.available);
    if (over >= 0) return setError(`Item ${lines.indexOf(used[over]) + 1}: only ${used[over].fromReturn?.available} ${used[over].fromReturn?.unit} available in Project returns`);
    if (bad >= 0) return setError(`Item ${lines.indexOf(used[bad]) + 1}: give the ${used[bad].custom && !used[bad].item.trim() ? 'description' : 'quantity and unit'}`);
    await dialog.run(async () => {
      const id = await rpc<string>('raise_material_request', {
        p_exec: proj,
        p: {
          required_date: required,
          priority,
          activity_id: activity,
          purpose,
          deliver_to: deliverTo,
          site_contact: contact,
          lines: used.map((l) => ({
            catalog_id: l.custom ? null : l.catalog?.id,
            custom: l.custom && !l.fromReturn,
            return_item_id: l.fromReturn?.ref ?? null,
            sap_material: l.fromSap?.ref ?? null,
            order_new: l.orderNew && !l.fromReturn && !l.fromSap,
            order_new_reason: l.orderNew && !l.fromReturn && !l.fromSap ? l.newReason : null,
            item: l.fromReturn ? l.fromReturn.item : l.custom ? l.item : l.catalog?.name,
            category: l.custom ? l.category : l.catalog?.category,
            spec: l.spec,
            brand: l.brand,
            unit: l.unit || l.catalog?.unit || l.fromReturn?.unit || '',
            qty: l.qty ?? '',
            note: l.note,
          })),
        },
      });
      // Datasheets go with the request, named after their item
      for (const l of used)
        for (const f of l.files) await uploadAttachment('material_request', id, 'datasheet', { ...f, name: `Item ${used.indexOf(l) + 1} – ${l.item || l.catalog?.name || ''} – ${f.name}`.slice(0, 180) });
      router.replace(`/execution/material/${id}`);
    }, sub ? 'Sent to the Assistant Engineer' : 'Requested – the Senior Electrical Engineer approves it');
  };

  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: 'Material request' }} />
      <TestingBanner what="Materials and stores" />
      <ErrorBanner message={error} />
      <Section title="Request">
        <Card>
          <Select label="Project" required value={proj} onChange={(v) => { setProject(v); setActivity(null); }} options={(projects ?? []).map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))} />
          <Grid min={260}>
            <DateField label="Needed on site by" required value={required} onChange={setRequired} quick={[3, 7, 14]} />
            <View>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 }}>Priority</Text>
              <Segmented value={priority} onChange={setPriority} options={[{ value: 'normal', label: 'Normal' }, { value: 'urgent', label: 'Urgent' }]} />
            </View>
          </Grid>
          <Select
            label="For programme activity"
            searchable
            value={activity}
            onChange={setActivity}
            options={[{ value: '', label: '— not linked —' }, ...(acts ?? []).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))]}
          />
          <Grid min={260}>
            <Field label="Area / zone / purpose" value={purpose} onChangeText={setPurpose} placeholder="e.g. Zone B – masts M1–M6 foundations" />
            <Field label="Deliver to" value={deliverTo} onChangeText={setDeliverTo} placeholder="Site store, zone, or address" />
          </Grid>
          <Field label="Site contact (name and phone)" value={contact} onChangeText={setContact} />
          <Muted>
            {sub
              ? 'The Assistant Engineer checks your request and sends it to the Senior Electrical Engineer. Prices and values are handled in SAP.'
              : 'The Senior Electrical Engineer approves it; Operations orders it and sets the delivery date and time. Prices and values are handled in SAP.'}
          </Muted>
        </Card>
      </Section>

      <Section title={`Items (${lines.length})`} right={!adding ? <Button small variant="secondary" title="+ Add item" onPress={() => setAdding(true)} /> : null}>
        {lines.map((l, i) => (
          <Card key={i} style={{ marginBottom: 8, gap: 4 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Row gap={6} style={{ alignItems: 'center' }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>{`Item ${i + 1}`}</Text>
                <Pill label={l.kind === 'returns' ? 'From Project returns' : l.kind === 'sap' ? 'From SAP stock' : 'New material'} tone={l.kind === 'returns' ? colors.green : l.kind === 'sap' ? colors.blue : colors.amber} />
              </Row>
              <Button small variant="ghost" title="Remove" onPress={() => setLines((s) => s.filter((_, k) => k !== i))} />
            </Row>
            {l.kind !== 'new' ? (
              <View style={{ backgroundColor: colors.soft, borderRadius: 8, padding: 8 }}>
                <Text style={{ color: colors.ink, fontWeight: '600' }}>{(l.fromReturn ?? l.fromSap)?.item}</Text>
                <Muted>
                  {l.fromReturn
                    ? `${l.fromReturn.available} ${l.fromReturn.unit} available${l.fromReturn.location ? ` at ${l.fromReturn.location}` : ''} · ${l.fromReturn.condition ?? ''} – reserved when you send the request, booked out when received on site`
                    : `SAP material ${l.fromSap?.ref} · ${l.fromSap?.available} ${l.fromSap?.unit} in SAP – Operations issues it from SAP instead of buying`}
                </Muted>
              </View>
            ) : (
              <>
                {!l.custom ? (
                  l.catalog ? (
                    <Row gap={8} style={{ alignItems: 'center', backgroundColor: colors.soft, borderRadius: 8, padding: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.ink, fontWeight: '600' }}>{l.catalog.name}</Text>
                        <Muted>{`${l.catalog.code} · ${l.catalog.category} · ${l.catalog.subcategory}`}</Muted>
                      </View>
                      <Button small variant="secondary" title="Change" onPress={() => setPicking(i)} />
                    </Row>
                  ) : (
                    <Button title="⌕  Choose from the catalogue" variant="secondary" onPress={() => setPicking(i)} />
                  )
                ) : null}
                <Toggle label="Not in the catalogue – enter a custom item" value={l.custom} onChange={(v) => setLine(i, { custom: v, catalog: v ? null : l.catalog })} />
                {l.custom ? (
                  <Grid min={260}>
                    <Field label="Item description" required value={l.item} onChangeText={(v) => setLine(i, { item: v })} placeholder="What it is, size / rating" />
                    <Select label="Category" value={l.category} onChange={(v) => setLine(i, { category: v })} options={CATEGORIES} />
                  </Grid>
                ) : null}
                {l.catalog || (l.custom && l.item.trim().length >= 3) ? (
                  <StockMatches
                    text={l.custom ? l.item : `${l.catalog?.name ?? ''}`}
                    chosen={{ returnId: l.fromReturn?.ref, sapMaterial: l.fromSap?.ref, orderNew: l.orderNew, reason: l.newReason }}
                    onUseReturn={(m) => m && setLine(i, { kind: 'returns', fromReturn: m, fromSap: null, orderNew: false, item: m.item ?? '', unit: m.unit ?? l.unit, catalog: null, custom: false, qty: (l.qty ?? 0) > m.available ? m.available : l.qty })}
                    onUseSap={(m) => m && setLine(i, { kind: 'sap', fromSap: m, fromReturn: null, orderNew: false, item: m.item ?? '', unit: m.unit ?? l.unit, catalog: null, custom: true })}
                    onOrderNew={(on) => setLine(i, { orderNew: on })}
                    onReason={(v) => setLine(i, { newReason: v })}
                    onFound={onFound[i]}
                  />
                ) : null}
              </>
            )}
            {l.kind === 'new' ? (
              <>
                <Field
                  label="Specification / further description"
                  multiline
                  value={l.spec}
                  onChangeText={(v) => setLine(i, { spec: v })}
                  placeholder="e.g. IP66, 4000K, 10 kV surge, RAL 7035 body, 5-year warranty, drum lengths 250 m …"
                />
                <Field label="Preferred make / brand (or approved equal)" value={l.brand} onChangeText={(v) => setLine(i, { brand: v })} />
              </>
            ) : null}
            <Grid min={150}>
              <NumberField label={l.fromReturn ? `Quantity (max ${l.fromReturn.available})` : 'Quantity'} required value={l.qty} onChange={(v) => setLine(i, { qty: v })} />
              {l.kind === 'new' ? (
                <Field label="Unit" required value={l.unit || l.catalog?.unit || ''} onChangeText={(v) => setLine(i, { unit: v })} placeholder="nos, m, set" />
              ) : (
                <View style={{ justifyContent: 'center' }}>
                  <Muted>Unit</Muted>
                  <Text style={{ color: colors.ink, fontWeight: '600', marginTop: 6 }}>{l.unit}</Text>
                </View>
              )}
            </Grid>
            <Field label="Note" value={l.note} onChangeText={(v) => setLine(i, { note: v })} />
            {l.kind === 'new' ? (
              <View style={{ gap: 4 }}>
                <Row gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <Muted>Datasheets, drawings, photos (PDF, images, Excel – up to 50 MB each)</Muted>
                  <Button
                    small
                    variant="secondary"
                    title="+ Attach"
                    onPress={async () => {
                      const f = await pickDocument();
                      if (f) setLine(i, { files: [...l.files, f] });
                    }}
                  />
                </Row>
                {l.files.map((f, k) => (
                  <Row key={`${f.name}${k}`} gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.ink, flexShrink: 1 }}>{`📄 ${f.name}`}</Text>
                    <Button small variant="ghost" title="Remove" onPress={() => setLine(i, { files: l.files.filter((_, x) => x !== k) })} />
                  </Row>
                ))}
              </View>
            ) : null}
          </Card>
        ))}
        {adding ? (
          <AddItemSteps
            onCancel={lines.length ? () => setAdding(false) : undefined}
            onTakeReturn={(m) => {
              setLines((s) => [...s, { ...blank(), kind: 'returns', fromReturn: m, item: m.item ?? '', unit: m.unit ?? '' }]);
              setAdding(false);
            }}
            onUseSap={(m) => {
              setLines((s) => [...s, { ...blank(), kind: 'sap', fromSap: m, custom: true, item: m.item ?? '', unit: m.unit ?? '' }]);
              setAdding(false);
            }}
            onNew={(searched) => {
              setLines((s) => [...s, { ...blank(), kind: 'new', custom: false, item: searched }]);
              setAdding(false);
            }}
          />
        ) : null}
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Request" onPress={save} />
      </Row>
      <CatalogPicker
        visible={picking != null}
        areas={areas}
        onClose={() => setPicking(null)}
        onPick={(c) => {
          if (picking != null) setLine(picking, { catalog: c, custom: false, unit: c.unit });
          setPicking(null);
        }}
      />
    </Screen>
  );
}
