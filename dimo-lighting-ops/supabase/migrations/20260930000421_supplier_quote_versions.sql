-- Supplier quotes: versions. A supplier's revised or discounted quote is a new version (R1, R2 …) of the same quote; every version is kept,
-- so the package shows how the supplier came down, and the price history of a material shows every version on every job.
--  * The comparison and the choice use each supplier's latest version; earlier versions stay read-only.
--  * A version can carry a discount on the whole quote (% and / or an amount in the quote currency) besides revised line rates.

alter table public.sq_quotes add column if not exists revision int not null default 0;
alter table public.sq_quotes add column if not exists first_id uuid references public.sq_quotes (id) on delete cascade;
alter table public.sq_quotes add column if not exists superseded_by uuid references public.sq_quotes (id) on delete set null;
alter table public.sq_quotes add column if not exists discount_pct numeric(6, 3) not null default 0 check (discount_pct >= 0 and discount_pct < 100);
alter table public.sq_quotes add column if not exists discount_amt numeric(16, 2) not null default 0 check (discount_amt >= 0);
alter table public.sq_quotes add column if not exists revision_note text;
create index if not exists sq_quotes_first on public.sq_quotes (first_id);

-- A new version of a quote: everything copied, ready to change; the earlier version is kept read-only
create or replace function public.sq_revise_quote(p_quote uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare q public.sq_quotes; v uuid;
begin
  perform app.require(app.sq_can(), 'No access to supplier quotes');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Say what changed (e.g. "5 % discount after negotiation")');
  select * into q from public.sq_quotes where id = p_quote;
  perform app.require(q.id is not null, 'Quote not found');
  perform app.require(q.superseded_by is null, 'This is an earlier version – revise the latest one');
  perform app.require(exists (select 1 from public.sq_packages where id = q.package_id and status in ('open', 'selected')), 'The package is closed');
  insert into public.sq_quotes (package_id, supplier_id, quote_no, quote_date, currency, fx_rate, valid_until, lead_weeks, delivery_basis, freight_pct, warranty,
                                paid_by, retention_pct, adv_guarantee, meets_spec, spec_note, source, notes, discount_pct, discount_amt,
                                revision, first_id, revision_note)
  values (q.package_id, q.supplier_id, q.quote_no, current_date, q.currency, q.fx_rate, q.valid_until, q.lead_weeks, q.delivery_basis, q.freight_pct, q.warranty,
          q.paid_by, q.retention_pct, q.adv_guarantee, q.meets_spec, q.spec_note, 'manual', q.notes, q.discount_pct, q.discount_amt,
          q.revision + 1, coalesce(q.first_id, q.id), btrim(p_note))
  returning id into v;
  insert into public.sq_quote_lines (quote_id, seq, text, item_id, qty, unit, rate, included, note)
    select v, seq, text, item_id, qty, unit, rate, included, note from public.sq_quote_lines where quote_id = q.id;
  insert into public.sq_quote_payments (quote_id, seq, name, pct, event, days)
    select v, seq, name, pct, event, days from public.sq_quote_payments where quote_id = q.id;
  insert into public.sq_quote_exclusions (quote_id, text, add_lkr)
    select v, text, add_lkr from public.sq_quote_exclusions where quote_id = q.id;
  update public.sq_quotes set superseded_by = v where id = q.id;
  -- a chosen supplier's new version stays the choice
  perform set_config('app.sq_select', 'on', true);
  update public.sq_packages set selected_quote_id = v where selected_quote_id = q.id;
  perform set_config('app.sq_select', 'off', true);
  return v;
end $$;
grant execute on function public.sq_revise_quote(uuid, text) to authenticated;

-- Earlier versions are read-only; deleting the latest version brings the previous one back
create or replace function app.sq_quote_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.superseded_by is not null and pg_trigger_depth() = 1 then raise exception 'Earlier versions are kept – delete the latest version first'; end if;
    update public.sq_quotes set superseded_by = null where superseded_by = old.id;
    -- the choice goes back to the previous version (or is cleared when there is none)
    perform set_config('app.sq_select', 'on', true);
    update public.sq_packages p set selected_quote_id = prev.id
      from (select id from public.sq_quotes where superseded_by is null and id <> old.id and old.first_id is not null and (id = old.first_id or first_id = old.first_id) order by revision desc limit 1) prev
     where p.selected_quote_id = old.id;
    update public.sq_packages set selected_quote_id = null, selection_reason = null, selected_by = null, selected_at = null,
           status = case when status = 'selected' then 'open' else status end
     where selected_quote_id = old.id;
    perform set_config('app.sq_select', 'off', true);
    return old;
  end if;
  return new;
end $$;
drop trigger if exists sq_quotes_guard on public.sq_quotes;
create trigger sq_quotes_guard before delete on public.sq_quotes for each row execute function app.sq_quote_guard();

create or replace function public.sq_save_quote(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := nullif(p->>'id', '')::uuid; q public.sq_quotes; tot numeric; l jsonb; i int := 0;
begin
  perform app.require(app.sq_can(), 'No access to supplier quotes');
  perform app.require(exists (select 1 from public.sq_packages where id = (p->>'package_id')::uuid and status not in ('cancelled')), 'Package not found');
  perform app.require(exists (select 1 from public.sq_suppliers where id = (p->>'supplier_id')::uuid), 'Choose the supplier');
  perform app.require(jsonb_array_length(coalesce(p->'lines', '[]')) > 0, 'Add at least one line');
  select sum((x->>'pct')::numeric) into tot from jsonb_array_elements(coalesce(p->'payments', '[]')) x;
  perform app.require(tot is null or abs(tot - 100) < 0.01, format('Payment stages add up to %s %% – they must make 100 %%', round(tot, 2)));
  if v is not null then
    select * into q from public.sq_quotes where id = v;
    perform app.require(q.id is not null, 'Quote not found');
    perform app.require(q.package_id = (p->>'package_id')::uuid, 'A quote stays in its package');
    perform app.require(q.superseded_by is null, 'This is an earlier version – it is kept as it was');
    perform app.require(q.revision = 0 or q.supplier_id = (p->>'supplier_id')::uuid, 'A new version stays with the same supplier');
  end if;
  if v is null then
    insert into public.sq_quotes (package_id, supplier_id) values ((p->>'package_id')::uuid, (p->>'supplier_id')::uuid) returning id into v;
  end if;
  update public.sq_quotes set
    supplier_id = (p->>'supplier_id')::uuid,
    quote_no = nullif(btrim(p->>'quote_no'), ''),
    quote_date = nullif(p->>'quote_date', '')::date,
    currency = coalesce(nullif(p->>'currency', ''), 'LKR'),
    fx_rate = case when coalesce(nullif(p->>'currency', ''), 'LKR') = 'LKR' then 1 else coalesce(nullif(p->>'fx_rate', '')::numeric, 0) end,
    valid_until = nullif(p->>'valid_until', '')::date,
    lead_weeks = nullif(p->>'lead_weeks', '')::numeric,
    delivery_basis = coalesce(nullif(p->>'delivery_basis', ''), 'site'),
    freight_pct = coalesce(nullif(p->>'freight_pct', '')::numeric, 0),
    warranty = nullif(btrim(p->>'warranty'), ''),
    paid_by = nullif(btrim(p->>'paid_by'), ''),
    retention_pct = coalesce(nullif(p->>'retention_pct', '')::numeric, 0),
    adv_guarantee = coalesce((p->>'adv_guarantee')::boolean, false),
    meets_spec = coalesce(nullif(p->>'meets_spec', ''), 'yes'),
    spec_note = nullif(btrim(p->>'spec_note'), ''),
    source = coalesce(nullif(p->>'source', ''), 'manual'),
    notes = nullif(btrim(p->>'notes'), ''),
    discount_pct = coalesce(nullif(p->>'discount_pct', '')::numeric, 0),
    discount_amt = coalesce(nullif(p->>'discount_amt', '')::numeric, 0),
    revision_note = case when revision > 0 then coalesce(nullif(btrim(p->>'revision_note'), ''), revision_note) else null end,
    updated_by = auth.uid(), updated_at = now()
  where id = v;
  delete from public.sq_quote_lines where quote_id = v;
  delete from public.sq_quote_payments where quote_id = v;
  delete from public.sq_quote_exclusions where quote_id = v;
  for l in select * from jsonb_array_elements(p->'lines') loop
    i := i + 1;
    insert into public.sq_quote_lines (quote_id, seq, text, item_id, qty, unit, rate, included, note)
    values (v, i, btrim(l->>'text'), nullif(l->>'item_id', '')::uuid, nullif(l->>'qty', '')::numeric, nullif(btrim(l->>'unit'), ''),
            case when coalesce((l->>'included')::boolean, false) then null else nullif(l->>'rate', '')::numeric end,
            coalesce((l->>'included')::boolean, false), nullif(btrim(l->>'note'), ''));
    if nullif(l->>'item_id', '') is not null then
      insert into public.sq_item_aliases (item_id, alias, supplier_id) values ((l->>'item_id')::uuid, btrim(l->>'text'), (p->>'supplier_id')::uuid)
      on conflict ((lower(btrim(alias)))) do update set item_id = excluded.item_id, supplier_id = excluded.supplier_id;
    end if;
  end loop;
  i := 0;
  for l in select * from jsonb_array_elements(coalesce(p->'payments', '[]')) loop
    i := i + 1;
    insert into public.sq_quote_payments (quote_id, seq, name, pct, event, days)
    values (v, i, coalesce(btrim(l->>'name'), ''), (l->>'pct')::numeric, l->>'event', coalesce(nullif(l->>'days', '')::int, 0));
  end loop;
  for l in select * from jsonb_array_elements(coalesce(p->'exclusions', '[]')) loop
    insert into public.sq_quote_exclusions (quote_id, text, add_lkr) values (v, btrim(l->>'text'), coalesce(nullif(l->>'add_lkr', '')::numeric, 0));
  end loop;
  update public.sq_packages set updated_at = now() where id = (p->>'package_id')::uuid;
  return v;
end $$;

-- Only a supplier's latest version can be chosen
create or replace function public.sq_select(p_package uuid, p_quote uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.sq_can(), 'No access to supplier quotes');
  if p_quote is not null then
    perform app.require(exists (select 1 from public.sq_quotes where id = p_quote and package_id = p_package), 'That quote is not in this package');
    perform app.require(exists (select 1 from public.sq_quotes where id = p_quote and superseded_by is null), 'Choose the supplier''s latest version');
    perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason for the choice');
  end if;
  perform set_config('app.sq_select', 'on', true);
  update public.sq_packages set selected_quote_id = p_quote, selection_reason = case when p_quote is null then null else btrim(p_reason) end,
         selected_by = case when p_quote is null then null else auth.uid() end, selected_at = case when p_quote is null then null else now() end,
         status = case when p_quote is null then 'open' else 'selected' end
   where id = p_package and status in ('open', 'selected');
  perform app.require(found, 'The package is closed');
  perform set_config('app.sq_select', 'off', true);
end $$;
