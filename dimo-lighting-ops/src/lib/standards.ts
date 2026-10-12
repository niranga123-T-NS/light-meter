import { DIMO_LOGO_DATA_URI } from './brandLogoData';
import { esc } from './export';
import type { Role } from './types';

export type StdGroup = 'indoor' | 'outdoor' | 'road' | 'sports' | 'emergency' | 'energy';
export type StdGroupRow = { grp: StdGroup; title: string; source: string; sort: number; reviewed_at: string | null; reviewed_by: string | null; note: string | null };
export type Standard = {
  id: string;
  grp: StdGroup;
  category: string;
  space: string;
  ref: string | null;
  vals: Record<string, number | string | null>;
  notes: string | null;
  sort: number;
  active: boolean;
  updated_by: string | null;
  updated_at: string;
};
type Col = { key: string; label: string; unit?: string; text?: boolean; explain?: (v: string) => string };

/** The values shown for each group, in order – with a plain-words explanation for the detail page and the share sheet */
export const STD_COLS: Record<StdGroup, Col[]> = {
  indoor: [
    { key: 'em', label: 'Em', unit: 'lx', explain: (v) => `Maintained average illuminance on the task area: at least ${v} lux` },
    { key: 'uo', label: 'Uo', explain: (v) => `Uniformity: the darkest point at least ${Math.round(Number(v) * 100)}% of the average` },
    { key: 'ugr', label: 'UGR', explain: (v) => `Discomfort glare limit: UGR ${v} or lower` },
    { key: 'ra', label: 'Ra', explain: (v) => `Colour rendering index: Ra ${v} or higher` },
  ],
  outdoor: [
    { key: 'em', label: 'Em', unit: 'lx', explain: (v) => `Maintained average illuminance: at least ${v} lux` },
    { key: 'uo', label: 'Uo', explain: (v) => `Uniformity: the darkest point at least ${Math.round(Number(v) * 100)}% of the average` },
    { key: 'gr', label: 'RG', explain: (v) => `Glare rating limit: RG ${v} or lower` },
    { key: 'ra', label: 'Ra', explain: (v) => `Colour rendering index: Ra ${v} or higher` },
  ],
  road: [
    { key: 'cls', label: 'Class', text: true },
    { key: 'val', label: 'L / E', explain: (v) => `Average maintained luminance (cd/m²) or illuminance (lux): ${v}` },
    { key: 'uo', label: 'Uo', explain: (v) => `Overall uniformity at least ${v}` },
    { key: 'ul', label: 'Ul', explain: (v) => `Longitudinal uniformity at least ${v}` },
    { key: 'ti', label: 'fTI %', explain: (v) => `Threshold increment (disability glare) ${v}% or lower` },
    { key: 'rei', label: 'REI', explain: (v) => `Edge illumination ratio at least ${v}` },
    { key: 'emin', label: 'Emin', unit: 'lx', explain: (v) => `Minimum maintained illuminance at least ${v} lux` },
  ],
  sports: [
    { key: 'cls', label: 'Class', text: true, explain: (v) => (v === 'I' ? 'Class I: top-level national and international competition' : v === 'II' ? 'Class II: mid-level competition, regional and local clubs' : 'Class III: training, school sport and recreation') },
    { key: 'em', label: 'Em', unit: 'lx', explain: (v) => `Average horizontal illuminance: at least ${v} lux` },
    { key: 'uo', label: 'Uo', explain: (v) => `Uniformity Emin / Em at least ${v}` },
    { key: 'ra', label: 'Ra', explain: (v) => `Colour rendering index: Ra ${v} or higher` },
  ],
  emergency: [
    { key: 'em', label: 'Emin', unit: 'lx', explain: (v) => `Minimum illuminance: at least ${v} lux` },
    { key: 'ratio', label: 'Max : min', text: true, explain: (v) => `Uniformity (maximum to minimum) no more than ${v}` },
    { key: 'dur', label: 'Duration', text: true, explain: (v) => `Duration: ${v}` },
    { key: 'resp', label: 'Response', text: true, explain: (v) => `Response time: ${v}` },
  ],
  energy: [{ key: 'lpd', label: 'Max LPD', unit: 'W/m²', explain: (v) => `Maximum lighting power density: ${v} W/m²` }],
};

/** Who opens Sales Tools, and who keeps the standards */
export const TOOLS_ROLES: Role[] = ['asm_building', 'asm_infra', 'sm_projects', 'gm', 'design_manager', 'lighting_designer', 'lighting_engineer', 'sys_admin'];
export const STD_EDITORS: Role[] = ['design_manager', 'sys_admin'];

export const stdVal = (s: Standard, c: Col) => {
  const v = s.vals?.[c.key];
  return v === null || v === undefined || v === '' ? '—' : String(v);
};

/** One-page "recommended lighting" sheet for a client: DIMO logo, the values in plain words, the source – marked DRAFT */
export function standardSheetHtml(s: Standard, g: StdGroupRow, by: string) {
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric' });
  const rows = STD_COLS[s.grp]
    .filter((c) => s.vals?.[c.key] !== null && s.vals?.[c.key] !== undefined && s.vals?.[c.key] !== '')
    .map((c) => {
      const v = String(s.vals[c.key]);
      return `<tr><td class="k">${esc(c.label)}</td><td class="v">${esc(v)}${c.unit ? ` ${esc(c.unit)}` : ''}</td><td>${esc(c.explain ? c.explain(v) : '')}</td></tr>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { size: A4 portrait; margin: 18mm 16mm; }
  body { font: 11px Arial, Helvetica, sans-serif; color: #111; }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #C8102E; padding-bottom: 8px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0; } .sub { color: #555; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  td { padding: 8px 6px; border-bottom: 1px solid #E3E3E3; vertical-align: top; }
  td.k { width: 70px; font-weight: bold; } td.v { width: 110px; font-size: 15px; font-weight: bold; color: #C8102E; }
  .note { background: #F7F7F7; padding: 10px; margin-top: 14px; }
  .wm { position: fixed; top: 40%; left: 0; width: 100%; text-align: center; transform: rotate(-30deg);
        font: bold 64px Arial; color: rgba(200,16,46,0.10); z-index: 0; }
  .foot { margin-top: 26px; font-size: 9px; color: #555; border-top: 1px solid #ddd; padding-top: 8px; }
</style></head><body>
<div class="wm">DRAFT – for discussion only</div>
<header><img src="${DIMO_LOGO_DATA_URI}" alt="DIMO" style="height:44px;width:auto" />
<div><h1>Recommended lighting – ${esc(s.space)}</h1><div class="sub">${esc(g.title)} · ${esc(s.category)} · ${esc(g.source)}</div></div></header>
<table>${rows}</table>
${s.notes ? `<div class="note"><b>Notes:</b> ${esc(s.notes)}</div>` : ''}
<div class="foot">
  DRAFT – for discussion only. Indicative values from ${esc(g.source)}${s.ref ? ` (${esc(s.ref)})` : ''}. Final design by DIMO Lighting Design.<br/>
  Prepared by ${esc(by)} · DIMO Lighting Solutions · ${esc(now)}
</div>
</body></html>`;
}
