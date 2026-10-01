import { todayISO } from './format';
import type { Retention } from './types';

export const RETENTION_FORMS = [
  { value: 'cash_withheld', label: 'Cash withheld from payments' },
  { value: 'bank_guarantee', label: 'Bank guarantee in place of cash' },
];

/** Where a retention stands today – drives colours, tabs and the dashboard. */
export type RetentionStage = 'not_due' | 'due_soon' | 'due' | 'claimed' | 'claim_overdue' | 'collected' | 'cancelled';

export function retentionStage(r: Retention, today = todayISO()): RetentionStage {
  if (r.status === 'collected') return 'collected';
  if (r.status === 'cancelled') return 'cancelled';
  if (r.status === 'claimed') return r.claimed_on && daysFrom(r.claimed_on, today) >= 60 ? 'claim_overdue' : 'claimed';
  if (r.due_date <= today) return 'due';
  return daysFrom(today, r.due_date) <= 60 ? 'due_soon' : 'not_due';
}

export const STAGE_LABEL: Record<RetentionStage, string> = {
  not_due: 'Not yet due',
  due_soon: 'Due within 60 days',
  due: 'Due – not claimed',
  claimed: 'Claimed – awaiting payment',
  claim_overdue: 'Claimed over 60 days',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

export function daysFrom(fromISO: string, toISO: string) {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000);
}
