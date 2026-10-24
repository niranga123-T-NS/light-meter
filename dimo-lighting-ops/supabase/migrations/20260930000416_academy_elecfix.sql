-- Dacademy: Electrical Troubleshooting (public/academy/elec.html) – sits with Wiring Regulations under the Electrical tab.
--  * 30 random-fault jobs and guided demos (hotel, residence, outdoor, indoor lighting, factories, KNX), 5 LED driver workbenches and 6 panel board workbenches.
--  * Demos are lessons; jobs and workbenches are labs (passed at 2/3: a job 7 of 10, a workbench 2 of 3 rounds).
--  * The gold badge on completion and a skill badge for all the driver and panel workbenches.

alter table public.academy_lessons drop constraint if exists academy_lessons_course_check;
alter table public.academy_lessons add constraint academy_lessons_course_check check (course in ('light', 'net', 'knx', 'knxlab', 'infra', 'bs7671', 'elecfix'));

insert into public.academy_lessons (course, module, lesson, kind) values
('elecfix','hotel','ef_h_room_demo','lesson'),
('elecfix','hotel','ef_h_room','lab'),
('elecfix','hotel','ef_h_corr_demo','lesson'),
('elecfix','hotel','ef_h_corr','lab'),
('elecfix','hotel','ef_h_kitchen','lab'),
('elecfix','hotel','ef_h_ball_demo','lesson'),
('elecfix','hotel','ef_h_ball','lab'),
('elecfix','hotel','ef_h_pool','lab'),
('elecfix','home','ef_r_cu_demo','lesson'),
('elecfix','home','ef_r_cu','lab'),
('elecfix','home','ef_r_light','lab'),
('elecfix','home','ef_r_sock','lab'),
('elecfix','home','ef_r_out','lab'),
('elecfix','outdoor','ef_o_street_demo','lesson'),
('elecfix','outdoor','ef_o_street','lab'),
('elecfix','outdoor','ef_o_mast','lab'),
('elecfix','outdoor','ef_o_air','lab'),
('elecfix','indoor','ef_i_prof_demo','lesson'),
('elecfix','indoor','ef_i_prof','lab'),
('elecfix','indoor','ef_i_dali','lab'),
('elecfix','indoor','ef_i_dmx','lab'),
('elecfix','indoor','ef_i_110','lab'),
('elecfix','factory','ef_f_ware','lab'),
('elecfix','factory','ef_f_motor_demo','lesson'),
('elecfix','factory','ef_f_motor','lab'),
('elecfix','factory','ef_f_vfd','lab'),
('elecfix','knx','ef_k_line_demo','lesson'),
('elecfix','knx','ef_k_line','lab'),
('elecfix','knx','ef_k_dali','lab'),
('elecfix','knx','ef_k_lines','lab'),
('elecfix','driver','ef_d_onoff','lab'),
('elecfix','driver','ef_d_dali','lab'),
('elecfix','driver','ef_d_dmx','lab'),
('elecfix','driver','ef_d_110','lab'),
('elecfix','driver','ef_d_mystery','lab'),
('elecfix','panel','ef_p_motor','lab'),
('elecfix','panel','ef_p_light','lab'),
('elecfix','panel','ef_p_prot','lab'),
('elecfix','panel','ef_p_ats','lab'),
('elecfix','panel','ef_p_pq','lab'),
('elecfix','panel','ef_p_pfc','lab')
on conflict (lesson) do update set course = excluded.course, module = excluded.module, kind = excluded.kind;

insert into public.academy_badge_defs (key, family, tier, name, rule, icon, points, auto, sort) values
  ('elecfix_gold', 'course', 'gold', 'Electrical Troubleshooting · Gold', 'Every troubleshooting demo, fault-finding job and workbench passed – certificate', '🔧', 0, true, 29),
  ('ef_workshop', 'skill', 'silver', 'Workshop technician', 'All LED driver and panel board workbenches passed', '🗄️', 0, true, 30)
on conflict (key) do update set family = excluded.family, tier = excluded.tier, name = excluded.name, rule = excluded.rule, icon = excluded.icon,
  points = excluded.points, auto = excluded.auto, sort = excluded.sort;

update public.academy_paths set optional = array_append(optional, 'elecfix')
 where role in ('senior_elec_engineer', 'assistant_engineer', 'trainee', 'lighting_engineer', 'lighting_designer', 'design_manager', 'sm_projects', 'gm')
   and not ('elecfix' = any (optional)) and not ('elecfix' = any (required));

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
  foreach c in array array['light', 'net', 'knx', 'knxlab', 'infra', 'bs7671', 'elecfix'] loop
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
  foreach c in array array['knx', 'knxlab', 'net', 'infra', 'bs7671', 'elecfix'] loop
    if (app.academy_course(p_user, c)->>'complete')::boolean then got := got + app.academy_give(p_user, c || '_gold')::int; end if;
  end loop;
  select count(*) into golds from public.academy_badges where user_id = p_user and badge in ('light_gold', 'knx_gold', 'knxlab_gold', 'net_gold', 'infra_gold', 'bs7671_gold', 'elecfix_gold');
  if golds >= 3 then got := got + app.academy_give(p_user, 'all_rounder')::int; end if;
  if (select count(*) from app.academy_done(p_user) where lesson in ('knxlab_h1', 'knxlab_h2', 'knxlab_h3', 'knxlab_h4', 'knxlab_h5')) = 5 then got := got + app.academy_give(p_user, 'commissioner')::int; end if;
  if exists (select 1 from app.academy_done(p_user) where lesson = 'infra_s08') then got := got + app.academy_give(p_user, 'fault_finder')::int; end if;
  -- Wiring Regulations: a badge for each level – every lesson, practical and module test of its modules
  if app.academy_modules_done(p_user, 'bs7671', array['m1', 'm2', 'm3']) then got := got + app.academy_give(p_user, 'bs_foundations')::int; end if;
  if app.academy_modules_done(p_user, 'bs7671', array['m4', 'm5', 'm6']) then got := got + app.academy_give(p_user, 'bs_protection')::int; end if;
  if app.academy_modules_done(p_user, 'bs7671', array['m7', 'm8', 'm9', 'm10']) then got := got + app.academy_give(p_user, 'bs_design')::int; end if;
  -- Electrical Troubleshooting: every LED driver and panel board workbench passed
  if app.academy_modules_done(p_user, 'elecfix', array['driver', 'panel']) then got := got + app.academy_give(p_user, 'ef_workshop')::int; end if;
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
  foreach c in array array['light', 'knx', 'knxlab', 'net', 'infra', 'bs7671', 'elecfix'] loop
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
