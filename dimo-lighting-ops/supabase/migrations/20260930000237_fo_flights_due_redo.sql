-- Flight check: fo_flights_due created afresh (the date is worked out inside the body, so any error is reported with its
-- cause), then function owners checked again.
create or replace function public.fo_flights_due(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare diag_ctx text; today date;
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  today := (now() at time zone app.tz())::date;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'flight', upper(regexp_replace(s.vessel_flight, '[^A-Za-z0-9]', '', 'g')), 'date', s.etd) order by s.etd)
    from public.fo_shipments s
   where s.mode = 'air' and s.vessel_flight ~ '[A-Za-z0-9]{2}\s*-?\s*[0-9]{1,4}' and s.etd between today - 3 and today + 1
     and s.arrived_on is null and s.flight_landed_at is null and coalesce(s.flight_status, '') not in ('Canceled', 'Diverted')
     and exists (select 1 from public.fo_shipment_orders so join public.fo_orders o on o.id = so.order_id where so.shipment_id = s.id and o.status = 'open')), '[]');
exception when others then
  if sqlstate = 'P0001' then raise; end if;
  get stacked diagnostics diag_ctx = pg_exception_context;
  raise exception '% [role %, owner %, %]', sqlerrm, current_user,
    (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.fo_flights_due(text)'::regprocedure),
    left(replace(diag_ctx, E'\n', ' / '), 400) using errcode = sqlstate;
end $$;
revoke all on function public.fo_flights_due(text) from public;
grant execute on function public.fo_flights_due(text) to anon, authenticated;

select app.fix_function_owners();
