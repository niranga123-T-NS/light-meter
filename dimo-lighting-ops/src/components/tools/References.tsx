import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Chip, colors, Empty, ErrorBanner, Field, Grid, Loading, Muted, Pill, Row, Select } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { applicationLabel, APPLICATIONS, photoUrls, type ProjectReference } from '@/lib/references';
import { projectTypeLabel, PROJECT_TYPES } from '@/lib/roles';
import { fmtMoney } from '@/lib/format';
import { supabase } from '@/lib/supabase';

/** References: completed projects with photos, to show clients – filtered by category, year, country and application */
export function References() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [year, setYear] = useState('');
  const [country, setCountry] = useState('');
  const [apps, setApps] = useState<string[]>([]);
  const { data, error } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('project_references').select('*').eq('active', true).order('year', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
    if (e) throw new Error(e.message);
    const refs = (rows ?? []) as ProjectReference[];
    const urls = await photoUrls(refs.map((r) => r.photos[0]).filter(Boolean));
    return { refs, urls };
  }, []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const years = [...new Set(data.refs.map((r) => r.year).filter((y): y is number => y != null))].sort((a, b) => b - a);
  const countries = [...new Set(data.refs.map((r) => r.country).filter(Boolean))].sort();
  const s = q.trim().toLowerCase();
  const shown = data.refs.filter(
    (r) =>
      (!category || r.category === category) &&
      (!year || String(r.year) === year) &&
      (!country || r.country === country) &&
      (!apps.length || apps.some((a) => r.applications.includes(a))) &&
      (!s || [r.title, r.client, r.architect, r.interior_designer, r.mep_consultant, r.elec_consultant, r.location, r.country, r.description, ...r.brands].filter(Boolean).join(' ').toLowerCase().includes(s)),
  );
  const filtered = !!(category || year || country || apps.length || s);

  return (
    <View style={{ gap: 10 }}>
      <Row gap={8} wrap style={{ alignItems: 'flex-end' }}>
        <View style={{ flex: 1, minWidth: 240 }}>
          <Field label="Search" value={q} onChangeText={setQ} placeholder="Project, client, consultant, place or brand" />
        </View>
        <Button title="+ Add reference" onPress={() => router.push('/tools/reference/new')} />
      </Row>
      <Row gap={8} wrap style={{ alignItems: 'flex-end' }}>
        <Select label="Project category" value={category} onChange={setCategory} options={[{ value: '', label: 'All categories' }, ...PROJECT_TYPES.map((p) => ({ value: p.value, label: p.label }))]} />
        <Select label="Year" value={year} onChange={setYear} options={[{ value: '', label: 'All years' }, ...years.map((y) => ({ value: String(y), label: String(y) }))]} />
        <Select label="Country" value={country} onChange={setCountry} options={[{ value: '', label: 'All countries' }, ...countries.map((c) => ({ value: c, label: c }))]} />
      </Row>
      <Row gap={6} wrap>
        <Muted style={{ alignSelf: 'center' }}>Application:</Muted>
        {APPLICATIONS.map((a) => (
          <Chip key={a.value} label={a.label} on={apps.includes(a.value)} onPress={() => setApps(apps.includes(a.value) ? apps.filter((x) => x !== a.value) : [...apps, a.value])} />
        ))}
        {filtered ? <Button small variant="ghost" title="Clear filters" onPress={() => { setQ(''); setCategory(''); setYear(''); setCountry(''); setApps([]); }} /> : null}
      </Row>
      <Muted>{`${shown.length} reference${shown.length === 1 ? '' : 's'}${filtered ? ` of ${data.refs.length}` : ''}`}</Muted>
      {!shown.length ? (
        <Empty title={data.refs.length ? 'No references match' : 'No references yet'} hint={data.refs.length ? 'Change or clear the filters.' : 'Add a completed project with up to 4 photos.'} />
      ) : (
        <Grid min={260} max={3}>
          {shown.map((r) => (
            <Card key={r.id} style={{ padding: 0, overflow: 'hidden' }} onPress={() => router.push(`/tools/reference/${r.id}`)}>
              {r.photos[0] && data.urls[r.photos[0]] ? (
                <Image source={{ uri: data.urls[r.photos[0]] }} style={{ width: '100%', aspectRatio: 16 / 10, backgroundColor: colors.soft }} contentFit="cover" transition={150} />
              ) : (
                <View style={{ width: '100%', aspectRatio: 16 / 10, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' }}>
                  <Muted>No photo</Muted>
                </View>
              )}
              <View style={{ padding: 12, gap: 4 }}>
                <Text style={{ fontWeight: '700', fontSize: 15, color: colors.ink }} numberOfLines={2}>
                  {r.title}
                </Text>
                <Muted numberOfLines={1}>{[r.location, r.country, r.year].filter(Boolean).join(' · ')}</Muted>
                {r.description ? <Muted numberOfLines={2}>{r.description}</Muted> : null}
                <Row gap={4} wrap>
                  {r.category ? <Pill label={projectTypeLabel(r.category)} tone={colors.ink} /> : null}
                  {r.applications.map((a) => <Pill key={a} label={applicationLabel(a)} tone={colors.blue} />)}
                </Row>
                {r.brands.length ? <Muted numberOfLines={1}>{`Brands: ${r.brands.join(', ')}`}</Muted> : null}
                {r.value != null ? <Muted>{fmtMoney(r.value, r.currency)}</Muted> : null}
              </View>
            </Card>
          ))}
        </Grid>
      )}
    </View>
  );
}
