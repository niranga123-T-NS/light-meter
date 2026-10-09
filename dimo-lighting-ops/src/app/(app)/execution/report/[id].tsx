import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Pill, Row, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { printDailyReport, type DailyReport } from '@/lib/dailyReportPdf';
import { ITEM_STATUS, REPORT_STATUS, type ExecProject } from '@/lib/execution';
import { ROLE_LABELS } from '@/lib/roles';
import { fmtDate, fmtDateTimeY, fmtTime } from '@/lib/format';
import type { HseRecord } from '@/lib/hse';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type SubUpdate = { id: string; title: string; zone: string | null; qty: number | null; unit: string | null; status: keyof typeof ITEM_STATUS; done_qty: number | null; note: string | null; permits: string[] };

/** One daily report: the Assistant Engineer verifies a supervisor's report; the Senior Electrical Engineer reviews an engineer's. */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, reload } = useLoad(async () => {
    const { data: r, error: e } = await supabase.from('exec_reports').select('*, exec_projects(*)').eq('id', id).single();
    if (e) throw new Error(e.message);
    const rep = r as DailyReport & { exec_projects: ExecProject | null; permit_ids?: string[]; sub_plan_updates?: SubUpdate[] };
    const { data: pm } = rep.permit_ids?.length ? await supabase.from('hse_records').select('id, code, header, starts_at, ends_at, status').in('id', rep.permit_ids) : { data: [] };
    return { ...rep, permits: (pm ?? []) as Pick<HseRecord, 'id' | 'code' | 'header' | 'starts_at' | 'ends_at' | 'status'>[] };
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
        <Muted>{`${r.exec_projects?.name ?? ''} · ${r.level === 'supervisor' ? 'Supervisor report' : 'Assistant Engineer report'} · submitted ${fmtDateTimeY(r.submitted_at)}`}</Muted>
        {r.review_note ? <Notice tone={r.status === 'returned' ? colors.red : colors.blue}>{`${people[r.reviewed_by ?? '']?.full_name ?? ''}: ${r.review_note}`}</Notice> : null}
        {r.level === 'supervisor' ? <KeyValue label="Crew" value={`${r.crew_count ?? 0}${r.crew ? ` · ${r.crew}` : ''}`} /> : null}
        {r.item_updates?.length ? (
          <View style={{ gap: 4, marginTop: 4 }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Planned activities updated</Text>
            {r.item_updates.map((it) => (
              <Row key={it.id} gap={6} wrap style={{ alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <Pill label={ITEM_STATUS[it.status]} tone={it.status === 'done' ? colors.green : it.status === 'partial' ? colors.amber : it.status === 'not_done' ? colors.red : colors.grey} />
                <Text style={{ flex: 1, minWidth: 180, color: colors.ink }}>
                  {`${it.title}${it.zone ? ` – ${it.zone}` : ''}${it.qty != null ? ` · ${it.done_qty ?? 0}/${it.qty} ${it.unit ?? ''}` : ''}${it.note ? ` · ${it.note}` : ''}${it.photos?.length ? ` · ${it.photos.length} photo${it.photos.length > 1 ? 's' : ''}` : ''}`}
                </Text>
              </Row>
            ))}
          </View>
        ) : null}
        {r.sub_plan_updates?.length ? (
          <View style={{ gap: 4, marginTop: 4 }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Supervisor&apos;s plan for the day</Text>
            {r.sub_plan_updates.map((it) => (
              <Row key={it.id} gap={6} wrap style={{ alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <Pill label={ITEM_STATUS[it.status]} tone={it.status === 'done' ? colors.green : it.status === 'partial' ? colors.amber : it.status === 'not_done' ? colors.red : colors.grey} />
                <Text style={{ flex: 1, minWidth: 180, color: colors.ink }}>
                  {`${it.title}${it.zone ? ` – ${it.zone}` : ''}${it.qty != null ? ` · ${it.done_qty ?? 0}/${it.qty} ${it.unit ?? ''}` : it.done_qty != null ? ` · ${it.done_qty} ${it.unit ?? ''}` : ''}${it.note ? ` · ${it.note}` : ''}`}
                </Text>
                <Pill label={it.permits?.length ? `Permit ${it.permits.join(', ')}` : 'No permit linked'} tone={it.permits?.length ? colors.green : colors.amber} />
              </Row>
            ))}
          </View>
        ) : null}
        {r.level === 'supervisor' ? (
          <KeyValue
            label="Work permits"
            value={r.permits.length ? r.permits.map((x) => `${x.code} · ${String(x.header.location ?? '')} · ${fmtTime(x.starts_at)}–${fmtTime(x.ends_at)}`).join('\n') : 'None referred'}
          />
        ) : null}
        {r.permits.length ? (
          <Row wrap gap={6}>
            {r.permits.map((x) => (
              <Button key={x.id} small variant="ghost" title={`Open ${x.code}`} onPress={() => router.push(`/execution/hse/form/${x.id}`)} />
            ))}
          </Row>
        ) : null}
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
          {r.exec_projects && me.role !== 'sub_supervisor' ? (
            <Button variant="secondary" title="PDF report" onPress={() => dialog.run(() => printDailyReport(r, r.exec_projects!, people, `${me.full_name} – ${ROLE_LABELS[me.role]}`))} />
          ) : null}
          {r.status === 'returned' && r.author_id === me.id ? (
            <Button title="Correct and resubmit" onPress={() => router.push({ pathname: '/execution/report/new', params: { project: r.exec_project_id, date: r.report_date } })} />
          ) : null}
        </Row>
      </Card>
      <Attachments entityType="exec_report" entityId={r.id} kinds={['daily_photo', 'item_photo', 'daily_doc']} title="Photos and documents" allowCamera canUpload={r.author_id === me.id && r.status !== 'verified'} />
    </Screen>
  );
}
