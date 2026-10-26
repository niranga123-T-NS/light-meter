-- Clarifications from Estimation to Design stop the estimation clock:
--  * Asking: the estimate's clocks pause ("Waiting for Design clarification") and the question gets an answer-by time –
--    1 working day, or half of the working time left to the estimation due date when that is shorter (at least 1 hour).
--  * While any clarification of the estimate is open the clocks stay paused (a hold resumed meanwhile keeps them paused).
--  * Answered (the last open one): the clocks restart and the estimation due date moves later by the working time paused.
--    The client deadline / tender closing never moves – SM Estimation is warned when the new due date eats into the
--    check and release time.
--  * Late answers: at the answer-by time the designer and the Design Manager are reminded; half a working day later it
--    goes to SM Projects.
--  * Deadline near with a clarification open: 3 working days before the client deadline / tender closing a warning,
--    2 working days before a Critical alert every working day from 09:00, on the deadline day a Critical alert with the DGM –
--    to the designer, the Design Manager, the estimator, SM Estimation and SM Projects.

alter table public.clarifications
  add column if not exists answer_by timestamptz,
  add column if not exists paused_minutes numeric not null default 0,
  add column if not exists reminded_at timestamptz,
  add column if not exists escalated_at timestamptz;

alter table public.estimation_jobs
  add column if not exists clar_paused_at timestamptz,
  add column if not exists clar_paused_minutes numeric not null default 0;

create or replace function app.est_working(s text) returns boolean
language sql immutable as $$ select s in ('assigned', 'acknowledged', 'in_progress', 'date_change_requested', 'returned', 'on_hold') $$;

create or replace function public.ask_clarification(p_job uuid, p_question text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  j public.estimation_jobs := app.est_job(p_job);
  i public.inquiries := app.inq(j.inquiry_id);
  dj record; cid uuid; day numeric := app.working_minutes_per_day(); left_min numeric; ab timestamptz;
begin
  perform app.require(j.assignee_id = auth.uid() or app.has_role('sm_estimation'), 'Not allowed');
  perform app.require(app.est_working(j.status), 'Clarifications can be asked only while the estimate is being worked on');
  perform app.require(coalesce(trim(p_question), '') <> '', 'Write the question');
  select id, assignee_id into dj from public.design_jobs where inquiry_id = j.inquiry_id order by revision desc, created_at desc limit 1;
  perform app.require(dj.id is not null, 'This inquiry has no design job to ask');
  left_min := app.work_minutes_between(now(), coalesce(j.due_at, app.deadline_end(i), app.add_work_minutes(now(), 2 * day)));
  ab := app.add_work_minutes(now(), greatest(60, least(day, left_min / 2)));
  -- overdue_flagged: the old 1-day rule of sla_tick is replaced by clarification_tick
  insert into public.clarifications (inquiry_id, estimation_job_id, design_job_id, question, answer_by, overdue_flagged)
  values (j.inquiry_id, j.id, dj.id, btrim(p_question), ab, true) returning id into cid;
  if j.clar_paused_at is null then
    update public.estimation_jobs set clar_paused_at = now() where id = j.id;
    perform app.pause_clocks('estimation_job', j.id, 'Waiting for Design clarification');
  end if;
  perform app.log_status('estimation_job', j.id, j.inquiry_id, j.status, j.status, 'Clarification to Design – estimation clock stopped');
  perform app.notify_many(array[dj.assignee_id] || case when dj.assignee_id is null then app.role_users('design_manager') else '{}'::uuid[] end,
    'clarification', 'Clarification from Estimation: ' || i.code,
    format('Answer by %s – the estimate is paused until you answer. %s', to_char(ab at time zone app.tz(), 'DD Mon HH24:MI'), left(btrim(p_question), 140)),
    'normal', 'design_job', dj.id, '/design/' || dj.id);
  perform app.refresh_inquiry(j.inquiry_id);
  return cid;
end $$;

create or replace function public.answer_clarification(p_clarification uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.clarifications; j public.estimation_jobs; i public.inquiries; paused numeric; latest timestamptz; code text;
begin
  select * into c from public.clarifications where id = p_clarification for update;
  perform app.require(c.id is not null, 'Clarification not found');
  perform app.require(app.has_role('design_manager') or exists (select 1 from public.design_jobs where id = c.design_job_id and assignee_id = auth.uid()),
    'Only the designer can answer');
  perform app.require(c.answered_at is null, 'Already answered');
  perform app.require(coalesce(trim(p_answer), '') <> '', 'Write the answer');
  update public.clarifications set answer = btrim(p_answer), answered_by = auth.uid(), answered_at = now(),
    paused_minutes = app.work_minutes_between(asked_at, now()) where id = c.id;
  j := app.est_job(c.estimation_job_id);
  i := app.inq(c.inquiry_id);
  code := i.code;
  -- the last open clarification of the estimate: restart the clock and move the due date by the time paused
  if j.clar_paused_at is not null and not exists (select 1 from public.clarifications where estimation_job_id = j.id and answered_at is null) then
    paused := app.work_minutes_between(j.clar_paused_at, now());
    update public.estimation_jobs set clar_paused_at = null, clar_paused_minutes = clar_paused_minutes + paused,
      due_at = case when due_at is not null and app.est_working(status) then app.add_work_minutes(due_at, paused) else due_at end
     where id = j.id returning * into j;
    if j.status <> 'on_hold' then perform app.resume_clocks('estimation_job', j.id); end if;
    perform app.log_status('estimation_job', j.id, j.inquiry_id, j.status, j.status,
      format('Clarification answered – estimation clock restarted, due date moved by %s working hours', round(paused / 60, 1)));
    latest := (app.deadline_split(i) ->> 'estimation_due')::timestamptz;
    if j.due_at is not null and latest is not null and j.due_at > latest and app.est_working(j.status) then
      perform app.notify_many(app.role_users('sm_estimation') || array[j.assignee_id], 'clarification_due_risk',
        'Estimate due date now past the release time: ' || code,
        format('After the clarification the estimate is due %s – later than %s, which leaves the check and release time before the %s (%s). Plan the release or ask for more time.',
          to_char(j.due_at at time zone app.tz(), 'DD Mon HH24:MI'), to_char(latest at time zone app.tz(), 'DD Mon HH24:MI'),
          case when i.deadline_type = 'tender' then 'tender closing' else 'client deadline' end, to_char(app.deadline_end(i) at time zone app.tz(), 'DD Mon HH24:MI')),
        'normal', 'estimation_job', j.id, '/estimation/' || j.id);
    end if;
  end if;
  perform app.notify(c.asked_by, 'clarification_answered', 'Clarification answered: ' || code,
    format('%s%s', left(btrim(p_answer), 140), case when j.clar_paused_at is null then ' · the estimate clock is running again' else ' · other clarifications still open' end),
    'normal', 'estimation_job', c.estimation_job_id, '/estimation/' || c.estimation_job_id);
  perform app.refresh_inquiry(c.inquiry_id);
end $$;

-- Resuming a hold keeps the clock stopped while a clarification is still open
create or replace function public.resume_job(p_entity_type text, p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inq uuid; waiting boolean := false;
begin
  if p_entity_type = 'design_job' then
    update public.design_jobs set status = coalesce(status_before_hold, 'in_progress'), hold_reason = null, hold_waiting_on = null
      where id = p_job and status = 'on_hold' returning inquiry_id into inq;
  else
    perform app.require(app.has_role('sm_estimation', 'gm') or exists (select 1 from public.estimation_jobs where id = p_job and assignee_id = auth.uid()), 'Not allowed');
    update public.estimation_jobs set status = coalesce(status_before_hold, 'in_progress'), hold_reason = null
      where id = p_job and status = 'on_hold' returning inquiry_id, clar_paused_at is not null into inq, waiting;
  end if;
  perform app.require(inq is not null, 'Job is not on hold');
  if waiting then
    update public.sla_clocks set hold_reason = 'Waiting for Design clarification'
     where entity_type = p_entity_type and entity_id = p_job and stopped_at is null and paused_at is not null;
  else
    perform app.resume_clocks(p_entity_type, p_job);
  end if;
  perform app.log_status(p_entity_type, p_job, inq, 'on_hold', 'in_progress');
  perform app.refresh_inquiry(inq);
end $$;

-- Every 15 minutes: late answers and deadlines near with a clarification open
create or replace function public.clarification_tick() returns int
language plpgsql security definer set search_path = public as $$
declare
  c record; q record; n int := 0; day numeric := app.working_minutes_per_day();
  e timestamptz; days_left numeric; who uuid[]; lt timestamp := now() at time zone app.tz(); body text; kind_txt text;
begin
  -- 1. answer-by passed → designer + Design Manager; half a working day later → SM Projects
  for c in select cl.*, i.code, d.assignee_id designer from public.clarifications cl join public.inquiries i on i.id = cl.inquiry_id
           left join public.design_jobs d on d.id = cl.design_job_id
           where cl.answered_at is null and cl.answer_by is not null and cl.answer_by < now() and (cl.reminded_at is null or cl.escalated_at is null) loop
    if c.reminded_at is null then
      perform app.notify_many(array[c.designer] || app.role_users('design_manager'), 'clarification_overdue', 'Clarification not answered in time: ' || c.code,
        format('Due %s – Estimation is paused until it is answered. "%s"', to_char(c.answer_by at time zone app.tz(), 'DD Mon HH24:MI'), left(c.question, 100)),
        'normal', 'design_job', c.design_job_id, '/design/' || c.design_job_id, 'clr:' || c.id);
      update public.clarifications set reminded_at = now() where id = c.id;
      n := n + 1;
    elsif app.work_minutes_between(c.answer_by, now()) >= day / 2 then
      perform app.notify_many(app.role_users('sm_projects'), 'clarification_escalated', 'Clarification unanswered – escalated: ' || c.code,
        format('Asked %s by %s, answer was due %s. Designer: %s. Estimation is paused. "%s"', to_char(c.asked_at at time zone app.tz(), 'DD Mon HH24:MI'),
          app.display_name(c.asked_by), to_char(c.answer_by at time zone app.tz(), 'DD Mon HH24:MI'), coalesce(app.display_name(c.designer), 'not assigned'), left(c.question, 100)),
        'critical', 'inquiry', c.inquiry_id, app.inquiry_url(c.inquiry_id), 'cle:' || c.id);
      update public.clarifications set escalated_at = now() where id = c.id;
      n := n + 1;
    end if;
  end loop;

  -- 2. client deadline / tender closing near while a clarification is open
  for q in select i.*, app.deadline_end(i) e_end, count(*) open_n, min(cl.asked_at) oldest,
                  array_agg(distinct d.assignee_id) designers, array_agg(distinct ej.assignee_id) estimators
           from public.clarifications cl join public.inquiries i on i.id = cl.inquiry_id
           left join public.design_jobs d on d.id = cl.design_job_id
           left join public.estimation_jobs ej on ej.id = cl.estimation_job_id
           where cl.answered_at is null
             and i.status not in ('draft', 'won', 'lost', 'cancelled', 'rejected', 'quotation_released', 'submitted_to_client', 'returned_to_sales')
           group by i.id loop
    e := q.e_end;
    continue when e is null or e <= now();
    days_left := app.work_minutes_between(now(), e) / day;
    continue when days_left > 3;
    who := q.designers || q.estimators || app.role_users('design_manager') || app.role_users('sm_estimation') || app.role_users('sm_projects');
    kind_txt := case when q.deadline_type = 'tender' then 'Tender closes' else 'Client deadline' end;
    body := format('%s – %s. %s %s. %s clarification%s to Design open since %s – Estimation is paused.', q.code, coalesce(q.inquiry_name, q.project_name), kind_txt,
      to_char(e at time zone app.tz(), 'DD Mon HH24:MI'), q.open_n, case when q.open_n > 1 then 's' else '' end, to_char(q.oldest at time zone app.tz(), 'DD Mon HH24:MI'));
    if (e at time zone app.tz())::date = lt::date then
      if lt::time >= time '09:00' or not exists (select 1 from public.notifications where dedupe_key = 'cld:' || q.id || ':' || lt::date) then
        perform app.notify_many(who || app.role_users('gm'), 'clarification_deadline_day', 'Critical – deadline today, clarification open: ' || q.code,
          body, 'critical', 'inquiry', q.id, app.inquiry_url(q.id), 'cld:' || q.id || ':' || lt::date, true);
      end if;
    elsif days_left <= 2 then
      if lt::time >= time '09:00' or not exists (select 1 from public.notifications where kind = 'clarification_deadline_critical' and entity_id = q.id) then
        perform app.notify_many(who, 'clarification_deadline_critical', 'Critical – deadline in 2 days, clarification open: ' || q.code,
          body, 'critical', 'inquiry', q.id, app.inquiry_url(q.id), 'clc:' || q.id || ':' || lt::date, true);
      end if;
    else
      perform app.notify_many(who, 'clarification_deadline_warning', 'Deadline in 3 days, clarification open: ' || q.code,
        body, 'normal', 'inquiry', q.id, app.inquiry_url(q.id), 'clw:' || q.id || ':' || to_char(e, 'YYYYMMDDHH24MI'));
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.clarification_tick() from public, anon, authenticated;
grant execute on function public.clarification_tick() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('clarification-tick', '*/15 * * * *', 'select public.clarification_tick()');
  end if;
end $$;

-- open clarifications asked before this change: answer by 1 working day after asking, clock as it was
update public.clarifications set answer_by = app.add_work_minutes(asked_at, app.working_minutes_per_day()), overdue_flagged = true
 where answered_at is null and answer_by is null;
