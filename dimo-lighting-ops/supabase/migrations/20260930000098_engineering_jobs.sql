-- Engineering jobs (project execution): the Senior Electrical Engineer assigns work to an Assistant Engineer with a deadline
-- and the site location (address + map pin). The engineer accepts it or puts it on hold – always with a reason, also later
-- during the work. A hold is reviewed by the Senior Electrical Engineer: the hold is rejected (continue) or the work resumes
-- with instructions, possibly with a revised deadline. Updates follow the job type (installation progress / inspection /
-- activity) with photos; site visits are GPS-checked against the job location. Completing the job closes the meeting action
-- it came from. Alerts: not accepted, hold not reviewed, overdue, not attended → engineer, Senior Elec. Engineer, SM Projects.
-- Every notification is also pushed to the Android app (push-dispatch).

create table public.eng_jobs (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  job_type text not null check (job_type in ('installation', 'inspection', 'testing', 'site_visit', 'other')),
  title text not null,
  instructions text,
  project_id uuid references public.projects (id),
  organization_id uuid references public.organizations (id),
  meeting_action_id uuid references public.sales_meeting_actions (id) on delete set null,
  site_address text,
  lat double precision,
  lng double precision,
  assignee_id uuid not null references public.profiles (id),
  assigned_by uuid references public.profiles (id),
  assigned_at timestamptz not null default now(),
  due_date date not null,
  original_due_date date,
  status text not null default 'assigned' check (status in ('assigned', 'in_progress', 'on_hold', 'done', 'cancelled')),
  accepted_at timestamptz,
  hold_reason text,
  hold_at timestamptz,
  progress int not null default 0 check (progress between 0 and 100),
  last_update_at timestamptz,
  last_site_visit_at timestamptz,
  done_at timestamptz,
  done_note text,
  accept_alert_level int not null default 0,
  hold_alert_level int not null default 0,
  idle_alert_level int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.eng_jobs (assignee_id, status);
create index on public.eng_jobs (status, due_date);
create unique index eng_jobs_action on public.eng_jobs (meeting_action_id) where meeting_action_id is not null and status <> 'cancelled';

create table public.eng_job_updates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.eng_jobs (id) on delete cascade,
  by_id uuid references public.profiles (id) default auth.uid(),
  at timestamptz not null default now(),
  kind text not null check (kind in ('assigned', 'accepted', 'progress', 'inspection', 'activity', 'site_visit', 'hold', 'hold_rejected',
                                     'resumed', 'deadline', 'reassigned', 'edited', 'done', 'cancelled')),
  note text,
  work_stage text,
  progress int check (progress between 0 and 100),
  qty_installed numeric,
  issues text,
  lat double precision,
  lng double precision,
  distance_m numeric,
  gps_verified boolean,
  new_due date
);
create index on public.eng_job_updates (job_id, at);

-- Installation stages (installation-type updates)
create or replace function app.eng_install_stages() returns text[] language sql immutable as $$
  select array['Site survey / marking', 'Material received at site', 'Cabling / conduit', 'Fixture mounting', 'Wiring / connections',
               'Testing & commissioning', 'Snags / rectification', 'Handover']
$$;

create or replace function app.eng_type_label(t text) returns text language sql immutable as $$
  select case t when 'installation' then 'Installation' when 'inspection' then 'Site inspection' when 'testing' then 'Testing & commissioning'
                when 'site_visit' then 'Site visit / meeting' else 'Other' end
$$;

create or replace function app.is_eng_lead() returns boolean language sql stable as $$
  select app.has_role('senior_elec_engineer', 'sm_projects', 'gm')
$$;

create or replace function app.can_read_eng_job(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer', 'sm_projects', 'gm')
      or exists (select 1 from public.eng_jobs j where j.id = p_id and (j.assignee_id = auth.uid() or j.assigned_by = auth.uid()))
$$;

alter table public.eng_jobs enable row level security;
alter table public.eng_job_updates enable row level security;
create policy eng_jobs_read on public.eng_jobs for select to authenticated using (app.can_read_eng_job(id));
create policy eng_job_updates_read on public.eng_job_updates for select to authenticated using (app.can_read_eng_job(job_id));
grant select on public.eng_jobs, public.eng_job_updates to authenticated;

create or replace function app.eng_head(j public.eng_jobs) returns text
language sql stable security definer set search_path = public as $$
  select concat_ws(' · ', j.code, j.title, (select name from public.projects where id = j.project_id),
                   (select name from public.organizations where id = j.organization_id))
$$;

create or replace function app.eng_leads() returns uuid[] language sql stable security definer set search_path = public as $$
  select app.role_users('senior_elec_engineer')
$$;

create or replace function app.eng_log(p_job uuid, p_kind text, p_note text, p_new_due date default null) returns void
language sql security definer set search_path = public as $$
  insert into public.eng_job_updates (job_id, kind, note, new_due) values (p_job, p_kind, nullif(btrim(p_note), ''), p_new_due)
$$;

create or replace function app.check_eng_assignee(p_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(p_id is not null and exists (select 1 from public.profiles where id = p_id and active and role in ('assistant_engineer', 'senior_elec_engineer')),
    'Assign it to an Assistant Engineer (or the Senior Electrical Engineer)');
end $$;

-- ---------------------------------------------------------------------------
-- Assign a job (Senior Electrical Engineer; SM Projects / GM may too)
-- p: {job_type, title, instructions, project_id, organization_id, meeting_action_id, site_address, lat, lng, assignee_id, due_date}
-- ---------------------------------------------------------------------------
create or replace function public.create_eng_job(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare j public.eng_jobs; a public.sales_meeting_actions; asg uuid := nullif(p ->> 'assignee_id', '')::uuid;
  due date := nullif(p ->> 'due_date', '')::date; act uuid := nullif(p ->> 'meeting_action_id', '')::uuid;
  prj uuid := nullif(p ->> 'project_id', '')::uuid; org uuid := nullif(p ->> 'organization_id', '')::uuid;
begin
  perform app.require(app.is_eng_lead(), 'Only the Senior Electrical Engineer (or SM Projects / GM) assigns engineering jobs');
  perform app.require(coalesce(p ->> 'job_type', '') in ('installation', 'inspection', 'testing', 'site_visit', 'other'), 'Choose the job type');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'Describe the job');
  perform app.check_eng_assignee(asg);
  perform app.require(due is not null, 'Set the deadline');
  perform app.require(due >= (now() at time zone app.tz())::date, 'The deadline cannot be in the past');
  perform app.require(coalesce(btrim(p ->> 'site_address'), '') <> '', 'Enter the site address');
  perform app.require(nullif(p ->> 'lat', '') is not null and nullif(p ->> 'lng', '') is not null,
    'Set the site location on the map (find it from the address, the project, or your current location) – visits are GPS-checked against it');
  if act is not null then
    select * into a from public.sales_meeting_actions where id = act;
    perform app.require(a.id is not null and a.kind = 'execution' and a.status = 'open', 'The meeting action is not an open project execution task');
    perform app.require(not exists (select 1 from public.eng_jobs where meeting_action_id = act and status <> 'cancelled'), 'A job already exists for this meeting action');
    prj := coalesce(prj, a.project_id); org := coalesce(org, a.organization_id);
  end if;
  insert into public.eng_jobs (code, job_type, title, instructions, project_id, organization_id, meeting_action_id, site_address, lat, lng,
                               assignee_id, assigned_by, due_date, original_due_date)
  values (app.next_code('ENG'), p ->> 'job_type', btrim(p ->> 'title'), nullif(btrim(p ->> 'instructions'), ''), prj, org, act,
          btrim(p ->> 'site_address'), (p ->> 'lat')::float8, (p ->> 'lng')::float8, asg, auth.uid(), due, due)
  returning * into j;
  perform app.eng_log(j.id, 'assigned', format('Assigned to %s · deadline %s%s', app.display_name(asg), to_char(due, 'DD Mon YYYY'),
    coalesce(' · ' || j.instructions, '')));
  -- The meeting action is appointed to the same person (sales and SM Projects are told there)
  if act is not null then
    if a.assignee_id is distinct from asg then
      perform public.assign_meeting_action(act, asg, j.instructions);
    end if;
  end if;
  perform app.notify(asg, 'eng_job', 'New job assigned to you – accept it or put it on hold',
    format('%s · %s · deadline %s · %s', app.eng_type_label(j.job_type), app.eng_head(j), to_char(due, 'DD Mon YYYY'), j.site_address),
    'normal', 'eng_job', j.id, '/engineering/' || j.id, null, true);
  return j.id;
end $$;

-- Edit details (not the deadline): Senior Electrical Engineer
create or replace function public.update_eng_job(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare j public.eng_jobs;
begin
  perform app.require(app.is_eng_lead(), 'Only the Senior Electrical Engineer edits the job');
  select * into j from public.eng_jobs where id = p_id for update;
  perform app.require(j.id is not null and j.status not in ('done', 'cancelled'), 'The job is closed');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '' and coalesce(btrim(p ->> 'site_address'), '') <> '', 'Title and site address are required');
  perform app.require(nullif(p ->> 'lat', '') is not null and nullif(p ->> 'lng', '') is not null, 'Set the site location on the map');
  perform app.require(coalesce(p ->> 'job_type', j.job_type) in ('installation', 'inspection', 'testing', 'site_visit', 'other'), 'Choose the job type');
  update public.eng_jobs set job_type = coalesce(p ->> 'job_type', job_type), title = btrim(p ->> 'title'),
    instructions = nullif(btrim(p ->> 'instructions'), ''), site_address = btrim(p ->> 'site_address'),
    lat = (p ->> 'lat')::float8, lng = (p ->> 'lng')::float8, updated_at = now() where id = j.id;
  perform app.eng_log(j.id, 'edited', 'Job details updated');
  perform app.notify(j.assignee_id, 'eng_job', 'Job details updated', app.eng_head(j), 'normal', 'eng_job', j.id, '/engineering/' || j.id);
end $$;

create or replace function public.reassign_eng_job(p_id uuid, p_person uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare j public.eng_jobs; prev uuid;
begin
  perform app.require(app.is_eng_lead(), 'Only the Senior Electrical Engineer reassigns the job');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.check_eng_assignee(p_person);
  select * into j from public.eng_jobs where id = p_id for update;
  perform app.require(j.id is not null and j.status not in ('done', 'cancelled'), 'The job is closed');
  perform app.require(j.assignee_id <> p_person, 'Already with this person');
  prev := j.assignee_id;
  update public.eng_jobs set assignee_id = p_person, assigned_at = now(), status = 'assigned', accepted_at = null, hold_reason = null, hold_at = null,
    accept_alert_level = 0, hold_alert_level = 0, idle_alert_level = 0, updated_at = now() where id = j.id returning * into j;
  perform app.eng_log(j.id, 'reassigned', format('From %s to %s – %s', app.display_name(prev), app.display_name(p_person), btrim(p_reason)));
  if j.meeting_action_id is not null and exists (select 1 from public.sales_meeting_actions where id = j.meeting_action_id and status = 'open') then
    perform public.assign_meeting_action(j.meeting_action_id, p_person, p_reason);
  end if;
  perform app.notify(p_person, 'eng_job', 'Job assigned to you – accept it or put it on hold',
    format('%s · deadline %s · %s', app.eng_head(j), to_char(j.due_date, 'DD Mon YYYY'), j.site_address), 'normal', 'eng_job', j.id, '/engineering/' || j.id, null, true);
  perform app.notify(prev, 'eng_job', 'Job reassigned', app.eng_head(j) || ' · now with ' || app.display_name(p_person), 'normal', 'eng_job', j.id, '/engineering/' || j.id);
end $$;

-- Revised deadline: Senior Electrical Engineer, with a reason
create or replace function public.set_eng_job_due(p_id uuid, p_due date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare j public.eng_jobs;
begin
  perform app.require(app.is_eng_lead(), 'Only the Senior Electrical Engineer changes the deadline');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(p_due is not null and p_due >= (now() at time zone app.tz())::date, 'The new deadline cannot be in the past');
  select * into j from public.eng_jobs where id = p_id for update;
  perform app.require(j.id is not null and j.status not in ('done', 'cancelled'), 'The job is closed');
  update public.eng_jobs set due_date = p_due, updated_at = now() where id = j.id;
  perform app.eng_log(j.id, 'deadline', format('Deadline %s → %s – %s', to_char(j.due_date, 'DD Mon YYYY'), to_char(p_due, 'DD Mon YYYY'), btrim(p_reason)), p_due);
  perform app.notify(j.assignee_id, 'eng_job', 'Job deadline revised to ' || to_char(p_due, 'DD Mon YYYY'), app.eng_head(j) || ' · ' || btrim(p_reason),
    'normal', 'eng_job', j.id, '/engineering/' || j.id, null, true);
end $$;

create or replace function public.cancel_eng_job(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare j public.eng_jobs;
begin
  perform app.require(app.is_eng_lead(), 'Only the Senior Electrical Engineer cancels the job');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select * into j from public.eng_jobs where id = p_id for update;
  perform app.require(j.id is not null and j.status not in ('done', 'cancelled'), 'The job is closed');
  update public.eng_jobs set status = 'cancelled', updated_at = now() where id = j.id;
  perform app.eng_log(j.id, 'cancelled', btrim(p_reason));
  perform app.notify(j.assignee_id, 'eng_job', 'Job cancelled', app.eng_head(j) || ' · ' || btrim(p_reason), 'normal', 'eng_job', j.id, '/engineering/' || j.id);
end $$;

-- ---------------------------------------------------------------------------
-- The engineer: accept / hold (always with a reason)
-- ---------------------------------------------------------------------------
create or replace function public.accept_eng_job(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.eng_jobs;
begin
  select * into j from public.eng_jobs where id = p_id for update;
  perform app.require(j.id is not null, 'Job not found');
  perform app.require(j.assignee_id = auth.uid(), 'Only the engineer it is assigned to accepts it');
  perform app.require(j.status = 'assigned', 'This job is not waiting for acceptance');
  update public.eng_jobs set status = 'in_progress', accepted_at = now(), updated_at = now() where id = j.id;
  perform app.eng_log(j.id, 'accepted', coalesce(nullif(btrim(p_note), ''), 'Accepted'));
  perform app.notify_many(array_remove(array[j.assigned_by] || app.eng_leads(), auth.uid()), 'eng_job_status',
    'Job accepted by ' || app.display_name(auth.uid()), app.eng_head(j) || ' · deadline ' || to_char(j.due_date, 'DD Mon YYYY'),
    'normal', 'eng_job', j.id, '/engineering/' || j.id);
end $$;

create or replace function public.hold_eng_job(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare j public.eng_jobs;
begin
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'A hold always needs the reason');
  select * into j from public.eng_jobs where id = p_id for update;
  perform app.require(j.id is not null, 'Job not found');
  perform app.require(j.assignee_id = auth.uid(), 'Only the engineer it is assigned to puts it on hold');
  perform app.require(j.status in ('assigned', 'in_progress'), 'Only an assigned or ongoing job can be put on hold');
  update public.eng_jobs set status = 'on_hold', hold_reason = btrim(p_reason), hold_at = now(), hold_alert_level = 0, updated_at = now() where id = j.id;
  perform app.eng_log(j.id, 'hold', btrim(p_reason));
  perform app.notify_many(array_remove(array[j.assigned_by] || app.eng_leads(), auth.uid()), 'eng_job_hold',
    format('Job put on hold by %s – review it', app.display_name(auth.uid())), app.eng_head(j) || ' · reason: ' || btrim(p_reason),
    'normal', 'eng_job', j.id, '/engineering/' || j.id, null, true);
  perform app.notify_many(app.role_users('sm_projects'), 'eng_job_status', 'Engineering job on hold',
    app.eng_head(j) || ' · ' || app.display_name(auth.uid()) || ' · ' || btrim(p_reason), 'normal', 'eng_job', j.id, '/engineering/' || j.id);
end $$;

-- Senior Electrical Engineer reviews a hold: reject it (continue the work) or resume with instructions – optionally a revised deadline
create or replace function public.review_eng_hold(p_id uuid, p_decision text, p_note text, p_new_due date default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.eng_jobs;
begin
  perform app.require(app.is_eng_lead(), 'Only the Senior Electrical Engineer reviews a hold');
  perform app.require(p_decision in ('reject', 'resume'), 'Choose: reject the hold or resume with instructions');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Give your instructions');
  perform app.require(p_new_due is null or p_new_due >= (now() at time zone app.tz())::date, 'The new deadline cannot be in the past');
  select * into j from public.eng_jobs where id = p_id for update;
  perform app.require(j.id is not null and j.status = 'on_hold', 'This job is not on hold');
  update public.eng_jobs set status = 'in_progress', accepted_at = coalesce(accepted_at, now()), hold_reason = null, hold_at = null,
    due_date = coalesce(p_new_due, due_date), idle_alert_level = 0, updated_at = now() where id = j.id;
  perform app.eng_log(j.id, case p_decision when 'reject' then 'hold_rejected' else 'resumed' end,
    concat_ws(' · ', btrim(p_note), case when p_new_due is not null and p_new_due <> j.due_date then 'new deadline ' || to_char(p_new_due, 'DD Mon YYYY') end),
    case when p_new_due is not null and p_new_due <> j.due_date then p_new_due end);
  perform app.notify(j.assignee_id, 'eng_job',
    case p_decision when 'reject' then 'Hold not accepted – continue the job' else 'Resume the job' end,
    concat_ws(' · ', app.eng_head(j), btrim(p_note), 'deadline ' || to_char(coalesce(p_new_due, j.due_date), 'DD Mon YYYY')),
    'normal', 'eng_job', j.id, '/engineering/' || j.id, null, true);
end $$;

-- ---------------------------------------------------------------------------
-- Updates, site visits (GPS), completion
-- p: {kind: progress|inspection|activity, note, work_stage, progress, qty_installed, issues}
-- ---------------------------------------------------------------------------
create or replace function public.add_eng_update(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare j public.eng_jobs; k text := p ->> 'kind'; pr int := nullif(p ->> 'progress', '')::int; uid uuid;
begin
  select * into j from public.eng_jobs where id = p_id for update;
  perform app.require(j.id is not null, 'Job not found');
  perform app.require(j.assignee_id = auth.uid() or app.is_eng_lead(), 'Only the engineer on the job or the Senior Electrical Engineer');
  perform app.require(j.status = 'in_progress', case j.status when 'assigned' then 'Accept the job first' when 'on_hold' then 'The job is on hold – wait for the review'
                                                              else 'The job is closed' end);
  perform app.require(k in ('progress', 'inspection', 'activity'), 'Choose the kind of update');
  perform app.require(coalesce(btrim(p ->> 'note'), '') <> '', 'Describe what was done');
  if j.job_type = 'installation' and k = 'progress' then
    perform app.require((p ->> 'work_stage') = any (app.eng_install_stages()), 'Choose the installation stage');
    perform app.require(pr is not null and pr between 0 and 100, 'Enter the installation progress (0–100%)');
  end if;
  perform app.require(k <> 'progress' or j.job_type = 'installation', 'Progress updates are for installation jobs – record an inspection or activity');
  insert into public.eng_job_updates (job_id, kind, note, work_stage, progress, qty_installed, issues)
  values (j.id, k, btrim(p ->> 'note'), nullif(p ->> 'work_stage', ''), pr, nullif(p ->> 'qty_installed', '')::numeric, nullif(btrim(p ->> 'issues'), ''))
  returning id into uid;
  update public.eng_jobs set last_update_at = now(), progress = coalesce(pr, progress), idle_alert_level = 0, updated_at = now() where id = j.id;
  perform app.notify_many(array_remove(array[j.assigned_by] || app.eng_leads(), auth.uid()), 'eng_job_update',
    format('%s update – %s', case k when 'progress' then 'Installation' when 'inspection' then 'Inspection' else 'Activity' end, app.display_name(auth.uid())),
    concat_ws(' · ', app.eng_head(j), nullif(p ->> 'work_stage', ''), case when pr is not null then pr || '%' end, btrim(p ->> 'note'),
              'issues: ' || nullif(btrim(p ->> 'issues'), '')),
    'normal', 'eng_job', j.id, '/engineering/' || j.id);
  return uid;
end $$;

-- Site check-in: the visit is GPS-checked against the job location (same radius as customer visits)
create or replace function public.eng_site_checkin(p_id uuid, p_lat double precision, p_lng double precision, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.eng_jobs; d numeric; ok boolean; radius numeric := app.setting_num('gps_radius_m', 500);
begin
  select * into j from public.eng_jobs where id = p_id for update;
  perform app.require(j.id is not null, 'Job not found');
  perform app.require(j.assignee_id = auth.uid() or app.has_role('senior_elec_engineer'), 'Only the engineer on the job or the Senior Electrical Engineer');
  perform app.require(j.status = 'in_progress', case j.status when 'assigned' then 'Accept the job first' when 'on_hold' then 'The job is on hold – wait for the review'
                                                              else 'The job is closed' end);
  perform app.require(p_lat is not null and p_lng is not null, 'Your location is needed to mark the site visit – allow location access');
  perform app.require(j.lat is not null and j.lng is not null, 'The site location is not set – ask the Senior Electrical Engineer to set it');
  d := round(app.distance_m(p_lat, p_lng, j.lat, j.lng)::numeric);
  ok := d <= radius;
  insert into public.eng_job_updates (job_id, kind, note, lat, lng, distance_m, gps_verified)
  values (j.id, 'site_visit', coalesce(nullif(btrim(p_note), ''), case when ok then 'At site' else 'Not at the site location' end), p_lat, p_lng, d, ok);
  update public.eng_jobs set last_site_visit_at = case when ok then now() else last_site_visit_at end, last_update_at = now(), idle_alert_level = 0, updated_at = now()
  where id = j.id;
  if not ok then
    perform app.notify_many(app.eng_leads(), 'eng_job_update', 'Site visit not verified by GPS',
      format('%s · %s was %s m from the site', app.eng_head(j), app.display_name(auth.uid()), d), 'normal', 'eng_job', j.id, '/engineering/' || j.id);
  end if;
  return jsonb_build_object('verified', ok, 'distance_m', d, 'radius_m', radius);
end $$;

create or replace function public.complete_eng_job(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare j public.eng_jobs; a public.sales_meeting_actions; lead boolean := app.has_role('senior_elec_engineer', 'sm_projects', 'gm');
begin
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Say what was done');
  select * into j from public.eng_jobs where id = p_id for update;
  perform app.require(j.id is not null, 'Job not found');
  perform app.require(j.assignee_id = auth.uid() or lead, 'Only the engineer on the job or the Senior Electrical Engineer');
  perform app.require(j.status = 'in_progress', case j.status when 'assigned' then 'Accept the job first' when 'on_hold' then 'The job is on hold – wait for the review'
                                                              else 'The job is closed' end);
  perform app.require(lead or exists (select 1 from public.eng_job_updates where job_id = j.id and kind = 'site_visit' and gps_verified),
    'Mark your site visit first (GPS check-in at the site)');
  update public.eng_jobs set status = 'done', done_at = now(), done_note = btrim(p_note), progress = 100, updated_at = now() where id = j.id;
  perform app.eng_log(j.id, 'done', btrim(p_note));
  perform app.notify_many(array_remove(array[j.assigned_by] || app.eng_leads() || app.role_users('sm_projects'), auth.uid()), 'eng_job_status',
    'Job completed – ' || app.display_name(auth.uid()), app.eng_head(j) || ' · ' || btrim(p_note), 'normal', 'eng_job', j.id, '/engineering/' || j.id);
  -- The meeting action it came from is done too
  if j.meeting_action_id is not null then
    update public.sales_meeting_actions set status = 'done', done_at = now(), done_by = auth.uid(), done_note = btrim(p_note) || ' (job ' || j.code || ')'
    where id = j.meeting_action_id and status = 'open' returning * into a;
    if a.id is not null then
      perform app.notify_many(array_remove(app.action_people(a), auth.uid()), 'meeting_action', 'Meeting action done',
        format('%s · %s · %s', app.display_name(auth.uid()), app.action_subject(a), btrim(p_note)), 'normal', 'sales_meeting', a.meeting_id,
        '/meetings', null, true);
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Alerts (every 15 minutes)
--   not accepted: 4 working hours → engineer + Senior Elec. Engineer; 1 working day → + SM Projects
--   hold not reviewed: 4 working hours → Senior Elec. Engineer; 1 working day → + SM Projects
--   no update or site visit for 3 working days (ongoing) → engineer + Senior Elec. Engineer; 5 → + SM Projects
--   due tomorrow → engineer; overdue → engineer + Senior Elec. Engineer + SM Projects, once a day
-- ---------------------------------------------------------------------------
create or replace function public.eng_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare j public.eng_jobs; n int := 0; wh numeric; lvl int; today date := (p_at at time zone app.tz())::date;
  leads uuid[] := app.eng_leads(); smp uuid[] := app.role_users('sm_projects'); per_day numeric := app.working_minutes_per_day();
begin
  for j in select * from public.eng_jobs where status in ('assigned', 'in_progress', 'on_hold') loop
    if j.status = 'assigned' then
      wh := app.work_minutes_between(j.assigned_at, p_at) / 60.0;
      lvl := case when wh * 60 >= per_day then 2 when wh >= 4 then 1 else 0 end;
      if lvl > j.accept_alert_level then
        perform app.notify_many(array[j.assignee_id] || leads || case when lvl >= 2 then smp else '{}'::uuid[] end, 'eng_job_alert',
          'Job not accepted yet – ' || app.display_name(j.assignee_id), app.eng_head(j) || ' · assigned ' || to_char(j.assigned_at at time zone app.tz(), 'DD Mon HH24:MI'),
          case when lvl >= 2 then 'critical' else 'normal' end::public.priority, 'eng_job', j.id, '/engineering/' || j.id);
        update public.eng_jobs set accept_alert_level = lvl where id = j.id; n := n + 1;
      end if;
    elsif j.status = 'on_hold' then
      wh := app.work_minutes_between(j.hold_at, p_at) / 60.0;
      lvl := case when wh * 60 >= per_day then 2 when wh >= 4 then 1 else 0 end;
      if lvl > j.hold_alert_level then
        perform app.notify_many(leads || case when lvl >= 2 then smp else '{}'::uuid[] end, 'eng_job_alert',
          'Job on hold – review it', app.eng_head(j) || ' · ' || app.display_name(j.assignee_id) || ' · reason: ' || coalesce(j.hold_reason, ''),
          case when lvl >= 2 then 'critical' else 'normal' end::public.priority, 'eng_job', j.id, '/engineering/' || j.id);
        update public.eng_jobs set hold_alert_level = lvl where id = j.id; n := n + 1;
      end if;
    elsif j.status = 'in_progress' then
      wh := app.work_minutes_between(greatest(j.accepted_at, j.last_update_at, j.last_site_visit_at), p_at) / per_day;
      lvl := case when wh >= 5 then 2 when wh >= 3 then 1 else 0 end;
      if lvl > j.idle_alert_level then
        perform app.notify_many(array[j.assignee_id] || leads || case when lvl >= 2 then smp else '{}'::uuid[] end, 'eng_job_alert',
          format('Job not attended – no update or site visit for %s working days', floor(wh)), app.eng_head(j) || ' · ' || app.display_name(j.assignee_id),
          'normal', 'eng_job', j.id, '/engineering/' || j.id);
        update public.eng_jobs set idle_alert_level = lvl where id = j.id; n := n + 1;
      end if;
    end if;
    if j.due_date = today + 1 then
      perform app.notify(j.assignee_id, 'eng_job_alert', 'Job due tomorrow', app.eng_head(j), 'normal', 'eng_job', j.id, '/engineering/' || j.id,
        format('engdue:%s:%s', j.id, j.due_date));
    elsif j.due_date < today then
      perform app.notify_many(array[j.assignee_id] || leads || smp, 'eng_job_alert',
        format('Job overdue – %s days past the deadline', today - j.due_date),
        app.eng_head(j) || ' · ' || app.display_name(j.assignee_id) || ' · ' || replace(j.status, '_', ' '), 'normal', 'eng_job', j.id,
        '/engineering/' || j.id, format('engover:%s:%s', j.id, today));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.eng_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.eng_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('eng-tick', '*/15 * * * *', 'select public.eng_tick()');
  end if;
end $$;

revoke execute on function public.create_eng_job(jsonb), public.update_eng_job(uuid, jsonb), public.reassign_eng_job(uuid, uuid, text),
  public.set_eng_job_due(uuid, date, text), public.cancel_eng_job(uuid, text), public.accept_eng_job(uuid, text), public.hold_eng_job(uuid, text),
  public.review_eng_hold(uuid, text, text, date), public.add_eng_update(uuid, jsonb), public.eng_site_checkin(uuid, double precision, double precision, text),
  public.complete_eng_job(uuid, text) from public, anon;
grant execute on function public.create_eng_job(jsonb), public.update_eng_job(uuid, jsonb), public.reassign_eng_job(uuid, uuid, text),
  public.set_eng_job_due(uuid, date, text), public.cancel_eng_job(uuid, text), public.accept_eng_job(uuid, text), public.hold_eng_job(uuid, text),
  public.review_eng_hold(uuid, text, text, date), public.add_eng_update(uuid, jsonb), public.eng_site_checkin(uuid, double precision, double precision, text),
  public.complete_eng_job(uuid, text) to authenticated;

-- Execution tasks already appointed from meetings become jobs (deadline = the action's due date; the location is set by the
-- Senior Electrical Engineer with "Edit details")
insert into public.eng_jobs (code, job_type, title, project_id, organization_id, meeting_action_id, assignee_id, assigned_by, assigned_at, due_date, original_due_date)
select app.next_code('ENG'), 'other', a.action, a.project_id, a.organization_id, a.id, a.assignee_id, a.assigned_by, coalesce(a.assigned_at, now()),
       greatest(coalesce(a.due_date, current_date + 7), current_date), greatest(coalesce(a.due_date, current_date + 7), current_date)
from public.sales_meeting_actions a
where a.kind = 'execution' and a.status = 'open' and a.assignee_id is not null
  and exists (select 1 from public.profiles where id = a.assignee_id and role in ('assistant_engineer', 'senior_elec_engineer'));
insert into public.eng_job_updates (job_id, by_id, kind, note)
select id, assigned_by, 'assigned', 'From the meeting action – set the job type, site location and check the deadline' from public.eng_jobs;

-- Job photos and documents (copied from 20260930000056, with eng_job / eng_job_update)
create or replace function app.can_write_attachment(p_entity_type text, p_entity_id uuid, p_kind text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role();
begin
  case p_entity_type
  when 'visit' then return exists (select 1 from public.visits where id = p_entity_id and sales_person_id = auth.uid()) or r = 'sm_projects';
  when 'tender' then return exists (select 1 from public.tenders where id = p_entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return exists (select 1 from public.inquiries where id = p_entity_id and (sales_person_id = auth.uid() or r in ('sm_projects', 'gm')));
  when 'design_job' then
    return r = 'design_manager' or exists (select 1 from public.design_jobs where id = p_entity_id and assignee_id = auth.uid());
  when 'estimation_job' then
    return r = 'sm_estimation' or exists (select 1 from public.estimation_jobs where id = p_entity_id and assignee_id = auth.uid());
  when 'clarification' then
    return r in ('design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec');
  when 'sample' then
    return r = 'operations_exec' or exists (select 1 from public.samples where id = p_entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then return r = 'operations_exec';
  when 'retention' then return app.can_edit_retention(p_entity_id);
  when 'bond' then return r = 'operations_exec' and exists (select 1 from public.bonds where id = p_entity_id);
  when 'warranty' then return app.is_warranty_desk() and exists (select 1 from public.warranties where id = p_entity_id);
  when 'warranty_claim' then
    return exists (select 1 from public.warranty_claims c where c.id = p_entity_id and (app.is_warranty_desk() or c.assignee_id = auth.uid()));
  when 'warranty_report' then
    return exists (select 1 from public.warranty_reports x where x.id = p_entity_id and (x.sales_person_id = auth.uid() or app.is_warranty_desk()));
  when 'rma' then return app.is_warranty_desk() and exists (select 1 from public.manufacturer_claims where id = p_entity_id);
  when 'warranty_registration' then return app.is_warranty_desk() and exists (select 1 from public.warranty_registrations where id = p_entity_id);
  when 'eng_job' then
    return exists (select 1 from public.eng_jobs where id = p_entity_id and (assignee_id = auth.uid() or app.is_eng_lead()));
  when 'eng_job_update' then
    return exists (select 1 from public.eng_job_updates u join public.eng_jobs j on j.id = u.job_id
                   where u.id = p_entity_id and (j.assignee_id = auth.uid() or app.is_eng_lead()));
  else return false;
  end case;
end $$;

create or replace function app.can_read_attachment(a public.attachments) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); inq uuid; st text; mode int; released timestamptz;
begin
  if r is null then return false; end if;
  if a.uploaded_by = auth.uid() then return true; end if;
  case a.entity_type
  when 'visit' then
    return r in ('gm', 'sm_projects') or exists (select 1 from public.visits where id = a.entity_id and sales_person_id = auth.uid());
  when 'tender' then
    return r in ('gm', 'sm_projects', 'sm_estimation') or exists (select 1 from public.tenders where id = a.entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return app.can_read_inquiry(a.entity_id);
  when 'design_job' then
    select inquiry_id into inq from public.design_jobs where id = a.entity_id;
    if r in ('gm', 'design_manager') or app.can_read_design_job(a.entity_id) and r in ('lighting_designer', 'lighting_engineer') then return true; end if;
    -- Released design pack: Estimation (on release) and Sales (Route C / mode 3 release / early release)
    if a.kind = 'design_pack' then
      if r in ('sm_estimation', 'am_estimation', 'estimation_exec') then return app.can_read_inquiry(inq); end if;
      select status, release_mode, design_released_to_sales_at into st, mode, released from public.inquiries where id = inq;
      if r in ('sm_projects') or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)) then
        return released is not null;
      end if;
    end if;
    return false;
  when 'estimation_job' then
    select inquiry_id into inq from public.estimation_jobs where id = a.entity_id;
    if a.kind = 'costing_sheet' then return app.can_read_costing(a.entity_id); end if;
    if r in ('gm', 'sm_estimation') or app.can_read_estimation_job(a.entity_id) then return true; end if;
    if r = 'sm_projects' and a.kind in ('quotation_draft', 'quotation_final', 'compliance_sheet', 'technical_data')
       and exists (select 1 from public.estimation_jobs where id = a.entity_id and needs_sm_projects) then
      return true;
    end if;
    -- Sales download only the released quotation and supporting sheets – never the costing sheet
    if a.kind in ('quotation_final', 'compliance_sheet', 'technical_data') then
      return exists (select 1 from public.estimation_jobs where id = a.entity_id and status = 'released')
             and (r = 'sm_projects' or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)));
    end if;
    return false;
  when 'clarification' then
    select inquiry_id into inq from public.clarifications where id = a.entity_id;
    return r in ('gm', 'design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec')
           and app.can_read_inquiry(inq);
  when 'sample' then
    return r in ('gm', 'sm_projects', 'operations_exec') or exists (select 1 from public.samples where id = a.entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then
    return r in ('gm', 'sm_projects', 'operations_exec');
  when 'retention' then
    return exists (select 1 from public.retentions where id = a.entity_id);
  when 'bond' then
    return exists (select 1 from public.bonds where id = a.entity_id);
  when 'warranty' then
    return app.can_read_warranty(a.entity_id);
  when 'warranty_claim' then
    return exists (select 1 from public.warranty_claims where id = a.entity_id);
  when 'warranty_report' then
    return exists (select 1 from public.warranty_reports where id = a.entity_id);
  when 'rma' then
    return exists (select 1 from public.manufacturer_claims where id = a.entity_id);
  when 'warranty_registration' then
    return exists (select 1 from public.warranty_registrations where id = a.entity_id);
  when 'eng_job' then
    return app.can_read_eng_job(a.entity_id);
  when 'eng_job_update' then
    return exists (select 1 from public.eng_job_updates u where u.id = a.entity_id and app.can_read_eng_job(u.job_id));
  else
    return r = 'gm';
  end case;
end $$;
