-- Working-hours calendar and notification helpers (SRS Section 8).
-- All clocks are measured in working minutes: Mon–Fri 08:30–17:30 Asia/Colombo,
-- Sri Lanka public and mercantile holidays excluded (public.holidays). Configurable in public.settings.

create or replace function app.tz() returns text
language sql stable as $$ select coalesce(app.setting('timezone') #>> '{}', 'Asia/Colombo') $$;

create or replace function app.work_start() returns time
language sql stable as $$ select coalesce(app.setting('working_hours') ->> 'start', '08:30')::time $$;

create or replace function app.work_end() returns time
language sql stable as $$ select coalesce(app.setting('working_hours') ->> 'end', '17:30')::time $$;

create or replace function app.is_working_day(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(isodow from d)::int = any (
           coalesce((select array_agg(x::int) from jsonb_array_elements_text(app.setting('working_hours') -> 'days') x),
                    array[1, 2, 3, 4, 5]))
     and not exists (select 1 from public.holidays h where h.day = d)
$$;

create or replace function app.working_minutes_per_day() returns int
language sql stable as $$ select (extract(epoch from (app.work_end() - app.work_start())) / 60)::int $$;

-- ts + N working minutes
create or replace function app.add_work_minutes(ts timestamptz, mins numeric) returns timestamptz
language plpgsql stable as $$
declare
  tz text := app.tz();
  s time := app.work_start();
  e time := app.work_end();
  loc timestamp := ts at time zone tz;
  d date;
  day_start timestamp;
  day_end timestamp;
  avail numeric;
  guard int := 0;
begin
  if mins <= 0 then return ts; end if;
  loop
    guard := guard + 1;
    if guard > 5000 then raise exception 'add_work_minutes: runaway loop'; end if;
    d := loc::date;
    day_start := d + s;
    day_end := d + e;
    if not app.is_working_day(d) or loc >= day_end then
      loc := (d + 1) + s;
      continue;
    end if;
    if loc < day_start then loc := day_start; end if;
    avail := extract(epoch from (day_end - loc)) / 60;
    if mins <= avail then
      return (loc + make_interval(secs => mins * 60)) at time zone tz;
    end if;
    mins := mins - avail;
    loc := (d + 1) + s;
  end loop;
end $$;

-- Working minutes elapsed between a and b
create or replace function app.work_minutes_between(a timestamptz, b timestamptz) returns numeric
language plpgsql stable as $$
declare
  tz text := app.tz();
  s time := app.work_start();
  e time := app.work_end();
  la timestamp := a at time zone tz;
  lb timestamp := b at time zone tz;
  d date;
  total numeric := 0;
  lo timestamp;
  hi timestamp;
begin
  if a is null or b is null or b <= a then return 0; end if;
  d := la::date;
  while d <= lb::date loop
    if app.is_working_day(d) then
      lo := greatest(la, d + s);
      hi := least(lb, d + e);
      if hi > lo then total := total + extract(epoch from (hi - lo)) / 60; end if;
    end if;
    d := d + 1;
  end loop;
  return total;
end $$;

-- Start of the next working day at a given local time (e.g. 09:00 repeats)
create or replace function app.next_working_day_at(ts timestamptz, at_time time) returns timestamptz
language plpgsql stable as $$
declare
  tz text := app.tz();
  d date := (ts at time zone tz)::date + 1;
begin
  while not app.is_working_day(d) loop d := d + 1; end loop;
  return (d + at_time) at time zone tz;
end $$;

-- Quiet hours (Section 8.4): no non-critical push 20:00–07:00, Sundays or public holidays.
-- Held notices are delivered at 07:00 on the next non-quiet day.
create or replace function app.delivery_time(p_priority public.priority, p_recipient uuid) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := app.tz();
  loc timestamp := now() at time zone tz;
  d date := loc::date;
  digest boolean;
begin
  if p_priority = 'critical' then return now(); end if;

  select digest_mode into digest from public.profiles where id = p_recipient;
  if coalesce(digest, false) then
    -- Daily digest users get non-critical notices with the 08:30 digest.
    if loc::time >= time '08:30' then d := d + 1; end if;
    while extract(isodow from d) = 7 or exists (select 1 from public.holidays where day = d) loop d := d + 1; end loop;
    return (d + time '08:30') at time zone tz;
  end if;

  if extract(isodow from d) <> 7 and not exists (select 1 from public.holidays where day = d)
     and loc::time >= time '07:00' and loc::time < time '20:00' then
    return now();
  end if;
  if loc::time >= time '20:00' then d := d + 1; end if;
  while extract(isodow from d) = 7 or exists (select 1 from public.holidays where day = d) loop d := d + 1; end loop;
  return (d + time '07:00') at time zone tz;
end $$;

create or replace function app.notify(
  p_recipient uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_priority public.priority default 'normal',
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_url text default null,
  p_dedupe_key text default null,
  p_requires_open boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null then return; end if;
  if not exists (select 1 from public.profiles where id = p_recipient and active) then return; end if;
  insert into public.notifications
    (recipient_id, kind, title, body, priority, entity_type, entity_id, url, dedupe_key, requires_open, deliver_after)
  values
    (p_recipient, p_kind, p_title, p_body, p_priority, p_entity_type, p_entity_id, p_url, p_dedupe_key, p_requires_open,
     app.delivery_time(p_priority, p_recipient))
  on conflict (recipient_id, dedupe_key) do nothing;
end $$;

create or replace function app.notify_many(
  p_recipients uuid[],
  p_kind text,
  p_title text,
  p_body text,
  p_priority public.priority default 'normal',
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_url text default null,
  p_dedupe_key text default null,
  p_requires_open boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  for r in select distinct x from unnest(p_recipients) x where x is not null loop
    perform app.notify(r, p_kind, p_title, p_body, p_priority, p_entity_type, p_entity_id, p_url, p_dedupe_key, p_requires_open);
  end loop;
end $$;

create or replace function app.role_users(variadic roles public.app_role[]) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.profiles where role = any (roles) and active
$$;

create or replace function app.manager_of(u uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select manager_id from public.profiles where id = u
$$;

create or replace function app.display_name(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select full_name from public.profiles where id = u
$$;

-- Money formatting used in notification text, e.g. "LKR 2.4M"
create or replace function app.fmt_money(amount numeric, cur public.currency) returns text
language sql immutable as $$
  select case
    when amount is null then '—'
    when abs(amount) >= 1000000 then format('%s %sM', cur, round(amount / 1000000, 1))
    when abs(amount) >= 1000 then format('%s %sK', cur, round(amount / 1000, 1))
    else format('%s %s', cur, round(amount, 0)) end
$$;
