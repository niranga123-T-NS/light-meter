-- Local service orders:
--  * Payment terms that fit how a service is billed – IPC work: "% advance, balance by IPC" or "by IPC, no advance";
--    hire (machine, equipment, consultant): "per period against certified hire / time sheets" with or without an advance;
--    work basis (e.g. a consultant paid per deliverable): "per deliverable on acceptance", with or without an advance;
--    a one-off service: after / before completion or an advance.
--  * Work-basis billing: the deliverables (milestones) of the agreement are kept like work stages – each with its planned
--    date – and each invoice is for a deliverable the SEE has accepted (done).
--  * Hire billing: the hire unit (hour, day, week, month) and agreed rate; on-hire and off-hire dates (Operations or the
--    SEE); each invoice covers a period with the usage certified by the SEE (no overlaps). "Work completed" is the
--    off-hire; the order closes when the invoices cover the hire up to the off-hire.
--  * An IPC service has no work stages: the execution team's approved IPCs are taken straight onto the order (claimed to
--    date, advance recovered, variations). Its planned completion is set before "Signed agreement issued" (which needs it)
--    and is fixed from then on: a change is requested and approved by the SEE, then SM Projects.
--  * The deliverables of a work-basis service are the agreement's: each with its planned date before the signed
--    agreement; after that a date is requested and approved by the SEE, then SM Projects.

alter table public.lo_orders drop constraint if exists lo_orders_payment_term_check;
alter table public.lo_orders add constraint lo_orders_payment_term_check
  check (payment_term in ('advance_balance', 'after_delivery', 'before_delivery', 'lc', 'advance_ipc', 'ipc', 'periodic', 'advance_periodic', 'milestone', 'advance_milestone'));
alter table public.lo_orders drop constraint if exists lo_orders_advance;
alter table public.lo_orders add constraint lo_orders_advance check (payment_term not in ('advance_balance', 'advance_ipc', 'advance_periodic', 'advance_milestone') or advance_pct is not null);
alter table public.lo_orders drop constraint if exists lo_orders_billing_check;
alter table public.lo_orders add constraint lo_orders_billing_check check (billing in ('single', 'ipc', 'hire', 'milestone'));
alter table public.lo_orders add column if not exists hire_unit text check (hire_unit in ('hour', 'day', 'week', 'month'));
alter table public.lo_orders add column if not exists hire_from date;
alter table public.lo_orders add column if not exists hire_to date;
alter table public.lo_order_values add column if not exists hire_rate numeric(16, 2) check (hire_rate is null or hire_rate >= 0);
alter table public.lo_invoices add column if not exists period_from date;
alter table public.lo_invoices add column if not exists period_to date;
alter table public.lo_invoices add column if not exists usage_qty numeric(12, 2) check (usage_qty is null or usage_qty > 0);

-- IPC services keep their IPCs, without work stages
update public.lo_invoices i set work_stage_id = null from public.lo_orders o where o.id = i.order_id and o.billing = 'ipc' and i.work_stage_id is not null;
delete from public.lo_work_stages w using public.lo_orders o where o.id = w.order_id and o.billing = 'ipc';

/** The payment term an order's billing allows, from the one it had */
create or replace function app.lo_map_term(p_term text, p_billing text) returns text
language sql immutable as $$
  select case p_billing
    when 'ipc' then case when p_term in ('advance_balance', 'before_delivery', 'advance_ipc', 'advance_periodic', 'advance_milestone') then 'advance_ipc' else 'ipc' end
    when 'hire' then case when p_term in ('advance_balance', 'before_delivery', 'advance_ipc', 'advance_periodic', 'advance_milestone') then 'advance_periodic' else 'periodic' end
    when 'milestone' then case when p_term in ('advance_balance', 'before_delivery', 'advance_ipc', 'advance_periodic', 'advance_milestone') then 'advance_milestone' else 'milestone' end
    else case when p_term in ('advance_ipc', 'advance_periodic', 'advance_milestone') then 'advance_balance' when p_term in ('ipc', 'periodic', 'milestone') then 'after_delivery' else p_term end
  end
$$;

create or replace function app.lo_term_fits(p_kind text, p_billing text, p_term text) returns boolean
language sql immutable as $$
  select case
    when p_kind = 'material' then p_term in ('advance_balance', 'after_delivery', 'before_delivery', 'lc')
    when p_billing = 'ipc' then p_term in ('advance_ipc', 'ipc')
    when p_billing = 'hire' then p_term in ('periodic', 'advance_periodic')
    when p_billing = 'milestone' then p_term in ('milestone', 'advance_milestone')
    else p_term in ('advance_balance', 'after_delivery', 'before_delivery')
  end
$$;

-- the IPC services so far: their terms in the new words
update public.lo_orders set payment_term = app.lo_map_term(payment_term, billing), advance_pct = case when app.lo_map_term(payment_term, billing) like 'advance%' then coalesce(advance_pct, 10) end
 where kind = 'service' and billing <> 'single' and payment_term <> app.lo_map_term(payment_term, billing);

create or replace function app.lo_applies(p_conds text[], o public.lo_orders) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(bool_and(case c
      when 'material' then o.kind = 'material'
      when 'service' then o.kind = 'service'
      when 'supplier_new' then o.supplier_new
      when 'dic_sel' then coalesce((select value from public.lo_order_values where order_id = o.id), 0) > app.lo_dic_limit()
      when 'advance' then o.payment_term in ('advance_balance', 'before_delivery', 'advance_ipc', 'advance_periodic', 'advance_milestone')
      when 'advance_security' then o.advance_security and o.payment_term in ('advance_balance', 'before_delivery', 'advance_ipc', 'advance_periodic', 'advance_milestone')
      when 'lc' then o.payment_term = 'lc'
      else false end), true)
    from unnest(p_conds) c
$$;

-- p: {request_id, title, kind, billing, supplier, supplier_new, payment_term, advance_pct, advance_security, lead_time, delivery_arrangement,
--     hire_unit, hire_rate, value, notes}
create or replace function public.lo_save_order(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.lo_requests; o public.lo_orders; oid uuid; k text := p ->> 'kind'; t text := p ->> 'payment_term'; pct numeric := nullif(p ->> 'advance_pct', '')::numeric;
        b text; adv boolean; unit text := nullif(p ->> 'hire_unit', '');
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records local orders');
  if p_id is not null then
    select * into o from public.lo_orders where id = p_id for update;
    perform app.require(found, 'Order not found');
    perform app.require(o.status = 'open', 'The order is closed');
    select * into r from public.lo_requests where id = o.request_id;
  else
    select * into r from public.lo_requests where id = nullif(p ->> 'request_id', '')::uuid;
    perform app.require(found, 'Request not found');
  end if;
  perform app.require(r.status = 'open', 'The request is not open');
  perform app.require(k in ('material', 'service'), 'Material or service?');
  perform app.require(r.kind = 'both' or r.kind = k, format('This request is for %s', case r.kind when 'material' then 'materials' else 'services' end));
  b := case when k = 'material' then 'single' else coalesce(nullif(p ->> 'billing', ''), o.billing, 'single') end;
  perform app.require(b in ('single', 'ipc', 'hire', 'milestone'), 'Single invoice, IPC, work basis or hire?');
  perform app.require(b = 'milestone' or o.id is null or not exists (select 1 from public.lo_work_stages where order_id = o.id), 'This order has work stages – remove them first');
  perform app.require(b = 'hire' or o.id is null or not exists (select 1 from public.lo_invoices where order_id = o.id and period_from is not null and status <> 'cancelled'), 'This order has hire invoices – it stays a hire');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'What is ordered from this supplier?');
  perform app.require(coalesce(btrim(p ->> 'supplier'), '') <> '', 'Enter the supplier / service provider');
  perform app.require(t is not null and app.lo_term_fits(k, b, t), case b when 'ipc' then 'Choose the payment term – % advance and the balance by IPC, or by IPC with no advance'
                                                                      when 'hire' then 'Choose the payment term – per period against the hire / time sheets, with or without an advance'
                                                                      when 'milestone' then 'Choose the payment term – per deliverable on acceptance, with or without an advance'
                                                                      else 'Choose the payment term' end);
  adv := t in ('advance_balance', 'advance_ipc', 'advance_periodic', 'advance_milestone');
  perform app.require(not adv or (pct > 0 and pct < 100), 'Enter the advance %');
  perform app.require(b <> 'hire' or unit in ('hour', 'day', 'week', 'month'), 'Hired by the hour, day, week or month?');
  if p_id is null then
    insert into public.lo_orders (code, request_id, seq_no, title, kind, billing, supplier, supplier_new, payment_term, advance_pct, advance_security, lead_time, delivery_arrangement, hire_unit, notes)
    values (app.next_code('LO'), r.id, coalesce((select max(seq_no) from public.lo_orders where request_id = r.id), 0) + 1, btrim(p ->> 'title'), k, b, btrim(p ->> 'supplier'),
            coalesce((p ->> 'supplier_new')::boolean, false), t, case when adv then pct end, coalesce((p ->> 'advance_security')::boolean, false),
            nullif(btrim(p ->> 'lead_time'), ''), nullif(btrim(p ->> 'delivery_arrangement'), ''), case when b = 'hire' then unit end, nullif(btrim(p ->> 'notes'), ''))
    returning id into oid;
  else
    oid := p_id;
    update public.lo_orders set title = btrim(p ->> 'title'), kind = k, billing = b, supplier = btrim(p ->> 'supplier'), supplier_new = coalesce((p ->> 'supplier_new')::boolean, false),
           payment_term = t, advance_pct = case when adv then pct end, advance_security = coalesce((p ->> 'advance_security')::boolean, false),
           lead_time = nullif(btrim(p ->> 'lead_time'), ''), delivery_arrangement = nullif(btrim(p ->> 'delivery_arrangement'), ''),
           hire_unit = case when b = 'hire' then unit end, notes = nullif(btrim(p ->> 'notes'), ''), updated_at = now()
     where id = oid;
    select * into o from public.lo_orders where id = oid;
    perform app.require(not exists (select 1 from public.lo_steps st join public.lo_step_defs d on d.key = st.step
                                     where st.order_id = oid and not app.lo_applies(d.conds, o)),
      'Steps already recorded no longer apply to these terms – clear them first');
  end if;
  if p ? 'value' or p ? 'hire_rate' then
    insert into public.lo_order_values (order_id, value, hire_rate)
    values (oid, nullif(p ->> 'value', '')::numeric, case when b = 'hire' then nullif(p ->> 'hire_rate', '')::numeric end)
    on conflict (order_id) do update set value = case when p ? 'value' then excluded.value else lo_order_values.value end,
                                         hire_rate = case when b = 'hire' then excluded.hire_rate end, updated_at = now();
  end if;
  return oid;
end $$;

/** Operations: how a service order is billed (the payment term follows) */
create or replace function public.lo_set_billing(p_order uuid, p_billing text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; t text;
begin
  perform app.require(app.lo_keeper(), 'Operations records local orders');
  select * into o from public.lo_orders where id = p_order for update;
  perform app.require(found, 'Order not found');
  perform app.require(p_billing in ('single', 'ipc', 'hire', 'milestone'), 'Single invoice, IPC, work basis or hire?');
  perform app.require(o.kind = 'service' or p_billing = 'single', 'Materials are billed by invoice');
  perform app.require(p_billing = 'milestone' or not exists (select 1 from public.lo_work_stages where order_id = o.id), 'This order has work stages – remove them first');
  t := app.lo_map_term(o.payment_term, p_billing);
  update public.lo_orders set billing = p_billing, payment_term = t, advance_pct = case when t like 'advance%' then coalesce(advance_pct, 10) end,
         hire_unit = case when p_billing = 'hire' then coalesce(hire_unit, 'day') end, updated_at = now() where id = o.id;
end $$;
grant execute on function public.lo_set_billing(uuid, text) to authenticated;

/** Operations or the project's SEE: the on-hire and off-hire dates of a hire */
create or replace function public.lo_set_hire(p_order uuid, p_from date, p_to date) returns void
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; today date := (now() at time zone app.tz())::date;
begin
  select * into o from public.lo_orders where id = p_order for update;
  perform app.require(found, 'Order not found');
  perform app.require(o.billing = 'hire', 'This order is not a hire');
  perform app.require(o.status = 'open', 'The order is closed');
  perform app.require(app.lo_keeper() or app.lo_see_of(o.request_id) = auth.uid(), 'Operations or the project''s SEE record the hire');
  perform app.require(p_from is not null or p_to is null, 'Enter the on-hire date first');
  perform app.require(p_from is null or p_from <= today, 'On hire from – not a future date');
  perform app.require(p_to is null or (p_to >= p_from and p_to <= today), 'The off-hire date is the day it was actually released – not before the on-hire date or in the future');
  perform app.require(p_from is null or not exists (select 1 from public.lo_invoices where order_id = o.id and status <> 'cancelled' and period_from < p_from), 'An invoice covers time before that on-hire date');
  perform app.require(p_to is null or not exists (select 1 from public.lo_invoices where order_id = o.id and status <> 'cancelled' and period_to > p_to), 'An invoice covers time after that off-hire date');
  update public.lo_orders set hire_from = p_from, hire_to = p_to, updated_at = now() where id = o.id;
  if p_to is not null and o.hire_to is null then
    perform app.notify_many(app.lo_followers(o.request_id), 'local_order', 'Off hire', concat_ws(' · ', app.lo_order_head(o), 'released ' || to_char(p_to, 'DD Mon YYYY')),
      'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  end if;
end $$;
grant execute on function public.lo_set_hire(uuid, date, date) to authenticated;

-- p: {kind, invoice_no, invoice_date, amount, dn_nos, sub_invoice_id, received_on, note, advance_recovered, period_from, period_to, usage_qty}
create or replace function public.lo_add_invoice(p_order uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; r public.lo_requests; iid uuid; k text := coalesce(nullif(p ->> 'kind', ''), 'invoice'); rec date := coalesce(nullif(p ->> 'received_on', '')::date, (now() at time zone app.tz())::date);
        pf date := nullif(p ->> 'period_from', '')::date; pt date := nullif(p ->> 'period_to', '')::date; qty numeric := nullif(p ->> 'usage_qty', '')::numeric;
        adv numeric := nullif(nullif(p ->> 'advance_recovered', '')::numeric, 0); hire boolean; ws uuid := nullif(p ->> 'work_stage_id', '')::uuid;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records invoices');
  select * into o from public.lo_orders where id = p_order;
  perform app.require(found and o.status = 'open', 'Order not found or closed');
  select * into r from public.lo_requests where id = o.request_id;
  hire := o.billing = 'hire' and k = 'invoice';
  perform app.require(k in ('invoice', 'ipc', 'advance'), 'Invoice, IPC invoice or advance invoice?');
  perform app.require(k <> 'ipc' or (o.kind = 'service' and o.billing = 'ipc'), 'IPC invoices are for services paid by IPC');
  perform app.require(coalesce(btrim(p ->> 'invoice_no'), '') <> '', 'Enter the invoice no.');
  perform app.require(nullif(p ->> 'invoice_date', '')::date is not null, 'Enter the invoice date');
  perform app.require(nullif(p ->> 'amount', '')::numeric > 0, 'Enter the amount');
  perform app.require(rec <= (now() at time zone app.tz())::date, 'The received date cannot be in the future');
  -- material: against signed delivery notes (an advance invoice excepted)
  perform app.require(k = 'advance' or o.kind = 'service' or coalesce(btrim(p ->> 'dn_nos'), '') <> '', 'Enter the signed delivery note no(s). the invoice covers');
  perform app.require(adv is null or (k <> 'advance' and adv > 0 and adv <= (p ->> 'amount')::numeric), 'The advance recovered is more than the invoice');
  -- hire: the period and the usage the SEE certifies (hire / time sheets)
  if hire then
    perform app.require(o.hire_from is not null, 'Record the on-hire date first');
    perform app.require(pf is not null and pt is not null and pt >= pf, 'Enter the period the invoice covers (from – to)');
    perform app.require(pf >= o.hire_from and (o.hire_to is null or pt <= o.hire_to), 'The period is outside the hire (on hire – off hire)');
    perform app.require(pt <= (now() at time zone app.tz())::date, 'The period cannot end in the future');
    perform app.require(qty > 0, format('Enter the %ss used in the period (from the certified hire / time sheet)', o.hire_unit));
    perform app.require(not exists (select 1 from public.lo_invoices where order_id = o.id and status <> 'cancelled' and period_from is not null
                                      and daterange(period_from, period_to, '[]') && daterange(pf, pt, '[]')), 'Another invoice already covers part of this period');
  end if;
  -- work basis: an invoice is for a deliverable the SEE has accepted
  if o.billing = 'milestone' and k = 'invoice' then
    perform app.require(ws is not null, 'Choose the deliverable this invoice is for');
    perform app.require(exists (select 1 from public.lo_work_stages where id = ws and order_id = o.id), 'Choose a deliverable of this order');
    perform app.require(exists (select 1 from public.lo_work_stages where id = ws and done_on is not null), 'The deliverable is not accepted yet – record it done first');
  else
    perform app.require(ws is null or exists (select 1 from public.lo_work_stages where id = ws and order_id = o.id), 'Choose a work stage of this order');
  end if;
  if nullif(p ->> 'sub_invoice_id', '') is not null then
    perform app.require(exists (select 1 from public.sub_invoices where id = (p ->> 'sub_invoice_id')::uuid and exec_project_id = r.exec_project_id),
      'That subcontractor invoice is not on this project');
  end if;
  insert into public.lo_invoices (order_id, kind, invoice_no, invoice_date, amount, dn_nos, sub_invoice_id, received_on, note, advance_recovered, work_stage_id, period_from, period_to, usage_qty)
  values (p_order, k, btrim(p ->> 'invoice_no'), (p ->> 'invoice_date')::date, (p ->> 'amount')::numeric, nullif(btrim(p ->> 'dn_nos'), ''),
          nullif(p ->> 'sub_invoice_id', '')::uuid, rec, nullif(btrim(p ->> 'note'), ''), adv, case when k <> 'advance' then ws end,
          case when hire then pf end, case when hire then pt end, case when hire then qty end)
  returning id into iid;
  return iid;
end $$;

-- deliverables only for a work-basis service
create or replace function app.lo_stage_needs_ipc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.purging', true) = 'on' then return new; end if;
  if (select billing from public.lo_orders where id = new.order_id) <> 'milestone' then
    raise exception 'Deliverables are for a service paid per deliverable (work basis) – an IPC service takes its approved IPCs directly';
  end if;
  return new;
end $$;

-- the service rules on the steps: an IPC service's agreement carries its work programme; "Work completed" needs every
-- stage done (IPC) or the off-hire (hire); a hire closes when its invoices reach the off-hire
create or replace function app.lo_work_done_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; n int;
begin
  if current_setting('app.purging', true) = 'on' or new.order_id is null or new.step not in ('work_done', 'agreement_signed', 'closed') then return new; end if;
  select * into o from public.lo_orders where id = new.order_id;
  if new.step = 'agreement_signed' and o.billing = 'ipc' and o.expected_on is null then
    raise exception 'Enter the planned completion (Expected completion) before the signed agreement – the agreement fixes it';
  elsif new.step = 'agreement_signed' and o.billing = 'milestone' then
    if not exists (select 1 from public.lo_work_stages where order_id = o.id) then
      raise exception 'Enter the deliverables of the agreement (each with its planned date) before the signed agreement';
    end if;
    select count(*) into n from public.lo_work_stages where order_id = o.id and planned_on is null and done_on is null;
    if n > 0 then raise exception '% deliverable(s) without a planned date – the agreement fixes them', n; end if;
  elsif new.step = 'work_done' then
    select count(*) into n from public.lo_work_stages where order_id = new.order_id and done_on is null;
    if n > 0 then raise exception '% deliverable(s) not accepted yet – record them first', n; end if;
    if o.billing = 'hire' and o.hire_to is null then raise exception 'Record the off-hire date first'; end if;
  elsif new.step = 'closed' and o.billing = 'hire' then
    if coalesce((select max(period_to) from public.lo_invoices where order_id = o.id and status <> 'cancelled' and period_to is not null), '-infinity') < o.hire_to then
      raise exception 'The hire invoices do not reach the off-hire date yet (%)', to_char(o.hire_to, 'DD Mon YYYY');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists lo_work_done_check on public.lo_steps;
create trigger lo_work_done_check before insert on public.lo_steps for each row execute function app.lo_work_done_check();

create or replace function public.lo_save_work_stage(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; w public.lo_work_stages; wid uuid; done date := nullif(p ->> 'done_on', '')::date; plan date := nullif(p ->> 'planned_on', '')::date;
begin
  if p_id is not null then
    select * into w from public.lo_work_stages where id = p_id for update;
    perform app.require(found, 'Work stage not found');
  end if;
  select * into o from public.lo_orders where id = coalesce(w.order_id, nullif(p ->> 'order_id', '')::uuid);
  perform app.require(o.id is not null, 'Order not found');
  perform app.require(o.kind = 'service', 'Work stages are for services');
  perform app.require(o.status = 'open', 'The order is closed');
  perform app.require(app.lo_keeper() or app.lo_see_of(o.request_id) = auth.uid(), 'Operations or the project''s SEE record the work');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'What is this stage of the work?');
  perform app.require(done is null or done <= (now() at time zone app.tz())::date, '“Done / certified on” is the date the stage was actually done – leave it empty until then (the planned date can be in the future)');
  -- the planned dates are the agreement's: fixed once it is signed (a change goes to the SEE and SM Projects)
  if app.lo_agreement_signed(o.id) and plan is distinct from w.planned_on then
    perform app.require(false, case when w.planned_on is null then 'Planned dates are set at the agreement stage – now the date is requested (the SEE and SM Projects approve it)'
                                    else 'The planned date is fixed by the signed agreement – request a change (the SEE and SM Projects approve it)' end);
  end if;
  if p_id is null then
    insert into public.lo_work_stages (order_id, seq, title, pct, planned_on, done_on, cert_ref, note)
    values (o.id, coalesce((select max(seq) from public.lo_work_stages where order_id = o.id), 0) + 1, btrim(p ->> 'title'), nullif(p ->> 'pct', '')::numeric,
            plan, done, nullif(btrim(p ->> 'cert_ref'), ''), nullif(btrim(p ->> 'note'), ''))
    returning id into wid;
  else
    update public.lo_work_stages set title = btrim(p ->> 'title'), pct = nullif(p ->> 'pct', '')::numeric, planned_on = plan,
           done_on = done, cert_ref = nullif(btrim(p ->> 'cert_ref'), ''), note = nullif(btrim(p ->> 'note'), '')
     where id = p_id returning id into wid;
  end if;
  perform app.require((select coalesce(sum(pct), 0) from public.lo_work_stages where order_id = o.id) <= 100, 'The stages add up to more than 100%');
  if done is not null and (w.id is null or w.done_on is null) then
    perform app.notify_many(app.lo_followers(o.request_id), 'local_order', 'Work stage done',
      concat_ws(' · ', app.lo_order_head(o), btrim(p ->> 'title'), 'IPC ' || nullif(btrim(p ->> 'cert_ref'), '')), 'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  end if;
  return wid;
end $$;

create or replace function public.lo_request_stage_date(p_stage uuid, p_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare w public.lo_work_stages; o public.lo_orders; cid uuid; see boolean;
begin
  select * into w from public.lo_work_stages where id = p_stage;
  perform app.require(found, 'Work stage not found');
  select * into o from public.lo_orders where id = w.order_id;
  see := app.lo_see_of(o.request_id) = auth.uid();
  perform app.require(app.lo_keeper() or see, 'Operations or the project''s SEE ask for the change');
  perform app.require(app.lo_agreement_signed(o.id), 'Before the agreement is signed, edit the stage directly');
  perform app.require(w.done_on is null, 'The stage is done');
  perform app.require(p_date is not null and p_date is distinct from w.planned_on, 'Choose the new date');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(not exists (select 1 from public.lo_work_stage_changes where stage_id = w.id and status in ('pending_see', 'pending_smp')), 'A change is already waiting for approval');
  -- the SEE asking is the SEE's approval
  insert into public.lo_work_stage_changes (stage_id, old_date, new_date, reason, status, see_by, see_at)
  values (w.id, w.planned_on, p_date, btrim(p_reason), case when see then 'pending_smp' else 'pending_see' end, case when see then auth.uid() end, case when see then now() end)
  returning id into cid;
  if see then
    perform app.notify_many(app.role_users('sm_projects'), 'local_order', 'Work stage date change to approve',
      concat_ws(' · ', app.lo_order_head(o), w.title, coalesce(to_char(w.planned_on, 'DD Mon'), 'no date') || ' → ' || to_char(p_date, 'DD Mon YYYY'), btrim(p_reason)), 'normal', 'lo_order', o.id, '/orders/local/' || o.id, null, true);
  else
    perform app.notify(app.lo_see_of(o.request_id), 'local_order', 'Work stage date change to approve',
      concat_ws(' · ', app.lo_order_head(o), w.title, coalesce(to_char(w.planned_on, 'DD Mon'), 'no date') || ' → ' || to_char(p_date, 'DD Mon YYYY'), btrim(p_reason)), 'normal', 'lo_order', o.id, '/orders/local/' || o.id, null, true);
  end if;
  return cid;
end $$;

create or replace function public.lo_decide_stage_date(p_change uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.lo_work_stage_changes; w public.lo_work_stages; o public.lo_orders; head text;
begin
  select * into c from public.lo_work_stage_changes where id = p_change for update;
  perform app.require(found, 'Change not found');
  select * into w from public.lo_work_stages where id = c.stage_id;
  select * into o from public.lo_orders where id = w.order_id;
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  head := concat_ws(' · ', app.lo_order_head(o), w.title, coalesce(to_char(c.old_date, 'DD Mon'), 'no date') || ' → ' || to_char(c.new_date, 'DD Mon YYYY'));
  if c.status = 'pending_see' then
    perform app.require(app.lo_see_of(o.request_id) = auth.uid() or app.has_role('senior_elec_engineer'), 'The project''s SEE approves first');
    update public.lo_work_stage_changes set status = case when p_approve then 'pending_smp' else 'rejected' end, see_by = auth.uid(), see_at = now(),
           decision_note = nullif(btrim(p_note), '') where id = c.id;
    if p_approve then
      perform app.notify_many(app.role_users('sm_projects'), 'local_order', 'Work stage date change to approve', head || ' · ' || c.reason, 'normal', 'lo_order', o.id, '/orders/local/' || o.id, null, true);
    end if;
  elsif c.status = 'pending_smp' then
    perform app.require(app.has_role('sm_projects'), 'SM Projects approves after the SEE');
    update public.lo_work_stage_changes set status = case when p_approve then 'approved' else 'rejected' end, smp_by = auth.uid(), smp_at = now(),
           decision_note = coalesce(nullif(btrim(p_note), ''), decision_note) where id = c.id;
    if p_approve then update public.lo_work_stages set planned_on = c.new_date where id = w.id; end if;
  else
    perform app.require(false, 'Already decided');
  end if;
  if not p_approve or c.status = 'pending_smp' then
    perform app.notify_many(array[c.requested_by] || app.role_users('operations_exec'), 'local_order', case when p_approve then 'Work stage date changed' else 'Work stage date change rejected' end,
      concat_ws(' · ', head, nullif(btrim(p_note), '')), 'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  end if;
end $$;

grant execute on function public.lo_add_invoice(uuid, jsonb), public.lo_save_order(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- IPC services: the approved IPCs straight onto the order; the planned completion fixed by the signed agreement

drop function if exists public.lo_add_stage_ipc(uuid, uuid, jsonb);

/** Operations: take the execution team's approved IPC onto an IPC service order.
 *  p: {received_on, advance_recovered, has_variation, variation_amount, variation_note, note} */
create or replace function public.lo_take_ipc(p_order uuid, p_sub uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; r public.lo_requests; v public.sub_invoices; iid uuid;
        rec date := coalesce(nullif(p ->> 'received_on', '')::date, (now() at time zone app.tz())::date);
        adv numeric := coalesce(nullif(p ->> 'advance_recovered', '')::numeric, 0);
        var_on boolean := coalesce(p ->> 'has_variation', '') in ('yes', 'true');
        var_amt numeric := nullif(p ->> 'variation_amount', '')::numeric;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records invoices');
  select * into o from public.lo_orders where id = p_order;
  perform app.require(found, 'Order not found');
  perform app.require(o.status = 'open', 'The order is closed');
  perform app.require(o.kind = 'service' and o.billing = 'ipc', 'This order is not paid by IPC');
  select * into r from public.lo_requests where id = o.request_id;
  select * into v from public.sub_invoices where id = p_sub;
  perform app.require(found and v.exec_project_id = r.exec_project_id, 'Choose an IPC of this project');
  perform app.require(v.status in ('approved', 'docs_received'), 'Only an approved IPC');
  perform app.require(not exists (select 1 from public.lo_invoices where sub_invoice_id = v.id and status <> 'cancelled'), 'This IPC is already taken');
  perform app.require(adv <= v.amount, 'The advance recovered is more than the IPC');
  perform app.require(not var_on or coalesce(var_amt, 0) > 0, 'Enter the variation amount');
  perform app.require(rec <= (now() at time zone app.tz())::date, 'The received date cannot be in the future');
  insert into public.lo_invoices (order_id, kind, invoice_no, invoice_date, amount, sub_invoice_id, received_on, see_on,
                                  advance_recovered, variation_amount, variation_note, note)
  values (o.id, 'ipc', coalesce(v.invoice_no, v.code), coalesce(v.invoice_date, rec), v.amount, v.id, rec,
          -- the SEE approved it in the IPC flow
          coalesce((v.see_at at time zone app.tz())::date, rec),
          nullif(adv, 0), case when var_on then var_amt end, case when var_on then nullif(btrim(p ->> 'variation_note'), '') end, nullif(btrim(p ->> 'note'), ''))
  returning id into iid;
  perform app.notify_many(app.role_users('sm_projects'), 'local_order', 'IPC invoice to approve',
    concat_ws(' · ', app.lo_order_head(o), coalesce(v.invoice_no, v.code), app.fmt_money(v.amount, 'LKR')), 'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  return iid;
end $$;
grant execute on function public.lo_take_ipc(uuid, uuid, jsonb) to authenticated;

-- an execution project's IPC invoice only from an approved IPC; an advance is not progress
create or replace function app.lo_invoice_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare exec uuid;
begin
  if current_setting('app.purging', true) = 'on' then return new; end if;
  if new.kind = 'advance' and new.work_stage_id is not null then
    raise exception 'The advance is not progress – it is not under a deliverable';
  end if;
  if tg_op = 'INSERT' and new.kind = 'ipc' and new.sub_invoice_id is null then
    select r.exec_project_id into exec from public.lo_orders o join public.lo_requests r on r.id = o.request_id where o.id = new.order_id;
    if exec is not null then
      raise exception 'IPC invoices of an execution project come from the execution team''s approved IPCs – take it with + IPC';
    end if;
  end if;
  return new;
end $$;

-- the planned completion of an IPC service is the agreement's: fixed once it is signed
create or replace function public.lo_set_expected(p_order uuid, p_date date, p_reason text default null, p_party text default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; r public.lo_requests; first boolean;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records the dates');
  select * into o from public.lo_orders where id = p_order for update;
  perform app.require(found and o.status = 'open', 'Order not found or closed');
  perform app.require(not (o.billing = 'ipc' and app.lo_agreement_signed(o.id)),
    'The planned completion is fixed by the signed agreement – request a change (the SEE and SM Projects approve it)');
  select * into r from public.lo_requests where id = o.request_id;
  perform app.require(p_date is not null, 'Enter the date');
  first := o.expected_on is null;
  perform app.require(first or p_date is distinct from o.expected_on, 'The date is the same');
  perform app.require(first or p_reason in ('supplier', 'material', 'payment', 'documents', 'carrier', 'customs', 'other'), 'Choose the reason for the change');
  update public.lo_orders set expected_on = p_date, committed_on = coalesce(committed_on, p_date), updated_at = now() where id = p_order;
  insert into public.order_date_changes (module, order_id, kind, old_date, new_date, reason, party, note)
  values ('lo', p_order, 'delivery', o.expected_on, p_date, case when first then 'first' else p_reason end, nullif(btrim(p_party), ''), nullif(btrim(p_note), ''));
  if not first then
    perform app.order_date_alert('lo', p_order, app.lo_order_head(o), p_date, r.required_on,
      format('%s now %s (was %s, committed %s) – %s', case when o.kind = 'service' then 'completion' else 'delivery' end, to_char(p_date, 'DD Mon YYYY'),
             to_char(o.expected_on, 'DD Mon'), to_char(o.committed_on, 'DD Mon'), app.order_reason_label(p_reason)),
      '/orders/local/' || p_order, app.lo_followers(r.id));
  end if;
end $$;

create table if not exists public.lo_completion_changes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.lo_orders (id) on delete cascade,
  old_date date,
  new_date date not null,
  reason text not null check (reason in ('supplier', 'material', 'payment', 'documents', 'other')),
  note text not null,
  status text not null default 'pending_see' check (status in ('pending_see', 'pending_smp', 'approved', 'rejected')),
  requested_by uuid default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  see_by uuid references public.profiles (id),
  see_at timestamptz,
  smp_by uuid references public.profiles (id),
  smp_at timestamptz,
  decision_note text
);
create index if not exists lo_completion_changes_order on public.lo_completion_changes (order_id, requested_at desc);
alter table public.lo_completion_changes enable row level security;
drop policy if exists lo_completion_changes_read on public.lo_completion_changes;
create policy lo_completion_changes_read on public.lo_completion_changes for select to authenticated using (app.lo_can_read(app.lo_order_request(order_id)));
grant select on public.lo_completion_changes to authenticated;

/** Operations or the SEE ask to move an IPC service's planned completion after the agreement is signed */
create or replace function public.lo_request_completion(p_order uuid, p_date date, p_reason text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; cid uuid; see boolean; head text;
begin
  select * into o from public.lo_orders where id = p_order;
  perform app.require(found and o.status = 'open', 'Order not found or closed');
  see := app.lo_see_of(o.request_id) = auth.uid();
  perform app.require(app.lo_keeper() or see, 'Operations or the project''s SEE ask for the change');
  perform app.require(o.billing = 'ipc' and app.lo_agreement_signed(o.id), 'Before the agreement is signed, Operations sets the date directly');
  perform app.require(p_date is not null and p_date is distinct from o.expected_on, 'Choose the new date');
  perform app.require(p_reason in ('supplier', 'material', 'payment', 'documents', 'other'), 'Choose the reason');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Say what happened');
  perform app.require(not exists (select 1 from public.lo_completion_changes where order_id = o.id and status in ('pending_see', 'pending_smp')), 'A change is already waiting for approval');
  -- the SEE asking is the SEE's approval
  insert into public.lo_completion_changes (order_id, old_date, new_date, reason, note, status, see_by, see_at)
  values (o.id, o.expected_on, p_date, p_reason, btrim(p_note), case when see then 'pending_smp' else 'pending_see' end, case when see then auth.uid() end, case when see then now() end)
  returning id into cid;
  head := concat_ws(' · ', app.lo_order_head(o), 'completion ' || coalesce(to_char(o.expected_on, 'DD Mon'), 'no date') || ' → ' || to_char(p_date, 'DD Mon YYYY'), btrim(p_note));
  if see then
    perform app.notify_many(app.role_users('sm_projects'), 'local_order', 'Completion date change to approve', head, 'normal', 'lo_order', o.id, '/orders/local/' || o.id, null, true);
  else
    perform app.notify(app.lo_see_of(o.request_id), 'local_order', 'Completion date change to approve', head, 'normal', 'lo_order', o.id, '/orders/local/' || o.id, null, true);
  end if;
  return cid;
end $$;

/** The SEE, then SM Projects: approve or reject; on the last approval the planned completion moves (kept in the date history) */
create or replace function public.lo_decide_completion(p_change uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.lo_completion_changes; o public.lo_orders; r public.lo_requests; head text;
begin
  select * into c from public.lo_completion_changes where id = p_change for update;
  perform app.require(found, 'Change not found');
  select * into o from public.lo_orders where id = c.order_id for update;
  select * into r from public.lo_requests where id = o.request_id;
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  head := concat_ws(' · ', app.lo_order_head(o), 'completion ' || coalesce(to_char(c.old_date, 'DD Mon'), 'no date') || ' → ' || to_char(c.new_date, 'DD Mon YYYY'));
  if c.status = 'pending_see' then
    perform app.require(app.lo_see_of(o.request_id) = auth.uid() or app.has_role('senior_elec_engineer'), 'The project''s SEE approves first');
    update public.lo_completion_changes set status = case when p_approve then 'pending_smp' else 'rejected' end, see_by = auth.uid(), see_at = now(),
           decision_note = nullif(btrim(p_note), '') where id = c.id;
    if p_approve then
      perform app.notify_many(app.role_users('sm_projects'), 'local_order', 'Completion date change to approve', head || ' · ' || c.note, 'normal', 'lo_order', o.id, '/orders/local/' || o.id, null, true);
    end if;
  elsif c.status = 'pending_smp' then
    perform app.require(app.has_role('sm_projects'), 'SM Projects approves after the SEE');
    update public.lo_completion_changes set status = case when p_approve then 'approved' else 'rejected' end, smp_by = auth.uid(), smp_at = now(),
           decision_note = coalesce(nullif(btrim(p_note), ''), decision_note) where id = c.id;
    if p_approve then
      update public.lo_orders set expected_on = c.new_date, committed_on = coalesce(committed_on, c.new_date), updated_at = now() where id = o.id;
      insert into public.order_date_changes (module, order_id, kind, old_date, new_date, reason, party, note)
      values ('lo', o.id, 'delivery', o.expected_on, c.new_date, case when o.expected_on is null then 'first' else c.reason end, o.supplier, c.note || ' (approved by the SEE and SM Projects)');
      if o.expected_on is not null then
        perform app.order_date_alert('lo', o.id, app.lo_order_head(o), c.new_date, r.required_on,
          format('completion now %s (was %s) – %s', to_char(c.new_date, 'DD Mon YYYY'), to_char(o.expected_on, 'DD Mon'), app.order_reason_label(c.reason)),
          '/orders/local/' || o.id, app.lo_followers(r.id));
      end if;
    end if;
  else
    perform app.require(false, 'Already decided');
  end if;
  if not p_approve or c.status = 'pending_smp' then
    perform app.notify_many(array[c.requested_by] || app.role_users('operations_exec'), 'local_order', case when p_approve then 'Completion date changed' else 'Completion date change rejected' end,
      concat_ws(' · ', head, nullif(btrim(p_note), '')), 'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  end if;
end $$;
grant execute on function public.lo_request_completion(uuid, date, text, text), public.lo_decide_completion(uuid, boolean, text) to authenticated;

select app.purge_guard_triggers();
select app.fix_function_owners();
