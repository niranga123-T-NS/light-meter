import { cellStr, norm, parseNum } from './orParse';

// Excel → contract BOQ items (one sheet with "Bill No." headings, or one sheet per bill; summary sheets are skipped)
export type ParsedItem = { section: string | null; item_no: string | null; description: string; unit: string | null; qty: number | null; rate: number | null; amount: number | null };
export type ParsedSheet = { name: string; items: ParsedItem[]; total: number; skipped?: string };
export type ParsedBoq = { fileName: string; sheets: ParsedSheet[] };

const COLS: Record<string, string[]> = {
  item_no: ['item', 'item no', 'item no.', 'no', 'ref', 'ref no', 's no', 'sl no', 'sn', 'item ref', 'code'],
  description: ['description', 'item description', 'particulars', 'description of work', 'description of works', 'details'],
  unit: ['unit', 'units', 'uom', 'u o m'],
  qty: ['qty', 'quantity', 'qnty', 'quantities', 'qty.'],
  rate: ['rate', 'unit rate', 'unit price', 'rate lkr', 'rate rs', 'price'],
  amount: ['amount', 'total', 'total amount', 'value', 'amount lkr', 'amount rs', 'total price'],
};
// Totals, page carries and summaries – would count twice
const TOTAL_ROW = /^(grand\s+)?(sub[\s-]?)?total\b|carried\s+(forward|to)|brought\s+forward|^page\s+total|^collection\b|^to\s+summary/i;
const BILL_HEADING = /^bill\s*(no\.?\s*)?[0-9ivx]+\b/i;

function findHeader(data: unknown[][]) {
  for (let r = 0; r < Math.min(data.length, 40); r++) {
    const h = data[r].map(norm);
    const col = (k: string) => h.findIndex((c) => COLS[k].includes(c));
    const d = col('description');
    const q = col('qty');
    const rt = col('rate');
    if (d >= 0 && q >= 0 && rt >= 0) return { row: r, d, q, rt, item: col('item_no'), unit: col('unit'), amount: col('amount') };
  }
  return null;
}

/** Reads every sheet: a sheet with Description / Qty / Rate headings is a bill; others (summary, cover) are skipped. */
export function parseBoqSheets(sheets: { sheet: string; data: unknown[][] }[], fileName: string): ParsedBoq {
  const bills = sheets.filter((s) => findHeader(s.data));
  const out: ParsedSheet[] = sheets.map(({ sheet, data }) => {
    const hd = findHeader(data);
    if (!hd) return { name: sheet, items: [], total: 0, skipped: 'No Description / Qty / Rate headings (summary or cover sheet)' };
    // one bill sheet: sections come from "Bill No. …" heading rows; several sheets: the sheet name is the section
    let section: string | null = bills.length > 1 ? sheet : null;
    const items: ParsedItem[] = [];
    for (const row of data.slice(hd.row + 1)) {
      const description = cellStr(row[hd.d]).replace(/\s+/g, ' ');
      if (!description) continue;
      if (TOTAL_ROW.test(description)) continue;
      let qty = parseNum(row[hd.q]);
      let rate = parseNum(row[hd.rt]);
      const amount = hd.amount >= 0 ? parseNum(row[hd.amount]) : null;
      let unit = hd.unit >= 0 ? cellStr(row[hd.unit]) || null : null;
      const item_no = hd.item >= 0 ? cellStr(row[hd.item]) || null : null;
      if (qty == null && rate == null && amount == null) {
        if (BILL_HEADING.test(description) && bills.length <= 1) {
          section = description;
          continue;
        }
        items.push({ section, item_no, description, unit, qty: null, rate: null, amount: null });
        continue;
      }
      // lump sums (amount only) are measured as 1 sum
      if (qty == null && rate == null && amount != null) {
        qty = 1;
        rate = amount;
        unit = unit ?? 'sum';
      }
      items.push({ section, item_no, description, unit, qty, rate, amount: amount ?? (qty != null && rate != null ? Math.round(qty * rate * 100) / 100 : null) });
    }
    // trailing headings with nothing under them
    while (items.length && items[items.length - 1].qty == null) items.pop();
    const total = items.reduce((t, i) => t + (i.amount ?? 0), 0);
    return items.some((i) => i.amount) ? { name: sheet, items, total } : { name: sheet, items: [], total: 0, skipped: 'No priced items' };
  });
  return { fileName, sheets: out };
}

