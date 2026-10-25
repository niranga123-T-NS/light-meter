import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Line, Path, Polyline, Text as SvgText } from 'react-native-svg';
import { Button, Card, colors, Muted, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { FX_SEES } from '@/lib/fx';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

// Market prices (copper, aluminium, steel, PVC) and sea freight from China (SCFI) beside the exchange rates – fetched every day by the "DIMO – market prices" workflow.
// A price going up is shown red (our cost goes up), going down green – as the exchange rates.

export type MarketItem = {
  item: 'copper' | 'aluminium' | 'steel_hrc' | 'pvc' | 'scfi';
  date: string | null; price: number | null; currency: 'USD' | 'CNY' | 'PTS' | null; usd: number | null; usd_lkr: number | null;
  week: number | null; month: number | null; history: { d: string; v: number }[];
};
export type MarketBoard = { today: string; items: MarketItem[] };

export const MARKET: Record<MarketItem['item'], { name: string; src: string; long: string; follows: string; unit?: string }> = {
  copper: { name: 'Copper', src: 'LME cash', long: 'LME official cash settlement', follows: 'Copper cable follows it with about a 4–8 week lag.' },
  aluminium: { name: 'Aluminium', src: 'LME cash', long: 'LME official cash settlement', follows: 'Aluminium poles, brackets and luminaire housings follow it.' },
  steel_hrc: { name: 'Steel', src: 'HRC · Shanghai', long: 'Hot-rolled coil, Shanghai Futures Exchange main contract (CNY, Chinese VAT included)', follows: 'Steel poles, high masts, brackets and foundation bolts follow it.' },
  pvc: { name: 'PVC', src: 'Dalian', long: 'PVC, Dalian Commodity Exchange main contract (CNY, Chinese VAT included)', follows: 'PVC conduit and cable sheathing follow it.' },
  scfi: { name: 'Sea freight', src: 'SCFI · from China', unit: 'index points', long: 'Sea freight: SCFI comprehensive index of the Shanghai Shipping Exchange – container freight out of Shanghai, weekly on Fridays (index points; no index is published for Colombo)', follows: 'Container freight from China follows it – a market trend, not our rate.' },
};

const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
export const pct = (a: number | null, b: number | null) => (a != null && b ? ((Number(a) - Number(b)) / Number(b)) * 100 : null);
const lkrT = (usd: number | null, rate: number | null) => {
  if (usd == null || !rate) return '—';
  const v = Number(usd) * Number(rate);
  return v >= 1e6 ? `${(v / 1e6).toFixed(2)} Mn / t` : `${Math.round(v / 1e3).toLocaleString('en-US')} k / t`;
};
/** ▲ up (red – dearer) / ▼ down (green) */
export function Change({ v, label, size = 12 }: { v: number | null; label?: string; size?: number }) {
  if (v == null) return <Text style={{ fontSize: size, color: colors.muted }}>{label ? `— ${label}` : '—'}</Text>;
  const tone = Math.abs(v) < 0.05 ? colors.muted : v > 0 ? colors.red : colors.green;
  return <Text style={{ fontSize: size, fontWeight: '700', color: tone }}>{`${v > 0 ? '▲' : v < 0 ? '▼' : ''} ${Math.abs(v).toFixed(1)} %${label ? ` ${label}` : ''}`}</Text>;
}

function Spark({ pts, w, h, tone }: { pts: { d: string; v: number }[]; w: number; h: number; tone: string }) {
  if (pts.length < 2) return <View style={{ height: h }} />;
  const vs = pts.map((p) => Number(p.v)), lo = Math.min(...vs), hi = Math.max(...vs);
  const xy = vs.map((v, i) => `${((i / (vs.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 6)).toFixed(1)}`).join(' ');
  return (
    <Svg width={w} height={h}>
      <Polyline points={xy} fill="none" stroke={tone} strokeWidth={2} strokeLinejoin="round" />
    </Svg>
  );
}

function Tile({ m }: { m: MarketItem }) {
  const [w, setW] = useState(140);
  const meta = MARKET[m.item];
  const wk = pct(m.usd, m.week);
  const tone = wk == null || Math.abs(wk) < 0.05 ? colors.muted : wk > 0 ? colors.red : colors.green;
  return (
    <Pressable
      onPress={() => router.push('/market')}
      accessibilityRole="button"
      accessibilityLabel={`${meta.name} price`}
      onLayout={(e) => setW(Math.max(100, e.nativeEvent.layout.width - 20))}
      style={{ flexGrow: 1, flexBasis: 150, maxWidth: 260, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 10, gap: 2 }}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>{meta.name}</Text>
      <Text style={{ fontSize: 11, color: colors.muted }}>{meta.src}</Text>
      <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink, marginTop: 4, fontVariant: ['tabular-nums'] }}>{m.usd != null ? n0(m.usd) : '—'}</Text>
      <Text style={{ fontSize: 11, color: colors.muted }}>{meta.unit ?? (m.currency === 'CNY' && m.price != null ? `USD / t · CNY ${n0(m.price)}` : 'USD / t')}</Text>
      <Spark pts={m.history} w={w} h={30} tone={tone} />
      <Change v={wk} label="week" />
      <Text style={{ fontSize: 11, color: colors.muted }}>{meta.unit ? 'weekly · Fridays' : `LKR ${lkrT(m.usd, m.usd_lkr)}`}</Text>
    </Pressable>
  );
}

/** Home: the four prices as tiles (2 × 2 on a phone, one row on a wide screen), above the exchange rates */
export function MarketCard() {
  const me = useMe();
  const show = FX_SEES.includes(me.role);
  const { data } = useLoad(async () => (show ? rpc<MarketBoard>('market_board', { p_days: 30 }).catch(() => null) : null), [show]);
  if (!show) return null;
  const items = data?.items.filter((m) => m.usd != null) ?? [];
  const last = items.map((m) => m.date).filter(Boolean).sort().pop();
  return (
    <View style={{ alignSelf: 'stretch', maxWidth: 1100 }}>
      <Section title="Market rates" right={<Button small variant="ghost" title="More →" onPress={() => router.push('/market')} />}>
        {!data ? (
          <Card><Muted>Loading the prices…</Muted></Card>
        ) : !items.length ? (
          <Card><Muted>The prices appear after the first daily fetch.</Muted></Card>
        ) : (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {items.map((m) => <Tile key={m.item} m={m} />)}
            </View>
            <Text style={{ fontSize: 11, color: colors.muted }}>
              {`Metals and PVC in USD per tonne, sea freight in index points · ${last ? fmtDate(last) : ''} · ▲ dearer than a week ago, ▼ cheaper · LKR at the CBSL USD rate · tap for the charts`}
            </Text>
          </View>
        )}
      </Section>
    </View>
  );
}

/** One item's price over the period, USD per tonne */
export function MarketChart({ m, days, today, height = 140 }: { m: MarketItem; days: number; today: string; height?: number }) {
  const [w, setW] = useState(300);
  const from = new Date(Date.parse(today) - days * 864e5).toISOString().slice(0, 10);
  const pts = m.history.filter((p) => p.d >= from).map((p) => ({ d: p.d, v: Number(p.v) }));
  if (pts.length < 2) return <Muted>The chart fills in as the daily prices come in.</Muted>;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v)), pad = (hi - lo) * 0.1 || hi * 0.02 || 1;
  const t0 = Date.parse(from), t1 = Date.parse(today);
  const L = 48, R = 8, T = 8, B = 18;
  const x = (d: string) => L + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (w - L - R);
  const y = (v: number) => T + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (height - T - B);
  const first = pts[0].v, lastV = pts[pts.length - 1].v;
  const tone = lastV > first ? colors.red : lastV < first ? colors.green : colors.muted;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return (
    <View onLayout={(e) => setW(Math.max(200, e.nativeEvent.layout.width))}>
      <Svg width={w} height={height}>
        {[lo, (lo + hi) / 2, hi].map((v) => <Line key={v} x1={L} x2={w - R} y1={y(v)} y2={y(v)} stroke={colors.line} strokeWidth={1} />)}
        {[lo, hi].map((v) => (
          <SvgText key={v} x={L - 4} y={y(v) + 4} fontSize={10} fill={colors.muted} textAnchor="end">{n0(v)}</SvgText>
        ))}
        <SvgText x={L} y={height - 4} fontSize={10} fill={colors.muted}>{fmtDate(pts[0].d)}</SvgText>
        <SvgText x={w - R} y={height - 4} fontSize={10} fill={colors.muted} textAnchor="end">{fmtDate(pts[pts.length - 1].d)}</SvgText>
        <Path d={`${line} L${x(pts[pts.length - 1].d).toFixed(1)},${height - B} L${x(pts[0].d).toFixed(1)},${height - B} Z`} fill={tone} fillOpacity={0.08} />
        <Path d={line} stroke={tone} strokeWidth={2} fill="none" />
      </Svg>
    </View>
  );
}

export { lkrT, n0 };
