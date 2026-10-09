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
import { loadSubcontractors, subOptions } from '@/lib/subcontractors';

type Change = { id: string; proposed: Record<string, string>; reason: string; status: string; requested_by: string; requested_at: string; decided_by: string | null; decided_at: string | null; decision_note: string | null };
const FIELD: Record<string, string> = { person_name: 'Name', company: 'Company', phone: 'Mobile', email: 'Email', id_no: 'ID / site pass', zones: 'Zones / packages', start_date: 'From', end_date: 'To' };

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
    const { data: ch } = await supabase.from('access_changes').select('*').eq('request_id', id).order('requested_at', { ascending: false });
    const subs = (r as AccessRequest).kind === 'sub_appoint' && (r as AccessRequest).project_ids[0] ? await loadSubcontractors((r as AccessRequest).project_ids[0]) : [];
    return { r: r as AccessRequest, projects: (ps ?? []) as ExecProject[], changes: (ch ?? []) as Change[], subs };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { r, projects, changes } = data;
  const pending = changes.find((c) => c.status === 'pending');
  const canEdit = me.role === 'senior_elec_engineer' && (r.kind === 'sub_appoint' || r.kind === 'temp_add') && ['pending_smp', 'approved', 'done'].includes(r.status) && !pending;
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

  const edit = async () => {
    const res = await dialog.prompt({
      title: 'Change the appointment',
      message: r.status === 'pending_smp' ? 'Not approved yet – the change applies at once.' : 'SM Projects approves the change before it applies.',
      fields: [
        { key: 'person_name', label: 'Name', required: true, initial: r.person_name },
        ...(r.kind === 'sub_appoint'
          ? [{ key: 'company', label: 'Company', type: 'select' as const, required: true, initial: r.company ?? undefined, options: subOptions(data.subs, { current: r.company }) }]
          : []),
        { key: 'phone', label: 'Mobile', initial: r.phone ?? '' },
        { key: 'email', label: 'Email', initial: r.email ?? '' },
        { key: 'id_no', label: 'ID / site pass', initial: r.id_no ?? '' },
        { key: 'zones', label: 'Zones / packages', initial: r.zones ?? '' },
        { key: 'start_date', label: 'From', type: 'date', required: true, initial: r.start_date ?? undefined },
        { key: 'end_date', label: 'To', type: 'date', required: true, initial: r.end_date ?? undefined },
        { key: 'reason', label: 'Reason for the change', type: 'multiline', required: true },
      ],
      confirmLabel: 'Submit',
    });
    if (!res) return;
    const { reason, ...rest } = res;
    const was: Record<string, string> = { person_name: r.person_name, company: r.company ?? '', phone: r.phone ?? '', email: r.email ?? '', id_no: r.id_no ?? '', zones: r.zones ?? '', start_date: r.start_date ?? '', end_date: r.end_date ?? '' };
    const changed = Object.fromEntries(Object.entries(rest).filter(([k, v]) => (v ?? '') !== (was[k] ?? '')));
    if (!Object.keys(changed).length) return dialog.toast('Nothing was changed', 'error');
    await dialog.run(async () => {
      const st = await rpc<string>('propose_access_change', { p_request: r.id, p: changed, p_reason: reason });
      await reload();
      dialog.toast(st === 'applied' ? 'Changed' : 'Sent to SM Projects for approval');
    });
  };
  const decideChange = async (c: Change, approve: boolean) => {
    const res = await dialog.prompt({
      title: approve ? 'Approve the change' : 'Reject the change',
      fields: [{ key: 'n', label: approve ? 'Comment (optional)' : 'Reason', type: 'multiline', required: !approve }],
      confirmLabel: approve ? 'Approve' : 'Reject',
      danger: !approve,
    });
    if (res)
      await dialog.run(async () => {
        await rpc('decide_access_change', { p_id: c.id, p_approve: approve, p_note: res.n || null });
        await reload();
        refresh();
      }, approve ? 'Approved – the change applies now' : 'Rejected');
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
          {canEdit ? <Button variant="secondary" title={r.status === 'pending_smp' ? '✎ Edit' : '✎ Edit (SM Projects approves)'} onPress={edit} /> : null}
          {['pending_smp', 'pending_gm'].includes(r.status) && r.requested_by === me.id ? (
            <Button variant="ghost" title="Cancel request" onPress={() => dialog.run(async () => { await rpc('cancel_access_request', { p_id: r.id }); await reload(); }, 'Cancelled')} />
          ) : null}
        </Row>
      </Card>
      {changes.length ? (
        <Section title="Changes">
          {changes.map((c) => (
            <Card key={c.id} style={{ marginBottom: 6, borderColor: c.status === 'pending' ? colors.amber : colors.line, borderWidth: 1 }}>
              <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>{`${people[c.requested_by]?.full_name ?? ''} · ${fmtDateTime(c.requested_at)}`}</Text>
                <Pill label={c.status === 'pending' ? 'Waiting for SM Projects' : c.status === 'approved' ? 'Approved' : c.status === 'rejected' ? 'Rejected' : c.status} tone={c.status === 'approved' ? colors.green : c.status === 'rejected' ? colors.red : colors.amber} />
              </Row>
              {Object.entries(c.proposed).map(([k, v]) => (
                <Muted key={k}>{`${FIELD[k] ?? k}: ${k.endsWith('_date') ? fmtDate(v) : v || '—'}`}</Muted>
              ))}
              <Muted>{`Reason: ${c.reason}`}</Muted>
              {c.decided_at ? <Muted>{`${people[c.decided_by ?? '']?.full_name ?? ''} · ${fmtDateTime(c.decided_at)}${c.decision_note ? ` · ${c.decision_note}` : ''}`}</Muted> : null}
              {c.status === 'pending' && me.role === 'sm_projects' ? (
                <Row gap={6} style={{ marginTop: 6 }}>
                  <Button title="Approve change" onPress={() => decideChange(c, true)} />
                  <Button variant="danger" title="Reject" onPress={() => decideChange(c, false)} />
                </Row>
              ) : null}
            </Card>
          ))}
        </Section>
      ) : null}
      {login ? (
        <Section title="Login – hand this over now">
          <Notice tone={colors.green}>{`User name: ${login.login}\nTemporary password: ${login.password}\n\nShown only once. Ask them to sign in and change the password from their profile.`}</Notice>
        </Section>
      ) : null}
    </Screen>
  );
}
