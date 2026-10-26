-- Tender fast track: a tender normally keeps 2 working days between the estimation due date and the closing (check and
-- release). When a tender has to be prepared faster, SM Estimation (or the AM – Estimation) asks for a fast track with a
-- reason; SM Projects approves (the DGM can too). Once approved the 2-day gap is not applied: the estimation may be due
-- up to the closing time, and the final pricing date of the split moves with it.

alter table public.inquiries
  add column if not exists fast_track_status text check (fast_track_status in ('requested', 'approved', 'rejected')),
  add column if not exists fast_track_reason text,
  add column if not exists fast_track_decided_by uuid references public.profiles (id),
  add column if not exists fast_track_decided_at timestamptz;

-- Check & release time before the deadline: 2 working days for a tender (none on a fast track), 1 for a client deadline
create or replace function app.release_days(i public.inquiries) returns int
language sql immutable as $$
  select case when i.deadline_type = 'tender' and i.fast_track_status = 'approved' then 0 when i.deadline_type = 'tender' then 2 else 1 end
$$;

-- The split never puts a date after the deadline itself (a fast track on the closing day: due at the closing time)
create or replace function app.deadline_split(i public.inquiries) returns jsonb
language plpgsql stable as $$
declare
  e timestamptz := app.deadline_end(i);
  d date;
  r int := app.release_days(i);
  p int := app.pricing_days(i);
  est timestamptz; des timestamptz; mx timestamptz;
begin
  if e is null then return null; end if;
  d := (e at time zone app.tz())::date;
  est := least(e, (app.wd_back(d, r) + app.work_end()) at time zone app.tz());
  des := least(e, (app.wd_back(d, r + p) + app.work_end()) at time zone app.tz());
  mx := least(e, (app.wd_back(d, r + 1) + app.work_end()) at time zone app.tz());
  return jsonb_build_object(
    'deadline_type', i.deadline_type, 'deadline', e, 'release_days', r, 'pricing_days', p, 'fast_track', i.fast_track_status = 'approved',
    'design_due', des, 'design_latest', mx, 'estimation_due', est,
    'design_days', round(app.work_minutes_between(greatest(now(), coalesce(i.design_due_approved_at, now())), des) / app.working_minutes_per_day(), 1),
    'tight', des <= now());
end $$;

create or replace function public.request_tender_fast_track(p_inquiry uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); aid uuid;
begin
  perform app.require(app.has_role('sm_estimation', 'am_estimation'), 'Only SM Estimation or the AM – Estimation asks for a fast track');
  perform app.require(i.deadline_type = 'tender', 'A fast track applies to tenders only');
  perform app.require(i.status not in ('draft', 'won', 'lost', 'cancelled', 'rejected', 'quotation_released', 'submitted_to_client'), 'This inquiry is closed');
  perform app.require(i.fast_track_status is distinct from 'approved', 'The fast track is already approved');
  perform app.require(i.fast_track_status is distinct from 'requested', 'A fast track request is already waiting for SM Projects');
  perform app.require(coalesce(trim(p_reason), '') <> '', 'Give the reason for the fast track');
  aid := app.create_approval('tender_fast_track', 'inquiry', i.id, i.id,
    format('Tender fast track – %s (closes %s)', i.code, to_char(app.deadline_end(i) at time zone app.tz(), 'DD Mon HH24:MI')),
    btrim(p_reason), array['sm_projects']::public.app_role[]);
  perform set_config('app.workflow', '1', true);
  update public.inquiries set fast_track_status = 'requested', fast_track_reason = btrim(p_reason), fast_track_decided_by = null, fast_track_decided_at = null
   where id = i.id;
  perform app.log_status('inquiry', i.id, i.id, i.status, i.status, 'Tender fast track requested: ' || btrim(p_reason));
  return aid;
end $$;
revoke execute on function public.request_tender_fast_track(uuid, text) from public, anon;
grant execute on function public.request_tender_fast_track(uuid, text) to authenticated, service_role;

create or replace function app.apply_tender_fast_track(a public.approvals, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(a.inquiry_id); ok boolean := a.status = 'approved'; n public.inquiries;
begin
  perform set_config('app.workflow', '1', true);
  update public.inquiries set fast_track_status = case when ok then 'approved' else 'rejected' end,
    fast_track_decided_by = auth.uid(), fast_track_decided_at = now()
   where id = i.id returning * into n;
  if ok and n.design_due_approved_at is not null then
    update public.inquiries set estimation_due_at = (app.deadline_split(n) ->> 'estimation_due')::timestamptz where id = i.id;
  end if;
  perform app.log_status('inquiry', i.id, i.id, i.status, i.status,
    format('Tender fast track %s%s', case when ok then 'approved' else 'not approved' end, coalesce(': ' || nullif(btrim(p_comment), ''), '')));
  perform app.notify_many(
    array(select distinct x from unnest(app.role_users('sm_estimation') || array[a.requested_by] ||
      array(select assignee_id from public.estimation_jobs where inquiry_id = i.id and revision = i.revision and assignee_id is not null)) x where x is not null),
    'tender_fast_track', format('Tender fast track %s: %s', case when ok then 'approved' else 'not approved' end, i.code),
    case when ok then format('The 2-day check and release gap is not applied – the estimation may be due up to the closing (%s).', to_char(app.deadline_end(i) at time zone app.tz(), 'DD Mon HH24:MI'))
         else format('The estimation must still leave 2 working days before the closing. %s', coalesce(p_comment, '')) end,
    'normal', 'inquiry', i.id, app.inquiry_url(i.id));
end $$;

-- the decision on the fast track request (Approvals) → app.apply_tender_fast_track
do $$
declare def text;
begin
  select pg_get_functiondef('app.apply_approval(public.approvals, text)'::regprocedure) into def;
  if position('tender_fast_track' in def) = 0 then
    if position($k$  when 'mixed_duty' then$k$ in def) = 0 then raise exception 'apply_approval: anchor not found'; end if;
    def := replace(def, $k$  when 'mixed_duty' then$k$, $k$  when 'tender_fast_track' then
    perform app.apply_tender_fast_track(a, p_comment);
  when 'mixed_duty' then$k$);
    execute def;
  end if;
end $$;

-- Assigning the estimator: the due date must leave 2 working days before a tender closes, unless the fast track is approved
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
  -- Must leave at least 1 working day before the customer deadline (2 before a tender closes, none on a fast track)
  if p_due is not distinct from j.due_at and j.status <> 'revision_requested' then
    null;  -- same due date as before: only the estimator changes
  elsif j.status = 'revision_requested' then
    perform app.require(i.customer_deadline is null or p_due <= (i.customer_deadline + app.work_end()) at time zone app.tz(),
      format('The revision must be due by the customer deadline (%s)', i.customer_deadline));
  elsif i.customer_deadline is not null and
     p_due > (app.deadline_split(i) ->> 'estimation_due')::timestamptz then
    if i.deadline_type = 'tender' and i.fast_track_status = 'approved' then
      raise exception 'Fast track: the estimation must be due by the tender closing (%)', to_char(app.deadline_end(i) at time zone app.tz(), 'DD Mon HH24:MI');
    elsif i.deadline_type = 'tender' then
      raise exception 'Estimation due date must leave at least 2 working days before the tender closes (%) – or ask SM Projects for a fast track', to_char(app.deadline_end(i) at time zone app.tz(), 'DD Mon HH24:MI');
    end if;
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
  -- A pre-estimate runs alongside the design: the inquiry stays with Design until the design is released
  if i.status in ('accepted', 'design_approved', 'estimation_review') and j.phase <> 'pre' then perform app.set_inquiry_status(i.id, 'in_estimation'); end if;
  if j.status = 'revision_requested' then
    perform app.notify(p_assignee, 'quotation_returned', 'Revise the quotation: ' || i.code,
      format('Revision requested: %s. Due %s', coalesce(j.review_comment, ''), to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI')),
      'normal', 'estimation_job', j.id, '/estimation/' || j.id);
  else
  perform app.notify(p_assignee, 'work_assigned', 'Estimate assigned: ' || i.code,
    format('%s – %s. Duty %s (%s). Due %s%s', i.project_name, i.customer_name, i.duty_status, i.currency,
           to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI'), case when i.fast_track_status = 'approved' then ' · FAST TRACK tender' else '' end),
    'normal', 'estimation_job', j.id, '/estimation/' || j.id);
  end if;
  perform app.refresh_inquiry(i.id);
end $$;
