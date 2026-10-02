import { todayISO } from './format';
import { daysFrom } from './retentions';
import type { Bond, BondType } from './types';

export const BOND_TYPES: { value: BondType; label: string; short: string }[] = [
  { value: 'bid', label: 'Bid Bonds', short: 'Bid bond' },
  { value: 'performance', label: 'Performance Bonds', short: 'Performance bond' },
  { value: 'advance_payment', label: 'Advance Payment Bonds', short: 'Advance payment bond' },
];
export const bondTypeLabel = (t: BondType) => BOND_TYPES.find((b) => b.value === t)?.short ?? t;

/** Where a bond stands today – drives colours, filters and the summary. */
export type BondStage = 'active' | 'expiring' | 'expired' | 'action' | 'returned' | 'claimed' | 'cancelled';

export function bondStage(b: Bond, today = todayISO()): BondStage {
  if (b.status !== 'active') return b.status;
  if (b.expiry_date < today) return 'expired';
  if (daysFrom(today, b.expiry_date) <= 30) return 'expiring';
  if (bondAction(b, today)) return 'action';
  return 'active';
}

/** Something to do on an active bond other than its expiry (return / release). */
export function bondAction(b: Bond, today = todayISO()): string | null {
  if (b.status !== 'active') return null;
  if (b.bond_type === 'bid' && (b.tender_result === 'lost' || b.tender_result === 'cancelled')) return `Tender ${b.tender_result} – collect and return to the bank`;
  if (b.bond_type === 'bid' && b.tender_result === 'won') return 'Tender won – return after the performance bond is given';
  if (b.bond_type === 'performance' && b.dlp_end_date && b.dlp_end_date <= today) return 'Defects liability period ended – release';
  if (b.bond_type === 'advance_payment' && Number(b.recovered_amount) >= Number(b.advance_amount ?? b.bond_value)) return 'Advance fully recovered – release';
  return null;
}

export const BOND_STAGE_LABEL: Record<BondStage, string> = {
  active: 'Active',
  expiring: 'Expiring ≤ 30 days',
  expired: 'Expired – not returned',
  action: 'Return / release due',
  returned: 'Returned',
  claimed: 'Claimed',
  cancelled: 'Cancelled',
};
