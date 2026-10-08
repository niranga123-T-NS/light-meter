import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { Platform } from 'react-native';
import { fmtDateNum, fmtTime } from './format';
import type { HseEquipment, HseForm, HseRecord, Induction } from './hse';
import layouts from './hseLayouts.json';
import { supabase } from './supabase';

// HSE forms filled on the issued DIMO forms themselves: the original PDF (logo, pictures, layout, document number and
// issue box) is loaded unchanged from /public/hse-forms and only the answers, names, dates and times are written into
// its boxes. Box positions (points, top-left origin) come from hseLayouts.json, generated from the same PDFs.

type Slot = [page: number, x0: number, y0: number, x1: number, y1: number];
type Layout = { size: [number, number]; slots: Record<string, Slot | number> };
type Mark = { mark: 'tick' | 'circle' };
type Value = string | Mark;
type Sheet = Record<string, Value | null | undefined>;
export type HseCtx = {
  project: { code: string | null; wbs_no?: string | null; name: string };
  name: (id: string | null) => string;
  role?: (id: string | null) => string;
};

const LAYOUTS = layouts as unknown as Record<string, Layout>;
const SITE = 'https://dimo-lighting-ops.vercel.app';
const INK = rgb(0.05, 0.13, 0.5);
const TICK: Mark = { mark: 'tick' };
const CIRCLE: Mark = { mark: 'circle' };
const SIGNED = 'Signed in app';
// Fields written on a dashed line ("PROJECT : -----") rather than in a box: the text sits just above the dashes
const ON_LINE: Record<string, RegExp> = { 'TR-01': /^[hc]\./, 'IR-01': /^h\./ };
// Areas ruled into rows: the text runs line by line through the cells (prefix.1, prefix.2, …)
const RULED: Record<string, string> = { 'b.hazards': 'b' };

const projectLine = (c: HseCtx) => [c.project.wbs_no || c.project.code, c.project.name].filter(Boolean).join(' – ');
const dt = (v: string | null | undefined) => (v ? `${fmtDateNum(v)} ${fmtTime(v)}` : '');
const str = (v: unknown) => (v == null ? '' : String(v));
const frequency = (d?: number | null) => (!d ? '' : d === 1 ? 'Daily' : d === 7 ? 'Weekly' : d === 14 ? 'Fortnightly' : d === 30 || d === 31 ? 'Monthly' : `Every ${d} days`);

// Standard PDF fonts only cover Windows-1252 – anything else (Sinhala, Tamil, emoji) would stop the PDF being made.
const WIN = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const clean = (s: string) => s.replace(/\r/g, '').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, (ch) => (WIN.includes(ch) ? ch : ch === '✓' ? 'Yes' : '?'));

function answers(sheet: Sheet, r: HseRecord, keys: string[]) {
  for (const k of keys) {
    const a = r.answers[k]?.a;
    if (a) sheet[`i.${k}.${a}`] = TICK;
    if (r.answers[k]?.r) sheet[`i.${k}.r`] = r.answers[k].r;
  }
}

function checklist(f: HseForm, r: HseRecord, e: HseEquipment | null, c: HseCtx): Sheet[] {
  const h = r.header ?? {};
  const s: Sheet = {
    'h.project': projectLine(c),
    'h.date': fmtDateNum(r.created_at),
    'h.contractor': str(h.contractor) || e?.contractor,
    'h.frequency': frequency(e?.frequency_days),
    'h.first': fmtDateNum(e?.first_deployed),
    'h.checked': c.name(r.created_by),
    'h.type': e?.name,
    'h.serial': e?.serial_no,
  };
  if (f.kind === 'kit') {
    for (const it of f.items) {
      const a = r.answers[it.no] ?? {};
      Object.assign(s, { [`i.${it.no}.avail`]: str(a.avail), [`i.${it.no}.mfg`]: fmtDateNum(a.mfg), [`i.${it.no}.exp`]: fmtDateNum(a.exp), [`i.${it.no}.r`]: a.r });
    }
  } else {
    answers(s, r, f.items.map((it) => it.no));
  }
  if (r.accepted != null) s[r.accepted ? 'acc.yes' : 'acc.no'] = CIRCLE;
  const notes = [h.trip_value_tested ? `ELCB trip value tested ${fmtDateNum(str(h.trip_value_tested))}` : '', r.ehs_note ?? ''].filter(Boolean);
  s['acc.r'] = notes.join(' · ');
  if (r.accepted === false) Object.assign(s, { 'rem.date': fmtDateNum(r.created_at), 'rem.r': 'Removed from use until corrected and re-checked' });
  if (r.corrective_note) Object.assign(s, { 'cor.date': fmtDateNum(r.corrective_date), 'cor.r': r.corrective_note });
  for (const [k, by, at] of [['sup', r.sup_by, r.sup_at], ['ehs', r.ehs_by, r.ehs_at], ['mgr', r.mgr_by, r.mgr_at]] as const) {
    if (by) Object.assign(s, { [`sign.${k}.name`]: c.name(by), [`sign.${k}.date`]: fmtDateNum(at), [`sign.${k}.sig`]: SIGNED });
  }
  return [s];
}

function permit(f: HseForm, r: HseRecord, e: HseEquipment | null, c: HseCtx, related: string | null): Sheet[] {
  const h = r.header ?? {};
  const extraKey = f.extra.header?.[0]?.key;
  const approved = !!r.ehs_by && r.status !== 'rejected';
  const readings = (f.extra.readings ?? []).map((x) => (h.readings?.[x.key] ? `${x.label} ${h.readings[x.key]}` : '')).filter(Boolean);
  const comments = [
    readings.length ? `Gas test: ${readings.join(', ')}` : '',
    e ? `Equipment: ${e.name}${e.serial_no ? ` ${e.serial_no}` : ''} – checklist in date` : '',
    r.status === 'rejected' && r.ehs_note ? `Not approved: ${r.ehs_note}` : r.ehs_note ?? '',
    r.close_note ? `Closing: ${r.close_note}` : '',
  ].filter(Boolean);
  const s: Sheet = {
    [h.shift === 'night' ? 'shift.night' : 'shift.day']: TICK,
    'h.project': projectLine(c),
    'h.location': str(h.location),
    'h.company': str(h.company),
    'h.permit_no': r.code,
    'h.applied': fmtDateNum(r.starts_at ?? r.created_at),
    'h.extra': extraKey ? str(h[extraKey]) || (extraKey === 'tbt_no' ? related : '') : '',
    'a.location': str(h.location),
    'a.description': str(h.description),
    'a.start': dt(r.starts_at),
    'a.finish': dt(r.ends_at),
    'a.in_charge': str(h.in_charge),
    'a.mobile': str(h.mobile),
    explain: str(h.explain),
    'c.req.name': c.name(r.created_by),
    'c.req.signature': SIGNED,
    'c.req.time': dt(r.created_at),
    'c.app.name': approved ? c.name(r.ehs_by) : '',
    'c.app.signature': approved ? SIGNED : '',
    'c.app.time': approved ? dt(r.ehs_at) : '',
    'c.comments': comments.join('\n'),
    'd.name': r.closed_by ? c.name(r.closed_by) : '',
    'd.signature': r.closed_by ? SIGNED : '',
    'd.time': dt(r.closed_at),
  };
  answers(s, r, [...f.items.map((it) => it.no), ...(f.extra.groups ?? []).flatMap((g) => g.items.map((_, i) => `${g.no}.${i + 1}`))]);
  return [s];
}

function tbt(f: HseForm, r: HseRecord, c: HseCtx, related: string | null, layout: Layout): Sheet[] {
  const h = r.header ?? {};
  const at = r.starts_at ?? r.created_at;
  const head: Sheet = {
    [h.shift === 'night' ? 'shift.night' : 'shift.day']: TICK,
    'h.date': fmtDateNum(at),
    'h.time': fmtTime(at),
    'h.project': projectLine(c),
    'h.location': str(h.location),
    'h.tbt_no': r.code,
    'h.permit': related ?? str(h.permit_details),
    'h.by': c.name(r.created_by),
    'h.position': str(h.position) || c.role?.(r.created_by),
    'a.activity': str(h.activity),
    'b.hazards': str(h.hazards),
    'c.other': str(h.other),
  };
  for (const it of f.items) if (r.answers[it.no]?.a === 'yes') head[`c.${it.no}`] = TICK;
  for (const [k, by, when] of [['ehs', r.ehs_by, r.ehs_at], ['mgr', r.mgr_by, r.mgr_at]] as const) {
    if (by) Object.assign(head, { [`sign.${k}.name`]: c.name(by), [`sign.${k}.sig`]: SIGNED, [`sign.${k}.time`]: dt(when) });
  }
  const per = rowCount(layout, 'p');
  return pages(r.participants ?? [], per, (ps, from) => {
    const s: Sheet = { ...head };
    ps.forEach((p, i) => Object.assign(s, { [`p.${i + 1}.name`]: p.name, [`p.${i + 1}.position`]: p.position || p.company, [`p.${i + 1}.sig`]: 'Present' }));
    if (from) s['h.tbt_no'] = `${r.code} (cont.)`;
    return s;
  });
}

function training(r: HseRecord, c: HseCtx, layout: Layout): Sheet[] {
  const h = r.header ?? {};
  const head: Sheet = {
    'h.project': projectLine(c),
    'h.location': str(h.location),
    'h.contractor': str(h.contractor),
    'h.date': fmtDateNum(r.starts_at ?? r.created_at),
    'h.from': fmtTime(r.starts_at),
    'h.to': fmtTime(r.ends_at),
    'h.title': str(h.title),
    'h.man_hours': str(h.man_hours),
    'c.name': c.name(r.created_by),
    'c.designation': str(h.designation) || c.role?.(r.created_by),
    'c.date': fmtDateNum(r.created_at),
    'c.sig': SIGNED,
  };
  return pages(r.participants ?? [], rowCount(layout, 'r'), (ps) => {
    const s: Sheet = { ...head };
    ps.forEach((p, i) => Object.assign(s, { [`r.${i + 1}.name`]: p.name, [`r.${i + 1}.designation`]: p.position, [`r.${i + 1}.company`]: p.company, [`r.${i + 1}.contact`]: p.contact, [`r.${i + 1}.sig`]: 'Present' }));
    return s;
  });
}

const rowCount = (l: Layout, prefix: string) => {
  let n = 0;
  while (l.slots[`${prefix}.${n + 1}.name`]) n++;
  return Math.max(n, 1);
};
function pages<T>(rows: T[], per: number, fill: (chunk: T[], from: number) => Sheet): Sheet[] {
  const out: Sheet[] = [];
  for (let i = 0; i === 0 || i < rows.length; i += per) out.push(fill(rows.slice(i, i + per), i));
  return out;
}

/** A file the app serves from /public (the web app itself; phones fetch it from the live site) */
export async function assetBytes(path: string) {
  const res = await fetch(`${Platform.OS === 'web' ? '' : SITE}${path}`);
  if (!res.ok) throw new Error(`${path} could not be loaded (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function template(code: string) {
  return assetBytes(`/hse-forms/${encodeURIComponent(code)}.pdf`).catch(() => {
    throw new Error(`The original ${code} form could not be loaded`);
  });
}

/** Write one value into its box: text shrunk (down to 5.5 pt) or wrapped to fit, ticks and circles drawn as ink. */
function draw(page: PDFPage, font: PDFFont, italic: PDFFont, slot: Slot, v: Value, onLine = false) {
  const H = page.getHeight();
  const [, x0, y0, x1, y1] = slot;
  const w = x1 - x0;
  const h = y1 - y0;
  if (typeof v !== 'string') {
    const cx = (x0 + x1) / 2;
    const cy = H - (y0 + y1) / 2;
    if (v.mark === 'circle') {
      page.drawEllipse({ x: cx, y: cy, xScale: w / 2 + 2, yScale: h / 2 + 1, borderColor: INK, borderWidth: 1.1 });
      return;
    }
    const s = Math.min(w, h, 14) * 0.38;
    page.drawLine({ start: { x: cx - s, y: cy }, end: { x: cx - s * 0.3, y: cy - s * 0.75 }, thickness: 1.4, color: INK });
    page.drawLine({ start: { x: cx - s * 0.3, y: cy - s * 0.75 }, end: { x: cx + s, y: cy + s * 0.8 }, thickness: 1.4, color: INK });
    return;
  }
  const text = clean(v).trim();
  if (!text) return;
  const f = text === SIGNED || text === 'Present' ? italic : font;
  const pad = 2;
  const maxW = w - pad * 2;
  if (onLine) {
    let ls = 8.5;
    while (ls > 5.5 && f.widthOfTextAtSize(text, ls) > maxW) ls -= 0.25;
    page.drawText(text.replace(/\s*\n\s*/g, ' · '), { x: x0 + pad, y: H - (y0 + h * 0.35), size: ls, font: f, color: INK });
    return;
  }
  let size = Math.min(9, Math.max(h - 4, 6));
  // One line if it fits at a readable size
  const oneLine = text.replace(/\s*\n\s*/g, ' · ');
  while (size > 5.5 && f.widthOfTextAtSize(oneLine, size) > maxW) size -= 0.25;
  if (f.widthOfTextAtSize(oneLine, size) <= maxW && (h < size * 2.3 || !text.includes('\n'))) {
    page.drawText(oneLine, { x: x0 + pad, y: H - (y0 + (h + size * 0.7) / 2), size, font: f, color: INK });
    return;
  }
  // Wrap over several lines, shrinking until it fits the box height
  for (size = Math.min(9, h - 2); size >= 5; size -= 0.25) {
    const lines = wrap(text, f, size, maxW);
    const lh = size * 1.15;
    if (lines.length * lh <= h - 2 || size <= 5) {
      const shown = lines.slice(0, Math.max(1, Math.floor((h - 2) / lh)));
      shown.forEach((ln, i) => page.drawText(ln, { x: x0 + pad, y: H - (y0 + 1.5 + size * 0.85 + i * lh), size, font: f, color: INK }));
      return;
    }
  }
}

function ruledCells(l: Layout, prefix: string) {
  const out: Slot[] = [];
  for (let n = 1; Array.isArray(l.slots[`${prefix}.${n}`]); n++) out.push(l.slots[`${prefix}.${n}`] as Slot);
  return out;
}

/** Text written line by line into ruled cells, smaller only when it would not fit */
function ruled(page: PDFPage, font: PDFFont, cells: Slot[], v: string) {
  const text = clean(v).trim();
  const w = Math.min(...cells.map((c) => c[3] - c[1])) - 4;
  let size = 8.5;
  const fit = (sz: number) => wrap(text, font, sz, w).filter(Boolean);
  let lines = fit(size);
  while (lines.length > cells.length && size > 5.5) lines = fit((size -= 0.25));
  if (lines.length > cells.length) lines = [...lines.slice(0, cells.length - 1), lines.slice(cells.length - 1).join(' ')];
  lines.forEach((ln, i) => draw(page, font, font, cells[i], ln));
}

function wrap(text: string, f: PDFFont, size: number, maxW: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(t, size) <= maxW || !line) line = t;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

async function build(code: string, sheets: Sheet[]) {
  const layout = LAYOUTS[code];
  if (!layout) throw new Error(`No layout for ${code}`);
  const src = await PDFDocument.load(await template(code));
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const idx = src.getPageIndices();
  for (const sheet of sheets) {
    const copied = await doc.copyPages(src, idx);
    copied.forEach((p) => doc.addPage(p));
    for (const [key, v] of Object.entries(sheet)) {
      const slot = layout.slots[key];
      if (v == null || v === '' || !Array.isArray(slot)) continue;
      const cells = RULED[key] && typeof v === 'string' ? ruledCells(layout, RULED[key]) : [];
      if (cells.length) ruled(copied[slot[0]], font, cells, v as string);
      else draw(copied[slot[0]], font, italic, slot, v, !!ON_LINE[code]?.test(key));
    }
  }
  doc.setTitle(`${code} – DIMO`);
  doc.setProducer('DIMO Lighting Ops');
  return doc.save();
}

/** PDF bytes to the user: a download on the web, the share sheet on phones (logged like reports) */
export async function deliver(bytes: Uint8Array, name: string, key: string, filters: string) {
  const { data } = await supabase.auth.getUser();
  if (data.user) await supabase.from('report_runs').insert({ user_id: data.user.id, report_key: key, filters: { text: filters }, format: 'pdf' });
  const fileName = `${name.replace(/[^A-Za-z0-9-]+/g, '_')}.pdf`;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  const file = new FsFile(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: name });
}

/** Values written into each box – exported for checking the layouts */
export function hseSheets(f: HseForm, r: HseRecord, e: HseEquipment | null, c: HseCtx, related: string | null = null): Sheet[] {
  const layout = LAYOUTS[f.code];
  if (f.kind === 'permit') return permit(f, r, e, c, related);
  if (f.kind === 'tbt') return tbt(f, r, c, related, layout);
  if (f.kind === 'training') return training(r, c, layout);
  return checklist(f, r, e, c);
}

/** One recorded HSE form as a PDF on the original DIMO form. */
export async function fillHseRecord(f: HseForm, r: HseRecord, e: HseEquipment | null, c: HseCtx, related: string | null = null) {
  const bytes = await build(f.code, hseSheets(f, r, e, c, related));
  await deliver(bytes, `${f.code} ${r.code}`, 'hse_form', `${f.doc_no} ${r.code}`);
}

/** The project's HSE induction register (IR-01), 14 people per sheet, oldest first. */
export async function fillInductionRegister(rows: Induction[], c: HseCtx, location: string) {
  const layout = LAYOUTS['IR-01'];
  const per = rowCount(layout, 'r');
  const sheets = pages(rows, per, (chunk) => {
    const s: Sheet = { 'h.project': projectLine(c), 'h.location': location };
    chunk.forEach((x, i) => Object.assign(s, {
      [`r.${i + 1}.date`]: fmtDateNum(x.inducted_on),
      [`r.${i + 1}.name`]: x.name,
      [`r.${i + 1}.nic`]: x.nic,
      [`r.${i + 1}.company`]: x.company,
      [`r.${i + 1}.sig`]: 'Present',
      [`r.${i + 1}.remarks`]: x.remarks,
      [`r.${i + 1}.instructor`]: c.name(x.instructor_id),
    }));
    return s;
  });
  await deliver(await build('IR-01', sheets), `IR-01 Induction register ${c.project.wbs_no || c.project.code || ''}`, 'hse_induction', c.project.name);
}
