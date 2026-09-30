-- Project changes that must carry a logged reason (4.7, 4.9, 4.10, 5.6).
-- These run with the caller's rights (RLS applies) and pass the reason to the project triggers.

create or replace function public.create_project(p jsonb, p_reason text default null, p_duplicate_reason text default null) returns uuid
language plpgsql as $$
declare new_id uuid;
begin
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  insert into public.projects (name, project_type, organization_id, unit_id, location, city, lat, lng, stage, duty_status, currency,
                               project_value, lighting_value, expected_duration_months, project_term, expected_tender_date,
                               expected_award_date, owner_id, first_visit_due, duplicate_override_reason)
  values (p ->> 'name', (p ->> 'project_type')::public.project_type, (p ->> 'organization_id')::uuid, nullif(p ->> 'unit_id', '')::uuid,
          p ->> 'location', p ->> 'city', nullif(p ->> 'lat', '')::float8, nullif(p ->> 'lng', '')::float8, coalesce(p ->> 'stage', 'Concept'),
          nullif(p ->> 'duty_status', '')::public.duty_status,
          case when p ->> 'duty_status' = 'duty_free' then 'USD'::public.currency else 'LKR'::public.currency end,
          nullif(p ->> 'project_value', '')::numeric, nullif(p ->> 'lighting_value', '')::numeric,
          (p ->> 'expected_duration_months')::int, nullif(p ->> 'project_term', ''),
          nullif(p ->> 'expected_tender_date', '')::date, nullif(p ->> 'expected_award_date', '')::date,
          coalesce(nullif(p ->> 'owner_id', '')::uuid, auth.uid()), nullif(p ->> 'first_visit_due', '')::date, p_duplicate_reason)
  returning id into new_id;
  -- Duplicate-name project created with a "different project" reason is logged (8.6 #5)
  if p_duplicate_reason is not null then
    insert into public.project_log (project_id, field, new_value, reason) values (new_id, 'duplicate_override', p ->> 'name', p_duplicate_reason);
  end if;
  return new_id;
end $$;

create or replace function public.set_project_probability(
  p_project uuid, p_milestone public.pipeline_milestone, p_probability int, p_reason text default null
) returns void language plpgsql as $$
begin
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update public.projects set milestone = p_milestone, win_probability = p_probability, last_probability_review_at = now()
  where id = p_project;
  if not found then raise exception 'Project not found or not yours'; end if;
end $$;

create or replace function public.set_project_term(p_project uuid, p_duration int, p_term text, p_reason text) returns void
language plpgsql as $$
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to change the term or duration'; end if;
  perform set_config('app.reason', p_reason, true);
  update public.projects set expected_duration_months = p_duration, project_term = p_term where id = p_project;
  if not found then raise exception 'Project not found or not yours'; end if;
end $$;

-- Dormant / on-hold review (4.10): active with next action, on hold with review date, or lost / cancelled with reason
create or replace function public.review_project(
  p_project uuid, p_action text, p_reason text default null, p_review_date date default null
) returns void language plpgsql as $$
begin
  if p_action not in ('active', 'on_hold', 'lost', 'cancelled', 'completed') then raise exception 'Invalid action'; end if;
  if p_action in ('on_hold', 'lost', 'cancelled') and coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  if p_action = 'on_hold' and p_review_date is null then raise exception 'Set the review date'; end if;
  perform set_config('app.reason', coalesce(p_reason, 'Reviewed'), true);
  update public.projects set
    status = p_action,
    milestone = case when p_action = 'lost' then 'lost'::public.pipeline_milestone else milestone end,
    status_reason = p_reason,
    on_hold_review_date = case when p_action = 'on_hold' then p_review_date end,
    dormant_since = null,
    last_activity_at = now()
  where id = p_project;
  if not found then raise exception 'Project not found or not yours'; end if;
end $$;

-- Merge duplicates (5.6): visits, inquiries, tenders, samples and debts move to the surviving project
create or replace function public.merge_projects(p_keep uuid, p_merge uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.has_role('sm_projects', 'gm') then raise exception 'Only SM Projects or GM / DGM can merge projects'; end if;
  if p_keep = p_merge then raise exception 'Choose two different projects'; end if;
  perform set_config('app.reason', 'Merged: ' || coalesce(p_reason, ''), true);
  perform set_config('app.workflow', '1', true);
  update public.visits set project_id = p_keep where project_id = p_merge;
  update public.inquiries set project_id = p_keep where project_id = p_merge;
  update public.tenders set project_id = p_keep where project_id = p_merge;
  update public.samples set project_id = p_keep where project_id = p_merge;
  update public.debts set project_id = p_keep where project_id = p_merge;
  update public.visit_plan_lines set project_id = p_keep where project_id = p_merge;
  insert into public.project_stakeholders (project_id, organization_id, unit_id, contact_id, category)
    select p_keep, organization_id, unit_id, contact_id, category from public.project_stakeholders where project_id = p_merge
    on conflict do nothing;
  update public.projects set merged_into = p_keep, status = 'cancelled', status_reason = 'Merged into another project' where id = p_merge;
  insert into public.project_log (project_id, field, old_value, new_value, reason) values (p_keep, 'merge', p_merge::text, p_keep::text, p_reason);
end $$;

-- Every file on an inquiry that the caller may see (request docs, design pack, quotation files, clarifications).
-- Sales cannot read design / estimation jobs, so this resolves the related records server-side and applies
-- the same per-file rule as the attachments policy (costing sheets never reach sales).
create or replace function public.inquiry_files(p_inquiry uuid)
returns setof public.attachments
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.can_read_inquiry(p_inquiry) then return; end if;
  return query
  select a.* from public.attachments a
  where a.archived_at is null
    and ((a.entity_type = 'inquiry' and a.entity_id = p_inquiry)
      or (a.entity_type = 'design_job' and a.entity_id in (select id from public.design_jobs where inquiry_id = p_inquiry))
      or (a.entity_type = 'estimation_job' and a.entity_id in (select id from public.estimation_jobs where inquiry_id = p_inquiry))
      or (a.entity_type = 'clarification' and a.entity_id in (select id from public.clarifications where inquiry_id = p_inquiry)))
    and app.can_read_attachment(a)
  order by a.uploaded_at desc;
end $$;

-- Reassignment between designers (Design Manager) or estimators (SM Estimation), with a reason; the clock continues (6.3, 7.3)
create or replace function public.reassign_job(p_entity_type text, p_job uuid, p_assignee uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare inq uuid; prev uuid; r public.app_role;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select role into r from public.profiles where id = p_assignee and active;
  if p_entity_type = 'design_job' then
    if not app.has_role('design_manager', 'gm') then raise exception 'Only the Design Manager can reassign design jobs'; end if;
    if r not in ('lighting_designer', 'lighting_engineer') then raise exception 'Choose a Lighting Designer or Lighting Engineer'; end if;
    select inquiry_id, assignee_id into inq, prev from public.design_jobs where id = p_job;
    update public.design_jobs set assignee_id = p_assignee where id = p_job;
  else
    if not app.has_role('sm_estimation', 'gm') then raise exception 'Only SM Estimation can reassign estimates'; end if;
    if r not in ('am_estimation', 'estimation_exec') then raise exception 'Choose an estimator'; end if;
    select inquiry_id, assignee_id into inq, prev from public.estimation_jobs where id = p_job;
    update public.estimation_jobs set assignee_id = p_assignee, assignment_reason = p_reason where id = p_job;
  end if;
  update public.sla_clocks set owner_id = p_assignee where entity_type = p_entity_type and entity_id = p_job and stopped_at is null;
  perform app.log_status(p_entity_type, p_job, inq, null, 'reassigned', format('%s → %s: %s', app.display_name(prev), app.display_name(p_assignee), p_reason));
  perform app.notify(p_assignee, 'work_assigned', 'Job reassigned to you', (select code from public.inquiries where id = inq) || ' · ' || p_reason,
    'normal', p_entity_type, p_job, case when p_entity_type = 'design_job' then '/design/' else '/estimation/' end || p_job);
  perform app.notify(prev, 'job_reassigned', 'Job reassigned', (select code from public.inquiries where id = inq) || ' · ' || p_reason, 'normal', null, null, null);
  perform app.refresh_inquiry(inq);
end $$;

-- Only signed-in users may call functions; the scheduler functions are for the database itself.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.sla_tick() from authenticated;
revoke execute on function public.reminders_tick() from authenticated;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
