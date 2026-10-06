import { todayISO } from './format';
import type { Milestone, Sample } from './types';

// Internal sales milestones. The win probability is separate: the sales person's own estimate, entered by hand or with
// the Win Probability Wizard (only Won = 100% and Lost = 0% are set by the milestone).
export const MILESTONES: { value: Milestone; label: string }[] = [
  { value: 'lead_identified', label: 'Lead identified' },
  { value: 'design_involvement', label: 'Design / concept involvement' },
  { value: 'brand_specified', label: 'Our brand specified' },
  { value: 'quotation_submitted', label: 'Quotation submitted' },
  { value: 'negotiating', label: 'Shortlisted / negotiating' },
  { value: 'loa_expected', label: 'LOA / PO expected' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

export const sampleOverdue = (s: Sample) => s.status === 'out' && !!s.expected_return_date && s.expected_return_date < todayISO();

// What Estimation must price and on what basis (set by sales on Route A / B inquiries)
export const ESTIMATION_SCOPE = [
  { value: 'fixtures', label: 'Lighting fixtures' },
  { value: 'electrical', label: 'Electrical (cables, DBs, wiring)' },
  { value: 'controls', label: 'Lighting controls (DALI, sensors, dimming)' },
  { value: 'poles', label: 'Poles & accessories' },
];
export const ESTIMATION_BASIS = [
  { value: 'supply', label: 'Supply only' },
  { value: 'supply_commission', label: 'Supply & commission' },
  { value: 'supply_install', label: 'Supply & install' },
  { value: 'supply_install_commission', label: 'Supply, install & commission' },
];
export const DESIGN_SCOPE = [
  { value: 'lighting', label: 'Lighting' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'lighting_electrical', label: 'Lighting + Electrical' },
];
const labelOf = (list: { value: string; label: string }[], v?: string | null) => list.find((x) => x.value === v)?.label ?? null;
export const designScopeText = (v?: string | null) => labelOf(DESIGN_SCOPE, v) ?? '—';
export const estimationScopeText = (scope?: string[] | null, basis?: string | null) => {
  const items = (scope ?? []).map((s) => labelOf(ESTIMATION_SCOPE, s)?.replace(/ \(.*\)$/, '') ?? s);
  if (!items.length && !basis) return '—';
  return [items.join(', '), labelOf(ESTIMATION_BASIS, basis)].filter(Boolean).join(' · ');
};
