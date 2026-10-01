-- Brands offered: required when the estimator submits; SM Estimation can still enter / correct them on an approved
-- quotation before release (they are checked at release against the client expectation).

create or replace function public.set_estimate_brands(p_job uuid, p_brands jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare j public.estimation_jobs := app.est_job(p_job);
begin
  perform app.require(app.has_role('sm_estimation', 'gm'), 'Only SM Estimation edits the brands after approval');
  perform app.require(j.status in ('submitted_for_approval', 'sm_projects_approval', 'gm_approval', 'approved'), 'The quotation is not waiting for release');
  perform app.require(jsonb_typeof(p_brands) = 'array' and jsonb_array_length(p_brands) > 0, 'Enter at least one brand');
  update public.estimation_jobs set brands_offered = p_brands where id = j.id;
  perform app.log_status('estimation_job', j.id, j.inquiry_id, j.status, j.status, 'Brands offered updated by ' || app.display_name(auth.uid()));
end $$;
revoke execute on function public.set_estimate_brands(uuid, jsonb) from public, anon;
grant execute on function public.set_estimate_brands(uuid, jsonb) to authenticated, service_role;

create or replace function public.submit_estimate_for_approval(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j public.estimation_jobs := app.est_job(p_job); code text;
begin
  perform app.require(j.assignee_id = auth.uid(), 'Only the assigned estimator can submit');
  perform app.require(j.status in ('in_progress', 'acknowledged', 'returned', 'assigned'), 'Estimate is not in progress');
  perform app.require(j.quoted_value is not null, 'Enter the quoted value');
  perform app.require(jsonb_array_length(coalesce(j.brands_offered, '[]')) > 0, 'Enter the brands and origin offered for each main product group');
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
