-- Foreign orders (TESTING): route map. The factory location on the import order, and the last known positions of a shipment
-- recorded by Ops (date and time, place, point on the map) when they check the tracking. No live tracking.

alter table public.fo_orders add column if not exists factory_location text;
alter table public.fo_orders add column if not exists factory_lat double precision;
alter table public.fo_orders add column if not exists factory_lng double precision;

create table public.fo_positions (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.fo_shipments (id) on delete cascade,
  at timestamptz not null,
  place text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  note text,
  recorded_by uuid not null default auth.uid() references public.profiles (id),
  recorded_at timestamptz not null default now()
);
create index on public.fo_positions (shipment_id, at);
alter table public.fo_positions enable row level security;
create policy fo_positions_read on public.fo_positions for select to authenticated using (app.fo_can_read_shipment(shipment_id));
grant select on public.fo_positions to authenticated;

-- p: {at, place, lat, lng, note}
create or replace function public.fo_add_position(p_shipment uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; at timestamptz := nullif(p ->> 'at', '')::timestamptz;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records shipments');
  perform app.require(exists (select 1 from public.fo_shipments where id = p_shipment), 'Shipment not found');
  perform app.require(at is not null and at <= now() + interval '1 hour', 'Enter when the position was seen');
  perform app.require(coalesce(btrim(p ->> 'place'), '') <> '', 'Where is it? (port or place)');
  perform app.require(nullif(p ->> 'lat', '') is not null and nullif(p ->> 'lng', '') is not null, 'Mark the position on the map');
  insert into public.fo_positions (shipment_id, at, place, lat, lng, note)
  values (p_shipment, at, btrim(p ->> 'place'), (p ->> 'lat')::double precision, (p ->> 'lng')::double precision, nullif(btrim(p ->> 'note'), ''))
  returning id into pid;
  update public.fo_shipments set last_checked_on = (now() at time zone app.tz())::date, last_check_note = btrim(p ->> 'place') || coalesce(' – ' || nullif(btrim(p ->> 'note'), ''), ''),
         updated_at = now() where id = p_shipment;
  return pid;
end $$;

create or replace function public.fo_remove_position(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records shipments');
  delete from public.fo_positions where id = p_id;
end $$;

-- Factory location (Ops): the place, and the point once it is found or marked on the map
create or replace function public.fo_set_factory(p_order uuid, p_location text, p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records foreign orders');
  update public.fo_orders set factory_location = nullif(btrim(p_location), ''), factory_lat = p_lat, factory_lng = p_lng, updated_at = now() where id = p_order;
  perform app.require(found, 'Import order not found');
end $$;
grant execute on function public.fo_add_position(uuid, jsonb), public.fo_remove_position(uuid), public.fo_set_factory(uuid, text, double precision, double precision) to authenticated;
