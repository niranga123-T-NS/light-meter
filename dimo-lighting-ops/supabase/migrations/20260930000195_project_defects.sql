-- Warranty and defects: product warranty (warranties / claims, as before) and project defects (this migration).
-- Project defects: faults in the work DIMO installed on a project (during the works, in the defects liability period, or after).
--  * Sales persons report a defect (e.g. a customer complaint on a visit) → "Reported", to be verified.
--  * SM Projects, the SEE and the project's Assistant Engineers log defects directly → "Open".
--  * The SEE or SM Projects verifies a reported defect (or rejects it with the reason) and assigns it: the engineer, who is responsible
--    (DIMO, a subcontractor – back-charge –, the client – chargeable –, or the manufacturer – raise a warranty claim) and the due date
--    (by severity: critical 2 days, major 7 days, minor 14 days unless set).
--  * The engineer inspects the defect on site (finding, cause, photo). When the cause is the product supplied, the SEE or the Operations
--    Executive creates a product warranty claim from it: the defect moves to product warranty (linked both ways).
--  * Otherwise the engineer records the rectification with an after photo → "Rectified"; the SEE or SM Projects closes it, or reopens it.
--  * Alerts: new defects → the SEE and SM Projects (critical → GM / DGM too); overdue → the engineer and the SEE every morning,
--    3+ days overdue → SM Projects; reported but not verified for a working day → the SEE and SM Projects.
--  * The project cannot be closed after the DLP while a defect is still open.
--  * Seen by the SEE, SM Projects, GM / DGM, the Operations Executive, the project's team, the person who reported it and the
--    project's sales person.

create table public.project_defects (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid references public.exec_projects (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  project_name text not null,
  customer text,
  site text,
  location text,                        -- where on the site (area, pole, zone …)
  title text not null,
  description text not null,
  category text not null check (category in ('lighting', 'electrical', 'controls', 'mechanical', 'civil', 'other')),
  severity text not null check (severity in ('critical', 'major', 'minor')),
  source text not null check (source in ('sales', 'client', 'site', 'dlp_inspection')),
  client_ref text,
  phase text not null check (phase in ('works', 'dlp', 'after_dlp', 'outside')),
  status text not null check (status in ('reported', 'open', 'assigned', 'rectified', 'closed', 'rejected', 'warranty')),
  reported_by uuid not null default auth.uid() references public.profiles (id),
  reported_at timestamptz not null default now(),
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  reject_reason text,
  assignee_id uuid references public.profiles (id),
  responsible text check (responsible in ('dimo', 'subcontractor', 'client', 'manufacturer')),
  responsible_company text,
  due_date date,
  assigned_by uuid references public.profiles (id),
  assigned_at timestamptz,
  inspection text,
  cause text check (cause in ('installation', 'product', 'damage', 'other')),
  inspected_by uuid references public.profiles (id),
  inspected_at timestamptz,
  warranty_claim_id uuid references public.warranty_claims (id) on delete set null,
  rectification text,
  rectified_by uuid references public.profiles (id),
  rectified_at timestamptz,
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  close_note text,
  reopen_count int not null default 0,
  last_reopen_reason text,
  updated_at timestamptz not null default now()
);
create index on public.project_defects (exec_project_id);
create index on public.project_defects (status);

create or replace function app.defect_logger(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('sm_projects', 'senior_elec_engineer') or (p_exec is not null and app.is_project_ae(p_exec))
$$;
create or replace function app.defect_manager() returns boolean
language sql stable security definer set search_path = public as $$ select app.has_role('sm_projects', 'senior_elec_engineer') $$;

create or replace function app.can_read_defect(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_defects d where d.id = p_id
                 and (d.reported_by = auth.uid() or d.assignee_id = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec')
                      or (d.exec_project_id is not null and app.is_exec_team(d.exec_project_id))
                      or (d.project_id is not null and exists (select 1 from public.projects p where p.id = d.project_id and p.owner_id = auth.uid()))))
$$;

alter table public.project_defects enable row level security;
create policy project_defects_read on public.project_defects for select to authenticated using (app.can_read_defect(id));
grant select on public.project_defects to authenticated;

create or replace function app.defect_head(d public.project_defects) returns text
language sql stable as $$
  select concat_ws(' · ', d.code, d.project_name, initcap(d.severity), d.title)
$$;
-- Who hears about a defect: the SEE, SM Projects, the project's AEs, the assignee, the reporter and the project's sales person
create or replace function app.defect_people(d public.project_defects) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array(select unnest(app.role_users('senior_elec_engineer', 'sm_projects'))
               union select unnest(case when d.exec_project_id is not null then app.project_aes(d.exec_project_id) else '{}'::uuid[] end)
               union select d.assignee_id union select d.reported_by
               union select p.owner_id from public.projects p where p.id = d.project_id)
$$;
create or replace function app.defect_due_days(p_sev text) returns int
language sql immutable as $$ select case p_sev when 'critical' then 2 when 'major' then 7 else 14 end $$;

-- Projects a defect can be logged against (execution projects; sales see their own projects)
create or replace function public.defect_projects()
returns table (exec_project_id uuid, project_id uuid, name text, customer text, site text, phase text)
language sql stable security definer set search_path = public as $$
  select e.id, e.project_id, coalesce(e.code || ' ', '') || e.name, coalesce(e.client_name, o.name), e.site_address,
         case when e.status = 'closed' then 'after_dlp' when e.stage = 3 then 'dlp' else 'works' end
    from public.exec_projects e left join public.projects p on p.id = e.project_id left join public.organizations o on o.id = p.organization_id
   where app.has_role('sm_projects', 'senior_elec_engineer', 'gm') or app.is_project_ae(e.id)
      or (app.is_sales_person() and p.owner_id = auth.uid())
  union all
  select null, p.id, p.name, o.name, null, 'outside'
    from public.projects p left join public.organizations o on o.id = p.organization_id
   where app.is_sales_person() and p.owner_id = auth.uid() and p.status in ('won', 'completed')
     and not exists (select 1 from public.exec_projects e where e.project_id = p.id)
  order by 3
$$;

-- Report (sales) or log (SM Projects, SEE, the project's AE). p: {exec_project_id | project_id | project_name, customer, site, location,
--   title, description, category, severity, source, client_ref}
create or replace function public.log_defect(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; pr public.projects; d public.project_defects; did uuid; logger boolean; ph text; nm text; cu text; si text;
begin
  select * into e from public.exec_projects where id = nullif(p ->> 'exec_project_id', '')::uuid;
  select * into pr from public.projects where id = coalesce(nullif(p ->> 'project_id', '')::uuid, e.project_id);
  if e.id is null and pr.id is not null then select * into e from public.exec_projects where project_id = pr.id; end if;
  logger := app.defect_logger(e.id);
  perform app.require(logger or app.is_sales_person(), 'Sales persons report defects; SM Projects, the SEE and the project''s Assistant Engineers log them');
  perform app.require(logger or pr.id is null or pr.owner_id = auth.uid() or pr.project_type = any (app.my_project_types()), 'Report defects on your own projects');
  nm := coalesce(case when e.id is not null then coalesce(e.code || ' ', '') || e.name end, pr.name, nullif(btrim(p ->> 'project_name'), ''));
  perform app.require(nm is not null, 'Choose the project, or enter its name');
  cu := coalesce(nullif(btrim(p ->> 'customer'), ''), e.client_name, (select o.name from public.organizations o where o.id = pr.organization_id));
  si := coalesce(nullif(btrim(p ->> 'site'), ''), e.site_address);
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'What is the defect? (short title)');
  perform app.require(length(btrim(coalesce(p ->> 'description', ''))) >= 15, 'Describe the defect (at least 15 characters)');
  perform app.require(p ->> 'category' in ('lighting', 'electrical', 'controls', 'mechanical', 'civil', 'other'), 'Choose the category');
  perform app.require(p ->> 'severity' in ('critical', 'major', 'minor'), 'Choose the severity');
  ph := case when e.id is null then 'outside' when e.status = 'closed' then 'after_dlp' when e.stage = 3 then 'dlp' else 'works' end;
  insert into public.project_defects (code, exec_project_id, project_id, project_name, customer, site, location, title, description, category, severity, source,
                                      client_ref, phase, status)
  values (app.next_code('DEF'), e.id, pr.id, nm, cu, si, nullif(btrim(p ->> 'location'), ''), btrim(p ->> 'title'), btrim(p ->> 'description'),
          p ->> 'category', p ->> 'severity', case when logger then coalesce(nullif(p ->> 'source', ''), 'site') else 'sales' end,
          nullif(btrim(p ->> 'client_ref'), ''), ph, case when logger then 'open' else 'reported' end)
  returning * into d;
  if logger then update public.project_defects set verified_by = auth.uid(), verified_at = now() where id = d.id; end if;
  perform app.notify_many(array(select x from unnest(app.defect_people(d)) x where x <> auth.uid()), 'defect',
    case when logger then 'Project defect logged' else 'Project defect reported – verify it' end, app.defect_head(d),
    case when d.severity = 'critical' then 'critical'::public.priority else 'normal'::public.priority end, 'project_defect', d.id, '/warranty/defects/' || d.id);
  if d.severity = 'critical' then
    perform app.notify_many(app.role_users('gm'), 'defect', 'Critical project defect', app.defect_head(d), 'critical', 'project_defect', d.id, '/warranty/defects/' || d.id);
  end if;
  return d.id;
end $$;

-- Verify a reported defect (→ open) or reject it (not a defect / not ours) with the reason
create or replace function public.verify_defect(p_id uuid, p_ok boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.project_defects;
begin
  select * into d from public.project_defects where id = p_id for update;
  perform app.require(found, 'Defect not found');
  perform app.require(app.defect_manager(), 'The SEE or SM Projects verifies defects');
  perform app.require(d.status in ('reported', 'open'), 'Already being handled');
  perform app.require(p_ok or coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  update public.project_defects set status = case when p_ok then 'open' else 'rejected' end, verified_by = auth.uid(), verified_at = now(),
         reject_reason = case when p_ok then null else btrim(p_reason) end, updated_at = now() where id = p_id;
  perform app.notify_many(array(select x from unnest(app.defect_people(d)) x where x <> auth.uid()), 'defect',
    case when p_ok then 'Project defect verified' else 'Project defect not accepted' end, app.defect_head(d) || coalesce(' · ' || btrim(p_reason), ''),
    'normal', 'project_defect', p_id, '/warranty/defects/' || p_id);
end $$;

-- Assign (or reassign): the engineer, who is responsible, the due date
create or replace function public.assign_defect(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d public.project_defects; a uuid := nullif(p ->> 'assignee_id', '')::uuid; due date := nullif(p ->> 'due_date', '')::date; resp text := p ->> 'responsible';
begin
  select * into d from public.project_defects where id = p_id for update;
  perform app.require(found, 'Defect not found');
  perform app.require(app.defect_manager(), 'The SEE or SM Projects assigns defects');
  perform app.require(d.status in ('reported', 'open', 'assigned'), 'Not open');
  perform app.require(a is not null and exists (select 1 from public.profiles where id = a and active and role in ('assistant_engineer', 'senior_elec_engineer')),
    'Choose the engineer (an Assistant Engineer or the SEE)');
  perform app.require(resp in ('dimo', 'subcontractor', 'client', 'manufacturer'), 'Who is responsible: DIMO, a subcontractor, the client or the manufacturer?');
  perform app.require(resp not in ('subcontractor') or coalesce(btrim(p ->> 'responsible_company'), '') <> '', 'Name the subcontractor (back-charge)');
  due := coalesce(due, (now() at time zone app.tz())::date + app.defect_due_days(d.severity));
  perform app.require(due >= (now() at time zone app.tz())::date, 'The due date cannot be in the past');
  update public.project_defects set status = 'assigned', assignee_id = a, responsible = resp, responsible_company = nullif(btrim(p ->> 'responsible_company'), ''),
         due_date = due, assigned_by = auth.uid(), assigned_at = now(), verified_by = coalesce(verified_by, auth.uid()), verified_at = coalesce(verified_at, now()),
         updated_at = now() where id = p_id;
  perform app.notify(a, 'defect', 'Project defect assigned to you', app.defect_head(d) || ' · due ' || to_char(due, 'DD Mon'),
    case when d.severity = 'critical' then 'critical'::public.priority else 'normal'::public.priority end, 'project_defect', p_id, '/warranty/defects/' || p_id);
end $$;

-- Inspection on site by the engineer: what was found and the cause. A product fault → the SEE / Operations create a product warranty claim.
create or replace function public.inspect_defect(p_id uuid, p_finding text, p_cause text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.project_defects;
begin
  select * into d from public.project_defects where id = p_id for update;
  perform app.require(found, 'Defect not found');
  perform app.require(d.status = 'assigned', 'Assign the defect first');
  perform app.require(d.assignee_id = auth.uid() or app.defect_manager() or (d.exec_project_id is not null and app.is_project_ae(d.exec_project_id)), 'The assigned engineer inspects the defect');
  perform app.require(length(btrim(coalesce(p_finding, ''))) >= 10, 'Describe what you found');
  perform app.require(p_cause in ('installation', 'product', 'damage', 'other'), 'Choose the cause');
  perform app.require(exists (select 1 from public.attachments where entity_type = 'project_defect' and entity_id = p_id and kind = 'defect_photo' and archived_at is null),
    'Attach a photo from the inspection');
  update public.project_defects set inspection = btrim(p_finding), cause = p_cause, inspected_by = auth.uid(), inspected_at = now(), updated_at = now() where id = p_id;
  perform app.notify_many(array(select x from unnest(app.defect_people(d) || case when p_cause = 'product' then app.role_users('operations_exec') else '{}'::uuid[] end) x where x <> auth.uid()),
    'defect', case when p_cause = 'product' then 'Defect inspected – product fault: create a product warranty claim' else 'Project defect inspected' end,
    app.defect_head(d) || ' · ' || btrim(p_finding), 'normal', 'project_defect', p_id, '/warranty/defects/' || p_id);
end $$;

-- Rectified: what was done, with an after photo
create or replace function public.rectify_defect(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.project_defects;
begin
  select * into d from public.project_defects where id = p_id for update;
  perform app.require(found, 'Defect not found');
  perform app.require(d.status = 'assigned', 'Assign the defect first');
  perform app.require(d.assignee_id = auth.uid() or app.defect_manager() or (d.exec_project_id is not null and app.is_project_ae(d.exec_project_id)), 'The assigned engineer records the rectification');
  perform app.require(d.inspected_at is not null, 'Record the inspection first');
  perform app.require(length(btrim(coalesce(p_action, ''))) >= 10, 'Describe what was done');
  perform app.require(exists (select 1 from public.attachments where entity_type = 'project_defect' and entity_id = p_id and kind = 'defect_after' and archived_at is null),
    'Attach a photo after the rectification');
  update public.project_defects set status = 'rectified', rectification = btrim(p_action), rectified_by = auth.uid(), rectified_at = now(), updated_at = now() where id = p_id;
  perform app.notify_many(array(select x from unnest(app.defect_people(d)) x where x <> auth.uid()), 'defect', 'Project defect rectified – check and close', app.defect_head(d),
    'normal', 'project_defect', p_id, '/warranty/defects/' || p_id);
end $$;

-- Close (checked on site) or reopen (not fixed) – SEE or SM Projects
create or replace function public.close_defect(p_id uuid, p_close boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.project_defects;
begin
  select * into d from public.project_defects where id = p_id for update;
  perform app.require(found, 'Defect not found');
  perform app.require(app.defect_manager(), 'The SEE or SM Projects closes or reopens defects');
  perform app.require(d.status = 'rectified' or (not p_close and d.status = 'closed'), 'Not rectified yet');
  perform app.require(p_close or coalesce(btrim(p_note), '') <> '', 'Why is it reopened?');
  if p_close then
    update public.project_defects set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_note = nullif(btrim(p_note), ''), updated_at = now() where id = p_id;
  else
    update public.project_defects set status = 'assigned', reopen_count = reopen_count + 1, last_reopen_reason = btrim(p_note), closed_by = null, closed_at = null,
           due_date = greatest(due_date, (now() at time zone app.tz())::date + 2), updated_at = now() where id = p_id;
  end if;
  perform app.notify_many(array(select x from unnest(app.defect_people(d)) x where x <> auth.uid()), 'defect',
    case when p_close then 'Project defect closed' else 'Project defect reopened' end, app.defect_head(d) || coalesce(' · ' || btrim(p_note), ''),
    'normal', 'project_defect', p_id, '/warranty/defects/' || p_id);
end $$;

-- Every morning: overdue defects and reported defects not yet verified
create or replace function public.defect_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; d public.project_defects; n int := 0; late int;
begin
  for d in select * from public.project_defects where status = 'assigned' and due_date < today loop
    late := today - d.due_date;
    perform app.notify_many(array[d.assignee_id] || app.role_users('senior_elec_engineer'), 'defect', format('Project defect %s day(s) overdue', late), app.defect_head(d),
      case when d.severity = 'critical' then 'critical'::public.priority else 'normal'::public.priority end, 'project_defect', d.id, '/warranty/defects/' || d.id,
      format('defect_late:%s:%s', d.id, today));
    if late >= 3 then
      perform app.notify_many(app.role_users('sm_projects'), 'defect', format('Project defect %s days overdue', late), app.defect_head(d), 'critical',
        'project_defect', d.id, '/warranty/defects/' || d.id, format('defect_late3:%s:%s', d.id, today));
    end if;
    n := n + 1;
  end loop;
  for d in select * from public.project_defects where status = 'reported' and reported_at < p_at - interval '1 day' loop
    perform app.notify_many(app.role_users('senior_elec_engineer', 'sm_projects'), 'defect', 'Reported defect not verified', app.defect_head(d), 'normal',
      'project_defect', d.id, '/warranty/defects/' || d.id, format('defect_verify:%s:%s', d.id, today));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.defect_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.defect_tick(timestamptz) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('defect-tick', '20 3 * * *', 'select public.defect_tick()');   -- 08:50 Sri Lanka time
  end if;
end $$;

-- A product warranty claim can be created from a project defect inspected as a product fault
alter table public.warranty_claims add column if not exists defect_id uuid references public.project_defects (id) on delete set null;
CREATE OR REPLACE FUNCTION public.log_warranty_claim(p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  w public.warranties;
  ln public.warranty_lines;
  r public.warranty_reports;
  c public.warranty_claims;
  today date := (now() at time zone app.tz())::date;
  inw boolean;
  via text := coalesce(nullif(p_data ->> 'reported_via', ''), 'customer_call');
  asg uuid := nullif(p_data ->> 'assignee_id', '')::uuid;
  desk boolean := app.is_warranty_desk();
  df public.project_defects;
begin
  perform app.require(desk or app.is_sales_person() or app.has_role('sm_projects'),
    'Only Operations, the Senior Electrical Engineer, sales persons and SM Projects raise warranty claims');
  -- From a project defect inspected as a product fault (the SEE or Operations): the defect moves to product warranty
  if nullif(p_data ->> 'defect_id', '') is not null then
    perform app.require(desk, 'The SEE or the Operations Executive creates the product warranty claim from a defect');
    select * into df from public.project_defects where id = (p_data ->> 'defect_id')::uuid for update;
    perform app.require(df.id is not null, 'Defect not found');
    perform app.require(df.status = 'assigned' and df.inspected_at is not null and df.cause = 'product', 'Only a defect inspected as a product fault moves to product warranty');
    if coalesce(btrim(p_data ->> 'description'), '') = '' then
      p_data := p_data || jsonb_build_object('description', df.title || ' – ' || df.inspection);
    end if;
    if coalesce(btrim(p_data ->> 'location'), '') = '' then p_data := p_data || jsonb_build_object('location', concat_ws(' · ', df.site, df.location)); end if;
    p_data := p_data || jsonb_build_object('reported_via', 'site_inspection');
    via := 'site_inspection';
  end if;
  -- Older project with no warranty record yet: the details entered with the claim create it (and its item)
  if nullif(p_data ->> 'warranty_id', '') is null and jsonb_typeof(p_data -> 'manual') = 'object' then
    p_data := p_data || app.quick_warranty(p_data -> 'manual');
  end if;
  select * into w from public.warranties where id = nullif(p_data ->> 'warranty_id', '')::uuid;
  perform app.require(w.id is not null and w.status = 'active', 'Choose the warranty (find it by invoice / contract number, customer or project)');
  perform app.require(desk or app.can_read_warranty(w.id), 'You can raise claims only on warranties of your own projects or categories');
  -- Raised by sales / SM Projects: Operations or the Senior Electrical Engineer verify it and assign the engineer
  if not desk then
    perform app.require(nullif(p_data ->> 'report_id', '') is null, 'Operations or the Senior Electrical Engineer convert reported issues');
  end if;
  if not app.has_role('senior_elec_engineer') then asg := null; end if;  -- only the Senior Electrical Engineer assigns engineers
  if nullif(p_data ->> 'line_id', '') is not null then
    select * into ln from public.warranty_lines where id = (p_data ->> 'line_id')::uuid and warranty_id = w.id;
    perform app.require(ln.id is not null, 'The line does not belong to this warranty');
    inw := ln.end_date >= today;
  else
    inw := exists (select 1 from public.warranty_lines where warranty_id = w.id and end_date >= today);
  end if;
  if nullif(p_data ->> 'report_id', '') is not null then
    select * into r from public.warranty_reports where id = (p_data ->> 'report_id')::uuid for update;
    perform app.require(r.id is not null and r.status = 'reported', 'This reported issue is already handled');
    via := 'sales_visit';
  end if;
  perform app.require(via in ('customer_call', 'customer_email', 'customer_letter', 'sales_visit', 'site_inspection', 'other'), 'Choose how it was reported');
  perform app.require(coalesce(nullif(btrim(p_data ->> 'description'), ''), r.description, '') <> '', 'Describe the failure');
  perform app.check_engineer(asg);
  insert into public.warranty_claims (warranty_id, line_id, reported_via, report_id, reported_by, description, quantity, location, in_warranty,
    assignee_id, assigned_at, needs_verification)
  values (w.id, ln.id, via, r.id, coalesce(r.sales_person_id, case when not desk then auth.uid() end),
    coalesce(nullif(btrim(p_data ->> 'description'), ''), r.description),
    coalesce(nullif(p_data ->> 'quantity', '')::numeric, r.quantity), coalesce(nullif(btrim(p_data ->> 'location'), ''), r.location), inw,
    asg, case when asg is not null then now() end, not desk)
  returning * into c;
  if df.id is not null then
    update public.warranty_claims set defect_id = df.id where id = c.id;
    update public.project_defects set status = 'warranty', warranty_claim_id = c.id, updated_at = now() where id = df.id;
    perform app.notify_many(array(select x from unnest(app.defect_people(df)) x where x <> auth.uid()), 'defect', 'Project defect moved to product warranty',
      app.defect_head(df) || ' · claim ' || c.code, 'normal', 'project_defect', df.id, '/warranty/defects/' || df.id);
  end if;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (w.id, c.id, 'claim_logged', format('Claim %s logged (%s)%s', c.code, case when inw then 'in warranty' else 'out of warranty' end,
          coalesce(' · assigned to ' || app.display_name(asg), '')));
  if r.id is not null then
    update public.warranty_reports set status = 'converted', claim_id = c.id, handled_by = auth.uid(), handled_at = now() where id = r.id;
    perform app.notify(r.sales_person_id, 'warranty_claim_opened', 'Claim opened from your visit report', app.claim_head(c),
      'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  end if;
  perform app.notify_many(array[w.owner_id] || app.role_users('operations_exec', 'senior_elec_engineer', 'sm_projects'), 'warranty_claim_logged',
    case when desk then 'Warranty claim logged' else format('Warranty claim raised by %s – verify and assign', coalesce(app.display_name(auth.uid()), 'sales')) end
      || case when inw then '' else ' – out of warranty' end, app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id), null, not desk);
  if asg is null then
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'warranty_claim_to_assign', 'Assign an engineer to warranty claim ' || c.code,
      app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id), null, true);
  end if;
  if asg is not null then
    perform app.notify(asg, 'warranty_claim_assigned', 'Warranty claim assigned to you – inspect the site', app.claim_head(c),
      'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  end if;
  return c.id;
end $function$;

-- Close-out after the DLP: all project defects closed
CREATE OR REPLACE FUNCTION app.gate_checks(p_exec uuid, p_gate integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select count(*) into n from public.exec_dossier where exec_project_id = p_exec and mandatory and not done and not removed;
    c := c || jsonb_build_array(jsonb_build_object('check', 'Mandatory dossier items present', 'ok', n = 0 and exists (select 1 from public.exec_dossier where exec_project_id = p_exec and not removed), 'detail', n || ' missing'));
    -- Leftover DIMO material must go back to SAP or to the Project returns stock before the DLP (cannot be overridden)
    select count(*) into n from public.project_leftovers(p_exec);
    c := c || jsonb_build_array(jsonb_build_object('check', 'Leftover material returned to SAP or Project returns', 'ok', n = 0, 'detail', n || ' item(s) still in the site store', 'hard', true));
  elsif p_gate = 3 then
    select count(*) into n from public.material_requests where exec_project_id = p_exec and status in ('submitted', 'pending_smp', 'approved', 'ordered', 'part_received');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open material requests / orders', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.hse_reports where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open HSE reports', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.variations where exec_project_id = p_exec and status in ('raised', 'pricing', 'pending_smp', 'pending_gm', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No variation still open', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.sub_certs where exec_project_id = p_exec and status in ('jm_requested', 'jm_scheduled', 'jm_ae', 'jm_see', 'jm_returned', 'draft', 'ae_review', 'returned', 'prepared', 'verified', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'Subcontractors finally certified and paid', 'ok', n = 0, 'detail', n || ' open'));
    -- Project defects must be closed (or rejected) before the project is closed after the DLP (cannot be overridden)
    select count(*) into n from public.project_defects where exec_project_id = p_exec and status in ('reported', 'open', 'assigned', 'rectified');
    c := c || jsonb_build_array(jsonb_build_object('check', 'All project defects closed', 'ok', n = 0, 'detail', n || ' open', 'hard', true));
  end if;
  return c;
end $function$;

-- Defect photos (before and after)
CREATE OR REPLACE FUNCTION app.can_write_attachment(p_entity_type text, p_entity_id uuid, p_kind text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.app_role := app.my_role();
begin
  case p_entity_type
  when 'instrument' then return r = 'operations_exec' and exists (select 1 from public.instruments where id = p_entity_id);
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
  when 'stock_snapshot' then return r = 'operations_exec' and exists (select 1 from public.stock_snapshots where id = p_entity_id);
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
      or (r = 'sub_supervisor' and app.can_read_mr(p_entity_id) and (p_kind is null or p_kind in ('mr_doc', 'grn_photo', 'datasheet')));
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
  when 'exec_project' then
    return (p_kind is null or p_kind in ('tpl_measurement', 'tpl_ipa', 'tpl_ipc')) and app.has_role('senior_elec_engineer')
      and exists (select 1 from public.exec_projects where id = p_entity_id);
  when 'sub_cert' then
    -- the IPC and measurement sheets: who prepared it, while a draft or returned · the marked-up copy: the AE / SEE while it waits for them
    return exists (select 1 from public.sub_certs x where x.id = p_entity_id and (
      ((p_kind is null or p_kind in ('ipc_draft', 'ipc_measure')) and x.status in ('draft', 'returned')
        and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')))
      or ((p_kind is null or p_kind = 'jm_sheet') and x.status in ('jm_scheduled', 'jm_returned')
        and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')))
      or ((p_kind is null or p_kind = 'jm_markup') and ((x.status = 'jm_ae' and app.is_project_ae(x.exec_project_id))
                                                        or (x.status = 'jm_see' and app.has_role('senior_elec_engineer'))))
      or ((p_kind is null or p_kind = 'ipc_markup') and ((x.status = 'ae_review' and app.is_project_ae(x.exec_project_id))
                                                         or (x.status = 'prepared' and app.has_role('senior_elec_engineer'))))));
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = p_entity_id and ((x.requested_by = auth.uid() and x.status = 'pending_smp') or app.has_role('sm_projects')));
  when 'scrap_disposal' then
    return exists (select 1 from public.scrap_disposals x where x.id = p_entity_id and (x.requested_by = auth.uid() or app.can_raise_scrap(x.exec_project_id))
                   and ((p_kind = 'scrap_photo' and x.status in ('draft', 'returned')) or (p_kind = 'scrap_evidence' and x.status = 'approved')));
  when 'scrap_quote' then
    return p_kind = 'scrap_quote' and exists (select 1 from public.scrap_quotes q join public.scrap_disposals x on x.id = q.disposal_id where q.id = p_entity_id
                   and x.status in ('draft', 'returned') and (x.requested_by = auth.uid() or app.can_raise_scrap(x.exec_project_id)));
  when 'project_defect' then
    return exists (select 1 from public.project_defects x where x.id = p_entity_id and app.can_read_defect(x.id)
                   and ((p_kind = 'defect_photo' and x.status in ('reported', 'open', 'assigned', 'rectified'))
                        or (p_kind = 'defect_after' and x.status in ('assigned', 'rectified')
                            and (x.assignee_id = auth.uid() or app.defect_manager() or (x.exec_project_id is not null and app.is_project_ae(x.exec_project_id))))));
  else return false;
  end case;
end $function$;

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
