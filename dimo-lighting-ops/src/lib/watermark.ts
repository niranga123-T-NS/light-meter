import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/** The DIMO watermark on every page of a PDF: a light diagonal "DIMO Lighting Solutions" and a footer line naming who
 *  shared it and when */
export async function watermarkPdf(src: ArrayBuffer | Uint8Array, by: string, when = new Date()) {
  const doc = await PDFDocument.load(src, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const small = await doc.embedFont(StandardFonts.Helvetica);
  const date = when.toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric' });
  const foot = `Shared by ${by} - DIMO Lighting Solutions - ${date}`.replace(/[^\x20-\x7E]/g, '');
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(width, height) / 9;
    const text = 'DIMO Lighting Solutions';
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: width / 2 - (w / 2) * Math.cos(Math.PI / 6), y: height / 2 - (w / 2) * Math.sin(Math.PI / 6), size, font, color: rgb(0.78, 0.06, 0.18), opacity: 0.09, rotate: degrees(30) });
    const fs = Math.max(6, Math.min(9, width / 70));
    page.drawRectangle({ x: 0, y: 0, width, height: fs * 2.2, color: rgb(1, 1, 1), opacity: 0.85 });
    page.drawText(foot, { x: 12, y: fs * 0.7, size: fs, font: small, color: rgb(0.78, 0.06, 0.18) });
  }
  return doc.save();
}
