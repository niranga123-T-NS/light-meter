import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useDialog } from '@/components/dialog';
import { LocationPicker } from '@/components/LocationPicker';
import { PersonPicker, ProjectPicker } from '@/components/pickers';
import { Button, Card, DateField, ErrorBanner, Field, Muted, Notice, Row, Screen, Section, Select } from '@/components/ui';
import { captureLocation } from '@/components/VisitBits';
import { ENG_TYPES, mapsLink, type EngJob, type EngType } from '@/lib/engJobs';
import { geocodeAddress } from '@/lib/geocode';
import { rpc, supabase } from '@/lib/supabase';

type Draft = {
  job_type: EngType | null;
  title: string;
  instructions: string;
  project_id: string | null;
  organization_id: string | null;
  assignee_id: string | null;
  due_date: string | null;
  site_address: string;
  lat: number | null;
  lng: number | null;
  pinFrom: string;
};

const EMPTY: Draft = {
  job_type: null,
  title: '',
  instructions: '',
  project_id: null,
  organization_id: null,
  assignee_id: null,
  due_date: null,
  site_address: '',
  lat: null,
  lng: null,
  pinFrom: '',
};

/** Assign an engineering job (Senior Electrical Engineer): job type, engineer, deadline and the site location (address + pin). */
export default function NewEngJob() {
  const dialog = useDialog();
  const params = useLocalSearchParams<{ action?: string; id?: string; project?: string }>();
  const editing = !!params.id;
  const [f, setF] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((s) => ({ ...s, [k]: v }));

  const pickProject = async (id: string | null) => {
    if (!id) return set('project_id', null);
    const { data: p } = await supabase.from('projects').select('id, organization_id, location, city, lat, lng').eq('id', id).maybeSingle();
    if (!p) return;
    setF((s) => ({
      ...s,
      project_id: p.id,
      organization_id: p.organization_id ?? s.organization_id,
      site_address: s.site_address || [p.location, p.city].filter(Boolean).join(', '),
      lat: s.lat ?? p.lat,
      lng: s.lng ?? p.lng,
      pinFrom: s.lat != null ? s.pinFrom : p.lat != null ? 'project location' : s.pinFrom,
    }));
  };

  // Prefill: an existing job (edit), a meeting action (appoint), or a project
  useEffect(() => {
    (async () => {
      if (params.id) {
        const { data } = await supabase.from('eng_jobs').select('*').eq('id', params.id).maybeSingle();
        const j = data as EngJob | null;
        if (j)
          setF({
            job_type: j.job_type,
            title: j.title,
            instructions: j.instructions ?? '',
            project_id: j.project_id,
            organization_id: j.organization_id,
            assignee_id: j.assignee_id,
            due_date: j.due_date,
            site_address: j.site_address ?? '',
            lat: j.lat,
            lng: j.lng,
            pinFrom: j.lat != null ? 'saved location' : '',
          });
        return;
      }
      let project = params.project ?? null;
      if (params.action) {
        const { data: a } = await supabase.from('sales_meeting_actions').select('action, due_date, project_id, organization_id, assignee_id').eq('id', params.action).maybeSingle();
        if (a) {
          project = a.project_id ?? project;
          setF((s) => ({ ...s, title: a.action, due_date: a.due_date, organization_id: a.organization_id, assignee_id: a.assignee_id, job_type: /install/i.test(a.action) ? 'installation' : s.job_type }));
        }
      }
      if (project) await pickProject(project);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, params.action, params.project]);


  const fromAddress = () =>
    dialog.run(async () => {
      const hit = await geocodeAddress(f.site_address);
      if (!hit) throw new Error('The address could not be placed exactly on the map. Pin it on the map, or use your location at the site.');
      setF((s) => ({ ...s, lat: hit.lat, lng: hit.lng, pinFrom: `address: ${hit.label}` }));
    }, 'Location found from the address');

  const fromHere = () =>
    dialog.run(async () => {
      const pos = await captureLocation();
      if (!pos) throw new Error('Allow location access to use your current location');
      setF((s) => ({ ...s, lat: pos.lat, lng: pos.lng, pinFrom: 'my current location' }));
    }, 'Location set to where you are');

  const save = async () => {
    setError(null);
    if (!f.job_type) return setError('Choose the job type');
    if (!f.title.trim()) return setError('Describe the job');
    if (!f.assignee_id) return setError('Choose the engineer');
    if (!f.due_date) return setError('Set the deadline');
    if (!f.site_address.trim()) return setError('Enter the site address');
    if (f.lat == null || f.lng == null) return setError('Set the site location on the map – site visits are GPS-checked against it');
    const p = { ...f, lat: f.lat, lng: f.lng, meeting_action_id: params.action ?? '' };
    await dialog.run(async () => {
      if (editing) {
        await rpc('update_eng_job', { p_id: params.id, p });
        router.back();
      } else {
        const id = await rpc<string>('create_eng_job', { p });
        router.replace(`/engineering/${id}`);
      }
    }, editing ? 'Job updated' : 'Job assigned – the engineer is told');
  };

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: editing ? 'Edit job' : 'Assign a job' }} />
      <ErrorBanner message={error} />
      {params.action ? <Notice>From a meeting action – completing the job closes the action and tells the sales person and SM Projects.</Notice> : null}
      <Section title="Job">
        <Card>
          <Select
            label="Job type"
            required
            value={f.job_type}
            options={ENG_TYPES.map((t) => ({ value: t.value, label: t.label, hint: t.hint }))}
            onChange={(v) => set('job_type', v as EngType)}
          />
          <Field label="Job" required value={f.title} onChangeText={(v) => set('title', v)} placeholder="e.g. Install high bay lights – warehouse 2" />
          <Field label="Instructions" multiline value={f.instructions} onChangeText={(v) => set('instructions', v)} />
          <ProjectPicker value={f.project_id} onChange={(p) => pickProject(p?.id ?? null)} />
        </Card>
      </Section>
      <Section title="Engineer and deadline">
        <Card>
          {!editing ? (
            <PersonPicker label="Engineer" required roles={['assistant_engineer', 'senior_elec_engineer']} value={f.assignee_id} onChange={(v) => set('assignee_id', v)} />
          ) : (
            <Muted>To change the engineer or the deadline, use Reassign / Revise deadline on the job.</Muted>
          )}
          {!editing ? <DateField label="Deadline" required value={f.due_date} onChange={(v) => set('due_date', v)} quick={[1, 3, 7, 14]} /> : null}
        </Card>
      </Section>
      <Section title="Site location">
        <Card>
          <Field label="Site address" required value={f.site_address} onChangeText={(v) => set('site_address', v)} multiline />
          <Row wrap gap={6}>
            <Button small variant="secondary" title="Find from the address" onPress={fromAddress} />
            {Platform.OS === 'web' ? <Button small variant="secondary" title="Pin on the map" onPress={() => setMapOpen(true)} /> : null}
            <Button small variant="secondary" title="Use my current location" onPress={fromHere} />
            {f.lat != null && f.lng != null ? <Button small variant="ghost" title="Open in Maps" onPress={() => Linking.openURL(mapsLink(f.lat as number, f.lng as number))} /> : null}
          </Row>
          <Muted>
            {f.lat != null && f.lng != null
              ? `Pinned at ${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}${f.pinFrom ? ` – ${f.pinFrom}` : ''}. The engineer's site visits are GPS-checked against this point.`
              : 'Not pinned yet – the engineer marks site visits by GPS against this point.'}
          </Muted>
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title={editing ? 'Save' : 'Assign job'} onPress={save} />
      </Row>
      <LocationPicker
        visible={mapOpen}
        title="Site location"
        query={f.site_address}
        initial={f.lat != null && f.lng != null ? { lat: f.lat, lng: f.lng } : null}
        onSave={async (p) => setF((s) => ({ ...s, lat: p.lat, lng: p.lng, pinFrom: 'pinned on the map' }))}
        onClose={() => setMapOpen(false)}
      />
    </Screen>
  );
}
