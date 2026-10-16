import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { CustomerPicker, ProjectPicker } from '@/components/pickers';
import { Button, Card, ErrorBanner, Field, Loading, MultiSelect, Muted, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { useLoad } from '@/lib/hooks';
import { CSI_STAGES, type CsiStage } from '@/lib/csi';
import { rpc, supabase } from '@/lib/supabase';
import type { Project } from '@/lib/types';

/** Start a CSI: who answers, which steps of the journey they went through, and how it is filled.
 *  A sales person picks any customer; the SEE picks one of their execution projects (its client answers about the site work). */
export default function NewCsi() {
  const me = useMe();
  const see = me.role === 'senior_elec_engineer';
  const { data: mine } = useLoad(async () => {
    if (!see) return [];
    const { data } = await supabase.from('exec_projects').select('project_id, code, name').eq('see_id', me.id).eq('status', 'active').order('name');
    return (data ?? []) as { project_id: string; code: string | null; name: string }[];
  }, [see]);
  const [v, setV] = useState({ organization_id: null as string | null, unit_id: null as string | null, contact_id: null as string | null, project_id: null as string | null, contact_name: '', contact_role: '', stages: (see ? ['installation', 'handover'] : ['inquiry', 'quotation']) as CsiStage[] });
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
  if (see && !mine) return <Screen><Loading /></Screen>;
  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'New CSI' }} />
      <ErrorBanner message={error} />
      <Section title="Who answers">
        <Card>
          {see ? (
            <Select label="Your project" required value={v.project_id} onChange={(id) => setV((s) => ({ ...s, project_id: id }))} options={(mine ?? []).map((p) => ({ value: p.project_id, label: `${p.code ? `${p.code} · ` : ''}${p.name}` }))} hint="The client of this project answers – about the site work, testing and handover." />
          ) : (
            <>
              <CustomerPicker organizationId={v.organization_id} unitId={v.unit_id} contactId={v.contact_id} onChange={(c) => { setV((s) => ({ ...s, organization_id: c.organizationId, unit_id: c.unitId, contact_id: c.contactId })); onContact(c.contactId); }} />
              <ProjectPicker value={v.project_id} onChange={(p: Project | null) => setV((s) => ({ ...s, project_id: p?.id ?? null, organization_id: p?.organization_id ?? s.organization_id }))} />
            </>
          )}
          <Field label="Name of the person answering" required value={v.contact_name} onChangeText={(t) => setV((s) => ({ ...s, contact_name: t }))} />
          <Field label="Their role" value={v.contact_role} onChangeText={(t) => setV((s) => ({ ...s, contact_role: t }))} hint={see ? "e.g. Resident Engineer, Project Manager, Facility Manager" : "e.g. Chief Engineer, Procurement Manager"} />
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
