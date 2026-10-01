-- Fewer, better-targeted alerts (mostly to SM Projects):
--  1. Approval timers escalate to the approvers of the current step only (not the sales person / SM Projects by default),
--     and only once overdue – the approvers already got "Approval needed" when it was raised.
--  2. A replaced or cancelled approval stops its timer (it used to keep running and send "Overdue" alerts).
--  3. "Delayed item completed" is not sent for approvals.
--  4. Route A: the assignment timer is paused while SM Projects considers the design completion date.
--  5. Duplicate-visit alerts only for visits by sales people.

create or replace function app.ladder_recipients(c public.sla_clocks, lvl int) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare
  r uuid[] := array[c.owner_id];
  sp uuid;
  senior public.app_role;
  approver public.app_role;
begin
  if c.entity_type = 'approval' then
    if lvl < 3 then return '{}'; end if;
    select s.approver_role into approver from public.approvals a
      join public.approval_steps s on s.approval_id = a.id and s.step_no = a.current_step
     where a.id = c.entity_id and a.status = 'pending';
    if approver is null then return '{}'; end if;
    r := app.role_users(approver);
    if lvl >= 5 and approver <> 'gm' then r := r || app.role_users('gm'); end if;
    return r;
  end if;
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

create or replace function app.stop_clocks(p_entity_type text, p_entity_id uuid, p_stage text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c record; sp uuid;
begin
  for c in update public.sla_clocks set stopped_at = now()
           where entity_type = p_entity_type and entity_id = p_entity_id and stopped_at is null
             and (p_stage is null or stage = p_stage)
           returning * loop
    -- A separate push when a delayed item is completed (5.4) – work items only, not approvals
    if c.level >= 3 and c.inquiry_id is not null and c.entity_type <> 'approval' then
      select sales_person_id into sp from public.inquiries where id = c.inquiry_id;
      perform app.notify_many(array_append(app.role_users('sm_projects'), sp), 'delay_cleared',
        'Delayed item completed', format('%s: %s is complete', (select code from public.inquiries where id = c.inquiry_id), c.label),
        'normal', 'inquiry', c.inquiry_id, '/inquiries/' || c.inquiry_id);
    end if;
  end loop;
end $$;

-- Any approval that is no longer pending stops its timer (covers replaced / cancelled approvals)
create or replace function app.approvals_stop_clock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'pending' and old.status = 'pending' then
    update public.sla_clocks set stopped_at = now() where entity_type = 'approval' and entity_id = new.id and stopped_at is null;
  end if;
  return new;
end $$;
drop trigger if exists approvals_stop_clock on public.approvals;
create trigger approvals_stop_clock after update of status on public.approvals
for each row execute function app.approvals_stop_clock();

-- Clean up timers already left running for finished approvals
update public.sla_clocks c set stopped_at = now()
  from public.approvals a
 where c.entity_type = 'approval' and a.id = c.entity_id and a.status <> 'pending' and c.stopped_at is null;

-- Route A: pause the assignment timer while the design completion date waits for SM Projects
create or replace function app.inquiries_design_due_clock() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; paused numeric;
begin
  if new.design_due_status is not distinct from old.design_due_status then return new; end if;
  if new.design_due_status = 'pending' then
    update public.sla_clocks set paused_at = now(), hold_reason = 'Design completion date with SM Projects', colour = 'grey'
     where entity_type = 'inquiry' and entity_id = new.id and stage = 'assignment' and stopped_at is null and paused_at is null;
  elsif old.design_due_status = 'pending' then
    for c in select * from public.sla_clocks
              where entity_type = 'inquiry' and entity_id = new.id and stage = 'assignment' and stopped_at is null and paused_at is not null loop
      paused := app.work_minutes_between(c.paused_at, now());
      update public.sla_clocks set paused_at = null, hold_reason = null, paused_minutes = paused_minutes + paused,
        due_at = app.add_work_minutes(due_at, paused)
       where id = c.id;
      perform app.evaluate_clock(c.id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists inquiries_design_due_clock on public.inquiries;
create trigger inquiries_design_due_clock after update of design_due_status on public.inquiries
for each row execute function app.inquiries_design_due_clock();

update public.sla_clocks c set paused_at = now(), hold_reason = 'Design completion date with SM Projects', colour = 'grey'
  from public.inquiries i
 where i.id = c.entity_id and c.entity_type = 'inquiry' and c.stage = 'assignment'
   and i.design_due_status = 'pending' and c.stopped_at is null and c.paused_at is null;

-- Duplicate customer visit: only when a sales person visits another sales person's customer
create or replace function app.visits_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  org_name text;
  last_same record;
begin
  if new.project_id is not null then
    update public.projects set last_activity_at = greatest(last_activity_at, new.checkin_at),
      dormant_since = null, status = case when status = 'dormant' then 'active' else status end
    where id = new.project_id;
    insert into public.project_stakeholders (project_id, organization_id, unit_id, contact_id, category)
    values (new.project_id, new.organization_id, new.unit_id, new.contact_id, new.visit_category)
    on conflict do nothing;
  end if;
  if new.plan_line_id is not null then
    update public.visit_plan_lines set status = 'completed' where id = new.plan_line_id and status = 'planned';
  end if;

  if tg_op = 'INSERT' then
    -- Duplicate customer visit control (4.5)
    owner := app.account_owner(new.organization_id, new.unit_id);
    select name into org_name from public.organizations where id = new.organization_id;
    if owner is not null and owner <> new.sales_person_id
       and exists (select 1 from public.profiles where id = new.sales_person_id and role in ('asm_building', 'asm_infra'))
       and not exists (select 1 from public.visit_plan_lines l where l.id = new.plan_line_id and l.joint_visit_approved) then
      perform app.notify_many(app.role_users('sm_projects'), 'duplicate_visit', 'Duplicate customer visit',
        format('%s checked in at %s (account owner: %s) on %s', app.display_name(new.sales_person_id), org_name,
               app.display_name(owner), to_char(new.checkin_at at time zone app.tz(), 'DD Mon')),
        'normal', 'visit', new.id, '/visits/' || new.id);
      insert into public.approvals (kind, entity_type, entity_id, title, reason, requested_by, payload)
      values ('duplicate_visit', 'visit', new.id, format('Duplicate visit – %s', org_name),
              'Visit to a customer owned by another sales person', new.sales_person_id,
              jsonb_build_object('owner_id', owner, 'visitor_id', new.sales_person_id, 'organization_id', new.organization_id));
      insert into public.approval_steps (approval_id, step_no, approver_role)
      select id, 1, 'sm_projects' from public.approvals where entity_type = 'visit' and entity_id = new.id and kind = 'duplicate_visit';
    end if;
    -- Repeat visit within N days with no new objective (4.5)
    select v.* into last_same from public.visits v
      where v.sales_person_id = new.sales_person_id and v.organization_id = new.organization_id and v.id <> new.id
        and v.checkin_at > new.checkin_at - make_interval(days => app.setting_num('repeat_visit_days', 7)::int)
        and v.primary_objective = new.primary_objective
      order by v.checkin_at desc limit 1;
    if found then
      perform app.notify_many(app.role_users('sm_projects'), 'repeat_visit', 'Possible unproductive visit',
        format('%s visited %s again with the same objective (%s)', app.display_name(new.sales_person_id), org_name, new.primary_objective),
        'normal', 'visit', new.id, '/visits/' || new.id);
    end if;
  end if;
  return new;
end $$;
