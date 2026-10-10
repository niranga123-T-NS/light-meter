-- Permits to work and toolbox meetings are created by Assistant Engineers (and subcontractor supervisors for their own
-- work); the SEE and management see them but do not create them. Handover dossier items can be added and removed (a
-- removed standard item does not come back when new areas are added). "Toolbox talk" is now "Toolbox meeting".

alter table public.exec_dossier add column if not exists removed boolean not null default false;
alter table public.exec_dossier add column if not exists custom boolean not null default false;

create or replace function app.can_edit_dossier(p_exec uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer', 'operations_exec') or app.is_project_ae(p_exec)
$$;

-- Add an item to the dossier (an existing area or a new one)
create or replace function public.add_dossier_item(p_exec uuid, p_area text, p_item text, p_mandatory boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform app.require(app.can_edit_dossier(p_exec), 'The SEE, an Assistant Engineer of the project or Operations edits the dossier');
  perform app.require(coalesce(btrim(p_area), '') <> '' and coalesce(btrim(p_item), '') <> '', 'Enter the area and the document');
  insert into public.exec_dossier (exec_project_id, area, item, mandatory, custom) values (p_exec, btrim(p_area), btrim(p_item), coalesce(p_mandatory, true), true)
  on conflict (exec_project_id, area, item) do update set removed = false, mandatory = excluded.mandatory
  returning id into rid;
  return rid;
end $$;

-- Remove an item (or a whole area) from the dossier
create or replace function public.remove_dossier_item(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.exec_dossier;
begin
  select * into d from public.exec_dossier where id = p_id for update;
  perform app.require(d.id is not null, 'Item not found');
  perform app.require(app.can_edit_dossier(d.exec_project_id), 'The SEE, an Assistant Engineer of the project or Operations edits the dossier');
  perform app.require(not d.done, 'Reopen it first – a completed item is not removed');
  update public.exec_dossier set removed = true where id = d.id;
end $$;
create or replace function public.remove_dossier_area(p_exec uuid, p_area text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform app.require(app.can_edit_dossier(p_exec), 'The SEE, an Assistant Engineer of the project or Operations edits the dossier');
  perform app.require(not exists (select 1 from public.exec_dossier where exec_project_id = p_exec and area = p_area and done and not removed),
    'Some items of this area are completed – reopen them first');
  update public.exec_dossier set removed = true where exec_project_id = p_exec and area = p_area and not removed;
  get diagnostics n = row_count;
  return n;
end $$;


create or replace function public.complete_dossier_item(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d public.exec_dossier;
begin
  select * into d from public.exec_dossier where id = p_id for update;
  perform app.require(d.id is not null and not d.removed, 'Item not found');
  perform app.require(app.has_role('senior_elec_engineer', 'operations_exec') or app.is_project_ae(d.exec_project_id), 'Not allowed');
  perform app.require(not p_done or app.has_attachment('dossier_item', d.id, 'dossier_doc'), 'Attach the document first');
  update public.exec_dossier set done = p_done, done_by = case when p_done then auth.uid() end, done_at = case when p_done then now() end where id = d.id;
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
    select count(*) into n from public.exec_dossier where exec_project_id = p_exec and mandatory and not done and not removed;
    c := c || jsonb_build_array(jsonb_build_object('check', 'Mandatory dossier items present', 'ok', n = 0 and exists (select 1 from public.exec_dossier where exec_project_id = p_exec and not removed), 'detail', n || ' missing'));
  elsif p_gate = 3 then
    select count(*) into n from public.material_requests where exec_project_id = p_exec and status in ('submitted', 'pending_smp', 'approved', 'ordered', 'part_received');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open material requests / orders', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.hse_reports where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open HSE reports', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.variations where exec_project_id = p_exec and status in ('raised', 'pricing', 'pending_smp', 'pending_gm', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No variation still open', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.sub_certs where exec_project_id = p_exec and status in ('jm_requested', 'jm_scheduled', 'jm_ae', 'jm_see', 'jm_returned', 'draft', 'ae_review', 'returned', 'prepared', 'verified', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'Subcontractors finally certified and paid', 'ok', n = 0, 'detail', n || ' open'));
  end if;
  return c;
end $$;

create or replace function public.request_permit(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  f public.hse_forms; it jsonb; g jsonb; a jsonb; rid uuid; v_code text; q text[]; s timestamptz; e timestamptz; h jsonb := coalesce(p -> 'header', '{}');
  eq public.hse_equipment; rd jsonb; v numeric; i int;
begin
  perform app.require(app.is_exec_member(p_exec) or app.has_role('senior_elec_engineer'), 'You are not on this project');
  perform app.require(app.has_role('assistant_engineer', 'sub_supervisor'), 'An Assistant Engineer or the subcontractor supervisor requests permits');
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
  -- Lifting plan number: numbered per project (project code/LP-001, -002 …)
  if f.code = 'PTW-02' and coalesce(btrim(h ->> 'lifting_plan_no'), '') = '' then
    h := h || jsonb_build_object('lifting_plan_no', format('%s/LP-%s', coalesce((select code from public.exec_projects where id = p_exec), 'EXP'),
      lpad(((select count(*) from public.hse_records x where x.exec_project_id = p_exec and x.form_code = 'PTW-02') + 1)::text, 3, '0')));
  end if;
  v_code := app.next_code('PTW');
  insert into public.hse_records (code, exec_project_id, form_code, equipment_id, header, answers, status, starts_at, ends_at, related_id)
  values (v_code, p_exec, f.code, eq.id, h, coalesce(p -> 'answers', '{}'), 'submitted', s, e, nullif(p ->> 'tbt_id', '')::uuid)
  returning id into rid;
  perform app.notify_many(array_remove(app.project_aes(p_exec) || app.project_ehs(p_exec), auth.uid()), 'hse_permit',
    format('Permit to approve – %s %s', initcap(f.title), v_code),
    format('%s · %s · %s–%s · %s', app.exec_head(p_exec), btrim(h ->> 'location'), to_char(s at time zone app.tz(), 'DD Mon HH24:MI'),
           to_char(e at time zone app.tz(), 'HH24:MI'), app.display_name(auth.uid())),
    'critical', 'hse_record', rid, '/execution/hse/form/' || rid, null, true);
  return rid;
end $$;

create or replace function public.save_tbt(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; v_code text; h jsonb := coalesce(p -> 'header', '{}'); pm public.hse_records; st timestamptz := coalesce(nullif(p ->> 'starts_at', '')::timestamptz, now());
        today date := (now() at time zone app.tz())::date;
begin
  perform app.require(app.is_exec_member(p_exec), 'You are not on this project');
  perform app.require(app.has_role('assistant_engineer', 'sub_supervisor'), 'An Assistant Engineer or the subcontractor supervisor holds the toolbox meeting');
  perform app.require(coalesce(btrim(h ->> 'activity'), '') <> '', 'Enter the activity / work programme');
  perform app.require(coalesce(btrim(h ->> 'hazards'), '') <> '', 'Enter the safety issues (hazards and risks)');
  perform app.require(jsonb_array_length(coalesce(p -> 'participants', '[]')) > 0, 'Add the participants');
  if nullif(p ->> 'permit_id', '') is not null then
    select * into pm from public.hse_records where id = (p ->> 'permit_id')::uuid and exec_project_id = p_exec and code like 'PTW-%';
    perform app.require(pm.id is not null, 'Choose a permit of this project');
  end if;
  -- Subcontractor supervisor: the day has started, checked in on site, and an approved work permit for the day
  if app.has_role('sub_supervisor') then
    perform app.require((st at time zone app.tz())::date = today, 'The toolbox meeting is held on the day itself');
    perform app.require(app.checked_in_today(p_exec, auth.uid()), 'Check in on site first – your location is verified before the toolbox meeting');
    perform app.require(exists (select 1 from public.hse_records r where r.exec_project_id = p_exec and r.created_by = auth.uid() and r.status in ('active', 'closed')
                                   and app.permit_covers(r, today)), 'No approved work permit for today – the toolbox meeting opens once a permit is approved');
  end if;
  v_code := app.next_code('TBT');
  insert into public.hse_records (code, exec_project_id, form_code, header, answers, participants, status, starts_at, related_id,
                                  sup_by, sup_at, ehs_by, ehs_at)
  values (v_code, p_exec, 'TBT-01', h, coalesce(p -> 'answers', '{}'), p -> 'participants', 'submitted', st, pm.id,
          case when app.has_role('sub_supervisor') then auth.uid() end, case when app.has_role('sub_supervisor') then now() end,
          case when app.has_role('assistant_engineer') and app.is_ehs(p_exec) then auth.uid() end, case when app.has_role('assistant_engineer') and app.is_ehs(p_exec) then now() end)
  returning id into rid;
  if st > app.tbt_late_at((st at time zone app.tz())::date) then
    update public.hse_records set tbt_late = true where id = rid;
    perform app.notify_many(array(select unnest(app.project_aes(p_exec)) union select unnest(app.role_users('senior_elec_engineer'))), 'hse_tbt',
      format('Toolbox meeting late – %s', app.display_name(auth.uid())),
      format('%s · %s held at %s (due 08:30)', app.exec_head(p_exec), v_code, to_char(st at time zone app.tz(), 'HH24:MI')), 'normal', 'hse_record', rid, '/execution/hse/form/' || rid, null, false);
  end if;
  if pm.id is not null then
    update public.hse_records set header = header || jsonb_build_object('tbt_no', v_code), related_id = coalesce(related_id, rid) where id = pm.id;
  end if;
  return rid;
end $$;

create or replace function public.submit_exec_report(p_exec uuid, p_date date, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare tb uuid[]; lvl text; x public.exec_reports; rid uuid; late boolean; today date := (now() at time zone app.tz())::date; u jsonb; it public.exec_plan_items; snap jsonb := '[]'; si public.sub_plan_items; pids uuid[] := '{}'; ssnap jsonb := '[]'; miss text;
begin
  perform app.require(app.is_exec_member(p_exec), 'You are not on this project');
  lvl := case app.my_role() when 'sub_supervisor' then 'supervisor' when 'assistant_engineer' then 'ae' end;
  perform app.require(lvl is not null, 'Daily reports are written by subcontractor supervisors and Assistant Engineers');
  perform app.require(p_date is not null and p_date <= today and p_date >= today - 3, 'Report for today or the last three days');
  perform app.require(coalesce(btrim(p ->> 'work_done'), '') <> '', 'Describe the work done');
  perform app.require(lvl <> 'supervisor' or nullif(p ->> 'crew_count', '') is not null, 'Enter the crew on site');
  select coalesce(array_agg(tv::uuid), '{}') into tb from jsonb_array_elements_text(case when jsonb_typeof(p -> 'toolbox_records') = 'array' then p -> 'toolbox_records' else '[]' end) tv;
  perform app.require(not coalesce((p ->> 'toolbox_talk')::boolean, false) or cardinality(tb) > 0 or coalesce(btrim(p ->> 'toolbox_topic'), '') <> '',
    'Choose the toolbox meeting record (or enter the topic)');
  perform app.require(not exists (select 1 from unnest(tb) t where not exists (select 1 from public.hse_records r
      where r.id = t and r.exec_project_id = p_exec and r.form_code = 'TBT-01' and (r.starts_at at time zone app.tz())::date = p_date)),
    'The toolbox meeting must be one of this project on the report day');
  perform app.require(lvl <> 'supervisor' or exists (select 1 from public.hse_records r where r.exec_project_id = p_exec and r.created_by = auth.uid()
      and r.form_code = 'TBT-01' and (r.starts_at at time zone app.tz())::date = p_date),
    'Hold and record the day''s toolbox meeting first – no daily report without it');
  if lvl = 'supervisor' then
    tb := array(select distinct tid from unnest(tb || array(select r.id from public.hse_records r where r.exec_project_id = p_exec and r.created_by = auth.uid()
      and r.form_code = 'TBT-01' and (r.starts_at at time zone app.tz())::date = p_date)) tid);
    p := p || '{"toolbox_talk": true}';
  end if;
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
  -- Planned activities updated from the report: [{id, status, done_qty, note}]
  for u in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'items') = 'array' then p -> 'items' else '[]' end) loop
    select * into it from public.exec_plan_items where id = nullif(u ->> 'id', '')::uuid;
    perform app.require(it.id is not null and it.exec_project_id = p_exec, 'Planned activity not found on this project');
    perform public.update_plan_item(it.id, u ->> 'status', nullif(u ->> 'done_qty', '')::numeric, nullif(btrim(u ->> 'note'), ''));
    select * into it from public.exec_plan_items where id = it.id;
    snap := snap || jsonb_build_array(jsonb_build_object('id', it.id, 'day', it.day, 'kind', it.kind, 'title', it.title, 'zone', it.zone, 'qty', it.qty, 'unit', it.unit,
      'supervisor_id', it.supervisor_id, 'status', it.status, 'done_qty', it.done_qty, 'note', it.result_note, 'photos', '[]'::jsonb));
  end loop;
  -- Supervisor: results of the day's planned works (own approved plan) and the work permits of the day
  if lvl = 'supervisor' then
    for u in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'sub_items') = 'array' then p -> 'sub_items' else '[]' end) loop
      select i.* into si from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
       where i.id = nullif(u ->> 'id', '')::uuid and s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved' and i.day <= p_date;
      perform app.require(si.id is not null, 'Planned work not found in your approved plan');
      perform public.update_sub_plan_item(si.id, u ->> 'status', nullif(u ->> 'done_qty', '')::numeric, nullif(btrim(u ->> 'note'), ''));
    end loop;
    -- planned works taken from the engineers' plan that were reported in section A carry that result
    update public.sub_plan_items i set status = pi.status, done_qty = pi.done_qty, result_note = pi.result_note, updated_at = now()
      from public.exec_plan_items pi, public.sub_plans s
     where i.ae_item_id = pi.id and s.id = i.sub_plan_id and s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved'
       and i.day = p_date and i.status = 'planned' and pi.status <> 'planned';
    select string_agg(i.title, ', ' order by i.title) into miss from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
     where s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved' and i.day = p_date and i.status = 'planned';
    perform app.require(miss is null, 'Give the result of each work of your plan for the day: ' || coalesce(miss, ''));
    select coalesce(array_agg(distinct tv::uuid), '{}') into pids from jsonb_array_elements_text(case when jsonb_typeof(p -> 'permit_ids') = 'array' then p -> 'permit_ids' else '[]' end) tv;
    perform app.require(not exists (select 1 from unnest(pids) t where not exists (select 1 from public.hse_records r
        where r.id = t and r.exec_project_id = p_exec and r.created_by = auth.uid() and r.status in ('active', 'closed') and app.permit_covers(r, p_date))),
      'Refer only your approved work permits of the report day');
    perform app.require(cardinality(pids) > 0 or not exists (select 1 from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
        where s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved' and i.day = p_date and i.status in ('done', 'partial')),
      'Refer the work permit(s) the work was done under');
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'zone', i.zone, 'qty', i.qty, 'unit', i.unit, 'additional', i.additional,
             'status', i.status, 'done_qty', i.done_qty, 'note', i.result_note,
             'permits', (select coalesce(jsonb_agg(r.code order by r.code), '[]') from public.sub_plan_item_permits l join public.hse_records r on r.id = l.permit_id where l.item_id = i.id))
             order by i.created_at), '[]') into ssnap
      from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
     where s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved' and i.day = p_date;
  end if;
  update public.exec_reports set item_updates = snap, permit_ids = pids, sub_plan_updates = ssnap,
    toolbox_records = case when coalesce((p ->> 'toolbox_talk')::boolean, false) then tb else '{}' end,
    toolbox_topic = case when coalesce((p ->> 'toolbox_talk')::boolean, false) and coalesce(btrim(p ->> 'toolbox_topic'), '') = '' and cardinality(tb) > 0
      then (select string_agg(r.code || ' – ' || left(coalesce(r.header ->> 'activity', ''), 80), ' · ' order by r.starts_at) from public.hse_records r where r.id = any (tb))
      else toolbox_topic end
  where id = rid;
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
      'You approve and close permits to work and sign HSE checklists and toolbox meetings on this project.', 'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=hse');
  end if;
end $$;

update public.hse_forms set title = 'TOOLBOX MEETING' where code = 'TBT-01';
revoke execute on function public.add_dossier_item(uuid, text, text, boolean), public.remove_dossier_item(uuid), public.remove_dossier_area(uuid, text) from public, anon;
grant execute on function public.add_dossier_item(uuid, text, text, boolean), public.remove_dossier_item(uuid), public.remove_dossier_area(uuid, text) to authenticated, service_role;
