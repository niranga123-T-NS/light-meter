import { todayISO } from './format';
import { daysFrom } from './retentions';
import type { ManufacturerClaim, Warranty, WarrantyClaim, WarrantyLine } from './types';

export const START_BASIS = [
  { value: 'handover', label: 'Handover' },
  { value: 'tc', label: 'Testing & commissioning' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'invoice', label: 'Invoice' },
];

export const REPORTED_VIA = [
  { value: 'customer_call', label: 'Customer call' },
  { value: 'customer_email', label: 'Customer email' },
  { value: 'customer_letter', label: 'Customer letter' },
  { value: 'sales_visit', label: 'Sales visit' },
  { value: 'site_inspection', label: 'Site inspection' },
  { value: 'other', label: 'Other' },
];
export const viaLabel = (v: string) => REPORTED_VIA.find((x) => x.value === v)?.label ?? v;

export const isWarrantyDesk = (role: string) => role === 'operations_exec' || role === 'senior_elec_engineer';
/** Sales persons and SM Projects can also raise claims (verified and assigned by the warranty desk). */
export const canRaiseClaim = (role: string) => isWarrantyDesk(role) || role === 'asm_building' || role === 'asm_infra' || role === 'sm_projects';

/** Where a warranty line stands today. */
export type LineStage = 'active' | 'expiring' | 'expired';
export function lineStage(l: WarrantyLine, today = todayISO()): LineStage {
  if (l.end_date < today) return 'expired';
  return daysFrom(today, l.end_date) <= 90 ? 'expiring' : 'active';
}
/** Months DIMO covers after the supplier's warranty ends (0 = covered). */
export function supplierGapDays(l: WarrantyLine) {
  return l.supplier_end && l.supplier_end < l.end_date ? daysFrom(l.supplier_end, l.end_date) : 0;
}
export function gapLabel(days: number) {
  if (days <= 0) return 'Covered';
  const m = Math.round(days / 30.4);
  return m >= 12 ? `Gap ${Math.floor(m / 12)} yr${m % 12 ? ` ${m % 12} mo` : ''}` : `Gap ${Math.max(1, m)} mo`;
}

/** Warranty status from its lines. */
export type WarrantyStage = 'active' | 'expiring' | 'partly_expired' | 'expired' | 'cancelled';
export function warrantyStage(w: Warranty, lines: WarrantyLine[], today = todayISO()): WarrantyStage {
  if (w.status === 'cancelled') return 'cancelled';
  const st = lines.map((l) => lineStage(l, today));
  if (!st.length || st.every((s) => s === 'expired')) return 'expired';
  if (st.some((s) => s === 'expiring')) return 'expiring';
  if (st.some((s) => s === 'expired')) return 'partly_expired';
  return 'active';
}
export const WARRANTY_STAGE_LABEL: Record<WarrantyStage, string> = {
  active: 'Active',
  expiring: 'Expiring ≤ 90 days',
  partly_expired: 'Partly expired',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

/** Where a claim stands – the next step. */
export type ClaimStage = 'verify' | 'assign' | 'inspect' | 'decide' | 'goodwill' | 'quote' | 'rectify' | 'close' | 'closed' | 'rejected' | 'cancelled';
export function claimStage(c: WarrantyClaim): ClaimStage {
  if (c.status === 'cancelled') return 'cancelled';
  if (c.status === 'closed') return c.decision === 'rejected' ? 'rejected' : 'closed';
  if (c.needs_verification && !c.verified_at) return 'verify';
  if (!c.assignee_id) return 'assign';
  if (!c.inspected_on) return 'inspect';
  if (!c.decision) return 'decide';
  if (c.goodwill_status === 'pending') return 'goodwill';
  if (!c.rectified_on) return c.decision === 'chargeable' ? 'quote' : 'rectify';
  return 'close';
}
export const CLAIM_STAGE_LABEL: Record<ClaimStage, string> = {
  verify: 'To verify',
  assign: 'To assign (Sr. Elec. Eng.)',
  inspect: 'Inspection due',
  decide: 'Decision due',
  goodwill: 'Goodwill – SM Projects',
  quote: 'Chargeable – quote',
  rectify: 'Rectify',
  close: 'Rectified – close',
  closed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
export const claimDaysOpen = (c: WarrantyClaim, today = todayISO()) => daysFrom(c.logged_at.slice(0, 10), c.closed_on ?? today);

/** Next step on a manufacturer claim (RMA). */
export type RmaStage = 'contact' | 'await_rma' | 'return' | 'await_decision' | 'rejected' | 'await_receipt' | 'to_close' | 'closed' | 'cancelled';
export function rmaStage(r: ManufacturerClaim): RmaStage {
  if (r.status === 'closed') return 'closed';
  if (r.status === 'cancelled') return 'cancelled';
  if (r.decision === 'rejected') return r.smp_decision === 'absorb' ? 'to_close' : 'rejected';
  if (r.decision) return r.received_on ? 'to_close' : 'await_receipt';
  if (!r.contacted_on) return 'contact';
  if (!r.rma_no) return 'await_rma';
  if (!r.returned_on) return 'return';
  return 'await_decision';
}
export const RMA_STAGE_LABEL: Record<RmaStage, string> = {
  contact: 'Contact manufacturer',
  await_rma: 'Waiting for RMA no.',
  return: 'Return goods',
  await_decision: 'Waiting for decision',
  rejected: 'Rejected – SM Projects',
  await_receipt: 'Waiting for replacement / credit',
  to_close: 'Ready to close',
  closed: 'Closed',
  cancelled: 'Cancelled',
};
