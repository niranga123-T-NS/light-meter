import { colors } from '@/components/ui';
import type { Role } from '@/lib/types';

/** Scrap disposal: raised by the SEE / AE, approved by SM Projects then the DGM, disposed free of charge or sold. */
export type ScrapStatus = 'draft' | 'pending_smp' | 'pending_dgm' | 'approved' | 'returned' | 'rejected' | 'disposed' | 'cancelled';
export type ScrapDisposal = {
  id: string;
  code: string;
  exec_project_id: string | null;
  location: string;
  scrap_reason: string;
  method: 'foc' | 'sell';
  foc_to: string | null;
  foc_reason: string | null;
  selected_quote_id: string | null;
  quote_reason: string | null;
  status: ScrapStatus;
  requested_by: string;
  requested_at: string;
  submitted_at: string | null;
  smp_by: string | null;
  smp_at: string | null;
  smp_note: string | null;
  dgm_by: string | null;
  dgm_at: string | null;
  dgm_note: string | null;
  return_note: string | null;
  returned_by: string | null;
  returned_at: string | null;
  disposed_on: string | null;
  disposed_by: string | null;
  disposal_ref: string | null;
  amount_received: number | null;
  disposal_note: string | null;
  cancel_reason: string | null;
};
export type ScrapLine = {
  id?: string;
  source: 'store' | 'returns' | 'other';
  return_item_id?: string | null;
  item: string;
  unit: string;
  qty: number | null;
  condition: string;
  note?: string | null;
};
export type ScrapQuote = { id: string; disposal_id: string; buyer: string; amount_lkr: number; valid_until: string | null; note: string | null; added_by: string; added_at: string };
export type ScrapStoreItem = { item: string; unit: string; balance: number; free: number; last_at: string };

export const SCRAP_STATUS: Record<ScrapStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: colors.grey },
  pending_smp: { label: 'With SM Projects', tone: colors.amber },
  pending_dgm: { label: 'With the DGM', tone: colors.amber },
  approved: { label: 'Approved – to dispose', tone: colors.blue },
  returned: { label: 'Returned for changes', tone: colors.red },
  rejected: { label: 'Rejected', tone: colors.red },
  disposed: { label: 'Disposed', tone: colors.green },
  cancelled: { label: 'Cancelled', tone: colors.grey },
};
export const SCRAP_CONDITIONS = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'offcut', label: 'Offcut / short length' },
  { value: 'removed', label: 'Removed from site (old installation)' },
  { value: 'obsolete', label: 'Obsolete / no longer used' },
  { value: 'expired', label: 'Expired' },
  { value: 'other', label: 'Other' },
];
export const conditionLabel = (c: string) => SCRAP_CONDITIONS.find((x) => x.value === c)?.label ?? c;
export const SCRAP_SOURCE: Record<ScrapLine['source'], string> = { store: 'Site store', returns: 'Project returns', other: 'Found on site' };
export const SCRAP_METHOD = { foc: 'Free of charge (no cost)', sell: 'Sell' } as const;

/** Raise: the SEE (any project or the central store) and the project's Assistant Engineers */
export const SCRAP_RAISE: Role[] = ['senior_elec_engineer', 'assistant_engineer'];
export const SCRAP_OPEN: ScrapStatus[] = ['draft', 'pending_smp', 'pending_dgm', 'approved', 'returned'];
