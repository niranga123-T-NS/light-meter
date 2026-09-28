// Capture photos / pick files for attachments.
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { persistLocalFile } from './files';
import { newId } from './ids';
import type { LocalAttachment } from './types';

const MAX_MB = 25;

async function toAttachment(uri: string, filename: string, mime: string, size?: number | null): Promise<LocalAttachment> {
  const id = newId();
  if (size && size > MAX_MB * 1024 * 1024) throw new Error(`Files must be smaller than ${MAX_MB} MB`);
  const stored = await persistLocalFile(uri, id, filename);
  return { id, localUri: stored.uri, filename, mime_type: mime, size_bytes: size ?? stored.size };
}

export async function takePhoto(): Promise<LocalAttachment | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera permission was not given');
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, exif: false });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return toAttachment(a.uri, a.fileName ?? `photo-${Date.now()}.jpg`, a.mimeType ?? 'image/jpeg', a.fileSize);
}

export async function pickPhoto(): Promise<LocalAttachment | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, exif: false });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return toAttachment(a.uri, a.fileName ?? `image-${Date.now()}.jpg`, a.mimeType ?? 'image/jpeg', a.fileSize);
}

export async function pickDocument(): Promise<LocalAttachment | null> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return toAttachment(a.uri, a.name, a.mimeType ?? 'application/octet-stream', a.size);
}
