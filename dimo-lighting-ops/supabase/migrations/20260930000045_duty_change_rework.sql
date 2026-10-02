-- Duty status change approved by SM Projects: the work is routed again instead of only notifying.
--  * estimate assigned / in progress / on hold / submitted / in approval → back to SM Estimation to re-assign (pending quotation
--    approvals are cancelled); the estimator re-prices in the new currency
--  * quotation already released / with the client → a new revision (R1 …) for SM Estimation to assign, previous quotation visible
--  * no estimate yet (design stage) or waiting to be assigned → Design Manager / SM Estimation are informed

create or replace function app.duty_change_rework(p_inquiry uuid, p_duty text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  j public.estimation_jobs;
  cur text := case when p_duty = 'duty_free' then 'USD' else 'LKR' end;
  note text := format('Duty changed to %s (%s)%s', replace(p_duty, '_', ' '), cur, coalesce(' – ' || nullif(trim(p_reason), ''), ''));
begin
  select * into j from public.estimation_jobs where inquiry_id = i.id order by revision desc, created_at desc limit 1;

  if j.id is null then
    -- Still in design (or not yet sent to estimation): nothing to re-assign
    perform app.notify_many(case when i.route in ('A', 'C') then app.role_users('design_manager') else '{}'::uuid[] end || app.role_users('sm_estimation'),
      'duty_changed', 'Duty status changed: ' || i.code, note || ' · pricing will be in ' || cur, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    return;
  end if;

  if j.status = 'released' then
    -- Quotation already issued: a new revision to re-price
    if not exists (select 1 from public.estimation_jobs where inquiry_id = i.id and status <> 'released') then
      perform public.request_quotation_revision(i.id, note);
    end if;
    return;
  end if;

  if j.status in ('queued', 'accepted', 'revision_requested') then
    perform app.notify_many(app.role_users('sm_estimation'), 'duty_changed', 'Duty status changed: ' || i.code,
      note || ' · price it in ' || cur, 'normal', 'estimation_job', j.id, '/estimation/' || j.id);
    return;
  end if;

  -- Assigned, in progress, on hold, submitted or in approval: back to SM Estimation to re-assign
  update public.approvals set status = 'cancelled', decided_at = now()
   where entity_type = 'estimation_job' and entity_id = j.id and status = 'pending'
     and kind in ('quotation_sm_projects', 'quotation_release', 'estimation_hold');
  perform app.stop_clocks('estimation_job', j.id);
  update public.estimation_jobs set status = 'revision_requested', review_comment = note, needs_sm_projects = false where id = j.id;
  perform app.log_status('estimation_job', j.id, i.id, j.status, 'revision_requested', note);
  perform app.set_inquiry_status(i.id, 'in_estimation', note);
  perform app.start_clock(i.id, 'estimation_job', j.id, 'assignment', (app.role_users('sm_estimation'))[1], null, 'Re-assign after duty change');
  perform app.notify_many(app.role_users('sm_estimation'), 'duty_changed', 'Duty changed – re-assign the estimate: ' || i.code,
    note || ' · re-price in ' || cur, 'normal', 'estimation_job', j.id, '/estimation/' || j.id, null, true);
  perform app.notify(j.assignee_id, 'duty_changed', 'Duty changed: ' || i.code, note || ' · SM Estimation will re-assign it',
    'normal', 'estimation_job', j.id, '/estimation/' || j.id);
  perform app.refresh_inquiry(i.id);
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
      perform app.duty_change_rework(a.inquiry_id, a.payload ->> 'duty_status', a.reason);
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
    if approved then
      update public.estimation_jobs set status = 'approved', approved_at = now(), needs_sm_projects = true, review_comment = p_comment
       where id = a.entity_id;
      perform app.notify_many(app.role_users('sm_estimation') || (select assignee_id from public.estimation_jobs where id = a.entity_id),
        'quotation_approved', 'GM / DGM approved the quotation – release it: ' || i.code, coalesce(p_comment, ''),
        'normal', 'estimation_job', a.entity_id, '/estimation/' || a.entity_id);
    else
      perform app.quotation_send_back(a.entity_id, i.id, p_comment, true);
    end if;
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
      decider := (select s.approver_role from public.approval_steps s where s.approval_id = a.id and s.decision is not null
                   order by s.step_no desc limit 1);
      perform app.quotation_send_back(a.entity_id, i.id, p_comment, decider = 'gm' or app.my_role() = 'gm');
    end if;
    perform app.refresh_inquiry(i.id);
  when 'retention_extension' then
    if approved then
      update public.retentions set due_date = (a.payload ->> 'new_date')::date, extensions = extensions + 1,
        alerted_60 = false, alerted_30 = false, sm_overdue_alerted = false
       where id = a.entity_id;
    end if;
    insert into public.retention_log (retention_id, kind, note)
    values (a.entity_id, case when approved then 'extended' else 'extension_' || a.status end,
            format('Due date %s → %s %s by GM / DGM%s', to_char((a.payload ->> 'old_date')::date, 'DD Mon YYYY'),
                   to_char((a.payload ->> 'new_date')::date, 'DD Mon YYYY'), case when approved then 'approved' else a.status end,
                   coalesce(' · ' || p_comment, '')));
    perform app.notify_many(app.role_users('operations_exec') || (select sales_person_id from public.retentions where id = a.entity_id),
      'retention_extension', format('Retention extension %s', case when approved then 'approved' else a.status end),
      coalesce(a.title, '') || coalesce(' · ' || p_comment, ''), 'normal', 'retention', a.entity_id, '/retentions/' || a.entity_id);
  else
    null;
  end case;
end $$;
