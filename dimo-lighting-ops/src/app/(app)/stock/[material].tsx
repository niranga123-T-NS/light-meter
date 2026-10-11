import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { AgeBars, lkr, VALUE_ROLES } from '@/components/StockBits';
import { TestingBanner } from '@/components/Testing';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, Grid, KeyValue, ListRow, Loading, Muted, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtNumber } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { AGE_BANDS, bandOf, flagLabel, oldestBand, type Snapshot, type StockLine } from '@/lib/stock';
import { rpc } from '@/lib/supabase';

type Hist = { as_at: string; qty: number; value: number | null; q1: number; q2: number; q3: number; q4: number; q5: number; q6: number };

/** One material: this month's ageing, its history across the monthly reports, and Operations' category correction. */
export default function StockItem() {
  const { material, s } = useLocalSearchParams<{ material: string; s?: string }>();
  const me = useMe();
  const dialog = useDialog();
  const values = VALUE_ROLES.includes(me.role);
  const ops = me.role === 'operations_exec';
  const { data, error, reload } = useLoad(async () => {
    const snaps = await rpc<Snapshot[]>('stock_snapshot_list');
    const cur = snaps.find((x) => x.id === s) ?? snaps[0];
    const [lines, hist] = await Promise.all([cur ? rpc<StockLine[]>('stock_lines', { p_snapshot: cur.id }) : [], rpc<Hist[]>('stock_item_history', { p_material: material })]);
    return { cur, line: lines.find((l) => l.material === material) ?? null, hist };
  }, [material, s]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { cur, line, hist } = data;
  if (!line || !cur) return <Screen><Empty title="Not in this month's stock report" hint={hist.length ? `Last seen ${fmtDate(hist[hist.length - 1].as_at)}` : undefined} /></Screen>;

  const correct = async () => {
    const r = await dialog.prompt({
      title: 'Correct the category',
      message: `${line.description ?? line.material} – SAP's classification is often wrong. The correction is kept by material number for every month. Leave all empty to go back to SAP's.`,
      fields: [
        { key: 'category', label: 'Category', initial: line.category ?? '' },
        { key: 'sub_category', label: 'Sub-category', initial: line.sub_category ?? '' },
        { key: 'class', label: 'Class', initial: line.class ?? '' },
        { key: 'sub_class', label: 'Sub-class', initial: line.sub_class ?? '' },
        { key: 'brand', label: 'Brand', initial: line.brand ?? '' },
        { key: 'note', label: 'Note', type: 'multiline' },
      ],
      confirmLabel: 'Save',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('set_stock_override', { p_material: line.material, p: r });
        await reload();
      }, 'Saved – applies to every month');
  };
  const ob = bandOf(oldestBand(line));

  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: line.description ?? line.material }} />
      <TestingBanner what="Stock (SAP)" always />
      <Card>
        <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, flexShrink: 1 }}>{line.description}</Text>
          <Pill label={`Oldest: ${ob.label}`} tone={ob.tone} solid />
        </Row>
        <Grid min={200} max={3}>
          <KeyValue label="Material (SAP)" value={line.material} />
          <KeyValue label="Old material no." value={line.old_material ?? '—'} />
          <KeyValue label="Manufacturer part no." value={line.mpn ?? '—'} />
          <KeyValue label="Category" value={[line.category, line.sub_category, line.class, line.sub_class].filter(Boolean).join(' › ') + (line.corrected ? ' (corrected)' : '') || '—'} />
          <KeyValue label="Brand" value={line.brand ?? '—'} />
          <KeyValue label={`Closing stock · ${fmtDate(cur.as_at)}`} value={`${fmtNumber(line.qty, 2)} ${line.uom ?? ''}${line.prev_qty != null ? ` (last month ${fmtNumber(line.prev_qty, 2)})` : ' · new this month'}`} />
          {values ? <KeyValue label="Closing value" value={lkr(line.value)} /> : null}
          {values ? <KeyValue label="Unit cost" value={lkr(line.unit_cost)} /> : null}
        </Grid>
        {line.flags.length ? (
          <Row gap={4} wrap>
            {line.flags.map((f) => (
              <Pill key={f} label={flagLabel[f]?.label ?? f} tone={flagLabel[f]?.tone} />
            ))}
          </Row>
        ) : null}
        {ops ? <Button variant="secondary" title="Correct category / brand" onPress={correct} /> : null}
      </Card>
      <Section title="By age">
        <Card>
          <AgeBars lines={[line]} byValue={values} />
        </Card>
      </Section>
      <Section title={`History (${hist.length} month${hist.length === 1 ? '' : 's'})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {[...hist].reverse().map((h) => (
            <ListRow
              key={h.as_at}
              title={fmtDate(h.as_at)}
              subtitle={AGE_BANDS.filter((b) => Number(h[`q${b.key}` as const]) > 0)
                .map((b) => `${b.short}: ${fmtNumber(Number(h[`q${b.key}` as const]), 2)}`)
                .join(' · ')}
              right={
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{`${fmtNumber(h.qty, 2)} ${line.uom ?? ''}`}</Text>
                  {values ? <Muted>{lkr(h.value)}</Muted> : null}
                </View>
              }
            />
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
