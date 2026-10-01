-- Quotations below 15 Mn LKR (equivalent): after SM Estimation approves, SM Projects verifies and accepts or requests a revision.
--  * Accepted  → SM Estimation releases the quotation to sales.
--  * Revision  → back to SM Estimation, who re-assigns it to an estimator (same or another); the estimator revises and resubmits,
--                SM Estimation approves again and it returns to SM Projects – as many rounds as needed.
-- Above the limit nothing changes (GM / DGM approval still applies above its value or below the margin floor).

alter table public.estimation_jobs drop constraint if exists estimation_jobs_status_check;
alter table public.estimation_jobs add constraint estimation_jobs_status_check check (status in (
  'queued', 'accepted', 'assigned', 'acknowledged', 'date_change_requested', 'in_progress', 'on_hold',
  'submitted_for_approval', 'returned', 'gm_approval', 'sm_projects_approval', 'revision_requested', 'approved', 'released'));
alter table public.estimation_jobs add column if not exists needs_sm_projects boolean not null default false;
alter table public.estimation_jobs add column if not exists sm_projects_revisions int not null default 0;

insert into public.settings (key, value, description)
values ('sm_projects_release_value_lkr', '15000000', 'Quotations below this value (LKR equivalent) need SM Projects approval before SM Estimation releases them')
on conflict (key) do nothing;

create or replace function public.review_estimate(p_job uuid, p_approve boolean, p_comment text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  j public.estimation_jobs := app.est_job(p_job);
  i public.inquiries := app.inq(j.inquiry_id);
  margin numeric;
  value_lkr numeric;
  rate numeric;
  gm_needed boolean;
  smp_needed boolean;
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
  gm_needed := value_lkr > app.setting_num('gm_approval_value_lkr', 50000000)
               or coalesce(margin, 100) < app.setting_num('gm_approval_margin_floor_pct', 15);
  smp_needed := value_lkr < app.setting_num('sm_projects_release_value_lkr', 15000000);

  if smp_needed then
    update public.estimation_jobs set status = 'sm_projects_approval', needs_sm_projects = true, review_comment = p_comment where id = j.id;
    perform app.create_approval('quotation_sm_projects', 'estimation_job', j.id, i.id,
      format('Quotation release – %s (%s)', i.code, app.fmt_money(j.quoted_value, i.currency)),
      format('%s – %s · %s · estimator %s%s%s%s', i.project_name, i.customer_name, app.fmt_money(j.quoted_value, i.currency),
        app.display_name(j.assignee_id),
        case when j.sm_projects_revisions > 0 then format(' · revision %s after your request', j.sm_projects_revisions) else '' end,
        case when coalesce(trim(p_comment), '') <> '' then ' · SM Estimation: ' || p_comment else '' end,
        case when gm_needed then ' · then GM / DGM approval' else '' end),
      case when gm_needed then array['sm_projects', 'gm']::public.app_role[] else array['sm_projects']::public.app_role[] end,
      jsonb_build_object('value', j.quoted_value, 'currency', i.currency, 'value_lkr', value_lkr));
    perform app.log_status('estimation_job', j.id, i.id, j.status, 'sm_projects_approval', p_comment);
    perform app.refresh_inquiry(i.id);
    return 'sm_projects_approval';
  end if;
  if gm_needed then
    update public.estimation_jobs set status = 'gm_approval', needs_sm_projects = false, review_comment = p_comment where id = j.id;
    perform app.create_approval('quotation_release', 'estimation_job', j.id, i.id, format('Quotation release – %s', i.code),
      format('%s, margin %s%%', app.fmt_money(j.quoted_value, i.currency), coalesce(margin::text, '—')),
      array['gm']::public.app_role[]);
    perform app.log_status('estimation_job', j.id, i.id, j.status, 'gm_approval', p_comment);
    return 'gm_approval';
  end if;
  update public.estimation_jobs set status = 'approved', approved_at = now(), needs_sm_projects = false, review_comment = p_comment where id = j.id;
  perform app.log_status('estimation_job', j.id, i.id, j.status, 'approved', p_comment);
  perform app.notify(j.assignee_id, 'quotation_approved', 'Quotation approved – release it: ' || i.code, coalesce(p_comment, ''),
    'normal', 'estimation_job', j.id, '/estimation/' || j.id);
  return 'approved';
end $$;

-- After a revision request SM Estimation re-assigns the estimate (same or another estimator) with a new due date
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
  if j.status = 'revision_requested' then
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
      format('SM Projects requested a revision: %s. Due %s', coalesce(j.review_comment, ''), to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI')),
      'normal', 'estimation_job', j.id, '/estimation/' || j.id);
  else
  perform app.notify(p_assignee, 'work_assigned', 'Estimate assigned: ' || i.code,
    format('%s – %s. Duty %s (%s). Due %s', i.project_name, i.customer_name, i.duty_status, i.currency,
           to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI')),
    'normal', 'estimation_job', j.id, '/estimation/' || j.id);
  end if;
  perform app.refresh_inquiry(i.id);
end $$;

-- Quotations approved by SM Projects are released by SM Estimation
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
  perform app.require(not j.needs_sm_projects or app.has_role('sm_estimation', 'gm'), 'SM Estimation releases quotations approved by SM Projects');
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

-- SM Projects decision
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
  when 'quotation_sm_projects' then
    if approved then
      update public.estimation_jobs set status = 'approved', approved_at = now(), review_comment = coalesce(p_comment, review_comment)
       where id = a.entity_id;
      perform app.log_status('estimation_job', a.entity_id, i.id, 'sm_projects_approval', 'approved', p_comment);
      perform app.notify_many(app.role_users('sm_estimation') || (select assignee_id from public.estimation_jobs where id = a.entity_id),
        'quotation_approved', 'SM Projects accepted the quotation – release it: ' || i.code, coalesce(p_comment, ''),
        'normal', 'estimation_job', a.entity_id, '/estimation/' || a.entity_id);
    else
      update public.estimation_jobs set status = 'revision_requested', review_comment = p_comment, sm_projects_revisions = sm_projects_revisions + 1
       where id = a.entity_id;
      perform app.log_status('estimation_job', a.entity_id, i.id, 'sm_projects_approval', 'revision_requested', p_comment);
      perform app.set_inquiry_status(i.id, 'in_estimation', 'Revision requested by SM Projects');
      perform app.start_clock(i.id, 'estimation_job', a.entity_id, 'assignment', (app.role_users('sm_estimation'))[1], null, 'Re-assign revision');
      perform app.notify_many(app.role_users('sm_estimation'), 'quotation_revision', 'SM Projects requested a revision: ' || i.code,
        coalesce(p_comment, '') || ' – re-assign it to an estimator', 'normal', 'estimation_job', a.entity_id, '/estimation/' || a.entity_id);
      perform app.notify((select assignee_id from public.estimation_jobs where id = a.entity_id), 'quotation_revision',
        'SM Projects requested a revision: ' || i.code, coalesce(p_comment, '') || ' – SM Estimation will re-assign it',
        'normal', 'estimation_job', a.entity_id, '/estimation/' || a.entity_id);
    end if;
    perform app.refresh_inquiry(i.id);
  else
    null;
  end case;
end $$;

-- SM Projects can open the draft quotation and supporting sheets of quotations it verifies (costing access is unchanged)
create or replace function app.can_read_attachment(a public.attachments) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); inq uuid; st text; mode int; released timestamptz;
begin
  if r is null then return false; end if;
  if a.uploaded_by = auth.uid() then return true; end if;
  case a.entity_type
  when 'visit' then
    return r in ('gm', 'sm_projects') or exists (select 1 from public.visits where id = a.entity_id and sales_person_id = auth.uid());
  when 'tender' then
    return r in ('gm', 'sm_projects', 'sm_estimation') or exists (select 1 from public.tenders where id = a.entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return app.can_read_inquiry(a.entity_id);
  when 'design_job' then
    select inquiry_id into inq from public.design_jobs where id = a.entity_id;
    if r in ('gm', 'design_manager') or app.can_read_design_job(a.entity_id) and r in ('lighting_designer', 'lighting_engineer') then return true; end if;
    -- Released design pack: Estimation (on release) and Sales (Route C / mode 3 release / early release)
    if a.kind = 'design_pack' then
      if r in ('sm_estimation', 'am_estimation', 'estimation_exec') then return app.can_read_inquiry(inq); end if;
      select status, release_mode, design_released_to_sales_at into st, mode, released from public.inquiries where id = inq;
      if r in ('sm_projects') or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)) then
        return released is not null;
      end if;
    end if;
    return false;
  when 'estimation_job' then
    select inquiry_id into inq from public.estimation_jobs where id = a.entity_id;
    if a.kind = 'costing_sheet' then return app.can_read_costing(a.entity_id); end if;
    if r in ('gm', 'sm_estimation') or app.can_read_estimation_job(a.entity_id) then return true; end if;
    if r = 'sm_projects' and a.kind in ('quotation_draft', 'quotation_final', 'compliance_sheet', 'technical_data')
       and exists (select 1 from public.estimation_jobs where id = a.entity_id and needs_sm_projects) then
      return true;
    end if;
    -- Sales download only the released quotation and supporting sheets – never the costing sheet
    if a.kind in ('quotation_final', 'compliance_sheet', 'technical_data') then
      return exists (select 1 from public.estimation_jobs where id = a.entity_id and status = 'released')
             and (r = 'sm_projects' or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)));
    end if;
    return false;
  when 'clarification' then
    select inquiry_id into inq from public.clarifications where id = a.entity_id;
    return r in ('gm', 'design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec')
           and app.can_read_inquiry(inq);
  when 'sample' then
    return r in ('gm', 'sm_projects', 'operations_exec') or exists (select 1 from public.samples where id = a.entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then
    return r in ('gm', 'sm_projects', 'operations_exec');
  else
    return r = 'gm';
  end case;
end $$;
