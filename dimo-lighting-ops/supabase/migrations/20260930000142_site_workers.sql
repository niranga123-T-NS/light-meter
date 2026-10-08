-- Site workers register per project.
--  * Subcontractor supervisors add their own company's workers; Assistant Engineers add DIMO labour and workers of a
--    subcontractor without a supervisor on the app; the Senior Electrical Engineer can add or correct any.
--  * Name, address, nearest police station, NIC / passport number with both sides photographed, mobile, trade and an
--    emergency contact. One record per ID per project; earlier projects fill the details.
--  * An Assistant Engineer verifies the person against the ID photos, then inducts them (HSE induction register IR-01).
--  * Personal data: only the project's Assistant Engineers, the Senior Electrical Engineer, SM Projects and the supervisor
--    of that crew see a worker and the ID photos.

create table if not exists public.exec_workers (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  company text not null,
  supervisor_id uuid references public.profiles (id),
  full_name text not null,
  address text not null,
  police_station text not null,
  id_type text not null default 'nic' check (id_type in ('nic', 'passport')),
  id_no text not null,
  mobile text,
  trade text,
  emergency_name text,
  emergency_phone text,
  status text not null default 'active' check (status in ('active', 'off_site')),
  off_site_on date,
  off_site_reason text,
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  induction_id uuid references public.hse_inductions (id),
  added_by uuid not null default auth.uid() references public.profiles (id),
  added_at timestamptz not null default now(),
  unique (exec_project_id, id_no)
);
create index if not exists exec_workers_project on public.exec_workers (exec_project_id, status);

create or replace function app.can_see_worker(w public.exec_workers) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer', 'sm_projects')
      or app.is_project_ae(w.exec_project_id)
      or w.added_by = auth.uid() or w.supervisor_id = auth.uid()
$$;
alter table public.exec_workers enable row level security;
drop policy if exists exec_workers_read on public.exec_workers;
create policy exec_workers_read on public.exec_workers for select to authenticated using (app.can_see_worker(exec_workers));
grant select on public.exec_workers to authenticated;

create or replace function app.norm_id(p text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[\s-]', '', 'g'))
$$;

create or replace function public.save_worker(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  w public.exec_workers; wid uuid := nullif(p ->> 'id', '')::uuid; t text := coalesce(nullif(p ->> 'id_type', ''), 'nic');
  idn text := app.norm_id(p ->> 'id_no'); sup boolean := app.has_role('sub_supervisor'); co text; sv uuid; prev public.exec_workers;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec) or (sup and app.is_exec_member(p_exec)),
    'Only the subcontractor supervisor or an Assistant Engineer of the project adds workers');
  perform app.require(coalesce(btrim(p ->> 'full_name'), '') <> '', 'Enter the full name');
  perform app.require(coalesce(btrim(p ->> 'address'), '') <> '', 'Enter the address');
  perform app.require(coalesce(btrim(p ->> 'police_station'), '') <> '', 'Enter the nearest police station');
  perform app.require(t in ('nic', 'passport'), 'Choose NIC or passport');
  if t = 'nic' then
    perform app.require(idn ~ '^([0-9]{9}[VX]|[0-9]{12})$', 'Enter a valid NIC number (9 digits + V/X, or 12 digits)');
  else
    perform app.require(idn ~ '^[A-Z0-9]{6,12}$', 'Enter the passport number (6–12 letters and digits)');
  end if;
  if sup then
    co := coalesce((select company from public.profiles where id = auth.uid()), btrim(p ->> 'company'));
    sv := auth.uid();
  else
    co := btrim(p ->> 'company');
    sv := nullif(p ->> 'supervisor_id', '')::uuid;
    perform app.require(sv is null or exists (select 1 from public.exec_members m where m.exec_project_id = p_exec and m.user_id = sv and m.active and m.member_role = 'sub_supervisor'),
      'Choose a subcontractor supervisor of this project');
    if sv is not null then co := coalesce(nullif(co, ''), (select company from public.profiles where id = sv)); end if;
  end if;
  perform app.require(coalesce(co, '') <> '', 'Enter the company (subcontractor, or DIMO for own labour)');
  select * into prev from public.exec_workers x where x.exec_project_id = p_exec and x.id_no = idn and (wid is null or x.id <> wid);
  perform app.require(prev.id is null, format('%s (%s) is already on this project''s worker list', prev.full_name, idn));
  if wid is null then
    insert into public.exec_workers (exec_project_id, company, supervisor_id, full_name, address, police_station, id_type, id_no, mobile, trade, emergency_name, emergency_phone)
    values (p_exec, co, sv, btrim(p ->> 'full_name'), btrim(p ->> 'address'), btrim(p ->> 'police_station'), t, idn, nullif(btrim(p ->> 'mobile'), ''),
            nullif(btrim(p ->> 'trade'), ''), nullif(btrim(p ->> 'emergency_name'), ''), nullif(btrim(p ->> 'emergency_phone'), ''))
    returning id into wid;
    if sup then
      perform app.notify_many(app.project_aes(p_exec), 'exec_worker', 'New worker to verify – ' || btrim(p ->> 'full_name'),
        format('%s · %s · added by %s · check the ID photos and induct', co, app.exec_head(p_exec), app.display_name(auth.uid())),
        'normal', 'exec_project', p_exec, '/execution/worker/' || wid);
    end if;
  else
    select * into w from public.exec_workers where id = wid and exec_project_id = p_exec for update;
    perform app.require(w.id is not null, 'Worker not found');
    perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec) or (w.added_by = auth.uid() and w.verified_at is null),
      'Once verified, only an Assistant Engineer or the Senior Electrical Engineer changes the details');
    update public.exec_workers set company = co, supervisor_id = sv, full_name = btrim(p ->> 'full_name'), address = btrim(p ->> 'address'),
      police_station = btrim(p ->> 'police_station'), id_type = t, id_no = idn, mobile = nullif(btrim(p ->> 'mobile'), ''), trade = nullif(btrim(p ->> 'trade'), ''),
      emergency_name = nullif(btrim(p ->> 'emergency_name'), ''), emergency_phone = nullif(btrim(p ->> 'emergency_phone'), ''),
      verified_by = case when idn <> w.id_no then null else verified_by end, verified_at = case when idn <> w.id_no then null else verified_at end
    where id = w.id;
  end if;
  return wid;
end $$;

-- Details from an earlier DIMO project (same ID) to fill the form
create or replace function public.worker_lookup(p_id_no text) returns table (full_name text, address text, police_station text, id_type text, mobile text, trade text,
  emergency_name text, emergency_phone text, company text, project text, added_at timestamptz)
language sql stable security definer set search_path = public as $$
  select w.full_name, w.address, w.police_station, w.id_type, w.mobile, w.trade, w.emergency_name, w.emergency_phone, w.company, app.exec_head(w.exec_project_id), w.added_at
    from public.exec_workers w
   where w.id_no = app.norm_id(p_id_no)
     and (app.has_role('senior_elec_engineer', 'sm_projects', 'assistant_engineer')
          or (app.has_role('sub_supervisor') and lower(w.company) = lower(coalesce((select company from public.profiles where id = auth.uid()), ''))))
   order by w.added_at desc limit 1
$$;

create or replace function public.verify_worker(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w public.exec_workers;
begin
  select * into w from public.exec_workers where id = p_id for update;
  perform app.require(w.id is not null, 'Worker not found');
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(w.exec_project_id), 'An Assistant Engineer of the project verifies workers');
  perform app.require(app.has_attachment('exec_worker', w.id, 'id_front') and app.has_attachment('exec_worker', w.id, 'id_back'),
    format('Add the photos of both sides of the %s first', case when w.id_type = 'nic' then 'NIC' else 'passport' end));
  update public.exec_workers set verified_by = auth.uid(), verified_at = now() where id = w.id;
end $$;

create or replace function public.induct_worker(p_id uuid, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare w public.exec_workers; iid uuid;
begin
  select * into w from public.exec_workers where id = p_id for update;
  perform app.require(w.id is not null and w.status = 'active', 'Worker not found or off site');
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(w.exec_project_id), 'An Assistant Engineer of the project gives the induction');
  perform app.require(w.verified_at is not null, 'Verify the worker against the ID photos first');
  perform app.require(w.induction_id is null, 'Already inducted');
  select id into iid from public.hse_inductions where exec_project_id = w.exec_project_id and nic = w.id_no;
  if iid is null then
    insert into public.hse_inductions (exec_project_id, inducted_on, name, nic, company, instructor_id)
    values (w.exec_project_id, coalesce(p_date, (now() at time zone app.tz())::date), w.full_name, w.id_no, w.company, auth.uid())
    returning id into iid;
  end if;
  update public.exec_workers set induction_id = iid where id = w.id;
  return iid;
end $$;

create or replace function public.set_worker_off_site(p_id uuid, p_date date, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare w public.exec_workers;
begin
  select * into w from public.exec_workers where id = p_id for update;
  perform app.require(w.id is not null and w.status = 'active', 'Worker not found or already off site');
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(w.exec_project_id) or w.supervisor_id = auth.uid(),
    'The supervisor of the crew or an Assistant Engineer marks workers off site');
  update public.exec_workers set status = 'off_site', off_site_on = coalesce(p_date, (now() at time zone app.tz())::date), off_site_reason = nullif(btrim(p_reason), '') where id = w.id;
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
  when 'retention' then return app.can_edit_retention(p_entity_id);
  when 'bond' then return r = 'operations_exec' and exists (select 1 from public.bonds where id = p_entity_id);
  when 'warranty' then return app.is_warranty_desk() and exists (select 1 from public.warranties where id = p_entity_id);
  when 'warranty_claim' then
    return exists (select 1 from public.warranty_claims c where c.id = p_entity_id and (app.is_warranty_desk() or c.assignee_id = auth.uid()));
  when 'warranty_report' then
    return exists (select 1 from public.warranty_reports x where x.id = p_entity_id and (x.sales_person_id = auth.uid() or app.is_warranty_desk()));
  when 'rma' then return app.is_warranty_desk() and exists (select 1 from public.manufacturer_claims where id = p_entity_id);
  when 'warranty_registration' then return app.is_warranty_desk() and exists (select 1 from public.warranty_registrations where id = p_entity_id);
  when 'eng_job' then
    return exists (select 1 from public.eng_jobs where id = p_entity_id and (assignee_id = auth.uid() or app.is_eng_lead()));
  when 'eng_job_update' then
    return exists (select 1 from public.eng_job_updates u join public.eng_jobs j on j.id = u.job_id
                   where u.id = p_entity_id and (j.assignee_id = auth.uid() or app.is_eng_lead()));
  when 'exec_report' then
    return exists (select 1 from public.exec_reports x where x.id = p_entity_id and x.author_id = auth.uid() and x.status in ('submitted', 'returned'));
  when 'exec_worker' then
    return exists (select 1 from public.exec_workers x where x.id = p_entity_id and (app.has_role('senior_elec_engineer') or app.is_project_ae(x.exec_project_id)
      or (x.added_by = auth.uid() and x.verified_at is null)));
  when 'hse_record' then
    return exists (select 1 from public.hse_records x where x.id = p_entity_id and (app.is_exec_member(x.exec_project_id) or app.has_role('senior_elec_engineer')));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = p_entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
      or exists (select 1 from public.hse_actions a where a.report_id = x.id and a.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = p_entity_id and (x.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects')));
  when 'material_request' then
    return exists (select 1 from public.material_requests x where x.id = p_entity_id and app.is_exec_internal(x.exec_project_id) and not app.has_role('gm'))
      -- the supervisor who raised the request or acknowledges its delivery: delivery notes and photos
      or (r = 'sub_supervisor' and app.can_read_mr(p_entity_id) and (p_kind is null or p_kind in ('mr_doc', 'grn_photo')));
  when 'exec_doc' then
    return exists (select 1 from public.exec_docs x where x.id = p_entity_id and x.uploaded_by = auth.uid());
  when 'design_query' then
    return exists (select 1 from public.design_queries x where x.id = p_entity_id
      and (x.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'design_manager', 'lighting_designer', 'lighting_engineer')));
  when 'snag' then
    return exists (select 1 from public.snags x where x.id = p_entity_id and (app.has_role('senior_elec_engineer') or app.is_project_ae(x.exec_project_id)));
  when 'dossier_item' then
    return exists (select 1 from public.exec_dossier x where x.id = p_entity_id and (app.has_role('senior_elec_engineer', 'operations_exec') or app.is_project_ae(x.exec_project_id)));
  when 'test_record' then
    return exists (select 1 from public.test_records x where x.id = p_entity_id and (x.performed_by = auth.uid() or app.has_role('senior_elec_engineer')));
  when 'instrument' then
    return app.has_role('senior_elec_engineer', 'operations_exec', 'sm_projects');
  when 'sub_cert' then
    return exists (select 1 from public.sub_certs x where x.id = p_entity_id and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer', 'operations_exec')));
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = p_entity_id and ((x.requested_by = auth.uid() and x.status = 'pending_smp') or app.has_role('sm_projects')));
  else return false;
  end case;
end $$;

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
    return exists (select 1 from public.exec_reports x where x.id = a.entity_id and (x.author_id = auth.uid() or app.is_exec_internal(x.exec_project_id)));
  when 'exec_worker' then
    return exists (select 1 from public.exec_workers x where x.id = a.entity_id and app.can_see_worker(x));
  when 'hse_record' then
    return exists (select 1 from public.hse_records x where x.id = p_entity_id and app.can_read_exec(x.exec_project_id));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = a.entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
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
      and (app.is_exec_internal(x.exec_project_id) or r in ('design_manager', 'lighting_designer', 'lighting_engineer')));
  when 'snag' then
    return exists (select 1 from public.snags x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
  when 'dossier_item' then
    return exists (select 1 from public.exec_dossier x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
  when 'test_record' then
    return exists (select 1 from public.test_records x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
  when 'instrument' then
    return r <> 'sub_supervisor';
  when 'sub_cert' then
    return exists (select 1 from public.sub_certs x where x.id = a.entity_id and (r in ('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec') or x.prepared_by = auth.uid()));
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = a.entity_id
      and (r in ('sm_projects', 'gm', 'operations_exec', 'senior_elec_engineer') or x.requested_by = auth.uid() or (x.exec_project_id is not null and app.is_exec_internal(x.exec_project_id))));
  else
    return r = 'gm';
  end case;
end $$;

revoke execute on function public.save_worker(uuid, jsonb) from public, anon;
grant execute on function public.save_worker(uuid, jsonb) to authenticated, service_role;
revoke execute on function public.worker_lookup(text) from public, anon;
grant execute on function public.worker_lookup(text) to authenticated, service_role;
revoke execute on function public.verify_worker(uuid) from public, anon;
grant execute on function public.verify_worker(uuid) to authenticated, service_role;
revoke execute on function public.induct_worker(uuid, date) from public, anon;
grant execute on function public.induct_worker(uuid, date) to authenticated, service_role;
revoke execute on function public.set_worker_off_site(uuid, date, text) from public, anon;
grant execute on function public.set_worker_off_site(uuid, date, text) to authenticated, service_role;
