import { StyleSheet, Text, View } from 'react-native';
import { categorize } from '../useLightLevel';
import { logFraction } from '../format';
import { colors } from './ui';

const GRID = [
  { label: '100k', lux: 100000 },
  { label: '1k', lux: 1000 },
  { label: '10', lux: 10 },
];

// Bar chart of recent readings on a log scale (1 lux – 100k lux).
// Plain Views keep it dependency-free and cheap to re-render at a few Hz.
export function LiveChart({
  samples,
  capacity,
  startLabel,
  endLabel,
  height = 120,
}: {
  samples: number[];
  capacity: number;
  startLabel: string;
  endLabel: string;
  height?: number;
}) {
  const padded = Array.from({ length: Math.max(0, capacity - samples.length) }, () => null as number | null).concat(samples.slice(-capacity));

  return (
    <View>
      <View style={[styles.plot, { height }]}>
        {GRID.map(({ label, lux }) => (
          <View key={label} style={[styles.gridLine, { top: (1 - logFraction(lux)) * height }]}>
            <Text style={styles.gridLabel}>{label}</Text>
          </View>
        ))}
        <View style={styles.bars}>
          {padded.map((lux, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                lux != null && {
                  height: `${Math.max(2, logFraction(lux) * 100)}%`,
                  backgroundColor: categorize(lux).color,
                },
              ]}
            />
          ))}
        </View>
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisText}>{startLabel}</Text>
        <Text style={styles.axisText}>{endLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: { position: 'relative', justifyContent: 'flex-end' },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.raised,
  },
  gridLabel: { color: colors.faint, fontSize: 10, marginTop: 2 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: '100%', gap: 1, paddingLeft: 28 },
  bar: { flex: 1, height: 0, borderRadius: 1 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingLeft: 28 },
  axisText: { color: colors.faint, fontSize: 11 },
});
