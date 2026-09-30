-- SLA engine (SRS Section 8): clocks, colours, escalation ladder, repeats, customer-deadline alerts.
-- public.sla_tick() runs every 15 minutes (pg_cron, see the scheduler migration).

create table public.sla_rules (
  stage text primary key,
  label text not null,
  target_minutes int not null check (target_minutes > 0),   -- working minutes
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create trigger audit_sla_rules after insert or update or delete on public.sla_rules for each row execute function app.audit();

create table public.sla_clocks (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid references public.inquiries (id),
  entity_type text not null,          -- inquiry, design_job, estimation_job, approval, clarification
  entity_id uuid not null,
  stage text not null,                -- acceptance, assignment, ack, design, design_review, estimation, quotation_approval, sales_submission, approval, ...
  label text not null,
  owner_id uuid references public.profiles (id),
  owner_team public.team,
  started_at timestamptz not null default now(),
  due_at timestamptz not null,
  target_minutes numeric not null,
  paused_at timestamptz,
  paused_minutes numeric not null default 0,
  hold_reason text,
  stopped_at timestamptz,
  colour text not null default 'green' check (colour in ('green', 'amber', 'red', 'grey')),
  used_pct numeric not null default 0,
  level int not null default 0,       -- 1: 75%, 2: 1 wd before due, 3: overdue L1, 4: L2, 5: L3
  last_repeat_on date,
  delay_reason text,
  revised_due_at timestamptz,
  created_at timestamptz not null default now()
);
create index sla_clocks_open on public.sla_clocks (entity_type, entity_id) where stopped_at is null;
create index on public.sla_clocks (inquiry_id);
create index on public.sla_clocks (owner_id) where stopped_at is null;

create or replace function app.sla_target(p_stage text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select target_minutes from public.sla_rules where stage = p_stage), 540)
$$;

create or replace function app.start_clock(
  p_inquiry uuid, p_entity_type text, p_entity_id uuid, p_stage text, p_owner uuid, p_due timestamptz default null, p_label text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  due timestamptz;
  target numeric;
  cid uuid;
begin
  -- one open clock per entity + stage
  update public.sla_clocks set stopped_at = now()
  where entity_type = p_entity_type and entity_id = p_entity_id and stage = p_stage and stopped_at is null;

  if p_due is not null then
    due := p_due;
    target := greatest(app.work_minutes_between(now(), p_due), 1);
  else
    target := app.sla_target(p_stage);
    due := app.add_work_minutes(now(), target);
  end if;
  insert into public.sla_clocks (inquiry_id, entity_type, entity_id, stage, label, owner_id, owner_team, due_at, target_minutes)
  values (p_inquiry, p_entity_type, p_entity_id, p_stage,
          coalesce(p_label, (select label from public.sla_rules where stage = p_stage), p_stage),
          p_owner, (select team from public.profiles where id = p_owner), due, target)
  returning id into cid;
  return cid;
end $$;

create or replace function app.stop_clocks(p_entity_type text, p_entity_id uuid, p_stage text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c record; sp uuid;
begin
  for c in update public.sla_clocks set stopped_at = now()
           where entity_type = p_entity_type and entity_id = p_entity_id and stopped_at is null
             and (p_stage is null or stage = p_stage)
           returning * loop
    -- A separate push when a delayed item is completed (5.4)
    if c.level >= 3 and c.inquiry_id is not null then
      select sales_person_id into sp from public.inquiries where id = c.inquiry_id;
      perform app.notify_many(array_append(app.role_users('sm_projects'), sp), 'delay_cleared',
        'Delayed item completed', format('%s: %s is complete', (select code from public.inquiries where id = c.inquiry_id), c.label),
        'normal', 'inquiry', c.inquiry_id, '/inquiries/' || c.inquiry_id);
    end if;
  end loop;
end $$;

create or replace function app.pause_clocks(p_entity_type text, p_entity_id uuid, p_reason text)
returns void language sql security definer set search_path = public as $$
  update public.sla_clocks set paused_at = now(), hold_reason = p_reason, colour = 'grey'
  where entity_type = p_entity_type and entity_id = p_entity_id and stopped_at is null and paused_at is null;
$$;

create or replace function app.resume_clocks(p_entity_type text, p_entity_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record; paused numeric;
begin
  for c in select * from public.sla_clocks
           where entity_type = p_entity_type and entity_id = p_entity_id and stopped_at is null and paused_at is not null loop
    paused := app.work_minutes_between(c.paused_at, now());
    update public.sla_clocks set paused_at = null, hold_reason = null,
      paused_minutes = paused_minutes + paused,
      due_at = app.add_work_minutes(due_at, paused)
    where id = c.id;
  end loop;
  perform app.evaluate_clock(id) from public.sla_clocks
    where entity_type = p_entity_type and entity_id = p_entity_id and stopped_at is null;
end $$;

-- Recalculate colour and used % of one clock (8.2). Returns the ladder level reached now.
create or replace function app.evaluate_clock(p_clock uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  c public.sla_clocks;
  used numeric;
  remaining numeric;
  day_min numeric := app.working_minutes_per_day();
  pct numeric;
  v_colour text;
  lvl int := 0;
  overdue numeric;
begin
  select * into c from public.sla_clocks where id = p_clock;
  if c.stopped_at is not null then return c.level; end if;
  if c.paused_at is not null then
    update public.sla_clocks set colour = 'grey' where id = c.id;
    return c.level;
  end if;
  used := app.work_minutes_between(c.started_at, now()) - c.paused_minutes;
  pct := case when c.target_minutes > 0 then 100 * used / c.target_minutes else 100 end;
  if now() > c.due_at then
    remaining := 0;
    overdue := app.work_minutes_between(c.due_at, now());
  else
    remaining := app.work_minutes_between(now(), c.due_at);
    overdue := 0;
  end if;

  v_colour := case
    when now() > c.due_at then 'red'
    when pct >= 75 or remaining < day_min then 'amber'
    else 'green' end;

  if pct >= 75 then lvl := 1; end if;
  if remaining <= day_min and c.target_minutes > day_min then lvl := 2; end if;
  if now() > c.due_at then lvl := 3; end if;
  if overdue >= day_min then lvl := 4; end if;
  if overdue >= 2 * day_min then lvl := 5; end if;

  update public.sla_clocks set colour = v_colour, used_pct = round(pct, 1) where id = c.id;
  return lvl;
end $$;

-- Recipients for a ladder level (8.3)
create or replace function app.ladder_recipients(c public.sla_clocks, lvl int) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare
  r uuid[] := array[c.owner_id];
  sp uuid;
  senior public.app_role;
begin
  if lvl >= 2 then r := r || app.manager_of(c.owner_id); end if;
  if lvl >= 3 then
    select sales_person_id into sp from public.inquiries where id = c.inquiry_id;
    r := r || sp || app.role_users('sm_projects');
  end if;
  if lvl >= 4 then
    senior := case when c.owner_team = 'estimation' then 'sm_estimation'::public.app_role else 'sm_projects'::public.app_role end;
    r := r || app.role_users(senior);
  end if;
  if lvl >= 5 then r := r || app.role_users('gm'); end if;
  return r;
end $$;

create or replace function app.ladder_text(lvl int) returns text
language sql immutable as $$
  select case lvl
    when 1 then '75% of time used'
    when 2 then 'Due within 1 working day'
    when 3 then 'Overdue'
    when 4 then 'Overdue 1 working day (Level 2)'
    when 5 then 'Overdue 2 working days (Level 3)'
    else '' end
$$;

-- Refresh the inquiry summary: current owner, due date, colour (5.2 "one owner and one due date")
create or replace function app.refresh_inquiry(p_inquiry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c record;
  worst text;
  pct int;
  i public.inquiries;
begin
  select * into i from public.inquiries where id = p_inquiry;
  if not found then return; end if;
  select owner_id, owner_team, due_at, revised_due_at, delay_reason into c from public.sla_clocks
   where inquiry_id = p_inquiry and stopped_at is null and entity_type <> 'approval'
   order by due_at desc limit 1;
  select case
      when bool_or(colour = 'red') then 'red'
      when bool_and(colour = 'grey') then 'grey'
      when bool_or(colour = 'amber') then 'amber'
      else 'green' end
    into worst from public.sla_clocks where inquiry_id = p_inquiry and stopped_at is null and entity_type <> 'approval';

  pct := case i.status
    when 'draft' then 0 when 'returned_for_info' then 5 when 'submitted' then 5 when 'accepted' then 10
    when 'in_design' then 15 + coalesce((select avg(progress_pct) from public.design_jobs
                                         where inquiry_id = p_inquiry and revision = i.revision), 0)::int * (case when i.route = 'A' then 35 else 70 end) / 100
    when 'design_review' then case when i.route = 'A' then 45 else 85 end
    when 'design_approved' then case when i.route = 'A' then 50 else 95 end
    when 'in_estimation' then case when i.route = 'A' then 60 else 30 end
    when 'estimation_review' then 85
    when 'quotation_released' then 100 when 'returned_to_sales' then 100
    when 'submitted_to_client' then 100 when 'awaiting_client_approval' then 100 when 'client_approved' then 100
    when 'won' then 100 when 'lost' then 100 else i.progress_pct end;

  perform set_config('app.workflow', '1', true);
  update public.inquiries set
    current_owner_id = coalesce(c.owner_id, case when status in ('quotation_released', 'returned_to_sales', 'submitted_to_client',
                                                                 'awaiting_client_approval', 'client_approved', 'draft', 'returned_for_info')
                                                 then sales_person_id else current_owner_id end),
    current_team = coalesce(c.owner_team, current_team),
    current_due_at = c.due_at,
    revised_due_at = c.revised_due_at,
    delay_reason = c.delay_reason,
    sla_colour = coalesce(worst, case when status = 'on_hold' then 'grey' else 'green' end),
    progress_pct = pct
  where id = p_inquiry;
end $$;

-- The assignee enters a delay reason and revised date (8.3); clears the red flag on their own screen.
create or replace function public.set_delay_reason(p_clock uuid, p_reason text, p_revised_due timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare c public.sla_clocks; sp uuid;
begin
  select * into c from public.sla_clocks where id = p_clock;
  if c.owner_id <> auth.uid() and not app.has_role('design_manager', 'sm_estimation', 'sm_projects', 'gm') then
    raise exception 'Only the owner or their manager can enter the delay reason';
  end if;
  if coalesce(trim(p_reason), '') = '' or p_revised_due is null then raise exception 'Reason and revised date are required'; end if;
  update public.sla_clocks set delay_reason = p_reason, revised_due_at = p_revised_due where id = p_clock;
  if c.inquiry_id is not null then
    perform app.refresh_inquiry(c.inquiry_id);
    select sales_person_id into sp from public.inquiries where id = c.inquiry_id;
    perform app.notify_many(array_append(app.role_users('sm_projects'), sp), 'delay_revised', 'Revised date for delayed item',
      format('%s – %s: %s. Revised date %s', (select code from public.inquiries where id = c.inquiry_id), c.label, p_reason,
             to_char(p_revised_due at time zone app.tz(), 'DD Mon HH24:MI')),
      'normal', 'inquiry', c.inquiry_id, '/inquiries/' || c.inquiry_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The tick: evaluate every open clock, fire the ladder, repeat overdue notices at 09:00,
-- customer-deadline alerts, re-send unopened critical/approval pushes.
-- ---------------------------------------------------------------------------
create or replace function public.sla_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.sla_clocks;
  lvl int;
  code text;
  loc timestamp := now() at time zone app.tz();
  today date := loc::date;
  morning boolean := app.is_working_day(today) and loc::time >= time '09:00';
  fired int := 0;
  i record;
  inquiries_touched uuid[] := '{}';
begin
  for c in select * from public.sla_clocks where stopped_at is null loop
    lvl := app.evaluate_clock(c.id);
    select coalesce(ii.code, '') into code from public.inquiries ii where ii.id = c.inquiry_id;
    if lvl > c.level then
      perform app.notify_many(app.ladder_recipients(c, lvl), 'sla_level_' || lvl,
        app.ladder_text(lvl) || ': ' || c.label,
        format('%s %s · owner %s · due %s', code, c.label, app.display_name(c.owner_id),
               to_char(c.due_at at time zone app.tz(), 'DD Mon HH24:MI')),
        case when lvl >= 5 then 'critical'::public.priority else 'normal'::public.priority end,
        c.entity_type, c.entity_id,
        case when c.inquiry_id is not null then '/inquiries/' || c.inquiry_id else null end,
        format('sla:%s:%s', c.id, lvl), lvl >= 3);
      update public.sla_clocks set level = lvl, last_repeat_on = case when lvl >= 3 then today else last_repeat_on end where id = c.id;
      fired := fired + 1;
    elsif lvl >= 3 and morning and coalesce(c.last_repeat_on, date '1900-01-01') < today then
      -- Overdue repeats every working morning at 09:00 until the item moves
      perform app.notify_many(app.ladder_recipients(c, lvl), 'sla_overdue_repeat', 'Still overdue: ' || c.label,
        format('%s %s · %s working days overdue · owner %s', code, c.label,
               round(app.work_minutes_between(c.due_at, now()) / app.working_minutes_per_day(), 1), app.display_name(c.owner_id)),
        case when lvl >= 5 then 'critical'::public.priority else 'normal'::public.priority end,
        c.entity_type, c.entity_id,
        case when c.inquiry_id is not null then '/inquiries/' || c.inquiry_id else null end,
        format('sla:%s:repeat:%s', c.id, today), true);
      update public.sla_clocks set last_repeat_on = today where id = c.id;
      fired := fired + 1;
    end if;
    if c.inquiry_id is not null and not c.inquiry_id = any (inquiries_touched) then
      inquiries_touched := inquiries_touched || c.inquiry_id;
    end if;
  end loop;

  perform app.refresh_inquiry(x) from unnest(inquiries_touched) x;

  -- Customer deadline within 2 days and inquiry not released (Critical)
  for i in select * from public.inquiries
           where status in ('submitted', 'accepted', 'in_design', 'design_review', 'design_approved', 'in_estimation', 'estimation_review')
             and customer_deadline is not null and not deadline_critical_sent
             and customer_deadline <= today + 2 loop
    perform app.notify_many(
      array[i.sales_person_id, i.current_owner_id, app.manager_of(i.current_owner_id)]
        || app.role_users('sm_projects') || app.role_users('gm')
        || case when i.current_team = 'design' then app.role_users('design_manager')
                when i.current_team = 'estimation' then app.role_users('sm_estimation') else '{}'::uuid[] end,
      'customer_deadline_risk', 'Critical: customer deadline in 2 days',
      format('%s – %s (%s) is not released. Customer deadline %s.', i.code, i.project_name, i.customer_name, to_char(i.customer_deadline, 'DD Mon')),
      'critical', 'inquiry', i.id, '/inquiries/' || i.id, 'cd2:' || i.id, true);
    perform set_config('app.workflow', '1', true);
    update public.inquiries set deadline_critical_sent = true where id = i.id;
  end loop;

  -- Customer deadline missed without a released submission → GM / DGM (8.3)
  for i in select * from public.inquiries
           where status in ('submitted', 'accepted', 'in_design', 'design_review', 'design_approved', 'in_estimation', 'estimation_review')
             and customer_deadline < today and not deadline_missed_sent loop
    perform app.notify_many(app.role_users('gm'), 'customer_deadline_missed', 'Customer deadline missed',
      format('%s – %s (%s): deadline %s passed without a released submission.', i.code, i.project_name, i.customer_name,
             to_char(i.customer_deadline, 'DD Mon')),
      'critical', 'inquiry', i.id, '/inquiries/' || i.id, 'cdmiss:' || i.id, true);
    perform set_config('app.workflow', '1', true);
    update public.inquiries set deadline_missed_sent = true where id = i.id;
  end loop;

  -- Unanswered clarification after 1 working day → Design Manager (7.5)
  for i in select cl.*, inq.code from public.clarifications cl join public.inquiries inq on inq.id = cl.inquiry_id
           where cl.answered_at is null and not cl.overdue_flagged
             and app.work_minutes_between(cl.asked_at, now()) >= app.working_minutes_per_day() loop
    perform app.notify_many(app.role_users('design_manager'), 'clarification_overdue', 'Clarification unanswered',
      format('%s: "%s"', i.code, left(i.question, 80)), 'normal', 'inquiry', i.inquiry_id, '/inquiries/' || i.inquiry_id);
    update public.clarifications set overdue_flagged = true where id = i.id;
  end loop;

  -- Critical / approval / overdue push not opened in 2 working hours → re-send once, stays pinned (8.4)
  update public.notifications set pushed_at = null, resent_at = now()
  where requires_open and read_at is null and resent_at is null and pushed_at is not null
    and app.work_minutes_between(pushed_at, now()) >= 120;

  return jsonb_build_object('fired', fired, 'at', now());
end $$;
