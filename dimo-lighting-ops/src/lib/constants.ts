import { todayISO } from './format';
import type { Milestone, Sample } from './types';

// Stage-based win-probability defaults and allowed bands (Section 4.7) – mirrors app.probability_band().
export const MILESTONES: { value: Milestone; label: string; def: number; lo: number; hi: number }[] = [
  { value: 'lead_identified', label: 'Lead identified', def: 10, lo: 5, hi: 20 },
  { value: 'design_involvement', label: 'Design / concept involvement', def: 25, lo: 15, hi: 40 },
  { value: 'brand_specified', label: 'Our brand specified', def: 50, lo: 40, hi: 65 },
  { value: 'quotation_submitted', label: 'Quotation submitted', def: 40, lo: 20, hi: 60 },
  { value: 'negotiating', label: 'Shortlisted / negotiating', def: 70, lo: 60, hi: 85 },
  { value: 'loa_expected', label: 'LOA / PO expected', def: 90, lo: 85, hi: 95 },
  { value: 'won', label: 'Won', def: 100, lo: 100, hi: 100 },
  { value: 'lost', label: 'Lost', def: 0, lo: 0, hi: 0 },
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
