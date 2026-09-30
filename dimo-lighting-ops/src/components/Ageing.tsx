import { Text, View } from 'react-native';
import { AGEING_COLOURS } from '@/lib/format';

/** Ageing category chip (Section 12.3) – colour plus the day range as text, never colour alone. */
export function AgeingChip({ bucket, legal }: { bucket: string; legal?: boolean }) {
  const c = AGEING_COLOURS[bucket] ?? AGEING_COLOURS['1-30'];
  return (
    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
      <View style={{ backgroundColor: c.bg, borderWidth: c.border ? 2 : 0, borderColor: c.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
        <Text style={{ color: c.fg, fontSize: 11, fontWeight: '700' }}>{c.label}</Text>
      </View>
      {legal ? (
        <View style={{ backgroundColor: '#111', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>LEGAL</Text>
        </View>
      ) : null}
    </View>
  );
}
