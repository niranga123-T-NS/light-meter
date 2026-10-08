import { Platform } from 'react-native';
import { DIMO_LOGO_DATA_URI } from './brandLogoData';
import { projectNo, type ExecProject } from './execution';
import { esc, printHtml } from './export';
import { fmtDateNum, fmtDateTimeY } from './format';

// QA / QC test reports written in the app on A4 pages: the project header with the DIMO logo is drawn on every page,
// the body is the author's own document (text, tables, photos, readings). Printed / saved as PDF from the browser.

export type QaReport = {
  id: string;
  code: string;
  exec_project_id: string;
  title: string;
  test_record_id: string | null;
  content_html: string;
  page_setup: PageSetup;
  status: 'draft' | 'submitted' | 'approved' | 'returned';
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};
export type PageSetup = { orientation: 'portrait' | 'landscape'; margins: 'narrow' | 'normal' | 'wide' };
export const QA_STATUS: Record<QaReport['status'], string> = { draft: 'Draft', submitted: 'Waiting for SEE approval', approved: 'Approved – published', returned: 'Returned – revise' };
export const MARGIN_MM: Record<PageSetup['margins'], number> = { narrow: 12, normal: 18, wide: 25 };

/** Removes anything that could run code from report HTML (scripts, frames, event attributes, javascript: links) */
export function sanitizeHtml(html: string) {
  return (html ?? '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select)\b[\s\S]*?(<\s*\/\s*\1\s*>|\/?>)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|xlink:href)\s*=\s*("|')\s*(javascript|vbscript|data:(?!image\/))[^"']*\2/gi, '$1="#"')
    .replace(/\scontenteditable\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

export type HeaderInfo = { project: Pick<ExecProject, 'name' | 'code' | 'wbs_no' | 'client_name' | 'site_address'>; code: string; title: string; version: number; status: QaReport['status']; date: string };

/** The header drawn at the top of every page (editor and PDF) */
export function headerHtml(h: HeaderInfo) {
  const no = projectNo(h.project);
  return `<table class="qa-hdr" style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#111">
  <tr>
    <td rowspan="3" style="width:22%;border:0.6pt solid #333;text-align:center;padding:4pt"><img src="${DIMO_LOGO_DATA_URI}" alt="DIMO" style="height:42pt;width:auto"/></td>
    <td style="border:0.6pt solid #333;text-align:center;font-weight:700;padding:3pt">DIMO PLC – LIGHTING PROJECTS · QUALITY ASSURANCE / CONTROL</td>
    <td style="width:26%;border:0.6pt solid #333;padding:3pt">Report No: <b>${esc(h.code || 'New')}</b></td>
  </tr>
  <tr>
    <td rowspan="2" style="border:0.6pt solid #333;text-align:center;padding:3pt"><div style="font-size:13pt;font-weight:700">TEST REPORT</div><div style="font-size:10pt;margin-top:2pt">${esc(h.title || '')}</div></td>
    <td style="border:0.6pt solid #333;padding:3pt">Version: <b>${h.version}</b> · ${esc(h.status === 'approved' ? 'Approved' : h.status === 'submitted' ? 'For approval' : 'Draft')}</td>
  </tr>
  <tr><td style="border:0.6pt solid #333;padding:3pt">Date: <b>${esc(h.date)}</b></td></tr>
  <tr>
    <td colspan="3" style="border:0.6pt solid #333;padding:3pt;background:#F4F6F9">Project: <b>${esc([no, h.project.name].filter(Boolean).join(' – '))}</b>${h.project.client_name ? ` &nbsp;·&nbsp; Client: ${esc(h.project.client_name)}` : ''}${h.project.site_address ? ` &nbsp;·&nbsp; Site: ${esc(h.project.site_address)}` : ''}</td>
  </tr>
</table>`;
}

const CONTENT_CSS = `
  .qa-body { font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 11pt; color: #111; line-height: 1.35; }
  .qa-body h1 { font-size: 16pt; margin: 8pt 0 4pt; } .qa-body h2 { font-size: 13pt; margin: 8pt 0 4pt; } .qa-body h3 { font-size: 11.5pt; margin: 6pt 0 3pt; }
  .qa-body p { margin: 0 0 5pt; } .qa-body ul, .qa-body ol { margin: 0 0 5pt 18pt; padding: 0; }
  .qa-body table { border-collapse: collapse; width: 100%; margin: 4pt 0 8pt; }
  .qa-body td, .qa-body th { border: 0.6pt solid #444; padding: 3pt 5pt; vertical-align: top; }
  .qa-body th { background: #E8ECF2; text-align: left; }
  .qa-body img { max-width: 100%; height: auto; }
  .qa-body hr { border: 0; border-top: 0.8pt solid #888; margin: 6pt 0; }
  .qa-body::after { content: ''; display: block; clear: both; }
  .qa-obj { position: relative; margin: 6pt 0; box-sizing: border-box; max-width: 100%; }
  .qa-obj[data-wrap="left"] { float: left; margin: 3pt 10pt 6pt 0; }
  .qa-obj[data-wrap="right"] { float: right; margin: 3pt 0 6pt 10pt; }
  .qa-obj[data-wrap="block"] { clear: both; }
  .qa-obj > img { width: 100%; height: auto; display: block; }
  .qa-obj table { width: 100%; table-layout: fixed; margin: 0; }
  .qa-obj[data-kind="chart"] svg { width: 100%; height: auto; display: block; }
  .qa-tb { padding: 4pt 6pt; min-height: 14pt; box-sizing: border-box; }
  .qa-tb p:last-child { margin-bottom: 0; }
`;
export const EDITOR_CSS = `${CONTENT_CSS}
  .qa-body .page-break { border-top: 1px dashed #9AA3AF; margin: 14px 0; height: 0; position: relative; }
  .qa-body .page-break::after { content: 'Page break'; position: absolute; top: -8px; left: 50%; transform: translateX(-50%); background: #fff; padding: 0 6px; font-size: 10px; color: #9AA3AF; }
  .qa-body .qa-obj.qa-sel { outline: 2px solid #2563EB; outline-offset: 2px; }
  .qa-body .qa-obj:hover { outline: 1px dashed #93C5FD; outline-offset: 2px; }
  .qa-body .qa-ui { position: absolute; z-index: 3; user-select: none; }
  .qa-body .qa-h-move { left: -12px; top: -12px; width: 22px; height: 22px; border-radius: 11px; background: #2563EB; color: #fff; font: 700 13px/22px Arial; text-align: center; cursor: move; touch-action: none; }
  .qa-body .qa-h-size { right: -7px; bottom: -7px; width: 13px; height: 13px; background: #fff; border: 2px solid #2563EB; border-radius: 3px; cursor: nwse-resize; touch-action: none; }
  .qa-body .qa-tb { outline: 1px dotted #CBD5E1; }
  .qa-body .qa-pageno, .qa-body .qa-pages { background: #EEF2FF; color: #3730A3; border-radius: 3px; padding: 0 3px; }
  .qa-body:focus, .qa-body *:focus { outline: none; }
  .qa-drop-line { position: absolute; height: 3px; background: #2563EB; border-radius: 2px; pointer-events: none; z-index: 4; }
`;

type SignOff = { preparedBy: string; preparedAt: string | null; approvedBy: string | null; approvedAt: string | null };
function signOffHtml(sign: SignOff) {
  return `<table style="width:100%;border-collapse:collapse;margin-top:14pt;font-family:Arial,Helvetica,sans-serif;font-size:9pt;page-break-inside:avoid">
    <tr><th style="border:0.6pt solid #444;background:#E8ECF2;padding:3pt;text-align:left;width:30%"></th><th style="border:0.6pt solid #444;background:#E8ECF2;padding:3pt;text-align:left">Name</th><th style="border:0.6pt solid #444;background:#E8ECF2;padding:3pt;text-align:left;width:24%">Date / time</th><th style="border:0.6pt solid #444;background:#E8ECF2;padding:3pt;text-align:left;width:18%">Signature</th></tr>
    <tr><td style="border:0.6pt solid #444;padding:3pt;font-weight:700">Prepared by (Assistant Engineer)</td><td style="border:0.6pt solid #444;padding:3pt">${esc(sign.preparedBy)}</td><td style="border:0.6pt solid #444;padding:3pt">${esc(sign.preparedAt ? fmtDateTimeY(sign.preparedAt) : '')}</td><td style="border:0.6pt solid #444;padding:3pt;color:#1E40AF;font-style:italic">${sign.preparedAt ? 'Submitted in app' : ''}</td></tr>
    <tr><td style="border:0.6pt solid #444;padding:3pt;font-weight:700">Approved by (Senior Electrical Engineer)</td><td style="border:0.6pt solid #444;padding:3pt">${esc(sign.approvedBy ?? '')}</td><td style="border:0.6pt solid #444;padding:3pt">${esc(sign.approvedAt ? fmtDateTimeY(sign.approvedAt) : '')}</td><td style="border:0.6pt solid #444;padding:3pt;color:#1E40AF;font-style:italic">${sign.approvedAt ? 'Approved in app' : ''}</td></tr>
  </table>`;
}

/** Full printable document: header and footer repeated on every A4 page (table header / footer), DRAFT mark until approved */
export function reportHtml(r: Pick<QaReport, 'code' | 'title' | 'content_html' | 'page_setup' | 'status' | 'version' | 'created_at' | 'decided_at'>, h: HeaderInfo, sign: { preparedBy: string; preparedAt: string | null; approvedBy: string | null; approvedAt: string | null }) {
  const ps = r.page_setup ?? { orientation: 'portrait', margins: 'normal' };
  const m = MARGIN_MM[ps.margins] ?? 18;
  const draft = r.status !== 'approved';
  const signOff = signOffHtml(sign);
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(`${r.code} ${r.title}`)}</title><style>
    @page { size: A4 ${ps.orientation}; margin: ${m}mm; }
    body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.qa-frame { width: 100%; border-collapse: collapse; }
    table.qa-frame > thead > tr > td, table.qa-frame > tfoot > tr > td, table.qa-frame > tbody > tr > td { padding: 0; border: 0; }
    .qa-foot { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #555; border-top: 0.5pt solid #999; padding-top: 3pt; margin-top: 8pt; }
    .qa-body .page-break { page-break-after: always; break-after: page; height: 0; border: 0; }
    .qa-draft { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font: 700 90pt Arial, sans-serif; color: rgba(200, 16, 46, 0.08); transform: rotate(-30deg); z-index: 0; pointer-events: none; }
    ${CONTENT_CSS}
  </style></head><body>
  ${draft ? `<div class="qa-draft">${r.status === 'submitted' ? 'FOR APPROVAL' : 'DRAFT'}</div>` : ''}
  <table class="qa-frame">
    <thead><tr><td>${headerHtml(h)}<div style="height:8pt"></div></td></tr></thead>
    <tfoot><tr><td><div class="qa-foot">${esc(`${r.code} · ${r.title} · version ${r.version}`)}${r.status === 'approved' && sign.approvedBy ? esc(` · approved by ${sign.approvedBy} on ${fmtDateNum(sign.approvedAt)}`) : ' · not approved'} · DIMO Lighting Ops</div></td></tr></tfoot>
    <tbody><tr><td><div class="qa-body">${sanitizeHtml(r.content_html)}</div>${signOff}</td></tr></tbody>
  </table>
  </body></html>`;
}

/**
 * Website: the report laid out page by page before printing – the project header on every page, tables split across
 * pages with their heading row repeated, page breaks kept, and "Page X of Y" in the footer and in page-number fields.
 */
export async function paginatedReportHtml(...args: Parameters<typeof reportHtml>) {
  const [r, h, sign] = args;
  const ps = r.page_setup ?? { orientation: 'portrait', margins: 'normal' };
  const m = MARGIN_MM[ps.margins] ?? 18;
  const land = ps.orientation === 'landscape';
  const pw = land ? 297 : 210;
  const ph = land ? 210 : 297;
  const PX = 96 / 25.4;
  const contentW = (pw - 2 * m) * PX;
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:-30000px;top:0;width:${contentW}px;visibility:hidden;`;
  host.innerHTML = `<style>${CONTENT_CSS}</style><div class="hd">${headerHtml(h)}</div><div class="qa-body">${sanitizeHtml(r.content_html)}${signOffHtml(sign)}</div>`;
  document.body.appendChild(host);
  try {
    await Promise.all([...host.querySelectorAll('img')].map((im) => im.decode().catch(() => undefined)));
    const hdrH = (host.querySelector('.hd') as HTMLElement).offsetHeight + 10;
    const footH = 22;
    const avail = (ph - 2 * m) * PX - hdrH - footH;
    const body = host.querySelector('.qa-body') as HTMLElement;
    const outerH = (el: Element) => {
      const cs = getComputedStyle(el);
      return el.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    };
    const pages: string[][] = [[]];
    let used = 0;
    const newPage = () => {
      if (pages[pages.length - 1].length) pages.push([]);
      used = 0;
    };
    for (const el of [...body.children]) {
      if (el.classList.contains('page-break')) {
        newPage();
        continue;
      }
      const table = el.tagName === 'TABLE' ? (el as HTMLTableElement) : (el.querySelector(':scope > table') as HTMLTableElement | null);
      let hgt = outerH(el);
      if (table && used + hgt > avail && table.rows.length > 2) {
        // split the table over pages, repeating its heading row
        for (let guard = 0; guard < 200; guard++) {
          const rows = [...table.rows];
          const head = rows[0].querySelector('th') ? 1 : 0;
          const extra = outerH(el) - table.getBoundingClientRect().height + (head ? rows[0].getBoundingClientRect().height : 0);
          let acc = extra;
          let cut = head;
          for (let i = head; i < rows.length; i++) {
            const rh = rows[i].getBoundingClientRect().height;
            if (acc + rh > avail - used) break;
            acc += rh;
            cut = i + 1;
          }
          if (cut >= rows.length) {
            pages[pages.length - 1].push(el.outerHTML);
            used += outerH(el);
            break;
          }
          if (cut === head) {
            if (used > 0) {
              newPage();
              continue;
            }
            cut = head + 1; // a single row taller than a page
          }
          const first = el.cloneNode(true) as Element;
          const ft = first.tagName === 'TABLE' ? (first as HTMLTableElement) : (first.querySelector(':scope > table') as HTMLTableElement);
          [...ft.rows].slice(cut).forEach((x) => x.remove());
          pages[pages.length - 1].push(first.outerHTML);
          newPage();
          rows.slice(head, cut).forEach((x) => x.remove());
          hgt = outerH(el);
          if (hgt <= avail) {
            pages[pages.length - 1].push(el.outerHTML);
            used += hgt;
            break;
          }
        }
        continue;
      }
      if (used + hgt > avail && used > 0) newPage();
      pages[pages.length - 1].push(el.outerHTML);
      used += hgt;
    }
    const n = pages.length;
    const draft = r.status !== 'approved';
    const foot = `${esc(`${r.code} · ${r.title} · version ${r.version}`)}${r.status === 'approved' && sign.approvedBy ? esc(` · approved by ${sign.approvedBy} on ${fmtDateNum(sign.approvedAt)}`) : ' · not approved'}`;
    const html = pages
      .map((chunk, i) => {
        const body = chunk
          .join('')
          .replace(/<span class="qa-pageno"[^>]*>[\s\S]*?<\/span>/g, `<span class="qa-pageno">${i + 1}</span>`)
          .replace(/<span class="qa-pages"[^>]*>[\s\S]*?<\/span>/g, `<span class="qa-pages">${n}</span>`);
        return `<div class="qa-page">${draft ? `<div class="qa-draft">${r.status === 'submitted' ? 'FOR APPROVAL' : 'DRAFT'}</div>` : ''}${headerHtml(h)}<div style="height:10px"></div><div class="qa-body">${body}</div><div class="qa-foot"><span>${foot}</span><span style="float:right;font-weight:700">Page ${i + 1} of ${n}</span></div></div>`;
      })
      .join('');
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(`${r.code} ${r.title}`)}</title><style>
      @page { size: A4 ${ps.orientation}; margin: 0; }
      body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .qa-page { width: ${pw}mm; height: ${ph - 0.6}mm; padding: ${m}mm; box-sizing: border-box; position: relative; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }
      .qa-page:last-child { page-break-after: auto; break-after: auto; }
      .qa-foot { position: absolute; left: ${m}mm; right: ${m}mm; bottom: ${Math.max(6, m - 8)}mm; font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #555; border-top: 0.5pt solid #999; padding-top: 3pt; }
      .qa-draft { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font: 700 90pt Arial, sans-serif; color: rgba(200, 16, 46, 0.08); transform: rotate(-30deg); pointer-events: none; }
      .qa-body .page-break { display: none; }
      ${CONTENT_CSS}
    </style></head><body>${html}</body></html>`;
  } finally {
    host.remove();
  }
}

export async function printQaReport(...args: Parameters<typeof reportHtml>) {
  const [r] = args;
  const html = Platform.OS === 'web' ? await paginatedReportHtml(...args) : reportHtml(...args);
  await printHtml(html, { key: 'qa_report', filters: `${r.code} ${r.title}`, title: `${r.code} ${r.title}`, landscape: r.page_setup?.orientation === 'landscape' });
}
