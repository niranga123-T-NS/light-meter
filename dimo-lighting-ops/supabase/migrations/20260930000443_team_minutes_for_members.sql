-- Published minutes of the Design, Estimation and Execution team meetings are readable by the team's members (notes,
-- items, actions and invitees follow the meeting) and the members are told when the pack is published.
-- Design: Lighting Designers and Lighting Engineers · Estimation: AM – Estimation and Estimation Executives ·
-- Execution: Assistant Engineers and trainees (not the sub-contractor supervisors).

create or replace function app.team_minutes_roles(p_team text) returns public.app_role[] language sql immutable as $$
  select case p_team when 'design' then array['lighting_designer', 'lighting_engineer']::public.app_role[]
                     when 'estimation' then array['am_estimation', 'estimation_exec']::public.app_role[]
                     when 'execution' then array['assistant_engineer', 'trainee']::public.app_role[]
                     else '{}'::public.app_role[] end
$$;

create or replace function app.reads_team_minutes(p_team text) returns boolean language sql stable security definer set search_path = public as $$
  select app.my_role() = any (app.team_minutes_roles(p_team))
$$;

drop policy if exists sales_meetings_team_minutes_read on public.sales_meetings;
create policy sales_meetings_team_minutes_read on public.sales_meetings for select to authenticated
  using (status = 'published' and app.reads_team_minutes(team));

-- People told of a team's published meeting (read only): DGM, SM Projects (not sales) and the team's members
create or replace function app.meeting_viewers(p_team text) returns uuid[] language sql stable security definer set search_path = public as $$
  select case when p_team = 'sales' then app.role_users('gm')
              else app.role_users('gm', 'sm_projects') || app.role_users(variadic app.team_minutes_roles(p_team)) end
$$;
