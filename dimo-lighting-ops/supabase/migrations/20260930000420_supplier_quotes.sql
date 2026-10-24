-- Supplier & subcontractor quotes: the quotes DIMO receives, brought to one basis and compared, with the price history per material.
--  * Seen and edited only by the Operations Executive, the GM / DGM and the people the GM / DGM allows – until the GM / DGM cancels it.
--  * A package (what is being bought for a job) collects the quotes; each quote holds its lines, payment stages and exclusions.
--  * Uploaded quote files are only read on the device and never stored – only the values the user checks and saves are kept.
--  * Lines are matched to items (with the suppliers' own names remembered as aliases), so every quote builds the price history.
--  * Comparison: rates in LKR at the quote's exchange rate, freight / duty added, exclusions priced back, payment stages and cash out.

-- ---------------------------------------------------------------- access: Ops, GM / DGM and people the GM / DGM allows
create table public.sq_access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  reason text not null check (btrim(reason) <> ''),
  granted_by uuid not null default auth.uid() references public.profiles (id),
  granted_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text
);
create unique index sq_access_one_open on public.sq_access_grants (user_id) where cancelled_at is null;

create or replace function app.sq_can() returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('operations_exec', 'gm')
      or exists (select 1 from public.sq_access_grants g join public.profiles p on p.id = g.user_id
                 where g.user_id = auth.uid() and g.cancelled_at is null and p.active and p.role <> 'guest')
$$;

alter table public.sq_access_grants enable row level security;
create policy sq_access_read on public.sq_access_grants for select to authenticated using (app.has_role('gm') or user_id = auth.uid());
grant select on public.sq_access_grants to authenticated;

create or replace function public.sq_access_me() returns boolean
language sql stable security definer set search_path = public as $$ select app.sq_can() $$;
grant execute on function public.sq_access_me() to authenticated;

-- The GM / DGM allows a person (reason required); it lasts until the GM / DGM cancels it
create or replace function public.sq_grant(p_user uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; r public.app_role;
begin
  perform app.require(app.has_role('gm'), 'Only the GM / DGM can allow access to supplier quotes');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select role into r from public.profiles where id = p_user and active;
  perform app.require(r is not null, 'Person not found');
  perform app.require(r not in ('guest', 'sub_supervisor'), 'Supplier prices cannot be shown to this person');
  perform app.require(r not in ('operations_exec', 'gm'), 'This person already sees supplier quotes');
  perform app.require(not exists (select 1 from public.sq_access_grants where user_id = p_user and cancelled_at is null), 'This person already has access');
  insert into public.sq_access_grants (user_id, reason) values (p_user, btrim(p_reason)) returning id into v;
  perform app.notify(p_user, 'sq_access', 'Supplier quotes: access given',
    'The GM / DGM has given you access to Supplier quotes – you can add, edit and compare supplier and subcontractor quotes. Reason: ' || btrim(p_reason),
    'normal', 'sq_access', v, '/supplier-quotes', 'sq_access_' || v);
  return v;
end $$;
grant execute on function public.sq_grant(uuid, text) to authenticated;

create or replace function public.sq_revoke(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare g public.sq_access_grants;
begin
  perform app.require(app.has_role('gm'), 'Only the GM / DGM can cancel access to supplier quotes');
  select * into g from public.sq_access_grants where id = p_id;
  perform app.require(g.id is not null and g.cancelled_at is null, 'Access already cancelled');
  update public.sq_access_grants set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = nullif(btrim(p_reason), '') where id = p_id;
  perform app.notify(g.user_id, 'sq_access', 'Supplier quotes: access ended',
    'The GM / DGM has ended your access to Supplier quotes.' || coalesce(' Reason: ' || nullif(btrim(p_reason), ''), ''),
    'normal', 'sq_access', p_id, '/', 'sq_access_end_' || p_id);
end $$;
grant execute on function public.sq_revoke(uuid, text) to authenticated;

-- ---------------------------------------------------------------- settings, suppliers, items
create table public.sq_settings (
  id int primary key default 1 check (id = 1),
  cost_of_money_pct numeric(5, 2) not null default 12 check (cost_of_money_pct >= 0 and cost_of_money_pct <= 100),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
insert into public.sq_settings (id) values (1) on conflict do nothing;

create table public.sq_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  kind text not null default 'supply' check (kind in ('supply', 'subcontract', 'both')),
  trades text,
  contact_name text,
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create unique index sq_suppliers_name on public.sq_suppliers (lower(btrim(name)));

create table public.sq_items (
  id uuid primary key default gen_random_uuid(),
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  unit text,
  sap_code text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create unique index sq_items_code on public.sq_items (upper(btrim(code)));

-- The suppliers' own names for an item: once matched, the same wording is matched again by itself
create table public.sq_item_aliases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.sq_items (id) on delete cascade,
  alias text not null check (btrim(alias) <> ''),
  supplier_id uuid references public.sq_suppliers (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index sq_item_aliases_alias on public.sq_item_aliases (lower(btrim(alias)));
create index on public.sq_item_aliases (item_id);

-- ---------------------------------------------------------------- packages and quotes
create table public.sq_packages (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  title text not null check (btrim(title) <> ''),
  project_name text,
  job_ref text,
  kind text not null default 'supply' check (kind in ('supply', 'subcontract')),
  our_validity date,
  needed_weeks numeric(6, 1) check (needed_weeks is null or needed_weeks > 0),
  status text not null default 'open' check (status in ('open', 'selected', 'closed', 'cancelled')),
  selected_quote_id uuid,
  selection_reason text,
  selected_by uuid references public.profiles (id),
  selected_at timestamptz,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.sq_packages (status);

create or replace function app.sq_package_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.code := coalesce(new.code, app.next_code('SQ'));
  return new;
end $$;
create trigger sq_packages_code before insert on public.sq_packages for each row execute function app.sq_package_code();

create table public.sq_quotes (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.sq_packages (id) on delete cascade,
  supplier_id uuid not null references public.sq_suppliers (id),
  quote_no text,
  quote_date date,
  currency text not null default 'LKR' check (currency in ('LKR', 'USD', 'EUR', 'GBP')),
  fx_rate numeric(14, 4) not null default 1 check (fx_rate > 0),
  valid_until date,
  lead_weeks numeric(6, 1) check (lead_weeks is null or lead_weeks >= 0),
  delivery_basis text not null default 'site' check (delivery_basis in ('site', 'exworks', 'cif', 'fob', 'other')),
  freight_pct numeric(6, 2) not null default 0 check (freight_pct >= 0 and freight_pct <= 200),
  warranty text,
  paid_by text,
  retention_pct numeric(5, 2) not null default 0 check (retention_pct >= 0 and retention_pct <= 100),
  adv_guarantee boolean not null default false,
  meets_spec text not null default 'yes' check (meets_spec in ('yes', 'partly', 'no', 'unknown')),
  spec_note text,
  source text not null default 'manual' check (source in ('manual', 'excel', 'pdf')),
  notes text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create index on public.sq_quotes (package_id);
create index on public.sq_quotes (supplier_id);
alter table public.sq_packages add constraint sq_packages_selected_fkey foreign key (selected_quote_id) references public.sq_quotes (id) on delete set null;

create table public.sq_quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.sq_quotes (id) on delete cascade,
  seq int not null default 0,
  text text not null check (btrim(text) <> ''),
  item_id uuid references public.sq_items (id) on delete set null,
  qty numeric(14, 3) check (qty is null or qty >= 0),
  unit text,
  rate numeric(16, 4) check (rate is null or rate >= 0),
  included boolean not null default false,
  note text
);
create index on public.sq_quote_lines (quote_id);
create index on public.sq_quote_lines (item_id);

create table public.sq_quote_payments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.sq_quotes (id) on delete cascade,
  seq int not null default 0,
  name text not null default '',
  pct numeric(6, 2) not null check (pct > 0 and pct <= 100),
  event text not null check (event in ('order', 'delivery', 'after_delivery', 'commissioning', 'handover', 'shipment')),
  days int not null default 0 check (days >= 0 and days <= 720)
);
create index on public.sq_quote_payments (quote_id);

create table public.sq_quote_exclusions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.sq_quotes (id) on delete cascade,
  text text not null check (btrim(text) <> ''),
  add_lkr numeric(16, 2) not null default 0 check (add_lkr >= 0)
);
create index on public.sq_quote_exclusions (quote_id);

-- ---------------------------------------------------------------- row security: only people with access
do $$
declare t text;
begin
  foreach t in array array['sq_settings', 'sq_suppliers', 'sq_items', 'sq_item_aliases', 'sq_packages', 'sq_quotes', 'sq_quote_lines', 'sq_quote_payments', 'sq_quote_exclusions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.sq_can())', t || '_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['sq_suppliers', 'sq_items', 'sq_item_aliases', 'sq_packages'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (app.sq_can())', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.sq_can()) with check (app.sq_can())', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (app.sq_can())', t || '_del', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
create policy sq_quotes_del on public.sq_quotes for delete to authenticated using (app.sq_can());
grant delete on public.sq_quotes to authenticated;
create policy sq_settings_upd on public.sq_settings for update to authenticated using (app.sq_can()) with check (app.sq_can());
grant update on public.sq_settings to authenticated;

-- A package's selection can only be set through sq_select (reason required, quote of the same package)
create or replace function app.sq_package_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.sq_select', true) is distinct from 'on'
     and (new.selected_quote_id is distinct from old.selected_quote_id or new.selection_reason is distinct from old.selection_reason
          or new.selected_by is distinct from old.selected_by or new.selected_at is distinct from old.selected_at
          or (new.status = 'selected' and new.selected_quote_id is null)) then
    raise exception 'Choose the supplier with Select (reason required)';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger sq_packages_guard before update on public.sq_packages for each row execute function app.sq_package_guard();

-- ---------------------------------------------------------------- RPCs
-- Latest exchange rate (LKR per unit) for a quote: CBSL first, then any source
create or replace function public.sq_fx(p_ccy text) returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_ccy = 'LKR' then 1::numeric else
    (select coalesce(mid, tt_sell) from public.fx_rates where currency = p_ccy and coalesce(mid, tt_sell) is not null and app.sq_can()
      order by (source = 'cbsl') desc, rate_date desc limit 1) end
$$;
grant execute on function public.sq_fx(text) to authenticated;

-- Create or edit a quote with its lines, payment stages and exclusions in one go.
-- p: {id?, package_id, supplier_id, quote_no, quote_date, currency, fx_rate, valid_until, lead_weeks, delivery_basis, freight_pct, warranty,
--     paid_by, retention_pct, adv_guarantee, meets_spec, spec_note, source, notes,
--     lines: [{text, item_id, qty, unit, rate, included, note}], payments: [{name, pct, event, days}], exclusions: [{text, add_lkr}]}
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
    -- remember the supplier's wording for this item
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
grant execute on function public.sq_save_quote(jsonb) to authenticated;

-- Choose the supplier for a package (reason required); null quote clears the choice
create or replace function public.sq_select(p_package uuid, p_quote uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.sq_can(), 'No access to supplier quotes');
  if p_quote is not null then
    perform app.require(exists (select 1 from public.sq_quotes where id = p_quote and package_id = p_package), 'That quote is not in this package');
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
grant execute on function public.sq_select(uuid, uuid, text) to authenticated;
