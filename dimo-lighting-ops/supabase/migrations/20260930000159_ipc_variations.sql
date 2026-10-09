-- Variations in an IPC: the preparer ticks the project's approved variations the IPC includes; each ticked variation's
-- IPC / measurement sheets are uploaded separately (one slot per variation) before the IPC can be submitted, and again –
-- IPA-approved, with signatures – with the invoice.

create table if not exists public.sub_cert_variations (
  id uuid primary key default gen_random_uuid(),
  sub_cert_id uuid not null references public.sub_certs (id) on delete cascade,
  variation_id uuid not null references public.variations (id),
  var_code text not null,
  var_title text not null,
  unique (sub_cert_id, variation_id)
);
create table if not exists public.sub_invoice_variations (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.sub_invoices (id) on delete cascade,
  cert_var_id uuid not null references public.sub_cert_variations (id) on delete cascade,
  var_code text not null,
  var_title text not null,
  unique (invoice_id, cert_var_id)
);
alter table public.sub_cert_variations enable row level security;
alter table public.sub_invoice_variations enable row level security;
drop policy if exists sub_cert_variations_read on public.sub_cert_variations;
create policy sub_cert_variations_read on public.sub_cert_variations for select to authenticated using (app.can_read_sub_cert(sub_cert_id));
drop policy if exists sub_invoice_variations_read on public.sub_invoice_variations;
create policy sub_invoice_variations_read on public.sub_invoice_variations for select to authenticated using (app.can_read_sub_invoice(invoice_id));
grant select on public.sub_cert_variations, public.sub_invoice_variations to authenticated;

-- The project's approved variations an IPC can include (and whether this IPC ticks them)
create or replace function public.sub_cert_variation_options(p_cert uuid)
returns table (id uuid, code text, vo_no text, title text, ticked boolean)
language plpgsql stable security definer set search_path = public as $$
declare c public.sub_certs;
begin
  select * into c from public.sub_certs where sub_certs.id = p_cert;
  perform app.require(c.id is not null and app.can_read_sub_cert(c.id), 'Not found');
  return query select v.id, v.code, v.vo_no, v.title, exists (select 1 from public.sub_cert_variations x where x.sub_cert_id = c.id and x.variation_id = v.id)
    from public.variations v where v.exec_project_id = c.exec_project_id and v.status in ('approved', 'client_accepted') order by v.code;
end $$;

-- Tick the variations the IPC includes (draft or returned only)
create or replace function public.set_sub_cert_variations(p_cert uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs;
begin
  select * into c from public.sub_certs where id = p_cert for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(c.status in ('draft', 'returned'), 'Only a draft or returned certificate can be changed');
  perform app.require(c.prepared_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Only who prepared it changes it');
  p_ids := coalesce(p_ids, '{}');
  perform app.require(not exists (select 1 from unnest(p_ids) i where not exists (select 1 from public.variations v where v.id = i
    and v.exec_project_id = c.exec_project_id and v.status in ('approved', 'client_accepted'))), 'Only approved variations of this project');
  delete from public.attachments a using public.sub_cert_variations x
   where x.sub_cert_id = c.id and not (x.variation_id = any (p_ids)) and a.entity_type = 'sub_cert_var' and a.entity_id = x.id;
  delete from public.sub_cert_variations where sub_cert_id = c.id and not (variation_id = any (p_ids));
  insert into public.sub_cert_variations (sub_cert_id, variation_id, var_code, var_title)
  select c.id, v.id, coalesce(nullif(v.vo_no, ''), v.code), v.title from public.variations v where v.id = any (p_ids)
  on conflict (sub_cert_id, variation_id) do nothing;
end $$;

create or replace function public.submit_sub_cert(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; aes uuid[]; by_sub boolean; head text;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(c.status in ('draft', 'returned'), 'Already submitted');
  perform app.require(c.prepared_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Only who prepared it submits it');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_cert' and a.entity_id = c.id and a.kind = 'ipc_draft'),
    'Attach the IPC (PDF or photos)');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_cert' and a.entity_id = c.id and a.kind = 'ipc_measure'),
    'Attach the measurement sheets (PDF or photos)');
  perform app.require(not exists (select 1 from public.sub_cert_variations x where x.sub_cert_id = c.id
    and not exists (select 1 from public.attachments a where a.entity_type = 'sub_cert_var' and a.entity_id = x.id)),
    'Attach the IPC / measurement sheets of each ticked variation separately: ' ||
    coalesce((select string_agg(x.var_code, ', ' order by x.var_code) from public.sub_cert_variations x where x.sub_cert_id = c.id
      and not exists (select 1 from public.attachments a where a.entity_type = 'sub_cert_var' and a.entity_id = x.id)), ''));
  -- prepared by a subcontractor supervisor: the project's Assistant Engineer checks it first (if the project has one)
  by_sub := exists (select 1 from public.profiles where id = c.prepared_by and role = 'sub_supervisor');
  aes := array(select m.user_id from public.exec_members m join public.profiles p on p.id = m.user_id
                where m.exec_project_id = c.exec_project_id and m.member_role = 'assistant_engineer' and m.active and p.active);
  update public.sub_certs set status = case when by_sub and cardinality(aes) > 0 then 'ae_review' else 'prepared' end, submitted_at = now(),
    revision = revision + case when status = 'returned' then 1 else 0 end, return_note = null
  where id = c.id returning * into c;
  head := format('%s · %s · %s · net %s · %s', c.code, c.subcontractor, c.period, app.fmt_money(c.net, 'LKR'), app.exec_head(c.exec_project_id));
  if c.status = 'ae_review' then
    perform app.notify_many(aes, 'exec_cost', 'Subcontractor IPC to check', head, 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_cost', 'Subcontractor IPC – IPA pending', head, 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  end if;
  return c.status;
end $$;

create or replace function public.create_sub_invoice(p_cert uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; iid uuid;
begin
  select * into c from public.sub_certs where id = p_cert;
  perform app.require(c.id is not null, 'Payment certificate not found');
  perform app.require(app.can_record_sub_invoice(c.exec_project_id), 'Only the project''s subcontractor supervisor or Assistant Engineer records invoices');
  perform app.require(c.status in ('verified', 'approved', 'paid'), 'The payment certificate (IPC and measurement sheets) must have Interim Payment Approval (IPA) first – IPA pending');
  perform app.require(coalesce(btrim(p ->> 'invoice_no'), '') <> '', 'Enter the invoice number');
  perform app.require(nullif(p ->> 'invoice_date', '') is not null, 'Enter the invoice date');
  perform app.require(coalesce(nullif(replace(p ->> 'amount', ',', ''), '')::numeric, 0) > 0, 'Enter the invoice amount');
  insert into public.sub_invoices (code, exec_project_id, sub_cert_id, subcontractor, invoice_no, invoice_date, amount, note)
  values (app.next_code('SINV'), c.exec_project_id, c.id, c.subcontractor, btrim(p ->> 'invoice_no'), (p ->> 'invoice_date')::date,
          replace(p ->> 'amount', ',', '')::numeric, nullif(btrim(p ->> 'note'), ''))
  returning id into iid;
  insert into public.sub_invoice_log (invoice_id, action) values (iid, 'created');
  insert into public.sub_invoice_variations (invoice_id, cert_var_id, var_code, var_title)
  select iid, x.id, x.var_code, x.var_title from public.sub_cert_variations x where x.sub_cert_id = c.id;
  return iid;
end $$;

create or replace function public.submit_sub_invoice(p_id uuid, p jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v public.sub_invoices; head text; aes uuid[]; by_sub boolean;
begin
  select * into v from public.sub_invoices where id = p_id for update;
  perform app.require(v.id is not null, 'Invoice not found');
  -- recorded by a subcontractor supervisor: the project's Assistant Engineer checks it first (if the project has one)
  by_sub := exists (select 1 from public.profiles where id = v.created_by and role = 'sub_supervisor');
  aes := array(select m.user_id from public.exec_members m join public.profiles p on p.id = m.user_id
                where m.exec_project_id = v.exec_project_id and m.member_role = 'assistant_engineer' and m.active and p.active);
  perform app.require(v.created_by = auth.uid() or (app.can_record_sub_invoice(v.exec_project_id) and not app.has_role('sub_supervisor')), 'Only who recorded it submits it');
  perform app.require(v.status in ('draft', 'returned'), 'Already submitted');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_invoice' and a.entity_id = v.id and a.kind = 'sinv_doc'),
    'Attach the invoice copy (PDF or photos)');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_invoice' and a.entity_id = v.id and a.kind = 'ipc_signed'),
    'Attach the IPA-approved IPC with signatures (PDF or photos)');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_invoice' and a.entity_id = v.id and a.kind = 'measure_final'),
    'Attach the corrected (final) measurement sheets (PDF or photos)');
  perform app.require(not exists (select 1 from public.sub_invoice_variations x where x.invoice_id = v.id
    and not exists (select 1 from public.attachments a where a.entity_type = 'sub_invoice_var' and a.entity_id = x.id)),
    'Attach the IPA-approved documents of each variation separately: ' ||
    coalesce((select string_agg(x.var_code, ', ' order by x.var_code) from public.sub_invoice_variations x where x.invoice_id = v.id
      and not exists (select 1 from public.attachments a where a.entity_type = 'sub_invoice_var' and a.entity_id = x.id)), ''));
  update public.sub_invoices set status = case when by_sub and cardinality(aes) > 0 then 'ae_review' else 'submitted' end, submitted_at = now(), revision = revision + case when status = 'returned' then 1 else 0 end,
    invoice_no = coalesce(nullif(btrim(p ->> 'invoice_no'), ''), invoice_no), amount = coalesce(nullif(replace(p ->> 'amount', ',', ''), '')::numeric, amount),
    note = coalesce(nullif(btrim(p ->> 'note'), ''), note)
   where id = v.id returning * into v;
  insert into public.sub_invoice_log (invoice_id, action, note) values (v.id, case when v.revision > 0 then 'resubmitted' else 'submitted' end, nullif(btrim(p ->> 'note'), ''));
  head := format('%s · %s · invoice %s · %s', v.code, v.subcontractor, v.invoice_no, app.fmt_money(v.amount, 'LKR'));
  perform app.notify(v.created_by, 'sub_invoice', 'Invoice recorded – for reference only',
    head || E'\nThis submission is for recording purposes only. The physical documents must be submitted to the DIMO Lighting Solutions office for processing – you will be told here when they can be submitted (after the Senior Electrical Engineer and Operations approve).',
    'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
  if v.status = 'ae_review' then
    perform app.notify_many(aes, 'sub_invoice', 'Subcontractor invoice to check', head || ' · ' || app.exec_head(v.exec_project_id),
      'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'sub_invoice', 'Subcontractor invoice to approve', head || ' · ' || app.exec_head(v.exec_project_id),
      'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
  end if;
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
  when 'sub_cert_var' then
    return exists (select 1 from public.sub_cert_variations x where x.id = a.entity_id and app.can_read_sub_cert(x.sub_cert_id));
  when 'sub_invoice_var' then
    return exists (select 1 from public.sub_invoice_variations x where x.id = a.entity_id and app.can_read_sub_invoice(x.invoice_id));
  when 'sub_cert' then
    return app.can_read_sub_cert(a.entity_id);
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
      ((p_kind is null or p_kind in ('sinv_doc', 'ipc_signed', 'measure_final')) and x.status in ('draft', 'returned')
        and (x.created_by = auth.uid() or (app.can_record_sub_invoice(x.exec_project_id) and not app.has_role('sub_supervisor'))))
      or ((p_kind is null or p_kind = 'sinv_markup') and ((x.status = 'ae_review' and app.is_project_ae(x.exec_project_id))
                                                          or (x.status = 'submitted' and app.has_role('senior_elec_engineer'))
                                                          or (x.status = 'see_approved' and app.has_role('operations_exec'))))));
  when 'sub_cert_var' then
    -- a ticked variation's IPC / sheets: as the IPC's own documents
    return exists (select 1 from public.sub_cert_variations v join public.sub_certs x on x.id = v.sub_cert_id where v.id = p_entity_id
      and (p_kind is null or p_kind = 'ipc_var') and x.status in ('draft', 'returned') and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')));
  when 'sub_invoice_var' then
    return exists (select 1 from public.sub_invoice_variations v join public.sub_invoices x on x.id = v.invoice_id where v.id = p_entity_id
      and (p_kind is null or p_kind = 'var_final') and x.status in ('draft', 'returned')
      and (x.created_by = auth.uid() or (app.can_record_sub_invoice(x.exec_project_id) and not app.has_role('sub_supervisor'))));
  when 'sub_cert' then
    -- the IPC and measurement sheets: who prepared it, while a draft or returned · the marked-up copy: the AE / SEE while it waits for them
    return exists (select 1 from public.sub_certs x where x.id = p_entity_id and (
      ((p_kind is null or p_kind in ('ipc_draft', 'ipc_measure')) and x.status in ('draft', 'returned')
        and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')))
      or ((p_kind is null or p_kind = 'ipc_markup') and ((x.status = 'ae_review' and app.is_project_ae(x.exec_project_id))
                                                         or (x.status = 'prepared' and app.has_role('senior_elec_engineer'))))));
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = p_entity_id and ((x.requested_by = auth.uid() and x.status = 'pending_smp') or app.has_role('sm_projects')));
  else return false;
  end case;
end $$;

revoke execute on function public.sub_cert_variation_options(uuid), public.set_sub_cert_variations(uuid, uuid[]) from public, anon;
grant execute on function public.sub_cert_variation_options(uuid), public.set_sub_cert_variations(uuid, uuid[]) to authenticated, service_role;
