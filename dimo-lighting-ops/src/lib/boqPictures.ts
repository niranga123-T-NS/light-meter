import { strFromU8, unzipSync } from 'fflate';
import { Platform } from 'react-native';

/** Pictures in a client BOQ: the Excel pictures (floating on a row, or placed in a cell) and the pictures of a PDF BOQ (website), each tied to a sheet row.
 *  Kept as small JPEG thumbnails (data URLs) – enough to see the fitting and to compare it with the catalogue photos. */
export type BoqPic = { src: string; w: number; h: number };
const THUMB = 220;

const attr = (s: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(s)?.[1];
const all = (s: string, rx: RegExp) => [...s.matchAll(rx)];
/** The relationship id of an element, whatever its prefix (r:id, ns1:id …) */
const rid = (s: string) => /\s\w+:id="([^"]*)"/.exec(s)?.[1];
/** The XML of a part without element prefixes (writers use xdr:, a:, x: or none) */
const xml = (b: Uint8Array) => strFromU8(b).replace(/<(\/?)[\w.-]+:/g, '<$1');
const dir = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);
/** Resolves a relationship target against the folder of the part that points to it */
function resolve(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dir(base) + target).split('/'), out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}
const relsOf = (part: string) => `${dir(part)}_rels/${part.slice(part.lastIndexOf('/') + 1)}.rels`;
function rels(files: Record<string, Uint8Array>, part: string): Record<string, string> {
  const x = files[relsOf(part)];
  if (!x) return {};
  const out: Record<string, string> = {};
  for (const m of all(strFromU8(x), /<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'), t = attr(m[0], 'Target');
    if (id && t && attr(m[0], 'TargetMode') !== 'External') out[id] = resolve(part, t);
  }
  return out;
}
const mimeOf = (p: string) => (/\.png$/i.test(p) ? 'image/png' : /\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.gif$/i.test(p) ? 'image/gif' : /\.bmp$/i.test(p) ? 'image/bmp' : /\.webp$/i.test(p) ? 'image/webp' : null);

/** Every picture of the workbook by sheet name and row (0-based, the same rows read-excel-file returns) */
export async function xlsxPictures(bytes: ArrayBuffer | Uint8Array): Promise<Record<string, Record<number, BoqPic>>> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch {
    return {};
  }
  const wb = files['xl/workbook.xml'];
  if (!wb) return {};
  const wbRels = rels(files, 'xl/workbook.xml');
  // pictures placed in cells (Excel 365 "Place in Cell"): cell vm="n" → rich value n → image relationship
  const rv = files['xl/richData/rdrichvalue.xml'] ? all(xml(files['xl/richData/rdrichvalue.xml']), /<rv\b[^>]*>([\s\S]*?)<\/rv>/g).map((m) => Number(/<v>(\d+)<\/v>/.exec(m[1])?.[1] ?? -1)) : [];
  const rvRelIds = files['xl/richData/richValueRel.xml'] ? all(xml(files['xl/richData/richValueRel.xml']), /<rel\b[^>]*>/g).map((m) => rid(m[0]) ?? '') : [];
  const rvRels = rels(files, 'xl/richData/richValueRel.xml');
  const out: Record<string, Record<number, BoqPic>> = {};
  for (const m of all(xml(wb), /<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name'), id = rid(m[0]);
    const part = id ? wbRels[id] : undefined;
    if (!name || !part || !files[part]) continue;
    const found: { row: number; path: string }[] = [];
    const sheetXml = xml(files[part]);
    const sRels = rels(files, part);
    // floating pictures of the sheet's drawing: the row the picture starts on (or its middle when it spans rows)
    for (const d of all(sheetXml, /<drawing\b[^>]*>/g)) {
      const dPart = sRels[rid(d[0]) ?? ''];
      if (!dPart || !files[dPart]) continue;
      const dRels = rels(files, dPart);
      for (const a of all(xml(files[dPart]), /<(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/\1>/g)) {
        const from = Number(/<from>[\s\S]*?<row>(\d+)<\/row>/.exec(a[0])?.[1] ?? NaN);
        const to = Number(/<to>[\s\S]*?<row>(\d+)<\/row>/.exec(a[0])?.[1] ?? NaN);
        const emb = /<blip\b[^>]*\s\w+:embed="([^"]+)"/.exec(a[0])?.[1];
        if (!Number.isFinite(from) || !emb || !dRels[emb]) continue;
        found.push({ row: Number.isFinite(to) && to - from >= 2 ? Math.floor((from + to) / 2) : from, path: dRels[emb] });
      }
    }
    // pictures placed in cells
    for (const c of all(sheetXml, /<c\b[^>]*\bvm="(\d+)"[^>]*>/g)) {
      const ref = attr(c[0], 'r') ?? '';
      const row = Number(/\d+/.exec(ref)?.[0] ?? NaN) - 1;
      const relIdx = rv[Number(c[1]) - 1];
      const path = relIdx != null && relIdx >= 0 ? rvRels[rvRelIds[relIdx]] : undefined;
      if (Number.isFinite(row) && path) found.push({ row, path });
    }
    for (const f of found) {
      const mime = mimeOf(f.path);
      if (!mime || !files[f.path] || out[name]?.[f.row]) continue;
      const pic = await thumb(files[f.path], mime).catch(() => null);
      if (pic) (out[name] ??= {})[f.row] = pic;
    }
  }
  return out;
}

/** A small JPEG of the picture (website); on the phone the picture as it is, when it is small enough */
async function thumb(bytes: Uint8Array, mime: string): Promise<BoqPic | null> {
  if (Platform.OS === 'web') {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    return canvasThumb(bmp, bmp.width, bmp.height);
  }
  const size = imageSize(bytes);
  if (!size || bytes.length > 300_000) return null;
  return { src: `data:${mime};base64,${toB64(bytes)}`, ...size };
}

function canvasThumb(src: CanvasImageSource, w0: number, h0: number): BoqPic | null {
  if (w0 < 16 || h0 < 16) return null;
  const k = Math.min(1, THUMB / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  return { src: cv.toDataURL('image/jpeg', 0.8), w, h };
}

function toB64(b: Uint8Array) {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Width and height of a PNG or JPEG from its header */
function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + len;
    }
  }
  return null;
}

/* ───────── PDF BOQ (website, pdf.js from /vendor/pdfjs): the table rebuilt from the text positions, pictures tied to the row beside them ───────── */
type PjItem = { str: string; transform: number[]; width: number; height: number };
type PjImg = { width: number; height: number; kind?: number; data?: Uint8ClampedArray; bitmap?: ImageBitmap };
type PjObjs = { get: (id: string, cb: (o: PjImg) => void) => void; has?: (id: string) => boolean };
type PjPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: PjItem[] }>;
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: PjObjs; commonObjs: PjObjs;
};
type PjLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (o: { data: Uint8Array }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<PjPage> }> };
  Util: { transform: (a: number[], b: number[]) => number[] };
  OPS: Record<string, number>;
};
let pj: Promise<PjLib> | null = null;
function pdfjs() {
  pj ??= new Promise<PjLib>((ok, bad) => {
    const w = window as unknown as { pdfjsLib?: PjLib };
    if (w.pdfjsLib) return ok(w.pdfjsLib);
    const s = document.createElement('script');
    s.src = '/vendor/pdfjs/pdf.min.js';
    s.onload = () => {
      if (!w.pdfjsLib) return bad(new Error('The PDF reader did not load'));
      w.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
      ok(w.pdfjsLib);
    };
    s.onerror = () => bad(new Error('The PDF reader did not load'));
    document.head.appendChild(s);
  });
  pj.catch(() => (pj = null));
  return pj;
}

type Cell = { x: number; x2: number; s: string };
type Line = { y: number; h: number; cells: Cell[] };
const HEAD = /desc|description|particulars|specification|qty|quantity|unit|item/i;

/** A text-based PDF BOQ as one sheet: rows and columns from where the text sits; wrapped descriptions joined; pictures on the row beside them */
export async function readPdfBoq(bytes: ArrayBuffer): Promise<{ rows: string[][]; pics: Record<number, BoqPic> }> {
  if (Platform.OS !== 'web') throw new Error('PDF BOQs are read on the website – open the BOQ match there, or upload the Excel');
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  const lines: Line[] = [];
  const imgs: { y: number; pic: BoqPic }[] = [];
  let top = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items.filter((i) => i.str?.trim());
    // rows: text at the same height (pages stacked, top down)
    const pageLines: Line[] = [];
    for (const it of items.map((i) => ({ x: i.transform[4], y: top + vp.height - i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height || 8, s: i.str })).sort((a, b) => a.y - b.y || a.x - b.x)) {
      const l = pageLines.find((x) => Math.abs(x.y - it.y) <= Math.max(2.5, it.h * 0.35));
      const c = { x: it.x, x2: it.x + it.w, s: it.s };
      if (l) l.cells.push(c);
      else pageLines.push({ y: it.y, h: it.h, cells: [c] });
    }
    for (const l of pageLines) {
      // pieces close together are one cell
      l.cells.sort((a, b) => a.x - b.x);
      const merged: Cell[] = [];
      for (const c of l.cells) {
        const last = merged[merged.length - 1];
        if (last && c.x - last.x2 < Math.max(4, l.h * 0.6)) { last.s += (c.x - last.x2 > 1 ? ' ' : '') + c.s; last.x2 = Math.max(last.x2, c.x2); }
        else merged.push({ ...c });
      }
      l.cells = merged;
      lines.push(l);
    }
    // pictures: where each image is painted (the current transform maps the unit square onto it)
    try {
      const ops = await page.getOperatorList();
      const O = lib.OPS;
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack: number[][] = [];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i], args = ops.argsArray[i];
        if (fn === O.save) stack.push(ctm);
        else if (fn === O.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === O.transform) ctm = lib.Util.transform(ctm, args as number[]);
        else if (fn === O.paintImageXObject || fn === O.paintJpegXObject || fn === O.paintInlineImageXObject) {
          const wPt = Math.hypot(ctm[0], ctm[1]), hPt = Math.hypot(ctm[2], ctm[3]);
          if (wPt < 18 || hPt < 18 || wPt * hPt > vp.width * vp.height * 0.4) continue; // lines and logos out, page backgrounds out
          const yMid = top + vp.height - (ctm[5] + ctm[3] / 2);
          const img = fn === O.paintInlineImageXObject ? (args[0] as PjImg) : await objImage(page, String(args[0]));
          const pic = img ? pdfImageThumb(img) : null;
          if (pic) imgs.push({ y: yMid, pic });
        }
      }
    } catch {
      // the text is still read when the pictures cannot be
    }
    top += vp.height;
  }
  // columns from the header row: each header cell owns the space up to halfway to the next one
  const header = lines.findIndex((l) => l.cells.length >= 2 && l.cells.filter((c) => HEAD.test(c.s)).length >= 2);
  const bounds = (header >= 0 ? lines[header].cells : clusterStarts(lines)).map((c) => c.x);
  const mids = bounds.slice(1).map((b, i) => (header >= 0 ? (lines[header].cells[i].x2 + b) / 2 : b - 2));
  // long text by where it starts (left aligned descriptions), short values by their middle (centred or right aligned numbers)
  const col = (c: Cell) => { const at = c.x2 - c.x > 80 ? c.x + 4 : (c.x + c.x2) / 2; let k = 0; while (k < mids.length && at >= mids[k]) k++; return k; };
  const rows: { y: number; y2: number; cells: string[]; only: number }[] = [];
  const qtyCol = header >= 0 ? lines[header].cells.findIndex((c) => /qty|quantity/i.test(c.s)) : -1;
  const itemCol = header >= 0 ? lines[header].cells.findIndex((c) => /^(item|no\.?|s\/?no|ref)/i.test(c.s)) : -1;
  lines.forEach((l, i) => {
    const cells: string[] = Array(bounds.length).fill('');
    for (const c of l.cells) { const k = col(c); cells[k] = cells[k] ? `${cells[k]} ${c.s}` : c.s; }
    const filled = cells.map((s, k) => (s ? k : -1)).filter((k) => k >= 0);
    const prev = rows[rows.length - 1];
    // a wrapped description: only the description column, no item no. or quantity, right under a line that has a quantity
    if (i > header && header >= 0 && prev && filled.length === 1 && filled[0] !== itemCol && filled[0] !== qtyCol && l.y - prev.y2 < l.h * 1.8 && (qtyCol < 0 || prev.cells[qtyCol] || prev.only === filled[0])) {
      prev.cells[filled[0]] += ` ${cells[filled[0]]}`;
      prev.y2 = l.y;
      return;
    }
    rows.push({ y: l.y - l.h, y2: l.y, cells, only: filled.length === 1 ? filled[0] : -1 });
  });
  // each picture to the row it sits beside (its middle within the row, else the nearest row above)
  const pics: Record<number, BoqPic> = {};
  for (const im of imgs) {
    let best = -1;
    rows.forEach((r, k) => { if (k > header && r.y - 6 <= im.y) best = k; });
    if (best >= 0 && !pics[best]) pics[best] = im.pic;
  }
  return { rows: rows.map((r) => r.cells), pics };
}

/** No header row: the x positions where many rows start a cell */
function clusterStarts(lines: Line[]): Cell[] {
  const xs = lines.flatMap((l) => l.cells.map((c) => Math.round(c.x / 10) * 10));
  const count = new Map<number, number>();
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
  const keep = [...count.entries()].filter(([, n]) => n >= Math.max(3, lines.length * 0.15)).map(([x]) => x).sort((a, b) => a - b);
  return (keep.length ? keep : [0]).map((x) => ({ x, x2: x, s: '' }));
}

function objImage(page: PjPage, id: string): Promise<PjImg | null> {
  const objs = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((ok) => {
    const t = setTimeout(() => ok(null), 4000);
    try {
      objs.get(id, (o) => { clearTimeout(t); ok(o ?? null); });
    } catch {
      clearTimeout(t);
      ok(null);
    }
  });
}

function pdfImageThumb(img: PjImg): BoqPic | null {
  if (img.bitmap) return canvasThumb(img.bitmap, img.width, img.height);
  if (!img.data || !img.width || !img.height) return null;
  const n = img.width * img.height, rgba = new Uint8ClampedArray(n * 4);
  if (img.kind === 3) rgba.set(img.data.subarray(0, n * 4));
  else if (img.kind === 2) for (let i = 0; i < n; i++) { rgba[i * 4] = img.data[i * 3]; rgba[i * 4 + 1] = img.data[i * 3 + 1]; rgba[i * 4 + 2] = img.data[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  else return null; // 1-bit masks are not pictures of fittings
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  cv.getContext('2d')!.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
  return canvasThumb(cv, img.width, img.height);
}

/** A catalogue photo as a small picture for the Excel (website) */
export async function pictureFromUrl(url: string): Promise<BoqPic | null> {
  if (Platform.OS !== 'web') return null;
  const r = await fetch(url);
  if (!r.ok) return null;
  const bmp = await createImageBitmap(await r.blob());
  return canvasThumb(bmp, bmp.width, bmp.height);
}

/** The picture for the Excel (the Excel writer takes a Blob) */
export async function picBlob(p: BoqPic): Promise<Blob> {
  return (await fetch(p.src)).blob();
}
