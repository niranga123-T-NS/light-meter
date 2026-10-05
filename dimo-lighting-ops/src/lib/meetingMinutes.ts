import { esc } from './export';
import { fmtDate, fmtDateTime } from './format';
import { isTeamKind, kindLabel } from './meetingActions';

// Minutes of a published meeting (sales, estimation or design) as a printable A4 page:
// attendance, the general notes and actions, then each person's discussion and actions.

export type MinutesAction = {
  action: string;
  kind: string;
  status: 'open' | 'done';
  owner: string;
  assignee: string | null;
  due_date: string | null;
  subject: string | null; // project / customer
  done_note: string | null;
};
export type MinutesPerson = { name: string; summary: string | null; note: string; actions: MinutesAction[] };
export type MinutesInput = {
  title: string; // e.g. "Sales meeting"
  date: string;
  time: string; // "09:00 – 11:00"
  host: string;
  startedAt: string | null;
  publishedAt: string | null;
  figuresAt: string | null;
  attendance: { name: string; role: string; status: string; at: string | null; note: string | null }[];
  notes: string | null;
  general: MinutesAction[];
  people: MinutesPerson[];
  generatedBy: string;
  logoUrl: string | null;
};

const para = (t: string | null | undefined) => (t?.trim() ? `<p>${esc(t).replace(/\n/g, '<br/>')}</p>` : '<p class="none">No notes</p>');

function actions(rows: MinutesAction[]) {
  if (!rows.length) return '';
  return `<table><thead><tr><th style="width:24px">#</th><th>Action</th><th style="width:150px">By</th><th style="width:70px">Due</th><th style="width:50px">Status</th></tr></thead><tbody>
${rows
  .map(
    (a, i) => `<tr><td>${i + 1}</td><td>${a.kind !== 'task' ? `<b>${esc(kindLabel(a.kind))}:</b> ` : ''}${esc(a.action)}${
      a.subject ? `<div class="sub">${esc(a.subject)}</div>` : ''
    }${a.status === 'done' && a.done_note ? `<div class="sub">Done: ${esc(a.done_note)}</div>` : ''}</td><td>${esc(a.owner)}${
      isTeamKind(a.kind) ? `<div class="sub">${a.assignee ? `→ ${esc(a.assignee)}` : 'to appoint'}</div>` : ''
    }</td><td>${a.due_date ? esc(fmtDate(a.due_date)) : '—'}</td><td>${a.status === 'done' ? 'Done' : 'Open'}</td></tr>`,
  )
  .join('')}</tbody></table>`;
}

export function minutesHtml(m: MinutesInput) {
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo' });
  const logo = m.logoUrl
    ? `<img src="${esc(m.logoUrl)}" style="height:36px;width:auto;object-fit:contain" />`
    : `<div style="font:800 26px/1 Arial;color:#C8102E;letter-spacing:1px">DIMO</div>`;
  const present = m.attendance.filter((a) => a.status === 'Present').length;
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { size: A4 portrait; margin: 16mm 14mm 16mm 14mm;
    @bottom-left { content: "Confidential – for internal use · DIMO Lighting Operations System"; font: 8px Arial; color: #666; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8px Arial; color: #666; } }
  body { font: 10.5px Arial, Helvetica, sans-serif; color: #111; }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #C8102E; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 17px; margin: 0; } .sub { color: #555; font-size: 9.5px; margin-top: 1px; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; background: #F7F7F7; padding: 8px; margin-bottom: 10px; }
  h2 { font-size: 12px; background: #222; color: #fff; padding: 4px 6px; margin: 16px 0 6px; page-break-after: avoid; }
  h3 { font-size: 11px; margin: 8px 0 3px; color: #C8102E; page-break-after: avoid; }
  p { margin: 2px 0 6px; line-height: 1.4; } p.none { color: #888; font-style: italic; }
  .person { page-break-inside: avoid; border-bottom: 1px solid #DDD; padding-bottom: 8px; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
  thead { display: table-header-group; } tr { page-break-inside: avoid; }
  th { background: #EEE; text-align: left; padding: 3px 4px; font-size: 9.5px; } td { padding: 3px 4px; border-bottom: 1px solid #E3E3E3; vertical-align: top; }
  .wm { position: fixed; top: 45%; left: 5%; width: 90%; text-align: center; transform: rotate(-30deg);
        font: bold 30px Arial; color: rgba(200,16,46,0.06); z-index: 0; pointer-events: none; }
</style></head><body>
<div class="wm">${esc(m.generatedBy)} · ${esc(now)}</div>
<header>${logo}<div><h1>Minutes – ${esc(m.title)}</h1><div class="sub">Lighting Solutions · ${esc(fmtDate(m.date))} · ${esc(m.time)}</div></div></header>
<div class="info">
  <div><b>Chaired by:</b> ${esc(m.host)}</div><div><b>Attendance:</b> ${present} of ${m.attendance.length} present</div>
  <div><b>Started:</b> ${m.startedAt ? esc(fmtDateTime(m.startedAt)) : '—'}</div><div><b>Published:</b> ${m.publishedAt ? esc(fmtDateTime(m.publishedAt)) : '—'}</div>
  <div><b>Figures as at:</b> ${m.figuresAt ? esc(fmtDateTime(m.figuresAt)) : '—'}</div><div><b>Downloaded by:</b> ${esc(m.generatedBy)} · ${esc(now)}</div>
</div>
<h2>Attendance</h2>
<table><thead><tr><th>Name</th><th>Role</th><th>Attendance</th><th>Note</th></tr></thead><tbody>
${m.attendance
  .map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.role)}</td><td>${esc(a.status)}${a.at ? `<div class="sub">${esc(fmtDateTime(a.at))}</div>` : ''}</td><td>${esc(a.note ?? '')}</td></tr>`)
  .join('') || '<tr><td colspan="4">Nobody invited</td></tr>'}
</tbody></table>
<h2>Meeting notes and general actions</h2>
${para(m.notes)}
${actions(m.general)}
<h2>Discussion by person</h2>
${m.people
  .map(
    (p) => `<div class="person"><h3>${esc(p.name)}</h3>${p.summary ? `<div class="sub">${esc(p.summary)}</div>` : ''}${para(p.note)}${actions(p.actions)}</div>`,
  )
  .join('')}
</body></html>`;
}
