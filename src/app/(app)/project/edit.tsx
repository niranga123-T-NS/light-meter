import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { DuplicateHints } from '@/components/DuplicateHints';
import { DateField, MultiSelectField, NumberField, SelectField, TextField } from '@/components/form';
import { Banner, Button, Card, Loading, Screen, SectionTitle } from '@/components/ui';
import { upsertCached, useLookup } from '@/lib/cache';
import { newId } from '@/lib/ids';
import { PROJECT_STATUS_OPTIONS, customerOptions, territoryOptions, userOptions } from '@/lib/options';
import { fetchOne, saveRecord } from '@/lib/records';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/supabase';
import type { Project } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function EditProject() {
  const { id, customerId } = useLocalSearchParams<{ id?: string; customerId?: string }>();
  const { data, loading, error } = useAsync(() => (id ? fetchOne<Project>('projects', id) : Promise.resolve(null)), [id]);
  if (id && loading) return <Loading />;
  if (id && !data) return <Screen><Banner tone="danger" message={error ?? 'Not found'} /></Screen>;
  return <ProjectForm isNew={!id} initial={data ?? { id: newId(), name: '', customer_id: customerId || null, currency: 'LKR', segments: [], aliases: [], drawing_links: [], status: 'active' }} />;
}

function ProjectForm({ initial, isNew }: { initial: Project; isNew: boolean }) {
  const { isManager } = useSession();
  const [p, setP] = useState<Project>(initial);
  const [aliases, setAliases] = useState((initial.aliases ?? []).join(', '));
  const [links, setLinks] = useState((initial.drawing_links ?? []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Project>) => setP({ ...p, ...patch });
  const l = {
    district: useLookup('district'), type: useLookup('project_type'), segment: useLookup('project_segment'), budget: useLookup('budget_status'),
    spec: useLookup('spec_status'), design: useLookup('design_stage'), confidence: useLookup('date_confidence'), source: useLookup('lead_source'),
    currency: useLookup('currency'),
  };
  const customers = customerOptions();

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const row: Project = {
        ...p,
        aliases: aliases.split(',').map((x) => x.trim()).filter(Boolean),
        drawing_links: links.split(/\s+/).map((x) => x.trim()).filter(Boolean),
      };
      const saved = await saveRecord('projects', row, isNew);
      upsertCached('projects', saved);
      router.replace(`/project/${saved.id}`);
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg.includes('projects_dedupe_key') ? 'A project with this name already exists in this district. Open the existing project instead.' : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen footer={<Button style={{ flex: 1 }} title={isNew ? 'Create project' : 'Save'} onPress={save} loading={saving} disabled={!p.name.trim()} />}>
      <Stack.Screen options={{ title: isNew ? 'New project' : `Edit ${initial.code ?? ''}` }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Card>
        <TextField label="Project name" required value={p.name} onChange={(t) => set({ name: t })} />
        <SelectField label="District" value={p.district} options={l.district} onChange={(x) => set({ district: x })} />
        {isNew ? <DuplicateHints kind="project" name={p.name} place={p.district} onUse={(existing) => router.replace(`/project/${existing}`)} /> : null}
        <TextField label="Other names (aliases)" value={aliases} onChange={setAliases} hint="Comma separated – helps find duplicates" />
        <TextField label="Site / location" value={p.site_location} onChange={(t) => set({ site_location: t })} />
        <TextField label="City" value={p.city} onChange={(t) => set({ city: t })} />
        <SelectField label="Customer / project owner" value={p.customer_id} options={customers} onChange={(x) => set({ customer_id: x })} />
        <SelectField label="Developer" value={p.developer_id} options={customers} onChange={(x) => set({ developer_id: x })} />
        <SelectField label="End user" value={p.end_user_id} options={customers} onChange={(x) => set({ end_user_id: x })} />
        <SelectField label="Project type" value={p.project_type} options={l.type} onChange={(x) => set({ project_type: x })} />
        <TextField label="Brief description" multiline value={p.description} onChange={(t) => set({ description: t })} />
        <SelectField label="Status" value={p.status} options={PROJECT_STATUS_OPTIONS} allowClear={false} onChange={(x) => set({ status: x ?? 'active' })} />
      </Card>
      <SectionTitle>Scope</SectionTitle>
      <Card>
        <MultiSelectField label="Lighting segments" values={p.segments ?? []} options={l.segment} onChange={(x) => set({ segments: x })} />
        <TextField label="Systems / products" multiline value={p.systems_products} onChange={(t) => set({ systems_products: t })} />
        <TextField label="Quantities (where known)" multiline value={p.quantities} onChange={(t) => set({ quantities: t })} />
        <TextField label="Technical standards" value={p.technical_standards} onChange={(t) => set({ technical_standards: t })} />
        <TextField label="Lux targets" value={p.lux_targets} onChange={(t) => set({ lux_targets: t })} placeholder="e.g. Offices 500 lx, corridors 150 lx" />
        <TextField label="Controls / integration requirements" multiline value={p.controls_requirements} onChange={(t) => set({ controls_requirements: t })} />
        <TextField label="Drawing / specification links" multiline value={links} onChange={setLinks} hint="One link per line" autoCapitalize="none" />
      </Card>
      <SectionTitle>Commercial</SectionTitle>
      <Card>
        <NumberField label="Total project estimate" value={p.total_estimate} onChange={(n) => set({ total_estimate: n })} />
        <NumberField label="DIMO addressable value" value={p.addressable_value} onChange={(n) => set({ addressable_value: n })} />
        <SelectField label="Currency" value={p.currency} options={l.currency} allowClear={false} onChange={(x) => set({ currency: x ?? 'LKR' })} />
        <SelectField label="Budget status" value={p.budget_status} options={l.budget} onChange={(x) => set({ budget_status: x })} />
        <TextField label="Funding source" value={p.funding_source} onChange={(t) => set({ funding_source: t })} />
        <TextField label="Bid strategy" multiline value={p.bid_strategy} onChange={(t) => set({ bid_strategy: t })} />
        <TextField label="Partner / supplier" value={p.partner_supplier} onChange={(t) => set({ partner_supplier: t })} />
        <TextField label="Competitors" value={p.competitors} onChange={(t) => set({ competitors: t })} />
        <TextField label="Incumbent" value={p.incumbent} onChange={(t) => set({ incumbent: t })} />
        <SelectField label="Specification status" value={p.spec_status} options={l.spec} onChange={(x) => set({ spec_status: x })} />
      </Card>
      <SectionTitle>Timeline</SectionTitle>
      <Card>
        <SelectField label="Design stage" value={p.design_stage} options={l.design} onChange={(x) => set({ design_stage: x })} />
        <DateField label="Tender publication" quick={false} value={p.tender_publication_date} onChange={(d) => set({ tender_publication_date: d })} />
        <DateField label="Tender closing" value={p.tender_closing_date} onChange={(d) => set({ tender_closing_date: d })} />
        <DateField label="Quotation due" value={p.quotation_due_date} onChange={(d) => set({ quotation_due_date: d })} />
        <DateField label="Expected award" quick={false} value={p.expected_award_date} onChange={(d) => set({ expected_award_date: d })} />
        <DateField label="Expected delivery" quick={false} value={p.expected_delivery_date} onChange={(d) => set({ expected_delivery_date: d })} />
        <DateField label="Installation start" quick={false} value={p.installation_start_date} onChange={(d) => set({ installation_start_date: d })} />
        <DateField label="Installation end" quick={false} value={p.installation_end_date} onChange={(d) => set({ installation_end_date: d })} />
        <SelectField label="Date confidence" value={p.date_confidence} options={l.confidence} onChange={(x) => set({ date_confidence: x })} />
        <TextField label="Source of information" value={p.info_source} onChange={(t) => set({ info_source: t })} />
      </Card>
      <SectionTitle>Evidence</SectionTitle>
      <Card>
        <TextField label="Tender reference" value={p.tender_reference} onChange={(t) => set({ tender_reference: t })} />
        <SelectField label="Source of lead" value={p.lead_source} options={l.source} onChange={(x) => set({ lead_source: x })} />
        <TextField label="BOQ reference" value={p.boq_reference} onChange={(t) => set({ boq_reference: t })} />
      </Card>
      {isManager ? (
        <>
          <SectionTitle>Ownership</SectionTitle>
          <Card>
            <SelectField label="Project owner" value={p.owner_id} options={userOptions()} onChange={(x) => set({ owner_id: x })} />
            <SelectField label="Territory" value={p.territory_id} options={territoryOptions()} onChange={(x) => set({ territory_id: x })} />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
