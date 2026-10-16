-- Smart drawings (testing), round D – links with the other modules:
--  * Who installed each item / route: DIMO or one of the project's subcontractors. The drawings give read-only reference
--    figures per installer (beside the measurement sheets – never filling any IPA / IPC) and DIMO's IPA lines show what the
--    drawings have done, with a warning when more is claimed.
--  * Circuit tests name the instrument; an uncalibrated one has to be confirmed and is flagged, as in the QA test records.
--    A DB's circuit tests can be sent to the QA test records (the usual verification / NCR flow).
--  * A 12th early-warning light for the smart drawings.

alter table public.exec_drawing_items add column if not exists installer text check (installer in ('dimo', 'sub'));
alter table public.exec_drawing_items add column if not exists installer_sub uuid references public.exec_subcontractors (id) on delete set null;
alter table public.exec_drawing_routes add column if not exists installer text check (installer in ('dimo', 'sub'));
alter table public.exec_drawing_routes add column if not exists installer_sub uuid references public.exec_subcontractors (id) on delete set null;
alter table public.exec_drawing_circuits add column if not exists instrument_id uuid references public.instruments (id);
alter table public.exec_drawing_circuits add column if not exists uncalibrated boolean not null default false;
alter table public.exec_drawing_circuits add column if not exists test_record_id uuid references public.test_records (id) on delete set null;

-- who installed: p_installer 'dimo' | 'sub' (with p_sub) | null (clear)
create or replace function public.drawing_set_installer(p_items uuid[], p_routes uuid[], p_installer text, p_sub uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare ex uuid; n int; m int;
begin
  select exec_project_id into ex from (select exec_project_id from public.exec_drawing_items where id = any (coalesce(p_items, '{}'))
                                        union all select exec_project_id from public.exec_drawing_routes where id = any (coalesce(p_routes, '{}'))) x limit 1;
  perform app.require(ex is not null, 'Choose the items');
  perform app.require(app.drawing_can_edit(ex), 'Only the execution team records who installed the work');
  perform app.require(p_installer is null or p_installer in ('dimo', 'sub'), 'DIMO or a subcontractor');
  perform app.require(p_installer is distinct from 'sub' or exists (select 1 from public.exec_subcontractors where id = p_sub and exec_project_id = ex), 'Choose a subcontractor of this project');
  update public.exec_drawing_items set installer = p_installer, installer_sub = case when p_installer = 'sub' then p_sub end, updated_at = now()
   where id = any (coalesce(p_items, '{}')) and exec_project_id = ex;
  get diagnostics n = row_count;
  update public.exec_drawing_routes set installer = p_installer, installer_sub = case when p_installer = 'sub' then p_sub end, updated_at = now()
   where id = any (coalesce(p_routes, '{}')) and exec_project_id = ex;
  get diagnostics m = row_count;
  return n + m;
end $$;

-- reference figures per installer: by BOQ line (or by type when not linked); nos for items, metres for routes
create or replace function public.drawing_installer_figures(p_exec uuid, p_installer text default null, p_sub uuid default null)
returns table (boq_item_id uuid, kind text, unit text, total numeric, installed numeric, tested numeric)
language sql stable security definer set search_path = public as $$
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
           case when app.drawing_weight(i.status) >= 0.75 then 1 else 0 end::numeric ins, case when i.status in ('tested', 'done') then 1 else 0 end::numeric tst
      from mine_i i
    union all
    select r.boq_item_id, case when r.boq_item_id is null then r.kind end, 'm', r.m, r.m * app.drawing_route_weight(r.kind, r.status, r.laid),
           case when r.status in ('tested', 'done') then r.m else 0 end
      from mine_r r) x
  where app.can_read_exec(p_exec)
  group by x.boq_item_id, x.kind, x.unit
$$;

-- copying a floor carries who installs it
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
    insert into public.exec_drawing_items (drawing_id, exec_project_id, kind, x, y, label, area, circuit, checks, boq_item_id, activity_id, installer, installer_sub, to_check, updated_by)
    select t.id, t.exec_project_id, i.kind, i.x, i.y,
           case when rf is null then i.label else replace(i.label, rf, rto) end, case when rf is null then i.area else replace(i.area, rf, rto) end,
           case when rf is null then i.circuit else replace(i.circuit, rf, rto) end,
           coalesce((select jsonb_object_agg(k, false) from jsonb_object_keys(i.checks) k), '{}'),
           case when links then i.boq_item_id end, case when links then i.activity_id end, i.installer, i.installer_sub, true, auth.uid()
      from public.exec_drawing_items i where i.drawing_id = s.id and i.kind <> 'riser';
    get diagnostics ni = row_count;
  end if;
  if coalesce((p ->> 'routes')::boolean, true) then
    insert into public.exec_drawing_routes (drawing_id, exec_project_id, kind, pts, label, area, cores, boq_item_id, activity_id, installer, installer_sub, to_check, updated_by)
    select t.id, t.exec_project_id, r.kind, r.pts, case when rf is null then r.label else replace(r.label, rf, rto) end, r.area, r.cores,
           case when links then r.boq_item_id end, case when links then r.activity_id end, r.installer, r.installer_sub, true, auth.uid()
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

-- circuit tests now name the instrument (same rules as the QA test records)
drop function if exists public.drawing_circuit_test(uuid, jsonb, text, text);
create or replace function public.drawing_circuit_test(p_id uuid, p_readings jsonb, p_status text, p_note text default null, p_instrument uuid default null, p_accept_uncalibrated boolean default false) returns void
language plpgsql security definer set search_path = public as $$
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
end $$;

-- a DB's circuit tests into the QA test records (verification, NCR on a failure – the usual flow)
create or replace function public.drawing_db_to_qa(p_item uuid, p_witness text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare it public.exec_drawing_items; rows jsonb := '[]'; c public.exec_drawing_circuits; ins uuid; tid uuid; unc boolean; d public.exec_drawings;
begin
  it := app.drawing_db_item(p_item);
  perform app.require(app.drawings_on(it.exec_project_id), 'Smart drawings are not used on this project');
  perform app.require(not exists (select 1 from public.exec_drawing_circuits where item_id = p_item and status = 'planned'), 'Test every circuit first');
  perform app.require(exists (select 1 from public.exec_drawing_circuits where item_id = p_item), 'The DB has no circuit schedule');
  -- the instrument most used – an uncalibrated one first, so the record carries the flag
  select instrument_id into ins from public.exec_drawing_circuits where item_id = p_item and instrument_id is not null
   group by instrument_id order by bool_or(uncalibrated) desc, count(*) desc limit 1;
  select bool_or(uncalibrated) into unc from public.exec_drawing_circuits where item_id = p_item;
  select * into d from public.exec_drawings where id = it.drawing_id;
  for c in select * from public.exec_drawing_circuits where item_id = p_item order by seq loop
    rows := rows || jsonb_build_array(jsonb_build_object('param', c.ref || ' insulation resistance', 'unit', 'MΩ', 'min', 1, 'value', coalesce(nullif(c.readings ->> 'ir', ''), '0')));
    rows := rows || jsonb_build_array(jsonb_build_object('param', c.ref || ' Zs', 'unit', 'Ω', 'max', c.zs_max, 'value', coalesce(nullif(c.readings ->> 'zs', ''), '0')));
    if coalesce(c.readings ->> 'rcd_ms', '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then
      rows := rows || jsonb_build_array(jsonb_build_object('param', c.ref || ' RCD trip time', 'unit', 'ms', 'max', 300, 'value', c.readings ->> 'rcd_ms'));
    end if;
  end loop;
  tid := public.record_test(it.exec_project_id, jsonb_build_object('area', concat_ws(' · ', d.floor, it.area), 'system', coalesce(it.label, 'DB'),
    'test_type', 'Circuit tests (IR, Zs, RCD) – from the smart drawings', 'instrument_id', ins, 'accept_uncalibrated', coalesce(unc, false), 'rows', rows,
    'witness', p_witness, 'note', format('%s circuits from %s', (select count(*) from public.exec_drawing_circuits where item_id = p_item), coalesce(d.sheet_no || ' ', '') || d.title)));
  update public.exec_drawing_circuits set test_record_id = tid where item_id = p_item;
  insert into public.exec_drawing_events (drawing_id, exec_project_id, item_id, what, note) values (it.drawing_id, it.exec_project_id, it.id, 'Sent to the QA test records', (select code from public.test_records where id = tid));
  return tid;
end $$;

-- the early-warning light (limit: more than this many failed = red)
create or replace function app.ew_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'slipRed', 14, 'slipAmber', 7, 'planRed', 60, 'planAmber', 80, 'fallWeeks', 3, 'blockRed', 3, 'blockAmber', 1,
    'leadSap', 7, 'leadLocal', 14, 'leadImport', 45, 'matAmber', 7,
    'billRed', 5000000, 'billAmber', 2000000, 'billAgeRed', 14,
    'varRed', 14, 'varAmber', 7, 'subRed', 10, 'subAmber', 5, 'repRed', 2,
    'snagAmber', 5, 'dlpRed', 30, 'hoRed', 70, 'hoAmber', 85, 'hoWeeks', 4, 'ambersForAmber', 2, 'dwgRed', 5)
$$;

create or replace function app.ew_project(p_exec uuid, l jsonb, today date DEFAULT ((now() AT TIME ZONE 'Asia/Colombo'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e public.exec_projects; pg public.exec_programmes; s jsonb := '[]'; base text := '/execution/' || p_exec;
  slip int; wk date := date_trunc('week', today)::date; weeks numeric[] := '{}'; w numeric; i int; falling int := 0;
  n int; m int; x numeric; y numeric; t text; r record; c text; reds int; ambers int; overall text; worst int;
  near int[] := '{}'; due_passed boolean;
begin
  select * into e from public.exec_projects where id = p_exec;
  select * into pg from public.exec_programmes where exec_project_id = p_exec and version > 0;

  -- 1 finish forecast
  if e.stage >= 3 then s := s || app.ew_sig('finish', 'na', 'Completed', 'Works are complete.');
  elsif pg.exec_project_id is null or pg.forecast_finish is null or pg.baseline_finish is null then
    s := s || app.ew_sig('finish', 'na', 'No programme', 'There is no approved programme yet.', base || '?tab=programme');
  else
    slip := pg.forecast_finish - pg.baseline_finish;
    s := s || app.ew_sig('finish', case when slip > (L ->> 'slipRed')::int then 'red' when slip > (L ->> 'slipAmber')::int then 'amber' else 'green' end,
      case when slip > 0 then '+' || slip || ' d' when slip < 0 then slip || ' d' else 'On time' end,
      case when slip > 0 then format('The programme now finishes %s, %s days after the baseline (%s).', app.ew_fmt(pg.forecast_finish), slip, app.ew_fmt(pg.baseline_finish))
           else format('Finish %s – on or ahead of the baseline (%s).', app.ew_fmt(pg.forecast_finish), app.ew_fmt(pg.baseline_finish)) end,
      base || '?tab=programme');
  end if;

  -- 2 plan vs done: last 4 full weeks
  for i in reverse 4..1 loop
    select count(*), sum(case pi.status when 'done' then 1 when 'partial' then 0.5 else 0 end) into n, x
      from public.exec_plan_items pi where pi.exec_project_id = p_exec and pi.day >= wk - 7 * i and pi.day < wk - 7 * (i - 1)
       and coalesce(pi.acceptance, '') <> 'rejected';
    if n > 0 then weeks := weeks || round(100 * x / n); end if;
  end loop;
  if e.stage >= 3 then s := s || app.ew_sig('plan', 'na', '—', 'Works are complete.');
  elsif cardinality(weeks) = 0 then s := s || app.ew_sig('plan', 'na', 'No plans', 'No weekly plan items in the last 4 weeks.', base || '?tab=plans');
  else
    w := weeks[cardinality(weeks)];
    i := cardinality(weeks);
    while i > 1 and weeks[i] < weeks[i - 1] loop falling := falling + 1; i := i - 1; end loop;
    s := s || (app.ew_sig('plan', case when w < (L ->> 'planRed')::int or falling >= (L ->> 'fallWeeks')::int then 'red' when w < (L ->> 'planAmber')::int then 'amber' else 'green' end,
      w || '%', format('%s%% of last week''s planned work was done (last weeks: %s%%).%s', w, array_to_string(weeks, '%, '),
        case when falling >= 2 then format(' Falling %s weeks in a row.', falling) else '' end), base || '?tab=plans') || jsonb_build_object('spark', to_jsonb(weeks)));
  end if;

  -- 3 critical path: critical activities late to start or finish
  select count(*), coalesce(max(greatest(case when a.actual_start is null then today - a.es else 0 end, case when a.actual_finish is null then today - a.ef else 0 end)), 0),
         string_agg(format('%s %s – %s%s', a.code, a.name,
           case when a.actual_start is null then format('should have started %s', app.ew_fmt(a.es)) else format('should have finished %s (%s%% done)', app.ew_fmt(a.ef), round(coalesce(a.pct, 0))) end,
           coalesce((select format(', waiting for %s', string_agg(mr.code, ', ')) from public.material_requests mr where mr.activity_id = a.id and mr.status in ('ae_review', 'submitted', 'pending_smp', 'approved', 'ordered', 'part_received')), '')), '; ' order by a.es)
    into n, worst, t
    from public.exec_activities a
   where a.exec_project_id = p_exec and a.critical and a.actual_finish is null
     and ((a.actual_start is null and a.es < today) or a.ef < today);
  if e.stage >= 3 then s := s || app.ew_sig('block', 'na', '—', 'Works are complete.');
  elsif pg.exec_project_id is null then s := s || app.ew_sig('block', 'na', '—', 'There is no approved programme yet.');
  elsif n = 0 then s := s || app.ew_sig('block', 'green', 'Clear', 'Every critical activity is on its dates.', base || '?tab=programme');
  else s := s || app.ew_sig('block', case when worst > (L ->> 'blockRed')::int then 'red' when worst > (L ->> 'blockAmber')::int then 'amber' else 'green' end,
      n || ' late · ' || worst || ' d', t || '.', base || '?tab=programme');
  end if;

  -- 4 materials: order by required date − usual delivery time (per route); ordered ones expected after the required date
  t := null; c := 'green'; n := 0;
  for r in
    select mr.id, mr.code, mr.required_date, mr.expected_date, mr.status, coalesce(mr.route, 'sap') route,
           coalesce((select string_agg(l.item, ', ') from (select item from public.material_request_lines where mr_id = mr.id limit 2) l), coalesce(mr.purpose, '')) item,
           mr.required_date - case coalesce(mr.route, 'sap') when 'import' then (L ->> 'leadImport')::int when 'local' then (L ->> 'leadLocal')::int else (L ->> 'leadSap')::int end order_by
      from public.material_requests mr
     where mr.exec_project_id = p_exec and mr.required_date is not null and mr.status in ('ae_review', 'submitted', 'pending_smp', 'approved', 'ordered', 'part_received')
     order by mr.required_date
  loop
    if r.status in ('ordered', 'part_received') then
      if r.expected_date is not null and r.expected_date > r.required_date then
        n := n + 1; c := 'red';
        t := concat_ws(' ', t, format('%s %s: expected %s, %s days after it is needed (%s).', r.code, r.item, app.ew_fmt(r.expected_date), r.expected_date - r.required_date, app.ew_fmt(r.required_date)));
      end if;
    elsif r.order_by < today then
      n := n + 1; c := 'red';
      t := concat_ws(' ', t, format('%s %s: needed %s, usual %s delivery – should have been ordered by %s (%s days ago).', r.code, r.item, app.ew_fmt(r.required_date), r.route, app.ew_fmt(r.order_by), today - r.order_by));
    elsif r.order_by - today < (L ->> 'matAmber')::int then
      n := n + 1; if c <> 'red' then c := 'amber'; end if;
      t := concat_ws(' ', t, format('%s %s: needed %s – order by %s (%s days left).', r.code, r.item, app.ew_fmt(r.required_date), app.ew_fmt(r.order_by), r.order_by - today));
    end if;
  end loop;
  s := s || (app.ew_sig('mat', c, case when n > 0 then n || ' at risk' else 'OK' end,
    coalesce(t, 'Every open site request is ordered in time for its required date.'), base || '?tab=materials') || jsonb_build_object('risk', n));

  -- 5 billing: lines ready to invoice, not invoiced
  select coalesce(sum(il.amount), 0), coalesce(max(today - (coalesce(tr.claimable_at, tr.ready_at) at time zone 'Asia/Colombo')::date), 0), count(*)
    into x, worst, n
    from public.exec_invoice_triggers tr join public.invoice_lines il on il.id = tr.line_id
   where tr.exec_project_id = p_exec and (tr.ready_at is not null or tr.claimable_at is not null)
     and not exists (select 1 from public.invoice_allocations a where a.line_id = tr.line_id);
  s := s || (app.ew_sig('bill',
    case when x > (L ->> 'billRed')::numeric or (n > 0 and worst >= (L ->> 'billAgeRed')::int) then 'red' when x > (L ->> 'billAmber')::numeric then 'amber' else 'green' end,
    case when x > 0 then app.ew_rs(x) else '—' end,
    case when n > 0 then format('%s of work is ready to invoice and not invoiced yet (%s line%s, oldest %s days).', app.ew_rs(x), n, case when n > 1 then 's' else '' end, worst)
         else 'Nothing waiting to be invoiced.' end, base || '?tab=billing') || jsonb_build_object('value', x));

  -- 6 variations not yet submitted to the client
  select count(*), coalesce(max(today - (v.raised_at at time zone 'Asia/Colombo')::date), 0), bool_or(v.client_due < today),
         string_agg(format('%s %s – raised %s days ago%s', v.code, v.title, today - (v.raised_at at time zone 'Asia/Colombo')::date,
           case when v.client_due < today then format(', client due date %s passed', app.ew_fmt(v.client_due)) else '' end), '; ' order by v.raised_at)
    into n, worst, due_passed, t
    from public.variations v
   where v.exec_project_id = p_exec and v.status in ('raised', 'pricing', 'pending_smp', 'pending_gm', 'approved') and v.client_submitted_on is null;
  if n = 0 then s := s || app.ew_sig('vari', 'green', 'None', 'No extra work waiting to be submitted to the client.', base || '?tab=variations');
  else s := s || app.ew_sig('vari', case when worst > (L ->> 'varRed')::int or coalesce(due_passed, false) then 'red' when worst > (L ->> 'varAmber')::int then 'amber' else 'green' end,
      n || ' · ' || worst || ' d', t || '.', base || '?tab=variations');
  end if;

  -- 7 subcontractor invoices against certified work
  select coalesce(sum(net), 0) into y from public.sub_certs where exec_project_id = p_exec and status in ('approved', 'paid');
  select coalesce(sum(amount), 0) into x from public.sub_invoices where exec_project_id = p_exec and status not in ('draft', 'cancelled', 'returned');
  if x = 0 and y = 0 then s := s || app.ew_sig('sub', 'na', '—', 'No subcontractor invoices or certificates yet.', base || '?tab=subcerts');
  else
    w := case when y = 0 then 100 else round(100 * (x - y) / y) end;
    s := s || app.ew_sig('sub', case when w > (L ->> 'subRed')::int then 'red' when w > (L ->> 'subAmber')::int then 'amber' else 'green' end,
      case when w > 0 then '+' || w || '%' else 'In line' end,
      format('Subcontractor invoices %s against certified work %s%s.', app.ew_rs(x), app.ew_rs(y), case when w > 0 then format(' – %s%% ahead', w) else '' end), base || '?tab=subcerts');
  end if;

  -- 8 HSE
  select count(*) into n from public.hse_actions ha join public.hse_reports hr on hr.id = ha.report_id
   where hr.exec_project_id = p_exec and ha.status = 'open' and ha.due_date < today;
  for i in reverse 3..0 loop
    near := near || (select count(*)::int from public.hse_reports where exec_project_id = p_exec and kind = 'near_miss'
                      and (reported_at at time zone 'Asia/Colombo')::date >= wk - 7 * i and (reported_at at time zone 'Asia/Colombo')::date < wk - 7 * (i - 1));
  end loop;
  select count(*) into m from public.exec_reports where exec_project_id = p_exec and report_date >= today - 7 and status <> 'draft' and not coalesce(toolbox_talk, false);
  select count(*) into i from public.hse_records where exec_project_id = p_exec and status = 'active' and ends_at is not null and ends_at < now() + interval '7 days';
  t := concat_ws(' ', case when n > 0 then n || ' corrective action(s) overdue.' end,
    case when near[4] > near[3] and near[3] >= near[2] and near[4] >= 2 then format('Near-misses rising (%s a week).', array_to_string(near, ' → ')) end,
    case when m > 0 then m || ' daily report(s) without a toolbox talk in the last 7 days.' end,
    case when i > 0 then i || ' permit(s) expiring within 7 days.' end);
  s := s || (app.ew_sig('hse', case when n > 0 or (near[4] > near[3] and near[3] >= near[2] and near[4] >= 2) then 'red' when m > 0 or i > 0 then 'amber' else 'green' end,
    case when coalesce(t, '') = '' then 'OK' else (n + m + i) || ' items' end,
    coalesce(nullif(t, ''), 'No overdue HSE actions; toolbox talks and permits in order.'), base || '?tab=hse') || jsonb_build_object('overdue', n, 'permits', i));

  -- 9 daily reports missing (last 7 days)
  select count(*) into n from public.exec_report_lateness where exec_project_id = p_exec and kind = 'missing' and report_date >= today - 7;
  if e.stage >= 3 then s := s || app.ew_sig('rep', 'na', '—', 'Works are complete.');
  else s := s || app.ew_sig('rep', case when n >= (L ->> 'repRed')::int then 'red' when n > 0 then 'amber' else 'green' end,
    case when n > 0 then n || ' missing' else 'All in' end,
    case when n > 0 then n || ' daily report(s) missing in the last 7 days.' else 'All daily reports in.' end, base || '?tab=reports');
  end if;

  -- 10 defects and snags
  select count(*) into n from public.snags where exec_project_id = p_exec and status = 'open';
  select count(*) filter (where severity = 'critical'), count(*) into m, i from public.project_defects
   where exec_project_id = p_exec and status in ('reported', 'open', 'assigned', 'rectified');
  select min(dlp_end_date) into pg.baseline_finish from public.bonds
   where exec_project_id = p_exec and dlp_end_date is not null and dlp_end_date >= today and status not in ('closed', 'returned', 'cancelled');
  -- (pg.baseline_finish now holds the end of the defects liability period)
  s := s || app.ew_sig('def',
    case when m > 0 or (pg.baseline_finish is not null and pg.baseline_finish - today <= (L ->> 'dlpRed')::int and n + i > 0) then 'red'
         when n + i > (L ->> 'snagAmber')::int then 'amber' else 'green' end,
    (n + i) || ' open' || case when m > 0 then ' · ' || m || ' critical' else '' end,
    concat_ws(' ', format('%s snag(s) and %s defect(s) open.', n, i), case when m > 0 then m || ' critical defect(s).' end,
      case when pg.baseline_finish is not null then format('Defects liability period ends %s (%s days).', app.ew_fmt(pg.baseline_finish), pg.baseline_finish - today) end),
    base || '?tab=qa');

  -- 11 handover readiness (handover checkpoint checks), from the set weeks before the forecast finish
  select * into pg from public.exec_programmes where exec_project_id = p_exec and version > 0;
  if e.stage <> 2 or pg.forecast_finish is null or pg.forecast_finish - today > 7 * (L ->> 'hoWeeks')::int then
    s := s || app.ew_sig('ho', 'na', '—', case when e.stage >= 3 then 'Handed over.' else 'Handover is not close yet.' end);
  else
    select count(*) filter (where (c2 ->> 'ok')::boolean), count(*), string_agg(c2 ->> 'check' || ' – ' || (c2 ->> 'detail'), '; ') filter (where not (c2 ->> 'ok')::boolean)
      into n, m, t from jsonb_array_elements(app.gate_checks(p_exec, 2)) c2;
    w := case when m = 0 then 0 else round(100.0 * n / m) end;
    s := s || app.ew_sig('ho', case when w < (L ->> 'hoRed')::int then 'red' when w < (L ->> 'hoAmber')::int then 'amber' else 'green' end, w || '%',
      format('Handover %s (in %s days): %s%% ready.%s', app.ew_fmt(pg.forecast_finish), pg.forecast_finish - today, w, coalesce(' Still open: ' || t || '.', '')), base || '?tab=handover');
  end if;

  -- 12 smart drawings (only on projects that use them): failed items / circuits, open HSE and clash pins, copies not checked
  if not coalesce(e.smart_drawings, false) then
    s := s || app.ew_sig('dwg', 'na', '—', 'Smart drawings are not used on this project.');
  else
    select count(*) filter (where i.status = 'failed'), count(*) filter (where i.to_check and i.updated_at < now() - interval '7 days')
      into n, m from public.exec_drawing_items i join public.exec_drawings d on d.id = i.drawing_id and not d.archived where i.exec_project_id = p_exec;
    select count(*) into i from public.exec_drawing_circuits ci join public.exec_drawings d on d.id = ci.drawing_id and not d.archived
     where ci.exec_project_id = p_exec and ci.status = 'failed';
    n := n + i;
    select count(*) filter (where kind = 'hse' and open), count(*) filter (where kind in ('clash', 'query') and open) into i, worst
      from (select pn.kind, case when pn.ref_type = 'hse_report' then h.status = 'open' when pn.ref_type = 'design_query' then q.status in ('raised', 'forwarded') else pn.status = 'open' end open
              from public.exec_drawing_pins pn join public.exec_drawings d on d.id = pn.drawing_id and not d.archived
              left join public.hse_reports h on pn.ref_type = 'hse_report' and h.id = pn.ref_id
              left join public.design_queries q on pn.ref_type = 'design_query' and q.id = pn.ref_id
             where pn.exec_project_id = p_exec) z;
    s := s || app.ew_sig('dwg',
      case when i > 0 or n > (L ->> 'dwgRed')::int then 'red' when n > 0 or worst > 0 or m > 0 then 'amber' else 'green' end,
      case when n + i + worst + m = 0 then 'Clear' else concat_ws(' · ', case when n > 0 then n || ' failed' end, case when i + worst > 0 then (i + worst) || ' issues' end, case when m > 0 then m || ' to check' end) end,
      concat_ws(' ', case when n > 0 then n || ' item(s) / circuit(s) failed their test.' end, case when i > 0 then i || ' open HSE issue(s) pinned on the drawings.' end,
        case when worst > 0 then worst || ' open clash(es) / design quer(ies) on the drawings.' end, case when m > 0 then m || ' copied item(s) not checked for over a week.' end,
        case when n + i + worst + m = 0 then 'Nothing failed or open on the drawings.' end),
      base || '?tab=drawings');
  end if;

  select count(*) filter (where x2 ->> 'c' = 'red'), count(*) filter (where x2 ->> 'c' = 'amber') into reds, ambers from jsonb_array_elements(s) x2;
  overall := case when reds > 0 then 'red' when ambers >= (L ->> 'ambersForAmber')::int then 'amber' else 'green' end;
  return jsonb_build_object('id', e.id, 'code', e.code, 'name', e.name, 'client', e.client_name, 'stage', e.stage, 'see_id', e.see_id,
    'overall', overall, 'reds', reds, 'ambers', ambers, 'signals', s);
end $function$;

-- instruments to choose for a test (subcontractor supervisors cannot read the register): those issued to the project first
create or replace function public.drawing_instruments(p_exec uuid) returns table (id uuid, code text, name text, serial_no text, calibrated boolean, cal_expiry date, here boolean)
language sql stable security definer set search_path = public as $$
  select i.id, i.code, i.name, i.serial_no, app.instrument_calibrated(i), i.cal_expiry,
         exists (select 1 from public.instrument_requests r where r.instrument_id = i.id and r.exec_project_id = p_exec and r.status = 'issued')
    from public.instruments i
   where not i.removed and i.kind = 'instrument' and i.condition = 'ok' and app.drawing_can_update(p_exec)
   order by 7 desc, i.name
$$;

revoke execute on function public.drawing_set_installer(uuid[], uuid[], text, uuid), public.drawing_installer_figures(uuid, text, uuid),
  public.drawing_circuit_test(uuid, jsonb, text, text, uuid, boolean), public.drawing_db_to_qa(uuid, text), public.drawing_instruments(uuid) from public, anon;
grant execute on function public.drawing_set_installer(uuid[], uuid[], text, uuid), public.drawing_installer_figures(uuid, text, uuid),
  public.drawing_circuit_test(uuid, jsonb, text, text, uuid, boolean), public.drawing_db_to_qa(uuid, text), public.drawing_instruments(uuid) to authenticated;
