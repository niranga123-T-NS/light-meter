-- Subcontractors never see each other: a subcontractor supervisor sees, of the project, only DIMO's people and their own
-- company – not other supervisors (team list), other subcontractors (register), their permits / checklists / equipment /
-- inductions (HSE) or the engineers' plan items given to other supervisors.

create or replace function app.is_sub() returns boolean language sql stable security definer set search_path = public as $$
  select app.has_role('sub_supervisor')
$$;
create or replace function app.my_company() returns text language sql stable security definer set search_path = public as $$
  select nullif(lower(btrim(company)), '') from public.profiles where id = auth.uid()
$$;
-- A company name that is DIMO itself / nobody's (shared site items)
create or replace function app.is_own_or_dimo(p_company text) returns boolean language sql stable as $$
  select coalesce(btrim(p_company), '') = '' or lower(btrim(p_company)) like 'dimo%' or lower(btrim(p_company)) = app.my_company()
$$;

-- Team list: other subcontractor supervisors are hidden from a supervisor
drop policy if exists exec_members_read on public.exec_members;
create policy exec_members_read on public.exec_members for select to authenticated using (
  app.can_read_exec(exec_project_id) and (not app.is_sub() or member_role <> 'sub_supervisor' or user_id = auth.uid()));

-- Subcontractor register: a supervisor sees only their own company
drop policy if exists exec_subcontractors_read on public.exec_subcontractors;
create policy exec_subcontractors_read on public.exec_subcontractors for select to authenticated using (
  app.can_read_exec(exec_project_id) and (not app.is_sub() or lower(name) = app.my_company()));

-- HSE equipment: shared / DIMO items and their own company's; records: their own and the checklists of equipment they see
create or replace function app.can_see_hse_equipment(e public.hse_equipment) returns boolean
language sql stable security definer set search_path = public as $$
  select app.can_read_exec(e.exec_project_id) and (not app.is_sub() or e.created_by = auth.uid() or app.is_own_or_dimo(e.contractor))
$$;
create or replace function app.can_see_hse_record(r public.hse_records) returns boolean
language sql stable security definer set search_path = public as $$
  select app.can_read_exec(r.exec_project_id) and (
    not app.is_sub() or r.created_by = auth.uid()
    or exists (select 1 from public.hse_records x where x.id = r.related_id and x.created_by = auth.uid())
    or (r.code not like 'PTW-%' and r.equipment_id is not null
        and exists (select 1 from public.hse_equipment e where e.id = r.equipment_id and (e.created_by = auth.uid() or app.is_own_or_dimo(e.contractor)))))
$$;
drop policy if exists hse_equipment_read on public.hse_equipment;
create policy hse_equipment_read on public.hse_equipment for select to authenticated using (app.can_see_hse_equipment(hse_equipment));
drop policy if exists hse_records_read on public.hse_records;
create policy hse_records_read on public.hse_records for select to authenticated using (app.can_see_hse_record(hse_records));
drop policy if exists hse_inductions_read on public.hse_inductions;
create policy hse_inductions_read on public.hse_inductions for select to authenticated using (
  app.can_read_exec(exec_project_id) and (not app.is_sub() or instructor_id = auth.uid() or app.is_own_or_dimo(company)));

create or replace function public.sub_plan_ae_items(p_plan uuid)
returns table (id uuid, day date, kind text, title text, zone text, qty numeric, unit text, engineer text, mine boolean, picked boolean)
language plpgsql stable security definer set search_path = public as $$
declare s public.sub_plans;
begin
  select * into s from public.sub_plans where sub_plans.id = p_plan;
  perform app.require(s.id is not null and app.can_read_sub_plan(s.id), 'Not found');
  return query
    select i.id, i.day, i.kind, i.title, i.zone, i.qty, i.unit, app.display_name(p.ae_id), i.supervisor_id = s.supervisor_id,
           exists (select 1 from public.sub_plan_items x where x.sub_plan_id = s.id and x.ae_item_id = i.id)
      from public.exec_plan_items i join public.exec_plans p on p.id = i.plan_id
     where p.exec_project_id = s.exec_project_id and p.status = 'approved' and i.day between s.week_start and s.week_start + 6
       and i.source = 'plan'
       -- a supervisor never sees what was given to another supervisor
       and (not app.is_sub() or i.supervisor_id is null or i.supervisor_id = s.supervisor_id)
     order by i.day, i.title;
end $$;
