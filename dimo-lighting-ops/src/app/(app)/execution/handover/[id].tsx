import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Notice, Pill, Row, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { areaLabel, EXR_STATUS, type ExecRequest } from '@/lib/execution';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const tone = (s: ExecRequest['status']) => (s === 'approved' ? colors.green : s === 'pending_smp' ? colors.amber : colors.grey);

/** One hand-over request: SM Projects approves and assigns the Senior Electrical Engineer, or returns it with the reason. */
export default function HandoverScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data: r, error, reload } = useLoad(async () => {
    const { data, error: e } = await supabase.from('exec_requests').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    return data as ExecRequest;
  }, [id]);
  if (!r) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const smp = me.role === 'sm_projects' && r.status === 'pending_smp';

  const approve = async () => {
    const options = Object.values(people)
      .filter((p) => p.role === 'senior_elec_engineer' && p.active)
      .map((p) => ({ value: p.id, label: p.full_name }));
    const res = await dialog.prompt({
      title: 'Assign to execution',
      message: r.name,
      fields: [
        { key: 's', label: 'Senior Electrical Engineer', type: 'select', required: true, options, initial: r.see_id ?? undefined },
        { key: 'n', label: 'Note', type: 'multiline' },
      ],
      confirmLabel: 'Approve',
    });
    if (res)
      await dialog.run(async () => {
        const eid = await rpc<string>('decide_execution_request', { p_id: r.id, p_approve: true, p_see: res.s, p_note: res.n || null });
        router.replace(`/execution/${eid}`);
      }, 'Assigned – the Senior Electrical Engineer is told');
  };
  const reject = async () => {
    const res = await dialog.prompt({ title: 'Not approved', fields: [{ key: 'n', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Return', danger: true });
    if (res) await dialog.run(async () => { await rpc('decide_execution_request', { p_id: r.id, p_approve: false, p_note: res.n }); await reload(); }, 'Returned');
  };
  const cancel = async () => {
    if (await dialog.confirm('Cancel this request?')) await dialog.run(async () => { await rpc('cancel_execution_request', { p_id: r.id }); await reload(); }, 'Cancelled');
  };

  return (
    <Screen maxWidth={860} onRefresh={reload}>
      <Stack.Screen options={{ title: r.code }} />
      <TestingBanner what="Hand-over to execution" />
      <Card style={{ borderLeftWidth: 4, borderLeftColor: tone(r.status) }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{r.name}</Text>
          <Row gap={4}>
            <Pill label={r.kind === 'won' ? 'Won in the system' : 'Won before the system'} />
            <Pill label={EXR_STATUS[r.status]} tone={tone(r.status)} solid />
          </Row>
        </Row>
        {r.client_name ? <KeyValue label="Client" value={r.client_name} /> : null}
        {r.contract_value_lkr ? <KeyValue label="Contract value" value={fmtMoney(r.contract_value_lkr, 'LKR')} /> : null}
        {r.contract_ref ? <KeyValue label="Contract / PO" value={r.contract_ref} /> : null}
        <KeyValue label="Project areas" value={r.areas.length ? r.areas.map(areaLabel).join(' · ') : 'To be set by the SEE'} />
        {r.see_id ? <KeyValue label="Senior Electrical Engineer" value={people[r.see_id]?.full_name ?? ''} /> : null}
        {r.site_address ? <KeyValue label="Site" value={r.site_address} /> : null}
        {r.start_date || r.end_date ? <KeyValue label="Dates" value={`${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}`} /> : null}
        <KeyValue label="Requested by" value={`${people[r.requested_by]?.full_name ?? ''} · ${fmtDateTime(r.requested_at)}`} />
        {r.note ? <Notice>{r.note}</Notice> : null}
        {r.decision_note ? <Notice tone={r.status === 'rejected' ? colors.red : colors.green}>{`${people[r.decided_by ?? '']?.full_name ?? ''}: ${r.decision_note}`}</Notice> : null}
        <Row wrap gap={6} style={{ marginTop: 8 }}>
          {smp ? <Button title="Approve and assign" onPress={approve} /> : null}
          {smp ? <Button variant="secondary" title="Not approved" onPress={reject} /> : null}
          {r.status === 'pending_smp' && r.requested_by === me.id ? <Button variant="secondary" title="Cancel request" onPress={cancel} /> : null}
          {r.exec_project_id ? <Button title="Open execution project" onPress={() => router.push(`/execution/${r.exec_project_id}`)} /> : null}
          {r.project_id ? <Button variant="ghost" title="Sales project" onPress={() => router.push(`/projects/${r.project_id}`)} /> : null}
        </Row>
      </Card>
      <Attachments entityType="exec_request" entityId={r.id} kinds={['handover_doc']} title="Contract documents" canUpload={(r.status === 'pending_smp' && r.requested_by === me.id) || me.role === 'sm_projects'} />
    </Screen>
  );
}
