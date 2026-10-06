import { router, Stack } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Loading, Muted, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { REQUEST_KIND, REQUEST_STATUS, roleTypeLabel, type AccessRequest, type ExecMember } from '@/lib/execution';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Temp = { id: string; full_name: string; role: string; is_temporary: boolean; access_until: string | null; id_no: string | null; active: boolean };
type OpenItem = { kind: string; id: string; title: string; url: string };

/** Team & access: temporary Assistant Engineers / Trainees (SEE → SM Projects → DGM / GM) and the access requests. */
export default function TeamAccess() {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const see = me.role === 'senior_elec_engineer';
  const { data, error, reload, loading } = useLoad(async () => {
    const [r, t, m] = await Promise.all([
      supabase.from('access_requests').select('*').order('requested_at', { ascending: false }).limit(300),
      supabase.from('profiles').select('id, full_name, role, is_temporary, access_until, id_no, active').or('is_temporary.eq.true,role.eq.trainee').eq('active', true),
      supabase.from('exec_members').select('*, exec_projects(name, code)').eq('active', true),
    ]);
    if (r.error) throw new Error(r.error.message);
    return { requests: (r.data ?? []) as AccessRequest[], temps: (t.data ?? []) as Temp[], members: (m.data ?? []) as (ExecMember & { exec_projects: { name: string; code: string } | null })[] };
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const open = data.requests.filter((r) => ['pending_smp', 'pending_gm', 'approved'].includes(r.status));
  const closed = data.requests.filter((r) => !['pending_smp', 'pending_gm', 'approved'].includes(r.status)).slice(0, 40);

  const deleteFlow = async (t: Temp) => {
    const items = await rpc<OpenItem[]>('person_open_items', { p_user: t.id });
    if (items.length) {
      const others = Object.values(people).filter((x) => ['assistant_engineer', 'trainee'].includes(x.role) && x.id !== t.id && x.active);
      const r = await dialog.prompt({
        title: `${t.full_name} has ${items.length} open items`,
        message: `${items.map((i) => `• ${i.kind}: ${i.title}`).join('\n')}\n\nEverything must be reassigned before the deletion can be requested.`,
        fields: [{ key: 'to', label: 'Reassign all to', type: 'select', required: true, options: others.map((x) => ({ value: x.id, label: x.full_name })) }],
        confirmLabel: 'Reassign all',
      });
      if (!r) return;
      await dialog.run(() => rpc('reassign_open_items', { p_from: t.id, p_to: r.to }), 'Reassigned – the new person is told');
    }
    const r2 = await dialog.prompt({
      title: `Delete the temporary role – ${t.full_name}`,
      message: 'SM Projects and then DGM / GM approve. Access ends when approved; the history stays under the name.',
      fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }],
      confirmLabel: 'Request deletion',
      danger: true,
    });
    if (r2) await dialog.run(async () => { await rpc('request_temp_delete', { p_user: t.id, p_reason: r2.r }); await reload(); }, 'Sent to SM Projects');
  };

  const reqRow = (r: AccessRequest) => (
    <ListRow
      key={r.id}
      wrapRight
      onPress={() => router.push(`/execution/access/${r.id}`)}
      title={`${r.person_name}${r.company ? ` · ${r.company}` : ''}`}
      subtitle={`${r.code} · ${REQUEST_KIND[r.kind]}${r.kind !== 'sub_appoint' ? ` (${roleTypeLabel(r.role_type)})` : ''} · by ${people[r.requested_by]?.full_name ?? ''} ${fmtDateTime(r.requested_at)}`}
      right={<Pill label={REQUEST_STATUS[r.status]} tone={r.status === 'approved' ? colors.green : r.status === 'rejected' ? colors.red : r.status === 'done' ? colors.grey : colors.amber} />}
    />
  );

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: see ? 'Team & access' : 'Execution access' }} />
      <TestingBanner what="Team & access" />
      {see ? (
        <Row wrap gap={6}>
          <Button title="+ Request temporary staff" onPress={() => router.push('/execution/request')} />
          <Muted>{"Subcontractor supervisors are nominated from each project's Team tab."}</Muted>
        </Row>
      ) : null}
      <Section title={`In progress (${open.length})`}>
        {open.length ? <Card style={{ padding: 0, overflow: 'hidden' }}>{open.map(reqRow)}</Card> : <Empty title="No open requests" />}
      </Section>
      <Section title={`Temporary staff (${data.temps.length})`}>
        {data.temps.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.temps.map((t) => (
              <ListRow
                key={t.id}
                wrapRight
                title={t.full_name}
                subtitle={[
                  roleTypeLabel(t.role, t.is_temporary),
                  t.id_no,
                  t.access_until ? `expected end ${fmtDate(t.access_until)}` : null,
                  data.members.filter((m) => m.user_id === t.id).map((m) => m.exec_projects?.code ?? '').join(', ') || 'no project',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={see ? <Button small variant="ghost" title="Delete role…" onPress={() => deleteFlow(t)} /> : undefined}
              />
            ))}
          </Card>
        ) : (
          <Empty title="No temporary staff" />
        )}
      </Section>
      <Section title="Earlier requests">
        {closed.length ? <Card style={{ padding: 0, overflow: 'hidden' }}>{closed.map(reqRow)}</Card> : <Empty title="None yet" />}
      </Section>
    </Screen>
  );
}
