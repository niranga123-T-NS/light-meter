import { Pressable, StyleSheet, Text, View } from 'react-native';

export const colors = {
  bg: '#0e0f13',
  card: '#181a21',
  raised: '#262933',
  active: '#3a3e4a',
  text: '#ffffff',
  textSoft: '#e6e8ee',
  muted: '#8a8f9c',
  faint: '#5d6270',
  accent: '#f5c542',
  danger: '#f5624a',
};

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 },
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

export function Segment<T extends string | number>({
  options,
  value,
  onChange,
  label = String,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label?: (v: T) => string;
}) {
  return (
    <View style={styles.segment}>
      {options.map((o) => (
        <Pressable
          key={String(o)}
          onPress={() => onChange(o)}
          style={[styles.segmentItem, value === o && styles.segmentActive]}
        >
          <Text style={[styles.segmentText, value === o && styles.segmentTextActive]} numberOfLines={1}>
            {label(o)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 12 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  sectionHint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  stat: { flex: 1, backgroundColor: colors.card, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  statLabel: { color: colors.muted, fontSize: 12, marginTop: 2 },
  button: { flex: 1, backgroundColor: colors.raised, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonText: { color: colors.textSoft, fontSize: 16, fontWeight: '600' },
  buttonTextPrimary: { color: '#1a1a1a' },
  segment: { flexDirection: 'row', backgroundColor: colors.raised, borderRadius: 10, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.active },
  segmentText: { color: colors.muted, fontSize: 14, fontWeight: '500' },
  segmentTextActive: { color: colors.text },
});
