-- DLux (was Quick calc): the IES file library and the new calculation numbers
--  * ies_files: IES (LM-63) photometric files. The DIMO library ('library') is kept by the Design team, SM Projects,
--    GM / DGM and the System Administrator and is seen by everyone with Sales Tools. A file a sales person attaches
--    to a calculation ('private') is seen by its uploader and by whoever can see a calculation that uses it.
--    The file is read in the app; its summary (lumens, watts, size, beam) is kept beside the text.
--  * New calculations are numbered DLX-YYYY-nnnnn (earlier ones keep QC-).

create or replace function app.keeps_ies_library() returns boolean
language sql stable as $$ select app.has_role('design_manager', 'lighting_designer', 'lighting_engineer', 'sm_projects', 'gm', 'sys_admin') $$;

create table if not exists public.ies_files (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'private' check (scope in ('library', 'private')),
  name text not null,
  manufacturer text,
  product_code text,
  file_name text not null,
  lumens numeric(12, 1),
  watts numeric(10, 2),
  len_mm numeric(10, 1),
  wid_mm numeric(10, 1),
  beam int,
  up_share numeric(5, 3),
  content text not null check (length(content) <= 600000),
  active boolean not null default true,
  uploaded_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists ies_files_scope on public.ies_files (scope, name);
alter table public.ies_files enable row level security;
drop policy if exists ies_read on public.ies_files;
drop policy if exists ies_insert on public.ies_files;
drop policy if exists ies_update on public.ies_files;
drop policy if exists ies_delete on public.ies_files;
create policy ies_read on public.ies_files for select to authenticated using (
  app.sees_sales_tools() and (
    (scope = 'library' and (active or app.keeps_ies_library()))
    or uploaded_by = auth.uid()
    or exists (select 1 from public.quick_calcs q where q.inputs ->> 'ies_id' = ies_files.id::text)));
create policy ies_insert on public.ies_files for insert to authenticated
  with check (app.sees_sales_tools() and uploaded_by = auth.uid() and (scope = 'private' or app.keeps_ies_library()));
create policy ies_update on public.ies_files for update to authenticated
  using (app.keeps_ies_library() or (uploaded_by = auth.uid() and scope = 'private'))
  with check (app.keeps_ies_library() or (uploaded_by = auth.uid() and scope = 'private'));
create policy ies_delete on public.ies_files for delete to authenticated
  using (app.keeps_ies_library() or (uploaded_by = auth.uid() and scope = 'private'));
grant select, insert, update, delete on public.ies_files to authenticated;

create or replace function app.quick_calc_code() returns trigger
language plpgsql as $$
begin
  if new.code is null then new.code := 'DLX-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.quick_calc_seq')::text, 5, '0'); end if;
  return new;
end $$;
