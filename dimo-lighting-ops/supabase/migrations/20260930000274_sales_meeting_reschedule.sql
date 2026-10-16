-- SM Projects can move a week's sales meeting to another day and time of that week (Monday – Saturday), with the
-- approval of GM / DGM. The meeting keeps its week (its Monday is still the key for invitations, leave and the pack);
-- held_on is the day it actually takes place. Starting, attendance, reminders, absent marking, leave cut-offs and the
-- block on planning visits in the meeting time all follow the actual day and time.

alter table public.sales_meetings add column held_on date;
alter table public.sales_meetings add constraint sales_meetings_held_on
  check (held_on is null or (team = 'sales' and held_on between meeting_date and meeting_date + 5));

create table public.meeting_reschedules (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.sales_meetings(id) on delete cascade,
  week_of date not null,
  from_date date not null, from_starts time not null, from_ends time not null,
  to_date date not null, to_starts time not null, to_ends time not null check (to_ends > to_starts),
  reason text not null check (btrim(reason) <> ''),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text
);
create unique index meeting_reschedules_one_pending on public.meeting_reschedules (meeting_id) where status = 'pending';
alter table public.meeting_reschedules enable row level security;
create policy meeting_reschedules_read on public.meeting_reschedules for select to authenticated using (app.has_role('sm_projects', 'gm'));
grant select on public.meeting_reschedules to authenticated;

-- The day the meeting is held
create or replace function app.meeting_day(m public.sales_meetings) returns date
language sql stable as $$ select coalesce(m.held_on, m.meeting_date) $$;

create or replace function app.meeting_starts(m public.sales_meetings) returns timestamptz
language sql stable as $$ select (coalesce(m.held_on, m.meeting_date) + m.starts_at) at time zone app.tz() $$;

create or replace function app.meeting_ends(m public.sales_meetings) returns timestamptz
language sql stable as $$ select (coalesce(m.held_on, m.meeting_date) + m.ends_at) at time zone app.tz() $$;

-- The sales meeting slot on a day: a meeting held that day, or a Monday whose meeting has not been moved
create or replace function app.sales_meeting_window(p_day date) returns table (week_of date, starts time, ends time)
language sql stable security definer set search_path = public as $$
  select m.meeting_date, m.starts_at, m.ends_at from public.sales_meetings m where m.team = 'sales' and coalesce(m.held_on, m.meeting_date) = p_day
  union all
  select p_day, time '08:30', time '12:00'
   where extract(isodow from p_day) = 1 and not exists (select 1 from public.sales_meetings m where m.team = 'sales' and m.meeting_date = p_day)
  limit 1
$$;

-- For everyone (sales persons cannot read the meeting itself): when the sales meeting of a week is held
create or replace function public.sales_meeting_slot(p_week date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('day', coalesce(m.held_on, m.meeting_date), 'starts', to_char(m.starts_at, 'HH24:MI'), 'ends', to_char(m.ends_at, 'HH24:MI'), 'moved', m.held_on is not null or m.starts_at <> time '08:30' or m.ends_at <> time '12:00')
       from public.sales_meetings m where m.team = 'sales' and m.meeting_date = p_week - (extract(isodow from p_week)::int - 1)),
    jsonb_build_object('day', p_week - (extract(isodow from p_week)::int - 1), 'starts', '08:30', 'ends', '12:00', 'moved', false))
$$;
revoke execute on function public.sales_meeting_slot(date) from public, anon;
grant execute on function public.sales_meeting_slot(date) to authenticated;

-- SM Projects asks to move a week's meeting
create or replace function public.request_meeting_reschedule(p_week date, p_date date, p_starts time, p_ends time, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; mon date; rid uuid;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects reschedules the sales meeting');
  perform app.require(p_week is not null and p_date is not null and p_starts is not null and p_ends is not null, 'Choose the new day and time');
  mon := p_week - (extract(isodow from p_week)::int - 1);
  perform app.require(p_date between mon and mon + 5, format('Choose a day from Monday %s to Saturday %s', to_char(mon, 'DD Mon'), to_char(mon + 5, 'DD Mon')));
  perform app.require(p_ends > p_starts, 'The meeting must end after it starts');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(now() < (p_date + p_starts) at time zone app.tz(), 'The new time has already passed');
  select * into m from public.sales_meetings where team = 'sales' and meeting_date = mon for update;
  if m.id is null then
    insert into public.sales_meetings (team, meeting_date) values ('sales', mon) returning * into m;
  end if;
  perform app.require(m.status = 'draft' and m.started_at is null and now() < app.meeting_starts(m), 'The meeting has started – it can no longer be moved');
  perform app.require((app.meeting_day(m), m.starts_at, m.ends_at) is distinct from (p_date, p_starts, p_ends), 'That is the current day and time');
  update public.meeting_reschedules set status = 'withdrawn', decided_at = now(), decision_note = 'Replaced by a new request' where meeting_id = m.id and status = 'pending';
  insert into public.meeting_reschedules (meeting_id, week_of, from_date, from_starts, from_ends, to_date, to_starts, to_ends, reason, requested_by)
  values (m.id, mon, app.meeting_day(m), m.starts_at, m.ends_at, p_date, p_starts, p_ends, btrim(p_reason), auth.uid()) returning id into rid;
  perform app.notify_many(app.role_users('gm'), 'meeting_reschedule', 'Approve: move the sales meeting',
    format('%s %s – %s → %s %s – %s · %s', to_char(app.meeting_day(m), 'Dy DD Mon'), to_char(m.starts_at, 'HH24:MI'), to_char(m.ends_at, 'HH24:MI'),
      to_char(p_date, 'Dy DD Mon'), to_char(p_starts, 'HH24:MI'), to_char(p_ends, 'HH24:MI'), btrim(p_reason)),
    'critical', 'meeting_reschedule', rid, '/meetings?team=sales', null, true);
  return rid;
end $$;

create or replace function public.withdraw_meeting_reschedule(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.meeting_reschedules;
begin
  select * into r from public.meeting_reschedules where id = p_id for update;
  perform app.require(r.id is not null and app.has_role('sm_projects'), 'Not found');
  perform app.require(r.status = 'pending', 'Already decided');
  update public.meeting_reschedules set status = 'withdrawn', decided_at = now() where id = p_id;
end $$;

-- GM / DGM decide; on approval the meeting moves and everyone concerned is told
create or replace function public.decide_meeting_reschedule(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.meeting_reschedules; m public.sales_meetings; who uuid[];
begin
  select * into r from public.meeting_reschedules where id = p_id for update;
  perform app.require(r.id is not null, 'Not found');
  perform app.require(app.has_role('gm'), 'Only GM / DGM approve moving the sales meeting');
  perform app.require(r.status = 'pending', 'Already decided');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  select * into m from public.sales_meetings where id = r.meeting_id for update;
  if p_approve then
    perform app.require(m.started_at is null and now() < app.meeting_starts(m), 'The meeting has already started');
    perform app.require(now() < (r.to_date + r.to_starts) at time zone app.tz(), 'The new time has already passed – SM Projects must ask again');
    update public.sales_meetings set held_on = nullif(r.to_date, meeting_date), starts_at = r.to_starts, ends_at = r.to_ends where id = m.id;
  end if;
  update public.meeting_reschedules set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(p_note), '') where id = r.id;
  perform app.notify(r.requested_by, 'meeting_reschedule', format('Sales meeting move %s', case when p_approve then 'approved' else 'not approved' end),
    format('%s %s – %s%s', to_char(r.to_date, 'Dy DD Mon'), to_char(r.to_starts, 'HH24:MI'), to_char(r.to_ends, 'HH24:MI'), coalesce(' · ' || nullif(btrim(p_note), ''), '')),
    'normal', 'meeting_reschedule', r.id, '/meetings?team=sales', null, true);
  if p_approve then
    -- invitees once invited, else the sales team
    who := case when m.initiated_at is not null then array(select person_id from public.sales_meeting_invitees where meeting_id = m.id and status <> 'pending_approval')
                else app.role_users('asm_building', 'asm_infra') end;
    perform app.notify_many(who, 'meeting_invite', 'Sales meeting moved',
      format('Now %s %s – %s (was %s %s – %s) · %s', to_char(r.to_date, 'Dy DD Mon'), to_char(r.to_starts, 'HH24:MI'), to_char(r.to_ends, 'HH24:MI'),
        to_char(r.from_date, 'Dy DD Mon'), to_char(r.from_starts, 'HH24:MI'), to_char(r.from_ends, 'HH24:MI'), r.reason),
      'critical', 'sales_meeting', m.id, '/meetings', null, true);
    -- visits already planned in the new time are flagged to their sales persons
    perform app.notify_many(array(select distinct vp.sales_person_id from public.visit_plan_lines l join public.visit_plans vp on vp.id = l.plan_id
                                   where l.planned_date = r.to_date and l.status not in ('cancelled', 'rescheduled', 'missed', 'completed')
                                     and (select t1 from app.slot_times(l.time_slot)) < r.to_ends
                                     and coalesce((select t2 from app.slot_times(l.time_slot)), (select t1 from app.slot_times(l.time_slot)) + interval '1 minute') > r.to_starts
                                     and vp.sales_person_id = any (who)),
      'sales_meeting', 'Visit clashes with the moved sales meeting',
      format('The sales meeting is now %s %s – %s – move your visit or apply for leave', to_char(r.to_date, 'Dy DD Mon'), to_char(r.to_starts, 'HH24:MI'), to_char(r.to_ends, 'HH24:MI')),
      'normal', 'sales_meeting', m.id, '/plan', null, true);
  end if;
end $$;

revoke execute on function public.request_meeting_reschedule(date, date, time, time, text) from public, anon;
revoke execute on function public.withdraw_meeting_reschedule(uuid) from public, anon;
revoke execute on function public.decide_meeting_reschedule(uuid, boolean, text) from public, anon;
grant execute on function public.request_meeting_reschedule(date, date, time, time, text) to authenticated;
grant execute on function public.withdraw_meeting_reschedule(uuid) to authenticated;
grant execute on function public.decide_meeting_reschedule(uuid, boolean, text) to authenticated;


CREATE OR REPLACE FUNCTION public.start_sales_meeting(p_id uuid, p_lat double precision, p_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.sales_meetings := app.meeting_for_edit(p_id);
begin
  perform app.require((now() at time zone app.tz())::date = app.meeting_day(m), 'The meeting can be started on its day only');
  perform app.require(p_lat is not null and p_lng is not null, 'Allow location access – the meeting location is where you start it');
  update public.sales_meetings set started_at = coalesce(started_at, now()), loc_lat = p_lat, loc_lng = p_lng where id = m.id;
  -- Invitees who marked present before the location was set are checked now
  update public.sales_meeting_invitees i set distance_m = app.distance_m(i.lat, i.lng, p_lat, p_lng),
    status = case when i.lat is not null and app.distance_m(i.lat, i.lng, p_lat, p_lng) <= 200 then 'present' else 'location_check' end
   where i.meeting_id = m.id and i.status = 'location_check' and i.decided_at is null;
end $function$;

CREATE OR REPLACE FUNCTION public.attend_sales_meeting(p_meeting uuid, p_lat double precision, p_lng double precision)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.sales_meetings; i public.sales_meeting_invitees; d double precision; st text;
begin
  select * into m from public.sales_meetings where id = p_meeting;
  select * into i from public.sales_meeting_invitees where meeting_id = p_meeting and person_id = auth.uid() for update;
  perform app.require(i.person_id is not null and i.status <> 'pending_approval', 'You are not invited to this meeting');
  perform app.require(i.status in ('invited', 'location_check'), case i.status when 'excused' then 'You are on approved leave for this meeting'
    when 'present' then 'Already marked present' else 'Attendance is closed' end);
  perform app.require((now() at time zone app.tz())::date = app.meeting_day(m) and now() < app.meeting_ends(m),
    format('Attendance is marked on the meeting day before %s', to_char(m.ends_at, 'HH24:MI')));
  d := case when p_lat is not null and m.loc_lat is not null then app.distance_m(p_lat, p_lng, m.loc_lat, m.loc_lng) end;
  st := case when d is not null and d <= 200 then 'present' else 'location_check' end;
  update public.sales_meeting_invitees set checkin_at = now(), lat = p_lat, lng = p_lng, distance_m = d, status = st
   where meeting_id = p_meeting and person_id = auth.uid();
  if st = 'location_check' and m.loc_lat is not null then
    perform app.notify_many(app.role_users(app.meeting_host_role(m.team)), 'meeting_attendance', 'Meeting attendance – location differs',
      format('%s · %s · %s', app.meeting_label(m.team), app.display_name(auth.uid()), case when d is null then 'no location' else round(d) || ' m from the meeting' end),
      'normal', 'sales_meeting', m.id, '/meeting/' || m.id, null, true);
  end if;
  return st;
end $function$;

CREATE OR REPLACE FUNCTION public.invite_team_meeting(p_team text, p_date date, p_starts time without time zone, p_ends time without time zone, p_people uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m public.sales_meetings; mid uuid; p uuid; s time; e time; lbl text := app.meeting_label(p_team); dday date := p_date; prole public.app_role; held text[] := '{}';
begin
  perform app.require(p_team in ('sales', 'estimation', 'design', 'execution'), 'Unknown meeting');
  perform app.require(app.is_meeting_host(p_team), format('Only %s runs the %s', app.meeting_host_label(p_team), lower(lbl)));
  perform app.require(p_date is not null, 'Choose the date');
  if p_team = 'sales' then
    perform app.require(extract(isodow from p_date) = 1, 'Choose a Monday');
    select x.starts_at, x.ends_at, coalesce(x.held_on, x.meeting_date) into s, e, dday from public.sales_meetings x where x.team = 'sales' and x.meeting_date = p_date;
    s := coalesce(s, time '08:30'); e := coalesce(e, time '12:00'); dday := coalesce(dday, p_date);
  else
    perform app.require(extract(isodow from p_date) <> 7, 'Choose a working day');
    s := coalesce(p_starts, time '08:30'); e := coalesce(p_ends, s + interval '90 minutes');
    perform app.require(e > s, 'The meeting must end after it starts');
  end if;
  perform app.require(now() < (dday + s) at time zone app.tz(), 'The meeting has started – invitations can no longer change');
  perform app.require(coalesce(cardinality(p_people), 0) > 0, 'Select who is invited');
  perform app.require(not exists (select 1 from public.profiles x where x.id = any (p_people) and (x.role in ('gm', 'sys_admin') or not x.active)),
    'GM / DGM, System Admin and inactive users cannot be invited');
  select * into m from public.sales_meetings where team = p_team and meeting_date = p_date for update;
  perform app.require(m.id is null or m.status = 'draft', 'This meeting is published');
  if m.id is null then
    insert into public.sales_meetings (team, meeting_date, starts_at, ends_at) values (p_team, p_date, s, e) returning id into mid;
  else
    mid := m.id;
    if (m.starts_at, m.ends_at) is distinct from (s, e) then
      update public.sales_meetings set starts_at = s, ends_at = e where id = mid;
      perform app.notify_many(array(select person_id from public.sales_meeting_invitees where meeting_id = mid and person_id = any (p_people) and status <> 'pending_approval'),
        'meeting_invite', lbl || ' time changed', format('%s %s %s – %s', to_char(dday, 'Dy DD Mon'), '·', to_char(s, 'HH24:MI'), to_char(e, 'HH24:MI')),
        'normal', 'sales_meeting', mid, '/meetings', null, true);
    end if;
  end if;
  -- (requests still waiting for SM Projects are withdrawn quietly – the person was never told)
  delete from public.sales_meeting_invitees where meeting_id = mid and status = 'pending_approval' and not (person_id = any (p_people));
  for p in select person_id from public.sales_meeting_invitees where meeting_id = mid and not (person_id = any (p_people)) loop
    delete from public.sales_meeting_invitees where meeting_id = mid and person_id = p;
    perform app.notify(p, 'meeting_invite', lbl || ' invitation withdrawn', to_char(p_date, 'Dy DD Mon YYYY'), 'normal', 'sales_meeting', mid, '/meetings');
  end loop;
  foreach p in array p_people loop
    continue when p = auth.uid();
    select role into prole from public.profiles where id = p;
    -- Estimation / Design: people outside the host's team wait for SM Projects
    if p_team <> 'sales' and not (prole = any (app.meeting_own_team(p_team))) then
      insert into public.sales_meeting_invitees (meeting_id, person_id, status, requested_by) values (mid, p, 'pending_approval', auth.uid())
      on conflict (meeting_id, person_id) do nothing;
      if found then held := held || app.display_name(p); end if;
      continue;
    end if;
    insert into public.sales_meeting_invitees (meeting_id, person_id, status)
    values (mid, p, case when exists (select 1 from public.meeting_exceptions x where x.sales_person_id = p and x.team = p_team and x.meeting_date = p_date
                                       and x.status = 'approved') then 'excused' else 'invited' end)
    on conflict (meeting_id, person_id) do nothing;
    if found then
      perform app.notify(p, 'meeting_invite', format('Invited: %s %s %s – %s', lower(lbl), to_char(dday, 'Dy DD Mon'), to_char(s, 'HH24:MI'), to_char(e, 'HH24:MI')),
        'Mark your attendance in Meetings when you arrive, or apply for leave before the meeting', 'normal', 'sales_meeting', mid, '/meetings', null, true);
    end if;
  end loop;
  if cardinality(held) > 0 then
    perform app.notify_many(app.role_users('sm_projects'), 'meeting_invite_approval', format('Approve invitations – %s %s', lower(lbl), to_char(p_date, 'Dy DD Mon')),
      format('%s asks to invite %s (outside the team)', app.display_name(auth.uid()), array_to_string(held, ', ')),
      'normal', 'sales_meeting', mid, '/meetings?team=' || p_team, null, true);
  end if;
  update public.sales_meetings set initiated_at = coalesce(initiated_at, now()), initiated_by = coalesce(initiated_by, auth.uid()) where id = mid;
  return mid;
end $function$;

CREATE OR REPLACE FUNCTION public.request_meeting_exception(p_date date, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare eid uuid; sm public.sales_meetings;
begin
  perform app.require(not app.has_role('gm', 'sm_projects'), 'Not needed for your role');
  perform app.require(p_date is not null and extract(isodow from p_date) = 1, 'Choose the Monday');
  select * into sm from public.sales_meetings where team = 'sales' and meeting_date = p_date;
  perform app.require(now() < coalesce(app.meeting_starts(sm), app.meeting_start_at(p_date)), 'Leave must be applied before the meeting starts');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(not exists (select 1 from public.meeting_exceptions where sales_person_id = auth.uid() and team = 'sales' and meeting_date = p_date
                                   and status <> 'rejected'), 'Leave for this meeting is already requested');
  delete from public.meeting_exceptions where sales_person_id = auth.uid() and team = 'sales' and meeting_date = p_date and status = 'rejected';
  insert into public.meeting_exceptions (sales_person_id, team, meeting_date, reason) values (auth.uid(), 'sales', p_date, btrim(p_reason)) returning id into eid;
  perform app.notify_many(app.role_users('sm_projects'), 'meeting_exception', 'Leave requested for the sales meeting',
    format('%s · %s · %s', app.display_name(auth.uid()), to_char(coalesce(sm.held_on, p_date), 'Dy DD Mon YYYY'), btrim(p_reason)),
    'normal', 'meeting_exception', eid, '/meetings?team=sales', null, true);
  return eid;
end $function$;

CREATE OR REPLACE FUNCTION app.visit_line_meeting_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare sp uuid; s time; e time; w record;
begin
  if current_setting('app.purging', true) = 'on' then return coalesce(new, old); end if; -- clean-up

  if new.status in ('cancelled', 'rescheduled', 'missed') then return new; end if;
  select * into w from app.sales_meeting_window(new.planned_date);
  if w.week_of is null then return new; end if;
  -- Only when a visit is planned or moved (status changes such as completed / missed are never blocked)
  if tg_op = 'UPDATE' and new.planned_date = old.planned_date and new.time_slot is not distinct from old.time_slot then
    return new;
  end if;
  select vp.sales_person_id into sp from public.visit_plans vp where vp.id = new.plan_id;
  if not exists (select 1 from public.profiles where id = sp and role in ('asm_building', 'asm_infra')) then return new; end if;
  if exists (select 1 from public.meeting_exceptions where sales_person_id = sp and team = 'sales' and meeting_date = w.week_of and status = 'approved') then
    return new;
  end if;
  select t1, t2 into s, e from app.slot_times(new.time_slot);
  perform app.require(s is not null,
    format('%s %s – %s is the sales meeting – enter the visit time (e.g. 13:30), or ask SM Projects for an exception',
      to_char(new.planned_date, 'Dy DD Mon'), to_char(w.starts, 'HH24:MI'), to_char(w.ends, 'HH24:MI')));
  perform app.require(not (s < w.ends and coalesce(e, s + interval '1 minute') > w.starts),
    format('%s %s – %s is the sales meeting – plan the visit outside it, or ask SM Projects for an exception with the reason',
      to_char(new.planned_date, 'Dy DD Mon'), to_char(w.starts, 'HH24:MI'), to_char(w.ends, 'HH24:MI')));
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.my_week_meetings()
 RETURNS TABLE(meeting_id uuid, team text, title text, meeting_date date, starts_at time without time zone, ends_at time without time zone, my_part text, my_status text, status text, started boolean, generated boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with w as (select (now() at time zone app.tz())::date as today),
  wk as (select today - (extract(isodow from today)::int - 1) as mon, today from w),
  mine as (
    select m.id, m.team, m.exec_project_id, coalesce(m.held_on, m.meeting_date) as meeting_date, m.starts_at, m.ends_at, m.status, m.started_at, m.generated_at,
           case when app.is_meeting_host(m.team) then 'host'
                when i.person_id is not null then 'invitee' else 'viewer' end as part, i.status as my_status
      from public.sales_meetings m cross join wk
      left join public.sales_meeting_invitees i on i.meeting_id = m.id and i.person_id = auth.uid() and i.status <> 'pending_approval'
     where m.meeting_date between wk.mon and wk.mon + 6
       and (app.is_meeting_host(m.team) or i.person_id is not null
            or (m.initiated_at is not null and (app.has_role('gm') or (m.team <> 'sales' and app.has_role('sm_projects'))))))
  select id, team, app.meeting_title(team, exec_project_id), meeting_date, starts_at, ends_at, part, my_status, status, started_at is not null, generated_at is not null
    from mine
  union all
  select null, t.team, app.meeting_label(t.team), app.meeting_default_date(t.team, wk.today), case when t.team = 'sales' then time '08:30' else time '08:30' end,
         case when t.team = 'sales' then time '12:00' else time '10:00' end, 'host', null, 'not_set_up', false, false
    from (values ('sales'), ('estimation'), ('design')) t(team) cross join wk
   where app.is_meeting_host(t.team) and app.meeting_default_date(t.team, wk.today) >= wk.today
     and not exists (select 1 from public.sales_meetings m where m.team = t.team and m.meeting_date between wk.mon and wk.mon + 6)
  order by 4, 5
$function$;

CREATE OR REPLACE FUNCTION public.my_meetings()
 RETURNS TABLE(meeting_id uuid, meeting_date date, started boolean, my_status text, checkin_at timestamp with time zone, distance_m double precision, leave_status text, leave_reason text, leave_note text, host text, team text, title text, starts_at time without time zone, ends_at time without time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.id, coalesce(m.held_on, m.meeting_date), m.started_at is not null, i.status, i.checkin_at, i.distance_m, e.status, e.reason, e.decision_note,
         app.display_name(coalesce(m.initiated_by, (select id from public.profiles where role = app.meeting_host_role(m.team) and active limit 1))),
         m.team, app.meeting_title(m.team, m.exec_project_id), m.starts_at, m.ends_at
    from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id
    left join public.meeting_exceptions e on e.sales_person_id = i.person_id and e.team = m.team and e.meeting_date = m.meeting_date and (e.meeting_id is null or e.meeting_id = m.id)
   where i.person_id = auth.uid() and i.status <> 'pending_approval' and m.meeting_date >= (now() at time zone app.tz())::date - 56
   order by 2 desc, m.starts_at
$function$;

CREATE OR REPLACE FUNCTION public.my_pending_approvals()
 RETURNS TABLE(source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text, requested_at timestamp with time zone, inquiry_id uuid, url text, step text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select 'meeting_exception', e.id, 'meeting_exception', format('%s leave – %s – %s', app.meeting_title(e.team, (select x.exec_project_id from public.sales_meetings x where x.id = e.meeting_id)), app.display_name(e.sales_person_id),
         to_char(e.meeting_date, 'Dy DD Mon')), e.reason, e.sales_person_id, app.display_name(e.sales_person_id), e.requested_at, null,
         coalesce('/meeting/' || e.meeting_id, '/meetings?team=' || e.team), null
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
         format('Invoice date change%s – %s · %s → %s', case when c.needs_gm then ' (another quarter / year)' else '' end, s.project_name, to_char(c.from_month, 'Mon YYYY'), to_char(c.to_month, 'Mon YYYY')),
         concat_ws(' · ', app.fmt_money(l.amount, 'LKR'), c.reason, c.note), c.requested_by, app.display_name(c.requested_by), c.requested_at,
         null, app.secured_url(s.id), null
  from public.invoice_line_changes c join public.invoice_lines l on l.id = c.line_id join public.secured_projects s on s.id = l.secured_id
  where c.status = 'pending' and ((app.has_role('sm_projects') and (not c.needs_gm or c.smp_at is null))
                                 or (app.has_role('gm') and c.needs_gm and c.smp_at is not null))
  union all
  select 'invoice_request', s.id, 'invoice_request', format('Invoice to approve – %s – %s', s.project_name, r.invoice_no),
         concat_ws(' · ', app.fmt_money(r.amount, 'LKR'), to_char(r.invoice_date, 'DD Mon YYYY'), r.note), r.requested_by,
         app.display_name(r.requested_by), r.requested_at, null, app.secured_url(s.id), null
  from public.invoice_requests r join public.secured_projects s on s.id = r.secured_id
  where r.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'secured_removal', s.id, 'secured_removal', format('Remove from the secured list – %s', s.project_name),
         concat_ws(' · ', app.fmt_money(s.order_value, 'LKR'), s.removal_reason), s.removal_requested_by,
         app.display_name(s.removal_requested_by), s.removal_requested_at, null, app.secured_url(s.id), 'SM Projects'
  from public.secured_projects s
  where s.removal_requested_at is not null and app.has_role('sm_projects')
  union all
  select 'meeting_reschedule', r.id, 'meeting_reschedule',
         format('Move the sales meeting – %s %s → %s %s', to_char(r.from_date, 'Dy DD Mon'), to_char(r.from_starts, 'HH24:MI'), to_char(r.to_date, 'Dy DD Mon'), to_char(r.to_starts, 'HH24:MI')),
         r.reason, r.requested_by, app.display_name(r.requested_by), r.requested_at, null, '/meetings?team=sales', null
  from public.meeting_reschedules r
  where r.status = 'pending' and app.has_role('gm')
  union all
  select * from app.exec_pending_approvals()
  order by 8
$function$;


create or replace function public.sales_meeting_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  monday date;
  m public.sales_meetings;
  n int := 0;
  away uuid[];
  s time; e time; slot text;
begin
  if extract(isodow from today) = 7 then
    monday := today + 1;
    select * into m from public.sales_meetings where team = 'sales' and meeting_date = monday;
    if m.initiated_at is null then
      if loc::time >= time '08:00' then
        perform app.notify_many(app.role_users('sm_projects'), 'sales_meeting', 'Invite the team for this week''s sales meeting by 10:00',
          'Open Meetings → Sales meeting → Invite for the week of ' || to_char(monday, 'DD Mon'), 'normal', null, null, '/meetings?team=sales', format('meetinv1:%s', monday), false);
        n := n + 1;
      end if;
      if loc::time >= time '10:00' then
        perform app.notify_many(app.role_users('sm_projects'), 'sales_meeting', 'Sales meeting invitations are overdue (due 10:00)',
          'Invite the team for the week of ' || to_char(monday, 'DD Mon'), 'critical', null, null, '/meetings?team=sales', format('meetinv2:%s', monday), false);
        n := n + 1;
      end if;
      if loc::time >= time '15:00' then
        perform app.notify_many(app.role_users('gm'), 'sales_meeting', 'Sales meeting not initiated',
          format('SM Projects has not invited the team for the sales meeting of the week of %s', to_char(monday, 'DD Mon')),
          'critical', null, null, '/meetings?team=sales', format('meetinv3:%s', monday), false);
        n := n + 1;
      end if;
    end if;
    return n;
  end if;
  -- the meeting held today (a moved one, or a Monday's own)
  select * into m from public.sales_meetings where team = 'sales' and coalesce(held_on, meeting_date) = today;
  if m.id is null and (extract(isodow from today) <> 1 or exists (select 1 from public.sales_meetings where team = 'sales' and meeting_date = today)) then
    return 0;
  end if;
  s := coalesce(m.starts_at, time '08:30'); e := coalesce(m.ends_at, time '12:00');
  slot := to_char(s, 'HH24:MI') || ' – ' || to_char(e, 'HH24:MI');
  if loc::time < least(time '08:00', s) then return 0; end if;
  if loc::time < e then
    if m.initiated_at is not null then
      perform app.notify_many(array(select person_id from public.sales_meeting_invitees where meeting_id = m.id and status = 'invited') || app.role_users('sm_projects'),
        'sales_meeting', 'Sales meeting today ' || slot, 'Mark your attendance in Meetings when you arrive', 'normal', null, null, '/meetings',
        format('meet:%s', today), false);
    else
      select coalesce(array_agg(sales_person_id), '{}') into away from public.meeting_exceptions where team = 'sales' and meeting_date = coalesce(m.meeting_date, today) and status = 'approved';
      perform app.notify_many(array(select x from unnest(app.role_users('asm_building', 'asm_infra')) x where not (x = any (away))) || app.role_users('sm_projects'),
        'sales_meeting', 'Sales meeting today ' || slot, 'Weekly sales meeting with SM Projects', 'normal', null, null, '/', format('meet:%s', today), false);
    end if;
    n := n + 1;
    if m.pack is null then
      perform app.notify_many(app.role_users('sm_projects'), 'sales_meeting', 'Generate today''s sales meeting pack',
        'Open Meetings → Sales meeting and press Generate pack', 'normal', null, null, '/meetings?team=sales', format('meetpack:%s', today), false);
      n := n + 1;
    end if;
  elsif m.id is not null then
    -- Not marked by the end → absent
    update public.sales_meeting_invitees set status = 'absent', note = coalesce(note, 'Not marked by ' || to_char(e, 'HH24:MI'))
     where meeting_id = m.id and status = 'invited';
    get diagnostics n = row_count;
  end if;
  return n;
end $$;
revoke execute on function public.sales_meeting_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.sales_meeting_tick(timestamptz) to service_role;

-- A moved meeting can be on any day of the week
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sales-meeting-tick', '*/15 * * * *', 'select public.sales_meeting_tick()');
  end if;
end $$;
