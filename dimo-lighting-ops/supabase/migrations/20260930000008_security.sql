-- Row-level security (SRS Section 2 visibility rule and Section 10.2 permission matrix) and storage.

-- ---------------------------------------------------------------------------
-- Visibility helpers
-- ---------------------------------------------------------------------------
create or replace function app.can_read_inquiry(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  r public.app_role := app.my_role();
  i record;
begin
  if r is null then return false; end if;
  if r in ('gm', 'sm_projects') then return true; end if;
  select route, status, sales_person_id into i from public.inquiries where id = p_id;
  if not found then return false; end if;
  if r in ('asm_building', 'asm_infra') then return i.sales_person_id = auth.uid(); end if;
  if i.status = 'draft' then return false; end if;
  if r = 'design_manager' then return i.route in ('A', 'C'); end if;
  if r in ('lighting_designer', 'lighting_engineer') then
    return exists (select 1 from public.design_jobs where inquiry_id = p_id and assignee_id = auth.uid());
  end if;
  if r = 'sm_estimation' then
    return i.route = 'B' or exists (select 1 from public.estimation_jobs where inquiry_id = p_id);
  end if;
  if r in ('am_estimation', 'estimation_exec') then
    return exists (select 1 from public.estimation_jobs where inquiry_id = p_id and assignee_id = auth.uid());
  end if;
  return false;
end $$;

create or replace function app.can_read_design_job(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); j record;
begin
  if r in ('gm', 'design_manager') then return true; end if;
  select assignee_id, inquiry_id into j from public.design_jobs where id = p_id;
  if r in ('lighting_designer', 'lighting_engineer') then return j.assignee_id = auth.uid(); end if;
  -- Estimation sees the design job of inquiries routed to it (approved design pack only – see attachments)
  if r in ('sm_estimation', 'am_estimation', 'estimation_exec') then return app.can_read_inquiry(j.inquiry_id); end if;
  return false;
end $$;

create or replace function app.can_read_estimation_job(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); j record;
begin
  if r in ('gm', 'sm_estimation') then return true; end if;
  select assignee_id into j from public.estimation_jobs where id = p_id;
  if r in ('am_estimation', 'estimation_exec') then return j.assignee_id = auth.uid(); end if;
  return false;
end $$;

-- Cost, margin and costing sheets: Estimation, SM Projects and GM / DGM (7.2, 7.5)
create or replace function app.can_read_costing(p_job uuid) returns boolean
language sql stable as $$
  select app.has_role('gm', 'sm_estimation', 'sm_projects') or app.can_read_estimation_job(p_job)
$$;

create or replace function app.can_read_project(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role();
begin
  if r in ('gm', 'sm_projects') then return true; end if;
  if r in ('asm_building', 'asm_infra') then
    return exists (select 1 from public.projects where id = p_id and (owner_id = auth.uid() or project_type = any (app.my_project_types())));
  end if;
  return false;
end $$;

-- Attachment visibility by kind
create or replace function app.can_read_attachment(a public.attachments) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); inq uuid; st text; mode int; released timestamptz;
begin
  if r is null then return false; end if;
  if a.uploaded_by = auth.uid() then return true; end if;
  case a.entity_type
  when 'visit' then
    return r in ('gm', 'sm_projects') or exists (select 1 from public.visits where id = a.entity_id and sales_person_id = auth.uid());
  when 'tender' then
    return r in ('gm', 'sm_projects', 'sm_estimation') or exists (select 1 from public.tenders where id = a.entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return app.can_read_inquiry(a.entity_id);
  when 'design_job' then
    select inquiry_id into inq from public.design_jobs where id = a.entity_id;
    if r in ('gm', 'design_manager') or app.can_read_design_job(a.entity_id) and r in ('lighting_designer', 'lighting_engineer') then return true; end if;
    -- Released design pack: Estimation (on release) and Sales (Route C / mode 3 release / early release)
    if a.kind = 'design_pack' then
      if r in ('sm_estimation', 'am_estimation', 'estimation_exec') then return app.can_read_inquiry(inq); end if;
      select status, release_mode, design_released_to_sales_at into st, mode, released from public.inquiries where id = inq;
      if r in ('sm_projects') or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)) then
        return released is not null;
      end if;
    end if;
    return false;
  when 'estimation_job' then
    select inquiry_id into inq from public.estimation_jobs where id = a.entity_id;
    if a.kind = 'costing_sheet' then return app.can_read_costing(a.entity_id); end if;
    if r in ('gm', 'sm_estimation') or app.can_read_estimation_job(a.entity_id) then return true; end if;
    -- Sales download only the released quotation and supporting sheets – never the costing sheet
    if a.kind in ('quotation_final', 'compliance_sheet', 'technical_data') then
      return exists (select 1 from public.estimation_jobs where id = a.entity_id and status = 'released')
             and (r = 'sm_projects' or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)));
    end if;
    return false;
  when 'clarification' then
    select inquiry_id into inq from public.clarifications where id = a.entity_id;
    return r in ('gm', 'design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec')
           and app.can_read_inquiry(inq);
  when 'sample' then
    return r in ('gm', 'sm_projects', 'operations_exec') or exists (select 1 from public.samples where id = a.entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then
    return r in ('gm', 'sm_projects', 'operations_exec');
  else
    return r = 'gm';
  end case;
end $$;

create or replace function app.can_write_attachment(p_entity_type text, p_entity_id uuid, p_kind text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role();
begin
  case p_entity_type
  when 'visit' then return exists (select 1 from public.visits where id = p_entity_id and sales_person_id = auth.uid()) or r = 'sm_projects';
  when 'tender' then return exists (select 1 from public.tenders where id = p_entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return exists (select 1 from public.inquiries where id = p_entity_id and (sales_person_id = auth.uid() or r in ('sm_projects', 'gm')));
  when 'design_job' then
    return r = 'design_manager' or exists (select 1 from public.design_jobs where id = p_entity_id and assignee_id = auth.uid());
  when 'estimation_job' then
    return r = 'sm_estimation' or exists (select 1 from public.estimation_jobs where id = p_entity_id and assignee_id = auth.uid());
  when 'clarification' then
    return r in ('design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec');
  when 'sample' then
    return r = 'operations_exec' or exists (select 1 from public.samples where id = p_entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then return r = 'operations_exec';
  else return false;
  end case;
end $$;

-- File versions and automatic naming (QTN-2026-00125-R1.pdf) (7.5)
create or replace function app.attachments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare qno text; rev int; ext text;
begin
  if not app.can_write_attachment(new.entity_type, new.entity_id, new.kind) then
    raise exception 'You cannot upload files to this record';
  end if;
  new.version := coalesce((select max(version) from public.attachments
                           where entity_type = new.entity_type and entity_id = new.entity_id and kind = new.kind), 0) + 1;
  if new.entity_type = 'estimation_job' and new.kind in ('quotation_draft', 'quotation_final') then
    select coalesce(e.quotation_no, (select quotation_no from public.quotations q where q.inquiry_id = e.inquiry_id limit 1),
                    i.code), i.revision
      into qno, rev from public.estimation_jobs e join public.inquiries i on i.id = e.inquiry_id where e.id = new.entity_id;
    ext := coalesce(substring(new.file_name from '\.([A-Za-z0-9]+)$'), 'pdf');
    new.file_name := format('%s-R%s%s.%s', qno, rev, case when new.kind = 'quotation_draft' then '-draft-v' || new.version else '' end, ext);
  end if;
  return new;
end $$;
create trigger attachments_before before insert on public.attachments for each row execute function app.attachments_before();
create trigger audit_attachments after insert or update on public.attachments for each row execute function app.audit();

-- Every download is logged (10.3): the app calls this before creating a signed URL
create or replace function public.log_download(p_attachment uuid) returns text
language plpgsql security definer set search_path = public as $$
declare a public.attachments;
begin
  select * into a from public.attachments where id = p_attachment;
  if not app.can_read_attachment(a) then raise exception 'Not allowed'; end if;
  insert into public.download_log (attachment_id) values (a.id);
  return a.storage_path;
end $$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere and define policies
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'push_tokens', 'settings', 'holidays', 'exchange_rates', 'master_lists', 'brands', 'competitors',
    'audit_log', 'status_history', 'attachments', 'download_log', 'notifications', 'approvals', 'approval_steps', 'report_runs',
    'organizations', 'org_units', 'contacts', 'projects', 'project_log', 'project_stakeholders', 'visit_plans', 'visit_plan_lines',
    'visits', 'tenders', 'tender_bids', 'inquiries', 'due_date_changes', 'design_jobs', 'design_hours', 'estimation_jobs',
    'estimation_costing', 'quotations', 'clarifications', 'sla_rules', 'sla_clocks',
    'debt_uploads', 'debt_upload_rows', 'debts', 'debt_snapshots', 'debt_log', 'samples', 'sample_items']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Profiles: every logged-in internal user sees names, roles and pictures (needed across lists)
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or app.has_role('sys_admin', 'gm')) with check (id = auth.uid() or app.has_role('sys_admin', 'gm'));
create policy profiles_admin_insert on public.profiles for insert to authenticated with check (app.has_role('sys_admin'));

create policy push_tokens_own on public.push_tokens for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Reference data: readable by all; maintained by sys_admin (and GM approves – see settings_change approvals)
create policy settings_read on public.settings for select to authenticated using (true);
create policy settings_write on public.settings for all to authenticated using (app.has_role('sys_admin', 'gm')) with check (app.has_role('sys_admin', 'gm'));
create policy holidays_read on public.holidays for select to authenticated using (true);
create policy holidays_write on public.holidays for all to authenticated using (app.has_role('sys_admin')) with check (app.has_role('sys_admin'));
create policy rates_read on public.exchange_rates for select to authenticated using (true);
create policy rates_write on public.exchange_rates for all to authenticated using (app.has_role('sys_admin')) with check (app.has_role('sys_admin'));
create policy master_read on public.master_lists for select to authenticated using (true);
create policy master_write on public.master_lists for all to authenticated using (app.has_role('sys_admin')) with check (app.has_role('sys_admin'));
create policy brands_read on public.brands for select to authenticated using (true);
create policy brands_write on public.brands for all to authenticated using (app.has_role('sys_admin')) with check (app.has_role('sys_admin'));
create policy competitors_read on public.competitors for select to authenticated using (true);
create policy competitors_write on public.competitors for insert to authenticated with check (app.has_role('sm_projects', 'sys_admin'));
create policy sla_rules_read on public.sla_rules for select to authenticated using (true);
create policy sla_rules_write on public.sla_rules for all to authenticated using (app.has_role('sys_admin', 'gm')) with check (app.has_role('sys_admin', 'gm'));

create policy audit_read on public.audit_log for select to authenticated using (app.has_role('gm', 'sys_admin'));
create policy download_log_read on public.download_log for select to authenticated using (app.has_role('gm', 'sys_admin'));
create policy report_runs_own on public.report_runs for select to authenticated using (user_id = auth.uid() or app.has_role('gm', 'sys_admin'));
create policy report_runs_insert on public.report_runs for insert to authenticated with check (user_id = auth.uid());

-- Status history: inquiry-level for anyone who can read the inquiry; job-level for the owning team
create policy status_history_read on public.status_history for select to authenticated using (
  (entity_type = 'inquiry' and app.can_read_inquiry(entity_id))
  or (entity_type = 'design_job' and app.can_read_design_job(entity_id) and not app.has_role('sm_estimation', 'am_estimation', 'estimation_exec'))
  or (entity_type = 'estimation_job' and app.can_read_estimation_job(entity_id)));

create policy attachments_read on public.attachments for select to authenticated using (app.can_read_attachment(attachments));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and app.can_write_attachment(entity_type, entity_id, kind));
create policy attachments_archive on public.attachments for update to authenticated using (uploaded_by = auth.uid() or app.has_role('gm'));

create policy notifications_own on public.notifications for select to authenticated using (recipient_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create or replace function app.can_read_approval(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.approvals a
    where a.id = p_id and (
      a.requested_by = auth.uid() or app.has_role('gm')
      or exists (select 1 from public.approval_steps s where s.approval_id = a.id and s.approver_role = app.my_role())
      or (a.inquiry_id is not null and app.has_role('sm_projects') and app.can_read_inquiry(a.inquiry_id))))
$$;
create policy approvals_read on public.approvals for select to authenticated using (app.can_read_approval(id));
create policy approval_steps_read on public.approval_steps for select to authenticated using (app.can_read_approval(approval_id));

-- Customers: sales, SM Projects, SM Estimation, GM create and read (4.9); Operations reads for debt mapping
create policy orgs_read on public.organizations for select to authenticated
  using (app.has_role('gm', 'sm_projects', 'asm_building', 'asm_infra', 'sm_estimation', 'operations_exec'));
create policy orgs_insert on public.organizations for insert to authenticated
  with check (app.has_role('gm', 'sm_projects', 'asm_building', 'asm_infra', 'sm_estimation'));
create policy orgs_update on public.organizations for update to authenticated
  using (app.has_role('gm', 'sm_projects') or (app.is_sales_person() and account_owner_id = auth.uid()));
create policy units_read on public.org_units for select to authenticated
  using (app.has_role('gm', 'sm_projects', 'asm_building', 'asm_infra', 'sm_estimation', 'operations_exec'));
create policy units_write on public.org_units for insert to authenticated
  with check (app.has_role('gm', 'sm_projects', 'asm_building', 'asm_infra', 'sm_estimation'));
create policy units_update on public.org_units for update to authenticated using (app.has_role('gm', 'sm_projects'));
create policy contacts_read on public.contacts for select to authenticated
  using (app.has_role('gm', 'sm_projects', 'asm_building', 'asm_infra', 'sm_estimation'));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (app.has_role('gm', 'sm_projects', 'asm_building', 'asm_infra', 'sm_estimation'));
create policy contacts_update on public.contacts for update to authenticated
  using (app.has_role('gm', 'sm_projects') or created_by = auth.uid());

-- Projects and pipeline: sales own types (C R U), SM Projects (C R U all), GM (R + create per 4.9)
create policy projects_read on public.projects for select to authenticated using (app.can_read_project(id));
create policy projects_insert on public.projects for insert to authenticated
  with check (app.has_role('gm', 'sm_projects') or (app.is_sales_person() and project_type = any (app.my_project_types())));
create policy projects_update on public.projects for update to authenticated
  using (app.has_role('gm', 'sm_projects') or owner_id = auth.uid());
create policy project_log_read on public.project_log for select to authenticated using (app.can_read_project(project_id));
create policy stakeholders_read on public.project_stakeholders for select to authenticated using (app.can_read_project(project_id));
create policy stakeholders_write on public.project_stakeholders for insert to authenticated with check (app.can_read_project(project_id));

-- Weekly plans and visits: own (sales), team (SM Projects), all (GM)
create policy plans_read on public.visit_plans for select to authenticated
  using (sales_person_id = auth.uid() or app.has_role('gm', 'sm_projects'));
create policy plans_insert on public.visit_plans for insert to authenticated with check (sales_person_id = auth.uid() and app.is_sales_person());
create policy plans_update_own on public.visit_plans for update to authenticated
  using (sales_person_id = auth.uid() and status in ('draft', 'returned', 'approved'))
  with check (sales_person_id = auth.uid());
create policy plan_lines_read on public.visit_plan_lines for select to authenticated using (
  exists (select 1 from public.visit_plans p where p.id = plan_id and (p.sales_person_id = auth.uid() or app.has_role('gm', 'sm_projects'))));
create policy plan_lines_write on public.visit_plan_lines for all to authenticated
  using (exists (select 1 from public.visit_plans p where p.id = plan_id and p.sales_person_id = auth.uid()))
  with check (exists (select 1 from public.visit_plans p where p.id = plan_id and p.sales_person_id = auth.uid()));

create policy visits_read on public.visits for select to authenticated
  using (sales_person_id = auth.uid() or app.has_role('gm', 'sm_projects'));
create policy visits_insert on public.visits for insert to authenticated with check (sales_person_id = auth.uid() and app.is_sales_person());
create policy visits_update on public.visits for update to authenticated
  using (sales_person_id = auth.uid() or app.has_role('sm_projects'));

create policy tenders_read on public.tenders for select to authenticated
  using (sales_person_id = auth.uid() or app.has_role('gm', 'sm_projects', 'sm_estimation'));
create policy tenders_write on public.tenders for insert to authenticated with check (sales_person_id = auth.uid());
create policy tenders_update on public.tenders for update to authenticated using (sales_person_id = auth.uid() or app.has_role('sm_projects'));
create policy tender_bids_read on public.tender_bids for select to authenticated using (exists (select 1 from public.tenders t where t.id = tender_id));
create policy tender_bids_write on public.tender_bids for all to authenticated
  using (exists (select 1 from public.tenders t where t.id = tender_id and (t.sales_person_id = auth.uid() or app.has_role('sm_projects'))))
  with check (exists (select 1 from public.tenders t where t.id = tender_id and (t.sales_person_id = auth.uid() or app.has_role('sm_projects'))));

-- Inquiries: sales create drafts and edit until submitted; everything else via RPCs
create policy inquiries_read on public.inquiries for select to authenticated using (app.can_read_inquiry(id));
create policy inquiries_insert on public.inquiries for insert to authenticated
  with check (app.has_role('gm', 'sm_projects') or (app.is_sales_person() and sales_person_id = auth.uid()));
create policy inquiries_update_draft on public.inquiries for update to authenticated
  using ((sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm')) and status in ('draft', 'returned_for_info'));
create policy due_changes_read on public.due_date_changes for select to authenticated using (app.can_read_inquiry(inquiry_id));

create policy design_jobs_read on public.design_jobs for select to authenticated using (app.can_read_design_job(id));
create policy design_hours_read on public.design_hours for select to authenticated using (app.can_read_design_job(design_job_id)
  and app.has_role('gm', 'design_manager', 'lighting_designer', 'lighting_engineer'));

create policy est_jobs_read on public.estimation_jobs for select to authenticated using (app.can_read_estimation_job(id));
create policy est_costing_read on public.estimation_costing for select to authenticated using (app.can_read_costing(estimation_job_id));
create policy quotations_read on public.quotations for select to authenticated using (app.can_read_inquiry(inquiry_id)
  and not app.has_role('design_manager', 'lighting_designer', 'lighting_engineer'));
create policy clarifications_read on public.clarifications for select to authenticated using (
  app.can_read_inquiry(inquiry_id) and app.has_role('gm', 'design_manager', 'lighting_designer', 'lighting_engineer',
                                                    'sm_estimation', 'am_estimation', 'estimation_exec'));

create policy sla_clocks_read on public.sla_clocks for select to authenticated using (
  owner_id = auth.uid() or app.has_role('gm')
  or (inquiry_id is not null and app.can_read_inquiry(inquiry_id)
      and (entity_type in ('inquiry', 'approval')
           or (entity_type = 'design_job' and app.has_role('design_manager', 'lighting_designer', 'lighting_engineer', 'sm_projects', 'asm_building', 'asm_infra'))
           or (entity_type = 'estimation_job' and app.has_role('sm_estimation', 'am_estimation', 'estimation_exec', 'sm_projects', 'asm_building', 'asm_infra')))));

-- Debtors: sales own, SM Projects and GM all, Operations all; design/estimation none (12.7)
create policy debts_read on public.debts for select to authenticated
  using (sales_person_id = auth.uid() or app.has_role('gm', 'sm_projects', 'operations_exec'));
create policy debt_log_read on public.debt_log for select to authenticated
  using (exists (select 1 from public.debts d where d.id = debt_id));
create policy debt_uploads_read on public.debt_uploads for select to authenticated using (app.has_role('gm', 'sm_projects', 'operations_exec'));
create policy debt_upload_rows_read on public.debt_upload_rows for select to authenticated using (app.has_role('gm', 'sm_projects', 'operations_exec'));
create policy debt_snapshots_read on public.debt_snapshots for select to authenticated using (app.has_role('gm', 'sm_projects', 'operations_exec'));

-- Samples: sales own, SM Projects / GM / Operations all
create policy samples_read on public.samples for select to authenticated
  using (sales_person_id = auth.uid() or app.has_role('gm', 'sm_projects', 'operations_exec'));
create policy samples_insert on public.samples for insert to authenticated with check (app.is_sales_person() and sales_person_id = auth.uid());
create policy samples_update on public.samples for update to authenticated
  using (sales_person_id = auth.uid() and status in ('draft', 'returned_for_changes'));
create policy sample_items_read on public.sample_items for select to authenticated using (exists (select 1 from public.samples s where s.id = sample_id));
create policy sample_items_write on public.sample_items for all to authenticated
  using (exists (select 1 from public.samples s where s.id = sample_id and s.sales_person_id = auth.uid() and s.status in ('draft', 'returned_for_changes')))
  with check (exists (select 1 from public.samples s where s.id = sample_id and s.sales_person_id = auth.uid() and s.status in ('draft', 'returned_for_changes')));

-- Views run with the caller's rights
alter view public.tender_rankings set (security_invoker = true);

-- Internal schema is not callable directly
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
revoke execute on function public.sla_tick() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private "files" bucket (50 MB) and "avatars" bucket (5 MB, JPG/PNG)
-- Object path convention for files: <entity_type>/<entity_id>/<uuid>-<file name>
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('files', 'files', false, 52428800, null),
           ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png'])
    on conflict (id) do nothing;

    execute $p$create policy files_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'files' and app.can_write_attachment(split_part(name, '/', 1), split_part(name, '/', 2)::uuid, null))$p$;
    execute $p$create policy files_read on storage.objects for select to authenticated using (
      bucket_id = 'files' and exists (select 1 from public.attachments a where a.storage_path = name and app.can_read_attachment(a)))$p$;
    execute $p$create policy avatars_read on storage.objects for select to authenticated using (bucket_id = 'avatars')$p$;
    execute $p$create policy avatars_write on storage.objects for insert to authenticated with check (
      bucket_id = 'avatars' and (split_part(name, '/', 1) = auth.uid()::text or app.has_role('sys_admin')))$p$;
    execute $p$create policy avatars_update on storage.objects for update to authenticated using (
      bucket_id = 'avatars' and (split_part(name, '/', 1) = auth.uid()::text or app.has_role('sys_admin')))$p$;
    execute $p$create policy avatars_delete on storage.objects for delete to authenticated using (
      bucket_id = 'avatars' and (split_part(name, '/', 1) = auth.uid()::text or app.has_role('sys_admin')))$p$;
  end if;
end $$;

-- Realtime: pending lists and notification badges update live (6.5)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.inquiries, public.design_jobs, public.estimation_jobs;
  end if;
end $$;
