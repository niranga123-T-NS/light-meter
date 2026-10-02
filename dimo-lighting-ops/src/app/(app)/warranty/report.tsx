import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { ProjectPicker } from '@/components/pickers';
import { Button, Card, colors, ErrorBanner, Field, Loading, Muted, Notice, NumberField, Row, Screen, Section } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** Sales person reports a warranty issue seen on a visit; Operations / Senior Electrical Engineer enter the claim. */
export default function ReportIssue() {
  const { visit } = useLocalSearchParams<{ visit?: string }>();
  const dialog = useDialog();
  const [customer, setCustomer] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState<number | null>(null);
  const [location, setLocation] = useState('');
  const [contact, setContact] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const v = useLoad(async () => {
    if (!visit) return null;
    const { data } = await supabase.from('visits').select('id, code, project_id, organizations(name), projects(name)').eq('id', visit).maybeSingle();
    return data as { id: string; code: string; project_id: string | null; organizations: { name: string } | null; projects: { name: string } | null } | null;
  }, [visit]);
  if (visit && !v.data && !v.error) return <Screen><Loading /></Screen>;
  const fromVisit = v.data;
  const cust = customer ?? fromVisit?.organizations?.name ?? '';

  const save = () => {
    setError(null);
    if (!fromVisit && !cust.trim()) return setError('Enter the customer');
    if (!description.trim()) return setError('Describe what you saw');
    return dialog.run(async () => {
      const id = await rpc<string>('report_warranty_issue', {
        p_data: {
          visit_id: fromVisit?.id ?? '',
          customer: cust,
          project_id: projectId ?? '',
          project_name: projectName,
          description,
          quantity: quantity == null ? '' : String(quantity),
          location,
          site_contact: contact,
        },
      });
      setSaved(id);
    }, 'Reported – Operations and the Senior Electrical Engineer are notified');
  };

  if (saved)
    return (
      <Screen maxWidth={760}>
        <Stack.Screen options={{ title: 'Warranty issue reported' }} />
        <Notice tone={colors.green}>Reported. Operations and the Senior Electrical Engineer will enter the claim – you will be notified when it is opened and closed.</Notice>
        <Attachments entityType="warranty_report" entityId={saved} kinds={['report_photo']} title="Add photos" canUpload allowCamera />
        <Row style={{ marginTop: 12 }}>
          <Button title="Done" onPress={() => router.replace({ pathname: '/warranty', params: { tab: 'reports' } })} />
        </Row>
      </Screen>
    );

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'Report warranty issue' }} />
      <ErrorBanner message={error ?? v.error} />
      {fromVisit ? (
        <Notice tone={colors.blue}>{`From visit ${fromVisit.code} · ${fromVisit.organizations?.name ?? ''}${fromVisit.projects?.name ? ` · ${fromVisit.projects.name}` : ''}`}</Notice>
      ) : null}
      <Section title="Where">
        <Card>
          {!fromVisit ? (
            <>
              <Field label="Customer" required value={cust} onChangeText={setCustomer} />
              <ProjectPicker
                label="Project (if in the system)"
                value={projectId}
                onChange={(p) => {
                  setProjectId(p?.id ?? null);
                  setProjectName(p?.name ?? '');
                }}
              />
              {!projectId ? <Field label="Project / site name" value={projectName} onChangeText={setProjectName} /> : null}
            </>
          ) : null}
          <Field label="Location on site" value={location} onChangeText={setLocation} hint="e.g. Lobby ceiling, car park poles" />
          <Field label="Customer contact on site" value={contact} onChangeText={setContact} hint="Name and phone" />
        </Card>
      </Section>
      <Section title="What you saw">
        <Card>
          <Field label="Description" required multiline value={description} onChangeText={setDescription} hint="e.g. About 15 downlights flickering, some not lighting" />
          <NumberField label="Approx. quantity" value={quantity} onChange={setQuantity} />
          <Muted>You can add photos after saving.</Muted>
        </Card>
      </Section>
      <Row style={{ marginTop: 12 }}>
        <Button title="Report issue" onPress={save} />
      </Row>
    </Screen>
  );
}
