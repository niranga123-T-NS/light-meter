-- Invoicing no longer comes from the OR file: each invoice raised is recorded in the app against the project's invoice
-- schedule (invoice no., date, amount). The OR file now feeds the P&L only.
--  * invoice_allocations keeps the invoices (upload_id no longer required); amounts already taken from the August OR file
--    stay, marked "from the OR file" so Operations can add the invoice number or delete them.
--  * Record: the sales person or Operations / SM Projects / GM. Delete: Operations / SM Projects / GM or who recorded it.
--  * The OR upload stops matching invoicing and stops the slipped alerts; on the 1st of each month invoices planned in an
--    earlier month and not (fully) invoiced are reported as slipped.
--  * Targets: invoiced is known up to today (no longer up to the last OR month).

alter table public.invoice_allocations alter column upload_id drop not null;
alter table public.invoice_allocations
  add column if not exists invoice_no text,
  add column if not exists invoice_date date,
  add column if not exists note text,
  add column if not exists created_by uuid references public.profiles (id),
  add column if not exists created_at timestamptz not null default now();
update public.invoice_allocations set manual = true, note = coalesce(note, 'From the OR file – add the invoice number or delete')
 where upload_id is not null and invoice_no is null;

-- Matching from the OR file is gone. What remains: an amount recorded without an invoice line (earlier OR data, or
-- extra invoicing) is placed on the open invoices oldest first.
create or replace function app.reallocate(p_secured uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a record; l record; rest numeric; take numeric;
begin
  for a in select * from public.invoice_allocations where secured_id = p_secured and line_id is null and amount > 0 order by month, id loop
    rest := a.amount;
    for l in select v.id, v.remaining from public.invoice_line_status v where v.secured_id = p_secured and v.remaining > 0
              order by v.forecast_month, v.original_month, v.seq loop
      exit when rest <= 0;
      take := least(l.remaining, rest);
      if take = rest then
        update public.invoice_allocations set line_id = l.id, amount = take where id = a.id;
      else
        insert into public.invoice_allocations (upload_id, month, secured_id, line_id, amount, manual, invoice_no, invoice_date, note, created_by, created_at)
        values (a.upload_id, a.month, a.secured_id, l.id, take, true, a.invoice_no, a.invoice_date, a.note, a.created_by, a.created_at);
        update public.invoice_allocations set amount = amount - take where id = a.id;
      end if;
      rest := rest - take;
    end loop;
  end loop;
end $$;

-- p_data: {invoice_no, invoice_date, amount, note}
create or replace function public.record_invoice(p_line uuid, p_data jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  l public.invoice_line_status;
  s public.secured_projects;
  d date;
  amt numeric := round(app.to_num(p_data ->> 'amount'), 2);
  aid bigint;
begin
  select * into l from public.invoice_line_status where id = p_line;
  perform app.require(l.id is not null, 'Invoice not found');
  select * into s from public.secured_projects where id = l.secured_id;
  perform app.require(app.can_edit_secured(s), 'Only the sales person, Operations, SM Projects or GM / DGM record invoices');
  perform app.require(s.status <> 'cancelled', 'The project is cancelled');
  perform app.require(coalesce(btrim(p_data ->> 'invoice_no'), '') <> '', 'Enter the invoice number');
  begin d := (p_data ->> 'invoice_date')::date; exception when others then d := null; end;
  perform app.require(d is not null and d <= (now() at time zone app.tz())::date, 'Enter the invoice date (not in the future)');
  perform app.require(coalesce(amt, 0) > 0, 'Enter the invoice amount');
  perform app.require(amt <= l.remaining + 1,
    format('Only %s is still to invoice on this line – record a variation first, or split the amount over the next invoice', app.fmt_money(l.remaining, 'LKR')));
  perform app.require(not exists (select 1 from public.invoice_allocations a where a.secured_id = s.id and lower(a.invoice_no) = lower(btrim(p_data ->> 'invoice_no'))),
    'This invoice number is already recorded on this project');
  insert into public.invoice_allocations (upload_id, month, secured_id, line_id, amount, manual, invoice_no, invoice_date, note, created_by)
  values (null, app.month_of(d), s.id, l.id, amt, true, btrim(p_data ->> 'invoice_no'), d, nullif(btrim(p_data ->> 'note'), ''), auth.uid())
  returning id into aid;
  insert into public.secured_log (secured_id, action, note)
  values (s.id, 'invoiced', concat_ws(' · ', 'Invoice ' || btrim(p_data ->> 'invoice_no') || ' recorded', to_char(d, 'DD Mon YYYY'),
          app.fmt_money(amt, 'LKR'), coalesce(l.description, initcap(l.kind))));
  if s.sales_person_id is distinct from auth.uid() then
    perform app.notify(s.sales_person_id, 'invoice_recorded', 'Invoice recorded on your project',
      s.project_name || ' · ' || btrim(p_data ->> 'invoice_no') || ' · ' || app.fmt_money(amt, 'LKR'), 'normal', 'secured_project', s.id, app.secured_url(s.id));
  end if;
  return aid;
end $$;

create or replace function public.delete_invoice(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.invoice_allocations;
begin
  select * into a from public.invoice_allocations where id = p_id for update;
  perform app.require(a.id is not null, 'Not found');
  perform app.require(app.is_finance_desk() or a.created_by = auth.uid(), 'Only Operations, SM Projects, GM / DGM or who recorded it delete an invoice');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  delete from public.invoice_allocations where id = a.id;
  insert into public.secured_log (secured_id, action, note)
  values (a.secured_id, 'invoice_deleted', concat_ws(' · ', 'Invoice ' || coalesce(a.invoice_no, 'from the OR file') || ' deleted',
          app.fmt_money(a.amount, 'LKR'), btrim(p_reason)));
end $$;

revoke execute on function public.record_invoice(uuid, jsonb), public.delete_invoice(bigint, text) from public, anon;
grant execute on function public.record_invoice(uuid, jsonb), public.delete_invoice(bigint, text) to authenticated, service_role;

-- OR upload: P&L only (the trial balance by WBS is still stored for reference, nothing is matched from it)
create or replace function public.save_or_upload(p_month date, p_file_name text, p_pnl jsonb, p_wbs jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m date := app.month_of(p_month);
  uid uuid;
begin
  perform app.require(app.is_finance_desk(), 'Only Operations, SM Projects or GM / DGM upload the OR file');
  perform app.require(m is not null, 'Choose the month');
  perform app.require(jsonb_array_length(coalesce(p_pnl, '[]')) > 0, 'The P&L sheet was not found in the file');
  delete from public.or_uploads where month = m;
  insert into public.or_uploads (month, fy, file_name) values (m, app.fy_of(m), p_file_name) returning id into uid;
  insert into public.pnl_lines (upload_id, seq, section, label, rank, ly_cum, m_act, m_bud, c_act, c_bud, fy_bp)
  select uid, (e ->> 'seq')::int, e ->> 'section', e ->> 'label', nullif(e ->> 'rank', ''),
    nullif(e ->> 'ly_cum', '')::numeric, nullif(e ->> 'm_act', '')::numeric, nullif(e ->> 'm_bud', '')::numeric,
    nullif(e ->> 'c_act', '')::numeric, nullif(e ->> 'c_bud', '')::numeric, nullif(e ->> 'fy_bp', '')::numeric
    from jsonb_array_elements(p_pnl) e;
  insert into public.wbs_actuals (upload_id, wbs, revenue, cost)
  select uid, app.wbs_base(e ->> 'wbs'), sum(coalesce((e ->> 'revenue')::numeric, 0)), sum(coalesce((e ->> 'cost')::numeric, 0))
    from jsonb_array_elements(coalesce(p_wbs, '[]')) e where app.wbs_base(e ->> 'wbs') is not null group by 2;
  update public.or_uploads set
    net_turnover = (select m_act from public.pnl_lines where upload_id = uid and section = 'pnl' and lower(label) = 'net turnover' limit 1),
    net_profit = (select m_act from public.pnl_lines where upload_id = uid and section = 'pnl' and lower(label) = 'net profit' limit 1),
    invoiced_wbs = (select sum(revenue) from public.wbs_actuals where upload_id = uid)
   where id = uid;
  return uid;
end $$;

-- Reminders (copied from 20260930000057) + on the 1st: invoices planned in an earlier month not (fully) invoiced → slipped
create or replace function public.finance_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  s public.secured_projects;
  l record;
  n int := 0;
  smp uuid[] := app.role_users('sm_projects');
begin
  if loc::time < time '08:00' then return 0; end if;
  for s in select * from public.secured_projects where status = 'open' and schedule_status = 'missing' and not schedule_alerted
             and app.work_minutes_between(created_at, p_at) >= 5 * app.working_minutes_per_day() loop
    perform app.notify_many(array[s.sales_person_id] || smp, 'secured_schedule', 'Invoice schedule missing',
      s.project_name || ' · won ' || to_char(s.won_on, 'DD Mon YYYY') || ' · enter the invoices', 'normal', 'secured_project', s.id, app.secured_url(s.id));
    update public.secured_projects set schedule_alerted = true where id = s.id; n := n + 1;
  end loop;
  for s in select * from public.secured_projects where status = 'open' and schedule_status = 'review' and not review_alerted
             and app.work_minutes_between(submitted_at, p_at) >= 2 * app.working_minutes_per_day() loop
    perform app.notify_many(smp, 'schedule_review', 'Invoice schedule waiting for review',
      s.project_name || ' · ' || coalesce(app.display_name(s.sales_person_id), '—'), 'normal', 'secured_project', s.id, app.secured_url(s.id));
    update public.secured_projects set review_alerted = true where id = s.id; n := n + 1;
  end loop;
  if extract(day from today) = 20 then
    for l in select v.* from public.invoice_line_status v
              where v.forecast_month = app.month_of(today) and v.remaining > 0 and v.project_status = 'open' and v.schedule_status = 'approved' loop
      perform app.notify(l.sales_person_id, 'invoice_due', 'Invoice planned this month',
        l.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · ' || app.fmt_money(l.remaining, 'LKR') ||
        ' · confirm it will be billed or move it with a reason', 'normal', 'secured_project', l.secured_id, app.secured_url(l.secured_id),
        format('due:%s:%s', l.id, app.month_of(today)));
      n := n + 1;
    end loop;
  end if;
  if extract(day from today) = 1 then
    for l in select v.* from public.invoice_line_status v
              where v.forecast_month < app.month_of(today) and v.remaining > 0.5 and v.schedule_status = 'approved' and v.project_status = 'open' loop
      perform app.notify_many(array[l.sales_person_id] || smp, 'invoice_slipped',
        case when l.invoiced > 0 then 'Invoice part billed – balance slipped' else 'Invoice slipped' end,
        l.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · planned ' || to_char(l.forecast_month, 'Mon YYYY') ||
        ' · ' || app.fmt_money(l.remaining, 'LKR') || ' not invoiced · record the invoice or move it with a reason',
        'normal', 'secured_project', l.secured_id, app.secured_url(l.secured_id), format('slip:%s:%s', l.id, app.month_of(today)));
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function public.finance_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.finance_tick(timestamptz) to service_role;

-- Targets: invoiced to the current month (copied from 20260930000067)
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
  ), tobill as (
    select v.sales_person_id as pid, sum(greatest(v.remaining, 0)) as amt
      from public.invoice_line_status v
     where v.project_status = 'open' and v.forecast_month <= fe and v.remaining > 0 group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.pid, 'name', app.display_name(p.pid), 'role', (select role from public.profiles where id = p.pid),
      'lines', (select coalesce(jsonb_agg(distinct b.business_line), '[]') from public.budget_projects b where b.fy = p_fy and b.sales_person_id = p.pid),
      'to_bill_fy', coalesce((select amt from tobill where tobill.pid = p.pid), 0),
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
