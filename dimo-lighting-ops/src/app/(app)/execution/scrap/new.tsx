import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Field, Loading, Muted, Notice, NumberField, Row, Screen, Section, Segmented, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { fmtDate, fmtNumber } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import type { ReturnItem } from '@/lib/returns';
import { SCRAP_CONDITIONS, SCRAP_SOURCE, type ScrapDisposal, type ScrapLine, type ScrapStoreItem } from '@/lib/scrap';
import { rpc, supabase } from '@/lib/supabase';

const NO_PROJECT = '__none';

/** Raise or change a scrap disposal: where it is, why it is scrap, the items (site store, Project returns or found on site), and FOC or sell. */
export default function NewScrap() {
  const me = useMe();
  const dialog = useDialog();
  const params = useLocalSearchParams<{ project?: string; id?: string }>();
  const see = me.role === 'senior_elec_engineer';
  const [form, setForm] = useState<{
    project: string | null;
    location: string;
    reason: string;
    method: 'foc' | 'sell';
    focTo: string;
    focReason: string;
    lines: ScrapLine[];
  } | null>(null);

  const { data, error } = useLoad(async () => {
    const p = await supabase.from('exec_projects').select('id, code, name, status').eq('status', 'active').order('code');
    let existing: { d: ScrapDisposal; lines: ScrapLine[] } | null = null;
    if (params.id) {
      const [d, l] = await Promise.all([
        supabase.from('scrap_disposals').select('*').eq('id', params.id).single(),
        supabase.from('scrap_lines').select('*').eq('disposal_id', params.id).order('seq'),
      ]);
      if (d.error) throw new Error(d.error.message);
      existing = { d: d.data as ScrapDisposal, lines: (l.data ?? []) as ScrapLine[] };
    }
    const returns = see ? await rpc<ReturnItem[]>('project_returns').catch(() => []) : [];
    return { projects: (p.data ?? []) as Pick<ExecProject, 'id' | 'code' | 'name'>[], existing, returns };
  }, [params.id]);

  const f =
    form ??
    (data?.existing
      ? {
          project: data.existing.d.exec_project_id ?? NO_PROJECT,
          location: data.existing.d.location,
          reason: data.existing.d.scrap_reason,
          method: data.existing.d.method,
          focTo: data.existing.d.foc_to ?? '',
          focReason: data.existing.d.foc_reason ?? '',
          lines: data.existing.lines.map((l) => ({ ...l, qty: Number(l.qty) })),
        }
      : { project: params.project ?? (see ? null : (data?.projects[0]?.id ?? null)), location: '', reason: '', method: 'foc' as const, focTo: '', focReason: '', lines: [] });
  const set = (patch: Partial<typeof f>) => setForm({ ...f, ...patch });
  const project = f.project && f.project !== NO_PROJECT ? f.project : null;

  const store = useLoad(async () => (project ? await rpc<ScrapStoreItem[]>('scrap_store_items', { p_exec: project }).catch(() => []) : []), [project]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const storeItems = store.data ?? [];
  const usedStore = (item: string) => f.lines.filter((l) => l.source === 'store' && l.item === item).length > 0;

  const setLine = (i: number, patch: Partial<ScrapLine>) => set({ lines: f.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const addLine = (l: ScrapLine) => set({ lines: [...f.lines, l] });

  const save = () =>
    dialog.run(async () => {
      const payload = {
        exec_project_id: project,
        location: f.location,
        scrap_reason: f.reason,
        method: f.method,
        foc_to: f.focTo,
        foc_reason: f.focReason,
        lines: f.lines.map((l) => ({ source: l.source, return_item_id: l.return_item_id ?? null, item: l.item, unit: l.unit, qty: l.qty, condition: l.condition, note: l.note ?? null })),
      };
      if (!see && !project) throw new Error('Choose the project');
      const id = await rpc<string>('save_scrap_disposal', { p_id: params.id ?? null, p: payload });
      router.replace(`/execution/scrap/${id}`);
    }, params.id ? 'Saved' : 'Saved as a draft – add the photos and submit');

  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: params.id ? 'Change scrap disposal' : 'New scrap disposal' }} />
      {data.existing?.d.return_note ? <Notice tone={colors.red}>{`Returned: ${data.existing.d.return_note}`}</Notice> : null}
      <Section title="Where and why">
        <Card style={{ gap: 4 }}>
          {params.id ? (
            <Muted>{project ? `Project: ${data.projects.find((p) => p.id === project)?.code ?? ''} ${data.projects.find((p) => p.id === project)?.name ?? ''}` : 'No project – central store'}</Muted>
          ) : (
            <Select
              label="Project"
              required
              searchable
              value={f.project}
              onChange={(v) => set({ project: v, lines: f.lines.filter((l) => l.source !== 'store') })}
              options={[
                ...(see ? [{ value: NO_PROJECT, label: 'No project – central store / Project returns' }] : []),
                ...data.projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` })),
              ]}
            />
          )}
          <Field label="Where is the scrap kept?" required value={f.location} onChangeText={(v) => set({ location: v })} placeholder="e.g. Site store yard, Ratmalana bay 2" />
          <Field label="Why is it scrap?" required multiline value={f.reason} onChangeText={(v) => set({ reason: v })} placeholder="e.g. Cable offcuts after termination; old metal halide fittings removed from the stand" />
        </Card>
      </Section>

      <Section title={`Scrap items (${f.lines.length})`}>
        {f.lines.map((l, i) => (
          <Card key={i} style={{ gap: 4 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', color: colors.ink, flex: 1 }}>{`${i + 1}. ${SCRAP_SOURCE[l.source]}`}</Text>
              <Button small variant="ghost" title="Remove" onPress={() => set({ lines: f.lines.filter((_, k) => k !== i) })} />
            </Row>
            {l.source === 'other' ? (
              <Row gap={8} wrap>
                <View style={{ flex: 3, minWidth: 220 }}>
                  <Field label="Item" required value={l.item} onChangeText={(v) => setLine(i, { item: v })} placeholder="e.g. Metal halide floodlight 1000W (old)" />
                </View>
                <View style={{ flex: 1, minWidth: 100 }}>
                  <Field label="Unit" required value={l.unit} onChangeText={(v) => setLine(i, { unit: v })} placeholder="nos, m, kg" />
                </View>
              </Row>
            ) : (
              <Muted>{`${l.item} · ${l.unit}`}</Muted>
            )}
            <Row gap={8} wrap>
              <View style={{ flex: 1, minWidth: 140 }}>
                <NumberField label="Quantity" required value={l.qty} onChange={(v) => setLine(i, { qty: v })} />
              </View>
              <View style={{ flex: 2, minWidth: 200 }}>
                <Select label="Condition" required value={l.condition} onChange={(v) => setLine(i, { condition: v })} options={SCRAP_CONDITIONS} />
              </View>
            </Row>
            {l.source === 'store' ? <Muted>{`Free in the site store: ${fmtNumber(storeItems.find((s) => s.item === l.item)?.free ?? 0, 2)} ${l.unit}`}</Muted> : null}
            <Field label="Note" value={l.note ?? ''} onChangeText={(v) => setLine(i, { note: v })} placeholder="Weight, size, why this item is scrap …" />
          </Card>
        ))}
        <Card style={{ gap: 6 }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>Add an item</Text>
          {project ? (
            storeItems.filter((s) => s.free > 0 && !usedStore(s.item)).length ? (
              <Select
                label="From the site store (DIMO's custody) – booked out when disposed"
                value={null}
                searchable
                onChange={(v) => {
                  const s = storeItems.find((x) => x.item === v);
                  if (s) addLine({ source: 'store', item: s.item, unit: s.unit, qty: null, condition: 'offcut' });
                }}
                options={storeItems
                  .filter((s) => s.free > 0 && !usedStore(s.item))
                  .map((s) => ({ value: s.item, label: s.item, hint: `${fmtNumber(s.free, 2)} ${s.unit} free · last moved ${fmtDate(s.last_at)}` }))}
              />
            ) : (
              <Muted>Nothing in this project&apos;s site store under DIMO&apos;s custody.</Muted>
            )
          ) : null}
          {see && data.returns.some((r) => r.available > 0) ? (
            <Select
              label="From the Project returns – booked out when disposed"
              value={null}
              searchable
              onChange={(v) => {
                const r = data.returns.find((x) => x.id === v);
                if (r) addLine({ source: 'returns', return_item_id: r.id, item: r.item, unit: r.unit, qty: null, condition: r.condition === 'damaged' ? 'damaged' : 'obsolete' });
              }}
              options={data.returns
                .filter((r) => r.available > 0 && !f.lines.some((l) => l.return_item_id === r.id))
                .map((r) => ({ value: r.id, label: `${r.code ?? ''} ${r.item}`, hint: `${fmtNumber(r.available, 2)} ${r.unit} free · ${r.condition} · ${r.location ?? ''}` }))}
            />
          ) : null}
          <Row>
            <Button small variant="secondary" title="+ Other item (removed from site, found on site …)" onPress={() => addLine({ source: 'other', item: '', unit: 'nos', qty: null, condition: 'removed' })} />
          </Row>
        </Card>
      </Section>

      <Section title="How to dispose">
        <Card style={{ gap: 6 }}>
          <Segmented
            value={f.method}
            onChange={(v) => set({ method: v })}
            options={[
              { value: 'foc', label: 'Free of charge (no cost)' },
              { value: 'sell', label: 'Sell' },
            ]}
          />
          {f.method === 'foc' ? (
            <>
              <Field label="Who takes it?" required value={f.focTo} onChangeText={(v) => set({ focTo: v })} placeholder="e.g. Municipal council waste yard, the client, a recycler" />
              <Field
                label="Reason it is given free of charge"
                required
                multiline
                value={f.focReason}
                onChangeText={(v) => set({ focReason: v })}
                placeholder="e.g. No buyer for broken polycarbonate; client asked to keep the old fittings"
              />
            </>
          ) : (
            <Muted>After saving, add the buyers&apos; quotations (amount and the quotation document) and choose the one to accept when you submit.</Muted>
          )}
        </Card>
      </Section>
      <Muted>Next: save, add photos of the scrap{f.method === 'sell' ? ' and the quotations' : ''}, then submit to SM Projects. The DGM approves after SM Projects.</Muted>
      <Row gap={8}>
        <Button title={params.id ? 'Save changes' : 'Save as draft'} onPress={save} disabled={!f.lines.length} />
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
      </Row>
    </Screen>
  );
}
