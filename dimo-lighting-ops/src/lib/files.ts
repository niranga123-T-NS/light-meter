import * as DocumentPicker from 'expo-document-picker';
import { File as FsFile } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { rpc, supabase } from './supabase';
import type { Attachment } from './types';

export type PickedFile = { name: string; uri: string; mimeType?: string | null; size?: number | null; webFile?: Blob };

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB (Section 7.5)

export function uuid() {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** DWG, PDF, XLSX, DOCX, images, DIALux / Relux files – any type is accepted and checked by size. */
export async function pickDocument(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  return { name: a.name, uri: a.uri, mimeType: a.mimeType, size: a.size, webFile: a.file };
}

export async function pickImage(fromCamera = false, square = false): Promise<PickedFile | null> {
  if (fromCamera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera permission is needed to take a photo.');
  }
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.7,
    allowsEditing: square,
    aspect: square ? [1, 1] : undefined,
  };
  const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  return {
    name: a.fileName ?? `photo-${Date.now()}.jpg`,
    uri: a.uri,
    mimeType: a.mimeType ?? 'image/jpeg',
    size: a.fileSize,
    webFile: a.file ?? undefined,
  };
}

async function readBytes(f: PickedFile): Promise<ArrayBuffer> {
  if (f.webFile) return f.webFile.arrayBuffer();
  if (Platform.OS === 'web') return (await fetch(f.uri)).arrayBuffer();
  return new FsFile(f.uri).arrayBuffer();
}

const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);

/** Uploads a file into the private "files" bucket and records it against a record. */
export async function uploadAttachment(entityType: string, entityId: string, kind: string, file: PickedFile): Promise<Attachment> {
  const bytes = await readBytes(file);
  if (bytes.byteLength > MAX_BYTES) throw new Error('Files can be up to 50 MB.');
  const path = `${entityType}/${entityId}/${uuid()}-${safeName(file.name)}`;
  const up = await supabase.storage.from('files').upload(path, bytes, {
    contentType: file.mimeType ?? 'application/octet-stream',
    upsert: false,
  });
  if (up.error) throw new Error(up.error.message);
  const { data, error } = await supabase
    .from('attachments')
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      kind,
      storage_path: path,
      file_name: file.name,
      mime_type: file.mimeType ?? null,
      size_bytes: bytes.byteLength,
    })
    .select()
    .single();
  if (error) {
    await supabase.storage.from('files').remove([path]);
    throw new Error(error.message);
  }
  return data as Attachment;
}

/** Logs the download (audit) and opens a short-lived signed URL. */
export async function openAttachment(att: Pick<Attachment, 'id' | 'file_name'>) {
  const path = await rpc<string>('log_download', { p_attachment: att.id });
  const { data, error } = await supabase.storage.from('files').createSignedUrl(path, 300, { download: att.file_name });
  if (error) throw new Error(error.message);
  if (Platform.OS === 'web') window.open(data.signedUrl, '_blank');
  else await Linking.openURL(data.signedUrl);
}

export async function listAttachments(entityType: string, entityIds: string[]) {
  if (!entityIds.length) return [] as Attachment[];
  const { data, error } = await supabase
    .from('attachments')
    .select('*')
    .eq('entity_type', entityType)
    .in('entity_id', entityIds)
    .is('archived_at', null)
    .order('uploaded_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data as Attachment[];
}

// ---------------------------------------------------------------------------
// Profile pictures (Section 2): JPG/PNG up to 5 MB, square crop, private bucket
// ---------------------------------------------------------------------------
const avatarUrlCache = new Map<string, { url: string; exp: number }>();

export async function avatarUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const hit = avatarUrlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data } = await supabase.storage.from('avatars').createSignedUrl(path, 3600);
  if (!data) return null;
  avatarUrlCache.set(path, { url: data.signedUrl, exp: Date.now() + 3_000_000 });
  return data.signedUrl;
}

export async function uploadAvatar(userId: string, file: PickedFile) {
  const bytes = await readBytes(file);
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('Profile pictures can be up to 5 MB.');
  const type = file.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  const path = `${userId}/avatar-${Date.now()}.${type === 'image/png' ? 'png' : 'jpg'}`;
  const up = await supabase.storage.from('avatars').upload(path, bytes, { contentType: type, upsert: true });
  if (up.error) throw new Error(up.error.message);
  const { error } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId);
  if (error) throw new Error(error.message);
  return path;
}
