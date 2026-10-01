import type { Currency, SlaColour } from './types';

const TZ = 'Asia/Colombo';

export function fmtDate(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? `${v}T00:00:00+05:30` : v);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
}

export function fmtDateTime(v?: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
}

export function fmtMoney(amount?: number | null, currency?: Currency | null) {
  if (amount == null) return '—';
  const cur = currency ?? 'LKR';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${cur} ${(amount / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `${cur} ${(amount / 1_000).toFixed(1)}K`;
  return `${cur} ${amount.toFixed(0)}`;
}

export function fmtNumber(n?: number | null, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-GB', { maximumFractionDigits: digits });
}

/** Today's date in Sri Lanka as YYYY-MM-DD */
export function todayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

/** A timestamp's date in Sri Lanka as YYYY-MM-DD */
export function fmtDateISO(v: string) {
  return new Date(v).toLocaleDateString('en-CA', { timeZone: TZ });
}

export function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing the date */
export function mondayOf(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDaysISO(iso, -dow);
}

export function daysBetween(fromISO: string, toISO: string) {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000);
}

/** YYYY-MM-DD at 17:30 Colombo → ISO timestamp (end of working day) */
export function endOfWorkDay(iso: string) {
  return new Date(`${iso}T17:30:00+05:30`).toISOString();
}

export function isISODate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

export const human = (s?: string | null) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—');

export const SLA_COLOURS: Record<SlaColour, string> = {
  green: '#1E8E3E',
  amber: '#E8A317',
  red: '#C62828',
  grey: '#8A8F98',
};

// Debtors ageing colours (Section 12.3)
export const AGEING_COLOURS: Record<string, { bg: string; fg: string; border?: string; label: string }> = {
  '1-30': { bg: '#2E7D32', fg: '#fff', label: '1–30' },
  '31-60': { bg: '#9CCC65', fg: '#1B1B1B', label: '31–60' },
  '61-90': { bg: '#FDD835', fg: '#1B1B1B', label: '61–90' },
  '91-120': { bg: '#FFA000', fg: '#1B1B1B', label: '91–120' },
  '121-150': { bg: '#F57C00', fg: '#fff', label: '121–150' },
  '151-180': { bg: '#D32F2F', fg: '#fff', label: '151–180' },
  'over-180': { bg: '#7F0000', fg: '#fff', label: 'Over 180' },
  'over-365': { bg: '#000000', fg: '#fff', border: '#D32F2F', label: 'Over 365' },
};

export const AGEING_ORDER = ['1-30', '31-60', '61-90', '91-120', '121-150', '151-180', 'over-180', 'over-365'];

export const INQUIRY_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  returned_for_info: 'Returned for information',
  rejected: 'Rejected',
  accepted: 'Accepted',
  in_design: 'In design',
  design_review: 'Design review',
  design_approved: 'Design approved',
  in_estimation: 'In estimation',
  estimation_review: 'Estimation review',
  quotation_released: 'Quotation released',
  returned_to_sales: 'Design returned to sales',
  submitted_to_client: 'Submitted to client',
  awaiting_client_approval: 'Awaiting client approval',
  client_approved: 'Client approved',
  won: 'Won',
  lost: 'Lost',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};
