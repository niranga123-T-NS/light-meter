// Submitted visit (server copy). Submitted visits stay in history; the
// salesperson can request a correction, which a manager approves.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { FormModal } from '@/components/FormModal';
import { TextField } from '@/components/form';
import { Badge, Banner, Body, Button, Card, EmptyState, KeyValue, ListItem, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { customerName, lookupLabel, profileName } from '@/lib/cache';
import { notify } from '@/lib/dialog';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { mapsUrl } from '@/lib/location';
import { getItem } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { Action, Attachment, Visit } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function VisitView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, isManager } = useSession();
  const [correcting, setCorrecting] = useState(false);
  const [changes, setChanges] = useState<{ summary?: string; outcome?: string; purpose?: string; commitments?: string }>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, error, loading, reload } = useAsync(async () => {
    const [visit, contacts, projects, actions, attachments, corrections] = await Promise.all([
      supabase.from('visits').select('*').eq('id', id).maybeSingle(),
      supabase.from('visit_contacts').select('contact:contacts(id,full_name,designation)').eq('visit_id', id),
      supabase.from('visit_projects').select('project:projects(id,code,name)').eq('visit_id', id),
      supabase.from('actions').select('*').eq('visit_id', id).order('created_at'),
      supabase.from('attachments').select('*').eq('entity_type', 'visit').eq('entity_id', id).is('deleted_at', null),
      supabase.from('correction_requests').select('*').eq('visit_id', id).order('requested_at', { ascending: false }),
    ]);
    return {
      visit: unwrap(visit) as Visit | null,
      contacts: (unwrap(contacts) as unknown as { contact: { id: string; full_name: string; designation: string | null } }[]).map((r) => r.contact),
      projects: (unwrap(projects) as unknown as { project: { id: string; code: string; name: string } }[]).map((r) => r.project),
      actions: unwrap(actions) as Action[],
      attachments: unwrap(attachments) as Attachment[],
      corrections: unwrap(corrections) as { id: string; status: string; reason: string; requested_at: string; review_note: string | null }[],
    };
  }, [id]);

  if (loading && !data) return <Loading />;
  const local = getItem(id);
  if (!data?.visit) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Visit' }} />
        {error ? <Banner tone="warning" message={`Offline or not available: ${error}`} /> : null}
        {local ? (
          <Card>
            <Body>{customerName(local.payload.visit.customer_id)}</Body>
            <Muted>Submitted from this device {fmtDateTime(local.syncedAt ?? local.updatedAt)} · {local.serverCode ?? ''}</Muted>
            <KeyValue label="Summary" value={local.payload.visit.summary} />
          </Card>
        ) : <EmptyState title="Visit not found" />}
      </Screen>
    );
  }
  const v = data.visit;
  const own = v.salesperson_id === profile?.id;

  const openAttachment = async (a: Attachment) => {
    const res = await supabase.storage.from('attachments').createSignedUrl(a.storage_path, 300);
    if (res.data?.signedUrl) void Linking.openURL(res.data.signedUrl);
    else notify('Could not open file', errorMessage(res.error));
  };

  const requestCorrection = async () => {
    setSaving(true);
    const cleaned = Object.fromEntries(Object.entries(changes).filter(([, val]) => val !== undefined));
    const { error: err } = await supabase.from('correction_requests').insert({ visit_id: v.id, reason, changes: cleaned, requested_by: profile!.id });
    setSaving(false);
    if (err) return notify('Could not send', errorMessage(err));
    setCorrecting(false);
    notify('Correction requested', 'Your manager will review it. The original stays in the history.');
    void reload();
  };

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: v.code ?? 'Visit' }} />
      <Card>
        <Body style={{ fontWeight: '700', fontSize: 17 }} >{customerName(v.customer_id)}</Body>
        <Badge label={v.status ?? ''} tone={v.status === 'submitted' ? 'success' : 'neutral'} />
        <KeyValue label="Salesperson" value={profileName(v.salesperson_id)} />
        <KeyValue label="Type" value={lookupLabel('visit_type', v.visit_type)} />
        <KeyValue label="Date" value={fmtDate(v.visit_date)} />
        <KeyValue label="Check in / out" value={`${fmtDateTime(v.check_in_at)} → ${fmtDateTime(v.check_out_at)}`} />
        {v.duration_minutes ? <KeyValue label="Duration" value={`${v.duration_minutes} min`} /> : null}
        <KeyValue label="Location" value={v.is_remote ? 'Remote' : v.check_in_lat != null ? `${v.check_in_lat.toFixed(5)}, ${v.check_in_lng!.toFixed(5)} (±${Math.round(v.check_in_accuracy_m ?? 0)} m)` : lookupLabel('location_unavailable_reason', v.location_unavailable_reason)}
          onPress={v.check_in_lat != null ? () => Linking.openURL(mapsUrl(v.check_in_lat!, v.check_in_lng!)) : undefined} />
        <KeyValue label="Meeting place" value={v.meeting_place} />
        <KeyValue label="Submitted" value={fmtDateTime(v.submitted_at)} />
      </Card>
      <SectionTitle>People met</SectionTitle>
      <Card>
        {data.contacts.length ? data.contacts.map((c) => (
          <ListItem key={c.id} title={c.full_name} subtitle={c.designation} onPress={() => router.push(`/contact/${c.id}`)} />
        )) : <Muted>{lookupLabel('contact_unavailable_reason', v.contact_unavailable_reason)}</Muted>}
      </Card>
      {data.projects.length ? (
        <>
          <SectionTitle>Projects</SectionTitle>
          <Card style={{ padding: 0 }}>
            {data.projects.map((p) => <ListItem key={p.id} title={p.name} subtitle={p.code} onPress={() => router.push(`/project/${p.id}`)} />)}
          </Card>
        </>
      ) : null}
      <SectionTitle>Discussion</SectionTitle>
      <Card>
        <KeyValue label="Purpose" value={v.purpose} />
        <KeyValue label="Products discussed" value={v.products_discussed} />
        <KeyValue label="Requirements" value={v.requirements} />
        <KeyValue label="Pain points" value={v.pain_points} />
        <KeyValue label="Decision process" value={v.decision_process} />
        <KeyValue label="Budget" value={[v.budget_indication, lookupLabel('budget_status', v.funding_status)].filter((x) => x && x !== '–').join(' · ')} />
        <KeyValue label="Timeline" value={v.purchase_timeline} />
      </Card>
      <SectionTitle>Commercial signal</SectionTitle>
      <Card>
        <KeyValue label="Estimated value" value={fmtMoney(v.estimated_value, v.currency)} />
        <KeyValue label="Confidence" value={v.confidence} />
        <KeyValue label="Competitor / incumbent" value={[v.competitor, v.incumbent].filter(Boolean).join(' / ')} />
        <KeyValue label="Specification" value={lookupLabel('spec_status', v.spec_position)} />
        <KeyValue label="Differentiator" value={v.differentiator} />
        <KeyValue label="Risks" value={v.risks} />
      </Card>
      <SectionTitle>Outcome</SectionTitle>
      <Card>
        <KeyValue label="Outcome" value={lookupLabel('visit_outcome', v.outcome)} />
        <KeyValue label="Summary" value={v.summary} />
        <KeyValue label="Commitments" value={v.commitments} />
        <KeyValue label="Documents shared" value={v.documents_shared} />
        <KeyValue label="Documents requested" value={v.documents_requested} />
        <KeyValue label="Next meeting" value={fmtDateTime(v.next_meeting_at)} />
        {v.no_followup_reason ? <KeyValue label="No follow-up" value={lookupLabel('no_followup_reason', v.no_followup_reason)} /> : null}
      </Card>
      <SectionTitle>Actions</SectionTitle>
      <Card style={{ padding: 0 }}>
        {data.actions.length ? data.actions.map((a) => (
          <ListItem key={a.id} title={a.description} subtitle={`${profileName(a.owner_id)} · due ${fmtDate(a.due_date)}`}
            right={<Badge label={a.status ?? ''} tone={a.status === 'done' ? 'success' : 'warning'} />} onPress={() => router.push(`/action/${a.id}`)} />
        )) : <Muted style={{ padding: 16 }}>No actions</Muted>}
      </Card>
      {data.attachments.length ? (
        <>
          <SectionTitle>Attachments</SectionTitle>
          <Card style={{ padding: 0 }}>
            {data.attachments.map((a) => <ListItem key={a.id} title={a.filename} subtitle={a.mime_type} onPress={() => openAttachment(a)} />)}
          </Card>
        </>
      ) : null}
      {data.corrections.length ? (
        <>
          <SectionTitle>Correction requests</SectionTitle>
          <Card>
            {data.corrections.map((c) => (
              <View key={c.id} style={{ gap: 2 }}>
                <Badge label={c.status} tone={c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'warning'} />
                <Muted>{fmtDateTime(c.requested_at)} – {c.reason}{c.review_note ? ` · Manager: ${c.review_note}` : ''}</Muted>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      {own && v.status === 'submitted' ? (
        <Button variant="secondary" title="Request a correction" onPress={() => { setChanges({}); setReason(''); setCorrecting(true); }} />
      ) : null}
      {isManager ? <Button variant="ghost" title="Review corrections" onPress={() => router.push('/corrections')} /> : null}

      <FormModal visible={correcting} title="Request correction" onClose={() => setCorrecting(false)} onSave={requestCorrection}
        saving={saving} saveLabel="Send" saveDisabled={!reason.trim() || Object.keys(changes).length === 0}>
        <Muted>Only fill the fields that need to change. A manager approves the change; the original is kept in the audit history.</Muted>
        <TextField label="Reason" required value={reason} onChange={setReason} multiline />
        <TextField label="Corrected purpose" value={changes.purpose ?? ''} onChange={(t) => setChanges({ ...changes, purpose: t || undefined })} multiline />
        <TextField label="Corrected summary" value={changes.summary ?? ''} onChange={(t) => setChanges({ ...changes, summary: t || undefined })} multiline />
        <TextField label="Corrected commitments" value={changes.commitments ?? ''} onChange={(t) => setChanges({ ...changes, commitments: t || undefined })} multiline />
      </FormModal>
    </Screen>
  );
}
