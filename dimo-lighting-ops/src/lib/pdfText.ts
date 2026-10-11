// Text of a simple (text-based) PDF on the phone – pure JavaScript with pdf-lib, one line per table row.
// Enough for bank rate reports: literal strings shown with Tj / TJ / ' / " and positioned with Td / TD / Tm / T*.
import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream, type PDFObject } from 'pdf-lib';

function bytesOf(obj: PDFObject | undefined, doc: PDFDocument): Uint8Array[] {
  if (!obj) return [];
  const o = doc.context.lookup(obj);
  if (o instanceof PDFArray) return o.asArray().flatMap((x) => bytesOf(x, doc));
  if (o instanceof PDFRawStream) return [decodePDFRawStream(o).decode()];
  return [];
}

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/** Pieces of text with their position from one content stream */
export function textPieces(src: string) {
  const out: { x: number; y: number; s: string }[] = [];
  const nums: number[] = [];
  let lx = 0, ly = 0, leading = 0, x = 0, y = 0;
  const strs: string[] = [];
  const show = (s: string) => {
    if (s.trim()) out.push({ x, y, s });
    x += s.length * 4; // rough advance so pieces on one line keep their order
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '(') {
      // literal string with escapes and nested brackets
      let depth = 1, s = '';
      i++;
      while (i < src.length && depth) {
        const c = src[i];
        if (c === '\\') {
          const n = src[i + 1];
          if (/[0-7]/.test(n)) {
            const m = src.slice(i + 1).match(/^[0-7]{1,3}/)![0];
            s += String.fromCharCode(parseInt(m, 8));
            i += 1 + m.length;
            continue;
          }
          s += n === 'n' ? '\n' : n === 'r' ? '\r' : n === 't' ? '\t' : n;
          i += 2;
          continue;
        }
        if (c === '(') depth++;
        if (c === ')' && !--depth) break;
        s += c;
        i++;
      }
      strs.push(s);
      i++;
      continue;
    }
    if (ch === '[' || ch === ']' || ch === '<' || ch === '>' || /\s/.test(ch)) {
      i++;
      continue;
    }
    const m = src.slice(i).match(/^[^\s()[\]<>/]+|^\/[^\s()[\]<>/]*/);
    if (!m) {
      i++;
      continue;
    }
    const tok = m[0];
    i += tok.length;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      nums.push(Number(tok));
      continue;
    }
    switch (tok) {
      case 'BT': lx = ly = x = y = 0; break;
      case 'Td': case 'TD': {
        const [tx, ty] = nums.slice(-2);
        if (tok === 'TD') leading = -ty;
        lx += tx; ly += ty; x = lx; y = ly;
        break;
      }
      case 'Tm': { const v = nums.slice(-6); lx = x = v[4]; ly = y = v[5]; break; }
      case 'TL': leading = nums[nums.length - 1]; break;
      case 'T*': ly -= leading; x = lx; y = ly; break;
      case 'Tj': case 'TJ': show(strs.join('')); break;
      case "'": case '"': ly -= leading; x = lx; y = ly; show(strs.join('')); break;
    }
    if (!tok.startsWith('/')) {
      nums.length = 0;
      strs.length = 0;
    }
  }
  return out;
}

export async function pdfText(bytes: ArrayBuffer): Promise<string> {
  const doc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
  const lines: string[] = [];
  for (const page of doc.getPages()) {
    const src = bytesOf(page.node.get(PDFName.of('Contents')), doc).map(latin1).join('\n');
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const p of textPieces(src)) {
      const k = Math.round(p.y / 3) * 3;
      rows.set(k, [...(rows.get(k) ?? []), { x: p.x, s: p.s.trim() }]);
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, r]) => lines.push(r.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ')));
  }
  const text = lines.join('\n');
  if (!text.trim()) throw new Error('No text found in the PDF (a scanned image?) – type the rates in');
  return text;
}
