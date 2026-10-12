// DLux Road – street lighting to EN 13201: the road is laid out along x, across y (left kerb y = 0, right kerb y = W).
// Illuminance on the carriageway and footpaths on the EN 13201-3 grids, the edge illumination ratio (EIR) and the
// threshold increment (TI) are calculated in full. The average road luminance is estimated from the illuminance with
// the surface's average luminance coefficient q0 – the point luminances (and so luminance uniformity Uo and Ul) need
// the CIE r-table of the surface and are left to the Design team.

import type { Field } from './lightcalc';
import { integrate, type Photometry } from './photometry';

export type RoadArrangement = 'single_left' | 'single_right' | 'opposite' | 'staggered' | 'central';
export const ARRANGEMENTS: { value: RoadArrangement; label: string }[] = [
  { value: 'single_left', label: 'One side (left)' },
  { value: 'single_right', label: 'One side (right)' },
  { value: 'opposite', label: 'Both sides, opposite' },
  { value: 'staggered', label: 'Both sides, staggered' },
  { value: 'central', label: 'Centre (twin arms)' },
];
export type Surface = 'R1' | 'R2' | 'R3' | 'R4';
/** CIE road surface classes and their average luminance coefficient q0 */
export const SURFACES: { value: Surface; label: string; q0: number }[] = [
  { value: 'R1', label: 'R1 – concrete, very light asphalt', q0: 0.1 },
  { value: 'R2', label: 'R2 – mixed / light asphalt', q0: 0.07 },
  { value: 'R3', label: 'R3 – asphalt (most roads)', q0: 0.07 },
  { value: 'R4', label: 'R4 – very smooth, dark asphalt', q0: 0.08 },
];

export type RoadInput = {
  width: number; // carriageway
  lanes: number;
  surface: Surface;
  footL: number; // footpath widths, 0 = none
  footR: number;
  arrangement: RoadArrangement;
  spacing: number; // between poles on the same side
  height: number; // luminaire mounting height
  overhang: number; // luminaire beyond the pole, towards the road
  setback: number; // pole behind the kerb
  tilt: number; // degrees, raised towards the road
  streetSide: 'C90' | 'C270'; // which half of the photometry faces the road
};

export type Lumin = { x: number; y: number; face: 1 | -1 }; // face +1 = towards +y
export type AreaResult = { name: string; y0: number; y1: number; eav: number; emin: number; emax: number; uo: number; ud: number };
export type RoadResult = {
  fieldLen: number;
  carriage: AreaResult;
  footpaths: AreaResult[];
  lav: number; // estimated
  ti: number | null;
  eir: number | null;
  perField: number; // luminaires per field length
  wattsPerKm: number;
  dp: number | null; // power density indicator W / (lx·m²)
  field: Field; // for the picture: two fields long, kerb to kerb with the footpaths
  luminaires: Lumin[];
};

/** A typical road optic (approximate): wide along the road, thrown towards the road, little to the houses, cut off near
 *  the horizontal – for a first idea only; the luminaire's IES file gives the real result */
export function roadModel(lumens: number): Photometry {
  const shape = (c: number, g: number) => {
    if (g >= 80) return 0;
    const cr = (c * Math.PI) / 180;
    const along = Math.cos(cr) ** 2;
    const toRoad = Math.max(Math.sin(cr), 0) ** 2;
    const toHouse = Math.max(-Math.sin(cr), 0) ** 2;
    // a broad base (light under the luminaire) with lobes along the road and a little towards it
    const peak = 65 * along + 35 * toRoad + 15 * toHouse;
    const amp = 1.6 * along + 0.6 * toRoad;
    const lobe = Math.exp(-(((g - peak) / 18) ** 2));
    const base = (1 - 0.6 * toHouse) * Math.cos((Math.min(g, 75) * Math.PI) / 180) ** 0.5;
    return (base + amp * lobe) * (g > 72 ? (80 - g) / 8 : 1);
  };
  const k = lumens / integrate(shape).flux;
  const I = (c: number, g: number) => k * shape(c, g);
  return { I, flux: lumens, up: 0, lenMm: 600, widMm: 250, source: 'model' };
}

/** Luminaire positions from x0 to x1 (all poles that light the field) */
export function luminaires(r: RoadInput, x0: number, x1: number): Lumin[] {
  const out: Lumin[] = [];
  const S = r.spacing;
  const yl = -r.setback + r.overhang;
  const yr = r.width + r.setback - r.overhang;
  for (let k = Math.floor(x0 / S) - 1; k <= Math.ceil(x1 / S) + 1; k++) {
    const x = k * S;
    if (r.arrangement === 'single_left' || r.arrangement === 'opposite' || r.arrangement === 'staggered') out.push({ x, y: yl, face: 1 });
    if (r.arrangement === 'single_right' || r.arrangement === 'opposite') out.push({ x, y: yr, face: -1 });
    if (r.arrangement === 'staggered') out.push({ x: x + S / 2, y: yr, face: -1 });
    if (r.arrangement === 'central') {
      out.push({ x, y: r.width / 2 + r.overhang, face: 1 });
      out.push({ x, y: r.width / 2 - r.overhang, face: -1 });
    }
  }
  return out.filter((l) => l.x >= x0 && l.x <= x1);
}

/** Candela from a luminaire towards a point (dx along, dy across, dz down from the luminaire) */
function intensity(ph: Photometry, k: number, r: RoadInput, l: Lumin, dx: number, dy: number, dz: number) {
  // into the luminaire's frame: x along the road, y towards the road, then the tilt
  const lx = dx * l.face;
  const ly = dy * l.face;
  const t = (r.tilt * Math.PI) / 180;
  const y2 = ly * Math.cos(t) - dz * Math.sin(t);
  const z2 = ly * Math.sin(t) + dz * Math.cos(t);
  const R = Math.sqrt(lx * lx + y2 * y2 + z2 * z2);
  const g = (Math.acos(Math.min(1, Math.max(-1, z2 / R))) * 180) / Math.PI;
  let c = (Math.atan2(y2, lx) * 180) / Math.PI;
  if (r.streetSide === 'C270') c = -c;
  return k * ph.I(c, g);
}

export function roadCalc(r: RoadInput, ph: Photometry, lumens: number, watts: number, mf: number): RoadResult | null {
  const S = r.spacing;
  const H = r.height;
  if (!(S > 0) || !(H > 0) || !(r.width > 0) || !(lumens > 0)) return null;
  const k = lumens / (ph.flux || lumens);
  const lums = luminaires(r, -5 * H - S, 2 * S + 5 * H);
  const E = (x: number, y: number) => {
    let e = 0;
    for (const l of lums) {
      const dx = x - l.x;
      const dy = y - l.y;
      const R2 = dx * dx + dy * dy + H * H;
      e += (intensity(ph, k, r, l, dx, dy, H) * H) / (R2 * Math.sqrt(R2));
    }
    return e * mf;
  };
  // EN 13201-3 grid along: 10 points for fields up to 30 m, else spacing ≤ 3 m
  const N = S <= 30 ? 10 : Math.ceil(S / 3);
  const D = S / N;
  const xs = Array.from({ length: N }, (_, i) => D / 2 + i * D);
  const area = (name: string, y0: number, y1: number): AreaResult => {
    const w = y1 - y0;
    const n = Math.max(3, Math.ceil(w / 1.5));
    const v: number[] = [];
    for (let j = 0; j < n; j++) for (const x of xs) v.push(E(x, y0 + (w / n) * (j + 0.5)));
    const eav = v.reduce((a, b) => a + b, 0) / v.length;
    const emin = Math.min(...v);
    const emax = Math.max(...v);
    return { name, y0, y1, eav, emin, emax, uo: eav > 0 ? emin / eav : 0, ud: emax > 0 ? emin / emax : 0 };
  };
  const carriage = area('Carriageway', 0, r.width);
  const footpaths: AreaResult[] = [];
  if (r.footL > 0) footpaths.push(area('Left footpath', -r.footL, 0));
  if (r.footR > 0) footpaths.push(area('Right footpath', r.width, r.width + r.footR));
  // edge illumination ratio: strips of min(5 m, half the carriageway) outside / inside each kerb
  const sw = Math.min(5, r.width / 2);
  const strip = (y0: number, y1: number) => area('', y0, y1).eav;
  const eir = Math.min(strip(-sw, 0) / Math.max(strip(0, sw), 1e-9), strip(r.width, r.width + sw) / Math.max(strip(r.width - sw, r.width), 1e-9));
  const q0 = SURFACES.find((s) => s.value === r.surface)?.q0 ?? 0.07;
  const lav = carriage.eav * q0;
  // threshold increment: a driver's eye 1.5 m up in the middle of each lane, looking ahead 1° down, from 2.75(H − 1.5)
  // before the field through it; luminaires more than 20° above the line of sight are hidden by the car roof
  let ti: number | null = null;
  if (H > 1.5 && lav > 0) {
    const ahead = luminaires(r, -2.75 * (H - 1.5) - S, S + 500);
    const lanes = Math.max(1, Math.round(r.lanes));
    let lvMax = 0;
    for (let li = 0; li < lanes; li++) {
      const ey = (r.width / lanes) * (li + 0.5);
      for (let step = 0; step <= N; step++) {
        const ex = -2.75 * (H - 1.5) + step * D;
        let lv = 0;
        const sight = [Math.cos(Math.PI / 180), 0, -Math.sin(Math.PI / 180)];
        for (const l of ahead) {
          const vx = l.x - ex;
          const vy = l.y - ey;
          const vz = H - 1.5;
          if (vx <= 0 || vx > 500) continue;
          const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
          const elev = (Math.atan2(vz, Math.hypot(vx, vy)) * 180) / Math.PI;
          if (elev > 20) continue;
          const cosT = (vx * sight[0] + vy * sight[1] + vz * -sight[2]) / d;
          const theta = (Math.acos(Math.min(1, cosT)) * 180) / Math.PI;
          if (theta < 1.5 || theta > 60) continue;
          const I = intensity(ph, k, r, l, -vx, -vy, vz) * mf;
          lv += (I * cosT) / (d * d) / (theta * theta);
        }
        lvMax = Math.max(lvMax, 9.86 * 1.0144 * lv);
      }
    }
    ti = (65 * lvMax) / Math.pow(lav, 0.8);
  }
  const perField = r.arrangement === 'single_left' || r.arrangement === 'single_right' ? 1 : 2;
  const wattsPerKm = (watts * perField * 1000) / S;
  const lit = carriage.eav * r.width * S + footpaths.reduce((a, f) => a + f.eav * (f.y1 - f.y0) * S, 0);
  // the picture: two fields long, across the footpaths too
  const y0 = -Math.max(r.footL, 1);
  const y1 = r.width + Math.max(r.footR, 1);
  const nx = Math.min(120, Math.max(40, Math.ceil((2 * S) / 0.4)));
  const ny = Math.min(50, Math.max(16, Math.ceil((y1 - y0) / 0.3)));
  const v: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v.push(E((2 * S * i) / (nx - 1), y0 + ((y1 - y0) * j) / (ny - 1)));
  return {
    fieldLen: S,
    carriage,
    footpaths,
    lav,
    ti,
    eir: Number.isFinite(eir) ? eir : null,
    perField,
    wattsPerKm,
    dp: lit > 0 ? (watts * perField) / lit : null,
    field: { nx, ny, x0: 0, y0, dx: (2 * S) / (nx - 1), dy: (y1 - y0) / (ny - 1), v },
    luminaires: luminaires(r, 0, 2 * S),
  };
}

export type RoadClass = { cls: string; val: number; uo: number | null; ul: number | null; ti: number | null; rei: number | null; emin: number | null };

/** Does the carriageway meet the class? Luminance classes on the estimated average luminance */
export function checkClass(res: RoadResult, c: RoadClass | null, area: AreaResult = res.carriage) {
  if (!c) return null;
  const m = c.cls.startsWith('M');
  const avgOk = m ? res.lav >= c.val : area.eav >= c.val;
  const uoOk = m || c.uo == null ? true : area.uo >= c.uo;
  const minOk = c.emin == null ? true : area.emin >= c.emin;
  const tiOk = !m || c.ti == null || res.ti == null ? true : res.ti <= c.ti;
  const eirOk = !m || c.rei == null || res.eir == null ? true : res.eir >= c.rei;
  return { ok: avgOk && uoOk && minOk && tiOk && eirOk, avgOk, uoOk, minOk, tiOk, eirOk };
}

/** The largest pole spacing (0.5 m steps) that still meets the class */
export function maxSpacing(r: RoadInput, ph: Photometry, lumens: number, watts: number, mf: number, c: RoadClass) {
  for (let s = Math.min(80, Math.round(r.height * 6)); s >= 5; s -= 0.5) {
    const res = roadCalc({ ...r, spacing: s }, ph, lumens, watts, mf);
    if (res && checkClass(res, c)?.ok) return s;
  }
  return null;
}
