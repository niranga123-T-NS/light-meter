import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { Button, colors, DateField, Field, Muted, MultiSelect, Row, Select, styles, type Option } from './ui';

// Cross-platform dialogs: confirm, prompt with fields (reasons are mandatory throughout the SRS), toast.

export type PromptField =
  | { key: string; label: string; type?: 'text' | 'multiline' | 'password'; required?: boolean; maxLength?: number; initial?: string; hint?: string }
  | { key: string; label: string; type: 'date'; required?: boolean; initial?: string; hint?: string }
  | { key: string; label: string; type: 'select'; options: Option[]; required?: boolean; initial?: string; hint?: string }
  /** Several choices; the value comes back comma-separated */
  | { key: string; label: string; type: 'multiselect'; options: Option[]; required?: boolean; initial?: string; hint?: string };

type PromptOptions = { title: string; message?: string; fields?: PromptField[]; confirmLabel?: string; danger?: boolean };

type DialogApi = {
  confirm: (title: string, message?: string, opts?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<Record<string, string> | null>;
  toast: (message: string, tone?: 'ok' | 'error') => void;
  /** Runs an action and shows its error (or a success message) as a toast. */
  run: (action: () => Promise<unknown>, success?: string) => Promise<boolean>;
};

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(PromptOptions & { mode: 'confirm' | 'prompt' }) | null>(null);
  const { height } = useWindowDimensions();
  const [values, setValues] = useState<Record<string, string>>({});
  const [toastMsg, setToastMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const resolver = useRef<((v: Record<string, string> | null) => void) | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback((opts: PromptOptions, mode: 'confirm' | 'prompt') => {
    setValues(Object.fromEntries((opts.fields ?? []).map((f) => [f.key, f.initial ?? ''])));
    setState({ ...opts, mode });
    return new Promise<Record<string, string> | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: Record<string, string> | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setState(null);
  };

  const toast = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    setToastMsg({ text, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), tone === 'error' ? 6000 : 3000);
  }, []);

  const api: DialogApi = {
    confirm: async (title, message, opts) => (await open({ title, message, ...opts }, 'confirm')) !== null,
    prompt: (opts) => open(opts, 'prompt'),
    toast,
    run: async (action, success) => {
      try {
        await action();
        if (success) toast(success);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
        return false;
      }
    },
  };

  const missing = (state?.fields ?? []).some((f) => f.required && !values[f.key]?.trim());

  return (
    <DialogContext.Provider value={api}>
      {children}
      <Modal visible={!!state} transparent animationType="fade" onRequestClose={() => close(null)}>
        <Pressable style={styles.backdrop} onPress={() => close(null)}>
          {/* Fits the window: the title and the buttons stay in view, only the fields scroll */}
          <Pressable style={[styles.sheet, { maxHeight: Math.max(240, height - 32), flexShrink: 1 }, Platform.OS === 'web' ? ({ maxHeight: 'calc(100dvh - 32px)' } as object) : null]} onPress={() => undefined}>
            <Text style={[styles.h2, { marginBottom: 6 }]}>{state?.title}</Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 4 }}>
              {state?.message ? <Muted style={{ marginBottom: 12 }}>{state.message}</Muted> : null}
              {(state?.fields ?? []).map((f) =>
                f.type === 'date' ? (
                  <DateField key={f.key} label={f.label} required={f.required} hint={f.hint} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v ?? '' }))} />
                ) : f.type === 'multiselect' ? (
                  <MultiSelect
                    key={f.key}
                    label={f.required ? `${f.label} *` : f.label}
                    hint={f.hint}
                    options={f.options}
                    values={(values[f.key] ?? '').split(',').filter(Boolean)}
                    onChange={(v) => setValues((s) => ({ ...s, [f.key]: v.join(',') }))}
                  />
                ) : f.type === 'select' ? (
                  <Select key={f.key} label={f.label} required={f.required} hint={f.hint} options={f.options} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
                ) : (
                  <Field
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    hint={f.hint}
                    multiline={f.type === 'multiline'}
                    secureTextEntry={f.type === 'password'}
                    autoCapitalize={f.type === 'password' ? 'none' : undefined}
                    maxLength={'maxLength' in f ? f.maxLength : undefined}
                    value={values[f.key]}
                    onChangeText={(t) => setValues((s) => ({ ...s, [f.key]: t }))}
                  />
                ),
              )}
            </ScrollView>
            <Row style={{ justifyContent: 'flex-end', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
              <Button title="Cancel" variant="secondary" onPress={() => close(null)} />
              <Button
                title={state?.confirmLabel ?? (state?.mode === 'confirm' ? 'Confirm' : 'Save')}
                variant={state?.danger ? 'danger' : 'primary'}
                disabled={missing}
                onPress={() => close(values)}
              />
            </Row>
          </Pressable>
        </Pressable>
      </Modal>
      {toastMsg ? (
        <View pointerEvents="none" style={{ position: 'absolute', bottom: 90, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ backgroundColor: toastMsg.tone === 'error' ? colors.red : colors.ink, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, maxWidth: 520, marginHorizontal: 16 }}>
            <Text style={{ color: '#fff' }}>{toastMsg.text}</Text>
          </View>
        </View>
      ) : null}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside DialogProvider');
  return ctx;
}
