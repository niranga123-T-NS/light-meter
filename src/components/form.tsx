// Form controls: labelled fields with required markers, searchable selects,
// date inputs with quick picks. Dates are typed as YYYY-MM-DD so they work
// the same on iOS, Android and web.
import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addDaysIso, fmtDate, fromLocalInput, isIsoDate, todayIso, toLocalInput } from '@/lib/format';

import { Button, Chip, colors, Muted, Row, space } from './ui';

export interface Option { value: string; label: string; subtitle?: string }

export function Field({ label, required, error, hint, children }: {
  label: string; required?: boolean; error?: string | null; hint?: string; children: ReactNode;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>
        {label}
        {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
      </Text>
      {children}
      {error ? <Text style={s.error}>{error}</Text> : hint ? <Muted style={{ fontSize: 12 }}>{hint}</Muted> : null}
    </View>
  );
}

export function TextField({ label, value, onChange, required, multiline, placeholder, error, hint, keyboardType, autoCapitalize, secure, editable = true }: {
  label: string; value?: string | null; onChange: (v: string) => void; required?: boolean; multiline?: boolean;
  placeholder?: string; error?: string | null; hint?: string; keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words'; secure?: boolean; editable?: boolean;
}) {
  return (
    <Field label={label} required={required} error={error} hint={hint}>
      <TextInput
        value={value ?? ''}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secure}
        editable={editable}
        style={[s.input, multiline && s.multiline, !!error && { borderColor: colors.danger }, !editable && { backgroundColor: '#F0F2F5' }]}
      />
    </Field>
  );
}

export function NumberField({ label, value, onChange, required, hint, error }: {
  label: string; value?: number | null; onChange: (v: number | null) => void; required?: boolean; hint?: string; error?: string | null;
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  return (
    <TextField
      label={label}
      required={required}
      hint={hint}
      error={error}
      value={text}
      keyboardType="decimal-pad"
      onChange={(t) => {
        const cleaned = t.replace(/[^0-9.]/g, '');
        setText(cleaned);
        onChange(cleaned === '' ? null : Number(cleaned));
      }}
    />
  );
}

export function DateField({ label, value, onChange, required, hint, quick = true }: {
  label: string; value?: string | null; onChange: (v: string | null) => void; required?: boolean; hint?: string; quick?: boolean;
}) {
  const [text, setText] = useState(value ?? '');
  const valid = text === '' || isIsoDate(text);
  const set = (v: string | null) => {
    setText(v ?? '');
    onChange(v);
  };
  return (
    <Field label={label} required={required} error={valid ? null : 'Use YYYY-MM-DD'} hint={hint ?? (value ? fmtDate(value) : undefined)}>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          if (t === '') onChange(null);
          else if (isIsoDate(t)) onChange(t);
        }}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.faint}
        keyboardType="numbers-and-punctuation"
        style={[s.input, !valid && { borderColor: colors.danger }]}
      />
      {quick ? (
        <Row wrap style={{ marginTop: 6 }}>
          <Chip label="Today" onPress={() => set(todayIso())} />
          <Chip label="+1 day" onPress={() => set(addDaysIso(todayIso(), 1))} />
          <Chip label="+7 days" onPress={() => set(addDaysIso(todayIso(), 7))} />
          <Chip label="+30 days" onPress={() => set(addDaysIso(todayIso(), 30))} />
          {value ? <Chip label="Clear" onPress={() => set(null)} /> : null}
        </Row>
      ) : null}
    </Field>
  );
}

/** Date and time in Asia/Colombo, stored as an ISO timestamp. */
export function DateTimeField({ label, value, onChange, required, hint }: {
  label: string; value?: string | null; onChange: (v: string | null) => void; required?: boolean; hint?: string;
}) {
  const [text, setText] = useState(toLocalInput(value));
  const parsed = text ? fromLocalInput(text) : null;
  const valid = text === '' || !!parsed;
  return (
    <Field label={label} required={required} error={valid ? null : 'Use YYYY-MM-DD HH:mm'} hint={hint ?? 'Colombo time, e.g. 2026-10-02 14:30'}>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          if (t === '') onChange(null);
          else {
            const iso = fromLocalInput(t);
            if (iso) onChange(iso);
          }
        }}
        placeholder="YYYY-MM-DD HH:mm"
        placeholderTextColor={colors.faint}
        keyboardType="numbers-and-punctuation"
        style={[s.input, !valid && { borderColor: colors.danger }]}
      />
    </Field>
  );
}

export function SwitchField({ label, value, onChange, hint }: { label: string; value?: boolean | null; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <View style={[s.field, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.label}>{label}</Text>
        {hint ? <Muted style={{ fontSize: 12 }}>{hint}</Muted> : null}
      </View>
      <Switch value={!!value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.border }} />
    </View>
  );
}

export function SegmentField({ label, value, options, onChange, required }: {
  label: string; value?: string | null; options: Option[]; onChange: (v: string | null) => void; required?: boolean;
}) {
  return (
    <Field label={label} required={required}>
      <Row wrap>
        {options.map((o) => (
          <Chip key={o.value} label={o.label} selected={value === o.value} onPress={() => onChange(value === o.value ? null : o.value)} />
        ))}
      </Row>
    </Field>
  );
}

/** Full-screen searchable list used by selects and entity pickers. */
export function SearchModal({ visible, title, options, onClose, onSelect, selected, multi, onCreate, createLabel, emptyText, onDone }: {
  visible: boolean; title: string; options: Option[]; onClose: () => void; onSelect: (o: Option) => void;
  selected?: string[]; multi?: boolean; onCreate?: (query: string) => void; createLabel?: string; emptyText?: string; onDone?: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? options.filter((o) => `${o.label} ${o.subtitle ?? ''}`.toLowerCase().includes(t)) : options;
    return list.slice(0, 300);
  }, [q, options]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={s.modalHeader}>
          <Text style={{ fontSize: 17, fontWeight: '700', flex: 1 }}>{title}</Text>
          <Button small variant="ghost" title={multi ? 'Done' : 'Close'} onPress={() => { onDone?.(); onClose(); }} />
        </View>
        <View style={{ padding: space.md }}>
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            placeholder="Search…"
            placeholderTextColor={colors.faint}
            style={s.input}
            autoCorrect={false}
          />
        </View>
        {onCreate ? (
          <Pressable style={s.createRow} onPress={() => { onCreate(q.trim()); setQ(''); }}>
            <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 15 }}>＋ {createLabel ?? 'Create new'}{q.trim() ? `: “${q.trim()}”` : ''}</Text>
          </Pressable>
        ) : null}
        <FlatList
          data={filtered}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(o) => o.value}
          ListEmptyComponent={<Muted style={{ padding: space.lg, textAlign: 'center' }}>{emptyText ?? 'Nothing found'}</Muted>}
          renderItem={({ item }) => {
            const isSel = selected?.includes(item.value);
            return (
              <Pressable
                style={({ pressed }) => [s.option, pressed && { backgroundColor: colors.primarySoft }]}
                onPress={() => {
                  onSelect(item);
                  if (!multi) {
                    setQ('');
                    onClose();
                  }
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, color: colors.text, fontWeight: isSel ? '700' : '400' }}>{item.label}</Text>
                  {item.subtitle ? <Muted>{item.subtitle}</Muted> : null}
                </View>
                {isSel ? <Text style={{ color: colors.primary, fontSize: 18 }}>✓</Text> : null}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

export function SelectField({ label, value, options, onChange, required, placeholder, hint, error, allowClear = true, onCreate, createLabel }: {
  label: string; value?: string | null; options: Option[]; onChange: (v: string | null) => void; required?: boolean;
  placeholder?: string; hint?: string; error?: string | null; allowClear?: boolean; onCreate?: (q: string) => void; createLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Field label={label} required={required} hint={hint} error={error}>
      <Pressable onPress={() => setOpen(true)} style={[s.input, s.select, !!error && { borderColor: colors.danger }]}>
        <Text style={{ flex: 1, fontSize: 15, color: current ? colors.text : colors.faint }} numberOfLines={1}>
          {current?.label ?? (value ? value : placeholder ?? 'Select…')}
        </Text>
        {value && allowClear ? (
          <Pressable hitSlop={10} onPress={() => onChange(null)}><Text style={{ color: colors.faint, fontSize: 16 }}>✕</Text></Pressable>
        ) : <Text style={{ color: colors.faint }}>▾</Text>}
      </Pressable>
      <SearchModal visible={open} title={label} options={options} selected={value ? [value] : []}
        onClose={() => setOpen(false)} onSelect={(o) => onChange(o.value)} onCreate={onCreate} createLabel={createLabel} />
    </Field>
  );
}

export function MultiSelectField({ label, values, options, onChange, required, hint, onCreate, createLabel }: {
  label: string; values: string[]; options: Option[]; onChange: (v: string[]) => void; required?: boolean; hint?: string;
  onCreate?: (q: string) => void; createLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = values.map((v) => options.find((o) => o.value === v) ?? { value: v, label: v });
  return (
    <Field label={label} required={required} hint={hint}>
      <Row wrap>
        {chosen.map((o) => (
          <Chip key={o.value} label={`${o.label}  ✕`} selected onPress={() => onChange(values.filter((v) => v !== o.value))} />
        ))}
        <Chip label="＋ Add" onPress={() => setOpen(true)} />
      </Row>
      <SearchModal visible={open} multi title={label} options={options} selected={values}
        onClose={() => setOpen(false)} onCreate={onCreate ? (q) => { setOpen(false); onCreate(q); } : undefined} createLabel={createLabel}
        onSelect={(o) => onChange(values.includes(o.value) ? values.filter((v) => v !== o.value) : [...values, o.value])} />
    </Field>
  );
}

const s = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: space.md,
    paddingVertical: 10, fontSize: 15, color: colors.text, backgroundColor: '#fff' },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  select: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  error: { color: colors.danger, fontSize: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: '#fff' },
  option: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: 14, backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  createRow: { paddingHorizontal: space.lg, paddingVertical: 14, backgroundColor: colors.primarySoft },
});
