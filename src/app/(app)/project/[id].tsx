import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { AttachmentList } from '@/components/AttachmentList';
import { FormModal } from '@/components/FormModal';
import { SelectField, SwitchField, TextField } from '@/components/form';
import { Badge, Banner, Body, Button, Card, KeyValue, ListItem, Loading, Muted, Row, Screen, SectionTitle } from '@/components/ui';
import { cacheStore, customerName, lookupLabel, profileName, stageById, useLookup } from '@/lib/cache';
import { confirm, notify } from '@/lib/dialog';
import { fmtDate, fmtDateTime, fmtMoney, relativeDue } from '@/lib/format';
import { newId } from '@/lib/ids';
import { contactOptions, customerOptions, userOptions } from '@/lib/options';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { Action, Milestone, Opportunity, Project, Stakeholder } from '@/lib/types';
import { useAsync, useRefreshOnFocus } from '@/lib/useAsync';

export default function ProjectProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, isManager, canSell } = useSession();
  const [stake, setStake] = useState<Stakeholder | null>(null);
  const [member, setMember] = useState<{ user_id: string | null; member_role: string } | null>(null);
  const [note, setNote] = useState('');
  const roles = useLookup('stakeholder_role');
  const influence = useLookup('influence_stage');

  const { data, loading, error, reload } = useAsync(async () => {
    const [project, stakeholders, members, opps, visits, actions, milestones, notes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).maybeSingle(),
      supabase.from('project_stakeholders').select('*').eq('project_id', id).order('stakeholder_role'),
      supabase.from('project_members').select('*').eq('project_id', id),
      supabase.from('opportunities').select('*').eq('project_id', id).is('deleted_at', null).order('created_at'),
      supabase.from('visit_projects').select('visit:visits(id,code,visit_date,visit_type,summary,salesperson_id,status)').eq('project_id', id),
      supabase.from('actions').select('*').eq('project_id', id).order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('project_milestones').select('*').eq('project_id', id).order('planned_date', { ascending: true, nullsFirst: false }),
      supabase.from('technical_notes').select('*').eq('project_id', id).order('created_at', { ascending: false }),
    ]);
    return {
      project: unwrap(project) as Project | null,
      stakeholders: unwrap(stakeholders) as Stakeholder[],
      members: unwrap(members) as { user_id: string; member_role: string }[],
      opps: unwrap(opps) as Opportunity[],
      visits: (unwrap(visits) as unknown as { visit: { id: string; code: string; visit_date: string; visit_type: string; summary: string; salesperson_id: string; status: string } }[])
        .map((r) => r.visit).filter(Boolean).sort((a, b) => b.visit_date.localeCompare(a.visit_date)),
      actions: unwrap(actions) as Action[],
      milestones: unwrap(milestones) as Milestone[],
      notes: unwrap(notes) as { id: string; body: string; created_by: string; created_at: string }[],
    };
  }, [id]);

  useRefreshOnFocus(reload);
  if (loading && !data) return <Loading />;
  const p = data?.project ?? cacheStore.get().projects.find((x) => x.id === id);
  if (!p) return <Screen><Banner tone="danger" message={error ?? 'Project not found'} /></Screen>;
  const canEditTeam = isManager || p.owner_id === profile?.id;
  const contactName = (cid?: string | null) => cacheStore.get().contacts.find((c) => c.id === cid)?.full_name;

  const saveStakeholder = async () => {
    if (!stake) return;
    const { error: err } = await supabase.from('project_stakeholders').upsert(stake);
    if (err) return notify('Could not save', errorMessage(err));
    setStake(null);
    void reload();
  };
  const removeStakeholder = async (s: Stakeholder) => {
    if (!(await confirm('Remove stakeholder?', 'This removes the link, not the customer or contact.', 'Remove', true))) return;
    const { error: err } = await supabase.from('project_stakeholders').delete().eq('id', s.id);
    if (err) notify('Could not remove', errorMessage(err));
    void reload();
  };
  const saveMember = async () => {
    if (!member?.user_id) return;
    const { error: err } = await supabase.from('project_members').upsert({ project_id: id, user_id: member.user_id, member_role: member.member_role });
    if (err) return notify('Could not add', errorMessage(err));
    setMember(null);
    void reload();
  };
  const addNote = async () => {
    if (!note.trim()) return;
    const { error: err } = await supabase.from('technical_notes').insert({ project_id: id, body: note.trim() });
    if (err) return notify('Could not save note', errorMessage(err));
    setNote('');
    void reload();
  };

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: p.code ?? 'Project' }} />
      <Card>
        <Body style={{ fontSize: 18, fontWeight: '700' }}>{p.name}</Body>
        {p.aliases?.length ? <Muted>Also known as: {p.aliases.join(', ')}</Muted> : null}
        <Row wrap>
          <Badge label={p.status ?? 'active'} tone={p.status === 'won' ? 'success' : p.status === 'lost' ? 'danger' : 'primary'} />
          {(p.segments ?? []).map((s) => <Badge key={s} label={lookupLabel('project_segment', s)} />)}
        </Row>
        <KeyValue label="Customer / owner" value={customerName(p.customer_id)} onPress={p.customer_id ? () => router.push(`/customer/${p.customer_id}`) : undefined} />
        <KeyValue label="Developer" value={customerName(p.developer_id)} />
        <KeyValue label="End user" value={customerName(p.end_user_id)} />
        <KeyValue label="Site" value={[p.site_location, p.city, p.district].filter(Boolean).join(', ')}
          onPress={p.latitude != null ? () => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`) : undefined} />
        <KeyValue label="Type" value={lookupLabel('project_type', p.project_type)} />
        <KeyValue label="Description" value={p.description} />
        <KeyValue label="Owner" value={profileName(p.owner_id)} />
        <KeyValue label="Last activity" value={fmtDateTime(p.last_activity_at)} />
      </Card>
      {canSell ? (
        <Row wrap>
          <Button style={{ flex: 1 }} title="Visit" onPress={() => router.push({ pathname: '/visit/[id]', params: { id: 'new', customerId: p.customer_id ?? '', projectId: p.id } })} />
          <Button style={{ flex: 1 }} variant="secondary" title="Edit" onPress={() => router.push({ pathname: '/project/edit', params: { id: p.id } })} />
        </Row>
      ) : null}

      <SectionTitle>Scope</SectionTitle>
      <Card>
        <KeyValue label="Systems / products" value={p.systems_products} />
        <KeyValue label="Quantities" value={p.quantities} />
        <KeyValue label="Standards" value={p.technical_standards} />
        <KeyValue label="Lux targets" value={p.lux_targets} />
        <KeyValue label="Controls / integration" value={p.controls_requirements} />
        {(p.drawing_links ?? []).map((l) => <KeyValue key={l} label="Drawing / spec" value={l} onPress={() => Linking.openURL(l)} />)}
      </Card>
      <SectionTitle>Commercial</SectionTitle>
      <Card>
        <KeyValue label="Total estimate" value={fmtMoney(p.total_estimate, p.currency)} />
        <KeyValue label="DIMO addressable" value={fmtMoney(p.addressable_value, p.currency)} />
        <KeyValue label="Budget status" value={lookupLabel('budget_status', p.budget_status)} />
        <KeyValue label="Funding source" value={p.funding_source} />
        <KeyValue label="Bid strategy" value={p.bid_strategy} />
        <KeyValue label="Partner / supplier" value={p.partner_supplier} />
        <KeyValue label="Competitors" value={p.competitors} />
        <KeyValue label="Incumbent" value={p.incumbent} />
        <KeyValue label="Specification" value={lookupLabel('spec_status', p.spec_status)} />
      </Card>
      <SectionTitle>Timeline</SectionTitle>
      <Card>
        <KeyValue label="Design stage" value={lookupLabel('design_stage', p.design_stage)} />
        <KeyValue label="Tender published" value={fmtDate(p.tender_publication_date)} />
        <KeyValue label="Tender closes" value={fmtDate(p.tender_closing_date)} />
        <KeyValue label="Quotation due" value={fmtDate(p.quotation_due_date)} />
        <KeyValue label="Expected award" value={fmtDate(p.expected_award_date)} />
        <KeyValue label="Expected delivery" value={fmtDate(p.expected_delivery_date)} />
        <KeyValue label="Installation" value={`${fmtDate(p.installation_start_date)} → ${fmtDate(p.installation_end_date)}`} />
        <KeyValue label="Date confidence" value={lookupLabel('date_confidence', p.date_confidence)} />
        <KeyValue label="Source of information" value={p.info_source} />
        <KeyValue label="Tender reference" value={p.tender_reference} />
        <KeyValue label="Lead source" value={lookupLabel('lead_source', p.lead_source)} />
        <KeyValue label="BOQ reference" value={p.boq_reference} />
      </Card>

      <SectionTitle right={canSell ? <Button small variant="ghost" title="＋ Package" onPress={() => router.push({ pathname: '/opportunity/edit', params: { projectId: p.id } })} /> : undefined}>
        Packages / bids
      </SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data?.opps ?? []).length === 0 ? <Muted style={{ padding: 16 }}>No packages yet</Muted> : data!.opps.map((o) => {
          const st = stageById(o.stage_id);
          return (
            <ListItem key={o.id} title={o.name} subtitle={`${st?.name ?? ''} · ${o.probability ?? 0}% · ${fmtMoney(o.estimated_value, o.currency)}`}
              meta={`${o.code} · ${profileName(o.owner_id)}${o.expected_order_date ? ` · order ${fmtDate(o.expected_order_date)}` : ''}`}
              right={st && st.outcome !== 'open' ? <Badge label={st.name} tone={st.outcome === 'won' ? 'success' : 'danger'} /> : undefined}
              onPress={() => router.push(`/opportunity/${o.id}`)} />
          );
        })}
      </Card>

      <SectionTitle right={canSell ? <Button small variant="ghost" title="＋ Stakeholder" onPress={() => setStake({ id: newId(), project_id: id, stakeholder_role: 'architect', is_decision_maker: false })} /> : undefined}>
        Stakeholders
      </SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data?.stakeholders ?? []).length === 0 ? <Muted style={{ padding: 16 }}>None recorded</Muted> : data!.stakeholders.map((s) => (
          <ListItem key={s.id}
            title={`${lookupLabel('stakeholder_role', s.stakeholder_role)}: ${s.customer_id ? customerName(s.customer_id) : ''}${s.contact_id ? ` – ${contactName(s.contact_id) ?? 'contact'}` : ''}`}
            subtitle={[lookupLabel('influence_stage', s.influence_stage), s.is_decision_maker ? 'Decision maker' : null].filter((x) => x && x !== '–').join(' · ')}
            onPress={canSell ? () => setStake(s) : undefined}
            right={canSell ? <Button small variant="ghost" title="✕" onPress={() => removeStakeholder(s)} /> : undefined} />
        ))}
      </Card>

      <SectionTitle right={canEditTeam ? <Button small variant="ghost" title="＋ Member" onPress={() => setMember({ user_id: null, member_role: 'estimator' })} /> : undefined}>
        Team
      </SectionTitle>
      <Card>
        <KeyValue label="Owner" value={profileName(p.owner_id)} />
        {(data?.members ?? []).map((m) => <KeyValue key={m.user_id} label={m.member_role} value={profileName(m.user_id)} />)}
      </Card>

      <SectionTitle right={<Button small variant="ghost" title="＋ Milestone" onPress={() => router.push({ pathname: '/milestone/edit', params: { projectId: p.id } })} />}>
        Design / submittal milestones
      </SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data?.milestones ?? []).length === 0 ? <Muted style={{ padding: 16 }}>None</Muted> : data!.milestones.map((m) => (
          <ListItem key={m.id} title={m.title} subtitle={`${lookupLabel('milestone_kind', m.kind)} · planned ${fmtDate(m.planned_date)}${m.actual_date ? ` · done ${fmtDate(m.actual_date)}` : ''}`}
            right={<Badge label={m.status} tone={['approved', 'done'].includes(m.status) ? 'success' : m.status === 'rejected' ? 'danger' : 'neutral'} />}
            onPress={() => router.push({ pathname: '/milestone/edit', params: { id: m.id } })} />
        ))}
      </Card>

      <SectionTitle>Technical notes</SectionTitle>
      <Card>
        {(data?.notes ?? []).map((n) => (
          <View key={n.id} style={{ gap: 2 }}>
            <Body>{n.body}</Body>
            <Muted>{profileName(n.created_by)} · {fmtDateTime(n.created_at)}</Muted>
          </View>
        ))}
        <TextField label="Add a technical note" value={note} onChange={setNote} multiline />
        <Button small title="Add note" onPress={addNote} disabled={!note.trim()} />
      </Card>

      <SectionTitle right={<Button small variant="ghost" title="＋ Action" onPress={() => router.push({ pathname: '/action/edit', params: { projectId: p.id, customerId: p.customer_id ?? '' } })} />}>
        Actions
      </SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data?.actions ?? []).length === 0 ? <Muted style={{ padding: 16 }}>None</Muted> : data!.actions.map((a) => {
          const due = relativeDue(a.due_date);
          return (
            <ListItem key={a.id} title={a.description} subtitle={`${profileName(a.owner_id)} · ${a.status}`}
              right={a.status === 'done' ? <Badge label="Done" tone="success" /> : <Badge label={due.label} tone={due.overdue ? 'danger' : 'neutral'} />}
              onPress={() => router.push(`/action/${a.id}`)} />
          );
        })}
      </Card>

      <SectionTitle>Visit history</SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data?.visits ?? []).length === 0 ? <Muted style={{ padding: 16 }}>No visits linked</Muted> : data!.visits.map((v) => (
          <ListItem key={v.id} title={`${fmtDate(v.visit_date)} · ${lookupLabel('visit_type', v.visit_type)}`} subtitle={v.summary}
            meta={`${v.code} · ${profileName(v.salesperson_id)}`} onPress={() => router.push(`/visit/view/${v.id}`)} />
        ))}
      </Card>
      <AttachmentList entityType="project" entityId={p.id} />

      <FormModal visible={!!stake} title="Stakeholder" onClose={() => setStake(null)} onSave={saveStakeholder}
        saveDisabled={!stake?.stakeholder_role || (!stake?.customer_id && !stake?.contact_id)}>
        {stake ? (
          <>
            <SelectField label="Role" required value={stake.stakeholder_role} options={roles} allowClear={false} onChange={(x) => setStake({ ...stake, stakeholder_role: x ?? stake.stakeholder_role })} />
            <SelectField label="Organisation" value={stake.customer_id} options={customerOptions()} onChange={(x) => setStake({ ...stake, customer_id: x, contact_id: null })} />
            <SelectField label="Contact" value={stake.contact_id} options={contactOptions(stake.customer_id)} onChange={(x) => setStake({ ...stake, contact_id: x })} />
            <SelectField label="Stage of influence" value={stake.influence_stage} options={influence} onChange={(x) => setStake({ ...stake, influence_stage: x })} />
            <SwitchField label="Decision maker" value={stake.is_decision_maker} onChange={(x) => setStake({ ...stake, is_decision_maker: x })} />
            <TextField label="Notes" value={stake.notes} onChange={(t) => setStake({ ...stake, notes: t })} multiline />
          </>
        ) : null}
      </FormModal>
      <FormModal visible={!!member} title="Add team member" onClose={() => setMember(null)} onSave={saveMember} saveDisabled={!member?.user_id}>
        {member ? (
          <>
            <SelectField label="User" required value={member.user_id} options={userOptions()} onChange={(x) => setMember({ ...member, user_id: x })} />
            <SelectField label="Role on project" value={member.member_role} allowClear={false}
              options={[{ value: 'estimator', label: 'Estimator' }, { value: 'designer', label: 'Designer' }, { value: 'sales', label: 'Sales' },
                { value: 'execution', label: 'Execution' }, { value: 'other', label: 'Other' }]}
              onChange={(x) => setMember({ ...member, member_role: x ?? 'estimator' })} />
            <Muted>Members can see this project, add technical notes, milestones and quotations.</Muted>
          </>
        ) : null}
      </FormModal>
    </Screen>
  );
}
