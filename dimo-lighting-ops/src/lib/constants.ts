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
