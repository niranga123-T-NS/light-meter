import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Pill, Row, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { REPORT_STATUS, type ExecReport } from '@/lib/execution';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** One daily report: the Assistant Engineer verifies a supervisor's report; the Senior Electrical Engineer reviews an engineer's. */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, reload } = useLoad(async () => {
    const { data: r, error: e } = await supabase.from('exec_reports').select('*, exec_projects(name, code)').eq('id', id).single();
    if (e) throw new Error(e.message);
    return r as ExecReport & { exec_projects: { name: string; code: string } | null };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const r = data;
  const canReview = r.status === 'submitted' && r.author_id !== me.id && (r.level === 'supervisor' ? me.role === 'assistant_engineer' || me.role === 'senior_elec_engineer' : me.role === 'senior_elec_engineer');
  const review = async (ok: boolean) => {
    const res = await dialog.prompt({
      title: ok ? (r.level === 'supervisor' ? 'Verify the report' : 'Mark reviewed') : 'Return the report',
      fields: [{ key: 'n', label: ok ? 'Comment (optional)' : 'What needs to be corrected', type: 'multiline', required: !ok }],
      confirmLabel: ok ? 'Confirm' : 'Return',
    });
    if (res) await dialog.run(async () => { await rpc('review_exec_report', { p_id: r.id, p_ok: ok, p_note: res.n || null }); await reload(); }, ok ? 'Done' : 'Returned');
  };
  return (
    <Screen maxWidth={860} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Daily report' }} />
      <TestingBanner what="Daily reports" />
      <Card>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{`${people[r.author_id]?.full_name ?? ''} · ${fmtDate(r.report_date)}`}</Text>
          <Row gap={4}>
            {r.is_late ? <Pill label="Late" tone={colors.red} /> : null}
            <Pill label={REPORT_STATUS[r.status]} tone={r.status === 'verified' ? colors.green : r.status === 'returned' ? colors.red : colors.amber} solid />
          </Row>
        </Row>
        <Muted>{`${r.exec_projects?.name ?? ''} · ${r.level === 'supervisor' ? 'Supervisor report' : 'Assistant Engineer report'} · submitted ${fmtDateTime(r.submitted_at)}`}</Muted>
        {r.review_note ? <Notice tone={r.status === 'returned' ? colors.red : colors.blue}>{`${people[r.reviewed_by ?? '']?.full_name ?? ''}: ${r.review_note}`}</Notice> : null}
        {r.level === 'supervisor' ? <KeyValue label="Crew" value={`${r.crew_count ?? 0}${r.crew ? ` · ${r.crew}` : ''}`} /> : null}
        <KeyValue label="Work done" value={r.work_done} />
        {r.inspections ? <KeyValue label="Inspections and tests" value={r.inspections} /> : null}
        {r.delays ? <KeyValue label="Delays" value={r.delays} /> : null}
        {r.issues ? <KeyValue label="Issues / needs" value={r.issues} /> : null}
        {r.work_next ? <KeyValue label="Planned for tomorrow" value={r.work_next} /> : null}
        <KeyValue label="Safety" value={`${r.toolbox_talk ? `Toolbox talk: ${r.toolbox_topic}` : 'No toolbox talk'} · ${r.safety_check ? 'safety check done' : 'no safety check'}${r.hse_notes ? ` · ${r.hse_notes}` : ''}`} />
        {r.weather || r.visitors ? <KeyValue label="Weather / visitors" value={[r.weather, r.visitors].filter(Boolean).join(' · ')} /> : null}
        <Row wrap gap={6} style={{ marginTop: 8 }}>
          {canReview ? (
            <>
              <Button title={r.level === 'supervisor' ? 'Verify' : 'Reviewed'} onPress={() => review(true)} />
              <Button variant="secondary" title="Return" onPress={() => review(false)} />
            </>
          ) : null}
          {r.status === 'returned' && r.author_id === me.id ? (
            <Button title="Correct and resubmit" onPress={() => router.push({ pathname: '/execution/report/new', params: { project: r.exec_project_id, date: r.report_date } })} />
          ) : null}
        </Row>
      </Card>
      <Attachments entityType="exec_report" entityId={r.id} kinds={['daily_photo', 'daily_doc']} title="Photos and documents" allowCamera canUpload={r.author_id === me.id && r.status !== 'verified'} />
    </Screen>
  );
}
