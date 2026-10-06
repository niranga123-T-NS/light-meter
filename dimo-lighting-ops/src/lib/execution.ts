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

export const EXEC_STAGES = ['Sales handover', 'Mobilise & plan', 'Install', 'Test & commission', 'Handover', 'DLP & closure'];

export type ExecProject = {
  id: string;
  project_id: string;
  code: string | null;
  name: string;
  areas: string[];
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
  source: 'plan' | 'supervisor';
  acceptance: 'pending' | 'accepted' | 'rejected' | null;
  reject_reason: string | null;
  status: 'planned' | 'done' | 'partial' | 'not_done';
  done_qty: number | null;
  result_note: string | null;
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
