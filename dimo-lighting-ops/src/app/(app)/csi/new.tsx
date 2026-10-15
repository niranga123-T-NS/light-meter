import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { CustomerPicker, ProjectPicker } from '@/components/pickers';
import { Button, Card, ErrorBanner, Field, MultiSelect, Muted, Screen, Section } from '@/components/ui';
import { CSI_STAGES, type CsiStage } from '@/lib/csi';
import { rpc, supabase } from '@/lib/supabase';
import type { Project } from '@/lib/types';

/** Start a CSI: who answers, which steps of the journey they went through, and how it is filled */
export default function NewCsi() {
  const [v, setV] = useState({ organization_id: null as string | null, unit_id: null as string | null, contact_id: null as string | null, project_id: null as string | null, contact_name: '', contact_role: '', stages: ['inquiry', 'quotation'] as CsiStage[] });
  const [error, setError] = useState<string | null>(null);
  const start = async (channel: 'tablet' | 'link' | 'call') => {
    setError(null);
    try {
      const id = await rpc<string>('csi_create', { p: { ...v, channel } });
      const { data } = await supabase.from('csi_surveys').select('token').eq('id', id).single();
      const token = (data as { token: string }).token;
      if (channel === 'tablet') router.replace(`/survey/${token}`);
      else if (channel === 'call') router.replace(`/survey/${token}?by=sales`);
      else router.replace(`/csi/${id}?share=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const onContact = async (contactId: string | null) => {
    if (!contactId) return;
    const { data } = await supabase.from('contacts').select('name, designation').eq('id', contactId).maybeSingle();
    if (data) setV((s) => ({ ...s, contact_name: s.contact_name || data.name, contact_role: s.contact_role || (data.designation ?? '') }));
  };
  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'New CSI' }} />
      <ErrorBanner message={error} />
      <Section title="Who answers">
        <Card>
          <CustomerPicker organizationId={v.organization_id} unitId={v.unit_id} contactId={v.contact_id} onChange={(c) => { setV((s) => ({ ...s, organization_id: c.organizationId, unit_id: c.unitId, contact_id: c.contactId })); onContact(c.contactId); }} />
          <ProjectPicker value={v.project_id} onChange={(p: Project | null) => setV((s) => ({ ...s, project_id: p?.id ?? null, organization_id: p?.organization_id ?? s.organization_id }))} />
          <Field label="Name of the person answering" required value={v.contact_name} onChangeText={(t) => setV((s) => ({ ...s, contact_name: t }))} />
          <Field label="Their role" value={v.contact_role} onChangeText={(t) => setV((s) => ({ ...s, contact_role: t }))} hint="e.g. Chief Engineer, Procurement Manager" />
          <MultiSelect label="Steps of the journey they went through" values={v.stages} options={CSI_STAGES.map((s) => ({ value: s.value, label: `${s.icon} ${s.label}` }))} onChange={(x) => setV((s) => ({ ...s, stages: x as CsiStage[] }))} />
          <Muted>Only these steps are shown in the journey screen.</Muted>
        </Card>
      </Section>
      <Section title="How it is filled">
        <Card style={{ gap: 10 }}>
          <Button title="📱 Hand my tablet to the customer now" onPress={() => start('tablet')} />
          <Button variant="secondary" title="🔗 Send a link (WhatsApp / e-mail)" onPress={() => start('link')} />
          <Button variant="secondary" title="☎ Fill it with the customer on a call" onPress={() => start('call')} />
          <Muted>The link opens without a login, works once and expires in 30 days. Answers come to you; a low score alerts SM Projects for a call-back within 48 hours.</Muted>
        </Card>
      </Section>
    </Screen>
  );
}
