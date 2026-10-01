-- Fix: a GM / DGM rejection of a quotation raised under the earlier GM-only approval ("quotation_release") went straight back
-- to the estimator. Every rejection / revision request now goes to SM Estimation to re-assign (SM Projects informed of a
-- GM / DGM rejection), whichever approval it came through. Quotations already sent back the old way are moved to SM Estimation.

-- One place for "send the quotation back to SM Estimation for re-assignment"
create or replace function app.quotation_send_back(p_job uuid, p_inquiry uuid, p_comment text, p_by_gm boolean) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); who text; prev text;
begin
  select status into prev from public.estimation_jobs where id = p_job;
  who := case when p_by_gm then 'GM / DGM rejected the quotation' else 'SM Projects requested a revision' end;
  update public.estimation_jobs set status = 'revision_requested', review_comment = p_comment, sm_projects_revisions = sm_projects_revisions + 1
   where id = p_job;
  perform app.log_status('estimation_job', p_job, i.id, prev, 'revision_requested', p_comment);
  perform app.set_inquiry_status(i.id, 'in_estimation', case when p_by_gm then 'Rejected by GM / DGM' else 'Revision requested by SM Projects' end);
  perform app.stop_clocks('estimation_job', p_job, 'estimation');
  perform app.start_clock(i.id, 'estimation_job', p_job, 'assignment', (app.role_users('sm_estimation'))[1], null, 'Re-assign revision');
  perform app.notify_many(app.role_users('sm_estimation'), 'quotation_revision', who || ': ' || i.code,
    coalesce(p_comment, '') || ' – re-assign it to an estimator', 'normal', 'estimation_job', p_job, '/estimation/' || p_job);
  perform app.notify((select assignee_id from public.estimation_jobs where id = p_job), 'quotation_revision',
    who || ': ' || i.code, coalesce(p_comment, '') || ' – SM Estimation will re-assign it',
    'normal', 'estimation_job', p_job, '/estimation/' || p_job);
  if p_by_gm then
    perform app.notify_many(app.role_users('sm_projects'), 'quotation_gm_rejected', 'For information – GM / DGM rejected: ' || i.code,
      coalesce(p_comment, '') || ' · returned to SM Estimation for revision', 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  end if;
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
  else
    null;
  end case;
end $$;

-- Repair: quotations a GM / DGM sent back under the earlier rule and nobody has resubmitted since
do $$
declare r record;
begin
  for r in select j.id, j.inquiry_id,
                  (select s.comment from public.approval_steps s where s.approval_id = a.id and s.decision is not null order by s.step_no desc limit 1) as comment
             from public.estimation_jobs j
             join public.approvals a on a.entity_type = 'estimation_job' and a.entity_id = j.id
                                    and a.kind = 'quotation_release' and a.status in ('rejected', 'returned')
            where j.status = 'returned'
              and (j.submitted_at is null or a.decided_at >= j.submitted_at)
              and not exists (select 1 from public.approvals p where p.entity_type = 'estimation_job' and p.entity_id = j.id and p.status = 'pending')
              and not exists (select 1 from public.approvals q where q.entity_type = 'estimation_job' and q.entity_id = j.id
                              and q.kind = 'quotation_release' and q.status in ('rejected', 'returned') and q.decided_at > a.decided_at) loop
    perform app.quotation_send_back(r.id, r.inquiry_id, r.comment, true);
  end loop;
end $$;
