-- Subcontractor plan and work permits, corrected: the weekly plan is made and submitted without permits. Every day the
-- supervisor requests the work permits for the planned work (one permit can cover several planned works, a planned work
-- can need several permit types) – and permits for work not in the plan too. Next day's permits are submitted to the AE
-- before 20:00 today: reminder at 18:00, and at 20:00 the supervisor and the AEs are told what is still without a permit.
-- The supervisor's daily report refers to the day's plan (result of each planned work) and the work permits.

-- Planned work ↔ work permits
create table if not exists public.sub_plan_item_permits (
  item_id uuid not null references public.sub_plan_items (id) on delete cascade,
  permit_id uuid not null references public.hse_records (id) on delete cascade,
  primary key (item_id, permit_id)
);
create index if not exists sub_plan_item_permits_permit on public.sub_plan_item_permits (permit_id);
insert into public.sub_plan_item_permits (item_id, permit_id) select id, permit_id from public.sub_plan_items where permit_id is not null on conflict do nothing;
alter table public.sub_plan_item_permits enable row level security;
drop policy if exists sub_plan_item_permits_read on public.sub_plan_item_permits;
create policy sub_plan_item_permits_read on public.sub_plan_item_permits for select to authenticated using (
  exists (select 1 from public.sub_plan_items i where i.id = item_id and app.can_read_sub_plan(i.sub_plan_id)));
grant select on public.sub_plan_item_permits to authenticated;
drop function if exists public.set_sub_plan_permit(uuid, uuid);

-- A permit requested after 20:00 of the day before its work is late
alter table public.hse_records add column if not exists late_request boolean not null default false;
create or replace function app.permit_due(p_day date) returns timestamptz language sql stable as $$
  select ((p_day - 1) + time '20:00') at time zone app.tz()
$$;
create or replace function app.hse_records_late() returns trigger language plpgsql as $$
begin
  if new.code like 'PTW-%' and new.starts_at is not null then
    new.late_request := now() > app.permit_due((new.starts_at at time zone app.tz())::date);
  end if;
  return new;
end $$;
drop trigger if exists hse_records_late on public.hse_records;
create trigger hse_records_late before insert on public.hse_records for each row execute function app.hse_records_late();

create or replace function app.permit_covers(r public.hse_records, p_day date) returns boolean language sql stable as $$
  select r.code like 'PTW-%' and p_day between (r.starts_at at time zone app.tz())::date and (r.ends_at at time zone app.tz())::date
$$;
create or replace function app.permit_ok(r public.hse_records, p_day date) returns boolean language sql stable as $$
  select app.permit_covers(r, p_day) and r.status in ('active', 'closed')
$$;
-- A planned work has a permit requested / approved for its day
create or replace function app.item_has_permit(p_item uuid, p_day date) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sub_plan_item_permits l join public.hse_records r on r.id = l.permit_id
                  where l.item_id = p_item and r.status in ('submitted', 'active', 'closed') and app.permit_covers(r, p_day))
$$;

-- The planned works a permit covers (set by the supervisor who requested it; none = work not in the plan)
create or replace function public.link_permit_plan_items(p_permit uuid, p_items uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare r public.hse_records; bad text;
begin
  select * into r from public.hse_records where id = p_permit;
  perform app.require(r.id is not null and r.code like 'PTW-%', 'Not found');
  perform app.require(r.created_by = auth.uid(), 'The person who requested the permit links it to the plan');
  perform app.require(r.status in ('submitted', 'active'), 'That permit is no longer open');
  select string_agg(i.title, ', ') into bad from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
   where i.id = any (coalesce(p_items, '{}')) and (s.supervisor_id <> auth.uid() or s.exec_project_id <> r.exec_project_id or not app.permit_covers(r, i.day));
  perform app.require(bad is null, 'The permit does not cover the day of: ' || coalesce(bad, ''));
  perform app.require(cardinality(coalesce(p_items, '{}')) = (select count(*) from public.sub_plan_items where id = any (p_items)), 'Planned work not found');
  delete from public.sub_plan_item_permits where permit_id = r.id and not (item_id = any (coalesce(p_items, '{}')));
  insert into public.sub_plan_item_permits (item_id, permit_id) select x, r.id from unnest(coalesce(p_items, '{}')) x on conflict do nothing;
end $$;

-- 18:00 reminder to the supervisor, 20:00 alert to the supervisor and the project's AEs: tomorrow's planned work without a permit
create or replace function public.permit_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare loc timestamp := p_at at time zone app.tz(); tmr date := (p_at at time zone app.tz())::date + 1; s record; n int := 0;
begin
  if loc::time < time '18:00' then return 0; end if;
  for s in
    select p.id, p.exec_project_id, p.supervisor_id, string_agg(i.title, ' · ' order by i.title) as works, count(*) as k
      from public.sub_plans p join public.sub_plan_items i on i.sub_plan_id = p.id join public.exec_projects e on e.id = p.exec_project_id
     where p.status in ('submitted', 'approved') and e.status = 'active' and i.day = tmr and i.status = 'planned'
       and not app.item_has_permit(i.id, tmr)
     group by p.id, p.exec_project_id, p.supervisor_id
  loop
    if loc::time < time '20:00' then
      perform app.notify(s.supervisor_id, 'hse_permit', 'Submit tomorrow''s work permits by 20:00',
        format('%s · %s · %s planned work%s without a permit: %s', app.exec_head(s.exec_project_id), to_char(tmr, 'Dy DD Mon'), s.k, case when s.k = 1 then '' else 's' end, s.works),
        'normal', 'exec_project', s.exec_project_id, '/execution/' || s.exec_project_id || '?tab=planning', 'permit_remind:' || s.id || ':' || tmr);
    else
      perform app.notify_many(array(select unnest(app.project_aes(s.exec_project_id)) union select s.supervisor_id), 'hse_permit',
        format('Work permits not submitted by 20:00 – %s', app.display_name(s.supervisor_id)),
        format('%s · %s · %s planned work%s without a permit: %s', app.exec_head(s.exec_project_id), to_char(tmr, 'Dy DD Mon'), s.k, case when s.k = 1 then '' else 's' end, s.works),
        'critical', 'exec_project', s.exec_project_id, '/execution/' || s.exec_project_id || '?tab=planning', 'permit_late:' || s.id || ':' || tmr);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.permit_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.permit_tick(timestamptz) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('permit-tick', '*/15 * * * *', 'select public.permit_tick()');
  end if;
end $$;

-- The supervisor's daily report: the day's plan (result of each planned work) and the work permits referred
alter table public.exec_reports add column if not exists permit_ids uuid[] not null default '{}';
alter table public.exec_reports add column if not exists sub_plan_updates jsonb not null default '[]';


create or replace function public.submit_sub_plan(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sub_plans := app.sub_plan_for_edit(p_plan);
begin
  perform app.require(exists (select 1 from public.sub_plan_items where sub_plan_id = s.id), 'Pick or add the work for the week first');
  update public.sub_plans set status = 'submitted', submitted_at = now() where id = s.id;
  perform app.notify_many(app.project_aes(s.exec_project_id), 'exec_plan', 'Subcontractor plan to approve',
    format('%s · week of %s · %s', app.display_name(s.supervisor_id), to_char(s.week_start, 'DD Mon'), app.exec_head(s.exec_project_id)),
    'normal', 'exec_project', s.exec_project_id, '/execution/sub-plan?plan=' || s.id, null, true);
end $$;

create or replace function public.submit_exec_report(p_exec uuid, p_date date, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare tb uuid[]; lvl text; x public.exec_reports; rid uuid; late boolean; today date := (now() at time zone app.tz())::date; u jsonb; it public.exec_plan_items; snap jsonb := '[]'; si public.sub_plan_items; pids uuid[] := '{}'; ssnap jsonb := '[]'; miss text;
begin
  perform app.require(app.is_exec_member(p_exec), 'You are not on this project');
  lvl := case app.my_role() when 'sub_supervisor' then 'supervisor' when 'assistant_engineer' then 'ae' end;
  perform app.require(lvl is not null, 'Daily reports are written by subcontractor supervisors and Assistant Engineers');
  perform app.require(p_date is not null and p_date <= today and p_date >= today - 3, 'Report for today or the last three days');
  perform app.require(coalesce(btrim(p ->> 'work_done'), '') <> '', 'Describe the work done');
  perform app.require(lvl <> 'supervisor' or nullif(p ->> 'crew_count', '') is not null, 'Enter the crew on site');
  select coalesce(array_agg(tv::uuid), '{}') into tb from jsonb_array_elements_text(case when jsonb_typeof(p -> 'toolbox_records') = 'array' then p -> 'toolbox_records' else '[]' end) tv;
  perform app.require(not coalesce((p ->> 'toolbox_talk')::boolean, false) or cardinality(tb) > 0 or coalesce(btrim(p ->> 'toolbox_topic'), '') <> '',
    'Choose the toolbox talk record (or enter the topic)');
  perform app.require(not exists (select 1 from unnest(tb) t where not exists (select 1 from public.hse_records r
      where r.id = t and r.exec_project_id = p_exec and r.form_code = 'TBT-01' and (r.starts_at at time zone app.tz())::date = p_date)),
    'The toolbox talk must be one of this project on the report day');
  late := now() > app.report_due(lvl, p_date);
  select * into x from public.exec_reports where exec_project_id = p_exec and report_date = p_date and author_id = auth.uid() for update;
  perform app.require(x.id is null or x.status = 'returned', 'Already submitted for this day');
  if x.id is null then
    insert into public.exec_reports (exec_project_id, report_date, level, crew_count, crew, work_done, work_next, delays, inspections, issues, hse_notes,
                                     toolbox_talk, toolbox_topic, safety_check, weather, visitors, is_late)
    values (p_exec, p_date, lvl, nullif(p ->> 'crew_count', '')::int, nullif(btrim(p ->> 'crew'), ''), btrim(p ->> 'work_done'), nullif(btrim(p ->> 'work_next'), ''),
            nullif(btrim(p ->> 'delays'), ''), nullif(btrim(p ->> 'inspections'), ''), nullif(btrim(p ->> 'issues'), ''), nullif(btrim(p ->> 'hse_notes'), ''),
            coalesce((p ->> 'toolbox_talk')::boolean, false), nullif(btrim(p ->> 'toolbox_topic'), ''), coalesce((p ->> 'safety_check')::boolean, false),
            nullif(btrim(p ->> 'weather'), ''), nullif(btrim(p ->> 'visitors'), ''), late)
    returning id into rid;
  else
    update public.exec_reports set status = 'submitted', submitted_at = now(), crew_count = nullif(p ->> 'crew_count', '')::int, crew = nullif(btrim(p ->> 'crew'), ''),
      work_done = btrim(p ->> 'work_done'), work_next = nullif(btrim(p ->> 'work_next'), ''), delays = nullif(btrim(p ->> 'delays'), ''),
      inspections = nullif(btrim(p ->> 'inspections'), ''), issues = nullif(btrim(p ->> 'issues'), ''), hse_notes = nullif(btrim(p ->> 'hse_notes'), ''),
      toolbox_talk = coalesce((p ->> 'toolbox_talk')::boolean, false), toolbox_topic = nullif(btrim(p ->> 'toolbox_topic'), ''),
      safety_check = coalesce((p ->> 'safety_check')::boolean, false), weather = nullif(btrim(p ->> 'weather'), ''), visitors = nullif(btrim(p ->> 'visitors'), '')
    where id = x.id;
    rid := x.id;
  end if;
  -- Planned activities updated from the report: [{id, status, done_qty, note}]
  for u in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'items') = 'array' then p -> 'items' else '[]' end) loop
    select * into it from public.exec_plan_items where id = nullif(u ->> 'id', '')::uuid;
    perform app.require(it.id is not null and it.exec_project_id = p_exec, 'Planned activity not found on this project');
    perform public.update_plan_item(it.id, u ->> 'status', nullif(u ->> 'done_qty', '')::numeric, nullif(btrim(u ->> 'note'), ''));
    select * into it from public.exec_plan_items where id = it.id;
    snap := snap || jsonb_build_array(jsonb_build_object('id', it.id, 'day', it.day, 'kind', it.kind, 'title', it.title, 'zone', it.zone, 'qty', it.qty, 'unit', it.unit,
      'supervisor_id', it.supervisor_id, 'status', it.status, 'done_qty', it.done_qty, 'note', it.result_note, 'photos', '[]'::jsonb));
  end loop;
  -- Supervisor: results of the day's planned works (own approved plan) and the work permits of the day
  if lvl = 'supervisor' then
    for u in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'sub_items') = 'array' then p -> 'sub_items' else '[]' end) loop
      select i.* into si from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
       where i.id = nullif(u ->> 'id', '')::uuid and s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved' and i.day <= p_date;
      perform app.require(si.id is not null, 'Planned work not found in your approved plan');
      perform public.update_sub_plan_item(si.id, u ->> 'status', nullif(u ->> 'done_qty', '')::numeric, nullif(btrim(u ->> 'note'), ''));
    end loop;
    -- planned works taken from the engineers' plan that were reported in section A carry that result
    update public.sub_plan_items i set status = pi.status, done_qty = pi.done_qty, result_note = pi.result_note, updated_at = now()
      from public.exec_plan_items pi, public.sub_plans s
     where i.ae_item_id = pi.id and s.id = i.sub_plan_id and s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved'
       and i.day = p_date and i.status = 'planned' and pi.status <> 'planned';
    select string_agg(i.title, ', ' order by i.title) into miss from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
     where s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved' and i.day = p_date and i.status = 'planned';
    perform app.require(miss is null, 'Give the result of each work of your plan for the day: ' || coalesce(miss, ''));
    select coalesce(array_agg(distinct tv::uuid), '{}') into pids from jsonb_array_elements_text(case when jsonb_typeof(p -> 'permit_ids') = 'array' then p -> 'permit_ids' else '[]' end) tv;
    perform app.require(not exists (select 1 from unnest(pids) t where not exists (select 1 from public.hse_records r
        where r.id = t and r.exec_project_id = p_exec and r.created_by = auth.uid() and r.status in ('active', 'closed') and app.permit_covers(r, p_date))),
      'Refer only your approved work permits of the report day');
    perform app.require(cardinality(pids) > 0 or not exists (select 1 from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
        where s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved' and i.day = p_date and i.status in ('done', 'partial')),
      'Refer the work permit(s) the work was done under');
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'zone', i.zone, 'qty', i.qty, 'unit', i.unit, 'additional', i.additional,
             'status', i.status, 'done_qty', i.done_qty, 'note', i.result_note,
             'permits', (select coalesce(jsonb_agg(r.code order by r.code), '[]') from public.sub_plan_item_permits l join public.hse_records r on r.id = l.permit_id where l.item_id = i.id))
             order by i.created_at), '[]') into ssnap
      from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
     where s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved' and i.day = p_date;
  end if;
  update public.exec_reports set item_updates = snap, permit_ids = pids, sub_plan_updates = ssnap,
    toolbox_records = case when coalesce((p ->> 'toolbox_talk')::boolean, false) then tb else '{}' end,
    toolbox_topic = case when coalesce((p ->> 'toolbox_talk')::boolean, false) and coalesce(btrim(p ->> 'toolbox_topic'), '') = '' and cardinality(tb) > 0
      then (select string_agg(r.code || ' – ' || left(coalesce(r.header ->> 'activity', ''), 80), ' · ' order by r.starts_at) from public.hse_records r where r.id = any (tb))
      else toolbox_topic end
  where id = rid;
  if late and x.id is null then
    insert into public.exec_report_lateness (exec_project_id, user_id, report_date, level, kind) values (p_exec, auth.uid(), p_date, lvl, 'late')
    on conflict (exec_project_id, user_id, report_date) do update set kind = 'late';
  end if;
  if lvl = 'supervisor' then
    perform app.notify_many(app.project_aes(p_exec), 'exec_report', format('Daily report to verify – %s%s', app.display_name(auth.uid()), case when late then ' (late)' else '' end),
      format('%s · %s', app.exec_head(p_exec), to_char(p_date, 'Dy DD Mon')), 'normal', 'exec_report', rid, '/execution/report/' || rid);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_report', format('Daily report – %s%s', app.display_name(auth.uid()), case when late then ' (late)' else '' end),
      format('%s · %s', app.exec_head(p_exec), to_char(p_date, 'Dy DD Mon')), 'normal', 'exec_report', rid, '/execution/report/' || rid);
  end if;
  return rid;
end $$;

revoke execute on function public.link_permit_plan_items(uuid, uuid[]) from public, anon;
grant execute on function public.link_permit_plan_items(uuid, uuid[]) to authenticated, service_role;
