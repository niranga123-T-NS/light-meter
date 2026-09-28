import { setting } from './cache';
import type { VisitPayload } from './types';

export interface MissingField { field: string; label: string }

/** Same minimum as the server (public.visit_missing_fields). */
export function missingForSubmit(p: VisitPayload): MissingField[] {
  const v = p.visit;
  const missing: MissingField[] = [];
  const blank = (s?: string | null) => !s || !s.trim();
  if (!v.customer_id) missing.push({ field: 'customer', label: 'Customer' });
  if (p.contact_ids.length === 0 && blank(v.contact_unavailable_reason)) {
    missing.push({ field: 'contacts', label: 'Contact met, or reason unavailable' });
  }
  if (!v.visit_date && !v.check_in_at && !v.scheduled_at) missing.push({ field: 'visit_date', label: 'Visit date' });
  if (blank(v.visit_type)) missing.push({ field: 'visit_type', label: 'Visit type' });
  if (blank(v.purpose)) missing.push({ field: 'purpose', label: 'Purpose' });
  if (blank(v.summary)) missing.push({ field: 'summary', label: 'Meeting summary' });
  if (blank(v.outcome)) missing.push({ field: 'outcome', label: 'Outcome' });
  if (p.actions.length === 0 && blank(v.no_followup_reason)) {
    missing.push({ field: 'actions', label: 'Next action, or "no follow up" reason' });
  }
  if (p.actions.some((a) => blank(a.description))) missing.push({ field: 'actions', label: 'Every action needs a description' });
  if (setting('gps_required', false) && !v.is_remote && v.check_in_lat == null && blank(v.location_unavailable_reason)) {
    missing.push({ field: 'location', label: 'Check-in location, or reason unavailable' });
  }
  return missing;
}
