-- Route change through the client expectation / scope change request (Design Manager + SM Estimation approve):
--  * A → C (design only, no estimation): the open estimation job of the inquiry is removed with its clocks and
--    clarifications (it disappears from Estimation's queues and due lists), the inquiry becomes route C, release mode 1,
--    and when the design was already with Estimation it goes back to "design approved" for release to sales.
--    Refused when a quotation is already in approval or released (use a quotation revision instead).
--  * C → A (add estimation): route A, release mode 3; the estimate opens alongside the design (pre-estimate) once the
--    design date is approved.
-- Before this an approved expectation change never changed the route, so the estimate stayed due (INQ-2026-00052).

create or replace function app.apply_route_change(p_inquiry uuid, p_route text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); ids uuid[]; who uuid[];
begin
  if p_route is null or p_route = i.route then return; end if;
  perform set_config('app.workflow', '1', true);
  if p_route = 'C' then
    perform app.require(not exists (select 1 from public.estimation_jobs where inquiry_id = i.id and revision = i.revision
      and status in ('submitted_for_approval', 'gm_approval', 'sm_projects_approval', 'approved', 'released')),
      'A quotation is already in approval or released – it cannot be dropped by a route change');
    select coalesce(array_agg(id), '{}'), coalesce(array_agg(assignee_id) filter (where assignee_id is not null), '{}') into ids, who
      from public.estimation_jobs where inquiry_id = i.id and revision = i.revision;
    update public.estimation_jobs set previous_job_id = null where previous_job_id = any (ids);
    update public.estimation_jobs set copied_from_job_id = null where copied_from_job_id = any (ids);
    delete from public.clarifications where estimation_job_id = any (ids);
    delete from public.estimation_costing where estimation_job_id = any (ids);
    delete from public.sla_clocks where entity_type = 'estimation_job' and entity_id = any (ids);
    delete from public.approvals where entity_type = 'estimation_job' and entity_id = any (ids) and status = 'pending';
    delete from public.estimation_jobs where id = any (ids);
    update public.inquiries set route = 'C', release_mode = 1, release_mode_confirmed = true, estimation_due_at = null where id = i.id;
    if i.status in ('in_estimation', 'estimation_review') then
      perform app.set_inquiry_status(i.id, 'design_approved', 'Route changed to design only – release the design to sales');
    end if;
    perform app.log_status('inquiry', i.id, i.id, i.status, i.status, 'Route changed A → C (design only) – estimation removed');
    if array_length(ids, 1) > 0 then
      perform app.notify_many(who || app.role_users('sm_estimation'), 'estimation_cancelled', 'Estimation not needed: ' || i.code,
        format('%s – %s. The inquiry is now design only (route C) – the estimate was removed from your queue.', coalesce(i.inquiry_name, i.project_name), i.customer_name),
        'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  elsif p_route = 'A' then
    perform app.require(i.route = 'C', 'Only a design-only inquiry can add estimation');
    perform app.require(i.status in ('accepted', 'in_design', 'design_review', 'design_approved'), 'Estimation can be added only while the design is in progress');
    perform app.require(i.duty_status is not null, 'Set the duty status (Duty Free / Duty Paid) first – it is needed for estimation');
    update public.inquiries set route = 'A', release_mode = 3, release_mode_confirmed = true where id = i.id;
    perform app.log_status('inquiry', i.id, i.id, i.status, i.status, 'Route changed C → A (design + estimation)');
    perform app.start_parallel_estimate(i.id);
    perform app.notify_many(app.role_users('sm_estimation'), 'estimation_added', 'Estimation added: ' || i.code,
      format('%s – %s. The inquiry is now design + estimation (route A).', coalesce(i.inquiry_name, i.project_name), i.customer_name),
      'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  else
    raise exception 'Route % is not supported here', p_route;
  end if;
  perform app.refresh_inquiry(i.id);
end $$;

-- the request: a route in the payload must be A or C and differ from the inquiry's
create or replace function public.request_inquiry_change(p_inquiry uuid, p_kind text, p_payload jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); steps public.app_role[];
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person can request changes');
  perform app.require(coalesce(trim(p_reason), '') <> '', 'A reason is required');
  case p_kind
    when 'duty_change' then
      perform app.require(coalesce(p_payload ->> 'duty_status', '') in ('duty_free', 'duty_paid'), 'Choose the new duty status');
      perform app.require((p_payload ->> 'duty_status')::public.duty_status is distinct from i.duty_status, 'The inquiry already has this duty status');
      steps := array['sm_projects'];
    when 'release_mode' then
      perform app.require(coalesce(p_payload ->> 'release_mode', '') in ('1', '2', '3'), 'Choose the new release mode');
      steps := array['sm_projects'];
    when 'expectation_change' then
      if p_payload ? 'route' and p_payload ->> 'route' is not null then
        perform app.require(p_payload ->> 'route' in ('A', 'C') and i.route in ('A', 'C'), 'The route can change only between design + estimation and design only');
        perform app.require(p_payload ->> 'route' <> i.route, 'The inquiry already has this route');
      end if;
      steps := case when i.route = 'B' then array['sm_estimation'] else array['design_manager', 'sm_estimation'] end;
    when 'early_design_release' then
      perform app.require(i.release_mode = 3, 'Early design release applies to design + estimation inquiries only');
      perform app.require(i.status in ('in_estimation', 'estimation_review') and i.design_released_to_sales_at is null,
        'The design must be approved and not yet released');
      steps := array['design_manager', 'sm_projects'];
    else raise exception 'Unknown change type %', p_kind;
  end case;
  return app.create_approval(p_kind::public.approval_kind, 'inquiry', i.id, i.id,
    format('%s – %s', initcap(replace(p_kind, '_', ' ')), i.code), p_reason, steps::public.app_role[], coalesce(p_payload, '{}'));
end $$;

-- the decision: an approved route in the payload is applied (app.apply_route_change)
do $$
declare def text; anchor text := $k$  when 'expectation_change' then
    if approved then
$k$;
begin
  select pg_get_functiondef('app.apply_approval(public.approvals, text)'::regprocedure) into def;
  if position('apply_route_change' in def) = 0 then
    if position(anchor in def) = 0 then raise exception 'apply_approval: anchor not found'; end if;
    def := replace(def, anchor, anchor || $k$      perform app.apply_route_change(a.inquiry_id, nullif(a.payload ->> 'route', ''));
$k$);
    execute def;
  end if;
end $$;

-- INQ-2026-00052: the expectation change approved on 22 Oct ("No need estimation") was meant as design only
do $$
declare iid uuid;
begin
  select i.id into iid from public.inquiries i
   where i.code = 'INQ-2026-00052' and i.route = 'A'
     and exists (select 1 from public.approvals a where a.inquiry_id = i.id and a.kind = 'expectation_change' and a.status = 'approved' and a.reason ilike '%no need estimation%');
  if iid is not null then perform app.apply_route_change(iid, 'C'); end if;
end $$;
