// New design / estimation request, or a revision request based on a submitted
// design / offer and the client's feedback.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { DateField, SegmentField, SelectField, TextField } from '@/components/form';
import { Banner, Button, Card, Loading, Muted, Screen } from '@/components/ui';
import { cacheStore, setting, upsertCached, useLookup } from '@/lib/cache';
import { addDaysIso, fmtDate, todayIso } from '@/lib/format';
import { newId } from '@/lib/ids';
import { PRIORITY_OPTIONS, WORK_KIND_OPTIONS, opportunityOptions, userOptions } from '@/lib/options';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { Quotation, WorkKind, WorkRequest } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';
import { kindLabel } from '@/lib/work';

export default function NewWork() {
  const params = useLocalSearchParams<{ opportunityId?: string; kind?: WorkKind; parentId?: string }>();
  const { data, loading } = useAsync(async () => {
    const parent = params.parentId
      ? (unwrap(await supabase.from('work_requests').select('*').eq('id', params.parentId).maybeSingle()) as WorkRequest | null)
      : null;
    const oppId = parent?.opportunity_id ?? params.opportunityId;
    const quotes = oppId
      ? (unwrap(await supabase.from('quotations').select('*').eq('opportunity_id', oppId).order('revision', { ascending: false })) as Quotation[])
      : [];
    return { parent, quotes };
  }, [params.parentId, params.opportunityId]);
  if (loading) return <Loading />;
  return <WorkForm parent={data?.parent ?? null} quotes={data?.quotes ?? []} opportunityId={params.opportunityId} kind={params.kind} />;
}

function WorkForm({ parent, quotes, opportunityId, kind }: { parent: WorkRequest | null; quotes: Quotation[]; opportunityId?: string; kind?: WorkKind }) {
  const { profile } = useSession();
  const reasons = useLookup('revision_reason');
  const [w, setW] = useState<WorkRequest>(() => parent ? {
    id: newId(), kind: parent.kind, opportunity_id: parent.opportunity_id, parent_request_id: parent.id,
    title: `${parent.title.replace(/ – Rev \d+$/, '')} – Rev ${(parent.revision ?? 0) + 1}`, task_type: parent.task_type,
    priority: 'high', assigned_to: parent.assigned_to, revision_reason: 'client_feedback',
  } : { id: newId(), kind: kind ?? 'design', opportunity_id: opportunityId ?? '', title: '', priority: 'normal' });
  const [received, setReceived] = useState<string | null>(todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taskTypes = useLookup(w.kind === 'design' ? 'design_task_type' : 'estimation_task_type');
  const set = (patch: Partial<WorkRequest>) => setW({ ...w, ...patch });
  const sla = Number(setting(`${w.kind}_sla_days`, w.kind === 'design' ? 5 : 3));
  const opp = cacheStore.get().opportunities.find((o) => o.id === w.opportunity_id);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const receivedAt = received && received !== todayIso() ? new Date(`${received}T03:30:00Z`).toISOString() : new Date().toISOString();
      const row = { ...w, received_at: receivedAt, requested_by: profile!.id, status: 'new' };
      const saved = unwrap(await supabase.from('work_requests').insert(row).select().single()) as WorkRequest;
      upsertCached('workRequests', saved);
      router.replace(`/work/${saved.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const valid = !!w.title.trim() && !!w.opportunity_id && (!parent || !!w.client_feedback?.trim());
  return (
    <Screen footer={<Button style={{ flex: 1 }} title={parent ? 'Send revision request' : 'Send request'} onPress={save} loading={saving} disabled={!valid} />}>
      <Stack.Screen options={{ title: parent ? `${kindLabel(w.kind)} revision` : 'New request' }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      {parent ? (
        <Banner tone="info" message={`Revision ${(parent.revision ?? 0) + 1} of ${parent.code}: “${parent.title}” – submitted ${fmtDate(parent.completed_at)}. It goes back to the same ${kindLabel(parent.kind).toLowerCase()} team member.`} />
      ) : null}
      <Card>
        {!parent ? (
          <>
            <SegmentField label="Team" required value={w.kind} options={WORK_KIND_OPTIONS} onChange={(x) => set({ kind: (x ?? 'design') as WorkKind, task_type: null, assigned_to: null })} />
            <SelectField label="Package / bid" required value={w.opportunity_id} options={opportunityOptions()} onChange={(x) => set({ opportunity_id: x ?? '' })}
              hint={opp ? `Inquiry received ${fmtDate(opp.inquiry_received_at)}` : undefined} />
            <SelectField label="Type of work" value={w.task_type} options={taskTypes} onChange={(x) => set({ task_type: x })} />
          </>
        ) : null}
        <TextField label="Title" required value={w.title} onChange={(t) => set({ title: t })} placeholder="e.g. Lobby lighting layout" />
        {parent ? (
          <>
            <SelectField label="Reason for revision" value={w.revision_reason} options={reasons} onChange={(x) => set({ revision_reason: x })} />
            <TextField label="Client feedback" required multiline value={w.client_feedback} onChange={(t) => set({ client_feedback: t })}
              placeholder="What did the client / consultant ask to change?" />
            {w.kind === 'estimation' && quotes.length ? (
              <SelectField label="Based on quotation" value={w.quotation_id} onChange={(x) => set({ quotation_id: x })}
                options={quotes.map((q) => ({ value: q.id, label: `${q.reference} rev ${q.revision}`, subtitle: `${q.status} · ${fmtDate(q.submission_date)}` }))} />
            ) : null}
          </>
        ) : null}
        <TextField label="Details / brief" multiline value={w.description} onChange={(t) => set({ description: t })}
          placeholder="Drawings received, lux levels, brands, quantities, deadline from client…" />
        <DateField label="Inquiry / request received" value={received} onChange={setReceived} quick={false} />
        <DateField label="Required by" value={w.due_date} onChange={(d) => set({ due_date: d })}
          hint={`Leave empty for the standard ${sla} days (${fmtDate(addDaysIso(received ?? todayIso(), sla))})`} />
        <SegmentField label="Priority" value={w.priority} options={PRIORITY_OPTIONS} onChange={(x) => set({ priority: (x ?? 'normal') as WorkRequest['priority'] })} />
        <SelectField label="Assign to" value={w.assigned_to} options={userOptions([w.kind === 'design' ? 'designer' : 'estimator'])}
          onChange={(x) => set({ assigned_to: x })} placeholder="Team queue (unassigned)" />
        <Muted>Attach drawings, BOQs or the client’s comments on the next screen.</Muted>
      </Card>
    </Screen>
  );
}
