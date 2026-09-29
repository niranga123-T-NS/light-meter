// Shared UI building blocks. Mobile-first, readable outdoors, large touch targets.
import type { ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const colors = {
  primary: '#0B4F8A',
  primaryDark: '#083a66',
  primarySoft: '#E6EFF8',
  accent: '#F5A623',
  bg: '#F4F6F9',
  card: '#FFFFFF',
  text: '#1A2330',
  muted: '#5E6B7A',
  faint: '#97A3B1',
  border: '#DCE2EA',
  danger: '#C62828',
  dangerSoft: '#FDECEC',
  warning: '#B26A00',
  warningSoft: '#FFF4E0',
  success: '#2E7D32',
  successSoft: '#E8F5E9',
  info: '#1565C0',
  infoSoft: '#E3F0FC',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

/** Scrollable screen body with pull-to-refresh and keyboard handling. */
export function Screen({ children, onRefresh, refreshing, style, padded = true, footer }: {
  children: ReactNode; onRefresh?: () => void; refreshing?: boolean; style?: StyleProp<ViewStyle>; padded?: boolean; footer?: ReactNode;
}) {
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView
          contentContainerStyle={[padded && styles.padded, styles.maxWidth, style]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
        >
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section}>{children}</Text>
      {right}
    </View>
  );
}

export function Body({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return <Text style={[styles.body, style]} numberOfLines={numberOfLines}>{children}</Text>;
}

export function Muted({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return <Text style={[styles.muted, style]} numberOfLines={numberOfLines}>{children}</Text>;
}

export function Row({ children, style, gap = space.sm, wrap }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({ title, onPress, variant = 'primary', disabled, loading, style, small, icon }: {
  title: string; onPress?: () => void; variant?: ButtonVariant; disabled?: boolean; loading?: boolean;
  style?: StyleProp<ViewStyle>; small?: boolean; icon?: string;
}) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, small && styles.buttonSmall, { backgroundColor: v.bg, borderColor: v.border },
        (disabled || loading) && { opacity: 0.5 }, pressed && { opacity: 0.8 }, style]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : (
        <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: v.fg }]}>{icon ? `${icon}  ` : ''}{title}</Text>
      )}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: '#fff', border: colors.primary },
  secondary: { bg: '#fff', fg: colors.primary, border: colors.primary },
  danger: { bg: '#fff', fg: colors.danger, border: colors.danger },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
};

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';
const tones: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: '#EEF1F5', fg: colors.muted },
  info: { bg: colors.infoSoft, fg: colors.info },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  primary: { bg: colors.primarySoft, fg: colors.primary },
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function KeyValue({ label, value, onPress }: { label: string; value?: ReactNode; onPress?: () => void }) {
  const content = typeof value === 'string' || typeof value === 'number' || value === undefined || value === null
    ? <Text style={[styles.kvValue, onPress && { color: colors.primary }]}>{value === undefined || value === null || value === '' ? '–' : String(value)}</Text>
    : value;
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <View style={{ flex: 1.4 }}>{content}</View>
    </Pressable>
  );
}

export function ListItem({ title, subtitle, meta, right, onPress, left }: {
  title: string; subtitle?: string | null; meta?: string | null; right?: ReactNode; onPress?: () => void; left?: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.listItem, pressed && styles.pressed]}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.listTitle} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.muted} numberOfLines={2}>{subtitle}</Text> : null}
        {meta ? <Text style={[styles.muted, { fontSize: 12, marginTop: 2 }]} numberOfLines={1}>{meta}</Text> : null}
      </View>
      {right}
      {onPress ? <Text style={styles.chevron}>›</Text> : null}
    </Pressable>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={[styles.body, { fontWeight: '600' }]}>{title}</Text>
      {message ? <Text style={[styles.muted, { textAlign: 'center' }]}>{message}</Text> : null}
      {action}
    </View>
  );
}

export function Banner({ message, tone = 'info', action }: { message: string; tone?: Tone; action?: ReactNode }) {
  const t = tones[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg }]}>
      <Text style={[styles.body, { color: t.fg, flex: 1 }]}>{message}</Text>
      {action}
    </View>
  );
}

export function Stat({ label, value, tone = 'primary', onPress, hint }: { label: string; value: string | number; tone?: Tone; onPress?: () => void; hint?: string }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.stat, pressed && styles.pressed]}>
      <Text style={[styles.statValue, { color: tones[tone].fg }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {hint ? <Text style={[styles.muted, { fontSize: 11 }]}>{hint}</Text> : null}
    </Pressable>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.primary} />
      {label ? <Muted>{label}</Muted> : null}
    </View>
  );
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.sm }} />;
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  padded: { padding: space.lg, paddingBottom: 48, gap: space.md },
  maxWidth: { width: '100%', maxWidth: 1100, alignSelf: 'center' },
  footer: { padding: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card, flexDirection: 'row', gap: space.sm },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: space.lg, gap: space.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  pressed: { opacity: 0.7 },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  button: { minHeight: 48, borderRadius: 10, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  buttonSmall: { minHeight: 36, paddingHorizontal: space.md },
  buttonText: { fontSize: 16, fontWeight: '600' },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff' },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, color: colors.text },
  kv: { flexDirection: 'row', gap: space.md, paddingVertical: 6 },
  kvLabel: { flex: 1, fontSize: 13, color: colors.muted },
  kvValue: { fontSize: 14, color: colors.text },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg,
    backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  listTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  chevron: { fontSize: 22, color: colors.faint },
  empty: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  banner: { borderRadius: 10, padding: space.md, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stat: { flexGrow: 1, alignSelf: 'stretch', flexBasis: 140, backgroundColor: colors.card, borderRadius: 12, padding: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  statValue: { fontSize: 24, fontWeight: '700' },
  statLabel: { fontSize: 13, color: colors.muted },
});
