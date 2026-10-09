import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, DateField, ErrorBanner, Field, MultiSelect, Muted, Row, Screen, Section, Select } from '@/components/ui';
import type { ExecProject } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import { addSubcontractor, loadSubcontractors, NEW_SUB, subOptions } from '@/lib/subcontractors';

/** Temporary Assistant Engineer / Trainee request (SEE) – or, with ?nominate=<project>, a subcontractor supervisor nomination. */
export function AccessForm({ nominate }: { nominate?: string }) {
  const dialog = useDialog();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    role_type: 'assistant_engineer',
    person_name: '',
    company: '',
    email: '',
    phone: '',
    id_no: '',
    zones: '',
    project_ids: nominate ? [nominate] : ([] as string[]),
    start_date: null as string | null,
    end_date: null as string | null,
    reason: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const { data: projects } = useLoad(async () => {
    const { data } = await supabase.from('exec_projects').select('*').eq('status', 'active').order('name');
    return (data ?? []) as ExecProject[];
  });
  const { data: subs, reload: reloadSubs } = useLoad(() => (nominate ? loadSubcontractors(nominate) : Promise.resolve([])), [nominate]);
  const project = projects?.find((p) => p.id === nominate);

  const save = async () => {
    setError(null);
    await dialog.run(async () => {
      if (nominate) await rpc('nominate_supervisor', { p_exec: nominate, p: { ...f, start_date: f.start_date ?? '', end_date: f.end_date ?? '' } });
      else await rpc('request_temp_staff', { p: { ...f, start_date: f.start_date ?? '', end_date: f.end_date ?? '' } });
      router.back();
    }, nominate ? 'Nominated – SM Projects approves before a login is issued' : 'Requested – SM Projects, then DGM / GM approve');
  };

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: nominate ? 'Nominate subcontractor supervisor' : 'Request temporary staff' }} />
      <TestingBanner what="Team & access" />
      <ErrorBanner message={error} />
      <Section title={nominate ? `Supervisor for ${project?.name ?? 'the project'}` : 'Person'}>
        <Card>
          {!nominate ? (
            <Select
              label="Role"
              required
              value={f.role_type}
              onChange={(v) => set('role_type', v)}
              options={[
                { value: 'assistant_engineer', label: 'Temporary Assistant Engineer', hint: 'Same rights as an Assistant Engineer' },
                { value: 'trainee', label: 'Trainee', hint: 'Records and submits work; cannot verify or approve' },
              ]}
            />
          ) : null}
          <Field label="Name" required value={f.person_name} onChangeText={(v) => set('person_name', v)} />
          {nominate ? (
            <Select
              label="Subcontractor company"
              required
              value={f.company || null}
              onChange={async (v) => {
                if (v !== NEW_SUB) return set('company', v ?? '');
                const n = await addSubcontractor(dialog.prompt, nominate).catch((e) => (dialog.toast((e as Error).message, 'error'), null));
                if (n) {
                  await reloadSubs();
                  set('company', n);
                }
              }}
              options={subOptions(subs ?? [], { canAdd: true })}
              hint="From the project's subcontractors (Team → Subcontractors)"
            />
          ) : null}
          <Field label={nominate ? 'Mobile number (the login)' : 'Mobile number'} required={!!nominate} keyboardType="phone-pad" value={f.phone} onChangeText={(v) => set('phone', v)} />
          <Field label={nominate ? 'Email (optional)' : 'Email (the login; or use the mobile number)'} autoCapitalize="none" keyboardType="email-address" value={f.email} onChangeText={(v) => set('email', v)} />
          <Field label={nominate ? 'NIC / site pass number' : 'Employee or contract ID'} required value={f.id_no} onChangeText={(v) => set('id_no', v)} />
          {nominate ? <Field label="Zones or work packages" value={f.zones} onChangeText={(v) => set('zones', v)} /> : null}
        </Card>
      </Section>
      <Section title={nominate ? 'Access validity' : 'Projects and period'}>
        <Card>
          {!nominate ? (
            <MultiSelect label="Projects" values={f.project_ids} onChange={(v) => set('project_ids', v)} options={(projects ?? []).map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}` }))} />
          ) : null}
          <Row wrap gap={8}>
            <DateField label="From" required value={f.start_date} onChange={(v) => set('start_date', v)} quick={[0, 1, 7]} />
            <DateField label={nominate ? 'Until' : 'Expected end'} required value={f.end_date} onChange={(v) => set('end_date', v)} quick={[30, 60, 90]} />
          </Row>
          <Field label={nominate ? 'Note (optional)' : 'Reason'} required={!nominate} multiline value={f.reason} onChangeText={(v) => set('reason', v)} />
          <Muted>
            {nominate
              ? 'No login is issued until SM Projects approves. Access ends automatically on the end date or when you remove the supervisor.'
              : 'The login is created after SM Projects and then DGM / GM approve. You will be reminded before the expected end date.'}
          </Muted>
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title={nominate ? 'Nominate' : 'Send request'} onPress={save} />
      </Row>
    </Screen>
  );
}

