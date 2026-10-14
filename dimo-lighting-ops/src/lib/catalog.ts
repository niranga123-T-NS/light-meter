import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { DIMO_LOGO_DATA_URI } from './brandLogoData';
import { esc } from './export';
import { deliver } from './hseFill';
import { beamAngle, type Photometry } from './photometry';
import { callFunction, supabase } from './supabase';
import { watermarkPdf } from './watermark';
import type { Role } from './types';

/** Who keeps the catalogues, luminaires and the IES library */
export const CATALOG_KEEPERS: Role[] = ['design_manager', 'lighting_designer', 'lighting_engineer', 'sm_projects', 'gm', 'sys_admin'];

export type Brand = { id: number; name: string; manufacturer: string | null; country: string | null; origin: string; level: string; active: boolean };
export type BrandCatalog = { brand_id: number; website: string | null; catalogue_url: string | null; downloads_url: string | null; notes: string | null; updated_at: string };
export type CatalogFile = { id: string; brand_id: number | null; title: string; kind: string; storage_path: string | null; file_name: string | null; size_bytes: number | null; source_url: string | null; year: number | null; created_at: string };
export type Luminaire = {
  id: string;
  brand_id: number | null;
  name: string;
  code: string | null;
  family: string;
  fitting_type: string;
  watts: number | null;
  lumens: number | null;
  cct: number | null;
  cri: number | null;
  ip: string | null;
  ik: string | null;
  ugr: number | null;
  beam: number | null;
  lit_l: number | null;
  lit_w: number | null;
  ies_id: string | null;
  datasheet_path: string | null;
  datasheet_name: string | null;
  datasheet_url: string | null;
  stock: 'in' | 'out' | null;
  sample: boolean;
  notes: string | null;
  active: boolean;
};
export const LUM_FAMILIES = ['Panel', 'Downlight', 'Linear / batten', 'Track / spot', 'High-bay', 'Floodlight', 'Street light', 'Wall / bulkhead', 'Outdoor / landscape', 'Emergency', 'Other'];
export const FILE_KINDS = [
  { value: 'catalogue', label: 'Catalogue' },
  { value: 'brochure', label: 'Brochure' },
  { value: 'price_list', label: 'Price list' },
  { value: 'other', label: 'Other' },
];

export const mb = (b: number | null) => (b ? `${(b / 1048576).toFixed(b > 10485760 ? 0 : 1)} MB` : '');
export const efficacy = (l: Pick<Luminaire, 'watts' | 'lumens'>) => (l.watts && l.lumens ? Math.round(l.lumens / l.watts) : null);

/** Opens a link on the manufacturer's site (a new tab on the web) */
export async function openLink(url: string) {
  const u = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  if (Platform.OS === 'web') window.open(u, '_blank', 'noopener');
  else await Linking.openURL(u);
}

/** Opens a stored catalogue or data sheet */
export async function openCatalogFile(path: string, fileName: string) {
  const { data, error } = await supabase.storage.from('catalog').createSignedUrl(path, 600, { download: Platform.OS === 'web' ? undefined : fileName });
  if (error) throw new Error(error.message);
  await openLink(data.signedUrl);
}

/** Where a catalogue or data sheet PDF comes from: a stored copy, or read now from the manufacturer's link (kept nowhere) */
export type PdfSource = { path: string } | { file_id: string } | { luminaire_id: string };
export type PdfDoc = { id: string; title: string; source: PdfSource; link: string | null; fileName: string };
export const fileDoc = (f: CatalogFile): PdfDoc => ({ id: f.id, title: f.title, source: f.storage_path ? { path: f.storage_path } : { file_id: f.id }, link: f.source_url, fileName: f.file_name ?? `${f.title}.pdf` });
export const sheetDoc = (l: Luminaire): PdfDoc | null =>
  l.datasheet_path || l.datasheet_url
    ? { id: l.id, title: `${l.name} data sheet`, source: l.datasheet_path ? { path: l.datasheet_path } : { luminaire_id: l.id }, link: l.datasheet_url, fileName: l.datasheet_name ?? 'datasheet.pdf' }
    : null;

/** The PDF's bytes: a stored copy from the bucket, a linked one through the server from the manufacturer's site */
export async function pdfBytes(src: PdfSource) {
  if ('path' in src) {
    const { data, error } = await supabase.storage.from('catalog').download(src.path);
    if (error || !data) throw new Error(error?.message ?? 'File not found');
    return new Uint8Array(await data.arrayBuffer());
  }
  const blob = await callFunction<Blob>('catalog-fetch', { action: 'pdf', ...src } as Record<string, unknown>);
  return new Uint8Array(await (blob as Blob).arrayBuffer());
}

/** Checks a manufacturer's link gives a PDF (nothing is downloaded or kept) */
export const checkPdfLink = (url: string) => callFunction<{ file_name: string; final_url: string; size: number | null }>('catalog-fetch', { action: 'check', url: url.trim() });

/** The PDF with the DIMO watermark on every page: a light diagonal mark and a footer line naming who shared it */
export async function shareWatermarked(src: PdfSource, title: string, by: string) {
  const bytes = await watermarkPdf(await pdfBytes(src), by);
  await deliver(bytes, `${title} - DIMO`, 'catalog_share', title);
}

/** Removes the stored copy of a file that came from a link; the link stays and the viewer reads it from there */
export async function dropStoredCopy(path: string, row: { table: 'catalog_files' | 'luminaires'; id: string }) {
  const { error } = await supabase.from(row.table).update(row.table === 'catalog_files' ? { storage_path: null, size_bytes: null } : { datasheet_path: null }).eq('id', row.id);
  if (error) throw new Error(error.message);
  const rm = await supabase.storage.from('catalog').remove([path]);
  if (rm.error) throw new Error(`The link is kept, but the stored copy could not be removed: ${rm.error.message}`);
}

/** DIMO data sheet for a luminaire: the specification, the light distribution and the source – shared as a PDF */
export function luminaireSheetHtml(l: Luminaire, brand: string | null, ph: Photometry | null, polar: string | null, by: string) {
  const now = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric' });
  const row = (k: string, v: unknown) => (v === null || v === undefined || v === '' ? '' : `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`);
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { size: A4 portrait; margin: 14mm; }
  body { font: 11px Arial, Helvetica, sans-serif; color: #111; }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #C8102E; padding-bottom: 8px; margin-bottom: 12px; }
  h1 { font-size: 18px; margin: 0; } .sub { color: #555; margin-top: 3px; }
  .cols { display: flex; gap: 18px; } .cols > div { flex: 1; }
  table { width: 100%; border-collapse: collapse; } td { padding: 5px 6px; border-bottom: 1px solid #E5E5E5; } td.k { width: 45%; color: #444; }
  .foot { margin-top: 18px; font-size: 8.5px; color: #555; border-top: 1px solid #ddd; padding-top: 6px; }
</style></head><body>
<header><img src="${DIMO_LOGO_DATA_URI}" alt="DIMO" style="height:42px;width:auto" />
<div><h1>${esc(l.name)}</h1><div class="sub">${esc(brand ?? (l.sample ? 'Generic sample' : ''))}${l.code ? ` · ${esc(l.code)}` : ''} · ${esc(l.family)}</div></div></header>
<div class="cols">
<div><table>
${row('Power', l.watts != null ? `${l.watts} W` : '')}
${row('Luminous flux', l.lumens != null ? `${Math.round(l.lumens)} lm` : '')}
${row('Efficacy', efficacy(l) != null ? `${efficacy(l)} lm/W` : '')}
${row('Colour temperature', l.cct ? `${l.cct} K` : '')}
${row('Colour rendering', l.cri ? `Ra ${l.cri}` : '')}
${row('Beam angle', l.beam ? `${l.beam}°` : ph ? `${beamAngle(ph)}°` : '')}
${row('Glare (UGR)', l.ugr ?? '')}
${row('Protection', [l.ip, l.ik].filter(Boolean).join(' · '))}
${row('Lit area', l.lit_l && l.lit_w ? `${l.lit_l} × ${l.lit_w} mm` : '')}
${row('Light going up', ph ? `${Math.round(ph.up * 100)}%` : '')}
${row('Stock', l.stock === 'in' ? 'In stock' : l.stock === 'out' ? 'Not in stock' : '')}
</table>${l.notes ? `<p style="color:#555">${esc(l.notes)}</p>` : ''}</div>
<div style="text-align:center">${polar ?? ''}${polar ? '<div style="font-size:9px;color:#555">Light distribution – red C0–C180, blue C90–C270</div>' : ''}</div>
</div>
<div class="foot">${l.sample ? 'Generic sample for lighting calculations – not a manufacturer’s product. ' : 'From the manufacturer’s data; the manufacturer’s data sheet prevails. '}Prepared by ${esc(by)} · DIMO Lighting Solutions · ${esc(now)}</div>
</body></html>`;
}
