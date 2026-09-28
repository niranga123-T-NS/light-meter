-- DIMO Sales Visit & Project Tracking — business records
-- Customers, contacts, projects, stakeholders, opportunities, visits,
-- actions, quotations, milestones, technical notes, attachments,
-- correction requests and exports.

create sequence public.customer_code_seq;
create sequence public.contact_code_seq;
create sequence public.project_code_seq;
create sequence public.opportunity_code_seq;
create sequence public.visit_code_seq;
create sequence public.action_code_seq;
create sequence public.quotation_code_seq;

create or replace function public.next_code(prefix text, seq regclass) returns text
language sql volatile as $$
  select prefix || '-' || lpad(nextval(seq)::text, 6, '0')
$$;

-- ---------------------------------------------------------------------------
-- Customers (accounts)
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.next_code('CUS', 'public.customer_code_seq'),
  legal_name text not null check (length(trim(legal_name)) > 0),
  trading_name text,
  category text,                 -- lookup: customer_category
  industry text,                 -- lookup: industry
  address text,
  district text,                 -- lookup: district
  city text,
  country text not null default 'Sri Lanka',
  website text,
  phone text,
  email text,
  owner_id uuid references public.profiles (id),
  territory_id uuid references public.territories (id),
  business_unit_id uuid references public.business_units (id),
  strategic_priority text,       -- lookup: strategic_priority
  status text not null default 'active' check (status in ('provisional', 'prospect', 'active', 'inactive')),
  source text,                   -- lookup: lead_source
  notes text,
  parent_customer_id uuid references public.customers (id),
  normalized_name text generated always as (public.normalize_name(legal_name)) stored,
  last_visit_at timestamptz,
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (parent_customer_id is distinct from id)
);
-- Duplicate prevention: same normalised name in the same city is one customer.
create unique index customers_dedupe_key on public.customers (normalized_name, lower(coalesce(city, ''))) where deleted_at is null;
create index customers_trgm on public.customers using gin ((coalesce(legal_name, '') || ' ' || coalesce(trading_name, '')) extensions.gin_trgm_ops);
create index customers_owner_idx on public.customers (owner_id);
create index customers_territory_idx on public.customers (territory_id);

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.next_code('CON', 'public.contact_code_seq'),
  customer_id uuid not null references public.customers (id),
  full_name text not null check (length(trim(full_name)) > 0),
  designation text,
  department text,
  work_phone text,
  mobile_phone text,
  email text,
  decision_role text,            -- lookup: decision_role
  preferred_contact_method text check (preferred_contact_method in ('phone', 'mobile', 'email', 'whatsapp', 'in_person', 'other')),
  owner_id uuid references public.profiles (id),
  active boolean not null default true,
  consent_status text not null default 'unknown' check (consent_status in ('unknown', 'granted', 'withdrawn')),
  communication_preference text,
  notes text,
  normalized_name text generated always as (public.normalize_name(full_name)) stored,
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index contacts_email_key on public.contacts (customer_id, lower(email)) where email is not null and deleted_at is null;
create index contacts_customer_idx on public.contacts (customer_id);
create index contacts_trgm on public.contacts using gin (full_name extensions.gin_trgm_ops);

create or replace function public.project_search_text(p_name text, p_aliases text[]) returns text
language sql immutable parallel safe as $$
  select p_name || ' ' || coalesce(array_to_string(p_aliases, ' '), '')
$$;

-- ---------------------------------------------------------------------------
-- Projects: one master per physical project or tender
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.next_code('PRJ', 'public.project_code_seq'),
  name text not null check (length(trim(name)) > 0),
  aliases text[] not null default '{}',
  site_location text,
  district text,
  city text,
  latitude double precision,
  longitude double precision,
  customer_id uuid references public.customers (id),       -- customer / project owner
  developer_id uuid references public.customers (id),
  end_user_id uuid references public.customers (id),
  project_type text,             -- lookup: project_type
  description text,
  -- Scope
  segments text[] not null default '{}',  -- lookup: project_segment
  systems_products text,
  quantities text,
  technical_standards text,
  lux_targets text,
  controls_requirements text,
  drawing_links text[] not null default '{}',
  -- Commercial
  total_estimate numeric(18, 2),
  addressable_value numeric(18, 2),
  currency char(3) not null default 'LKR',
  budget_status text,            -- lookup: budget_status
  funding_source text,
  bid_strategy text,
  partner_supplier text,
  competitors text,
  incumbent text,
  spec_status text,              -- lookup: spec_status
  -- Timeline
  design_stage text,             -- lookup: design_stage
  tender_publication_date date,
  tender_closing_date date,
  quotation_due_date date,
  expected_award_date date,
  expected_delivery_date date,
  installation_start_date date,
  installation_end_date date,
  date_confidence text,          -- lookup: date_confidence
  info_source text,
  -- Evidence
  tender_reference text,
  lead_source text,              -- lookup: lead_source
  boq_reference text,
  -- Ownership / status
  owner_id uuid references public.profiles (id),
  territory_id uuid references public.territories (id),
  business_unit_id uuid references public.business_units (id),
  status text not null default 'active' check (status in ('active', 'on_hold', 'won', 'lost', 'cancelled', 'closed')),
  last_activity_at timestamptz not null default now(),
  normalized_name text generated always as (public.normalize_name(name)) stored,
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (installation_end_date is null or installation_start_date is null or installation_end_date >= installation_start_date),
  check (tender_closing_date is null or tender_publication_date is null or tender_closing_date >= tender_publication_date)
);
-- Project deduplication rule: same normalised name in the same district is one project.
create unique index projects_dedupe_key on public.projects (normalized_name, lower(coalesce(district, ''))) where deleted_at is null;
create index projects_trgm on public.projects using gin (public.project_search_text(name, aliases) extensions.gin_trgm_ops);
create index projects_owner_idx on public.projects (owner_id);
create index projects_territory_idx on public.projects (territory_id);

-- Users assigned to a project (estimators, designers, shared sales users)
create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  member_role text not null default 'estimator' check (member_role in ('sales', 'estimator', 'designer', 'execution', 'other')),
  added_by uuid default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.project_stakeholders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  customer_id uuid references public.customers (id),
  contact_id uuid references public.contacts (id),
  stakeholder_role text not null,   -- lookup: stakeholder_role (architect, mep_consultant, ...)
  influence_stage text,             -- lookup: influence_stage
  is_decision_maker boolean not null default false,
  notes text,
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  check (customer_id is not null or contact_id is not null),
  unique nulls not distinct (project_id, customer_id, contact_id, stakeholder_role)
);
create index project_stakeholders_project_idx on public.project_stakeholders (project_id);

-- ---------------------------------------------------------------------------
-- Opportunities: one lighting package / bid within a project
-- ---------------------------------------------------------------------------
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.next_code('OPP', 'public.opportunity_code_seq'),
  project_id uuid not null references public.projects (id),
  name text not null check (length(trim(name)) > 0),
  segment text,                  -- lookup: project_segment
  systems_products text,
  quantities text,
  owner_id uuid references public.profiles (id),
  stage_id uuid not null references public.pipeline_stages (id),
  probability numeric(5, 2) check (probability between 0 and 100),
  estimated_value numeric(18, 2) check (estimated_value >= 0),
  currency char(3) not null default 'LKR',
  weighted_value numeric(18, 2) generated always as (round(estimated_value * coalesce(probability, 0) / 100, 2)) stored,
  expected_order_date date,
  quotation_due_date date,
  next_milestone text,
  next_milestone_date date,
  blocker text,
  bid_strategy text,
  partner_supplier text,
  competitors text,
  incumbent text,
  spec_status text,              -- lookup: spec_status
  win_loss_reason text,          -- lookup: win_loss_reason
  win_loss_notes text,
  final_award_value numeric(18, 2),
  award_date date,
  closed_at timestamptz,
  territory_id uuid references public.territories (id),
  last_activity_at timestamptz not null default now(),
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index opportunities_project_idx on public.opportunities (project_id);
create index opportunities_stage_idx on public.opportunities (stage_id);
create index opportunities_owner_idx on public.opportunities (owner_id);

create table public.opportunity_stage_history (
  id bigint generated always as identity primary key,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  from_stage_id uuid references public.pipeline_stages (id),
  to_stage_id uuid not null references public.pipeline_stages (id),
  probability numeric(5, 2),
  estimated_value numeric(18, 2),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create index opportunity_stage_history_opp_idx on public.opportunity_stage_history (opportunity_id, changed_at);

-- ---------------------------------------------------------------------------
-- Visits
-- ---------------------------------------------------------------------------
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.next_code('VIS', 'public.visit_code_seq'),
  salesperson_id uuid not null references public.profiles (id),
  customer_id uuid references public.customers (id),
  contact_unavailable_reason text,   -- lookup: contact_unavailable_reason
  visit_type text,                   -- lookup: visit_type
  status text not null default 'draft' check (status in ('planned', 'draft', 'submitted', 'cancelled')),
  scheduled_at timestamptz,
  visit_date date,                   -- Asia/Colombo calendar date of the visit
  check_in_at timestamptz,
  check_out_at timestamptz,
  duration_minutes int generated always as (
    case when check_in_at is not null and check_out_at is not null
      then (extract(epoch from (check_out_at - check_in_at)) / 60)::int end) stored,
  device_created_at timestamptz,     -- original device time of capture
  submitted_at timestamptz,
  -- Location
  meeting_place text,
  is_remote boolean not null default false,
  check_in_lat double precision,
  check_in_lng double precision,
  check_in_accuracy_m double precision,
  check_out_lat double precision,
  check_out_lng double precision,
  check_out_accuracy_m double precision,
  location_consent boolean,
  location_unavailable_reason text,  -- lookup: location_unavailable_reason
  -- Discussion
  purpose text,
  products_discussed text,
  requirements text,
  pain_points text,
  decision_process text,
  budget_indication text,
  funding_status text,               -- lookup: budget_status
  purchase_timeline text,
  -- Commercial signal
  estimated_value numeric(18, 2) check (estimated_value >= 0),
  currency char(3) not null default 'LKR',
  confidence text check (confidence in ('low', 'medium', 'high')),
  competitor text,
  incumbent text,
  spec_position text,                -- lookup: spec_status
  differentiator text,
  risks text,
  -- Outcome
  summary text,
  commitments text,
  documents_shared text,
  documents_requested text,
  outcome text,                      -- lookup: visit_outcome
  next_meeting_at timestamptz,
  no_followup_reason text,           -- lookup: no_followup_reason
  territory_id uuid references public.territories (id),
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  check (check_out_at is null or check_in_at is null or check_out_at >= check_in_at),
  check (check_in_accuracy_m is null or check_in_accuracy_m >= 0)
);
create index visits_salesperson_idx on public.visits (salesperson_id, visit_date desc);
create index visits_customer_idx on public.visits (customer_id, visit_date desc);
create index visits_status_idx on public.visits (status, scheduled_at);

create table public.visit_contacts (
  visit_id uuid not null references public.visits (id) on delete cascade,
  contact_id uuid not null references public.contacts (id),
  primary key (visit_id, contact_id)
);
create table public.visit_projects (
  visit_id uuid not null references public.visits (id) on delete cascade,
  project_id uuid not null references public.projects (id),
  primary key (visit_id, project_id)
);
create table public.visit_opportunities (
  visit_id uuid not null references public.visits (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id),
  primary key (visit_id, opportunity_id)
);
create index visit_contacts_contact_idx on public.visit_contacts (contact_id);
create index visit_projects_project_idx on public.visit_projects (project_id);

-- ---------------------------------------------------------------------------
-- Actions (follow-up tasks)
-- ---------------------------------------------------------------------------
create table public.actions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.next_code('ACT', 'public.action_code_seq'),
  customer_id uuid references public.customers (id),
  project_id uuid references public.projects (id),
  opportunity_id uuid references public.opportunities (id),
  visit_id uuid references public.visits (id),
  description text not null check (length(trim(description)) > 0),
  owner_id uuid not null references public.profiles (id),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date date,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  completed_at timestamptz,
  result text,
  escalated boolean not null default false,
  escalated_to uuid references public.profiles (id),
  escalation_note text,
  territory_id uuid references public.territories (id),
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  check (customer_id is not null or project_id is not null or opportunity_id is not null or visit_id is not null)
);
create index actions_owner_idx on public.actions (owner_id, status, due_date);
create index actions_visit_idx on public.actions (visit_id);
create index actions_project_idx on public.actions (project_id);
create index actions_customer_idx on public.actions (customer_id);

-- ---------------------------------------------------------------------------
-- Quotations (Release 2 workflow; confidential cost/margin kept separately)
-- ---------------------------------------------------------------------------
create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.next_code('QUO', 'public.quotation_code_seq'),
  opportunity_id uuid not null references public.opportunities (id),
  reference text not null,
  revision int not null default 0 check (revision >= 0),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'accepted', 'rejected', 'superseded', 'expired', 'withdrawn')),
  submission_date date,
  amount numeric(18, 2) check (amount >= 0),
  currency char(3) not null default 'LKR',
  validity_date date,
  recipient_customer_id uuid references public.customers (id),
  recipient_contact_id uuid references public.contacts (id),
  prepared_by uuid references public.profiles (id),
  outcome_note text,
  document_url text,
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  unique (reference, revision)
);
create index quotations_opportunity_idx on public.quotations (opportunity_id);

create table public.quotation_financials (
  quotation_id uuid primary key references public.quotations (id) on delete cascade,
  cost_amount numeric(18, 2),
  gross_margin_pct numeric(6, 2),
  margin_note text,
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Design / submittal milestones and technical notes (Release 2)
-- ---------------------------------------------------------------------------
create table public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  opportunity_id uuid references public.opportunities (id),
  kind text not null,             -- lookup: milestone_kind (design, submittal, sample, approval, ...)
  title text not null,
  planned_date date,
  actual_date date,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'submitted', 'approved', 'resubmit', 'rejected', 'done', 'cancelled')),
  revision int not null default 0,
  owner_id uuid references public.profiles (id),
  notes text,
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create index project_milestones_project_idx on public.project_milestones (project_id, planned_date);

create table public.technical_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  opportunity_id uuid references public.opportunities (id),
  body text not null check (length(trim(body)) > 0),
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create index technical_notes_project_idx on public.technical_notes (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Attachments: files live in the private "attachments" storage bucket;
-- this table records metadata and the link to the owning record.
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('customer', 'contact', 'project', 'opportunity', 'visit', 'action', 'quotation', 'milestone')),
  entity_id uuid not null,
  storage_path text not null unique,
  filename text not null,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  file_version int not null default 1,
  caption text,
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index attachments_entity_idx on public.attachments (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Corrections to submitted visits (salesperson requests, manager approves)
-- ---------------------------------------------------------------------------
create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id),
  requested_by uuid not null default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  reason text not null check (length(trim(reason)) > 0),
  changes jsonb not null check (jsonb_typeof(changes) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text
);
create index correction_requests_status_idx on public.correction_requests (status, requested_at);

-- ---------------------------------------------------------------------------
-- Exports
-- ---------------------------------------------------------------------------
create table public.export_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  channel text not null default 'download' check (channel in ('download', 'scheduled')),
  filters jsonb not null default '{}'::jsonb,
  row_counts jsonb,
  storage_path text,
  schedule_id uuid
);

create table public.export_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  recipients text[] not null default '{}',
  active boolean not null default true,
  last_run_at timestamptz,
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Stamp + audit triggers on every business table
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'customers', 'contacts', 'projects', 'project_stakeholders', 'opportunities', 'visits', 'actions',
    'quotations', 'quotation_financials', 'project_milestones', 'technical_notes', 'attachments', 'export_schedules'
  ] loop
    execute format('create trigger %1$s_stamp before insert or update on public.%1$I for each row execute function public.tg_stamp()', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I for each row execute function public.tg_audit()', t);
  end loop;
  foreach t in array array['project_members', 'visit_contacts', 'visit_projects', 'visit_opportunities', 'correction_requests'] loop
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I for each row execute function public.tg_audit()', t);
  end loop;
end $$;
