import { EXEC_STAGES } from '@/lib/execution';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { Card, colors, Grid, Muted, Notice, Pill, Row, Section, Stat } from '@/components/ui';
import { fmtMonth, fyLabel } from '@/lib/finance';
import { AREAS, type Level, type MgmtReport } from '@/lib/mgmtReport';

export const levelTone: Record<Level, string> = { red: colors.red, amber: colors.amber, green: colors.green };
const mn = (v: number | null | undefined) => (v == null ? '—' : (Number(v) / 1e6).toFixed(2));
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const tone = (act: number, bud: number, income = true): 'red' | 'amber' | 'green' | undefined =>
  !bud ? undefined : income ? (act >= bud ? 'green' : act >= bud * 0.9 ? 'amber' : 'red') : act <= bud ? 'green' : act <= bud * 1.1 ? 'amber' : 'red';

/** The management report on screen (the PDF follows the same order). */
export function MgmtReportView({ r }: { r: MgmtReport }) {
  const turn = r.pnl.lines.find((l) => l.label === 'Turnover');
  const np = r.pnl.lines.find((l) => l.label === 'Net profit');
  return (
    <>
      <Row gap={6} wrap>
        {AREAS.map((a) => (
          <Pill key={a.key} label={a.label} tone={levelTone[r.status[a.key]]} solid />
        ))}
      </Row>
      <Grid min={170}>
        <Stat label="Turnover YTD (Mn)" value={mn(turn?.ytd.act)} tone={turn ? tone(Number(turn.ytd.act), Number(turn.ytd.bud)) : undefined} />
        <Stat label="Net profit YTD (Mn)" value={mn(np?.ytd.act)} tone={np ? tone(Number(np.ytd.act), Number(np.ytd.bud)) : undefined} />
        <Stat label="Invoiced YTD (Mn)" value={mn(r.invoicing.ytd.invoiced)} tone={tone(r.invoicing.ytd.invoiced, r.invoicing.ytd.budget)} />
        <Stat label="Secured YTD (Mn)" value={mn(r.sales.secured.ytd)} />
        <Stat label="Debtors > 90 days (Mn)" value={mn(r.cash.over90)} tone={r.cash.debtors && r.cash.over90 > r.cash.debtors * 0.2 ? 'red' : undefined} />
      </Grid>

      <Section title="Highlights">
        <Card style={{ gap: 6 }}>
          {r.headlines.length ? r.headlines.map((h) => <Text key={h} style={{ color: colors.ink }}>{`•  ${h}`}</Text>) : <Muted>No figures for this month yet.</Muted>}
        </Card>
      </Section>

      <Section title={`Exceptions (${r.flags.length})`}>
        {r.flags.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {r.flags.map((f, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line, borderLeftWidth: 4, borderLeftColor: levelTone[f.level] }}>
                <Text style={{ width: 80, fontWeight: '700', color: levelTone[f.level] }}>{f.area}</Text>
                <Text style={{ flex: 1, color: colors.ink }}>{f.text}</Text>
              </View>
            ))}
          </Card>
        ) : (
          <Notice tone={colors.green}>Nothing outside the limits this month.</Notice>
        )}
      </Section>

      <Section title={`P&L${r.pnl.month ? ` · OR file ${fmtMonth(r.pnl.month)}` : ''} (LKR Mn)`}>
        {r.pnl.lines.length ? (
          <>
            <DataTable
              rows={r.pnl.lines}
              keyOf={(l) => l.label}
              columns={[
                { h: '', w: 150, v: (l) => l.label, bold: true },
                { h: 'Month', w: 90, right: true, v: (l) => mn(l.m.act) },
                { h: 'Budget', w: 90, right: true, v: (l) => mn(l.m.bud) },
                { h: 'YTD', w: 90, right: true, v: (l) => mn(l.ytd.act), tone: (l) => (Number(l.ytd.act) < Number(l.ytd.bud) ? colors.red : undefined) },
                { h: 'YTD budget', w: 100, right: true, v: (l) => mn(l.ytd.bud) },
                { h: 'YTD %', w: 70, right: true, v: (l) => pct(Number(l.ytd.act), Number(l.ytd.bud)) },
                { h: 'FY plan', w: 90, right: true, v: (l) => mn(l.fyBp) },
              ]}
            />
            <Muted>{`GP % – month ${r.pnl.gpPct.m?.toFixed(1) ?? '—'}% (budget ${r.pnl.gpPct.mBud?.toFixed(1) ?? '—'}%) · YTD ${r.pnl.gpPct.ytd?.toFixed(1) ?? '—'}% (budget ${r.pnl.gpPct.ytdBud?.toFixed(1) ?? '—'}%)`}</Muted>
            {r.pnl.worse.length || r.pnl.better.length ? (
              <Grid min={300}>
                <Card style={{ gap: 4 }}>
                  <Text style={{ fontWeight: '700', color: colors.red }}>Worse than YTD budget</Text>
                  {r.pnl.worse.map((x) => <Muted key={x.label}>{`${x.label}: −${mn(-x.value)}`}</Muted>)}
                </Card>
                <Card style={{ gap: 4 }}>
                  <Text style={{ fontWeight: '700', color: colors.green }}>Better than YTD budget</Text>
                  {r.pnl.better.map((x) => <Muted key={x.label}>{`${x.label}: +${mn(x.value)}`}</Muted>)}
                </Card>
              </Grid>
            ) : null}
          </>
        ) : (
          <Muted>No OR file loaded.</Muted>
        )}
      </Section>

      <Section title={`Invoicing · ${fmtMonth(r.month)} and ${fyLabel(r.fy)} YTD (LKR Mn)`}>
        <Grid min={170}>
          <Stat label={`Budget ${fmtMonth(r.month)}`} value={mn(r.invoicing.month.budget)} />
          <Stat label="Forecast (schedules)" value={mn(r.invoicing.month.forecast)} />
          <Stat label="Invoiced" value={mn(r.invoicing.month.invoiced)} tone={tone(r.invoicing.month.invoiced, r.invoicing.month.budget)} />
          <Stat label={`Year-end outlook vs ${mn(r.invoicing.fyBudget)} budget`} value={mn(r.invoicing.outlook)} tone={tone(r.invoicing.outlook, r.invoicing.fyBudget)} />
          <Stat label={`Slipped (${r.invoicing.slipped.count})`} value={mn(r.invoicing.slipped.value)} tone={r.invoicing.slipped.count ? 'red' : undefined} />
          <Stat label="Ready to invoice (execution)" value={mn(r.invoicing.ready)} />
        </Grid>
        <DataTable
          rows={r.invoicing.byLine}
          keyOf={(x) => x.line}
          columns={[
            { h: 'Business line', w: 200, v: (x) => x.line, bold: true },
            { h: 'Budget', w: 80, right: true, v: (x) => mn(x.budget) },
            { h: 'Forecast', w: 80, right: true, v: (x) => mn(x.forecast) },
            { h: 'Invoiced', w: 80, right: true, v: (x) => mn(x.invoiced) },
            { h: 'YTD budget', w: 95, right: true, v: (x) => mn(x.ytdBudget) },
            { h: 'YTD invoiced', w: 100, right: true, v: (x) => mn(x.ytdInvoiced), tone: (x) => (x.ytdInvoiced < x.ytdBudget * 0.9 ? colors.red : undefined) },
          ]}
        />
      </Section>

      <Section title="Sales (LKR Mn)">
        <Grid min={170}>
          <Stat label={`Secured ${fmtMonth(r.month)} (this FY's part)`} value={mn(r.sales.secured.month)} />
          <Stat label="Secured YTD (this FY's part)" value={mn(r.sales.secured.ytd)} />
          <Stat label={`Orders won YTD (${r.sales.secured.count}) – order value`} value={mn(r.sales.secured.orderValueYtd)} />
          <Stat label="Order book to invoice" value={mn(r.sales.orderBook)} />
          <Stat label="Win rate YTD" value={r.sales.quotes.winRate == null ? '—' : `${Math.round(r.sales.quotes.winRate)}%`} />
          <Stat label={`Open quotations (${r.sales.quotes.open})`} value={mn(r.sales.quotes.openValue)} />
        </Grid>
        {r.sales.people.length ? (
          <DataTable
            rows={r.sales.people}
            keyOf={(x) => x.name}
            columns={[
              { h: 'Sales person', w: 180, v: (x) => x.name, bold: true },
              { h: 'Secured YTD', w: 100, right: true, v: (x) => mn(x.securedYtd) },
              { h: 'Target', w: 90, right: true, v: (x) => mn(x.securedTarget) },
              { h: '%', w: 60, right: true, v: (x) => pct(x.securedYtd, x.securedTarget), tone: (x) => (x.securedTarget && x.securedYtd < x.securedTarget * 0.8 ? colors.red : undefined) },
              { h: 'Invoiced YTD', w: 100, right: true, v: (x) => mn(x.invoicedYtd) },
              { h: 'Target', w: 90, right: true, v: (x) => mn(x.invoiceTarget) },
              { h: '%', w: 60, right: true, v: (x) => pct(x.invoicedYtd, x.invoiceTarget), tone: (x) => (x.invoiceTarget && x.invoicedYtd < x.invoiceTarget * 0.8 ? colors.red : undefined) },
            ]}
          />
        ) : null}
      </Section>

      <Section title="Cash (LKR Mn)">
        <Grid min={170}>
          <Stat label="Debtors" value={mn(r.cash.debtors)} />
          <Stat label={`Over 90 days (${pct(r.cash.over90, r.cash.debtors)})`} value={mn(r.cash.over90)} tone={r.cash.debtors && r.cash.over90 > r.cash.debtors * 0.2 ? 'red' : undefined} />
          <Stat label={`Retentions held (${r.cash.retentions.overdueCount} overdue)`} value={mn(r.cash.retentions.held)} tone={r.cash.retentions.overdueCount ? 'amber' : undefined} />
          <Stat label={`Bonds active (${r.cash.bonds.count}, ${r.cash.bonds.expiring30} expiring in 30 days)`} value={mn(r.cash.bonds.active)} />
        </Grid>
        {r.cash.top.length ? (
          <DataTable
            rows={r.cash.top}
            keyOf={(x) => x.client}
            columns={[
              { h: 'Largest debtors', w: 260, v: (x) => x.client, bold: true },
              { h: 'Outstanding', w: 110, right: true, v: (x) => mn(x.value) },
              { h: 'Oldest (days)', w: 100, right: true, v: (x) => String(x.days), tone: (x) => (x.days > 90 ? colors.red : undefined) },
            ]}
          />
        ) : null}
        {r.usdRate ? <Muted>{`USD converted at 1 USD = ${r.usdRate} LKR`}</Muted> : null}
      </Section>

      <Section title="Execution">
        <Grid min={170}>
          <Stat label="Projects in execution" value={String(r.execution.active)} />
          <Stat label="Behind programme" value={String(r.execution.behind)} tone={r.execution.behind ? 'red' : undefined} />
          <Stat label="Over cost budget" value={String(r.execution.overCost)} tone={r.execution.overCost ? 'red' : undefined} />
          <Stat label={`Variations approved YTD (${r.execution.variations.pending} pending)`} value={`${mn(r.execution.variations.approvedValue)} Mn`} />
          <Stat label={`HSE ${fmtMonth(r.month)} (${r.execution.hse.lostTime} lost time)`} value={String(r.execution.hse.month)} tone={r.execution.hse.lostTime ? 'red' : undefined} />
        </Grid>
        {r.execution.projects.length ? (
          <DataTable
            rows={r.execution.projects}
            keyOf={(x) => x.code + x.name}
            edge={(x) => (x.planned != null && x.actual != null && x.planned - x.actual > 10 ? colors.red : (x.late ?? 0) > 0 ? colors.amber : undefined)}
            columns={[
              { h: 'Project', w: 260, v: (x) => `${x.code} ${x.name}`, bold: true },
              { h: 'Stage', w: 110, v: (x) => EXEC_STAGES[x.stage - 1] ?? String(x.stage) },
              { h: 'Planned', w: 75, right: true, v: (x) => (x.planned == null ? '—' : `${x.planned}%`) },
              { h: 'Done', w: 65, right: true, v: (x) => (x.actual == null ? '—' : `${x.actual}%`) },
              { h: 'Finish vs baseline', w: 130, right: true, v: (x) => (x.late == null ? '—' : x.late > 0 ? `${x.late} days late` : 'On time'), tone: (x) => ((x.late ?? 0) > 0 ? colors.amber : undefined) },
              { h: 'Cost vs budget', w: 115, right: true, v: (x) => (x.costPct == null ? '—' : `${x.costPct}%`), tone: (x) => ((x.costPct ?? 0) > 100 ? colors.red : undefined) },
              { h: 'HSE open', w: 80, right: true, v: (x) => String(x.hseOpen) },
            ]}
          />
        ) : null}
      </Section>

      <Section title="Warranty">
        <Grid min={170}>
          <Stat label="Claims open" value={String(r.warranty.open)} />
          <Stat label={`Logged in ${fmtMonth(r.month)}`} value={String(r.warranty.loggedMonth)} />
          <Stat label="Cost YTD (Mn)" value={mn(r.warranty.costYtd)} />
          <Stat label="Recovered from suppliers YTD (Mn)" value={mn(r.warranty.recoveredYtd)} />
        </Grid>
      </Section>
    </>
  );
}
