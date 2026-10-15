-- Orders that started before the system: Ops brings a foreign or local order up to date in one go.
--  * Ops picks the last step already done; that step and every step before it that applies (and is not recorded yet) are recorded
--    as "done before the system" on one date (default today) – no notifications, no SLA days, left out of the performance figures.
--  * Delivery / work completed / order closed are still recorded the usual way (delivery notes, work stages, invoices).
--  * Editing a step to its real date turns it into a normal step.

alter table public.fo_steps add column if not exists pre_system boolean not null default false;
alter table public.lo_steps add column if not exists pre_system boolean not null default false;

-- A real date entered later makes it a normal step
create or replace function app.steps_pre_system_off() returns trigger
language plpgsql as $$
begin
  if new.done_on is distinct from old.done_on then new.pre_system := false; end if;
  return new;
end $$;
drop trigger if exists fo_steps_pre_system_off on public.fo_steps;
create trigger fo_steps_pre_system_off before update on public.fo_steps for each row execute function app.steps_pre_system_off();
drop trigger if exists lo_steps_pre_system_off on public.lo_steps;
create trigger lo_steps_pre_system_off before update on public.lo_steps for each row execute function app.steps_pre_system_off();

-- ---------------------------------------------------------------------------
-- Foreign orders

-- Record a step and (first) every step it follows that applies and is not recorded – a hand-over step after order steps covers
-- every open import order. Returns the number of steps recorded.
create or replace function app.fo_catch_mark(p_handover uuid, p_order uuid, p_step text, p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare h public.fo_handovers; o public.fo_orders; d public.fo_step_defs; a public.fo_step_defs; x public.fo_orders; k text; n int := 0;
begin
  select * into h from public.fo_handovers where id = p_handover;
  select * into d from public.fo_step_defs where key = p_step;
  if d.scope = 'h' then p_order := null; else select * into o from public.fo_orders where id = p_order; end if;
  if exists (select 1 from public.fo_steps where handover_id = p_handover and step = p_step and order_id is not distinct from p_order) then return 0; end if;
  foreach k in array app.fo_effective_after(p_handover, p_order, p_step) loop
    select * into a from public.fo_step_defs where key = k;
    if a.scope = 'h' then
      if app.fo_h_applies(a.conds, h) then n := n + app.fo_catch_mark(p_handover, null, k, p_date); end if;
    elsif p_order is not null then
      if app.fo_applies(a.conds, o, h) then n := n + app.fo_catch_mark(p_handover, p_order, k, p_date); end if;
    else
      for x in select * from public.fo_orders where handover_id = p_handover and status <> 'cancelled' loop
        if app.fo_applies(a.conds, x, h) then n := n + app.fo_catch_mark(p_handover, x.id, k, p_date); end if;
      end loop;
    end if;
  end loop;
  insert into public.fo_steps (handover_id, order_id, step, done_on, note, pre_system) values (p_handover, p_order, p_step, p_date, null, true);
  return n + 1;
end $$;
revoke execute on function app.fo_catch_mark(uuid, uuid, text, date) from public, anon, authenticated;

-- Ops: bring an import request (p_order null, a stage 1–3 step) or an import order up to date – everything up to and including p_upto
create or replace function public.fo_catch_up(p_handover uuid, p_order uuid, p_upto text, p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare h public.fo_handovers; o public.fo_orders; d public.fo_step_defs; last date;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records the steps');
  select * into d from public.fo_step_defs where key = p_upto;
  perform app.require(found, 'Unknown step');
  perform app.require(d.key <> 'delivered', 'Record the delivery itself as usual');
  if d.scope = 'o' then
    select * into o from public.fo_orders where id = p_order;
    perform app.require(found, 'Import order not found');
    perform app.require(o.status = 'open', 'The import order is closed');
    p_handover := o.handover_id;
  else
    p_order := null;
  end if;
  select * into h from public.fo_handovers where id = p_handover;
  perform app.require(found, 'Import request not found');
  perform app.require(h.status = 'open', 'The import request is closed');
  perform app.require(case when d.scope = 'o' then app.fo_applies(d.conds, o, h) else app.fo_h_applies(d.conds, h) end, 'This step does not apply to these terms');
  perform app.require(p_date is not null and p_date <= (now() at time zone app.tz())::date, 'Enter the date (not in the future)');
  select max(done_on) into last from public.fo_steps where handover_id = p_handover;
  perform app.require(last is null or p_date >= last, format('The date cannot be before the steps already recorded (%s)', to_char(last, 'DD Mon YYYY')));
  perform app.require(not exists (select 1 from public.fo_steps where handover_id = p_handover and step = p_upto and order_id is not distinct from p_order), 'This step is already recorded');
  return app.fo_catch_mark(p_handover, p_order, p_upto, p_date);
end $$;
revoke all on function public.fo_catch_up(uuid, uuid, text, date) from public, anon;
grant execute on function public.fo_catch_up(uuid, uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Local orders

create or replace function app.lo_catch_mark(p_request uuid, p_order uuid, p_step text, p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare r public.lo_requests; o public.lo_orders; d public.lo_step_defs; a public.lo_step_defs; k text; n int := 0;
begin
  select * into r from public.lo_requests where id = p_request;
  select * into d from public.lo_step_defs where key = p_step;
  if d.scope = 'r' then p_order := null; else select * into o from public.lo_orders where id = p_order; end if;
  if exists (select 1 from public.lo_steps where request_id = p_request and step = p_step and order_id is not distinct from p_order) then return 0; end if;
  foreach k in array app.lo_effective_after(p_request, p_order, p_step) loop
    select * into a from public.lo_step_defs where key = k;
    if a.scope = 'r' then
      if app.lo_r_applies(a.conds, r) then n := n + app.lo_catch_mark(p_request, null, k, p_date); end if;
    elsif p_order is not null then
      if app.lo_applies(a.conds, o) then n := n + app.lo_catch_mark(p_request, p_order, k, p_date); end if;
    end if;
  end loop;
  insert into public.lo_steps (request_id, order_id, step, done_on, note, pre_system) values (p_request, p_order, p_step, p_date, null, true);
  return n + 1;
end $$;
revoke execute on function app.lo_catch_mark(uuid, uuid, text, date) from public, anon, authenticated;

-- Ops: bring a local request (p_order null) or a local order up to date – everything up to and including p_upto
create or replace function public.lo_catch_up(p_request uuid, p_order uuid, p_upto text, p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare r public.lo_requests; o public.lo_orders; d public.lo_step_defs; last date;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records the steps');
  select * into d from public.lo_step_defs where key = p_upto;
  perform app.require(found, 'Unknown step');
  perform app.require(d.key not in ('delivered', 'work_done', 'closed'), 'Record deliveries, work and invoices as usual');
  if d.scope = 'o' then
    select * into o from public.lo_orders where id = p_order;
    perform app.require(found, 'Order not found');
    perform app.require(o.status = 'open', 'The order is closed');
    p_request := o.request_id;
  else
    p_order := null;
  end if;
  select * into r from public.lo_requests where id = p_request;
  perform app.require(found, 'Request not found');
  perform app.require(r.status = 'open', 'The request is not open');
  perform app.require(case when d.scope = 'o' then app.lo_applies(d.conds, o) else app.lo_r_applies(d.conds, r) end, 'This step does not apply to this order');
  perform app.require(p_date is not null and p_date <= (now() at time zone app.tz())::date, 'Enter the date (not in the future)');
  select max(done_on) into last from public.lo_steps where request_id = p_request;
  perform app.require(last is null or p_date >= last, format('The date cannot be before the steps already recorded (%s)', to_char(last, 'DD Mon YYYY')));
  perform app.require(not exists (select 1 from public.lo_steps where request_id = p_request and step = p_upto and order_id is not distinct from p_order), 'This step is already recorded');
  return app.lo_catch_mark(p_request, p_order, p_upto, p_date);
end $$;
revoke all on function public.lo_catch_up(uuid, uuid, text, date) from public, anon;
grant execute on function public.lo_catch_up(uuid, uuid, text, date) to authenticated;

select app.purge_guard_triggers();
select app.fix_function_owners();
