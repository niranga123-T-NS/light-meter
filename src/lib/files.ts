// Native file helpers for attachments (expo-file-system).
import { Directory, File, Paths } from 'expo-file-system';

const dir = () => {
  const d = new Directory(Paths.document, 'attachments');
  if (!d.exists) d.create({ intermediates: true });
  return d;
};

/** Copy a picked/captured file into app storage so it survives until it is uploaded. */
export async function persistLocalFile(uri: string, id: string, filename: string): Promise<{ uri: string; size: number | null }> {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  const target = new File(dir(), `${id}${ext}`);
  if (!target.exists) await new File(uri).copy(target);
  return { uri: target.uri, size: target.size ?? null };
}

export async function readFileBytes(uri: string): Promise<Uint8Array> {
  return new File(uri).bytes();
}

export function deleteLocalFile(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

/** Save bytes to a temporary file and return its URI (used for Excel exports). */
export function writeTempFile(name: string, bytes: Uint8Array): string {
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  f.write(bytes);
  return f.uri;
}
