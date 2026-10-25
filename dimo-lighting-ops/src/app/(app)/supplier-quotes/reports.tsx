import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { DataTable, type Column } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, DateField, ErrorBanner, Grid, Loading, Muted, Notice, Row, Screen, Segmented, Select, Stat } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { renderChartSvg } from '@/lib/charts';
import { esc, exportExcel, exportPdf } from '@/lib/export';
import { todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_SHORT } from '@/lib/roles';
import { rpc } from '@/lib/supabase';
import { filterText, loadReportData, PRICES_LABEL, REPORTS, runReport, WEIGHT_LABEL, WHO_LABEL, type Prices, type RCell, type Report, type ReportKey, type RFilters, type Weights, type Who } from '@/lib/supplierReports';

type Period = 'fy' | '12m' | 'q' | 'all' | 'custom';
const TONE = { good: { bg: '#E4F3EA', fg: '#1A6B41' }, warn: { bg: '#FDF0DC', fg: '#8A4B0F' }, bad: { bg: '#FBE6E4', fg: '#A1281C' } };

/** The financial year starts on 1 April */
function periodOf(p: Period, from: string, to: string) {
  const t = todayISO(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  if (p === 'fy') return { from: `${m >= 4 ? y : y - 1}-04-01`, to: t };
  if (p === '12m') return { from: `${y - 1}${t.slice(4)}`, to: t };
  if (p === 'q') { const d = new Date(Date.now() - 91 * 864e5).toISOString().slice(0, 10); return { from: d, to: t }; }
  if (p === 'all') return { from: '2000-01-01', to: t };
  return { from: from || t, to: to || t };
}

/** Supplier base reports for the GM / DGM, with the scorecard weights they set */
export default function SupplierReports() {
  const { realRole, profile } = useAuth();
  const dialog = useDialog();
  const { width } = useWindowDimensions();
  const { data, error, reload } = useLoad(loadReportData, []);
  const [key, setKey] = useState<ReportKey>('scorecard');
  const [period, setPeriod] = useState<Period>('fy');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [type, setType] = useState<RFilters['type']>('all');
  const [who, setWho] = useState<Who>('all');
  const [prices, setPrices] = useState<Prices>('final');
  const [item, setItem] = useState('');
  const [supplier, setSupplier] = useState('');
  const pr = periodOf(period, cFrom, cTo);
  // opens on the most-quoted item and supplier until one is picked
  const top = useMemo(() => {
    const n = new Map<string, number>(), it = new Map<string, number>();
    data?.quotes.forEach((q) => { n.set(q.supplier_id, (n.get(q.supplier_id) ?? 0) + 1); q.lines.forEach((l) => l.item_id && it.set(l.item_id, (it.get(l.item_id) ?? 0) + 1)); });
    const best = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { sup: best(n), item: best(it) ?? data?.items[0]?.id };
  }, [data]);
  const f: RFilters = { ...pr, type, who, prices, item: item || top.item, supplier: supplier || top.sup };
  const rep = useMemo<Report | null>(() => (data ? runReport(key, data, f) : null), [data, key, f.from, f.to, type, who, prices, f.item, supplier]); // eslint-disable-line react-hooks/exhaustive-deps
  if (realRole !== 'gm') return <Screen><Notice tone={colors.amber}>Supplier reports are for the GM / DGM.</Notice></Screen>;
  if (!data || !rep) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const def = REPORTS.find((r) => r.key === key)!;

  const setWeights = async () => {
    const w = data.weights;
    const r = await dialog.prompt({
      title: 'Scorecard weights',
      message: 'How much each part counts in the supplier score. They must add up to 100. Saved for everyone who opens the reports.',
      fields: (Object.keys(WEIGHT_LABEL) as (keyof Weights)[]).map((k) => ({ key: k, label: WEIGHT_LABEL[k], required: true, initial: String(w[k]) })),
      confirmLabel: 'Save weights',
    });
    if (!r) return;
    await dialog.run(async () => { await rpc('sq_set_weights', { p: r }); reload(); }, 'Weights saved');
  };
  const meta = () => ({
    key: `supplier_${key}`, title: def.title, filters: filterText(data, f), period: `${pr.from} to ${pr.to}`,
    currencyNote: 'LKR delivered – freight, discounts and priced-back exclusions included', generatedBy: `${profile?.full_name ?? ''} – ${profile ? ROLE_SHORT[profile.role] : ''}`, landscape: true,
  });
  const cellText = (c: RCell) => (c.sub ? `${c.t} (${c.sub})` : c.t);
  const pdf = () => {
    const tiles = rep.tiles.length ? `<table style="margin-bottom:10px"><tr>${rep.tiles.map((t) => `<td style="border:1px solid #ddd;padding:6px"><b style="font-size:13px">${esc(t.value)}</b><br/>${esc(t.label)}</td>`).join('')}</tr></table>` : '';
    const chart = rep.chart ? `<div style="margin:8px 0">${renderChartSvg(rep.chart)}</div>` : '';
    const tables = rep.tables.map((t) => `${t.title ? `<h2 style="background:#F2F2F2">${esc(t.title)}</h2>` : ''}<table><thead><tr>${t.head.map((h) => `<th style="text-align:${h.right ? 'right' : 'left'}">${esc(h.h)}</th>`).join('')}</tr></thead><tbody>${
      t.rows.length ? t.rows.map((r) => `<tr>${r.cells.map((c, i) => `<td style="text-align:${t.head[i]?.right ? 'right' : 'left'}">${esc(c.t)}${c.sub ? `<br/><span style="color:#666">${esc(c.sub)}</span>` : ''}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${t.head.length}">${esc(t.empty)}</td></tr>`}</tbody></table>`).join('');
    const note = rep.note ? `<p style="color:#555">${esc(rep.note)}</p>` : '';
    return exportPdf(meta(), [], [], `<p>${esc(def.q)}</p>${tiles}${chart}${tables}${note}`);
  };
  const excel = () => {
    const n = Math.max(2, ...rep.tables.map((t) => t.head.length));
    const cols = Array.from({ length: n }, (_, i) => ({ header: '', value: (r: string[]) => r[i] ?? '', width: i ? 18 : 40 }));
    const sections = [
      ...(rep.tiles.length ? [{ heading: 'Summary', rows: rep.tiles.map((t) => [t.label, t.value]) }] : []),
      ...rep.tables.map((t) => ({ heading: t.title ?? def.title, rows: [t.head.map((h) => h.h), ...t.rows.map((r) => r.cells.map(cellText))] })),
    ];
    return exportExcel(meta(), cols, sections);
  };

  return (
    <Screen maxWidth={1400}>
      <Stack.Screen options={{ title: 'Supplier reports' }} />
      <Segmented value={key} onChange={setKey} options={REPORTS.map((r) => ({ value: r.key, label: r.title }))} wrap />
      <Card>
        <Row wrap gap={10} style={{ alignItems: 'flex-end' }}>
          <View style={{ minWidth: 200, flexGrow: 1 }}><Select label="Period" value={period} onChange={(v) => setPeriod(v as Period)} options={[{ value: 'fy', label: 'This financial year' }, { value: '12m', label: 'Last 12 months' }, { value: 'q', label: 'Last 3 months' }, { value: 'all', label: 'All time' }, { value: 'custom', label: 'Choose dates…' }]} /></View>
          {period === 'custom' ? <View style={{ minWidth: 170 }}><DateField label="From" value={cFrom} onChange={(v) => setCFrom(v ?? '')} /></View> : null}
          {period === 'custom' ? <View style={{ minWidth: 170 }}><DateField label="To" value={cTo} onChange={(v) => setCTo(v ?? '')} /></View> : null}
          <View style={{ minWidth: 180, flexGrow: 1 }}><Select label="Package type" value={type} onChange={(v) => setType(v as RFilters['type'])} options={[{ value: 'all', label: 'Supply and subcontract' }, { value: 'supply', label: 'Supply' }, { value: 'subcontract', label: 'Subcontract' }]} /></View>
          {key !== 'profile' ? <View style={{ minWidth: 180, flexGrow: 1 }}><Select label="Suppliers" value={who} onChange={(v) => setWho(v as Who)} options={(Object.keys(WHO_LABEL) as Who[]).map((k) => ({ value: k, label: WHO_LABEL[k] }))} /></View> : null}
          <View style={{ minWidth: 220, flexGrow: 1 }}><Select label="Prices from" value={prices} onChange={(v) => setPrices(v as Prices)} options={(Object.keys(PRICES_LABEL) as Prices[]).map((k) => ({ value: k, label: PRICES_LABEL[k] }))} /></View>
          {key === 'prices' ? <View style={{ minWidth: 260, flexGrow: 2 }}><Select label="Item" searchable value={f.item ?? ''} onChange={setItem} options={data.items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }))} /></View> : null}
          {key === 'profile' ? <View style={{ minWidth: 260, flexGrow: 2 }}><Select label="Supplier" searchable value={f.supplier ?? ''} onChange={setSupplier} options={data.sups.map((s) => ({ value: s.id, label: s.name }))} /></View> : null}
        </Row>
        <Row wrap gap={8} style={{ marginTop: 8 }}>
          <Button variant="secondary" small title={`Scorecard weights ${data.weights.price}/${data.weights.spec}/${data.weights.lead}/${data.weights.response}/${data.weights.terms}`} onPress={setWeights} />
          <Button variant="secondary" small title="Export PDF" onPress={() => dialog.run(pdf)} />
          <Button variant="secondary" small title="Export Excel" onPress={() => dialog.run(excel)} />
        </Row>
      </Card>
      <View>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{def.title}</Text>
        <Muted>{def.q}</Muted>
      </View>
      {rep.tiles.length ? <Grid min={200} max={4}>{rep.tiles.map((t) => <Stat key={t.label} label={t.label} value={t.value} tone={t.tone} sub={t.sub} />)}</Grid> : null}
      {rep.chart ? <Card><SvgXml xml={renderChartSvg({ ...rep.chart, w: Math.min(width - 80, 1200) })} width={Math.min(width - 80, 1200)} height={rep.chart.h} /></Card> : null}
      {rep.tables.map((t, ti) => {
        const cols: Column<(typeof t.rows)[number]>[] = t.head.map((h, i) => ({
          h: h.h, w: h.w, grow: h.grow, right: h.right,
          v: (r) => {
            const c = r.cells[i];
            if (!c) return '';
            const tn = c.tone ? TONE[c.tone] : null;
            return (
              <View style={{ backgroundColor: tn?.bg, borderRadius: 6, padding: tn ? 4 : 0, alignSelf: h.right ? 'flex-end' : 'stretch' }}>
                <Text style={{ color: tn?.fg ?? colors.ink, fontWeight: i === 0 ? '600' : '500', textAlign: h.right ? 'right' : 'left' }}>{c.t}</Text>
                {c.sub ? <Muted>{c.sub}</Muted> : null}
              </View>
            );
          },
        }));
        return (
          <View key={ti} style={{ gap: 4 }}>
            {t.title ? <Text style={{ fontWeight: '700', color: colors.ink, marginTop: 6 }}>{t.title}</Text> : null}
            <DataTable rows={t.rows} keyOf={(r) => r.key} columns={cols} emptyTitle={t.empty} onPress={(r) => (r.href ? router.push(r.href as never) : undefined)} />
          </View>
        );
      })}
      {rep.note ? <Muted>{rep.note}</Muted> : null}
    </Screen>
  );
}
