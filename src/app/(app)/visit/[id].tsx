// Visit capture: works fully offline. Every change autosaves as a draft on
// the device; Submit validates the required fields and queues the visit for
// sync. Customers, contacts, projects and packages created here are sent
// with the visit and matched to existing records on the server.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Text, View } from 'react-native';

import { DuplicateHints } from '@/components/DuplicateHints';
import { FormModal } from '@/components/FormModal';
import {
  DateField, DateTimeField, MultiSelectField, NumberField, SegmentField, SelectField, SwitchField, TextField, type Option,
} from '@/components/form';
import { SyncStatusBadge } from '@/components/SyncBar';
import { Badge, Banner, Body, Button, Card, colors, Divider, Loading, Muted, Row, Screen, SectionTitle } from '@/components/ui';
import { cacheStore, customerName, profileName, useCache, useLookup } from '@/lib/cache';
import { confirm, notify } from '@/lib/dialog';
import { deleteLocalFile } from '@/lib/files';
import { fmtDate, fmtDateTime, todayIso } from '@/lib/format';
import { newId } from '@/lib/ids';
import { captureLocation, mapsUrl } from '@/lib/location';
import { pickDocument, pickPhoto, takePhoto } from '@/lib/media';
import {
  CONFIDENCE_OPTIONS, PRIORITY_OPTIONS, contactOptions, customerOptions, opportunityOptions, projectOptions, stageOptions, userOptions,
} from '@/lib/options';
import { getItem, removeItem, saveDraft, setStatus, useOutbox } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import type { Contact, Customer, NewAction, Project, Visit, VisitPayload } from '@/lib/types';
import { missingForSubmit } from '@/lib/validation';

function emptyPayload(id: string, userId: string, customerId?: string, projectId?: string): VisitPayload {
  const now = new Date().toISOString();
  return {
    visit: { id, salesperson_id: userId, customer_id: customerId ?? null, visit_date: todayIso(), device_created_at: now,
      is_remote: false, currency: 'LKR' },
    base_version: null,
    new_customers: [], new_contacts: [], new_projects: [], new_opportunities: [], new_stakeholders: [],
    contact_ids: [], project_ids: projectId ? [projectId] : [], opportunity_ids: [], actions: [], attachments: [],
  };
}

function fromPlanned(v: Visit): VisitPayload {
  return {
    ...emptyPayload(v.id, v.salesperson_id ?? '', v.customer_id ?? undefined),
    visit: { ...v, status: undefined, visit_date: v.scheduled_at ? v.scheduled_at.slice(0, 10) : todayIso(), device_created_at: new Date().toISOString() },
    base_version: v.version ?? null,
  };
}

export default function VisitForm() {
  const params = useLocalSearchParams<{ id: string; customerId?: string; projectId?: string }>();
  const { profile } = useSession();
  const userId = profile!.id;
  const planned = useCache('plannedVisits');
  const status = useOutbox((s) => s.items[params.id]?.status);

  // Load: existing draft, planned visit, or a new visit (redirects handled below)
  const [p, setP] = useState<VisitPayload | null>(() => {
    if (params.id === 'new') return null;
    const existing = getItem(params.id);
    if (existing) return existing.status === 'synced' ? null : existing.payload;
    const plan = planned.find((v) => v.id === params.id);
    if (plan) return plan.status === 'planned' ? fromPlanned(plan) : null;
    return emptyPayload(params.id, userId, params.customerId || undefined, params.projectId || undefined);
  });
  const [errors, setErrors] = useState<string[]>([]);
  const dirty = useRef(false);

  useEffect(() => {
    if (params.id === 'new') {
      router.replace({ pathname: '/visit/[id]', params: { id: newId(), customerId: params.customerId ?? '', projectId: params.projectId ?? '' } });
    } else if (!p) {
      router.replace(`/visit/view/${params.id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  // Autosave (debounced) after the first change
  useEffect(() => {
    if (!p || !dirty.current) return;
    const t = setTimeout(() => saveDraft(p), 600);
    return () => clearTimeout(t);
  }, [p]);

  const update = useCallback((fn: (prev: VisitPayload) => VisitPayload) => {
    dirty.current = true;
    setP((prev) => (prev ? fn(prev) : prev));
  }, []);
  const setVisit = useCallback((patch: Partial<Visit>) => update((prev) => ({ ...prev, visit: { ...prev.visit, ...patch } })), [update]);

  if (!p) return <Loading />;
  const locked = status === 'queued';
  const v = p.visit;

  const submit = async () => {
    const missing = missingForSubmit(p);
    setErrors(missing.map((m) => m.label));
    if (missing.length) {
      notify('Please complete the visit', missing.map((m) => `• ${m.label}`).join('\n'));
      return;
    }
    const finalPayload = { ...p, visit: { ...p.visit, check_out_at: p.visit.check_out_at ?? (p.visit.check_in_at ? new Date().toISOString() : null) } };
    saveDraft(finalPayload);
    setStatus(p.visit.id, 'queued', { error: null });
    router.back();
    notify('Visit submitted', 'It will sync now, or automatically when you are back online. The visit reference appears after sync.');
  };

  const discard = async () => {
    if (!(await confirm('Delete this draft?', 'Everything entered for this visit on this device will be removed.', 'Delete', true))) return;
    p.attachments.forEach((a) => deleteLocalFile(a.localUri));
    removeItem(p.visit.id);
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: v.code ?? 'Visit', headerRight: () => (status ? <SyncStatusBadge status={status} /> : null) }} />
      <Screen
        footer={locked ? (
          <Button style={{ flex: 1 }} variant="secondary" title="Edit again (unqueue)" onPress={() => setStatus(v.id, 'draft')} />
        ) : (
          <>
            <Button style={{ flex: 1 }} variant="secondary" title="Save draft" onPress={() => { saveDraft(p); dirty.current = false; router.back(); }} />
            <Button style={{ flex: 1.4 }} title="Submit visit" onPress={submit} />
          </>
        )}
      >
        {getItem(v.id)?.error && status === 'needs_attention' ? <Banner tone="danger" message={getItem(v.id)!.error!} /> : null}
        {locked ? <Banner tone="warning" message="Queued for sync. Unqueue it if you need to change something." /> : null}
        {errors.length ? <Banner tone="danger" message={`Missing: ${errors.join(', ')}`} /> : null}
        <View pointerEvents={locked ? 'none' : 'auto'} style={{ gap: 12, opacity: locked ? 0.6 : 1 }}>
          <CustomerSection p={p} update={update} setVisit={setVisit} />
          <ContactsSection p={p} update={update} setVisit={setVisit} />
          <CheckInSection v={v} setVisit={setVisit} />
          <ProjectsSection p={p} update={update} />
          <DiscussionSection v={v} setVisit={setVisit} />
          <OutcomeSection v={v} setVisit={setVisit} />
          <ActionsSection p={p} update={update} setVisit={setVisit} userId={userId} />
          <AttachmentsSection p={p} update={update} />
        </View>
        {!locked ? <Button variant="danger" title="Delete draft" onPress={discard} /> : null}
      </Screen>
    </>
  );
}

type SectionProps = {
  p: VisitPayload;
  update: (fn: (prev: VisitPayload) => VisitPayload) => void;
  setVisit: (patch: Partial<Visit>) => void;
};

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------
function CustomerSection({ p, update, setVisit }: SectionProps) {
  useCache('customers');
  const categories = useLookup('customer_category');
  const districts = useLookup('district');
  const [creating, setCreating] = useState<Customer | null>(null);
  const options = useMemo<Option[]>(() => [
    ...p.new_customers.map((c) => ({ value: c.id, label: c.legal_name, subtitle: 'New – created in this visit' })),
    ...customerOptions(),
  ], [p.new_customers]);
  const isNew = p.new_customers.some((c) => c.id === p.visit.customer_id);

  const saveNew = () => {
    if (!creating?.legal_name.trim()) return;
    const c = { ...creating, legal_name: creating.legal_name.trim(), status: 'provisional' as const };
    update((prev) => ({
      ...prev,
      new_customers: [...prev.new_customers.filter((x) => x.id !== c.id), c],
      visit: { ...prev.visit, customer_id: c.id },
      contact_ids: [],
    }));
    setCreating(null);
  };

  return (
    <Card>
      <SectionTitle>Customer</SectionTitle>
      <SelectField
        label="Customer"
        required
        value={p.visit.customer_id}
        options={options}
        onChange={(id) => update((prev) => ({ ...prev, visit: { ...prev.visit, customer_id: id }, contact_ids: [] }))}
        onCreate={(q) => setCreating({ id: newId(), legal_name: q, country: 'Sri Lanka' })}
        createLabel="New customer"
      />
      {isNew ? <Badge label="New customer – checked for duplicates when synced" tone="info" /> : null}
      <FormModal visible={!!creating} title="New customer" onClose={() => setCreating(null)} onSave={saveNew} saveDisabled={!creating?.legal_name.trim()}>
        {creating ? (
          <>
            <TextField label="Legal / registered name" required value={creating.legal_name} onChange={(t) => setCreating({ ...creating, legal_name: t })} />
            <DuplicateHints kind="customer" name={creating.legal_name} place={creating.city}
              onUse={(id) => { setVisit({ customer_id: id }); setCreating(null); }} />
            <TextField label="Trading name" value={creating.trading_name} onChange={(t) => setCreating({ ...creating, trading_name: t })} />
            <SelectField label="Category" value={creating.category} options={categories} onChange={(x) => setCreating({ ...creating, category: x })} />
            <TextField label="City" value={creating.city} onChange={(t) => setCreating({ ...creating, city: t })} />
            <SelectField label="District" value={creating.district} options={districts} onChange={(x) => setCreating({ ...creating, district: x })} />
            <TextField label="Phone" value={creating.phone} keyboardType="phone-pad" onChange={(t) => setCreating({ ...creating, phone: t })} />
            <TextField label="Email" value={creating.email} keyboardType="email-address" autoCapitalize="none" onChange={(t) => setCreating({ ...creating, email: t })} />
            <Muted>Saved as a provisional customer. A manager can complete and verify it later.</Muted>
          </>
        ) : null}
      </FormModal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// People met
// ---------------------------------------------------------------------------
function ContactsSection({ p, update, setVisit }: SectionProps) {
  useCache('contacts');
  const reasons = useLookup('contact_unavailable_reason');
  const roles = useLookup('decision_role');
  const [creating, setCreating] = useState<Contact | null>(null);
  const customerId = p.visit.customer_id;
  const options = useMemo<Option[]>(() => [
    ...p.new_contacts.filter((c) => c.customer_id === customerId).map((c) => ({ value: c.id, label: c.full_name, subtitle: 'New contact' })),
    ...contactOptions(customerId),
  ], [p.new_contacts, customerId]);

  const saveNew = () => {
    if (!creating?.full_name.trim() || !customerId) return;
    const c = { ...creating, full_name: creating.full_name.trim(), customer_id: customerId };
    update((prev) => ({
      ...prev,
      new_contacts: [...prev.new_contacts.filter((x) => x.id !== c.id), c],
      contact_ids: [...prev.contact_ids, c.id],
    }));
    setCreating(null);
  };

  return (
    <Card>
      <SectionTitle>People met</SectionTitle>
      {!customerId ? <Muted>Choose the customer first.</Muted> : (
        <MultiSelectField
          label="Contacts"
          values={p.contact_ids}
          options={options}
          onChange={(ids) => update((prev) => ({ ...prev, contact_ids: ids }))}
          onCreate={(q) => setCreating({ id: newId(), customer_id: customerId, full_name: q })}
          createLabel="New contact"
        />
      )}
      {p.contact_ids.length === 0 ? (
        <SelectField label="Or: reason no contact is recorded" value={p.visit.contact_unavailable_reason} options={reasons}
          onChange={(x) => setVisit({ contact_unavailable_reason: x })} />
      ) : null}
      <FormModal visible={!!creating} title="New contact" onClose={() => setCreating(null)} onSave={saveNew} saveDisabled={!creating?.full_name.trim()}>
        {creating ? (
          <>
            <Muted>At {customerName(customerId) !== '–' ? customerName(customerId) : p.new_customers.find((c) => c.id === customerId)?.legal_name}</Muted>
            <TextField label="Full name" required value={creating.full_name} onChange={(t) => setCreating({ ...creating, full_name: t })} />
            <TextField label="Designation" value={creating.designation} onChange={(t) => setCreating({ ...creating, designation: t })} />
            <TextField label="Department" value={creating.department} onChange={(t) => setCreating({ ...creating, department: t })} />
            <TextField label="Work phone" value={creating.work_phone} keyboardType="phone-pad" onChange={(t) => setCreating({ ...creating, work_phone: t })} />
            <TextField label="Mobile" value={creating.mobile_phone} keyboardType="phone-pad" onChange={(t) => setCreating({ ...creating, mobile_phone: t })} />
            <TextField label="Email" value={creating.email} keyboardType="email-address" autoCapitalize="none" onChange={(t) => setCreating({ ...creating, email: t })} />
            <SelectField label="Decision role" value={creating.decision_role} options={roles} onChange={(x) => setCreating({ ...creating, decision_role: x })} />
          </>
        ) : null}
      </FormModal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Check in / out and location
// ---------------------------------------------------------------------------
function CheckInSection({ v, setVisit }: { v: Visit; setVisit: (patch: Partial<Visit>) => void }) {
  const types = useLookup('visit_type');
  const locReasons = useLookup('location_unavailable_reason');
  const [busy, setBusy] = useState<'in' | 'out' | null>(null);

  const check = async (kind: 'in' | 'out', withLocation: boolean) => {
    setBusy(kind);
    const now = new Date().toISOString();
    const patch: Partial<Visit> = kind === 'in'
      ? { check_in_at: now, visit_date: todayIso(), location_consent: withLocation }
      : { check_out_at: now };
    if (withLocation) {
      const res = await captureLocation();
      if (res.fix) {
        if (kind === 'in') Object.assign(patch, { check_in_lat: res.fix.lat, check_in_lng: res.fix.lng, check_in_accuracy_m: res.fix.accuracy });
        else Object.assign(patch, { check_out_lat: res.fix.lat, check_out_lng: res.fix.lng, check_out_accuracy_m: res.fix.accuracy });
      } else if (kind === 'in') {
        patch.location_unavailable_reason = res.error ?? 'no_signal';
      }
    }
    setVisit(patch);
    setBusy(null);
  };

  return (
    <Card>
      <SectionTitle>Visit</SectionTitle>
      <SelectField label="Visit type" required value={v.visit_type} options={types} onChange={(x) => setVisit({ visit_type: x, is_remote: x === 'remote' ? true : v.is_remote })} />
      <DateField label="Visit date" required value={v.visit_date} onChange={(d) => setVisit({ visit_date: d })} />
      {v.scheduled_at ? <Muted>Planned for {fmtDateTime(v.scheduled_at)}</Muted> : null}
      <SwitchField label="Remote meeting (call / video)" value={v.is_remote} onChange={(x) => setVisit({ is_remote: x })} />
      {!v.is_remote ? (
        <>
          {v.check_in_at ? (
            <View style={{ gap: 4 }}>
              <Body>Checked in {fmtDateTime(v.check_in_at)}</Body>
              {v.check_in_lat != null ? (
                <Text style={{ color: colors.primary }} onPress={() => Linking.openURL(mapsUrl(v.check_in_lat!, v.check_in_lng!))}>
                  GPS {v.check_in_lat.toFixed(5)}, {v.check_in_lng!.toFixed(5)}{v.check_in_accuracy_m ? ` (±${Math.round(v.check_in_accuracy_m)} m)` : ''} – view map
                </Text>
              ) : <Muted>No location recorded</Muted>}
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              <Muted>Checking in records the time. Location is optional and is taken once, only if you choose it – there is no tracking.</Muted>
              <Row>
                <Button style={{ flex: 1 }} title="Check in + location" loading={busy === 'in'} onPress={() => check('in', true)} />
                <Button style={{ flex: 1 }} variant="secondary" title="Check in only" onPress={() => check('in', false)} />
              </Row>
            </View>
          )}
          {v.check_in_at && !v.check_out_at ? (
            <Button variant="secondary" title="Check out" loading={busy === 'out'} onPress={() => check('out', !!v.location_consent)} />
          ) : null}
          {v.check_out_at ? <Body>Checked out {fmtDateTime(v.check_out_at)}</Body> : null}
          {v.check_in_lat == null ? (
            <SelectField label="Reason location unavailable" value={v.location_unavailable_reason} options={locReasons}
              onChange={(x) => setVisit({ location_unavailable_reason: x })} />
          ) : null}
        </>
      ) : null}
      <TextField label="Meeting place" value={v.meeting_place} onChange={(t) => setVisit({ meeting_place: t })} placeholder="e.g. Head office, site office" />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Projects and packages
// ---------------------------------------------------------------------------
function ProjectsSection({ p, update }: Pick<SectionProps, 'p' | 'update'>) {
  useCache('projects');
  useCache('opportunities');
  const districts = useLookup('district');
  const segments = useLookup('project_segment');
  const types = useLookup('project_type');
  const stakeholderRoles = useLookup('stakeholder_role');
  const currencies = useLookup('currency');
  const [creating, setCreating] = useState<(Project & { stakeholder_role?: string | null }) | null>(null);
  const [pkg, setPkg] = useState<VisitPayload['new_opportunities'][number] | null>(null);

  const projectOpts = useMemo<Option[]>(() => [
    ...p.new_projects.map((x) => ({ value: x.id, label: x.name, subtitle: 'New project' })),
    ...projectOptions(p.visit.customer_id),
  ], [p.new_projects, p.visit.customer_id]);
  const pkgOpts = useMemo<Option[]>(() => [
    ...p.new_opportunities.map((o) => ({ value: o.id, label: o.name, subtitle: 'New package' })),
    ...opportunityOptions(p.project_ids),
  ], [p.new_opportunities, p.project_ids]);
  const projectName = (id: string) => p.new_projects.find((x) => x.id === id)?.name ?? cacheStore.get().projects.find((x) => x.id === id)?.name ?? id;

  const saveProject = () => {
    if (!creating?.name.trim()) return;
    const { stakeholder_role, ...project } = creating;
    const proj: Project = { ...project, name: project.name.trim(), customer_id: p.visit.customer_id };
    update((prev) => ({
      ...prev,
      new_projects: [...prev.new_projects.filter((x) => x.id !== proj.id), proj],
      project_ids: [...prev.project_ids.filter((x) => x !== proj.id), proj.id],
      // the customer and the people met become stakeholders, so nothing is typed twice
      new_stakeholders: stakeholder_role && prev.visit.customer_id ? [
        ...prev.new_stakeholders.filter((s) => s.project_id !== proj.id),
        { id: newId(), project_id: proj.id, customer_id: prev.visit.customer_id, stakeholder_role },
        ...prev.contact_ids.map((cid) => ({ id: newId(), project_id: proj.id, customer_id: prev.visit.customer_id, contact_id: cid, stakeholder_role })),
      ] : prev.new_stakeholders,
    }));
    setCreating(null);
  };

  const savePackage = () => {
    if (!pkg?.name.trim() || !pkg.project_id) return;
    update((prev) => ({
      ...prev,
      new_opportunities: [...prev.new_opportunities.filter((x) => x.id !== pkg.id), { ...pkg, name: pkg.name.trim() }],
      opportunity_ids: [...prev.opportunity_ids.filter((x) => x !== pkg.id), pkg.id],
    }));
    setPkg(null);
  };

  return (
    <Card>
      <SectionTitle>Projects discussed</SectionTitle>
      <MultiSelectField
        label="Linked projects"
        values={p.project_ids}
        options={projectOpts}
        onChange={(ids) => update((prev) => ({ ...prev, project_ids: ids }))}
        onCreate={(q) => setCreating({ id: newId(), name: q, currency: 'LKR', segments: [], stakeholder_role: 'owner' })}
        createLabel="New project from this visit"
      />
      {p.project_ids.length > 0 ? (
        <>
          <MultiSelectField
            label="Lighting packages / bids"
            values={p.opportunity_ids}
            options={pkgOpts}
            onChange={(ids) => update((prev) => ({ ...prev, opportunity_ids: ids }))}
            onCreate={(q) => setPkg({ id: newId(), project_id: p.project_ids[0], name: q, currency: 'LKR', stage_id: stageOptions(true)[0]?.value ?? '' })}
            createLabel="New package"
          />
        </>
      ) : null}

      <FormModal visible={!!creating} title="New project" onClose={() => setCreating(null)} onSave={saveProject} saveDisabled={!creating?.name.trim()}>
        {creating ? (
          <>
            <TextField label="Project name" required value={creating.name} onChange={(t) => setCreating({ ...creating, name: t })} />
            <SelectField label="District" value={creating.district} options={districts} onChange={(x) => setCreating({ ...creating, district: x })} />
            <DuplicateHints kind="project" name={creating.name} place={creating.district}
              onUse={(id) => { update((prev) => ({ ...prev, project_ids: [...new Set([...prev.project_ids, id])] })); setCreating(null); }} />
            <TextField label="Site / location" value={creating.site_location} onChange={(t) => setCreating({ ...creating, site_location: t })} />
            <SelectField label="Project type" value={creating.project_type} options={types} onChange={(x) => setCreating({ ...creating, project_type: x })} />
            <MultiSelectField label="Lighting segments" values={creating.segments ?? []} options={segments} onChange={(x) => setCreating({ ...creating, segments: x })} />
            <TextField label="Brief description" multiline value={creating.description} onChange={(t) => setCreating({ ...creating, description: t })} />
            <NumberField label="Total project estimate" value={creating.total_estimate} onChange={(n) => setCreating({ ...creating, total_estimate: n })} />
            <SelectField label="Currency" value={creating.currency} options={currencies} allowClear={false} onChange={(x) => setCreating({ ...creating, currency: x ?? 'LKR' })} />
            <DateField label="Tender closing date" value={creating.tender_closing_date} onChange={(d) => setCreating({ ...creating, tender_closing_date: d })} />
            <Divider />
            <Muted>The visit customer{p.contact_ids.length ? ' and the people met' : ''} will be added to the project as:</Muted>
            <SelectField label="Stakeholder role" value={creating.stakeholder_role} options={stakeholderRoles} onChange={(x) => setCreating({ ...creating, stakeholder_role: x })} />
          </>
        ) : null}
      </FormModal>

      <FormModal visible={!!pkg} title="New package" onClose={() => setPkg(null)} onSave={savePackage} saveDisabled={!pkg?.name.trim()}>
        {pkg ? (
          <>
            <SelectField label="Project" required value={pkg.project_id} allowClear={false}
              options={p.project_ids.map((id) => ({ value: id, label: projectName(id) }))} onChange={(x) => setPkg({ ...pkg, project_id: x ?? pkg.project_id })} />
            <TextField label="Package name" required value={pkg.name} onChange={(t) => setPkg({ ...pkg, name: t })} placeholder="e.g. Facade lighting" />
            <SelectField label="Segment" value={pkg.segment} options={segments} onChange={(x) => setPkg({ ...pkg, segment: x })} />
            <SelectField label="Stage" value={pkg.stage_id} options={stageOptions(true)} allowClear={false} onChange={(x) => setPkg({ ...pkg, stage_id: x ?? pkg.stage_id })} />
            <NumberField label="Estimated value" value={pkg.estimated_value} onChange={(n) => setPkg({ ...pkg, estimated_value: n })} />
            <SelectField label="Currency" value={pkg.currency} options={currencies} allowClear={false} onChange={(x) => setPkg({ ...pkg, currency: x ?? 'LKR' })} />
            <DateField label="Expected order date" value={pkg.expected_order_date} onChange={(d) => setPkg({ ...pkg, expected_order_date: d })} />
          </>
        ) : null}
      </FormModal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Discussion and commercial signal
// ---------------------------------------------------------------------------
function DiscussionSection({ v, setVisit }: { v: Visit; setVisit: (patch: Partial<Visit>) => void }) {
  const budget = useLookup('budget_status');
  const spec = useLookup('spec_status');
  const currencies = useLookup('currency');
  return (
    <>
      <Card>
        <SectionTitle>Discussion</SectionTitle>
        <TextField label="Purpose" required value={v.purpose} onChange={(t) => setVisit({ purpose: t })} multiline />
        <TextField label="Products / systems discussed" value={v.products_discussed} onChange={(t) => setVisit({ products_discussed: t })} multiline />
        <TextField label="Requirements" value={v.requirements} onChange={(t) => setVisit({ requirements: t })} multiline />
        <TextField label="Pain points" value={v.pain_points} onChange={(t) => setVisit({ pain_points: t })} multiline />
        <TextField label="Decision process" value={v.decision_process} onChange={(t) => setVisit({ decision_process: t })} />
        <TextField label="Budget indication" value={v.budget_indication} onChange={(t) => setVisit({ budget_indication: t })} />
        <SelectField label="Funding status" value={v.funding_status} options={budget} onChange={(x) => setVisit({ funding_status: x })} />
        <TextField label="Expected purchase / tender timeline" value={v.purchase_timeline} onChange={(t) => setVisit({ purchase_timeline: t })} />
      </Card>
      <Card>
        <SectionTitle>Commercial signal</SectionTitle>
        <NumberField label="Estimated value" value={v.estimated_value} onChange={(n) => setVisit({ estimated_value: n })} />
        <SelectField label="Currency" value={v.currency} options={currencies} allowClear={false} onChange={(x) => setVisit({ currency: x ?? 'LKR' })} />
        <SegmentField label="Confidence" value={v.confidence} options={CONFIDENCE_OPTIONS} onChange={(x) => setVisit({ confidence: x as Visit['confidence'] })} />
        <TextField label="Competitor" value={v.competitor} onChange={(t) => setVisit({ competitor: t })} />
        <TextField label="Incumbent supplier" value={v.incumbent} onChange={(t) => setVisit({ incumbent: t })} />
        <SelectField label="Specification position" value={v.spec_position} options={spec} onChange={(x) => setVisit({ spec_position: x })} />
        <TextField label="DIMO differentiator" value={v.differentiator} onChange={(t) => setVisit({ differentiator: t })} multiline />
        <TextField label="Risks or blockers" value={v.risks} onChange={(t) => setVisit({ risks: t })} multiline />
      </Card>
    </>
  );
}

function OutcomeSection({ v, setVisit }: { v: Visit; setVisit: (patch: Partial<Visit>) => void }) {
  const outcomes = useLookup('visit_outcome');
  return (
    <Card>
      <SectionTitle>Outcome</SectionTitle>
      <TextField label="Meeting summary" required value={v.summary} onChange={(t) => setVisit({ summary: t })} multiline />
      <SelectField label="Visit outcome" required value={v.outcome} options={outcomes} onChange={(x) => setVisit({ outcome: x })} />
      <TextField label="Commitments made" value={v.commitments} onChange={(t) => setVisit({ commitments: t })} multiline />
      <TextField label="Documents shared" value={v.documents_shared} onChange={(t) => setVisit({ documents_shared: t })} />
      <TextField label="Documents requested" value={v.documents_requested} onChange={(t) => setVisit({ documents_requested: t })} />
      <DateTimeField label="Next meeting" value={v.next_meeting_at} onChange={(d) => setVisit({ next_meeting_at: d })} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Next actions
// ---------------------------------------------------------------------------
function ActionsSection({ p, update, setVisit, userId }: SectionProps & { userId: string }) {
  const noFollowReasons = useLookup('no_followup_reason');
  const [editing, setEditing] = useState<NewAction | null>(null);
  const projectChoices: Option[] = p.project_ids.map((id) => ({
    value: id, label: p.new_projects.find((x) => x.id === id)?.name ?? cacheStore.get().projects.find((x) => x.id === id)?.name ?? id,
  }));

  const save = () => {
    if (!editing?.description.trim()) return;
    update((prev) => ({ ...prev, actions: [...prev.actions.filter((a) => a.id !== editing.id), { ...editing, description: editing.description.trim() }] }));
    setEditing(null);
  };

  return (
    <Card>
      <SectionTitle right={<Button small variant="ghost" title="＋ Add action" onPress={() => setEditing({ id: newId(), description: '', owner_id: userId, priority: 'normal', project_id: p.project_ids[0] ?? null })} />}>
        Next actions
      </SectionTitle>
      {p.actions.map((a) => (
        <Row key={a.id} style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Body>{a.description}</Body>
            <Muted>{profileName(a.owner_id)} · {a.due_date ? `due ${fmtDate(a.due_date)}` : 'no due date'} · {a.priority}</Muted>
          </View>
          <Button small variant="ghost" title="Edit" onPress={() => setEditing(a)} />
          <Button small variant="ghost" title="✕" onPress={() => update((prev) => ({ ...prev, actions: prev.actions.filter((x) => x.id !== a.id) }))} />
        </Row>
      ))}
      {p.actions.length === 0 ? (
        <SelectField label='Or: "no follow up" reason' value={p.visit.no_followup_reason} options={noFollowReasons}
          onChange={(x) => setVisit({ no_followup_reason: x })} />
      ) : null}
      <FormModal visible={!!editing} title="Next action" onClose={() => setEditing(null)} onSave={save} saveDisabled={!editing?.description.trim()}>
        {editing ? (
          <>
            <TextField label="What needs to happen" required multiline value={editing.description} onChange={(t) => setEditing({ ...editing, description: t })} />
            <DateField label="Due date" value={editing.due_date} onChange={(d) => setEditing({ ...editing, due_date: d })} />
            <SelectField label="Owner" value={editing.owner_id} options={userOptions()} allowClear={false} onChange={(x) => setEditing({ ...editing, owner_id: x ?? userId })} />
            <SegmentField label="Priority" value={editing.priority} options={PRIORITY_OPTIONS} onChange={(x) => setEditing({ ...editing, priority: (x ?? 'normal') as NewAction['priority'] })} />
            {projectChoices.length ? (
              <SelectField label="Related project" value={editing.project_id} options={projectChoices} onChange={(x) => setEditing({ ...editing, project_id: x })} />
            ) : null}
          </>
        ) : null}
      </FormModal>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
function AttachmentsSection({ p, update }: Pick<SectionProps, 'p' | 'update'>) {
  const [busy, setBusy] = useState(false);
  const add = async (fn: typeof takePhoto) => {
    setBusy(true);
    try {
      const a = await fn();
      if (a) update((prev) => ({ ...prev, attachments: [...prev.attachments, a] }));
    } catch (e) {
      notify('Could not add the file', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <SectionTitle>Photos and documents</SectionTitle>
      <Row wrap>
        <Button small title="Take photo" onPress={() => add(takePhoto)} disabled={busy} />
        <Button small variant="secondary" title="Choose photo" onPress={() => add(pickPhoto)} disabled={busy} />
        <Button small variant="secondary" title="Attach file" onPress={() => add(pickDocument)} disabled={busy} />
      </Row>
      {p.attachments.map((a) => (
        <Row key={a.id}>
          {a.mime_type.startsWith('image/') ? (
            <Image source={{ uri: a.localUri }} style={{ width: 56, height: 56, borderRadius: 6, backgroundColor: '#eee' }} />
          ) : <Badge label={a.filename.split('.').pop()?.toUpperCase() ?? 'FILE'} />}
          <View style={{ flex: 1 }}>
            <Body numberOfLines={1}>{a.filename}</Body>
            <Muted>{a.size_bytes ? `${Math.round(a.size_bytes / 1024)} KB` : ''}{a.uploaded ? ' · uploaded' : ''}</Muted>
          </View>
          {!a.uploaded ? (
            <Button small variant="ghost" title="✕" onPress={() => {
              deleteLocalFile(a.localUri);
              update((prev) => ({ ...prev, attachments: prev.attachments.filter((x) => x.id !== a.id) }));
            }} />
          ) : null}
        </Row>
      ))}
      <Muted>Files are uploaded to secure storage when the visit syncs.</Muted>
    </Card>
  );
}
