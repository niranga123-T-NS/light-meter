import { fmtDate, fmtDateTime } from './format';
import type { Inquiry } from './types';

/** The deadline split from deadline_split(): release, final pricing and the rest for design. */
export type Split = {
  deadline_type: 'client' | 'tender';
  deadline: string;
  release_days: number;
  pricing_days: number;
  design_due: string;
  design_latest: string;
  estimation_due: string;
  design_days: number;
  tight: boolean;
};

export type DeadlineExtension = {
  id: string;
  inquiry_id: string;
  kind: 'client_request' | 'tender_addendum' | 'direct';
  old_deadline: string | null;
  proposed_deadline: string | null;
  new_deadline: string | null;
  reason: string | null;
  addendum_ref: string | null;
  status: 'requested' | 'granted' | 'refused';
  decision_note: string | null;
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
};

/** A row of design_pipeline(): SM Estimation's "Design in progress" and the Design Manager's mirror */
export type PipelineRow = {
  inquiry_id: string;
  code: string;
  title: string;
  customer_name: string | null;
  deadline_type: 'client' | 'tender';
  deadline_at: string | null;
  tender_ref: string | null;
  design_due_at: string | null;
  design_due_status: 'pending' | 'approved' | 'returned' | null;
  designers: string | null;
  design_progress: number;
  inquiry_status: string;
  estimation_job_id: string | null;
  estimation_status: string | null;
  estimation_phase: 'pre' | 'final' | null;
  estimator: string | null;
  estimation_due_at: string | null;
  estimation_days: number | null;
  late: boolean;
  extension_status: 'requested' | 'granted' | 'refused' | null;
};

export const SUBMISSION_METHODS = [
  { value: 'online', label: 'Online portal' },
  { value: 'hard_copy', label: 'Hard copy (sealed)' },
  { value: 'email', label: 'E-mail' },
];
export const submissionLabel = (v?: string | null) => SUBMISSION_METHODS.find((m) => m.value === v)?.label ?? '—';

export const isTender = (i: Pick<Inquiry, 'deadline_type'>) => i.deadline_type === 'tender';

/** "Tender closes 07 Nov, 10:00" or "Client deadline 20 Oct 2026" */
export function deadlineText(i: Pick<Inquiry, 'deadline_type' | 'tender_closes_at' | 'customer_deadline'>) {
  return isTender(i) ? `Tender closes ${fmtDateTime(i.tender_closes_at)}` : `Client deadline ${fmtDate(i.customer_deadline)}`;
}

/** YYYY-MM-DD + HH:MM in Sri Lanka → ISO timestamp */
export const colomboTime = (date: string, time: string) => new Date(`${date}T${/^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, '0') : '10:00'}:00+05:30`).toISOString();

/** ISO timestamp → HH:MM in Sri Lanka */
export const colomboHHMM = (v: string) => new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Colombo' });

/** Within the next 7 days (and not past) */
export const thisWeek = (v?: string | null) => !!v && Date.parse(v) >= Date.now() - 864e5 && Date.parse(v) <= Date.now() + 7 * 864e5;
