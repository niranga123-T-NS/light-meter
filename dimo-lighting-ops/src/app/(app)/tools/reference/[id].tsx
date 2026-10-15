import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, Chip, colors, ErrorBanner, Field, H1, KeyValue, Loading, Muted, MultiSelect, Notice, NumberField, Pill, Row, Screen, Section, Segmented, Select, styles, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { pickImage, uuid, type PickedFile } from '@/lib/files';
import { fmtMoney } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { applicationText, APPLICATIONS, keepsReferences, MAX_PHOTOS, OUTDOOR_TYPES, PARTIES, photoUrls, removePhotos, uploadPhoto, type ProjectReference } from '@/lib/references';
import { projectTypeLabel, PROJECT_TYPES } from '@/lib/roles';
import { TOOLS_ROLES } from '@/lib/standards';
import { supabase } from '@/lib/supabase';
import type { Currency } from '@/lib/types';

type Photo = { path?: string; file?: PickedFile; uri: string };
type Form = Pick<ProjectReference, 'title' | 'client' | 'architect' | 'interior_designer' | 'mep_consultant' | 'elec_consultant' | 'description' | 'year' | 'value' | 'currency' | 'location' | 'country' | 'category' | 'applications' | 'outdoor_types' | 'brands'>;
const BLANK: Form = { title: '', client: null, architect: null, interior_designer: null, mep_consultant: null, elec_consultant: null, description: null, year: new Date().getFullYear(), value: null, currency: 'LKR', location: null, country: 'Sri Lanka', category: null, applications: [], outdoor_types: [], brands: [] };
const COUNTRIES = ['Sri Lanka', 'Maldives', 'India', 'Bangladesh', 'United Arab Emirates', 'Qatar', 'Other'];

/** A project reference: up to 4 photos, short description, year, value, location, country, category, applications and brands */
export default function ReferencePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const isNew = id === 'new';
  const [editing, setEditing] = useState(isNew);
  const [form, setForm] = useState<Form | null>(null);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [shown, setShown] = useState(0);
  const [newId] = useState(uuid);
  const { data, error, reload } = useLoad(async () => {
    const [b, r] = await Promise.all([
      supabase.from('brands').select('name').eq('active', true).order('name'),
      isNew ? Promise.resolve({ data: null, error: null }) : supabase.from('project_references').select('*').eq('id', id).maybeSingle(),
    ]);
    if (r.error) throw new Error(r.error.message);
    const ref = (r.data ?? null) as ProjectReference | null;
    const urls = ref ? await photoUrls(ref.photos) : {};
    return { brands: ((b.data ?? []) as { name: string }[]).map((x) => x.name), ref, urls };
  }, [id]);
  if (!TOOLS_ROLES.includes(me.role)) return <Screen><Notice>References are part of Sales Tools.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const ref = data.ref;
  if (!isNew && !ref) return <Screen><Notice>Reference not found.</Notice></Screen>;
  const canEdit = keepsReferences(me.role);
  if (isNew && !canEdit) return <Screen><Notice>Only the Lighting Designer adds references.</Notice></Screen>;
  const f: Form = form ?? (ref ? { ...BLANK, ...ref } : BLANK);
  const set = (p: Partial<Form>) => setForm({ ...f, ...p });
  const pics: Photo[] = photos ?? (ref?.photos ?? []).map((p) => ({ path: p, uri: data.urls[p] ?? '' }));

  const addPhoto = async (camera: boolean) => {
    if (pics.length >= MAX_PHOTOS) return dialog.toast(`Up to ${MAX_PHOTOS} photos`, 'error');
    try {
      const file = await pickImage(camera);
      if (file) setPhotos([...pics, { file, uri: file.uri }]);
    } catch (e) {
      dialog.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };
  const movePhoto = (i: number, to: number) => {
    const next = [...pics];
    const [p] = next.splice(i, 1);
    next.splice(to, 0, p);
    setPhotos(next);
  };
  const cancel = () => {
    if (isNew) return router.back();
    setEditing(false);
    setForm(null);
    setPhotos(null);
  };
  const save = () =>
    dialog.run(async () => {
      if (!f.title.trim()) throw new Error('Give the project a name');
      if (!pics.length) throw new Error('Add at least one photo');
      const refId = isNew ? newId : (id as string);
      const row = {
        title: f.title.trim(),
        ...Object.fromEntries(PARTIES.map((p) => [p.key, f[p.key]?.trim() || null])),
        description: f.description?.trim() || null,
        year: f.year,
        value: f.value,
        currency: f.currency,
        location: f.location?.trim() || null,
        country: f.country.trim() || 'Sri Lanka',
        category: f.category || null,
        applications: f.applications,
        outdoor_types: f.applications.includes('outdoor') ? f.outdoor_types : [],
        brands: f.brands,
        updated_by: me.id,
        updated_at: new Date().toISOString(),
      };
      if (isNew) {
        const { error: e } = await supabase.from('project_references').upsert({ id: refId, ...row, created_by: me.id });
        if (e) throw new Error(e.message);
      }
      const paths: string[] = [];
      for (const p of pics) paths.push(p.path ?? (await uploadPhoto(refId, p.file as PickedFile)));
      const { error: e } = await supabase.from('project_references').update({ ...row, photos: paths }).eq('id', refId);
      if (e) throw new Error(e.message);
      await removePhotos((ref?.photos ?? []).filter((p) => !paths.includes(p)));
      if (isNew) return router.replace(`/tools/reference/${refId}`);
      setEditing(false);
      setForm(null);
      setPhotos(null);
      setShown(0);
      await reload();
    }, 'Reference saved');
  const remove = async () => {
    if (!ref || !(await dialog.confirm('Remove this reference?', 'It and its photos are removed for everyone.', { confirmLabel: 'Remove' }))) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('project_references').delete().eq('id', ref.id);
      if (e) throw new Error(e.message);
      await removePhotos(ref.photos);
      router.replace('/tools?tab=refs');
    }, 'Reference removed');
  };

  if (editing) {
    return (
      <Screen maxWidth={900}>
        <Stack.Screen options={{ title: isNew ? 'New reference' : 'Edit reference' }} />
        <Section title={`Photos (up to ${MAX_PHOTOS}) – the first is the cover`}>
          <Row gap={8} wrap>
            {pics.map((p, i) => (
              <View key={p.path ?? p.uri} style={{ width: 170, gap: 4 }}>
                <Image source={{ uri: p.uri }} style={{ width: 170, height: 110, borderRadius: 8, backgroundColor: colors.soft }} contentFit="cover" />
                <Row gap={4} style={{ justifyContent: 'space-between', alignItems: 'center', minHeight: 34 }}>
                  {i > 0 ? <Button small variant="ghost" title="Make cover" onPress={() => movePhoto(i, 0)} /> : <Pill label="Cover" tone={colors.brand} />}
                  <Button small variant="ghost" title="✕ Remove" onPress={() => setPhotos(pics.filter((_, k) => k !== i))} />
                </Row>
              </View>
            ))}
            {pics.length < MAX_PHOTOS ? (
              <View style={{ width: 170, height: 110, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Button small variant="secondary" title="+ Choose photo" onPress={() => addPhoto(false)} />
                <Button small variant="ghost" title="Take photo" onPress={() => addPhoto(true)} />
              </View>
            ) : null}
          </Row>
        </Section>
        <Card style={{ gap: 4 }}>
          <Field label="Project name" required value={f.title} onChangeText={(v) => set({ title: v })} maxLength={160} placeholder="e.g. Cinnamon Lakeside – Ballroom" />
          <Field label="Short description" multiline value={f.description ?? ''} onChangeText={(v) => set({ description: v })} maxLength={600} placeholder="What was done and what makes it special – scope, results, highlights" />
          <Row gap={8} wrap>
            <View style={{ flex: 1, minWidth: 140 }}>
              <NumberField label="Year" value={f.year} onChange={(v) => set({ year: v == null ? null : Math.round(v) })} />
            </View>
            <View style={{ flex: 2, minWidth: 200 }}>
              <NumberField label="Project value – if available" suffix={f.currency} value={f.value} onChange={(v) => set({ value: v })} />
            </View>
            <View style={{ justifyContent: 'center' }}>
              <Segmented<Currency> value={f.currency} onChange={(c) => set({ currency: c })} options={[{ value: 'LKR', label: 'LKR' }, { value: 'USD', label: 'USD' }]} />
            </View>
          </Row>
          <Row gap={8} wrap>
            <View style={{ flex: 1, minWidth: 220 }}>
              <Field label="Location" value={f.location ?? ''} onChangeText={(v) => set({ location: v })} placeholder="e.g. Colombo 02" />
            </View>
            <View style={{ flex: 1, minWidth: 220 }}>
              <Select label="Country" required searchable value={COUNTRIES.includes(f.country) ? f.country : 'Other'} onChange={(c) => set({ country: c === 'Other' ? '' : c })} options={COUNTRIES.map((c) => ({ value: c, label: c }))} />
              {!COUNTRIES.slice(0, -1).includes(f.country) ? <Field label="Country name" value={f.country} onChangeText={(v) => set({ country: v })} /> : null}
            </View>
          </Row>
          <Select label="Project category" value={f.category ?? ''} onChange={(c) => set({ category: c || null })} options={[{ value: '', label: 'Not set' }, ...PROJECT_TYPES.map((p) => ({ value: p.value, label: p.label }))]} />
          <Text style={{ fontWeight: '600', color: colors.ink, marginTop: 4 }}>Application type</Text>
          <Row gap={6} wrap style={{ marginBottom: 8 }}>
            {APPLICATIONS.map((a) => (
              <Chip key={a.value} label={a.label} on={f.applications.includes(a.value)} onPress={() => set({ applications: f.applications.includes(a.value) ? f.applications.filter((x) => x !== a.value) : [...f.applications, a.value] })} />
            ))}
          </Row>
          {f.applications.includes('outdoor') ? (
            <>
              <Text style={{ fontWeight: '600', color: colors.ink }}>Outdoor – kind of project</Text>
              <Row gap={6} wrap style={{ marginBottom: 8 }}>
                {OUTDOOR_TYPES.map((o) => (
                  <Chip key={o.value} label={o.label} on={f.outdoor_types.includes(o.value)} onPress={() => set({ outdoor_types: f.outdoor_types.includes(o.value) ? f.outdoor_types.filter((x) => x !== o.value) : [...f.outdoor_types, o.value] })} />
                ))}
              </Row>
            </>
          ) : null}
          <Text style={{ fontWeight: '600', color: colors.ink, marginTop: 4 }}>Project team – tick the ones you know</Text>
          {PARTIES.map((p) => (
            <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <View style={{ width: 210 }}>
                <Toggle label={p.label} value={f[p.key] != null} onChange={(on) => set({ [p.key]: on ? '' : null })} />
              </View>
              {f[p.key] != null ? (
                <View style={{ flex: 1, minWidth: 220 }}>
                  <TextInput value={f[p.key] ?? ''} onChangeText={(v) => set({ [p.key]: v })} placeholder={`Name of the ${p.label.toLowerCase()}`} placeholderTextColor={colors.faint} style={[styles.input, { marginBottom: 8 }]} autoFocus={!f[p.key]} />
                </View>
              ) : null}
            </View>
          ))}
          <MultiSelect label="Brands involved" values={f.brands} onChange={(v) => set({ brands: v })} options={[...new Set([...data.brands, ...f.brands])].map((n) => ({ value: n, label: n }))} />
        </Card>
        <Row gap={8} style={{ marginTop: 10 }}>
          <Button title="Save" onPress={save} />
          <Button variant="secondary" title="Cancel" onPress={cancel} />
        </Row>
      </Screen>
    );
  }

  const r = ref as ProjectReference;
  const big = r.photos[Math.min(shown, r.photos.length - 1)];
  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'Reference' }} />
      <Row gap={8} wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1, minWidth: 240 }}>
          <H1>{r.title}</H1>
          <Muted>{[r.client, r.location, r.country, r.year].filter(Boolean).join(' · ')}</Muted>
        </View>
        {canEdit ? (
          <Row gap={6}>
            <Button small variant="secondary" title="Edit" onPress={() => setEditing(true)} />
            <Button small variant="ghost" title="Remove" onPress={remove} />
          </Row>
        ) : null}
      </Row>
      {big ? (
        <View style={{ gap: 8, marginTop: 10 }}>
          <Image source={{ uri: data.urls[big] }} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#111' }} contentFit="contain" transition={150} />
          <Row gap={8}>
            {r.photos.map((p, i) => (
              <Pressable key={p} onPress={() => setShown(i)} style={{ flex: 1, maxWidth: 160, borderRadius: 8, overflow: 'hidden', borderWidth: 3, borderColor: i === shown ? colors.brand : 'transparent' }}>
                <Image source={{ uri: data.urls[p] }} style={{ width: '100%', aspectRatio: 16 / 10 }} contentFit="cover" />
              </Pressable>
            ))}
          </Row>
        </View>
      ) : null}
      <Card style={{ gap: 8, marginTop: 12 }}>
        {r.description ? <Text style={{ fontSize: 15, color: colors.ink, lineHeight: 22 }}>{r.description}</Text> : null}
        <Row gap={4} wrap>
          {r.category ? <Pill label={projectTypeLabel(r.category)} tone={colors.ink} /> : null}
          {r.applications.map((a) => <Pill key={a} label={applicationText(a, r)} tone={colors.blue} />)}
        </Row>
        <KeyValue label="Year" value={r.year ?? '—'} />
        <KeyValue label="Location" value={[r.location, r.country].filter(Boolean).join(', ') || '—'} />
        {PARTIES.map((p) => (r[p.key] ? <KeyValue key={p.key} label={p.label} value={r[p.key]} /> : null))}
        <KeyValue label="Brands involved" value={r.brands.join(', ') || '—'} />
        <KeyValue label="Project value" value={r.value != null ? fmtMoney(r.value, r.currency) : 'Not given'} />
      </Card>
    </Screen>
  );
}
