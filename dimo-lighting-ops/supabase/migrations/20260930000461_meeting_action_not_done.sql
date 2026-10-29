-- Meeting actions that will not be done, delays with a new date, and blocks with a named helper:
--  * Not done: the person doing it (or the host / SM Projects) closes an open action with a reason and an explanation. It stops
--    showing as overdue; SM Projects / the meeting host accept it or reopen it with a new due date.
--  * Delayed: the status update carries the new due date (the old one stays on the update); the overdue alert can fire again
--    for the new date.
--  * Blocked: the status update names who can help; they are told and the action shows on their list until the next update.
--  * Report: per person – done, not done (with the top reason), delayed, overdue.

alter table public.sales_meeting_actions drop constraint if exists sales_meeting_actions_status_check;
alter table public.sales_meeting_actions add constraint sales_meeting_actions_status_check check (status in ('open', 'done', 'not_done'));
alter table public.sales_meeting_actions add column if not exists nd_reason text check (nd_reason in ('declined', 'on_hold', 'not_needed', 'out_of_scope', 'waiting', 'other'));
alter table public.sales_meeting_actions add column if not exists nd_note text;
alter table public.sales_meeting_actions add column if not exists nd_at timestamptz;
alter table public.sales_meeting_actions add column if not exists nd_by uuid references public.profiles (id);
alter table public.sales_meeting_actions add column if not exists nd_accepted_at timestamptz;
alter table public.sales_meeting_actions add column if not exists nd_accepted_by uuid references public.profiles (id);

-- several updates in one transaction keep their order
alter table public.meeting_action_reviews alter column created_at set default clock_timestamp();
alter table public.meeting_action_reviews add column if not exists old_due date;
alter table public.meeting_action_reviews add column if not exists new_due date;
alter table public.meeting_action_reviews add column if not exists helper_id uuid references public.profiles (id);

create or replace function app.nd_reason_label(p text) returns text language sql immutable as $$
  select case p when 'declined' then 'Customer declined / not interested' when 'on_hold' then 'Project cancelled or on hold'
                when 'not_needed' then 'No longer needed / overtaken by another action' when 'out_of_scope' then 'Outside our scope'
                when 'waiting' then 'Can''t proceed – waiting on others' else 'Other' end
$$;

-- Who reviews a not-done action: SM Projects and the meeting's host
create or replace function app.can_decide_not_done(a public.sales_meeting_actions) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('sm_projects', 'gm') or app.is_meeting_host((select team from public.sales_meetings where id = a.meeting_id))
$$;

-- People who can help with a blocked action: managers and the meeting hosts
create or replace function public.meeting_action_helpers() returns table (id uuid, full_name text, role public.app_role)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role from public.profiles p
   where p.active and p.role in ('gm', 'sm_projects', 'sm_estimation', 'am_estimation', 'design_manager', 'operations_exec', 'senior_elec_engineer')
   order by array_position(array['sm_projects', 'sm_estimation', 'design_manager', 'operations_exec', 'senior_elec_engineer', 'am_estimation', 'gm']::public.app_role[], p.role), p.full_name
$$;
revoke execute on function public.meeting_action_helpers() from public, anon;
grant execute on function public.meeting_action_helpers() to authenticated;

-- The status update: Delayed needs the new due date, Blocked needs who can help
drop function if exists public.review_meeting_action(uuid, text, text);
create or replace function public.review_meeting_action(p_id uuid, p_state text, p_note text, p_due date default null, p_helper uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions; m public.sales_meetings; helped boolean;
begin
  select * into a from public.sales_meeting_actions where id = p_id;
  perform app.require(a.id is not null and app.meeting_published(a.meeting_id), 'Action not found');
  select * into m from public.sales_meetings where id = a.meeting_id;
  helped := exists (select 1 from public.meeting_action_reviews r where r.action_id = a.id and r.helper_id = auth.uid()
                      and r.created_at = (select max(created_at) from public.meeting_action_reviews where action_id = a.id));
  perform app.require(auth.uid() in (a.owner_id, a.assignee_id) or helped or app.is_meeting_host(m.team) or app.has_role('sm_projects'),
    'Only the person doing it, the owner or the meeting host can update it');
  perform app.require(a.status = 'open', 'This action is closed');
  perform app.require(p_state in ('on_track', 'delayed', 'blocked'), 'Choose the status');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Write a short status note');
  if p_state = 'delayed' then
    perform app.require(p_due is not null, 'Set the new due date');
    perform app.require(p_due >= (now() at time zone app.tz())::date, 'The new due date cannot be in the past');
  end if;
  if p_state = 'blocked' then
    perform app.require(p_helper is not null and exists (select 1 from public.meeting_action_helpers() h where h.id = p_helper), 'Choose who can help');
  end if;
  insert into public.meeting_action_reviews (action_id, state, note, old_due, new_due, helper_id)
  values (a.id, p_state, btrim(p_note), case when p_state = 'delayed' then a.due_date end, case when p_state = 'delayed' then p_due end,
          case when p_state = 'blocked' then p_helper end);
  if p_state = 'delayed' and p_due is distinct from a.due_date then
    perform set_config('app.workflow', '1', true);
    update public.sales_meeting_actions set due_date = p_due where id = a.id;
  end if;
  if p_state <> 'on_track' then
    perform app.notify_many(array_remove(app.action_people(a) || case when p_state = 'blocked' then array[p_helper] else '{}'::uuid[] end, auth.uid()), 'meeting_action',
      case p_state when 'blocked' then 'Meeting action blocked' else 'Meeting action delayed' end,
      format('%s · %s · %s%s', app.display_name(auth.uid()), app.action_subject(a), btrim(p_note),
        case when p_state = 'delayed' then format(' · new date %s (was %s)', to_char(p_due, 'DD Mon'), coalesce(to_char(a.due_date, 'DD Mon'), 'none'))
             else format(' · help asked from %s', app.display_name(p_helper)) end),
      case p_state when 'blocked' then 'critical' else 'normal' end::public.priority, 'sales_meeting', a.meeting_id, '/meeting/review/' || a.meeting_id, null, true);
  end if;
  if p_state = 'blocked' and p_helper <> auth.uid() then
    perform app.notify(p_helper, 'meeting_action', 'Your help is needed on a meeting action',
      format('%s asks for your help · %s · %s', app.display_name(auth.uid()), app.action_subject(a), btrim(p_note)),
      'critical', 'sales_meeting', a.meeting_id, '/meetings', null, true);
  end if;
end $$;
revoke execute on function public.review_meeting_action(uuid, text, text, date, uuid) from public, anon;
grant execute on function public.review_meeting_action(uuid, text, text, date, uuid) to authenticated;

-- Not done: close an open action with a reason
create or replace function public.meeting_action_not_done(p_id uuid, p_reason text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions; m public.sales_meetings;
begin
  select * into a from public.sales_meeting_actions where id = p_id for update;
  perform app.require(a.id is not null and app.meeting_published(a.meeting_id), 'Action not found');
  select * into m from public.sales_meetings where id = a.meeting_id;
  perform app.require(auth.uid() in (a.owner_id, a.assignee_id) or app.is_meeting_host(m.team) or app.has_role('sm_projects'),
    'Only the person doing it, the owner or the meeting host can close it');
  perform app.require(a.status = 'open', 'This action is already closed');
  perform app.require(p_reason in ('declined', 'on_hold', 'not_needed', 'out_of_scope', 'waiting', 'other'), 'Choose the reason');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Explain why it will not be done');
  perform set_config('app.workflow', '1', true);
  update public.sales_meeting_actions set status = 'not_done', nd_reason = p_reason, nd_note = btrim(p_note), nd_at = now(), nd_by = auth.uid(),
    nd_accepted_at = null, nd_accepted_by = null where id = a.id;
  perform app.notify_many(array_remove(app.action_people(a) || app.role_users('sm_projects'), auth.uid()), 'meeting_action', 'Meeting action not done – review it',
    format('%s · %s · %s: %s', app.display_name(auth.uid()), app.action_subject(a), app.nd_reason_label(p_reason), btrim(p_note)),
    'normal', 'sales_meeting', a.meeting_id, '/meeting/review/' || a.meeting_id, null, true);
end $$;
revoke execute on function public.meeting_action_not_done(uuid, text, text) from public, anon;
grant execute on function public.meeting_action_not_done(uuid, text, text) to authenticated;

-- SM Projects / the host: accept it, or reopen it with a new due date
create or replace function public.meeting_action_not_done_decide(p_id uuid, p_accept boolean, p_due date default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions;
begin
  select * into a from public.sales_meeting_actions where id = p_id for update;
  perform app.require(a.id is not null, 'Action not found');
  perform app.require(app.can_decide_not_done(a), 'SM Projects or the meeting host reviews it');
  perform app.require(a.status = 'not_done', 'This action is not closed as not done');
  perform set_config('app.workflow', '1', true);
  if p_accept then
    perform app.require(a.nd_accepted_at is null, 'Already accepted');
    update public.sales_meeting_actions set nd_accepted_at = now(), nd_accepted_by = auth.uid() where id = a.id;
    perform app.notify_many(array_remove(array[coalesce(a.assignee_id, a.owner_id)], auth.uid()), 'meeting_action', 'Not done – accepted',
      app.action_subject(a), 'normal', 'sales_meeting', a.meeting_id, '/meetings', null, true);
  else
    perform app.require(p_due is not null and p_due >= (now() at time zone app.tz())::date, 'Set a new due date (today or later)');
    perform app.require(coalesce(btrim(p_note), '') <> '', 'Say why it is reopened');
    update public.sales_meeting_actions set status = 'open', due_date = p_due, nd_accepted_at = null, nd_accepted_by = null where id = a.id;
    insert into public.meeting_action_reviews (action_id, state, note, old_due, new_due)
    values (a.id, 'delayed', format('Reopened – %s (closed as not done: %s)', btrim(p_note), app.nd_reason_label(a.nd_reason)), a.due_date, p_due);
    perform app.notify_many(array_remove(array[coalesce(a.assignee_id, a.owner_id), a.sales_person_id], auth.uid()), 'meeting_action', 'Meeting action reopened',
      format('%s · new date %s · %s', app.action_subject(a), to_char(p_due, 'DD Mon'), btrim(p_note)), 'critical', 'sales_meeting', a.meeting_id, '/meetings', null, true);
    if a.kind = 'visit' then perform app.place_meeting_visits(a.owner_id); end if;
  end if;
end $$;
revoke execute on function public.meeting_action_not_done_decide(uuid, boolean, date, text) from public, anon;
grant execute on function public.meeting_action_not_done_decide(uuid, boolean, date, text) to authenticated;

-- The overdue alert fires again when a moved due date passes
do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.meeting_action_tick(timestamptz)'::regprocedure);
  before := def;
  def := replace(def, $k$format('meetdue:%s', a.id)$k$, $k$format('meetdue:%s:%s', a.id, a.due_date)$k$);
  perform app.require(def <> before, 'meeting_action_tick: overdue key not found');
  execute def;
end $$;

-- My actions: also the ones I was asked to help with (part 'help'), with the helper and the moved date
drop function if exists public.my_meeting_actions();
create function public.my_meeting_actions() returns table (id uuid, action text, due_date date, meeting_date date, status text,
  project text, customer text, project_id uuid, kind text, my_part text, owner text, assignee text, assignee_id uuid, sales_person text,
  objective text, plan_id uuid, planned_date date, time_slot text, line_status text, assign_by timestamptz, meeting_id uuid,
  review_state text, review_note text, review_at timestamptz, review_due timestamptz, reviewed boolean,
  review_by text, helper text, old_due date)
language sql stable security definer set search_path = public as $$
  select a.id, a.action, a.due_date, m.meeting_date, a.status,
         coalesce(p.name, a.new_project), coalesce(o.name, a.new_customer), a.project_id, a.kind,
         case when a.assignee_id = auth.uid() then 'do'
              when a.owner_id <> auth.uid() then 'help'
              when a.kind = 'visit' then 'visit'
              when a.kind in ('design', 'estimation', 'execution') and a.assignee_id is null then 'assign'
              when a.kind in ('design', 'estimation', 'execution') then 'track'
              else 'do' end,
         app.display_name(a.owner_id), app.display_name(a.assignee_id), a.assignee_id, app.display_name(a.sales_person_id),
         a.objective, l.plan_id, l.planned_date, l.time_slot, l.status,
         m.published_at + make_interval(hours => app.setting_num('meeting_assign_hours', 24)::int), m.id,
         r.state, r.note, r.created_at, app.next_meeting_starts(m), coalesce(r.created_at >= m.published_at, false),
         app.display_name(r.by_id), app.display_name(r.helper_id), r.old_due
    from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
    left join public.projects p on p.id = a.project_id
    left join public.organizations o on o.id = a.organization_id
    left join lateral (select x.plan_id, x.planned_date, x.time_slot, x.status from public.visit_plan_lines x
                        where x.meeting_action_id = a.id order by (x.status = 'planned') desc, x.created_at desc limit 1) l on true
    left join lateral (select y.state, y.note, y.created_at, y.by_id, y.helper_id, y.old_due from public.meeting_action_reviews y
                        where y.action_id = a.id order by y.created_at desc limit 1) r on true
   where (a.owner_id = auth.uid() or a.assignee_id = auth.uid() or (r.state = 'blocked' and r.helper_id = auth.uid()))
     and m.status = 'published' and a.status = 'open'
   order by a.due_date nulls last, m.meeting_date
$$;
revoke execute on function public.my_meeting_actions() from public, anon;
grant execute on function public.my_meeting_actions() to authenticated;

-- The status review of a meeting: not-done fields and the helper / moved date of the latest update
create or replace function public.meeting_status_review(p_meeting uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'meeting', jsonb_build_object('id', m.id, 'team', m.team, 'meeting_date', m.meeting_date, 'published_at', m.published_at,
                                  'title', app.meeting_label(m.team)),
    'next_starts', app.next_meeting_starts(m),
    'can_decide', app.has_role('sm_projects', 'gm') or app.is_meeting_host(m.team),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'action', a.action, 'kind', a.kind, 'status', a.status, 'due_date', a.due_date,
               'owner', app.display_name(a.owner_id), 'assignee', app.display_name(a.assignee_id),
               'doer', app.display_name(app.action_doer(a)), 'sales_person', app.display_name(a.sales_person_id),
               'project', coalesce(p.name, a.new_project), 'customer', coalesce(o.name, a.new_customer),
               'done_at', a.done_at, 'done_note', a.done_note, 'unappointed', a.kind in ('design', 'estimation', 'execution') and a.assignee_id is null,
               'nd_reason', a.nd_reason, 'nd_note', a.nd_note, 'nd_at', a.nd_at, 'nd_by', app.display_name(a.nd_by),
               'nd_accepted_at', a.nd_accepted_at, 'nd_accepted_by', app.display_name(a.nd_accepted_by),
               'visit', (select jsonb_build_object('date', l.planned_date, 'status', l.status) from public.visit_plan_lines l
                          where l.meeting_action_id = a.id order by (l.status = 'planned') desc, l.created_at desc limit 1),
               'last', (select jsonb_build_object('state', r.state, 'note', r.note, 'by', app.display_name(r.by_id), 'at', r.created_at,
                                                  'old_due', r.old_due, 'new_due', r.new_due, 'helper', app.display_name(r.helper_id))
                          from public.meeting_action_reviews r where r.action_id = a.id order by r.created_at desc limit 1),
               'updated', a.status <> 'open' or exists (select 1 from public.meeting_action_reviews r where r.action_id = a.id and r.created_at >= m.published_at))
             order by (a.status <> 'open'), a.due_date nulls last, a.created_at)
        from public.sales_meeting_actions a
        left join public.projects p on p.id = a.project_id
        left join public.organizations o on o.id = a.organization_id
       where a.meeting_id = m.id), '[]'::jsonb))
    from public.sales_meetings m
   where m.id = p_meeting and m.status = 'published'
$$;
revoke execute on function public.meeting_status_review(uuid) from public, anon;
grant execute on function public.meeting_status_review(uuid) to authenticated;

-- Report: actions of meetings in the period, per person doing them (GM / SM Projects all teams; a host their own team)
create or replace function public.meeting_actions_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare all_teams boolean := app.has_role('gm', 'sm_projects'); today date := (now() at time zone app.tz())::date;
begin
  perform app.require(all_teams or app.has_role('sm_estimation', 'design_manager', 'senior_elec_engineer'), 'Meeting action reports are for the DGM, SM Projects and the meeting hosts');
  return coalesce((
    select jsonb_agg(x order by x ->> 'name') from (
      select jsonb_build_object(
               'id', d.doer, 'name', app.display_name(d.doer),
               'total', count(*),
               'done', count(*) filter (where d.status = 'done'),
               'not_done', count(*) filter (where d.status = 'not_done'),
               'not_done_open', count(*) filter (where d.status = 'not_done' and d.nd_accepted_at is null),
               'delayed', count(*) filter (where d.status = 'open' and d.last_state = 'delayed'),
               'blocked', count(*) filter (where d.status = 'open' and d.last_state = 'blocked'),
               'overdue', count(*) filter (where d.status = 'open' and d.due_date < today),
               'moved', count(*) filter (where d.moved),
               'top_reason', (select app.nd_reason_label(z.nd_reason) from (select d2.nd_reason, count(*) c from unnest(array_agg(d.nd_reason)) as d2(nd_reason)
                                where d2.nd_reason is not null group by d2.nd_reason order by c desc, d2.nd_reason limit 1) z)) x
        from (select coalesce(a.assignee_id, a.owner_id) doer, a.status, a.due_date, a.nd_reason, a.nd_accepted_at,
                     (select r.state from public.meeting_action_reviews r where r.action_id = a.id order by r.created_at desc limit 1) last_state,
                     exists (select 1 from public.meeting_action_reviews r where r.action_id = a.id and r.new_due is not null) moved
                from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
               where m.status = 'published' and m.meeting_date between p_from and p_to
                 and (all_teams or app.is_meeting_host(m.team))) d
       group by d.doer) s(x)), '[]'::jsonb);
end $$;
revoke execute on function public.meeting_actions_report(date, date) from public, anon;
grant execute on function public.meeting_actions_report(date, date) to authenticated;

select app.fix_function_owners();
