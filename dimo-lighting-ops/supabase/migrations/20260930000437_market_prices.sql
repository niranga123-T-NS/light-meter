-- Market prices on the Home dashboards (shown to the same people as the exchange rates): copper and aluminium (LME cash
-- settlement, USD per tonne), steel hot-rolled coil (Shanghai Futures Exchange) and PVC (Dalian Commodity Exchange), both
-- CNY per tonne with the USD worked out at the day's USD/CNY rate. Fetched automatically every day by the GitHub workflow
-- "DIMO – market prices"; LKR at the Central Bank USD rate of the day (or the last before it).
-- Sea freight from China: the SCFI comprehensive index (Shanghai Shipping Exchange, weekly, index points – kept in `usd`).

create table public.market_prices (
  item text not null check (item in ('copper', 'aluminium', 'steel_hrc', 'pvc', 'scfi')),
  price_date date not null,
  price numeric(14, 2) not null check (price > 0),           -- as quoted, per tonne
  currency text not null check (currency in ('USD', 'CNY', 'PTS')),        -- PTS: index points (SCFI)
  usd numeric(14, 2) not null check (usd > 0),               -- USD per tonne (SCFI: index points)
  fx_cny numeric(10, 4),                                     -- CNY per USD used for the conversion
  at timestamptz not null default now(),
  primary key (item, price_date)
);
alter table public.market_prices enable row level security;
create policy market_prices_read on public.market_prices for select to authenticated using (app.sees_fx());
grant select on public.market_prices to authenticated;

-- From the workflow (the dispatch secret). A price more than 25 % away from the item's previous one is skipped as a misreading.
create or replace function public.market_ingest(p_secret text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; prev numeric; n int := 0; skipped int := 0; v numeric; u numeric;
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  for r in select * from jsonb_array_elements(coalesce(p -> 'rows', '[]')) order by (value ->> 'date') loop
    v := app.fx_num(r -> 'price'); u := app.fx_num(r -> 'usd');
    continue when v is null or v <= 0 or u is null or u <= 0 or (r ->> 'item') not in ('copper', 'aluminium', 'steel_hrc', 'pvc', 'scfi');
    select usd into prev from public.market_prices where item = r ->> 'item' and price_date < (r ->> 'date')::date order by price_date desc limit 1;
    if prev is not null and abs(u / prev - 1) > 0.25 then
      skipped := skipped + 1;
      continue;
    end if;
    insert into public.market_prices (item, price_date, price, currency, usd, fx_cny)
    values (r ->> 'item', (r ->> 'date')::date, v, coalesce(r ->> 'currency', 'USD'), u, app.fx_num(r -> 'fx'))
    on conflict (item, price_date) do update set price = excluded.price, currency = excluded.currency, usd = excluded.usd, fx_cny = excluded.fx_cny, at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('saved', n, 'skipped', skipped);
end $$;
revoke all on function public.market_ingest(text, jsonb) from public;
grant execute on function public.market_ingest(text, jsonb) to anon, authenticated;

create or replace function public.market_last_dates(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  return coalesce((select jsonb_object_agg(item, d) from (select item, max(price_date) d from public.market_prices group by item) x), '{}');
end $$;
revoke all on function public.market_last_dates(text) from public;
grant execute on function public.market_last_dates(text) to anon, authenticated;

-- The board: per item the latest price, the price a week and a month before, LKR at the Central Bank USD rate, and the history
create or replace function public.market_board(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone app.tz())::date; res jsonb := '[]'; it text; l public.market_prices; usd_lkr numeric;
begin
  perform app.require(app.sees_fx(), 'Not allowed');
  foreach it in array array['copper', 'aluminium', 'steel_hrc', 'pvc', 'scfi'] loop
    select * into l from public.market_prices where item = it and price_date <= today order by price_date desc limit 1;
    select mid into usd_lkr from public.fx_rates where source = 'cbsl' and currency = 'USD' and rate_date <= coalesce(l.price_date, today) order by rate_date desc limit 1;
    res := res || jsonb_build_array(jsonb_build_object(
      'item', it, 'date', l.price_date, 'price', l.price, 'currency', l.currency, 'usd', l.usd, 'usd_lkr', usd_lkr,
      'week', (select usd from public.market_prices where item = it and price_date <= l.price_date - 7 order by price_date desc limit 1),
      'month', (select usd from public.market_prices where item = it and price_date <= l.price_date - 30 order by price_date desc limit 1),
      'history', coalesce((select jsonb_agg(jsonb_build_object('d', price_date, 'v', usd) order by price_date)
        from public.market_prices where item = it and price_date > today - greatest(p_days, 7) and price_date <= today), '[]')));
  end loop;
  return jsonb_build_object('today', today, 'items', res);
end $$;
grant execute on function public.market_board(int) to authenticated;
