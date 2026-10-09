-- Inquiry change requests: a duty change must name the new duty status (and a release-mode change the new mode) when it is
-- requested – an empty one could be sent and then failed on approval ("invalid input value for enum duty_status").

create or replace function public.request_inquiry_change(p_inquiry uuid, p_kind text, p_payload jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); steps public.app_role[];
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person can request changes');
  perform app.require(coalesce(trim(p_reason), '') <> '', 'A reason is required');
  case p_kind
    when 'duty_change' then
      perform app.require(coalesce(p_payload ->> 'duty_status', '') in ('duty_free', 'duty_paid'), 'Choose the new duty status');
      perform app.require((p_payload ->> 'duty_status')::public.duty_status is distinct from i.duty_status, 'The inquiry already has this duty status');
      steps := array['sm_projects'];
    when 'release_mode' then
      perform app.require(coalesce(p_payload ->> 'release_mode', '') in ('1', '2', '3'), 'Choose the new release mode');
      steps := array['sm_projects'];
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
      update public.inquiries set release_mode = coalesce(case when a.payload ->> 'release_mode' in ('1', '2', '3') then (a.payload ->> 'release_mode')::int end, release_mode),
        release_mode_confirmed = true where id = a.inquiry_id;
    end if;
  when 'duty_change' then
    if approved then
      perform app.require(coalesce(a.payload ->> 'duty_status', '') in ('duty_free', 'duty_paid'),
        'This request does not say which duty status to change to – return it to the sales person (or reject it) and ask for a new request');
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
  when 'warranty_goodwill' then
    update public.warranty_claims set goodwill_status = case when approved then 'approved' else 'rejected' end,
      decision = case when approved then decision else 'chargeable' end
     where id = a.entity_id and goodwill_status = 'pending';
    insert into public.warranty_log (warranty_id, claim_id, kind, note)
    select c.warranty_id, c.id, 'goodwill_' || a.status,
           case when approved then 'Goodwill cover approved by SM Projects' else 'Goodwill cover not approved – chargeable' end || coalesce(' · ' || p_comment, '')
      from public.warranty_claims c where c.id = a.entity_id;
    perform app.notify_many(
      (select array[w.owner_id, c.reported_by] from public.warranty_claims c join public.warranties w on w.id = c.warranty_id where c.id = a.entity_id)
        || app.role_users('operations_exec', 'senior_elec_engineer'),
      'warranty_goodwill', case when approved then 'Goodwill warranty cover approved' else 'Goodwill cover not approved – claim is chargeable' end,
      coalesce(a.title, '') || coalesce(' · ' || p_comment, ''), 'normal', 'warranty_claim', a.entity_id, app.claim_url(a.entity_id));
  else
    null;
  end case;
end $$;
