// Quick lighting calculation (Sales Tools): point-by-point direct illuminance on the working plane plus the light
// bounced between the working plane, walls and ceiling (three-surface radiosity), times the maintenance factor.
// Fittings are described by type (a cosⁿ intensity curve and an upward share) with the watts and lumens from the
// data sheet – once Catalogs hold IES / LDT files the same engine takes the measured curve instead.

export type Pt = { x: number; y: number };

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

export type Shape = 'rect' | 'l' | 'free';
export type RoomInput = {
  shape: Shape;
  length: number; // rect / L: overall length (x)
  width: number; // rect / L: overall width (y)
  cutL?: number; // L: the cut-out corner (x)
  cutW?: number; // L: the cut-out corner (y)
  points?: Pt[]; // free outline
  height: number; // ceiling height
  mount: number; // height of the fittings
  plane: number; // working plane height
  rc: number;
  rw: number;
  rf: number;
};
/** lumL / lumW: the luminous (lit) area in mm, for glare – defaults by type */
export type FittingInput = { type: string; watts: number; lumens: number; name?: string; lumL?: number | null; lumW?: number | null };

export function outline(r: RoomInput): Pt[] {
  if (r.shape === 'free' && r.points && r.points.length >= 3) return r.points;
  if (r.shape === 'l' && r.cutL && r.cutW && r.cutL < r.length && r.cutW < r.width) {
    // the top-right corner cut out
    return [
      { x: 0, y: 0 },
      { x: r.length, y: 0 },
      { x: r.length, y: r.width - r.cutW },
      { x: r.length - r.cutL, y: r.width - r.cutW },
      { x: r.length - r.cutL, y: r.width },
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

/** Fitting positions: a grid in proportion to the room, kept inside the outline and away from the walls */
export function autoLayout(poly: Pt[], count: number, room?: RoomInput): Pt[] {
  // an L: two rectangles, each with its own even grid, the fittings shared by area
  if (room?.shape === 'l' && room.cutL && room.cutW && room.cutL < room.length && room.cutW < room.width) {
    const a: Pt[] = [{ x: 0, y: 0 }, { x: room.length, y: 0 }, { x: room.length, y: room.width - room.cutW }, { x: 0, y: room.width - room.cutW }];
    const bx = room.length - room.cutL;
    const c: Pt[] = [{ x: 0, y: room.width - room.cutW }, { x: bx, y: room.width - room.cutW }, { x: bx, y: room.width }, { x: 0, y: room.width }];
    const na = Math.max(1, Math.round((count * area(a)) / (area(a) + area(c))));
    return [...autoLayout(a, na), ...autoLayout(c, Math.max(1, count - na))];
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
export function calculate(room: RoomInput, fit: FittingInput, positions: Pt[], mf: number): CalcResult | null {
  const poly = outline(room);
  const A = area(poly);
  const P = perimeter(poly);
  const h = room.mount - room.plane;
  if (!(A > 0) || !(h > 0) || !(fit.lumens > 0) || !positions.length) return null;
  const t = FITTING_TYPES.find((x) => x.key === fit.type) ?? FITTING_TYPES[0];
  const N = positions.length;
  const down = fit.lumens * (1 - t.up);
  const I0 = (down * (t.n + 1)) / (2 * Math.PI); // cd at nadir, cosⁿ curve
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
    for (const f of positions) {
      const r2 = (p.x - f.x) ** 2 + (p.y - f.y) ** 2 + h * h;
      const cos = h / Math.sqrt(r2);
      e += (I0 * Math.pow(cos, t.n + 3)) / (h * h);
    }
    return e;
  };
  // the share of the downward light landing on the working plane (whole outline), the rest on the walls
  const cell = step * step;
  const eAll = allPts.map(direct);
  const fWpDirect = Math.min(eAll.reduce((s, e) => s + e, 0) * cell, down * N);
  const fWallDirect = down * N - fWpDirect;
  const fCeilDirect = fit.lumens * t.up * N;
  // three surfaces of an equivalent rectangle (same area and perimeter): working plane, ceiling, walls
  const half = P / 2;
  const disc = Math.max(half * half - 4 * A, 0);
  const l = (half + Math.sqrt(disc)) / 2;
  const w = Math.max(A / l, 0.01);
  const Fwc = Math.min(Math.max(ffParallel(l, w, h), 0), 1);
  const Aw = P * h;
  const Fww = Math.max(1 - (2 * A * (1 - Fwc)) / Aw, 0); // walls to walls
  const Fwall = (A * (1 - Fwc)) / Aw; // walls to plane = walls to ceiling
  // incident flux Φ = Φ⁰ + Σ ρ·Φ·F (iterated to convergence)
  let wp = fWpDirect;
  let ce = fCeilDirect;
  let wa = fWallDirect;
  for (let i = 0; i < 200; i++) {
    const nwp = fWpDirect + room.rc * ce * Fwc + room.rw * wa * Fwall;
    const nce = fCeilDirect + room.rf * wp * Fwc + room.rw * wa * Fwall;
    const nwa = fWallDirect + room.rf * wp * (1 - Fwc) + room.rc * ce * (1 - Fwc) + room.rw * wa * Fww;
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
  const lumA = (Math.max(fit.lumL ?? tl[0], 10) / 1000) * (Math.max(fit.lumW ?? tl[1], 10) / 1000);
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
    for (const f of positions) {
      const H = room.mount - eye;
      if (H <= 0.05) continue;
      const vx = f.x - o.x;
      const vy = f.y - o.y;
      const along = vx * nxv + vy * nyv; // along the line of sight
      if (along <= 0.05) continue; // behind or beside the observer
      const T = Math.abs(vx * nyv - vy * nxv); // lateral
      const R = Math.sqrt(along * along + T * T + H * H);
      const cosG = H / R; // angle at the fitting, from straight down
      const I = I0 * Math.pow(cosG, t.n);
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
