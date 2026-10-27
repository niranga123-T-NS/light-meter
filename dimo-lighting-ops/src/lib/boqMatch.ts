import { Platform } from 'react-native';
import readXlsxFile from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/universal';
import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { readBytes, type PickedFile } from './files';
import { picBlob, pictureFromUrl, readPdfBoq, xlsxPictures, type BoqPic } from './boqPictures';
import { bestMatches, brandOk, cctText, compare, fixtureImage, fmt, levelOk, parseSpecText, PARAMS, priceLabel, wattText, type Fixture, type Level, type Match, type ParamKey, type PriceLevel, type Spec } from './fixtures';
import { supabase } from './supabase';

/** BOQ match: a client BOQ (Excel / CSV / PDF, with its pictures) read line by line in the app and matched against the fixture library – no AI, no internet search.
 *  Saved per estimation job in boq_matches; the lines keep the text read, the options shown and the estimator's choice. */

export type BoqSheet = { name: string; rows: string[][]; pics?: Record<number, BoqPic> };
export type { BoqPic };
export type BoqColumns = { header: number; item: number; desc: number; qty: number; unit: number; ref: number };
export type LineKind = 'fitting' | 'heading' | 'skip';
export type BoqLine = {
  row: number; item: string; desc: string; qty: string; unit: string; ref: string;
  /** the text the values are read from (the description, corrected by the estimator if needed) */
  text: string; kind: LineKind;
  options: string[]; chosen: string | null; noMatch: boolean; note?: string;
  /** how much each option looks like the client's picture (0–1 fingerprint likeness), when the line has a picture */
  look?: number[];
  /** options the estimator dropped (never offered again for this line) and products picked by hand */
  dropped?: string[]; manual?: string[];
  /** what the chosen fitting must come with: driver and LED chip brand, test certificates */
  req?: LineReq;
};
export type LineReq = { driver: string; chip: string; certs: string[]; other: string[] };
export const MAKER_DEFAULT = 'Manufacturer default';
export const DRIVER_BRANDS = ['Lifud', 'Euchips', 'Mean Well', 'Boke', 'Inventronics', 'MOSO', 'Tridonic', 'Osram', 'Philips', 'TCL'];
export const CHIP_BRANDS = ['Osram', 'Lumileds', 'Bridgelux', 'Seoul', 'Epistar', "San'an", 'Cree', 'Samsung', 'LG'];
export const CERTS = ['LM-79', 'LM-80', 'Salt spray test', 'Material test certificates', 'EMC', 'UL', 'VDE'];
/** The certificates of a line as one list (the named ones, then the other ones with their description) */
export const certList = (r?: LineReq) => (r ? [...r.certs.filter((c) => c !== 'Other'), ...r.other] : []);
export const reqText = (r?: LineReq) => (r ? [`Driver: ${r.driver}`, `LED chip: ${r.chip}`, certList(r).length ? `Certificates: ${certList(r).join(', ')}` : 'No test certificates'].join(' · ') : '');
export type BoqSettings = { levels: Partial<Record<ParamKey, Level>>; brands: string[]; priceLevels: PriceLevel[]; preferExact: boolean };
export type BoqMatchRow = { id: string; estimation_job_id: string | null; boq_project_id: string | null; inquiry_id: string | null; file_name: string; sheet: string; options: number; settings: BoqSettings; lines: BoqLine[]; images: Record<string, BoqPic> | null; created_at: string; updated_at: string };

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

/** Every sheet of the workbook (CSV = one sheet, PDF = one sheet) as text cells, with the pictures by row */
export async function readBoqFile(f: PickedFile): Promise<BoqSheet[]> {
  const bytes = await readBytes(f);
  if (/\.(csv|txt)$/i.test(f.name)) return [{ name: f.name.replace(/\.[^.]+$/, ''), rows: parseCsv(new TextDecoder().decode(bytes)) }];
  if (/\.xls$/i.test(f.name)) throw new Error('Old .xls files cannot be read – save the BOQ as .xlsx (Excel: File › Save As › Excel Workbook), CSV or PDF');
  if (/\.pdf$/i.test(f.name) || f.mimeType === 'application/pdf') {
    const p = await readPdfBoq(bytes);
    if (!p.rows.some((r) => r.filter(Boolean).length >= 2)) throw new Error('No text table found in this PDF (a scan or a drawing?) – upload the Excel BOQ, or type the lines into a sheet');
    return [{ name: 'PDF', rows: p.rows.map((r) => r.map(cell)), pics: p.pics }];
  }
  const [sheets, pics] = await Promise.all([readXlsxFile(bytes), xlsxPictures(bytes).catch(() => ({} as Record<string, Record<number, BoqPic>>))]);
  return sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => (r as unknown[]).map(cell)), pics: pics[s.sheet] })).filter((s) => s.rows.some((r) => r.some(Boolean)));
}

/** The client's picture of each line: on the line's row, else a picture a row or two above or below with no line of its own */
export function linePictures(lines: BoqLine[], pics: Record<number, BoqPic> | undefined): Record<number, BoqPic> {
  const out: Record<number, BoqPic> = {};
  if (!pics) return out;
  const rows = new Set(lines.map((l) => l.row));
  for (const l of lines) if (pics[l.row]) out[l.row] = pics[l.row];
  for (const [k, p] of Object.entries(pics)) {
    const r = Number(k);
    if (rows.has(r)) continue;
    const near = lines.filter((l) => l.kind === 'fitting' && !out[l.row] && Math.abs(l.row - r) <= 2).sort((a, b) => Math.abs(a.row - r) - Math.abs(b.row - r) || b.row - a.row)[0];
    if (near) out[near.row] = p;
  }
  return out;
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

export const DEFAULT_SETTINGS: BoqSettings = { levels: {}, brands: [], priceLevels: [], preferExact: true };
/** Saved settings; the first saves had one brand */
export const readSettings = (s: Partial<BoqSettings> & { brand?: string }): BoqSettings => ({ ...DEFAULT_SETTINGS, ...s, brands: s.brands ?? (s.brand ? [s.brand] : []), priceLevels: s.priceLevels ?? [] });

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

export type LineResult = { matches: Match[]; grade: 'all' | 'close' | 'few' | 'none' | 'empty'; look?: number[] };
/** Likeness to the client's picture as 0–1 (the same fitting scores about 0.66, another fitting about 0.55 or less) */
const lookPts = (x: number) => Math.max(0, Math.min(1, (x - 0.4) / 0.6));
/** The best options of a line. With the client's picture (photo = likeness of each catalogue photo): the values still decide when the line has them,
 *  the picture breaks near-ties; a line with few values (no power, no lumens) is ranked mostly by how alike the products look, within its type. */
export function matchLine(all: Fixture[], l: BoqLine, s: BoqSettings, n: number, photo?: Map<string, number>): LineResult {
  const spec = lineSpec(l, s);
  const few = !spec.w?.v.trim() && !spec.lm?.v.trim();
  if (!photo) {
    const matches = bestMatches(all, spec, n, s.brands, s.priceLevels);
    if (!matches.length) return { matches, grade: 'empty' };
    const b = matches[0];
    return { matches, grade: b.mustFails ? 'none' : few ? 'few' : b.fails || b.minors ? 'close' : 'all' };
  }
  let pool = bestMatches(all, spec, 80, s.brands, s.priceLevels);
  // no values at all: the picture alone, over every product with a photo
  if (!pool.length) pool = all.filter((p) => p.img && photo.has(p.img) && brandOk(s.brands, p) && levelOk(s.priceLevels, p)).map((p) => ({ p, cells: {}, score: 0, mustFails: 0, fails: 0, minors: 0 }));
  const sim = (m: Match) => (m.p.img ? photo.get(m.p.img) ?? 0 : 0);
  const weight = few ? 70 : 12;
  pool.sort((a, b) => a.mustFails - b.mustFails || b.score + weight * lookPts(sim(b)) - (a.score + weight * lookPts(sim(a))));
  const seen = new Set<string>(), matches: Match[] = [];
  for (const m of pool) {
    const fam = `${m.p.cat}:${m.p.fam ?? m.p.title}`;
    if (seen.has(fam)) continue;
    seen.add(fam);
    matches.push(m);
    if (matches.length >= n) break;
  }
  if (!matches.length) return { matches, grade: 'empty' };
  const b = matches[0];
  return { matches, grade: b.mustFails ? 'none' : few ? 'few' : b.fails || b.minors ? 'close' : 'all', look: matches.map(sim) };
}

/** The options of a line after the estimator dropped some: the ones kept stay, the dropped ones are replaced by the next best (never a dropped one again) */
export function refillLine(all: Fixture[], l: BoqLine, s: BoqSettings, n: number, photo?: Map<string, number>): Pick<BoqLine, 'options' | 'look' | 'dropped' | 'chosen'> {
  const dropped = l.dropped ?? [];
  const kept = l.options.filter((id) => !dropped.includes(id));
  const more = matchLine(all, l, s, n + kept.length + dropped.length + 10, photo).matches.map((m) => m.p.id).filter((id) => !kept.includes(id) && !dropped.includes(id));
  const options = [...kept, ...more].slice(0, Math.max(n, kept.length));
  const img = (id: string) => all.find((x) => x.id === id)?.img;
  return { options, dropped, chosen: l.chosen && dropped.includes(l.chosen) ? null : l.chosen, look: photo ? options.map((id) => photo.get(img(id) ?? '') ?? 0) : undefined };
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

/** What a BOQ match belongs to: an estimation job, or an inquiry not in the system (boq_projects) */
export type BoqTarget = { job: string } | { custom: string };
const targetCol = (t: BoqTarget) => ('job' in t ? (['estimation_job_id', t.job] as const) : (['boq_project_id', t.custom] as const));

/** An inquiry that is not in the system: from before the system, or never registered in it */
export type BoqProject = { id: string; kind: 'pre_system' | 'unregistered'; ref: string; project_name: string; customer_name: string | null; inquiry_date: string | null; notes: string | null; created_at: string };
export const BOQ_PROJECT_KIND: Record<BoqProject['kind'], string> = { pre_system: 'Before the system', unregistered: 'Not registered in the system' };

export async function loadBoqMatches(t: BoqTarget) {
  const [col, id] = targetCol(t);
  const { data, error } = await supabase.from('boq_matches').select('*').eq(col, id).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoqMatchRow[];
}
/** The lines of the last saves for the same inquiry (a revised BOQ keeps the choices of unchanged lines) */
export async function previousLines(t: { inquiry: string } | { custom: string }): Promise<BoqLine[]> {
  const q = supabase.from('boq_matches').select('lines');
  const { data } = await ('inquiry' in t ? q.eq('inquiry_id', t.inquiry) : q.eq('boq_project_id', t.custom)).order('updated_at', { ascending: false }).limit(3);
  return (data ?? []).flatMap((r) => (r as { lines: BoqLine[] }).lines);
}
export async function saveBoqProject(p: Partial<BoqProject>) {
  const body = { kind: p.kind, ref: p.ref, project_name: p.project_name, customer_name: p.customer_name || null, inquiry_date: p.inquiry_date || null, notes: p.notes || null };
  const q = p.id ? supabase.from('boq_projects').update(body).eq('id', p.id).select('id').single() : supabase.from('boq_projects').insert(body).select('id').single();
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
export async function deleteBoqProject(id: string) {
  const { error } = await supabase.from('boq_projects').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
export async function saveBoqMatch(row: { id?: string | null; target: BoqTarget; file_name: string; sheet: string; options: number; settings: BoqSettings; lines: BoqLine[]; images: Record<number, BoqPic> }) {
  const [col, tid] = targetCol(row.target);
  const body = { [col]: tid, file_name: row.file_name, sheet: row.sheet, options: row.options, settings: row.settings, lines: row.lines, images: row.images };
  const q = row.id ? supabase.from('boq_matches').update(body).eq('id', row.id).select('id').single() : supabase.from('boq_matches').insert(body).select('id').single();
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

const prodText = (p: Fixture) => `${p.brand} ${p.code}`;

const PIC_BOX = 90;
/** An Excel picture in the box of a cell (rows with pictures are made taller) */
async function excelImage(p: BoqPic, row: number, column: number) {
  const k = Math.min(PIC_BOX / p.w, PIC_BOX / p.h, 1);
  return { content: await picBlob(p), contentType: p.src.slice(5, p.src.indexOf(';')) || 'image/jpeg', width: Math.round(p.w * k), height: Math.round(p.h * k), dpi: 96, anchor: { row, column }, offsetX: 3, offsetY: 3 };
}

/* ───────── Excel layout: wrapped text, rows as tall as their text, a frozen header ───────── */
type XCell = { value?: string | number; fontWeight?: 'bold'; height?: number; wrap?: boolean; alignVertical?: 'top' | 'center'; align?: 'left' | 'right' | 'center'; textColor?: string; backgroundColor?: string; borderColor?: string; borderStyle?: string };
const LINE_PT = 15;
/** Lines a text needs in a column of this width (Excel width ≈ characters of the default font) */
const linesIn = (v: unknown, width: number) => String(v ?? '').split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / Math.max(4, width - 1.5))), 0);
const X = (value: string | number | undefined, o: Partial<XCell> = {}): XCell => ({ value, wrap: true, alignVertical: 'top', borderColor: '#D1D5DB', borderStyle: 'thin', ...o });
const head = (v: string) => X(v, { fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#1F2937', alignVertical: 'center' });
/** A row's height from its longest wrapped cell (and its picture) */
function fitRow(row: XCell[], widths: number[], minPt = LINE_PT) {
  const lines = Math.max(1, ...row.map((c, i) => (c?.value == null || c.value === '' ? 1 : linesIn(c.value, widths[i] ?? 10))));
  row[0] = { ...row[0], height: Math.max(minPt, lines * LINE_PT + 4) };
  return row;
}

/** The client's BOQ columns unchanged + the client's picture, the chosen product with its photo and deviations, and the options; a second sheet with the chosen products' data */
export async function exportBoqExcel(fileName: string, all: Fixture[], lines: BoqLine[], s: BoqSettings, n: number, allOptions: boolean, pics: Record<number, BoqPic> = {}) {
  const anyPic = Object.keys(pics).length > 0;
  // columns: Item, Description, [Client picture], Unit, Qty, Chosen, Chosen product photo, Deviations, Options
  const cols: { h: string; w: number }[] = [
    { h: 'Item', w: 7 }, { h: 'Description (client)', w: 55 }, ...(anyPic ? [{ h: 'Client picture', w: 15 }] : []), { h: 'Unit', w: 6 }, { h: 'Qty', w: 8 },
    { h: 'Chosen', w: 30 }, { h: 'Chosen product', w: 15 }, { h: 'Deviations of the chosen', w: 42 },
    { h: 'Driver', w: 16 }, { h: 'LED chip', w: 14 }, { h: 'Test certificates', w: 30 }, { h: 'Warnings', w: 24 },
    ...(allOptions ? Array.from({ length: n }, (_, i) => ({ h: `Option ${i + 1}`, w: 26 })) : []),
  ];
  const widths = cols.map((c) => c.w);
  const cClient = 3, cChosenPic = anyPic ? 7 : 6;
  const data: XCell[][] = [fitRow(cols.map((c) => head(c.h)), widths, 22)];
  const images: Awaited<ReturnType<typeof excelImage>>[] = [];
  const photos = new Map<string, BoqPic | null>();
  const chosenIds = new Set<string>();
  for (const l of lines) {
    if (l.kind === 'skip') continue;
    if (l.kind === 'heading') {
      data.push(fitRow(cols.map((_, i) => X(i === 0 ? l.item : i === 1 ? l.desc : '', { fontWeight: 'bold', backgroundColor: '#E5E7EB' })), widths));
      continue;
    }
    const spec = lineSpec(l, s);
    const ch = l.chosen ? recompare(all, l.chosen, spec) : null;
    if (ch) chosenIds.add(ch.p.id);
    const qn = Number(l.qty);
    const rowNo = data.length + 1;
    const pic = pics[l.row];
    let photo: BoqPic | null = null;
    if (ch?.p.img) {
      if (!photos.has(ch.p.img)) photos.set(ch.p.img, await pictureFromUrl(fixtureImage(ch.p)!).catch(() => null));
      photo = photos.get(ch.p.img) ?? null;
    }
    if (pic) images.push(await excelImage(pic, rowNo, cClient));
    if (photo) images.push(await excelImage(photo, rowNo, cChosenPic));
    const opt = (i: number) => {
      const p = l.options[i] ? all.find((x) => x.id === l.options[i]) : undefined;
      return l.options[i] ? X(p ? `${prodText(p)}\n${p.title}` : l.options[i], { textColor: l.options[i] === l.chosen ? '#1D4ED8' : undefined }) : X('');
    };
    data.push(fitRow([
      X(l.item), X(l.desc), ...(anyPic ? [X('')] : []), X(l.unit, { align: 'center' }), X(Number.isFinite(qn) && l.qty !== '' ? qn : l.qty, { align: 'right' }),
      l.noMatch ? X('No suitable option – to Design', { textColor: '#B91C1C', fontWeight: 'bold' }) : X(ch ? `${prodText(ch.p)}\n${ch.p.title}` : '', { fontWeight: ch ? 'bold' : undefined }),
      X(''),
      X(ch ? devText(spec, ch).split('; ').join('\n') : l.note ?? ''),
      X(ch ? l.req?.driver ?? MAKER_DEFAULT : ''), X(ch ? l.req?.chip ?? MAKER_DEFAULT : ''),
      X(ch ? certList(l.req).join('\n') || 'Not required' : ''),
      X(ch ? (ch.p.warnings ?? []).map((w) => `⚠ ${w.text}`).join('\n') : '', { textColor: '#B91C1C', fontWeight: 'bold' }),
      ...(allOptions ? Array.from({ length: n }, (_, i) => opt(i)) : []),
    ], widths, pic || photo ? PIC_BOX * 0.75 + 8 : LINE_PT));
  }
  const prods = [...chosenIds].map((id) => all.find((x) => x.id === id)!).filter(Boolean);
  const cols2: { h: string; w: number }[] = [
    { h: 'Brand', w: 14 }, { h: 'Code', w: 22 }, { h: 'Description', w: 42 }, { h: 'Type', w: 16 }, { h: 'Price level', w: 11 }, { h: 'Power', w: 10 }, { h: 'Lumens', w: 13 },
    { h: 'CCT', w: 18 }, { h: 'CRI', w: 6 }, { h: 'IP', w: 7 }, { h: 'Beam', w: 16 }, { h: 'Size', w: 22 }, { h: 'Catalogue', w: 30 }, { h: 'Page', w: 6 }, { h: 'Warnings', w: 24 },
  ];
  const widths2 = cols2.map((c) => c.w);
  const sheet2: XCell[][] = [fitRow(cols2.map((c) => head(c.h)), widths2, 22),
    ...prods.map((p) => fitRow([p.brand, p.code, p.title, p.type, p.priceLevel ? priceLabel(p.priceLevel) : '', wattText(p), p.lm ? `${p.lmMin && p.lmMin < p.lm ? `${fmt(p.lmMin)}–` : ''}${fmt(p.lm)}${p.lmEst ? ' (est.)' : ''}` : '', cctText(p), p.cri ? `${p.cri}` : '', p.ip ? `IP${p.ip}` : '', p.beam ?? '', p.size ?? '', p.src, p.page ?? '', (p.warnings ?? []).map((w) => `⚠ ${w.text}`).join('\n')].map((v) => X(v)), widths2))];
  const blob = await writeXlsxFile([
    { sheet: 'BOQ with options', data, images, columns: cols.map((c) => ({ width: c.w })), stickyRowsCount: 1 },
    { sheet: 'Chosen products', data: sheet2, columns: cols2.map((c) => ({ width: c.w })), stickyRowsCount: 1 },
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
