-- The invoicing plan drives execution (the budget is built on the sales person's invoice months)
--  * Each invoice line: work trigger met (activity / checkpoint / delivery) → the line is claimable → the SEE submits the payment
--    certificate to the client → the SEE records the client's approval → Operations raises the invoice → the sales person is told.
--    Invoices against an approved certificate need no SM Projects approval; others still go to SM Projects.
--  * The work trigger must be met 10 working days before the end of the invoice month (time to get the certificate approved).
--    Float to that deadline: 15+ working days green, 0–14 amber, past it red. A certificate still with the client in the last
--    3 working days of the month is red.
--  * The programme cannot be submitted with invoice lines without a trigger; lines that would miss their month need the reason
--    and recovery plan, which SM Projects sees with the programme.
--  * Daily: amber → SEE told; red → SEE and SM Projects told, a recovery action (owner, date) is expected; Monday reminder while a
--    red line has no action. Invoice-critical activities must be in the weekly plans like critical ones.
--  * Moves are no longer proposed automatically; the SEE asks (monthly check). A move to another quarter or financial year
--    needs SM Projects and then DGM / GM. The sales person's original month stays as the baseline.

create or replace function app.billing_lead() returns int language sql immutable as $$ select 10 $$;
create or replace function app.billing_amber() returns int language sql immutable as $$ select 15 $$;

-- Financial-year quarter (April–June = Q1) as fy * 10 + q
create or replace function app.fy_quarter(d date) returns int language sql immutable as $$
  select app.fy_of(d) * 10 + ((extract(month from d)::int + 8) % 12) / 3 + 1
$$;

-- n-th working day counted back from the end of month m (0 = the last working day)
create or replace function app.month_wd_back(m date, n int) returns date language sql stable security definer set search_path = public as $$
  select g::date from generate_series((date_trunc('month', m) + interval '1 month - 1 day')::date, date_trunc('month', m)::date - 31, interval '-1 day') g
  where app.is_working_day(g::date) order by g desc offset n limit 1
$$;
-- Last day to have the work trigger met for an invoice in month m
create or replace function app.invoice_deadline(m date) returns date language sql stable as $$ select app.month_wd_back(m, app.billing_lead()) $$;

-- Working days from a to b (negative when b is before a)
create or replace function app.work_float(a date, b date) returns int language sql stable security definer set search_path = public as $$
  select case when a <= b then app.work_days(a, b) - 1 else -(app.work_days(b, a) - 1) end
$$;

alter table public.exec_invoice_triggers add column if not exists risk text, add column if not exists risk_at timestamptz,
  add column if not exists claimable_at timestamptz, add column if not exists claimable_note text;
alter table public.exec_programmes add column if not exists billing_check jsonb, add column if not exists billing_note text;
alter table public.invoice_line_changes add column if not exists needs_gm boolean not null default false,
  add column if not exists smp_by uuid references public.profiles (id), add column if not exists smp_at timestamptz;
-- Lines already marked ready count as claimable too
update public.exec_invoice_triggers set claimable_at = ready_at where ready_at is not null and claimable_at is null;

-- Payment certificates: the SEE submits each claim to the client and records the client's approval
create table public.exec_payment_certs (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  line_id uuid not null references public.invoice_lines (id) on delete cascade,
  claimed_amount numeric(16, 2) not null check (claimed_amount > 0),
  submitted_on date not null,
  submitted_ref text,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'returned')),
  approved_amount numeric(16, 2),
  approved_on date,
  client_ref text,
  note text,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz
);
create index on public.exec_payment_certs (line_id);
create unique index exec_payment_certs_one_open on public.exec_payment_certs (line_id) where status = 'submitted';
alter table public.exec_payment_certs enable row level security;
create policy exec_payment_certs_read on public.exec_payment_certs for select to authenticated using (app.sees_billing());
grant select on public.exec_payment_certs to authenticated;

create table public.exec_billing_actions (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.invoice_lines (id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  action text not null,
  owner_id uuid references public.profiles (id),
  due_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  result text,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  closed_by uuid references public.profiles (id),
  closed_at timestamptz
);
create index on public.exec_billing_actions (line_id);
alter table public.exec_billing_actions enable row level security;
create policy exec_billing_actions_read on public.exec_billing_actions for select to authenticated using (app.sees_billing() or owner_id = auth.uid());
grant select on public.exec_billing_actions to authenticated;

-- Work done for a line: the SEE is asked for the payment certificate
create or replace function app.mark_claimable(p_line uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.exec_invoice_triggers; e public.exec_projects; l public.invoice_lines;
begin
  update public.exec_invoice_triggers set claimable_at = now(), claimable_note = p_note
  where line_id = p_line and claimable_at is null and ready_at is null returning * into t;
  if t.line_id is null or app.line_open(p_line) <= 0 then return; end if;
  select * into e from public.exec_projects where id = t.exec_project_id;
  select * into l from public.invoice_lines where id = p_line;
  insert into public.secured_log (secured_id, action, note) values (l.secured_id, 'claimable', concat_ws(' · ', coalesce(l.description, initcap(l.kind)), p_note));
  perform app.notify(e.see_id, 'exec_billing', 'Work done – submit the payment certificate',
    concat_ws(' · ', app.exec_head(e.id), coalesce(l.description, initcap(l.kind)), app.fmt_money(app.line_open(p_line), 'LKR'), 'invoice ' || to_char(l.forecast_month, 'Mon YYYY'), p_note),
    'normal', 'exec_project', e.id, '/execution/' || e.id || '?tab=billing', 'claim:' || p_line, true);
end $$;

-- When the work trigger is expected
create or replace function app.trigger_forecast(t public.exec_invoice_triggers) returns date
language sql stable security definer set search_path = public as $$
  select case t.kind
    when 'activity' then (select coalesce(a.actual_finish, a.ef) from public.exec_activities a where a.id = t.activity_id)
    when 'gate' then case t.gate
      when 1 then (select min(a.es) from public.exec_activities a where a.exec_project_id = t.exec_project_id)
      when 2 then (select forecast_finish from public.exec_programmes where exec_project_id = t.exec_project_id) end
    when 'delivery' then (select max(coalesce(m.expected_date, m.required_date)) from public.material_requests m where m.id = any (t.mr_ids) and m.status <> 'received')
  end
$$;

-- One row per open invoice line of the execution project(s): stage, trigger, forecast, deadline, float and status
create or replace function app.billing_rows(p_exec uuid default null)
returns table (exec_project_id uuid, project text, see_id uuid, line_id uuid, secured_id uuid, description text, amount numeric, open_amount numeric,
               original_month date, forecast_month date, kind text, trigger_label text, activity_id uuid, forecast_date date, deadline date,
               float_days int, stage text, status text, cert_id uuid, cert_code text, open_actions int, pending_move boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.see_id, l.id, l.secured_id, coalesce(l.description, initcap(l.kind)), l.amount, app.line_open(l.id),
         l.original_month, l.forecast_month, t.kind,
         case when t.line_id is null then 'No trigger'
              when t.kind = 'activity' then (select a.code || ' ' || a.name from public.exec_activities a where a.id = t.activity_id)
              when t.kind = 'gate' then 'Checkpoint ' || (array['Ready to start', 'Handover', 'Close-out'])[t.gate]
              when t.kind = 'delivery' then 'Materials delivered'
              when t.kind = 'ipc' then 'Progress claim (IPC)' else 'SEE confirms the work' end,
         t.activity_id, x.f, app.invoice_deadline(l.forecast_month),
         case when x.f is not null and t.claimable_at is null then app.work_float(x.f, app.invoice_deadline(l.forecast_month)) end,
         case when t.ready_at is not null then 'invoice' when t.claimable_at is not null then 'certificate' else 'work' end,
         case when t.ready_at is not null then 'ready'
              when t.line_id is null then 'no_trigger'
              when t.claimable_at is not null and c.id is not null then
                case when app.work_float(x.today, app.month_wd_back(l.forecast_month, 0)) < 3 then 'red' else 'amber' end
              when t.claimable_at is not null then case when x.today > app.invoice_deadline(l.forecast_month) then 'red' else 'amber' end
              when x.f is null then 'no_date'
              when app.work_float(x.f, app.invoice_deadline(l.forecast_month)) >= app.billing_amber() then 'green'
              when app.work_float(x.f, app.invoice_deadline(l.forecast_month)) >= 0 then 'amber'
              else 'red' end,
         c.id, c.code,
         (select count(*)::int from public.exec_billing_actions b where b.line_id = l.id and b.status = 'open'),
         exists (select 1 from public.invoice_line_changes ch where ch.line_id = l.id and ch.status = 'pending')
  from public.exec_projects e
  join public.invoice_lines l on l.secured_id = e.secured_id
  left join public.exec_invoice_triggers t on t.line_id = l.id
  left join public.exec_payment_certs c on c.line_id = l.id and c.status = 'submitted'
  left join lateral (select app.trigger_forecast(t) f, (now() at time zone app.tz())::date today) x on true
  where e.status = 'active' and (p_exec is null or e.id = p_exec) and app.line_open(l.id) > 0
$$;

create or replace function public.billing_risk(p_exec uuid default null)
returns table (exec_project_id uuid, project text, see_id uuid, line_id uuid, secured_id uuid, description text, amount numeric, open_amount numeric,
               original_month date, forecast_month date, kind text, trigger_label text, activity_id uuid, forecast_date date, deadline date,
               float_days int, stage text, status text, cert_id uuid, cert_code text, open_actions int, pending_move boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.sees_billing(), 'Not allowed');
  return query select * from app.billing_rows(p_exec) r order by r.forecast_month, r.project, r.description;
end $$;

create or replace function public.submit_payment_cert(p_exec uuid, p_line uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; l public.invoice_lines; amt numeric := round(app.to_num(p ->> 'amount'), 2); d date; cid uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer submits the payment certificate');
  select * into e from public.exec_projects where id = p_exec;
  select * into l from public.invoice_lines where id = p_line and secured_id = e.secured_id;
  perform app.require(l.id is not null, 'Invoice line of another project');
  perform app.require(not exists (select 1 from public.exec_payment_certs where line_id = l.id and status = 'submitted'), 'A certificate for this invoice is already with the client');
  begin d := (p ->> 'date')::date; exception when others then d := null; end;
  perform app.require(d is not null and d <= (now() at time zone app.tz())::date, 'Enter the date it was submitted (not in the future)');
  perform app.require(coalesce(amt, 0) > 0 and amt <= app.line_open(l.id) + 1, format('Enter the amount claimed (up to %s)', app.fmt_money(app.line_open(l.id), 'LKR')));
  insert into public.exec_invoice_triggers (line_id, exec_project_id, kind, approved, claimable_at, claimable_note)
  values (l.id, p_exec, 'manual', true, now(), 'Certificate submitted by the SEE') on conflict (line_id) do update set claimable_at = coalesce(exec_invoice_triggers.claimable_at, now());
  insert into public.exec_payment_certs (code, exec_project_id, line_id, claimed_amount, submitted_on, submitted_ref, note)
  values (app.next_code('PC'), p_exec, l.id, amt, d, nullif(btrim(p ->> 'ref'), ''), nullif(btrim(p ->> 'note'), '')) returning id into cid;
  insert into public.secured_log (secured_id, action, note)
  values (l.secured_id, 'certificate_submitted', concat_ws(' · ', 'Payment certificate submitted to the client', coalesce(l.description, initcap(l.kind)), app.fmt_money(amt, 'LKR'), nullif(btrim(p ->> 'ref'), '')));
  return cid;
end $$;

create or replace function public.decide_payment_cert(p_id uuid, p_approved boolean, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare c public.exec_payment_certs; l public.invoice_lines; amt numeric := round(app.to_num(p ->> 'amount'), 2); d date;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer records the client''s decision');
  select * into c from public.exec_payment_certs where id = p_id for update;
  perform app.require(c.id is not null and c.status = 'submitted', 'Not with the client');
  select * into l from public.invoice_lines where id = c.line_id;
  if not p_approved then
    perform app.require(coalesce(btrim(p ->> 'note'), '') <> '', 'Say what the client asked to change');
    update public.exec_payment_certs set status = 'returned', note = concat_ws(' · ', note, btrim(p ->> 'note')), decided_by = auth.uid(), decided_at = now() where id = c.id;
    insert into public.secured_log (secured_id, action, note) values (l.secured_id, 'certificate_returned', concat_ws(' · ', c.code, btrim(p ->> 'note')));
    return 'returned';
  end if;
  begin d := (p ->> 'date')::date; exception when others then d := null; end;
  perform app.require(d is not null and d <= (now() at time zone app.tz())::date, 'Enter the date the client approved it');
  perform app.require(coalesce(amt, 0) > 0 and amt <= app.line_open(l.id) + 1, format('Enter the amount approved (up to %s)', app.fmt_money(app.line_open(l.id), 'LKR')));
  update public.exec_payment_certs set status = 'approved', approved_amount = amt, approved_on = d, client_ref = nullif(btrim(p ->> 'client_ref'), ''),
    note = concat_ws(' · ', note, nullif(btrim(p ->> 'note'), '')), decided_by = auth.uid(), decided_at = now() where id = c.id;
  perform app.mark_invoice_ready(l.id, format('Payment certificate %s approved by the client on %s – %s%s', c.code, to_char(d, 'DD Mon YYYY'), app.fmt_money(amt, 'LKR'),
    coalesce(' · ref ' || nullif(btrim(p ->> 'client_ref'), ''), '')));
  return 'approved';
end $$;

-- Recovery actions on an invoice at risk (SEE / SM Projects; the owner closes it too)
create or replace function public.save_billing_action(p_exec uuid, p_line uuid, p_action text, p_owner uuid, p_due date) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; aid uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'The SEE or SM Projects records recovery actions');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(exists (select 1 from public.invoice_lines where id = p_line and secured_id = e.secured_id), 'Invoice line of another project');
  perform app.require(coalesce(btrim(p_action), '') <> '' and p_owner is not null and p_due is not null, 'Describe the action, the owner and the date');
  insert into public.exec_billing_actions (line_id, exec_project_id, action, owner_id, due_date) values (p_line, p_exec, btrim(p_action), p_owner, p_due) returning id into aid;
  if p_owner is distinct from auth.uid() then
    perform app.notify(p_owner, 'exec_billing', 'Recovery action for an invoice at risk', format('%s · %s · by %s', app.exec_head(p_exec), btrim(p_action), to_char(p_due, 'DD Mon')),
      'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=billing');
  end if;
  return aid;
end $$;

create or replace function public.close_billing_action(p_id uuid, p_result text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.exec_billing_actions;
begin
  select * into b from public.exec_billing_actions where id = p_id for update;
  perform app.require(b.id is not null and b.status = 'open', 'Not open');
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects') or b.owner_id = auth.uid(), 'Not allowed');
  perform app.require(coalesce(btrim(p_result), '') <> '', 'Say what was done');
  update public.exec_billing_actions set status = 'done', result = btrim(p_result), closed_by = auth.uid(), closed_at = now() where id = b.id;
end $$;

-- Daily (replaces the automatic date proposals): risk changes → alerts; Monday reminder for red lines without an action;
-- last week of the month → the SEE confirms next month's invoices
create or replace function public.billing_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare d date := (p_at at time zone app.tz())::date; r record; n int := 0; nxt date := (app.month_of(d) + interval '1 month')::date; why text;
begin
  for r in select b.*, t.risk old_risk from app.billing_rows() b join public.exec_invoice_triggers t on t.line_id = b.line_id
           where b.status in ('green', 'amber', 'red') and b.status is distinct from t.risk loop
    update public.exec_invoice_triggers set risk = r.status, risk_at = p_at where line_id = r.line_id;
    why := case r.stage when 'work' then format('%s expected %s – deadline %s', r.trigger_label, to_char(r.forecast_date, 'DD Mon'), to_char(r.deadline, 'DD Mon'))
                        else case when r.cert_id is null then 'work done – payment certificate not submitted yet' else 'payment certificate ' || r.cert_code || ' still with the client' end end;
    if r.status = 'amber' and coalesce(r.old_risk, 'green') = 'green' then
      perform app.notify(r.see_id, 'exec_billing', 'Invoice at risk – ' || r.project,
        concat_ws(' · ', r.description, app.fmt_money(r.open_amount, 'LKR'), to_char(r.forecast_month, 'Mon YYYY'), why),
        'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=billing', format('billrisk:%s:amber:%s', r.line_id, d));
      n := n + 1;
    elsif r.status = 'red' then
      perform app.notify_many(array[r.see_id] || app.role_users('sm_projects'), 'exec_billing', 'Invoice will miss its month – ' || r.project,
        concat_ws(' · ', r.description, app.fmt_money(r.open_amount, 'LKR'), to_char(r.forecast_month, 'Mon YYYY'), why, 'plan a recovery action'),
        'critical', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=billing', format('billrisk:%s:red:%s', r.line_id, d), true);
      n := n + 1;
    end if;
  end loop;
  if extract(isodow from d) = 1 then
    for r in select * from app.billing_rows() b where b.status = 'red' and b.open_actions = 0 and not b.pending_move loop
      perform app.notify_many(array[r.see_id] || app.role_users('sm_projects'), 'exec_billing', 'No recovery action – invoice at risk',
        format('%s · %s · %s · %s', r.project, r.description, app.fmt_money(r.open_amount, 'LKR'), to_char(r.forecast_month, 'Mon YYYY')),
        'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=billing', format('billnoact:%s:%s', r.line_id, d), true);
      n := n + 1;
    end loop;
  end if;
  if extract(day from d) >= 24 then
    for r in select e.id, e.see_id, count(*) c from public.exec_projects e join public.invoice_lines l on l.secured_id = e.secured_id
             left join public.exec_invoice_triggers t on t.line_id = l.id
             where e.status = 'active' and l.forecast_month = nxt and t.ready_at is null and app.line_open(l.id) > 0
               and not exists (select 1 from public.exec_invoice_checks k where k.line_id = l.id and k.check_month = app.month_of(d))
             group by e.id, e.see_id loop
      perform app.notify(r.see_id, 'exec_billing', 'Confirm next month''s invoices', format('%s · %s invoice(s) planned for %s – on track, work done or slipping?',
        app.exec_head(r.id), r.c, to_char(nxt, 'Mon YYYY')), 'normal', 'exec_project', r.id, '/execution/' || r.id || '?tab=billing', format('billcheck:%s:%s', r.id, app.month_of(d)));
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function public.billing_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.billing_tick(timestamptz) to service_role;

-- (copied from 20260930000117_exec_billing_link.sql: the payment certificate makes the line ready; Operations and SM Projects told)
create or replace function app.mark_invoice_ready(p_line uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.exec_invoice_triggers; l public.invoice_lines; s public.secured_projects;
begin
  select * into t from public.exec_invoice_triggers where line_id = p_line for update;
  if t.line_id is null or t.ready_at is not null or app.line_open(p_line) <= 0 then return; end if;
  update public.exec_invoice_triggers set claimable_at = coalesce(claimable_at, now()) where line_id = p_line;
  select * into l from public.invoice_lines where id = p_line;
  select * into s from public.secured_projects where id = l.secured_id;
  update public.exec_invoice_triggers set ready_at = now(), ready_note = p_note where line_id = p_line;
  insert into public.secured_log (secured_id, action, note) values (s.id, 'ready_to_invoice', concat_ws(' · ', coalesce(l.description, initcap(l.kind)), p_note));
  perform app.notify_many(app.role_users('operations_exec', 'sm_projects'), 'invoice_ready', 'Payment certificate approved – raise the invoice – ' || s.project_name,
    concat_ws(' · ', coalesce(l.description, initcap(l.kind)), app.fmt_money(app.line_open(p_line), 'LKR'), p_note), 'normal', 'secured_project', s.id,
    app.secured_url(s.id), 'ready:' || p_line || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint, true);
end $$;

-- Work trigger met → claimable (copied from 20260930000132_simple_checkpoints.sql)
create or replace function app.check_invoice_triggers(p_exec uuid) returns int
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in select x.*, a.code, a.name, a.actual_finish from public.exec_invoice_triggers x left join public.exec_activities a on a.id = x.activity_id
           where x.exec_project_id = p_exec and x.approved and x.ready_at is null and x.claimable_at is null loop
    if t.kind = 'gate' and exists (select 1 from public.exec_gates where exec_project_id = p_exec and gate >= t.gate and status = 'approved' and not legacy) then
      perform app.mark_claimable(t.line_id, format('Checkpoint %s approved', (array['Ready to start', 'Handover', 'Close-out'])[t.gate])); n := n + 1;
    elsif t.kind = 'activity' and t.actual_finish is not null then
      perform app.mark_claimable(t.line_id, format('%s %s finished %s', t.code, t.name, to_char(t.actual_finish, 'DD Mon'))); n := n + 1;
    elsif t.kind = 'delivery' and not exists (select 1 from public.material_requests m where m.id = any (t.mr_ids) and m.status <> 'received') then
      perform app.mark_claimable(t.line_id, 'Delivered to site and acknowledged: ' ||
        (select string_agg(m.code, ', ' order by m.code) from public.material_requests m where m.id = any (t.mr_ids))); n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- (copied from 20260930000117_exec_billing_link.sql: 'ready' = work done → claimable; the certificate follows)
create or replace function public.check_invoice_line(p_exec uuid, p_line uuid, p_status text, p_month date default null, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; m date := app.month_of((now() at time zone app.tz())::date);
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer checks the invoices');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(exists (select 1 from public.invoice_lines where id = p_line and secured_id = e.secured_id), 'Invoice line of another project');
  perform app.require(p_status in ('on_track', 'ready', 'slipping'), 'Choose the status');
  perform app.require(p_status <> 'slipping' or (p_month is not null and coalesce(btrim(p_note), '') <> ''), 'Give the expected month and the reason');
  perform app.require(p_status <> 'ready' or coalesce(btrim(p_note), '') <> '', 'Say what work is done (evidence)');
  insert into public.exec_invoice_checks (line_id, exec_project_id, check_month, status, to_month, note)
  values (p_line, p_exec, m, p_status, case when p_status = 'slipping' then app.month_of(p_month) end, nullif(btrim(p_note), ''));
  if p_status = 'ready' then
    insert into public.exec_invoice_triggers (line_id, exec_project_id, kind, approved) values (p_line, p_exec, 'manual', true) on conflict (line_id) do nothing;
    perform app.mark_claimable(p_line, 'Confirmed by the SEE: ' || btrim(p_note));
    return 'claimable';
  elsif p_status = 'slipping' then
    perform app.require(app.propose_invoice_month(p_line, p_month, 'Execution – work later than planned', btrim(p_note)),
      'A date change is already waiting for SM Projects, or the month is unchanged');
    return 'proposed';
  end if;
  return 'on_track';
end $$;

-- (copied from 20260930000088_invoice_approval.sql: invoices against an approved payment certificate need no SM Projects approval)
create or replace function public.record_invoice(p_line uuid, p_data jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  l public.invoice_line_status;
  s public.secured_projects;
  d date;
  amt numeric := round(app.to_num(p_data ->> 'amount'), 2);
  waiting numeric;
  no text := btrim(p_data ->> 'invoice_no');
  rid bigint;
begin
  perform app.require(app.has_role('operations_exec'), 'Invoices are recorded by the Operations Executive');
  select * into l from public.invoice_line_status where id = p_line;
  perform app.require(l.id is not null, 'Invoice not found');
  select * into s from public.secured_projects where id = l.secured_id;
  perform app.require(s.status <> 'cancelled', 'The project is cancelled');
  perform app.require(coalesce(no, '') <> '', 'Enter the invoice number');
  begin d := (p_data ->> 'invoice_date')::date; exception when others then d := null; end;
  perform app.require(d is not null and d <= (now() at time zone app.tz())::date, 'Enter the invoice date (not in the future)');
  perform app.require(coalesce(amt, 0) > 0, 'Enter the invoice amount');
  select coalesce(sum(amount), 0) into waiting from public.invoice_requests where line_id = l.id and status = 'pending';
  perform app.require(amt <= l.remaining - waiting + 1,
    format('Only %s is still to invoice on this line%s – record a variation first, or split the amount over the next invoice',
      app.fmt_money(l.remaining - waiting, 'LKR'), case when waiting > 0 then ' (after invoices waiting for SM Projects)' else '' end));
  perform app.require(not exists (select 1 from public.invoice_allocations a where a.secured_id = s.id and lower(a.invoice_no) = lower(no))
                      and not exists (select 1 from public.invoice_requests r where r.secured_id = s.id and r.status = 'pending' and lower(r.invoice_no) = lower(no)),
    'This invoice number is already recorded (or waiting) on this project');
  -- Raised against an approved payment certificate: recorded at once and the sales person told (no SM Projects approval)
  if exists (select 1 from public.exec_invoice_triggers t where t.line_id = l.id and t.ready_at is not null) then
    perform app.require(amt <= l.remaining + 1, format('Only %s is still to invoice on this line', app.fmt_money(l.remaining, 'LKR')));
    insert into public.invoice_allocations (upload_id, month, secured_id, line_id, amount, manual, invoice_no, invoice_date, note, created_by)
    values (null, app.month_of(d), s.id, l.id, amt, true, no, d, nullif(btrim(p_data ->> 'note'), ''), auth.uid()) returning id into rid;
    insert into public.secured_log (secured_id, action, note)
    values (s.id, 'invoiced', concat_ws(' · ', 'Invoice ' || no || ' raised against the approved payment certificate', to_char(d, 'DD Mon YYYY'),
            app.fmt_money(amt, 'LKR'), coalesce(l.description, initcap(l.kind))));
    perform app.notify_many(array_remove(array[s.sales_person_id], null), 'invoice_recorded', 'Invoice raised on your project',
      s.project_name || ' · ' || no || ' · ' || app.fmt_money(amt, 'LKR') || ' · ' || to_char(d, 'DD Mon YYYY'), 'normal', 'secured_project', s.id, app.secured_url(s.id));
    perform app.notify_many(app.role_users('sm_projects'), 'invoice_recorded', 'Invoice raised – ' || s.project_name,
      no || ' · ' || app.fmt_money(amt, 'LKR') || ' · against the approved payment certificate', 'normal', 'secured_project', s.id, app.secured_url(s.id), null, true);
    return -rid;
  end if;
  insert into public.invoice_requests (secured_id, line_id, amount, invoice_no, invoice_date, note)
  values (s.id, l.id, amt, no, d, nullif(btrim(p_data ->> 'note'), '')) returning id into rid;
  insert into public.secured_log (secured_id, action, note)
  values (s.id, 'invoice_requested', concat_ws(' · ', 'Invoice ' || no || ' sent to SM Projects', to_char(d, 'DD Mon YYYY'),
          app.fmt_money(amt, 'LKR'), coalesce(l.description, initcap(l.kind))));
  perform app.notify_many(app.role_users('sm_projects'), 'invoice_request', 'Invoice to approve – ' || s.project_name,
    format('%s · %s · %s · by %s', no, app.fmt_money(amt, 'LKR'), to_char(d, 'DD Mon YYYY'), app.display_name(auth.uid())),
    'normal', 'secured_project', s.id, app.secured_url(s.id), null, true);
  return rid;
end $$;

drop function if exists public.submit_programme(uuid, text);
-- (copied from 20260930000109_exec_programme.sql with the billing check)
create or replace function public.submit_programme(p_exec uuid, p_note text default null, p_billing_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pg public.exec_programmes; n int; red int; red_amt numeric; amber int; sec uuid := (select secured_id from public.exec_projects where id = p_exec);
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer submits the programme');
  select * into pg from public.exec_programmes where exec_project_id = p_exec for update;
  perform app.require(pg.exec_project_id is not null and pg.status = 'draft', 'Nothing to submit');
  select count(*) into n from public.exec_activities where exec_project_id = p_exec;
  perform app.require(n > 0, 'Add the WBS and activities first');
  select count(*) into n from public.exec_activities a where a.exec_project_id = p_exec and a.duration > 0
    and not exists (select 1 from public.exec_activity_resources r where r.activity_id = a.id);
  perform app.require(n = 0, format('%s activit%s without resources – allocate the resources first', n, case when n = 1 then 'y' else 'ies' end));
  select count(*) into n from public.exec_activities a where a.exec_project_id = p_exec and a.responsible_id is null and a.duration > 0;
  perform app.require(n = 0, format('%s activit%s without a responsible engineer', n, case when n = 1 then 'y' else 'ies' end));
  perform app.require(pg.version = 0 or coalesce(btrim(p_note), '') <> '', 'Give the reason for the revised programme');
  perform app.schedule(p_exec);
  -- Billing check: the programme must deliver the invoicing plan the budget is built on
  if sec is not null then
    select count(*) into n from app.billing_rows(p_exec) where status = 'no_trigger';
    perform app.require(n = 0, format('%s invoice line(s) of the invoicing plan have no trigger – set them in the Bill tab first', n));
    select count(*) filter (where status = 'red'), coalesce(sum(open_amount) filter (where status = 'red'), 0), count(*) filter (where status = 'amber')
      into red, red_amt, amber from app.billing_rows(p_exec);
    perform app.require(red = 0 or coalesce(btrim(p_billing_reason), '') <> '',
      format('%s invoice(s) (%s) would miss their planned month – re-plan the programme, or give the reason and the recovery plan', red, app.fmt_money(red_amt, 'LKR')));
  end if;
  update public.exec_programmes set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), submit_note = nullif(btrim(p_note), ''),
    billing_check = case when sec is not null then jsonb_build_object('red', red, 'red_amount', red_amt, 'amber', amber) end,
    billing_note = nullif(btrim(p_billing_reason), '')
  where exec_project_id = p_exec;
  perform app.notify_many(app.role_users('sm_projects'), 'exec_programme', case when pg.version = 0 then 'Programme to approve' else 'Revised programme to approve' end,
    concat_ws(' · ', app.exec_head(p_exec), 'finish ' || to_char((select forecast_finish from public.exec_programmes where exec_project_id = p_exec), 'DD Mon YYYY'), nullif(btrim(p_note), '')),
    'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=programme', null, true);
end $$;

-- (copied from 20260930000072_secured_approvals_smp_only.sql: another quarter / year → SM Projects then DGM / GM)
create or replace function public.move_invoice_line(p_line uuid, p_month date, p_reason text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  l public.invoice_lines;
  s public.secured_projects;
  m date := app.month_of(p_month);
  this_month date := app.month_of((now() at time zone app.tz())::date);
  needs boolean;
  crossq boolean;
  open_amt numeric;
begin
  select * into l from public.invoice_lines where id = p_line for update;
  perform app.require(l.id is not null, 'Invoice not found');
  select * into s from public.secured_projects where id = l.secured_id;
  perform app.require(app.can_edit_secured(s), 'Only the sales person, Operations or SM Projects move invoice dates');
  perform app.require(s.schedule_status = 'approved', 'The schedule is not approved yet – change the month in the schedule');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Choose the reason');
  perform app.require(m is not null and m <> l.forecast_month, 'Choose a different month');
  perform app.require(not exists (select 1 from public.invoice_line_changes where line_id = l.id and status = 'pending'),
    'A change for this invoice is waiting for SM Projects');
  select l.amount - coalesce(sum(amount), 0) into open_amt from public.invoice_allocations where line_id = l.id;
  perform app.require(open_amt > 0, 'This invoice is fully invoiced');
  -- Another quarter or financial year affects the budget: SM Projects and then DGM / GM approve (DGM / GM moves directly)
  crossq := app.fy_quarter(m) <> app.fy_quarter(l.forecast_month) and not app.has_role('gm');
  needs := crossq or ((l.forecast_month <= this_month or m > app.fy_end(app.fy_of(this_month))) and not app.has_role('sm_projects', 'gm'));
  if needs then
    insert into public.invoice_line_changes (line_id, from_month, to_month, reason, note, status, needs_gm, smp_by, smp_at)
    values (l.id, l.forecast_month, m, p_reason, p_note, 'pending', crossq,
      case when crossq and app.has_role('sm_projects') then auth.uid() end, case when crossq and app.has_role('sm_projects') then now() end);
    perform app.notify_many(case when crossq and app.has_role('sm_projects') then app.role_users('gm') else app.role_users('sm_projects') end, 'invoice_move',
      case when crossq then 'Invoice moved to another quarter / year – to approve' else 'Invoice date change to approve' end,
      s.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · ' || to_char(l.forecast_month, 'Mon YYYY') || ' → ' ||
      to_char(m, 'Mon YYYY') || ' · ' || p_reason, 'normal', 'secured_project', s.id, app.secured_url(s.id));
    return 'pending';
  end if;
  insert into public.invoice_line_changes (line_id, from_month, to_month, reason, note, status, decided_by, decided_at)
  values (l.id, l.forecast_month, m, p_reason, p_note, case when app.has_role('sm_projects', 'gm') then 'approved' else 'recorded' end,
    case when app.has_role('sm_projects', 'gm') then auth.uid() end, case when app.has_role('sm_projects', 'gm') then now() end);
  update public.invoice_lines set forecast_month = m, moves = moves + 1 where id = l.id;
  perform app.reallocate(s.id);
  return 'moved';
end $$;

-- (copied from 20260930000117_exec_billing_link.sql)
create or replace function app.propose_invoice_month(p_line uuid, p_month date, p_reason text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare l public.invoice_lines; s public.secured_projects; m date := app.month_of(p_month);
begin
  select * into l from public.invoice_lines where id = p_line;
  if l.id is null or m is null or m = l.forecast_month or app.line_open(l.id) <= 0
     or exists (select 1 from public.invoice_line_changes where line_id = l.id and status = 'pending') then return false; end if;
  select * into s from public.secured_projects where id = l.secured_id;
  insert into public.invoice_line_changes (line_id, from_month, to_month, reason, note, status, needs_gm)
  values (l.id, l.forecast_month, m, p_reason, p_note, 'pending', app.fy_quarter(m) <> app.fy_quarter(l.forecast_month));
  perform app.notify_many(app.role_users('sm_projects') || array[s.sales_person_id], 'invoice_move', 'Invoice date change proposed by execution',
    s.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · ' || to_char(l.forecast_month, 'Mon YYYY') || ' → ' || to_char(m, 'Mon YYYY') ||
    ' · ' || p_reason || coalesce(' · ' || p_note, ''), 'normal', 'secured_project', s.id, app.secured_url(s.id), null, true);
  return true;
end $$;

-- (copied from 20260930000072_secured_approvals_smp_only.sql: two steps when the move changes the quarter / year)
create or replace function public.decide_invoice_move(p_change bigint, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.invoice_line_changes;
  l public.invoice_lines;
  s public.secured_projects;
begin
  select * into c from public.invoice_line_changes where id = p_change for update;
  perform app.require(c.status = 'pending', 'This change is already decided');
  -- Moving to another quarter / financial year: SM Projects first, then DGM / GM
  if c.needs_gm and c.smp_at is not null then
    perform app.require(app.has_role('gm'), 'DGM / GM approves moves to another quarter or year');
  else
    perform app.require(app.has_role('sm_projects', 'gm'), 'Only SM Projects approves invoice date changes');
  end if;
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  select * into l from public.invoice_lines where id = c.line_id;
  select * into s from public.secured_projects where id = l.secured_id;
  if p_approve and c.needs_gm and c.smp_at is null and not app.has_role('gm') then
    update public.invoice_line_changes set smp_by = auth.uid(), smp_at = now(), decision_note = nullif(btrim(p_note), '') where id = c.id;
    perform app.notify_many(app.role_users('gm'), 'invoice_move', 'Invoice moved to another quarter / year – to approve',
      s.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · ' || app.fmt_money(app.line_open(l.id), 'LKR') || ' · ' ||
      to_char(c.from_month, 'Mon YYYY') || ' → ' || to_char(c.to_month, 'Mon YYYY') || ' · ' || c.reason || ' · SM Projects agreed',
      'normal', 'secured_project', s.id, app.secured_url(s.id), null, true);
    return;
  end if;
  update public.invoice_line_changes set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(),
    decided_at = now(), decision_note = p_note where id = c.id;
  if p_approve then
    update public.invoice_lines set forecast_month = c.to_month, moves = moves + 1 where id = l.id;
    perform app.reallocate(s.id);
  end if;
  perform app.notify(c.requested_by, 'invoice_move', case when p_approve then 'Invoice date change approved' else 'Invoice date change not approved' end,
    s.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · ' || to_char(c.from_month, 'Mon YYYY') || ' → ' ||
    to_char(c.to_month, 'Mon YYYY') || coalesce(' · ' || p_note, ''), 'normal', 'secured_project', s.id, app.secured_url(s.id));
end $$;

-- (copied from 20260930000124_secured_removal.sql)
create or replace function public.my_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
  select 'approval', a.id, a.kind::text, a.title, a.reason, a.requested_by, app.display_name(a.requested_by), a.requested_at,
         a.inquiry_id, case when a.inquiry_id is not null then app.inquiry_url(a.inquiry_id) else '/approvals' end,
         format('Step %s of %s', a.current_step, (select count(*) from public.approval_steps x where x.approval_id = a.id))
  from public.approvals a
  join public.approval_steps s on s.approval_id = a.id and s.step_no = a.current_step
  where a.status = 'pending' and (s.approver_role = app.my_role() or (app.my_role() = 'gm' and s.approver_role = 'gm'))
  union all
  select 'visit_plan', p.id, 'weekly_plan', format('Weekly plan – %s – week of %s', app.display_name(p.sales_person_id), to_char(p.week_start, 'DD Mon')),
         case when p.is_late then 'Submitted late' end, p.sales_person_id, app.display_name(p.sales_person_id), p.submitted_at,
         null, '/plan/' || p.id, null
  from public.visit_plans p where p.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'design_review', d.id, 'design_release', format('Design review – %s (%s)', i.code, d.task_type), i.project_name,
         d.assignee_id, app.display_name(d.assignee_id), d.submitted_at, i.id, '/design/' || d.id, null
  from public.design_jobs d join public.inquiries i on i.id = d.inquiry_id
  where d.status = 'in_review' and app.has_role('design_manager')
  union all
  select 'quotation_review', e.id, 'quotation_release', format('Quotation approval – %s', i.code), i.project_name,
         e.assignee_id, app.display_name(e.assignee_id), e.submitted_at, i.id, '/estimation/' || e.id, null
  from public.estimation_jobs e join public.inquiries i on i.id = e.inquiry_id
  where e.status = 'submitted_for_approval' and app.has_role('sm_estimation')
  union all
  select 'sample', sm.id, 'sample_request', format('Sample request %s', sm.code), sm.purpose,
         sm.sales_person_id, app.display_name(sm.sales_person_id), sm.submitted_at, null, '/samples/' || sm.id, sm.status
  from public.samples sm
  where (sm.status = 'submitted' and app.has_role('operations_exec'))
     or (sm.status = 'availability_confirmed' and app.has_role('sm_projects'))
     or (sm.status = 'gm_approval' and app.has_role('gm'))
  union all
  select 'claim_dispute', c.id, 'warranty_dispute', format('Warranty dispute – %s – %s', c.code, w.customer), c.dispute_reason,
         c.disputed_by, app.display_name(c.disputed_by), c.disputed_at, null, app.claim_url(c.id), app.fault_cause_label(c.fault_cause)
  from public.warranty_claims c join public.warranties w on w.id = c.warranty_id
  where c.dispute_status = 'pending' and app.has_role('sm_projects', 'gm')
  union all
  select 'variation', v.id, 'secured_variation',
         format('Variation %s%s – %s', case when v.amount > 0 then '+' else '−' end, app.fmt_money(abs(v.amount), 'LKR'), s.project_name),
         concat_ws(' · ', v.vo_no, v.reason), v.requested_by, app.display_name(v.requested_by), v.requested_at, null, app.secured_url(s.id), null
  from public.secured_variations v join public.secured_projects s on s.id = v.secured_id
  where v.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'meeting_exception', e.id, 'meeting_exception', format('%s leave – %s – %s', app.meeting_label(e.team), app.display_name(e.sales_person_id),
         to_char(e.meeting_date, 'Dy DD Mon')), e.reason, e.sales_person_id, app.display_name(e.sales_person_id), e.requested_at, null,
         '/meetings?team=' || e.team, null
  from public.meeting_exceptions e
  where e.status = 'pending' and app.is_meeting_host(e.team)
  union all
  select 'meeting_attendance', m.id, 'meeting_attendance', format('Meeting attendance – %s – location differs', app.display_name(i.person_id)),
         case when i.distance_m is null then 'No location' else round(i.distance_m) || ' m from the meeting' end, i.person_id,
         app.display_name(i.person_id), i.checkin_at, null, '/meeting/' || m.id, null
  from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id
  where i.status = 'location_check' and app.is_meeting_host(m.team)
  union all
  select 'meeting_assign', a.id, 'meeting_assign', format('Assign: %s', a.action),
         concat_ws(' · ', coalesce(p.name, a.new_project), coalesce(o.name, a.new_customer), app.meeting_label(m.team) || ' ' || to_char(m.meeting_date, 'DD Mon')),
         m.published_by, app.display_name(m.published_by), m.published_at, null, '/meetings', app.action_kind_label(a.kind)
  from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
  left join public.projects p on p.id = a.project_id left join public.organizations o on o.id = a.organization_id
  where m.status = 'published' and a.status = 'open' and a.kind in ('design', 'estimation', 'execution') and a.assignee_id is null
    and a.owner_id = auth.uid()
  union all
  select 'meeting_invite', i.meeting_id, 'meeting_invite', format('Invite %s to the %s – %s', app.display_name(i.person_id), lower(app.meeting_label(m.team)),
         to_char(m.meeting_date, 'Dy DD Mon')), 'Outside the team – requested by ' || app.display_name(coalesce(i.requested_by, m.initiated_by)),
         coalesce(i.requested_by, m.initiated_by), app.display_name(coalesce(i.requested_by, m.initiated_by)), i.invited_at, null, '/meetings?team=' || m.team, null
  from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id
  where i.status = 'pending_approval' and app.has_role('sm_projects') and now() < app.meeting_starts(m)
  union all
  select 'project_change', r.id, 'project_change', format('Project change – %s – %s', p.code, p.name), r.reason,
         r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid, '/projects/' || p.id,
         (select string_agg(app.project_field_label(k), ', ') from jsonb_object_keys(r.changes) k)
  from public.project_change_requests r join public.projects p on p.id = r.project_id
  where r.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'invoice_schedule', s.id, 'invoice_schedule', format('Invoice schedule – %s', s.project_name),
         concat_ws(' · ', s.customer, 'order value ' || app.fmt_money(s.order_value, 'LKR')),
         s.sales_person_id, app.display_name(s.sales_person_id), coalesce(s.submitted_at, s.created_at), null, app.secured_url(s.id), null
  from public.secured_projects s
  where s.status = 'open' and s.schedule_status = 'review' and app.has_role('sm_projects')
  union all
  select 'invoice_move', s.id, 'invoice_move',
         format('Invoice date change%s – %s · %s → %s', case when c.needs_gm then ' (another quarter / year)' else '' end, s.project_name, to_char(c.from_month, 'Mon YYYY'), to_char(c.to_month, 'Mon YYYY')),
         concat_ws(' · ', app.fmt_money(l.amount, 'LKR'), c.reason, c.note), c.requested_by, app.display_name(c.requested_by), c.requested_at,
         null, app.secured_url(s.id), null
  from public.invoice_line_changes c join public.invoice_lines l on l.id = c.line_id join public.secured_projects s on s.id = l.secured_id
  where c.status = 'pending' and ((app.has_role('sm_projects') and (not c.needs_gm or c.smp_at is null))
                                 or (app.has_role('gm') and c.needs_gm and c.smp_at is not null))
  union all
  select 'invoice_request', s.id, 'invoice_request', format('Invoice to approve – %s – %s', s.project_name, r.invoice_no),
         concat_ws(' · ', app.fmt_money(r.amount, 'LKR'), to_char(r.invoice_date, 'DD Mon YYYY'), r.note), r.requested_by,
         app.display_name(r.requested_by), r.requested_at, null, app.secured_url(s.id), null
  from public.invoice_requests r join public.secured_projects s on s.id = r.secured_id
  where r.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'secured_removal', s.id, 'secured_removal', format('Remove from the secured list – %s', s.project_name),
         concat_ws(' · ', app.fmt_money(s.order_value, 'LKR'), s.removal_reason), s.removal_requested_by,
         app.display_name(s.removal_requested_by), s.removal_requested_at, null, app.secured_url(s.id), 'SM Projects'
  from public.secured_projects s
  where s.removal_requested_at is not null and app.has_role('sm_projects')
  union all
  select * from app.exec_pending_approvals()
  order by 8
$$;

-- (copied from 20260930000132_simple_checkpoints.sql: programme approval shows the billing check)
create or replace function app.exec_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
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
  select 'exec_gate', g.id, 'exec_gate', format('%s – %s', (array['Ready to start', 'Handover', 'Close-out'])[g.gate], app.exec_head(g.exec_project_id)), g.note, g.requested_by,
         app.display_name(g.requested_by), g.requested_at, null::uuid, '/execution/' || g.exec_project_id, null
  from public.exec_gates g where g.status = 'pending' and not g.legacy and app.has_role('sm_projects')
  union all
  select 'sub_cert', c.id, 'exec_sub_cert', format('Subcontractor payment %s – %s', c.code, c.subcontractor), app.exec_head(c.exec_project_id) || ' · ' || app.fmt_money(c.net, 'LKR'),
         c.prepared_by, app.display_name(c.prepared_by), c.prepared_at, null::uuid, '/execution/' || c.exec_project_id || '?tab=cost',
         case c.status when 'prepared' then 'Verify' when 'verified' then 'Approve' else 'Pay' end
  from public.sub_certs c
  where (c.status = 'prepared' and app.has_role('senior_elec_engineer')) or (c.status = 'verified' and app.has_role('sm_projects'))
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
$$;

-- Invoice-critical activities count like critical ones in the weekly plan (copied from 20260930000110_exec_plan_programme_link.sql)
create or replace function public.plan_missing_critical(p_plan uuid) returns table (activity_id uuid, code text, name text, es date, ef date)
language sql stable security definer set search_path = public as $$
  select a.id, a.code, a.name, a.es, a.ef
  from public.exec_plans pl join public.exec_activities a on a.exec_project_id = pl.exec_project_id
  where pl.id = p_plan and app.programme_live(pl.exec_project_id) and (a.critical or exists (select 1 from public.exec_invoice_triggers t where t.activity_id = a.id and t.ready_at is null and t.claimable_at is null and t.risk in ('amber', 'red'))) and a.actual_finish is null and a.duration > 0
    and a.es <= pl.week_start + 6 and a.ef >= pl.week_start
    and (pl.ae_id = auth.uid() or app.has_role('senior_elec_engineer') or app.is_project_ae(pl.exec_project_id))
    and not exists (select 1 from public.exec_plan_items i where i.activity_id = a.id and i.day between pl.week_start and pl.week_start + 6)
  order by a.es, a.code
$$;
revoke execute on function public.submit_programme(uuid, text, text) from public, anon;
grant execute on function public.submit_programme(uuid, text, text) to authenticated;
revoke execute on function public.billing_risk(uuid), public.save_billing_action(uuid, uuid, text, uuid, date), public.close_billing_action(uuid, text),
  public.submit_payment_cert(uuid, uuid, jsonb), public.decide_payment_cert(uuid, boolean, jsonb) from public, anon;
grant execute on function public.billing_risk(uuid), public.save_billing_action(uuid, uuid, text, uuid, date), public.close_billing_action(uuid, text),
  public.submit_payment_cert(uuid, uuid, jsonb), public.decide_payment_cert(uuid, boolean, jsonb) to authenticated;
