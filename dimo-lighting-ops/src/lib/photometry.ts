// Light distribution of a fitting for DLux: read from an IES (LM-63) file, or modelled from the fitting type
// (a cosⁿ curve downwards with a share going up). Intensities are in candela for the fitting's full output;
// the calculation scales them to the lumens typed when they differ from the file.

export type Photometry = {
  /** candela at photometric angles C (0–360°, C0 along the fitting's length) and γ (0° straight down, 180° up) */
  I: (c: number, g: number) => number;
  /** luminous flux of the curve, lumens */
  flux: number;
  /** share of the light going up (γ > 90°) */
  up: number;
  /** lit area in mm, from the file (0 when not given) */
  lenMm: number;
  widMm: number;
  source: 'model' | 'ies';
};

export type IesData = {
  keywords: Record<string, string>;
  lumens: number; // from the file: lamps × lumens per lamp, or the integrated curve (absolute photometry)
  watts: number;
  lenMm: number;
  widMm: number;
  vAngles: number[];
  hAngles: number[];
  cd: number[][]; // [h][v]
};

/** Reads an IES LM-63 file (1995 / 2002 / 2019; type C photometry) */
export function parseIes(text: string): IesData {
  const lines = text.replace(/\r/g, '').split('\n');
  const keywords: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    const k = l.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (k) keywords[k[1].toUpperCase()] = keywords[k[1].toUpperCase()] ? `${keywords[k[1].toUpperCase()]} ${k[2]}` : k[2];
    if (/^TILT\s*=/i.test(l)) break;
  }
  if (i >= lines.length) throw new Error('Not an IES file – no TILT line');
  const tilt = lines[i].split('=')[1]?.trim().toUpperCase();
  const nums = lines
    .slice(i + 1)
    .join(' ')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  let p = 0;
  if (tilt === 'INCLUDE') {
    p += 1; // lamp-to-luminaire geometry
    const n = nums[p++];
    p += 2 * n; // tilt angles and factors
  }
  const take = () => {
    const v = nums[p++];
    if (!Number.isFinite(v)) throw new Error('The IES file is incomplete or not readable');
    return v;
  };
  const lamps = take();
  const lmPerLamp = take();
  const mult = take();
  const nv = take();
  const nh = take();
  const type = take();
  const units = take();
  const width = take();
  const length = take();
  take(); // height
  const ballast = take();
  take(); // future use / ballast-lamp factor
  const watts = take();
  if (type !== 1) throw new Error('Only type C photometry is supported (most indoor fittings)');
  const vAngles = Array.from({ length: nv }, take);
  const hAngles = Array.from({ length: nh }, take);
  const f = mult * (ballast || 1);
  const cd = Array.from({ length: nh }, () => Array.from({ length: nv }, () => take() * f));
  const toMm = units === 1 ? 304.8 : 1000;
  const data: IesData = { keywords, lumens: 0, watts, lenMm: Math.abs(length) * toMm, widMm: Math.abs(width) * toMm, vAngles, hAngles, cd };
  // the fitting's output is the light in the curve (for relative photometry the lamp lumens × the light output ratio)
  data.lumens = Math.round(integrate(iesIntensity(data)).flux);
  if (!(data.lumens > 0)) throw new Error(`The IES file has no light in it (${lamps} lamp(s), ${lmPerLamp} lm)`);
  return data;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function locate(arr: number[], v: number) {
  if (v <= arr[0]) return { i: 0, t: 0 };
  const n = arr.length - 1;
  if (v >= arr[n]) return { i: Math.max(n - 1, 0), t: n === 0 ? 0 : 1 };
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= v) lo = m;
    else hi = m;
  }
  return { i: lo, t: (v - arr[lo]) / (arr[lo + 1] - arr[lo] || 1) };
}

/** Intensity from the IES table: symmetry folded, linear between the measured angles */
export function iesIntensity(d: IesData) {
  const h = d.hAngles;
  const last = h[h.length - 1];
  return (c: number, g: number) => {
    if (g < d.vAngles[0] || g > d.vAngles[d.vAngles.length - 1]) return 0;
    let cc = ((c % 360) + 360) % 360;
    if (h.length === 1) cc = 0;
    else if (last <= 90) cc = cc <= 90 ? cc : cc <= 180 ? 180 - cc : cc <= 270 ? cc - 180 : 360 - cc;
    else if (last <= 180) cc = cc <= 180 ? cc : 360 - cc;
    const a = locate(h, cc);
    const b = locate(d.vAngles, g);
    const row = (k: number) => lerp(d.cd[k][b.i] ?? 0, d.cd[k][Math.min(b.i + 1, d.vAngles.length - 1)] ?? 0, b.t);
    return h.length === 1 ? row(0) : lerp(row(a.i), row(Math.min(a.i + 1, h.length - 1)), a.t);
  };
}

/** Flux and upward share by summing the curve over the sphere (2° steps) */
export function integrate(I: (c: number, g: number) => number) {
  const dg = 2;
  const dc = 5;
  let down = 0;
  let upF = 0;
  for (let g = dg / 2; g < 180; g += dg) {
    const band = Math.sin((g * Math.PI) / 180) * ((dg * Math.PI) / 180) * ((dc * Math.PI) / 180);
    let s = 0;
    for (let c = dc / 2; c < 360; c += dc) s += I(c, g);
    if (g < 90) down += s * band;
    else upF += s * band;
  }
  const flux = down + upF;
  return { flux, up: flux > 0 ? upF / flux : 0 };
}

export function iesPhotometry(d: IesData): Photometry {
  const I = iesIntensity(d);
  const { flux, up } = integrate(I);
  return { I, flux, up, lenMm: d.lenMm, widMm: d.widMm, source: 'ies' };
}

/** The modelled curve of a fitting type: cosⁿ downwards, the upward share spread evenly (cos) over the ceiling */
export function modelPhotometry(n: number, up: number, lumens: number): Photometry {
  const down = lumens * (1 - up);
  const I0 = (down * (n + 1)) / (2 * Math.PI);
  const Iu = (lumens * up) / Math.PI;
  return {
    I: (_c, g) => {
      const r = (g * Math.PI) / 180;
      return g <= 90 ? I0 * Math.pow(Math.cos(r), n) : Iu * Math.max(-Math.cos(r), 0);
    },
    flux: lumens,
    up,
    lenMm: 0,
    widMm: 0,
    source: 'model',
  };
}

/** Beam angle (half-peak, C0 plane) – for the summary */
export function beamAngle(p: Photometry) {
  const peak = Math.max(...Array.from({ length: 91 }, (_, g) => p.I(0, g)));
  for (let g = 0; g <= 90; g += 0.5) if (p.I(0, g) < peak / 2) return Math.round(g * 2);
  return 180;
}

/** Polar curve (C0–C180 solid, C90–C270 dashed) as SVG */
export function polarSvg(p: Photometry, size = 220) {
  const r0 = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  let max = 0;
  for (let g = 0; g <= 180; g += 2) max = Math.max(max, p.I(0, g), p.I(90, g), p.I(180, g), p.I(270, g));
  max = max || 1;
  const curve = (c1: number, c2: number) => {
    const pts: string[] = [];
    for (let g = 180; g >= 0; g -= 2) {
      const r = (p.I(c2, g) / max) * r0;
      const a = (g * Math.PI) / 180;
      pts.push(`${(cx - r * Math.sin(a)).toFixed(1)},${(cy + r * Math.cos(a)).toFixed(1)}`);
    }
    for (let g = 0; g <= 180; g += 2) {
      const r = (p.I(c1, g) / max) * r0;
      const a = (g * Math.PI) / 180;
      pts.push(`${(cx + r * Math.sin(a)).toFixed(1)},${(cy + r * Math.cos(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  };
  const rings = [0.25, 0.5, 0.75, 1].map((k) => `<circle cx="${cx}" cy="${cy}" r="${(k * r0).toFixed(1)}" fill="none" stroke="#E5E7EB"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" fill="#fff"/>${rings}
<line x1="${cx}" y1="8" x2="${cx}" y2="${size - 8}" stroke="#E5E7EB"/><line x1="8" y1="${cy}" x2="${size - 8}" y2="${cy}" stroke="#E5E7EB"/>
<polyline points="${curve(0, 180)}" fill="none" stroke="#C8102E" stroke-width="1.8"/>
<polyline points="${curve(90, 270)}" fill="none" stroke="#1D4ED8" stroke-width="1.4" stroke-dasharray="4 3"/>
<text x="6" y="${size - 6}" font-size="10" font-family="Arial" fill="#555">${Math.round(max)} cd max</text>
</svg>`;
}
