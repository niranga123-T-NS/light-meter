-- The sales person discards an inquiry they raised: no approval, but the reason is required and recorded (who, when, why).
-- The inquiry closes as cancelled at whatever stage it is; pending approvals are cancelled, clocks stop, queued estimation jobs that
-- nobody picked up are removed, and the designers / estimators already working on it, their managers and SM Projects are told.

alter table public.inquiries add column if not exists discard_reason text;
alter table public.inquiries add column if not exists discarded_at timestamptz;
alter table public.inquiries add column if not exists discarded_by uuid references public.profiles (id);

create or replace function public.discard_inquiry(p_inquiry uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); why text := btrim(coalesce(p_reason, '')); people uuid[]; j record;
begin
  perform app.require(i.id is not null, 'Inquiry not found');
  perform app.require(i.sales_person_id = auth.uid(), 'Only the sales person who raised the inquiry can discard it');
  perform app.require(i.status not in ('won', 'lost', 'cancelled', 'rejected'), 'This inquiry is already closed');
  perform app.require(length(why) >= 10, 'Give the reason for discarding (at least 10 characters)');
  perform app.require(length(why) <= 500, 'Keep the reason under 500 characters');
  -- who should know: everyone working on it now, their managers once work has started, and SM Projects
  people := array(select distinct x from unnest(
      array(select assignee_id from public.design_jobs where inquiry_id = i.id and status not in ('approved', 'released') and assignee_id is not null)
      || array(select assignee_id from public.estimation_jobs where inquiry_id = i.id and status not in ('approved', 'released') and assignee_id is not null)
      || case when i.status <> 'draft' then app.role_users('sm_projects') else '{}'::uuid[] end
      || case when i.status not in ('draft', 'submitted') then app.role_users('design_manager') || app.role_users('sm_estimation') else '{}'::uuid[] end) x
    where x is not null and x <> auth.uid());
  update public.approvals set status = 'cancelled', decided_at = now() where inquiry_id = i.id and status = 'pending';
  perform app.stop_clocks('inquiry', i.id);
  for j in select id from public.design_jobs where inquiry_id = i.id and status not in ('approved', 'released') loop perform app.stop_clocks('design_job', j.id); end loop;
  for j in select id from public.estimation_jobs where inquiry_id = i.id and status not in ('approved', 'released') loop perform app.stop_clocks('estimation_job', j.id); end loop;
  delete from public.estimation_jobs where inquiry_id = i.id and status = 'queued' and assignee_id is null;
  perform set_config('app.workflow', '1', true);
  update public.inquiries set result = 'cancelled', lost_reason = 'Discarded: ' || why, discard_reason = why, discarded_at = now(), discarded_by = auth.uid()
   where id = i.id;
  perform app.set_inquiry_status(i.id, 'cancelled', 'Discarded by the sales person: ' || why);
  perform set_config('app.reason', 'Inquiry ' || i.code || ' discarded: ' || why, true);
  if cardinality(people) > 0 then
    perform app.notify_many(people, 'inquiry', 'Inquiry discarded by sales', format('%s · %s – stop work on it. Reason: %s', i.code, coalesce(i.inquiry_name, i.project_name), why),
      'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  end if;
  perform app.sync_project_pct(i.project_id);
  perform app.refresh_inquiry(i.id);
end $$;
revoke all on function public.discard_inquiry(uuid, text) from public, anon;
grant execute on function public.discard_inquiry(uuid, text) to authenticated;

select app.fix_function_owners();
