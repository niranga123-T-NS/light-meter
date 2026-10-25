// Charts for the supplier-quote reports, drawn as SVG (screen and PDF alike): the price walk (every offer by date), the dumbbell
// (first offer → latest), the rank race (who was lowest at each round), the waterfall (Pre Bid value → final price) and the
// lollipop (a % for each package or competitor around zero). Labels sit on the marks, so no legend has to be looked up.

export type Drawn = { w: number; h: number; svg: string };
export const SERIES = ['#1D4ED8', '#0F766E', '#B45309', '#7C3AED', '#BE185D', '#0891B2', '#65A30D', '#C2410C'];
const INK = '#15171A', MUTED = '#6E747C', GRID = '#ECEEF0', GOOD = '#1A7F4B', BAD = '#B42318', BASE = '#6E747C', TOTAL = '#1D4ED8';
const F = 'font-family="Arial, Helvetica, sans-serif"';
const x = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sg = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} %`;
const short = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const txt = (px: number, py: number, s: string, o: { size?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; bold?: boolean } = {}) =>
  `<text x="${px.toFixed(1)}" y="${py.toFixed(1)}" font-size="${o.size ?? 11}" fill="${o.fill ?? MUTED}" text-anchor="${o.anchor ?? 'start'}"${o.bold ? ' font-weight="700"' : ''} ${F}>${x(s)}</text>`;

/** Round, readable value ticks between lo and hi */
function ticks(lo: number, hi: number, n = 5) {
  const raw = (hi - lo) / Math.max(1, n - 1), mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

/** The whole SVG for a drawn chart, scaled to a width (keeps its proportions) */
export const svgOf = (d: Drawn, width?: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.w} ${d.h}" width="${width ?? d.w}" height="${((width ?? d.w) * d.h) / d.w}" style="width:100%;height:auto;display:block">${d.svg}</svg>`;

// ---------------------------------------------------------------- price walk: step line per supplier over the real dates
export type WalkSeries = { name: string; color?: string; pts: { date: string; v: number }[] };
export function priceWalk(series: WalkSeries[], unit = 'M'): Drawn {
  const W = 760, H = 300, L = 54, R = 170, T = 16, B = 30;
  const all = series.flatMap((s) => s.pts);
  if (!all.length) return { w: W, h: 60, svg: txt(10, 30, 'No prices yet') };
  const day = (s: string) => Date.parse(s.slice(0, 10)) / 864e5;
  const d0 = Math.min(...all.map((p) => day(p.date))) - 3, d1 = Math.max(...all.map((p) => day(p.date))) + 6;
  const vs = all.map((p) => p.v), pad = (Math.max(...vs) - Math.min(...vs)) * 0.12 || Math.max(...vs) * 0.05 || 1;
  const tk = ticks(Math.min(...vs) - pad, Math.max(...vs) + pad);
  const lo = tk[0], hi = tk[tk.length - 1];
  const px = (s: string) => L + ((day(s) - d0) / (d1 - d0 || 1)) * (W - L - R), py = (v: number) => T + ((hi - v) / (hi - lo || 1)) * (H - T - B);
  let g = '';
  for (const t of tk) g += `<line x1="${L}" x2="${W - R}" y1="${py(t)}" y2="${py(t)}" stroke="${GRID}"/>` + txt(L - 6, py(t) + 4, fmt(t), { size: 10, anchor: 'end' });
  // month marks
  const first = new Date(d0 * 864e5), months: string[] = [];
  for (let k = 0; k < 24; k++) { const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + k + 1, 1)); if (d.getTime() / 864e5 > d1) break; months.push(d.toISOString().slice(0, 10)); }
  const every = Math.max(1, Math.ceil(months.length / 8));
  months.forEach((m, i) => { if (i % every) return; g += `<line x1="${px(m)}" x2="${px(m)}" y1="${T}" y2="${H - B}" stroke="${GRID}"/>` + txt(px(m), H - B + 14, `${MON[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`, { size: 10, anchor: 'middle' }); });
  const lastOf = (s: WalkSeries) => s.pts[s.pts.length - 1].v;
  const low = Math.min(...series.filter((s) => s.pts.length).map(lastOf));
  g += `<line x1="${L}" x2="${W - R}" y1="${py(low)}" y2="${py(low)}" stroke="${GOOD}" stroke-dasharray="4 3"/>` + txt(L + 4, py(low) + 13, `lowest now ${fmt(low)} ${unit}`, { size: 10, fill: GOOD });
  const endX = W - R;
  const labels: { y: number; s: WalkSeries; c: string }[] = [];
  series.forEach((s, i) => {
    if (!s.pts.length) return;
    const c = s.color ?? SERIES[i % SERIES.length];
    const pts = [...s.pts].sort((a, b) => a.date.localeCompare(b.date));
    let d = '';
    pts.forEach((p, k) => { d += k ? ` H${px(p.date).toFixed(1)} V${py(p.v).toFixed(1)}` : `M${px(p.date).toFixed(1)},${py(p.v).toFixed(1)}`; });
    d += ` H${endX}`;
    g += `<path d="${d}" fill="none" stroke="${c}" stroke-width="2.4"/>`;
    for (const p of pts) g += `<circle cx="${px(p.date).toFixed(1)}" cy="${py(p.v).toFixed(1)}" r="3.6" fill="#fff" stroke="${c}" stroke-width="2"/>`;
    labels.push({ y: py(pts[pts.length - 1].v), s: { ...s, pts }, c });
  });
  labels.sort((a, b) => a.y - b.y).forEach((l, i, a) => { if (i && l.y - a[i - 1].y < 26) l.y = a[i - 1].y + 26; });
  for (const l of labels) g += txt(endX + 8, l.y + 4, `${fmt(l.s.pts[l.s.pts.length - 1].v)} ${unit}`, { size: 11, fill: l.c, bold: true }) + txt(endX + 8, l.y + 16, short(l.s.name, 24), { size: 9.5 });
  return { w: W, h: Math.max(H, (labels[labels.length - 1]?.y ?? 0) + 24), svg: g };
}

// ---------------------------------------------------------------- dumbbell: first offer (hollow) → latest (solid), lowest on top
export type DumbRow = { name: string; sub?: string; a: number; b: number; color?: string };
export function dumbbell(rows: DumbRow[], unit = 'M'): Drawn {
  const W = 760, L = 210, R = 90, T = 18, row = 46, B = 26;
  const H = T + rows.length * row + B;
  if (!rows.length) return { w: W, h: 60, svg: txt(10, 30, 'No prices yet') };
  const vs = rows.flatMap((r) => [r.a, r.b]), pad = (Math.max(...vs) - Math.min(...vs)) * 0.1 || Math.max(...vs) * 0.05 || 1;
  const tk = ticks(Math.min(...vs) - pad, Math.max(...vs) + pad), lo = tk[0], hi = tk[tk.length - 1];
  const px = (v: number) => L + ((v - lo) / (hi - lo || 1)) * (W - L - R);
  let g = '';
  for (const t of tk) g += `<line x1="${px(t)}" x2="${px(t)}" y1="${T - 6}" y2="${H - B}" stroke="${GRID}"/>` + txt(px(t), H - 8, `${fmt(t)} ${unit}`, { size: 10, anchor: 'middle' });
  const sorted = [...rows].sort((a, b) => a.b - b.b), low = sorted[0].b;
  sorted.forEach((r, i) => {
    const y = T + 14 + i * row, c = r.color ?? SERIES[rows.indexOf(r) % SERIES.length], d = r.a ? ((r.b - r.a) / r.a) * 100 : 0;
    g += txt(L - 12, y - 1, short(r.name, 30), { size: 11, fill: INK, anchor: 'end', bold: true }) + (r.sub ? txt(L - 12, y + 12, short(r.sub, 34), { size: 9.5, anchor: 'end' }) : '');
    g += `<line x1="${px(r.a)}" x2="${px(r.b)}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="3.5" opacity=".35"/>`;
    g += `<circle cx="${px(r.a)}" cy="${y}" r="6" fill="#fff" stroke="${c}" stroke-width="2"/><circle cx="${px(r.b)}" cy="${y}" r="6.5" fill="${c}"/>`;
    if (Math.abs(px(r.a) - px(r.b)) > 34) g += txt(px(r.a), y - 10, fmt(r.a), { size: 9.5, anchor: 'middle' });
    g += txt(px(r.b), y - 10, fmt(r.b), { size: 10, fill: c, anchor: 'middle', bold: true });
    g += txt(W - R + 12, y + 4, r.a === r.b ? 'one offer' : sg(d), { size: 11, fill: d < 0 ? GOOD : d > 0 ? BAD : MUTED, bold: r.a !== r.b });
    if (r.b === low && rows.length > 1) g += txt(px(r.b), y + 19, 'LOWEST', { size: 9, fill: GOOD, anchor: 'middle', bold: true });
  });
  return { w: W, h: H, svg: g };
}

// ---------------------------------------------------------------- rank race: rank at each round (1 = lowest); lines cross when a supplier overtakes
export type BumpRow = { name: string; color?: string; vals: (number | null)[] };
export function rankRace(steps: string[], rows: BumpRow[], unit = 'M'): Drawn {
  const W = 760, L = 50, R = 230, T = 22, B = 30, gap = 34;
  const H = T + Math.max(1, rows.length - 1) * gap + B + 10;
  if (rows.length < 2 || steps.length < 2) return { w: W, h: 60, svg: txt(10, 30, 'Needs two suppliers and a revision') };
  const px = (k: number) => L + (k / (steps.length - 1)) * (W - L - R), py = (r: number) => T + r * gap;
  // a supplier keeps its last price in later rounds
  const val = (r: BumpRow, k: number) => { for (let j = k; j >= 0; j--) if (r.vals[j] != null) return r.vals[j] as number; return null; };
  const rank = (k: number) => rows.filter((r) => val(r, k) != null).sort((a, b) => (val(a, k) as number) - (val(b, k) as number));
  let g = '';
  steps.forEach((s, k) => { g += txt(px(k), H - 8, s, { size: 10, anchor: 'middle' }); });
  rows.forEach((r, i) => {
    const c = r.color ?? SERIES[i % SERIES.length];
    const pts = steps.map((_, k) => { const at = rank(k).indexOf(r); return at < 0 ? null : [px(k), py(at), at + 1] as const; }).filter((p): p is readonly [number, number, number] => !!p);
    if (!pts.length) return;
    g += `<polyline points="${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="3"/>`;
    for (const p of pts) g += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="9" fill="${c}"/>` + txt(p[0], p[1] + 3.5, String(p[2]), { size: 9.5, fill: '#fff', anchor: 'middle', bold: true });
    const e = pts[pts.length - 1], v = val(r, steps.length - 1);
    g += txt(e[0] + 16, e[1] + 4, `${short(r.name, 26)}${v != null ? ` · ${fmt(v)} ${unit}` : ''}`, { size: 11, fill: c, bold: true });
  });
  return { w: W, h: H, svg: g };
}

// ---------------------------------------------------------------- waterfall: base → steps up / down → total
export type WaterStep = { label: string; v: number; kind: 'base' | 'down' | 'up' | 'total' };
export function waterfall(steps: WaterStep[], unit = 'M'): Drawn {
  const W = 760, H = 300, L = 50, R = 16, T = 22, B = 44;
  let run = 0;
  const bars = steps.map((s) => { if (s.kind === 'base' || s.kind === 'total') { run = s.v; return { s, a: 0, b: s.v }; } const a = run; run += s.v; return { s, a, b: run }; });
  // the axis starts near the smallest level so that steps of a few % stay visible (noted under the chart)
  const lv = bars.flatMap((b) => (b.s.kind === 'base' || b.s.kind === 'total' ? [b.b] : [b.a, b.b])), mx = Math.max(...lv), mn = Math.min(...lv);
  const hi = ticks(mx - mn < mx * 0.3 ? Math.max(0, mn - (mx - mn) * 1.5) : 0, mx * 1.04);
  const top = hi[hi.length - 1], bot = hi[0], py = (v: number) => T + ((top - v) / (top - bot || 1)) * (H - T - B);
  bars.forEach((b) => { if (b.s.kind === 'base' || b.s.kind === 'total') b.a = bot; });
  const bw = Math.min(110, (W - L - R) / steps.length - 24), slot = (W - L - R) / steps.length;
  let g = '';
  for (const t of hi) g += `<line x1="${L}" x2="${W - R}" y1="${py(t)}" y2="${py(t)}" stroke="${GRID}"/>` + txt(L - 6, py(t) + 4, fmt(t), { size: 10, anchor: 'end' });
  bars.forEach(({ s, a, b }, i) => {
    const x0 = L + i * slot + (slot - bw) / 2, c = s.kind === 'base' ? BASE : s.kind === 'total' ? TOTAL : s.v < 0 ? GOOD : BAD;
    const y0 = py(Math.max(a, b)), h = Math.max(2, Math.abs(py(a) - py(b)));
    g += `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${c}"/>`;
    if (i < bars.length - 1) g += `<line x1="${(x0 + bw).toFixed(1)}" x2="${(x0 + slot).toFixed(1)}" y1="${py(b)}" y2="${py(b)}" stroke="${MUTED}" stroke-dasharray="2 2"/>`;
    const label = s.kind === 'base' || s.kind === 'total' ? `${fmt(s.v)} ${unit}` : `${s.v > 0 ? '+' : ''}${fmt(s.v)} ${unit}`;
    g += txt(x0 + bw / 2, y0 - 6, label, { size: 11, fill: c, anchor: 'middle', bold: true });
    g += txt(x0 + bw / 2, H - B + 16, short(s.label, 22), { size: 10, fill: INK, anchor: 'middle' });
  });
  if (bot > 0) g += txt(L, H - 6, `Axis starts at ${fmt(bot)} ${unit} so the steps are visible`, { size: 9.5 });
  return { w: W, h: H, svg: g };
}

/** Pre Bid value → negotiated to the lowest → lowest not chosen → Post Bid chosen, for packages with a Pre Bid value (LKR M) */
export function savingSteps(rows: { basis: number; low: number; now: number }[]): WaterStep[] {
  const m = (v: number) => Math.round(v / 1e4) / 100;
  const basis = m(rows.reduce((a, r) => a + r.basis, 0)), low = m(rows.reduce((a, r) => a + r.low, 0)), now = m(rows.reduce((a, r) => a + r.now, 0));
  return [
    { label: 'Pre Bid value', v: basis, kind: 'base' },
    { label: low <= basis ? 'Negotiated down' : 'Lowest above Pre Bid', v: Math.round((low - basis) * 100) / 100, kind: low <= basis ? 'down' : 'up' },
    ...(now - low > 0.005 ? [{ label: 'Lowest not chosen', v: Math.round((now - low) * 100) / 100, kind: 'up' as const }] : []),
    { label: 'Post Bid chosen', v: now, kind: 'total' },
  ];
}

// ---------------------------------------------------------------- lollipop: a % for each row around zero (below zero = good by default)
export type LolliRow = { name: string; sub?: string; v: number };
export function lollipop(rows: LolliRow[], o: { goodBelow?: boolean } = {}): Drawn {
  const W = 760, L = 220, R = 80, T = 16, row = 38, B = 26;
  const H = T + rows.length * row + B;
  if (!rows.length) return { w: W, h: 60, svg: txt(10, 30, 'Nothing to show yet') };
  const goodBelow = o.goodBelow ?? true;
  const tk = ticks(Math.min(0, ...rows.map((r) => r.v)) - 2, Math.max(0, ...rows.map((r) => r.v)) + 2), lo = tk[0], hi = tk[tk.length - 1];
  const px = (v: number) => L + ((v - lo) / (hi - lo || 1)) * (W - L - R);
  let g = '';
  for (const t of tk) g += `<line x1="${px(t)}" x2="${px(t)}" y1="${T}" y2="${H - B}" stroke="${t === 0 ? MUTED : GRID}"/>` + txt(px(t), H - 8, `${fmt(t)} %`, { size: 10, anchor: 'middle' });
  rows.forEach((r, i) => {
    const y = T + 16 + i * row, good = goodBelow ? r.v < 0 : r.v > 0, c = r.v === 0 ? MUTED : good ? GOOD : BAD;
    g += txt(L - 12, y - 1, short(r.name, 30), { size: 11, fill: INK, anchor: 'end', bold: true }) + (r.sub ? txt(L - 12, y + 12, short(r.sub, 34), { size: 9.5, anchor: 'end' }) : '');
    g += `<line x1="${px(0)}" x2="${px(r.v)}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="3"/><circle cx="${px(r.v)}" cy="${y}" r="6" fill="${c}"/>`;
    g += txt(r.v < 0 ? px(r.v) - 10 : px(r.v) + 10, y + 4, sg(r.v), { size: 10.5, fill: c, anchor: r.v < 0 ? 'end' : 'start', bold: true });
  });
  return { w: W, h: H, svg: g };
}
