-- BOQ match: a client BOQ Excel read line by line and matched against the fixture library (best options per line, the estimator's choice).
-- One row per uploaded BOQ sheet of an estimation job; the lines (text, quantity, options shown, choice) are kept as JSON.
create table if not exists public.boq_matches (
  id uuid primary key default gen_random_uuid(),
  estimation_job_id uuid not null references public.estimation_jobs (id) on delete cascade,
  inquiry_id uuid not null references public.inquiries (id) on delete cascade,
  file_name text not null,
  sheet text not null default '',
  options int not null default 3 check (options between 1 and 5),
  settings jsonb not null default '{}'::jsonb,
  lines jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create index if not exists boq_matches_job on public.boq_matches (estimation_job_id, created_at desc);
create index if not exists boq_matches_inquiry on public.boq_matches (inquiry_id, created_at desc);

create or replace function app.boq_match_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.inquiry_id := (select inquiry_id from public.estimation_jobs where id = new.estimation_job_id); end if;
  return new;
end $$;
drop trigger if exists boq_match_touch on public.boq_matches;
create trigger boq_match_touch before insert or update on public.boq_matches for each row execute function app.boq_match_touch();

-- whoever can open the estimate sees its BOQ matches; the estimation team (and the GM) saves them
create or replace function app.can_edit_boq_match(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.can_read_estimation_job(p_job) and app.has_role('gm', 'sm_estimation', 'am_estimation', 'estimation_exec')
$$;

alter table public.boq_matches enable row level security;
drop policy if exists boq_read on public.boq_matches;
create policy boq_read on public.boq_matches for select to authenticated using (app.can_read_estimation_job(estimation_job_id));
drop policy if exists boq_insert on public.boq_matches;
create policy boq_insert on public.boq_matches for insert to authenticated with check (app.can_edit_boq_match(estimation_job_id));
drop policy if exists boq_update on public.boq_matches;
create policy boq_update on public.boq_matches for update to authenticated using (app.can_edit_boq_match(estimation_job_id)) with check (app.can_edit_boq_match(estimation_job_id));
drop policy if exists boq_delete on public.boq_matches;
create policy boq_delete on public.boq_matches for delete to authenticated using (app.can_edit_boq_match(estimation_job_id));
grant select, insert, update, delete on public.boq_matches to authenticated;
