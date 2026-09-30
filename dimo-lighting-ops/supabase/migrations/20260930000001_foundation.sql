-- DIMO Lighting Operations System – foundation
-- Users and roles, master data, settings, codes, audit, attachments, notifications, approvals.
-- SRS sections 2, 4.1, 8.4, 8.6, 10.1.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists app;
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum (
  'gm',                 -- GM / DGM – Lighting Solutions
  'sm_projects',        -- Senior Manager – Building & Infrastructure Projects
  'asm_building',       -- Assistant Sales Manager – Building Lighting
  'asm_infra',          -- Assistant Sales Manager – Infrastructure Lighting
  'design_manager',
  'lighting_designer',
  'lighting_engineer',
  'sm_estimation',      -- Senior Manager – Estimation
  'am_estimation',      -- Assistant Manager – Estimation (Infrastructure)
  'estimation_exec',    -- Estimation Executive (Building)
  'operations_exec',
  'sys_admin'
);

create type public.team as enum ('management', 'sales', 'design', 'estimation', 'operations', 'it');

create type public.project_type as enum (
  'hospitality', 'retail', 'institutions', 'commercial', 'infrastructure', 'industrial'
);

create type public.duty_status as enum ('duty_free', 'duty_paid');
create type public.currency as enum ('USD', 'LKR');
create type public.priority as enum ('normal', 'critical');

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user, one role each)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null,
  email text,
  phone text,
  role public.app_role not null,
  team public.team not null,
  manager_id uuid references public.profiles (id),
  project_types public.project_type[] not null default '{}',
  avatar_path text,
  active boolean not null default true,
  digest_mode boolean not null default false,   -- daily digest instead of individual non-critical pushes
  notification_prefs jsonb not null default '{}'::jsonb,
  can_see_commercial boolean not null default false, -- sys_admin only, when granted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now()
);

-- Role helpers ---------------------------------------------------------------
create or replace function app.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function app.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app.my_role() = any (roles), false)
$$;

create or replace function app.is_sales_person() returns boolean
language sql stable as $$ select app.has_role('asm_building', 'asm_infra') $$;

create or replace function app.is_estimator() returns boolean
language sql stable as $$ select app.has_role('am_estimation', 'estimation_exec') $$;

create or replace function app.is_designer() returns boolean
language sql stable as $$ select app.has_role('lighting_designer', 'lighting_engineer') $$;

create or replace function app.my_project_types() returns public.project_type[]
language sql stable security definer set search_path = public as $$
  select project_types from public.profiles where id = auth.uid()
$$;

create or replace function app.users_with_role(r public.app_role) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where role = r and active
$$;

create or replace function app.building_types() returns public.project_type[]
language sql immutable as $$ select array['hospitality','retail','institutions','commercial']::public.project_type[] $$;

create or replace function app.infra_types() returns public.project_type[]
language sql immutable as $$ select array['infrastructure','industrial']::public.project_type[] $$;

create or replace function app.team_for_role(r public.app_role) returns public.team
language sql immutable as $$
  select case
    when r = 'gm' then 'management'
    when r in ('sm_projects','asm_building','asm_infra') then 'sales'
    when r in ('design_manager','lighting_designer','lighting_engineer') then 'design'
    when r in ('sm_estimation','am_estimation','estimation_exec') then 'estimation'
    when r = 'operations_exec' then 'operations'
    else 'it' end::public.team
$$;

-- Keep team and default project types consistent with the role.
create or replace function app.profiles_defaults() returns trigger
language plpgsql as $$
begin
  new.team := app.team_for_role(new.role);
  if new.project_types = '{}' then
    new.project_types := case new.role
      when 'asm_building' then app.building_types()
      when 'estimation_exec' then app.building_types()
      when 'asm_infra' then app.infra_types()
      when 'am_estimation' then app.infra_types()
      else '{}' end;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_defaults before insert or update on public.profiles
for each row execute function app.profiles_defaults();

-- Users may only change their picture and notification preferences (Section 2).
create or replace function app.profiles_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null or app.has_role('sys_admin', 'gm') then
    return new;
  end if;
  if new.id <> auth.uid() then
    raise exception 'You can only edit your own profile';
  end if;
  if (new.full_name, new.role, new.manager_id, new.active, new.project_types, new.can_see_commercial)
     is distinct from (old.full_name, old.role, old.manager_id, old.active, old.project_types, old.can_see_commercial) then
    raise exception 'Name, role and reporting line are maintained by the System Administrator';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
for each row execute function app.profiles_guard();

-- ---------------------------------------------------------------------------
-- Settings, calendar and master data
-- ---------------------------------------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create table public.holidays (
  day date primary key,
  name text not null
);

create table public.exchange_rates (
  month date primary key check (extract(day from month) = 1),
  usd_to_lkr numeric(12, 4) not null check (usd_to_lkr > 0),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

-- Dropdown values (Section 4.1). list_name examples:
-- visit_category, visit_objective, visit_outcome, project_stage, missed_reason,
-- lost_reason, tender_activity, delay_reason, hold_reason, sample_purpose.
create table public.master_lists (
  id bigint generated always as identity primary key,
  list_name text not null,
  value text not null,
  grp text,
  tags text[] not null default '{}',
  active boolean not null default true,
  sort_order int not null default 0,
  unique (list_name, value)
);

create table public.brands (
  id bigint generated always as identity primary key,
  name text not null unique,
  manufacturer text,
  country text,
  origin text not null default 'other' check (origin in ('european', 'chinese', 'other')),
  level text not null default 'medium' check (level in ('high', 'medium', 'low')),
  active boolean not null default true
);

create table public.competitors (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  created_by uuid references public.profiles (id)
);

create or replace function app.setting(k text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.settings where key = k
$$;

create or replace function app.setting_num(k text, fallback numeric) returns numeric
language sql stable as $$ select coalesce((app.setting(k) #>> '{}')::numeric, fallback) $$;

-- ---------------------------------------------------------------------------
-- Human-readable codes: VIS-2026-00001, INQ-2026-00001, QTN-2026-00001, ...
-- ---------------------------------------------------------------------------
create table app.code_counters (
  prefix text not null,
  year int not null,
  last_value int not null default 0,
  primary key (prefix, year)
);

create or replace function app.next_code(p_prefix text) returns text
language plpgsql security definer set search_path = app, public as $$
declare
  y int := extract(year from (now() at time zone 'Asia/Colombo'))::int;
  v int;
begin
  insert into app.code_counters as c (prefix, year, last_value) values (p_prefix, y, 1)
  on conflict on constraint code_counters_pkey do update set last_value = c.last_value + 1
  returning c.last_value into v;
  return format('%s-%s-%s', p_prefix, y, lpad(v::text, 5, '0'));
end $$;

-- Text normalisation used by duplicate checks (Section 5.6).
create or replace function app.normalize_name(t text) returns text
language sql immutable as $$
  select trim(regexp_replace(
    regexp_replace(lower(coalesce(t, '')), '\m(project|proposed|new|the|pvt|ltd|limited|plc|private)\M', ' ', 'g'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Audit log and status history (Sections 8.5, 10.3)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  table_name text not null,
  record_id text not null,
  action text not null,
  old_data jsonb,
  new_data jsonb
);
create index on public.audit_log (table_name, record_id);

create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (table_name, record_id, action, old_data, new_data)
  values (tg_table_name,
          coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id', to_jsonb(new) ->> 'key', to_jsonb(old) ->> 'key',
                   to_jsonb(new) ->> 'stage', to_jsonb(old) ->> 'stage', to_jsonb(new) ->> 'estimation_job_id', '-'),
          tg_op,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create table public.status_history (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  inquiry_id uuid,
  from_status text,
  to_status text not null,
  user_id uuid default auth.uid(),
  at timestamptz not null default now(),
  reason text
);
create index on public.status_history (entity_type, entity_id, at);
create index on public.status_history (inquiry_id, at);

create or replace function app.log_status(
  p_entity_type text, p_entity_id uuid, p_inquiry_id uuid, p_from text, p_to text, p_reason text default null
) returns void language sql security definer set search_path = public as $$
  insert into public.status_history (entity_type, entity_id, inquiry_id, from_status, to_status, reason)
  values (p_entity_type, p_entity_id, p_inquiry_id, p_from, p_to, p_reason);
$$;

-- No hard delete of core records (Section 10.3 – archive only).
create or replace function app.prevent_delete() returns trigger
language plpgsql as $$
begin
  raise exception '% records cannot be deleted; archive them instead', tg_table_name;
end $$;

-- ---------------------------------------------------------------------------
-- Attachments (files live in the private "files" storage bucket)
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,   -- visit, inquiry, design_job, estimation_job, quotation, clarification, tender, sample, debt_upload, debt
  entity_id uuid not null,
  kind text not null,          -- see app.attachment_kinds in the RLS migration
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes <= 52428800), -- 50 MB (Section 7.5)
  version int not null default 1,
  uploaded_by uuid not null default auth.uid() references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  archived_at timestamptz
);
create index on public.attachments (entity_type, entity_id);

create table public.download_log (
  id bigint generated always as identity primary key,
  attachment_id uuid references public.attachments (id),
  user_id uuid not null default auth.uid(),
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Notifications (push + in-app only; Section 8.4 / 8.7)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id),
  kind text not null,
  title text not null,
  body text not null,
  priority public.priority not null default 'normal',
  entity_type text,
  entity_id uuid,
  url text,                              -- in-app route, e.g. /inquiries/<id>
  dedupe_key text,                       -- prevents the same alert firing twice
  requires_open boolean not null default false, -- overdue / approval items: re-sent once if unopened for 2 working hours
  created_at timestamptz not null default now(),
  deliver_after timestamptz not null default now(), -- quiet hours hold
  pushed_at timestamptz,
  resent_at timestamptz,
  read_at timestamptz,
  unique (recipient_id, dedupe_key)
);
create index on public.notifications (recipient_id, read_at, created_at desc);
create index notifications_outbox on public.notifications (deliver_after) where pushed_at is null;

-- ---------------------------------------------------------------------------
-- Approvals (Section 8.6)
-- ---------------------------------------------------------------------------
create type public.approval_kind as enum (
  'weekly_plan', 'duplicate_visit', 'account_ownership', 'release_mode', 'mixed_duty',
  'duty_change', 'expectation_change', 'early_design_release', 'design_release',
  'quotation_release', 'estimation_hold', 'debtor_check', 'kpi_targets', 'team_targets',
  'scorecard_correction', 'sample_request', 'sample_return_date', 'settings_change'
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  kind public.approval_kind not null,
  entity_type text not null,
  entity_id uuid not null,
  inquiry_id uuid,
  title text not null,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  requested_by uuid default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'returned', 'cancelled')),
  current_step int not null default 1,
  decided_at timestamptz
);
create index on public.approvals (entity_type, entity_id);

create table public.approval_steps (
  approval_id uuid not null references public.approvals (id) on delete cascade,
  step_no int not null,
  approver_role public.app_role not null,
  approver_id uuid references public.profiles (id), -- set when a specific person must decide
  decision text check (decision in ('approved', 'rejected', 'returned')),
  comment text,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  primary key (approval_id, step_no)
);

-- Report runs and downloads are logged (Section 9.7)
create table public.report_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id),
  report_key text not null,
  filters jsonb not null default '{}'::jsonb,
  format text not null check (format in ('preview', 'pdf', 'xlsx')),
  at timestamptz not null default now()
);

create trigger audit_profiles after insert or update on public.profiles for each row execute function app.audit();
create trigger audit_settings after insert or update or delete on public.settings for each row execute function app.audit();
create trigger audit_master after insert or update or delete on public.master_lists for each row execute function app.audit();
