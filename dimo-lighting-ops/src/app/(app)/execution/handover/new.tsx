import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { useDialog } from '@/components/dialog';
import { AreaPicker } from '@/components/exec/AreaPicker';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, DateField, ErrorBanner, Field, Muted, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import type { ExecRequest } from '@/lib/execution';
import { pickDocument, pickImage, uploadAttachment, type PickedFile } from '@/lib/files';
import { fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type WonProject = { id: string; code: string | null; name: string; project_value: number | null; location: string | null; city: string | null; organizations: { name: string } | null };

/**
 * Hand a project to the execution team – SM Projects approves and assigns the Senior Electrical Engineer.
 *  kind=won: the Operations Executive picks a won project from the system.
 *  kind=legacy: the Senior Electrical Engineer enters a project won before the system.
 */
export default function NewHandover() {
  const dialog = useDialog();
  const people = usePeople();
  const { kind = 'won' } = useLocalSearchParams<{ kind?: 'won' | 'legacy' }>();
  const legacy = kind === 'legacy';
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [f, setF] = useState({
    project_id: null as string | null,
    name: '',
    client_name: '',
    contract_value: null as number | null,
    contract_ref: '',
    site_address: '',
    start_date: null as string | null,
    end_date: null as string | null,
    areas: [] as string[],
    see_id: null as string | null,
    note: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const { data: won } = useLoad(async () => {
    if (legacy) return [] as WonProject[];
    const [p, e, r] = await Promise.all([
      supabase.from('projects').select('id, code, name, project_value, location, city, organizations(name)').eq('status', 'won').order('name'),
      supabase.from('exec_projects').select('project_id'),
      supabase.from('exec_requests').select('project_id, status').eq('status', 'pending_smp'),
    ]);
    const taken = new Set([...(e.data ?? []), ...((r.data ?? []) as Pick<ExecRequest, 'project_id'>[])].map((x) => x.project_id));
    return ((p.data ?? []) as unknown as WonProject[]).filter((x) => !taken.has(x.id));
  }, [legacy]);
  const sel = won?.find((p) => p.id === f.project_id);
  const sees = Object.values(people).filter((p) => p.role === 'senior_elec_engineer' && p.active);

  const addFile = async () => {
    const x = Platform.OS === 'web' ? await pickDocument() : await pickImage(false);
    if (x) setFiles((s) => [...s, x]);
  };
  const save = async () => {
    setError(null);
    if (!legacy && !f.project_id) return setError('Choose the won project');
    if (legacy && (!f.name.trim() || !f.client_name.trim())) return setError('Enter the project name and the client');
    if (legacy && !f.areas.length) return setError('Choose at least one project area');
    await dialog.run(async () => {
      const id = await rpc<string>('request_execution', {
        p: { ...f, kind, contract_value: f.contract_value ?? '', start_date: f.start_date ?? '', end_date: f.end_date ?? '', see_id: f.see_id ?? '' },
      });
      for (const x of files) await uploadAttachment('exec_request', id, 'handover_doc', x);
      router.replace(`/execution/handover/${id}`);
    }, 'Sent to SM Projects');
  };

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: legacy ? 'Project won before the system' : 'Hand over to execution' }} />
      <TestingBanner what="Hand-over to execution" />
      <ErrorBanner message={error} />
      <Section title="Project">
        <Card>
          {legacy ? (
            <>
              <Field label="Project name" required value={f.name} onChangeText={(v) => set('name', v)} />
              <Field label="Client" required value={f.client_name} onChangeText={(v) => set('client_name', v)} />
              <NumberField label="Contract value (LKR)" value={f.contract_value} onChange={(v) => set('contract_value', v)} />
              <Field label="Contract / PO reference" value={f.contract_ref} onChangeText={(v) => set('contract_ref', v)} />
              <Muted>Projects entered here have no sales record: variations are priced at contract rates.</Muted>
            </>
          ) : (
            <>
              <Select
                label="Won project"
                required
                searchable
                value={f.project_id}
                onChange={(v) => {
                  const p = won?.find((x) => x.id === v);
                  setF((s) => ({ ...s, project_id: v, site_address: s.site_address || [p?.location, p?.city].filter(Boolean).join(', ') }));
                }}
                options={(won ?? []).map((p) => ({ value: p.id, label: `${p.code ?? ''} ${p.name}`, hint: p.organizations?.name }))}
              />
              {won && !won.length ? <Muted>No won projects are waiting for hand-over.</Muted> : null}
              {sel ? <Muted>{`${sel.organizations?.name ?? ''}${sel.project_value ? ` · ${fmtMoney(sel.project_value, 'LKR')}` : ''}`}</Muted> : null}
              <Field label="Contract / PO reference" value={f.contract_ref} onChangeText={(v) => set('contract_ref', v)} />
            </>
          )}
          <Select label={legacy ? 'Senior Electrical Engineer (you, unless changed)' : 'Proposed Senior Electrical Engineer'} value={f.see_id} onChange={(v) => set('see_id', v)} options={sees.map((p) => ({ value: p.id, label: p.full_name }))} />
          <Field label="Site address" multiline value={f.site_address} onChangeText={(v) => set('site_address', v)} />
          <Row wrap gap={8}>
            <DateField label="Start" value={f.start_date} onChange={(v) => set('start_date', v)} quick={[0, 7, 14]} />
            <DateField label="Planned finish" value={f.end_date} onChange={(v) => set('end_date', v)} quick={[]} />
          </Row>
          <Field label="Note to SM Projects" multiline value={f.note} onChangeText={(v) => set('note', v)} />
        </Card>
      </Section>
      <Section title={`Project areas (${f.areas.length} chosen)${legacy ? '' : ' – optional, the SEE can set them'}`}>
        <Card>
          <AreaPicker value={f.areas} onChange={(v) => set('areas', v)} />
        </Card>
      </Section>
      <Section title="Contract documents">
        <Card>
          <Row wrap gap={6}>
            <Button small variant="secondary" title="+ Contract / PO / drawings" onPress={() => dialog.run(addFile)} />
            {files.map((x, i) => (
              <Button key={`${x.name}-${i}`} small variant="ghost" title={`✕ ${x.name}`} onPress={() => setFiles(files.filter((_, k) => k !== i))} />
            ))}
          </Row>
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Send to SM Projects" onPress={save} />
      </Row>
    </Screen>
  );
}
