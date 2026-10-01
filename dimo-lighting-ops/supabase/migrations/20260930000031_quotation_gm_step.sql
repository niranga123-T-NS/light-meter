-- Every quotation is verified by SM Projects before release; from 15 Mn LKR (equivalent) GM / DGM approves after SM Projects.
--  * SM Projects: accept or request a revision.     GM / DGM: approve or reject.
--  * A revision request or a GM / DGM rejection goes straight back to SM Estimation (SM Projects is told of a GM rejection),
--    SM Estimation re-assigns it to an estimator and the same approvals run again.
--  * GM / DGM still also approves any quotation below the margin floor.
--  * Approved quotations are released by SM Estimation.

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
  gm_needed := value_lkr >= app.setting_num('sm_projects_release_value_lkr', 15000000)
               or coalesce(margin, 100) < app.setting_num('gm_approval_margin_floor_pct', 15);
  smp_needed := true;

  if smp_needed then
    update public.estimation_jobs set status = 'sm_projects_approval', needs_sm_projects = true, review_comment = p_comment where id = j.id;
    perform app.create_approval('quotation_sm_projects', 'estimation_job', j.id, i.id,
      format('Quotation release – %s (%s)%s', i.code, app.fmt_money(j.quoted_value, i.currency), case when gm_needed then ' · SM Projects → GM / DGM' else '' end),
      format('%s – %s · %s · estimator %s%s%s%s', i.project_name, i.customer_name, app.fmt_money(j.quoted_value, i.currency),
        app.display_name(j.assignee_id),
        case when j.sm_projects_revisions > 0 then format(' · revision %s after your request', j.sm_projects_revisions) else '' end,
        case when coalesce(trim(p_comment), '') <> '' then ' · SM Estimation: ' || p_comment else '' end,
        case when gm_needed then format(' · then GM / DGM approval%s', case when coalesce(margin, 100) < app.setting_num('gm_approval_margin_floor_pct', 15) and value_lkr < app.setting_num('sm_projects_release_value_lkr', 15000000) then ' (margin below floor)' else '' end) else '' end),
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

create or replace function app.apply_approval(a public.approvals, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries;
  approved boolean := a.status = 'approved';
  decider public.app_role;
  who text;
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
        'quotation_approved', 'Quotation approved – release it: ' || i.code, coalesce(p_comment, ''),
        'normal', 'estimation_job', a.entity_id, '/estimation/' || a.entity_id);
    else
      update public.estimation_jobs set status = 'revision_requested', review_comment = p_comment, sm_projects_revisions = sm_projects_revisions + 1
       where id = a.entity_id;
      perform app.log_status('estimation_job', a.entity_id, i.id, 'sm_projects_approval', 'revision_requested', p_comment);
      perform app.set_inquiry_status(i.id, 'in_estimation', 'Revision requested by SM Projects');
      perform app.start_clock(i.id, 'estimation_job', a.entity_id, 'assignment', (app.role_users('sm_estimation'))[1], null, 'Re-assign revision');
      decider := (select s.approver_role from public.approval_steps s where s.approval_id = a.id and s.decision is not null
                   order by s.step_no desc limit 1);
      who := case when decider = 'gm' then 'GM / DGM rejected the quotation' else 'SM Projects requested a revision' end;
      perform app.notify_many(app.role_users('sm_estimation'), 'quotation_revision', who || ': ' || i.code,
        coalesce(p_comment, '') || ' – re-assign it to an estimator', 'normal', 'estimation_job', a.entity_id, '/estimation/' || a.entity_id);
      perform app.notify((select assignee_id from public.estimation_jobs where id = a.entity_id), 'quotation_revision',
        who || ': ' || i.code, coalesce(p_comment, '') || ' – SM Estimation will re-assign it',
        'normal', 'estimation_job', a.entity_id, '/estimation/' || a.entity_id);
      if decider = 'gm' then
        perform app.notify_many(app.role_users('sm_projects'), 'quotation_gm_rejected', 'For information – GM / DGM rejected: ' || i.code,
          coalesce(p_comment, '') || ' · returned to SM Estimation for revision', 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
      end if;
    end if;
    perform app.refresh_inquiry(i.id);
  else
    null;
  end case;
end $$;
