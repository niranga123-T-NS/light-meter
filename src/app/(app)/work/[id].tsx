// One design / estimation request: details, progress buttons for the team,
// revision history, notes, files and the full timeline.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { AttachmentList } from '@/components/AttachmentList';
import { FormModal } from '@/components/FormModal';
import { DateField, SelectField, TextField } from '@/components/form';
import { Badge, Banner, Body, Button, Card, KeyValue, ListItem, Loading, Muted, Row, Screen, SectionTitle } from '@/components/ui';
import { cacheStore, lookupLabel, profileName, upsertCached } from '@/lib/cache';
import { confirm, notify } from '@/lib/dialog';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { userOptions } from '@/lib/options';
import { saveRecord } from '@/lib/records';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { WorkEvent, WorkRequest } from '@/lib/types';
import { useAsync, useRefreshOnFocus } from '@/lib/useAsync';
import { eventText, kindLabel, turnaroundDays, workState } from '@/lib/work';

export default function WorkDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, isManager, teamKind, canSell } = useSession();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState<{ note: string; link: string } | null>(null);
  const [dueEdit, setDueEdit] = useState<{ due: string | null; reason: string } | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const w = unwrap(await supabase.from('work_requests').select('*').eq('id', id).maybeSingle()) as WorkRequest | null;
    if (!w) return null;
    const [events, related] = await Promise.all([
      supabase.from('work_request_events').select('*').eq('request_id', id).order('created_at'),
      supabase.from('work_requests').select('*').eq('opportunity_id', w.opportunity_id).eq('kind', w.kind).order('revision'),
    ]);
    upsertCached('workRequests', w);
    return { w, events: unwrap(events) as WorkEvent[], related: unwrap(related) as WorkRequest[] };
  }, [id]);
  useRefreshOnFocus(reload);

  if (loading && !data) return <Loading />;
  if (!data) return <Screen><Banner tone="danger" message={error ?? 'Request not found'} /></Screen>;
  const { w, events, related } = data;
  const st = workState(w);
  const onTeam = isManager || teamKind === w.kind;
  const isRequester = w.requested_by === profile?.id;
  const opp = cacheStore.get().opportunities.find((o) => o.id === w.opportunity_id);
  const proj = cacheStore.get().projects.find((p) => p.id === w.project_id);
  const t = turnaroundDays(w);
  const teamRole = w.kind === 'design' ? 'designer' : 'estimator';

  const update = async (patch: Partial<WorkRequest>) => {
    setBusy(true);
    try {
      const saved = await saveRecord('work_requests', { ...w, ...patch }, false, ['project_id', 'revision', 'completed_late', 'started_at', 'received_at']);
      upsertCached('workRequests', saved);
      await reload();
      return true;
    } catch (e) {
      notify('Not saved', errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (text: string) => {
    const { error: err } = await supabase.from('work_request_events').insert({ request_id: w.id, event: 'note', note: text, created_by: profile!.id });
    if (err) return notify('Note not saved', errorMessage(err));
    setNote('');
    void reload();
  };

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: w.code ?? kindLabel(w.kind) }} />
      <Card>
        <Row wrap>
          <Badge label={kindLabel(w.kind)} tone="primary" />
          {w.revision ? <Badge label={`Revision ${w.revision}`} tone="warning" /> : null}
          <Badge label={st.label} tone={st.tone} />
          {w.priority && w.priority !== 'normal' ? <Badge label={w.priority} tone={w.priority === 'urgent' ? 'danger' : 'neutral'} /> : null}
        </Row>
        <Body style={{ fontWeight: '700', fontSize: 17 }}>{w.title}</Body>
        {w.description ? <Body>{w.description}</Body> : null}
        <KeyValue label="Project" value={proj?.name} onPress={w.project_id ? () => router.push(`/project/${w.project_id}`) : undefined} />
        <KeyValue label="Package" value={opp?.name} onPress={() => router.push(`/opportunity/${w.opportunity_id}`)} />
        <KeyValue label="Type" value={lookupLabel(w.kind === 'design' ? 'design_task_type' : 'estimation_task_type', w.task_type)} />
        <KeyValue label="Requested by" value={profileName(w.requested_by)} />
        <KeyValue label="Assigned to" value={w.assigned_to ? profileName(w.assigned_to) : 'Unassigned'} />
        <KeyValue label="Received" value={fmtDateTime(w.received_at)} />
        <KeyValue label="Due" value={fmtDate(w.due_date)} />
        <KeyValue label="Started" value={fmtDateTime(w.started_at)} />
        <KeyValue label="Submitted" value={w.completed_at ? `${fmtDateTime(w.completed_at)}${w.completed_late ? ' (late)' : ' (on time)'}` : '–'} />
        {t !== null ? <KeyValue label={w.completed_at ? 'Turnaround' : 'Open for'} value={`${t} days`} /> : null}
        {w.revision ? (
          <>
            <KeyValue label="Revision reason" value={lookupLabel('revision_reason', w.revision_reason)} />
            <KeyValue label="Client feedback" value={w.client_feedback} />
          </>
        ) : null}
        {w.deliverable_note ? <KeyValue label="Delivered" value={w.deliverable_note} /> : null}
        {w.deliverable_link ? <KeyValue label="Link" value={w.deliverable_link} onPress={() => Linking.openURL(w.deliverable_link!)} /> : null}
      </Card>
      {st.late ? <Banner tone="danger" message={`This ${kindLabel(w.kind).toLowerCase()} request is ${st.daysLate} day(s) late. The team and managers are alerted daily until it is submitted.`} /> : null}

      {onTeam && w.status !== 'cancelled' ? (
        <Card>
          <SectionTitle>Update progress</SectionTitle>
          <Row wrap>
            {w.assigned_to !== profile?.id ? <Button small title="Assign to me" loading={busy} onPress={() => update({ assigned_to: profile!.id })} /> : null}
            {w.status === 'new' || w.status === 'on_hold' ? <Button small title={w.status === 'on_hold' ? 'Resume' : 'Start work'} loading={busy}
              onPress={() => update({ status: 'in_progress', assigned_to: w.assigned_to ?? profile!.id })} /> : null}
            {w.status === 'in_progress' ? <Button small variant="secondary" title="Put on hold" loading={busy} onPress={() => update({ status: 'on_hold' })} /> : null}
            {w.status === 'new' || w.status === 'in_progress' || w.status === 'on_hold' ? (
              <Button small title="Submit to sales ✓" loading={busy} onPress={() => setSubmitting({ note: w.deliverable_note ?? '', link: w.deliverable_link ?? '' })} />
            ) : null}
            {w.status === 'submitted' ? <Button small variant="secondary" title="Reopen" loading={busy} onPress={() => update({ status: 'in_progress' })} /> : null}
            <Button small variant="ghost" title="Change due date" onPress={() => setDueEdit({ due: w.due_date ?? null, reason: '' })} />
          </Row>
          <SelectField label="Assigned to" value={w.assigned_to} options={userOptions([teamRole, 'manager'])}
            onChange={(x) => void update({ assigned_to: x })} placeholder="Unassigned" />
        </Card>
      ) : null}

      {isRequester && w.status === 'new' && !onTeam ? (
        <Button variant="danger" title="Cancel this request" onPress={async () => {
          if (await confirm('Cancel request?', 'The team will stop working on it.', 'Cancel request', true)) await update({ status: 'cancelled' });
        }} />
      ) : null}
      {(canSell || isManager) && w.status === 'submitted' && related[related.length - 1]?.id === w.id ? (
        <Button variant="secondary" title={`↻ Request ${kindLabel(w.kind).toLowerCase()} revision (client feedback)`}
          onPress={() => router.push({ pathname: '/work/new', params: { opportunityId: w.opportunity_id, parentId: w.id } })} />
      ) : null}

      {related.length > 1 ? (
        <>
          <SectionTitle>Revision history</SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {related.map((r) => {
              const s = workState(r);
              return (
                <ListItem key={r.id} title={`Rev ${r.revision ?? 0}: ${r.title}`}
                  subtitle={r.revision ? r.client_feedback ?? lookupLabel('revision_reason', r.revision_reason) : 'Original request'}
                  meta={`${fmtDate(r.received_at)} → ${r.completed_at ? fmtDate(r.completed_at) : 'open'}`}
                  right={<Badge label={r.id === w.id ? 'This' : s.label} tone={r.id === w.id ? 'primary' : s.tone} />}
                  onPress={r.id === w.id ? undefined : () => router.push(`/work/${r.id}`)} />
              );
            })}
          </Card>
        </>
      ) : null}

      <SectionTitle>Timeline</SectionTitle>
      <Card>
        {events.map((e) => (
          <View key={e.id} style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ width: 10, alignItems: 'center' }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, marginTop: 5, backgroundColor: e.event === 'submitted' ? '#2E7D32' : e.event === 'note' ? '#97A3B1' : '#0B4F8A' }} />
            </View>
            <View style={{ flex: 1, paddingBottom: 6 }}>
              <Body>{eventText(e, profileName)}</Body>
              {e.note ? <Muted>{e.note}</Muted> : null}
              <Muted style={{ fontSize: 11 }}>{fmtDateTime(e.created_at)} · {profileName(e.created_by)}</Muted>
            </View>
          </View>
        ))}
        <TextField label="Add a note" value={note} onChange={setNote} multiline />
        <Button small title="Add note" disabled={!note.trim()} onPress={() => addNote(note.trim())} />
      </Card>
      <AttachmentList entityType="work_request" entityId={w.id} />

      <FormModal visible={!!submitting} title="Submit to sales" onClose={() => setSubmitting(null)} saving={busy}
        onSave={async () => {
          if (await update({ status: 'submitted', deliverable_note: submitting!.note || null, deliverable_link: submitting!.link || null })) setSubmitting(null);
        }}>
        {submitting ? (
          <>
            <Muted>The salesperson sees this straight away. Attach files below the timeline, or add a link.</Muted>
            <TextField label="What was delivered" multiline value={submitting.note} onChange={(t2) => setSubmitting({ ...submitting, note: t2 })}
              placeholder="e.g. Lighting layout rev 1 + DIALux report" />
            <TextField label="Link (SharePoint / drive)" value={submitting.link} autoCapitalize="none" onChange={(t2) => setSubmitting({ ...submitting, link: t2 })} />
          </>
        ) : null}
      </FormModal>
      <FormModal visible={!!dueEdit} title="Change due date" onClose={() => setDueEdit(null)} saving={busy} saveDisabled={!dueEdit?.reason.trim()}
        onSave={async () => {
          if (await update({ due_date: dueEdit!.due })) {
            await addNote(`Due date changed: ${dueEdit!.reason}`);
            setDueEdit(null);
          }
        }}>
        {dueEdit ? (
          <>
            <DateField label="New due date" value={dueEdit.due} onChange={(d) => setDueEdit({ ...dueEdit, due: d })} />
            <TextField label="Reason" required multiline value={dueEdit.reason} onChange={(r) => setDueEdit({ ...dueEdit, reason: r })} />
          </>
        ) : null}
      </FormModal>
    </Screen>
  );
}
