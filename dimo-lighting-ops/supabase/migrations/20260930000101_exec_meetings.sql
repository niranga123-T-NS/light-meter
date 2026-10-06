-- Execution step 2: execution team meetings, run by the Senior Electrical Engineer (same machinery as the sales, estimation
-- and design meetings): invite, pack, location-checked attendance, leave, notes, typed actions, publish, minutes PDF.
--  * Own team, invited at once: Assistant Engineers (incl. temporary), Trainees and subcontractor supervisors.
--    Anyone else (sales, design, estimation, operations) waits for SM Projects' approval.
--  * Actions: tasks go straight to the participant; design / estimation tasks go to the Design Manager / SM Estimation,
--    who appoint their own people (as in the other meetings).
--  * Pack: the team's engineering jobs – in hand, accepted / not accepted, on hold, overdue, due in 7 days, done last week,
--    per engineer with their open actions.

alter table public.sales_meetings drop constraint if exists sales_meetings_team_check;
alter table public.sales_meetings add constraint sales_meetings_team_check check (team in ('sales', 'estimation', 'design', 'execution'));
alter table public.meeting_exceptions drop constraint if exists meeting_exceptions_team_check;
alter table public.meeting_exceptions add constraint meeting_exceptions_team_check check (team in ('sales', 'estimation', 'design', 'execution'));

insert into public.settings (key, value, description) values
  ('execution_meeting_dow', '4', 'Default day of the Execution team meeting (1 = Monday … 6 = Saturday)')
on conflict (key) do nothing;

create or replace function app.meeting_host_role(p_team text) returns public.app_role language sql immutable as $$
  select case p_team when 'estimation' then 'sm_estimation' when 'design' then 'design_manager' when 'execution' then 'senior_elec_engineer'
                     else 'sm_projects' end::public.app_role
$$;
create or replace function app.meeting_host_label(p_team text) returns text language sql immutable as $$
  select case p_team when 'estimation' then 'SM Estimation' when 'design' then 'the Design Manager'
                     when 'execution' then 'the Senior Electrical Engineer' else 'SM Projects' end
$$;
create or replace function app.meeting_label(p_team text) returns text language sql immutable as $$
  select case p_team when 'estimation' then 'Estimation team meeting' when 'design' then 'Design team meeting'
                     when 'execution' then 'Execution team meeting' else 'Sales meeting' end
$$;
create or replace function app.meeting_members(p_team text) returns public.app_role[] language sql immutable as $$
  select case p_team when 'estimation' then array['am_estimation', 'estimation_exec']::public.app_role[]
                     when 'design' then array['lighting_designer', 'lighting_engineer']::public.app_role[]
                     when 'execution' then array['assistant_engineer', 'trainee', 'sub_supervisor']::public.app_role[]
                     else array['asm_building', 'asm_infra']::public.app_role[] end
$$;
create or replace function app.meeting_default_date(p_team text, p_day date) returns date language sql stable as $$
  select p_day - (extract(isodow from p_day)::int - 1)
         + (case p_team when 'sales' then 1
                        else app.setting_num(p_team || '_meeting_dow', case p_team when 'estimation' then 2 when 'design' then 3 else 4 end)::int end) - 1
$$;

-- Execution team pack
create or replace function app.execution_meeting_pack(p_mid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; d date; wk date; people jsonb := '[]'; sp record; team jsonb;
  open_st text[] := array['assigned', 'in_progress', 'on_hold'];
begin
  select * into m from public.sales_meetings where id = p_mid;
  d := m.meeting_date; wk := d - 7;
  team := jsonb_build_object(
    'jobs', (select jsonb_build_object('total', count(*), 'assigned', count(*) filter (where status = 'assigned'),
                                        'in_progress', count(*) filter (where status = 'in_progress'), 'on_hold', count(*) filter (where status = 'on_hold'))
             from public.eng_jobs where status = any (open_st)),
    'done_week_n', (select count(*) from public.eng_jobs where status = 'done' and (done_at at time zone app.tz())::date >= wk and (done_at at time zone app.tz())::date < d),
    'done_on_time_n', (select count(*) from public.eng_jobs where status = 'done' and (done_at at time zone app.tz())::date >= wk
                         and (done_at at time zone app.tz())::date < d and (done_at at time zone app.tz())::date <= due_date),
    'overdue_n', (select count(*) from public.eng_jobs where status = any (open_st) and due_date < d),
    'due_soon_n', (select count(*) from public.eng_jobs where status = any (open_st) and due_date between d and d + 7),
    'overdue', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'project', title, 'person', app.display_name(assignee_id), 'days', d - due_date)
                                  order by due_date), '[]') from public.eng_jobs where status = any (open_st) and due_date < d),
    'due_soon', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'project', title, 'person', app.display_name(assignee_id), 'due', due_date,
                                  'progress', progress) order by due_date), '[]') from public.eng_jobs where status = any (open_st) and due_date between d and d + 7),
    'on_hold', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'project', title, 'person', app.display_name(assignee_id), 'reason', hold_reason)), '[]')
                from public.eng_jobs where status = 'on_hold'),
    'not_accepted', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'project', title, 'person', app.display_name(assignee_id),
                                  'since', assigned_at)), '[]') from public.eng_jobs where status = 'assigned'),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'stage', stage) order by name), '[]')
                 from public.exec_projects where status = 'active'));
  for sp in select * from app.meeting_pack_people(p_mid, 'execution') loop
    people := people || jsonb_build_array(jsonb_build_object(
      'id', sp.id, 'name', sp.full_name,
      'in_hand_n', (select count(*) from public.eng_jobs where assignee_id = sp.id and status = any (open_st)),
      'done_week_n', (select count(*) from public.eng_jobs where assignee_id = sp.id and status = 'done'
                        and (done_at at time zone app.tz())::date >= wk and (done_at at time zone app.tz())::date < d),
      'on_hold_n', (select count(*) from public.eng_jobs where assignee_id = sp.id and status = 'on_hold'),
      'overdue', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'project', title, 'days', d - due_date)), '[]')
                  from public.eng_jobs where assignee_id = sp.id and status = any (open_st) and due_date < d),
      'due_soon', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'project', title, 'due', due_date)), '[]')
                   from public.eng_jobs where assignee_id = sp.id and status = any (open_st) and due_date between d and d + 7),
      'open_actions', app.meeting_open_actions(sp.id, d),
      'exception', (select jsonb_build_object('status', e.status, 'reason', e.reason) from public.meeting_exceptions e
                    where e.sales_person_id = sp.id and e.team = 'execution' and e.meeting_date = d)));
  end loop;
  return jsonb_build_object('team_kind', 'execution', 'week_from', wk, 'week_to', d - 1, 'generated_at', now(), 'team', team, 'people', people);
end $$;

-- Invitations, pack and reminders now include the execution team (copied from 20260930000078 / 77)
create or replace function public.invite_team_meeting(p_team text, p_date date, p_starts time, p_ends time, p_people uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; mid uuid; p uuid; s time; e time; lbl text := app.meeting_label(p_team); prole public.app_role; held text[] := '{}';
begin
  perform app.require(p_team in ('sales', 'estimation', 'design', 'execution'), 'Unknown meeting');
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

create or replace function public.generate_team_meeting(p_team text, p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; mid uuid;
begin
  perform app.require(p_team in ('sales', 'estimation', 'design', 'execution'), 'Unknown meeting');
  perform app.require(app.is_meeting_host(p_team), format('Only %s runs the %s', app.meeting_host_label(p_team), lower(app.meeting_label(p_team))));
  perform app.require(p_date is not null, 'Choose the date');
  perform app.require(p_team <> 'sales' or extract(isodow from p_date) = 1, 'Choose a Monday');
  select * into m from public.sales_meetings where team = p_team and meeting_date = p_date for update;
  perform app.require(m.id is null or m.status = 'draft', 'This meeting is published – it can no longer be regenerated');
  if m.id is null then
    insert into public.sales_meetings (team, meeting_date, ends_at) values (p_team, p_date, case when p_team = 'sales' then time '12:00' else time '10:00' end)
    returning id into mid;
  else
    mid := m.id;
  end if;
  update public.sales_meetings set pack = case p_team when 'estimation' then app.estimation_meeting_pack(mid) when 'design' then app.design_meeting_pack(mid)
                                                     when 'execution' then app.execution_meeting_pack(mid)
                                                     else app.sales_meeting_pack(p_date) end,
    generated_at = now(), generated_by = auth.uid() where id = mid;
  return mid;
end $$;

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
  foreach t in array array['estimation', 'design', 'execution'] loop
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
