-- Subcontractor payment certificates (IPC) are submitted in the system with the IPC and its measurement sheets attached.
-- The subcontractor supervisor prepares it (or the project's Assistant Engineer when no supervisor is appointed, or the SEE);
-- a supervisor's IPC is checked first by the project's Assistant Engineer, then approved by the Senior Electrical Engineer.
-- Until the SEE approves, the preparer sees where it is waiting. Either reviewer may return it with comments marked in red on
-- the copy. Once the SEE approves, the preparer is told to record the invoice – with the signed IPC and the corrected
-- (final) measurement sheets – which can only be uploaded against an approved IPC. SM Projects approval and payment follow.

alter table public.sub_certs drop constraint if exists sub_certs_status_check;
alter table public.sub_certs add constraint sub_certs_status_check
  check (status in ('draft', 'ae_review', 'prepared', 'verified', 'approved', 'paid', 'returned', 'cancelled'));
alter table public.sub_certs alter column status set default 'draft';
alter table public.sub_certs add column if not exists submitted_at timestamptz;
alter table public.sub_certs add column if not exists ae_by uuid references public.profiles (id);
alter table public.sub_certs add column if not exists ae_at timestamptz;
alter table public.sub_certs add column if not exists returned_by uuid references public.profiles (id);
alter table public.sub_certs add column if not exists revision int not null default 0;
create index if not exists sub_certs_project on public.sub_certs (exec_project_id);

-- Who sees a certificate: the reviewers and finance, who prepared it, and the project's Assistant Engineers
create or replace function app.can_read_sub_cert(p_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sub_certs x where x.id = p_id
                  and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec') or app.is_project_ae(x.exec_project_id)))
$$;
drop policy if exists sub_certs_read on public.sub_certs;
create policy sub_certs_read on public.sub_certs for select to authenticated using (app.can_read_sub_cert(id));

-- A new certificate: a draft until the IPC and measurement sheets are attached and it is submitted
create or replace function public.prepare_sub_cert(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  perform app.require(app.can_record_sub_invoice(p_exec), 'The project''s subcontractor supervisor or Assistant Engineer prepares payment certificates');
  perform app.require(coalesce(btrim(p ->> 'subcontractor'), '') <> '' and coalesce(btrim(p ->> 'period'), '') <> '' and nullif(p ->> 'gross', '') is not null,
    'Enter the subcontractor, period and gross value');
  insert into public.sub_certs (code, exec_project_id, subcontractor, period, gross, previous, retention_pct, deductions, note, status)
  values (app.next_code('SPC'), p_exec, btrim(p ->> 'subcontractor'), btrim(p ->> 'period'), replace(p ->> 'gross', ',', '')::numeric,
          coalesce(nullif(replace(p ->> 'previous', ',', ''), '')::numeric, 0), coalesce(nullif(p ->> 'retention_pct', '')::numeric, 0),
          coalesce(nullif(replace(p ->> 'deductions', ',', ''), '')::numeric, 0), nullif(btrim(p ->> 'note'), ''), 'draft')
  returning id into cid;
  return cid;
end $$;

-- Correct the figures of a draft or returned certificate
create or replace function public.update_sub_cert(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(c.status in ('draft', 'returned'), 'Only a draft or returned certificate can be changed');
  perform app.require(c.prepared_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Only who prepared it changes it');
  update public.sub_certs set
    subcontractor = coalesce(nullif(btrim(p ->> 'subcontractor'), ''), subcontractor),
    period = coalesce(nullif(btrim(p ->> 'period'), ''), period),
    gross = coalesce(nullif(replace(p ->> 'gross', ',', ''), '')::numeric, gross),
    previous = coalesce(nullif(replace(p ->> 'previous', ',', ''), '')::numeric, previous),
    retention_pct = coalesce(nullif(p ->> 'retention_pct', '')::numeric, retention_pct),
    deductions = coalesce(nullif(replace(p ->> 'deductions', ',', ''), '')::numeric, deductions),
    note = case when p ? 'note' then nullif(btrim(p ->> 'note'), '') else note end
  where id = c.id;
end $$;

-- Submit (or resubmit after a return): the IPC and the measurement sheets must be attached
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
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_cost', 'Subcontractor IPC to approve', head, 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  end if;
  return c.status;
end $$;

-- AE check → SEE approval → SM Projects → payment by Operations; the AE or SEE may return it with comments
create or replace function public.advance_sub_cert(p_id uuid, p_ok boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; nxt text; head text;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  if c.status in ('draft', 'returned') then
    return public.submit_sub_cert(c.id);
  end if;
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Give the reason – and mark the comments on the copy');
  head := format('%s · %s · %s · net %s', c.code, c.subcontractor, c.period, app.fmt_money(c.net, 'LKR'));
  if c.status = 'ae_review' then
    perform app.require(app.is_project_ae(c.exec_project_id), 'The project''s Assistant Engineer checks it first');
    nxt := case when p_ok then 'prepared' else 'returned' end;
    update public.sub_certs set status = nxt, ae_by = auth.uid(), ae_at = now() where id = c.id;
    if p_ok then perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_cost', 'Subcontractor IPC to approve',
      head || ' · checked by ' || app.display_name(auth.uid()) || ' · ' || app.exec_head(c.exec_project_id), 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true); end if;
  elsif c.status = 'prepared' then
    perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer approves');
    nxt := case when p_ok then 'verified' else 'returned' end;
    update public.sub_certs set status = nxt, verified_by = auth.uid(), verified_at = now() where id = c.id;
    if p_ok then
      perform app.notify(c.prepared_by, 'exec_cost', 'IPC approved – record the invoice',
        head || E'\nApproved by the Senior Electrical Engineer. Now record the subcontractor invoice with the signed IPC and the corrected (final) measurement sheets.'
          || coalesce(E'\nNote: ' || nullif(btrim(p_note), ''), ''),
        'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
      perform app.notify_many(app.role_users('sm_projects'), 'exec_cost', 'Subcontractor payment certificate to approve', head || ' · ' || app.exec_head(c.exec_project_id),
        'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
    end if;
  elsif c.status = 'verified' then
    perform app.require(app.has_role('sm_projects'), 'SM Projects approves');
    nxt := case when p_ok then 'approved' else 'returned' end;
    update public.sub_certs set status = nxt, approved_by = auth.uid(), approved_at = now() where id = c.id;
    if p_ok then perform app.notify_many(app.role_users('operations_exec'), 'exec_cost', 'Subcontractor payment approved – process the payment', head,
      'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id); end if;
  elsif c.status = 'approved' then
    perform app.require(app.has_role('operations_exec'), 'Operations records the payment');
    perform app.require(p_ok and coalesce(btrim(p_note), '') <> '', 'Enter the payment reference');
    nxt := 'paid';
    update public.sub_certs set status = 'paid', paid_ref = btrim(p_note), paid_at = now() where id = c.id;
  else
    perform app.require(false, case c.status when 'paid' then 'Already paid' else 'Withdrawn' end);
  end if;
  if not p_ok then
    update public.sub_certs set returned_by = auth.uid(), return_note = btrim(p_note) where id = c.id;
    perform app.notify(c.prepared_by, 'exec_cost', 'IPC returned with comments', head || E'\n' || btrim(p_note) || E'\nSee the marked-up copy, correct and submit again.',
      'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  end if;
  return nxt;
end $$;

-- Withdraw a draft or returned certificate (no invoice can be recorded against it)
create or replace function public.cancel_sub_cert(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null and c.status in ('draft', 'returned'), 'Only a draft or returned certificate can be withdrawn');
  perform app.require(c.prepared_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Not allowed');
  update public.sub_certs set status = 'cancelled' where id = c.id;
end $$;

create or replace function app.gate_checks(p_exec uuid, p_gate int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb := '[]'; n int;
begin
  if p_gate = 1 then
    select count(*) into n from public.exec_members where exec_project_id = p_exec and active and member_role <> 'sub_supervisor';
    c := c || jsonb_build_array(jsonb_build_object('check', 'Engineer(s) on the project', 'ok', n > 0, 'detail', n || ' on the team'));
    select count(*) into n from public.exec_programmes where exec_project_id = p_exec and version > 0;
    c := c || jsonb_build_array(jsonb_build_object('check', 'Programme approved by SM Projects', 'ok', n > 0, 'detail', case when n > 0 then 'approved' else 'not approved' end));
  elsif p_gate = 2 then
    select count(*) into n from public.ncrs where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open NCR', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.test_records where exec_project_id = p_exec and status <> 'verified';
    c := c || jsonb_build_array(jsonb_build_object('check', 'All test records verified', 'ok', n = 0, 'detail', n || ' not verified'));
    select count(*) into n from public.snags where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'All snags closed', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.exec_dossier where exec_project_id = p_exec and mandatory and not done;
    c := c || jsonb_build_array(jsonb_build_object('check', 'Mandatory dossier items present', 'ok', n = 0 and exists (select 1 from public.exec_dossier where exec_project_id = p_exec), 'detail', n || ' missing'));
  elsif p_gate = 3 then
    select count(*) into n from public.material_requests where exec_project_id = p_exec and status in ('submitted', 'pending_smp', 'approved', 'ordered', 'part_received');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open material requests / orders', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.hse_reports where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open HSE reports', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.variations where exec_project_id = p_exec and status in ('raised', 'pricing', 'pending_smp', 'pending_gm', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No variation still open', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.sub_certs where exec_project_id = p_exec and status in ('draft', 'ae_review', 'returned', 'prepared', 'verified', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'Subcontractors finally certified and paid', 'ok', n = 0, 'detail', n || ' open'));
  end if;
  return c;
end $$;

create or replace function app.exec_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
  select 'access_request', r.id, 'exec_access',
         format('%s – %s', case r.kind when 'temp_add' then case r.role_type when 'trainee' then 'Trainee' else 'Temporary Assistant Engineer' end
                                       when 'temp_delete' then 'Delete temporary role' else 'Subcontractor supervisor' end, r.person_name),
         concat_ws(' · ', r.company, r.reason), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid,
         '/execution/access/' || r.id, case r.status when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.access_requests r
  where (r.status = 'pending_smp' and app.has_role('sm_projects')) or (r.status = 'pending_gm' and app.has_role('gm'))
  union all
  select 'exec_plan', pl.id, 'exec_plan', format('Weekly plan – %s – week of %s', app.display_name(pl.ae_id), to_char(pl.week_start, 'DD Mon')),
         concat_ws(' · ', app.exec_head(pl.exec_project_id), case when pl.is_late then 'submitted late' end), pl.ae_id, app.display_name(pl.ae_id),
         pl.submitted_at, null::uuid, '/execution/plan/' || pl.id, null
  from public.exec_plans pl where pl.status = 'submitted' and app.has_role('senior_elec_engineer')
  union all
  select 'variation', v.id, 'exec_variation',
         format('Variation %s – %s%s', v.code, v.title,
                case when v.value_lkr is not null then format(' (%s%s)', case when v.value_lkr > 0 then '+' else '−' end, app.fmt_money(abs(v.value_lkr), 'LKR')) else '' end),
         app.exec_head(v.exec_project_id), v.raised_by, app.display_name(v.raised_by), v.raised_at, null::uuid, '/execution/variation/' || v.id,
         case v.status when 'raised' then 'Screen' when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.variations v
  where (v.status = 'raised' and app.has_role('senior_elec_engineer')) or (v.status = 'pending_smp' and app.has_role('sm_projects'))
     or (v.status = 'pending_gm' and app.has_role('gm'))
  union all
  select 'material_request', m.id, 'exec_material', format('Material request %s', m.code), app.mr_head(m), m.requested_by, app.display_name(m.requested_by),
         m.requested_at, null::uuid, '/execution/material/' || m.id, case m.status when 'submitted' then 'Senior Electrical Engineer' else 'SM Projects' end
  from public.material_requests m
  where (m.status = 'submitted' and app.has_role('senior_elec_engineer')) or (m.status = 'pending_smp' and app.has_role('sm_projects'))
  union all
  select 'design_query', q.id, 'exec_design_query', format('Design query %s', q.code), concat_ws(' · ', app.exec_head(q.exec_project_id), q.question),
         q.raised_by, app.display_name(q.raised_by), q.raised_at, null::uuid, '/execution/query/' || q.id,
         case q.status when 'raised' then 'Screen' else 'Answer' end
  from public.design_queries q
  where (q.status = 'raised' and app.has_role('senior_elec_engineer')) or (q.status = 'forwarded' and app.has_role('design_manager'))
  union all
  select 'exec_gate', g.id, 'exec_gate', format('%s – %s', (array['Programme approved', 'Handover to the client', 'Project closure'])[g.gate], app.exec_head(g.exec_project_id)), g.note, g.requested_by,
         app.display_name(g.requested_by), g.requested_at, null::uuid, '/execution/' || g.exec_project_id, null
  from public.exec_gates g where g.status = 'pending' and not g.legacy and app.has_role('sm_projects')
  union all
  select 'sub_cert', c.id, 'exec_sub_cert', format('Subcontractor payment %s – %s', c.code, c.subcontractor), app.exec_head(c.exec_project_id) || ' · ' || app.fmt_money(c.net, 'LKR'),
         c.prepared_by, app.display_name(c.prepared_by), coalesce(c.submitted_at, c.prepared_at), null::uuid, '/execution/sub-cert/' || c.id,
         case c.status when 'ae_review' then 'AE check' when 'prepared' then 'SEE approval' when 'verified' then 'SM Projects' else 'Pay' end
  from public.sub_certs c
  where (c.status = 'ae_review' and app.is_project_ae(c.exec_project_id)) or (c.status = 'prepared' and app.has_role('senior_elec_engineer')) or (c.status = 'verified' and app.has_role('sm_projects'))
     or (c.status = 'approved' and app.has_role('operations_exec'))
  union all
  select 'test_record', t.id, 'exec_test', format('Test record %s – %s', t.code, t.system), app.exec_head(t.exec_project_id) || ' · ' || t.result, t.performed_by,
         app.display_name(t.performed_by), t.performed_at, null::uuid, '/execution/' || t.exec_project_id || '?tab=qa', 'Verify'
  from public.test_records t where t.status = 'submitted' and app.has_role('senior_elec_engineer')
  union all
  select 'exec_request', r.id, 'exec_request', format('%s – %s', case r.kind when 'won' then 'Hand over to execution' else 'Project won before the system' end, r.name),
         concat_ws(' · ', r.client_name, r.note), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid, '/execution/handover/' || r.id, 'SM Projects'
  from public.exec_requests r where r.status = 'pending_smp' and app.has_role('sm_projects')
  union all
  select 'exec_programme', pg.exec_project_id, 'exec_programme', case when pg.version = 0 then 'Programme – ' else 'Revised programme – ' end || app.exec_head(pg.exec_project_id),
         concat_ws(' · ', 'finish ' || to_char(pg.forecast_finish, 'DD Mon YYYY'), pg.submit_note, case when (pg.billing_check ->> 'red')::int > 0 then format('%s invoice(s) %s would miss their month: %s', pg.billing_check ->> 'red', app.fmt_money((pg.billing_check ->> 'red_amount')::numeric, 'LKR'), pg.billing_note) end), pg.submitted_by, app.display_name(pg.submitted_by), pg.submitted_at, null::uuid,
         '/execution/' || pg.exec_project_id || '?tab=programme', 'SM Projects'
  from public.exec_programmes pg where pg.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'exec_boq', b.exec_project_id, 'exec_billing', case when b.version = 0 then 'Contract BOQ – ' else 'Revised contract BOQ – ' end || app.exec_head(b.exec_project_id),
         concat_ws(' · ', app.fmt_money(b.total, 'LKR'), b.submit_note), b.uploaded_by, app.display_name(b.uploaded_by), b.uploaded_at, null::uuid,
         '/execution/boq/' || b.exec_project_id, 'SM Projects'
  from public.exec_boqs b where b.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'programme_edit', pg.exec_project_id, 'exec_programme', 'Permission to edit the programme – ' || app.exec_head(pg.exec_project_id),
         pg.edit_reason, pg.edit_requested_by, app.display_name(pg.edit_requested_by), pg.edit_requested_at, null::uuid,
         '/execution/' || pg.exec_project_id || '?tab=programme', 'SM Projects'
  from public.exec_programmes pg where pg.edit_requested_at is not null and app.has_role('sm_projects')
$$;

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
    'Attach the IPC approved and signed (PDF or photos)');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_invoice' and a.entity_id = v.id and a.kind = 'measure_final'),
    'Attach the corrected (final) measurement sheets (PDF or photos)');
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

revoke execute on function public.update_sub_cert(uuid, jsonb), public.submit_sub_cert(uuid), public.cancel_sub_cert(uuid) from public, anon;
grant execute on function public.update_sub_cert(uuid, jsonb), public.submit_sub_cert(uuid), public.cancel_sub_cert(uuid) to authenticated, service_role;
