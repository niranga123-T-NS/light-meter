-- GM / DGM can act for the sales person on an inquiry they raised on the sales person's behalf
-- (record submission, client response, deadline extension), matching submit_inquiry.

create or replace function public.record_client_submission(p_inquiry uuid, p_date date default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); d date := coalesce(p_date, (now() at time zone app.tz())::date);
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person records the submission');
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
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person records the client response');
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

create or replace function public.extend_customer_deadline(p_inquiry uuid, p_new_deadline date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry);
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person can extend the deadline');
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
