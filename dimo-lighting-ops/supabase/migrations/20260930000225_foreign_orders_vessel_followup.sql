-- Foreign orders (TESTING): vessel follow-up without a live tracker.
--  * The shipment keeps the vessel's IMO / MMSI number and the container numbers, for one-tap tracking links in the app
--    (MarineTraffic, VesselFinder, the shipping line's own tracking) and the estimated position on the route map.
--  * Every morning: a reminder to Ops for ships in transit with no position or tracking check for 3 days, and an alert when the
--    ETA has passed without an arrival notice (Ops, the sales person and the SEE).

alter table public.fo_shipments add column if not exists imo text check (imo is null or imo ~ '^[0-9]{7}$');
alter table public.fo_shipments add column if not exists mmsi text check (mmsi is null or mmsi ~ '^[0-9]{9}$');
alter table public.fo_shipments add column if not exists container_nos text;

do $$
declare def text;
begin
  def := pg_get_functiondef('public.fo_save_shipment(uuid, jsonb)'::regprocedure);
  perform app.require(position('eta = new_eta, notes = nullif(btrim(p ->> ''notes''), ''''), updated_at = now()' in def) > 0, 'fo_save_shipment anchor not found');
  def := replace(def, 'eta = new_eta, notes = nullif(btrim(p ->> ''notes''), ''''), updated_at = now()',
    'eta = new_eta, notes = nullif(btrim(p ->> ''notes''), ''''), imo = nullif(regexp_replace(coalesce(p ->> ''imo'', ''''), ''\D'', '''', ''g''), ''''), '
    || 'mmsi = nullif(regexp_replace(coalesce(p ->> ''mmsi'', ''''), ''\D'', '''', ''g''), ''''), container_nos = nullif(upper(btrim(p ->> ''container_nos'')), ''''), updated_at = now()');
  execute def;
end $$;

create or replace function public.fo_transit_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; s public.fo_shipments; n int := 0; last date; who uuid[]; o public.fo_orders; heads text;
begin
  for s in select * from public.fo_shipments x where x.arrived_on is null and x.etd is not null and x.etd <= today
             and exists (select 1 from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = x.id and fo.status = 'open') loop
    heads := (select string_agg(fo.code, ', ' order by fo.code) from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = s.id and fo.status = 'open');
    -- no position or tracking check for 3 days
    last := greatest(s.last_checked_on, (select max((at at time zone app.tz())::date) from public.fo_positions where shipment_id = s.id), s.etd);
    if today - last >= 3 then
      perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', 'Check the vessel position',
        format('%s · %s %s · last checked %s – open the tracking link and record the last known position', s.code, coalesce(s.vessel_flight, s.mode), heads, to_char(last, 'DD Mon')),
        'normal', null, null, '/orders/foreign/shipment/' || s.id, format('fo_track:%s:%s', s.id, today));
      n := n + 1;
    end if;
    -- ETA passed, no arrival notice
    if s.eta is not null and s.eta < today then
      who := app.role_users('operations_exec');
      for o in select fo.* from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = s.id and fo.status = 'open' loop
        who := who || app.fo_followers(o.handover_id);
      end loop;
      perform app.notify_many(who, 'foreign_order', 'ETA passed – no arrival yet',
        format('%s · %s · ETA was %s · %s', s.code, coalesce(s.vessel_flight, s.mode), to_char(s.eta, 'DD Mon'), heads), 'normal', null, null,
        '/orders/foreign/shipment/' || s.id, format('fo_eta_passed:%s:%s', s.id, s.eta));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.fo_transit_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.fo_transit_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('fo-transit-tick', '10 3 * * *', 'select public.fo_transit_tick()');   -- 08:40 Sri Lanka time
  end if;
end $$;
