import { Pressable, Text, View } from 'react-native';

import { colors, space } from './ui';

export interface Bar { key: string; label: string; value: number; display?: string; secondary?: number; onPress?: () => void }

/** Simple horizontal bar chart (ranked list). Secondary value draws as an inner bar (e.g. weighted). */
export function BarList({ bars, emptyText = 'No data' }: { bars: Bar[]; emptyText?: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  if (bars.length === 0) return <Text style={{ color: colors.muted, fontSize: 13 }}>{emptyText}</Text>;
  return (
    <View style={{ gap: space.sm }}>
      {bars.map((b) => (
        <Pressable key={b.key} onPress={b.onPress} disabled={!b.onPress} style={{ gap: 3 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
            <Text style={{ fontSize: 13, color: b.onPress ? colors.primary : colors.text, flex: 1 }} numberOfLines={1}>{b.label}</Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{b.display ?? b.value}</Text>
          </View>
          <View style={{ height: 10, backgroundColor: '#EEF1F5', borderRadius: 5, overflow: 'hidden' }}>
            <View style={{ width: `${(b.value / max) * 100}%`, height: 10, backgroundColor: '#9CC0E4', borderRadius: 5 }}>
              {b.secondary !== undefined ? (
                <View style={{ width: `${b.value ? Math.min(100, (b.secondary / b.value) * 100) : 0}%`, height: 10, backgroundColor: colors.primary, borderRadius: 5 }} />
              ) : null}
            </View>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
