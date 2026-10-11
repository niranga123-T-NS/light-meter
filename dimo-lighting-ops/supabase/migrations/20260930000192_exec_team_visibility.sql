-- Execution data is shown only to the people who need it.
-- The Operations Executive works with an execution project's materials, handover dossier, documents,
-- subcontractor IPCs / invoices and billing – not with its programme, plans, daily reports, check-ins,
-- HSE (permits, inductions, equipment), QA / NCRs, snags or design queries. Those are now read by the
-- execution team only: the SEE, SM Projects, the GM and the project's own AEs / trainees
-- (subcontractor supervisors keep their own rows as before).

create or replace function app.is_exec_team(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer', 'sm_projects', 'gm')
      or (app.has_role('assistant_engineer', 'trainee') and app.is_exec_member(p_exec))
$$;

-- Like can_read_exec, without the Operations Executive (used for HSE)
create or replace function app.can_read_exec_team(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer', 'sm_projects', 'gm') or app.is_exec_member(p_exec)
$$;

drop policy if exists exec_plans_read on public.exec_plans;
create policy exec_plans_read on public.exec_plans for select to authenticated using (app.is_exec_team(exec_project_id));

drop policy if exists exec_programmes_read on public.exec_programmes;
create policy exec_programmes_read on public.exec_programmes for select to authenticated using (app.is_exec_team(exec_project_id));

drop policy if exists exec_wbs_read on public.exec_wbs;
create policy exec_wbs_read on public.exec_wbs for select to authenticated using (app.is_exec_team(exec_project_id));

drop policy if exists exec_baselines_read on public.exec_baselines;
create policy exec_baselines_read on public.exec_baselines for select to authenticated using (app.is_exec_team(exec_project_id));

drop policy if exists exec_progress_snapshots_read on public.exec_progress_snapshots;
create policy exec_progress_snapshots_read on public.exec_progress_snapshots for select to authenticated using (app.is_exec_team(exec_project_id));

drop policy if exists snags_read on public.snags;
create policy snags_read on public.snags for select to authenticated using (app.is_exec_team(exec_project_id));

drop policy if exists test_records_read on public.test_records;
create policy test_records_read on public.test_records for select to authenticated using (app.is_exec_team(exec_project_id));

drop policy if exists exec_activity_deps_read on public.exec_activity_deps;
create policy exec_activity_deps_read on public.exec_activity_deps for select to authenticated
  using (exists (select 1 from public.exec_activities a where a.id = exec_activity_deps.succ_id and app.is_exec_team(a.exec_project_id)));
drop policy if exists exec_activity_resources_read on public.exec_activity_resources;
create policy exec_activity_resources_read on public.exec_activity_resources for select to authenticated
  using (exists (select 1 from public.exec_activities a where a.id = exec_activity_resources.activity_id and app.is_exec_team(a.exec_project_id)));
drop policy if exists exec_plan_items_read on public.exec_plan_items;
create policy exec_plan_items_read on public.exec_plan_items for select to authenticated
  using (app.is_exec_team(exec_project_id) or (app.is_exec_member(exec_project_id) and (supervisor_id = auth.uid() or added_by = auth.uid())));
drop policy if exists exec_reports_read on public.exec_reports;
create policy exec_reports_read on public.exec_reports for select to authenticated using (author_id = auth.uid() or app.is_exec_team(exec_project_id));
drop policy if exists site_checkins_read on public.site_checkins;
create policy site_checkins_read on public.site_checkins for select to authenticated using (user_id = auth.uid() or app.is_exec_team(exec_project_id));
drop policy if exists ncrs_read on public.ncrs;
create policy ncrs_read on public.ncrs for select to authenticated using (app.is_exec_team(exec_project_id) or owner_id = auth.uid());
drop policy if exists qa_reports_read on public.qa_reports;
create policy qa_reports_read on public.qa_reports for select to authenticated
  using (created_by = auth.uid() or (status <> 'draft' and app.is_exec_team(exec_project_id)));
drop policy if exists design_queries_read on public.design_queries;
create policy design_queries_read on public.design_queries for select to authenticated
  using (app.is_exec_team(exec_project_id) or (status <> 'raised' and app.has_role('design_manager', 'lighting_designer', 'lighting_engineer')));
drop policy if exists hse_inductions_read on public.hse_inductions;
create policy hse_inductions_read on public.hse_inductions for select to authenticated
  using (app.can_read_exec_team(exec_project_id) and (not app.is_sub() or instructor_id = auth.uid() or app.is_own_or_dimo(company)));

-- HSE reports, permits / forms and equipment: execution team only

CREATE OR REPLACE FUNCTION app.can_read_hse(p_report uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.hse_reports x where x.id = p_report and (x.reported_by = auth.uid() or app.is_exec_team(x.exec_project_id)
           or exists (select 1 from public.hse_actions a where a.report_id = x.id and a.assignee_id = auth.uid())))
$function$;



CREATE OR REPLACE FUNCTION app.can_see_hse_record(r hse_records)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select app.can_read_exec_team(r.exec_project_id) and (
    not app.is_sub() or r.created_by = auth.uid()
    or exists (select 1 from public.hse_records x where x.id = r.related_id and x.created_by = auth.uid())
    or (r.code not like 'PTW-%' and r.equipment_id is not null
        and exists (select 1 from public.hse_equipment e where e.id = r.equipment_id and (e.created_by = auth.uid() or app.is_own_or_dimo(e.contractor)))))
$function$;



CREATE OR REPLACE FUNCTION app.can_see_hse_equipment(e hse_equipment)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select app.can_read_exec_team(e.exec_project_id) and (not app.is_sub() or e.created_by = auth.uid() or app.is_own_or_dimo(e.contractor))
$function$;



CREATE OR REPLACE FUNCTION public.hse_summary(p_exec uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform app.require(app.can_read_exec_team(p_exec), 'Not allowed');
  return jsonb_build_object(
    'permits_waiting', (select count(*) from public.hse_records where exec_project_id = p_exec and code like 'PTW-%' and status = 'submitted'),
    'permits_active', (select count(*) from public.hse_records where exec_project_id = p_exec and code like 'PTW-%' and status = 'active'),
    'checks_due', (select count(*) from public.hse_equipment where exec_project_id = p_exec and status = 'in_use' and next_due <= (now() at time zone app.tz())::date),
    'removed', (select count(*) from public.hse_equipment where exec_project_id = p_exec and status = 'removed'),
    'inducted', (select count(*) from public.hse_inductions where exec_project_id = p_exec),
    'man_hours', (select coalesce(sum((header ->> 'man_hours')::numeric), 0) from public.hse_records where exec_project_id = p_exec and form_code = 'TR-01'),
    'can_ehs', app.is_ehs(p_exec),
    'can_permit', app.can_approve_permit(p_exec));
end $function$;



-- Attachments of daily reports, HSE, design queries, snags and tests follow the same rule

CREATE OR REPLACE FUNCTION app.can_read_attachment(a attachments)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.app_role := app.my_role(); inq uuid; st text; mode int; released timestamptz;
begin
  if r is null then return false; end if;
  if a.uploaded_by = auth.uid() then return true; end if;
  case a.entity_type
  when 'instrument' then
    return not app.is_sub();
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
    if r = 'sm_projects' and a.kind in ('quotation_draft', 'quotation_final', 'compliance_sheet', 'technical_data')
       and exists (select 1 from public.estimation_jobs where id = a.entity_id and needs_sm_projects) then
      return true;
    end if;
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
  when 'stock_snapshot' then
    return r in ('gm', 'sm_projects', 'operations_exec');
  when 'retention' then
    return exists (select 1 from public.retentions where id = a.entity_id);
  when 'bond' then
    return exists (select 1 from public.bonds where id = a.entity_id);
  when 'warranty' then
    return app.can_read_warranty(a.entity_id);
  when 'warranty_claim' then
    return exists (select 1 from public.warranty_claims where id = a.entity_id);
  when 'warranty_report' then
    return exists (select 1 from public.warranty_reports where id = a.entity_id);
  when 'rma' then
    return exists (select 1 from public.manufacturer_claims where id = a.entity_id);
  when 'warranty_registration' then
    return exists (select 1 from public.warranty_registrations where id = a.entity_id);
  when 'eng_job' then
    return app.can_read_eng_job(a.entity_id);
  when 'eng_job_update' then
    return exists (select 1 from public.eng_job_updates u where u.id = a.entity_id and app.can_read_eng_job(u.job_id));
  when 'exec_report' then
    return exists (select 1 from public.exec_reports x where x.id = a.entity_id and (x.author_id = auth.uid() or app.is_exec_team(x.exec_project_id)));
  when 'exec_worker' then
    return exists (select 1 from public.exec_workers x where x.id = a.entity_id and app.can_see_worker(x));
  when 'hse_record' then
    return exists (select 1 from public.hse_records x where x.id = a.entity_id and app.can_read_exec_team(x.exec_project_id));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = a.entity_id and (x.reported_by = auth.uid() or app.is_exec_team(x.exec_project_id)
      or exists (select 1 from public.hse_actions y where y.report_id = x.id and y.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = a.entity_id and (app.is_exec_internal(x.exec_project_id) or r = 'gm'));
  when 'material_request' then
    return app.can_read_mr(a.entity_id);
  when 'exec_doc' then
    return exists (select 1 from public.exec_docs x where x.id = a.entity_id and (r in ('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec', 'design_manager', 'lighting_designer', 'lighting_engineer')
      or (app.is_exec_member(x.exec_project_id) and x.status = 'for_construction' and (x.issued_to_subs or r <> 'sub_supervisor'))));
  when 'design_query' then
    return exists (select 1 from public.design_queries x where x.id = a.entity_id
      and (app.is_exec_team(x.exec_project_id) or r in ('design_manager', 'lighting_designer', 'lighting_engineer')));
  when 'snag' then
    return exists (select 1 from public.snags x where x.id = a.entity_id and app.is_exec_team(x.exec_project_id));
  when 'dossier_item' then
    return exists (select 1 from public.exec_dossier x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
  when 'test_record' then
    return exists (select 1 from public.test_records x where x.id = a.entity_id and app.is_exec_team(x.exec_project_id));
  when 'instrument' then
    return r <> 'sub_supervisor';
  when 'sub_invoice' then
    return app.can_read_sub_invoice(a.entity_id);
  when 'sub_cert_var' then
    return exists (select 1 from public.sub_cert_variations x where x.id = a.entity_id and app.can_read_sub_cert(x.sub_cert_id));
  when 'sub_invoice_var' then
    return exists (select 1 from public.sub_invoice_variations x where x.id = a.entity_id and app.can_read_sub_invoice(x.invoice_id));
  when 'exec_project' then
    return a.kind in ('tpl_measurement', 'tpl_ipa', 'tpl_ipc') and app.can_read_exec(a.entity_id);
  when 'sub_cert' then
    return app.can_read_sub_cert(a.entity_id);
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = a.entity_id
      and (r in ('sm_projects', 'gm', 'operations_exec', 'senior_elec_engineer') or x.requested_by = auth.uid() or (x.exec_project_id is not null and app.is_exec_internal(x.exec_project_id))));
  else
    return r = 'gm';
  end case;
end $function$;
