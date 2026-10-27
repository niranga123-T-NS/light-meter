-- BOQ match for inquiries that are not in the system: from before the system, or never registered in it.
-- Added by hand in Estimation › BOQ match; used only for BOQ matching (no workflow, SLA or reports).
create table public.boq_projects (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'unregistered' check (kind in ('pre_system', 'unregistered')),
  ref text not null check (length(trim(ref)) > 0),
  project_name text not null check (length(trim(project_name)) > 0),
  customer_name text,
  inquiry_date date,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create index boq_projects_created on public.boq_projects (created_at desc);

create or replace function app.boq_project_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
create trigger boq_project_touch before insert or update on public.boq_projects for each row execute function app.boq_project_touch();

-- the Estimation tab: DGM, SM Projects and the estimation team
create or replace function app.is_estimation_tab() returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('gm', 'sm_projects', 'sm_estimation', 'am_estimation', 'estimation_exec')
$$;

alter table public.boq_projects enable row level security;
create policy boq_projects_rw on public.boq_projects for all to authenticated using (app.is_estimation_tab()) with check (app.is_estimation_tab());
grant select, insert, update, delete on public.boq_projects to authenticated;

-- a BOQ match belongs to an estimation job or to one of these inquiries
alter table public.boq_matches alter column estimation_job_id drop not null;
alter table public.boq_matches alter column inquiry_id drop not null;
alter table public.boq_matches add column boq_project_id uuid references public.boq_projects (id) on delete cascade;
alter table public.boq_matches add constraint boq_matches_one_target check ((estimation_job_id is null) <> (boq_project_id is null));
create index boq_matches_project on public.boq_matches (boq_project_id, created_at desc);

create or replace function app.boq_match_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  if tg_op = 'INSERT' and new.estimation_job_id is not null then new.inquiry_id := (select inquiry_id from public.estimation_jobs where id = new.estimation_job_id); end if;
  return new;
end $$;

drop policy if exists boq_read on public.boq_matches;
create policy boq_read on public.boq_matches for select to authenticated
  using (case when estimation_job_id is not null then app.can_read_estimation_job(estimation_job_id) else app.is_estimation_tab() end);
drop policy if exists boq_insert on public.boq_matches;
create policy boq_insert on public.boq_matches for insert to authenticated
  with check (case when estimation_job_id is not null then app.can_edit_boq_match(estimation_job_id) else app.is_estimation_tab() end);
drop policy if exists boq_update on public.boq_matches;
create policy boq_update on public.boq_matches for update to authenticated
  using (case when estimation_job_id is not null then app.can_edit_boq_match(estimation_job_id) else app.is_estimation_tab() end)
  with check (case when estimation_job_id is not null then app.can_edit_boq_match(estimation_job_id) else app.is_estimation_tab() end);
drop policy if exists boq_delete on public.boq_matches;
create policy boq_delete on public.boq_matches for delete to authenticated
  using (case when estimation_job_id is not null then app.can_edit_boq_match(estimation_job_id) else app.is_estimation_tab() end);
