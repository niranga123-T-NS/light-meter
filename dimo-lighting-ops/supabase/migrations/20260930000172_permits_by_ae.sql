-- Permits to work: requested by the subcontractor supervisor (any number – several at a time), approved and closed by an
-- Assistant Engineer of the project (or the SEE) – not only the designated EHS Officer. Never by the person who requested it.

create or replace function app.can_approve_permit(p_exec uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec) or app.is_ehs(p_exec)
$$;

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

create or replace function public.decide_permit(p_id uuid, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.hse_records;
begin
  select * into r from public.hse_records where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'submitted' and r.code like 'PTW-%', 'Nothing to approve');
  perform app.require(app.can_approve_permit(r.exec_project_id), 'An Assistant Engineer of this project approves permits');
  perform app.require(r.created_by <> auth.uid(), 'You requested this permit – another Assistant Engineer of the project approves it');
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
  perform app.require(app.can_approve_permit(r.exec_project_id), 'An Assistant Engineer of this project closes the permit');
  update public.hse_records set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_note = nullif(btrim(p_note), '') where id = r.id;
end $$;

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
    'can_ehs', app.is_ehs(p_exec),
    'can_permit', app.can_approve_permit(p_exec));
end $$;
