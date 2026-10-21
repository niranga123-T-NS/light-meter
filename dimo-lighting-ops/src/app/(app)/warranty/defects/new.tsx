import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { ReportedLocationField, saveReportedLocation, type RepLoc } from '@/components/ReportedLocation';
import { Button, Card, ErrorBanner, Field, Loading, Muted, Notice, Row, Screen, Section, Select, colors } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { DEFECT_CATEGORY, DEFECT_LOGGERS, DEFECT_SOURCE, PHASE, SEVERITY, type DefectProject } from '@/lib/defects';
import { useLoad } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { rpc } from '@/lib/supabase';

const OTHER = '__other';

/** Report (sales) or log (SM Projects, SEE, AE) a project defect. Photos are added on the next screen. */
export default function NewDefect() {
  const me = useMe();
  const dialog = useDialog();
  const params = useLocalSearchParams<{ project?: string }>();
  const sales = isSales(me.role);
  const logger = DEFECT_LOGGERS.includes(me.role);
  const [f, setF] = useState({
    project: params.project ?? '',
    projectName: '',
    customer: '',
    site: '',
    location: '',
    title: '',
    description: '',
    category: '',
    severity: '',
    source: 'site',
    clientRef: '',
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [rep, setRep] = useState<RepLoc>(null);
  const { data, error } = useLoad(() => rpc<DefectProject[]>('defect_projects'));
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const key = (p: DefectProject) => p.exec_project_id ?? p.project_id ?? '';
  const chosen = data.find((p) => key(p) === f.project);

  const save = () =>
    dialog.run(async () => {
      const id = await rpc<string>('log_defect', {
        p: {
          exec_project_id: chosen?.exec_project_id ?? null,
          project_id: chosen?.project_id ?? null,
          project_name: f.project === OTHER ? f.projectName : null,
          customer: f.customer || null,
          site: f.site || null,
          location: f.location,
          title: f.title,
          description: f.description,
          category: f.category,
          severity: f.severity,
          source: logger ? f.source : 'sales',
          client_ref: f.clientRef || null,
        },
      });
      await saveReportedLocation('project_defect', id, rep);
      router.replace(`/warranty/defects/${id}`);
    }, sales ? 'Reported – add photos if you have them' : 'Logged – add photos');

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: sales ? 'Report a project defect' : 'Log a project defect' }} />
      <Notice tone={colors.blue}>
        {sales
          ? 'A defect in the work DIMO installed (lights not working, cables, poles, controls …). The SEE or SM Projects verifies it and assigns an engineer; you are told at each step. A faulty product under its warranty is a product warranty claim instead.'
          : 'Logged defects are open at once. The SEE or SM Projects assigns the engineer, who is responsible and the due date.'}
      </Notice>
      <Section title="Project">
        <Card style={{ gap: 4 }}>
          <Select
            label="Project"
            required
            searchable
            value={f.project}
            onChange={(v) => set({ project: v })}
            options={[
              ...data.map((p) => ({ value: key(p), label: p.name, hint: [p.customer, PHASE[p.phase]].filter(Boolean).join(' · ') })),
              { value: OTHER, label: 'A project not in the list' },
            ]}
          />
          {f.project === OTHER ? (
            <>
              <Field label="Project name" required value={f.projectName} onChangeText={(v) => set({ projectName: v })} />
              <Field label="Customer" value={f.customer} onChangeText={(v) => set({ customer: v })} />
              <Field label="Site address" value={f.site} onChangeText={(v) => set({ site: v })} />
            </>
          ) : chosen ? (
            <Muted>{[chosen.customer, chosen.site, PHASE[chosen.phase]].filter(Boolean).join(' · ')}</Muted>
          ) : null}
          <Field label="Where on the site" value={f.location} onChangeText={(v) => set({ location: v })} placeholder="e.g. Car park poles 4–7, mast M3, lobby DB" />
          <ReportedLocationField value={rep} onChange={setRep} query={[chosen?.name ?? f.projectName, chosen?.site ?? f.site].filter(Boolean).join(' ')} projectId={chosen?.project_id ?? null} />
        </Card>
      </Section>
      <Section title="The defect">
        <Card style={{ gap: 4 }}>
          <Field label="Short title" required value={f.title} onChangeText={(v) => set({ title: v })} placeholder="e.g. Car park lights flicker" />
          <Field
            label="What is wrong"
            required
            multiline
            value={f.description}
            onChangeText={(v) => set({ description: v })}
            placeholder="What the customer or you saw, since when, how many fittings / circuits"
          />
          <Select label="Category" required value={f.category} onChange={(v) => set({ category: v })} options={DEFECT_CATEGORY} />
          <Select label="Severity" required value={f.severity} onChange={(v) => set({ severity: v })} options={SEVERITY} hint="Sets the default time to rectify" />
          {logger ? <Select label="Found by" value={f.source} onChange={(v) => set({ source: v })} options={DEFECT_SOURCE} /> : null}
          <Field label="Client reference (letter, email, complaint no.)" value={f.clientRef} onChangeText={(v) => set({ clientRef: v })} />
        </Card>
      </Section>
      <Row gap={8}>
        <Button title={sales ? 'Report the defect' : 'Log the defect'} onPress={save} disabled={!f.project || !f.title || !f.category || !f.severity} />
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
      </Row>
    </Screen>
  );
}
