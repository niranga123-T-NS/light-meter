-- Multi-flight air shipments – the follow-up:
--  1. Connection time at each transit (the next flight's departure – scheduled, or actual – against the previous flight's
--     arrival): under 3 hours "Tight connection", negative "Connection likely missed" (Ops).
--  2. Hourly: a flight landed at transit 6 hours ago and the cargo not checked since → "Check the AWB" (Ops, daily).
--  3. The next flight departed a day ago and the cargo not confirmed on it → "Cargo on board not confirmed" (Ops, SM Projects).
--  4. The first flight departed and the flight to Colombo still not entered → daily nudge to Ops.
--  5. A one-line air status (where the cargo is now) for the shipment, the import order, the material request and the list.
--  6. Sales, the SEE and the requester hear of a multi-flight shipment only when its Colombo ETA moves (and its landing in
--     Sri Lanka, offloading, cancellation); Ops gets every flight event.

alter table public.fo_flight_legs add column if not exists dep_sched_at timestamptz;
alter table public.fo_flight_legs add column if not exists connection_min int;

drop type if exists app.fo_flight cascade;
create type app.fo_flight as (seq int, leg_id uuid, flight text, from_ap text, to_ap text, etd date, departed_at timestamptz, dep_sched_at timestamptz, arrival_at timestamptz, landed_at timestamptz, final boolean);

/** The flights of an air shipment in order: 1 is the shipment's own, then the later ones */
create or replace function app.fo_flights(p_shipment uuid) returns setof app.fo_flight
language sql stable security definer set search_path = public as $$
  select 1, null::uuid, s.vessel_flight, s.pol,
         coalesce(nullif(split_part(coalesce(s.flight_route, ''), ' → ', 2), ''), case when s.multi_leg then split_part(coalesce(s.via, ''), ',', 1) else s.pod end),
         s.etd, s.flight_departed_at, null::timestamptz, s.flight_arrival_at, s.flight_landed_at, not s.multi_leg
    from public.fo_shipments s where s.id = p_shipment
  union all
  select l.seq, l.id, l.flight, l.from_ap, l.to_ap, l.etd, l.departed_at, l.dep_sched_at, l.arrival_at, l.landed_at, app.fo_is_destination(l.to_ap)
    from public.fo_flight_legs l where l.shipment_id = p_shipment
  order by 1
$$;

/** 1. The connection at each transit: tight (< 3 h) or likely missed – told to Ops once each */
create or replace function app.fo_connection_check(p_shipment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.fo_shipments; f app.fo_flight; prev app.fo_flight; mins int; dep timestamptz; prev_arr timestamptz; kind text; msg text;
begin
  select * into s from public.fo_shipments where id = p_shipment;
  if not found or not s.multi_leg or s.arrived_on is not null then return; end if;
  for f in select * from app.fo_flights(p_shipment) loop
    if f.seq > 1 then
      prev_arr := coalesce(prev.landed_at, prev.arrival_at);
      dep := coalesce(f.departed_at, f.dep_sched_at);
      kind := null; mins := null;
      if prev_arr is not null and dep is not null then
        mins := floor(extract(epoch from dep - prev_arr) / 60);
        update public.fo_flight_legs set connection_min = mins where id = f.leg_id;
        if mins < 0 then kind := 'Connection likely missed';
        elsif mins < 180 and f.departed_at is null then kind := 'Tight connection'; end if;
      elsif prev_arr is not null and f.etd is not null and f.etd < (prev_arr at time zone app.tz())::date then
        kind := 'Connection likely missed';
      end if;
      if kind is not null and f.landed_at is null then
        msg := format('%s · %s at %s: %s lands %s, %s departs %s%s – check the AWB on the airline site', s.code, kind, coalesce(f.from_ap, prev.to_ap, 'the transit airport'),
                      prev.flight, coalesce(to_char(prev_arr at time zone app.tz(), 'DD Mon HH24:MI'), '?'), f.flight,
                      coalesce(to_char(dep at time zone app.tz(), 'DD Mon HH24:MI'), to_char(f.etd, 'DD Mon')),
                      case when mins is not null then format(' (%s h %s)', mins / 60, lpad((abs(mins) % 60)::text, 2, '0')) else '' end);
        perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', kind, msg, case when kind = 'Tight connection' then 'normal' else 'critical' end::public.priority,
          null, null, '/orders/foreign/shipment/' || s.id, format('fo_conn:%s:%s:%s', f.leg_id, kind, coalesce(to_char(dep, 'YYYYMMDDHH24'), f.etd::text)));
      end if;
    end if;
    prev := f;
  end loop;
end $$;

/** 5. Where an air shipment's cargo is now, in one line */
create or replace function app.fo_air_line(p_shipment uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare s public.fo_shipments; f app.fo_flight; last_landed app.fo_flight; flying app.fo_flight; nxt app.fo_flight; t text; none app.fo_flight;
begin
  select * into s from public.fo_shipments where id = p_shipment;
  if not found or s.mode <> 'air' then return null; end if;
  if s.arrived_on is not null then return 'Arrived ' || to_char(s.arrived_on, 'DD Mon'); end if;
  for f in select * from app.fo_flights(p_shipment) loop
    if f.landed_at is not null then last_landed := f; flying := none; nxt := none;
    elsif f.departed_at is not null then flying := f;
    elsif nxt.seq is null then nxt := f; end if;
  end loop;
  t := case when s.multi_leg then '✈ ' else '' end;
  if flying.seq is not null then
    return t || format('On %s → %s%s', flying.flight, coalesce(flying.to_ap, '?'), coalesce(', lands ' || to_char(flying.arrival_at at time zone app.tz(), 'DD Mon HH24:MI'), ''));
  elsif last_landed.seq is not null and last_landed.final then
    return t || format('Landed %s %s – clearing next', coalesce(last_landed.to_ap, 'Colombo'), to_char(last_landed.landed_at at time zone app.tz(), 'DD Mon HH24:MI'));
  elsif last_landed.seq is not null then
    return t || format('At %s', coalesce(last_landed.to_ap, 'transit')) ||
           case when nxt.seq is not null then format(' · next %s %s', nxt.flight, coalesce(to_char(nxt.dep_sched_at at time zone app.tz(), 'DD Mon HH24:MI'), to_char(nxt.etd, 'DD Mon'), ''))
                else ' · onward flight not confirmed yet' end;
  elsif nxt.seq is not null then
    return t || format('Booked %s%s', nxt.flight, coalesce(' · ' || to_char(nxt.etd, 'DD Mon'), '')) || case when s.multi_leg then ' · transshipment' else '' end;
  end if;
  return null;
end $$;

/** The air status line of each import order (on an air shipment) the caller may read */
create or replace function public.fo_air_lines(p_orders uuid[]) returns table (order_id uuid, line text)
language sql stable security definer set search_path = public as $$
  select so.order_id, app.fo_air_line(so.shipment_id)
    from public.fo_shipment_orders so join public.fo_shipments s on s.id = so.shipment_id
   where so.order_id = any(p_orders) and s.mode = 'air' and app.fo_can_read(app.fo_order_handover(so.order_id))
$$;
/** … and of each material request sent for import */
create or replace function public.mr_air_lines(p_mrs uuid[]) returns table (mr_id uuid, line text)
language sql stable security definer set search_path = public as $$
  select h.mr_id, string_agg(distinct app.fo_air_line(so.shipment_id), ' | ')
    from public.fo_handovers h join public.fo_orders o on o.handover_id = h.id
    join public.fo_shipment_orders so on so.order_id = o.id join public.fo_shipments s on s.id = so.shipment_id
   where h.mr_id = any(p_mrs) and s.mode = 'air' and s.arrived_on is null and auth.uid() is not null
   group by h.mr_id
$$;
grant execute on function public.fo_air_lines(uuid[]), public.mr_air_lines(uuid[]) to authenticated;

/** 2–4. Hourly follow-up of multi-flight shipments in the air */
create or replace function public.fo_air_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare s public.fo_shipments; f app.fo_flight; tr app.fo_flight; nxt app.fo_flight; none app.fo_flight; n int := 0; today date := (p_at at time zone app.tz())::date; confirmed boolean;
begin
  for s in select * from public.fo_shipments x where x.mode = 'air' and x.multi_leg and x.arrived_on is null
             and exists (select 1 from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = x.id and fo.status = 'open') loop
    tr := none; nxt := none;
    for f in select * from app.fo_flights(s.id) loop
      if f.landed_at is not null and not f.final then tr := f; nxt := none;
      elsif tr.seq is not null and nxt.seq is null and f.seq > tr.seq then nxt := f; end if;
    end loop;
    confirmed := coalesce(tr.seq is not null and s.cargo_status in ('on_next', 'arrived') and s.cargo_checked_at >= tr.landed_at, false);
    -- 2. landed at transit 6 hours ago, the cargo not checked since
    if tr.seq is not null and tr.landed_at < p_at - interval '6 hours' and not confirmed and (nxt.seq is null or nxt.departed_at is null) then
      perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', 'Check the AWB – cargo on the next flight?',
        format('%s · AWB %s · %s landed at %s %s – check the airline site and record the cargo status%s', s.code, coalesce(s.bl_awb, '?'), tr.flight, coalesce(tr.to_ap, 'transit'),
               to_char(tr.landed_at at time zone app.tz(), 'DD Mon HH24:MI'), coalesce(' (next ' || nxt.flight || ')', ' and the next flight')),
        'normal', null, null, '/orders/foreign/shipment/' || s.id, format('fo_awb:%s:%s', s.id, today));
      n := n + 1;
    end if;
    -- 3. the next flight left a day ago, the cargo not confirmed on it
    if nxt.departed_at is not null and nxt.departed_at < p_at - interval '1 day' and not confirmed then
      perform app.notify_many(app.role_users('operations_exec') || app.role_users('sm_projects'), 'foreign_order', 'Cargo on board not confirmed',
        format('%s · AWB %s · %s departed %s %s – the cargo is not confirmed on it; check the airline site', s.code, coalesce(s.bl_awb, '?'), nxt.flight, coalesce(nxt.from_ap, ''),
               to_char(nxt.departed_at at time zone app.tz(), 'DD Mon HH24:MI')),
        'critical', null, null, '/orders/foreign/shipment/' || s.id, format('fo_unconfirmed:%s:%s', s.id, today));
      n := n + 1;
    end if;
    -- 4. on the way, the flight to Colombo still not entered
    if s.flight_departed_at is not null and not exists (select 1 from public.fo_flight_legs l where l.shipment_id = s.id and app.fo_is_destination(l.to_ap)) then
      perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', 'Flight to Colombo not entered',
        format('%s · AWB %s · departed %s – enter the onward flight(s) from the forwarder or the airline site', s.code, coalesce(s.bl_awb, '?'), to_char(s.flight_departed_at at time zone app.tz(), 'DD Mon')),
        'normal', null, null, '/orders/foreign/shipment/' || s.id, format('fo_noleg:%s:%s', s.id, today));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.fo_air_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.fo_air_tick(timestamptz) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('fo-air-tick', '5 * * * *', 'select public.fo_air_tick()');   -- hourly
  end if;
end $$;

/** 6. A multi-flight shipment's Colombo ETA moved: Sales, the SEE and the requester are told (Ops follows every flight) */
create or replace function app.fo_multi_eta_told() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.fo_orders;
begin
  if current_setting('app.purging', true) = 'on' then return new; end if;
  if new.multi_leg and new.arrived_on is null and old.eta is not null and new.eta is distinct from old.eta then
    for o in select fo.* from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = new.id and fo.status = 'open' loop
      perform app.notify_many(app.fo_followers(o.handover_id), 'foreign_order', 'Arrival in Colombo moved',
        format('%s · %s now expected in Colombo %s (was %s) – transshipment; contact Ops for details', app.fo_order_head(o), new.code, to_char(new.eta, 'DD Mon YYYY'), to_char(old.eta, 'DD Mon')),
        'normal', 'fo_order', o.id, '/orders/foreign/' || o.id, format('fo_meta:%s:%s', o.id, new.eta));
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists fo_multi_eta_told on public.fo_shipments;
create trigger fo_multi_eta_told after update of eta on public.fo_shipments for each row execute function app.fo_multi_eta_told();

drop function if exists app.fo_tell_shipment(uuid, text, text, text);
create or replace function app.fo_tell_shipment(p_shipment uuid, p_title text, p_msg text, p_priority text, p_followers boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare s public.fo_shipments; o public.fo_orders;
begin
  select * into s from public.fo_shipments where id = p_shipment;
  perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', p_title, format('%s · %s', s.code, p_msg), p_priority::public.priority, null, null,
    '/orders/foreign/shipment/' || s.id, format('fo_leg:%s:%s:%s', s.id, p_title, md5(p_msg)));
  if not p_followers then return; end if;
  for o in select fo.* from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = s.id and fo.status = 'open' loop
    perform app.notify_many(app.fo_followers(o.handover_id), 'foreign_order', p_title, app.fo_order_head(o) || ' · ' || p_msg,
      'normal', 'fo_order', o.id, '/orders/foreign/' || o.id, format('fo_leg:%s:%s:%s', o.id, p_title, md5(p_msg)));
  end loop;
end $$;

create or replace function public.fo_save_leg(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare l public.fo_flight_legs; s public.fo_shipments; lid uuid; fl text := upper(btrim(coalesce(p ->> 'flight', ''))); d date := nullif(p ->> 'etd', '')::date;
begin
  perform app.require(app.fo_keeper(), 'Operations records shipments');
  if p_id is not null then
    select * into l from public.fo_flight_legs where id = p_id for update;
    perform app.require(found, 'Flight not found');
  end if;
  select * into s from public.fo_shipments where id = coalesce(l.shipment_id, nullif(p ->> 'shipment_id', '')::uuid) for update;
  perform app.require(s.id is not null and s.mode = 'air', 'Only an air shipment has flights');
  perform app.require(s.arrived_on is null, 'The shipment has arrived');
  perform app.require(fl ~ '[A-Z0-9]{2}\s*-?\s*[0-9]{1,4}', 'Enter the flight no., e.g. EK 650');
  perform app.require(d is not null, 'Enter the flight date');
  perform app.require(l.id is null or (l.flight = fl and l.etd = d) or coalesce(btrim(p ->> 'note'), '') <> '', 'Give the reason for the change (e.g. rebooked by the airline)');
  update public.fo_shipments set multi_leg = true, updated_at = now() where id = s.id;
  if l.id is null then
    insert into public.fo_flight_legs (shipment_id, seq, flight, from_ap, to_ap, etd, note)
    values (s.id, coalesce((select max(seq) from public.fo_flight_legs where shipment_id = s.id), 1) + 1, fl, nullif(btrim(p ->> 'from'), ''), nullif(btrim(p ->> 'to'), ''), d,
            nullif(btrim(p ->> 'note'), ''))
    returning id into lid;
    perform app.fo_tell_shipment(s.id, 'Next flight entered', format('%s %s → %s on %s', fl, coalesce(nullif(btrim(p ->> 'from'), ''), '?'), coalesce(nullif(btrim(p ->> 'to'), ''), '?'), to_char(d, 'DD Mon YYYY')), 'normal', false);
  else
    lid := l.id;
    update public.fo_flight_legs set flight = fl, from_ap = nullif(btrim(p ->> 'from'), ''), to_ap = nullif(btrim(p ->> 'to'), ''), etd = d,
           note = coalesce(nullif(btrim(p ->> 'note'), ''), note),
           -- a new flight starts its tracking afresh
           flight_status = case when l.flight = fl and l.etd = d then flight_status end, departed_at = case when l.flight = fl and l.etd = d then departed_at end,
           arrival_at = case when l.flight = fl and l.etd = d then arrival_at end, landed_at = case when l.flight = fl and l.etd = d then landed_at end
     where id = l.id;
    if not (l.flight = fl and l.etd = d) then
      perform app.fo_tell_shipment(s.id, 'Flight changed', format('%s on %s → %s on %s · %s', l.flight, to_char(l.etd, 'DD Mon'), fl, to_char(d, 'DD Mon YYYY'), btrim(p ->> 'note')), 'critical', false);
    end if;
  end if;
  perform app.fo_connection_check(s.id);
  return lid;
end $$;

create or replace function app.fo_leg_ingest(r jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare l public.fo_flight_legs; s public.fo_shipments; st text := nullif(r ->> 'status', ''); dep timestamptz := nullif(r ->> 'departed_at', '')::timestamptz;
        arr timestamptz := nullif(r ->> 'arrival_at', '')::timestamptz; landed timestamptz := nullif(r ->> 'landed_at', '')::timestamptz;
        title text; msg text; final boolean; nxt text; new_eta date; pri text := 'normal';
begin
  select * into l from public.fo_flight_legs where id = (r ->> 'leg')::uuid for update;
  if not found then return; end if;
  select * into s from public.fo_shipments where id = l.shipment_id for update;
  if landed is null and st = 'Arrived' then landed := coalesce(arr, now()); end if;
  final := app.fo_is_destination(coalesce(nullif(r ->> 'arr_iata', ''), l.to_ap)) or app.fo_is_destination(l.to_ap);
  nxt := (select 'next ' || x.flight || coalesce(' on ' || to_char(x.etd, 'DD Mon'), '') from public.fo_flight_legs x where x.shipment_id = s.id and x.seq > l.seq order by x.seq limit 1);
  if landed is not null and l.landed_at is null then
    title := case when final then 'Flight landed' else 'Landed at transit' end;
    msg := format('Flight %s of the shipment · %s landed at %s %s%s', l.seq, l.flight, coalesce(nullif(r ->> 'arr_name', ''), r ->> 'arr_iata', l.to_ap, 'the airport'),
                  to_char(landed at time zone app.tz(), 'DD Mon HH24:MI'),
                  case when final then '' else ' – ' || coalesce(nxt, 'next flight not entered – Ops checks the AWB on the airline site') end);
  elsif st in ('Canceled', 'CanceledUncertain', 'Diverted') and coalesce(l.flight_status, '') <> st then
    title := case when st = 'Diverted' then 'Flight diverted' else 'Flight cancelled' end; pri := 'critical';
    msg := format('Flight %s of the shipment · %s %s – Ops checks the new routing with the forwarder', l.seq, l.flight, lower(title));
  elsif dep is not null and l.departed_at is null then
    title := 'Flight departed';
    msg := format('Flight %s of the shipment · %s departed %s %s%s', l.seq, l.flight, coalesce(nullif(r ->> 'dep_name', ''), r ->> 'dep_iata', l.from_ap, ''),
                  to_char(dep at time zone app.tz(), 'DD Mon HH24:MI'), case when arr is not null then ', expected ' || to_char(arr at time zone app.tz(), 'DD Mon HH24:MI') else '' end);
  elsif arr is not null and l.arrival_at is not null and arr - l.arrival_at >= interval '3 hours' then
    title := 'Flight delayed'; pri := 'critical';
    msg := format('Flight %s of the shipment · %s now expected %s (was %s)', l.seq, l.flight, to_char(arr at time zone app.tz(), 'DD Mon HH24:MI'), to_char(l.arrival_at at time zone app.tz(), 'DD Mon HH24:MI'));
  end if;
  update public.fo_flight_legs set flight_status = coalesce(st, flight_status), departed_at = coalesce(dep, departed_at), arrival_at = coalesce(landed, arr, arrival_at),
         landed_at = coalesce(landed, landed_at), checked_at = now(),
         from_ap = coalesce(from_ap, nullif(r ->> 'dep_iata', '')), to_ap = coalesce(to_ap, nullif(r ->> 'arr_iata', '')),
         dep_sched_at = coalesce(nullif(r ->> 'dep_sched_at', '')::timestamptz, dep_sched_at)
   where id = l.id;
  update public.fo_shipments set last_checked_on = (now() at time zone app.tz())::date,
         last_check_note = format('Flight %s (%s) %s', l.seq, l.flight, coalesce(st, 'checked')), updated_at = now() where id = s.id;
  -- the ETA follows the last flight (the one to Sri Lanka)
  if final and l.seq = (select max(seq) from public.fo_flight_legs where shipment_id = s.id) then
    new_eta := (coalesce(landed, arr) at time zone app.tz())::date;
    if new_eta is not null and new_eta is distinct from s.eta and st is distinct from 'Canceled' then
      update public.fo_shipments set eta = new_eta where id = s.id;
      insert into public.fo_eta_log (shipment_id, eta, note) values (s.id, new_eta, format('Flight check – %s (flight %s)%s', l.flight, l.seq, case when s.eta is null then '' else ', was ' || to_char(s.eta, 'DD Mon YYYY') end));
    end if;
  end if;
  if title is not null then perform app.fo_tell_shipment(s.id, title, msg, pri, title = 'Flight landed' and final); end if;
  perform app.fo_connection_check(s.id);
end $$;

create or replace function public.fo_flight_ingest(p_secret text, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; s public.fo_shipments; n int := 0; st text; dep timestamptz; arr timestamptz; landed timestamptz; route text; heads text;
        o public.fo_orders; msg text; title text; new_eta date;
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  for r in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    -- a later flight of a multi-flight shipment
    if nullif(r ->> 'leg', '') is not null then
      perform app.fo_leg_ingest(r);
      n := n + 1;
      continue;
    end if;
    select * into s from public.fo_shipments where id = (r ->> 'id')::uuid and mode = 'air' for update;
    continue when not found;
    st := nullif(r ->> 'status', '');
    dep := nullif(r ->> 'departed_at', '')::timestamptz;
    arr := nullif(r ->> 'arrival_at', '')::timestamptz;
    landed := nullif(r ->> 'landed_at', '')::timestamptz;
    if landed is null and st = 'Arrived' then landed := coalesce(arr, now()); end if;
    route := nullif(concat_ws(' → ', nullif(r ->> 'dep_iata', ''), nullif(r ->> 'arr_iata', '')), '');
    title := null; msg := null;
    if landed is not null and s.flight_landed_at is null and s.multi_leg then
      -- the first flight of several lands at the transit airport – not the arrival
      title := 'Landed at transit';
      msg := format('%s landed at %s %s – multi-flight shipment: %s', s.vessel_flight, coalesce(nullif(r ->> 'arr_name', ''), r ->> 'arr_iata', 'the transit airport'),
                    to_char(landed at time zone app.tz(), 'DD Mon HH24:MI'),
                    coalesce((select 'next ' || l.flight || coalesce(' on ' || to_char(l.etd, 'DD Mon'), '') from public.fo_flight_legs l where l.shipment_id = s.id order by l.seq limit 1),
                             'next flight not entered – Ops checks the AWB on the airline site'));
    elsif landed is not null and s.flight_landed_at is null then
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
    -- (a multi-flight shipment's ETA follows its last flight, not the first)
    new_eta := case when s.multi_leg then null else (coalesce(landed, arr) at time zone app.tz())::date end;
    if new_eta is not null and new_eta is distinct from s.eta and st is distinct from 'Canceled' then
      update public.fo_shipments set eta = new_eta where id = s.id;
      insert into public.fo_eta_log (shipment_id, eta, note) values (s.id, new_eta, case when s.eta is null then 'From the flight check' else 'Flight check – was ' || to_char(s.eta, 'DD Mon YYYY') end);
    end if;
    if title is not null then
      heads := (select string_agg(fo.code, ', ' order by fo.code) from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = s.id and fo.status = 'open');
      perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', title, format('%s · %s · %s', s.code, heads, msg),
        case when title in ('Flight cancelled', 'Flight diverted', 'Flight delayed') then 'critical' else 'normal' end::public.priority, null, null, '/orders/foreign/shipment/' || s.id,
        format('fo_flight:%s:%s:%s', s.id, title, coalesce(to_char(arr, 'YYYYMMDDHH24'), '')));
      for o in select fo.* from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = s.id and fo.status = 'open' and not s.multi_leg loop
        perform app.notify_many(app.fo_followers(o.handover_id), 'foreign_order', title, app.fo_order_head(o) || ' · ' || msg,
          'normal', 'fo_order', o.id, '/orders/foreign/' || o.id, format('fo_flight:%s:%s:%s', o.id, title, coalesce(to_char(arr, 'YYYYMMDDHH24'), '')));
      end loop;
    end if;
    if s.multi_leg then perform app.fo_connection_check(s.id); end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.fo_flight_ingest(text, jsonb) from public;
grant execute on function public.fo_flight_ingest(text, jsonb) to anon, authenticated;

select app.purge_guard_triggers();
select app.fix_function_owners();
