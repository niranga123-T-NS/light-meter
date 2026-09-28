// New follow-up action on a customer, project or package (online).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { DateField, SegmentField, SelectField, TextField } from '@/components/form';
import { Banner, Button, Card, Screen } from '@/components/ui';
import { upsertCached } from '@/lib/cache';
import { newId } from '@/lib/ids';
import { PRIORITY_OPTIONS, customerOptions, opportunityOptions, projectOptions, userOptions } from '@/lib/options';
import { saveRecord } from '@/lib/records';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/supabase';
import type { Action } from '@/lib/types';

export default function NewAction() {
  const params = useLocalSearchParams<{ customerId?: string; projectId?: string; opportunityId?: string }>();
  const { profile } = useSession();
  const [a, setA] = useState<Action>({
    id: newId(), description: '', owner_id: profile!.id, priority: 'normal', status: 'open',
    customer_id: params.customerId || null, project_id: params.projectId || null, opportunity_id: params.opportunityId || null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Action>) => setA({ ...a, ...patch });

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveRecord('actions', a, true);
      if (saved.owner_id === profile!.id) upsertCached('myActions', saved);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen footer={<Button style={{ flex: 1 }} title="Create action" onPress={save} loading={saving}
      disabled={!a.description.trim() || (!a.customer_id && !a.project_id && !a.opportunity_id)} />}>
      <Stack.Screen options={{ title: 'New action' }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Card>
        <TextField label="What needs to happen" required multiline value={a.description} onChange={(t) => set({ description: t })} />
        <SelectField label="Customer" value={a.customer_id} options={customerOptions()} onChange={(x) => set({ customer_id: x })} />
        <SelectField label="Project" value={a.project_id} options={projectOptions(a.customer_id)} onChange={(x) => set({ project_id: x })} />
        <SelectField label="Package" value={a.opportunity_id} options={opportunityOptions(a.project_id ? [a.project_id] : undefined)} onChange={(x) => set({ opportunity_id: x })} />
        <DateField label="Due date" value={a.due_date} onChange={(d) => set({ due_date: d })} />
        <SelectField label="Owner" value={a.owner_id} options={userOptions()} allowClear={false} onChange={(x) => set({ owner_id: x ?? profile!.id })} />
        <SegmentField label="Priority" value={a.priority} options={PRIORITY_OPTIONS} onChange={(x) => set({ priority: (x ?? 'normal') as Action['priority'] })} />
      </Card>
    </Screen>
  );
}
