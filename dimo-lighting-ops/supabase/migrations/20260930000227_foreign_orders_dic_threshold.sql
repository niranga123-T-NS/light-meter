-- Foreign orders (TESTING): the DIC approval of an import order applies only when the order value is USD 10,000 or more.
--  * The value is the PI value, converted to USD with the system's exchange rates (Central Bank of Sri Lanka indicative rates,
--    crossed through the LKR). When the currency has no rate in the system, the DIC approval stays (to be safe).
--  * The exchange rates now also take SGD, CNY (RMB), INR and AUD from the Central Bank, for this conversion.

alter table public.fx_rates drop constraint if exists fx_rates_currency_check;
alter table public.fx_rates add constraint fx_rates_currency_check check (currency in ('USD', 'EUR', 'GBP', 'SGD', 'CNY', 'INR', 'AUD'));

do $$
declare def text;
begin
  def := pg_get_functiondef('public.fx_ingest(text, jsonb)'::regprocedure);
  perform app.require(position('foreach c in array array[''USD'', ''EUR'', ''GBP''] loop' || chr(10) || '      v := app.fx_num(r -> c);' in def) > 0, 'fx_ingest anchor');
  def := replace(def, 'foreach c in array array[''USD'', ''EUR'', ''GBP''] loop' || chr(10) || '      v := app.fx_num(r -> c);',
                      'foreach c in array array[''USD'', ''EUR'', ''GBP'', ''SGD'', ''CNY'', ''INR'', ''AUD''] loop' || chr(10) || '      v := app.fx_num(r -> c);');
  execute def;
end $$;

-- An amount in USD: USD as it is; otherwise through the latest Central Bank LKR rates of both currencies (null when not known)
create or replace function app.fo_to_usd(p_amount numeric, p_currency text, p_on date default null) returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_amount is null then null
              when upper(p_currency) = 'USD' then p_amount
              else p_amount
                   * (select mid from public.fx_rates where source = 'cbsl' and currency = upper(p_currency) and rate_date <= coalesce(p_on, (now() at time zone app.tz())::date) order by rate_date desc limit 1)
                   / nullif((select mid from public.fx_rates where source = 'cbsl' and currency = 'USD' and rate_date <= coalesce(p_on, (now() at time zone app.tz())::date) order by rate_date desc limit 1), 0)
         end
$$;

-- Kept on the order (the value itself stays hidden from those who do not see values)
alter table public.fo_orders add column if not exists dic_required boolean not null default true;
alter table public.fo_orders add column if not exists value_usd_note text;

create or replace function app.fo_values_dic() returns trigger
language plpgsql security definer set search_path = public as $$
declare usd numeric := app.fo_to_usd(new.pi_value, new.currency);
begin
  update public.fo_orders set dic_required = usd is null or usd >= 10000,
         value_usd_note = case when new.pi_value is null then 'No PI value – DIC approval kept'
                               when usd is null then format('No %s rate in the system – DIC approval kept', new.currency)
                               when usd >= 10000 then 'USD 10,000 or more – DIC approval needed'
                               else 'Below USD 10,000 – no DIC approval' end
   where id = new.order_id;
  return new;
end $$;
drop trigger if exists fo_values_dic on public.fo_order_values;
create trigger fo_values_dic after insert or update of pi_value, currency on public.fo_order_values for each row execute function app.fo_values_dic();
update public.fo_order_values set currency = currency;

-- The DIC step applies only when it is needed; handing over to Procurement follows FBP (and DIC when it applies)
create or replace function app.fo_applies(p_conds text[], o public.fo_orders, h public.fo_handovers) returns boolean
language sql stable as $$
  select coalesce(bool_and(case c
      when 'material' then o.kind = 'material'
      when 'service' then o.kind = 'service'
      when 'exw_fob' then o.kind = 'material' and o.incoterm in ('EXW', 'FOB')
      when 'cif' then o.kind = 'material' and o.incoterm = 'CIF'
      when 'tt' then o.payment = 'TT'
      when 'lc' then o.payment = 'LC'
      when 'duty_paid' then o.kind = 'material' and o.duty = 'paid'
      when 'duty_free' then o.kind = 'material' and o.duty = 'free'
      when 'client_new' then h.client_new
      when 'vendor_new' then o.vendor_new
      when 'codes_new' then o.codes_new
      when 'inland' then o.inland
      when 'dic' then coalesce(o.dic_required, true)
      else false end), true)
    from unnest(p_conds) c
$$;
update public.fo_step_defs set conds = '{dic}' where key = 'io_approved';
update public.fo_step_defs set after = '{io_fbp,io_approved}' where key = 'io_handed';
