import { esc, printHtml } from './export';
import { fmtDate, fmtDateTime } from './format';
import type { HseEquipment, HseForm, HseRecord, Induction } from './hse';
import { DIMO_LOGO_DATA_URI } from './brandLogoData';

// HSE forms printed as on the issued DIMO paper forms: document number and issue box, the same sections and the
// sign-off block, filled with the names, dates and times recorded in the app.

type Ctx = { project: { code: string | null; name: string; client_name?: string | null }; name: (id: string | null) => string; logoUrl?: string | null };

const CSS = `
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #111; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 0.6pt solid #333; padding: 3pt 4pt; vertical-align: top; }
  th { background: #E8ECF2; font-weight: 700; text-align: left; }
  .head td { vertical-align: middle; }
  .t { text-align: center; font-weight: 700; font-size: 12pt; }
  .sys { text-align: center; font-weight: 700; font-size: 10pt; }
  .c { text-align: center; }
  .k { width: 22%; font-weight: 700; background: #F4F6F9; }
  .gap { height: 8pt; border: 0; }
  .tick { font-weight: 700; font-size: 11pt; }
  .no { color: #C8102E; font-weight: 700; }
  .small { font-size: 8pt; color: #444; }
  h3 { font-size: 10pt; margin: 8pt 0 3pt; }
`;

function head(f: HseForm, c: Ctx, sub = 'OCCUPATIONAL HEALTH & SAFETY MANAGEMENT SYSTEM') {
  const logo = `<img src="${DIMO_LOGO_DATA_URI}" alt="DIMO" style="height:36pt;width:auto" />`;
  const kind = f.kind === 'permit' ? 'PERMIT TO WORK' : f.kind === 'checklist' || f.kind === 'kit' ? 'CHECKLIST' : '';
  return `<table class="head"><tr><td rowspan="3" style="width:20%" class="c">${logo}</td><td class="sys">${esc(sub)}</td>
    <td style="width:26%">Document Number:<br/><b>${esc(f.doc_no)}</b></td></tr>
    <tr><td class="t">${esc(kind)}</td><td>Issue: <b>${esc(f.issue)}</b></td></tr>
    <tr><td class="t">${esc(f.title)}</td><td>Issue Date: <b>${esc(fmtDate(f.issue_date))}</b></td></tr></table>`;
}

const yn = (v?: string) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v === 'na' ? 'N/A' : '');
const mark = (on: boolean) => `<span class="tick">${on ? '✓' : ''}</span>`;

function signBlock(rows: [string, string | null, string | null][]) {
  return `<table style="margin-top:8pt"><tr><th style="width:30%">Checked by</th><th>Name</th><th style="width:22%">Date / time</th><th style="width:18%">Signature</th></tr>
    ${rows.map(([who, name, at]) => `<tr><td>${esc(who)}</td><td>${esc(name ?? '')}</td><td>${esc(at ? fmtDateTime(at) : '')}</td><td class="small">${name ? 'Signed in app' : ''}</td></tr>`).join('')}</table>`;
}

function checklistHtml(f: HseForm, r: HseRecord, e: HseEquipment | null, c: Ctx) {
  const h = r.header ?? {};
  const info = `<table style="margin-top:6pt">
    <tr><td class="k">Project</td><td>${esc(`${c.project.code ?? ''} ${c.project.name}`)}</td><td class="k">Date of Inspection</td><td>${esc(fmtDateTime(r.created_at))}</td></tr>
    <tr><td class="k">Contractor's Name</td><td>${esc(String(h.contractor ?? e?.contractor ?? ''))}</td><td class="k">Frequency</td><td>${e ? `Every ${e.frequency_days} days` : ''}</td></tr>
    <tr><td class="k">Date of first deployment</td><td>${esc(fmtDate(e?.first_deployed))}</td><td class="k">Checked by</td><td>${esc(c.name(r.created_by))}</td></tr>
    <tr><td class="k">Type</td><td>${esc(e?.name ?? '')}</td><td class="k">${esc(f.id_label ?? 'Serial No')}</td><td>${esc(e?.serial_no ?? '')}</td></tr>
    ${h.trip_value_tested ? `<tr><td class="k">ELCB trip-value test</td><td colspan="3">${esc(fmtDate(String(h.trip_value_tested)))}</td></tr>` : ''}</table>`;
  let body: string;
  if (f.kind === 'kit') {
    body = `<table style="margin-top:6pt"><tr><th class="c" style="width:5%">S/N</th><th>Description / item</th><th class="c">Available qty</th><th class="c">Required qty</th><th class="c">Manuf. date</th><th class="c">Expiry date</th><th>Purpose of use</th><th>Remarks</th></tr>
      ${f.items.map((it) => { const a = r.answers[it.no] ?? {}; return `<tr><td class="c">${it.no}</td><td>${esc(it.text)}</td><td class="c">${esc(String(a.avail ?? ''))}</td><td class="c">${esc(it.req ?? '')}</td><td class="c">${esc(fmtDate(a.mfg))}</td><td class="c">${esc(fmtDate(a.exp))}</td><td class="small">${esc(it.purpose ?? '')}</td><td>${esc(a.r ?? '')}</td></tr>`; }).join('')}</table>`;
  } else {
    body = `<table style="margin-top:6pt"><tr><th class="c" style="width:5%">S/N</th><th>Inspection points</th><th class="c" style="width:6%">Yes</th><th class="c" style="width:6%">No</th><th class="c" style="width:6%">N/A</th><th style="width:24%">Remarks</th></tr>
      ${f.items.map((it) => { const a = r.answers[it.no] ?? {}; return `<tr><td class="c">${it.no}</td><td>${esc(it.text)}</td><td class="c">${mark(a.a === 'yes')}</td><td class="c ${a.a === 'no' ? 'no' : ''}">${a.a === 'no' ? '✗' : ''}</td><td class="c">${mark(a.a === 'na')}</td><td>${esc(a.r ?? '')}</td></tr>`; }).join('')}</table>`;
  }
  const overall = `<table style="margin-top:6pt">
    <tr><td class="k">Overall Observation</td><td>Accepted: <b>${r.accepted ? 'Yes' : 'No'}</b></td></tr>
    <tr><td class="k">Removal of Equipment/Machine (If not acceptable)</td><td>${r.accepted ? '' : `Date: ${esc(fmtDate(r.created_at))} – removed from use`}</td></tr>
    <tr><td class="k">If Corrective/Preventive action taken to rectify</td><td>${r.corrective_note ? `Date: ${esc(fmtDate(r.corrective_date))} – ${esc(r.corrective_note)}` : ''}</td></tr></table>`;
  return head(f, c) + info + body + overall +
    signBlock([["Contractor's Supervisor", r.sup_by ? c.name(r.sup_by) : null, r.sup_at], ['EHS Officer', r.ehs_by ? c.name(r.ehs_by) : null, r.ehs_at], ['Site In charge/Manager', r.mgr_by ? c.name(r.mgr_by) : null, r.mgr_at]]);
}

function permitHtml(f: HseForm, r: HseRecord, e: HseEquipment | null, c: Ctx) {
  const h = r.header ?? {};
  const extra = (f.extra.header ?? []).map((x) => `<tr><td class="k">${esc(x.label)}</td><td colspan="3">${esc(String(h[x.key] ?? ''))}</td></tr>`).join('');
  const info = `<table style="margin-top:6pt">
    <tr><td class="k">Project Name</td><td>${esc(`${c.project.code ?? ''} ${c.project.name}`)}</td><td class="k">Permit Number</td><td><b>${esc(r.code)}</b></td></tr>
    <tr><td class="k">Location</td><td>${esc(String(h.location ?? ''))}</td><td class="k">Date of Permit Applied for</td><td>${esc(fmtDateTime(r.created_at))}</td></tr>
    <tr><td class="k">Permit Requesting Company</td><td>${esc(String(h.company ?? ''))}</td><td class="k">Work Shift</td><td>${esc(h.shift === 'night' ? 'Night' : 'Day')}</td></tr>${extra}</table>
    <h3>SECTION – A &nbsp; Work Details</h3><table>
    <tr><td class="k">Work Location</td><td colspan="3">${esc(String(h.location ?? ''))}</td></tr>
    <tr><td class="k">Description of the Work</td><td colspan="3">${esc(String(h.description ?? ''))}</td></tr>
    <tr><td class="k">Starting Time</td><td>${esc(fmtDateTime(r.starts_at))}</td><td class="k">Finishing Time</td><td>${esc(fmtDateTime(r.ends_at))}</td></tr>
    <tr><td class="k">In charge (Foreman/Supervisor)</td><td>${esc(String(h.in_charge ?? ''))}</td><td class="k">Mob No</td><td>${esc(String(h.mobile ?? ''))}</td></tr>
    ${e ? `<tr><td class="k">Equipment</td><td colspan="3">${esc(e.name)} ${esc(e.serial_no ?? '')} – checklist in date</td></tr>` : ''}</table>`;
  const half = Math.ceil(f.items.length / 2);
  const cell = (i: number) => { const it = f.items[i]; if (!it) return '<td></td><td></td><td></td>'; return `<td class="c">${it.no}</td><td>${esc(it.text)}</td><td class="c"><b>${yn(r.answers[it.no]?.a)}</b></td>`; };
  let controls = `<h3>SECTION – B &nbsp; Control Measures</h3><table>${Array.from({ length: half }, (_, i) => `<tr>${cell(i)}${cell(i + half)}</tr>`).join('')}</table>`;
  for (const g of f.extra.groups ?? []) {
    controls += `<table style="margin-top:4pt"><tr><th colspan="2">${esc(g.no)} &nbsp; ${esc(g.title)}</th></tr>${g.items.map((t, i) => `<tr><td>${esc(t)}</td><td class="c" style="width:14%"><b>${yn(r.answers[`${g.no}.${i + 1}`]?.a)}</b></td></tr>`).join('')}</table>`;
  }
  if (h.explain) controls += `<table style="margin-top:4pt"><tr><td class="k">If "YES" explain</td><td>${esc(String(h.explain))}</td></tr></table>`;
  if (f.extra.readings?.length) controls += `<table style="margin-top:4pt"><tr>${f.extra.readings.map((x) => `<td class="k">${esc(x.label)}</td><td>${esc(h.readings?.[x.key] ?? '')}</td>`).join('')}</tr></table>`;
  const sign = `<h3>SECTION: C &nbsp; Permit Requested and Checked by (Engineer/Technical Officer or Supervisor)</h3>
    <p class="small">I request a permit for the above mentioned work at the specified above location. I have personally inspected the workplace and ensured that all the precautions mentioned above have been complied with requirements. Workers have been briefed prior to work.</p>
    <table><tr><td class="k">Name</td><td>${esc(c.name(r.created_by))}</td><td class="k">Time</td><td>${esc(fmtDateTime(r.created_at))}</td></tr></table>
    <h3>Permit Checked and Approved by (HSE Engineer/HSE Officer or appointed person)</h3>
    <table><tr><td class="k">Name</td><td>${esc(r.ehs_by && r.status !== 'rejected' ? c.name(r.ehs_by) : '')}</td><td class="k">Time</td><td>${esc(r.ehs_by && r.status !== 'rejected' ? fmtDateTime(r.ehs_at) : '')}</td></tr>
    <tr><td class="k">Comments</td><td colspan="3">${esc(r.ehs_note ?? '')}</td></tr></table>
    <h3>SECTION: D &nbsp; Closing of the Permit (HSE Department)</h3>
    <p class="small">I am confident that all necessary safety precautions in relation to hazards identified with this task have been taken.</p>
    <table><tr><td class="k">Name</td><td>${esc(r.closed_by ? c.name(r.closed_by) : '')}</td><td class="k">Time</td><td>${esc(fmtDateTime(r.closed_at))}</td></tr>
    ${r.close_note ? `<tr><td class="k">Note</td><td colspan="3">${esc(r.close_note)}</td></tr>` : ''}</table>
    <p class="small">Note: Permit should be handover to DIMO HSE Officer, after completion of work on respective date.</p>`;
  return head(f, c, 'DIMO PLC') + info + controls + sign;
}

function tbtHtml(f: HseForm, r: HseRecord, c: Ctx, permitCode: string | null) {
  const h = r.header ?? {};
  const ps = r.participants ?? [];
  const half = Math.max(8, Math.ceil(ps.length / 2));
  const pc = (i: number) => (ps[i] ? `<td class="c">${i + 1}</td><td>${esc(ps[i].name)}</td><td>${esc(ps[i].position ?? '')}</td><td class="small">${ps[i].name ? 'Present' : ''}</td>` : `<td class="c">${i + 1}</td><td></td><td></td><td></td>`);
  return head(f, c, 'DIMO PLC') + `<table style="margin-top:6pt">
    <tr><td class="k">Date</td><td>${esc(fmtDate(r.starts_at ?? r.created_at))}</td><td class="k">Time</td><td>${esc(fmtDateTime(r.starts_at ?? r.created_at).split(', ')[1] ?? '')}</td></tr>
    <tr><td class="k">Project</td><td>${esc(`${c.project.code ?? ''} ${c.project.name}`)}</td><td class="k">TBT Number</td><td><b>${esc(r.code)}</b></td></tr>
    <tr><td class="k">Location</td><td>${esc(String(h.location ?? ''))}</td><td class="k">Permit Details</td><td>${esc(permitCode ?? String(h.permit_details ?? ''))}</td></tr>
    <tr><td class="k">TBT Conducted By</td><td>${esc(c.name(r.created_by))}</td><td class="k">Work Shift</td><td>${h.shift === 'night' ? 'Night' : 'Day'}</td></tr></table>
    <h3>SECTION – A &nbsp; Activity/Work Program</h3><table><tr><td style="height:40pt">${esc(String(h.activity ?? '')).replace(/\n/g, '<br/>')}</td></tr></table>
    <h3>SECTION – B &nbsp; Safety Issues (Hazards &amp; Risks)</h3><table><tr><td style="height:40pt">${esc(String(h.hazards ?? '')).replace(/\n/g, '<br/>')}</td></tr></table>
    <h3>SECTION – C &nbsp; Control Measures (✓)</h3><table><tr>${f.items.map((it) => `<td>${esc(it.text)} ${mark(r.answers[it.no]?.a === 'yes')}</td>`).join('')}</tr>
    <tr><td colspan="${f.items.length}">If any other: ${esc(String(h.other ?? ''))}</td></tr></table>
    <h3>SECTION – D &nbsp; Participants</h3><table><tr><th class="c">S/N</th><th>Name</th><th>Position</th><th>Signature</th><th class="c">S/N</th><th>Name</th><th>Position</th><th>Signature</th></tr>
    ${Array.from({ length: half }, (_, i) => `<tr>${pc(i)}${pc(i + half)}</tr>`).join('')}</table>
    <table style="margin-top:8pt"><tr><td class="k">EHS Officer</td><td>${esc(r.ehs_by ? c.name(r.ehs_by) : '')}</td><td>${esc(fmtDateTime(r.ehs_at))}</td></tr>
    <tr><td class="k">Site Manager</td><td>${esc(r.mgr_by ? c.name(r.mgr_by) : '')}</td><td>${esc(fmtDateTime(r.mgr_at))}</td></tr></table>
    <p class="small">Note: Copy of TBT should be handover to DIMO HSE Officer, after completion of work on respective date.</p>`;
}

function trainingHtml(f: HseForm, r: HseRecord, c: Ctx) {
  const h = r.header ?? {};
  const t = (v: string | null) => (v ? fmtDateTime(v).split(', ')[1] ?? '' : '');
  return head(f, c) + `<table style="margin-top:6pt">
    <tr><td class="k">Project</td><td>${esc(`${c.project.code ?? ''} ${c.project.name}`)}</td><td class="k">Location</td><td>${esc(String(h.location ?? ''))}</td></tr>
    <tr><td class="k">Contractor</td><td>${esc(String(h.contractor ?? ''))}</td><td class="k">Date</td><td>${esc(fmtDate(r.starts_at))} · ${t(r.starts_at)} to ${t(r.ends_at)}</td></tr>
    <tr><td class="k">Title</td><td>${esc(String(h.title ?? ''))}</td><td class="k">Total man hours</td><td><b>${esc(String(h.man_hours ?? ''))}</b></td></tr></table>
    <table style="margin-top:6pt"><tr><th class="c">S/N</th><th>Name of participant</th><th>Designation</th><th>Company</th><th>Contact No</th><th>Signature</th></tr>
    ${(r.participants ?? []).map((p, i) => `<tr><td class="c">${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.position ?? '')}</td><td>${esc(p.company ?? '')}</td><td>${esc(p.contact ?? '')}</td><td class="small">Present</td></tr>`).join('')}</table>
    <table style="margin-top:8pt"><tr><td class="k">Conducted by</td><td>${esc(c.name(r.created_by))}</td><td class="k">Designation</td><td>${esc(String(h.designation ?? ''))}</td></tr></table>`;
}

export async function printHseRecord(f: HseForm, r: HseRecord, e: HseEquipment | null, c: Ctx, permitCode: string | null = null) {
  const body = f.kind === 'permit' ? permitHtml(f, r, e, c) : f.kind === 'tbt' ? tbtHtml(f, r, c, permitCode) : f.kind === 'training' ? trainingHtml(f, r, c) : checklistHtml(f, r, e, c);
  const html = `<!doctype html><html><head><meta charset="utf-8"/><style>${CSS}</style></head><body>${body}</body></html>`;
  await printHtml(html, { key: 'hse_form', filters: `${f.doc_no} ${r.code}`, title: `${f.doc_no} ${r.code}` });
}

export async function printInductionRegister(f: HseForm, rows: Induction[], c: Ctx, location: string) {
  const body = head(f, c) + `<table style="margin-top:6pt"><tr><td class="k">PROJECT</td><td>${esc(`${c.project.code ?? ''} ${c.project.name}`)}</td></tr><tr><td class="k">LOCATION</td><td>${esc(location)}</td></tr></table>
    <table style="margin-top:6pt"><tr><th class="c">S/N</th><th>Date</th><th>Name of participant</th><th>NIC number</th><th>Company</th><th>Signature</th><th>Remarks</th><th>Instructor</th></tr>
    ${rows.map((x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(fmtDate(x.inducted_on))}</td><td>${esc(x.name)}</td><td>${esc(x.nic)}</td><td>${esc(x.company ?? '')}</td><td class="small">Inducted</td><td>${esc(x.remarks ?? '')}</td><td>${esc(c.name(x.instructor_id))}</td></tr>`).join('')}</table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"/><style>${CSS}</style></head><body>${body}</body></html>`;
  await printHtml(html, { key: 'hse_induction', filters: c.project.name, title: 'HSE induction register', landscape: true });
}
