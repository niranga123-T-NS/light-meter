import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Card, colors, Muted, Pill } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { byCode, programmeRows, trackingRow, varText, type Activity, type Wbs } from '@/lib/programme';

const COLS = [
  ['Activity', 260],
  ['Baseline start', 92],
  ['Baseline finish', 92],
  ['Actual / forecast start', 112],
  ['Actual / forecast finish', 116],
  ['Start var.', 70],
  ['Finish var.', 72],
  ['%', 50],
  ['Status', 150],
] as const;

const varTone = (v: number | null) => (v == null || v === 0 ? colors.text : v > 0 ? colors.red : colors.green);
const statusTone = (s: string) => (s === 'Done' ? colors.green : s.includes('behind') || s === 'Late to start' ? colors.red : s === 'In progress' ? colors.blue : colors.grey);

/** Baseline vs actual / forecast for every activity, grouped by WBS (tap a row to open the activity) */
export function TrackingTable({ wbs, acts, today }: { wbs: Wbs[]; acts: Activity[]; today: string }) {
  const rows = programmeRows(wbs, [...acts].sort(byCode));
  const cell = (w: number, child: React.ReactNode, right?: boolean, key?: string) => (
    <View key={key} style={{ width: w, paddingHorizontal: 6, paddingVertical: 6, alignItems: right ? 'flex-end' : 'flex-start', justifyContent: 'center' }}>{child}</View>
  );
  return (
    <Card style={{ padding: 0 }}>
      <ScrollView horizontal>
        <View>
          <View style={{ flexDirection: 'row', backgroundColor: colors.ink }}>
            {COLS.map(([h, w], i) => cell(w, <Text style={{ color: '#fff', fontWeight: '700', fontSize: 11 }}>{h}</Text>, i >= 5 && i <= 7, h))}
          </View>
          {rows.map((r) =>
            r.kind === 'wbs' ? (
              <View key={r.wbs.id} style={{ backgroundColor: colors.soft, paddingVertical: 6, paddingLeft: 8 + r.depth * 12 }}>
                <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 12 }}>{`${r.wbs.code}  ${r.wbs.name}`}</Text>
              </View>
            ) : (
              (() => {
                const a = r.act;
                const t = trackingRow(a, today);
                return (
                  <View key={a.id} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line }}>
                    {cell(
                      260,
                      <Text numberOfLines={1} style={{ fontSize: 12, color: a.critical && !a.actual_finish ? colors.red : colors.text }} onPress={() => router.push(`/execution/activity/${a.id}`)}>
                        <Text style={{ color: colors.muted }}>{`${a.code}  `}</Text>
                        {a.name}
                      </Text>,
                    )}
                    {cell(92, <Text style={{ fontSize: 12 }}>{fmtDate(a.bl_start)}</Text>)}
                    {cell(92, <Text style={{ fontSize: 12 }}>{fmtDate(a.bl_finish)}</Text>)}
                    {cell(112, <Text style={{ fontSize: 12, fontWeight: a.actual_start ? '700' : '400' }}>{fmtDate(t.start)}</Text>)}
                    {cell(116, <Text style={{ fontSize: 12, fontWeight: a.actual_finish ? '700' : '400' }}>{fmtDate(t.finish)}</Text>)}
                    {cell(70, <Text style={{ fontSize: 12, color: varTone(t.startVar) }}>{varText(t.startVar)}</Text>, true)}
                    {cell(72, <Text style={{ fontSize: 12, color: varTone(t.finishVar), fontWeight: (t.finishVar ?? 0) > 0 ? '700' : '400' }}>{varText(t.finishVar)}</Text>, true)}
                    {cell(50, <Text style={{ fontSize: 12 }}>{`${Math.round(Number(a.pct))}%`}</Text>, true)}
                    {cell(150, <Pill label={t.status} tone={statusTone(t.status)} />)}
                  </View>
                );
              })()
            ),
          )}
        </View>
      </ScrollView>
      <Muted style={{ padding: 8 }}>Bold dates are actual; others are the current forecast. Variance in calendar days against the approved baseline (+ = later).</Muted>
    </Card>
  );
}
