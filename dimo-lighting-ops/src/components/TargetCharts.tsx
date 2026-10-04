import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { BarChart, CHART, LineChart } from '@/components/charts';
import { pctTone } from '@/components/financeTones';
import { Card, colors, Grid, Muted, Progress, Row } from '@/components/ui';
import { amt, fmtMonth, fmtMonthShort, fmtPct, fyMonths, mn, pct, ytd, type InvoiceLine, type PerfPerson } from '@/lib/finance';

const M = 1e6;

/** Month series for one sales person: invoicing target, invoiced (to the last OR month) and invoices planned after it. */
function series(p: PerfPerson, fy: number, upTo: string | null, lines: InvoiceLine[]) {
  const months = fyMonths(fy);
  const at = (m: string) => p.months.find((x) => x.month === m);
  const target = months.map((m) => Number(at(m)?.invoice_target ?? 0) / M);
  const invoiced = months.map((m) => (upTo && m <= upTo ? Number(at(m)?.invoiced ?? 0) / M : null));
  // Still to bill: future months as planned; anything slipped (planned up to the last OR month) lands in the next month
  const first = months.find((m) => !upTo || m > upTo);
  const planned = months.map((m) =>
    first && m >= first
      ? lines
          .filter((l) => Number(l.remaining) > 0.5 && (l.forecast_month === m || (m === first && l.forecast_month < first)))
          .reduce((a, l) => a + Number(l.remaining), 0) / M
      : null,
  );
  const cum = (xs: (number | null)[]) => {
    const out: (number | null)[] = [];
    xs.forEach((x, i) => out.push(x == null ? null : x + (i ? (out[i - 1] ?? 0) : 0)));
    return out;
  };
  const cumTarget = cum(target);
  const cumInvoiced = cum(invoiced);
  const lastIdx = upTo ? months.indexOf(upTo) : -1;
  const base = lastIdx >= 0 ? (cumInvoiced[lastIdx] ?? 0) : 0;
  const outlook = months.map((_, i) => {
    if (i < lastIdx) return null;
    if (i === lastIdx) return base;
    return base + planned.slice(lastIdx + 1, i + 1).reduce<number>((a, x) => a + (x ?? 0), 0);
  });
  return { months, target, invoiced, planned, cumTarget, cumInvoiced, outlook };
}

/** Charts on My Target: invoicing target vs actual by month, and the year's cumulative line with the outlook. */
export function TargetCharts({ p, fy, upTo, lines }: { p: PerfPerson; fy: number; upTo: string | null; lines: InvoiceLine[] }) {
  const s = series(p, fy, upTo, lines);
  const cats = s.months.map(fmtMonthShort);
  const yearEnd = s.outlook[11] ?? s.cumInvoiced[11] ?? 0;
  return (
    <Grid min={430}>
      <Card>
        <Text style={title}>Invoicing by month – target vs invoiced (LKR Mn)</Text>
        <BarChart
          categories={cats}
          series={[
            {
              name: 'Target',
              color: CHART.budget,
              fill: CHART.budgetFill,
              values: s.target,
            },
            { name: 'Invoiced', color: CHART.actual, values: s.invoiced },
            {
              name: 'Planned (my schedules)',
              color: CHART.second,
              values: s.planned,
            },
          ]}
          fmt={(v) => `${amt(v)} Mn`}
          fmtAxis={(v) => v.toFixed(0)}
          flags={(i) => (s.invoiced[i] != null && s.invoiced[i]! < 0.9 * s.target[i] ? 'bad' : undefined)}
          note="▼ = month invoiced below 90% of target. Planned = invoices still to bill in your schedules (slipped ones in the next month)."
        />
      </Card>
      <Card>
        <Text style={title}>Year to date – cumulative target, invoiced and outlook (LKR Mn)</Text>
        <LineChart
          categories={cats}
          series={[
            {
              name: 'Target',
              color: CHART.budget,
              dashed: true,
              values: s.cumTarget,
            },
            {
              name: 'Outlook (schedules)',
              color: CHART.second,
              dashed: true,
              values: s.outlook,
            },
            { name: 'Invoiced', color: CHART.actual, values: s.cumInvoiced },
          ]}
          fmt={(v) => `${amt(v)} Mn`}
          fmtAxis={(v) => v.toFixed(0)}
          flags={(i) => (s.cumInvoiced[i] != null && s.cumInvoiced[i]! < 0.9 * (s.cumTarget[i] ?? 0) ? 'bad' : undefined)}
          note={`Year-end: target ${amt(s.cumTarget[11] ?? 0)} · outlook ${amt(yearEnd)} · ${
            yearEnd >= (s.cumTarget[11] ?? 0) ? 'on track' : `gap ${amt((s.cumTarget[11] ?? 0) - yearEnd)} Mn – win and bill more`
          }`}
        />
      </Card>
    </Grid>
  );
}

/** My Day card: last OR month and year to date, invoiced against target; taps through to My Target. */
export function TargetCard({ p, upTo }: { p: PerfPerson; upTo: string | null }) {
  const y = ytd(p, upTo);
  const m = upTo ? p.months.find((x) => x.month === upTo) : undefined;
  const mPct = m ? pct(Number(m.invoiced), Number(m.invoice_target)) : 0;
  const bar = (label: string, done: number, target: number, value: number) => (
    <View style={{ gap: 4 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text }}>{label}</Text>
        <Text style={{ fontWeight: '700', color: colors.ink }}>
          {mn(done)} / {mn(target)} Mn · {fmtPct(value)}
        </Text>
      </Row>
      <Progress pct={value} colour={pctTone(value)} />
    </View>
  );
  return (
    <Card onPress={() => router.push('/finance/my')}>
      <Row wrap gap={16} style={{ alignItems: 'center' }}>
        <View style={{ alignItems: 'center', minWidth: 90 }}>
          <Text style={{ fontSize: 30, fontWeight: '800', color: pctTone(y.score) }}>{y.score.toFixed(2)}</Text>
          <Muted>Score</Muted>
        </View>
        <View style={{ flex: 1, minWidth: 220, gap: 10 }}>
          {m ? bar(`Invoiced · ${fmtMonth(upTo)}`, Number(m.invoiced), Number(m.invoice_target), mPct) : null}
          {bar('Invoiced · year to date', y.invoiced, y.invoiceTarget, y.invoicedPct)}
          {bar('Secured · year to date', y.secured, y.securedTarget, y.securedPct)}
          <Muted>
            {y.gap ? `Still to win and bill this year: ${mn(y.gap)} Mn` : 'Year covered: invoiced + secured still to bill meets the target'}
            {upTo ? '' : ' · no OR file uploaded yet this year'} · tap for details
          </Muted>
        </View>
      </Row>
    </Card>
  );
}

const title = {
  fontWeight: '700' as const,
  color: colors.ink,
  marginBottom: 6,
};
