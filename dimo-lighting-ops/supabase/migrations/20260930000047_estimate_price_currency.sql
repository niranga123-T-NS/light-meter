-- Each estimate records the currency its figures were priced in. After a duty change the old figures stay in their own
-- currency (e.g. LKR for a duty-paid offer) and the estimate must be re-priced in the new currency before it is submitted.

alter table public.estimation_jobs add column if not exists price_currency public.currency;
update public.estimation_jobs e set price_currency = coalesce(
    (select q.currency from public.quotations q where q.estimation_job_id = e.id order by q.released_at desc limit 1),
    (select i.currency from public.inquiries i where i.id = e.inquiry_id))
  where e.price_currency is null and e.quoted_value is not null;

-- Saving the estimate stamps the inquiry's current currency on the figures
create or replace function app.estimation_jobs_price_currency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.quoted_value is distinct from old.quoted_value or (new.quoted_value is not null and old.price_currency is null)
     or current_setting('app.saving_estimate', true) = '1' then
    new.price_currency := (select currency from public.inquiries where id = new.inquiry_id);
  end if;
  return new;
end $$;
drop trigger if exists estimation_jobs_price_currency on public.estimation_jobs;
create trigger estimation_jobs_price_currency before update of quoted_value on public.estimation_jobs
for each row execute function app.estimation_jobs_price_currency();

create or replace function public.save_estimate(
  p_job uuid, p_quoted_value numeric, p_cost numeric, p_margin_pct numeric, p_brands jsonb,
  p_validity_days int default 30, p_alternatives text default null, p_supplier_waits jsonb default null, p_design_version text default null
) returns void language plpgsql security definer set search_path = public as $$
declare j public.estimation_jobs := app.est_job(p_job);
begin
  perform app.require(j.assignee_id = auth.uid() or app.has_role('sm_estimation'), 'Only the assigned estimator can edit the estimate');
  perform app.require(j.status in ('assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested'), 'The estimate is locked in its current status');
  if j.status = 'assigned' then perform app.stop_clocks('estimation_job', j.id, 'ack'); end if;
  perform set_config('app.saving_estimate', '1', true);
  update public.estimation_jobs set quoted_value = p_quoted_value, brands_offered = coalesce(p_brands, brands_offered),
    validity_days = coalesce(p_validity_days, 30), alternatives = p_alternatives,
    supplier_waits = coalesce(p_supplier_waits, supplier_waits), design_version_used = coalesce(p_design_version, design_version_used),
    status = case when status in ('assigned', 'returned') then 'in_progress' else status end
  where id = j.id;
  insert into public.estimation_costing (estimation_job_id, cost, margin_pct) values (j.id, p_cost, p_margin_pct)
  on conflict (estimation_job_id) do update set cost = excluded.cost, margin_pct = excluded.margin_pct, updated_at = now();
end $$;

create or replace function public.submit_estimate_for_approval(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j public.estimation_jobs := app.est_job(p_job); code text;
begin
  perform app.require(j.assignee_id = auth.uid(), 'Only the assigned estimator can submit');
  perform app.require(j.status in ('in_progress', 'acknowledged', 'returned', 'assigned'), 'Estimate is not in progress');
  perform app.require(j.quoted_value is not null, 'Enter the quoted value');
  perform app.require(j.price_currency is null or j.price_currency = (select currency from public.inquiries where id = j.inquiry_id),
    format('The duty status changed – re-price the estimate in %s and save it before submitting',
           (select currency from public.inquiries where id = j.inquiry_id)));
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
