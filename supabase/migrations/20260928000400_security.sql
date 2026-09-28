-- DIMO Sales Visit & Project Tracking — server-enforced permissions (Row Level Security)
--
-- Salesperson : own + own-territory accounts, contacts, visits, projects; shared projects via project_members
-- Manager     : read everything, assign owners, approve corrections, export
-- Estimator   : assigned projects only; adds technical notes, quotations, milestones; cannot edit visits
-- Admin       : everything a manager can, plus users, lists, settings, audit
-- Deactivated users have no role, so every policy denies them.

-- ---------------------------------------------------------------------------
-- Visibility helpers (SECURITY DEFINER to avoid recursive policy evaluation)
-- ---------------------------------------------------------------------------
create or replace function public.is_project_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members where project_id = p and user_id = auth.uid())
$$;

create or replace function public.can_read_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
    or public.is_project_member(p)
    or (public.has_role('{salesperson}') and exists (
      select 1 from public.projects pr where pr.id = p and (
        pr.owner_id = auth.uid() or public.in_my_territory(pr.territory_id)
        or exists (select 1 from public.opportunities o where o.project_id = pr.id and o.owner_id = auth.uid()))))
$$;

create or replace function public.can_edit_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
    or (public.has_role('{salesperson}') and (
      public.is_project_member(p)
      or exists (select 1 from public.projects pr where pr.id = p and (pr.owner_id = auth.uid() or public.in_my_territory(pr.territory_id)))))
$$;

create or replace function public.can_read_customer(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
    or (public.has_role('{salesperson}') and exists (
      select 1 from public.customers cu where cu.id = c and (cu.owner_id = auth.uid() or public.in_my_territory(cu.territory_id))))
    or exists (
      -- customers linked to projects the user can see (as owner, developer, end user or stakeholder)
      select 1 from public.projects pr
      where (pr.customer_id = c or pr.developer_id = c or pr.end_user_id = c) and public.can_read_project(pr.id)
      union all
      select 1 from public.project_stakeholders ps where ps.customer_id = c and public.can_read_project(ps.project_id))
    or exists (select 1 from public.visits v where v.customer_id = c and v.salesperson_id = auth.uid())
$$;

create or replace function public.can_read_visit(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.visits vi where vi.id = v and (
      public.is_manager()
      or vi.salesperson_id = auth.uid()
      or (public.has_role('{salesperson}') and public.in_my_territory(vi.territory_id))
      or exists (select 1 from public.visit_projects vp where vp.visit_id = vi.id and public.is_project_member(vp.project_id))))
$$;

-- Owner may edit while planned/draft; managers may correct any visit (audited).
create or replace function public.can_edit_visit(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.visits vi where vi.id = v and (
      public.is_manager()
      or (vi.salesperson_id = auth.uid() and vi.status in ('planned', 'draft') and public.has_role('{salesperson}'))))
$$;

create or replace function public.can_read_opportunity(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.opportunities op where op.id = o and (op.owner_id = auth.uid() or public.can_read_project(op.project_id)))
$$;

create or replace function public.can_see_margin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role()::text = any (
    select jsonb_array_elements_text(coalesce(public.setting('margin_visible_roles'), '["manager","admin"]'::jsonb))), false)
$$;

create or replace function public.can_read_entity(t text, e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case t
    when 'customer' then public.can_read_customer(e)
    when 'contact' then exists (select 1 from public.contacts c where c.id = e and public.can_read_customer(c.customer_id))
    when 'project' then public.can_read_project(e)
    when 'opportunity' then public.can_read_opportunity(e)
    when 'visit' then public.can_read_visit(e)
    when 'action' then exists (select 1 from public.actions a where a.id = e and (a.owner_id = auth.uid() or a.created_by = auth.uid()
      or public.is_manager() or (a.visit_id is not null and public.can_read_visit(a.visit_id))
      or (a.project_id is not null and public.can_read_project(a.project_id))))
    when 'quotation' then exists (select 1 from public.quotations q where q.id = e and public.can_read_opportunity(q.opportunity_id))
    when 'milestone' then exists (select 1 from public.project_milestones m where m.id = e and public.can_read_project(m.project_id))
    else false end
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'business_units', 'territories', 'profiles', 'profile_territories', 'lookup_values', 'pipeline_stages',
    'app_settings', 'exchange_rates', 'audit_log', 'customers', 'contacts', 'projects', 'project_members',
    'project_stakeholders', 'opportunities', 'opportunity_stage_history', 'visits', 'visit_contacts',
    'visit_projects', 'visit_opportunities', 'actions', 'quotations', 'quotation_financials',
    'project_milestones', 'technical_notes', 'attachments', 'correction_requests', 'export_log', 'export_schedules'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    -- Deactivated / uninvited users get nothing, whatever else a policy allows.
    if t not in ('profiles', 'profile_territories') then
      execute format('create policy active_users_only on public.%I as restrictive for all to authenticated
                      using (public.current_app_role() is not null) with check (public.current_app_role() is not null)', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reference data: everyone signed in reads; admins (and managers for stages) write
-- ---------------------------------------------------------------------------
create policy read_all on public.business_units for select to authenticated using (public.current_app_role() is not null);
create policy admin_write on public.business_units for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_all on public.territories for select to authenticated using (public.current_app_role() is not null);
create policy admin_write on public.territories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_all on public.lookup_values for select to authenticated using (public.current_app_role() is not null);
create policy admin_write on public.lookup_values for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_all on public.pipeline_stages for select to authenticated using (public.current_app_role() is not null);
create policy manager_write on public.pipeline_stages for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy read_all on public.app_settings for select to authenticated using (public.current_app_role() is not null);
create policy admin_write on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_all on public.exchange_rates for select to authenticated using (public.current_app_role() is not null);
create policy manager_write on public.exchange_rates for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- Profiles: names are visible to colleagues (owner pickers); a user reads their own even when inactive
create policy read_profiles on public.profiles for select to authenticated using (id = auth.uid() or public.current_app_role() is not null);
create policy update_self on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy read_all on public.profile_territories for select to authenticated using (user_id = auth.uid() or public.current_app_role() is not null);
create policy admin_write on public.profile_territories for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy manager_read on public.audit_log for select to authenticated using (public.is_manager());

-- ---------------------------------------------------------------------------
-- Customers & contacts
-- ---------------------------------------------------------------------------
-- Policies test the row's own columns first so a freshly inserted row is
-- visible to its creator (INSERT ... RETURNING / ON CONFLICT).
create policy read_customers on public.customers for select to authenticated
  using (public.is_manager()
    or (public.has_role('{salesperson}') and (owner_id = auth.uid() or created_by = auth.uid() or public.in_my_territory(territory_id)))
    or public.can_read_customer(id));
create policy insert_customers on public.customers for insert to authenticated
  with check (public.is_manager() or (public.has_role('{salesperson}') and coalesce(owner_id, auth.uid()) = auth.uid() and public.in_my_territory(territory_id)));
create policy update_customers on public.customers for update to authenticated
  using (public.is_manager() or (public.has_role('{salesperson}') and (owner_id = auth.uid() or (owner_id is null and public.in_my_territory(territory_id)))))
  with check (public.is_manager() or (owner_id = auth.uid() and public.in_my_territory(territory_id)));
create policy delete_customers on public.customers for delete to authenticated using (public.is_admin());

create policy read_contacts on public.contacts for select to authenticated
  using (public.can_read_customer(customer_id));
create policy insert_contacts on public.contacts for insert to authenticated
  with check (public.has_role('{salesperson,manager,admin}') and public.can_read_customer(customer_id));
create policy update_contacts on public.contacts for update to authenticated
  using (public.is_manager() or (public.has_role('{salesperson}') and public.can_read_customer(customer_id)))
  with check (public.is_manager() or public.can_read_customer(customer_id));
create policy delete_contacts on public.contacts for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Projects, members, stakeholders, opportunities
-- ---------------------------------------------------------------------------
create policy read_projects on public.projects for select to authenticated
  using (public.is_manager()
    or (public.has_role('{salesperson}') and (owner_id = auth.uid() or created_by = auth.uid() or public.in_my_territory(territory_id)))
    or public.can_read_project(id));
create policy insert_projects on public.projects for insert to authenticated
  with check (public.is_manager() or (public.has_role('{salesperson}') and coalesce(owner_id, auth.uid()) = auth.uid()));
create policy update_projects on public.projects for update to authenticated
  using (public.can_edit_project(id)) with check (public.can_edit_project(id));
create policy delete_projects on public.projects for delete to authenticated using (public.is_admin());

create policy read_members on public.project_members for select to authenticated using (public.can_read_project(project_id));
create policy write_members on public.project_members for all to authenticated
  using (public.is_manager() or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()))
  with check (public.is_manager() or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

create policy read_stakeholders on public.project_stakeholders for select to authenticated using (public.can_read_project(project_id));
create policy write_stakeholders on public.project_stakeholders for all to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

create policy read_opportunities on public.opportunities for select to authenticated
  using (owner_id = auth.uid() or public.can_read_project(project_id));
create policy insert_opportunities on public.opportunities for insert to authenticated
  with check (public.can_edit_project(project_id));
create policy update_opportunities on public.opportunities for update to authenticated
  using (public.is_manager() or owner_id = auth.uid() or public.can_edit_project(project_id))
  with check (public.is_manager() or owner_id = auth.uid() or public.can_edit_project(project_id));
create policy delete_opportunities on public.opportunities for delete to authenticated using (public.is_admin());

create policy read_stage_history on public.opportunity_stage_history for select to authenticated
  using (public.can_read_opportunity(opportunity_id));

-- ---------------------------------------------------------------------------
-- Visits and their links
-- ---------------------------------------------------------------------------
create policy read_visits on public.visits for select to authenticated
  using (public.is_manager() or salesperson_id = auth.uid()
    or (public.has_role('{salesperson}') and public.in_my_territory(territory_id))
    or public.can_read_visit(id));
create policy insert_visits on public.visits for insert to authenticated
  with check (public.is_manager() or (public.has_role('{salesperson}') and salesperson_id = auth.uid()));
create policy update_visits on public.visits for update to authenticated
  using (public.is_manager() or (public.has_role('{salesperson}') and salesperson_id = auth.uid() and status in ('planned', 'draft')))
  with check (public.is_manager() or salesperson_id = auth.uid());
create policy delete_visits on public.visits for delete to authenticated
  using (salesperson_id = auth.uid() and status in ('planned', 'draft'));

create policy read_links on public.visit_contacts for select to authenticated using (public.can_read_visit(visit_id));
create policy write_links on public.visit_contacts for all to authenticated using (public.can_edit_visit(visit_id)) with check (public.can_edit_visit(visit_id));
create policy read_links on public.visit_projects for select to authenticated using (public.can_read_visit(visit_id));
create policy write_links on public.visit_projects for all to authenticated using (public.can_edit_visit(visit_id)) with check (public.can_edit_visit(visit_id));
create policy read_links on public.visit_opportunities for select to authenticated using (public.can_read_visit(visit_id));
create policy write_links on public.visit_opportunities for all to authenticated using (public.can_edit_visit(visit_id)) with check (public.can_edit_visit(visit_id));

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------
create policy read_actions on public.actions for select to authenticated
  using (public.current_app_role() is not null and (
    public.is_manager() or owner_id = auth.uid() or created_by = auth.uid()
    or (public.has_role('{salesperson}') and public.in_my_territory(territory_id))
    or (visit_id is not null and public.can_read_visit(visit_id))
    or (project_id is not null and public.can_read_project(project_id))));
create policy insert_actions on public.actions for insert to authenticated
  with check (public.current_app_role() is not null and (
    public.is_manager()
    or (visit_id is not null and public.can_edit_visit(visit_id))
    or (visit_id is null and (
      (project_id is not null and public.can_read_project(project_id))
      or (customer_id is not null and public.can_read_customer(customer_id))
      or (opportunity_id is not null and public.can_read_opportunity(opportunity_id))))));
create policy update_actions on public.actions for update to authenticated
  using (public.is_manager() or owner_id = auth.uid() or created_by = auth.uid())
  with check (public.is_manager() or owner_id = auth.uid() or created_by = auth.uid());
create policy delete_actions on public.actions for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Quotations (cost/margin restricted by role), milestones, technical notes
-- ---------------------------------------------------------------------------
create policy read_quotations on public.quotations for select to authenticated using (public.can_read_opportunity(opportunity_id));
create policy write_quotations on public.quotations for insert to authenticated
  with check (public.is_manager() or (public.can_read_opportunity(opportunity_id) and public.has_role('{salesperson,estimator}')));
create policy update_quotations on public.quotations for update to authenticated
  using (public.is_manager() or prepared_by = auth.uid() or created_by = auth.uid())
  with check (public.is_manager() or public.can_read_opportunity(opportunity_id));

create policy margin_read on public.quotation_financials for select to authenticated using (public.can_see_margin());
create policy margin_write on public.quotation_financials for all to authenticated
  using (public.can_see_margin()) with check (public.can_see_margin());

create policy read_milestones on public.project_milestones for select to authenticated using (public.can_read_project(project_id));
create policy write_milestones on public.project_milestones for all to authenticated
  using (public.is_manager() or public.is_project_member(project_id) or public.can_edit_project(project_id))
  with check (public.is_manager() or public.is_project_member(project_id) or public.can_edit_project(project_id));

create policy read_notes on public.technical_notes for select to authenticated using (public.can_read_project(project_id));
create policy insert_notes on public.technical_notes for insert to authenticated
  with check (public.is_manager() or public.is_project_member(project_id) or public.can_edit_project(project_id));
create policy update_notes on public.technical_notes for update to authenticated
  using (created_by = auth.uid() or public.is_admin()) with check (created_by = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------
create policy read_attachments on public.attachments for select to authenticated
  using (public.can_read_entity(entity_type, entity_id));
create policy insert_attachments on public.attachments for insert to authenticated
  with check (public.current_app_role() is not null and (
    public.can_read_entity(entity_type, entity_id)
    -- a visit attachment may arrive before the visit row during offline sync
    or (entity_type = 'visit' and not exists (select 1 from public.visits v where v.id = entity_id))));
create policy update_attachments on public.attachments for update to authenticated
  using (created_by = auth.uid() or public.is_manager()) with check (created_by = auth.uid() or public.is_manager());

-- ---------------------------------------------------------------------------
-- Corrections, exports
-- ---------------------------------------------------------------------------
create policy read_corrections on public.correction_requests for select to authenticated
  using (requested_by = auth.uid() or public.is_manager());
create policy insert_corrections on public.correction_requests for insert to authenticated
  with check (requested_by = auth.uid() and exists (select 1 from public.visits v where v.id = visit_id and v.salesperson_id = auth.uid()));
create policy withdraw_corrections on public.correction_requests for update to authenticated
  using (requested_by = auth.uid() and status = 'pending') with check (status = 'withdrawn');

create policy read_exports on public.export_log for select to authenticated using (user_id = auth.uid() or public.is_manager());
create policy manage_schedules on public.export_schedules for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- ---------------------------------------------------------------------------
-- Storage: private buckets for attachments and generated exports
-- Path convention: <uploader user id>/<entity_type>/<entity_id>/<attachment_id>/<filename>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('attachments', 'attachments', false, 26214400,
   array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf', 'audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/aac',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'text/csv',
         'application/dwg', 'image/vnd.dwg', 'application/acad', 'application/octet-stream']),
  ('exports', 'exports', false, 52428800, array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy attachments_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.current_app_role() is not null
    and (storage.foldername(name))[1] = auth.uid()::text);
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and ((storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.attachments a where a.storage_path = name and public.can_read_entity(a.entity_type, a.entity_id))));
create policy exports_read on storage.objects for select to authenticated
  using (bucket_id = 'exports' and public.is_manager());
