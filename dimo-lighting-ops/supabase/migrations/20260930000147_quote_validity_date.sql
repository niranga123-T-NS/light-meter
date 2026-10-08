-- Quotation validity: a number of days (as before) or a fixed "valid until" date entered by the estimator.
-- When a date is given the released quotation is valid until that date; otherwise until today + the days.

alter table public.estimation_jobs add column if not exists validity_until date;

create or replace function public.set_quote_validity(p_job uuid, p_until date) returns void
language plpgsql security definer set search_path = public as $$
declare j public.estimation_jobs := app.est_job(p_job);
begin
  perform app.require(j.assignee_id = auth.uid() or app.has_role('sm_estimation'), 'Only the assigned estimator can edit the estimate');
  perform app.require(j.status in ('assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested'), 'The estimate is locked in its current status');
  perform app.require(p_until is null or p_until >= (now() at time zone app.tz())::date, 'The validity date cannot be in the past');
  perform set_config('app.saving_estimate', '1', true);
  update public.estimation_jobs set validity_until = p_until where id = j.id;
end $$;
revoke execute on function public.set_quote_validity(uuid, date) from public, anon;
grant execute on function public.set_quote_validity(uuid, date) to authenticated, service_role;

create or replace function public.release_quotation(p_job uuid, p_justification text default null,
  p_no_compliance_reason text default null, p_no_datasheets_reason text default null) returns uuid
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
  perform app.require(app.job_has_doc(j.id, 'compliance_sheet') or coalesce(trim(p_no_compliance_reason), '') <> '',
    'Upload the compliance sheet, or mark it not applicable with a reason');
  perform app.require(app.job_has_doc(j.id, 'technical_data') or coalesce(trim(p_no_datasheets_reason), '') <> '',
    'Upload the technical data sheets, or mark them not applicable with a reason');
  perform app.require(coalesce(trim(p_no_compliance_reason), '') = '' and coalesce(trim(p_no_datasheets_reason), '') = ''
                      or app.has_role('sm_estimation', 'gm'), 'Only SM Estimation can release without the compliance sheet or data sheets');
  if not app.brands_match_expectation(j.brands_offered, i.solution_level, i.manufacturing_origin) then
    perform app.require(coalesce(trim(p_justification), '') <> '', 'Brands do not match the client expectation: give a justification');
  end if;

  -- Quotation number is kept across revisions: QTN-YYYY-NNNNN-Rn
  select quotation_no into qno from public.quotations where inquiry_id = i.id order by released_at limit 1;
  qno := coalesce(qno, app.next_code('QTN'));
  perform app.require(j.validity_until is null or j.validity_until >= (now() at time zone app.tz())::date,
    'The quotation validity date has passed – the estimator sets a new date');
  validity := coalesce(j.validity_until, (now() at time zone app.tz())::date + j.validity_days);
  insert into public.quotations (inquiry_id, estimation_job_id, quotation_no, revision, quoted_value, currency, brands_offered, validity_date)
  values (i.id, j.id, qno, i.revision, j.quoted_value, i.currency, j.brands_offered, validity)
  returning id into qid;
  update public.estimation_jobs set status = 'released', released_at = now(), quotation_no = qno, brand_justification = p_justification,
    docs_not_applicable = jsonb_strip_nulls(jsonb_build_object(
      'compliance_sheet', case when not app.job_has_doc(j.id, 'compliance_sheet') then nullif(trim(p_no_compliance_reason), '') end,
      'technical_data', case when not app.job_has_doc(j.id, 'technical_data') then nullif(trim(p_no_datasheets_reason), '') end))
  where id = j.id;
  update public.quotations set docs_note = nullif(concat_ws(' · ',
      case when not app.job_has_doc(j.id, 'compliance_sheet') then 'No compliance sheet: ' || trim(p_no_compliance_reason) end,
      case when not app.job_has_doc(j.id, 'technical_data') then 'No data sheets: ' || trim(p_no_datasheets_reason) end), '')
   where id = qid;
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
