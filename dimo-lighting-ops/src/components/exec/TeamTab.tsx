import { router } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ListRow, Muted, Pill, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { REQUEST_STATUS, roleTypeLabel, type AccessRequest, type ExecMember, type ExecProject } from '@/lib/execution';
import { fmtDate } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Person = { id: string; full_name: string; role: string; is_temporary: boolean; company: string | null; phone: string | null };

/** Project team: engineers, trainees and subcontractor supervisors (appointed with SM Projects approval). */
export function TeamTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const lead = me.role === 'senior_elec_engineer' || me.role === 'sm_projects';
  const { data, reload } = useLoad(async () => {
    const [m, r, pr] = await Promise.all([
      supabase.from('exec_members').select('*').eq('exec_project_id', p.id).order('added_at'),
      lead || me.role === 'gm' ? supabase.from('access_requests').select('*').contains('project_ids', [p.id]).order('requested_at', { ascending: false }) : Promise.resolve({ data: [] }),
      supabase.from('profiles').select('id, full_name, role, is_temporary, company, phone'),
    ]);
    return { members: (m.data ?? []) as ExecMember[], requests: (r.data ?? []) as AccessRequest[], profiles: (pr.data ?? []) as Person[] };
  }, [p.id]);
  if (!data) return null;
  const prof = (id: string) => data.profiles.find((x) => x.id === id);
  const active = data.members.filter((m) => m.active);
  const past = data.members.filter((m) => !m.active);
  const pending = data.requests.filter((r) => r.kind === 'sub_appoint' && ['pending_smp', 'approved'].includes(r.status));

  const add = async () => {
    const candidates = data.profiles.filter((x) => (x.role === 'assistant_engineer' || x.role === 'trainee') && !active.some((m) => m.user_id === x.id));
    const r = await dialog.prompt({
      title: 'Add a team member',
      message: 'Assistant Engineers (permanent or temporary) and Trainees. Subcontractor supervisors are nominated for SM Projects approval.',
      fields: [
        { key: 'u', label: 'Person', type: 'select', required: true, options: candidates.map((x) => ({ value: x.id, label: `${x.full_name} · ${roleTypeLabel(x.role, x.is_temporary)}` })) },
        { key: 'z', label: 'Zones / work packages' },
      ],
      confirmLabel: 'Add',
    });
    if (r) await dialog.run(async () => { await rpc('add_exec_member', { p_exec: p.id, p_user: r.u, p_zones: r.z || null }); await reload(); }, 'Added – they are told');
  };

  const remove = async (m: ExecMember) => {
    const r = await dialog.prompt({
      title: `Remove ${prof(m.user_id)?.full_name ?? ''}`,
      message: m.member_role === 'sub_supervisor' ? 'Access to this project ends at once and cached project data is wiped from their phone. SM Projects is told.' : undefined,
      fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }],
      confirmLabel: 'Remove',
      danger: true,
    });
    if (r) await dialog.run(async () => { await rpc('remove_exec_member', { p_member: m.id, p_reason: r.r }); await reload(); }, 'Removed');
  };

  const row = (m: ExecMember) => {
    const x = prof(m.user_id);
    return (
      <ListRow
        key={m.id}
        wrapRight
        title={x?.full_name ?? people[m.user_id]?.full_name ?? '—'}
        subtitle={[
          roleTypeLabel(m.member_role, !!x?.is_temporary),
          x?.company,
          m.zones,
          m.member_role === 'sub_supervisor' && x?.phone ? `login ${x.phone}` : null,
          m.valid_to ? `until ${fmtDate(m.valid_to)}` : null,
          !m.active ? `removed ${fmtDate(m.removed_at)} – ${m.remove_reason ?? ''}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        right={
          <Row gap={6}>
            <Pill label={m.member_role === 'sub_supervisor' ? 'External' : 'Team'} tone={m.member_role === 'sub_supervisor' ? colors.amber : colors.blue} />
            {lead && m.active ? <Button small variant="ghost" title="Remove" onPress={() => remove(m)} /> : null}
          </Row>
        }
      />
    );
  };

  return (
    <>
      <Section title={`Team (${active.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <ListRow title={people[p.see_id ?? '']?.full_name ?? 'Senior Electrical Engineer'} subtitle="Senior Electrical Engineer · plans, assigns, approves" />
          {active.map(row)}
          {!active.length ? <Muted style={{ padding: 12 }}>No engineers or supervisors on the project yet</Muted> : null}
        </Card>
        {lead && p.status === 'active' ? (
          <Row wrap gap={6} style={{ marginTop: 8 }}>
            <Button small title="+ Add engineer / trainee" onPress={add} />
            {me.role === 'senior_elec_engineer' ? <Button small variant="secondary" title="+ Nominate subcontractor supervisor" onPress={() => router.push({ pathname: '/execution/nominate', params: { project: p.id } })} /> : null}
          </Row>
        ) : null}
      </Section>
      {pending.length ? (
        <Section title="Supervisor nominations">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {pending.map((r) => (
              <ListRow key={r.id} onPress={() => router.push(`/execution/access/${r.id}`)} title={`${r.person_name} · ${r.company ?? ''}`} subtitle={`${r.code} · ${REQUEST_STATUS[r.status]}`} />
            ))}
          </Card>
        </Section>
      ) : null}
      {past.length && me.role !== 'sub_supervisor' ? (
        <Section title={`Earlier members (${past.length})`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>{past.map(row)}</Card>
        </Section>
      ) : null}
    </>
  );
}
