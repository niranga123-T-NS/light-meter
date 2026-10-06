import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Field, KeyValue, ListRow, Loading, Muted, Notice, NumberField, Pill, Progress, Row, Screen, Section, Segmented, Select } from '@/components/ui';
import { captureLocation } from '@/components/VisitBits';
import { useMe } from '@/lib/auth';
import { ENG_SELECT, ENG_STATUS, engTypeLabel, INSTALL_STAGES, isOpen, isOverdue, mapsLink, UPDATE_LABEL, type EngJob, type EngUpdate } from '@/lib/engJobs';
import { listAttachments, openAttachment, pickDocument, pickImage, uploadAttachment, type PickedFile } from '@/lib/files';
import { daysBetween, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Attachment } from '@/lib/types';

type UpdateKind = 'progress' | 'inspection' | 'activity';

/** One engineering job: accept / hold, site visits (GPS), updates by job type with photos, review of holds, completion. */
export default function EngJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const lead = me.role === 'senior_elec_engineer' || me.role === 'sm_projects' || me.role === 'gm';
  const { data, error, reload } = useLoad(async () => {
    const { data: j, error: e } = await supabase.from('eng_jobs').select(ENG_SELECT).eq('id', id).single();
    if (e) throw new Error(e.message);
    const { data: u } = await supabase.from('eng_job_updates').select('*').eq('job_id', id).order('at', { ascending: false });
    const updates = (u ?? []) as EngUpdate[];
    const photos = await listAttachments('eng_job_update', updates.map((x) => x.id)).catch(() => [] as Attachment[]);
    return { job: j as EngJob, updates, photos };
  }, [id]);

  const [kind, setKind] = useState<UpdateKind | null>(null);
  const [u, setU] = useState({ note: '', work_stage: null as string | null, progress: null as number | null, qty: null as number | null, issues: '' });
  const [files, setFiles] = useState<PickedFile[]>([]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { job: j, updates, photos } = data;
  const mine = j.assignee_id === me.id;
  const st = ENG_STATUS[j.status];
  const install = j.job_type === 'installation';
  const verifiedVisit = updates.some((x) => x.kind === 'site_visit' && x.gps_verified);
  const updKind: UpdateKind = kind ?? (install ? 'progress' : 'inspection');

  const accept = () => dialog.run(async () => { await rpc('accept_eng_job', { p_id: j.id }); await reload(); }, 'Accepted – the Senior Electrical Engineer is told');

  const hold = async () => {
    const r = await dialog.prompt({
      title: 'Put the job on hold',
      message: 'The Senior Electrical Engineer reviews it: the hold is rejected (continue) or the work resumes with instructions, possibly with a new deadline.',
      fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }],
      confirmLabel: 'Put on hold',
    });
    if (r) await dialog.run(async () => { await rpc('hold_eng_job', { p_id: j.id, p_reason: r.r }); await reload(); }, 'On hold – sent for review');
  };

  const review = async () => {
    const r = await dialog.prompt({
      title: 'Review the hold',
      message: `${people[j.assignee_id]?.full_name ?? 'The engineer'}: ${j.hold_reason ?? ''}`,
      fields: [
        {
          key: 'd',
          label: 'Decision',
          type: 'select',
          required: true,
          options: [
            { value: 'reject', label: 'Reject the hold – continue the work' },
            { value: 'resume', label: 'Resume with instructions (after discussion)' },
          ],
        },
        { key: 'n', label: 'Instructions', type: 'multiline', required: true },
        { key: 'due', label: `New deadline (now ${fmtDate(j.due_date)}) – optional`, type: 'date' },
      ],
      confirmLabel: 'Send',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('review_eng_hold', { p_id: j.id, p_decision: r.d, p_note: r.n, p_new_due: r.due || null });
        await reload();
      }, 'Sent to the engineer');
  };

  const checkIn = () =>
    dialog.run(async () => {
      const pos = await captureLocation();
      if (!pos) throw new Error('Allow location access to mark the site visit');
      const res = await rpc<{ verified: boolean; distance_m: number; radius_m: number }>('eng_site_checkin', { p_id: j.id, p_lat: pos.lat, p_lng: pos.lng });
      await reload();
      if (!res.verified) throw new Error(`You are ${res.distance_m} m from the site location (allowed ${res.radius_m} m) – the visit is recorded as not verified.`);
    }, 'Site visit verified by GPS');

  const complete = async () => {
    if (!lead && !verifiedVisit) return dialog.toast('Mark your site visit first (GPS check-in at the site)', 'error');
    const r = await dialog.prompt({
      title: 'Complete the job',
      message: 'Add the final photos and documents under Job files before completing.',
      fields: [{ key: 'n', label: 'What was done', type: 'multiline', required: true }],
      confirmLabel: 'Complete',
    });
    if (r) await dialog.run(async () => { await rpc('complete_eng_job', { p_id: j.id, p_note: r.n }); await reload(); }, 'Completed – the Senior Electrical Engineer and SM Projects are told');
  };

  const addPhoto = async (camera: boolean) => {
    const f = camera ? await pickImage(true) : Platform.OS === 'web' ? await pickDocument() : await pickImage(false);
    if (f) setFiles((s) => [...s, f]);
  };

  const postUpdate = async () => {
    if (!u.note.trim()) return dialog.toast('Describe what was done', 'error');
    if (updKind === 'progress' && (!u.work_stage || u.progress == null)) return dialog.toast('Choose the installation stage and the progress %', 'error');
    await dialog.run(async () => {
      const uid = await rpc<string>('add_eng_update', {
        p_id: j.id,
        p: { kind: updKind, note: u.note, work_stage: updKind === 'progress' ? u.work_stage : '', progress: updKind === 'progress' ? u.progress : '', qty_installed: updKind === 'progress' ? (u.qty ?? '') : '', issues: u.issues },
      });
      for (const f of files) await uploadAttachment('eng_job_update', uid, 'job_photo', f);
      setU({ note: '', work_stage: null, progress: null, qty: null, issues: '' });
      setFiles([]);
      setKind(null);
      await reload();
    }, 'Update saved – the Senior Electrical Engineer is told');
  };

  const revise = async () => {
    const r = await dialog.prompt({
      title: 'Revise the deadline',
      fields: [
        { key: 'd', label: 'New deadline', type: 'date', required: true },
        { key: 'r', label: 'Reason', type: 'multiline', required: true },
      ],
    });
    if (r) await dialog.run(async () => { await rpc('set_eng_job_due', { p_id: j.id, p_due: r.d, p_reason: r.r }); await reload(); }, 'Deadline revised – the engineer is told');
  };

  const reassign = async () => {
    const { data: eng } = await supabase.from('profiles').select('id, full_name, role').in('role', ['assistant_engineer', 'senior_elec_engineer']).eq('active', true).order('full_name');
    const r = await dialog.prompt({
      title: 'Reassign the job',
      fields: [
        { key: 'p', label: 'Engineer', type: 'select', required: true, options: (eng ?? []).filter((x) => x.id !== j.assignee_id).map((x) => ({ value: x.id, label: x.full_name })) },
        { key: 'r', label: 'Reason', type: 'multiline', required: true },
      ],
    });
    if (r) await dialog.run(async () => { await rpc('reassign_eng_job', { p_id: j.id, p_person: r.p, p_reason: r.r }); await reload(); }, 'Reassigned – both engineers are told');
  };

  const cancel = async () => {
    const r = await dialog.prompt({ title: 'Cancel the job', fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Cancel job', danger: true });
    if (r) await dialog.run(async () => { await rpc('cancel_eng_job', { p_id: j.id, p_reason: r.r }); await reload(); }, 'Job cancelled');
  };

  const late = isOverdue(j);
  const daysLeft = daysBetween(todayISO(), j.due_date);

  return (
    <Screen maxWidth={900} onRefresh={reload}>
      <Stack.Screen options={{ title: j.code }} />
      <Card style={{ borderLeftWidth: 4, borderLeftColor: late ? colors.red : st.tone }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, flex: 1, minWidth: 220 }}>{j.title}</Text>
          <Row gap={6}>
            <Pill label={engTypeLabel(j.job_type)} />
            <Pill label={st.label} tone={st.tone} solid />
            {late ? <Pill label="Overdue" tone={colors.red} solid /> : null}
          </Row>
        </Row>
        <Muted>{[j.projects?.name, j.organizations?.name].filter(Boolean).join(' · ') || 'No project linked'}</Muted>
        <Row wrap gap={18} style={{ marginTop: 10 }}>
          <KeyValue label="Engineer" value={people[j.assignee_id]?.full_name ?? '—'} />
          <KeyValue label="Assigned by" value={`${people[j.assigned_by ?? '']?.full_name ?? '—'} · ${fmtDateTime(j.assigned_at)}`} />
          <KeyValue
            label="Deadline"
            value={`${fmtDate(j.due_date)}${isOpen(j) ? (late ? ` (${-daysLeft} days late)` : ` (in ${daysLeft} days)`) : ''}${j.original_due_date && j.original_due_date !== j.due_date ? ` · originally ${fmtDate(j.original_due_date)}` : ''}`}
          />
          <KeyValue label="Last site visit (GPS)" value={j.last_site_visit_at ? fmtDateTime(j.last_site_visit_at) : 'Not yet'} />
        </Row>
        <KeyValue label="Site" value={j.site_address ?? 'Not set – the Senior Electrical Engineer sets it with Edit details'} />
        {j.lat != null && j.lng != null ? (
          <Row>
            <Button small variant="ghost" title="Open the site in Maps" onPress={() => Linking.openURL(mapsLink(j.lat as number, j.lng as number))} />
          </Row>
        ) : null}
        {j.instructions ? <KeyValue label="Instructions" value={j.instructions} /> : null}
        {install ? (
          <>
            <Muted>{`Installation progress ${j.progress}%`}</Muted>
            <Progress pct={j.progress} colour={colors.blue} />
          </>
        ) : null}
        {j.status === 'on_hold' ? <Notice tone={colors.red}>{`On hold since ${fmtDateTime(j.hold_at)} – ${j.hold_reason ?? ''}. ${lead ? 'Review it: reject the hold or resume with instructions.' : 'Waiting for the Senior Electrical Engineer to review.'}`}</Notice> : null}
        {j.status === 'assigned' && mine ? <Notice tone={colors.amber}>Accept the job, or put it on hold with the reason.</Notice> : null}
        {j.status === 'done' ? <Notice tone={colors.green}>{`Completed ${fmtDateTime(j.done_at)} – ${j.done_note ?? ''}`}</Notice> : null}

        <Row wrap gap={6} style={{ marginTop: 10 }}>
          {mine && j.status === 'assigned' ? <Button title="Accept" onPress={accept} /> : null}
          {mine && (j.status === 'assigned' || j.status === 'in_progress') ? <Button variant="secondary" title="Put on hold" onPress={hold} /> : null}
          {mine && j.status === 'in_progress' ? <Button title="📍 Check in at site" onPress={checkIn} /> : null}
          {(mine || lead) && j.status === 'in_progress' ? <Button variant={mine ? 'secondary' : 'primary'} title={mine ? 'Complete' : 'Close as done'} onPress={complete} /> : null}
          {lead && j.status === 'on_hold' ? <Button title="Review the hold" onPress={review} /> : null}
          {lead && isOpen(j) ? (
            <>
              <Button variant="secondary" title="Revise deadline" onPress={revise} />
              <Button variant="secondary" title="Reassign" onPress={reassign} />
              <Button variant="secondary" title="Edit details" onPress={() => router.push({ pathname: '/engineering/new', params: { id: j.id } })} />
              <Button variant="ghost" title="Cancel job" onPress={cancel} />
            </>
          ) : null}
        </Row>
      </Card>

      {mine && j.status === 'in_progress' ? (
        <Section title="Add an update">
          <Card>
            <Segmented
              value={updKind}
              options={[
                ...(install ? [{ value: 'progress' as const, label: 'Installation progress' }] : []),
                { value: 'inspection', label: 'Inspection' },
                { value: 'activity', label: 'Activity' },
              ]}
              onChange={(v) => setKind(v)}
            />
            {updKind === 'progress' ? (
              <>
                <Select label="Installation stage" required value={u.work_stage} options={INSTALL_STAGES.map((s) => ({ value: s, label: s }))} onChange={(v) => setU({ ...u, work_stage: v })} />
                <Row wrap gap={8}>
                  <NumberField label="Overall progress" suffix="%" required value={u.progress} onChange={(v) => setU({ ...u, progress: v })} />
                  <NumberField label="Fixtures installed (this update)" value={u.qty} onChange={(v) => setU({ ...u, qty: v })} />
                </Row>
              </>
            ) : null}
            <Field
              label={updKind === 'progress' ? 'Work carried out' : updKind === 'inspection' ? 'Inspection findings' : 'Activity carried out'}
              required
              multiline
              value={u.note}
              onChangeText={(v) => setU({ ...u, note: v })}
            />
            <Field label="Issues / pending (materials, access, drawings, other trades)" multiline value={u.issues} onChangeText={(v) => setU({ ...u, issues: v })} />
            <Row wrap gap={6}>
              <Button small variant="secondary" title="+ Photo" onPress={() => dialog.run(() => addPhoto(false))} />
              {Platform.OS !== 'web' ? <Button small variant="secondary" title="📷 Take photo" onPress={() => dialog.run(() => addPhoto(true))} /> : null}
              {files.map((f, i) => (
                <Button key={`${f.name}-${i}`} small variant="ghost" title={`✕ ${f.name}`} onPress={() => setFiles(files.filter((_, k) => k !== i))} />
              ))}
            </Row>
            <Row style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <Button title="Save update" onPress={postUpdate} />
            </Row>
          </Card>
        </Section>
      ) : null}

      <Section title={`History (${updates.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {updates.map((x) => {
            const pics = photos.filter((p) => p.entity_id === x.id);
            const detail = [
              x.work_stage,
              x.progress != null ? `${x.progress}%` : null,
              x.qty_installed != null ? `${x.qty_installed} fixtures` : null,
              x.kind === 'site_visit' ? (x.gps_verified ? `✓ GPS verified (${x.distance_m} m)` : `✗ not at the site (${x.distance_m} m away)`) : null,
              x.note,
              x.issues ? `Issues: ${x.issues}` : null,
            ].filter(Boolean);
            return (
              <ListRow
                key={x.id}
                wrapRight
                highlight={x.kind === 'hold' ? colors.red : x.kind === 'site_visit' ? (x.gps_verified ? colors.green : colors.amber) : undefined}
                title={`${UPDATE_LABEL[x.kind] ?? x.kind} · ${people[x.by_id ?? '']?.full_name ?? ''}`}
                subtitle={`${fmtDateTime(x.at)}${detail.length ? ` · ${detail.join(' · ')}` : ''}`}
                right={
                  pics.length ? (
                    <Row wrap gap={4}>
                      {pics.map((p, i) => (
                        <Button key={p.id} small variant="secondary" title={`📷 ${i + 1}`} onPress={() => dialog.run(() => openAttachment(p))} />
                      ))}
                    </Row>
                  ) : undefined
                }
              />
            );
          })}
        </Card>
      </Section>

      <Attachments entityType="eng_job" entityId={j.id} kinds={['job_photo', 'job_doc']} title="Job files (photos, test sheets, handover documents)" allowCamera canUpload={(mine || lead) && j.status !== 'cancelled'} />
    </Screen>
  );
}
