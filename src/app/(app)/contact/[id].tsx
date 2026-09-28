import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';

import { Badge, Banner, Button, Card, KeyValue, ListItem, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { customerName, lookupLabel, profileName } from '@/lib/cache';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase, unwrap } from '@/lib/supabase';
import type { Contact } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function ContactProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { canSell } = useSession();
  const { data, loading, error, reload } = useAsync(async () => {
    const [contact, visits, projects] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', id).maybeSingle(),
      supabase.from('visit_contacts').select('visit:visits(id,code,visit_date,visit_type,summary,status)').eq('contact_id', id),
      supabase.from('project_stakeholders').select('stakeholder_role,influence_stage,project:projects(id,code,name)').eq('contact_id', id),
    ]);
    return {
      contact: unwrap(contact) as Contact | null,
      visits: (unwrap(visits) as unknown as { visit: { id: string; code: string; visit_date: string; visit_type: string; summary: string; status: string } }[])
        .map((r) => r.visit).filter(Boolean).sort((a, b) => b.visit_date.localeCompare(a.visit_date)),
      projects: unwrap(projects) as unknown as { stakeholder_role: string; influence_stage: string | null; project: { id: string; code: string; name: string } }[],
    };
  }, [id]);

  if (loading && !data) return <Loading />;
  const c = data?.contact;
  if (!c) return <Screen><Banner tone="danger" message={error ?? 'Contact not found'} /></Screen>;
  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: c.full_name }} />
      <Card>
        <Muted>{c.code}</Muted>
        {!c.active ? <Badge label="Inactive" /> : null}
        <KeyValue label="Customer" value={customerName(c.customer_id)} onPress={() => router.push(`/customer/${c.customer_id}`)} />
        <KeyValue label="Designation" value={c.designation} />
        <KeyValue label="Department" value={c.department} />
        <KeyValue label="Work phone" value={c.work_phone} onPress={c.work_phone ? () => Linking.openURL(`tel:${c.work_phone}`) : undefined} />
        <KeyValue label="Mobile" value={c.mobile_phone} onPress={c.mobile_phone ? () => Linking.openURL(`tel:${c.mobile_phone}`) : undefined} />
        <KeyValue label="Email" value={c.email} onPress={c.email ? () => Linking.openURL(`mailto:${c.email}`) : undefined} />
        <KeyValue label="Decision role" value={lookupLabel('decision_role', c.decision_role)} />
        <KeyValue label="Preferred contact" value={c.preferred_contact_method} />
        <KeyValue label="Consent" value={c.consent_status} />
        <KeyValue label="Communication preference" value={c.communication_preference} />
        <KeyValue label="Owner" value={profileName(c.owner_id)} />
        {c.notes ? <KeyValue label="Notes" value={c.notes} /> : null}
      </Card>
      {canSell ? <Button variant="secondary" title="Edit contact" onPress={() => router.push({ pathname: '/contact/edit', params: { id: c.id } })} /> : null}
      <SectionTitle>Projects</SectionTitle>
      <Card style={{ padding: 0 }}>
        {data!.projects.length === 0 ? <Muted style={{ padding: 16 }}>Not linked to a project</Muted> : data!.projects.map((p) => (
          <ListItem key={p.project.id + p.stakeholder_role} title={p.project.name}
            subtitle={[lookupLabel('stakeholder_role', p.stakeholder_role), lookupLabel('influence_stage', p.influence_stage)].filter((x) => x !== '–').join(' · ')}
            onPress={() => router.push(`/project/${p.project.id}`)} />
        ))}
      </Card>
      <SectionTitle>Visits</SectionTitle>
      <Card style={{ padding: 0 }}>
        {data!.visits.length === 0 ? <Muted style={{ padding: 16 }}>No visits</Muted> : data!.visits.map((v) => (
          <ListItem key={v.id} title={`${fmtDate(v.visit_date)} · ${lookupLabel('visit_type', v.visit_type)}`} subtitle={v.summary} meta={v.code}
            onPress={() => router.push(`/visit/view/${v.id}`)} />
        ))}
      </Card>
    </Screen>
  );
}
