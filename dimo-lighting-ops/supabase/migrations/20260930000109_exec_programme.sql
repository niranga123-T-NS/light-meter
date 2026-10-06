-- Project programme (time schedule): WBS, activities with durations, dependencies (FS / SS / FF / SF with lag),
-- resources per activity, critical-path scheduling on working days, baseline approved by SM Projects,
-- progress entered by the Assistant Engineers, Gantt chart in the app.
--  * Built in the app by the Senior Electrical Engineer for each project (no templates – WBS, activities and
--    resources as the project requires). Must be approved by SM Projects before gate 2 (work cannot commence).
--  * Changing the approved programme makes a revision; SM Projects approves a new baseline with the reason.
--  * Daily: late critical activities, forecast finish beyond the contract date, progress not updated.

create table public.exec_programmes (
  exec_project_id uuid primary key references public.exec_projects (id) on delete cascade,
  start_date date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved')),
  version int not null default 0,
  submitted_by uuid references public.profiles (id),
  submitted_at timestamptz,
  submit_note text,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  baseline_finish date,
  forecast_finish date,
  updated_at timestamptz not null default now()
);
create table public.exec_wbs (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  parent_id uuid references public.exec_wbs (id) on delete cascade,
  code text not null,
  name text not null,
  sort int not null default 0
);
create table public.exec_activities (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  wbs_id uuid not null references public.exec_wbs (id) on delete cascade,
  code text not null,
  name text not null,
  duration int not null default 1 check (duration >= 0),
  not_before date,
  responsible_id uuid references public.profiles (id),
  subcontractor text,
  qty numeric,
  unit text,
  sort int not null default 0,
  pct numeric(5, 2) not null default 0 check (pct between 0 and 100),
  actual_start date,
  actual_finish date,
  progress_note text,
  progress_by uuid references public.profiles (id),
  progress_at timestamptz,
  es date, ef date, ls date, lf date,
  total_float int,
  critical boolean not null default false,
  bl_start date,
  bl_finish date,
  late_alerted date,
  created_at timestamptz not null default now()
);
create index on public.exec_activities (exec_project_id);
create table public.exec_activity_deps (
  id uuid primary key default gen_random_uuid(),
  pred_id uuid not null references public.exec_activities (id) on delete cascade,
  succ_id uuid not null references public.exec_activities (id) on delete cascade,
  dep_type text not null default 'FS' check (dep_type in ('FS', 'SS', 'FF', 'SF')),
  lag int not null default 0,
  unique (pred_id, succ_id),
  check (pred_id <> succ_id)
);
create table public.exec_activity_resources (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.exec_activities (id) on delete cascade,
  kind text not null check (kind in ('staff', 'labour', 'equipment', 'subcontractor')),
  profile_id uuid references public.profiles (id),
  name text not null,
  qty numeric not null default 1 check (qty > 0),
  unit text
);
create table public.exec_baselines (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  version int not null,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz not null default now(),
  reason text,
  finish date,
  snapshot jsonb not null default '[]',
  unique (exec_project_id, version)
);

alter table public.exec_programmes enable row level security;
alter table public.exec_wbs enable row level security;
alter table public.exec_activities enable row level security;
alter table public.exec_activity_deps enable row level security;
alter table public.exec_activity_resources enable row level security;
alter table public.exec_baselines enable row level security;
create policy exec_programmes_read on public.exec_programmes for select to authenticated using (app.is_exec_internal(exec_project_id));
create policy exec_wbs_read on public.exec_wbs for select to authenticated using (app.is_exec_internal(exec_project_id));
create policy exec_activities_read on public.exec_activities for select to authenticated using (app.is_exec_internal(exec_project_id));
create policy exec_activity_deps_read on public.exec_activity_deps for select to authenticated
  using (exists (select 1 from public.exec_activities a where a.id = succ_id and app.is_exec_internal(a.exec_project_id)));
create policy exec_activity_resources_read on public.exec_activity_resources for select to authenticated
  using (exists (select 1 from public.exec_activities a where a.id = activity_id and app.is_exec_internal(a.exec_project_id)));
create policy exec_baselines_read on public.exec_baselines for select to authenticated using (app.is_exec_internal(exec_project_id));
grant select on public.exec_programmes, public.exec_wbs, public.exec_activities, public.exec_activity_deps, public.exec_activity_resources, public.exec_baselines to authenticated;

-- ---------------------------------------------------------------------------
-- Critical path scheduling on working days (holidays and the working week from the settings)
--  Index units: working day n counted from the programme start (0 = first working day).
--  es = first working day, ef = first working day after the activity (exclusive); a milestone has es = ef.
--  Started activities keep their actual start; unfinished work is not forecast before today.
-- ---------------------------------------------------------------------------
create or replace function app.schedule(p_exec uuid) returns date
language plpgsql security definer set search_path = public as $$
declare pg public.exec_programmes; cal date[]; tidx int; n int; i int; pf int; v_finish date; wd int[];
begin
  select * into pg from public.exec_programmes where exec_project_id = p_exec;
  if pg.exec_project_id is null then return null; end if;
  wd := coalesce((select array_agg(x::int) from jsonb_array_elements_text(app.setting('working_hours') -> 'days') x), array[1, 2, 3, 4, 5]);
  select array_agg(d order by d) into cal
  from (select g::date d from generate_series(pg.start_date, pg.start_date + 5000, interval '1 day') g) c
  where extract(isodow from d)::int = any (wd) and not exists (select 1 from public.holidays h where h.day = c.d);
  tidx := (select count(*) from unnest(cal) c where c < (now() at time zone app.tz())::date);

  create temp table if not exists _sch (id uuid primary key, d int, es int, ef int, ls int, lf int, fixed_es int, fin int, base int, rem int) on commit drop;
  delete from _sch;
  insert into _sch (id, d, fixed_es, fin, base, rem)
  select a.id, a.duration,
         case when a.actual_start is not null then (select count(*) from unnest(cal) c where c < a.actual_start) end,
         case when a.actual_finish is not null then (select count(*) from unnest(cal) c where c <= a.actual_finish) end,
         greatest(0, coalesce((select count(*) from unnest(cal) c where c < a.not_before), 0), case when a.actual_start is null then tidx else 0 end),
         ceil(a.duration * (1 - a.pct / 100.0))::int
  from public.exec_activities a where a.exec_project_id = p_exec;
  select count(*) into n from _sch;
  update _sch set es = coalesce(fixed_es, base);
  update _sch set ef = case when fin is not null then greatest(fin, es) when fixed_es is not null then greatest(es + d, tidx + rem) else es + d end;
  -- forward pass (relaxation; the network has no loops)
  i := 0;
  loop
    i := i + 1;
    update _sch s set es = x.nes
    from (select s2.id, greatest(s2.base, max(case dp.dep_type when 'FS' then p.ef + dp.lag when 'SS' then p.es + dp.lag
                                                         when 'FF' then p.ef + dp.lag - s2.d else p.es + dp.lag - s2.d end)) nes
          from _sch s2 join public.exec_activity_deps dp on dp.succ_id = s2.id join _sch p on p.id = dp.pred_id
          where s2.fixed_es is null group by s2.id, s2.base) x
    where s.id = x.id and s.es <> x.nes;
    update _sch set ef = case when fin is not null then greatest(fin, es) when fixed_es is not null then greatest(es + d, tidx + rem) else es + d end
    where ef <> case when fin is not null then greatest(fin, es) when fixed_es is not null then greatest(es + d, tidx + rem) else es + d end;
    exit when not found or i > n + 2;
  end loop;
  select coalesce(max(ef), 0) into pf from _sch;
  -- backward pass
  update _sch set lf = pf, ls = pf - (ef - es);
  i := 0;
  loop
    i := i + 1;
    update _sch p set lf = x.nlf, ls = x.nlf - (p.ef - p.es)
    from (select p2.id, least(pf, min(case dp.dep_type when 'FS' then s.ls - dp.lag when 'SS' then s.ls - dp.lag + (p2.ef - p2.es)
                                                   when 'FF' then s.lf - dp.lag else s.lf - dp.lag + (p2.ef - p2.es) end)) nlf
          from _sch p2 join public.exec_activity_deps dp on dp.pred_id = p2.id join _sch s on s.id = dp.succ_id group by p2.id, p2.ef, p2.es) x
    where p.id = x.id and p.lf <> x.nlf;
    exit when not found or i > n + 2;
  end loop;
  update public.exec_activities a set
    es = cal[least(s.es, cardinality(cal) - 1) + 1],
    ef = case when s.ef > s.es then cal[least(s.ef, cardinality(cal))] else cal[least(s.es, cardinality(cal) - 1) + 1] end,
    ls = cal[greatest(0, least(s.ls, cardinality(cal) - 1)) + 1],
    lf = case when s.lf > s.ls then cal[greatest(1, least(s.lf, cardinality(cal)))] else cal[greatest(0, least(s.ls, cardinality(cal) - 1)) + 1] end,
    total_float = s.ls - s.es,
    critical = a.actual_finish is null and s.ls - s.es <= 0
  from _sch s where s.id = a.id;
  v_finish := case when pf > 0 then cal[least(pf, cardinality(cal))] else pg.start_date end;
  update public.exec_programmes set forecast_finish = case when n > 0 then v_finish end, updated_at = now() where exec_project_id = p_exec;
  return v_finish;
end $$;

create or replace function app.programme_edit(p_exec uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer prepares the programme');
  perform app.require(exists (select 1 from public.exec_projects where id = p_exec and status = 'active'), 'Project not active');
  perform app.require(exists (select 1 from public.exec_programmes where exec_project_id = p_exec), 'Set the programme start date first');
  perform app.require((select status from public.exec_programmes where exec_project_id = p_exec) <> 'submitted', 'The programme is with SM Projects – wait for the decision');
  -- Editing an approved programme starts a revision (the approved baseline stays until a new one is approved)
  update public.exec_programmes set status = 'draft', updated_at = now() where exec_project_id = p_exec and status = 'approved';
end $$;

create or replace function public.save_programme(p_exec uuid, p_start date) returns date
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer prepares the programme');
  perform app.require(p_start is not null, 'Set the start date');
  insert into public.exec_programmes (exec_project_id, start_date) values (p_exec, p_start)
  on conflict (exec_project_id) do update set start_date = excluded.start_date, status = case when exec_programmes.status = 'approved' then 'draft' else exec_programmes.status end,
    updated_at = now()
  where exec_programmes.status <> 'submitted';
  return app.schedule(p_exec);
end $$;

create or replace function public.save_wbs(p_exec uuid, p_id uuid, p_parent uuid, p_code text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare wid uuid;
begin
  perform app.programme_edit(p_exec);
  perform app.require(coalesce(btrim(p_code), '') <> '' and coalesce(btrim(p_name), '') <> '', 'Enter the WBS code and name');
  perform app.require(p_parent is null or exists (select 1 from public.exec_wbs where id = p_parent and exec_project_id = p_exec), 'Unknown parent');
  if p_id is null then
    insert into public.exec_wbs (exec_project_id, parent_id, code, name, sort)
    values (p_exec, p_parent, btrim(p_code), btrim(p_name), coalesce((select max(sort) + 1 from public.exec_wbs where exec_project_id = p_exec), 0)) returning id into wid;
  else
    perform app.require(p_parent is distinct from p_id, 'A WBS element cannot be its own parent');
    update public.exec_wbs set parent_id = p_parent, code = btrim(p_code), name = btrim(p_name) where id = p_id and exec_project_id = p_exec returning id into wid;
  end if;
  return wid;
end $$;

create or replace function public.delete_wbs(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w public.exec_wbs;
begin
  select * into w from public.exec_wbs where id = p_id;
  perform app.require(w.id is not null, 'Not found');
  perform app.programme_edit(w.exec_project_id);
  perform app.require(not exists (select 1 from public.exec_activities where wbs_id = p_id) and not exists (select 1 from public.exec_wbs where parent_id = p_id),
    'Move or delete its activities and sub-elements first');
  delete from public.exec_wbs where id = p_id;
end $$;

-- p: {wbs_id, code, name, duration, not_before, responsible_id, subcontractor, qty, unit}
create or replace function public.save_activity(p_exec uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare aid uuid; d int;
begin
  perform app.programme_edit(p_exec);
  perform app.require(coalesce(btrim(p ->> 'code'), '') <> '' and coalesce(btrim(p ->> 'name'), '') <> '', 'Enter the activity code and name');
  perform app.require(exists (select 1 from public.exec_wbs where id = nullif(p ->> 'wbs_id', '')::uuid and exec_project_id = p_exec), 'Choose the WBS element');
  begin d := (p ->> 'duration')::int; exception when others then d := null; end;
  perform app.require(d is not null and d >= 0, 'Enter the duration in working days (0 for a milestone)');
  perform app.require(not exists (select 1 from public.exec_activities where exec_project_id = p_exec and code = btrim(p ->> 'code') and id is distinct from p_id), 'This activity code is already used');
  if p_id is null then
    insert into public.exec_activities (exec_project_id, wbs_id, code, name, duration, not_before, responsible_id, subcontractor, qty, unit, sort)
    values (p_exec, (p ->> 'wbs_id')::uuid, btrim(p ->> 'code'), btrim(p ->> 'name'), d, nullif(p ->> 'not_before', '')::date, nullif(p ->> 'responsible_id', '')::uuid,
            nullif(btrim(p ->> 'subcontractor'), ''), nullif(p ->> 'qty', '')::numeric, nullif(btrim(p ->> 'unit'), ''),
            coalesce((select max(sort) + 1 from public.exec_activities where exec_project_id = p_exec), 0))
    returning id into aid;
  else
    update public.exec_activities set wbs_id = (p ->> 'wbs_id')::uuid, code = btrim(p ->> 'code'), name = btrim(p ->> 'name'), duration = d,
      not_before = nullif(p ->> 'not_before', '')::date, responsible_id = nullif(p ->> 'responsible_id', '')::uuid, subcontractor = nullif(btrim(p ->> 'subcontractor'), ''),
      qty = nullif(p ->> 'qty', '')::numeric, unit = nullif(btrim(p ->> 'unit'), '')
    where id = p_id and exec_project_id = p_exec returning id into aid;
  end if;
  perform app.require(aid is not null, 'Activity not found');
  perform app.schedule(p_exec);
  return aid;
end $$;

create or replace function public.delete_activity(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.exec_activities;
begin
  select * into a from public.exec_activities where id = p_id;
  perform app.require(a.id is not null, 'Not found');
  perform app.programme_edit(a.exec_project_id);
  perform app.require(a.actual_start is null, 'Work has started on this activity – it cannot be deleted');
  delete from public.exec_activities where id = p_id;
  perform app.schedule(a.exec_project_id);
end $$;

create or replace function public.set_dependency(p_succ uuid, p_pred uuid, p_type text default 'FS', p_lag int default 0) returns void
language plpgsql security definer set search_path = public as $$
declare s public.exec_activities; loops boolean;
begin
  select * into s from public.exec_activities where id = p_succ;
  perform app.require(s.id is not null, 'Activity not found');
  perform app.programme_edit(s.exec_project_id);
  perform app.require(p_pred <> p_succ, 'An activity cannot depend on itself');
  perform app.require(exists (select 1 from public.exec_activities where id = p_pred and exec_project_id = s.exec_project_id), 'Choose an activity of this project');
  perform app.require(coalesce(p_type, 'FS') in ('FS', 'SS', 'FF', 'SF'), 'Unknown link type');
  -- No loops: the new predecessor must not already follow this activity
  with recursive fw(id) as (
    select succ_id from public.exec_activity_deps where pred_id = p_succ
    union select d.succ_id from public.exec_activity_deps d join fw on d.pred_id = fw.id
  ) select exists (select 1 from fw where id = p_pred) into loops;
  perform app.require(not loops, 'This link would make a loop – the predecessor already depends on this activity');
  insert into public.exec_activity_deps (pred_id, succ_id, dep_type, lag) values (p_pred, p_succ, coalesce(p_type, 'FS'), coalesce(p_lag, 0))
  on conflict (pred_id, succ_id) do update set dep_type = excluded.dep_type, lag = excluded.lag;
  perform app.schedule(s.exec_project_id);
end $$;

create or replace function public.remove_dependency(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  select a.exec_project_id into e from public.exec_activity_deps d join public.exec_activities a on a.id = d.succ_id where d.id = p_id;
  perform app.require(e is not null, 'Not found');
  perform app.programme_edit(e);
  delete from public.exec_activity_deps where id = p_id;
  perform app.schedule(e);
end $$;

-- p: {kind, profile_id, name, qty, unit}
create or replace function public.save_activity_resource(p_activity uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.exec_activities; rid uuid; nm text;
begin
  select * into a from public.exec_activities where id = p_activity;
  perform app.require(a.id is not null, 'Activity not found');
  perform app.programme_edit(a.exec_project_id);
  perform app.require(p ->> 'kind' in ('staff', 'labour', 'equipment', 'subcontractor'), 'Choose the resource type');
  nm := coalesce(nullif(btrim(p ->> 'name'), ''), (select full_name from public.profiles where id = nullif(p ->> 'profile_id', '')::uuid));
  perform app.require(nm is not null, 'Name the resource');
  if p_id is null then
    insert into public.exec_activity_resources (activity_id, kind, profile_id, name, qty, unit)
    values (a.id, p ->> 'kind', nullif(p ->> 'profile_id', '')::uuid, nm, coalesce(nullif(p ->> 'qty', '')::numeric, 1), nullif(btrim(p ->> 'unit'), ''))
    returning id into rid;
  else
    update public.exec_activity_resources set kind = p ->> 'kind', profile_id = nullif(p ->> 'profile_id', '')::uuid, name = nm,
      qty = coalesce(nullif(p ->> 'qty', '')::numeric, 1), unit = nullif(btrim(p ->> 'unit'), '')
    where id = p_id and activity_id = a.id returning id into rid;
  end if;
  return rid;
end $$;

create or replace function public.delete_activity_resource(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  select a.exec_project_id into e from public.exec_activity_resources r join public.exec_activities a on a.id = r.activity_id where r.id = p_id;
  perform app.require(e is not null, 'Not found');
  perform app.programme_edit(e);
  delete from public.exec_activity_resources where id = p_id;
end $$;

-- SEE submits the programme: WBS, activities, links and resources complete
create or replace function public.submit_programme(p_exec uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pg public.exec_programmes; n int;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer submits the programme');
  select * into pg from public.exec_programmes where exec_project_id = p_exec for update;
  perform app.require(pg.exec_project_id is not null and pg.status = 'draft', 'Nothing to submit');
  select count(*) into n from public.exec_activities where exec_project_id = p_exec;
  perform app.require(n > 0, 'Add the WBS and activities first');
  select count(*) into n from public.exec_activities a where a.exec_project_id = p_exec and a.duration > 0
    and not exists (select 1 from public.exec_activity_resources r where r.activity_id = a.id);
  perform app.require(n = 0, format('%s activit%s without resources – allocate the resources first', n, case when n = 1 then 'y' else 'ies' end));
  select count(*) into n from public.exec_activities a where a.exec_project_id = p_exec and a.responsible_id is null and a.duration > 0;
  perform app.require(n = 0, format('%s activit%s without a responsible engineer', n, case when n = 1 then 'y' else 'ies' end));
  perform app.require(pg.version = 0 or coalesce(btrim(p_note), '') <> '', 'Give the reason for the revised programme');
  perform app.schedule(p_exec);
  update public.exec_programmes set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), submit_note = nullif(btrim(p_note), '') where exec_project_id = p_exec;
  perform app.notify_many(app.role_users('sm_projects'), 'exec_programme', case when pg.version = 0 then 'Programme to approve' else 'Revised programme to approve' end,
    concat_ws(' · ', app.exec_head(p_exec), 'finish ' || to_char((select forecast_finish from public.exec_programmes where exec_project_id = p_exec), 'DD Mon YYYY'), nullif(btrim(p_note), '')),
    'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=programme', null, true);
end $$;

create or replace function public.decide_programme(p_exec uuid, p_approve boolean, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare pg public.exec_programmes; v int;
begin
  perform app.require(app.has_role('sm_projects'), 'SM Projects approves the programme');
  select * into pg from public.exec_programmes where exec_project_id = p_exec for update;
  perform app.require(pg.exec_project_id is not null and pg.status = 'submitted', 'Not waiting for approval');
  if not p_approve then
    perform app.require(coalesce(btrim(p_note), '') <> '', 'Say what to change');
    update public.exec_programmes set status = 'draft', decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note) where exec_project_id = p_exec;
    perform app.notify(pg.submitted_by, 'exec_programme', 'Programme returned', app.exec_head(p_exec) || ' · ' || btrim(p_note), 'normal', 'exec_project', p_exec,
      '/execution/' || p_exec || '?tab=programme');
    return pg.version;
  end if;
  perform app.schedule(p_exec);
  v := pg.version + 1;
  update public.exec_activities set bl_start = es, bl_finish = ef where exec_project_id = p_exec;
  insert into public.exec_baselines (exec_project_id, version, approved_by, reason, finish, snapshot)
  select p_exec, v, auth.uid(), coalesce(nullif(btrim(p_note), ''), pg.submit_note), (select forecast_finish from public.exec_programmes where exec_project_id = p_exec),
         coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'start', a.es, 'finish', a.ef, 'duration', a.duration) order by a.sort), '[]')
  from public.exec_activities a where a.exec_project_id = p_exec;
  update public.exec_programmes set status = 'approved', version = v, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), ''),
    baseline_finish = forecast_finish where exec_project_id = p_exec;
  perform app.notify_many(array[pg.submitted_by] || app.project_aes(p_exec), 'exec_programme', format('Programme approved – baseline %s', v),
    app.exec_head(p_exec), 'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=programme');
  return v;
end $$;

-- Progress by the Assistant Engineers (or the SEE): % complete and actual dates
create or replace function public.update_activity_progress(p_id uuid, p_pct numeric, p_start date, p_finish date, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.exec_activities; v_pct numeric := coalesce(p_pct, 0); today date := (now() at time zone app.tz())::date;
begin
  select * into a from public.exec_activities where id = p_id for update;
  perform app.require(a.id is not null, 'Activity not found');
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(a.exec_project_id), 'Assistant Engineers of the project enter progress');
  perform app.require((select status from public.exec_programmes where exec_project_id = a.exec_project_id) = 'approved' or (select version from public.exec_programmes where exec_project_id = a.exec_project_id) > 0,
    'Progress is entered once SM Projects has approved the programme');
  if p_finish is not null then v_pct := 100; end if;
  perform app.require(v_pct between 0 and 100, 'Percent complete is 0 to 100');
  perform app.require(v_pct = 0 or p_start is not null, 'Enter the actual start date');
  perform app.require(v_pct < 100 or p_finish is not null, 'Enter the actual finish date');
  perform app.require(p_start is null or p_start <= today, 'The actual start cannot be in the future');
  perform app.require(p_finish is null or (p_finish >= p_start and p_finish <= today), 'Check the actual finish date');
  update public.exec_activities set pct = v_pct, actual_start = p_start, actual_finish = p_finish, progress_note = nullif(btrim(p_note), ''), progress_by = auth.uid(), progress_at = now()
  where id = a.id;
  perform app.schedule(a.exec_project_id);
end $$;

-- Daily alerts: late critical activities, forecast beyond the contract finish, progress not updated for a week
create or replace function public.programme_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare d date := (p_at at time zone app.tz())::date; r record; n int := 0;
begin
  for r in select pg.exec_project_id from public.exec_programmes pg join public.exec_projects e on e.id = pg.exec_project_id where pg.version > 0 and e.status = 'active' loop
    perform app.schedule(r.exec_project_id);
  end loop;
  -- Critical activity that should have started by the baseline and has not
  for r in select a.*, e.see_id from public.exec_activities a join public.exec_programmes pg on pg.exec_project_id = a.exec_project_id join public.exec_projects e on e.id = a.exec_project_id
           where pg.version > 0 and e.status = 'active' and a.critical and a.actual_start is null and a.bl_start < d and (a.late_alerted is null or a.late_alerted <= d - 7) loop
    perform app.notify_many(array_remove(array[r.responsible_id, r.see_id], null), 'exec_programme', 'Critical activity not started – ' || r.code,
      format('%s · %s · baseline start %s', r.name, app.exec_head(r.exec_project_id), to_char(r.bl_start, 'DD Mon')), 'normal', 'exec_project', r.exec_project_id,
      '/execution/' || r.exec_project_id || '?tab=programme', format('actlate:%s:%s', r.id, d));
    update public.exec_activities set late_alerted = d where id = r.id;
    n := n + 1;
  end loop;
  -- Forecast finish beyond the contract finish (weekly, Mondays)
  if extract(isodow from d) = 1 then
    for r in select pg.*, e.end_date, e.see_id from public.exec_programmes pg join public.exec_projects e on e.id = pg.exec_project_id
             where pg.version > 0 and e.status = 'active' and e.end_date is not null and pg.forecast_finish > e.end_date loop
      perform app.notify_many(array_remove(array[r.see_id], null) || app.role_users('sm_projects'), 'exec_programme', 'Forecast finish beyond the contract date',
        format('%s · forecast %s vs contract %s (%s days)', app.exec_head(r.exec_project_id), to_char(r.forecast_finish, 'DD Mon YYYY'), to_char(r.end_date, 'DD Mon YYYY'), r.forecast_finish - r.end_date),
        'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=programme', format('pgfin:%s:%s', r.exec_project_id, d));
      n := n + 1;
    end loop;
    -- Activities in progress without a progress update for 7 days
    for r in select a.* from public.exec_activities a join public.exec_programmes pg on pg.exec_project_id = a.exec_project_id
             where pg.version > 0 and a.actual_start is not null and a.actual_finish is null and coalesce(a.progress_at, a.actual_start::timestamptz) < p_at - interval '7 days' loop
      perform app.notify(r.responsible_id, 'exec_programme', 'Update the progress – ' || r.code, r.name || ' · ' || app.exec_head(r.exec_project_id), 'normal', 'exec_project',
        r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=programme', format('pgprog:%s:%s', r.id, d));
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function public.programme_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.programme_tick(timestamptz) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('programme-tick', '30 2 * * *', 'select public.programme_tick()');
  end if;
end $$;

revoke execute on function public.save_programme(uuid, date), public.save_wbs(uuid, uuid, uuid, text, text), public.delete_wbs(uuid), public.save_activity(uuid, uuid, jsonb),
  public.delete_activity(uuid), public.set_dependency(uuid, uuid, text, int), public.remove_dependency(uuid), public.save_activity_resource(uuid, uuid, jsonb),
  public.delete_activity_resource(uuid), public.submit_programme(uuid, text), public.decide_programme(uuid, boolean, text),
  public.update_activity_progress(uuid, numeric, date, date, text) from public, anon;
grant execute on function public.save_programme(uuid, date), public.save_wbs(uuid, uuid, uuid, text, text), public.delete_wbs(uuid), public.save_activity(uuid, uuid, jsonb),
  public.delete_activity(uuid), public.set_dependency(uuid, uuid, text, int), public.remove_dependency(uuid), public.save_activity_resource(uuid, uuid, jsonb),
  public.delete_activity_resource(uuid), public.submit_programme(uuid, text), public.decide_programme(uuid, boolean, text),
  public.update_activity_progress(uuid, numeric, date, date, text) to authenticated;

-- Stage gates: from gate 2 the approved programme is required (copied from 20260930000107_exec_qa_handover_cost.sql)
create or replace function app.gate_checks(p_exec uuid, p_gate int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb := '[]'; n int;
begin
  if p_gate >= 2 then
    select count(*) into n from public.exec_programmes where exec_project_id = p_exec and version > 0;
    c := c || jsonb_build_array(jsonb_build_object('check', 'Programme (WBS, activities, resources) approved by SM Projects', 'ok', n > 0, 'detail', case when n > 0 then 'approved' else 'not approved' end));
  end if;
  if p_gate >= 3 then
    select count(*) into n from public.ncrs where exec_project_id = p_exec and status = 'open' and (p_gate >= 4 or severity = 'critical');
    c := c || jsonb_build_array(jsonb_build_object('check', case when p_gate >= 4 then 'No open NCR' else 'No open critical NCR' end, 'ok', n = 0, 'detail', n || ' open'));
  end if;
  if p_gate >= 4 then
    select count(*) into n from public.test_records where exec_project_id = p_exec and (status <> 'verified');
    c := c || jsonb_build_array(jsonb_build_object('check', 'All test records verified', 'ok', n = 0, 'detail', n || ' not verified'));
    select count(*) into n from public.test_records t where t.exec_project_id = p_exec and t.result = 'fail'
      and exists (select 1 from public.ncrs x where x.test_record_id = t.id and x.status = 'open');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No failed test without a closed NCR', 'ok', n = 0, 'detail', n || ' open'));
  end if;
  if p_gate >= 5 then
    select count(*) into n from public.snags where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'All snags closed', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.exec_dossier where exec_project_id = p_exec and mandatory and not done;
    c := c || jsonb_build_array(jsonb_build_object('check', 'Mandatory dossier items present', 'ok', n = 0 and exists (select 1 from public.exec_dossier where exec_project_id = p_exec), 'detail', n || ' missing'));
  end if;
  if p_gate = 6 then
    select count(*) into n from public.material_requests where exec_project_id = p_exec and status in ('submitted', 'pending_smp', 'approved', 'ordered', 'part_received');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open material requests / orders', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.hse_reports where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open HSE reports', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.variations where exec_project_id = p_exec and status in ('raised', 'pricing', 'pending_smp', 'pending_gm', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No variation still open', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.sub_certs where exec_project_id = p_exec and status in ('prepared', 'verified', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'Subcontractors finally certified and paid', 'ok', n = 0, 'detail', n || ' open'));
  end if;
  return c;
end $$;

-- Approvals (copied from 20260930000108_exec_handover_requests.sql with the programme)
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
  union all
  select 'exec_plan', pl.id, 'exec_plan', format('Weekly plan – %s – week of %s', app.display_name(pl.ae_id), to_char(pl.week_start, 'DD Mon')),
         concat_ws(' · ', app.exec_head(pl.exec_project_id), case when pl.is_late then 'submitted late' end), pl.ae_id, app.display_name(pl.ae_id),
         pl.submitted_at, null::uuid, '/execution/plan/' || pl.id, null
  from public.exec_plans pl where pl.status = 'submitted' and app.has_role('senior_elec_engineer')
  union all
  select 'variation', v.id, 'exec_variation',
         format('Variation %s – %s%s', v.code, v.title,
                case when v.value_lkr is not null then format(' (%s%s)', case when v.value_lkr > 0 then '+' else '−' end, app.fmt_money(abs(v.value_lkr), 'LKR')) else '' end),
         app.exec_head(v.exec_project_id), v.raised_by, app.display_name(v.raised_by), v.raised_at, null::uuid, '/execution/variation/' || v.id,
         case v.status when 'raised' then 'Screen' when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.variations v
  where (v.status = 'raised' and app.has_role('senior_elec_engineer')) or (v.status = 'pending_smp' and app.has_role('sm_projects'))
     or (v.status = 'pending_gm' and app.has_role('gm'))
  union all
  select 'material_request', m.id, 'exec_material', format('Material request %s', m.code), app.mr_head(m), m.requested_by, app.display_name(m.requested_by),
         m.requested_at, null::uuid, '/execution/material/' || m.id, case m.status when 'submitted' then 'Senior Electrical Engineer' else 'SM Projects' end
  from public.material_requests m
  where (m.status = 'submitted' and app.has_role('senior_elec_engineer')) or (m.status = 'pending_smp' and app.has_role('sm_projects'))
  union all
  select 'design_query', q.id, 'exec_design_query', format('Design query %s', q.code), concat_ws(' · ', app.exec_head(q.exec_project_id), q.question),
         q.raised_by, app.display_name(q.raised_by), q.raised_at, null::uuid, '/execution/query/' || q.id,
         case q.status when 'raised' then 'Screen' else 'Answer' end
  from public.design_queries q
  where (q.status = 'raised' and app.has_role('senior_elec_engineer')) or (q.status = 'forwarded' and app.has_role('design_manager'))
  union all
  select 'exec_gate', g.id, 'exec_gate', format('Stage gate %s – %s', g.gate, app.exec_head(g.exec_project_id)), g.note, g.requested_by,
         app.display_name(g.requested_by), g.requested_at, null::uuid, '/execution/' || g.exec_project_id, null
  from public.exec_gates g where g.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'sub_cert', c.id, 'exec_sub_cert', format('Subcontractor payment %s – %s', c.code, c.subcontractor), app.exec_head(c.exec_project_id) || ' · ' || app.fmt_money(c.net, 'LKR'),
         c.prepared_by, app.display_name(c.prepared_by), c.prepared_at, null::uuid, '/execution/' || c.exec_project_id || '?tab=cost',
         case c.status when 'prepared' then 'Verify' when 'verified' then 'Approve' else 'Pay' end
  from public.sub_certs c
  where (c.status = 'prepared' and app.has_role('senior_elec_engineer')) or (c.status = 'verified' and app.has_role('sm_projects'))
     or (c.status = 'approved' and app.has_role('operations_exec'))
  union all
  select 'test_record', t.id, 'exec_test', format('Test record %s – %s', t.code, t.system), app.exec_head(t.exec_project_id) || ' · ' || t.result, t.performed_by,
         app.display_name(t.performed_by), t.performed_at, null::uuid, '/execution/' || t.exec_project_id || '?tab=qa', 'Verify'
  from public.test_records t where t.status = 'submitted' and app.has_role('senior_elec_engineer')
  union all
  select 'exec_request', r.id, 'exec_request', format('%s – %s', case r.kind when 'won' then 'Hand over to execution' else 'Project won before the system' end, r.name),
         concat_ws(' · ', r.client_name, r.note), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid, '/execution/handover/' || r.id, 'SM Projects'
  from public.exec_requests r where r.status = 'pending_smp' and app.has_role('sm_projects')
  union all
  select 'exec_programme', pg.exec_project_id, 'exec_programme', case when pg.version = 0 then 'Programme – ' else 'Revised programme – ' end || app.exec_head(pg.exec_project_id),
         concat_ws(' · ', 'finish ' || to_char(pg.forecast_finish, 'DD Mon YYYY'), pg.submit_note), pg.submitted_by, app.display_name(pg.submitted_by), pg.submitted_at, null::uuid,
         '/execution/' || pg.exec_project_id || '?tab=programme', 'SM Projects'
  from public.exec_programmes pg where pg.status = 'submitted' and app.has_role('sm_projects')
$$;

-- Open items include programme activities (copied from 20260930000107_exec_qa_handover_cost.sql)
create or replace function app.open_items(p_user uuid) returns table (kind text, id uuid, title text, url text)
language sql stable security definer set search_path = public as $$
  select 'Engineering job', j.id, concat_ws(' · ', j.code, j.title), '/engineering/' || j.id
  from public.eng_jobs j where j.assignee_id = p_user and j.status in ('assigned', 'in_progress', 'on_hold')
  union all
  select 'Meeting action', a.id, a.action, '/meetings'
  from public.sales_meeting_actions a where a.status = 'open' and (a.assignee_id = p_user or (a.owner_id = p_user and a.assignee_id is null))
  union all
  select 'Weekly plan', pl.id, app.exec_head(pl.exec_project_id) || ' · week of ' || to_char(pl.week_start, 'DD Mon'), '/execution/plan/' || pl.id
  from public.exec_plans pl where pl.ae_id = p_user and pl.week_start + 6 >= (now() at time zone app.tz())::date
  union all
  select 'HSE action', h.id, h.action, '/execution/hse/' || h.report_id
  from public.hse_actions h where h.assignee_id = p_user and h.status = 'open'
  union all
  select 'NCR', n.id, concat_ws(' · ', n.code, n.description), '/execution/' || n.exec_project_id || '?tab=qa'
  from public.ncrs n where n.owner_id = p_user and n.status = 'open'
  union all
  select 'Programme activity', a.id, concat_ws(' · ', a.code, a.name), '/execution/' || a.exec_project_id || '?tab=programme'
  from public.exec_activities a where a.responsible_id = p_user and a.actual_finish is null
$$;

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
  update public.exec_plans pl set ae_id = p_to
  where pl.ae_id = p_from and pl.week_start + 6 >= (now() at time zone app.tz())::date
    and not exists (select 1 from public.exec_plans x where x.exec_project_id = pl.exec_project_id and x.ae_id = p_to and x.week_start = pl.week_start);
  get diagnostics k = row_count; n := n + k;
  update public.hse_actions set assignee_id = p_to where assignee_id = p_from and status = 'open';
  get diagnostics k = row_count; n := n + k;
  update public.ncrs set owner_id = p_to where owner_id = p_from and status = 'open';
  get diagnostics k = row_count; n := n + k;
  update public.exec_activities set responsible_id = p_to where responsible_id = p_from and actual_finish is null;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
