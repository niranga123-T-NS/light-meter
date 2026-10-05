import { MILESTONES } from './constants';
import { fmtDate, fmtMoney, human } from './format';
import { projectTypeLabel } from './roles';
import type { Currency } from './types';

/** Project details a sales person changes through a request to SM Projects (mirrors app.project_change_fields()). */
export const CHANGE_FIELDS = [
  'name',
  'organization_id',
  'unit_id',
  'project_type',
  'city',
  'location',
  'stage',
  'milestone',
  'win_probability',
  'spec_status',
  'duty_status',
  'project_value',
  'lighting_value',
  'expected_tender_date',
  'expected_award_date',
  'expected_duration_months',
  'project_term',
] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];

export const FIELD_LABEL: Record<string, string> = {
  name: 'Name',
  organization_id: 'Customer',
  unit_id: 'Unit / department',
  project_type: 'Project type',
  city: 'City',
  location: 'Location',
  stage: 'Stage',
  milestone: 'Milestone',
  win_probability: 'Win probability',
  spec_status: 'Specification',
  duty_status: 'Duty status',
  currency: 'Currency',
  project_value: 'Project value',
  lighting_value: 'Lighting value',
  expected_tender_date: 'Tender date',
  expected_award_date: 'Award date',
  expected_duration_months: 'Duration',
  project_term: 'Term',
};

export type ChangeRequest = {
  id: string;
  project_id: string;
  requested_by: string;
  requested_at: string;
  changes: Record<string, unknown>;
  previous: Record<string, unknown>;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

/** A value as people read it (customer and unit names come from the lookup). */
export function showValue(field: string, v: unknown, currency: Currency, customers: Record<string, string> = {}): string {
  if (v == null || v === '') return '—';
  switch (field) {
    case 'organization_id':
      return customers[String(v)] ?? 'another customer';
    case 'unit_id':
      return customers[String(v)] ?? 'another unit';
    case 'project_type':
      return projectTypeLabel(String(v));
    case 'milestone':
      return MILESTONES.find((m) => m.value === v)?.label ?? String(v);
    case 'win_probability':
      return `${v}%`;
    case 'project_value':
    case 'lighting_value':
      return fmtMoney(Number(v), currency);
    case 'expected_tender_date':
    case 'expected_award_date':
      return fmtDate(String(v));
    case 'expected_duration_months':
      return `${v} months`;
    case 'duty_status':
      return v === 'duty_free' ? 'Duty Free – USD' : 'Duty Paid – LKR';
    case 'spec_status':
    case 'project_term':
      return human(String(v));
    default:
      return String(v);
  }
}
