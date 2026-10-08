-- Daily report: the toolbox talk is linked to the toolbox talk record(s) of that day (HSE form TBT-01, numbered
-- automatically) – the supervisor's own, or for an Assistant Engineer every toolbox talk of the project that day.

alter table public.exec_reports add column if not exists toolbox_records uuid[] not null default '{}';

create or replace function public.submit_exec_report(p_exec uuid, p_date date, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare tb uuid[]; lvl text; x public.exec_reports; rid uuid; late boolean; today date := (now() at time zone app.tz())::date; u jsonb; it public.exec_plan_items; snap jsonb := '[]';
begin
  perform app.require(app.is_exec_member(p_exec), 'You are not on this project');
  lvl := case app.my_role() when 'sub_supervisor' then 'supervisor' when 'assistant_engineer' then 'ae' end;
  perform app.require(lvl is not null, 'Daily reports are written by subcontractor supervisors and Assistant Engineers');
  perform app.require(p_date is not null and p_date <= today and p_date >= today - 3, 'Report for today or the last three days');
  perform app.require(coalesce(btrim(p ->> 'work_done'), '') <> '', 'Describe the work done');
  perform app.require(lvl <> 'supervisor' or nullif(p ->> 'crew_count', '') is not null, 'Enter the crew on site');
  select coalesce(array_agg(tv::uuid), '{}') into tb from jsonb_array_elements_text(case when jsonb_typeof(p -> 'toolbox_records') = 'array' then p -> 'toolbox_records' else '[]' end) tv;
  perform app.require(not coalesce((p ->> 'toolbox_talk')::boolean, false) or cardinality(tb) > 0 or coalesce(btrim(p ->> 'toolbox_topic'), '') <> '',
    'Choose the toolbox talk record (or enter the topic)');
  perform app.require(not exists (select 1 from unnest(tb) t where not exists (select 1 from public.hse_records r
      where r.id = t and r.exec_project_id = p_exec and r.form_code = 'TBT-01' and (r.starts_at at time zone app.tz())::date = p_date)),
    'The toolbox talk must be one of this project on the report day');
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
  update public.exec_reports set item_updates = snap,
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
