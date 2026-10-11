import { colors } from '@/components/ui';

/** The SAP stock ageing report, kept as monthly snapshots (Operations uploads; values only for GM / DGM, SM Projects, Operations). */

export const AGE_BANDS = [
  { key: 1, label: '0–90 days', short: '0–90', max: 90, tone: '#16A34A' },
  { key: 2, label: '91–180 days', short: '91–180', max: 180, tone: '#65A30D' },
  { key: 3, label: '181–360 days', short: '181–360', max: 360, tone: '#CA8A04' },
  { key: 4, label: '361–540 days', short: '361–540', max: 540, tone: '#EA580C' },
  { key: 5, label: '541–720 days', short: '541–720', max: 720, tone: '#DC2626' },
  { key: 6, label: 'Over 720 days', short: '> 720', max: Infinity, tone: '#991B1B' },
] as const;
export type Band = (typeof AGE_BANDS)[number]['key'];

export type StockLine = {
  material: string;
  old_material: string | null;
  mpn: string | null;
  description: string | null;
  uom: string | null;
  category: string | null;
  sub_category: string | null;
  class: string | null;
  sub_class: string | null;
  brand: string | null;
  corrected: boolean;
  qty: number;
  value: number | null;
  unit_cost: number | null;
  q1: number; q2: number; q3: number; q4: number; q5: number; q6: number;
  v1: number | null; v2: number | null; v3: number | null; v4: number | null; v5: number | null; v6: number | null;
  flags: string[];
  prev_qty: number | null;
  prev_value: number | null;
};
export type Snapshot = {
  id: string;
  as_at: string;
  profit_center: string;
  item_count: number;
  total_qty: number;
  total_value: number | null;
  aged_1y_value: number | null;
  aged_2y_value: number | null;
  confirmed_at: string;
  replace_reason: string | null;
};

export const bandQty = (l: StockLine, b: Band) => Number(l[`q${b}` as const] ?? 0);
export const bandValue = (l: StockLine, b: Band) => (l[`v${b}` as const] == null ? null : Number(l[`v${b}` as const]));
/** The oldest age band that holds stock for the line */
export const oldestBand = (l: StockLine): Band => ([6, 5, 4, 3, 2, 1] as Band[]).find((b) => bandQty(l, b) > 0) ?? 1;
export const bandOf = (b: Band) => AGE_BANDS[b - 1];
export const flagLabel: Record<string, { label: string; tone: string }> = {
  uncategorised: { label: 'No SAP category', tone: colors.amber },
  ageing_mismatch: { label: 'Ageing ≠ closing stock', tone: colors.red },
  sap_na: { label: 'SAP #N/A', tone: colors.grey },
};

// ---------------------------------------------------------------------------
// Reading the SAP Excel file: the header row is found by its names, so column order does not matter
// ---------------------------------------------------------------------------
type Cell = string | number | boolean | Date | null | undefined;
export type ParsedStock = {
  meta: { as_at: string; profit_center: string; company_code: string | null; title: string | null };
  rows: Record<string, string | number | boolean | null>[];
  columnsUsed: number;
  columnsIgnored: string[];
};

const norm = (v: Cell) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
const num = (v: Cell) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
const text = (v: Cell) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim() || null);
const isoDate = (v: Cell) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = String(v ?? '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

const FIELDS: Record<string, string[]> = {
  material: ['MATERIAL'],
  old_material: ['OLD MATERIAL NUMBER'],
  mpn: ['MANUFACTURE PART NUM', 'MANUFACTURER PART NUMBER', 'MANUFACTURER PART NUM'],
  description: ['DESCRIPTION', 'MATERIAL DESCRIPTION'],
  uom: ['UOM', 'UNIT'],
  category: ['CATEGORY'],
  sub_category: ['SUB-CATEGORY', 'SUB CATEGORY'],
  class: ['CLASS'],
  sub_class: ['SUB-CLASS', 'SUB CLASS'],
  brand: ['BRAND_NAME', 'BRAND NAME', 'BRAND'],
  qty: ['CLOSING STOCK'],
  value: ['CLOSING VALUE'],
  unit_cost: ['PLANT UNIT COST'],
  currency: ['CURRENCY'],
  profit_center: ['PROFIT CTR', 'PROFIT CENTER', 'PROFIT CENTRE'],
  company_code: ['COMPANY CODE'],
  to_date: ['TO DATE'],
  last_pc: ['LAST MONTH PC'],
};

/** SAP age band header ("0 to 30 DAYS", "61 to 90 DAY VALUE", "ABOVE 721 DAYS VALUE") → our band and whether it is the value column */
function sapBand(h: string): { band: Band; value: boolean } | null {
  if (!/DAY/.test(h)) return null;
  const value = /VALU/.test(h);
  const above = h.match(/ABOVE\s+(\d+)/);
  const range = h.match(/(\d+)\s*TO\s*(\d+)/);
  const upper = above ? Infinity : range ? Number(range[2]) : null;
  if (upper == null) return null;
  const band = AGE_BANDS.find((b) => upper <= b.max)!.key;
  return { band, value };
}

export function parseStockSheet(sheet: Cell[][]): ParsedStock {
  const hi = sheet.findIndex((r) => r.some((c) => norm(c) === 'MATERIAL') && r.some((c) => norm(c) === 'CLOSING STOCK'));
  if (hi < 0) throw new Error('This does not look like the SAP stock report – the "Material" and "Closing Stock" columns were not found');
  const header = sheet[hi].map(norm);
  const col: Record<string, number> = {};
  for (const [k, names] of Object.entries(FIELDS)) col[k] = header.findIndex((h) => names.includes(h));
  const missing = ['material', 'description', 'qty'].filter((k) => col[k] < 0);
  if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);
  const bands = header.map((h) => sapBand(h));
  const used = new Set([...Object.values(col).filter((i) => i >= 0), ...bands.flatMap((b, i) => (b ? [i] : []))]);
  const title = sheet.slice(0, hi).flat().map((c) => text(c)).find(Boolean) ?? null;

  const rows: ParsedStock['rows'] = [];
  let asAt: string | null = null;
  let pc: string | null = null;
  let cc: string | null = null;
  for (const r of sheet.slice(hi + 1)) {
    const material = text(r[col.material]);
    if (!material || !/\d/.test(material)) continue; // blank and total lines
    asAt ??= col.to_date >= 0 ? isoDate(r[col.to_date]) : null;
    pc ??= col.profit_center >= 0 ? text(r[col.profit_center]) : null;
    cc ??= col.company_code >= 0 ? text(r[col.company_code]) : null;
    const o: ParsedStock['rows'][number] = {
      material,
      old_material: text(r[col.old_material]),
      mpn: text(r[col.mpn]),
      description: text(r[col.description]),
      uom: text(r[col.uom]),
      category: text(r[col.category]),
      sub_category: text(r[col.sub_category]),
      class: text(r[col.class]),
      sub_class: text(r[col.sub_class]),
      brand: text(r[col.brand]),
      qty: num(r[col.qty]),
      value: col.value >= 0 ? num(r[col.value]) : 0,
      unit_cost: col.unit_cost >= 0 ? num(r[col.unit_cost]) : null,
      currency: text(r[col.currency]),
      // SAP's #N/A arrives as an empty cell
      sap_na: col.last_pc >= 0 && (r[col.last_pc] == null || String(r[col.last_pc]).includes('#N/A')),
      q1: 0, v1: 0, q2: 0, v2: 0, q3: 0, v3: 0, q4: 0, v4: 0, q5: 0, v5: 0, q6: 0, v6: 0,
    };
    bands.forEach((b, i) => {
      if (!b) return;
      const k = `${b.value ? 'v' : 'q'}${b.band}`;
      o[k] = Number(o[k]) + num(r[i]);
    });
    rows.push(o);
  }
  // As-at date: the "To Date" column, else the date in the title ("… AS AT 30-09-2026")
  if (!asAt && title) asAt = isoDate(title.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/)?.[1] ?? '');
  if (!asAt) throw new Error('The stock date was not found (no "To Date" column and no date in the title)');
  if (!pc) throw new Error('The profit centre was not found');
  return {
    meta: { as_at: asAt, profit_center: pc, company_code: cc, title },
    rows,
    columnsUsed: used.size,
    columnsIgnored: header.filter((h, i) => h && !used.has(i)),
  };
}
