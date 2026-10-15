-- Lighting Academy (Sales Tools → Dacademy): lessons with live graphics and a quick check. The lessons themselves are a
-- static page (public/academy); this keeps each person's progress.
--  * academy_record: saves a quiz result for the signed-in person (best score, attempts, completed at 2 of 3 or better).
--  * academy_mine: the signed-in person's progress.
--  * academy_team: everyone with Sales Tools and their progress – for SM Projects, GM / DGM and the System Administrator.

create table if not exists public.academy_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  lesson text not null check (lesson ~ '^[a-z0-9_]{1,40}$'),
  score int not null check (score >= 0),
  total int not null check (total between 1 and 10),
  best int not null default 0,
  attempts int not null default 1,
  done boolean not null default false,
  done_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson)
);
alter table public.academy_progress enable row level security;
drop policy if exists academy_read on public.academy_progress;
create policy academy_read on public.academy_progress for select to authenticated
  using (user_id = auth.uid() or app.has_role('sm_projects', 'gm', 'sys_admin'));
grant select on public.academy_progress to authenticated;

create or replace function public.academy_record(p_lesson text, p_score int, p_total int) returns void
language plpgsql security definer set search_path = public as $$
declare pass boolean;
begin
  perform app.require(app.sees_sales_tools(), 'The Lighting Academy is part of Sales Tools');
  perform app.require(p_lesson ~ '^[a-z0-9_]{1,40}$' and p_total between 1 and 10 and p_score between 0 and p_total, 'Not a valid lesson result');
  pass := p_score * 3 >= p_total * 2;
  insert into public.academy_progress as a (user_id, lesson, score, total, best, attempts, done, done_at)
  values (auth.uid(), p_lesson, p_score, p_total, p_score, 1, pass, case when pass then now() end)
  on conflict (user_id, lesson) do update set score = excluded.score, total = excluded.total, best = greatest(a.best, excluded.score),
    attempts = a.attempts + 1, done = a.done or pass, done_at = coalesce(a.done_at, case when pass then now() end), updated_at = now();
end $$;
revoke all on function public.academy_record(text, int, int) from public, anon;
grant execute on function public.academy_record(text, int, int) to authenticated;

create or replace function public.academy_mine() returns setof public.academy_progress
language sql stable security definer set search_path = public as $$
  select * from public.academy_progress where user_id = auth.uid()
$$;
revoke all on function public.academy_mine() from public, anon;
grant execute on function public.academy_mine() to authenticated;

create or replace function public.academy_team()
returns table (user_id uuid, full_name text, role text, lessons_done int, attempts int, avg_best numeric, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.has_role('sm_projects', 'gm', 'sys_admin'), 'Only SM Projects, GM / DGM and the System Administrator see team progress');
  return query
  select p.id, p.full_name, p.role::text, count(*) filter (where a.done)::int, coalesce(sum(a.attempts), 0)::int,
         round(avg(a.best::numeric / nullif(a.total, 0)) * 100, 0), max(a.updated_at)
    from public.profiles p left join public.academy_progress a on a.user_id = p.id
   where p.active and p.role in ('asm_building', 'asm_infra', 'sm_projects', 'gm', 'design_manager', 'lighting_designer', 'lighting_engineer')
   group by p.id, p.full_name, p.role
   order by count(*) filter (where a.done) desc, p.full_name;
end $$;
revoke all on function public.academy_team() from public, anon;
grant execute on function public.academy_team() to authenticated;

select app.fix_function_owners();
