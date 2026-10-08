-- Daily report: the planned activities of the day (and earlier ones not yet updated) are updated from the report –
-- result, quantity done, details / reason and photos per activity. A snapshot of the updates is kept on the report for
-- the PDF (Assistant Engineer report: downloaded by the AE and the Senior Electrical Engineer).

alter table public.exec_reports add column if not exists item_updates jsonb not null default '[]';

create or replace function public.submit_exec_report(p_exec uuid, p_date date, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare lvl text; x public.exec_reports; rid uuid; late boolean; today date := (now() at time zone app.tz())::date; u jsonb; it public.exec_plan_items; snap jsonb := '[]';
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
  -- Planned activities updated from the report: [{id, status, done_qty, note}]
  for u in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'items') = 'array' then p -> 'items' else '[]' end) loop
    select * into it from public.exec_plan_items where id = nullif(u ->> 'id', '')::uuid;
    perform app.require(it.id is not null and it.exec_project_id = p_exec, 'Planned activity not found on this project');
    perform public.update_plan_item(it.id, u ->> 'status', nullif(u ->> 'done_qty', '')::numeric, nullif(btrim(u ->> 'note'), ''));
    select * into it from public.exec_plan_items where id = it.id;
    snap := snap || jsonb_build_array(jsonb_build_object('id', it.id, 'day', it.day, 'kind', it.kind, 'title', it.title, 'zone', it.zone, 'qty', it.qty, 'unit', it.unit,
      'supervisor_id', it.supervisor_id, 'status', it.status, 'done_qty', it.done_qty, 'note', it.result_note, 'photos', '[]'::jsonb));
  end loop;
  update public.exec_reports set item_updates = snap where id = rid;
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

-- Photos of one updated activity (uploaded on the report after it is submitted)
create or replace function public.attach_report_item_photos(p_report uuid, p_item uuid, p_attachments uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare x public.exec_reports;
begin
  select * into x from public.exec_reports where id = p_report for update;
  perform app.require(x.id is not null and x.author_id = auth.uid(), 'Only the author adds photos to the report');
  perform app.require(not exists (select 1 from unnest(p_attachments) a where not exists (
    select 1 from public.attachments t where t.id = a and t.entity_type = 'exec_report' and t.entity_id = x.id)), 'Photo not found on this report');
  update public.exec_reports set item_updates = (
    select coalesce(jsonb_agg(case when e ->> 'id' = p_item::text
      then jsonb_set(e, '{photos}', coalesce(e -> 'photos', '[]') || to_jsonb(p_attachments)) else e end order by n), '[]')
    from jsonb_array_elements(item_updates) with ordinality as t(e, n))
  where id = x.id;
end $$;
revoke execute on function public.attach_report_item_photos(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.attach_report_item_photos(uuid, uuid, uuid[]) to authenticated, service_role;
