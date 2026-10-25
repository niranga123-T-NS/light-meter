-- Supplier base reports for the GM / DGM: scorecard, awards, negotiation savings, not the lowest, competition, price trends, terms and
-- one supplier. The reports are worked out in the app from the supplier quotes; this keeps what they need besides the quotes:
--  * the scorecard weights (price, specification, lead time, response, terms – out of 100), set by the GM / DGM on the page;
--  * who was asked to quote on each package, so "quoted when asked" can be measured. A quote counts as asked.

alter table public.sq_settings add column if not exists score_weights jsonb not null default '{"price": 40, "spec": 20, "lead": 15, "response": 15, "terms": 10}';

create or replace function public.sq_set_weights(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; t numeric := 0; v numeric;
begin
  perform app.require(app.has_role('gm'), 'Only the GM / DGM sets the scorecard weights');
  foreach k in array array['price', 'spec', 'lead', 'response', 'terms'] loop
    v := nullif(p->>k, '')::numeric;
    perform app.require(v is not null and v >= 0 and v <= 100, format('Give a weight from 0 to 100 for %s', k));
    t := t + v;
  end loop;
  perform app.require(abs(t - 100) < 0.01, format('The weights add up to %s – they must make 100', t));
  update public.sq_settings set score_weights = jsonb_build_object('price', (p->>'price')::numeric, 'spec', (p->>'spec')::numeric, 'lead', (p->>'lead')::numeric,
         'response', (p->>'response')::numeric, 'terms', (p->>'terms')::numeric), updated_by = auth.uid(), updated_at = now() where id = 1;
end $$;
grant execute on function public.sq_set_weights(jsonb) to authenticated;

create table if not exists public.sq_package_invites (
  package_id uuid not null references public.sq_packages (id) on delete cascade,
  supplier_id uuid not null references public.sq_suppliers (id) on delete cascade,
  asked_at timestamptz not null default now(),
  asked_by uuid default auth.uid() references public.profiles (id),
  primary key (package_id, supplier_id)
);
alter table public.sq_package_invites enable row level security;
create policy sq_package_invites_read on public.sq_package_invites for select to authenticated using (app.sq_can());
create policy sq_package_invites_ins on public.sq_package_invites for insert to authenticated with check (app.sq_can());
create policy sq_package_invites_del on public.sq_package_invites for delete to authenticated using (app.sq_can());
grant select, insert, delete on public.sq_package_invites to authenticated;

-- A supplier who quotes was asked
create or replace function app.sq_quote_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.sq_package_invites (package_id, supplier_id, asked_at, asked_by)
  values (new.package_id, new.supplier_id, coalesce(new.created_at, now()), new.created_by) on conflict do nothing;
  return new;
end $$;
drop trigger if exists sq_quotes_invite on public.sq_quotes;
create trigger sq_quotes_invite after insert or update of supplier_id on public.sq_quotes for each row execute function app.sq_quote_invite();

insert into public.sq_package_invites (package_id, supplier_id, asked_at, asked_by)
select distinct on (package_id, supplier_id) package_id, supplier_id, created_at, created_by from public.sq_quotes order by package_id, supplier_id, created_at
on conflict do nothing;
