import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import readXlsxFile from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/universal';
import type { PickedFile } from './files';
import { todayISO } from './format';
import { cellStr, monthOf, norm, parseDate, parseMonth, parseNum, parseOrSheets, type OrParsed } from './orParse';
import type { Role } from './types';

export { fmtMonth, fmtMonthShort, monthOf, parseDate, parseMonth, parseNum, wbsBase, type OrParsed } from './orParse';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type BusinessLine = 'infrastructure' | 'lms' | 'indoor';
export type InvoiceKind = 'advance' | 'delivery' | 'progress' | 'tc' | 'handover' | 'retention' | 'variation' | 'other';

export type BudgetProject = {
  id: string;
  fy: number;
  row_no: number | null;
  business_line: BusinessLine;
  project_id: string | null;
  project_name: string;
  customer: string | null;
  sales_person_id: string | null;
  wbs: string | null;
  budget_value: number;
  budget_gp_pct: number | null;
  order_month: string | null;
  notes: string | null;
};
export type BudgetInvoice = { id: number; budget_id: string; month: string; amount: number };

export type SecuredProject = {
  id: string;
  code: string | null;
  project_id: string | null;
  project_name: string;
  customer: string | null;
  business_line: BusinessLine | null;
  sales_person_id: string | null;
  wbs: string | null;
  po_no: string | null;
  order_value: number | null;
  won_on: string;
  source: 'won' | 'opening';
  billed_before: number;
  budget_id: string | null;
  schedule_status: 'missing' | 'review' | 'approved';
  submitted_at: string | null;
  approved_at: string | null;
  review_note: string | null;
  status: 'open' | 'closed' | 'cancelled';
  notes: string | null;
  created_at: string;
  original_value?: number | null;
  final_at?: string | null;
};

/** A change to the contract value: + addition / − omission (VO), or the final-account adjustment. */
export type Variation = {
  id: string;
  secured_id: string;
  kind: 'variation' | 'final_account';
  vo_no: string | null;
  amount: number;
  month: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

export type InvoiceLine = {
  id: string;
  secured_id: string;
  seq: number;
  kind: InvoiceKind;
  description: string | null;
  trigger_note: string | null;
  amount: number;
  original_month: string;
  forecast_month: string;
  moves: number;
  // invoice_line_status
  sales_person_id: string | null;
  project_name: string;
  customer: string | null;
  business_line: BusinessLine | null;
  schedule_status: SecuredProject['schedule_status'];
  project_status: SecuredProject['status'];
  invoiced: number;
  remaining: number;
  pending_change_id: number | null;
  pending_month: string | null;
};

export type LineChange = {
  id: number;
  line_id: string;
  from_month: string;
  to_month: string;
  reason: string;
  note: string | null;
  status: 'recorded' | 'pending' | 'approved' | 'rejected';
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decision_note: string | null;
};

export type Allocation = { id: number; upload_id: string; month: string; secured_id: string; line_id: string | null; amount: number; manual: boolean };

export type OrUpload = {
  id: string;
  month: string;
  fy: number;
  file_name: string | null;
  net_turnover: number | null;
  net_profit: number | null;
  invoiced_wbs: number | null;
  uploaded_by: string | null;
  created_at: string;
};
export type PnlLine = {
  upload_id: string;
  seq: number;
  section: 'capital' | 'kpi' | 'shared' | 'pnl';
  label: string;
  rank: string | null;
  ly_cum: number | null;
  m_act: number | null;
  m_bud: number | null;
  c_act: number | null;
  c_bud: number | null;
  fy_bp: number | null;
};
export type WbsActual = { upload_id: string; wbs: string; revenue: number; cost: number };

export type PerfMonth = { month: string; secured_target: number; invoice_target: number; secured: number; invoiced: number };
export type PerfPerson = {
  id: string;
  name: string;
  role: Role;
  lines: BusinessLine[];
  to_bill_fy: number;
  pending_n: number;
  pending_value: number;
  months: PerfMonth[];
};
export type Performance = {
  fy: number;
  latest_month: string | null;
  people: PerfPerson[];
  targets_status: 'draft' | 'submitted' | 'approved' | 'returned' | null;
  unlinked_invoiced: number | null;
};

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
export const seesPnl = (r: Role) => r === 'gm' || r === 'sm_projects' || r === 'sm_estimation';
export const seesFinance = (r: Role) => seesPnl(r) || r === 'operations_exec';
export const isFinanceDesk = (r: Role) => r === 'gm' || r === 'sm_projects' || r === 'operations_exec';
export const isReviewer = (r: Role) => r === 'gm' || r === 'sm_projects';

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
export const LINES: { value: BusinessLine; label: string; short: string; colour: string }[] = [
  { value: 'infrastructure', label: 'Infrastructure', short: 'Infra', colour: '#1D4ED8' },
  { value: 'lms', label: 'Building Lighting – LMS', short: 'LMS', colour: '#7C3AED' },
  { value: 'indoor', label: 'Building Lighting – Indoor', short: 'Indoor', colour: '#0F766E' },
];
export const lineLabel = (l?: string | null) => LINES.find((x) => x.value === l)?.label ?? '—';
export const lineShort = (l?: string | null) => LINES.find((x) => x.value === l)?.short ?? '—';
export const lineColour = (l?: string | null) => LINES.find((x) => x.value === l)?.colour ?? '#9CA3AF';

export const KINDS: { value: InvoiceKind; label: string }[] = [
  { value: 'advance', label: 'Advance' },
  { value: 'delivery', label: 'Material delivery' },
  { value: 'progress', label: 'Progress (RA) bill' },
  { value: 'tc', label: 'Testing & commissioning' },
  { value: 'handover', label: 'Handover' },
  { value: 'retention', label: 'Retention release' },
  { value: 'variation', label: 'Variation' },
  { value: 'other', label: 'Other' },
];
export const kindLabel = (k?: string | null) => KINDS.find((x) => x.value === k)?.label ?? 'Invoice';

export const MOVE_REASONS = [
  'Client delay',
  'Site not ready',
  'Material / shipment delay',
  'Design change',
  'Payment terms',
  'Awaiting certification / approval',
  'Other',
];

/** Ready-made invoice patterns (percent of the order value, months after the order). Adjust after choosing one. */
export const PATTERNS: { key: string; label: string; parts: { kind: InvoiceKind; pct: number; after: number; description: string }[] }[] = [
  { key: 'supply', label: 'Supply only – 100% on delivery', parts: [{ kind: 'delivery', pct: 100, after: 1, description: 'Delivery' }] },
  {
    key: 'supply_install',
    label: 'Supply & install – advance, delivery, progress, retention',
    parts: [
      { kind: 'advance', pct: 20, after: 0, description: 'Advance 20%' },
      { kind: 'delivery', pct: 60, after: 2, description: 'Material delivery 60%' },
      { kind: 'progress', pct: 15, after: 4, description: 'Progress bill 15%' },
      { kind: 'retention', pct: 5, after: 16, description: 'Retention 5%' },
    ],
  },
  {
    key: 'infra',
    label: 'Infrastructure – advance, progress (RA) bills, retention',
    parts: [
      { kind: 'advance', pct: 20, after: 0, description: 'Advance 20%' },
      { kind: 'progress', pct: 25, after: 3, description: 'RA bill 1' },
      { kind: 'progress', pct: 25, after: 5, description: 'RA bill 2' },
      { kind: 'tc', pct: 20, after: 7, description: 'T&C and handover' },
      { kind: 'retention', pct: 10, after: 19, description: 'Retention 10%' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Months and financial years (April – March)
// ---------------------------------------------------------------------------
export const thisMonth = () => monthOf(todayISO());
export function fyOf(iso: string) {
  const y = Number(iso.slice(0, 4));
  return Number(iso.slice(5, 7)) >= 4 ? y : y - 1;
}
export const fyLabel = (fy: number) => `FY ${fy}/${String((fy + 1) % 100).padStart(2, '0')}`;
export const fyStart = (fy: number) => `${fy}-04-01`;
export const fyEnd = (fy: number) => `${fy + 1}-03-31`;
export function addMonths(iso: string, n: number) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
}
export const fyMonths = (fy: number) => Array.from({ length: 12 }, (_, i) => addMonths(fyStart(fy), i));
export const inFy = (iso: string, fy: number) => iso >= fyStart(fy) && iso <= fyEnd(fy);

// ---------------------------------------------------------------------------
// Money in millions for cards and tables
// ---------------------------------------------------------------------------
export function mn(n?: number | null, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  const v = n / 1_000_000;
  const s = Math.abs(v).toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${v < 0 ? '–' : ''}${s}`;
}
export const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
export const fmtPct = (n: number | null | undefined, digits = 0) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}%`);

/** Score = 40 % secured + 60 % invoiced (each % of its year-to-date target) */
export function score(securedPct: number, invoicedPct: number) {
  return 0.4 * securedPct + 0.6 * invoicedPct;
}

/** Year-to-date totals of a person up to (and including) a month */
export function ytd(p: PerfPerson, upTo: string | null) {
  const ms = p.months.filter((m) => !upTo || m.month <= upTo);
  const sum = (k: keyof PerfMonth) => ms.reduce((a, m) => a + Number(m[k] ?? 0), 0);
  const fySum = (k: keyof PerfMonth) => p.months.reduce((a, m) => a + Number(m[k] ?? 0), 0);
  const st = sum('secured_target');
  const s = sum('secured');
  const it = sum('invoice_target');
  const i = sum('invoiced');
  const fyInvTarget = fySum('invoice_target');
  const fyInvoiced = fySum('invoiced');
  const cover = fyInvTarget ? ((fyInvoiced + p.to_bill_fy) / fyInvTarget) * 100 : 0;
  return {
    securedTarget: st,
    secured: s,
    securedPct: pct(s, st),
    invoiceTarget: it,
    invoiced: i,
    invoicedPct: pct(i, it),
    fyInvoiceTarget: fyInvTarget,
    fySecuredTarget: fySum('secured_target'),
    fyInvoiced,
    toBill: p.to_bill_fy,
    cover,
    gap: Math.max(0, fyInvTarget - fyInvoiced - p.to_bill_fy),
    score: score(pct(s, st), pct(i, it)),
  };
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
async function bytesOf(file: PickedFile): Promise<ArrayBuffer> {
  if (file.webFile) return file.webFile.arrayBuffer();
  if (Platform.OS === 'web') return (await fetch(file.uri)).arrayBuffer();
  return new FsFile(file.uri).arrayBuffer();
}

export async function downloadXlsx(fileName: string, header: string[], rows: (string | number | null)[][] = []) {
  const data = [
    header.map((h) => ({ value: h, fontWeight: 'bold' as const })),
    ...rows.map((r) => r.map((v) => ({ value: v ?? '' }))),
  ];
  const blob = await writeXlsxFile(data as never).toBlob();
  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const f = new FsFile(Paths.cache, fileName);
        f.create({ overwrite: true });
        f.write(String(reader.result).split(',')[1] ?? '', { encoding: 'base64' });
        await Sharing.shareAsync(f.uri);
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsDataURL(blob);
  });
}

const INVOICE_COLS = 6;
const invoiceHeaders = () => Array.from({ length: INVOICE_COLS }, (_, i) => [`Invoice ${i + 1} month`, `Invoice ${i + 1} amount`]).flat();

export const BUDGET_TEMPLATE = [
  'Business line',
  'Project name',
  'Customer',
  'Sales person',
  'WBS (optional)',
  'Budget value (LKR)',
  'Budget GP %',
  'Order month',
  ...invoiceHeaders(),
  'Notes',
];
export const OPENING_TEMPLATE = [
  'Project name',
  'Customer',
  'Business line',
  'Sales person',
  'PO / contract no.',
  'WBS',
  'Order value (LKR)',
  'Won (PO) date',
  'Invoiced before 1 April (LKR)',
  ...invoiceHeaders(),
];

type Invoice = { month: string; amount: number };
export type ListRow = Record<string, unknown> & { row_no: number; invoices: Invoice[] };

/** Reads the first sheet of a list upload. Columns are found by their heading; "Invoice N month / amount" pairs repeat. */
async function readList(file: PickedFile, fields: Record<string, string[]>, required: string[]): Promise<{ rows: ListRow[]; problems: string[] }> {
  const sheets = await readXlsxFile(await bytesOf(file));
  const data = sheets[0]?.data ?? [];
  if (!data.length) throw new Error('The file is empty');
  // The heading row is the first row that has one of the required headings
  const hi = data.findIndex((r) => r.some((c) => required.some((k) => fields[k].includes(norm(c)))));
  if (hi < 0) throw new Error('Headings not found – use the template');
  const header = data[hi].map(norm);
  const col: Record<string, number> = {};
  Object.entries(fields).forEach(([k, names]) => {
    col[k] = header.findIndex((h) => names.includes(h));
  });
  const missing = required.filter((k) => col[k] < 0);
  if (missing.length) throw new Error(`Missing columns: ${missing.map((k) => fields[k][0]).join(', ')}. Use the template.`);
  const inv: { m: number; a: number }[] = [];
  header.forEach((h, i) => {
    const mm = h.match(/^invoice (\d+) month$/);
    if (mm) inv.push({ m: i, a: header.indexOf(`invoice ${mm[1]} amount`) });
  });
  const problems: string[] = [];
  const rows = data
    .slice(hi + 1)
    .map((r, i) => ({ r, n: hi + i + 2 }))
    .filter(({ r }) => r.some((c) => cellStr(c) !== ''))
    .map(({ r, n }) => {
      const o: ListRow = { row_no: n, invoices: [] };
      Object.keys(fields).forEach((k) => {
        const v = col[k] >= 0 ? r[col[k]] : null;
        o[k] = v instanceof Date ? v.toISOString().slice(0, 10) : cellStr(v);
      });
      inv.forEach(({ m, a }) => {
        const month = parseMonth(r[m]);
        const amount = a >= 0 ? parseNum(r[a]) : null;
        if (month && amount != null && amount !== 0) o.invoices.push({ month, amount });
        else if ((cellStr(r[m]) !== '') !== (a >= 0 && cellStr(r[a]) !== '')) problems.push(`Row ${n}: an invoice has a month without an amount (or the reverse)`);
        else if (cellStr(r[m]) !== '' && !month) problems.push(`Row ${n}: invoice month "${cellStr(r[m])}" not understood – use e.g. Oct 2026`);
      });
      return o;
    });
  return { rows, problems };
}

export async function readBudgetFile(file: PickedFile) {
  const { rows, problems } = await readList(
    file,
    {
      business_line: ['business line', 'line'],
      project_name: ['project name', 'project'],
      customer: ['customer', 'client'],
      sales_person: ['sales person', 'salesperson', 'sales'],
      wbs: ['wbs', 'wbs element', 'wbs no'],
      budget_value: ['budget value', 'value', 'budget'],
      budget_gp_pct: ['budget gp %', 'gp %', 'budget gp'],
      order_month: ['order month', 'expected order month'],
      notes: ['notes', 'remarks'],
    },
    ['project_name', 'business_line', 'budget_value'],
  );
  return {
    problems,
    rows: rows.map((r) => ({
      ...r,
      budget_value: parseNum(r.budget_value) ?? r.budget_value,
      budget_gp_pct: parseNum(r.budget_gp_pct),
      order_month: parseMonth(r.order_month),
    })),
  };
}

export async function readOpeningFile(file: PickedFile) {
  const { rows, problems } = await readList(
    file,
    {
      project_name: ['project name', 'project'],
      customer: ['customer', 'client'],
      business_line: ['business line', 'line'],
      sales_person: ['sales person', 'salesperson', 'sales'],
      po_no: ['po contract no', 'po no', 'contract no', 'po'],
      wbs: ['wbs', 'wbs element', 'wbs no'],
      order_value: ['order value', 'contract value', 'po value'],
      won_on: ['won date', 'po date', 'order date'],
      billed_before: ['invoiced before 1 april', 'invoiced before', 'billed before'],
    },
    ['project_name', 'order_value'],
  );
  return {
    problems,
    rows: rows.map((r) => ({ ...r, order_value: parseNum(r.order_value) ?? r.order_value, billed_before: parseNum(r.billed_before) ?? 0, won_on: parseDate(r.won_on) })),
  };
}

export async function readOrFile(file: PickedFile): Promise<OrParsed> {
  return parseOrSheets(await readXlsxFile(await bytesOf(file)));
}

// ---------------------------------------------------------------------------
// P&L helpers
// ---------------------------------------------------------------------------
/** Higher is better for income and profit lines; lower is better for costs */
export const isIncomeLine = (label: string) => /turnover|proceeds|profit|income|service support/i.test(label) && !/^sscl|tax/i.test(label);

/** The headline P&L: total rows (no rank) of the P&L section, each with the detail rows above it */
export function pnlGroups(lines: PnlLine[]) {
  const rows = lines.filter((l) => l.section === 'pnl').sort((a, b) => a.seq - b.seq);
  const groups: { total: PnlLine; detail: PnlLine[] }[] = [];
  let buf: PnlLine[] = [];
  rows.forEach((l) => {
    if (l.rank) buf.push(l);
    else {
      groups.push({ total: l, detail: buf });
      buf = [];
    }
  });
  return groups;
}

export const findLine = (lines: PnlLine[], label: string, section?: PnlLine['section'], first = false) => {
  const want = norm(label);
  const hits = lines.filter((l) => norm(l.label) === want && (!section || l.section === section));
  // Prefer a row that has numbers (headings repeat the same words)
  const withNumbers = hits.filter((h) => h.c_act != null || h.m_act != null);
  return (first ? withNumbers[0] : withNumbers[withNumbers.length - 1]) ?? hits[hits.length - 1] ?? null;
};
