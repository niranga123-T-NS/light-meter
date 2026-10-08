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
`;
export const EDITOR_CSS = `${CONTENT_CSS}
  .qa-body .page-break { border-top: 1px dashed #9AA3AF; margin: 14px 0; height: 0; position: relative; }
  .qa-body .page-break::after { content: 'Page break'; position: absolute; top: -8px; left: 50%; transform: translateX(-50%); background: #fff; padding: 0 6px; font-size: 10px; color: #9AA3AF; }
  .qa-body img.qa-sel { outline: 2px solid #2563EB; outline-offset: 2px; }
  .qa-body td.qa-cell-sel { background: #EFF6FF; }
  .qa-body:focus { outline: none; }
`;

/** Full printable document: header and footer repeated on every A4 page (table header / footer), DRAFT mark until approved */
export function reportHtml(r: Pick<QaReport, 'code' | 'title' | 'content_html' | 'page_setup' | 'status' | 'version' | 'created_at' | 'decided_at'>, h: HeaderInfo, sign: { preparedBy: string; preparedAt: string | null; approvedBy: string | null; approvedAt: string | null }) {
  const ps = r.page_setup ?? { orientation: 'portrait', margins: 'normal' };
  const m = MARGIN_MM[ps.margins] ?? 18;
  const draft = r.status !== 'approved';
  const signOff = `<table style="width:100%;border-collapse:collapse;margin-top:14pt;font-family:Arial,Helvetica,sans-serif;font-size:9pt;page-break-inside:avoid">
    <tr><th style="border:0.6pt solid #444;background:#E8ECF2;padding:3pt;text-align:left;width:30%"></th><th style="border:0.6pt solid #444;background:#E8ECF2;padding:3pt;text-align:left">Name</th><th style="border:0.6pt solid #444;background:#E8ECF2;padding:3pt;text-align:left;width:24%">Date / time</th><th style="border:0.6pt solid #444;background:#E8ECF2;padding:3pt;text-align:left;width:18%">Signature</th></tr>
    <tr><td style="border:0.6pt solid #444;padding:3pt;font-weight:700">Prepared by (Assistant Engineer)</td><td style="border:0.6pt solid #444;padding:3pt">${esc(sign.preparedBy)}</td><td style="border:0.6pt solid #444;padding:3pt">${esc(sign.preparedAt ? fmtDateTimeY(sign.preparedAt) : '')}</td><td style="border:0.6pt solid #444;padding:3pt;color:#1E40AF;font-style:italic">${sign.preparedAt ? 'Submitted in app' : ''}</td></tr>
    <tr><td style="border:0.6pt solid #444;padding:3pt;font-weight:700">Approved by (Senior Electrical Engineer)</td><td style="border:0.6pt solid #444;padding:3pt">${esc(sign.approvedBy ?? '')}</td><td style="border:0.6pt solid #444;padding:3pt">${esc(sign.approvedAt ? fmtDateTimeY(sign.approvedAt) : '')}</td><td style="border:0.6pt solid #444;padding:3pt;color:#1E40AF;font-style:italic">${sign.approvedAt ? 'Approved in app' : ''}</td></tr>
  </table>`;
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

export async function printQaReport(...args: Parameters<typeof reportHtml>) {
  const [r] = args;
  await printHtml(reportHtml(...args), { key: 'qa_report', filters: `${r.code} ${r.title}`, title: `${r.code} ${r.title}`, landscape: r.page_setup?.orientation === 'landscape' });
}
