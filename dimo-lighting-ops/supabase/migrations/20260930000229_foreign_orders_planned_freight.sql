-- Foreign orders (TESTING): planned freight (sea / air / courier) on the import order, known before the shipment is booked.
-- A new shipment starts with it; when an order without one is put on a shipment, it takes the shipment's mode.

alter table public.fo_orders add column if not exists planned_mode text check (planned_mode in ('sea', 'air', 'courier'));

create or replace function public.fo_set_planned_mode(p_order uuid, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records foreign orders');
  perform app.require(p_mode is null or p_mode in ('sea', 'air', 'courier'), 'Sea, air or courier?');
  update public.fo_orders set planned_mode = case when kind = 'material' then p_mode end, updated_at = now() where id = p_order;
  perform app.require(found, 'Import order not found');
end $$;
grant execute on function public.fo_set_planned_mode(uuid, text) to authenticated;

create or replace function app.fo_shipment_mode_to_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.fo_orders set planned_mode = (select mode from public.fo_shipments where id = new.shipment_id)
   where id = new.order_id and planned_mode is null;
  return new;
end $$;
drop trigger if exists fo_shipment_mode_to_order on public.fo_shipment_orders;
create trigger fo_shipment_mode_to_order after insert on public.fo_shipment_orders for each row execute function app.fo_shipment_mode_to_order();
update public.fo_orders o set planned_mode = s.mode from public.fo_shipment_orders so join public.fo_shipments s on s.id = so.shipment_id
 where so.order_id = o.id and o.planned_mode is null;
