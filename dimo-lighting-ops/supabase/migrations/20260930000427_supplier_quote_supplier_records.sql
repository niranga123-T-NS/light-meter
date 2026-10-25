-- Supplier quotes: suppliers and manufacturers can be picked from records already in the system (manufacturers, brands, foreign and
-- local orders, material requests) or added new on the spot – local or foreign, with country and address.
--  * Picking a system record adds it to the supplier list once (name, type, local / foreign, country, address, contact filled in).
--  * Only names are read from the other modules, so people allowed into supplier quotes see no order details.

alter table public.sq_suppliers add column if not exists origin text not null default 'local' check (origin in ('local', 'foreign'));
alter table public.sq_suppliers add column if not exists country text;
alter table public.sq_suppliers add column if not exists address text;

-- Names in other modules that are not yet in the supplier list
create or replace function public.sq_system_suppliers() returns table (source text, name text, kind text, origin text, country text, address text, contact text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.sq_can(), 'No access to supplier quotes');
  return query
  select distinct on (lower(btrim(x.name))) x.source, btrim(x.name), x.kind, x.origin, x.country, x.address, x.contact
  from (
    select 'Manufacturers'::text as source, m.name, 'manufacturer'::text as kind, case when m.local_agent is not null then 'foreign' else 'local' end as origin,
           null::text as country, null::text as address, concat_ws(' · ', 'Agent: ' || m.local_agent, m.contact) as contact, 1 as rank
      from public.manufacturers m where m.active
    union all
    select 'Brands', coalesce(nullif(btrim(b.manufacturer), ''), b.name), 'manufacturer', case when b.origin in ('european', 'chinese') or coalesce(b.country, '') not in ('', 'Sri Lanka') then 'foreign' else 'local' end,
           nullif(btrim(b.country), ''), null, null, 2
      from public.brands b where b.active
    union all
    select 'Foreign orders', f.vendor, 'supply', 'foreign', null, f.mfr_address, null, 3
      from public.fo_orders f where f.status <> 'cancelled'
    union all
    select 'Local orders', l.supplier, 'supply', 'local', null, null, null, 4
      from public.lo_orders l where l.status <> 'cancelled'
    union all
    select 'Material requests', r.supplier, 'supply', 'local', null, null, null, 5
      from public.material_requests r where r.supplier is not null
  ) x
  where coalesce(btrim(x.name), '') <> ''
    and not exists (select 1 from public.sq_suppliers s where lower(btrim(s.name)) = lower(btrim(x.name)))
  order by lower(btrim(x.name)), x.rank;
end $$;
grant execute on function public.sq_system_suppliers() to authenticated;
