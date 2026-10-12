-- Sales Tools · Quick calculations: saved room calculations and the electricity tariffs used for the savings
--  * electricity_tariffs: the CEB and LECO customer categories; the rate (LKR per kWh, average energy charge) is kept
--    by SM Projects, GM / DGM, the Design Manager or the System Administrator from the current PUCSL schedule.
--    Until a rate is entered, the sales person types the client's rate.
--  * quick_calcs: a calculation with its inputs and results, saved by the person who made it, optionally on a
--    project, visit or customer. Seen by its maker, SM Projects, GM / DGM and the Design team.

create table if not exists public.electricity_tariffs (
  id uuid primary key default gen_random_uuid(),
  supplier text not null check (supplier in ('CEB', 'LECO')),
  code text not null,
  name text not null,
  rate numeric(10, 2),
  note text,
  effective_from date,
  sort int not null default 0,
  active boolean not null default true,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  unique (supplier, code)
);
alter table public.electricity_tariffs enable row level security;
drop policy if exists et_read on public.electricity_tariffs;
drop policy if exists et_write on public.electricity_tariffs;
create policy et_read on public.electricity_tariffs for select to authenticated using (app.sees_sales_tools());
create policy et_write on public.electricity_tariffs for update to authenticated
  using (app.has_role('sm_projects', 'gm', 'design_manager', 'sys_admin')) with check (app.has_role('sm_projects', 'gm', 'design_manager', 'sys_admin'));
grant select, update on public.electricity_tariffs to authenticated;
drop trigger if exists audit_electricity_tariffs on public.electricity_tariffs;
create trigger audit_electricity_tariffs after update on public.electricity_tariffs for each row execute function app.audit();

insert into public.electricity_tariffs (supplier, code, name, sort)
select s, c, n, row_number() over () from (values
  ('CEB', 'D-1', 'Domestic'), ('CEB', 'R-1', 'Religious and charitable'),
  ('CEB', 'GP-1', 'General purpose – small (up to 42 kVA)'), ('CEB', 'GP-2', 'General purpose – medium (above 42 kVA, 400/230 V)'), ('CEB', 'GP-3', 'General purpose – large (11 kV and above)'),
  ('CEB', 'H-1', 'Hotel – small'), ('CEB', 'H-2', 'Hotel – medium'), ('CEB', 'H-3', 'Hotel – large'),
  ('CEB', 'I-1', 'Industrial – small (up to 42 kVA)'), ('CEB', 'I-2', 'Industrial – medium'), ('CEB', 'I-3', 'Industrial – large (11 kV and above)'),
  ('CEB', 'GV-1', 'Government – small'), ('CEB', 'GV-2', 'Government – medium'), ('CEB', 'GV-3', 'Government – large'),
  ('LECO', 'D-1', 'Domestic'), ('LECO', 'R-1', 'Religious and charitable'),
  ('LECO', 'GP-1', 'General purpose – small'), ('LECO', 'GP-2', 'General purpose – medium'),
  ('LECO', 'H-1', 'Hotel – small'), ('LECO', 'H-2', 'Hotel – medium'),
  ('LECO', 'I-1', 'Industrial – small'), ('LECO', 'I-2', 'Industrial – medium'),
  ('LECO', 'GV-1', 'Government – small'), ('LECO', 'GV-2', 'Government – medium')
) v(s, c, n)
on conflict (supplier, code) do nothing;

create table if not exists public.quick_calcs (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  title text not null,
  project_id uuid references public.projects (id),
  visit_id uuid references public.visits (id),
  organization_id uuid references public.organizations (id),
  inputs jsonb not null,
  results jsonb not null,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quick_calcs_by on public.quick_calcs (created_by, created_at desc);
create sequence if not exists public.quick_calc_seq;
create or replace function app.quick_calc_code() returns trigger
language plpgsql as $$
begin
  if new.code is null then new.code := 'QC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.quick_calc_seq')::text, 5, '0'); end if;
  return new;
end $$;
drop trigger if exists quick_calc_code on public.quick_calcs;
create trigger quick_calc_code before insert on public.quick_calcs for each row execute function app.quick_calc_code();
alter table public.quick_calcs enable row level security;
drop policy if exists qc_read on public.quick_calcs;
drop policy if exists qc_write on public.quick_calcs;
create policy qc_read on public.quick_calcs for select to authenticated
  using (created_by = auth.uid() or app.has_role('sm_projects', 'gm', 'design_manager', 'lighting_designer', 'lighting_engineer'));
create policy qc_write on public.quick_calcs for all to authenticated
  using (created_by = auth.uid() and app.sees_sales_tools()) with check (created_by = auth.uid() and app.sees_sales_tools());
grant select, insert, update, delete on public.quick_calcs to authenticated;
grant usage on sequence public.quick_calc_seq to authenticated;
