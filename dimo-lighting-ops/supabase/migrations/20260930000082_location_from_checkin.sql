-- Locations fill in by themselves: the first visit checked in with GPS at a customer or project that has no map location
-- yet becomes its location (project site / customer location). A location set by hand is never overwritten.
create or replace function app.visit_sets_locations() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.checkin_lat is null or new.checkin_lng is null then return new; end if;
  if tg_op = 'UPDATE' and old.checkin_lat is not null then return new; end if;
  if new.project_id is not null then
    update public.projects set lat = new.checkin_lat, lng = new.checkin_lng where id = new.project_id and lat is null;
  end if;
  -- The customer's location only from a visit that is not to a project site (their office), or when it has none at all
  update public.organizations set lat = new.checkin_lat, lng = new.checkin_lng
   where id = new.organization_id and lat is null and new.project_id is null;
  return new;
end $$;
drop trigger if exists visit_sets_locations on public.visits;
create trigger visit_sets_locations after insert or update of checkin_lat on public.visits
  for each row execute function app.visit_sets_locations();

-- One-off: fill existing projects and customers from their earliest GPS check-in (verified first)
update public.projects p set lat = v.checkin_lat, lng = v.checkin_lng
  from (select distinct on (project_id) project_id, checkin_lat, checkin_lng from public.visits
         where project_id is not null and checkin_lat is not null order by project_id, gps_verified is true desc, checkin_at) v
 where v.project_id = p.id and p.lat is null;
update public.organizations o set lat = v.checkin_lat, lng = v.checkin_lng
  from (select distinct on (organization_id) organization_id, checkin_lat, checkin_lng from public.visits
         where project_id is null and checkin_lat is not null order by organization_id, gps_verified is true desc, checkin_at) v
 where v.organization_id = o.id and o.lat is null;
