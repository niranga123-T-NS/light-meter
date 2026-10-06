import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { sevTone } from '@/components/exec/HseRows';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { hseKind, type ExecMember, type HseAction, type HseReport } from '@/lib/execution';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** One HSE report: corrective actions assigned and tracked to closure. */
export default function HseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, reload } = useLoad(async () => {
    const { data: r, error: e } = await supabase.from('hse_reports').select('*, exec_projects(name, code)').eq('id', id).single();
    if (e) throw new Error(e.message);
    const rep = r as HseReport & { exec_projects: { name: string; code: string } | null };
    const [a, m] = await Promise.all([
      supabase.from('hse_actions').select('*').eq('report_id', id).order('created_at'),
      supabase.from('exec_members').select('*').eq('exec_project_id', rep.exec_project_id).eq('active', true),
    ]);
    return { r: rep, actions: (a.data ?? []) as HseAction[], members: (m.data ?? []) as ExecMember[] };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { r, actions } = data;
  const lead = me.role === 'senior_elec_engineer' || me.role === 'sm_projects';
  const canAssign = r.status === 'open' && (lead || me.role === 'assistant_engineer');

  const addAction = async () => {
    const options = [
      ...Object.values(people).filter((p) => p.role === 'senior_elec_engineer' && p.active).map((p) => ({ value: p.id, label: `${p.full_name} · Senior Elec. Engineer` })),
      ...data.members.map((m) => ({ value: m.user_id, label: `${people[m.user_id]?.full_name ?? '—'} · ${m.member_role === 'sub_supervisor' ? 'supervisor' : 'engineer'}` })),
    ];
    const res = await dialog.prompt({
      title: 'Corrective action',
      fields: [
        { key: 'a', label: 'Action', type: 'multiline', required: true },
        { key: 'u', label: 'Assign to', type: 'select', required: true, options },
        { key: 'd', label: 'Due', type: 'date', required: true, initial: todayISO() },
      ],
      confirmLabel: 'Assign',
    });
    if (res) await dialog.run(async () => { await rpc('add_hse_action', { p_report: r.id, p_action: res.a, p_assignee: res.u, p_due: res.d }); await reload(); }, 'Assigned – it is in their My Day');
  };
  const done = async (a: HseAction) => {
    const res = await dialog.prompt({ title: 'Action done', message: a.action, fields: [{ key: 'n', label: 'What was done', type: 'multiline', required: true }], confirmLabel: 'Done' });
    if (res) await dialog.run(async () => { await rpc('complete_hse_action', { p_id: a.id, p_note: res.n }); await reload(); }, 'Recorded');
  };
  const close = async () => {
    const res = await dialog.prompt({ title: 'Close the report', fields: [{ key: 'n', label: 'Root cause and lesson learned', type: 'multiline', required: true }], confirmLabel: 'Close' });
    if (res) await dialog.run(async () => { await rpc('close_hse_report', { p_id: r.id, p_note: res.n }); await reload(); }, 'Closed');
  };

  return (
    <Screen maxWidth={860} onRefresh={reload}>
      <Stack.Screen options={{ title: r.code }} />
      <TestingBanner what="HSE reporting" />
      <Card style={{ borderLeftWidth: 4, borderLeftColor: sevTone(r.severity) }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{`${hseKind(r.kind)} · ${r.exec_projects?.name ?? ''}`}</Text>
          <Row gap={4}>
            <Pill label={r.severity} tone={sevTone(r.severity)} solid />
            {r.lost_time ? <Pill label="LTI" tone={colors.red} solid /> : null}
            <Pill label={r.status === 'open' ? 'Open' : 'Closed'} tone={r.status === 'open' ? colors.amber : colors.green} />
          </Row>
        </Row>
        <KeyValue label="When / where" value={`${fmtDateTime(r.occurred_at)} · ${r.location}`} />
        <KeyValue label="Description" value={r.description} />
        {r.immediate_action ? <KeyValue label="Immediate action" value={r.immediate_action} /> : null}
        {r.kind === 'incident' ? <KeyValue label="Injured" value={String(r.injured)} /> : null}
        <KeyValue label="Reported by" value={`${people[r.reported_by]?.full_name ?? ''} · ${fmtDateTime(r.reported_at)}`} />
        {r.close_note ? <Notice tone={colors.green}>{`Closed ${fmtDateTime(r.closed_at)}: ${r.close_note}`}</Notice> : null}
        <Row wrap gap={6} style={{ marginTop: 8 }}>
          {canAssign ? <Button title="+ Corrective action" onPress={addAction} /> : null}
          {lead && r.status === 'open' ? <Button variant="secondary" title="Close report" onPress={close} /> : null}
        </Row>
      </Card>
      <Section title={`Corrective actions (${actions.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {actions.map((a) => (
            <ListRow
              key={a.id}
              wrapRight
              highlight={a.status === 'open' && a.due_date < todayISO() ? colors.red : undefined}
              title={a.action}
              subtitle={`${people[a.assignee_id]?.full_name ?? ''} · due ${fmtDate(a.due_date)}${a.done_note ? ` · ${a.done_note}` : ''}`}
              right={
                <Row gap={4}>
                  <Pill label={a.status === 'done' ? 'Done' : 'Open'} tone={a.status === 'done' ? colors.green : colors.amber} />
                  {a.status === 'open' && (a.assignee_id === me.id || lead) ? <Button small title="Done" onPress={() => done(a)} /> : null}
                </Row>
              }
            />
          ))}
          {!actions.length ? <Muted style={{ padding: 12 }}>No corrective actions yet</Muted> : null}
        </Card>
      </Section>
      <Attachments entityType="hse_report" entityId={r.id} kinds={['hse_photo']} title="Photos" allowCamera canUpload={r.status === 'open'} />
    </Screen>
  );
}
