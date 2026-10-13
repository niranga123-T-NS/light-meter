-- Foreign orders (TESTING): automatic flight status for air shipments (AeroDataBox, through a GitHub workflow).
--  * Every few hours the workflow asks for the air shipments to check (flight no. and ETD, not landed yet), looks each flight up
--    and sends back what it found. Nothing to set per shipment.
--  * Recorded on the shipment: flight status, departed / landed times, the expected arrival; positions on the map at the
--    departure and arrival airports; the ETA follows the flight.
--  * Told to Ops, the sales person and the SEE: departed, delayed by 3 hours or more, cancelled / diverted, landed.

alter table public.fo_shipments add column if not exists flight_status text;
alter table public.fo_shipments add column if not exists flight_departed_at timestamptz;
alter table public.fo_shipments add column if not exists flight_arrival_at timestamptz;   -- latest expected (or actual) arrival
alter table public.fo_shipments add column if not exists flight_landed_at timestamptz;
alter table public.fo_shipments add column if not exists flight_route text;               -- e.g. FRA → DXB
alter table public.fo_shipments add column if not exists flight_checked_at timestamptz;

-- positions recorded by the flight check have no person
alter table public.fo_positions alter column recorded_by drop not null;

-- Air shipments to look up: flight no. and ETD entered, not landed, ETD from 3 days ago to tomorrow
create or replace function public.fo_flights_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone app.tz())::date;
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'flight', upper(regexp_replace(s.vessel_flight, '[^A-Za-z0-9]', '', 'g')), 'date', s.etd) order by s.etd)
    from public.fo_shipments s
   where s.mode = 'air' and s.vessel_flight ~ '[A-Za-z0-9]{2}\s*-?\s*[0-9]{1,4}' and s.etd between today - 3 and today + 1
     and s.arrived_on is null and s.flight_landed_at is null and coalesce(s.flight_status, '') not in ('Canceled', 'Diverted')
     and exists (select 1 from public.fo_shipment_orders so join public.fo_orders o on o.id = so.order_id where so.shipment_id = s.id and o.status = 'open')), '[]');
end $$;

-- What the flight check found, one row per shipment:
-- {id, status, dep_iata, dep_name, dep_lat, dep_lng, arr_iata, arr_name, arr_lat, arr_lng, departed_at, arrival_at, landed_at}
create or replace function public.fo_flight_ingest(p_secret text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; s public.fo_shipments; n int := 0; st text; dep timestamptz; arr timestamptz; landed timestamptz; route text; heads text;
        o public.fo_orders; msg text; title text; new_eta date;
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  for r in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    select * into s from public.fo_shipments where id = (r ->> 'id')::uuid and mode = 'air' for update;
    continue when not found;
    st := nullif(r ->> 'status', '');
    dep := nullif(r ->> 'departed_at', '')::timestamptz;
    arr := nullif(r ->> 'arrival_at', '')::timestamptz;
    landed := nullif(r ->> 'landed_at', '')::timestamptz;
    if landed is null and st = 'Arrived' then landed := coalesce(arr, now()); end if;
    route := nullif(concat_ws(' → ', nullif(r ->> 'dep_iata', ''), nullif(r ->> 'arr_iata', '')), '');
    title := null; msg := null;
    if landed is not null and s.flight_landed_at is null then
      title := 'Flight landed';
      msg := format('%s landed at %s %s', s.vessel_flight, coalesce(nullif(r ->> 'arr_name', ''), r ->> 'arr_iata', 'destination'), to_char(landed at time zone app.tz(), 'DD Mon HH24:MI'));
    elsif st in ('Canceled', 'CanceledUncertain', 'Diverted') and coalesce(s.flight_status, '') <> st then
      title := case when st = 'Diverted' then 'Flight diverted' else 'Flight cancelled' end;
      msg := format('%s %s – check the new routing with the forwarder', s.vessel_flight, lower(title));
    elsif dep is not null and s.flight_departed_at is null then
      title := 'Flight departed';
      msg := format('%s departed %s %s%s', s.vessel_flight, coalesce(nullif(r ->> 'dep_name', ''), r ->> 'dep_iata', ''), to_char(dep at time zone app.tz(), 'DD Mon HH24:MI'),
                    case when arr is not null then ', expected ' || to_char(arr at time zone app.tz(), 'DD Mon HH24:MI') else '' end);
    elsif arr is not null and s.flight_arrival_at is not null and arr - s.flight_arrival_at >= interval '3 hours' then
      title := 'Flight delayed';
      msg := format('%s now expected %s (was %s)', s.vessel_flight, to_char(arr at time zone app.tz(), 'DD Mon HH24:MI'), to_char(s.flight_arrival_at at time zone app.tz(), 'DD Mon HH24:MI'));
    end if;
    update public.fo_shipments set flight_status = coalesce(st, flight_status), flight_departed_at = coalesce(dep, flight_departed_at),
           flight_arrival_at = coalesce(landed, arr, flight_arrival_at), flight_landed_at = coalesce(landed, flight_landed_at),
           flight_route = coalesce(route, flight_route), flight_checked_at = now(),
           onboard_at = coalesce(onboard_at, dep), last_checked_on = (now() at time zone app.tz())::date,
           last_check_note = 'Flight ' || coalesce(st, 'checked') || coalesce(' · ' || route, ''), updated_at = now()
     where id = s.id;
    -- positions at the airports (once each)
    if dep is not null and s.flight_departed_at is null and nullif(r ->> 'dep_lat', '') is not null then
      insert into public.fo_positions (shipment_id, at, place, lat, lng, note, recorded_by)
      values (s.id, dep, coalesce(nullif(r ->> 'dep_name', ''), r ->> 'dep_iata', 'Departure airport'), (r ->> 'dep_lat')::float8, (r ->> 'dep_lng')::float8, 'Departed – flight check', null);
    end if;
    if landed is not null and s.flight_landed_at is null and nullif(r ->> 'arr_lat', '') is not null then
      insert into public.fo_positions (shipment_id, at, place, lat, lng, note, recorded_by)
      values (s.id, landed, coalesce(nullif(r ->> 'arr_name', ''), r ->> 'arr_iata', 'Arrival airport'), (r ->> 'arr_lat')::float8, (r ->> 'arr_lng')::float8, 'Landed – flight check', null);
    end if;
    -- the ETA follows the flight (Sri Lanka date), logged like a change by Ops
    new_eta := (coalesce(landed, arr) at time zone app.tz())::date;
    if new_eta is not null and new_eta is distinct from s.eta and st is distinct from 'Canceled' then
      update public.fo_shipments set eta = new_eta where id = s.id;
      insert into public.fo_eta_log (shipment_id, eta, note) values (s.id, new_eta, case when s.eta is null then 'From the flight check' else 'Flight check – was ' || to_char(s.eta, 'DD Mon YYYY') end);
    end if;
    if title is not null then
      heads := (select string_agg(fo.code, ', ' order by fo.code) from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = s.id and fo.status = 'open');
      perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', title, format('%s · %s · %s', s.code, heads, msg),
        case when title in ('Flight cancelled', 'Flight diverted', 'Flight delayed') then 'critical' else 'normal' end::public.priority, null, null, '/orders/foreign/shipment/' || s.id,
        format('fo_flight:%s:%s:%s', s.id, title, coalesce(to_char(arr, 'YYYYMMDDHH24'), '')));
      for o in select fo.* from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = s.id and fo.status = 'open' loop
        perform app.notify_many(app.fo_followers(o.handover_id), 'foreign_order', title, app.fo_order_head(o) || ' · ' || msg,
          'normal', 'fo_order', o.id, '/orders/foreign/' || o.id, format('fo_flight:%s:%s:%s', o.id, title, coalesce(to_char(arr, 'YYYYMMDDHH24'), '')));
      end loop;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.fo_flights_due(text), public.fo_flight_ingest(text, jsonb) from public;
grant execute on function public.fo_flights_due(text), public.fo_flight_ingest(text, jsonb) to anon, authenticated;
