// Display helpers. Sri Lanka uses UTC+05:30 all year (no daylight saving), so
// Asia/Colombo local time is computed with a fixed offset on every platform.
const OFFSET_MS = 330 * 60000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function colombo(value: string | number | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + OFFSET_MS);
}

/** Today's date in Colombo as YYYY-MM-DD. */
export function todayIso(): string {
  return colombo(Date.now())!.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

export function fmtDate(value?: string | null): string {
  if (!value) return '–';
  // plain dates are calendar dates already
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  const c = colombo(value);
  if (!c) return value;
  return `${c.getUTCDate()} ${MONTHS[c.getUTCMonth()]} ${c.getUTCFullYear()}`;
}

export function fmtTime(value?: string | null): string {
  if (!value) return '–';
  const c = colombo(value);
  if (!c) return value;
  return `${String(c.getUTCHours()).padStart(2, '0')}:${String(c.getUTCMinutes()).padStart(2, '0')}`;
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return '–';
  return `${fmtDate(value)} ${fmtTime(value)}`;
}

/** "YYYY-MM-DD HH:mm" in Colombo time, for editing. */
export function toLocalInput(value?: string | null): string {
  if (!value) return '';
  const c = colombo(value);
  return c ? c.toISOString().slice(0, 16).replace('T', ' ') : '';
}

/** Parse "YYYY-MM-DD HH:mm" (Colombo) into an ISO timestamp, or null. */
export function fromLocalInput(text: string): string | null {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h = '9', mi = '00'] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi) - OFFSET_MS;
  return Number.isNaN(utc) ? null : new Date(utc).toISOString();
}

export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(text + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(text);
}

export function fmtMoney(amount?: number | string | null, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') return '–';
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  const abs = Math.abs(n);
  const short = abs >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : abs >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : abs >= 1e4 ? `${(n / 1e3).toFixed(0)}K`
    : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${currency ?? ''} ${short}`.trim();
}

export function fmtNumber(n?: number | null): string {
  if (n === null || n === undefined) return '–';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}

export function relativeDue(due?: string | null): { label: string; overdue: boolean; soon: boolean } {
  if (!due) return { label: 'No due date', overdue: false, soon: false };
  const diff = daysBetween(todayIso(), due);
  if (diff < 0) return { label: `${-diff} day${diff === -1 ? '' : 's'} overdue`, overdue: true, soon: false };
  if (diff === 0) return { label: 'Due today', overdue: false, soon: true };
  if (diff === 1) return { label: 'Due tomorrow', overdue: false, soon: true };
  return { label: `Due ${fmtDate(due)}`, overdue: false, soon: diff <= 7 };
}
