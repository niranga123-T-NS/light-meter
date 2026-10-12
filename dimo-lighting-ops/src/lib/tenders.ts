import { colors } from '@/components/ui';

export type Tender = {
  id: string;
  visit_id: string | null;
  project_id: string | null;
  project_name: string | null;
  sales_person_id: string | null;
  tender_no: string;
  tender_name: string;
  client_organization_id: string | null;
  client_name: string | null;
  tender_type: 'open' | 'selective' | 'negotiated' | 're_tender';
  duty_status: 'duty_paid' | 'duty_free';
  currency: 'LKR' | 'USD';
  closing_date: string;
  opening_date: string;
  our_price: number | null;
  our_brands: string[];
  delivery_period: string | null;
  validity: string | null;
  result_status: 'opened' | 'awarded_to_us' | 'awarded_to_competitor' | 'cancelled' | 're_tender';
  lost_reason: string | null;
  evaluation_notes: string | null;
  entered_by: string | null;
  created_at: string;
  updated_at: string;
};
export type TenderBid = {
  id: string;
  tender_id: string;
  competitor_id: number;
  bid_price: number | null;
  brands: string[];
  compliant: boolean;
  remarks: string | null;
  delivery_period: string | null;
  validity: string | null;
  updated_by: string | null;
  updated_at: string;
};
export type BidLine = {
  id: string;
  bid_id: string;
  seq: number;
  item: string;
  brand: string | null;
  model: string | null;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  remarks: string | null;
};

export const TENDER_RESULT: Record<Tender['result_status'], { label: string; tone: string }> = {
  opened: { label: 'Opened – awaiting result', tone: colors.blue },
  awarded_to_us: { label: 'Awarded to us', tone: colors.green },
  awarded_to_competitor: { label: 'Awarded to a competitor', tone: colors.red },
  cancelled: { label: 'Cancelled', tone: colors.grey },
  re_tender: { label: 'Re-tender', tone: colors.amber },
};
export const TENDER_TYPES = [
  { value: 'open', label: 'Open' },
  { value: 'selective', label: 'Selective / Limited' },
  { value: 'negotiated', label: 'Negotiated' },
  { value: 're_tender', label: 'Re-tender' },
];
/** Who enters and updates tender results (besides the sales person who owns the tender) */
export const TENDER_EDITORS = ['sm_projects', 'sm_estimation', 'am_estimation'];
export const TENDER_READERS = ['gm', ...TENDER_EDITORS];

export const tenderClient = (t: Pick<Tender, 'client_name'>, orgName?: string | null) => orgName ?? t.client_name ?? '—';
export const tenderProject = (t: Pick<Tender, 'project_name'>, projName?: string | null) => projName ?? t.project_name ?? '—';
