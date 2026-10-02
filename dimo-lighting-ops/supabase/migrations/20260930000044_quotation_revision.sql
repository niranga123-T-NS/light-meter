-- Client asks for a revised quotation: the sales person sends it to the Estimation Manager (SM Estimation) with the client's
-- comments. A new estimate revision (R1, R2 …) is created and waits for SM Estimation to assign it; the brands and
-- notes of the last submitted quotation are carried over. The Estimation Manager and the estimator assigned to the
-- revision can see the previously submitted quotation and all its files (quotation, compliance sheet, data sheets, costing).

alter table public.estimation_jobs add column if not exists previous_job_id uuid references public.estimation_jobs (id);
alter table public.estimation_jobs add column if not exists revision_request text;

-- Estimators assigned to a later revision of the same inquiry may read the earlier estimates (and so their files / costing)
create or replace function app.can_read_estimation_job(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); j record;
begin
  if r in ('gm', 'sm_estimation') then return true; end if;
  select assignee_id, inquiry_id, revision into j from public.estimation_jobs where id = p_id;
  if r in ('am_estimation', 'estimation_exec') then
    return j.assignee_id = auth.uid()
        or exists (select 1 from public.estimation_jobs e where e.inquiry_id = j.inquiry_id and e.revision > j.revision and e.assignee_id = auth.uid());
  end if;
  return false;
end $$;

create or replace function public.request_quotation_revision(p_inquiry uuid, p_comments text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  prev public.estimation_jobs;
  jid uuid;
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person requests a revised quotation');
  perform app.require(coalesce(trim(p_comments), '') <> '', 'Enter what the client wants changed');
  perform app.require(i.status in ('quotation_released', 'submitted_to_client', 'awaiting_client_approval', 'client_approved'),
    'A revised quotation can be requested only after the quotation was released');
  select * into prev from public.estimation_jobs where inquiry_id = i.id and status = 'released' order by revision desc, released_at desc limit 1;
  perform app.require(prev.id is not null, 'There is no released quotation to revise');
  perform app.require(not exists (select 1 from public.estimation_jobs where inquiry_id = i.id and status <> 'released'),
    'A revision is already in progress for this inquiry');

  perform set_config('app.workflow', '1', true);
  update public.inquiries set revision = revision + 1, client_response = null where id = i.id;
  insert into public.estimation_jobs (inquiry_id, revision, source, status, previous_job_id, revision_request,
    brands_offered, alternatives, validity_days, design_version_used)
  values (i.id, i.revision + 1, prev.source, 'accepted', prev.id, trim(p_comments),
    prev.brands_offered, prev.alternatives, prev.validity_days, prev.design_version_used)
  returning id into jid;
  perform app.stop_clocks('inquiry', i.id, 'sales_submission');
  perform app.set_inquiry_status(i.id, 'in_estimation', format('Client requested a revised quotation (R%s): %s', i.revision + 1, trim(p_comments)));
  perform app.log_status('estimation_job', jid, i.id, null, 'accepted', 'Revised quotation requested: ' || trim(p_comments));
  perform app.start_clock(i.id, 'estimation_job', jid, 'assignment', (app.role_users('sm_estimation'))[1], null, 'Assign revised quotation');
  perform app.notify_many(app.role_users('sm_estimation'), 'quotation_revision',
    format('Revised quotation requested: %s-R%s', i.code, i.revision + 1),
    format('%s – %s · last quotation %s by %s · %s', i.project_name, i.customer_name, app.fmt_money(prev.quoted_value, i.currency),
           coalesce(app.display_name(prev.assignee_id), '—'), trim(p_comments)),
    'normal', 'estimation_job', jid, '/estimation/' || jid, null, true);
  perform app.refresh_inquiry(i.id);
  return jid;
end $$;
revoke execute on function public.request_quotation_revision(uuid, text) from public, anon;
grant execute on function public.request_quotation_revision(uuid, text) to authenticated, service_role;
