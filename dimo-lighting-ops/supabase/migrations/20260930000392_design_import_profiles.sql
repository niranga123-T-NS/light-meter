-- Design Tools: saved import profiles – how one designer's or consultant's circuit schedules are read (what each column means,
-- their words for types / phases / controls, load units, board headings, one board per sheet). Shared by the design team, so a
-- schedule from the same office is read the same way next time, by anyone.

create table public.design_import_profiles (
  id uuid primary key,
  name text not null check (length(btrim(name)) between 1 and 80),
  cfg jsonb not null default '{}' check (jsonb_typeof(cfg) = 'object'),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now()
);
create index on public.design_import_profiles (name);
alter table public.design_import_profiles enable row level security;
create policy design_import_profiles_read on public.design_import_profiles for select to authenticated using (app.design_tools_user());
grant select on public.design_import_profiles to authenticated;

-- Add or update a profile from the Design Tools page
create or replace function public.design_import_profile_save(p_id uuid, p_name text, p_cfg jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not app.design_tools_user() then raise exception 'Design Tools are for the GM / DGM, SM Projects and the design team'; end if;
  if p_id is null or nullif(btrim(p_name), '') is null then raise exception 'Give the profile a name'; end if;
  if p_cfg is null or jsonb_typeof(p_cfg) <> 'object' or length(p_cfg::text) > 20000 then raise exception 'The profile settings are missing or too long'; end if;
  insert into public.design_import_profiles (id, name, cfg) values (p_id, left(btrim(p_name), 80), p_cfg)
  on conflict (id) do update set name = excluded.name, cfg = excluded.cfg, updated_by = auth.uid(), updated_at = now();
  return p_id;
end $$;
grant execute on function public.design_import_profile_save(uuid, text, jsonb) to authenticated;

create or replace function public.design_import_profile_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.design_tools_user() then raise exception 'Design Tools are for the GM / DGM, SM Projects and the design team'; end if;
  delete from public.design_import_profiles where id = p_id;
end $$;
grant execute on function public.design_import_profile_delete(uuid) to authenticated;

select app.fix_function_owners();
