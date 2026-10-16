-- Smart drawings (testing): the execution team uploads the project's drawings and marks on them every light, socket, data
-- point, DB, fan / HVAC connection, lighting-control and BMS device, and the containment and cable routes. Each item and
-- route moves through its installation stages, keeps its checks and readings, and can be tagged to a BOQ line and a
-- programme activity – so the drawing gives the BOQ quantities done and the activity % without anyone typing them twice.
--  * Read: anyone who reads the execution project. Upload, place, move and link: SEE, SM Projects and the project's AEs.
--    Stages, checks and cable metres: also the project's trainees and subcontractor supervisors.
--  * The drawing image (and the PDF it came from) is kept in the private "drawings" bucket under <project id>/.
--  * An item is "Tested" / "Commissioned" only when every check on it is ticked.
--  * The activity keeps its own % (the engineer's figure); the drawing figure is shown beside it (pct_drawing).

create table public.exec_drawings (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  sheet_no text,
  floor text,
  revision text,
  image_path text not null,
  pdf_path text,
  width int not null check (width > 0),
  height int not null check (height > 0),
  width_m numeric check (width_m is null or width_m > 0), -- real width of the sheet in metres (from the scale), for lengths
  scope jsonb not null default '{"services": true}',
  lms text not null default 'KNX',
  archived boolean not null default false,
  uploaded_by uuid references public.profiles (id) default auth.uid(),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.exec_drawings (exec_project_id);

create table public.exec_drawing_items (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.exec_drawings (id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  kind text not null,
  x numeric not null check (x between 0 and 1),
  y numeric not null check (y between 0 and 1),
  label text,
  area text,
  circuit text,
  serial text,
  note text,
  status text not null default 'planned' check (status in ('planned', 'first', 'second', 'wired', 'addr', 'prog', 'p2p', 'tested', 'done', 'failed')),
  checks jsonb not null default '{}',
  readings jsonb not null default '{}',
  boq_item_id uuid references public.exec_boq_items (id) on delete set null,
  activity_id uuid references public.exec_activities (id) on delete set null,
  created_by uuid references public.profiles (id) default auth.uid(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create index on public.exec_drawing_items (drawing_id);
create index on public.exec_drawing_items (exec_project_id);

create table public.exec_drawing_routes (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.exec_drawings (id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  kind text not null,
  pts jsonb not null check (jsonb_typeof(pts) = 'array' and jsonb_array_length(pts) >= 2),
  label text,
  status text not null default 'planned' check (status in ('planned', 'fixed', 'done', 'laid', 'term', 'tested', 'failed')),
  laid int not null default 0 check (laid between 0 and 100),
  area numeric check (area is null or area > 0), -- cable cross-section in mm² (for the containment fill)
  cores int check (cores is null or cores > 0),  -- number of cables in the run
  boq_item_id uuid references public.exec_boq_items (id) on delete set null,
  activity_id uuid references public.exec_activities (id) on delete set null,
  created_by uuid references public.profiles (id) default auth.uid(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create index on public.exec_drawing_routes (drawing_id);

create table public.exec_drawing_events (
  id bigint generated always as identity primary key,
  drawing_id uuid not null references public.exec_drawings (id) on delete cascade,
  exec_project_id uuid not null,
  item_id uuid,
  route_id uuid,
  what text not null,
  from_status text,
  to_status text,
  note text,
  by_id uuid references public.profiles (id) default auth.uid(),
  at timestamptz not null default now()
);
create index on public.exec_drawing_events (drawing_id, at desc);

alter table public.exec_activities add column if not exists pct_drawing numeric(5, 2);

-- who may do what
create or replace function app.drawing_can_edit(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer', 'sm_projects') or (app.has_role('assistant_engineer') and app.is_exec_member(p_exec))
$$;
create or replace function app.drawing_can_update(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.drawing_can_edit(p_exec) or (app.has_role('trainee', 'sub_supervisor') and app.is_exec_member(p_exec))
$$;

alter table public.exec_drawings enable row level security;
alter table public.exec_drawing_items enable row level security;
alter table public.exec_drawing_routes enable row level security;
alter table public.exec_drawing_events enable row level security;
create policy exec_drawings_read on public.exec_drawings for select to authenticated using (app.can_read_exec(exec_project_id));
create policy exec_drawing_items_read on public.exec_drawing_items for select to authenticated using (app.can_read_exec(exec_project_id));
create policy exec_drawing_routes_read on public.exec_drawing_routes for select to authenticated using (app.can_read_exec(exec_project_id));
create policy exec_drawing_events_read on public.exec_drawing_events for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.exec_drawings, public.exec_drawing_items, public.exec_drawing_routes, public.exec_drawing_events to authenticated;

-- Private bucket for the drawing images and PDFs: <project id>/<file>
create or replace function app.drawing_path_project(p_name text) returns uuid
language sql immutable as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end
$$;
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('drawings', 'drawings', false, 52428800, null)
    on conflict (id) do nothing;
    execute 'drop policy if exists drawings_read on storage.objects';
    execute 'drop policy if exists drawings_insert on storage.objects';
    execute 'drop policy if exists drawings_delete on storage.objects';
    execute $p$create policy drawings_read on storage.objects for select to authenticated using (bucket_id = 'drawings' and app.can_read_exec(app.drawing_path_project(name)))$p$;
    execute $p$create policy drawings_insert on storage.objects for insert to authenticated with check (bucket_id = 'drawings' and app.drawing_can_edit(app.drawing_path_project(name)))$p$;
    execute $p$create policy drawings_delete on storage.objects for delete to authenticated using (bucket_id = 'drawings' and app.drawing_can_edit(app.drawing_path_project(name)))$p$;
  end if;
end $$;

-- stage weights: how much of an item (or a BOQ quantity) a stage counts for
create or replace function app.drawing_weight(p_status text) returns numeric
language sql immutable as $$
  select case p_status when 'first' then 0.4 when 'wired' then 0.6 when 'second' then 0.75 when 'addr' then 0.75 when 'failed' then 0.75
    when 'prog' then 0.85 when 'p2p' then 0.85 when 'tested' then 0.9 when 'done' then 1 else 0 end
$$;
create or replace function app.drawing_route_weight(p_kind text, p_status text, p_laid int) returns numeric
language sql immutable as $$
  select case when p_kind in ('ladder', 'tray', 'trunk', 'cond', 'gi20', 'gi', 'gi32', 'pvc25', 'flex') then (case when p_status = 'planned' then 0 else 1 end)
              else p_laid / 100.0 end
$$;

-- the activity's figure from the drawings (shown beside the engineer's %)
create or replace function app.drawing_refresh_activity(p_activity uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if p_activity is null then return; end if;
  select round(100 * avg(w), 2) into v from (
    select app.drawing_weight(i.status) w from public.exec_drawing_items i join public.exec_drawings d on d.id = i.drawing_id and not d.archived where i.activity_id = p_activity
    union all
    select app.drawing_route_weight(r.kind, r.status, r.laid) from public.exec_drawing_routes r join public.exec_drawings d on d.id = r.drawing_id and not d.archived where r.activity_id = p_activity) x;
  update public.exec_activities set pct_drawing = v where id = p_activity;
end $$;

create or replace function app.drawing_check_links(p_exec uuid, p_boq uuid, p_activity uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(p_boq is null or exists (select 1 from public.exec_boq_items where id = p_boq and exec_project_id = p_exec and not heading),
    'Choose a BOQ line of this project');
  perform app.require(p_activity is null or exists (select 1 from public.exec_activities where id = p_activity and exec_project_id = p_exec),
    'Choose a programme activity of this project');
end $$;

-- drawings
create or replace function public.drawing_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.exec_drawings; ex uuid; did uuid;
begin
  if nullif(p ->> 'id', '') is not null then
    select * into d from public.exec_drawings where id = (p ->> 'id')::uuid for update;
    perform app.require(d.id is not null, 'Drawing not found');
    ex := d.exec_project_id;
  else
    ex := (p ->> 'exec_project_id')::uuid;
  end if;
  perform app.require(ex is not null and app.drawing_can_edit(ex), 'Only the execution team uploads and changes drawings');
  perform app.require(coalesce(btrim(p ->> 'title'), btrim(d.title), '') <> '', 'Give the drawing a title');
  perform app.require(p ->> 'image_path' is null or app.drawing_path_project(p ->> 'image_path') = ex, 'The drawing file belongs to another project');
  perform app.require(p ->> 'pdf_path' is null or app.drawing_path_project(p ->> 'pdf_path') = ex, 'The drawing file belongs to another project');
  perform app.require(p ->> 'width_m' is null or (p ->> 'width_m')::numeric > 0, 'The scale must be more than 0');
  if d.id is null then
    perform app.require(p ->> 'image_path' is not null and (p ->> 'width')::int > 0 and (p ->> 'height')::int > 0, 'Upload the drawing first');
    insert into public.exec_drawings (exec_project_id, title, sheet_no, floor, revision, image_path, pdf_path, width, height, width_m, scope, lms)
    values (ex, btrim(p ->> 'title'), nullif(btrim(p ->> 'sheet_no'), ''), nullif(btrim(p ->> 'floor'), ''), nullif(btrim(p ->> 'revision'), ''),
            p ->> 'image_path', p ->> 'pdf_path', (p ->> 'width')::int, (p ->> 'height')::int, nullif(p ->> 'width_m', '')::numeric,
            coalesce(p -> 'scope', '{"services": true}'), coalesce(nullif(p ->> 'lms', ''), 'KNX'))
    returning id into did;
    insert into public.exec_drawing_events (drawing_id, exec_project_id, what) values (did, ex, 'Drawing uploaded');
    return did;
  end if;
  update public.exec_drawings set
    title = coalesce(nullif(btrim(p ->> 'title'), ''), title),
    sheet_no = case when p ? 'sheet_no' then nullif(btrim(p ->> 'sheet_no'), '') else sheet_no end,
    floor = case when p ? 'floor' then nullif(btrim(p ->> 'floor'), '') else floor end,
    revision = case when p ? 'revision' then nullif(btrim(p ->> 'revision'), '') else revision end,
    image_path = coalesce(p ->> 'image_path', image_path), pdf_path = coalesce(p ->> 'pdf_path', pdf_path),
    width = coalesce((p ->> 'width')::int, width), height = coalesce((p ->> 'height')::int, height),
    width_m = case when p ? 'width_m' then nullif(p ->> 'width_m', '')::numeric else width_m end,
    scope = coalesce(p -> 'scope', scope), lms = coalesce(nullif(p ->> 'lms', ''), lms), updated_at = now()
  where id = d.id;
  if p ? 'image_path' and p ->> 'image_path' is distinct from d.image_path then
    insert into public.exec_drawing_events (drawing_id, exec_project_id, what, note) values (d.id, ex, 'New revision uploaded', nullif(btrim(p ->> 'revision'), ''));
  end if;
  return d.id;
end $$;

create or replace function public.drawing_archive(p_id uuid, p_archived boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare d public.exec_drawings; a uuid;
begin
  select * into d from public.exec_drawings where id = p_id for update;
  perform app.require(d.id is not null and app.drawing_can_edit(d.exec_project_id), 'Only the execution team archives drawings');
  update public.exec_drawings set archived = p_archived, updated_at = now() where id = p_id;
  for a in select distinct activity_id from public.exec_drawing_items where drawing_id = p_id and activity_id is not null
           union select distinct activity_id from public.exec_drawing_routes where drawing_id = p_id and activity_id is not null loop
    perform app.drawing_refresh_activity(a);
  end loop;
end $$;

-- items
create or replace function public.drawing_item_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.exec_drawings; it public.exec_drawing_items; iid uuid; boq uuid := nullif(p ->> 'boq_item_id', '')::uuid; act uuid := nullif(p ->> 'activity_id', '')::uuid;
begin
  if nullif(p ->> 'id', '') is not null then
    select * into it from public.exec_drawing_items where id = (p ->> 'id')::uuid for update;
    perform app.require(it.id is not null, 'Item not found');
    select * into d from public.exec_drawings where id = it.drawing_id;
  else
    select * into d from public.exec_drawings where id = (p ->> 'drawing_id')::uuid;
  end if;
  perform app.require(d.id is not null and not d.archived, 'Drawing not found');
  perform app.require(app.drawing_can_edit(d.exec_project_id), 'Only the execution team places and links items');
  if it.id is null then
    perform app.require(coalesce(p ->> 'kind', '') <> '', 'Choose what the item is');
    perform app.require(p -> 'checks' is null or jsonb_typeof(p -> 'checks') = 'object', 'Bad checks');
    perform app.drawing_check_links(d.exec_project_id, boq, act);
    insert into public.exec_drawing_items (drawing_id, exec_project_id, kind, x, y, label, area, circuit, serial, note, checks, boq_item_id, activity_id, updated_by)
    values (d.id, d.exec_project_id, p ->> 'kind', (p ->> 'x')::numeric, (p ->> 'y')::numeric, nullif(btrim(p ->> 'label'), ''), nullif(btrim(p ->> 'area'), ''),
            nullif(btrim(p ->> 'circuit'), ''), nullif(btrim(p ->> 'serial'), ''), nullif(btrim(p ->> 'note'), ''), coalesce(p -> 'checks', '{}'), boq, act, auth.uid())
    returning id into iid;
    insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what) values (d.id, d.exec_project_id, iid, 'Placed');
    perform app.drawing_refresh_activity(act);
    return iid;
  end if;
  if p ? 'boq_item_id' or p ? 'activity_id' then
    perform app.drawing_check_links(d.exec_project_id, case when p ? 'boq_item_id' then boq else it.boq_item_id end, case when p ? 'activity_id' then act else it.activity_id end);
  end if;
  update public.exec_drawing_items set
    kind = coalesce(nullif(p ->> 'kind', ''), kind), x = coalesce((p ->> 'x')::numeric, x), y = coalesce((p ->> 'y')::numeric, y),
    label = case when p ? 'label' then nullif(btrim(p ->> 'label'), '') else label end,
    area = case when p ? 'area' then nullif(btrim(p ->> 'area'), '') else area end,
    circuit = case when p ? 'circuit' then nullif(btrim(p ->> 'circuit'), '') else circuit end,
    serial = case when p ? 'serial' then nullif(btrim(p ->> 'serial'), '') else serial end,
    note = case when p ? 'note' then nullif(btrim(p ->> 'note'), '') else note end,
    boq_item_id = case when p ? 'boq_item_id' then boq else boq_item_id end,
    activity_id = case when p ? 'activity_id' then act else activity_id end,
    updated_by = auth.uid(), updated_at = now()
  where id = it.id;
  if p ? 'x' then insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what) values (d.id, d.exec_project_id, it.id, 'Moved'); end if;
  perform app.drawing_refresh_activity(it.activity_id);
  if p ? 'activity_id' then perform app.drawing_refresh_activity(act); end if;
  return it.id;
end $$;

create or replace function public.drawing_item_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare it public.exec_drawing_items;
begin
  select * into it from public.exec_drawing_items where id = p_id for update;
  perform app.require(it.id is not null, 'Item not found');
  perform app.require(app.drawing_can_update(it.exec_project_id), 'Only the project team updates the stages');
  perform app.require(p_status in ('planned', 'first', 'second', 'wired', 'addr', 'prog', 'p2p', 'tested', 'done', 'failed'), 'Unknown stage');
  perform app.require(p_status not in ('tested', 'done') or not exists (select 1 from jsonb_each(it.checks) c where c.value = 'false'::jsonb),
    'Tick every check on the item first');
  perform app.require(p_status <> 'failed' or coalesce(btrim(p_note), '') <> '', 'Say what failed');
  if it.status = p_status then return; end if;
  update public.exec_drawing_items set status = p_status, updated_by = auth.uid(), updated_at = now(),
    note = case when p_status = 'failed' then btrim(p_note) else note end where id = p_id;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, from_status, to_status, note)
  values (it.drawing_id, it.exec_project_id, p_id, 'Stage', it.status, p_status, nullif(btrim(p_note), ''));
  perform app.drawing_refresh_activity(it.activity_id);
end $$;

create or replace function public.drawing_item_checks(p_id uuid, p_checks jsonb, p_readings jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it public.exec_drawing_items;
begin
  select * into it from public.exec_drawing_items where id = p_id for update;
  perform app.require(it.id is not null, 'Item not found');
  perform app.require(app.drawing_can_update(it.exec_project_id), 'Only the project team records checks');
  perform app.require(jsonb_typeof(coalesce(p_checks, '{}')) = 'object' and jsonb_typeof(coalesce(p_readings, '{}')) = 'object', 'Bad checks');
  update public.exec_drawing_items set checks = coalesce(p_checks, checks), readings = coalesce(p_readings, readings), updated_by = auth.uid(), updated_at = now()
  where id = p_id;
  -- a cleared check takes an item back below Tested
  if it.status in ('tested', 'done') and exists (select 1 from jsonb_each(coalesce(p_checks, '{}')) c where c.value = 'false'::jsonb) then
    update public.exec_drawing_items set status = 'second' where id = p_id;
    insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, from_status, to_status, note)
    values (it.drawing_id, it.exec_project_id, p_id, 'Stage', it.status, 'second', 'A check was cleared');
    perform app.drawing_refresh_activity(it.activity_id);
  end if;
end $$;

create or replace function public.drawing_item_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it public.exec_drawing_items;
begin
  select * into it from public.exec_drawing_items where id = p_id for update;
  perform app.require(it.id is not null and app.drawing_can_edit(it.exec_project_id), 'Only the execution team removes items');
  delete from public.exec_drawing_items where id = p_id;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, what, note) values (it.drawing_id, it.exec_project_id, 'Removed', coalesce(it.label, it.kind));
  perform app.drawing_refresh_activity(it.activity_id);
end $$;

-- routes (containment and cables)
create or replace function public.drawing_route_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.exec_drawings; r public.exec_drawing_routes; rid uuid; boq uuid := nullif(p ->> 'boq_item_id', '')::uuid; act uuid := nullif(p ->> 'activity_id', '')::uuid;
begin
  if nullif(p ->> 'id', '') is not null then
    select * into r from public.exec_drawing_routes where id = (p ->> 'id')::uuid for update;
    perform app.require(r.id is not null, 'Route not found');
    select * into d from public.exec_drawings where id = r.drawing_id;
  else
    select * into d from public.exec_drawings where id = (p ->> 'drawing_id')::uuid;
  end if;
  perform app.require(d.id is not null and not d.archived, 'Drawing not found');
  perform app.require(app.drawing_can_edit(d.exec_project_id), 'Only the execution team draws and links routes');
  perform app.require(p -> 'pts' is null or (jsonb_typeof(p -> 'pts') = 'array' and jsonb_array_length(p -> 'pts') >= 2), 'A route needs at least two points');
  if r.id is null then
    perform app.require(coalesce(p ->> 'kind', '') <> '', 'Choose what the route is');
    perform app.drawing_check_links(d.exec_project_id, boq, act);
    insert into public.exec_drawing_routes (drawing_id, exec_project_id, kind, pts, label, area, cores, boq_item_id, activity_id, updated_by)
    values (d.id, d.exec_project_id, p ->> 'kind', p -> 'pts', nullif(btrim(p ->> 'label'), ''), nullif(p ->> 'area', '')::numeric, nullif(p ->> 'cores', '')::int, boq, act, auth.uid())
    returning id into rid;
    insert into public.exec_drawing_events (drawing_id, exec_project_id, route_id, what) values (d.id, d.exec_project_id, rid, 'Route drawn');
    perform app.drawing_refresh_activity(act);
    return rid;
  end if;
  if p ? 'boq_item_id' or p ? 'activity_id' then
    perform app.drawing_check_links(d.exec_project_id, case when p ? 'boq_item_id' then boq else r.boq_item_id end, case when p ? 'activity_id' then act else r.activity_id end);
  end if;
  update public.exec_drawing_routes set
    kind = coalesce(nullif(p ->> 'kind', ''), kind), pts = coalesce(p -> 'pts', pts),
    label = case when p ? 'label' then nullif(btrim(p ->> 'label'), '') else label end,
    area = case when p ? 'area' then nullif(p ->> 'area', '')::numeric else area end,
    cores = case when p ? 'cores' then nullif(p ->> 'cores', '')::int else cores end,
    boq_item_id = case when p ? 'boq_item_id' then boq else boq_item_id end,
    activity_id = case when p ? 'activity_id' then act else activity_id end,
    updated_by = auth.uid(), updated_at = now()
  where id = r.id;
  perform app.drawing_refresh_activity(r.activity_id);
  if p ? 'activity_id' then perform app.drawing_refresh_activity(act); end if;
  return r.id;
end $$;

create or replace function public.drawing_route_progress(p_id uuid, p_status text, p_laid int default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.exec_drawing_routes; cont boolean;
begin
  select * into r from public.exec_drawing_routes where id = p_id for update;
  perform app.require(r.id is not null, 'Route not found');
  perform app.require(app.drawing_can_update(r.exec_project_id), 'Only the project team updates routes');
  cont := r.kind in ('ladder', 'tray', 'trunk', 'cond', 'gi20', 'gi', 'gi32', 'pvc25', 'flex');
  perform app.require(case when cont then p_status in ('planned', 'fixed', 'done') else p_status in ('planned', 'laid', 'term', 'tested', 'failed') end, 'Unknown stage for this route');
  perform app.require(p_laid is null or p_laid between 0 and 100, 'Metres laid is a % from 0 to 100');
  perform app.require(p_status <> 'failed' or coalesce(btrim(p_note), '') <> '', 'Say what failed');
  update public.exec_drawing_routes set status = p_status,
    laid = case when cont then 0 when p_status in ('term', 'tested') then 100 else coalesce(p_laid, laid) end,
    updated_by = auth.uid(), updated_at = now() where id = p_id;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, route_id, what, from_status, to_status, note)
  values (r.drawing_id, r.exec_project_id, p_id, 'Route', r.status, p_status, coalesce(nullif(btrim(p_note), ''), case when p_laid is not null and not cont then p_laid || '% laid' end));
  perform app.drawing_refresh_activity(r.activity_id);
end $$;

create or replace function public.drawing_route_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.exec_drawing_routes;
begin
  select * into r from public.exec_drawing_routes where id = p_id for update;
  perform app.require(r.id is not null and app.drawing_can_edit(r.exec_project_id), 'Only the execution team removes routes');
  delete from public.exec_drawing_routes where id = p_id;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, what, note) values (r.drawing_id, r.exec_project_id, 'Route removed', coalesce(r.label, r.kind));
  perform app.drawing_refresh_activity(r.activity_id);
end $$;

-- what the drawings give the BOQ (quantity on the drawings, quantity done) – lengths need the drawing scale
create or replace function public.drawing_boq(p_exec uuid) returns table (boq_item_id uuid, qty numeric, done numeric, items int)
language sql stable security definer set search_path = public as $$
  with lens as (
    select r.*, d.width_m * (select sum(sqrt(power((b ->> 0)::numeric - (a ->> 0)::numeric, 2) + power(((b ->> 1)::numeric - (a ->> 1)::numeric) * d.height / d.width, 2)))
                               from jsonb_array_elements(r.pts) with ordinality s1 (a, i) join jsonb_array_elements(r.pts) with ordinality s2 (b, j) on j = i + 1) as m
      from public.exec_drawing_routes r join public.exec_drawings d on d.id = r.drawing_id and not d.archived
     where r.exec_project_id = p_exec and r.boq_item_id is not null)
  select x.boq_item_id, sum(x.q), sum(x.dn), count(*)::int from (
    select i.boq_item_id, 1::numeric q, app.drawing_weight(i.status) dn
      from public.exec_drawing_items i join public.exec_drawings d on d.id = i.drawing_id and not d.archived
     where i.exec_project_id = p_exec and i.boq_item_id is not null
    union all
    select l.boq_item_id, coalesce(l.m, 0) * coalesce(l.cores, 1), coalesce(l.m, 0) * coalesce(l.cores, 1) * app.drawing_route_weight(l.kind, l.status, l.laid) from lens l) x
  where app.can_read_exec(p_exec)
  group by x.boq_item_id
$$;

revoke execute on function public.drawing_save(jsonb), public.drawing_archive(uuid, boolean), public.drawing_item_save(jsonb), public.drawing_item_status(uuid, text, text),
  public.drawing_item_checks(uuid, jsonb, jsonb), public.drawing_item_delete(uuid), public.drawing_route_save(jsonb), public.drawing_route_progress(uuid, text, int, text),
  public.drawing_route_delete(uuid), public.drawing_boq(uuid) from public, anon;
grant execute on function public.drawing_save(jsonb), public.drawing_archive(uuid, boolean), public.drawing_item_save(jsonb), public.drawing_item_status(uuid, text, text),
  public.drawing_item_checks(uuid, jsonb, jsonb), public.drawing_item_delete(uuid), public.drawing_route_save(jsonb), public.drawing_route_progress(uuid, text, int, text),
  public.drawing_route_delete(uuid), public.drawing_boq(uuid) to authenticated;
