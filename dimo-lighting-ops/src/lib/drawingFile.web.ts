// Website: a PDF drawing is shown as an image of the chosen page (pdf.js, served from /vendor/pdfjs); an image is used as it is.
import type { PickedFile } from './files';
import { readBytes } from './files';

export type PreparedDrawing = { bytes: ArrayBuffer; mime: string; ext: string; width: number; height: number; pages: number; pdf?: ArrayBuffer };

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
};
type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: { data: Uint8Array }) => { promise: Promise<PdfDoc> } };

let ready: Promise<PdfJs> | null = null;
function pdfjs() {
  ready ??= new Promise<PdfJs>((resolve, reject) => {
    const w = window as unknown as { pdfjsLib?: PdfJs };
    if (w.pdfjsLib) return resolve(w.pdfjsLib);
    const s = document.createElement('script');
    s.src = '/vendor/pdfjs/pdf.min.js';
    s.onload = () => {
      if (!w.pdfjsLib) return reject(new Error('PDF viewer did not load'));
      w.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
      resolve(w.pdfjsLib);
    };
    s.onerror = () => reject(new Error('PDF viewer did not load'));
    document.head.appendChild(s);
  });
  return ready;
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read the drawing'))), 'image/jpeg', 0.86));

/** Page `page` of a PDF (1-based) as a JPEG of up to 3000 px, or an image as it is */
export async function prepareDrawing(f: PickedFile, page = 1): Promise<PreparedDrawing> {
  const bytes = await readBytes(f);
  const isPdf = /pdf/i.test(f.mimeType ?? '') || /\.pdf$/i.test(f.name);
  if (isPdf) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
    const pg = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
    const v0 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: Math.min(4, 3000 / Math.max(v0.width, v0.height)) });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    const out = await toBlob(c);
    return { bytes: await out.arrayBuffer(), mime: 'image/jpeg', ext: 'jpg', width: c.width, height: c.height, pages: doc.numPages, pdf: bytes };
  }
  if (!/^image\//i.test(f.mimeType ?? '') && !/\.(png|jpe?g|webp)$/i.test(f.name)) throw new Error('Choose a PDF drawing or an image (PNG / JPG)');
  const bmp = await createImageBitmap(new Blob([bytes], { type: f.mimeType ?? 'image/png' }));
  const png = /png/i.test(f.mimeType ?? f.name);
  return { bytes, mime: f.mimeType ?? (png ? 'image/png' : 'image/jpeg'), ext: png ? 'png' : 'jpg', width: bmp.width, height: bmp.height, pages: 1 };
}
