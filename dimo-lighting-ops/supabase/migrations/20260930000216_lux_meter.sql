-- Lux meter (Sales Tools, Android app): readings from the phone's light sensor, corrected by a calibration against a
-- reference lux meter, as spot readings or grid surveys of a room (before / after), shared with the client.
--  * lux_calibrations: per person and phone – the factor reference ÷ phone reading, with the reference meter used.
--  * lux_surveys: a spot reading or a rows × columns grid of readings with the target from Standards; numbered
--    LUX-YYYY-nnnnn. Seen by its maker, SM Projects, GM / DGM and the Design team, like DLux calculations.

create table if not exists public.lux_calibrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id),
  device text not null,
  factor numeric(8, 4) not null check (factor > 0.05 and factor < 20),
  reference text not null,
  ref_lux numeric(10, 1) not null,
  phone_lux numeric(10, 1) not null,
  created_at timestamptz not null default now()
);
create index if not exists lux_calibrations_user on public.lux_calibrations (user_id, device, created_at desc);

create table if not exists public.lux_surveys (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  title text not null,
  project_id uuid references public.projects (id),
  kind text not null default 'grid' check (kind in ('spot', 'grid')),
  phase text not null default 'check' check (phase in ('before', 'after', 'check')),
  std_id uuid references public.lighting_standards (id),
  target numeric(10, 1),
  uo_target numeric(4, 2),
  rows int,
  cols int,
  length numeric(8, 2),
  width numeric(8, 2),
  plane numeric(5, 2),
  readings jsonb not null default '[]'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  factor numeric(8, 4),
  device text,
  calibrated_at timestamptz,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lux_surveys_by on public.lux_surveys (created_by, created_at desc);
create sequence if not exists public.lux_survey_seq;
create or replace function app.lux_survey_code() returns trigger
language plpgsql as $$
begin
  if new.code is null then new.code := 'LUX-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.lux_survey_seq')::text, 5, '0'); end if;
  return new;
end $$;
drop trigger if exists lux_survey_code on public.lux_surveys;
create trigger lux_survey_code before insert on public.lux_surveys for each row execute function app.lux_survey_code();

alter table public.lux_calibrations enable row level security;
alter table public.lux_surveys enable row level security;
drop policy if exists luxcal_read on public.lux_calibrations;
drop policy if exists luxcal_insert on public.lux_calibrations;
drop policy if exists luxs_read on public.lux_surveys;
drop policy if exists luxs_write on public.lux_surveys;
create policy luxcal_read on public.lux_calibrations for select to authenticated
  using (user_id = auth.uid() or app.has_role('sm_projects', 'gm', 'design_manager'));
create policy luxcal_insert on public.lux_calibrations for insert to authenticated with check (user_id = auth.uid() and app.sees_sales_tools());
create policy luxs_read on public.lux_surveys for select to authenticated
  using (created_by = auth.uid() or app.has_role('sm_projects', 'gm', 'design_manager', 'lighting_designer', 'lighting_engineer'));
create policy luxs_write on public.lux_surveys for all to authenticated
  using (created_by = auth.uid() and app.sees_sales_tools()) with check (created_by = auth.uid() and app.sees_sales_tools());
grant select, insert on public.lux_calibrations to authenticated;
grant select, insert, update, delete on public.lux_surveys to authenticated;
grant usage on sequence public.lux_survey_seq to authenticated;
