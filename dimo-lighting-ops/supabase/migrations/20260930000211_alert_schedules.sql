-- Alert schedules: GM / DGM (and the System Administrator) set when each alert job runs and how often, or pause it
--  * alert_jobs describes each scheduled job (plain words, area, who is told) with its default schedule.
--  * alert_schedules() shows the live schedule from the scheduler with the last run; set_alert_schedule() changes it
--    (5-field schedule in UTC, built by the app from Sri Lanka time) or pauses / resumes it. Every change is logged.
--  * The day and value limits inside the alerts stay under Settings.

create table if not exists public.alert_jobs (
  job text primary key,
  area text not null,
  title text not null,
  description text not null,
  recipients text,
  default_schedule text not null,
  sort int not null default 0,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz
);
alter table public.alert_jobs enable row level security;
drop policy if exists alert_jobs_read on public.alert_jobs;
create policy alert_jobs_read on public.alert_jobs for select to authenticated using (app.has_role('gm', 'sys_admin'));
grant select on public.alert_jobs to authenticated;

insert into public.alert_jobs (job, area, title, description, recipients, default_schedule, sort) values
  ('sla-tick', 'Inquiries', 'Inquiry SLA clocks', 'Checks design and estimation due times and sends amber / red / overdue alerts', 'Assignees, their managers, sales person', '*/15 * * * *', 1),
  ('reminders-tick', 'Sales', 'Sales reminders', 'Weekly plan deadline, visit reports due, dormant projects and customer deadlines', 'Sales people, SM Projects', '*/15 * * * *', 2),
  ('sales-meeting-tick', 'Meetings', 'Sales meeting', 'Invitations the day before, meeting-day reminders and generating the pack', 'SM Projects, sales team', '*/15 * * * 0,1', 3),
  ('team-meeting-tick', 'Meetings', 'Team meetings (Design, Estimation, Execution)', 'Invitations, reminders and generating the pack for the team meetings', 'Meeting hosts and invitees', '*/15 * * * 1-6', 4),
  ('project-meeting-tick', 'Meetings', 'Project meetings', 'Reminders for project meetings called by the Senior Electrical Engineer', 'Invitees', '*/15 * * * 1-6', 5),
  ('meeting-action-tick', 'Meetings', 'Meeting actions', 'Actions not appointed or past their due date, follow-up visits not planned', 'Action owners, meeting host, GM / DGM', '7 * * * *', 6),
  ('meeting-review-tick', 'Meetings', 'Meeting reviews', 'Meetings not published or reviewed on time', 'Meeting hosts, GM / DGM', '12 * * * *', 7),
  ('design-split-tick', 'Design', 'Design date approvals', 'Design completion dates waiting for SM Projects approval', 'SM Projects, design team', '*/15 * * * *', 8),
  ('design-hold-tick', 'Design', 'Design jobs on hold', 'Design jobs on hold for too long', 'Design Manager', '*/15 * * * *', 9),
  ('design-query-tick', 'Design', 'Design queries', 'Design queries from site not answered in time', 'Design team, Senior Electrical Engineer', '15 2 * * *', 10),
  ('hold-tick', 'Inquiries', 'Inquiries on hold', 'Inquiries on hold past their review date', 'Sales person, SM Projects', '20 3 * * *', 11),
  ('eng-tick', 'Engineering', 'Engineering jobs', 'Engineering jobs due or overdue', 'Assignees, leads', '*/15 * * * *', 12),
  ('sample-outstanding-tick', 'Sales', 'Samples outstanding', 'Samples not returned and the outstanding value limit', 'Sales people, SM Projects', '*/15 * * * *', 13),
  ('claim-followup-tick', 'Warranty', 'Warranty claim follow-ups', 'Warranty claims waiting for action', 'Warranty desk, assignees', '*/15 * * * *', 14),
  ('warranty-tick', 'Warranty', 'Warranties', 'Warranty expiry and registration reminders', 'Warranty desk', '*/15 * * * *', 15),
  ('manufacturer-tick', 'Warranty', 'Manufacturer claims (RMA)', 'Manufacturer claims waiting for the manufacturer', 'Warranty desk', '*/15 * * * *', 16),
  ('defect-tick', 'Warranty', 'Project defects', 'Defects not rectified in time during the defects period', 'Assignees, Senior Electrical Engineer', '20 3 * * *', 17),
  ('retention-tick', 'Finance', 'Retentions', 'Retention release dates and follow-ups', 'Operations, sales person', '*/15 * * * *', 18),
  ('bond-tick', 'Finance', 'Bonds', 'Bond expiry and renewal reminders', 'Operations, SM Projects', '*/15 * * * *', 19),
  ('securities-tick', 'Finance', 'Project securities and advance', 'Performance bonds and advance payment due within 14 days', 'Senior Electrical Engineer, Operations, GM / DGM', '25 3 * * *', 20),
  ('finance-tick', 'Finance', 'Finance', 'Invoice schedule, budget and target reminders', 'Finance roles, sales people', '20 * * * *', 21),
  ('secured-watch-tick', 'Finance', 'Secured orders', 'Changes in secured orders and the order book', 'GM / DGM, SM Projects', '35 * * * *', 22),
  ('billing-tick', 'Execution', 'Billing and IPAs', 'IPA submission deadlines and billing at risk', 'AE, Senior Electrical Engineer', '45 2 * * *', 23),
  ('programme-tick', 'Execution', 'Programme', 'Activities late against the programme', 'Project team, Senior Electrical Engineer', '30 2 * * *', 24),
  ('progress-tick', 'Execution', 'Progress', 'Progress updates due', 'Project team', '*/15 * * * *', 25),
  ('variations-tick', 'Execution', 'Variations', 'Variations waiting for a decision', 'Approvers', '30 2 * * *', 26),
  ('exec-report-tick', 'Execution', 'Daily site reports', 'Daily reports not submitted on time', 'Supervisors, AE, Senior Electrical Engineer', '*/15 * * * *', 27),
  ('exec-plan-tick', 'Execution', 'Weekly site plans', 'Weekly plans due on Saturday', 'Supervisors, AE', '*/30 * * * 6', 28),
  ('materials-tick', 'Execution', 'Materials', 'Material requests waiting and deliveries due', 'Operations, project team', '*/30 * * * *', 29),
  ('exec-access-tick', 'Execution', 'Execution access', 'Temporary staff and subcontractor access ending', 'Senior Electrical Engineer, SM Projects', '5 0 * * *', 30),
  ('police-tick', 'Execution', 'Police reports (site workers)', 'Workers without a police report', 'Supervisors, AE', '*/30 * * * *', 31),
  ('hse-tick', 'HSE', 'HSE actions', 'Corrective actions overdue', 'Assignees, Senior Electrical Engineer', '0 2 * * *', 32),
  ('hse-forms-tick', 'HSE', 'HSE forms', 'Inspections and checklists due', 'Project team', '*/30 * * * *', 33),
  ('permit-tick', 'HSE', 'Work permits', 'Permits expiring or not closed', 'Permit holders, AE', '*/15 * * * *', 34),
  ('toolbox-tick', 'HSE', 'Toolbox talks', 'Toolbox talk not recorded today', 'Supervisors', '*/10 * * * *', 35),
  ('instruments-tick', 'Operations', 'Instruments', 'Calibration due and instruments not returned', 'Operations, holders', '15 2 * * *', 36),
  ('stock-tick', 'Operations', 'SAP stock', 'Stock upload due and non-moving stock', 'Operations, SM Projects', '20 8 * * *', 37),
  ('scrap-tick', 'Operations', 'Scrap', 'Scrap accumulating and disposals waiting', 'Operations, SM Projects', '15 3 * * *', 38),
  ('fx-tick', 'Operations', 'Exchange rates', 'Reminder to upload the ComBank report (working days)', 'Operations Executive', '30 3 * * *', 39),
  ('legal-hearing-tick', 'Debtors', 'Legal hearings', 'Court hearing dates for debtors', 'Sales person, SM Projects', '*/15 * * * *', 40),
  ('high-level-tick', 'Access', 'High level access', 'Tells the person and the GM / DGM when a high level access period ends', 'Person, GM / DGM', '*/15 * * * *', 41)
on conflict (job) do update set area = excluded.area, title = excluded.title, description = excluded.description, recipients = excluded.recipients,
  default_schedule = excluded.default_schedule, sort = excluded.sort;

create or replace function public.alert_schedules() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare has_cron boolean := exists (select 1 from pg_extension where extname = 'pg_cron'); res jsonb;
begin
  perform app.require(app.has_role('gm', 'sys_admin'), 'Only the GM / DGM or the System Administrator manages alert schedules');
  if has_cron then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
        'job', a.job, 'area', a.area, 'title', a.title, 'description', a.description, 'recipients', a.recipients,
        'default_schedule', a.default_schedule, 'schedule', j.schedule, 'active', j.active, 'scheduled', j.jobid is not null,
        'changed_by', a.changed_by, 'changed_at', a.changed_at,
        'last_run', (select jsonb_build_object('at', d.start_time, 'status', d.status) from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1))
        order by a.sort), '[]'::jsonb)
      from public.alert_jobs a left join cron.job j on j.jobname = a.job $q$ into res;
  else
    select coalesce(jsonb_agg(jsonb_build_object('job', a.job, 'area', a.area, 'title', a.title, 'description', a.description, 'recipients', a.recipients,
      'default_schedule', a.default_schedule, 'schedule', null, 'active', null, 'scheduled', false, 'changed_by', a.changed_by, 'changed_at', a.changed_at,
      'last_run', null) order by a.sort), '[]'::jsonb) into res from public.alert_jobs a;
  end if;
  return res;
end $$;

create or replace function public.set_alert_schedule(p_job text, p_schedule text, p_active boolean default true, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.alert_jobs; jid bigint; old_s text; old_a boolean; f text[];
begin
  perform app.require(app.has_role('gm', 'sys_admin'), 'Only the GM / DGM or the System Administrator changes alert schedules');
  select * into a from public.alert_jobs where job = p_job;
  perform app.require(found, 'Unknown alert');
  f := regexp_split_to_array(btrim(p_schedule), '\s+');
  perform app.require(array_length(f, 1) = 5 and btrim(p_schedule) ~ '^[0-9*/,-]+( [0-9*/,-]+){4}$', 'Not a valid schedule');
  -- every 5 minutes at most often
  perform app.require(f[1] !~ '^\*(/[1-4])?$', 'Alerts run every 5 minutes at most');
  perform app.require(exists (select 1 from pg_extension where extname = 'pg_cron'), 'The scheduler is not available on this database');
  execute 'select jobid, schedule, active from cron.job where jobname = $1' into jid, old_s, old_a using p_job;
  perform app.require(jid is not null, 'This alert is not scheduled on this database');
  execute 'select cron.alter_job(job_id := $1, schedule := $2, active := $3)' using jid, btrim(p_schedule), p_active;
  update public.alert_jobs set changed_by = auth.uid(), changed_at = now() where job = p_job;
  insert into public.audit_log (user_id, table_name, record_id, action, old_data, new_data)
  values (auth.uid(), 'alert_jobs', p_job, 'SCHEDULE', jsonb_build_object('schedule', old_s, 'active', old_a),
          jsonb_build_object('schedule', btrim(p_schedule), 'active', p_active, 'reason', p_reason));
end $$;
revoke execute on function public.alert_schedules(), public.set_alert_schedule(text, text, boolean, text) from public, anon;
grant execute on function public.alert_schedules(), public.set_alert_schedule(text, text, boolean, text) to authenticated;
