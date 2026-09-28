-- DIMO Sales Visit & Project Tracking — starting reference data.
-- Everything here is editable by administrators in the app (Admin > Lists,
-- Stages, Settings). Territory and stage values are placeholders pending
-- DIMO's decisions (brief section 9).

insert into public.app_settings (key, value, description) values
  ('base_currency', '"LKR"', 'Currency used for dashboard totals; other currencies are converted with exchange_rates'),
  ('display_time_zone', '"Asia/Colombo"', 'Time zone for display; storage is always UTC'),
  ('gps_required', 'false', 'When true, a visit needs GPS at check-in or a reason why location is unavailable'),
  ('margin_visible_roles', '["manager","admin"]', 'Roles that may see quotation cost and gross margin'),
  ('stale_project_days', '30', 'Projects with no activity for this many days are flagged on the dashboard'),
  ('audit_retention_days', '2555', 'Audit log retention (about 7 years)'),
  ('export_log_retention_days', '730', 'Export history retention'),
  ('attachment_max_mb', '25', 'Maximum size of one attachment'),
  ('reminder_days_before', '1', 'Days before an action is due that the owner is reminded'),
  ('dedupe_similarity', '0.3', 'Similarity score (0-1) above which possible duplicates are shown')
on conflict (key) do nothing;

insert into public.business_units (code, name) values
  ('LIGHTING', 'DIMO Lighting Solutions')
on conflict (code) do nothing;

insert into public.territories (code, name, business_unit_id)
select t.code, t.name, (select id from public.business_units where code = 'LIGHTING')
from (values
  ('WESTERN', 'Western'), ('CENTRAL', 'Central'), ('SOUTHERN', 'Southern'), ('NORTHERN', 'Northern'),
  ('EASTERN', 'Eastern'), ('NORTH_WESTERN', 'North Western'), ('NORTH_CENTRAL', 'North Central'),
  ('UVA', 'Uva'), ('SABARAGAMUWA', 'Sabaragamuwa'), ('KEY_ACCOUNTS', 'Key accounts / Government')) t(code, name)
on conflict (code) do nothing;

insert into public.pipeline_stages (code, name, sort_order, default_probability, outcome, exit_required_fields, entry_required_fields) values
  ('lead', 'Lead identified', 10, 5, 'open', '{}', '{}'),
  ('qualification', 'Qualification', 20, 10, 'open', '{estimated_value}', '{}'),
  ('design_influence', 'Design or specification influence', 30, 20, 'open', '{expected_order_date}', '{}'),
  ('tender_expected', 'Tender expected', 40, 30, 'open', '{}', '{}'),
  ('tender_open', 'Tender open', 50, 40, 'open', '{quotation_due_date}', '{}'),
  ('quotation_submitted', 'Quotation submitted', 60, 50, 'open', '{}', '{}'),
  ('negotiation', 'Negotiation', 70, 70, 'open', '{}', '{}'),
  ('won', 'Won', 80, 100, 'won', '{}', '{win_loss_reason,award_date}'),
  ('lost', 'Lost', 90, 0, 'lost', '{}', '{win_loss_reason}'),
  ('on_hold', 'On hold', 95, 0, 'on_hold', '{}', '{}'),
  ('cancelled', 'Cancelled', 99, 0, 'cancelled', '{}', '{}')
on conflict (code) do nothing;

insert into public.lookup_values (list_key, code, label, sort_order)
select list_key, code, label, row_number() over (partition by list_key order by ord) * 10
from (values
  -- visit types
  ('visit_type', 'intro', 'Introduction / first meeting', 1), ('visit_type', 'follow_up', 'Follow up', 2),
  ('visit_type', 'presentation', 'Product presentation / demo', 3), ('visit_type', 'site_survey', 'Site survey', 4),
  ('visit_type', 'technical', 'Technical discussion', 5), ('visit_type', 'negotiation', 'Commercial negotiation', 6),
  ('visit_type', 'complaint', 'Service / complaint', 7), ('visit_type', 'remote', 'Remote meeting (call / video)', 8),
  ('visit_type', 'other', 'Other', 9),
  -- customer categories
  ('customer_category', 'developer', 'Developer', 1), ('customer_category', 'architect', 'Architect', 2),
  ('customer_category', 'consultant', 'Consultant', 3), ('customer_category', 'contractor', 'Contractor', 4),
  ('customer_category', 'government', 'Government', 5), ('customer_category', 'end_user', 'End user', 6),
  ('customer_category', 'distributor', 'Distributor', 7), ('customer_category', 'other', 'Other', 8),
  -- industries
  ('industry', 'commercial', 'Commercial real estate', 1), ('industry', 'hospitality', 'Hospitality', 2),
  ('industry', 'healthcare', 'Healthcare', 3), ('industry', 'education', 'Education', 4),
  ('industry', 'industrial', 'Industrial / manufacturing', 5), ('industry', 'retail', 'Retail', 6),
  ('industry', 'infrastructure', 'Infrastructure', 7), ('industry', 'sports', 'Sports & leisure', 8),
  ('industry', 'residential', 'Residential', 9), ('industry', 'public_sector', 'Public sector', 10), ('industry', 'other', 'Other', 11),
  -- project types
  ('project_type', 'new_build', 'New build', 1), ('project_type', 'refurbishment', 'Refurbishment / retrofit', 2),
  ('project_type', 'expansion', 'Expansion', 3), ('project_type', 'maintenance', 'Maintenance contract', 4), ('project_type', 'other', 'Other', 5),
  -- lighting segments
  ('project_segment', 'indoor', 'Indoor', 1), ('project_segment', 'outdoor', 'Outdoor', 2), ('project_segment', 'facade', 'Facade', 3),
  ('project_segment', 'sports', 'Sports', 4), ('project_segment', 'airport', 'Airport', 5), ('project_segment', 'port', 'Port', 6),
  ('project_segment', 'smart_controls', 'Smart controls', 7), ('project_segment', 'other', 'Other', 8),
  -- visit outcomes
  ('visit_outcome', 'positive', 'Positive – next step agreed', 1), ('visit_outcome', 'info_gathered', 'Information gathered', 2),
  ('visit_outcome', 'quotation_requested', 'Quotation requested', 3), ('visit_outcome', 'sample_requested', 'Sample / demo requested', 4),
  ('visit_outcome', 'no_interest', 'No current interest', 5), ('visit_outcome', 'rescheduled', 'Rescheduled', 6),
  ('visit_outcome', 'order_received', 'Order received', 7),
  -- reasons
  ('win_loss_reason', 'price', 'Price', 1), ('win_loss_reason', 'specification', 'Specification / technical fit', 2),
  ('win_loss_reason', 'relationship', 'Relationship', 3), ('win_loss_reason', 'delivery', 'Delivery time', 4),
  ('win_loss_reason', 'brand', 'Brand preference', 5), ('win_loss_reason', 'budget', 'Budget cut / project cancelled', 6),
  ('win_loss_reason', 'service', 'Service & support', 7), ('win_loss_reason', 'other', 'Other', 8),
  ('no_followup_reason', 'no_opportunity', 'No opportunity at present', 1), ('no_followup_reason', 'courtesy', 'Courtesy visit only', 2),
  ('no_followup_reason', 'handled_by_other', 'Handled by another colleague', 3), ('no_followup_reason', 'other', 'Other', 4),
  ('contact_unavailable_reason', 'reception_only', 'Met reception / left materials', 1),
  ('contact_unavailable_reason', 'site_only', 'Site inspection only', 2), ('contact_unavailable_reason', 'declined_details', 'Contact declined to share details', 3),
  ('location_unavailable_reason', 'no_permission', 'Location permission not given', 1),
  ('location_unavailable_reason', 'no_signal', 'No GPS signal', 2), ('location_unavailable_reason', 'remote', 'Remote meeting', 3),
  ('location_unavailable_reason', 'recorded_later', 'Recorded after leaving site', 4),
  -- people
  ('decision_role', 'decision_maker', 'Decision maker', 1), ('decision_role', 'influencer', 'Influencer', 2),
  ('decision_role', 'technical_evaluator', 'Technical evaluator', 3), ('decision_role', 'procurement', 'Procurement', 4), ('decision_role', 'user', 'User', 5),
  ('stakeholder_role', 'owner', 'Project owner / client', 1), ('stakeholder_role', 'developer', 'Developer', 2),
  ('stakeholder_role', 'architect', 'Architect', 3), ('stakeholder_role', 'mep_consultant', 'MEP consultant', 4),
  ('stakeholder_role', 'lighting_designer', 'Lighting designer', 5), ('stakeholder_role', 'electrical_contractor', 'Electrical contractor', 6),
  ('stakeholder_role', 'main_contractor', 'Main contractor', 7), ('stakeholder_role', 'procurement_authority', 'Procurement authority', 8),
  ('stakeholder_role', 'end_user', 'End user', 9), ('stakeholder_role', 'decision_maker', 'Decision maker', 10),
  ('influence_stage', 'unknown', 'Unknown', 1), ('influence_stage', 'aware', 'Aware of DIMO', 2), ('influence_stage', 'engaged', 'Engaged', 3),
  ('influence_stage', 'specifying', 'Specifying DIMO', 4), ('influence_stage', 'champion', 'Champion', 5), ('influence_stage', 'opposed', 'Opposed', 6),
  -- project status fields
  ('design_stage', 'concept', 'Concept', 1), ('design_stage', 'schematic', 'Schematic design', 2), ('design_stage', 'detailed', 'Detailed design', 3),
  ('design_stage', 'tender_docs', 'Tender documents', 4), ('design_stage', 'construction', 'Construction', 5), ('design_stage', 'fit_out', 'Fit-out', 6),
  ('budget_status', 'unknown', 'Unknown', 1), ('budget_status', 'indicative', 'Indicative', 2), ('budget_status', 'approved', 'Approved', 3),
  ('budget_status', 'funded', 'Funded', 4), ('budget_status', 'not_funded', 'Not funded', 5),
  ('spec_status', 'unknown', 'Unknown', 1), ('spec_status', 'open', 'Open specification', 2), ('spec_status', 'dimo_specified', 'DIMO / our brands specified', 3),
  ('spec_status', 'equivalent', 'Equivalent allowed', 4), ('spec_status', 'competitor_specified', 'Competitor specified', 5),
  ('lead_source', 'field_visit', 'Field visit', 1), ('lead_source', 'tender_notice', 'Tender notice', 2), ('lead_source', 'referral', 'Referral', 3),
  ('lead_source', 'consultant', 'Consultant', 4), ('lead_source', 'inbound', 'Inbound enquiry', 5), ('lead_source', 'exhibition', 'Exhibition / event', 6),
  ('lead_source', 'existing_customer', 'Existing customer', 7), ('lead_source', 'other', 'Other', 8),
  ('date_confidence', 'confirmed', 'Confirmed', 1), ('date_confidence', 'estimated', 'Estimated', 2), ('date_confidence', 'rumoured', 'Unverified', 3),
  ('strategic_priority', 'A', 'A – strategic', 1), ('strategic_priority', 'B', 'B – important', 2), ('strategic_priority', 'C', 'C – standard', 3),
  ('milestone_kind', 'design', 'Design', 1), ('milestone_kind', 'lighting_calc', 'Lighting calculation', 2), ('milestone_kind', 'submittal', 'Submittal', 3),
  ('milestone_kind', 'sample', 'Sample / mock-up', 4), ('milestone_kind', 'approval', 'Approval', 5), ('milestone_kind', 'po', 'Purchase order', 6),
  ('milestone_kind', 'delivery', 'Delivery', 7), ('milestone_kind', 'installation', 'Installation', 8), ('milestone_kind', 'handover', 'Handover', 9),
  ('currency', 'LKR', 'LKR – Sri Lankan rupee', 1), ('currency', 'USD', 'USD – US dollar', 2), ('currency', 'EUR', 'EUR – Euro', 3),
  ('district', 'Colombo', 'Colombo', 1), ('district', 'Gampaha', 'Gampaha', 2), ('district', 'Kalutara', 'Kalutara', 3),
  ('district', 'Kandy', 'Kandy', 4), ('district', 'Matale', 'Matale', 5), ('district', 'Nuwara Eliya', 'Nuwara Eliya', 6),
  ('district', 'Galle', 'Galle', 7), ('district', 'Matara', 'Matara', 8), ('district', 'Hambantota', 'Hambantota', 9),
  ('district', 'Jaffna', 'Jaffna', 10), ('district', 'Kilinochchi', 'Kilinochchi', 11), ('district', 'Mannar', 'Mannar', 12),
  ('district', 'Vavuniya', 'Vavuniya', 13), ('district', 'Mullaitivu', 'Mullaitivu', 14), ('district', 'Batticaloa', 'Batticaloa', 15),
  ('district', 'Ampara', 'Ampara', 16), ('district', 'Trincomalee', 'Trincomalee', 17), ('district', 'Kurunegala', 'Kurunegala', 18),
  ('district', 'Puttalam', 'Puttalam', 19), ('district', 'Anuradhapura', 'Anuradhapura', 20), ('district', 'Polonnaruwa', 'Polonnaruwa', 21),
  ('district', 'Badulla', 'Badulla', 22), ('district', 'Monaragala', 'Monaragala', 23), ('district', 'Ratnapura', 'Ratnapura', 24),
  ('district', 'Kegalle', 'Kegalle', 25)
) v(list_key, code, label, ord)
on conflict (list_key, code) do nothing;
