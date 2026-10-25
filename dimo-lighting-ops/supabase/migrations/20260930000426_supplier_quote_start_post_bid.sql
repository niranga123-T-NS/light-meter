-- Supplier quotes: a package can start at Post Bid (jobs tendered before the system) – no Pre Bid quotes needed; who and when are recorded
create or replace function app.sq_package_start() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stage = 'post_bid' then
    new.post_bid_at := now();
    new.post_bid_by := auth.uid();
    new.post_bid_note := coalesce(nullif(btrim(new.post_bid_note), ''), 'Started at Post Bid');
  else
    new.post_bid_at := null; new.post_bid_by := null; new.post_bid_note := null;
  end if;
  new.pre_bid_quote_id := null; new.pre_bid_reason := null;
  return new;
end $$;
drop trigger if exists sq_packages_start on public.sq_packages;
create trigger sq_packages_start before insert on public.sq_packages for each row execute function app.sq_package_start();
