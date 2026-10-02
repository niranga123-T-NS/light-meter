import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { listAttachments, openAttachment, pickDocument, pickImage, uploadAttachment } from '@/lib/files';
import { fmtDateTime, human } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import type { Attachment } from '@/lib/types';
import { useDialog } from './dialog';
import { Button, Card, ListRow, Muted, Row, Section } from './ui';

export const KIND_LABELS: Record<string, string> = {
  inquiry_doc: 'Inquiry document',
  visit_photo: 'Photo / business card',
  visit_doc: 'Document',
  tender_doc: 'Tender document',
  design_draft: 'Draft',
  design_pack: 'Design pack',
  quotation_draft: 'Draft quotation (PDF)',
  costing_sheet: 'Costing sheet (restricted)',
  quotation_final: 'Final quotation PDF',
  compliance_sheet: 'Compliance sheet',
  technical_data: 'Technical data sheets',
  clarification: 'Clarification file',
  client_markup: 'Client comments / mark-ups',
  delivery_note: 'Delivery note / handover photo',
  sample_doc: 'Sample document',
  deadline_extension: 'Extension notice',
  retention_doc: 'Retention document',
  bond_doc: 'Bond document',
};

/**
 * Lists files on a record and lets permitted users add files of the given kinds.
 * Every version is kept with who uploaded it and when (Section 7.5).
 */
export function Attachments({
  entityType,
  entityId,
  kinds,
  title = 'Files',
  canUpload = true,
  allowCamera,
  onChange,
  extraEntityIds,
}: {
  entityType: string;
  entityId: string;
  kinds: string[];
  title?: string;
  canUpload?: boolean;
  allowCamera?: boolean;
  onChange?: (files: Attachment[]) => void;
  extraEntityIds?: string[];
}) {
  const dialog = useDialog();
  const people = usePeople();
  const [files, setFiles] = useState<Attachment[]>([]);
  const ids = [entityId, ...(extraEntityIds ?? [])];
  const idsKey = ids.join(',');

  const reload = useCallback(async () => {
    const list = await listAttachments(entityType, idsKey.split(','));
    setFiles(list);
    onChange?.(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, idsKey]);

  useEffect(() => {
    listAttachments(entityType, idsKey.split(','))
      .then((list) => {
        setFiles(list);
        onChange?.(list);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, idsKey]);

  const add = async (kind: string, camera = false) => {
    const f = camera ? await pickImage(true) : await pickDocument();
    if (!f) return;
    await dialog.run(async () => {
      await uploadAttachment(entityType, entityId, kind, f);
      await reload();
    }, 'File uploaded');
  };

  return (
    <Section title={title}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {files.map((f) => (
          <ListRow
            key={f.id}
            title={f.file_name}
            subtitle={`${KIND_LABELS[f.kind] ?? human(f.kind)} · v${f.version} · ${people[f.uploaded_by]?.full_name ?? ''} · ${fmtDateTime(f.uploaded_at)}`}
            right={<Button small variant="secondary" title="Open" onPress={() => dialog.run(() => openAttachment(f))} />}
          />
        ))}
        {!files.length ? <Muted style={{ padding: 12 }}>No files yet</Muted> : null}
      </Card>
      {canUpload ? (
        <Row wrap gap={6} style={{ marginTop: 8 }}>
          {kinds.map((k) => (
            <Button key={k} small variant="secondary" title={`+ ${KIND_LABELS[k] ?? human(k)}`} onPress={() => add(k)} />
          ))}
          {allowCamera && Platform.OS !== 'web' ? <Button small variant="secondary" title="📷 Take photo" onPress={() => add(kinds[0], true)} /> : null}
        </Row>
      ) : null}
    </Section>
  );
}

export function hasKind(files: Attachment[], kind: string) {
  return files.some((f) => f.kind === kind);
}
