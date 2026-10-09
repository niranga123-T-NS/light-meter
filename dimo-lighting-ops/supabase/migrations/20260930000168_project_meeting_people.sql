-- Project meetings: actions go only to the project's people – its SEE, the project team (AEs, trainees, subcontractor
-- supervisors) and the meeting's invitees; no one from outside. Only tasks and project execution tasks.

create or replace function app.project_meeting_people(p_meeting uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array(
    select e.see_id from public.sales_meetings m join public.exec_projects e on e.id = m.exec_project_id where m.id = p_meeting and e.see_id is not null
    union select m.initiated_by from public.sales_meetings m where m.id = p_meeting and m.initiated_by is not null
    union select x.user_id from public.sales_meetings m join public.exec_members x on x.exec_project_id = m.exec_project_id and x.active where m.id = p_meeting
    union select i.person_id from public.sales_meeting_invitees i where i.meeting_id = p_meeting and i.status <> 'pending_approval')
$$;

create or replace function public.add_meeting_action(p_meeting uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m public.sales_meetings := app.meeting_for_edit(p_meeting);
  aid uuid; owner uuid; pid uuid; oid uuid; uid uuid;
  k text := coalesce(nullif(p_data ->> 'kind', ''), 'task');
  obj text := nullif(btrim(p_data ->> 'objective'), '');
  orole public.app_role;
begin
  perform app.require(k in ('task', 'visit', 'design', 'estimation', 'execution'), 'Unknown action type');
  owner := nullif(p_data ->> 'owner_id', '')::uuid;
  if owner is null and k in ('task', 'visit') then owner := nullif(p_data ->> 'sales_person_id', '')::uuid; end if;
  pid := nullif(p_data ->> 'project_id', '')::uuid;
  oid := nullif(p_data ->> 'organization_id', '')::uuid;
  uid := nullif(p_data ->> 'unit_id', '')::uuid;
  if owner is null and k in ('design', 'estimation', 'execution') then
    select id into owner from public.profiles where role = any (app.action_managers(k)) and active order by role, full_name limit 1;
  end if;
  perform app.require(coalesce(btrim(p_data ->> 'action'), '') <> '', 'Enter the action');
  select role into orole from public.profiles where id = owner and active;
  perform app.require(orole is not null and orole not in ('gm', 'sys_admin'), 'Choose who does it');
  if m.team = 'project' then
    perform app.require(k in ('task', 'execution'), 'A project meeting gives tasks and project execution tasks');
    perform app.require(owner = any (app.project_meeting_people(m.id)), 'Choose someone on this project or invited to the meeting');
  end if;
  perform app.require(pid is null or exists (select 1 from public.projects where id = pid), 'Project not found');
  perform app.require(oid is null or exists (select 1 from public.organizations where id = oid), 'Customer not found');
  if pid is not null and oid is null then select organization_id into oid from public.projects where id = pid; end if;
  if uid is not null and oid is null then select organization_id into oid from public.org_units where id = uid; end if;
  perform app.require(uid is null or exists (select 1 from public.org_units where id = uid and organization_id = oid),
    'The unit / department belongs to another customer');
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
    new_customer, kind, objective, unit_id)
  values (m.id, nullif(p_data ->> 'sales_person_id', '')::uuid, owner, btrim(p_data ->> 'action'), nullif(p_data ->> 'due_date', '')::date,
    pid, oid, case when pid is null and k <> 'visit' then nullif(btrim(p_data ->> 'new_project'), '') end,
    case when oid is null and k <> 'visit' then nullif(btrim(p_data ->> 'new_customer'), '') end,
    k, case when k = 'visit' then obj end, uid)
  returning id into aid;
  return aid;
end $$;

-- Who the manager can appoint: the team for the task type – or, for a project meeting, the project's people
create or replace function public.meeting_action_team(p_id uuid) returns table (id uuid, full_name text, role public.app_role)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.full_name, pr.role from public.profiles pr, public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
   where a.id = p_id and pr.active
     and (a.owner_id = auth.uid() or app.has_role('sm_projects') or (m.team = 'project' and app.is_meeting_host(m.team)))
     and case when m.team = 'project' then pr.id = any (app.project_meeting_people(m.id)) and pr.role not in ('gm', 'sys_admin')
              else pr.role = any (app.action_members(a.kind)) end
   order by pr.full_name
$$;

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
  if (select team from public.sales_meetings where id = a.meeting_id) = 'project' then
    perform app.require(p_person = any (app.project_meeting_people(a.meeting_id)), 'Choose someone on this project or invited to the meeting');
  else
    perform app.require(prole = any (app.action_members(a.kind)), 'Choose a person from the team');
  end if;
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
