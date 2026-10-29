import { Stack } from 'expo-router';
import { useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, colors, ErrorBanner, Grid, Loading, Muted, Notice, Row, Screen, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { exportExcel, exportPdf, type Column } from '@/lib/export';
import { fyLabel, fyOf } from '@/lib/finance';
import { todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { MEETING_ACTION_REPORT_ROLES } from '@/lib/meetingActions';
import { ROLE_SHORT } from '@/lib/roles';
import { rpc } from '@/lib/supabase';

type Person = { id: string; name: string; total: number; done: number; not_done: number; not_done_open: number; delayed: number; blocked: number; overdue: number; moved: number; top_reason: string | null };
type Period = '30' | '90' | 'fy';

function fromDate(p: Period) {
  const t = todayISO();
  if (p === 'fy') return `${fyOf(t)}-04-01`;
  const d = new Date();
  d.setDate(d.getDate() - Number(p));
  return d.toISOString().slice(0, 10);
}

/** Reports › Meeting actions – per person: done, not done (and why), delayed, blocked, overdue */
export default function MeetingActionsReport() {
  const me = useMe();
  const dialog = useDialog();
  const [period, setPeriod] = useState<Period>('90');
  const allowed = MEETING_ACTION_REPORT_ROLES.includes(me.role);
  const from = fromDate(period);
  const { data, error, loading, reload } = useLoad(() => (allowed ? rpc<Person[]>('meeting_actions_report', { p_from: from, p_to: todayISO() }) : Promise.resolve(null)), [from, allowed]);
  if (!allowed) return <Screen><Notice tone={colors.amber}>Meeting action reports are for the DGM, SM Projects and the meeting hosts.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;

  const sum = (k: keyof Person) => data.reduce((t, p) => t + (p[k] as number), 0);
  const periodText = period === 'fy' ? fyLabel(fyOf(todayISO())) : `Meetings in the last ${period} days`;
  const cols: Column<Person>[] = [
    { header: 'Person', value: (p) => p.name },
    { header: 'Actions', value: (p) => p.total, align: 'right' },
    { header: 'Done', value: (p) => p.done, align: 'right' },
    { header: 'Not done', value: (p) => p.not_done, align: 'right' },
    { header: 'Delayed', value: (p) => p.delayed, align: 'right' },
    { header: 'Blocked', value: (p) => p.blocked, align: 'right' },
    { header: 'Overdue', value: (p) => p.overdue, align: 'right' },
    { header: 'Dates moved', value: (p) => p.moved, align: 'right' },
    { header: 'Top not-done reason', value: (p) => p.top_reason ?? '' },
  ];
  const exportIt = (kind: 'pdf' | 'excel') =>
    dialog.run(async () => {
      const meta = { key: 'meeting_actions', title: 'Meeting actions by person', filters: periodText, generatedBy: `${me.full_name} – ${ROLE_SHORT[me.role]}`, landscape: true };
      if (kind === 'excel') await exportExcel(meta, cols, [{ heading: 'By person', rows: data }]);
      else await exportPdf(meta, cols, [{ heading: 'By person', rows: data }]);
    });

  return (
    <Screen maxWidth={1200} refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Meeting actions' }} />
      <Muted>Actions given in published meetings, by the person doing them. Delayed and blocked are open actions whose latest update says so; overdue are open actions past their due date.</Muted>
      <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
        <Segmented<Period> value={period} onChange={setPeriod} options={[{ value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: 'fy', label: 'This FY' }]} />
        <Button small variant="secondary" title="PDF" onPress={() => exportIt('pdf')} />
        <Button small variant="secondary" title="Excel" onPress={() => exportIt('excel')} />
      </Row>
      <Grid min={150} max={6}>
        <Stat label="Actions" value={sum('total')} />
        <Stat label="Done" value={sum('done')} tone="green" />
        <Stat label="Not done" value={sum('not_done')} sub={sum('not_done_open') ? `${sum('not_done_open')} to review` : undefined} tone={sum('not_done_open') ? 'amber' : undefined} />
        <Stat label="Delayed" value={sum('delayed')} tone={sum('delayed') ? 'amber' : undefined} />
        <Stat label="Blocked" value={sum('blocked')} tone={sum('blocked') ? 'red' : undefined} />
        <Stat label="Overdue" value={sum('overdue')} tone={sum('overdue') ? 'red' : 'green'} />
      </Grid>
      <Section title="By person">
        <DataTable
          rows={data}
          keyOf={(p) => p.id}
          edge={(p) => (p.overdue || p.blocked ? colors.red : p.delayed || p.not_done_open ? colors.amber : colors.green)}
          emptyTitle="No meeting actions in this period"
          columns={[
            { h: 'Person', w: 180, bold: true, v: (p) => p.name },
            { h: 'Actions', w: 70, right: true, v: (p) => p.total },
            { h: 'Done', w: 70, right: true, tone: () => colors.green, v: (p) => p.done },
            { h: 'Not done', w: 80, right: true, v: (p) => (p.not_done_open ? `${p.not_done} (${p.not_done_open} to review)` : p.not_done) },
            { h: 'Delayed', w: 70, right: true, tone: (p) => (p.delayed ? colors.amber : undefined), v: (p) => p.delayed },
            { h: 'Blocked', w: 70, right: true, tone: (p) => (p.blocked ? colors.red : undefined), v: (p) => p.blocked },
            { h: 'Overdue', w: 70, right: true, tone: (p) => (p.overdue ? colors.red : undefined), v: (p) => p.overdue },
            { h: 'Dates moved', w: 80, right: true, v: (p) => p.moved },
            { h: 'Top not-done reason', w: 220, grow: true, v: (p) => p.top_reason ?? '—' },
          ]}
        />
      </Section>
    </Screen>
  );
}
