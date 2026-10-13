import { LightSensor } from 'expo-sensors';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { DIMO_LOGO_DATA_URI } from './brandLogoData';
import { colourAt } from './calcSheet';
import { esc } from './export';

export type Reading = { r: number; c: number; lux: number };
export type LuxSurvey = {
  id: string;
  code: string | null;
  title: string;
  project_id: string | null;
  kind: 'spot' | 'grid';
  phase: 'before' | 'after' | 'check';
  std_id: string | null;
  target: number | null;
  uo_target: number | null;
  rows: number | null;
  cols: number | null;
  length: number | null;
  width: number | null;
  plane: number | null;
  readings: Reading[];
  stats: Stats;
  factor: number | null;
  device: string | null;
  calibrated_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
};
export type Stats = { n?: number; eav?: number; emin?: number; emax?: number; uo?: number; ud?: number };
export type Calibration = { id: string; device: string; factor: number; reference: string; ref_lux: number; phone_lux: number; created_at: string };

export const PHASES = [
  { value: 'before', label: 'Before (existing lighting)' },
  { value: 'after', label: 'After (new lighting)' },
  { value: 'check', label: 'Check' },
] as const;
/** A calibration older than this is asked to be done again */
export const CAL_DAYS = 180;

/** The phone, for its calibration: maker and model as Android reports them */
export function deviceName() {
  const c = (Platform.constants ?? {}) as { Manufacturer?: string; Model?: string; Brand?: string };
  return [c.Manufacturer ?? c.Brand, c.Model].filter(Boolean).join(' ') || `${Platform.OS} phone`;
}

/** Live readings from the phone's light sensor (Android only). raw: the median of the last readings, to steady it;
 *  settled: the reading once it has stayed within ±5% for about two seconds (kept until the light changes again). */
export function useLightSensor(enabled: boolean) {
  const [raw, setRaw] = useState<number | null>(null);
  const [settled, setSettled] = useState<number | null>(null);
  const [steady, setSteady] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(Platform.OS === 'android' ? null : false);
  // min / max of the uncorrected readings since tracking started (null = not tracking)
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  const [tracking, setTracking] = useState(false);
  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') return;
    let alive = true;
    let sub: { remove: () => void } | null = null;
    const buf: number[] = [];
    LightSensor.isAvailableAsync()
      .then((ok) => {
        if (!alive) return;
        setAvailable(ok);
        if (!ok) return;
        LightSensor.setUpdateInterval(200);
        sub = LightSensor.addListener((m) => {
          buf.push(m.illuminance);
          if (buf.length > 10) buf.shift();
          const sorted = [...buf].sort((x, y) => x - y);
          const med = sorted[Math.floor(sorted.length / 2)];
          const spread = (sorted[sorted.length - 1] - sorted[0]) / Math.max(med, 1);
          const isSteady = buf.length >= 10 && spread < 0.1;
          setRaw(med);
          setSteady(isSteady);
          if (isSteady) setSettled(med);
          setRange((g) => (g ? { min: Math.min(g.min, m.illuminance), max: Math.max(g.max, m.illuminance) } : g));
        });
      })
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [enabled]);
  const track = () => {
    setTracking(true);
    setRange(raw != null ? { min: raw, max: raw } : { min: Infinity, max: -Infinity });
  };
  return { available, raw, steady, settled, range: tracking ? range : null, track };
}

/** The dial: a logarithmic lux scale (1 to 100 000 lx) with coloured bands and the needle at the reading */
export function luxGaugeSvg(lux: number | null, size = 300) {
  const W = size;
  const R = W / 2 - 18;
  const cx = W / 2;
  const cy = R + 16;
  const H = Math.round(cy + R * 0.35 + 14);
  const a0 = -200;
  const a1 = 20; // degrees, measured from the positive x axis (counter-clockwise from the left)
  const pos = (v: number) => Math.min(Math.max(Math.log10(Math.max(v, 1)) / 5, 0), 1);
  const ang = (t: number) => ((a0 + (a1 - a0) * t) * Math.PI) / 180;
  const pt = (t: number, r: number) => ({ x: cx + r * Math.cos(ang(t)), y: cy + r * Math.sin(ang(t)) });
  const arc = (t0: number, t1: number, r: number) => {
    const p0 = pt(t0, r);
    const p1 = pt(t1, r);
    return `M${p0.x.toFixed(1)},${p0.y.toFixed(1)} A${r},${r} 0 ${(t1 - t0) * (a1 - a0) > 180 ? 1 : 0} 1 ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
  };
  const bands: [number, number, string][] = [
    [1, 50, '#1E3A8A'],
    [50, 200, '#2563EB'],
    [200, 750, '#16A34A'],
    [750, 2000, '#CA8A04'],
    [2000, 10000, '#EA580C'],
    [10000, 100000, '#DC2626'],
  ];
  const bandSvg = bands.map(([v0, v1, c]) => `<path d="${arc(pos(v0), pos(v1), R)}" stroke="${c}" stroke-width="12" fill="none"/>`).join('');
  let ticks = '';
  for (let d = 0; d < 5; d++)
    for (let m = 1; m < 10; m++) {
      const v = m * 10 ** d;
      const t = pos(v);
      const major = m === 1;
      const p0 = pt(t, R - 9);
      const p1 = pt(t, R - (major ? 24 : 15));
      ticks += `<line x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" stroke="#334155" stroke-width="${major ? 2 : 1}"/>`;
    }
  const labels = [1, 10, 100, 1000, 10000, 100000]
    .map((v) => {
      const p = pt(pos(v), R - 38);
      return `<text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" font-size="${Math.round(size / 26)}" font-family="Arial" font-weight="700" fill="#334155" text-anchor="middle">${v >= 1000 ? `${v / 1000}k` : v}</text>`;
    })
    .join('');
  const needle = lux != null ? (() => {
    const tip = pt(pos(lux), R - 6);
    return `<line x1="${cx}" y1="${cy}" x2="${tip.x.toFixed(1)}" y2="${tip.y.toFixed(1)}" stroke="#C8102E" stroke-width="3.5" stroke-linecap="round"/>`;
  })() : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${bandSvg}${ticks}${labels}${needle}<circle cx="${cx}" cy="${cy}" r="8" fill="#111"/><text x="${cx}" y="${cy - R * 0.42}" font-size="${Math.round(size / 22)}" font-family="Arial" fill="#64748B" text-anchor="middle">lux</text></svg>`;
}

/** Colour of the final digits by light level: dim, office, bright, daylight */
export const levelColour = (lux: number) => (lux < 50 ? '#60A5FA' : lux < 200 ? '#38BDF8' : lux < 750 ? '#4ADE80' : lux < 2000 ? '#FACC15' : lux < 10000 ? '#FB923C' : '#F87171');
export const levelLabel = (lux: number) => (lux < 50 ? 'Dim' : lux < 200 ? 'Low – corridors, stores' : lux < 750 ? 'Good for offices and classrooms' : lux < 2000 ? 'Bright – detailed tasks' : lux < 10000 ? 'Very bright' : 'Daylight');

export function surveyStats(readings: Reading[]): Stats {
  const v = readings.map((x) => x.lux).filter((x) => Number.isFinite(x));
  if (!v.length) return {};
  const eav = v.reduce((a, b) => a + b, 0) / v.length;
  const emin = Math.min(...v);
  const emax = Math.max(...v);
  return { n: v.length, eav: Math.round(eav * 10) / 10, emin, emax, uo: eav > 0 ? Math.round((emin / eav) * 100) / 100 : 0, ud: emax > 0 ? Math.round((emin / emax) * 100) / 100 : 0 };
}

/** Colour of a reading on the min–max scale of the survey */
export function luxColour(lux: number, min: number, max: number) {
  return colourAt(max > min ? (lux - min) / (max - min) : 0.5, 'rainbow');
}

/** The survey sheet for the client: the grid of readings in colour, the figures against the target – DIMO branded */
export function luxSurveyHtml(s: LuxSurvey, std: string | null, by: string) {
  const st = s.stats;
  const date = new Date(s.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric' });
  const ok = (b: boolean) => (b ? '<span style="color:#15803D">✓</span>' : '<span style="color:#B45309">✗</span>');
  const row = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`;
  let grid = '';
  if (s.kind === 'grid' && s.rows && s.cols) {
    const cells: string[] = [];
    for (let r = 0; r < s.rows; r++) {
      const tds: string[] = [];
      for (let c = 0; c < s.cols; c++) {
        const x = s.readings.find((q) => q.r === r && q.c === c);
        tds.push(x ? `<td style="background:${luxColour(x.lux, st.emin ?? 0, st.emax ?? 1)};color:#111;font-weight:700">${Math.round(x.lux)}</td>` : '<td style="color:#999">—</td>');
      }
      cells.push(`<tr>${tds.join('')}</tr>`);
    }
    grid = `<h2>Readings (lux) – ${s.rows} × ${s.cols} points${s.length && s.width ? ` over ${s.length} × ${s.width} m` : ''}</h2><table class="grid">${cells.join('')}</table>`;
  }
  const phase = s.phase === 'before' ? 'Before – existing lighting' : s.phase === 'after' ? 'After – new lighting' : 'Lighting check';
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { size: A4 portrait; margin: 14mm; }
  body { font: 11px Arial, Helvetica, sans-serif; color: #111; }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #C8102E; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 17px; margin: 0; } h2 { font-size: 12px; margin: 14px 0 6px; } .sub { color: #555; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; } td { padding: 5px 6px; border-bottom: 1px solid #E5E5E5; } td.k { width: 45%; color: #444; }
  table.grid td { border: 1px solid #fff; text-align: center; padding: 10px 2px; font-size: 12px; }
  .foot { margin-top: 16px; font-size: 8.5px; color: #555; border-top: 1px solid #ddd; padding-top: 6px; }
</style></head><body>
<header><img src="${DIMO_LOGO_DATA_URI}" alt="DIMO" style="height:42px;width:auto" />
<div><h1>${esc(s.title)}</h1><div class="sub">Light level survey · ${esc(phase)}${s.code ? ` · ${esc(s.code)}` : ''} · ${esc(date)}</div></div></header>
<table>
${row('Average illuminance', st.eav != null ? `<b>${Math.round(st.eav)} lx</b>${s.target ? ` ${ok(st.eav >= s.target)} target ${s.target} lx` : ''}` : '—')}
${row('Minimum · maximum', st.emin != null ? `${Math.round(st.emin)} lx · ${Math.round(st.emax ?? 0)} lx` : '—')}
${s.kind === 'grid' ? row('Uniformity Uo = Emin / Eav', st.uo != null ? `${st.uo.toFixed(2)}${s.uo_target ? ` ${ok(st.uo >= s.uo_target)} target ${s.uo_target}` : ''}` : '—') : ''}
${std ? row('Recommendation', esc(std)) : ''}
${s.plane != null ? row('Measured at', `${s.plane} m above the floor`) : ''}
${row('Points measured', String(st.n ?? s.readings.length))}
</table>
${grid}
${s.notes ? `<h2>Notes</h2><p>${esc(s.notes)}</p>` : ''}
<div class="foot">Measured with a phone light sensor calibrated against ${s.factor ? 'a reference lux meter' : '—'}${s.device ? ` (${esc(s.device)})` : ''} – indicative; a calibrated lux meter is used for acceptance tests.<br/>Prepared by ${esc(by)} · DIMO Lighting Solutions</div>
</body></html>`;
}
