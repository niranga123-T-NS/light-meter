-- Win probability is the sales person's own estimate, independent of the internal milestone / stage.
-- It is entered by hand or through the Win Probability Wizard. The milestone no longer sets a default %
-- or limits the % to a band; only the outcome does (won = 100%, lost = 0%). A new project asks for the %.

create or replace function app.projects_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  suggested text;
begin
  if tg_op = 'INSERT' then
    new.code := coalesce(new.code, app.next_code('PRJ'));
    if auth.uid() is not null then
      if app.is_sales_person() then
        if not (new.project_type = any (app.my_project_types())) then
          raise exception 'You can only create projects for your own project types';
        end if;
        new.owner_id := auth.uid();
      elsif app.has_role('sm_projects', 'gm') then
        if new.owner_id is null then raise exception 'Assign a sales person before saving the project'; end if;
        if not exists (select 1 from public.profiles where id = new.owner_id and role in ('asm_building', 'asm_infra') and active) then
          raise exception 'The project owner must be an active sales person';
        end if;
        new.first_visit_due := coalesce(new.first_visit_due, app.add_work_minutes(now(), 5 * app.working_minutes_per_day())::date);
      else
        raise exception 'Only sales people, SM Projects and GM / DGM can create projects';
      end if;
    end if;
    -- Exact duplicate on name + customer is blocked (5.6)
    if exists (select 1 from public.projects p where p.name_norm = app.normalize_name(new.name)
               and p.organization_id = new.organization_id and p.merged_into is null) then
      raise exception 'A project with this name already exists for this customer. Select the existing project instead.';
    end if;
    suggested := app.term_for_duration(new.expected_duration_months);
    if new.project_term is null then new.project_term := suggested;
    elsif new.project_term <> suggested and app.change_reason() is null then
      raise exception 'Project term differs from the suggested term (%): give a reason', suggested;
    end if;
    new.expected_award_date := coalesce(new.expected_award_date,
      (now() at time zone app.tz())::date + make_interval(months => new.expected_duration_months));
    -- The win probability is the sales person's own estimate (entered by hand or with the wizard), not set by the milestone
    if new.milestone = 'won' then new.win_probability := 100; end if;
    if new.milestone = 'lost' then new.win_probability := 0; end if;
    return new;
  end if;

  -- UPDATE
  if new.milestone is distinct from old.milestone then
    -- Only the outcome moves the probability: won = 100%, lost = 0%. Other milestones leave the sales person's % as it is.
    if new.milestone = 'won' then new.status := 'won'; new.win_probability := 100; end if;
    if new.milestone = 'lost' then new.status := 'lost'; new.win_probability := 0; end if;
  end if;
  if new.win_probability is distinct from old.win_probability then
    new.last_probability_review_at := now();
  end if;
  if new.expected_duration_months is distinct from old.expected_duration_months and new.project_term = old.project_term then
    new.project_term := app.term_for_duration(new.expected_duration_months);
  end if;
  if new.owner_id is distinct from old.owner_id and auth.uid() is not null and not app.has_role('sm_projects', 'gm') then
    raise exception 'Only SM Projects or GM / DGM can reassign a project';
  end if;
  if new.name is distinct from old.name and auth.uid() is not null and not app.has_role('sm_projects', 'gm')
     and old.owner_id <> auth.uid() then
    raise exception 'Only the owner, SM Projects or GM / DGM can rename a project';
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.create_project(p jsonb, p_reason text default null, p_duplicate_reason text default null) returns uuid
language plpgsql as $$
declare new_id uuid;
begin
  perform app.require(nullif(p ->> 'win_probability', '') is not null and (p ->> 'win_probability')::int between 0 and 100,
    'Enter the win probability (0–100%) – your own estimate, by hand or with the wizard');
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  insert into public.projects (name, project_type, organization_id, unit_id, location, city, lat, lng, stage, duty_status, currency,
                               project_value, lighting_value, expected_duration_months, project_term, expected_tender_date,
                               expected_award_date, owner_id, first_visit_due, duplicate_override_reason, win_probability, use_wizard)
  values (p ->> 'name', (p ->> 'project_type')::public.project_type, (p ->> 'organization_id')::uuid, nullif(p ->> 'unit_id', '')::uuid,
          p ->> 'location', p ->> 'city', nullif(p ->> 'lat', '')::float8, nullif(p ->> 'lng', '')::float8, coalesce(p ->> 'stage', 'Concept'),
          nullif(p ->> 'duty_status', '')::public.duty_status,
          case when p ->> 'duty_status' = 'duty_free' then 'USD'::public.currency else 'LKR'::public.currency end,
          nullif(p ->> 'project_value', '')::numeric, nullif(p ->> 'lighting_value', '')::numeric,
          (p ->> 'expected_duration_months')::int, nullif(p ->> 'project_term', ''),
          nullif(p ->> 'expected_tender_date', '')::date, nullif(p ->> 'expected_award_date', '')::date,
          coalesce(nullif(p ->> 'owner_id', '')::uuid, auth.uid()), nullif(p ->> 'first_visit_due', '')::date, nullif(btrim(p_duplicate_reason), ''),
          (p ->> 'win_probability')::int, coalesce((p ->> 'use_wizard')::boolean, false))
  returning id into new_id;
  -- Duplicate-name project created with a "different project" reason is logged (8.6 #5)
  if nullif(btrim(p_duplicate_reason), '') is not null then
    perform app.log_project_duplicate(new_id, p ->> 'name', btrim(p_duplicate_reason));
  end if;
  return new_id;
end $$;

-- The wizard sends only the % for approval; the milestone goes with it only when it really changes
create or replace function public.apply_win_score(p_score bigint, p_pct int, p_milestone public.pipeline_milestone, p_reason text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare s public.win_scores; why text; cur public.pipeline_milestone; ch jsonb;
begin
  select * into s from public.win_scores where id = p_score;
  perform app.require(s.id is not null, 'Score not found');
  perform app.require(app.can_score_project(s.project_id), 'Only the project''s sales person, SM Projects or GM / DGM');
  perform app.require(p_pct between 0 and 100, 'Win probability is 0 – 100');
  why := concat_ws(' – ', format('Win Probability Wizard %s%%', s.wizard_pct), nullif(btrim(p_reason), ''));
  select milestone into cur from public.projects where id = s.project_id;
  if app.has_role('sm_projects', 'gm') then
    perform set_config('app.reason', why, true);
    update public.projects set milestone = coalesce(p_milestone, cur), win_probability = p_pct, last_probability_review_at = now() where id = s.project_id;
    update public.win_scores set chosen_pct = p_pct, applied = 'set' where id = s.id;
    return 'set';
  end if;
  ch := jsonb_build_object('win_probability', p_pct);
  if p_milestone is not null and p_milestone is distinct from cur then ch := ch || jsonb_build_object('milestone', p_milestone); end if;
  perform public.request_project_change(s.project_id, ch, why);
  update public.win_scores set chosen_pct = p_pct, applied = 'requested' where id = s.id;
  return 'requested';
end $$;
