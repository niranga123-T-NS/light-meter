import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { AgeBars, LineAge, lkr, lkrM, VALUE_ROLES } from '@/components/StockBits';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, Grid, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtNumber } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_SHORT } from '@/lib/roles';
import { bandOf, oldestBand, type Snapshot, type StockLine } from '@/lib/stock';
import { exportStock } from '@/lib/stockExport';
import { rpc } from '@/lib/supabase';

const aged1y = (l: StockLine) => l.q4 + l.q5 + l.q6;
const aged1yValue = (l: StockLine) => (l.v4 ?? 0) + (l.v5 ?? 0) + (l.v6 ?? 0);

/** SAP stock: the monthly ageing report – totals, value / quantity by age, categories, the oldest items and the trend. */
export default function StockDashboard() {
  const me = useMe();
  const dialog = useDialog();
  const params = useLocalSearchParams<{ s?: string }>();
  const values = VALUE_ROLES.includes(me.role);
  const ops = me.role === 'operations_exec';
  const { data, error } = useLoad(async () => {
    const snaps = await rpc<Snapshot[]>('stock_snapshot_list');
    const cur = snaps.find((s) => s.id === params.s) ?? snaps[0];
    const lines = cur ? await rpc<StockLine[]>('stock_lines', { p_snapshot: cur.id }) : [];
    return { snaps, cur, lines };
  }, [params.s]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { snaps, cur, lines } = data;

  const header = (
    <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
      {snaps.length ? (
        <View style={{ minWidth: 220 }}>
          <Select
            label="As at"
            value={cur?.id ?? null}
            onChange={(v) => router.setParams({ s: v })}
            options={snaps.map((s) => ({ value: s.id, label: `${fmtDate(s.as_at)} · PC ${s.profit_center}` }))}
          />
        </View>
      ) : null}
      {ops ? <Button title="Upload SAP report" icon="⇪" onPress={() => router.push('/stock/upload')} /> : null}
      {cur ? <Button variant="secondary" title="Stock list" onPress={() => router.push({ pathname: '/stock/list', params: { s: cur.id } })} /> : null}
      {cur ? (
        <>
          <Button variant="secondary" title="Ageing PDF" onPress={() => dialog.run(() => exportStock('pdf', cur.as_at, lines, values, 'All items', `${me.full_name} – ${ROLE_SHORT[me.role]}`))} />
          <Button variant="secondary" title="Excel" onPress={() => dialog.run(() => exportStock('excel', cur.as_at, lines, values, 'All items', `${me.full_name} – ${ROLE_SHORT[me.role]}`))} />
        </>
      ) : null}
    </Row>
  );
  if (!cur)
    return (
      <Screen maxWidth={1100}>
        <Stack.Screen options={{ title: 'Stock (SAP)' }} />
        {header}
        <Card>
          <Empty title="No SAP stock report yet" hint={ops ? 'Upload the monthly SAP stock ageing report (Excel) as it comes from SAP.' : 'The Operations Executive uploads the SAP stock report every month.'} />
        </Card>
      </Screen>
    );

  const prev = snaps.find((s) => s.as_at < cur.as_at && s.profit_center === cur.profit_center);
  const totalQty = lines.reduce((a, l) => a + Number(l.qty), 0);
  const old1yQty = lines.reduce((a, l) => a + aged1y(l), 0);
  const old2yQty = lines.reduce((a, l) => a + l.q6, 0);
  const newItems = lines.filter((l) => l.prev_qty == null);
  const uncategorised = lines.filter((l) => !l.corrected && l.flags.includes('uncategorised'));
  const change = values && prev?.total_value ? (100 * ((cur.total_value ?? 0) - prev.total_value)) / prev.total_value : null;

  // By category (with Operations' corrections)
  const cats = new Map<string, StockLine[]>();
  for (const l of lines) {
    const k = l.category || 'Not set';
    cats.set(k, [...(cats.get(k) ?? []), l]);
  }
  const catRows = [...cats.entries()]
    .map(([k, ls]) => ({ k, n: ls.length, qty: ls.reduce((a, l) => a + Number(l.qty), 0), value: values ? ls.reduce((a, l) => a + Number(l.value ?? 0), 0) : null, old: ls.reduce((a, l) => a + (values ? aged1yValue(l) : aged1y(l)), 0) }))
    .sort((a, b) => (values ? (b.value ?? 0) - (a.value ?? 0) : b.qty - a.qty));
  const oldest = [...lines].sort((a, b) => (values ? (b.v6 ?? 0) - (a.v6 ?? 0) || (b.value ?? 0) - (a.value ?? 0) : b.q6 - a.q6 || b.q5 - a.q5)).slice(0, 10);
  const trend = [...snaps].filter((s) => s.profit_center === cur.profit_center).slice(0, 12).reverse();
  const tmax = Math.max(...trend.map((s) => (values ? (s.total_value ?? 0) : s.total_qty)), 1);

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: 'Stock (SAP)' }} />
      {header}
      <Muted>{`SAP stock ageing report · profit centre ${cur.profit_center} · as at ${fmtDate(cur.as_at)} · uploaded ${fmtDate(cur.confirmed_at)}${cur.replace_reason ? ` · replaced: ${cur.replace_reason}` : ''}`}</Muted>
      <Grid min={180} max={5}>
        <Stat label="Items" value={fmtNumber(cur.item_count)} sub={newItems.length && prev ? `${newItems.length} new since ${fmtDate(prev.as_at)}` : undefined} />
        <Stat label="Quantity" value={fmtNumber(totalQty, 2)} />
        {values ? <Stat label="Closing value" value={lkrM(cur.total_value)} sub={change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs ${fmtDate(prev?.as_at)}` : undefined} /> : null}
        <Stat
          label="Older than 1 year"
          tone="amber"
          value={values ? lkrM(cur.aged_1y_value) : fmtNumber(old1yQty, 2)}
          sub={`${Math.round((100 * (values ? (cur.aged_1y_value ?? 0) : old1yQty)) / ((values ? cur.total_value : totalQty) || 1))}% of ${values ? 'value' : 'quantity'}`}
        />
        <Stat
          label="Older than 2 years"
          tone="red"
          value={values ? lkrM(cur.aged_2y_value) : fmtNumber(old2yQty, 2)}
          sub={`${Math.round((100 * (values ? (cur.aged_2y_value ?? 0) : old2yQty)) / ((values ? cur.total_value : totalQty) || 1))}% of ${values ? 'value' : 'quantity'}`}
        />
      </Grid>
      {uncategorised.length ? (
        <Notice tone={colors.amber}>
          {`${uncategorised.length} item(s) have no proper SAP category ("Other" / <dummy>).${ops ? ' Correct them in the stock list – the correction is kept for every month.' : ''}`}
        </Notice>
      ) : null}

      <Section title="By age">
        <Card>
          <AgeBars lines={lines} byValue={values} />
        </Card>
      </Section>

      <Section title={`Oldest stock – top 10 by ${values ? 'value over 720 days' : 'quantity over 720 days'}`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {oldest.map((l) => (
            <ListRow
              key={l.material}
              wrapRight
              title={l.description ?? l.material}
              subtitle={
                <>
                  <Muted>{[l.material, l.mpn, [l.category, l.brand].filter(Boolean).join(' · ')].filter(Boolean).join(' · ')}</Muted>
                  <LineAge line={l} />
                </>
              }
              right={
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{values ? lkr(l.v6) : `${fmtNumber(l.q6, 2)} ${l.uom ?? ''}`}</Text>
                  <Pill label={bandOf(oldestBand(l)).label} tone={bandOf(oldestBand(l)).tone} />
                </View>
              }
              onPress={() => router.push({ pathname: '/stock/[material]', params: { material: l.material, s: cur.id } })}
            />
          ))}
        </Card>
      </Section>

      <Section title="By category">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {catRows.map((c) => (
            <ListRow
              key={c.k}
              title={c.k}
              subtitle={`${c.n} items · ${fmtNumber(c.qty, 2)} units${values ? ` · ${lkr(c.value)}` : ''}`}
              right={<Pill label={`${Math.round((100 * c.old) / ((values ? c.value : c.qty) || 1))}% over 1 year`} tone={c.old ? colors.amber : colors.green} />}
              onPress={() => router.push({ pathname: '/stock/list', params: { s: cur.id, category: c.k } })}
            />
          ))}
        </Card>
      </Section>

      {trend.length > 1 ? (
        <Section title="Month by month">
          <Card>
            <Row gap={10} style={{ alignItems: 'flex-end', height: 150 }}>
              {trend.map((s) => {
                const v = values ? (s.total_value ?? 0) : s.total_qty;
                const old = values ? (s.aged_1y_value ?? 0) : 0;
                return (
                  <View key={s.id} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{values ? `${(v / 1e6).toFixed(1)}M` : fmtNumber(v)}</Text>
                    <View style={{ width: '70%', height: Math.max(4, (110 * v) / tmax), backgroundColor: s.id === cur.id ? colors.brand : '#94A3B8', borderRadius: 4, overflow: 'hidden', justifyContent: 'flex-end' }}>
                      {values && v ? <View style={{ height: `${(100 * old) / v}%`, backgroundColor: '#00000033' }} /> : null}
                    </View>
                    <Text style={{ fontSize: 11, color: colors.ink }}>{new Date(`${s.as_at}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}</Text>
                  </View>
                );
              })}
            </Row>
            <Muted>{values ? 'Closing value per month; the darker part is stock older than 1 year' : 'Quantity per month'}</Muted>
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
