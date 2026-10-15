-- Project references (Sales Tools → References): completed projects to show clients – up to 4 photos, a short description,
-- year, project value (when known), location and country, project category, application types, the brands used and – when
-- known – the client, architect, interior designer, MEP consultant and electrical consultant.
--  * Seen by everyone with Sales Tools; only the Lighting Designer adds, edits and removes references.
--  * Photos are kept in the private "references" bucket (images up to 10 MB each), under ref/<reference id>/.

create or replace function app.keeps_references() returns boolean
language sql stable as $$ select app.has_role('lighting_designer') $$;

create table if not exists public.project_references (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 160),
  client text,
  architect text,
  interior_designer text,
  mep_consultant text,
  elec_consultant text,
  description text check (description is null or length(description) <= 600),
  year int check (year is null or year between 1980 and 2100),
  value numeric(16, 2) check (value is null or value >= 0),
  currency text not null default 'LKR' check (currency in ('LKR', 'USD')),
  location text,
  country text not null default 'Sri Lanka',
  category text check (category is null or category in ('hospitality', 'retail', 'institutions', 'commercial', 'infrastructure', 'industrial')),
  applications text[] not null default '{}' check (applications <@ array['indoor', 'outdoor', 'controls', 'lv', 'special']::text[]),
  brands text[] not null default '{}',
  photos text[] not null default '{}' check (coalesce(array_length(photos, 1), 0) <= 4),
  active boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create index if not exists project_references_year on public.project_references (year desc nulls last, created_at desc);

alter table public.project_references enable row level security;
drop policy if exists pref_read on public.project_references;
drop policy if exists pref_insert on public.project_references;
drop policy if exists pref_update on public.project_references;
drop policy if exists pref_delete on public.project_references;
create policy pref_read on public.project_references for select to authenticated using (app.sees_sales_tools() and (active or app.keeps_references()));
create policy pref_insert on public.project_references for insert to authenticated with check (app.keeps_references() and created_by = auth.uid());
create policy pref_update on public.project_references for update to authenticated using (app.keeps_references()) with check (app.keeps_references());
create policy pref_delete on public.project_references for delete to authenticated using (app.keeps_references());
grant select, insert, update, delete on public.project_references to authenticated;
drop trigger if exists audit_project_references on public.project_references;
create trigger audit_project_references after insert or update on public.project_references for each row execute function app.audit();

-- Private bucket for the photos (10 MB a photo, images only)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('references', 'references', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    execute 'drop policy if exists references_read on storage.objects';
    execute 'drop policy if exists references_insert on storage.objects';
    execute 'drop policy if exists references_delete on storage.objects';
    execute $p$create policy references_read on storage.objects for select to authenticated using (bucket_id = 'references' and app.sees_sales_tools())$p$;
    execute $p$create policy references_insert on storage.objects for insert to authenticated with check (bucket_id = 'references' and app.keeps_references())$p$;
    execute $p$create policy references_delete on storage.objects for delete to authenticated using (bucket_id = 'references' and app.keeps_references())$p$;
  end if;
end $$;

select app.fix_function_owners();
