-- Site weather for the daily reports. Every day at 19:00 (Sri Lanka) the GitHub workflow "DIMO – site weather" reads the
-- weather at each active execution project's site (Open-Meteo, from the site location set for check-in, else the project's
-- location) and records the day's profile – hour by hour and the day's summary – with the forecast for the next day.
-- It shows under Daily reports › Weather and is added to the daily reports of that date (screen and PDF).

create table public.exec_weather (
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  day date not null,
  lat double precision not null,
  lng double precision not null,
  -- {code, tmax, tmin, rain_mm, rain_prob, wind_max, gust_max, rh_avg, uv_max, sunrise, sunset, work_rain_mm, work_rain_hours, work_tmax}
  summary jsonb not null,
  -- [{h: 0..23, t, rh, p, pp, code, w, g}] – temperature °C, humidity %, rain mm, rain chance %, weather code, wind and gusts km/h
  hours jsonb not null default '[]',
  -- the forecast for the next day as read at 19:00: {day, code, tmax, tmin, rain_mm, rain_prob, wind_max, gust_max, hours: [...]}
  tomorrow jsonb,
  source text not null default 'Open-Meteo',
  fetched_at timestamptz not null default now(),
  primary key (exec_project_id, day)
);
create index on public.exec_weather (day);

alter table public.exec_weather enable row level security;
create policy exec_weather_read on public.exec_weather for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.exec_weather to authenticated;

-- The sites to read: active projects with a location (the check-in site location first, then the project's own)
create or replace function public.weather_sites(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'start', e.start_date,
             'lat', coalesce(e.site_lat, e.lat, p.lat), 'lng', coalesce(e.site_lng, e.lng, p.lng)) order by e.name)
      from public.exec_projects e left join public.projects p on p.id = e.project_id
     where e.status = 'active' and coalesce(e.site_lat, e.lat, p.lat) is not null and coalesce(e.site_lng, e.lng, p.lng) is not null
  ), '[]'::jsonb);
end $$;

-- rows: [{exec, day, lat, lng, summary, hours, tomorrow}] – a day read again replaces its profile; the forecast for the next
-- day is kept when a later read has none (a back-filled past day)
create or replace function public.weather_ingest(p_secret text, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    continue when not exists (select 1 from public.exec_projects where id = (r ->> 'exec')::uuid);
    insert into public.exec_weather (exec_project_id, day, lat, lng, summary, hours, tomorrow, fetched_at)
    values ((r ->> 'exec')::uuid, (r ->> 'day')::date, (r ->> 'lat')::double precision, (r ->> 'lng')::double precision,
            coalesce(r -> 'summary', '{}'), coalesce(r -> 'hours', '[]'), nullif(r -> 'tomorrow', 'null'::jsonb), now())
    on conflict (exec_project_id, day) do update set lat = excluded.lat, lng = excluded.lng, summary = excluded.summary, hours = excluded.hours,
      tomorrow = coalesce(excluded.tomorrow, exec_weather.tomorrow), fetched_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.weather_sites(text), public.weather_ingest(text, jsonb) from public;
grant execute on function public.weather_sites(text), public.weather_ingest(text, jsonb) to anon, authenticated;
