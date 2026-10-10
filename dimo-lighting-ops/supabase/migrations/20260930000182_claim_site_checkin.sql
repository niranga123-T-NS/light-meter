-- Warranty site visit: when the Senior Electrical Engineer assigns the inspection, the site location is set (picked on the
-- map, or the project's location) – the engineer checks in there (location verified and recorded, the SEE told) before
-- recording the inspection.

alter table public.warranty_claims add column if not exists site_lat double precision;
alter table public.warranty_claims add column if not exists site_lng double precision;
alter table public.warranty_claims add column if not exists site_radius_m int not null default 300 check (site_radius_m between 20 and 5000);
alter table public.warranty_claims add column if not exists visit_on date;

create table if not exists public.claim_checkins (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.warranty_claims (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id),
  at timestamptz not null default now(),
  day date not null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  distance_m double precision not null,
  within boolean not null
);
create index if not exists claim_checkins_claim on public.claim_checkins (claim_id, day);
alter table public.claim_checkins enable row level security;
drop policy if exists claim_checkins_read on public.claim_checkins;
create policy claim_checkins_read on public.claim_checkins for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.warranty_claims c where c.id = claim_id));
grant select on public.claim_checkins to authenticated;

-- The site of a claim: set by the SEE (or Operations); defaults to the project's location
create or replace function public.set_claim_site(p_id uuid, p_lat double precision, p_lng double precision, p_radius int default null, p_visit date default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'operations_exec'), 'The Senior Electrical Engineer sets the site location');
  c := app.claim_for_update(p_id);
  perform app.require(p_lat between -90 and 90 and p_lng between -180 and 180 and not (p_lat = 0 and p_lng = 0), 'Pick the site location on the map');
  update public.warranty_claims set site_lat = p_lat, site_lng = p_lng, site_radius_m = coalesce(p_radius, site_radius_m), visit_on = coalesce(p_visit, visit_on) where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'site', format('Site location set %s, %s (check-in within %s m)', round(p_lat::numeric, 5), round(p_lng::numeric, 5), coalesce(p_radius, c.site_radius_m)));
end $$;

-- The engineer checks in at the claim site: verified against the site and recorded; the SEE is told
create or replace function public.claim_checkin(p_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims; d double precision; ok boolean;
begin
  select * into c from public.warranty_claims where id = p_id;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(c.assignee_id = auth.uid() or app.has_role('senior_elec_engineer'), 'Only the assigned engineer checks in');
  perform app.require(c.site_lat is not null, 'The site location is not set – the Senior Electrical Engineer sets it');
  perform app.require(p_lat is not null and p_lng is not null, 'Your location could not be read – allow location access and try again');
  d := app.distance_m(c.site_lat, c.site_lng, p_lat, p_lng);
  ok := d <= c.site_radius_m + least(coalesce(p_accuracy, 0), 100);
  insert into public.claim_checkins (claim_id, day, lat, lng, accuracy_m, distance_m, within)
  values (c.id, (now() at time zone app.tz())::date, p_lat, p_lng, p_accuracy, round(d::numeric, 0), ok);
  perform app.notify_many(app.role_users('senior_elec_engineer'), 'claim_checkin',
    case when ok then format('Checked in at the claim site – %s', app.display_name(auth.uid())) else format('Check-in away from the claim site – %s', app.display_name(auth.uid())) end,
    format('%s · %s · %s from the site', app.claim_head(c), to_char(now() at time zone app.tz(), 'DD Mon HH24:MI'),
      case when d < 1000 then round(d::numeric) || ' m' else round((d / 1000)::numeric, 1) || ' km' end),
    case when ok then 'normal' else 'critical' end::public.priority, 'warranty_claim', c.id, app.claim_url(c.id));
  return jsonb_build_object('within', ok, 'distance_m', round(d::numeric, 0), 'radius_m', c.site_radius_m);
end $$;


drop function if exists public.assign_warranty_claim(uuid, uuid);
create or replace function public.assign_warranty_claim(p_id uuid, p_assignee uuid, p_lat double precision default null, p_lng double precision default null,
  p_radius int default null, p_visit date default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims; plat double precision; plng double precision;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'Only the Senior Electrical Engineer assigns engineers');
  c := app.claim_for_update(p_id);
  perform app.require(p_assignee is not null, 'Choose the engineer');
  perform app.check_engineer(p_assignee);
  -- The site to check in at: picked now, already set, or the project's location
  if p_lat is not null then
    perform public.set_claim_site(c.id, p_lat, p_lng, p_radius, p_visit);
  elsif c.site_lat is null then
    select p.lat, p.lng into plat, plng from public.warranties w join public.projects p on p.id = w.project_id where w.id = c.warranty_id;
    perform app.require(plat is not null, 'Set the site location on the map – the engineer checks in there');
    perform public.set_claim_site(c.id, plat, plng, p_radius, p_visit);
  elsif p_visit is not null then
    update public.warranty_claims set visit_on = p_visit where id = c.id;
  end if;
  update public.warranty_claims set assignee_id = p_assignee, assigned_at = now(), inspect_alert_level = 0,
    verified_at = case when needs_verification and verified_at is null then now() else verified_at end,
    verified_by = case when needs_verification and verified_at is null then auth.uid() else verified_by end
  where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'assigned', case when c.needs_verification and c.verified_at is null then 'Verified and assigned to ' else 'Assigned to ' end
          || app.display_name(p_assignee));
  perform app.notify(p_assignee, 'warranty_claim_assigned', 'Warranty claim assigned to you – inspect the site', app.claim_head(c) || coalesce(' · visit ' || to_char(p_visit, 'DD Mon'), '') || ' · check in at the site first',
    'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  if c.needs_verification and c.verified_at is null and c.reported_by is not null then
    perform app.notify(c.reported_by, 'warranty_claim_opened', 'Your warranty claim was verified', app.claim_head(c) || ' · engineer ' || app.display_name(p_assignee),
      'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  end if;
end $$;

create or replace function public.record_claim_inspection(p_id uuid, p_on date, p_findings text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims;
begin
  c := app.claim_for_update(p_id);
  perform app.require(app.can_work_claim(c), 'Only the assigned engineer, Operations or the Senior Electrical Engineer update this claim');
  perform app.require(p_on is not null and p_on <= (now() at time zone app.tz())::date, 'Enter the inspection date (not in the future)');
  perform app.require(coalesce(btrim(p_findings), '') <> '', 'Enter the findings');
  -- The assigned engineer checks in at the site (location verified) on the inspection day
  if c.assignee_id = auth.uid() and not app.has_role('senior_elec_engineer', 'operations_exec') and c.site_lat is not null then
    perform app.require(exists (select 1 from public.claim_checkins k where k.claim_id = c.id and k.user_id = auth.uid() and k.within and k.day = p_on),
      'Check in at the site first – your location is verified before the inspection is recorded');
  end if;
  update public.warranty_claims set inspected_on = p_on, inspection_findings = btrim(p_findings) where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'inspected', format('Inspected %s: %s', to_char(p_on, 'DD Mon YYYY'), btrim(p_findings)));
  perform app.notify_many(app.role_users('senior_elec_engineer'), 'warranty_claim_inspected', 'Claim inspected – decide covered / chargeable / rejected',
    app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;

revoke execute on function public.set_claim_site(uuid, double precision, double precision, int, date), public.claim_checkin(uuid, double precision, double precision, double precision),
  public.assign_warranty_claim(uuid, uuid, double precision, double precision, int, date) from public, anon;
grant execute on function public.set_claim_site(uuid, double precision, double precision, int, date), public.claim_checkin(uuid, double precision, double precision, double precision),
  public.assign_warranty_claim(uuid, uuid, double precision, double precision, int, date) to authenticated, service_role;
