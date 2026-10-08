-- Police reports for site workers (projects that need them for permits).
--  * Set when the project is handed over (request_execution), editable later by the SEE / SM Projects: police reports
--    required (yes / no) and the signing authority of the letter (name, designation, phone).
--  * When required, every active worker without a submitted report is flagged for 2 days, then blocked (no induction,
--    not picked for toolbox talks) until the report is submitted. Blocking notifies the crew's supervisor and the
--    project's Assistant Engineers.
--  * The supervisor or an Assistant Engineer asks for the police report letter; the SEE releases it – numbered per
--    project (<WBS>/PR/NNN), addressed to the worker, valid until the date the SEE enters.
--  * The report is uploaded on the worker (attachment kind police_report) and submitted; an AE or the SEE accepts it
--    or returns it with the reason.

alter table public.exec_requests add column if not exists police_required boolean not null default false;
alter table public.exec_requests add column if not exists letter_sign_name text;
alter table public.exec_requests add column if not exists letter_sign_designation text;
alter table public.exec_requests add column if not exists letter_sign_phone text;

alter table public.exec_projects add column if not exists police_required boolean not null default false;
alter table public.exec_projects add column if not exists letter_sign_name text;
alter table public.exec_projects add column if not exists letter_sign_designation text;
alter table public.exec_projects add column if not exists letter_sign_phone text;
alter table public.exec_projects add column if not exists police_letter_seq int not null default 0;

alter table public.exec_workers add column if not exists police_status text not null default 'none'
  check (police_status in ('none', 'letter_requested', 'letter_issued', 'submitted', 'accepted', 'rejected'));
alter table public.exec_workers add column if not exists police_due_at timestamptz;
alter table public.exec_workers add column if not exists police_blocked_at timestamptz;
alter table public.exec_workers add column if not exists police_letter_requested_by uuid references public.profiles (id);
alter table public.exec_workers add column if not exists police_letter_requested_at timestamptz;
alter table public.exec_workers add column if not exists police_letter_no text;
alter table public.exec_workers add column if not exists police_letter_valid_until date;
alter table public.exec_workers add column if not exists police_letter_issued_by uuid references public.profiles (id);
alter table public.exec_workers add column if not exists police_letter_issued_at timestamptz;
alter table public.exec_workers add column if not exists police_submitted_by uuid references public.profiles (id);
alter table public.exec_workers add column if not exists police_submitted_at timestamptz;
alter table public.exec_workers add column if not exists police_decided_by uuid references public.profiles (id);
alter table public.exec_workers add column if not exists police_decided_at timestamptz;
alter table public.exec_workers add column if not exists police_note text;

-- New execution project: police-report settings and letter signatory from the hand-over request
create or replace function app.exec_projects_from_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.exec_requests;
begin
  if new.request_id is not null then
    select * into r from public.exec_requests where id = new.request_id;
    if r.id is not null then
      new.police_required := r.police_required;
      new.letter_sign_name := coalesce(new.letter_sign_name, r.letter_sign_name);
      new.letter_sign_designation := coalesce(new.letter_sign_designation, r.letter_sign_designation);
      new.letter_sign_phone := coalesce(new.letter_sign_phone, r.letter_sign_phone);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists exec_projects_from_request on public.exec_projects;
create trigger exec_projects_from_request before insert on public.exec_projects for each row execute function app.exec_projects_from_request();

-- not_required | flagged | blocked | submitted | accepted
create or replace function app.police_state(w public.exec_workers) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not coalesce((select e.police_required from public.exec_projects e where e.id = w.exec_project_id), false) then 'not_required'
    when w.police_status in ('submitted', 'accepted') then w.police_status
    when w.police_due_at is null or w.police_due_at > now() then 'flagged'
    else 'blocked' end
$$;

create or replace function app.worker_alert_to(w public.exec_workers) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array(select distinct x from unnest(app.project_aes(w.exec_project_id) || array[w.supervisor_id,
    case when exists (select 1 from public.profiles p where p.id = w.added_by and p.role = 'sub_supervisor') then w.added_by end]) x where x is not null)
$$;

-- New worker on a project that needs police reports: 2 days to submit
create or replace function app.exec_workers_police() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce((select police_required from public.exec_projects where id = new.exec_project_id), false) then
      new.police_due_at := coalesce(new.police_due_at, now() + interval '2 days');
    end if;
  elsif new.induction_id is not null and old.induction_id is null and app.police_state(new) = 'blocked' then
    raise exception 'Police report not submitted – % is blocked until it is', new.full_name using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists exec_workers_police on public.exec_workers;
create trigger exec_workers_police before insert or update of induction_id on public.exec_workers for each row execute function app.exec_workers_police();

create or replace function app.exec_workers_police_notice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.police_due_at is not null then
    perform app.notify_many(app.worker_alert_to(new), 'police_report', 'Police report needed – ' || new.full_name,
      format('%s · %s · submit within 2 days, otherwise the worker is blocked', new.company, app.exec_head(new.exec_project_id)),
      'normal', 'exec_project', new.exec_project_id, '/execution/worker/' || new.id);
  end if;
  return null;
end $$;
drop trigger if exists exec_workers_police_notice on public.exec_workers;
create trigger exec_workers_police_notice after insert on public.exec_workers for each row execute function app.exec_workers_police_notice();

-- SEE / SM Projects: police reports required, letter signatory
create or replace function public.set_police_settings(p_exec uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; req boolean := coalesce((p ->> 'police_required')::boolean, false); n int;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'Only the Senior Electrical Engineer or SM Projects changes the police-report settings');
  select * into e from public.exec_projects where id = p_exec for update;
  perform app.require(e.id is not null and e.status = 'active', 'Execution project not found or closed');
  perform app.require(coalesce(btrim(p ->> 'letter_sign_name'), '') <> '' and coalesce(btrim(p ->> 'letter_sign_designation'), '') <> '',
    'Enter the name and designation of the person who signs the letters');
  update public.exec_projects set police_required = req, letter_sign_name = btrim(p ->> 'letter_sign_name'),
    letter_sign_designation = btrim(p ->> 'letter_sign_designation'), letter_sign_phone = nullif(btrim(p ->> 'letter_sign_phone'), ''), updated_at = now()
  where id = e.id;
  if req and not e.police_required then
    update public.exec_workers set police_due_at = now() + interval '2 days', police_blocked_at = null
     where exec_project_id = e.id and status = 'active' and police_status not in ('submitted', 'accepted');
    get diagnostics n = row_count;
    if n > 0 then
      perform app.notify_many(app.project_aes(e.id) || array(select distinct supervisor_id from public.exec_workers
          where exec_project_id = e.id and status = 'active' and supervisor_id is not null and police_status not in ('submitted', 'accepted')),
        'police_report', 'Police reports now required – ' || app.exec_head(e.id),
        format('%s workers need a police report within 2 days, otherwise they are blocked', n), 'normal', 'exec_project', e.id, '/execution/' || e.id || '?tab=workers');
    end if;
  end if;
end $$;

-- Supervisor of the crew / Assistant Engineer: ask the SEE for the police report letter
create or replace function public.request_police_letter(p_worker uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w public.exec_workers; e public.exec_projects;
begin
  select * into w from public.exec_workers where id = p_worker for update;
  perform app.require(w.id is not null and w.status = 'active', 'Worker not found or off site');
  perform app.require(app.is_project_ae(w.exec_project_id) or w.supervisor_id = auth.uid() or w.added_by = auth.uid() or app.has_role('senior_elec_engineer'),
    'The supervisor of the crew or an Assistant Engineer asks for the letter');
  perform app.require(w.police_status in ('none', 'rejected', 'letter_issued'), 'A letter is already requested or the report is submitted');
  select * into e from public.exec_projects where id = w.exec_project_id;
  update public.exec_workers set police_status = 'letter_requested', police_letter_requested_by = auth.uid(), police_letter_requested_at = now() where id = w.id;
  perform app.notify_many(array[e.see_id], 'police_report', 'Police report letter requested – ' || w.full_name,
    format('%s · %s · asked by %s · enter the validity and release the letter', w.company, app.exec_head(e.id), app.display_name(auth.uid())),
    'normal', 'exec_project', e.id, '/execution/worker/' || w.id);
end $$;

-- SEE: release the letters (one validity date for the chosen workers); returns the number released
create or replace function public.issue_police_letters(p_workers uuid[], p_valid_until date) returns int
language plpgsql security definer set search_path = public as $$
declare w public.exec_workers; e public.exec_projects; n int := 0; seq int;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'The Senior Electrical Engineer releases police report letters');
  perform app.require(p_valid_until is not null and p_valid_until >= (now() at time zone app.tz())::date, 'Enter the date the letter is valid until');
  perform app.require(cardinality(coalesce(p_workers, '{}')) > 0, 'Choose the workers');
  for w in select * from public.exec_workers where id = any (p_workers) order by full_name for update loop
    perform app.require(w.status = 'active', w.full_name || ' is off site');
    perform app.require(w.police_status not in ('submitted', 'accepted'), w.full_name || ' already has a police report');
    select * into e from public.exec_projects where id = w.exec_project_id for update;
    perform app.require(coalesce(e.letter_sign_name, '') <> '', 'Enter the signing authority of the letters in the project''s police-report settings first');
    update public.exec_projects set police_letter_seq = police_letter_seq + 1 where id = e.id returning police_letter_seq into seq;
    update public.exec_workers set police_status = 'letter_issued', police_letter_no = format('%s/PR/%s', coalesce(e.wbs_no, e.code), lpad(seq::text, 3, '0')),
      police_letter_valid_until = p_valid_until, police_letter_issued_by = auth.uid(), police_letter_issued_at = now()
    where id = w.id;
    perform app.notify_many(app.worker_alert_to(w) || array[w.police_letter_requested_by], 'police_report', 'Police report letter ready – ' || w.full_name,
      format('%s · valid until %s · download it from the worker and give it to the worker', app.exec_head(e.id), to_char(p_valid_until, 'DD Mon YYYY')),
      'normal', 'exec_project', e.id, '/execution/worker/' || w.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Supervisor / AE: the police report is uploaded on the worker – submit it (lifts the block)
create or replace function public.submit_police_report(p_worker uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w public.exec_workers;
begin
  select * into w from public.exec_workers where id = p_worker for update;
  perform app.require(w.id is not null, 'Worker not found');
  perform app.require(app.is_project_ae(w.exec_project_id) or w.supervisor_id = auth.uid() or w.added_by = auth.uid() or app.has_role('senior_elec_engineer'),
    'The supervisor of the crew or an Assistant Engineer submits the police report');
  perform app.require(w.police_status not in ('submitted', 'accepted'), 'Already submitted');
  perform app.require(app.has_attachment('exec_worker', w.id, 'police_report'), 'Upload the police report first');
  update public.exec_workers set police_status = 'submitted', police_submitted_by = auth.uid(), police_submitted_at = now(), police_blocked_at = null,
    police_note = null where id = w.id;
  perform app.notify_many(app.project_aes(w.exec_project_id) || array[(select see_id from public.exec_projects where id = w.exec_project_id)], 'police_report',
    'Police report to check – ' || w.full_name, format('%s · %s · submitted by %s', w.company, app.exec_head(w.exec_project_id), app.display_name(auth.uid())),
    'normal', 'exec_project', w.exec_project_id, '/execution/worker/' || w.id);
end $$;

-- AE / SEE: accept, or return with the reason (blocked again at once if the 2 days are over)
create or replace function public.decide_police_report(p_worker uuid, p_accept boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare w public.exec_workers;
begin
  select * into w from public.exec_workers where id = p_worker for update;
  perform app.require(w.id is not null and w.police_status = 'submitted', 'No police report waiting to be checked');
  perform app.require(app.is_project_ae(w.exec_project_id) or app.has_role('senior_elec_engineer'), 'An Assistant Engineer or the SEE checks police reports');
  if p_accept then
    update public.exec_workers set police_status = 'accepted', police_decided_by = auth.uid(), police_decided_at = now(), police_note = nullif(btrim(p_note), '') where id = w.id;
  else
    perform app.require(coalesce(btrim(p_note), '') <> '', 'Give the reason');
    update public.exec_workers set police_status = 'rejected', police_decided_by = auth.uid(), police_decided_at = now(), police_note = btrim(p_note),
      police_due_at = coalesce(police_due_at, now()), police_blocked_at = case when coalesce(police_due_at, now()) <= now() then now() end
    where id = w.id returning * into w;
    perform app.notify_many(app.worker_alert_to(w), 'police_report',
      case when w.police_blocked_at is not null then 'Worker blocked – police report returned: ' else 'Police report returned – ' end || w.full_name,
      format('%s · %s', app.exec_head(w.exec_project_id), btrim(p_note)), case when w.police_blocked_at is not null then 'critical' else 'normal' end::public.priority,
      'exec_project', w.exec_project_id, '/execution/worker/' || w.id);
  end if;
end $$;

-- Every 30 minutes: block workers whose 2 days ran out, and tell the supervisor and the Assistant Engineers
create or replace function public.police_tick() returns int
language plpgsql security definer set search_path = public as $$
declare w public.exec_workers; n int := 0;
begin
  for w in select x.* from public.exec_workers x join public.exec_projects e on e.id = x.exec_project_id
            where e.police_required and e.status = 'active' and x.status = 'active' and x.police_status not in ('submitted', 'accepted')
              and x.police_due_at <= now() and x.police_blocked_at is null for update of x loop
    update public.exec_workers set police_blocked_at = now() where id = w.id;
    perform app.notify_many(app.worker_alert_to(w), 'police_report', 'Worker blocked – no police report: ' || w.full_name,
      format('%s · %s · blocked from site work until the police report is submitted', w.company, app.exec_head(w.exec_project_id)),
      'critical', 'exec_project', w.exec_project_id, '/execution/worker/' || w.id, 'police_block:' || w.id::text);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.police_tick() from public, anon, authenticated;
grant execute on function public.police_tick() to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('police-tick', '*/30 * * * *', 'select public.police_tick()');
  end if;
end $$;


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
  perform app.require(coalesce(btrim(p ->> 'letter_sign_name'), '') <> '' and coalesce(btrim(p ->> 'letter_sign_designation'), '') <> '',
    'Enter the signing authority of the project letters (name and designation)');
  insert into public.exec_requests (code, kind, project_id, name, client_name, contract_value_lkr, contract_ref, site_address, start_date, end_date, areas, see_id, note,
                                    police_required, letter_sign_name, letter_sign_designation, letter_sign_phone)
  values (c, k, pr.id, nm, nullif(btrim(p ->> 'client_name'), ''), nullif(p ->> 'contract_value', '')::numeric, nullif(btrim(p ->> 'contract_ref'), ''),
          nullif(btrim(p ->> 'site_address'), ''), nullif(p ->> 'start_date', '')::date, nullif(p ->> 'end_date', '')::date, ar,
          coalesce(nullif(p ->> 'see_id', '')::uuid, case when k = 'legacy' then auth.uid() end), nullif(btrim(p ->> 'note'), ''),
          coalesce((p ->> 'police_required')::boolean, false), btrim(p ->> 'letter_sign_name'), btrim(p ->> 'letter_sign_designation'), nullif(btrim(p ->> 'letter_sign_phone'), ''))
  returning id into rid;
  perform app.notify_many(app.role_users('sm_projects'), 'exec_request',
    case k when 'won' then 'Won project to hand over to execution' else 'Project won before the system – approve for execution' end,
    format('%s · %s · by %s', c, nm, app.display_name(auth.uid())), 'normal', 'exec_request', rid, '/execution/handover/' || rid, null, true);
  return rid;
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
  when 'sub_cert' then
    return exists (select 1 from public.sub_certs x where x.id = a.entity_id and (r in ('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec') or x.prepared_by = auth.uid()));
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = a.entity_id
      and (r in ('sm_projects', 'gm', 'operations_exec', 'senior_elec_engineer') or x.requested_by = auth.uid() or (x.exec_project_id is not null and app.is_exec_internal(x.exec_project_id))));
  else
    return r = 'gm';
  end case;
end $$;

revoke execute on function public.set_police_settings(uuid, jsonb) from public, anon;
grant execute on function public.set_police_settings(uuid, jsonb) to authenticated, service_role;
revoke execute on function public.request_police_letter(uuid) from public, anon;
grant execute on function public.request_police_letter(uuid) to authenticated, service_role;
revoke execute on function public.issue_police_letters(uuid[], date) from public, anon;
grant execute on function public.issue_police_letters(uuid[], date) to authenticated, service_role;
revoke execute on function public.submit_police_report(uuid) from public, anon;
grant execute on function public.submit_police_report(uuid) to authenticated, service_role;
revoke execute on function public.decide_police_report(uuid, boolean, text) from public, anon;
grant execute on function public.decide_police_report(uuid, boolean, text) to authenticated, service_role;
