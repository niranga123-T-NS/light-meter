-- Local orders: clearing an invoice's payment (Undo payment) reopens a closed order – it is no longer "all invoices paid".
create or replace function app.lo_unpaid_reopens() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.purging', true) = 'on' then return null; end if;
  if old.status = 'paid' and new.status <> 'paid' then
    delete from public.lo_steps where order_id = new.order_id and step = 'closed';
    update public.lo_orders set status = 'open', updated_at = now() where id = new.order_id and status = 'completed';
    update public.lo_requests r set status = 'open', updated_at = now() from public.lo_orders o where o.id = new.order_id and r.id = o.request_id and r.status = 'closed';
  end if;
  return null;
end $$;
drop trigger if exists lo_unpaid_reopens on public.lo_invoices;
create trigger lo_unpaid_reopens after update of status on public.lo_invoices for each row execute function app.lo_unpaid_reopens();

-- orders already closed while an invoice is unpaid or still in approval: reopen them
delete from public.lo_steps s using public.lo_orders o
 where s.order_id = o.id and s.step = 'closed'
   and (not exists (select 1 from public.lo_invoices i where i.order_id = o.id and i.status = 'paid')
        or exists (select 1 from public.lo_invoices i where i.order_id = o.id and i.status = 'open'));
update public.lo_orders o set status = 'open', updated_at = now()
 where o.status = 'completed' and not exists (select 1 from public.lo_steps s where s.order_id = o.id and s.step = 'closed');
update public.lo_requests r set status = 'open', updated_at = now()
 where r.status = 'closed' and exists (select 1 from public.lo_orders o where o.request_id = r.id and o.status = 'open');

select app.purge_guard_triggers();
select app.fix_function_owners();
