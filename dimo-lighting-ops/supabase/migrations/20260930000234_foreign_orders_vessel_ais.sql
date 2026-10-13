-- Foreign orders (TESTING): automatic vessel positions for sea shipments (AISstream, through a GitHub workflow).
--  * Morning and evening the workflow asks for the sailed sea shipments with the vessel's MMSI, listens to the AIS stream for
--    them and sends back the latest position and the ship's own reported destination and ETA.
--  * The position goes on the map (as a last known position); the shipment keeps the reported destination / ETA, speed and status.
--  * When the ship reports Colombo (or Sri Lanka) and its ETA is 2 days or more from the shipment's ETA, Ops, the sales person
--    and the SEE are told (once per reported date). The shipment's ETA itself stays with Ops.

alter table public.fo_shipments add column if not exists ais_destination text;
alter table public.fo_shipments add column if not exists ais_eta timestamptz;
alter table public.fo_shipments add column if not exists ais_speed numeric(5, 1);
alter table public.fo_shipments add column if not exists ais_status text;
alter table public.fo_shipments add column if not exists ais_seen_at timestamptz;
alter table public.fo_shipments add column if not exists ais_checked_at timestamptz;

-- Sea shipments to listen for: MMSI entered, sailed (ETD today or before, or on board), not arrived
create or replace function public.fo_vessels_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone app.tz())::date;
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'mmsi', s.mmsi, 'vessel', s.vessel_flight) order by s.etd)
    from public.fo_shipments s
   where s.mode = 'sea' and s.mmsi is not null and s.arrived_on is null and (s.etd <= today or s.onboard_at is not null)
     and exists (select 1 from public.fo_shipment_orders so join public.fo_orders o on o.id = so.order_id where so.shipment_id = s.id and o.status = 'open')), '[]');
end $$;

-- What the AIS check heard, one row per shipment: {id, lat, lng, at, place, speed, status, destination, eta}
create or replace function public.fo_vessel_ingest(p_secret text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; s public.fo_shipments; n int := 0; seen timestamptz; rep_eta timestamptz; dest text; heads text; o public.fo_orders; msg text; lk boolean;
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  for r in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    select * into s from public.fo_shipments where id = (r ->> 'id')::uuid and mode = 'sea' for update;
    continue when not found;
    seen := nullif(r ->> 'at', '')::timestamptz;
    rep_eta := nullif(r ->> 'eta', '')::timestamptz;
    dest := nullif(btrim(r ->> 'destination'), '');
    -- a new position (newer than the last one on the map)
    if seen is not null and nullif(r ->> 'lat', '') is not null and seen <= now() + interval '1 hour'
       and not exists (select 1 from public.fo_positions where shipment_id = s.id and fo_positions.at >= seen) then
      insert into public.fo_positions (shipment_id, at, place, lat, lng, note, recorded_by)
      values (s.id, seen, coalesce(nullif(r ->> 'place', ''), 'AIS position'), (r ->> 'lat')::float8, (r ->> 'lng')::float8,
              concat_ws(' · ', 'AIS', nullif(r ->> 'status', ''), case when nullif(r ->> 'speed', '') is not null then (r ->> 'speed') || ' kn' end,
                        case when dest is not null then 'to ' || dest end), null);
      n := n + 1;
    end if;
    update public.fo_shipments set ais_destination = coalesce(dest, ais_destination), ais_eta = coalesce(rep_eta, ais_eta),
           ais_speed = coalesce(nullif(r ->> 'speed', '')::numeric, ais_speed), ais_status = coalesce(nullif(r ->> 'status', ''), ais_status),
           ais_seen_at = greatest(ais_seen_at, seen), ais_checked_at = now(),
           last_checked_on = case when seen is not null then (now() at time zone app.tz())::date else last_checked_on end,
           last_check_note = case when seen is not null then coalesce(nullif(r ->> 'place', ''), 'AIS position') || coalesce(' – to ' || dest, '') else last_check_note end,
           updated_at = now()
     where id = s.id;
    -- the ship's own ETA to Sri Lanka differs from the shipment's by 2 days or more
    lk := dest ~* '(colombo|lkcmb|lk ?cmb|sri ?lanka|hambantota|lkham)';
    if lk and rep_eta is not null and s.eta is not null and abs((rep_eta at time zone app.tz())::date - s.eta) >= 2 then
      heads := (select string_agg(fo.code, ', ' order by fo.code) from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = s.id and fo.status = 'open');
      msg := format('%s reports ETA %s %s (shipment ETA %s) – confirm with the forwarder', coalesce(s.vessel_flight, 'The vessel'), dest,
                    to_char(rep_eta at time zone app.tz(), 'DD Mon'), to_char(s.eta, 'DD Mon'));
      perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', 'Vessel ETA differs', format('%s · %s · %s', s.code, heads, msg),
        'normal', null, null, '/orders/foreign/shipment/' || s.id, format('fo_ais_eta:%s:%s', s.id, (rep_eta at time zone app.tz())::date));
      for o in select fo.* from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = s.id and fo.status = 'open' loop
        perform app.notify_many(app.fo_followers(o.handover_id), 'foreign_order', 'Vessel ETA differs', app.fo_order_head(o) || ' · ' || msg,
          'normal', 'fo_order', o.id, '/orders/foreign/' || o.id, format('fo_ais_eta:%s:%s', o.id, (rep_eta at time zone app.tz())::date));
      end loop;
    end if;
  end loop;
  return n;
end $$;

revoke all on function public.fo_vessels_due(text), public.fo_vessel_ingest(text, jsonb) from public;
grant execute on function public.fo_vessels_due(text), public.fo_vessel_ingest(text, jsonb) to anon, authenticated;
