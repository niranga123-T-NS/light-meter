import { colors } from '@/components/ui';

export type Tender = {
  id: string;
  visit_id: string | null;
  inquiry_id: string | null;
  project_id: string | null;
  project_name: string | null;
  sales_person_id: string | null;
  tender_no: string;
  tender_name: string;
  client_organization_id: string | null;
  client_name: string | null;
  tender_type: 'open' | 'selective' | 'negotiated' | 're_tender' | 'quotation';
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
  won: boolean;
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
  our_unit_price: number | null;
  remarks: string | null;
};
export type Competitor = { id: number; name: string; active: boolean; notes: string | null; brands: string[]; website: string | null; updated_by: string | null; updated_at: string | null };

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
  { value: 'quotation', label: 'Quotation (not a tender)' },
];
/** An ordinary quotation's competition record (from an inquiry or a past quotation), not a tender */
export const isQuote = (t: Pick<Tender, 'tender_type'>) => t.tender_type === 'quotation';
/** Result labels worded for a quotation */
export const resultLabel = (t: Pick<Tender, 'tender_type' | 'result_status'>) =>
  isQuote(t) ? ({ opened: 'Awaiting result', awarded_to_us: 'Won', awarded_to_competitor: 'Lost', cancelled: 'Cancelled', re_tender: 'Re-quoted' } as const)[t.result_status] : TENDER_RESULT[t.result_status].label;
/** Who keeps competitor profiles */
export const COMPETITOR_EDITORS = ['sm_projects', 'sys_admin', 'sm_estimation', 'am_estimation'];
/** Who enters and updates tender results (besides the sales person who owns the tender) */
export const TENDER_EDITORS = ['sm_projects', 'sm_estimation', 'am_estimation'];
export const TENDER_READERS = ['gm', ...TENDER_EDITORS];

export const tenderClient = (t: Pick<Tender, 'client_name'>, orgName?: string | null) => orgName ?? t.client_name ?? '—';
export const tenderProject = (t: Pick<Tender, 'project_name'>, projName?: string | null) => projName ?? t.project_name ?? '—';

export type CompBid = TenderBid & { tenders: Pick<Tender, 'id' | 'tender_no' | 'tender_name' | 'tender_type' | 'result_status' | 'our_price' | 'currency' | 'opening_date' | 'client_name' | 'project_name'> };
export const COMP_BID_SELECT = '*, tenders!inner(id, tender_no, tender_name, tender_type, result_status, our_price, currency, opening_date, client_name, project_name)';

/** A competitor's record against us: how often met, how often they won, how far their price was from ours on average */
export function compStats(bids: CompBid[]) {
  const priced = bids.filter((b) => b.bid_price != null && b.tenders.our_price != null && Number(b.tenders.our_price) > 0);
  const gaps = priced.map((b) => ((Number(b.bid_price) - Number(b.tenders.our_price)) / Number(b.tenders.our_price)) * 100);
  const brands: Record<string, number> = {};
  for (const b of bids) for (const x of b.brands ?? []) brands[x] = (brands[x] ?? 0) + 1;
  return {
    met: bids.length,
    tenders: bids.filter((b) => b.tenders.tender_type !== 'quotation').length,
    quotations: bids.filter((b) => b.tenders.tender_type === 'quotation').length,
    won: bids.filter((b) => b.won).length,
    weWon: bids.filter((b) => b.tenders.result_status === 'awarded_to_us').length,
    avgGap: gaps.length ? gaps.reduce((s, x) => s + x, 0) / gaps.length : null,
    cheaper: gaps.filter((g) => g < 0).length,
    priced: gaps.length,
    brands: Object.entries(brands).sort((a, b) => b[1] - a[1]),
  };
}
export const fmtGap = (g: number | null) => (g == null ? '—' : `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`);
