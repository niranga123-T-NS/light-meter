import { useState } from 'react';
import { Platform, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from './ui';

// Chart colours (validated for colour-blind separation on white): actual / invoiced = blue, last year / forecast = orange,
// third series = aqua. Budget is the grey reference (dashed line, light bar). Good / bad use the status colours with ▲ / ▼.
export const CHART = {
  actual: '#2a78d6',
  second: '#eb6834',
  third: '#1baf7a',
  budget: '#8d8b85',
  budgetFill: '#cfcdc7',
  grid: '#ececea',
  axis: '#b9b7b1',
  good: '#15803d',
  bad: '#c8102e',
};

export type Series = { name: string; color: string; values: (number | null)[]; dashed?: boolean; fill?: string; marker?: boolean };

const PAD = { l: 52, r: 16, t: 12, b: 28 };
// SVG text does not inherit the page font on the web
const FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' : undefined;

function niceTicks(min: number, max: number, n = 4) {
  if (min === max) {
    max = min === 0 ? 1 : max * 1.2;
    if (min > 0) min = 0;
  }
  const span = max - min;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

function useWidth() {
  const [w, setW] = useState(0);
  return { w, onLayout: (e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width)) };
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 6 }}>
      {series.map((s) => (
        <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Svg width={18} height={10}>
            {s.fill ? (
              <Rect x={2} y={1} width={14} height={8} rx={2} fill={s.fill} />
            ) : (
              <Line x1={1} y1={5} x2={17} y2={5} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '4 3' : undefined} />
            )}
          </Svg>
          <Text style={{ fontSize: 12, color: colors.muted }}>{s.name}</Text>
        </View>
      ))}
    </View>
  );
}

/** Tooltip box listing every series at the hovered / tapped point */
function Tip({ x, w, title, rows, fmt }: { x: number; w: number; title: string; rows: { s: Series; v: number | null }[]; fmt: (n: number) => string }) {
  const boxW = 190;
  const left = Math.max(0, Math.min(w - boxW, x - boxW / 2));
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left,
        width: boxW,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 8,
        padding: 8,
        gap: 3,
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 8,
        elevation: 3,
      }}
    >
      <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 12 }}>{title}</Text>
      {rows.map(({ s, v }) => (
        <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: s.fill ?? s.color }} />
          <Text style={{ flex: 1, fontSize: 12, color: colors.muted }}>{s.name}</Text>
          <Text style={{ fontSize: 12, color: colors.ink, fontVariant: ['tabular-nums'] }}>{v == null ? '—' : fmt(v)}</Text>
        </View>
      ))}
    </View>
  );
}

type Frame = { w: number; h: number; lo: number; hi: number; ticks: number[]; n: number };
const xBand = (f: Frame) => (f.w - PAD.l - PAD.r) / Math.max(1, f.n);
const xMid = (f: Frame, i: number) => PAD.l + xBand(f) * (i + 0.5);
const yOf = (f: Frame, v: number) => PAD.t + (f.h - PAD.t - PAD.b) * (1 - (v - f.lo) / (f.hi - f.lo || 1));

function Axes({ f, categories, fmtAxis, flags }: { f: Frame; categories: string[]; fmtAxis: (n: number) => string; flags?: (i: number) => 'bad' | 'good' | undefined }) {
  const every = Math.ceil(categories.length / Math.max(1, Math.floor((f.w - PAD.l) / 46)));
  return (
    <G>
      {f.ticks.map((t) => (
        <G key={t}>
          <Line x1={PAD.l} x2={f.w - PAD.r} y1={yOf(f, t)} y2={yOf(f, t)} stroke={t === 0 ? CHART.axis : CHART.grid} strokeWidth={1} />
          <SvgText fontFamily={FONT} x={PAD.l - 6} y={yOf(f, t) + 4} fontSize={11} fill={colors.muted} textAnchor="end">
            {fmtAxis(t)}
          </SvgText>
        </G>
      ))}
      {categories.map((c, i) =>
        i % every === 0 ? (
          <SvgText fontFamily={FONT} key={c + i} x={xMid(f, i)} y={f.h - 9} fontSize={11} fill={flags?.(i) === 'bad' ? CHART.bad : colors.muted} textAnchor="middle" fontWeight={flags?.(i) ? '700' : '400'}>
            {flags?.(i) === 'bad' ? `▼ ${c}` : c}
          </SvgText>
        ) : null,
      )}
    </G>
  );
}

/** Line chart over categories (months). Hover or tap a month for its values. */
export function LineChart({
  categories,
  series,
  height = 220,
  fmt,
  fmtAxis = fmt,
  flags,
  note,
}: {
  categories: string[];
  series: Series[];
  height?: number;
  fmt: (n: number) => string;
  fmtAxis?: (n: number) => string;
  flags?: (i: number) => 'bad' | 'good' | undefined;
  note?: string;
}) {
  const { w, onLayout } = useWidth();
  const [sel, setSel] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const { lo, hi, ticks } = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const f: Frame = { w, h: height, lo, hi, ticks, n: categories.length };
  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${xMid(f, i).toFixed(1)} ${yOf(f, v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  return (
    <View>
      <Legend series={series} />
      <View onLayout={onLayout} style={{ height }}>
        {w > 0 ? (
          <>
            <Svg width={w} height={height}>
              <Axes f={f} categories={categories} fmtAxis={fmtAxis} flags={flags} />
              {sel != null ? <Line x1={xMid(f, sel)} x2={xMid(f, sel)} y1={PAD.t} y2={height - PAD.b} stroke={CHART.axis} strokeWidth={1} /> : null}
              {series.map((s) => (
                <G key={s.name}>
                  <Path d={path(s.values)} stroke={s.color} strokeWidth={2} fill="none" strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
                  {s.values.map((v, i) =>
                    v == null ? null : <Circle key={i} cx={xMid(f, i)} cy={yOf(f, v)} r={sel === i ? 5 : 4} fill={s.dashed ? '#fff' : s.color} stroke={s.dashed ? s.color : '#fff'} strokeWidth={2} />,
                  )}
                </G>
              ))}
            </Svg>
            <View style={{ position: 'absolute', left: PAD.l, right: PAD.r, top: 0, bottom: 0, flexDirection: 'row' }}>
              {categories.map((c, i) => (
                <Pressable key={c + i} style={{ flex: 1 }} onHoverIn={() => setSel(i)} onHoverOut={() => setSel(null)} onPress={() => setSel(sel === i ? null : i)} />
              ))}
            </View>
            {sel != null ? <Tip x={xMid(f, sel)} w={w} title={categories[sel]} rows={series.map((s) => ({ s, v: s.values[sel] }))} fmt={fmt} /> : null}
          </>
        ) : null}
      </View>
      {note ? <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{note}</Text> : null}
    </View>
  );
}

/** Grouped bar chart over categories (months); a series with `fill` is drawn as a light reference bar. */
export function BarChart({
  categories,
  series,
  height = 220,
  fmt,
  fmtAxis = fmt,
  flags,
  note,
  stacked,
}: {
  categories: string[];
  series: Series[];
  height?: number;
  fmt: (n: number) => string;
  fmtAxis?: (n: number) => string;
  flags?: (i: number) => 'bad' | 'good' | undefined;
  note?: string;
  /** One bar per category with the series stacked; `marker` series are drawn as a short line (e.g. the target) */
  stacked?: boolean;
}) {
  const { w, onLayout } = useWidth();
  const [sel, setSel] = useState<number | null>(null);
  const bars = series.filter((s) => !s.marker);
  const all = stacked
    ? [
        ...categories.map((_, i) => bars.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0)),
        ...series.filter((s) => s.marker).flatMap((s) => s.values).filter((v): v is number => v != null),
      ]
    : series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const { lo, hi, ticks } = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const f: Frame = { w, h: height, lo, hi, ticks, n: categories.length };
  const band = xBand(f);
  const groupW = Math.min(band * 0.78, 22 * series.length + 2 * (series.length - 1));
  const barW = Math.max(2, (groupW - 2 * (series.length - 1)) / series.length);
  return (
    <View>
      <Legend series={series} />
      <View onLayout={onLayout} style={{ height }}>
        {w > 0 ? (
          <>
            <Svg width={w} height={height}>
              <Axes f={f} categories={categories} fmtAxis={fmtAxis} flags={flags} />
              {sel != null ? <Rect x={xMid(f, sel) - band / 2} y={PAD.t} width={band} height={height - PAD.t - PAD.b} fill={colors.soft} /> : null}
              {stacked
                ? categories.map((c, i) => {
                    const bw = Math.min(band * 0.6, 34);
                    const x = xMid(f, i) - bw / 2;
                    let acc = 0;
                    return (
                      <G key={c + i}>
                        {bars.map((s) => {
                          const v = Math.max(0, s.values[i] ?? 0);
                          if (!v) return null;
                          const y0 = yOf(f, acc);
                          acc += v;
                          const y1 = yOf(f, acc);
                          return <Rect key={s.name} x={x} y={y1} width={bw} height={Math.max(1, y0 - y1)} fill={s.fill ?? s.color} />;
                        })}
                        {series
                          .filter((s) => s.marker && s.values[i] != null)
                          .map((s) => (
                            <Line key={s.name} x1={x - 5} x2={x + bw + 5} y1={yOf(f, s.values[i] as number)} y2={yOf(f, s.values[i] as number)} stroke={s.color} strokeWidth={3} />
                          ))}
                      </G>
                    );
                  })
                : categories.map((c, i) =>
                series.map((s, k) => {
                  const v = s.values[i];
                  if (v == null || v === 0) return null;
                  const x = xMid(f, i) - groupW / 2 + k * (barW + 2);
                  const y0 = yOf(f, 0);
                  const y1 = yOf(f, v);
                  const top = Math.min(y0, y1);
                  const hgt = Math.max(1, Math.abs(y1 - y0));
                  const r = Math.min(3, barW / 2, hgt);
                  // Rounded at the data end, square at the baseline
                  const d =
                    v >= 0
                      ? `M${x} ${y0} V${top + r} Q${x} ${top} ${x + r} ${top} H${x + barW - r} Q${x + barW} ${top} ${x + barW} ${top + r} V${y0} Z`
                      : `M${x} ${y0} V${top + hgt - r} Q${x} ${top + hgt} ${x + r} ${top + hgt} H${x + barW - r} Q${x + barW} ${top + hgt} ${x + barW} ${top + hgt - r} V${y0} Z`;
                  return <Path key={`${c}${s.name}`} d={d} fill={s.fill ?? s.color} />;
                }),
              )}
            </Svg>
            <View style={{ position: 'absolute', left: PAD.l, right: PAD.r, top: 0, bottom: 0, flexDirection: 'row' }}>
              {categories.map((c, i) => (
                <Pressable key={c + i} style={{ flex: 1 }} onHoverIn={() => setSel(i)} onHoverOut={() => setSel(null)} onPress={() => setSel(sel === i ? null : i)} />
              ))}
            </View>
            {sel != null ? <Tip x={xMid(f, sel)} w={w} title={categories[sel]} rows={series.map((s) => ({ s, v: s.values[sel] }))} fmt={fmt} /> : null}
          </>
        ) : null}
      </View>
      {note ? <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{note}</Text> : null}
    </View>
  );
}

/** Horizontal bars either side of zero: right = better than budget, left = worse. */
export function DeviationBars({ rows, fmt }: { rows: { label: string; value: number }[]; fmt: (n: number) => string }) {
  const { w, onLayout } = useWidth();
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const labelW = Math.min(190, Math.max(120, w * 0.34));
  const valW = 74;
  const plot = Math.max(40, w - labelW - valW);
  const mid = labelW + plot / 2;
  const rowH = 26;
  // About 6.5 px per character at 12 px – shorten labels to the space available
  const maxChars = Math.max(8, Math.floor((labelW - 10) / 6.5));
  return (
    <View onLayout={onLayout}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: labelW, paddingRight: valW, marginBottom: 4 }}>
        <Text style={{ fontSize: 12, color: CHART.bad, fontWeight: '600' }}>▼ worse than budget</Text>
        <Text style={{ fontSize: 12, color: CHART.good, fontWeight: '600' }}>better ▲</Text>
      </View>
      {w > 0 ? (
        <Svg width={w} height={rows.length * rowH + 4}>
          <Line x1={mid} x2={mid} y1={0} y2={rows.length * rowH + 4} stroke={CHART.axis} strokeWidth={1} />
          {rows.map((r, i) => {
            const len = (Math.abs(r.value) / max) * (plot / 2 - 4);
            const y = i * rowH + 6;
            const good = r.value >= 0;
            return (
              <G key={r.label}>
                <SvgText fontFamily={FONT} x={labelW - 8} y={y + 11} fontSize={12} fill={colors.text} textAnchor="end">
                  {r.label.length > maxChars ? `${r.label.slice(0, maxChars - 1)}…` : r.label}
                </SvgText>
                <Rect x={good ? mid : mid - len} y={y} width={Math.max(1.5, len)} height={14} rx={3} fill={good ? CHART.good : CHART.bad} />
                <SvgText fontFamily={FONT} x={w - 4} y={y + 11} fontSize={12} fill={colors.ink} textAnchor="end" fontWeight="600">
                  {`${good ? '▲' : '▼'} ${fmt(Math.abs(r.value))}`}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}
