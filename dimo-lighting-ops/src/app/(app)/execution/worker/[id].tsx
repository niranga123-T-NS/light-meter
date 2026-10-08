import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTimeY, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Attachment } from '@/lib/types';
import { idLabel, workerState, type Worker } from '@/lib/workers';

/** One site worker: details, both sides of the ID, verification and induction. */
export default function WorkerView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [tick, setTick] = useState(0);
  const { data, error, reload } = useLoad(async () => {
    const { data: w, error: e } = await supabase.from('exec_workers').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const { data: atts } = await supabase.from('attachments').select('*').eq('entity_type', 'exec_worker').eq('entity_id', id).is('archived_at', null).order('uploaded_at', { ascending: false });
    const urls: Record<string, string> = {};
    for (const k of ['id_front', 'id_back']) {
      const a = ((atts ?? []) as Attachment[]).find((x) => x.kind === k);
      if (a) urls[k] = (await supabase.storage.from('files').createSignedUrl(a.storage_path, 600)).data?.signedUrl ?? '';
    }
    const ind = (w as Worker).induction_id ? (await supabase.from('hse_inductions').select('inducted_on, instructor_id').eq('id', (w as Worker).induction_id!).maybeSingle()).data : null;
    return { w: w as Worker, urls, ind: ind as { inducted_on: string; instructor_id: string | null } | null };
  }, [id, tick]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { w, urls, ind } = data;
  const ae = me.role === 'assistant_engineer' || me.role === 'senior_elec_engineer';
  const canEdit = ae || (w.added_by === me.id && !w.verified_at);
  const act = (fn: string, args: Record<string, unknown>, ok: string) => dialog.run(async () => { await rpc(fn, args); await reload(); }, ok);
  const st = workerState(w);

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: w.full_name }} />
      <TestingBanner what="Site workers register" />
      <Card style={{ gap: 6, borderLeftWidth: 5, borderLeftColor: st === 'Inducted' ? colors.green : st === 'Off site' ? colors.grey : colors.amber }}>
        <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <Text style={{ fontWeight: '700', fontSize: 18, color: colors.ink }}>{w.full_name}</Text>
            <Muted>{`${w.trade ?? 'Worker'} · ${w.company}`}</Muted>
          </View>
          <Pill label={st} tone={st === 'Inducted' ? colors.green : st === 'Off site' ? colors.grey : colors.amber} solid />
        </Row>
        <Row wrap>
          <KeyValue label={idLabel(w)} value={w.id_no} />
          <KeyValue label="Nearest police station" value={w.police_station} />
          <KeyValue label="Mobile" value={w.mobile ?? '—'} />
          <KeyValue label="Emergency contact" value={w.emergency_name ? `${w.emergency_name} · ${w.emergency_phone ?? ''}` : '—'} />
          <KeyValue label="Crew of" value={w.supervisor_id ? people[w.supervisor_id]?.full_name ?? '—' : 'Own team'} />
          <KeyValue label="Added" value={`${people[w.added_by]?.full_name ?? ''} · ${fmtDate(w.added_at)}`} />
        </Row>
        <KeyValue label="Address" value={w.address} wide />
        {w.verified_at ? <Muted>{`Verified by ${people[w.verified_by ?? '']?.full_name ?? ''} · ${fmtDateTimeY(w.verified_at)}`}</Muted> : null}
        {ind ? <Muted>{`Inducted ${fmtDate(ind.inducted_on)} by ${people[ind.instructor_id ?? '']?.full_name ?? ''} (HSE induction register IR-01)`}</Muted> : null}
        {w.status === 'off_site' ? <Notice tone={colors.grey}>{`Off site from ${fmtDate(w.off_site_on)}${w.off_site_reason ? ` – ${w.off_site_reason}` : ''}`}</Notice> : null}
        <Row gap={8} wrap style={{ marginTop: 4 }}>
          {w.status === 'active' && ae && !w.verified_at ? <Button title="Verified – ID matches the person" onPress={() => act('verify_worker', { p_id: w.id }, 'Verified')} /> : null}
          {w.status === 'active' && ae && w.verified_at && !w.induction_id ? <Button title="Give HSE induction" onPress={() => act('induct_worker', { p_id: w.id }, 'Inducted – added to the induction register')} /> : null}
          {canEdit ? <Button variant="secondary" title="Edit details" onPress={() => router.push({ pathname: '/execution/worker/new', params: { edit: w.id } })} /> : null}
          {w.status === 'active' && (ae || w.supervisor_id === me.id) ? (
            <Button variant="ghost" title="Off site" onPress={async () => {
              const r = await dialog.prompt({ title: 'Worker off site', fields: [{ key: 'd', label: 'From', type: 'date', required: true, initial: todayISO() }, { key: 'r', label: 'Reason (optional)' }], confirmLabel: 'Mark off site' });
              if (r) await act('set_worker_off_site', { p_id: w.id, p_date: r.d, p_reason: r.r || null }, 'Marked off site');
            }} />
          ) : null}
        </Row>
      </Card>
      <Section title={`${idLabel(w)} – both sides`}>
        <Row wrap gap={12}>
          {(['id_front', 'id_back'] as const).map((k) => (
            <Card key={k} style={{ flex: 1, minWidth: 260, gap: 6 }}>
              <Text style={{ fontWeight: '600', color: colors.text }}>{k === 'id_front' ? 'Front side' : 'Back side'}</Text>
              {urls[k] ? <Image source={{ uri: urls[k] }} style={{ width: '100%', height: 200, borderRadius: 8, backgroundColor: colors.soft }} resizeMode="contain" /> : <Muted style={{ color: colors.red }}>Missing</Muted>}
            </Card>
          ))}
        </Row>
      </Section>
      {canEdit ? (
        <Attachments entityType="exec_worker" entityId={w.id} kinds={['id_front', 'id_back']} title="Replace an ID photo" canUpload onChange={() => setTick((t) => t + 1)} />
      ) : null}
    </Screen>
  );
}
