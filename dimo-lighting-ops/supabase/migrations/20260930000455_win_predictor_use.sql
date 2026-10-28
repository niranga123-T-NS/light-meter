-- Win Predictor use: every open / score / apply of the Win Probability Wizard is logged per sales person, project and inquiry.
--  * Sales people get a daily pop-up with their own use (last 30 days, team average, 8 weeks) and a reminder when they open a
--    project or inquiry the wizard has not scored in 30 days (each at most once a day).
--  * Checking out of a visit to a project raises follow-ups "update the win probability": one for the project, one per open inquiry.
--    They close on a wizard score (project), a new inquiry % (inquiry), a reviewed project %, or "No change"; still open after
--    3 working days they go to the sales person's manager.
--  * DGM / GM and SM Projects see the use per sales person and every use in Reports › Win Predictor use.

create table if not exists public.win_wizard_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id),
  project_id uuid not null references public.projects (id) on delete cascade,
  inquiry_id uuid references public.inquiries (id) on delete set null,
  action text not null check (action in ('opened', 'scored', 'applied')),
  score_id bigint references public.win_scores (id) on delete set null,
  wizard_pct int,
  before_pct int,
  after_pct int,
  after_visit boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists win_wizard_log_user on public.win_wizard_log (user_id, at desc);
create index if not exists win_wizard_log_project on public.win_wizard_log (project_id, at desc);

create table if not exists public.win_followups (
  id bigint generated always as identity primary key,
  visit_id uuid references public.visits (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  inquiry_id uuid references public.inquiries (id) on delete cascade,
  sales_person_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_how text check (done_how in ('wizard', 'pct', 'no_change', 'closed')),
  escalated_at timestamptz
);
create index if not exists win_followups_open on public.win_followups (sales_person_id) where done_at is null;
create index if not exists win_followups_project on public.win_followups (project_id);

-- Pop-ups seen today (the usage pop-up, and the reminder per project), so each shows at most once a day on any device
create table if not exists public.win_nudges_seen (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('usage', 'project')),
  ref uuid not null default '00000000-0000-0000-0000-000000000000',
  day date not null,
  primary key (user_id, kind, ref, day)
);

alter table public.win_wizard_log enable row level security;
alter table public.win_followups enable row level security;
alter table public.win_nudges_seen enable row level security;

-- Own rows; the manager of the person; DGM / GM and SM Projects all
create or replace function app.can_see_win_use(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or app.has_role('gm', 'sm_projects') or exists (select 1 from public.profiles where id = p_user and manager_id = auth.uid())
$$;

drop policy if exists win_wizard_log_read on public.win_wizard_log;
create policy win_wizard_log_read on public.win_wizard_log for select to authenticated using (app.can_see_win_use(user_id));
drop policy if exists win_followups_read on public.win_followups;
create policy win_followups_read on public.win_followups for select to authenticated using (app.can_see_win_use(sales_person_id));
drop policy if exists win_nudges_seen_read on public.win_nudges_seen;
create policy win_nudges_seen_read on public.win_nudges_seen for select to authenticated using (user_id = auth.uid());
grant select on public.win_wizard_log, public.win_followups, public.win_nudges_seen to authenticated;

create or replace function app.project_open(p public.projects) returns boolean language sql immutable as $$
  select p.status in ('active', 'dormant', 'on_hold') and p.milestone::text not in ('won', 'lost')
$$;

-- A visit to the project in the last 7 days by this person (the score "followed a visit")
create or replace function app.after_visit(p_project uuid, p_user uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.visits v where v.project_id = p_project and v.sales_person_id = p_user and v.checkout_at is not null
                 and v.checkout_at <= p_at and v.checkout_at > p_at - interval '7 days')
$$;

-- ---------------------------------------------------------------------------
-- Logging
-- ---------------------------------------------------------------------------
-- The app logs an open of the wizard (from a project, or from one of its inquiries); repeated opens within 10 minutes count once
create or replace function public.log_wizard_open(p_project uuid, p_inquiry uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.can_score_project(p_project) then return; end if;
  if exists (select 1 from public.win_wizard_log where user_id = auth.uid() and project_id = p_project and action = 'opened' and at > now() - interval '10 minutes') then return; end if;
  insert into public.win_wizard_log (user_id, project_id, inquiry_id, action, before_pct, after_visit)
  select auth.uid(), p.id, (select id from public.inquiries where id = p_inquiry and project_id = p.id), 'opened', p.win_probability, app.after_visit(p.id, auth.uid(), now())
  from public.projects p where p.id = p_project;
end $$;
grant execute on function public.log_wizard_open(uuid, uuid) to authenticated;

-- The inquiry the wizard was last opened from (same person, same project, within a day)
create or replace function app.wizard_inquiry(p_project uuid, p_user uuid, p_at timestamptz) returns uuid
language sql stable security definer set search_path = public as $$
  select inquiry_id from public.win_wizard_log where project_id = p_project and user_id = p_user and action = 'opened'
    and at <= p_at and at > p_at - interval '1 day' order by at desc limit 1
$$;

create or replace function app.win_score_logged() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.win_wizard_log (user_id, project_id, inquiry_id, action, score_id, wizard_pct, before_pct, after_visit, at)
    values (new.scored_by, new.project_id, app.wizard_inquiry(new.project_id, new.scored_by, new.scored_at), 'scored', new.id, new.wizard_pct, new.manual_pct,
            app.after_visit(new.project_id, new.scored_by, new.scored_at), new.scored_at);
    update public.win_followups set done_at = now(), done_how = 'wizard' where project_id = new.project_id and inquiry_id is null and done_at is null;
  elsif new.applied <> 'saved' and old.applied = 'saved' then
    insert into public.win_wizard_log (user_id, project_id, inquiry_id, action, score_id, wizard_pct, before_pct, after_pct, after_visit)
    values (coalesce(auth.uid(), new.scored_by), new.project_id, app.wizard_inquiry(new.project_id, new.scored_by, new.scored_at), 'applied', new.id, new.wizard_pct,
            new.manual_pct, new.chosen_pct, app.after_visit(new.project_id, new.scored_by, new.scored_at));
  end if;
  return new;
end $$;
drop trigger if exists win_score_logged on public.win_scores;
create trigger win_score_logged after insert or update of applied on public.win_scores for each row execute function app.win_score_logged();

-- History: the scores made before the log existed
insert into public.win_wizard_log (user_id, project_id, action, score_id, wizard_pct, before_pct, after_visit, at)
select s.scored_by, s.project_id, 'scored', s.id, s.wizard_pct, s.manual_pct, app.after_visit(s.project_id, s.scored_by, s.scored_at), s.scored_at
from public.win_scores s where not exists (select 1 from public.win_wizard_log l where l.score_id = s.id and l.action = 'scored');
insert into public.win_wizard_log (user_id, project_id, action, score_id, wizard_pct, before_pct, after_pct, after_visit, at)
select s.scored_by, s.project_id, 'applied', s.id, s.wizard_pct, s.manual_pct, s.chosen_pct, app.after_visit(s.project_id, s.scored_by, s.scored_at), s.scored_at
from public.win_scores s where s.applied <> 'saved' and not exists (select 1 from public.win_wizard_log l where l.score_id = s.id and l.action = 'applied');

-- ---------------------------------------------------------------------------
-- Follow-ups after a visit
-- ---------------------------------------------------------------------------
create or replace function app.visit_followups() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.projects;
begin
  if new.checkout_at is null or new.project_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.checkout_at is not null then return new; end if;
  select * into p from public.projects where id = new.project_id;
  if p.id is null or not app.project_open(p) then return new; end if;
  -- one open follow-up per project / inquiry: a second visit before the update keeps the first
  insert into public.win_followups (visit_id, project_id, sales_person_id)
  select new.id, p.id, new.sales_person_id
  where not exists (select 1 from public.win_followups where project_id = p.id and inquiry_id is null and sales_person_id = new.sales_person_id and done_at is null);
  insert into public.win_followups (visit_id, project_id, inquiry_id, sales_person_id)
  select new.id, p.id, i.id, new.sales_person_id from public.inquiries i
  where i.project_id = p.id and app.inquiry_open(i.status)
    and not exists (select 1 from public.win_followups f where f.inquiry_id = i.id and f.sales_person_id = new.sales_person_id and f.done_at is null);
  return new;
end $$;
drop trigger if exists visit_followups on public.visits;
create trigger visit_followups after insert or update of checkout_at on public.visits for each row execute function app.visit_followups();

-- An inquiry's % set (even to the same value), or its result recorded
create or replace function app.inquiry_followups_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not app.inquiry_open(new.status) then
    update public.win_followups set done_at = now(), done_how = 'closed' where inquiry_id = new.id and done_at is null;
  elsif new.win_set_at is distinct from old.win_set_at then
    update public.win_followups set done_at = now(), done_how = 'pct' where inquiry_id = new.id and done_at is null;
  end if;
  return new;
end $$;
drop trigger if exists inquiry_followups_done on public.inquiries;
create trigger inquiry_followups_done after update of win_set_at, status on public.inquiries for each row execute function app.inquiry_followups_done();

-- The project's % reviewed (by hand, approved change, or the wizard applied), or the project closed
create or replace function app.project_followups_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not app.project_open(new) then
    update public.win_followups set done_at = now(), done_how = 'closed' where project_id = new.id and done_at is null;
  elsif new.last_probability_review_at is distinct from old.last_probability_review_at then
    update public.win_followups set done_at = now(), done_how = 'pct' where project_id = new.id and inquiry_id is null and done_at is null;
  end if;
  return new;
end $$;
drop trigger if exists project_followups_done on public.projects;
create trigger project_followups_done after update of last_probability_review_at, status, milestone on public.projects for each row execute function app.project_followups_done();

-- "No change": the sales person keeps the % as it is
create or replace function public.win_followup_no_change(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(exists (select 1 from public.win_followups where id = p_id and sales_person_id = auth.uid()), 'Only your own follow-ups');
  update public.win_followups set done_at = now(), done_how = 'no_change' where id = p_id and done_at is null;
end $$;
grant execute on function public.win_followup_no_change(bigint) to authenticated;

-- My open follow-ups with names, for the tablets
create or replace function public.my_win_followups() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'project_id', f.project_id, 'project', p.name, 'inquiry_id', f.inquiry_id, 'inquiry_code', i.code,
           'inquiry_name', i.inquiry_name, 'pct', coalesce(i.win_probability, p.win_probability), 'use_wizard', p.use_wizard, 'created_at', f.created_at,
           'visit_id', f.visit_id, 'escalated', f.escalated_at is not null) order by f.created_at desc, f.inquiry_id nulls first, i.code), '[]')
  from public.win_followups f join public.projects p on p.id = f.project_id left join public.inquiries i on i.id = f.inquiry_id
  where f.sales_person_id = auth.uid() and f.done_at is null
$$;
grant execute on function public.my_win_followups() to authenticated;

-- Still open after 3 working days: to the sales person's manager (SM Projects when none), once per follow-up
create or replace function public.win_followup_tick() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select f.sales_person_id, sp.full_name, coalesce(sp.manager_id, (app.role_users('sm_projects'))[1]) mgr, array_agg(f.id) ids,
           string_agg(distinct p.name, ', ') names, count(*) cnt
    from public.win_followups f join public.profiles sp on sp.id = f.sales_person_id join public.projects p on p.id = f.project_id
    where f.done_at is null and f.escalated_at is null and app.work_minutes_between(f.created_at, now()) >= 3 * app.working_minutes_per_day()
    group by 1, 2, 3
  loop
    perform app.notify(r.mgr, 'win_followup_late', format('%s has not updated the win probability after visits', r.full_name),
      format('%s item(s) not updated 3 working days after the visit: %s', r.cnt, r.names), 'normal', 'profile', r.sales_person_id,
      '/reports/win-usage', 'win_followup_late:' || r.sales_person_id || ':' || (select max(x) from unnest(r.ids) x));
    update public.win_followups set escalated_at = now() where id = any (r.ids);
    n := n + r.cnt;
  end loop;
  return n;
end $$;
revoke execute on function public.win_followup_tick() from public, anon, authenticated;
grant execute on function public.win_followup_tick() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('win-followup-tick', '7 * * * 1-6', 'select public.win_followup_tick()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Pop-ups
-- ---------------------------------------------------------------------------
create or replace function public.win_nudge_dismiss(p_kind text, p_ref uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into public.win_nudges_seen (user_id, kind, ref, day)
  values (auth.uid(), p_kind, coalesce(p_ref, '00000000-0000-0000-0000-000000000000'), (now() at time zone app.tz())::date)
  on conflict do nothing
$$;
grant execute on function public.win_nudge_dismiss(text, uuid) to authenticated;

-- My use of the wizard: last 30 days against the team, open projects scored, 8 weeks; show = not seen today
create or replace function public.my_win_usage() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); today date := (now() at time zone app.tz())::date; wk date := today - (extract(isodow from today)::int - 1);
begin
  return jsonb_build_object(
    'show', app.is_sales_person() and not exists (select 1 from public.win_nudges_seen where user_id = me and kind = 'usage' and day = today),
    'uses', (select count(*) from public.win_wizard_log where user_id = me and action = 'scored' and at > now() - interval '30 days'),
    'team_avg', (select round(avg(c), 1) from (
                   select (select count(*) from public.win_wizard_log l where l.user_id = s.id and l.action = 'scored' and l.at > now() - interval '30 days') c
                   from public.profiles s where s.active and s.role in ('asm_building', 'asm_infra')) t),
    'open_projects', (select count(*) from public.projects p where p.owner_id = me and app.project_open(p)),
    'scored_projects', (select count(*) from public.projects p where p.owner_id = me and app.project_open(p)
                          and exists (select 1 from public.win_scores s where s.project_id = p.id and s.scored_at > now() - interval '30 days')),
    'last_used', (select max(at) from public.win_wizard_log where user_id = me and action = 'scored'),
    'weeks', (select jsonb_agg((select count(*) from public.win_wizard_log l where l.user_id = me and l.action = 'scored'
                                and (l.at at time zone app.tz())::date >= wk - 7 * w and (l.at at time zone app.tz())::date < wk - 7 * w + 7) order by w desc)
              from generate_series(0, 7) w),
    'to_score', (select coalesce(jsonb_agg(x order by x ->> 'last_scored' nulls first), '[]') from (
                   select jsonb_build_object('id', p.id, 'name', p.name, 'pct', p.win_probability, 'last_scored', (select max(scored_at) from public.win_scores s where s.project_id = p.id)) x
                   from public.projects p where p.owner_id = me and app.project_open(p)) t));
end $$;
grant execute on function public.my_win_usage() to authenticated;

-- Reminder on opening a project (or one of its inquiries): the owner, an open project, not scored in 30 days, not seen today
create or replace function public.wizard_nudge(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.projects; s public.win_scores;
begin
  select * into p from public.projects where id = p_project;
  if p.id is null or p.owner_id <> auth.uid() or not app.project_open(p) then return jsonb_build_object('due', false); end if;
  select * into s from public.win_scores where project_id = p.id order by scored_at desc limit 1;
  return jsonb_build_object(
    'due', (s.id is null or s.scored_at < now() - interval '30 days')
           and not exists (select 1 from public.win_nudges_seen where user_id = auth.uid() and kind = 'project' and ref = p.id and day = (now() at time zone app.tz())::date),
    'project', p.name, 'pct', p.win_probability, 'last_at', s.scored_at, 'last_pct', s.wizard_pct,
    'days', case when s.id is null then null else ((now() at time zone app.tz())::date - (s.scored_at at time zone app.tz())::date) end);
end $$;
grant execute on function public.wizard_nudge(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Report for DGM / GM and SM Projects
-- ---------------------------------------------------------------------------
create or replace function public.win_wizard_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a timestamptz; b timestamptz; wk date;
begin
  perform app.require(app.has_role('gm', 'sm_projects'), 'Win Predictor use is reported to DGM / GM and SM Projects');
  a := p_from::timestamp at time zone app.tz();
  b := (p_to + 1)::timestamp at time zone app.tz();
  wk := p_to - (extract(isodow from p_to)::int - 1);
  return jsonb_build_object(
    'people', (select coalesce(jsonb_agg(x order by x ->> 'name'), '[]') from (
      select jsonb_build_object(
        'id', s.id, 'name', s.full_name, 'role', s.role,
        'scores', (select count(*) from public.win_wizard_log l where l.user_id = s.id and l.action = 'scored' and l.at >= a and l.at < b),
        'opens', (select count(*) from public.win_wizard_log l where l.user_id = s.id and l.action = 'opened' and l.at >= a and l.at < b),
        'applied', (select count(*) from public.win_wizard_log l where l.user_id = s.id and l.action = 'applied' and l.at >= a and l.at < b),
        'projects_scored', (select count(distinct l.project_id) from public.win_wizard_log l where l.user_id = s.id and l.action = 'scored' and l.at >= a and l.at < b),
        'open_projects', (select count(*) from public.projects p where p.owner_id = s.id and app.project_open(p)),
        'open_scored', (select count(*) from public.projects p where p.owner_id = s.id and app.project_open(p)
                          and exists (select 1 from public.win_scores w where w.project_id = p.id and w.scored_at > now() - interval '30 days')),
        'followups', (select count(*) from public.win_followups f where f.sales_person_id = s.id and f.created_at >= a and f.created_at < b),
        'followed', (select count(*) from public.win_followups f where f.sales_person_id = s.id and f.created_at >= a and f.created_at < b and f.done_at is not null and f.done_how <> 'closed'),
        'late', (select count(*) from public.win_followups f where f.sales_person_id = s.id and f.done_at is null and f.escalated_at is not null),
        'last_used', (select max(l.at) from public.win_wizard_log l where l.user_id = s.id and l.action = 'scored'),
        'weeks', (select jsonb_agg((select count(*) from public.win_wizard_log l where l.user_id = s.id and l.action = 'scored'
                                    and (l.at at time zone app.tz())::date >= wk - 7 * w and (l.at at time zone app.tz())::date < wk - 7 * w + 7) order by w desc)
                  from generate_series(0, 11) w)) x
      from public.profiles s
      where s.role in ('asm_building', 'asm_infra') and (s.active or exists (select 1 from public.win_wizard_log l where l.user_id = s.id and l.at >= a and l.at < b))) t),
    'uses', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'user_id', l.user_id, 'at', l.at, 'action', l.action, 'project_id', l.project_id, 'project', p.name,
               'project_code', p.code, 'inquiry_code', i.code, 'inquiry_name', i.inquiry_name, 'wizard_pct', l.wizard_pct, 'before_pct', l.before_pct,
               'after_pct', l.after_pct, 'after_visit', l.after_visit) order by l.at desc), '[]')
             from public.win_wizard_log l join public.projects p on p.id = l.project_id left join public.inquiries i on i.id = l.inquiry_id
             where l.at >= a and l.at < b),
    'late', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'user_id', f.sales_person_id, 'project', p.name, 'inquiry_code', i.code, 'created_at', f.created_at,
               'escalated_at', f.escalated_at) order by f.created_at), '[]')
             from public.win_followups f join public.projects p on p.id = f.project_id left join public.inquiries i on i.id = f.inquiry_id
             where f.done_at is null and f.escalated_at is not null));
end $$;
grant execute on function public.win_wizard_report(date, date) to authenticated;
