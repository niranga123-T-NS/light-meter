import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { FixtureLibrary } from '@/components/tools/FixtureLibrary';
import { Button, Card, colors, ErrorBanner, Field, Grid, Loading, Muted, Row, Segmented, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { CATALOG_KEEPERS, efficacy, LUM_FAMILIES, openLink, type Brand, type BrandCatalog, type Luminaire } from '@/lib/catalog';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** Catalogs: brands (the manufacturer's online catalogue, downloads and stored PDF catalogues) and the luminaire library
 *  (specification, IES file and data sheet – the luminaires DLux uses) */
export function Catalogs() {
  const me = useMe();
  const keeper = CATALOG_KEEPERS.includes(me.role);
  const [sub, setSub] = useState<'brands' | 'luminaires' | 'library'>('brands');
  const [q, setQ] = useState('');
  const [family, setFamily] = useState('');
  const [brandF, setBrandF] = useState('');
  const { data, error } = useLoad(async () => {
    const [b, c, f, l] = await Promise.all([
      supabase.from('brands').select('id, name, manufacturer, country, origin, level, active').eq('active', true).order('name'),
      supabase.from('brand_catalogs').select('*'),
      supabase.from('catalog_files').select('brand_id').eq('active', true),
      supabase.from('luminaires').select('*').eq('active', true).order('sample').order('sort').order('name'),
    ]);
    if (b.error) throw new Error(b.error.message);
    return {
      brands: (b.data ?? []) as Brand[],
      links: (c.data ?? []) as BrandCatalog[],
      files: (f.data ?? []) as { brand_id: number | null }[],
      lums: (l.data ?? []) as Luminaire[],
    };
  }, []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const s = q.trim().toLowerCase();
  const brandName = (id: number | null) => data.brands.find((b) => b.id === id)?.name ?? null;

  return (
    <View style={{ gap: 10 }}>
      <Segmented
        value={sub}
        onChange={setSub}
        options={[
          { value: 'brands', label: `Brands (${data.brands.length})` },
          { value: 'luminaires', label: `Luminaires – IES & data sheets (${data.lums.length})` },
          { value: 'library', label: 'Fixture library & finder' },
        ]}
      />
      {sub === 'library' ? <FixtureLibrary /> : null}
      {sub === 'library' ? null : <Field label="Search" value={q} onChangeText={setQ} placeholder={sub === 'brands' ? 'Brand or manufacturer' : 'Luminaire, code or brand'} />}
      {sub === 'library' ? null : sub === 'brands' ? (
        <>
          <Muted>Choose a brand to open the manufacturer’s own online catalogue and downloads, or the catalogues added here – opened in a viewer and shared with clients with the DIMO watermark.</Muted>
          <Grid min={260} max={3}>
            {data.brands
              .filter((b) => !s || `${b.name} ${b.manufacturer ?? ''}`.toLowerCase().includes(s))
              .map((b) => {
                const link = data.links.find((x) => x.brand_id === b.id);
                const files = data.files.filter((x) => x.brand_id === b.id).length;
                const lums = data.lums.filter((x) => x.brand_id === b.id).length;
                return (
                  <Card key={b.id} style={{ gap: 6, padding: 12 }}>
                    <Text style={{ fontWeight: '700', fontSize: 15, color: colors.ink }} onPress={() => router.push(`/tools/brand/${b.id}`)}>
                      {b.name}
                    </Text>
                    <Muted>{[b.manufacturer, b.country].filter(Boolean).join(' · ') || ' '}</Muted>
                    <Muted>{`${files} catalogue${files === 1 ? '' : 's'} · ${lums} luminaire${lums === 1 ? '' : 's'}`}</Muted>
                    <Row gap={6} wrap>
                      {link?.catalogue_url ? <Button small variant="secondary" title="Online catalogue ↗" onPress={() => openLink(link.catalogue_url as string)} /> : null}
                      {link?.downloads_url ? <Button small variant="ghost" title="IES & data sheets ↗" onPress={() => openLink(link.downloads_url as string)} /> : null}
                      <Button small variant="ghost" title="Open" onPress={() => router.push(`/tools/brand/${b.id}`)} />
                    </Row>
                    {!link?.catalogue_url && !link?.website ? <Muted>{keeper ? 'No links yet – open to add the manufacturer’s links.' : 'Links not added yet.'}</Muted> : null}
                  </Card>
                );
              })}
          </Grid>
        </>
      ) : (
        <>
          <Row gap={8} wrap style={{ alignItems: 'flex-end' }}>
            <Select label="Type" value={family} onChange={setFamily} options={[{ value: '', label: 'All types' }, ...LUM_FAMILIES.map((x) => ({ value: x, label: x }))]} />
            <Select label="Brand" searchable value={brandF} onChange={setBrandF} options={[{ value: '', label: 'All brands' }, { value: 'sample', label: 'Generic samples' }, ...data.brands.map((b) => ({ value: String(b.id), label: b.name }))]} />
            {keeper ? <Button title="+ Luminaire" onPress={() => router.push('/tools/luminaire/new')} /> : null}
          </Row>
          <Muted>The luminaires DLux can use: each with its IES file (the light distribution) and data sheet. Tap one for the details, its data sheet and “Use in DLux”.</Muted>
          <DataTable
            rows={data.lums.filter(
              (l) =>
                (!family || l.family === family) &&
                (!brandF || (brandF === 'sample' ? l.sample : String(l.brand_id) === brandF)) &&
                (!s || `${l.name} ${l.code ?? ''} ${brandName(l.brand_id) ?? ''}`.toLowerCase().includes(s)),
            )}
            keyOf={(l) => l.id}
            onPress={(l) => router.push(`/tools/luminaire/${l.id}`)}
            emptyTitle="No luminaires yet"
            columns={[
              { h: 'Luminaire', w: 260, grow: true, v: (l) => `${l.name}\n${l.sample ? 'Generic sample' : brandName(l.brand_id) ?? ''}${l.code ? ` · ${l.code}` : ''}` },
              { h: 'Type', w: 120, v: (l) => l.family },
              { h: 'W', w: 60, right: true, v: (l) => (l.watts != null ? String(l.watts) : '—') },
              { h: 'lm', w: 80, right: true, v: (l) => (l.lumens != null ? String(Math.round(l.lumens)) : '—') },
              { h: 'lm/W', w: 60, right: true, v: (l) => String(efficacy(l) ?? '—') },
              { h: 'CCT', w: 70, right: true, v: (l) => (l.cct ? `${l.cct} K` : '—') },
              { h: 'IES', w: 50, v: (l) => (l.ies_id ? '✓' : '—') },
              { h: 'Data sheet', w: 90, v: (l) => (l.datasheet_url ? 'Link' : l.datasheet_path ? 'Stored' : l.sample ? 'DIMO' : '—') },
              { h: 'Stock', w: 100, v: (l) => (l.stock === 'in' ? 'In stock' : l.stock === 'out' ? 'Not in stock' : '—') },
            ]}
          />
        </>
      )}
    </View>
  );
}
