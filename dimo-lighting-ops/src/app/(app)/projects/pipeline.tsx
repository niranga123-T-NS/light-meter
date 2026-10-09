import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { BarChart, CHART, LineChart } from '@/components/charts';
import { DataTable } from '@/components/DataTable';
import { Button, Card, colors, ErrorBanner, Grid, Loading, Muted, Notice, Pill, Row, Screen, Section, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { MILESTONES } from '@/lib/constants';
import { fmtDate } from '@/lib/format';
import { fmtMonth, fyLabel, fyMonths, fyOf, LINES, lineShort, mn, thisMonth } from '@/lib/finance';
import { useLoad, usePeople } from '@/lib/hooks';
import { exportPipelineReport } from '@/lib/pipelineReportPdf';
import { useDialog } from '@/components/dialog';
import { PROJECT_TYPES, projectTypeLabel, ROLE_LABELS } from '@/lib/roles';
import { rpc } from '@/lib/supabase';

type P = {
  id: string;
  code: string;
  name: string;
  customer: string;
  owner_id: string;
  project_type: string;
  term: 'short' | 'medium' | 'long';
  duty_status: 'duty_paid' | 'duty_free' | null;
  milestone: string;
  win_probability: number;
  status: string;
  use_wizard: boolean;
  line: string | null;
  value_lkr: number;
  weighted_lkr: number;
  expected_award_date: string | null;
  month_from: 'award' | 'tender' | 'duration';
  expected_month: string;
  award_passed: boolean;
  no_value: boolean;
  no_award_date: boolean;
  days_since_visit: number | null;
  prob_review_days: number;
  stage_days: number;
  wizard_pct: number | null;
};
type S = { id: string; name: string; customer: string | null; owner_id: string; line: string | null; value_lkr: number; month: string; project_type: string | null; term: string | null; duty_status: string | null };
type Data = { fy: number; today: string; projects: P[]; on_hold: { n: number; value_lkr: number }; secured: S[]; targets: { owner_id: string; month: string; target: number }[] };

const BANDS = [
  { value: 'likely', label: 'Likely (70% +)', lo: 70, hi: 100, color: CHART.third },
  { value: 'possible', label: 'Possible (40–69%)', lo: 40, hi: 69, color: CHART.second },
  { value: 'early', label: 'Early (under 40%)', lo: 0, hi: 39, color: CHART.budgetFill },
];
const bandOf = (p: number) => BANDS.find((b) => p >= b.lo && p <= b.hi)?.value ?? 'early';
const TERMS = [
  { value: 'short', label: 'Short term (up to 6 months)' },
  { value: 'medium', label: 'Medium term (7–18 months)' },
  { value: 'long', label: 'Long term (over 18 months)' },
];
const FLAGS: { key: string; label: string; test: (p: P) => boolean }[] = [
  { key: 'award_passed', label: 'Award date passed', test: (p) => p.award_passed },
  { key: 'no_visit', label: 'No visit for 30 days', test: (p) => p.days_since_visit == null || p.days_since_visit > 30 },
  { key: 'old_prob', label: 'Probability not reviewed for 60 days', test: (p) => p.prob_review_days > 60 },
  { key: 'stuck', label: 'Same stage for 90+ days', test: (p) => p.stage_days > 90 },
  { key: 'no_value', label: 'No lighting value', test: (p) => p.no_value },
  { key: 'no_award', label: 'No award date (from Brand specified)', test: (p) => p.no_award_date },
  { key: 'dormant', label: 'Dormant', test: (p) => p.status === 'dormant' },
];
const ALL = 'all';

/** Pipeline forecast: when orders are expected, weighted, against the secured-order target – every figure follows the filters */
export default function Pipeline() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const manager = me.role === 'gm' || me.role === 'sm_projects';
  const curFy = fyOf(thisMonth());
  const [fy, setFy] = useState(curFy);
  const [f, setF] = useState({ person: ALL, line: ALL, type: ALL, term: ALL, duty: ALL, stage: ALL, band: ALL, flag: ALL });
  const setFilter = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const { data, error } = useLoad(() => rpc<Data>('pipeline_forecast', { p_fy: fy }), [fy]);

  const view = useMemo(() => {
    if (!data) return null;
    const months = fyMonths(fy);
    const fyEndMonth = months[11];
    const match = (o: { owner_id: string; line: string | null; project_type?: string | null; term?: string | null; duty_status?: string | null }) =>
      (f.person === ALL || o.owner_id === f.person) &&
      (f.line === ALL || (f.line === 'none' ? !o.line : o.line === f.line)) &&
      (f.type === ALL || o.project_type === f.type) &&
      (f.term === ALL || o.term === f.term) &&
      (f.duty === ALL || o.duty_status === f.duty);
    const flagOf = (p: P) => FLAGS.filter((x) => x.test(p)).map((x) => x.key);
    const projects = data.projects.filter(
      (p) => match(p) && (f.stage === ALL || p.milestone === f.stage) && (f.band === ALL || bandOf(p.win_probability) === f.band) && (f.flag === ALL || flagOf(p).includes(f.flag)),
    );
    const inYear = projects.filter((p) => p.expected_month <= fyEndMonth && p.expected_month >= months[0]);
    const later = projects.filter((p) => p.expected_month > fyEndMonth);
    const secured = data.secured.filter((s) => match(s));
    // Targets are set per person and month only – shown when the other filters are not narrowing the projects
    const targetApplies = f.line === ALL && f.type === ALL && f.term === ALL && f.duty === ALL;
    const targets = data.targets.filter((t) => f.person === ALL || t.owner_id === f.person);
    const sum = <T,>(xs: T[], g: (x: T) => number) => xs.reduce((a, x) => a + Number(g(x) || 0), 0);
    const securedTotal = sum(secured, (s) => s.value_lkr);
    const weighted = sum(inYear, (p) => p.weighted_lkr);
    const unweighted = sum(inYear, (p) => p.value_lkr);
    const target = targetApplies ? sum(targets, (t) => t.target) : null;
    const expected = securedTotal + weighted;
    const stillNeeded = target == null ? null : Math.max(0, target - securedTotal);
    const byMonth = (m: string) => ({
      secured: sum(secured.filter((s) => s.month === m), (s) => s.value_lkr),
      ...Object.fromEntries(BANDS.map((b) => [b.value, sum(inYear.filter((p) => p.expected_month === m && bandOf(p.win_probability) === b.value), (p) => p.weighted_lkr)])),
      target: sum(targets.filter((t) => t.month === m), (t) => t.target),
    }) as Record<string, number>;
    const monthly = months.map(byMonth);
    let cumA = 0;
    let cumT = 0;
    const cum = monthly.map((x) => {
      cumA += x.secured + BANDS.reduce((a, b) => a + x[b.value], 0);
      cumT += x.target;
      return { a: cumA, t: cumT };
    });
    const funnel = MILESTONES.filter((m) => m.value !== 'won' && m.value !== 'lost').map((m) => {
      const ps = projects.filter((p) => p.milestone === m.value);
      return { label: m.label, n: ps.length, value: sum(ps, (p) => p.value_lkr), weighted: sum(ps, (p) => p.weighted_lkr) };
    });
    const flagCounts = FLAGS.map((x) => ({ ...x, n: data.projects.filter((p) => match(p) && x.test(p)).length }));
    return {
      months,
      projects,
      inYear,
      later,
      secured,
      securedTotal,
      weighted,
      unweighted,
      target,
      expected,
      stillNeeded,
      monthly,
      cum,
      funnel,
      flagCounts,
      flagOf,
      targetApplies,
      passedThisYear: months.filter((m) => m < thisMonth()).length,
    };
  }, [data, f, fy]);

  if (!data || !view) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const salesPeople = [...new Set([...data.projects.map((p) => p.owner_id), ...data.secured.map((s) => s.owner_id), ...data.targets.map((t) => t.owner_id)])].filter(Boolean);
  const v = view;
  const pctOf = (a: number, b: number | null) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const coverage = v.stillNeeded ? v.weighted / v.stillNeeded : null;
  const filtered = Object.values(f).some((x) => x !== ALL);
  const opt = (all: string, list: { value: string; label: string }[]) => [{ value: ALL, label: all }, ...list];
  // The filters in words, for the report header
  const filterText = [
    f.person !== ALL ? people[f.person]?.full_name ?? 'One sales person' : manager ? 'Whole team' : me.full_name,
    f.line !== ALL ? (f.line === 'none' ? 'Building – line not set' : LINES.find((l) => l.value === f.line)?.label) : null,
    f.type !== ALL ? projectTypeLabel(f.type) : null,
    f.term !== ALL ? TERMS.find((x) => x.value === f.term)?.label : null,
    f.duty !== ALL ? (f.duty === 'duty_paid' ? 'Duty paid' : 'Duty free') : null,
    f.stage !== ALL ? MILESTONES.find((m) => m.value === f.stage)?.label : null,
    f.band !== ALL ? BANDS.find((b) => b.value === f.band)?.label : null,
    f.flag !== ALL ? FLAGS.find((x) => x.key === f.flag)?.label : null,
  ].filter(Boolean).join(' · ');
  const report = () =>
    dialog.run(() =>
      exportPipelineReport({
        fy,
        today: fmtDate(data.today),
        filters: filterText,
        generatedBy: `${me.full_name} – ${ROLE_LABELS[me.role]}`,
        bands: BANDS,
        bandOf,
        flagOf: v.flagOf,
        flags: v.flagCounts.map((x) => ({ key: x.key, label: x.label, n: x.n })),
        months: v.months,
        monthly: v.monthly,
        cum: v.cum,
        projects: v.projects,
        inYear: v.inYear,
        later: v.later,
        secured: v.secured,
        targets: data.targets.filter((t) => f.person === ALL || t.owner_id === f.person),
        targetApplies: v.targetApplies,
        totals: { secured: v.securedTotal, weighted: v.weighted, unweighted: v.unweighted, expected: v.expected, target: v.target, stillNeeded: v.stillNeeded },
        onHold: data.on_hold,
        name: (id) => people[id]?.full_name ?? '—',
        byPerson: manager && f.person === ALL,
      }),
    );

  return (
    <Screen maxWidth={1300}>
      <Stack.Screen options={{ title: 'Pipeline forecast' }} />
      <Card style={{ gap: 4 }}>
        <Grid min={200}>
          <Select label="Financial year" value={String(fy)} onChange={(x) => setFy(Number(x))} options={[curFy - 1, curFy, curFy + 1].map((y) => ({ value: String(y), label: fyLabel(y) }))} />
          {manager ? (
            <Select
              label="Sales person"
              value={f.person}
              onChange={(x) => setFilter('person', x)}
              options={opt('Whole team', salesPeople.map((id) => ({ value: id, label: people[id]?.full_name ?? '—' })).sort((a, b) => a.label.localeCompare(b.label)))}
            />
          ) : null}
          <Select label="Business line" value={f.line} onChange={(x) => setFilter('line', x)} options={opt('All lines', [...LINES.map((l) => ({ value: l.value, label: l.label })), { value: 'none', label: 'Building – line not set' }])} />
          <Select label="Category (project type)" value={f.type} onChange={(x) => setFilter('type', x)} options={opt('All categories', PROJECT_TYPES.map((t) => ({ value: t.value, label: t.label })))} />
          <Select label="Term" value={f.term} onChange={(x) => setFilter('term', x)} options={opt('All terms', TERMS)} />
          <Select
            label="Duty"
            value={f.duty}
            onChange={(x) => setFilter('duty', x)}
            options={opt('Duty paid and free', [
              { value: 'duty_paid', label: 'Duty paid (LKR)' },
              { value: 'duty_free', label: 'Duty free (USD)' },
            ])}
          />
          <Select label="Stage" value={f.stage} onChange={(x) => setFilter('stage', x)} options={opt('All stages', MILESTONES.filter((m) => m.value !== 'won' && m.value !== 'lost').map((m) => ({ value: m.value, label: m.label })))} />
          <Select label="Chance" value={f.band} onChange={(x) => setFilter('band', x)} options={opt('All', BANDS.map((b) => ({ value: b.value, label: b.label })))} />
          <Select label="Needs attention" value={f.flag} onChange={(x) => setFilter('flag', x)} options={opt('All projects', FLAGS.map((x) => ({ value: x.key, label: x.label })))} />
        </Grid>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Muted>
            LKR Mn · weighted = lighting value × win probability · USD at the monthly rate · stage, chance and attention filters apply to open projects (not to secured orders)
          </Muted>
          <Row gap={6}>
            {filtered ? <Button small variant="ghost" title="Clear filters" onPress={() => setF({ person: ALL, line: ALL, type: ALL, term: ALL, duty: ALL, stage: ALL, band: ALL, flag: ALL })} /> : null}
            <Button small title="Management report (PDF)" onPress={report} />
          </Row>
        </Row>
      </Card>

      <Grid min={190}>
        <Stat label={`Secured · ${fyLabel(fy)}`} value={mn(v.securedTotal)} />
        <Stat label={`Weighted pipeline · ${v.inYear.length} project${v.inYear.length === 1 ? '' : 's'} to Mar`} value={mn(v.weighted)} />
        <Stat label="Expected year-end (secured + weighted)" value={mn(v.expected)} tone={v.target ? (v.expected >= v.target ? 'green' : v.expected >= v.target * 0.8 ? 'amber' : 'red') : undefined} />
        <Stat label={v.targetApplies ? 'Secured-order target' : 'Target – not split by these filters'} value={v.target == null ? '—' : mn(v.target)} />
        <Stat label="Expected vs target" value={pctOf(v.expected, v.target)} tone={v.target ? (v.expected >= v.target ? 'green' : 'red') : undefined} />
        <Stat label="Gap still to find" value={v.target == null ? '—' : mn(Math.max(0, v.target - v.expected))} tone={v.target != null && v.target - v.expected > 0 ? 'red' : 'green'} />
        <Stat
          label="Coverage (weighted ÷ still to secure)"
          value={coverage == null ? '—' : `${coverage.toFixed(1)}×`}
          tone={coverage == null ? undefined : coverage >= 1.5 ? 'green' : coverage >= 1 ? 'amber' : 'red'}
        />
        <Stat label="Unweighted pipeline to Mar" value={mn(v.unweighted)} />
        <Stat label={`Beyond ${fyLabel(fy)} · ${v.later.length} project${v.later.length === 1 ? '' : 's'} (weighted)`} value={mn(v.later.reduce((a, p) => a + p.weighted_lkr, 0))} />
        <Stat label={`On hold · ${data.on_hold.n} projects (not counted)`} value={mn(data.on_hold.value_lkr)} />
      </Grid>

      <Section title={`Orders by month · ${fyLabel(fy)}`}>
        <Card>
          <BarChart
            stacked
            categories={v.months.map((m) => fmtMonth(m).slice(0, 3))}
            series={[
              { name: 'Secured', color: CHART.actual, values: v.monthly.map((x) => x.secured) },
              ...BANDS.map((b) => ({ name: b.label, color: b.color, values: v.monthly.map((x) => x[b.value]) })),
              ...(v.targetApplies ? [{ name: 'Target', color: colors.ink, values: v.monthly.map((x) => x.target || null), marker: true }] : []),
            ]}
            fmt={(n) => `${mn(n)} Mn`}
            fmtAxis={(n) => mn(n, 0)}
            note="Secured = orders won (actual). Pipeline is weighted and placed in its expected award month; a passed award date counts in this month until it is updated."
          />
        </Card>
        <Card style={{ marginTop: 8 }}>
          <LineChart
            categories={v.months.map((m) => fmtMonth(m).slice(0, 3))}
            series={[
              { name: 'Secured + weighted, cumulative', color: CHART.actual, values: v.cum.map((x) => x.a) },
              ...(v.targetApplies ? [{ name: 'Target, cumulative', color: CHART.budget, values: v.cum.map((x) => x.t), dashed: true }] : []),
            ]}
            fmt={(n) => `${mn(n)} Mn`}
            fmtAxis={(n) => mn(n, 0)}
          />
        </Card>
      </Section>

      <Section title="By stage (open projects, all months)">
        <Card style={{ gap: 6 }}>
          {v.funnel.map((s) => {
            const max = Math.max(1, ...v.funnel.map((x) => x.value));
            return (
              <View key={s.label} style={{ gap: 2 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.ink, fontWeight: '600' }}>{`${s.label} · ${s.n}`}</Text>
                  <Text style={{ color: colors.text }}>{`${mn(s.value)} Mn · weighted ${mn(s.weighted)} Mn`}</Text>
                </Row>
                <View style={{ height: 10, backgroundColor: colors.soft, borderRadius: 5, overflow: 'hidden' }}>
                  <View style={{ width: `${(s.value / max) * 100}%`, height: 10, backgroundColor: CHART.actual, opacity: 0.35 }} />
                  <View style={{ position: 'absolute', width: `${(s.weighted / max) * 100}%`, height: 10, backgroundColor: CHART.actual }} />
                </View>
              </View>
            );
          })}
        </Card>
      </Section>

      <Section title="Needs attention">
        <Card style={{ gap: 6 }}>
          <Row wrap gap={6}>
            {v.flagCounts.map((x) => (
              <Button key={x.key} small variant={f.flag === x.key ? 'primary' : 'secondary'} title={`${x.label} · ${x.n}`} onPress={() => setFilter('flag', f.flag === x.key ? ALL : x.key)} />
            ))}
          </Row>
          <Muted>Tap to list those projects. A forecast is only as good as its dates, values and recent contact.</Muted>
        </Card>
      </Section>

      <Section title={`Projects · ${v.projects.length}`}>
        <DataTable
          rows={v.projects}
          keyOf={(p) => p.id}
          onPress={(p) => router.push(`/projects/${p.id}`)}
          emptyTitle="No open projects for these filters"
          footer={['Total', '', '', '', '', '', mn(v.projects.reduce((a, p) => a + p.value_lkr, 0)), mn(v.projects.reduce((a, p) => a + p.weighted_lkr, 0)), '', '']}
          columns={[
            { h: 'Project', w: 260, v: (p) => `${p.code} ${p.name}`, bold: true },
            { h: 'Customer', w: 180, v: (p) => p.customer },
            ...(manager ? [{ h: 'Sales person', w: 140, v: (p: P) => people[p.owner_id]?.full_name ?? '—' }] : []),
            { h: 'Category · line · term', w: 210, v: (p) => `${projectTypeLabel(p.project_type)} · ${p.line ? lineShort(p.line) : '—'} · ${p.term}` },
            { h: 'Stage', w: 170, v: (p) => MILESTONES.find((m) => m.value === p.milestone)?.label ?? p.milestone },
            { h: 'Win %', w: 90, right: true, v: (p) => `${p.win_probability}%${p.wizard_pct != null ? ' ✓' : ''}` },
            { h: 'Value (Mn)', w: 100, right: true, v: (p) => mn(p.value_lkr) },
            { h: 'Weighted (Mn)', w: 110, right: true, v: (p) => mn(p.weighted_lkr), bold: true },
            {
              h: 'Expected order',
              w: 140,
              v: (p) => `${fmtMonth(p.expected_month)}${p.month_from === 'award' ? '' : p.month_from === 'tender' ? ' (tender + 1 m)' : ' (from duration)'}`,
              tone: (p) => (p.award_passed ? colors.red : undefined),
            },
            {
              h: 'Needs attention',
              w: 300,
              v: (p) => {
                const fl = v.flagOf(p);
                return fl.length ? (
                  <Row wrap gap={4}>
                    {fl.map((k) => (
                      <Pill key={k} label={FLAGS.find((x) => x.key === k)?.label ?? k} tone={k === 'award_passed' ? colors.red : colors.amber} />
                    ))}
                  </Row>
                ) : (
                  '—'
                );
              },
            },
          ]}
        />
        <Muted>{`✓ = scored with the Win Probability Wizard · figures as of ${fmtDate(data.today)}`}</Muted>
      </Section>
      {!data.projects.length && !data.secured.length ? <Notice>No projects in your pipeline yet.</Notice> : null}
    </Screen>
  );
}
