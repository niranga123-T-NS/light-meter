import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Field, Grid, Loading, Muted, Row, Screen, Section, Segmented, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecMember } from '@/lib/execution';
import { pickDocument, pickImage, uploadAttachment, type PickedFile } from '@/lib/files';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import { loadSubcontractors } from '@/lib/subcontractors';
import { TRADES, type Worker } from '@/lib/workers';

const blank = { full_name: '', address: '', police_station: '', id_type: 'nic' as 'nic' | 'passport', id_no: '', mobile: '', trade: '', emergency_name: '', emergency_phone: '', company: '', supervisor_id: '' };

/** Add (or correct) a site worker: personal details, NIC / passport number and photos of both sides. */
export default function WorkerForm() {
  const params = useLocalSearchParams<{ project?: string; edit?: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const sup = me.role === 'sub_supervisor';
  const [f, setF] = useState(blank);
  const [front, setFront] = useState<PickedFile | null>(null);
  const [back, setBack] = useState<PickedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Set once the details are saved: if a photo upload then fails, trying again uploads to the same worker
  const [savedId, setSavedId] = useState<string | null>(null);
  const { data } = useLoad(async () => {
    const w = params.edit ? ((await supabase.from('exec_workers').select('*').eq('id', params.edit).single()).data as Worker) : null;
    const project = params.project ?? w?.exec_project_id ?? '';
    const { data: mem } = await supabase.from('exec_members').select('*').eq('exec_project_id', project).eq('active', true).eq('member_role', 'sub_supervisor');
    return { w, project, sups: (mem ?? []) as ExecMember[], subs: project ? await loadSubcontractors(project) : [] };
  }, [params.edit, params.project]);
  if (data && !loaded) {
    setLoaded(true);
    if (data.w) setF({ ...blank, ...Object.fromEntries(Object.entries(data.w).filter(([k]) => k in blank).map(([k, v]) => [k, v ?? ''])) } as typeof blank);
  }
  if (!data) return <Screen><Loading /></Screen>;
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((s) => ({ ...s, [k]: v }));
  const supCompany = (id: string) => (people[id] as { company?: string | null } | undefined)?.company ?? '';
  const companies = ['DIMO (own labour)', ...data.subs.filter((s) => s.active).map((s) => s.name)];

  const take = async (side: 'front' | 'back') => {
    const camera = Platform.OS !== 'web' || (await dialog.confirm('ID photo', 'Take a photo with the camera? (Cancel to choose a file)', { confirmLabel: 'Camera' }));
    const x = camera ? await pickImage(true).catch(() => null) : await pickDocument();
    if (x) (side === 'front' ? setFront : setBack)(x);
  };

  const fill = async () => {
    if (!f.id_no.trim()) return setError('Enter the NIC / passport number first');
    await dialog.run(async () => {
      const rows = await rpc<Partial<typeof blank & { project: string }>[]>('worker_lookup', { p_id_no: f.id_no });
      if (!rows.length) throw new Error('No earlier record for this ID – fill in the details');
      const r = rows[0];
      setF((s) => ({ ...s, full_name: r.full_name ?? s.full_name, address: r.address ?? s.address, police_station: r.police_station ?? s.police_station,
        mobile: r.mobile ?? s.mobile, trade: r.trade ?? s.trade, emergency_name: r.emergency_name ?? s.emergency_name, emergency_phone: r.emergency_phone ?? s.emergency_phone,
        company: s.company || (r.company ?? '') }));
    }, 'Filled from an earlier DIMO project – check the details');
  };

  const save = async () => {
    setError(null);
    if (!data.w && (!front || !back)) return setError(`The photos of both sides of the ${f.id_type === 'nic' ? 'NIC' : 'passport'} are required – take or choose them first`);
    await dialog.run(async () => {
      const company = f.company === 'DIMO (own labour)' ? 'DIMO' : f.company;
      const id = await rpc<string>('save_worker', { p_exec: data.project, p: { ...f, company, id: data.w?.id ?? savedId ?? '' } });
      setSavedId(id);
      try {
        if (front) await uploadAttachment('exec_worker', id, 'id_front', front);
        if (back) await uploadAttachment('exec_worker', id, 'id_back', back);
      } catch (e) {
        throw new Error(`Details saved, but the ID photo did not upload (${e instanceof Error ? e.message : 'network'}). Press Add worker again to retry the photos.`);
      }
      router.replace(`/execution/worker/${id}`);
    }, data.w ? 'Saved' : sup ? 'Added – an Assistant Engineer verifies and inducts' : 'Added');
  };

  const photo = (label: string, file: PickedFile | null, side: 'front' | 'back') => (
    <View style={{ flex: 1, minWidth: 220, gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{label}</Text>
      {file ? <Image source={{ uri: file.uri }} style={{ width: '100%', height: 150, borderRadius: 8, backgroundColor: colors.soft }} resizeMode="contain" /> : (
        <View style={{ height: 150, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, alignItems: 'center', justifyContent: 'center' }}>
          <Muted>{data.w ? 'Kept – replace only if needed' : 'No photo yet'}</Muted>
        </View>
      )}
      <Button small variant="secondary" title={file ? 'Retake' : 'Take / choose photo'} onPress={() => take(side)} />
    </View>
  );

  return (
    <Screen maxWidth={820}>
      <Stack.Screen options={{ title: data.w ? 'Edit worker' : 'Add worker' }} />
      <TestingBanner what="Site workers register" />
      <ErrorBanner message={error} />
      <Section title="Identity">
        <Card>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>ID type</Text>
          <Segmented value={f.id_type} onChange={(v) => set('id_type', v)} options={[{ value: 'nic', label: 'NIC' }, { value: 'passport', label: 'Passport' }]} />
          <Row gap={8} style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label={f.id_type === 'nic' ? 'NIC number' : 'Passport number'} required value={f.id_no} onChangeText={(v) => set('id_no', v.toUpperCase())} placeholder={f.id_type === 'nic' ? '901234567V or 199012345678' : 'N1234567'} autoCapitalize="characters" />
            </View>
            {!data.w ? <Button small variant="ghost" title="Fill from earlier project" onPress={fill} /> : null}
          </Row>
          <Field label="Full name" required value={f.full_name} onChangeText={(v) => set('full_name', v)} />
          <Field label="Address" required multiline value={f.address} onChangeText={(v) => set('address', v)} />
          <Field label="Nearest police station" required value={f.police_station} onChangeText={(v) => set('police_station', v)} />
          <Row wrap gap={12}>
            {photo(`${f.id_type === 'nic' ? 'NIC' : 'Passport'} – front side${data.w ? '' : ' *'}`, front, 'front')}
            {photo(`${f.id_type === 'nic' ? 'NIC' : 'Passport'} – back side${data.w ? '' : ' *'}`, back, 'back')}
          </Row>
        </Card>
      </Section>
      <Section title="Work">
        <Card>
          {sup ? (
            <Muted>{`Company: ${supCompany(me.id) || 'your company'} · your crew`}</Muted>
          ) : (
            <Select label="Company" required value={f.company === 'DIMO' ? 'DIMO (own labour)' : f.company || null} onChange={(v) => set('company', v ?? '')}
              hint="DIMO own labour, or a subcontractor of the project (Team → Subcontractors)"
              options={[...companies.map((c) => ({ value: c, label: c })), ...(f.company && !companies.includes(f.company) && f.company !== 'DIMO' ? [{ value: f.company, label: `${f.company} (not on the list)` }] : [])]} />
          )}
          {!sup && data.sups.length ? (
            <Select label="Crew of supervisor (optional)" value={f.supervisor_id || null} onChange={(v) => set('supervisor_id', v ?? '')}
              options={[{ value: '', label: '— none —' }, ...data.sups.map((m) => ({ value: m.user_id, label: `${people[m.user_id]?.full_name ?? ''} · ${supCompany(m.user_id)}` }))]} />
          ) : null}
          <Grid min={240}>
            <Select label="Trade / position" value={f.trade || null} onChange={(v) => set('trade', v ?? '')} options={TRADES} />
            <Field label="Mobile" value={f.mobile} onChangeText={(v) => set('mobile', v)} keyboardType="phone-pad" />
          </Grid>
          <Grid min={240}>
            <Field label="Emergency contact – name (optional)" value={f.emergency_name} onChangeText={(v) => set('emergency_name', v)} />
            <Field label="Emergency contact – phone" value={f.emergency_phone} onChangeText={(v) => set('emergency_phone', v)} keyboardType="phone-pad" />
          </Grid>
        </Card>
      </Section>
      <Muted>{"Personal data: only the project's Assistant Engineers, the Senior Electrical Engineer, SM Projects and this crew's supervisor can see these details and photos."}</Muted>
      <Row gap={8} style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title={data.w ? 'Save' : 'Add worker'} onPress={save} />
      </Row>
    </Screen>
  );
}
