-- Subcontractor invoices: recorded in the system for reference and alerts only – the physical documents go to the DIMO
-- Lighting Solutions office for processing. An invoice is recorded against the subcontractor's verified payment certificate
-- (IPC and measurement sheets) by the subcontractor supervisor, or by the project's Assistant Engineer when no supervisor is
-- appointed, with a copy (PDF / photos). The Senior Electrical Engineer approves, then the Operations Executive; once
-- approved the submitter is told to bring the physical documents. Either may return it with comments written in red on the
-- copy (a marked-up PDF kept with the invoice); the submitter corrects and records it again. Operations records when the
-- physical documents are received.

create table if not exists public.sub_invoices (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  sub_cert_id uuid not null references public.sub_certs (id),
  subcontractor text not null,
  invoice_no text not null,
  invoice_date date not null,
  amount numeric(16, 2) not null check (amount > 0),
  note text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'see_approved', 'approved', 'returned', 'docs_received', 'cancelled')),
  revision int not null default 0,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  see_by uuid references public.profiles (id),
  see_at timestamptz,
  ops_by uuid references public.profiles (id),
  ops_at timestamptz,
  returned_by uuid references public.profiles (id),
  returned_at timestamptz,
  return_note text,
  docs_received_by uuid references public.profiles (id),
  docs_received_at timestamptz,
  docs_note text
);
create index if not exists sub_invoices_project on public.sub_invoices (exec_project_id);
create index if not exists sub_invoices_cert on public.sub_invoices (sub_cert_id);

create table if not exists public.sub_invoice_log (
  id bigint generated always as identity primary key,
  invoice_id uuid not null references public.sub_invoices (id) on delete cascade,
  at timestamptz not null default now(),
  by uuid default auth.uid() references public.profiles (id),
  action text not null,
  note text
);

-- Who records invoices on a project: its subcontractor supervisors and Assistant Engineers (and the SEE)
create or replace function app.can_record_sub_invoice(p_exec uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec)
      or (app.has_role('sub_supervisor') and exists (select 1 from public.exec_members m where m.exec_project_id = p_exec and m.user_id = auth.uid()
                                                     and m.member_role = 'sub_supervisor' and m.active))
$$;
create or replace function app.can_read_sub_invoice(p_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sub_invoices x where x.id = p_id
                  and (x.created_by = auth.uid() or app.has_role('senior_elec_engineer', 'operations_exec', 'sm_projects', 'gm') or app.is_project_ae(x.exec_project_id)))
$$;

alter table public.sub_invoices enable row level security;
alter table public.sub_invoice_log enable row level security;
drop policy if exists sub_invoices_read on public.sub_invoices;
create policy sub_invoices_read on public.sub_invoices for select to authenticated using (app.can_read_sub_invoice(id));
drop policy if exists sub_invoice_log_read on public.sub_invoice_log;
create policy sub_invoice_log_read on public.sub_invoice_log for select to authenticated using (app.can_read_sub_invoice(invoice_id));
grant select on public.sub_invoices, public.sub_invoice_log to authenticated;

-- Payment certificates an invoice can be recorded against: verified (or later) on the project
create or replace function public.sub_invoice_certs(p_exec uuid)
returns table (id uuid, code text, subcontractor text, period text, net numeric, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.can_record_sub_invoice(p_exec), 'Not allowed');
  return query select c.id, c.code, c.subcontractor, c.period, c.net, c.status from public.sub_certs c
    where c.exec_project_id = p_exec and c.status in ('verified', 'approved', 'paid') order by c.prepared_at desc;
end $$;

-- A new invoice record (draft until its copy is attached and it is submitted)
create or replace function public.create_sub_invoice(p_cert uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; iid uuid;
begin
  select * into c from public.sub_certs where id = p_cert;
  perform app.require(c.id is not null, 'Payment certificate not found');
  perform app.require(app.can_record_sub_invoice(c.exec_project_id), 'Only the project''s subcontractor supervisor or Assistant Engineer records invoices');
  perform app.require(c.status in ('verified', 'approved', 'paid'), 'The payment certificate (IPC and measurement sheets) must be verified by the Senior Electrical Engineer first');
  perform app.require(coalesce(btrim(p ->> 'invoice_no'), '') <> '', 'Enter the invoice number');
  perform app.require(nullif(p ->> 'invoice_date', '') is not null, 'Enter the invoice date');
  perform app.require(coalesce(nullif(replace(p ->> 'amount', ',', ''), '')::numeric, 0) > 0, 'Enter the invoice amount');
  insert into public.sub_invoices (code, exec_project_id, sub_cert_id, subcontractor, invoice_no, invoice_date, amount, note)
  values (app.next_code('SINV'), c.exec_project_id, c.id, c.subcontractor, btrim(p ->> 'invoice_no'), (p ->> 'invoice_date')::date,
          replace(p ->> 'amount', ',', '')::numeric, nullif(btrim(p ->> 'note'), ''))
  returning id into iid;
  insert into public.sub_invoice_log (invoice_id, action) values (iid, 'created');
  return iid;
end $$;

-- Submit (or resubmit after a return): the copy must be attached
create or replace function public.submit_sub_invoice(p_id uuid, p jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v public.sub_invoices; head text;
begin
  select * into v from public.sub_invoices where id = p_id for update;
  perform app.require(v.id is not null, 'Invoice not found');
  perform app.require(v.created_by = auth.uid() or (app.can_record_sub_invoice(v.exec_project_id) and not app.has_role('sub_supervisor')), 'Only who recorded it submits it');
  perform app.require(v.status in ('draft', 'returned'), 'Already submitted');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_invoice' and a.entity_id = v.id and a.kind = 'sinv_doc'),
    'Attach the invoice copy (PDF or photos)');
  update public.sub_invoices set status = 'submitted', submitted_at = now(), revision = revision + case when status = 'returned' then 1 else 0 end,
    invoice_no = coalesce(nullif(btrim(p ->> 'invoice_no'), ''), invoice_no), amount = coalesce(nullif(replace(p ->> 'amount', ',', ''), '')::numeric, amount),
    note = coalesce(nullif(btrim(p ->> 'note'), ''), note)
   where id = v.id returning * into v;
  insert into public.sub_invoice_log (invoice_id, action, note) values (v.id, case when v.revision > 0 then 'resubmitted' else 'submitted' end, nullif(btrim(p ->> 'note'), ''));
  head := format('%s · %s · invoice %s · %s', v.code, v.subcontractor, v.invoice_no, app.fmt_money(v.amount, 'LKR'));
  perform app.notify(v.created_by, 'sub_invoice', 'Invoice recorded – for reference only',
    head || E'\nThis submission is for recording purposes only. The physical documents must be submitted to the DIMO Lighting Solutions office for processing – you will be told here when they can be submitted (after the Senior Electrical Engineer and Operations approve).',
    'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
  perform app.notify_many(app.role_users('senior_elec_engineer'), 'sub_invoice', 'Subcontractor invoice to approve', head || ' · ' || app.exec_head(v.exec_project_id),
    'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
end $$;

-- SEE, then Operations: approve, or return with comments (marked on the copy)
create or replace function public.decide_sub_invoice(p_id uuid, p_ok boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v public.sub_invoices; nxt text; head text;
begin
  select * into v from public.sub_invoices where id = p_id for update;
  perform app.require(v.id is not null, 'Invoice not found');
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Give the reason – and mark the comments on the copy');
  head := format('%s · %s · invoice %s · %s', v.code, v.subcontractor, v.invoice_no, app.fmt_money(v.amount, 'LKR'));
  if v.status = 'submitted' then
    perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer approves first');
    if p_ok then
      update public.sub_invoices set status = 'see_approved', see_by = auth.uid(), see_at = now() where id = v.id;
      perform app.notify_many(app.role_users('operations_exec'), 'sub_invoice', 'Subcontractor invoice to approve', head || ' · approved by the SEE',
        'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
      nxt := 'see_approved';
    end if;
  elsif v.status = 'see_approved' then
    perform app.require(app.has_role('operations_exec'), 'The Operations Executive approves');
    if p_ok then
      update public.sub_invoices set status = 'approved', ops_by = auth.uid(), ops_at = now() where id = v.id;
      perform app.notify(v.created_by, 'sub_invoice', 'Approved – submit the physical documents',
        head || E'\nApproved by the Senior Electrical Engineer and Operations. Submit the original invoice with the IPC and measurement sheets to the DIMO Lighting Solutions office for processing.'
          || coalesce(E'\nNote: ' || nullif(btrim(p_note), ''), ''),
        'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
      nxt := 'approved';
    end if;
  else
    perform app.require(false, 'Not waiting for approval');
  end if;
  if not p_ok then
    update public.sub_invoices set status = 'returned', returned_by = auth.uid(), returned_at = now(), return_note = btrim(p_note) where id = v.id;
    perform app.notify(v.created_by, 'sub_invoice', 'Invoice returned with comments',
      head || E'\n' || btrim(p_note) || E'\nSee the comments marked in red on the copy, correct and submit again. Do not send the physical documents yet.',
      'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
    nxt := 'returned';
  end if;
  insert into public.sub_invoice_log (invoice_id, action, note) values (v.id, case when p_ok then 'approved_' || nxt else 'returned' end, nullif(btrim(p_note), ''));
  return nxt;
end $$;

-- Operations: physical documents received at the office
create or replace function public.receive_sub_invoice_docs(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.sub_invoices;
begin
  perform app.require(app.has_role('operations_exec'), 'Operations records the documents');
  select * into v from public.sub_invoices where id = p_id for update;
  perform app.require(v.id is not null and v.status = 'approved', 'Only an approved invoice');
  update public.sub_invoices set status = 'docs_received', docs_received_by = auth.uid(), docs_received_at = now(), docs_note = nullif(btrim(p_note), '') where id = v.id;
  insert into public.sub_invoice_log (invoice_id, action, note) values (v.id, 'docs_received', nullif(btrim(p_note), ''));
  perform app.notify(v.created_by, 'sub_invoice', 'Physical documents received', format('%s · invoice %s – received at the DIMO Lighting Solutions office', v.code, v.invoice_no),
    'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id);
end $$;

-- Withdraw a draft or returned record
create or replace function public.cancel_sub_invoice(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.sub_invoices;
begin
  select * into v from public.sub_invoices where id = p_id for update;
  perform app.require(v.id is not null and v.status in ('draft', 'returned'), 'Only a draft or returned invoice can be withdrawn');
  perform app.require(v.created_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Not allowed');
  update public.sub_invoices set status = 'cancelled' where id = v.id;
  insert into public.sub_invoice_log (invoice_id, action, note) values (v.id, 'cancelled', nullif(btrim(p_reason), ''));
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
    return exists (select 1 from public.hse_records x where x.id = a.entity_id and app.can_read_exec(x.exec_project_id));
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
  when 'sub_invoice' then
    return app.can_read_sub_invoice(a.entity_id);
  when 'sub_cert' then
    return exists (select 1 from public.sub_certs x where x.id = a.entity_id and (r in ('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec') or x.prepared_by = auth.uid()));
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = a.entity_id
      and (r in ('sm_projects', 'gm', 'operations_exec', 'senior_elec_engineer') or x.requested_by = auth.uid() or (x.exec_project_id is not null and app.is_exec_internal(x.exec_project_id))));
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
      or (x.added_by = auth.uid() and x.verified_at is null)
      -- the crew's supervisor uploads the police report (storage checks without a kind)
      or ((p_kind is null or p_kind = 'police_report') and (x.supervisor_id = auth.uid() or x.added_by = auth.uid()))));
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
  when 'sub_invoice' then
    -- the copy: who recorded it, while a draft or returned · the marked-up copy: the SEE / Operations while it waits for them
    return exists (select 1 from public.sub_invoices x where x.id = p_entity_id and (
      ((p_kind is null or p_kind = 'sinv_doc') and x.status in ('draft', 'returned')
        and (x.created_by = auth.uid() or (app.can_record_sub_invoice(x.exec_project_id) and not app.has_role('sub_supervisor'))))
      or ((p_kind is null or p_kind = 'sinv_markup') and ((x.status = 'submitted' and app.has_role('senior_elec_engineer'))
                                                          or (x.status = 'see_approved' and app.has_role('operations_exec'))))));
  when 'sub_cert' then
    return exists (select 1 from public.sub_certs x where x.id = p_entity_id and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer', 'operations_exec')));
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = p_entity_id and ((x.requested_by = auth.uid() and x.status = 'pending_smp') or app.has_role('sm_projects')));
  else return false;
  end case;
end $$;

revoke execute on function public.sub_invoice_certs(uuid), public.create_sub_invoice(uuid, jsonb), public.submit_sub_invoice(uuid, jsonb),
  public.decide_sub_invoice(uuid, boolean, text), public.receive_sub_invoice_docs(uuid, text), public.cancel_sub_invoice(uuid, text) from public, anon;
grant execute on function public.sub_invoice_certs(uuid), public.create_sub_invoice(uuid, jsonb), public.submit_sub_invoice(uuid, jsonb),
  public.decide_sub_invoice(uuid, boolean, text), public.receive_sub_invoice_docs(uuid, text), public.cancel_sub_invoice(uuid, text) to authenticated, service_role;
