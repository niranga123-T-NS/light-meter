import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { assetBytes, deliver } from './hseFill';
import type { Worker } from './workers';

// Police report letter addressed to the worker, laid out like DIMO's letter (letterhead, date, name and NIC, the
// project as the caption, appointment wording, validity, signatory). One page per worker.

type Project = { name: string; code: string | null; wbs_no?: string | null; site_address?: string | null; letter_sign_name?: string | null; letter_sign_designation?: string | null; letter_sign_phone?: string | null };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Sri Lanka date parts of an ISO date or timestamp */
function parts(v: string) {
  const d = new Date(v.length === 10 ? `${v}T00:00:00+05:30` : v);
  const t = new Date(d.getTime() + 330 * 60000);
  return { d: t.getUTCDate(), m: t.getUTCMonth(), y: t.getUTCFullYear() };
}
const dotted = (v: string) => {
  const p = parts(v);
  return `${String(p.d).padStart(2, '0')}.${String(p.m + 1).padStart(2, '0')}.${p.y}`;
};
const ordinal = (n: number) => `${String(n).padStart(2, '0')}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const longDate = (v: string) => {
  const p = parts(v);
  return `${ordinal(p.d)} ${MONTHS[p.m]} ${p.y}`;
};
const WIN = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const clean = (s: string) => s.replace(/\r/g, '').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, (ch) => (WIN.includes(ch) ? ch : '?'));

const L = 72;
const W = 451;
const INK = rgb(0, 0, 0);

function wrap(text: string, f: PDFFont, size: number, maxW: number) {
  const out: string[] = [];
  for (const para of clean(text).split('\n')) {
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

function letter(page: PDFPage, f: { r: PDFFont; b: PDFFont }, img: { head: PDFImage; foot: PDFImage }, p: Project, w: Worker) {
  const H = page.getHeight();
  page.drawImage(img.head, { x: 72, y: H - 139, width: 451.3, height: 133.3 });
  page.drawImage(img.foot, { x: 72, y: H - 836, width: 451.3, height: 133.3 });
  let y = 214;
  const size = 11;
  const lh = 13.2;
  const text = (t: string, o: { bold?: boolean; under?: boolean; x?: number } = {}) => {
    const font = o.bold ? f.b : f.r;
    const s = clean(t);
    page.drawText(s, { x: o.x ?? L, y: H - y, size, font, color: INK });
    if (o.under) page.drawLine({ start: { x: o.x ?? L, y: H - y - 1.6 }, end: { x: (o.x ?? L) + font.widthOfTextAtSize(s, size), y: H - y - 1.6 }, thickness: 0.6, color: INK });
    y += lh;
  };
  const para = (t: string, o: { bold?: boolean; under?: boolean } = {}) => wrap(t, o.bold ? f.b : f.r, size, W).forEach((ln) => text(ln, o));

  const issued = w.police_letter_issued_at ?? new Date().toISOString();
  text(dotted(issued));
  const ref = `Ref: ${w.police_letter_no ?? ''}`;
  page.drawText(clean(ref), { x: L + W - f.r.widthOfTextAtSize(clean(ref), size), y: H - (y - lh), size, font: f.r, color: INK });
  y += lh * 2.6;
  text(w.full_name.toUpperCase());
  text(`${w.id_type === 'passport' ? 'Passport' : 'NIC'} No: ${w.id_no}`);
  for (const ln of w.address.split(/\s*[,\n]\s*/).filter(Boolean).reduce<string[]>((acc, part) => {
    const last = acc[acc.length - 1];
    if (last && f.r.widthOfTextAtSize(clean(`${last}, ${part}`), size) < W * 0.6) acc[acc.length - 1] = `${last}, ${part}`;
    else acc.push(part);
    return acc;
  }, [])) text(ln);
  y += lh * 1.4;
  text(`Dear Sir/Madam,`);
  y += lh * 1.4;
  para(p.name, { bold: true, under: true });
  const no = p.wbs_no || p.code;
  if (no) text(`Project No: ${no}`, { bold: true, under: true });
  y += lh * 1.4;
  const via = w.company && w.company.toUpperCase() !== 'DIMO' ? ` through ${w.company}` : '';
  const role = w.trade || 'Worker';
  para(`This is to inform you that you have been appointed as ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role}${via} for the captioned project with effect from ${longDate(w.added_at)}. You are kindly requested to report to the above site as informed.`);
  y += lh * 0.8;
  para(`This letter is issued for you to obtain a police report from the ${w.police_station} Police Station, to be submitted to the project site office. This letter is valid until ${longDate(w.police_letter_valid_until ?? issued)}.`);
  y += lh * 1.6;
  text('Thank you,');
  text('Diesel & Motor Engineering PLC', { bold: true });
  y += 62;
  text(p.letter_sign_name ?? '');
  if (p.letter_sign_designation) text(p.letter_sign_designation);
  if (p.letter_sign_phone) text(p.letter_sign_phone);
}

/** The released letters of the given workers, one page each */
export async function printPoliceLetters(p: Project, workers: Worker[]) {
  const ready = workers.filter((w) => w.police_letter_no);
  if (!ready.length) throw new Error('The letter is not released yet');
  const doc = await PDFDocument.create();
  const [head, foot] = await Promise.all([assetBytes('/letterhead/dimo-header.jpg'), assetBytes('/letterhead/dimo-footer.jpg')]);
  const img = { head: await doc.embedJpg(head), foot: await doc.embedJpg(foot) };
  const f = { r: await doc.embedFont(StandardFonts.TimesRoman), b: await doc.embedFont(StandardFonts.TimesRomanBold) };
  for (const w of ready) letter(doc.addPage([595.32, 841.92]), f, img, p, w);
  doc.setTitle('Police report letter – DIMO');
  doc.setProducer('DIMO Lighting Ops');
  const name = ready.length === 1 ? `Police report letter ${ready[0].full_name}` : `Police report letters ${p.wbs_no || p.code || ''}`;
  await deliver(await doc.save(), name, 'police_letter', `${p.name} · ${ready.length}`);
}
