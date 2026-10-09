import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { BarChart, CHART, LineChart } from '@/components/charts';
import { pctTone } from '@/components/financeTones';
import { Card, colors, Grid, Muted, Progress, Row } from '@/components/ui';
import type { CompanyInvoicing } from '@/lib/companyInvoicing';
import { amt, fmtMonth, fmtMonthShort, fmtPct, fyMonths, mn, pct, ytd, type InvoiceLine, type PerfPerson } from '@/lib/finance';

const M = 1e6;

/** Month series for one sales person: invoicing target, invoiced (recorded invoices, to this month) and invoices planned after it. */
function series(p: PerfPerson, fy: number, upTo: string | null, lines: InvoiceLine[]) {
  const months = fyMonths(fy);
  const at = (m: string) => p.months.find((x) => x.month === m);
  const target = months.map((m) => Number(at(m)?.invoice_target ?? 0) / M);
  const invoiced = months.map((m) => (upTo && m <= upTo ? Number(at(m)?.invoiced ?? 0) / M : null));
  // Still to bill: future months as planned; anything slipped (planned before this month) lands in the next month
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
        <Text style={title}>Invoicing by month – budget vs invoiced (LKR Mn)</Text>
        <BarChart
          categories={cats}
          series={[
            {
              name: 'Budget',
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
          note="▼ = month invoiced below 90% of budget. Planned = invoices still to bill in your schedules (slipped ones in the next month)."
        />
      </Card>
      <Card>
        <Text style={title}>Year to date – cumulative budget, invoiced and outlook (LKR Mn)</Text>
        <LineChart
          categories={cats}
          series={[
            {
              name: 'Budget',
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
          note={`Year-end: budget ${amt(s.cumTarget[11] ?? 0)} · outlook ${amt(yearEnd)} · ${
            yearEnd >= (s.cumTarget[11] ?? 0) ? 'on track' : `gap ${amt((s.cumTarget[11] ?? 0) - yearEnd)} Mn – win and bill more`
          }`}
        />
      </Card>
    </Grid>
  );
}

/** My Day card: this month and year to date, invoiced against target; taps through to My Target. */
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
            · tap for details
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

/** SM Projects / GM dashboard: the team's year to date – budget vs secured vs invoiced – and each sales person; taps to Targets. */
export function TeamTargetCard({ people, upTo, company }: { people: PerfPerson[]; upTo: string | null; company?: CompanyInvoicing | null }) {
  const rows = people.map((p) => ({ p, y: ytd(p, upTo) })).sort((a, b) => b.y.score - a.y.score);
  const t = rows.reduce(
    (a, { y }) => ({ st: a.st + y.securedTarget, s: a.s + y.secured, it: a.it + y.invoiceTarget, i: a.i + y.invoiced, fy: a.fy + y.fyInvoiceTarget, fyi: a.fyi + y.fyInvoiced }),
    { st: 0, s: 0, it: 0, i: 0, fy: 0, fyi: 0 },
  );
  const bar = (label: string, done: number, target: number) => {
    const v = pct(done, target);
    return (
      <View style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ color: colors.text }}>{label}</Text>
          <Text style={{ fontWeight: '700', color: colors.ink }}>
            {mn(done)} / {mn(target)} Mn · {fmtPct(v)}
          </Text>
        </Row>
        <Progress pct={v} colour={pctTone(v)} />
      </View>
    );
  };
  return (
    <Card onPress={() => router.push('/finance/targets')}>
      <View style={{ gap: 10 }}>
        {bar('Secured vs budget · year to date', t.s, t.st)}
        {/* Invoicing: the whole company – every business line and budgeted project, with or without a sales person */}
        {bar('Invoiced vs budget · year to date · all business lines', company ? company.total.ytdInvoiced : t.i, company ? company.total.ytdBudget : t.it)}
        {bar('Invoiced vs full-year invoicing budget · all business lines', company ? company.total.fyInvoiced : t.fyi, company ? company.total.fyBudget : t.fy)}
      </View>
      {company ? (
        <View style={{ marginTop: 12 }}>
          <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: 4 }}>{`Invoicing by business line (LKR Mn) · year to date to ${fmtMonth(company.upTo)}`}</Text>
          {[{ label: 'Business line', head: true, ytdBudget: 0, ytdInvoiced: 0, fyBudget: 0 }, ...company.lines.map((l) => ({ ...l, head: false })), { label: 'Total', head: false, ...company.total, total: true }].map(
            (l, k) => {
              const v = pct(l.ytdInvoiced, l.ytdBudget);
              const bold = l.head || 'total' in l;
              return (
                <Row key={k} wrap style={{ borderTopWidth: k ? 1 : 0, borderTopColor: colors.line, paddingVertical: 4 }}>
                  <Text style={{ flex: 1, minWidth: 170, color: l.head ? colors.muted : colors.ink, fontWeight: bold ? '700' : '400' }}>{l.label}</Text>
                  {(l.head
                    ? ['Budget YTD', 'Invoiced YTD', '%', 'Full-year budget']
                    : [mn(l.ytdBudget), mn(l.ytdInvoiced), l.ytdBudget ? fmtPct(v) : '—', mn(l.fyBudget)]
                  ).map((c, j) => (
                    <Text
                      key={j}
                      style={{
                        width: 96,
                        textAlign: 'right',
                        fontWeight: bold ? '700' : '400',
                        color: l.head ? colors.muted : j === 2 && l.ytdBudget ? pctTone(v) : colors.ink,
                      }}
                    >
                      {c}
                    </Text>
                  ))}
                </Row>
              );
            },
          )}
          {company.noSalesPerson.count ? (
            <Muted>{`${company.noSalesPerson.count} budgeted project(s) have no sales person (${mn(company.noSalesPerson.fyBudget)} Mn this year) – included above, but not in anyone's target. Assign them in the budget list.`}</Muted>
          ) : null}
        </View>
      ) : null}
      {rows.length ? (
        <View style={{ marginTop: 12, gap: 6 }}>
          {rows.map(({ p, y }) => (
            <Row key={p.id} wrap style={{ justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6 }}>
              <Text style={{ fontWeight: '700', color: colors.ink, minWidth: 160 }}>{p.name}</Text>
              <Text style={{ color: pctTone(y.securedPct) }}>Secured {fmtPct(y.securedPct)}</Text>
              <Text style={{ color: pctTone(y.invoicedPct) }}>Invoiced {fmtPct(y.invoicedPct)}</Text>
              <Text style={{ fontWeight: '700', color: pctTone(y.score) }}>Score {y.score.toFixed(2)}</Text>
            </Row>
          ))}
        </View>
      ) : (
        <Muted>No targets for this year yet – fill them from the budget list in Targets.</Muted>
      )}
      <View style={{ marginTop: 8 }}>
        <Muted>LKR Mn · budget from the budget list (invoice months, or spread from the order month to March) · secured = projects won / marked secured · invoiced = invoices recorded · the rows per person are their own targets · tap for details</Muted>
      </View>
    </Card>
  );
}
