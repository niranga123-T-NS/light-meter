-- Samples:
--  * SM Projects approves every request; above LKR 100,000 (equivalent) GM / DGM approves after SM Projects.
--    GM / DGM no longer sees requests below the limit as theirs to approve.
--  * Sample outstanding per sales person = returnable samples still out + sold samples not yet paid. Above LKR 500,000
--    the sales person is alerted every Monday to collect overdue returnables and the money for sold samples.

alter table public.samples drop constraint if exists samples_status_check;
alter table public.samples add constraint samples_status_check check (status in (
  'draft', 'submitted', 'availability_confirmed', 'gm_approval', 'not_available', 'approved', 'rejected', 'returned_for_changes',
  'handed_over', 'out', 'return_reported', 'returned', 'sold_unpaid', 'closed', 'damaged_lost', 'cleared'));

insert into public.settings (key, value, description) values
  ('sample_gm_approval_value_lkr', '100000', 'Sample requests above this value (LKR equivalent) need GM / DGM approval after SM Projects'),
  ('sample_outstanding_limit_lkr', '500000', 'Monday alert to a sales person whose samples outstanding (out + sold unpaid) exceed this value')
on conflict (key) do nothing;

drop function if exists public.decide_sample(uuid, text, text);
create or replace function public.decide_sample(p_sample uuid, p_decision text, p_comment text default null) returns text
language plpgsql security definer set search_path = public as $$
declare s public.samples; v numeric; next_status text;
begin
  select * into s from public.samples where id = p_sample for update;
  perform app.require(p_decision in ('approved', 'rejected', 'returned_for_changes'), 'Invalid decision');
  perform app.require(p_decision = 'approved' or coalesce(trim(p_comment), '') <> '', 'A reason is required');
  if s.status = 'availability_confirmed' then
    perform app.require(app.has_role('sm_projects'), 'SM Projects approves sample requests first');
  elsif s.status = 'gm_approval' then
    perform app.require(app.has_role('gm'), 'Only GM / DGM approves sample requests above the limit');
  else
    raise exception 'Request is not waiting for approval';
  end if;
  v := app.to_lkr(s.total_value, s.currency);
  next_status := case when p_decision = 'approved' and s.status = 'availability_confirmed'
                           and v > app.setting_num('sample_gm_approval_value_lkr', 100000) then 'gm_approval'
                      else p_decision end;
  perform set_config('app.workflow', '1', true);
  update public.samples set status = next_status, approved_by = auth.uid(), approved_at = now(),
    approval_comment = concat_ws(' · ', nullif(approval_comment, ''), nullif(trim(p_comment), '')) where id = s.id;
  if next_status = 'gm_approval' then
    perform app.notify_many(app.role_users('gm'), 'sample_request', 'Approve sample request ' || s.code || ' (above LKR 100,000)',
      format('%s – %s · %s · approved by SM Projects', s.project_name, s.client_name, app.fmt_money(s.total_value, s.currency)),
      'normal', 'sample', s.id, '/samples/' || s.id, null, true);
    perform app.notify(s.sales_person_id, 'sample_step', format('Sample request %s – SM Projects approved, now with GM / DGM', s.code),
      coalesce(p_comment, ''), 'normal', 'sample', s.id, '/samples/' || s.id);
  else
    perform app.notify_many(array[s.sales_person_id] || app.role_users('operations_exec'), 'sample_step',
      format('Sample request %s %s', s.code, replace(p_decision, '_', ' ')), coalesce(p_comment, ''), 'normal', 'sample', s.id, '/samples/' || s.id);
  end if;
  return next_status;
end $$;

-- Samples outstanding per sales person (LKR equivalent)
create or replace function public.sample_outstanding() returns table (
  sales_person_id uuid, out_n int, out_lkr numeric, overdue_n int, overdue_lkr numeric, sold_n int, sold_lkr numeric, total_lkr numeric, over_limit boolean)
language sql stable security definer set search_path = public as $$
  select s.sales_person_id,
         count(*) filter (where s.status in ('out', 'return_reported'))::int,
         coalesce(sum(app.to_lkr(s.total_value, s.currency)) filter (where s.status in ('out', 'return_reported')), 0),
         count(*) filter (where s.status = 'out' and s.expected_return_date < (now() at time zone app.tz())::date)::int,
         coalesce(sum(app.to_lkr(s.total_value, s.currency)) filter (where s.status = 'out' and s.expected_return_date < (now() at time zone app.tz())::date), 0),
         count(*) filter (where s.status = 'sold_unpaid')::int,
         coalesce(sum(app.to_lkr(coalesce(d.amount, s.total_value), s.currency)) filter (where s.status = 'sold_unpaid'), 0),
         coalesce(sum(app.to_lkr(coalesce(case when s.status = 'sold_unpaid' then d.amount end, s.total_value), s.currency)), 0),
         coalesce(sum(app.to_lkr(coalesce(case when s.status = 'sold_unpaid' then d.amount end, s.total_value), s.currency)), 0)
           > app.setting_num('sample_outstanding_limit_lkr', 500000)
    from public.samples s left join public.debts d on d.id = s.debt_id
   where s.status in ('out', 'return_reported', 'sold_unpaid')
     and (s.sales_person_id = auth.uid() or app.has_role('gm', 'sm_projects', 'operations_exec') or auth.uid() is null)
   group by s.sales_person_id
$$;
revoke execute on function public.sample_outstanding() from public, anon;
revoke execute on function public.decide_sample(uuid, text, text) from public, anon;
grant execute on function public.decide_sample(uuid, text, text) to authenticated, service_role;
grant execute on function public.sample_outstanding() to authenticated, service_role;

-- Monday alert to each sales person over the limit (from 08:00, once a week)
create or replace function public.sample_outstanding_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  r record;
  n int := 0;
begin
  if extract(isodow from today) <> 1 or loc::time < time '08:00' then return 0; end if;
  for r in select * from public.sample_outstanding() where over_limit and sales_person_id is not null loop
    perform app.notify(r.sales_person_id, 'sample_outstanding', 'Samples outstanding over LKR 500,000 – collect them',
      format('Total %s: %s returnable out (%s overdue, %s) · %s sold not paid (%s). Collect the overdue samples and the money for sold samples.',
             app.fmt_money(r.total_lkr, 'LKR'), r.out_n, r.overdue_n, app.fmt_money(r.overdue_lkr, 'LKR'), r.sold_n, app.fmt_money(r.sold_lkr, 'LKR')),
      'normal', null, null, '/samples?tab=mine', format('smpout:%s:%s', r.sales_person_id, today), true);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.sample_outstanding_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.sample_outstanding_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sample-outstanding-tick', '*/15 * * * *', 'select public.sample_outstanding_tick()');
  end if;
end $$;

-- Approvals list: GM / DGM sees only the requests above the limit
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
  from public.visit_plans p where p.status = 'submitted' and app.has_role('sm_projects', 'gm')
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
