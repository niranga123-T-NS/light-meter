import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { DataTable, type Column } from '@/components/DataTable';
import { ProgressFlags, TimeBar } from '@/components/TimeBar';
import { TestingBanner } from '@/components/Testing';
import { thisWeek, type PipelineRow } from '@/lib/deadlines';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';
import { colors, Grid, Muted, Pill, Progress, Section, Stat } from '../ui';

const designDone = (r: PipelineRow) => ['design_review', 'design_approved'].includes(r.inquiry_status);

function status(r: PipelineRow): { label: string; tone: string } {
  if (r.late) return { label: 'Design late', tone: colors.red };
  if (r.extension_status === 'requested') return { label: 'Extension asked', tone: colors.amber };
  if (r.design_due_status !== 'approved') return { label: r.design_due_status === 'pending' ? 'Dates with SM Projects' : 'Dates to set', tone: colors.grey };
  if (r.inquiry_status === 'design_approved') return { label: 'Design approved – to release', tone: colors.green };
  if (r.inquiry_status === 'design_review') return { label: 'Design in review', tone: colors.blue };
  return { label: 'On track', tone: colors.green };
}

const Type = ({ r }: { r: PipelineRow }) =>
  r.deadline_type === 'tender' ? <Pill label="Tender" tone={colors.brand} solid /> : <Pill label="Client" tone={colors.grey} />;

const InquiryCell = ({ r }: { r: PipelineRow }) => (
  <View style={{ alignSelf: 'stretch' }}>
    <Text style={{ fontWeight: '600', color: colors.ink }} numberOfLines={1}>{r.code}</Text>
    <Muted numberOfLines={2}>{r.title}</Muted>
  </View>
);

const ProgressCell = ({ r }: { r: PipelineRow }) => (
  <View style={{ gap: 2, width: 84 }}>
    <Text style={{ fontSize: 12, color: colors.muted }}>{`${r.design_progress}%`}</Text>
    <Progress pct={r.design_progress} colour={colors.blue} />
    {r.inquiry_status === 'in_design' && r.designers ? <ProgressFlags compact updatedAt={r.design_updated_at} progress={r.design_progress} timePct={r.design_time_pct} /> : null}
  </View>
);

// The estimate alongside: its own % and time bar once an estimator has it
const EstimateCell = ({ r }: { r: PipelineRow }) => {
  if (!r.estimation_job_id) return <Muted>—</Muted>;
  if (r.estimation_status === 'queued') return <Muted>To accept</Muted>;
  if (r.estimation_status === 'accepted' || !r.estimator) return <Muted>To assign</Muted>;
  const pct = r.estimation_progress ?? 0;
  return (
    <View style={{ gap: 3, width: 130 }}>
      <Text style={{ fontSize: 12, color: colors.muted }}>{`${pct}% · ${r.estimation_phase === 'pre' ? 'pre-estimate' : 'final pricing'}`}</Text>
      <Progress pct={pct} colour={colors.blue} />
      <TimeBar pct={r.estimation_time_pct} paused={r.estimation_paused} width={130} />
      <ProgressFlags compact updatedAt={r.estimation_updated_at} progress={pct} timePct={r.estimation_time_pct} />
    </View>
  );
};

const deadlineCell = (r: PipelineRow) => (r.deadline_type === 'tender' ? fmtDateTime(r.deadline_at) : fmtDate(r.deadline_at));

/**
 * Route A inquiries still in design, with the estimate that runs alongside.
 * SM Estimation sees what is coming and how much time is left for final pricing; the Design Manager sees the mirror –
 * which estimates are waiting on each design.
 */
export function DesignPipeline({ view, reloadKey }: { view: 'estimation' | 'design'; reloadKey?: unknown }) {
  const { data, error } = useLoad(() => rpc<PipelineRow[]>('design_pipeline'), [reloadKey]);
  if (error) return null;
  const rows = data ?? [];
  const coming = rows.filter((r) => !designDone(r) && thisWeek(r.design_due_at)).length;
  const tenders = rows.filter((r) => r.deadline_type === 'tender' && thisWeek(r.deadline_at)).length;
  const late = rows.filter((r) => r.late).length;
  const waiting = rows.filter((r) => r.estimation_job_id).length;

  const common: Column<PipelineRow>[] = [
    { h: 'Inquiry', w: 220, v: (r) => <InquiryCell r={r} /> },
    { h: 'Type', w: 72, v: (r) => <Type r={r} /> },
    { h: 'Designer', w: 130, v: (r) => r.designers ?? '—' },
    { h: 'Design due', w: 105, v: (r) => fmtDate(r.design_due_at), tone: (r) => (r.late ? colors.red : undefined), bold: true },
    { h: 'Design progress', w: 130, v: (r) => <ProgressCell r={r} /> },
    {
      h: 'Design time used',
      w: 120,
      v: (r) => (r.inquiry_status === 'in_design' && r.design_time_pct != null ? <TimeBar pct={r.design_time_pct} paused={r.design_paused} width={104} /> : '—'),
    },
  ];
  const tail: Column<PipelineRow>[] = [
    { h: 'Deadline / closing', w: 130, v: deadlineCell, tone: (r) => (r.deadline_type === 'tender' ? colors.brand : undefined) },
    {
      h: 'Days for estimation',
      w: 120,
      right: true,
      v: (r) => (r.estimation_days == null ? '—' : `${r.estimation_days} wd`),
      tone: (r) => (r.estimation_days != null && r.estimation_days < 1 ? colors.red : undefined),
    },
    { h: 'Status', w: 170, v: (r) => <Pill label={status(r).label} tone={status(r).tone} /> },
  ];
  const estimate: Column<PipelineRow>[] = [
    { h: 'Estimator', w: 150, v: (r) => r.estimator ?? (r.estimation_job_id ? 'To assign' : 'Opens when dates are approved') },
    { h: 'Estimate', w: 150, v: (r) => <EstimateCell r={r} /> },
    { h: 'Final pricing by', w: 120, v: (r) => fmtDate(r.estimation_due_at) },
  ];
  // The Design Manager sees the final pricing date instead of the days count
  const columns = view === 'estimation' ? [...common, estimate[1], ...tail] : [...common, ...estimate, tail[0], tail[2]];

  return (
    <Section title={view === 'estimation' ? 'Design in progress' : 'Estimates waiting on your designs'}>
      <TestingBanner what={view === 'estimation' ? 'Design in progress' : 'Estimates waiting on designs'} />
      <Grid min={170} max={4}>
        <Stat label="Designs due this week" value={coming} />
        <Stat label="Tenders closing this week" value={tenders} tone={tenders ? 'amber' : undefined} />
        <Stat label="Late designs" value={late} tone={late ? 'red' : undefined} />
        <Stat label={view === 'estimation' ? 'Pre-estimates running' : 'Estimates waiting'} value={waiting} />
      </Grid>
      <View style={{ marginTop: 8 }}>
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(r) => r.inquiry_id}
          edge={(r) => (r.late ? colors.red : r.deadline_type === 'tender' ? colors.brand : undefined)}
          onPress={(r) => (view === 'design' || r.estimation_job_id ? router.push(`/inquiries/${r.inquiry_id}`) : undefined)}
          emptyTitle="No design + estimation inquiries in design"
        />
      </View>
      <Muted style={{ marginTop: 4 }}>
        {view === 'estimation'
          ? 'Estimation starts with the design: price everything that does not depend on it now, and add the designed fixtures when the design is released. Tenders are marked red and their closing dates are fixed.'
          : 'Each estimate is priced alongside your design and waits for its release. A design past its date alerts you, SM Estimation and SM Projects.'}
      </Muted>
    </Section>
  );
}
