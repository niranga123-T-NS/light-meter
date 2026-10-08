-- Plan results: recorded from the daily reports (AE / supervisor) and checked – or entered – by the Senior Electrical
-- Engineer from the plan. Past activities without a result, or with a result the SEE has not checked, are flagged to
-- GM / DGM and SM Projects.

alter table public.exec_plan_items add column if not exists result_checked_by uuid references public.profiles (id);
alter table public.exec_plan_items add column if not exists result_checked_at timestamptz;

create or replace function public.update_plan_item(p_id uuid, p_status text, p_done_qty numeric default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare it public.exec_plan_items; pl public.exec_plans;
begin
  select * into it from public.exec_plan_items where id = p_id for update;
  perform app.require(it.id is not null, 'Item not found');
  perform app.require(it.supervisor_id = auth.uid() or app.is_project_ae(it.exec_project_id) or app.has_role('senior_elec_engineer'), 'Not your item');
  perform app.require(p_status in ('done', 'partial', 'not_done', 'planned'), 'Choose the result');
  if it.source = 'plan' then
    select * into pl from public.exec_plans where id = it.plan_id;
    perform app.require(pl.status = 'approved', 'The plan is not approved yet');
  else
    perform app.require(it.acceptance = 'accepted', 'Wait until an Assistant Engineer accepts the task');
  end if;
  perform app.require(it.day <= (now() at time zone app.tz())::date, 'You can record the result on the day or later');
  perform app.require(p_status in ('done', 'planned') or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.exec_plan_items set status = p_status, done_qty = p_done_qty, result_note = nullif(btrim(p_note), ''), updated_by = auth.uid(), updated_at = now(),
    -- the Senior Electrical Engineer checks the results reported from site, and a later change by the AE / supervisor needs checking again
    result_checked_by = case when app.has_role('senior_elec_engineer') then auth.uid() end,
    result_checked_at = case when app.has_role('senior_elec_engineer') then now() end
  where id = it.id;
  if it.activity_id is not null then perform app.auto_progress(it.activity_id); end if;
end $$;
