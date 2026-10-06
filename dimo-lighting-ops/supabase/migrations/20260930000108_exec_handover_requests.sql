-- Execution hand-over: a project reaches the execution team only through a request approved by SM Projects.
--  * Won projects in the system: the Operations Executive requests the hand-over (contract / PO documents attached);
--    SM Projects approves and assigns the Senior Electrical Engineer → the execution project is created.
--  * Projects won before the system: the Senior Electrical Engineer enters the project details; SM Projects approves.
--    These have no sales project behind them (client, contract value and reference are kept on the execution project).
--  * Until approved, nothing appears in the execution lists. Starting execution directly is no longer possible.

alter table public.exec_projects alter column project_id drop not null;
alter table public.exec_projects add column if not exists legacy boolean not null default false;
alter table public.exec_projects add column if not exists client_name text;
alter table public.exec_projects add column if not exists contract_value_lkr numeric(16, 2);
alter table public.exec_projects add column if not exists contract_ref text;
alter table public.exec_projects add column if not exists request_id uuid;

create table public.exec_requests (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  kind text not null check (kind in ('won', 'legacy')),
  project_id uuid references public.projects (id),
  name text not null,
  client_name text,
  contract_value_lkr numeric(16, 2),
  contract_ref text,
  site_address text,
  start_date date,
  end_date date,
  areas text[] not null default '{}',
  see_id uuid references public.profiles (id),
  note text,
  requested_by uuid not null default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  status text not null default 'pending_smp' check (status in ('pending_smp', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  exec_project_id uuid references public.exec_projects (id),
  constraint exec_requests_areas_valid check (areas <@ app.exec_areas()),
  constraint exec_requests_won_project check (kind = 'legacy' or project_id is not null)
);
create unique index exec_requests_one_open on public.exec_requests (project_id) where status = 'pending_smp' and project_id is not null;
alter table public.exec_requests enable row level security;
create policy exec_requests_read on public.exec_requests for select to authenticated
  using (requested_by = auth.uid() or app.has_role('sm_projects', 'gm', 'operations_exec', 'senior_elec_engineer'));
grant select on public.exec_requests to authenticated;

-- Creates the execution project (used when SM Projects approves a hand-over request)
create or replace function app.create_exec_project(r public.exec_requests, p_see uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare pr public.projects; eid uuid;
begin
  if r.kind = 'won' then
    select * into pr from public.projects where id = r.project_id;
    perform app.require(pr.id is not null and pr.status = 'won', 'The project is no longer marked won');
    perform app.require(not exists (select 1 from public.exec_projects where project_id = pr.id), 'Execution has already started for this project');
  end if;
  insert into public.exec_projects (project_id, code, name, areas, see_id, site_address, lat, lng, start_date, end_date, legacy, client_name, contract_value_lkr,
                                    contract_ref, request_id, created_by)
  values (r.project_id, coalesce(pr.code, app.next_code('EXP')), coalesce(pr.name, r.name), r.areas, p_see,
          coalesce(r.site_address, nullif(concat_ws(', ', pr.location, pr.city), '')), pr.lat, pr.lng, r.start_date, r.end_date, r.kind = 'legacy',
          coalesce(r.client_name, (select o.name from public.organizations o where o.id = pr.organization_id)),
          coalesce(r.contract_value_lkr, pr.project_value), r.contract_ref, r.id, r.requested_by)
  returning id into eid;
  insert into public.access_log (exec_project_id, event, note) values (eid, 'execution_started', 'Hand-over ' || r.code);
  return eid;
end $$;

-- p: {kind, project_id | name, client_name, contract_value, contract_ref, site_address, start_date, end_date, areas[], see_id, note}
create or replace function public.request_execution(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare k text := coalesce(nullif(p ->> 'kind', ''), 'won'); pr public.projects; ar text[]; rid uuid; c text := app.next_code('EXR'); nm text;
begin
  select coalesce(array_agg(x), '{}') into ar from jsonb_array_elements_text(coalesce(p -> 'areas', '[]')) x;
  perform app.require(ar <@ app.exec_areas(), 'Unknown project area');
  if k = 'won' then
    perform app.require(app.has_role('operations_exec'), 'The Operations Executive requests the hand-over of a won project');
    select * into pr from public.projects where id = nullif(p ->> 'project_id', '')::uuid;
    perform app.require(pr.id is not null, 'Choose the project');
    perform app.require(pr.status = 'won', 'Only a won project goes to execution');
    perform app.require(not exists (select 1 from public.exec_projects where project_id = pr.id), 'This project is already with the execution team');
    perform app.require(not exists (select 1 from public.exec_requests where project_id = pr.id and status = 'pending_smp'), 'A hand-over request is already waiting for SM Projects');
    nm := pr.name;
  elsif k = 'legacy' then
    perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer enters projects won before the system');
    perform app.require(coalesce(btrim(p ->> 'name'), '') <> '' and coalesce(btrim(p ->> 'client_name'), '') <> '', 'Enter the project name and the client');
    perform app.require(cardinality(ar) > 0, 'Choose at least one project area');
    nm := btrim(p ->> 'name');
  else
    perform app.require(false, 'Unknown request');
  end if;
  insert into public.exec_requests (code, kind, project_id, name, client_name, contract_value_lkr, contract_ref, site_address, start_date, end_date, areas, see_id, note)
  values (c, k, pr.id, nm, nullif(btrim(p ->> 'client_name'), ''), nullif(p ->> 'contract_value', '')::numeric, nullif(btrim(p ->> 'contract_ref'), ''),
          nullif(btrim(p ->> 'site_address'), ''), nullif(p ->> 'start_date', '')::date, nullif(p ->> 'end_date', '')::date, ar,
          coalesce(nullif(p ->> 'see_id', '')::uuid, case when k = 'legacy' then auth.uid() end), nullif(btrim(p ->> 'note'), ''))
  returning id into rid;
  perform app.notify_many(app.role_users('sm_projects'), 'exec_request',
    case k when 'won' then 'Won project to hand over to execution' else 'Project won before the system – approve for execution' end,
    format('%s · %s · by %s', c, nm, app.display_name(auth.uid())), 'normal', 'exec_request', rid, '/execution/handover/' || rid, null, true);
  return rid;
end $$;

-- SM Projects approves (assigning the Senior Electrical Engineer) or rejects with the reason
create or replace function public.decide_execution_request(p_id uuid, p_approve boolean, p_see uuid default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.exec_requests; see uuid; eid uuid;
begin
  perform app.require(app.has_role('sm_projects'), 'SM Projects assigns projects to the execution team');
  select * into r from public.exec_requests where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'pending_smp', 'Not waiting for SM Projects');
  if not p_approve then
    perform app.require(coalesce(btrim(p_note), '') <> '', 'Give the reason');
    update public.exec_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = btrim(p_note) where id = r.id;
    perform app.notify(r.requested_by, 'exec_request', 'Hand-over to execution not approved', r.name || ' · ' || btrim(p_note), 'normal', 'exec_request', r.id,
      '/execution/handover/' || r.id);
    return null;
  end if;
  see := coalesce(p_see, r.see_id);
  perform app.require(see is not null and exists (select 1 from public.profiles where id = see and role = 'senior_elec_engineer' and active), 'Choose the Senior Electrical Engineer');
  eid := app.create_exec_project(r, see);
  update public.exec_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), ''), exec_project_id = eid,
    see_id = see where id = r.id;
  perform app.notify_many(array[see, r.requested_by] || app.role_users('operations_exec'), 'exec_project', 'Project assigned to execution – ' || r.name,
    case when cardinality(r.areas) = 0 then 'Set the project areas, site and dates, then add the team' else 'Add the team and plan the first week' end,
    'normal', 'exec_project', eid, '/execution/' || eid, null, true);
  perform app.notify_many(array(select owner_id from public.projects where id = r.project_id), 'exec_project', 'Your project went to execution', r.name, 'normal',
    'exec_project', eid, '/projects/' || r.project_id);
  return eid;
end $$;

create or replace function public.cancel_execution_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.exec_requests set status = 'cancelled' where id = p_id and status = 'pending_smp' and requested_by = auth.uid();
  perform app.require(found, 'Only your own waiting request can be cancelled');
end $$;

-- Direct start is replaced by the hand-over request
create or replace function public.start_execution(p_project uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(false, 'Projects reach execution through a hand-over request (Operations Executive) approved by SM Projects');
  return null;
end $$;

-- Variations priced through Design / Estimation need the sales project behind them
create or replace function app.variation_route_check() returns trigger language plpgsql as $$
begin
  if new.route in ('A', 'B') and (select project_id from public.exec_projects where id = new.exec_project_id) is null then
    raise exception 'This project was won before the system – price the variation at contract rates (route C)';
  end if;
  return new;
end $$;
create trigger variations_route_check before insert or update of route on public.variations for each row execute function app.variation_route_check();
create or replace function app.variation_inquiry_check() returns trigger language plpgsql as $$
begin
  if new.variation_id is not null and new.project_id is null then
    raise exception 'This project was won before the system – price the variation at contract rates (route C)';
  end if;
  return new;
end $$;
create trigger inquiries_variation_check before insert on public.inquiries for each row execute function app.variation_inquiry_check();

revoke execute on function public.request_execution(jsonb), public.decide_execution_request(uuid, boolean, uuid, text), public.cancel_execution_request(uuid) from public, anon;
grant execute on function public.request_execution(jsonb), public.decide_execution_request(uuid, boolean, uuid, text), public.cancel_execution_request(uuid) to authenticated;

-- Approvals (copied from 20260930000107_exec_qa_handover_cost.sql with hand-over requests)
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
  select 'exec_gate', g.id, 'exec_gate', format('Stage gate %s – %s', g.gate, app.exec_head(g.exec_project_id)), g.note, g.requested_by,
         app.display_name(g.requested_by), g.requested_at, null::uuid, '/execution/' || g.exec_project_id, null
  from public.exec_gates g where g.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'sub_cert', c.id, 'exec_sub_cert', format('Subcontractor payment %s – %s', c.code, c.subcontractor), app.exec_head(c.exec_project_id) || ' · ' || app.fmt_money(c.net, 'LKR'),
         c.prepared_by, app.display_name(c.prepared_by), c.prepared_at, null::uuid, '/execution/' || c.exec_project_id || '?tab=cost',
         case c.status when 'prepared' then 'Verify' when 'verified' then 'Approve' else 'Pay' end
  from public.sub_certs c
  where (c.status = 'prepared' and app.has_role('senior_elec_engineer')) or (c.status = 'verified' and app.has_role('sm_projects'))
     or (c.status = 'approved' and app.has_role('operations_exec'))
  union all
  select 'test_record', t.id, 'exec_test', format('Test record %s – %s', t.code, t.system), app.exec_head(t.exec_project_id) || ' · ' || t.result, t.performed_by,
         app.display_name(t.performed_by), t.performed_at, null::uuid, '/execution/' || t.exec_project_id || '?tab=qa', 'Verify'
  from public.test_records t where t.status = 'submitted' and app.has_role('senior_elec_engineer')
  union all
  select 'exec_request', r.id, 'exec_request', format('%s – %s', case r.kind when 'won' then 'Hand over to execution' else 'Project won before the system' end, r.name),
         concat_ws(' · ', r.client_name, r.note), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid, '/execution/handover/' || r.id, 'SM Projects'
  from public.exec_requests r where r.status = 'pending_smp' and app.has_role('sm_projects')
$$;

-- Attachments (copied from 20260930000107_exec_qa_handover_cost.sql with the new record types)
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
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = p_entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
      or exists (select 1 from public.hse_actions a where a.report_id = x.id and a.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = p_entity_id and (x.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects')));
  when 'material_request' then
    return exists (select 1 from public.material_requests x where x.id = p_entity_id and app.is_exec_internal(x.exec_project_id) and not app.has_role('gm'));
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
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = a.entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
      or exists (select 1 from public.hse_actions y where y.report_id = x.id and y.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = a.entity_id and (app.is_exec_internal(x.exec_project_id) or r = 'gm'));
  when 'material_request' then
    return exists (select 1 from public.material_requests x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
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
