-- As-laid cable routes: each cable route walked on site with the phone before backfill – the GPS track, depth points, joints,
-- road crossings, ducts, marker posts and other services met, with photos; the route summary, the cable tests and the senior
-- engineer's sign-off; and years later anyone on the team finds the cable again from where they stand.
--  * The project team records (SEE, SM Projects, the project's AE, trainee and subcontractor supervisor).
--  * The SEE, SM Projects or the DGM approves or sends a query back; an approved route is locked.
--  * Photos are kept in the private "aslaid" bucket under <project id>/aslaid/.

create table public.exec_aslaid_routes (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects(id) on delete cascade,
  code text,
  from_name text not null,
  to_name text not null,
  cable text,
  schedule_ref text,
  schedule_m numeric check (schedule_m is null or schedule_m > 0),
  drum_m numeric check (drum_m is null or drum_m > 0),
  req_depth_m numeric not null default 0.6 check (req_depth_m > 0 and req_depth_m < 5),
  status text not null default 'not_started' check (status in ('not_started', 'recording', 'to_approve', 'approved', 'queried')),
  track jsonb not null default '[]'::jsonb,
  gps_m numeric not null default 0,
  ir_mohm numeric check (ir_mohm is null or ir_mohm >= 0),
  armour_ohm numeric check (armour_ohm is null or armour_ohm >= 0),
  query_note text,
  approve_note text,
  recorded_by uuid references public.profiles(id),
  started_at timestamptz,
  finished_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exec_aslaid_routes_exec on public.exec_aslaid_routes (exec_project_id);

create table public.exec_aslaid_points (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.exec_aslaid_routes(id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects(id) on delete cascade,
  kind text not null check (kind in ('depth', 'joint', 'crossing', 'duct', 'marker', 'service', 'other')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  acc_m numeric,
  chain_m numeric,
  depth_m numeric check (depth_m is null or (depth_m > 0 and depth_m < 10)),
  protection text[] not null default '{}',
  tie_feature text,
  tie_m numeric check (tie_m is null or tie_m >= 0),
  note text,
  taken_by uuid references public.profiles(id) default auth.uid(),
  taken_at timestamptz not null default now()
);
create index exec_aslaid_points_route on public.exec_aslaid_points (route_id);

create table public.exec_aslaid_photos (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.exec_aslaid_routes(id) on delete cascade,
  point_id uuid references public.exec_aslaid_points(id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects(id) on delete cascade,
  path text not null,
  note text,
  lat double precision,
  lng double precision,
  taken_by uuid references public.profiles(id) default auth.uid(),
  taken_at timestamptz not null default now()
);
create index exec_aslaid_photos_route on public.exec_aslaid_photos (route_id);

create or replace function app.aslaid_can_record(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer', 'sm_projects') or (app.has_role('assistant_engineer', 'trainee', 'sub_supervisor') and app.is_exec_member(p_exec))
$$;
create or replace function app.aslaid_can_approve(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer', 'sm_projects', 'gm')
$$;

alter table public.exec_aslaid_routes enable row level security;
alter table public.exec_aslaid_points enable row level security;
alter table public.exec_aslaid_photos enable row level security;
create policy exec_aslaid_routes_read on public.exec_aslaid_routes for select to authenticated using (app.can_read_exec(exec_project_id));
create policy exec_aslaid_points_read on public.exec_aslaid_points for select to authenticated using (app.can_read_exec(exec_project_id));
create policy exec_aslaid_photos_read on public.exec_aslaid_photos for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.exec_aslaid_routes, public.exec_aslaid_points, public.exec_aslaid_photos to authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('aslaid', 'aslaid', false, 20971520, array['image/jpeg', 'image/png', 'image/heic', 'image/webp'])
    on conflict (id) do nothing;
    execute 'drop policy if exists aslaid_read on storage.objects';
    execute 'drop policy if exists aslaid_insert on storage.objects';
    execute 'drop policy if exists aslaid_delete on storage.objects';
    execute $p$create policy aslaid_read on storage.objects for select to authenticated using (bucket_id = 'aslaid' and app.can_read_exec(app.drawing_path_project(name)))$p$;
    execute $p$create policy aslaid_insert on storage.objects for insert to authenticated with check (bucket_id = 'aslaid' and app.aslaid_can_record(app.drawing_path_project(name)))$p$;
    execute $p$create policy aslaid_delete on storage.objects for delete to authenticated using (bucket_id = 'aslaid' and app.aslaid_can_record(app.drawing_path_project(name)))$p$;
  end if;
end $$;

-- metres along a track [[lat, lng, ...], ...] (haversine)
create or replace function app.aslaid_len(p_track jsonb) returns numeric
language plpgsql immutable as $$
declare n int := jsonb_array_length(coalesce(p_track, '[]')); t numeric := 0; i int; la1 float8; lo1 float8; la2 float8; lo2 float8; a float8;
begin
  for i in 1 .. n - 1 loop
    la1 := radians((p_track -> (i - 1) ->> 0)::float8); lo1 := radians((p_track -> (i - 1) ->> 1)::float8);
    la2 := radians((p_track -> i ->> 0)::float8); lo2 := radians((p_track -> i ->> 1)::float8);
    a := sin((la2 - la1) / 2) ^ 2 + cos(la1) * cos(la2) * sin((lo2 - lo1) / 2) ^ 2;
    t := t + 2 * 6371008.8 * asin(least(1, sqrt(a)));
  end loop;
  return round(t, 1);
end $$;

-- a route: its ends, cable, schedule and the depth the specification asks for
create or replace function public.aslaid_route_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.exec_aslaid_routes; ex uuid; v_id uuid;
begin
  if p ? 'id' and nullif(p ->> 'id', '') is not null then
    select * into r from public.exec_aslaid_routes where id = (p ->> 'id')::uuid for update;
    perform app.require(r.id is not null, 'Route not found');
    ex := r.exec_project_id;
    perform app.require(app.aslaid_can_record(ex), 'Only the project team records cable routes');
    perform app.require(r.status <> 'approved', 'This route is approved – it can no longer be changed');
  else
    ex := (p ->> 'exec_project_id')::uuid;
    perform app.require(ex is not null and exists (select 1 from public.exec_projects where id = ex), 'Project not found');
    perform app.require(app.aslaid_can_record(ex), 'Only the project team records cable routes');
  end if;
  perform app.require(coalesce(btrim(coalesce(p ->> 'from_name', r.from_name)), '') <> '' and coalesce(btrim(coalesce(p ->> 'to_name', r.to_name)), '') <> '', 'Give where the cable starts and ends');
  if r.id is null then
    insert into public.exec_aslaid_routes (exec_project_id, code, from_name, to_name, cable, schedule_ref, schedule_m, req_depth_m)
    values (ex, nullif(btrim(p ->> 'code'), ''), btrim(p ->> 'from_name'), btrim(p ->> 'to_name'), nullif(btrim(p ->> 'cable'), ''), nullif(btrim(p ->> 'schedule_ref'), ''),
      nullif(p ->> 'schedule_m', '')::numeric, coalesce(nullif(p ->> 'req_depth_m', '')::numeric, 0.6))
    returning id into v_id;
    return v_id;
  end if;
  update public.exec_aslaid_routes set
    code = case when p ? 'code' then nullif(btrim(p ->> 'code'), '') else code end,
    from_name = coalesce(nullif(btrim(p ->> 'from_name'), ''), from_name),
    to_name = coalesce(nullif(btrim(p ->> 'to_name'), ''), to_name),
    cable = case when p ? 'cable' then nullif(btrim(p ->> 'cable'), '') else cable end,
    schedule_ref = case when p ? 'schedule_ref' then nullif(btrim(p ->> 'schedule_ref'), '') else schedule_ref end,
    schedule_m = case when p ? 'schedule_m' then nullif(p ->> 'schedule_m', '')::numeric else schedule_m end,
    req_depth_m = coalesce(nullif(p ->> 'req_depth_m', '')::numeric, req_depth_m),
    updated_at = now()
  where id = r.id;
  return r.id;
end $$;

create or replace function public.aslaid_route_delete(p_id uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare r public.exec_aslaid_routes; paths text[];
begin
  select * into r from public.exec_aslaid_routes where id = p_id;
  perform app.require(r.id is not null, 'Route not found');
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'Only the SEE or SM Projects removes a route');
  perform app.require(r.status <> 'approved', 'An approved route is kept as the record');
  select coalesce(array_agg(path), '{}') into paths from public.exec_aslaid_photos where route_id = p_id;
  delete from public.exec_aslaid_routes where id = p_id;
  return paths;
end $$;

-- start (or go on) walking the trench
create or replace function public.aslaid_start(p_route uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.exec_aslaid_routes;
begin
  select * into r from public.exec_aslaid_routes where id = p_route for update;
  perform app.require(r.id is not null, 'Route not found');
  perform app.require(app.aslaid_can_record(r.exec_project_id), 'Only the project team records cable routes');
  perform app.require(r.status in ('not_started', 'recording', 'queried'), 'This route is waiting for approval or approved');
  update public.exec_aslaid_routes set status = 'recording', started_at = coalesce(started_at, now()), recorded_by = coalesce(recorded_by, auth.uid()), updated_at = now() where id = p_route;
end $$;

-- GPS fixes walked along the trench: [[lat, lng, accuracy m, epoch ms], ...]
create or replace function public.aslaid_track_add(p_route uuid, p_pts jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare r public.exec_aslaid_routes; q jsonb; good jsonb := '[]'::jsonb; t jsonb;
begin
  select * into r from public.exec_aslaid_routes where id = p_route for update;
  perform app.require(r.id is not null, 'Route not found');
  perform app.require(app.aslaid_can_record(r.exec_project_id), 'Only the project team records cable routes');
  perform app.require(r.status in ('recording', 'queried'), 'Start recording the route first');
  perform app.require(jsonb_typeof(p_pts) = 'array' and jsonb_array_length(p_pts) <= 2000, 'Send the GPS fixes as a list (up to 2000 at a time)');
  for q in select * from jsonb_array_elements(p_pts) loop
    if jsonb_typeof(q) = 'array' and jsonb_array_length(q) >= 2 and (q ->> 0) ~ '^-?[0-9.]+$' and (q ->> 1) ~ '^-?[0-9.]+$'
       and abs((q ->> 0)::float8) <= 90 and abs((q ->> 1)::float8) <= 180 then
      good := good || jsonb_build_array(jsonb_build_array(round((q ->> 0)::numeric, 7), round((q ->> 1)::numeric, 7), coalesce(round(nullif(q ->> 2, '')::numeric, 1), 0), coalesce((q ->> 3)::bigint, (extract(epoch from now()) * 1000)::bigint)));
    end if;
  end loop;
  t := r.track || good;
  update public.exec_aslaid_routes set track = t, gps_m = app.aslaid_len(t), updated_at = now() where id = p_route;
  return app.aslaid_len(t);
end $$;

-- what was seen at a spot: a depth (before backfill), a joint, a crossing, a duct or sleeve, a marker post, another service
create or replace function public.aslaid_point_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.exec_aslaid_routes; v_id uuid; k text := p ->> 'kind'; prot text[];
begin
  select * into r from public.exec_aslaid_routes where id = (p ->> 'route_id')::uuid for update;
  perform app.require(r.id is not null, 'Route not found');
  perform app.require(app.aslaid_can_record(r.exec_project_id), 'Only the project team records cable routes');
  perform app.require(r.status in ('recording', 'queried'), 'Start recording the route first');
  perform app.require(k in ('depth', 'joint', 'crossing', 'duct', 'marker', 'service', 'other'), 'Unknown kind of point');
  perform app.require(nullif(p ->> 'lat', '') is not null and nullif(p ->> 'lng', '') is not null, 'No GPS position – wait for a fix');
  perform app.require(k <> 'depth' or nullif(p ->> 'depth_m', '') is not null, 'Measure the depth to the top of the cable');
  perform app.require(k not in ('service', 'other') or coalesce(btrim(p ->> 'note'), '') <> '', 'Say what it is');
  select coalesce(array_agg(x), '{}') into prot from jsonb_array_elements_text(coalesce(p -> 'protection', '[]')) x where x in ('sand', 'tiles', 'tape', 'duct', 'concrete', 'marker');
  insert into public.exec_aslaid_points (route_id, exec_project_id, kind, lat, lng, acc_m, chain_m, depth_m, protection, tie_feature, tie_m, note)
  values (r.id, r.exec_project_id, k, (p ->> 'lat')::float8, (p ->> 'lng')::float8, nullif(p ->> 'acc_m', '')::numeric, nullif(p ->> 'chain_m', '')::numeric,
    nullif(p ->> 'depth_m', '')::numeric, prot, nullif(btrim(p ->> 'tie_feature'), ''), nullif(p ->> 'tie_m', '')::numeric, nullif(btrim(p ->> 'note'), ''))
  returning id into v_id;
  update public.exec_aslaid_routes set updated_at = now() where id = r.id;
  return v_id;
end $$;

create or replace function public.aslaid_point_delete(p_id uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare pt public.exec_aslaid_points; st text; paths text[];
begin
  select * into pt from public.exec_aslaid_points where id = p_id;
  perform app.require(pt.id is not null, 'Point not found');
  select status into st from public.exec_aslaid_routes where id = pt.route_id;
  perform app.require(app.aslaid_can_record(pt.exec_project_id), 'Only the project team records cable routes');
  perform app.require(st in ('recording', 'queried'), 'The route is not open for changes');
  select coalesce(array_agg(path), '{}') into paths from public.exec_aslaid_photos where point_id = p_id;
  delete from public.exec_aslaid_points where id = p_id;
  return paths;
end $$;

create or replace function public.aslaid_photo_add(p_route uuid, p_point uuid, p_path text, p_note text default null, p_lat double precision default null, p_lng double precision default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.exec_aslaid_routes; v_id uuid;
begin
  select * into r from public.exec_aslaid_routes where id = p_route;
  perform app.require(r.id is not null, 'Route not found');
  perform app.require(app.aslaid_can_record(r.exec_project_id), 'Only the project team records cable routes');
  perform app.require(r.status in ('recording', 'queried'), 'Start recording the route first');
  perform app.require(p_path like r.exec_project_id || '/aslaid/%', 'The photo must be in this project''s as-laid folder');
  perform app.require(p_point is null or exists (select 1 from public.exec_aslaid_points where id = p_point and route_id = p_route), 'The point is on another route');
  insert into public.exec_aslaid_photos (route_id, point_id, exec_project_id, path, note, lat, lng)
  values (p_route, p_point, r.exec_project_id, p_path, nullif(btrim(p_note), ''), p_lat, p_lng) returning id into v_id;
  return v_id;
end $$;

create or replace function public.aslaid_photo_delete(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare ph public.exec_aslaid_photos; st text;
begin
  select * into ph from public.exec_aslaid_photos where id = p_id;
  perform app.require(ph.id is not null, 'Photo not found');
  select status into st from public.exec_aslaid_routes where id = ph.route_id;
  perform app.require(app.aslaid_can_record(ph.exec_project_id), 'Only the project team records cable routes');
  perform app.require(st in ('recording', 'queried'), 'The route is not open for changes');
  delete from public.exec_aslaid_photos where id = p_id;
  return ph.path;
end $$;

-- reached the far end: the drum cut and the tests on the cable, then it waits for the senior engineer
create or replace function public.aslaid_finish(p_route uuid, p_drum_m numeric default null, p_ir_mohm numeric default null, p_armour_ohm numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.exec_aslaid_routes;
begin
  select * into r from public.exec_aslaid_routes where id = p_route for update;
  perform app.require(r.id is not null, 'Route not found');
  perform app.require(app.aslaid_can_record(r.exec_project_id), 'Only the project team records cable routes');
  perform app.require(r.status in ('recording', 'queried'), 'Start recording the route first');
  perform app.require(jsonb_array_length(r.track) >= 2 or (select count(*) from public.exec_aslaid_points where route_id = p_route) >= 2, 'Walk the route first – at least two GPS positions');
  perform app.require(exists (select 1 from public.exec_aslaid_points where route_id = p_route and kind = 'depth'), 'Record at least one depth before backfill');
  perform app.require(exists (select 1 from public.exec_aslaid_photos where route_id = p_route), 'Add the photos taken before backfill');
  update public.exec_aslaid_routes set status = 'to_approve', finished_at = now(), query_note = null,
    drum_m = coalesce(p_drum_m, drum_m), ir_mohm = coalesce(p_ir_mohm, ir_mohm), armour_ohm = coalesce(p_armour_ohm, armour_ohm), updated_at = now()
  where id = p_route;
end $$;

-- the senior engineer approves (a shallow point needs a reason) or sends a query back
create or replace function public.aslaid_approve(p_route uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.exec_aslaid_routes; shallow int;
begin
  select * into r from public.exec_aslaid_routes where id = p_route for update;
  perform app.require(r.id is not null, 'Route not found');
  perform app.require(app.aslaid_can_approve(r.exec_project_id), 'Only the SEE, SM Projects or the DGM approves a cable route');
  perform app.require(r.status = 'to_approve', 'The route is not waiting for approval');
  perform app.require(r.ir_mohm is not null, 'Record the insulation resistance test on the cable first');
  select count(*) into shallow from public.exec_aslaid_points where route_id = p_route and kind = 'depth' and depth_m < r.req_depth_m;
  perform app.require(shallow = 0 or coalesce(btrim(p_note), '') <> '', format('%s depth point(s) shallower than the %s m required – give the reason to accept them (protection added, agreed with the engineer)', shallow, r.req_depth_m));
  update public.exec_aslaid_routes set status = 'approved', approved_by = auth.uid(), approved_at = now(), approve_note = nullif(btrim(p_note), ''), updated_at = now() where id = p_route;
end $$;

create or replace function public.aslaid_query(p_route uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.exec_aslaid_routes;
begin
  select * into r from public.exec_aslaid_routes where id = p_route for update;
  perform app.require(r.id is not null, 'Route not found');
  perform app.require(app.aslaid_can_approve(r.exec_project_id), 'Only the SEE, SM Projects or the DGM queries a cable route');
  perform app.require(r.status = 'to_approve', 'The route is not waiting for approval');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Say what needs fixing');
  update public.exec_aslaid_routes set status = 'queried', query_note = btrim(p_note), updated_at = now() where id = p_route;
end $$;

grant execute on function public.aslaid_route_save(jsonb), public.aslaid_route_delete(uuid), public.aslaid_start(uuid), public.aslaid_track_add(uuid, jsonb),
  public.aslaid_point_add(jsonb), public.aslaid_point_delete(uuid), public.aslaid_photo_add(uuid, uuid, text, text, double precision, double precision), public.aslaid_photo_delete(uuid),
  public.aslaid_finish(uuid, numeric, numeric, numeric), public.aslaid_approve(uuid, text), public.aslaid_query(uuid, text) to authenticated;
