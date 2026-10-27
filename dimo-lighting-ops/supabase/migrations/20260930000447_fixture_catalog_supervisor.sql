-- Fixture catalog supervisor mode (DGM and SM Estimation): brand categories, corrected product data, products removed from the catalog.
-- The library itself stays the built file (public/fixtures/library.json); these rows are laid over it in the app.

create table public.fixture_brands (
  brand text primary key,
  region text not null check (region in ('european', 'china', 'local', 'other')),
  updated_by uuid default auth.uid() references public.profiles (id),
  updated_at timestamptz not null default now()
);

create table public.fixture_edits (
  product_id text primary key,
  -- fields that replace the catalogue values; null = the value is deleted
  patch jsonb not null default '{}'::jsonb,
  -- removed from the main catalog list (kept here so it can be restored)
  hidden boolean not null default false,
  updated_by uuid default auth.uid() references public.profiles (id),
  updated_at timestamptz not null default now()
);

create or replace function app.fixture_edit_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger fixture_brands_touch before insert or update on public.fixture_brands for each row execute function app.fixture_edit_touch();
create trigger fixture_edits_touch before insert or update on public.fixture_edits for each row execute function app.fixture_edit_touch();

alter table public.fixture_brands enable row level security;
alter table public.fixture_edits enable row level security;
create policy fixture_brands_read on public.fixture_brands for select to authenticated using (true);
create policy fixture_brands_write on public.fixture_brands for all to authenticated using (app.has_role('gm', 'sm_estimation')) with check (app.has_role('gm', 'sm_estimation'));
create policy fixture_edits_read on public.fixture_edits for select to authenticated using (true);
create policy fixture_edits_write on public.fixture_edits for all to authenticated using (app.has_role('gm', 'sm_estimation')) with check (app.has_role('gm', 'sm_estimation'));
grant select, insert, update, delete on public.fixture_brands, public.fixture_edits to authenticated;
