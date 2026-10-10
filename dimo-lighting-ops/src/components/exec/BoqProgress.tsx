import { useState } from 'react';
import { View } from 'react-native';
import { DataTable, type Column } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Chip, colors, Grid, Muted, Notice, Row, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { bySection, type BoqProgress } from '@/lib/boq';
import type { ExecProject } from '@/lib/execution';
import { exportExcel } from '@/lib/export';
import { fmtMonth } from '@/lib/finance';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

type Item = BoqProgress['items'][number];
const n = (v?: number | null) => (v == null ? '' : fmtNumber(Number(v), 2));
const period = (i: Item) => (i.to_date == null ? null : Number(i.to_date) - Number(i.prev ?? 0));
const pct = (i: Item) => (i.qty && i.to_date != null ? Math.round((100 * Number(i.to_date)) / Number(i.qty)) : null);

/**
 * Progress on the BOQ items – what the SEE raises in SAP: contract quantity, measured to date, this period and what the
 * client / consultant certified (their adjustments). Approved variations (non-BOQ items) are shown separately.
 * Rates and values only for the billing roles.
 */
export function BoqProgressView({ p, money }: { p: ExecProject; money: boolean }) {
  const me = useMe();
  const dialog = useDialog();
  const [only, setOnly] = useState(false);
  const { data } = useLoad(() => rpc<BoqProgress>('boq_progress', { p_exec: p.id }), [p.id]);
  if (!data) return <Muted>Loading…</Muted>;
  if (!data.items.length) return <Notice tone={colors.amber}>No approved contract BOQ yet – upload the priced BOQ; progress is then measured per item.</Notice>;

  const measured = (i: Item) => i.heading || i.to_date != null || i.cert != null;
  const rows = data.items.filter((i) => !only || measured(i));
  const contract = rows.filter((i) => i.source === 'boq');
  const vars = rows.filter((i) => i.source === 'variation');
  const val = (i: Item, q?: number) => (q == null ? 0 : q * Number(i.rate ?? 0));
  const sum = (xs: Item[], f: (i: Item) => number) => xs.filter((i) => !i.heading).reduce((s, i) => s + f(i), 0);
  const all = data.items.filter((i) => !i.heading);
  const boqTotal = sum(all.filter((i) => i.source === 'boq'), (i) => Number(i.amount ?? 0));
  const varTotal = sum(all.filter((i) => i.source === 'variation'), (i) => Number(i.amount ?? 0));
  const toDate = sum(all, (i) => val(i, i.to_date));
  const thisPeriod = sum(all, (i) => val(i, period(i) ?? undefined));
  const certVal = sum(all, (i) => val(i, i.cert));

  const columns: Column<Item>[] = [
    { h: 'Item', w: 80, v: (i) => i.item_no ?? '', bold: true },
    { h: 'Description', w: 300, v: (i) => i.description, bold: false },
    { h: 'Unit', w: 55, v: (i) => (i.heading ? '' : (i.unit ?? '')) },
    { h: 'BOQ qty', w: 85, right: true, v: (i) => n(i.qty) },
    { h: 'Previous', w: 85, right: true, v: (i) => n(i.prev) },
    { h: 'To date', w: 85, right: true, v: (i) => n(i.to_date), bold: true, tone: (i) => (i.qty != null && Number(i.to_date ?? 0) > Number(i.qty) ? colors.amber : undefined) },
    { h: 'This period', w: 95, right: true, v: (i) => (period(i) ? n(period(i)) : ''), tone: (i) => (period(i) ? colors.blue : undefined) },
    { h: 'Certified', w: 85, right: true, v: (i) => n(i.cert), tone: (i) => (i.cert != null && i.to_date != null && Number(i.cert) !== Number(i.to_date) ? colors.amber : colors.green) },
    { h: '% done', w: 70, right: true, v: (i) => (pct(i) == null ? '' : `${pct(i)}%`) },
    ...(money
      ? ([
          { h: 'Rate', w: 105, right: true, v: (i) => n(i.rate) },
          { h: 'Value to date', w: 125, right: true, v: (i) => (i.to_date == null ? '' : n(val(i, i.to_date))) },
          { h: 'Certified value', w: 125, right: true, v: (i) => (i.cert == null ? '' : n(val(i, i.cert))) },
        ] as Column<Item>[])
      : []),
  ];
  const table = (items: Item[], key: string) => (
    <DataTable
      key={key}
      rows={items}
      keyOf={(i) => i.id}
      edge={(i) => (i.heading ? undefined : period(i) ? colors.blue : undefined)}
      rowStyle={(i) => (i.heading ? { backgroundColor: colors.soft } : undefined)}
      columns={columns}
      emptyTitle="No progress on these items yet"
      footer={
        money
          ? ['', 'Total', '', '', '', '', '', '', '', '', fmtNumber(sum(items, (i) => val(i, i.to_date)), 2), fmtNumber(sum(items, (i) => val(i, i.cert)), 2)]
          : undefined
      }
    />
  );

  const exportSap = () =>
    dialog.run(async () => {
      const cols = [
        { header: 'Item', value: (i: Item) => i.item_no ?? '', width: 10 },
        { header: 'Description', value: (i: Item) => i.description, width: 50 },
        { header: 'Unit', value: (i: Item) => (i.heading ? '' : (i.unit ?? '')), width: 8 },
        { header: 'BOQ qty', value: (i: Item) => (i.qty == null ? null : Number(i.qty)), width: 12 },
        { header: 'Previous', value: (i: Item) => (i.prev == null ? null : Number(i.prev)), width: 12 },
        { header: 'To date', value: (i: Item) => (i.to_date == null ? null : Number(i.to_date)), width: 12 },
        { header: 'This period', value: (i: Item) => period(i), width: 12 },
        { header: 'Certified', value: (i: Item) => (i.cert == null ? null : Number(i.cert)), width: 12 },
        ...(money
          ? [
              { header: 'Rate', value: (i: Item) => (i.rate == null ? null : Number(i.rate)), width: 14 },
              { header: 'Value to date', value: (i: Item) => (i.to_date == null ? null : Math.round(val(i, i.to_date) * 100) / 100), width: 16 },
              { header: 'Certified value', value: (i: Item) => (i.cert == null ? null : Math.round(val(i, i.cert) * 100) / 100), width: 16 },
            ]
          : []),
      ];
      const groups = [...bySection(data.items.filter((i) => i.source === 'boq')), ...bySection(data.items.filter((i) => i.source === 'variation'))];
      await exportExcel(
        {
          key: 'boq_progress',
          title: `BOQ progress – ${p.code ?? ''} ${p.name}`,
          filters: `${data.last ? `Last measurement ${data.last.code} (${fmtMonth(data.last.period)})` : 'No measurement yet'}${data.certified ? ` · last certified ${data.certified.code}` : ''}`,
          generatedBy: `${me.full_name}`,
        },
        cols,
        groups.map((g) => ({ heading: g.items[0]?.source === 'variation' ? `Approved variation – ${g.section}` : g.section, rows: g.items })),
      );
    }, 'Downloaded');

  return (
    <View style={{ gap: 8 }}>
      {money ? (
        <Grid min={160}>
          <Stat label="Contract BOQ" value={fmtMoney(boqTotal, 'LKR')} />
          <Stat label="Approved variations" value={fmtMoney(varTotal, 'LKR')} />
          <Stat label={`Measured to date${data.last ? ` (${data.last.code})` : ''}`} value={fmtMoney(toDate, 'LKR')} sub={`${boqTotal + varTotal ? Math.round((100 * toDate) / (boqTotal + varTotal)) : 0}% of BOQ + variations`} />
          <Stat label="This period" value={fmtMoney(thisPeriod, 'LKR')} tone={thisPeriod > 0 ? 'green' : undefined} />
          <Stat label={`Certified to date${data.certified?.cert_date ? ` (${fmtDate(data.certified.cert_date)})` : ''}`} value={fmtMoney(Number(data.certified_total ?? certVal), 'LKR')} />
        </Grid>
      ) : null}
      <Row wrap gap={6} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Row gap={6}>
          <Chip label="All items" on={!only} onPress={() => setOnly(false)} />
          <Chip label="With progress" on={only} onPress={() => setOnly(true)} />
        </Row>
        <Button small variant="secondary" title="Export for SAP (Excel)" onPress={exportSap} />
      </Row>
      <Muted>
        {`${data.last ? `Measured to date: ${data.last.code} · ${fmtMonth(data.last.period)}` : 'Not measured yet'}${data.certified ? ` · certified: ${data.certified.code}` : ''}. Amber = the client / consultant adjusted the quantity; blue = progress this period.`}
      </Muted>
      <Section title="Contract BOQ">{table(contract, 'boq')}</Section>
      <Section title={`Approved variations – non-BOQ items (${vars.filter((i) => !i.heading).length})`}>
        {vars.length ? table(vars, 'var') : <Muted>None yet – a variation goes here when the client / consultant approves it.</Muted>}
      </Section>
    </View>
  );
}
