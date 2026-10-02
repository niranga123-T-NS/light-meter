-- Same project, several main contractors (e.g. contractors bidding for one tender).
--  * "Quote to another contractor": a released quotation is copied into a linked inquiry for another contractor. The
--    estimate is reused (no new design / estimation): SM Estimation uploads the quotation addressed to the new
--    contractor and releases it with its own quotation number. Compliance and data sheets of the source estimate count.
--  * Inquiries of one tender share tender_group_id; the project value / quoted value is counted once per tender.
--  * When one contractor's result is recorded, the other contractors' quotes can be closed in one step – as cancelled
--    (same tender), so the tender counts once in the win rate.
--  * An inquiry's customer name is the inquiry's own customer (the contractor), no longer always the project's customer.

alter table public.inquiries add column if not exists tender_group_id uuid;
alter table public.inquiries add column if not exists copied_from_inquiry_id uuid references public.inquiries (id);
alter table public.estimation_jobs add column if not exists copied_from_job_id uuid references public.estimation_jobs (id);
create index if not exists inquiries_tender_group on public.inquiries (tender_group_id) where tender_group_id is not null;

-- Customer name snapshot: the inquiry's own customer
create or replace function app.inquiries_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.code := coalesce(new.code, app.next_code('INQ'));
    if auth.uid() is not null and app.is_sales_person() then new.sales_person_id := auth.uid(); end if;
    if auth.uid() is not null then new.status := 'draft'; end if;
    -- Raised by SM Projects / GM on behalf of the project's sales person
    if auth.uid() is not null and not app.is_sales_person() then
      new.sales_person_id := (select owner_id from public.projects where id = new.project_id);
    end if;
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and current_setting('app.workflow', true) is distinct from '1'
     and (new.status, new.revision, new.release_mode_confirmed, new.mixed_duty_approved, new.current_owner_id, new.result)
         is distinct from (old.status, old.revision, old.release_mode_confirmed, old.mixed_duty_approved, old.current_owner_id, old.result) then
    raise exception 'Workflow fields change only through workflow actions';
  end if;
  select p.name, coalesce((select o2.name from public.organizations o2 where o2.id = new.organization_id), o.name), p.project_type
    into new.project_name, new.customer_name, new.project_type
  from public.projects p join public.organizations o on o.id = p.organization_id where p.id = new.project_id;
  if new.route = 'C' then new.release_mode := coalesce(new.release_mode, 1); end if;
  if new.route = 'B' then new.release_mode := coalesce(new.release_mode, 2); end if;
  if new.route = 'A' then new.release_mode := coalesce(new.release_mode, 3); end if;
  -- After submission, sales cannot edit the request (5.2); changes go through revision requests.
  if tg_op = 'UPDATE' and old.status not in ('draft', 'returned_for_info') and auth.uid() is not null
     and current_setting('app.workflow', true) is distinct from '1' then
    raise exception 'This inquiry has been submitted. Use a revision request to change it.';
  end if;
  new.updated_at := now();
  return new;
end $$;
update public.inquiries i set customer_name = o.name from public.organizations o
 where o.id = i.organization_id and i.customer_name is distinct from o.name;

-- A document on the estimate, or on the estimate it was copied from
create or replace function app.job_has_doc(p_job uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_attachment('estimation_job', p_job, p_kind)
      or exists (select 1 from public.estimation_jobs j where j.id = p_job and j.copied_from_job_id is not null
                 and app.has_attachment('estimation_job', j.copied_from_job_id, p_kind))
$$;

-- ---------------------------------------------------------------------------
-- Quote to another contractor
-- ---------------------------------------------------------------------------
create or replace function public.copy_quotation_to_contractor(
  p_inquiry uuid, p_organization uuid, p_unit uuid default null, p_contact uuid default null,
  p_deadline date default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  src public.inquiries := app.inq(p_inquiry);
  sj public.estimation_jobs;
  grp uuid;
  nid uuid;
  jid uuid;
  org_name text;
  bad_debt record;
  sme uuid := (app.role_users('sm_estimation'))[1];
begin
  perform app.require(src.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person (or SM Projects / GM) quotes another contractor');
  perform app.require(src.status in ('quotation_released', 'returned_to_sales', 'submitted_to_client', 'awaiting_client_approval', 'client_approved'),
    'Release the quotation first – then it can be copied to another contractor');
  select * into sj from public.estimation_jobs where inquiry_id = src.id and status = 'released' order by revision desc, released_at desc limit 1;
  perform app.require(sj.id is not null, 'There is no released quotation to copy');
  select name into org_name from public.organizations where id = p_organization and merged_into is null;
  perform app.require(org_name is not null, 'Choose the contractor');
  grp := coalesce(src.tender_group_id, src.id);
  perform app.require(not exists (select 1 from public.inquiries where (tender_group_id = grp or id = grp) and organization_id = p_organization
                                  and status not in ('cancelled', 'rejected')),
    format('%s already has a quotation for this tender', org_name));
  perform app.require(not exists (select 1 from public.org_units where organization_id = p_organization) or p_unit is not null,
    'Select the unit / department of the contractor');
  perform app.require(p_deadline is null or p_deadline >= (now() at time zone app.tz())::date, 'The deadline cannot be in the past');

  perform set_config('app.workflow', '1', true);
  if src.tender_group_id is null then update public.inquiries set tender_group_id = grp where id = src.id; end if;

  insert into public.inquiries (project_id, sales_person_id, organization_id, unit_id, contact_id, consultant_organization_id, route,
    release_mode, release_mode_confirmed, duty_status, mixed_duty_approved, priority, submission_type, customer_deadline, scope_description,
    budget_lkr, approved_makes, preferred_brands, areas, checklist, solution_level, manufacturing_origin, expectation_notes,
    estimation_scope, estimation_basis, tender_group_id, copied_from_inquiry_id, submitted_at)
  values (src.project_id, src.sales_person_id, p_organization, p_unit, p_contact, src.consultant_organization_id, 'B',
    2, true, src.duty_status, src.mixed_duty_approved, src.priority, src.submission_type,
    coalesce(p_deadline, greatest(src.customer_deadline, (now() at time zone app.tz())::date)),
    concat_ws(E'\n', format('Quotation for %s – copied from %s (%s).', org_name, src.code, src.customer_name), nullif(btrim(p_note), ''), src.scope_description),
    src.budget_lkr, src.approved_makes, src.preferred_brands, src.areas, src.checklist, src.solution_level, src.manufacturing_origin, src.expectation_notes,
    src.estimation_scope, src.estimation_basis, grp, src.id, now())
  returning id into nid;
  perform app.set_inquiry_status(nid, 'estimation_review', format('Copied from %s for %s', src.code, org_name));

  insert into public.estimation_jobs (inquiry_id, revision, source, status, assignee_id, value_band, quoted_value, validity_days, brands_offered,
    brand_justification, alternatives, design_version_used, approved_at, needs_sm_projects, copied_from_job_id, revision_request, price_currency,
    docs_not_applicable, assigned_at, submitted_at)
  values (nid, 0, 'direct', 'approved', sj.assignee_id, sj.value_band, sj.quoted_value, sj.validity_days, sj.brands_offered,
    sj.brand_justification, sj.alternatives, sj.design_version_used, now(), true, sj.id,
    format('Quotation to another contractor (%s) – same estimate as %s', org_name, coalesce(sj.quotation_no, src.code)),
    sj.price_currency, sj.docs_not_applicable, now(), now())
  returning id into jid;
  insert into public.estimation_costing (estimation_job_id, cost, margin_pct)
  select jid, cost, margin_pct from public.estimation_costing where estimation_job_id = sj.id;
  perform app.log_status('estimation_job', jid, nid, null, 'approved', 'Same estimate as ' || coalesce(sj.quotation_no, src.code));

  -- Debtor check on the new contractor (debts over 90 days or under Legal)
  select count(*) as n into bad_debt from public.debts d
   where d.organization_id = p_organization and (p_unit is null or d.unit_id is null or d.unit_id = p_unit)
     and d.status not in ('collected_confirmed', 'cleared') and (d.outstanding_days > 90 or d.is_legal);
  if bad_debt.n > 0 then
    update public.inquiries set debtor_flag = true, status_before_hold = 'estimation_review', hold_reason = 'Debtor check – contractor quotation' where id = nid;
    perform app.set_inquiry_status(nid, 'on_hold', 'Debtor check');
    perform app.create_approval('debtor_check', 'inquiry', nid, nid, format('Debtor check – %s', org_name),
      format('%s debts over 90 days or under Legal – quotation to another contractor', bad_debt.n), array['sm_projects']::public.app_role[]);
  else
    perform app.start_clock(nid, 'estimation_job', jid, 'assignment', sme, app.add_work_minutes(now(), app.working_minutes_per_day()),
      'Issue the quotation to the new contractor');
    perform app.notify_many(app.role_users('sm_estimation'), 'quotation_copy', 'Quotation to another contractor: ' || org_name,
      format('%s – same estimate as %s (%s). Upload the quotation addressed to %s and release it.', src.project_name,
             coalesce(sj.quotation_no, src.code), app.fmt_money(sj.quoted_value, src.currency), org_name),
      'normal', 'estimation_job', jid, '/estimation/' || jid, null, true);
  end if;
  perform app.refresh_inquiry(nid);
  return nid;
end $$;

-- ---------------------------------------------------------------------------
-- Close the other contractors' quotes of a tender once one result is recorded
-- ---------------------------------------------------------------------------
create or replace function public.close_tender_group_others(p_inquiry uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  o public.inquiries;
  reason text;
  n int := 0;
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Not allowed');
  perform app.require(i.tender_group_id is not null, 'This quotation is not part of a tender group');
  perform app.require(i.status in ('won', 'lost'), 'Record this quotation as won or lost first');
  reason := case when i.status = 'won' then format('Tender awarded to %s (%s)', i.customer_name, i.code)
                 else format('Same tender – result recorded on %s (%s)', i.code, i.customer_name) end;
  for o in select * from public.inquiries where tender_group_id = i.tender_group_id and id <> i.id
              and status not in ('won', 'lost', 'cancelled', 'rejected') loop
    perform app.stop_clocks('inquiry', o.id);
    perform app.stop_clocks('estimation_job', e.id) from public.estimation_jobs e where e.inquiry_id = o.id;
    perform app.stop_clocks('design_job', d.id) from public.design_jobs d where d.inquiry_id = o.id;
    update public.approvals set status = 'cancelled', decided_at = now() where inquiry_id = o.id and status = 'pending';
    perform set_config('app.workflow', '1', true);
    update public.inquiries set result = 'cancelled', lost_reason = reason where id = o.id;
    update public.quotations set result = 'lost', lost_reason = reason where inquiry_id = o.id and revision = o.revision;
    perform app.set_inquiry_status(o.id, 'cancelled', reason);
    perform app.refresh_inquiry(o.id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.copy_quotation_to_contractor(uuid, uuid, uuid, uuid, date, text), public.close_tender_group_others(uuid) from public, anon;
grant execute on function public.copy_quotation_to_contractor(uuid, uuid, uuid, uuid, date, text), public.close_tender_group_others(uuid) to authenticated, service_role;

-- Release: the compliance sheet / data sheets of the source estimate count for a copied quotation (copied from 20260930000042)
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
  validity := (now() at time zone app.tz())::date + j.validity_days;
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


-- Resume after a debtor check on a quotation copied to another contractor: SM Estimation releases it
create or replace function app.start_copy_release(p_inquiry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); j public.estimation_jobs;
begin
  select * into j from public.estimation_jobs where inquiry_id = i.id and status = 'approved' order by created_at desc limit 1;
  if j.id is null then return; end if;
  perform app.start_clock(i.id, 'estimation_job', j.id, 'assignment', (app.role_users('sm_estimation'))[1],
    app.add_work_minutes(now(), app.working_minutes_per_day()), 'Issue the quotation to the new contractor');
  perform app.notify_many(app.role_users('sm_estimation'), 'quotation_copy', 'Quotation to another contractor: ' || i.customer_name,
    format('%s – debtor check cleared. Upload the quotation addressed to %s and release it.', i.project_name, i.customer_name),
    'normal', 'estimation_job', j.id, '/estimation/' || j.id, null, true);
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
  elsif i.hold_reason = 'Debtor check – contractor quotation' then
    perform app.start_copy_release(i.id);
    perform app.refresh_inquiry(i.id);
  else
    perform app.resume_clocks('inquiry', i.id);
    perform app.resume_clocks('design_job', d.id) from public.design_jobs d where d.inquiry_id = i.id;
    perform app.resume_clocks('estimation_job', e.id) from public.estimation_jobs e where e.inquiry_id = i.id;
    perform app.refresh_inquiry(i.id);
  end if;
end $$;
