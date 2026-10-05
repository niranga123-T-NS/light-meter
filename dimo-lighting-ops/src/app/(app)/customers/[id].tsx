import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { InquiryCard } from '@/components/InquiryBits';
import { PlaceStatus } from '@/components/PlaceStatus';
import { Badge, Button, Card, colors, ErrorBanner, Grid, KeyValue, ListRow, Loading, Muted, Pill, Row, Screen, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { geocodeAddress } from '@/lib/geocode';
import { useLoad, useMasters, usePeople } from '@/lib/hooks';
import { projectTypeLabel } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Contact, Inquiry, Organization, OrgUnit, Project, Visit } from '@/lib/types';

type Tab = 'ongoing' | 'completed' | 'lost' | 'hold';

/** Customer profile + client view (Sections 4.9 and 9.3). */
export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const masters = useMasters();
  const [unitFilter, setUnitFilter] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ongoing');
  const [placeKey, setPlaceKey] = useState(0); // re-reads the map location after an address change
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

  // Units and contacts: the account owner, SM Projects and GM / DGM can correct them (logged)
  const descendants = (id: string): string[] => units.filter((u) => u.parent_unit_id === id).flatMap((u) => [u.id, ...descendants(u.id)]);
  const editUnit = async (unit: OrgUnit) => {
    const blocked = new Set([unit.id, ...descendants(unit.id)]);
    const r = await dialog.prompt({
      title: 'Edit unit / department',
      fields: [
        { key: 'name', label: 'Unit name', required: true, initial: unit.name },
        { key: 'type', label: 'Type', type: 'select', initial: unit.unit_type, options: ['department', 'division', 'branch', 'site'].map((v) => ({ value: v, label: v })) },
        { key: 'parent', label: 'Parent unit (optional)', type: 'select', initial: unit.parent_unit_id ?? '', options: units.filter((u) => !blocked.has(u.id)).map((u) => ({ value: u.id, label: u.name })) },
        { key: 'address', label: 'Address', initial: unit.address ?? '' },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('org_units').update({ name: r.name.trim(), unit_type: r.type, parent_unit_id: r.parent || null, address: r.address || null }).eq('id', unit.id);
      if (e) throw new Error(e.message);
      await reload();
    }, 'Unit updated');
  };

  const editContact = async (c: Contact) => {
    const r = await dialog.prompt({
      title: 'Edit contact',
      fields: [
        { key: 'name', label: 'Name', required: true, initial: c.name },
        { key: 'designation', label: 'Designation', initial: c.designation ?? '' },
        { key: 'phone', label: 'Phone', initial: c.phone ?? '' },
        { key: 'email', label: 'Email', initial: c.email ?? '' },
        { key: 'unit', label: 'Unit', type: 'select', initial: c.unit_id ?? '', options: units.map((u) => ({ value: u.id, label: u.name })) },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('contacts').update({ name: r.name.trim(), designation: r.designation || null, phone: r.phone || null, email: r.email || null, unit_id: r.unit || null }).eq('id', c.id);
      if (e) throw new Error(e.message);
      await reload();
    }, 'Contact updated');
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

  // Account owner, SM Projects and GM / DGM can edit; renames are logged and may not duplicate another customer.
  const canEdit = manager || org.account_owner_id === me.id;
  const editDetails = async () => {
    const r = await dialog.prompt({
      title: 'Edit customer details',
      fields: [
        { key: 'name', label: 'Organization name', required: true, initial: org.name },
        { key: 'category', label: 'Type (visit category)', type: 'select', required: true, initial: org.visit_category, options: masters.values('visit_category').map((v) => ({ value: v, label: v })) },
        { key: 'address', label: 'Head office address', initial: org.address ?? '' },
        { key: 'phone', label: 'Phone', initial: org.phone ?? '' },
        { key: 'email', label: 'Email', initial: org.email ?? '' },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      const patch: Partial<Organization> = { name: r.name.trim(), visit_category: r.category, address: r.address || null, phone: r.phone || null, email: r.email || null };
      const { error: e } = await supabase.from('organizations').update(patch).eq('id', org.id);
      if (e) throw new Error(e.message);
      // A new address with no map location yet: place the customer from it when it is found precisely
      if (patch.address && patch.address !== org.address && (org as Organization & { lat?: number | null }).lat == null) {
        const pt = await geocodeAddress(patch.address);
        if (pt) await rpc('set_map_location', { p_kind: 'customer', p_id: org.id, p_lat: pt.lat, p_lng: pt.lng }).catch(() => undefined);
      }
      await reload();
      setPlaceKey((k) => k + 1);
    }, 'Customer updated – logged');
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
            right={
              canEdit || me.role === 'sm_projects' ? (
                <Row gap={4}>
                  {canEdit ? <Button small variant="ghost" title="Edit" onPress={() => editUnit(u)} /> : null}
                  {me.role === 'sm_projects' ? <Button small variant="ghost" title="Owner" onPress={() => changeOwner(u)} /> : null}
                </Row>
              ) : undefined
            }
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
        <PlaceStatus key={placeKey} projectId={null} organizationId={org.id} allowChange={canEdit} />
        <Row wrap gap={6}>
          {canEdit ? <Button small variant="secondary" title="Edit details" onPress={editDetails} /> : null}
          {me.role === 'sm_projects' || me.role === 'gm' ? <Button small variant="secondary" title="Change owner" onPress={() => changeOwner()} /> : null}
          <Button small variant="secondary" title="+ Unit" onPress={addUnit} />
          <Button small variant="secondary" title="+ Contact" onPress={addContact} />
          <Button small variant="secondary" title="+ Project" onPress={() => router.push({ pathname: '/projects/new', params: { organization: org.id } })} />
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
            <ListRow
              key={c.id}
              title={c.name}
              subtitle={[c.designation, units.find((u) => u.id === c.unit_id)?.name, c.phone, c.email].filter(Boolean).join(' · ')}
              right={canEdit || c.created_by === me.id ? <Button small variant="ghost" title="Edit" onPress={() => editContact(c)} /> : undefined}
            />
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
