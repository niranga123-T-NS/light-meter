-- HSE forms (DIMO OHS management system): 17 equipment checklists, 6 permits to work, toolbox talks, the induction
-- register and training attendance – each with its document number and issue as on the paper forms.
--  * EHS Officer: Assistant Engineers the Senior Electrical Engineer ticks on the project (any AE of the project while
--    none is ticked); the Senior Electrical Engineer can always sign. Site In-charge / Manager = Senior Electrical Engineer.
--  * Checklists are filled per piece of equipment (register per project). Any "No" = not accepted: the equipment is taken
--    out of use, an HSE report with a corrective action is raised and the Senior Electrical Engineer told. The next check
--    falls due by the equipment's frequency; first-aid items warn 30 days before expiry; ELCBs every quarter.
--  * Permits: requested (every control Yes / N/A) → approved by an EHS Officer (not the requester) → active for its time
--    window → closed by HSE. A permit still open after its finishing time is alerted.
--  * Toolbox talks take the activity from the day's plan and participants from the induction register.

alter table public.exec_members add column if not exists ehs_officer boolean not null default false;

create table if not exists public.hse_forms (
  code text primary key,
  doc_no text not null,
  issue text not null,
  issue_date date,
  kind text not null check (kind in ('checklist', 'kit', 'permit', 'tbt', 'induction', 'training')),
  title text not null,
  id_label text,
  frequency_days int,
  items jsonb not null default '[]',
  extra jsonb not null default '{}',
  sort int not null default 0
);
alter table public.hse_forms enable row level security;
drop policy if exists hse_forms_read on public.hse_forms;
create policy hse_forms_read on public.hse_forms for select to authenticated using (true);
grant select on public.hse_forms to authenticated;

create table if not exists public.hse_equipment (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  form_code text not null references public.hse_forms (code),
  name text not null,
  serial_no text,
  contractor text,
  first_deployed date,
  frequency_days int not null,
  status text not null default 'in_use' check (status in ('in_use', 'removed', 'off_site')),
  last_checked_at timestamptz,
  next_due date,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists hse_equipment_project on public.hse_equipment (exec_project_id, status);

create table if not exists public.hse_records (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  form_code text not null references public.hse_forms (code),
  equipment_id uuid references public.hse_equipment (id),
  header jsonb not null default '{}',
  answers jsonb not null default '{}',
  participants jsonb not null default '[]',
  accepted boolean,
  status text not null check (status in ('submitted', 'active', 'closed', 'rejected')),
  starts_at timestamptz,
  ends_at timestamptz,
  related_id uuid references public.hse_records (id),
  hse_report_id uuid references public.hse_reports (id),
  corrective_date date,
  corrective_note text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  sup_by uuid references public.profiles (id), sup_at timestamptz,
  ehs_by uuid references public.profiles (id), ehs_at timestamptz, ehs_note text,
  mgr_by uuid references public.profiles (id), mgr_at timestamptz,
  closed_by uuid references public.profiles (id), closed_at timestamptz, close_note text
);
create index if not exists hse_records_project on public.hse_records (exec_project_id, form_code, created_at desc);
create index if not exists hse_records_equipment on public.hse_records (equipment_id, created_at desc);

create table if not exists public.hse_inductions (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  inducted_on date not null,
  name text not null,
  nic text not null,
  company text,
  remarks text,
  instructor_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (exec_project_id, nic)
);

alter table public.hse_equipment enable row level security;
alter table public.hse_records enable row level security;
alter table public.hse_inductions enable row level security;
drop policy if exists hse_equipment_read on public.hse_equipment;
drop policy if exists hse_records_read on public.hse_records;
drop policy if exists hse_inductions_read on public.hse_inductions;
create policy hse_equipment_read on public.hse_equipment for select to authenticated using (app.can_read_exec(exec_project_id));
create policy hse_records_read on public.hse_records for select to authenticated using (app.can_read_exec(exec_project_id));
create policy hse_inductions_read on public.hse_inductions for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.hse_equipment, public.hse_records, public.hse_inductions to authenticated;

-- ---------------------------------------------------------------------------
-- Who signs
-- ---------------------------------------------------------------------------
create or replace function app.is_ehs(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer')
      or (app.is_project_ae(p_exec) and (
            exists (select 1 from public.exec_members m where m.exec_project_id = p_exec and m.user_id = auth.uid() and m.active and m.ehs_officer)
            or not exists (select 1 from public.exec_members m where m.exec_project_id = p_exec and m.active and m.ehs_officer)))
$$;

create or replace function app.project_ehs(p_exec uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.exec_members m where m.exec_project_id = p_exec and m.active and m.ehs_officer)
              then (select array_agg(m.user_id) from public.exec_members m join public.profiles p on p.id = m.user_id
                     where m.exec_project_id = p_exec and m.active and m.ehs_officer and p.active)
              else app.project_aes(p_exec) end
$$;

create or replace function public.set_ehs_officer(p_exec uuid, p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'The Senior Electrical Engineer names the EHS Officers');
  perform app.require(exists (select 1 from public.exec_members m join public.profiles p on p.id = m.user_id
                               where m.exec_project_id = p_exec and m.user_id = p_user and m.active and p.role = 'assistant_engineer'),
    'Choose an Assistant Engineer of this project');
  update public.exec_members set ehs_officer = p_on where exec_project_id = p_exec and user_id = p_user and active;
  if p_on then
    perform app.notify(p_user, 'hse_ehs', 'You are the EHS Officer – ' || app.exec_head(p_exec),
      'You approve and close permits to work and sign HSE checklists and toolbox talks on this project.', 'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=hse');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Equipment register
-- ---------------------------------------------------------------------------
create or replace function public.save_hse_equipment(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare f public.hse_forms; eid uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform app.require(app.is_exec_member(p_exec) or app.has_role('senior_elec_engineer'), 'You are not on this project');
  select * into f from public.hse_forms where code = p ->> 'form_code';
  perform app.require(f.kind in ('checklist', 'kit'), 'Choose the type of equipment');
  perform app.require(coalesce(btrim(p ->> 'name'), '') <> '', 'Name the equipment (e.g. Generator 60 kVA, DB-01)');
  if eid is null then
    insert into public.hse_equipment (exec_project_id, form_code, name, serial_no, contractor, first_deployed, frequency_days, next_due)
    values (p_exec, f.code, btrim(p ->> 'name'), nullif(btrim(p ->> 'serial_no'), ''), nullif(btrim(p ->> 'contractor'), ''),
            coalesce(nullif(p ->> 'first_deployed', '')::date, (now() at time zone app.tz())::date),
            coalesce(nullif(p ->> 'frequency_days', '')::int, f.frequency_days, 30), (now() at time zone app.tz())::date)
    returning id into eid;
  else
    update public.hse_equipment set name = btrim(p ->> 'name'), serial_no = nullif(btrim(p ->> 'serial_no'), ''), contractor = nullif(btrim(p ->> 'contractor'), ''),
      first_deployed = coalesce(nullif(p ->> 'first_deployed', '')::date, first_deployed),
      frequency_days = coalesce(nullif(p ->> 'frequency_days', '')::int, frequency_days),
      status = case when coalesce(p ->> 'status', '') = 'off_site' then 'off_site' else status end
    where id = eid and exec_project_id = p_exec;
  end if;
  return eid;
end $$;

-- ---------------------------------------------------------------------------
-- Checklists (equipment and first-aid kit)
-- ---------------------------------------------------------------------------
create or replace function app.qty_num(t text) returns numeric language sql immutable as $$
  select nullif(substring(coalesce(t, '') from '^\s*([0-9]+(\.[0-9]+)?)'), '')::numeric
$$;

create or replace function public.save_hse_checklist(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e public.hse_equipment; f public.hse_forms; it jsonb; a jsonb; rid uuid; ok boolean := true; crit boolean := false;
  bad text[] := '{}'; today date := (now() at time zone app.tz())::date; rep uuid; me_role public.app_role := app.my_role();
begin
  perform app.require(app.is_exec_member(p_exec) or app.has_role('senior_elec_engineer'), 'You are not on this project');
  select * into e from public.hse_equipment where id = nullif(p ->> 'equipment_id', '')::uuid and exec_project_id = p_exec;
  perform app.require(e.id is not null, 'Choose the equipment from the project register');
  select * into f from public.hse_forms where code = e.form_code;
  for it in select * from jsonb_array_elements(f.items) loop
    a := p -> 'answers' -> (it ->> 'no');
    if f.kind = 'kit' then
      perform app.require(a is not null and nullif(a ->> 'avail', '') is not null, format('Item %s %s: enter the available quantity', it ->> 'no', it ->> 'text'));
      if (a ->> 'avail')::numeric < coalesce(app.qty_num(it ->> 'req'), 0) then ok := false; bad := bad || format('%s short (%s of %s)', it ->> 'text', a ->> 'avail', it ->> 'req'); end if;
      if nullif(a ->> 'exp', '') is not null and (a ->> 'exp')::date < today then ok := false; bad := bad || format('%s expired %s', it ->> 'text', a ->> 'exp'); end if;
    else
      perform app.require(coalesce(a ->> 'a', '') in ('yes', 'no', 'na'), format('Answer point %s: %s', it ->> 'no', it ->> 'text'));
      if a ->> 'a' = 'no' then
        ok := false; bad := bad || format('%s %s%s', it ->> 'no', it ->> 'text', coalesce(' – ' || nullif(btrim(a ->> 'r'), ''), ''));
        if coalesce((it ->> 'critical')::boolean, false) then crit := true; end if;
      end if;
    end if;
  end loop;
  insert into public.hse_records (code, exec_project_id, form_code, equipment_id, header, answers, accepted, status, related_id,
                                  sup_by, sup_at, ehs_by, ehs_at, mgr_by, mgr_at)
  values (app.next_code('HSC'), p_exec, f.code, e.id, coalesce(p -> 'header', '{}'), coalesce(p -> 'answers', '{}'), ok, 'submitted',
          nullif(p ->> 'permit_id', '')::uuid,
          case when me_role = 'sub_supervisor' then auth.uid() end, case when me_role = 'sub_supervisor' then now() end,
          case when me_role = 'assistant_engineer' and app.is_ehs(p_exec) then auth.uid() end, case when me_role = 'assistant_engineer' and app.is_ehs(p_exec) then now() end,
          case when me_role = 'senior_elec_engineer' then auth.uid() end, case when me_role = 'senior_elec_engineer' then now() end)
  returning id into rid;
  update public.hse_equipment set last_checked_at = now(), next_due = today + frequency_days, status = case when ok then 'in_use' else 'removed' end where id = e.id;
  if not ok then
    -- Not accepted: out of use, corrective action through an HSE report, Senior Electrical Engineer told
    rep := public.report_hse(p_exec, jsonb_build_object(
      'kind', 'unsafe_condition', 'severity', case when crit then 'critical' when f.kind = 'kit' then 'medium' else 'high' end,
      'location', e.name || coalesce(' (' || e.serial_no || ')', ''),
      'description', format('%s %s not accepted – %s', f.doc_no, initcap(f.title), array_to_string(bad, '; ')),
      'immediate_action', case when f.kind = 'kit' then 'Refill / replace the items' else 'Removed from use until rectified and re-inspected' end));
    update public.hse_records set hse_report_id = rep where id = rid;
  end if;
  return rid;
end $$;

-- Corrective / preventive action recorded on the checklist (the equipment returns to use with the next accepted check)
create or replace function public.record_hse_correction(p_id uuid, p_date date, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.hse_records;
begin
  select * into r from public.hse_records where id = p_id;
  perform app.require(r.id is not null and r.accepted is false, 'Only a not-accepted checklist needs a corrective action');
  perform app.require(app.is_exec_member(r.exec_project_id) or app.has_role('senior_elec_engineer'), 'You are not on this project');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Say what was done');
  update public.hse_records set corrective_date = coalesce(p_date, (now() at time zone app.tz())::date), corrective_note = btrim(p_note) where id = r.id;
end $$;

-- Sign-offs: Contractor's Supervisor, EHS Officer, Site In-charge / Manager
create or replace function public.sign_hse_record(p_id uuid, p_as text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.hse_records;
begin
  select * into r from public.hse_records where id = p_id for update;
  perform app.require(r.id is not null, 'Not found');
  perform app.require((select kind from public.hse_forms where code = r.form_code) <> 'permit', 'Permits are approved and closed, not signed');
  case p_as
  when 'supervisor' then
    perform app.require(app.has_role('sub_supervisor') and app.is_exec_member(r.exec_project_id), 'Only a subcontractor supervisor of this project signs here');
    update public.hse_records set sup_by = auth.uid(), sup_at = now() where id = r.id;
  when 'ehs' then
    perform app.require(app.is_ehs(r.exec_project_id), 'Only the EHS Officer of this project signs here');
    update public.hse_records set ehs_by = auth.uid(), ehs_at = now() where id = r.id;
  when 'manager' then
    perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'The Senior Electrical Engineer signs as Site In-charge / Manager');
    perform app.require(r.ehs_by is not null or app.has_role('senior_elec_engineer'), 'The EHS Officer signs first');
    update public.hse_records set mgr_by = auth.uid(), mgr_at = now() where id = r.id;
  else raise exception 'Unknown sign-off';
  end case;
end $$;

-- ---------------------------------------------------------------------------
-- Permits to work
-- ---------------------------------------------------------------------------
create or replace function public.request_permit(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  f public.hse_forms; it jsonb; g jsonb; a jsonb; rid uuid; v_code text; q text[]; s timestamptz; e timestamptz; h jsonb := coalesce(p -> 'header', '{}');
  eq public.hse_equipment; rd jsonb; v numeric; i int;
begin
  perform app.require(app.is_exec_member(p_exec) or app.has_role('senior_elec_engineer'), 'You are not on this project');
  perform app.require(not app.has_role('trainee'), 'An Assistant Engineer or the supervisor requests permits');
  select * into f from public.hse_forms where code = p ->> 'form_code';
  perform app.require(f.kind = 'permit', 'Choose the permit type');
  perform app.require(coalesce(btrim(h ->> 'location'), '') <> '' and coalesce(btrim(h ->> 'description'), '') <> '', 'Enter the work location and the description of the work');
  perform app.require(coalesce(btrim(h ->> 'in_charge'), '') <> '' and coalesce(btrim(h ->> 'mobile'), '') <> '', 'Enter the in-charge (foreman / supervisor) and mobile number');
  s := nullif(p ->> 'starts_at', '')::timestamptz; e := nullif(p ->> 'ends_at', '')::timestamptz;
  perform app.require(s is not null and e is not null and e > s, 'Set the starting and finishing time');
  perform app.require(e - s <= interval '24 hours', 'A permit covers one shift – at most 24 hours');
  perform app.require(e > now(), 'The finishing time has already passed');
  select coalesce(array_agg(x), '{}') into q from jsonb_array_elements_text(coalesce(f.extra -> 'question_items', '[]')) x;
  for it in select * from jsonb_array_elements(f.items) loop
    a := p -> 'answers' -> (it ->> 'no');
    perform app.require(coalesce(a ->> 'a', '') in ('yes', 'no', 'na'), format('Answer control %s: %s', it ->> 'no', it ->> 'text'));
    perform app.require(a ->> 'a' <> 'no' or (it ->> 'no') = any (q),
      format('Control %s (%s) must be Yes or N/A before work starts – put it right first', it ->> 'no', it ->> 'text'));
  end loop;
  for g in select * from jsonb_array_elements(coalesce(f.extra -> 'groups', '[]')) loop
    i := 0;
    for it in select * from jsonb_array_elements_text(g -> 'items') loop
      i := i + 1;
      perform app.require(coalesce(p -> 'answers' -> ((g ->> 'no') || '.' || i) ->> 'a', '') in ('yes', 'no', 'na'),
        format('Answer %s.%s: %s', g ->> 'no', i, it #>> '{}'));
    end loop;
  end loop;
  if exists (select 1 from jsonb_array_elements_text(coalesce(f.extra -> 'explain_if_yes', '[]')) x where p -> 'answers' -> x ->> 'a' = 'yes') then
    perform app.require(coalesce(btrim(h ->> 'explain'), '') <> '', 'Explain the electrical or mechanical precautions');
  end if;
  -- Confined space: readings recorded and safe
  for rd in select * from jsonb_array_elements(coalesce(f.extra -> 'readings', '[]')) loop
    if p -> 'answers' -> (rd ->> 'item') ->> 'a' = 'yes' then
      perform app.require(nullif(h -> 'readings' ->> (rd ->> 'key'), '') is not null, format('Record the %s reading', rd ->> 'label'));
      v := (h -> 'readings' ->> (rd ->> 'key'))::numeric;
      perform app.require(case rd ->> 'key' when 'o2' then v between 19.5 and 23.5 when 'lel' then v < 10 when 'h2s' then v < 10 when 'co' then v < 25 else true end,
        format('%s %s is outside the safe limit (O2 19.5–23.5 %%, LEL < 10 %%, H2S < 10 ppm, CO < 25 ppm) – do not enter', rd ->> 'label', v));
    end if;
  end loop;
  if nullif(p ->> 'equipment_id', '') is not null then
    select * into eq from public.hse_equipment where id = (p ->> 'equipment_id')::uuid and exec_project_id = p_exec;
    perform app.require(eq.id is not null, 'Choose equipment of this project');
    perform app.require(eq.status = 'in_use' and eq.last_checked_at is not null and eq.next_due >= (now() at time zone app.tz())::date,
      format('%s has no accepted checklist in date – inspect it first', eq.name));
  end if;
  v_code := app.next_code('PTW');
  insert into public.hse_records (code, exec_project_id, form_code, equipment_id, header, answers, status, starts_at, ends_at, related_id)
  values (v_code, p_exec, f.code, eq.id, h, coalesce(p -> 'answers', '{}'), 'submitted', s, e, nullif(p ->> 'tbt_id', '')::uuid)
  returning id into rid;
  perform app.notify_many(array_remove(app.project_ehs(p_exec) || app.role_users('senior_elec_engineer'), auth.uid()), 'hse_permit',
    format('Permit to approve – %s %s', initcap(f.title), v_code),
    format('%s · %s · %s–%s · %s', app.exec_head(p_exec), btrim(h ->> 'location'), to_char(s at time zone app.tz(), 'DD Mon HH24:MI'),
           to_char(e at time zone app.tz(), 'HH24:MI'), app.display_name(auth.uid())),
    'critical', 'hse_record', rid, '/execution/hse/form/' || rid, null, true);
  return rid;
end $$;

create or replace function public.decide_permit(p_id uuid, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.hse_records;
begin
  select * into r from public.hse_records where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'submitted' and r.code like 'PTW-%', 'Nothing to approve');
  perform app.require(app.is_ehs(r.exec_project_id), 'Only the EHS Officer of this project approves permits');
  perform app.require(r.created_by <> auth.uid(), 'You requested this permit – another EHS Officer or the Senior Electrical Engineer approves it');
  perform app.require(p_approve or coalesce(btrim(p_comment), '') <> '', 'Say why it is not approved');
  update public.hse_records set status = case when p_approve then 'active' else 'rejected' end, ehs_by = auth.uid(), ehs_at = now(), ehs_note = nullif(btrim(p_comment), '')
  where id = r.id;
  perform app.notify(r.created_by, 'hse_permit', format('Permit %s %s', r.code, case when p_approve then 'approved – work can start' else 'not approved' end),
    coalesce(nullif(btrim(p_comment), ''), app.exec_head(r.exec_project_id)), 'critical', 'hse_record', r.id, '/execution/hse/form/' || r.id, null, true);
end $$;

create or replace function public.close_permit(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.hse_records;
begin
  select * into r from public.hse_records where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'active' and r.code like 'PTW-%', 'Only an active permit can be closed');
  perform app.require(app.is_ehs(r.exec_project_id), 'The EHS Officer closes the permit');
  update public.hse_records set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_note = nullif(btrim(p_note), '') where id = r.id;
end $$;

-- ---------------------------------------------------------------------------
-- Toolbox talks, training, induction
-- ---------------------------------------------------------------------------
create or replace function public.save_tbt(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; v_code text; h jsonb := coalesce(p -> 'header', '{}'); pm public.hse_records;
begin
  perform app.require(app.is_exec_member(p_exec) or app.has_role('senior_elec_engineer'), 'You are not on this project');
  perform app.require(coalesce(btrim(h ->> 'activity'), '') <> '', 'Enter the activity / work programme');
  perform app.require(coalesce(btrim(h ->> 'hazards'), '') <> '', 'Enter the safety issues (hazards and risks)');
  perform app.require(jsonb_array_length(coalesce(p -> 'participants', '[]')) > 0, 'Add the participants');
  if nullif(p ->> 'permit_id', '') is not null then
    select * into pm from public.hse_records where id = (p ->> 'permit_id')::uuid and exec_project_id = p_exec and code like 'PTW-%';
    perform app.require(pm.id is not null, 'Choose a permit of this project');
  end if;
  v_code := app.next_code('TBT');
  insert into public.hse_records (code, exec_project_id, form_code, header, answers, participants, status, starts_at, related_id,
                                  sup_by, sup_at, ehs_by, ehs_at)
  values (v_code, p_exec, 'TBT-01', h, coalesce(p -> 'answers', '{}'), p -> 'participants', 'submitted', coalesce(nullif(p ->> 'starts_at', '')::timestamptz, now()), pm.id,
          case when app.has_role('sub_supervisor') then auth.uid() end, case when app.has_role('sub_supervisor') then now() end,
          case when app.has_role('assistant_engineer') and app.is_ehs(p_exec) then auth.uid() end, case when app.has_role('assistant_engineer') and app.is_ehs(p_exec) then now() end)
  returning id into rid;
  if pm.id is not null then
    update public.hse_records set header = header || jsonb_build_object('tbt_no', v_code), related_id = coalesce(related_id, rid) where id = pm.id;
  end if;
  return rid;
end $$;

create or replace function public.save_training(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; h jsonb := coalesce(p -> 'header', '{}'); s timestamptz := nullif(p ->> 'starts_at', '')::timestamptz; e timestamptz := nullif(p ->> 'ends_at', '')::timestamptz; n int;
begin
  perform app.require(app.is_project_ae(p_exec) or app.has_role('senior_elec_engineer'), 'An Assistant Engineer of the project records training');
  perform app.require(coalesce(btrim(h ->> 'title'), '') <> '', 'Enter the training title');
  perform app.require(s is not null and e is not null and e > s, 'Set the time from and to');
  n := jsonb_array_length(coalesce(p -> 'participants', '[]'));
  perform app.require(n > 0, 'Add the participants');
  insert into public.hse_records (code, exec_project_id, form_code, header, participants, status, starts_at, ends_at)
  values (app.next_code('HTR'), p_exec, 'TR-01', h || jsonb_build_object('man_hours', round(n * extract(epoch from (e - s)) / 3600.0, 1)), p -> 'participants', 'submitted', s, e)
  returning id into rid;
  return rid;
end $$;

create or replace function public.add_induction(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare iid uuid; prev public.hse_inductions; v_nic text := upper(regexp_replace(coalesce(p ->> 'nic', ''), '\s', '', 'g'));
begin
  perform app.require(app.is_project_ae(p_exec) or app.has_role('senior_elec_engineer'), 'An Assistant Engineer of the project gives the induction');
  perform app.require(coalesce(btrim(p ->> 'name'), '') <> '', 'Enter the participant''s name');
  perform app.require(v_nic ~ '^([0-9]{9}[VX]|[0-9]{12})$', 'Enter a valid NIC number (9 digits + V/X, or 12 digits)');
  select * into prev from public.hse_inductions x where x.exec_project_id = p_exec and x.nic = v_nic;
  perform app.require(prev.id is null, format('%s was already inducted on this project on %s', prev.name, to_char(prev.inducted_on, 'DD Mon YYYY')));
  insert into public.hse_inductions (exec_project_id, inducted_on, name, nic, company, remarks, instructor_id)
  values (p_exec, coalesce(nullif(p ->> 'date', '')::date, (now() at time zone app.tz())::date), btrim(p ->> 'name'), v_nic,
          nullif(btrim(p ->> 'company'), ''), nullif(btrim(p ->> 'remarks'), ''), auth.uid())
  returning id into iid;
  return iid;
end $$;

-- Earlier inductions of a person (any project) to fill the name and company
create or replace function public.induction_lookup(p_nic text) returns table (name text, company text, inducted_on date, project text)
language sql stable security definer set search_path = public as $$
  select i.name, i.company, i.inducted_on, app.exec_head(i.exec_project_id) from public.hse_inductions i
   where i.nic = upper(regexp_replace(coalesce(p_nic, ''), '\s', '', 'g')) and app.has_role('assistant_engineer', 'senior_elec_engineer', 'sm_projects', 'trainee')
   order by i.inducted_on desc limit 5
$$;

-- ---------------------------------------------------------------------------
-- Reminders: permits past their finishing time, checks due, first-aid expiry, quarterly ELCB trip test
-- ---------------------------------------------------------------------------
create or replace function public.hse_forms_tick() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; today date := (now() at time zone app.tz())::date; loc time := (now() at time zone app.tz())::time;
begin
  for r in select x.*, f.title from public.hse_records x join public.hse_forms f on f.code = x.form_code
            where x.status = 'active' and x.code like 'PTW-%' and x.ends_at < now() - interval '30 minutes' loop
    perform app.notify_many(array[r.created_by] || app.project_ehs(r.exec_project_id), 'hse_permit', 'Permit not closed – ' || r.code,
      format('%s · %s · finishing time %s passed – close it or raise a new permit', app.exec_head(r.exec_project_id), initcap(r.title),
             to_char(r.ends_at at time zone app.tz(), 'DD Mon HH24:MI')),
      'critical', 'hse_record', r.id, '/execution/hse/form/' || r.id, 'ptw_open:' || r.id);
    n := n + 1;
  end loop;
  if loc >= time '07:00' then
    for r in select e.*, f.title from public.hse_equipment e join public.hse_forms f on f.code = e.form_code join public.exec_projects p on p.id = e.exec_project_id
              where e.status = 'in_use' and p.status = 'active' and e.next_due <= today loop
      perform app.notify_many(app.project_ehs(r.exec_project_id), 'hse_check_due', 'HSE check due – ' || r.name,
        format('%s · %s checklist%s', app.exec_head(r.exec_project_id), initcap(r.title), case when r.next_due < today then ' overdue since ' || to_char(r.next_due, 'DD Mon') else ' due today' end),
        'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=hse', 'hse_due:' || r.id || ':' || r.next_due);
      n := n + 1;
    end loop;
    for r in select e.id, e.exec_project_id, e.name, k.item, k.exp
               from public.hse_equipment e
               cross join lateral (select x.answers from public.hse_records x where x.equipment_id = e.id order by x.created_at desc limit 1) last
               cross join lateral (select it ->> 'text' item, (last.answers -> (it ->> 'no') ->> 'exp')::date exp
                                     from public.hse_forms f, jsonb_array_elements(f.items) it where f.code = e.form_code) k
              where e.form_code = 'CL-07' and e.status <> 'off_site' and k.exp is not null and k.exp <= today + 30 loop
      perform app.notify_many(app.project_ehs(r.exec_project_id), 'hse_kit_expiry', 'First-aid item expiring – ' || r.name,
        format('%s · %s %s %s', app.exec_head(r.exec_project_id), r.item, case when r.exp < today then 'expired' else 'expires' end, to_char(r.exp, 'DD Mon')),
        'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=hse', 'kit_exp:' || r.id || ':' || r.item || ':' || r.exp);
      n := n + 1;
    end loop;
    for r in select e.* from public.hse_equipment e
              where e.form_code in ('CL-16', 'CL-31') and e.status = 'in_use'
                and coalesce((select max(nullif(x.header ->> 'trip_value_tested', '')::date) from public.hse_records x where x.equipment_id = e.id), e.first_deployed) <= today - 90 loop
      perform app.notify_many(app.project_ehs(r.exec_project_id), 'hse_elcb_test', 'Quarterly ELCB trip-value test due – ' || r.name,
        app.exec_head(r.exec_project_id), 'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=hse',
        'elcb:' || r.id || ':' || to_char(today, 'YYYY-MM'));
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function public.hse_forms_tick() from public, anon, authenticated;
grant execute on function public.hse_forms_tick() to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('hse-forms-tick', '*/30 * * * *', 'select public.hse_forms_tick()');
  end if;
end $$;

-- Open permits for My Day / the project: what is waiting and what is active
create or replace function public.hse_summary(p_exec uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.can_read_exec(p_exec), 'Not allowed');
  return jsonb_build_object(
    'permits_waiting', (select count(*) from public.hse_records where exec_project_id = p_exec and code like 'PTW-%' and status = 'submitted'),
    'permits_active', (select count(*) from public.hse_records where exec_project_id = p_exec and code like 'PTW-%' and status = 'active'),
    'checks_due', (select count(*) from public.hse_equipment where exec_project_id = p_exec and status = 'in_use' and next_due <= (now() at time zone app.tz())::date),
    'removed', (select count(*) from public.hse_equipment where exec_project_id = p_exec and status = 'removed'),
    'inducted', (select count(*) from public.hse_inductions where exec_project_id = p_exec),
    'man_hours', (select coalesce(sum((header ->> 'man_hours')::numeric), 0) from public.hse_records where exec_project_id = p_exec and form_code = 'TR-01'),
    'can_ehs', app.is_ehs(p_exec));
end $$;


insert into public.hse_forms (code, doc_no, issue, issue_date, kind, title, id_label, frequency_days, items, extra, sort) values
('CL-03', 'DIMO-LTD-CL-03', '00', '2021-01-01', 'checklist', 'BOOM TRUCK/CRANE', 'Serial / Plate No', 7, '[{"no": "01", "text": "Crane hook latch is available and in good condition", "critical": true}, {"no": "02", "text": "Hoist limit switch is available", "critical": true}, {"no": "03", "text": "SWL marked in crane."}, {"no": "04", "text": "Wire rope and slings free from tolerable damage"}, {"no": "05", "text": "No oil leak in hydraulic parts"}, {"no": "06", "text": "Front and reverse horn is working"}, {"no": "07", "text": "Boom structure is in good condition"}, {"no": "08", "text": "Electrical system, running lights, brake lights and turn signals are working."}, {"no": "09", "text": "Operator''s Heavy vehicle license available"}, {"no": "10", "text": "Tires in good condition. (have no cuts, bulges, worn treads or steel belts showing)"}, {"no": "11", "text": "Side view and back view mirrors are available."}, {"no": "12", "text": "Automatic safe load indicator is available and working in good condition (ASLI).", "critical": true}, {"no": "13", "text": "Valid third party inspection certificate is available", "critical": true}]'::jsonb, '{}'::jsonb, 1),
('CL-05', 'DIMO-LTD-CL-05', '00', '2021-01-01', 'checklist', 'FIRE EXTINGUISHER', 'Serial No', 30, '[{"no": "01", "text": "Physical condition of the extinguisher is clean and tidy."}, {"no": "02", "text": "Cylinder and other metal parts are free from corrosion"}, {"no": "03", "text": "Pressure gauge or indicator is in the operable range.", "critical": true}, {"no": "04", "text": "Discharge nozzle is available and no physical damage."}, {"no": "05", "text": "No cracks in the hose."}, {"no": "06", "text": "The gauges indicator is in working condition."}, {"no": "07", "text": "Inspection tag is available."}, {"no": "08", "text": "Stored location is easy to access."}]'::jsonb, '{}'::jsonb, 2),
('CL-08', 'DIMO-LTD-CL-08', '00', '2021-01-01', 'checklist', 'GENERATOR', 'Serial No', 7, '[{"no": "01", "text": "Guards are available for rotating parts and hot surfaces"}, {"no": "02", "text": "No oil leakage from any part of the machine"}, {"no": "03", "text": "Exhaust smoke pipe has faced upwards & outside from the generator shelter"}, {"no": "04", "text": "Dip trays are available for any oil leakage"}, {"no": "05", "text": "Presence of damage free operating switch, Voltage and temperature meter, circuit breaker, Oil level indicator and Emergency switch (If available)"}, {"no": "06", "text": "Body earthing has been provided with standard earth pit", "critical": true}, {"no": "07", "text": "Presence of fire extinguisher"}, {"no": "08", "text": "Adequate ventilation is available for in case of indoor generator"}]'::jsonb, '{}'::jsonb, 3),
('CL-09', 'DIMO-LTD-CL-09', '00', '2021-01-01', 'checklist', 'EXCAVATOR', 'Serial / Plate No', 7, '[{"no": "01", "text": "Structure beam is free from damage, cut or crack."}, {"no": "02", "text": "No any diesel, oil and grease spillage/leakage."}, {"no": "03", "text": "No any loose bolts in bucket teeth or connecting pins."}, {"no": "04", "text": "Rear view mirror available."}, {"no": "05", "text": "Front & reverse horn is in working condition."}, {"no": "06", "text": "Head & tail lamps are available and in working condition."}, {"no": "07", "text": "Roller-crawler is free from damage or cracks."}, {"no": "08", "text": "Swing area has been barricaded and warning signs has been provided."}, {"no": "09", "text": "Operator is competent (Certified) and heavy vehicle license is available."}, {"no": "10", "text": "Third party inspection certificate is available for the machine"}]'::jsonb, '{}'::jsonb, 4),
('CL-10', 'DIMO-LTD-CL-10', '00', '2021-01-01', 'checklist', 'POWER SAW (CIRCULAR)', 'Serial No', 30, '[{"no": "01", "text": "Structure is free from damage, cut or crack."}, {"no": "02", "text": "Cutting blade without any visible crack or damage."}, {"no": "03", "text": "Cutting blade has been mounted with a proper check nut."}, {"no": "04", "text": "Trigger switch is in good working condition."}, {"no": "05", "text": "Cord strain reliever is available."}, {"no": "06", "text": "Wire code is free from damage and top plug is available with a proper gland."}, {"no": "07", "text": "Industrial power plugs/sockets available (Two pin for double insulated body/Three pin for metallic body)."}, {"no": "08", "text": "Required safety guards are available"}, {"no": "09", "text": "Operator is competent for the job"}]'::jsonb, '{}'::jsonb, 5),
('CL-13', 'DIMO-LTD-CL-13', '00', '2021-01-01', 'checklist', 'BACKHOE MACHINE (JCB)', 'Serial No / Plate No', 7, '[{"no": "01", "text": "Front & reverse horns are in working condition"}, {"no": "02", "text": "Back view mirrors are available"}, {"no": "03", "text": "Head and tail lamps are working (For night work)"}, {"no": "04", "text": "Tires in good condition. (have no cuts, bulges, worn treads or steel belts showing)"}, {"no": "05", "text": "No any oil leakage"}, {"no": "06", "text": "Buckets and structure beam are in good condition"}, {"no": "07", "text": "Swing area has been barricaded and safety banners has been displayed"}, {"no": "08", "text": "Operator has heavy vehicle license and he/she is qualified to for task"}, {"no": "09", "text": "Third party inspection certificate is available"}]'::jsonb, '{}'::jsonb, 6),
('CL-14', 'DIMO-LTD-CL-14', '00', '2021-01-01', 'checklist', 'CONCRETE VIBRATOR', 'Serial No', 30, '[{"no": "01", "text": "Electrical switches are in working condition."}, {"no": "02", "text": "Power cable is free from damage & joints."}, {"no": "03", "text": "Needle hose and coupling is free from damage."}, {"no": "04", "text": "The couplings are fitted properly."}, {"no": "05", "text": "Required safety guards are available for moving parts."}, {"no": "06", "text": "No any oil or fuel leakage."}, {"no": "07", "text": "Industrial sockets and plugs are available (If required)."}, {"no": "08", "text": "Operator is qualified/competent for the work."}, {"no": "09", "text": "Visual inspection of entire machine is \"OK\"."}]'::jsonb, '{}'::jsonb, 7),
('CL-15', 'DIMO-LTD-CL-15', '00', '2021-01-01', 'checklist', 'DRILLING MACHINE', 'Serial No', 30, '[{"no": "01", "text": "Structure is free from damage, cut or crack."}, {"no": "02", "text": "Trigger switch is in good working condition."}, {"no": "03", "text": "Wire code is free from damage and top plug is available with a proper gland."}, {"no": "04", "text": "Selected drill bit is competent for the task."}, {"no": "05", "text": "Cord strain reliever is available."}, {"no": "06", "text": "Industrial power plugs/sockets available (Two pin for double insulated body/Three pin for metallic body)."}, {"no": "07", "text": "Forward/Reverse switch is in working condition."}, {"no": "08", "text": "Operator is competent for the job"}]'::jsonb, '{}'::jsonb, 8),
('CL-16', 'DIMO-LTD-CL-16', '00', '2021-01-01', 'checklist', 'DISTRIBUTION BOARD', 'Serial No', 7, '[{"no": "01", "text": "Outdoor Type with minimum IP55 protection and mild steel enclosure with door."}, {"no": "02", "text": "ELCB or RCCB with rating suitable for incoming power supply (30mA sensitivity)", "critical": true}, {"no": "03", "text": "RCCB or ELCB tripped properly by pressing trip test button. ELCB to be tested quarterly for tripping value.", "critical": true}, {"no": "04", "text": "All the connections are through RCCB or ELCB.", "critical": true}, {"no": "05", "text": "Phase Indicating bulbs provided and is working"}, {"no": "06", "text": "DB is provided with two distinct robust earth connections.", "critical": true}, {"no": "07", "text": "Plugs and sockets are IP55 and physically in good condition."}, {"no": "08", "text": "SLD (Single line diagram) of DB pasted on DB door"}, {"no": "09", "text": "Caution signage and contact number of authorized person details displayed on the DB."}, {"no": "10", "text": "Non-conductive fire extinguisher is available"}]'::jsonb, '{"trip_test": true}'::jsonb, 9),
('CL-17', 'DIMO-LTD-CL-17', '00', '2021-01-01', 'checklist', 'METAL/STEEL CUTTING MACHINE', 'Serial No', 30, '[{"no": "01", "text": "Structure is free from damage, cut or crack."}, {"no": "02", "text": "Cutting blade without any visible crack or damage."}, {"no": "03", "text": "Cutting blade has been mounted with a proper check nut."}, {"no": "04", "text": "Trigger switch is in good working condition."}, {"no": "05", "text": "Cord strain reliever is available."}, {"no": "06", "text": "Wire code is free from damage and top plug is available with a proper gland."}, {"no": "07", "text": "Industrial power plugs/sockets available (Two pin for double insulated body/Three pin for metallic body)."}, {"no": "08", "text": "Required safety guards are available"}, {"no": "09", "text": "Operator is competent for the job"}]'::jsonb, '{}'::jsonb, 10),
('CL-18', 'DIMO-LTD-CL-18', '00', '2021-01-01', 'checklist', 'CONCRETE MIXER MACHINE', 'Serial No', 30, '[{"no": "01", "text": "Mixer is in a suitable safe area"}, {"no": "02", "text": "Ground surface is firm, level and stable"}, {"no": "03", "text": "Safety guards are available for moving/rotating parts"}, {"no": "04", "text": "Structure is visually ok"}, {"no": "05", "text": "Electrical units has been inspected/tested and tags available"}, {"no": "06", "text": "All electrical units are off from the ground and connected through a safety switch"}, {"no": "07", "text": "For motor engines, fuel tank is free from damage and no leakage"}, {"no": "08", "text": "Operator and workers are competent"}, {"no": "09", "text": "Adequate lighting is available (Night works)"}]'::jsonb, '{}'::jsonb, 11),
('CL-26', 'DIMO-LTD-CL-26', '00', '2021-01-01', 'checklist', 'WACKER/RAMMER MACHINE', 'Serial No', 30, '[{"no": "01", "text": "Fuel tank condition is \"OK\"."}, {"no": "02", "text": "No oil or fuel leak."}, {"no": "03", "text": "Drive belts are in good condition and outer cover/guard is available."}, {"no": "04", "text": "Drive belts tensioning is \"OK\" & cover/guard is available."}, {"no": "05", "text": "Accelerator lever condition is \"OK\"."}, {"no": "06", "text": "Exhaust system working properly."}, {"no": "07", "text": "Compactor plate is free from damage."}, {"no": "08", "text": "Visual inspection of entire machine is \"OK\"."}]'::jsonb, '{}'::jsonb, 12),
('CL-28', 'DIMO-LTD-CL-28', '00', '2021-01-01', 'checklist', 'GAS CUTTER SET', 'Serial No', 7, '[{"no": "01", "text": "Hot work permit is available", "critical": true}, {"no": "02", "text": "Hoses are free from damage and have been tightened with hose clamps."}, {"no": "03", "text": "Double stage regulator for each cylinder must be used and pressure gauges are in working condition (Both cylinders)"}, {"no": "04", "text": "Flash back arrestors (FBA) are available for both cylinders (Acetylene & oxygen ) as well as torch ends", "critical": true}, {"no": "05", "text": "Protective valve cap firmly fixed for both cylinders"}, {"no": "06", "text": "Double stage regulators with pressure gauges available for both cylinders"}, {"no": "07", "text": "All flammable objects in the hot work area been covered or removed", "critical": true}, {"no": "08", "text": "Adequate ventilation and lighting is available"}, {"no": "09", "text": "Presence of fire extinguisher/fire blanket"}, {"no": "10", "text": "Operator/Worker is competent/skilled and required PPEs available for the task"}, {"no": "11", "text": "Trolley/Cage is available and has been secured by chains."}]'::jsonb, '{}'::jsonb, 13),
('CL-29', 'DIMO-LTD-CL-29', '00', '2021-01-01', 'checklist', 'WELDING MACHINE', 'Serial No', 7, '[{"no": "01", "text": "Hot work permit is available", "critical": true}, {"no": "02", "text": "Full time supervisor is available"}, {"no": "03", "text": "Welding machine body have been earthed properly and circuit breaker is available", "critical": true}, {"no": "04", "text": "Regulator with indicator is available"}, {"no": "05", "text": "All flammable objects in the hot work area been covered or removed", "critical": true}, {"no": "06", "text": "Adequate ventilation and lighting is available"}, {"no": "07", "text": "Presence of fire extinguisher/fire blanket"}, {"no": "08", "text": "Operator is competent/skilled and required PPEs available for the task"}, {"no": "09", "text": "Power cable and welding cable are not overlapping with each other"}]'::jsonb, '{}'::jsonb, 14),
('CL-30', 'DIMO-LTD-CL-30', '00', '2021-01-01', 'checklist', 'HAND GRINDING MACHINE', 'Serial No', 30, '[{"no": "01", "text": "Electrical switch is in working condition."}, {"no": "02", "text": "Cutting blade is free from damage and properly tightened."}, {"no": "03", "text": "Required safety guards are available."}, {"no": "04", "text": "Power cable is free from damage."}, {"no": "05", "text": "Industrial sockets and plugs are available (If required)."}, {"no": "06", "text": "Operator is qualified/competent for the work."}, {"no": "07", "text": "Side handle is available and can be screwed to either side."}, {"no": "08", "text": "Visual inspection of entire machine is \"OK\"."}, {"no": "09", "text": "Double Insulated plastic body is available"}, {"no": "10", "text": "Proper wheel is using for the job (Grinding and cutting)"}]'::jsonb, '{}'::jsonb, 15),
('CL-31', 'DIMO-LTD-CL-31', '00', '2021-01-01', 'checklist', 'ELCB/RCCB', 'Serial No', 7, '[{"no": "01", "text": "ELCB or RCCB with rating suitable for incoming power supply (30mA sensitivity)", "critical": true}, {"no": "02", "text": "RCCB or ELCB tripped properly by pressing trip test button. ELCB to be tested quarterly for tripping value.", "critical": true}, {"no": "03", "text": "All Connections are tight & robust."}]'::jsonb, '{"trip_test": true}'::jsonb, 16),
('CL-07', 'DIMO-LTD-CL-07', '00', '2021-01-01', 'kit', 'FIRST AID KIT/BOX', 'Serial No', 30, '[{"no": "01", "text": "Zinc Oxide Plaster", "req": "1 nos", "purpose": "Promote healing and protect the wound from further harm"}, {"no": "02", "text": "Zinc Oxide Plaster - Water Proof", "req": "2 nos", "purpose": "Promote healing and protect the wound from further harm"}, {"no": "03", "text": "Alcohol Swabs (pads)", "req": "5 nos", "purpose": "Clean wounds, an injection site"}, {"no": "04", "text": "Medical Dressing", "req": "2 Yards", "purpose": "Promote healing and protect the wound from further harm"}, {"no": "05", "text": "Cotton Wool", "req": "100 g", "purpose": "Applying liquids or creams to skin"}, {"no": "06", "text": "Eye Pad - cotton absorbent", "req": "2 nos", "purpose": "Protecting eyes from dust, air & light after operation, injury or any disease"}, {"no": "07", "text": "Eye Pad - Sterile adhesive absorbent", "req": "2 nos", "purpose": "Post-operative dressings after operation, injury or any disease"}, {"no": "08", "text": "Eye Wash Cup", "req": "1 nos", "purpose": "To wash eyes perfectly"}, {"no": "09", "text": "Surgical Gloves", "req": "3 nos", "purpose": "Prevent the possible transmission of diseases between healthcare professionals and patients"}, {"no": "10", "text": "Surgical Blade", "req": "2 nos", "purpose": "Used for surgery, anatomical dissection"}, {"no": "11", "text": "Isopropyl Alcohol", "req": "50 ml", "purpose": "Antiseptic"}, {"no": "12", "text": "Apodin Ointment", "req": "1 nos", "purpose": "Clean cuts and skin infections caused by bacteria and fungi"}, {"no": "13", "text": "Clinical Thermometer", "req": "1 nos", "purpose": "Measure human body temperature"}, {"no": "14", "text": "Clinical Tweezers", "req": "1 nos", "purpose": "Picking up objects too small to be easily handled with the human fingers"}, {"no": "15", "text": "Scissors", "req": "1 nos", "purpose": "Cutting various thin materials"}, {"no": "16", "text": "Panadol", "req": "20 nos", "purpose": "For most painful and febrile conditions (Pain killer)"}]'::jsonb, '{}'::jsonb, 2),
('PTW-01', 'DIMO-LTD-PTW-01', 'Rev-00', '2020-12-01', 'permit', 'GENERAL', null, null, '[{"no": "01", "text": "Method Statement and risk assessment in place"}, {"no": "02", "text": "Workers are briefed prior to work (EHS hazards, risk and control measures)"}, {"no": "03", "text": "Work area barricaded and signage displayed"}, {"no": "04", "text": "Full time supervision available"}, {"no": "05", "text": "Working tools are in good working condition"}, {"no": "06", "text": "Working area clean from hazards"}, {"no": "07", "text": "Required fire extinguishers and First-aid box available"}, {"no": "08", "text": "PPE available and in good working condition"}, {"no": "09", "text": "No overlapping or overhead work"}, {"no": "10", "text": "Work plan has been Communicated to all concerned parties"}, {"no": "11", "text": "Weather condition acceptable"}, {"no": "12", "text": "Adequate Illumination available"}, {"no": "13", "text": "Waste will be disposed or stored according to WMP"}, {"no": "14", "text": "Is the Lock-out Tag-out procedure required"}, {"no": "15", "text": "Is there any particular precautions or issues connected with Electrical or Mechanical Installations"}]'::jsonb, '{"header": [{"key": "tbt_no", "label": "Relevant TBT Number"}], "explain_if_yes": ["15"], "question_items": ["14", "15"]}'::jsonb, 100),
('PTW-02', 'DIMO-LTD-PTW-02', 'Rev-00', '2020-12-01', 'permit', 'LIFTING OPERATION', null, null, '[{"no": "01", "text": "Method Statement and risk assessment in place"}, {"no": "02", "text": "Pre-lift operation briefed conducted (Started Card)"}, {"no": "03", "text": "Weather condition checked and acceptable (Wind Speed & raining)"}, {"no": "04", "text": "Lift area free from obstruction"}, {"no": "05", "text": "People isolated from the lifting location"}, {"no": "06", "text": "Overhead obstruction removed/cleared"}, {"no": "07", "text": "Ground condition is acceptable and conformed"}, {"no": "08", "text": "Weight of the load conformed and within the crane safety (SWL) margin"}, {"no": "09", "text": "Off-load area confirmed and stable"}, {"no": "10", "text": "No overlapping task/work"}, {"no": "11", "text": "Adequate illumination available during dark hours"}, {"no": "12", "text": "Lifting gears/Operator/Riggers are certified"}, {"no": "13", "text": "Area Being cordon off and signage displayed"}, {"no": "14", "text": "Lifting radius as per the approved plan"}, {"no": "15", "text": "Have the lifting eyes and pad been inspected"}, {"no": "16", "text": "Are people being lifted? If yes, check Man basket certification, Person''s PPE"}]'::jsonb, '{"header": [{"key": "lifting_plan_no", "label": "Lifting Plan Number"}], "question_items": ["16"], "equipment_forms": ["CL-03"]}'::jsonb, 101),
('PTW-03', 'DIMO-LTD-PTW-03', 'Rev-00', '2020-12-01', 'permit', 'HOT WORK', null, null, '[{"no": "01", "text": "Method Statement and risk assessment in place"}, {"no": "02", "text": "Area free from combustible & Flammable material"}, {"no": "03", "text": "Appropriate fire extinguisher/s available"}, {"no": "04", "text": "Sufficient ventilation available"}, {"no": "05", "text": "Welder/ Operator/ Cutter is competent"}, {"no": "06", "text": "Surrounding and below area covered to avoid spread of sparking"}, {"no": "07", "text": "Correct PPE Worn by Welder/ Operator/ Cutter"}, {"no": "08", "text": "Cylinder kept inside the cage/ trolley and secured"}, {"no": "09", "text": "Tools in good working order"}, {"no": "10", "text": "Face shield/ guard available"}, {"no": "11", "text": "Adequate illumination available for task"}, {"no": "12", "text": "Cylinder Hose in good order and fitted properly"}, {"no": "13", "text": "First-aid box available"}, {"no": "14", "text": "Safe working platform available with tag and access"}, {"no": "15", "text": "Area Being cordon off and signage displayed"}, {"no": "16", "text": "Earthing has been provided to the welding machine"}]'::jsonb, '{"equipment_forms": ["CL-28", "CL-29"]}'::jsonb, 102),
('PTW-04', 'DIMO-LTD-PTW-04', 'Rev-00', '2020-12-01', 'permit', 'CONFINED SPACE', null, null, '[{"no": "01", "text": "Method Statement and risk assessment in place"}, {"no": "02", "text": "Workers are briefed prior to work"}, {"no": "03", "text": "Required Fire extinguisher and first-aid box available"}, {"no": "04", "text": "Oxygen level checked and recorded (If Required)"}, {"no": "05", "text": "Equipment/Plant removed from all the source of danger"}, {"no": "06", "text": "Danger sludge and deposits has been removed"}, {"no": "07", "text": "Mechanical drives has been locked off"}, {"no": "08", "text": "Atmosphere has been checked and free from toxic (If Required)"}, {"no": "09", "text": "Operatives worn the full body harness (If Required)"}, {"no": "10", "text": "Full body harness checked & ensured to use"}, {"no": "11", "text": "Electrical circuits has been locked off"}, {"no": "12", "text": "Adequate ventilation available/fresh air supplied"}, {"no": "13", "text": "Full time supervision available"}, {"no": "14", "text": "Fresh air self-contained breathing apparatus worn (If Required)"}, {"no": "15", "text": "Protective cloth has been worn"}, {"no": "16", "text": "Emergency egress are available"}, {"no": "17", "text": "Adequate, flame proof/ intrinsically lighting shall be used"}, {"no": "18", "text": "Work area barricaded and signage displayed"}]'::jsonb, '{"readings": [{"key": "o2", "label": "Oxygen (%)", "item": "04"}, {"key": "lel", "label": "Flammable gas (% LEL)", "item": "08"}, {"key": "h2s", "label": "H2S (ppm)", "item": "08"}, {"key": "co", "label": "CO (ppm)", "item": "08"}]}'::jsonb, 103),
('PTW-05', 'DIMO-LTD-PTW-05', 'Rev-00', '2020-12-01', 'permit', 'WORKING AT HEIGHT', null, null, '[{"no": "01", "text": "Method Statement and risk assessment in place"}, {"no": "02", "text": "Workers are briefed prior to work"}, {"no": "03", "text": "Work area barricaded and signage displayed"}, {"no": "04", "text": "Full time supervision available"}, {"no": "05", "text": "Adequate life line installed and secured properly"}, {"no": "06", "text": "Working platform stable and secured"}, {"no": "07", "text": "Operatives worn the full body harness"}, {"no": "08", "text": "Full body harness checked & ensured to use"}, {"no": "09", "text": "Adequate Illumination available"}, {"no": "10", "text": "No overlapping task/ work"}, {"no": "11", "text": "Weather condition acceptable"}, {"no": "12", "text": "No overhead work"}, {"no": "13", "text": "No material stacked on the platform"}, {"no": "14", "text": "No slipping or tripping hazards"}, {"no": "15", "text": "No live cable running on platform"}, {"no": "16", "text": "Safe access and egress provided"}, {"no": "17", "text": "Anchorage point is approved"}, {"no": "18", "text": "The ground condition is suitable for the task"}]'::jsonb, '{}'::jsonb, 104),
('PTW-06', 'DIMO-LTD-PTW-06', 'Rev-00', '2020-12-01', 'permit', 'EXCAVATION', null, null, '[{"no": "01", "text": "Method Statement and risk assessment in place"}, {"no": "02", "text": "Workers are briefed prior to work"}, {"no": "03", "text": "Work area/excavator swing area barricaded and signage displayed"}, {"no": "04", "text": "Full time supervision available"}, {"no": "05", "text": "Safe access and egress provided"}, {"no": "06", "text": "Loose boulders have been removed to prevent those fall in to pit"}, {"no": "07", "text": "Incase of loosen soil shoring method will be used."}, {"no": "08", "text": "No overlapping task/ work"}, {"no": "09", "text": "Weather condition is acceptable"}, {"no": "10", "text": "Suitable hard barricade provided to excavation deeper than 1.5m"}, {"no": "11", "text": "Adequate Illumination available"}, {"no": "12", "text": "Excavated soil will keep 1.5m away from the pit"}, {"no": "13", "text": "Tools/machines has been inspected and records available"}, {"no": "14", "text": "Dewatering will be done (if required)"}]'::jsonb, '{"groups": [{"no": "15", "title": "Utility drawings have been reviewed to identify underground utilities. If not available discuss with all the concerned parties", "items": ["Sewage pipe line", "Underground electrical cables", "Domestic water line", "Telephone/Data cables", "Storm water drain pipe", "Firefighting hydrant pipe line"]}], "equipment_forms": ["CL-09", "CL-13", "CL-26"]}'::jsonb, 105),
('TBT-01', 'OHS/LTD/TBT/01', 'Rev-00', '2020-12-01', 'tbt', 'TOOL BOX MEETING', null, null, '[{"no": "01", "text": "Work Permit"}, {"no": "02", "text": "Skilled Labors"}, {"no": "03", "text": "Barricades"}, {"no": "04", "text": "Complete PPE"}, {"no": "05", "text": "Caution Boards/Signs"}, {"no": "06", "text": "Earthing"}, {"no": "07", "text": "Supervision"}, {"no": "08", "text": "Full body Harness"}, {"no": "09", "text": "Fall Arrestor"}]'::jsonb, '{}'::jsonb, 200),
('IR-01', 'DIMO-LTD-IR-01', '00', '2021-01-01', 'induction', 'HSE INDUCTION REGISTER', null, null, '[]'::jsonb, '{}'::jsonb, 210),
('TR-01', 'DIMO-LTD-TR-01', '00', '2021-01-01', 'training', 'HSE TRAINING ATTENDANCE RECORD', null, null, '[]'::jsonb, '{}'::jsonb, 220)
on conflict (code) do update set doc_no = excluded.doc_no, issue = excluded.issue, issue_date = excluded.issue_date, kind = excluded.kind, title = excluded.title,
  id_label = excluded.id_label, frequency_days = excluded.frequency_days, items = excluded.items, extra = excluded.extra, sort = excluded.sort;

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
  when 'hse_record' then
    return exists (select 1 from public.hse_records x where x.id = p_entity_id and app.can_read_exec(x.exec_project_id));
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

revoke execute on function public.set_ehs_officer(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_ehs_officer(uuid, uuid, boolean) to authenticated, service_role;
revoke execute on function public.save_hse_equipment(uuid, jsonb) from public, anon;
grant execute on function public.save_hse_equipment(uuid, jsonb) to authenticated, service_role;
revoke execute on function public.save_hse_checklist(uuid, jsonb) from public, anon;
grant execute on function public.save_hse_checklist(uuid, jsonb) to authenticated, service_role;
revoke execute on function public.record_hse_correction(uuid, date, text) from public, anon;
grant execute on function public.record_hse_correction(uuid, date, text) to authenticated, service_role;
revoke execute on function public.sign_hse_record(uuid, text) from public, anon;
grant execute on function public.sign_hse_record(uuid, text) to authenticated, service_role;
revoke execute on function public.request_permit(uuid, jsonb) from public, anon;
grant execute on function public.request_permit(uuid, jsonb) to authenticated, service_role;
revoke execute on function public.decide_permit(uuid, boolean, text) from public, anon;
grant execute on function public.decide_permit(uuid, boolean, text) to authenticated, service_role;
revoke execute on function public.close_permit(uuid, text) from public, anon;
grant execute on function public.close_permit(uuid, text) to authenticated, service_role;
revoke execute on function public.save_tbt(uuid, jsonb) from public, anon;
grant execute on function public.save_tbt(uuid, jsonb) to authenticated, service_role;
revoke execute on function public.save_training(uuid, jsonb) from public, anon;
grant execute on function public.save_training(uuid, jsonb) to authenticated, service_role;
revoke execute on function public.add_induction(uuid, jsonb) from public, anon;
grant execute on function public.add_induction(uuid, jsonb) to authenticated, service_role;
revoke execute on function public.induction_lookup(text) from public, anon;
grant execute on function public.induction_lookup(text) to authenticated, service_role;
revoke execute on function public.hse_summary(uuid) from public, anon;
grant execute on function public.hse_summary(uuid) to authenticated, service_role;
