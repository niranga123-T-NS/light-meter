import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { DIMO_LOGO_DATA_URI } from './brandLogoData';
import { fmtDateTimeY } from './format';

// DIMO site documents drawn as real PDFs in the style of the issued HSE forms: a boxed header with the logo, the
// management-system line, the document title and a number / date / page box on every page; bordered key-value and
// table blocks; photos with captions; a footer with who generated it and the page count.

export const INK = rgb(0.07, 0.07, 0.07);
const GRID = rgb(0.2, 0.2, 0.2);
const SHADE = rgb(0.91, 0.93, 0.95);
const KEY = rgb(0.96, 0.97, 0.98);
const MUTED = rgb(0.35, 0.35, 0.35);
export const TONES = { green: rgb(0.08, 0.5, 0.24), amber: rgb(0.75, 0.47, 0), red: rgb(0.78, 0.06, 0.18), blue: rgb(0.1, 0.3, 0.7), grey: MUTED };

const WIN = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export const clean = (s: string) => s.replace(/\r/g, '').replace(/\t/g, ' ').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, (ch) => (WIN.includes(ch) ? ch : ch === '✓' ? 'Yes' : '?'));

export type Cell = string | { text: string; bold?: boolean; color?: RGB; align?: 'left' | 'center' };
export type Head = { system?: string; title: string; subtitle?: string; boxes: [string, string][] };

const M = 34; // page margin
const PW = 595.28;
const PH = 841.89;
const CW = PW - M * 2;
const BW = 176; // number / date / page box
const BK = 50; // its label column

export class SiteDoc {
  doc!: PDFDocument;
  page!: PDFPage;
  f!: PDFFont;
  b!: PDFFont;
  logo!: PDFImage;
  y = 0; // distance from the top of the page
  private pages: PDFPage[] = [];
  constructor(private head: Head, private footer: string) {}

  static async create(head: Head, footer: string) {
    const d = new SiteDoc(head, footer);
    d.doc = await PDFDocument.create();
    d.f = await d.doc.embedFont(StandardFonts.Helvetica);
    d.b = await d.doc.embedFont(StandardFonts.HelveticaBold);
    d.logo = await d.doc.embedPng(DIMO_LOGO_DATA_URI.split(',')[1]);
    d.newPage();
    return d;
  }

  private text(s: string, x: number, top: number, size: number, font = this.f, color = INK) {
    this.page.drawText(clean(s), { x, y: PH - top, size, font, color });
  }
  private rect(x: number, top: number, w: number, h: number, fill?: RGB) {
    this.page.drawRectangle({ x, y: PH - top - h, width: w, height: h, borderColor: GRID, borderWidth: 0.6, color: fill });
  }
  wrap(s: string, font: PDFFont, size: number, maxW: number) {
    const out: string[] = [];
    for (const para of clean(s).split('\n')) {
      let line = '';
      for (const word of para.split(/ +/).filter(Boolean)) {
        const t = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(t, size) <= maxW || !line) line = t;
        else {
          out.push(line);
          line = word;
        }
        // a single word wider than the cell: cut it
        while (font.widthOfTextAtSize(line, size) > maxW && line.length > 1) {
          let k = line.length - 1;
          while (k > 1 && font.widthOfTextAtSize(line.slice(0, k), size) > maxW) k--;
          out.push(line.slice(0, k));
          line = line.slice(k);
        }
      }
      out.push(line);
    }
    return out;
  }

  newPage() {
    this.page = this.doc.addPage([PW, PH]);
    this.pages.push(this.page);
    const h = this.head;
    const top = M - 8;
    const H = 66;
    const lw = 120;
    const bw = BW;
    this.rect(M, top, CW, H);
    this.rect(M, top, lw, H);
    this.rect(M + CW - bw, top, bw, H);
    const s = Math.min((lw - 16) / this.logo.width, (H - 14) / this.logo.height);
    this.page.drawImage(this.logo, { x: M + (lw - this.logo.width * s) / 2, y: PH - top - (H + this.logo.height * s) / 2, width: this.logo.width * s, height: this.logo.height * s });
    const mx = M + lw;
    const mw = CW - lw - bw;
    const centre = (t: string, at: number, size: number, font: PDFFont) => this.text(t, mx + (mw - font.widthOfTextAtSize(clean(t), size)) / 2, at, size, font);
    centre(h.system ?? 'DIMO PLC – LIGHTING PROJECTS', top + 15, 8.5, this.b);
    this.page.drawLine({ start: { x: mx, y: PH - top - 21 }, end: { x: mx + mw, y: PH - top - 21 }, thickness: 0.6, color: GRID });
    centre(h.title, top + 40, 13, this.b);
    if (h.subtitle) centre(h.subtitle, top + 56, 8.5, this.f);
    const rows = [...h.boxes, ['Page', '']] as [string, string][];
    const rh = H / rows.length;
    rows.forEach(([k, v], i) => {
      if (i) this.page.drawLine({ start: { x: M + CW - bw, y: PH - top - rh * i }, end: { x: M + CW, y: PH - top - rh * i }, thickness: 0.6, color: GRID });
      this.text(`${k}:`, M + CW - bw + 4, top + rh * i + rh / 2 + 3, 7.5, this.b);
      if (v) this.text(this.fit(v, this.f, 8, bw - BK - 4), M + CW - bw + BK, top + rh * i + rh / 2 + 3, 8);
    });
    this.y = top + H + 12;
  }

  private fit(s: string, font: PDFFont, size: number, w: number) {
    let t = clean(s);
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > w) t = t.slice(0, -2) + '…';
    return t;
  }

  /** Keep the next block on this page or start a new one */
  need(h: number) {
    if (this.y + h > PH - M - 18) this.newPage();
  }

  section(title: string) {
    this.need(40);
    this.y += 4;
    this.text(title.toUpperCase(), M, this.y + 9, 9.5, this.b);
    this.y += 14;
  }

  /** Bordered label / value rows, two pairs per row when `cols` is 2 */
  keyValues(pairs: [string, string][], cols: 1 | 2 = 2) {
    const size = 8.5;
    const kw = cols === 2 ? 92 : 128;
    const pw = CW / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      const row = pairs.slice(i, i + cols);
      const lines = row.map(([k, v]) => [this.wrap(k, this.b, size, kw - 8), this.wrap(v || '—', this.f, size, pw - kw - 8)]);
      const h = Math.max(...lines.map(([a, b]) => Math.max(a.length, b.length))) * (size + 2.6) + 7;
      this.need(h);
      row.forEach((_, j) => {
        const x = M + pw * j;
        this.rect(x, this.y, kw, h, KEY);
        this.rect(x + kw, this.y, pw - kw, h);
        lines[j][0].forEach((ln, n) => this.text(ln, x + 4, this.y + 4 + size + n * (size + 2.6), size, this.b));
        lines[j][1].forEach((ln, n) => this.text(ln, x + kw + 4, this.y + 4 + size + n * (size + 2.6), size));
      });
      if (row.length < cols) this.rect(M + pw * row.length, this.y, pw * (cols - row.length), h);
      this.y += h;
    }
    this.y += 8;
  }

  /** A text box under a label (long free text), split over pages when needed */
  para(label: string, body: string) {
    const size = 8.8;
    const lines = this.wrap(body || '—', this.f, size, CW - 10);
    const lh = size + 2.8;
    let i = 0;
    this.need(16 + lh * Math.min(3, lines.length) + 8);
    this.rect(M, this.y, CW, 15, SHADE);
    this.text(label, M + 4, this.y + 10.5, 8.5, this.b);
    this.y += 15;
    while (i < lines.length) {
      const room = Math.max(1, Math.floor((PH - M - 18 - this.y - 8) / lh));
      const chunk = lines.slice(i, i + room);
      const h = chunk.length * lh + 8;
      this.rect(M, this.y, CW, h);
      chunk.forEach((ln, n) => this.text(ln, M + 5, this.y + 4 + size + n * lh, size));
      this.y += h;
      i += chunk.length;
      if (i < lines.length) this.newPage();
    }
    this.y += 8;
  }

  /** Bordered table with a shaded header row; widths are fractions of the content width */
  table(headers: string[], widths: number[], rows: Cell[][], size = 8) {
    const ws = widths.map((w) => w * CW);
    const lh = size + 2.6;
    const drawHead = () => {
      const hl = headers.map((h, i) => this.wrap(h, this.b, size, ws[i] - 6));
      const hh = Math.max(...hl.map((l) => l.length)) * lh + 6;
      this.need(hh + lh + 6);
      let x = M;
      hl.forEach((l, i) => {
        this.rect(x, this.y, ws[i], hh, SHADE);
        l.forEach((ln, n) => this.text(ln, x + 3, this.y + 3 + size + n * lh, size, this.b));
        x += ws[i];
      });
      this.y += hh;
    };
    drawHead();
    for (const row of rows) {
      const cells = row.map((c) => (typeof c === 'string' ? { text: c } : c));
      const lines = cells.map((c, i) => this.wrap(c.text || '', c.bold ? this.b : this.f, size, ws[i] - 6));
      const h = Math.max(1, ...lines.map((l) => l.length)) * lh + 6;
      if (this.y + h > PH - M - 18) {
        this.newPage();
        drawHead();
      }
      let x = M;
      cells.forEach((c, i) => {
        this.rect(x, this.y, ws[i], h);
        const font = c.bold ? this.b : this.f;
        lines[i].forEach((ln, n) => {
          const tx = c.align === 'center' ? x + (ws[i] - font.widthOfTextAtSize(ln, size)) / 2 : x + 3;
          this.text(ln, tx, this.y + 3 + size + n * lh, size, font, c.color ?? INK);
        });
        x += ws[i];
      });
      this.y += h;
    }
    this.y += 8;
  }

  /** Photos two to a row, each with its caption */
  async photos(items: { bytes: Uint8Array | null; type: string; caption: string }[]) {
    const gap = 10;
    const w = (CW - gap) / 2;
    const maxH = 200;
    for (let i = 0; i < items.length; i += 2) {
      const pair = await Promise.all(
        items.slice(i, i + 2).map(async (it) => {
          let img: PDFImage | null = null;
          try {
            if (it.bytes) img = it.type.includes('png') ? await this.doc.embedPng(it.bytes) : await this.doc.embedJpg(it.bytes);
          } catch {
            img = null;
          }
          return { ...it, img };
        }),
      );
      const dims = pair.map((p) => (p.img ? p.img.scale(Math.min((w - 8) / p.img.width, maxH / p.img.height)) : { width: w - 8, height: 40 }));
      const capLines = pair.map((p) => this.wrap(p.caption, this.f, 7.5, w - 8).slice(0, 3));
      const h = Math.max(...dims.map((d) => d.height)) + Math.max(...capLines.map((l) => l.length)) * 10 + 14;
      this.need(h);
      pair.forEach((p, j) => {
        const x = M + j * (w + gap);
        this.rect(x, this.y, w, h);
        const d = dims[j];
        if (p.img) this.page.drawImage(p.img, { x: x + (w - d.width) / 2, y: PH - this.y - 4 - d.height, width: d.width, height: d.height });
        else this.text('Photo in a format that cannot be printed – open it in the app', x + 6, this.y + 24, 7.5, this.f, MUTED);
        capLines[j].forEach((ln, n) => this.text(ln, x + 4, this.y + d.height + 14 + n * 10, 7.5, this.f, MUTED));
      });
      this.y += h + gap;
    }
  }

  /** Sign-off block like the HSE forms */
  signOff(rows: [string, string, string | null][]) {
    this.table(
      ['Role', 'Name', 'Date / time', 'Signature'],
      [0.28, 0.32, 0.2, 0.2],
      rows.map(([role, name, at]) => [{ text: role, bold: true }, name || '', at ? fmtDateTimeY(at) : '', name && at ? { text: 'Signed in app', color: TONES.blue } : '']),
      8.5,
    );
  }

  async save() {
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      // page number in the header box and the footer line
      const label = `${i + 1} of ${n}`;
      const rows = this.head.boxes.length + 1;
      const rh = 66 / rows;
      p.drawText(label, { x: M + CW - BW + BK, y: PH - (M - 8) - rh * (rows - 1) - rh / 2 - 3, size: 8, font: this.f, color: INK });
      p.drawLine({ start: { x: M, y: M - 2 }, end: { x: M + CW, y: M - 2 }, thickness: 0.5, color: GRID });
      p.drawText(clean(this.footer), { x: M, y: M - 12, size: 7, font: this.f, color: MUTED });
      p.drawText(`Page ${label}`, { x: M + CW - this.f.widthOfTextAtSize(`Page ${label}`, 7), y: M - 12, size: 7, font: this.f, color: MUTED });
    });
    this.doc.setProducer('DIMO Lighting Ops');
    return this.doc.save();
  }
}
