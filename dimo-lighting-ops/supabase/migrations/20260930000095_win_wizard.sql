-- Win Probability Wizard (testing stage): a sales person may score a project's win probability with the wizard
-- instead of entering it by hand (a tick per project). The wizard runs in the app; its stakeholder map is kept per
-- project and every score is kept, so the wizard and the manual figures can be compared with the results later.

alter table public.projects add column if not exists use_wizard boolean not null default false;

-- The project's working map (people by pillar, product, competitors, go factors) – reopened pre-filled next time
create table if not exists public.win_maps (
  project_id uuid primary key references public.projects (id) on delete cascade,
  data jsonb not null,
  updated_by uuid default auth.uid() references public.profiles (id),
  updated_at timestamptz not null default now()
);

-- Every wizard score: what the wizard said, what was chosen, and how it was applied
create table if not exists public.win_scores (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  scored_by uuid not null default auth.uid() references public.profiles (id),
  scored_at timestamptz not null default now(),
  wizard_pct int not null check (wizard_pct between 0 and 100),
  manual_pct int check (manual_pct between 0 and 100),           -- the project's probability when scored
  gut_pct int check (gut_pct between 0 and 100),
  confidence numeric(5, 2),
  chosen_pct int check (chosen_pct between 0 and 100),
  applied text not null default 'saved' check (applied in ('saved', 'requested', 'set')),
  flags text[] not null default '{}',
  result jsonb not null default '{}'
);
create index if not exists win_scores_project on public.win_scores (project_id, scored_at desc);

alter table public.win_maps enable row level security;
alter table public.win_scores enable row level security;
drop policy if exists win_maps_read on public.win_maps;
create policy win_maps_read on public.win_maps for select to authenticated using (app.can_read_project(project_id));
drop policy if exists win_scores_read on public.win_scores;
create policy win_scores_read on public.win_scores for select to authenticated using (app.can_read_project(project_id));
grant select on public.win_maps, public.win_scores to authenticated;

create or replace function app.can_score_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects where id = p_project and owner_id = auth.uid()) or app.has_role('sm_projects', 'gm')
$$;

-- The tick: use the wizard for this project (or go back to entering the % by hand)
create or replace function public.set_wizard_use(p_project uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.can_score_project(p_project), 'Only the project''s sales person, SM Projects or GM / DGM');
  update public.projects set use_wizard = coalesce(p_on, false) where id = p_project;
end $$;

-- Save the map and a score (the % is calculated in the app); returns the score id
create or replace function public.save_win_score(p_project uuid, p_data jsonb, p_result jsonb, p_wizard int, p_gut int,
  p_confidence numeric, p_flags text[]) returns bigint
language plpgsql security definer set search_path = public as $$
declare sid bigint; cur int;
begin
  perform app.require(app.can_score_project(p_project), 'Only the project''s sales person, SM Projects or GM / DGM');
  perform app.require(p_wizard between 0 and 100, 'Win probability is 0 – 100');
  select win_probability into cur from public.projects where id = p_project;
  insert into public.win_maps (project_id, data) values (p_project, coalesce(p_data, '{}'))
  on conflict (project_id) do update set data = excluded.data, updated_by = auth.uid(), updated_at = now();
  insert into public.win_scores (project_id, wizard_pct, manual_pct, gut_pct, confidence, flags, result)
  values (p_project, p_wizard, cur, p_gut, p_confidence, coalesce(p_flags, '{}'), coalesce(p_result, '{}'))
  returning id into sid;
  update public.projects set use_wizard = true where id = p_project;
  return sid;
end $$;

-- Use a score as the project's win probability: SM Projects / GM set it; a sales person's goes to SM Projects for approval
create or replace function public.apply_win_score(p_score bigint, p_pct int, p_milestone public.pipeline_milestone, p_reason text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare s public.win_scores; why text;
begin
  select * into s from public.win_scores where id = p_score;
  perform app.require(s.id is not null, 'Score not found');
  perform app.require(app.can_score_project(s.project_id), 'Only the project''s sales person, SM Projects or GM / DGM');
  perform app.require(p_pct between 0 and 100, 'Win probability is 0 – 100');
  why := concat_ws(' – ', format('Win Probability Wizard %s%%', s.wizard_pct), nullif(btrim(p_reason), ''));
  if app.has_role('sm_projects', 'gm') then
    perform set_config('app.reason', why, true);
    update public.projects set milestone = p_milestone, win_probability = p_pct, last_probability_review_at = now() where id = s.project_id;
    update public.win_scores set chosen_pct = p_pct, applied = 'set' where id = s.id;
    return 'set';
  end if;
  perform public.request_project_change(s.project_id, jsonb_build_object('milestone', p_milestone, 'win_probability', p_pct), why);
  update public.win_scores set chosen_pct = p_pct, applied = 'requested' where id = s.id;
  return 'requested';
end $$;

revoke execute on function public.set_wizard_use(uuid, boolean), public.save_win_score(uuid, jsonb, jsonb, int, int, numeric, text[]),
  public.apply_win_score(bigint, int, public.pipeline_milestone, text) from public, anon;
grant execute on function public.set_wizard_use(uuid, boolean), public.save_win_score(uuid, jsonb, jsonb, int, int, numeric, text[]),
  public.apply_win_score(bigint, int, public.pipeline_milestone, text) to authenticated, service_role;
