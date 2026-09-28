-- DIMO Sales: complete database setup in ONE file (all migrations in order).
-- Paste into Supabase > SQL Editor and click Run. Generated from supabase/migrations — do not edit by hand.

-- ===== supabase/migrations/20260928000100_foundation.sql =====
-- DIMO Sales Visit & Project Tracking — foundation
-- Users, roles, territories, configurable lists, settings, currency rates,
-- and the shared triggers for record stamping and the audit trail.
--
-- Conventions
--   * Every business table has a UUID primary key (generated on the device
--     for offline records, so retries never create duplicates) plus a
--     human-readable code such as CUS-000123.
--   * All timestamps are timestamptz (stored in UTC, displayed in Asia/Colombo).
--   * Money is always stored with its ISO 4217 currency code.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('salesperson', 'manager', 'estimator', 'admin');

-- ---------------------------------------------------------------------------
-- Organisation structure
-- ---------------------------------------------------------------------------
create table public.business_units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.territories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  business_unit_id uuid references public.business_units (id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  phone text,
  role public.app_role not null default 'salesperson',
  business_unit_id uuid references public.business_units (id),
  active boolean not null default false,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_territories (
  user_id uuid not null references public.profiles (id) on delete cascade,
  territory_id uuid not null references public.territories (id) on delete cascade,
  primary key (user_id, territory_id)
);

-- ---------------------------------------------------------------------------
-- Configurable lists (administrators maintain these without a code change)
-- list_key examples: visit_type, customer_category, industry, project_type,
-- project_segment, visit_outcome, win_loss_reason, no_followup_reason,
-- location_unavailable_reason, contact_unavailable_reason, decision_role,
-- stakeholder_role, influence_stage, design_stage, budget_status,
-- spec_status, lead_source, currency, district, product_system,
-- competitor, milestone_kind, strategic_priority, date_confidence.
-- ---------------------------------------------------------------------------
create table public.lookup_values (
  id uuid primary key default gen_random_uuid(),
  list_key text not null,
  code text not null,
  label text not null,
  sort_order int not null default 100,
  active boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (list_key, code)
);
create index lookup_values_list_idx on public.lookup_values (list_key, sort_order);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order int not null,
  default_probability numeric(5, 2) not null default 0 check (default_probability between 0 and 100),
  -- open | won | lost | on_hold | cancelled
  outcome text not null default 'open' check (outcome in ('open', 'won', 'lost', 'on_hold', 'cancelled')),
  -- opportunity columns that must be filled before leaving this stage
  exit_required_fields text[] not null default '{}',
  -- opportunity columns that must be filled on entering this stage
  entry_required_fields text[] not null default '{}',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

-- Exchange rates to the base currency (app_settings.base_currency).
-- Totals never add unlike currencies: amounts are converted with the latest
-- rate on or before the relevant date, or reported as "unconverted".
create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  currency char(3) not null,
  rate_to_base numeric(18, 8) not null check (rate_to_base > 0),
  effective_date date not null,
  source text,
  created_at timestamptz not null default now(),
  unique (currency, effective_date)
);

-- ---------------------------------------------------------------------------
-- Audit trail: one row per material change, retained per app_settings.audit_retention_days
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid,
  record_code text,
  action text not null check (action in ('insert', 'update', 'delete', 'export', 'approve', 'reject', 'login')),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now(),
  changed_fields text[],
  old_data jsonb,
  new_data jsonb,
  note text
);
create index audit_log_record_idx on public.audit_log (record_id, changed_at desc);
create index audit_log_time_idx on public.audit_log (changed_at desc);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so policies can call them without
-- recursive RLS evaluation). They only ever read the caller's own profile.
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('manager', 'admin') from public.profiles where id = auth.uid() and active), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid() and active), false)
$$;

create or replace function public.has_role(roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = any (roles) from public.profiles where id = auth.uid() and active), false)
$$;

create or replace function public.my_territories() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(pt.territory_id), '{}')
  from public.profile_territories pt
  join public.profiles p on p.id = pt.user_id and p.active
  where pt.user_id = auth.uid()
$$;

-- Salespeople see their own territories and records with no territory yet.
create or replace function public.in_my_territory(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select t is null or t = any (public.my_territories())
$$;

create or replace function public.setting(k text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = k
$$;

create or replace function public.base_currency() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(public.setting('base_currency') #>> '{}', 'LKR')
$$;

-- Convert an amount to the base currency. Returns NULL when no rate exists,
-- so callers can report unconverted amounts instead of adding unlike currencies.
create or replace function public.to_base(amount numeric, currency text, on_date date default current_date)
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when amount is null then null
    when currency is null or upper(currency) = public.base_currency() then amount
    else amount * (
      select rate_to_base from public.exchange_rates r
      where r.currency = upper(to_base.currency) and r.effective_date <= coalesce(on_date, current_date)
      order by r.effective_date desc limit 1
    )
  end
$$;

-- Normalised name used for duplicate matching: lower case, punctuation
-- removed, and common company suffixes dropped ("ABC (Pvt) Ltd" = "abc").
create or replace function public.normalize_name(t text) returns text
language sql immutable parallel safe as $$
  select nullif(trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g'),
      '(^| )(pvt|private|ltd|limited|plc|inc|llc|co|company|the|holdings|pte)(?= |$)', ' ', 'g'),
    ' +', ' ', 'g')), '')
$$;

-- ---------------------------------------------------------------------------
-- Stamping: created/updated by + at, optimistic-concurrency version
-- ---------------------------------------------------------------------------
create or replace function public.tg_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
    new.version := 1;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- Generic audit trigger. Records who changed which fields and the before/after values.
create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  fields text[];
  ignored text[] := array['updated_at', 'updated_by', 'version', 'last_activity_at', 'last_visit_at', 'search_text'];
begin
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into fields
    from jsonb_object_keys(n) k
    where not (k = any (ignored)) and (o -> k) is distinct from (n -> k);
    if fields is null then return new; end if;
  end if;
  insert into public.audit_log (table_name, record_id, record_code, action, changed_by, changed_fields, old_data, new_data)
  values (
    tg_table_name,
    -- link tables have no id of their own: record the parent they hang off
    coalesce(n ->> 'id', o ->> 'id', n ->> 'visit_id', o ->> 'visit_id', n ->> 'project_id', o ->> 'project_id',
             n ->> 'quotation_id', o ->> 'quotation_id', n ->> 'user_id', o ->> 'user_id')::uuid,
    coalesce(n ->> 'code', o ->> 'code'),
    lower(tg_op),
    auth.uid(),
    fields,
    case when tg_op = 'INSERT' then null else o end,
    case when tg_op = 'DELETE' then null else n end
  );
  return coalesce(new, old);
end $$;

create or replace function public.tg_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.tg_touch_updated_at();
create trigger lookup_values_touch before update on public.lookup_values for each row execute function public.tg_touch_updated_at();
create trigger pipeline_stages_touch before update on public.pipeline_stages for each row execute function public.tg_touch_updated_at();
create trigger app_settings_touch before update on public.app_settings for each row execute function public.tg_touch_updated_at();

create trigger profiles_audit after insert or update or delete on public.profiles for each row execute function public.tg_audit();
create trigger profile_territories_audit after insert or delete on public.profile_territories for each row execute function public.tg_audit();
create trigger lookup_values_audit after insert or update or delete on public.lookup_values for each row execute function public.tg_audit();
create trigger pipeline_stages_audit after insert or update or delete on public.pipeline_stages for each row execute function public.tg_audit();
create trigger app_settings_audit after insert or update or delete on public.app_settings for each row execute function public.tg_audit();
create trigger exchange_rates_audit after insert or update or delete on public.exchange_rates for each row execute function public.tg_audit();

-- Only administrators may change role, active status or business unit;
-- users may edit their own name and phone.
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role
      or new.active is distinct from old.active
      or new.business_unit_id is distinct from old.business_unit_id
      or new.email is distinct from old.email then
      raise exception 'Only an administrator can change role, status, business unit or email'
        using errcode = '42501';
    end if;
  end if;
  if new.active = false and old.active = true then
    new.deactivated_at := now();
  elsif new.active = true then
    new.deactivated_at := null;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.tg_profiles_guard();

-- New sign-ins get a profile. Access stays disabled until an administrator
-- invites/activates the user (app_metadata is only writable server side).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce((new.raw_app_meta_data ->> 'role')::public.app_role, 'salesperson'),
    coalesce((new.raw_app_meta_data ->> 'active')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ===== supabase/migrations/20260928000200_crm.sql =====
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

-- ===== supabase/migrations/20260928000300_rules.sql =====
-- DIMO Sales Visit & Project Tracking — business rules enforced in the database
-- (territory derivation, visit submission validation, stage rules, activity history)

-- ---------------------------------------------------------------------------
-- Territory and ownership defaults
-- ---------------------------------------------------------------------------
create or replace function public.tg_customer_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
    if new.territory_id is null then
      select territory_id into new.territory_id from public.profile_territories
      where user_id = new.owner_id order by territory_id limit 1;
    end if;
    if new.business_unit_id is null then
      select business_unit_id into new.business_unit_id from public.territories where id = new.territory_id;
    end if;
  end if;
  return new;
end $$;
create trigger customers_defaults before insert on public.customers for each row execute function public.tg_customer_defaults();

create or replace function public.tg_contact_defaults() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
  end if;
  return new;
end $$;
create trigger contacts_defaults before insert on public.contacts for each row execute function public.tg_contact_defaults();

create or replace function public.tg_project_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
    if new.territory_id is null and new.customer_id is not null then
      select territory_id into new.territory_id from public.customers where id = new.customer_id;
    end if;
    if new.territory_id is null then
      select territory_id into new.territory_id from public.profile_territories
      where user_id = new.owner_id order by territory_id limit 1;
    end if;
    if new.business_unit_id is null then
      select business_unit_id into new.business_unit_id from public.territories where id = new.territory_id;
    end if;
  end if;
  return new;
end $$;
create trigger projects_defaults before insert on public.projects for each row execute function public.tg_project_defaults();

create or replace function public.tg_visit_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is not null and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id) then
    select territory_id into new.territory_id from public.customers where id = new.customer_id;
  end if;
  if new.visit_date is null then
    new.visit_date := (coalesce(new.check_in_at, new.scheduled_at, new.device_created_at, now()) at time zone 'Asia/Colombo')::date;
  end if;
  return new;
end $$;
create trigger visits_defaults before insert or update on public.visits for each row execute function public.tg_visit_defaults();

create or replace function public.tg_action_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
    if new.customer_id is null and new.visit_id is not null then
      select customer_id into new.customer_id from public.visits where id = new.visit_id;
    end if;
  end if;
  if new.territory_id is null or tg_op = 'UPDATE' then
    new.territory_id := coalesce(
      (select territory_id from public.projects where id = new.project_id),
      (select territory_id from public.customers where id = new.customer_id),
      (select territory_id from public.visits where id = new.visit_id),
      new.territory_id);
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger actions_defaults before insert or update on public.actions for each row execute function public.tg_action_defaults();

-- ---------------------------------------------------------------------------
-- Visit submission rules (server side; the app checks the same list first)
-- Minimum at submission: salesperson, customer, contact or reason,
-- visit date and type, purpose, summary, outcome, and at least one next
-- action or a "no follow up" reason.
-- ---------------------------------------------------------------------------
create or replace function public.visit_missing_fields(v public.visits) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare missing text[] := '{}';
begin
  if v.salesperson_id is null then missing := array_append(missing, 'salesperson'); end if;
  if v.customer_id is null then missing := array_append(missing, 'customer'); end if;
  if nullif(trim(coalesce(v.contact_unavailable_reason, '')), '') is null
     and not exists (select 1 from public.visit_contacts where visit_id = v.id) then
    missing := array_append(missing, 'contact_or_reason');
  end if;
  if v.visit_date is null then missing := array_append(missing, 'visit_date'); end if;
  if nullif(trim(coalesce(v.visit_type, '')), '') is null then missing := array_append(missing, 'visit_type'); end if;
  if nullif(trim(coalesce(v.purpose, '')), '') is null then missing := array_append(missing, 'purpose'); end if;
  if nullif(trim(coalesce(v.summary, '')), '') is null then missing := array_append(missing, 'summary'); end if;
  if nullif(trim(coalesce(v.outcome, '')), '') is null then missing := array_append(missing, 'outcome'); end if;
  if nullif(trim(coalesce(v.no_followup_reason, '')), '') is null
     and not exists (select 1 from public.actions where visit_id = v.id and status <> 'cancelled') then
    missing := array_append(missing, 'next_action_or_reason');
  end if;
  if not v.is_remote and v.check_in_lat is null and nullif(trim(coalesce(v.location_unavailable_reason, '')), '') is null
     and coalesce((public.setting('gps_required') #>> '{}')::boolean, false) then
    missing := array_append(missing, 'location_or_reason');
  end if;
  return missing;
end $$;

create or replace function public.tg_visit_submit() returns trigger
language plpgsql as $$
declare missing text[];
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    missing := public.visit_missing_fields(new);
    if array_length(missing, 1) > 0 then
      raise exception 'Visit cannot be submitted. Missing: %', array_to_string(missing, ', ')
        using errcode = '23514', detail = array_to_string(missing, ',');
    end if;
    new.submitted_at := coalesce(new.submitted_at, now());
  end if;
  if tg_op = 'UPDATE' and old.status = 'submitted' and new.status in ('planned', 'draft') then
    raise exception 'A submitted visit cannot return to draft' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger visits_submit before insert or update on public.visits for each row execute function public.tg_visit_submit();

-- Keep account / project histories current when a visit is submitted.
create or replace function public.tg_visit_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare ts timestamptz;
begin
  if new.status = 'submitted' then
    ts := coalesce(new.check_in_at, new.submitted_at, now());
    update public.customers set last_visit_at = greatest(coalesce(last_visit_at, ts), ts) where id = new.customer_id;
    update public.projects p set last_activity_at = greatest(p.last_activity_at, ts)
    from public.visit_projects vp where vp.visit_id = new.id and vp.project_id = p.id;
    update public.opportunities o set last_activity_at = greatest(o.last_activity_at, ts)
    from public.visit_opportunities vo where vo.visit_id = new.id and vo.opportunity_id = o.id;
  end if;
  return null;
end $$;
create trigger visits_activity after insert or update of status on public.visits for each row execute function public.tg_visit_activity();

create or replace function public.tg_action_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is not null then
    update public.projects set last_activity_at = now() where id = new.project_id;
  end if;
  if new.opportunity_id is not null then
    update public.opportunities set last_activity_at = now() where id = new.opportunity_id;
  end if;
  return null;
end $$;
create trigger actions_activity after insert or update of status on public.actions for each row execute function public.tg_action_activity();

-- ---------------------------------------------------------------------------
-- Opportunity stage rules
-- ---------------------------------------------------------------------------
create or replace function public.tg_opportunity_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_stage public.pipeline_stages;
  new_stage public.pipeline_stages;
  f text;
  row_json jsonb := to_jsonb(new);
  missing text[] := '{}';
begin
  select * into new_stage from public.pipeline_stages where id = new.stage_id;
  if new.territory_id is null or tg_op = 'UPDATE' then
    select territory_id into new.territory_id from public.projects where id = new.project_id;
  end if;
  new.owner_id := coalesce(new.owner_id, auth.uid());

  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    if tg_op = 'UPDATE' then
      select * into old_stage from public.pipeline_stages where id = old.stage_id;
      foreach f in array old_stage.exit_required_fields loop
        if nullif(trim(coalesce(row_json ->> f, '')), '') is null then missing := missing || f; end if;
      end loop;
    end if;
    foreach f in array new_stage.entry_required_fields loop
      if nullif(trim(coalesce(row_json ->> f, '')), '') is null then missing := missing || f; end if;
    end loop;
    if array_length(missing, 1) > 0 then
      raise exception 'Stage change to "%" needs: %', new_stage.name, array_to_string(missing, ', ')
        using errcode = '23514', detail = array_to_string(missing, ',');
    end if;
    -- default probability follows the stage unless the user set it explicitly
    if new.probability is null or (tg_op = 'UPDATE' and new.probability is not distinct from old.probability) then
      new.probability := new_stage.default_probability;
    end if;
    if new_stage.outcome in ('won', 'lost', 'cancelled') then
      new.closed_at := coalesce(new.closed_at, now());
    else
      new.closed_at := null;
    end if;
    if new_stage.outcome = 'won' and new.final_award_value is null then
      new.final_award_value := new.estimated_value;
    end if;
  end if;
  return new;
end $$;
create trigger opportunities_stage before insert or update on public.opportunities for each row execute function public.tg_opportunity_stage();

create or replace function public.tg_opportunity_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    insert into public.opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, probability, estimated_value)
    values (new.id, case when tg_op = 'UPDATE' then old.stage_id end, new.stage_id, new.probability, new.estimated_value);
    update public.projects set last_activity_at = now() where id = new.project_id;
  end if;
  return null;
end $$;
create trigger opportunities_history after insert or update on public.opportunities for each row execute function public.tg_opportunity_history();

create or replace function public.tg_quotation_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.prepared_by := coalesce(new.prepared_by, auth.uid());
  update public.opportunities set last_activity_at = now() where id = new.opportunity_id;
  -- a newer revision supersedes the previous submitted one
  if tg_op = 'INSERT' then
    update public.quotations set status = 'superseded'
    where reference = new.reference and revision < new.revision and status in ('draft', 'submitted');
  end if;
  return new;
end $$;
create trigger quotations_activity before insert or update on public.quotations for each row execute function public.tg_quotation_activity();

-- ===== supabase/migrations/20260928000400_security.sql =====
-- DIMO Sales Visit & Project Tracking — server-enforced permissions (Row Level Security)
--
-- Salesperson : own + own-territory accounts, contacts, visits, projects; shared projects via project_members
-- Manager     : read everything, assign owners, approve corrections, export
-- Estimator   : assigned projects only; adds technical notes, quotations, milestones; cannot edit visits
-- Admin       : everything a manager can, plus users, lists, settings, audit
-- Deactivated users have no role, so every policy denies them.

-- ---------------------------------------------------------------------------
-- Visibility helpers (SECURITY DEFINER to avoid recursive policy evaluation)
-- ---------------------------------------------------------------------------
create or replace function public.is_project_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members where project_id = p and user_id = auth.uid())
$$;

create or replace function public.can_read_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
    or public.is_project_member(p)
    or (public.has_role('{salesperson}') and exists (
      select 1 from public.projects pr where pr.id = p and (
        pr.owner_id = auth.uid() or public.in_my_territory(pr.territory_id)
        or exists (select 1 from public.opportunities o where o.project_id = pr.id and o.owner_id = auth.uid()))))
$$;

create or replace function public.can_edit_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
    or (public.has_role('{salesperson}') and (
      public.is_project_member(p)
      or exists (select 1 from public.projects pr where pr.id = p and (pr.owner_id = auth.uid() or public.in_my_territory(pr.territory_id)))))
$$;

create or replace function public.can_read_customer(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
    or (public.has_role('{salesperson}') and exists (
      select 1 from public.customers cu where cu.id = c and (cu.owner_id = auth.uid() or public.in_my_territory(cu.territory_id))))
    or exists (
      -- customers linked to projects the user can see (as owner, developer, end user or stakeholder)
      select 1 from public.projects pr
      where (pr.customer_id = c or pr.developer_id = c or pr.end_user_id = c) and public.can_read_project(pr.id)
      union all
      select 1 from public.project_stakeholders ps where ps.customer_id = c and public.can_read_project(ps.project_id))
    or exists (select 1 from public.visits v where v.customer_id = c and v.salesperson_id = auth.uid())
$$;

create or replace function public.can_read_visit(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.visits vi where vi.id = v and (
      public.is_manager()
      or vi.salesperson_id = auth.uid()
      or (public.has_role('{salesperson}') and public.in_my_territory(vi.territory_id))
      or exists (select 1 from public.visit_projects vp where vp.visit_id = vi.id and public.is_project_member(vp.project_id))))
$$;

-- Owner may edit while planned/draft; managers may correct any visit (audited).
create or replace function public.can_edit_visit(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.visits vi where vi.id = v and (
      public.is_manager()
      or (vi.salesperson_id = auth.uid() and vi.status in ('planned', 'draft') and public.has_role('{salesperson}'))))
$$;

create or replace function public.can_read_opportunity(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.opportunities op where op.id = o and (op.owner_id = auth.uid() or public.can_read_project(op.project_id)))
$$;

create or replace function public.can_see_margin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role()::text = any (
    select jsonb_array_elements_text(coalesce(public.setting('margin_visible_roles'), '["manager","admin"]'::jsonb))), false)
$$;

create or replace function public.can_read_entity(t text, e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case t
    when 'customer' then public.can_read_customer(e)
    when 'contact' then exists (select 1 from public.contacts c where c.id = e and public.can_read_customer(c.customer_id))
    when 'project' then public.can_read_project(e)
    when 'opportunity' then public.can_read_opportunity(e)
    when 'visit' then public.can_read_visit(e)
    when 'action' then exists (select 1 from public.actions a where a.id = e and (a.owner_id = auth.uid() or a.created_by = auth.uid()
      or public.is_manager() or (a.visit_id is not null and public.can_read_visit(a.visit_id))
      or (a.project_id is not null and public.can_read_project(a.project_id))))
    when 'quotation' then exists (select 1 from public.quotations q where q.id = e and public.can_read_opportunity(q.opportunity_id))
    when 'milestone' then exists (select 1 from public.project_milestones m where m.id = e and public.can_read_project(m.project_id))
    else false end
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'business_units', 'territories', 'profiles', 'profile_territories', 'lookup_values', 'pipeline_stages',
    'app_settings', 'exchange_rates', 'audit_log', 'customers', 'contacts', 'projects', 'project_members',
    'project_stakeholders', 'opportunities', 'opportunity_stage_history', 'visits', 'visit_contacts',
    'visit_projects', 'visit_opportunities', 'actions', 'quotations', 'quotation_financials',
    'project_milestones', 'technical_notes', 'attachments', 'correction_requests', 'export_log', 'export_schedules'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    -- Deactivated / uninvited users get nothing, whatever else a policy allows.
    if t not in ('profiles', 'profile_territories') then
      execute format('create policy active_users_only on public.%I as restrictive for all to authenticated
                      using (public.current_app_role() is not null) with check (public.current_app_role() is not null)', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reference data: everyone signed in reads; admins (and managers for stages) write
-- ---------------------------------------------------------------------------
create policy read_all on public.business_units for select to authenticated using (public.current_app_role() is not null);
create policy admin_write on public.business_units for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_all on public.territories for select to authenticated using (public.current_app_role() is not null);
create policy admin_write on public.territories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_all on public.lookup_values for select to authenticated using (public.current_app_role() is not null);
create policy admin_write on public.lookup_values for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_all on public.pipeline_stages for select to authenticated using (public.current_app_role() is not null);
create policy manager_write on public.pipeline_stages for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy read_all on public.app_settings for select to authenticated using (public.current_app_role() is not null);
create policy admin_write on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_all on public.exchange_rates for select to authenticated using (public.current_app_role() is not null);
create policy manager_write on public.exchange_rates for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- Profiles: names are visible to colleagues (owner pickers); a user reads their own even when inactive
create policy read_profiles on public.profiles for select to authenticated using (id = auth.uid() or public.current_app_role() is not null);
create policy update_self on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy read_all on public.profile_territories for select to authenticated using (user_id = auth.uid() or public.current_app_role() is not null);
create policy admin_write on public.profile_territories for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy manager_read on public.audit_log for select to authenticated using (public.is_manager());

-- ---------------------------------------------------------------------------
-- Customers & contacts
-- ---------------------------------------------------------------------------
-- Policies test the row's own columns first so a freshly inserted row is
-- visible to its creator (INSERT ... RETURNING / ON CONFLICT).
create policy read_customers on public.customers for select to authenticated
  using (public.is_manager()
    or (public.has_role('{salesperson}') and (owner_id = auth.uid() or created_by = auth.uid() or public.in_my_territory(territory_id)))
    or public.can_read_customer(id));
create policy insert_customers on public.customers for insert to authenticated
  with check (public.is_manager() or (public.has_role('{salesperson}') and coalesce(owner_id, auth.uid()) = auth.uid() and public.in_my_territory(territory_id)));
create policy update_customers on public.customers for update to authenticated
  using (public.is_manager() or (public.has_role('{salesperson}') and (owner_id = auth.uid() or (owner_id is null and public.in_my_territory(territory_id)))))
  with check (public.is_manager() or (owner_id = auth.uid() and public.in_my_territory(territory_id)));
create policy delete_customers on public.customers for delete to authenticated using (public.is_admin());

create policy read_contacts on public.contacts for select to authenticated
  using (public.can_read_customer(customer_id));
create policy insert_contacts on public.contacts for insert to authenticated
  with check (public.has_role('{salesperson,manager,admin}') and public.can_read_customer(customer_id));
create policy update_contacts on public.contacts for update to authenticated
  using (public.is_manager() or (public.has_role('{salesperson}') and public.can_read_customer(customer_id)))
  with check (public.is_manager() or public.can_read_customer(customer_id));
create policy delete_contacts on public.contacts for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Projects, members, stakeholders, opportunities
-- ---------------------------------------------------------------------------
create policy read_projects on public.projects for select to authenticated
  using (public.is_manager()
    or (public.has_role('{salesperson}') and (owner_id = auth.uid() or created_by = auth.uid() or public.in_my_territory(territory_id)))
    or public.can_read_project(id));
create policy insert_projects on public.projects for insert to authenticated
  with check (public.is_manager() or (public.has_role('{salesperson}') and coalesce(owner_id, auth.uid()) = auth.uid()));
create policy update_projects on public.projects for update to authenticated
  using (public.can_edit_project(id)) with check (public.can_edit_project(id));
create policy delete_projects on public.projects for delete to authenticated using (public.is_admin());

create policy read_members on public.project_members for select to authenticated using (public.can_read_project(project_id));
create policy write_members on public.project_members for all to authenticated
  using (public.is_manager() or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (public.is_manager() or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy read_stakeholders on public.project_stakeholders for select to authenticated using (public.can_read_project(project_id));
create policy write_stakeholders on public.project_stakeholders for all to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

create policy read_opportunities on public.opportunities for select to authenticated
  using (owner_id = auth.uid() or public.can_read_project(project_id));
create policy insert_opportunities on public.opportunities for insert to authenticated
  with check (public.can_edit_project(project_id));
create policy update_opportunities on public.opportunities for update to authenticated
  using (public.is_manager() or owner_id = auth.uid() or public.can_edit_project(project_id))
  with check (public.is_manager() or owner_id = auth.uid() or public.can_edit_project(project_id));
create policy delete_opportunities on public.opportunities for delete to authenticated using (public.is_admin());

create policy read_stage_history on public.opportunity_stage_history for select to authenticated
  using (public.can_read_opportunity(opportunity_id));

-- ---------------------------------------------------------------------------
-- Visits and their links
-- ---------------------------------------------------------------------------
create policy read_visits on public.visits for select to authenticated
  using (public.is_manager() or salesperson_id = auth.uid()
    or (public.has_role('{salesperson}') and public.in_my_territory(territory_id))
    or public.can_read_visit(id));
create policy insert_visits on public.visits for insert to authenticated
  with check (public.is_manager() or (public.has_role('{salesperson}') and salesperson_id = auth.uid()));
create policy update_visits on public.visits for update to authenticated
  using (public.is_manager() or (public.has_role('{salesperson}') and salesperson_id = auth.uid() and status in ('planned', 'draft')))
  with check (public.is_manager() or salesperson_id = auth.uid());
create policy delete_visits on public.visits for delete to authenticated
  using (salesperson_id = auth.uid() and status in ('planned', 'draft'));

create policy read_links on public.visit_contacts for select to authenticated using (public.can_read_visit(visit_id));
create policy write_links on public.visit_contacts for all to authenticated using (public.can_edit_visit(visit_id)) with check (public.can_edit_visit(visit_id));
create policy read_links on public.visit_projects for select to authenticated using (public.can_read_visit(visit_id));
create policy write_links on public.visit_projects for all to authenticated using (public.can_edit_visit(visit_id)) with check (public.can_edit_visit(visit_id));
create policy read_links on public.visit_opportunities for select to authenticated using (public.can_read_visit(visit_id));
create policy write_links on public.visit_opportunities for all to authenticated using (public.can_edit_visit(visit_id)) with check (public.can_edit_visit(visit_id));

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------
create policy read_actions on public.actions for select to authenticated
  using (public.current_app_role() is not null and (
    public.is_manager() or owner_id = auth.uid() or created_by = auth.uid()
    or (public.has_role('{salesperson}') and public.in_my_territory(territory_id))
    or (visit_id is not null and public.can_read_visit(visit_id))
    or (project_id is not null and public.can_read_project(project_id))));
create policy insert_actions on public.actions for insert to authenticated
  with check (public.current_app_role() is not null and (
    public.is_manager()
    or (visit_id is not null and public.can_edit_visit(visit_id))
    or (visit_id is null and (
      (project_id is not null and public.can_read_project(project_id))
      or (customer_id is not null and public.can_read_customer(customer_id))
      or (opportunity_id is not null and public.can_read_opportunity(opportunity_id))))));
create policy update_actions on public.actions for update to authenticated
  using (public.is_manager() or owner_id = auth.uid() or created_by = auth.uid())
  with check (public.is_manager() or owner_id = auth.uid() or created_by = auth.uid());
create policy delete_actions on public.actions for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Quotations (cost/margin restricted by role), milestones, technical notes
-- ---------------------------------------------------------------------------
create policy read_quotations on public.quotations for select to authenticated using (public.can_read_opportunity(opportunity_id));
create policy write_quotations on public.quotations for insert to authenticated
  with check (public.is_manager() or (public.can_read_opportunity(opportunity_id) and public.has_role('{salesperson,estimator}')));
create policy update_quotations on public.quotations for update to authenticated
  using (public.is_manager() or prepared_by = auth.uid() or created_by = auth.uid())
  with check (public.is_manager() or public.can_read_opportunity(opportunity_id));

create policy margin_read on public.quotation_financials for select to authenticated using (public.can_see_margin());
create policy margin_write on public.quotation_financials for all to authenticated
  using (public.can_see_margin()) with check (public.can_see_margin());

create policy read_milestones on public.project_milestones for select to authenticated using (public.can_read_project(project_id));
create policy write_milestones on public.project_milestones for all to authenticated
  using (public.is_manager() or public.is_project_member(project_id) or public.can_edit_project(project_id))
  with check (public.is_manager() or public.is_project_member(project_id) or public.can_edit_project(project_id));

create policy read_notes on public.technical_notes for select to authenticated using (public.can_read_project(project_id));
create policy insert_notes on public.technical_notes for insert to authenticated
  with check (public.is_manager() or public.is_project_member(project_id) or public.can_edit_project(project_id));
create policy update_notes on public.technical_notes for update to authenticated
  using (created_by = auth.uid() or public.is_admin()) with check (created_by = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------
create policy read_attachments on public.attachments for select to authenticated
  using (public.can_read_entity(entity_type, entity_id));
create policy insert_attachments on public.attachments for insert to authenticated
  with check (public.current_app_role() is not null and (
    public.can_read_entity(entity_type, entity_id)
    -- a visit attachment may arrive before the visit row during offline sync
    or (entity_type = 'visit' and not exists (select 1 from public.visits v where v.id = entity_id))));
create policy update_attachments on public.attachments for update to authenticated
  using (created_by = auth.uid() or public.is_manager()) with check (created_by = auth.uid() or public.is_manager());

-- ---------------------------------------------------------------------------
-- Corrections, exports
-- ---------------------------------------------------------------------------
create policy read_corrections on public.correction_requests for select to authenticated
  using (requested_by = auth.uid() or public.is_manager());
create policy insert_corrections on public.correction_requests for insert to authenticated
  with check (requested_by = auth.uid() and exists (select 1 from public.visits v where v.id = visit_id and v.salesperson_id = auth.uid()));
create policy withdraw_corrections on public.correction_requests for update to authenticated
  using (requested_by = auth.uid() and status = 'pending') with check (status = 'withdrawn');

create policy read_exports on public.export_log for select to authenticated using (user_id = auth.uid() or public.is_manager());
create policy manage_schedules on public.export_schedules for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- ---------------------------------------------------------------------------
-- Storage: private buckets for attachments and generated exports
-- Path convention: <uploader user id>/<entity_type>/<entity_id>/<attachment_id>/<filename>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('attachments', 'attachments', false, 26214400,
   array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf', 'audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/aac',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'text/csv',
         'application/dwg', 'image/vnd.dwg', 'application/acad', 'application/octet-stream']),
  ('exports', 'exports', false, 52428800, array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy attachments_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.current_app_role() is not null
    and (storage.foldername(name))[1] = auth.uid()::text);
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and ((storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.attachments a where a.storage_path = name and public.can_read_entity(a.entity_type, a.entity_id))));
create policy exports_read on storage.objects for select to authenticated
  using (bucket_id = 'exports' and public.is_manager());

-- ===== supabase/migrations/20260928000500_api.sql =====
-- DIMO Sales Visit & Project Tracking — API functions (called via supabase.rpc)
--   submit_visit          idempotent offline sync of a visit and everything created with it
--   find_similar_*        duplicate matching before creating customers / projects
--   dashboard_summary     manager dashboard measures
--   export_dataset        rows for the Excel workbook (same filters as the dashboard)
--   approve/reject_correction, reassign_owner, purge_expired

-- ---------------------------------------------------------------------------
-- Duplicate matching
-- ---------------------------------------------------------------------------
-- Exact key match (normalised name + city). Returns only an id so a salesperson
-- links to an existing customer in another territory instead of duplicating it.
create or replace function public.match_customer(p_name text, p_city text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare r uuid; n int;
begin
  select id into r from public.customers
  where normalized_name = public.normalize_name(p_name) and lower(coalesce(city, '')) = lower(coalesce(p_city, '')) and deleted_at is null
  limit 1;
  if r is null and nullif(trim(coalesce(p_city, '')), '') is null then
    select count(*), min(id::text)::uuid into n, r from public.customers
    where normalized_name = public.normalize_name(p_name) and deleted_at is null;
    if n <> 1 then r := null; end if;
  end if;
  return r;
end $$;

create or replace function public.match_project(p_name text, p_district text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare r uuid; n int;
begin
  select id into r from public.projects
  where (normalized_name = public.normalize_name(p_name)
         or public.normalize_name(p_name) = any (select public.normalize_name(a) from unnest(aliases) a))
    and lower(coalesce(district, '')) = lower(coalesce(p_district, '')) and deleted_at is null
  limit 1;
  if r is null and nullif(trim(coalesce(p_district, '')), '') is null then
    select count(*), min(id::text)::uuid into n, r from public.projects
    where normalized_name = public.normalize_name(p_name) and deleted_at is null;
    if n <> 1 then r := null; end if;
  end if;
  return r;
end $$;

-- Fuzzy candidates shown before creating a record. Deliberately limited to
-- identifying columns; "visible" says whether the caller can open the record.
create or replace function public.find_similar_customers(q text, p_city text default null)
returns table (id uuid, code text, legal_name text, trading_name text, city text, owner_name text, score real, visible boolean)
language sql stable security definer set search_path = public, extensions as $$
  select c.id, c.code, c.legal_name, c.trading_name, c.city, p.full_name,
         greatest(similarity(c.legal_name, q), similarity(coalesce(c.trading_name, ''), q),
                  case when c.normalized_name = public.normalize_name(q) then 1 else 0 end)::real as score,
         public.can_read_customer(c.id)
  from public.customers c left join public.profiles p on p.id = c.owner_id
  where public.current_app_role() is not null and c.deleted_at is null and length(trim(q)) >= 2
    and (c.normalized_name = public.normalize_name(q)
         or similarity(c.legal_name, q) > 0.3 or similarity(coalesce(c.trading_name, ''), q) > 0.3
         or c.legal_name ilike '%' || q || '%' or c.trading_name ilike '%' || q || '%')
  order by (p_city is not null and lower(c.city) = lower(p_city)) desc, score desc
  limit 10
$$;

create or replace function public.find_similar_projects(q text, p_district text default null)
returns table (id uuid, code text, name text, district text, owner_name text, customer_name text, score real, visible boolean)
language sql stable security definer set search_path = public, extensions as $$
  select pr.id, pr.code, pr.name, pr.district, p.full_name, c.legal_name,
         greatest(similarity(pr.name, q), similarity(array_to_string(pr.aliases, ' '), q),
                  case when pr.normalized_name = public.normalize_name(q) then 1 else 0 end)::real as score,
         public.can_read_project(pr.id)
  from public.projects pr
  left join public.profiles p on p.id = pr.owner_id
  left join public.customers c on c.id = pr.customer_id
  where public.current_app_role() is not null and pr.deleted_at is null and length(trim(q)) >= 2
    and (pr.normalized_name = public.normalize_name(q) or similarity(pr.name, q) > 0.3
         or pr.name ilike '%' || q || '%' or array_to_string(pr.aliases, ' ') ilike '%' || q || '%')
  order by (p_district is not null and lower(pr.district) = lower(p_district)) desc, score desc
  limit 10
$$;

-- When a salesperson links a visit to an existing project they cannot yet see,
-- they are added as a sales member so the project history stays complete.
-- Only for projects linked to one of the caller's own visits; the membership is audited.
create or replace function public.ensure_project_access(p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.has_role('{salesperson}') and not public.can_read_project(p)
     and exists (select 1 from public.visit_projects vp join public.visits v on v.id = vp.visit_id
                 where vp.project_id = p and v.salesperson_id = auth.uid()) then
    insert into public.project_members (project_id, user_id, member_role, added_by)
    values (p, auth.uid(), 'sales', auth.uid()) on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- submit_visit: one transaction, safe to retry (all ids are generated on the
-- device). Payload:
-- {
--   "visit": {...visit columns incl. id},
--   "base_version": 3 | null,         -- server version the device last saw
--   "submit": true,                    -- false = save to server as draft
--   "new_customers": [...], "new_contacts": [...], "new_projects": [...],
--   "new_opportunities": [...], "new_stakeholders": [...],
--   "contact_ids": [...], "project_ids": [...], "opportunity_ids": [...],
--   "actions": [...], "attachments": [...]
-- }
-- Returns { visit_id, code, status, version, id_map, already_processed }
-- id_map maps device ids to existing server ids when a duplicate was matched.
-- ---------------------------------------------------------------------------
create or replace function public.submit_visit(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v jsonb := p -> 'visit';
  vid uuid := (v ->> 'id')::uuid;
  existing public.visits;
  result public.visits;
  id_map jsonb := '{}'::jsonb;
  rec jsonb;
  new_id uuid;
  matched uuid;
  ids uuid[];
  stage uuid;
  do_submit boolean := coalesce((p ->> 'submit')::boolean, true);
  base_version int := (p ->> 'base_version')::int;
  visit_fields text[] := array[
    'customer_id', 'contact_unavailable_reason', 'visit_type', 'scheduled_at', 'visit_date', 'check_in_at', 'check_out_at',
    'device_created_at', 'meeting_place', 'is_remote', 'check_in_lat', 'check_in_lng', 'check_in_accuracy_m',
    'check_out_lat', 'check_out_lng', 'check_out_accuracy_m', 'location_consent', 'location_unavailable_reason',
    'purpose', 'products_discussed', 'requirements', 'pain_points', 'decision_process', 'budget_indication',
    'funding_status', 'purchase_timeline', 'estimated_value', 'currency', 'confidence', 'competitor', 'incumbent',
    'spec_position', 'differentiator', 'risks', 'summary', 'commitments', 'documents_shared', 'documents_requested',
    'outcome', 'next_meeting_at', 'no_followup_reason'];
  cols text;
begin
  if public.current_app_role() is null then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;
  if vid is null then
    raise exception 'visit.id is required' using errcode = '22023';
  end if;

  select * into existing from public.visits where id = vid;
  if found and existing.status in ('submitted', 'cancelled') then
    -- Retry of a visit that already reached the server: return the stored result.
    return jsonb_build_object('visit_id', existing.id, 'code', existing.code, 'status', existing.status,
                              'version', existing.version, 'id_map', '{}'::jsonb, 'already_processed', true);
  end if;
  if found and base_version is not null and existing.version <> base_version
     and existing.updated_by is distinct from auth.uid() then
    raise exception 'This visit was changed on the server by someone else. Review it before submitting again.'
      using errcode = 'PT409', detail = 'conflict';
  end if;

  -- 1. Customers created on the device (matched to an existing record when the key matches)
  for rec in select * from jsonb_array_elements(coalesce(p -> 'new_customers', '[]'::jsonb)) loop
    new_id := (rec ->> 'id')::uuid;
    matched := coalesce(
      (select id from public.customers where id = new_id),
      public.match_customer(rec ->> 'legal_name', rec ->> 'city'));
    if matched is null then
      insert into public.customers (id, legal_name, trading_name, category, industry, address, district, city, country,
                                    website, phone, email, strategic_priority, status, source, notes, parent_customer_id)
      values (new_id, rec ->> 'legal_name', rec ->> 'trading_name', rec ->> 'category', rec ->> 'industry', rec ->> 'address',
              rec ->> 'district', rec ->> 'city', coalesce(rec ->> 'country', 'Sri Lanka'), rec ->> 'website', rec ->> 'phone',
              rec ->> 'email', rec ->> 'strategic_priority', coalesce(rec ->> 'status', 'provisional'), rec ->> 'source',
              rec ->> 'notes', (rec ->> 'parent_customer_id')::uuid);
      matched := new_id;
    end if;
    id_map := id_map || jsonb_build_object(new_id::text, matched);
  end loop;

  -- 2. Projects created on the device (deduplicated by name + district)
  for rec in select * from jsonb_array_elements(coalesce(p -> 'new_projects', '[]'::jsonb)) loop
    new_id := (rec ->> 'id')::uuid;
    matched := coalesce(
      (select id from public.projects where id = new_id),
      public.match_project(rec ->> 'name', rec ->> 'district'));
    if matched is null then
      insert into public.projects (id, name, aliases, site_location, district, city, latitude, longitude, customer_id,
                                   developer_id, end_user_id, project_type, description, segments, systems_products,
                                   total_estimate, addressable_value, currency, design_stage, tender_closing_date,
                                   expected_award_date, lead_source, info_source, tender_reference)
      values (new_id, rec ->> 'name',
              coalesce(array(select jsonb_array_elements_text(rec -> 'aliases')), '{}'),
              rec ->> 'site_location', rec ->> 'district', rec ->> 'city',
              (rec ->> 'latitude')::double precision, (rec ->> 'longitude')::double precision,
              coalesce((id_map ->> (rec ->> 'customer_id'))::uuid, (rec ->> 'customer_id')::uuid),
              coalesce((id_map ->> (rec ->> 'developer_id'))::uuid, (rec ->> 'developer_id')::uuid),
              coalesce((id_map ->> (rec ->> 'end_user_id'))::uuid, (rec ->> 'end_user_id')::uuid),
              rec ->> 'project_type', rec ->> 'description',
              coalesce(array(select jsonb_array_elements_text(rec -> 'segments')), '{}'),
              rec ->> 'systems_products', (rec ->> 'total_estimate')::numeric, (rec ->> 'addressable_value')::numeric,
              coalesce(rec ->> 'currency', 'LKR'), rec ->> 'design_stage', (rec ->> 'tender_closing_date')::date,
              (rec ->> 'expected_award_date')::date, rec ->> 'lead_source', rec ->> 'info_source', rec ->> 'tender_reference');
      matched := new_id;
    end if;
    id_map := id_map || jsonb_build_object(new_id::text, matched);
  end loop;

  -- 3. The visit itself (kept as draft until links and actions exist)
  v := v || jsonb_build_object(
    'customer_id', coalesce(id_map ->> (v ->> 'customer_id'), v ->> 'customer_id'),
    'is_remote', coalesce((v ->> 'is_remote')::boolean, false),
    'currency', coalesce(v ->> 'currency', public.base_currency()));
  select string_agg(quote_ident(f), ', ') into cols from unnest(visit_fields) f;
  if existing.id is null then
    execute format(
      'insert into public.visits (id, salesperson_id, status, %1$s)
       select $2, coalesce(($1 ->> ''salesperson_id'')::uuid, auth.uid()), ''draft'', %1$s
       from jsonb_populate_record(null::public.visits, $1)', cols)
      using v, vid;
  else
    execute format(
      'update public.visits set (%1$s) = (select %1$s from jsonb_populate_record(null::public.visits, $1)),
         status = case when status = ''planned'' then ''draft'' else status end
       where id = $2', cols)
      using v, vid;
    if not found then
      raise exception 'You cannot edit this visit' using errcode = '42501';
    end if;
  end if;

  -- 4. Contacts created on the device (same customer + same name/email = same person)
  for rec in select * from jsonb_array_elements(coalesce(p -> 'new_contacts', '[]'::jsonb)) loop
    new_id := (rec ->> 'id')::uuid;
    matched := null;
    select c.id into matched from public.contacts c
    where c.id = new_id
       or (c.customer_id = coalesce((id_map ->> (rec ->> 'customer_id'))::uuid, (rec ->> 'customer_id')::uuid)
           and c.deleted_at is null
           and (c.normalized_name = public.normalize_name(rec ->> 'full_name')
                or (rec ->> 'email' is not null and lower(c.email) = lower(rec ->> 'email'))))
    limit 1;
    if matched is null then
      insert into public.contacts (id, customer_id, full_name, designation, department, work_phone, mobile_phone, email,
                                   decision_role, preferred_contact_method, consent_status, communication_preference, notes)
      values (new_id, coalesce((id_map ->> (rec ->> 'customer_id'))::uuid, (rec ->> 'customer_id')::uuid),
              rec ->> 'full_name', rec ->> 'designation', rec ->> 'department', rec ->> 'work_phone', rec ->> 'mobile_phone',
              rec ->> 'email', rec ->> 'decision_role', rec ->> 'preferred_contact_method',
              coalesce(rec ->> 'consent_status', 'unknown'), rec ->> 'communication_preference', rec ->> 'notes');
      matched := new_id;
    end if;
    id_map := id_map || jsonb_build_object(new_id::text, matched);
  end loop;

  -- 5. Opportunities (bid packages) created on the device
  for rec in select * from jsonb_array_elements(coalesce(p -> 'new_opportunities', '[]'::jsonb)) loop
    new_id := (rec ->> 'id')::uuid;
    if not exists (select 1 from public.opportunities where id = new_id) then
      stage := coalesce((rec ->> 'stage_id')::uuid,
                        (select id from public.pipeline_stages where code = rec ->> 'stage_code'),
                        (select id from public.pipeline_stages where active and outcome = 'open' order by sort_order limit 1));
      insert into public.opportunities (id, project_id, name, segment, systems_products, stage_id, probability, estimated_value,
                                        currency, expected_order_date, competitors, incumbent, spec_status, next_milestone)
      values (new_id, coalesce((id_map ->> (rec ->> 'project_id'))::uuid, (rec ->> 'project_id')::uuid), rec ->> 'name',
              rec ->> 'segment', rec ->> 'systems_products', stage, (rec ->> 'probability')::numeric,
              (rec ->> 'estimated_value')::numeric, coalesce(rec ->> 'currency', 'LKR'), (rec ->> 'expected_order_date')::date,
              rec ->> 'competitors', rec ->> 'incumbent', rec ->> 'spec_status', rec ->> 'next_milestone');
    end if;
    id_map := id_map || jsonb_build_object(new_id::text, new_id);
  end loop;

  -- 6. Stakeholders for new or existing projects
  for rec in select * from jsonb_array_elements(coalesce(p -> 'new_stakeholders', '[]'::jsonb)) loop
    insert into public.project_stakeholders (id, project_id, customer_id, contact_id, stakeholder_role, influence_stage, is_decision_maker)
    values (coalesce((rec ->> 'id')::uuid, gen_random_uuid()),
            coalesce((id_map ->> (rec ->> 'project_id'))::uuid, (rec ->> 'project_id')::uuid),
            coalesce((id_map ->> (rec ->> 'customer_id'))::uuid, (rec ->> 'customer_id')::uuid),
            coalesce((id_map ->> (rec ->> 'contact_id'))::uuid, (rec ->> 'contact_id')::uuid),
            rec ->> 'stakeholder_role', rec ->> 'influence_stage', coalesce((rec ->> 'is_decision_maker')::boolean, false))
    on conflict do nothing;
  end loop;

  -- 7. Links (replace with the device's list)
  select coalesce(array_agg(coalesce((id_map ->> x)::uuid, x::uuid)), '{}') into ids
  from jsonb_array_elements_text(coalesce(p -> 'contact_ids', '[]'::jsonb)) x;
  delete from public.visit_contacts where visit_id = vid and not (contact_id = any (ids));
  insert into public.visit_contacts (visit_id, contact_id) select vid, unnest(ids) on conflict do nothing;

  select coalesce(array_agg(coalesce((id_map ->> x)::uuid, x::uuid)), '{}') into ids
  from jsonb_array_elements_text(coalesce(p -> 'project_ids', '[]'::jsonb)) x;
  delete from public.visit_projects where visit_id = vid and not (project_id = any (ids));
  insert into public.visit_projects (visit_id, project_id) select vid, unnest(ids) on conflict do nothing;
  perform public.ensure_project_access(x) from unnest(ids) x;

  select coalesce(array_agg(coalesce((id_map ->> x)::uuid, x::uuid)), '{}') into ids
  from jsonb_array_elements_text(coalesce(p -> 'opportunity_ids', '[]'::jsonb)) x;
  delete from public.visit_opportunities where visit_id = vid and not (opportunity_id = any (ids));
  insert into public.visit_opportunities (visit_id, opportunity_id) select vid, unnest(ids) on conflict do nothing;

  -- 8. Next actions
  for rec in select * from jsonb_array_elements(coalesce(p -> 'actions', '[]'::jsonb)) loop
    insert into public.actions (id, visit_id, customer_id, project_id, opportunity_id, description, owner_id, priority, due_date, status)
    values ((rec ->> 'id')::uuid, vid,
            coalesce((id_map ->> (rec ->> 'customer_id'))::uuid, (rec ->> 'customer_id')::uuid, (v ->> 'customer_id')::uuid),
            coalesce((id_map ->> (rec ->> 'project_id'))::uuid, (rec ->> 'project_id')::uuid),
            coalesce((id_map ->> (rec ->> 'opportunity_id'))::uuid, (rec ->> 'opportunity_id')::uuid),
            rec ->> 'description', coalesce((rec ->> 'owner_id')::uuid, auth.uid()),
            coalesce(rec ->> 'priority', 'normal'), (rec ->> 'due_date')::date, coalesce(rec ->> 'status', 'open'))
    on conflict (id) do nothing;
  end loop;

  -- 9. Attachments already uploaded to storage
  for rec in select * from jsonb_array_elements(coalesce(p -> 'attachments', '[]'::jsonb)) loop
    insert into public.attachments (id, entity_type, entity_id, storage_path, filename, mime_type, size_bytes, caption)
    values ((rec ->> 'id')::uuid, coalesce(rec ->> 'entity_type', 'visit'),
            coalesce((id_map ->> (rec ->> 'entity_id'))::uuid, (rec ->> 'entity_id')::uuid, vid),
            rec ->> 'storage_path', rec ->> 'filename', rec ->> 'mime_type', (rec ->> 'size_bytes')::bigint, rec ->> 'caption')
    on conflict (id) do nothing;
  end loop;

  -- 10. Submit (validation runs in the visits_submit trigger)
  if do_submit then
    update public.visits set status = 'submitted' where id = vid;
  end if;

  select * into result from public.visits where id = vid;
  return jsonb_build_object('visit_id', result.id, 'code', result.code, 'status', result.status,
                            'version', result.version, 'id_map', id_map, 'already_processed', false);
end $$;

-- ---------------------------------------------------------------------------
-- Corrections to submitted visits
-- ---------------------------------------------------------------------------
create or replace function public.correctable_visit_fields() returns text[]
language sql immutable as $$
  select array['customer_id', 'contact_unavailable_reason', 'visit_type', 'visit_date', 'check_in_at', 'check_out_at',
    'meeting_place', 'is_remote', 'location_unavailable_reason', 'purpose', 'products_discussed', 'requirements',
    'pain_points', 'decision_process', 'budget_indication', 'funding_status', 'purchase_timeline', 'estimated_value',
    'currency', 'confidence', 'competitor', 'incumbent', 'spec_position', 'differentiator', 'risks', 'summary',
    'commitments', 'documents_shared', 'documents_requested', 'outcome', 'next_meeting_at', 'no_followup_reason']
$$;

create or replace function public.approve_correction(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  cr public.correction_requests;
  keys text[];
  cols text;
begin
  if not public.is_manager() then raise exception 'Only a manager can approve corrections' using errcode = '42501'; end if;
  select * into cr from public.correction_requests where id = p_id for update;
  if not found or cr.status <> 'pending' then raise exception 'Correction request is not pending' using errcode = '22023'; end if;
  select array_agg(k) into keys from jsonb_object_keys(cr.changes) k where k = any (public.correctable_visit_fields());
  if keys is not null then
    select string_agg(quote_ident(k), ', ') into cols from unnest(keys) k;
    execute format('update public.visits set (%1$s) = (select %1$s from jsonb_populate_record(null::public.visits, $1)) where id = $2', cols)
      using cr.changes, cr.visit_id;
  end if;
  update public.correction_requests set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note where id = p_id;
end $$;

create or replace function public.reject_correction(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Only a manager can reject corrections' using errcode = '42501'; end if;
  update public.correction_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
  where id = p_id and status = 'pending';
  if not found then raise exception 'Correction request is not pending' using errcode = '22023'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Offboarding: move a user's records to another owner
-- ---------------------------------------------------------------------------
create or replace function public.reassign_owner(p_from uuid, p_to uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c1 int; c2 int; c3 int; c4 int; c5 int;
begin
  if not public.is_admin() then raise exception 'Only an administrator can reassign records' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_to and active) then
    raise exception 'The new owner must be an active user' using errcode = '22023';
  end if;
  update public.customers set owner_id = p_to where owner_id = p_from; get diagnostics c1 = row_count;
  update public.contacts set owner_id = p_to where owner_id = p_from; get diagnostics c2 = row_count;
  update public.projects set owner_id = p_to where owner_id = p_from; get diagnostics c3 = row_count;
  update public.opportunities set owner_id = p_to where owner_id = p_from and closed_at is null; get diagnostics c4 = row_count;
  update public.actions set owner_id = p_to where owner_id = p_from and status in ('open', 'in_progress'); get diagnostics c5 = row_count;
  return jsonb_build_object('customers', c1, 'contacts', c2, 'projects', c3, 'opportunities', c4, 'actions', c5);
end $$;

-- ---------------------------------------------------------------------------
-- Shared report filter. Filters JSON (all optional):
--   { "from": "2026-09-01", "to": "2026-09-30", "owner_id": uuid, "territory_id": uuid, "stage_id": uuid }
-- Date range applies to activity (visit date, action created/due, quotation
-- submission, stage closure, audit time). Masters and the open pipeline are
-- filtered by owner / territory / stage only.
-- ---------------------------------------------------------------------------
create or replace function public.filter_from(f jsonb) returns date language sql immutable as $$
  select coalesce((f ->> 'from')::date, date '1900-01-01') $$;
create or replace function public.filter_to(f jsonb) returns date language sql immutable as $$
  select coalesce((f ->> 'to')::date, date '2999-12-31') $$;

create or replace function public.dashboard_summary(f jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  d_from date := public.filter_from(f);
  d_to date := public.filter_to(f);
  f_owner uuid := (f ->> 'owner_id')::uuid;
  f_terr uuid := (f ->> 'territory_id')::uuid;
  f_stage uuid := (f ->> 'stage_id')::uuid;
  today date := (now() at time zone 'Asia/Colombo')::date;
  stale_days int := coalesce((public.setting('stale_project_days') #>> '{}')::int, 30);
  out jsonb;
begin
  if public.current_app_role() is null then raise exception 'Not authorised' using errcode = '42501'; end if;

  with
  vis as (
    select v.* from public.visits v
    where v.visit_date between d_from and d_to and v.status <> 'draft'
      and (f_owner is null or v.salesperson_id = f_owner) and (f_terr is null or v.territory_id = f_terr)),
  cust as (
    select c.* from public.customers c
    where c.deleted_at is null and c.status in ('active', 'prospect', 'provisional')
      and (f_owner is null or c.owner_id = f_owner) and (f_terr is null or c.territory_id = f_terr)),
  opp as (
    select o.*, s.name as stage_name, s.sort_order, s.outcome as stage_outcome,
           public.to_base(o.estimated_value, o.currency) as value_base,
           public.to_base(o.weighted_value, o.currency) as weighted_base
    from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id
    where o.deleted_at is null
      and (f_owner is null or o.owner_id = f_owner) and (f_terr is null or o.territory_id = f_terr)
      and (f_stage is null or o.stage_id = f_stage)),
  act as (
    select a.* from public.actions a
    where (f_owner is null or a.owner_id = f_owner) and (f_terr is null or a.territory_id = f_terr)),
  quo as (
    select q.* from public.quotations q join opp on opp.id = q.opportunity_id
    where q.submission_date between d_from and d_to)
  select jsonb_build_object(
    'generated_at', now(),
    'base_currency', public.base_currency(),
    'filters', f,
    'visits', jsonb_build_object(
      'submitted', (select count(*) from vis where status = 'submitted'),
      'planned', (select count(*) from vis where scheduled_at is not null and status <> 'cancelled'),
      'planned_completed', (select count(*) from vis where scheduled_at is not null and status = 'submitted'),
      'unplanned_completed', (select count(*) from vis where scheduled_at is null and status = 'submitted'),
      'cancelled', (select count(*) from vis where status = 'cancelled'),
      'leading_to_projects', (select count(*) from vis where status = 'submitted'
                                and exists (select 1 from public.visit_projects vp where vp.visit_id = vis.id)),
      'leading_to_quotations', (select count(*) from vis where status = 'submitted' and exists (
          select 1 from public.quotations q join public.opportunities o on o.id = q.opportunity_id
          where q.submission_date >= vis.visit_date
            and (o.id in (select opportunity_id from public.visit_opportunities where visit_id = vis.id)
                 or o.project_id in (select project_id from public.visit_projects where visit_id = vis.id))))),
    'visits_by_person', coalesce((select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object('user_id', p.id, 'name', p.full_name,
          'submitted', count(*) filter (where vis.status = 'submitted'),
          'planned', count(*) filter (where vis.scheduled_at is not null and vis.status <> 'cancelled'),
          'planned_completed', count(*) filter (where vis.scheduled_at is not null and vis.status = 'submitted')) x
        from vis join public.profiles p on p.id = vis.salesperson_id group by p.id, p.full_name) t), '[]'),
    'visits_by_week', coalesce((select jsonb_agg(jsonb_build_object('week', wk, 'count', n) order by wk) from (
        select to_char(date_trunc('week', visit_date), 'YYYY-MM-DD') wk, count(*) n from vis where status = 'submitted' group by 1) t), '[]'),
    'visits_by_month', coalesce((select jsonb_agg(jsonb_build_object('month', mo, 'count', n) order by mo) from (
        select to_char(visit_date, 'YYYY-MM') mo, count(*) n from vis where status = 'submitted' group by 1) t), '[]'),
    'accounts', jsonb_build_object(
      'total', (select count(*) from cust),
      'visited', (select count(*) from cust where exists (select 1 from vis where vis.customer_id = cust.id and vis.status = 'submitted')),
      'not_visited', (select count(*) from cust where not exists (select 1 from vis where vis.customer_id = cust.id and vis.status = 'submitted')),
      'not_visited_list', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', legal_name, 'last_visit_at', last_visit_at)
                                     order by last_visit_at nulls first) from (
          select * from cust where not exists (select 1 from vis where vis.customer_id = cust.id and vis.status = 'submitted')
          order by last_visit_at nulls first limit 50) t), '[]')),
    'actions', jsonb_build_object(
      'open', (select count(*) from act where status in ('open', 'in_progress')),
      'overdue', (select count(*) from act where status in ('open', 'in_progress') and due_date < today),
      'due_7_days', (select count(*) from act where status in ('open', 'in_progress') and due_date between today and today + 7),
      'completed_in_range', (select count(*) from act where status = 'done' and (completed_at at time zone 'Asia/Colombo')::date between d_from and d_to),
      'overdue_list', coalesce((select jsonb_agg(x order by x ->> 'due_date') from (
          select jsonb_build_object('id', a.id, 'code', a.code, 'description', a.description, 'due_date', a.due_date,
                                    'owner', p.full_name, 'owner_id', a.owner_id, 'priority', a.priority, 'escalated', a.escalated) x
          from act a left join public.profiles p on p.id = a.owner_id
          where a.status in ('open', 'in_progress') and a.due_date < today order by a.due_date limit 100) t), '[]')),
    'pipeline', jsonb_build_object(
      'open_count', (select count(*) from opp where stage_outcome = 'open'),
      'open_value', (select sum(value_base) from opp where stage_outcome = 'open'),
      'weighted_value', (select sum(weighted_base) from opp where stage_outcome = 'open'),
      'unconverted_count', (select count(*) from opp where stage_outcome = 'open' and estimated_value is not null and value_base is null),
      'by_stage', coalesce((select jsonb_agg(x order by (x ->> 'sort_order')::int) from (
          select jsonb_build_object('stage_id', s.id, 'stage', s.name, 'sort_order', s.sort_order, 'outcome', s.outcome,
                                    'count', count(opp.id), 'value', sum(opp.value_base), 'weighted', sum(opp.weighted_base)) x
          from public.pipeline_stages s left join opp on opp.stage_id = s.id
          where s.active group by s.id) t), '[]'),
      'by_owner', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('owner_id', opp.owner_id, 'owner', p.full_name, 'count', count(*),
                                    'value', sum(value_base), 'weighted', sum(weighted_base)) x
          from opp left join public.profiles p on p.id = opp.owner_id where stage_outcome = 'open' group by opp.owner_id, p.full_name) t), '[]'),
      'by_segment', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('segment', coalesce(segment, 'unspecified'), 'count', count(*),
                                    'value', sum(value_base), 'weighted', sum(weighted_base)) x
          from opp where stage_outcome = 'open' group by coalesce(segment, 'unspecified')) t), '[]'),
      'by_order_month', coalesce((select jsonb_agg(x order by x ->> 'month') from (
          select jsonb_build_object('month', coalesce(to_char(expected_order_date, 'YYYY-MM'), 'unscheduled'), 'count', count(*),
                                    'value', sum(value_base), 'weighted', sum(weighted_base)) x
          from opp where stage_outcome = 'open' group by coalesce(to_char(expected_order_date, 'YYYY-MM'), 'unscheduled')) t), '[]')),
    'results', jsonb_build_object(
      'won', (select count(*) from opp where stage_outcome = 'won' and (closed_at at time zone 'Asia/Colombo')::date between d_from and d_to),
      'won_value', (select sum(public.to_base(coalesce(final_award_value, estimated_value), currency)) from opp
                    where stage_outcome = 'won' and (closed_at at time zone 'Asia/Colombo')::date between d_from and d_to),
      'lost', (select count(*) from opp where stage_outcome = 'lost' and (closed_at at time zone 'Asia/Colombo')::date between d_from and d_to),
      'reasons', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('outcome', stage_outcome, 'reason', coalesce(win_loss_reason, 'unspecified'), 'count', count(*)) x
          from opp where stage_outcome in ('won', 'lost') and (closed_at at time zone 'Asia/Colombo')::date between d_from and d_to
          group by stage_outcome, coalesce(win_loss_reason, 'unspecified')) t), '[]')),
    'quotations', jsonb_build_object(
      'submitted', (select count(*) from quo where status <> 'draft'),
      'accepted', (select count(*) from quo where status = 'accepted'),
      'rejected', (select count(*) from quo where status = 'rejected'),
      'submitted_value', (select sum(public.to_base(amount, currency, submission_date)) from quo where status <> 'draft'),
      'conversion_pct', (select round(100.0 * count(*) filter (where status = 'accepted')
                                       / nullif(count(*) filter (where status in ('accepted', 'rejected')), 0), 1) from quo)),
    'tender_deadlines', coalesce((select jsonb_agg(x order by x ->> 'date') from (
        select jsonb_build_object('project_id', pr.id, 'code', pr.code, 'name', pr.name, 'kind', k.kind, 'date', k.d) x
        from public.projects pr
        cross join lateral (values ('tender_closing', pr.tender_closing_date), ('quotation_due', pr.quotation_due_date)) k(kind, d)
        where pr.deleted_at is null and pr.status = 'active' and k.d between today and today + 30
          and (f_owner is null or pr.owner_id = f_owner) and (f_terr is null or pr.territory_id = f_terr)
        union all
        select jsonb_build_object('project_id', opp.project_id, 'code', opp.code, 'name', opp.name, 'kind', 'package_quotation_due', 'date', opp.quotation_due_date)
        from opp where stage_outcome = 'open' and opp.quotation_due_date between today and today + 30) t), '[]'),
    'stale_projects', coalesce((select jsonb_agg(x order by x ->> 'last_activity_at') from (
        select jsonb_build_object('id', pr.id, 'code', pr.code, 'name', pr.name, 'last_activity_at', pr.last_activity_at, 'owner', p.full_name) x
        from public.projects pr left join public.profiles p on p.id = pr.owner_id
        where pr.deleted_at is null and pr.status = 'active' and pr.last_activity_at < now() - make_interval(days => stale_days)
          and (f_owner is null or pr.owner_id = f_owner) and (f_terr is null or pr.territory_id = f_terr)
        order by pr.last_activity_at limit 50) t), '[]'),
    'stale_days', stale_days
  ) into out;
  return out;
end $$;

-- ---------------------------------------------------------------------------
-- Export dataset: one JSON array per workbook sheet, RLS applies (invoker).
-- Cost and margin columns are only included when the caller may see them.
-- ---------------------------------------------------------------------------
create or replace function public.export_dataset(f jsonb default '{}'::jsonb, p_channel text default 'download')
returns jsonb language plpgsql volatile set search_path = public as $$
declare
  d_from date := public.filter_from(f);
  d_to date := public.filter_to(f);
  f_owner uuid := (f ->> 'owner_id')::uuid;
  f_terr uuid := (f ->> 'territory_id')::uuid;
  f_stage uuid := (f ->> 'stage_id')::uuid;
  margin boolean := public.can_see_margin();
  sheets jsonb;
  counts jsonb;
begin
  if public.current_app_role() is null then raise exception 'Not authorised' using errcode = '42501'; end if;

  create temporary table if not exists x_customers (id uuid primary key) on commit drop;
  create temporary table if not exists x_projects (id uuid primary key) on commit drop;
  create temporary table if not exists x_opps (id uuid primary key) on commit drop;
  create temporary table if not exists x_visits (id uuid primary key) on commit drop;
  truncate x_customers, x_projects, x_opps, x_visits;

  insert into x_customers select id from public.customers
  where deleted_at is null and (f_owner is null or owner_id = f_owner) and (f_terr is null or territory_id = f_terr);

  insert into x_opps select id from public.opportunities
  where deleted_at is null and (f_owner is null or owner_id = f_owner) and (f_terr is null or territory_id = f_terr)
    and (f_stage is null or stage_id = f_stage);

  insert into x_projects select id from public.projects pr
  where deleted_at is null and (f_terr is null or territory_id = f_terr)
    and (f_owner is null or owner_id = f_owner or exists (select 1 from public.opportunities o join x_opps using (id) where o.project_id = pr.id))
    and (f_stage is null or exists (select 1 from public.opportunities o join x_opps using (id) where o.project_id = pr.id));

  insert into x_visits select id from public.visits
  where status <> 'draft' and visit_date between d_from and d_to
    and (f_owner is null or salesperson_id = f_owner) and (f_terr is null or territory_id = f_terr);

  select jsonb_build_object(
    'customers', coalesce((select jsonb_agg(to_jsonb(c) - 'normalized_name' - 'version' || jsonb_build_object(
        'owner_name', o.full_name, 'territory', t.name, 'parent_customer_code', pc.code) order by c.code)
      from public.customers c join x_customers using (id)
      left join public.profiles o on o.id = c.owner_id left join public.territories t on t.id = c.territory_id
      left join public.customers pc on pc.id = c.parent_customer_id), '[]'),
    'contacts', coalesce((select jsonb_agg(to_jsonb(ct) - 'normalized_name' - 'version' || jsonb_build_object(
        'customer_code', c.code, 'customer_name', c.legal_name, 'owner_name', o.full_name) order by ct.code)
      from public.contacts ct join public.customers c on c.id = ct.customer_id join x_customers x on x.id = c.id
      left join public.profiles o on o.id = ct.owner_id where ct.deleted_at is null), '[]'),
    'visits', coalesce((select jsonb_agg(to_jsonb(v) - 'version' || jsonb_build_object(
        'customer_code', c.code, 'customer_name', c.legal_name, 'salesperson_name', s.full_name, 'territory', t.name,
        'project_codes', (select string_agg(p.code, ', ' order by p.code) from public.visit_projects vp join public.projects p on p.id = vp.project_id where vp.visit_id = v.id),
        'action_count', (select count(*) from public.actions a where a.visit_id = v.id)) order by v.visit_date, v.code)
      from public.visits v join x_visits using (id)
      left join public.customers c on c.id = v.customer_id left join public.profiles s on s.id = v.salesperson_id
      left join public.territories t on t.id = v.territory_id), '[]'),
    'visit_contacts', coalesce((select jsonb_agg(jsonb_build_object('visit_id', vc.visit_id, 'visit_code', v.code,
        'contact_id', vc.contact_id, 'contact_code', ct.code, 'contact_name', ct.full_name, 'customer_id', ct.customer_id) order by v.code, ct.code)
      from public.visit_contacts vc join x_visits x on x.id = vc.visit_id join public.visits v on v.id = vc.visit_id
      join public.contacts ct on ct.id = vc.contact_id), '[]'),
    'projects', coalesce((select jsonb_agg(to_jsonb(p) - 'normalized_name' - 'version' || jsonb_build_object(
        'customer_code', c.code, 'customer_name', c.legal_name, 'developer_name', d.legal_name, 'end_user_name', e.legal_name,
        'owner_name', o.full_name, 'territory', t.name,
        'aliases', array_to_string(p.aliases, '; '), 'segments', array_to_string(p.segments, '; '),
        'drawing_links', array_to_string(p.drawing_links, ' ')) order by p.code)
      from public.projects p join x_projects using (id)
      left join public.customers c on c.id = p.customer_id left join public.customers d on d.id = p.developer_id
      left join public.customers e on e.id = p.end_user_id left join public.profiles o on o.id = p.owner_id
      left join public.territories t on t.id = p.territory_id), '[]'),
    'opportunities', coalesce((select jsonb_agg(to_jsonb(o) - 'version' || jsonb_build_object(
        'project_code', p.code, 'project_name', p.name, 'stage', s.name, 'stage_outcome', s.outcome, 'owner_name', u.full_name,
        'base_currency', public.base_currency(),
        'estimated_value_base', public.to_base(o.estimated_value, o.currency),
        'weighted_value_base', public.to_base(o.weighted_value, o.currency)) order by o.code)
      from public.opportunities o join x_opps using (id) join public.projects p on p.id = o.project_id
      join public.pipeline_stages s on s.id = o.stage_id left join public.profiles u on u.id = o.owner_id), '[]'),
    'project_stakeholders', coalesce((select jsonb_agg(to_jsonb(ps) - 'version' || jsonb_build_object(
        'project_code', p.code, 'customer_code', c.code, 'customer_name', c.legal_name, 'contact_code', ct.code, 'contact_name', ct.full_name)
        order by p.code, ps.stakeholder_role)
      from public.project_stakeholders ps join x_projects x on x.id = ps.project_id join public.projects p on p.id = ps.project_id
      left join public.customers c on c.id = ps.customer_id left join public.contacts ct on ct.id = ps.contact_id), '[]'),
    'actions', coalesce((select jsonb_agg(to_jsonb(a) - 'version' || jsonb_build_object(
        'owner_name', u.full_name, 'customer_code', c.code, 'project_code', p.code, 'visit_code', v.code, 'opportunity_code', o.code,
        'parent_type', case when a.visit_id is not null then 'visit' when a.opportunity_id is not null then 'opportunity'
                            when a.project_id is not null then 'project' else 'customer' end,
        'parent_id', coalesce(a.visit_id, a.opportunity_id, a.project_id, a.customer_id)) order by a.code)
      from public.actions a
      left join public.profiles u on u.id = a.owner_id left join public.customers c on c.id = a.customer_id
      left join public.projects p on p.id = a.project_id left join public.visits v on v.id = a.visit_id
      left join public.opportunities o on o.id = a.opportunity_id
      where (f_owner is null or a.owner_id = f_owner) and (f_terr is null or a.territory_id = f_terr)
        and (a.status in ('open', 'in_progress') or (a.created_at at time zone 'Asia/Colombo')::date between d_from and d_to
             or a.due_date between d_from and d_to)), '[]'),
    'quotations', coalesce((select jsonb_agg(to_jsonb(q) - 'version' || jsonb_build_object(
        'opportunity_code', o.code, 'project_code', p.code, 'recipient_name', coalesce(ct.full_name, c.legal_name),
        'prepared_by_name', u.full_name, 'amount_base', public.to_base(q.amount, q.currency, q.submission_date))
        || case when margin then jsonb_build_object('cost_amount', qf.cost_amount, 'gross_margin_pct', qf.gross_margin_pct) else '{}'::jsonb end
        order by q.reference, q.revision)
      from public.quotations q join x_opps x on x.id = q.opportunity_id join public.opportunities o on o.id = q.opportunity_id
      join public.projects p on p.id = o.project_id
      left join public.quotation_financials qf on margin and qf.quotation_id = q.id
      left join public.contacts ct on ct.id = q.recipient_contact_id left join public.customers c on c.id = q.recipient_customer_id
      left join public.profiles u on u.id = q.prepared_by), '[]'),
    'audit_log', case when public.is_manager() then coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'table_name', l.table_name, 'record_id', l.record_id, 'record_code', l.record_code, 'action', l.action,
        'changed_by', l.changed_by, 'changed_by_name', u.full_name, 'changed_at', l.changed_at,
        'changed_fields', array_to_string(l.changed_fields, ', '), 'note', l.note) order by l.changed_at)
      from (select * from public.audit_log
            where (changed_at at time zone 'Asia/Colombo')::date between d_from and d_to
              and action <> 'insert' and table_name in ('customers', 'contacts', 'projects', 'opportunities', 'visits', 'actions', 'quotations', 'project_stakeholders', 'correction_requests', 'export_log')
            order by changed_at desc limit 20000) l
      left join public.profiles u on u.id = l.changed_by), '[]') else '[]'::jsonb end
  ) into sheets;

  select jsonb_object_agg(k, jsonb_array_length(sheets -> k)) into counts from jsonb_object_keys(sheets) k;
  return jsonb_build_object(
    'export_id', public.record_export(f, counts, p_channel, null),
    'generated_at', now(), 'generated_by', auth.uid(), 'filters', f, 'base_currency', public.base_currency(),
    'can_see_margin', margin, 'row_counts', counts, 'sheets', sheets, 'summary', public.dashboard_summary(f));
end $$;

create or replace function public.record_export(f jsonb, counts jsonb, p_channel text, p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.export_log (user_id, channel, filters, row_counts, storage_path)
  values (auth.uid(), coalesce(p_channel, 'download'), f, counts, p_path) returning id into new_id;
  insert into public.audit_log (table_name, record_id, action, changed_by, new_data, note)
  values ('export_log', new_id, 'export', auth.uid(), jsonb_build_object('filters', f, 'row_counts', counts), p_channel);
  return new_id;
end $$;

-- ---------------------------------------------------------------------------
-- Retention (run daily by pg_cron; see docs/DEPLOYMENT.md)
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int; e int;
begin
  delete from public.audit_log
  where changed_at < now() - make_interval(days => coalesce((public.setting('audit_retention_days') #>> '{}')::int, 2555));
  get diagnostics a = row_count;
  delete from public.export_log
  where created_at < now() - make_interval(days => coalesce((public.setting('export_log_retention_days') #>> '{}')::int, 730));
  get diagnostics e = row_count;
  return jsonb_build_object('audit_log', a, 'export_log', e);
end $$;
revoke execute on function public.purge_expired() from public, anon, authenticated;
revoke execute on function public.match_customer(text, text), public.match_project(text, text) from anon;

-- Real-time dashboard: publish the tables the dashboard listens to.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.visits, public.actions, public.opportunities, public.projects;
  end if;
end $$;

-- ===== supabase/migrations/20260928000600_reference_data.sql =====
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

-- ===== supabase/migrations/20260928000700_automation.sql =====
-- DIMO Sales Visit & Project Tracking — automated management alerts (Release 2)
-- Escalation of overdue actions, alert digests for the daily-alerts Edge
-- Function, and device push tokens for reminders.

insert into public.app_settings (key, value, description) values
  ('escalation_days', '3', 'Open actions this many days overdue are escalated to managers'),
  ('alert_email_enabled', 'true', 'Send daily alert emails (requires RESEND_API_KEY on the Edge Function)')
on conflict (key) do nothing;

create table public.device_push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);
alter table public.device_push_tokens enable row level security;
revoke all on public.device_push_tokens from anon;
create policy own_tokens on public.device_push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Mark long-overdue actions as escalated (to the first active manager of the
-- same territory, else any manager). Returns the number escalated.
create or replace function public.escalate_overdue_actions() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.actions a set
    escalated = true,
    escalated_to = coalesce(
      (select p.id from public.profiles p join public.profile_territories pt on pt.user_id = p.id
       where p.active and p.role = 'manager' and pt.territory_id = a.territory_id order by p.created_at limit 1),
      (select p.id from public.profiles p where p.active and p.role = 'manager' order by p.created_at limit 1)),
    escalation_note = coalesce(escalation_note, 'Automatically escalated: overdue since ' || a.due_date)
  where a.status in ('open', 'in_progress') and not a.escalated
    and a.due_date < (now() at time zone 'Asia/Colombo')::date
                     - coalesce((public.setting('escalation_days') #>> '{}')::int, 3);
  get diagnostics n = row_count;
  return n;
end $$;

-- One digest per active user: their own overdue / due-soon actions; managers
-- also get escalations, tender deadlines and pending corrections.
create or replace function public.alert_digests() returns jsonb
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Colombo')::date d)
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object(
      'user_id', p.id, 'email', p.email, 'name', p.full_name, 'role', p.role,
      'push_tokens', coalesce((select jsonb_agg(token) from public.device_push_tokens t where t.user_id = p.id), '[]'),
      'overdue', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'description', a.description, 'due_date', a.due_date) order by a.due_date)
                  from public.actions a, today where a.owner_id = p.id and a.status in ('open', 'in_progress') and a.due_date < today.d), '[]'),
      'due_soon', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'description', a.description, 'due_date', a.due_date) order by a.due_date)
                  from public.actions a, today where a.owner_id = p.id and a.status in ('open', 'in_progress')
                    and a.due_date between today.d and today.d + coalesce((public.setting('reminder_days_before') #>> '{}')::int, 1)), '[]'),
      'escalated', case when p.role in ('manager', 'admin') then coalesce((
                  select jsonb_agg(jsonb_build_object('code', a.code, 'description', a.description, 'due_date', a.due_date, 'owner', o.full_name) order by a.due_date)
                  from public.actions a left join public.profiles o on o.id = a.owner_id
                  where a.escalated and a.status in ('open', 'in_progress') and (a.escalated_to = p.id or p.role = 'admin')), '[]') else '[]' end,
      'deadlines', case when p.role in ('manager', 'admin') then coalesce((
                  select jsonb_agg(jsonb_build_object('code', pr.code, 'name', pr.name, 'tender_closing_date', pr.tender_closing_date,
                                                      'quotation_due_date', pr.quotation_due_date))
                  from public.projects pr, today where pr.status = 'active' and pr.deleted_at is null
                    and (pr.tender_closing_date between today.d and today.d + 7 or pr.quotation_due_date between today.d and today.d + 7)), '[]') else '[]' end,
      'pending_corrections', case when p.role in ('manager', 'admin')
                  then (select count(*) from public.correction_requests where status = 'pending') else 0 end
    ) x
    from public.profiles p where p.active
  ) t
  where jsonb_array_length(x -> 'overdue') + jsonb_array_length(x -> 'due_soon') + jsonb_array_length(x -> 'escalated')
        + jsonb_array_length(x -> 'deadlines') + (x ->> 'pending_corrections')::int > 0
$$;

revoke execute on function public.escalate_overdue_actions(), public.alert_digests() from public, anon, authenticated;
