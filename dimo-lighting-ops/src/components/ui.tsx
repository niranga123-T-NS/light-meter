import { Image } from 'expo-image';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { avatarUrl } from '@/lib/files';
import { addDaysISO, fmtAmount, isISODate, SLA_COLOURS, todayISO } from '@/lib/format';
import type { SlaColour } from '@/lib/types';

export const colors = {
  brand: '#C8102E',
  brandDark: '#9E0C24',
  ink: '#111827',
  text: '#1F2937',
  muted: '#6B7280',
  faint: '#9CA3AF',
  line: '#E5E7EB',
  bg: '#F4F5F7',
  card: '#FFFFFF',
  soft: '#F9FAFB',
  blue: '#1D4ED8',
  green: SLA_COLOURS.green,
  amber: SLA_COLOURS.amber,
  red: SLA_COLOURS.red,
  grey: SLA_COLOURS.grey,
};

export const space = (n: number) => n * 4;

export function useWide() {
  const { width } = useWindowDimensions();
  return width >= 900;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
  maxWidth = 1200,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  maxWidth?: number;
}) {
  const inner = <View style={[styles.screenInner, { maxWidth }]}>{children}</View>;
  if (!scroll) return <View style={styles.screen}>{inner}</View>;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
    >
      {inner}
    </ScrollView>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <View style={{ marginTop: space(5) }}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Row({ children, gap = 8, wrap, style }: { children: ReactNode; gap?: number; wrap?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

/** Two-column grid on wide screens, single column on phones. */
export function Grid({ children, min = 280 }: { children: ReactNode; min?: number }) {
  const { width } = useWindowDimensions();
  const cols = Math.max(1, Math.min(4, Math.floor(Math.min(width, 1200) / min)));
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 }}>{wrapCols(children, cols)}</View>;
}

function wrapCols(children: ReactNode, cols: number) {
  const arr = Array.isArray(children) ? children.flat() : [children];
  return arr
    .filter(Boolean)
    .map((c, i) => (
      <View key={i} style={{ width: `${100 / cols}%`, padding: 6 }}>
        {c}
      </View>
    ));
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={styles.h1}>{children}</Text>;
}
export function H2({ children }: { children: ReactNode }) {
  return <Text style={styles.h2}>{children}</Text>;
}
export function Muted({ children, style, numberOfLines }: { children: ReactNode; style?: object; numberOfLines?: number }) {
  return (
    <Text style={[styles.muted, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}
export function Body({ children, style, numberOfLines }: { children: ReactNode; style?: object; numberOfLines?: number }) {
  return (
    <Text style={[styles.body, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function KeyValue({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <View style={[styles.kv, wide && { width: '100%' }]}>
      <Text style={styles.kvLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? <Text style={styles.kvValue}>{value}</Text> : value}
    </View>
  );
}

export function Stat({ label, value, tone, onPress }: { label: string; value: ReactNode; tone?: 'red' | 'amber' | 'green'; onPress?: () => void }) {
  return (
    <Card onPress={onPress} style={{ minHeight: 84 }}>
      <Text style={[styles.statValue, tone && { color: colors[tone] }]}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
type ButtonProps = {
  title: string;
  onPress?: () => unknown;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  small?: boolean;
  icon?: string;
};

export function Button({ title, onPress, variant = 'primary', disabled, small, icon }: ButtonProps) {
  const [busy, setBusy] = useState(false);
  const bg = { primary: colors.brand, secondary: '#fff', danger: colors.red, ghost: 'transparent' }[variant];
  const fg = variant === 'secondary' || variant === 'ghost' ? colors.ink : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={async () => {
        if (!onPress) return;
        setBusy(true);
        try {
          await onPress();
        } finally {
          setBusy(false);
        }
      }}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, borderColor: variant === 'secondary' ? colors.line : bg },
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <Text style={[styles.buttonText, small && { fontSize: 13 }, { color: fg }]}>
          {icon ? `${icon}  ` : ''}
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  maxLength,
  value,
  ...props
}: TextInputProps & { label: string; hint?: string; error?: string | null; required?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={{ color: colors.brand }}> *</Text> : null}
      </Text>
      <TextInput
        placeholderTextColor={colors.faint}
        value={value}
        maxLength={maxLength}
        {...props}
        style={[styles.input, props.multiline && { minHeight: 88, textAlignVertical: 'top' }, !!error && { borderColor: colors.red }]}
      />
      <Row style={{ justifyContent: 'space-between' }}>
        {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : <View />}
        {maxLength ? (
          <Text style={[styles.hint, (value?.length ?? 0) > maxLength * 0.9 && { color: colors.red }]}>
            {value?.length ?? 0}/{maxLength}
          </Text>
        ) : null}
      </Row>
    </View>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  required,
  hint,
  suffix,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  required?: boolean;
  hint?: string;
  suffix?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [focused, setFocused] = useState(false);
  // Money (an LKR / USD field) shows in full – 3,153,318.00 – except while it is being typed
  const money = suffix === 'LKR' || suffix === 'USD';
  // Follow external changes to the value without fighting the user's typing
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    if (value == null) setText('');
    else if (Number(text.replace(/,/g, '')) !== value) setText(String(value));
  }
  return (
    <Field
      label={suffix ? `${label} (${suffix})` : label}
      required={required}
      hint={hint}
      keyboardType="decimal-pad"
      value={money && !focused && value != null ? fmtAmount(value) : text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChangeText={(t) => {
        setText(t);
        const n = Number(t.replace(/,/g, ''));
        onChange(t.trim() === '' || Number.isNaN(n) ? null : n);
      }}
    />
  );
}

export function DateField({
  label,
  value,
  onChange,
  required,
  hint,
  quick = [0, 1, 7, 14],
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  required?: boolean;
  hint?: string;
  quick?: number[];
}) {
  const [text, setText] = useState(value ?? '');
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value ?? '');
  }
  const bad = text !== '' && !isISODate(text);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={{ color: colors.brand }}> *</Text> : null}
      </Text>
      <Row gap={6} wrap>
        <TextInput
          value={text}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.faint}
          onChangeText={(t) => {
            setText(t);
            if (t === '') onChange(null);
            else if (isISODate(t)) onChange(t);
          }}
          style={[styles.input, { minWidth: 140, flexGrow: 1 }, bad && { borderColor: colors.red }]}
          inputMode="numeric"
        />
        {quick.map((d) => (
          <Chip key={d} label={d === 0 ? 'Today' : `+${d}d`} onPress={() => onChange(addDaysISO(todayISO(), d))} />
        ))}
      </Row>
      {bad ? <Text style={styles.error}>Use the format YYYY-MM-DD</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export type Option = { value: string; label: string; group?: string | null; hint?: string };

export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  required,
  searchable,
  hint,
  disabled,
}: {
  label: string;
  value: string | null | undefined;
  options: Option[];
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  searchable?: boolean;
  hint?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={{ color: colors.brand }}> *</Text> : null}
      </Text>
      <Pressable disabled={disabled} onPress={() => setOpen(true)} style={[styles.input, styles.select, disabled && { opacity: 0.6 }]}>
        <Text style={{ color: current ? colors.text : colors.faint, flex: 1 }} numberOfLines={1}>
          {current?.label ?? placeholder}
        </Text>
        <Text style={{ color: colors.muted }}>▾</Text>
      </Pressable>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <PickerModal
        visible={open}
        title={label}
        options={options}
        searchable={searchable ?? options.length > 10}
        selected={value ? [value] : []}
        onClose={() => setOpen(false)}
        onPick={(v) => {
          onChange(v);
          setOpen(false);
        }}
      />
    </View>
  );
}

export function MultiSelect({
  label,
  values,
  options,
  onChange,
  max,
  hint,
}: {
  label: string;
  values: string[];
  options: Option[];
  onChange: (v: string[]) => void;
  max?: number;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable onPress={() => setOpen(true)} style={[styles.input, styles.select]}>
        <Text style={{ color: values.length ? colors.text : colors.faint, flex: 1 }} numberOfLines={2}>
          {values.length ? values.join(', ') : 'None'}
        </Text>
        <Text style={{ color: colors.muted }}>▾</Text>
      </Pressable>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <PickerModal
        visible={open}
        title={label}
        options={options}
        searchable={options.length > 10}
        selected={values}
        multi
        onClose={() => setOpen(false)}
        onPick={(v) => {
          if (values.includes(v)) onChange(values.filter((x) => x !== v));
          else if (!max || values.length < max) onChange([...values, v]);
        }}
      />
    </View>
  );
}

function PickerModal({
  visible,
  title,
  options,
  searchable,
  selected,
  multi,
  onClose,
  onPick,
}: {
  visible: boolean;
  title: string;
  options: Option[];
  searchable: boolean;
  selected: string[];
  multi?: boolean;
  onClose: () => void;
  onPick: (v: string) => void;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s) || o.group?.toLowerCase().includes(s)) : options;
  }, [q, options]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={styles.h2}>{title}</Text>
            <Button title={multi ? 'Done' : 'Close'} variant="ghost" small onPress={onClose} />
          </Row>
          {searchable ? (
            <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor={colors.faint} style={[styles.input, { marginBottom: 8 }]} />
          ) : null}
          <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
            {filtered.map((o, idx) => {
              const header = o.group && (idx === 0 || filtered[idx - 1].group !== o.group) ? o.group : null;
              const on = selected.includes(o.value);
              return (
                <View key={o.value}>
                  {header ? <Text style={styles.groupHeader}>{header}</Text> : null}
                  <Pressable onPress={() => onPick(o.value)} style={[styles.option, on && { backgroundColor: '#FDECEF' }]}>
                    <Text style={{ color: colors.text, flex: 1 }}>{o.label}</Text>
                    {o.hint ? <Text style={styles.hint}>{o.hint}</Text> : null}
                    {on ? <Text style={{ color: colors.brand, fontWeight: '700' }}>✓</Text> : null}
                  </Pressable>
                </View>
              );
            })}
            {!filtered.length ? <Muted>No matches</Muted> : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; badge?: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.seg, value === o.value && styles.segOn]}>
          <Text style={[styles.segText, value === o.value && { color: '#fff' }]}>{o.label}</Text>
          {o.badge ? <Badge count={o.badge} /> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function Chip({ label, onPress, on, tone }: { label: string; onPress?: () => void; on?: boolean; tone?: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, on && { backgroundColor: colors.ink, borderColor: colors.ink }, tone ? { backgroundColor: tone, borderColor: tone } : null]}
    >
      <Text style={[styles.chipText, (on || tone) && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={[styles.field, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
      <View style={[styles.checkbox, value && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
        {value ? <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✓</Text> : null}
      </View>
      <Text style={styles.body}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
export function Badge({ count, tone = colors.red }: { count: number; tone?: string }) {
  if (!count) return null;
  return (
    <View style={[styles.badge, { backgroundColor: tone }]}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export function Pill({ label, tone = colors.grey, solid }: { label: string; tone?: string; solid?: boolean }) {
  return (
    <View style={[styles.pill, { borderColor: tone, backgroundColor: solid ? tone : `${tone}18` }]}>
      <Text style={[styles.pillText, { color: solid ? '#fff' : tone }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function SlaDot({ colour, size = 10 }: { colour: SlaColour; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: SLA_COLOURS[colour] }} />;
}

export function Progress({ pct, colour = colors.brand }: { pct: number; colour?: string }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: colour }]} />
    </View>
  );
}

const AVATAR_TONES = ['#C8102E', '#1D4ED8', '#047857', '#7C3AED', '#B45309', '#0E7490', '#BE185D', '#374151'];

export function Avatar({ name, path, size = 32, ring }: { name?: string | null; path?: string | null; size?: number; ring?: SlaColour }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    avatarUrl(path).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [path]);
  const initials = (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  const tone = AVATAR_TONES[(name ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  const ringStyle = ring ? { borderWidth: 3, borderColor: SLA_COLOURS[ring] } : null;
  if (url) return <Image source={{ uri: url }} style={[{ width: size, height: size, borderRadius: size / 2 }, ringStyle]} />;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: tone, alignItems: 'center', justifyContent: 'center' }, ringStyle]}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ padding: 32, alignItems: 'center', gap: 8 }}>
      <ActivityIndicator color={colors.brand} />
      {label ? <Muted>{label}</Muted> : null}
    </View>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <View style={{ padding: 28, alignItems: 'center', gap: 8 }}>
      <Text style={[styles.body, { fontWeight: '600' }]}>{title}</Text>
      {hint ? <Muted style={{ textAlign: 'center' }}>{hint}</Muted> : null}
      {action}
    </View>
  );
}

export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBanner}>
      <Text style={{ color: colors.red }}>{message}</Text>
    </View>
  );
}

export function Notice({ children, tone = colors.blue }: { children: ReactNode; tone?: string }) {
  return (
    <View style={[styles.notice, { borderLeftColor: tone, backgroundColor: `${tone}10` }]}>
      {typeof children === 'string' ? <Text style={styles.body}>{children}</Text> : children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tables (web-friendly list rows)
// ---------------------------------------------------------------------------
export function ListRow({
  title,
  subtitle,
  right,
  left,
  onPress,
  highlight,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  left?: ReactNode;
  onPress?: () => void;
  highlight?: string;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.listRow, highlight ? { borderLeftColor: highlight, borderLeftWidth: 4 } : null, pressed && onPress && { backgroundColor: colors.soft }]}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? (
          <Text style={[styles.body, { fontWeight: '600' }]} numberOfLines={1}>
            {title}
          </Text>
        ) : (
          title
        )}
        {subtitle ? typeof subtitle === 'string' ? <Muted>{subtitle}</Muted> : subtitle : null}
      </View>
      {right}
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenInner: { width: '100%', alignSelf: 'center', padding: space(4) },
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: space(4),
    borderWidth: 1,
    borderColor: colors.line,
    ...(Platform.OS === 'web' ? { boxShadow: '0 1px 2px rgba(0,0,0,0.04)' } : {}),
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(2) },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  h1: { fontSize: 22, fontWeight: '700', color: colors.ink },
  h2: { fontSize: 17, fontWeight: '700', color: colors.ink },
  body: { fontSize: 14, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  kv: { width: '50%', paddingVertical: 6, paddingRight: 8 },
  kvLabel: { fontSize: 12, color: colors.muted, marginBottom: 2 },
  kvValue: { fontSize: 14, color: colors.text },
  statValue: { fontSize: 26, fontWeight: '700', color: colors.ink },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    minHeight: 42,
  },
  buttonSmall: { paddingHorizontal: 10, paddingVertical: 6, minHeight: 32 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  field: { marginBottom: space(3) },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  select: { flexDirection: 'row', alignItems: 'center', minHeight: 42 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 3 },
  error: { fontSize: 12, color: colors.red, marginTop: 3 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: '#fff', borderRadius: 12, padding: 16, width: '100%', maxWidth: 560, alignSelf: 'center' },
  groupHeader: { fontSize: 12, fontWeight: '700', color: colors.muted, marginTop: 10, marginBottom: 4, textTransform: 'uppercase' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 6 },
  seg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
  },
  segOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  chipText: { fontSize: 12, color: colors.text, fontWeight: '600' },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontWeight: '700' },
  progressTrack: { height: 6, backgroundColor: colors.line, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  errorBanner: { backgroundColor: '#FDECEC', borderRadius: 8, padding: 12, marginBottom: 12 },
  notice: { borderLeftWidth: 4, borderRadius: 6, padding: 12, marginBottom: 12 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
});
