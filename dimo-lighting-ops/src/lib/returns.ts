import { colors } from '@/components/ui';

/** Project returns: balance material left over from projects, kept beside the SAP stock. */
export type ReturnItem = {
  id: string;
  code: string | null;
  item: string;
  mpn: string | null;
  unit: string;
  category: string | null;
  condition: 'new' | 'good' | 'used' | 'damaged';
  location: string | null;
  source: string | null;
  source_exec_project_id: string | null;
  note: string | null;
  origin: 'manual' | 'upload' | 'dlp';
  created_at: string;
  received: number;
  balance: number;
  reserved: number;
  available: number;
  last_move: string | null;
};
export type ReturnMove = { id: string; item_id: string; kind: 'in' | 'out' | 'adjust'; qty: number; note: string | null; by_id: string | null; at: string; exec_project_id: string | null };

export const CONDITIONS = [
  { value: 'new', label: 'New (unused, in packing)' },
  { value: 'good', label: 'Good' },
  { value: 'used', label: 'Used' },
  { value: 'damaged', label: 'Damaged' },
];
export const conditionTone = (c: string) => (c === 'new' ? colors.green : c === 'good' ? colors.blue : c === 'used' ? colors.amber : colors.red);
export const ORIGIN: Record<ReturnItem['origin'], string> = { manual: 'Added', upload: 'Excel upload', dlp: 'Leftover at handover' };

/** A match in the SAP stock or the Project returns, shown when choosing material */
export type StockMatch = {
  source: 'sap' | 'returns';
  ref: string;
  item: string | null;
  mpn: string | null;
  unit: string | null;
  available: number;
  as_at: string | null;
  location: string | null;
  condition: string | null;
  age: string | null;
  score: number;
};

/** Excel template for the Project returns upload */
export const RETURNS_TEMPLATE = ['Description', 'Part number', 'Unit', 'Quantity', 'Condition (new/good/used/damaged)', 'Kept at', 'Source project', 'Category', 'Note'];
const KEYS = ['item', 'mpn', 'unit', 'qty', 'condition', 'location', 'source_text', 'category', 'note'] as const;
const norm = (h: unknown) => String(h ?? '').toLowerCase().replace(/\(.*?\)/g, '').trim();

export function parseReturnsSheet(sheet: unknown[][]) {
  const hi = sheet.findIndex((r) => r.some((c) => norm(c) === 'description') && r.some((c) => norm(c) === 'quantity'));
  if (hi < 0) throw new Error('Use the Project returns template – the "Description" and "Quantity" columns were not found');
  const header = sheet[hi].map(norm);
  const idx = RETURNS_TEMPLATE.map((t) => header.indexOf(norm(t)));
  return sheet
    .slice(hi + 1)
    .filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
    .map((r) => {
      const o: Record<string, string> = {};
      KEYS.forEach((k, i) => (o[k] = idx[i] >= 0 && r[idx[i]] != null ? String(r[idx[i]]).trim() : ''));
      return o;
    });
}
