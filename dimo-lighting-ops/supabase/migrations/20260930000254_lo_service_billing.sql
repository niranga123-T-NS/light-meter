-- Local service orders: billed by IPC (work in stages) or by a single invoice. Only an IPC-billed order has work stages
-- (and + IPC per stage); a single-invoice service records "Work completed" directly.

alter table public.lo_orders add column if not exists billing text not null default 'single';
alter table public.lo_orders drop constraint if exists lo_orders_billing_check;
alter table public.lo_orders add constraint lo_orders_billing_check check (billing in ('single', 'ipc'));
-- service orders that already have work stages or IPC invoices are IPC-billed
update public.lo_orders o set billing = 'ipc'
 where o.kind = 'service' and (exists (select 1 from public.lo_work_stages w where w.order_id = o.id)
                               or exists (select 1 from public.lo_invoices i where i.order_id = o.id and i.kind = 'ipc' and i.status <> 'cancelled'));

/** Operations: how a service order is billed */
create or replace function public.lo_set_billing(p_order uuid, p_billing text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders;
begin
  perform app.require(app.lo_keeper(), 'Operations records local orders');
  select * into o from public.lo_orders where id = p_order for update;
  perform app.require(found, 'Order not found');
  perform app.require(p_billing in ('single', 'ipc'), 'IPC or a single invoice?');
  perform app.require(o.kind = 'service' or p_billing = 'single', 'Materials are billed by invoice');
  perform app.require(p_billing = 'ipc' or not exists (select 1 from public.lo_work_stages where order_id = o.id), 'This order has work stages – remove them first');
  update public.lo_orders set billing = p_billing, updated_at = now() where id = o.id;
end $$;
grant execute on function public.lo_set_billing(uuid, text) to authenticated;

-- work stages only for an IPC-billed service
create or replace function app.lo_stage_needs_ipc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.purging', true) = 'on' then return new; end if;
  if (select billing from public.lo_orders where id = new.order_id) <> 'ipc' then
    raise exception 'This service is billed by a single invoice – set it to IPC (work in stages) to record work stages';
  end if;
  return new;
end $$;
drop trigger if exists lo_stage_needs_ipc on public.lo_work_stages;
create trigger lo_stage_needs_ipc before insert on public.lo_work_stages for each row execute function app.lo_stage_needs_ipc();

select app.purge_guard_triggers();
select app.fix_function_owners();
