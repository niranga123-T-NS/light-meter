// Smart drawings (testing), round E – reports from the drawings: the progress drawing, the DB chart and test certificate, the
// cable schedule, the containment fill list and the as-built pack. Everything is drawn from the records; the branded report
// shell (logo, watermark, page numbers) is the one every other report uses.
import {
  CABLE_STEPS,
  cableArea,
  cablesIn,
  CONT_STEPS,
  DISC,
  fillPct,
  isCont,
  kindOf,
  LMS_SYSTEMS,
  PART_STEPS,
  PIN_KINDS,
  ptypeOf,
  readingFlags,
  routeMetres,
  routeOf,
  runsIn,
  STATUS_COLOR,
  stepLabel,
  toU,
  WEIGHT,
  type DCircuit,
  type DItem,
  type Disc,
  type DPart,
  type DPin,
  type Drawing,
  type DRoute,
  type DTest,
  type Riser,
  type RiserRun,
} from './drawings';
import { esc, exportExcel, exportPdf, printHtml, reportHtml, type Column } from './export';
import { fmtDate, fmtDateTime, fmtNumber } from './format';
import { rpc, supabase } from './supabase';

type Ins = { id: string; code: string; name: string; serial_no: string | null; calibrated: boolean; cal_expiry: string | null };
export type Pack = {
  project: { id: string; code: string | null; name: string; client_name: string | null };
  drawings: Drawing[];
  uris: Record<string, string | null>;
  items: DItem[];
  routes: DRoute[];
  pins: (DPin & { drawing_id: string })[];
  parts: DPart[];
  circuits: DCircuit[];
  tests: DTest[];
  risers: Riser[];
  runs: RiserRun[];
  subs: { id: string; name: string }[];
  boq: { id: string; item_no: string | null; description: string }[];
  ins: Ins[];
};

/** Everything the reports need for one project (drawings not archived). */
export async function loadPack(exec: string): Promise<Pack> {
  const [pj, dw, it, rt, pt, ci, ts, rs, rr, sb, bq] = await Promise.all([
    supabase.from('exec_projects').select('id, code, name, client_name').eq('id', exec).single(),
    supabase.from('exec_drawings').select('*').eq('exec_project_id', exec).eq('archived', false).order('level_no', { ascending: false, nullsFirst: false }).order('title'),
    supabase.from('exec_drawing_items').select('*').eq('exec_project_id', exec),
    supabase.from('exec_drawing_routes').select('*').eq('exec_project_id', exec),
    supabase.from('exec_drawing_db_parts').select('*').eq('exec_project_id', exec).order('seq'),
    supabase.from('exec_drawing_circuits').select('*').eq('exec_project_id', exec).order('seq'),
    supabase.from('exec_drawing_tests').select('*').eq('exec_project_id', exec).order('seq'),
    supabase.from('exec_drawing_risers').select('*').eq('exec_project_id', exec).order('name'),
    supabase.from('exec_drawing_riser_runs').select('*').eq('exec_project_id', exec).order('from_level'),
    supabase.from('exec_subcontractors').select('id, name').eq('exec_project_id', exec),
    supabase.from('exec_boq_items').select('id, item_no, description').eq('exec_project_id', exec).eq('heading', false),
  ]);
  if (pj.error) throw new Error(pj.error.message);
  const drawings = (dw.data ?? []) as Drawing[];
  const ids = new Set(drawings.map((d) => d.id));
  const [uris, pins, ins] = await Promise.all([
    Promise.all(drawings.map(async (d) => [d.id, (await supabase.storage.from('drawings').createSignedUrl(d.image_path, 3600)).data?.signedUrl ?? null] as const)),
    Promise.all(drawings.map(async (d) => (await rpc<DPin[]>('drawing_pins', { p_drawing: d.id }).catch(() => [] as DPin[])).map((p) => ({ ...p, drawing_id: d.id })))),
    rpc<Ins[]>('drawing_instruments', { p_exec: exec }).catch(() => [] as Ins[]),
  ]);
  return {
    project: pj.data as Pack['project'],
    drawings,
    uris: Object.fromEntries(uris),
    items: ((it.data ?? []) as DItem[]).filter((x) => ids.has(x.drawing_id)),
    routes: ((rt.data ?? []) as DRoute[]).filter((x) => ids.has(x.drawing_id)),
    pins: pins.flat(),
    parts: (pt.data ?? []) as DPart[],
    circuits: (ci.data ?? []) as DCircuit[],
    tests: (ts.data ?? []) as DTest[],
    risers: (rs.data ?? []) as Riser[],
    runs: (rr.data ?? []) as RiserRun[],
    subs: (sb.data ?? []) as Pack['subs'],
    boq: (bq.data ?? []) as Pack['boq'],
    ins,
  };
}

const riserName = (rs?: Riser) => (rs ? (/^riser/i.test(rs.name) ? rs.name : `Riser ${rs.name}`) : 'Riser');
const sheetName = (d: Drawing) => `${d.sheet_no ? `${d.sheet_no} · ` : ''}${d.title}${d.revision ? ` rev ${d.revision}` : ''}`;
const tag = (x: DItem) => `${kindOf(x.kind).code}${x.label ? ` ${x.label}` : ''}`;
const installer = (p: Pack, x: { installer?: string | null; installer_sub?: string | null }) =>
  x.installer === 'dimo' ? 'DIMO' : x.installer === 'sub' ? (p.subs.find((s) => s.id === x.installer_sub)?.name ?? 'Subcontractor') : '';
const boqName = (p: Pack, id: string | null) => {
  const b = p.boq.find((x) => x.id === id);
  return b ? `${b.item_no ?? ''} ${b.description}`.trim() : '';
};
const pct = (list: DItem[]) => (list.length ? Math.round((100 * list.reduce((t, x) => t + (WEIGHT[x.status] ?? 0), 0)) / list.length) : 0);
const tbl = (head: string[], rows: (string | number | null | undefined)[][], right: number[] = []) =>
  `<table><thead><tr>${head.map((h, i) => `<th style="text-align:${right.includes(i) ? 'right' : 'left'}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${right.includes(i) ? 'right' : 'left'}">${esc(c ?? '')}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
const meta = (p: Pack, title: string, who: string, filters: string, landscape = false, paper: 'A4' | 'A3' = 'A4') => ({
  key: 'smart_drawings',
  title,
  filters: `${p.project.code ?? ''} ${p.project.name}${filters ? ` · ${filters}` : ''}`,
  generatedBy: who,
  period: `As at ${fmtDate(new Date().toISOString())}`,
  currencyNote: 'Smart drawings (testing) – figures from the drawings',
  landscape,
  paper,
});
const EXTRA_CSS = `<style>
  .sheet { position: relative; width: 100%; border: 1px solid #ccc; margin: 4px 0 6px; }
  .sheet img { width: 100%; display: block; }
  .sheet svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
  .legend span { display: inline-block; margin-right: 10px; font-size: 9px; }
  .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 5px; margin-right: 3px; vertical-align: -1px; }
  .pb { page-break-before: always; }
  .kv { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; margin: 4px 0 8px; }
  .warn { color: #B00020; font-weight: bold; }
  .sign { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 18px; }
  .sign div { border-top: 1px solid #333; padding-top: 4px; font-size: 9px; }
  h3 { font-size: 11px; margin: 10px 0 3px; }
</style>`;

/** The sheet with its routes and items coloured by stage (or by service), and the open issues pinned. */
export function sheetHtml(p: Pack, d: Drawing, by: 'progress' | 'services' = 'progress', withPins = true) {
  const VH = (1000 * d.height) / d.width;
  const items = p.items.filter((x) => x.drawing_id === d.id), routes = p.routes.filter((x) => x.drawing_id === d.id);
  const P = (pts: number[][]) => pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
  const svg = [
    ...[...routes]
      .sort((a, b) => Number(!isCont(a.kind)) - Number(!isCont(b.kind)))
      .map((r) => {
        const k = routeOf(r.kind), pts = r.pts.map((q) => toU(d, q));
        const col = by === 'services' ? DISC[isCont(r.kind) ? 'cont' : k.d].c : (STATUS_COLOR[r.status] ?? '#9AA0A8');
        return isCont(r.kind)
          ? `<polyline points="${P(pts)}" fill="none" stroke="${col}" stroke-opacity="0.55" stroke-width="${k.w}" ${r.status === 'planned' ? 'stroke-dasharray="7 5"' : ''}/>`
          : `<polyline points="${P(pts)}" fill="none" stroke="${col}" stroke-width="${Math.max(2, k.w)}" ${r.status === 'planned' ? 'stroke-dasharray="4 4"' : ''}/>`;
      }),
    ...items.map((it) => {
      const u = toU(d, [it.x, it.y]), k = kindOf(it.kind), col = by === 'services' ? DISC[k.d].c : (STATUS_COLOR[it.status] ?? '#9AA0A8');
      const txt = k.big && it.label ? it.label.split(' ')[0] : k.code, w = Math.max(14, txt.length * 5.2 + 6);
      return `<rect x="${(u[0] - w / 2).toFixed(1)}" y="${(u[1] - 6).toFixed(1)}" width="${w.toFixed(1)}" height="12" rx="3" fill="${col}" stroke="#fff" stroke-width="1"/><text x="${u[0].toFixed(1)}" y="${(u[1] + 3).toFixed(1)}" font-size="7.5" font-family="Arial" font-weight="bold" fill="#fff" text-anchor="middle">${esc(txt)}</text>`;
    }),
    ...(withPins
      ? p.pins
          .filter((x) => x.drawing_id === d.id && x.open)
          .map((pn) => {
            const u = toU(d, [pn.x, pn.y]), pk = PIN_KINDS[pn.kind] ?? PIN_KINDS.note;
            return `<circle cx="${u[0].toFixed(1)}" cy="${(u[1] - 9).toFixed(1)}" r="8" fill="${pk.c}" stroke="#fff" stroke-width="1.5"/><text x="${u[0].toFixed(1)}" y="${(u[1] - 6).toFixed(1)}" font-size="9" font-family="Arial" font-weight="bold" fill="#fff" text-anchor="middle">${esc(pk.sign)}</text>`;
          })
      : []),
  ].join('');
  const uri = p.uris[d.id];
  return `<div class="sheet" style="aspect-ratio:${d.width}/${d.height}">${uri ? `<img src="${esc(uri)}"/>` : ''}<svg viewBox="0 0 1000 ${VH.toFixed(1)}" preserveAspectRatio="none">${svg}</svg></div>
<div class="legend">${(by === 'progress'
    ? [['planned', 'Planned'], ['first', '1st fix'], ['second', '2nd fix / laid'], ['tested', 'Tested'], ['done', 'Commissioned'], ['failed', 'Failed']].map(([k, t]) => `<span><i style="background:${STATUS_COLOR[k]}"></i>${t}</span>`)
    : (Object.keys(DISC) as Disc[]).map((k) => `<span><i style="background:${DISC[k].c}"></i>${esc(DISC[k].name)}</span>`)
  ).join('')}${withPins ? ' <span>Pins: open issues</span>' : ''}</div>`;
}

function sheetSummary(p: Pack, d: Drawing) {
  const items = p.items.filter((x) => x.drawing_id === d.id), routes = p.routes.filter((x) => x.drawing_id === d.id);
  const discs = [...new Set(items.map((x) => kindOf(x.kind).d))];
  const rows = discs.map((x) => {
    const l = items.filter((i) => kindOf(i.kind).d === x);
    return [DISC[x].name, l.length, l.filter((i) => (WEIGHT[i.status] ?? 0) >= 0.75).length, l.filter((i) => i.status === 'tested' || i.status === 'done').length, l.filter((i) => i.status === 'failed').length, `${pct(l)}%`];
  });
  const cable = routes.filter((r) => !isCont(r.kind)), m = (r: DRoute) => (routeMetres(d, r) ?? 0) * (r.cores ?? 1);
  const laid = cable.reduce((t, r) => t + (m(r) * (r.laid ?? 0)) / 100, 0), total = cable.reduce((t, r) => t + m(r), 0);
  const failed = items.filter((x) => x.status === 'failed'), open = p.pins.filter((x) => x.drawing_id === d.id && x.open);
  return `${tbl(['Service', 'Items', 'Installed', 'Tested', 'Failed', 'Progress'], rows, [1, 2, 3, 4, 5])}
${d.width_m && total ? `<p>Cable on this sheet: ${fmtNumber(laid, 0)} m laid of ${fmtNumber(total, 0)} m.</p>` : ''}
${failed.length ? `<h3>Failed</h3>${tbl(['Item', 'Room', 'Circuit', 'Fault'], failed.map((x) => [tag(x), x.area, x.circuit, x.note]))}` : ''}
${open.length ? `<h3>Open issues</h3>${tbl(['Type', 'Ref', 'Issue', 'Raised'], open.map((x) => [PIN_KINDS[x.kind]?.name ?? x.kind, x.ref_code, x.title, fmtDate(x.raised_at)]))}` : ''}`;
}

/** 1. Progress drawing: each chosen sheet coloured by stage, with its summary, failed items and open issues. */
export async function progressPdf(p: Pack, sheetIds: string[], who: string, label: string) {
  const sheets = p.drawings.filter((d) => sheetIds.includes(d.id));
  const all = p.items.filter((x) => sheetIds.includes(x.drawing_id));
  const body = `${EXTRA_CSS}<div class="kv"><div><b>Sheets:</b> ${sheets.length}</div><div><b>Items:</b> ${all.length} · ${pct(all)}% installed (weighted by stage)</div></div>
${sheets.map((d, i) => `<div class="${i ? 'pb' : ''}"><h2>${esc(sheetName(d))}${d.floor ? ` · ${esc(d.floor)}` : ''}</h2>${sheetHtml(p, d)}${sheetSummary(p, d)}</div>`).join('')}`;
  await printHtml(reportHtml(meta(p, 'Progress drawing', who, label, true, 'A3'), [], [], body), { key: 'smart_drawings_progress', filters: label, title: 'Progress drawing', landscape: true, paper: 'A3' });
}

const insName = (p: Pack, id?: string | null) => {
  const i = p.ins.find((x) => x.id === id);
  return i ? `${i.name} (${i.code}${i.serial_no ? `, s/n ${i.serial_no}` : ''}${i.cal_expiry ? `, calibration to ${fmtDate(i.cal_expiry)}` : ''})` : '';
};

function dbHtml(p: Pack, db: DItem, people: Record<string, { full_name: string } | undefined>) {
  const d = p.drawings.find((x) => x.id === db.drawing_id);
  const parts = p.parts.filter((x) => x.item_id === db.id), circ = p.circuits.filter((x) => x.item_id === db.id);
  const usedIns = [...new Set(circ.map((c) => c.instrument_id).filter(Boolean))] as string[];
  const testers = [...new Set(circ.map((c) => people[c.tested_by ?? '']?.full_name).filter(Boolean))];
  const last = circ.map((c) => c.tested_at).filter(Boolean).sort().pop();
  const r = (c: DCircuit, k: string) => (c.readings?.[k] == null || c.readings?.[k] === '' ? '' : String(c.readings[k]));
  return `<h2>${esc(db.label ?? 'Distribution board')}</h2>
<div class="kv"><div><b>Drawing:</b> ${esc(d ? sheetName(d) : '')}</div><div><b>Location:</b> ${esc([d?.floor, db.area].filter(Boolean).join(' · '))}</div>
<div><b>Board stage:</b> ${esc(stepLabel(db.kind, db.status))}</div><div><b>Installed by:</b> ${esc(installer(p, db) || '—')}</div></div>
<h3>DB chart</h3>
${tbl(['Way', 'Circuit', 'Phase', 'Protective device', 'Cable'], circ.map((c) => [c.ref, c.description, c.phase, c.device, c.cable]))}
<h3>Components</h3>
${tbl(['Component', 'Ref', 'Rating', 'Poles', 'Make / model', 'Qty', 'Checks', 'Stage'], parts.map((x) => {
    const t = ptypeOf(x.ptype);
    return [t.name, x.ref, x.rating, x.poles, x.make, x.qty, `${t.checks.filter(([k]) => x.checks?.[k]).length} of ${t.checks.length}`, PART_STEPS.find((s) => s[0] === x.status)?.[1] ?? x.status];
  }), [5])}
<h3 class="pb">Test certificate – circuits</h3>
${tbl(['Circuit', 'R1+R2 Ω', 'IR MΩ', 'Zs Ω', 'Max Zs Ω', 'RCD ms', 'Polarity', 'Result'], circ.map((c) => [
    c.ref + (c.description ? ` ${c.description}` : ''), r(c, 'r1r2'), r(c, 'ir'), r(c, 'zs'), c.zs_max ?? '', r(c, 'rcd_ms'),
    c.status === 'planned' ? '' : c.readings?.polarity === true ? 'Right' : c.readings?.polarity === false ? 'Wrong' : '',
    (c.status === 'tested' ? 'Pass' : c.status === 'failed' ? `FAIL${c.note ? ` – ${c.note}` : ''}` : 'Not tested') + (c.uncalibrated ? ' (uncalibrated instrument)' : ''),
  ]), [1, 2, 3, 4, 5])}
<div class="kv"><div><b>Instrument(s):</b> ${esc(usedIns.map((i) => insName(p, i)).join('; ') || '—')}</div><div><b>Tested by:</b> ${esc(testers.join(', ') || '—')}${last ? ` · ${esc(fmtDateTime(last))}` : ''}</div></div>
${circ.some((c) => c.uncalibrated) ? '<p class="warn">Some readings were taken with an instrument that was not calibrated at the time.</p>' : ''}
${circ.some((c) => c.status === 'planned') ? `<p class="warn">${circ.filter((c) => c.status === 'planned').length} circuit(s) not tested yet – this certificate is not complete.</p>` : ''}
<div class="sign"><div>Tested by (DIMO)</div><div>Checked by – Assistant Engineer</div><div>Witnessed by – client / consultant</div></div>`;
}

/** 2. DB chart and test certificate – one board or every board of the project. */
export async function dbPdf(p: Pack, dbIds: string[], who: string, people: Record<string, { full_name: string } | undefined>) {
  const dbs = p.items.filter((x) => dbIds.includes(x.id));
  const body = `${EXTRA_CSS}${dbs.map((db, i) => `<div class="${i ? 'pb' : ''}">${dbHtml(p, db, people)}</div>`).join('')}`;
  const label = dbs.length === 1 ? (dbs[0].label ?? 'DB') : `${dbs.length} boards`;
  await printHtml(reportHtml(meta(p, 'DB chart and test certificate', who, label), [], [], body), { key: 'smart_drawings_db', filters: label, title: 'DB chart and test certificate' });
}

// 3. cable schedule
type CableRow = { floor: string; sheet: string; desc: string; type: string; cables: number; len: number | null; total: number | null; laid: number; laidM: number | null; stage: string; inside: string; boq: string; by: string };
export function cableRows(p: Pack): CableRow[] {
  const out: CableRow[] = [];
  for (const d of p.drawings) {
    const routes = p.routes.filter((r) => r.drawing_id === d.id);
    for (const r of routes.filter((x) => !isCont(x.kind))) {
      const m = routeMetres(d, r), n = r.cores ?? 1;
      const ins = runsIn(d, r, routes);
      out.push({
        floor: d.floor ?? '',
        sheet: d.sheet_no ?? d.title,
        desc: r.label ?? '',
        type: routeOf(r.kind).name,
        cables: n,
        len: m == null ? null : Math.round(m * 10) / 10,
        total: m == null ? null : Math.round(m * n),
        laid: r.laid ?? 0,
        laidM: m == null ? null : Math.round((m * n * (r.laid ?? 0)) / 100),
        stage: CABLE_STEPS.find((s) => s[0] === r.status)?.[1] ?? r.status,
        inside: ins.size ? [...ins.entries()].map(([cid, s]) => `${routeOf(routes.find((q) => q.id === cid)?.kind ?? '').name} ${Math.round(s * 100)}%`).join('; ') : 'Outside containment',
        boq: boqName(p, r.boq_item_id),
        by: installer(p, r),
      });
    }
  }
  for (const rr of p.runs.filter((x) => !isCont(x.kind))) {
    const rs = p.risers.find((x) => x.id === rr.riser_id), m = Math.abs(Number(rr.to_level) - Number(rr.from_level)) * Number(rs?.floor_height_m ?? 0), n = rr.cores ?? 1;
    out.push({ floor: riserName(rs), sheet: `${rr.from_level} → ${rr.to_level}`, desc: rr.label ?? '', type: routeOf(rr.kind).name, cables: n, len: m, total: Math.round(m * n), laid: rr.laid, laidM: Math.round((m * n * rr.laid) / 100), stage: CABLE_STEPS.find((s) => s[0] === rr.status)?.[1] ?? rr.status, inside: 'Riser', boq: boqName(p, rr.boq_item_id), by: '' });
  }
  return out;
}
const CABLE_COLS: Column<CableRow>[] = [
  { header: 'Floor / riser', value: (r) => r.floor, width: 16 },
  { header: 'Sheet', value: (r) => r.sheet, width: 12 },
  { header: 'Description', value: (r) => r.desc, width: 30 },
  { header: 'Cable', value: (r) => r.type, width: 22 },
  { header: 'No.', value: (r) => r.cables, align: 'right', width: 6 },
  { header: 'Run m', value: (r) => r.len ?? 'no scale', align: 'right', width: 9 },
  { header: 'Total m', value: (r) => r.total ?? '', align: 'right', width: 9 },
  { header: 'Laid %', value: (r) => r.laid, align: 'right', width: 8 },
  { header: 'Laid m', value: (r) => r.laidM ?? '', align: 'right', width: 9 },
  { header: 'Stage', value: (r) => r.stage, width: 12 },
  { header: 'Runs in', value: (r) => r.inside, width: 26 },
  { header: 'BOQ line', value: (r) => r.boq, width: 26 },
  { header: 'Installed by', value: (r) => r.by, width: 16 },
];
function cableSections(rows: CableRow[]) {
  const types = [...new Set(rows.map((r) => r.type))];
  return types.map((t) => {
    const l = rows.filter((r) => r.type === t);
    return { heading: t, rows: l, totals: { 'Floor / riser': 'Total', 'Total m': fmtNumber(l.reduce((s, r) => s + (r.total ?? 0), 0), 0), 'Laid m': fmtNumber(l.reduce((s, r) => s + (r.laidM ?? 0), 0), 0) } };
  });
}
export async function cablePdf(p: Pack, who: string) {
  await exportPdf(meta(p, 'Cable schedule', who, 'all floors and risers', true), CABLE_COLS, cableSections(cableRows(p)));
}
export async function cableExcel(p: Pack, who: string) {
  await exportExcel(meta(p, 'Cable schedule', who, 'all floors and risers', true), CABLE_COLS, cableSections(cableRows(p)));
}

// 4. containment fill
type FillRow = { floor: string; sheet: string; desc: string; type: string; len: number | null; fill: number; limit: number; cables: string; state: string };
export function fillRows(p: Pack): FillRow[] {
  const out: FillRow[] = [];
  for (const d of p.drawings) {
    const routes = p.routes.filter((r) => r.drawing_id === d.id);
    for (const c of routes.filter((x) => isCont(x.kind))) {
      const k = routeOf(c.kind), f = fillPct(d, c, routes), lim = k.limit ?? 40, m = routeMetres(d, c);
      const inside = cablesIn(d, c, routes);
      out.push({ floor: d.floor ?? '', sheet: d.sheet_no ?? d.title, desc: c.label ?? '', type: k.name, len: m == null ? null : Math.round(m), fill: f, limit: lim, cables: inside.map((x) => `${x.label ?? routeOf(x.kind).name}${(x.cores ?? 1) > 1 ? ` ×${x.cores}` : ''}`).join('; '), state: f > lim ? 'OVER THE LIMIT' : f > lim * 0.8 ? 'Near the limit' : 'OK' });
    }
  }
  for (const rr of p.runs.filter((x) => isCont(x.kind))) {
    const rs = p.risers.find((x) => x.id === rr.riser_id), k = routeOf(rr.kind), lim = k.limit ?? 40;
    const lo = Math.min(rr.from_level, rr.to_level), hi = Math.max(rr.from_level, rr.to_level);
    const inside = p.runs.filter((x) => x.riser_id === rr.riser_id && !isCont(x.kind) && Math.min(x.from_level, x.to_level) < hi && Math.max(x.from_level, x.to_level) > lo);
    const used = inside.reduce((t, x) => t + cableArea(x as unknown as DRoute), 0), f = k.cap ? Math.round((100 * used) / k.cap) : 0;
    out.push({ floor: riserName(rs), sheet: `${rr.from_level} → ${rr.to_level}`, desc: rr.label ?? '', type: k.name, len: Math.abs(hi - lo) * Number(rs?.floor_height_m ?? 0), fill: f, limit: lim, cables: inside.map((x) => `${x.label ?? routeOf(x.kind).name}${(x.cores ?? 1) > 1 ? ` ×${x.cores}` : ''}`).join('; '), state: f > lim ? 'OVER THE LIMIT' : f > lim * 0.8 ? 'Near the limit' : 'OK' });
  }
  return out.sort((a, b) => b.fill / b.limit - a.fill / a.limit);
}
const FILL_COLS: Column<FillRow>[] = [
  { header: 'Floor / riser', value: (r) => r.floor },
  { header: 'Sheet', value: (r) => r.sheet },
  { header: 'Containment', value: (r) => `${r.type}${r.desc ? ` – ${r.desc}` : ''}` },
  { header: 'Length m', value: (r) => r.len ?? 'no scale', align: 'right' },
  { header: 'Fill %', value: (r) => r.fill, align: 'right' },
  { header: 'Limit %', value: (r) => r.limit, align: 'right' },
  { header: 'State', value: (r) => r.state },
  { header: 'Cables in it', value: (r) => r.cables },
];
export async function fillPdf(p: Pack, who: string) {
  const rows = fillRows(p);
  const over = rows.filter((r) => r.state === 'OVER THE LIMIT'), near = rows.filter((r) => r.state === 'Near the limit'), ok = rows.filter((r) => r.state === 'OK');
  await exportPdf(meta(p, 'Containment fill list', who, `${over.length} over the limit · ${near.length} near it`, true), FILL_COLS, [
    ...(over.length ? [{ heading: 'Over the limit – no more cable before a second run or a bigger size', rows: over, colour: '#B00020' }] : []),
    ...(near.length ? [{ heading: 'Near the limit (over 80 % of it)', rows: near, colour: '#B26A00' }] : []),
    { heading: 'Within the limit', rows: ok },
  ]);
}

/** 5. As-built pack: the drawings as installed and every record behind them. */
export async function asBuiltPdf(p: Pack, sheetIds: string[], who: string, label: string, people: Record<string, { full_name: string } | undefined>) {
  const sheets = p.drawings.filter((d) => sheetIds.includes(d.id));
  const items = p.items.filter((x) => sheetIds.includes(x.drawing_id));
  const dbs = items.filter((x) => x.kind === 'db');
  const lms = items.filter((x) => kindOf(x.kind).d === 'lms'), bms = items.filter((x) => kindOf(x.kind).d === 'bms'), out = items.filter((x) => kindOf(x.kind).d === 'out');
  const tests = p.tests.filter((t) => !t.drawing_id || sheetIds.includes(t.drawing_id));
  const closed = p.pins.filter((x) => sheetIds.includes(x.drawing_id) && !x.open);
  const lmsSys = sheets[0] ? (LMS_SYSTEMS[sheets[0].lms] ?? LMS_SYSTEMS.KNX) : LMS_SYSTEMS.KNX;
  const notDone = items.filter((x) => x.status !== 'done' && x.status !== 'tested').length;
  const toc = [
    'Drawings as installed',
    'Installed items register',
    dbs.length ? 'DB charts and test certificates' : null,
    lms.length || tests.some((t) => t.kind === 'scene') ? 'Lighting control – points and scenes' : null,
    bms.length || tests.some((t) => t.kind === 'cne') ? 'BMS – points and cause & effect' : null,
    out.length ? 'Poles and masts' : null,
    p.runs.length ? 'Risers' : null,
    closed.length ? 'Issues closed' : null,
  ].filter(Boolean);
  const body = `${EXTRA_CSS}
<div class="kv"><div><b>Client:</b> ${esc(p.project.client_name ?? '—')}</div><div><b>Scope:</b> ${esc(label)}</div>
<div><b>Sheets:</b> ${sheets.length}</div><div><b>Items:</b> ${items.length}${notDone ? ` – <span class="warn">${notDone} not yet tested / commissioned</span>` : ' – all tested or commissioned'}</div></div>
<h3>Contents</h3><ol>${toc.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
${sheets.map((d) => `<div class="pb"><h2>${esc(sheetName(d))}${d.floor ? ` · ${esc(d.floor)}` : ''}</h2>${sheetHtml(p, d, 'services', false)}</div>`).join('')}
<div class="pb"><h2>Installed items register</h2>
${tbl(['Sheet', 'Item', 'Type', 'Room / area', 'Circuit / address', 'Serial', 'Installed by', 'Stage'], items
    .sort((a, b) => a.drawing_id.localeCompare(b.drawing_id) || a.kind.localeCompare(b.kind) || (a.label ?? '').localeCompare(b.label ?? ''))
    .map((x) => [p.drawings.find((d) => d.id === x.drawing_id)?.sheet_no ?? '', tag(x), kindOf(x.kind).name, x.area, x.circuit, x.serial, installer(p, x), stepLabel(x.kind, x.status)]))}</div>
${dbs.map((db) => `<div class="pb">${dbHtml(p, db, people)}</div>`).join('')}
${lms.length || tests.some((t) => t.kind === 'scene') ? `<div class="pb"><h2>Lighting control – points and scenes</h2>
${tbl(['Device', 'Name', lmsSys.addr, 'Area', 'Stage'], lms.map((x) => [kindOf(x.kind).name, x.label, x.circuit, x.area, stepLabel(x.kind, x.status, sheets[0]?.lms)]))}
<h3>Scenes</h3>${tbl(['Scene', 'Area', 'Recalled by', 'Does', 'Result', 'Witness', 'Tested'], tests.filter((t) => t.kind === 'scene').map((t) => [t.name, t.area, t.cause, t.effect, t.status === 'tested' ? 'Works' : t.status === 'failed' ? `Failed – ${t.result_note ?? ''}` : 'Not tested', t.witness, t.tested_at ? fmtDate(t.tested_at) : '']))}</div>` : ''}
${bms.length || tests.some((t) => t.kind === 'cne') ? `<div class="pb"><h2>BMS – points and cause &amp; effect</h2>
${tbl(['Device', 'Name', 'Controller / point', 'Area', 'Stage'], bms.map((x) => [kindOf(x.kind).name, x.label, x.circuit, x.area, stepLabel(x.kind, x.status)]))}
<h3>Cause &amp; effect</h3>${tbl(['Name', 'Cause', 'Effect', 'Result', 'Witness', 'Tested'], tests.filter((t) => t.kind === 'cne').map((t) => [t.name, t.cause, t.effect, t.status === 'tested' ? 'Works' : t.status === 'failed' ? `Failed – ${t.result_note ?? ''}` : 'Not tested', t.witness, t.tested_at ? fmtDate(t.tested_at) : '']))}</div>` : ''}
${out.length ? `<div class="pb"><h2>Poles and masts</h2>
${tbl(['Chainage', 'Pole / mast', 'Height m', 'Cube 28 d', 'Grade', 'Earth Ω', 'Aiming', 'Stage', 'Flags'], out
    .sort((a, b) => (Number(a.readings?.ch ?? Infinity) || 0) - (Number(b.readings?.ch ?? Infinity) || 0))
    .map((x) => [x.readings?.ch, tag(x), x.readings?.ht, x.readings?.cube28, x.readings?.grade, x.readings?.earth, x.readings?.aim || (x.readings?.tilt ? `${x.readings.tilt}°` : ''), stepLabel(x.kind, x.status), readingFlags(x).join('; ')]), [0, 2, 3, 4, 5])}</div>` : ''}
${p.runs.length ? `<div class="pb"><h2>Risers</h2>${p.risers
    .map((rs) => `<h3>${esc(rs.name)} – floor height ${fmtNumber(Number(rs.floor_height_m), 2)} m</h3>${tbl(['Run', 'Type', 'From → to', 'Length m', 'Cables', 'Stage'], p.runs
      .filter((r) => r.riser_id === rs.id)
      .map((r) => [r.label, routeOf(r.kind).name, `${r.from_level} → ${r.to_level}`, fmtNumber(Math.abs(r.to_level - r.from_level) * Number(rs.floor_height_m), 1), isCont(r.kind) ? '' : (r.cores ?? 1), (isCont(r.kind) ? CONT_STEPS : CABLE_STEPS).find((s) => s[0] === r.status)?.[1] ?? r.status]), [3, 4])}`)
    .join('')}</div>` : ''}
${closed.length ? `<div class="pb"><h2>Issues closed</h2>${tbl(['Type', 'Ref', 'Issue', 'Raised', 'Closed', 'How'], closed.map((x) => [PIN_KINDS[x.kind]?.name ?? x.kind, x.ref_code, x.title, fmtDate(x.raised_at), x.closed_at ? fmtDate(x.closed_at) : '', x.close_note]))}</div>` : ''}
<div class="sign"><div>Prepared by – Assistant Engineer</div><div>Approved by – Senior Electrical Engineer</div><div>Received by – client / consultant</div></div>`;
  await printHtml(reportHtml(meta(p, 'As-built pack', who, label, true, 'A3'), [], [], body), { key: 'smart_drawings_asbuilt', filters: label, title: 'As-built pack', landscape: true, paper: 'A3' });
}
