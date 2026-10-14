import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useDialog } from '@/components/dialog';
import { IesPicker, type IesRow } from '@/components/tools/IesPicker';
import { Button, Card, colors, ErrorBanner, Field, Grid, Loading, Muted, Notice, NumberField, Row, Screen, Section, Segmented, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { usePdfViewer } from '@/components/tools/PdfViewer';
import { CATALOG_KEEPERS, checkPdfLink, dropStoredCopy, efficacy, LUM_FAMILIES, luminaireSheetHtml, sheetDoc, shareWatermarked, type Brand, type Luminaire } from '@/lib/catalog';
import { printHtml } from '@/lib/export';
import { pickDocument, readBytes, uuid } from '@/lib/files';
import { useLoad } from '@/lib/hooks';
import { FITTING_TYPES } from '@/lib/lightcalc';
import { beamAngle, iesPhotometry, parseIes, polarSvg } from '@/lib/photometry';
import { callFunction, supabase } from '@/lib/supabase';

type Form = Omit<Luminaire, 'id' | 'active' | 'sample' | 'datasheet_path' | 'datasheet_name'>;
const BLANK: Form = { brand_id: null, name: '', code: null, family: 'Panel', fitting_type: 'panel', watts: null, lumens: null, cct: 4000, cri: 80, ip: null, ik: null, ugr: null, beam: null, lit_l: null, lit_w: null, ies_id: null, datasheet_url: null, stock: null, notes: null };

/** A luminaire: its specification, light distribution (IES) and data sheets – used in DLux and road lighting */
export default function LuminairePage() {
  const { id, brand } = useLocalSearchParams<{ id: string; brand?: string }>();
  const me = useMe();
  const dialog = useDialog();
  const keeper = CATALOG_KEEPERS.includes(me.role);
  const isNew = id === 'new';
  const [editing, setEditing] = useState(isNew);
  const [form, setForm] = useState<Form | null>(null);
  const { data, error, reload } = useLoad(async () => {
    const [b, l] = await Promise.all([
      supabase.from('brands').select('id, name, manufacturer, country, origin, level, active').eq('active', true).order('name'),
      isNew ? Promise.resolve({ data: null, error: null }) : supabase.from('luminaires').select('*').eq('id', id).single(),
    ]);
    if (l.error) throw new Error(l.error.message);
    const lum = (l.data ?? null) as Luminaire | null;
    let ies = null;
    if (lum?.ies_id) {
      const { data: row } = await supabase.from('ies_files').select('id, name, file_name, content').eq('id', lum.ies_id).single();
      if (row) {
        const d = parseIes(row.content as string);
        const ph = iesPhotometry(d);
        ies = { id: row.id as string, name: row.name as string, file: row.file_name as string, content: row.content as string, d, ph, polar: polarSvg(ph, 220) };
      }
    }
    return { brands: (b.data ?? []) as Brand[], lum, ies };
  }, [id]);
  const { open, viewer } = usePdfViewer({ by: me.full_name, onEditLink: keeper ? () => sheetLink() : undefined });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const lum = data.lum;
  if (!isNew && !lum) return <Screen><Notice>Luminaire not found.</Notice></Screen>;
  const brandName = (bid: number | null) => data.brands.find((b) => b.id === bid)?.name ?? null;
  const f: Form = form ?? (lum ? { ...BLANK, ...lum } : { ...BLANK, brand_id: brand ? Number(brand) : null });
  const set = (p: Partial<Form>) => setForm({ ...f, ...p });

  const save = () =>
    dialog.run(async () => {
      if (!f.name.trim()) throw new Error('Give the luminaire a name');
      const row = { ...f, name: f.name.trim(), updated_by: me.id, updated_at: new Date().toISOString() };
      if (isNew) {
        const { data: n, error: e } = await supabase.from('luminaires').insert(row).select('id').single();
        if (e) throw new Error(e.message);
        router.replace(`/tools/luminaire/${n.id}`);
      } else {
        const { error: e } = await supabase.from('luminaires').update(row).eq('id', id);
        if (e) throw new Error(e.message);
        setEditing(false);
        setForm(null);
        await reload();
      }
    }, 'Saved');
  const fetchIes = async () => {
    const r = await dialog.prompt({ title: 'Fetch the IES file', message: 'Paste the link of the .ies file on the manufacturer’s website.', fields: [{ key: 'url', label: 'Link of the IES file', required: true }], confirmLabel: 'Fetch' });
    if (!r) return;
    await dialog.run(async () => {
      const got = await callFunction<{ text: string; file_name: string }>('catalog-fetch', { action: 'ies', url: r.url.trim() });
      const d = parseIes(got.text);
      const ph = iesPhotometry(d);
      const { data: row, error: e } = await supabase
        .from('ies_files')
        .insert({ scope: 'library', name: (d.keywords.LUMINAIRE || f.name || got.file_name).slice(0, 200), manufacturer: d.keywords.MANUFAC || brandName(f.brand_id), product_code: d.keywords.LUMCAT || f.code, file_name: got.file_name, lumens: d.lumens, watts: d.watts || null, len_mm: d.lenMm || null, wid_mm: d.widMm || null, beam: beamAngle(ph), up_share: Math.round(ph.up * 1000) / 1000, content: got.text })
        .select('id')
        .single();
      if (e) throw new Error(e.message);
      set({ ies_id: row.id, lumens: f.lumens ?? d.lumens, watts: f.watts ?? (d.watts || null), lit_l: f.lit_l ?? (Math.round(d.lenMm) || null), lit_w: f.lit_w ?? (Math.round(d.widMm) || null), beam: f.beam ?? beamAngle(ph) });
    }, 'IES file fetched – save to keep it');
  };
  const uploadSheet = async () => {
    if (isNew) return dialog.toast('Save the luminaire first', 'error');
    const file = await pickDocument();
    if (!file) return;
    await dialog.run(async () => {
      if (!/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF');
      const bytes = await readBytes(file);
      if (bytes.byteLength > 52428800) throw new Error('Files can be up to 50 MB');
      const path = `datasheets/${id}/${uuid()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120)}`;
      const up = await supabase.storage.from('catalog').upload(path, bytes, { contentType: 'application/pdf' });
      if (up.error) throw new Error(up.error.message);
      const { error: e } = await supabase.from('luminaires').update({ datasheet_path: path, datasheet_name: file.name, updated_by: me.id, updated_at: new Date().toISOString() }).eq('id', id);
      if (e) throw new Error(e.message);
      await reload();
    }, 'Data sheet uploaded');
  };
  async function sheetLink() {
    if (isNew) return dialog.toast('Save the luminaire first', 'error');
    const r = await dialog.prompt({
      title: 'Data sheet by link',
      message: 'Paste the link of the PDF data sheet on the manufacturer’s website. Only the link is kept – the PDF is shown in a viewer when someone opens it, so it uses no storage space.',
      fields: [{ key: 'url', label: 'Link of the PDF', required: true, initial: data?.lum?.datasheet_url ?? '' }],
      confirmLabel: 'Check and save',
    });
    if (!r) return;
    await dialog.run(async () => {
      const got = await checkPdfLink(r.url);
      const { error: e } = await supabase.from('luminaires').update({ datasheet_url: r.url.trim(), ...(data?.lum?.datasheet_path ? {} : { datasheet_name: got.file_name }), updated_by: me.id, updated_at: new Date().toISOString() }).eq('id', id);
      if (e) throw new Error(e.message);
      await reload();
    }, 'Link checked and saved');
  }
  const dropSheetCopy = async () => {
    if (!lum?.datasheet_path || !(await dialog.confirm('Remove the stored copy of the data sheet?', 'Frees its storage space. The manufacturer’s link is kept and the data sheet opens from there.', { confirmLabel: 'Remove stored copy' }))) return;
    await dialog.run(async () => {
      await dropStoredCopy(lum.datasheet_path as string, { table: 'luminaires', id: lum.id });
      await reload();
    }, 'Stored copy removed – the link is kept');
  };
  const downloadIes = () =>
    dialog.run(async () => {
      if (!data.ies) return;
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([data.ies.content], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = data.ies.file || 'luminaire.ies';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const { File: FsFile, Paths } = await import('expo-file-system');
        const Sharing = await import('expo-sharing');
        const file = new FsFile(Paths.cache, data.ies.file || 'luminaire.ies');
        file.create({ overwrite: true });
        file.write(data.ies.content);
        await Sharing.shareAsync(file.uri, { dialogTitle: data.ies.name });
      }
    });
  const dimoSheet = () =>
    dialog.run(async () => {
      if (!lum) return;
      await printHtml(luminaireSheetHtml(lum, brandName(lum.brand_id), data.ies?.ph ?? null, data.ies ? polarSvg(data.ies.ph, 240) : null, `${me.full_name}`), { key: 'luminaire_sheet', filters: lum.name, title: `${lum.name} – data sheet` });
    });
  const deactivate = async () => {
    if (!(await dialog.confirm('Take this luminaire off the list?', 'Calculations already made keep it.', { danger: true, confirmLabel: 'Take off' }))) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('luminaires').update({ active: false }).eq('id', id);
      if (e) throw new Error(e.message);
      router.back();
    }, 'Taken off the list');
  };

  if (editing && keeper) {
    return (
      <Screen maxWidth={900}>
        <Stack.Screen options={{ title: isNew ? 'New luminaire' : `Edit – ${lum?.name}` }} />
        <Card style={{ gap: 4 }}>
          <Field label="Name" required value={f.name} onChangeText={(v) => set({ name: v })} placeholder="e.g. Panel 600 × 600 36 W 4000 K" />
          <Row gap={8} wrap>
            <Select label="Brand" searchable value={f.brand_id != null ? String(f.brand_id) : ''} onChange={(v) => set({ brand_id: v ? Number(v) : null })} options={[{ value: '', label: '— none —' }, ...data.brands.map((b) => ({ value: String(b.id), label: b.name }))]} />
            <Field label="Product code" value={f.code ?? ''} onChangeText={(v) => set({ code: v || null })} />
          </Row>
          <Row gap={8} wrap>
            <Select label="Type" value={f.family} onChange={(v) => set({ family: v })} options={LUM_FAMILIES.map((x) => ({ value: x, label: x }))} />
            <Select label="DLux fitting type (when no IES)" value={f.fitting_type} onChange={(v) => set({ fitting_type: v })} options={FITTING_TYPES.map((t) => ({ value: t.key, label: t.label }))} />
          </Row>
          <Row gap={8} wrap>
            <NumberField label="Watts" suffix="W" value={f.watts} onChange={(v) => set({ watts: v })} />
            <NumberField label="Lumens" suffix="lm" value={f.lumens} onChange={(v) => set({ lumens: v })} />
            <NumberField label="Colour temperature" suffix="K" value={f.cct} onChange={(v) => set({ cct: v })} />
            <NumberField label="CRI (Ra)" value={f.cri} onChange={(v) => set({ cri: v })} />
            <NumberField label="Beam" suffix="°" value={f.beam} onChange={(v) => set({ beam: v })} />
            <NumberField label="UGR (data sheet)" value={f.ugr} onChange={(v) => set({ ugr: v })} />
          </Row>
          <Row gap={8} wrap>
            <Field label="IP" value={f.ip ?? ''} onChangeText={(v) => set({ ip: v || null })} placeholder="IP65" />
            <Field label="IK" value={f.ik ?? ''} onChangeText={(v) => set({ ik: v || null })} placeholder="IK08" />
            <NumberField label="Lit area length" suffix="mm" value={f.lit_l} onChange={(v) => set({ lit_l: v })} />
            <NumberField label="Lit area width" suffix="mm" value={f.lit_w} onChange={(v) => set({ lit_w: v })} />
          </Row>
          <Segmented value={f.stock ?? ''} onChange={(v) => set({ stock: (v || null) as Form['stock'] })} options={[{ value: '', label: 'Stock not stated' }, { value: 'in', label: 'In stock' }, { value: 'out', label: 'Not in stock' }]} />
          <Text style={{ fontWeight: '600', color: colors.ink, marginTop: 6 }}>IES file (light distribution)</Text>
          <IesPicker value={f.ies_id} canLibrary onChange={(row: IesRow | null) => set(row ? { ies_id: row.id, lumens: f.lumens ?? row.lumens, watts: f.watts ?? row.watts, beam: f.beam ?? row.beam } : { ies_id: null })} />
          <Button small variant="secondary" title="Fetch IES from the manufacturer’s link" onPress={fetchIes} />
          <Field label="Data sheet link on the manufacturer’s site (optional)" value={f.datasheet_url ?? ''} onChangeText={(v) => set({ datasheet_url: v || null })} placeholder="https://…" />
          <Field label="Notes" multiline value={f.notes ?? ''} onChangeText={(v) => set({ notes: v || null })} />
          <Row gap={8} wrap>
            <Button title={isNew ? 'Save luminaire' : 'Save changes'} onPress={save} />
            {!isNew ? <Button variant="ghost" title="Cancel" onPress={() => { setForm(null); setEditing(false); }} /> : null}
          </Row>
        </Card>
      </Screen>
    );
  }
  if (!lum) return null;
  const eff = efficacy(lum);
  const sheet = sheetDoc(lum);
  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: lum.name }} />
      {viewer}
      {lum.sample ? <Notice tone={colors.blue}>Generic sample for lighting calculations – not a manufacturer’s product. For offers, use the manufacturer’s IES file and data sheet.</Notice> : null}
      <Card style={{ gap: 6 }}>
        <Text style={{ fontWeight: '700', fontSize: 17, color: colors.ink }}>{lum.name}</Text>
        <Muted>{[lum.sample ? 'Generic sample' : brandName(lum.brand_id), lum.code, lum.family].filter(Boolean).join(' · ')}</Muted>
        <Row gap={8} wrap>
          <Button title="Use in DLux" onPress={() => router.push(`/tools/calc/new?lum=${lum.id}`)} />
          {lum.family === 'Street light' || lum.family === 'Floodlight' ? <Button variant="secondary" title="Use in road lighting" onPress={() => router.push(`/tools/road/new?lum=${lum.id}`)} /> : null}
          {keeper ? <Button variant="ghost" title="Edit" onPress={() => setEditing(true)} /> : null}
        </Row>
      </Card>
      <Grid min={150} max={4}>
        <Stat label="Power" value={lum.watts != null ? `${lum.watts} W` : '—'} />
        <Stat label="Luminous flux" value={lum.lumens != null ? `${Math.round(lum.lumens)} lm` : '—'} sub={eff ? `${eff} lm/W` : undefined} />
        <Stat label="Colour" value={lum.cct ? `${lum.cct} K` : '—'} sub={lum.cri ? `Ra ${lum.cri}` : undefined} />
        <Stat label="Beam" value={lum.beam ? `${lum.beam}°` : data.ies ? `${beamAngle(data.ies.ph)}°` : '—'} sub={[lum.ip, lum.ik, lum.ugr ? `UGR ${lum.ugr}` : null].filter(Boolean).join(' · ') || undefined} />
        <Stat label="Stock" value={lum.stock === 'in' ? 'In stock' : lum.stock === 'out' ? 'Not in stock' : '—'} tone={lum.stock === 'in' ? 'green' : lum.stock === 'out' ? 'amber' : undefined} />
      </Grid>
      <Section title="Light distribution (IES)">
        {data.ies ? (
          <Card>
            <Row gap={14} wrap style={{ alignItems: 'center' }}>
              <SvgXml xml={data.ies.polar} width={220} height={220} />
              <View style={{ flex: 1, minWidth: 220, gap: 4 }}>
                <Text style={{ fontWeight: '600', color: colors.ink }}>{data.ies.name}</Text>
                <Muted>{`${data.ies.d.lumens} lm in the file · ${Math.round(data.ies.ph.up * 100)}% up · lit area ${Math.round(data.ies.d.lenMm)} × ${Math.round(data.ies.d.widMm)} mm`}</Muted>
                <Muted>Red: along the luminaire (C0–C180) · blue: across (C90–C270).</Muted>
                <Button small variant="secondary" title="Download IES file" onPress={downloadIes} />
              </View>
            </Row>
          </Card>
        ) : (
          <Notice tone={colors.amber}>{keeper ? 'No IES file yet – Edit to attach one or fetch it from the manufacturer’s link.' : 'No IES file yet – DLux uses a curve modelled on the type.'}</Notice>
        )}
      </Section>
      <Section title="Data sheets">
        <Card style={{ gap: 8 }}>
          {sheet ? (
            <Row gap={8} wrap style={{ alignItems: 'center' }}>
              <Text style={{ color: colors.ink, flexShrink: 1 }}>{`Manufacturer’s data sheet · ${lum.datasheet_path ? 'stored copy' : 'manufacturer’s link, not stored'}`}</Text>
              <Button small variant="secondary" title="Open" onPress={() => dialog.run(() => open(sheet))} />
              <Button small variant="secondary" title="Share with DIMO watermark" onPress={() => dialog.run(() => shareWatermarked(sheet.source, sheet.title, me.full_name))} />
            </Row>
          ) : (
            <Muted>No manufacturer’s data sheet yet.</Muted>
          )}
          <Row gap={8} wrap style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.ink, flexShrink: 1 }}>DIMO data sheet – the specification and light distribution with the DIMO logo</Text>
            <Button small variant="secondary" title="Share DIMO data sheet" onPress={dimoSheet} />
          </Row>
          {keeper ? (
            <Row gap={8} wrap>
              <Button small variant="secondary" title={lum.datasheet_url ? 'Update data sheet link' : '+ Data sheet by link'} onPress={sheetLink} />
              <Button small variant="ghost" title="Upload data sheet PDF (stored)" onPress={uploadSheet} />
              {lum.datasheet_path && lum.datasheet_url ? <Button small variant="ghost" title="Remove stored copy, keep the link" onPress={dropSheetCopy} /> : null}
            </Row>
          ) : null}
        </Card>
      </Section>
      {lum.notes ? <Muted>{lum.notes}</Muted> : null}
      {keeper ? <Button small variant="ghost" title="Take off the list" onPress={deactivate} /> : null}
    </Screen>
  );
}
