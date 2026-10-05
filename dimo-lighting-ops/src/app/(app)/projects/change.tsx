import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { CustomerPicker } from '@/components/pickers';
import { Button, Card, DateField, ErrorBanner, Field, Loading, Muted, Notice, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { MILESTONES } from '@/lib/constants';
import { useLoad, useMasters } from '@/lib/hooks';
import { CHANGE_FIELDS, FIELD_LABEL } from '@/lib/projectChanges';
import { PROJECT_TYPES } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Project } from '@/lib/types';

type Draft = Pick<Project, (typeof CHANGE_FIELDS)[number]>;

/** The sales person changes project details by request: SM Projects approves before anything changes. */
export default function RequestProjectChange() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const masters = useMasters();
  const [d, setD] = useState<Draft | null>(null);
  const [reason, setReason] = useState('');
  const { data, error } = useLoad(async () => {
    const { data: p, error: e } = await supabase.from('projects').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    return p as Project;
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const p = data;
  const f: Draft = d ?? (Object.fromEntries(CHANGE_FIELDS.map((k) => [k, p[k]])) as Draft);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...f, [k]: v });
  const band = MILESTONES.find((m) => m.value === f.milestone);
  const changed = CHANGE_FIELDS.filter((k) => (f[k] ?? null) !== (p[k] ?? null) && !(f[k] === '' && p[k] == null));
  const manager = me.role === 'sm_projects' || me.role === 'gm';
  const cur = f.duty_status === 'duty_free' ? 'USD' : 'LKR';

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: `Request changes · ${p.code}` }} />
      <Notice>
        {manager
          ? 'As SM Projects / GM you can also edit directly on the project.'
          : 'Change what is needed and give the reason. SM Projects approves before anything changes – you are told of the decision.'}
      </Notice>
      <Section title="Project">
        <Card>
          <Field label="Project name" required value={f.name} onChangeText={(v) => set('name', v)} />
          <Select label="Project type" value={f.project_type} options={PROJECT_TYPES.map((t) => ({ value: t.value, label: t.label, hint: t.line }))} onChange={(v) => set('project_type', v as Draft['project_type'])} />
          <CustomerPicker
            showContact={false}
            organizationId={f.organization_id}
            unitId={f.unit_id}
            onChange={(c) => c.organizationId && setD({ ...f, organization_id: c.organizationId, unit_id: c.unitId })}
          />
          <Field label="City" value={f.city ?? ''} onChangeText={(v) => set('city', v)} />
          <Field label="Location / address" value={f.location ?? ''} onChangeText={(v) => set('location', v)} />
        </Card>
      </Section>
      <Section title="Stage and probability">
        <Card>
          <Select label="Project stage" value={f.stage} options={masters.values('project_stage').map((v) => ({ value: v, label: v }))} onChange={(v) => set('stage', v)} />
          <Select
            label="Milestone"
            value={f.milestone}
            options={MILESTONES.map((m) => ({ value: m.value, label: `${m.label} – default ${m.def}% (${m.lo}–${m.hi}%)` }))}
            onChange={(v) => {
              const m = MILESTONES.find((x) => x.value === v);
              setD({ ...f, milestone: v as Draft['milestone'], win_probability: m && (f.win_probability < m.lo || f.win_probability > m.hi) ? m.def : f.win_probability });
            }}
          />
          <NumberField
            label="Win probability"
            suffix="%"
            value={f.win_probability}
            onChange={(v) => set('win_probability', v ?? 0)}
            hint={band ? `Band for this milestone ${band.lo}–${band.hi}% (outside it, say why in the reason)` : undefined}
          />
          <Select
            label="Specification"
            value={f.spec_status}
            options={[
              { value: 'not_specified', label: 'Not specified' },
              { value: 'our_brand', label: 'Our brand specified' },
              { value: 'competitor', label: 'Competitor specified' },
              { value: 'open', label: 'Open or equal' },
            ]}
            onChange={(v) => set('spec_status', v)}
          />
        </Card>
      </Section>
      <Section title="Value and dates">
        <Card>
          <Select
            label="Duty status (sets the currency)"
            value={f.duty_status}
            onChange={(v) => set('duty_status', v as Draft['duty_status'])}
            options={[
              { value: 'duty_paid', label: 'Duty Paid – LKR' },
              { value: 'duty_free', label: 'Duty Free – USD' },
            ]}
          />
          <NumberField label="Project value" suffix={cur} value={f.project_value} onChange={(v) => set('project_value', v)} />
          <NumberField label="Lighting value" suffix={cur} value={f.lighting_value} onChange={(v) => set('lighting_value', v)} />
          <DateField label="Expected tender date" value={f.expected_tender_date} onChange={(v) => set('expected_tender_date', v)} quick={[]} />
          <DateField label="Expected award date" value={f.expected_award_date} onChange={(v) => set('expected_award_date', v)} quick={[]} />
          <NumberField label="Expected duration to order / award" suffix="months" value={f.expected_duration_months} onChange={(v) => set('expected_duration_months', v ?? f.expected_duration_months)} />
          <Select
            label="Project term"
            value={f.project_term}
            onChange={(v) => set('project_term', v as Draft['project_term'])}
            options={[
              { value: 'short', label: 'Short term (up to 6 months)' },
              { value: 'medium', label: 'Medium term (7–18 months)' },
              { value: 'long', label: 'Long term (over 18 months)' },
            ]}
          />
        </Card>
      </Section>
      <Section title="Send to SM Projects">
        <Card>
          <Muted>{changed.length ? `Changing: ${changed.map((k) => FIELD_LABEL[k]).join(', ')}` : 'Nothing changed yet.'}</Muted>
          <Field label="Reason for the change" required multiline value={reason} onChangeText={setReason} />
          <Row gap={8} style={{ marginTop: 6 }}>
            <Button
              title="Send for approval"
              disabled={!changed.length || !reason.trim()}
              onPress={() =>
                dialog.run(async () => {
                  await rpc('request_project_change', { p_project: p.id, p_changes: Object.fromEntries(changed.map((k) => [k, f[k] === '' ? null : f[k]])), p_reason: reason });
                  router.back();
                }, 'Sent to SM Projects')
              }
            />
            <Button variant="ghost" title="Cancel" onPress={() => router.back()} />
          </Row>
        </Card>
      </Section>
    </Screen>
  );
}
