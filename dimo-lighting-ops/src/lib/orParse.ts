// Pure parsing helpers (no app imports) – used by the finance screens and checked against real files in tests.

export type OrPnlLine = {
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

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;
export const fmtMonth = (iso?: string | null) => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '—');
export const fmtMonthShort = (iso: string) => MON[Number(iso.slice(5, 7)) - 1];
/** "Oct 2026", "October-2026", "2026-10", "10/2026", an Excel date … → 2026-10-01 */
export function parseMonth(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return monthOf(v.toISOString().slice(0, 10));
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-01`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}-01`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-01`;
  m = s.match(/^([A-Za-z]{3,9})[\s\-/.,']*(\d{2}|\d{4})$/);
  if (m) {
    const i = MON.findIndex((x) => x.toLowerCase() === m![1].slice(0, 3).toLowerCase());
    if (i >= 0) {
      const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
      return `${y}-${String(i + 1).padStart(2, '0')}-01`;
    }
  }
  return null;
}
const monIdx = (t: string) => MON.findIndex((x) => x.toLowerCase() === t.slice(0, 3).toLowerCase());
const yyyy = (y: string) => (y.length === 2 ? `20${y}` : y);
/** Excel stores dates as days since 30 Dec 1899. */
function excelSerial(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
}
export function parseDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return excelSerial(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/);
  if (m) {
    // Day first (17/07/2026); a "day" over 12 means the month came first (7/17/2026)
    const [d, mo] = Number(m[2]) > 12 && Number(m[1]) <= 12 ? [m[2], m[1]] : [m[1], m[2]];
    return Number(mo) >= 1 && Number(mo) <= 12 ? `${yyyy(m[3])}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}` : null;
  }
  // 17-Jul-2026, 17 Jul 26
  m = s.match(/^(\d{1,2})[-/. ]+([A-Za-z]{3,9})[-/., ]+(\d{4}|\d{2})$/);
  if (m && monIdx(m[2]) >= 0) return `${yyyy(m[3])}-${String(monIdx(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // July 17, 2026
  m = s.match(/^([A-Za-z]{3,9})[ .]+(\d{1,2}),?[ ]+(\d{4})$/);
  if (m && monIdx(m[1]) >= 0) return `${m[3]}-${String(monIdx(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  // Excel date serial number kept as a number / text
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerial(Number(s));
  return parseMonth(s);
}
export function parseNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : null;
}

export const norm = (h: unknown) =>
  String(h ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
export const cellStr = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

// ---------------------------------------------------------------------------
// The monthly OR file: the P&L sheet (e.g. "2230") and the trial balance sheet (e.g. "TB-Aug")
// ---------------------------------------------------------------------------
export type OrParsed = {
  month: string | null;
  pnl: OrPnlLine[];
  wbs: { wbs: string; revenue: number; cost: number }[];
  pnlSheet: string;
  tbSheet: string | null;
  tbLines: number;
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const wbsBase = (w: string) => (w.trim().match(/^([A-Za-z]+-\d+)/)?.[1] ?? w.trim()).toUpperCase();

export function parseOrSheets(sheets: { sheet: string; data: unknown[][] }[]): OrParsed {
  const pnlSheet = sheets.find((s) => s.data.some((r) => norm(r[1]) === 'line item') && s.data.some((r) => norm(r[1]) === 'net profit'));
  if (!pnlSheet) throw new Error('The P&L sheet (with "Line item" and "Net Profit") was not found');
  const pnl: OrParsed['pnl'] = [];
  let section: OrPnlLine['section'] = 'capital';
  let month: string | null = null;
  pnlSheet.data.forEach((r, i) => {
    const label = cellStr(r[1]);
    // "August  Month- Act 2026/27" → the month
    if (!month) {
      const h = r.map(cellStr).find((c) => /month\s*-\s*act/i.test(c));
      const mm = h?.match(/([A-Za-z]+)\s+Month.*?(\d{4})\s*\/\s*\d{2}/i);
      if (mm) {
        const mi = MON.findIndex((x) => x.toLowerCase() === mm[1].slice(0, 3).toLowerCase());
        if (mi >= 0) month = `${mi + 1 >= 4 ? Number(mm[2]) : Number(mm[2]) + 1}-${String(mi + 1).padStart(2, '0')}-01`;
      }
    }
    if (!label) return;
    if (norm(label) === 'line item') {
      if (norm(r[2]) === 'rank') section = 'pnl';
      return;
    }
    if (section !== 'pnl') {
      if (norm(label) === 'performance indicators') section = 'kpi';
      else if (norm(label) === 'centralised services costs') section = 'shared';
    }
    const vals = [r[0], r[3], r[4], r[5], r[6], r[7]].map(num);
    pnl.push({
      seq: i + 1,
      section,
      label: label.replace(/\s+/g, ' '),
      rank: r[2] == null || r[2] === '' ? null : String(r[2]),
      ly_cum: vals[0],
      m_act: vals[1],
      m_bud: vals[2],
      c_act: vals[3],
      c_bud: vals[4],
      fy_bp: vals[5],
    });
  });

  const tb = sheets.find((s) => s !== pnlSheet && s.data.slice(0, 5).some((r) => r.map(norm).includes('wbs element')));
  const by = new Map<string, { revenue: number; cost: number }>();
  let tbLines = 0;
  if (tb) {
    const hi = tb.data.findIndex((r) => r.map(norm).includes('wbs element'));
    const h = tb.data[hi].map(norm);
    const ci = (name: string) => h.indexOf(name);
    const iGl = ci('g l account');
    const iAmt = h.findIndex((x) => x.startsWith('company code currency value') || x === 'amount');
    const iWbs = ci('wbs element');
    const iDate = ci('posting date');
    tb.data.slice(hi + 1).forEach((r) => {
      const w = cellStr(r[iWbs]);
      const amt = num(r[iAmt]);
      if (!month && iDate >= 0 && r[iDate]) month = parseMonth(r[iDate]);
      if (!w || amt == null || cellStr(r[iGl]) === '') return;
      tbLines += 1;
      const key = wbsBase(w);
      const cur = by.get(key) ?? { revenue: 0, cost: 0 };
      // Revenue accounts are 3xxxxx (credit = negative); everything else on the WBS is cost
      if (cellStr(r[iGl]).startsWith('3')) cur.revenue += -amt;
      else cur.cost += amt;
      by.set(key, cur);
    });
  }
  return {
    month,
    pnl,
    wbs: [...by.entries()].map(([wbs, v]) => ({ wbs, revenue: Math.round(v.revenue * 100) / 100, cost: Math.round(v.cost * 100) / 100 })),
    pnlSheet: pnlSheet.sheet,
    tbSheet: tb?.sheet ?? null,
    tbLines,
  };
}

