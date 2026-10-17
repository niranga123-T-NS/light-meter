-- Design Tools: the design team's LED driver library. Each driver's datasheet values (inrush, drivers per MCB, leakage,
-- power factor, input range, surge, remote output limits) check the breakers, RCDs and contactors of every lighting
-- circuit in a design; the datasheet PDF is kept in the catalogue store under drivers/. A design keeps its own copy of
-- the values it used, so an approved design does not change when the library does.

create table public.design_drivers (
  id uuid primary key,
  make text not null default '',
  model text not null check (length(btrim(model)) between 1 and 120),
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  file_path text check (file_path is null or file_path like 'drivers/%'),
  file_name text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now()
);
create index on public.design_drivers (make, model);
alter table public.design_drivers enable row level security;
create policy design_drivers_read on public.design_drivers for select to authenticated using (app.design_tools_user());
grant select on public.design_drivers to authenticated;

-- Add or update a driver from the Design Tools page; a save without a new datasheet keeps the stored one
create or replace function public.design_driver_save(p_id uuid, p_data jsonb, p_file_path text default null, p_file_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_model text := coalesce(nullif(btrim(p_data->>'model'), ''), nullif(btrim(p_data->>'make'), ''));
begin
  if not app.design_tools_user() then raise exception 'Design Tools are for the GM / DGM, SM Projects and the design team'; end if;
  if p_id is null or v_model is null then raise exception 'Give the driver a make or model'; end if;
  if p_file_path is not null and p_file_path not like 'drivers/%' then raise exception 'Datasheets are kept under drivers/'; end if;
  insert into public.design_drivers (id, make, model, data, file_path, file_name)
  values (p_id, left(coalesce(btrim(p_data->>'make'), ''), 80), left(v_model, 120), (p_data - 'file') - 'src', p_file_path, p_file_name)
  on conflict (id) do update set make = excluded.make, model = excluded.model, data = excluded.data,
    file_path = coalesce(excluded.file_path, design_drivers.file_path), file_name = coalesce(excluded.file_name, design_drivers.file_name),
    updated_by = auth.uid(), updated_at = now();
  return p_id;
end $$;
grant execute on function public.design_driver_save(uuid, jsonb, text, text) to authenticated;

select app.fix_function_owners();
