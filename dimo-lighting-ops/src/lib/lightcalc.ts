import { modelPhotometry, type Photometry } from './photometry';

// DLux – lighting calculation (Sales Tools): point-by-point direct illuminance on the working plane plus the light
// bounced between the working plane, walls and ceiling (three-surface radiosity), times the maintenance factor.
// Fittings are described by type (a cosⁿ intensity curve and an upward share) with the watts and lumens from the
// data sheet, or by the measured curve of an IES file. Rooms are drawn or chosen from fixed shapes and extruded to
// the wall height, with a flat or pitched / curved roof.

export type Pt = { x: number; y: number };
/** A fitting placed in the room: its own mounting height and turn (degrees) when set, else the room's / the fitting's */
export type Lum = Pt & { z?: number | null; rot?: number | null };

export type FittingType = { key: string; label: string; n: number; up: number; hint: string; size: [number, number] };
/** cosⁿ curves: n = 1 wide (Lambertian, ~120°), 2 medium (~90°), 5 about 60°, 10 about 40° beam */
export const FITTING_TYPES: FittingType[] = [
  { key: 'panel', label: 'Panel (recessed / surface)', n: 1, up: 0, hint: 'Wide light, offices and classrooms', size: [600, 600] },
  { key: 'downlight', label: 'Downlight – medium beam', n: 2, up: 0, hint: 'About 90° beam', size: [150, 150] },
  { key: 'downlight_narrow', label: 'Downlight / spot – narrow beam', n: 10, up: 0, hint: 'About 40° beam', size: [80, 80] },
  { key: 'batten', label: 'Batten / open linear', n: 1, up: 0.15, hint: 'Some light goes up to the ceiling', size: [1200, 50] },
  { key: 'linear_di', label: 'Suspended linear – direct / indirect', n: 1.5, up: 0.4, hint: 'About 40% up', size: [1200, 60] },
  { key: 'highbay_wide', label: 'High-bay – wide (120°)', n: 1, up: 0, hint: 'Low and medium heights', size: [350, 350] },
  { key: 'highbay_med', label: 'High-bay – medium (90°)', n: 2, up: 0, hint: '6–10 m', size: [320, 320] },
  { key: 'highbay_narrow', label: 'High-bay – narrow (60°)', n: 5, up: 0, hint: 'High bays, racking aisles', size: [300, 300] },
];

export const REFLECTANCES = [
  { key: 'light', label: 'Light (ceiling 70 · walls 50 · floor 20)', c: 0.7, w: 0.5, f: 0.2 },
  { key: 'medium', label: 'Medium (50 · 30 · 20)', c: 0.5, w: 0.3, f: 0.2 },
  { key: 'dark', label: 'Dark (30 · 30 · 10)', c: 0.3, w: 0.3, f: 0.1 },
];
export const MAINTENANCE = [
  { key: 'clean', label: 'Clean (office, shop) – 0.80', mf: 0.8 },
  { key: 'normal', label: 'Normal – 0.70', mf: 0.7 },
  { key: 'dirty', label: 'Dirty (workshop, dusty) – 0.60', mf: 0.6 },
];

export type Shape = 'rect' | 'l' | 't' | 'u' | 'circle' | 'free';
export const SHAPES: { value: Exclude<Shape, 'free'>; label: string }[] = [
  { value: 'rect', label: 'Rectangle' },
  { value: 'l', label: 'L-shape' },
  { value: 't', label: 'T-shape' },
  { value: 'u', label: 'U-shape' },
  { value: 'circle', label: 'Circle' },
];
export type Roof = 'flat' | 'mono' | 'gable' | 'hip' | 'barrel' | 'sawtooth';
export const ROOFS: { value: Roof; label: string; hint: string }[] = [
  { value: 'flat', label: 'Flat ceiling', hint: 'Offices, shops, slab roofs' },
  { value: 'mono', label: 'Mono-pitch (lean-to)', hint: 'One slope, high on one side' },
  { value: 'gable', label: 'Gable (duo-pitch)', hint: 'Two slopes to a ridge' },
  { value: 'hip', label: 'Hip', hint: 'Slopes on all four sides' },
  { value: 'barrel', label: 'Barrel vault (curved)', hint: 'Curved roof, halls and hangars' },
  { value: 'sawtooth', label: 'Saw-tooth (north light)', hint: 'Factory roofs with roof glazing' },
];
export type RoomInput = {
  shape: Shape;
  length: number; // overall length (x); circle: diameter
  width: number; // overall width (y)
  cutL?: number; // L: cut-out (x) · T: stem width · U: opening width
  cutW?: number; // L: cut-out (y) · T: top bar depth · U: opening depth
  points?: Pt[]; // drawn outline
  height: number; // wall height (the ceiling for a flat roof, the eaves otherwise)
  roof?: Roof;
  rise?: number; // roof: top above the walls
  ridge?: 'x' | 'y'; // the ridge (or the slope / the vault) runs along x or y; empty = along the longer side
  drop?: number | null; // fittings hung this far below a pitched roof, instead of at a fixed height
  mount: number; // height of the fittings
  plane: number; // working plane height
  rc: number;
  rw: number;
  rf: number;
};
/** lumL / lumW: the luminous (lit) area in mm, for glare – defaults by type */
/** photo: the measured curve (IES) – scaled to the lumens typed; empty = the type's model curve · rot: turned 90° */
export type FittingInput = { type: string; watts: number; lumens: number; name?: string; lumL?: number | null; lumW?: number | null; rot?: number; photo?: Photometry | null };

const rectPts = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const okT = (r: RoomInput) => !!(r.cutL && r.cutW && r.cutL < r.length && r.cutW < r.width);

export function outline(r: RoomInput): Pt[] {
  if (r.shape === 'free') return r.points && r.points.length >= 3 ? r.points : [];
  if (r.shape === 'circle') {
    const R = r.length / 2;
    return Array.from({ length: 48 }, (_, i) => ({ x: R + R * Math.cos((i * Math.PI) / 24), y: R + R * Math.sin((i * Math.PI) / 24) }));
  }
  if (r.shape === 't' && okT(r)) {
    const s0 = (r.length - (r.cutL as number)) / 2;
    const s1 = s0 + (r.cutL as number);
    const yb = r.width - (r.cutW as number);
    return [
      { x: s0, y: 0 },
      { x: s1, y: 0 },
      { x: s1, y: yb },
      { x: r.length, y: yb },
      { x: r.length, y: r.width },
      { x: 0, y: r.width },
      { x: 0, y: yb },
      { x: s0, y: yb },
    ];
  }
  if (r.shape === 'u' && okT(r)) {
    const n0 = (r.length - (r.cutL as number)) / 2;
    const n1 = n0 + (r.cutL as number);
    const yb = r.width - (r.cutW as number);
    return [
      { x: 0, y: 0 },
      { x: r.length, y: 0 },
      { x: r.length, y: r.width },
      { x: n1, y: r.width },
      { x: n1, y: yb },
      { x: n0, y: yb },
      { x: n0, y: r.width },
      { x: 0, y: r.width },
    ];
  }
  if (r.shape === 'l' && okT(r)) {
    // the top-right corner cut out
    return [
      { x: 0, y: 0 },
      { x: r.length, y: 0 },
      { x: r.length, y: r.width - (r.cutW as number) },
      { x: r.length - (r.cutL as number), y: r.width - (r.cutW as number) },
      { x: r.length - (r.cutL as number), y: r.width },
      { x: 0, y: r.width },
    ];
  }
  return [
    { x: 0, y: 0 },
    { x: r.length, y: 0 },
    { x: r.length, y: r.width },
    { x: 0, y: r.width },
  ];
}

export const area = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => s + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y, 0)) / 2;
export const perimeter = (p: Pt[]) => p.reduce((s, a, i) => s + Math.hypot(p[(i + 1) % p.length].x - a.x, p[(i + 1) % p.length].y - a.y), 0);
export const bbox = (p: Pt[]) => ({ x0: Math.min(...p.map((a) => a.x)), y0: Math.min(...p.map((a) => a.y)), x1: Math.max(...p.map((a) => a.x)), y1: Math.max(...p.map((a) => a.y)) });

export function inside(pt: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
/** Distance from a point to the outline (for the wall band and keeping fittings off the walls) */
function wallDist(pt: Pt, poly: Pt[]) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy)));
  }
  return d;
}

/** Room index K = 2A / (h·P) – the same as L·W / (h(L+W)) for a rectangle */
export const roomIndex = (A: number, P: number, h: number) => (h > 0 ? (2 * A) / (h * P) : 0);

/** Form factor between two directly opposed parallel rectangles a × b at distance c */
function ffParallel(a: number, b: number, c: number) {
  const X = a / c;
  const Y = b / c;
  const s = (1 + X * X) * (1 + Y * Y) / (1 + X * X + Y * Y);
  return (
    (2 / (Math.PI * X * Y)) *
    (Math.log(Math.sqrt(s)) + X * Math.sqrt(1 + Y * Y) * Math.atan(X / Math.sqrt(1 + Y * Y)) + Y * Math.sqrt(1 + X * X) * Math.atan(Y / Math.sqrt(1 + X * X)) - X * Math.atan(X) - Y * Math.atan(Y))
  );
}

/** L, T and U shapes as rectangles (for an even layout in each part) */
export function rects(r: RoomInput): Pt[][] {
  if (!okT(r)) return [];
  const cL = r.cutL as number;
  const cW = r.cutW as number;
  const yb = r.width - cW;
  if (r.shape === 'l') return [rectPts(0, 0, r.length, yb), rectPts(0, yb, r.length - cL, r.width)];
  if (r.shape === 't') return [rectPts(0, yb, r.length, r.width), rectPts((r.length - cL) / 2, 0, (r.length + cL) / 2, yb)];
  if (r.shape === 'u') return [rectPts(0, 0, r.length, yb), rectPts(0, yb, (r.length - cL) / 2, r.width), rectPts((r.length + cL) / 2, yb, r.length, r.width)];
  return [];
}

/** A drawn plan with square corners as rectangles: horizontal strips, merged where they line up */
export function rectilinear(poly: Pt[]): Pt[][] {
  if (poly.length <= 4) return [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    if (Math.abs(a.x - c.x) > 1e-6 && Math.abs(a.y - c.y) > 1e-6) return []; // a sloping wall
  }
  const ys = [...new Set(poly.map((p) => +p.y.toFixed(4)))].sort((m, n) => m - n);
  const xs = [...new Set(poly.map((p) => +p.x.toFixed(4)))].sort((m, n) => m - n);
  // each strip: the runs of x inside the room
  const strips = ys.slice(0, -1).map((y0, j) => {
    const ym = (y0 + ys[j + 1]) / 2;
    const runs: [number, number][] = [];
    for (let i = 0; i < xs.length - 1; i++) {
      if (!inside({ x: (xs[i] + xs[i + 1]) / 2, y: ym }, poly)) continue;
      const last = runs[runs.length - 1];
      if (last && Math.abs(last[1] - xs[i]) < 1e-9) last[1] = xs[i + 1];
      else runs.push([xs[i], xs[i + 1]]);
    }
    return { y0, y1: ys[j + 1], runs };
  });
  const out: Pt[][] = [];
  let open: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const st of strips) {
    const next: typeof open = [];
    for (const [x0, x1] of st.runs) {
      const same = open.find((o) => Math.abs(o.x0 - x0) < 1e-9 && Math.abs(o.x1 - x1) < 1e-9 && Math.abs(o.y1 - st.y0) < 1e-9);
      if (same) next.push({ ...same, y1: st.y1 });
      else next.push({ x0, x1, y0: st.y0, y1: st.y1 });
    }
    for (const o of open) if (!next.some((q) => q.x0 === o.x0 && q.x1 === o.x1 && q.y0 === o.y0)) out.push(rectPts(o.x0, o.y0, o.x1, o.y1));
    open = next;
  }
  for (const o of open) out.push(rectPts(o.x0, o.y0, o.x1, o.y1));
  return out.length > 1 && out.length <= 12 ? out : [];
}

/** Height of the roof (underside) above the floor at a point – walls at room.height, the roof rising by room.rise */
export function roofAt(room: RoomInput, poly: Pt[]) {
  const roof = room.roof ?? 'flat';
  const rise = Math.max(room.rise ?? 0, 0);
  const h = room.height;
  if (roof === 'flat' || rise <= 0 || poly.length < 3) return () => h;
  const b = bbox(poly);
  const L = b.x1 - b.x0 || 1;
  const W = b.y1 - b.y0 || 1;
  const along = room.ridge ?? (L >= W ? 'x' : 'y');
  // u: 0–1 across the ridge; span: the width across it
  const span = along === 'x' ? W : L;
  const teeth = Math.max(2, Math.round(span / 7));
  return (x: number, y: number) => {
    const u = along === 'x' ? (y - b.y0) / W : (x - b.x0) / L;
    const uu = Math.min(Math.max(u, 0), 1);
    if (roof === 'mono') return h + rise * uu;
    if (roof === 'gable') return h + rise * (1 - Math.abs(2 * uu - 1));
    if (roof === 'barrel') return h + rise * Math.sqrt(Math.max(0, 1 - (2 * uu - 1) ** 2));
    if (roof === 'sawtooth') return h + rise * ((uu * teeth) % 1 || (uu >= 1 ? 1 : 0));
    // hip: the same slope on all sides, up to the ridge
    const dEdge = Math.min(x - b.x0, b.x1 - x, y - b.y0, b.y1 - y);
    return h + rise * Math.min(1, Math.max(dEdge, 0) / (Math.min(L, W) / 2));
  };
}

/** Height of each fitting: fixed, or hung a set distance below a pitched roof */
export function mountAt(room: RoomInput, poly: Pt[]) {
  const z = roofAt(room, poly);
  const hung = (room.roof ?? 'flat') !== 'flat' && room.drop != null && (room.rise ?? 0) > 0;
  return (p: Pt) => (hung ? z(p.x, p.y) - (room.drop as number) : room.mount);
}

/** The model curve of a fitting, or its IES file */
export function photometryOf(fit: FittingInput): Photometry {
  if (fit.photo) return fit.photo;
  const t = FITTING_TYPES.find((x) => x.key === fit.type) ?? FITTING_TYPES[0];
  return modelPhotometry(t.n, t.up, fit.lumens);
}

/** Field arrangement: rows × columns over the room's outline box – evenly spread (half a spacing at the walls), or at
 *  the spacing given from the first fitting's offset; fittings falling outside the outline are left out */
export function fieldLayout(poly: Pt[], o: { nx: number; ny: number; sx?: number | null; sy?: number | null; ox?: number | null; oy?: number | null }): Pt[] {
  if (poly.length < 3 || !(o.nx >= 1) || !(o.ny >= 1)) return [];
  const b = bbox(poly);
  const axis = (n: number, a0: number, a1: number, sp?: number | null, off?: number | null) => {
    const len = a1 - a0;
    const s = sp && sp > 0 ? sp : len / n;
    const first = off != null ? a0 + off : a0 + (len - (n - 1) * s) / 2;
    return Array.from({ length: n }, (_, i) => Math.round((first + i * s) * 1000) / 1000);
  };
  const xs = axis(Math.round(o.nx), b.x0, b.x1, o.sx, o.ox);
  const ys = axis(Math.round(o.ny), b.y0, b.y1, o.sy, o.oy);
  return ys.flatMap((y) => xs.map((x) => ({ x, y }))).filter((p) => inside(p, poly));
}

/** Fitting positions: a grid in proportion to the room, kept inside the outline and away from the walls */
export function autoLayout(poly: Pt[], count: number, room?: RoomInput): Pt[] {
  // L, T and U: split into rectangles, each with its own even grid, the fittings shared by area
  const parts = room && room.shape !== 'free' ? rects(room) : rectilinear(poly);
  if (parts.length > 1) {
    const total = parts.reduce((t, q) => t + area(q), 0);
    const out: Pt[] = [];
    let left = count;
    parts.forEach((q, i) => {
      const n = i === parts.length - 1 ? Math.max(1, left) : Math.max(1, Math.round((count * area(q)) / total));
      left -= n;
      out.push(...autoLayout(q, n));
    });
    return out;
  }
  const b = bbox(poly);
  const L = b.x1 - b.x0;
  const W = b.y1 - b.y0;
  const rect = poly.length === 4 && Math.abs(area(poly) - L * W) < 1e-6;
  if (rect) {
    let best = { r: 1, c: count, err: Infinity };
    for (let r = 1; r <= count; r++) {
      const c = Math.ceil(count / r);
      const err = Math.abs(Math.log(L / c / (W / r))) + (r * c - count) * 0.15;
      if (err < best.err) best = { r, c, err };
    }
    const out: Pt[] = [];
    for (let i = 0; i < best.r; i++) for (let j = 0; j < best.c; j++) out.push({ x: b.x0 + (L / best.c) * (j + 0.5), y: b.y0 + (W / best.r) * (i + 0.5) });
    return out;
  }
  // any other outline: a square grid, made finer until enough positions fall inside; of the grid shifts that fit,
  // the one keeping the fittings furthest from the walls (even light into the corners)
  let s = Math.sqrt(area(poly) / count);
  for (let k = 0; k < 80; k++) {
    let best: Pt[] | null = null;
    let bestScore = -Infinity;
    for (const ox of [0.5, 0.35, 0.65])
      for (const oy of [0.5, 0.35, 0.65]) {
        const pts: Pt[] = [];
        for (let y = b.y0 + s * oy; y < b.y1; y += s) for (let x = b.x0 + s * ox; x < b.x1; x += s) if (inside({ x, y }, poly) && wallDist({ x, y }, poly) >= s * 0.3) pts.push({ x, y });
        if (pts.length < count) continue;
        // coverage: the furthest any spot of the room is from a fitting (smaller = more even light)
        let gap = 0;
        for (let y = b.y0 + s / 4; y < b.y1; y += s / 2)
          for (let x = b.x0 + s / 4; x < b.x1; x += s / 2) {
            if (!inside({ x, y }, poly)) continue;
            let m = Infinity;
            for (const q of pts) m = Math.min(m, Math.hypot(q.x - x, q.y - y));
            gap = Math.max(gap, m);
          }
        const score = -gap - (pts.length - count) * s * 0.25;
        if (score > bestScore) [best, bestScore] = [pts, score];
      }
    if (best) return best;
    s *= 0.97;
  }
  return [];
}

export type CalcResult = {
  A: number;
  P: number;
  K: number;
  grid: { pts: Pt[]; e: number[]; step: number };
  em: number;
  emin: number;
  emax: number;
  uo: number;
  /** Emin / Emax */
  ud: number;
  uf: number;
  watts: number;
  wpm2: number;
  lumensTotal: number;
  /** lux on a regular grid over the room's outline box – for the contours and the 3D view */
  field: Field;
  /** glare at seated observers along the walls, looking across the room (CIE 117) */
  ugr: { max: number | null; points: { x: number; y: number; dx: number; dy: number; ugr: number | null }[] };
};
export type Field = { nx: number; ny: number; x0: number; y0: number; dx: number; dy: number; v: number[] };

/** The calculation: direct light at each grid point plus the bounced light, times the maintenance factor */
export function calculate(room: RoomInput, fit: FittingInput, positions: Lum[], mf: number): CalcResult | null {
  const poly = outline(room);
  if (poly.length < 3) return null;
  const A = area(poly);
  const P = perimeter(poly);
  const mz = mountAt(room, poly);
  const zRoof = roofAt(room, poly);
  const fz = positions.map((f) => f.z ?? mz(f));
  const h = fz.length ? fz.reduce((a, v) => a + v, 0) / fz.length - room.plane : 0; // mean mounting height above the plane
  if (!(A > 0) || !(h > 0) || !(fit.lumens > 0) || !positions.length || fz.some((z) => z <= room.plane)) return null;
  const t = FITTING_TYPES.find((x) => x.key === fit.type) ?? FITTING_TYPES[0];
  const N = positions.length;
  const ph = photometryOf(fit);
  const k = fit.lumens / (ph.flux || fit.lumens); // the curve scaled to the lumens typed
  const rot = fit.rot ?? 0;
  const down = fit.lumens * (1 - ph.up);
  const deg = 180 / Math.PI;
  /** candela from a fitting towards a direction (vx, vy horizontal, vz down) */
  const Ito = (vx: number, vy: number, vz: number, turn: number) => {
    const R = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const g = Math.acos(Math.min(1, Math.max(-1, vz / R))) * deg;
    const c = Math.atan2(vy, vx) * deg - turn;
    return k * ph.I(c, g);
  };
  // EN 12464-1 grid: p = 0.2 × 5^log10(d), with a 0.5 m band at the walls left out (when the room allows)
  const b = bbox(poly);
  const d = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const step = Math.min(Math.max(0.2 * Math.pow(5, Math.log10(d)), 0.15), 10) / (d > 40 ? 1 : 1.5);
  const band = Math.min(b.x1 - b.x0, b.y1 - b.y0) > 3 ? 0.5 : 0;
  const pts: Pt[] = [];
  const allPts: Pt[] = [];
  for (let y = b.y0 + step / 2; y < b.y1; y += step)
    for (let x = b.x0 + step / 2; x < b.x1; x += step) {
      const p = { x, y };
      if (!inside(p, poly)) continue;
      allPts.push(p);
      if (wallDist(p, poly) >= band) pts.push(p);
    }
  const direct = (p: Pt) => {
    let e = 0;
    positions.forEach((f, i) => {
      const hz = fz[i] - room.plane;
      const vx = p.x - f.x;
      const vy = p.y - f.y;
      const r2 = vx * vx + vy * vy + hz * hz;
      e += (Ito(vx, vy, hz, f.rot ?? rot) * hz) / (r2 * Math.sqrt(r2)); // I·cosγ / d²
    });
    return e;
  };
  // the share of the downward light landing on the working plane (whole outline), the rest on the walls
  const cell = step * step;
  const eAll = allPts.map(direct);
  const fWpDirect = Math.min(eAll.reduce((s, e) => s + e, 0) * cell, down * N);
  const fWallDirect = down * N - fWpDirect;
  const fCeilDirect = fit.lumens * ph.up * N;
  // the roof: its area (pitched roofs are larger than the floor) and mean height; the walls up to the roof
  const rs = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 40;
  let Ac = 0;
  let zSum = 0;
  let nIn = 0;
  for (let y = b.y0 + rs / 2; y < b.y1; y += rs)
    for (let x = b.x0 + rs / 2; x < b.x1; x += rs) {
      if (!inside({ x, y }, poly)) continue;
      const z = zRoof(x, y);
      const e2 = 0.02;
      const gx = (zRoof(x + e2, y) - zRoof(x - e2, y)) / (2 * e2);
      const gy = (zRoof(x, y + e2) - zRoof(x, y - e2)) / (2 * e2);
      Ac += Math.sqrt(1 + Math.min(gx * gx + gy * gy, 400)) * rs * rs;
      zSum += z;
      nIn++;
    }
  if (!nIn) Ac = A;
  Ac = Math.max(Ac * (A / Math.max(nIn * rs * rs, 1e-9)), A);
  if (room.roof === 'sawtooth' && (room.rise ?? 0) > 0) {
    const along = room.ridge ?? (b.x1 - b.x0 >= b.y1 - b.y0 ? 'x' : 'y');
    const span = along === 'x' ? b.y1 - b.y0 : b.x1 - b.x0;
    Ac += (room.rise as number) * Math.max(2, Math.round(span / 7)) * (A / span); // the upright glazed faces
  }
  const zMean = nIn ? zSum / nIn : room.height;
  let Aw = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    for (let j = 0; j < 10; j++) {
      const q = (j + 0.5) / 10;
      Aw += Math.max(zRoof(a.x + (c.x - a.x) * q, a.y + (c.y - a.y) * q) - room.plane, 0) * (len / 10);
    }
  }
  // three surfaces of an equivalent rectangle (same area and perimeter): working plane, ceiling (roof), walls
  const Hc = Math.max(zMean - room.plane, 0.05);
  const half = P / 2;
  const disc = Math.max(half * half - 4 * A, 0);
  const l = (half + Math.sqrt(disc)) / 2;
  const w = Math.max(A / l, 0.01);
  const Fpc = Math.min(Math.max(ffParallel(l, w, Hc), 0), 1); // plane → ceiling
  const Fpw = 1 - Fpc;
  const Fcp = (A * Fpc) / Ac;
  const Fcc = 1 - A / Ac; // a pitched roof sees itself
  const Fcw = Math.max(1 - Fcp - Fcc, 0);
  Aw = Math.max(Aw, 1e-6);
  const Fwp = Math.min((A * Fpw) / Aw, 1);
  const Fwc = Math.min((Ac * Fcw) / Aw, 1);
  const Fww = Math.max(1 - Fwp - Fwc, 0);
  // incident flux Φ = Φ⁰ + Σ ρ·Φ·F (iterated to convergence)
  let wp = fWpDirect;
  let ce = fCeilDirect;
  let wa = fWallDirect;
  for (let i = 0; i < 300; i++) {
    const nwp = fWpDirect + room.rc * ce * Fcp + room.rw * wa * Fwp;
    const nce = fCeilDirect + room.rf * wp * Fpc + room.rc * ce * Fcc + room.rw * wa * Fwc;
    const nwa = fWallDirect + room.rf * wp * Fpw + room.rc * ce * Fcw + room.rw * wa * Fww;
    const done = Math.abs(nwp - wp) + Math.abs(nce - ce) + Math.abs(nwa - wa) < 1e-6;
    wp = nwp;
    ce = nce;
    wa = nwa;
    if (done) break;
  }
  const eInd = (wp - fWpDirect) / A;
  // the figures leave out the wall band (EN 12464-1); the picture shows the whole room
  const e = pts.map((p) => (direct(p) + eInd) * mf);
  if (!e.length) return null;
  const eShown = eAll.map((v) => (v + eInd) * mf);
  const em = e.reduce((s, v) => s + v, 0) / e.length;
  const emin = Math.min(...e);
  const emax = Math.max(...e);
  const watts = fit.watts * N;
  // a finer regular grid over the outline box for smooth contours (values outside the room are clipped when drawn)
  const L = b.x1 - b.x0;
  const W = b.y1 - b.y0;
  const cells = Math.min(90, Math.max(30, Math.ceil(Math.max(L, W) / 0.12)));
  const fdx = Math.max(L, W) / cells;
  const nx = Math.max(2, Math.round(L / fdx) + 1);
  const ny = Math.max(2, Math.round(W / fdx) + 1);
  const fv: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) fv.push((direct({ x: b.x0 + (i * L) / (nx - 1), y: b.y0 + (j * W) / (ny - 1) }) + eInd) * mf);
  const field: Field = { nx, ny, x0: b.x0, y0: b.y0, dx: L / (nx - 1), dy: W / (ny - 1), v: fv };
  // UGR (CIE 117): seated eye 1.2 m, at the middle of each wall 0.5 m in, looking across the room; background
  // luminance from the indirect light (initial values – UGR does not depend on the maintenance factor much)
  const tl = t.size;
  const lumA = (Math.max(fit.lumL ?? (ph.lenMm || tl[0]), 10) / 1000) * (Math.max(fit.lumW ?? (ph.widMm || tl[1]), 10) / 1000);
  const eye = 1.2;
  const lb = eInd / Math.PI;
  const ugrPts: CalcResult['ugr']['points'] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    if (len < 2) continue;
    let nxv = -(c.y - a.y) / len;
    let nyv = (c.x - a.x) / len;
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    if (!inside({ x: mid.x + nxv * 0.5, y: mid.y + nyv * 0.5 }, poly)) [nxv, nyv] = [-nxv, -nyv];
    const o = { x: mid.x + nxv * 0.5, y: mid.y + nyv * 0.5 };
    let sum = 0;
    for (const [fi, f] of positions.entries()) {
      const H = fz[fi] - eye;
      if (H <= 0.05) continue;
      const vx = f.x - o.x;
      const vy = f.y - o.y;
      const along = vx * nxv + vy * nyv; // along the line of sight
      if (along <= 0.05) continue; // behind or beside the observer
      const T = Math.abs(vx * nyv - vy * nxv); // lateral
      const R = Math.sqrt(along * along + T * T + H * H);
      const cosG = H / R; // angle at the fitting, from straight down
      const I = Ito(o.x - f.x, o.y - f.y, H, f.rot ?? rot);
      const Ap = lumA * cosG;
      const lum = I / Ap;
      const omega = Ap / (R * R);
      const sigma = (Math.acos(Math.min(1, along / R)) * 180) / Math.PI;
      const tau = (Math.atan2(T, H) * 180) / Math.PI;
      const lnp = (35.2 - 0.31889 * tau - 1.22 * Math.exp((-2 * tau) / 9)) * 1e-3 * sigma + (21 + 0.26667 * tau - 0.002963 * tau * tau) * 1e-5 * sigma * sigma;
      const pIdx = Math.exp(lnp);
      sum += (lum * lum * omega) / (pIdx * pIdx);
    }
    const u = sum > 0 && lb > 0 ? 8 * Math.log10((0.25 / lb) * sum) : null;
    ugrPts.push({ x: o.x, y: o.y, dx: nxv, dy: nyv, ugr: u == null ? null : Math.max(u, 0) });
  }
  const ugrVals = ugrPts.map((q) => q.ugr).filter((v): v is number => v != null);
  return {
    A,
    P,
    K: roomIndex(A, P, h),
    grid: { pts: allPts, e: eShown, step },
    em,
    emin,
    emax,
    uo: em > 0 ? emin / em : 0,
    ud: emax > 0 ? emin / emax : 0,
    field,
    ugr: { max: ugrVals.length ? Math.max(...ugrVals) : null, points: ugrPts },
    uf: wp / (fit.lumens * N),
    watts,
    wpm2: watts / A,
    lumensTotal: fit.lumens * N,
  };
}

/** The fewest fittings that reach the target average (and a uniformity, when given) with the automatic layout */
export function suggestCount(room: RoomInput, fit: FittingInput, mf: number, target: number, uoTarget?: number | null) {
  const poly = outline(room);
  const A = area(poly);
  // first guess from the lumen method with a typical utilisation factor, then step up
  let n = Math.max(1, Math.floor((target * A) / (fit.lumens * 1.05 * mf)));
  for (let k = 0; k < 400; k++) {
    const pos = autoLayout(poly, n, room);
    const r = calculate(room, fit, pos, mf);
    if (r && r.em >= target && (!uoTarget || r.uo >= uoTarget * 0.999)) return { count: pos.length, positions: pos, result: r };
    // uniformity not reachable with this fitting and grid: stop at twice the target and say so on screen
    if (r && r.em >= target * 2) return { count: pos.length, positions: pos, result: r };
    if (pos.length > n) n = pos.length;
    n += 1;
  }
  return null;
}

/** Yearly energy and money: existing against new */
export function savings(o: { oldWatts: number; newWatts: number; hoursPerDay: number; daysPerYear: number; rate: number | null; co2: number | null; cost: number | null }) {
  const hours = o.hoursPerDay * o.daysPerYear;
  const kwhOld = (o.oldWatts * hours) / 1000;
  const kwhNew = (o.newWatts * hours) / 1000;
  const kwh = kwhOld - kwhNew;
  const lkr = o.rate ? kwh * o.rate : null;
  return {
    kwhOld,
    kwhNew,
    kwh,
    pct: kwhOld > 0 ? (kwh / kwhOld) * 100 : null,
    lkr,
    co2t: o.co2 ? (kwh * o.co2) / 1000 : null,
    paybackMonths: o.cost && lkr && lkr > 0 ? (o.cost / lkr) * 12 : null,
  };
}
