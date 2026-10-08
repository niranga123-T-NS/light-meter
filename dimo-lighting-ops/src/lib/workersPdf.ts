import { DIMO_LOGO_DATA_URI } from './brandLogoData';
import { projectNo } from './execution';
import { esc, printHtml } from './export';
import { fmtDate } from './format';
import { supabase } from './supabase';
import type { Attachment } from './types';
import { idLabel, type Worker } from './workers';

/** Worker list for site security, the main contractor or police registration – optionally with both sides of each ID. */
export async function printWorkerList(
  project: { code: string | null; wbs_no?: string | null; name: string; site_address: string | null },
  workers: Worker[],
  o: { photos: boolean; inductedOn: Record<string, string>; by: string; police?: (w: Worker) => string },
) {
  let photos: Record<string, { front?: string; back?: string }> = {};
  if (o.photos && workers.length) {
    const { data } = await supabase.from('attachments').select('*').eq('entity_type', 'exec_worker').in('entity_id', workers.map((w) => w.id)).in('kind', ['id_front', 'id_back']).is('archived_at', null).order('uploaded_at', { ascending: false });
    const atts = (data ?? []) as Attachment[];
    const latest = new Map<string, Attachment>();
    for (const a of atts) if (!latest.has(`${a.entity_id}:${a.kind}`)) latest.set(`${a.entity_id}:${a.kind}`, a);
    const signed = await Promise.all(
      [...latest.values()].map(async (a) => {
        const { data: s } = await supabase.storage.from('files').createSignedUrl(a.storage_path, 600);
        return [a, s?.signedUrl ?? ''] as const;
      }),
    );
    photos = {};
    for (const [a, url] of signed) {
      const p = (photos[a.entity_id] ??= {});
      if (a.kind === 'id_front') p.front = url;
      else p.back = url;
    }
  }
  const rows = workers
    .map(
      (w, i) => `<tr><td class="c">${i + 1}</td><td><b>${esc(w.full_name)}</b><br/><span class="s">${esc(w.trade ?? '')}</span></td>
      <td>${esc(idLabel(w))}<br/><b>${esc(w.id_no)}</b></td><td>${esc(w.address)}</td><td>${esc(w.police_station)}</td><td>${esc(w.company)}</td>
      <td>${esc(w.mobile ?? '')}</td><td>${esc(o.inductedOn[w.id] ? fmtDate(o.inductedOn[w.id]) : '')}</td>${o.police ? `<td>${esc(o.police(w))}</td>` : ''}</tr>
      ${o.photos ? `<tr class="ph"><td></td><td colspan="${o.police ? 8 : 7}">${photos[w.id]?.front ? `<img src="${esc(photos[w.id].front)}"/>` : '<span class="s">no front photo</span>'} ${photos[w.id]?.back ? `<img src="${esc(photos[w.id].back)}"/>` : '<span class="s">no back photo</span>'}</td></tr>` : ''}`,
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"/><style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #111; }
    header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #C8102E; padding-bottom: 6px; margin-bottom: 8px; }
    h1 { font-size: 14pt; margin: 0; } .sub { color: #555; font-size: 9pt; }
    table { border-collapse: collapse; width: 100%; } td, th { border: 0.6pt solid #444; padding: 3pt 4pt; vertical-align: top; }
    th { background: #E8ECF2; text-align: left; } .c { text-align: center; } .s { color: #555; font-size: 8pt; }
    tr.ph img { height: 120px; margin-right: 8px; border: 0.5pt solid #999; } tr { page-break-inside: avoid; }
    .foot { margin-top: 8px; font-size: 8pt; color: #555; }
  </style></head><body>
  <header><img src="${DIMO_LOGO_DATA_URI}" style="height:40px"/><div><h1>Site workers register</h1>
  <div class="sub">Project ${esc(`${projectNo(project)} ${project.name}`)}${project.site_address ? ` · ${esc(project.site_address)}` : ''} · ${workers.length} workers · ${esc(fmtDate(new Date().toISOString()))}</div></div></header>
  <table><tr><th class="c">#</th><th>Name / trade</th><th>ID</th><th>Address</th><th>Nearest police station</th><th>Company</th><th>Mobile</th><th>Inducted</th>${o.police ? '<th>Police report</th>' : ''}</tr>${rows}</table>
  <div class="foot">Confidential – personal data. Prepared by ${esc(o.by)}. For site security, main contractor and police registration only.</div>
  </body></html>`;
  await printHtml(html, { key: 'site_workers', filters: project.name, title: 'Site workers register', landscape: true });
}
