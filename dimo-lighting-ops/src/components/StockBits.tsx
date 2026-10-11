import { Text, View } from 'react-native';
import { colors, Muted } from '@/components/ui';
import { fmtAmount, fmtNumber } from '@/lib/format';
import { AGE_BANDS, bandQty, bandValue, type StockLine } from '@/lib/stock';

export const VALUE_ROLES = ['gm', 'sm_projects', 'operations_exec'];
export const lkr = (n?: number | null) => (n == null ? '—' : `LKR ${fmtAmount(Math.round(Number(n))).replace(/\.00$/, '')}`);
export const lkrM = (n?: number | null) => (n == null ? '—' : `LKR ${(Number(n) / 1e6).toFixed(2)} M`);

/** Totals per age band over a set of lines */
export function bandTotals(lines: StockLine[]) {
  return AGE_BANDS.map((b) => ({
    ...b,
    qty: lines.reduce((a, l) => a + bandQty(l, b.key), 0),
    value: lines.some((l) => bandValue(l, b.key) != null) ? lines.reduce((a, l) => a + (bandValue(l, b.key) ?? 0), 0) : null,
  }));
}

/** Horizontal bars, one per age band: value when it can be seen, otherwise quantity */
export function AgeBars({ lines, byValue }: { lines: StockLine[]; byValue: boolean }) {
  const t = bandTotals(lines);
  const metric = (x: (typeof t)[number]) => (byValue ? (x.value ?? 0) : x.qty);
  const total = t.reduce((a, x) => a + metric(x), 0) || 1;
  const max = Math.max(...t.map(metric), 1);
  return (
    <View style={{ gap: 8 }}>
      {t.map((x) => (
        <View key={x.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ width: 96, color: colors.ink, fontWeight: '600' }}>{x.label}</Text>
          <View style={{ flex: 1, height: 18, backgroundColor: colors.line, borderRadius: 4, overflow: 'hidden' }}>
            <View style={{ width: `${(100 * metric(x)) / max}%`, height: '100%', backgroundColor: x.tone }} />
          </View>
          <Text style={{ width: 190, textAlign: 'right', color: colors.ink }}>
            {byValue ? `${lkr(x.value)} · ${Math.round((100 * metric(x)) / total)}%` : `${fmtNumber(x.qty, 2)} units · ${Math.round((100 * metric(x)) / total)}%`}
          </Text>
        </View>
      ))}
      <Muted>{byValue ? 'Closing value by age (SAP ageing merged into 6 bands)' : 'Quantity by age – values are shown to GM / DGM, SM Projects and Operations'}</Muted>
    </View>
  );
}

/** A thin stacked bar of one line's quantity by age band */
export function LineAge({ line }: { line: StockLine }) {
  const total = AGE_BANDS.reduce((a, b) => a + bandQty(line, b.key), 0) || 1;
  return (
    <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.line, marginTop: 4, maxWidth: 260 }}>
      {AGE_BANDS.map((b) => (bandQty(line, b.key) > 0 ? <View key={b.key} style={{ width: `${(100 * bandQty(line, b.key)) / total}%`, backgroundColor: b.tone }} /> : null))}
    </View>
  );
}
