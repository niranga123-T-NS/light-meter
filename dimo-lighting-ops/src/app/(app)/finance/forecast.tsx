import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, Chip, colors, ErrorBanner, Grid, Loading, Muted, Notice, Pill, Row, Screen, Section, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { exportExcel, exportPdf, type Column } from '@/lib/export';
import { fyMonths, fyOf, lineLabel, LINES } from '@/lib/finance';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { ROLE_SHORT } from '@/lib/roles';
import { rpc } from '@/lib/supabase';

type Sched = { month: string; pct: number; kind: 'delivery' | 'progress' | 'retention' };
type FP = {
  id: string;
  code: string | null;
  name: string;
  customer: string;
  owner_id: string;
  line: string | null;
  term: string | null;
  milestone: string;
  win_probability: number;
  value_lkr: number;
  weighted_lkr: number;
  expected_award_date: string | null;
  award_used: string;
  award_from: 'award' | 'tender' | 'passed' | 'none';
  origin: 'european' | 'chinese' | 'unknown';
  origin_from: 'quotation' | 'inquiry' | 'default';
  basis: 'supply' | 'supply_install';
  basis_from: 'inquiry' | 'assumed';
  inquiry_code: string | null;
  duration_months: number;
  lead_days: number;
  delivery_date: string;
  no_value: boolean;
  schedule: Sched[];
};
type Amt = { month: string; amount: number; line: string | null; owner_id: string | null };
type Settings = Record<string, number | string>;
type Data = { fy: number; today: string; this_month: string; settings: Settings; projects: FP[]; invoiced: Amt[]; secured: Amt[]; targets: { owner_id: string; month: string; target: number }[] };

const ORIGIN = { european: 'European', chinese: 'Chinese', unknown: 'Not known' } as const;
const BASIS = { supply: 'Supply', supply_install: 'Supply & install' } as const;
const mLabel = (m: string) => new Date(`${m.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
const lkrM = (v: number) => `${(v / 1e6).toFixed(1)}M`;
/** Whole rupees with separators – the column heading says LKR */
const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
/** Short form for the summary cards: LKR 918.0 M / LKR 2.90 Bn */
const big = (v: number) => (Math.abs(v) >= 1e9 ? `LKR ${(v / 1e9).toFixed(2)} Bn` : `LKR ${(v / 1e6).toFixed(1)} M`);

/** Invoicing forecast for the financial year: invoiced + secured still to invoice + potential projects (by award date, origin lead time and basis). */
export default function InvoicingForecast() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const everyone = me.role === 'sm_projects' || me.role === 'gm';
  const [fy, setFy] = useState(fyOf(todayISO()));
  const [owner, setOwner] = useState('');
  const [line, setLine] = useState('');
  const [minPct, setMinPct] = useState(0);
  const { data, error, reload, loading } = useLoad(() => rpc<Data>('invoicing_forecast', { p_fy: fy }), [fy]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const months = fyMonths(fy);
  const fyEnd = months[11];
  const inScope = (o: string | null, l: string | null) => (!owner || o === owner) && (!line || l === line);
  const projects = data.projects.filter((p) => inScope(p.owner_id, p.line) && p.win_probability >= minPct);
  // Amount of a project in a month (weighted or not)
  const amountIn = (p: FP, m: string, weighted = true) =>
    p.schedule.filter((s) => s.month.slice(0, 7) === m.slice(0, 7)).reduce((t, s) => t + ((weighted ? p.weighted_lkr : p.value_lkr) * s.pct) / 100, 0);
  const thisFy = (p: FP, weighted = true) => p.schedule.filter((s) => s.month <= fyEnd).reduce((t, s) => t + ((weighted ? p.weighted_lkr : p.value_lkr) * s.pct) / 100, 0);
  const sumBy = (xs: Amt[], m: string) => xs.filter((x) => x.month.slice(0, 7) === m.slice(0, 7) && inScope(x.owner_id, x.line)).reduce((t, x) => t + Number(x.amount), 0);
  const target = (m: string) => data.targets.filter((t) => t.month.slice(0, 7) === m.slice(0, 7) && (!owner || t.owner_id === owner)).reduce((t, x) => t + Number(x.target ?? 0), 0);
  const rows = months.map((m) => {
    const inv = sumBy(data.invoiced, m);
    const sec = sumBy(data.secured, m);
    const pipe = projects.reduce((t, p) => t + amountIn(p, m), 0);
    const tgt = line ? 0 : target(m);
    return { m, inv, sec, pipe, total: inv + sec + pipe, tgt, past: m < data.this_month };
  });
  const tot = rows.reduce((t, r) => ({ inv: t.inv + r.inv, sec: t.sec + r.sec, pipe: t.pipe + r.pipe, total: t.total + r.total, tgt: t.tgt + r.tgt }), { inv: 0, sec: 0, pipe: 0, total: 0, tgt: 0 });
  const unweighted = projects.reduce((t, p) => t + thisFy(p, false), 0);
  const contributing = projects.filter((p) => thisFy(p) > 0).sort((a, b) => thisFy(b) - thisFy(a));
  const later = projects.filter((p) => thisFy(p) === 0);
  const flags = projects.filter((p) => p.no_value || p.award_from === 'none' || p.award_from === 'passed');
  const maxBar = Math.max(...rows.map((r) => r.total), 1) * 1.25;
  const s = data.settings;
  const owners = [...new Set(data.projects.map((p) => p.owner_id))];
  const filters = [owner ? people[owner]?.full_name : 'All sales persons', line ? lineLabel(line) : 'All business lines', minPct ? `win ≥ ${minPct}%` : 'all win %'].join(' · ');

  const editSettings = async () => {
    const r = await dialog.prompt({
      title: 'Forecast assumptions',
      message: 'Lead time from award to delivery on site, and how supply & installation projects are invoiced.',
      fields: [
        { key: 'eu_mfg_weeks', label: 'European – manufacturing (weeks)', required: true, initial: String(s.eu_mfg_weeks) },
        { key: 'eu_sea_weeks', label: 'European – sea freight (weeks)', required: true, initial: String(s.eu_sea_weeks) },
        { key: 'cn_mfg_weeks', label: 'Chinese – manufacturing (weeks)', required: true, initial: String(s.cn_mfg_weeks) },
        { key: 'cn_sea_weeks', label: 'Chinese – sea freight (weeks)', required: true, initial: String(s.cn_sea_weeks) },
        { key: 'clearing_weeks', label: 'Clearing and delivery to site (weeks)', required: true, initial: String(s.clearing_weeks) },
        { key: 'unknown_origin', label: 'Origin not known – take as', type: 'select', required: true, initial: String(s.unknown_origin), options: [{ value: 'european', label: 'European (slower)' }, { value: 'chinese', label: 'Chinese' }] },
        { key: 'material_pct', label: 'Supply & install – % on delivery (material)', required: true, initial: String(s.material_pct) },
        { key: 'install_pct', label: 'Supply & install – % over the installation months', required: true, initial: String(s.install_pct) },
        { key: 'retention_pct', label: 'Supply & install – retention % (after the DLP)', required: true, initial: String(s.retention_pct) },
        { key: 'dlp_months', label: 'Defects liability period (months)', required: true, initial: String(s.dlp_months) },
      ],
      confirmLabel: 'Save',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('save_forecast_settings', { p: r });
        await reload();
      }, 'Assumptions saved – the forecast is recalculated');
  };

  const projCols: Column<FP>[] = [
    { header: 'Project', value: (p) => [p.code, p.name].filter(Boolean).join(' ') },
    { header: 'Customer', value: (p) => p.customer },
    { header: 'Sales person', value: (p) => people[p.owner_id]?.full_name ?? '' },
    { header: 'Win %', value: (p) => p.win_probability, align: 'right' },
    { header: 'Value (LKR)', value: (p) => Math.round(p.value_lkr), align: 'right' },
    { header: 'Award', value: (p) => fmtDate(p.award_used) + (p.award_from === 'passed' ? ' (date passed)' : p.award_from === 'none' ? ' (no date)' : '') },
    { header: 'Origin', value: (p) => ORIGIN[p.origin] },
    { header: 'Basis', value: (p) => BASIS[p.basis] },
    { header: 'Delivery', value: (p) => fmtDate(p.delivery_date) },
    { header: 'This FY weighted (LKR)', value: (p) => Math.round(thisFy(p)), align: 'right' },
    { header: 'This FY at 100% (LKR)', value: (p) => Math.round(thisFy(p, false)), align: 'right' },
  ];
  const meta = (title: string) => ({
    key: 'invoicing_forecast',
    title,
    filters: `FY ${fy}/${String(fy + 1).slice(2)} · ${filters}`,
    generatedBy: `${me.full_name} – ${ROLE_SHORT[me.role]}`,
    landscape: true,
  });
  const exportIt = (kind: 'pdf' | 'excel') =>
    dialog.run(async () => {
      const monthCols: Column<(typeof rows)[number]>[] = [
        { header: 'Month', value: (r) => mLabel(r.m) },
        { header: 'Invoiced', value: (r) => Math.round(r.inv), align: 'right' },
        { header: 'Secured to invoice', value: (r) => Math.round(r.sec), align: 'right' },
        { header: 'Potential (weighted)', value: (r) => Math.round(r.pipe), align: 'right' },
        { header: 'Projected', value: (r) => Math.round(r.total), align: 'right' },
        { header: 'Target', value: (r) => Math.round(r.tgt), align: 'right' },
      ];
      if (kind === 'excel') {
        await exportExcel(meta('Invoicing forecast – projects'), projCols, [{ heading: 'Potential projects invoicing this FY', rows: contributing }]);
      } else {
        await exportPdf(meta('Invoicing forecast'), monthCols, [{ heading: 'By month', rows }]);
      }
    });

  return (
    <Screen maxWidth={1300} refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Invoicing forecast' }} />
      <Muted>
        What can be invoiced by 31 March: invoices already recorded, secured orders still to invoice, and potential projects – weighted by win %, from the expected award
        date, the manufacturing and freight lead time of their origin, and their basis (supply, or supply & installation).
      </Muted>
      <Card>
        <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
          <View style={{ width: 150 }}>
            <Select label="Financial year" value={String(fy)} onChange={(v) => setFy(Number(v))} options={[fy - 1, fyOf(todayISO()), fyOf(todayISO()) + 1].filter((v, i, a) => a.indexOf(v) === i).map((y) => ({ value: String(y), label: `${y}/${String(y + 1).slice(2)}` }))} />
          </View>
          {everyone ? (
            <View style={{ width: 230 }}>
              <Select label="Sales person" value={owner} searchable onChange={setOwner} options={[{ value: '', label: 'All sales persons' }, ...owners.map((o) => ({ value: o, label: people[o]?.full_name ?? '—' }))]} />
            </View>
          ) : null}
          <View style={{ width: 230 }}>
            <Select label="Business line" value={line} onChange={setLine} options={[{ value: '', label: 'All business lines' }, ...LINES.map((l) => ({ value: l.value, label: l.label }))]} />
          </View>
          <View>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 4 }}>Win %</Text>
            <Row gap={6}>
              {[0, 25, 50, 75].map((v) => (
                <Chip key={v} label={v ? `≥ ${v}%` : 'All'} on={minPct === v} onPress={() => setMinPct(v)} />
              ))}
            </Row>
          </View>
        </Row>
        <Row gap={8} style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <Button small variant="secondary" title="PDF" onPress={() => exportIt('pdf')} />
          <Button small variant="secondary" title="Excel" onPress={() => exportIt('excel')} />
        </Row>
      </Card>

      <Grid min={160} max={5}>
        <Stat label="Invoiced so far" value={big(tot.inv)} />
        <Stat label="Secured – still to invoice" value={big(tot.sec)} />
        <Stat label="Potential projects (weighted)" value={big(tot.pipe)} sub={`${big(unweighted)} if all are won`} />
        <Stat label="Projected for the year" value={big(tot.total)} tone={tot.tgt && tot.total < tot.tgt ? 'amber' : 'green'} />
        {tot.tgt ? <Stat label="Invoice target" value={big(tot.tgt)} sub={`${tot.total >= tot.tgt ? 'Ahead by' : 'Short by'} ${big(Math.abs(tot.total - tot.tgt))} (${Math.round((100 * tot.total) / tot.tgt)}% of target)`} tone={tot.total >= tot.tgt ? 'green' : 'red'} /> : null}
      </Grid>

      <Section title="Month by month">
        <Card>
          <Row gap={6} style={{ alignItems: 'flex-end', height: 184 }}>
            {rows.map((r) => (
              <View key={r.m} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                <Text style={{ fontSize: 10, color: colors.muted }}>{r.total ? lkrM(r.total) : ''}</Text>
                <View style={{ width: '70%', height: 120, justifyContent: 'flex-end' }}>
                  {r.tgt ? (
                    <View style={{ position: 'absolute', left: -4, right: -4, bottom: Math.min(120, (120 * r.tgt) / maxBar), height: 2, backgroundColor: colors.red }} />
                  ) : null}
                  <View style={{ height: (120 * r.pipe) / maxBar, backgroundColor: '#93C5FD' }} />
                  <View style={{ height: (120 * r.sec) / maxBar, backgroundColor: colors.blue }} />
                  <View style={{ height: (120 * r.inv) / maxBar, backgroundColor: colors.green }} />
                </View>
                <Text style={{ fontSize: 11, color: r.m === data.this_month ? colors.brand : colors.ink, fontWeight: r.m === data.this_month ? '700' : '400' }}>{mLabel(r.m)}</Text>
                <Text style={{ fontSize: 9, color: colors.red, minHeight: 12 }}>{r.tgt > maxBar ? `▲ ${lkrM(r.tgt)}` : ''}</Text>
              </View>
            ))}
          </Row>
          <Row wrap gap={10} style={{ marginTop: 6 }}>
            <Pill label="Invoiced" tone={colors.green} solid />
            <Pill label="Secured – to invoice" tone={colors.blue} solid />
            <Pill label="Potential (weighted)" tone="#60A5FA" />
            {tot.tgt ? <Pill label="— Invoice target (▲ under the month when above the chart)" tone={colors.red} /> : null}
          </Row>
        </Card>
        <DataTable
          rows={rows}
          keyOf={(r) => r.m}
          rowStyle={(r) => (r.past ? { opacity: 0.75 } : undefined)}
          columns={[
            { h: 'Month', w: 70, grow: true, v: (r) => mLabel(r.m), bold: true },
            { h: 'Invoiced (LKR)', w: 125, right: true, v: (r) => (r.inv ? n0(r.inv) : '–') },
            { h: 'Secured to invoice', w: 130, right: true, v: (r) => (r.sec ? n0(r.sec) : '–') },
            { h: 'Potential (weighted)', w: 135, right: true, v: (r) => (r.pipe ? n0(r.pipe) : '–') },
            { h: 'Projected', w: 130, right: true, bold: true, v: (r) => n0(r.total) },
            { h: 'Target', w: 130, right: true, v: (r) => (r.tgt ? n0(r.tgt) : '–') },
            { h: 'Gap', w: 130, right: true, tone: (r) => (r.tgt ? (r.total >= r.tgt ? colors.green : colors.red) : undefined), v: (r) => (r.tgt ? `${r.total >= r.tgt ? '+' : '−'}${n0(Math.abs(r.total - r.tgt))}` : '–') },
          ]}
          footer={['Year', n0(tot.inv), n0(tot.sec), n0(tot.pipe), n0(tot.total), tot.tgt ? n0(tot.tgt) : '–', tot.tgt ? `${tot.total >= tot.tgt ? '+' : '−'}${n0(Math.abs(tot.total - tot.tgt))}` : '–']}
        />
      </Section>

      <Section title={`Potential projects invoicing this year (${contributing.length})`}>
        <DataTable
          rows={contributing}
          keyOf={(p) => p.id}
          onPress={(p) => router.push(`/projects/${p.id}`)}
          columns={[
            { h: 'Project', w: 200, grow: true, v: (p) => <Text style={{ color: colors.ink }}>{`${p.name}\n`}<Text style={{ color: colors.muted, fontSize: 12 }}>{`${p.customer} · ${people[p.owner_id]?.full_name ?? ''}`}</Text></Text> },
            { h: 'Win %', w: 55, right: true, v: (p) => `${p.win_probability}%` },
            { h: 'Value (LKR)', w: 115, right: true, v: (p) => n0(p.value_lkr) },
            { h: 'Award', w: 95, v: (p) => fmtDate(p.award_used), tone: (p) => (p.award_from === 'passed' || p.award_from === 'none' ? colors.amber : undefined) },
            { h: 'Origin', w: 95, v: (p) => ORIGIN[p.origin] + (p.origin_from === 'default' ? ' *' : '') },
            { h: 'Basis', w: 115, v: (p) => BASIS[p.basis] + (p.basis_from === 'assumed' ? ' *' : '') },
            { h: 'Delivery', w: 95, v: (p) => fmtDate(p.delivery_date) },
            { h: 'This FY weighted (LKR)', w: 150, right: true, bold: true, v: (p) => n0(thisFy(p)) },
          ]}
          footer={['Total', '', n0(contributing.reduce((t, p) => t + p.value_lkr, 0)), '', '', '', '', n0(tot.pipe)]}
          emptyTitle="No potential project reaches invoicing this year"
        />
        <Muted>* assumed – the inquiry does not say (origin: European unless set below; basis: short-term projects as supply, others as supply & installation).</Muted>
        {later.length ? <Muted>{`${later.length} more potential project(s) invoice only after 31 March – ${big(later.reduce((t, p) => t + p.weighted_lkr, 0))} weighted.`}</Muted> : null}
      </Section>

      {flags.length ? (
        <Notice tone={colors.amber}>
          {`Check ${flags.length} project(s): ${flags.filter((p) => p.award_from === 'passed').length} with the award date passed (taken as today), ${flags.filter((p) => p.award_from === 'none').length} with no award or tender date (taken as today), ${flags.filter((p) => p.no_value).length} with no lighting value (counted as zero). Update them in Projects for a better forecast.`}
        </Notice>
      ) : null}

      <Section title="Assumptions" right={everyone ? <Button small variant="secondary" title="Change" onPress={editSettings} /> : null}>
        <Card style={{ gap: 4 }}>
          <Text style={{ color: colors.ink }}>{`European: ${s.eu_mfg_weeks} weeks manufacturing + ${s.eu_sea_weeks} weeks sea freight · Chinese: ${s.cn_mfg_weeks} + ${s.cn_sea_weeks} weeks · clearing and delivery ${s.clearing_weeks} week(s)`}</Text>
          <Text style={{ color: colors.ink }}>{`Origin from the brands quoted (any European brand → European), else the inquiry; not known → ${s.unknown_origin === 'chinese' ? 'Chinese' : 'European'}.`}</Text>
          <Text style={{ color: colors.ink }}>{`Supply: 100% on delivery. Supply & installation: ${s.material_pct}% on delivery, ${s.install_pct}% over the rest of the project duration, ${s.retention_pct}% retention after a ${s.dlp_months}-month DLP.`}</Text>
          <Muted>Award dates in the past, or missing, are taken as today. Only invoices recorded in the app count as invoiced.</Muted>
        </Card>
      </Section>
    </Screen>
  );
}
