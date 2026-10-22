-- Dacademy programme: a learning path per role with a target date, points and levels, 24 badges (automatic and trainer-awarded),
-- weekly status and streaks, "please review" flags, quarterly spot checks, top learners of the month and course certificates.
--  * academy_lessons: every lesson, lab, session and module test, with its course and module – progress per course comes from it.
--  * academy_paths: required / optional courses and months per role; academy_plans: a person's own start and target date (set by a trainer).
--  * Estimation joins Dacademy (Lighting first), like the engineers – Dacademy only, not the rest of Sales Tools.
--  * academy_record(…, p_secs, p_mins): the page also sends the time on the lesson; too fast, too many attempts or a burst of lessons in a day
--    raises a flag for the trainer – never an automatic penalty.
--  * Team views: SM Projects, GM / DGM and the System Administrator see everyone; the Design Manager the design team; SM Estimation the estimators.

create or replace function app.sees_academy() returns boolean
language sql stable as $$ select app.sees_sales_tools() or app.has_role('senior_elec_engineer', 'assistant_engineer', 'trainee', 'sm_estimation', 'am_estimation', 'estimation_exec') $$;

-- ---------------------------------------------------------------- the course map
create table if not exists public.academy_lessons (
  lesson text primary key,
  course text not null check (course in ('light', 'net', 'knx', 'knxlab', 'infra')),
  module text not null,
  kind text not null check (kind in ('lesson', 'lab', 'session', 'exam', 'test'))
);
alter table public.academy_lessons enable row level security;
drop policy if exists academy_lessons_read on public.academy_lessons;
create policy academy_lessons_read on public.academy_lessons for select to authenticated using (true);
grant select on public.academy_lessons to authenticated;
insert into public.academy_lessons (course, module, lesson, kind) values
('light','basics','lux','lesson'),
('light','basics','eff','lesson'),
('light','basics','cct','lesson'),
('light','basics','cri','lesson'),
('light','basics','ugr','lesson'),
('light','basics','beam','lesson'),
('light','basics','uni','lesson'),
('light','basics','life','lesson'),
('light','basics','driver','lesson'),
('light','basics','ip','lesson'),
('light','basics','dim','lesson'),
('light','basics','emer','lesson'),
('light','basics','app_office','lesson'),
('light','basics','app_retail','lesson'),
('light','basics','app_hosp','lesson'),
('light','basics','app_ind','lesson'),
('light','basics','app_facade','lesson'),
('light','basics','app_roads','lesson'),
('light','basics','app_sports','lesson'),
('light','basics','app_ports','lesson'),
('light','basics','pay','lesson'),
('light','basics','datasheet','lesson'),
('light','basics','quotes','lesson'),
('light','basics','objections','lesson'),
('light','tech','lab_tech','lesson'),
('light','tech','t_down','lesson'),
('light','tech','t_accent','lesson'),
('light','tech','t_wash','lesson'),
('light','tech','t_graze','lesson'),
('light','tech','t_up','lesson'),
('light','tech','t_layer','lesson'),
('light','tech','t_facade','lesson'),
('light','tech','t_flood','lesson'),
('light','fix','lab_fix','lesson'),
('light','fix','f_down','lesson'),
('light','fix','f_flood','lesson'),
('light','fix','f_street','lesson'),
('light','fix','f_panel','lesson'),
('light','fix','f_highbay','lesson'),
('light','fix','f_track','lesson'),
('light','fix','f_driver','lesson'),
('light','chip','lab_chip','lesson'),
('light','chip','c_white','lesson'),
('light','chip','c_types','lesson'),
('light','chip','c_tj','lesson'),
('light','chip','c_current','lesson'),
('light','chip','c_bin','lesson'),
('light','chip','c_lm80','lesson'),
('light','chip','c_brands','lesson'),
('light','ctl','lab_ctl','lesson'),
('light','ctl','p_v110','lesson'),
('light','ctl','p_phase','lesson'),
('light','ctl','p_dali','lesson'),
('light','ctl','p_daliv','lesson'),
('light','ctl','p_dmx','lesson'),
('light','ctl','p_casambi','lesson'),
('light','ctl','p_sensors','lesson'),
('light','ctl','p_choose','lesson'),
('light','lms','lab_lms','lesson'),
('light','lms','lab_knx','lesson'),
('light','lms','lab_cmp','lesson'),
('light','lms','l_strat','lesson'),
('light','lms','l_knxtopo','lesson'),
('light','lms','l_gateways','lesson'),
('light','lms','l_open','lesson'),
('light','road','lab_road','lesson'),
('light','road','r_arrange','lesson'),
('light','road','r_height','lesson'),
('light','road','r_classes','lesson'),
('light','road','r_lum','lesson'),
('light','road','r_optics','lesson'),
('light','road','lab_talq','lesson'),
('light','road','talq_mixed','lesson'),
('light','road','talq_what','lesson'),
('light','road','talq_third','lesson'),
('light','road','lab_cms','lesson'),
('light','sport','lab_sport','lesson'),
('light','sport','s_cricket','lesson'),
('light','sport','s_tennis','lesson'),
('light','sport','s_volley','lesson'),
('light','sport','s_indoor','lesson'),
('light','sport','s_classes','lesson'),
('light','sport','s_glare','lesson'),
('light','sport','s_ops','lesson'),
('light','think','lab_think','lesson'),
('light','think','th_lobby','lesson'),
('light','think','th_office','lesson'),
('light','think','th_rest','lesson'),
('light','think','th_retail','lesson'),
('light','think','th_journey','lesson'),
('light','think','th_lang','lesson'),
('light','think','th_conflict','lesson'),
('light','think','th_arch','lesson'),
('light','think','th_int','lesson'),
('light','think','th_ld','lesson'),
('light','think','th_mep','lesson'),
('light','think','th_present','lesson'),
('light','airport','lab_agl','lesson'),
('light','airport','lab_papi','lesson'),
('light','airport','lab_ccr','lesson'),
('light','airport','lab_twr','lesson'),
('light','airport','lab_vdgs','lesson'),
('light','airport','ap_landing','lesson'),
('light','airport','ap_takeoff','lesson'),
('light','airport','ap_lvp','lesson'),
('light','airport','ap_pbb','lesson'),
('light','airport','ap_fault','lesson'),
('light','airport','lab_serv','lesson'),
('light','airport','ap_iso','lesson'),
('light','airport','ap_cable','lesson'),
('light','airport','ap_mon','lesson'),
('light','airport','ap_std','lesson'),
('light','airport','ap_lights','lesson'),
('light','airport','ap_mark','lesson'),
('light','airport','ap_led','lesson'),
('light','airport','ap_ccrt','lesson'),
('light','airport','ap_ilcms','lesson'),
('light','airport','ap_tower','lesson'),
('light','airport','ap_vdgs','lesson'),
('light','airport','ap_sell','lesson'),
('light','indoor','lab_ind','lesson'),
('light','indoor','in_f','lesson'),
('light','indoor','in_w','lesson'),
('light','indoor','in_h','lesson'),
('light','indoor','in_o','lesson'),
('light','indoor','in_std','lesson'),
('light','indoor','in_lines','lesson'),
('light','indoor','in_wh','lesson'),
('light','indoor','in_hc','lesson'),
('light','indoor','in_off','lesson'),
('light','indoor','in_mf','lesson'),
('light','corr','cr_cell','lesson'),
('light','corr','cr_galv','lesson'),
('light','corr','cr_site','lesson'),
('light','corr','cr_hot','lesson'),
('light','corr','cr_age','lesson'),
('light','corr','cr_cond','lesson'),
('light','corr','cr_test','lesson'),
('light','corr','cr_spec','lesson'),
('light','corr','cr_inst','lesson'),
('light','corr','cr_diag','lesson'),
('light','corr','cr_final','lesson'),
('light','ing','ig_anat','lesson'),
('light','ing','ig_drain','lesson'),
('light','ing','ig_pump','lesson'),
('light','ing','ig_place','lesson'),
('light','ing','ig_order','lesson'),
('light','ing','ig_sim','lesson'),
('light','ing','ig_elec','lesson'),
('light','ing','ig_diag','lesson'),
('light','ing','ig_insp','lesson'),
('light','ing','ig_final','lesson'),
('net','basic','net_why','lesson'),
('net','basic','net_copper','lesson'),
('net','basic','net_fibre','lesson'),
('net','basic','net_ip','lesson'),
('net','basic','net_switch','lesson'),
('net','basic','net_poe','lesson'),
('net','basic','net_rack','lesson'),
('net','basic','net_wifi','lesson'),
('net','adv','net_subnet','lesson'),
('net','adv','net_vlan','lesson'),
('net','adv','net_artnet','lesson'),
('net','adv','net_mcast','lesson'),
('net','adv','net_ring','lesson'),
('net','adv','net_bms','lesson'),
('net','adv','net_sec','lesson'),
('net','adv','net_vpn','lesson'),
('net','site','net_test','lesson'),
('net','site','net_trouble','lesson'),
('net','site','net_handover','lesson'),
('net','exam','net_exam','exam'),
('knx','cert','knx_what','lesson'),
('knx','cert','knx_tp','lesson'),
('knx','cert','knx_topo','lesson'),
('knx','cert','knx_addr','lesson'),
('knx','cert','knx_psu','lesson'),
('knx','cert','knx_cable','lesson'),
('knx','cert','knx_tele','lesson'),
('knx','cert','knx_ga','lesson'),
('knx','cert','knx_flags','lesson'),
('knx','cert','knx_dpt','lesson'),
('knx','cert','knx_ets','lesson'),
('knx','cert','knx_comm','lesson'),
('knx','cert','knx_diag','lesson'),
('knx','cert','knx_light','lesson'),
('knx','cert','knx_blind','lesson'),
('knx','jung','knx_jsys','lesson'),
('knx','jung','knx_jact','lesson'),
('knx','jung','knx_jdali','lesson'),
('knx','jung','knx_jsens','lesson'),
('knx','jung','knx_jvis','lesson'),
('knx','jung','knx_jplan','lesson'),
('knx','adv','knx_ip','lesson'),
('knx','adv','knx_secure','lesson'),
('knx','adv','knx_filter','lesson'),
('knx','adv','knx_load','lesson'),
('knx','adv','knx_logic','lesson'),
('knx','adv','knx_fault','lesson'),
('knx','adv','knx_hand','lesson'),
('knx','exam','knx_exam_cert','exam'),
('knx','exam','knx_exam_adv','exam'),
('knxlab','office','knxlab_t1','lab'),
('knxlab','office','knxlab_t2','lab'),
('knxlab','office','knxlab_t3','lab'),
('knxlab','office','knxlab_t4','lab'),
('knxlab','office','knxlab_t5','lab'),
('knxlab','office','knxlab_t6','lab'),
('knxlab','office','knxlab_t7','lab'),
('knxlab','office','knxlab_t8','lab'),
('knxlab','hotel','knxlab_h0','lab'),
('knxlab','hotel','knxlab_h1','lab'),
('knxlab','hotel','knxlab_h2','lab'),
('knxlab','hotel','knxlab_h3','lab'),
('knxlab','hotel','knxlab_h4','lab'),
('knxlab','hotel','knxlab_h5','lab'),
('infra','m1','infra_s01','session'),
('infra','m1','infra_s02','session'),
('infra','m1','infra_s03','session'),
('infra','m1','infra_s04','session'),
('infra','m1','infra_s05','session'),
('infra','m1','infra_s06','session'),
('infra','m1','infra_s07','session'),
('infra','m1','infra_s08','session'),
('infra','m2','infra_s09','session'),
('infra','m2','infra_s10','session'),
('infra','m2','infra_s11','session'),
('infra','m2','infra_s12','session'),
('infra','m2','infra_s13','session'),
('infra','m2','infra_s14','session'),
('infra','m2','infra_s15','session'),
('infra','m2','infra_s16','session'),
('infra','m3','infra_s17','session'),
('infra','m3','infra_s18','session'),
('infra','m3','infra_s19','session'),
('infra','m3','infra_s20','session'),
('infra','m3','infra_s21','session'),
('infra','m3','infra_s22','session'),
('infra','m4','infra_s23','session'),
('infra','m4','infra_s24','session'),
('light','basics','mt_basics','test'),
('light','tech','mt_tech','test'),
('light','fix','mt_fix','test'),
('light','chip','mt_chip','test'),
('light','ctl','mt_ctl','test'),
('light','lms','mt_lms','test'),
('light','road','mt_road','test'),
('light','sport','mt_sport','test'),
('light','think','mt_think','test'),
('light','airport','mt_airport','test'),
('light','indoor','mt_indoor','test'),
('light','corr','mt_corr','test'),
('light','ing','mt_ing','test'),
('net','basic','net_mt_basic','test'),
('net','adv','net_mt_adv','test'),
('net','site','net_mt_site','test'),
('knx','cert','knx_mt_cert','test'),
('knx','jung','knx_mt_jung','test'),
('knx','adv','knx_mt_adv','test'),
('infra','m1','infra_mt_m1','test'),
('infra','m2','infra_mt_m2','test'),
('infra','m3','infra_mt_m3','test')
on conflict (lesson) do update set course = excluded.course, module = excluded.module, kind = excluded.kind;

create table if not exists public.academy_paths (
  role public.app_role primary key,
  required text[] not null default '{}',
  optional text[] not null default '{}',
  months int check (months between 1 and 36)
);
alter table public.academy_paths enable row level security;
drop policy if exists academy_paths_read on public.academy_paths;
create policy academy_paths_read on public.academy_paths for select to authenticated using (true);
grant select on public.academy_paths to authenticated;
insert into public.academy_paths (role, required, optional, months) values
  ('asm_building', '{light}', '{knx}', 6), ('asm_infra', '{light}', '{knx}', 6),
  ('lighting_designer', '{light,knx}', '{knxlab}', 6), ('lighting_engineer', '{light,knx,knxlab}', '{net}', 7),
  ('sm_estimation', '{light}', '{knx}', 6), ('am_estimation', '{light}', '{knx}', 6), ('estimation_exec', '{light}', '{knx}', 6),
  ('senior_elec_engineer', '{infra,net}', '{light}', 4), ('assistant_engineer', '{infra,net}', '{light}', 4), ('trainee', '{infra,net}', '{light}', 4),
  ('design_manager', '{}', '{light,knx,knxlab,net}', null), ('sm_projects', '{}', '{light,knx,knxlab,net,infra}', null), ('gm', '{}', '{light,knx,knxlab,net,infra}', null)
on conflict (role) do nothing;

create table if not exists public.academy_settings (id boolean primary key default true check (id), launched_on date not null default current_date);
insert into public.academy_settings (id) values (true) on conflict do nothing;
alter table public.academy_settings enable row level security;

create table if not exists public.academy_plans (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  start_on date, target_on date, note text,
  set_by uuid references public.profiles (id), updated_at timestamptz not null default now()
);
alter table public.academy_plans enable row level security;

-- ---------------------------------------------------------------- badges
create table if not exists public.academy_badge_defs (
  key text primary key,
  family text not null check (family in ('course', 'skill', 'excellence', 'habit', 'contribution')),
  tier text not null check (tier in ('bronze', 'silver', 'gold', 'platinum')),
  name text not null, rule text not null, icon text not null,
  points int not null default 0, auto boolean not null default true, sort int not null
);
alter table public.academy_badge_defs enable row level security;
drop policy if exists academy_badge_defs_read on public.academy_badge_defs;
create policy academy_badge_defs_read on public.academy_badge_defs for select to authenticated using (true);
grant select on public.academy_badge_defs to authenticated;
insert into public.academy_badge_defs (key, family, tier, name, rule, icon, points, auto, sort) values
  ('light_bronze', 'course', 'bronze', 'Lighting · Bronze', 'A quarter of the Lighting lessons passed', '💡', 0, true, 1),
  ('light_silver', 'course', 'silver', 'Lighting · Silver', 'Half of the Lighting lessons and the first four module tests passed', '💡', 0, true, 2),
  ('light_gold', 'course', 'gold', 'Lighting · Gold', 'Every Lighting lesson and module test passed – certificate', '💡', 0, true, 3),
  ('light_platinum', 'course', 'platinum', 'Lighting · Platinum', 'Lighting Gold with every module test at 90 % or more', '💡', 0, true, 4),
  ('knx_gold', 'course', 'gold', 'KNX – JUNG · Gold', 'Every KNX lesson and module test passed – certificate', '🔌', 0, true, 5),
  ('knxlab_gold', 'course', 'gold', 'KNX Studio · Gold', 'All 14 KNX Studio exercises solved – certificate', '🛠️', 0, true, 6),
  ('net_gold', 'course', 'gold', 'Network & IT · Gold', 'Every Network & IT lesson and module test passed – certificate', '🌐', 0, true, 7),
  ('infra_gold', 'course', 'gold', 'Infrastructure · Gold', 'All 24 sessions and the module tests passed – certificate', '🖥️', 0, true, 8),
  ('commissioner', 'skill', 'silver', 'Commissioner', 'The KNX Studio hotel project solved (exercises h1–h5)', '🏨', 0, true, 9),
  ('fault_finder', 'skill', 'silver', 'Fault Finder', 'The graded 6-fault network test passed (Infrastructure session 8)', '🔧', 0, true, 10),
  ('glare_guru', 'skill', 'gold', 'Glare Guru', 'Sports lighting module test at 90 % or more', '🏟️', 0, true, 11),
  ('all_rounder', 'skill', 'platinum', 'All-rounder', 'Gold in three courses', '👑', 0, true, 12),
  ('sharpshooter', 'excellence', 'bronze', 'Sharpshooter', '10 lessons passed first time with every answer right', '🎯', 0, true, 13),
  ('clean_sheet', 'excellence', 'silver', 'Clean Sheet', 'A module test at 15 of 15', '✅', 0, true, 14),
  ('top_month', 'excellence', 'gold', 'Top of the Month', 'Most points in the team in a month', '⭐', 50, true, 15),
  ('writeup_quarter', 'excellence', 'platinum', 'Write-up of the Quarter', 'Best-marked write-up of the quarter, chosen by the trainer', '📘', 50, false, 16),
  ('streak4', 'habit', 'bronze', 'Streak 4', 'Weekly target met four weeks running', '🔥', 0, true, 17),
  ('streak12', 'habit', 'silver', 'Streak 12', 'Weekly target met twelve weeks running', '🔥', 0, true, 18),
  ('ahead_plan', 'habit', 'gold', 'Ahead of Plan', 'Every required course completed before the target date', '☀️', 0, true, 19),
  ('comeback', 'habit', 'bronze', 'Comeback', 'Back on track after falling behind', '↩️', 0, true, 20),
  ('field_fix', 'contribution', 'silver', 'Field Fix', 'A lesson linked from a design review done that week and the next design passed', '🧰', 25, false, 21),
  ('mentor', 'contribution', 'gold', 'Mentor', 'Led a monthly learning session', '👥', 100, false, 22),
  ('coach', 'contribution', 'platinum', 'Coach', 'Mentored two colleagues to a Gold course badge', '🤝', 100, false, 23),
  ('question_builder', 'contribution', 'silver', 'Question Builder', 'Three quiz questions accepted into the pool', '❓', 50, false, 24)
on conflict (key) do update set family = excluded.family, tier = excluded.tier, name = excluded.name, rule = excluded.rule, icon = excluded.icon,
  points = excluded.points, auto = excluded.auto, sort = excluded.sort;

create table if not exists public.academy_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge text not null references public.academy_badge_defs (key),
  period text not null default '',   -- 'YYYY-MM' for Top of the Month, '' otherwise
  awarded_at timestamptz not null default now(),
  awarded_by uuid references public.profiles (id),
  note text,
  primary key (user_id, badge, period)
);
alter table public.academy_badges enable row level security;
drop policy if exists academy_badges_read on public.academy_badges;
create policy academy_badges_read on public.academy_badges for select to authenticated using (true);   -- badges are recognition: everyone may see them
grant select on public.academy_badges to authenticated;

-- ---------------------------------------------------------------- review flags, spot checks, weekly history
create table if not exists public.academy_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('fast', 'attempts', 'burst')),
  lesson text, detail text not null,
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id), reviewed_at timestamptz, note text
);
create index if not exists academy_flags_open on public.academy_flags (user_id) where reviewed_at is null;
alter table public.academy_flags enable row level security;

create table if not exists public.academy_spotchecks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  checked_by uuid not null references public.profiles (id),
  checked_on date not null default current_date,
  topic text not null, result text not null check (result in ('pass', 'needs_work')), note text,
  created_at timestamptz not null default now()
);
alter table public.academy_spotchecks enable row level security;

create table if not exists public.academy_weeks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  done int not null, pace int not null, met boolean not null,
  status text not null check (status in ('ahead', 'on_track', 'behind', 'idle', 'complete')),
  primary key (user_id, week_start)
);
alter table public.academy_weeks enable row level security;

-- ---------------------------------------------------------------- who sees whom
create or replace function app.academy_member(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p join public.academy_paths a on a.role = p.role where p.id = p_user and p.active)
$$;
create or replace function app.academy_can_view(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  if p_user = auth.uid() or app.trains_academy() then return true; end if;
  select role::text into r from public.profiles where id = p_user;
  if app.has_role('design_manager') and r in ('design_manager', 'lighting_designer', 'lighting_engineer') then return true; end if;
  if app.has_role('sm_estimation') and r in ('sm_estimation', 'am_estimation', 'estimation_exec') then return true; end if;
  return false;
end $$;
create or replace function app.academy_coaches(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin return p_user <> auth.uid() and app.academy_can_view(p_user); end $$;

-- ---------------------------------------------------------------- the numbers
-- Done items of a person with their course, module and kind
create or replace function app.academy_done(p_user uuid)
returns table (lesson text, course text, module text, kind text, best int, total int, attempts int, done_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.lesson, l.course, l.module, l.kind, p.best, p.total, p.attempts, p.done_at
    from public.academy_progress p join public.academy_lessons l on l.lesson = p.lesson
   where p.user_id = p_user and p.done
$$;

-- One course for one person: items, done, tests, 90 % tests, complete and when
create or replace function app.academy_course(p_user uuid, p_course text) returns jsonb
language sql stable security definer set search_path = public as $$
  with items as (select * from public.academy_lessons where course = p_course and kind <> 'exam'),
       d as (select * from app.academy_done(p_user) where course = p_course and kind <> 'exam')
  select jsonb_build_object(
    'course', p_course,
    'lessons', (select count(*) from items where kind <> 'test'), 'lessons_done', (select count(*) from d where kind <> 'test'),
    'tests', (select count(*) from items where kind = 'test'), 'tests_passed', (select count(*) from d where kind = 'test'),
    'tests_90', (select count(*) from d where kind = 'test' and best * 10 >= total * 9),
    'complete', (select count(*) from items) > 0 and (select count(*) from d) = (select count(*) from items),
    'completed_at', case when (select count(*) from d) = (select count(*) from items) then (select max(done_at) from d) end)
$$;

-- The person's path: required / optional courses, start, target, required items and expected pace
create or replace function app.academy_path(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.academy_paths; pl public.academy_plans; st date; tg date; n int; wk numeric;
begin
  select ap.* into a from public.academy_paths ap join public.profiles p on p.role = ap.role where p.id = p_user;
  select * into pl from public.academy_plans where user_id = p_user;
  st := coalesce(pl.start_on, (select launched_on from public.academy_settings));
  tg := coalesce(pl.target_on, case when a.months is not null then (st + make_interval(months => a.months))::date end);
  select count(*) into n from public.academy_lessons where course = any (coalesce(a.required, '{}')) and kind <> 'exam';
  wk := greatest(1, (coalesce(tg, st + 182) - st) / 7.0);
  return jsonb_build_object('required', coalesce(a.required, '{}'), 'optional', coalesce(a.optional, '{}'), 'months', a.months,
    'start_on', st, 'target_on', tg, 'items', n, 'pace', case when n > 0 and tg is not null then ceil(n / wk)::int else 0 end, 'custom', pl.user_id is not null);
end $$;

-- Points: lesson 10 (+5 first time), lab / session 25, module test 50 (+25 at 90 %), write-up mark × 0.5, course complete 200,
-- weekly target met 15, trainer-awarded badges their points
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
  foreach c in array array['light', 'net', 'knx', 'knxlab', 'infra'] loop
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

create or replace function app.academy_level(p_points int) returns jsonb
language sql immutable as $$
  select case when p_points >= 4000 then jsonb_build_object('level', 5, 'name', 'Master', 'from', 4000, 'next', null)
              when p_points >= 2500 then jsonb_build_object('level', 4, 'name', 'Expert', 'from', 2500, 'next', 4000)
              when p_points >= 1500 then jsonb_build_object('level', 3, 'name', 'Specialist', 'from', 1500, 'next', 2500)
              when p_points >= 600 then jsonb_build_object('level', 2, 'name', 'Practitioner', 'from', 600, 'next', 1500)
              else jsonb_build_object('level', 1, 'name', 'Learner', 'from', 0, 'next', 600) end
$$;

-- Where the person stands against the path: done vs expected by today
create or replace function app.academy_state(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pa jsonb := app.academy_path(p_user); n int := (pa->>'items')::int; pace int := (pa->>'pace')::int; st date := (pa->>'start_on')::date; tg date := (pa->>'target_on')::date;
        done int; expd numeric; last_at timestamptz; wk int; status text;
begin
  select count(*) into done from app.academy_done(p_user) where course = any (select jsonb_array_elements_text(pa->'required')) and kind <> 'exam';
  select max(updated_at) into last_at from public.academy_progress where user_id = p_user;
  select count(*) into wk from app.academy_done(p_user) where done_at >= date_trunc('week', now());
  expd := case when n = 0 or tg is null then 0 when current_date >= tg then n else n * greatest(0, current_date - st)::numeric / greatest(1, tg - st) end;
  status := case when n = 0 then 'open'
                 when done >= n then 'complete'
                 when last_at is null or last_at < now() - interval '14 days' then 'idle'
                 when done >= expd + 2 * pace then 'ahead'
                 when done >= expd - pace then 'on_track'
                 else 'behind' end;
  return jsonb_build_object('items', n, 'done', done, 'expected', floor(expd)::int, 'pace', pace, 'this_week', wk, 'status', status, 'last_at', last_at,
    'idle_weeks', case when last_at is null then null else floor(extract(epoch from now() - last_at) / 604800)::int end);
end $$;

-- Consecutive weeks with the weekly target met, counting back from the last finished week
create or replace function app.academy_streak(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  with w as (select week_start, met, row_number() over (order by week_start desc) rn from public.academy_weeks where user_id = p_user)
  select coalesce((select min(rn) - 1 from w where not met), (select count(*) from w))::int
$$;

-- ---------------------------------------------------------------- awarding
create or replace function app.academy_give(p_user uuid, p_badge text, p_period text default '', p_by uuid default null, p_note text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare d public.academy_badge_defs; n int;
begin
  insert into public.academy_badges (user_id, badge, period, awarded_by, note) values (p_user, p_badge, coalesce(p_period, ''), p_by, p_note)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    select * into d from public.academy_badge_defs where key = p_badge;
    perform app.notify_many(array[p_user], 'academy_badge', 'New Dacademy badge: ' || d.name, d.rule, 'normal', null, null, '/tools?tab=learn');
  end if;
  return n > 0;
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
  foreach c in array array['knx', 'knxlab', 'net', 'infra'] loop
    if (app.academy_course(p_user, c)->>'complete')::boolean then got := got + app.academy_give(p_user, c || '_gold')::int; end if;
  end loop;
  select count(*) into golds from public.academy_badges where user_id = p_user and badge in ('light_gold', 'knx_gold', 'knxlab_gold', 'net_gold', 'infra_gold');
  if golds >= 3 then got := got + app.academy_give(p_user, 'all_rounder')::int; end if;
  if (select count(*) from app.academy_done(p_user) where lesson in ('knxlab_h1', 'knxlab_h2', 'knxlab_h3', 'knxlab_h4', 'knxlab_h5')) = 5 then got := got + app.academy_give(p_user, 'commissioner')::int; end if;
  if exists (select 1 from app.academy_done(p_user) where lesson = 'infra_s08') then got := got + app.academy_give(p_user, 'fault_finder')::int; end if;
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

-- ---------------------------------------------------------------- recording a result (the course pages)
drop function if exists public.academy_record(text, int, int);
create or replace function public.academy_record(p_lesson text, p_score int, p_total int, p_secs int default null, p_mins numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare pass boolean; was boolean; now_done boolean; tries int; today int; u uuid := auth.uid();
begin
  perform app.require(app.sees_academy(), 'Dacademy is for Sales Tools users, Estimation and the engineers');
  perform app.require(p_lesson ~ '^[a-z0-9_]{1,40}$' and p_total between 1 and 30 and p_score between 0 and p_total, 'Not a valid lesson result');
  pass := case when p_lesson ~ '(^|_)mt_' then p_score * 5 >= p_total * 4 else p_score * 3 >= p_total * 2 end;
  select done into was from public.academy_progress where user_id = u and lesson = p_lesson;
  insert into public.academy_progress as a (user_id, lesson, score, total, best, attempts, done, done_at)
  values (u, p_lesson, p_score, p_total, p_score, 1, pass, case when pass then now() end)
  on conflict (user_id, lesson) do update set score = excluded.score, total = excluded.total, best = greatest(a.best, excluded.score),
    attempts = a.attempts + 1, done = a.done or pass, done_at = coalesce(a.done_at, case when pass then now() end), updated_at = now()
  returning done, attempts into now_done, tries;
  -- first pass: look for signs the lesson was not really learned (for the trainer to review, never a penalty)
  if now_done and not coalesce(was, false) then
    if p_secs is not null and p_mins is not null and p_mins > 0 and p_secs < p_mins * 60 * 0.3 then
      insert into public.academy_flags (user_id, kind, lesson, detail)
      values (u, 'fast', p_lesson, format('Passed after %s s – the lesson takes about %s min to read', p_secs, round(p_mins, 1)));
    end if;
    if tries >= 4 then
      insert into public.academy_flags (user_id, kind, lesson, detail) values (u, 'attempts', p_lesson, format('Passed on attempt %s', tries));
    end if;
    select count(*) into today from public.academy_progress where user_id = u and done and done_at >= date_trunc('day', now() at time zone app.tz()) at time zone app.tz();
    if today = 15 then
      insert into public.academy_flags (user_id, kind, lesson, detail) values (u, 'burst', p_lesson, '15 lessons passed in one day');
    end if;
    perform app.academy_award(u);
  end if;
end $$;
revoke all on function public.academy_record(text, int, int, int, numeric) from public, anon;
grant execute on function public.academy_record(text, int, int, int, numeric) to authenticated;

-- a marked write-up counts towards points and badges
create or replace function app.academy_writeup_marked() returns trigger language plpgsql security definer set search_path = public as $$
begin if new.mark is not null and new.mark is distinct from old.mark then perform app.academy_award(new.user_id); end if; return new; end $$;
drop trigger if exists academy_writeup_marked on public.academy_writeups;
create trigger academy_writeup_marked after update of mark on public.academy_writeups for each row execute function app.academy_writeup_marked();

-- ---------------------------------------------------------------- what the app reads
-- My Dacademy (or a team member's, for the people allowed to see them)
create or replace function public.academy_me(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := coalesce(p_user, auth.uid()); pts int; c text; courses jsonb := '[]'::jsonb; pa jsonb;
begin
  perform app.require(app.academy_can_view(u), 'Not your team');
  pa := app.academy_path(u); pts := app.academy_points(u);
  foreach c in array array['light', 'knx', 'knxlab', 'net', 'infra'] loop
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
revoke all on function public.academy_me(uuid) from public, anon;
grant execute on function public.academy_me(uuid) to authenticated;

-- The team view: everyone the viewer may see, with path, status, level and open review flags
create or replace function public.academy_team_view() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.trains_academy() or app.has_role('design_manager', 'sm_estimation'), 'Only SM Projects, GM / DGM, the Design Manager, SM Estimation and the System Administrator see team progress');
  return coalesce((select jsonb_agg(r order by (r->>'points')::int desc) from (
    select jsonb_build_object('user_id', p.id, 'full_name', p.full_name, 'role', p.role, 'points', app.academy_points(p.id),
             'month_points', app.academy_points(p.id, date_trunc('month', now()), null),
             'state', app.academy_state(p.id), 'path', app.academy_path(p.id),
             'tests_passed', (select count(*) from app.academy_done(p.id) where kind = 'test'),
             'badges', (select count(*) from public.academy_badges where user_id = p.id),
             'flags_open', (select count(*) from public.academy_flags where user_id = p.id and reviewed_at is null),
             'last_spotcheck', (select max(checked_on) from public.academy_spotchecks where user_id = p.id)) r
      from public.profiles p join public.academy_paths a on a.role = p.role
     where p.active and p.id <> auth.uid() and app.academy_can_view(p.id)) x), '[]'::jsonb);
end $$;
revoke all on function public.academy_team_view() from public, anon;
grant execute on function public.academy_team_view() to authenticated;

-- Top learners of a month (points earned in that month), by team – open to every Dacademy user: recognition is the point
create or replace function public.academy_leaders(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m0 timestamptz := date_trunc('month', coalesce(p_month, current_date)::timestamptz); m1 timestamptz := m0 + interval '1 month';
begin
  perform app.require(app.sees_academy(), 'Dacademy only');
  return coalesce((select jsonb_agg(x order by (x->>'points')::int desc) from (
    select jsonb_build_object('user_id', p.id, 'full_name', p.full_name, 'role', p.role, 'team', app.academy_team_of(p.role::text), 'points', app.academy_points(p.id, m0, m1)) x
      from public.profiles p join public.academy_paths a on a.role = p.role where p.active) y where (x->>'points')::int > 0), '[]'::jsonb);
end $$;
create or replace function app.academy_team_of(p_role text) returns text language sql immutable as $$
  select case when p_role in ('asm_building', 'asm_infra') then 'Sales'
              when p_role in ('design_manager', 'lighting_designer', 'lighting_engineer') then 'Design'
              when p_role in ('sm_estimation', 'am_estimation', 'estimation_exec') then 'Estimation'
              when p_role in ('senior_elec_engineer', 'assistant_engineer', 'trainee') then 'Engineers'
              else 'Management' end $$;
revoke all on function public.academy_leaders(date) from public, anon;
grant execute on function public.academy_leaders(date) to authenticated;

-- Review flags: list and close (SM Projects / GM / sys admin for everyone, Design Manager and SM Estimation for their teams)
create or replace function public.academy_flags_list(p_open boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'user_id', f.user_id, 'full_name', p.full_name, 'kind', f.kind, 'lesson', f.lesson, 'detail', f.detail,
            'created_at', f.created_at, 'reviewed_at', f.reviewed_at, 'reviewed_by', app.display_name(f.reviewed_by), 'note', f.note) order by f.created_at desc)
    from public.academy_flags f join public.profiles p on p.id = f.user_id
   where app.academy_coaches(f.user_id) and (not p_open or f.reviewed_at is null)), '[]'::jsonb);
end $$;
create or replace function public.academy_flag_review(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare f public.academy_flags;
begin
  select * into f from public.academy_flags where id = p_id;
  perform app.require(f.id is not null and app.academy_coaches(f.user_id), 'Not your team');
  update public.academy_flags set reviewed_by = auth.uid(), reviewed_at = now(), note = nullif(trim(p_note), '') where id = p_id;
end $$;
revoke all on function public.academy_flags_list(boolean), public.academy_flag_review(uuid, text) from public, anon;
grant execute on function public.academy_flags_list(boolean), public.academy_flag_review(uuid, text) to authenticated;

-- Spot checks, trainer badges and a person's own target date
create or replace function public.academy_spotcheck_add(p_user uuid, p_topic text, p_result text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.academy_coaches(p_user), 'Not your team');
  perform app.require(coalesce(trim(p_topic), '') <> '' and p_result in ('pass', 'needs_work'), 'Enter the topic and the result');
  insert into public.academy_spotchecks (user_id, checked_by, topic, result, note) values (p_user, auth.uid(), trim(p_topic), p_result, nullif(trim(p_note), ''));
end $$;
create or replace function public.academy_badge_award(p_user uuid, p_badge text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.academy_coaches(p_user), 'Not your team');
  perform app.require(exists (select 1 from public.academy_badge_defs where key = p_badge and not auto), 'This badge is awarded automatically');
  -- monthly / quarterly recognitions can be earned again; Coach and Question Builder once
  perform app.require(app.academy_give(p_user, p_badge, case when p_badge in ('writeup_quarter', 'mentor', 'field_fix') then to_char(now(), 'YYYY-MM') else '' end, auth.uid(), nullif(trim(p_note), '')),
                      'Already awarded' || case when p_badge in ('writeup_quarter', 'mentor', 'field_fix') then ' this month' else '' end);
end $$;
create or replace function public.academy_plan_set(p_user uuid, p_start date, p_target date, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.academy_coaches(p_user) or app.trains_academy(), 'Not your team');
  perform app.require(p_target is null or p_start is null or p_target > p_start, 'The target date must be after the start');
  insert into public.academy_plans (user_id, start_on, target_on, note, set_by) values (p_user, p_start, p_target, nullif(trim(p_note), ''), auth.uid())
  on conflict (user_id) do update set start_on = excluded.start_on, target_on = excluded.target_on, note = excluded.note, set_by = auth.uid(), updated_at = now();
end $$;
revoke all on function public.academy_spotcheck_add(uuid, text, text, text), public.academy_badge_award(uuid, text, text), public.academy_plan_set(uuid, date, date, text) from public, anon;
grant execute on function public.academy_spotcheck_add(uuid, text, text, text), public.academy_badge_award(uuid, text, text), public.academy_plan_set(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------- weekly and monthly jobs
-- Monday: last week's result per person (target met, status), then badges; first of the month: Top of the Month per team
create or replace function public.academy_weekly_tick(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare r record; w0 date := (date_trunc('week', p_now) - interval '7 days')::date; n int := 0; st jsonb; done int; pace int;
begin
  for r in select p.id from public.profiles p join public.academy_paths a on a.role = p.role where p.active and cardinality(a.required) > 0 loop
    select count(*) into done from app.academy_done(r.id) where done_at >= w0 and done_at < w0 + 7;
    st := app.academy_state(r.id); pace := (st->>'pace')::int;
    insert into public.academy_weeks (user_id, week_start, done, pace, met, status)
    values (r.id, w0, done, pace, pace > 0 and done >= pace, case when st->>'status' in ('ahead', 'on_track', 'behind', 'idle', 'complete') then st->>'status' else 'on_track' end)
    on conflict (user_id, week_start) do update set done = excluded.done, pace = excluded.pace, met = excluded.met, status = excluded.status;
    perform app.academy_award(r.id); n := n + 1;
  end loop;
  return n;
end $$;
create or replace function public.academy_monthly_tick(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare m1 timestamptz := date_trunc('month', p_now); m0 timestamptz := m1 - interval '1 month'; r record; n int := 0;
begin
  for r in select distinct on (t.team) t.id, t.pts from (
             select p.id, app.academy_team_of(p.role::text) team, app.academy_points(p.id, m0, m1) pts
               from public.profiles p join public.academy_paths a on a.role = p.role where p.active) t
           where t.pts > 0 order by t.team, t.pts desc loop
    if app.academy_give(r.id, 'top_month', to_char(m0, 'YYYY-MM'), null, format('%s points in %s', r.pts, to_char(m0, 'Mon YYYY'))) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.academy_weekly_tick(timestamptz), public.academy_monthly_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.academy_weekly_tick(timestamptz), public.academy_monthly_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('academy-weekly', '30 19 * * 0', 'select public.academy_weekly_tick()');    -- Monday 01:00 Sri Lanka time
    perform cron.schedule('academy-monthly', '45 19 1 * *', 'select public.academy_monthly_tick()');  -- 1st of the month, early morning
  end if;
end $$;

-- badges already earned by people who studied before the programme
do $$ declare r record; begin
  for r in select distinct user_id from public.academy_progress loop perform app.academy_award(r.user_id); end loop;
end $$;

select app.fix_function_owners();
