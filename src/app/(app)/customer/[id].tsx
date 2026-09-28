import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';

import { AttachmentList } from '@/components/AttachmentList';
import { Badge, Banner, Button, Card, KeyValue, ListItem, Loading, Muted, Row, Screen, SectionTitle } from '@/components/ui';
import { cacheStore, lookupLabel, profileName } from '@/lib/cache';
import { fmtDate, relativeDue } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase, unwrap } from '@/lib/supabase';
import type { Action, Contact, Customer, Project, Visit } from '@/lib/types';
import { useAsync, useRefreshOnFocus } from '@/lib/useAsync';

export default function CustomerProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { canSell } = useSession();
  const { data, error, loading, reload } = useAsync(async () => {
    const [customer, contacts, projects, stake, visits, actions, children] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).maybeSingle(),
      supabase.from('contacts').select('*').eq('customer_id', id).is('deleted_at', null).order('full_name'),
      supabase.from('projects').select('id,code,name,status,district').or(`customer_id.eq.${id},developer_id.eq.${id},end_user_id.eq.${id}`).is('deleted_at', null),
      supabase.from('project_stakeholders').select('stakeholder_role, project:projects(id,code,name,status,district)').eq('customer_id', id),
      supabase.from('visits').select('id,code,visit_date,visit_type,status,summary,salesperson_id').eq('customer_id', id).neq('status', 'draft')
        .order('visit_date', { ascending: false }).limit(50),
      supabase.from('actions').select('*').eq('customer_id', id).order('due_date', { ascending: true, nullsFirst: false }).limit(100),
      supabase.from('customers').select('id,legal_name,code').eq('parent_customer_id', id),
    ]);
    const cust = unwrap(customer) as Customer | null;
    const parent = cust?.parent_customer_id
      ? (await supabase.from('customers').select('id,legal_name').eq('id', cust.parent_customer_id).maybeSingle()).data
      : null;
    const projMap = new Map<string, Project & { role?: string }>();
    for (const p of unwrap(projects) as Project[]) projMap.set(p.id, p);
    for (const s of unwrap(stake) as unknown as { stakeholder_role: string; project: Project }[]) {
      if (s.project) projMap.set(s.project.id, { ...s.project, role: s.stakeholder_role });
    }
    return {
      customer: cust,
      contacts: unwrap(contacts) as Contact[],
      projects: [...projMap.values()],
      visits: unwrap(visits) as Visit[],
      actions: unwrap(actions) as Action[],
      parent: parent as { id: string; legal_name: string } | null,
      children: (children.data ?? []) as { id: string; legal_name: string; code: string }[],
    };
  }, [id]);

  useRefreshOnFocus(reload);
  const cached = cacheStore.get().customers.find((c) => c.id === id);
  const c = data?.customer ?? cached;
  if (loading && !c) return <Loading />;
  if (!c) return <Screen><Banner tone="danger" message={error ?? 'Customer not found'} /></Screen>;
  const openActions = (data?.actions ?? []).filter((a) => a.status === 'open' || a.status === 'in_progress');

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: c.code ?? 'Customer' }} />
      {error && !data ? <Banner tone="warning" message="Offline – showing saved details only." /> : null}
      <Card>
        <Muted>{c.code}</Muted>
        <Row wrap>
          <Badge label={c.status ?? 'active'} tone={c.status === 'provisional' ? 'warning' : 'success'} />
          {c.strategic_priority ? <Badge label={`Priority ${c.strategic_priority}`} tone="primary" /> : null}
        </Row>
        <KeyValue label="Legal name" value={c.legal_name} />
        <KeyValue label="Trading name" value={c.trading_name} />
        <KeyValue label="Category" value={lookupLabel('customer_category', c.category)} />
        <KeyValue label="Industry" value={lookupLabel('industry', c.industry)} />
        <KeyValue label="Address" value={[c.address, c.city, c.district, c.country].filter(Boolean).join(', ')} />
        <KeyValue label="Phone" value={c.phone} onPress={c.phone ? () => Linking.openURL(`tel:${c.phone}`) : undefined} />
        <KeyValue label="Email" value={c.email} onPress={c.email ? () => Linking.openURL(`mailto:${c.email}`) : undefined} />
        <KeyValue label="Website" value={c.website} />
        <KeyValue label="Owner" value={profileName(c.owner_id)} />
        <KeyValue label="Territory" value={cacheStore.get().territories.find((t) => t.id === c.territory_id)?.name} />
        <KeyValue label="Source" value={lookupLabel('lead_source', c.source)} />
        {data?.parent ? <KeyValue label="Parent company" value={data.parent.legal_name} onPress={() => router.push(`/customer/${data.parent!.id}`)} /> : null}
        {data?.children.length ? <KeyValue label="Subsidiaries" value={data.children.map((x) => x.legal_name).join(', ')} /> : null}
        <KeyValue label="Last visit" value={fmtDate(c.last_visit_at)} />
        {c.notes ? <KeyValue label="Notes" value={c.notes} /> : null}
      </Card>
      {canSell ? (
        <Row wrap>
          <Button style={{ flex: 1 }} title="Start visit" onPress={() => router.push({ pathname: '/visit/[id]', params: { id: 'new', customerId: c.id } })} />
          <Button style={{ flex: 1 }} variant="secondary" title="Plan visit" onPress={() => router.push({ pathname: '/visit/plan', params: { customerId: c.id } })} />
          <Button style={{ flex: 1 }} variant="secondary" title="Edit" onPress={() => router.push({ pathname: '/customer/edit', params: { id: c.id } })} />
        </Row>
      ) : null}

      <SectionTitle right={canSell ? <Button small variant="ghost" title="＋ Contact" onPress={() => router.push({ pathname: '/contact/edit', params: { customerId: c.id } })} /> : undefined}>
        Contacts
      </SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data?.contacts ?? []).length === 0 ? <Muted style={{ padding: 16 }}>No contacts yet</Muted> : data!.contacts.map((ct) => (
          <ListItem key={ct.id} title={ct.full_name} subtitle={[ct.designation, lookupLabel('decision_role', ct.decision_role)].filter((x) => x && x !== '–').join(' · ')}
            right={!ct.active ? <Badge label="Inactive" /> : undefined} onPress={() => router.push(`/contact/${ct.id}`)} />
        ))}
      </Card>

      <SectionTitle right={canSell ? <Button small variant="ghost" title="＋ Project" onPress={() => router.push({ pathname: '/project/edit', params: { customerId: c.id } })} /> : undefined}>
        Projects
      </SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data?.projects ?? []).length === 0 ? <Muted style={{ padding: 16 }}>No projects linked</Muted> : data!.projects.map((p) => (
          <ListItem key={p.id} title={p.name} subtitle={[p.code, p.district, (p as { role?: string }).role ? lookupLabel('stakeholder_role', (p as { role?: string }).role) : null].filter((x) => x && x !== '–').join(' · ')}
            right={<Badge label={p.status ?? ''} />} onPress={() => router.push(`/project/${p.id}`)} />
        ))}
      </Card>

      <SectionTitle right={<Button small variant="ghost" title="＋ Action" onPress={() => router.push({ pathname: '/action/edit', params: { customerId: c.id } })} />}>
        Open actions
      </SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {openActions.length === 0 ? <Muted style={{ padding: 16 }}>None</Muted> : openActions.map((a) => {
          const due = relativeDue(a.due_date);
          return <ListItem key={a.id} title={a.description} subtitle={profileName(a.owner_id)} right={<Badge label={due.label} tone={due.overdue ? 'danger' : 'neutral'} />}
            onPress={() => router.push(`/action/${a.id}`)} />;
        })}
      </Card>

      <SectionTitle>Visit history</SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data?.visits ?? []).length === 0 ? <Muted style={{ padding: 16 }}>No visits yet</Muted> : data!.visits.map((v) => (
          <ListItem key={v.id} title={`${fmtDate(v.visit_date)} · ${lookupLabel('visit_type', v.visit_type)}`}
            subtitle={v.summary} meta={`${v.code} · ${profileName(v.salesperson_id)}`}
            right={v.status === 'planned' ? <Badge label="Planned" tone="info" /> : undefined}
            onPress={() => router.push(v.status === 'planned' ? `/visit/${v.id}` : `/visit/view/${v.id}`)} />
        ))}
      </Card>
      <AttachmentList entityType="customer" entityId={c.id} />
    </Screen>
  );
}
