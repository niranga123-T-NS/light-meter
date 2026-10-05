-- Sales map: places for planned visits that have none yet.
-- Planned visits were placed only from the plan line, the project's saved site or the customer's past GPS visits, so new
-- customers and projects created without "Use my current location" never showed. Now:
--  * Customers have a map location too (organizations.lat / lng).
--  * set_map_location: GM / DGM, SM Projects, the project owner or the customer's account owner (or any sales person for
--    a customer with no owner) sets a project's site or a customer's location from the map (address search, a click on
--    the map, or the current position).
--  * Planned visits are placed from: the plan line → the project site → the customer location → the customer's last visit.

alter table public.organizations add column if not exists lat double precision, add column if not exists lng double precision;

create or replace function public.set_map_location(p_kind text, p_id uuid, p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  perform app.require(p_kind in ('project', 'customer'), 'Choose a project or customer');
  perform app.require(p_lat between -90 and 90 and p_lng between -180 and 180, 'Choose a point on the map');
  if p_kind = 'project' then
    select owner_id into owner from public.projects where id = p_id;
    perform app.require(found, 'Project not found');
    perform app.require(app.has_role('gm', 'sm_projects') or owner = auth.uid(), 'Only the project owner, SM Projects or GM / DGM sets the site location');
    update public.projects set lat = p_lat, lng = p_lng where id = p_id;
  else
    select account_owner_id into owner from public.organizations where id = p_id;
    perform app.require(found, 'Customer not found');
    perform app.require(app.has_role('gm', 'sm_projects') or owner = auth.uid() or (owner is null and app.is_sales_person()),
      'Only the account owner, SM Projects or GM / DGM sets the customer location');
    update public.organizations set lat = p_lat, lng = p_lng where id = p_id;
  end if;
end $$;
revoke execute on function public.set_map_location(text, uuid, double precision, double precision) from public, anon;
grant execute on function public.set_map_location(text, uuid, double precision, double precision) to authenticated;

-- Coverage: a customer's saved location first (copied from 20260930000079)
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
  select 'customer'::text, o.id, o.name, null::text, o.account_owner_id, app.display_name(o.account_owner_id), coalesce(o.lat, lp.lat), coalesce(o.lng, lp.lng),
         (case when o.lat is not null then 'site' when lp.lat is not null then 'visit' end)::text,
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

-- Planned visits: … → the customer's saved location → its last visit (copied from 20260930000080; adds organization_id)
drop function if exists public.map_plan_lines(date, date, uuid);
create or replace function public.map_plan_lines(p_from date, p_to date, p_person uuid default null)
returns table (id uuid, plan_id uuid, organization_id uuid, plan_status text, sales_person_id uuid, person text, planned_date date, time_slot text,
  status text, customer text, project text, project_id uuid, objective text, category text, lat double precision, lng double precision,
  loc_source text, visit_id uuid, visit_lat double precision, visit_lng double precision, gps_verified boolean, from_meeting boolean,
  change_reason text, missed_reason text)
language plpgsql stable security definer set search_path = public as $$
declare who uuid := app.map_scope(p_person);   -- checks access first, always
begin
  return query
  select l.id, l.plan_id, l.organization_id, vp.status, vp.sales_person_id, app.display_name(vp.sales_person_id), l.planned_date, l.time_slot,
         l.status, o.name, p.name, l.project_id, l.planned_objective, l.visit_category,
         coalesce(l.lat, p.lat, o.lat, ov.lat), coalesce(l.lng, p.lng, o.lng, ov.lng),
         (case when l.lat is not null then 'plan' when p.lat is not null then 'site' when o.lat is not null then 'customer'
               when ov.lat is not null then 'visit' end)::text,
         v.id, v.checkin_lat, v.checkin_lng, v.gps_verified, l.meeting_action_id is not null, l.change_reason, l.missed_reason
    from public.visit_plan_lines l
    join public.visit_plans vp on vp.id = l.plan_id
    join public.organizations o on o.id = l.organization_id
    left join public.projects p on p.id = l.project_id
    left join lateral (select x.checkin_lat as lat, x.checkin_lng as lng from public.visits x
                        where x.organization_id = l.organization_id and x.checkin_lat is not null
                        order by x.checkin_at desc limit 1) ov on true
    left join lateral (select x.id, x.checkin_lat, x.checkin_lng, x.gps_verified from public.visits x
                        where x.plan_line_id = l.id order by x.checkin_at limit 1) v on true
   where l.planned_date between p_from and p_to
     and (who is null or vp.sales_person_id = who)
     and (vp.status in ('submitted', 'approved') or vp.sales_person_id = auth.uid())
   order by l.planned_date, l.time_slot nulls last
   limit 5000;
end $$;
revoke execute on function public.map_plan_lines(date, date, uuid) from public, anon;
grant execute on function public.map_plan_lines(date, date, uuid) to authenticated;
