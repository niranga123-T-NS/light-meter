import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { DateField, SegmentField, SelectField, SwitchField, TextField } from '@/components/form';
import { Badge, Banner, Body, Button, Card, KeyValue, Loading, Screen } from '@/components/ui';
import { cacheStore, customerName, profileName, removeCached, upsertCached } from '@/lib/cache';
import { notify } from '@/lib/dialog';
import { fmtDateTime, relativeDue } from '@/lib/format';
import { scheduleActionReminders } from '@/lib/notifications';
import { ACTION_STATUS_OPTIONS, PRIORITY_OPTIONS, userOptions } from '@/lib/options';
import { fetchOne, saveRecord } from '@/lib/records';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/supabase';
import type { Action } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function ActionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cached = cacheStore.get().myActions.find((a) => a.id === id);
  const { data, loading, error } = useAsync(() => fetchOne<Action>('actions', id), [id]);
  if (loading && !data && !cached) return <Loading />;
  const a = data ?? cached;
  if (!a) return <Screen><Banner tone="danger" message={error ?? 'Action not found'} /></Screen>;
  return <ActionForm key={a.version ?? 0} initial={a} offline={!data} />;
}

function ActionForm({ initial, offline }: { initial: Action; offline: boolean }) {
  const { profile, isManager } = useSession();
  const [a, setA] = useState<Action>(initial);
  const [saving, setSaving] = useState(false);
  const canEdit = isManager || a.owner_id === profile?.id || a.created_by === profile?.id;
  const set = (patch: Partial<Action>) => setA({ ...a, ...patch });
  const due = relativeDue(a.due_date);

  const save = async (patch: Partial<Action> = {}) => {
    setSaving(true);
    try {
      const saved = await saveRecord('actions', { ...a, ...patch }, false);
      if (saved.status === 'open' || saved.status === 'in_progress') upsertCached('myActions', saved);
      else removeCached('myActions', saved.id);
      void scheduleActionReminders(cacheStore.get().myActions);
      router.back();
    } catch (e) {
      notify('Not saved', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen footer={canEdit ? (
      <>
        {a.status !== 'done' ? <Button style={{ flex: 1 }} variant="secondary" title="Mark done" onPress={() => save({ status: 'done' })} loading={saving} /> : null}
        <Button style={{ flex: 1 }} title="Save" onPress={() => save()} loading={saving} />
      </>
    ) : undefined}>
      <Stack.Screen options={{ title: a.code ?? 'Action' }} />
      {offline ? <Banner tone="warning" message="Offline – changes to actions need a connection." /> : null}
      <Card>
        <Body style={{ fontWeight: '700' }}>{initial.description}</Body>
        <Badge label={due.label} tone={due.overdue ? 'danger' : 'neutral'} />
        {a.customer_id ? <KeyValue label="Customer" value={customerName(a.customer_id)} onPress={() => router.push(`/customer/${a.customer_id}`)} /> : null}
        {a.project_id ? <KeyValue label="Project" value={cacheStore.get().projects.find((p) => p.id === a.project_id)?.name ?? 'Open project'} onPress={() => router.push(`/project/${a.project_id}`)} /> : null}
        {a.visit_id ? <KeyValue label="From visit" value="Open visit" onPress={() => router.push(`/visit/view/${a.visit_id}`)} /> : null}
        <KeyValue label="Created" value={`${fmtDateTime(a.created_at)} by ${profileName(a.created_by)}`} />
        {a.completed_at ? <KeyValue label="Completed" value={fmtDateTime(a.completed_at)} /> : null}
        {a.escalated ? <KeyValue label="Escalated to" value={`${profileName(a.escalated_to)}${a.escalation_note ? ` – ${a.escalation_note}` : ''}`} /> : null}
      </Card>
      {canEdit ? (
        <Card>
          <TextField label="Description" multiline value={a.description} onChange={(t) => set({ description: t })} />
          <SelectField label="Status" value={a.status} options={ACTION_STATUS_OPTIONS} allowClear={false} onChange={(x) => set({ status: (x ?? 'open') as Action['status'] })} />
          <TextField label="Result / outcome" multiline value={a.result} onChange={(t) => set({ result: t })} />
          <DateField label="Due date" value={a.due_date} onChange={(d) => set({ due_date: d })} />
          <SegmentField label="Priority" value={a.priority} options={PRIORITY_OPTIONS} onChange={(x) => set({ priority: (x ?? 'normal') as Action['priority'] })} />
          <SelectField label="Owner" value={a.owner_id} options={userOptions()} allowClear={false} onChange={(x) => set({ owner_id: x ?? a.owner_id })} />
          <SwitchField label="Escalate to a manager" value={a.escalated} onChange={(x) => set({ escalated: x })} />
          {a.escalated ? (
            <>
              <SelectField label="Escalate to" value={a.escalated_to} options={userOptions(['manager', 'admin'])} onChange={(x) => set({ escalated_to: x })} />
              <TextField label="Escalation note" value={a.escalation_note} onChange={(t) => set({ escalation_note: t })} />
            </>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
