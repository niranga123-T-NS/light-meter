import { router } from 'expo-router';
import { Platform, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ListRow, Muted, Pill, Row, Section } from '@/components/ui';
import { openAttachment, pickDocument, pickImage, uploadAttachment } from '@/lib/files';
import { fmtDateTime } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import type { Attachment } from '@/lib/types';

/** One required document of an IPC or invoice (PDF / photos): upload while it can be changed, open, and the reviewer's ✎ Mark up. */
export function DocSlot({ title, entity, entityId, kind, files, canAdd, canMarkUp, required, onChange, markupEntity, markupId }: {
  title: string;
  entity: 'sub_cert' | 'sub_invoice' | 'sub_cert_var' | 'sub_invoice_var';
  entityId: string;
  kind: string;
  files: Attachment[];
  canAdd: boolean;
  canMarkUp: boolean;
  required?: boolean;
  onChange: () => void;
  /** The record the marked-up copy is kept with (defaults to this one) */
  markupEntity?: 'sub_cert' | 'sub_invoice';
  markupId?: string;
}) {
  const dialog = useDialog();
  const people = usePeople();
  const mine = files.filter((f) => f.kind === kind && f.entity_id === entityId);
  const add = async (photo: boolean, camera = false) => {
    const f = photo ? await pickImage(camera) : await pickDocument();
    if (!f) return;
    await dialog.run(async () => {
      await uploadAttachment(entity, entityId, kind, f);
      onChange();
    }, 'Attached');
  };
  return (
    <Section title={title} right={required ? <Pill label={mine.length ? '✓ Attached' : 'Required'} tone={mine.length ? colors.green : colors.amber} /> : null}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {mine.length ? (
          mine.map((f) => (
            <ListRow
              key={f.id}
              title={f.file_name}
              subtitle={`${people[f.uploaded_by]?.full_name ?? ''} · ${fmtDateTime(f.uploaded_at)}`}
              right={
                <Row gap={6}>
                  <Button small variant="secondary" title="Open" onPress={() => dialog.run(() => openAttachment(f))} />
                  {canMarkUp ? (
                    <Button
                      small
                      title="✎ Mark up"
                      onPress={() =>
                        Platform.OS === 'web'
                          ? router.push({ pathname: '/execution/sub-invoice/markup', params: { id: markupId ?? entityId, att: f.id, entity: markupEntity ?? entity } })
                          : dialog.toast('Mark up the copy on the website (computer or tablet browser)', 'error')
                      }
                    />
                  ) : null}
                </Row>
              }
            />
          ))
        ) : (
          <View style={{ padding: 12 }}>
            <Muted>Not attached yet.</Muted>
          </View>
        )}
      </Card>
      {canAdd ? (
        <Row wrap gap={8} style={{ marginTop: 8 }}>
          <Button small variant="secondary" title="+ PDF / file" onPress={() => add(false)} />
          <Button small variant="secondary" title="+ Photo" onPress={() => add(true)} />
          {Platform.OS !== 'web' ? <Button small variant="secondary" title="📷 Take photo" onPress={() => add(true, true)} /> : null}
        </Row>
      ) : null}
    </Section>
  );
}
