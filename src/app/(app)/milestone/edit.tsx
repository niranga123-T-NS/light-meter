import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { DateField, NumberField, SelectField, TextField } from '@/components/form';
import { Banner, Button, Card, Loading, Screen } from '@/components/ui';
import { cacheStore, useLookup } from '@/lib/cache';
import { newId } from '@/lib/ids';
import { MILESTONE_STATUS_OPTIONS, opportunityOptions, userOptions } from '@/lib/options';
import { fetchOne, saveRecord } from '@/lib/records';
import { errorMessage } from '@/lib/supabase';
import type { Milestone } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function EditMilestone() {
  const { id, projectId } = useLocalSearchParams<{ id?: string; projectId?: string }>();
  const { data, loading, error } = useAsync(() => (id ? fetchOne<Milestone>('project_milestones', id) : Promise.resolve(null)), [id]);
  if (id && loading) return <Loading />;
  if (id && !data) return <Screen><Banner tone="danger" message={error ?? 'Not found'} /></Screen>;
  return <MilestoneForm isNew={!id} initial={data ?? { id: newId(), project_id: projectId ?? '', kind: 'design', title: '', status: 'pending', revision: 0 }} />;
}

function MilestoneForm({ initial, isNew }: { initial: Milestone; isNew: boolean }) {
  const [m, setM] = useState<Milestone>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kinds = useLookup('milestone_kind');
  const set = (patch: Partial<Milestone>) => setM({ ...m, ...patch });
  const project = cacheStore.get().projects.find((p) => p.id === m.project_id);

  const save = async () => {
    setSaving(true);
    try {
      await saveRecord('project_milestones', m, isNew);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen footer={<Button style={{ flex: 1 }} title="Save milestone" onPress={save} loading={saving} disabled={!m.title.trim()} />}>
      <Stack.Screen options={{ title: project ? `Milestone – ${project.name}` : 'Milestone' }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Card>
        <SelectField label="Type" required value={m.kind} options={kinds} allowClear={false} onChange={(x) => set({ kind: x ?? m.kind })} />
        <TextField label="Title" required value={m.title} onChange={(t) => set({ title: t })} placeholder="e.g. Lighting layout submittal" />
        <SelectField label="Package" value={m.opportunity_id} options={opportunityOptions([m.project_id])} onChange={(x) => set({ opportunity_id: x })} />
        <DateField label="Planned date" value={m.planned_date} onChange={(d) => set({ planned_date: d })} />
        <DateField label="Actual date" value={m.actual_date} onChange={(d) => set({ actual_date: d })} />
        <SelectField label="Status" value={m.status} options={MILESTONE_STATUS_OPTIONS} allowClear={false} onChange={(x) => set({ status: x ?? 'pending' })} />
        <NumberField label="Revision" value={m.revision} onChange={(n) => set({ revision: n ?? 0 })} />
        <SelectField label="Owner" value={m.owner_id} options={userOptions()} onChange={(x) => set({ owner_id: x })} />
        <TextField label="Notes" multiline value={m.notes} onChange={(t) => set({ notes: t })} />
      </Card>
    </Screen>
  );
}
