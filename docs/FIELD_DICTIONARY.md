# Field dictionary

Generated from the database schema by `scripts/gen_field_dictionary.py` – regenerate after changing a migration.

* **Type** is the PostgreSQL type. `uuid` IDs are generated on the device for offline records; human-readable codes (CUS-, CON-, VIS-, PRJ-, OPP-, ACT-, QUO-) are issued by the server.
* **Mandatory**: `Yes` = enforced by the database on every save; `Submit` = required when a visit is submitted (drafts may be incomplete); `Auto` = set by the system.
* **Allowed values**: fixed values are enforced by check constraints; `list: x` values come from the administrator-maintained list `x` (Admin › Dropdown lists).
* **Timestamps** (`timestamptz`) are stored in UTC and shown / exported in Asia/Colombo time. Money is always stored with its ISO 4217 currency.
* **Edit permission** is enforced on the server by row-level security; see docs/SECURITY_AND_SYNC.md for the full matrix.

## Customer (account) – `customers`

**Edit permission:** Salesperson: create in own territory; edit own / own-territory unowned accounts. Manager/Admin: all, assign owner and territory. Estimator: read only (accounts on assigned projects).

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto | parent_customer_id IS DISTINCT FROM id | Customer ID (unique, permanent) |
| `code` | text | Auto | issued by server | Human-readable customer number, e.g. CUS-000123 |
| `legal_name` | text | Yes | not blank | Registered / legal name |
| `trading_name` | text |  |  | Trading name if different |
| `category` | text |  | list: customer_category | Customer category: developer, architect, consultant, contractor, government, end_user, distributor, other |
| `industry` | text |  | list: industry | Industry code (configurable list) |
| `address` | text |  |  | Postal address |
| `district` | text |  | list: district | District |
| `city` | text |  |  | City |
| `country` | text | Yes | default Sri Lanka | Country |
| `website` | text |  |  | Website |
| `phone` | text |  |  | Main phone |
| `email` | text |  |  | General email |
| `owner_id` | uuid |  |  | Account owner user ID |
| `territory_id` | uuid |  |  | Territory ID |
| `business_unit_id` | uuid |  |  |  |
| `strategic_priority` | text |  | list: strategic_priority | Strategic priority (A/B/C) |
| `status` | text | Yes | provisional, prospect, active, inactive; default active | provisional (created in the field, not yet verified), prospect, active, inactive |
| `source` | text |  | list: lead_source | Lead source |
| `notes` | text |  |  | Notes |
| `parent_customer_id` | uuid |  | parent_customer_id IS DISTINCT FROM id | Parent company customer ID (group structure) |
| `normalized_name` | text | Auto | calculated by the database |  |
| `last_visit_at` | timestamp with time zone | Auto |  | Most recent submitted visit |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |
| `deleted_at` | timestamp with time zone |  |  |  |

## Contact – `contacts`

**Edit permission:** Salesperson: create/edit for customers they can see. Manager/Admin: all. Estimator: read only.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto |  | Contact ID |
| `code` | text | Auto | issued by server | Contact number, e.g. CON-000045 |
| `customer_id` | uuid | Yes |  | Customer ID the person works for |
| `full_name` | text | Yes | not blank | Full name |
| `designation` | text |  |  | Job title |
| `department` | text |  |  | Department |
| `work_phone` | text |  |  | Work phone |
| `mobile_phone` | text |  |  | Mobile phone |
| `email` | text |  | preferred_contact_method = ANY (ARRAY[phone, mobile, email, whatsapp, in_person, other]) | Email |
| `decision_role` | text |  | list: decision_role | decision_maker, influencer, technical_evaluator, procurement, user |
| `preferred_contact_method` | text |  | phone, mobile, email, whatsapp, in_person, other | phone, mobile, email, whatsapp, in_person, other |
| `owner_id` | uuid |  |  | Owner user ID |
| `active` | boolean | Yes | default true | Still an active contact |
| `consent_status` | text | Yes | unknown, granted, withdrawn; default unknown | Communication consent: unknown, granted, withdrawn |
| `communication_preference` | text |  |  | Communication preference notes |
| `notes` | text |  |  | Notes |
| `normalized_name` | text | Auto | calculated by the database |  |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |
| `deleted_at` | timestamp with time zone |  |  |  |

## Visit – `visits`

**Edit permission:** Salesperson: create own; edit only while planned/draft; after submission changes go through a correction request approved by a manager. Manager/Admin: edit any (audited). Estimator: read visits linked to assigned projects.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto |  | Visit ID |
| `code` | text | Auto | issued by server | Visit reference, e.g. VIS-000321 |
| `salesperson_id` | uuid | Submit |  | Salesperson user ID |
| `customer_id` | uuid | Submit |  | Customer ID |
| `contact_unavailable_reason` | text | Submit | list: contact_unavailable_reason | Why no contact is linked (see Visit Contacts) |
| `visit_type` | text | Submit | list: visit_type | Visit type (configurable list) |
| `status` | text | Yes | planned, draft, submitted, cancelled; default draft | planned, submitted, cancelled |
| `scheduled_at` | timestamp with time zone |  |  | Planned date and time |
| `visit_date` | date | Submit |  | Visit date (Asia/Colombo) |
| `check_in_at` | timestamp with time zone |  | (check_out_at IS NULL) OR (check_in_at IS NULL) OR (check_out_at >= check_in_at) | Check-in time (device time) |
| `check_out_at` | timestamp with time zone |  | (check_out_at IS NULL) OR (check_in_at IS NULL) OR (check_out_at >= check_in_at) | Check-out time |
| `duration_minutes` | integer | Auto | calculated by the database | check_out_at − check_in_at in minutes |
| `device_created_at` | timestamp with time zone |  |  | When the record was first created on the device |
| `submitted_at` | timestamp with time zone | Auto |  | When the server accepted the submission |
| `meeting_place` | text |  |  | Meeting place |
| `is_remote` | boolean | Yes | default false | Remote meeting (call / video) |
| `check_in_lat` | double precision |  |  | GPS latitude at check-in (optional, with consent) |
| `check_in_lng` | double precision |  |  | GPS longitude at check-in |
| `check_in_accuracy_m` | double precision |  | (check_in_accuracy_m IS NULL) OR (check_in_accuracy_m >= 0) | GPS accuracy at check-in (metres) |
| `check_out_lat` | double precision |  |  | GPS latitude at check-out |
| `check_out_lng` | double precision |  |  | GPS longitude at check-out |
| `check_out_accuracy_m` | double precision |  |  |  |
| `location_consent` | boolean |  |  |  |
| `location_unavailable_reason` | text | Submit | list: location_unavailable_reason | Why location was not captured |
| `purpose` | text | Submit |  | Purpose of the visit |
| `products_discussed` | text |  |  | Products or systems discussed |
| `requirements` | text |  |  | Requirements |
| `pain_points` | text |  |  | Pain points |
| `decision_process` | text |  |  | Decision process |
| `budget_indication` | text |  |  | Budget indication |
| `funding_status` | text |  | list: budget_status | Funding status |
| `purchase_timeline` | text |  |  | Expected purchase or tender timeline |
| `estimated_value` | numeric(18,2) |  | estimated_value >= 0 | Estimated value (in currency) |
| `currency` | character(3) | Yes | default LKR | ISO 4217 currency code |
| `confidence` | text |  | low, medium, high | low, medium, high |
| `competitor` | text |  |  | Competitor |
| `incumbent` | text |  |  | Incumbent supplier |
| `spec_position` | text |  | list: spec_status | Specification position |
| `differentiator` | text |  |  | DIMO differentiator |
| `risks` | text |  |  | Risks or blockers |
| `summary` | text | Submit |  | Meeting summary |
| `commitments` | text |  |  | Commitments made |
| `documents_shared` | text |  |  | Documents shared |
| `documents_requested` | text |  |  | Documents requested |
| `outcome` | text | Submit | list: visit_outcome | Visit outcome (configurable list) |
| `next_meeting_at` | timestamp with time zone |  |  | Next meeting |
| `no_followup_reason` | text | Submit | list: no_followup_reason | Reason when no follow-up action was set |
| `territory_id` | uuid |  |  |  |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |

## Visit ↔ contact link – `visit_contacts`

**Edit permission:** Same as the visit.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `visit_id` | uuid | Yes |  | Visit ID |
| `contact_id` | uuid | Yes |  | Contact ID |

## Visit ↔ project link – `visit_projects`

**Edit permission:** Same as the visit.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `visit_id` | uuid | Yes |  |  |
| `project_id` | uuid | Yes |  |  |

## Visit ↔ package link – `visit_opportunities`

**Edit permission:** Same as the visit.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `visit_id` | uuid | Yes |  |  |
| `opportunity_id` | uuid | Yes |  |  |

## Project (one per physical project or tender) – `projects`

**Edit permission:** Salesperson: create; edit own, own-territory or shared (member) projects. Manager/Admin: all. Estimator: read assigned projects.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto |  | Project ID |
| `code` | text | Auto | issued by server | Project number, e.g. PRJ-000012 |
| `name` | text | Yes | not blank | Project name |
| `aliases` | text[] | Yes | default {} | Other names used for the project (semicolon separated) |
| `site_location` | text |  |  | Site / location |
| `district` | text |  |  | District |
| `city` | text |  |  | City |
| `latitude` | double precision |  |  | Site latitude |
| `longitude` | double precision |  |  | Site longitude |
| `customer_id` | uuid |  |  | Customer / project owner ID |
| `developer_id` | uuid |  |  | Developer customer ID |
| `end_user_id` | uuid |  |  | End user customer ID |
| `project_type` | text |  | list: project_type | Project type |
| `description` | text |  |  | Brief description |
| `segments` | text[] | Yes | list: project_segment; default {} | Lighting segments: indoor, outdoor, facade, sports, airport, port, smart_controls, other |
| `systems_products` | text |  |  | Systems / products |
| `quantities` | text |  |  | Quantities where known |
| `technical_standards` | text |  |  | Technical standards |
| `lux_targets` | text |  |  | Lux targets |
| `controls_requirements` | text |  |  | Controls / integration requirements |
| `drawing_links` | text[] | Yes | default {} | Drawing / specification links |
| `total_estimate` | numeric(18,2) |  |  | Total project estimate |
| `addressable_value` | numeric(18,2) |  |  | DIMO addressable value |
| `currency` | character(3) | Yes | default LKR | Currency of the project values |
| `budget_status` | text |  | list: budget_status | Budget status |
| `funding_source` | text |  |  | Funding source |
| `bid_strategy` | text |  |  | Bid strategy |
| `partner_supplier` | text |  |  | Partner or supplier |
| `competitors` | text |  |  | Competitors |
| `incumbent` | text |  |  | Incumbent |
| `spec_status` | text |  | list: spec_status | Specification status |
| `design_stage` | text |  | list: design_stage | Design stage |
| `tender_publication_date` | date |  | (tender_closing_date IS NULL) OR (tender_publication_date IS NULL) OR (tender_closing_date >= tender_publication_date) | Tender publication date |
| `tender_closing_date` | date |  | (tender_closing_date IS NULL) OR (tender_publication_date IS NULL) OR (tender_closing_date >= tender_publication_date) | Tender closing date |
| `quotation_due_date` | date |  |  | Quotation due date |
| `expected_award_date` | date |  |  | Expected award |
| `expected_delivery_date` | date |  |  | Expected delivery |
| `installation_start_date` | date |  | (installation_end_date IS NULL) OR (installation_start_date IS NULL) OR (installation_end_date >= installation_start_date) | Installation window start |
| `installation_end_date` | date |  | (installation_end_date IS NULL) OR (installation_start_date IS NULL) OR (installation_end_date >= installation_start_date) | Installation window end |
| `date_confidence` | text |  | list: date_confidence | Confidence in the dates |
| `info_source` | text |  |  | Source of information |
| `tender_reference` | text |  |  | Tender reference |
| `lead_source` | text |  | list: lead_source | Source of lead |
| `boq_reference` | text |  |  | BOQ reference |
| `owner_id` | uuid |  |  | Project owner user ID |
| `territory_id` | uuid |  |  |  |
| `business_unit_id` | uuid |  |  |  |
| `status` | text | Yes | active, on_hold, won, lost, cancelled, closed; default active | active, on_hold, won, lost, cancelled, closed |
| `last_activity_at` | timestamp with time zone | Auto | default now() | Latest visit, action or stage change |
| `normalized_name` | text | Auto | calculated by the database |  |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |
| `deleted_at` | timestamp with time zone |  |  |  |

## Project stakeholder – `project_stakeholders`

**Edit permission:** Anyone who can edit the project.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto |  | Stakeholder link ID |
| `project_id` | uuid | Yes |  | Project ID |
| `customer_id` | uuid |  | (customer_id IS NOT NULL) OR (contact_id IS NOT NULL) | Organisation (customer) ID |
| `contact_id` | uuid |  | (customer_id IS NOT NULL) OR (contact_id IS NOT NULL) | Contact ID |
| `stakeholder_role` | text | Yes | list: stakeholder_role | architect, mep_consultant, electrical_contractor, main_contractor, procurement_authority, decision_maker, … |
| `influence_stage` | text |  | list: influence_stage | Stage of influence |
| `is_decision_maker` | boolean | Yes | default false | Decision maker on this project |
| `notes` | text |  |  | Notes |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |

## Project team member – `project_members`

**Edit permission:** Manager/Admin or the project owner.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `project_id` | uuid | Yes |  |  |
| `user_id` | uuid | Yes |  |  |
| `member_role` | text | Yes | sales, estimator, designer, execution, other; default estimator |  |
| `added_by` | uuid |  | default auth.uid() |  |
| `added_at` | timestamp with time zone | Yes | default now() |  |

## Opportunity / lighting package / bid – `opportunities`

**Edit permission:** Owner, project editors, Manager/Admin. Stage changes validated by stage rules.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto |  | Opportunity ID |
| `code` | text | Auto | issued by server | Opportunity number, e.g. OPP-000034 |
| `project_id` | uuid | Yes |  | Project ID |
| `name` | text | Yes | not blank | Package name |
| `segment` | text |  | list: project_segment | Lighting segment |
| `systems_products` | text |  |  | Systems / products |
| `quantities` | text |  |  | Quantities |
| `owner_id` | uuid |  |  | Owner user ID |
| `stage_id` | uuid | Yes |  | Pipeline stage ID |
| `probability` | numeric(5,2) |  | (probability >= 0) AND (probability <= 100) | Probability (0–100) |
| `estimated_value` | numeric(18,2) |  | estimated_value >= 0 | Package estimate (in currency) |
| `currency` | character(3) | Yes | default LKR | ISO 4217 currency code |
| `weighted_value` | numeric(18,2) | Auto | calculated by the database | estimated_value × probability ÷ 100 (in currency) |
| `expected_order_date` | date |  |  | Expected order date |
| `quotation_due_date` | date |  |  | Quotation due date for this package |
| `next_milestone` | text |  |  | Next milestone |
| `next_milestone_date` | date |  |  | Next milestone date |
| `blocker` | text |  |  | Blocker |
| `bid_strategy` | text |  |  | Bid strategy |
| `partner_supplier` | text |  |  | Partner / supplier |
| `competitors` | text |  |  | Competitors |
| `incumbent` | text |  |  | Incumbent |
| `spec_status` | text |  | list: spec_status | Specification status |
| `win_loss_reason` | text |  | list: win_loss_reason | Win / loss reason |
| `win_loss_notes` | text |  |  | Win / loss notes |
| `final_award_value` | numeric(18,2) |  |  | Final award value |
| `award_date` | date |  |  | Award date |
| `closed_at` | timestamp with time zone | Auto |  | When won/lost/cancelled |
| `territory_id` | uuid |  |  |  |
| `last_activity_at` | timestamp with time zone | Auto | default now() | Latest activity |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |
| `deleted_at` | timestamp with time zone |  |  |  |
| `inquiry_received_at` | date |  | default now() AT TIME ZONE Asia/Colombo |  |

## Action (follow-up task) – `actions`

**Edit permission:** Owner, creator, Manager/Admin. Anyone who can see the parent may add one.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto |  | Action ID |
| `code` | text | Auto | issued by server | Action number, e.g. ACT-000210 |
| `customer_id` | uuid |  | (customer_id IS NOT NULL) OR (project_id IS NOT NULL) OR (opportunity_id IS NOT NULL) OR (visit_id IS NOT NULL) | Customer ID |
| `project_id` | uuid |  | (customer_id IS NOT NULL) OR (project_id IS NOT NULL) OR (opportunity_id IS NOT NULL) OR (visit_id IS NOT NULL) | Project ID |
| `opportunity_id` | uuid |  | (customer_id IS NOT NULL) OR (project_id IS NOT NULL) OR (opportunity_id IS NOT NULL) OR (visit_id IS NOT NULL) | Opportunity ID |
| `visit_id` | uuid |  | (customer_id IS NOT NULL) OR (project_id IS NOT NULL) OR (opportunity_id IS NOT NULL) OR (visit_id IS NOT NULL) | Visit ID |
| `description` | text | Yes | not blank | Task description |
| `owner_id` | uuid | Yes |  | Owner user ID |
| `priority` | text | Yes | low, normal, high, urgent; default normal | low, normal, high, urgent |
| `due_date` | date |  |  | Due date |
| `status` | text | Yes | open, in_progress, done, cancelled; default open | open, in_progress, done, cancelled |
| `completed_at` | timestamp with time zone | Auto |  | Completion time |
| `result` | text |  |  | Result / outcome |
| `escalated` | boolean | Yes | default false | Escalated to a manager |
| `escalated_to` | uuid |  |  | Escalated to user ID |
| `escalation_note` | text |  |  | Escalation note |
| `territory_id` | uuid |  |  |  |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |

## Quotation revision – `quotations`

**Edit permission:** Salesperson/Estimator on visible packages; preparer or Manager/Admin may edit.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto |  | Quote ID |
| `code` | text | Auto | issued by server | Quote number, e.g. QUO-000019 |
| `opportunity_id` | uuid | Yes |  | Opportunity ID |
| `reference` | text | Yes |  | Quotation reference |
| `revision` | integer | Yes | revision >= 0; default 0 | Revision number |
| `status` | text | Yes | draft, submitted, accepted, rejected, superseded, expired, withdrawn; default draft | draft, submitted, accepted, rejected, superseded, expired, withdrawn |
| `submission_date` | date |  |  | Submission date |
| `amount` | numeric(18,2) |  | amount >= 0 | Quoted amount (in currency) |
| `currency` | character(3) | Yes | default LKR | ISO 4217 currency code |
| `validity_date` | date |  |  | Valid until |
| `recipient_customer_id` | uuid |  |  | Recipient organisation ID |
| `recipient_contact_id` | uuid |  |  | Recipient contact ID |
| `prepared_by` | uuid |  |  | Prepared by user ID |
| `outcome_note` | text |  |  | Outcome |
| `document_url` | text |  |  | Link to the quotation document |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |

## Quotation cost & margin (restricted) – `quotation_financials`

**Edit permission:** Only roles in the margin_visible_roles setting (default Manager, Admin).

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `quotation_id` | uuid | Yes |  |  |
| `cost_amount` | numeric(18,2) |  |  |  |
| `gross_margin_pct` | numeric(6,2) |  |  |  |
| `margin_note` | text |  |  |  |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |

## Design / submittal milestone – `project_milestones`

**Edit permission:** Project members (estimators, designers), project editors, Manager/Admin.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto |  |  |
| `project_id` | uuid | Yes |  |  |
| `opportunity_id` | uuid |  |  |  |
| `kind` | text | Yes | list: milestone_kind |  |
| `title` | text | Yes |  |  |
| `planned_date` | date |  |  |  |
| `actual_date` | date |  |  |  |
| `status` | text | Yes | pending, in_progress, submitted, approved, resubmit, rejected, done, cancelled; default pending |  |
| `revision` | integer | Yes | default 0 |  |
| `owner_id` | uuid |  |  |  |
| `notes` | text |  |  |  |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |

## Technical note – `technical_notes`

**Edit permission:** Project members and editors add; author edits own.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto |  |  |
| `project_id` | uuid | Yes |  |  |
| `opportunity_id` | uuid |  |  |  |
| `body` | text | Yes | not blank |  |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |

## Attachment metadata (file in secure storage) – `attachments`

**Edit permission:** Uploader and Manager/Admin; readable by anyone who can read the parent record.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto |  |  |
| `entity_type` | text | Yes | customer, contact, project, opportunity, visit, action, quotation, milestone, work_request |  |
| `entity_id` | uuid | Yes |  |  |
| `storage_path` | text | Yes |  |  |
| `filename` | text | Yes |  |  |
| `mime_type` | text |  |  |  |
| `size_bytes` | bigint |  | size_bytes >= 0 |  |
| `file_version` | integer | Yes | default 1 |  |
| `caption` | text |  |  |  |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |
| `deleted_at` | timestamp with time zone |  |  |  |

## Correction request for a submitted visit – `correction_requests`

**Edit permission:** Salesperson requests for own visits; Manager/Admin approve/reject.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto |  |  |
| `visit_id` | uuid | Yes |  |  |
| `requested_by` | uuid | Yes | default auth.uid() |  |
| `requested_at` | timestamp with time zone | Yes | default now() |  |
| `reason` | text | Yes | not blank |  |
| `changes` | jsonb | Yes | jsonb_typeof(changes) = object |  |
| `status` | text | Yes | pending, approved, rejected, withdrawn; default pending |  |
| `reviewed_by` | uuid |  |  |  |
| `reviewed_at` | timestamp with time zone |  |  |  |
| `review_note` | text |  |  |  |

## Design / estimation request (incl. revisions) – `work_requests`

**Edit permission:** Salesperson: create for packages they can see, edit or cancel while new, request revisions. Design team (designer): progress design requests; Estimation team (estimator): progress estimation requests. Manager/Admin: all. Visible to the project team and the requester.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | uuid | Auto |  | Request ID |
| `code` | text | Auto | issued by server | Request number, e.g. WR-000012 |
| `kind` | text | Yes | design, estimation | design or estimation |
| `opportunity_id` | uuid | Yes |  | Opportunity (package) ID |
| `project_id` | uuid |  |  | Project ID |
| `task_type` | text |  | list: design_task_type | Type of work |
| `title` | text | Yes | not blank | Title |
| `description` | text |  |  | Brief |
| `priority` | text | Yes | low, normal, high, urgent; default normal | low, normal, high, urgent |
| `status` | text | Yes | new, in_progress, on_hold, submitted, cancelled; default new | new, in_progress, on_hold, submitted, cancelled |
| `received_at` | timestamp with time zone | Yes | default now() | Request received |
| `due_date` | date |  |  | Required by |
| `started_at` | timestamp with time zone |  |  | Work started |
| `completed_at` | timestamp with time zone | Auto |  | Submitted to sales |
| `completed_late` | boolean |  |  | Submitted after the due date |
| `requested_by` | uuid |  | default auth.uid() | Requested by user ID |
| `assigned_to` | uuid |  |  | Assigned to user ID |
| `revision` | integer | Yes | revision >= 0; default 0 | 0 = original request, 1+ = revision |
| `parent_request_id` | uuid |  |  | Request this revision is based on |
| `quotation_id` | uuid |  |  | Quotation the revision is based on |
| `revision_reason` | text |  | list: revision_reason | Reason for revision |
| `client_feedback` | text |  |  | Client feedback |
| `deliverable_note` | text |  |  | What was delivered |
| `deliverable_link` | text |  |  | Link to the deliverable |
| `last_late_alert_on` | date |  |  |  |
| `version` | integer | Auto | default 1 |  |
| `created_by` | uuid | Auto |  |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |
| `updated_by` | uuid | Auto |  |  |
| `updated_at` | timestamp with time zone | Auto | default now() |  |

## Design / estimation timeline event – `work_request_events`

**Edit permission:** Written automatically on every status, assignee and due-date change; anyone who can see the request may add notes.

| Field | Type | Mandatory | Allowed values / validation | Description |
|---|---|---|---|---|
| `id` | bigint | Auto |  |  |
| `request_id` | uuid | Yes |  |  |
| `event` | text | Yes | created, assigned, started, on_hold, resumed, submitted, cancelled, reopened, due_changed, revision_requested, note |  |
| `note` | text |  | event = ANY (ARRAY[created, assigned, started, on_hold, resumed, submitted, cancelled, reopened, due_changed, revision_requested, note]) |  |
| `from_value` | text |  |  |  |
| `to_value` | text |  |  |  |
| `created_by` | uuid | Auto | default auth.uid() |  |
| `created_at` | timestamp with time zone | Auto | default now() |  |

## Visit submission rule

A visit can be saved as an incomplete draft on the device at any time. To submit, it needs: salesperson, customer, at least one contact or a "contact unavailable" reason, visit date, visit type, purpose, meeting summary, outcome, and at least one next action or a "no follow up" reason. When the `gps_required` setting is on, a check-in location or a "location unavailable" reason is also required (remote meetings are exempt). The app checks these before queuing; the database enforces them again (`visit_missing_fields`).

## Pipeline stage rules

Each stage (Admin › Pipeline stages) has a default probability, an outcome type (open, won, lost, on hold, cancelled), fields that must be filled before **leaving** it and fields required on **entering** it. The server validates these on every stage change; `weighted_value = estimated_value × probability ÷ 100`.
