-- Execution module – step 1: execution projects, project team, temporary staff and subcontractor supervisor access.
--  * The Senior Electrical Engineer (or SM Projects) starts execution on a project: project areas (any of the 18), site, dates.
--  * Team: Assistant Engineers (permanent or temporary) and Trainees are added by the Senior Electrical Engineer;
--    subcontractor supervisors only through an approved appointment (one approval per project).
--  * Temporary Assistant Engineer / Trainee: requested by the SEE → SM Projects → DGM / GM; the login is created after the
--    last approval. Deleting one: every open item must first be reassigned; then SM Projects → DGM / GM; access ends at once.
--  * Subcontractor supervisor: nominated by the SEE → SM Projects; login created after approval (mobile number as user name);
--    removed by the SEE (SM Projects told) or automatically at the end of the validity period.
--  * Logins of removed people are blocked by the push-dispatch job (revoke_pending); data access stops at once because
--    every policy and RPC checks the active profile / active membership.
--  * External users (subcontractor supervisors) never read profiles of other companies, settings or targets.

alter table public.profiles
  add column if not exists is_temporary boolean not null default false,
  add column if not exists access_until date,
  add column if not exists company text,
  add column if not exists id_no text,
  add column if not exists revoke_pending boolean not null default false,
  add column if not exists banned_at timestamptz;

create or replace function app.team_for_role(r public.app_role) returns public.team
language sql immutable as $$
  select case
    when r = 'gm' then 'management'
    when r in ('sm_projects','asm_building','asm_infra') then 'sales'
    when r in ('design_manager','lighting_designer','lighting_engineer') then 'design'
    when r in ('sm_estimation','am_estimation','estimation_exec') then 'estimation'
    when r = 'operations_exec' then 'operations'
    when r in ('senior_elec_engineer','assistant_engineer','trainee','sub_supervisor') then 'execution'
    else 'it' end::public.team
$$;

-- The 18 project areas in five families (template packs)
create or replace function app.exec_areas() returns text[] language sql immutable as $$
  select array['indoor', 'outdoor', 'facade', 'emergency', 'central_battery', 'electrical', 'underground_cabling', 'lighting_control',
               'lighting_measurement', 'road', 'tunnel', 'sports', 'port', 'agl', 'apron', 'vdgs', 'alcms', 'smgcs']
$$;

create or replace function app.is_exec_lead() returns boolean language sql stable as $$
  select app.has_role('senior_elec_engineer', 'sm_projects', 'gm')
$$;
create or replace function app.is_external() returns boolean language sql stable as $$
  select coalesce(app.my_role() = 'sub_supervisor', false)
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.exec_projects (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects (id),
  code text unique,
  name text not null,
  areas text[] not null default '{}',
  stage int not null default 1 check (stage between 1 and 6),
  status text not null default 'active' check (status in ('active', 'closed')),
  see_id uuid references public.profiles (id),
  site_address text,
  lat double precision,
  lng double precision,
  start_date date,
  end_date date,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exec_areas_valid check (areas <@ app.exec_areas())
);

create table public.exec_members (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  member_role text not null check (member_role in ('assistant_engineer', 'trainee', 'sub_supervisor')),
  zones text,
  valid_from date not null default current_date,
  valid_to date,
  active boolean not null default true,
  added_by uuid default auth.uid() references public.profiles (id),
  added_at timestamptz not null default now(),
  removed_by uuid references public.profiles (id),
  removed_at timestamptz,
  remove_reason text
);
create unique index exec_members_active on public.exec_members (exec_project_id, user_id) where active;
create index on public.exec_members (user_id, active);

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  kind text not null check (kind in ('temp_add', 'temp_delete', 'sub_appoint')),
  status text not null default 'pending_smp' check (status in ('pending_smp', 'pending_gm', 'approved', 'done', 'rejected', 'cancelled')),
  role_type text not null check (role_type in ('assistant_engineer', 'trainee', 'sub_supervisor')),
  person_name text not null,
  email text,
  phone text,
  id_no text,
  company text,
  user_id uuid references public.profiles (id),       -- existing account (delete; or a supervisor already registered)
  project_ids uuid[] not null default '{}',            -- exec_projects
  zones text,
  start_date date,
  end_date date,
  reason text,
  requested_by uuid default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  smp_by uuid references public.profiles (id),
  smp_at timestamptz,
  smp_note text,
  gm_by uuid references public.profiles (id),
  gm_at timestamptz,
  gm_note text,
  decided_note text,
  created_user_id uuid references public.profiles (id),
  provisioned_at timestamptz
);
create index on public.access_requests (status);

create table public.access_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  by_id uuid default auth.uid(),
  user_id uuid,
  exec_project_id uuid,
  request_id uuid,
  event text not null,
  note text
);

-- ---------------------------------------------------------------------------
-- Who can read what
-- ---------------------------------------------------------------------------
create or replace function app.is_exec_member(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.my_role() is not null and exists (
    select 1 from public.exec_members m where m.exec_project_id = p_exec and m.user_id = auth.uid() and m.active
      and m.valid_from <= (now() at time zone app.tz())::date and (m.valid_to is null or m.valid_to >= (now() at time zone app.tz())::date))
$$;

create or replace function app.can_read_exec(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec') or app.is_exec_member(p_exec)
$$;

-- Internal staff of the project (not supervisors): AEs, trainees, the SEE and leads
create or replace function app.is_exec_internal(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec')
      or (app.has_role('assistant_engineer', 'trainee') and app.is_exec_member(p_exec))
$$;

create or replace function app.exec_head(p_exec uuid) returns text
language sql stable security definer set search_path = public as $$
  select concat_ws(' · ', code, name) from public.exec_projects where id = p_exec
$$;

alter table public.exec_projects enable row level security;
alter table public.exec_members enable row level security;
alter table public.access_requests enable row level security;
alter table public.access_log enable row level security;
create policy exec_projects_read on public.exec_projects for select to authenticated using (app.can_read_exec(id));
create policy exec_members_read on public.exec_members for select to authenticated using (app.can_read_exec(exec_project_id));
create policy access_requests_read on public.access_requests for select to authenticated
  using (app.has_role('senior_elec_engineer', 'sm_projects', 'gm'));
create policy access_log_read on public.access_log for select to authenticated using (app.has_role('senior_elec_engineer', 'sm_projects', 'gm'));
grant select on public.exec_projects, public.exec_members, public.access_requests, public.access_log to authenticated;

-- External users: only their own profile and the internal team of their projects; no settings, no targets
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  not app.is_external()
  or id = auth.uid()
  or (role in ('senior_elec_engineer', 'assistant_engineer', 'trainee', 'sm_projects') and exists (
        select 1 from public.exec_members me join public.exec_members them on them.exec_project_id = me.exec_project_id
        where me.user_id = auth.uid() and me.active and them.user_id = profiles.id and them.active))
  or role = 'senior_elec_engineer');
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (not app.is_external());
drop policy if exists target_sets_read on public.target_sets;
create policy target_sets_read on public.target_sets for select to authenticated using (not app.is_external());

-- Access changes made by the execution access functions (security definer) may update another person's profile
create or replace function app.profiles_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null or app.has_role('sys_admin', 'gm') or current_setting('app.exec_access', true) = 'on' then
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

-- ---------------------------------------------------------------------------
-- Execution projects
-- p: {areas[], site_address, lat, lng, start_date, end_date, see_id}
-- ---------------------------------------------------------------------------
create or replace function public.start_execution(p_project uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare pr public.projects; e public.exec_projects; ar text[];
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'Only the Senior Electrical Engineer or SM Projects starts execution');
  select * into pr from public.projects where id = p_project;
  perform app.require(pr.id is not null, 'Project not found');
  perform app.require(pr.status <> 'lost', 'This project is lost');
  perform app.require(not exists (select 1 from public.exec_projects where project_id = p_project), 'Execution has already started for this project');
  select coalesce(array_agg(x), '{}') into ar from jsonb_array_elements_text(coalesce(p -> 'areas', '[]')) x;
  perform app.require(cardinality(ar) > 0, 'Choose at least one project area');
  perform app.require(ar <@ app.exec_areas(), 'Unknown project area');
  insert into public.exec_projects (project_id, code, name, areas, see_id, site_address, lat, lng, start_date, end_date)
  values (pr.id, pr.code, pr.name, ar,
          coalesce(nullif(p ->> 'see_id', '')::uuid, case when app.has_role('senior_elec_engineer') then auth.uid() end,
                   (select id from public.profiles where role = 'senior_elec_engineer' and active limit 1)),
          coalesce(nullif(btrim(p ->> 'site_address'), ''), concat_ws(', ', pr.location, pr.city)),
          coalesce(nullif(p ->> 'lat', '')::float8, pr.lat), coalesce(nullif(p ->> 'lng', '')::float8, pr.lng),
          nullif(p ->> 'start_date', '')::date, nullif(p ->> 'end_date', '')::date)
  returning * into e;
  insert into public.access_log (exec_project_id, event, note) values (e.id, 'execution_started', array_to_string(ar, ', '));
  perform app.notify_many(array_remove(app.role_users('sm_projects', 'senior_elec_engineer') || array[pr.owner_id], auth.uid()), 'exec_project',
    'Execution started – ' || pr.name, format('%s · areas: %s · by %s', pr.code, cardinality(ar), app.display_name(auth.uid())),
    'normal', 'exec_project', e.id, '/execution/' || e.id);
  return e.id;
end $$;

create or replace function public.update_exec_project(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare ar text[];
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'Only the Senior Electrical Engineer or SM Projects edits execution details');
  perform app.require(exists (select 1 from public.exec_projects where id = p_id and status = 'active'), 'Execution project not found or closed');
  select coalesce(array_agg(x), '{}') into ar from jsonb_array_elements_text(coalesce(p -> 'areas', '[]')) x;
  perform app.require(cardinality(ar) > 0 and ar <@ app.exec_areas(), 'Choose at least one valid project area');
  update public.exec_projects set areas = ar, site_address = nullif(btrim(p ->> 'site_address'), ''),
    lat = nullif(p ->> 'lat', '')::float8, lng = nullif(p ->> 'lng', '')::float8,
    start_date = nullif(p ->> 'start_date', '')::date, end_date = nullif(p ->> 'end_date', '')::date,
    see_id = coalesce(nullif(p ->> 'see_id', '')::uuid, see_id), updated_at = now()
  where id = p_id;
end $$;

-- Internal members (permanent / temporary AEs, trainees) are added directly by the SEE
create or replace function public.add_exec_member(p_exec uuid, p_user uuid, p_zones text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.app_role;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'Only the Senior Electrical Engineer adds team members');
  perform app.require(exists (select 1 from public.exec_projects where id = p_exec and status = 'active'), 'Execution project not found or closed');
  select role into r from public.profiles where id = p_user and active;
  perform app.require(r in ('assistant_engineer', 'trainee'), 'Add an Assistant Engineer or Trainee – subcontractor supervisors are appointed with SM Projects approval');
  perform app.require(not exists (select 1 from public.exec_members where exec_project_id = p_exec and user_id = p_user and active), 'Already on this project');
  insert into public.exec_members (exec_project_id, user_id, member_role, zones) values (p_exec, p_user, r::text, nullif(btrim(p_zones), ''));
  insert into public.access_log (user_id, exec_project_id, event) values (p_user, p_exec, 'member_added');
  perform app.notify(p_user, 'exec_project', 'Added to an execution project', app.exec_head(p_exec), 'normal', 'exec_project', p_exec, '/execution/' || p_exec);
end $$;

-- Remove a member from a project (internal or supervisor). A supervisor with no other active project loses the login.
create or replace function app.end_membership(p_member uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.exec_members;
begin
  update public.exec_members set active = false, removed_at = now(), removed_by = auth.uid(), remove_reason = p_reason
  where id = p_member and active returning * into m;
  if m.id is null then return; end if;
  insert into public.access_log (user_id, exec_project_id, event, note) values (m.user_id, m.exec_project_id, 'member_removed', p_reason);
  if m.member_role = 'sub_supervisor' and not exists (select 1 from public.exec_members where user_id = m.user_id and active) then
    perform set_config('app.exec_access', 'on', true);
    update public.profiles set active = false, revoke_pending = true where id = m.user_id;
    insert into public.access_log (user_id, event, note) values (m.user_id, 'login_blocked', 'No active project left');
  end if;
end $$;

create or replace function public.remove_exec_member(p_member uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.exec_members;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'Only the Senior Electrical Engineer removes team members');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select * into m from public.exec_members where id = p_member and active;
  perform app.require(m.id is not null, 'Not an active member');
  perform app.end_membership(m.id, btrim(p_reason));
  if m.member_role = 'sub_supervisor' then
    perform app.notify_many(app.role_users('sm_projects'), 'exec_access', 'Subcontractor supervisor removed',
      format('%s (%s) · %s · %s', app.display_name(m.user_id), coalesce((select company from public.profiles where id = m.user_id), ''),
             app.exec_head(m.exec_project_id), btrim(p_reason)), 'normal', 'exec_project', m.exec_project_id, '/execution/' || m.exec_project_id);
  end if;
  perform app.notify(m.user_id, 'exec_project', 'Removed from an execution project', app.exec_head(m.exec_project_id), 'normal');
end $$;

-- ---------------------------------------------------------------------------
-- Open items of a person (must all be reassigned before a temporary role is deleted).
-- Each later execution step adds its own items here.
-- ---------------------------------------------------------------------------
create or replace function app.open_items(p_user uuid) returns table (kind text, id uuid, title text, url text)
language sql stable security definer set search_path = public as $$
  select 'Engineering job', j.id, concat_ws(' · ', j.code, j.title), '/engineering/' || j.id
  from public.eng_jobs j where j.assignee_id = p_user and j.status in ('assigned', 'in_progress', 'on_hold')
  union all
  select 'Meeting action', a.id, a.action, '/meetings'
  from public.sales_meeting_actions a where a.status = 'open' and (a.assignee_id = p_user or (a.owner_id = p_user and a.assignee_id is null))
$$;

create or replace function public.person_open_items(p_user uuid) returns table (kind text, id uuid, title text, url text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects', 'gm'), 'Not allowed');
  return query select * from app.open_items(p_user);
end $$;

-- Move every open item of one person to another active team member. Later steps extend app.reassign_items.
create or replace function app.reassign_items(p_from uuid, p_to uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  update public.eng_jobs set assignee_id = p_to, assigned_at = now(), status = case when status = 'on_hold' then status else 'assigned' end,
    accepted_at = case when status = 'on_hold' then accepted_at end, accept_alert_level = 0, updated_at = now()
  where assignee_id = p_from and status in ('assigned', 'in_progress', 'on_hold');
  get diagnostics k = row_count; n := n + k;
  update public.sales_meeting_actions set assignee_id = p_to, assigned_at = now(), assigned_by = auth.uid()
  where status = 'open' and assignee_id = p_from;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

create or replace function public.reassign_open_items(p_from uuid, p_to uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int; r public.app_role;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'Only the Senior Electrical Engineer reassigns work');
  select role into r from public.profiles where id = p_to and active;
  perform app.require(r in ('assistant_engineer', 'trainee', 'senior_elec_engineer'), 'Reassign to an active Assistant Engineer, Temporary Assistant Engineer or Trainee');
  perform app.require(p_from <> p_to, 'Choose another person');
  n := app.reassign_items(p_from, p_to);
  -- The new person joins the projects the old one was on
  insert into public.exec_members (exec_project_id, user_id, member_role, zones)
  select m.exec_project_id, p_to, r::text, m.zones from public.exec_members m
  where m.user_id = p_from and m.active and r <> 'senior_elec_engineer'
    and not exists (select 1 from public.exec_members x where x.exec_project_id = m.exec_project_id and x.user_id = p_to and x.active);
  insert into public.access_log (user_id, event, note) values (p_from, 'items_reassigned', format('%s items to %s', n, app.display_name(p_to)));
  if n > 0 then
    perform app.notify(p_to, 'exec_assignment', format('%s open items reassigned to you', n), 'From ' || app.display_name(p_from) || ' – see My Day',
      'normal', null, null, '/', null, true);
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Requests: temporary staff (add / delete) and supervisor appointments
-- ---------------------------------------------------------------------------
create or replace function app.norm_phone(p text) returns text language sql immutable as $$
  select case when d ~ '^0[0-9]{9}$' then '94' || substr(d, 2) else d end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') d) x
$$;

-- p: {role_type: assistant_engineer|trainee, person_name, email, phone, id_no, project_ids[], start_date, end_date, reason}
create or replace function public.request_temp_staff(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; pids uuid[]; rt text := p ->> 'role_type';
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'Only the Senior Electrical Engineer requests temporary staff');
  perform app.require(rt in ('assistant_engineer', 'trainee'), 'Choose Temporary Assistant Engineer or Trainee');
  perform app.require(coalesce(btrim(p ->> 'person_name'), '') <> '', 'Enter the person''s name');
  perform app.require(coalesce(btrim(p ->> 'id_no'), '') <> '', 'Enter the employee or contract ID');
  perform app.require(coalesce(btrim(p ->> 'email'), '') <> '' or length(app.norm_phone(p ->> 'phone')) >= 9, 'Enter an email or a mobile number for the login');
  perform app.require(nullif(p ->> 'start_date', '') is not null and nullif(p ->> 'end_date', '') is not null
    and (p ->> 'end_date')::date >= (p ->> 'start_date')::date, 'Enter the start and expected end dates');
  perform app.require(coalesce(btrim(p ->> 'reason'), '') <> '', 'Give the reason');
  select coalesce(array_agg(x::uuid), '{}') into pids from jsonb_array_elements_text(coalesce(p -> 'project_ids', '[]')) x;
  perform app.require(cardinality(pids) > 0, 'Choose the projects');
  perform app.require((select count(*) from public.exec_projects where id = any (pids) and status = 'active') = cardinality(pids), 'Choose active execution projects');
  insert into public.access_requests (code, kind, role_type, person_name, email, phone, id_no, project_ids, start_date, end_date, reason)
  values (app.next_code('ACR'), 'temp_add', rt, btrim(p ->> 'person_name'), nullif(lower(btrim(p ->> 'email')), ''), nullif(app.norm_phone(p ->> 'phone'), ''),
          btrim(p ->> 'id_no'), pids, (p ->> 'start_date')::date, (p ->> 'end_date')::date, btrim(p ->> 'reason'))
  returning id into rid;
  insert into public.access_log (request_id, event, note) values (rid, 'requested', 'Temporary ' || rt);
  perform app.notify_many(app.role_users('sm_projects'), 'exec_access', 'Temporary staff request – approve',
    format('%s · %s · %s to %s · %s', btrim(p ->> 'person_name'), case rt when 'trainee' then 'Trainee' else 'Temporary Assistant Engineer' end,
           p ->> 'start_date', p ->> 'end_date', btrim(p ->> 'reason')), 'normal', 'access_request', rid, '/execution/access/' || rid, null, true);
  return rid;
end $$;

create or replace function public.request_temp_delete(p_user uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pr public.profiles; rid uuid; n int;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'Only the Senior Electrical Engineer requests the deletion');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select * into pr from public.profiles where id = p_user;
  perform app.require(pr.id is not null and pr.active and (pr.is_temporary or pr.role = 'trainee'), 'Only an active temporary Assistant Engineer or Trainee can be deleted');
  select count(*) into n from app.open_items(p_user);
  perform app.require(n = 0, format('Reassign the %s open items first', n));
  perform app.require(not exists (select 1 from public.access_requests where kind = 'temp_delete' and user_id = p_user and status in ('pending_smp', 'pending_gm')),
    'A deletion request is already pending');
  insert into public.access_requests (code, kind, role_type, person_name, email, phone, id_no, user_id, reason,
                                      project_ids)
  values (app.next_code('ACR'), 'temp_delete', case when pr.role = 'trainee' then 'trainee' else 'assistant_engineer' end, pr.full_name, pr.email, pr.phone,
          pr.id_no, p_user, btrim(p_reason), coalesce((select array_agg(exec_project_id) from public.exec_members where user_id = p_user and active), '{}'))
  returning id into rid;
  insert into public.access_log (request_id, user_id, event, note) values (rid, p_user, 'delete_requested', btrim(p_reason));
  perform app.notify_many(app.role_users('sm_projects'), 'exec_access', 'Delete temporary role – approve',
    format('%s · %s', pr.full_name, btrim(p_reason)), 'normal', 'access_request', rid, '/execution/access/' || rid, null, true);
  return rid;
end $$;

-- p: {person_name, company, phone, email, id_no, zones, start_date, end_date}
create or replace function public.nominate_supervisor(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; ph text := app.norm_phone(p ->> 'phone'); existing uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'Only the Senior Electrical Engineer nominates subcontractor supervisors');
  perform app.require(exists (select 1 from public.exec_projects where id = p_exec and status = 'active'), 'Execution project not found or closed');
  perform app.require(coalesce(btrim(p ->> 'person_name'), '') <> '' and coalesce(btrim(p ->> 'company'), '') <> '', 'Enter the name and the subcontractor company');
  perform app.require(length(ph) >= 9, 'Enter the mobile number – it is the supervisor''s login');
  perform app.require(coalesce(btrim(p ->> 'id_no'), '') <> '', 'Enter the ID or site pass number');
  perform app.require(nullif(p ->> 'start_date', '') is not null and nullif(p ->> 'end_date', '') is not null
    and (p ->> 'end_date')::date >= (p ->> 'start_date')::date, 'Enter the access validity dates');
  select id into existing from public.profiles where role = 'sub_supervisor' and app.norm_phone(phone) = ph limit 1;
  perform app.require(existing is null or not exists (select 1 from public.exec_members where exec_project_id = p_exec and user_id = existing and active),
    'This supervisor is already on the project');
  perform app.require(not exists (select 1 from public.access_requests where kind = 'sub_appoint' and phone = ph and p_exec = any (project_ids)
    and status in ('pending_smp', 'approved')), 'A nomination for this supervisor is already pending');
  insert into public.access_requests (code, kind, role_type, person_name, company, phone, email, id_no, user_id, project_ids, zones, start_date, end_date, reason)
  values (app.next_code('ACR'), 'sub_appoint', 'sub_supervisor', btrim(p ->> 'person_name'), btrim(p ->> 'company'), ph, nullif(lower(btrim(p ->> 'email')), ''),
          btrim(p ->> 'id_no'), existing, array[p_exec], nullif(btrim(p ->> 'zones'), ''), (p ->> 'start_date')::date, (p ->> 'end_date')::date,
          nullif(btrim(p ->> 'reason'), ''))
  returning id into rid;
  insert into public.access_log (request_id, exec_project_id, event, note) values (rid, p_exec, 'nominated', btrim(p ->> 'person_name') || ' · ' || btrim(p ->> 'company'));
  perform app.notify_many(app.role_users('sm_projects'), 'exec_access', 'Subcontractor supervisor nomination – approve',
    format('%s (%s) · %s · %s to %s', btrim(p ->> 'person_name'), btrim(p ->> 'company'), app.exec_head(p_exec), p ->> 'start_date', p ->> 'end_date'),
    'normal', 'access_request', rid, '/execution/access/' || rid, null, true);
  return rid;
end $$;

-- Membership from an approved request for an account that exists
create or replace function app.grant_request_memberships(r public.access_requests, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.exec_members (exec_project_id, user_id, member_role, zones, valid_from, valid_to, added_by)
  select x, p_user, r.role_type, r.zones, coalesce(r.start_date, current_date), r.end_date, r.requested_by
  from unnest(r.project_ids) x
  where not exists (select 1 from public.exec_members m where m.exec_project_id = x and m.user_id = p_user and m.active);
end $$;

-- SM Projects (step 1) and DGM / GM (step 2 for temporary staff) decide
create or replace function public.decide_access_request(p_id uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r public.access_requests; nxt text;
begin
  select * into r from public.access_requests where id = p_id for update;
  perform app.require(r.id is not null, 'Request not found');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  if r.status = 'pending_smp' then
    perform app.require(app.has_role('sm_projects'), 'Waiting for SM Projects');
    if not p_approve then
      update public.access_requests set status = 'rejected', smp_by = auth.uid(), smp_at = now(), smp_note = btrim(p_note) where id = r.id;
      nxt := 'rejected';
    elsif r.kind = 'sub_appoint' then
      update public.access_requests set status = case when r.user_id is null then 'approved' else 'done' end, smp_by = auth.uid(), smp_at = now(),
        smp_note = nullif(btrim(p_note), '') where id = r.id;
      if r.user_id is not null then
        perform set_config('app.exec_access', 'on', true);
        update public.profiles set active = true, revoke_pending = false, company = coalesce(r.company, company) where id = r.user_id;
        perform app.grant_request_memberships(r, r.user_id);
        perform app.notify(r.user_id, 'exec_project', 'You are appointed to a new project', app.exec_head(r.project_ids[1]), 'normal');
      end if;
      nxt := 'approved';
    else
      update public.access_requests set status = 'pending_gm', smp_by = auth.uid(), smp_at = now(), smp_note = nullif(btrim(p_note), '') where id = r.id;
      perform app.notify_many(app.role_users('gm'), 'exec_access',
        case r.kind when 'temp_add' then 'Temporary staff request – approve' else 'Delete temporary role – approve' end,
        format('%s · approved by SM Projects %s', r.person_name, app.display_name(auth.uid())), 'normal', 'access_request', r.id, '/execution/access/' || r.id, null, true);
      nxt := 'pending_gm';
    end if;
  elsif r.status = 'pending_gm' then
    perform app.require(app.has_role('gm'), 'Waiting for DGM / GM');
    if not p_approve then
      update public.access_requests set status = 'rejected', gm_by = auth.uid(), gm_at = now(), gm_note = btrim(p_note) where id = r.id;
      nxt := 'rejected';
    elsif r.kind = 'temp_add' then
      update public.access_requests set status = 'approved', gm_by = auth.uid(), gm_at = now(), gm_note = nullif(btrim(p_note), '') where id = r.id;
      nxt := 'approved';
    else
      -- Delete: nothing may be open; access ends at once, the history stays under the name
      perform app.require((select count(*) from app.open_items(r.user_id)) = 0, 'New open items were given to this person – reassign them first');
      update public.access_requests set status = 'done', gm_by = auth.uid(), gm_at = now(), gm_note = nullif(btrim(p_note), '') where id = r.id;
      perform app.end_membership(m.id, 'Temporary role deleted') from public.exec_members m where m.user_id = r.user_id and m.active;
      perform set_config('app.exec_access', 'on', true);
      update public.profiles set active = false, revoke_pending = true where id = r.user_id;
      insert into public.access_log (request_id, user_id, event) values (r.id, r.user_id, 'temp_deleted');
      nxt := 'deleted';
    end if;
  else
    perform app.require(false, 'This request is already decided');
  end if;
  insert into public.access_log (request_id, user_id, event, note) values (r.id, r.user_id, 'decision_' || nxt, nullif(btrim(p_note), ''));
  perform app.notify(r.requested_by, 'exec_access',
    format('%s – %s', case r.kind when 'temp_add' then 'Temporary staff request' when 'temp_delete' then 'Temporary role deletion' else 'Supervisor nomination' end,
           case nxt when 'rejected' then 'rejected' when 'pending_gm' then 'approved by SM Projects, now with DGM / GM'
                    when 'approved' then case when r.kind = 'sub_appoint' and r.user_id is not null then 'approved – added to the project'
                                              else 'approved – create the login' end
                    else 'approved – access ended' end),
    concat_ws(' · ', r.person_name, nullif(btrim(p_note), '')), 'normal', 'access_request', r.id, '/execution/access/' || r.id, null, true);
  return nxt;
end $$;

create or replace function public.cancel_access_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.access_requests set status = 'cancelled' where id = p_id and requested_by = auth.uid() and status in ('pending_smp', 'pending_gm');
  perform app.require(found, 'Only your own pending request can be cancelled');
end $$;

-- Called by the admin-users function (service role) after it created the login for an approved request
create or replace function public.complete_access_provision(p_request uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.access_requests;
begin
  select * into r from public.access_requests where id = p_request for update;
  perform app.require(r.id is not null and r.status = 'approved' and r.kind in ('temp_add', 'sub_appoint'), 'Request not ready');
  update public.profiles set is_temporary = r.kind = 'temp_add' and r.role_type = 'assistant_engineer',
    access_until = r.end_date, company = r.company, id_no = r.id_no, phone = coalesce(r.phone, phone) where id = p_user;
  perform app.grant_request_memberships(r, p_user);
  update public.access_requests set status = 'done', created_user_id = p_user, provisioned_at = now() where id = r.id;
  insert into public.access_log (request_id, user_id, event) values (r.id, p_user, 'login_created');
  perform app.notify_many(app.role_users('sm_projects') || array[r.requested_by], 'exec_access', 'Login created – ' || r.person_name,
    case r.kind when 'sub_appoint' then 'Subcontractor supervisor · ' || coalesce(r.company, '') else 'Temporary staff' end, 'normal',
    'access_request', r.id, '/execution/access/' || r.id);
end $$;
revoke execute on function public.complete_access_provision(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_access_provision(uuid, uuid) to service_role;

-- Login blocking done by push-dispatch (service role)
create or replace function public.mark_banned(p_user uuid) returns void
language sql security definer set search_path = public as $$
  update public.profiles set revoke_pending = false, banned_at = now() where id = p_user;
  insert into public.access_log (user_id, event) values (p_user, 'login_blocked');
$$;
revoke execute on function public.mark_banned(uuid) from public, anon, authenticated;
grant execute on function public.mark_banned(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Engineering jobs (instructions) may go to trainees and to supervisors of the job's project
-- ---------------------------------------------------------------------------
create or replace function app.check_eng_assignee(p_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(p_id is not null and exists (select 1 from public.profiles where id = p_id and active
    and role in ('assistant_engineer', 'senior_elec_engineer', 'trainee', 'sub_supervisor')),
    'Assign it to an Assistant Engineer, Trainee or a subcontractor supervisor on the project');
end $$;

-- ---------------------------------------------------------------------------
-- Daily: memberships and supervisor access end at the validity date; reminder 7 days before a temporary role ends
-- ---------------------------------------------------------------------------
create or replace function public.exec_access_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; m record; pr record; n int := 0;
begin
  for m in select * from public.exec_members where active and valid_to is not null and valid_to < today loop
    perform app.end_membership(m.id, 'Access period ended');
    perform app.notify_many(app.role_users('senior_elec_engineer', 'sm_projects'), 'exec_access', 'Project access ended',
      format('%s · %s · validity ended %s', app.display_name(m.user_id), app.exec_head(m.exec_project_id), to_char(m.valid_to, 'DD Mon YYYY')),
      'normal', 'exec_project', m.exec_project_id, '/execution/' || m.exec_project_id);
    n := n + 1;
  end loop;
  for pr in select * from public.profiles where active and (is_temporary or role = 'trainee') and access_until is not null
              and access_until - today in (7, 1) loop
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_access', 'Temporary role ends soon',
      format('%s · expected end %s – extend, or reassign the work and request the deletion', pr.full_name, to_char(pr.access_until, 'DD Mon YYYY')),
      'normal', null, null, '/execution/team', format('tmpend:%s:%s', pr.id, today));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.exec_access_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.exec_access_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('exec-access-tick', '5 0 * * *', 'select public.exec_access_tick()');
  end if;
end $$;

revoke execute on function public.start_execution(uuid, jsonb), public.update_exec_project(uuid, jsonb), public.add_exec_member(uuid, uuid, text),
  public.remove_exec_member(uuid, text), public.person_open_items(uuid), public.reassign_open_items(uuid, uuid), public.request_temp_staff(jsonb),
  public.request_temp_delete(uuid, text), public.nominate_supervisor(uuid, jsonb), public.decide_access_request(uuid, boolean, text),
  public.cancel_access_request(uuid) from public, anon;
grant execute on function public.start_execution(uuid, jsonb), public.update_exec_project(uuid, jsonb), public.add_exec_member(uuid, uuid, text),
  public.remove_exec_member(uuid, text), public.person_open_items(uuid), public.reassign_open_items(uuid, uuid), public.request_temp_staff(jsonb),
  public.request_temp_delete(uuid, text), public.nominate_supervisor(uuid, jsonb), public.decide_access_request(uuid, boolean, text),
  public.cancel_access_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Approvals tab: execution items (later steps redefine app.exec_pending_approvals)
-- ---------------------------------------------------------------------------
create or replace function app.exec_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
  select 'access_request', r.id, 'exec_access',
         format('%s – %s', case r.kind when 'temp_add' then case r.role_type when 'trainee' then 'Trainee' else 'Temporary Assistant Engineer' end
                                       when 'temp_delete' then 'Delete temporary role' else 'Subcontractor supervisor' end, r.person_name),
         concat_ws(' · ', r.company, r.reason), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid,
         '/execution/access/' || r.id, case r.status when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.access_requests r
  where (r.status = 'pending_smp' and app.has_role('sm_projects')) or (r.status = 'pending_gm' and app.has_role('gm'))
$$;

-- Approvals tab now includes the execution items (copied from 20260930000088)
create or replace function public.my_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
  select 'approval', a.id, a.kind::text, a.title, a.reason, a.requested_by, app.display_name(a.requested_by), a.requested_at,
         a.inquiry_id, case when a.inquiry_id is not null then app.inquiry_url(a.inquiry_id) else '/approvals' end,
         format('Step %s of %s', a.current_step, (select count(*) from public.approval_steps x where x.approval_id = a.id))
  from public.approvals a
  join public.approval_steps s on s.approval_id = a.id and s.step_no = a.current_step
  where a.status = 'pending' and (s.approver_role = app.my_role() or (app.my_role() = 'gm' and s.approver_role = 'gm'))
  union all
  select 'visit_plan', p.id, 'weekly_plan', format('Weekly plan – %s – week of %s', app.display_name(p.sales_person_id), to_char(p.week_start, 'DD Mon')),
         case when p.is_late then 'Submitted late' end, p.sales_person_id, app.display_name(p.sales_person_id), p.submitted_at,
         null, '/plan/' || p.id, null
  from public.visit_plans p where p.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'design_review', d.id, 'design_release', format('Design review – %s (%s)', i.code, d.task_type), i.project_name,
         d.assignee_id, app.display_name(d.assignee_id), d.submitted_at, i.id, '/design/' || d.id, null
  from public.design_jobs d join public.inquiries i on i.id = d.inquiry_id
  where d.status = 'in_review' and app.has_role('design_manager')
  union all
  select 'quotation_review', e.id, 'quotation_release', format('Quotation approval – %s', i.code), i.project_name,
         e.assignee_id, app.display_name(e.assignee_id), e.submitted_at, i.id, '/estimation/' || e.id, null
  from public.estimation_jobs e join public.inquiries i on i.id = e.inquiry_id
  where e.status = 'submitted_for_approval' and app.has_role('sm_estimation')
  union all
  select 'sample', sm.id, 'sample_request', format('Sample request %s', sm.code), sm.purpose,
         sm.sales_person_id, app.display_name(sm.sales_person_id), sm.submitted_at, null, '/samples/' || sm.id, sm.status
  from public.samples sm
  where (sm.status = 'submitted' and app.has_role('operations_exec'))
     or (sm.status = 'availability_confirmed' and app.has_role('sm_projects'))
     or (sm.status = 'gm_approval' and app.has_role('gm'))
  union all
  select 'claim_dispute', c.id, 'warranty_dispute', format('Warranty dispute – %s – %s', c.code, w.customer), c.dispute_reason,
         c.disputed_by, app.display_name(c.disputed_by), c.disputed_at, null, app.claim_url(c.id), app.fault_cause_label(c.fault_cause)
  from public.warranty_claims c join public.warranties w on w.id = c.warranty_id
  where c.dispute_status = 'pending' and app.has_role('sm_projects', 'gm')
  union all
  select 'variation', v.id, 'secured_variation',
         format('Variation %s%s – %s', case when v.amount > 0 then '+' else '−' end, app.fmt_money(abs(v.amount), 'LKR'), s.project_name),
         concat_ws(' · ', v.vo_no, v.reason), v.requested_by, app.display_name(v.requested_by), v.requested_at, null, app.secured_url(s.id), null
  from public.secured_variations v join public.secured_projects s on s.id = v.secured_id
  where v.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'meeting_exception', e.id, 'meeting_exception', format('%s leave – %s – %s', app.meeting_label(e.team), app.display_name(e.sales_person_id),
         to_char(e.meeting_date, 'Dy DD Mon')), e.reason, e.sales_person_id, app.display_name(e.sales_person_id), e.requested_at, null,
         '/meetings?team=' || e.team, null
  from public.meeting_exceptions e
  where e.status = 'pending' and app.is_meeting_host(e.team)
  union all
  select 'meeting_attendance', m.id, 'meeting_attendance', format('Meeting attendance – %s – location differs', app.display_name(i.person_id)),
         case when i.distance_m is null then 'No location' else round(i.distance_m) || ' m from the meeting' end, i.person_id,
         app.display_name(i.person_id), i.checkin_at, null, '/meeting/' || m.id, null
  from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id
  where i.status = 'location_check' and app.is_meeting_host(m.team)
  union all
  select 'meeting_assign', a.id, 'meeting_assign', format('Assign: %s', a.action),
         concat_ws(' · ', coalesce(p.name, a.new_project), coalesce(o.name, a.new_customer), app.meeting_label(m.team) || ' ' || to_char(m.meeting_date, 'DD Mon')),
         m.published_by, app.display_name(m.published_by), m.published_at, null, '/meetings', app.action_kind_label(a.kind)
  from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
  left join public.projects p on p.id = a.project_id left join public.organizations o on o.id = a.organization_id
  where m.status = 'published' and a.status = 'open' and a.kind in ('design', 'estimation', 'execution') and a.assignee_id is null
    and a.owner_id = auth.uid()
  union all
  select 'meeting_invite', i.meeting_id, 'meeting_invite', format('Invite %s to the %s – %s', app.display_name(i.person_id), lower(app.meeting_label(m.team)),
         to_char(m.meeting_date, 'Dy DD Mon')), 'Outside the team – requested by ' || app.display_name(coalesce(i.requested_by, m.initiated_by)),
         coalesce(i.requested_by, m.initiated_by), app.display_name(coalesce(i.requested_by, m.initiated_by)), i.invited_at, null, '/meetings?team=' || m.team, null
  from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id
  where i.status = 'pending_approval' and app.has_role('sm_projects') and now() < app.meeting_starts(m)
  union all
  select 'project_change', r.id, 'project_change', format('Project change – %s – %s', p.code, p.name), r.reason,
         r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid, '/projects/' || p.id,
         (select string_agg(app.project_field_label(k), ', ') from jsonb_object_keys(r.changes) k)
  from public.project_change_requests r join public.projects p on p.id = r.project_id
  where r.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'invoice_schedule', s.id, 'invoice_schedule', format('Invoice schedule – %s', s.project_name),
         concat_ws(' · ', s.customer, 'order value ' || app.fmt_money(s.order_value, 'LKR')),
         s.sales_person_id, app.display_name(s.sales_person_id), coalesce(s.submitted_at, s.created_at), null, app.secured_url(s.id), null
  from public.secured_projects s
  where s.status = 'open' and s.schedule_status = 'review' and app.has_role('sm_projects')
  union all
  select 'invoice_move', s.id, 'invoice_move',
         format('Invoice date change – %s · %s → %s', s.project_name, to_char(c.from_month, 'Mon YYYY'), to_char(c.to_month, 'Mon YYYY')),
         concat_ws(' · ', app.fmt_money(l.amount, 'LKR'), c.reason, c.note), c.requested_by, app.display_name(c.requested_by), c.requested_at,
         null, app.secured_url(s.id), null
  from public.invoice_line_changes c join public.invoice_lines l on l.id = c.line_id join public.secured_projects s on s.id = l.secured_id
  where c.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'invoice_request', s.id, 'invoice_request', format('Invoice to approve – %s – %s', s.project_name, r.invoice_no),
         concat_ws(' · ', app.fmt_money(r.amount, 'LKR'), to_char(r.invoice_date, 'DD Mon YYYY'), r.note), r.requested_by,
         app.display_name(r.requested_by), r.requested_at, null, app.secured_url(s.id), null
  from public.invoice_requests r join public.secured_projects s on s.id = r.secured_id
  where r.status = 'pending' and app.has_role('sm_projects')
  union all
  select * from app.exec_pending_approvals()
  order by 8
$$;

create or replace function public.mark_unbanned(p_user uuid) returns void
language sql security definer set search_path = public as $$
  update public.profiles set banned_at = null where id = p_user;
  insert into public.access_log (user_id, event) values (p_user, 'login_unblocked');
$$;
revoke execute on function public.mark_unbanned(uuid) from public, anon, authenticated;
grant execute on function public.mark_unbanned(uuid) to service_role;
