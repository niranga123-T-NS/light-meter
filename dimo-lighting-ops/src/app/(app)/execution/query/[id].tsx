import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { dqTone } from '@/components/exec/QueryRows';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Notice, Pill, Row, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { DQ_STATUS, type DesignQuery } from '@/lib/execution';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const DESIGN = ['design_manager', 'lighting_designer', 'lighting_engineer'];

/** One design query: screening by the SEE, assignment and answer by the design team, closed by the site. */
export default function QueryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data: q, error, reload } = useLoad(async () => {
    const { data, error: e } = await supabase.from('design_queries').select('*, exec_projects(name, code)').eq('id', id).single();
    if (e) throw new Error(e.message);
    return data as DesignQuery & { exec_projects: { name: string; code: string } | null };
  }, [id]);
  if (!q) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const isSee = me.role === 'senior_elec_engineer';

  const screen = async (fwd: boolean) => {
    const res = await dialog.prompt({
      title: fwd ? 'Send to Design' : 'Answer it yourself',
      fields: [{ key: 'n', label: fwd ? 'Note to the Design Manager' : 'Answer', type: 'multiline', required: !fwd }],
      confirmLabel: fwd ? 'Send' : 'Answer',
    });
    if (res) await dialog.run(async () => { await rpc('forward_design_query', { p_id: q.id, p_forward: fwd, p_note: res.n || null }); await reload(); }, fwd ? 'Sent to the Design Manager' : 'Answered');
  };
  const assign = async () => {
    const options = Object.values(people)
      .filter((p) => p.active && DESIGN.includes(p.role))
      .map((p) => ({ value: p.id, label: p.full_name }));
    const res = await dialog.prompt({ title: 'Assign to', fields: [{ key: 'p', label: 'Designer', type: 'select', required: true, options }], confirmLabel: 'Assign' });
    if (res) await dialog.run(async () => { await rpc('assign_design_query', { p_id: q.id, p_person: res.p }); await reload(); }, 'Assigned');
  };
  const answer = async () => {
    const res = await dialog.prompt({ title: 'Answer', message: 'Attach revised drawings below if needed.', fields: [{ key: 'a', label: 'Answer', type: 'multiline', required: true }], confirmLabel: 'Send answer' });
    if (res) await dialog.run(async () => { await rpc('answer_design_query', { p_id: q.id, p_answer: res.a }); await reload(); }, 'The site is told');
  };
  const close = () => dialog.run(async () => { await rpc('close_design_query', { p_id: q.id }); await reload(); }, 'Closed');

  return (
    <Screen maxWidth={860} onRefresh={reload}>
      <Stack.Screen options={{ title: q.code }} />
      <TestingBanner what="Design queries" />
      <Card style={{ borderLeftWidth: 4, borderLeftColor: dqTone(q) }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{`${q.code} · ${q.exec_projects?.name ?? ''}`}</Text>
          <Pill label={DQ_STATUS[q.status]} tone={dqTone(q)} solid />
        </Row>
        <KeyValue label="Question" value={q.question} />
        {q.drawing_ref ? <KeyValue label="Drawing / document" value={q.drawing_ref} /> : null}
        {q.blocks ? <KeyValue label="Holds up" value={q.blocks} /> : null}
        <KeyValue label="Raised by" value={`${people[q.raised_by]?.full_name ?? ''} · ${fmtDateTime(q.raised_at)}`} />
        {q.target_date ? <KeyValue label="Answer by" value={fmtDate(q.target_date)} /> : null}
        {q.assignee_id ? <KeyValue label="With" value={people[q.assignee_id]?.full_name ?? ''} /> : null}
        {q.note ? <Notice>{q.note}</Notice> : null}
        {q.answer ? <Notice tone={colors.green}>{`Answer (${people[q.answered_by ?? '']?.full_name ?? ''}, ${fmtDateTime(q.answered_at)}): ${q.answer}`}</Notice> : null}
        <Row wrap gap={6} style={{ marginTop: 8 }}>
          {isSee && q.status === 'raised' ? <Button title="Send to Design" onPress={() => screen(true)} /> : null}
          {isSee && q.status === 'raised' ? <Button variant="secondary" title="Answer myself" onPress={() => screen(false)} /> : null}
          {me.role === 'design_manager' && q.status === 'forwarded' ? <Button variant="secondary" title="Assign" onPress={assign} /> : null}
          {DESIGN.includes(me.role) && q.status === 'forwarded' ? <Button title="Answer" onPress={answer} /> : null}
          {q.status === 'answered' && (q.raised_by === me.id || isSee) ? <Button title="Close" onPress={close} /> : null}
        </Row>
      </Card>
      <Attachments entityType="design_query" entityId={q.id} kinds={['dq_file']} title="Sketches, photos and revised drawings" allowCamera canUpload={q.status !== 'closed'} />
    </Screen>
  );
}
