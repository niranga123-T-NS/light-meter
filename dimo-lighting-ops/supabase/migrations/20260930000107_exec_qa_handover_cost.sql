-- Execution step 7b: QA / QC, snags, stage gates, handover dossier, cost and subcontractor payment certificates.
--  * Test instruments with calibration expiry: a test record cannot be saved with an expired instrument.
--  * Test records: typed rows (parameter, unit, min, max, value) evaluated automatically; any failure raises an NCR.
--    Recorded by Assistant Engineers, verified by the Senior Electrical Engineer, with the client / consultant witness.
--  * NCRs: description, root cause, corrective action, owner, due date; closed after re-inspection.
--  * Snags: location, photo, responsible party, priority, due; closed only with an after photo.
--  * Stage gates 1–6: the SEE requests with the gate checklist, data checks run automatically (open NCRs, failed tests,
--    open snags, missing mandatory dossier items, open material requests / HSE / variations); SM Projects approves – and
--    alone can pass a gate with items open, giving the reason. Gate 6 closes the project.
--  * Handover dossier: the mandatory items of each project area (template packs), each completed with its document.
--  * Cost: budget, committed and actual per cost code (entered / uploaded until the ERP link exists).
--  * Subcontractor payment certificates: Assistant Engineer prepares → SEE verifies → SM Projects approves → Operations pays.

-- ---------------------------------------------------------------------------
-- Area template packs (tests and handover evidence)
-- ---------------------------------------------------------------------------
create or replace function app.area_handover(p_area text) returns text[] language sql immutable as $$
  select case p_area
    when 'indoor' then array['Luminaire schedule', 'As-built drawings', 'Test certificates', 'O&M manuals']
    when 'outdoor' then array['Fixture schedule with GPS', 'As-built drawings', 'Test certificates']
    when 'facade' then array['Addressing map', 'Scene files', 'Mounting details', 'Maintenance access plan']
    when 'emergency' then array['Emergency layout', 'Test log book', 'Certificates']
    when 'central_battery' then array['Battery data', 'Commissioning report', 'Maintenance schedule', 'Test logs']
    when 'electrical' then array['Single-line diagrams', 'Circuit charts', 'Test certificates', 'O&M manuals']
    when 'underground_cabling' then array['Route as-builts with GPS and depths', 'Joint records', 'Test reports']
    when 'lighting_control' then array['Programming backups', 'Addressing schedule', 'Scene matrix', 'Training record']
    when 'lighting_measurement' then array['Measurement report', 'Grid data', 'Calibration certificates']
    when 'road' then array['Pole schedule with GPS', 'Photometric report', 'Cable route as-builts']
    when 'tunnel' then array['Zone luminance report', 'Control settings', 'As-built drawings']
    when 'sports' then array['Aiming report', 'Grid results vs class', 'Scene list']
    when 'port' then array['Mast certificates', 'Photometric survey', 'Maintenance schedule']
    when 'agl' then array['Circuit diagrams', 'CCR settings', 'IR and photometric records', 'Authority acceptance']
    when 'apron' then array['Aiming report', 'Photometric survey', 'Obstacle light records']
    when 'vdgs' then array['Stand calibration records', 'Aircraft database', 'Interface reports', 'Training record']
    when 'alcms' then array['Configuration backups', 'I/O lists', 'Network diagrams', 'Operator training']
    when 'smgcs' then array['Performance reports', 'Configuration', 'Training record', 'Authority acceptance']
    else '{}'::text[] end
$$;

-- ---------------------------------------------------------------------------
-- QA / QC
-- ---------------------------------------------------------------------------
create table public.test_instruments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  model text,
  serial_no text not null unique,
  calibration_due date not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.test_records (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  area text,
  system text not null,
  test_type text not null,
  instrument_id uuid references public.test_instruments (id),
  rows jsonb not null default '[]',
  result text not null check (result in ('pass', 'fail')),
  witness text,
  performed_by uuid not null default auth.uid() references public.profiles (id),
  performed_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted', 'verified', 'returned')),
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  note text
);
create table public.ncrs (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  test_record_id uuid references public.test_records (id),
  description text not null,
  severity text not null default 'major' check (severity in ('minor', 'major', 'critical')),
  root_cause text,
  corrective_action text,
  owner_id uuid references public.profiles (id),
  due_date date,
  status text not null default 'open' check (status in ('open', 'closed')),
  raised_by uuid default auth.uid() references public.profiles (id),
  raised_at timestamptz not null default now(),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  close_note text
);
create table public.snags (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  location text not null,
  description text not null,
  responsible text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_date date,
  status text not null default 'open' check (status in ('open', 'closed')),
  raised_by uuid default auth.uid() references public.profiles (id),
  raised_at timestamptz not null default now(),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz
);
create table public.exec_gates (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  gate int not null check (gate between 1 and 6),
  checklist jsonb not null default '{}',
  checks jsonb not null default '[]',
  requested_by uuid default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  override boolean not null default false,
  note text
);
create table public.exec_dossier (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  area text not null,
  item text not null,
  mandatory boolean not null default true,
  done boolean not null default false,
  done_by uuid references public.profiles (id),
  done_at timestamptz,
  unique (exec_project_id, area, item)
);
create table public.exec_cost_lines (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  cost_code text not null check (cost_code in ('material', 'labour', 'subcontract', 'equipment', 'overheads')),
  description text not null,
  budget numeric(16, 2) not null default 0,
  committed numeric(16, 2) not null default 0,
  actual numeric(16, 2) not null default 0,
  updated_by uuid default auth.uid() references public.profiles (id),
  updated_at timestamptz not null default now()
);
create table public.sub_certs (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  subcontractor text not null,
  period text not null,
  gross numeric(16, 2) not null,
  previous numeric(16, 2) not null default 0,
  retention_pct numeric(5, 2) not null default 0,
  deductions numeric(16, 2) not null default 0,
  net numeric(16, 2) generated always as (round((gross - previous) * (1 - retention_pct / 100) - deductions, 2)) stored,
  note text,
  status text not null default 'prepared' check (status in ('prepared', 'verified', 'approved', 'paid', 'returned')),
  prepared_by uuid default auth.uid() references public.profiles (id),
  prepared_at timestamptz not null default now(),
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  paid_ref text,
  paid_at timestamptz,
  return_note text
);

alter table public.test_instruments enable row level security;
alter table public.test_records enable row level security;
alter table public.ncrs enable row level security;
alter table public.snags enable row level security;
alter table public.exec_gates enable row level security;
alter table public.exec_dossier enable row level security;
alter table public.exec_cost_lines enable row level security;
alter table public.sub_certs enable row level security;
create policy test_instruments_read on public.test_instruments for select to authenticated using (not app.is_external() and app.my_role() is not null);
create policy test_records_read on public.test_records for select to authenticated using (app.is_exec_internal(exec_project_id));
create policy ncrs_read on public.ncrs for select to authenticated using (app.is_exec_internal(exec_project_id) or owner_id = auth.uid());
create policy snags_read on public.snags for select to authenticated using (app.is_exec_internal(exec_project_id));
create policy exec_gates_read on public.exec_gates for select to authenticated using (app.is_exec_internal(exec_project_id));
create policy exec_dossier_read on public.exec_dossier for select to authenticated using (app.is_exec_internal(exec_project_id));
-- Costs: never to field staff below the SEE (and never to supervisors)
create policy exec_cost_lines_read on public.exec_cost_lines for select to authenticated using (app.has_role('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec'));
create policy sub_certs_read on public.sub_certs for select to authenticated
  using (app.has_role('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec') or (app.is_project_ae(exec_project_id) and prepared_by = auth.uid()));
-- The design team sees the execution project list (names for design queries, the document register) – nothing else of the project
create policy exec_projects_read_design on public.exec_projects for select to authenticated using (app.has_role('design_manager', 'lighting_designer', 'lighting_engineer'));
grant select on public.test_instruments, public.test_records, public.ncrs, public.snags, public.exec_gates, public.exec_dossier, public.exec_cost_lines, public.sub_certs to authenticated;

create or replace function public.save_instrument(p_id uuid, p_name text, p_model text, p_serial text, p_due date, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare iid uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'operations_exec', 'sm_projects'), 'Not allowed');
  perform app.require(coalesce(btrim(p_name), '') <> '' and coalesce(btrim(p_serial), '') <> '' and p_due is not null, 'Enter name, serial number and calibration due date');
  if p_id is null then
    insert into public.test_instruments (name, model, serial_no, calibration_due) values (btrim(p_name), nullif(btrim(p_model), ''), btrim(p_serial), p_due) returning id into iid;
  else
    update public.test_instruments set name = btrim(p_name), model = nullif(btrim(p_model), ''), serial_no = btrim(p_serial), calibration_due = p_due, active = p_active
    where id = p_id returning id into iid;
  end if;
  return iid;
end $$;

-- p: {area, system, test_type, instrument_id, witness, note, rows: [{param, unit, min, max, value}]}
create or replace function public.record_test(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare ins public.test_instruments; r jsonb; v numeric; mn numeric; mx numeric; rows_out jsonb := '[]'; fail boolean := false; tid uuid; ok boolean; c text;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec), 'Assistant Engineers of the project record tests');
  perform app.require(coalesce(btrim(p ->> 'system'), '') <> '' and coalesce(btrim(p ->> 'test_type'), '') <> '', 'Enter the system and the test');
  if nullif(p ->> 'instrument_id', '') is not null then
    select * into ins from public.test_instruments where id = (p ->> 'instrument_id')::uuid;
    perform app.require(ins.id is not null and ins.active, 'Unknown instrument');
    perform app.require(ins.calibration_due >= (now() at time zone app.tz())::date,
      format('Calibration of %s (%s) expired on %s – the test cannot be saved', ins.name, ins.serial_no, to_char(ins.calibration_due, 'DD Mon YYYY')));
  end if;
  for r in select * from jsonb_array_elements(coalesce(p -> 'rows', '[]')) loop
    continue when coalesce(btrim(r ->> 'param'), '') = '';
    v := nullif(r ->> 'value', '')::numeric; mn := nullif(r ->> 'min', '')::numeric; mx := nullif(r ->> 'max', '')::numeric;
    perform app.require(v is not null, 'Enter the value for ' || (r ->> 'param'));
    ok := (mn is null or v >= mn) and (mx is null or v <= mx);
    fail := fail or not ok;
    rows_out := rows_out || jsonb_build_array(jsonb_build_object('param', btrim(r ->> 'param'), 'unit', r ->> 'unit', 'min', mn, 'max', mx, 'value', v, 'pass', ok));
  end loop;
  perform app.require(jsonb_array_length(rows_out) > 0, 'Enter at least one reading');
  c := app.next_code('TST');
  insert into public.test_records (code, exec_project_id, area, system, test_type, instrument_id, rows, result, witness, note)
  values (c, p_exec, nullif(p ->> 'area', ''), btrim(p ->> 'system'), btrim(p ->> 'test_type'), ins.id, rows_out, case when fail then 'fail' else 'pass' end,
          nullif(btrim(p ->> 'witness'), ''), nullif(btrim(p ->> 'note'), ''))
  returning id into tid;
  if fail then
    insert into public.ncrs (code, exec_project_id, test_record_id, description, severity, owner_id, due_date)
    values (app.next_code('NCR'), p_exec, tid, format('Failed %s – %s (%s)', btrim(p ->> 'test_type'), btrim(p ->> 'system'), c), 'major', auth.uid(),
            (now() at time zone app.tz())::date + 7);
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_qa', 'Test failed – NCR raised', format('%s · %s · %s', c, btrim(p ->> 'system'), app.exec_head(p_exec)),
      'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=qa', null, true);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_qa', 'Test record to verify', format('%s · %s · %s', c, btrim(p ->> 'system'), app.exec_head(p_exec)),
      'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=qa');
  end if;
  return tid;
end $$;

create or replace function public.verify_test(p_id uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t public.test_records;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer verifies test records');
  select * into t from public.test_records where id = p_id for update;
  perform app.require(t.id is not null and t.status = 'submitted', 'Not waiting for verification');
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Say what is wrong');
  update public.test_records set status = case when p_ok then 'verified' else 'returned' end, verified_by = auth.uid(), verified_at = now(), note = coalesce(nullif(btrim(p_note), ''), note) where id = t.id;
  perform app.notify(t.performed_by, 'exec_qa', case when p_ok then 'Test record verified' else 'Test record returned' end, concat_ws(' · ', t.code, t.system, nullif(btrim(p_note), '')),
    'normal', 'exec_project', t.exec_project_id, '/execution/' || t.exec_project_id || '?tab=qa');
end $$;

-- p: {description, severity, owner_id, due_date}
create or replace function public.raise_ncr(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects') or app.is_project_ae(p_exec), 'Not allowed');
  perform app.require(coalesce(btrim(p ->> 'description'), '') <> '', 'Describe the non-conformance');
  insert into public.ncrs (code, exec_project_id, description, severity, owner_id, due_date)
  values (app.next_code('NCR'), p_exec, btrim(p ->> 'description'), coalesce(nullif(p ->> 'severity', ''), 'major'), coalesce(nullif(p ->> 'owner_id', '')::uuid, auth.uid()),
          nullif(p ->> 'due_date', '')::date)
  returning id into nid;
  perform app.notify_many(array_remove(app.role_users('senior_elec_engineer') || array[nullif(p ->> 'owner_id', '')::uuid], auth.uid()), 'exec_qa', 'NCR raised',
    btrim(p ->> 'description') || ' · ' || app.exec_head(p_exec), 'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=qa', null, true);
  return nid;
end $$;

create or replace function public.close_ncr(p_id uuid, p_root text, p_action text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare n public.ncrs;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer closes NCRs after re-inspection');
  select * into n from public.ncrs where id = p_id for update;
  perform app.require(n.id is not null and n.status = 'open', 'Not open');
  perform app.require(coalesce(btrim(p_root), '') <> '' and coalesce(btrim(p_action), '') <> '', 'Enter the root cause and the corrective action');
  update public.ncrs set status = 'closed', root_cause = btrim(p_root), corrective_action = btrim(p_action), close_note = nullif(btrim(p_note), ''),
    closed_by = auth.uid(), closed_at = now() where id = n.id;
end $$;

-- ---------------------------------------------------------------------------
-- Snags
-- ---------------------------------------------------------------------------
create or replace function public.raise_snag(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects') or app.is_project_ae(p_exec), 'Not allowed');
  perform app.require(coalesce(btrim(p ->> 'location'), '') <> '' and coalesce(btrim(p ->> 'description'), '') <> '' and coalesce(btrim(p ->> 'responsible'), '') <> '',
    'Enter the location, the snag and who is responsible');
  insert into public.snags (exec_project_id, location, description, responsible, priority, due_date)
  values (p_exec, btrim(p ->> 'location'), btrim(p ->> 'description'), btrim(p ->> 'responsible'), coalesce(nullif(p ->> 'priority', ''), 'normal'), nullif(p ->> 'due_date', '')::date)
  returning id into sid;
  return sid;
end $$;

create or replace function public.close_snag(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.snags;
begin
  select * into s from public.snags where id = p_id for update;
  perform app.require(s.id is not null and s.status = 'open', 'Not open');
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(s.exec_project_id), 'Not allowed');
  perform app.require(app.has_attachment('snag', s.id, 'snag_after'), 'Attach the after photo first');
  update public.snags set status = 'closed', closed_by = auth.uid(), closed_at = now() where id = s.id;
end $$;

-- ---------------------------------------------------------------------------
-- Handover dossier
-- ---------------------------------------------------------------------------
create or replace function public.ensure_dossier(p_exec uuid) returns int
language plpgsql security definer set search_path = public as $$
declare a text; it text; n int := 0;
begin
  perform app.require(app.is_exec_internal(p_exec), 'Not allowed');
  foreach a in array (select areas from public.exec_projects where id = p_exec) loop
    foreach it in array app.area_handover(a) loop
      insert into public.exec_dossier (exec_project_id, area, item) values (p_exec, a, it) on conflict do nothing;
      if found then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $$;

create or replace function public.complete_dossier_item(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d public.exec_dossier;
begin
  select * into d from public.exec_dossier where id = p_id for update;
  perform app.require(d.id is not null, 'Item not found');
  perform app.require(app.has_role('senior_elec_engineer', 'operations_exec') or app.is_project_ae(d.exec_project_id), 'Not allowed');
  perform app.require(not p_done or app.has_attachment('dossier_item', d.id, 'dossier_doc'), 'Attach the document first');
  update public.exec_dossier set done = p_done, done_by = case when p_done then auth.uid() end, done_at = case when p_done then now() end where id = d.id;
end $$;

-- ---------------------------------------------------------------------------
-- Stage gates
-- ---------------------------------------------------------------------------
create or replace function app.gate_checks(p_exec uuid, p_gate int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb := '[]'; n int;
begin
  if p_gate >= 3 then
    select count(*) into n from public.ncrs where exec_project_id = p_exec and status = 'open' and (p_gate >= 4 or severity = 'critical');
    c := c || jsonb_build_array(jsonb_build_object('check', case when p_gate >= 4 then 'No open NCR' else 'No open critical NCR' end, 'ok', n = 0, 'detail', n || ' open'));
  end if;
  if p_gate >= 4 then
    select count(*) into n from public.test_records where exec_project_id = p_exec and (status <> 'verified');
    c := c || jsonb_build_array(jsonb_build_object('check', 'All test records verified', 'ok', n = 0, 'detail', n || ' not verified'));
    select count(*) into n from public.test_records t where t.exec_project_id = p_exec and t.result = 'fail'
      and exists (select 1 from public.ncrs x where x.test_record_id = t.id and x.status = 'open');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No failed test without a closed NCR', 'ok', n = 0, 'detail', n || ' open'));
  end if;
  if p_gate >= 5 then
    select count(*) into n from public.snags where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'All snags closed', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.exec_dossier where exec_project_id = p_exec and mandatory and not done;
    c := c || jsonb_build_array(jsonb_build_object('check', 'Mandatory dossier items present', 'ok', n = 0 and exists (select 1 from public.exec_dossier where exec_project_id = p_exec), 'detail', n || ' missing'));
  end if;
  if p_gate = 6 then
    select count(*) into n from public.material_requests where exec_project_id = p_exec and status in ('submitted', 'pending_smp', 'approved', 'ordered', 'part_received');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open material requests / orders', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.hse_reports where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open HSE reports', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.variations where exec_project_id = p_exec and status in ('raised', 'pricing', 'pending_smp', 'pending_gm', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No variation still open', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.sub_certs where exec_project_id = p_exec and status in ('prepared', 'verified', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'Subcontractors finally certified and paid', 'ok', n = 0, 'detail', n || ' open'));
  end if;
  return c;
end $$;

create or replace function public.preview_gate(p_exec uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.exec_projects;
begin
  perform app.require(app.is_exec_internal(p_exec), 'Not allowed');
  select * into e from public.exec_projects where id = p_exec;
  return jsonb_build_object('gate', e.stage, 'checks', app.gate_checks(p_exec, e.stage));
end $$;

-- SEE requests the gate at the end of the current stage; p_checklist: the manual items confirmed
create or replace function public.request_gate(p_exec uuid, p_checklist jsonb, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; gid uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer requests the stage gate');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(e.id is not null and e.status = 'active', 'Project not active');
  perform app.require(not exists (select 1 from public.exec_gates where exec_project_id = p_exec and status = 'pending'), 'A gate is already waiting for SM Projects');
  insert into public.exec_gates (exec_project_id, gate, checklist, checks, note) values (p_exec, e.stage, coalesce(p_checklist, '{}'), app.gate_checks(p_exec, e.stage), nullif(btrim(p_note), ''))
  returning id into gid;
  perform app.notify_many(app.role_users('sm_projects'), 'exec_gate', format('Gate %s to approve – %s', e.stage, e.name), coalesce(btrim(p_note), ''), 'normal',
    'exec_project', p_exec, '/execution/' || p_exec, null, true);
  return gid;
end $$;

create or replace function public.decide_gate(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare g public.exec_gates; fresh jsonb; open_items boolean;
begin
  perform app.require(app.has_role('sm_projects'), 'SM Projects approves stage gates');
  select * into g from public.exec_gates where id = p_id for update;
  perform app.require(g.id is not null and g.status = 'pending', 'Not waiting');
  fresh := app.gate_checks(g.exec_project_id, g.gate);
  select exists (select 1 from jsonb_array_elements(fresh) x where not (x ->> 'ok')::boolean) into open_items;
  perform app.require(not p_approve or not open_items or coalesce(btrim(p_note), '') <> '', 'Items are open – give the reason to pass the gate anyway (override)');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.exec_gates set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    checks = fresh, override = p_approve and open_items, note = concat_ws(' · ', note, nullif(btrim(p_note), '')) where id = g.id;
  if p_approve then
    update public.exec_projects set stage = least(6, g.gate + 1), status = case when g.gate = 6 then 'closed' else status end, updated_at = now() where id = g.exec_project_id;
  end if;
  perform app.notify_many(app.role_users('senior_elec_engineer') || app.project_aes(g.exec_project_id), 'exec_gate',
    format('Gate %s %s%s', g.gate, case when p_approve then 'passed' else 'not passed' end, case when p_approve and open_items then ' (override)' else '' end),
    concat_ws(' · ', app.exec_head(g.exec_project_id), nullif(btrim(p_note), '')), 'normal', 'exec_project', g.exec_project_id, '/execution/' || g.exec_project_id);
end $$;

-- ---------------------------------------------------------------------------
-- Cost lines and subcontractor payment certificates
-- ---------------------------------------------------------------------------
create or replace function public.save_cost_line(p_exec uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'operations_exec'), 'The Senior Electrical Engineer or Operations maintain the cost lines');
  perform app.require(coalesce(btrim(p ->> 'description'), '') <> '', 'Describe the line');
  if p_id is null then
    insert into public.exec_cost_lines (exec_project_id, cost_code, description, budget, committed, actual)
    values (p_exec, p ->> 'cost_code', btrim(p ->> 'description'), coalesce(nullif(p ->> 'budget', '')::numeric, 0), coalesce(nullif(p ->> 'committed', '')::numeric, 0),
            coalesce(nullif(p ->> 'actual', '')::numeric, 0)) returning id into cid;
  else
    update public.exec_cost_lines set cost_code = p ->> 'cost_code', description = btrim(p ->> 'description'), budget = coalesce(nullif(p ->> 'budget', '')::numeric, 0),
      committed = coalesce(nullif(p ->> 'committed', '')::numeric, 0), actual = coalesce(nullif(p ->> 'actual', '')::numeric, 0), updated_by = auth.uid(), updated_at = now()
    where id = p_id and exec_project_id = p_exec returning id into cid;
  end if;
  -- Committed + actual above the budget of the project → SM Projects told (once a day)
  if (select sum(committed + actual) > sum(budget) * 1.0 and sum(budget) > 0 from public.exec_cost_lines where exec_project_id = p_exec) then
    perform app.notify_many(app.role_users('sm_projects', 'senior_elec_engineer'), 'exec_cost', 'Project cost above budget', app.exec_head(p_exec), 'normal', 'exec_project', p_exec,
      '/execution/' || p_exec || '?tab=cost', format('costover:%s:%s', p_exec, current_date));
  end if;
  return cid;
end $$;

-- p: {subcontractor, period, gross, previous, retention_pct, deductions, note}
create or replace function public.prepare_sub_cert(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec), 'Assistant Engineers of the project prepare payment certificates');
  perform app.require(coalesce(btrim(p ->> 'subcontractor'), '') <> '' and coalesce(btrim(p ->> 'period'), '') <> '' and nullif(p ->> 'gross', '') is not null,
    'Enter the subcontractor, period and gross value');
  insert into public.sub_certs (code, exec_project_id, subcontractor, period, gross, previous, retention_pct, deductions, note)
  values (app.next_code('SPC'), p_exec, btrim(p ->> 'subcontractor'), btrim(p ->> 'period'), (p ->> 'gross')::numeric, coalesce(nullif(p ->> 'previous', '')::numeric, 0),
          coalesce(nullif(p ->> 'retention_pct', '')::numeric, 0), coalesce(nullif(p ->> 'deductions', '')::numeric, 0), nullif(btrim(p ->> 'note'), ''))
  returning id into cid;
  perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_cost', 'Subcontractor payment certificate to verify', btrim(p ->> 'subcontractor') || ' · ' || app.exec_head(p_exec),
    'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=cost');
  return cid;
end $$;

create or replace function public.advance_sub_cert(p_id uuid, p_ok boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; nxt text;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  if c.status in ('prepared') then
    perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer verifies');
    nxt := case when p_ok then 'verified' else 'returned' end;
    update public.sub_certs set status = nxt, verified_by = auth.uid(), verified_at = now(), return_note = case when p_ok then null else btrim(p_note) end where id = c.id;
    if p_ok then perform app.notify_many(app.role_users('sm_projects'), 'exec_cost', 'Subcontractor payment certificate to approve', c.code || ' · ' || c.subcontractor || ' · ' ||
      app.fmt_money(c.net, 'LKR'), 'normal', 'exec_project', c.exec_project_id, '/execution/' || c.exec_project_id || '?tab=cost', null, true); end if;
  elsif c.status = 'verified' then
    perform app.require(app.has_role('sm_projects'), 'SM Projects approves');
    nxt := case when p_ok then 'approved' else 'returned' end;
    update public.sub_certs set status = nxt, approved_by = auth.uid(), approved_at = now(), return_note = case when p_ok then null else btrim(p_note) end where id = c.id;
    if p_ok then perform app.notify_many(app.role_users('operations_exec'), 'exec_cost', 'Subcontractor payment approved – process the payment', c.code || ' · ' || c.subcontractor ||
      ' · ' || app.fmt_money(c.net, 'LKR'), 'normal', 'exec_project', c.exec_project_id, '/execution/' || c.exec_project_id || '?tab=cost'); end if;
  elsif c.status = 'approved' then
    perform app.require(app.has_role('operations_exec'), 'Operations records the payment');
    perform app.require(p_ok and coalesce(btrim(p_note), '') <> '', 'Enter the payment reference');
    nxt := 'paid';
    update public.sub_certs set status = 'paid', paid_ref = btrim(p_note), paid_at = now() where id = c.id;
  elsif c.status = 'returned' then
    perform app.require(c.prepared_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Not allowed');
    nxt := 'prepared';
    update public.sub_certs set status = 'prepared', return_note = null where id = c.id;
  else
    perform app.require(false, 'Already paid');
  end if;
  return nxt;
end $$;

revoke execute on function public.save_instrument(uuid, text, text, text, date, boolean), public.record_test(uuid, jsonb), public.verify_test(uuid, boolean, text),
  public.raise_ncr(uuid, jsonb), public.close_ncr(uuid, text, text, text), public.raise_snag(uuid, jsonb), public.close_snag(uuid), public.ensure_dossier(uuid),
  public.complete_dossier_item(uuid, boolean), public.preview_gate(uuid), public.request_gate(uuid, jsonb, text), public.decide_gate(uuid, boolean, text),
  public.save_cost_line(uuid, uuid, jsonb), public.prepare_sub_cert(uuid, jsonb), public.advance_sub_cert(uuid, boolean, text) from public, anon;
grant execute on function public.save_instrument(uuid, text, text, text, date, boolean), public.record_test(uuid, jsonb), public.verify_test(uuid, boolean, text),
  public.raise_ncr(uuid, jsonb), public.close_ncr(uuid, text, text, text), public.raise_snag(uuid, jsonb), public.close_snag(uuid), public.ensure_dossier(uuid),
  public.complete_dossier_item(uuid, boolean), public.preview_gate(uuid), public.request_gate(uuid, jsonb, text), public.decide_gate(uuid, boolean, text),
  public.save_cost_line(uuid, uuid, jsonb), public.prepare_sub_cert(uuid, jsonb), public.advance_sub_cert(uuid, boolean, text) to authenticated;

-- Open items include NCRs owned
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
  union all
  select 'NCR', n.id, concat_ws(' · ', n.code, n.description), '/execution/' || n.exec_project_id || '?tab=qa'
  from public.ncrs n where n.owner_id = p_user and n.status = 'open'
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
  update public.ncrs set owner_id = p_to where owner_id = p_from and status = 'open';
  get diagnostics k = row_count; n := n + k;
  return n;
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
$$;

-- Attachments (copied from 20260930000106_exec_materials_docs_queries.sql with the new record types)
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
  else
    return r = 'gm';
  end case;
end $$;
