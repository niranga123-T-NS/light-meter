-- Progress and time on pending design / estimation jobs.
--  * Every design job records when its progress was last updated; estimators now give a % too.
--  * 15:30 on working days: anyone with a pending job not updated today gets one nudge.
--  * No update for 2 working days: the Design Manager / SM Estimation is told once.
--  * design_pipeline() also returns the time used on the design and the estimate, and when each was last updated.

alter table public.design_jobs
  add column if not exists progress_updated_at timestamptz,
  add column if not exists progress_alerted_at timestamptz;
alter table public.estimation_jobs
  add column if not exists progress_pct int not null default 0 check (progress_pct between 0 and 100),
  add column if not exists progress_note text,
  add column if not exists progress_updated_at timestamptz,
  add column if not exists progress_alerted_at timestamptz;

create or replace function public.update_estimate_progress(p_job uuid, p_progress int, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.estimation_jobs := app.est_job(p_job);
begin
  perform app.require(j.assignee_id = auth.uid() or app.has_role('sm_estimation'), 'Only the assigned estimator can update progress');
  perform app.require(j.status in ('assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested'), 'The estimate is not in progress');
  perform app.require(p_progress between 0 and 100, 'Progress is 0–100 %');
  if j.status = 'assigned' then perform app.stop_clocks('estimation_job', j.id, 'ack'); end if;
  update public.estimation_jobs set progress_pct = p_progress, progress_note = nullif(btrim(p_note), ''),
    progress_updated_at = now(), progress_alerted_at = null,
    status = case when status in ('assigned', 'returned') then 'in_progress' else status end
  where id = j.id;
  perform app.refresh_inquiry(j.inquiry_id);
end $$;
revoke execute on function public.update_estimate_progress(uuid, int, text) from public, anon;
grant execute on function public.update_estimate_progress(uuid, int, text) to authenticated, service_role;

-- Pending jobs that should be updated: design and estimation, open and not on hold / in review / submitted
create or replace function app.pending_progress_jobs() returns table (
  entity_type text, job_id uuid, inquiry_id uuid, code text, assignee_id uuid, progress int, since timestamptz, alerted_at timestamptz, label text
) language sql stable security definer set search_path = public as $$
  select 'design_job', j.id, j.inquiry_id, i.code, j.assignee_id, j.progress_pct, coalesce(j.progress_updated_at, j.created_at), j.progress_alerted_at,
         initcap(j.task_type) || ' design'
    from public.design_jobs j join public.inquiries i on i.id = j.inquiry_id
   where j.assignee_id is not null and j.status in ('assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested')
  union all
  select 'estimation_job', e.id, e.inquiry_id, i.code, e.assignee_id, e.progress_pct, coalesce(e.progress_updated_at, e.assigned_at, e.created_at), e.progress_alerted_at,
         case when e.phase = 'pre' then 'Pre-estimate' else 'Estimate' end
    from public.estimation_jobs e join public.inquiries i on i.id = e.inquiry_id
   where e.assignee_id is not null and e.status in ('assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested')
$$;

create or replace function public.progress_tick() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record; n int := 0;
  loc timestamp := now() at time zone app.tz();
  today_start timestamptz := (loc::date + app.work_start()) at time zone app.tz();
  url text;
begin
  -- 1. Daily nudge from 15:30 (once a day per job – deduplicated by date)
  if app.is_working_day(loc::date) and loc::time >= time '15:30' and loc::time < app.work_end() then
    for r in select * from app.pending_progress_jobs() p where p.since < today_start loop
      url := case when r.entity_type = 'design_job' then '/design/' else '/estimation/' end || r.job_id;
      perform app.notify(r.assignee_id, 'progress_nudge', 'Update progress – ' || r.code,
        format('%s · last %s%% %s. Two taps on the job page.', r.label, r.progress,
          case when r.since < today_start - interval '20 hours' then 'on ' || to_char(r.since at time zone app.tz(), 'DD Mon') else 'yesterday' end),
        'normal', r.entity_type, r.job_id, url, 'progress_nudge:' || r.job_id || ':' || loc::date);
      n := n + 1;
    end loop;
  end if;
  -- 2. No update for 2 working days → the manager, once until the next update
  for r in select * from app.pending_progress_jobs() p
            where p.alerted_at is null and app.work_minutes_between(p.since, now()) >= 2 * app.working_minutes_per_day() loop
    url := case when r.entity_type = 'design_job' then '/design/' else '/estimation/' end || r.job_id;
    perform app.notify_many(app.role_users(case when r.entity_type = 'design_job' then 'design_manager'::public.app_role else 'sm_estimation'::public.app_role end),
      'progress_stale', 'No progress update for 2 days – ' || r.code,
      format('%s · %s · last %s%% on %s', r.label, app.display_name(r.assignee_id), r.progress, to_char(r.since at time zone app.tz(), 'DD Mon HH24:MI')),
      'normal', r.entity_type, r.job_id, url, 'progress_stale:' || r.job_id || ':' || r.since);
    if r.entity_type = 'design_job' then
      update public.design_jobs set progress_alerted_at = now() where id = r.job_id;
    else
      update public.estimation_jobs set progress_alerted_at = now() where id = r.job_id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.progress_tick() from public, anon, authenticated;
grant execute on function public.progress_tick() to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('progress-tick', '*/15 * * * *', 'select public.progress_tick()');
  end if;
end $$;

-- Panel: time used (share of the allowed working time) on the design and the estimate, and last updates
drop function if exists public.design_pipeline();
create or replace function public.design_pipeline() returns table (
  inquiry_id uuid, code text, title text, customer_name text, deadline_type text, deadline_at timestamptz, tender_ref text,
  design_due_at timestamptz, design_due_status text, designers text, design_progress int, inquiry_status text,
  estimation_job_id uuid, estimation_status text, estimation_phase text, estimator text, estimation_due_at timestamptz,
  estimation_days numeric, late boolean, extension_status text,
  design_time_pct numeric, design_paused boolean, design_updated_at timestamptz,
  estimation_progress int, estimation_time_pct numeric, estimation_paused boolean, estimation_updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.has_role('sm_estimation', 'am_estimation', 'design_manager', 'sm_projects', 'gm'), 'Not allowed');
  return query
  select i.id, i.code, coalesce(i.inquiry_name, i.project_name), i.customer_name, i.deadline_type, app.deadline_end(i), i.tender_ref,
         i.design_due_at, i.design_due_status,
         (select string_agg(distinct app.display_name(d.assignee_id), ', ') from public.design_jobs d where d.inquiry_id = i.id and d.revision = i.revision),
         coalesce((select avg(case when d.status in ('in_review', 'approved', 'released') then 100 else d.progress_pct end)
                     from public.design_jobs d where d.inquiry_id = i.id and d.revision = i.revision), 0)::int,
         i.status, e.id, e.status, e.phase, app.display_name(e.assignee_id), i.estimation_due_at,
         case when i.design_due_at is not null and i.estimation_due_at is not null
              then round(app.work_minutes_between(greatest(i.design_due_at, now()), i.estimation_due_at) / app.working_minutes_per_day(), 1) end,
         i.status in ('accepted', 'in_design') and i.design_due_at is not null and now() > i.design_due_at,
         i.extension_status,
         (select max(c.used_pct) from public.sla_clocks c join public.design_jobs d on d.id = c.entity_id
           where c.entity_type = 'design_job' and c.stage = 'design' and c.stopped_at is null and d.inquiry_id = i.id and d.revision = i.revision),
         coalesce((select bool_and(c.paused_at is not null) from public.sla_clocks c join public.design_jobs d on d.id = c.entity_id
           where c.entity_type = 'design_job' and c.stage = 'design' and c.stopped_at is null and d.inquiry_id = i.id and d.revision = i.revision), false),
         (select min(coalesce(d.progress_updated_at, d.created_at)) from public.design_jobs d
           where d.inquiry_id = i.id and d.revision = i.revision and d.status in ('assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested')),
         e.progress_pct,
         (select c.used_pct from public.sla_clocks c where c.entity_type = 'estimation_job' and c.entity_id = e.id and c.stage = 'estimation' and c.stopped_at is null limit 1),
         coalesce((select c.paused_at is not null from public.sla_clocks c where c.entity_type = 'estimation_job' and c.entity_id = e.id and c.stage = 'estimation' and c.stopped_at is null limit 1), false),
         case when e.assignee_id is not null then coalesce(e.progress_updated_at, e.assigned_at) end
    from public.inquiries i
    left join lateral (select * from public.estimation_jobs x where x.inquiry_id = i.id and x.revision = i.revision order by x.created_at desc limit 1) e on true
   where i.route = 'A' and coalesce(i.release_mode, 3) <> 1
     and i.status in ('accepted', 'in_design', 'design_review', 'design_approved')
   order by app.deadline_end(i) nulls last;
end $$;
revoke execute on function public.design_pipeline() from public, anon;
grant execute on function public.design_pipeline() to authenticated, service_role;


create or replace function public.update_design_progress(p_job uuid, p_progress int, p_hours numeric default null, p_note text default null,
                                                        p_milestones jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare j public.design_jobs := app.design_job(p_job);
begin
  perform app.require(j.assignee_id = auth.uid() or app.has_role('design_manager'), 'Only the assignee can update progress');
  perform app.require(j.status in ('acknowledged', 'in_progress', 'returned', 'assigned', 'date_change_requested'), 'Job is not in progress');
  if j.status = 'assigned' then perform app.stop_clocks('design_job', j.id, 'ack'); end if;
  if p_hours is not null and p_hours > 0 then
    insert into public.design_hours (design_job_id, hours, note) values (j.id, p_hours, p_note);
  end if;
  update public.design_jobs set progress_pct = greatest(0, least(100, p_progress)),
    hours_logged = hours_logged + coalesce(p_hours, 0),
    progress_updated_at = now(), progress_alerted_at = null,
    milestones = coalesce(p_milestones, milestones),
    status = case when status in ('assigned', 'returned') then 'in_progress' else status end
  where id = j.id;
  perform app.refresh_inquiry(j.inquiry_id);
end $$;
