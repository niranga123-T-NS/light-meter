import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { DateField, NumberField, SelectField, TextField } from '@/components/form';
import { Banner, Button, Card, Loading, Muted, Screen } from '@/components/ui';
import { upsertCached, useLookup } from '@/lib/cache';
import { newId } from '@/lib/ids';
import { projectOptions, stageOptions, userOptions } from '@/lib/options';
import { fetchOne, saveRecord } from '@/lib/records';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/supabase';
import type { Opportunity } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function EditOpportunity() {
  const { id, projectId } = useLocalSearchParams<{ id?: string; projectId?: string }>();
  const { data, loading, error } = useAsync(() => (id ? fetchOne<Opportunity>('opportunities', id) : Promise.resolve(null)), [id]);
  if (id && loading) return <Loading />;
  if (id && !data) return <Screen><Banner tone="danger" message={error ?? 'Not found'} /></Screen>;
  return <OppForm isNew={!id} initial={data ?? { id: newId(), project_id: projectId ?? '', name: '', stage_id: stageOptions(true)[0]?.value ?? '', currency: 'LKR' }} />;
}

function OppForm({ initial, isNew }: { initial: Opportunity; isNew: boolean }) {
  const { isManager, profile } = useSession();
  const [o, setO] = useState<Opportunity>(isNew ? { ...initial, owner_id: profile!.id } : initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const segments = useLookup('project_segment');
  const currencies = useLookup('currency');
  const spec = useLookup('spec_status');
  const set = (patch: Partial<Opportunity>) => setO({ ...o, ...patch });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // stage changes go through the stage dialog so its rules are shown
      const saved = await saveRecord('opportunities', isNew ? o : { ...o, stage_id: initial.stage_id }, isNew);
      upsertCached('opportunities', saved);
      router.replace(`/opportunity/${saved.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen footer={<Button style={{ flex: 1 }} title={isNew ? 'Create package' : 'Save'} onPress={save} loading={saving} disabled={!o.name.trim() || !o.project_id} />}>
      <Stack.Screen options={{ title: isNew ? 'New package' : `Edit ${initial.code ?? ''}` }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Card>
        <SelectField label="Project" required value={o.project_id} options={projectOptions()} onChange={(x) => set({ project_id: x ?? '' })} />
        <TextField label="Package name" required value={o.name} onChange={(t) => set({ name: t })} placeholder="e.g. Car park lighting" />
        <SelectField label="Segment" value={o.segment} options={segments} onChange={(x) => set({ segment: x })} />
        {isNew ? <SelectField label="Stage" value={o.stage_id} options={stageOptions(true)} allowClear={false} onChange={(x) => set({ stage_id: x ?? o.stage_id })} />
          : <Muted>Use “Change stage” on the package to move it through the pipeline.</Muted>}
        <TextField label="Systems / products" multiline value={o.systems_products} onChange={(t) => set({ systems_products: t })} />
        <TextField label="Quantities" value={o.quantities} onChange={(t) => set({ quantities: t })} />
        <NumberField label="Estimated value" value={o.estimated_value} onChange={(n) => set({ estimated_value: n })} />
        <SelectField label="Currency" value={o.currency} options={currencies} allowClear={false} onChange={(x) => set({ currency: x ?? 'LKR' })} />
        <NumberField label="Probability % (blank = stage default)" value={o.probability} onChange={(n) => set({ probability: n })} />
        <DateField label="Expected order date" value={o.expected_order_date} onChange={(d) => set({ expected_order_date: d })} />
        <DateField label="Quotation due date" value={o.quotation_due_date} onChange={(d) => set({ quotation_due_date: d })} />
        <TextField label="Next milestone" value={o.next_milestone} onChange={(t) => set({ next_milestone: t })} />
        <DateField label="Next milestone date" value={o.next_milestone_date} onChange={(d) => set({ next_milestone_date: d })} />
        <TextField label="Blocker" value={o.blocker} onChange={(t) => set({ blocker: t })} />
        <TextField label="Bid strategy" multiline value={o.bid_strategy} onChange={(t) => set({ bid_strategy: t })} />
        <TextField label="Partner / supplier" value={o.partner_supplier} onChange={(t) => set({ partner_supplier: t })} />
        <TextField label="Competitors" value={o.competitors} onChange={(t) => set({ competitors: t })} />
        <TextField label="Incumbent" value={o.incumbent} onChange={(t) => set({ incumbent: t })} />
        <SelectField label="Specification status" value={o.spec_status} options={spec} onChange={(x) => set({ spec_status: x })} />
        {isManager ? <SelectField label="Owner" value={o.owner_id} options={userOptions()} onChange={(x) => set({ owner_id: x })} /> : null}
      </Card>
    </Screen>
  );
}
