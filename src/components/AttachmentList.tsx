// Attachments on a record (online): list, open via short-lived signed URL, add.
import { useState } from 'react';
import { Linking } from 'react-native';

import { notify } from '@/lib/dialog';
import { readFileBytes } from '@/lib/files';
import { fmtDateTime } from '@/lib/format';
import { pickDocument, pickPhoto, takePhoto } from '@/lib/media';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { Attachment } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

import { Button, Card, ListItem, Muted, Row, SectionTitle } from './ui';

export function AttachmentList({ entityType, entityId, canAdd = true }: { entityType: string; entityId: string; canAdd?: boolean }) {
  const { profile } = useSession();
  const [busy, setBusy] = useState(false);
  const { data, reload } = useAsync(async () => unwrap(await supabase.from('attachments').select('*')
    .eq('entity_type', entityType).eq('entity_id', entityId).is('deleted_at', null).order('created_at', { ascending: false })) as Attachment[], [entityType, entityId]);

  const open = async (a: Attachment) => {
    const res = await supabase.storage.from('attachments').createSignedUrl(a.storage_path, 300);
    if (res.data?.signedUrl) void Linking.openURL(res.data.signedUrl);
    else notify('Could not open the file', errorMessage(res.error));
  };

  const add = async (fn: typeof takePhoto) => {
    setBusy(true);
    try {
      const a = await fn();
      if (!a) return;
      const path = `${profile!.id}/${entityType}/${entityId}/${a.id}/${a.filename.replace(/[^A-Za-z0-9._-]+/g, '_')}`;
      const up = await supabase.storage.from('attachments').upload(path, await readFileBytes(a.localUri), { contentType: a.mime_type });
      if (up.error) throw up.error;
      unwrap(await supabase.from('attachments').insert({ id: a.id, entity_type: entityType, entity_id: entityId, storage_path: path,
        filename: a.filename, mime_type: a.mime_type, size_bytes: a.size_bytes }));
      await reload();
    } catch (e) {
      notify('Upload failed', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Attachments</SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data ?? []).length === 0 ? <Muted style={{ padding: 16 }}>No files</Muted> : data!.map((a) => (
          <ListItem key={a.id} title={a.filename} subtitle={`${a.mime_type ?? ''} · ${fmtDateTime(a.created_at)}`} onPress={() => open(a)} />
        ))}
      </Card>
      {canAdd ? (
        <Row wrap>
          <Button small variant="secondary" title="Photo" onPress={() => add(takePhoto)} disabled={busy} />
          <Button small variant="secondary" title="Image" onPress={() => add(pickPhoto)} disabled={busy} />
          <Button small variant="secondary" title="File" onPress={() => add(pickDocument)} disabled={busy} />
        </Row>
      ) : null}
    </>
  );
}
