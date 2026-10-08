/* eslint-disable react-hooks/refs, react-hooks/immutability -- imperative editor working on the page DOM */
import { createElement as h, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CHART_TYPES, defaultChart, PALETTE, renderChartSvg, type ChartSpec } from '@/lib/charts';
import { EDITOR_CSS, MARGIN_MM, sanitizeHtml } from '@/lib/qaReport';
import type { DocEditorProps } from './DocEditor';

// Word-like editor on an A4 page (website on a computer or tablet).
//  Text: styles, sizes, bold / italic / underline, colours, alignment, lists, lines, page breaks, page-number fields.
//  Objects – tables, photos, charts and text boxes: drag the blue ✥ handle to move one anywhere on the page (between
//  paragraphs, any distance from the margin, or beside the text on the left / right), drag the corner to resize.
//  Tables: drag a cell's right border to change the column width, its bottom border to change the row height.
//  Charts: 8 types with their data, colours, title and axis labels edited in a panel.

const MM = 96 / 25.4;
const btn: CSSProperties = { border: '1px solid #D5DAE1', background: '#fff', borderRadius: 6, padding: '4px 8px', fontSize: 13, cursor: 'pointer', minWidth: 30, color: '#111827' };
const sel: CSSProperties = { ...btn, padding: '4px 4px' };
const group: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', paddingRight: 8, marginRight: 4, borderRight: '1px solid #E5E7EB', flexWrap: 'wrap' };
const inp: CSSProperties = { border: '1px solid #D5DAE1', borderRadius: 6, padding: '5px 7px', fontSize: 13, width: '100%', boxSizing: 'border-box' };

type Kind = 'img' | 'table' | 'text' | 'chart';
type Drag =
  | { mode: 'move'; obj: HTMLElement; grabX: number; startX: number; startY: number; moved: boolean }
  | { mode: 'size'; obj: HTMLElement; startX: number; startY: number; w: number; hgt: number; ratio: number }
  | { mode: 'col'; table: HTMLTableElement; idx: number; startX: number; w: number; wNext: number }
  | { mode: 'row'; tr: HTMLTableRowElement; startY: number; hgt: number };

/** Photos are stored inside the report: resized to at most 1600 px and saved as JPEG */
async function imageDataUrl(file: File) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Cannot read the photo');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

const kindOf = (o: Element) => (o.getAttribute('data-kind') ?? 'img') as Kind;
const chartOf = (o: Element): ChartSpec => {
  try {
    return { ...defaultChart(), ...JSON.parse(decodeURIComponent(o.getAttribute('data-chart') ?? '')) };
  } catch {
    return defaultChart();
  }
};
const chartHtml = (spec: ChartSpec) =>
  `<div class="qa-obj" data-kind="chart" data-wrap="block" data-chart="${encodeURIComponent(JSON.stringify(spec))}" style="width:${spec.w}px">${renderChartSvg(spec)}</div><p><br></p>`;

export function DocEditor({ docKey, initialHtml, onChange, readOnly, header, setup, snippets }: DocEditorProps) {
  const ed = useRef<HTMLDivElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const range = useRef<Range | null>(null);
  const drag = useRef<Drag | null>(null);
  const dropLine = useRef<HTMLDivElement | null>(null);
  const [obj, setObj] = useState<HTMLElement | null>(null);
  const [cell, setCell] = useState<HTMLTableCellElement | null>(null);
  const [chart, setChart] = useState<{ el: HTMLElement | null; spec: ChartSpec } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [, setTick] = useState(0);
  const pageW = (setup.orientation === 'landscape' ? 297 : 210) * MM;
  const pageH = (setup.orientation === 'landscape' ? 210 : 297) * MM;
  const pad = MARGIN_MM[setup.margins] * MM;
  const contentW = pageW - pad * 2;

  // ---- loading / saving -------------------------------------------------------------------------------------------
  /** Objects are not editable as text themselves; table cells and text boxes inside them are */
  const prepare = (root: HTMLElement) => {
    // older reports: bare tables and photos become movable objects
    [...root.querySelectorAll(':scope > table')].forEach((t) => {
      const w = document.createElement('div');
      w.className = 'qa-obj';
      w.setAttribute('data-kind', 'table');
      w.setAttribute('data-wrap', 'block');
      t.replaceWith(w);
      w.appendChild(t);
    });
    [...root.querySelectorAll('img')].forEach((im) => {
      if (im.parentElement?.classList.contains('qa-obj')) return;
      const w = document.createElement('div');
      w.className = 'qa-obj';
      w.setAttribute('data-kind', 'img');
      w.setAttribute('data-wrap', 'block');
      w.style.width = `${Math.round(((parseFloat(im.style.width) || 60) / 100) * contentW)}px`;
      im.removeAttribute('style');
      const host = im.parentElement && im.parentElement !== root && im.parentElement.childNodes.length === 1 ? im.parentElement : im;
      host.replaceWith(w);
      w.appendChild(im);
    });
    root.querySelectorAll('.qa-obj').forEach((o) => {
      o.setAttribute('contenteditable', 'false');
      o.querySelectorAll('table, .qa-tb').forEach((x) => x.setAttribute('contenteditable', readOnly ? 'false' : 'true'));
    });
    root.querySelectorAll('.qa-pageno, .qa-pages').forEach((x) => x.setAttribute('contenteditable', 'false'));
  };
  const serialize = () => {
    if (!ed.current) return '';
    const c = ed.current.cloneNode(true) as HTMLElement;
    c.querySelectorAll('.qa-ui, .qa-drop-line').forEach((x) => x.remove());
    c.querySelectorAll('.qa-sel').forEach((x) => x.classList.remove('qa-sel'));
    return sanitizeHtml(c.innerHTML);
  };
  const changed = () => onChange(serialize());

  useEffect(() => {
    if (!ed.current) return;
    ed.current.innerHTML = sanitizeHtml(initialHtml) || '<p><br></p>';
    prepare(ed.current);
    setObj(null);
    setCell(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, readOnly]);

  // Fit the page to the screen width
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setZoom(Math.min(1, (el.clientWidth - 24) / pageW));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageW]);

  // Remember the caret so toolbar buttons act where the user was typing
  useEffect(() => {
    const save = () => {
      const s = document.getSelection();
      if (s && s.rangeCount && ed.current?.contains(s.anchorNode)) {
        range.current = s.getRangeAt(0).cloneRange();
        const n = s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement;
        const td = n?.closest('td,th') as HTMLTableCellElement | null;
        setCell(td && ed.current?.contains(td) ? td : null);
      }
    };
    document.addEventListener('selectionchange', save);
    return () => document.removeEventListener('selectionchange', save);
  }, []);

  const restore = () => {
    ed.current?.focus();
    const s = document.getSelection();
    if (range.current && s) {
      s.removeAllRanges();
      s.addRange(range.current);
    }
  };
  const cmd = (name: string, value?: string) => {
    restore();
    document.execCommand(name, false, value);
    if (ed.current) prepare(ed.current);
    changed();
  };
  /** Inserts at the caret. Objects (block = true) always go in as their own block, after the paragraph / object the caret is in */
  const insert = (html: string, block = false) => {
    restore();
    const root = ed.current;
    if (!root) return;
    if (block) {
      const s = document.getSelection();
      let at: Element | null | undefined = s?.anchorNode instanceof Element ? s.anchorNode : s?.anchorNode?.parentElement;
      if (!at || !root.contains(at) || at === root) at = null;
      while (at && at.parentElement !== root) at = at.parentElement;
      if (at) at.insertAdjacentHTML('afterend', html);
      else root.insertAdjacentHTML('beforeend', html);
    } else document.execCommand('insertHTML', false, html);
    prepare(root);
    changed();
  };

  // ---- object selection, move and resize ---------------------------------------------------------------------------
  const selectObj = (o: HTMLElement | null) => {
    ed.current?.querySelectorAll('.qa-obj.qa-sel').forEach((x) => x.classList.remove('qa-sel'));
    ed.current?.querySelectorAll('.qa-ui').forEach((x) => x.remove());
    if (o && !readOnly) {
      o.classList.add('qa-sel');
      const mv = document.createElement('div');
      mv.className = 'qa-ui qa-h-move';
      mv.textContent = '✥';
      mv.title = 'Drag to move';
      const sz = document.createElement('div');
      sz.className = 'qa-ui qa-h-size';
      sz.title = 'Drag to resize';
      o.appendChild(mv);
      o.appendChild(sz);
    }
    setObj(o);
  };
  const topBlockAt = (x: number, y: number, skip: HTMLElement) => {
    const root = ed.current!;
    const kids = [...root.children].filter((k) => k !== skip && !k.classList.contains('qa-drop-line')) as HTMLElement[];
    let best: { el: HTMLElement | null; before: boolean; y: number } = { el: null, before: false, y: 0 };
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      if (y < r.top + r.height / 2) return { el: k, before: true, y: r.top };
      best = { el: k, before: false, y: r.bottom };
    }
    void x;
    return best;
  };

  useEffect(() => {
    const root = ed.current;
    if (!root || readOnly) return;
    const edgeAt = (e: PointerEvent) => {
      const t = (e.target as HTMLElement).closest('td,th') as HTMLTableCellElement | null;
      if (!t || !root.contains(t)) return null;
      const r = t.getBoundingClientRect();
      if (r.right - e.clientX < 6 && t.cellIndex < (t.parentElement as HTMLTableRowElement).cells.length - 1) return { kind: 'col' as const, t };
      if (r.bottom - e.clientY < 5) return { kind: 'row' as const, t };
      return null;
    };
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      const o = t.closest('.qa-obj') as HTMLElement | null;
      if (t.classList.contains('qa-h-move') && o) {
        e.preventDefault();
        const r = o.getBoundingClientRect();
        drag.current = { mode: 'move', obj: o, grabX: e.clientX - r.left, startX: e.clientX, startY: e.clientY, moved: false };
        return;
      }
      if (t.classList.contains('qa-h-size') && o) {
        e.preventDefault();
        const im = o.querySelector(':scope > img') as HTMLImageElement | null;
        drag.current = { mode: 'size', obj: o, startX: e.clientX, startY: e.clientY, w: o.offsetWidth, hgt: o.offsetHeight, ratio: im && im.naturalWidth ? im.naturalHeight / im.naturalWidth : 0 };
        return;
      }
      const edge = edgeAt(e);
      if (edge?.kind === 'col') {
        e.preventDefault();
        const table = edge.t.closest('table') as HTMLTableElement;
        let cg = table.querySelector(':scope > colgroup');
        if (!cg) {
          cg = document.createElement('colgroup');
          [...table.rows[0].cells].forEach((c) => {
            const col = document.createElement('col');
            col.style.width = `${c.offsetWidth}px`;
            cg!.appendChild(col);
          });
          table.prepend(cg);
          table.style.tableLayout = 'fixed';
        }
        const cols = cg.children as HTMLCollectionOf<HTMLElement>;
        const idx = edge.t.cellIndex;
        drag.current = { mode: 'col', table, idx, startX: e.clientX, w: parseFloat(cols[idx]?.style.width) || edge.t.offsetWidth, wNext: parseFloat(cols[idx + 1]?.style.width) || 60 };
        return;
      }
      if (edge?.kind === 'row') {
        e.preventDefault();
        const tr = edge.t.parentElement as HTMLTableRowElement;
        drag.current = { mode: 'row', tr, startY: e.clientY, hgt: tr.offsetHeight };
        return;
      }
      if (o) {
        if (o !== obj) selectObj(o);
      } else if (obj) selectObj(null);
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) {
        const edge = edgeAt(e);
        root.style.cursor = edge?.kind === 'col' ? 'col-resize' : edge?.kind === 'row' ? 'row-resize' : '';
        return;
      }
      e.preventDefault();
      if (d.mode === 'move') {
        d.moved = d.moved || Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 4;
        const tgt = topBlockAt(e.clientX, e.clientY, d.obj);
        const page = root.getBoundingClientRect();
        if (!dropLine.current) {
          dropLine.current = document.createElement('div');
          dropLine.current.className = 'qa-drop-line';
          root.appendChild(dropLine.current);
        }
        dropLine.current.style.top = `${(tgt.y - page.top) / zoom - 2}px`;
        dropLine.current.style.left = '0px';
        dropLine.current.style.width = `${contentW}px`;
      } else if (d.mode === 'size') {
        const w = Math.max(40, Math.min(contentW, d.w + (e.clientX - d.startX) / zoom));
        d.obj.style.width = `${Math.round(w)}px`;
        if (kindOf(d.obj) === 'text') d.obj.style.minHeight = `${Math.round(Math.max(24, d.hgt + (e.clientY - d.startY) / zoom))}px`;
      } else if (d.mode === 'col') {
        const cols = d.table.querySelector(':scope > colgroup')!.children as HTMLCollectionOf<HTMLElement>;
        const dx = (e.clientX - d.startX) / zoom;
        const w = Math.max(24, d.w + dx);
        const wn = Math.max(24, d.wNext - (w - d.w));
        cols[d.idx].style.width = `${Math.round(w)}px`;
        if (cols[d.idx + 1]) cols[d.idx + 1].style.width = `${Math.round(wn)}px`;
      } else if (d.mode === 'row') {
        d.tr.style.height = `${Math.round(Math.max(18, d.hgt + (e.clientY - d.startY) / zoom))}px`;
      }
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      dropLine.current?.remove();
      dropLine.current = null;
      if (d.mode === 'move' && d.moved) {
        const tgt = topBlockAt(e.clientX, e.clientY, d.obj);
        if (tgt.el) tgt.el.insertAdjacentElement(tgt.before ? 'beforebegin' : 'afterend', d.obj);
        else root.appendChild(d.obj);
        // horizontal position: any distance from the margin; floated objects go to the nearer side
        const page = root.getBoundingClientRect();
        const left = Math.max(0, Math.min(contentW - d.obj.offsetWidth, (e.clientX - page.left - d.grabX) / zoom));
        if ((d.obj.getAttribute('data-wrap') ?? 'block') === 'block') d.obj.style.marginLeft = `${Math.round(left)}px`;
        else d.obj.setAttribute('data-wrap', left + d.obj.offsetWidth / 2 < contentW / 2 ? 'left' : 'right');
      }
      if (d.mode === 'size' && kindOf(d.obj) === 'chart') {
        const spec = chartOf(d.obj);
        spec.w = d.obj.offsetWidth;
        spec.h = Math.round(spec.w * (spec.h / Math.max(1, d.w)));
        renderChartInto(d.obj, spec);
      }
      changed();
      setTick((t) => t + 1);
    };
    root.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      root.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  const renderChartInto = (o: HTMLElement, spec: ChartSpec) => {
    o.setAttribute('data-chart', encodeURIComponent(JSON.stringify(spec)));
    o.style.width = `${spec.w}px`;
    const ui = [...o.querySelectorAll('.qa-ui')];
    o.innerHTML = renderChartSvg(spec);
    ui.forEach((u) => o.appendChild(u));
  };

  // ---- inserting ---------------------------------------------------------------------------------------------------
  const addImages = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      const src = await imageDataUrl(f);
      insert(`<div class="qa-obj" data-kind="img" data-wrap="block" style="width:${Math.round(contentW * 0.6)}px"><img src="${src}" alt=""/></div><p><br></p>`, true);
    }
  };
  const pickImages = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => input.files && void addImages(input.files);
    input.click();
  };
  const table = () => {
    const spec = window.prompt('Table size – rows x columns (the first row is the heading)', '4 x 3');
    const m = spec?.match(/(\d+)\s*[x×*,]\s*(\d+)/i);
    if (!m) return;
    const rows = Math.min(60, Math.max(1, Number(m[1])));
    const cols = Math.min(12, Math.max(1, Number(m[2])));
    const cw = Math.floor(contentW / cols);
    const head = `<tr>${Array.from({ length: cols }, (_, i) => `<th>Heading ${i + 1}</th>`).join('')}</tr>`;
    const body = Array.from({ length: rows - 1 }, () => `<tr>${'<td><br></td>'.repeat(cols)}</tr>`).join('');
    insert(`<div class="qa-obj" data-kind="table" data-wrap="block" style="width:${Math.round(contentW)}px"><table><colgroup>${`<col style="width:${cw}px">`.repeat(cols)}</colgroup><tbody>${head}${body}</tbody></table></div><p><br></p>`, true);
  };
  const textBox = () =>
    insert(`<div class="qa-obj" data-kind="text" data-wrap="right" style="width:${Math.round(contentW * 0.4)}px"><div class="qa-tb" style="border:1px solid #64748B;background:#F8FAFC">Text label</div></div>`, true);
  const rowOp = (op: 'row' | 'col' | 'delrow' | 'delcol' | 'deltable') => {
    if (!cell) return;
    const tr = cell.parentElement as HTMLTableRowElement;
    const tbl = cell.closest('table');
    if (!tbl) return;
    const idx = cell.cellIndex;
    const cg = tbl.querySelector(':scope > colgroup');
    if (op === 'row') {
      const n = tr.cloneNode(true) as HTMLTableRowElement;
      n.removeAttribute('style');
      n.querySelectorAll('th,td').forEach((c) => {
        const td = document.createElement('td');
        td.innerHTML = '<br>';
        c.replaceWith(td);
      });
      tr.after(n);
    } else if (op === 'col') {
      tbl.querySelectorAll('tr').forEach((r) => {
        const ref = r.children[idx];
        const c = document.createElement(ref?.tagName === 'TH' ? 'th' : 'td');
        c.innerHTML = '<br>';
        if (ref) ref.after(c);
        else r.appendChild(c);
      });
      if (cg) {
        const cols = [...cg.children] as HTMLElement[];
        const w = Math.max(24, (parseFloat(cols[idx]?.style.width) || 80) / 2);
        if (cols[idx]) cols[idx].style.width = `${w}px`;
        const c = document.createElement('col');
        c.style.width = `${w}px`;
        cols[idx]?.after(c);
      }
    } else if (op === 'delrow') {
      if (tbl.querySelectorAll('tr').length > 1) tr.remove();
    } else if (op === 'delcol') {
      if (tr.children.length > 1) {
        tbl.querySelectorAll('tr').forEach((r) => r.children[idx]?.remove());
        cg?.children[idx]?.remove();
      }
    } else {
      (tbl.closest('.qa-obj') ?? tbl).remove();
      selectObj(null);
    }
    setCell(null);
    changed();
  };
  const objOp = (f: (o: HTMLElement) => void) => {
    if (!obj) return;
    f(obj);
    changed();
    setTick((t) => t + 1);
  };

  // drop / paste photos
  useEffect(() => {
    const el = ed.current;
    if (!el || readOnly) return;
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
      const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (r) range.current = r;
      void addImages(e.dataTransfer.files);
    };
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void addImages(files);
      }
    };
    const dbl = (e: MouseEvent) => {
      const o = (e.target as HTMLElement).closest('.qa-obj') as HTMLElement | null;
      if (o && kindOf(o) === 'chart') setChart({ el: o, spec: chartOf(o) });
    };
    el.addEventListener('drop', drop);
    el.addEventListener('paste', paste);
    el.addEventListener('dblclick', dbl);
    return () => {
      el.removeEventListener('drop', drop);
      el.removeEventListener('paste', paste);
      el.removeEventListener('dblclick', dbl);
    };
  });

  // ---- toolbar -----------------------------------------------------------------------------------------------------
  const B = (title: string, label: string, onDo: () => void, extra: CSSProperties = {}) =>
    h('button', { type: 'button', title, style: { ...btn, ...extra }, onMouseDown: (e: MouseEvent) => e.preventDefault(), onClick: onDo }, label);
  const selBox = (title: string, label: string, options: [string, string][], onPick: (v: string) => void) =>
    h(
      'select',
      { style: sel, title, defaultValue: '', onChange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) onPick(v); (e.target as HTMLSelectElement).value = ''; } },
      h('option', { value: '' }, label),
      ...options.map(([v, l]) => h('option', { key: v, value: v }, l)),
    );
  const kind = obj ? kindOf(obj) : null;
  const wrapMode = obj?.getAttribute('data-wrap') ?? 'block';

  const toolbar = readOnly
    ? null
    : h(
        'div',
        { style: { position: 'sticky', top: 0, zIndex: 5, display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, background: '#F8FAFC', borderBottom: '1px solid #E5E7EB' } },
        h(
          'div',
          { style: group },
          selBox('Paragraph style', 'Style', [['p', 'Normal text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3']], (v) => cmd('formatBlock', v)),
          selBox('Text size', 'Size', [['1', '8 pt'], ['2', '10 pt'], ['3', '12 pt'], ['4', '14 pt'], ['5', '18 pt'], ['6', '24 pt'], ['7', '32 pt']], (v) => cmd('fontSize', v)),
          selBox('Font', 'Font', [['Calibri, Arial, sans-serif', 'Calibri / Arial'], ['Times New Roman, serif', 'Times'], ['Courier New, monospace', 'Courier']], (v) => cmd('fontName', v)),
        ),
        h(
          'div',
          { style: group },
          B('Bold', 'B', () => cmd('bold'), { fontWeight: 800 }),
          B('Italic', 'I', () => cmd('italic'), { fontStyle: 'italic' }),
          B('Underline', 'U', () => cmd('underline'), { textDecoration: 'underline' }),
          h('label', { title: 'Text colour', style: { ...btn, display: 'flex', alignItems: 'center', gap: 4 } }, 'A', h('input', { type: 'color', defaultValue: '#C8102E', style: { width: 22, height: 18, border: 0, padding: 0, background: 'none' }, onChange: (e: Event) => cmd('foreColor', (e.target as HTMLInputElement).value) })),
          h('label', { title: 'Highlight / cell shading', style: { ...btn, display: 'flex', alignItems: 'center', gap: 4 } }, '▮', h('input', { type: 'color', defaultValue: '#FFF59D', style: { width: 22, height: 18, border: 0, padding: 0, background: 'none' }, onChange: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (cell && document.getSelection()?.isCollapsed) { cell.style.background = v; changed(); } else cmd('hiliteColor', v); } })),
          B('Clear formatting', '⌫ fmt', () => cmd('removeFormat')),
        ),
        h(
          'div',
          { style: group },
          B('Align left', '⯇', () => cmd('justifyLeft')),
          B('Centre', '≡', () => cmd('justifyCenter')),
          B('Align right', '⯈', () => cmd('justifyRight')),
          B('Justify', '☰', () => cmd('justifyFull')),
          B('Bullet list', '• list', () => cmd('insertUnorderedList')),
          B('Numbered list', '1. list', () => cmd('insertOrderedList')),
          B('Indent', '→', () => cmd('indent')),
          B('Outdent', '←', () => cmd('outdent')),
        ),
        h(
          'div',
          { style: group },
          B('Insert table', '▦ Table', table),
          B('Insert photos (or drag and drop / paste them onto the page)', '🖼 Photo', pickImages),
          B('Insert a chart', '📊 Chart', () => setChart({ el: null, spec: defaultChart() })),
          B('Insert a text label / box', '🅃 Text box', textBox),
          B('Line', '— Line', () => insert('<hr/>')),
          B('Start a new page', '⤓ Page break', () => insert('<div class="page-break"></div><p><br></p>')),
          selBox('Page number field', '# Page no.', [['n', 'Page number'], ['nn', 'Page X of Y']], (v) =>
            insert(v === 'n' ? '<span class="qa-pageno">#</span>&nbsp;' : 'Page <span class="qa-pageno">#</span> of <span class="qa-pages">#</span>&nbsp;'),
          ),
          snippets?.length ? selBox('Insert test readings', 'Insert test readings…', snippets.map((sn) => [sn.key, sn.label] as [string, string]), (v) => { const sn = snippets.find((x) => x.key === v); if (sn) insert(sn.html.replace('<table>', `<div class="qa-obj" data-kind="table" data-wrap="block" style="width:${Math.round(contentW)}px"><table>`).replace('</table>', '</table></div>'), true); }) : null,
        ),
        h('div', { style: { ...group, borderRight: 0 } }, B('Undo', '↶', () => cmd('undo')), B('Redo', '↷', () => cmd('redo'))),
        cell
          ? h(
              'div',
              { style: { ...group, borderRight: 0, width: '100%', paddingTop: 4, borderTop: '1px dashed #E5E7EB' } },
              h('span', { style: { fontSize: 12, color: '#6B7280' } }, 'Table:'),
              B('Add a row below', '+ Row', () => rowOp('row')),
              B('Add a column to the right', '+ Column', () => rowOp('col')),
              B('Delete this row', '− Row', () => rowOp('delrow')),
              B('Delete this column', '− Column', () => rowOp('delcol')),
              B('Delete the table', 'Delete table', () => rowOp('deltable'), { color: '#C8102E' }),
              h('span', { style: { fontSize: 11.5, color: '#6B7280' } }, 'Drag a cell border to change column width / row height'),
            )
          : null,
        obj
          ? h(
              'div',
              { style: { ...group, borderRight: 0, width: '100%', paddingTop: 4, borderTop: '1px dashed #E5E7EB' } },
              h('span', { style: { fontSize: 12, color: '#6B7280' } }, `${kind === 'img' ? 'Photo' : kind === 'chart' ? 'Chart' : kind === 'text' ? 'Text box' : 'Table'}:`),
              B('On its own line (drag ✥ to set the distance from the margin)', wrapMode === 'block' ? '● Own line' : 'Own line', () => objOp((o) => o.setAttribute('data-wrap', 'block'))),
              B('Text flows on its right', wrapMode === 'left' ? '● Left, text beside' : 'Left, text beside', () => objOp((o) => { o.setAttribute('data-wrap', 'left'); o.style.marginLeft = ''; })),
              B('Text flows on its left', wrapMode === 'right' ? '● Right, text beside' : 'Right, text beside', () => objOp((o) => { o.setAttribute('data-wrap', 'right'); o.style.marginLeft = ''; })),
              B('Centre on the page', 'Centre', () => objOp((o) => { o.setAttribute('data-wrap', 'block'); o.style.marginLeft = `${Math.round((contentW - o.offsetWidth) / 2)}px`; })),
              ...['25%', '50%', '75%', '100%'].map((w) => B(`Width ${w} of the page`, w, () => objOp((o) => { o.style.width = `${Math.round((parseFloat(w) / 100) * contentW)}px`; if (kindOf(o) === 'chart') { const sp = chartOf(o); sp.h = Math.round((sp.h / sp.w) * o.offsetWidth); sp.w = o.offsetWidth; renderChartInto(o, sp); } }))),
              kind === 'chart' ? B('Edit chart data, type, colours and labels', '✎ Edit chart', () => setChart({ el: obj, spec: chartOf(obj) })) : null,
              kind === 'text'
                ? h(
                    'span',
                    { style: { display: 'flex', gap: 4 } },
                    B('Border on / off', 'Border', () => objOp((o) => { const tb = o.querySelector('.qa-tb') as HTMLElement; tb.style.border = tb.style.border && tb.style.border !== 'none' ? 'none' : '1px solid #64748B'; })),
                    h('label', { title: 'Fill colour', style: { ...btn, display: 'flex', alignItems: 'center', gap: 4 } }, 'Fill', h('input', { type: 'color', defaultValue: '#F8FAFC', style: { width: 22, height: 18, border: 0, padding: 0 }, onChange: (e: Event) => objOp((o) => { (o.querySelector('.qa-tb') as HTMLElement).style.background = (e.target as HTMLInputElement).value; }) })),
                  )
                : null,
              B('Delete', 'Delete', () => { obj.remove(); selectObj(null); changed(); }, { color: '#C8102E' }),
            )
          : null,
      );

  return h(
    'div',
    { style: { fontFamily: 'Arial, Helvetica, sans-serif', border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden', background: '#E5E7EB' } },
    h('style', null, EDITOR_CSS),
    toolbar,
    h(
      'div',
      { ref: wrap, style: { padding: 12, overflowX: 'hidden', display: 'flex', justifyContent: 'center' } },
      h(
        'div',
        {
          style: {
            zoom,
            width: pageW,
            minHeight: pageH,
            padding: pad,
            boxSizing: 'border-box',
            background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,.18)',
            backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${pageH - 1}px, #C7CDD6 ${pageH - 1}px, #C7CDD6 ${pageH}px)`,
          },
        },
        h('div', { dangerouslySetInnerHTML: { __html: header }, style: { marginBottom: 10, userSelect: 'none' }, contentEditable: false }),
        h('div', {
          ref: ed,
          className: 'qa-body',
          contentEditable: !readOnly,
          suppressContentEditableWarning: true,
          spellCheck: true,
          onInput: changed,
          onBlur: changed,
          style: { position: 'relative', minHeight: pageH - pad * 2 - 140, cursor: readOnly ? 'default' : 'text' },
        }),
      ),
    ),
    chart ? h(ChartPanel, { spec: chart.spec, onCancel: () => setChart(null), onSave: (spec: ChartSpec) => {
      if (chart.el) renderChartInto(chart.el, spec);
      else insert(chartHtml(spec), true);
      setChart(null);
      changed();
    } }) : null,
  );
}

/** Chart editor: type, title, axis labels, categories and series (values and colours), legend, data labels, axis range */
function ChartPanel({ spec: initial, onSave, onCancel }: { spec: ChartSpec; onSave: (s: ChartSpec) => void; onCancel: () => void }) {
  const [s, setS] = useState<ChartSpec>(initial);
  const pie = s.type === 'pie' || s.type === 'doughnut';
  const set = <K extends keyof ChartSpec>(k: K, v: ChartSpec[K]) => setS((x) => ({ ...x, [k]: v }));
  const setCat = (i: number, v: string) => setS((x) => ({ ...x, categories: x.categories.map((c, k) => (k === i ? v : c)) }));
  const setVal = (si: number, i: number, v: string) =>
    setS((x) => ({ ...x, series: x.series.map((se, k) => (k === si ? { ...se, values: x.categories.map((_, j) => (j === i ? (v.trim() === '' ? null : Number(v)) : se.values[j] ?? null)) } : se)) }));
  const label = (t: string, el: ReactNode) => h('label', { style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: '#374151', flex: 1, minWidth: 140 } }, t, el);
  const cellInp: CSSProperties = { ...inp, padding: '3px 5px', minWidth: 56 };
  return h(
    'div',
    { style: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 } },
    h(
      'div',
      { style: { fontFamily: 'Arial, Helvetica, sans-serif', background: '#fff', borderRadius: 12, width: 'min(980px, 100%)', maxHeight: '92vh', overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 10px 30px rgba(0,0,0,.25)' } },
      h('div', { style: { fontWeight: 800, fontSize: 16 } }, 'Chart'),
      h(
        'div',
        { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
        label('Type', h('select', { style: inp, value: s.type, onChange: (e: Event) => set('type', (e.target as HTMLSelectElement).value as ChartSpec['type']) }, ...CHART_TYPES.map((t) => h('option', { key: t.value, value: t.value }, t.label)))),
        label('Title', h('input', { style: inp, value: s.title, onChange: (e: Event) => set('title', (e.target as HTMLInputElement).value) })),
        !pie ? label(s.type === 'hbar' ? 'Value axis label' : 'X axis label', h('input', { style: inp, value: s.xLabel, onChange: (e: Event) => set('xLabel', (e.target as HTMLInputElement).value) })) : null,
        !pie ? label(s.type === 'hbar' ? 'Category axis label' : 'Y axis label', h('input', { style: inp, value: s.yLabel, onChange: (e: Event) => set('yLabel', (e.target as HTMLInputElement).value) })) : null,
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 } },
        h('label', null, h('input', { type: 'checkbox', checked: s.legend, onChange: (e: Event) => set('legend', (e.target as HTMLInputElement).checked) }), ' Legend'),
        h('label', null, h('input', { type: 'checkbox', checked: s.showValues, onChange: (e: Event) => set('showValues', (e.target as HTMLInputElement).checked) }), pie ? ' Show percentages' : ' Show values'),
        !pie ? h('label', null, 'Axis from ', h('input', { style: { ...inp, width: 80, display: 'inline-block' }, placeholder: 'auto', value: s.yMin ?? '', onChange: (e: Event) => { const v = (e.target as HTMLInputElement).value; set('yMin', v === '' ? null : Number(v)); } })) : null,
        !pie ? h('label', null, ' to ', h('input', { style: { ...inp, width: 80, display: 'inline-block' }, placeholder: 'auto', value: s.yMax ?? '', onChange: (e: Event) => { const v = (e.target as HTMLInputElement).value; set('yMax', v === '' ? null : Number(v)); } })) : null,
      ),
      h('div', { style: { fontSize: 12, color: '#6B7280' } }, pie ? 'Pie / doughnut uses the first series; each category has its own colour.' : s.type === 'scatter' ? 'Scatter: the categories row holds the X values (numbers).' : 'Categories run along the axis; each series is one set of bars / one line.'),
      h(
        'div',
        { style: { overflowX: 'auto' } },
        h(
          'table',
          { style: { borderCollapse: 'collapse', fontSize: 13 } },
          h(
            'tbody',
            null,
            h(
              'tr',
              null,
              h('th', { style: { padding: 4, textAlign: 'left', minWidth: 170 } }, s.type === 'scatter' ? 'X values →' : 'Categories →'),
              ...s.categories.map((c, i) =>
                h('th', { key: i, style: { padding: 3 } },
                  h('input', { style: cellInp, value: c, onChange: (e: Event) => setCat(i, (e.target as HTMLInputElement).value) }),
                  pie ? h('input', { type: 'color', value: s.catColors?.[i] ?? PALETTE[i % PALETTE.length], style: { width: '100%', height: 20, border: 0, marginTop: 2 }, onChange: (e: Event) => setS((x) => { const cc = x.categories.map((_, k) => x.catColors?.[k] ?? PALETTE[k % PALETTE.length]); cc[i] = (e.target as HTMLInputElement).value; return { ...x, catColors: cc }; }) }) : null,
                ),
              ),
              h('th', null,
                h('button', { type: 'button', style: btn, title: 'Add a category', onClick: () => setS((x) => ({ ...x, categories: [...x.categories, `C${x.categories.length + 1}`], series: x.series.map((se) => ({ ...se, values: [...se.values, null] })) })) }, '+'),
                s.categories.length > 1 ? h('button', { type: 'button', style: { ...btn, marginLeft: 4 }, title: 'Remove the last category', onClick: () => setS((x) => ({ ...x, categories: x.categories.slice(0, -1), series: x.series.map((se) => ({ ...se, values: se.values.slice(0, -1) })) })) }, '−') : null,
              ),
            ),
            ...s.series.map((se, si) =>
              h(
                'tr',
                { key: si },
                h('td', { style: { padding: 3, display: 'flex', gap: 4, alignItems: 'center' } },
                  h('input', { type: 'color', value: se.color, title: 'Series colour', style: { width: 28, height: 26, border: 0, padding: 0 }, onChange: (e: Event) => setS((x) => ({ ...x, series: x.series.map((y, k) => (k === si ? { ...y, color: (e.target as HTMLInputElement).value } : y)) })) }),
                  h('input', { style: cellInp, value: se.name, onChange: (e: Event) => setS((x) => ({ ...x, series: x.series.map((y, k) => (k === si ? { ...y, name: (e.target as HTMLInputElement).value } : y)) })) }),
                ),
                ...s.categories.map((_, i) => h('td', { key: i, style: { padding: 3 } }, h('input', { style: cellInp, inputMode: 'decimal', value: se.values[i] ?? '', onChange: (e: Event) => setVal(si, i, (e.target as HTMLInputElement).value) }))),
                h('td', null, s.series.length > 1 ? h('button', { type: 'button', style: btn, title: 'Remove this series', onClick: () => setS((x) => ({ ...x, series: x.series.filter((_, k) => k !== si) })) }, '✕') : null),
              ),
            ),
          ),
        ),
        h('button', { type: 'button', style: { ...btn, marginTop: 6 }, onClick: () => setS((x) => ({ ...x, series: [...x.series, { name: `Series ${x.series.length + 1}`, color: PALETTE[x.series.length % PALETTE.length], values: x.categories.map(() => null) }] })) }, '+ Series'),
      ),
      h('div', { style: { border: '1px solid #E5E7EB', borderRadius: 8, padding: 8, maxWidth: 560, alignSelf: 'center', width: '100%' }, dangerouslySetInnerHTML: { __html: renderChartSvg(s) } }),
      h(
        'div',
        { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
        h('button', { type: 'button', style: btn, onClick: onCancel }, 'Cancel'),
        h('button', { type: 'button', style: { ...btn, background: '#C8102E', color: '#fff', borderColor: '#C8102E', fontWeight: 700 }, onClick: () => onSave(s) }, 'Insert / update chart'),
      ),
    ),
  );
}
