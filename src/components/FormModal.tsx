import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, colors, space } from './ui';

/** Slide-up modal with a form body and Save / Cancel. */
export function FormModal({ visible, title, onClose, onSave, saveLabel = 'Save', saving, children, saveDisabled }: {
  visible: boolean; title: string; onClose: () => void; onSave: () => void; saveLabel?: string; saving?: boolean;
  children: ReactNode; saveDisabled?: boolean;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={s.header}>
          <Button small variant="ghost" title="Cancel" onPress={onClose} />
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          <Button small title={saveLabel} onPress={onSave} loading={saving} disabled={saveDisabled} />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  title: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center', color: colors.text },
  body: { padding: space.lg, gap: space.md, paddingBottom: 60, width: '100%', maxWidth: 800, alignSelf: 'center' },
});
