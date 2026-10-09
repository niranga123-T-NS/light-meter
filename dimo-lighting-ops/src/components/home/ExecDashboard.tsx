import { router, Stack } from 'expo-router';
import { MyDayMeetings } from '@/components/WeekMeetings';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { TeamTargetCard } from '@/components/TargetCharts';
import { useMe } from '@/lib/auth';
import { companyInvoicing } from '@/lib/companyInvoicing';
import { fyLabel, fyOf, thisMonth, type Performance } from '@/lib/finance';
import { AGEING_COLOURS, AGEING_ORDER, fmtDate, fmtMoney, fmtNumber, fmtWorkDays, human, SLA_COLOURS, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { projectTypeLabel } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import { DesignHolds } from './DesignHolds';
import { StageTimes, type Journey, type StageTime } from './StageTimes';
import { Avatar, Button, Card, colors, DateField, ErrorBanner, Grid, H1, ListRow, Muted, Pill, Row, Screen, Section, Stat } from '../ui';

type Dash = {
  generated_at: string;
  delay_control: { team: string; colour: 'red' | 'amber' | 'grey'; n: number; max_days_overdue: number | null; max_level: number }[];
  deadlines_at_risk: { id: string; code: string; project_name: string; customer_name: string; customer_deadline: string; status: string; sla_colour: string; days_left: number; owner: string | null }[];
  delay_reasons: { team: string; reason: string; n: number }[];
  sla_performance: { team: string; closed: number; on_time_pct: number | null; avg_hours: number | null }[];
  sla_by_stage: StageTime[];
  journey?: Journey | null;
  work_hours_per_day?: number;
  sales_activity: { id: string; full_name: string; avatar_path: string | null; visits: number; unplanned: number; gps_pct: number | null; plans_on_time: number; inquiries: number; duplicate_alerts: number }[];
  pipeline: { project_type: string; active_projects: number; lighting_value_lkr: number | null; weighted_lkr: number | null; dormant_on_hold_lkr: number | null; active_usd: number | null; active_lkr: number | null }[];
  funnel: { received: number; in_design: number; in_estimation: number; quoted: number; won: number; lost: number; won_value_lkr: number | null; lost_reasons: Record<string, number> };
  workload: { id: string; full_name: string; role: string; avatar_path: string | null; open_jobs: number; overdue: number }[] | null;
  top_overdue: { id: string; label: string; inquiry_id: string | null; code: string | null; project_name: string | null; owner: string | null; owner_team: string | null; days_overdue: number; level: number; delay_reason: string | null }[];
  largest_open: { id: string; code: string; project_name: string; customer_name: string; status: string; lighting_value: number | null; currency: 'USD' | 'LKR' }[];
  oldest_on_hold: { inquiry_id: string; code: string; label: string; hold_reason: string; days: number }[];
  debtors: { by_bucket: { bucket: string; n: number; lkr: number; usd: number }[]; legal: number; non_moving: number; last_upload: string | null };
};

/** Horizontal magnitude bar – one hue, value labelled in text (never colour alone). */
function Bar({ label, value, max, display, tone = colors.blue }: { label: string; value: number; max: number; display: string; tone?: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text }}>{label}</Text>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{display}</Text>
      </Row>
      <View style={{ height: 8, backgroundColor: colors.line, borderRadius: 4, overflow: 'hidden', marginTop: 3 }}>
        <View style={{ height: 8, width: `${max ? Math.max(2, (value / max) * 100) : 0}%`, backgroundColor: tone, borderRadius: 4 }} />
      </View>
    </View>
  );
}

/** Overall Dashboard (GM / DGM) and Sales Management dashboard (SM Projects) – Section 9.1. */
export function ExecDashboard() {
  const me = useMe();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const { data, error, loading, reload } = useLoad(() => rpc<Dash>('overall_dashboard', { p_from: from, p_to: to }), [from, to]);
  // Total debtor outstanding, with legal debtors shown separately
  const debtTotals = useLoad(async () => {
    const { data: rows } = await supabase.from('debts').select('amount, currency, is_legal').not('status', 'in', '(collected_confirmed,cleared)').limit(5000);
    const list = (rows ?? []) as { amount: number; currency: 'LKR' | 'USD'; is_legal: boolean }[];
    const sum = (f: (d: (typeof list)[number]) => boolean, cur: 'LKR' | 'USD') => list.filter((d) => f(d) && d.currency === cur).reduce((a, d) => a + Number(d.amount), 0);
    return {
      n: list.length,
      nLegal: list.filter((d) => d.is_legal).length,
      all: { lkr: sum(() => true, 'LKR'), usd: sum(() => true, 'USD') },
      legal: { lkr: sum((d) => d.is_legal, 'LKR'), usd: sum((d) => d.is_legal, 'USD') },
      other: { lkr: sum((d) => !d.is_legal, 'LKR'), usd: sum((d) => !d.is_legal, 'USD') },
    };
  }, [data]);
  const gm = me.role === 'gm';
  // This year's sales targets: budget vs secured vs invoiced
  const fy = fyOf(new Date().toISOString().slice(0, 10));
  const perf = useLoad(() => rpc<Performance>('finance_performance', { p_fy: fy }).catch(() => null), [fy]);
  const company = useLoad(() => companyInvoicing(fy, thisMonth()).catch(() => null), [fy]);

  const red = data?.delay_control.filter((d) => d.colour === 'red').reduce((a, d) => a + d.n, 0) ?? 0;
  const amber = data?.delay_control.filter((d) => d.colour === 'amber').reduce((a, d) => a + d.n, 0) ?? 0;
  const hold = data?.delay_control.filter((d) => d.colour === 'grey').reduce((a, d) => a + d.n, 0) ?? 0;
  const pipeMax = Math.max(1, ...(data?.pipeline ?? []).map((p) => Number(p.lighting_value_lkr ?? 0)));
  const bucketMax = Math.max(1, ...(data?.debtors.by_bucket ?? []).map((b) => Number(b.lkr)));

  return (
    <Screen refreshing={loading} onRefresh={() => { reload(); perf.reload(); company.reload(); }} maxWidth={1400}>
      <Stack.Screen options={{ title: gm ? 'Overall Dashboard' : 'Sales Management' }} />
      <Row style={{ justifyContent: 'space-between' }} wrap>
        <H1>{gm ? 'Overall Dashboard' : 'Sales Management'}</H1>
        <Muted>Updated {data ? new Date(data.generated_at).toLocaleTimeString('en-GB') : '—'}</Muted>
      </Row>
      <MyDayMeetings />
      <Row wrap gap={8} style={{ marginTop: 8 }}>
        <View style={{ minWidth: 260, flex: 1 }}>
          <DateField label="From" value={from} onChange={setFrom} quick={[]} hint="Default: start of this month" />
        </View>
        <View style={{ minWidth: 260, flex: 1 }}>
          <DateField label="To" value={to} onChange={setTo} quick={[0]} />
        </View>
      </Row>
      <ErrorBanner message={error} />
      {perf.data ? (
        <Section
          title={`Sales targets · ${fyLabel(fy)}`}
          right={<Button small variant="ghost" title="Targets" onPress={() => router.push('/finance/targets')} />}
        >
          <TeamTargetCard people={perf.data.people} upTo={perf.data.latest_month} company={company.data} />
        </Section>
      ) : null}
      {data ? (
        <>
          <Section title="Delay control">
            <Grid min={170}>
              <Stat label="Overdue (red)" value={red} tone={red ? 'red' : undefined} onPress={() => router.push('/inquiries?tab=delayed')} />
              <Stat label="At risk (amber)" value={amber} tone={amber ? 'amber' : undefined} />
              <Stat label="On hold" value={hold} />
              <Stat label="Customer deadlines in 7 days" value={data.deadlines_at_risk.length} tone={data.deadlines_at_risk.length ? 'amber' : undefined} />
            </Grid>
            <Card style={{ marginTop: 8 }}>
              {data.delay_control.map((d, i) => (
                <Row key={i} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                  <Row gap={6}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: SLA_COLOURS[d.colour] }} />
                    <Text>
                      {human(d.team)} · {d.colour === 'red' ? 'overdue' : d.colour === 'amber' ? 'at risk' : 'on hold'}
                    </Text>
                  </Row>
                  <Text style={{ fontWeight: '600' }}>
                    {d.n}
                    {d.max_days_overdue ? ` · up to ${d.max_days_overdue} wd · L${Math.max(0, d.max_level - 2)}` : ''}
                  </Text>
                </Row>
              ))}
              {!data.delay_control.length ? <Muted>No delays – everything is on time.</Muted> : null}
            </Card>
          </Section>

          <Section title="Customer deadlines at risk (next 7 days)">
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {data.deadlines_at_risk.map((d) => (
                <ListRow
                  key={d.id}
                  title={`${d.code} · ${d.project_name}`}
                  subtitle={`${d.customer_name} · ${human(d.status)} · ${d.owner ?? '—'}`}
                  highlight={d.days_left <= 2 ? colors.red : colors.amber}
                  right={<Pill label={`${d.days_left}d · ${fmtDate(d.customer_deadline)}`} tone={d.days_left <= 2 ? colors.red : colors.amber} />}
                  onPress={() => router.push(`/inquiries/${d.id}`)}
                />
              ))}
              {!data.deadlines_at_risk.length ? <Muted style={{ padding: 12 }}>None</Muted> : null}
            </Card>
          </Section>

          <Section title="Pipeline and results" right={<Button small variant="secondary" title="Pipeline forecast" onPress={() => router.push('/projects/pipeline')} />}>
            <Grid min={320}>
              <Card>
                <Text style={{ fontWeight: '700', marginBottom: 8 }}>Active lighting value by project type (LKR equivalent)</Text>
                {data.pipeline.map((p) => (
                  <Bar
                    key={p.project_type}
                    label={`${projectTypeLabel(p.project_type)} (${p.active_projects})`}
                    value={Number(p.lighting_value_lkr ?? 0)}
                    max={pipeMax}
                    display={`${fmtMoney(p.lighting_value_lkr, 'LKR')} · weighted ${fmtMoney(p.weighted_lkr, 'LKR')}`}
                  />
                ))}
                <Muted>
                  Original currencies: {fmtMoney(data.pipeline.reduce((a, p) => a + Number(p.active_usd ?? 0), 0), 'USD')} +{' '}
                  {fmtMoney(data.pipeline.reduce((a, p) => a + Number(p.active_lkr ?? 0), 0), 'LKR')}. Dormant / on hold (excluded):{' '}
                  {fmtMoney(data.pipeline.reduce((a, p) => a + Number(p.dormant_on_hold_lkr ?? 0), 0), 'LKR')}
                </Muted>
              </Card>
              <Card>
                <Text style={{ fontWeight: '700', marginBottom: 8 }}>Inquiry funnel</Text>
                {(
                  [
                    ['Received', data.funnel.received],
                    ['In design', data.funnel.in_design],
                    ['In estimation', data.funnel.in_estimation],
                    ['Quoted', data.funnel.quoted],
                    ['Won', data.funnel.won],
                    ['Lost', data.funnel.lost],
                  ] as [string, number][]
                ).map(([l, v]) => (
                  <Bar key={l} label={l} value={v} max={Math.max(1, data.funnel.received, data.funnel.in_design, data.funnel.in_estimation)} display={String(v)} />
                ))}
                <Muted>
                  Won value {fmtMoney(data.funnel.won_value_lkr, 'LKR')} · Win rate{' '}
                  {data.funnel.won + data.funnel.lost ? `${Math.round((100 * data.funnel.won) / (data.funnel.won + data.funnel.lost))}%` : '—'}
                </Muted>
                <Muted>
                  Lost reasons:{' '}
                  {Object.entries(data.funnel.lost_reasons)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(' · ') || '—'}
                </Muted>
              </Card>
            </Grid>
          </Section>

          <Section title="SLA performance">
            <Grid min={200}>
              {data.sla_performance.map((s) => (
                <Stat
                  key={s.team}
                  label={`${human(s.team)} on-time · ${s.closed} closed · avg ${fmtWorkDays(s.avg_hours)}`}
                  value={s.on_time_pct == null ? '—' : `${s.on_time_pct}%`}
                  tone={s.on_time_pct == null ? undefined : s.on_time_pct >= 90 ? 'green' : s.on_time_pct >= 75 ? 'amber' : 'red'}
                />
              ))}
            </Grid>
            <StageTimes
              stages={data.sla_by_stage}
              journey={data.journey ?? null}
              hoursPerDay={Number(data.work_hours_per_day ?? 9)}
              from={from ?? `${todayISO().slice(0, 8)}01`}
              to={to ?? todayISO()}
            />
          </Section>

          <Section title="Sales activity">
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {data.sales_activity.map((s) => (
                <ListRow
                  key={s.id}
                  left={<Avatar name={s.full_name} path={s.avatar_path} />}
                  title={s.full_name}
                  subtitle={`${s.visits} visits · ${s.unplanned} unplanned · GPS ${s.gps_pct ?? '—'}% · ${s.plans_on_time} plans on time · ${s.inquiries} inquiries · ${s.duplicate_alerts} duplicate alerts`}
                  onPress={() => router.push(`/scorecard?user=${s.id}`)}
                />
              ))}
            </Card>
          </Section>

          {data.workload ? (
            <Section title="Workload – design and estimation">
              <Grid min={220}>
                {data.workload.map((w) => (
                  <Card key={w.id}>
                    <Row>
                      <Avatar name={w.full_name} path={w.avatar_path} ring={w.overdue ? 'red' : 'green'} />
                      <View>
                        <Text style={{ fontWeight: '600' }}>{w.full_name}</Text>
                        <Muted>
                          {w.open_jobs} open · {w.overdue} overdue
                        </Muted>
                      </View>
                    </Row>
                  </Card>
                ))}
              </Grid>
            </Section>
          ) : null}

          <Section title="Top 10 – longest overdue">
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {data.top_overdue.map((o) => (
                <ListRow
                  key={o.id}
                  title={`${o.code ?? ''} ${o.label}`}
                  subtitle={`${o.project_name ?? ''} · ${o.owner ?? '—'} (${human(o.owner_team)})${o.delay_reason ? ` · ${o.delay_reason}` : ''}`}
                  highlight={colors.red}
                  right={<Pill label={`${o.days_overdue} wd · L${Math.max(1, o.level - 2)}`} tone={colors.red} />}
                  onPress={() => o.inquiry_id && router.push(`/inquiries/${o.inquiry_id}`)}
                />
              ))}
              {!data.top_overdue.length ? <Muted style={{ padding: 12 }}>Nothing overdue</Muted> : null}
            </Card>
          </Section>

          <DesignHolds reloadKey={data} />

          <Grid min={320}>
            <Section title="Largest open inquiries">
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {data.largest_open.map((o) => (
                  <ListRow key={o.id} title={`${o.code} · ${o.project_name}`} subtitle={`${o.customer_name} · ${human(o.status)}`} right={<Text>{fmtMoney(o.lighting_value, o.currency)}</Text>} onPress={() => router.push(`/inquiries/${o.id}`)} />
                ))}
              </Card>
            </Section>
            <Section title="Oldest on hold">
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {data.oldest_on_hold.map((o, i) => (
                  <ListRow key={i} title={`${o.code} · ${o.label}`} subtitle={o.hold_reason} right={<Text>{o.days} days</Text>} onPress={() => router.push(`/inquiries/${o.inquiry_id}`)} />
                ))}
                {!data.oldest_on_hold.length ? <Muted style={{ padding: 12 }}>None</Muted> : null}
              </Card>
            </Section>
          </Grid>

          <Section title="Debtors" right={<Button small variant="secondary" title="Open debtors" onPress={() => router.push('/debtors')} />}>
            {debtTotals.data ? (
              <Grid min={220}>
                <Stat label={`Total debtor outstanding (${debtTotals.data.n} invoices)`} value={`${fmtMoney(debtTotals.data.all.lkr, 'LKR')}${debtTotals.data.all.usd ? ` + ${fmtMoney(debtTotals.data.all.usd, 'USD')}` : ''}`} onPress={() => router.push('/debtors')} />
                <Stat label="Excluding legal" value={`${fmtMoney(debtTotals.data.other.lkr, 'LKR')}${debtTotals.data.other.usd ? ` + ${fmtMoney(debtTotals.data.other.usd, 'USD')}` : ''}`} onPress={() => router.push('/debtors')} />
                <Stat label={`Legal debtors (${debtTotals.data.nLegal})`} value={`${fmtMoney(debtTotals.data.legal.lkr, 'LKR')}${debtTotals.data.legal.usd ? ` + ${fmtMoney(debtTotals.data.legal.usd, 'USD')}` : ''}`} tone={debtTotals.data.nLegal ? 'red' : undefined} onPress={() => router.push('/debtors?filter=legal')} />
              </Grid>
            ) : null}
            <Card style={{ marginTop: 8 }}>
              {AGEING_ORDER.map((b) => {
                const row = data.debtors.by_bucket.find((x) => x.bucket === b);
                const c = AGEING_COLOURS[b];
                return (
                  <Pressable key={b} onPress={() => router.push(`/debtors?bucket=${b}`)}>
                    <Row style={{ paddingVertical: 4 }}>
                      <View style={{ width: 80, paddingVertical: 2, borderRadius: 4, backgroundColor: c.bg, borderWidth: c.border ? 2 : 0, borderColor: c.border }}>
                        <Text style={{ color: c.fg, textAlign: 'center', fontSize: 12, fontWeight: '700' }}>{c.label}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Bar label={`${row?.n ?? 0} invoices`} value={Number(row?.lkr ?? 0)} max={bucketMax} display={`${fmtMoney(row?.lkr ?? 0, 'LKR')} · ${fmtMoney(row?.usd ?? 0, 'USD')}`} tone={colors.grey} />
                      </View>
                    </Row>
                  </Pressable>
                );
              })}
              <Muted>
                Legal cases {data.debtors.legal} · Non-moving {data.debtors.non_moving} · Last upload {fmtDate(data.debtors.last_upload)}
              </Muted>
            </Card>
          </Section>
          <Muted style={{ marginTop: 12 }}>
            Figures: {fmtNumber(data.sales_activity.reduce((a, s) => a + s.visits, 0))} visits in period. Every tile opens the records behind it; exports are in Reports.
          </Muted>
        </>
      ) : null}
    </Screen>
  );
}
