import { Platform, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { Card, colors, Muted, Row } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { dayMs, fromDay, plannedPct, toDay, type Activity, type Snapshot } from '@/lib/programme';

const FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' : undefined;
const H = 220;
const PAD = { l: 36, r: 16, t: 12, b: 26 };

/** Progress S-curve: planned % from the approved baseline (dashed) against the actual % recorded each day (solid) */
export function SCurve({ acts, snaps, today }: { acts: Activity[]; snaps: Snapshot[]; today: string }) {
  const win = useWindowDimensions().width;
  // Fits the card: the side menu takes ~300 px on wide screens
  const width = Math.max(280, Math.min(900, win - (win >= 900 ? 340 : 64)));
  const bl = acts.filter((a) => a.bl_start && a.bl_finish);
  if (!bl.length) return <Muted>The S-curve starts once SM Projects approves the programme.</Muted>;
  const start = toDay(bl.map((a) => a.bl_start!).sort()[0]);
  const end = Math.max(toDay(bl.map((a) => a.bl_finish!).sort().slice(-1)[0]), toDay(today), ...snaps.map((s) => toDay(s.snap_date)));
  const W = width - PAD.l - PAD.r;
  const x = (d: number) => PAD.l + ((d - start) / Math.max(end - start, 1)) * W;
  const y = (p: number) => PAD.t + (1 - p / 100) * (H - PAD.t - PAD.b);
  const step = Math.max(1, Math.round((end - start) / 60));
  const planned: string[] = [];
  for (let d = start; d <= end; d += step) planned.push(`${planned.length ? 'L' : 'M'}${x(d).toFixed(1)} ${y(plannedPct(acts, fromDay(d))).toFixed(1)}`);
  planned.push(`L${x(end).toFixed(1)} ${y(plannedPct(acts, fromDay(end))).toFixed(1)}`);
  const pts = [...snaps].sort((a, b) => a.snap_date.localeCompare(b.snap_date));
  const actual = pts.map((s, i) => `${i ? 'L' : 'M'}${x(toDay(s.snap_date)).toFixed(1)} ${y(Number(s.pct_actual)).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const planToday = plannedPct(acts, today);
  const months: number[] = [];
  for (let d = start; d <= end; d++) if (new Date(d * dayMs).getUTCDate() === 1 || (d === start && new Date(d * dayMs).getUTCDate() <= 20)) months.push(d);
  return (
    <Card>
      <Row wrap gap={16} style={{ marginBottom: 4 }}>
        <Row gap={6} style={{ alignItems: 'center' }}>
          <View style={{ width: 18, height: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: colors.muted }} />
          <Text style={{ fontSize: 12, color: colors.text }}>{`Planned (baseline) · ${Math.round(planToday)}% today`}</Text>
        </Row>
        <Row gap={6} style={{ alignItems: 'center' }}>
          <View style={{ width: 18, height: 2, backgroundColor: colors.blue }} />
          <Text style={{ fontSize: 12, color: colors.text }}>{`Actual · ${last ? `${Math.round(Number(last.pct_actual))}% on ${fmtDate(last.snap_date)}` : 'no progress yet'}`}</Text>
        </Row>
      </Row>
      <Svg width={width} height={H}>
        {[0, 25, 50, 75, 100].map((p) => (
          <Line key={p} x1={PAD.l} x2={width - PAD.r} y1={y(p)} y2={y(p)} stroke={colors.line} strokeWidth={1} />
        ))}
        {[0, 50, 100].map((p) => (
          <SvgText key={`t${p}`} fontFamily={FONT} x={PAD.l - 6} y={y(p) + 4} fontSize={10} fill={colors.muted} textAnchor="end">{`${p}%`}</SvgText>
        ))}
        {months.map((d) => (
          <SvgText key={d} fontFamily={FONT} x={x(d)} y={H - 8} fontSize={10} fill={colors.muted}>{fmtDate(fromDay(d)).slice(3)}</SvgText>
        ))}
        <Path d={planned.join(' ')} stroke={colors.muted} strokeWidth={2} strokeDasharray="5 4" fill="none" />
        {pts.length > 1 ? <Path d={actual} stroke={colors.blue} strokeWidth={2} fill="none" /> : null}
        {last ? <Circle cx={x(toDay(last.snap_date))} cy={y(Number(last.pct_actual))} r={4} fill={colors.blue} stroke="#fff" strokeWidth={2} /> : null}
        <Line x1={x(toDay(today))} x2={x(toDay(today))} y1={PAD.t} y2={H - PAD.b} stroke={colors.brand} strokeWidth={1.5} />
        <SvgText fontFamily={FONT} x={x(toDay(today)) + 3} y={PAD.t + 10} fontSize={9} fill={colors.brand}>today</SvgText>
      </Svg>
      {last ? (
        <Muted>
          {`Schedule performance (actual ÷ planned): ${planToday ? (Number(last.pct_actual) / planToday).toFixed(2) : '—'} – below 1.00 means behind the baseline.`}
        </Muted>
      ) : null}
    </Card>
  );
}
