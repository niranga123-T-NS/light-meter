-- Site location, supervisor check-in and the daily toolbox meeting.
--  * The SEE sets the site's GPS location (and radius) when opening the project.
--  * Before the toolbox meeting the subcontractor supervisor checks in on site: the location is verified against the site
--    and recorded, and the AEs and the SEE are told.
--  * The toolbox meeting (08:30 every working day) is held once the day has started, the supervisor has checked in on site
--    and has an approved work permit for the day. Held after 08:50 it is marked late; not held by 08:50 the AEs and the
--    SEE are alerted.
--  * No supervisor daily report without the day's toolbox meeting.

alter table public.exec_projects add column if not exists site_lat double precision;
alter table public.exec_projects add column if not exists site_lng double precision;
alter table public.exec_projects add column if not exists site_radius_m int not null default 300 check (site_radius_m between 20 and 5000);
alter table public.exec_projects add column if not exists site_set_by uuid references public.profiles (id);
alter table public.exec_projects add column if not exists site_set_at timestamptz;
alter table public.hse_records add column if not exists tbt_late boolean not null default false;

create or replace function public.set_site_location(p_exec uuid, p_lat double precision, p_lng double precision, p_radius int default 300) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'The Senior Electrical Engineer sets the site location');
  perform app.require(p_lat between -90 and 90 and p_lng between -180 and 180 and not (p_lat = 0 and p_lng = 0), 'Enter a valid location (latitude, longitude)');
  perform app.require(coalesce(p_radius, 300) between 20 and 5000, 'The site radius is 20 – 5000 m');
  update public.exec_projects set site_lat = p_lat, site_lng = p_lng, site_radius_m = coalesce(p_radius, 300), site_set_by = auth.uid(), site_set_at = now() where id = p_exec;
  perform app.require(found, 'Not found');
end $$;

-- Distance in metres between two points
create or replace function app.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) returns double precision
language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create table if not exists public.site_checkins (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) default auth.uid(),
  at timestamptz not null default now(),
  day date not null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  distance_m double precision not null,
  within boolean not null
);
create index if not exists site_checkins_day on public.site_checkins (exec_project_id, day, user_id);
alter table public.site_checkins enable row level security;
drop policy if exists site_checkins_read on public.site_checkins;
create policy site_checkins_read on public.site_checkins for select to authenticated using (user_id = auth.uid() or app.is_exec_internal(exec_project_id));
grant select on public.site_checkins to authenticated;

-- Check in on site: the location is verified against the site and recorded; the AEs and the SEE are told
create or replace function public.site_checkin(p_exec uuid, p_lat double precision, p_lng double precision, p_accuracy double precision default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; d double precision; ok boolean; today date := (now() at time zone app.tz())::date;
begin
  perform app.require(app.is_exec_member(p_exec), 'You are not on this project');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(e.site_lat is not null, 'The site location is not set yet – the Senior Electrical Engineer sets it on the project');
  perform app.require(p_lat is not null and p_lng is not null, 'Your location could not be read – allow location access and try again');
  d := app.distance_m(e.site_lat, e.site_lng, p_lat, p_lng);
  ok := d <= e.site_radius_m + least(coalesce(p_accuracy, 0), 100);
  insert into public.site_checkins (exec_project_id, user_id, day, lat, lng, accuracy_m, distance_m, within)
  values (p_exec, auth.uid(), today, p_lat, p_lng, p_accuracy, round(d::numeric, 0), ok);
  perform app.notify_many(array(select unnest(app.project_aes(p_exec)) union select unnest(app.role_users('senior_elec_engineer'))), 'site_checkin',
    case when ok then format('Checked in on site – %s', app.display_name(auth.uid())) else format('Check-in away from site – %s', app.display_name(auth.uid())) end,
    format('%s · %s · %s from the site point', app.exec_head(p_exec), to_char(now() at time zone app.tz(), 'Dy DD Mon HH24:MI'),
      case when d < 1000 then round(d::numeric) || ' m' else round((d / 1000)::numeric, 1) || ' km' end),
    case when ok then 'normal' else 'critical' end::public.priority, 'exec_project', p_exec, '/execution/' || p_exec, null, false);
  return jsonb_build_object('within', ok, 'distance_m', round(d::numeric, 0), 'radius_m', e.site_radius_m);
end $$;

-- The supervisor is checked in on site today
create or replace function app.checked_in_today(p_exec uuid, p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.site_checkins where exec_project_id = p_exec and user_id = p_user and within and day = (now() at time zone app.tz())::date)
$$;
-- Toolbox meeting at 08:30 – late after 08:50
create or replace function app.tbt_late_at(p_day date) returns timestamptz language sql stable as $$
  select (p_day + time '08:50') at time zone app.tz()
$$;


create or replace function public.save_tbt(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; v_code text; h jsonb := coalesce(p -> 'header', '{}'); pm public.hse_records; st timestamptz := coalesce(nullif(p ->> 'starts_at', '')::timestamptz, now());
        today date := (now() at time zone app.tz())::date;
begin
  perform app.require(app.is_exec_member(p_exec) or app.has_role('senior_elec_engineer'), 'You are not on this project');
  perform app.require(coalesce(btrim(h ->> 'activity'), '') <> '', 'Enter the activity / work programme');
  perform app.require(coalesce(btrim(h ->> 'hazards'), '') <> '', 'Enter the safety issues (hazards and risks)');
  perform app.require(jsonb_array_length(coalesce(p -> 'participants', '[]')) > 0, 'Add the participants');
  if nullif(p ->> 'permit_id', '') is not null then
    select * into pm from public.hse_records where id = (p ->> 'permit_id')::uuid and exec_project_id = p_exec and code like 'PTW-%';
    perform app.require(pm.id is not null, 'Choose a permit of this project');
  end if;
  -- Subcontractor supervisor: the day has started, checked in on site, and an approved work permit for the day
  if app.has_role('sub_supervisor') then
    perform app.require((st at time zone app.tz())::date = today, 'The toolbox meeting is held on the day itself');
    perform app.require(app.checked_in_today(p_exec, auth.uid()), 'Check in on site first – your location is verified before the toolbox meeting');
    perform app.require(exists (select 1 from public.hse_records r where r.exec_project_id = p_exec and r.created_by = auth.uid() and r.status in ('active', 'closed')
                                   and app.permit_covers(r, today)), 'No approved work permit for today – the toolbox meeting opens once a permit is approved');
  end if;
  v_code := app.next_code('TBT');
  insert into public.hse_records (code, exec_project_id, form_code, header, answers, participants, status, starts_at, related_id,
                                  sup_by, sup_at, ehs_by, ehs_at)
  values (v_code, p_exec, 'TBT-01', h, coalesce(p -> 'answers', '{}'), p -> 'participants', 'submitted', st, pm.id,
          case when app.has_role('sub_supervisor') then auth.uid() end, case when app.has_role('sub_supervisor') then now() end,
          case when app.has_role('assistant_engineer') and app.is_ehs(p_exec) then auth.uid() end, case when app.has_role('assistant_engineer') and app.is_ehs(p_exec) then now() end)
  returning id into rid;
  if st > app.tbt_late_at((st at time zone app.tz())::date) then
    update public.hse_records set tbt_late = true where id = rid;
    perform app.notify_many(array(select unnest(app.project_aes(p_exec)) union select unnest(app.role_users('senior_elec_engineer'))), 'hse_tbt',
      format('Toolbox meeting late – %s', app.display_name(auth.uid())),
      format('%s · %s held at %s (due 08:30)', app.exec_head(p_exec), v_code, to_char(st at time zone app.tz(), 'HH24:MI')), 'normal', 'hse_record', rid, '/execution/hse/form/' || rid, null, false);
  end if;
  if pm.id is not null then
    update public.hse_records set header = header || jsonb_build_object('tbt_no', v_code), related_id = coalesce(related_id, rid) where id = pm.id;
  end if;
  return rid;
end $$;

-- Every 10 minutes from 08:50 on a working day: supervisors with work today (approved plan or a work permit) and no toolbox
-- meeting yet – the AEs and the SEE are alerted (once a day per supervisor)
create or replace function public.toolbox_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare d date := (p_at at time zone app.tz())::date; r record; n int := 0;
begin
  if not app.is_working_day(d) or p_at < app.tbt_late_at(d) then return 0; end if;
  for r in
    select distinct m.exec_project_id, m.user_id
      from public.exec_members m join public.exec_projects e on e.id = m.exec_project_id
     where m.member_role = 'sub_supervisor' and m.active and e.status = 'active'
       and (exists (select 1 from public.sub_plans s join public.sub_plan_items i on i.sub_plan_id = s.id
                     where s.exec_project_id = m.exec_project_id and s.supervisor_id = m.user_id and s.status = 'approved' and i.day = d)
            or exists (select 1 from public.hse_records x where x.exec_project_id = m.exec_project_id and x.created_by = m.user_id and x.code like 'PTW-%'
                        and x.status in ('submitted', 'active') and app.permit_covers(x, d)))
       and not exists (select 1 from public.hse_records t where t.exec_project_id = m.exec_project_id and t.created_by = m.user_id and t.form_code = 'TBT-01'
                        and (t.starts_at at time zone app.tz())::date = d)
  loop
    perform app.notify_many(array(select unnest(app.project_aes(r.exec_project_id)) union select unnest(app.role_users('senior_elec_engineer')) union select r.user_id), 'hse_tbt',
      format('Toolbox meeting late – %s', app.display_name(r.user_id)),
      format('%s · no toolbox meeting by 08:50 (due 08:30) · %s', app.exec_head(r.exec_project_id), to_char(d, 'Dy DD Mon')),
      'critical', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=planning', 'tbt_late:' || r.exec_project_id || ':' || r.user_id || ':' || d);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.toolbox_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.toolbox_tick(timestamptz) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('toolbox-tick', '*/10 * * * *', 'select public.toolbox_tick()');
  end if;
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
  perform app.require(lvl <> 'supervisor' or exists (select 1 from public.hse_records r where r.exec_project_id = p_exec and r.created_by = auth.uid()
      and r.form_code = 'TBT-01' and (r.starts_at at time zone app.tz())::date = p_date),
    'Hold and record the day''s toolbox meeting first – no daily report without it');
  if lvl = 'supervisor' then
    tb := array(select distinct tid from unnest(tb || array(select r.id from public.hse_records r where r.exec_project_id = p_exec and r.created_by = auth.uid()
      and r.form_code = 'TBT-01' and (r.starts_at at time zone app.tz())::date = p_date)) tid);
    p := p || '{"toolbox_talk": true}';
  end if;
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

revoke execute on function public.set_site_location(uuid, double precision, double precision, int), public.site_checkin(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.set_site_location(uuid, double precision, double precision, int), public.site_checkin(uuid, double precision, double precision, double precision) to authenticated, service_role;
