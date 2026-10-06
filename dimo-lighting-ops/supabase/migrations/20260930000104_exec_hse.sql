-- Execution step 5: HSE reporting.
--  * Assistant Engineers, Trainees, subcontractor supervisors and the Senior Electrical Engineer report incidents, near
--    misses, unsafe acts and unsafe conditions with photos, location and severity.
--  * Each report goes at once to the Senior Electrical Engineer and SM Projects (high / critical: critical priority, not held
--    by quiet hours).
--  * Corrective actions are assigned (engineers or supervisors of the project), appear in the assignee's My Day and are
--    tracked to closure; overdue actions are alerted. The Senior Electrical Engineer closes the report when all are done.
--  * Supervisors see only their own reports and the actions given to them.

create table public.hse_reports (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  kind text not null check (kind in ('incident', 'near_miss', 'unsafe_act', 'unsafe_condition')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  occurred_at timestamptz not null,
  location text not null,
  lat double precision,
  lng double precision,
  description text not null,
  immediate_action text,
  injured int not null default 0,
  lost_time boolean not null default false,
  reported_by uuid not null default auth.uid() references public.profiles (id),
  reported_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  close_note text
);
create index on public.hse_reports (exec_project_id, status);

create table public.hse_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.hse_reports (id) on delete cascade,
  action text not null,
  assignee_id uuid not null references public.profiles (id),
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'done')),
  done_note text,
  done_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  overdue_alerted date
);
create index on public.hse_actions (assignee_id, status);

alter table public.hse_reports enable row level security;
alter table public.hse_actions enable row level security;
create or replace function app.can_read_hse(p_report uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hse_reports x where x.id = p_report and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
           or exists (select 1 from public.hse_actions a where a.report_id = x.id and a.assignee_id = auth.uid())))
$$;
create policy hse_reports_read on public.hse_reports for select to authenticated using (app.can_read_hse(id));
create policy hse_actions_read on public.hse_actions for select to authenticated using (assignee_id = auth.uid() or app.can_read_hse(report_id));
grant select on public.hse_reports, public.hse_actions to authenticated;

create or replace function app.hse_kind_label(k text) returns text language sql immutable as $$
  select case k when 'incident' then 'Incident' when 'near_miss' then 'Near miss' when 'unsafe_act' then 'Unsafe act' else 'Unsafe condition' end
$$;

-- p: {kind, severity, occurred_at, location, lat, lng, description, immediate_action, injured, lost_time}
create or replace function public.report_hse(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; code text; sev text := p ->> 'severity'; k text := p ->> 'kind'; occ timestamptz := coalesce(nullif(p ->> 'occurred_at', '')::timestamptz, now());
begin
  perform app.require(app.is_exec_member(p_exec) or app.has_role('senior_elec_engineer', 'sm_projects'), 'You are not on this project');
  perform app.require(k in ('incident', 'near_miss', 'unsafe_act', 'unsafe_condition'), 'Choose what happened');
  perform app.require(sev in ('low', 'medium', 'high', 'critical'), 'Choose the severity');
  perform app.require(coalesce(btrim(p ->> 'location'), '') <> '' and coalesce(btrim(p ->> 'description'), '') <> '', 'Enter where and what happened');
  perform app.require(occ <= now() + interval '5 minutes', 'The time cannot be in the future');
  code := app.next_code('HSE');
  insert into public.hse_reports (code, exec_project_id, kind, severity, occurred_at, location, lat, lng, description, immediate_action, injured, lost_time)
  values (code, p_exec, k, sev, occ, btrim(p ->> 'location'), nullif(p ->> 'lat', '')::float8, nullif(p ->> 'lng', '')::float8, btrim(p ->> 'description'),
          nullif(btrim(p ->> 'immediate_action'), ''), coalesce(nullif(p ->> 'injured', '')::int, 0), coalesce((p ->> 'lost_time')::boolean, false))
  returning id into rid;
  perform app.notify_many(array_remove(app.role_users('senior_elec_engineer', 'sm_projects'), auth.uid()), 'hse_report',
    format('HSE %s – %s (%s)', lower(app.hse_kind_label(k)), app.exec_head(p_exec), sev),
    format('%s · %s · %s · reported by %s', code, btrim(p ->> 'location'), btrim(p ->> 'description'), app.display_name(auth.uid())),
    case when sev in ('high', 'critical') or coalesce((p ->> 'lost_time')::boolean, false) then 'critical' else 'normal' end::public.priority,
    'hse_report', rid, '/execution/hse/' || rid, null, true);
  return rid;
end $$;

-- Corrective action: Senior Electrical Engineer, SM Projects or an Assistant Engineer of the project
create or replace function public.add_hse_action(p_report uuid, p_action text, p_assignee uuid, p_due date) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.hse_reports; aid uuid;
begin
  select * into r from public.hse_reports where id = p_report;
  perform app.require(r.id is not null and r.status = 'open', 'The report is closed');
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects') or app.is_project_ae(r.exec_project_id), 'Only the Senior Electrical Engineer or an Assistant Engineer assigns actions');
  perform app.require(coalesce(btrim(p_action), '') <> '', 'Describe the corrective action');
  perform app.require(p_due is not null and p_due >= (now() at time zone app.tz())::date, 'Set the due date');
  perform app.require(exists (select 1 from public.profiles x where x.id = p_assignee and x.active and
    (x.role in ('senior_elec_engineer', 'operations_exec') or exists (select 1 from public.exec_members m where m.exec_project_id = r.exec_project_id and m.user_id = x.id and m.active))),
    'Assign it to someone on the project');
  insert into public.hse_actions (report_id, action, assignee_id, due_date) values (r.id, btrim(p_action), p_assignee, p_due) returning id into aid;
  perform app.notify(p_assignee, 'hse_action', 'HSE corrective action for you – due ' || to_char(p_due, 'DD Mon'),
    format('%s · %s · %s', r.code, app.exec_head(r.exec_project_id), btrim(p_action)), 'normal', 'hse_report', r.id, '/execution/hse/' || r.id, null, true);
  return aid;
end $$;

create or replace function public.complete_hse_action(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.hse_actions; r public.hse_reports;
begin
  select * into a from public.hse_actions where id = p_id for update;
  perform app.require(a.id is not null and a.status = 'open', 'Nothing to complete');
  select * into r from public.hse_reports where id = a.report_id;
  perform app.require(a.assignee_id = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects'), 'Only the person it is assigned to');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Say what was done');
  update public.hse_actions set status = 'done', done_note = btrim(p_note), done_at = now() where id = a.id;
  perform app.notify_many(array_remove(app.role_users('senior_elec_engineer') || array[a.created_by], auth.uid()), 'hse_action', 'HSE action done',
    format('%s · %s · %s · %s', r.code, a.action, app.display_name(auth.uid()), btrim(p_note)), 'normal', 'hse_report', r.id, '/execution/hse/' || r.id);
end $$;

create or replace function public.close_hse_report(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.hse_reports;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'The Senior Electrical Engineer closes HSE reports');
  select * into r from public.hse_reports where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'open', 'Already closed');
  perform app.require(not exists (select 1 from public.hse_actions where report_id = r.id and status = 'open'), 'Complete every corrective action first');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Add the closing note (root cause, lesson)');
  update public.hse_reports set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_note = btrim(p_note) where id = r.id;
  perform app.notify_many(array_remove(app.role_users('sm_projects') || array[r.reported_by], auth.uid()), 'hse_report', 'HSE report closed – ' || r.code,
    btrim(p_note), 'normal', 'hse_report', r.id, '/execution/hse/' || r.id);
end $$;

-- Daily: overdue corrective actions → assignee and Senior Electrical Engineer
create or replace function public.hse_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare d date := (p_at at time zone app.tz())::date; a record; n int := 0;
begin
  for a in select x.*, r.code, r.exec_project_id from public.hse_actions x join public.hse_reports r on r.id = x.report_id
           where x.status = 'open' and x.due_date < d and (x.overdue_alerted is null or x.overdue_alerted < d) loop
    perform app.notify_many(array[a.assignee_id] || app.role_users('senior_elec_engineer'), 'hse_action', 'HSE action overdue',
      format('%s · %s · %s · due %s', a.code, a.action, app.display_name(a.assignee_id), to_char(a.due_date, 'DD Mon')), 'normal', 'hse_report', a.report_id,
      '/execution/hse/' || a.report_id);
    update public.hse_actions set overdue_alerted = d where id = a.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.hse_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.hse_tick(timestamptz) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('hse-tick', '0 2 * * *', 'select public.hse_tick()');
  end if;
end $$;

revoke execute on function public.report_hse(uuid, jsonb), public.add_hse_action(uuid, text, uuid, date), public.complete_hse_action(uuid, text),
  public.close_hse_report(uuid, text) from public, anon;
grant execute on function public.report_hse(uuid, jsonb), public.add_hse_action(uuid, text, uuid, date), public.complete_hse_action(uuid, text),
  public.close_hse_report(uuid, text) to authenticated;

-- Open items and reassignment include HSE actions
create or replace function app.open_items(p_user uuid) returns table (kind text, id uuid, title text, url text)
language sql stable security definer set search_path = public as $$
  select 'Engineering job', j.id, concat_ws(' · ', j.code, j.title), '/engineering/' || j.id
  from public.eng_jobs j where j.assignee_id = p_user and j.status in ('assigned', 'in_progress', 'on_hold')
  union all
  select 'Meeting action', a.id, a.action, '/meetings'
  from public.sales_meeting_actions a where a.status = 'open' and (a.assignee_id = p_user or (a.owner_id = p_user and a.assignee_id is null))
  union all
  select 'Weekly plan', pl.id, app.exec_head(pl.exec_project_id) || ' · week of ' || to_char(pl.week_start, 'DD Mon'), '/execution/plan/' || pl.id
  from public.exec_plans pl where pl.ae_id = p_user and pl.week_start + 6 >= (now() at time zone app.tz())::date
  union all
  select 'HSE action', h.id, h.action, '/execution/hse/' || h.report_id
  from public.hse_actions h where h.assignee_id = p_user and h.status = 'open'
$$;

create or replace function app.reassign_items(p_from uuid, p_to uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  update public.eng_jobs set assignee_id = p_to, assigned_at = now(), status = case when status = 'on_hold' then status else 'assigned' end,
    accepted_at = case when status = 'on_hold' then accepted_at end, accept_alert_level = 0, updated_at = now()
  where assignee_id = p_from and status in ('assigned', 'in_progress', 'on_hold');
  get diagnostics k = row_count; n := n + k;
  update public.sales_meeting_actions set assignee_id = p_to, assigned_at = now(), assigned_by = auth.uid()
  where status = 'open' and assignee_id = p_from;
  get diagnostics k = row_count; n := n + k;
  update public.exec_plans pl set ae_id = p_to
  where pl.ae_id = p_from and pl.week_start + 6 >= (now() at time zone app.tz())::date
    and not exists (select 1 from public.exec_plans x where x.exec_project_id = pl.exec_project_id and x.ae_id = p_to and x.week_start = pl.week_start);
  get diagnostics k = row_count; n := n + k;
  update public.hse_actions set assignee_id = p_to where assignee_id = p_from and status = 'open';
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- Attachments (copied from 20260930000103_exec_reports.sql with the new record types)
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
  else
    return r = 'gm';
  end case;
end $$;
