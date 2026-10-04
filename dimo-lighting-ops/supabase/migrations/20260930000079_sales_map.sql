-- Sales map (web app): visits and account coverage on a map for GM / DGM, SM Projects and the sales persons.
--  * GM / DGM and SM Projects see the whole team (or one person); a sales person sees only their own visits and accounts.
--  * Only recorded check-in points are shown – no live tracking.
--  * A project's map position is its saved site location, else the first GPS-verified (then any) visit check-in to it;
--    a customer's position is its most recent visit check-in. Accounts with no position are returned without one
--    (the map counts them as "no location").

create or replace function app.map_scope(p_person uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.has_role('gm', 'sm_projects', 'asm_building', 'asm_infra'), 'The sales map is for GM / DGM, SM Projects and sales');
  if app.is_sales_person() then return auth.uid(); end if;   -- sales persons: their own only
  return p_person;                                           -- managers: one person, or null = everyone
end $$;

-- Visits checked in between two dates (Colombo time)
create or replace function public.map_visits(p_from date, p_to date, p_person uuid default null)
returns table (id uuid, code text, sales_person_id uuid, person text, checkin_at timestamptz, checkout_at timestamptz,
  lat double precision, lng double precision, gps_verified boolean, distance_m double precision, customer text, project text,
  project_id uuid, objective text, outcome text, status text, planned boolean, plan_lat double precision, plan_lng double precision)
language plpgsql stable security definer set search_path = public as $$
declare who uuid := app.map_scope(p_person);   -- checks access first, always
begin
  return query
  select v.id, v.code, v.sales_person_id, app.display_name(v.sales_person_id), v.checkin_at, v.checkout_at,
         v.checkin_lat, v.checkin_lng, v.gps_verified, v.distance_from_site_m, o.name, p.name, v.project_id,
         v.primary_objective, v.outcome, v.status, v.plan_line_id is not null, l.lat, l.lng
    from public.visits v
    join public.organizations o on o.id = v.organization_id
    left join public.projects p on p.id = v.project_id
    left join public.visit_plan_lines l on l.id = v.plan_line_id
   where (who is null or v.sales_person_id = who)
     and (v.checkin_at at time zone app.tz())::date between p_from and p_to
   order by v.checkin_at
   limit 5000;
end $$;

-- Coverage: active projects and customers with their position and last visit
create or replace function public.map_coverage(p_person uuid default null)
returns table (kind text, id uuid, name text, customer text, owner_id uuid, owner text, lat double precision, lng double precision,
  loc_source text, last_visit timestamptz, days_since int, visits_90d int, value_lkr numeric, status text)
language plpgsql stable security definer set search_path = public as $$
declare who uuid := app.map_scope(p_person); d date := (now() at time zone app.tz())::date;
begin
  return query
  select 'project'::text, p.id, p.name, o.name, p.owner_id, app.display_name(p.owner_id),
         coalesce(p.lat, fv.lat), coalesce(p.lng, fv.lng),
         (case when p.lat is not null then 'site' when fv.lat is not null then 'visit' end)::text,
         lv.last_at, case when lv.last_at is null then null else d - (lv.last_at at time zone app.tz())::date end,
         lv.n90, round(coalesce(app.to_lkr(p.lighting_value, case when p.duty_status = 'duty_free' then 'USD'::public.currency else 'LKR'::public.currency end), 0), 2),
         p.status
    from public.projects p
    join public.organizations o on o.id = p.organization_id
    left join lateral (select v.checkin_lat as lat, v.checkin_lng as lng from public.visits v
                        where v.project_id = p.id and v.checkin_lat is not null
                        order by v.gps_verified is true desc, v.checkin_at limit 1) fv on true
    left join lateral (select max(v.checkin_at) as last_at,
                              count(*) filter (where v.checkin_at > now() - interval '90 days')::int as n90
                         from public.visits v where v.project_id = p.id) lv on true
   where p.status in ('active', 'dormant', 'on_hold') and (who is null or p.owner_id = who)
  union all
  select 'customer'::text, o.id, o.name, null::text, o.account_owner_id, app.display_name(o.account_owner_id), lp.lat, lp.lng,
         case when lp.lat is not null then 'visit' end::text,
         lv.last_at, case when lv.last_at is null then null else d - (lv.last_at at time zone app.tz())::date end,
         lv.n90, null::numeric, o.status
    from public.organizations o
    left join lateral (select v.checkin_lat as lat, v.checkin_lng as lng from public.visits v
                        where v.organization_id = o.id and v.checkin_lat is not null
                        order by v.gps_verified is true desc, v.checkin_at desc limit 1) lp on true
    left join lateral (select max(v.checkin_at) as last_at,
                              count(*) filter (where v.checkin_at > now() - interval '90 days')::int as n90
                         from public.visits v where v.organization_id = o.id
                          and (who is null or v.sales_person_id = who)) lv on true
   where o.status = 'active' and o.merged_into is null
     and (who is null or o.account_owner_id = who);
end $$;

revoke execute on function public.map_visits(date, date, uuid), public.map_coverage(uuid) from public, anon;
grant execute on function public.map_visits(date, date, uuid), public.map_coverage(uuid) to authenticated;
