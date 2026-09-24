import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { HistoryEntry } from '../history';
import { categorize } from '../useLightLevel';
import { formatValue, Unit, unitLabel } from '../format';
import { LiveChart } from './LiveChart';
import { Button, Card, colors, SectionTitle, Stat } from './ui';

const CHART_ENTRIES = 40;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export function HistoryPanel({
  entries,
  unit,
  onRemove,
  onClear,
}: {
  entries: HistoryEntry[];
  unit: Unit;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (entries.length === 0) {
    return (
      <Card>
        <SectionTitle
          title="No saved readings yet"
          hint="On the Meter tab, tap “Save reading” to record the current light level. Saved readings stay on this device."
        />
      </Card>
    );
  }

  const values = entries.map((e) => e.lux);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const chartEntries = entries.slice(0, CHART_ENTRIES).reverse();

  const confirmClear = () =>
    Alert.alert('Clear history?', 'This deletes all saved readings.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: onClear },
    ]);

  return (
    <>
      <View style={styles.statsRow}>
        <Stat label="Saved" value={String(entries.length)} />
        <Stat label="Min" value={formatValue(Math.min(...values), unit)} />
        <Stat label="Avg" value={formatValue(avg, unit)} />
        <Stat label="Max" value={formatValue(Math.max(...values), unit)} />
      </View>

      <Card>
        <SectionTitle title={`Last ${chartEntries.length} saved readings`} />
        <LiveChart
          samples={chartEntries.map((e) => e.lux)}
          capacity={CHART_ENTRIES}
          startLabel={formatTime(chartEntries[0].timestamp)}
          endLabel={formatTime(chartEntries[chartEntries.length - 1].timestamp)}
        />
      </Card>

      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {entries.map((e, i) => {
          const cat = categorize(e.lux);
          return (
            <View key={e.id} style={[styles.row, i > 0 && styles.rowDivider]}>
              <View style={[styles.dot, { backgroundColor: cat.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowValue}>
                  {formatValue(e.lux, unit)} <Text style={styles.rowUnit}>{unitLabel(unit)}</Text>
                </Text>
                <Text style={styles.rowMeta}>
                  {formatTime(e.timestamp)} · {cat.label} · {e.source === 'camera' ? 'camera' : 'sensor'}
                </Text>
              </View>
              <Pressable onPress={() => onRemove(e.id)} hitSlop={12} accessibilityLabel="Delete reading">
                <Text style={styles.delete}>✕</Text>
              </Pressable>
            </View>
          );
        })}
      </Card>

      <View style={{ flexDirection: 'row' }}>
        <Button label="Clear history" onPress={confirmClear} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.raised },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowValue: { color: colors.text, fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rowUnit: { color: colors.muted, fontSize: 13, fontWeight: '400' },
  rowMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  delete: { color: colors.faint, fontSize: 16, paddingHorizontal: 4 },
});
