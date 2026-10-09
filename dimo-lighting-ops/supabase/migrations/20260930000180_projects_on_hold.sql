-- Projects on hold in the finance lists.
--  * Secured project: Open → On hold (reason + review date) → Resume; set by Operations, SM Projects or GM / DGM. While on
--    hold its schedule / invoice reminders stop and its remaining value is shown apart ("on hold") instead of "to bill".
--    On the review date the sales person and Operations / SM Projects are reminded to resume, cancel or extend.
--  * Budget list line: Active / On hold / Dropped (with the reason) – shown apart in the budget totals.

alter table public.secured_projects drop constraint if exists secured_projects_status_check;
alter table public.secured_projects add constraint secured_projects_status_check check (status in ('open', 'on_hold', 'closed', 'cancelled'));
alter table public.secured_projects add column if not exists hold_reason text;
alter table public.secured_projects add column if not exists hold_review_date date;
alter table public.secured_projects add column if not exists hold_by uuid references public.profiles (id);
alter table public.secured_projects add column if not exists hold_at timestamptz;
alter table public.secured_projects add column if not exists hold_reminded date;

create or replace function public.hold_secured_project(p_secured uuid, p_hold boolean, p_reason text default null, p_review date default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.secured_projects; today date := (now() at time zone app.tz())::date;
begin
  perform app.require(app.has_role('sm_projects', 'gm', 'operations_exec'), 'Only Operations, SM Projects or GM / DGM put a project on hold');
  select * into s from public.secured_projects where id = p_secured for update;
  perform app.require(s.id is not null, 'Secured project not found');
  if p_hold then
    perform app.require(s.status in ('open', 'on_hold'), 'Only an open project can be put on hold');
    perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
    perform app.require(p_review is not null and p_review >= today, 'Choose the review date (today or later)');
    update public.secured_projects set status = 'on_hold', hold_reason = btrim(p_reason), hold_review_date = p_review, hold_by = auth.uid(), hold_at = now(),
      hold_reminded = null, updated_at = now() where id = s.id;
    insert into public.secured_log (secured_id, action, note) values (s.id, 'on_hold', format('%s · review %s', btrim(p_reason), to_char(p_review, 'DD Mon YYYY')));
  else
    perform app.require(s.status = 'on_hold', 'The project is not on hold');
    update public.secured_projects set status = 'open', hold_review_date = null, hold_reminded = null, updated_at = now() where id = s.id;
    insert into public.secured_log (secured_id, action, note) values (s.id, 'resumed', nullif(btrim(p_reason), ''));
  end if;
  perform app.notify(s.sales_person_id, 'secured_hold', case when p_hold then 'Project put on hold' else 'Project resumed' end,
    format('%s%s', s.project_name, case when p_hold then format(' · %s · review %s', btrim(p_reason), to_char(p_review, 'DD Mon YYYY')) else '' end),
    'normal', 'secured_project', s.id, app.secured_url(s.id));
end $$;

-- On the review date: resume, cancel or extend the hold
create or replace function public.hold_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; s public.secured_projects; n int := 0;
begin
  for s in select * from public.secured_projects where status = 'on_hold' and hold_review_date <= today and hold_reminded is distinct from hold_review_date loop
    perform app.notify_many(array[s.sales_person_id] || app.role_users('operations_exec') || app.role_users('sm_projects'), 'secured_hold',
      'On-hold project to review', format('%s · on hold since %s · %s · resume, cancel or extend the hold', s.project_name, to_char(s.hold_at at time zone app.tz(), 'DD Mon YYYY'),
        coalesce(s.hold_reason, '')), 'normal', 'secured_project', s.id, app.secured_url(s.id));
    update public.secured_projects set hold_reminded = s.hold_review_date where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.hold_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.hold_tick(timestamptz) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('hold-tick', '20 3 * * *', 'select public.hold_tick()');
  end if;
end $$;

-- Budget list line status
alter table public.budget_projects add column if not exists status text not null default 'active';
alter table public.budget_projects drop constraint if exists budget_projects_status_check;
alter table public.budget_projects add constraint budget_projects_status_check check (status in ('active', 'on_hold', 'dropped'));
alter table public.budget_projects add column if not exists status_reason text;
alter table public.budget_projects add column if not exists status_by uuid references public.profiles (id);
alter table public.budget_projects add column if not exists status_at timestamptz;

create or replace function public.set_budget_status(p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.budget_projects;
begin
  perform app.require(app.has_role('sm_projects', 'gm', 'operations_exec'), 'Only Operations, SM Projects or GM / DGM change the budget line status');
  perform app.require(p_status in ('active', 'on_hold', 'dropped'), 'Invalid status');
  perform app.require(p_status = 'active' or coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select * into b from public.budget_projects where id = p_id for update;
  perform app.require(b.id is not null, 'Not found');
  update public.budget_projects set status = p_status, status_reason = case when p_status = 'active' then null else btrim(p_reason) end,
    status_by = auth.uid(), status_at = now() where id = b.id;
  if b.sales_person_id is not null and b.sales_person_id <> auth.uid() then
    perform app.notify(b.sales_person_id, 'budget_status', format('Budgeted project %s', case p_status when 'on_hold' then 'on hold' when 'dropped' then 'dropped' else 'active again' end),
      format('%s%s', b.project_name, coalesce(' · ' || nullif(btrim(p_reason), ''), '')), 'normal', null, null, '/finance/budget');
  end if;
end $$;


create or replace function public.finance_performance(p_fy int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  all_people boolean := app.has_role('gm', 'sm_projects', 'sm_estimation', 'operations_exec');
  fs date := app.fy_start(p_fy);
  fe date := app.fy_end(p_fy);
  latest date;
  people jsonb;
begin
  perform app.require(all_people or app.has_role('asm_building', 'asm_infra'), 'Not available for your role');
  -- Invoices are recorded in the app: invoiced is known up to the current month (the whole year for a past year)
  latest := case when app.month_of((now() at time zone app.tz())::date) > fe then app.month_of(fe)
                 when app.month_of((now() at time zone app.tz())::date) < fs then null
                 else app.month_of((now() at time zone app.tz())::date) end;
  with persons as (
    select distinct x.pid from (
      select sales_person_id as pid from public.sales_targets where fy = p_fy
      union select sales_person_id from public.secured_projects where status <> 'cancelled'
      union select sales_person_id from public.budget_projects where fy = p_fy
    ) x where x.pid is not null and (all_people or x.pid = auth.uid())
  ), months as (
    select generate_series(fs, fs + interval '11 months', interval '1 month')::date as month
  ), credit as (
    -- Secured: this-year part of each project won (sales) or marked secured (Operations) this year, in the month it was won,
    -- counted at once. With an invoice schedule (draft or approved) = its invoices due this year; without one yet = the
    -- order value not invoiced before (taken as all due this year until the schedule is entered).
    select s.sales_person_id as pid, app.month_of(s.won_on) as month,
           sum(case when exists (select 1 from public.invoice_lines l where l.secured_id = s.id)
                    then (select coalesce(sum(l.amount), 0) from public.invoice_lines l where l.secured_id = s.id and l.original_month between fs and fe)
                    else greatest(coalesce(s.order_value, 0) - s.billed_before, 0) end) as amt
      from public.secured_projects s
     where s.source = 'won' and s.status <> 'cancelled' and s.won_on between fs and fe
     group by 1, 2
  ), pending as (
    select s.sales_person_id as pid, count(*) as n, sum(s.order_value) as amt
      from public.secured_projects s
     where s.source = 'won' and s.schedule_status <> 'approved' and s.status = 'open' and s.won_on between fs and fe
     group by 1
  ), inv as (
    select s.sales_person_id as pid, a.month, sum(a.amount) as amt
      from public.invoice_allocations a join public.secured_projects s on s.id = a.secured_id
     where a.month between fs and fe group by 1, 2
  ), onhold as (
    select v.sales_person_id as pid, sum(greatest(v.remaining, 0)) as amt, count(distinct v.secured_id) as n
      from public.invoice_line_status v
     where v.project_status = 'on_hold' and v.remaining > 0 group by 1
  ), tobill as (
    select v.sales_person_id as pid, sum(greatest(v.remaining, 0)) as amt
      from public.invoice_line_status v
     where v.project_status = 'open' and v.forecast_month <= fe and v.remaining > 0 group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.pid, 'name', app.display_name(p.pid), 'role', (select role from public.profiles where id = p.pid),
      'lines', (select coalesce(jsonb_agg(distinct b.business_line), '[]') from public.budget_projects b where b.fy = p_fy and b.sales_person_id = p.pid),
      'to_bill_fy', coalesce((select amt from tobill where tobill.pid = p.pid), 0),
      'on_hold_value', coalesce((select amt from onhold where onhold.pid = p.pid), 0),
      'on_hold_n', coalesce((select n from onhold where onhold.pid = p.pid), 0),
      'pending_n', coalesce((select n from pending where pending.pid = p.pid), 0),
      'pending_value', coalesce((select amt from pending where pending.pid = p.pid), 0),
      'months', (select jsonb_agg(jsonb_build_object('month', m.month,
          'secured_target', coalesce((select secured_target from public.sales_targets t where t.fy = p_fy and t.sales_person_id = p.pid and t.month = m.month), 0),
          'invoice_target', coalesce((select invoice_target from public.sales_targets t where t.fy = p_fy and t.sales_person_id = p.pid and t.month = m.month), 0),
          'secured', coalesce((select sum(amt) from credit c where c.pid = p.pid and c.month = m.month), 0),
          'invoiced', coalesce((select sum(amt) from inv i where i.pid = p.pid and i.month = m.month), 0)) order by m.month) from months m)
    ) order by app.display_name(p.pid)), '[]') into people
    from persons p;
  return jsonb_build_object('fy', p_fy, 'latest_month', latest, 'people', people,
    'targets_status', (select status from public.target_sets where fy = p_fy),
    'unlinked_invoiced', null::numeric);
end $$;

create or replace function public.close_secured_project(p_secured uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.secured_projects;
begin
  perform app.require(app.has_role('sm_projects', 'gm', 'operations_exec'), 'Only Operations, SM Projects or GM / DGM close a secured project');
  perform app.require(p_status in ('closed', 'cancelled', 'open'), 'Invalid status');
  perform app.require(p_status = 'open' or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  select * into s from public.secured_projects where id = p_secured for update;
  perform app.require(s.id is not null, 'Secured project not found');
  update public.secured_projects set status = p_status, hold_review_date = case when p_status = 'open' then null else hold_review_date end, updated_at = now() where id = s.id;
  insert into public.secured_log (secured_id, action, note) values (s.id, p_status, p_note);
end $$;

create or replace function public.save_budget_list(p_fy int, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  chk jsonb := public.check_budget_list(p_fy, p_rows);
  r jsonb;
  c jsonb;
  bid uuid;
  n int := 0;
  x jsonb;
  keep jsonb;
begin
  perform app.require(not exists (select 1 from jsonb_array_elements(chk) e where jsonb_array_length(e -> 'errors') > 0),
    'Some rows have errors – fix them in the file and upload again');
  -- the on-hold / dropped status of a line survives re-uploading the list (same project name and WBS)
  select jsonb_object_agg(lower(btrim(project_name)) || '|' || coalesce(wbs, ''), jsonb_build_object('s', status, 'r', status_reason, 'b', status_by, 'a', status_at))
    into keep from public.budget_projects where fy = p_fy and status <> 'active';
  delete from public.budget_projects where fy = p_fy;
  for r, c in select a.value, b.value from jsonb_array_elements(p_rows) with ordinality a(value, i)
                join jsonb_array_elements(chk) with ordinality b(value, j) on a.i = b.j loop
    insert into public.budget_projects (fy, row_no, business_line, project_id, project_name, customer, sales_person_id, wbs,
      budget_value, budget_gp_pct, budget_gp_value, order_month, notes)
    values (p_fy, (r ->> 'row_no')::int, c ->> 'business_line', (c ->> 'project_id')::uuid, btrim(r ->> 'project_name'),
      nullif(btrim(r ->> 'customer'), ''), (c ->> 'sales_person_id')::uuid, app.wbs_base(nullif(r ->> 'wbs', '')),
      app.to_num(r ->> 'budget_value'),
      coalesce(app.budget_gp(r ->> 'budget_gp_pct', app.to_num(r ->> 'budget_value')),
               round(app.to_num(r ->> 'budget_gp_value') / nullif(app.to_num(r ->> 'budget_value'), 0) * 100, 2)),
      coalesce(round(app.to_num(r ->> 'budget_gp_value'), 2),
               round(app.to_num(r ->> 'budget_value') * app.budget_gp(r ->> 'budget_gp_pct', app.to_num(r ->> 'budget_value')) / 100, 2)),
      app.month_of(nullif(r ->> 'order_month', '')::date), nullif(btrim(r ->> 'notes'), ''))
    returning id into bid;
    for x in select * from jsonb_array_elements(coalesce(r -> 'invoices', '[]')) loop
      insert into public.budget_invoices (budget_id, month, amount) values (bid, app.month_of((x ->> 'month')::date), (x ->> 'amount')::numeric);
    end loop;
    n := n + 1;
  end loop;
  update public.budget_projects b set status = keep -> (lower(btrim(b.project_name)) || '|' || coalesce(b.wbs, '')) ->> 's',
         status_reason = keep -> (lower(btrim(b.project_name)) || '|' || coalesce(b.wbs, '')) ->> 'r',
         status_by = (keep -> (lower(btrim(b.project_name)) || '|' || coalesce(b.wbs, '')) ->> 'b')::uuid,
         status_at = (keep -> (lower(btrim(b.project_name)) || '|' || coalesce(b.wbs, '')) ->> 'a')::timestamptz
   where b.fy = p_fy and keep ? (lower(btrim(b.project_name)) || '|' || coalesce(b.wbs, ''));
  -- Re-link secured projects of the year to their budget line
  update public.secured_projects s set budget_id = b.id
    from public.budget_projects b
   where b.fy = p_fy and s.budget_id is null and app.fy_of(s.won_on) >= p_fy - 1
     and ((b.project_id is not null and b.project_id = s.project_id) or (b.wbs is not null and b.wbs = app.wbs_base(s.wbs)));
  return n;
end $$;

revoke execute on function public.hold_secured_project(uuid, boolean, text, date), public.set_budget_status(uuid, text, text) from public, anon;
grant execute on function public.hold_secured_project(uuid, boolean, text, date), public.set_budget_status(uuid, text, text) to authenticated, service_role;
