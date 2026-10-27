import { Platform } from 'react-native';
import readXlsxFile from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/universal';
import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { readBytes, type PickedFile } from './files';
import { bestMatches, cctText, compare, fmt, parseSpecText, PARAMS, wattText, type Fixture, type Level, type Match, type ParamKey, type Spec } from './fixtures';
import { supabase } from './supabase';

/** BOQ match: a client BOQ (Excel / CSV) read line by line in the app and matched against the fixture library – no AI, no internet search.
 *  Saved per estimation job in boq_matches; the lines keep the text read, the options shown and the estimator's choice. */

export type BoqSheet = { name: string; rows: string[][] };
export type BoqColumns = { header: number; item: number; desc: number; qty: number; unit: number; ref: number };
export type LineKind = 'fitting' | 'heading' | 'skip';
export type BoqLine = {
  row: number; item: string; desc: string; qty: string; unit: string; ref: string;
  /** the text the values are read from (the description, corrected by the estimator if needed) */
  text: string; kind: LineKind;
  options: string[]; chosen: string | null; noMatch: boolean; note?: string;
};
export type BoqSettings = { levels: Partial<Record<ParamKey, Level>>; brands: string[]; preferExact: boolean };
export type BoqMatchRow = { id: string; estimation_job_id: string; inquiry_id: string; file_name: string; sheet: string; options: number; settings: BoqSettings; lines: BoqLine[]; created_at: string; updated_at: string };

const cell = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, ' ').trim());

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.map((r) => r.map(cell));
}

/** Every sheet of the workbook (CSV = one sheet) as text cells */
export async function readBoqFile(f: PickedFile): Promise<BoqSheet[]> {
  const bytes = await readBytes(f);
  if (/\.(csv|txt)$/i.test(f.name)) return [{ name: f.name.replace(/\.[^.]+$/, ''), rows: parseCsv(new TextDecoder().decode(bytes)) }];
  if (/\.xls$/i.test(f.name)) throw new Error('Old .xls files cannot be read – save the BOQ as .xlsx (Excel: File › Save As › Excel Workbook) or CSV');
  const sheets = await readXlsxFile(bytes);
  return sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => (r as unknown[]).map(cell)) })).filter((s) => s.rows.some((r) => r.some(Boolean)));
}

const LIGHT = /light|lamp|led\b|luminaire|fitting|fixture|downlight|panel|flood|high ?bay|strip|batten|spot|bollard|emergency|exit|bulkhead|track|linear|neon|tube|lumen|\blm\b|cob|uplight|wall ?washer|pendant/i;
const NOT_LIGHT = /cable|conduit|wire|wiring|socket|switch(?!ing driver)|\bdb\b|distribution board|breaker|\bmcbs?\b|\bmccbs?\b|\brcbo|\brccb|isolator|trunking|cable tray|gland|earth(ing)?\b|testing|commissioning|labou?r|provisional sum|prime cost|transport|scaffold|junction box|pvc pipe|ladder/i;

/** Finds the header row and the item / description / qty / unit columns (the estimator can change them) */
export function detectColumns(rows: string[][]): BoqColumns {
  const find = (r: string[], rx: RegExp) => r.findIndex((c) => rx.test(c));
  for (let h = 0; h < Math.min(rows.length, 40); h++) {
    const r = rows[h].map((c) => c.toLowerCase());
    const desc = find(r, /^(item )?desc|description|particulars|specification|details/);
    if (desc < 0) continue;
    const qty = find(r, /^(qty|quantity|quan|nos?\.?$)/);
    const unit = find(r, /^(unit|uom|u\/m)$/);
    const item = find(r, /^(item|no\.?|s\/?no|sr|ref|code|#)/);
    const ref = find(r, /^(type|ref\.?|fitting ref|luminaire ref|symbol|tag)/);
    return { header: h, desc, qty, unit, item: item === desc ? -1 : item, ref: ref === item ? -1 : ref };
  }
  // no header words: the column with the longest text is the description; the first mostly-number column after it is the quantity
  const width = Math.max(...rows.map((r) => r.length));
  const avg = (c: number) => rows.reduce((a, r) => a + (r[c]?.length ?? 0), 0) / Math.max(1, rows.length);
  let desc = 0;
  for (let c = 0; c < width; c++) if (avg(c) > avg(desc)) desc = c;
  let qty = -1;
  for (let c = desc + 1; c < width && qty < 0; c++) if (rows.filter((r) => /^\d+(\.\d+)?$/.test(r[c] ?? '')).length > rows.length / 4) qty = c;
  return { header: -1, desc, qty, unit: -1, item: desc > 0 ? 0 : -1, ref: -1 };
}

const at = (r: string[], c: number) => (c >= 0 ? r[c] ?? '' : '');

/** The BOQ lines of a sheet: section headings kept, cables / boards / labour skipped, light fittings to match */
export function boqLines(rows: string[][], cols: BoqColumns, previous: BoqLine[] = []): BoqLine[] {
  const prev = new Map(previous.filter((l) => l.kind === 'fitting').map((l) => [norm(l.desc), l]));
  const out: BoqLine[] = [];
  rows.forEach((r, i) => {
    if (i <= cols.header) return;
    const desc = at(r, cols.desc);
    if (!desc) return;
    const qty = at(r, cols.qty), unit = at(r, cols.unit), item = at(r, cols.item), ref = at(r, cols.ref);
    const kind: LineKind = !qty && !/\d\s*(w|lm|k)\b/i.test(desc) ? 'heading' : LIGHT.test(desc) && !NOT_LIGHT.test(desc.replace(LIGHT, '')) ? 'fitting' : NOT_LIGHT.test(desc) || !LIGHT.test(desc) ? 'skip' : 'fitting';
    // a revised BOQ keeps the choices made for lines whose text did not change
    const old = prev.get(norm(desc));
    out.push({ row: i, item, desc, qty, unit, ref, text: old?.text ?? desc, kind, options: [], chosen: old?.chosen ?? null, noMatch: old?.noMatch ?? false, note: old?.note });
  });
  return out;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const DEFAULT_SETTINGS: BoqSettings = { levels: {}, brands: [], preferExact: true };
/** Saved settings; the first saves had one brand */
export const readSettings = (s: Partial<BoqSettings> & { brand?: string }): BoqSettings => ({ ...DEFAULT_SETTINGS, ...s, brands: s.brands ?? (s.brand ? [s.brand] : []) });

/** The values read from a line, with the estimator's strictness for all lines */
export function lineSpec(l: BoqLine, s: BoqSettings): Spec {
  const spec = parseSpecText(l.text);
  for (const k of Object.keys(spec) as ParamKey[]) if (s.levels[k]) spec[k] = { ...spec[k]!, level: s.levels[k]! };
  return spec;
}

/** Ready = type and a light value read; Check = something missing, matched anyway */
export function lineStatus(l: BoqLine, spec: Spec): 'ready' | 'check' | 'skip' | 'heading' {
  if (l.kind !== 'fitting') return l.kind;
  return spec.type && (spec.lm || spec.w) ? 'ready' : 'check';
}

export type LineResult = { matches: Match[]; grade: 'all' | 'close' | 'few' | 'none' | 'empty' };
export function matchLine(all: Fixture[], l: BoqLine, s: BoqSettings, n: number): LineResult {
  const spec = lineSpec(l, s);
  const matches = bestMatches(all, spec, n, s.brands);
  if (!matches.length) return { matches, grade: 'empty' };
  const b = matches[0];
  return { matches, grade: b.mustFails ? 'none' : !spec.w?.v.trim() && !spec.lm?.v.trim() ? 'few' : b.fails || b.minors ? 'close' : 'all' };
}

/** A saved option, re-compared with the line (the library may have been updated since) */
export function recompare(all: Fixture[], id: string, spec: Spec): Match | null {
  const p = all.find((x) => x.id === id);
  if (!p) return null;
  const cells = compare(p, spec);
  return { p, cells, score: 0, mustFails: 0, fails: 0, minors: 0 };
}

export const devText = (spec: Spec, m: Match) =>
  PARAMS.filter((p) => spec[p.key]?.v.trim() && m.cells[p.key] && m.cells[p.key]!.status !== 'ok')
    .map((p) => { const c = m.cells[p.key]!; return `${p.label}: ${c.value}${c.dev ? ` (${c.dev})` : ''}`; })
    .join('; ') || 'Meets every value';

export async function loadBoqMatches(jobId: string) {
  const { data, error } = await supabase.from('boq_matches').select('*').eq('estimation_job_id', jobId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoqMatchRow[];
}
export async function previousLines(inquiryId: string): Promise<BoqLine[]> {
  const { data } = await supabase.from('boq_matches').select('lines').eq('inquiry_id', inquiryId).order('updated_at', { ascending: false }).limit(3);
  return (data ?? []).flatMap((r) => (r as { lines: BoqLine[] }).lines);
}
export async function saveBoqMatch(row: { id?: string | null; estimation_job_id: string; file_name: string; sheet: string; options: number; settings: BoqSettings; lines: BoqLine[] }) {
  const body = { estimation_job_id: row.estimation_job_id, file_name: row.file_name, sheet: row.sheet, options: row.options, settings: row.settings, lines: row.lines };
  const q = row.id ? supabase.from('boq_matches').update(body).eq('id', row.id).select('id').single() : supabase.from('boq_matches').insert(body).select('id').single();
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

const prodText = (p: Fixture) => `${p.brand} ${p.code}`;

/** The client's BOQ columns unchanged + the chosen product, its deviations and the options; a second sheet with the chosen products' data */
export async function exportBoqExcel(fileName: string, all: Fixture[], lines: BoqLine[], s: BoqSettings, n: number, allOptions: boolean) {
  const B = (v: string) => ({ value: v, fontWeight: 'bold' as const });
  const head = ['Item', 'Description (client)', 'Unit', 'Qty', 'Chosen', 'Deviations of the chosen', ...(allOptions ? Array.from({ length: n }, (_, i) => `Option ${i + 1}`) : [])];
  const data: ({ value?: string | number; fontWeight?: 'bold' } | null)[][] = [head.map(B)];
  const chosenIds = new Set<string>();
  for (const l of lines) {
    if (l.kind === 'skip') continue;
    if (l.kind === 'heading') { data.push([{ value: l.item }, B(l.desc)]); continue; }
    const spec = lineSpec(l, s);
    const ch = l.chosen ? recompare(all, l.chosen, spec) : null;
    if (ch) chosenIds.add(ch.p.id);
    const qn = Number(l.qty);
    data.push([
      { value: l.item }, { value: l.desc }, { value: l.unit }, { value: Number.isFinite(qn) && l.qty !== '' ? qn : l.qty },
      { value: l.noMatch ? 'No suitable option – to Design' : ch ? prodText(ch.p) : '' },
      { value: ch ? devText(spec, ch) : l.note ?? '' },
      ...(allOptions ? Array.from({ length: n }, (_, i) => ({ value: l.options[i] ? prodText(all.find((x) => x.id === l.options[i]) ?? ({ brand: '', code: l.options[i] } as Fixture)) : '' })) : []),
    ]);
  }
  const prods = [...chosenIds].map((id) => all.find((x) => x.id === id)!).filter(Boolean);
  const sheet2: typeof data = [['Brand', 'Code', 'Description', 'Type', 'Power', 'Lumens', 'CCT', 'CRI', 'IP', 'Beam', 'Size', 'Catalogue', 'Page'].map(B),
    ...prods.map((p) => [p.brand, p.code, p.title, p.type, wattText(p), p.lm ? `${p.lmMin && p.lmMin < p.lm ? `${fmt(p.lmMin)}–` : ''}${fmt(p.lm)}${p.lmEst ? ' (est.)' : ''}` : '', cctText(p), p.cri ? `${p.cri}` : '', p.ip ? `IP${p.ip}` : '', p.beam ?? '', p.size ?? '', p.src, p.page ?? ''].map((v) => ({ value: v })))];
  const blob = await writeXlsxFile([
    { sheet: 'BOQ with options', data, columns: [{ width: 8 }, { width: 60 }, { width: 6 }, { width: 8 }, { width: 28 }, { width: 50 }, ...(allOptions ? Array.from({ length: n }, () => ({ width: 26 })) : [])] },
    { sheet: 'Chosen products', data: sheet2, columns: Array.from({ length: 13 }, () => ({ width: 18 })) },
  ] as never).toBlob();
  const name = `${fileName.replace(/\.[^.]+$/, '')} – DIMO options.xlsx`;
  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    return;
  }
  const b64 = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onerror = () => bad(r.error); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.readAsDataURL(blob); });
  const f = new FsFile(Paths.cache, name.replace(/[^A-Za-z0-9 ._–-]+/g, '_'));
  f.create({ overwrite: true });
  f.write(b64, { encoding: 'base64' });
  await Sharing.shareAsync(f.uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
