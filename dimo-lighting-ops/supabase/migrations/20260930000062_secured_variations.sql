-- Secured projects: variations register, final account and invoicing watch.
--  * Original value is kept; variations (+ / −, VO number, reason) are raised by the sales person or Operations and approved
--    by SM Projects (or GM / DGM). Raised by SM Projects / GM they apply straight away.
--    + adds an invoice line (kind 'variation') in the chosen month; − reduces the open balance of the last invoices.
--    Revised value (order_value) = invoiced before the system + the schedule total.
--  * Final account (Operations / SM Projects / GM): any balance not invoiced is cleared as a negative variation, any invoicing
--    above the schedule is recorded as a positive one, and the project closes.
--  * Alerts: invoiced more than 2 % above the revised value → record the variation; nothing invoiced for 2 months after the last
--    planned invoice while a balance is open → final account or delay?

alter table public.secured_projects
  add column if not exists original_value numeric(16, 2),
  add column if not exists final_at timestamptz,
  add column if not exists over_alert_value numeric(16, 2),
  add column if not exists stale_alert_month date;
update public.secured_projects set original_value = order_value where original_value is null;

create table public.secured_variations (
  id uuid primary key default gen_random_uuid(),
  secured_id uuid not null references public.secured_projects (id) on delete cascade,
  kind text not null default 'variation' check (kind in ('variation', 'final_account')),
  vo_no text,
  amount numeric(16, 2) not null check (amount <> 0),          -- + addition, − omission
  month date,                                                  -- invoice month of an addition
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  line_id uuid references public.invoice_lines (id) on delete set null,
  requested_by uuid default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text
);
create index on public.secured_variations (secured_id);
create index on public.secured_variations (status);
alter table public.secured_variations enable row level security;
create policy secured_variations_read on public.secured_variations for select to authenticated
  using (exists (select 1 from public.secured_projects s where s.id = secured_id));

-- The original value is the order value as agreed up to the schedule approval; after that only variations change the value
create or replace function app.secured_original_trg() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.original_value := coalesce(new.original_value, new.order_value);
  elsif old.schedule_status <> 'approved' then
    new.original_value := new.order_value;
  end if;
  return new;
end $$;
drop trigger if exists secured_original on public.secured_projects;
create trigger secured_original before insert or update of order_value, schedule_status on public.secured_projects
  for each row execute function app.secured_original_trg();

-- Revised value = invoiced before the system + schedule total
create or replace function app.secured_revalue(p_secured uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  update public.secured_projects s set order_value = s.billed_before + coalesce((select sum(amount) from public.invoice_lines where secured_id = s.id), 0),
    updated_at = now()
   where s.id = p_secured returning order_value into v;
  return v;
end $$;

-- Apply an approved variation to the schedule
create or replace function app.apply_variation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v public.secured_variations;
  s public.secured_projects;
  l record;
  rest numeric;
  take numeric;
  lid uuid;
  open_total numeric;
begin
  select * into v from public.secured_variations where id = p_id for update;
  select * into s from public.secured_projects where id = v.secured_id for update;
  if v.amount > 0 then
    insert into public.invoice_lines (secured_id, seq, kind, description, amount, original_month, forecast_month)
    values (s.id, coalesce((select max(seq) from public.invoice_lines where secured_id = s.id), 0) + 1, 'variation',
      concat_ws(' ', case v.kind when 'final_account' then 'Final account' else 'Variation' end, v.vo_no), v.amount,
      app.month_of(v.month), app.month_of(v.month))
    returning id into lid;
    update public.secured_variations set line_id = lid where id = v.id;
  else
    select coalesce(sum(remaining), 0) into open_total from public.invoice_line_status where secured_id = s.id and remaining > 0;
    perform app.require(-v.amount <= open_total + 0.5,
      format('Only %s is still to bill – the reduction cannot be larger', app.fmt_money(open_total, 'LKR')));
    rest := -v.amount;
    for l in select id, amount, remaining, invoiced from public.invoice_line_status
              where secured_id = s.id and remaining > 0 order by forecast_month desc, seq desc loop
      exit when rest <= 0;
      take := least(l.remaining, rest);
      if l.amount - take <= 0 and l.invoiced = 0 then
        delete from public.invoice_lines where id = l.id;
      else
        update public.invoice_lines set amount = amount - take where id = l.id;
      end if;
      rest := rest - take;
    end loop;
  end if;
  perform app.secured_revalue(s.id);
  update public.secured_projects set over_alert_value = null, stale_alert_month = null where id = s.id;
  insert into public.secured_log (secured_id, action, note)
  values (s.id, v.kind, concat_ws(' · ', case v.kind when 'final_account' then 'Final account' else 'Variation' end || ' ' ||
          case when v.amount > 0 then '+' else '−' end || app.fmt_money(abs(v.amount), 'LKR'), v.vo_no, v.reason,
          'revised value ' || app.fmt_money((select order_value from public.secured_projects where id = s.id), 'LKR')));
  perform app.reallocate(s.id);
end $$;

-- p_data: {vo_no, amount (signed), month (for an addition), reason}
create or replace function public.request_variation(p_secured uuid, p_data jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  s public.secured_projects;
  amt numeric;
  m date;
  vid uuid;
  manager boolean := app.has_role('sm_projects', 'gm');
begin
  select * into s from public.secured_projects where id = p_secured;
  perform app.require(s.id is not null, 'Secured project not found');
  perform app.require(app.can_edit_secured(s), 'Only the sales person, Operations or SM Projects raise variations');
  perform app.require(s.status = 'open', 'The project is closed');
  perform app.require(s.schedule_status = 'approved', 'The schedule is not approved yet – change the order value and invoices in the schedule');
  begin amt := round(nullif(p_data ->> 'amount', '')::numeric, 2); exception when others then amt := null; end;
  perform app.require(coalesce(amt, 0) <> 0, 'Enter the variation amount (minus for an omission)');
  perform app.require(coalesce(btrim(p_data ->> 'reason'), '') <> '', 'Give the reason');
  begin m := app.month_of(nullif(p_data ->> 'month', '')::date); exception when others then m := null; end;
  perform app.require(amt < 0 or m is not null, 'Choose the month it will be invoiced');
  perform app.require(not exists (select 1 from public.secured_variations where secured_id = s.id and status = 'pending'),
    'A variation is already waiting for SM Projects');
  insert into public.secured_variations (secured_id, vo_no, amount, month, reason, status, decided_by, decided_at)
  values (s.id, nullif(btrim(p_data ->> 'vo_no'), ''), amt, m, btrim(p_data ->> 'reason'),
    case when manager then 'approved' else 'pending' end, case when manager then auth.uid() end, case when manager then now() end)
  returning id into vid;
  if manager then
    perform app.apply_variation(vid);
    perform app.notify(s.sales_person_id, 'secured_variation', 'Variation recorded on your project',
      s.project_name || ' · ' || case when amt > 0 then '+' else '−' end || app.fmt_money(abs(amt), 'LKR') || ' · ' || btrim(p_data ->> 'reason'),
      'normal', 'secured_project', s.id, app.secured_url(s.id));
    return 'approved';
  end if;
  insert into public.secured_log (secured_id, action, note)
  values (s.id, 'variation_requested', concat_ws(' · ', 'Variation ' || case when amt > 0 then '+' else '−' end || app.fmt_money(abs(amt), 'LKR') || ' sent to SM Projects',
          nullif(btrim(p_data ->> 'vo_no'), ''), btrim(p_data ->> 'reason')));
  perform app.notify_many(app.role_users('sm_projects'), 'secured_variation', 'Variation to approve',
    s.project_name || ' · ' || coalesce(app.display_name(s.sales_person_id), '—') || ' · ' || case when amt > 0 then '+' else '−' end ||
    app.fmt_money(abs(amt), 'LKR') || ' · ' || btrim(p_data ->> 'reason'), 'normal', 'secured_project', s.id, app.secured_url(s.id), null, true);
  return 'pending';
end $$;

create or replace function public.decide_variation(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.secured_variations; s public.secured_projects;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'SM Projects approves variations');
  select * into v from public.secured_variations where id = p_id for update;
  perform app.require(v.id is not null and v.status = 'pending', 'This variation is already decided');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  select * into s from public.secured_projects where id = v.secured_id;
  perform app.require(s.status = 'open', 'The project is closed');
  update public.secured_variations set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(p_note), '') where id = v.id;
  if p_approve then
    perform app.apply_variation(v.id);
  else
    insert into public.secured_log (secured_id, action, note) values (s.id, 'variation_rejected', 'Variation not approved · ' || btrim(p_note));
  end if;
  perform app.notify_many(array[v.requested_by, s.sales_person_id], 'secured_variation',
    case when p_approve then 'Variation approved' else 'Variation not approved' end,
    s.project_name || ' · ' || case when v.amount > 0 then '+' else '−' end || app.fmt_money(abs(v.amount), 'LKR') || coalesce(' · ' || nullif(btrim(p_note), ''), ''),
    'normal', 'secured_project', s.id, app.secured_url(s.id));
end $$;

-- Final account: the project ends at what was actually invoiced
create or replace function public.close_final_account(p_secured uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.secured_projects;
  open_total numeric;
  extra numeric;
  last_m date;
  vid uuid;
begin
  perform app.require(app.is_finance_desk(), 'Operations, SM Projects or GM / DGM close the final account');
  select * into s from public.secured_projects where id = p_secured;
  perform app.require(s.id is not null, 'Secured project not found');
  perform app.require(s.status = 'open', 'The project is already closed');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Give the final account note (e.g. final bill no., agreed value)');
  perform app.require(not exists (select 1 from public.secured_variations where secured_id = s.id and status = 'pending'),
    'A variation is waiting for SM Projects – decide it first');
  select coalesce(sum(remaining), 0) into open_total from public.invoice_line_status where secured_id = s.id and remaining > 0;
  select coalesce(sum(amount), 0) into extra from public.invoice_allocations where secured_id = s.id and line_id is null;
  select max(month) into last_m from public.invoice_allocations where secured_id = s.id;
  if open_total > 0.5 then
    insert into public.secured_variations (secured_id, kind, amount, reason, status, decided_by, decided_at)
    values (s.id, 'final_account', -round(open_total, 2), 'Final account – balance not invoiced · ' || btrim(p_note), 'approved', auth.uid(), now())
    returning id into vid;
    perform app.apply_variation(vid);
  end if;
  if extra > 0.5 then
    insert into public.secured_variations (secured_id, kind, amount, month, reason, status, decided_by, decided_at)
    values (s.id, 'final_account', round(extra, 2), coalesce(last_m, app.month_of(current_date)),
      'Final account – invoiced above the schedule · ' || btrim(p_note), 'approved', auth.uid(), now())
    returning id into vid;
    perform app.apply_variation(vid);
  end if;
  update public.secured_projects set status = 'closed', final_at = now(), updated_at = now() where id = s.id;
  insert into public.secured_log (secured_id, action, note)
  values (s.id, 'final_account', 'Final account closed · final value ' ||
          app.fmt_money((select order_value from public.secured_projects where id = s.id), 'LKR') || ' · ' || btrim(p_note));
  perform app.notify(s.sales_person_id, 'secured_final', 'Final account closed',
    s.project_name || ' · final value ' || app.fmt_money((select order_value from public.secured_projects where id = s.id), 'LKR'),
    'normal', 'secured_project', s.id, app.secured_url(s.id));
end $$;

revoke execute on function public.request_variation(uuid, jsonb), public.decide_variation(uuid, boolean, text),
  public.close_final_account(uuid, text) from public, anon;
grant execute on function public.request_variation(uuid, jsonb), public.decide_variation(uuid, boolean, text),
  public.close_final_account(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Watch (hourly): invoiced above the revised value, or nothing invoiced after the last planned invoice
-- ---------------------------------------------------------------------------
create or replace function public.secured_watch_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  this_m date := app.month_of(loc::date);
  n int := 0;
  r record;
  ops uuid[] := app.role_users('operations_exec');
  smp uuid[] := app.role_users('sm_projects');
begin
  if loc::time < time '08:00' then return 0; end if;
  for r in
    select s.*, s.billed_before + coalesce((select sum(amount) from public.invoice_allocations a where a.secured_id = s.id), 0) as invoiced_all
      from public.secured_projects s
     where s.status = 'open' and s.schedule_status = 'approved' and coalesce(s.order_value, 0) > 0
  loop
    if r.invoiced_all > r.order_value * 1.02 + 1 and r.over_alert_value is distinct from r.order_value then
      perform app.notify_many(array[r.sales_person_id] || ops || smp, 'secured_over_invoiced', 'Invoiced above the project value – record the variation',
        format('%s · invoiced %s against %s', r.project_name, app.fmt_money(r.invoiced_all, 'LKR'), app.fmt_money(r.order_value, 'LKR')),
        'normal', 'secured_project', r.id, app.secured_url(r.id));
      update public.secured_projects set over_alert_value = r.order_value where id = r.id; n := n + 1;
    end if;
  end loop;
  for r in
    select s.id, s.project_name, s.sales_person_id, s.stale_alert_month, max(v.forecast_month) as last_plan, sum(greatest(v.remaining, 0)) as open_amt
      from public.secured_projects s join public.invoice_line_status v on v.secured_id = s.id
     where s.status = 'open' and s.schedule_status = 'approved'
     group by s.id
    having sum(greatest(v.remaining, 0)) > 0.5 and max(v.forecast_month) <= (this_m - interval '2 months')::date
       and not exists (select 1 from public.invoice_allocations a where a.secured_id = s.id and a.month > (this_m - interval '2 months')::date)
  loop
    if r.stale_alert_month is distinct from r.last_plan then
      perform app.notify_many(array[r.sales_person_id] || ops, 'secured_stale', 'Nothing invoiced since the last planned invoice – final account or delay?',
        format('%s · %s still to bill · last invoice planned %s · close the final account or move the invoices with a reason', r.project_name,
               app.fmt_money(r.open_amt, 'LKR'), to_char(r.last_plan, 'Mon YYYY')), 'normal', 'secured_project', r.id, app.secured_url(r.id));
      update public.secured_projects set stale_alert_month = r.last_plan where id = r.id; n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.secured_watch_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.secured_watch_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('secured-watch-tick', '35 * * * *', 'select public.secured_watch_tick()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Variations in SM Projects' approvals (copied from 20260930000061)
-- ---------------------------------------------------------------------------
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
  order by 8
$$;
