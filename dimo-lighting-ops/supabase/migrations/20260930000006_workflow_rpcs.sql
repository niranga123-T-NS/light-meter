-- Inquiry → Design → Estimation workflow (SRS Sections 3, 5, 6, 7).
-- Every transition goes through one of these functions so rules, clocks, history and notifications stay consistent.

create or replace function app.inq(p_id uuid) returns public.inquiries
language plpgsql security definer set search_path = public as $$
declare r public.inquiries;
begin
  select * into r from public.inquiries where id = p_id for update;
  if not found then raise exception 'Inquiry not found'; end if;
  return r;
end $$;

create or replace function app.set_inquiry_status(p_id uuid, p_to text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare prev text;
begin
  select status into prev from public.inquiries where id = p_id;
  if prev is distinct from p_to then
    perform set_config('app.workflow', '1', true);
    update public.inquiries set status = p_to where id = p_id;
    perform app.log_status('inquiry', p_id, p_id, prev, p_to, p_reason);
  end if;
end $$;

create or replace function app.require(cond boolean, msg text) returns void
language plpgsql as $$ begin if not coalesce(cond, false) then raise exception '%', msg; end if; end $$;

create or replace function app.inquiry_url(p_id uuid) returns text language sql immutable as $$ select '/inquiries/' || p_id $$;

create or replace function app.has_attachment(p_entity_type text, p_entity_id uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.attachments where entity_type = p_entity_type and entity_id = p_entity_id
                 and kind = p_kind and archived_at is null)
$$;

-- ---------------------------------------------------------------------------
-- Approvals engine (8.6)
-- ---------------------------------------------------------------------------
create or replace function app.create_approval(
  p_kind public.approval_kind, p_entity_type text, p_entity_id uuid, p_inquiry uuid, p_title text, p_reason text,
  p_steps public.app_role[], p_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid; n int := 0; r public.app_role;
begin
  -- one open approval of a kind per entity
  update public.approvals set status = 'cancelled', decided_at = now()
   where kind = p_kind and entity_type = p_entity_type and entity_id = p_entity_id and status = 'pending';
  insert into public.approvals (kind, entity_type, entity_id, inquiry_id, title, reason, payload)
  values (p_kind, p_entity_type, p_entity_id, p_inquiry, p_title, p_reason, p_payload) returning id into aid;
  foreach r in array p_steps loop
    n := n + 1;
    insert into public.approval_steps (approval_id, step_no, approver_role) values (aid, n, r);
  end loop;
  perform app.notify_many(app.role_users(p_steps[1]), 'approval_requested', 'Approval needed: ' || p_title,
    coalesce(p_reason, ''), 'normal', 'approval', aid, '/approvals', 'approval:' || aid || ':1', true);
  perform app.start_clock(p_inquiry, 'approval', aid, 'approval_' || p_kind, null,
    app.add_work_minutes(now(), case when p_kind = 'estimation_hold' then 240 else app.working_minutes_per_day() end),
    'Approval: ' || p_title);
  return aid;
end $$;

create or replace function public.decide_approval(p_approval uuid, p_decision text, p_comment text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  a public.approvals;
  s public.approval_steps;
  next_role public.app_role;
  total int;
begin
  select * into a from public.approvals where id = p_approval for update;
  perform app.require(a.status = 'pending', 'This approval is no longer pending');
  perform app.require(p_decision in ('approved', 'rejected', 'returned'), 'Invalid decision');
  perform app.require(p_decision = 'approved' or coalesce(trim(p_comment), '') <> '', 'A reason is required to reject or return');
  select * into s from public.approval_steps where approval_id = a.id and step_no = a.current_step;
  perform app.require(app.my_role() = s.approver_role or app.my_role() = 'gm', 'You are not the approver for this step');

  update public.approval_steps set decision = p_decision, comment = p_comment, decided_by = auth.uid(), decided_at = now()
   where approval_id = a.id and step_no = a.current_step;
  select count(*) into total from public.approval_steps where approval_id = a.id;

  if p_decision = 'approved' and a.current_step < total then
    update public.approvals set current_step = current_step + 1 where id = a.id;
    select approver_role into next_role from public.approval_steps where approval_id = a.id and step_no = a.current_step + 1;
    perform app.notify_many(app.role_users(next_role), 'approval_requested', 'Approval needed: ' || a.title,
      coalesce(a.reason, ''), 'normal', 'approval', a.id, '/approvals', 'approval:' || a.id || ':' || (a.current_step + 1), true);
    perform app.notify(a.requested_by, 'approval_progress', 'Approval step passed: ' || a.title,
      format('Approved by %s, now with %s', app.display_name(auth.uid()), next_role), 'normal', 'approval', a.id, '/approvals');
    perform app.stop_clocks('approval', a.id);
    perform app.start_clock(a.inquiry_id, 'approval', a.id, 'approval_' || a.kind, null, null, 'Approval: ' || a.title);
    return 'next_step';
  end if;

  update public.approvals set status = p_decision, decided_at = now() where id = a.id;
  perform app.stop_clocks('approval', a.id);
  perform app.notify(a.requested_by, 'approval_decided', format('%s: %s', initcap(p_decision), a.title),
    coalesce(p_comment, ''), 'normal', 'approval', a.id, coalesce(case when a.inquiry_id is not null then app.inquiry_url(a.inquiry_id) end, '/approvals'));
  select * into a from public.approvals where id = a.id;
  perform app.apply_approval(a, p_comment);
  return p_decision;
end $$;

-- Effects of a final decision
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
        expectation_notes = coalesce(a.payload ->> 'expectation_notes', expectation_notes) where id = a.inquiry_id;
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
  else
    null;
  end case;
end $$;



-- ---------------------------------------------------------------------------
-- Sales: submit / resubmit an inquiry (5.1, 5.2, 5.5, 5.9)
-- ---------------------------------------------------------------------------
create or replace function public.submit_inquiry(p_inquiry uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  other_duty public.duty_status;
  receiver public.app_role;
  bad_debt record;
  has_units boolean;
  std_minutes numeric;
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the requesting sales person can submit');
  perform app.require(i.status in ('draft', 'returned_for_info'), 'Inquiry is already submitted');
  perform app.require(i.customer_deadline is not null, 'Customer deadline is required');
  perform app.require(coalesce(length(trim(i.scope_description)), 0) > 0 or app.has_attachment('inquiry', i.id, 'inquiry_doc'),
    'Attach at least one document or write the scope');
  perform app.require(i.route = 'C' or i.duty_status is not null, 'Duty status (Duty Free / Duty Paid) is required when estimation is in scope');
  perform app.require(i.route = 'B' or i.design_scope is not null, 'Select the design scope');
  perform app.require(i.design_required_by is null or i.design_required_by < i.customer_deadline, 'Design required-by date must be before the customer deadline');
  perform app.require(i.quotation_required_by is null or i.quotation_required_by < i.customer_deadline, 'Quotation required-by date must be before the customer deadline');
  select exists (select 1 from public.org_units where organization_id = i.organization_id) into has_units;
  perform app.require(not has_units or i.unit_id is not null, 'Select the unit / department for this customer');

  -- Mixed Duty Free / Duty Paid on one project needs SM Projects → GM approval (5.5)
  if i.duty_status is not null and not i.mixed_duty_approved then
    select duty_status into other_duty from public.inquiries
     where project_id = i.project_id and id <> i.id and duty_status is not null and duty_status <> i.duty_status
       and status not in ('draft', 'cancelled', 'rejected') limit 1;
    if other_duty is not null then
      if not exists (select 1 from public.approvals where kind = 'mixed_duty' and entity_id = i.id and status = 'pending') then
        perform app.create_approval('mixed_duty', 'inquiry', i.id, i.id, format('Mixed duty offer – %s', i.project_name),
          format('%s requested while the project already has a %s offer', i.duty_status, other_duty),
          array['sm_projects', 'gm']::public.app_role[]);
      end if;
      return jsonb_build_object('status', 'approval_required', 'message',
        'This project already has an offer with a different duty status. A mixed duty approval request was sent to SM Projects and GM / DGM.');
    end if;
  end if;

  perform set_config('app.workflow', '1', true);
  update public.inquiries set submitted_at = coalesce(submitted_at, now()) where id = i.id;
  perform app.set_inquiry_status(i.id, 'submitted', case when i.status = 'returned_for_info' then 'Resubmitted' end);
  update public.projects set last_activity_at = now() where id = i.project_id;

  -- Release mode: proposed by sales, confirmed by SM Projects (6.5)
  perform app.create_approval('release_mode', 'inquiry', i.id, i.id, format('Release mode – %s', i.code),
    format('Proposed mode %s (%s)', i.release_mode,
      case i.release_mode when 1 then 'design only' when 2 then 'estimation only' else 'design + estimation' end),
    array['sm_projects']::public.app_role[], jsonb_build_object('release_mode', i.release_mode));

  -- Debtor check (5.9): debts over 90 days or under Legal
  select count(*) as n, sum(amount) filter (where currency = 'LKR') as lkr, sum(amount) filter (where currency = 'USD') as usd
    into bad_debt from public.debts d
   where d.organization_id = i.organization_id and (i.unit_id is null or d.unit_id is null or d.unit_id = i.unit_id)
     and d.status not in ('collected_confirmed', 'cleared') and (d.outstanding_days > 90 or d.is_legal);
  if bad_debt.n > 0 then
    update public.inquiries set debtor_flag = true, status_before_hold = 'submitted', hold_reason = 'Debtor check' where id = i.id;
    perform app.set_inquiry_status(i.id, 'on_hold', 'Debtor check');
    perform app.create_approval('debtor_check', 'inquiry', i.id, i.id, format('Debtor check – %s', i.customer_name),
      format('%s debts over 90 days or under Legal: LKR %s, USD %s', bad_debt.n, coalesce(bad_debt.lkr, 0), coalesce(bad_debt.usd, 0)),
      array['sm_projects']::public.app_role[]);
    return jsonb_build_object('status', 'debtor_hold', 'message',
      format('This client has %s overdue or legal debts. SM Projects has been asked to allow the inquiry.', bad_debt.n));
  end if;

  perform app.route_inquiry(i.id);

  -- Warn when design + estimation time left is less than the standard SLA (5.2)
  std_minutes := case i.route when 'A' then app.sla_target('design_medium') + app.sla_target('estimation_medium')
                              when 'B' then app.sla_target('estimation_medium') else app.sla_target('design_medium') end;
  if app.add_work_minutes(now(), std_minutes) > (i.customer_deadline + time '17:30') at time zone app.tz() then
    return jsonb_build_object('status', 'submitted', 'warning', 'Time to the customer deadline is shorter than the standard SLA.');
  end if;
  return jsonb_build_object('status', 'submitted');
end $$;

-- Send a submitted inquiry to the receiving manager's queue
create or replace function app.route_inquiry(p_inquiry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  mgr public.app_role := case when i.route = 'B' then 'sm_estimation' else 'design_manager' end;
  mgr_id uuid := (app.role_users(mgr))[1];
begin
  perform app.start_clock(i.id, 'inquiry', i.id, 'acceptance', mgr_id);
  perform app.notify_many(app.role_users(mgr), 'inquiry_submitted', 'New inquiry: ' || i.code,
    format('%s – %s. Customer deadline %s. Route %s.', i.project_name, i.customer_name, to_char(i.customer_deadline, 'DD Mon'), i.route),
    'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  perform app.refresh_inquiry(i.id);
end $$;

create or replace function public.resume_inquiry(p_inquiry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry);
begin
  perform app.require(i.status = 'on_hold', 'Inquiry is not on hold');
  perform app.require(app.has_role('sm_projects', 'gm', 'design_manager', 'sm_estimation') or i.sales_person_id = auth.uid(), 'Not allowed');
  perform app.set_inquiry_status(i.id, coalesce(i.status_before_hold, 'submitted'), 'Resumed');
  perform set_config('app.workflow', '1', true);
  update public.inquiries set hold_reason = null, status_before_hold = null where id = i.id;
  if i.hold_reason = 'Debtor check' then
    perform app.route_inquiry(i.id);
  else
    perform app.resume_clocks('inquiry', i.id);
    perform app.resume_clocks('design_job', d.id) from public.design_jobs d where d.inquiry_id = i.id;
    perform app.resume_clocks('estimation_job', e.id) from public.estimation_jobs e where e.inquiry_id = i.id;
    perform app.refresh_inquiry(i.id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Receiving manager: accept / return / reject (5.2, 6.1, 7.1)
-- ---------------------------------------------------------------------------
create or replace function public.accept_inquiry(p_inquiry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); ej uuid;
begin
  perform app.require(i.status = 'submitted', 'Only submitted inquiries can be accepted');
  if i.route = 'B' then
    perform app.require(app.has_role('sm_estimation', 'gm'), 'Only SM Estimation accepts estimation-only inquiries');
  else
    perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager accepts design inquiries');
  end if;
  perform app.stop_clocks('inquiry', i.id, 'acceptance');
  perform app.set_inquiry_status(i.id, 'accepted');
  if i.route = 'B' then
    insert into public.estimation_jobs (inquiry_id, revision, source, status) values (i.id, i.revision, 'direct', 'accepted') returning id into ej;
    perform app.start_clock(i.id, 'estimation_job', ej, 'assignment', auth.uid());
  else
    perform app.start_clock(i.id, 'inquiry', i.id, 'assignment', auth.uid());
  end if;
  perform app.notify(i.sales_person_id, 'inquiry_accepted', 'Inquiry accepted: ' || i.code, i.project_name, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  perform app.refresh_inquiry(i.id);
end $$;

create or replace function public.return_inquiry(p_inquiry uuid, p_reason text, p_reject boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry);
begin
  perform app.require(coalesce(trim(p_reason), '') <> '', 'A reason is required');
  perform app.require(i.status in ('submitted', 'accepted') or
    (i.route = 'B' and i.status = 'in_estimation'), 'This inquiry can no longer be returned');
  perform app.require(app.has_role('design_manager', 'sm_estimation', 'gm'), 'Only the receiving manager can return an inquiry');
  -- Returning pauses the clock (clock restarts on resubmission)
  perform app.stop_clocks('inquiry', i.id);
  perform app.stop_clocks('estimation_job', e.id) from public.estimation_jobs e where e.inquiry_id = i.id;
  perform app.set_inquiry_status(i.id, case when p_reject then 'rejected' else 'returned_for_info' end, p_reason);
  perform app.notify_many(array[i.sales_person_id] || app.role_users('sm_projects'),
    case when p_reject then 'inquiry_rejected' else 'inquiry_returned' end,
    case when p_reject then 'Inquiry rejected: ' else 'Inquiry returned for information: ' end || i.code,
    p_reason, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  perform app.refresh_inquiry(i.id);
end $$;

-- Route B missing BOQ / spec → send to Design (converts to Route A) (7.1)
create or replace function public.convert_to_design(p_inquiry uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry);
begin
  perform app.require(app.has_role('sm_estimation', 'gm'), 'Only SM Estimation can send an inquiry to Design');
  perform app.require(i.route = 'B' and i.status in ('submitted', 'accepted'), 'Only open Route B inquiries can be converted');
  perform app.stop_clocks('inquiry', i.id);
  update public.estimation_jobs set status = 'queued' where inquiry_id = i.id;
  perform app.stop_clocks('estimation_job', e.id) from public.estimation_jobs e where e.inquiry_id = i.id;
  perform set_config('app.workflow', '1', true);
  update public.inquiries set route = 'A', release_mode = 3, design_scope = coalesce(design_scope, 'lighting') where id = i.id;
  perform app.set_inquiry_status(i.id, 'submitted', 'Converted to Route A: ' || p_reason);
  delete from public.estimation_jobs where inquiry_id = i.id and status = 'queued' and assignee_id is null;
  perform app.route_inquiry(i.id);
  perform app.notify(i.sales_person_id, 'inquiry_converted', 'Inquiry sent to Design first', format('%s: %s', i.code, p_reason),
    'normal', 'inquiry', i.id, app.inquiry_url(i.id));
end $$;

-- ---------------------------------------------------------------------------
-- Design (6.1 – 6.5)
-- ---------------------------------------------------------------------------
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

create or replace function app.design_job(p_id uuid) returns public.design_jobs
language plpgsql security definer set search_path = public as $$
declare r public.design_jobs;
begin
  select * into r from public.design_jobs where id = p_id for update;
  if not found then raise exception 'Design job not found'; end if;
  return r;
end $$;

-- Designer confirms the due date or requests a change within 4 working hours
create or replace function public.acknowledge_design_job(p_job uuid, p_requested_due timestamptz default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare j public.design_jobs := app.design_job(p_job);
begin
  perform app.require(j.assignee_id = auth.uid(), 'Only the assignee can acknowledge');
  perform app.stop_clocks('design_job', j.id, 'ack');
  if p_requested_due is not null then
    update public.design_jobs set status = 'date_change_requested', requested_due_at = p_requested_due where id = j.id;
    perform app.notify_many(app.role_users('design_manager'), 'due_change_requested', 'Due date change requested',
      format('%s asks for %s. %s', app.display_name(auth.uid()), to_char(p_requested_due at time zone app.tz(), 'DD Mon'), coalesce(p_note, '')),
      'normal', 'design_job', j.id, '/design/' || j.id, null, true);
  else
    update public.design_jobs set status = 'in_progress' where id = j.id;
  end if;
  perform app.log_status('design_job', j.id, j.inquiry_id, j.status, case when p_requested_due is null then 'in_progress' else 'date_change_requested' end, p_note);
end $$;

-- Manager changes a design or estimation due date (versioned, 6.3)
create or replace function public.change_job_due_date(p_entity_type text, p_job uuid, p_new_due timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare old_due timestamptz; inq uuid; owner uuid; sp uuid; code text;
begin
  perform app.require(coalesce(trim(p_reason), '') <> '', 'A reason is required');
  if p_entity_type = 'design_job' then
    perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager can change design due dates');
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

create or replace function public.update_design_progress(p_job uuid, p_progress int, p_hours numeric default null, p_note text default null,
                                                        p_milestones jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare j public.design_jobs := app.design_job(p_job);
begin
  perform app.require(j.assignee_id = auth.uid() or app.has_role('design_manager'), 'Only the assignee can update progress');
  perform app.require(j.status in ('acknowledged', 'in_progress', 'returned', 'assigned', 'date_change_requested'), 'Job is not in progress');
  if j.status = 'assigned' then perform app.stop_clocks('design_job', j.id, 'ack'); end if;
  if p_hours is not null and p_hours > 0 then
    insert into public.design_hours (design_job_id, hours, note) values (j.id, p_hours, p_note);
  end if;
  update public.design_jobs set progress_pct = greatest(0, least(100, p_progress)),
    hours_logged = hours_logged + coalesce(p_hours, 0),
    milestones = coalesce(p_milestones, milestones),
    status = case when status in ('assigned', 'returned') then 'in_progress' else status end
  where id = j.id;
  perform app.refresh_inquiry(j.inquiry_id);
end $$;

create or replace function public.hold_job(p_entity_type text, p_job uuid, p_reason text, p_waiting_on text default null)
returns void language plpgsql security definer set search_path = public as $$
declare inq uuid; sp uuid; code text;
begin
  perform app.require(coalesce(trim(p_reason), '') <> '', 'Hold reason is required');
  if p_entity_type = 'design_job' then
    perform app.require(app.has_role('design_manager', 'gm') or exists (select 1 from public.design_jobs where id = p_job and assignee_id = auth.uid()),
      'Not allowed');
    perform app.require(coalesce(trim(p_waiting_on), '') <> '', 'Say who you are waiting on');
    update public.design_jobs set status_before_hold = status, status = 'on_hold', hold_reason = p_reason, hold_waiting_on = p_waiting_on
      where id = p_job returning inquiry_id into inq;
    perform app.pause_clocks('design_job', p_job, p_reason);
  else
    -- Estimation holds need SM Estimation approval (7.3)
    select inquiry_id into inq from public.estimation_jobs where id = p_job;
    if app.has_role('sm_estimation', 'gm') then
      update public.estimation_jobs set status_before_hold = status, status = 'on_hold', hold_reason = p_reason where id = p_job;
      perform app.pause_clocks('estimation_job', p_job, p_reason);
    else
      perform app.require(exists (select 1 from public.estimation_jobs where id = p_job and assignee_id = auth.uid()), 'Not allowed');
      perform app.create_approval('estimation_hold', 'estimation_job', p_job, inq, 'Estimation hold – ' ||
        (select code from public.inquiries where id = inq), p_reason, array['sm_estimation']::public.app_role[]);
      return;
    end if;
  end if;
  perform app.log_status(p_entity_type, p_job, inq, null, 'on_hold', p_reason);
  select sales_person_id, i.code into sp, code from public.inquiries i where id = inq;
  perform app.notify_many(array[sp] || app.role_users('sm_projects'), 'job_on_hold', 'On hold: ' || code, p_reason,
    'normal', 'inquiry', inq, app.inquiry_url(inq));
  perform app.refresh_inquiry(inq);
end $$;

create or replace function public.resume_job(p_entity_type text, p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inq uuid;
begin
  if p_entity_type = 'design_job' then
    update public.design_jobs set status = coalesce(status_before_hold, 'in_progress'), hold_reason = null, hold_waiting_on = null
      where id = p_job and status = 'on_hold' returning inquiry_id into inq;
  else
    perform app.require(app.has_role('sm_estimation', 'gm') or exists (select 1 from public.estimation_jobs where id = p_job and assignee_id = auth.uid()), 'Not allowed');
    update public.estimation_jobs set status = coalesce(status_before_hold, 'in_progress'), hold_reason = null
      where id = p_job and status = 'on_hold' returning inquiry_id into inq;
  end if;
  perform app.require(inq is not null, 'Job is not on hold');
  perform app.resume_clocks(p_entity_type, p_job);
  perform app.log_status(p_entity_type, p_job, inq, 'on_hold', 'in_progress');
  perform app.refresh_inquiry(inq);
end $$;

create or replace function public.submit_design_for_review(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j public.design_jobs := app.design_job(p_job); code text;
begin
  perform app.require(j.assignee_id = auth.uid(), 'Only the assignee can submit');
  perform app.require(j.status in ('in_progress', 'acknowledged', 'returned', 'assigned'), 'Job is not in progress');
  perform app.require(app.has_attachment('design_job', j.id, 'design_draft') or app.has_attachment('design_job', j.id, 'design_pack'),
    'Upload the design files before submitting');
  update public.design_jobs set status = 'in_review', submitted_at = now(), progress_pct = 100 where id = j.id;
  perform app.stop_clocks('design_job', j.id);
  perform app.start_clock(j.inquiry_id, 'design_job', j.id, 'design_review', (app.role_users('design_manager'))[1], null, 'Design review');
  perform app.log_status('design_job', j.id, j.inquiry_id, j.status, 'in_review');
  if not exists (select 1 from public.design_jobs where inquiry_id = j.inquiry_id and revision = j.revision
                 and id <> j.id and status not in ('in_review', 'approved', 'released')) then
    perform app.set_inquiry_status(j.inquiry_id, 'design_review');
  end if;
  select i.code into code from public.inquiries i where id = j.inquiry_id;
  perform app.notify_many(app.role_users('design_manager'), 'design_submitted', 'Design ready for review: ' || code,
    app.display_name(auth.uid()), 'normal', 'design_job', j.id, '/design/' || j.id, null, true);
  perform app.refresh_inquiry(j.inquiry_id);
end $$;

create or replace function public.review_design(p_job uuid, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.design_jobs := app.design_job(p_job); code text;
begin
  perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager reviews designs');
  perform app.require(j.status = 'in_review', 'Job is not in review');
  perform app.stop_clocks('design_job', j.id, 'design_review');
  select i.code into code from public.inquiries i where id = j.inquiry_id;
  if p_approve then
    update public.design_jobs set status = 'approved', approved_at = now(), review_comment = p_comment where id = j.id;
    perform app.log_status('design_job', j.id, j.inquiry_id, 'in_review', 'approved', p_comment);
    if not exists (select 1 from public.design_jobs where inquiry_id = j.inquiry_id and revision = j.revision and status not in ('approved', 'released')) then
      perform app.set_inquiry_status(j.inquiry_id, 'design_approved');
    end if;
    perform app.notify(j.assignee_id, 'design_approved', 'Design approved: ' || code, coalesce(p_comment, ''), 'normal', 'design_job', j.id, '/design/' || j.id);
  else
    perform app.require(coalesce(trim(p_comment), '') <> '', 'Give review comments when returning');
    update public.design_jobs set status = 'returned', review_cycles = review_cycles + 1, review_comment = p_comment where id = j.id;
    perform app.log_status('design_job', j.id, j.inquiry_id, 'in_review', 'returned', p_comment);
    perform app.start_clock(j.inquiry_id, 'design_job', j.id, 'design', j.assignee_id, greatest(j.due_at, now() + interval '1 minute'), 'Design (returned)');
    perform app.set_inquiry_status(j.inquiry_id, 'in_design', 'Returned by Design Manager');
    perform app.notify(j.assignee_id, 'design_returned', 'Design returned for changes: ' || code, p_comment, 'normal', 'design_job', j.id, '/design/' || j.id);
  end if;
  perform app.refresh_inquiry(j.inquiry_id);
end $$;

-- Release per mode (6.5). Mode 1 → sales; modes 2/3 → estimation (mode 3 holds the design for the package).
create or replace function public.release_design(p_inquiry uuid, p_justification text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  brands jsonb;
  ej uuid;
begin
  perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager releases designs');
  perform app.require(i.status = 'design_approved', 'Every design task must be approved before release');
  perform app.require(i.release_mode_confirmed, 'SM Projects has not confirmed the release mode yet');
  update public.design_jobs set status = 'released', released_at = now()
   where inquiry_id = i.id and revision = i.revision and status = 'approved';

  if i.release_mode = 1 then
    select coalesce(jsonb_agg(b), '[]') into brands from public.design_jobs d, jsonb_array_elements(d.brands_specified) b
     where d.inquiry_id = i.id and d.revision = i.revision;
    perform app.require(jsonb_array_length(brands) > 0, 'Enter the brands specified in the design before release');
    if not app.brands_match_expectation(brands, i.solution_level, i.manufacturing_origin) then
      perform app.require(coalesce(trim(p_justification), '') <> '', 'Brands do not match the client expectation: give a justification');
      update public.design_jobs set brand_justification = p_justification where inquiry_id = i.id and revision = i.revision;
    end if;
    perform set_config('app.workflow', '1', true);
    update public.inquiries set design_released_to_sales_at = now() where id = i.id;
    perform app.set_inquiry_status(i.id, 'returned_to_sales', 'Design released to sales');
    perform app.start_clock(i.id, 'inquiry', i.id, 'sales_submission', i.sales_person_id, null, 'Submit design to client');
    perform app.notify_many(array[i.sales_person_id] || app.role_users('sm_projects'), 'design_released',
      'Design released: ' || i.code, format('%s – %s. Ready for the client.', i.project_name, i.customer_name),
      'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  else
    insert into public.estimation_jobs (inquiry_id, revision, source, status) values (i.id, i.revision, 'design', 'queued') returning id into ej;
    perform app.set_inquiry_status(i.id, 'in_estimation', 'Design released to Estimation');
    perform app.start_clock(i.id, 'estimation_job', ej, 'acceptance', (app.role_users('sm_estimation'))[1], null, 'Estimation acceptance');
    perform app.notify_many(array[i.sales_person_id] || app.role_users('sm_projects') || app.role_users('sm_estimation'),
      'design_to_estimation', 'Design completed and sent to Estimation: ' || i.code,
      format('%s – %s', i.project_name, i.customer_name), 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    update public.projects set milestone = 'design_involvement'
     where id = i.project_id and milestone = 'lead_identified';
  end if;
  perform app.refresh_inquiry(i.id);
end $$;

-- ---------------------------------------------------------------------------
-- Estimation (7.1 – 7.5)
-- ---------------------------------------------------------------------------
create or replace function app.est_job(p_id uuid) returns public.estimation_jobs
language plpgsql security definer set search_path = public as $$
declare r public.estimation_jobs;
begin
  select * into r from public.estimation_jobs where id = p_id for update;
  if not found then raise exception 'Estimation job not found'; end if;
  return r;
end $$;

create or replace function public.accept_estimation(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j public.estimation_jobs := app.est_job(p_job);
begin
  perform app.require(app.has_role('sm_estimation', 'gm'), 'Only SM Estimation accepts estimation jobs');
  perform app.require(j.status = 'queued', 'Job is not waiting for acceptance');
  update public.estimation_jobs set status = 'accepted' where id = j.id;
  perform app.stop_clocks('estimation_job', j.id, 'acceptance');
  perform app.start_clock(j.inquiry_id, 'estimation_job', j.id, 'assignment', auth.uid());
  perform app.log_status('estimation_job', j.id, j.inquiry_id, 'queued', 'accepted');
  perform app.refresh_inquiry(j.inquiry_id);
end $$;

-- Default estimator by project type (7.1)
create or replace function public.default_estimator(p_inquiry uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p, public.inquiries i
  where i.id = p_inquiry and p.active
    and p.role = case when i.project_type = any (app.infra_types()) then 'am_estimation'::public.app_role else 'estimation_exec'::public.app_role end
  limit 1
$$;

create or replace function public.assign_estimation_job(
  p_job uuid, p_assignee uuid, p_due timestamptz, p_value_band text default 'medium', p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  j public.estimation_jobs := app.est_job(p_job);
  i public.inquiries := app.inq(j.inquiry_id);
  r public.app_role;
begin
  perform app.require(app.has_role('sm_estimation', 'gm'), 'Only SM Estimation assigns estimators');
  perform app.require(j.status in ('accepted', 'assigned', 'acknowledged', 'in_progress', 'date_change_requested', 'returned'), 'Accept the job first');
  select role into r from public.profiles where id = p_assignee and active;
  perform app.require(r in ('am_estimation', 'estimation_exec'), 'Assign the Assistant Manager – Estimation or the Estimation Executive');
  if p_assignee is distinct from public.default_estimator(i.id) then
    perform app.require(coalesce(trim(p_reason), '') <> '', 'This estimator does not normally handle this project type: give a reason');
  end if;
  if j.assignee_id is not null and j.assignee_id <> p_assignee then
    perform app.require(coalesce(trim(p_reason), '') <> '', 'Hand-over requires a reason');
  end if;
  -- Must leave at least 1 working day before the customer deadline for approval and submission
  if i.customer_deadline is not null and
     app.work_minutes_between(p_due, (i.customer_deadline + app.work_end()) at time zone app.tz()) < app.working_minutes_per_day() then
    raise exception 'Estimation due date must leave at least 1 working day before the customer deadline (%)', i.customer_deadline;
  end if;

  update public.estimation_jobs set assignee_id = p_assignee, due_at = p_due, original_due_at = coalesce(original_due_at, p_due),
    value_band = p_value_band, assignment_reason = p_reason, assigned_by = auth.uid(), assigned_at = now(),
    status = case when j.assignee_id is null or j.assignee_id <> p_assignee then 'assigned' else j.status end
  where id = j.id;
  perform app.stop_clocks('estimation_job', j.id, 'assignment');
  if j.assignee_id is null or j.assignee_id <> p_assignee then
    perform app.start_clock(i.id, 'estimation_job', j.id, 'ack', p_assignee, null, 'Estimator acknowledgement');
  end if;
  perform app.start_clock(i.id, 'estimation_job', j.id, 'estimation', p_assignee, p_due, 'Estimation');
  perform app.log_status('estimation_job', j.id, i.id, j.status, 'assigned', p_reason);
  if i.status in ('accepted', 'design_approved') then perform app.set_inquiry_status(i.id, 'in_estimation'); end if;
  perform app.notify(p_assignee, 'work_assigned', 'Estimate assigned: ' || i.code,
    format('%s – %s. Duty %s (%s). Due %s', i.project_name, i.customer_name, i.duty_status, i.currency,
           to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI')),
    'normal', 'estimation_job', j.id, '/estimation/' || j.id);
  perform app.refresh_inquiry(i.id);
end $$;

create or replace function public.acknowledge_estimation_job(p_job uuid, p_requested_due timestamptz default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare j public.estimation_jobs := app.est_job(p_job);
begin
  perform app.require(j.assignee_id = auth.uid(), 'Only the assignee can acknowledge');
  perform app.stop_clocks('estimation_job', j.id, 'ack');
  update public.estimation_jobs set status = case when p_requested_due is null then 'in_progress' else 'date_change_requested' end,
    requested_due_at = p_requested_due where id = j.id;
  if p_requested_due is not null then
    perform app.notify_many(app.role_users('sm_estimation'), 'due_change_requested', 'Estimation due date change requested',
      format('%s asks for %s. %s', app.display_name(auth.uid()), to_char(p_requested_due at time zone app.tz(), 'DD Mon'), coalesce(p_note, '')),
      'normal', 'estimation_job', j.id, '/estimation/' || j.id, null, true);
  end if;
  perform app.log_status('estimation_job', j.id, j.inquiry_id, j.status,
    case when p_requested_due is null then 'in_progress' else 'date_change_requested' end, p_note);
end $$;

-- Estimator saves figures (cost/margin go to the restricted table)
create or replace function public.save_estimate(
  p_job uuid, p_quoted_value numeric, p_cost numeric, p_margin_pct numeric, p_brands jsonb,
  p_validity_days int default 30, p_alternatives text default null, p_supplier_waits jsonb default null, p_design_version text default null
) returns void language plpgsql security definer set search_path = public as $$
declare j public.estimation_jobs := app.est_job(p_job);
begin
  perform app.require(j.assignee_id = auth.uid() or app.has_role('sm_estimation'), 'Only the assigned estimator can edit the estimate');
  perform app.require(j.status in ('assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested'), 'The estimate is locked in its current status');
  if j.status = 'assigned' then perform app.stop_clocks('estimation_job', j.id, 'ack'); end if;
  update public.estimation_jobs set quoted_value = p_quoted_value, brands_offered = coalesce(p_brands, brands_offered),
    validity_days = coalesce(p_validity_days, 30), alternatives = p_alternatives,
    supplier_waits = coalesce(p_supplier_waits, supplier_waits), design_version_used = coalesce(p_design_version, design_version_used),
    status = case when status in ('assigned', 'returned') then 'in_progress' else status end
  where id = j.id;
  insert into public.estimation_costing (estimation_job_id, cost, margin_pct) values (j.id, p_cost, p_margin_pct)
  on conflict (estimation_job_id) do update set cost = excluded.cost, margin_pct = excluded.margin_pct, updated_at = now();
end $$;

create or replace function public.submit_estimate_for_approval(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j public.estimation_jobs := app.est_job(p_job); code text;
begin
  perform app.require(j.assignee_id = auth.uid(), 'Only the assigned estimator can submit');
  perform app.require(j.status in ('in_progress', 'acknowledged', 'returned', 'assigned'), 'Estimate is not in progress');
  perform app.require(j.quoted_value is not null, 'Enter the quoted value');
  perform app.require(app.has_attachment('estimation_job', j.id, 'quotation_draft'), 'Upload the draft quotation (PDF)');
  perform app.require(app.has_attachment('estimation_job', j.id, 'costing_sheet'), 'Upload the costing sheet (Excel)');
  update public.estimation_jobs set status = 'submitted_for_approval', submitted_at = now() where id = j.id;
  perform app.stop_clocks('estimation_job', j.id);
  perform app.start_clock(j.inquiry_id, 'estimation_job', j.id, 'quotation_approval', (app.role_users('sm_estimation'))[1], null, 'Quotation approval');
  perform app.log_status('estimation_job', j.id, j.inquiry_id, j.status, 'submitted_for_approval');
  perform app.set_inquiry_status(j.inquiry_id, 'estimation_review');
  select i.code into code from public.inquiries i where id = j.inquiry_id;
  perform app.notify_many(app.role_users('sm_estimation'), 'estimate_submitted', 'Quotation for approval: ' || code,
    app.display_name(auth.uid()), 'normal', 'estimation_job', j.id, '/estimation/' || j.id, null, true);
  perform app.refresh_inquiry(j.inquiry_id);
end $$;

create or replace function public.review_estimate(p_job uuid, p_approve boolean, p_comment text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  j public.estimation_jobs := app.est_job(p_job);
  i public.inquiries := app.inq(j.inquiry_id);
  margin numeric;
  value_lkr numeric;
  rate numeric;
begin
  perform app.require(app.has_role('sm_estimation', 'gm'), 'Only SM Estimation approves quotations');
  perform app.require(j.status = 'submitted_for_approval', 'Quotation is not waiting for approval');
  perform app.stop_clocks('estimation_job', j.id, 'quotation_approval');
  if not p_approve then
    perform app.require(coalesce(trim(p_comment), '') <> '', 'Give comments when returning');
    update public.estimation_jobs set status = 'returned', review_comment = p_comment where id = j.id;
    perform app.start_clock(i.id, 'estimation_job', j.id, 'estimation', j.assignee_id, greatest(j.due_at, now() + interval '1 minute'), 'Estimation (returned)');
    perform app.set_inquiry_status(i.id, 'in_estimation', 'Returned by SM Estimation');
    perform app.log_status('estimation_job', j.id, i.id, j.status, 'returned', p_comment);
    perform app.notify(j.assignee_id, 'quotation_returned', 'Quotation returned: ' || i.code, p_comment, 'normal', 'estimation_job', j.id, '/estimation/' || j.id);
    perform app.refresh_inquiry(i.id);
    return 'returned';
  end if;

  select margin_pct into margin from public.estimation_costing where estimation_job_id = j.id;
  select usd_to_lkr into rate from public.exchange_rates order by month desc limit 1;
  value_lkr := case when i.currency = 'USD' then j.quoted_value * coalesce(rate, 300) else j.quoted_value end;
  if value_lkr > app.setting_num('gm_approval_value_lkr', 50000000)
     or coalesce(margin, 100) < app.setting_num('gm_approval_margin_floor_pct', 15) then
    update public.estimation_jobs set status = 'gm_approval', review_comment = p_comment where id = j.id;
    perform app.create_approval('quotation_release', 'estimation_job', j.id, i.id, format('Quotation release – %s', i.code),
      format('%s, margin %s%%', app.fmt_money(j.quoted_value, i.currency), coalesce(margin::text, '—')),
      array['gm']::public.app_role[]);
    perform app.log_status('estimation_job', j.id, i.id, j.status, 'gm_approval', p_comment);
    return 'gm_approval';
  end if;
  update public.estimation_jobs set status = 'approved', approved_at = now(), review_comment = p_comment where id = j.id;
  perform app.log_status('estimation_job', j.id, i.id, j.status, 'approved', p_comment);
  perform app.notify(j.assignee_id, 'quotation_approved', 'Quotation approved – release it: ' || i.code, coalesce(p_comment, ''),
    'normal', 'estimation_job', j.id, '/estimation/' || j.id);
  return 'approved';
end $$;

create or replace function public.release_quotation(p_job uuid, p_justification text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  j public.estimation_jobs := app.est_job(p_job);
  i public.inquiries := app.inq(j.inquiry_id);
  qno text;
  qid uuid;
  validity date;
begin
  perform app.require(j.assignee_id = auth.uid() or app.has_role('sm_estimation', 'gm'), 'Not allowed');
  perform app.require(j.status = 'approved', 'The quotation must be approved first');
  perform app.require(jsonb_array_length(j.brands_offered) > 0, 'Enter the brands and origin offered for each main product group');
  perform app.require(app.has_attachment('estimation_job', j.id, 'quotation_final'), 'Upload the final quotation PDF');
  perform app.require(app.has_attachment('estimation_job', j.id, 'compliance_sheet'), 'Upload the compliance sheet');
  perform app.require(app.has_attachment('estimation_job', j.id, 'technical_data'), 'Upload the technical data sheets');
  if not app.brands_match_expectation(j.brands_offered, i.solution_level, i.manufacturing_origin) then
    perform app.require(coalesce(trim(p_justification), '') <> '', 'Brands do not match the client expectation: give a justification');
  end if;

  -- Quotation number is kept across revisions: QTN-YYYY-NNNNN-Rn
  select quotation_no into qno from public.quotations where inquiry_id = i.id order by released_at limit 1;
  qno := coalesce(qno, app.next_code('QTN'));
  validity := (now() at time zone app.tz())::date + j.validity_days;
  insert into public.quotations (inquiry_id, estimation_job_id, quotation_no, revision, quoted_value, currency, brands_offered, validity_date)
  values (i.id, j.id, qno, i.revision, j.quoted_value, i.currency, j.brands_offered, validity)
  returning id into qid;
  update public.estimation_jobs set status = 'released', released_at = now(), quotation_no = qno, brand_justification = p_justification where id = j.id;
  perform app.log_status('estimation_job', j.id, i.id, 'approved', 'released');

  perform set_config('app.workflow', '1', true);
  update public.inquiries set quotation_released_at = now(),
    design_released_to_sales_at = case when release_mode = 3 then now() else design_released_to_sales_at end
  where id = i.id;
  update public.design_jobs set status = 'released', released_at = coalesce(released_at, now()) where inquiry_id = i.id and status = 'approved';
  perform app.set_inquiry_status(i.id, 'quotation_released',
    case when i.release_mode = 3 then 'Quotation and design released together' else 'Quotation released' end);
  perform app.stop_clocks('estimation_job', j.id);
  perform app.start_clock(i.id, 'inquiry', i.id, 'sales_submission', i.sales_person_id, null, 'Submit to client');
  perform app.notify_many(array[i.sales_person_id] || app.role_users('sm_projects'), 'quotation_released',
    'Quotation released: ' || qno || '-R' || i.revision,
    format('%s – %s · %s', i.project_name, i.customer_name, app.fmt_money(j.quoted_value, i.currency)),
    'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  perform app.refresh_inquiry(i.id);
  return qid;
end $$;

-- ---------------------------------------------------------------------------
-- Clarifications Estimation → Design (7.5)
-- ---------------------------------------------------------------------------
create or replace function public.ask_clarification(p_job uuid, p_question text) returns uuid
language plpgsql security definer set search_path = public as $$
declare j public.estimation_jobs := app.est_job(p_job); dj record; cid uuid;
begin
  perform app.require(j.assignee_id = auth.uid() or app.has_role('sm_estimation'), 'Not allowed');
  select id, assignee_id into dj from public.design_jobs where inquiry_id = j.inquiry_id order by revision desc, created_at desc limit 1;
  perform app.require(dj.id is not null, 'This inquiry has no design job to ask');
  insert into public.clarifications (inquiry_id, estimation_job_id, design_job_id, question)
  values (j.inquiry_id, j.id, dj.id, p_question) returning id into cid;
  perform app.notify(dj.assignee_id, 'clarification', 'Clarification from Estimation', left(p_question, 140),
    'normal', 'design_job', dj.id, '/design/' || dj.id);
  return cid;
end $$;

create or replace function public.answer_clarification(p_clarification uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.clarifications;
begin
  select * into c from public.clarifications where id = p_clarification;
  perform app.require(app.has_role('design_manager') or exists (select 1 from public.design_jobs where id = c.design_job_id and assignee_id = auth.uid()),
    'Only the designer can answer');
  update public.clarifications set answer = p_answer, answered_by = auth.uid(), answered_at = now() where id = c.id;
  perform app.notify(c.asked_by, 'clarification_answered', 'Clarification answered', left(p_answer, 140),
    'normal', 'estimation_job', c.estimation_job_id, '/estimation/' || c.estimation_job_id);
end $$;

-- ---------------------------------------------------------------------------
-- Sales: client submission, client response, result (6.5, 7.1, 7.4)
-- ---------------------------------------------------------------------------
create or replace function public.record_client_submission(p_inquiry uuid, p_date date default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); d date := coalesce(p_date, (now() at time zone app.tz())::date);
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects'), 'Only the sales person records the submission');
  perform app.require(i.status in ('quotation_released', 'returned_to_sales') or i.early_design_release_at is not null, 'Nothing has been released yet');
  perform app.stop_clocks('inquiry', i.id, 'sales_submission');
  perform set_config('app.workflow', '1', true);
  update public.inquiries set submitted_to_client_at = d::timestamptz where id = i.id;
  if i.status = 'quotation_released' then
    update public.quotations set submitted_to_client_at = d::timestamptz where inquiry_id = i.id and revision = i.revision;
    perform set_config('app.reason', 'Quotation submitted ' || i.code, true);
    update public.projects set milestone = 'quotation_submitted'
     where id = i.project_id and milestone in ('lead_identified', 'design_involvement', 'brand_specified');
  end if;
  perform app.set_inquiry_status(i.id, case when i.release_mode in (1, 3) and i.client_response is null
                                            then 'awaiting_client_approval' else 'submitted_to_client' end);
  perform app.notify_many(app.role_users('sm_estimation') || app.role_users('sm_projects')
      || array(select assignee_id from public.estimation_jobs where inquiry_id = i.id),
    'submitted_to_client', 'Submitted to client: ' || i.code, i.project_name, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  perform app.refresh_inquiry(i.id);
end $$;

create or replace function public.record_client_response(p_inquiry uuid, p_response text, p_comments text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  recipients uuid[];
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects'), 'Only the sales person records the client response');
  perform app.require(p_response in ('approved', 'approved_with_comments', 'revision_required'), 'Invalid response');
  perform app.require(p_response <> 'revision_required' or coalesce(trim(p_comments), '') <> '', 'Add the client''s comments');
  perform set_config('app.workflow', '1', true);
  update public.inquiries set client_response = p_response, client_response_at = now() where id = i.id;
  recipients := app.role_users('design_manager')
    || array(select assignee_id from public.design_jobs where inquiry_id = i.id and revision = i.revision);
  if exists (select 1 from public.estimation_jobs where inquiry_id = i.id and status not in ('released')) then
    recipients := recipients || app.role_users('sm_estimation') || array(select assignee_id from public.estimation_jobs where inquiry_id = i.id);
  end if;

  if p_response = 'revision_required' then
    -- New design revision (R1, R2 …) back in the Design Manager's queue
    update public.inquiries set revision = revision + 1, client_response = null where id = i.id;
    perform app.set_inquiry_status(i.id, 'accepted', format('Client revision R%s: %s', i.revision + 1, p_comments));
    perform app.start_clock(i.id, 'inquiry', i.id, 'assignment', (app.role_users('design_manager'))[1], null, 'Assign revision');
    -- Estimation running in parallel is put on hold
    update public.estimation_jobs set status_before_hold = status, status = 'on_hold', hold_reason = 'Design revision requested'
     where inquiry_id = i.id and status in ('assigned', 'acknowledged', 'in_progress');
    perform app.pause_clocks('estimation_job', e.id, 'Design revision requested') from public.estimation_jobs e where e.inquiry_id = i.id and e.status = 'on_hold';
    perform app.notify_many(recipients, 'design_revision', 'Design revision requested: ' || i.code || '-R' || (i.revision + 1),
      p_comments, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  else
    perform app.set_inquiry_status(i.id, case when i.status = 'awaiting_client_approval' and i.release_mode = 1 then 'client_approved'
                                              else 'submitted_to_client' end, p_comments);
    perform set_config('app.reason', 'Design client-approved', true);
    update public.projects set milestone = 'brand_specified', spec_status = 'our_brand'
     where id = i.project_id and milestone in ('lead_identified', 'design_involvement');
    perform app.notify_many(recipients, 'client_response', 'Client approved the design: ' || i.code, coalesce(p_comments, ''),
      'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  end if;
  perform app.refresh_inquiry(i.id);
end $$;

create or replace function public.record_inquiry_result(
  p_inquiry uuid, p_result text, p_lost_reason text default null, p_competitor bigint default null,
  p_order_value numeric default null, p_order_date date default null
) returns void language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry);
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person records the result');
  perform app.require(p_result in ('won', 'lost', 'on_hold', 'cancelled'), 'Invalid result');
  perform app.require(p_result <> 'lost' or p_lost_reason is not null, 'Select the lost reason');
  perform app.require(p_result <> 'won' or (p_order_value is not null and p_order_date is not null), 'Enter the order value and order date');
  perform app.stop_clocks('inquiry', i.id);
  perform set_config('app.workflow', '1', true);
  update public.inquiries set result = p_result, lost_reason = p_lost_reason, lost_to_competitor_id = p_competitor,
    order_value = p_order_value, order_date = p_order_date where id = i.id;
  update public.quotations set result = case when p_result = 'cancelled' then 'lost' else p_result end, lost_reason = p_lost_reason
   where inquiry_id = i.id and revision = i.revision;
  perform app.set_inquiry_status(i.id, p_result, p_lost_reason);
  perform set_config('app.reason', 'Inquiry ' || i.code || ' ' || p_result, true);
  if p_result = 'won' then
    update public.projects set milestone = 'won', stage = 'Award' where id = i.project_id;
  elsif p_result = 'lost' and not exists (select 1 from public.inquiries where project_id = i.project_id and id <> i.id
                                          and status not in ('lost', 'cancelled', 'rejected', 'draft')) then
    update public.projects set milestone = 'lost', status_reason = p_lost_reason where id = i.project_id;
  end if;
  perform app.refresh_inquiry(i.id);
end $$;

-- ---------------------------------------------------------------------------
-- Sales change requests after submission (5.2, 5.5, 5.7, 5.8, 6.5)
-- ---------------------------------------------------------------------------
create or replace function public.extend_customer_deadline(p_inquiry uuid, p_new_deadline date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry);
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects'), 'Only the sales person can extend the deadline');
  perform app.require(coalesce(trim(p_reason), '') <> '', 'Give the reason for the extension');
  insert into public.due_date_changes (entity_type, entity_id, inquiry_id, field, old_value, new_value, reason)
  values ('inquiry', i.id, i.id, 'customer_deadline', i.customer_deadline::timestamptz, p_new_deadline::timestamptz, p_reason);
  perform set_config('app.workflow', '1', true);
  update public.inquiries set customer_deadline = p_new_deadline, deadline_critical_sent = false, deadline_missed_sent = false where id = i.id;
  perform app.notify_many(app.role_users(case when i.status in ('in_estimation', 'estimation_review') or i.route = 'B'
                                              then 'sm_estimation'::public.app_role else 'design_manager'::public.app_role end),
    'deadline_extended', 'Customer deadline extended: ' || i.code,
    format('%s → %s. %s', to_char(i.customer_deadline, 'DD Mon'), to_char(p_new_deadline, 'DD Mon'), p_reason),
    'normal', 'inquiry', i.id, app.inquiry_url(i.id));
end $$;

create or replace function public.request_inquiry_change(p_inquiry uuid, p_kind text, p_payload jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); steps public.app_role[];
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person can request changes');
  perform app.require(coalesce(trim(p_reason), '') <> '', 'A reason is required');
  case p_kind
    when 'duty_change' then steps := array['sm_projects'];
    when 'release_mode' then steps := array['sm_projects'];
    when 'expectation_change' then
      steps := case when i.route = 'B' then array['sm_estimation'] else array['design_manager', 'sm_estimation'] end;
    when 'early_design_release' then
      perform app.require(i.release_mode = 3, 'Early design release applies to design + estimation inquiries only');
      perform app.require(i.status in ('in_estimation', 'estimation_review') and i.design_released_to_sales_at is null,
        'The design must be approved and not yet released');
      steps := array['design_manager', 'sm_projects'];
    else raise exception 'Unknown change type %', p_kind;
  end case;
  return app.create_approval(p_kind::public.approval_kind, 'inquiry', i.id, i.id,
    format('%s – %s', initcap(replace(p_kind, '_', ' ')), i.code), p_reason, steps::public.app_role[], coalesce(p_payload, '{}'));
end $$;

-- Progress timeline for any user who can see the inquiry (sales sees stages and dates only)
create or replace function public.inquiry_timeline(p_inquiry uuid)
returns table (at timestamptz, from_status text, to_status text, by_name text, reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.can_read_inquiry(p_inquiry) then return; end if;
  return query
  select h.at, h.from_status, h.to_status, app.display_name(h.user_id),
         case when app.is_sales_person() then null else h.reason end
  from public.status_history h
  where h.entity_type = 'inquiry' and h.entity_id = p_inquiry
  order by h.at;
end $$;
