-- Invoicing plan → execution
--  * The execution project is linked to its secured project (automatically through the sales project; projects won
--    before the system are linked by SM Projects / Operations).
--  * The SEE sets the trigger of each invoice line: a stage gate, a programme activity / milestone, materials delivered to
--    site (material requests fully received and acknowledged), a monthly progress claim (IPC) or manual. SM Projects approves the triggers with the programme baseline.
--  * Trigger met → "Ready to invoice" to Operations (and SM Projects) with the evidence; Operations raises the invoice as today.
--  * A linked activity forecast slipping past the invoice month → a date change is proposed to SM Projects (existing
--    invoice-date approval) with the programme as the reason; the sales person is told.
--  * Monthly check by the SEE in the last week of the month: next month's lines on track / ready / slipping.
--  * Progress claims: the AE prepares the measurement (% only), the SEE records the client-certified amount → ready.
--  * Money stays with the SEE, SM Projects, GM / DGM and Operations; AEs never see amounts.

alter table public.exec_projects add column if not exists secured_id uuid references public.secured_projects (id) on delete set null;
update public.exec_projects e set secured_id = s.id from public.secured_projects s where s.project_id = e.project_id and e.secured_id is null;

-- The SEE reads the secured projects of execution projects (invoice lines and allocations follow through their policies)
create or replace function app.is_exec_secured(p_secured uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer') and exists (select 1 from public.exec_projects where secured_id = p_secured)
$$;
create policy secured_read_exec on public.secured_projects for select to authenticated using (app.is_exec_secured(id));

create or replace function app.sees_billing() returns boolean language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec')
$$;

create table public.exec_invoice_triggers (
  line_id uuid primary key references public.invoice_lines (id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  kind text not null check (kind in ('gate', 'activity', 'delivery', 'ipc', 'manual')),
  gate int check (gate between 1 and 6),
  activity_id uuid references public.exec_activities (id) on delete set null,
  mr_ids uuid[],                                   -- delivery: the material requests that must be fully received
  approved boolean not null default false,
  set_by uuid default auth.uid() references public.profiles (id),
  set_at timestamptz not null default now(),
  ready_at timestamptz,
  ready_note text,
  check (kind <> 'gate' or gate is not null),
  check (kind <> 'activity' or activity_id is not null),
  check (kind <> 'delivery' or cardinality(mr_ids) > 0)
);
create table public.exec_invoice_checks (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.invoice_lines (id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  check_month date not null,
  status text not null check (status in ('on_track', 'ready', 'slipping')),
  to_month date,
  note text,
  by_id uuid default auth.uid() references public.profiles (id),
  at timestamptz not null default now()
);
create table public.exec_ipcs (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  line_id uuid references public.invoice_lines (id) on delete set null,
  period date not null,                      -- month of the claim
  measured_pct numeric(5, 2) not null check (measured_pct between 0 and 100),
  measurement text,
  prepared_by uuid not null default auth.uid() references public.profiles (id),
  prepared_at timestamptz not null default now(),
  status text not null default 'prepared' check (status in ('prepared', 'certified', 'returned')),
  certified_value numeric(16, 2),
  certified_at timestamptz,
  certified_by uuid references public.profiles (id),
  note text
);
alter table public.exec_invoice_triggers enable row level security;
alter table public.exec_invoice_checks enable row level security;
alter table public.exec_ipcs enable row level security;
create policy exec_invoice_triggers_read on public.exec_invoice_triggers for select to authenticated using (app.sees_billing());
create policy exec_invoice_checks_read on public.exec_invoice_checks for select to authenticated using (app.sees_billing());
-- An AE sees the measurement he prepared only until it is certified (the certified amount is money)
create policy exec_ipcs_read on public.exec_ipcs for select to authenticated
  using (app.sees_billing() or (prepared_by = auth.uid() and status in ('prepared', 'returned')));
grant select on public.exec_invoice_triggers, public.exec_invoice_checks, public.exec_ipcs to authenticated;

create or replace function app.line_open(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select l.amount - coalesce((select sum(amount) from public.invoice_allocations where line_id = l.id), 0) from public.invoice_lines l where l.id = p_line
$$;

-- Link (SM Projects / Operations) – for projects won before the system, or to correct the link
create or replace function public.link_secured_project(p_exec uuid, p_secured uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('sm_projects', 'operations_exec'), 'SM Projects or Operations link the secured project');
  perform app.require(p_secured is null or exists (select 1 from public.secured_projects where id = p_secured), 'Secured project not found');
  perform app.require(p_secured is null or not exists (select 1 from public.exec_projects where secured_id = p_secured and id <> p_exec),
    'That secured project is already linked to another execution project');
  update public.exec_projects set secured_id = p_secured, updated_at = now() where id = p_exec;
  delete from public.exec_invoice_triggers where exec_project_id = p_exec
    and (p_secured is null or line_id not in (select id from public.invoice_lines where secured_id = p_secured));
end $$;

-- SEE sets the trigger of an invoice line (approval resets; SM Projects approves with the programme)
create or replace function public.set_invoice_trigger(p_exec uuid, p_line uuid, p_kind text, p_gate int default null, p_activity uuid default null,
                                                      p_mrs uuid[] default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer sets the invoice triggers');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(e.secured_id is not null and exists (select 1 from public.invoice_lines where id = p_line and secured_id = e.secured_id), 'Invoice line of another project');
  perform app.require(p_kind in ('gate', 'activity', 'delivery', 'ipc', 'manual'), 'Choose the trigger');
  perform app.require(p_kind <> 'gate' or p_gate between 1 and 6, 'Choose the stage gate');
  perform app.require(p_kind <> 'activity' or exists (select 1 from public.exec_activities where id = p_activity and exec_project_id = p_exec), 'Choose a programme activity');
  perform app.require(p_kind <> 'delivery' or (cardinality(p_mrs) > 0 and not exists (select 1 from unnest(p_mrs) x where not exists (
    select 1 from public.material_requests m where m.id = x and m.exec_project_id = p_exec and m.status not in ('rejected', 'cancelled')))),
    'Choose the material requests of this project');
  insert into public.exec_invoice_triggers (line_id, exec_project_id, kind, gate, activity_id, mr_ids)
  values (p_line, p_exec, p_kind, case when p_kind = 'gate' then p_gate end, case when p_kind = 'activity' then p_activity end,
          case when p_kind = 'delivery' then p_mrs end)
  on conflict (line_id) do update set kind = excluded.kind, gate = excluded.gate, activity_id = excluded.activity_id, mr_ids = excluded.mr_ids, approved = false,
    set_by = auth.uid(), set_at = now()
  where exec_invoice_triggers.ready_at is null;
  perform app.require(found, 'This invoice is already marked ready – the trigger cannot change');
  -- After the baseline the change waits for SM Projects (once a day per project)
  if exists (select 1 from public.exec_programmes where exec_project_id = p_exec and version > 0) then
    perform app.notify_many(app.role_users('sm_projects'), 'exec_billing', 'Invoice triggers to approve', app.exec_head(p_exec), 'normal', 'exec_project', p_exec,
      '/execution/' || p_exec || '?tab=billing', format('billtrig:%s:%s', p_exec, (now() at time zone app.tz())::date), true);
  end if;
  perform app.check_invoice_triggers(p_exec);
end $$;

-- Mark a line ready and tell Operations (once)
create or replace function app.mark_invoice_ready(p_line uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.exec_invoice_triggers; l public.invoice_lines; s public.secured_projects;
begin
  select * into t from public.exec_invoice_triggers where line_id = p_line for update;
  if t.line_id is null or t.ready_at is not null or app.line_open(p_line) <= 0 then return; end if;
  select * into l from public.invoice_lines where id = p_line;
  select * into s from public.secured_projects where id = l.secured_id;
  update public.exec_invoice_triggers set ready_at = now(), ready_note = p_note where line_id = p_line;
  insert into public.secured_log (secured_id, action, note) values (s.id, 'ready_to_invoice', concat_ws(' · ', coalesce(l.description, initcap(l.kind)), p_note));
  perform app.notify_many(app.role_users('operations_exec', 'sm_projects') || array[s.sales_person_id], 'invoice_ready', 'Ready to invoice – ' || s.project_name,
    concat_ws(' · ', coalesce(l.description, initcap(l.kind)), app.fmt_money(app.line_open(p_line), 'LKR'), p_note), 'normal', 'secured_project', s.id,
    app.secured_url(s.id), 'ready:' || p_line || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint, true);
end $$;

-- Gate passed / activity finished → ready (approved triggers only)
create or replace function app.check_invoice_triggers(p_exec uuid) returns int
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in select x.*, a.code, a.name, a.actual_finish from public.exec_invoice_triggers x left join public.exec_activities a on a.id = x.activity_id
           where x.exec_project_id = p_exec and x.approved and x.ready_at is null loop
    if t.kind = 'gate' and exists (select 1 from public.exec_gates where exec_project_id = p_exec and gate >= t.gate and status = 'approved') then
      perform app.mark_invoice_ready(t.line_id, format('Gate %s passed', t.gate)); n := n + 1;
    elsif t.kind = 'activity' and t.actual_finish is not null then
      perform app.mark_invoice_ready(t.line_id, format('%s %s finished %s', t.code, t.name, to_char(t.actual_finish, 'DD Mon'))); n := n + 1;
    elsif t.kind = 'delivery' and not exists (select 1 from public.material_requests m where m.id = any (t.mr_ids) and m.status <> 'received') then
      perform app.mark_invoice_ready(t.line_id, 'Delivered to site and acknowledged: ' ||
        (select string_agg(m.code, ', ' order by m.code) from public.material_requests m where m.id = any (t.mr_ids))); n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function app.billing_after_gate() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then perform app.check_invoice_triggers(new.exec_project_id); end if;
  return new;
end $$;
create trigger exec_gates_billing after update of status on public.exec_gates for each row execute function app.billing_after_gate();
create or replace function app.billing_after_activity() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.actual_finish is not null and old.actual_finish is null then perform app.check_invoice_triggers(new.exec_project_id); end if;
  return new;
end $$;
create trigger exec_activities_billing after update of actual_finish on public.exec_activities for each row execute function app.billing_after_activity();
create or replace function app.billing_after_material() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'received' and old.status is distinct from 'received' then perform app.check_invoice_triggers(new.exec_project_id); end if;
  return new;
end $$;
create trigger material_requests_billing after update of status on public.material_requests for each row execute function app.billing_after_material();

-- Programme approved by SM Projects → the triggers set by then are approved with it
create or replace function app.billing_after_programme() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.version > old.version then
    update public.exec_invoice_triggers set approved = true where exec_project_id = new.exec_project_id and not approved;
    perform app.check_invoice_triggers(new.exec_project_id);
  end if;
  return new;
end $$;
create trigger exec_programmes_billing after update of version on public.exec_programmes for each row execute function app.billing_after_programme();

-- SM Projects approves trigger changes made after the baseline (without a new programme baseline)
create or replace function public.approve_invoice_triggers(p_exec uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform app.require(app.has_role('sm_projects'), 'SM Projects approves the invoice triggers');
  update public.exec_invoice_triggers set approved = true where exec_project_id = p_exec and not approved;
  get diagnostics n = row_count;
  perform app.check_invoice_triggers(p_exec);
  return n;
end $$;

-- Proposed date change on the existing invoice-date approval (SM Projects), sales person told
create or replace function app.propose_invoice_month(p_line uuid, p_month date, p_reason text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare l public.invoice_lines; s public.secured_projects; m date := app.month_of(p_month);
begin
  select * into l from public.invoice_lines where id = p_line;
  if l.id is null or m is null or m = l.forecast_month or app.line_open(l.id) <= 0
     or exists (select 1 from public.invoice_line_changes where line_id = l.id and status = 'pending') then return false; end if;
  select * into s from public.secured_projects where id = l.secured_id;
  insert into public.invoice_line_changes (line_id, from_month, to_month, reason, note, status) values (l.id, l.forecast_month, m, p_reason, p_note, 'pending');
  perform app.notify_many(app.role_users('sm_projects') || array[s.sales_person_id], 'invoice_move', 'Invoice date change proposed by execution',
    s.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · ' || to_char(l.forecast_month, 'Mon YYYY') || ' → ' || to_char(m, 'Mon YYYY') ||
    ' · ' || p_reason || coalesce(' · ' || p_note, ''), 'normal', 'secured_project', s.id, app.secured_url(s.id), null, true);
  return true;
end $$;

-- Monthly check by the SEE: on track / ready (manual and progress-claim lines are made ready here too) / slipping
create or replace function public.check_invoice_line(p_exec uuid, p_line uuid, p_status text, p_month date default null, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; m date := app.month_of((now() at time zone app.tz())::date);
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer checks the invoices');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(exists (select 1 from public.invoice_lines where id = p_line and secured_id = e.secured_id), 'Invoice line of another project');
  perform app.require(p_status in ('on_track', 'ready', 'slipping'), 'Choose the status');
  perform app.require(p_status <> 'slipping' or (p_month is not null and coalesce(btrim(p_note), '') <> ''), 'Give the expected month and the reason');
  perform app.require(p_status <> 'ready' or coalesce(btrim(p_note), '') <> '', 'Say what makes it ready (evidence)');
  insert into public.exec_invoice_checks (line_id, exec_project_id, check_month, status, to_month, note)
  values (p_line, p_exec, m, p_status, case when p_status = 'slipping' then app.month_of(p_month) end, nullif(btrim(p_note), ''));
  if p_status = 'ready' then
    insert into public.exec_invoice_triggers (line_id, exec_project_id, kind, approved) values (p_line, p_exec, 'manual', true) on conflict (line_id) do nothing;
    perform app.mark_invoice_ready(p_line, 'Confirmed by the SEE: ' || btrim(p_note));
    return 'ready';
  elsif p_status = 'slipping' then
    perform app.require(app.propose_invoice_month(p_line, p_month, 'Execution – work later than planned', btrim(p_note)),
      'A date change is already waiting for SM Projects, or the month is unchanged');
    return 'proposed';
  end if;
  return 'on_track';
end $$;

-- Progress claims: AE prepares the measurement, SEE records the client-certified amount
create or replace function public.prepare_ipc(p_exec uuid, p_period date, p_pct numeric, p_measurement text) returns uuid
language plpgsql security definer set search_path = public as $$
declare iid uuid;
begin
  perform app.require(app.is_project_ae(p_exec) or app.has_role('senior_elec_engineer'), 'Assistant Engineers of the project prepare the measurement');
  perform app.require(p_period is not null and p_pct between 0 and 100, 'Enter the month and the % measured');
  perform app.require(coalesce(btrim(p_measurement), '') <> '', 'Describe the measured work (or attach the measurement sheet)');
  insert into public.exec_ipcs (code, exec_project_id, period, measured_pct, measurement) values (app.next_code('IPC'), p_exec, app.month_of(p_period), p_pct, btrim(p_measurement))
  returning id into iid;
  perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_ipc', 'Progress claim measurement to check', app.exec_head(p_exec) || ' · ' || to_char(p_period, 'Mon YYYY') ||
    ' · ' || p_pct || '%', 'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=billing', null, true);
  return iid;
end $$;

create or replace function public.certify_ipc(p_id uuid, p_ok boolean, p_line uuid default null, p_value numeric default null, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.exec_ipcs; e public.exec_projects;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer records the certified amount');
  select * into c from public.exec_ipcs where id = p_id for update;
  perform app.require(c.id is not null and c.status = 'prepared', 'Not waiting for certification');
  if not p_ok then
    perform app.require(coalesce(btrim(p_note), '') <> '', 'Say what to correct');
    update public.exec_ipcs set status = 'returned', note = btrim(p_note) where id = c.id;
    perform app.notify(c.prepared_by, 'exec_ipc', 'Progress claim measurement returned', btrim(p_note), 'normal', 'exec_project', c.exec_project_id, '/execution/' || c.exec_project_id || '?tab=billing');
    return 'returned';
  end if;
  select * into e from public.exec_projects where id = c.exec_project_id;
  perform app.require(exists (select 1 from public.invoice_lines where id = p_line and secured_id = e.secured_id), 'Choose the progress-claim invoice line');
  perform app.require(coalesce(p_value, 0) > 0, 'Enter the amount certified by the client');
  perform app.require(p_value <= app.line_open(p_line) + 1, format('Only %s is still to invoice on that line', app.fmt_money(app.line_open(p_line), 'LKR')));
  update public.exec_ipcs set status = 'certified', line_id = p_line, certified_value = p_value, certified_at = now(), certified_by = auth.uid(), note = nullif(btrim(p_note), '')
  where id = c.id;
  insert into public.exec_invoice_triggers (line_id, exec_project_id, kind, approved) values (p_line, c.exec_project_id, 'ipc', true)
  on conflict (line_id) do update set ready_at = null where exec_invoice_triggers.ready_at is not null and app.line_open(p_line) > 0;
  perform app.mark_invoice_ready(p_line, format('%s certified %s (%s%% measured)', c.code, app.fmt_money(p_value, 'LKR'), c.measured_pct));
  return 'certified';
end $$;

-- Daily: activity forecasts slipping past the invoice month → proposed change; last week of the month → SEE reminder
create or replace function public.billing_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare d date := (p_at at time zone app.tz())::date; r record; n int := 0; nxt date := (app.month_of(d) + interval '1 month')::date;
begin
  for r in select t.line_id, l.forecast_month, a.ef, a.code, a.name from public.exec_invoice_triggers t
           join public.invoice_lines l on l.id = t.line_id join public.exec_activities a on a.id = t.activity_id
           where t.kind = 'activity' and t.approved and t.ready_at is null and a.actual_finish is null and a.ef is not null
             and app.month_of(a.ef) > l.forecast_month loop
    if app.propose_invoice_month(r.line_id, r.ef, 'Execution – programme forecast', format('%s %s forecast to finish %s', r.code, r.name, to_char(r.ef, 'DD Mon YYYY'))) then n := n + 1; end if;
  end loop;
  -- Deliveries expected after the invoice month
  for r in select t.line_id, l.forecast_month, x.due, x.codes from public.exec_invoice_triggers t join public.invoice_lines l on l.id = t.line_id
           cross join lateral (select max(coalesce(m.expected_date, m.required_date)) due, string_agg(m.code, ', ' order by m.code) codes
                               from public.material_requests m where m.id = any (t.mr_ids) and m.status <> 'received') x
           where t.kind = 'delivery' and t.approved and t.ready_at is null and x.due is not null and app.month_of(x.due) > l.forecast_month loop
    if app.propose_invoice_month(r.line_id, r.due, 'Execution – delivery expected later', format('%s expected %s', r.codes, to_char(r.due, 'DD Mon YYYY'))) then n := n + 1; end if;
  end loop;
  if extract(day from d) >= 24 then
    for r in select e.id, e.see_id, count(*) c from public.exec_projects e join public.invoice_lines l on l.secured_id = e.secured_id
             left join public.exec_invoice_triggers t on t.line_id = l.id
             where e.status = 'active' and l.forecast_month = nxt and t.ready_at is null and app.line_open(l.id) > 0
               and not exists (select 1 from public.exec_invoice_checks k where k.line_id = l.id and k.check_month = app.month_of(d))
             group by e.id, e.see_id loop
      perform app.notify(r.see_id, 'exec_billing', 'Confirm next month''s invoices', format('%s · %s invoice(s) planned for %s – on track, ready or slipping?',
        app.exec_head(r.id), r.c, to_char(nxt, 'Mon YYYY')), 'normal', 'exec_project', r.id, '/execution/' || r.id || '?tab=billing', format('billcheck:%s:%s', r.id, app.month_of(d)));
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function public.billing_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.billing_tick(timestamptz) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('billing-tick', '45 2 * * *', 'select public.billing_tick()');
  end if;
end $$;

-- New execution projects are linked to the secured project of their sales project
create or replace function app.exec_link_secured() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.secured_id is null and new.project_id is not null then
    new.secured_id := (select id from public.secured_projects where project_id = new.project_id);
  end if;
  return new;
end $$;
create trigger exec_projects_link_secured before insert on public.exec_projects for each row execute function app.exec_link_secured();

revoke execute on function public.link_secured_project(uuid, uuid), public.set_invoice_trigger(uuid, uuid, text, int, uuid, uuid[]), public.approve_invoice_triggers(uuid),
  public.check_invoice_line(uuid, uuid, text, date, text), public.prepare_ipc(uuid, date, numeric, text), public.certify_ipc(uuid, boolean, uuid, numeric, text) from public, anon;
grant execute on function public.link_secured_project(uuid, uuid), public.set_invoice_trigger(uuid, uuid, text, int, uuid, uuid[]), public.approve_invoice_triggers(uuid),
  public.check_invoice_line(uuid, uuid, text, date, text), public.prepare_ipc(uuid, date, numeric, text), public.certify_ipc(uuid, boolean, uuid, numeric, text) to authenticated;
