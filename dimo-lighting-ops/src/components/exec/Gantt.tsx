import { router } from 'expo-router';
import { Fragment } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { colors, useWide } from '@/components/ui';
import { dayMs, programmeRows, toDay, wbsSummary, type Activity, type Dep, type Wbs } from '@/lib/programme';

const ROW = 30;
const HEAD = 34;
const FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' : undefined;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Gantt chart: WBS rows with roll-up bars, activity bars (critical in red), baseline behind each bar,
 * % complete, milestones (◆), dependency arrows and today's line. Tap an activity to open it.
 */
export function Gantt({
  wbs,
  acts,
  deps,
  scale,
  today,
  contractEnd,
  onWbsPress,
  onDatesPress,
  onAddActivity,
  onActivityEdit,
}: {
  wbs: Wbs[];
  acts: Activity[];
  deps: Dep[];
  scale: 'day' | 'week' | 'month';
  today: string;
  contractEnd: string | null;
  /** When set (the SEE while the programme can be edited), tapping a WBS row opens it for editing */
  onWbsPress?: (w: Wbs) => void;
  /** When set (the SEE while the programme can be edited), tapping an activity's start / finish / duration sets its dates */
  onDatesPress?: (a: Activity) => void;
  /** When set, a "+" on each WBS row adds an activity under it */
  onAddActivity?: (w: Wbs) => void;
  /** When set, tapping an activity name edits it ("›" opens the activity) */
  onActivityEdit?: (a: Activity) => void;
}) {
  const wide = useWide();
  const rows = programmeRows(wbs, acts);
  const px = scale === 'day' ? 22 : scale === 'week' ? 7 : 2.4;
  const dates = acts.flatMap((a) => [a.es, a.ef, a.bl_start, a.bl_finish]).filter(Boolean) as string[];
  if (!dates.length) return null;
  const first = Math.min(...dates.map(toDay), toDay(today)) - 3;
  const last = Math.max(...dates.map(toDay), contractEnd ? toDay(contractEnd) : 0, toDay(today)) + 10;
  const start = first - ((new Date(first * dayMs).getUTCDay() + 6) % 7); // from a Monday
  const width = (last - start + 1) * px;
  const height = HEAD + rows.length * ROW;
  const x = (iso: string) => (toDay(iso) - start) * px;
  const rowOf = new Map<string, number>();
  rows.forEach((r, i) => r.kind === 'act' && rowOf.set(r.act.id, i));
  const nameW = wide ? 260 : 150;
  // Start / finish / duration columns (tablet and computer)
  const cols = wide;
  const COL = { s: 66, f: 66, d: 44 };
  const labelW = nameW + (cols ? COL.s + COL.f + COL.d : 0);
  const dm = (iso?: string | null) => (iso ? `${String(new Date(iso).getUTCDate()).padStart(2, '0')} ${MONTHS[new Date(iso).getUTCMonth()]}` : '—');
  const cell = (w: number, text: string, opts: { bold?: boolean; right?: boolean; edit?: boolean } = {}) => (
    <View style={{ width: w, paddingHorizontal: 4, justifyContent: 'center', alignItems: opts.right ? 'flex-end' : 'flex-start', borderLeftWidth: 1, borderLeftColor: '#F0F1F3' }}>
      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: opts.bold ? '700' : '400', color: opts.edit ? colors.blue : colors.text, textDecorationLine: opts.edit ? 'underline' : 'none' }}>
        {text}
      </Text>
    </View>
  );

  // Timeline header: months, and weeks / days below
  const head: React.ReactNode[] = [];
  for (let d = start; d <= last; d++) {
    const dt = new Date(d * dayMs);
    const xx = (d - start) * px;
    if (dt.getUTCDate() === 1 || (d === start && dt.getUTCDate() <= 20)) {
      head.push(<SvgText fontFamily={FONT} key={`m${d}`} x={xx + 3} y={12} fontSize={11} fontWeight="700" fill={colors.ink}>{`${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`}</SvgText>);
      head.push(<Line key={`ml${d}`} x1={xx} x2={xx} y1={0} y2={height} stroke={colors.line} strokeWidth={1} />);
    }
    if (scale !== 'month' && dt.getUTCDay() === 1) {
      head.push(<Line key={`w${d}`} x1={xx} x2={xx} y1={HEAD - 14} y2={height} stroke="#F0F1F3" strokeWidth={1} />);
      head.push(<SvgText fontFamily={FONT} key={`wl${d}`} x={xx + 2} y={HEAD - 4} fontSize={9} fill={colors.muted}>{String(dt.getUTCDate())}</SvgText>);
    }
    if (scale === 'day' && (dt.getUTCDay() === 0 || dt.getUTCDay() === 6)) head.push(<Rect key={`we${d}`} x={xx} y={HEAD} width={px} height={height - HEAD} fill="#F7F7F9" />);
  }

  const arrows = deps.map((d) => {
    const pr = rowOf.get(d.pred_id);
    const sr = rowOf.get(d.succ_id);
    const p = acts.find((a) => a.id === d.pred_id);
    const s = acts.find((a) => a.id === d.succ_id);
    if (pr == null || sr == null || !p?.es || !p.ef || !s?.es || !s.ef) return null;
    const fromEnd = d.dep_type === 'FS' || d.dep_type === 'FF';
    const toEnd = d.dep_type === 'FF' || d.dep_type === 'SF';
    const x1 = fromEnd ? x(p.ef) + px : x(p.es);
    const x2 = toEnd ? x(s.ef) + px : x(s.es);
    const y1 = HEAD + pr * ROW + ROW / 2;
    const y2 = HEAD + sr * ROW + ROW / 2;
    const mid = fromEnd ? x1 + 5 : x1 - 5;
    const tone = p.critical && s.critical ? colors.red : '#94A3B8';
    const dir = toEnd ? -1 : 1;
    return (
      <G key={d.id}>
        <Path d={`M${x1} ${y1} H${mid} V${y2} H${x2 - dir * 4}`} stroke={tone} strokeWidth={1} fill="none" />
        <Path d={`M${x2} ${y2} l${-dir * 5} -3 v6 z`} fill={tone} />
      </G>
    );
  });

  const bars = rows.map((r, i) => {
    const y = HEAD + i * ROW;
    if (r.kind === 'wbs') {
      const s = wbsSummary(r.wbs, wbs, acts);
      if (!s) return null;
      const x1 = x(s.start);
      const w = x(s.finish) + px - x1;
      return (
        <G key={r.wbs.id}>
          <Rect x={x1} y={y + 11} width={w} height={8} fill={colors.ink} />
          <Path d={`M${x1} ${y + 19} l0 5 l5 -5 z M${x1 + w} ${y + 19} l0 5 l-5 -5 z`} fill={colors.ink} />
        </G>
      );
    }
    const a = r.act;
    if (!a.es || !a.ef) return null;
    const tone = a.actual_finish ? colors.green : a.critical ? colors.red : colors.blue;
    const bl = a.bl_start && a.bl_finish ? <Rect x={x(a.bl_start)} y={y + 21} width={x(a.bl_finish) + px - x(a.bl_start)} height={4} rx={2} fill="#CBD5E1" /> : null;
    if (a.duration === 0) {
      const cx = x(a.es);
      return (
        <G key={a.id}>
          {bl}
          <Path d={`M${cx} ${y + 6} l7 8 l-7 8 l-7 -8 z`} fill={a.actual_finish ? colors.green : a.critical ? colors.red : colors.ink} />
          <SvgText fontFamily={FONT} x={cx + 10} y={y + 18} fontSize={10} fill={colors.text}>{a.es.slice(5)}</SvgText>
        </G>
      );
    }
    const x1 = x(a.es);
    const w = x(a.ef) + px - x1;
    // Finish later than the approved baseline (calendar days)
    const fv = a.bl_finish ? toDay(a.ef) - toDay(a.bl_finish) : null;
    return (
      <G key={a.id}>
        {bl}
        <Rect x={x1} y={y + 6} width={w} height={14} rx={3} fill={tone} opacity={0.28} />
        <Rect x={x1} y={y + 6} width={(w * Number(a.pct)) / 100} height={14} rx={3} fill={tone} />
        {a.total_float != null && a.total_float > 0 && !a.actual_finish ? (
          <Rect x={x1 + w} y={y + 12} width={a.total_float * px * (7 / 5)} height={2} fill="#94A3B8" />
        ) : null}
        <SvgText fontFamily={FONT} x={x1 + w + 4} y={y + 17} fontSize={10} fill={colors.text}>
          {[Number(a.pct) ? `${Math.round(Number(a.pct))}%` : '', fv && fv > 0 ? `+${fv} d` : ''].filter(Boolean).join('  ')}
        </SvgText>
      </G>
    );
  });

  return (
    <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: '#fff', overflow: 'hidden' }}>
      <View style={{ width: labelW, borderRightWidth: 1, borderRightColor: colors.line }}>
        <View style={{ height: HEAD, flexDirection: 'row', alignItems: 'flex-end', paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <Text style={{ width: nameW, paddingHorizontal: 8, fontSize: 11, fontWeight: '700', color: colors.muted }}>WBS / ACTIVITY</Text>
          {cols ? (
            <>
              <Text style={{ width: COL.s, paddingHorizontal: 4, fontSize: 11, fontWeight: '700', color: colors.muted }}>START</Text>
              <Text style={{ width: COL.f, paddingHorizontal: 4, fontSize: 11, fontWeight: '700', color: colors.muted }}>FINISH</Text>
              <Text style={{ width: COL.d, paddingHorizontal: 4, fontSize: 11, fontWeight: '700', color: colors.muted, textAlign: 'right' }}>DAYS</Text>
            </>
          ) : null}
        </View>
        {rows.map((r) => (
          <Fragment key={r.kind === 'wbs' ? r.wbs.id : r.act.id}>
            {r.kind === 'wbs' ? (
              <View style={{ height: ROW, flexDirection: 'row', backgroundColor: colors.soft }}>
                <View style={{ width: nameW, flexDirection: 'row', alignItems: 'center' }}>
                  <Pressable
                    disabled={!onWbsPress}
                    onPress={() => onWbsPress?.(r.wbs)}
                    style={{ flex: 1, minWidth: 0, justifyContent: 'center', paddingLeft: 8 + r.depth * 12, paddingRight: 4 }}
                  >
                    <Text numberOfLines={1} style={{ fontWeight: '700', color: colors.ink, fontSize: 12 }}>{`${r.wbs.code}  ${r.wbs.name}${onWbsPress ? '  ✎' : ''}`}</Text>
                  </Pressable>
                  {onAddActivity ? (
                    <Pressable onPress={() => onAddActivity(r.wbs)} accessibilityLabel={`Add an activity under ${r.wbs.code}`} style={{ paddingHorizontal: 8, height: ROW, justifyContent: 'center' }}>
                      <Text style={{ color: colors.blue, fontWeight: '700', fontSize: 14 }}>+</Text>
                    </Pressable>
                  ) : null}
                </View>
                {cols
                  ? (() => {
                      const sm = wbsSummary(r.wbs, wbs, acts);
                      return (
                        <>
                          {cell(COL.s, dm(sm?.start), { bold: true })}
                          {cell(COL.f, dm(sm?.finish), { bold: true })}
                          {cell(COL.d, '', { right: true })}
                        </>
                      );
                    })()
                  : null}
              </View>
            ) : (
              <View style={{ height: ROW, flexDirection: 'row' }}>
                <View style={{ width: nameW, flexDirection: 'row', alignItems: 'center' }}>
                  <Pressable
                    onPress={() => (onActivityEdit ? onActivityEdit(r.act) : router.push(`/execution/activity/${r.act.id}`))}
                    style={{ flex: 1, minWidth: 0, justifyContent: 'center', paddingLeft: 8 + r.depth * 12, paddingRight: 4 }}
                  >
                    <Text numberOfLines={1} style={{ fontSize: 12, color: r.act.critical ? colors.red : colors.text }}>
                      <Text style={{ color: colors.muted }}>{`${r.act.code}  `}</Text>
                      {r.act.name}
                      {onActivityEdit ? <Text style={{ color: colors.muted }}>{'  ✎'}</Text> : null}
                    </Text>
                  </Pressable>
                  {onActivityEdit ? (
                    <Pressable onPress={() => router.push(`/execution/activity/${r.act.id}`)} accessibilityLabel="Open the activity" style={{ paddingHorizontal: 8, height: ROW, justifyContent: 'center' }}>
                      <Text style={{ color: colors.blue, fontWeight: '700', fontSize: 14 }}>›</Text>
                    </Pressable>
                  ) : null}
                </View>
                {cols ? (
                  <Pressable disabled={!onDatesPress} onPress={() => onDatesPress?.(r.act)} style={{ flexDirection: 'row' }}>
                    {cell(COL.s, dm(r.act.es), { edit: !!onDatesPress })}
                    {cell(COL.f, dm(r.act.ef), { edit: !!onDatesPress })}
                    {cell(COL.d, r.act.duration === 0 ? '◆' : `${r.act.duration} d`, { right: true })}
                  </Pressable>
                ) : null}
              </View>
            )}
          </Fragment>
        ))}
      </View>
      <ScrollView horizontal style={{ flex: 1 }} contentOffset={{ x: Math.max(0, x(today) - 120), y: 0 }}>
        <Svg width={width} height={height}>
          <Line x1={0} x2={width} y1={HEAD} y2={HEAD} stroke={colors.line} />
          {head}
          {rows.map((r, i) => (r.kind === 'wbs' ? <Rect key={`bg${i}`} x={0} y={HEAD + i * ROW} width={width} height={ROW} fill={colors.soft} opacity={0.7} /> : null))}
          {arrows}
          {bars}
          {contractEnd ? <Line x1={x(contractEnd) + px} x2={x(contractEnd) + px} y1={HEAD - 10} y2={height} stroke={colors.ink} strokeDasharray="4 3" strokeWidth={1} /> : null}
          <Line x1={x(today)} x2={x(today)} y1={HEAD - 10} y2={height} stroke={colors.brand} strokeWidth={1.5} />
          <SvgText fontFamily={FONT} x={x(today) + 3} y={HEAD - 14} fontSize={9} fill={colors.brand}>today</SvgText>
        </Svg>
      </ScrollView>
    </View>
  );
}

export const ganttLegend = 'Red = critical path · blue = has float (grey tail) · green = finished · thin grey bar = approved baseline · ◆ milestone · red line = today · dashed = contract finish';
