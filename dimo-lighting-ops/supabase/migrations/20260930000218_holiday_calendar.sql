-- Sri Lanka public holidays, loaded and kept up to date automatically.
--  * The GitHub workflow "DIMO – holidays" runs every week. It reads the gazetted holidays for this year and next from two
--    sources (the public Sri Lanka holiday calendar and the open-source "holidays" register) and saves them here.
--  * Days added by hand (Administration, or Ops) are never changed or removed by the update.
--  * When the update finds a gazette correction (a holiday moved), the old automatic date is removed.
--  * From 15 November, if next year's holidays are not loaded yet, the system administrator and Ops are reminded each week.

alter table public.holidays add column if not exists source text not null default 'manual' check (source in ('manual', 'auto'));
alter table public.holidays add column if not exists updated_at timestamptz not null default now();

-- 2025 and 2026 from the gazette (through the "holidays" register), so the clocks are right from the start
insert into public.holidays (day, name, source) select d::date, n, 'auto' from (values
  ('2025-01-13', 'Duruthu Full Moon Poya Day'),
  ('2025-01-14', 'Tamil Thai Pongal Day'),
  ('2025-02-04', 'Independence Day'),
  ('2025-02-12', 'Nawam Full Moon Poya Day'),
  ('2025-02-26', 'Maha Sivarathri Day'),
  ('2025-03-13', 'Medin Full Moon Poya Day'),
  ('2025-03-31', 'Eid al-Fitr'),
  ('2025-04-12', 'Bak Full Moon Poya Day'),
  ('2025-04-13', 'Day Before Sinhala and Tamil New Year'),
  ('2025-04-14', 'Sinhala and Tamil New Year'),
  ('2025-04-18', 'Good Friday'),
  ('2025-05-01', 'International Workers'' Day'),
  ('2025-05-12', 'Vesak Full Moon Poya Day'),
  ('2025-05-13', 'Day Following Vesak Full Moon Poya Day'),
  ('2025-06-07', 'Eid al-Adha'),
  ('2025-06-10', 'Poson Full Moon Poya Day'),
  ('2025-07-10', 'Esala Full Moon Poya Day'),
  ('2025-08-08', 'Nikini Full Moon Poya Day'),
  ('2025-09-05', 'Prophet''s Birthday'),
  ('2025-09-07', 'Binara Full Moon Poya Day'),
  ('2025-10-06', 'Vap Full Moon Poya Day'),
  ('2025-10-20', 'Diwali'),
  ('2025-11-05', 'Il Full Moon Poya Day'),
  ('2025-12-04', 'Unduvap Full Moon Poya Day'),
  ('2025-12-25', 'Christmas Day'),
  ('2026-01-03', 'Duruthu Full Moon Poya Day'),
  ('2026-01-15', 'Tamil Thai Pongal Day'),
  ('2026-02-01', 'Nawam Full Moon Poya Day'),
  ('2026-02-04', 'Independence Day'),
  ('2026-02-15', 'Maha Sivarathri Day'),
  ('2026-03-02', 'Medin Full Moon Poya Day'),
  ('2026-03-21', 'Eid al-Fitr'),
  ('2026-04-01', 'Bak Full Moon Poya Day'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-13', 'Day Before Sinhala and Tamil New Year'),
  ('2026-04-14', 'Sinhala and Tamil New Year'),
  ('2026-05-01', 'International Workers'' Day; Vesak Full Moon Poya Day'),
  ('2026-05-02', 'Day Following Vesak Full Moon Poya Day'),
  ('2026-05-28', 'Eid al-Adha'),
  ('2026-05-30', 'Adhi Poson Full Moon Poya Day'),
  ('2026-06-29', 'Poson Full Moon Poya Day'),
  ('2026-07-29', 'Esala Full Moon Poya Day'),
  ('2026-08-26', 'Prophet''s Birthday'),
  ('2026-08-27', 'Nikini Full Moon Poya Day'),
  ('2026-09-26', 'Binara Full Moon Poya Day'),
  ('2026-10-25', 'Vap Full Moon Poya Day'),
  ('2026-11-08', 'Diwali'),
  ('2026-11-24', 'Il Full Moon Poya Day'),
  ('2026-12-23', 'Unduvap Full Moon Poya Day'),
  ('2026-12-25', 'Christmas Day')
) v(d, n)
on conflict (day) do nothing;

-- The weekly update. p: [{day, name}] for whole years; p_years: the years the list fully covers.
create or replace function public.holidays_ingest(p_secret text, p jsonb, p_years int[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; added int := 0; changed int := 0; removed int := 0; y int; before int; d date; nm text;
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  perform app.require(jsonb_typeof(p) = 'array', 'A list of holidays is needed');
  foreach y in array coalesce(p_years, '{}') loop
    -- a year is replaced only when the list for it looks complete (Sri Lanka has 25 or more public holidays a year)
    perform app.require((select count(*) from jsonb_array_elements(p) x where extract(year from (x ->> 'day')::date) = y) >= 20,
      format('The list for %s looks incomplete', y));
  end loop;
  for y in select distinct extract(year from (x ->> 'day')::date)::int from jsonb_array_elements(p) x loop
    select count(*) into before from public.holidays where extract(year from day) = y;
    for r in select * from jsonb_array_elements(p) x where extract(year from (x ->> 'day')::date) = y loop
      d := (r ->> 'day')::date;
      nm := left(btrim(r ->> 'name'), 200);
      continue when nm is null or nm = '';
      if not exists (select 1 from public.holidays where day = d) then
        insert into public.holidays (day, name, source) values (d, nm, 'auto');
        added := added + 1;
      elsif exists (select 1 from public.holidays where day = d and source = 'auto' and name <> nm) then
        update public.holidays set name = nm, updated_at = now() where day = d;
        changed := changed + 1;
      end if;
    end loop;
    if y = any (coalesce(p_years, '{}')) then
      with gone as (
        delete from public.holidays h where extract(year from h.day) = y and h.source = 'auto'
           and not exists (select 1 from jsonb_array_elements(p) x where (x ->> 'day')::date = h.day)
        returning 1)
      select removed + count(*) into removed from gone;
    end if;
    if before < 15 and (select count(*) from public.holidays where extract(year from day) = y) >= 15 then
      perform app.notify_many(app.role_users('sys_admin', 'operations_exec'), 'holidays', format('%s holidays loaded', y),
        format('%s public and mercantile holidays for %s are in the calendar. Working-day clocks use them.', (select count(*) from public.holidays where extract(year from day) = y), y),
        'normal', null, null, '/admin', format('holidays_loaded:%s', y));
    end if;
  end loop;
  return jsonb_build_object('added', added, 'changed', changed, 'removed', removed);
end $$;
revoke execute on function public.holidays_ingest(text, jsonb, int[]) from public;
grant execute on function public.holidays_ingest(text, jsonb, int[]) to anon, authenticated;

-- From 15 November: next year's holidays not loaded yet – remind each week
create or replace function public.holidays_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; ny int := extract(year from today)::int + 1;
begin
  if today < make_date(ny - 1, 11, 15) then return 0; end if;
  if (select count(*) from public.holidays where extract(year from day) = ny) >= 15 then return 0; end if;
  perform app.notify_many(app.role_users('sys_admin', 'operations_exec'), 'holidays', format('%s holidays not loaded yet', ny),
    format('The weekly update has not found the %s gazette yet. Working-day clocks in January will be wrong until it is loaded – check the "DIMO – holidays" workflow, or add the days under Administration.', ny),
    'normal', null, null, '/admin', format('holidays_missing:%s:%s', ny, to_char(today, 'IYYY-IW')));
  return 1;
end $$;
revoke execute on function public.holidays_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.holidays_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('holidays-tick', '25 3 * * 1', 'select public.holidays_tick()');   -- Mondays 08:55 Sri Lanka time
  end if;
end $$;
