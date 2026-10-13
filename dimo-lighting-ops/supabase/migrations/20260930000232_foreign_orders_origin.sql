-- Foreign orders (TESTING): the manufacturer's full address and the port / airport of loading on the import order.
--  * Known at PO time (e.g. FOB Shanghai), so the route map shows factory → loading port → Sri Lanka before the shipment is booked.
--  * A new shipment takes the loading port from its orders when Ops leaves it empty.

alter table public.fo_orders add column if not exists mfr_address text;
alter table public.fo_orders add column if not exists loading_port text;

create or replace function public.fo_set_origin(p_order uuid, p_address text, p_loading text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records foreign orders');
  update public.fo_orders set mfr_address = nullif(btrim(p_address), ''), loading_port = nullif(btrim(p_loading), ''), updated_at = now() where id = p_order;
  perform app.require(found, 'Import order not found');
end $$;
grant execute on function public.fo_set_origin(uuid, text, text) to authenticated;

do $$
declare def text; a text := 'pol = nullif(btrim(p ->> ''pol''), '''')';
begin
  def := pg_get_functiondef('public.fo_save_shipment(uuid, jsonb)'::regprocedure);
  perform app.require(position(a in def) > 0, 'fo_save_shipment anchor not found');
  def := replace(def, a, 'pol = coalesce(nullif(btrim(p ->> ''pol''), ''''), (select min(fx.loading_port) from public.fo_orders fx '
    || 'where fx.id in (select (x #>> ''{}'')::uuid from jsonb_array_elements(p -> ''order_ids'') x)))');
  execute def;
end $$;
