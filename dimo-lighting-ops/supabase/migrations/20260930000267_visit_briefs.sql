-- Visit brief: before a planned or unplanned visit the sales person writes a short summary – what was discussed previously,
-- what was promised and what has been done since. It is kept with the visit; for a planned visit it can be prepared in advance
-- (on the plan line, even while the weekly plan waits for approval) and is carried into the visit at check-in.

alter table public.visits add column if not exists brief_previous text check (brief_previous is null or length(brief_previous) <= 1500);
alter table public.visits add column if not exists brief_promised text check (brief_promised is null or length(brief_promised) <= 1500);
alter table public.visits add column if not exists brief_done text check (brief_done is null or length(brief_done) <= 1500);

create table if not exists public.visit_briefs (
  plan_line_id uuid primary key references public.visit_plan_lines (id) on delete cascade,
  sales_person_id uuid not null default auth.uid() references public.profiles (id),
  previous text check (previous is null or length(previous) <= 1500),
  promised text check (promised is null or length(promised) <= 1500),
  done text check (done is null or length(done) <= 1500),
  updated_at timestamptz not null default now()
);
alter table public.visit_briefs enable row level security;

create or replace function app.own_plan_line(p_line uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.visit_plan_lines l join public.visit_plans p on p.id = l.plan_id where l.id = p_line and p.sales_person_id = auth.uid())
$$;

drop policy if exists visit_briefs_read on public.visit_briefs;
create policy visit_briefs_read on public.visit_briefs for select to authenticated using (sales_person_id = auth.uid() or app.has_role('gm', 'sm_projects'));
drop policy if exists visit_briefs_insert on public.visit_briefs;
create policy visit_briefs_insert on public.visit_briefs for insert to authenticated with check (sales_person_id = auth.uid() and app.own_plan_line(plan_line_id));
drop policy if exists visit_briefs_update on public.visit_briefs;
create policy visit_briefs_update on public.visit_briefs for update to authenticated using (sales_person_id = auth.uid()) with check (sales_person_id = auth.uid() and app.own_plan_line(plan_line_id));

create or replace function app.visit_briefs_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists visit_briefs_touch on public.visit_briefs;
create trigger visit_briefs_touch before update on public.visit_briefs for each row execute function app.visit_briefs_touch();

grant select, insert, update on public.visit_briefs to authenticated;

select app.purge_guard_triggers();
select app.fix_function_owners();
