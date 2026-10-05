-- GPS check of customer visits: a visit with no project is compared with the customer's saved location (from the address,
-- the map or a first check-in). Before, only the planned point or the project site was used, so customer visits were never
-- verified. When a location is set by hand or from the address, earlier visits that had nothing to compare with are re-checked.

-- Runs after app.visits_before (trigger names fire in alphabetical order): fill the gap it leaves for customer visits
create or replace function app.visits_gps_customer() returns trigger
language plpgsql security definer set search_path = public as $$
declare o_lat double precision; o_lng double precision;
begin
  if new.checkin_lat is null or new.distance_from_site_m is not null or new.project_id is not null then return new; end if;
  if tg_op = 'UPDATE' and new.checkin_lat is not distinct from old.checkin_lat then return new; end if;
  select lat, lng into o_lat, o_lng from public.organizations where id = new.organization_id;
  if o_lat is null then return new; end if;
  new.distance_from_site_m := app.distance_m(new.checkin_lat, new.checkin_lng, o_lat, o_lng);
  new.gps_verified := new.distance_from_site_m <= app.setting_num('gps_radius_m', 500);
  return new;
end $$;
drop trigger if exists visits_gps_customer on public.visits;
create trigger visits_gps_customer before insert or update of checkin_lat on public.visits
  for each row execute function app.visits_gps_customer();

-- Re-check visits that had no site to compare with. The visit whose check-in became the location itself is left as it was
-- (comparing it with its own point would prove nothing).
create or replace function app.recheck_visit_gps(p_kind text, p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s_lat double precision; s_lng double precision; n int;
begin
  if p_kind = 'project' then select lat, lng into s_lat, s_lng from public.projects where id = p_id;
  else select lat, lng into s_lat, s_lng from public.organizations where id = p_id; end if;
  if s_lat is null then return 0; end if;
  update public.visits v
     set distance_from_site_m = app.distance_m(v.checkin_lat, v.checkin_lng, s_lat, s_lng),
         gps_verified = app.distance_m(v.checkin_lat, v.checkin_lng, s_lat, s_lng) <= app.setting_num('gps_radius_m', 500)
   where v.checkin_lat is not null and v.distance_from_site_m is null
     and not (v.checkin_lat = s_lat and v.checkin_lng = s_lng)
     and case when p_kind = 'project' then v.project_id = p_id else v.project_id is null and v.organization_id = p_id end;
  get diagnostics n = row_count;
  return n;
end $$;

-- (copied from 20260930000081: re-checks earlier visits after a location is set)
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
    perform app.recheck_visit_gps('project', p_id);
  else
    select account_owner_id into owner from public.organizations where id = p_id;
    perform app.require(found, 'Customer not found');
    perform app.require(app.has_role('gm', 'sm_projects') or owner = auth.uid() or (owner is null and app.is_sales_person()),
      'Only the account owner, SM Projects or GM / DGM sets the customer location');
    update public.organizations set lat = p_lat, lng = p_lng where id = p_id;
    perform app.recheck_visit_gps('customer', p_id);
  end if;
end $$;

-- One-off: customer visits that already have a customer location to compare with
do $$ declare o record;
begin
  for o in select distinct v.organization_id as id from public.visits v join public.organizations g on g.id = v.organization_id
            where v.project_id is null and v.checkin_lat is not null and v.distance_from_site_m is null and g.lat is not null loop
    perform app.recheck_visit_gps('customer', o.id);
  end loop;
end $$;
