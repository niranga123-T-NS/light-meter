-- Fix: an estimator's hold request failed with 'column reference "code" is ambiguous' (the variable had the column's name); same function, variable renamed
create or replace function public.hold_job(p_entity_type text, p_job uuid, p_reason text, p_waiting_on text default null)
returns void language plpgsql security definer set search_path = public as $$
declare inq uuid; sp uuid; v_code text; who uuid; task text;
begin
  perform app.require(coalesce(trim(p_reason), '') <> '', 'Hold reason is required');
  if p_entity_type = 'design_job' then
    perform app.require(app.has_role('design_manager', 'gm') or exists (select 1 from public.design_jobs where id = p_job and assignee_id = auth.uid()),
      'Not allowed');
    perform app.require(coalesce(trim(p_waiting_on), '') <> '', 'Say who you are waiting on');
    update public.design_jobs set status_before_hold = status, status = 'on_hold', hold_reason = p_reason, hold_waiting_on = p_waiting_on
      where id = p_job and status <> 'on_hold' returning inquiry_id, assignee_id, task_type into inq, who, task;
    perform app.require(inq is not null, 'This job is already on hold');
    perform app.pause_clocks('design_job', p_job, p_reason);
  else
    -- Estimation holds need SM Estimation approval (7.3)
    select inquiry_id into inq from public.estimation_jobs where id = p_job;
    if app.has_role('sm_estimation', 'gm') then
      update public.estimation_jobs set status_before_hold = status, status = 'on_hold', hold_reason = p_reason where id = p_job;
      perform app.pause_clocks('estimation_job', p_job, p_reason);
    else
      perform app.require(exists (select 1 from public.estimation_jobs where id = p_job and assignee_id = auth.uid()), 'Not allowed');
      perform app.create_approval('estimation_hold', 'estimation_job', p_job, inq, 'Estimation hold – ' ||
        (select i.code from public.inquiries i where i.id = inq), p_reason, array['sm_estimation']::public.app_role[]);
      return;
    end if;
  end if;
  perform app.log_status(p_entity_type, p_job, inq, null, 'on_hold', p_reason);
  select i.sales_person_id, i.code into sp, v_code from public.inquiries i where i.id = inq;
  if p_entity_type = 'design_job' then
    perform app.notify_many(array(select x from unnest(app.role_users('design_manager') || sp) x where x is distinct from auth.uid()),
      'design_on_hold', 'Design on hold: ' || v_code,
      format('%s (%s design) · %s · waiting on %s', app.display_name(who), task, p_reason, p_waiting_on),
      'normal', 'design_job', p_job, '/design/' || p_job);
  else
    perform app.notify_many(array[sp] || app.role_users('sm_projects'), 'job_on_hold', 'On hold: ' || v_code, p_reason,
      'normal', 'inquiry', inq, app.inquiry_url(inq));
  end if;
  perform app.refresh_inquiry(inq);
end $$;
