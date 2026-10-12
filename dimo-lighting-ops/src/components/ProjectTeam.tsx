import { router } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ListRow, Loading, Muted, Pill, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad, useMasters, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

export type TeamMember = {
  id: string;
  category: string;
  organization_id: string;
  organization: string;
  contact_id: string | null;
  contact: string | null;
  designation: string | null;
  phone: string | null;
  email: string | null;
  status: 'appointed' | 'met' | 'replaced';
  source: 'visit' | 'manual';
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
  last_visit_at: string | null;
  visits: number;
};

/** The roles every project should have someone for (Section 4.3) */
export const KEY_ROLES = ['End-Client', 'Architect', 'Electrical Consultant', 'MEP Consultant', 'Main Contractor', 'MEP Contractor'];
export const TEAM_STATUS: Record<TeamMember['status'], { label: string; tone: string }> = {
  appointed: { label: 'Appointed', tone: colors.green },
  met: { label: 'Met – not confirmed', tone: colors.blue },
  replaced: { label: 'Replaced', tone: colors.grey },
};
const STATUS_OPTIONS = (Object.keys(TEAM_STATUS) as TeamMember['status'][]).map((k) => ({ value: k, label: TEAM_STATUS[k].label }));
const CONSULTANT_VIEW = ['gm', 'sm_projects', 'asm_building', 'asm_infra', 'sm_estimation', 'am_estimation'];

/** Project team: who is the architect, MEP / electrical consultant, contractors … – appointed or only met; editable by sales and SM Projects */
export function ProjectTeam({ projectId, canEdit, compact, title = 'Project team' }: { projectId: string; canEdit?: boolean; compact?: boolean; title?: string }) {
  const me = useMe();
  const dialog = useDialog();
  const masters = useMasters();
  const people = usePeople();
  const { data, reload } = useLoad(() => rpc<TeamMember[]>('project_team', { p_project: projectId }), [projectId]);
  if (!data) return compact ? null : <Section title={title}><Loading /></Section>;
  if (compact && !data.length) return null;
  const current = data.filter((m) => m.status !== 'replaced');
  const covered = new Set(current.map((m) => m.category));
  const roles = masters.values('visit_category');
  const save = (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) =>
    dialog.run(async () => {
      const { error } = await fn();
      if (error) throw new Error(error.message.includes('duplicate') ? 'This organisation is already on the team in that role' : error.message);
      await reload();
    }, ok);

  // Contact person: one of the organisation's contacts or a new one
  const pickContact = async (orgId: string, orgName: string, current?: string | null) => {
    const { data: cs } = await supabase.from('contacts').select('id, name, designation').eq('organization_id', orgId).order('name');
    const r = await dialog.prompt({
      title: `Contact person – ${orgName}`,
      fields: [
        { key: 'c', label: 'Contact', type: 'select', initial: current ?? '', options: [{ value: '', label: '— none / new —' }, ...((cs ?? []) as { id: string; name: string; designation: string | null }[]).map((c) => ({ value: c.id, label: c.designation ? `${c.name} – ${c.designation}` : c.name }))] },
        { key: 'n', label: '…or a new contact name', hint: 'Only when not in the list' },
        { key: 'd', label: 'Designation (new contact)', hint: 'e.g. Principal Architect, Lead MEP Engineer' },
        { key: 'p', label: 'Phone (new contact)' },
      ],
      confirmLabel: 'Use',
    });
    if (!r) return undefined;
    if (r.c) return r.c;
    if (!r.n?.trim()) return null;
    const { data: nc, error } = await supabase.from('contacts').insert({ organization_id: orgId, name: r.n.trim(), designation: r.d || null, phone: r.p || null }).select('id').single();
    if (error) throw new Error(error.message);
    return nc.id as string;
  };

  const add = async () => {
    const { data: orgs } = await supabase.from('organizations').select('id, name, visit_category').eq('status', 'active').order('name').limit(3000);
    const list = (orgs ?? []) as { id: string; name: string; visit_category: string }[];
    const r = await dialog.prompt({
      title: 'Add to the project team',
      message: 'From tender documents, drawing title blocks or the client – no visit needed. A visit to them later is linked automatically.',
      fields: [
        { key: 'role', label: 'Role on this project', type: 'select', required: true, initial: KEY_ROLES.find((k) => !covered.has(k)) ?? 'Architect', options: roles.map((v) => ({ value: v, label: v })) },
        { key: 'o', label: 'Organisation (pick from the list)', type: 'select', searchable: true, options: list.map((o) => ({ value: o.id, label: `${o.name} · ${o.visit_category}` })) },
        { key: 'n', label: '…or a new organisation name', hint: 'Only when they are not in the system yet' },
        { key: 's', label: 'Status', type: 'select', initial: 'appointed', options: STATUS_OPTIONS.filter((o) => o.value !== 'replaced') },
        { key: 'notes', label: 'Notes', type: 'multiline', hint: 'e.g. From the tender drawings; specifies European brands; reviews all lighting submittals' },
      ],
      confirmLabel: 'Next – contact person',
    });
    if (!r) return;
    await dialog.run(async () => {
      let orgId = r.o || null;
      let orgName = list.find((o) => o.id === orgId)?.name ?? '';
      if (!orgId && r.n?.trim()) {
        const ex = list.find((o) => o.name.trim().toLowerCase() === r.n.trim().toLowerCase());
        if (ex) [orgId, orgName] = [ex.id, ex.name];
        else {
          const { data: no, error } = await supabase.from('organizations').insert({ name: r.n.trim(), visit_category: r.role }).select('id, name').single();
          if (error) throw new Error(error.message);
          [orgId, orgName] = [no.id, no.name];
        }
      }
      if (!orgId) throw new Error('Pick the organisation or type a new name');
      const contact = await pickContact(orgId, orgName);
      const { error } = await supabase
        .from('project_stakeholders')
        .insert({ project_id: projectId, organization_id: orgId, category: r.role, status: r.s || 'appointed', source: 'manual', notes: r.notes || null, contact_id: contact ?? null, updated_by: me.id });
      if (error) throw new Error(error.message.includes('duplicate') ? `${orgName} is already on the team as ${r.role}` : error.message);
      await reload();
    }, 'Added to the project team');
  };

  const edit = async (m: TeamMember) => {
    const r = await dialog.prompt({
      title: `${m.category} – ${m.organization}`,
      fields: [
        { key: 's', label: 'Status', type: 'select', initial: m.status, options: STATUS_OPTIONS },
        { key: 'notes', label: 'Notes', type: 'multiline', initial: m.notes ?? '' },
        { key: 'c', label: 'Contact person', type: 'select', initial: 'keep', options: [{ value: 'keep', label: m.contact ? `Keep ${m.contact}` : 'Keep – none' }, { value: 'change', label: 'Change the contact person…' }] },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    await dialog.run(async () => {
      const contact = r.c === 'change' ? await pickContact(m.organization_id, m.organization, m.contact_id) : m.contact_id;
      const { error } = await supabase
        .from('project_stakeholders')
        .update({ status: r.s, notes: r.notes || null, contact_id: contact === undefined ? m.contact_id : contact, updated_by: me.id, updated_at: new Date().toISOString() })
        .eq('id', m.id);
      if (error) throw new Error(error.message);
      await reload();
    }, 'Saved');
  };
  const remove = async (m: TeamMember) => {
    if (await dialog.confirm('Remove from the team?', `${m.organization} as ${m.category}. Use “Replaced” instead to keep the history.`, { danger: true, confirmLabel: 'Remove' }))
      await save(() => supabase.from('project_stakeholders').delete().eq('id', m.id), 'Removed');
  };

  const row = (m: TeamMember) => (
    <ListRow
      key={m.id}
      title={`${m.category} · ${m.organization}`}
      subtitle={[
        m.contact ? `${m.contact}${m.designation ? ` – ${m.designation}` : ''}${m.phone ? ` · ${m.phone}` : ''}${m.email ? ` · ${m.email}` : ''}` : 'No contact person',
        m.last_visit_at ? `Last met ${fmtDate(m.last_visit_at)} (${m.visits} visit${m.visits === 1 ? '' : 's'})` : 'Not visited yet',
        m.notes,
        !compact && m.updated_by && m.source === 'manual' ? `Updated by ${people[m.updated_by]?.full_name ?? ''} · ${fmtDateTime(m.updated_at)}` : null,
      ]
        .filter(Boolean)
        .join('\n')}
      highlight={m.status === 'appointed' ? colors.green : undefined}
      right={
        <Row gap={6} wrap style={{ justifyContent: 'flex-end' }}>
          <Pill label={TEAM_STATUS[m.status].label} tone={TEAM_STATUS[m.status].tone} />
          {CONSULTANT_VIEW.includes(me.role) ? <Button small variant="ghost" title="All their projects" onPress={() => router.push(`/consultants/${m.organization_id}`)} /> : null}
          {canEdit && m.source === 'manual' ? <Button small variant="ghost" title="Remove" onPress={() => remove(m)} /> : null}
        </Row>
      }
      wrapRight
      onPress={canEdit ? () => edit(m) : undefined}
    />
  );

  return (
    <Section title={`${title} (${current.length})`} right={canEdit ? <Button small title="+ Team member" onPress={add} /> : null}>
      {!compact ? (
        <Card style={{ gap: 6 }}>
          <Row wrap gap={6}>
            {KEY_ROLES.map((c) => (
              <Pill key={c} label={`${covered.has(c) ? '✓' : '✗'} ${c}`} tone={covered.has(c) ? colors.green : colors.red} />
            ))}
          </Row>
          <Muted>{`Key roles known: ${KEY_ROLES.filter((c) => covered.has(c)).length} of ${KEY_ROLES.length}.${canEdit ? ' Tap a member to change their status, contact person or notes.' : ''}`}</Muted>
        </Card>
      ) : null}
      <Card style={{ padding: 0, overflow: 'hidden', marginTop: compact ? 0 : 8 }}>
        {data.length ? data.map(row) : <ListRow title="No one recorded yet" subtitle={canEdit ? 'Add the architect, consultants and contractors you know of' : undefined} />}
      </Card>
      {compact && !data.some((m) => m.status === 'appointed') ? <Muted>No one confirmed as appointed yet.</Muted> : null}
    </Section>
  );
}
