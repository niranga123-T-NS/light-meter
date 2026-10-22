-- Dacademy module tests: each module has a pool of 30 questions and a test draws 15 (public/academy/mtest.js).
--  * academy_record takes results of up to 30 answers; module tests (ids …mt_…) pass at 80 % (12 of 15), lessons at two thirds as before.
--  * academy_team counts lessons and module tests apart: tests_passed is new, lessons_done and the average score stay lesson-only.

alter table public.academy_progress drop constraint if exists academy_progress_total_check;
alter table public.academy_progress add constraint academy_progress_total_check check (total between 1 and 30);

create or replace function public.academy_record(p_lesson text, p_score int, p_total int) returns void
language plpgsql security definer set search_path = public as $$
declare pass boolean;
begin
  perform app.require(app.sees_academy(), 'Dacademy is for Sales Tools users and the engineers');
  perform app.require(p_lesson ~ '^[a-z0-9_]{1,40}$' and p_total between 1 and 30 and p_score between 0 and p_total, 'Not a valid lesson result');
  pass := case when p_lesson ~ '(^|_)mt_' then p_score * 5 >= p_total * 4 else p_score * 3 >= p_total * 2 end;
  insert into public.academy_progress as a (user_id, lesson, score, total, best, attempts, done, done_at)
  values (auth.uid(), p_lesson, p_score, p_total, p_score, 1, pass, case when pass then now() end)
  on conflict (user_id, lesson) do update set score = excluded.score, total = excluded.total, best = greatest(a.best, excluded.score),
    attempts = a.attempts + 1, done = a.done or pass, done_at = coalesce(a.done_at, case when pass then now() end), updated_at = now();
end $$;

drop function if exists public.academy_team();
create or replace function public.academy_team()
returns table (user_id uuid, full_name text, role text, lessons_done int, attempts int, avg_best numeric, last_at timestamptz, tests_passed int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.trains_academy(), 'Only SM Projects, GM / DGM and the System Administrator see team progress');
  return query
  select p.id, p.full_name, p.role::text,
         count(*) filter (where a.done and a.lesson !~ '(^|_)mt_')::int, coalesce(sum(a.attempts), 0)::int,
         round(avg(a.best::numeric / nullif(a.total, 0)) filter (where a.lesson !~ '(^|_)mt_') * 100, 0), max(a.updated_at),
         count(*) filter (where a.done and a.lesson ~ '(^|_)mt_')::int
    from public.profiles p left join public.academy_progress a on a.user_id = p.id
   where p.active and p.role in ('asm_building', 'asm_infra', 'sm_projects', 'gm', 'design_manager', 'lighting_designer', 'lighting_engineer',
                                 'senior_elec_engineer', 'assistant_engineer', 'trainee')
   group by p.id, p.full_name, p.role
   order by count(*) filter (where a.done and a.lesson !~ '(^|_)mt_') desc, p.full_name;
end $$;
revoke all on function public.academy_team() from public, anon;
grant execute on function public.academy_team() to authenticated;

select app.fix_function_owners();
