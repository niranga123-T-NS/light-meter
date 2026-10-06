import { esc, printHtml, reportHtml, type Column } from './export';
import { fmtDate } from './format';
import { actualPct, dayMs, fromDay, plannedPct, programmeRows, toDay, trackingRow, varText, wbsSummary, type Activity, type Dep, type Programme, type Snapshot, type Wbs } from './programme';

// Programme PDF for meetings and submissions: summary, Gantt (baseline, progress, critical path, links, status date),
// S-curve, tracking table and the sign-off block. Built as HTML + SVG and printed with the branded report frame.

export type ProgrammePdfInput = {
  project: { name: string; code: string | null; client_name: string | null; end_date: string | null };
  pg: Programme;
  wbs: Wbs[];
  acts: Activity[];
  deps: Dep[];
  snaps: Snapshot[];
  people: Record<string, { full_name: string } | undefined>;
  today: string;
  generatedBy: string;
  logoUrl?: string | null;
  parts: { gantt: boolean; scurve: boolean; table: boolean };
  paper: 'A4' | 'A3';
  purpose: string;
};

const RED = '#C8102E';
const BLUE = '#1D4ED8';
const GREEN = '#15803D';
const INK = '#111827';
const MUTED = '#6B7280';
const LINE = '#E5E7EB';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ganttPages(i: ProgrammePdfInput) {
  const rows = programmeRows(i.wbs, i.acts);
  const W = i.paper === 'A3' ? 1480 : 1020;
  const per = i.paper === 'A3' ? 40 : 24;
  const ROW = 19;
  const HEAD = 30;
  const LBL = [52, i.paper === 'A3' ? 300 : 190, 34, 56, 56]; // code, activity, duration, start, finish
  const L = LBL.reduce((a, b) => a + b, 0);
  const dates = i.acts.flatMap((a) => [a.es, a.ef, a.bl_start, a.bl_finish]).filter(Boolean) as string[];
  const first = Math.min(...dates.map(toDay), toDay(i.today)) - 2;
  const last = Math.max(...dates.map(toDay), i.project.end_date ? toDay(i.project.end_date) : 0, toDay(i.today)) + 4;
  const px = (W - L) / (last - first + 1);
  const x = (iso: string) => L + (toDay(iso) - first) * px;
  const pages: string[] = [];
  for (let p0 = 0; p0 < rows.length; p0 += per) {
    const chunk = rows.slice(p0, p0 + per);
    const rowOf = new Map<string, number>();
    chunk.forEach((r, k) => r.kind === 'act' && rowOf.set(r.act.id, k));
    const H = HEAD + chunk.length * ROW + 4;
    const s: string[] = [];
    // header: months and weeks
    for (let d = first; d <= last; d++) {
      const dt = new Date(d * dayMs);
      const xx = L + (d - first) * px;
      if (dt.getUTCDate() === 1 || (d === first && dt.getUTCDate() <= 20)) {
        s.push(`<line x1="${xx}" x2="${xx}" y1="0" y2="${H}" stroke="${LINE}"/>`);
        s.push(`<text x="${xx + 3}" y="11" font-size="10" font-weight="700" fill="${INK}">${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</text>`);
      }
      if (dt.getUTCDay() === 1 && px * 7 >= 16) s.push(`<text x="${xx + 2}" y="${HEAD - 5}" font-size="8" fill="${MUTED}">${dt.getUTCDate()}</text><line x1="${xx}" x2="${xx}" y1="${HEAD - 12}" y2="${H}" stroke="#F1F2F4"/>`);
    }
    const hx = [0, ...LBL.map((_, k) => LBL.slice(0, k + 1).reduce((a, b) => a + b, 0))];
    ['Code', 'Activity', 'Dur', 'Start', 'Finish'].forEach((h, k) => s.push(`<text x="${hx[k] + 3}" y="${HEAD - 5}" font-size="9" font-weight="700" fill="${MUTED}">${h}</text>`));
    s.push(`<line x1="0" x2="${W}" y1="${HEAD}" y2="${HEAD}" stroke="${INK}"/><line x1="${L}" x2="${L}" y1="0" y2="${H}" stroke="${INK}"/>`);
    chunk.forEach((r, k) => {
      const y = HEAD + k * ROW;
      if (r.kind === 'wbs') {
        s.push(`<rect x="0" y="${y}" width="${W}" height="${ROW}" fill="#F3F4F6"/>`);
        s.push(`<text x="${3 + r.depth * 8}" y="${y + 13}" font-size="10" font-weight="700" fill="${INK}">${esc(`${r.wbs.code}  ${r.wbs.name}`)}</text>`);
        const sm = wbsSummary(r.wbs, i.wbs, i.acts);
        if (sm) {
          const x1 = x(sm.start);
          const w = x(sm.finish) + px - x1;
          s.push(`<rect x="${x1}" y="${y + 6}" width="${w}" height="6" fill="${INK}"/>`);
        }
        return;
      }
      const a = r.act;
      const t = trackingRow(a, i.today);
      const crit = a.critical && !a.actual_finish;
      const cols = [a.code, a.name, a.duration ? `${a.duration}d` : '◆', fmtDate(t.start).slice(0, 6), fmtDate(t.finish).slice(0, 6)];
      cols.forEach((c, j) => {
        const max = Math.floor(LBL[j] / 5.2);
        const txt = c.length > max ? `${c.slice(0, max - 1)}…` : c;
        s.push(`<text x="${hx[j] + 3 + (j === 1 ? r.depth * 6 : 0)}" y="${y + 13}" font-size="9" fill="${j === 1 && crit ? RED : INK}">${esc(txt)}</text>`);
      });
      s.push(`<line x1="0" x2="${W}" y1="${y + ROW}" y2="${y + ROW}" stroke="#F3F4F6"/>`);
      if (!a.es || !a.ef) return;
      if (a.bl_start && a.bl_finish) s.push(`<rect x="${x(a.bl_start)}" y="${y + 14}" width="${Math.max(2, x(a.bl_finish) + px - x(a.bl_start))}" height="3" fill="#CBD5E1"/>`);
      const tone = a.actual_finish ? GREEN : crit ? RED : BLUE;
      if (a.duration === 0) {
        const cx = x(a.es);
        s.push(`<path d="M${cx} ${y + 3} l6 6 l-6 6 l-6 -6 z" fill="${tone === BLUE ? INK : tone}"/>`);
        return;
      }
      const x1 = x(a.es);
      const w = Math.max(2, x(a.ef) + px - x1);
      s.push(`<rect x="${x1}" y="${y + 4}" width="${w}" height="9" rx="2" fill="${tone}" fill-opacity="0.28"/>`);
      if (Number(a.pct)) s.push(`<rect x="${x1}" y="${y + 4}" width="${(w * Number(a.pct)) / 100}" height="9" rx="2" fill="${tone}"/>`);
      const lab = [Number(a.pct) ? `${Math.round(Number(a.pct))}%` : '', t.finishVar && t.finishVar > 0 ? `+${t.finishVar}d` : ''].filter(Boolean).join(' ');
      if (lab) s.push(`<text x="${x1 + w + 3}" y="${y + 12}" font-size="8" fill="${t.finishVar && t.finishVar > 0 ? RED : INK}">${lab}</text>`);
    });
    // links within the page
    for (const d of i.deps) {
      const pr = rowOf.get(d.pred_id);
      const sr = rowOf.get(d.succ_id);
      const p = i.acts.find((a) => a.id === d.pred_id);
      const q = i.acts.find((a) => a.id === d.succ_id);
      if (pr == null || sr == null || !p?.es || !p.ef || !q?.es || !q.ef) continue;
      const fromEnd = d.dep_type === 'FS' || d.dep_type === 'FF';
      const toEnd = d.dep_type === 'FF' || d.dep_type === 'SF';
      const x1 = fromEnd ? x(p.ef) + px : x(p.es);
      const x2 = toEnd ? x(q.ef) + px : x(q.es);
      const y1 = HEAD + pr * ROW + 9;
      const y2 = HEAD + sr * ROW + 9;
      const tone = p.critical && q.critical ? RED : '#94A3B8';
      const mid = fromEnd ? x1 + 4 : x1 - 4;
      const dir = toEnd ? -1 : 1;
      s.push(`<path d="M${x1} ${y1} H${mid} V${y2} H${x2 - dir * 3}" stroke="${tone}" stroke-width="0.8" fill="none"/><path d="M${x2} ${y2} l${-dir * 4} -2.5 v5 z" fill="${tone}"/>`);
    }
    if (i.project.end_date) s.push(`<line x1="${x(i.project.end_date) + px}" x2="${x(i.project.end_date) + px}" y1="${HEAD - 8}" y2="${H}" stroke="${INK}" stroke-dasharray="4 3"/>`);
    s.push(`<line x1="${x(i.today)}" x2="${x(i.today)}" y1="${HEAD - 8}" y2="${H}" stroke="${RED}" stroke-width="1.2"/><text x="${x(i.today) + 2}" y="${HEAD - 14}" font-size="8" fill="${RED}">status ${fmtDate(i.today).slice(0, 6)}</text>`);
    pages.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;font-family:Arial">${s.join('')}</svg>`);
  }
  return pages;
}

function scurveSvg(i: ProgrammePdfInput) {
  const bl = i.acts.filter((a) => a.bl_start && a.bl_finish);
  if (!bl.length) return '';
  const W = i.paper === 'A3' ? 1480 : 1020;
  const H = i.paper === 'A3' ? 330 : 260;
  const P = { l: 40, r: 16, t: 14, b: 26 };
  const start = toDay(bl.map((a) => a.bl_start!).sort()[0]);
  const end = Math.max(toDay(bl.map((a) => a.bl_finish!).sort().slice(-1)[0]), toDay(i.today));
  const x = (d: number) => P.l + ((d - start) / Math.max(end - start, 1)) * (W - P.l - P.r);
  const y = (p: number) => P.t + (1 - p / 100) * (H - P.t - P.b);
  const pl: string[] = [];
  const step = Math.max(1, Math.round((end - start) / 80));
  for (let d = start; d <= end; d += step) pl.push(`${pl.length ? 'L' : 'M'}${x(d).toFixed(1)} ${y(plannedPct(i.acts, fromDay(d))).toFixed(1)}`);
  pl.push(`L${x(end).toFixed(1)} ${y(plannedPct(i.acts, fromDay(end))).toFixed(1)}`);
  const pts = [...i.snaps].sort((a, b) => a.snap_date.localeCompare(b.snap_date));
  const ac = pts.map((s, k) => `${k ? 'L' : 'M'}${x(toDay(s.snap_date)).toFixed(1)} ${y(Number(s.pct_actual)).toFixed(1)}`).join(' ');
  const grid = [0, 25, 50, 75, 100].map((p) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(p)}" y2="${y(p)}" stroke="${LINE}"/><text x="${P.l - 5}" y="${y(p) + 3}" font-size="9" fill="${MUTED}" text-anchor="end">${p}%</text>`);
  const months: string[] = [];
  for (let d = start; d <= end; d++) if (new Date(d * dayMs).getUTCDate() === 1 || (d === start && new Date(d * dayMs).getUTCDate() <= 20)) months.push(`<text x="${x(d)}" y="${H - 8}" font-size="9" fill="${MUTED}">${MONTHS[new Date(d * dayMs).getUTCMonth()]}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;font-family:Arial">${grid.join('')}${months.join('')}
    <path d="${pl.join(' ')}" stroke="${MUTED}" stroke-width="2" stroke-dasharray="5 4" fill="none"/>
    ${pts.length > 1 ? `<path d="${ac}" stroke="${BLUE}" stroke-width="2" fill="none"/>` : ''}
    <line x1="${x(toDay(i.today))}" x2="${x(toDay(i.today))}" y1="${P.t}" y2="${H - P.b}" stroke="${RED}"/></svg>
    <div style="font-size:9px;color:${MUTED};margin-top:2px"><span style="display:inline-block;width:16px;border-top:2px dashed ${MUTED};vertical-align:middle"></span> Planned (baseline) &nbsp;
    <span style="display:inline-block;width:16px;border-top:2px solid ${BLUE};vertical-align:middle"></span> Actual &nbsp; <span style="color:${RED}">|</span> status date</div>${weekly(pts)}`;
}

/** Last snapshot of each week (up to 12 weeks): planned vs actual, variance, forecast finish */
function weekly(pts: Snapshot[]) {
  const byWeek = new Map<string, Snapshot>();
  for (const s of pts) {
    const d = toDay(s.snap_date);
    byWeek.set(fromDay(d - ((new Date(d * dayMs).getUTCDay() + 6) % 7)), s);
  }
  const rows = [...byWeek.entries()].slice(-12);
  if (!rows.length) return '';
  return `<table style="margin-top:10px;width:auto"><thead><tr><th>Week of</th><th>Recorded</th><th style="text-align:right">Planned %</th><th style="text-align:right">Actual %</th>
    <th style="text-align:right">Variance</th><th>Forecast finish</th><th style="text-align:right">Critical open</th></tr></thead><tbody>${rows
      .map(([w, s]) => {
        const v = Number(s.pct_actual) - Number(s.pct_planned);
        return `<tr><td>${esc(fmtDate(w))}</td><td>${esc(fmtDate(s.snap_date))}</td><td style="text-align:right">${Number(s.pct_planned).toFixed(0)}%</td>
          <td style="text-align:right">${Number(s.pct_actual).toFixed(0)}%</td><td style="text-align:right;color:${v < 0 ? RED : INK}">${v > 0 ? '+' : ''}${v.toFixed(0)}%</td>
          <td>${esc(fmtDate(s.forecast_finish))}</td><td style="text-align:right">${s.critical_open}</td></tr>`;
      })
      .join('')}</tbody></table>`;
}

type TRow = { a: Activity; wbs: string };

export async function exportProgrammePdf(i: ProgrammePdfInput) {
  const planned = plannedPct(i.acts, i.today);
  const actual = actualPct(i.acts);
  const late = i.pg.forecast_finish && i.project.end_date ? toDay(i.pg.forecast_finish) - toDay(i.project.end_date) : null;
  const crit = i.acts.filter((a) => a.critical && !a.actual_finish).length;
  const behind = i.acts.filter((a) => a.bl_start && !a.actual_start && a.bl_start < i.today).length;
  const name = (id: string | null) => (id ? i.people[id]?.full_name ?? '' : '');
  const summary = `
  <table style="margin-bottom:10px"><tbody>
    <tr><td><b>Project</b></td><td>${esc(`${i.project.code ?? ''} ${i.project.name}`)}</td><td><b>Client</b></td><td>${esc(i.project.client_name ?? '—')}</td></tr>
    <tr><td><b>Programme</b></td><td>${i.pg.version ? `Baseline ${i.pg.version} approved ${esc(fmtDate(i.pg.decided_at))} by ${esc(name(i.pg.decided_by))}` : 'Draft – not yet approved'}${i.pg.status === 'draft' && i.pg.version ? ' · revision in progress' : ''}</td>
        <td><b>Status date</b></td><td>${esc(fmtDate(i.today))}</td></tr>
    <tr><td><b>Start</b></td><td>${esc(fmtDate(i.pg.start_date))}</td><td><b>Contract finish</b></td><td>${esc(fmtDate(i.project.end_date))}</td></tr>
    <tr><td><b>Baseline finish</b></td><td>${esc(fmtDate(i.pg.baseline_finish))}</td><td><b>Forecast finish</b></td>
        <td style="color:${late && late > 0 ? RED : INK};font-weight:700">${esc(fmtDate(i.pg.forecast_finish))}${late != null ? ` (${late > 0 ? `${late} days late` : `${-late} days to spare`})` : ''}</td></tr>
    <tr><td><b>Progress</b></td><td>Actual ${actual.toFixed(0)}% · planned ${planned.toFixed(0)}%${planned ? ` · SPI ${(actual / planned).toFixed(2)}` : ''}</td>
        <td><b>Critical / late</b></td><td>${crit} critical activities open · ${behind} late to start</td></tr>
  </tbody></table>`;
  const legend = `<div style="font-size:9px;color:${MUTED};margin:4px 0 8px">
    <span style="display:inline-block;width:14px;height:8px;background:${RED}"></span> critical &nbsp;
    <span style="display:inline-block;width:14px;height:8px;background:${BLUE}"></span> has float &nbsp;
    <span style="display:inline-block;width:14px;height:8px;background:${GREEN}"></span> finished &nbsp; solid part = % complete &nbsp;
    <span style="display:inline-block;width:14px;height:3px;background:#CBD5E1;vertical-align:middle"></span> approved baseline &nbsp; ◆ milestone &nbsp;
    <span style="color:${RED}">|</span> status date &nbsp; ┆ contract finish &nbsp; +Nd = finish later than baseline</div>`;
  const gantt = i.parts.gantt
    ? `<h2 style="background:#222;color:#fff">Programme – Gantt chart</h2>${legend}${ganttPages(i)
        .map((svg, k) => `<div style="${k ? 'page-break-before:always;' : ''}">${svg}</div>`)
        .join('')}`
    : '';
  const scurve = i.parts.scurve && i.pg.version ? `<div style="page-break-before:always"><h2 style="background:#222;color:#fff">Progress S-curve</h2>${scurveSvg(i)}</div>` : '';
  const sign = `<div style="page-break-inside:avoid;margin-top:18px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;font-size:10px">
    <div>Prepared by<br/><br/>……………………………………<br/>Senior Electrical Engineer${i.pg.submitted_by ? ` – ${esc(name(i.pg.submitted_by))}` : ''}</div>
    <div>Approved by<br/><br/>……………………………………<br/>SM Projects${i.pg.decided_by && i.pg.version ? ` – ${esc(name(i.pg.decided_by))}` : ''}</div>
    <div>Received / accepted by (client / consultant)<br/><br/>……………………………………<br/>Name, signature and date</div></div>`;
  const cols: Column<TRow>[] = [
    { header: 'Code', value: (r) => r.a.code },
    { header: 'Activity', value: (r) => r.a.name },
    { header: 'Responsible', value: (r) => name(r.a.responsible_id) },
    { header: 'Dur (d)', value: (r) => r.a.duration, align: 'right' },
    { header: 'BL start', value: (r) => fmtDate(r.a.bl_start) },
    { header: 'BL finish', value: (r) => fmtDate(r.a.bl_finish) },
    { header: 'Start (act/fcst)', value: (r) => fmtDate(trackingRow(r.a, i.today).start) },
    { header: 'Finish (act/fcst)', value: (r) => fmtDate(trackingRow(r.a, i.today).finish) },
    { header: 'Finish var', value: (r) => varText(trackingRow(r.a, i.today).finishVar), align: 'right' },
    { header: 'Float', value: (r) => (r.a.actual_finish ? '' : r.a.total_float ?? ''), align: 'right' },
    { header: '%', value: (r) => `${Math.round(Number(r.a.pct))}%`, align: 'right' },
    { header: 'Status', value: (r) => trackingRow(r.a, i.today).status },
  ];
  const tops = programmeRows(i.wbs, []).filter((r) => r.kind === 'wbs' && r.depth === 0);
  const sections = i.parts.table
    ? tops.map((t) => {
        const w = t.kind === 'wbs' ? t.wbs : null;
        const rows = programmeRows(i.wbs, i.acts).filter((r) => r.kind === 'act');
        // activities under this top-level element (any depth)
        const under = new Set<string>([w!.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const x of i.wbs) {
            if (x.parent_id && under.has(x.parent_id) && !under.has(x.id)) {
              under.add(x.id);
              grew = true;
            }
          }
        }
        return { heading: `${w!.code}  ${w!.name}`, rows: rows.filter((r) => r.kind === 'act' && under.has(r.act.wbs_id)).map((r) => ({ a: (r as { act: Activity }).act, wbs: w!.code })) };
      })
    : [];
  const extra = `${summary}${gantt}${scurve}${i.parts.table ? `<div style="page-break-before:always"><h2 style="background:#222;color:#fff;margin-bottom:0">Tracking – baseline against actual / forecast</h2></div>` : ''}`;
  const title = `Programme – ${i.project.name}`;
  const html = reportHtml(
    {
      key: 'exec_programme',
      title,
      filters: `${i.purpose} · status date ${fmtDate(i.today)}`,
      period: `Status date ${fmtDate(i.today)}`,
      currencyNote: 'Programme – no money values',
      generatedBy: i.generatedBy,
      landscape: true,
      logoUrl: i.logoUrl,
      paper: i.paper,
    },
    cols,
    sections,
    extra,
  ).replace('</body>', `${sign}</body>`);
  await printHtml(html, { key: 'exec_programme', filters: i.purpose, title, landscape: true, paper: i.paper });
}
