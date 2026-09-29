// Domain types mirroring the database (supabase/migrations).

export type Role = 'salesperson' | 'manager' | 'designer' | 'estimator' | 'admin';
export type SyncStatus = 'draft' | 'queued' | 'synced' | 'needs_attention';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string;
  phone?: string | null;
  role: Role;
  active: boolean;
  business_unit_id?: string | null;
  territory_ids?: string[];
}

export interface Territory { id: string; code: string; name: string; active: boolean }
export interface LookupValue { id: string; list_key: string; code: string; label: string; sort_order: number; active: boolean }
export interface Stage {
  id: string; code: string; name: string; sort_order: number; default_probability: number;
  outcome: 'open' | 'won' | 'lost' | 'on_hold' | 'cancelled';
  exit_required_fields: string[]; entry_required_fields: string[]; active: boolean;
}

interface Stamped {
  version?: number;
  created_at?: string;
  created_by?: string | null;
  updated_at?: string;
  updated_by?: string | null;
}

export interface Customer extends Stamped {
  id: string; code?: string; legal_name: string; trading_name?: string | null; category?: string | null;
  industry?: string | null; address?: string | null; district?: string | null; city?: string | null; country?: string | null;
  website?: string | null; phone?: string | null; email?: string | null; owner_id?: string | null; territory_id?: string | null;
  strategic_priority?: string | null; status?: 'provisional' | 'prospect' | 'active' | 'inactive'; source?: string | null;
  notes?: string | null; parent_customer_id?: string | null; last_visit_at?: string | null;
}

export interface Contact extends Stamped {
  id: string; code?: string; customer_id: string; full_name: string; designation?: string | null; department?: string | null;
  work_phone?: string | null; mobile_phone?: string | null; email?: string | null; decision_role?: string | null;
  preferred_contact_method?: string | null; owner_id?: string | null; active?: boolean;
  consent_status?: 'unknown' | 'granted' | 'withdrawn'; communication_preference?: string | null; notes?: string | null;
}

export interface Project extends Stamped {
  id: string; code?: string; name: string; aliases?: string[]; site_location?: string | null; district?: string | null;
  city?: string | null; latitude?: number | null; longitude?: number | null; customer_id?: string | null;
  developer_id?: string | null; end_user_id?: string | null; project_type?: string | null; description?: string | null;
  segments?: string[]; systems_products?: string | null; quantities?: string | null; technical_standards?: string | null;
  lux_targets?: string | null; controls_requirements?: string | null; drawing_links?: string[];
  total_estimate?: number | null; addressable_value?: number | null; currency?: string; budget_status?: string | null;
  funding_source?: string | null; bid_strategy?: string | null; partner_supplier?: string | null; competitors?: string | null;
  incumbent?: string | null; spec_status?: string | null; design_stage?: string | null;
  tender_publication_date?: string | null; tender_closing_date?: string | null; quotation_due_date?: string | null;
  expected_award_date?: string | null; expected_delivery_date?: string | null; installation_start_date?: string | null;
  installation_end_date?: string | null; date_confidence?: string | null; info_source?: string | null;
  tender_reference?: string | null; lead_source?: string | null; boq_reference?: string | null;
  owner_id?: string | null; territory_id?: string | null; status?: string; last_activity_at?: string;
}

export interface Opportunity extends Stamped {
  id: string; code?: string; project_id: string; name: string; segment?: string | null; systems_products?: string | null;
  quantities?: string | null; owner_id?: string | null; stage_id: string; probability?: number | null;
  estimated_value?: number | null; currency?: string; weighted_value?: number | null; expected_order_date?: string | null;
  quotation_due_date?: string | null; next_milestone?: string | null; next_milestone_date?: string | null; blocker?: string | null;
  bid_strategy?: string | null; partner_supplier?: string | null; competitors?: string | null; incumbent?: string | null;
  spec_status?: string | null; win_loss_reason?: string | null; win_loss_notes?: string | null;
  final_award_value?: number | null; award_date?: string | null; closed_at?: string | null; last_activity_at?: string;
  inquiry_received_at?: string | null;
}

export interface Visit extends Stamped {
  id: string; code?: string; salesperson_id?: string; customer_id?: string | null; contact_unavailable_reason?: string | null;
  visit_type?: string | null; status?: 'planned' | 'draft' | 'submitted' | 'cancelled'; scheduled_at?: string | null;
  visit_date?: string | null; check_in_at?: string | null; check_out_at?: string | null; duration_minutes?: number | null;
  device_created_at?: string | null; submitted_at?: string | null; meeting_place?: string | null; is_remote?: boolean;
  check_in_lat?: number | null; check_in_lng?: number | null; check_in_accuracy_m?: number | null;
  check_out_lat?: number | null; check_out_lng?: number | null; check_out_accuracy_m?: number | null;
  location_consent?: boolean | null; location_unavailable_reason?: string | null;
  purpose?: string | null; products_discussed?: string | null; requirements?: string | null; pain_points?: string | null;
  decision_process?: string | null; budget_indication?: string | null; funding_status?: string | null;
  purchase_timeline?: string | null; estimated_value?: number | null; currency?: string; confidence?: 'low' | 'medium' | 'high' | null;
  competitor?: string | null; incumbent?: string | null; spec_position?: string | null; differentiator?: string | null;
  risks?: string | null; summary?: string | null; commitments?: string | null; documents_shared?: string | null;
  documents_requested?: string | null; outcome?: string | null; next_meeting_at?: string | null; no_followup_reason?: string | null;
  territory_id?: string | null;
}

export interface Action extends Stamped {
  id: string; code?: string; customer_id?: string | null; project_id?: string | null; opportunity_id?: string | null;
  visit_id?: string | null; description: string; owner_id?: string; priority?: 'low' | 'normal' | 'high' | 'urgent';
  due_date?: string | null; status?: 'open' | 'in_progress' | 'done' | 'cancelled'; completed_at?: string | null;
  result?: string | null; escalated?: boolean; escalated_to?: string | null; escalation_note?: string | null;
}

export interface Quotation extends Stamped {
  id: string; code?: string; opportunity_id: string; reference: string; revision: number;
  status: 'draft' | 'submitted' | 'accepted' | 'rejected' | 'superseded' | 'expired' | 'withdrawn';
  submission_date?: string | null; amount?: number | null; currency: string; validity_date?: string | null;
  recipient_customer_id?: string | null; recipient_contact_id?: string | null; prepared_by?: string | null;
  outcome_note?: string | null; document_url?: string | null;
}

export interface QuotationFinancials { quotation_id: string; cost_amount?: number | null; gross_margin_pct?: number | null; margin_note?: string | null }

export interface Stakeholder {
  id: string; project_id: string; customer_id?: string | null; contact_id?: string | null; stakeholder_role: string;
  influence_stage?: string | null; is_decision_maker?: boolean; notes?: string | null;
}

export interface Milestone extends Stamped {
  id: string; project_id: string; opportunity_id?: string | null; kind: string; title: string; planned_date?: string | null;
  actual_date?: string | null; status: string; revision?: number; owner_id?: string | null; notes?: string | null;
}

export interface Attachment {
  id: string; entity_type: string; entity_id: string; storage_path: string; filename: string; mime_type?: string | null;
  size_bytes?: number | null; file_version?: number; caption?: string | null; created_at?: string; created_by?: string | null;
}

/** An attachment captured on the device, uploaded during sync. */
export interface LocalAttachment {
  id: string;
  localUri: string;
  filename: string;
  mime_type: string;
  size_bytes?: number | null;
  caption?: string | null;
  uploaded?: boolean;
  storage_path?: string;
}

export interface NewAction {
  id: string; description: string; owner_id?: string | null; due_date?: string | null;
  priority?: Action['priority']; project_id?: string | null; opportunity_id?: string | null;
}

export interface NewStakeholder {
  id: string; project_id: string; customer_id?: string | null; contact_id?: string | null; stakeholder_role: string;
  influence_stage?: string | null; is_decision_maker?: boolean;
}

/** Everything captured for one visit on the device; this is what submit_visit receives. */
export interface VisitPayload {
  visit: Visit;
  base_version?: number | null;
  new_customers: Customer[];
  new_contacts: Contact[];
  new_projects: Project[];
  new_opportunities: (Partial<Opportunity> & { id: string; project_id: string; name: string; stage_code?: string })[];
  new_stakeholders: NewStakeholder[];
  contact_ids: string[];
  project_ids: string[];
  opportunity_ids: string[];
  actions: NewAction[];
  attachments: LocalAttachment[];
}

export interface OutboxItem {
  id: string; // visit id
  status: SyncStatus;
  payload: VisitPayload;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  error?: string | null;
  serverCode?: string | null;
  syncedAt?: string | null;
}

export interface ReportFilters {
  from?: string | null;
  to?: string | null;
  owner_id?: string | null;
  territory_id?: string | null;
  stage_id?: string | null;
}

export type WorkKind = 'design' | 'estimation';
export type WorkStatus = 'new' | 'in_progress' | 'on_hold' | 'submitted' | 'cancelled';

/** A design or estimation job for a package (inquiry → submitted), incl. revisions. */
export interface WorkRequest extends Stamped {
  id: string; code?: string; kind: WorkKind; opportunity_id: string; project_id?: string | null; task_type?: string | null;
  title: string; description?: string | null; priority?: 'low' | 'normal' | 'high' | 'urgent'; status?: WorkStatus;
  received_at?: string; due_date?: string | null; started_at?: string | null; completed_at?: string | null;
  completed_late?: boolean | null; requested_by?: string | null; assigned_to?: string | null; revision?: number;
  parent_request_id?: string | null; quotation_id?: string | null; revision_reason?: string | null;
  client_feedback?: string | null; deliverable_note?: string | null; deliverable_link?: string | null;
}

export interface WorkEvent {
  id: number; request_id: string; event: string; note?: string | null; from_value?: string | null; to_value?: string | null;
  created_by?: string | null; created_at: string;
}
