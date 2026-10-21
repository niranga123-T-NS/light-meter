-- The site location shared by whoever raises a warranty issue or a project defect (the sales person's GPS at the site, a pin on the
-- map, or the project location). It goes with the issue: a claim opened from a sales report or a defect starts from it, the SEE checks
-- it (or adjusts it) when assigning, and the engineer opens it in Maps. What the reporter shared is kept as they shared it.
alter table public.warranty_reports add column if not exists rep_lat double precision, add column if not exists rep_lng double precision,
  add column if not exists rep_from text check (rep_from in ('gps', 'map', 'project'));
alter table public.warranty_claims add column if not exists rep_lat double precision, add column if not exists rep_lng double precision,
  add column if not exists rep_from text check (rep_from in ('gps', 'map', 'project'));
alter table public.project_defects add column if not exists rep_lat double precision, add column if not exists rep_lng double precision,
  add column if not exists rep_from text check (rep_from in ('gps', 'map', 'project'));
-- the point the SEE checked for the engineer (the shared one, or adjusted – the shared one stays as it was)
alter table public.project_defects add column if not exists site_lat double precision, add column if not exists site_lng double precision,
  add column if not exists site_checked_by uuid references public.profiles (id), add column if not exists site_checked_at timestamptz;

-- Share the location of a report, claim or defect: the person who raised it, or the SEE / Operations / SM Projects
create or replace function public.set_reported_location(p_kind text, p_id uuid, p_lat double precision, p_lng double precision, p_from text) returns void
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  perform app.require(p_lat between -90 and 90 and p_lng between -180 and 180 and not (p_lat = 0 and p_lng = 0), 'The location is not valid');
  perform app.require(p_from in ('gps', 'map', 'project'), 'Say how the location was set');
  if p_kind = 'warranty_report' then
    select sales_person_id = auth.uid() or app.has_role('operations_exec', 'senior_elec_engineer', 'sm_projects') into ok from public.warranty_reports where id = p_id;
    perform app.require(coalesce(ok, false), 'Only the person who reported it, Operations or the SEE shares its location');
    update public.warranty_reports set rep_lat = p_lat, rep_lng = p_lng, rep_from = p_from where id = p_id;
  elsif p_kind = 'warranty_claim' then
    select logged_by = auth.uid() or reported_by = auth.uid() or app.has_role('operations_exec', 'senior_elec_engineer', 'sm_projects') into ok from public.warranty_claims where id = p_id;
    perform app.require(coalesce(ok, false), 'Only the person who logged it, Operations or the SEE shares its location');
    update public.warranty_claims set rep_lat = p_lat, rep_lng = p_lng, rep_from = p_from where id = p_id;
  elsif p_kind = 'project_defect' then
    select reported_by = auth.uid() or app.defect_manager() into ok from public.project_defects where id = p_id;
    perform app.require(coalesce(ok, false), 'Only the person who reported it, the SEE or SM Projects shares its location');
    update public.project_defects set rep_lat = p_lat, rep_lng = p_lng, rep_from = p_from where id = p_id;
  else
    perform app.require(false, 'Unknown record');
  end if;
end $$;

-- The SEE / SM Projects checks the defect's location for the engineer (the shared point, or adjusted); the engineer is told
create or replace function public.set_defect_site(p_id uuid, p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = public as $$
declare d public.project_defects;
begin
  perform app.require(app.defect_manager(), 'The SEE or SM Projects checks the site location');
  perform app.require(p_lat between -90 and 90 and p_lng between -180 and 180 and not (p_lat = 0 and p_lng = 0), 'The location is not valid');
  update public.project_defects set site_lat = p_lat, site_lng = p_lng, site_checked_by = auth.uid(), site_checked_at = now() where id = p_id returning * into d;
  perform app.require(d.id is not null, 'Defect not found');
  if d.assignee_id is not null and d.assignee_id <> auth.uid() and d.status = 'assigned' then
    perform app.notify(d.assignee_id, 'defect', 'Defect site location set – open it in Maps', app.defect_head(d), 'normal', 'project_defect', d.id, '/warranty/defects/' || d.id);
  end if;
end $$;

-- A claim opened from a sales report or a defect starts from the location shared there
create or replace function app.warranty_claims_rep_loc() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rep_lat is null and new.report_id is not null then
    select rep_lat, rep_lng, rep_from into new.rep_lat, new.rep_lng, new.rep_from from public.warranty_reports where id = new.report_id;
  end if;
  if new.rep_lat is null and new.defect_id is not null then
    select coalesce(site_lat, rep_lat), coalesce(site_lng, rep_lng), case when site_lat is not null then 'map' else rep_from end
      into new.rep_lat, new.rep_lng, new.rep_from from public.project_defects where id = new.defect_id;
  end if;
  return new;
end $$;
drop trigger if exists warranty_claims_rep_loc on public.warranty_claims;
create trigger warranty_claims_rep_loc before insert on public.warranty_claims for each row execute function app.warranty_claims_rep_loc();

revoke all on function public.set_reported_location(text, uuid, double precision, double precision, text), public.set_defect_site(uuid, double precision, double precision) from public, anon;
grant execute on function public.set_reported_location(text, uuid, double precision, double precision, text), public.set_defect_site(uuid, double precision, double precision) to authenticated;
