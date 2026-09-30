import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { useDialog } from '@/components/dialog';
import { CustomerPicker, handOffProject, PersonPicker } from '@/components/pickers';
import { Button, Card, colors, DateField, ErrorBanner, Field, ListRow, Muted, Notice, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { captureLocation } from '@/components/VisitBits';
import { useMe } from '@/lib/auth';
import { useMasters } from '@/lib/hooks';
import { isSales, PROJECT_TYPES } from '@/lib/roles';
import { rpc } from '@/lib/supabase';
import type { DutyStatus, ProjectType } from '@/lib/types';

type Match = { id: string; code: string; name: string; customer: string; stage: string; owner: string; open_inquiries: number; similarity: number; exact: boolean; distance_m: number | null };

const termFor = (m: number | null) => (m == null ? null : m <= 6 ? 'short' : m <= 18 ? 'medium' : 'long');

/** Create a project (Sections 4.9, 5.6): duplicate check, mandatory term and duration, owner assignment by managers. */
export default function NewProject() {
  const me = useMe();
  const dialog = useDialog();
  const masters = useMasters();
  const sales = isSales(me.role);
  // Opened from a visit or inquiry form: go back to it with the project selected
  const params = useLocalSearchParams<{ pick?: string; name?: string; organization?: string }>();
  const done = (id: string) => {
    if (params.pick && router.canGoBack()) {
      handOffProject(id);
      router.back();
    } else router.replace(`/projects/${id}`);
  };
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [differentReason, setDifferentReason] = useState('');
  const [f, setF] = useState({
    name: params.name ?? '',
    project_type: (sales ? me.project_types[0] : null) as ProjectType | null,
    organization_id: (params.organization || null) as string | null,
    unit_id: null as string | null,
    city: '',
    location: '',
    lat: null as number | null,
    lng: null as number | null,
    stage: 'Concept',
    duty_status: null as DutyStatus | null,
    project_value: null as number | null,
    lighting_value: null as number | null,
    expected_duration_months: null as number | null,
    project_term: null as string | null,
    term_reason: '',
    expected_tender_date: null as string | null,
    owner_id: null as string | null,
    first_visit_due: null as string | null,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const suggested = termFor(f.expected_duration_months);
  const term = f.project_term ?? suggested;

  const check = async () => {
    if (!f.name.trim()) return;
    const res = await rpc<Match[]>('find_similar_projects', { p_name: f.name, p_organization_id: f.organization_id, p_lat: f.lat, p_lng: f.lng }).catch(() => []);
    setMatches(res);
  };

  const save = async () => {
    setError(null);
    if (!f.name.trim() || !f.project_type || !f.organization_id) return setError('Name, project type and customer are required');
    if (!f.expected_duration_months) return setError('Expected duration (months) is mandatory');
    if (!sales && !f.owner_id) return setError('Assign a sales person before saving');
    if (term !== suggested && !f.term_reason.trim()) return setError('Give a reason for changing the suggested project term');
    const res = matches ?? (await rpc<Match[]>('find_similar_projects', { p_name: f.name, p_organization_id: f.organization_id, p_lat: f.lat, p_lng: f.lng }).catch(() => []));
    if (!matches) setMatches(res);
    if (res.some((m) => m.exact)) return setError('A project with this name already exists for this customer – select it instead.');
    if (res.length && !differentReason.trim()) return setError('Similar projects exist. Use one of them, or confirm this is a different project and give a reason.');
    await dialog.run(async () => {
      const id = await rpc<string>('create_project', {
        p: {
          ...f,
          project_term: term,
          owner_id: sales ? me.id : f.owner_id,
          lat: f.lat ?? '',
          lng: f.lng ?? '',
          first_visit_due: f.first_visit_due ?? '',
          expected_tender_date: f.expected_tender_date ?? '',
        },
        p_reason: term !== suggested ? f.term_reason : null,
        p_duplicate_reason: res.length ? differentReason : null,
      });
      done(id);
    }, 'Project created');
  };

  const types = PROJECT_TYPES.filter((t) => !sales || me.project_types.includes(t.value));

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'New project' }} />
      <ErrorBanner message={error} />
      <Card>
        <Field
          label="Project name"
          required
          value={f.name}
          onChangeText={(v) => { set('name', v); setMatches(null); }}
          onBlur={check}
          hint="Format: Customer / Developer – Project name – City (e.g. ABC Hotels – Beach Resort – Galle)"
        />
        <Select label="Project type" required value={f.project_type} options={types.map((t) => ({ value: t.value, label: t.label, hint: t.line }))} onChange={(v) => set('project_type', v as ProjectType)} />
        <CustomerPicker
          showContact={false}
          organizationId={f.organization_id}
          unitId={f.unit_id}
          onChange={(c) => { setF((s) => ({ ...s, organization_id: c.organizationId, unit_id: c.unitId })); setMatches(null); }}
        />
        <Row>
          <Button small variant="ghost" title="+ New customer" onPress={() => router.push('/customers/new')} />
        </Row>
        <Field label="City" value={f.city} onChangeText={(v) => set('city', v)} onBlur={check} />
        <Field label="Location / address" value={f.location} onChangeText={(v) => set('location', v)} />
        <Row gap={8} wrap>
          <Button
            small
            variant="secondary"
            title={f.lat ? `📍 ${f.lat.toFixed(4)}, ${f.lng?.toFixed(4)}` : '📍 Use my current location as the site'}
            onPress={async () => {
              const pos = await captureLocation();
              if (pos) setF((s) => ({ ...s, lat: pos.lat, lng: pos.lng }));
              else dialog.toast('Location unavailable', 'error');
            }}
          />
        </Row>
      </Card>

      {matches && matches.length ? (
        <Section title="Possible duplicates">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {matches.map((m) => (
              <ListRow
                key={m.id}
                title={m.name}
                subtitle={`${m.code} · ${m.customer} · ${m.stage} · ${m.owner} · ${m.open_inquiries} open inquiries${m.distance_m != null ? ` · ${Math.round(m.distance_m)} m away` : ''}`}
                highlight={m.exact ? colors.red : colors.amber}
                right={<Button small title="Use this project" onPress={() => done(m.id)} />}
              />
            ))}
          </Card>
          {!matches.some((m) => m.exact) ? (
            <Card style={{ marginTop: 8 }}>
              <Field label="This is a different project – reason" required multiline value={differentReason} onChangeText={setDifferentReason} />
            </Card>
          ) : (
            <Notice tone={colors.red}>An exact match exists for this customer. Select it instead.</Notice>
          )}
        </Section>
      ) : null}

      <Section title="Stage and value">
        <Card>
          <Select label="Project stage" value={f.stage} options={masters.values('project_stage').map((v) => ({ value: v, label: v }))} onChange={(v) => set('stage', v)} />
          <Select
            label="Duty status (sets the currency)"
            value={f.duty_status}
            onChange={(v) => set('duty_status', v as DutyStatus)}
            options={[
              { value: 'duty_paid', label: 'Duty Paid – LKR' },
              { value: 'duty_free', label: 'Duty Free – USD' },
            ]}
          />
          <NumberField label="Estimated project value" suffix={f.duty_status === 'duty_free' ? 'USD' : 'LKR'} value={f.project_value} onChange={(v) => set('project_value', v)} />
          <NumberField label="Estimated lighting value" suffix={f.duty_status === 'duty_free' ? 'USD' : 'LKR'} value={f.lighting_value} onChange={(v) => set('lighting_value', v)} />
          <DateField label="Expected tender date" value={f.expected_tender_date} onChange={(v) => set('expected_tender_date', v)} quick={[]} />
        </Card>
      </Section>

      <Section title="Project term (mandatory)">
        <Card>
          <NumberField label="Expected duration to order / award" suffix="months" required value={f.expected_duration_months} onChange={(v) => set('expected_duration_months', v)} />
          <Select
            label="Project term"
            value={term}
            hint={suggested ? `Suggested: ${suggested} (short ≤ 6, medium 7–18, long > 18 months)` : undefined}
            onChange={(v) => set('project_term', v)}
            options={[
              { value: 'short', label: 'Short term (up to 6 months)' },
              { value: 'medium', label: 'Medium term (7–18 months)' },
              { value: 'long', label: 'Long term (over 18 months)' },
            ]}
          />
          {term && suggested && term !== suggested ? <Field label="Reason for changing the term" required value={f.term_reason} onChangeText={(v) => set('term_reason', v)} /> : null}
          <Muted>Expected award date is calculated from today + duration and can be edited on the project.</Muted>
        </Card>
      </Section>

      {!sales ? (
        <Section title="Assignment">
          <Card>
            <PersonPicker
              label="Sales person"
              required
              roles={f.project_type && ['infrastructure', 'industrial'].includes(f.project_type) ? ['asm_infra', 'asm_building'] : ['asm_building', 'asm_infra']}
              value={f.owner_id}
              onChange={(v) => set('owner_id', v)}
              hint="The sales person is notified and a first-visit action is added"
            />
            <DateField label="First visit due" value={f.first_visit_due} onChange={(v) => set('first_visit_due', v)} hint="Default: 5 working days" />
          </Card>
        </Section>
      ) : null}

      <Row style={{ marginTop: 16 }}>
        <Button title="Create project" onPress={save} />
      </Row>
      <Text style={{ height: 24 }} />
    </Screen>
  );
}
