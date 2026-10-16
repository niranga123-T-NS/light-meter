// Phone: a drawing is added as an image (a PDF is turned into an image on the website).
import { Image } from 'react-native';
import type { PickedFile } from './files';
import { readBytes } from './files';

export type PreparedDrawing = { bytes: ArrayBuffer; mime: string; ext: string; width: number; height: number; pages: number; pdf?: ArrayBuffer };

export async function prepareDrawing(f: PickedFile, _page = 1): Promise<PreparedDrawing> {
  if (/pdf/i.test(f.mimeType ?? '') || /\.pdf$/i.test(f.name)) throw new Error('Add PDF drawings from the website – on the phone choose an image (PNG / JPG) of the drawing');
  if (!/^image\//i.test(f.mimeType ?? '') && !/\.(png|jpe?g|webp)$/i.test(f.name)) throw new Error('Choose an image (PNG / JPG) of the drawing');
  const size = await new Promise<{ width: number; height: number }>((res, rej) => Image.getSize(f.uri, (width, height) => res({ width, height }), rej));
  const png = /png/i.test(f.mimeType ?? f.name);
  return { bytes: await readBytes(f), mime: f.mimeType ?? (png ? 'image/png' : 'image/jpeg'), ext: png ? 'png' : 'jpg', ...size, pages: 1 };
}
