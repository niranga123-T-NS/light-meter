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
