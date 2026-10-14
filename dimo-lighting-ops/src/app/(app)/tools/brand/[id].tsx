import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Loading, Muted, Notice, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { usePdfViewer } from '@/components/tools/PdfViewer';
import { CATALOG_KEEPERS, checkPdfLink, dropStoredCopy, FILE_KINDS, fileDoc, mb, openLink, shareWatermarked, type Brand, type BrandCatalog, type CatalogFile, type Luminaire, type PdfDoc } from '@/lib/catalog';
import { pickDocument, readBytes, uuid } from '@/lib/files';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** A brand: the manufacturer's links (online catalogue, downloads), the catalogues kept here and its luminaires */
export default function BrandCatalogPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const keeper = CATALOG_KEEPERS.includes(me.role);
  const { data, error, reload } = useLoad(async () => {
    const [b, c, f, l] = await Promise.all([
      supabase.from('brands').select('id, name, manufacturer, country, origin, level, active').eq('id', id).single(),
      supabase.from('brand_catalogs').select('*').eq('brand_id', id).maybeSingle(),
      supabase.from('catalog_files').select('*').eq('brand_id', id).eq('active', true).order('created_at', { ascending: false }),
      supabase.from('luminaires').select('*').eq('brand_id', id).eq('active', true).order('family').order('name'),
    ]);
    if (b.error) throw new Error(b.error.message);
    return { brand: b.data as Brand, link: (c.data ?? null) as BrandCatalog | null, files: (f.data ?? []) as CatalogFile[], lums: (l.data ?? []) as Luminaire[] };
  }, [id]);
  const { open, viewer } = usePdfViewer({ by: me.full_name, onEditLink: keeper ? (d: PdfDoc) => editFile(data?.files.find((f) => f.id === d.id)) : undefined });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { brand, link } = data;
  const by = me.full_name;

  const editLinks = async () => {
    const r = await dialog.prompt({
      title: `${brand.name} – manufacturer’s links`,
      message: 'Copy the links from the manufacturer’s website. Sales open them from the brand card.',
      fields: [
        { key: 'website', label: 'Website', initial: link?.website ?? '', hint: 'e.g. https://www.example-lighting.com' },
        { key: 'catalogue', label: 'Online catalogue / product finder', initial: link?.catalogue_url ?? '' },
        { key: 'downloads', label: 'Downloads page (IES files, data sheets)', initial: link?.downloads_url ?? '' },
        { key: 'notes', label: 'Notes', type: 'multiline', initial: link?.notes ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('brand_catalogs').upsert({
        brand_id: brand.id,
        website: r.website.trim() || null,
        catalogue_url: r.catalogue.trim() || null,
        downloads_url: r.downloads.trim() || null,
        notes: r.notes || null,
        updated_by: me.id,
        updated_at: new Date().toISOString(),
      });
      if (e) throw new Error(e.message);
      await reload();
    }, 'Saved');
  };
  const fileFields = (f?: Partial<CatalogFile>) => [
    { key: 'title', label: 'Title', required: true, initial: f?.title ?? '', hint: 'e.g. Indoor catalogue 2026' },
    { key: 'kind', label: 'Kind', type: 'select' as const, options: FILE_KINDS, initial: f?.kind ?? 'catalogue' },
    { key: 'year', label: 'Year (optional)', initial: f?.year ? String(f.year) : '' },
  ];
  const addLink = async () => {
    const r = await dialog.prompt({
      title: `Add a ${brand.name} PDF by link`,
      message: 'Paste the link of the PDF on the manufacturer’s website. Only the link is kept – the PDF is shown in a viewer when someone opens it, so it uses no storage space.',
      fields: [{ key: 'url', label: 'Link of the PDF', required: true, hint: 'https://…/catalogue.pdf' }, ...fileFields()],
      confirmLabel: 'Check and add',
    });
    if (!r) return;
    await dialog.run(async () => {
      const got = await checkPdfLink(r.url);
      const { error: e } = await supabase.from('catalog_files').insert({ brand_id: brand.id, title: r.title.trim(), kind: r.kind || 'catalogue', storage_path: null, file_name: got.file_name, size_bytes: got.size, source_url: r.url.trim(), year: r.year ? Number(r.year) : null });
      if (e) throw new Error(e.message);
      await reload();
    }, 'Link checked and added');
  };
  async function editFile(f?: CatalogFile) {
    if (!f) return;
    const r = await dialog.prompt({
      title: `Edit – ${f.title}`,
      message: f.storage_path && !f.source_url ? 'Uploaded file. Add the manufacturer’s link to keep it by link instead.' : 'Paste the new link if the manufacturer moved the PDF.',
      fields: [{ key: 'url', label: 'Link of the PDF', required: !f.storage_path, initial: f.source_url ?? '' }, ...fileFields(f)],
      confirmLabel: 'Save',
    });
    if (!r) return;
    await dialog.run(async () => {
      const url = r.url.trim() || null;
      const got = url && url !== f.source_url ? await checkPdfLink(url) : null;
      const { error: e } = await supabase
        .from('catalog_files')
        .update({ title: r.title.trim(), kind: r.kind || 'catalogue', year: r.year ? Number(r.year) : null, source_url: url, ...(got ? { file_name: got.file_name, size_bytes: f.storage_path ? f.size_bytes : got.size } : {}) })
        .eq('id', f.id);
      if (e) throw new Error(e.message);
      await reload();
    }, 'Saved');
  }
  const dropCopy = async (f: CatalogFile) => {
    if (!(await dialog.confirm(`Remove the stored copy of “${f.title}”?`, `Frees ${mb(f.size_bytes) || 'its'} storage space. The manufacturer’s link is kept and the PDF opens from there.`, { confirmLabel: 'Remove stored copy' }))) return;
    await dialog.run(async () => {
      await dropStoredCopy(f.storage_path as string, { table: 'catalog_files', id: f.id });
      await reload();
    }, 'Stored copy removed – the link is kept');
  };
  const uploadPdf = async () => {
    const file = await pickDocument();
    if (!file) return;
    const r = await dialog.prompt({ title: 'Upload a catalogue', message: 'The PDF is stored here and uses storage space – for a catalogue on the manufacturer’s website, add its link instead.', fields: fileFields({ title: file.name.replace(/\.pdf$/i, '') }), confirmLabel: 'Upload' });
    if (!r) return;
    await dialog.run(async () => {
      if (!/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF');
      const bytes = await readBytes(file);
      if (bytes.byteLength > 52428800) throw new Error('Files can be up to 50 MB – for a larger catalogue add the manufacturer’s online link instead');
      const path = `brands/${brand.id}/${uuid()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120)}`;
      const up = await supabase.storage.from('catalog').upload(path, bytes, { contentType: 'application/pdf' });
      if (up.error) throw new Error(up.error.message);
      const { error: e } = await supabase.from('catalog_files').insert({ brand_id: brand.id, title: r.title.trim(), kind: r.kind || 'catalogue', storage_path: path, file_name: file.name, size_bytes: bytes.byteLength, year: r.year ? Number(r.year) : null });
      if (e) throw new Error(e.message);
      await reload();
    }, 'Uploaded');
  };
  const remove = async (f: CatalogFile) => {
    if (!(await dialog.confirm(`Remove “${f.title}”?`, 'It is taken off the list for everyone.', { danger: true, confirmLabel: 'Remove' }))) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('catalog_files').update({ active: false }).eq('id', f.id);
      if (e) throw new Error(e.message);
      await reload();
    }, 'Removed');
  };

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: brand.name }} />
      {viewer}
      <Section title="The manufacturer’s catalogue">
        <Card style={{ gap: 6 }}>
          <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>{brand.name}</Text>
          <Muted>{[brand.manufacturer, brand.country].filter(Boolean).join(' · ') || ' '}</Muted>
          {link?.catalogue_url || link?.downloads_url || link?.website ? (
            <Row gap={8} wrap>
              {link?.catalogue_url ? <Button title="Online catalogue ↗" onPress={() => openLink(link.catalogue_url as string)} /> : null}
              {link?.downloads_url ? <Button variant="secondary" title="IES files & data sheets ↗" onPress={() => openLink(link.downloads_url as string)} /> : null}
              {link?.website ? <Button variant="ghost" title="Website ↗" onPress={() => openLink(link.website as string)} /> : null}
            </Row>
          ) : (
            <Notice tone={colors.amber}>{keeper ? 'Add the manufacturer’s links so sales open the latest catalogue straight from here.' : 'The Design team has not added this brand’s links yet.'}</Notice>
          )}
          {link?.notes ? <Muted>{link.notes}</Muted> : null}
          {keeper ? <Button small variant="ghost" title="Edit links" onPress={editLinks} /> : null}
        </Card>
      </Section>

      <Section title="Catalogues">
        {keeper ? (
          <Row gap={8} wrap>
            <Button small title="+ Add PDF by link" onPress={addLink} />
            <Button small variant="ghost" title="Upload PDF (stored)" onPress={uploadPdf} />
          </Row>
        ) : null}
        {data.files.length ? (
          data.files.map((f) => (
            <Card key={f.id} style={{ gap: 4 }}>
              <Text style={{ fontWeight: '600', color: colors.ink }}>{f.title}</Text>
              <Muted>
                {[FILE_KINDS.find((k) => k.value === f.kind)?.label ?? f.kind, f.year, f.storage_path ? `stored copy ${mb(f.size_bytes)}`.trim() : `manufacturer’s link${f.size_bytes ? ` · ${mb(f.size_bytes)}` : ''} · not stored`, `added ${fmtDate(f.created_at)}`].filter(Boolean).join(' · ')}
              </Muted>
              <Row gap={6} wrap>
                <Button small variant="secondary" title="Open" onPress={() => dialog.run(() => open(fileDoc(f)))} />
                <Button small variant="secondary" title="Share with DIMO watermark" onPress={() => dialog.run(() => shareWatermarked(fileDoc(f).source, f.title, by))} />
                {keeper ? <Button small variant="ghost" title={f.source_url ? 'Edit link' : 'Edit'} onPress={() => editFile(f)} /> : null}
                {keeper && f.storage_path && f.source_url ? <Button small variant="ghost" title="Remove stored copy, keep the link" onPress={() => dropCopy(f)} /> : null}
                {keeper ? <Button small variant="ghost" title="Remove" onPress={() => remove(f)} /> : null}
              </Row>
            </Card>
          ))
        ) : (
          <Muted>No catalogues added yet.</Muted>
        )}
      </Section>

      <Section title="Luminaires">
        {keeper ? <Button small variant="secondary" title="+ Luminaire" onPress={() => router.push(`/tools/luminaire/new?brand=${brand.id}`)} /> : null}
        <DataTable
          rows={data.lums}
          keyOf={(l) => l.id}
          onPress={(l) => router.push(`/tools/luminaire/${l.id}`)}
          emptyTitle="No luminaires of this brand yet"
          columns={[
            { h: 'Luminaire', w: 260, grow: true, v: (l) => `${l.name}${l.code ? `\n${l.code}` : ''}` },
            { h: 'Type', w: 120, v: (l) => l.family },
            { h: 'W · lm', w: 120, right: true, v: (l) => `${l.watts ?? '—'} W · ${l.lumens != null ? Math.round(l.lumens) : '—'} lm` },
            { h: 'IES', w: 50, v: (l) => (l.ies_id ? '✓' : '—') },
            { h: 'Stock', w: 100, v: (l) => (l.stock === 'in' ? 'In stock' : l.stock === 'out' ? 'Not in stock' : '—') },
          ]}
        />
      </Section>
    </Screen>
  );
}
