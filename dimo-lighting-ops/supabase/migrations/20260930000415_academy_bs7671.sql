-- Dacademy: Wiring Regulations (BS 7671:2018+A4:2026) course – 48 lessons in 10 modules over three levels (Foundations, Protection,
-- Design and verification), 4 practical assessments, 10 module tests and a 30-question final exam (public/academy/bs7671.html).
--  * academy_lessons: course 'bs7671' and its 63 items; the final exam is a test, so the course is complete only when it is passed.
--  * Badges: Wiring Regulations · Gold (certificate) and one for each level; the gold counts towards All-rounder.
--  * Paths: optional for the engineers, lighting designers / engineers, the Design Manager, SM Projects and GM (trainers can make it required).
--  * academy_points / academy_award / academy_me: the new course added to their course lists.

alter table public.academy_lessons drop constraint if exists academy_lessons_course_check;
alter table public.academy_lessons add constraint academy_lessons_course_check check (course in ('light', 'net', 'knx', 'knxlab', 'infra', 'bs7671'));

insert into public.academy_lessons (course, module, lesson, kind) values
('bs7671','m1','bs_1_1','lesson'),
('bs7671','m1','bs_1_2','lesson'),
('bs7671','m1','bs_1_3','lesson'),
('bs7671','m1','bs_1_4','lesson'),
('bs7671','m2','bs_2_1','lesson'),
('bs7671','m2','bs_2_2','lesson'),
('bs7671','m2','bs_2_3','lesson'),
('bs7671','m2','bs_2_4','lesson'),
('bs7671','m2','bs_2_5','lesson'),
('bs7671','m3','bs_3_1','lesson'),
('bs7671','m3','bs_3_2','lesson'),
('bs7671','m3','bs_3_3','lesson'),
('bs7671','m3','bs_3_4','lesson'),
('bs7671','m3','bs_3_5','lesson'),
('bs7671','m4','bs_4_1','lesson'),
('bs7671','m4','bs_4_2','lesson'),
('bs7671','m4','bs_4_3','lesson'),
('bs7671','m4','bs_4_4','lesson'),
('bs7671','m4','bs_4_5','lesson'),
('bs7671','m4','bs_4_6','lesson'),
('bs7671','m5','bs_5_1','lesson'),
('bs7671','m5','bs_5_2','lesson'),
('bs7671','m5','bs_5_3','lesson'),
('bs7671','m5','bs_5_4','lesson'),
('bs7671','m5','bs_5_5','lesson'),
('bs7671','m5','bs_5_6','lesson'),
('bs7671','m6','bs_6_1','lesson'),
('bs7671','m6','bs_6_2','lesson'),
('bs7671','m6','bs_6_3','lesson'),
('bs7671','m6','bs_6_4','lesson'),
('bs7671','m6','bs_6_5','lesson'),
('bs7671','m6','bs_6_6','lesson'),
('bs7671','m7','bs_7_1','lesson'),
('bs7671','m7','bs_7_2','lesson'),
('bs7671','m7','bs_7_3','lesson'),
('bs7671','m7','bs_7_4','lesson'),
('bs7671','m8','bs_8_1','lesson'),
('bs7671','m8','bs_8_2','lesson'),
('bs7671','m8','bs_8_3','lesson'),
('bs7671','m8','bs_8_4','lesson'),
('bs7671','m8','bs_8_5','lesson'),
('bs7671','m9','bs_9_1','lesson'),
('bs7671','m9','bs_9_2','lesson'),
('bs7671','m9','bs_9_3','lesson'),
('bs7671','m9','bs_9_4','lesson'),
('bs7671','m9','bs_9_5','lesson'),
('bs7671','m10','bs_10_1','lesson'),
('bs7671','m10','bs_10_2','lesson'),
('bs7671','m6','bs_px_l2','lab'),
('bs7671','m7','bs_px_l3','lab'),
('bs7671','m8','bs_px_tst','lab'),
('bs7671','m10','bs_px_scn','lab'),
('bs7671','m1','bs_mt_m1','test'),
('bs7671','m2','bs_mt_m2','test'),
('bs7671','m3','bs_mt_m3','test'),
('bs7671','m4','bs_mt_m4','test'),
('bs7671','m5','bs_mt_m5','test'),
('bs7671','m6','bs_mt_m6','test'),
('bs7671','m7','bs_mt_m7','test'),
('bs7671','m8','bs_mt_m8','test'),
('bs7671','m9','bs_mt_m9','test'),
('bs7671','m10','bs_mt_m10','test'),
('bs7671','final','bs_mt_final','test')
on conflict (lesson) do update set course = excluded.course, module = excluded.module, kind = excluded.kind;

insert into public.academy_badge_defs (key, family, tier, name, rule, icon, points, auto, sort) values
  ('bs7671_gold', 'course', 'gold', 'Wiring Regulations · Gold', 'Every BS 7671 lesson, practical, module test and the final exam passed – certificate', '⚡', 0, true, 25),
  ('bs_foundations', 'skill', 'bronze', 'BS 7671 Foundations', 'Level 1 of Wiring Regulations complete (modules 1–3 and their tests)', '📘', 0, true, 26),
  ('bs_protection', 'skill', 'silver', 'BS 7671 Protection', 'Level 2 of Wiring Regulations complete (modules 4–6, their tests and the practical)', '🛡️', 0, true, 27),
  ('bs_design', 'skill', 'gold', 'BS 7671 Design and verification', 'Level 3 of Wiring Regulations complete (modules 7–10, their tests and the practicals)', '📐', 0, true, 28)
on conflict (key) do update set family = excluded.family, tier = excluded.tier, name = excluded.name, rule = excluded.rule, icon = excluded.icon,
  points = excluded.points, auto = excluded.auto, sort = excluded.sort;

update public.academy_paths set optional = array_append(optional, 'bs7671')
 where role in ('senior_elec_engineer', 'assistant_engineer', 'trainee', 'lighting_engineer', 'lighting_designer', 'design_manager', 'sm_projects', 'gm')
   and not ('bs7671' = any (optional)) and not ('bs7671' = any (required));

-- Every item (lesson, practical, test) of the given modules of a course done
create or replace function app.academy_modules_done(p_user uuid, p_course text, p_modules text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.academy_lessons where course = p_course and module = any (p_modules))
     and not exists (select 1 from public.academy_lessons l where l.course = p_course and l.module = any (p_modules)
                       and not exists (select 1 from public.academy_progress p where p.user_id = p_user and p.lesson = l.lesson and p.done))
$$;

create or replace function app.academy_points(p_user uuid, p_from timestamptz default null, p_to timestamptz default null) returns int
language plpgsql stable security definer set search_path = public as $$
declare pts numeric := 0; c text;
begin
  select coalesce(sum(case when kind in ('lesson', 'exam') then 10 + case when attempts = 1 then 5 else 0 end
                           when kind in ('lab', 'session') then 25
                           when kind = 'test' then 50 + case when best * 10 >= total * 9 then 25 else 0 end else 0 end), 0)
    into pts from app.academy_done(p_user) where (p_from is null or done_at >= p_from) and (p_to is null or done_at < p_to);
  pts := pts + coalesce((select sum(mark) * 0.5 from public.academy_writeups where user_id = p_user and mark is not null
                          and (p_from is null or marked_at >= p_from) and (p_to is null or marked_at < p_to)), 0);
  foreach c in array array['light', 'net', 'knx', 'knxlab', 'infra', 'bs7671'] loop
    declare j jsonb := app.academy_course(p_user, c);
    begin
      if (j->>'complete')::boolean and (p_from is null or (j->>'completed_at')::timestamptz >= p_from) and (p_to is null or (j->>'completed_at')::timestamptz < p_to) then pts := pts + 200; end if;
    end;
  end loop;
  pts := pts + 15 * coalesce((select count(*) from public.academy_weeks where user_id = p_user and met
                              and (p_from is null or week_start >= p_from::date) and (p_to is null or week_start < p_to::date)), 0);
  pts := pts + coalesce((select sum(d.points) from public.academy_badges b join public.academy_badge_defs d on d.key = b.badge
                          where b.user_id = p_user and (p_from is null or b.awarded_at >= p_from) and (p_to is null or b.awarded_at < p_to)), 0);
  return round(pts)::int;
end $$;

create or replace function app.academy_award(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare got int := 0; L jsonb := app.academy_course(p_user, 'light'); golds int := 0; c text; pa jsonb; st jsonb; nl int;
begin
  if not app.academy_member(p_user) then return 0; end if;
  nl := (L->>'lessons')::int;
  if (L->>'lessons_done')::int * 4 >= nl and nl > 0 then got := got + app.academy_give(p_user, 'light_bronze')::int; end if;
  if (L->>'lessons_done')::int * 2 >= nl and nl > 0 and (select count(*) from app.academy_done(p_user) where lesson in ('mt_basics', 'mt_tech', 'mt_fix', 'mt_chip')) = 4 then got := got + app.academy_give(p_user, 'light_silver')::int; end if;
  if (L->>'complete')::boolean then got := got + app.academy_give(p_user, 'light_gold')::int;
    if (L->>'tests_90')::int = (L->>'tests')::int then got := got + app.academy_give(p_user, 'light_platinum')::int; end if; end if;
  foreach c in array array['knx', 'knxlab', 'net', 'infra', 'bs7671'] loop
    if (app.academy_course(p_user, c)->>'complete')::boolean then got := got + app.academy_give(p_user, c || '_gold')::int; end if;
  end loop;
  select count(*) into golds from public.academy_badges where user_id = p_user and badge in ('light_gold', 'knx_gold', 'knxlab_gold', 'net_gold', 'infra_gold', 'bs7671_gold');
  if golds >= 3 then got := got + app.academy_give(p_user, 'all_rounder')::int; end if;
  if (select count(*) from app.academy_done(p_user) where lesson in ('knxlab_h1', 'knxlab_h2', 'knxlab_h3', 'knxlab_h4', 'knxlab_h5')) = 5 then got := got + app.academy_give(p_user, 'commissioner')::int; end if;
  if exists (select 1 from app.academy_done(p_user) where lesson = 'infra_s08') then got := got + app.academy_give(p_user, 'fault_finder')::int; end if;
  -- Wiring Regulations: a badge for each level – every lesson, practical and module test of its modules
  if app.academy_modules_done(p_user, 'bs7671', array['m1', 'm2', 'm3']) then got := got + app.academy_give(p_user, 'bs_foundations')::int; end if;
  if app.academy_modules_done(p_user, 'bs7671', array['m4', 'm5', 'm6']) then got := got + app.academy_give(p_user, 'bs_protection')::int; end if;
  if app.academy_modules_done(p_user, 'bs7671', array['m7', 'm8', 'm9', 'm10']) then got := got + app.academy_give(p_user, 'bs_design')::int; end if;
  if exists (select 1 from app.academy_done(p_user) where lesson = 'mt_sport' and best * 10 >= total * 9) then got := got + app.academy_give(p_user, 'glare_guru')::int; end if;
  if (select count(*) from app.academy_done(p_user) where kind = 'lesson' and attempts = 1 and best = total) >= 10 then got := got + app.academy_give(p_user, 'sharpshooter')::int; end if;
  if exists (select 1 from app.academy_done(p_user) where kind = 'test' and best = total) then got := got + app.academy_give(p_user, 'clean_sheet')::int; end if;
  if app.academy_streak(p_user) >= 4 then got := got + app.academy_give(p_user, 'streak4')::int; end if;
  if app.academy_streak(p_user) >= 12 then got := got + app.academy_give(p_user, 'streak12')::int; end if;
  pa := app.academy_path(p_user);
  if jsonb_array_length(pa->'required') > 0 and (pa->>'target_on') is not null
     and not exists (select 1 from jsonb_array_elements_text(pa->'required') r where not (app.academy_course(p_user, r)->>'complete')::boolean)
     and (select max((app.academy_course(p_user, r)->>'completed_at')::timestamptz) from jsonb_array_elements_text(pa->'required') r)::date <= (pa->>'target_on')::date then
    got := got + app.academy_give(p_user, 'ahead_plan')::int;
  end if;
  if exists (select 1 from public.academy_weeks b where b.user_id = p_user and b.status = 'behind'
              and exists (select 1 from public.academy_weeks o where o.user_id = p_user and o.week_start > b.week_start and o.status in ('on_track', 'ahead', 'complete'))) then
    got := got + app.academy_give(p_user, 'comeback')::int;
  end if;
  return got;
end $$;

create or replace function public.academy_me(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := coalesce(p_user, auth.uid()); pts int; c text; courses jsonb := '[]'::jsonb; pa jsonb;
begin
  perform app.require(app.academy_can_view(u), 'Not your team');
  pa := app.academy_path(u); pts := app.academy_points(u);
  foreach c in array array['light', 'knx', 'knxlab', 'net', 'infra', 'bs7671'] loop
    courses := courses || (app.academy_course(u, c) || jsonb_build_object('required', pa->'required' ? c, 'optional', pa->'optional' ? c));
  end loop;
  return jsonb_build_object(
    'user_id', u, 'full_name', (select full_name from public.profiles where id = u), 'role', (select role from public.profiles where id = u),
    'member', app.academy_member(u), 'path', pa, 'state', app.academy_state(u), 'points', pts, 'level', app.academy_level(pts),
    'month_points', app.academy_points(u, date_trunc('month', now()), null), 'streak', app.academy_streak(u), 'courses', courses,
    'badges', coalesce((select jsonb_agg(jsonb_build_object('key', b.badge, 'period', b.period, 'awarded_at', b.awarded_at, 'note', b.note) order by b.awarded_at) from public.academy_badges b where b.user_id = u), '[]'::jsonb),
    'flags_open', (select count(*) from public.academy_flags where user_id = u and reviewed_at is null),
    'spotchecks', coalesce((select jsonb_agg(jsonb_build_object('checked_on', s.checked_on, 'topic', s.topic, 'result', s.result, 'note', s.note, 'by', app.display_name(s.checked_by)) order by s.checked_on desc)
                             from public.academy_spotchecks s where s.user_id = u), '[]'::jsonb));
end $$;

select app.fix_function_owners();
