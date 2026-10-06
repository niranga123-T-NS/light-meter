-- Execution step 4: daily reports.
--  * Subcontractor supervisor: daily report by 18:00 (crew, work done, work for tomorrow, delays, toolbox talk, safety
--    check, HSE notes) with photos and documents → the Assistant Engineers of the project verify or return it.
--  * Assistant Engineer: daily report by 20:00 (verified supervisor reports, own inspections and tests, issues, plan for
--    tomorrow) with photos and documents → the Senior Electrical Engineer reviews or returns it.
--  * Not in an hour after the deadline → the person and the Senior Electrical Engineer are alerted; 3 late or missing days
--    within 14 days → SM Projects is told. Working days only.

create table public.exec_reports (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  report_date date not null,
  author_id uuid not null default auth.uid() references public.profiles (id),
  level text not null check (level in ('supervisor', 'ae')),
  status text not null default 'submitted' check (status in ('submitted', 'verified', 'returned')),
  crew_count int,
  crew text,
  work_done text not null,
  work_next text,
  delays text,
  inspections text,
  issues text,
  hse_notes text,
  toolbox_talk boolean not null default false,
  toolbox_topic text,
  safety_check boolean not null default false,
  weather text,
  visitors text,
  submitted_at timestamptz not null default now(),
  is_late boolean not null default false,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text,
  unique (exec_project_id, report_date, author_id)
);
create index on public.exec_reports (report_date, level);

create table public.exec_report_lateness (
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  report_date date not null,
  level text not null,
  kind text not null check (kind in ('missing', 'late')),
  at timestamptz not null default now(),
  primary key (exec_project_id, user_id, report_date)
);

alter table public.exec_reports enable row level security;
alter table public.exec_report_lateness enable row level security;
create policy exec_reports_read on public.exec_reports for select to authenticated
  using (author_id = auth.uid() or app.is_exec_internal(exec_project_id));
create policy exec_report_lateness_read on public.exec_report_lateness for select to authenticated
  using (user_id = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects', 'gm'));
grant select on public.exec_reports, public.exec_report_lateness to authenticated;

create or replace function app.report_due(p_level text, p_date date) returns timestamptz language sql stable as $$
  select (p_date + case p_level when 'supervisor' then time '18:00' else time '20:00' end) at time zone app.tz()
$$;

-- p: {crew_count, crew, work_done, work_next, delays, inspections, issues, hse_notes, toolbox_talk, toolbox_topic, safety_check, weather, visitors}
create or replace function public.submit_exec_report(p_exec uuid, p_date date, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare lvl text; x public.exec_reports; rid uuid; late boolean; today date := (now() at time zone app.tz())::date;
begin
  perform app.require(app.is_exec_member(p_exec), 'You are not on this project');
  lvl := case app.my_role() when 'sub_supervisor' then 'supervisor' when 'assistant_engineer' then 'ae' end;
  perform app.require(lvl is not null, 'Daily reports are written by subcontractor supervisors and Assistant Engineers');
  perform app.require(p_date is not null and p_date <= today and p_date >= today - 3, 'Report for today or the last three days');
  perform app.require(coalesce(btrim(p ->> 'work_done'), '') <> '', 'Describe the work done');
  perform app.require(lvl <> 'supervisor' or nullif(p ->> 'crew_count', '') is not null, 'Enter the crew on site');
  perform app.require(not coalesce((p ->> 'toolbox_talk')::boolean, false) or coalesce(btrim(p ->> 'toolbox_topic'), '') <> '', 'Enter the toolbox talk topic');
  late := now() > app.report_due(lvl, p_date);
  select * into x from public.exec_reports where exec_project_id = p_exec and report_date = p_date and author_id = auth.uid() for update;
  perform app.require(x.id is null or x.status = 'returned', 'Already submitted for this day');
  if x.id is null then
    insert into public.exec_reports (exec_project_id, report_date, level, crew_count, crew, work_done, work_next, delays, inspections, issues, hse_notes,
                                     toolbox_talk, toolbox_topic, safety_check, weather, visitors, is_late)
    values (p_exec, p_date, lvl, nullif(p ->> 'crew_count', '')::int, nullif(btrim(p ->> 'crew'), ''), btrim(p ->> 'work_done'), nullif(btrim(p ->> 'work_next'), ''),
            nullif(btrim(p ->> 'delays'), ''), nullif(btrim(p ->> 'inspections'), ''), nullif(btrim(p ->> 'issues'), ''), nullif(btrim(p ->> 'hse_notes'), ''),
            coalesce((p ->> 'toolbox_talk')::boolean, false), nullif(btrim(p ->> 'toolbox_topic'), ''), coalesce((p ->> 'safety_check')::boolean, false),
            nullif(btrim(p ->> 'weather'), ''), nullif(btrim(p ->> 'visitors'), ''), late)
    returning id into rid;
  else
    update public.exec_reports set status = 'submitted', submitted_at = now(), crew_count = nullif(p ->> 'crew_count', '')::int, crew = nullif(btrim(p ->> 'crew'), ''),
      work_done = btrim(p ->> 'work_done'), work_next = nullif(btrim(p ->> 'work_next'), ''), delays = nullif(btrim(p ->> 'delays'), ''),
      inspections = nullif(btrim(p ->> 'inspections'), ''), issues = nullif(btrim(p ->> 'issues'), ''), hse_notes = nullif(btrim(p ->> 'hse_notes'), ''),
      toolbox_talk = coalesce((p ->> 'toolbox_talk')::boolean, false), toolbox_topic = nullif(btrim(p ->> 'toolbox_topic'), ''),
      safety_check = coalesce((p ->> 'safety_check')::boolean, false), weather = nullif(btrim(p ->> 'weather'), ''), visitors = nullif(btrim(p ->> 'visitors'), '')
    where id = x.id;
    rid := x.id;
  end if;
  if late and x.id is null then
    insert into public.exec_report_lateness (exec_project_id, user_id, report_date, level, kind) values (p_exec, auth.uid(), p_date, lvl, 'late')
    on conflict (exec_project_id, user_id, report_date) do update set kind = 'late';
  end if;
  if lvl = 'supervisor' then
    perform app.notify_many(app.project_aes(p_exec), 'exec_report', format('Daily report to verify – %s%s', app.display_name(auth.uid()), case when late then ' (late)' else '' end),
      format('%s · %s', app.exec_head(p_exec), to_char(p_date, 'Dy DD Mon')), 'normal', 'exec_report', rid, '/execution/report/' || rid);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_report', format('Daily report – %s%s', app.display_name(auth.uid()), case when late then ' (late)' else '' end),
      format('%s · %s', app.exec_head(p_exec), to_char(p_date, 'Dy DD Mon')), 'normal', 'exec_report', rid, '/execution/report/' || rid);
  end if;
  return rid;
end $$;

-- Supervisor report → an Assistant Engineer of the project verifies; AE report → the Senior Electrical Engineer reviews
create or replace function public.review_exec_report(p_id uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare x public.exec_reports;
begin
  select * into x from public.exec_reports where id = p_id for update;
  perform app.require(x.id is not null and x.status = 'submitted', 'This report is not waiting for review');
  if x.level = 'supervisor' then
    perform app.require(app.is_project_ae(x.exec_project_id) or app.has_role('senior_elec_engineer'), 'An Assistant Engineer of the project verifies it');
  else
    perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer reviews it');
  end if;
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Say what needs to change');
  update public.exec_reports set status = case when p_ok then 'verified' else 'returned' end, reviewed_by = auth.uid(), reviewed_at = now(),
    review_note = nullif(btrim(p_note), '') where id = x.id;
  perform app.notify(x.author_id, 'exec_report', case when p_ok then 'Daily report verified' else 'Daily report returned – correct and resubmit' end,
    concat_ws(' · ', app.exec_head(x.exec_project_id), to_char(x.report_date, 'Dy DD Mon'), nullif(btrim(p_note), '')), 'normal', 'exec_report', x.id,
    '/execution/report/' || x.id, null, not p_ok);
end $$;

-- Late / missing reports (runs every 15 minutes)
create or replace function public.exec_report_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare d date := (p_at at time zone app.tz())::date; r record; n int := 0; lvl text; cnt int;
begin
  if not app.is_working_day(d) then return 0; end if;
  foreach lvl in array array['supervisor', 'ae'] loop
    if p_at < app.report_due(lvl, d) + interval '1 hour' then continue; end if;
    for r in select m.exec_project_id, m.user_id from public.exec_members m join public.profiles p on p.id = m.user_id join public.exec_projects e on e.id = m.exec_project_id
             where m.active and p.active and e.status = 'active' and m.valid_from <= d
               and p.role = case lvl when 'supervisor' then 'sub_supervisor' else 'assistant_engineer' end::public.app_role
               and not exists (select 1 from public.exec_reports x where x.exec_project_id = m.exec_project_id and x.author_id = m.user_id and x.report_date = d)
               and not exists (select 1 from public.exec_report_lateness l where l.exec_project_id = m.exec_project_id and l.user_id = m.user_id and l.report_date = d) loop
      insert into public.exec_report_lateness (exec_project_id, user_id, report_date, level, kind) values (r.exec_project_id, r.user_id, d, lvl, 'missing');
      perform app.notify_many(array[r.user_id] || app.role_users('senior_elec_engineer'), 'exec_report_late',
        format('Daily report not submitted – %s', app.display_name(r.user_id)),
        format('%s · due %s', app.exec_head(r.exec_project_id), case lvl when 'supervisor' then '18:00' else '20:00' end),
        'normal', 'exec_project', r.exec_project_id, '/execution/reports');
      n := n + 1;
      select count(distinct report_date) into cnt from public.exec_report_lateness where user_id = r.user_id and report_date > d - 14;
      if cnt >= 3 then
        perform app.notify_many(app.role_users('sm_projects'), 'exec_report_late', format('Daily reports late again – %s', app.display_name(r.user_id)),
          format('%s late or missing days in the last 2 weeks · %s', cnt, app.exec_head(r.exec_project_id)), 'normal', 'exec_project', r.exec_project_id,
          '/execution/reports', format('replate:%s:%s', r.user_id, to_char(d, 'IYYY-IW')));
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.exec_report_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.exec_report_tick(timestamptz) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('exec-report-tick', '*/15 * * * *', 'select public.exec_report_tick()');
  end if;
end $$;

revoke execute on function public.submit_exec_report(uuid, date, jsonb), public.review_exec_report(uuid, boolean, text) from public, anon;
grant execute on function public.submit_exec_report(uuid, date, jsonb), public.review_exec_report(uuid, boolean, text) to authenticated;

-- Attachments (copied from 20260930000098_engineering_jobs.sql with the new record types)
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
  else
    return r = 'gm';
  end case;
end $$;
