-- Design holds and single assignment:
--  * a design task (lighting / electrical) is assigned once per revision; changing the designer is done with Reassign
--  * a designer's hold alerts the Design Manager at once; after 2 working days without resuming, SM Projects is told (for information)
--  * dashboards list the designs on hold

alter table public.design_jobs add column if not exists held_at timestamptz;
alter table public.design_jobs add column if not exists hold_alerted_at timestamptz;

update public.design_jobs j set held_at = coalesce(
    (select max(h.at) from public.status_history h where h.entity_type = 'design_job' and h.entity_id = j.id and h.to_status = 'on_hold'), now())
  where j.status = 'on_hold' and j.held_at is null;

create or replace function app.design_jobs_hold_times() returns trigger
language plpgsql as $$
begin
  if new.status = 'on_hold' and old.status is distinct from 'on_hold' then
    new.held_at := now();
    new.hold_alerted_at := null;
  elsif new.status <> 'on_hold' then
    new.held_at := null;
    new.hold_alerted_at := null;
  end if;
  return new;
end $$;
drop trigger if exists design_jobs_hold_times on public.design_jobs;
create trigger design_jobs_hold_times before update of status on public.design_jobs
for each row execute function app.design_jobs_hold_times();

-- Hold: design holds go to the Design Manager (and the sales person); estimation holds unchanged
create or replace function public.hold_job(p_entity_type text, p_job uuid, p_reason text, p_waiting_on text default null)
returns void language plpgsql security definer set search_path = public as $$
declare inq uuid; sp uuid; code text; who uuid; task text;
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
        (select code from public.inquiries where id = inq), p_reason, array['sm_estimation']::public.app_role[]);
      return;
    end if;
  end if;
  perform app.log_status(p_entity_type, p_job, inq, null, 'on_hold', p_reason);
  select sales_person_id, i.code into sp, code from public.inquiries i where id = inq;
  if p_entity_type = 'design_job' then
    perform app.notify_many(array(select x from unnest(app.role_users('design_manager') || sp) x where x is distinct from auth.uid()),
      'design_on_hold', 'Design on hold: ' || code,
      format('%s (%s design) · %s · waiting on %s', app.display_name(who), task, p_reason, p_waiting_on),
      'normal', 'design_job', p_job, '/design/' || p_job);
  else
    perform app.notify_many(array[sp] || app.role_users('sm_projects'), 'job_on_hold', 'On hold: ' || code, p_reason,
      'normal', 'inquiry', inq, app.inquiry_url(inq));
  end if;
  perform app.refresh_inquiry(inq);
end $$;

-- Designs on hold for more than 2 working days: one information alert to SM Projects (and a reminder to the Design Manager)
create or replace function public.design_hold_tick() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select j.id, j.task_type, j.held_at, j.hold_reason, j.hold_waiting_on, j.assignee_id, i.code, i.project_name
             from public.design_jobs j join public.inquiries i on i.id = j.inquiry_id
            where j.status = 'on_hold' and j.held_at is not null and j.hold_alerted_at is null
              and app.work_minutes_between(j.held_at, now()) >= 2 * app.working_minutes_per_day() loop
    perform app.notify_many(app.role_users('sm_projects') || app.role_users('design_manager'), 'design_hold_long',
      'Design on hold over 2 days: ' || r.code,
      format('%s · %s (%s design) · on hold since %s · %s · waiting on %s', r.project_name, app.display_name(r.assignee_id), r.task_type,
        to_char(r.held_at at time zone app.tz(), 'DD Mon HH24:MI'), r.hold_reason, r.hold_waiting_on),
      'normal', 'design_job', r.id, '/design/' || r.id, 'design_hold_long:' || r.id || ':' || r.held_at);
    update public.design_jobs set hold_alerted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.design_hold_tick() from public, anon, authenticated;
grant execute on function public.design_hold_tick() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('design-hold-tick', '*/15 * * * *', 'select public.design_hold_tick()');
  end if;
end $$;

-- Designs on hold, for the Design Board and the management dashboards
create or replace function public.design_holds() returns table (
  job_id uuid, inquiry_id uuid, code text, project_name text, customer_name text, task_type text, assignee_id uuid,
  hold_reason text, hold_waiting_on text, held_at timestamptz, working_days numeric, alerted boolean)
language sql stable security definer set search_path = public as $$
  select j.id, i.id, i.code, i.project_name, i.customer_name, j.task_type, j.assignee_id, j.hold_reason, j.hold_waiting_on, j.held_at,
         round(app.work_minutes_between(j.held_at, now()) / app.working_minutes_per_day(), 1), j.hold_alerted_at is not null
    from public.design_jobs j join public.inquiries i on i.id = j.inquiry_id
   where j.status = 'on_hold'
     and (app.has_role('design_manager', 'sm_projects', 'gm') or j.assignee_id = auth.uid())
   order by j.held_at;
$$;
revoke execute on function public.design_holds() from public, anon;
grant execute on function public.design_holds() to authenticated, service_role;

-- Assign once: each design task of the current revision has one designer; use Reassign to change it
create or replace function public.assign_design_job(
  p_inquiry uuid, p_assignee uuid, p_due timestamptz, p_task_type text default 'lighting', p_job_size text default 'medium',
  p_milestones jsonb default '[]'::jsonb, p_late_reason text default null, p_depends_on uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  jid uuid;
  assignee_role public.app_role;
begin
  perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager assigns design jobs');
  perform app.require(i.status in ('accepted', 'in_design', 'design_review'), 'Accept the inquiry first');
  select role into assignee_role from public.profiles where id = p_assignee and active;
  perform app.require(assignee_role in ('lighting_designer', 'lighting_engineer'), 'Assign a Lighting Designer or Lighting Engineer');
  perform app.require(p_task_type <> 'electrical' or assignee_role = 'lighting_engineer', 'Electrical design is assigned to the Lighting Engineer');
  perform app.require(p_due > now(), 'Due date must be in the future');
  -- Route A: SM Projects first approves the design completion date (time left for estimation)
  if i.route = 'A' then
    perform app.require(i.design_due_status = 'approved',
      'Set the design completion date and get SM Projects'' approval before assigning the designer');
    perform app.require(p_due <= i.design_due_at, format('The due date must be on or before the approved design completion date (%s)',
      to_char(i.design_due_at at time zone app.tz(), 'DD Mon')));
  end if;
  perform app.require(i.design_scope is null or i.design_scope = 'lighting_electrical' or i.design_scope = p_task_type,
    format('This inquiry needs %s design only', replace(i.design_scope, '_', ' + ')));
  perform app.require(not exists (select 1 from public.design_jobs where inquiry_id = i.id and revision = i.revision and task_type = p_task_type),
    format('The %s design is already assigned to %s – use Reassign on the design job to change the designer', p_task_type,
      (select app.display_name(assignee_id) from public.design_jobs where inquiry_id = i.id and revision = i.revision and task_type = p_task_type limit 1)));
  if i.design_required_by is not null and p_due > (i.design_required_by + time '17:30') at time zone app.tz() then
    perform app.require(coalesce(trim(p_late_reason), '') <> '', 'Due date is later than the sales-requested date: give a reason');
    perform app.notify_many(array[i.sales_person_id] || app.role_users('sm_projects'), 'design_due_late',
      'Design due date later than requested', format('%s: due %s. %s', i.code, to_char(p_due at time zone app.tz(), 'DD Mon'), p_late_reason),
      'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  end if;

  insert into public.design_jobs (inquiry_id, revision, task_type, job_size, assignee_id, due_at, original_due_at, milestones,
                                  late_reason, depends_on_job_id, assigned_by)
  values (i.id, i.revision, p_task_type, p_job_size, p_assignee, p_due, p_due, coalesce(p_milestones, '[]'), p_late_reason, p_depends_on, auth.uid())
  returning id into jid;
  perform app.log_status('design_job', jid, i.id, null, 'assigned');
  perform app.stop_clocks('inquiry', i.id, 'assignment');
  perform app.start_clock(i.id, 'design_job', jid, 'ack', p_assignee, null, 'Designer acknowledgement');
  perform app.start_clock(i.id, 'design_job', jid, 'design', p_assignee, p_due, initcap(p_task_type) || ' design');
  if i.status = 'accepted' then perform app.set_inquiry_status(i.id, 'in_design'); end if;
  perform app.notify(p_assignee, 'work_assigned', 'Design job assigned: ' || i.code,
    format('%s – %s (%s). Due %s', i.project_name, i.customer_name, p_task_type, to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI')),
    'normal', 'design_job', jid, '/design/' || jid);
  perform app.refresh_inquiry(i.id);
  return jid;
end $$;
