-- Foreign orders – air shipments on more than one flight (transshipment), tracked with Ops' help:
--  * Ops ticks "more than one flight" when entering the shipment and enters the next flight(s) when known – then or later.
--  * Every flight entered is checked automatically like the first one; the ETA follows the last flight; a flight landing at a
--    transit airport is "Landed at transit", not the arrival.
--  * Until a flight to Sri Lanka (CMB) is entered, the shipment carries a multi-flight warning for Ops ("check the AWB");
--    Sales and the SEE see "transshipment possible – contact Ops for updates".
--  * Ops records what the airline's AWB tracking shows (on the next flight, offloaded / rebooked, arrived); offloaded is told
--    to Sales, the SEE and SM Projects.

alter table public.fo_shipments add column if not exists multi_leg boolean not null default false;
alter table public.fo_shipments add column if not exists cargo_status text check (cargo_status in ('on_next', 'offloaded', 'arrived', 'not_shown'));
alter table public.fo_shipments add column if not exists cargo_note text;
alter table public.fo_shipments add column if not exists cargo_checked_at timestamptz;

create table if not exists public.fo_flight_legs (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.fo_shipments (id) on delete cascade,
  seq int not null check (seq >= 2),
  flight text not null,
  from_ap text,
  to_ap text,
  etd date,
  flight_status text,
  departed_at timestamptz,
  arrival_at timestamptz,
  landed_at timestamptz,
  checked_at timestamptz,
  note text,
  added_by uuid default auth.uid() references public.profiles (id),
  added_at timestamptz not null default now(),
  unique (shipment_id, seq)
);
alter table public.fo_flight_legs enable row level security;
drop policy if exists fo_flight_legs_read on public.fo_flight_legs;
create policy fo_flight_legs_read on public.fo_flight_legs for select to authenticated using (app.fo_can_read_shipment(shipment_id));
grant select on public.fo_flight_legs to authenticated;

/** Does this airport mean Sri Lanka (the destination)? */
create or replace function app.fo_is_destination(p text) returns boolean language sql immutable as $$
  select coalesce(p, '') ~* '(\mCMB\M|colombo|katunayake|bandaranaike|sri lanka|\mHRI\M|mattala)'
$$;

/** Ops: more than one flight (or back to a direct flight) */
create or replace function public.fo_set_multi_leg(p_shipment uuid, p_multi boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.fo_shipments;
begin
  perform app.require(app.fo_keeper(), 'Operations records shipments');
  select * into s from public.fo_shipments where id = p_shipment for update;
  perform app.require(found and s.mode = 'air', 'Only an air shipment has flights');
  perform app.require(p_multi or not exists (select 1 from public.fo_flight_legs where shipment_id = s.id), 'Remove the later flights first');
  if p_multi and not s.multi_leg then
    perform app.fo_tell_shipment(s.id, 'Air shipment on more than one flight',
      'Transshipment possible – the cargo changes flights on the way; Operations follows it and tells you of any change (contact Ops for updates).', 'normal');
  end if;
  update public.fo_shipments set multi_leg = p_multi, updated_at = now() where id = s.id;
end $$;

/** Tell Ops (and the followers of every open order on the shipment) */
create or replace function app.fo_tell_shipment(p_shipment uuid, p_title text, p_msg text, p_priority text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.fo_shipments; o public.fo_orders;
begin
  select * into s from public.fo_shipments where id = p_shipment;
  perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', p_title, format('%s · %s', s.code, p_msg), p_priority::public.priority, null, null,
    '/orders/foreign/shipment/' || s.id, format('fo_leg:%s:%s:%s', s.id, p_title, md5(p_msg)));
  for o in select fo.* from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = s.id and fo.status = 'open' loop
    perform app.notify_many(app.fo_followers(o.handover_id), 'foreign_order', p_title, app.fo_order_head(o) || ' · ' || p_msg,
      'normal', 'fo_order', o.id, '/orders/foreign/' || o.id, format('fo_leg:%s:%s:%s', o.id, p_title, md5(p_msg)));
  end loop;
end $$;

/** Ops: add or change a later flight (p: {shipment_id, flight, from, to, etd, note}) – a change keeps the reason */
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
    perform app.fo_tell_shipment(s.id, 'Next flight entered', format('%s %s → %s on %s', fl, coalesce(nullif(btrim(p ->> 'from'), ''), '?'), coalesce(nullif(btrim(p ->> 'to'), ''), '?'), to_char(d, 'DD Mon YYYY')), 'normal');
  else
    lid := l.id;
    update public.fo_flight_legs set flight = fl, from_ap = nullif(btrim(p ->> 'from'), ''), to_ap = nullif(btrim(p ->> 'to'), ''), etd = d,
           note = coalesce(nullif(btrim(p ->> 'note'), ''), note),
           -- a new flight starts its tracking afresh
           flight_status = case when l.flight = fl and l.etd = d then flight_status end, departed_at = case when l.flight = fl and l.etd = d then departed_at end,
           arrival_at = case when l.flight = fl and l.etd = d then arrival_at end, landed_at = case when l.flight = fl and l.etd = d then landed_at end
     where id = l.id;
    if not (l.flight = fl and l.etd = d) then
      perform app.fo_tell_shipment(s.id, 'Flight changed', format('%s on %s → %s on %s · %s', l.flight, to_char(l.etd, 'DD Mon'), fl, to_char(d, 'DD Mon YYYY'), btrim(p ->> 'note')), 'critical');
    end if;
  end if;
  return lid;
end $$;

create or replace function public.fo_remove_leg(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.fo_flight_legs;
begin
  perform app.require(app.fo_keeper(), 'Operations records shipments');
  select * into l from public.fo_flight_legs where id = p_id;
  perform app.require(found, 'Flight not found');
  perform app.require(l.departed_at is null, 'The flight has departed');
  delete from public.fo_flight_legs where id = l.id;
  update public.fo_flight_legs set seq = seq - 1 where shipment_id = l.shipment_id and seq > l.seq;
end $$;

/** Ops: what the airline's AWB tracking shows */
create or replace function public.fo_cargo_check(p_shipment uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.fo_shipments; o public.fo_orders;
begin
  perform app.require(app.fo_keeper(), 'Operations records shipments');
  select * into s from public.fo_shipments where id = p_shipment for update;
  perform app.require(found and s.mode = 'air', 'Only an air shipment');
  perform app.require(p_status in ('on_next', 'offloaded', 'arrived', 'not_shown'), 'What does the airline show?');
  perform app.require(p_status <> 'offloaded' or coalesce(btrim(p_note), '') <> '', 'Say what happened – the new flight if known');
  update public.fo_shipments set cargo_status = p_status, cargo_note = nullif(btrim(p_note), ''), cargo_checked_at = now(),
         last_checked_on = (now() at time zone app.tz())::date,
         last_check_note = 'AWB on the airline site: ' || case p_status when 'on_next' then 'on the next flight' when 'offloaded' then 'offloaded / rebooked'
                                                                       when 'arrived' then 'arrived' else 'nothing new' end || coalesce(' – ' || nullif(btrim(p_note), ''), ''),
         updated_at = now() where id = s.id;
  if p_status = 'offloaded' then
    perform app.fo_tell_shipment(s.id, 'Cargo offloaded / rebooked', format('AWB %s – %s', coalesce(s.bl_awb, ''), btrim(p_note)), 'critical');
    for o in select fo.* from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = s.id and fo.status = 'open' loop
      perform app.notify_many(app.role_users('sm_projects'), 'foreign_order', 'Cargo offloaded / rebooked', app.fo_order_head(o) || ' · ' || btrim(p_note),
        'critical', 'fo_order', o.id, '/orders/foreign/' || o.id);
    end loop;
  end if;
end $$;
grant execute on function public.fo_set_multi_leg(uuid, boolean), public.fo_save_leg(uuid, jsonb), public.fo_remove_leg(uuid), public.fo_cargo_check(uuid, text, text) to authenticated;

/** The flight check's reading of a later flight */
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
         from_ap = coalesce(from_ap, nullif(r ->> 'dep_iata', '')), to_ap = coalesce(to_ap, nullif(r ->> 'arr_iata', ''))
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
  if title is not null then perform app.fo_tell_shipment(s.id, title, msg, pri); end if;
end $$;

-- the flights to check: each shipment's first flight and every later flight entered
create or replace function public.fo_flights_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare diag_ctx text; today date;
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  today := (now() at time zone app.tz())::date;
  return coalesce((select jsonb_agg(x order by x ->> 'date') from (
    select jsonb_build_object('id', s.id, 'code', s.code, 'flight', upper(regexp_replace(s.vessel_flight, '[^A-Za-z0-9]', '', 'g')), 'date', s.etd) as x
      from public.fo_shipments s
     where s.mode = 'air' and s.vessel_flight ~ '[A-Za-z0-9]{2}\s*-?\s*[0-9]{1,4}' and s.etd between today - 3 and today + 1
       and s.arrived_on is null and s.flight_landed_at is null and coalesce(s.flight_status, '') not in ('Canceled', 'Diverted')
       and exists (select 1 from public.fo_shipment_orders so join public.fo_orders o on o.id = so.order_id where so.shipment_id = s.id and o.status = 'open')
    union all
    select jsonb_build_object('id', s.id, 'leg', l.id, 'code', s.code || ' flight ' || l.seq, 'flight', upper(regexp_replace(l.flight, '[^A-Za-z0-9]', '', 'g')), 'date', l.etd)
      from public.fo_flight_legs l join public.fo_shipments s on s.id = l.shipment_id
     where l.flight ~ '[A-Za-z0-9]{2}\s*-?\s*[0-9]{1,4}' and l.etd between today - 3 and today + 1
       and s.arrived_on is null and l.landed_at is null and coalesce(l.flight_status, '') not in ('Canceled', 'Diverted')
       and exists (select 1 from public.fo_shipment_orders so join public.fo_orders o on o.id = so.order_id where so.shipment_id = s.id and o.status = 'open')) q), '[]');
exception when others then
  if sqlstate = 'P0001' then raise; end if;
  get stacked diagnostics diag_ctx = pg_exception_context;
  raise exception '% [role %, owner %, %]', sqlerrm, current_user,
    (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.fo_flights_due(text)'::regprocedure),
    left(replace(diag_ctx, E'\n', ' / '), 400) using errcode = sqlstate;
end $$;
revoke all on function public.fo_flights_due(text) from public;
grant execute on function public.fo_flights_due(text) to anon, authenticated;

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
      for o in select fo.* from public.fo_shipment_orders so join public.fo_orders fo on fo.id = so.order_id where so.shipment_id = s.id and fo.status = 'open' loop
        perform app.notify_many(app.fo_followers(o.handover_id), 'foreign_order', title, app.fo_order_head(o) || ' · ' || msg,
          'normal', 'fo_order', o.id, '/orders/foreign/' || o.id, format('fo_flight:%s:%s:%s', o.id, title, coalesce(to_char(arr, 'YYYYMMDDHH24'), '')));
      end loop;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.fo_flight_ingest(text, jsonb) from public;
grant execute on function public.fo_flight_ingest(text, jsonb) to anon, authenticated;

select app.fix_function_owners();
