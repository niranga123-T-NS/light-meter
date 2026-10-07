-- Reassign a design / estimation job with an optional new due date. The new date must be in the future and must not
-- break the final deadlines: a design job stays on or before the approved design completion date (route A) and the
-- customer deadline; an estimate leaves 1 working day before the customer deadline (a revision: by the deadline).
drop function if exists public.reassign_job(text, uuid, uuid, text);
create or replace function public.reassign_job(p_entity_type text, p_job uuid, p_assignee uuid, p_reason text, p_due timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare inq uuid; prev uuid; old_due timestamptz; st text; r public.app_role; i public.inquiries; v_stage text; lbl text; cust timestamptz;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select role into r from public.profiles where id = p_assignee and active;
  if p_entity_type = 'design_job' then
    if not app.has_role('design_manager', 'gm') then raise exception 'Only the Design Manager can reassign design jobs'; end if;
    if r not in ('lighting_designer', 'lighting_engineer') then raise exception 'Choose a Lighting Designer or Lighting Engineer'; end if;
    select inquiry_id, assignee_id, due_at, status into inq, prev, old_due, st from public.design_jobs where id = p_job;
    v_stage := 'design';
  else
    if not app.has_role('sm_estimation', 'gm') then raise exception 'Only SM Estimation can reassign estimates'; end if;
    if r not in ('am_estimation', 'estimation_exec') then raise exception 'Choose an estimator'; end if;
    select inquiry_id, assignee_id, due_at, status into inq, prev, old_due, st from public.estimation_jobs where id = p_job;
    v_stage := 'estimation';
  end if;
  perform app.require(inq is not null, 'Job not found');
  i := app.inq(inq);
  cust := (i.customer_deadline + app.work_end()) at time zone app.tz();

  if p_due is not null and p_due is distinct from old_due then
    perform app.require(p_due > now(), 'The new due date must be in the future');
    if p_entity_type = 'design_job' then
      perform app.require(i.route <> 'A' or i.design_due_at is null or p_due <= i.design_due_at,
        format('The new due date must be on or before the approved design completion date (%s) – set a new completion date for SM Projects to approve first',
               to_char(i.design_due_at at time zone app.tz(), 'DD Mon')));
      perform app.require(i.customer_deadline is null or p_due <= cust,
        format('The new due date must be on or before the customer deadline (%s)', to_char(i.customer_deadline, 'DD Mon')));
    elsif st = 'revision_requested' then
      perform app.require(i.customer_deadline is null or p_due <= cust,
        format('The revision must be due by the customer deadline (%s)', to_char(i.customer_deadline, 'DD Mon')));
    else
      perform app.require(i.customer_deadline is null or app.work_minutes_between(p_due, cust) >= app.working_minutes_per_day(),
        format('The new due date must leave 1 working day before the customer deadline (%s)', to_char(i.customer_deadline, 'DD Mon')));
    end if;
  end if;

  if p_entity_type = 'design_job' then
    update public.design_jobs set assignee_id = p_assignee, due_at = coalesce(p_due, due_at), requested_due_at = null where id = p_job;
  else
    update public.estimation_jobs set assignee_id = p_assignee, assignment_reason = p_reason, due_at = coalesce(p_due, due_at), requested_due_at = null where id = p_job;
  end if;
  update public.sla_clocks set owner_id = p_assignee where entity_type = p_entity_type and entity_id = p_job and stopped_at is null;

  if p_due is not null and p_due is distinct from old_due then
    insert into public.due_date_changes (entity_type, entity_id, inquiry_id, field, old_value, new_value, reason)
    values (p_entity_type, p_job, inq, 'due_at', old_due, p_due, 'Reassigned: ' || p_reason);
    -- restart the working clock with the new due date (only while that stage is running)
    select label into lbl from public.sla_clocks where entity_type = p_entity_type and entity_id = p_job and stage = v_stage and stopped_at is null limit 1;
    if found then perform app.start_clock(inq, p_entity_type, p_job, v_stage, p_assignee, p_due, lbl); end if;
  end if;

  perform app.log_status(p_entity_type, p_job, inq, null, 'reassigned',
    format('%s → %s%s: %s', app.display_name(prev), app.display_name(p_assignee),
           case when p_due is not null and p_due is distinct from old_due then ', due ' || to_char(p_due at time zone app.tz(), 'DD Mon') else '' end, p_reason));
  perform app.notify(p_assignee, 'work_assigned', 'Job reassigned to you',
    i.code || coalesce(' · due ' || to_char(coalesce(p_due, old_due) at time zone app.tz(), 'DD Mon HH24:MI'), '') || ' · ' || p_reason,
    'normal', p_entity_type, p_job, case when p_entity_type = 'design_job' then '/design/' else '/estimation/' end || p_job);
  perform app.notify(prev, 'job_reassigned', 'Job reassigned', i.code || ' · ' || p_reason, 'normal', null, null, null);
  perform app.refresh_inquiry(inq);
end $$;
revoke execute on function public.reassign_job(text, uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.reassign_job(text, uuid, uuid, text, timestamptz) to authenticated;
