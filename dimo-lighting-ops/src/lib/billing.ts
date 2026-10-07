// Invoicing plan ↔ execution: invoice triggers, monthly checks and progress claims (IPCs)

export type TriggerKind = 'gate' | 'activity' | 'delivery' | 'ipc' | 'manual';

export type InvoiceTrigger = {
  line_id: string;
  exec_project_id: string;
  kind: TriggerKind;
  gate: number | null;
  activity_id: string | null;
  mr_ids: string[] | null;
  approved: boolean;
  set_by: string | null;
  set_at: string;
  ready_at: string | null;
  ready_note: string | null;
  claimable_at?: string | null;
  claimable_note?: string | null;
  risk?: string | null;
};

export type InvoiceCheck = {
  id: string;
  line_id: string;
  check_month: string;
  status: 'on_track' | 'ready' | 'slipping';
  to_month: string | null;
  note: string | null;
  by_id: string | null;
  at: string;
};

export type Ipc = {
  id: string;
  code: string | null;
  exec_project_id: string;
  line_id: string | null;
  period: string;
  measured_pct: number;
  measurement: string | null;
  prepared_by: string;
  prepared_at: string;
  status: 'prepared' | 'certified' | 'returned';
  certified_value: number | null;
  certified_at: string | null;
  note: string | null;
};

export const TRIGGER_KINDS: { value: TriggerKind; label: string }[] = [
  { value: 'gate', label: 'Checkpoint approved' },
  { value: 'activity', label: 'Programme activity / milestone finished' },
  { value: 'delivery', label: 'Materials delivered to site (requests fully received)' },
  { value: 'ipc', label: 'Monthly progress claim (IPC) certified by the client' },
  { value: 'manual', label: 'SEE confirms the work is done' },
];

export const CHECK_STATUS: { value: InvoiceCheck['status']; label: string }[] = [
  { value: 'on_track', label: 'On track' },
  { value: 'ready', label: 'Work done – payment certificate to submit' },
  { value: 'slipping', label: 'Slipping – propose a later month' },
];

export const IPC_STATUS: Record<Ipc['status'], string> = { prepared: 'With the SEE', certified: 'Certified', returned: 'Returned to correct' };

/** Roles that see the money */
export const BILLING_ROLES = ['senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec'];

/** Payment certificate: the SEE submits the claim to the client and records the client's approval → Operations invoices */
export type PaymentCert = {
  id: string;
  code: string | null;
  exec_project_id: string;
  line_id: string;
  claimed_amount: number;
  submitted_on: string;
  submitted_ref: string | null;
  status: 'submitted' | 'approved' | 'returned';
  approved_amount: number | null;
  approved_on: string | null;
  client_ref: string | null;
  note: string | null;
};
export const CERT_STATUS: Record<PaymentCert['status'], string> = { submitted: 'With the client', approved: 'Approved by the client', returned: 'Returned by the client' };

export type BillingAction = { id: string; line_id: string; exec_project_id: string; action: string; owner_id: string | null; due_date: string | null; status: 'open' | 'done'; result: string | null };

/** One invoice line against the programme (public.billing_risk) */
export type BillingRow = {
  exec_project_id: string;
  project: string;
  see_id: string | null;
  line_id: string;
  secured_id: string;
  description: string;
  amount: number;
  open_amount: number;
  original_month: string;
  forecast_month: string;
  kind: TriggerKind | null;
  trigger_label: string;
  activity_id: string | null;
  forecast_date: string | null;
  deadline: string;
  float_days: number | null;
  stage: 'work' | 'certificate' | 'invoice';
  status: 'green' | 'amber' | 'red' | 'ready' | 'no_trigger' | 'no_date';
  cert_id: string | null;
  cert_code: string | null;
  open_actions: number;
  pending_move: boolean;
};
export const RISK: Record<BillingRow['status'], { label: string; tone: 'green' | 'amber' | 'red' | 'grey' | 'blue' }> = {
  green: { label: 'On track', tone: 'green' },
  amber: { label: 'At risk', tone: 'amber' },
  red: { label: 'Will miss the month', tone: 'red' },
  ready: { label: 'Certificate approved – to invoice', tone: 'blue' },
  no_trigger: { label: 'No trigger', tone: 'red' },
  no_date: { label: 'No forecast date', tone: 'grey' },
};
/** What the line waits for, in words */
export function billingStep(r: BillingRow, fmt: (d: string) => string) {
  if (r.stage === 'invoice') return 'Payment certificate approved – Operations raises the invoice';
  if (r.stage === 'certificate') return r.cert_id ? `Payment certificate ${r.cert_code ?? ''} with the client` : 'Work done – submit the payment certificate';
  if (!r.kind) return 'Set the trigger';
  if (!r.forecast_date) return `${r.trigger_label} · invoice deadline ${fmt(r.deadline)}`;
  return `${r.trigger_label} · expected ${fmt(r.forecast_date)} · deadline ${fmt(r.deadline)} (${r.float_days} working days)`;
}
