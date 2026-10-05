-- Meeting actions keep the customer's unit / department (it was shown in the form but not saved);
-- a follow-up visit carries it into the weekly plan.
alter table public.sales_meeting_actions add column if not exists unit_id uuid references public.org_units (id);

-- p_data: {kind, sales_person_id, owner_id, action, due_date, project_id, organization_id, unit_id, new_project, new_customer, objective}
-- (copied from 20260930000076: adds unit_id)
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

-- (copied from 20260930000076: the unit comes from the action and stays fixed)
create or replace function app.meeting_visit_line_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions; sp uuid;
begin
  if tg_op = 'INSERT' then
    if new.meeting_action_id is null then return new; end if;
    select * into a from public.sales_meeting_actions where id = new.meeting_action_id;
    select sales_person_id into sp from public.visit_plans where id = new.plan_id;
    perform app.require(a.id is not null and a.kind = 'visit' and a.owner_id = sp, 'This sales meeting follow-up belongs to another sales person');
    new.unit_id := coalesce(new.unit_id, a.unit_id);
    perform app.require((new.project_id, new.organization_id, new.planned_objective) is not distinct from (a.project_id, a.organization_id, a.objective)
                        and (a.unit_id is null or new.unit_id = a.unit_id),
      'A follow-up visit from the sales meeting keeps its customer, unit, project and objective');
    return new;
  end if;
  if old.meeting_action_id is null or auth.uid() is null or app.has_role('sm_projects') or current_setting('app.workflow', true) = '1' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'This visit is a follow-up from the sales meeting – it cannot be removed. Change the day or time instead';
  end if;
  if (new.project_id, new.organization_id, new.unit_id, new.planned_objective, new.visit_category, new.visit_type, new.meeting_action_id, new.plan_id)
     is distinct from (old.project_id, old.organization_id, old.unit_id, old.planned_objective, old.visit_category, old.visit_type, old.meeting_action_id, old.plan_id) then
    raise exception 'This visit is a follow-up from the sales meeting – only the day and time can be changed';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    raise exception 'A follow-up visit from the sales meeting cannot be cancelled – reschedule it, or ask SM Projects';
  end if;
  return new;
end $$;

-- Project change requests: the unit / department can be changed too (copied from 20260930000083)
create or replace function app.project_change_fields() returns text[] language sql immutable as $$
  select array['name', 'organization_id', 'unit_id', 'project_type', 'city', 'location', 'stage', 'milestone', 'win_probability', 'spec_status',
               'duty_status', 'currency', 'project_value', 'lighting_value', 'expected_tender_date', 'expected_award_date',
               'expected_duration_months', 'project_term']
$$;
create or replace function app.project_field_label(p_field text) returns text language sql immutable as $$
  select case p_field when 'name' then 'Name' when 'organization_id' then 'Customer' when 'unit_id' then 'Unit / department' when 'project_type' then 'Project type'
    when 'city' then 'City' when 'location' then 'Location' when 'stage' then 'Stage' when 'milestone' then 'Milestone'
    when 'win_probability' then 'Win probability' when 'spec_status' then 'Specification' when 'duty_status' then 'Duty status'
    when 'currency' then 'Currency' when 'project_value' then 'Project value' when 'lighting_value' then 'Lighting value'
    when 'expected_tender_date' then 'Tender date' when 'expected_award_date' then 'Award date'
    when 'expected_duration_months' then 'Duration' when 'project_term' then 'Term' else p_field end
$$;

-- (copied from 20260930000083: applies unit_id; a new customer clears the old customer's unit)
create or replace function public.decide_project_change(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.project_change_requests; c jsonb; p public.projects;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects approves project changes');
  select * into r from public.project_change_requests where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'pending', 'Already decided');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  select * into p from public.projects where id = r.project_id;
  if p_approve then
    c := r.changes;
    perform app.require(not (c ? 'unit_id') or nullif(c ->> 'unit_id', '') is null
      or exists (select 1 from public.org_units where id = (c ->> 'unit_id')::uuid
                   and organization_id = coalesce((c ->> 'organization_id')::uuid, p.organization_id)),
      'The unit / department belongs to another customer');
    perform set_config('app.reason', 'Change request approved: ' || r.reason, true);
    update public.projects set
      name = case when c ? 'name' then c ->> 'name' else name end,
      organization_id = case when c ? 'organization_id' then (c ->> 'organization_id')::uuid else organization_id end,
      unit_id = case when c ? 'unit_id' then nullif(c ->> 'unit_id', '')::uuid
                     when c ? 'organization_id' then null else unit_id end,
      project_type = case when c ? 'project_type' then (c ->> 'project_type')::public.project_type else project_type end,
      city = case when c ? 'city' then nullif(c ->> 'city', '') else city end,
      location = case when c ? 'location' then nullif(c ->> 'location', '') else location end,
      stage = case when c ? 'stage' then c ->> 'stage' else stage end,
      milestone = case when c ? 'milestone' then (c ->> 'milestone')::public.pipeline_milestone else milestone end,
      win_probability = case when c ? 'win_probability' then (c ->> 'win_probability')::int else win_probability end,
      last_probability_review_at = case when c ? 'win_probability' or c ? 'milestone' then now() else last_probability_review_at end,
      spec_status = case when c ? 'spec_status' then c ->> 'spec_status' else spec_status end,
      duty_status = case when c ? 'duty_status' then nullif(c ->> 'duty_status', '')::public.duty_status else duty_status end,
      currency = case when c ? 'currency' then (c ->> 'currency')::public.currency
                      when c ? 'duty_status' then (case when c ->> 'duty_status' = 'duty_free' then 'USD' else 'LKR' end)::public.currency else currency end,
      project_value = case when c ? 'project_value' then nullif(c ->> 'project_value', '')::numeric else project_value end,
      lighting_value = case when c ? 'lighting_value' then nullif(c ->> 'lighting_value', '')::numeric else lighting_value end,
      expected_tender_date = case when c ? 'expected_tender_date' then nullif(c ->> 'expected_tender_date', '')::date else expected_tender_date end,
      expected_award_date = case when c ? 'expected_award_date' then nullif(c ->> 'expected_award_date', '')::date else expected_award_date end,
      expected_duration_months = case when c ? 'expected_duration_months' then (c ->> 'expected_duration_months')::int else expected_duration_months end,
      project_term = case when c ? 'project_term' then c ->> 'project_term' else project_term end
     where id = r.project_id;
  end if;
  update public.project_change_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(),
    decided_at = now(), decision_note = nullif(btrim(p_note), '') where id = r.id;
  perform app.notify(r.requested_by, 'project_change', format('Project change %s – %s', case when p_approve then 'approved' else 'not approved' end, p.code),
    coalesce(nullif(btrim(p_note), ''), p.name), 'normal', 'project', p.id, '/projects/' || p.id, null, true);
end $$;
