-- Route A: before assigning designers the Design Manager proposes the design completion date; SM Projects
-- approves it after checking the customer deadline and the working days left for estimation.
-- Design tasks cannot be due after the approved date; a later date needs a new approval.

alter table public.inquiries
  add column if not exists design_due_proposed_at timestamptz,
  add column if not exists design_due_at timestamptz,
  add column if not exists design_due_status text check (design_due_status in ('pending', 'approved', 'returned'));

create or replace function public.propose_design_due(p_inquiry uuid, p_due timestamptz, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  deadline timestamptz;
  wpd numeric := app.working_minutes_per_day();
  est_days numeric;
  std_days numeric := round(app.sla_target('estimation_medium') / app.working_minutes_per_day(), 1);
begin
  perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager sets the design completion date');
  perform app.require(i.route = 'A', 'Only design → estimation inquiries need an approved design completion date');
  perform app.require(i.status in ('accepted', 'in_design', 'design_review'), 'Accept the inquiry first');
  perform app.require(p_due > now(), 'The completion date must be in the future');
  deadline := (i.customer_deadline + app.work_end()) at time zone app.tz();
  perform app.require(p_due < deadline, 'The design must be complete before the customer deadline');
  est_days := round(app.work_minutes_between(p_due, deadline) / wpd, 1);
  update public.inquiries set design_due_proposed_at = p_due, design_due_status = 'pending' where id = i.id;
  return app.create_approval('design_due', 'inquiry', i.id, i.id, 'Design completion date – ' || i.code,
    format('Design complete by %s · leaves %s working days for estimation (standard %s) · customer deadline %s%s%s',
      to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI'), est_days, std_days, to_char(i.customer_deadline, 'DD Mon'),
      case when est_days < std_days then ' · SHORTER THAN STANDARD' else '' end,
      case when coalesce(trim(p_note), '') <> '' then ' · ' || p_note else '' end),
    array['sm_projects']::public.app_role[],
    jsonb_build_object('due', p_due, 'estimation_days', est_days, 'standard_days', std_days));
end $$;

create or replace function app.apply_approval(a public.approvals, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries;
  approved boolean := a.status = 'approved';
begin
  perform set_config('app.workflow', '1', true);
  if a.inquiry_id is not null then select * into i from public.inquiries where id = a.inquiry_id; end if;

  case a.kind
  when 'mixed_duty' then
    if approved then
      update public.inquiries set mixed_duty_approved = true where id = a.inquiry_id;
      perform app.notify(i.sales_person_id, 'mixed_duty_approved', 'Mixed duty approved – you can submit',
        i.code, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'debtor_check' then
    if approved then
      perform public.resume_inquiry(a.inquiry_id);
    else
      perform app.notify(i.sales_person_id, 'debtor_hold', 'Inquiry held for debtor collection',
        coalesce(p_comment, ''), 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'release_mode' then
    if approved then
      update public.inquiries set release_mode = coalesce((a.payload ->> 'release_mode')::int, release_mode),
        release_mode_confirmed = true where id = a.inquiry_id;
    end if;
  when 'duty_change' then
    if approved then
      update public.inquiries set duty_status = (a.payload ->> 'duty_status')::public.duty_status where id = a.inquiry_id;
      perform app.notify_many(array[(select assignee_id from public.estimation_jobs where inquiry_id = i.id order by created_at desc limit 1)]
        || app.role_users('sm_estimation'), 'duty_changed', 'Duty status changed', format('%s is now %s – revise the quotation',
        i.code, a.payload ->> 'duty_status'), 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'expectation_change' then
    if approved then
      update public.inquiries set solution_level = coalesce(a.payload ->> 'solution_level', solution_level),
        manufacturing_origin = coalesce(a.payload ->> 'manufacturing_origin', manufacturing_origin),
        expectation_notes = coalesce(a.payload ->> 'expectation_notes', expectation_notes),
        estimation_scope = coalesce((select array_agg(x) from jsonb_array_elements_text(
                                       case when jsonb_typeof(a.payload -> 'estimation_scope') = 'array' then a.payload -> 'estimation_scope' end) x),
                                    estimation_scope),
        estimation_basis = coalesce(a.payload ->> 'estimation_basis', estimation_basis),
        design_scope = coalesce(a.payload ->> 'design_scope', design_scope)
      where id = a.inquiry_id;
      perform app.notify_many(
        array(select assignee_id from public.design_jobs where inquiry_id = i.id and status not in ('approved', 'released')
              union select assignee_id from public.estimation_jobs where inquiry_id = i.id and status not in ('released')),
        'expectation_changed', 'Client expectation changed – review your job', i.code, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'early_design_release' then
    if approved then
      update public.inquiries set early_design_release_at = now(), design_released_to_sales_at = now() where id = a.inquiry_id;
      perform app.log_status('inquiry', i.id, i.id, i.status, i.status, 'Early design release approved');
      perform app.notify_many(array[i.sales_person_id] || app.role_users('sm_projects'), 'design_released',
        'Design released early for client approval', format('%s – %s', i.code, i.project_name),
        'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'quotation_release' then
    update public.estimation_jobs set status = case when approved then 'approved' else 'returned' end,
      approved_at = case when approved then now() end, review_comment = p_comment
    where id = a.entity_id;
    perform app.notify((select assignee_id from public.estimation_jobs where id = a.entity_id),
      case when approved then 'quotation_approved' else 'quotation_returned' end,
      case when approved then 'GM approved the quotation – release it' else 'Quotation returned by GM / DGM' end,
      format('%s %s', i.code, coalesce(p_comment, '')), 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  when 'estimation_hold' then
    if approved then
      update public.estimation_jobs set status_before_hold = status, status = 'on_hold', hold_reason = a.reason where id = a.entity_id;
      perform app.pause_clocks('estimation_job', a.entity_id, a.reason);
      perform app.refresh_inquiry(a.inquiry_id);
    end if;
  when 'weekly_plan' then
    null; -- handled by approve_visit_plan
  when 'sample_return_date' then
    if approved then
      update public.samples set expected_return_date = (a.payload ->> 'new_date')::date where id = a.entity_id;
    end if;
  when 'account_ownership' then
    if approved then
      if a.entity_type = 'organization' then
        update public.organizations set account_owner_id = (a.payload ->> 'owner_id')::uuid where id = a.entity_id;
      else
        update public.org_units set account_owner_id = (a.payload ->> 'owner_id')::uuid where id = a.entity_id;
      end if;
    end if;
  when 'design_due' then
    if approved then
      update public.inquiries set design_due_at = (a.payload ->> 'due')::timestamptz, design_due_status = 'approved' where id = a.inquiry_id;
    else
      update public.inquiries set design_due_status = 'returned' where id = a.inquiry_id;
    end if;
  else
    null;
  end case;
end $$;

create or replace function public.assign_design_job(
  p_inquiry uuid, p_assignee uuid, p_due timestamptz, p_task_type text default 'lighting', p_job_size text default 'medium',
  p_milestones jsonb default '[]'::jsonb, p_late_reason text default null, p_depends_on uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  jid uuid;
  assignee_role public.app_role;
begin
  perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager assigns design jobs');
  perform app.require(i.status in ('accepted', 'in_design', 'design_review'), 'Accept the inquiry first');
  select role into assignee_role from public.profiles where id = p_assignee and active;
  perform app.require(assignee_role in ('lighting_designer', 'lighting_engineer'), 'Assign a Lighting Designer or Lighting Engineer');
  perform app.require(p_task_type <> 'electrical' or assignee_role = 'lighting_engineer', 'Electrical design is assigned to the Lighting Engineer');
  perform app.require(p_due > now(), 'Due date must be in the future');
  -- Route A: SM Projects first approves the design completion date (time left for estimation)
  if i.route = 'A' then
    perform app.require(i.design_due_status = 'approved',
      'Set the design completion date and get SM Projects'' approval before assigning the designer');
    perform app.require(p_due <= i.design_due_at, format('The due date must be on or before the approved design completion date (%s)',
      to_char(i.design_due_at at time zone app.tz(), 'DD Mon')));
  end if;
  if i.design_required_by is not null and p_due > (i.design_required_by + time '17:30') at time zone app.tz() then
    perform app.require(coalesce(trim(p_late_reason), '') <> '', 'Due date is later than the sales-requested date: give a reason');
    perform app.notify_many(array[i.sales_person_id] || app.role_users('sm_projects'), 'design_due_late',
      'Design due date later than requested', format('%s: due %s. %s', i.code, to_char(p_due at time zone app.tz(), 'DD Mon'), p_late_reason),
      'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  end if;

  insert into public.design_jobs (inquiry_id, revision, task_type, job_size, assignee_id, due_at, original_due_at, milestones,
                                  late_reason, depends_on_job_id, assigned_by)
  values (i.id, i.revision, p_task_type, p_job_size, p_assignee, p_due, p_due, coalesce(p_milestones, '[]'), p_late_reason, p_depends_on, auth.uid())
  returning id into jid;
  perform app.log_status('design_job', jid, i.id, null, 'assigned');
  perform app.stop_clocks('inquiry', i.id, 'assignment');
  perform app.start_clock(i.id, 'design_job', jid, 'ack', p_assignee, null, 'Designer acknowledgement');
  perform app.start_clock(i.id, 'design_job', jid, 'design', p_assignee, p_due, initcap(p_task_type) || ' design');
  if i.status = 'accepted' then perform app.set_inquiry_status(i.id, 'in_design'); end if;
  perform app.notify(p_assignee, 'work_assigned', 'Design job assigned: ' || i.code,
    format('%s – %s (%s). Due %s', i.project_name, i.customer_name, p_task_type, to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI')),
    'normal', 'design_job', jid, '/design/' || jid);
  perform app.refresh_inquiry(i.id);
  return jid;
end $$;

create or replace function public.change_job_due_date(p_entity_type text, p_job uuid, p_new_due timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare old_due timestamptz; inq uuid; owner uuid; sp uuid; code text;
begin
  perform app.require(coalesce(trim(p_reason), '') <> '', 'A reason is required');
  if p_entity_type = 'design_job' then
    perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager can change design due dates');
    perform app.require(not exists (select 1 from public.design_jobs d join public.inquiries q on q.id = d.inquiry_id
                                    where d.id = p_job and q.route = 'A' and q.design_due_at is not null and p_new_due > q.design_due_at),
      'Later than the approved design completion date – set a new completion date for SM Projects to approve first');
    select due_at, inquiry_id, assignee_id into old_due, inq, owner from public.design_jobs where id = p_job;
    update public.design_jobs set due_at = p_new_due, requested_due_at = null,
      status = case when status = 'date_change_requested' then 'in_progress' else status end where id = p_job;
    perform app.start_clock(inq, 'design_job', p_job, 'design', owner, p_new_due, 'Design');
  else
    perform app.require(app.has_role('sm_estimation', 'gm'), 'Only SM Estimation can change estimation due dates');
    select due_at, inquiry_id, assignee_id into old_due, inq, owner from public.estimation_jobs where id = p_job;
    update public.estimation_jobs set due_at = p_new_due, requested_due_at = null,
      status = case when status = 'date_change_requested' then 'in_progress' else status end where id = p_job;
    perform app.start_clock(inq, 'estimation_job', p_job, 'estimation', owner, p_new_due, 'Estimation');
  end if;
  insert into public.due_date_changes (entity_type, entity_id, inquiry_id, field, old_value, new_value, reason)
  values (p_entity_type, p_job, inq, 'due_at', old_due, p_new_due, p_reason);
  select sales_person_id, i.code into sp, code from public.inquiries i where id = inq;
  perform app.notify_many(array[sp, owner] || app.role_users('sm_projects'), 'due_date_changed', 'Due date changed: ' || code,
    format('%s → %s. %s', to_char(old_due at time zone app.tz(), 'DD Mon'), to_char(p_new_due at time zone app.tz(), 'DD Mon'), p_reason),
    'normal', 'inquiry', inq, app.inquiry_url(inq));
  perform app.refresh_inquiry(inq);
end $$;

revoke execute on function public.propose_design_due(uuid, timestamptz, text) from public, anon;
grant execute on function public.propose_design_due(uuid, timestamptz, text) to authenticated, service_role;
