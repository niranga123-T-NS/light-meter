import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useDialog } from '@/components/dialog';
import { CustomerPicker, ProjectPicker } from '@/components/pickers';
import { Button, Card, colors, DateField, ErrorBanner, Field, MultiSelect, Muted, Notice, NumberField, Row, Screen, Section, Segmented, Select } from '@/components/ui';
import { captureLocation, ObjectivePicker } from '@/components/VisitBits';
import { useMe } from '@/lib/auth';
import { uuid } from '@/lib/files';
import { useMasters } from '@/lib/hooks';
import { saveVisit } from '@/lib/offline';
import { supabase } from '@/lib/supabase';
import type { Currency, PlanLine, Project } from '@/lib/types';

/** Check in to a visit and (optionally) record the report in one go – designed to take under 2 minutes. */
export default function NewVisit() {
  const me = useMe();
  const dialog = useDialog();
  const masters = useMasters();
  const params = useLocalSearchParams<{ planLine?: string; project?: string }>();
  const [id] = useState(uuid());
  const [checkinAt] = useState(new Date().toISOString()); // device time at capture (offline rule)
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsState, setGpsState] = useState<'idle' | 'busy' | 'denied'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({
    plan_line_id: null as string | null,
    project_id: (params.project ?? null) as string | null,
    organization_id: null as string | null,
    unit_id: null as string | null,
    contact_id: null as string | null,
    visit_category: null as string | null,
    primary_objective: null as string | null,
    secondary_objectives: [] as string[],
    visit_type: 'normal' as 'normal' | 'tender',
    tender_activity: null as string | null,
    tender_no: '',
    tender_date: null as string | null,
    summary: '',
    outcome: null as string | null,
    competitors_mentioned: [] as string[],
    brands_specified: '',
    est_project_value: null as number | null,
    est_lighting_value: null as number | null,
    currency: 'LKR' as Currency,
    next_action: '',
    next_action_date: null as string | null,
  });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const [competitors, setCompetitors] = useState<string[]>([]);

  useEffect(() => {
    supabase.from('competitors').select('name').eq('active', true).order('name').then(({ data }) => setCompetitors((data ?? []).map((c) => c.name)));
    (async () => {
      setGpsState('busy');
      const pos = await captureLocation().catch(() => null);
      setGps(pos);
      setGpsState(pos ? 'idle' : 'denied');
    })();
  }, []);

  // Prefill from the weekly plan line
  useEffect(() => {
    if (!params.planLine) return;
    supabase
      .from('visit_plan_lines')
      .select('*')
      .eq('id', params.planLine)
      .maybeSingle()
      .then(({ data }) => {
        const l = data as PlanLine | null;
        if (!l) return;
        setV((s) => ({
          ...s,
          plan_line_id: l.id,
          project_id: l.project_id,
          organization_id: l.organization_id,
          unit_id: l.unit_id,
          contact_id: l.contact_id,
          visit_category: l.visit_category,
          primary_objective: l.planned_objective,
          visit_type: l.visit_type,
          tender_activity: l.tender_activity,
        }));
      });
  }, [params.planLine]);

  const onProject = (p: Project | null) => {
    setV((s) => ({
      ...s,
      project_id: p?.id ?? null,
      organization_id: p?.organization_id ?? s.organization_id,
      unit_id: p?.unit_id ?? s.unit_id,
      currency: p?.currency ?? s.currency,
    }));
  };

  const networking = masters.list('visit_objective').find((o) => o.value === v.primary_objective)?.tags.includes('networking');

  const submit = async (close: boolean) => {
    setError(null);
    if (!v.organization_id) return setError('Select the organization');
    if (!v.visit_category) return setError('Select the visit category');
    if (!v.primary_objective) return setError('Select the visit objective');
    if (!v.project_id && !networking) return setError('Select a project – or, for a visit to the customer only, choose a customer objective such as New Customer Introduction, Existing Customer Relationship, New Lead Identification or Unplanned / Courtesy');
    if (close && v.summary.trim().length < 30) return setError('Discussion summary must be at least 30 characters');
    if (close && !v.outcome) return setError('Select the outcome');
    const payload = {
      id,
      sales_person_id: me.id,
      ...v,
      tender_no: v.tender_no || null,
      brands_specified: v.brands_specified || null,
      next_action: v.next_action || null,
      summary: v.summary || null,
      checkin_at: checkinAt,
      checkin_lat: gps?.lat ?? null,
      checkin_lng: gps?.lng ?? null,
      checkout_at: close ? new Date().toISOString() : null,
      checkout_lat: close ? gps?.lat ?? null : null,
      checkout_lng: close ? gps?.lng ?? null : null,
      status: close ? 'closed' : 'open',
    };
    try {
      const res = await saveVisit(payload);
      dialog.toast(res === 'queued' ? 'No signal – visit saved on this device and will sync automatically' : close ? 'Visit saved' : 'Checked in');
      router.replace(res === 'queued' ? '/visits' : `/visits/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const tenderClosing = v.visit_type === 'tender' && ['Bid Submission', 'Tender Opening / Bid Opening'].includes(v.tender_activity ?? '');

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'Check in' }} />
      {gpsState === 'busy' ? <Notice>Getting your location…</Notice> : null}
      {gpsState === 'denied' ? <Notice tone={colors.amber}>Location unavailable – the visit will be saved without GPS and flagged for review.</Notice> : null}
      {gps ? <Muted>📍 Location captured at check-in</Muted> : null}
      <ErrorBanner message={error} />

      <Section title="Visit">
        <Card>
          <Segmented
            value={v.visit_type}
            onChange={(t) => set('visit_type', t)}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'tender', label: 'Tender' },
            ]}
          />
          {v.visit_type === 'tender' ? (
            <>
              <Select label="Tender activity" required value={v.tender_activity} options={masters.values('tender_activity').map((x) => ({ value: x, label: x }))} onChange={(x) => set('tender_activity', x)} />
              <Field label="Tender number" value={v.tender_no} onChangeText={(x) => set('tender_no', x)} />
              <DateField label="Closing / opening date" value={v.tender_date} onChange={(x) => set('tender_date', x)} />
            </>
          ) : null}
          <ProjectPicker value={v.project_id} onChange={onProject} required={!networking} onCreate={(q) => router.push({ pathname: '/projects/new', params: { pick: '1', name: q, organization: v.organization_id ?? '' } })} />
          {!v.project_id ? (
            <Muted>
              {networking
                ? 'No project needed for this objective – the visit is recorded against the customer.'
                : 'Tap a project in the list. Visiting the customer only? Choose a customer objective below (New Customer Introduction, Existing Customer Relationship, New Lead Identification, Unplanned / Courtesy) – then no project is needed.'}
            </Muted>
          ) : null}
          <CustomerPicker
            organizationId={v.organization_id}
            unitId={v.unit_id}
            contactId={v.contact_id}
            onChange={(c) =>
              setV((s) => ({
                ...s,
                organization_id: c.organizationId,
                unit_id: c.unitId,
                contact_id: c.contactId,
                visit_category: s.visit_category ?? c.organization?.visit_category ?? null,
              }))
            }
          />
          <Select label="Visit category" required value={v.visit_category} options={masters.values('visit_category').map((x) => ({ value: x, label: x }))} onChange={(x) => set('visit_category', x)} />
          <ObjectivePicker value={v.primary_objective} onChange={(x) => set('primary_objective', x)} required label="Primary objective" />
          <MultiSelect
            label="Secondary objectives (up to 3)"
            max={3}
            values={v.secondary_objectives}
            options={masters.list('visit_objective').map((o) => ({ value: o.value, label: o.value, group: o.grp }))}
            onChange={(x) => set('secondary_objectives', x)}
          />
        </Card>
      </Section>

      <Section title="Report">
        <Card>
          <Field
            label="Discussion summary"
            multiline
            value={v.summary}
            onChangeText={(x) => set('summary', x)}
            hint="Minimum 30 characters. Use the microphone on your keyboard for voice-to-text."
          />
          <Select label="Outcome" value={v.outcome} options={masters.values('visit_outcome').map((x) => ({ value: x, label: x }))} onChange={(x) => set('outcome', x)} />
          <MultiSelect label="Competitors mentioned" values={v.competitors_mentioned} options={competitors.map((c) => ({ value: c, label: c }))} onChange={(x) => set('competitors_mentioned', x)} />
          <Field label="Brands specified" value={v.brands_specified} onChangeText={(x) => set('brands_specified', x)} />
          <Select
            label="Currency"
            value={v.currency}
            onChange={(x) => set('currency', x as Currency)}
            options={[
              { value: 'LKR', label: 'LKR – Duty Paid' },
              { value: 'USD', label: 'USD – Duty Free' },
            ]}
          />
          <Row gap={8}>
            <NumberField label="Estimated project value" value={v.est_project_value} onChange={(x) => set('est_project_value', x)} />
            <NumberField label="Estimated lighting value" value={v.est_lighting_value} onChange={(x) => set('est_lighting_value', x)} />
          </Row>
          <Field label="Next action" value={v.next_action} onChangeText={(x) => set('next_action', x)} />
          <DateField label="Next action date" value={v.next_action_date} onChange={(x) => set('next_action_date', x)} hint="Creates a reminder for you" />
        </Card>
      </Section>

      {tenderClosing ? (
        <Notice tone={colors.amber}>This is a Bid Submission / Tender Opening visit: check in now, then record the tender result on the next screen before closing it.</Notice>
      ) : null}
      <Row wrap gap={8} style={{ marginTop: 12 }}>
        <Button title="Check in (report later)" variant="secondary" onPress={() => submit(false)} />
        {!tenderClosing ? <Button title="Save visit report" onPress={() => submit(true)} /> : null}
      </Row>
      <Muted style={{ marginTop: 8 }}>Photos, business cards and drawings can be added after saving.</Muted>
    </Screen>
  );
}
