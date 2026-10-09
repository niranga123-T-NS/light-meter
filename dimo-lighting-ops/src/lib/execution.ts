// Execution module – mirrors supabase/migrations/20260930000100_exec_team_access.sql and later execution migrations
import type { Role } from './types';

export type ExecFamily = 'Building & architectural' | 'Electrical' | 'Controls & measurement' | 'Infrastructure' | 'Airport systems';

export const EXEC_AREAS: { value: string; label: string; family: ExecFamily }[] = [
  { value: 'indoor', label: 'Indoor lighting', family: 'Building & architectural' },
  { value: 'outdoor', label: 'Outdoor lighting', family: 'Building & architectural' },
  { value: 'facade', label: 'Facade lighting', family: 'Building & architectural' },
  { value: 'emergency', label: 'Emergency lighting', family: 'Building & architectural' },
  { value: 'central_battery', label: 'Central battery systems', family: 'Building & architectural' },
  { value: 'electrical', label: 'Electrical installations', family: 'Electrical' },
  { value: 'underground_cabling', label: 'Underground cabling works', family: 'Electrical' },
  { value: 'lighting_control', label: 'Lighting control systems', family: 'Controls & measurement' },
  { value: 'lighting_measurement', label: 'Lighting measurement activities', family: 'Controls & measurement' },
  { value: 'road', label: 'Road lighting', family: 'Infrastructure' },
  { value: 'tunnel', label: 'Tunnel lighting', family: 'Infrastructure' },
  { value: 'sports', label: 'Sports lighting', family: 'Infrastructure' },
  { value: 'port', label: 'Port lighting', family: 'Infrastructure' },
  { value: 'agl', label: 'Aeronautical ground lighting (AGL)', family: 'Airport systems' },
  { value: 'apron', label: 'Apron floodlighting', family: 'Airport systems' },
  { value: 'vdgs', label: 'Visual docking guidance (VDGS)', family: 'Airport systems' },
  { value: 'alcms', label: 'ALCMS (tower solutions)', family: 'Airport systems' },
  { value: 'smgcs', label: 'SMGCS', family: 'Airport systems' },
];
export const areaLabel = (v: string) => EXEC_AREAS.find((a) => a.value === v)?.label ?? v;

export const EXEC_STAGES = ['Mobilising', 'In progress', 'Handed over (DLP)'];
/** How each stage ends: the programme approval starts the work; the SEE requests the handover and the closure, SM Projects approves */
export const CHECKPOINTS = ['Programme approved', 'Handover to the client', 'Project closure'];
/** Project number on HSE forms and site documents: the WBS number, else the project code */
export const projectNo = (p: { wbs_no?: string | null; code: string | null }) => p.wbs_no || p.code || '';
export const stageLabel = (p: { stage: number; status: string }) => (p.status === 'closed' ? 'Closed' : (EXEC_STAGES[p.stage - 1] ?? '—'));

export type ExecProject = {
  id: string;
  project_id: string | null;
  code: string | null;
  name: string;
  areas: string[];
  legacy: boolean;
  client_name: string | null;
  contract_value_lkr: number | null;
  secured_id: string | null;
  /** SAP WBS number from the order book (e.g. LS-000116) – the project number on site documents */
  wbs_no: string | null;
  /** Workers need a police report: flagged 2 days, then blocked until it is submitted */
  police_required?: boolean;
  letter_sign_name?: string | null;
  letter_sign_designation?: string | null;
  letter_sign_phone?: string | null;
  contract_ref: string | null;
  request_id: string | null;
  stage: number;
  status: 'active' | 'closed';
  see_id: string | null;
  site_address: string | null;
  lat: number | null;
  lng: number | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

export type ExecMember = {
  id: string;
  exec_project_id: string;
  user_id: string;
  member_role: 'assistant_engineer' | 'trainee' | 'sub_supervisor';
  zones: string | null;
  valid_from: string;
  valid_to: string | null;
  active: boolean;
  added_at: string;
  removed_at: string | null;
  remove_reason: string | null;
};

export type AccessRequest = {
  id: string;
  code: string;
  kind: 'temp_add' | 'temp_delete' | 'sub_appoint';
  status: 'pending_smp' | 'pending_gm' | 'approved' | 'done' | 'rejected' | 'cancelled';
  role_type: 'assistant_engineer' | 'trainee' | 'sub_supervisor';
  person_name: string;
  email: string | null;
  phone: string | null;
  id_no: string | null;
  company: string | null;
  user_id: string | null;
  project_ids: string[];
  zones: string | null;
  start_date: string | null;
  end_date: string | null;
  reason: string | null;
  requested_by: string;
  requested_at: string;
  smp_by: string | null;
  smp_at: string | null;
  smp_note: string | null;
  gm_by: string | null;
  gm_at: string | null;
  gm_note: string | null;
  created_user_id: string | null;
  provisioned_at: string | null;
};

export const REQUEST_KIND: Record<AccessRequest['kind'], string> = {
  temp_add: 'Temporary staff',
  temp_delete: 'Delete temporary role',
  sub_appoint: 'Subcontractor supervisor',
};
export const REQUEST_STATUS: Record<AccessRequest['status'], string> = {
  pending_smp: 'Waiting for SM Projects',
  pending_gm: 'Waiting for DGM / GM',
  approved: 'Approved – create the login',
  done: 'Done',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
export const roleTypeLabel = (r: string, temporary = true) =>
  r === 'trainee' ? 'Trainee' : r === 'sub_supervisor' ? 'Subcontractor supervisor' : temporary ? 'Temporary Assistant Engineer' : 'Assistant Engineer';

export const isExecLead = (r?: Role | null) => r === 'senior_elec_engineer' || r === 'sm_projects' || r === 'gm';
export const isExecField = (r?: Role | null) => r === 'assistant_engineer' || r === 'trainee' || r === 'sub_supervisor';

/** Mobile number as entered → the login stored for supervisors (same rule as app.norm_phone) */
export function normPhone(p: string) {
  const d = p.replace(/[^0-9]/g, '');
  return /^0[0-9]{9}$/.test(d) ? `94${d.slice(1)}` : d;
}
export const phoneLoginEmail = (p: string) => `${normPhone(p)}@users.dimo-lighting-ops.app`;

// ---- Plans (step 3) ----
export type ExecPlan = {
  id: string;
  exec_project_id: string;
  ae_id: string;
  week_start: string;
  status: 'draft' | 'submitted' | 'approved' | 'returned';
  submitted_at: string | null;
  is_late: boolean;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  skip_reasons: Record<string, string>;
};
export type PlanItem = {
  id: string;
  plan_id: string | null;
  exec_project_id: string;
  day: string;
  kind: string;
  title: string;
  zone: string | null;
  qty: number | null;
  unit: string | null;
  supervisor_id: string | null;
  activity_id: string | null;
  source: 'plan' | 'supervisor';
  acceptance: 'pending' | 'accepted' | 'rejected' | null;
  reject_reason: string | null;
  status: 'planned' | 'done' | 'partial' | 'not_done';
  done_qty: number | null;
  result_note: string | null;
  /** The Senior Electrical Engineer checked (or entered) the result */
  result_checked_by?: string | null;
  result_checked_at?: string | null;
  added_by: string | null;
};
export const PLAN_KINDS = [
  { value: 'task', label: 'Task' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'test', label: 'Test' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'meeting', label: 'Site meeting' },
  { value: 'other', label: 'Other' },
];
export const PLAN_STATUS: Record<ExecPlan['status'], string> = {
  draft: 'Draft',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  returned: 'Returned – revise',
};
export const ITEM_STATUS: Record<PlanItem['status'], string> = { planned: 'Planned', done: 'Done', partial: 'Partly done', not_done: 'Not done' };

/** Monday of the week of an ISO date */
export function weekOf(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (dow - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Daily reports (step 4) ----
export type ExecReport = {
  id: string;
  exec_project_id: string;
  report_date: string;
  author_id: string;
  level: 'supervisor' | 'ae';
  status: 'submitted' | 'verified' | 'returned';
  crew_count: number | null;
  crew: string | null;
  work_done: string;
  work_next: string | null;
  delays: string | null;
  inspections: string | null;
  issues: string | null;
  hse_notes: string | null;
  toolbox_talk: boolean;
  toolbox_topic: string | null;
  safety_check: boolean;
  weather: string | null;
  visitors: string | null;
  submitted_at: string;
  is_late: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};
export const REPORT_STATUS: Record<ExecReport['status'], string> = { submitted: 'Waiting for review', verified: 'Verified', returned: 'Returned' };

// ---- HSE (step 5) ----
export type HseReport = {
  id: string;
  code: string;
  exec_project_id: string;
  kind: 'incident' | 'near_miss' | 'unsafe_act' | 'unsafe_condition';
  severity: 'low' | 'medium' | 'high' | 'critical';
  occurred_at: string;
  location: string;
  lat: number | null;
  lng: number | null;
  description: string;
  immediate_action: string | null;
  injured: number;
  lost_time: boolean;
  reported_by: string;
  reported_at: string;
  status: 'open' | 'closed';
  closed_by: string | null;
  closed_at: string | null;
  close_note: string | null;
};
export type HseAction = {
  id: string;
  report_id: string;
  action: string;
  assignee_id: string;
  due_date: string;
  status: 'open' | 'done';
  done_note: string | null;
  done_at: string | null;
  created_by: string | null;
};
export const HSE_KINDS = [
  { value: 'incident', label: 'Incident' },
  { value: 'near_miss', label: 'Near miss' },
  { value: 'unsafe_act', label: 'Unsafe act' },
  { value: 'unsafe_condition', label: 'Unsafe condition' },
];
export const HSE_SEVERITY = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];
export const hseKind = (k: string) => HSE_KINDS.find((x) => x.value === k)?.label ?? k;

// ---- Variations (step 6) ----
export type Variation = {
  id: string;
  code: string;
  exec_project_id: string;
  vtype: 'addition' | 'omission' | 'substitution';
  reason: string;
  title: string;
  description: string;
  quantities: string | null;
  client_ref: string | null;
  raised_by: string;
  raised_at: string;
  status: 'raised' | 'pricing' | 'pending_smp' | 'pending_gm' | 'approved' | 'rejected' | 'client_accepted' | 'client_rejected' | 'cancelled';
  route: 'A' | 'B' | 'C' | null;
  inquiry_id: string | null;
  inquiry_status: string | null;
  value_lkr: number | null;
  cost_lkr: number | null;
  margin_pct: number | null;
  time_days: number | null;
  smp_by: string | null;
  smp_at: string | null;
  smp_note: string | null;
  gm_by: string | null;
  gm_at: string | null;
  gm_note: string | null;
  decision_note: string | null;
  vo_no: string | null;
  client_at: string | null;
  client_note: string | null;
};
export const VAR_TYPES = [
  { value: 'addition', label: 'Addition' },
  { value: 'omission', label: 'Omission' },
  { value: 'substitution', label: 'Substitution' },
];
export const VAR_REASONS = [
  { value: 'client_instruction', label: 'Client instruction' },
  { value: 'site_condition', label: 'Site condition' },
  { value: 'design_change', label: 'Design change' },
  { value: 'missed_item', label: 'Missed item' },
  { value: 'other', label: 'Other' },
];
export const VAR_STATUS: Record<Variation['status'], string> = {
  raised: 'Raised – SEE to screen',
  pricing: 'With Design / Estimation',
  pending_smp: 'SM Projects to approve',
  pending_gm: 'DGM / GM to approve',
  approved: 'Approved – send to client',
  rejected: 'Rejected',
  client_accepted: 'Accepted by client',
  client_rejected: 'Rejected by client',
  cancelled: 'Cancelled',
};
export const VAR_ROUTES: Record<string, string> = { A: 'Design + estimation', B: 'Estimation only', C: 'Contract rates' };

// ---- Materials, documents, design queries (step 7a) ----
export type MaterialRequest = {
  id: string;
  code: string;
  exec_project_id: string;
  requested_by: string;
  requested_at: string;
  required_date: string;
  purpose: string | null;
  est_value_lkr: number | null;
  status: 'ae_review' | 'submitted' | 'pending_smp' | 'approved' | 'ordered' | 'part_received' | 'received' | 'rejected' | 'cancelled';
  decision_note: string | null;
  po_no: string | null;
  supplier: string | null;
  expected_date: string | null;
  priority?: 'normal' | 'urgent';
  activity_id?: string | null;
  deliver_to?: string | null;
  site_contact?: string | null;
};
export type MaterialReceipt = {
  id: string;
  mr_id: string;
  lines: { line_id: string; item: string; unit: string; qty: number }[];
  note: string | null;
  recorded_by: string;
  recorded_at: string;
  supervisor_id: string | null;
  ae_ack_by: string | null;
  ae_ack_at: string | null;
  sub_ack_at: string | null;
  status: 'pending' | 'accepted' | 'disputed';
  dispute_by: string | null;
  dispute_note: string | null;
};
export type MrLine = {
  id: string;
  mr_id: string;
  item: string;
  unit: string;
  qty: number;
  received_qty: number;
  catalog_id?: number | null;
  category?: string | null;
  spec?: string | null;
  brand?: string | null;
  custom?: boolean;
  est_rate?: number | null;
  note?: string | null;
};
export type StoreMove = { id: string; exec_project_id: string; kind: string; item: string; unit: string; qty: number; ref: string | null; note: string | null; by_id: string; at: string };
export const MR_STATUS: Record<MaterialRequest['status'], string> = {
  ae_review: 'AE to check',
  submitted: 'SEE to approve',
  pending_smp: 'SM Projects to approve',
  approved: 'Approved – Operations to order',
  ordered: 'Ordered',
  part_received: 'Part received',
  received: 'Received',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
export const STORE_KINDS = [
  { value: 'issue', label: 'Issue to work' },
  { value: 'return', label: 'Return to store' },
  { value: 'transfer_out', label: 'Transfer out' },
  { value: 'transfer_in', label: 'Transfer in' },
];
/** Balance per item in the site store from the movements */
export function storeBalance(moves: StoreMove[]) {
  const m = new Map<string, { item: string; unit: string; qty: number }>();
  for (const x of moves) {
    const k = x.item.toLowerCase();
    const cur = m.get(k) ?? { item: x.item, unit: x.unit, qty: 0 };
    cur.qty += ['receipt', 'return', 'transfer_in'].includes(x.kind) ? Number(x.qty) : -Number(x.qty);
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => a.item.localeCompare(b.item));
}

export type ExecDoc = {
  id: string;
  exec_project_id: string;
  doc_no: string;
  title: string;
  doc_type: string;
  revision: string;
  status: 'for_construction' | 'for_approval' | 'superseded';
  approval_code: 'A' | 'B' | 'C' | 'rejected' | null;
  issued_to_subs: boolean;
  uploaded_by: string;
  uploaded_at: string;
  note: string | null;
};
export const DOC_TYPES = [
  { value: 'drawing', label: 'Drawing' },
  { value: 'specification', label: 'Specification' },
  { value: 'method_statement', label: 'Method statement' },
  { value: 'submittal', label: 'Submittal' },
  { value: 'calculation', label: 'Calculation' },
  { value: 'other', label: 'Other' },
];
export const DOC_STATUS: Record<ExecDoc['status'], string> = { for_construction: 'For construction', for_approval: 'For approval', superseded: 'Superseded' };

export type DesignQuery = {
  id: string;
  code: string;
  exec_project_id: string;
  question: string;
  drawing_ref: string | null;
  blocks: string | null;
  raised_by: string;
  raised_at: string;
  status: 'raised' | 'forwarded' | 'answered' | 'closed' | 'rejected';
  target_date: string | null;
  assignee_id: string | null;
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  note: string | null;
};
export const DQ_STATUS: Record<DesignQuery['status'], string> = {
  raised: 'SEE to screen',
  forwarded: 'With Design',
  answered: 'Answered',
  closed: 'Closed',
  rejected: 'Answered by SEE',
};

// ---- QA / QC, handover, cost (step 7b) ----
export type Instrument = { id: string; name: string; model: string | null; serial_no: string; calibration_due: string; active: boolean };
export type TestRow = { param: string; unit: string | null; min: number | null; max: number | null; value: number; pass: boolean };
export type TestRecord = {
  id: string;
  code: string;
  exec_project_id: string;
  area: string | null;
  system: string;
  test_type: string;
  instrument_id: string | null;
  rows: TestRow[];
  result: 'pass' | 'fail';
  witness: string | null;
  performed_by: string;
  performed_at: string;
  status: 'submitted' | 'verified' | 'returned';
  note: string | null;
};
export type Ncr = {
  id: string;
  code: string;
  exec_project_id: string;
  test_record_id: string | null;
  description: string;
  severity: 'minor' | 'major' | 'critical';
  root_cause: string | null;
  corrective_action: string | null;
  owner_id: string | null;
  due_date: string | null;
  status: 'open' | 'closed';
  raised_at: string;
  closed_at: string | null;
  close_note: string | null;
};
export type Snag = {
  id: string;
  exec_project_id: string;
  location: string;
  description: string;
  responsible: string;
  priority: 'low' | 'normal' | 'high';
  due_date: string | null;
  status: 'open' | 'closed';
  raised_at: string;
  closed_at: string | null;
};
export type GateCheck = { check: string; ok: boolean; detail: string };
export type ExecGate = {
  id: string;
  exec_project_id: string;
  gate: number;
  checklist: Record<string, boolean>;
  checks: GateCheck[];
  requested_by: string;
  requested_at: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_at: string | null;
  override: boolean;
  note: string | null;
  legacy?: boolean;
  event_date?: string | null;
};
/** Manual confirmations the SEE ticks when requesting each gate (the data checks run on the server) */
export const GATE_CHECKLIST: Record<number, string[]> = {
  2: ['Testing and commissioning complete, witnessed by the client', 'As-built drawings and O&M manuals submitted', 'Client training done', 'Handover certificate signed by the client'],
  3: ['Defects liability period ended – defects closed', 'Final account agreed', 'Warranty registered', 'Retention release requested'],
};
export type DossierItem = { id: string; exec_project_id: string; area: string; item: string; mandatory: boolean; done: boolean; done_by: string | null; done_at: string | null };
export type CostLine = {
  id: string;
  exec_project_id: string;
  cost_code: 'material' | 'labour' | 'subcontract' | 'equipment' | 'overheads';
  description: string;
  budget: number;
  committed: number;
  actual: number;
  updated_at: string;
};
export const COST_CODES = [
  { value: 'material', label: 'Material' },
  { value: 'labour', label: 'Labour' },
  { value: 'subcontract', label: 'Subcontract' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'overheads', label: 'Overheads' },
];
export type SubCert = {
  id: string;
  code: string;
  exec_project_id: string;
  subcontractor: string;
  period: string;
  gross: number;
  previous: number;
  retention_pct: number;
  deductions: number;
  net: number;
  note: string | null;
  status: 'draft' | 'ae_review' | 'prepared' | 'verified' | 'approved' | 'paid' | 'returned' | 'cancelled';
  prepared_by: string;
  prepared_at: string;
  submitted_at: string | null;
  ae_by: string | null;
  ae_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  approved_at: string | null;
  revision: number;
  paid_ref: string | null;
  paid_at: string | null;
  return_note: string | null;
};
export const CERT_STATUS: Record<SubCert['status'], string> = {
  draft: 'Draft – attach the IPC and sheets',
  ae_review: 'IPA pending – AE checking',
  prepared: 'IPA pending – with the SEE',
  verified: 'IPA approved – SM Projects next',
  approved: 'Operations to pay',
  paid: 'Paid',
  returned: 'Returned with comments',
  cancelled: 'Withdrawn',
};
/** An invoice can be recorded once the SEE has approved the IPC */
/** IPA = Interim Payment Approval: the SEE's approval of the IPC */
export const certApproved = (s: SubCert['status']) => s === 'verified' || s === 'approved' || s === 'paid';

// ---- Subcontractor invoices: recorded for reference against a verified IPC; SEE → Operations; then the physical documents ----
export type SubInvoice = {
  id: string;
  code: string;
  exec_project_id: string;
  sub_cert_id: string;
  subcontractor: string;
  invoice_no: string;
  invoice_date: string;
  amount: number;
  note: string | null;
  status: 'draft' | 'ae_review' | 'submitted' | 'see_approved' | 'approved' | 'returned' | 'docs_received' | 'cancelled';
  revision: number;
  created_by: string;
  created_at: string;
  submitted_at: string | null;
  ae_by: string | null;
  ae_at: string | null;
  see_by: string | null;
  see_at: string | null;
  ops_by: string | null;
  ops_at: string | null;
  returned_by: string | null;
  returned_at: string | null;
  return_note: string | null;
  docs_received_at: string | null;
  docs_note: string | null;
};
export const SINV_STATUS: Record<SubInvoice['status'], { label: string; tone: 'grey' | 'amber' | 'blue' | 'green' | 'red' }> = {
  draft: { label: 'Draft – attach the copy and submit', tone: 'grey' },
  ae_review: { label: 'With the Assistant Engineer to check', tone: 'amber' },
  submitted: { label: 'With the Senior Electrical Engineer', tone: 'amber' },
  see_approved: { label: 'With the Operations Executive', tone: 'amber' },
  approved: { label: 'Approved – submit the physical documents', tone: 'blue' },
  returned: { label: 'Returned with comments', tone: 'red' },
  docs_received: { label: 'Physical documents received', tone: 'green' },
  cancelled: { label: 'Withdrawn', tone: 'grey' },
};
/** Shown wherever an invoice is recorded: the record is for reference, the originals go to the office */
export const SINV_NOTICE =
  'This submission is for recording purposes only. The physical documents must be submitted to the DIMO Lighting Solutions office for processing – you will be told here when they can be submitted.';

// ---- Hand-over to execution (Operations requests a won project / SEE enters a pre-system project; SM Projects approves) ----
export type ExecRequest = {
  id: string;
  code: string;
  kind: 'won' | 'legacy';
  project_id: string | null;
  name: string;
  client_name: string | null;
  contract_value_lkr: number | null;
  contract_ref: string | null;
  site_address: string | null;
  start_date: string | null;
  end_date: string | null;
  areas: string[];
  see_id: string | null;
  note: string | null;
  police_required: boolean;
  letter_sign_name: string | null;
  letter_sign_designation: string | null;
  letter_sign_phone: string | null;
  requested_by: string;
  requested_at: string;
  status: 'pending_smp' | 'approved' | 'rejected' | 'cancelled';
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  exec_project_id: string | null;
};
export const EXR_STATUS: Record<ExecRequest['status'], string> = { pending_smp: 'SM Projects to approve', approved: 'With the execution team', rejected: 'Not approved', cancelled: 'Cancelled' };
