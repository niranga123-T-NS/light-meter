-- Smart drawings (testing), round A – faster on site:
--  * Photos on items and routes, kept with the stage they were taken at (evidence for billing and handover). The project
--    team that updates stages (incl. trainees and subcontractor supervisors) may add photos under <project>/photos/.
--  * Many items placed at once (a row, a grid, copies) and one stage set on many items at once. Items whose checks are not
--    all ticked are skipped for Tested / Commissioned and reported back.

create table public.exec_drawing_photos (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.exec_drawings (id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  item_id uuid references public.exec_drawing_items (id) on delete cascade,
  route_id uuid references public.exec_drawing_routes (id) on delete cascade,
  stage text,
  path text not null,
  note text,
  taken_by uuid references public.profiles (id) default auth.uid(),
  taken_at timestamptz not null default now(),
  check ((item_id is null) <> (route_id is null))
);
create index on public.exec_drawing_photos (item_id);
create index on public.exec_drawing_photos (route_id);
alter table public.exec_drawing_photos enable row level security;
create policy exec_drawing_photos_read on public.exec_drawing_photos for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.exec_drawing_photos to authenticated;

-- photos may be uploaded by everyone who updates stages; drawings themselves only by the execution team
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute 'drop policy if exists drawings_insert on storage.objects';
    execute $p$create policy drawings_insert on storage.objects for insert to authenticated with check (bucket_id = 'drawings'
      and (app.drawing_can_edit(app.drawing_path_project(name)) or (split_part(name, '/', 2) = 'photos' and app.drawing_can_update(app.drawing_path_project(name)))))$p$;
  end if;
end $$;

create or replace function public.drawing_photo_add(p_item uuid, p_route uuid, p_path text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare it public.exec_drawing_items; r public.exec_drawing_routes; ex uuid; dw uuid; st text; pid uuid;
begin
  perform app.require((p_item is null) <> (p_route is null), 'A photo belongs to one item or one route');
  if p_item is not null then
    select * into it from public.exec_drawing_items where id = p_item;
    ex := it.exec_project_id; dw := it.drawing_id; st := it.status;
  else
    select * into r from public.exec_drawing_routes where id = p_route;
    ex := r.exec_project_id; dw := r.drawing_id; st := r.status;
  end if;
  perform app.require(ex is not null, 'Not found');
  perform app.require(app.drawing_can_update(ex), 'Only the project team adds photos');
  perform app.require(app.drawing_path_project(p_path) = ex and split_part(p_path, '/', 2) = 'photos', 'The photo belongs to another project');
  insert into public.exec_drawing_photos (drawing_id, exec_project_id, item_id, route_id, stage, path, note)
  values (dw, ex, p_item, p_route, st, p_path, nullif(btrim(p_note), '')) returning id into pid;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, route_id, what, to_status, note)
  values (dw, ex, p_item, p_route, 'Photo', st, nullif(btrim(p_note), ''));
  return pid;
end $$;

create or replace function public.drawing_photo_delete(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare ph public.exec_drawing_photos;
begin
  select * into ph from public.exec_drawing_photos where id = p_id;
  perform app.require(ph.id is not null, 'Not found');
  perform app.require(ph.taken_by = auth.uid() or app.drawing_can_edit(ph.exec_project_id), 'Only the person who took it or the execution team removes a photo');
  delete from public.exec_drawing_photos where id = p_id;
  return ph.path;
end $$;

-- many items at once: [{kind, x, y, label, area, circuit, checks, boq_item_id, activity_id}]
create or replace function public.drawing_items_add(p_drawing uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare d public.exec_drawings; x jsonb; n int := 0; acts uuid[] := '{}'; a uuid;
begin
  select * into d from public.exec_drawings where id = p_drawing;
  perform app.require(d.id is not null and not d.archived, 'Drawing not found');
  perform app.require(app.drawing_can_edit(d.exec_project_id), 'Only the execution team places items');
  perform app.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 400, 'Place 1 to 400 items at a time');
  for x in select * from jsonb_array_elements(p_items) loop
    perform app.require(coalesce(x ->> 'kind', '') <> '' and (x ->> 'x')::numeric between 0 and 1 and (x ->> 'y')::numeric between 0 and 1, 'Every item needs a type and a place on the sheet');
    perform app.require(x -> 'checks' is null or jsonb_typeof(x -> 'checks') = 'object', 'Bad checks');
    perform app.drawing_check_links(d.exec_project_id, nullif(x ->> 'boq_item_id', '')::uuid, nullif(x ->> 'activity_id', '')::uuid);
    insert into public.exec_drawing_items (drawing_id, exec_project_id, kind, x, y, label, area, circuit, checks, boq_item_id, activity_id, updated_by)
    values (d.id, d.exec_project_id, x ->> 'kind', (x ->> 'x')::numeric, (x ->> 'y')::numeric, nullif(btrim(x ->> 'label'), ''), nullif(btrim(x ->> 'area'), ''),
            nullif(btrim(x ->> 'circuit'), ''), coalesce(x -> 'checks', '{}'), nullif(x ->> 'boq_item_id', '')::uuid, nullif(x ->> 'activity_id', '')::uuid, auth.uid());
    n := n + 1;
    if nullif(x ->> 'activity_id', '') is not null then acts := acts || (x ->> 'activity_id')::uuid; end if;
  end loop;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, what, note) values (d.id, d.exec_project_id, 'Placed', n || ' items');
  foreach a in array (select array(select distinct unnest(acts))) loop perform app.drawing_refresh_activity(a); end loop;
  return n;
end $$;

-- one stage on many items; returns {updated, skipped}
create or replace function public.drawing_items_status(p_ids uuid[], p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it public.exec_drawing_items; up int := 0; sk int := 0; acts uuid[] := '{}'; a uuid;
begin
  perform app.require(p_status in ('planned', 'first', 'second', 'wired', 'addr', 'prog', 'p2p', 'tested', 'done', 'failed'), 'Unknown stage');
  perform app.require(p_status <> 'failed' or coalesce(btrim(p_note), '') <> '', 'Say what failed');
  perform app.require(coalesce(cardinality(p_ids), 0) between 1 and 400, 'Choose 1 to 400 items');
  for it in select * from public.exec_drawing_items where id = any (p_ids) for update loop
    perform app.require(app.drawing_can_update(it.exec_project_id), 'Only the project team updates the stages');
    if it.status = p_status then continue; end if;
    if p_status in ('tested', 'done') and exists (select 1 from jsonb_each(it.checks) c where c.value = 'false'::jsonb) then sk := sk + 1; continue; end if;
    update public.exec_drawing_items set status = p_status, updated_by = auth.uid(), updated_at = now(),
      note = case when p_status = 'failed' then btrim(p_note) else note end where id = it.id;
    insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, from_status, to_status, note)
    values (it.drawing_id, it.exec_project_id, it.id, 'Stage', it.status, p_status, nullif(btrim(p_note), ''));
    up := up + 1;
    if it.activity_id is not null then acts := acts || it.activity_id; end if;
  end loop;
  foreach a in array (select array(select distinct unnest(acts))) loop perform app.drawing_refresh_activity(a); end loop;
  return jsonb_build_object('updated', up, 'skipped', sk);
end $$;

revoke execute on function public.drawing_photo_add(uuid, uuid, text, text), public.drawing_photo_delete(uuid), public.drawing_items_add(uuid, jsonb), public.drawing_items_status(uuid[], text, text) from public, anon;
grant execute on function public.drawing_photo_add(uuid, uuid, text, text), public.drawing_photo_delete(uuid), public.drawing_items_add(uuid, jsonb), public.drawing_items_status(uuid[], text, text) to authenticated;
