-- Programme: set an activity's start and finish dates from the Gantt; the duration (working days) is worked out from them.
--  * Start  → the activity's "not before" date (links to earlier activities can still push it later)
--  * Finish → duration = working days from the start to the finish, both counted (weekends / holidays left out)
--  * A milestone stays 0 days when the finish equals the start.

create or replace function app.work_days(p_from date, p_to date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from generate_series(p_from, p_to, interval '1 day') g
  where extract(isodow from g)::int = any (coalesce((select array_agg(x::int) from jsonb_array_elements_text(app.setting('working_hours') -> 'days') x), array[1, 2, 3, 4, 5]))
    and not exists (select 1 from public.holidays h where h.day = g::date)
$$;

create or replace function public.set_activity_dates(p_id uuid, p_start date, p_finish date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.exec_activities; s date; d int;
begin
  select * into a from public.exec_activities where id = p_id;
  perform app.require(a.id is not null, 'Activity not found');
  perform app.programme_edit(a.exec_project_id);
  perform app.require(p_start is not null or p_finish is not null, 'Enter the start or the finish');
  perform app.require(p_start is null or a.actual_start is null or p_start = a.es, 'The activity has started – its start is the actual start');
  s := coalesce(p_start, a.es, (select start_date from public.exec_programmes where exec_project_id = a.exec_project_id));
  perform app.require(p_finish is null or p_finish >= s, 'The finish cannot be before the start');
  if p_finish is not null then
    d := case when a.duration = 0 and p_finish = s then 0 else app.work_days(s, p_finish) end;
    perform app.require(d > 0 or a.duration = 0, 'No working day between the start and the finish');
  end if;
  update public.exec_activities set not_before = coalesce(p_start, not_before), duration = coalesce(d, duration) where id = p_id;
  perform app.schedule(a.exec_project_id);
  select * into a from public.exec_activities where id = p_id;
  return jsonb_build_object('es', a.es, 'ef', a.ef, 'duration', a.duration, 'moved', p_start is not null and a.es > p_start);
end $$;

revoke execute on function public.set_activity_dates(uuid, date, date) from public, anon;
grant execute on function public.set_activity_dates(uuid, date, date) to authenticated;
