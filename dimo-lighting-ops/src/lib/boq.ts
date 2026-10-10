import readXlsxFile from 'read-excel-file/universal';
import { bytesOf } from './finance';
import type { PickedFile } from './files';
import { parseBoqSheets, type ParsedBoq } from './boqParse';

export { parseBoqSheets, type ParsedBoq, type ParsedItem, type ParsedSheet } from './boqParse';

// Contract BOQ: upload (one sheet or split into bills / sections), measurement by quantity, Material on Site

export type Boq = {
  exec_project_id: string;
  status: 'submitted' | 'approved' | 'returned';
  version: number;
  file_name: string | null;
  sheets: string[] | null;
  total: number;
  mos_pct: number;
  uploaded_by: string | null;
  uploaded_at: string;
  submit_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

export type BoqItem = {
  id: string;
  exec_project_id: string;
  seq: number;
  section: string | null;
  item_no: string | null;
  description: string;
  unit: string | null;
  qty: number | null;
  rate: number | null;
  amount: number;
  heading: boolean;
  source: 'boq' | 'variation';
  variation_id: string | null;
  removed: boolean;
};

export const BOQ_STATUS: Record<Boq['status'], { label: string; tone: 'amber' | 'green' | 'red' }> = {
  submitted: { label: 'With SM Projects', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  returned: { label: 'Returned', tone: 'red' },
};

/** Item row as the AE sees it (no rates) */
export type MeasureItem = { id: string; section: string | null; item_no: string | null; description: string; unit: string | null; qty: number | null; heading: boolean; last_qty: number | null; source?: 'boq' | 'variation' };
export type StoreItem = { item: string; unit: string; balance: number };
export type ClaimContext = {
  boq: { status: Boq['status']; version: number; mos_pct: number } | null;
  items: MeasureItem[];
  store: StoreItem[];
  last_mos: { item: string; unit: string; qty: number; boq_item_id: string }[];
};

export type IpcDetail = {
  lines: { boq_item_id: string; section?: string; item_no?: string; description: string; unit?: string; boq_qty?: number; qty_to_date: number; prev_qty?: number; cert_qty?: number; source?: 'boq' | 'variation'; rate?: number; value?: number }[];
  mos: { item: string; unit: string; qty: number; boq_item_id: string; boq_item: string; rate?: number; value?: number }[];
  mos_pct?: number;
  values?: { work_value: number; mos_value: number; gross_value: number; previous_certified: number; previous_mos: number; suggested: number };
};

export type IpcValues = NonNullable<IpcDetail['values']> & { ipc_id: string };

export async function readBoqFile(file: PickedFile): Promise<ParsedBoq> {
  const sheets = await readXlsxFile(await bytesOf(file));
  const p = parseBoqSheets(sheets as { sheet: string; data: unknown[][] }[], file.name);
  if (!p.sheets.some((s) => !s.skipped)) throw new Error('No BOQ found – each bill needs Description, Qty and Rate column headings');
  return p;
}

/** Items grouped by section, in order */
export function bySection<T extends { section: string | null }>(items: T[]) {
  const out: { section: string; items: T[] }[] = [];
  for (const i of items) {
    const s = i.section ?? 'BOQ';
    const g = out[out.length - 1];
    if (g && g.section === s) g.items.push(i);
    else out.push({ section: s, items: [i] });
  }
  return out;
}

/** Progress per BOQ item (boq_progress): contract quantity, measured to date (last measurement), the one before, certified to date */
export type BoqProgress = {
  last: { id: string; code: string; period: string; status: string } | null;
  certified: { id: string; code: string; period: string; cert_date: string | null } | null;
  certified_total: number | null;
  items: {
    id: string;
    section: string | null;
    item_no: string | null;
    description: string;
    unit: string | null;
    qty: number | null;
    heading: boolean;
    source: 'boq' | 'variation';
    variation_id?: string;
    to_date?: number;
    prev?: number;
    cert?: number;
    rate?: number;
    amount?: number;
  }[];
};
