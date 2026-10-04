import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BarChart, CHART, DeviationBars, LineChart } from '@/components/charts';
import { DataTable } from '@/components/DataTable';
import { Button, Card, colors, Empty, ErrorBanner, Grid, Loading, Muted, Notice, Pill, Progress, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import {
  amt,
  findLine,
  fmtMonth,
  fmtMonthShort,
  fmtPct,
  fyLabel,
  isFinanceDesk,
  isIncomeLine,
  mn,
  pct,
  pnlGroups,
  seesPnl,
  type OrUpload,
  type PnlLine,
} from '@/lib/finance';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Col = { k: 'm_act' | 'm_bud' | 'c_act' | 'c_bud' | 'var' | 'ly_cum' | 'fy_bp'; h: string };
const TREND_LABELS = ['Total Turnover', 'Gross Proceeds from Sales', 'Gross Profit', 'Operating Profit 01', 'Net Profit'];

const COLS: Col[] = [
  { k: 'm_act', h: 'Month act' },
  { k: 'm_bud', h: 'Month bud' },
  { k: 'c_act', h: 'YTD act' },
  { k: 'c_bud', h: 'YTD bud' },
  { k: 'var', h: 'Var YTD' },
  { k: 'ly_cum', h: 'Last yr YTD' },
  { k: 'fy_bp', h: 'FY BP' },
];

// Business health indicators from the same file (balance items: YTD column = end of month)
const HEALTH: { label: string; title: string; first?: boolean; abs?: boolean; days?: boolean; count?: boolean; lowerBetter?: boolean }[] = [
  { label: 'LOCAL DEBTORS AT END', title: 'Local debtors at end', lowerBetter: true },
  { label: 'Collections', title: 'Collections (local) · YTD', first: true, abs: true },
  { label: 'Trade Debtors - Over 60 Days', title: 'Trade debtors over 60 days', lowerBetter: true },
  { label: 'Debtors Collection Period (Days)', title: 'Debtor collection days', days: true, lowerBetter: true },
  { label: 'STOCK AT END', title: 'Stock at end', lowerBetter: true },
  { label: 'Stocks - Over 180 Days', title: 'Stock over 180 days', lowerBetter: true },
  { label: 'Stock Residency Period (Days)', title: 'Stock days', days: true, lowerBetter: true },
  { label: 'WIP- CLOSING', title: 'WIP closing' },
  { label: 'FOREIGN /LOCAL CREDITORS AT END', title: 'Creditors at end' },
  { label: 'CAPITAL EMPLOYED', title: 'Capital employed', lowerBetter: true },
  { label: 'MANPOWER AT END', title: 'Manpower', count: true },
  { label: 'Turnover per Employee', title: 'Turnover per employee · YTD' },
  { label: 'Net Profit Per Employee', title: 'Net profit per employee · YTD' },
  { label: 'Break-Even Turnover', title: 'Break-even turnover · YTD', lowerBetter: true },
];

/** P&L from the monthly OR file – GM / DGM, SM Projects and SM Estimation. */
export default function PnlScreen() {
  const me = useMe();
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const { data, error } = useLoad(async () => {
    const { data: ups, error: e } = await supabase.from('or_uploads').select('*').order('month', { ascending: false });
    if (e) throw new Error(e.message);
    const uploads = (ups ?? []) as OrUpload[];
    const u = uploads.find((x) => x.id === uploadId) ?? uploads[0];
    if (!u) return { uploads, upload: null, lines: [] as PnlLine[], trend: [] as PnlLine[] };
    const fyUploads = uploads.filter((x) => x.fy === u.fy && x.month <= u.month).map((x) => x.id);
    const [l, t] = await Promise.all([
      supabase.from('pnl_lines').select('*').eq('upload_id', u.id).order('seq'),
      // Headline lines of every month loaded this year, for the trend charts
      supabase.from('pnl_lines').select('*').in('upload_id', fyUploads).eq('section', 'pnl').in('label', TREND_LABELS),
    ]);
    return {
      uploads,
      upload: u,
      lines: (l.data ?? []) as PnlLine[],
      trend: (t.data ?? []) as PnlLine[],
    };
  }, [uploadId]);

  if (!seesPnl(me.role)) {
    return (
      <Screen>
        <Notice>The P&L is for GM / DGM, SM Projects and SM Estimation.</Notice>
      </Screen>
    );
  }
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { upload, lines } = data;
  if (!upload) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'P&L' }} />
        <Empty
          title="No OR file loaded yet"
          hint="Operations uploads Finance’s OR Excel each month."
          action={isFinanceDesk(me.role) ? <Button title="Upload OR file" onPress={() => router.push('/finance/upload')} /> : undefined}
        />
      </Screen>
    );
  }

  const L = (label: string) => findLine(lines, label, 'pnl');
  const turnover = L('Total Turnover') ?? L('Gross Proceeds from Sales');
  const gp = L('Gross Profit');
  const op = L('Operating Profit 01');
  const np = L('Net Profit');
  const n = (v: number | null | undefined) => Number(v ?? 0);
  const groups = pnlGroups(lines);
  const trendMonths = [...new Set(data.trend.map((t) => data.uploads.find((u) => u.id === t.upload_id)?.month).filter(Boolean) as string[])].sort();
  const T = (m: string, k: 'turn' | 'gp' | 'np') => {
    const up = data.uploads.find((u) => u.month === m)?.id;
    const rows = data.trend.filter((t) => t.upload_id === up);
    const by = (l: string) => rows.find((r) => r.label.toLowerCase() === l.toLowerCase());
    return k === 'turn' ? by('Total Turnover') ?? by('Gross Proceeds from Sales') : k === 'gp' ? by('Gross Profit') : by('Net Profit');
  };
  const mnv = (v: number | null | undefined) => (v == null ? null : Number(v) / 1_000_000);
  const gpPct = (g: number | null | undefined, t: number | null | undefined) => (g == null || !t ? null : (Number(g) / Number(t)) * 100);
  const value = (l: PnlLine, k: Col['k']) => (k === 'var' ? n(l.c_act) - n(l.c_bud) : l[k]);
  // Positive variance = better for profit
  const impact = (l: PnlLine) => (isIncomeLine(l.label) ? 1 : -1) * (n(l.c_act) - n(l.c_bud));
  const deviations = groups
    // Turnover and cost of sales move together, so gross profit stands for both
    .filter((g) => g.detail.length && !/turnover|proceeds|profit|cost of sales/i.test(g.total.label))
    .map((g) => ({ label: g.total.label, value: impact(g.total) }))
    .concat(gp ? [{ label: 'Gross profit', value: impact(gp) }] : [])
    .filter((x) => Math.abs(x.value) >= 100_000)
    .sort((a, b) => a.value - b.value)
    .slice(0, 10);
  // Row highlight: more than 10% and 0.5 Mn worse than the YTD budget
  const flagged = (l: PnlLine) => impact(l) < -500_000 && Math.abs(impact(l)) > 0.1 * Math.abs(n(l.c_bud) || n(l.c_act));
  const watch = lines
    .filter((l) => l.section === 'pnl' && l.rank)
    .map((l) => ({ l, impact: impact(l) }))
    .filter((x) => x.impact < 0)
    .sort((a, b) => a.impact - b.impact)
    .slice(0, 5);


  const tile = (title: string, act: number, bud: number, sub: string, profit = false) => {
    const p = pct(act, bud);
    const good = profit ? act >= bud : p >= 90;
    return (
      <Card>
        <Text style={{ fontSize: 11.5, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</Text>
        <Text style={{ fontSize: 22, fontWeight: '700', color: act < 0 ? colors.red : colors.ink }}>{mn(act)} Mn</Text>
        {!profit ? <Progress pct={p} colour={good ? colors.green : p >= 60 ? colors.amber : colors.red} /> : null}
        <Muted>{sub}</Muted>
      </Card>
    );
  };

  return (
    <Screen maxWidth={1200}>
      <Stack.Screen options={{ title: 'P&L' }} />
      <Row wrap gap={8} style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ width: 240, maxWidth: '100%' }}>
          <Select label="Month" value={upload.id} onChange={setUploadId} options={data.uploads.map((u) => ({ value: u.id, label: fmtMonth(u.month) }))} />
        </View>
        <Row gap={8} wrap>
          <Pill label={`From OR file · ${upload.file_name ?? ''}`} tone={colors.green} />
          {isFinanceDesk(me.role) ? <Button small variant="secondary" title="Upload OR file" onPress={() => router.push('/finance/upload')} /> : null}
        </Row>
      </Row>

      <Grid min={220}>
        {tile(`Turnover · ${fmtMonth(upload.month)}`, n(turnover?.m_act), n(turnover?.m_bud), `Budget ${mn(turnover?.m_bud)} · ${fmtPct(pct(n(turnover?.m_act), n(turnover?.m_bud)))}`)}
        {tile('Turnover · YTD', n(turnover?.c_act), n(turnover?.c_bud), `Budget ${mn(turnover?.c_bud)} · ${fmtPct(pct(n(turnover?.c_act), n(turnover?.c_bud)))} · last yr ${mn(turnover?.ly_cum)} · FY plan ${mn(turnover?.fy_bp)}`)}
        {tile('Gross profit · YTD', n(gp?.c_act), n(gp?.c_bud), `GP ${fmtPct(pct(n(gp?.c_act), n(turnover?.c_act)), 1)} vs budget ${fmtPct(pct(n(gp?.c_bud), n(turnover?.c_bud)), 1)} · month ${mn(gp?.m_act)}`)}
        {tile('Operating profit 01 · YTD', n(op?.c_act), n(op?.c_bud), `Budget ${mn(op?.c_bud)} · last yr ${mn(op?.ly_cum)}`, true)}
        {tile('Net profit · YTD', n(np?.c_act), n(np?.c_bud), `Budget ${mn(np?.c_bud)} · last yr ${mn(np?.ly_cum)} · month ${mn(np?.m_act)}`, true)}
      </Grid>

      <Section title={`Trend · ${fyLabel(upload.fy)}`}>
        <Grid min={430}>
          <Card>
            <Text style={chartTitle}>Turnover by month – actual vs budget (LKR Mn)</Text>
            <BarChart
              categories={trendMonths.map(fmtMonthShort)}
              series={[
                { name: 'Budget', color: CHART.budget, fill: CHART.budgetFill, values: trendMonths.map((m) => mnv(T(m, 'turn')?.m_bud)) },
                { name: 'Actual', color: CHART.actual, values: trendMonths.map((m) => mnv(T(m, 'turn')?.m_act)) },
              ]}
              fmt={(v) => `${amt(v)} Mn`}
              fmtAxis={(v) => v.toFixed(0)}
              flags={(i) => (n(T(trendMonths[i], 'turn')?.m_act) < 0.9 * n(T(trendMonths[i], 'turn')?.m_bud) ? 'bad' : undefined)}
              note={trendMonths.length < 2 ? 'Only one month loaded – upload the earlier OR files of the year to see the trend.' : '▼ = month below 90% of budget'}
            />
          </Card>
          <Card>
            <Text style={chartTitle}>Turnover year to date – actual, budget and last year (LKR Mn)</Text>
            <LineChart
              categories={trendMonths.map(fmtMonthShort)}
              series={[
                { name: 'Budget', color: CHART.budget, dashed: true, values: trendMonths.map((m) => mnv(T(m, 'turn')?.c_bud)) },
                { name: 'Last year', color: CHART.second, values: trendMonths.map((m) => mnv(T(m, 'turn')?.ly_cum)) },
                { name: 'Actual', color: CHART.actual, values: trendMonths.map((m) => mnv(T(m, 'turn')?.c_act)) },
              ]}
              fmt={(v) => `${amt(v)} Mn`}
              fmtAxis={(v) => v.toFixed(0)}
              flags={(i) => (n(T(trendMonths[i], 'turn')?.c_act) < 0.9 * n(T(trendMonths[i], 'turn')?.c_bud) ? 'bad' : undefined)}
              note={`FY plan ${mn(turnover?.fy_bp)} Mn · ▼ = year to date below 90% of budget`}
            />
          </Card>
          <Card>
            <Text style={chartTitle}>Gross profit % by month – actual vs budget</Text>
            <LineChart
              categories={trendMonths.map(fmtMonthShort)}
              series={[
                { name: 'Budget', color: CHART.budget, dashed: true, values: trendMonths.map((m) => gpPct(T(m, 'gp')?.m_bud, T(m, 'turn')?.m_bud)) },
                { name: 'Actual', color: CHART.actual, values: trendMonths.map((m) => gpPct(T(m, 'gp')?.m_act, T(m, 'turn')?.m_act)) },
              ]}
              fmt={(v) => `${amt(v)}%`}
              fmtAxis={(v) => `${v.toFixed(0)}%`}
              flags={(i) => {
                const a = gpPct(T(trendMonths[i], 'gp')?.m_act, T(trendMonths[i], 'turn')?.m_act);
                const b = gpPct(T(trendMonths[i], 'gp')?.m_bud, T(trendMonths[i], 'turn')?.m_bud);
                return a != null && b != null && a < b - 2 ? 'bad' : undefined;
              }}
              note="▼ = more than 2 points below the budgeted GP %"
            />
          </Card>
          <Card>
            <Text style={chartTitle}>Net profit year to date – actual vs budget (LKR Mn)</Text>
            <LineChart
              categories={trendMonths.map(fmtMonthShort)}
              series={[
                { name: 'Budget', color: CHART.budget, dashed: true, values: trendMonths.map((m) => mnv(T(m, 'np')?.c_bud)) },
                { name: 'Last year', color: CHART.second, values: trendMonths.map((m) => mnv(T(m, 'np')?.ly_cum)) },
                { name: 'Actual', color: CHART.actual, values: trendMonths.map((m) => mnv(T(m, 'np')?.c_act)) },
              ]}
              fmt={(v) => `${amt(v)} Mn`}
              fmtAxis={(v) => v.toFixed(0)}
              flags={(i) => (n(T(trendMonths[i], 'np')?.c_act) < n(T(trendMonths[i], 'np')?.c_bud) ? 'bad' : undefined)}
              note="▼ = below budget"
            />
          </Card>
        </Grid>
        <Card>
          <Text style={chartTitle}>Where the year to date differs from budget (LKR Mn, effect on profit)</Text>
          <DeviationBars rows={deviations} fmt={(v) => mn(v)} />
          <Muted>Each P&L heading’s difference from budget, as its effect on profit. Highlighted rows in the table below are more than 10% and 0.5 Mn worse than budget.</Muted>
        </Card>
      </Section>

      <Section title="P&L (LKR Mn) – tap a line for its detail">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <ScrollView horizontal>
            <View>
              <Row gap={0} style={{ backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <Text style={[cell, { width: 290, fontWeight: '700', color: colors.muted }]}>Line</Text>
                {COLS.map((c) => (
                  <Text key={c.k} style={[cell, { width: 96, textAlign: 'right', fontWeight: '700', color: colors.muted }]}>
                    {c.h}
                  </Text>
                ))}
              </Row>
              {groups.map((g) => (
                <View key={g.total.seq}>
                  <Pressable onPress={() => setOpen((o) => ({ ...o, [g.total.seq]: !o[g.total.seq] }))}>
                    <Row gap={0} style={{ backgroundColor: flagged(g.total) ? BAD_BG : colors.soft, borderBottomWidth: 1, borderBottomColor: colors.line, borderLeftWidth: 4, borderLeftColor: flagged(g.total) ? colors.red : 'transparent' }}>
                      <Text style={[cell, { width: 290, fontWeight: '700', color: colors.ink }]}>
                        {g.detail.length ? (open[g.total.seq] ? '▾ ' : '▸ ') : '   '}
                        {g.total.label}
                        {flagged(g.total) ? '  ▼' : ''}
                      </Text>
                      {COLS.map((c) => {
                        const v = value(g.total, c.k);
                        const bad = c.k === 'var' && impact(g.total) < 0;
                        return (
                          <Text key={c.k} style={[cell, num, { width: 96, fontWeight: '700' }, bad ? { color: colors.red } : c.k === 'var' ? { color: colors.green } : n(v) < 0 ? { color: colors.red } : null]}>
                            {mn(v)}
                          </Text>
                        );
                      })}
                    </Row>
                  </Pressable>
                  {open[g.total.seq]
                    ? g.detail.map((d) => (
                        <Row key={d.seq} gap={0} style={{ borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: flagged(d) ? BAD_BG : undefined, borderLeftWidth: 4, borderLeftColor: flagged(d) ? colors.red : 'transparent' }}>
                          <Text style={[cell, { width: 290, paddingLeft: 24 }]}>
                            {d.label}
                            {flagged(d) ? '  ▼' : ''}
                          </Text>
                          {COLS.map((c) => {
                            const v = value(d, c.k);
                            const bad = c.k === 'var' && impact(d) < 0;
                            return (
                              <Text key={c.k} style={[cell, num, { width: 96 }, bad ? { color: colors.red } : null]}>
                                {mn(v)}
                              </Text>
                            );
                          })}
                        </Row>
                      ))
                    : null}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
        <Muted>Var YTD = actual – budget; red = worse for profit. Last year = cumulative actual to the same month last year (from the file).</Muted>
      </Section>

      <Grid min={420}>
        <Section title="Business health">
          <DataTable
            rows={HEALTH.map((h) => ({ h, l: findLine(lines, h.label, undefined, h.first) })).filter((x) => x.l)}
            keyOf={(x) => x.h.label}
            columns={[
              { h: 'Indicator', w: 210, v: (x) => x.h.title },
              { h: 'Actual', w: 90, right: true, v: (x) => fmtH(x.l!.c_act, x.h), tone: (x) => (x.h.lowerBetter && n(x.l!.c_act) > n(x.l!.c_bud) ? colors.red : undefined) },
              { h: 'Budget', w: 90, right: true, v: (x) => fmtH(x.l!.c_bud, x.h) },
              { h: 'Last yr', w: 90, right: true, v: (x) => fmtH(x.l!.ly_cum, x.h) },
            ]}
          />
          <Muted>LKR Mn unless shown as days or people. Red = above budget where lower is better.</Muted>
        </Section>
        <Section title="Watch list – largest adverse items YTD">
          {watch.length ? (
            <DataTable
              rows={watch}
              keyOf={(x) => String(x.l.seq)}
              columns={[
                { h: 'Line', w: 220, v: (x) => x.l.label },
                { h: 'YTD act', w: 90, right: true, v: (x) => mn(x.l.c_act) },
                { h: 'YTD bud', w: 90, right: true, v: (x) => mn(x.l.c_bud) },
                { h: 'Worse by', w: 90, right: true, v: (x) => mn(-x.impact), tone: () => colors.red },
              ]}
            />
          ) : (
            <Card>
              <Muted>No line is worse than budget.</Muted>
            </Card>
          )}
        </Section>
      </Grid>

    </Screen>
  );
}

function fmtH(v: number | null, h: { days?: boolean; count?: boolean; abs?: boolean }) {
  if (v == null) return '—';
  if (h.abs) v = Math.abs(v);
  if (h.days || h.count) return String(Math.round(v));
  return mn(v);
}

const BAD_BG = '#fdecee';
const chartTitle = { fontWeight: '700' as const, color: colors.ink, marginBottom: 6 };
const cell = { paddingVertical: 7, paddingHorizontal: 8, fontSize: 13, color: colors.text } as const;
const num = { textAlign: 'right' as const, fontVariant: ['tabular-nums' as const] };
