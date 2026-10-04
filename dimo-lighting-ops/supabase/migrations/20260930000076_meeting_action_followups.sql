-- Sales meeting actions, followed through
--  * System Admin is not invited to the sales meeting.
--  * Action types: task (anyone), customer / project visit (a sales person), design / estimation / project execution task
--    (to the team manager, who appoints the person: Design Manager → designer; SM / AM Estimation → estimator;
--    Senior Electrical Engineer → assistant engineer). Not appointed within meeting_assign_hours (24) → GM / DGM and SM Projects.
--  * Follow-up visits go into the sales person's weekly plan by themselves; customer, project and objective are fixed, only the
--    day and time change. The visit follows the normal check-in / check-out rules; checking out marks the action done.
--  * Every other action: the person doing it confirms it is done (with what was done). Every step notifies everyone concerned
--    (the doer, the manager, the sales person whose project it is, SM Projects) as a pinned popup notification.
--  * Hourly: appointment delays, overdue actions, follow-up visits not yet planned.

-- ---------------------------------------------------------------------------
-- Action types and the people who carry them out
-- ---------------------------------------------------------------------------
alter table public.sales_meeting_actions
  add column if not exists kind text not null default 'task' check (kind in ('task', 'visit', 'design', 'estimation', 'execution')),
  add column if not exists objective text,                                   -- visit objective (visit follow-ups)
  add column if not exists assignee_id uuid references public.profiles (id), -- the designer / estimator / engineer appointed
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid references public.profiles (id),
  add column if not exists done_note text,
  add column if not exists visit_id uuid references public.visits (id);
create index if not exists sales_meeting_actions_owner on public.sales_meeting_actions (owner_id, status);
create index if not exists sales_meeting_actions_assignee on public.sales_meeting_actions (assignee_id, status) where assignee_id is not null;

alter table public.visit_plan_lines add column if not exists meeting_action_id uuid references public.sales_meeting_actions (id) on delete set null;
create index if not exists visit_plan_lines_meeting_action on public.visit_plan_lines (meeting_action_id) where meeting_action_id is not null;

create policy sales_meeting_actions_assignee_read on public.sales_meeting_actions for select to authenticated
  using (assignee_id = auth.uid() and app.meeting_published(meeting_id));

create or replace function app.action_kind_label(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'visit' then 'Customer / project visit' when 'design' then 'Design task' when 'estimation' then 'Estimation task'
                     when 'execution' then 'Project execution task' else 'Task' end
$$;

-- Who appoints (managers) and who can be appointed (members) for team tasks
create or replace function app.action_managers(p_kind text) returns public.app_role[] language sql immutable as $$
  select case p_kind when 'design' then array['design_manager']::public.app_role[]
                     when 'estimation' then array['sm_estimation', 'am_estimation']::public.app_role[]
                     when 'execution' then array['senior_elec_engineer']::public.app_role[] end
$$;
create or replace function app.action_members(p_kind text) returns public.app_role[] language sql immutable as $$
  select case p_kind when 'design' then array['design_manager', 'lighting_designer', 'lighting_engineer']::public.app_role[]
                     when 'estimation' then array['sm_estimation', 'am_estimation', 'estimation_exec']::public.app_role[]
                     when 'execution' then array['senior_elec_engineer', 'assistant_engineer']::public.app_role[] end
$$;

create or replace function app.action_subject(a public.sales_meeting_actions) returns text
language sql stable security definer set search_path = public as $$
  select concat_ws(' · ', a.action, coalesce((select name from public.projects where id = a.project_id), a.new_project),
                   coalesce((select name from public.organizations where id = a.organization_id), a.new_customer))
$$;

-- Everyone concerned with an action: the doer(s), the sales person whose part it is, SM Projects
create or replace function app.action_people(a public.sales_meeting_actions) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[a.owner_id, a.assignee_id, a.sales_person_id], null) || app.role_users('sm_projects')
$$;

-- ---------------------------------------------------------------------------
-- Adding an action (draft meeting)
-- p_data: {kind, sales_person_id, owner_id, action, due_date, project_id, organization_id, new_project, new_customer, objective}
-- ---------------------------------------------------------------------------
create or replace function public.add_meeting_action(p_meeting uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m public.sales_meetings := app.meeting_for_edit(p_meeting);
  aid uuid; owner uuid; pid uuid; oid uuid;
  k text := coalesce(nullif(p_data ->> 'kind', ''), 'task');
  obj text := nullif(btrim(p_data ->> 'objective'), '');
  orole public.app_role;
begin
  perform app.require(k in ('task', 'visit', 'design', 'estimation', 'execution'), 'Unknown action type');
  owner := nullif(p_data ->> 'owner_id', '')::uuid;
  if owner is null and k in ('task', 'visit') then owner := nullif(p_data ->> 'sales_person_id', '')::uuid; end if;
  pid := nullif(p_data ->> 'project_id', '')::uuid;
  oid := nullif(p_data ->> 'organization_id', '')::uuid;
  if owner is null and k in ('design', 'estimation', 'execution') then
    select id into owner from public.profiles where role = any (app.action_managers(k)) and active order by role, full_name limit 1;
  end if;
  perform app.require(coalesce(btrim(p_data ->> 'action'), '') <> '', 'Enter the action');
  select role into orole from public.profiles where id = owner and active;
  perform app.require(orole is not null and orole not in ('gm', 'sys_admin'), 'Choose who does it');
  perform app.require(pid is null or exists (select 1 from public.projects where id = pid), 'Project not found');
  perform app.require(oid is null or exists (select 1 from public.organizations where id = oid), 'Customer not found');
  if pid is not null and oid is null then select organization_id into oid from public.projects where id = pid; end if;
  if k = 'visit' then
    perform app.require(orole in ('asm_building', 'asm_infra'), 'A follow-up visit is given to a sales person');
    perform app.require(oid is not null, 'Choose the customer (and project) to visit from the lists – a new customer is added in Customers first');
    perform app.require(obj is not null and exists (select 1 from public.master_lists where list_name = 'visit_objective' and value = obj),
      'Choose the visit objective');
    perform app.require(pid is not null or exists (select 1 from public.master_lists where list_name = 'visit_objective' and value = obj and 'networking' = any (tags)),
      'Choose the project – only networking visits can be made without one');
    perform app.require(nullif(p_data ->> 'due_date', '') is not null, 'Enter the date the visit is due by');
  elsif k in ('design', 'estimation', 'execution') then
    perform app.require(orole = any (app.action_managers(k)),
      format('A %s goes to its manager (%s), who appoints the person', lower(app.action_kind_label(k)),
        case k when 'design' then 'Design Manager' when 'estimation' then 'SM / AM Estimation' else 'Senior Electrical Engineer' end));
  end if;
  insert into public.sales_meeting_actions (meeting_id, sales_person_id, owner_id, action, due_date, project_id, organization_id, new_project,
    new_customer, kind, objective)
  values (m.id, nullif(p_data ->> 'sales_person_id', '')::uuid, owner, btrim(p_data ->> 'action'), nullif(p_data ->> 'due_date', '')::date,
    pid, oid, case when pid is null and k <> 'visit' then nullif(btrim(p_data ->> 'new_project'), '') end,
    case when oid is null and k <> 'visit' then nullif(btrim(p_data ->> 'new_customer'), '') end,
    k, case when k = 'visit' then obj end)
  returning id into aid;
  return aid;
end $$;

-- ---------------------------------------------------------------------------
-- Follow-up visits go into the sales person's weekly plan by themselves: on the due date (or today if it has passed)
-- in that week's plan; if the plan doesn't exist yet, as soon as it is created. Only the day and time can change.
-- ---------------------------------------------------------------------------
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
                                and e.meeting_date = d and e.status = 'approved') then '12:00' end,
           a.project_id, a.organization_id, o.visit_category, a.objective, a.id, pr.lat, pr.lng,
           'Follow-up from the sales meeting: ' || a.action
      from public.organizations o left join public.projects pr on pr.id = a.project_id
     where o.id = a.organization_id;
    n := n + 1;
    perform app.notify(p_person, 'meeting_action', 'Follow-up visit added to your plan',
      format('%s – %s. Set the day and time in the week of %s', app.action_subject(a), to_char(d, 'Dy DD Mon'), to_char(pl.week_start, 'DD Mon')),
      'normal', 'visit_plan', pl.id, '/plan/' || pl.id, format('meetvisit:%s:%s', a.id, pl.id), true);
  end loop;
  return n;
end $$;

create or replace function app.visit_plan_place_meeting_visits() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.place_meeting_visits(new.sales_person_id);
  return new;
end $$;
drop trigger if exists visit_plan_place_meeting_visits on public.visit_plans;
create trigger visit_plan_place_meeting_visits after insert on public.visit_plans
  for each row execute function app.visit_plan_place_meeting_visits();

-- Sales person adds an unplaced follow-up visit to a plan (day and time only)
create or replace function public.plan_meeting_visit(p_action uuid, p_plan uuid, p_date date, p_time text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions; pl public.visit_plans; lid uuid;
begin
  select * into a from public.sales_meeting_actions where id = p_action;
  select * into pl from public.visit_plans where id = p_plan;
  perform app.require(a.id is not null and a.kind = 'visit' and a.status = 'open', 'Follow-up visit not found');
  perform app.require(pl.id is not null and pl.sales_person_id = a.owner_id, 'This is not the plan of the sales person who makes the visit');
  perform app.require(auth.uid() = a.owner_id or app.has_role('sm_projects'), 'Only the sales person plans this visit');
  perform app.require(p_date between pl.week_start and pl.week_start + 5, 'Choose a day in this week (Monday – Saturday)');
  perform app.require(not exists (select 1 from public.visit_plan_lines where meeting_action_id = a.id and status = 'planned'), 'This visit is already planned');
  insert into public.visit_plan_lines (plan_id, planned_date, time_slot, project_id, organization_id, visit_category, planned_objective, meeting_action_id,
    lat, lng, change_reason)
  select pl.id, p_date, nullif(btrim(p_time), ''), a.project_id, a.organization_id, o.visit_category, a.objective, a.id, pr.lat, pr.lng,
         'Follow-up from the sales meeting: ' || a.action
    from public.organizations o left join public.projects pr on pr.id = a.project_id where o.id = a.organization_id
  returning id into lid;
  return lid;
end $$;

-- Follow-up visit lines: what, where and with whom are fixed; the sales person only sets the day and time
create or replace function app.meeting_visit_line_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions; sp uuid;
begin
  if tg_op = 'INSERT' then
    if new.meeting_action_id is null then return new; end if;
    select * into a from public.sales_meeting_actions where id = new.meeting_action_id;
    select sales_person_id into sp from public.visit_plans where id = new.plan_id;
    perform app.require(a.id is not null and a.kind = 'visit' and a.owner_id = sp, 'This sales meeting follow-up belongs to another sales person');
    perform app.require((new.project_id, new.organization_id, new.planned_objective) is not distinct from (a.project_id, a.organization_id, a.objective),
      'A follow-up visit from the sales meeting keeps its customer, project and objective');
    return new;
  end if;
  if old.meeting_action_id is null or auth.uid() is null or app.has_role('sm_projects') or current_setting('app.workflow', true) = '1' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'This visit is a follow-up from the sales meeting – it cannot be removed. Change the day or time instead';
  end if;
  if (new.project_id, new.organization_id, new.planned_objective, new.visit_category, new.visit_type, new.meeting_action_id, new.plan_id)
     is distinct from (old.project_id, old.organization_id, old.planned_objective, old.visit_category, old.visit_type, old.meeting_action_id, old.plan_id) then
    raise exception 'This visit is a follow-up from the sales meeting – only the day and time can be changed';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    raise exception 'A follow-up visit from the sales meeting cannot be cancelled – reschedule it, or ask SM Projects';
  end if;
  return new;
end $$;
drop trigger if exists meeting_visit_line_guard on public.visit_plan_lines;
create trigger meeting_visit_line_guard before insert or update or delete on public.visit_plan_lines
  for each row execute function app.meeting_visit_line_guard();

-- The follow-up is done when its visit is checked out (closed) – the normal check-in / check-out rules apply
create or replace function app.visit_closes_meeting_action() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions;
begin
  if new.status <> 'closed' or (tg_op = 'UPDATE' and old.status = 'closed') or new.plan_line_id is null then return new; end if;
  select x.* into a from public.sales_meeting_actions x join public.visit_plan_lines l on l.meeting_action_id = x.id
   where l.id = new.plan_line_id and x.status = 'open';
  if a.id is null then return new; end if;
  update public.sales_meeting_actions set status = 'done', done_at = now(), done_by = new.sales_person_id, visit_id = new.id,
    done_note = left(coalesce(new.outcome || ': ', '') || coalesce(new.summary, ''), 500)
   where id = a.id;
  perform app.notify_many(array_remove(app.action_people(a), new.sales_person_id), 'meeting_action', 'Sales meeting follow-up visit done',
    format('%s · %s · %s', app.display_name(new.sales_person_id), app.action_subject(a), coalesce(new.outcome, '')),
    'normal', 'visit', new.id, '/visits/' || new.id, null, true);
  return new;
end $$;
drop trigger if exists visit_closes_meeting_action on public.visits;
create trigger visit_closes_meeting_action after insert or update on public.visits
  for each row execute function app.visit_closes_meeting_action();

-- ---------------------------------------------------------------------------
-- Team tasks: the manager appoints the person; the person confirms the task is done
-- ---------------------------------------------------------------------------
create or replace function public.assign_meeting_action(p_id uuid, p_person uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions; prole public.app_role; prev uuid;
begin
  select * into a from public.sales_meeting_actions where id = p_id for update;
  perform app.require(a.id is not null and app.meeting_published(a.meeting_id), 'Action not found');
  perform app.require(a.kind in ('design', 'estimation', 'execution'), 'Only design, estimation and execution tasks are assigned');
  perform app.require(a.status = 'open', 'This action is done');
  perform app.require(auth.uid() = a.owner_id or app.has_role('sm_projects'), 'Only the manager it was given to appoints the person');
  select role into prole from public.profiles where id = p_person and active;
  perform app.require(prole = any (app.action_members(a.kind)), 'Choose a person from the team');
  prev := a.assignee_id;
  update public.sales_meeting_actions set assignee_id = p_person, assigned_at = now(), assigned_by = auth.uid(),
    done_note = coalesce(done_note, nullif(btrim(p_note), '')) where id = a.id returning * into a;
  perform app.notify(p_person, 'meeting_action', 'Task from the sales meeting – ' || lower(app.action_kind_label(a.kind)),
    format('%s%s · appointed by %s%s', app.action_subject(a), coalesce(' · due ' || to_char(a.due_date, 'DD Mon'), ''), app.display_name(auth.uid()),
      coalesce(' · ' || nullif(btrim(p_note), ''), '')),
    'normal', 'sales_meeting', a.meeting_id, '/meetings', null, true);
  if prev is not null and prev <> p_person then
    perform app.notify(prev, 'meeting_action', 'Sales meeting task reassigned', app.action_subject(a) || ' · now with ' || app.display_name(p_person),
      'normal', 'sales_meeting', a.meeting_id, '/meetings');
  end if;
  perform app.notify_many(array_remove(array_remove(app.action_people(a), p_person), auth.uid()), 'meeting_action',
    format('%s appointed – %s', app.action_kind_label(a.kind), app.display_name(p_person)),
    app.action_subject(a) || ' · by ' || app.display_name(auth.uid()), 'normal', 'sales_meeting', a.meeting_id, '/meetings', null, true);
end $$;

create or replace function public.complete_meeting_action(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions;
begin
  select * into a from public.sales_meeting_actions where id = p_id for update;
  perform app.require(a.id is not null and app.meeting_published(a.meeting_id), 'Action not found');
  perform app.require(a.status = 'open', 'Already confirmed as done');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Say what was done');
  if not app.has_role('sm_projects') then
    perform app.require(a.kind <> 'visit', 'A follow-up visit is done when you check out of the visit from your plan');
    perform app.require(case when a.kind in ('design', 'estimation', 'execution') then auth.uid() = coalesce(a.assignee_id, a.owner_id) and a.assignee_id is not null
                             else auth.uid() = a.owner_id end,
      case when a.kind in ('design', 'estimation', 'execution') and a.assignee_id is null then 'Appoint the person first – they confirm when it is done'
           else 'Only the person doing it confirms' end);
  end if;
  update public.sales_meeting_actions set status = 'done', done_at = now(), done_by = auth.uid(), done_note = btrim(p_note) where id = a.id;
  perform app.notify_many(array_remove(app.action_people(a), auth.uid()), 'meeting_action', 'Sales meeting action done',
    format('%s · %s · %s', app.display_name(auth.uid()), app.action_subject(a), btrim(p_note)), 'normal', 'sales_meeting', a.meeting_id,
    '/meetings', null, true);
end $$;

-- SM Projects can reopen (or close) any action
create or replace function public.set_meeting_action_done(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions;
begin
  if p_done then perform public.complete_meeting_action(p_id, 'Confirmed by SM Projects'); return; end if;
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects reopens an action');
  update public.sales_meeting_actions set status = 'open', done_at = null, done_by = null where id = p_id returning * into a;
  perform app.require(a.id is not null, 'Not found');
  perform app.notify_many(array_remove(array[coalesce(a.assignee_id, a.owner_id)], null), 'meeting_action', 'Sales meeting action reopened',
    app.action_subject(a), 'normal', 'sales_meeting', a.meeting_id, '/meetings', null, true);
  if a.kind = 'visit' then perform app.place_meeting_visits(a.owner_id); end if;
end $$;

-- ---------------------------------------------------------------------------
-- Publish: GM / DGM get the pack; every action goes to its people (popups); follow-up visits go into the plans
-- ---------------------------------------------------------------------------
create or replace function public.publish_sales_meeting(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_id); a public.sales_meeting_actions; p uuid;
begin
  perform app.require(m.pack is not null, 'Generate the meeting pack first');
  update public.sales_meetings set status = 'published', published_at = now(), published_by = auth.uid() where id = m.id;
  perform app.notify_many(app.role_users('gm'), 'sales_meeting', 'Sales meeting pack – ' || to_char(m.meeting_date, 'DD Mon YYYY'),
    format('%s actions · published by %s', (select count(*) from public.sales_meeting_actions where meeting_id = m.id), app.display_name(auth.uid())),
    'normal', 'sales_meeting', m.id, '/meeting/' || m.id);
  for a in select * from public.sales_meeting_actions where meeting_id = m.id and status = 'open' order by created_at loop
    if a.kind in ('design', 'estimation', 'execution') then
      perform app.notify(a.owner_id, 'meeting_action', 'Appoint a person – ' || lower(app.action_kind_label(a.kind)) || ' from the sales meeting',
        format('%s%s. Appoint within %s hours (GM / DGM and SM Projects are told if not)', app.action_subject(a),
          coalesce(' · due ' || to_char(a.due_date, 'DD Mon'), ''), app.setting_num('meeting_assign_hours', 24)),
        'normal', 'sales_meeting', m.id, '/meetings', null, true);
    elsif a.kind = 'task' and a.owner_id <> auth.uid() then
      perform app.notify(a.owner_id, 'meeting_action', 'Action from the sales meeting',
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
    perform app.notify(p, 'meeting_action', 'Follow-up visit(s) from the sales meeting',
      (select string_agg(app.action_subject(x) || ' · by ' || to_char(x.due_date, 'DD Mon'), E'\n')
         from public.sales_meeting_actions x where x.meeting_id = m.id and x.kind = 'visit' and x.owner_id = p
          and not exists (select 1 from public.visit_plan_lines l where l.meeting_action_id = x.id))
        || E'\nThey are added to your weekly plan when you create it – you set the day and time.',
      'normal', 'sales_meeting', m.id, '/meetings', format('meetvisitwait:%s:%s', m.id, p), true)
     where exists (select 1 from public.sales_meeting_actions x where x.meeting_id = m.id and x.kind = 'visit' and x.owner_id = p
                    and not exists (select 1 from public.visit_plan_lines l where l.meeting_action_id = x.id));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- My Day / Internal meetings: every follow-up I do, appoint or track
-- ---------------------------------------------------------------------------
drop function if exists public.my_meeting_actions();
create or replace function public.my_meeting_actions() returns table (id uuid, action text, due_date date, meeting_date date, status text,
  project text, customer text, project_id uuid, kind text, my_part text, owner text, assignee text, assignee_id uuid, sales_person text,
  objective text, plan_id uuid, planned_date date, time_slot text, line_status text, assign_by timestamptz, meeting_id uuid)
language sql stable security definer set search_path = public as $$
  select a.id, a.action, a.due_date, m.meeting_date, a.status,
         coalesce(p.name, a.new_project), coalesce(o.name, a.new_customer), a.project_id, a.kind,
         case when a.assignee_id = auth.uid() then 'do'
              when a.kind = 'visit' then 'visit'
              when a.kind in ('design', 'estimation', 'execution') and a.assignee_id is null then 'assign'
              when a.kind in ('design', 'estimation', 'execution') then 'track'
              else 'do' end,
         app.display_name(a.owner_id), app.display_name(a.assignee_id), a.assignee_id, app.display_name(a.sales_person_id),
         a.objective, l.plan_id, l.planned_date, l.time_slot, l.status,
         m.published_at + make_interval(hours => app.setting_num('meeting_assign_hours', 24)::int), m.id
    from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
    left join public.projects p on p.id = a.project_id
    left join public.organizations o on o.id = a.organization_id
    left join lateral (select x.plan_id, x.planned_date, x.time_slot, x.status from public.visit_plan_lines x
                        where x.meeting_action_id = a.id order by (x.status = 'planned') desc, x.created_at desc limit 1) l on true
   where (a.owner_id = auth.uid() or a.assignee_id = auth.uid()) and m.status = 'published' and a.status = 'open'
   order by a.due_date nulls last, m.meeting_date
$$;
revoke execute on function public.my_meeting_actions() from public, anon;
grant execute on function public.my_meeting_actions() to authenticated;

-- Team list for the manager appointing the person
create or replace function public.meeting_action_team(p_id uuid) returns table (id uuid, full_name text, role public.app_role)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.full_name, pr.role from public.profiles pr, public.sales_meeting_actions a
   where a.id = p_id and pr.active and pr.role = any (app.action_members(a.kind))
     and (a.owner_id = auth.uid() or app.has_role('sm_projects'))
   order by pr.full_name
$$;

-- ---------------------------------------------------------------------------
-- Hourly: appointment delays → GM / DGM and SM Projects; overdue actions; follow-up visits not yet planned
-- ---------------------------------------------------------------------------
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
    perform app.notify_many(app.role_users('gm', 'sm_projects') || a.owner_id, 'meeting_action',
      format('Not appointed – %s from the sales meeting', lower(app.action_kind_label(a.kind))),
      format('%s has not appointed a person in %s hours: %s', app.display_name(a.owner_id), hrs,
        app.action_subject(a)),
      'critical', 'sales_meeting', a.meeting_id, '/meeting/' || a.meeting_id, format('meetassign:%s', a.id), true);
    n := n + 1;
  end loop;
  for a in select x.* from public.sales_meeting_actions x join public.sales_meetings m on m.id = x.meeting_id
            where m.status = 'published' and x.status = 'open' and x.due_date < today loop
    perform app.notify_many(array_remove(array[coalesce(a.assignee_id, a.owner_id), a.sales_person_id], null) || app.role_users('sm_projects'),
      'meeting_action', 'Sales meeting action overdue',
      format('%s · due %s · %s', app.action_subject(a), to_char(a.due_date, 'DD Mon'),
        app.display_name(coalesce(a.assignee_id, a.owner_id))),
      'critical', 'sales_meeting', a.meeting_id, '/meetings', format('meetdue:%s', a.id), true);
    n := n + 1;
  end loop;
  for a in select x.* from public.sales_meeting_actions x join public.sales_meetings m on m.id = x.meeting_id
            where m.status = 'published' and x.status = 'open' and x.kind = 'visit' and x.due_date <= today + 2
              and not exists (select 1 from public.visit_plan_lines l where l.meeting_action_id = x.id and l.status in ('planned', 'completed')) loop
    perform app.notify_many(array[a.owner_id] || app.role_users('sm_projects'), 'meeting_action', 'Follow-up visit not planned',
      format('%s · due %s · %s – add it to the weekly plan', app.action_subject(a),
        to_char(a.due_date, 'DD Mon'), app.display_name(a.owner_id)),
      'normal', 'sales_meeting', a.meeting_id, '/meetings', format('meetunplanned:%s', a.id), true);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.meeting_action_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.meeting_action_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('meeting-action-tick', '7 * * * *', 'select public.meeting_action_tick()');
  end if;
end $$;

insert into public.settings (key, value, description)
values ('meeting_assign_hours', '24', 'Hours a manager has to appoint the person for a sales meeting task before GM / DGM and SM Projects are told')
on conflict (key) do nothing;

revoke execute on function public.plan_meeting_visit(uuid, uuid, date, text), public.assign_meeting_action(uuid, uuid, text),
  public.complete_meeting_action(uuid, text), public.meeting_action_team(uuid) from public, anon;
grant execute on function public.plan_meeting_visit(uuid, uuid, date, text), public.assign_meeting_action(uuid, uuid, text),
  public.complete_meeting_action(uuid, text), public.meeting_action_team(uuid) to authenticated, service_role;

-- System Admin is not invited (copied from 20260930000075)
create or replace function public.invite_sales_meeting(p_date date, p_people uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; mid uuid; p uuid; added int := 0;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects runs the sales meeting');
  perform app.require(p_date is not null and extract(isodow from p_date) = 1, 'Choose a Monday');
  perform app.require(now() < app.meeting_start_at(p_date), 'The meeting has started – invitations can no longer change');
  perform app.require(coalesce(cardinality(p_people), 0) > 0, 'Select who is invited');
  perform app.require(not exists (select 1 from public.profiles x where x.id = any (p_people) and (x.role in ('gm', 'sys_admin') or not x.active)),
    'GM / DGM, System Admin and inactive users cannot be invited');
  select * into m from public.sales_meetings where meeting_date = p_date for update;
  perform app.require(m.id is null or m.status = 'draft', 'This meeting is published');
  if m.id is null then
    insert into public.sales_meetings (meeting_date) values (p_date) returning id into mid;
  else
    mid := m.id;
  end if;
  -- Withdrawn invitations
  for p in select person_id from public.sales_meeting_invitees where meeting_id = mid and not (person_id = any (p_people)) loop
    delete from public.sales_meeting_invitees where meeting_id = mid and person_id = p;
    perform app.notify(p, 'meeting_invite', 'Sales meeting invitation withdrawn', format('Monday %s', to_char(p_date, 'DD Mon YYYY')),
      'normal', 'sales_meeting', mid, '/meetings');
  end loop;
  foreach p in array p_people loop
    continue when p = auth.uid();
    insert into public.sales_meeting_invitees (meeting_id, person_id, status)
    values (mid, p, case when exists (select 1 from public.meeting_exceptions e where e.sales_person_id = p and e.meeting_date = p_date and e.status = 'approved')
                         then 'excused' else 'invited' end)
    on conflict (meeting_id, person_id) do nothing;
    if found then
      added := added + 1;
      perform app.notify(p, 'meeting_invite', 'Invited: sales meeting Monday ' || to_char(p_date, 'DD Mon') || ' 08:30 – 12:00',
        'Mark your attendance in Internal meetings when you arrive, or apply for leave before the meeting', 'normal', 'sales_meeting', mid, '/meetings');
    end if;
  end loop;
  update public.sales_meetings set initiated_at = coalesce(initiated_at, now()), initiated_by = coalesce(initiated_by, auth.uid()) where id = mid;
  return mid;
end $$;

-- Tasks waiting to be appointed appear in the manager's approvals (copied from 20260930000075)
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
  select 'meeting_exception', e.id, 'meeting_exception', format('Sales meeting leave – %s – Monday %s', app.display_name(e.sales_person_id),
         to_char(e.meeting_date, 'DD Mon')), e.reason, e.sales_person_id, app.display_name(e.sales_person_id), e.requested_at, null, '/meeting', null
  from public.meeting_exceptions e
  where e.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'meeting_attendance', m.id, 'meeting_attendance', format('Meeting attendance – %s – location differs', app.display_name(i.person_id)),
         case when i.distance_m is null then 'No location' else round(i.distance_m) || ' m from the meeting' end, i.person_id,
         app.display_name(i.person_id), i.checkin_at, null, '/meeting/' || m.id, null
  from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id
  where i.status = 'location_check' and app.has_role('sm_projects')
  union all
  select 'meeting_assign', a.id, 'meeting_assign', format('Assign: %s', a.action),
         concat_ws(' · ', coalesce(p.name, a.new_project), coalesce(o.name, a.new_customer), 'Sales meeting ' || to_char(m.meeting_date, 'DD Mon')),
         m.published_by, app.display_name(m.published_by), m.published_at, null, '/meetings', app.action_kind_label(a.kind)
  from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
  left join public.projects p on p.id = a.project_id left join public.organizations o on o.id = a.organization_id
  where m.status = 'published' and a.status = 'open' and a.kind in ('design', 'estimation', 'execution') and a.assignee_id is null
    and a.owner_id = auth.uid()
  order by 8
$$;
