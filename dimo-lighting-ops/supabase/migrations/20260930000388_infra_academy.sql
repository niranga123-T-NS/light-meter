-- Dacademy: Infrastructure Engineer course for all engineers, and write-ups the trainer reads and marks.
--  * app.sees_academy: Sales Tools roles plus the Senior Electrical Engineer, Assistant Engineers and Trainees.
--  * academy_record / academy_team: open to them (team progress lists the engineers too).
--  * academy_writeups: ticket write-ups, weekly write-ups, graded test results, the script hand-in and the capstone notes
--    (one row per person, lesson and kind; saving again replaces the text and clears the old mark).
--  * academy_writeup_save (the person), academy_writeups_list (own, or everyone for the trainers), academy_writeup_mark (trainers).

create or replace function app.sees_academy() returns boolean
language sql stable as $$ select app.sees_sales_tools() or app.has_role('senior_elec_engineer', 'assistant_engineer', 'trainee') $$;
create or replace function app.trains_academy() returns boolean
language sql stable as $$ select app.has_role('sm_projects', 'gm', 'sys_admin') $$;

create or replace function public.academy_record(p_lesson text, p_score int, p_total int) returns void
language plpgsql security definer set search_path = public as $$
declare pass boolean;
begin
  perform app.require(app.sees_academy(), 'Dacademy is for Sales Tools users and the engineers');
  perform app.require(p_lesson ~ '^[a-z0-9_]{1,40}$' and p_total between 1 and 10 and p_score between 0 and p_total, 'Not a valid lesson result');
  pass := p_score * 3 >= p_total * 2;
  insert into public.academy_progress as a (user_id, lesson, score, total, best, attempts, done, done_at)
  values (auth.uid(), p_lesson, p_score, p_total, p_score, 1, pass, case when pass then now() end)
  on conflict (user_id, lesson) do update set score = excluded.score, total = excluded.total, best = greatest(a.best, excluded.score),
    attempts = a.attempts + 1, done = a.done or pass, done_at = coalesce(a.done_at, case when pass then now() end), updated_at = now();
end $$;

create or replace function public.academy_team()
returns table (user_id uuid, full_name text, role text, lessons_done int, attempts int, avg_best numeric, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.trains_academy(), 'Only SM Projects, GM / DGM and the System Administrator see team progress');
  return query
  select p.id, p.full_name, p.role::text, count(*) filter (where a.done)::int, coalesce(sum(a.attempts), 0)::int,
         round(avg(a.best::numeric / nullif(a.total, 0)) * 100, 0), max(a.updated_at)
    from public.profiles p left join public.academy_progress a on a.user_id = p.id
   where p.active and p.role in ('asm_building', 'asm_infra', 'sm_projects', 'gm', 'design_manager', 'lighting_designer', 'lighting_engineer',
                                 'senior_elec_engineer', 'assistant_engineer', 'trainee')
   group by p.id, p.full_name, p.role
   order by count(*) filter (where a.done) desc, p.full_name;
end $$;

create table if not exists public.academy_writeups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson text not null check (lesson ~ '^[a-z0-9_]{1,60}$'),
  kind text not null check (kind in ('ticket', 'weekly', 'test', 'script', 'notes')),
  body jsonb not null,
  mark int check (mark between 0 and 100),
  feedback text,
  marked_by uuid references public.profiles(id),
  marked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, lesson, kind)
);
alter table public.academy_writeups enable row level security;
drop policy if exists academy_writeups_read on public.academy_writeups;
create policy academy_writeups_read on public.academy_writeups for select to authenticated
  using (user_id = auth.uid() or app.trains_academy());
grant select on public.academy_writeups to authenticated;
revoke insert, update, delete on public.academy_writeups from authenticated, anon;

create or replace function public.academy_writeup_save(p_lesson text, p_kind text, p_body jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform app.require(app.sees_academy(), 'Dacademy is for Sales Tools users and the engineers');
  perform app.require(p_lesson ~ '^[a-z0-9_]{1,60}$' and p_kind in ('ticket', 'weekly', 'test', 'script', 'notes'), 'Not a valid write-up');
  perform app.require(jsonb_typeof(p_body) = 'object' and length(p_body::text) <= 30000, 'The write-up is empty or too long');
  insert into public.academy_writeups as w (user_id, lesson, kind, body)
  values (auth.uid(), p_lesson, p_kind, p_body)
  on conflict (user_id, lesson, kind) do update set body = excluded.body, updated_at = now(),
    mark = null, feedback = null, marked_by = null, marked_at = null
  returning w.id into v_id;
  return v_id;
end $$;
revoke all on function public.academy_writeup_save(text, text, jsonb) from public, anon;
grant execute on function public.academy_writeup_save(text, text, jsonb) to authenticated;

create or replace function public.academy_writeups_list(p_course text default 'infra')
returns table (id uuid, user_id uuid, full_name text, role text, lesson text, kind text, body jsonb, mark int, feedback text, marked_by_name text, marked_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.sees_academy() or app.trains_academy(), 'Dacademy is for Sales Tools users and the engineers');
  return query
  select w.id, w.user_id, p.full_name, p.role::text, w.lesson, w.kind, w.body, w.mark, w.feedback, m.full_name, w.marked_at, w.updated_at
    from public.academy_writeups w
    join public.profiles p on p.id = w.user_id
    left join public.profiles m on m.id = w.marked_by
   where (w.user_id = auth.uid() or app.trains_academy())
     and (p_course is null or w.lesson like p_course || '\_%')
   order by (w.mark is null) desc, w.updated_at desc;
end $$;
revoke all on function public.academy_writeups_list(text) from public, anon;
grant execute on function public.academy_writeups_list(text) to authenticated;

create or replace function public.academy_writeup_mark(p_id uuid, p_mark int, p_feedback text) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  perform app.require(app.trains_academy(), 'Only SM Projects, GM / DGM and the System Administrator mark write-ups');
  perform app.require(p_mark between 0 and 100, 'The mark is a percentage from 0 to 100');
  select user_id into v_user from public.academy_writeups where id = p_id;
  perform app.require(v_user is not null, 'Write-up not found');
  perform app.require(v_user <> auth.uid(), 'You cannot mark your own write-up');
  update public.academy_writeups set mark = p_mark, feedback = nullif(trim(coalesce(p_feedback, '')), ''), marked_by = auth.uid(), marked_at = now()
   where id = p_id;
end $$;
revoke all on function public.academy_writeup_mark(uuid, int, text) from public, anon;
grant execute on function public.academy_writeup_mark(uuid, int, text) to authenticated;

select app.fix_function_owners();
