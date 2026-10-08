/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/set-state-in-effect -- imperative editor working on the page DOM */
import { createElement as h, useEffect, useRef, useState, type CSSProperties } from 'react';
import { EDITOR_CSS, MARGIN_MM, sanitizeHtml } from '@/lib/qaReport';
import type { DocEditorProps } from './DocEditor';

// Word-like editor on an A4 page (website on a computer or tablet): headings, fonts, colours, alignment, lists, tables
// (add / remove rows and columns), photos by button, drag and drop or paste (resized, sized and placed by clicking them),
// page breaks, undo / redo. The project header with the DIMO logo sits at the top of the page as it prints.

const MM = 96 / 25.4;
const btn: CSSProperties = { border: '1px solid #D5DAE1', background: '#fff', borderRadius: 6, padding: '4px 8px', fontSize: 13, cursor: 'pointer', minWidth: 30, color: '#111827' };
const sel: CSSProperties = { ...btn, padding: '4px 4px' };
const group: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', paddingRight: 8, marginRight: 4, borderRight: '1px solid #E5E7EB', flexWrap: 'wrap' };

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

export function DocEditor({ docKey, initialHtml, onChange, readOnly, header, setup, snippets }: DocEditorProps) {
  const ed = useRef<HTMLDivElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const range = useRef<Range | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [cell, setCell] = useState<HTMLTableCellElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const pageW = (setup.orientation === 'landscape' ? 297 : 210) * MM;
  const pageH = (setup.orientation === 'landscape' ? 210 : 297) * MM;
  const pad = MARGIN_MM[setup.margins] * MM;

  // Load the document (again only when another report or version is opened)
  useEffect(() => {
    if (ed.current) ed.current.innerHTML = sanitizeHtml(initialHtml) || '<p><br></p>';
    setImg(null);
    setCell(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

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

  const changed = () => ed.current && onChange(sanitizeHtml(ed.current.innerHTML));
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
    changed();
  };
  const insert = (html: string) => cmd('insertHTML', html);

  const addImages = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      const src = await imageDataUrl(f);
      insert(`<p><img src="${src}" style="width:60%" alt=""/></p>`);
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
    const head = `<tr>${Array.from({ length: cols }, (_, i) => `<th>Heading ${i + 1}</th>`).join('')}</tr>`;
    const body = Array.from({ length: rows - 1 }, () => `<tr>${'<td><br></td>'.repeat(cols)}</tr>`).join('');
    insert(`<table><tbody>${head}${body}</tbody></table><p><br></p>`);
  };
  const rowOp = (op: 'row' | 'col' | 'delrow' | 'delcol' | 'deltable') => {
    if (!cell) return;
    const tr = cell.parentElement as HTMLTableRowElement;
    const tbl = cell.closest('table');
    if (!tbl) return;
    const idx = cell.cellIndex;
    if (op === 'row') {
      const n = tr.cloneNode(true) as HTMLTableRowElement;
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
    } else if (op === 'delrow') {
      if (tbl.querySelectorAll('tr').length > 1) tr.remove();
    } else if (op === 'delcol') {
      if (tr.children.length > 1) tbl.querySelectorAll('tr').forEach((r) => r.children[idx]?.remove());
    } else tbl.remove();
    setCell(null);
    changed();
  };
  const imgOp = (w?: string, align?: 'left' | 'center' | 'right') => {
    if (!img) return;
    if (w) img.style.width = w;
    if (align) {
      const p = img.parentElement;
      if (p && p !== ed.current) p.style.textAlign = align;
    }
    changed();
  };

  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    ed.current?.querySelectorAll('img.qa-sel').forEach((x) => x.classList.remove('qa-sel'));
    if (t.tagName === 'IMG' && !readOnly) {
      t.classList.add('qa-sel');
      setImg(t as HTMLImageElement);
    } else setImg(null);
  };
  const onDrop = (e: DragEvent) => {
    if (readOnly || !e.dataTransfer?.files?.length) return; // moving text / photos inside the page is left to the browser
    e.preventDefault();
    const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
    const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (r) range.current = r;
    void addImages(e.dataTransfer.files);
  };
  const onPaste = (e: ClipboardEvent) => {
    if (readOnly) return;
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      void addImages(files);
    }
  };
  // Ctrl/⌘+S saves the draft
  useEffect(() => {
    const el = ed.current;
    if (!el) return;
    const drop = (e: DragEvent) => onDrop(e);
    const paste = (e: ClipboardEvent) => onPaste(e);
    const click = (e: MouseEvent) => onClick(e);
    el.addEventListener('drop', drop);
    el.addEventListener('paste', paste);
    el.addEventListener('click', click);
    return () => {
      el.removeEventListener('drop', drop);
      el.removeEventListener('paste', paste);
      el.removeEventListener('click', click);
    };
  });

  const B = (title: string, label: string, onDo: () => void, extra: CSSProperties = {}) =>
    h('button', { type: 'button', title, style: { ...btn, ...extra }, onMouseDown: (e: MouseEvent) => e.preventDefault(), onClick: onDo }, label);

  const toolbar = readOnly
    ? null
    : h(
        'div',
        { style: { position: 'sticky', top: 0, zIndex: 5, display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, background: '#F8FAFC', borderBottom: '1px solid #E5E7EB' } },
        h(
          'div',
          { style: group },
          h(
            'select',
            { style: sel, title: 'Paragraph style', defaultValue: '', onChange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) cmd('formatBlock', v); (e.target as HTMLSelectElement).value = ''; } },
            h('option', { value: '' }, 'Style'),
            h('option', { value: 'p' }, 'Normal text'),
            h('option', { value: 'h1' }, 'Heading 1'),
            h('option', { value: 'h2' }, 'Heading 2'),
            h('option', { value: 'h3' }, 'Heading 3'),
          ),
          h(
            'select',
            { style: sel, title: 'Text size', defaultValue: '', onChange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) cmd('fontSize', v); (e.target as HTMLSelectElement).value = ''; } },
            h('option', { value: '' }, 'Size'),
            ...[['1', '8'], ['2', '10'], ['3', '12'], ['4', '14'], ['5', '18'], ['6', '24'], ['7', '32']].map(([v, l]) => h('option', { key: v, value: v }, `${l} pt`)),
          ),
        ),
        h(
          'div',
          { style: group },
          B('Bold', 'B', () => cmd('bold'), { fontWeight: 800 }),
          B('Italic', 'I', () => cmd('italic'), { fontStyle: 'italic' }),
          B('Underline', 'U', () => cmd('underline'), { textDecoration: 'underline' }),
          h('label', { title: 'Text colour', style: { ...btn, display: 'flex', alignItems: 'center', gap: 4 } }, 'A', h('input', { type: 'color', defaultValue: '#C8102E', style: { width: 22, height: 18, border: 0, padding: 0, background: 'none' }, onChange: (e: Event) => cmd('foreColor', (e.target as HTMLInputElement).value) })),
          h('label', { title: 'Highlight', style: { ...btn, display: 'flex', alignItems: 'center', gap: 4 } }, '▮', h('input', { type: 'color', defaultValue: '#FFF59D', style: { width: 22, height: 18, border: 0, padding: 0, background: 'none' }, onChange: (e: Event) => cmd('hiliteColor', (e.target as HTMLInputElement).value) })),
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
          B('Line', '— Line', () => insert('<hr/>')),
          B('Start a new page', '⤓ Page break', () => insert('<div class="page-break"></div><p><br></p>')),
          snippets?.length
            ? h(
                'select',
                { style: sel, title: 'Insert test readings', defaultValue: '', onChange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; const sn = snippets.find((x) => x.key === v); if (sn) insert(sn.html); (e.target as HTMLSelectElement).value = ''; } },
                h('option', { value: '' }, 'Insert test readings…'),
                ...snippets.map((sn) => h('option', { key: sn.key, value: sn.key }, sn.label)),
              )
            : null,
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
            )
          : null,
        img
          ? h(
              'div',
              { style: { ...group, borderRight: 0, width: '100%', paddingTop: 4, borderTop: '1px dashed #E5E7EB' } },
              h('span', { style: { fontSize: 12, color: '#6B7280' } }, 'Photo:'),
              ...['25%', '40%', '60%', '80%', '100%'].map((w) => B(`Width ${w}`, w, () => imgOp(w))),
              B('Left', 'Left', () => imgOp(undefined, 'left')),
              B('Centre', 'Centre', () => imgOp(undefined, 'center')),
              B('Right', 'Right', () => imgOp(undefined, 'right')),
              B('Delete the photo', 'Delete', () => { img.remove(); setImg(null); changed(); }, { color: '#C8102E' }),
            )
          : null,
      );

  return h(
    'div',
    { style: { border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden', background: '#E5E7EB' } },
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
            // light dashed line where each A4 page ends (approximate – the printed header repeats on every page)
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
          style: { minHeight: pageH - pad * 2 - 140, cursor: readOnly ? 'default' : 'text' },
        }),
      ),
    ),
  );
}
