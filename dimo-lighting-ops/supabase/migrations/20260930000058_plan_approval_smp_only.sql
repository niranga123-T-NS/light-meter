-- Weekly visit plans are approved by SM Projects only: GM / DGM no longer see submitted plans in Approvals
-- and cannot approve or return them (they can still open and view any plan).

create or replace function public.my_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
  select 'approval', a.id, a.kind::text, a.title, a.reason, a.requested_by, app.display_name(a.requested_by), a.requested_at,
         a.inquiry_id, case when a.inquiry_id is not null then app.inquiry_url(a.inquiry_id) else '/approvals' end,
         format('Step %s of %s', a.current_step, (select count(*) from public.approval_steps x where x.approval_id = a.id))
  from public.approvals a
  join public.approval_steps s on s.approval_id = a.id and s.step_no = a.current_step
  where a.status = 'pending' and (s.approver_role = app.my_role() or (app.my_role() = 'gm' and s.approver_role = 'gm'))
  union all
  select 'visit_plan', p.id, 'weekly_plan', format('Weekly plan – %s – week of %s', app.display_name(p.sales_person_id), to_char(p.week_start, 'DD Mon')),
         case when p.is_late then 'Submitted late' end, p.sales_person_id, app.display_name(p.sales_person_id), p.submitted_at,
         null, '/plan/' || p.id, null
  from public.visit_plans p where p.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'design_review', d.id, 'design_release', format('Design review – %s (%s)', i.code, d.task_type), i.project_name,
         d.assignee_id, app.display_name(d.assignee_id), d.submitted_at, i.id, '/design/' || d.id, null
  from public.design_jobs d join public.inquiries i on i.id = d.inquiry_id
  where d.status = 'in_review' and app.has_role('design_manager')
  union all
  select 'quotation_review', e.id, 'quotation_release', format('Quotation approval – %s', i.code), i.project_name,
         e.assignee_id, app.display_name(e.assignee_id), e.submitted_at, i.id, '/estimation/' || e.id, null
  from public.estimation_jobs e join public.inquiries i on i.id = e.inquiry_id
  where e.status = 'submitted_for_approval' and app.has_role('sm_estimation')
  union all
  select 'sample', sm.id, 'sample_request', format('Sample request %s', sm.code), sm.purpose,
         sm.sales_person_id, app.display_name(sm.sales_person_id), sm.submitted_at, null, '/samples/' || sm.id, sm.status
  from public.samples sm
  where (sm.status = 'submitted' and app.has_role('operations_exec'))
     or (sm.status = 'availability_confirmed' and app.has_role('sm_projects'))
     or (sm.status = 'gm_approval' and app.has_role('gm'))
  order by 8
$$;

create or replace function public.decide_visit_plan(p_plan uuid, p_decision text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.visit_plans;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects approves weekly plans');
  select * into p from public.visit_plans where id = p_plan for update;
  perform app.require(p.status = 'submitted', 'Plan is not waiting for approval');
  perform app.require(p_decision in ('approved', 'returned'), 'Invalid decision');
  perform app.require(p_decision = 'approved' or coalesce(trim(p_comment), '') <> '', 'Give a reason when returning the plan');
  perform set_config('app.workflow', '1', true);
  update public.visit_plans set status = p_decision, approved_by = auth.uid(), approved_at = now(), manager_comment = p_comment where id = p.id;
  perform app.notify(p.sales_person_id, 'plan_' || p_decision,
    case when p_decision = 'approved' then 'Weekly plan approved' else 'Weekly plan returned – resubmit today' end,
    coalesce(p_comment, ''), 'normal', 'visit_plan', p.id, '/plan/' || p.id);
end $$;
