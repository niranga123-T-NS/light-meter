import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { BarChart, CHART, LineChart } from '@/components/charts';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Grid, Loading, Muted, Pill, Row, Screen, Section, Segmented, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import {
  addMonths,
  fmtMonth,
  fyLabel,
  fmtPct,
  fyOf,
  fyMonths,
  fyStart,
  fmtMonthShort,
  isReviewer,
  kindLabel,
  lineColour,
  lineShort,
  LINES,
  mn,
  pct,
  seesFinance,
  thisMonth,
  type Allocation,
  type BudgetInvoice,
  type BudgetProject,
  type InvoiceLine,
  type LineChange,
} from '@/lib/finance';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Tab = 'month' | 'slipped' | 'pending' | 'moved';

/** Invoicing by month: budget vs forecast vs invoiced, the invoices due, slipped and moved. */
export default function Invoicing() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [month, setMonth] = useState(thisMonth());
  const [tab, setTab] = useState<Tab>('month');
  const [line, setLine] = useState('');
  const [person, setPerson] = useState('');
  const fy = fyOf(month);
  const { data, error, reload } = useLoad(async () => {
    const [l, a, b, c, u] = await Promise.all([
      supabase.from('invoice_line_status').select('*'),
      supabase.from('invoice_allocations').select('*'),
      supabase.from('budget_projects').select('*, budget_invoices(*)').eq('fy', fy),
      supabase.from('invoice_line_changes').select('*').order('requested_at', { ascending: false }),
      supabase.from('or_uploads').select('month').order('month', { ascending: false }).limit(1),
    ]);
    if (l.error) throw new Error(l.error.message);
    return {
      lines: (l.data ?? []) as InvoiceLine[],
      allocs: (a.data ?? []) as Allocation[],
      budget: (b.data ?? []) as (BudgetProject & { budget_invoices: BudgetInvoice[] })[],
      changes: (c.data ?? []) as LineChange[],
      latest: (u.data?.[0]?.month as string | undefined) ?? null,
    };
  }, [fy]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;

  const keep = (l: { business_line: string | null; sales_person_id: string | null }) => (!line || l.business_line === line) && (!person || l.sales_person_id === person);
  const lines = data.lines.filter((l) => l.project_status === 'open' && l.schedule_status === 'approved' && keep(l));
  const budgetRows = data.budget.filter((b) => keep(b));
  const securedLineOf = (id: string) => data.lines.find((l) => l.secured_id === id);
  const budgetFor = (m: string, list = budgetRows) => list.reduce((a, b) => a + b.budget_invoices.filter((i) => i.month === m).reduce((x, i) => x + Number(i.amount), 0), 0);
  const forecastFor = (m: string, list = lines) => list.filter((l) => l.forecast_month === m).reduce((a, l) => a + Number(l.amount), 0);
  const invoicedFor = (m: string) =>
    data.allocs
      .filter((a) => a.month === m)
      .filter((a) => {
        const sl = securedLineOf(a.secured_id);
        return sl ? keep(sl) : !line && !person;
      })
      .reduce((x, a) => x + Number(a.amount), 0);
  const now = thisMonth();
  const tabs: Record<Tab, InvoiceLine[]> = {
    month: lines.filter((l) => l.forecast_month === month || (l.original_month === month && l.forecast_month !== month)),
    slipped: lines.filter((l) => l.forecast_month < now && Number(l.remaining) > 0.5),
    pending: lines.filter((l) => l.pending_change_id),
    moved: lines.filter((l) => l.moves > 0 && fyOf(l.original_month) === fy),
  };
  const rows = tabs[tab];
  const months = Array.from({ length: 18 }, (_, i) => addMonths(fyStart(fyOf(now) - 1), i + 6));
  const salesPeople = [...new Set([...data.lines.map((l) => l.sales_person_id), ...data.budget.map((b) => b.sales_person_id)].filter(Boolean))] as string[];
  const b = budgetFor(month);
  const f = forecastFor(month);
  const inv = invoicedFor(month);
  // Year view for the charts
  const ym = fyMonths(fy);
  const latest = data.latest && fyOf(data.latest) === fy ? data.latest : data.latest && data.latest > ym[11] ? ym[11] : null;
  const yBudget = ym.map((m) => budgetFor(m) / 1e6);
  const yForecast = ym.map((m) => forecastFor(m) / 1e6);
  const yInvoiced = ym.map((m) => (latest && m <= latest ? invoicedFor(m) / 1e6 : null));
  const cum = (xs: (number | null)[]) => {
    let t = 0;
    return xs.map((x) => (x == null ? null : (t += x)));
  };
  const cumBudget = cum(yBudget);
  const cumInvoiced = cum(yInvoiced);
  // Outlook: invoiced so far + what is still to bill, in its forecast month (slipped amounts in the month after the last OR file)
  const startIdx = latest ? ym.indexOf(latest) : -1;
  const slipped = lines.filter((l) => (latest ? l.forecast_month <= latest : false) && Number(l.remaining) > 0.5).reduce((a, l) => a + Number(l.remaining), 0) / 1e6;
  const addBy = ym.map((m, i) =>
    i <= startIdx ? 0 : lines.filter((l) => l.forecast_month === m).reduce((a, l) => a + Math.max(0, Number(l.remaining)), 0) / 1e6 + (i === startIdx + 1 ? slipped : 0),
  );
  const base = startIdx >= 0 ? cumInvoiced[startIdx] ?? 0 : 0;
  const outlook = ym.map((_, i) => (i < startIdx ? null : base + addBy.slice(0, i + 1).reduce((a, x) => a + x, 0)));
  const reasons = new Map<string, number>();
  data.changes
    .filter((c) => c.status !== 'rejected' && fyOf(c.from_month) === fy)
    .forEach((c) => reasons.set(c.reason, (reasons.get(c.reason) ?? 0) + 1));

  const decide = async (changeId: number, approve: boolean) => {
    const r = await dialog.prompt({
      title: approve ? 'Approve the date change' : 'Do not approve',
      fields: [{ key: 'note', label: approve ? 'Note (optional)' : 'Reason', type: 'multiline', required: !approve }],
      confirmLabel: approve ? 'Approve' : 'Reject',
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('decide_invoice_move', { p_change: changeId, p_approve: approve, p_note: r.note || null });
      await reload();
    }, 'Done');
  };
  const status = (l: InvoiceLine) =>
    Number(l.remaining) <= 0.5
      ? { label: 'Invoiced', tone: colors.green }
      : l.pending_change_id
        ? { label: `Awaiting SM Projects → ${fmtMonth(l.pending_month)}`, tone: colors.red }
        : l.forecast_month < now
          ? { label: Number(l.invoiced) > 0 ? 'Part invoiced – slipped' : 'Slipped', tone: colors.red }
          : l.forecast_month !== month && l.original_month === month
            ? { label: `Moved → ${fmtMonth(l.forecast_month)}`, tone: colors.amber }
            : Number(l.invoiced) > 0
              ? { label: 'Part invoiced', tone: colors.amber }
              : { label: 'Planned', tone: colors.blue };

  return (
    <Screen maxWidth={1250}>
      <Stack.Screen options={{ title: 'Invoicing' }} />
      <Row wrap gap={8}>
        <View style={{ width: 180 }}>
          <Select label="Month" value={month} onChange={setMonth} options={months.map((m) => ({ value: m, label: fmtMonth(m) }))} />
        </View>
        <View style={{ width: 230 }}>
          <Select label="Business line" value={line} onChange={setLine} options={[{ value: '', label: 'All lines' }, ...LINES.map((x) => ({ value: x.value, label: x.label }))]} />
        </View>
        {seesFinance(me.role) ? (
          <View style={{ width: 230 }}>
            <Select label="Sales person" value={person} onChange={setPerson} options={[{ value: '', label: 'All' }, ...salesPeople.map((p) => ({ value: p, label: people[p]?.full_name ?? '—' }))]} />
          </View>
        ) : null}
      </Row>
      <Grid min={210}>
        <Stat label={`Budget invoicing · ${fmtMonth(month)}`} value={`${mn(b)} Mn`} />
        <Stat label={`Forecast (schedules) · ${fmtPct(pct(f, b))} of budget`} value={`${mn(f)} Mn`} tone={b && f < b * 0.9 ? 'amber' : undefined} />
        <Stat label={`Invoiced · ${data.latest && data.latest >= month ? 'from the OR file' : 'OR file not loaded for this month yet'}`} value={`${mn(inv)} Mn`} />
        <Stat label="Slipped – not invoiced in the planned month" value={String(tabs.slipped.length)} tone={tabs.slipped.length ? 'red' : undefined} onPress={() => setTab('slipped')} />
      </Grid>

      <Grid min={430}>
        <Card>
          <Text style={chartTitle}>{`Invoicing by month · ${fyLabel(fy)} (LKR Mn)`}</Text>
          <BarChart
            categories={ym.map(fmtMonthShort)}
            series={[
              { name: 'Budget', color: CHART.budget, fill: CHART.budgetFill, values: yBudget },
              { name: 'Forecast', color: CHART.second, values: yForecast },
              { name: 'Invoiced', color: CHART.actual, values: yInvoiced },
            ]}
            fmt={(v) => `${v.toFixed(1)} Mn`}
            fmtAxis={(v) => v.toFixed(0)}
            flags={(i) => (yInvoiced[i] != null && yInvoiced[i]! < 0.9 * yBudget[i] ? 'bad' : undefined)}
            note="▼ = month invoiced below 90% of budget. Forecast = invoice schedules as they stand now."
          />
        </Card>
        <Card>
          <Text style={chartTitle}>Cumulative invoicing – budget, invoiced and outlook (LKR Mn)</Text>
          <LineChart
            categories={ym.map(fmtMonthShort)}
            series={[
              { name: 'Budget', color: CHART.budget, dashed: true, values: cumBudget },
              { name: 'Outlook (schedules)', color: CHART.second, dashed: true, values: outlook },
              { name: 'Invoiced', color: CHART.actual, values: cumInvoiced },
            ]}
            fmt={(v) => `${v.toFixed(1)} Mn`}
            fmtAxis={(v) => v.toFixed(0)}
            flags={(i) => (cumInvoiced[i] != null && cumInvoiced[i]! < 0.9 * (cumBudget[i] ?? 0) ? 'bad' : undefined)}
            note={`Year-end: budget ${mn((cumBudget[11] ?? 0) * 1e6)} · outlook ${mn((outlook[11] ?? cumInvoiced[11] ?? 0) * 1e6)} · gap ${mn(((cumBudget[11] ?? 0) - (outlook[11] ?? cumInvoiced[11] ?? 0)) * 1e6)} Mn`}
          />
        </Card>
      </Grid>

      <Section title={`By business line · ${fmtMonth(month)} (LKR Mn)`}>
        <DataTable
          rows={LINES.filter((x) => !line || x.value === line)}
          keyOf={(x) => x.value}
          columns={[
            { h: 'Business line', w: 220, v: (x) => x.label, bold: true },
            { h: 'Budget', w: 100, right: true, v: (x) => mn(budgetFor(month, budgetRows.filter((r) => r.business_line === x.value))) },
            { h: 'Forecast', w: 100, right: true, v: (x) => mn(forecastFor(month, lines.filter((l) => l.business_line === x.value))) },
            {
              h: 'Invoiced',
              w: 100,
              right: true,
              v: (x) =>
                mn(
                  data.allocs
                    .filter((a) => a.month === month && securedLineOf(a.secured_id)?.business_line === x.value && (!person || securedLineOf(a.secured_id)?.sales_person_id === person))
                    .reduce((s, a) => s + Number(a.amount), 0),
                ),
            },
            {
              h: 'Forecast vs budget',
              w: 140,
              right: true,
              v: (x) => mn(forecastFor(month, lines.filter((l) => l.business_line === x.value)) - budgetFor(month, budgetRows.filter((r) => r.business_line === x.value))),
              tone: (x) =>
                forecastFor(month, lines.filter((l) => l.business_line === x.value)) < budgetFor(month, budgetRows.filter((r) => r.business_line === x.value)) ? colors.red : colors.green,
            },
          ]}
        />
      </Section>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'month', label: `Due ${fmtMonth(month)}`, badge: tabs.month.length },
          { value: 'slipped', label: 'Slipped', badge: tabs.slipped.length },
          { value: 'pending', label: 'Waiting for SM Projects', badge: tabs.pending.length },
          { value: 'moved', label: 'Moved this year', badge: tabs.moved.length },
        ]}
      />
      <DataTable
        rows={rows}
        keyOf={(l) => l.id}
        edge={(l) => lineColour(l.business_line)}
        onPress={(l) => router.push(`/finance/secured/${l.secured_id}`)}
        emptyTitle="No invoices here"
        columns={[
          { h: 'Project', w: 230, v: (l) => l.project_name, bold: true },
          { h: 'Invoice', w: 170, v: (l) => l.description || kindLabel(l.kind) },
          { h: 'Line', w: 65, v: (l) => lineShort(l.business_line) },
          { h: 'Sales person', w: 140, v: (l) => people[l.sales_person_id ?? '']?.full_name ?? '—' },
          { h: 'Amount (Mn)', w: 95, right: true, v: (l) => mn(l.amount, 2) },
          { h: 'Invoiced (Mn)', w: 95, right: true, v: (l) => mn(l.invoiced, 2) },
          { h: 'Original', w: 85, v: (l) => fmtMonth(l.original_month) },
          { h: 'Forecast', w: 85, v: (l) => fmtMonth(l.forecast_month), tone: (l) => (l.forecast_month !== l.original_month ? colors.amber : undefined) },
          { h: 'Moves', w: 55, right: true, v: (l) => String(l.moves) },
          { h: 'Status', w: 210, v: (l) => <Pill label={status(l).label} tone={status(l).tone} /> },
          {
            h: '',
            w: 170,
            v: (l) =>
              l.pending_change_id && isReviewer(me.role) ? (
                <Row gap={4}>
                  <Button small title="Approve" onPress={() => decide(l.pending_change_id!, true)} />
                  <Button small variant="secondary" title="Reject" onPress={() => decide(l.pending_change_id!, false)} />
                </Row>
              ) : null,
          },
        ]}
      />
      {reasons.size ? (
        <Section title="Why invoices moved this year">
          <Row wrap gap={6}>
            {[...reasons.entries()]
              .sort((a, b2) => b2[1] - a[1])
              .map(([r, n]) => (
                <Pill key={r} label={`${r} · ${n}`} tone={colors.amber} />
              ))}
          </Row>
        </Section>
      ) : null}
      <Muted>Open a project to move an invoice (a reason is required). Invoicing comes from the monthly OR file by WBS.</Muted>
    </Screen>
  );
}

const chartTitle = { fontWeight: '700' as const, color: colors.ink, marginBottom: 6 };
