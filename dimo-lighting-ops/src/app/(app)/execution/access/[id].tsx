import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { useShellCounts } from '@/components/AppShell';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { REQUEST_KIND, REQUEST_STATUS, roleTypeLabel, type AccessRequest, type ExecProject } from '@/lib/execution';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { callFunction, rpc, supabase } from '@/lib/supabase';

/** One access request: SM Projects / DGM / GM decide; once approved the SEE (or an approver) creates the login. */
export default function AccessRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { refresh } = useShellCounts();
  const [login, setLogin] = useState<{ login: string; password: string } | null>(null);
  const { data, error, reload } = useLoad(async () => {
    const { data: r, error: e } = await supabase.from('access_requests').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const { data: ps } = await supabase.from('exec_projects').select('*').in('id', (r as AccessRequest).project_ids);
    return { r: r as AccessRequest, projects: (ps ?? []) as ExecProject[] };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { r, projects } = data;
  const myTurn = (r.status === 'pending_smp' && me.role === 'sm_projects') || (r.status === 'pending_gm' && me.role === 'gm');

  const decide = async (approve: boolean) => {
    const res = await dialog.prompt({
      title: approve ? 'Approve' : 'Reject',
      fields: [{ key: 'n', label: approve ? 'Comment (optional)' : 'Reason', type: 'multiline', required: !approve }],
      confirmLabel: approve ? 'Approve' : 'Reject',
      danger: !approve,
    });
    if (res)
      await dialog.run(async () => {
        await rpc('decide_access_request', { p_id: r.id, p_approve: approve, p_note: res.n || null });
        await reload();
        refresh();
      }, approve ? 'Approved' : 'Rejected');
  };

  const provision = () =>
    dialog.run(async () => {
      const res = await callFunction<{ login: string; password: string }>('admin-users', { action: 'provision', request_id: r.id });
      setLogin(res);
      await reload();
    }, 'Login created');

  return (
    <Screen maxWidth={760} onRefresh={reload}>
      <Stack.Screen options={{ title: r.code }} />
      <TestingBanner what="Team & access" />
      <Card>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{`${REQUEST_KIND[r.kind]} – ${r.person_name}`}</Text>
          <Pill label={REQUEST_STATUS[r.status]} tone={r.status === 'rejected' ? colors.red : r.status === 'done' ? colors.green : colors.amber} solid />
        </Row>
        <KeyValue label="Role" value={roleTypeLabel(r.role_type)} />
        {r.company ? <KeyValue label="Company" value={r.company} /> : null}
        <KeyValue label="Login" value={r.email ?? r.phone ?? '—'} />
        <KeyValue label="ID / site pass" value={r.id_no ?? '—'} />
        <KeyValue label="Projects" value={projects.map((p) => `${p.code ?? ''} ${p.name}`).join(' · ') || '—'} />
        {r.zones ? <KeyValue label="Zones / packages" value={r.zones} /> : null}
        {r.start_date ? <KeyValue label="Period" value={`${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}`} /> : null}
        {r.reason ? <KeyValue label="Reason" value={r.reason} /> : null}
        <KeyValue label="Requested" value={`${people[r.requested_by]?.full_name ?? ''} · ${fmtDateTime(r.requested_at)}`} />
        {r.smp_at ? <KeyValue label="SM Projects" value={`${people[r.smp_by ?? '']?.full_name ?? ''} · ${fmtDateTime(r.smp_at)}${r.smp_note ? ` · ${r.smp_note}` : ''}`} /> : null}
        {r.gm_at ? <KeyValue label="DGM / GM" value={`${people[r.gm_by ?? '']?.full_name ?? ''} · ${fmtDateTime(r.gm_at)}${r.gm_note ? ` · ${r.gm_note}` : ''}`} /> : null}
        {r.kind === 'temp_add' ? <Muted>Approval chain: SM Projects → DGM / GM, then the login is created.</Muted> : null}
        {r.kind === 'sub_appoint' ? <Muted>The supervisor sees only their own tasks, instructions, issued drawings, own reports and HSE – never costs, rates or other subcontractors.</Muted> : null}
        <Row wrap gap={6} style={{ marginTop: 10 }}>
          {myTurn ? (
            <>
              <Button title="Approve" onPress={() => decide(true)} />
              <Button variant="danger" title="Reject" onPress={() => decide(false)} />
            </>
          ) : null}
          {r.status === 'approved' && ['senior_elec_engineer', 'sm_projects', 'gm'].includes(me.role) ? <Button title="Create the login" onPress={provision} /> : null}
          {['pending_smp', 'pending_gm'].includes(r.status) && r.requested_by === me.id ? (
            <Button variant="ghost" title="Cancel request" onPress={() => dialog.run(async () => { await rpc('cancel_access_request', { p_id: r.id }); await reload(); }, 'Cancelled')} />
          ) : null}
        </Row>
      </Card>
      {login ? (
        <Section title="Login – hand this over now">
          <Notice tone={colors.green}>{`User name: ${login.login}\nTemporary password: ${login.password}\n\nShown only once. Ask them to sign in and change the password from their profile.`}</Notice>
        </Section>
      ) : null}
    </Screen>
  );
}
