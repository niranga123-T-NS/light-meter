-- Returned design / quotation: the manager returning it (Design Manager / SM Estimation) sets the new due date for the
-- revision – never later than the deadline committed to the customer (end of the customer-deadline day). If that date
-- has already passed, sales must first agree a revised deadline with the customer.

create or replace function app.revision_due(p_inquiry uuid, p_due date) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare cd date := (select customer_deadline from public.inquiries where id = p_inquiry); due timestamptz;
begin
  perform app.require(p_due is not null, 'Set the new due date for the revision');
  due := (p_due + app.work_end()) at time zone app.tz();
  perform app.require(due > now(), 'The new due date must be in the future');
  perform app.require(cd is null or cd >= (now() at time zone app.tz())::date,
    format('The customer deadline (%s) has passed – sales must agree a revised deadline with the customer first', to_char(cd, 'DD Mon YYYY')));
  perform app.require(cd is null or p_due <= cd, format('The revision must be due by the customer deadline (%s)', to_char(cd, 'DD Mon YYYY')));
  return due;
end $$;

drop function if exists public.review_design(uuid, boolean, text);
drop function if exists public.review_estimate(uuid, boolean, text);

-- Copied from 20260930000032_design_rev_numbers.sql with the revision due date
create or replace function public.review_design(p_job uuid, p_approve boolean, p_comment text default null, p_due date default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.design_jobs := app.design_job(p_job); code text; due timestamptz;
begin
  perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager reviews designs');
  perform app.require(j.status = 'in_review', 'Job is not in review');
  perform app.stop_clocks('design_job', j.id, 'design_review');
  select i.code into code from public.inquiries i where id = j.inquiry_id;
  if p_approve then
    update public.design_jobs set status = 'approved', approved_at = now(), review_comment = p_comment where id = j.id;
    perform app.log_status('design_job', j.id, j.inquiry_id, 'in_review', 'approved', concat_ws(' · ', 'Design Rev ' || j.review_cycles, p_comment));
    if not exists (select 1 from public.design_jobs where inquiry_id = j.inquiry_id and revision = j.revision and status not in ('approved', 'released')) then
      perform app.set_inquiry_status(j.inquiry_id, 'design_approved');
    end if;
    perform app.notify(j.assignee_id, 'design_approved', format('Design approved: %s · Rev %s', code, j.review_cycles), coalesce(p_comment, ''), 'normal', 'design_job', j.id, '/design/' || j.id);
  else
    perform app.require(coalesce(trim(p_comment), '') <> '', 'Give review comments when returning');
    due := app.revision_due(j.inquiry_id, p_due);
    update public.design_jobs set status = 'returned', review_cycles = review_cycles + 1, review_comment = p_comment, due_at = due where id = j.id;
    perform app.log_status('design_job', j.id, j.inquiry_id, 'in_review', 'returned', format('Design Rev %s returned · next Rev %s · %s', j.review_cycles, j.review_cycles + 1, p_comment));
    perform app.start_clock(j.inquiry_id, 'design_job', j.id, 'design', j.assignee_id, due, 'Design (returned)');
    perform app.set_inquiry_status(j.inquiry_id, 'in_design', 'Returned by Design Manager');
    perform app.notify(j.assignee_id, 'design_returned', format('Design returned for changes: %s · prepare Rev %s by %s', code, j.review_cycles + 1, to_char(due at time zone app.tz(), 'DD Mon HH24:MI')), p_comment, 'normal', 'design_job', j.id, '/design/' || j.id);
  end if;
  perform app.refresh_inquiry(j.inquiry_id);
end $$;

-- Copied from 20260930000031_quotation_gm_step.sql with the revision due date
create or replace function public.review_estimate(p_job uuid, p_approve boolean, p_comment text default null, p_due date default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  j public.estimation_jobs := app.est_job(p_job);
  i public.inquiries := app.inq(j.inquiry_id);
  margin numeric;
  value_lkr numeric;
  rate numeric;
  gm_needed boolean;
  smp_needed boolean;
  due timestamptz;
begin
  perform app.require(app.has_role('sm_estimation', 'gm'), 'Only SM Estimation approves quotations');
  perform app.require(j.status = 'submitted_for_approval', 'Quotation is not waiting for approval');
  perform app.stop_clocks('estimation_job', j.id, 'quotation_approval');
  if not p_approve then
    perform app.require(coalesce(trim(p_comment), '') <> '', 'Give comments when returning');
    due := app.revision_due(i.id, p_due);
    update public.estimation_jobs set status = 'returned', review_comment = p_comment, due_at = due where id = j.id;
    perform app.start_clock(i.id, 'estimation_job', j.id, 'estimation', j.assignee_id, due, 'Estimation (returned)');
    perform app.set_inquiry_status(i.id, 'in_estimation', 'Returned by SM Estimation');
    perform app.log_status('estimation_job', j.id, i.id, j.status, 'returned', p_comment);
    perform app.notify(j.assignee_id, 'quotation_returned', 'Quotation returned: ' || i.code, concat_ws(' · ', p_comment, 'revise by ' || to_char(due at time zone app.tz(), 'DD Mon HH24:MI')), 'normal', 'estimation_job', j.id, '/estimation/' || j.id);
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

revoke execute on function public.review_design(uuid, boolean, text, date), public.review_estimate(uuid, boolean, text, date) from public, anon;
grant execute on function public.review_design(uuid, boolean, text, date), public.review_estimate(uuid, boolean, text, date) to authenticated;
