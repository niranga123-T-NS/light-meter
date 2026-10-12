import { DIMO_LOGO_DATA_URI } from './brandLogoData';
import { contours } from 'd3-contour';
import type { AreaResult, RoadClass, RoadInput, RoadResult } from './roadcalc';
import { ARRANGEMENTS, geometry, SURFACES } from './roadcalc';
import { bbox, FITTING_TYPES, inside, mountAt, roofAt, ROOFS, SHAPES, type CalcResult, type FittingInput, type Lum, type Pt, type RoomInput } from './lightcalc';

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
export function scaleRange(poly: Pt[], r: Pick<CalcResult, 'field' | 'emin' | 'emax'>, sc: Scale) {
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
function contourLayers(r: Pick<CalcResult, 'field'>, min: number, max: number, pal: Palette) {
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
/** opts.numbers: number the fittings (light-by-light plans); opts.selected: the fitting picked on screen */
export function planSvg(poly: Pt[], positions: Lum[], r: CalcResult | null, sc: Scale, widthPx = 640, opts: { numbers?: boolean; selected?: number | null } = {}) {
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
  const dots = positions
    .map((p, i) => {
      const sel = opts.selected === i;
      const num = opts.numbers ? `<text x="${(X(p.x) + 6).toFixed(1)}" y="${(Y(p.y) - 6).toFixed(1)}" font-size="9" font-family="Arial" fill="#111" stroke="#fff" stroke-width="2.5" paint-order="stroke">${i + 1}</text>` : '';
      return `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${sel ? 7 : 4.5}" fill="${sel ? '#C8102E' : '#fff'}" stroke="#111" stroke-width="1.6"/>${num}`;
    })
    .join('');
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
    /** screen point → metres in the room (for placing fittings by tapping the plan) */
    toRoom: (px: number, py: number) => ({ x: b.x0 + (px - pad) / sx, y: b.y1 - (py - pad) / sx }),
    pxPerM: sx,
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

export type Surfaces = { ceiling: string; walls: string; floor: string };
/** Common finishes; the reflectance is suggested from the colour (its light reflectance value) and can be changed */
export const SURFACE_COLOURS: { hex: string; name: string }[] = [
  { hex: '#F5F5F2', name: 'White' },
  { hex: '#ECE7DA', name: 'Off-white' },
  { hex: '#E8D9B5', name: 'Cream' },
  { hex: '#CBB89A', name: 'Beige' },
  { hex: '#C9CACC', name: 'Light grey' },
  { hex: '#9A9C9E', name: 'Mid grey' },
  { hex: '#A7A39A', name: 'Concrete' },
  { hex: '#5B5E62', name: 'Dark grey' },
  { hex: '#C8A377', name: 'Light wood' },
  { hex: '#6E4B2F', name: 'Dark wood' },
  { hex: '#BFD3E6', name: 'Pale blue' },
  { hex: '#C8DCC0', name: 'Pale green' },
  { hex: '#B5654A', name: 'Terracotta' },
  { hex: '#2B2B2B', name: 'Black' },
];
/** Light reflectance value from a colour: the relative luminance, rounded to 0.05 (0.05–0.85) */
export function reflectanceOf(hex: string) {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  const lin = (v: string) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const y = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
  return Math.min(0.85, Math.max(0.05, Math.round(y * 20) / 20));
}
const DEFAULT_SURFACES: Surfaces = { ceiling: '#F5F5F2', walls: '#ECE7DA', floor: '#A7A39A' };

/** The room in 3D: floor, walls to the roof, the roof as a see-through frame, the working plane in pseudo-colour and the
 *  fittings at their height – turned by yaw / pitch (degrees) */
export function room3dSvg(
  poly: Pt[],
  positions: Lum[],
  room: RoomInput,
  r: CalcResult | null,
  sc: Scale,
  fit: { lumL: number; lumW: number; rot?: number },
  yaw: number,
  pitch: number,
  widthPx = 640,
  zoom = 1,
  opts: { surfaces?: Surfaces; roof?: boolean } = {},
) {
  const col = opts.surfaces ?? DEFAULT_SURFACES;
  const zr = roofAt(room, poly);
  const mz = mountAt(room, poly);
  const flat = (room.roof ?? 'flat') === 'flat' || !(room.rise && room.rise > 0);
  const b = bbox(poly);
  const top = Math.max(room.height, ...Array.from({ length: 121 }, (_, i) => zr(b.x0 + ((i % 11) / 10) * (b.x1 - b.x0), b.y0 + (Math.floor(i / 11) / 10) * (b.y1 - b.y0))));
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const cz = top / 2;
  const diag = Math.hypot(b.x1 - b.x0, b.y1 - b.y0, top);
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
  const corners = poly.flatMap((p) => [raw(p.x, p.y, 0), raw(p.x, p.y, Math.max(zr(p.x, p.y), room.height))]).concat([raw(cx, cy, top)]);
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
  // walls up to the roof, drawn far to near; the near side lightly so the room stays visible
  const steps = flat ? 1 : 16;
  const walls = poly
    .map((a, i) => {
      const c = poly[(i + 1) % poly.length];
      const topEdge = Array.from({ length: steps + 1 }, (_, j) => {
        const t = 1 - j / steps;
        const x = a.x + (c.x - a.x) * t;
        const y = a.y + (c.y - a.y) * t;
        return P(x, y, zr(x, y));
      });
      const q = [P(a.x, a.y, 0), P(c.x, c.y, 0), ...topEdge];
      return { q, depth: q.reduce((s2, v) => s2 + v.d, 0) / q.length };
    })
    .sort((m, n) => n.depth - m.depth);
  const mean = walls.reduce((s2, w) => s2 + w.depth, 0) / Math.max(walls.length, 1);
  const wallSvg = walls.map((w) => `<polygon points="${pts(w.q)}" fill="${col.walls}" fill-opacity="${w.depth > mean ? 0.85 : 0.08}" stroke="#555" stroke-width="1"/>`).join('');
  // the roof: a see-through frame of lines in both directions, kept inside the outline
  let roofSvg = '';
  if (opts.roof !== false) {
    const lines: string[] = [];
    const nL = 12;
    const seg = 40;
    const run = (fx: (t: number) => Pt) => {
      let cur: string[] = [];
      for (let j = 0; j <= seg; j++) {
        const q = fx(j / seg);
        if (inside(q, poly)) {
          const v = P(q.x, q.y, zr(q.x, q.y));
          cur.push(`${v.x.toFixed(1)},${v.y.toFixed(1)}`);
        } else if (cur.length) {
          if (cur.length > 1) lines.push(cur.join(' '));
          cur = [];
        }
      }
      if (cur.length > 1) lines.push(cur.join(' '));
    };
    for (let i = 1; i < nL; i++) {
      const yy = b.y0 + ((b.y1 - b.y0) * i) / nL;
      run((t) => ({ x: b.x0 + (b.x1 - b.x0) * t, y: yy }));
      const xx = b.x0 + ((b.x1 - b.x0) * i) / nL;
      run((t) => ({ x: xx, y: b.y0 + (b.y1 - b.y0) * t }));
    }
    roofSvg = lines.map((l) => `<polyline points="${l}" fill="none" stroke="#475569" stroke-opacity="${flat ? 0.18 : 0.4}" stroke-width="0.8"/>`).join('');
  }
  const hl = Math.max(fit.lumL, 60) / 2000;
  const hw = Math.max(fit.lumW, 60) / 2000;
  const corner = (f: Lum, sx: number, sy: number) => {
    const rot = ((f.rot ?? fit.rot ?? 0) * Math.PI) / 180;
    return { x: f.x + sx * hl * Math.cos(rot) - sy * hw * Math.sin(rot), y: f.y + sx * hl * Math.sin(rot) + sy * hw * Math.cos(rot) };
  };
  const lums = positions
    .map((f) => {
      const z = f.z ?? mz(f);
      const q = [corner(f, -1, -1), corner(f, 1, -1), corner(f, 1, 1), corner(f, -1, 1)].map((c) => P(c.x, c.y, z));
      return { q, f, z };
    })
    .sort((m, n) => n.q[0].d - m.q[0].d)
    .map(({ q, f, z }) => {
      const t0 = P(f.x, f.y, z);
      const bottom = P(f.x, f.y, zp);
      const hang = zr(f.x, f.y) - z > 0.05 ? (() => { const rt = P(f.x, f.y, zr(f.x, f.y)); return `<line x1="${rt.x.toFixed(1)}" y1="${rt.y.toFixed(1)}" x2="${t0.x.toFixed(1)}" y2="${t0.y.toFixed(1)}" stroke="#333" stroke-width="0.8"/>`; })() : '';
      return `${hang}<line x1="${t0.x.toFixed(1)}" y1="${t0.y.toFixed(1)}" x2="${bottom.x.toFixed(1)}" y2="${bottom.y.toFixed(1)}" stroke="#F59E0B" stroke-opacity="0.35" stroke-width="1"/><polygon points="${pts(q)}" fill="#FFF7D6" stroke="#B45309" stroke-width="1.2"/>`;
    })
    .join('');
  const floor0 = poly.map((p) => P(p.x, p.y, 0));
  return {
    xml: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${hPx}" width="${widthPx}" height="${hPx}">
<rect width="${widthPx}" height="${hPx}" fill="#F8FAFC"/>
<defs><clipPath id="wp"><polygon points="${pts(floor)}"/></clipPath></defs>
<polygon points="${pts(floor0)}" fill="${col.floor}" stroke="#555"/>
${wallSvg}
<g clip-path="url(#wp)">${bands}</g>
<polygon points="${pts(floor)}" fill="none" stroke="#111" stroke-width="1.5"/>
${lums}
${roofSvg}
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
  positions: Lum[];
  r: CalcResult;
  mf: number;
  space: string | null;
  source: string | null;
  target: number;
  uoTarget: number | null;
  scale: Scale;
  ugrLimit: number | null;
  ugrSheet: number | null;
  surfaces: Surfaces;
  /** e.g. "IES file: Thorn Omega Pro 600 (Thorn)" or "Modelled curve – panel" */
  photoLabel: string;
  polar: string | null;
  /** e.g. "Field 6 × 3, spacing 6.67 × 8.00 m" or "Light by light" */
  arrangement: string;
  /** light by light: list each fitting's position */
  listLights: boolean;
  savings: { lines: [string, string][] } | null;
  by: string;
};

/** The client sheet: DIMO logo, room plan with the heat-map, results against the standard and the savings – DRAFT */
export function calcSheetHtml(s: SheetInput) {
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric' });
  const plan = planSvg(s.poly, s.positions, s.r, s.scale, 660, { numbers: s.listLights });
  const mzAt = mountAt(s.room, s.poly);
  const lightRows = s.listLights
    ? `<h2>Fitting positions</h2><table style="font-size:9px"><tr><td class="k" style="width:auto"><b>No.</b></td><td><b>x (m)</b></td><td><b>y (m)</b></td><td><b>Height (m)</b></td><td><b>Turned</b></td></tr>${(s.positions as Lum[])
        .map((p, i) => `<tr><td>${i + 1}</td><td>${p.x.toFixed(2)}</td><td>${p.y.toFixed(2)}</td><td>${(p.z ?? mzAt(p)).toFixed(2)}</td><td>${p.rot ?? s.fit.rot ?? 0}°</td></tr>`)
        .join('')}</table>`
    : '';
  const legend = legendSvg(plan.range, s.scale.palette, 420);
  const t = FITTING_TYPES.find((x) => x.key === s.fit.type);
  const size = t?.size ?? [600, 600];
  const view3d = room3dSvg(s.poly, s.positions, s.room, s.r, s.scale, { lumL: s.fit.lumL ?? (s.fit.photo?.lenMm || size[0]), lumW: s.fit.lumW ?? (s.fit.photo?.widMm || size[1]), rot: s.fit.rot }, 35, 38, 420, 1, { surfaces: s.surfaces });
  const roof = ROOFS.find((x) => x.value === (s.room.roof ?? 'flat'));
  const pitched = (s.room.roof ?? 'flat') !== 'flat' && (s.room.rise ?? 0) > 0;
  const shape = s.room.shape === 'free' ? 'Drawn plan' : (SHAPES.find((x) => x.value === s.room.shape)?.label ?? '');
  const sw = (c: string) => `<span style="display:inline-block;width:10px;height:10px;border:1px solid #999;background:${esc(c)};vertical-align:-1px;margin-right:3px"></span>`;
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
<div><h1>${esc(s.title)}</h1><div class="sub">DLux lighting calculation${s.code ? ` · ${esc(s.code)}` : ''} · ${esc(now)}</div></div></header>
<div style="text-align:center">${plan.xml}</div>
<div style="display:flex;align-items:center;justify-content:center;gap:10px;font-size:9px;color:#555;margin-top:2px">Illuminance on the working plane (lx)${legend.xml}</div>
<div style="display:flex;align-items:center;gap:12px;margin-top:6px"><div>${view3d.xml.replace(/id="wp"/g, 'id="wp3"').replace(/url\(#wp\)/g, 'url(#wp3)')}</div>
<div style="font-size:9px;color:#555">${s.polar ? `<div style="text-align:center">${s.polar}<br/>Light distribution (red C0–C180, blue C90–C270)</div><br/>` : ''}The room in 3D: the working plane in the same colours, the fittings at their mounting height.<br/><br/>Lines on the plan join points of equal light (isolux), in lux. Black marks with a stroke are the seated observers used for glare (UGR), looking into the room.</div></div>
<div class="cols">
<div><h2>Room and fittings</h2><table>
${row('Area · room index', `${s.r.A.toFixed(1)} m² · K ${s.r.K.toFixed(2)}`)}
${row('Shape · roof', `${esc(shape)} · ${esc(roof?.label ?? 'Flat ceiling')}${pitched ? `, ${s.room.rise} m rise` : ''}`)}
${row('Heights', `${pitched ? 'walls' : 'ceiling'} ${s.room.height} m · fittings ${pitched && s.room.drop != null ? `${s.room.drop} m below the roof` : `${s.room.mount} m`} · working plane ${s.room.plane} m`)}
${row('Surfaces (reflectance)', `${sw(s.surfaces.ceiling)}ceiling ${Math.round(s.room.rc * 100)}% · ${sw(s.surfaces.walls)}walls ${Math.round(s.room.rw * 100)}% · ${sw(s.surfaces.floor)}floor ${Math.round(s.room.rf * 100)}%`)}
${row('Fitting', `${esc(s.fit.name || t?.label || '')} · ${s.fit.watts} W · ${s.fit.lumens} lm${s.fit.rot ? ' · turned 90°' : ''}`)}
${row('Light distribution', esc(s.photoLabel))}
${row('Number of fittings', `<b>${s.positions.length}</b> · ${esc(s.arrangement)}`)}
${row('Maintenance factor', s.mf.toFixed(2))}
</table></div>
<div><h2>Results${s.space ? ` – ${esc(s.space)}` : ''}</h2><table>
${row('Average (Em)', `<b>${Math.round(s.r.em)} lx</b> ${ok(s.r.em >= s.target)} target ${s.target} lx`)}
${row('Minimum · maximum', `${Math.round(s.r.emin)} lx · ${Math.round(s.r.emax)} lx`)}
${row('Uniformity Uo = Emin / Em', `${s.r.uo.toFixed(2)}${s.uoTarget ? ` ${ok(s.r.uo >= s.uoTarget)} target ${s.uoTarget}` : ''}`)}
${row('Uniformity Ud = Emin / Emax', s.r.ud.toFixed(2))}
${row(s.ugrSheet != null ? 'Glare UGR (data sheet)' : 'Glare UGR (max, indicative)', `${ugrText}${s.ugrLimit != null && ugr != null ? ` ${ok(ugr <= s.ugrLimit)} limit ${s.ugrLimit}` : ''}`)}
${row('Installed load', `${(s.r.watts / 1000).toFixed(2)} kW · ${s.r.wpm2.toFixed(1)} W/m²`)}
${s.source ? row('Standard', esc(s.source)) : ''}
</table></div></div>
${lightRows}
${s.savings ? `<h2>Energy and savings</h2><table>${s.savings.lines.map(([k, v]) => row(k, esc(v))).join('')}</table>` : ''}
<div class="foot">DRAFT – Indicative calculation: point-by-point on the working plane with interreflections between the working plane, walls and roof, from the fitting's IES file or a curve modelled on its type, with the data sheet watts and lumens; an empty room is assumed. UGR by the CIE 117 formula from the fitting's lit area – the manufacturer's UGR table is the reference. Final design by DIMO Lighting Design.<br/>Prepared by ${esc(s.by)} · DIMO Lighting Solutions</div>
</body></html>`;
}

/** The road from above: two fields of pseudo-colour with isolux lines, kerbs, lanes, footpaths and the poles */
export function roadPlanSvg(r: RoadInput, res: RoadResult, sc: Scale, widthPx = 640) {
  const f = res.field;
  const L = 2 * res.fieldLen;
  const y0 = f.y0;
  const y1 = f.y0 + f.dy * (f.ny - 1);
  const pad = 30;
  const k = (widthPx - 2 * pad) / L;
  const hPx = (y1 - y0) * k + 2 * pad + 20;
  const X = (x: number) => pad + x * k;
  const Y = (y: number) => pad + (y1 - y) * k;
  const lo = Math.min(...f.v);
  const hi = Math.max(...f.v);
  const range = sc.mode === 'custom' && sc.min != null && sc.max != null && sc.max > sc.min ? { min: sc.min, max: sc.max } : { min: Math.floor(lo * 10) / 10, max: Math.ceil(hi * 10) / 10 };
  const c = contourLayers(res, range.min, range.max, sc.palette);
  const path = (rings: number[][][]) => rings.map((ring) => `M${ring.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('L')}Z`).join('');
  const bands = c.filled.map((l) => `<path d="${path(l.rings)}" fill="${l.colour}" fill-rule="evenodd"/>`).join('');
  const lines = c.lines
    .map((l) => {
      const longest = l.rings.reduce((a, x) => (x.length > a.length ? x : a), [] as number[][]);
      const lp = longest[Math.floor(longest.length / 3)];
      const label = lp ? `<text x="${X(lp[0]).toFixed(1)}" y="${Y(lp[1]).toFixed(1)}" font-size="9" font-family="Arial" fill="#111" stroke="#fff" stroke-width="2.5" paint-order="stroke" text-anchor="middle" dy="3">${Math.round(l.value * 10) / 10}</text>` : '';
      return `<path d="${path(l.rings)}" fill="none" stroke="#111" stroke-width="0.7" stroke-opacity="0.7"/>${label}`;
    })
    .join('');
  const geo = geometry(r);
  const laneLines = geo.carriages
    .flatMap((c) => {
      const lanes = Math.max(1, Math.round(c.lanes));
      return Array.from({ length: lanes - 1 }, (_, i) => {
        const y = c.y0 + ((c.y1 - c.y0) / lanes) * (i + 1);
        return `<line x1="${X(0)}" y1="${Y(y)}" x2="${X(L)}" y2="${Y(y)}" stroke="#fff" stroke-width="2" stroke-dasharray="10 8"/>`;
      });
    })
    .join('');
  const kerb = (y: number) => `<line x1="${X(0)}" y1="${Y(y)}" x2="${X(L)}" y2="${Y(y)}" stroke="#111" stroke-width="2"/>`;
  const median = geo.median
    ? `<rect x="${X(0)}" y="${Y(geo.median.y1)}" width="${L * k}" height="${(geo.median.y1 - geo.median.y0) * k}" fill="#6B7280" fill-opacity="0.45"/>${kerb(geo.median.y0)}${kerb(geo.median.y1)}<text x="${X(L) - 4}" y="${(Y((geo.median.y0 + geo.median.y1) / 2) + 4).toFixed(1)}" font-size="10" font-family="Arial" text-anchor="end" fill="#fff">median ${(geo.median.y1 - geo.median.y0).toFixed(1)} m</text>`
    : '';
  const poles = res.luminaires
    .map((l) => {
      const py = l.y - l.face * r.overhang;
      return `<line x1="${X(l.x)}" y1="${Y(py)}" x2="${X(l.x)}" y2="${Y(l.y)}" stroke="#111" stroke-width="2"/><circle cx="${X(l.x)}" cy="${Y(py)}" r="4" fill="#111"/><rect x="${X(l.x) - 6}" y="${Y(l.y) - 3}" width="12" height="6" fill="#FFF7D6" stroke="#B45309" stroke-width="1.2"/>`;
    })
    .join('');
  const field = `<rect x="${X(0)}" y="${Y(geometry(r).total)}" width="${res.fieldLen * k}" height="${geometry(r).total * k}" fill="none" stroke="#C8102E" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  return {
    xml: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${hPx.toFixed(0)}" width="${widthPx}" height="${hPx.toFixed(0)}">
<rect width="${widthPx}" height="${hPx.toFixed(0)}" fill="#fff"/>
<defs><clipPath id="road"><rect x="${X(0)}" y="${Y(y1)}" width="${L * k}" height="${(y1 - y0) * k}"/></clipPath></defs>
<g clip-path="url(#road)">${bands}${lines}</g>
${median}${kerb(0)}${kerb(geo.total)}${laneLines}${field}${poles}
<text x="${X(res.fieldLen / 2)}" y="${(hPx - 8).toFixed(0)}" font-size="11" font-family="Arial" text-anchor="middle" fill="#C8102E">calculation field ${res.fieldLen} m</text>
<text x="${X(L) - 2}" y="${(hPx - 8).toFixed(0)}" font-size="11" font-family="Arial" text-anchor="end" fill="#333">${L} m shown · kerb to kerb ${geo.total.toFixed(1)} m</text>
</svg>`,
    width: widthPx,
    height: hPx,
    range,
  };
}

export type RoadSheetInput = {
  code: string | null;
  title: string;
  road: RoadInput;
  res: RoadResult;
  cls: RoadClass | null;
  footCls: RoadClass | null;
  scale: Scale;
  fitting: string;
  photoLabel: string;
  polar: string | null;
  lumens: number;
  watts: number;
  mf: number;
  by: string;
};

/** The road lighting client sheet – DRAFT */
export function roadSheetHtml(s: RoadSheetInput) {
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric' });
  const plan = roadPlanSvg(s.road, s.res, s.scale, 680);
  const legend = legendSvg(plan.range, s.scale.palette, 420);
  const ok = (b: boolean | undefined | null) => (b == null ? '' : b ? '<span style="color:#15803D">✓</span>' : '<span style="color:#B45309">✗</span>');
  const row = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`;
  const m = s.cls?.cls.startsWith('M');
  const c = s.cls;
  const area = (a: AreaResult, cl: RoadClass | null) =>
    `<tr><td>${esc(a.name)}</td><td>${a.eav.toFixed(1)} ${cl && !cl.cls.startsWith('M') ? `${ok(a.eav >= cl.val)} (${cl.val})` : ''}</td><td>${a.emin.toFixed(1)} ${cl?.emin != null ? `${ok(a.emin >= cl.emin)} (${cl.emin})` : ''}</td><td>${a.uo.toFixed(2)} ${cl && !cl.cls.startsWith('M') && cl.uo != null ? `${ok(a.uo >= cl.uo)} (${cl.uo})` : ''}</td><td>${a.emax.toFixed(1)}</td></tr>`;
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
<div><h1>${esc(s.title)}</h1><div class="sub">DLux road lighting calculation (EN 13201)${s.code ? ` · ${esc(s.code)}` : ''} · ${esc(now)}</div></div></header>
<div style="text-align:center">${plan.xml}</div>
<div style="display:flex;align-items:center;justify-content:center;gap:10px;font-size:9px;color:#555;margin-top:2px">Horizontal illuminance (lx)${legend.xml}</div>
<div class="cols">
<div><h2>Road and poles</h2><table>
${s.road.layout === 'dual'
    ? `${row('Cross-section', `dual carriageway · ${geometry(s.road).total.toFixed(1)} m kerb to kerb`)}${row('Carriageways', `left ${s.road.width} m, ${s.road.lanes} lane(s) · right ${s.road.width2 || s.road.width} m, ${s.road.lanes2 || s.road.lanes} lane(s)`)}${row('Central median', `${s.road.median ?? 0} m`)}`
    : row('Carriageway', `${s.road.width} m · ${s.road.lanes} lane(s)`)}
${row('Road surface', esc(SURFACES.find((x) => x.value === s.road.surface)?.label ?? s.road.surface))}
${row('Footpaths', `${s.road.footL ? `left ${s.road.footL} m` : 'left none'} · ${s.road.footR ? `right ${s.road.footR} m` : 'right none'}`)}
${row('Arrangement', esc(ARRANGEMENTS.find((x) => x.value === s.road.arrangement)?.label ?? ''))}
${row('Pole spacing · height', `${s.road.spacing} m · ${s.road.height} m`)}
${s.road.arrangement === 'central' ? row('Arm length · tilt', `${s.road.overhang} m · ${s.road.tilt}°`) : row('Overhang · setback · tilt', `${s.road.overhang} m · ${s.road.setback} m · ${s.road.tilt}°`)}
${row('Luminaire', `${esc(s.fitting)} · ${s.watts} W · ${s.lumens} lm`)}
${row('Light distribution', esc(s.photoLabel))}
${row('Maintenance factor', s.mf.toFixed(2))}
</table></div>
<div><h2>Results${c ? ` – class ${esc(c.cls)}` : ''}</h2><table>
${m && c ? s.res.carriages.map((a) => row(`Average luminance${s.res.carriages.length > 1 ? ` – ${a.name}` : ''} (estimate)`, `<b>${(a.eav * s.res.q0).toFixed(2)} cd/m²</b> ${ok(a.eav * s.res.q0 >= c.val)} class ${c.val}`)).join('') : ''}
${row('Threshold increment TI', s.res.ti != null ? `${s.res.ti.toFixed(1)} %${m && c?.ti != null ? ` ${ok(s.res.ti <= c.ti)} max ${c.ti}` : ''}` : '—')}
${row('Edge illumination ratio EIR', s.res.eir != null ? `${s.res.eir.toFixed(2)}${m && c?.rei != null ? ` ${ok(s.res.eir >= c.rei)} min ${c.rei}` : ''}` : '—')}
${m ? row('Luminance uniformity Uo · Ul', 'by the Design team (needs the surface r-table)') : ''}
${row('Power density DP', s.res.dp != null ? `${s.res.dp.toFixed(3)} W/(lx·m²)` : '—')}
${row('Load', `${(s.res.wattsPerKm / 1000).toFixed(2)} kW per km`)}
</table>${s.polar ? `<div style="text-align:center;margin-top:6px">${s.polar}<div style="font-size:9px;color:#555">Light distribution (red along the road, blue across)</div></div>` : ''}</div></div>
<h2>Illuminance (lx)</h2><table><tr><td><b>Area</b></td><td><b>Average</b></td><td><b>Minimum</b></td><td><b>Uo</b></td><td><b>Maximum</b></td></tr>
${s.res.carriages.map((a) => area(a, c)).join('')}${s.res.footpaths.map((f) => area(f, s.footCls)).join('')}</table>
<div class="foot">DRAFT – Indicative calculation to EN 13201-3: maintained horizontal illuminance on the standard grids of one calculation field, the edge illumination ratio and the threshold increment (driver's eye 1.5 m, in each lane). The average luminance is estimated from the illuminance with the surface's q0; luminance uniformity is checked by DIMO Lighting Design. Dry road surface.<br/>Prepared by ${esc(s.by)} · DIMO Lighting Solutions</div>
</body></html>`;
}

