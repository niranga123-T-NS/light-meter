import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { Button, Card, colors, Muted, Pill, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { crossFromLkr, FX_CCY, FX_SEES, FX_UPLOAD, fmtCross, fmtRate, rateOf, type Ccy, type FxBoard, type FxRate } from '@/lib/fx';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

const NAME: Record<Ccy, string> = { USD: 'US Dollar', EUR: 'Euro', GBP: 'Sterling Pound' };
const range = (a: string | null | undefined, b: string | null | undefined) => (a ? (b && b !== a ? `${fmtDate(a)} – ${fmtDate(b)}` : fmtDate(a)) : 'not yet');

/** Value with the change since the previous day / week (▲ dearer rupee-wise, ▼ cheaper) */
function Val({ v, prev, dp = 2, bold }: { v: number | null | undefined; prev?: number | null; dp?: number; bold?: boolean }) {
  const d = v != null && prev != null ? Number(v) - Number(prev) : null;
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={{ color: colors.ink, fontWeight: bold ? '700' : '500', fontVariant: ['tabular-nums'] }}>{fmtRate(v, dp)}</Text>
      {d != null && Math.abs(d) >= 0.005 ? (
        <Text style={{ fontSize: 11, color: d > 0 ? colors.red : colors.green, fontVariant: ['tabular-nums'] }}>{`${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(2)}`}</Text>
      ) : (
        <Text style={{ fontSize: 11, color: colors.faint }}> </Text>
      )}
    </View>
  );
}

type Col = { h: string; sub: string; w: number; v: (c: Ccy) => React.ReactNode };

function Table({ cols }: { cols: Col[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ minWidth: '100%' }}>
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line, paddingBottom: 6 }}>
          <View style={{ width: 120 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>LKR per unit</Text>
          </View>
          {cols.map((c) => (
            <View key={c.h + c.sub} style={{ width: c.w, flexGrow: 1, alignItems: 'flex-end', paddingLeft: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink, textAlign: 'right' }}>{c.h}</Text>
              <Text style={{ fontSize: 11, color: colors.muted, textAlign: 'right' }}>{c.sub}</Text>
            </View>
          ))}
        </View>
        {FX_CCY.map((ccy) => (
          <View key={ccy} style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.line, alignItems: 'center' }}>
            <View style={{ width: 120 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{ccy}</Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>{NAME[ccy]}</Text>
            </View>
            {cols.map((c) => (
              <View key={c.h + c.sub} style={{ width: c.w, flexGrow: 1, paddingLeft: 8 }}>
                {c.v(ccy)}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** Small line chart of the Central Bank rate (and the bank's TT selling) of one currency */
export function FxTrend({ board, ccy, days, height = 120, combank = true }: { board: FxBoard; ccy: Ccy; days: number; height?: number; combank?: boolean }) {
  const [w, setW] = useState(300);
  const from = new Date(Date.parse(board.today) - days * 864e5).toISOString().slice(0, 10);
  const pts = (s: 'cbsl' | 'combank' | 'customs', f: (h: FxBoard['history'][number]) => number | null) =>
    board.history.filter((h) => h.s === s && h.c === ccy && h.d >= from && f(h) != null).map((h) => ({ d: h.d, v: Number(f(h)) }));
  const lines = [
    { k: 'CBSL', tone: colors.blue, p: pts('cbsl', (h) => h.mid) },
    ...(combank ? [{ k: 'ComBank TT sell', tone: colors.brand, p: pts('combank', (h) => h.sell) }, { k: 'ComBank TT buy', tone: colors.green, p: pts('combank', (h) => h.buy) }] : []),
    { k: 'Customs', tone: colors.amber, p: pts('customs', (h) => h.mid) },
  ].filter((l) => l.p.length);
  const all = lines.flatMap((l) => l.p);
  if (all.length < 2) return <Muted>{`${ccy}: the trend fills in as the daily rates come in.`}</Muted>;
  const lo = Math.min(...all.map((p) => p.v)), hi = Math.max(...all.map((p) => p.v));
  const pad = (hi - lo) * 0.1 || 1;
  const t0 = Date.parse(from), t1 = Date.parse(board.today);
  const L = 44, R = 8, T = 8, B = 18;
  const x = (d: string) => L + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (w - L - R);
  const y = (v: number) => T + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (height - T - B);
  return (
    <View onLayout={(e) => setW(Math.max(200, e.nativeEvent.layout.width))}>
      <Svg width={w} height={height}>
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <Line key={v} x1={L} x2={w - R} y1={y(v)} y2={y(v)} stroke={colors.line} strokeWidth={1} />
        ))}
        {[lo, hi].map((v) => (
          <SvgText key={v} x={L - 4} y={y(v) + 4} fontSize={10} fill={colors.muted} textAnchor="end">
            {v.toFixed(1)}
          </SvgText>
        ))}
        <SvgText x={L} y={height - 4} fontSize={10} fill={colors.muted}>{fmtDate(from)}</SvgText>
        <SvgText x={w - R} y={height - 4} fontSize={10} fill={colors.muted} textAnchor="end">{fmtDate(board.today)}</SvgText>
        {lines.map((l) => (
          <Path
            key={l.k}
            d={l.p.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}
            stroke={l.tone}
            strokeWidth={l.k === 'CBSL' ? 2 : 1.5}
            fill="none"
          />
        ))}
      </Svg>
      <Row wrap gap={10}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.ink }}>{ccy}</Text>
        {lines.map((l) => (
          <Text key={l.k} style={{ fontSize: 11, color: l.tone }}>{`━ ${l.k}`}</Text>
        ))}
      </Row>
    </View>
  );
}

/** The rates with their dates / validity, the cross rates and (full) the bank's forward rates */
export function FxTable({ board, full }: { board: FxBoard; full?: boolean }) {
  const cb = board.cbsl.rows, bk = board.combank.rows, cu = board.customs.rows;
  const g = (rows: FxRate[], c: Ccy) => rateOf(rows, c);
  const weekday = new Date(board.today).getDay() % 6 !== 0;
  const bankLate = weekday && board.combank.date !== board.today;
  const cuTo = cu[0]?.valid_to;
  const cuStale = !cu.length || (cuTo != null && cuTo < board.today);
  const cols: Col[] = [
    { h: 'CBSL', sub: `indicative · ${board.cbsl.date ? fmtDate(board.cbsl.date) : '—'}`, w: 110, v: (c) => <Val v={g(cb, c)?.mid} prev={g(cb, c)?.prev?.mid} bold /> },
    { h: 'ComBank TT buy', sub: board.combank.date ? fmtDate(board.combank.date) : '—', w: 110, v: (c) => <Val v={g(bk, c)?.tt_buy} prev={g(bk, c)?.prev?.tt_buy} /> },
    { h: 'ComBank TT sell', sub: board.combank.date ? fmtDate(board.combank.date) : '—', w: 110, v: (c) => <Val v={g(bk, c)?.tt_sell} prev={g(bk, c)?.prev?.tt_sell} bold /> },
    { h: '3 months sell', sub: 'forward · ComBank', w: 110, v: (c) => <Val v={g(bk, c)?.sell_3m} prev={g(bk, c)?.prev?.sell_3m} /> },
    { h: '3 months buy', sub: 'discounted · ComBank', w: 110, v: (c) => <Val v={g(bk, c)?.buy_3m} prev={g(bk, c)?.prev?.buy_3m} /> },
    { h: 'Customs', sub: cu.length ? range(board.customs.date, cuTo) : 'not yet', w: 130, v: (c) => <Val v={g(cu, c)?.mid} prev={g(cu, c)?.prev?.mid} dp={4} bold /> },
  ];
  const fwd: Col[] = [
    { h: 'Middle / cross', sub: 'ComBank', w: 100, v: (c) => <Val v={c === 'USD' ? g(bk, c)?.mid : g(bk, c)?.cross_usd} dp={c === 'USD' ? 2 : 4} /> },
    { h: 'LC sell', sub: '', w: 90, v: (c) => <Val v={g(bk, c)?.lc_sell} /> },
    { h: '1 month sell', sub: '', w: 90, v: (c) => <Val v={g(bk, c)?.sell_1m} /> },
    { h: '2 months sell', sub: '', w: 90, v: (c) => <Val v={g(bk, c)?.sell_2m} /> },
    { h: '3 months sell', sub: '', w: 90, v: (c) => <Val v={g(bk, c)?.sell_3m} bold /> },
    { h: '7 days buy', sub: '', w: 90, v: (c) => <Val v={g(bk, c)?.buy_7d} /> },
    { h: '1 month buy', sub: '', w: 90, v: (c) => <Val v={g(bk, c)?.buy_1m} /> },
    { h: '2 months buy', sub: '', w: 90, v: (c) => <Val v={g(bk, c)?.buy_2m} /> },
    { h: '3 months buy', sub: '', w: 90, v: (c) => <Val v={g(bk, c)?.buy_3m} bold /> },
  ];
  const xc = crossFromLkr((c) => g(cb, c)?.mid);
  const xb = { EURUSD: g(bk, 'EUR')?.cross_usd ?? null, GBPUSD: g(bk, 'GBP')?.cross_usd ?? null } as Record<string, number | null>;
  xb.EURGBP = xb.EURUSD && xb.GBPUSD ? xb.EURUSD / xb.GBPUSD : null;
  const xu = crossFromLkr((c) => g(cu, c)?.mid);
  const crossRows: [string, keyof typeof xc][] = [['EUR / USD', 'EURUSD'], ['GBP / USD', 'GBPUSD'], ['EUR / GBP', 'EURGBP']];
  return (
    <View style={{ gap: 8 }}>
      <Table cols={cols} />
      <Row wrap gap={6}>
        {bankLate ? <Pill label={`ComBank report of ${fmtDate(board.today)} not uploaded yet`} tone={colors.amber} /> : null}
        {cuStale ? <Pill label="Customs rates for this week not in yet" tone={colors.amber} /> : <Pill label={`Customs valid ${range(board.customs.date, cuTo)}`} tone={colors.green} />}
        {board.customs.next?.length ? <Pill label={`Next Customs schedule from ${fmtDate(board.customs.next[0].rate_date)}`} tone={colors.blue} /> : null}
      </Row>
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>CROSS RATES</Text>
        <Row wrap gap={18}>
          {crossRows.map(([lbl, k]) => (
            <View key={k}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{lbl}</Text>
              <Text style={{ fontSize: 12, color: colors.text, fontVariant: ['tabular-nums'] }}>{`CBSL ${fmtCross(xc[k])} · ComBank ${fmtCross(xb[k])} · Customs ${fmtCross(xu[k])}`}</Text>
            </View>
          ))}
        </Row>
      </View>
      {full ? (
        <View style={{ gap: 4, marginTop: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>{`COMMERCIAL BANK – ALL RATES · ${board.combank.date ? fmtDate(board.combank.date) : '—'}`}</Text>
          <Table cols={fwd} />
          <Muted>Selling: TT, LC and the forward rates for 1–3 months. Buying: TT and the discounted rates for export bills of 7 days to 3 months. The bank&apos;s rates are indicative.</Muted>
        </View>
      ) : null}
    </View>
  );
}

/** The short table for the Home tab: one line per currency, the dates underneath; the rest is on the Exchange rates tab */
export function FxShort({ board }: { board: FxBoard }) {
  const cb = board.cbsl.rows, bk = board.combank.rows, cu = board.customs.rows;
  const cols: [string, (c: Ccy) => number | null | undefined, number][] = [
    ['CBSL', (c) => rateOf(cb, c)?.mid, 2],
    ['TT buy', (c) => rateOf(bk, c)?.tt_buy, 2],
    ['TT sell', (c) => rateOf(bk, c)?.tt_sell, 2],
    ['3 m sell', (c) => rateOf(bk, c)?.sell_3m, 2],
    ['Customs', (c) => rateOf(cu, c)?.mid, 2],
  ];
  const cell = { flex: 1, minWidth: 64, alignItems: 'flex-end' as const };
  const weekday = new Date(board.today).getDay() % 6 !== 0;
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', paddingBottom: 4, borderBottomWidth: 1, borderColor: colors.line }}>
        <View style={{ width: 48 }} />
        {cols.map(([h]) => (
          <View key={h} style={cell}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>{h}</Text>
          </View>
        ))}
      </View>
      {FX_CCY.map((c) => (
        <View key={c} style={{ flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderColor: colors.line }}>
          <Text style={{ width: 48, fontWeight: '700', color: colors.ink }}>{c}</Text>
          {cols.map(([h, v, dp]) => (
            <View key={h} style={cell}>
              <Text style={{ color: colors.ink, fontWeight: h === 'TT sell' || h === 'CBSL' ? '700' : '400', fontVariant: ['tabular-nums'] }}>{fmtRate(v(c), dp)}</Text>
            </View>
          ))}
        </View>
      ))}
      <Text style={{ fontSize: 11, color: weekday && board.combank.date !== board.today ? colors.amber : colors.muted, marginTop: 4 }}>
        {`LKR per unit · CBSL ${board.cbsl.date ? fmtDate(board.cbsl.date) : '—'} · ComBank ${board.combank.date ? fmtDate(board.combank.date) : '—'}${weekday && board.combank.date !== board.today ? ' (today’s not in yet)' : ''} · Customs ${cu.length ? range(board.customs.date, cu[0]?.valid_to) : 'not yet'}`}
      </Text>
    </View>
  );
}

/** Home dashboard card (GM / DGM, SM Projects, Estimation team, Operations Executive) – the short table */
export function FxCard() {
  const me = useMe();
  const show = FX_SEES.includes(me.role);
  const { data } = useLoad(async () => (show ? rpc<FxBoard>('fx_board', { p_days: 30 }).catch(() => null) : null), [show]);
  if (!show) return null;
  return (
    <Section
      title="Exchange rates"
      right={
        <Button
          small
          variant={FX_UPLOAD.includes(me.role) && data && data.combank.date !== data.today && new Date(data.today).getDay() % 6 !== 0 ? 'primary' : 'ghost'}
          title={FX_UPLOAD.includes(me.role) && data && data.combank.date !== data.today && new Date(data.today).getDay() % 6 !== 0 ? 'Upload today’s bank rates' : 'More →'}
          onPress={() => router.push('/fx')}
        />
      }
    >
      <Card style={{ gap: 6 }}>
        {data ? <FxShort board={data} /> : <Muted>Loading the rates…</Muted>}
      </Card>
    </Section>
  );
}
