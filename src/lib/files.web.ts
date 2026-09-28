// Web variants: files stay as blob/object URLs (the web app is the online dashboard).
export async function persistLocalFile(uri: string, _id: string, _filename: string): Promise<{ uri: string; size: number | null }> {
  return { uri, size: null };
}

export async function readFileBytes(uri: string): Promise<Uint8Array> {
  const res = await fetch(uri);
  return new Uint8Array(await res.arrayBuffer());
}

export function deleteLocalFile(_uri: string): void {}

export function writeTempFile(_name: string, _bytes: Uint8Array): string {
  throw new Error('Not used on web');
}
