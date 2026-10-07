import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useDialog } from '@/components/dialog';
import { CustomerPicker, ProjectPicker } from '@/components/pickers';
import { Button, Card, colors, DateField, ErrorBanner, Field, Muted, MultiSelect, Notice, NumberField, Row, Screen, Section, Segmented, Select, Toggle } from '@/components/ui';
import { DESIGN_SCOPE, ESTIMATION_BASIS, ESTIMATION_SCOPE } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import type { DutyStatus, Inquiry, Project } from '@/lib/types';

const ROUTES = [
  { value: 'A', label: 'A · Design → Estimation', hint: 'Layout, concept, calculation or electrical design needed before pricing' },
  { value: 'B', label: 'B · Estimation only', hint: 'BOQ or specification already available (tender BOQ, consultant spec, replacement)' },
  { value: 'C', label: 'C · Design only', hint: 'Concept, calculation or presentation support with no quotation yet' },
];

/** Inquiry request form (Section 5.1). Saved as a draft, then submitted from the inquiry page after attaching files. */
export default function NewInquiry() {
  const params = useLocalSearchParams<{ visit?: string; project?: string; edit?: string }>();
  const dialog = useDialog();
  const [error, setError] = useState<string | null>(null);
  const [hasUnits, setHasUnits] = useState(false);
  const [saved, setSaved] = useState<string[]>([]); // drafts saved with "add another" on this screen
  const blank = () => ({
    project_id: (params.project ?? null) as string | null,
    visit_id: (params.visit ?? null) as string | null,
    inquiry_name: '',
    organization_id: null as string | null,
    unit_id: null as string | null,
    contact_id: null as string | null,
    route: 'A' as 'A' | 'B' | 'C',
    release_mode: 3 as number,
    duty_status: null as DutyStatus | null,
    design_scope: 'lighting' as string | null,
    estimation_scope: ['fixtures'] as string[],
    estimation_basis: null as string | null,
    priority: 'normal',
    submission_type: '',
    customer_deadline: null as string | null,
    design_required_by: null as string | null,
    quotation_required_by: null as string | null,
    scope_description: '',
    areas: '',
    preferred_brands: '',
    budget_lkr: null as number | null,
    approved_makes: '',
    checklist: { drawings: false, boq: false, spec: false, lux: false } as Record<string, boolean>,
    solution_level: null as string | null,
    manufacturing_origin: null as string | null,
    expectation_notes: '',
  });
  const [f, setF] = useState(blank);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  // Prefill from the visit (convert to inquiry) or load a draft for editing
  useEffect(() => {
    if (params.edit) {
      supabase.from('inquiries').select('*').eq('id', params.edit).single().then(({ data }) => {
        const i = data as Inquiry | null;
        if (!i) return;
        setF((s) => ({
          ...s,
          ...Object.fromEntries(Object.keys(s).map((k) => [k, (i as unknown as Record<string, unknown>)[k] ?? (s as Record<string, unknown>)[k]])),
        }) as typeof s);
      });
    } else if (params.visit) {
      supabase.from('visits').select('*').eq('id', params.visit).single().then(({ data: v }) => {
        if (v) setF((s) => ({ ...s, project_id: v.project_id, organization_id: v.organization_id, unit_id: v.unit_id, contact_id: v.contact_id }));
      });
    } else if (params.project) {
      supabase.from('projects').select('*').eq('id', params.project).single().then(({ data: p }) => {
        if (p) setF((s) => ({ ...s, organization_id: p.organization_id, unit_id: p.unit_id, duty_status: p.duty_status }));
      });
    }
  }, [params.edit, params.visit, params.project]);

  useEffect(() => {
    if (!f.organization_id) return;
    supabase.from('org_units').select('id', { count: 'exact', head: true }).eq('organization_id', f.organization_id).then(({ count }) => setHasUnits((count ?? 0) > 0));
  }, [f.organization_id]);

  const needsDuty = f.route !== 'C';
  const save = async (addAnother = false) => {
    setError(null);
    if (!f.project_id || !f.organization_id) return setError('Select the project and customer');
    if (!f.inquiry_name?.trim()) return setError('Enter the inquiry name – what this inquiry is for (e.g. Street lighting – Package 2)');
    if (hasUnits && !f.unit_id) return setError('Select the unit / department – this customer has units defined');
    if (!f.customer_deadline) return setError('Customer deadline is mandatory');
    if (needsDuty && !f.duty_status) return setError('Duty status is mandatory when estimation is in scope');
    if (needsDuty && !f.estimation_scope.length) return setError('Select the estimation scope – what Estimation must price');
    if (needsDuty && !f.estimation_basis) return setError('Select the estimation basis – supply only, supply & install, or supply, install & commission');
    const row = {
      ...f,
      inquiry_name: f.inquiry_name.trim(),
      design_scope: f.route === 'B' ? null : f.design_scope,
      estimation_scope: needsDuty ? f.estimation_scope : [],
      estimation_basis: needsDuty ? f.estimation_basis : null,
      duty_status: needsDuty ? f.duty_status : f.duty_status,
      submission_type: f.submission_type || null,
      areas: f.areas || null,
      preferred_brands: f.preferred_brands || null,
      approved_makes: f.approved_makes || null,
      expectation_notes: f.expectation_notes || null,
      scope_description: f.scope_description || null,
    };
    await dialog.run(async () => {
      const q = params.edit ? supabase.from('inquiries').update(row).eq('id', params.edit).select('id').single() : supabase.from('inquiries').insert(row).select('id').single();
      const { data, error: e } = await q;
      if (e) throw new Error(e.message);
      if (addAnother) {
        // Same project, customer, contact and duty; the request itself starts empty for the next package
        setF({ ...blank(), project_id: f.project_id, visit_id: f.visit_id, organization_id: f.organization_id, unit_id: f.unit_id, contact_id: f.contact_id, duty_status: f.duty_status });
        setSaved((n) => [...n, data.id]);
      } else router.replace(`/inquiries/${data.id}`);
    }, addAnother ? 'Draft saved – now enter the next inquiry for this project' : 'Draft saved – attach documents and submit');
  };

  return (
    <Screen maxWidth={820}>
      <Stack.Screen options={{ title: params.edit ? 'Edit inquiry' : 'New inquiry' }} />
      <ErrorBanner message={error} />
      {saved.length ? (
        <Notice tone={colors.green}>
          {`${saved.length} draft inquir${saved.length === 1 ? 'y' : 'ies'} saved for this project – attach documents and submit each from Inquiries. Enter the next one below.`}
        </Notice>
      ) : null}
      <Section title="Project and customer">
        <Card>
          <ProjectPicker
            required
            value={f.project_id}
            onChange={(p: Project | null) => setF((s) => ({ ...s, project_id: p?.id ?? null, organization_id: p?.organization_id ?? s.organization_id, unit_id: p?.unit_id ?? s.unit_id, duty_status: s.duty_status ?? p?.duty_status ?? null }))}
            onCreate={(q) => router.push({ pathname: '/projects/new', params: { pick: '1', name: q, organization: f.organization_id ?? '' } })}
          />
          <Field
            label="Inquiry name"
            required
            value={f.inquiry_name ?? ''}
            onChangeText={(v) => set('inquiry_name', v)}
            placeholder="What this inquiry is for – e.g. Street lighting – Package 2, Car park, Phase 1 interior"
            hint="A project can have several inquiries – the name tells them apart"
          />
          <CustomerPicker organizationId={f.organization_id} unitId={f.unit_id} contactId={f.contact_id} requireUnit={hasUnits} onChange={(c) => setF((s) => ({ ...s, organization_id: c.organizationId, unit_id: c.unitId, contact_id: c.contactId }))} />
        </Card>
      </Section>

      <Section title="Route">
        <Card>
          <Select
            label="Route"
            required
            value={f.route}
            options={ROUTES}
            onChange={(v) => setF((s) => ({ ...s, route: v as 'A', release_mode: v === 'A' ? 3 : v === 'B' ? 2 : 1 }))}
            hint={ROUTES.find((r) => r.value === f.route)?.hint}
          />
          {f.route === 'A' ? (
            <Select
              label="Proposed release mode (SM Projects confirms)"
              value={String(f.release_mode)}
              onChange={(v) => set('release_mode', Number(v))}
              options={[
                { value: '3', label: '3 · Design + Estimation – released together (default)' },
                { value: '2', label: '2 · Estimation only – design is an internal input' },
              ]}
            />
          ) : null}
          {f.route !== 'B' ? (
            <Select
              label="Design scope"
              value={f.design_scope}
              onChange={(v) => set('design_scope', v)}
              options={DESIGN_SCOPE}
              hint="What the design team must design"
            />
          ) : null}
          {f.route !== 'C' ? (
            <>
              <MultiSelect
                label="Estimation scope *"
                values={f.estimation_scope}
                options={ESTIMATION_SCOPE}
                onChange={(v) => set('estimation_scope', v)}
                hint="What the estimation team must price"
              />
              <Select label="Estimation basis" required value={f.estimation_basis} options={ESTIMATION_BASIS} onChange={(v) => set('estimation_basis', v)} />
            </>
          ) : null}
          <Select
            label={needsDuty ? 'Duty status (fixes the currency)' : 'Duty status (optional for design only)'}
            required={needsDuty}
            value={f.duty_status}
            onChange={(v) => set('duty_status', v as DutyStatus)}
            options={[
              { value: 'duty_free', label: 'Duty Free – all values in USD' },
              { value: 'duty_paid', label: 'Duty Paid – all values in LKR' },
            ]}
          />
          <Segmented
            value={f.priority}
            onChange={(v) => set('priority', v)}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
              { value: 'urgent', label: 'Urgent' },
            ]}
          />
          <Field label="Tender or submission type" value={f.submission_type} onChangeText={(v) => set('submission_type', v)} />
        </Card>
      </Section>

      <Section title="Dates">
        <Card>
          <DateField label="Customer deadline" required value={f.customer_deadline} onChange={(v) => set('customer_deadline', v)} quick={[7, 14, 21, 30]} hint="The date the client or consultant needs the submission" />
          <Muted>Only the customer deadline is needed. The Design Manager and SM Estimation set the internal design and estimation due dates when they assign the work.</Muted>
        </Card>
      </Section>

      <Section title="Scope">
        <Card>
          <Field label="Scope description" multiline value={f.scope_description} onChangeText={(v) => set('scope_description', v)} hint="Required unless you attach documents" />
          <Field label="Areas / spaces" value={f.areas} onChangeText={(v) => set('areas', v)} />
          <Field label="Preferred brands" value={f.preferred_brands} onChangeText={(v) => set('preferred_brands', v)} />
          <Field label="Approved makes list" value={f.approved_makes} onChangeText={(v) => set('approved_makes', v)} />
          <NumberField label="Budget indication" suffix="LKR" value={f.budget_lkr} onChange={(v) => set('budget_lkr', v)} />
          <Muted style={{ marginBottom: 6 }}>Documents received (incomplete checklists are allowed but flagged)</Muted>
          <Row wrap gap={12}>
            {(['drawings', 'boq', 'spec', 'lux'] as const).map((k) => (
              <Toggle key={k} label={{ drawings: 'Drawings', boq: 'BOQ', spec: 'Specification', lux: 'Lux requirements' }[k]} value={f.checklist[k]} onChange={(v) => set('checklist', { ...f.checklist, [k]: v })} />
            ))}
          </Row>
        </Card>
      </Section>

      <Section title="Client solution expectation">
        <Card>
          <Select
            label="Solution level"
            value={f.solution_level}
            onChange={(v) => set('solution_level', v)}
            options={[
              { value: 'high', label: 'High end' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low end' },
            ]}
          />
          <Select
            label="Manufacturing origin"
            value={f.manufacturing_origin}
            onChange={(v) => set('manufacturing_origin', v)}
            options={[
              { value: 'european', label: 'European manufactured' },
              { value: 'chinese', label: 'Chinese manufactured' },
              { value: 'no_preference', label: 'No preference' },
            ]}
          />
          <Field label="Notes (e.g. brands the client or consultant asked for)" value={f.expectation_notes} onChangeText={(v) => set('expectation_notes', v)} />
          <Notice tone={colors.blue}>After submission, a change to the expectation needs Design Manager and SM Estimation approval.</Notice>
        </Card>
      </Section>

      <Row wrap gap={8} style={{ marginTop: 16 }}>
        <Button title="Save draft and continue" onPress={() => save(false)} />
        {!params.edit ? <Button title="Save and add another inquiry for this project" variant="secondary" onPress={() => save(true)} /> : null}
      </Row>
    </Screen>
  );
}
