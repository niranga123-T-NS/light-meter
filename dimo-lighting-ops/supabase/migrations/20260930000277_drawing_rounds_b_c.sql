-- Smart drawings (testing), rounds B and C:
--  * Removing a drawing: SEE / SM Projects any drawing with a reason; a project AE only a drawing with no work recorded on it.
--    A short record of what was removed is kept. The app removes the files.
--  * Issue pins on the sheet: a design query, a snag or an HSE report is raised through its own module and pinned where it is;
--    a clash or a note stays a pin and is closed on the drawing.
--  * DB components (ACB, MCCB, MCB, RCBO, meter, CT, VT, relay, SPD …) with their own checks, and the DB's circuit schedule with
--    its test readings. A DB is Tested / Commissioned only when every component and every circuit on it is tested.
--  * Floors: a floor order on each drawing; a typical floor copied onto other floors with every copy flagged "to check".
--  * Risers: one riser through several floors, with its vertical cable and containment runs (lengths from the floor height).
--  * Lighting-control scenes and BMS cause & effect tests with the result, the witness and who tested.
--  * Poles and masts (outdoor scope): checks and readings live with the item (chainage, cube test, earth, aiming).

alter table public.exec_drawings add column if not exists level_no numeric;
alter table public.exec_drawing_items add column if not exists to_check boolean not null default false;
alter table public.exec_drawing_routes add column if not exists to_check boolean not null default false;

-- ---------- removing a drawing
create table public.exec_drawing_deletions (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  title text not null,
  sheet_no text,
  floor text,
  revision text,
  items int not null,
  routes int not null,
  reason text,
  deleted_by uuid references public.profiles (id) default auth.uid(),
  deleted_at timestamptz not null default now()
);
alter table public.exec_drawing_deletions enable row level security;
create policy exec_drawing_deletions_read on public.exec_drawing_deletions for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.exec_drawing_deletions to authenticated;

-- the person who took a site photo may remove its file too
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute 'drop policy if exists drawings_delete on storage.objects';
    execute $p$create policy drawings_delete on storage.objects for delete to authenticated using (bucket_id = 'drawings'
      and (app.drawing_can_edit(app.drawing_path_project(name)) or (split_part(name, '/', 2) = 'photos' and owner = auth.uid())))$p$;
  end if;
end $$;

create or replace function public.drawing_delete(p_id uuid, p_reason text default null) returns text[]
language plpgsql security definer set search_path = public as $$
declare d public.exec_drawings; worked boolean; paths text[]; acts uuid[]; a uuid; ni int; nr int;
begin
  select * into d from public.exec_drawings where id = p_id for update;
  perform app.require(d.id is not null, 'Drawing not found');
  perform app.require(app.drawing_can_edit(d.exec_project_id), 'Only the execution team removes drawings');
  worked := exists (select 1 from public.exec_drawing_items where drawing_id = p_id and status <> 'planned')
         or exists (select 1 from public.exec_drawing_routes where drawing_id = p_id and status <> 'planned')
         or exists (select 1 from public.exec_drawing_photos where drawing_id = p_id);
  if worked then
    perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'),
      'Work is already recorded on this drawing – the Senior Electrical Engineer or SM Projects removes it (or archive it instead)');
  end if;
  perform app.require(not worked or coalesce(btrim(p_reason), '') <> '', 'Say why the drawing is removed');
  select count(*) into ni from public.exec_drawing_items where drawing_id = p_id;
  select count(*) into nr from public.exec_drawing_routes where drawing_id = p_id;
  select array_agg(distinct x) into acts from (
    select activity_id x from public.exec_drawing_items where drawing_id = p_id and activity_id is not null
    union select activity_id from public.exec_drawing_routes where drawing_id = p_id and activity_id is not null) s;
  select array_remove(array[d.image_path, d.pdf_path], null) || coalesce(array_agg(path), '{}') into paths from public.exec_drawing_photos where drawing_id = p_id;
  insert into public.exec_drawing_deletions (exec_project_id, title, sheet_no, floor, revision, items, routes, reason)
  values (d.exec_project_id, d.title, d.sheet_no, d.floor, d.revision, ni, nr, nullif(btrim(p_reason), ''));
  delete from public.exec_drawings where id = p_id;
  foreach a in array coalesce(acts, '{}') loop perform app.drawing_refresh_activity(a); end loop;
  -- the image is kept while another drawing still uses it (a revision that was not re-uploaded)
  return array(select p from unnest(paths) p where not exists (select 1 from public.exec_drawings x where x.image_path = p or x.pdf_path = p));
end $$;

-- ---------- issue pins
create table public.exec_drawing_pins (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.exec_drawings (id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  item_id uuid references public.exec_drawing_items (id) on delete set null,
  x numeric not null check (x between 0 and 1),
  y numeric not null check (y between 0 and 1),
  kind text not null check (kind in ('query', 'snag', 'hse', 'clash', 'note')),
  title text not null check (btrim(title) <> ''),
  ref_type text check (ref_type in ('design_query', 'snag', 'hse_report')),
  ref_id uuid,
  status text not null default 'open' check (status in ('open', 'closed')),
  raised_by uuid references public.profiles (id) default auth.uid(),
  raised_at timestamptz not null default now(),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  close_note text
);
create index on public.exec_drawing_pins (drawing_id);
alter table public.exec_drawing_pins enable row level security;
create policy exec_drawing_pins_read on public.exec_drawing_pins for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.exec_drawing_pins to authenticated;

-- p: {drawing_id, x, y, kind, title, item_id?, detail?, blocks?, location?, responsible?, priority?, due_date?, hse_kind?, severity?, immediate_action?}
create or replace function public.drawing_pin_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.exec_drawings; k text := p ->> 'kind'; t text := btrim(coalesce(p ->> 'title', '')); ref uuid; rt text; pid uuid;
  loc text; it public.exec_drawing_items;
begin
  select * into d from public.exec_drawings where id = (p ->> 'drawing_id')::uuid;
  perform app.require(d.id is not null and not d.archived, 'Drawing not found');
  perform app.require(app.drawing_can_update(d.exec_project_id), 'Only the project team pins issues');
  perform app.require(k in ('query', 'snag', 'hse', 'clash', 'note'), 'Choose what the pin is');
  perform app.require(t <> '', 'Write what the issue is');
  perform app.require((p ->> 'x')::numeric between 0 and 1 and (p ->> 'y')::numeric between 0 and 1, 'Place the pin on the sheet');
  if nullif(p ->> 'item_id', '') is not null then
    select * into it from public.exec_drawing_items where id = (p ->> 'item_id')::uuid and drawing_id = d.id;
    perform app.require(it.id is not null, 'The item is on another drawing');
  end if;
  loc := coalesce(nullif(btrim(p ->> 'location'), ''), concat_ws(' · ', coalesce(d.sheet_no, d.title) || coalesce(' rev ' || d.revision, ''), d.floor, it.area, it.label));
  if k = 'query' then
    ref := public.raise_design_query(d.exec_project_id, t || coalesce(E'\n' || nullif(btrim(p ->> 'detail'), ''), ''),
      concat_ws(' · ', coalesce(d.sheet_no, d.title) || coalesce(' rev ' || d.revision, ''), it.label), p ->> 'blocks');
    rt := 'design_query';
  elsif k = 'snag' then
    ref := public.raise_snag(d.exec_project_id, jsonb_build_object('location', loc, 'description', t || coalesce(' – ' || nullif(btrim(p ->> 'detail'), ''), ''),
      'responsible', p ->> 'responsible', 'priority', p ->> 'priority', 'due_date', p ->> 'due_date'));
    rt := 'snag';
  elsif k = 'hse' then
    ref := public.report_hse(d.exec_project_id, jsonb_build_object('kind', coalesce(nullif(p ->> 'hse_kind', ''), 'unsafe_condition'), 'severity', coalesce(nullif(p ->> 'severity', ''), 'medium'),
      'location', loc, 'description', t || coalesce(' – ' || nullif(btrim(p ->> 'detail'), ''), ''), 'immediate_action', p ->> 'immediate_action'));
    rt := 'hse_report';
  end if;
  insert into public.exec_drawing_pins (drawing_id, exec_project_id, item_id, x, y, kind, title, ref_type, ref_id)
  values (d.id, d.exec_project_id, it.id, (p ->> 'x')::numeric, (p ->> 'y')::numeric, k, t, rt, ref) returning id into pid;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, note) values (d.id, d.exec_project_id, it.id, 'Issue pinned', t);
  return pid;
end $$;

-- pins with the live state of the record behind them
create or replace function public.drawing_pins(p_drawing uuid) returns table (id uuid, item_id uuid, x numeric, y numeric, kind text, title text, ref_type text, ref_id uuid,
  ref_code text, state text, open boolean, raised_by uuid, raised_at timestamptz, closed_at timestamptz, close_note text)
language sql stable security definer set search_path = public as $$
  select p.id, p.item_id, p.x, p.y, p.kind, p.title, p.ref_type, p.ref_id,
         coalesce(q.code, h.code),
         coalesce(q.status, s.status, h.status, p.status),
         case when p.ref_type = 'design_query' then q.status in ('raised', 'forwarded') when p.ref_type = 'snag' then s.status = 'open'
              when p.ref_type = 'hse_report' then h.status = 'open' else p.status = 'open' end,
         p.raised_by, p.raised_at, coalesce(s.closed_at, h.closed_at, q.answered_at, p.closed_at), coalesce(q.answer, h.close_note, p.close_note)
    from public.exec_drawing_pins p
    left join public.design_queries q on p.ref_type = 'design_query' and q.id = p.ref_id
    left join public.snags s on p.ref_type = 'snag' and s.id = p.ref_id
    left join public.hse_reports h on p.ref_type = 'hse_report' and h.id = p.ref_id
   where p.drawing_id = p_drawing and app.can_read_exec(p.exec_project_id)
   order by p.raised_at desc
$$;

create or replace function public.drawing_pin_close(p_id uuid, p_note text, p_open boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare pn public.exec_drawing_pins;
begin
  select * into pn from public.exec_drawing_pins where id = p_id for update;
  perform app.require(pn.id is not null, 'Not found');
  perform app.require(pn.ref_type is null, 'Close it in its own record (design query, snag or HSE report)');
  perform app.require(app.drawing_can_update(pn.exec_project_id), 'Only the project team closes pins');
  perform app.require(p_open or coalesce(btrim(p_note), '') <> '', 'Say how it was resolved');
  update public.exec_drawing_pins set status = case when p_open then 'open' else 'closed' end, closed_by = case when p_open then null else auth.uid() end,
    closed_at = case when p_open then null else now() end, close_note = case when p_open then null else btrim(p_note) end where id = p_id;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, note)
  values (pn.drawing_id, pn.exec_project_id, pn.item_id, case when p_open then 'Issue reopened' else 'Issue closed' end, coalesce(nullif(btrim(p_note), ''), pn.title));
end $$;

create or replace function public.drawing_pin_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pn public.exec_drawing_pins;
begin
  select * into pn from public.exec_drawing_pins where id = p_id;
  perform app.require(pn.id is not null, 'Not found');
  perform app.require(pn.raised_by = auth.uid() or app.drawing_can_edit(pn.exec_project_id), 'Only the person who pinned it or the execution team removes a pin');
  delete from public.exec_drawing_pins where id = p_id; -- the design query / snag / HSE report itself stays
end $$;

-- ---------- DB components and circuit schedule
create table public.exec_drawing_db_parts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.exec_drawing_items (id) on delete cascade,
  drawing_id uuid not null references public.exec_drawings (id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  seq int not null default 0,
  ptype text not null check (ptype in ('acb', 'mccb', 'mcb', 'rcbo', 'rccb', 'isol', 'fuse', 'meter', 'ct', 'vt', 'relay', 'spd', 'cont', 'timer', 'ctrl', 'apfc', 'busbar', 'encl', 'other')),
  ref text,
  rating text,
  poles text,
  make text,
  qty int not null default 1 check (qty > 0),
  status text not null default 'planned' check (status in ('planned', 'fitted', 'tested', 'failed')),
  checks jsonb not null default '{}' check (jsonb_typeof(checks) = 'object'),
  readings jsonb not null default '{}' check (jsonb_typeof(readings) = 'object'),
  note text,
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now()
);
create index on public.exec_drawing_db_parts (item_id);

create table public.exec_drawing_circuits (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.exec_drawing_items (id) on delete cascade,
  drawing_id uuid not null references public.exec_drawings (id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  seq int not null default 0,
  ref text not null check (btrim(ref) <> ''),
  description text,
  phase text,
  device text,
  cable text,
  zs_max numeric check (zs_max is null or zs_max > 0),
  status text not null default 'planned' check (status in ('planned', 'tested', 'failed')),
  readings jsonb not null default '{}' check (jsonb_typeof(readings) = 'object'),
  note text,
  tested_by uuid references public.profiles (id),
  tested_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (item_id, ref)
);
create index on public.exec_drawing_circuits (item_id);
alter table public.exec_drawing_db_parts enable row level security;
alter table public.exec_drawing_circuits enable row level security;
create policy exec_drawing_db_parts_read on public.exec_drawing_db_parts for select to authenticated using (app.can_read_exec(exec_project_id));
create policy exec_drawing_circuits_read on public.exec_drawing_circuits for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.exec_drawing_db_parts, public.exec_drawing_circuits to authenticated;

-- what still stands between a DB and Tested
create or replace function app.drawing_db_blockers(p_item uuid) returns text
language sql stable security definer set search_path = public as $$
  select nullif(concat_ws(' and ',
    case when n1 > 0 then n1 || ' component(s)' end,
    case when n2 > 0 then n2 || ' circuit(s)' end), '')
  from (select (select count(*) from public.exec_drawing_db_parts where item_id = p_item and status <> 'tested') n1,
               (select count(*) from public.exec_drawing_circuits where item_id = p_item and status <> 'tested') n2) x
$$;

create or replace function app.drawing_db_item(p_item uuid) returns public.exec_drawing_items
language plpgsql stable security definer set search_path = public as $$
declare it public.exec_drawing_items;
begin
  select * into it from public.exec_drawing_items where id = p_item;
  perform app.require(it.id is not null and it.kind = 'db', 'Choose a distribution board');
  return it;
end $$;

-- p: {id? | item_id, ptype, ref, rating, poles, make, qty, note, seq}
create or replace function public.drawing_db_part_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare it public.exec_drawing_items; pt public.exec_drawing_db_parts; pid uuid;
begin
  if nullif(p ->> 'id', '') is not null then
    select * into pt from public.exec_drawing_db_parts where id = (p ->> 'id')::uuid for update;
    perform app.require(pt.id is not null, 'Not found');
    it := app.drawing_db_item(pt.item_id);
  else
    it := app.drawing_db_item((p ->> 'item_id')::uuid);
  end if;
  perform app.require(app.drawing_can_edit(it.exec_project_id), 'Only the execution team sets up the DB schedule');
  perform app.require(coalesce(p ->> 'qty', '1') ~ '^[0-9]+$' and coalesce(nullif(p ->> 'qty', '')::int, 1) > 0, 'Quantity must be 1 or more');
  if pt.id is null then
    insert into public.exec_drawing_db_parts (item_id, drawing_id, exec_project_id, seq, ptype, ref, rating, poles, make, qty, note)
    values (it.id, it.drawing_id, it.exec_project_id, coalesce(nullif(p ->> 'seq', '')::int, (select coalesce(max(seq), 0) + 1 from public.exec_drawing_db_parts where item_id = it.id)),
            p ->> 'ptype', nullif(btrim(p ->> 'ref'), ''), nullif(btrim(p ->> 'rating'), ''), nullif(btrim(p ->> 'poles'), ''), nullif(btrim(p ->> 'make'), ''),
            coalesce(nullif(p ->> 'qty', '')::int, 1), nullif(btrim(p ->> 'note'), ''))
    returning id into pid;
    return pid;
  end if;
  update public.exec_drawing_db_parts set ptype = coalesce(nullif(p ->> 'ptype', ''), ptype),
    ref = case when p ? 'ref' then nullif(btrim(p ->> 'ref'), '') else ref end, rating = case when p ? 'rating' then nullif(btrim(p ->> 'rating'), '') else rating end,
    poles = case when p ? 'poles' then nullif(btrim(p ->> 'poles'), '') else poles end, make = case when p ? 'make' then nullif(btrim(p ->> 'make'), '') else make end,
    qty = coalesce(nullif(p ->> 'qty', '')::int, qty), note = case when p ? 'note' then nullif(btrim(p ->> 'note'), '') else note end,
    seq = coalesce(nullif(p ->> 'seq', '')::int, seq), updated_by = auth.uid(), updated_at = now()
  where id = pt.id;
  return pt.id;
end $$;

create or replace function public.drawing_db_part_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pt public.exec_drawing_db_parts;
begin
  select * into pt from public.exec_drawing_db_parts where id = p_id;
  perform app.require(pt.id is not null and app.drawing_can_edit(pt.exec_project_id), 'Only the execution team changes the DB schedule');
  delete from public.exec_drawing_db_parts where id = p_id;
end $$;

-- stage of a component, with its checks and readings (Tested needs every check ticked; Failed needs a note)
create or replace function public.drawing_db_part_status(p_id uuid, p_status text, p_checks jsonb default null, p_readings jsonb default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pt public.exec_drawing_db_parts; ck jsonb;
begin
  select * into pt from public.exec_drawing_db_parts where id = p_id for update;
  perform app.require(pt.id is not null, 'Not found');
  perform app.require(app.drawing_can_update(pt.exec_project_id), 'Only the project team updates the DB');
  perform app.require(p_status in ('planned', 'fitted', 'tested', 'failed'), 'Unknown stage');
  perform app.require(jsonb_typeof(coalesce(p_checks, '{}')) = 'object' and jsonb_typeof(coalesce(p_readings, '{}')) = 'object', 'Bad checks');
  ck := coalesce(p_checks, pt.checks);
  perform app.require(p_status <> 'tested' or not exists (select 1 from jsonb_each(ck) c where c.value = 'false'::jsonb), 'Tick every check on the component first');
  perform app.require(p_status <> 'failed' or coalesce(btrim(p_note), '') <> '', 'Say what failed');
  update public.exec_drawing_db_parts set status = p_status, checks = ck, readings = coalesce(p_readings, readings),
    note = case when p_status = 'failed' then btrim(p_note) else note end, updated_by = auth.uid(), updated_at = now() where id = p_id;
  if pt.status is distinct from p_status then
    insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, from_status, to_status, note)
    values (pt.drawing_id, pt.exec_project_id, pt.item_id, 'Component ' || coalesce(pt.ref, pt.ptype), pt.status, p_status, nullif(btrim(p_note), ''));
  end if;
  -- a component going back takes the DB back below Tested
  if p_status <> 'tested' then
    update public.exec_drawing_items set status = 'second', updated_at = now() where id = pt.item_id and status in ('tested', 'done');
  end if;
end $$;

-- many circuits at once (a new board) or one: [{ref, description, phase, device, cable, zs_max}]
create or replace function public.drawing_circuits_save(p_item uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare it public.exec_drawing_items; x jsonb; n int := 0; s int;
begin
  it := app.drawing_db_item(p_item);
  perform app.require(app.drawing_can_edit(it.exec_project_id), 'Only the execution team sets up the circuit schedule');
  perform app.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 1 and 200, 'Add 1 to 200 circuits at a time');
  select coalesce(max(seq), 0) into s from public.exec_drawing_circuits where item_id = it.id;
  for x in select * from jsonb_array_elements(p_rows) loop
    perform app.require(coalesce(btrim(x ->> 'ref'), '') <> '', 'Every circuit needs its reference (e.g. L1/3)');
    perform app.require(nullif(x ->> 'zs_max', '') is null or (x ->> 'zs_max')::numeric > 0, 'Max Zs must be more than 0');
    s := s + 1;
    insert into public.exec_drawing_circuits (item_id, drawing_id, exec_project_id, seq, ref, description, phase, device, cable, zs_max)
    values (it.id, it.drawing_id, it.exec_project_id, s, btrim(x ->> 'ref'), nullif(btrim(x ->> 'description'), ''), nullif(btrim(x ->> 'phase'), ''),
            nullif(btrim(x ->> 'device'), ''), nullif(btrim(x ->> 'cable'), ''), nullif(x ->> 'zs_max', '')::numeric)
    on conflict (item_id, ref) do update set description = excluded.description, phase = excluded.phase, device = excluded.device, cable = excluded.cable,
      zs_max = excluded.zs_max, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.drawing_circuit_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.exec_drawing_circuits;
begin
  select * into c from public.exec_drawing_circuits where id = p_id;
  perform app.require(c.id is not null and app.drawing_can_edit(c.exec_project_id), 'Only the execution team changes the circuit schedule');
  delete from public.exec_drawing_circuits where id = p_id;
end $$;

-- test readings of a circuit: {r1r2, r2, ir, zs, rcd_ms, polarity}. Passing needs IR ≥ 1 MΩ, polarity right, Zs within its maximum
-- (when one is set) and the RCD within 300 ms (when there is one).
create or replace function public.drawing_circuit_test(p_id uuid, p_readings jsonb, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.exec_drawing_circuits; r jsonb := coalesce(p_readings, '{}');
  num text := '^\s*[0-9]+(\.[0-9]+)?\s*$';
begin
  select * into c from public.exec_drawing_circuits where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(app.drawing_can_update(c.exec_project_id), 'Only the project team records circuit tests');
  perform app.require(p_status in ('planned', 'tested', 'failed'), 'Unknown result');
  perform app.require(jsonb_typeof(r) = 'object', 'Bad readings');
  perform app.require(p_status <> 'failed' or coalesce(btrim(p_note), '') <> '', 'Say what failed');
  if p_status = 'tested' then
    perform app.require(coalesce(r ->> 'ir', '') ~ num and coalesce(r ->> 'zs', '') ~ num, 'Enter the insulation resistance and Zs');
    perform app.require((r ->> 'polarity')::boolean is true, 'Polarity must be confirmed right');
    perform app.require((r ->> 'ir')::numeric >= 1, 'Insulation resistance below 1 MΩ – record it as failed');
    perform app.require(c.zs_max is null or (r ->> 'zs')::numeric <= c.zs_max, format('Zs above the maximum of %s Ω – record it as failed', c.zs_max));
    perform app.require(coalesce(r ->> 'rcd_ms', '') !~ num or (r ->> 'rcd_ms')::numeric <= 300, 'RCD trip time over 300 ms – record it as failed');
  end if;
  update public.exec_drawing_circuits set readings = r, status = p_status, note = case when p_status = 'failed' then btrim(p_note) else note end,
    tested_by = case when p_status = 'planned' then null else auth.uid() end, tested_at = case when p_status = 'planned' then null else now() end, updated_at = now()
  where id = p_id;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, from_status, to_status, note)
  values (c.drawing_id, c.exec_project_id, c.item_id, 'Circuit ' || c.ref, c.status, p_status,
          coalesce(nullif(btrim(p_note), ''), concat_ws(' · ', 'IR ' || (r ->> 'ir') || ' MΩ', 'Zs ' || (r ->> 'zs') || ' Ω', 'RCD ' || nullif(r ->> 'rcd_ms', '') || ' ms')));
  if p_status <> 'tested' then
    update public.exec_drawing_items set status = 'second', updated_at = now() where id = c.item_id and status in ('tested', 'done');
  end if;
end $$;

-- stages: a DB is Tested only when its schedule is (the rest as before)
create or replace function public.drawing_item_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare it public.exec_drawing_items; bl text;
begin
  select * into it from public.exec_drawing_items where id = p_id for update;
  perform app.require(it.id is not null, 'Item not found');
  perform app.require(app.drawing_can_update(it.exec_project_id), 'Only the project team updates the stages');
  perform app.require(p_status in ('planned', 'first', 'second', 'wired', 'addr', 'prog', 'p2p', 'tested', 'done', 'failed'), 'Unknown stage');
  perform app.require(p_status not in ('tested', 'done') or not exists (select 1 from jsonb_each(it.checks) c where c.value = 'false'::jsonb),
    'Tick every check on the item first');
  if p_status in ('tested', 'done') and it.kind = 'db' then
    bl := app.drawing_db_blockers(p_id);
    perform app.require(bl is null, 'Test the DB schedule first – ' || bl || ' not tested yet');
  end if;
  perform app.require(p_status <> 'failed' or coalesce(btrim(p_note), '') <> '', 'Say what failed');
  if it.status = p_status then return; end if;
  update public.exec_drawing_items set status = p_status, updated_by = auth.uid(), updated_at = now(),
    note = case when p_status = 'failed' then btrim(p_note) else note end where id = p_id;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, from_status, to_status, note)
  values (it.drawing_id, it.exec_project_id, p_id, 'Stage', it.status, p_status, nullif(btrim(p_note), ''));
  perform app.drawing_refresh_activity(it.activity_id);
end $$;

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
    if p_status in ('tested', 'done') and (exists (select 1 from jsonb_each(it.checks) c where c.value = 'false'::jsonb)
        or (it.kind = 'db' and app.drawing_db_blockers(it.id) is not null)) then sk := sk + 1; continue; end if;
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

-- ---------- floors: order, and copying a typical floor
create or replace function public.drawing_set_level(p_id uuid, p_level numeric) returns void
language plpgsql security definer set search_path = public as $$
declare d public.exec_drawings;
begin
  select * into d from public.exec_drawings where id = p_id;
  perform app.require(d.id is not null and app.drawing_can_edit(d.exec_project_id), 'Only the execution team sets the floor order');
  update public.exec_drawings set level_no = p_level, updated_at = now() where id = p_id;
end $$;

-- p: {items: true, routes: true, links: true, replace_from: 'L2', replace_to: 'L3'}
create or replace function public.drawing_copy_from(p_target uuid, p_source uuid, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.exec_drawings; s public.exec_drawings; ni int := 0; nr int := 0; rf text := nullif(p ->> 'replace_from', ''); rto text := coalesce(p ->> 'replace_to', '');
  links boolean := coalesce((p ->> 'links')::boolean, true); a uuid;
begin
  select * into t from public.exec_drawings where id = p_target;
  select * into s from public.exec_drawings where id = p_source;
  perform app.require(t.id is not null and s.id is not null and t.id <> s.id, 'Choose another drawing to copy from');
  perform app.require(t.exec_project_id = s.exec_project_id, 'Copy only between drawings of the same project');
  perform app.require(not t.archived, 'The drawing is archived');
  perform app.require(app.drawing_can_edit(t.exec_project_id), 'Only the execution team copies a floor');
  if coalesce((p ->> 'items')::boolean, true) then
    insert into public.exec_drawing_items (drawing_id, exec_project_id, kind, x, y, label, area, circuit, checks, boq_item_id, activity_id, to_check, updated_by)
    select t.id, t.exec_project_id, i.kind, i.x, i.y,
           case when rf is null then i.label else replace(i.label, rf, rto) end, case when rf is null then i.area else replace(i.area, rf, rto) end,
           case when rf is null then i.circuit else replace(i.circuit, rf, rto) end,
           coalesce((select jsonb_object_agg(k, false) from jsonb_object_keys(i.checks) k), '{}'),
           case when links then i.boq_item_id end, case when links then i.activity_id end, true, auth.uid()
      from public.exec_drawing_items i where i.drawing_id = s.id and i.kind <> 'riser';
    get diagnostics ni = row_count;
  end if;
  if coalesce((p ->> 'routes')::boolean, true) then
    insert into public.exec_drawing_routes (drawing_id, exec_project_id, kind, pts, label, area, cores, boq_item_id, activity_id, to_check, updated_by)
    select t.id, t.exec_project_id, r.kind, r.pts, case when rf is null then r.label else replace(r.label, rf, rto) end, r.area, r.cores,
           case when links then r.boq_item_id end, case when links then r.activity_id end, true, auth.uid()
      from public.exec_drawing_routes r where r.drawing_id = s.id;
    get diagnostics nr = row_count;
  end if;
  if t.width_m is null and s.width_m is not null and abs(t.width::numeric / t.height - s.width::numeric / s.height) < 0.02 then
    update public.exec_drawings set width_m = s.width_m where id = t.id;
  end if;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, what, note)
  values (t.id, t.exec_project_id, 'Copied from another floor', format('%s items and %s routes from %s – all flagged to check', ni, nr, coalesce(s.sheet_no || ' ', '') || s.title));
  if links then
    for a in select distinct activity_id from public.exec_drawing_items where drawing_id = t.id and activity_id is not null
             union select distinct activity_id from public.exec_drawing_routes where drawing_id = t.id and activity_id is not null loop
      perform app.drawing_refresh_activity(a);
    end loop;
  end if;
  return jsonb_build_object('items', ni, 'routes', nr);
end $$;

-- the engineer confirms copied items and routes match this floor
create or replace function public.drawing_mark_checked(p_items uuid[], p_routes uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int; m int; ex uuid;
begin
  select exec_project_id into ex from (select exec_project_id from public.exec_drawing_items where id = any (coalesce(p_items, '{}'))
                                        union all select exec_project_id from public.exec_drawing_routes where id = any (coalesce(p_routes, '{}'))) x limit 1;
  perform app.require(ex is not null, 'Choose the items to confirm');
  perform app.require(app.drawing_can_edit(ex), 'Only the execution team confirms copied items');
  update public.exec_drawing_items set to_check = false where id = any (coalesce(p_items, '{}')) and to_check and app.drawing_can_edit(exec_project_id);
  get diagnostics n = row_count;
  update public.exec_drawing_routes set to_check = false where id = any (coalesce(p_routes, '{}')) and to_check and app.drawing_can_edit(exec_project_id);
  get diagnostics m = row_count;
  return n + m;
end $$;

-- a moved item is a checked item
create or replace function app.drawing_item_moved() returns trigger
language plpgsql as $$
begin
  if (new.x, new.y) is distinct from (old.x, old.y) then new.to_check := false; end if;
  return new;
end $$;
create trigger exec_drawing_items_moved before update of x, y on public.exec_drawing_items for each row execute function app.drawing_item_moved();

-- ---------- risers
create table public.exec_drawing_risers (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  floor_height_m numeric not null default 3.5 check (floor_height_m > 0),
  note text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (exec_project_id, name)
);
alter table public.exec_drawing_items add column if not exists riser_id uuid references public.exec_drawing_risers (id) on delete set null;

create table public.exec_drawing_riser_runs (
  id uuid primary key default gen_random_uuid(),
  riser_id uuid not null references public.exec_drawing_risers (id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  kind text not null,
  label text,
  from_level numeric not null,
  to_level numeric not null,
  status text not null default 'planned' check (status in ('planned', 'fixed', 'done', 'laid', 'term', 'tested', 'failed')),
  laid int not null default 0 check (laid between 0 and 100),
  area numeric check (area is null or area > 0),
  cores int check (cores is null or cores > 0),
  boq_item_id uuid references public.exec_boq_items (id) on delete set null,
  activity_id uuid references public.exec_activities (id) on delete set null,
  note text,
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  check (to_level <> from_level)
);
create index on public.exec_drawing_riser_runs (riser_id);
alter table public.exec_drawing_events alter column drawing_id drop not null;
alter table public.exec_drawing_events add column if not exists riser_run_id uuid;
alter table public.exec_drawing_risers enable row level security;
alter table public.exec_drawing_riser_runs enable row level security;
create policy exec_drawing_risers_read on public.exec_drawing_risers for select to authenticated using (app.can_read_exec(exec_project_id));
create policy exec_drawing_riser_runs_read on public.exec_drawing_riser_runs for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.exec_drawing_risers, public.exec_drawing_riser_runs to authenticated;

create or replace function app.drawing_is_cont(p_kind text) returns boolean
language sql immutable as $$ select p_kind in ('ladder', 'tray', 'trunk', 'cond', 'gi20', 'gi', 'gi32', 'pvc25', 'flex') $$;

create or replace function public.drawing_riser_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.exec_drawing_risers; ex uuid; rid uuid;
begin
  if nullif(p ->> 'id', '') is not null then
    select * into r from public.exec_drawing_risers where id = (p ->> 'id')::uuid for update;
    perform app.require(r.id is not null, 'Not found');
    ex := r.exec_project_id;
  else
    ex := (p ->> 'exec_project_id')::uuid;
  end if;
  perform app.require(ex is not null and app.drawing_can_edit(ex), 'Only the execution team sets up risers');
  perform app.require(coalesce(btrim(p ->> 'name'), r.name, '') <> '', 'Name the riser (e.g. Riser R1)');
  perform app.require(nullif(p ->> 'floor_height_m', '') is null or (p ->> 'floor_height_m')::numeric > 0, 'Floor height must be more than 0');
  if r.id is null then
    insert into public.exec_drawing_risers (exec_project_id, name, floor_height_m, note)
    values (ex, btrim(p ->> 'name'), coalesce(nullif(p ->> 'floor_height_m', '')::numeric, 3.5), nullif(btrim(p ->> 'note'), '')) returning id into rid;
    return rid;
  end if;
  update public.exec_drawing_risers set name = coalesce(nullif(btrim(p ->> 'name'), ''), name), floor_height_m = coalesce(nullif(p ->> 'floor_height_m', '')::numeric, floor_height_m),
    note = case when p ? 'note' then nullif(btrim(p ->> 'note'), '') else note end where id = r.id;
  return r.id;
end $$;

create or replace function public.drawing_riser_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.exec_drawing_risers; acts uuid[]; a uuid;
begin
  select * into r from public.exec_drawing_risers where id = p_id;
  perform app.require(r.id is not null and app.drawing_can_edit(r.exec_project_id), 'Only the execution team removes risers');
  perform app.require(not exists (select 1 from public.exec_drawing_riser_runs where riser_id = p_id and status <> 'planned'), 'Work is recorded in this riser – it cannot be removed');
  select array_agg(distinct activity_id) into acts from public.exec_drawing_riser_runs where riser_id = p_id and activity_id is not null;
  delete from public.exec_drawing_risers where id = p_id;
  foreach a in array coalesce(acts, '{}') loop perform app.drawing_refresh_activity(a); end loop;
end $$;

-- the riser's point on a sheet: p_riser null unlinks
create or replace function public.drawing_item_riser(p_item uuid, p_riser uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it public.exec_drawing_items;
begin
  select * into it from public.exec_drawing_items where id = p_item;
  perform app.require(it.id is not null and it.kind = 'riser', 'Choose a riser point');
  perform app.require(app.drawing_can_edit(it.exec_project_id), 'Only the execution team links risers');
  perform app.require(p_riser is null or exists (select 1 from public.exec_drawing_risers where id = p_riser and exec_project_id = it.exec_project_id), 'Choose a riser of this project');
  update public.exec_drawing_items set riser_id = p_riser, updated_at = now() where id = p_item;
end $$;

create or replace function public.drawing_riser_run_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rs public.exec_drawing_risers; rr public.exec_drawing_riser_runs; rid uuid; boq uuid := nullif(p ->> 'boq_item_id', '')::uuid; act uuid := nullif(p ->> 'activity_id', '')::uuid;
begin
  if nullif(p ->> 'id', '') is not null then
    select * into rr from public.exec_drawing_riser_runs where id = (p ->> 'id')::uuid for update;
    perform app.require(rr.id is not null, 'Not found');
    select * into rs from public.exec_drawing_risers where id = rr.riser_id;
  else
    select * into rs from public.exec_drawing_risers where id = (p ->> 'riser_id')::uuid;
  end if;
  perform app.require(rs.id is not null, 'Riser not found');
  perform app.require(app.drawing_can_edit(rs.exec_project_id), 'Only the execution team sets up riser runs');
  if p ? 'boq_item_id' or p ? 'activity_id' or rr.id is null then
    perform app.drawing_check_links(rs.exec_project_id, case when p ? 'boq_item_id' or rr.id is null then boq else rr.boq_item_id end,
                                    case when p ? 'activity_id' or rr.id is null then act else rr.activity_id end);
  end if;
  if rr.id is null then
    perform app.require(coalesce(p ->> 'kind', '') <> '', 'Choose what runs in the riser');
    perform app.require(nullif(p ->> 'from_level', '') is not null and nullif(p ->> 'to_level', '') is not null and (p ->> 'from_level')::numeric <> (p ->> 'to_level')::numeric,
      'Give the floors it runs between');
    insert into public.exec_drawing_riser_runs (riser_id, exec_project_id, kind, label, from_level, to_level, area, cores, boq_item_id, activity_id)
    values (rs.id, rs.exec_project_id, p ->> 'kind', nullif(btrim(p ->> 'label'), ''), (p ->> 'from_level')::numeric, (p ->> 'to_level')::numeric,
            nullif(p ->> 'area', '')::numeric, nullif(p ->> 'cores', '')::int, boq, act)
    returning id into rid;
    perform app.drawing_refresh_activity(act);
    return rid;
  end if;
  update public.exec_drawing_riser_runs set kind = coalesce(nullif(p ->> 'kind', ''), kind), label = case when p ? 'label' then nullif(btrim(p ->> 'label'), '') else label end,
    from_level = coalesce(nullif(p ->> 'from_level', '')::numeric, from_level), to_level = coalesce(nullif(p ->> 'to_level', '')::numeric, to_level),
    area = case when p ? 'area' then nullif(p ->> 'area', '')::numeric else area end, cores = case when p ? 'cores' then nullif(p ->> 'cores', '')::int else cores end,
    boq_item_id = case when p ? 'boq_item_id' then boq else boq_item_id end, activity_id = case when p ? 'activity_id' then act else activity_id end,
    updated_by = auth.uid(), updated_at = now()
  where id = rr.id;
  perform app.drawing_refresh_activity(rr.activity_id);
  if p ? 'activity_id' then perform app.drawing_refresh_activity(act); end if;
  return rr.id;
end $$;

create or replace function public.drawing_riser_run_progress(p_id uuid, p_status text, p_laid int default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare rr public.exec_drawing_riser_runs; cont boolean;
begin
  select * into rr from public.exec_drawing_riser_runs where id = p_id for update;
  perform app.require(rr.id is not null, 'Not found');
  perform app.require(app.drawing_can_update(rr.exec_project_id), 'Only the project team updates riser runs');
  cont := app.drawing_is_cont(rr.kind);
  perform app.require(case when cont then p_status in ('planned', 'fixed', 'done') else p_status in ('planned', 'laid', 'term', 'tested', 'failed') end, 'Unknown stage for this run');
  perform app.require(p_laid is null or p_laid between 0 and 100, 'Metres laid is a % from 0 to 100');
  perform app.require(p_status <> 'failed' or coalesce(btrim(p_note), '') <> '', 'Say what failed');
  update public.exec_drawing_riser_runs set status = p_status,
    laid = case when cont then 0 when p_status in ('term', 'tested') then 100 else coalesce(p_laid, laid) end,
    note = case when p_status = 'failed' then btrim(p_note) else note end, updated_by = auth.uid(), updated_at = now() where id = p_id;
  insert into public.exec_drawing_events (exec_project_id, riser_run_id, what, from_status, to_status, note)
  values (rr.exec_project_id, p_id, 'Riser run', rr.status, p_status, coalesce(nullif(btrim(p_note), ''), case when p_laid is not null and not cont then p_laid || '% laid' end));
  perform app.drawing_refresh_activity(rr.activity_id);
end $$;

create or replace function public.drawing_riser_run_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare rr public.exec_drawing_riser_runs;
begin
  select * into rr from public.exec_drawing_riser_runs where id = p_id;
  perform app.require(rr.id is not null and app.drawing_can_edit(rr.exec_project_id), 'Only the execution team removes riser runs');
  delete from public.exec_drawing_riser_runs where id = p_id;
  perform app.drawing_refresh_activity(rr.activity_id);
end $$;

-- figures now include the riser runs (length = floors × floor height)
create or replace function app.drawing_refresh_activity(p_activity uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if p_activity is null then return; end if;
  select round(100 * avg(w), 2) into v from (
    select app.drawing_weight(i.status) w from public.exec_drawing_items i join public.exec_drawings d on d.id = i.drawing_id and not d.archived where i.activity_id = p_activity
    union all
    select app.drawing_route_weight(r.kind, r.status, r.laid) from public.exec_drawing_routes r join public.exec_drawings d on d.id = r.drawing_id and not d.archived where r.activity_id = p_activity
    union all
    select app.drawing_route_weight(r.kind, r.status, r.laid) from public.exec_drawing_riser_runs r where r.activity_id = p_activity) x;
  update public.exec_activities set pct_drawing = v where id = p_activity;
end $$;

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
    select l.boq_item_id, coalesce(l.m, 0) * coalesce(l.cores, 1), coalesce(l.m, 0) * coalesce(l.cores, 1) * app.drawing_route_weight(l.kind, l.status, l.laid) from lens l
    union all
    select r.boq_item_id, abs(r.to_level - r.from_level) * s.floor_height_m * case when app.drawing_is_cont(r.kind) then 1 else coalesce(r.cores, 1) end,
           abs(r.to_level - r.from_level) * s.floor_height_m * case when app.drawing_is_cont(r.kind) then 1 else coalesce(r.cores, 1) end * app.drawing_route_weight(r.kind, r.status, r.laid)
      from public.exec_drawing_riser_runs r join public.exec_drawing_risers s on s.id = r.riser_id
     where r.exec_project_id = p_exec and r.boq_item_id is not null) x
  where app.can_read_exec(p_exec)
  group by x.boq_item_id
$$;

-- ---------- lighting-control scenes and BMS cause & effect
create table public.exec_drawing_tests (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  drawing_id uuid references public.exec_drawings (id) on delete cascade,
  kind text not null check (kind in ('scene', 'cne')),
  seq int not null default 0,
  name text not null check (btrim(name) <> ''),
  area text,
  cause text,
  effect text,
  items uuid[] not null default '{}',
  status text not null default 'planned' check (status in ('planned', 'tested', 'failed')),
  result_note text,
  witness text,
  tested_by uuid references public.profiles (id),
  tested_at timestamptz,
  created_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now()
);
create index on public.exec_drawing_tests (exec_project_id);
alter table public.exec_drawing_tests enable row level security;
create policy exec_drawing_tests_read on public.exec_drawing_tests for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.exec_drawing_tests to authenticated;

-- p: {id? | exec_project_id, drawing_id?, kind, name, area, cause, effect, items[]}
create or replace function public.drawing_test_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.exec_drawing_tests; ex uuid; dw uuid := nullif(p ->> 'drawing_id', '')::uuid; tid uuid; its uuid[];
begin
  if nullif(p ->> 'id', '') is not null then
    select * into t from public.exec_drawing_tests where id = (p ->> 'id')::uuid for update;
    perform app.require(t.id is not null, 'Not found');
    ex := t.exec_project_id;
  else
    ex := coalesce((p ->> 'exec_project_id')::uuid, (select exec_project_id from public.exec_drawings where id = dw));
  end if;
  perform app.require(ex is not null and app.drawing_can_edit(ex), 'Only the execution team sets up scenes and cause & effect tests');
  perform app.require(dw is null or exists (select 1 from public.exec_drawings where id = dw and exec_project_id = ex), 'Choose a drawing of this project');
  perform app.require(t.id is not null or p ->> 'kind' in ('scene', 'cne'), 'Choose a scene or a cause & effect');
  perform app.require(coalesce(btrim(p ->> 'name'), t.name, '') <> '', 'Name it');
  if p ? 'items' then
    select coalesce(array_agg(x::uuid), '{}') into its from jsonb_array_elements_text(p -> 'items') x;
    perform app.require(not exists (select 1 from unnest(its) u where not exists (select 1 from public.exec_drawing_items i where i.id = u and i.exec_project_id = ex)),
      'Choose items of this project');
  end if;
  if t.id is null then
    insert into public.exec_drawing_tests (exec_project_id, drawing_id, kind, seq, name, area, cause, effect, items)
    values (ex, dw, p ->> 'kind', (select coalesce(max(seq), 0) + 1 from public.exec_drawing_tests where exec_project_id = ex), btrim(p ->> 'name'), nullif(btrim(p ->> 'area'), ''),
            nullif(btrim(p ->> 'cause'), ''), nullif(btrim(p ->> 'effect'), ''), coalesce(its, '{}'))
    returning id into tid;
    return tid;
  end if;
  update public.exec_drawing_tests set name = coalesce(nullif(btrim(p ->> 'name'), ''), name), area = case when p ? 'area' then nullif(btrim(p ->> 'area'), '') else area end,
    cause = case when p ? 'cause' then nullif(btrim(p ->> 'cause'), '') else cause end, effect = case when p ? 'effect' then nullif(btrim(p ->> 'effect'), '') else effect end,
    items = coalesce(its, items), updated_at = now() where id = t.id;
  return t.id;
end $$;

create or replace function public.drawing_test_result(p_id uuid, p_status text, p_note text default null, p_witness text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t public.exec_drawing_tests;
begin
  select * into t from public.exec_drawing_tests where id = p_id for update;
  perform app.require(t.id is not null, 'Not found');
  perform app.require(app.drawing_can_update(t.exec_project_id), 'Only the project team records test results');
  perform app.require(p_status in ('planned', 'tested', 'failed'), 'Unknown result');
  perform app.require(p_status <> 'failed' or coalesce(btrim(p_note), '') <> '', 'Say what did not work');
  update public.exec_drawing_tests set status = p_status, result_note = nullif(btrim(p_note), ''), witness = nullif(btrim(p_witness), ''),
    tested_by = case when p_status = 'planned' then null else auth.uid() end, tested_at = case when p_status = 'planned' then null else now() end, updated_at = now()
  where id = p_id;
  if t.drawing_id is not null then
    insert into public.exec_drawing_events (drawing_id, exec_project_id, what, from_status, to_status, note)
    values (t.drawing_id, t.exec_project_id, case t.kind when 'scene' then 'Scene ' else 'Cause & effect ' end || t.name, t.status, p_status,
            concat_ws(' · ', nullif(btrim(p_note), ''), 'witness ' || nullif(btrim(p_witness), '')));
  end if;
end $$;

create or replace function public.drawing_test_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.exec_drawing_tests;
begin
  select * into t from public.exec_drawing_tests where id = p_id;
  perform app.require(t.id is not null and app.drawing_can_edit(t.exec_project_id), 'Only the execution team removes tests');
  delete from public.exec_drawing_tests where id = p_id;
end $$;

-- drawing_save also takes the floor order
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
  perform app.require(coalesce(p ->> 'level_no', '') = '' or (p ->> 'level_no') ~ '^-?[0-9]+(\.[0-9]+)?$', 'The floor order is a number (e.g. -1, 0, 1, 2)');
  if d.id is null then
    perform app.require(p ->> 'image_path' is not null and (p ->> 'width')::int > 0 and (p ->> 'height')::int > 0, 'Upload the drawing first');
    insert into public.exec_drawings (exec_project_id, title, sheet_no, floor, level_no, revision, image_path, pdf_path, width, height, width_m, scope, lms)
    values (ex, btrim(p ->> 'title'), nullif(btrim(p ->> 'sheet_no'), ''), nullif(btrim(p ->> 'floor'), ''), nullif(p ->> 'level_no', '')::numeric, nullif(btrim(p ->> 'revision'), ''),
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
    level_no = case when p ? 'level_no' then nullif(p ->> 'level_no', '')::numeric else level_no end,
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

revoke execute on function public.drawing_delete(uuid, text), public.drawing_pin_add(jsonb), public.drawing_pins(uuid), public.drawing_pin_close(uuid, text, boolean),
  public.drawing_pin_delete(uuid), public.drawing_db_part_save(jsonb), public.drawing_db_part_delete(uuid), public.drawing_db_part_status(uuid, text, jsonb, jsonb, text),
  public.drawing_circuits_save(uuid, jsonb), public.drawing_circuit_delete(uuid), public.drawing_circuit_test(uuid, jsonb, text, text), public.drawing_set_level(uuid, numeric),
  public.drawing_copy_from(uuid, uuid, jsonb), public.drawing_mark_checked(uuid[], uuid[]), public.drawing_riser_save(jsonb), public.drawing_riser_delete(uuid),
  public.drawing_item_riser(uuid, uuid), public.drawing_riser_run_save(jsonb), public.drawing_riser_run_progress(uuid, text, int, text), public.drawing_riser_run_delete(uuid),
  public.drawing_test_save(jsonb), public.drawing_test_result(uuid, text, text, text), public.drawing_test_delete(uuid) from public, anon;
grant execute on function public.drawing_delete(uuid, text), public.drawing_pin_add(jsonb), public.drawing_pins(uuid), public.drawing_pin_close(uuid, text, boolean),
  public.drawing_pin_delete(uuid), public.drawing_db_part_save(jsonb), public.drawing_db_part_delete(uuid), public.drawing_db_part_status(uuid, text, jsonb, jsonb, text),
  public.drawing_circuits_save(uuid, jsonb), public.drawing_circuit_delete(uuid), public.drawing_circuit_test(uuid, jsonb, text, text), public.drawing_set_level(uuid, numeric),
  public.drawing_copy_from(uuid, uuid, jsonb), public.drawing_mark_checked(uuid[], uuid[]), public.drawing_riser_save(jsonb), public.drawing_riser_delete(uuid),
  public.drawing_item_riser(uuid, uuid), public.drawing_riser_run_save(jsonb), public.drawing_riser_run_progress(uuid, text, int, text), public.drawing_riser_run_delete(uuid),
  public.drawing_test_save(jsonb), public.drawing_test_result(uuid, text, text, text), public.drawing_test_delete(uuid) to authenticated;
