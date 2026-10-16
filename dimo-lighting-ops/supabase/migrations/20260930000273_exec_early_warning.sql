-- Execution early warning: one row per live execution project with 11 lights (red / amber / green, or n/a), each with a
-- plain reason and a link to where it is fixed; the project is red when any light is red, amber when enough lights are
-- amber. Calculated from what the app already records – nothing new to enter.
--  1 Finish forecast   approved programme: forecast finish against the baseline finish
--  2 Plan vs done      weekly plan items done (partly done = half) in each of the last 4 full weeks; red when low or falling
--  3 Critical path     critical activities not started / not finished by their planned dates; the open site request that
--                      holds them, if any
--  4 Materials         site requests not ordered by "required date − usual delivery time" (per route: SAP, local, import),
--                      and ordered ones expected after the required date
--  5 Billing           invoice lines ready to invoice (checkpoint passed / work done) but not invoiced yet – value and age
--  6 Variations        extra work raised but not yet submitted to the client – age; past the client due date is red
--  7 Subcontractor     subcontractor invoices against the work certified (joint measurement / IPC) – % ahead
--  8 HSE               overdue corrective actions, rising near-misses, toolbox talks missed, permits expiring this week
--  9 Daily reports     reports missing in the last 7 days
-- 10 Defects           open snags and project defects, critical ones, and the end of the defects liability period
-- 11 Handover          readiness % of the handover checkpoint checks, from the set number of weeks before the forecast finish
-- Seen by SM Projects, GM / DGM and sys admin (all projects), the SEE (own projects) and the project team (read only).
-- SM Projects sets the limits. Alerts: an immediate alert when a project turns red, and a Monday 08:00 summary.

create table if not exists public.exec_ew_settings (
  id boolean primary key default true check (id),
  limits jsonb not null default '{}',
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
insert into public.exec_ew_settings (id) values (true) on conflict do nothing;
alter table public.exec_ew_settings enable row level security;
drop policy if exists exec_ew_settings_read on public.exec_ew_settings;
create policy exec_ew_settings_read on public.exec_ew_settings for select to authenticated using (true);
grant select on public.exec_ew_settings to authenticated;

-- last overall status per project (for the "turned red" alert)
create table if not exists public.exec_ew_state (
  exec_project_id uuid primary key references public.exec_projects (id) on delete cascade,
  overall text not null,
  reds text[] not null default '{}',
  changed_at timestamptz not null default now()
);
alter table public.exec_ew_state enable row level security;

create or replace function app.ew_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'slipRed', 14, 'slipAmber', 7, 'planRed', 60, 'planAmber', 80, 'fallWeeks', 3, 'blockRed', 3, 'blockAmber', 1,
    'leadSap', 7, 'leadLocal', 14, 'leadImport', 45, 'matAmber', 7,
    'billRed', 5000000, 'billAmber', 2000000, 'billAgeRed', 14,
    'varRed', 14, 'varAmber', 7, 'subRed', 10, 'subAmber', 5, 'repRed', 2,
    'snagAmber', 5, 'dlpRed', 30, 'hoRed', 70, 'hoAmber', 85, 'hoWeeks', 4, 'ambersForAmber', 2)
$$;

create or replace function app.ew_limits() returns jsonb language sql stable security definer set search_path = public as $$
  select app.ew_defaults() || coalesce((select limits from public.exec_ew_settings where id), '{}')
$$;

create or replace function app.ew_fmt(d date) returns text language sql immutable as $$ select to_char(d, 'DD Mon') $$;
create or replace function app.ew_rs(n numeric) returns text language sql immutable as $$
  select case when n >= 1000000 then 'Rs ' || to_char(n / 1000000.0, 'FM9990.0') || ' M' else 'Rs ' || to_char(round(n / 1000.0), 'FM999990') || ' k' end
$$;
create or replace function app.ew_sig(k text, c text, v text, why text, link text default null) returns jsonb language sql immutable as $$
  select jsonb_build_object('k', k, 'c', c, 'v', v, 'why', why, 'link', link)
$$;

/** The 11 lights of one execution project */
create or replace function app.ew_project(p_exec uuid, L jsonb, today date default (now() at time zone 'Asia/Colombo')::date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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

  select count(*) filter (where x2 ->> 'c' = 'red'), count(*) filter (where x2 ->> 'c' = 'amber') into reds, ambers from jsonb_array_elements(s) x2;
  overall := case when reds > 0 then 'red' when ambers >= (L ->> 'ambersForAmber')::int then 'amber' else 'green' end;
  return jsonb_build_object('id', e.id, 'code', e.code, 'name', e.name, 'client', e.client_name, 'stage', e.stage, 'see_id', e.see_id,
    'overall', overall, 'reds', reds, 'ambers', ambers, 'signals', s);
end $$;

/** The dashboard: limits and every live project the caller may see, worst first */
create or replace function public.exec_early_warning() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare L jsonb := app.ew_limits(); all_p boolean := app.has_role('sm_projects', 'gm', 'sys_admin');
begin
  perform app.require(all_p or app.has_role('senior_elec_engineer', 'assistant_engineer'), 'The early warning is for the execution leads');
  return jsonb_build_object('limits', L, 'defaults', app.ew_defaults(), 'can_edit', app.has_role('sm_projects', 'sys_admin'),
    'today', (now() at time zone 'Asia/Colombo')::date,
    'projects', coalesce((select jsonb_agg(p order by case p ->> 'overall' when 'red' then 0 when 'amber' then 1 else 2 end, (p ->> 'reds')::int desc, (p ->> 'ambers')::int desc, p ->> 'code')
      from (select app.ew_project(e.id, L) p from public.exec_projects e
             where e.status = 'active' and not coalesce(e.legacy, false)
               and (all_p or e.see_id = auth.uid() or app.is_exec_member(e.id))) q), '[]'));
end $$;
revoke all on function public.exec_early_warning() from public, anon;
grant execute on function public.exec_early_warning() to authenticated;

/** SM Projects: save the limits (only known keys, whole numbers ≥ 0) */
create or replace function public.exec_ew_set_limits(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; clean jsonb := '{}';
begin
  perform app.require(app.has_role('sm_projects', 'sys_admin'), 'Only SM Projects sets the early warning limits');
  for k, v in select * from jsonb_each(coalesce(p, '{}')) loop
    perform app.require(app.ew_defaults() ? k, 'Unknown limit ' || k);
    perform app.require(jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric >= 0, 'Limits are numbers of 0 or more');
    clean := clean || jsonb_build_object(k, round((v #>> '{}')::numeric));
  end loop;
  update public.exec_ew_settings set limits = clean, updated_by = auth.uid(), updated_at = now() where id;
end $$;
revoke all on function public.exec_ew_set_limits(jsonb) from public, anon;
grant execute on function public.exec_ew_set_limits(jsonb) to authenticated;

/** Daily: alert when a project turns red; Mondays also the summary to each SEE (own projects) and SM Projects (all) */
create or replace function public.exec_ew_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare L jsonb := app.ew_limits(); today date := (p_at at time zone 'Asia/Colombo')::date; r record; p jsonb; prev public.exec_ew_state;
  reds text[]; why text; n int := 0; lines text; who uuid; reds_n int; amb_n int;
begin
  create temp table if not exists _ew (exec_project_id uuid, see_id uuid, code text, name text, overall text, line text) on commit drop;
  truncate _ew;
  for r in select e.id from public.exec_projects e where e.status = 'active' and not coalesce(e.legacy, false) loop
    p := app.ew_project(r.id, L, today);
    reds := array(select x ->> 'k' from jsonb_array_elements(p -> 'signals') x where x ->> 'c' = 'red');
    why := (select string_agg(x ->> 'why', ' ') from jsonb_array_elements(p -> 'signals') x where x ->> 'c' in ('red', 'amber'));
    insert into _ew values (r.id, (p ->> 'see_id')::uuid, p ->> 'code', p ->> 'name', p ->> 'overall',
      format('%s %s – %s: %s', case p ->> 'overall' when 'red' then '🔴' else '🟠' end, p ->> 'code', p ->> 'name', left(coalesce(why, ''), 400)));
    select * into prev from public.exec_ew_state where exec_project_id = r.id;
    if p ->> 'overall' = 'red' and (prev.exec_project_id is null or prev.overall <> 'red') then
      perform app.notify_many(array_remove(array[(p ->> 'see_id')::uuid] || app.role_users('sm_projects'), null), 'exec_early_warning',
        'Project turned red: ' || (p ->> 'code'), left(coalesce(why, ''), 600), 'critical', 'exec_project', r.id, '/execution/early-warning');
      n := n + 1;
    end if;
    insert into public.exec_ew_state (exec_project_id, overall, reds, changed_at) values (r.id, p ->> 'overall', reds, p_at)
      on conflict (exec_project_id) do update set overall = excluded.overall, reds = excluded.reds,
        changed_at = case when exec_ew_state.overall <> excluded.overall then p_at else exec_ew_state.changed_at end;
  end loop;
  if extract(isodow from p_at at time zone 'Asia/Colombo') = 1 then
    -- each SEE: own red / amber projects
    for who in select distinct see_id from _ew where see_id is not null and overall <> 'green' loop
      select string_agg(line, E'\n' order by overall desc, code), count(*) filter (where overall = 'red'), count(*) filter (where overall = 'amber')
        into lines, reds_n, amb_n from _ew where see_id = who and overall <> 'green';
      perform app.notify(who, 'exec_early_warning', format('Early warning – %s at risk, %s to watch', reds_n, amb_n), lines, 'normal', null, null, '/execution/early-warning');
      n := n + 1;
    end loop;
    -- SM Projects: all
    select string_agg(line, E'\n' order by overall desc, code), count(*) filter (where overall = 'red'), count(*) filter (where overall = 'amber')
      into lines, reds_n, amb_n from _ew where overall <> 'green';
    if lines is not null then
      perform app.notify_many(app.role_users('sm_projects'), 'exec_early_warning', format('Early warning – %s at risk, %s to watch', reds_n, amb_n),
        lines, 'normal', null, null, '/execution/early-warning');
      n := n + 1;
    end if;
  end if;
  return n;
end $$;
revoke execute on function public.exec_ew_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.exec_ew_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('exec-ew-tick', '30 2 * * *', 'select public.exec_ew_tick()');   -- 08:00 Sri Lanka time
  end if;
end $$;

select app.fix_function_owners();
