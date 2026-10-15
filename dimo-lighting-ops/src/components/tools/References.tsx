import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { RefPhoto } from '@/components/RefPhoto';
import { Button, Card, Chip, colors, Empty, ErrorBanner, Field, Grid, Loading, Muted, Pill, Row, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { useLoad } from '@/lib/hooks';
import { applicationText, APPLICATIONS, isDrive, keepsReferences, OUTDOOR_TYPES, photoUrls, type ProjectReference } from '@/lib/references';
import { projectTypeLabel, PROJECT_TYPES } from '@/lib/roles';
import { fmtMoney } from '@/lib/format';
import { supabase } from '@/lib/supabase';

/** References: completed projects with photos, to show clients – filtered by category, year, country and application */
export function References() {
  const me = useMe();
  const keeper = keepsReferences(me.role);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [year, setYear] = useState('');
  const [country, setCountry] = useState('');
  const [apps, setApps] = useState<string[]>([]);
  const [outs, setOuts] = useState<string[]>([]);
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
      (!outs.length || outs.some((o) => r.outdoor_types.includes(o))) &&
      (!s || [r.title, r.client, r.architect, r.interior_designer, r.mep_consultant, r.elec_consultant, r.location, r.country, r.description, ...r.brands].filter(Boolean).join(' ').toLowerCase().includes(s)),
  );
  const filtered = !!(category || year || country || apps.length || outs.length || s);

  return (
    <View style={{ gap: 10 }}>
      <Row gap={8} wrap style={{ alignItems: 'flex-end' }}>
        <View style={{ flex: 1, minWidth: 240 }}>
          <Field label="Search" value={q} onChangeText={setQ} placeholder="Project, client, consultant, place or brand" />
        </View>
        {keeper ? <Button title="+ Add reference" onPress={() => router.push('/tools/reference/new')} /> : null}
      </Row>
      <Row gap={8} wrap style={{ alignItems: 'flex-end' }}>
        <Select label="Project category" value={category} onChange={setCategory} options={[{ value: '', label: 'All categories' }, ...PROJECT_TYPES.map((p) => ({ value: p.value, label: p.label }))]} />
        <Select label="Year" value={year} onChange={setYear} options={[{ value: '', label: 'All years' }, ...years.map((y) => ({ value: String(y), label: String(y) }))]} />
        <Select label="Country" value={country} onChange={setCountry} options={[{ value: '', label: 'All countries' }, ...countries.map((c) => ({ value: c, label: c }))]} />
      </Row>
      <Row gap={6} wrap>
        <Muted style={{ alignSelf: 'center' }}>Application:</Muted>
        {APPLICATIONS.map((a) => (
          <Chip
            key={a.value}
            label={a.label}
            on={apps.includes(a.value)}
            onPress={() => {
              if (apps.includes(a.value) && a.value === 'outdoor') setOuts([]);
              setApps(apps.includes(a.value) ? apps.filter((x) => x !== a.value) : [...apps, a.value]);
            }}
          />
        ))}
        {filtered ? <Button small variant="ghost" title="Clear filters" onPress={() => { setQ(''); setCategory(''); setYear(''); setCountry(''); setApps([]); setOuts([]); }} /> : null}
      </Row>
      {apps.includes('outdoor') ? (
        <Row gap={6} wrap>
          <Muted style={{ alignSelf: 'center' }}>Outdoor:</Muted>
          {OUTDOOR_TYPES.map((o) => (
            <Chip key={o.value} label={o.label} on={outs.includes(o.value)} onPress={() => setOuts(outs.includes(o.value) ? outs.filter((x) => x !== o.value) : [...outs, o.value])} />
          ))}
        </Row>
      ) : null}
      <Muted>{`${shown.length} reference${shown.length === 1 ? '' : 's'}${filtered ? ` of ${data.refs.length}` : ''}`}</Muted>
      {!shown.length ? (
        <Empty title={data.refs.length ? 'No references match' : 'No references yet'} hint={data.refs.length ? 'Change or clear the filters.' : keeper ? 'Add a completed project with photos – upload them or paste Google Drive links.' : 'The Lighting Designer adds the references.'} />
      ) : (
        <Grid min={260} max={3}>
          {shown.map((r) => (
            <Card key={r.id} style={{ padding: 0, overflow: 'hidden' }} onPress={() => router.push(`/tools/reference/${r.id}`)}>
              <View>
                <RefPhoto uri={r.photos[0] ? data.urls[r.photos[0]] : undefined} drive={!!r.photos[0] && isDrive(r.photos[0])} hint={keeper} style={{ width: '100%', aspectRatio: 16 / 10 }} />
                {r.photos.length > 1 || r.album_url ? (
                  <View style={{ position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: '#fff', fontSize: 12 }}>{`📷 ${r.photos.length}${r.album_url ? ' · 📁 album' : ''}`}</Text>
                  </View>
                ) : null}
              </View>
              <View style={{ padding: 12, gap: 4 }}>
                <Text style={{ fontWeight: '700', fontSize: 15, color: colors.ink }} numberOfLines={2}>
                  {r.title}
                </Text>
                <Muted numberOfLines={1}>{[r.location, r.country, r.year].filter(Boolean).join(' · ')}</Muted>
                {r.description ? <Muted numberOfLines={2}>{r.description}</Muted> : null}
                <Row gap={4} wrap>
                  {r.category ? <Pill label={projectTypeLabel(r.category)} tone={colors.ink} /> : null}
                  {r.applications.map((a) => <Pill key={a} label={applicationText(a, r)} tone={colors.blue} />)}
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
