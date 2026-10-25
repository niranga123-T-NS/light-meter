import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { ReportBody, reportExcel, reportPdf } from '@/components/SqReportView';
import { Button, Card, colors, DateField, ErrorBanner, Loading, Muted, Notice, Row, Screen, Segmented, Select } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_SHORT } from '@/lib/roles';
import { rpc } from '@/lib/supabase';
import { filterText, loadReportData, PRICES_LABEL, REPORTS, runReport, WEIGHT_LABEL, WHO_LABEL, type Prices, type Report, type ReportKey, type RFilters, type Weights, type Who } from '@/lib/supplierReports';

type Period = 'fy' | '12m' | 'q' | 'all' | 'custom';

/** The financial year starts on 1 April */
function periodOf(p: Period, from: string, to: string) {
  const t = todayISO(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  if (p === 'fy') return { from: `${m >= 4 ? y : y - 1}-04-01`, to: t };
  if (p === '12m') return { from: `${y - 1}${t.slice(4)}`, to: t };
  if (p === 'q') { const d = new Date(Date.now() - 91 * 864e5).toISOString().slice(0, 10); return { from: d, to: t }; }
  if (p === 'all') return { from: '2000-01-01', to: t };
  return { from: from || t, to: to || t };
}

/** Supplier base reports for the DGM, with the scorecard weights they set */
export default function SupplierReports() {
  const { realRole, profile, sqReports } = useAuth();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(loadReportData, []);
  const params = useLocalSearchParams<{ r?: string }>();
  const [key, setKey] = useState<ReportKey>(REPORTS.some((x) => x.key === params.r) ? (params.r as ReportKey) : 'projects');
  const [period, setPeriod] = useState<Period>('fy');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [type, setType] = useState<RFilters['type']>('all');
  const [who, setWho] = useState<Who>('all');
  const [prices, setPrices] = useState<Prices>('final');
  const [item, setItem] = useState('');
  const [supplier, setSupplier] = useState('');
  const [itemSup, setItemSup] = useState('');
  const pr = periodOf(period, cFrom, cTo);
  // opens on the most-quoted item and supplier until one is picked
  const top = useMemo(() => {
    const n = new Map<string, number>(), it = new Map<string, number>();
    data?.quotes.forEach((q) => { n.set(q.supplier_id, (n.get(q.supplier_id) ?? 0) + 1); q.lines.forEach((l) => l.item_id && it.set(l.item_id, (it.get(l.item_id) ?? 0) + 1)); });
    const best = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { sup: best(n), item: best(it) ?? data?.items[0]?.id };
  }, [data]);
  const f: RFilters = { ...pr, type, who, prices, item: item || top.item, supplier: supplier || top.sup, itemSupplier: itemSup || undefined };
  const rep = useMemo<Report | null>(() => (data ? runReport(key, data, f) : null), [data, key, f.from, f.to, type, who, prices, f.item, supplier, itemSup]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sqReports) return <Screen><Notice tone={colors.amber}>Supplier reports are for the DGM, the SM Estimation and the people the DGM allows.</Notice></Screen>;
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
  const pdf = () => reportPdf(rep, meta(), def.q);
  const excel = () => reportExcel(rep, meta());

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
          {key === 'prices' ? <View style={{ minWidth: 240, flexGrow: 1 }}><Select label="Focus on (optional)" searchable value={itemSup} onChange={(v) => setItemSup(v ?? '')} options={[{ value: '', label: 'All suppliers and manufacturers' }, ...data.sups.map((s) => ({ value: s.id, label: s.name }))]} /></View> : null}
          {key === 'profile' ? <View style={{ minWidth: 260, flexGrow: 2 }}><Select label="Supplier" searchable value={f.supplier ?? ''} onChange={setSupplier} options={data.sups.map((s) => ({ value: s.id, label: s.name }))} /></View> : null}
        </Row>
        <Row wrap gap={8} style={{ marginTop: 8 }}>
          {realRole === 'gm' ? <Button variant="secondary" small title={`Scorecard weights ${data.weights.price}/${data.weights.spec}/${data.weights.lead}/${data.weights.response}/${data.weights.terms}`} onPress={setWeights} /> : <Muted>{`Scorecard weights ${data.weights.price}/${data.weights.spec}/${data.weights.lead}/${data.weights.response}/${data.weights.terms} – set by the DGM`}</Muted>}
          <Button variant="secondary" small title="Export PDF" onPress={() => dialog.run(pdf)} />
          <Button variant="secondary" small title="Export Excel" onPress={() => dialog.run(excel)} />
        </Row>
      </Card>
      <View>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{def.title}</Text>
        <Muted>{def.q}</Muted>
      </View>
      <ReportBody rep={rep} />
    </Screen>
  );
}
