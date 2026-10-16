-- Smart drawings (testing), round F – control:
--  * Revisions: the sheet a new revision replaces is kept for the compare, and everything on the drawing is flagged to be
--    checked against the new one. An item still to check cannot be marked Tested / Commissioned.
--  * Stage approval: Tested / Commissioned (and a passed circuit) recorded by a supervisor or trainee counts in the BOQ,
--    activity and early-warning figures once the project's AE (or the SEE) confirms it – or returns it with a reason.
--  * Check templates: the SEE edits the checks and readings of each item and DB-component type for the company or for one
--    project; new items take them, and items not yet tested can be brought in line.

alter table public.exec_drawing_items add column if not exists confirmed boolean not null default true;
alter table public.exec_drawing_items add column if not exists check_why text;
alter table public.exec_drawing_routes add column if not exists check_why text;
alter table public.exec_drawing_circuits add column if not exists confirmed boolean not null default true;

create table public.exec_drawing_revisions (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.exec_drawings (id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  revision text,
  image_path text not null,
  pdf_path text,
  width int not null,
  height int not null,
  uploaded_at timestamptz,
  replaced_at timestamptz not null default now(),
  replaced_by uuid references public.profiles (id)
);
create index on public.exec_drawing_revisions (drawing_id, replaced_at desc);
alter table public.exec_drawing_revisions enable row level security;
create policy exec_drawing_revisions_read on public.exec_drawing_revisions for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.exec_drawing_revisions to authenticated;

create table public.exec_check_templates (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid references public.exec_projects (id) on delete cascade, -- null: the company template
  kind text not null, -- an item type, or 'part:<component type>'
  checks jsonb not null check (jsonb_typeof(checks) = 'array'),
  readings jsonb not null default '[]' check (jsonb_typeof(readings) = 'array'),
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index exec_check_templates_one on public.exec_check_templates (coalesce(exec_project_id, '00000000-0000-0000-0000-000000000000'::uuid), kind);
alter table public.exec_check_templates enable row level security;
create policy exec_check_templates_read on public.exec_check_templates for select to authenticated using (exec_project_id is null or app.can_read_exec(exec_project_id));
grant select on public.exec_check_templates to authenticated;

-- an unconfirmed Tested / Commissioned counts as installed (2nd fix) until confirmed
create or replace function app.drawing_item_weight(p_status text, p_confirmed boolean) returns numeric
language sql immutable as $$
  select case when not coalesce(p_confirmed, true) and p_status in ('tested', 'done') then 0.75 else app.drawing_weight(p_status) end
$$;

create or replace function app.drawing_refresh_activity(p_activity uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v numeric;
begin
  if p_activity is null then return; end if;
  select round(100 * avg(w), 2) into v from (
    select app.drawing_item_weight(i.status, i.confirmed) w from public.exec_drawing_items i join public.exec_drawings d on d.id = i.drawing_id and not d.archived where i.activity_id = p_activity
    union all
    select app.drawing_route_weight(r.kind, r.status, r.laid) from public.exec_drawing_routes r join public.exec_drawings d on d.id = r.drawing_id and not d.archived where r.activity_id = p_activity
    union all
    select app.drawing_route_weight(r.kind, r.status, r.laid) from public.exec_drawing_riser_runs r where r.activity_id = p_activity) x;
  update public.exec_activities set pct_drawing = v where id = p_activity;
end $function$;

create or replace function public.drawing_boq(p_exec uuid)
 RETURNS TABLE(boq_item_id uuid, qty numeric, done numeric, items integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lens as (
    select r.*, d.width_m * (select sum(sqrt(power((b ->> 0)::numeric - (a ->> 0)::numeric, 2) + power(((b ->> 1)::numeric - (a ->> 1)::numeric) * d.height / d.width, 2)))
                               from jsonb_array_elements(r.pts) with ordinality s1 (a, i) join jsonb_array_elements(r.pts) with ordinality s2 (b, j) on j = i + 1) as m
      from public.exec_drawing_routes r join public.exec_drawings d on d.id = r.drawing_id and not d.archived
     where r.exec_project_id = p_exec and r.boq_item_id is not null)
  select x.boq_item_id, sum(x.q), sum(x.dn), count(*)::int from (
    select i.boq_item_id, 1::numeric q, app.drawing_item_weight(i.status, i.confirmed) dn
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
$function$;

create or replace function public.drawing_installer_figures(p_exec uuid, p_installer text DEFAULT NULL::text, p_sub uuid DEFAULT NULL::uuid)
 RETURNS TABLE(boq_item_id uuid, kind text, unit text, total numeric, installed numeric, tested numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine_i as (
    select i.* from public.exec_drawing_items i join public.exec_drawings d on d.id = i.drawing_id and not d.archived
     where i.exec_project_id = p_exec and i.kind not in ('riser')
       and (p_installer is null or (i.installer = p_installer and (p_installer = 'dimo' or i.installer_sub = p_sub)))),
  mine_r as (
    select r.*, coalesce(d.width_m * (select sum(sqrt(power((b ->> 0)::numeric - (a ->> 0)::numeric, 2) + power(((b ->> 1)::numeric - (a ->> 1)::numeric) * d.height / d.width, 2)))
                               from jsonb_array_elements(r.pts) with ordinality s1 (a, i) join jsonb_array_elements(r.pts) with ordinality s2 (b, j) on j = i + 1), 0)
             * case when app.drawing_is_cont(r.kind) then 1 else coalesce(r.cores, 1) end as m
      from public.exec_drawing_routes r join public.exec_drawings d on d.id = r.drawing_id and not d.archived
     where r.exec_project_id = p_exec
       and (p_installer is null or (r.installer = p_installer and (p_installer = 'dimo' or r.installer_sub = p_sub))))
  select x.boq_item_id, x.kind, x.unit, sum(x.t), sum(x.ins), sum(x.tst) from (
    select i.boq_item_id, case when i.boq_item_id is null then i.kind end kind, 'nos' unit, 1::numeric t,
           case when app.drawing_weight(i.status) >= 0.75 then 1 else 0 end::numeric ins, case when i.status in ('tested', 'done') and i.confirmed then 1 else 0 end::numeric tst
      from mine_i i
    union all
    select r.boq_item_id, case when r.boq_item_id is null then r.kind end, 'm', r.m, r.m * app.drawing_route_weight(r.kind, r.status, r.laid),
           case when r.status in ('tested', 'done') then r.m else 0 end
      from mine_r r) x
  where app.can_read_exec(p_exec)
  group by x.boq_item_id, x.kind, x.unit
$function$;

create or replace function app.drawing_db_blockers(p_item uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select nullif(concat_ws(' and ',
    case when n1 > 0 then n1 || ' component(s)' end,
    case when n2 > 0 then n2 || ' circuit(s)' end), '')
  from (select (select count(*) from public.exec_drawing_db_parts where item_id = p_item and status <> 'tested') n1,
               (select count(*) from public.exec_drawing_circuits where item_id = p_item and (status <> 'tested' or not confirmed)) n2) x
$function$;

create or replace function public.drawing_item_status(p_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    perform app.require(bl is null, 'Finish the DB schedule first – ' || bl || ' not passed or not confirmed yet');
  end if;
  perform app.require(p_status <> 'failed' or coalesce(btrim(p_note), '') <> '', 'Say what failed');
  perform app.require(p_status not in ('tested', 'done') or not it.to_check,
    case when it.check_why like 'revision%' then 'Check the item against the new revision first' else 'Check the copied item against this floor first' end);
  if it.status = p_status then return; end if;
  -- Tested / Commissioned by a supervisor or trainee counts once the AE (or the SEE) confirms it
  update public.exec_drawing_items set status = p_status, updated_by = auth.uid(), updated_at = now(),
    confirmed = p_status not in ('tested', 'done') or app.drawing_can_edit(it.exec_project_id),
    note = case when p_status = 'failed' then btrim(p_note) else note end where id = p_id;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, from_status, to_status, note)
  values (it.drawing_id, it.exec_project_id, p_id, 'Stage', it.status, p_status,
          concat_ws(' · ', nullif(btrim(p_note), ''), case when p_status in ('tested', 'done') and not app.drawing_can_edit(it.exec_project_id) then 'awaiting AE confirmation' end));
  perform app.drawing_refresh_activity(it.activity_id);
end $function$;

create or replace function public.drawing_items_status(p_ids uuid[], p_status text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare it public.exec_drawing_items; up int := 0; sk int := 0; acts uuid[] := '{}'; a uuid;
begin
  perform app.require(p_status in ('planned', 'first', 'second', 'wired', 'addr', 'prog', 'p2p', 'tested', 'done', 'failed'), 'Unknown stage');
  perform app.require(p_status <> 'failed' or coalesce(btrim(p_note), '') <> '', 'Say what failed');
  perform app.require(coalesce(cardinality(p_ids), 0) between 1 and 400, 'Choose 1 to 400 items');
  for it in select * from public.exec_drawing_items where id = any (p_ids) for update loop
    perform app.require(app.drawing_can_update(it.exec_project_id), 'Only the project team updates the stages');
    if it.status = p_status then continue; end if;
    if p_status in ('tested', 'done') and (it.to_check or exists (select 1 from jsonb_each(it.checks) c where c.value = 'false'::jsonb)
        or (it.kind = 'db' and app.drawing_db_blockers(it.id) is not null)) then sk := sk + 1; continue; end if;
    update public.exec_drawing_items set status = p_status, updated_by = auth.uid(), updated_at = now(),
      confirmed = p_status not in ('tested', 'done') or app.drawing_can_edit(it.exec_project_id),
      note = case when p_status = 'failed' then btrim(p_note) else note end where id = it.id;
    insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, from_status, to_status, note)
    values (it.drawing_id, it.exec_project_id, it.id, 'Stage', it.status, p_status, nullif(btrim(p_note), ''));
    up := up + 1;
    if it.activity_id is not null then acts := acts || it.activity_id; end if;
  end loop;
  foreach a in array (select array(select distinct unnest(acts))) loop perform app.drawing_refresh_activity(a); end loop;
  return jsonb_build_object('updated', up, 'skipped', sk);
end $function$;

create or replace function public.drawing_circuit_test(p_id uuid, p_readings jsonb, p_status text, p_note text DEFAULT NULL::text, p_instrument uuid DEFAULT NULL::uuid, p_accept_uncalibrated boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.exec_drawing_circuits; r jsonb := coalesce(p_readings, '{}'); ins public.instruments; unc boolean := false;
  num text := '^\s*[0-9]+(\.[0-9]+)?\s*$';
begin
  select * into c from public.exec_drawing_circuits where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(app.drawing_can_update(c.exec_project_id), 'Only the project team records circuit tests');
  perform app.require(p_status in ('planned', 'tested', 'failed'), 'Unknown result');
  perform app.require(jsonb_typeof(r) = 'object', 'Bad readings');
  perform app.require(p_status <> 'failed' or coalesce(btrim(p_note), '') <> '', 'Say what failed');
  if p_status <> 'planned' then
    perform app.require(p_instrument is not null, 'Choose the test instrument used');
    select * into ins from public.instruments where id = p_instrument and not removed;
    perform app.require(ins.id is not null, 'Unknown instrument');
    perform app.require(ins.condition = 'ok', format('%s is out of order – choose another instrument', ins.name));
    perform app.require(ins.kind = 'instrument', format('%s is a tool – choose a measuring instrument', ins.name));
    unc := not app.instrument_calibrated(ins);
    perform app.require(not unc or p_accept_uncalibrated, format('%s is not calibrated%s – confirm that the test was done with an uncalibrated instrument', ins.name,
      case when ins.cal_expiry is not null then ' (expired ' || to_char(ins.cal_expiry, 'DD Mon YYYY') || ')' else '' end));
  end if;
  if p_status = 'tested' then
    perform app.require(coalesce(r ->> 'ir', '') ~ num and coalesce(r ->> 'zs', '') ~ num, 'Enter the insulation resistance and Zs');
    perform app.require((r ->> 'polarity')::boolean is true, 'Polarity must be confirmed right');
    perform app.require((r ->> 'ir')::numeric >= 1, 'Insulation resistance below 1 MΩ – record it as failed');
    perform app.require(c.zs_max is null or (r ->> 'zs')::numeric <= c.zs_max, format('Zs above the maximum of %s Ω – record it as failed', c.zs_max));
    perform app.require(coalesce(r ->> 'rcd_ms', '') !~ num or (r ->> 'rcd_ms')::numeric <= 300, 'RCD trip time over 300 ms – record it as failed');
  end if;
  update public.exec_drawing_circuits set readings = r, status = p_status, note = case when p_status = 'failed' then btrim(p_note) else note end,
    instrument_id = case when p_status = 'planned' then null else ins.id end, uncalibrated = unc,
    confirmed = p_status <> 'tested' or app.drawing_can_edit(c.exec_project_id),
    tested_by = case when p_status = 'planned' then null else auth.uid() end, tested_at = case when p_status = 'planned' then null else now() end, updated_at = now()
  where id = p_id;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, from_status, to_status, note)
  values (c.drawing_id, c.exec_project_id, c.item_id, 'Circuit ' || c.ref, c.status, p_status,
          coalesce(nullif(btrim(p_note), ''), concat_ws(' · ', 'IR ' || (r ->> 'ir') || ' MΩ', 'Zs ' || (r ->> 'zs') || ' Ω', 'RCD ' || nullif(r ->> 'rcd_ms', '') || ' ms',
                   case when unc then 'UNCALIBRATED instrument' end)));
  if unc then
    perform app.notify_many(app.role_users('senior_elec_engineer') || app.role_users('operations_exec'), 'instrument', 'Circuit test with an uncalibrated instrument',
      format('Circuit %s · %s · %s', c.ref, app.instrument_head(ins), app.exec_head(c.exec_project_id)), 'critical', 'instrument', ins.id, app.instrument_url(ins.id), null, true);
  end if;
  if p_status <> 'tested' then
    update public.exec_drawing_items set status = 'second', updated_at = now() where id = c.item_id and status in ('tested', 'done');
  end if;
end $function$;

create or replace function public.drawing_save(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- keep the sheet it replaces for the compare, and flag everything on it to be checked against the new one
    insert into public.exec_drawing_revisions (drawing_id, exec_project_id, revision, image_path, pdf_path, width, height, uploaded_at, replaced_by)
    values (d.id, ex, d.revision, d.image_path, d.pdf_path, d.width, d.height, d.updated_at, auth.uid());
    update public.exec_drawing_items set to_check = true, check_why = 'revision ' || coalesce(nullif(btrim(p ->> 'revision'), ''), 'new') where drawing_id = d.id;
    update public.exec_drawing_routes set to_check = true, check_why = 'revision ' || coalesce(nullif(btrim(p ->> 'revision'), ''), 'new') where drawing_id = d.id;
    insert into public.exec_drawing_events (drawing_id, exec_project_id, what, note) values (d.id, ex, 'New revision uploaded',
      concat_ws(' · ', nullif(btrim(p ->> 'revision'), ''), 'everything on it flagged to check'));
  end if;
  return d.id;
end $function$;

create or replace function public.drawing_delete(p_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  paths := paths || coalesce((select array_agg(x) from public.exec_drawing_revisions r, unnest(array[r.image_path, r.pdf_path]) x where r.drawing_id = p_id and x is not null), '{}');
  insert into public.exec_drawing_deletions (exec_project_id, title, sheet_no, floor, revision, items, routes, reason)
  values (d.exec_project_id, d.title, d.sheet_no, d.floor, d.revision, ni, nr, nullif(btrim(p_reason), ''));
  delete from public.exec_drawings where id = p_id;
  foreach a in array coalesce(acts, '{}') loop perform app.drawing_refresh_activity(a); end loop;
  -- the image is kept while another drawing still uses it (a revision that was not re-uploaded)
  return array(select p from unnest(paths) p where not exists (select 1 from public.exec_drawings x where x.image_path = p or x.pdf_path = p));
end $function$;

-- the AE (or the SEE) confirms – or returns with a reason – what supervisors and trainees marked Tested
create or replace function public.drawing_confirm(p_items uuid[], p_circuits uuid[], p_ok boolean, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare ex uuid; n int := 0; m int := 0; r record; acts uuid[] := '{}'; a uuid;
begin
  select exec_project_id into ex from (select exec_project_id from public.exec_drawing_items where id = any (coalesce(p_items, '{}'))
                                        union all select exec_project_id from public.exec_drawing_circuits where id = any (coalesce(p_circuits, '{}'))) x limit 1;
  perform app.require(ex is not null, 'Choose what to confirm');
  perform app.require(app.drawing_can_edit(ex) and (app.has_role('senior_elec_engineer') or app.is_project_ae(ex)), 'The project''s Assistant Engineer or the Senior Electrical Engineer confirms');
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Say why it is returned');
  for r in select * from public.exec_drawing_items where id = any (coalesce(p_items, '{}')) and exec_project_id = ex and not confirmed and status in ('tested', 'done') for update loop
    update public.exec_drawing_items set confirmed = true, status = case when p_ok then status else 'second' end, updated_at = now(),
      note = case when p_ok then note else btrim(p_note) end where id = r.id;
    insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, from_status, to_status, note)
    values (r.drawing_id, r.exec_project_id, r.id, case when p_ok then 'Confirmed' else 'Returned' end, r.status, case when p_ok then r.status else 'second' end, nullif(btrim(p_note), ''));
    n := n + 1;
    if r.activity_id is not null then acts := acts || r.activity_id; end if;
  end loop;
  for r in select * from public.exec_drawing_circuits where id = any (coalesce(p_circuits, '{}')) and exec_project_id = ex and not confirmed and status = 'tested' for update loop
    update public.exec_drawing_circuits set confirmed = true, status = case when p_ok then status else 'planned' end, updated_at = now(),
      note = case when p_ok then note else btrim(p_note) end where id = r.id;
    insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, from_status, to_status, note)
    values (r.drawing_id, r.exec_project_id, r.item_id, 'Circuit ' || r.ref || case when p_ok then ' confirmed' else ' returned' end, r.status, case when p_ok then r.status else 'planned' end, nullif(btrim(p_note), ''));
    m := m + 1;
  end loop;
  foreach a in array (select array(select distinct unnest(acts))) loop perform app.drawing_refresh_activity(a); end loop;
  return n + m;
end $$;

-- p_checks: [[key, label], …]; p_readings: [[key, label, unit], …]; p_apply: bring items / components not yet tested in line
create or replace function public.drawing_template_save(p_project uuid, p_kind text, p_checks jsonb, p_readings jsonb, p_apply boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare x jsonb; keys text[] := '{}'; n int := 0;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer sets the check templates');
  perform app.require(coalesce(btrim(p_kind), '') <> '', 'Choose the item type');
  perform app.require(p_project is null or exists (select 1 from public.exec_projects where id = p_project), 'Project not found');
  perform app.require(jsonb_typeof(p_checks) = 'array' and jsonb_typeof(coalesce(p_readings, '[]')) = 'array', 'Bad template');
  for x in select * from jsonb_array_elements(p_checks) loop
    perform app.require(jsonb_typeof(x) = 'array' and coalesce(btrim(x ->> 0), '') <> '' and coalesce(btrim(x ->> 1), '') <> '', 'Every check needs a name');
    perform app.require(not (x ->> 0 = any (keys)), 'Two checks with the same key');
    keys := keys || (x ->> 0);
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_readings, '[]')) loop
    perform app.require(jsonb_typeof(x) = 'array' and coalesce(btrim(x ->> 0), '') <> '' and coalesce(btrim(x ->> 1), '') <> '', 'Every reading needs a name');
  end loop;
  insert into public.exec_check_templates (exec_project_id, kind, checks, readings, updated_by, updated_at)
  values (p_project, p_kind, p_checks, coalesce(p_readings, '[]'), auth.uid(), now())
  on conflict (coalesce(exec_project_id, '00000000-0000-0000-0000-000000000000'::uuid), kind)
  do update set checks = excluded.checks, readings = excluded.readings, updated_by = auth.uid(), updated_at = now();
  if p_apply then
    -- ticks kept for the checks that stay, new checks unticked, removed ones dropped
    if p_kind like 'part:%' then
      update public.exec_drawing_db_parts pt set checks = coalesce((select jsonb_object_agg(k, coalesce((pt.checks ->> k)::boolean, false)) from unnest(keys) k), '{}'), updated_at = now()
       where pt.ptype = substr(p_kind, 6) and pt.status <> 'tested' and (p_project is null or pt.exec_project_id = p_project)
         and (p_project is not null or not exists (select 1 from public.exec_check_templates t where t.exec_project_id = pt.exec_project_id and t.kind = p_kind));
    else
      update public.exec_drawing_items i set checks = coalesce((select jsonb_object_agg(k, coalesce((i.checks ->> k)::boolean, false)) from unnest(keys) k), '{}'), updated_at = now()
       where i.kind = p_kind and i.status not in ('tested', 'done') and (p_project is null or i.exec_project_id = p_project)
         and (p_project is not null or not exists (select 1 from public.exec_check_templates t where t.exec_project_id = i.exec_project_id and t.kind = p_kind));
    end if;
    get diagnostics n = row_count;
  end if;
  return n;
end $$;

create or replace function public.drawing_template_delete(p_project uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer sets the check templates');
  delete from public.exec_check_templates where exec_project_id is not distinct from p_project and kind = p_kind;
end $$;

create or replace function app.exec_pending_approvals()
 RETURNS TABLE(source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text, requested_at timestamp with time zone, inquiry_id uuid, url text, step text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'access_change', c.id, 'exec_access', 'Appointment change – ' || r.person_name, c.reason, c.requested_by, app.display_name(c.requested_by),
         c.requested_at, null::uuid, '/execution/access/' || r.id, 'SM Projects'
  from public.access_changes c join public.access_requests r on r.id = c.request_id
  where c.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'access_request', r.id, 'exec_access',
         format('%s – %s', case r.kind when 'temp_add' then case r.role_type when 'trainee' then 'Trainee' else 'Temporary Assistant Engineer' end
                                       when 'temp_delete' then 'Delete temporary role' else 'Subcontractor supervisor' end, r.person_name),
         concat_ws(' · ', r.company, r.reason), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid,
         '/execution/access/' || r.id, case r.status when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.access_requests r
  where (r.status = 'pending_smp' and app.has_role('sm_projects')) or (r.status = 'pending_gm' and app.has_role('gm'))
  union all
  select 'exec_plan', pl.id, 'exec_plan', format('Weekly plan – %s – week of %s', app.display_name(pl.ae_id), to_char(pl.week_start, 'DD Mon')),
         concat_ws(' · ', app.exec_head(pl.exec_project_id), case when pl.is_late then 'submitted late' end), pl.ae_id, app.display_name(pl.ae_id),
         pl.submitted_at, null::uuid, '/execution/plan/' || pl.id, null
  from public.exec_plans pl where pl.status = 'submitted' and app.has_role('senior_elec_engineer')
  union all
  select 'variation', v.id, 'exec_variation',
         format('Variation %s – %s%s', v.code, v.title,
                case when v.value_lkr is not null then format(' (%s%s)', case when v.value_lkr > 0 then '+' else '−' end, app.fmt_money(abs(v.value_lkr), 'LKR')) else '' end),
         app.exec_head(v.exec_project_id), v.raised_by, app.display_name(v.raised_by), v.raised_at, null::uuid, '/execution/variation/' || v.id,
         case v.status when 'raised' then 'Screen' when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.variations v
  where (v.status = 'raised' and app.has_role('senior_elec_engineer')) or (v.status = 'pending_smp' and app.has_role('sm_projects'))
     or (v.status = 'pending_gm' and app.has_role('gm'))
  union all
  select 'material_request', m.id, 'exec_material', format('Material request %s', m.code), app.mr_head(m), m.requested_by, app.display_name(m.requested_by),
         m.requested_at, null::uuid, '/execution/material/' || m.id, case m.status when 'submitted' then 'Senior Electrical Engineer' else 'SM Projects' end
  from public.material_requests m
  where (m.status = 'submitted' and app.has_role('senior_elec_engineer')) or (m.status = 'pending_smp' and app.has_role('sm_projects'))
  union all
  select 'design_query', q.id, 'exec_design_query', format('Design query %s', q.code), concat_ws(' · ', app.exec_head(q.exec_project_id), q.question),
         q.raised_by, app.display_name(q.raised_by), q.raised_at, null::uuid, '/execution/query/' || q.id,
         case q.status when 'raised' then 'Screen' else 'Answer' end
  from public.design_queries q
  where (q.status = 'raised' and app.has_role('senior_elec_engineer')) or (q.status = 'forwarded' and app.has_role('design_manager'))
  union all
  select 'exec_gate', g.id, 'exec_gate', format('%s – %s', (array['Programme approved', 'Handover to the client', 'Project closure'])[g.gate], app.exec_head(g.exec_project_id)), g.note, g.requested_by,
         app.display_name(g.requested_by), g.requested_at, null::uuid, '/execution/' || g.exec_project_id, null
  from public.exec_gates g where g.status = 'pending' and not g.legacy and app.has_role('sm_projects')
  union all
  select 'sub_cert', c.id, 'exec_sub_cert', format('Subcontractor payment %s – %s', c.code, c.subcontractor), app.exec_head(c.exec_project_id) || ' · ' || app.fmt_money(c.net, 'LKR'),
         c.prepared_by, app.display_name(c.prepared_by), coalesce(c.submitted_at, c.prepared_at), null::uuid, '/execution/sub-cert/' || c.id,
         case c.status when 'jm_requested' then 'Confirm joint measurement' when 'jm_ae' then 'JM – AE check' when 'jm_see' then 'JM – SEE approval' when 'ae_review' then 'AE check' when 'prepared' then 'SEE approval' when 'verified' then 'SM Projects' else 'Pay' end
  from public.sub_certs c
  where (c.status = 'ae_review' and app.is_project_ae(c.exec_project_id)) or (c.status = 'jm_ae' and app.is_project_ae(c.exec_project_id))
     or (c.status = 'jm_see' and app.has_role('senior_elec_engineer'))
     or (c.status = 'jm_requested' and app.can_confirm_jm(c.exec_project_id)) or (c.status = 'prepared' and app.has_role('senior_elec_engineer')) or (c.status = 'verified' and app.has_role('sm_projects'))
     or (c.status = 'approved' and app.has_role('operations_exec'))
  union all
  select 'test_record', t.id, 'exec_test', format('Test record %s – %s', t.code, t.system), app.exec_head(t.exec_project_id) || ' · ' || t.result, t.performed_by,
         app.display_name(t.performed_by), t.performed_at, null::uuid, '/execution/' || t.exec_project_id || '?tab=qa', 'Verify'
  from public.test_records t where t.status = 'submitted' and app.has_role('senior_elec_engineer')
  union all
  select 'exec_request', r.id, 'exec_request', format('%s – %s', case r.kind when 'won' then 'Hand over to execution' else 'Project won before the system' end, r.name),
         concat_ws(' · ', r.client_name, r.note), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid, '/execution/handover/' || r.id, 'SM Projects'
  from public.exec_requests r where r.status = 'pending_smp' and app.has_role('sm_projects')
  union all
  select 'exec_programme', pg.exec_project_id, 'exec_programme', case when pg.version = 0 then 'Programme – ' else 'Revised programme – ' end || app.exec_head(pg.exec_project_id),
         concat_ws(' · ', 'finish ' || to_char(pg.forecast_finish, 'DD Mon YYYY'), pg.submit_note, case when (pg.billing_check ->> 'red')::int > 0 then format('%s invoice(s) %s would miss their month: %s', pg.billing_check ->> 'red', app.fmt_money((pg.billing_check ->> 'red_amount')::numeric, 'LKR'), pg.billing_note) end), pg.submitted_by, app.display_name(pg.submitted_by), pg.submitted_at, null::uuid,
         '/execution/' || pg.exec_project_id || '?tab=programme', 'SM Projects'
  from public.exec_programmes pg where pg.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'exec_boq', b.exec_project_id, 'exec_billing', case when b.version = 0 then 'Contract BOQ – ' else 'Revised contract BOQ – ' end || app.exec_head(b.exec_project_id),
         concat_ws(' · ', app.fmt_money(b.total, 'LKR'), b.submit_note), b.uploaded_by, app.display_name(b.uploaded_by), b.uploaded_at, null::uuid,
         '/execution/boq/' || b.exec_project_id, 'SM Projects'
  from public.exec_boqs b where b.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'programme_edit', pg.exec_project_id, 'exec_programme', 'Permission to edit the programme – ' || app.exec_head(pg.exec_project_id),
         pg.edit_reason, pg.edit_requested_by, app.display_name(pg.edit_requested_by), pg.edit_requested_at, null::uuid,
         '/execution/' || pg.exec_project_id || '?tab=programme', 'SM Projects'
  from public.exec_programmes pg where pg.edit_requested_at is not null and app.has_role('sm_projects')
  union all
  select 'scrap', x.id, 'scrap_disposal', format('Scrap disposal %s – %s', x.code, coalesce(app.exec_head(x.exec_project_id), x.location)),
         concat_ws(' · ', case x.method when 'sell' then 'Sell' || coalesce(' – ' || (select q.buyer || ' ' || app.fmt_money(q.amount_lkr, 'LKR') from public.scrap_quotes q where q.id = x.selected_quote_id), '')
                                         else 'Free of charge – ' || x.foc_to end, x.scrap_reason),
         x.requested_by, app.display_name(x.requested_by), coalesce(case when x.status = 'pending_dgm' then x.smp_at end, x.submitted_at), null::uuid,
         '/execution/scrap/' || x.id, case x.status when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.scrap_disposals x
  where (x.status = 'pending_smp' and app.has_role('sm_projects')) or (x.status = 'pending_dgm' and app.has_role('gm'))
  union all
  select 'drawings_off', r.id, 'drawings_off', 'Stop using smart drawings – ' || app.exec_head(r.exec_project_id), r.reason, r.requested_by,
         app.display_name(r.requested_by), r.requested_at, null::uuid, '/execution/start?id=' || r.exec_project_id, 'SM Projects'
  from public.exec_drawing_switches r
  where r.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'drawing_confirm', e.id, 'drawing_confirm', format('Confirm tested work on the drawings – %s (%s)', app.exec_head(e.id), x.n),
         'Marked Tested / Commissioned by a supervisor or trainee – it counts once confirmed', null::uuid, null::text, x.at, null::uuid,
         '/execution/' || e.id || '?tab=drawings', 'Assistant Engineer'
  from (select exec_project_id, count(*) n, max(updated_at) at from (
          select exec_project_id, updated_at from public.exec_drawing_items where not confirmed and status in ('tested', 'done')
          union all select exec_project_id, updated_at from public.exec_drawing_circuits where not confirmed and status = 'tested') u group by exec_project_id) x
  join public.exec_projects e on e.id = x.exec_project_id
  where app.drawing_can_edit(e.id) and (app.has_role('senior_elec_engineer') or app.is_project_ae(e.id))
$function$;

revoke execute on function public.drawing_confirm(uuid[], uuid[], boolean, text), public.drawing_template_save(uuid, text, jsonb, jsonb, boolean),
  public.drawing_template_delete(uuid, text) from public, anon;
grant execute on function public.drawing_confirm(uuid[], uuid[], boolean, text), public.drawing_template_save(uuid, text, jsonb, jsonb, boolean),
  public.drawing_template_delete(uuid, text) to authenticated;
