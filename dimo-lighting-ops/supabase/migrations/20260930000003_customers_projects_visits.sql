-- Module 1 – Customers, projects, weekly plans, visits and tenders (SRS Section 4).

-- ---------------------------------------------------------------------------
-- Customer profiles: organization → units (up to 3 levels) → contacts (4.9)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_norm text generated always as (app.normalize_name(name)) stored,
  visit_category text not null,           -- master_lists: visit_category
  address text,
  phone text,
  email text,
  account_owner_id uuid references public.profiles (id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  merged_into uuid references public.organizations (id),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index organizations_name_trgm on public.organizations using gin (name_norm extensions.gin_trgm_ops);

create table public.org_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  parent_unit_id uuid references public.org_units (id),
  name text not null,
  unit_type text not null default 'department' check (unit_type in ('department', 'division', 'branch', 'site')),
  address text,
  account_owner_id uuid references public.profiles (id), -- override set by SM Projects
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.org_units (organization_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  unit_id uuid references public.org_units (id),
  name text not null,
  designation text,
  phone text,
  email text,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.contacts (organization_id);

create or replace function app.unit_depth_check() returns trigger
language plpgsql as $$
declare depth int := 1; p uuid := new.parent_unit_id;
begin
  while p is not null loop
    depth := depth + 1;
    if depth > 3 then raise exception 'Units can be nested up to 3 levels'; end if;
    select parent_unit_id into p from public.org_units where id = p;
  end loop;
  return new;
end $$;
create trigger org_units_depth before insert or update on public.org_units
for each row execute function app.unit_depth_check();

-- Name/type edits and ownership changes: SM Projects and GM only (4.5, 4.9)
create or replace function app.organizations_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.account_owner_id is null and app.is_sales_person() then new.account_owner_id := auth.uid(); end if;
    return new;
  end if;
  if (new.name, new.visit_category, new.merged_into) is distinct from (old.name, old.visit_category, old.merged_into)
     or new.account_owner_id is distinct from old.account_owner_id then
    if not app.has_role('sm_projects', 'gm') then
      raise exception 'Only SM Projects or GM / DGM can rename, re-type, merge or change the owner of an organization';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger organizations_guard before insert or update on public.organizations
for each row execute function app.organizations_guard();
create trigger audit_organizations after insert or update on public.organizations for each row execute function app.audit();
create trigger no_delete_organizations before delete on public.organizations for each row execute function app.prevent_delete();

-- Owner of an organization / unit (unit override wins)
create or replace function app.account_owner(p_org uuid, p_unit uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select account_owner_id from public.org_units where id = p_unit),
                  (select account_owner_id from public.organizations where id = p_org))
$$;

-- ---------------------------------------------------------------------------
-- Projects (4.7, 4.9, 4.10, 5.6)
-- ---------------------------------------------------------------------------
create type public.pipeline_milestone as enum (
  'lead_identified', 'design_involvement', 'brand_specified', 'quotation_submitted',
  'negotiating', 'loa_expected', 'won', 'lost'
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  name_norm text generated always as (app.normalize_name(name)) stored,
  project_type public.project_type not null,
  organization_id uuid not null references public.organizations (id),
  unit_id uuid references public.org_units (id),
  location text,
  city text,
  lat double precision,
  lng double precision,
  stage text not null default 'Concept',         -- master_lists: project_stage
  milestone public.pipeline_milestone not null default 'lead_identified',
  win_probability int not null default 10 check (win_probability between 0 and 100),
  spec_status text not null default 'not_specified'
    check (spec_status in ('not_specified', 'our_brand', 'competitor', 'open')),
  duty_status public.duty_status,
  currency public.currency not null default 'LKR',
  project_value numeric(16, 2),
  lighting_value numeric(16, 2),
  expected_duration_months int not null check (expected_duration_months > 0),
  project_term text not null check (project_term in ('short', 'medium', 'long')),
  expected_tender_date date,
  expected_award_date date,
  owner_id uuid not null references public.profiles (id),
  status text not null default 'active'
    check (status in ('active', 'dormant', 'on_hold', 'won', 'completed', 'lost', 'cancelled')),
  status_reason text,
  on_hold_review_date date,
  dormant_since date,
  first_visit_due date,
  duplicate_override_reason text,
  last_activity_at timestamptz not null default now(),
  last_probability_review_at timestamptz not null default now(),
  merged_into uuid references public.projects (id),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_name_trgm on public.projects using gin (name_norm extensions.gin_trgm_ops);
create index on public.projects (owner_id, status);
create index on public.projects (organization_id);

create table public.project_log (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id),
  field text not null,          -- win_probability, project_term, expected_duration_months, owner_id, status, ...
  old_value text,
  new_value text,
  reason text,
  user_id uuid default auth.uid(),
  at timestamptz not null default now()
);
create index on public.project_log (project_id, at);

create table public.project_stakeholders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  organization_id uuid not null references public.organizations (id),
  unit_id uuid references public.org_units (id),
  contact_id uuid references public.contacts (id),
  category text not null,  -- visit_category (End-Client, Architect, MEP Consultant, ...)
  created_at timestamptz not null default now(),
  unique (project_id, organization_id, category)
);

-- Stage-based probability defaults and bands (4.7)
create or replace function app.probability_band(m public.pipeline_milestone, out def int, out lo int, out hi int)
language sql immutable as $$
  select d, l, h from (values
    ('lead_identified'::public.pipeline_milestone, 10, 5, 20),
    ('design_involvement', 25, 15, 40),
    ('brand_specified', 50, 40, 65),
    ('quotation_submitted', 40, 20, 60),
    ('negotiating', 70, 60, 85),
    ('loa_expected', 90, 85, 95),
    ('won', 100, 100, 100),
    ('lost', 0, 0, 0)
  ) b(k, d, l, h) where k = m
$$;

create or replace function app.term_for_duration(months int) returns text
language sql stable as $$
  select case
    when months <= app.setting_num('term_short_max_months', 6) then 'short'
    when months <= app.setting_num('term_medium_max_months', 18) then 'medium'
    else 'long' end
$$;

-- Reason passed from RPCs / the app for logged changes: select set_config('app.reason', '...', true)
create or replace function app.change_reason() returns text
language sql stable as $$ select nullif(current_setting('app.reason', true), '') $$;

create or replace function app.projects_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  band record;
  suggested text;
begin
  if tg_op = 'INSERT' then
    new.code := coalesce(new.code, app.next_code('PRJ'));
    if auth.uid() is not null then
      if app.is_sales_person() then
        if not (new.project_type = any (app.my_project_types())) then
          raise exception 'You can only create projects for your own project types';
        end if;
        new.owner_id := auth.uid();
      elsif app.has_role('sm_projects', 'gm') then
        if new.owner_id is null then raise exception 'Assign a sales person before saving the project'; end if;
        if not exists (select 1 from public.profiles where id = new.owner_id and role in ('asm_building', 'asm_infra') and active) then
          raise exception 'The project owner must be an active sales person';
        end if;
        new.first_visit_due := coalesce(new.first_visit_due, app.add_work_minutes(now(), 5 * app.working_minutes_per_day())::date);
      else
        raise exception 'Only sales people, SM Projects and GM / DGM can create projects';
      end if;
    end if;
    -- Exact duplicate on name + customer is blocked (5.6)
    if exists (select 1 from public.projects p where p.name_norm = app.normalize_name(new.name)
               and p.organization_id = new.organization_id and p.merged_into is null) then
      raise exception 'A project with this name already exists for this customer. Select the existing project instead.';
    end if;
    suggested := app.term_for_duration(new.expected_duration_months);
    if new.project_term is null then new.project_term := suggested;
    elsif new.project_term <> suggested and app.change_reason() is null then
      raise exception 'Project term differs from the suggested term (%): give a reason', suggested;
    end if;
    new.expected_award_date := coalesce(new.expected_award_date,
      (now() at time zone app.tz())::date + make_interval(months => new.expected_duration_months));
    select * into band from app.probability_band(new.milestone);
    if new.win_probability is null or new.win_probability = 10 then new.win_probability := band.def; end if;
    return new;
  end if;

  -- UPDATE
  if new.milestone is distinct from old.milestone then
    select * into band from app.probability_band(new.milestone);
    if new.win_probability = old.win_probability then new.win_probability := band.def; end if;
    if new.milestone = 'won' then new.status := 'won'; end if;
    if new.milestone = 'lost' then new.status := 'lost'; end if;
  end if;
  if new.win_probability is distinct from old.win_probability then
    select * into band from app.probability_band(new.milestone);
    if (new.win_probability < band.lo or new.win_probability > band.hi) and app.change_reason() is null then
      raise exception 'Win probability % is outside the %–%%% band for this stage: give a reason', new.win_probability, band.lo, band.hi;
    end if;
    new.last_probability_review_at := now();
  end if;
  if new.expected_duration_months is distinct from old.expected_duration_months and new.project_term = old.project_term then
    new.project_term := app.term_for_duration(new.expected_duration_months);
  end if;
  if new.owner_id is distinct from old.owner_id and auth.uid() is not null and not app.has_role('sm_projects', 'gm') then
    raise exception 'Only SM Projects or GM / DGM can reassign a project';
  end if;
  if new.name is distinct from old.name and auth.uid() is not null and not app.has_role('sm_projects', 'gm')
     and old.owner_id <> auth.uid() then
    raise exception 'Only the owner, SM Projects or GM / DGM can rename a project';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger projects_before before insert or update on public.projects
for each row execute function app.projects_before();

create or replace function app.projects_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f text;
  logged text[] := array['win_probability', 'milestone', 'stage', 'project_term', 'expected_duration_months',
                         'expected_award_date', 'owner_id', 'status', 'project_value', 'lighting_value', 'spec_status'];
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  n jsonb := to_jsonb(new);
begin
  foreach f in array logged loop
    if tg_op = 'UPDATE' and (o ->> f) is distinct from (n ->> f) then
      insert into public.project_log (project_id, field, old_value, new_value, reason)
      values (new.id, f, o ->> f, n ->> f, app.change_reason());
    end if;
  end loop;

  -- Project created by a manager → notify the assigned sales person (4.9)
  if tg_op = 'INSERT' and auth.uid() is not null and new.owner_id <> auth.uid() then
    perform app.notify(new.owner_id, 'project_assigned', 'New project assigned',
      format('%s – %s. First visit due %s.', new.name,
             (select name from public.organizations where id = new.organization_id), new.first_visit_due),
      'normal', 'project', new.id, '/projects/' || new.id);
  end if;
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    perform app.notify(new.owner_id, 'project_assigned', 'Project assigned to you', new.name, 'normal', 'project', new.id, '/projects/' || new.id);
    perform app.notify(old.owner_id, 'project_reassigned', 'Project reassigned',
      format('%s is now handled by %s', new.name, app.display_name(new.owner_id)), 'normal', 'project', new.id, '/projects/' || new.id);
  end if;
  if tg_op = 'UPDATE' and new.win_probability is distinct from old.win_probability
     and auth.uid() is not null and auth.uid() <> new.owner_id then
    perform app.notify(new.owner_id, 'probability_override', 'Win probability changed',
      format('%s: %s%% → %s%% by %s. %s', new.name, old.win_probability, new.win_probability,
             app.display_name(auth.uid()), coalesce(app.change_reason(), '')),
      'normal', 'project', new.id, '/projects/' || new.id);
  end if;
  return new;
end $$;
create trigger projects_after after insert or update on public.projects
for each row execute function app.projects_after();
create trigger no_delete_projects before delete on public.projects for each row execute function app.prevent_delete();

-- Similar projects for the duplicate check (5.6): similar name, same customer, or within 1 km
create or replace function app.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select case when lat1 is null or lat2 is null then null else
    2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
      + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))) end
$$;

create or replace function public.find_similar_projects(
  p_name text, p_organization_id uuid default null, p_lat double precision default null, p_lng double precision default null
) returns table (id uuid, code text, name text, customer text, stage text, owner text, open_inquiries bigint,
                 similarity real, exact boolean, distance_m double precision)
language plpgsql stable security definer set search_path = public as $$
declare n text := app.normalize_name(p_name);
begin
  if not app.has_role('asm_building', 'asm_infra', 'sm_projects', 'gm', 'sm_estimation') then return; end if;
  return query
  select p.id, p.code, p.name, o.name, p.stage, app.display_name(p.owner_id),
         (select count(*) from public.inquiries i where i.project_id = p.id
            and i.status not in ('won', 'lost', 'cancelled', 'draft')),
         extensions.similarity(p.name_norm, n),
         (p.name_norm = n and p.organization_id is not distinct from p_organization_id),
         app.distance_m(p.lat, p.lng, p_lat, p_lng)
  from public.projects p
  join public.organizations o on o.id = p.organization_id
  where p.merged_into is null
    and (extensions.similarity(p.name_norm, n) > 0.35
         or (p_organization_id is not null and p.organization_id = p_organization_id
             and extensions.similarity(p.name_norm, n) > 0.2)
         or coalesce(app.distance_m(p.lat, p.lng, p_lat, p_lng), 1e9) < 1000)
  order by 9 desc, 8 desc
  limit 10;
end $$;

-- ---------------------------------------------------------------------------
-- Weekly visit plans (4.4)
-- ---------------------------------------------------------------------------
create table public.visit_plans (
  id uuid primary key default gen_random_uuid(),
  sales_person_id uuid not null default auth.uid() references public.profiles (id),
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'returned')),
  version int not null default 1,
  submitted_at timestamptz,
  is_late boolean not null default false,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  manager_comment text,
  rating int check (rating between 1 and 5),
  evaluation_comment text,
  evaluated_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (sales_person_id, week_start)
);

create table public.visit_plan_lines (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.visit_plans (id) on delete cascade,
  planned_date date not null,
  time_slot text,
  project_id uuid references public.projects (id),
  organization_id uuid not null references public.organizations (id),
  unit_id uuid references public.org_units (id),
  contact_id uuid references public.contacts (id),
  visit_category text not null,
  planned_objective text not null,
  location text,
  lat double precision,
  lng double precision,
  visit_type text not null default 'normal' check (visit_type in ('normal', 'tender')),
  tender_activity text,
  status text not null default 'planned' check (status in ('planned', 'completed', 'rescheduled', 'cancelled', 'missed')),
  change_reason text,
  missed_reason text,
  added_after_approval boolean not null default false,
  joint_visit_approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.visit_plan_lines (plan_id, planned_date);
create trigger audit_plan_lines after insert or update or delete on public.visit_plan_lines for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Visits (4.2, 4.3). The app generates the id so offline visits sync idempotently.
-- ---------------------------------------------------------------------------
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  sales_person_id uuid not null default auth.uid() references public.profiles (id),
  plan_line_id uuid references public.visit_plan_lines (id),
  project_id uuid references public.projects (id),
  organization_id uuid not null references public.organizations (id),
  unit_id uuid references public.org_units (id),
  contact_id uuid references public.contacts (id),
  project_type public.project_type,
  visit_category text not null,
  primary_objective text not null,
  secondary_objectives text[] not null default '{}' check (cardinality(secondary_objectives) <= 3),
  visit_type text not null default 'normal' check (visit_type in ('normal', 'tender')),
  tender_activity text,
  tender_no text,
  tender_date date,
  unplanned boolean not null default false,
  planned_at timestamptz,
  checkin_at timestamptz not null default now(),   -- device time at capture (offline mode)
  checkin_lat double precision,
  checkin_lng double precision,
  checkout_at timestamptz,
  checkout_lat double precision,
  checkout_lng double precision,
  distance_from_site_m double precision,
  gps_verified boolean,
  summary text,
  outcome text,
  competitors_mentioned text[] not null default '{}',
  brands_specified text,
  est_project_value numeric(16, 2),
  est_lighting_value numeric(16, 2),
  currency public.currency not null default 'LKR',
  next_action text,
  next_action_date date,
  next_action_done_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_comment text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on public.visits (sales_person_id, checkin_at desc);
create index on public.visits (project_id);
create index on public.visits (organization_id, checkin_at desc);
create trigger no_delete_visits before delete on public.visits for each row execute function app.prevent_delete();

create or replace function app.visits_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  site_lat double precision;
  site_lng double precision;
  radius numeric := app.setting_num('gps_radius_m', 500);
begin
  if tg_op = 'INSERT' then
    new.code := coalesce(new.code, app.next_code('VIS'));
    if auth.uid() is not null and app.is_sales_person() then new.sales_person_id := auth.uid(); end if;
    new.unplanned := new.plan_line_id is null;
    if new.project_id is null and new.primary_objective not in (select value from public.master_lists
         where list_name = 'visit_objective' and 'networking' = any (tags)) then
      raise exception 'Select a project (only networking visits can be recorded without one)';
    end if;
    if new.project_id is not null then
      select project_type into new.project_type from public.projects where id = new.project_id;
    end if;
    if new.project_type is not null and auth.uid() is not null and app.is_sales_person()
       and not (new.project_type = any (app.my_project_types())) then
      raise exception 'This project type is outside your territory';
    end if;
  end if;

  -- Distance from the planned location (or the project site) at check-in
  if new.checkin_lat is not null and (tg_op = 'INSERT' or new.checkin_lat is distinct from old.checkin_lat) then
    select lat, lng into site_lat, site_lng from public.visit_plan_lines where id = new.plan_line_id and lat is not null;
    if site_lat is null then select lat, lng into site_lat, site_lng from public.projects where id = new.project_id; end if;
    new.distance_from_site_m := app.distance_m(new.checkin_lat, new.checkin_lng, site_lat, site_lng);
    new.gps_verified := case when new.distance_from_site_m is null then null else new.distance_from_site_m <= radius end;
  end if;

  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
    if length(coalesce(new.summary, '')) < 30 then
      raise exception 'Discussion summary must be at least 30 characters';
    end if;
    if new.outcome is null then raise exception 'Select the visit outcome'; end if;
    if new.visit_type = 'tender' and new.tender_activity in ('Bid Submission', 'Tender Opening / Bid Opening')
       and not exists (select 1 from public.tenders t where t.visit_id = new.id) then
      raise exception 'Record the tender result before closing this visit';
    end if;
    new.closed_at := now();
    new.checkout_at := coalesce(new.checkout_at, now());
  end if;
  if tg_op = 'UPDATE' and old.status = 'closed' and auth.uid() is not null
     and not app.has_role('sm_projects', 'gm')
     and (new.summary, new.outcome, new.primary_objective, new.checkin_at, new.checkin_lat)
         is distinct from (old.summary, old.outcome, old.primary_objective, old.checkin_at, old.checkin_lat) then
    raise exception 'A closed visit can only be edited by SM Projects';
  end if;
  return new;
end $$;
create trigger visits_before before insert or update on public.visits
for each row execute function app.visits_before();

create or replace function app.visits_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  org_name text;
  last_same record;
begin
  if new.project_id is not null then
    update public.projects set last_activity_at = greatest(last_activity_at, new.checkin_at),
      dormant_since = null, status = case when status = 'dormant' then 'active' else status end
    where id = new.project_id;
    insert into public.project_stakeholders (project_id, organization_id, unit_id, contact_id, category)
    values (new.project_id, new.organization_id, new.unit_id, new.contact_id, new.visit_category)
    on conflict do nothing;
  end if;
  if new.plan_line_id is not null then
    update public.visit_plan_lines set status = 'completed' where id = new.plan_line_id and status = 'planned';
  end if;

  if tg_op = 'INSERT' then
    -- Duplicate customer visit control (4.5)
    owner := app.account_owner(new.organization_id, new.unit_id);
    select name into org_name from public.organizations where id = new.organization_id;
    if owner is not null and owner <> new.sales_person_id
       and not exists (select 1 from public.visit_plan_lines l where l.id = new.plan_line_id and l.joint_visit_approved) then
      perform app.notify_many(app.role_users('sm_projects'), 'duplicate_visit', 'Duplicate customer visit',
        format('%s checked in at %s (account owner: %s) on %s', app.display_name(new.sales_person_id), org_name,
               app.display_name(owner), to_char(new.checkin_at at time zone app.tz(), 'DD Mon')),
        'normal', 'visit', new.id, '/visits/' || new.id);
      insert into public.approvals (kind, entity_type, entity_id, title, reason, requested_by, payload)
      values ('duplicate_visit', 'visit', new.id, format('Duplicate visit – %s', org_name),
              'Visit to a customer owned by another sales person', new.sales_person_id,
              jsonb_build_object('owner_id', owner, 'visitor_id', new.sales_person_id, 'organization_id', new.organization_id));
      insert into public.approval_steps (approval_id, step_no, approver_role)
      select id, 1, 'sm_projects' from public.approvals where entity_type = 'visit' and entity_id = new.id and kind = 'duplicate_visit';
    end if;
    -- Repeat visit within N days with no new objective (4.5)
    select v.* into last_same from public.visits v
      where v.sales_person_id = new.sales_person_id and v.organization_id = new.organization_id and v.id <> new.id
        and v.checkin_at > new.checkin_at - make_interval(days => app.setting_num('repeat_visit_days', 7)::int)
        and v.primary_objective = new.primary_objective
      order by v.checkin_at desc limit 1;
    if found then
      perform app.notify_many(app.role_users('sm_projects'), 'repeat_visit', 'Possible unproductive visit',
        format('%s visited %s again with the same objective (%s)', app.display_name(new.sales_person_id), org_name, new.primary_objective),
        'normal', 'visit', new.id, '/visits/' || new.id);
    end if;
  end if;
  return new;
end $$;
create trigger visits_after after insert or update on public.visits
for each row execute function app.visits_after();

-- ---------------------------------------------------------------------------
-- Tenders – inside visits (4.8)
-- ---------------------------------------------------------------------------
create table public.tenders (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid unique references public.visits (id),
  project_id uuid not null references public.projects (id),
  sales_person_id uuid not null default auth.uid() references public.profiles (id),
  tender_no text not null,
  tender_name text not null,
  client_organization_id uuid not null references public.organizations (id),
  tender_type text not null check (tender_type in ('open', 'selective', 'negotiated', 're_tender')),
  duty_status public.duty_status not null,
  currency public.currency generated always as (case when duty_status = 'duty_free' then 'USD'::public.currency else 'LKR'::public.currency end) stored,
  closing_date date not null,
  opening_date date not null,
  our_price numeric(16, 2),
  our_brands text[] not null default '{}',
  delivery_period text,
  validity text,
  quotation_id uuid,
  result_status text not null default 'opened'
    check (result_status in ('opened', 'awarded_to_us', 'awarded_to_competitor', 'cancelled', 're_tender')),
  lost_reason text,
  evaluation_notes text,
  next_action text,
  next_action_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.tenders (project_id);
create trigger audit_tenders after insert or update on public.tenders for each row execute function app.audit();

create table public.tender_bids (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references public.tenders (id) on delete cascade,
  competitor_id bigint not null references public.competitors (id),
  bid_price numeric(16, 2) not null,
  brands text[] not null default '{}',
  compliant boolean not null default true,
  remarks text
);

-- Ranking: our position (L1, L2, …), lowest bid, difference from L1
create or replace view public.tender_rankings with (security_invoker = true) as
select t.id as tender_id,
       1 + (select count(*) from public.tender_bids b where b.tender_id = t.id and b.compliant and b.bid_price < t.our_price) as our_rank,
       least(t.our_price, (select min(bid_price) from public.tender_bids b where b.tender_id = t.id and b.compliant)) as lowest_bid,
       t.our_price - least(t.our_price, (select min(bid_price) from public.tender_bids b where b.tender_id = t.id and b.compliant)) as diff_from_l1,
       case when t.our_price > 0 then round(100 * (t.our_price - least(t.our_price,
         (select min(bid_price) from public.tender_bids b where b.tender_id = t.id and b.compliant))) / t.our_price, 2) end as diff_pct
from public.tenders t;

-- Tender result updates the project (stage / probability / result)
create or replace function app.tenders_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare rank int;
begin
  perform set_config('app.reason', 'Tender result ' || new.tender_no, true);
  if new.result_status = 'awarded_to_us' then
    update public.projects set stage = 'Award', milestone = 'won' where id = new.project_id;
  elsif new.result_status = 'awarded_to_competitor' then
    update public.projects set stage = 'Award', milestone = 'lost',
      status_reason = coalesce(new.lost_reason, 'Price') where id = new.project_id;
  elsif new.result_status = 'opened' then
    select our_rank into rank from public.tender_rankings where tender_id = new.id;
    if rank = 1 then
      update public.projects set milestone = 'negotiating' where id = new.project_id
        and milestone in ('lead_identified', 'design_involvement', 'brand_specified', 'quotation_submitted');
    end if;
  end if;
  perform set_config('app.reason', '', true);
  return null;
end $$;
create trigger tenders_after after insert or update of result_status, our_price on public.tenders
for each row execute function app.tenders_after();

-- ---------------------------------------------------------------------------
-- Transfer of accounts when a sales person leaves or changes role (Section 2)
-- ---------------------------------------------------------------------------
create or replace function public.transfer_accounts(p_from uuid, p_to uuid, p_deactivate boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_org int; n_unit int; n_proj int; n_lines int;
begin
  if not app.has_role('sm_projects', 'gm') then raise exception 'Only SM Projects or GM / DGM can transfer accounts'; end if;
  if not exists (select 1 from public.profiles where id = p_to and role in ('asm_building', 'asm_infra') and active) then
    raise exception 'Receiving user must be an active sales person';
  end if;
  perform set_config('app.reason', 'Account transfer', true);
  perform set_config('app.workflow', '1', true);
  update public.organizations set account_owner_id = p_to where account_owner_id = p_from; get diagnostics n_org = row_count;
  update public.org_units set account_owner_id = p_to where account_owner_id = p_from; get diagnostics n_unit = row_count;
  update public.projects set owner_id = p_to where owner_id = p_from and status not in ('won', 'completed', 'lost', 'cancelled');
  get diagnostics n_proj = row_count;
  update public.inquiries set sales_person_id = p_to
    where sales_person_id = p_from and status not in ('won', 'lost', 'cancelled');
  update public.debts set sales_person_id = p_to where sales_person_id = p_from and status not in ('collected_confirmed', 'cleared');
  update public.visit_plan_lines l set status = 'cancelled', change_reason = 'Account transferred'
    from public.visit_plans p where p.id = l.plan_id and p.sales_person_id = p_from and l.status = 'planned';
  get diagnostics n_lines = row_count;
  if p_deactivate then update public.profiles set active = false where id = p_from; end if;
  perform app.notify(p_to, 'account_transfer', 'Accounts transferred to you',
    format('%s organizations, %s units and %s projects from %s', n_org, n_unit, n_proj, app.display_name(p_from)),
    'normal', null, null, '/projects');
  return jsonb_build_object('organizations', n_org, 'units', n_unit, 'projects', n_proj, 'cancelled_plan_lines', n_lines);
end $$;
