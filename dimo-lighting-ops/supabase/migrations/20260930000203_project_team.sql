-- Project team: the architect, MEP / electrical consultant, lighting designer, QS and contractors of a project
--  * Built on the stakeholder map: a visit still adds the organisation it met ("met"); the sales person or SM Projects
--    can now add one directly (from tender documents, drawings, the client) and mark it appointed, met or replaced.
--  * The team is shown on the project, its inquiries and its offers & competition records – Design and Estimation
--    see it there through project_team(), without access to the project itself.
--  * Consultant overview: every project an organisation is on (that the caller may see), our results and the brands
--    asked for on them, and the projects where we have not met them for 60 days.

alter table public.project_stakeholders add column if not exists status text not null default 'met' check (status in ('appointed', 'met', 'replaced'));
alter table public.project_stakeholders add column if not exists source text not null default 'visit' check (source in ('visit', 'manual'));
alter table public.project_stakeholders add column if not exists notes text;
alter table public.project_stakeholders add column if not exists added_by uuid default auth.uid() references public.profiles (id);
alter table public.project_stakeholders add column if not exists updated_by uuid references public.profiles (id);
alter table public.project_stakeholders add column if not exists updated_at timestamptz not null default now();

-- Who keeps the team: SM Projects, GM / DGM, and sales people who can see the project
create or replace function app.can_edit_project_team(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('sm_projects', 'gm') or (app.is_sales_person() and app.can_read_project(p_project))
$$;

drop policy if exists stakeholders_write on public.project_stakeholders;
drop policy if exists stakeholders_update on public.project_stakeholders;
drop policy if exists stakeholders_delete on public.project_stakeholders;
create policy stakeholders_write on public.project_stakeholders for insert to authenticated with check (app.can_edit_project_team(project_id));
create policy stakeholders_update on public.project_stakeholders for update to authenticated using (app.can_edit_project_team(project_id)) with check (app.can_edit_project_team(project_id));
create policy stakeholders_delete on public.project_stakeholders for delete to authenticated using (app.can_edit_project_team(project_id) and source = 'manual');
grant select, insert, update, delete on public.project_stakeholders to authenticated;

-- Who sees a project's team: those who see the project, those on one of its inquiries, the tender / offers team
create or replace function app.can_see_project_team(p_project uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if app.can_read_project(p_project) then return true; end if;
  if app.has_role('sm_estimation', 'am_estimation') then return true; end if;
  return exists (select 1 from public.inquiries i where i.project_id = p_project and app.can_read_inquiry(i.id))
      or exists (select 1 from public.tenders t where t.project_id = p_project and t.sales_person_id = auth.uid());
end $$;

create or replace function public.project_team(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare contacts_ok boolean := app.has_role('gm', 'sm_projects', 'asm_building', 'asm_infra', 'sm_estimation');
begin
  if p_project is null or not app.can_see_project_team(p_project) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'category', s.category, 'organization_id', s.organization_id, 'organization', o.name,
      'contact_id', s.contact_id, 'contact', c.name, 'designation', c.designation,
      'phone', case when contacts_ok then c.phone end, 'email', case when contacts_ok then c.email end,
      'status', s.status, 'source', s.source, 'notes', s.notes, 'updated_at', s.updated_at, 'updated_by', coalesce(s.updated_by, s.added_by),
      'last_visit_at', (select max(v.checkin_at) from public.visits v where v.project_id = s.project_id and v.organization_id = s.organization_id),
      'visits', (select count(*) from public.visits v where v.project_id = s.project_id and v.organization_id = s.organization_id))
      order by case s.status when 'appointed' then 0 when 'met' then 1 else 2 end, s.category, o.name)
    from public.project_stakeholders s
    join public.organizations o on o.id = s.organization_id
    left join public.contacts c on c.id = s.contact_id
    where s.project_id = p_project), '[]'::jsonb);
end $$;
grant execute on function public.project_team(uuid) to authenticated;

-- A consultant's (or any organisation's) projects: roles held, our results, brands asked for, last time we met them there
create or replace function public.consultant_overview(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.has_role('gm', 'sm_projects', 'asm_building', 'asm_infra', 'sm_estimation', 'am_estimation') then raise exception 'Not available for your role'; end if;
  return jsonb_build_object(
    'organization', (select jsonb_build_object('id', id, 'name', name, 'visit_category', visit_category, 'phone', phone, 'email', email, 'address', address) from public.organizations where id = p_org),
    'projects', coalesce((
      select jsonb_agg(x order by x ->> 'last_activity_at' desc nulls last)
      from (
        select jsonb_build_object(
          'project_id', p.id, 'name', p.name, 'project_type', p.project_type, 'stage', p.stage, 'milestone', p.milestone, 'status', p.status,
          'roles', (select jsonb_agg(distinct s2.category) from public.project_stakeholders s2 where s2.project_id = p.id and s2.organization_id = p_org),
          'appointed', exists (select 1 from public.project_stakeholders s2 where s2.project_id = p.id and s2.organization_id = p_org and s2.status = 'appointed'),
          'replaced', not exists (select 1 from public.project_stakeholders s2 where s2.project_id = p.id and s2.organization_id = p_org and s2.status <> 'replaced'),
          'last_met_at', (select max(v.checkin_at) from public.visits v where v.project_id = p.id and v.organization_id = p_org),
          'last_activity_at', p.last_activity_at,
          'won', (select count(*) from public.inquiries i where i.project_id = p.id and i.result = 'won'),
          'lost', (select count(*) from public.inquiries i where i.project_id = p.id and i.result = 'lost'),
          'open', (select count(*) from public.inquiries i where i.project_id = p.id and i.result is null and i.status not in ('draft', 'rejected', 'cancelled')),
          'won_value', (select coalesce(sum(i.order_value), 0) from public.inquiries i where i.project_id = p.id and i.result = 'won'),
          'brands_asked', (select string_agg(distinct nullif(btrim(coalesce(i.approved_makes, '') || case when i.approved_makes is not null and i.preferred_brands is not null then ', ' else '' end || coalesce(i.preferred_brands, '')), ''), '; ')
                           from public.inquiries i where i.project_id = p.id),
          'owner_id', p.owner_id) as x
        from public.projects p
        where exists (select 1 from public.project_stakeholders s where s.project_id = p.id and s.organization_id = p_org)
          and (app.can_read_project(p.id) or app.has_role('sm_estimation', 'am_estimation'))
      ) q), '[]'::jsonb));
end $$;
grant execute on function public.consultant_overview(uuid) to authenticated;
