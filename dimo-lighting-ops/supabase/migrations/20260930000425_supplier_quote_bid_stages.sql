-- Supplier quotes: Pre Bid and Post Bid. A package starts at Pre Bid (the prices our tender is built on). After the tender it moves to
-- Post Bid: the suppliers and manufacturers picked go on (their quote is carried into Post Bid as a new version, so the Pre Bid price is kept
-- and the drop is shown), others stay at Pre Bid only, and new suppliers or manufacturers can be added at Post Bid.
--  * Every quote is tagged with the stage it was given in. Post Bid compares and chooses Post Bid quotes only; Pre Bid stays readable.
--  * The Pre Bid choice is kept with the package when it moves on; Post Bid is chosen again.
--  * Manufacturers are a kind of their own in the supplier list (quoting directly, not through a local supplier).

alter table public.sq_suppliers drop constraint if exists sq_suppliers_kind_check;
alter table public.sq_suppliers add constraint sq_suppliers_kind_check check (kind in ('supply', 'subcontract', 'both', 'manufacturer'));

alter table public.sq_packages add column if not exists stage text not null default 'pre_bid' check (stage in ('pre_bid', 'post_bid'));
alter table public.sq_packages add column if not exists post_bid_at timestamptz;
alter table public.sq_packages add column if not exists post_bid_by uuid references public.profiles (id);
alter table public.sq_packages add column if not exists post_bid_note text;
alter table public.sq_packages add column if not exists pre_bid_quote_id uuid references public.sq_quotes (id) on delete set null;
alter table public.sq_packages add column if not exists pre_bid_reason text;
alter table public.sq_quotes add column if not exists bid_stage text not null default 'pre_bid' check (bid_stage in ('pre_bid', 'post_bid'));

-- A quote is given in the stage its package is in (new quotes and new versions alike)
create or replace function app.sq_quote_stage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.bid_stage := coalesce((select stage from public.sq_packages where id = new.package_id), 'pre_bid');
  return new;
end $$;
drop trigger if exists sq_quotes_stage on public.sq_quotes;
create trigger sq_quotes_stage before insert on public.sq_quotes for each row execute function app.sq_quote_stage();

-- The selection and the stage only change through the RPCs
create or replace function app.sq_package_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.sq_select', true) is distinct from 'on'
     and (new.selected_quote_id is distinct from old.selected_quote_id or new.selection_reason is distinct from old.selection_reason
          or new.selected_by is distinct from old.selected_by or new.selected_at is distinct from old.selected_at
          or (new.status = 'selected' and new.selected_quote_id is null)
          or new.stage is distinct from old.stage or new.post_bid_at is distinct from old.post_bid_at or new.post_bid_by is distinct from old.post_bid_by
          or new.post_bid_note is distinct from old.post_bid_note or new.pre_bid_quote_id is distinct from old.pre_bid_quote_id or new.pre_bid_reason is distinct from old.pre_bid_reason) then
    raise exception 'Choose the supplier with Select (reason required) and change the stage with Move to Post Bid';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Only a supplier's latest version of the package's current stage can be chosen
create or replace function public.sq_select(p_package uuid, p_quote uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.sq_can(), 'No access to supplier quotes');
  if p_quote is not null then
    perform app.require(exists (select 1 from public.sq_quotes where id = p_quote and package_id = p_package), 'That quote is not in this package');
    perform app.require(exists (select 1 from public.sq_quotes where id = p_quote and superseded_by is null), 'Choose the supplier''s latest version');
    perform app.require(exists (select 1 from public.sq_quotes q join public.sq_packages p on p.id = q.package_id where q.id = p_quote and q.bid_stage = p.stage),
      'The package is at Post Bid – carry this quote into Post Bid (revised quote) before choosing it');
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

-- Move a package to Post Bid: the quotes picked are carried on as new versions (Pre Bid kept); the Pre Bid choice is kept for reference
create or replace function public.sq_post_bid(p_package uuid, p_carry uuid[], p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare p public.sq_packages; q uuid; n int := 0;
begin
  perform app.require(app.sq_can(), 'No access to supplier quotes');
  select * into p from public.sq_packages where id = p_package;
  perform app.require(p.id is not null, 'Package not found');
  perform app.require(p.status in ('open', 'selected'), 'The package is closed');
  perform app.require(p.stage = 'pre_bid', 'The package is already at Post Bid');
  perform app.require(not exists (select 1 from unnest(coalesce(p_carry, '{}')) c where not exists (
      select 1 from public.sq_quotes where id = c and package_id = p_package and superseded_by is null)), 'Carry on the suppliers'' latest quotes of this package');
  perform set_config('app.sq_select', 'on', true);
  update public.sq_packages set stage = 'post_bid', post_bid_at = now(), post_bid_by = auth.uid(), post_bid_note = nullif(btrim(p_note), ''),
         pre_bid_quote_id = selected_quote_id, pre_bid_reason = selection_reason
   where id = p_package;
  perform set_config('app.sq_select', 'off', true);
  foreach q in array coalesce(p_carry, '{}') loop
    perform public.sq_revise_quote(q, 'Carried into Post Bid' || coalesce(' – ' || nullif(btrim(p_note), ''), ''));
    n := n + 1;
  end loop;
  -- Post Bid is chosen again
  perform set_config('app.sq_select', 'on', true);
  update public.sq_packages set selected_quote_id = null, selection_reason = null, selected_by = null, selected_at = null, status = 'open' where id = p_package;
  perform set_config('app.sq_select', 'off', true);
  return n;
end $$;
grant execute on function public.sq_post_bid(uuid, uuid[], text) to authenticated;

-- Back to Pre Bid (moved by mistake): only while no quote has been given at Post Bid; the Pre Bid choice comes back
create or replace function public.sq_pre_bid(p_package uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.sq_packages;
begin
  perform app.require(app.sq_can(), 'No access to supplier quotes');
  select * into p from public.sq_packages where id = p_package;
  perform app.require(p.id is not null and p.stage = 'post_bid', 'The package is at Pre Bid');
  perform app.require(p.status in ('open', 'selected'), 'The package is closed');
  perform app.require(not exists (select 1 from public.sq_quotes where package_id = p_package and bid_stage = 'post_bid'), 'Post Bid quotes are in – delete them first');
  perform set_config('app.sq_select', 'on', true);
  update public.sq_packages set stage = 'pre_bid', post_bid_at = null, post_bid_by = null, post_bid_note = null,
         selected_quote_id = pre_bid_quote_id, selection_reason = pre_bid_reason, selected_by = case when pre_bid_quote_id is null then null else auth.uid() end,
         selected_at = case when pre_bid_quote_id is null then null else now() end, status = case when pre_bid_quote_id is null then 'open' else 'selected' end,
         pre_bid_quote_id = null, pre_bid_reason = null
   where id = p_package;
  perform set_config('app.sq_select', 'off', true);
end $$;
grant execute on function public.sq_pre_bid(uuid) to authenticated;

-- Deleting the latest version: the choice goes back to the previous version only when that one is of the package's current stage
create or replace function app.sq_quote_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.superseded_by is not null and pg_trigger_depth() = 1 then raise exception 'Earlier versions are kept – delete the latest version first'; end if;
    update public.sq_quotes set superseded_by = null where superseded_by = old.id;
    perform set_config('app.sq_select', 'on', true);
    update public.sq_packages p set selected_quote_id = prev.id
      from (select id, bid_stage from public.sq_quotes where superseded_by is null and id <> old.id and old.first_id is not null and (id = old.first_id or first_id = old.first_id) order by revision desc limit 1) prev
     where p.selected_quote_id = old.id and prev.bid_stage = p.stage;
    update public.sq_packages set selected_quote_id = null, selection_reason = null, selected_by = null, selected_at = null,
           status = case when status = 'selected' then 'open' else status end
     where selected_quote_id = old.id;
    update public.sq_packages set pre_bid_quote_id = null, pre_bid_reason = null where pre_bid_quote_id = old.id;
    perform set_config('app.sq_select', 'off', true);
    return old;
  end if;
  return new;
end $$;
