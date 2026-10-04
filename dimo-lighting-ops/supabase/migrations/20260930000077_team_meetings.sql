-- Team meetings: the sales meeting machinery for the Estimation and Design teams too, all under one Meetings tab
--  * sales_meetings now holds every internal meeting: team = sales (SM Projects, Mondays 08:30 – 12:00),
--    estimation (SM Estimation) or design (Design Manager). Estimation and Design choose the day and time when they invite
--    (default Tuesday / Wednesday 08:30 – 10:00, settings estimation_meeting_dow / design_meeting_dow).
--  * Same flow for all: invite (anyone but GM / DGM and System Admin) → generate the pack by button → start the meeting at
--    the venue → invitees mark present with their location (more than 200 m → the host approves) → leave applied before the
--    start and decided by the host → notes and typed actions → publish (read only) to GM / DGM, and to SM Projects for the
--    Estimation and Design meetings. Action follow-ups (visits into plans, team tasks appointed, confirmations) as before.
--  * Packs: Estimation – jobs in hand, released and value, on time, overdue / at risk, returns, holds, open clarifications,
--    hit rate, waiting on Design; per estimator. Design – jobs by stage, released and on time, overdue / due soon, review
--    returns, holds (and what they wait on), waiting on sales information, early releases, hours; per designer / engineer.
--  * Reminders: the day before the default day 10:00 to the host, 15:00 to the host and GM / DGM if not set up; on the day
--    an hour before to invitees; generate the pack 30 minutes before; not marked by the end → absent.
--  * My Day: this week's meetings for everyone (invited, hosting, or published for GM / DGM and SM Projects).

alter table public.sales_meetings
  add column if not exists team text not null default 'sales' check (team in ('sales', 'estimation', 'design')),
  add column if not exists starts_at time not null default '08:30',
  add column if not exists ends_at time not null default '12:00';
alter table public.sales_meetings drop constraint if exists sales_meetings_meeting_date_key;
alter table public.sales_meetings drop constraint if exists sales_meetings_meeting_date_check;
alter table public.sales_meetings
  add constraint sales_meetings_team_date unique (team, meeting_date),
  add constraint sales_meetings_monday check (team <> 'sales' or extract(isodow from meeting_date) = 1),
  add constraint sales_meetings_times check (ends_at > starts_at);

alter table public.meeting_exceptions add column if not exists team text not null default 'sales' check (team in ('sales', 'estimation', 'design'));
alter table public.meeting_exceptions drop constraint if exists meeting_exceptions_sales_person_id_meeting_date_key;
alter table public.meeting_exceptions drop constraint if exists meeting_exceptions_meeting_date_check;
alter table public.meeting_exceptions
  add constraint meeting_exceptions_person_team_date unique (sales_person_id, team, meeting_date),
  add constraint meeting_exceptions_monday check (team <> 'sales' or extract(isodow from meeting_date) = 1);

insert into public.settings (key, value, description) values
  ('estimation_meeting_dow', '2', 'Default day of the Estimation team meeting (1 = Monday … 6 = Saturday)'),
  ('design_meeting_dow', '3', 'Default day of the Design team meeting (1 = Monday … 6 = Saturday)')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.meeting_host_role(p_team text) returns public.app_role language sql immutable as $$
  select case p_team when 'estimation' then 'sm_estimation' when 'design' then 'design_manager' else 'sm_projects' end::public.app_role
$$;
create or replace function app.meeting_host_label(p_team text) returns text language sql immutable as $$
  select case p_team when 'estimation' then 'SM Estimation' when 'design' then 'the Design Manager' else 'SM Projects' end
$$;
create or replace function app.meeting_label(p_team text) returns text language sql immutable as $$
  select case p_team when 'estimation' then 'Estimation team meeting' when 'design' then 'Design team meeting' else 'Sales meeting' end
$$;
create or replace function app.meeting_members(p_team text) returns public.app_role[] language sql immutable as $$
  select case p_team when 'estimation' then array['am_estimation', 'estimation_exec']::public.app_role[]
                     when 'design' then array['lighting_designer', 'lighting_engineer']::public.app_role[]
                     else array['asm_building', 'asm_infra']::public.app_role[] end
$$;
create or replace function app.is_meeting_host(p_team text) returns boolean language sql stable as $$
  select app.has_role(app.meeting_host_role(p_team))
$$;
create or replace function app.meeting_starts(m public.sales_meetings) returns timestamptz language sql stable as $$
  select (m.meeting_date + m.starts_at) at time zone app.tz()
$$;
create or replace function app.meeting_ends(m public.sales_meetings) returns timestamptz language sql stable as $$
  select (m.meeting_date + m.ends_at) at time zone app.tz()
$$;
-- Default date of a team's meeting in the week of p_day
create or replace function app.meeting_default_date(p_team text, p_day date) returns date language sql stable as $$
  select p_day - (extract(isodow from p_day)::int - 1)
         + (case p_team when 'sales' then 1 else app.setting_num(p_team || '_meeting_dow', case p_team when 'estimation' then 2 else 3 end)::int end) - 1
$$;
-- People told of a team's published meeting (read only)
create or replace function app.meeting_viewers(p_team text) returns uuid[] language sql stable security definer set search_path = public as $$
  select case when p_team = 'sales' then app.role_users('gm') else app.role_users('gm', 'sm_projects') end
$$;

drop policy if exists sales_meetings_read on public.sales_meetings;
create policy sales_meetings_read on public.sales_meetings for select to authenticated
  using (app.is_meeting_host(team) or (status = 'published' and (app.has_role('gm') or (team <> 'sales' and app.has_role('sm_projects')))));

create or replace function app.meeting_for_edit(p_id uuid) returns public.sales_meetings
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings;
begin
  select * into m from public.sales_meetings where id = p_id for update;
  perform app.require(m.id is not null, 'Meeting not found');
  perform app.require(app.is_meeting_host(m.team), format('Only %s runs the %s', app.meeting_host_label(m.team), lower(app.meeting_label(m.team))));
  perform app.require(m.status = 'draft', 'The meeting is published – it can no longer be changed');
  return m;
end $$;

-- ---------------------------------------------------------------------------
-- Invitations (any team). Sales: Mondays 08:30 – 12:00. Estimation / Design: the host chooses the day and time.
-- ---------------------------------------------------------------------------
create or replace function public.invite_team_meeting(p_team text, p_date date, p_starts time, p_ends time, p_people uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; mid uuid; p uuid; s time; e time; lbl text := app.meeting_label(p_team);
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
      perform app.notify_many(array(select person_id from public.sales_meeting_invitees where meeting_id = mid and person_id = any (p_people)),
        'meeting_invite', lbl || ' time changed', format('%s %s %s – %s', to_char(p_date, 'Dy DD Mon'), '·', to_char(s, 'HH24:MI'), to_char(e, 'HH24:MI')),
        'normal', 'sales_meeting', mid, '/meetings', null, true);
    end if;
  end if;
  for p in select person_id from public.sales_meeting_invitees where meeting_id = mid and not (person_id = any (p_people)) loop
    delete from public.sales_meeting_invitees where meeting_id = mid and person_id = p;
    perform app.notify(p, 'meeting_invite', lbl || ' invitation withdrawn', to_char(p_date, 'Dy DD Mon YYYY'), 'normal', 'sales_meeting', mid, '/meetings');
  end loop;
  foreach p in array p_people loop
    continue when p = auth.uid();
    insert into public.sales_meeting_invitees (meeting_id, person_id, status)
    values (mid, p, case when exists (select 1 from public.meeting_exceptions x where x.sales_person_id = p and x.team = p_team and x.meeting_date = p_date
                                       and x.status = 'approved') then 'excused' else 'invited' end)
    on conflict (meeting_id, person_id) do nothing;
    if found then
      perform app.notify(p, 'meeting_invite', format('Invited: %s %s %s – %s', lower(lbl), to_char(p_date, 'Dy DD Mon'), to_char(s, 'HH24:MI'), to_char(e, 'HH24:MI')),
        'Mark your attendance in Meetings when you arrive, or apply for leave before the meeting', 'normal', 'sales_meeting', mid, '/meetings', null, true);
    end if;
  end loop;
  update public.sales_meetings set initiated_at = coalesce(initiated_at, now()), initiated_by = coalesce(initiated_by, auth.uid()) where id = mid;
  return mid;
end $$;

create or replace function public.invite_sales_meeting(p_date date, p_people uuid[]) returns uuid
language sql security definer set search_path = public as $$
  select public.invite_team_meeting('sales', p_date, null, null, p_people)
$$;

-- ---------------------------------------------------------------------------
-- The pack (any team)
-- ---------------------------------------------------------------------------
create or replace function public.generate_team_meeting(p_team text, p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; mid uuid;
begin
  perform app.require(p_team in ('sales', 'estimation', 'design'), 'Unknown meeting');
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
                                                     else app.sales_meeting_pack(p_date) end,
    generated_at = now(), generated_by = auth.uid() where id = mid;
  return mid;
end $$;

create or replace function public.generate_sales_meeting(p_date date) returns uuid
language sql security definer set search_path = public as $$
  select public.generate_team_meeting('sales', p_date)
$$;

-- Members of a team meeting's pack: those invited, or every member when nobody is invited yet
create or replace function app.meeting_pack_people(p_mid uuid, p_team text) returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name from public.profiles p
   where p.active and p.role = any (app.meeting_members(p_team))
     and (not exists (select 1 from public.sales_meeting_invitees i where i.meeting_id = p_mid)
          or exists (select 1 from public.sales_meeting_invitees i where i.meeting_id = p_mid and i.person_id = p.id))
   order by p.full_name
$$;

create or replace function app.meeting_open_actions(p_person uuid, p_date date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'due', a.due_date, 'meeting', m.meeting_date, 'team', m.team,
           'owner', app.display_name(coalesce(a.assignee_id, a.owner_id))) order by m.meeting_date), '[]')
    from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
   where (a.sales_person_id = p_person or a.owner_id = p_person or a.assignee_id = p_person) and a.status = 'open' and m.meeting_date < p_date
     and m.status = 'published'
$$;

create or replace function app.job_due(p_due timestamptz, p_revised timestamptz) returns date language sql stable as $$
  select (coalesce(p_revised, p_due) at time zone app.tz())::date
$$;

-- Estimation team pack
create or replace function app.estimation_meeting_pack(p_mid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.sales_meetings;
  d date;
  wk date;
  people jsonb := '[]';
  sp record;
  open_st text[] := array['queued', 'accepted', 'assigned', 'acknowledged', 'date_change_requested', 'in_progress', 'on_hold',
                          'submitted_for_approval', 'returned', 'gm_approval'];
  team jsonb;
begin
  select * into m from public.sales_meetings where id = p_mid;
  d := m.meeting_date; wk := d - 7;
  team := jsonb_build_object(
    'in_hand', (select jsonb_build_object(
        'new', count(*) filter (where j.status in ('queued', 'accepted')),
        'assigned', count(*) filter (where j.status in ('assigned', 'acknowledged', 'date_change_requested')),
        'in_progress', count(*) filter (where j.status = 'in_progress'),
        'on_hold', count(*) filter (where j.status = 'on_hold'),
        'approval', count(*) filter (where j.status in ('submitted_for_approval', 'gm_approval')),
        'returned', count(*) filter (where j.status = 'returned'),
        'total', count(*))
      from public.estimation_jobs j where j.status = any (open_st)),
    'released_n', (select count(*) from public.quotations q where (q.released_at at time zone app.tz())::date >= wk and (q.released_at at time zone app.tz())::date < d),
    'released_value', (select round(coalesce(sum(app.to_lkr(q.quoted_value, q.currency, d)), 0), 2) from public.quotations q
                        where (q.released_at at time zone app.tz())::date >= wk and (q.released_at at time zone app.tz())::date < d),
    'released_on_time_n', (select count(*) from public.estimation_jobs j where j.released_at is not null
                            and (j.released_at at time zone app.tz())::date >= wk and (j.released_at at time zone app.tz())::date < d
                            and (j.due_at is null or j.released_at <= coalesce(j.revised_due_at, j.due_at))),
    'released_jobs_n', (select count(*) from public.estimation_jobs j where j.released_at is not null
                         and (j.released_at at time zone app.tz())::date >= wk and (j.released_at at time zone app.tz())::date < d),
    'overdue_n', (select count(*) from public.estimation_jobs j where j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) < d),
    'at_risk_n', (select count(*) from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id where j.status = any (open_st)
                   and (app.job_due(j.due_at, j.revised_due_at) between d and d + 7 or i.customer_deadline between d and d + 7)),
    'clarifications_n', (select count(*) from public.clarifications c where c.answered_at is null),
    'clarifications_oldest', (select max(d - (c.asked_at at time zone app.tz())::date) from public.clarifications c where c.answered_at is null),
    'hit', (select jsonb_build_object('won', count(*) filter (where q.result = 'won'), 'lost', count(*) filter (where q.result = 'lost'))
              from public.quotations q where q.released_at >= (d - 90)::timestamp at time zone app.tz()),
    'waiting_design_n', (select count(*) from public.inquiries i where i.route = 'A' and i.status in ('accepted', 'in_design', 'design_review')),
    'overdue', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'person', app.display_name(j.assignee_id),
               'due', app.job_due(j.due_at, j.revised_due_at), 'days', d - app.job_due(j.due_at, j.revised_due_at), 'status', j.status) x
          from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id
         where j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) < d
         order by app.job_due(j.due_at, j.revised_due_at) limit 15) z), '[]'),
    'at_risk', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'person', app.display_name(j.assignee_id),
               'due', app.job_due(j.due_at, j.revised_due_at), 'customer_deadline', i.customer_deadline, 'status', j.status) x
          from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id
         where j.status = any (open_st) and (app.job_due(j.due_at, j.revised_due_at) between d and d + 7 or i.customer_deadline between d and d + 7)
         order by least(app.job_due(j.due_at, j.revised_due_at), i.customer_deadline) limit 15) z), '[]'),
    'returned', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'person', app.display_name(j.assignee_id),
               'reason', j.review_comment, 'revision', j.revision) x
          from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id where j.status = 'returned' limit 15) z), '[]'),
    'on_hold', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'person', app.display_name(j.assignee_id), 'reason', j.hold_reason) x
          from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id where j.status = 'on_hold' limit 15) z), '[]'),
    'clarifications', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'question', c.question, 'by', app.display_name(c.asked_by),
               'days', d - (c.asked_at at time zone app.tz())::date) x
          from public.clarifications c join public.inquiries i on i.id = c.inquiry_id where c.answered_at is null order by c.asked_at limit 15) z), '[]'),
    'waiting_design', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'status', i.status,
               'design_due', (select min(app.job_due(dj.due_at, dj.revised_due_at)) from public.design_jobs dj
                               where dj.inquiry_id = i.id and dj.status not in ('approved', 'released'))) x
          from public.inquiries i where i.route = 'A' and i.status in ('accepted', 'in_design', 'design_review') order by i.created_at limit 15) z), '[]'));
  for sp in select * from app.meeting_pack_people(p_mid, 'estimation') loop
    people := people || jsonb_build_object(
      'id', sp.id, 'name', sp.full_name,
      'in_hand_n', (select count(*) from public.estimation_jobs j where j.assignee_id = sp.id and j.status = any (open_st)),
      'released_week_n', (select count(*) from public.estimation_jobs j where j.assignee_id = sp.id and j.released_at is not null
                           and (j.released_at at time zone app.tz())::date >= wk and (j.released_at at time zone app.tz())::date < d),
      'overdue', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''),
                   'days', d - app.job_due(j.due_at, j.revised_due_at)) order by j.due_at)
                 from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id
                where j.assignee_id = sp.id and j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) < d), '[]'),
      'due_soon', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''),
                   'due', app.job_due(j.due_at, j.revised_due_at)) order by j.due_at)
                 from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id
                where j.assignee_id = sp.id and j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) between d and d + 7), '[]'),
      'avg_days', (select round(avg(extract(epoch from j.released_at - coalesce(j.assigned_at, j.created_at)) / 86400)::numeric, 1)
                     from public.estimation_jobs j where j.assignee_id = sp.id and j.released_at >= (d - 90)::timestamp at time zone app.tz()),
      'returns_n', (select count(*) from public.estimation_jobs j where j.assignee_id = sp.id
                     and (j.status = 'returned' or (j.revision > 0 and j.created_at >= (d - 90)::timestamp at time zone app.tz()))),
      'open_actions', app.meeting_open_actions(sp.id, d),
      'exception', (select jsonb_build_object('status', e.status, 'reason', e.reason) from public.meeting_exceptions e
                     where e.sales_person_id = sp.id and e.team = 'estimation' and e.meeting_date = d));
  end loop;
  return jsonb_build_object('team_kind', 'estimation', 'meeting_date', d, 'week_from', wk, 'week_to', d - 1, 'generated_at', now(),
    'team', team, 'people', people);
end $$;

-- Design team pack
create or replace function app.design_meeting_pack(p_mid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.sales_meetings;
  d date;
  wk date;
  people jsonb := '[]';
  sp record;
  open_st text[] := array['assigned', 'acknowledged', 'date_change_requested', 'in_progress', 'on_hold', 'in_review', 'returned', 'approved'];
  team jsonb;
begin
  select * into m from public.sales_meetings where id = p_mid;
  d := m.meeting_date; wk := d - 7;
  team := jsonb_build_object(
    'in_hand', (select jsonb_build_object(
        'assigned', count(*) filter (where j.status in ('assigned', 'acknowledged', 'date_change_requested')),
        'in_progress', count(*) filter (where j.status = 'in_progress'),
        'on_hold', count(*) filter (where j.status = 'on_hold'),
        'in_review', count(*) filter (where j.status = 'in_review'),
        'returned', count(*) filter (where j.status = 'returned'),
        'approved', count(*) filter (where j.status = 'approved'),
        'total', count(*))
      from public.design_jobs j where j.status = any (open_st)),
    'released_n', (select count(*) from public.design_jobs j where j.released_at is not null
                    and (j.released_at at time zone app.tz())::date >= wk and (j.released_at at time zone app.tz())::date < d),
    'released_on_time_n', (select count(*) from public.design_jobs j where j.released_at is not null
                            and (j.released_at at time zone app.tz())::date >= wk and (j.released_at at time zone app.tz())::date < d
                            and j.released_at <= coalesce(j.revised_due_at, j.due_at)),
    'overdue_n', (select count(*) from public.design_jobs j where j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) < d),
    'due_soon_n', (select count(*) from public.design_jobs j where j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) between d and d + 7),
    'early_releases_n', (select count(*) from public.inquiries i where (i.early_design_release_at at time zone app.tz())::date >= wk
                          and (i.early_design_release_at at time zone app.tz())::date < d),
    'waiting_info_n', (select count(*) from public.inquiries i where i.status = 'returned_for_info'),
    'waiting_estimation_n', (select count(*) from public.estimation_jobs j where j.source = 'design' and j.status in ('queued', 'accepted')),
    'hours_week', (select round(coalesce(sum(h.hours), 0), 1) from public.design_hours h where h.work_date >= wk and h.work_date < d),
    'overdue', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'person', app.display_name(j.assignee_id), 'task', j.task_type,
               'due', app.job_due(j.due_at, j.revised_due_at), 'days', d - app.job_due(j.due_at, j.revised_due_at), 'status', j.status) x
          from public.design_jobs j join public.inquiries i on i.id = j.inquiry_id
         where j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) < d
         order by app.job_due(j.due_at, j.revised_due_at) limit 15) z), '[]'),
    'due_soon', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'person', app.display_name(j.assignee_id), 'task', j.task_type,
               'due', app.job_due(j.due_at, j.revised_due_at), 'progress', j.progress_pct) x
          from public.design_jobs j join public.inquiries i on i.id = j.inquiry_id
         where j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) between d and d + 7
         order by app.job_due(j.due_at, j.revised_due_at) limit 15) z), '[]'),
    'returned', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'person', app.display_name(j.assignee_id),
               'reason', j.review_comment, 'cycles', j.review_cycles) x
          from public.design_jobs j join public.inquiries i on i.id = j.inquiry_id where j.status = 'returned' limit 15) z), '[]'),
    'on_hold', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'person', app.display_name(j.assignee_id),
               'reason', j.hold_reason, 'waiting_on', j.hold_waiting_on) x
          from public.design_jobs j join public.inquiries i on i.id = j.inquiry_id where j.status = 'on_hold' limit 15) z), '[]'),
    'waiting_info', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'sales', app.display_name(i.sales_person_id),
               'since', (i.updated_at at time zone app.tz())::date) x
          from public.inquiries i where i.status = 'returned_for_info' order by i.updated_at limit 15) z), '[]'));
  for sp in select * from app.meeting_pack_people(p_mid, 'design') loop
    people := people || jsonb_build_object(
      'id', sp.id, 'name', sp.full_name,
      'in_hand_n', (select count(*) from public.design_jobs j where j.assignee_id = sp.id and j.status = any (open_st)),
      'released_week_n', (select count(*) from public.design_jobs j where j.assignee_id = sp.id and j.released_at is not null
                           and (j.released_at at time zone app.tz())::date >= wk and (j.released_at at time zone app.tz())::date < d),
      'overdue', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''),
                   'days', d - app.job_due(j.due_at, j.revised_due_at)) order by j.due_at)
                 from public.design_jobs j join public.inquiries i on i.id = j.inquiry_id
                where j.assignee_id = sp.id and j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) < d), '[]'),
      'due_soon', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''),
                   'due', app.job_due(j.due_at, j.revised_due_at), 'progress', j.progress_pct) order by j.due_at)
                 from public.design_jobs j join public.inquiries i on i.id = j.inquiry_id
                where j.assignee_id = sp.id and j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) between d and d + 7), '[]'),
      'avg_days', (select jsonb_object_agg(t.task_type, t.days) from (
                     select j.task_type, round(avg(extract(epoch from j.released_at - j.assigned_at) / 86400)::numeric, 1) as days
                       from public.design_jobs j where j.assignee_id = sp.id and j.released_at >= (d - 90)::timestamp at time zone app.tz()
                      group by j.task_type) t),
      'review_returns', (select coalesce(sum(j.review_cycles), 0) from public.design_jobs j where j.assignee_id = sp.id
                          and j.created_at >= (d - 90)::timestamp at time zone app.tz()),
      'hours_week', (select round(coalesce(sum(h.hours), 0), 1) from public.design_hours h where h.user_id = sp.id and h.work_date >= wk and h.work_date < d),
      'open_actions', app.meeting_open_actions(sp.id, d),
      'exception', (select jsonb_build_object('status', e.status, 'reason', e.reason) from public.meeting_exceptions e
                     where e.sales_person_id = sp.id and e.team = 'design' and e.meeting_date = d));
  end loop;
  return jsonb_build_object('team_kind', 'design', 'meeting_date', d, 'week_from', wk, 'week_to', d - 1, 'generated_at', now(),
    'team', team, 'people', people);
end $$;

-- ---------------------------------------------------------------------------
-- Attendance (any team): before the meeting ends; the host approves a different location
-- ---------------------------------------------------------------------------
create or replace function public.attend_sales_meeting(p_meeting uuid, p_lat double precision, p_lng double precision) returns text
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; i public.sales_meeting_invitees; d double precision; st text;
begin
  select * into m from public.sales_meetings where id = p_meeting;
  select * into i from public.sales_meeting_invitees where meeting_id = p_meeting and person_id = auth.uid() for update;
  perform app.require(i.person_id is not null, 'You are not invited to this meeting');
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

create or replace function public.decide_attendance(p_meeting uuid, p_person uuid, p_present boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.sales_meeting_invitees; m public.sales_meetings;
begin
  select * into m from public.sales_meetings where id = p_meeting;
  perform app.require(m.id is not null and app.is_meeting_host(m.team), format('Only %s approves attendance', app.meeting_host_label(m.team)));
  select * into i from public.sales_meeting_invitees where meeting_id = p_meeting and person_id = p_person for update;
  perform app.require(i.person_id is not null, 'Not invited');
  perform app.require(p_present or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.sales_meeting_invitees set status = case when p_present then 'present' else 'absent' end, decided_by = auth.uid(),
    decided_at = now(), note = nullif(btrim(p_note), '') where meeting_id = p_meeting and person_id = p_person;
  perform app.notify(p_person, 'meeting_attendance', case when p_present then 'Attendance accepted' else 'Marked absent from the ' || lower(app.meeting_label(m.team)) end,
    coalesce(nullif(btrim(p_note), ''), ''), 'normal', 'sales_meeting', p_meeting, '/meetings', null, true);
end $$;

-- ---------------------------------------------------------------------------
-- Leave (any team): applied before the meeting starts, decided by the host before it starts
-- ---------------------------------------------------------------------------
create or replace function public.request_meeting_exception(p_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  perform app.require(not app.has_role('gm', 'sm_projects'), 'Not needed for your role');
  perform app.require(p_date is not null and extract(isodow from p_date) = 1, 'Choose the Monday');
  perform app.require(now() < app.meeting_start_at(p_date), 'Leave must be applied before the meeting starts');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(not exists (select 1 from public.meeting_exceptions where sales_person_id = auth.uid() and team = 'sales' and meeting_date = p_date
                                   and status <> 'rejected'), 'Leave for this meeting is already requested');
  delete from public.meeting_exceptions where sales_person_id = auth.uid() and team = 'sales' and meeting_date = p_date and status = 'rejected';
  insert into public.meeting_exceptions (sales_person_id, team, meeting_date, reason) values (auth.uid(), 'sales', p_date, btrim(p_reason)) returning id into eid;
  perform app.notify_many(app.role_users('sm_projects'), 'meeting_exception', 'Leave requested for the sales meeting',
    format('%s · Monday %s · %s', app.display_name(auth.uid()), to_char(p_date, 'DD Mon YYYY'), btrim(p_reason)),
    'normal', 'meeting_exception', eid, '/meetings?team=sales', null, true);
  return eid;
end $$;

create or replace function public.request_meeting_leave(p_meeting uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; eid uuid;
begin
  select * into m from public.sales_meetings where id = p_meeting;
  perform app.require(m.id is not null, 'Meeting not found');
  if m.team = 'sales' then return public.request_meeting_exception(m.meeting_date, p_reason); end if;
  perform app.require(exists (select 1 from public.sales_meeting_invitees where meeting_id = m.id and person_id = auth.uid()), 'You are not invited to this meeting');
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

create or replace function public.decide_meeting_exception(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.meeting_exceptions; m public.sales_meetings; starts timestamptz;
begin
  select * into e from public.meeting_exceptions where id = p_id for update;
  perform app.require(e.id is not null, 'Not found');
  perform app.require(app.is_meeting_host(e.team), format('Only %s approves leave from the %s', app.meeting_host_label(e.team), lower(app.meeting_label(e.team))));
  perform app.require(e.status = 'pending', 'Already decided');
  select * into m from public.sales_meetings where team = e.team and meeting_date = e.meeting_date;
  starts := case when m.id is not null then app.meeting_starts(m) else app.meeting_start_at(e.meeting_date) end;
  perform app.require(now() < starts, 'The meeting has started – leave can only be decided before it');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.meeting_exceptions set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(),
    decided_at = now(), decision_note = nullif(btrim(p_note), '') where id = e.id;
  if p_approve and m.id is not null then
    update public.sales_meeting_invitees set status = 'excused' where meeting_id = m.id and person_id = e.sales_person_id;
  end if;
  perform app.notify(e.sales_person_id, 'meeting_exception',
    format('Leave from the %s %s', lower(app.meeting_label(e.team)), case when p_approve then 'approved' else 'not approved' end),
    format('%s%s', to_char(e.meeting_date, 'Dy DD Mon YYYY'), coalesce(' · ' || nullif(btrim(p_note), ''), '')),
    'normal', 'meeting_exception', e.id, '/meetings', null, true);
end $$;

-- ---------------------------------------------------------------------------
-- Meetings tab and My Day
-- ---------------------------------------------------------------------------
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
   where i.person_id = auth.uid() and m.meeting_date >= (now() at time zone app.tz())::date - 56
   order by m.meeting_date desc, m.starts_at
$$;
revoke execute on function public.my_meetings() from public, anon;
grant execute on function public.my_meetings() to authenticated;

-- This week's meetings for My Day: invited, hosting (with "not set up yet" for the team's default day), or published / set up
-- for GM / DGM and SM Projects
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
      left join public.sales_meeting_invitees i on i.meeting_id = m.id and i.person_id = auth.uid()
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
revoke execute on function public.my_week_meetings() from public, anon;
grant execute on function public.my_week_meetings() to authenticated;

-- ---------------------------------------------------------------------------
-- Estimation / Design reminders (the sales meeting keeps its own tick)
-- ---------------------------------------------------------------------------
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
revoke execute on function public.team_meeting_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.team_meeting_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('team-meeting-tick', '*/15 * * * 1-6', 'select public.team_meeting_tick()');
  end if;
end $$;

revoke execute on function public.invite_team_meeting(text, date, time, time, uuid[]), public.generate_team_meeting(text, date),
  public.request_meeting_leave(uuid, text), public.my_week_meetings() from public, anon;
grant execute on function public.invite_team_meeting(text, date, time, time, uuid[]), public.generate_team_meeting(text, date),
  public.request_meeting_leave(uuid, text), public.my_week_meetings() to authenticated, service_role;

drop policy if exists meeting_exceptions_read on public.meeting_exceptions;
create policy meeting_exceptions_read on public.meeting_exceptions for select to authenticated
  using (sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm') or app.is_meeting_host(team));

-- The sales pack: only the sales meeting and its leave (copied from 20260930000075)
create or replace function app.sales_meeting_pack(p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fy int := app.fy_of(p_date);
  mon date := app.month_of(p_date);
  wk date := p_date - 7;
  perf jsonb := public.finance_performance(app.fy_of(p_date));
  people jsonb := '[]';
  sp record;
  pp jsonb;
  t record;
  o jsonb;
  team jsonb;
  mid uuid;
  invited boolean;
begin
  -- Invited sales persons (all active sales persons when nobody was invited)
  select x.id into mid from public.sales_meetings x where x.team = 'sales' and x.meeting_date = p_date;
  invited := exists (select 1 from public.sales_meeting_invitees where meeting_id = mid);
  for sp in select p.id, p.full_name from public.profiles p where p.active and p.role in ('asm_building', 'asm_infra')
               and (not invited or exists (select 1 from public.sales_meeting_invitees i where i.meeting_id = mid and i.person_id = p.id))
             order by p.full_name loop
    select x into pp from jsonb_array_elements(perf -> 'people') x where x ->> 'id' = sp.id::text;
    select coalesce(sum(m.secured_target), 0) st, coalesce(sum(m.secured), 0) s, coalesce(sum(m.invoice_target), 0) it, coalesce(sum(m.invoiced), 0) i
      into t from jsonb_to_recordset(coalesce(pp -> 'months', '[]')) m(month date, secured_target numeric, secured numeric, invoice_target numeric, invoiced numeric)
     where m.month <= mon;
    o := jsonb_build_object(
      'id', sp.id, 'name', sp.full_name,
      'target', jsonb_build_object('budget_secure', t.st, 'secured', t.s, 'budget_invoice', t.it, 'invoiced', t.i,
        'secured_pct', case when t.st > 0 then round(t.s / t.st * 100, 2) else 0 end,
        'invoiced_pct', case when t.it > 0 then round(t.i / t.it * 100, 2) else 0 end,
        'score', round(0.4 * case when t.st > 0 then t.s / t.st * 100 else 0 end + 0.6 * case when t.it > 0 then t.i / t.it * 100 else 0 end, 2)),
      'wins', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'customer', i.customer_name,
          'value', round(coalesce(app.to_lkr(i.order_value, i.currency, i.order_date), 0), 2)) order by i.order_date)
        from public.inquiries i where i.sales_person_id = sp.id and i.result = 'won'
         and coalesce(i.order_date, i.updated_at::date) >= wk and coalesce(i.order_date, i.updated_at::date) < p_date), '[]'),
      'losses', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'customer', i.customer_name,
          'reason', i.lost_reason))
        from public.inquiries i where i.sales_person_id = sp.id and i.result = 'lost' and i.updated_at::date >= wk and i.updated_at::date < p_date), '[]'),
      'quotes_waiting_n', (select count(*) from public.inquiries i where i.sales_person_id = sp.id
         and i.status in ('submitted_to_client', 'awaiting_client_approval')),
      'quotes_waiting', coalesce((select jsonb_agg(q) from (
          select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'customer', i.customer_name,
                 'days', p_date - coalesce(i.submitted_to_client_at, i.quotation_released_at, i.updated_at)::date) q
            from public.inquiries i where i.sales_person_id = sp.id and i.status in ('submitted_to_client', 'awaiting_client_approval')
           order by coalesce(i.submitted_to_client_at, i.quotation_released_at, i.updated_at) limit 10) z), '[]'),
      'followups_overdue_n', (select count(*) from public.visits v where v.sales_person_id = sp.id and v.status = 'open'
         and v.next_action_date < p_date and v.next_action_done_at is null),
      'followups_overdue', coalesce((select jsonb_agg(f) from (
          select jsonb_build_object('date', v.next_action_date, 'customer', o2.name, 'action', v.next_action) f
            from public.visits v join public.organizations o2 on o2.id = v.organization_id
           where v.sales_person_id = sp.id and v.status = 'open' and v.next_action_date < p_date and v.next_action_done_at is null
           order by v.next_action_date limit 10) z), '[]'),
      'visits', jsonb_build_object(
        'planned', (select count(*) from public.visit_plan_lines l join public.visit_plans vp on vp.id = l.plan_id
                     where vp.sales_person_id = sp.id and l.planned_date >= wk and l.planned_date < p_date and l.status <> 'cancelled'),
        'completed', (select count(*) from public.visit_plan_lines l join public.visit_plans vp on vp.id = l.plan_id
                     where vp.sales_person_id = sp.id and l.planned_date >= wk and l.planned_date < p_date and l.status = 'completed'),
        'missed', (select count(*) from public.visit_plan_lines l join public.visit_plans vp on vp.id = l.plan_id
                     where vp.sales_person_id = sp.id and l.planned_date >= wk and l.planned_date < p_date and l.status = 'missed'),
        'done', (select count(*) from public.visits v where v.sales_person_id = sp.id
                  and (v.checkin_at at time zone app.tz())::date >= wk and (v.checkin_at at time zone app.tz())::date < p_date)),
      'not_visited_n', (select count(*) from public.projects pr where pr.owner_id = sp.id and pr.status = 'active'
         and coalesce((select max(v.checkin_at) from public.visits v where v.project_id = pr.id), pr.created_at) < p_date - 30),
      'not_visited', coalesce((select jsonb_agg(n) from (
          select jsonb_build_object('project', pr.name, 'value', round(coalesce(app.to_lkr(pr.lighting_value, case when pr.duty_status = 'duty_free' then 'USD'::public.currency else 'LKR'::public.currency end, p_date), 0), 2),
                 'last_visit', (select max(v.checkin_at)::date from public.visits v where v.project_id = pr.id)) n
            from public.projects pr where pr.owner_id = sp.id and pr.status = 'active'
             and coalesce((select max(v.checkin_at) from public.visits v where v.project_id = pr.id), pr.created_at) < p_date - 30
           order by pr.lighting_value desc nulls last limit 5) z), '[]'),
      'invoices', (select jsonb_build_object(
          'slipped_n', count(*) filter (where v.forecast_month < mon),
          'slipped', coalesce(sum(v.remaining) filter (where v.forecast_month < mon), 0),
          'due_month', coalesce(sum(v.remaining) filter (where v.forecast_month = mon), 0))
        from public.invoice_line_status v where v.sales_person_id = sp.id and v.project_status = 'open' and v.remaining > 0.5),
      'debtors_90', (select jsonb_build_object('n', count(*), 'lkr', round(coalesce(sum(app.to_lkr(d.amount, d.currency, p_date)), 0), 2))
        from public.debts d where d.sales_person_id = sp.id and d.outstanding_days > 90
         and d.status not in ('collected', 'collected_confirmed', 'cleared')),
      'retentions_due', (select jsonb_build_object('n', count(*), 'lkr', round(coalesce(sum(app.to_lkr(r.retention_value, r.currency, p_date)), 0), 2))
        from public.retentions r where r.sales_person_id = sp.id and r.status = 'held' and r.due_date <= p_date + 30),
      'open_actions', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'due', a.due_date, 'meeting', m.meeting_date,
          'owner', app.display_name(a.owner_id)) order by m.meeting_date)
        from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
         where a.sales_person_id = sp.id and a.status = 'open' and m.meeting_date < p_date), '[]'),
      'exception', (select jsonb_build_object('status', e.status, 'reason', e.reason) from public.meeting_exceptions e
        where e.sales_person_id = sp.id and e.team = 'sales' and e.meeting_date = p_date)
    );
    people := people || o;
  end loop;
  select jsonb_build_object(
      'budget_secure', coalesce(sum((x -> 'target' ->> 'budget_secure')::numeric), 0), 'secured', coalesce(sum((x -> 'target' ->> 'secured')::numeric), 0),
      'budget_invoice', coalesce(sum((x -> 'target' ->> 'budget_invoice')::numeric), 0), 'invoiced', coalesce(sum((x -> 'target' ->> 'invoiced')::numeric), 0),
      'wins_n', coalesce(sum(jsonb_array_length(x -> 'wins')), 0), 'losses_n', coalesce(sum(jsonb_array_length(x -> 'losses')), 0),
      'wins_value', coalesce(sum((select sum((w ->> 'value')::numeric) from jsonb_array_elements(x -> 'wins') w)), 0),
      'quotes_waiting_n', coalesce(sum((x ->> 'quotes_waiting_n')::int), 0), 'followups_overdue_n', coalesce(sum((x ->> 'followups_overdue_n')::int), 0),
      'slipped_n', coalesce(sum((x -> 'invoices' ->> 'slipped_n')::int), 0), 'slipped', coalesce(sum((x -> 'invoices' ->> 'slipped')::numeric), 0),
      'debtors_90', coalesce(sum((x -> 'debtors_90' ->> 'lkr')::numeric), 0))
    into team from jsonb_array_elements(people) x;
  return jsonb_build_object('meeting_date', p_date, 'fy', fy, 'month', mon, 'week_from', wk, 'week_to', p_date - 1,
    'generated_at', now(), 'team', team, 'people', people);
end $$;

-- Sales meeting reminders: the sales meeting only (copied from 20260930000075)
create or replace function public.sales_meeting_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  monday date;
  m public.sales_meetings;
  n int := 0;
  away uuid[];
begin
  if extract(isodow from today) = 7 then
    monday := today + 1;
    select * into m from public.sales_meetings where team = 'sales' and meeting_date = monday;
    if m.initiated_at is null then
      if loc::time >= time '08:00' then
        perform app.notify_many(app.role_users('sm_projects'), 'sales_meeting', 'Invite the team for tomorrow''s sales meeting by 10:00',
          'Open Meetings → Sales meeting → Invite for Monday ' || to_char(monday, 'DD Mon'), 'normal', null, null, '/meetings?team=sales', format('meetinv1:%s', monday), false);
        n := n + 1;
      end if;
      if loc::time >= time '10:00' then
        perform app.notify_many(app.role_users('sm_projects'), 'sales_meeting', 'Sales meeting invitations are overdue (due 10:00)',
          'Invite the team for Monday ' || to_char(monday, 'DD Mon'), 'critical', null, null, '/meetings?team=sales', format('meetinv2:%s', monday), false);
        n := n + 1;
      end if;
      if loc::time >= time '15:00' then
        perform app.notify_many(app.role_users('gm'), 'sales_meeting', 'Sales meeting not initiated',
          format('SM Projects has not invited the team for Monday %s''s sales meeting', to_char(monday, 'DD Mon')),
          'critical', null, null, '/meetings?team=sales', format('meetinv3:%s', monday), false);
        n := n + 1;
      end if;
    end if;
    return n;
  end if;

  if extract(isodow from today) <> 1 or loc::time < time '08:00' then return 0; end if;
  select * into m from public.sales_meetings where team = 'sales' and meeting_date = today;
  if loc::time < time '12:00' then
    if m.initiated_at is not null then
      perform app.notify_many(array(select person_id from public.sales_meeting_invitees where meeting_id = m.id and status = 'invited') || app.role_users('sm_projects'),
        'sales_meeting', 'Sales meeting today 08:30 – 12:00', 'Mark your attendance in Meetings when you arrive', 'normal', null, null, '/meetings',
        format('meet:%s', today), false);
    else
      select coalesce(array_agg(sales_person_id), '{}') into away from public.meeting_exceptions where team = 'sales' and meeting_date = today and status = 'approved';
      perform app.notify_many(array(select x from unnest(app.role_users('asm_building', 'asm_infra')) x where not (x = any (away))) || app.role_users('sm_projects'),
        'sales_meeting', 'Sales meeting today 08:30 – 12:00', 'Weekly sales meeting with SM Projects', 'normal', null, null, '/', format('meet:%s', today), false);
    end if;
    n := n + 1;
    if m.pack is null then
      perform app.notify_many(app.role_users('sm_projects'), 'sales_meeting', 'Generate today''s sales meeting pack',
        'Open Meetings → Sales meeting and press Generate pack', 'normal', null, null, '/meetings?team=sales', format('meetpack:%s', today), false);
      n := n + 1;
    end if;
  elsif m.id is not null then
    -- Not marked by 12:00 → absent
    update public.sales_meeting_invitees set status = 'absent', note = coalesce(note, 'Not marked by 12:00')
     where meeting_id = m.id and status = 'invited';
    get diagnostics n = row_count;
  end if;
  return n;
end $$;

-- Monday visit block: sales meeting leave only (copied from 20260930000073)
create or replace function app.visit_line_meeting_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare sp uuid; s time; e time;
begin
  if extract(isodow from new.planned_date) <> 1 or new.status in ('cancelled', 'rescheduled', 'missed') then return new; end if;
  -- Only when a visit is planned or moved (status changes such as completed / missed are never blocked)
  if tg_op = 'UPDATE' and new.planned_date = old.planned_date and new.time_slot is not distinct from old.time_slot then
    return new;
  end if;
  select vp.sales_person_id into sp from public.visit_plans vp where vp.id = new.plan_id;
  if not exists (select 1 from public.profiles where id = sp and role in ('asm_building', 'asm_infra')) then return new; end if;
  if exists (select 1 from public.meeting_exceptions where sales_person_id = sp and team = 'sales' and meeting_date = new.planned_date and status = 'approved') then
    return new;
  end if;
  select t1, t2 into s, e from app.slot_times(new.time_slot);
  perform app.require(s is not null,
    'Monday 08:30 – 12:00 is the sales meeting – enter the visit time (e.g. 13:30), or ask SM Projects for an exception');
  perform app.require(not (s < time '12:00' and coalesce(e, s + interval '1 minute') > time '08:30'),
    'Monday 08:30 – 12:00 is the sales meeting – plan the visit from 12:00, or ask SM Projects for an exception with the reason');
  return new;
end $$;

-- (copied from 20260930000076: sales meeting leave only)
create or replace function app.place_meeting_visits(p_person uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  a public.sales_meeting_actions;
  today date := (now() at time zone app.tz())::date;
  d date;
  pl public.visit_plans;
  n int := 0;
begin
  for a in select x.* from public.sales_meeting_actions x join public.sales_meetings m on m.id = x.meeting_id and m.status = 'published'
            where x.kind = 'visit' and x.status = 'open' and x.owner_id = p_person
              and not exists (select 1 from public.visit_plan_lines l where l.meeting_action_id = x.id) loop
    d := greatest(coalesce(a.due_date, today), today);
    if extract(isodow from d) = 7 then d := d + 1; end if;
    select * into pl from public.visit_plans
     where sales_person_id = p_person and week_start = d - (extract(isodow from d)::int - 1) and status in ('draft', 'returned', 'submitted', 'approved');
    continue when pl.id is null;
    insert into public.visit_plan_lines (plan_id, planned_date, time_slot, project_id, organization_id, visit_category, planned_objective, meeting_action_id,
      lat, lng, change_reason)
    select pl.id, d, case when extract(isodow from d) = 1 and not exists (select 1 from public.meeting_exceptions e where e.sales_person_id = p_person
                                and e.team = 'sales' and e.meeting_date = d and e.status = 'approved') then '12:00' end,
           a.project_id, a.organization_id, o.visit_category, a.objective, a.id, pr.lat, pr.lng,
           'Follow-up from the meeting: ' || a.action
      from public.organizations o left join public.projects pr on pr.id = a.project_id
     where o.id = a.organization_id;
    n := n + 1;
    perform app.notify(p_person, 'meeting_action', 'Follow-up visit added to your plan',
      format('%s – %s. Set the day and time in the week of %s', app.action_subject(a), to_char(d, 'Dy DD Mon'), to_char(pl.week_start, 'DD Mon')),
      'normal', 'visit_plan', pl.id, '/plan/' || pl.id, format('meetvisit:%s:%s', a.id, pl.id), true);
  end loop;
  return n;
end $$;

-- Publish: GM / DGM (and SM Projects for Estimation / Design) (copied from 20260930000076)
create or replace function public.publish_sales_meeting(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_id); a public.sales_meeting_actions; p uuid;
begin
  perform app.require(m.pack is not null, 'Generate the meeting pack first');
  update public.sales_meetings set status = 'published', published_at = now(), published_by = auth.uid() where id = m.id;
  perform app.notify_many(app.meeting_viewers(m.team), 'sales_meeting', app.meeting_label(m.team) || ' pack – ' || to_char(m.meeting_date, 'DD Mon YYYY'),
    format('%s actions · published by %s', (select count(*) from public.sales_meeting_actions where meeting_id = m.id), app.display_name(auth.uid())),
    'normal', 'sales_meeting', m.id, '/meeting/' || m.id);
  for a in select * from public.sales_meeting_actions where meeting_id = m.id and status = 'open' order by created_at loop
    if a.kind in ('design', 'estimation', 'execution') then
      perform app.notify(a.owner_id, 'meeting_action', 'Appoint a person – ' || lower(app.action_kind_label(a.kind)) || ' from the ' || lower(app.meeting_label(m.team)),
        format('%s%s. Appoint within %s hours (GM / DGM and SM Projects are told if not)', app.action_subject(a),
          coalesce(' · due ' || to_char(a.due_date, 'DD Mon'), ''), app.setting_num('meeting_assign_hours', 24)),
        'normal', 'sales_meeting', m.id, '/meetings', null, true);
    elsif a.kind = 'task' and a.owner_id <> auth.uid() then
      perform app.notify(a.owner_id, 'meeting_action', 'Action from the ' || lower(app.meeting_label(m.team)),
        app.action_subject(a) || coalesce(' · due ' || to_char(a.due_date, 'DD Mon'), ''), 'normal', 'sales_meeting', m.id, '/meetings', null, true);
    end if;
    if a.sales_person_id is not null and a.sales_person_id <> a.owner_id then
      perform app.notify(a.sales_person_id, 'meeting_action', 'Follow-up on your project – ' || lower(app.action_kind_label(a.kind)),
        format('%s · with %s', app.action_subject(a), app.display_name(a.owner_id)), 'normal', 'sales_meeting', m.id, '/meetings', null, true);
    end if;
  end loop;
  for p in select distinct owner_id from public.sales_meeting_actions where meeting_id = m.id and kind = 'visit' and status = 'open' loop
    perform app.place_meeting_visits(p);
    -- Not placed (no plan for that week yet): tell the sales person it will be in the plan
    perform app.notify(p, 'meeting_action', 'Follow-up visit(s) from the ' || lower(app.meeting_label(m.team)),
      (select string_agg(app.action_subject(x) || ' · by ' || to_char(x.due_date, 'DD Mon'), E'\n')
         from public.sales_meeting_actions x where x.meeting_id = m.id and x.kind = 'visit' and x.owner_id = p
          and not exists (select 1 from public.visit_plan_lines l where l.meeting_action_id = x.id))
        || E'\nThey are added to your weekly plan when you create it – you set the day and time.',
      'normal', 'sales_meeting', m.id, '/meetings', format('meetvisitwait:%s:%s', m.id, p), true)
     where exists (select 1 from public.sales_meeting_actions x where x.meeting_id = m.id and x.kind = 'visit' and x.owner_id = p
                    and not exists (select 1 from public.visit_plan_lines l where l.meeting_action_id = x.id));
  end loop;
end $$;

-- (copied from 20260930000076: the meeting's host reopens)
create or replace function public.set_meeting_action_done(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions;
begin
  if p_done then perform public.complete_meeting_action(p_id, 'Confirmed by the meeting host'); return; end if;
  select * into a from public.sales_meeting_actions where id = p_id;
  perform app.require(a.id is not null, 'Not found');
  perform app.require(app.has_role('sm_projects') or app.is_meeting_host((select team from public.sales_meetings where id = a.meeting_id)),
    'Only the meeting host reopens an action');
  update public.sales_meeting_actions set status = 'open', done_at = null, done_by = null where id = p_id returning * into a;
  perform app.notify_many(array_remove(array[coalesce(a.assignee_id, a.owner_id)], null), 'meeting_action', 'Meeting action reopened',
    app.action_subject(a), 'normal', 'sales_meeting', a.meeting_id, '/meetings', null, true);
  if a.kind = 'visit' then perform app.place_meeting_visits(a.owner_id); end if;
end $$;

-- (copied from 20260930000076: the meeting's host can confirm too)
create or replace function public.complete_meeting_action(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions;
begin
  select * into a from public.sales_meeting_actions where id = p_id for update;
  perform app.require(a.id is not null and app.meeting_published(a.meeting_id), 'Action not found');
  perform app.require(a.status = 'open', 'Already confirmed as done');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Say what was done');
  if not (app.has_role('sm_projects') or app.is_meeting_host((select team from public.sales_meetings where id = a.meeting_id))) then
    perform app.require(a.kind <> 'visit', 'A follow-up visit is done when you check out of the visit from your plan');
    perform app.require(case when a.kind in ('design', 'estimation', 'execution') then auth.uid() = coalesce(a.assignee_id, a.owner_id) and a.assignee_id is not null
                             else auth.uid() = a.owner_id end,
      case when a.kind in ('design', 'estimation', 'execution') and a.assignee_id is null then 'Appoint the person first – they confirm when it is done'
           else 'Only the person doing it confirms' end);
  end if;
  update public.sales_meeting_actions set status = 'done', done_at = now(), done_by = auth.uid(), done_note = btrim(p_note) where id = a.id;
  perform app.notify_many(array_remove(app.action_people(a), auth.uid()), 'meeting_action', 'Meeting action done',
    format('%s · %s · %s', app.display_name(auth.uid()), app.action_subject(a), btrim(p_note)), 'normal', 'sales_meeting', a.meeting_id,
    '/meetings', null, true);
end $$;

-- Everyone concerned: the doer(s), the sales person, the meeting's host (copied from 20260930000076)
create or replace function app.action_people(a public.sales_meeting_actions) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[a.owner_id, a.assignee_id, a.sales_person_id], null) || app.role_users(app.meeting_host_role((select team from public.sales_meetings where id = a.meeting_id)))
$$;


-- Delays go to GM / DGM and the meeting's host (copied from 20260930000076)
create or replace function public.meeting_action_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  a public.sales_meeting_actions;
  n int := 0;
  today date := (p_at at time zone app.tz())::date;
  hrs int := app.setting_num('meeting_assign_hours', 24)::int;
begin
  for a in select x.* from public.sales_meeting_actions x join public.sales_meetings m on m.id = x.meeting_id
            where m.status = 'published' and x.status = 'open' and x.kind in ('design', 'estimation', 'execution') and x.assignee_id is null
              and m.published_at + make_interval(hours => hrs) < p_at loop
    perform app.notify_many(app.role_users('gm') || app.role_users(app.meeting_host_role((select team from public.sales_meetings where id = a.meeting_id))) || a.owner_id, 'meeting_action',
      format('Not appointed – %s from the meeting', lower(app.action_kind_label(a.kind))),
      format('%s has not appointed a person in %s hours: %s', app.display_name(a.owner_id), hrs,
        app.action_subject(a)),
      'critical', 'sales_meeting', a.meeting_id, '/meeting/' || a.meeting_id, format('meetassign:%s', a.id), true);
    n := n + 1;
  end loop;
  for a in select x.* from public.sales_meeting_actions x join public.sales_meetings m on m.id = x.meeting_id
            where m.status = 'published' and x.status = 'open' and x.due_date < today loop
    perform app.notify_many(array_remove(array[coalesce(a.assignee_id, a.owner_id), a.sales_person_id], null) || app.role_users(app.meeting_host_role((select team from public.sales_meetings where id = a.meeting_id))),
      'meeting_action', 'Meeting action overdue',
      format('%s · due %s · %s', app.action_subject(a), to_char(a.due_date, 'DD Mon'),
        app.display_name(coalesce(a.assignee_id, a.owner_id))),
      'critical', 'sales_meeting', a.meeting_id, '/meetings', format('meetdue:%s', a.id), true);
    n := n + 1;
  end loop;
  for a in select x.* from public.sales_meeting_actions x join public.sales_meetings m on m.id = x.meeting_id
            where m.status = 'published' and x.status = 'open' and x.kind = 'visit' and x.due_date <= today + 2
              and not exists (select 1 from public.visit_plan_lines l where l.meeting_action_id = x.id and l.status in ('planned', 'completed')) loop
    perform app.notify_many(array[a.owner_id] || app.role_users(app.meeting_host_role((select team from public.sales_meetings where id = a.meeting_id))), 'meeting_action', 'Follow-up visit not planned',
      format('%s · due %s · %s – add it to the weekly plan', app.action_subject(a),
        to_char(a.due_date, 'DD Mon'), app.display_name(a.owner_id)),
      'normal', 'sales_meeting', a.meeting_id, '/meetings', format('meetunplanned:%s', a.id), true);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Leave and attendance checks go to the meeting's host (copied from 20260930000076)
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
  order by 8
$$;

-- Wording for any meeting; the meeting's host can appoint too (copied from 20260930000076)
create or replace function public.assign_meeting_action(p_id uuid, p_person uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions; prole public.app_role; prev uuid;
begin
  select * into a from public.sales_meeting_actions where id = p_id for update;
  perform app.require(a.id is not null and app.meeting_published(a.meeting_id), 'Action not found');
  perform app.require(a.kind in ('design', 'estimation', 'execution'), 'Only design, estimation and execution tasks are assigned');
  perform app.require(a.status = 'open', 'This action is done');
  perform app.require(auth.uid() = a.owner_id or app.has_role('sm_projects') or app.is_meeting_host((select team from public.sales_meetings where id = a.meeting_id)), 'Only the manager it was given to appoints the person');
  select role into prole from public.profiles where id = p_person and active;
  perform app.require(prole = any (app.action_members(a.kind)), 'Choose a person from the team');
  prev := a.assignee_id;
  update public.sales_meeting_actions set assignee_id = p_person, assigned_at = now(), assigned_by = auth.uid(),
    done_note = coalesce(done_note, nullif(btrim(p_note), '')) where id = a.id returning * into a;
  perform app.notify(p_person, 'meeting_action', 'Task from the ' || lower(app.meeting_label((select team from public.sales_meetings where id = a.meeting_id))) || ' – ' || lower(app.action_kind_label(a.kind)),
    format('%s%s · appointed by %s%s', app.action_subject(a), coalesce(' · due ' || to_char(a.due_date, 'DD Mon'), ''), app.display_name(auth.uid()),
      coalesce(' · ' || nullif(btrim(p_note), ''), '')),
    'normal', 'sales_meeting', a.meeting_id, '/meetings', null, true);
  if prev is not null and prev <> p_person then
    perform app.notify(prev, 'meeting_action', 'Meeting task reassigned', app.action_subject(a) || ' · now with ' || app.display_name(p_person),
      'normal', 'sales_meeting', a.meeting_id, '/meetings');
  end if;
  perform app.notify_many(array_remove(array_remove(app.action_people(a), p_person), auth.uid()), 'meeting_action',
    format('%s appointed – %s', app.action_kind_label(a.kind), app.display_name(p_person)),
    app.action_subject(a) || ' · by ' || app.display_name(auth.uid()), 'normal', 'sales_meeting', a.meeting_id, '/meetings', null, true);
end $$;
