-- A discarded (cancelled) inquiry closes its design and estimation jobs as 'cancelled': before, a job already started stayed
-- "In progress" with its estimator after the sales person discarded the inquiry (INQ-2026-00037).
-- Open-job counts leave cancelled jobs out.

alter table public.design_jobs drop constraint if exists design_jobs_status_check;
alter table public.design_jobs add constraint design_jobs_status_check check (status in (
  'assigned', 'acknowledged', 'date_change_requested', 'in_progress', 'on_hold', 'in_review', 'returned', 'approved', 'released', 'cancelled'));
alter table public.estimation_jobs drop constraint if exists estimation_jobs_status_check;
alter table public.estimation_jobs add constraint estimation_jobs_status_check check (status in (
  'queued', 'accepted', 'assigned', 'acknowledged', 'date_change_requested', 'in_progress', 'on_hold',
  'submitted_for_approval', 'returned', 'gm_approval', 'sm_projects_approval', 'revision_requested', 'approved', 'released', 'cancelled'));

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
  -- work already started is closed as cancelled, so it no longer shows as in progress anywhere
  update public.design_jobs set status = 'cancelled' where inquiry_id = i.id and status not in ('approved', 'released', 'cancelled');
  update public.estimation_jobs set status = 'cancelled' where inquiry_id = i.id and status not in ('approved', 'released', 'cancelled');
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

create or replace function public.team_performance(p_team text, p_from date, p_to date)
returns table (user_id uuid, full_name text, jobs_completed bigint, on_time_pct numeric, avg_working_days numeric,
               overdue_open bigint, review_cycles numeric, hours_logged numeric, open_jobs bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_team = 'design' then
    if not app.has_role('gm', 'design_manager', 'lighting_designer', 'lighting_engineer') then return; end if;
    return query
    select p.id, p.full_name,
      count(d.id) filter (where d.approved_at::date between p_from and p_to),
      round(100.0 * count(d.id) filter (where d.approved_at::date between p_from and p_to and d.submitted_at <= d.due_at)
            / nullif(count(d.id) filter (where d.approved_at::date between p_from and p_to), 0), 1),
      round(avg(app.work_minutes_between(d.assigned_at, d.approved_at) / app.working_minutes_per_day()) filter (where d.approved_at::date between p_from and p_to), 1),
      count(d.id) filter (where d.status not in ('approved', 'released', 'cancelled') and d.due_at < now()),
      round(avg(d.review_cycles) filter (where d.approved_at::date between p_from and p_to), 2),
      coalesce((select sum(h.hours) from public.design_hours h where h.user_id = p.id and h.work_date between p_from and p_to), 0),
      count(d.id) filter (where d.status not in ('approved', 'released', 'cancelled'))
    from public.profiles p left join public.design_jobs d on d.assignee_id = p.id
    where p.role in ('lighting_designer', 'lighting_engineer') and p.active
      and (app.has_role('gm', 'design_manager') or p.id = auth.uid())
    group by p.id, p.full_name;
  else
    if not app.has_role('gm', 'sm_estimation', 'am_estimation', 'estimation_exec') then return; end if;
    return query
    select p.id, p.full_name,
      count(e.id) filter (where e.released_at::date between p_from and p_to),
      round(100.0 * count(e.id) filter (where e.released_at::date between p_from and p_to and e.released_at <= e.due_at)
            / nullif(count(e.id) filter (where e.released_at::date between p_from and p_to), 0), 1),
      round(avg(app.work_minutes_between(e.assigned_at, e.released_at) / app.working_minutes_per_day()) filter (where e.released_at::date between p_from and p_to), 1),
      count(e.id) filter (where e.status not in ('released') and e.due_at < now()),
      round(avg((select count(*) from public.status_history h where h.entity_id = e.id and h.to_status = 'returned')), 2),
      0::numeric,
      count(e.id) filter (where e.status not in ('released'))
    from public.profiles p left join public.estimation_jobs e on e.assignee_id = p.id
    where p.role in ('am_estimation', 'estimation_exec') and p.active
      and (app.has_role('gm', 'sm_estimation') or p.id = auth.uid())
    group by p.id, p.full_name;
  end if;
end $$;

create or replace function app.estimation_meeting_pack(p_mid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.sales_meetings;
  d date;
  wk date;
  people jsonb := '[]';
  sp record;
  open_st text[] := array['queued', 'accepted', 'assigned', 'acknowledged', 'date_change_requested', 'in_progress', 'on_hold',
                          'submitted_for_approval', 'returned', 'gm_approval'];
  team jsonb;
begin
  select * into m from public.sales_meetings where id = p_mid;
  d := m.meeting_date; wk := d - 7;
  team := jsonb_build_object(
    'in_hand', (select jsonb_build_object(
        'new', count(*) filter (where j.status in ('queued', 'accepted')),
        'assigned', count(*) filter (where j.status in ('assigned', 'acknowledged', 'date_change_requested')),
        'in_progress', count(*) filter (where j.status = 'in_progress'),
        'on_hold', count(*) filter (where j.status = 'on_hold'),
        'approval', count(*) filter (where j.status in ('submitted_for_approval', 'gm_approval')),
        'returned', count(*) filter (where j.status = 'returned'),
        'total', count(*))
      from public.estimation_jobs j where j.status = any (open_st)),
    'released_n', (select count(*) from public.quotations q where (q.released_at at time zone app.tz())::date >= wk and (q.released_at at time zone app.tz())::date < d),
    'released_value', (select round(coalesce(sum(app.to_lkr(q.quoted_value, q.currency, d)), 0), 2) from public.quotations q
                        where (q.released_at at time zone app.tz())::date >= wk and (q.released_at at time zone app.tz())::date < d),
    'released_on_time_n', (select count(*) from public.estimation_jobs j where j.released_at is not null
                            and (j.released_at at time zone app.tz())::date >= wk and (j.released_at at time zone app.tz())::date < d
                            and (j.due_at is null or j.released_at <= coalesce(j.revised_due_at, j.due_at))),
    'released_jobs_n', (select count(*) from public.estimation_jobs j where j.released_at is not null
                         and (j.released_at at time zone app.tz())::date >= wk and (j.released_at at time zone app.tz())::date < d),
    'overdue_n', (select count(*) from public.estimation_jobs j where j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) < d),
    'at_risk_n', (select count(*) from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id where j.status = any (open_st)
                   and (app.job_due(j.due_at, j.revised_due_at) between d and d + 7 or i.customer_deadline between d and d + 7)),
    'clarifications_n', (select count(*) from public.clarifications c where c.answered_at is null),
    'clarifications_oldest', (select max(d - (c.asked_at at time zone app.tz())::date) from public.clarifications c where c.answered_at is null),
    'hit', (select jsonb_build_object('won', count(*) filter (where q.result = 'won'), 'lost', count(*) filter (where q.result = 'lost'))
              from public.quotations q where q.released_at >= (d - 90)::timestamp at time zone app.tz()),
    'waiting_design_n', (select count(*) from public.inquiries i where i.route = 'A' and i.status in ('accepted', 'in_design', 'design_review')),
    'overdue', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'person', app.display_name(j.assignee_id),
               'due', app.job_due(j.due_at, j.revised_due_at), 'days', d - app.job_due(j.due_at, j.revised_due_at), 'status', j.status) x
          from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id
         where j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) < d
         order by app.job_due(j.due_at, j.revised_due_at) limit 15) z), '[]'),
    'at_risk', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'person', app.display_name(j.assignee_id),
               'due', app.job_due(j.due_at, j.revised_due_at), 'customer_deadline', i.customer_deadline, 'status', j.status) x
          from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id
         where j.status = any (open_st) and (app.job_due(j.due_at, j.revised_due_at) between d and d + 7 or i.customer_deadline between d and d + 7)
         order by least(app.job_due(j.due_at, j.revised_due_at), i.customer_deadline) limit 15) z), '[]'),
    'returned', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'person', app.display_name(j.assignee_id),
               'reason', j.review_comment, 'revision', j.revision) x
          from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id where j.status = 'returned' limit 15) z), '[]'),
    'on_hold', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'person', app.display_name(j.assignee_id), 'reason', j.hold_reason) x
          from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id where j.status = 'on_hold' limit 15) z), '[]'),
    'clarifications', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'question', c.question, 'by', app.display_name(c.asked_by),
               'days', d - (c.asked_at at time zone app.tz())::date) x
          from public.clarifications c join public.inquiries i on i.id = c.inquiry_id where c.answered_at is null order by c.asked_at limit 15) z), '[]'),
    'waiting_design', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'status', i.status,
               'design_due', (select min(app.job_due(dj.due_at, dj.revised_due_at)) from public.design_jobs dj
                               where dj.inquiry_id = i.id and dj.status not in ('approved', 'released', 'cancelled'))) x
          from public.inquiries i where i.route = 'A' and i.status in ('accepted', 'in_design', 'design_review') order by i.created_at limit 15) z), '[]'));
  for sp in select * from app.meeting_pack_people(p_mid, 'estimation') loop
    people := people || jsonb_build_object(
      'id', sp.id, 'name', sp.full_name,
      'in_hand_n', (select count(*) from public.estimation_jobs j where j.assignee_id = sp.id and j.status = any (open_st)),
      'released_week_n', (select count(*) from public.estimation_jobs j where j.assignee_id = sp.id and j.released_at is not null
                           and (j.released_at at time zone app.tz())::date >= wk and (j.released_at at time zone app.tz())::date < d),
      'overdue', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''),
                   'days', d - app.job_due(j.due_at, j.revised_due_at)) order by j.due_at)
                 from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id
                where j.assignee_id = sp.id and j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) < d), '[]'),
      'due_soon', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''),
                   'due', app.job_due(j.due_at, j.revised_due_at)) order by j.due_at)
                 from public.estimation_jobs j join public.inquiries i on i.id = j.inquiry_id
                where j.assignee_id = sp.id and j.status = any (open_st) and app.job_due(j.due_at, j.revised_due_at) between d and d + 7), '[]'),
      'avg_days', (select round(avg(extract(epoch from j.released_at - coalesce(j.assigned_at, j.created_at)) / 86400)::numeric, 1)
                     from public.estimation_jobs j where j.assignee_id = sp.id and j.released_at >= (d - 90)::timestamp at time zone app.tz()),
      'returns_n', (select count(*) from public.estimation_jobs j where j.assignee_id = sp.id
                     and (j.status = 'returned' or (j.revision > 0 and j.created_at >= (d - 90)::timestamp at time zone app.tz()))),
      'open_actions', app.meeting_open_actions(sp.id, d),
      'exception', (select jsonb_build_object('status', e.status, 'reason', e.reason) from public.meeting_exceptions e
                     where e.sales_person_id = sp.id and e.team = 'estimation' and e.meeting_date = d));
  end loop;
  return jsonb_build_object('team_kind', 'estimation', 'meeting_date', d, 'week_from', wk, 'week_to', d - 1, 'generated_at', now(),
    'team', team, 'people', people);
end $$;

create or replace function app.design_team_of(i public.inquiries) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select assignee_id x from public.design_jobs where inquiry_id = i.id and revision = i.revision and status not in ('released', 'cancelled')
    union all
    select assignee_id from public.estimation_jobs where inquiry_id = i.id and revision = i.revision and status not in ('released', 'cancelled')) s
  where x is not null
$$;

-- inquiries already cancelled: their unfinished jobs are cancelled too (and their clocks stopped)
do $$
declare j record;
begin
  for j in select 'design_job' t, d.id from public.design_jobs d join public.inquiries i on i.id = d.inquiry_id
            where i.status = 'cancelled' and d.status not in ('approved', 'released', 'cancelled')
           union all
           select 'estimation_job', e.id from public.estimation_jobs e join public.inquiries i on i.id = e.inquiry_id
            where i.status = 'cancelled' and e.status not in ('approved', 'released', 'cancelled') loop
    perform app.stop_clocks(j.t, j.id);
  end loop;
  update public.design_jobs d set status = 'cancelled' from public.inquiries i
   where i.id = d.inquiry_id and i.status = 'cancelled' and d.status not in ('approved', 'released', 'cancelled');
  update public.estimation_jobs e set status = 'cancelled' from public.inquiries i
   where i.id = e.inquiry_id and i.status = 'cancelled' and e.status not in ('approved', 'released', 'cancelled');
end $$;

select app.fix_function_owners();
