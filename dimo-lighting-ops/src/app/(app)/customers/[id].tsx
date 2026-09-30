import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { InquiryCard } from '@/components/InquiryBits';
import { Badge, Button, Card, colors, ErrorBanner, Grid, KeyValue, ListRow, Loading, Muted, Pill, Row, Screen, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { projectTypeLabel } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Contact, Inquiry, Organization, OrgUnit, Project, Visit } from '@/lib/types';

type Tab = 'ongoing' | 'completed' | 'lost' | 'hold';

/** Customer profile + client view (Sections 4.9 and 9.3). */
export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [unitFilter, setUnitFilter] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ongoing');
  const manager = me.role === 'sm_projects' || me.role === 'gm';

  const { data, error, reload } = useLoad(async () => {
    const { data: org, error: e } = await supabase.from('organizations').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const [units, contacts, projects, inquiries, visits] = await Promise.all([
      supabase.from('org_units').select('*').eq('organization_id', id).order('name'),
      supabase.from('contacts').select('*').eq('organization_id', id).order('name'),
      supabase.from('projects').select('*').eq('organization_id', id).is('merged_into', null).order('last_activity_at', { ascending: false }),
      supabase.from('inquiries').select('*').eq('organization_id', id).order('customer_deadline'),
      supabase.from('visits').select('*').eq('organization_id', id).order('checkin_at', { ascending: false }).limit(50),
    ]);
    return {
      org: org as Organization,
      units: (units.data ?? []) as OrgUnit[],
      contacts: (contacts.data ?? []) as Contact[],
      projects: (projects.data ?? []) as Project[],
      inquiries: (inquiries.data ?? []) as Inquiry[],
      visits: (visits.data ?? []) as Visit[],
    };
  }, [id]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { org, units, contacts } = data;
  const projects = data.projects.filter((p) => !unitFilter || p.unit_id === unitFilter);
  const inquiries = data.inquiries.filter((i) => !unitFilter || i.unit_id === unitFilter);
  const byTab: Record<Tab, Project[]> = {
    ongoing: projects.filter((p) => ['active', 'dormant', 'won'].includes(p.status)),
    completed: projects.filter((p) => p.status === 'completed'),
    lost: projects.filter((p) => p.status === 'lost'),
    hold: projects.filter((p) => ['on_hold', 'cancelled'].includes(p.status)),
  };
  const pendingDesign = inquiries.filter((i) => ['submitted', 'accepted', 'in_design', 'design_review', 'design_approved'].includes(i.status) && i.route !== 'B');
  const pendingEst = inquiries.filter((i) => ['in_estimation', 'estimation_review'].includes(i.status) || (i.route === 'B' && ['submitted', 'accepted'].includes(i.status)));
  const overdue = [...pendingDesign, ...pendingEst].filter((i) => i.sla_colour === 'red');
  const sortRed = (a: Inquiry, b: Inquiry) => Number(b.sla_colour === 'red') - Number(a.sla_colour === 'red');
  const decided = inquiries.filter((i) => ['won', 'lost'].includes(i.status));
  const won = inquiries.filter((i) => i.status === 'won');

  const addUnit = async () => {
    const r = await dialog.prompt({
      title: 'Add unit / department',
      fields: [
        { key: 'name', label: 'Unit name', required: true },
        { key: 'type', label: 'Type', type: 'select', initial: 'department', options: ['department', 'division', 'branch', 'site'].map((v) => ({ value: v, label: v })) },
        { key: 'parent', label: 'Parent unit (optional)', type: 'select', options: units.map((u) => ({ value: u.id, label: u.name })) },
        { key: 'address', label: 'Address' },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('org_units').insert({ organization_id: org.id, name: r.name, unit_type: r.type, parent_unit_id: r.parent || null, address: r.address || null });
      if (e) throw new Error(e.message);
      await reload();
    }, 'Unit added');
  };

  const addContact = async () => {
    const r = await dialog.prompt({
      title: 'Add contact',
      fields: [
        { key: 'name', label: 'Name', required: true },
        { key: 'designation', label: 'Designation' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'unit', label: 'Unit', type: 'select', options: units.map((u) => ({ value: u.id, label: u.name })) },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('contacts').insert({ organization_id: org.id, name: r.name, designation: r.designation || null, phone: r.phone || null, email: r.email || null, unit_id: r.unit || null });
      if (e) throw new Error(e.message);
      await reload();
    }, 'Contact added');
  };

  const changeOwner = async (unit?: OrgUnit) => {
    const { data: sp } = await supabase.from('profiles').select('id, full_name').in('role', ['asm_building', 'asm_infra']).eq('active', true);
    const r = await dialog.prompt({
      title: unit ? `Owner override for ${unit.name}` : 'Change account owner',
      fields: [
        { key: 'o', label: 'Sales person', type: 'select', required: true, options: (sp ?? []).map((x) => ({ value: x.id, label: x.full_name })) },
        { key: 'reason', label: 'Reason', type: 'multiline', required: true },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      const q = unit ? supabase.from('org_units').update({ account_owner_id: r.o }).eq('id', unit.id) : supabase.from('organizations').update({ account_owner_id: r.o }).eq('id', org.id);
      const { error: e } = await q;
      if (e) throw new Error(e.message);
      await reload();
    }, 'Owner changed – logged');
  };

  const tree = (parent: string | null, depth: number): React.ReactNode =>
    units
      .filter((u) => u.parent_unit_id === parent)
      .map((u) => (
        <View key={u.id}>
          <ListRow
            title={`${'   '.repeat(depth)}${u.name}`}
            subtitle={`${u.unit_type}${u.account_owner_id ? ` · owner ${people[u.account_owner_id]?.full_name ?? ''}` : ''}`}
            onPress={() => setUnitFilter(unitFilter === u.id ? null : u.id)}
            highlight={unitFilter === u.id ? colors.brand : undefined}
            right={me.role === 'sm_projects' ? <Button small variant="ghost" title="Owner" onPress={() => changeOwner(u)} /> : undefined}
          />
          {tree(u.id, depth + 1)}
        </View>
      ));

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: org.name }} />
      <Card>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <View>
            <Row gap={8}>
              <Text style={{ fontSize: 20, fontWeight: '700' }}>{org.name}</Text>
              {overdue.length ? <Badge count={overdue.length} /> : null}
            </Row>
            <Muted>
              {org.visit_category} · {org.address ?? ''} {org.phone ?? ''} {org.email ?? ''}
            </Muted>
          </View>
          <Pill label={org.status} tone={colors.green} />
        </Row>
        <Row wrap style={{ marginTop: 8 }}>
          <KeyValue label="Account owner" value={people[org.account_owner_id ?? '']?.full_name ?? '—'} />
          <KeyValue label="Last visit" value={fmtDateTime(data.visits[0]?.checkin_at)} />
        </Row>
        <Row wrap gap={6}>
          {me.role === 'sm_projects' || me.role === 'gm' ? <Button small variant="secondary" title="Change owner" onPress={() => changeOwner()} /> : null}
          <Button small variant="secondary" title="+ Unit" onPress={addUnit} />
          <Button small variant="secondary" title="+ Contact" onPress={addContact} />
          <Button small variant="secondary" title="+ Project" onPress={() => router.push('/projects/new')} />
        </Row>
      </Card>

      {manager ? (
        <Section title={`Client view${unitFilter ? ` – ${units.find((u) => u.id === unitFilter)?.name}` : ''}`}>
          <Grid min={170}>
            <Stat label="Projects" value={projects.length} />
            <Stat label="Win rate" value={decided.length ? `${Math.round((100 * won.length) / decided.length)}%` : '—'} />
            <Stat label="Won value" value={['LKR', 'USD'].map((c) => fmtMoney(won.filter((i) => i.currency === c).reduce((a, i) => a + Number(i.order_value ?? 0), 0), c as 'LKR')).join(' + ')} />
            <Stat label="Pending designs" value={pendingDesign.length} />
            <Stat label="Pending estimations" value={pendingEst.length} />
            <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'red' : undefined} />
          </Grid>
        </Section>
      ) : null}

      <Section title="Units / departments">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {tree(null, 0)}
          {!units.length ? <Muted style={{ padding: 12 }}>No units defined</Muted> : null}
        </Card>
        {unitFilter ? <Button small variant="ghost" title="Show all units" onPress={() => setUnitFilter(null)} /> : null}
      </Section>

      <Section title="Projects">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'ongoing', label: 'Ongoing', badge: byTab.ongoing.length },
            { value: 'completed', label: 'Completed' },
            { value: 'lost', label: 'Lost' },
            { value: 'hold', label: 'On hold / cancelled' },
          ]}
        />
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 6 }}>
          {byTab[tab].map((p) => (
            <ListRow
              key={p.id}
              title={p.name}
              subtitle={`${units.find((u) => u.id === p.unit_id)?.name ?? ''} ${projectTypeLabel(p.project_type)} · ${p.stage} · ${people[p.owner_id]?.full_name ?? ''} · last activity ${fmtDate(p.last_activity_at)}${p.status_reason ? ` · ${p.status_reason}` : ''}`}
              right={
                <Row gap={4}>
                  <Muted>{fmtMoney(p.lighting_value, p.currency)}</Muted>
                  <Pill label={`${p.win_probability}%`} tone={colors.blue} />
                </Row>
              }
              onPress={() => router.push(`/projects/${p.id}`)}
            />
          ))}
          {!byTab[tab].length ? <Muted style={{ padding: 12 }}>None</Muted> : null}
        </Card>
      </Section>

      {pendingDesign.length || pendingEst.length ? (
        <Section title="Pending designs and estimations">
          <View style={{ gap: 8 }}>
            {[...pendingDesign, ...pendingEst].sort(sortRed).map((i) => (
              <InquiryCard key={i.id} inquiry={i} />
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Contacts">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {contacts.map((c) => (
            <ListRow key={c.id} title={c.name} subtitle={[c.designation, units.find((u) => u.id === c.unit_id)?.name, c.phone, c.email].filter(Boolean).join(' · ')} />
          ))}
          {!contacts.length ? <Muted style={{ padding: 12 }}>No contacts yet</Muted> : null}
        </Card>
      </Section>

      <Section title="Activity">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {data.visits.map((v) => (
            <ListRow
              key={v.id}
              title={`${fmtDateTime(v.checkin_at)} · ${v.primary_objective}`}
              subtitle={`${v.visit_category} · ${v.outcome ?? 'report due'} · ${people[v.sales_person_id]?.full_name ?? ''}`}
              onPress={() => router.push(`/visits/${v.id}`)}
            />
          ))}
          {!data.visits.length ? <Muted style={{ padding: 12 }}>No visits yet</Muted> : null}
        </Card>
      </Section>
    </Screen>
  );
}
