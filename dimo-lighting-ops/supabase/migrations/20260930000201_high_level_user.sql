-- High level user: the GM / DGM gives a person temporary, view-only GM / DGM access for a set time (at most one day).
--  * Only the GM / DGM grants or cancels it; the person keeps their own role. The access ends by itself at the end time
--    (it is checked on every request) and both are told; it can also be cancelled earlier.
--  * View only, enforced by the database: while the person views as a high level user the app marks each request, the
--    database then treats them as GM / DGM *inside a read-only transaction* – any change is refused.
--  * They get no GM / DGM notifications or approvals. Every grant, cancellation and end is logged.

create table public.high_level_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  granted_by uuid not null default auth.uid() references public.profiles (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (btrim(reason) <> ''),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text,
  end_notified boolean not null default false,
  created_at timestamptz not null default now(),
  constraint high_level_period check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours')
);
create index on public.high_level_grants (user_id, ends_at);
alter table public.high_level_grants enable row level security;
create policy high_level_read on public.high_level_grants for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'gm' and p.active));
grant select on public.high_level_grants to authenticated;

-- An access period in force now for the signed-in person
create or replace function app.high_level_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.high_level_grants g where g.user_id = auth.uid() and g.cancelled_at is null and g.starts_at <= now() and g.ends_at > now())
$$;

-- The request is marked "view as high level user" by the app
create or replace function app.high_level_view() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-view-as', '') = 'high_level'
$$;

-- Every role check goes through here: a high level user viewing as such is GM / DGM, but only in a read-only transaction
-- (app.high_level is set once per request by pre_request below, after checking the access period)
create or replace function app.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select case
    when current_setting('app.high_level', true) = 'on' and current_setting('transaction_read_only') = 'on' then 'gm'::public.app_role
    else (select role from public.profiles where id = auth.uid() and active)
  end
$$;

-- PostgREST runs this before every request: a high level view request becomes read-only
create or replace function public.pre_request() returns void
language plpgsql as $$
begin
  if app.high_level_view() and app.high_level_active() then
    perform set_config('transaction_read_only', 'on', true);
    perform set_config('app.high_level', 'on', true);
  end if;
end $$;
grant execute on function public.pre_request() to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.pre_request''';
    notify pgrst, 'reload config';
  end if;
exception when others then raise notice 'pre_request not set: %', sqlerrm;
end $$;

-- The real GM / DGM (their own role, not a high level view)
create or replace function app.real_gm() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'gm' and active)
$$;

create or replace function public.grant_high_level(p_user uuid, p_starts timestamptz, p_ends timestamptz, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u public.profiles; gid uuid; s timestamptz := coalesce(p_starts, now());
begin
  perform app.require(app.real_gm(), 'Only the GM / DGM gives high level access');
  select * into u from public.profiles where id = p_user;
  perform app.require(found and u.active, 'Choose an active user');
  perform app.require(u.role not in ('gm', 'sys_admin'), 'This person already has full access');
  perform app.require(u.id <> auth.uid(), 'Not to yourself');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(p_ends > s and p_ends > now(), 'The end must be after the start and in the future');
  perform app.require(p_ends - s <= interval '24 hours', 'High level access is for one day at most');
  perform app.require(not exists (select 1 from public.high_level_grants g where g.user_id = p_user and g.cancelled_at is null and g.ends_at > s and g.starts_at < p_ends),
    'This person already has high level access in that period');
  insert into public.high_level_grants (user_id, starts_at, ends_at, reason) values (p_user, s, p_ends, btrim(p_reason)) returning id into gid;
  perform app.notify(p_user, 'access', 'High level access (view only)',
    format('From %s to %s you can view everything the GM / DGM sees – switch to "View as high level user". Reason: %s',
      to_char(s at time zone app.tz(), 'DD Mon HH24:MI'), to_char(p_ends at time zone app.tz(), 'DD Mon HH24:MI'), btrim(p_reason)),
    'normal', null, null, '/', 'hl_grant:' || gid, false);
  insert into public.audit_log (user_id, table_name, record_id, action, new_data)
  values (auth.uid(), 'high_level_grants', gid, 'GRANT', jsonb_build_object('user', p_user, 'starts', s, 'ends', p_ends, 'reason', p_reason));
  return gid;
end $$;

create or replace function public.cancel_high_level(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare g public.high_level_grants;
begin
  perform app.require(app.real_gm(), 'Only the GM / DGM cancels high level access');
  select * into g from public.high_level_grants where id = p_id;
  perform app.require(found and g.cancelled_at is null and g.ends_at > now(), 'Not in force');
  update public.high_level_grants set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = nullif(btrim(p_reason), ''), end_notified = true where id = p_id;
  perform app.notify(g.user_id, 'access', 'High level access cancelled', coalesce(nullif(btrim(p_reason), ''), 'Cancelled by the GM / DGM'), 'normal', null, null, '/', 'hl_cancel:' || p_id, false);
  insert into public.audit_log (user_id, table_name, record_id, action, new_data) values (auth.uid(), 'high_level_grants', p_id, 'CANCEL', jsonb_build_object('reason', p_reason));
end $$;

-- Every 15 minutes: tell the person and the GM / DGM that an access period has ended
create or replace function public.high_level_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare g record; n int := 0;
begin
  for g in select * from public.high_level_grants where cancelled_at is null and not end_notified and ends_at <= p_at loop
    perform app.notify_many(array[g.user_id, g.granted_by], 'access', 'High level access ended',
      format('%s · ended %s', (select full_name from public.profiles where id = g.user_id), to_char(g.ends_at at time zone app.tz(), 'DD Mon HH24:MI')),
      'normal', null, null, '/', 'hl_end:' || g.id, false);
    update public.high_level_grants set end_notified = true where id = g.id;
    insert into public.audit_log (user_id, table_name, record_id, action, new_data) values (g.granted_by, 'high_level_grants', g.id, 'ENDED', jsonb_build_object('ends', g.ends_at));
    n := n + 1;
  end loop;
  return n;
end $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('high-level-tick', '*/15 * * * *', 'select public.high_level_tick()');
  end if;
end $$;

-- Files: a high level user reads them all during the period (the file service does not pass the view mark)
CREATE OR REPLACE FUNCTION app.can_read_attachment(a attachments)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.app_role := app.my_role(); inq uuid; st text; mode int; released timestamptz;
begin
  if r is null then return false; end if;
  -- a high level user (view only) reads every file during the access period
  if app.high_level_active() then return true; end if;
  if a.uploaded_by = auth.uid() then return true; end if;
  case a.entity_type
  when 'fx_report' then
    return app.sees_fx();
  when 'instrument' then
    return not app.is_sub();
  when 'visit' then
    return r in ('gm', 'sm_projects') or exists (select 1 from public.visits where id = a.entity_id and sales_person_id = auth.uid());
  when 'tender' then
    return r in ('gm', 'sm_projects', 'sm_estimation', 'am_estimation') or exists (select 1 from public.tenders where id = a.entity_id and sales_person_id = auth.uid());
  when 'tender_bid' then
    return r in ('gm', 'sm_projects', 'sm_estimation', 'am_estimation') or exists (select 1 from public.tender_bids b join public.tenders t on t.id = b.tender_id
      where b.id = a.entity_id and t.sales_person_id = auth.uid());
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
  when 'scrap_disposal' then
    return app.can_read_scrap(a.entity_id);
  when 'scrap_quote' then
    return exists (select 1 from public.scrap_quotes q where q.id = a.entity_id and app.can_read_scrap(q.disposal_id));
  when 'project_defect' then
    return app.can_read_defect(a.entity_id);
  else
    return r = 'gm';
  end case;
end $function$;
