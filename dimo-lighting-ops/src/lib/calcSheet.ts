import { DIMO_LOGO_DATA_URI } from './brandLogoData';
import { contours } from 'd3-contour';
import { bbox, FITTING_TYPES, inside, type CalcResult, type FittingInput, type Pt, type RoomInput } from './lightcalc';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export type Palette = 'rainbow' | 'heat' | 'grey';
export type Scale = { mode: 'auto' | 'custom'; min?: number | null; max?: number | null; palette: Palette };
export const PALETTES: { value: Palette; label: string }[] = [
  { value: 'rainbow', label: 'Rainbow (blue → red)' },
  { value: 'heat', label: 'Heat (dark → yellow)' },
  { value: 'grey', label: 'Grey' },
];
const STOPS: Record<Palette, [number, number, number][]> = {
  rainbow: [[30, 60, 200], [0, 170, 230], [40, 190, 90], [250, 220, 40], [240, 120, 30], [210, 30, 40]],
  heat: [[20, 20, 40], [120, 20, 80], [220, 60, 40], [250, 160, 30], [255, 240, 120]],
  grey: [[40, 40, 40], [245, 245, 245]],
};
/** Colour for a position 0–1 on the chosen palette */
export function colourAt(t: number, pal: Palette) {
  const st = STOPS[pal];
  const x = Math.min(Math.max(t, 0), 1) * (st.length - 1);
  const i = Math.min(Math.floor(x), st.length - 2);
  const f = x - i;
  const c = st[i].map((v, k) => Math.round(v + (st[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
/** Nice round lux steps for the contour lines between min and max */
export function niceLevels(min: number, max: number, want = 8) {
  const span = Math.max(max - min, 1);
  const raw = span / want;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => span / m <= want) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) if (v > min) out.push(Math.round(v * 100) / 100);
  return out;
}
/** Range of the scale: the room's own min–max, or the range chosen */
export function scaleRange(poly: Pt[], r: CalcResult, sc: Scale) {
  const vals: number[] = [];
  const f = r.field;
  for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) if (inside({ x: f.x0 + i * f.dx, y: f.y0 + j * f.dy }, poly)) vals.push(f.v[j * f.nx + i]);
  const lo = vals.length ? Math.min(...vals) : r.emin;
  const hi = vals.length ? Math.max(...vals) : r.emax;
  if (sc.mode === 'custom' && sc.min != null && sc.max != null && sc.max > sc.min) return { min: sc.min, max: sc.max };
  return { min: Math.floor(lo), max: Math.ceil(hi) };
}

type Ring = number[][];
/** Filled colour bands and contour lines (isolux) from the field, in metres */
function contourLayers(r: CalcResult, min: number, max: number, pal: Palette) {
  const f = r.field;
  const bands = 32;
  const th = Array.from({ length: bands }, (_, i) => min + ((max - min) * i) / bands);
  const gen = contours().size([f.nx, f.ny]);
  // d3 places value i at x = i + 0.5 – back to metres
  const toM = (pt: number[]) => [f.x0 + (pt[0] - 0.5) * f.dx, f.y0 + (pt[1] - 0.5) * f.dy];
  const clamp = f.v.map((v) => Math.min(Math.max(v, min - 1e-6), max + 1e-6));
  const filled = gen.thresholds(th)(clamp).map((g, i) => ({ colour: colourAt((i + 0.5) / bands, pal), rings: (g.coordinates as Ring[][]).flatMap((poly) => poly.map((ring) => ring.map(toM))) }));
  const levels = niceLevels(min, max);
  const lines = gen.thresholds(levels)(f.v).map((g) => ({ value: g.value, rings: (g.coordinates as Ring[][]).flatMap((poly) => poly.map((ring) => ring.map(toM))) }));
  return { filled, lines, levels };
}

/** The room from above: pseudo-colour bands from min to max, labelled isolux lines and the fittings – one SVG for the screen and the PDF */
export function planSvg(poly: Pt[], positions: Pt[], r: CalcResult | null, sc: Scale, widthPx = 640) {
  const b = bbox(poly);
  const L = b.x1 - b.x0 || 1;
  const W = b.y1 - b.y0 || 1;
  const pad = 34;
  const sx = (widthPx - 2 * pad) / L;
  const hPx = W * sx + 2 * pad;
  const X = (x: number) => pad + (x - b.x0) * sx;
  const Y = (y: number) => pad + (b.y1 - y) * sx; // y up
  const path = (rings: number[][][]) => rings.map((ring) => `M${ring.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('L')}Z`).join('');
  let layers = '';
  let range = { min: 0, max: 0 };
  if (r) {
    range = scaleRange(poly, r, sc);
    const c = contourLayers(r, range.min, range.max, sc.palette);
    layers =
      c.filled.map((l) => `<path d="${path(l.rings)}" fill="${l.colour}" fill-rule="evenodd" stroke="none"/>`).join('') +
      c.lines
        .map((l) => {
          const longest = l.rings.reduce((a, x) => (x.length > a.length ? x : a), [] as number[][]);
          const lp = longest[Math.floor(longest.length / 3)];
          const label = lp ? `<text x="${X(lp[0]).toFixed(1)}" y="${Y(lp[1]).toFixed(1)}" font-size="10" font-family="Arial" fill="#111" stroke="#fff" stroke-width="2.5" paint-order="stroke" text-anchor="middle" dy="3">${Math.round(l.value)}</text>` : '';
          return `<path d="${path(l.rings)}" fill="none" stroke="#111" stroke-width="0.8" stroke-opacity="0.75"/>${label}`;
        })
        .join('');
  }
  const outlinePts = poly.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const dots = positions.map((p) => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4.5" fill="#fff" stroke="#111" stroke-width="1.6"/>`).join('');
  const ugr = (r?.ugr.points ?? [])
    .filter((q) => q.ugr != null)
    .map((q) => `<g><circle cx="${X(q.x).toFixed(1)}" cy="${Y(q.y).toFixed(1)}" r="3" fill="#111"/><line x1="${X(q.x).toFixed(1)}" y1="${Y(q.y).toFixed(1)}" x2="${X(q.x + q.dx * 0.8).toFixed(1)}" y2="${Y(q.y + q.dy * 0.8).toFixed(1)}" stroke="#111" stroke-width="1.2"/></g>`)
    .join('');
  const dims = `<text x="${(X(b.x0) + (L * sx) / 2).toFixed(1)}" y="${(Y(b.y0) + 22).toFixed(1)}" font-size="12" text-anchor="middle" fill="#333" font-family="Arial">${L.toFixed(2)} m</text>
<text x="${(X(b.x0) - 20).toFixed(1)}" y="${(Y(b.y0) - (W * sx) / 2).toFixed(1)}" font-size="12" text-anchor="middle" fill="#333" font-family="Arial" transform="rotate(-90 ${(X(b.x0) - 20).toFixed(1)} ${(Y(b.y0) - (W * sx) / 2).toFixed(1)})">${W.toFixed(2)} m</text>`;
  return {
    xml: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${hPx.toFixed(0)}" width="${widthPx}" height="${hPx.toFixed(0)}">
<defs><clipPath id="room"><polygon points="${outlinePts}"/></clipPath></defs>
<rect x="0" y="0" width="${widthPx}" height="${hPx.toFixed(0)}" fill="#fff"/>
<g clip-path="url(#room)">${layers}</g>
<polygon points="${outlinePts}" fill="none" stroke="#111" stroke-width="2.5"/>
${dots}${ugr}${dims}</svg>`,
    width: widthPx,
    height: hPx,
    range,
  };
}

/** The colour scale bar: min to max with the contour values */
export function legendSvg(range: { min: number; max: number }, pal: Palette, widthPx = 420) {
  const steps = 60;
  const h = 14;
  const cells = Array.from({ length: steps }, (_, i) => `<rect x="${((i * widthPx) / steps).toFixed(1)}" y="0" width="${(widthPx / steps + 0.5).toFixed(1)}" height="${h}" fill="${colourAt((i + 0.5) / steps, pal)}"/>`).join('');
  const span = Math.max(range.max - range.min, 1);
  const ticks = [range.min, ...niceLevels(range.min, range.max, 6).filter((v) => v - range.min > span * 0.07 && range.max - v > span * 0.07), range.max]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((v) => {
      const x = ((v - range.min) / Math.max(range.max - range.min, 1)) * widthPx;
      return `<line x1="${x.toFixed(1)}" y1="${h}" x2="${x.toFixed(1)}" y2="${h + 4}" stroke="#333"/><text x="${Math.min(Math.max(x, 12), widthPx - 12).toFixed(1)}" y="${h + 15}" font-size="10" font-family="Arial" text-anchor="middle" fill="#333">${Math.round(v)}</text>`;
    })
    .join('');
  return { xml: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -1 ${widthPx} ${h + 22}" width="${widthPx}" height="${h + 22}">${cells}<rect x="0" y="0" width="${widthPx}" height="${h}" fill="none" stroke="#333"/>${ticks}</svg>`, width: widthPx, height: h + 22 };
}

/** The room in 3D: floor plane with the pseudo-colour, walls, the fittings at their height – turned by yaw / pitch (degrees) */
export function room3dSvg(poly: Pt[], positions: Pt[], room: { height: number; mount: number; plane: number }, r: CalcResult | null, sc: Scale, fit: { lumL: number; lumW: number }, yaw: number, pitch: number, widthPx = 640, zoom = 1) {
  const b = bbox(poly);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const cz = room.height / 2;
  const diag = Math.hypot(b.x1 - b.x0, b.y1 - b.y0, room.height);
  const hPx = Math.round(widthPx * 0.68);
  const ya = (yaw * Math.PI) / 180;
  const pa = (pitch * Math.PI) / 180;
  const dist = diag * 2.2;
  // world → camera: turn round the vertical axis, tilt, then perspective
  const raw = (x: number, y: number, z: number) => {
    const X0 = x - cx;
    const Y0 = y - cy;
    const Z0 = z - cz;
    const x1 = X0 * Math.cos(ya) - Y0 * Math.sin(ya);
    const y1 = X0 * Math.sin(ya) + Y0 * Math.cos(ya);
    const y2 = y1 * Math.cos(pa) - Z0 * Math.sin(pa);
    const z2 = y1 * Math.sin(pa) + Z0 * Math.cos(pa);
    const d = dist + y2;
    return { x: x1 / d, y: -z2 / d, d };
  };
  // fit the room to the picture, then zoom about its centre
  const corners = poly.flatMap((p) => [raw(p.x, p.y, 0), raw(p.x, p.y, room.height)]);
  const ex = { x0: Math.min(...corners.map((c) => c.x)), x1: Math.max(...corners.map((c) => c.x)), y0: Math.min(...corners.map((c) => c.y)), y1: Math.max(...corners.map((c) => c.y)) };
  const k = Math.min((widthPx * 0.9) / Math.max(ex.x1 - ex.x0, 1e-6), (hPx * 0.9) / Math.max(ex.y1 - ex.y0, 1e-6)) * zoom;
  const mx = (ex.x0 + ex.x1) / 2;
  const my = (ex.y0 + ex.y1) / 2;
  const P = (x: number, y: number, z: number) => {
    const v = raw(x, y, z);
    return { x: widthPx / 2 + (v.x - mx) * k, y: hPx / 2 + (v.y - my) * k, d: v.d };
  };
  const pts = (arr: { x: number; y: number }[]) => arr.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const zp = room.plane;
  const floor = poly.map((p) => P(p.x, p.y, zp));
  let bands = '';
  if (r) {
    const range = scaleRange(poly, r, sc);
    const c = contourLayers(r, range.min, range.max, sc.palette);
    bands = c.filled
      .map((l) => `<path d="${l.rings.map((ring) => `M${ring.map((q) => { const v = P(q[0], q[1], zp); return `${v.x.toFixed(1)},${v.y.toFixed(1)}`; }).join('L')}Z`).join('')}" fill="${l.colour}" fill-rule="evenodd"/>`)
      .join('');
  }
  // walls, drawn far to near; the near side lightly so the room stays visible
  const walls = poly
    .map((a, i) => {
      const c = poly[(i + 1) % poly.length];
      const q = [P(a.x, a.y, 0), P(c.x, c.y, 0), P(c.x, c.y, room.height), P(a.x, a.y, room.height)];
      return { q, depth: q.reduce((s, v) => s + v.d, 0) / 4 };
    })
    .sort((m, n) => n.depth - m.depth);
  const mean = walls.reduce((s, w) => s + w.depth, 0) / Math.max(walls.length, 1);
  const wallSvg = walls.map((w) => `<polygon points="${pts(w.q)}" fill="#9CA3AF" fill-opacity="${w.depth > mean ? 0.28 : 0.06}" stroke="#555" stroke-width="1"/>`).join('');
  const hl = Math.max(fit.lumL, 60) / 2000;
  const hw = Math.max(fit.lumW, 60) / 2000;
  const lums = positions
    .map((f) => ({ q: [P(f.x - hl, f.y - hw, room.mount), P(f.x + hl, f.y - hw, room.mount), P(f.x + hl, f.y + hw, room.mount), P(f.x - hl, f.y + hw, room.mount)], f }))
    .sort((m, n) => n.q[0].d - m.q[0].d)
    .map(({ q, f }) => {
      const top = P(f.x, f.y, room.mount);
      const bottom = P(f.x, f.y, zp);
      return `<line x1="${top.x.toFixed(1)}" y1="${top.y.toFixed(1)}" x2="${bottom.x.toFixed(1)}" y2="${bottom.y.toFixed(1)}" stroke="#F59E0B" stroke-opacity="0.35" stroke-width="1"/><polygon points="${pts(q)}" fill="#FFF7D6" stroke="#B45309" stroke-width="1.2"/>`;
    })
    .join('');
  const ceiling = poly.map((p) => P(p.x, p.y, room.height));
  const floor0 = poly.map((p) => P(p.x, p.y, 0));
  return {
    xml: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${hPx}" width="${widthPx}" height="${hPx}">
<rect width="${widthPx}" height="${hPx}" fill="#F8FAFC"/>
<defs><clipPath id="wp"><polygon points="${pts(floor)}"/></clipPath></defs>
<polygon points="${pts(floor0)}" fill="#E5E7EB" stroke="#555"/>
${wallSvg}
<g clip-path="url(#wp)">${bands}</g>
<polygon points="${pts(floor)}" fill="none" stroke="#111" stroke-width="1.5"/>
${lums}
<polygon points="${pts(ceiling)}" fill="none" stroke="#555" stroke-dasharray="4 3"/>
</svg>`,
    width: widthPx,
    height: hPx,
  };
}

export type SheetInput = {
  code: string | null;
  title: string;
  room: RoomInput;
  poly: Pt[];
  fit: FittingInput;
  positions: Pt[];
  r: CalcResult;
  mf: number;
  space: string | null;
  source: string | null;
  target: number;
  uoTarget: number | null;
  lpdLimit: number | null;
  scale: Scale;
  ugrLimit: number | null;
  ugrSheet: number | null;
  savings: { lines: [string, string][] } | null;
  by: string;
};

/** The client sheet: DIMO logo, room plan with the heat-map, results against the standard and the savings – DRAFT */
export function calcSheetHtml(s: SheetInput) {
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric' });
  const plan = planSvg(s.poly, s.positions, s.r, s.scale, 660);
  const legend = legendSvg(plan.range, s.scale.palette, 420);
  const t = FITTING_TYPES.find((x) => x.key === s.fit.type);
  const size = t?.size ?? [600, 600];
  const view3d = room3dSvg(s.poly, s.positions, s.room, s.r, s.scale, { lumL: s.fit.lumL ?? size[0], lumW: s.fit.lumW ?? size[1] }, 35, 55, 420);
  const ugr = s.ugrSheet ?? s.r.ugr.max;
  const ugrText = ugr == null ? '—' : ugr < 10 ? '&lt; 10' : ugr.toFixed(1);
  const ok = (b: boolean) => (b ? '<span style="color:#15803D">✓</span>' : '<span style="color:#B45309">✗</span>');
  const row = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { size: A4 portrait; margin: 14mm 14mm; }
  body { font: 10.5px Arial, Helvetica, sans-serif; color: #111; }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #C8102E; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 17px; margin: 0; } h2 { font-size: 12px; margin: 12px 0 4px; } .sub { color: #555; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; } td { padding: 4px 6px; border-bottom: 1px solid #E5E5E5; } td.k { width: 42%; color: #444; }
  .cols { display: flex; gap: 14px; } .cols > div { flex: 1; }
  .wm { position: fixed; top: 40%; left: 0; width: 100%; text-align: center; transform: rotate(-30deg); font: bold 58px Arial; color: rgba(200,16,46,0.10); }
  .foot { margin-top: 14px; font-size: 8.5px; color: #555; border-top: 1px solid #ddd; padding-top: 6px; }
</style></head><body>
<div class="wm">DRAFT – Indicative calculation</div>
<header><img src="${DIMO_LOGO_DATA_URI}" alt="DIMO" style="height:42px;width:auto" />
<div><h1>${esc(s.title)}</h1><div class="sub">Quick lighting calculation${s.code ? ` · ${esc(s.code)}` : ''} · ${esc(now)}</div></div></header>
<div style="text-align:center">${plan.xml}</div>
<div style="display:flex;align-items:center;justify-content:center;gap:10px;font-size:9px;color:#555;margin-top:2px">Illuminance on the working plane (lx)${legend.xml}</div>
<div style="display:flex;align-items:center;gap:12px;margin-top:6px"><div>${view3d.xml.replace(/id="wp"/g, 'id="wp3"').replace(/url\(#wp\)/g, 'url(#wp3)')}</div>
<div style="font-size:9px;color:#555">The room in 3D: the working plane in the same colours, the fittings at their mounting height.<br/><br/>Lines on the plan join points of equal light (isolux), in lux. Black marks with a stroke are the seated observers used for glare (UGR), looking into the room.</div></div>
<div class="cols">
<div><h2>Room and fittings</h2><table>
${row('Area · room index', `${s.r.A.toFixed(1)} m² · K ${s.r.K.toFixed(2)}`)}
${row('Heights', `ceiling ${s.room.height} m · fittings ${s.room.mount} m · working plane ${s.room.plane} m`)}
${row('Reflectances', `ceiling ${Math.round(s.room.rc * 100)}% · walls ${Math.round(s.room.rw * 100)}% · floor ${Math.round(s.room.rf * 100)}%`)}
${row('Fitting', `${esc(s.fit.name || t?.label || '')} · ${s.fit.watts} W · ${s.fit.lumens} lm`)}
${row('Number of fittings', `<b>${s.positions.length}</b>`)}
${row('Maintenance factor', s.mf.toFixed(2))}
</table></div>
<div><h2>Results${s.space ? ` – ${esc(s.space)}` : ''}</h2><table>
${row('Average (Em)', `<b>${Math.round(s.r.em)} lx</b> ${ok(s.r.em >= s.target)} target ${s.target} lx`)}
${row('Minimum · maximum', `${Math.round(s.r.emin)} lx · ${Math.round(s.r.emax)} lx`)}
${row('Uniformity Uo = Emin / Em', `${s.r.uo.toFixed(2)}${s.uoTarget ? ` ${ok(s.r.uo >= s.uoTarget)} target ${s.uoTarget}` : ''}`)}
${row('Uniformity Ud = Emin / Emax', s.r.ud.toFixed(2))}
${row(s.ugrSheet != null ? 'Glare UGR (data sheet)' : 'Glare UGR (max, indicative)', `${ugrText}${s.ugrLimit != null && ugr != null ? ` ${ok(ugr <= s.ugrLimit)} limit ${s.ugrLimit}` : ''}`)}
${row('Installed load', `${(s.r.watts / 1000).toFixed(2)} kW · ${s.r.wpm2.toFixed(1)} W/m²${s.lpdLimit ? ` ${ok(s.r.wpm2 <= s.lpdLimit)} SLSEA ${s.lpdLimit} W/m²` : ''}`)}
${s.source ? row('Standard', esc(s.source)) : ''}
</table></div></div>
${s.savings ? `<h2>Energy and savings</h2><table>${s.savings.lines.map(([k, v]) => row(k, esc(v))).join('')}</table>` : ''}
<div class="foot">DRAFT – Indicative calculation: point-by-point on the working plane with interreflections, from the fitting type and the data sheet watts and lumens; an empty room is assumed. UGR by the CIE 117 formula from the fitting's lit area – the manufacturer's UGR table is the reference. Final design by DIMO Lighting Design.<br/>Prepared by ${esc(s.by)} · DIMO Lighting Solutions</div>
</body></html>`;
}
