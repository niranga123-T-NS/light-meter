/* eslint-disable react-hooks/refs -- imperative drawing on canvases */
import { PDFDocument } from 'pdf-lib';
import { createElement as h, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MarkupEditorProps } from './MarkupEditor';

// Red pen on a copy (website): every page of the PDF (or the photo) is shown at the page width; the reviewer writes with the
// pen or places handwritten-style notes. Comments are always red. Saving lays the comments over the original pages and
// keeps the result as a PDF – the original copy is never changed.

const RED = '#C8102E';
const HAND = "'DIMO Hand', 'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive";
type Pt = [number, number];
type Mark = { page: number; kind: 'ink'; pts: Pt[] } | { page: number; kind: 'text'; x: number; y: number; text: string };
type Page = { w: number; h: number; bg: HTMLCanvasElement };

declare global {
  interface Window {
    pdfjsLib?: {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (o: { data: Uint8Array }) => { promise: Promise<PdfDoc> };
    };
  }
}
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
};

let pdfjsReady: Promise<void> | null = null;
function loadPdfJs() {
  pdfjsReady ??= new Promise<void>((resolve, reject) => {
    if (window.pdfjsLib) return resolve();
    const s = document.createElement('script');
    s.src = '/vendor/pdfjs/pdf.min.js';
    s.onload = () => {
      if (!window.pdfjsLib) return reject(new Error('PDF viewer did not load'));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
      resolve();
    };
    s.onerror = () => reject(new Error('PDF viewer did not load'));
    document.head.appendChild(s);
  });
  return pdfjsReady;
}
let handReady: Promise<void> | null = null;
function loadHand() {
  handReady ??= (async () => {
    try {
      const f = new FontFace('DIMO Hand', 'url(/fonts/caveat-600.woff2)', { weight: '600' });
      await f.load();
      document.fonts.add(f);
    } catch {
      /* falls back to the system's handwriting font */
    }
  })();
  return handReady;
}

async function renderPages(bytes: ArrayBuffer, mime: string): Promise<Page[]> {
  if (/pdf/i.test(mime)) {
    await loadPdfJs();
    const doc = await window.pdfjsLib!.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
    const out: Page[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const vp = pg.getViewport({ scale: 1.6 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
      out.push({ w: c.width, h: c.height, bg: c });
    }
    return out;
  }
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return [{ w: c.width, h: c.height, bg: c }];
}

/** Draws the page's comments on a canvas of any size (coordinates are fractions of the page) */
function drawMarks(ctx: CanvasRenderingContext2D, w: number, hgt: number, marks: Mark[], signature?: string) {
  const u = w / 800; // line widths and text sizes follow the page width
  ctx.clearRect(0, 0, w, hgt);
  ctx.strokeStyle = RED;
  ctx.fillStyle = RED;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const m of marks) {
    if (m.kind === 'ink') {
      if (m.pts.length < 2) continue;
      ctx.lineWidth = 2.6 * u;
      ctx.beginPath();
      ctx.moveTo(m.pts[0][0] * w, m.pts[0][1] * hgt);
      for (let i = 1; i < m.pts.length - 1; i++) {
        const [x1, y1] = m.pts[i];
        const [x2, y2] = m.pts[i + 1];
        ctx.quadraticCurveTo(x1 * w, y1 * hgt, ((x1 + x2) / 2) * w, ((y1 + y2) / 2) * hgt);
      }
      const last = m.pts[m.pts.length - 1];
      ctx.lineTo(last[0] * w, last[1] * hgt);
      ctx.stroke();
    } else {
      ctx.save();
      ctx.translate(m.x * w, m.y * hgt);
      ctx.rotate(-0.025);
      ctx.font = `600 ${26 * u}px ${HAND}`;
      m.text.split('\n').forEach((line, i) => ctx.fillText(line, 0, i * 28 * u));
      ctx.restore();
    }
  }
  if (signature) {
    ctx.save();
    ctx.font = `600 ${20 * u}px ${HAND}`;
    ctx.textAlign = 'right';
    ctx.fillText(signature, w - 24 * u, hgt - 20 * u);
    ctx.restore();
  }
}

export function MarkupEditor({ bytes, mime, fileName, signature, onSave, onCancel }: MarkupEditorProps) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tool, setTool] = useState<'pen' | 'text'>('pen');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [typing, setTyping] = useState<{ page: number; x: number; y: number; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const overlays = useRef<(HTMLCanvasElement | null)[]>([]);
  const live = useRef<Mark | null>(null);

  useEffect(() => {
    let off = false;
    Promise.all([renderPages(bytes, mime), loadHand()])
      .then(([p]) => !off && setPages(p))
      .catch((e: Error) => !off && setErr(e.message));
    return () => {
      off = true;
    };
  }, [bytes, mime]);

  const redraw = (page: number, extra?: Mark | null) => {
    const c = overlays.current[page];
    if (!c) return;
    const list = marks.filter((m) => m.page === page).concat(extra && extra.page === page ? [extra] : []);
    drawMarks(c.getContext('2d')!, c.width, c.height, list, page === 0 ? signature : undefined);
  };
  useEffect(() => {
    pages?.forEach((_, i) => redraw(i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, marks]);

  const at = (e: PointerEvent | React.PointerEvent, c: HTMLCanvasElement): Pt => {
    const r = c.getBoundingClientRect();
    return [Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1)];
  };
  const commitText = () => {
    if (typing && typing.text.trim()) setMarks((m) => [...m, { page: typing.page, kind: 'text', x: typing.x, y: typing.y, text: typing.text.trim() }]);
    setTyping(null);
  };

  const save = async () => {
    if (!pages) return;
    // a note still being written is saved too
    const all = typing && typing.text.trim() ? [...marks, { page: typing.page, kind: 'text' as const, x: typing.x, y: typing.y, text: typing.text.trim() }] : marks;
    commitText();
    setSaving(true);
    try {
      const isPdf = /pdf/i.test(mime);
      const doc = isPdf ? await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true }) : await PDFDocument.create();
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        // comments drawn at twice the page's screen size, laid over the original page
        const c = document.createElement('canvas');
        c.width = p.w * 1.5;
        c.height = p.h * 1.5;
        drawMarks(c.getContext('2d')!, c.width, c.height, all.filter((m) => m.page === i), i === 0 ? signature : undefined);
        const png = await doc.embedPng(c.toDataURL('image/png'));
        if (isPdf) {
          const page = doc.getPages()[i];
          const { width, height } = page.getSize();
          page.drawImage(png, { x: 0, y: 0, width, height });
        } else {
          const w = Math.min(p.w, 1600);
          const hh = (p.h * w) / p.w;
          const page = doc.addPage([w * 0.75, hh * 0.75]);
          const photo = /png/i.test(mime) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          page.drawImage(photo, { x: 0, y: 0, width: w * 0.75, height: hh * 0.75 });
          page.drawImage(png, { x: 0, y: 0, width: w * 0.75, height: hh * 0.75 });
        }
      }
      await onSave(await doc.save());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const btn = (on: boolean): CSSProperties => ({
    border: `1px solid ${on ? RED : '#D5DAE1'}`,
    background: on ? '#FDECEE' : '#fff',
    color: on ? RED : '#111827',
    borderRadius: 8,
    padding: '7px 12px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  });

  if (err) return h('div', { style: { color: RED, padding: 12, fontFamily: 'system-ui' } }, `Could not open the copy: ${err}`);
  if (!pages) return h('div', { style: { padding: 12, color: '#6B7280', fontFamily: 'system-ui' } }, 'Opening the copy…');

  return h(
    'div',
    { style: { fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', display: 'flex', flexDirection: 'column', gap: 10 } },
    h(
      'div',
      { style: { position: 'sticky', top: 0, zIndex: 5, background: '#F3F4F6', padding: '8px 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
      h('button', { style: btn(tool === 'pen'), onClick: () => setTool('pen') }, '✎ Red pen'),
      h('button', { style: btn(tool === 'text'), onClick: () => setTool('text') }, 'Aa Write a note'),
      h('button', { style: btn(false), onClick: () => setMarks((m) => m.slice(0, -1)), disabled: !marks.length }, '↶ Undo'),
      h('button', { style: btn(false), onClick: () => setMarks([]), disabled: !marks.length }, 'Clear all'),
      h('span', { style: { flex: 1 } }),
      h('span', { style: { fontSize: 13, color: '#6B7280' } }, `${fileName} · ${pages.length} page${pages.length > 1 ? 's' : ''} · comments are always red`),
      h('button', { style: btn(false), onClick: onCancel }, 'Cancel'),
      h(
        'button',
        { style: { ...btn(true), background: RED, color: '#fff' }, onClick: save, disabled: saving || (!marks.length && !typing?.text.trim()) },
        saving ? 'Saving…' : 'Save marked-up copy',
      ),
    ),
    tool === 'text'
      ? h('div', { style: { fontSize: 13, color: '#6B7280' } }, 'Tap where the note goes, write it, then press Enter (Shift + Enter for a new line).')
      : h('div', { style: { fontSize: 13, color: '#6B7280' } }, 'Write, circle or underline on the page with the red pen.'),
    ...pages.map((p, i) =>
      h(
        'div',
        { key: i, style: { position: 'relative', width: '100%', maxWidth: 900, aspectRatio: `${p.w} / ${p.h}`, boxShadow: '0 1px 4px rgba(0,0,0,.18)', background: '#fff' } },
        h('img', { src: p.bg.toDataURL('image/jpeg', 0.85), style: { position: 'absolute', inset: 0, width: '100%', height: '100%', userSelect: 'none', pointerEvents: 'none' }, draggable: false }),
        h('canvas', {
          ref: (el: HTMLCanvasElement | null) => {
            overlays.current[i] = el;
          },
          width: p.w,
          height: p.h,
          style: { position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: tool === 'pen' ? 'crosshair' : 'text' },
          onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
            const c = e.currentTarget;
            if (tool === 'text') {
              // keep the focus in the note box that opens here
              e.preventDefault();
              commitText();
              const [x, y] = at(e, c);
              setTyping({ page: i, x, y, text: '' });
              return;
            }
            c.setPointerCapture(e.pointerId);
            live.current = { page: i, kind: 'ink', pts: [at(e, c)] };
          },
          onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => {
            const m = live.current;
            if (!m || m.kind !== 'ink' || m.page !== i) return;
            m.pts.push(at(e, e.currentTarget));
            redraw(i, m);
          },
          onPointerUp: () => {
            const m = live.current;
            live.current = null;
            if (m && m.kind === 'ink' && m.pts.length > 1) setMarks((x) => [...x, m]);
          },
        }),
        typing && typing.page === i
          ? h('textarea', {
              autoFocus: true,
              value: typing.text,
              placeholder: 'Write here…',
              rows: 2,
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setTyping({ ...typing, text: e.target.value }),
              onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitText();
                }
                if (e.key === 'Escape') setTyping(null);
              },
              onBlur: () => setTimeout(commitText, 0),
              style: {
                position: 'absolute',
                left: `${typing.x * 100}%`,
                top: `calc(${typing.y * 100}% - 1.2em)`,
                minWidth: 220,
                background: 'rgba(255,255,255,.85)',
                border: `1px dashed ${RED}`,
                color: RED,
                fontFamily: HAND,
                fontWeight: 600,
                fontSize: 'clamp(16px, 2.6vw, 26px)',
                lineHeight: 1.1,
                outline: 'none',
                resize: 'both',
                padding: 2,
              },
            })
          : null,
        h('div', { style: { position: 'absolute', right: 8, top: 6, fontSize: 11, color: '#9CA3AF' } }, `${i + 1} / ${pages.length}`),
      ),
    ),
  );
}
