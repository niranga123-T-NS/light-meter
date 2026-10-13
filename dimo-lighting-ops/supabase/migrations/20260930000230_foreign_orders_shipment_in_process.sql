-- Foreign orders (TESTING): a shipment is booked within the order's process – an import order goes on a shipment only after its
-- commercial invoice and packing list are confirmed (stage 6). An order can also join a shipment already booked.

create or replace function app.fo_shipment_order_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(exists (select 1 from public.fo_steps where order_id = new.order_id and step = 'cipl_confirmed'),
    format('%s: confirm the commercial invoice and packing list first (stage 6)', (select code from public.fo_orders where id = new.order_id)));
  return new;
end $$;
drop trigger if exists fo_shipment_order_check on public.fo_shipment_orders;
create trigger fo_shipment_order_check before insert on public.fo_shipment_orders for each row execute function app.fo_shipment_order_check();

create or replace function public.fo_add_to_shipment(p_shipment uuid, p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.fo_shipments;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records shipments');
  select * into s from public.fo_shipments where id = p_shipment;
  perform app.require(found, 'Shipment not found');
  perform app.require(s.arrived_on is null, 'This shipment has already arrived');
  perform app.require(exists (select 1 from public.fo_orders where id = p_order and kind = 'material' and status = 'open'), 'Only an open material order goes on a shipment');
  insert into public.fo_shipment_orders (shipment_id, order_id) values (p_shipment, p_order) on conflict do nothing;
end $$;
grant execute on function public.fo_add_to_shipment(uuid, uuid) to authenticated;
