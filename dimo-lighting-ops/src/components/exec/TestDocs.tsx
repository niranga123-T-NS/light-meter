import { Platform, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, colors, Muted, Row } from '@/components/ui';
import { openAttachment, pickDocument, pickImage, uploadAttachment, type PickedFile } from '@/lib/files';
import { fmtDateTime } from '@/lib/format';
import type { Attachment } from '@/lib/types';

/** Categories of test reading documents (several files each) */
export const TEST_DOC_KINDS: { kind: string; label: string; hint: string }[] = [
  { kind: 'test_readings', label: 'Readings sheet', hint: 'The filled test form / readings schedule' },
  { kind: 'test_printout', label: 'Instrument printout / export', hint: 'PDF or file exported from the tester' },
  { kind: 'test_photo', label: 'Photos of the instrument display', hint: 'One photo per reading if needed' },
  { kind: 'test_sheet', label: 'Witness-signed test sheet', hint: 'Signed by the client / consultant' },
  { kind: 'test_other', label: 'Other', hint: 'Lux plots, drawings, notes' },
];

/** Pick a reading document (PDF / file or photo) */
export async function pickTestDoc(photo: boolean, camera = false): Promise<PickedFile | null> {
  return photo ? pickImage(camera) : pickDocument();
}

/** A test's reading documents grouped by category – each downloadable; more can be added while allowed. */
export function TestDocs({ testId, files, canUpload, onChange }: { testId: string; files: Attachment[]; canUpload: boolean; onChange: () => void }) {
  const dialog = useDialog();
  const add = async (kind: string, photo: boolean, camera = false) => {
    const f = await pickTestDoc(photo, camera);
    if (!f) return;
    await dialog.run(async () => {
      await uploadAttachment('test_record', testId, kind, f);
      onChange();
    }, 'Uploaded');
  };
  const known = TEST_DOC_KINDS.map((k) => k.kind);
  const groups = TEST_DOC_KINDS.map((k) => ({ ...k, files: files.filter((f) => f.kind === k.kind || (k.kind === 'test_other' && !known.includes(f.kind))) }));
  return (
    <View style={{ marginTop: 6 }}>
      <Text style={{ fontWeight: '700', color: colors.ink }}>Reading documents</Text>
      {groups
        .filter((g) => g.files.length || canUpload)
        .map((g) => (
          <View key={g.kind} style={{ paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <Row wrap gap={6} style={{ alignItems: 'center' }}>
              <Text style={{ color: colors.ink, fontWeight: '600', minWidth: 210 }}>{`${g.label} (${g.files.length})`}</Text>
              {g.files.map((f) => (
                <Button key={f.id} small variant="secondary" title={`⬇ ${f.file_name}`} onPress={() => dialog.run(() => openAttachment(f))} />
              ))}
              {canUpload ? (
                <>
                  <Button small variant="ghost" title="+ File" onPress={() => add(g.kind, false)} />
                  <Button small variant="ghost" title="+ Photo" onPress={() => add(g.kind, true)} />
                  {Platform.OS !== 'web' ? <Button small variant="ghost" title="📷" onPress={() => add(g.kind, true, true)} /> : null}
                </>
              ) : null}
            </Row>
            {g.files.length ? <Muted>{`last added ${fmtDateTime(g.files[0].uploaded_at)}`}</Muted> : null}
          </View>
        ))}
      {!files.length && !canUpload ? <Muted>No reading documents uploaded.</Muted> : null}
    </View>
  );
}
