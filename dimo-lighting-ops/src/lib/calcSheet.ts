import { DIMO_LOGO_DATA_URI } from './brandLogoData';
import { bbox, FITTING_TYPES, type CalcResult, type FittingInput, type Pt, type RoomInput } from './lightcalc';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Lux scale of the heat-map, as a share of the target */
export const LUX_SCALE = [
  { upTo: 0.6, colour: '#1E3A8A', label: 'below 60%' },
  { upTo: 0.8, colour: '#2563EB', label: '60–80%' },
  { upTo: 1.0, colour: '#10B981', label: '80–100%' },
  { upTo: 1.25, colour: '#FACC15', label: '100–125%' },
  { upTo: Infinity, colour: '#F97316', label: 'above 125%' },
];
const colourOf = (ratio: number) => (LUX_SCALE.find((s) => ratio < s.upTo) ?? LUX_SCALE[LUX_SCALE.length - 1]).colour;

/** The room from above: heat-map of the working plane, the fittings and the dimensions – one SVG for the screen and the PDF */
export function planSvg(poly: Pt[], positions: Pt[], r: CalcResult | null, target: number, widthPx = 640) {
  const b = bbox(poly);
  const L = b.x1 - b.x0 || 1;
  const W = b.y1 - b.y0 || 1;
  const pad = 34;
  const sc = (widthPx - 2 * pad) / L;
  const hPx = W * sc + 2 * pad;
  const X = (x: number) => pad + (x - b.x0) * sc;
  const Y = (y: number) => pad + (b.y1 - y) * sc; // y up
  const cells = r
    ? r.grid.pts
        .map((p, i) => {
          const s = r.grid.step * sc;
          return `<rect x="${(X(p.x) - s / 2).toFixed(1)}" y="${(Y(p.y) - s / 2).toFixed(1)}" width="${(s + 0.6).toFixed(1)}" height="${(s + 0.6).toFixed(1)}" fill="${colourOf(target > 0 ? r.grid.e[i] / target : 1)}" fill-opacity="0.55"/>`;
        })
        .join('')
    : '';
  const outlinePts = poly.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const dots = positions.map((p) => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="5" fill="#fff" stroke="#111" stroke-width="2"/>`).join('');
  const dims = `<text x="${(X(b.x0) + (L * sc) / 2).toFixed(1)}" y="${(Y(b.y0) + 22).toFixed(1)}" font-size="12" text-anchor="middle" fill="#333" font-family="Arial">${L.toFixed(2)} m</text>
<text x="${(X(b.x0) - 20).toFixed(1)}" y="${(Y(b.y0) - (W * sc) / 2).toFixed(1)}" font-size="12" text-anchor="middle" fill="#333" font-family="Arial" transform="rotate(-90 ${(X(b.x0) - 20).toFixed(1)} ${(Y(b.y0) - (W * sc) / 2).toFixed(1)})">${W.toFixed(2)} m</text>`;
  return {
    xml: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${hPx.toFixed(0)}" width="${widthPx}" height="${hPx.toFixed(0)}">
<defs><clipPath id="room"><polygon points="${outlinePts}"/></clipPath></defs>
<rect x="0" y="0" width="${widthPx}" height="${hPx.toFixed(0)}" fill="#fff"/>
<g clip-path="url(#room)">${cells}</g>
<polygon points="${outlinePts}" fill="none" stroke="#111" stroke-width="2.5"/>
${dots}${dims}</svg>`,
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
  savings: { lines: [string, string][] } | null;
  by: string;
};

/** The client sheet: DIMO logo, room plan with the heat-map, results against the standard and the savings – DRAFT */
export function calcSheetHtml(s: SheetInput) {
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric' });
  const plan = planSvg(s.poly, s.positions, s.r, s.target, 660);
  const t = FITTING_TYPES.find((x) => x.key === s.fit.type);
  const ok = (b: boolean) => (b ? '<span style="color:#15803D">✓</span>' : '<span style="color:#B45309">✗</span>');
  const row = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`;
  const legend = LUX_SCALE.map((x) => `<span style="display:inline-block;width:10px;height:10px;background:${x.colour};opacity:.7;margin:0 3px 0 10px"></span>${esc(x.label)}`).join('');
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
<div style="font-size:9px;color:#555;text-align:center;margin-top:2px">Light on the working plane as a share of the target:${legend}</div>
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
${row('Uniformity (Uo)', `${s.r.uo.toFixed(2)}${s.uoTarget ? ` ${ok(s.r.uo >= s.uoTarget)} target ${s.uoTarget}` : ''}`)}
${row('Installed load', `${(s.r.watts / 1000).toFixed(2)} kW · ${s.r.wpm2.toFixed(1)} W/m²${s.lpdLimit ? ` ${ok(s.r.wpm2 <= s.lpdLimit)} SLSEA ${s.lpdLimit} W/m²` : ''}`)}
${s.source ? row('Standard', esc(s.source)) : ''}
</table></div></div>
${s.savings ? `<h2>Energy and savings</h2><table>${s.savings.lines.map(([k, v]) => row(k, esc(v))).join('')}</table>` : ''}
<div class="foot">DRAFT – Indicative calculation: point-by-point on the working plane with interreflections, from the fitting type and the data sheet watts and lumens; an empty room is assumed. Final design by DIMO Lighting Design.<br/>Prepared by ${esc(s.by)} · DIMO Lighting Solutions</div>
</body></html>`;
}
