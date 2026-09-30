// Hand-written types for the tables the app reads. Regenerate the full set with
// `npx supabase gen types typescript --linked > src/lib/database.types.ts` once the project is linked.

export type Role =
  | 'gm'
  | 'sm_projects'
  | 'asm_building'
  | 'asm_infra'
  | 'design_manager'
  | 'lighting_designer'
  | 'lighting_engineer'
  | 'sm_estimation'
  | 'am_estimation'
  | 'estimation_exec'
  | 'operations_exec'
  | 'sys_admin';

export type ProjectType = 'hospitality' | 'retail' | 'institutions' | 'commercial' | 'infrastructure' | 'industrial';
export type Currency = 'USD' | 'LKR';
export type DutyStatus = 'duty_free' | 'duty_paid';
export type SlaColour = 'green' | 'amber' | 'red' | 'grey';

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  team: string;
  manager_id: string | null;
  project_types: ProjectType[];
  avatar_path: string | null;
  active: boolean;
  digest_mode: boolean;
  notification_prefs: Record<string, unknown>;
};

export type Organization = {
  id: string;
  name: string;
  visit_category: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  account_owner_id: string | null;
  status: string;
  created_at: string;
};

export type OrgUnit = {
  id: string;
  organization_id: string;
  parent_unit_id: string | null;
  name: string;
  unit_type: string;
  address: string | null;
  account_owner_id: string | null;
};

export type Contact = {
  id: string;
  organization_id: string;
  unit_id: string | null;
  name: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
};

export type Milestone =
  | 'lead_identified'
  | 'design_involvement'
  | 'brand_specified'
  | 'quotation_submitted'
  | 'negotiating'
  | 'loa_expected'
  | 'won'
  | 'lost';

export type Project = {
  id: string;
  code: string;
  name: string;
  project_type: ProjectType;
  organization_id: string;
  unit_id: string | null;
  location: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  stage: string;
  milestone: Milestone;
  win_probability: number;
  spec_status: string;
  duty_status: DutyStatus | null;
  currency: Currency;
  project_value: number | null;
  lighting_value: number | null;
  expected_duration_months: number;
  project_term: 'short' | 'medium' | 'long';
  expected_tender_date: string | null;
  expected_award_date: string | null;
  owner_id: string;
  status: string;
  status_reason: string | null;
  on_hold_review_date: string | null;
  last_activity_at: string;
  last_probability_review_at: string;
  created_at: string;
  organizations?: { name: string } | null;
};

export type Visit = {
  id: string;
  code: string | null;
  sales_person_id: string;
  plan_line_id: string | null;
  project_id: string | null;
  organization_id: string;
  unit_id: string | null;
  contact_id: string | null;
  project_type: ProjectType | null;
  visit_category: string;
  primary_objective: string;
  secondary_objectives: string[];
  visit_type: 'normal' | 'tender';
  tender_activity: string | null;
  tender_no: string | null;
  tender_date: string | null;
  unplanned: boolean;
  checkin_at: string;
  checkin_lat: number | null;
  checkin_lng: number | null;
  checkout_at: string | null;
  distance_from_site_m: number | null;
  gps_verified: boolean | null;
  summary: string | null;
  outcome: string | null;
  competitors_mentioned: string[];
  brands_specified: string | null;
  est_project_value: number | null;
  est_lighting_value: number | null;
  currency: Currency;
  next_action: string | null;
  next_action_date: string | null;
  next_action_done_at: string | null;
  status: 'open' | 'closed';
  reviewed_by: string | null;
  review_comment: string | null;
  organizations?: { name: string } | null;
  projects?: { name: string } | null;
};

export type InquiryStatus =
  | 'draft'
  | 'submitted'
  | 'returned_for_info'
  | 'rejected'
  | 'accepted'
  | 'in_design'
  | 'design_review'
  | 'design_approved'
  | 'in_estimation'
  | 'estimation_review'
  | 'quotation_released'
  | 'returned_to_sales'
  | 'submitted_to_client'
  | 'awaiting_client_approval'
  | 'client_approved'
  | 'won'
  | 'lost'
  | 'on_hold'
  | 'cancelled';

export type Inquiry = {
  id: string;
  code: string;
  project_id: string;
  visit_id: string | null;
  sales_person_id: string;
  project_name: string | null;
  customer_name: string | null;
  project_type: ProjectType | null;
  organization_id: string;
  unit_id: string | null;
  contact_id: string | null;
  route: 'A' | 'B' | 'C';
  release_mode: 1 | 2 | 3 | null;
  release_mode_confirmed: boolean;
  duty_status: DutyStatus | null;
  currency: Currency;
  design_scope: 'lighting' | 'electrical' | 'lighting_electrical' | null;
  priority: 'normal' | 'high' | 'urgent';
  submission_type: string | null;
  customer_deadline: string | null;
  design_required_by: string | null;
  quotation_required_by: string | null;
  scope_description: string | null;
  areas: string | null;
  preferred_brands: string | null;
  budget_lkr: number | null;
  approved_makes: string | null;
  checklist: Record<string, boolean>;
  checklist_incomplete: boolean;
  solution_level: 'high' | 'medium' | 'low' | null;
  manufacturing_origin: 'european' | 'chinese' | 'no_preference' | null;
  expectation_notes: string | null;
  status: InquiryStatus;
  hold_reason: string | null;
  revision: number;
  current_owner_id: string | null;
  current_team: string | null;
  current_due_at: string | null;
  progress_pct: number;
  sla_colour: SlaColour;
  delay_reason: string | null;
  revised_due_at: string | null;
  early_design_release_at: string | null;
  design_released_to_sales_at: string | null;
  quotation_released_at: string | null;
  submitted_to_client_at: string | null;
  client_response: string | null;
  result: string | null;
  lost_reason: string | null;
  order_value: number | null;
  order_date: string | null;
  debtor_flag: boolean;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DesignJob = {
  id: string;
  inquiry_id: string;
  revision: number;
  task_type: 'lighting' | 'electrical';
  job_size: 'small' | 'medium' | 'large';
  assignee_id: string | null;
  status: string;
  due_at: string;
  original_due_at: string;
  milestones: { name: string; due?: string; done?: boolean }[];
  progress_pct: number;
  hours_logged: number;
  review_cycles: number;
  brands_specified: BrandLine[];
  hold_reason: string | null;
  hold_waiting_on: string | null;
  requested_due_at: string | null;
  review_comment: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  released_at: string | null;
  inquiries?: Pick<Inquiry, 'code' | 'project_name' | 'customer_name' | 'customer_deadline' | 'route' | 'status' | 'solution_level' | 'manufacturing_origin' | 'expectation_notes' | 'scope_description' | 'design_required_by' | 'revision'> | null;
};

export type BrandLine = { group: string; brand: string; origin?: string };

export type EstimationJob = {
  id: string;
  inquiry_id: string;
  revision: number;
  source: 'design' | 'direct';
  status: string;
  assignee_id: string | null;
  value_band: string | null;
  due_at: string | null;
  quotation_no: string | null;
  quoted_value: number | null;
  validity_days: number;
  brands_offered: BrandLine[];
  alternatives: string | null;
  supplier_waits: { supplier: string; requested?: string; expected?: string; received?: string | null }[];
  design_version_used: string | null;
  hold_reason: string | null;
  requested_due_at: string | null;
  review_comment: string | null;
  submitted_at: string | null;
  released_at: string | null;
  inquiries?: Pick<Inquiry, 'code' | 'project_name' | 'customer_name' | 'customer_deadline' | 'route' | 'status' | 'duty_status' | 'currency' | 'project_type' | 'solution_level' | 'manufacturing_origin' | 'expectation_notes' | 'scope_description' | 'quotation_required_by' | 'debtor_flag' | 'revision'> | null;
};

export type Quotation = {
  id: string;
  inquiry_id: string;
  quotation_no: string;
  revision: number;
  full_no: string;
  quoted_value: number;
  currency: Currency;
  brands_offered: BrandLine[];
  released_at: string;
  validity_date: string;
  submitted_to_client_at: string | null;
  result: string | null;
};

export type SlaClock = {
  id: string;
  inquiry_id: string | null;
  entity_type: string;
  entity_id: string;
  stage: string;
  label: string;
  owner_id: string | null;
  owner_team: string | null;
  started_at: string;
  due_at: string;
  paused_at: string | null;
  hold_reason: string | null;
  stopped_at: string | null;
  colour: SlaColour;
  used_pct: number;
  level: number;
  delay_reason: string | null;
  revised_due_at: string | null;
};

export type Attachment = {
  id: string;
  entity_type: string;
  entity_id: string;
  kind: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  version: number;
  uploaded_by: string;
  uploaded_at: string;
};

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  priority: 'normal' | 'critical';
  entity_type: string | null;
  entity_id: string | null;
  url: string | null;
  requires_open: boolean;
  created_at: string;
  read_at: string | null;
};

export type PendingApproval = {
  source: string;
  id: string;
  kind: string;
  title: string;
  reason: string | null;
  requested_by: string | null;
  requester: string | null;
  requested_at: string | null;
  inquiry_id: string | null;
  url: string;
  step: string | null;
};

export type VisitPlan = {
  id: string;
  sales_person_id: string;
  week_start: string;
  status: 'draft' | 'submitted' | 'approved' | 'returned';
  version: number;
  submitted_at: string | null;
  is_late: boolean;
  approved_by: string | null;
  approved_at: string | null;
  manager_comment: string | null;
  rating: number | null;
  evaluation_comment: string | null;
};

export type PlanLine = {
  id: string;
  plan_id: string;
  planned_date: string;
  time_slot: string | null;
  project_id: string | null;
  organization_id: string;
  unit_id: string | null;
  contact_id: string | null;
  visit_category: string;
  planned_objective: string;
  location: string | null;
  visit_type: 'normal' | 'tender';
  tender_activity: string | null;
  status: 'planned' | 'completed' | 'rescheduled' | 'cancelled' | 'missed';
  change_reason: string | null;
  missed_reason: string | null;
  added_after_approval: boolean;
  joint_visit_approved: boolean;
  organizations?: { name: string } | null;
  projects?: { name: string } | null;
};

export type Debt = {
  id: string;
  invoice_no: string;
  project_id: string | null;
  project_name: string | null;
  organization_id: string | null;
  client_name: string | null;
  sales_person_id: string | null;
  invoice_date: string | null;
  amount: number;
  currency: Currency;
  outstanding_days: number;
  ageing_bucket: string;
  status: string;
  status_note: string | null;
  next_follow_up_date: string | null;
  promised_date: string | null;
  collected_amount: number | null;
  collected_date: string | null;
  dispute_reason: string | null;
  is_legal: boolean;
  legal_description: string | null;
  next_hearing_date: string | null;
  legal_outcome: string | null;
  collection_mismatch: boolean;
  last_status_at: string;
  last_amount_change_at: string;
};

export type Sample = {
  id: string;
  code: string;
  sales_person_id: string;
  project_id: string;
  project_name: string | null;
  client_name: string | null;
  sample_type: 'returnable' | 'non_returnable';
  expected_return_date: string | null;
  purpose: string;
  required_by: string;
  handover_location: string;
  handover_person: { name?: string; designation?: string; organization?: string; phone?: string };
  notes: string | null;
  currency: Currency;
  total_value: number;
  status: string;
  availability: string | null;
  availability_note: string | null;
  approval_comment: string | null;
  handed_over_at: string | null;
  handed_over_by: string | null;
  received_by: string | null;
  returned_at: string | null;
  return_condition: string | null;
  submitted_at: string | null;
  created_at: string;
};

export type SampleItem = {
  id: string;
  sample_id: string;
  description: string;
  product_code: string | null;
  brand: string | null;
  quantity: number;
  quantity_available: number | null;
  unit_value: number;
  total_value: number;
};

export type MasterValue = { list_name: string; value: string; grp: string | null; tags: string[]; sort_order: number };
