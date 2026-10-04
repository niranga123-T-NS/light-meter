-- Estimation / Design meetings: inviting people from outside the team needs SM Projects' approval before the invitation
-- is released. The host's own team (Estimation: SM / AM Estimation, Estimation Executives; Design: Design Manager,
-- Lighting Designers / Engineers) is invited at once; anyone else waits as 'pending_approval' – not notified, not shown
-- to them – until SM Projects approves (then invited and notified) or rejects (removed, host told). Still pending when the
-- meeting starts → dropped. Nobody can invite GM / DGM (or System Admin).

alter table public.sales_meeting_invitees drop constraint if exists sales_meeting_invitees_status_check;
alter table public.sales_meeting_invitees add constraint sales_meeting_invitees_status_check
  check (status in ('pending_approval', 'invited', 'present', 'location_check', 'absent', 'excused'));
alter table public.sales_meeting_invitees
  add column if not exists requested_by uuid references public.profiles (id),
  add column if not exists approved_by uuid references public.profiles (id),
  add column if not exists approved_at timestamptz;

-- The host's own team (invited without approval)
create or replace function app.meeting_own_team(p_team text) returns public.app_role[] language sql immutable as $$
  select app.meeting_members(p_team) || app.meeting_host_role(p_team) ||
         case p_team when 'estimation' then array['am_estimation']::public.app_role[] else '{}'::public.app_role[] end
$$;


-- Invitations: outside the team → SM Projects first (copied from 20260930000077)
create or replace function public.invite_team_meeting(p_team text, p_date date, p_starts time, p_ends time, p_people uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; mid uuid; p uuid; s time; e time; lbl text := app.meeting_label(p_team); prole public.app_role; held text[] := '{}';
begin
  perform app.require(p_team in ('sales', 'estimation', 'design'), 'Unknown meeting');
  perform app.require(app.is_meeting_host(p_team), format('Only %s runs the %s', app.meeting_host_label(p_team), lower(lbl)));
  perform app.require(p_date is not null, 'Choose the date');
  if p_team = 'sales' then
    perform app.require(extract(isodow from p_date) = 1, 'Choose a Monday');
    s := time '08:30'; e := time '12:00';
  else
    perform app.require(extract(isodow from p_date) <> 7, 'Choose a working day');
    s := coalesce(p_starts, time '08:30'); e := coalesce(p_ends, s + interval '90 minutes');
    perform app.require(e > s, 'The meeting must end after it starts');
  end if;
  perform app.require(now() < (p_date + s) at time zone app.tz(), 'The meeting has started – invitations can no longer change');
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
        'meeting_invite', lbl || ' time changed', format('%s %s %s – %s', to_char(p_date, 'Dy DD Mon'), '·', to_char(s, 'HH24:MI'), to_char(e, 'HH24:MI')),
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
      perform app.notify(p, 'meeting_invite', format('Invited: %s %s %s – %s', lower(lbl), to_char(p_date, 'Dy DD Mon'), to_char(s, 'HH24:MI'), to_char(e, 'HH24:MI')),
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
end $$;


-- SM Projects approves (released: invited and notified) or rejects (removed; the host is told)
create or replace function public.decide_meeting_invite(p_meeting uuid, p_person uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; i public.sales_meeting_invitees; lbl text;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects approves invitations from outside the team');
  select * into m from public.sales_meetings where id = p_meeting;
  select * into i from public.sales_meeting_invitees where meeting_id = p_meeting and person_id = p_person for update;
  perform app.require(i.person_id is not null and i.status = 'pending_approval', 'Already decided');
  perform app.require(now() < app.meeting_starts(m), 'The meeting has started');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  lbl := app.meeting_label(m.team);
  if p_approve then
    update public.sales_meeting_invitees set status = case when exists (select 1 from public.meeting_exceptions x where x.sales_person_id = p_person
             and x.team = m.team and x.meeting_date = m.meeting_date and x.status = 'approved') then 'excused' else 'invited' end,
      approved_by = auth.uid(), approved_at = now(), invited_at = now(), note = nullif(btrim(p_note), '')
     where meeting_id = m.id and person_id = p_person;
    perform app.notify(p_person, 'meeting_invite', format('Invited: %s %s %s – %s', lower(lbl), to_char(m.meeting_date, 'Dy DD Mon'), to_char(m.starts_at, 'HH24:MI'),
        to_char(m.ends_at, 'HH24:MI')),
      'Mark your attendance in Meetings when you arrive, or apply for leave before the meeting', 'normal', 'sales_meeting', m.id, '/meetings', null, true);
  else
    delete from public.sales_meeting_invitees where meeting_id = m.id and person_id = p_person;
  end if;
  perform app.notify_many(array_remove(array[i.requested_by, m.initiated_by], null) || app.role_users(app.meeting_host_role(m.team)), 'meeting_invite',
    format('Invitation %s – %s', case when p_approve then 'approved' else 'not approved' end, app.display_name(p_person)),
    format('%s %s%s', lbl, to_char(m.meeting_date, 'Dy DD Mon'), coalesce(' · ' || nullif(btrim(p_note), ''), '')),
    'normal', 'sales_meeting', m.id, '/meeting/' || m.id, null, true);
end $$;

-- For SM Projects (Meetings → Estimation / Design, and Approvals): invitations waiting
create or replace function public.meeting_invites_to_approve() returns table (meeting_id uuid, team text, title text, meeting_date date,
  starts_at time, ends_at time, person_id uuid, person text, role public.app_role, requested_by text, requested_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.team, app.meeting_label(m.team), m.meeting_date, m.starts_at, m.ends_at, i.person_id, app.display_name(i.person_id), p.role,
         app.display_name(coalesce(i.requested_by, m.initiated_by)), i.invited_at
    from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id join public.profiles p on p.id = i.person_id
   where i.status = 'pending_approval' and app.has_role('sm_projects') and now() < app.meeting_starts(m)
   order by m.meeting_date, m.team, 8
$$;
revoke execute on function public.decide_meeting_invite(uuid, uuid, boolean, text), public.meeting_invites_to_approve() from public, anon;
grant execute on function public.decide_meeting_invite(uuid, uuid, boolean, text), public.meeting_invites_to_approve() to authenticated, service_role;


-- (copied from 20260930000077: an invitation waiting for approval is not an invitation yet)
create or replace function public.attend_sales_meeting(p_meeting uuid, p_lat double precision, p_lng double precision) returns text
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; i public.sales_meeting_invitees; d double precision; st text;
begin
  select * into m from public.sales_meetings where id = p_meeting;
  select * into i from public.sales_meeting_invitees where meeting_id = p_meeting and person_id = auth.uid() for update;
  perform app.require(i.person_id is not null and i.status <> 'pending_approval', 'You are not invited to this meeting');
  perform app.require(i.status in ('invited', 'location_check'), case i.status when 'excused' then 'You are on approved leave for this meeting'
    when 'present' then 'Already marked present' else 'Attendance is closed' end);
  perform app.require((now() at time zone app.tz())::date = m.meeting_date and now() < app.meeting_ends(m),
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
end $$;

-- (copied from 20260930000077)
create or replace function public.request_meeting_leave(p_meeting uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; eid uuid;
begin
  select * into m from public.sales_meetings where id = p_meeting;
  perform app.require(m.id is not null, 'Meeting not found');
  if m.team = 'sales' then return public.request_meeting_exception(m.meeting_date, p_reason); end if;
  perform app.require(exists (select 1 from public.sales_meeting_invitees where meeting_id = m.id and person_id = auth.uid() and status <> 'pending_approval'), 'You are not invited to this meeting');
  perform app.require(now() < app.meeting_starts(m), 'Leave must be applied before the meeting starts');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(not exists (select 1 from public.meeting_exceptions where sales_person_id = auth.uid() and team = m.team and meeting_date = m.meeting_date
                                   and status <> 'rejected'), 'Leave for this meeting is already requested');
  delete from public.meeting_exceptions where sales_person_id = auth.uid() and team = m.team and meeting_date = m.meeting_date and status = 'rejected';
  insert into public.meeting_exceptions (sales_person_id, team, meeting_date, reason) values (auth.uid(), m.team, m.meeting_date, btrim(p_reason))
  returning id into eid;
  perform app.notify_many(app.role_users(app.meeting_host_role(m.team)), 'meeting_exception', 'Leave requested – ' || lower(app.meeting_label(m.team)),
    format('%s · %s · %s', app.display_name(auth.uid()), to_char(m.meeting_date, 'Dy DD Mon'), btrim(p_reason)),
    'normal', 'meeting_exception', eid, '/meetings?team=' || m.team, null, true);
  return eid;
end $$;

-- (copied from 20260930000077)
drop function if exists public.my_meetings();
create or replace function public.my_meetings() returns table (meeting_id uuid, meeting_date date, started boolean, my_status text,
  checkin_at timestamptz, distance_m double precision, leave_status text, leave_reason text, leave_note text, host text,
  team text, title text, starts_at time, ends_at time)
language sql stable security definer set search_path = public as $$
  select m.id, m.meeting_date, m.started_at is not null, i.status, i.checkin_at, i.distance_m, e.status, e.reason, e.decision_note,
         app.display_name(coalesce(m.initiated_by, (select id from public.profiles where role = app.meeting_host_role(m.team) and active limit 1))),
         m.team, app.meeting_label(m.team), m.starts_at, m.ends_at
    from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id
    left join public.meeting_exceptions e on e.sales_person_id = i.person_id and e.team = m.team and e.meeting_date = m.meeting_date
   where i.person_id = auth.uid() and i.status <> 'pending_approval' and m.meeting_date >= (now() at time zone app.tz())::date - 56
   order by m.meeting_date desc, m.starts_at
$$;
revoke execute on function public.my_meetings() from public, anon;
grant execute on function public.my_meetings() to authenticated;

-- (copied from 20260930000077)
create or replace function public.my_week_meetings() returns table (meeting_id uuid, team text, title text, meeting_date date, starts_at time,
  ends_at time, my_part text, my_status text, status text, started boolean, generated boolean)
language sql stable security definer set search_path = public as $$
  with w as (select (now() at time zone app.tz())::date as today),
  wk as (select today - (extract(isodow from today)::int - 1) as mon, today from w),
  mine as (
    select m.id, m.team, m.meeting_date, m.starts_at, m.ends_at, m.status, m.started_at, m.generated_at,
           case when app.is_meeting_host(m.team) then 'host'
                when i.person_id is not null then 'invitee' else 'viewer' end as part, i.status as my_status
      from public.sales_meetings m cross join wk
      left join public.sales_meeting_invitees i on i.meeting_id = m.id and i.person_id = auth.uid() and i.status <> 'pending_approval'
     where m.meeting_date between wk.mon and wk.mon + 6
       and (app.is_meeting_host(m.team) or i.person_id is not null
            or (m.initiated_at is not null and (app.has_role('gm') or (m.team <> 'sales' and app.has_role('sm_projects'))))))
  select id, team, app.meeting_label(team), meeting_date, starts_at, ends_at, part, my_status, status, started_at is not null, generated_at is not null
    from mine
  union all
  select null, t.team, app.meeting_label(t.team), app.meeting_default_date(t.team, wk.today), case when t.team = 'sales' then time '08:30' else time '08:30' end,
         case when t.team = 'sales' then time '12:00' else time '10:00' end, 'host', null, 'not_set_up', false, false
    from (values ('sales'), ('estimation'), ('design')) t(team) cross join wk
   where app.is_meeting_host(t.team) and app.meeting_default_date(t.team, wk.today) >= wk.today
     and not exists (select 1 from public.sales_meetings m where m.team = t.team and m.meeting_date between wk.mon and wk.mon + 6)
  order by 4, 5
$$;

-- (copied from 20260930000077: pending invitations dropped at the start)
create or replace function public.team_meeting_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  t text;
  dd date;
  m public.sales_meetings;
  n int := 0;
  k int;
begin
  foreach t in array array['estimation', 'design'] loop
    -- The day before the team's default day: set it up (invite) by 10:00; 15:00 → host and GM / DGM
    dd := today + 1;
    if extract(isodow from today) <> 7 and app.meeting_default_date(t, dd) = dd
       and not exists (select 1 from public.sales_meetings x where x.team = t and x.initiated_at is not null
                        and x.meeting_date between dd - (extract(isodow from dd)::int - 1) and dd - (extract(isodow from dd)::int - 1) + 6) then
      if loc::time >= time '10:00' then
        perform app.notify_many(app.role_users(app.meeting_host_role(t)), 'team_meeting', 'Invite the team for tomorrow''s ' || lower(app.meeting_label(t)),
          'Open Meetings → ' || app.meeting_label(t) || ' → Invite', 'normal', null, null, '/meetings?team=' || t, format('tmeetinv1:%s:%s', t, dd), true);
        n := n + 1;
      end if;
      if loc::time >= time '15:00' then
        perform app.notify_many(app.role_users('gm') || app.role_users(app.meeting_host_role(t)), 'team_meeting', app.meeting_label(t) || ' not set up',
          format('%s has not invited the team for this week''s %s (usual day %s)', app.meeting_host_label(t), lower(app.meeting_label(t)), to_char(dd, 'Dy DD Mon')),
          'critical', null, null, '/meetings?team=' || t, format('tmeetinv2:%s:%s', t, dd), false);
        n := n + 1;
      end if;
    end if;
    -- Meeting day
    select * into m from public.sales_meetings where team = t and meeting_date = today;
    continue when m.id is null;
    -- Invitations still waiting for SM Projects when the meeting starts are dropped
    if p_at >= app.meeting_starts(m) and exists (select 1 from public.sales_meeting_invitees where meeting_id = m.id and status = 'pending_approval') then
      perform app.notify_many(app.role_users(app.meeting_host_role(t)), 'meeting_invite', 'Invitations not approved in time',
        (select string_agg(app.display_name(person_id), ', ') from public.sales_meeting_invitees where meeting_id = m.id and status = 'pending_approval'),
        'normal', 'sales_meeting', m.id, '/meeting/' || m.id);
      delete from public.sales_meeting_invitees where meeting_id = m.id and status = 'pending_approval';
    end if;
    if p_at >= app.meeting_starts(m) - interval '60 minutes' and p_at < app.meeting_ends(m) then
      perform app.notify_many(array(select person_id from public.sales_meeting_invitees where meeting_id = m.id and status = 'invited'),
        'team_meeting', format('%s today %s – %s', app.meeting_label(t), to_char(m.starts_at, 'HH24:MI'), to_char(m.ends_at, 'HH24:MI')),
        'Mark your attendance in Meetings when you arrive', 'normal', 'sales_meeting', m.id, '/meetings', format('tmeet:%s', m.id), false);
      n := n + 1;
    end if;
    if m.pack is null and p_at >= app.meeting_starts(m) - interval '30 minutes' and p_at < app.meeting_ends(m) then
      perform app.notify_many(app.role_users(app.meeting_host_role(t)), 'team_meeting', 'Generate today''s ' || lower(app.meeting_label(t)) || ' pack',
        'Open Meetings and press Generate pack', 'normal', 'sales_meeting', m.id, '/meetings?team=' || t, format('tmeetpack:%s', m.id), false);
      n := n + 1;
    end if;
    if p_at >= app.meeting_ends(m) then
      update public.sales_meeting_invitees set status = 'absent', note = coalesce(note, 'Not marked by ' || to_char(m.ends_at, 'HH24:MI'))
       where meeting_id = m.id and status = 'invited';
      get diagnostics k = row_count;
      n := n + k;
    end if;
  end loop;
  return n;
end $$;

-- Invitations to approve in SM Projects' approvals (copied from 20260930000077)
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
  order by 8
$$;
