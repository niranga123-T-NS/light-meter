-- Re-assigning an estimator without changing the due date does not re-check it against the customer deadline;
-- a changed due date is checked against the current (possibly extended) customer deadline.
create or replace function public.assign_estimation_job(
  p_job uuid, p_assignee uuid, p_due timestamptz, p_value_band text default 'medium', p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  j public.estimation_jobs := app.est_job(p_job);
  i public.inquiries := app.inq(j.inquiry_id);
  r public.app_role;
begin
  perform app.require(app.has_role('sm_estimation', 'gm'), 'Only SM Estimation assigns estimators');
  perform app.require(j.status in ('accepted', 'assigned', 'acknowledged', 'in_progress', 'date_change_requested', 'returned', 'revision_requested'), 'Accept the job first');
  select role into r from public.profiles where id = p_assignee and active;
  perform app.require(r in ('am_estimation', 'estimation_exec'), 'Assign the Assistant Manager – Estimation or the Estimation Executive');
  if p_assignee is distinct from public.default_estimator(i.id) then
    perform app.require(coalesce(trim(p_reason), '') <> '', 'This estimator does not normally handle this project type: give a reason');
  end if;
  if j.assignee_id is not null and j.assignee_id <> p_assignee then
    perform app.require(coalesce(trim(p_reason), '') <> '', 'Hand-over requires a reason');
  end if;
  -- Must leave at least 1 working day before the customer deadline for approval and submission
  if p_due is not distinct from j.due_at and j.status <> 'revision_requested' then
    null;  -- same due date as before: only the estimator changes
  elsif j.status = 'revision_requested' then
    perform app.require(i.customer_deadline is null or p_due <= (i.customer_deadline + app.work_end()) at time zone app.tz(),
      format('The revision must be due by the customer deadline (%s)', i.customer_deadline));
  elsif i.customer_deadline is not null and
     app.work_minutes_between(p_due, (i.customer_deadline + app.work_end()) at time zone app.tz()) < app.working_minutes_per_day() then
    raise exception 'Estimation due date must leave at least 1 working day before the customer deadline (%)', i.customer_deadline;
  end if;

  update public.estimation_jobs set assignee_id = p_assignee, due_at = p_due, original_due_at = coalesce(original_due_at, p_due),
    value_band = p_value_band, assignment_reason = p_reason, assigned_by = auth.uid(), assigned_at = now(),
    status = case when j.assignee_id is null or j.assignee_id <> p_assignee then 'assigned'
                  when j.status = 'revision_requested' then 'returned' else j.status end
  where id = j.id;
  perform app.stop_clocks('estimation_job', j.id, 'assignment');
  perform app.stop_clocks('estimation_job', j.id, 'estimation');
  if j.assignee_id is null or j.assignee_id <> p_assignee then
    perform app.start_clock(i.id, 'estimation_job', j.id, 'ack', p_assignee, null, 'Estimator acknowledgement');
  end if;
  perform app.start_clock(i.id, 'estimation_job', j.id, 'estimation', p_assignee, p_due, 'Estimation');
  perform app.log_status('estimation_job', j.id, i.id, j.status, 'assigned', p_reason);
  if i.status in ('accepted', 'design_approved', 'estimation_review') then perform app.set_inquiry_status(i.id, 'in_estimation'); end if;
  if j.status = 'revision_requested' then
    perform app.notify(p_assignee, 'quotation_returned', 'Revise the quotation: ' || i.code,
      format('Revision requested: %s. Due %s', coalesce(j.review_comment, ''), to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI')),
      'normal', 'estimation_job', j.id, '/estimation/' || j.id);
  else
  perform app.notify(p_assignee, 'work_assigned', 'Estimate assigned: ' || i.code,
    format('%s – %s. Duty %s (%s). Due %s', i.project_name, i.customer_name, i.duty_status, i.currency,
           to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI')),
    'normal', 'estimation_job', j.id, '/estimation/' || j.id);
  end if;
  perform app.refresh_inquiry(i.id);
end $$;
