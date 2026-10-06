-- Execution step 3: weekly and daily plans.
--  * Each Assistant Engineer plans each project week by week (items per day: task, inspection, test, delivery, meeting),
--    giving items to subcontractor supervisors. The plan for next week is due Saturday 17:00; the Senior Electrical
--    Engineer approves it or returns it with comments.
--  * Supervisors see their items for the day in My Day and mark them done / partly done / not done (with the reason).
--  * A supervisor may add tasks or actions of their own: the project's Assistant Engineers are told at once; the item can
--    start only after an Assistant Engineer accepts it (or it is rejected with the reason).
--  * Alerts: Saturday 12:00 reminder, 17:00 late → the engineer and the Senior Electrical Engineer.

create table public.exec_plans (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  ae_id uuid not null references public.profiles (id),
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'returned')),
  submitted_at timestamptz,
  is_late boolean not null default false,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  unique (exec_project_id, ae_id, week_start)
);

create table public.exec_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.exec_plans (id) on delete cascade,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  day date not null,
  kind text not null default 'task' check (kind in ('task', 'inspection', 'test', 'delivery', 'meeting', 'other')),
  title text not null,
  zone text,
  qty numeric,
  unit text,
  supervisor_id uuid references public.profiles (id),
  source text not null default 'plan' check (source in ('plan', 'supervisor')),
  acceptance text check (acceptance in ('pending', 'accepted', 'rejected')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  reject_reason text,
  status text not null default 'planned' check (status in ('planned', 'done', 'partial', 'not_done')),
  done_qty numeric,
  result_note text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz,
  added_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.exec_plan_items (exec_project_id, day);
create index on public.exec_plan_items (supervisor_id, day);

alter table public.exec_plans enable row level security;
alter table public.exec_plan_items enable row level security;
create policy exec_plans_read on public.exec_plans for select to authenticated using (app.is_exec_internal(exec_project_id));
create policy exec_plan_items_read on public.exec_plan_items for select to authenticated
  using (app.is_exec_internal(exec_project_id) or (app.is_exec_member(exec_project_id) and (supervisor_id = auth.uid() or added_by = auth.uid())));
grant select on public.exec_plans, public.exec_plan_items to authenticated;

create or replace function app.exec_plan_deadline(p_week date) returns timestamptz language sql stable as $$
  select ((p_week - 2) + time '17:00') at time zone app.tz()
$$;

create or replace function app.is_project_ae(p_exec uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.has_role('assistant_engineer') and app.is_exec_member(p_exec)
$$;

create or replace function app.project_aes(p_exec uuid) returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.user_id), '{}') from public.exec_members m join public.profiles p on p.id = m.user_id
  where m.exec_project_id = p_exec and m.active and p.active and p.role = 'assistant_engineer'
$$;

-- Plan of the caller (an Assistant Engineer on the project) for a week; created when needed
create or replace function app.my_plan(p_exec uuid, p_week date) returns public.exec_plans
language plpgsql security definer set search_path = public as $$
declare pl public.exec_plans;
begin
  perform app.require(app.is_project_ae(p_exec), 'Only an Assistant Engineer on this project plans its work');
  perform app.require(extract(isodow from p_week) = 1, 'A plan starts on a Monday');
  select * into pl from public.exec_plans where exec_project_id = p_exec and ae_id = auth.uid() and week_start = p_week;
  if pl.id is null then
    insert into public.exec_plans (exec_project_id, ae_id, week_start) values (p_exec, auth.uid(), p_week) returning * into pl;
  end if;
  return pl;
end $$;

-- p: {id?, day, kind, title, zone, qty, unit, supervisor_id}
create or replace function public.save_plan_item(p_exec uuid, p_week date, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare pl public.exec_plans; it public.exec_plan_items; dy date := (p ->> 'day')::date; sup uuid := nullif(p ->> 'supervisor_id', '')::uuid; iid uuid;
begin
  pl := app.my_plan(p_exec, p_week);
  perform app.require(pl.status <> 'submitted', 'The plan is waiting for approval – it can change after the decision');
  perform app.require(dy between p_week and p_week + 6, 'Choose a day in this week');
  perform app.require(pl.status <> 'approved' or dy >= (now() at time zone app.tz())::date, 'Past days of an approved plan cannot change');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'Describe the work');
  perform app.require(sup is null or exists (select 1 from public.exec_members where exec_project_id = p_exec and user_id = sup and active and member_role = 'sub_supervisor'),
    'Choose a subcontractor supervisor of this project');
  if nullif(p ->> 'id', '') is not null then
    select * into it from public.exec_plan_items where id = (p ->> 'id')::uuid and plan_id = pl.id;
    perform app.require(it.id is not null and it.status = 'planned', 'Only planned items of your plan can be changed');
    update public.exec_plan_items set day = dy, kind = coalesce(p ->> 'kind', kind), title = btrim(p ->> 'title'), zone = nullif(btrim(p ->> 'zone'), ''),
      qty = nullif(p ->> 'qty', '')::numeric, unit = nullif(btrim(p ->> 'unit'), ''), supervisor_id = sup, updated_by = auth.uid(), updated_at = now()
    where id = it.id;
    iid := it.id;
  else
    insert into public.exec_plan_items (plan_id, exec_project_id, day, kind, title, zone, qty, unit, supervisor_id)
    values (pl.id, p_exec, dy, coalesce(p ->> 'kind', 'task'), btrim(p ->> 'title'), nullif(btrim(p ->> 'zone'), ''), nullif(p ->> 'qty', '')::numeric,
            nullif(btrim(p ->> 'unit'), ''), sup)
    returning id into iid;
    -- Added to an approved plan: the supervisor is told now
    if pl.status = 'approved' and sup is not null then
      perform app.notify(sup, 'exec_plan', 'New task in your plan – ' || to_char(dy, 'Dy DD Mon'), btrim(p ->> 'title') || ' · ' || app.exec_head(p_exec),
        'normal', 'exec_project', p_exec, '/', null, true);
    end if;
  end if;
  if pl.status = 'returned' then update public.exec_plans set status = 'draft' where id = pl.id; end if;
  return iid;
end $$;

create or replace function public.delete_plan_item(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it public.exec_plan_items; pl public.exec_plans;
begin
  select * into it from public.exec_plan_items where id = p_id;
  select * into pl from public.exec_plans where id = it.plan_id;
  perform app.require(it.id is not null and pl.ae_id = auth.uid() and it.source = 'plan', 'Only your own planned items can be removed');
  perform app.require(it.status = 'planned' and pl.status in ('draft', 'returned', 'approved'), 'This item can no longer be removed');
  perform app.require(pl.status <> 'approved' or it.day > (now() at time zone app.tz())::date, 'Only future items of an approved plan can be removed');
  delete from public.exec_plan_items where id = it.id;
end $$;

create or replace function public.submit_plan(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl public.exec_plans; late boolean;
begin
  select * into pl from public.exec_plans where id = p_plan for update;
  perform app.require(pl.id is not null and pl.ae_id = auth.uid(), 'Not your plan');
  perform app.require(pl.status in ('draft', 'returned'), 'Already submitted');
  perform app.require(exists (select 1 from public.exec_plan_items where plan_id = pl.id), 'Add the planned work first');
  late := now() > app.exec_plan_deadline(pl.week_start);
  update public.exec_plans set status = 'submitted', submitted_at = now(), is_late = is_late or late where id = pl.id;
  perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_plan',
    format('Weekly plan to approve – %s%s', app.display_name(auth.uid()), case when late then ' (late)' else '' end),
    format('%s · week of %s · %s items', app.exec_head(pl.exec_project_id), to_char(pl.week_start, 'DD Mon'),
           (select count(*) from public.exec_plan_items where plan_id = pl.id)), 'normal', 'exec_plan', pl.id, '/execution/plan/' || pl.id, null, true);
end $$;

create or replace function public.decide_plan(p_plan uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pl public.exec_plans; s uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'Only the Senior Electrical Engineer approves plans');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Say what needs to change');
  select * into pl from public.exec_plans where id = p_plan for update;
  perform app.require(pl.id is not null and pl.status = 'submitted', 'This plan is not waiting for approval');
  update public.exec_plans set status = case when p_approve then 'approved' else 'returned' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(p_note), '') where id = pl.id;
  perform app.notify(pl.ae_id, 'exec_plan', case when p_approve then 'Weekly plan approved' else 'Weekly plan returned – revise and resubmit' end,
    concat_ws(' · ', app.exec_head(pl.exec_project_id), 'week of ' || to_char(pl.week_start, 'DD Mon'), nullif(btrim(p_note), '')),
    'normal', 'exec_plan', pl.id, '/execution/plan/' || pl.id, null, not p_approve);
  if p_approve then
    for s in select distinct supervisor_id from public.exec_plan_items where plan_id = pl.id and supervisor_id is not null loop
      perform app.notify(s, 'exec_plan', 'Your plan for the week of ' || to_char(pl.week_start, 'DD Mon'),
        format('%s · %s items – see My Day each day', app.exec_head(pl.exec_project_id),
               (select count(*) from public.exec_plan_items where plan_id = pl.id and supervisor_id = s)), 'normal', 'exec_project', pl.exec_project_id, '/');
    end loop;
  end if;
end $$;

-- A supervisor adds work of their own: the Assistant Engineers accept it before it starts
-- p: {day, kind, title, zone, qty, unit}
create or replace function public.supervisor_add_item(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare iid uuid; dy date := (p ->> 'day')::date;
begin
  perform app.require(app.has_role('sub_supervisor') and app.is_exec_member(p_exec), 'Only a subcontractor supervisor on this project adds work here');
  perform app.require(dy is not null and dy >= (now() at time zone app.tz())::date, 'Choose today or a later day');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'Describe the task or action');
  insert into public.exec_plan_items (exec_project_id, day, kind, title, zone, qty, unit, supervisor_id, source, acceptance)
  values (p_exec, dy, coalesce(p ->> 'kind', 'task'), btrim(p ->> 'title'), nullif(btrim(p ->> 'zone'), ''), nullif(p ->> 'qty', '')::numeric,
          nullif(btrim(p ->> 'unit'), ''), auth.uid(), 'supervisor', 'pending')
  returning id into iid;
  perform app.notify_many(app.project_aes(p_exec), 'exec_plan_addition', 'Supervisor added a task – accept or reject',
    format('%s · %s · %s · %s', app.display_name(auth.uid()), to_char(dy, 'Dy DD Mon'), btrim(p ->> 'title'), app.exec_head(p_exec)),
    'normal', 'exec_project', p_exec, '/execution/plans', null, true);
  return iid;
end $$;

create or replace function public.decide_supervisor_item(p_id uuid, p_accept boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare it public.exec_plan_items;
begin
  select * into it from public.exec_plan_items where id = p_id for update;
  perform app.require(it.id is not null and it.source = 'supervisor' and it.acceptance = 'pending', 'Nothing to decide');
  perform app.require(app.is_project_ae(it.exec_project_id) or app.has_role('senior_elec_engineer'), 'Only an Assistant Engineer of the project decides');
  perform app.require(p_accept or coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  update public.exec_plan_items set acceptance = case when p_accept then 'accepted' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    reject_reason = case when p_accept then null else btrim(p_reason) end where id = it.id;
  perform app.notify(it.supervisor_id, 'exec_plan', case when p_accept then 'Your added task is accepted – go ahead' else 'Your added task is not accepted' end,
    concat_ws(' · ', it.title, to_char(it.day, 'Dy DD Mon'), app.display_name(auth.uid()), nullif(btrim(p_reason), '')), 'normal', 'exec_project', it.exec_project_id, '/', null, true);
end $$;

-- Result of the day's item: the supervisor it is given to, or an Assistant Engineer of the project
create or replace function public.update_plan_item(p_id uuid, p_status text, p_done_qty numeric default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare it public.exec_plan_items; pl public.exec_plans;
begin
  select * into it from public.exec_plan_items where id = p_id for update;
  perform app.require(it.id is not null, 'Item not found');
  perform app.require(it.supervisor_id = auth.uid() or app.is_project_ae(it.exec_project_id) or app.has_role('senior_elec_engineer'), 'Not your item');
  perform app.require(p_status in ('done', 'partial', 'not_done', 'planned'), 'Choose the result');
  if it.source = 'plan' then
    select * into pl from public.exec_plans where id = it.plan_id;
    perform app.require(pl.status = 'approved', 'The plan is not approved yet');
  else
    perform app.require(it.acceptance = 'accepted', 'Wait until an Assistant Engineer accepts the task');
  end if;
  perform app.require(it.day <= (now() at time zone app.tz())::date, 'You can record the result on the day or later');
  perform app.require(p_status in ('done', 'planned') or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.exec_plan_items set status = p_status, done_qty = p_done_qty, result_note = nullif(btrim(p_note), ''), updated_by = auth.uid(), updated_at = now()
  where id = it.id;
end $$;

-- Saturday 12:00 reminder and 17:00 late alert for next week's plans
create or replace function public.exec_plan_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare local timestamp := p_at at time zone app.tz(); nxt date; r record; n int := 0;
begin
  if extract(isodow from local) <> 6 then return 0; end if;
  nxt := local::date + 2;
  for r in select m.exec_project_id, m.user_id from public.exec_members m join public.profiles p on p.id = m.user_id join public.exec_projects e on e.id = m.exec_project_id
           where m.active and p.active and p.role = 'assistant_engineer' and e.status = 'active'
             and not exists (select 1 from public.exec_plans x where x.exec_project_id = m.exec_project_id and x.ae_id = m.user_id and x.week_start = nxt
                             and x.status in ('submitted', 'approved')) loop
    if local::time >= time '12:00' and local::time < time '17:00' then
      perform app.notify(r.user_id, 'exec_plan', 'Weekly plan due today 17:00', app.exec_head(r.exec_project_id) || ' · week of ' || to_char(nxt, 'DD Mon'),
        'normal', 'exec_project', r.exec_project_id, '/execution/plans', format('planrem:%s:%s:%s', r.exec_project_id, r.user_id, nxt));
      n := n + 1;
    elsif local::time >= time '17:00' then
      perform app.notify_many(array[r.user_id] || app.role_users('senior_elec_engineer'), 'exec_plan_late', 'Weekly plan not submitted by 17:00',
        app.display_name(r.user_id) || ' · ' || app.exec_head(r.exec_project_id) || ' · week of ' || to_char(nxt, 'DD Mon'),
        'normal', 'exec_project', r.exec_project_id, '/execution/plans', format('planlate:%s:%s:%s', r.exec_project_id, r.user_id, nxt));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.exec_plan_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.exec_plan_tick(timestamptz) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('exec-plan-tick', '*/30 * * * 6', 'select public.exec_plan_tick()');
  end if;
end $$;

revoke execute on function public.save_plan_item(uuid, date, jsonb), public.delete_plan_item(uuid), public.submit_plan(uuid), public.decide_plan(uuid, boolean, text),
  public.supervisor_add_item(uuid, jsonb), public.decide_supervisor_item(uuid, boolean, text), public.update_plan_item(uuid, text, numeric, text) from public, anon;
grant execute on function public.save_plan_item(uuid, date, jsonb), public.delete_plan_item(uuid), public.submit_plan(uuid), public.decide_plan(uuid, boolean, text),
  public.supervisor_add_item(uuid, jsonb), public.decide_supervisor_item(uuid, boolean, text), public.update_plan_item(uuid, text, numeric, text) to authenticated;

-- Open items now include current and future plans (moved to the new engineer when reassigned)
create or replace function app.open_items(p_user uuid) returns table (kind text, id uuid, title text, url text)
language sql stable security definer set search_path = public as $$
  select 'Engineering job', j.id, concat_ws(' · ', j.code, j.title), '/engineering/' || j.id
  from public.eng_jobs j where j.assignee_id = p_user and j.status in ('assigned', 'in_progress', 'on_hold')
  union all
  select 'Meeting action', a.id, a.action, '/meetings'
  from public.sales_meeting_actions a where a.status = 'open' and (a.assignee_id = p_user or (a.owner_id = p_user and a.assignee_id is null))
  union all
  select 'Weekly plan', pl.id, app.exec_head(pl.exec_project_id) || ' · week of ' || to_char(pl.week_start, 'DD Mon'), '/execution/plan/' || pl.id
  from public.exec_plans pl where pl.ae_id = p_user and pl.week_start + 6 >= (now() at time zone app.tz())::date
$$;

create or replace function app.reassign_items(p_from uuid, p_to uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  update public.eng_jobs set assignee_id = p_to, assigned_at = now(), status = case when status = 'on_hold' then status else 'assigned' end,
    accepted_at = case when status = 'on_hold' then accepted_at end, accept_alert_level = 0, updated_at = now()
  where assignee_id = p_from and status in ('assigned', 'in_progress', 'on_hold');
  get diagnostics k = row_count; n := n + k;
  update public.sales_meeting_actions set assignee_id = p_to, assigned_at = now(), assigned_by = auth.uid()
  where status = 'open' and assignee_id = p_from;
  get diagnostics k = row_count; n := n + k;
  update public.exec_plans pl set ae_id = p_to
  where pl.ae_id = p_from and pl.week_start + 6 >= (now() at time zone app.tz())::date
    and not exists (select 1 from public.exec_plans x where x.exec_project_id = pl.exec_project_id and x.ae_id = p_to and x.week_start = pl.week_start);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- Approvals tab: weekly plans for the Senior Electrical Engineer
create or replace function app.exec_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
  select 'access_request', r.id, 'exec_access',
         format('%s – %s', case r.kind when 'temp_add' then case r.role_type when 'trainee' then 'Trainee' else 'Temporary Assistant Engineer' end
                                       when 'temp_delete' then 'Delete temporary role' else 'Subcontractor supervisor' end, r.person_name),
         concat_ws(' · ', r.company, r.reason), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid,
         '/execution/access/' || r.id, case r.status when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.access_requests r
  where (r.status = 'pending_smp' and app.has_role('sm_projects')) or (r.status = 'pending_gm' and app.has_role('gm'))
  union all
  select 'exec_plan', pl.id, 'exec_plan', format('Weekly plan – %s – week of %s', app.display_name(pl.ae_id), to_char(pl.week_start, 'DD Mon')),
         concat_ws(' · ', app.exec_head(pl.exec_project_id), case when pl.is_late then 'submitted late' end), pl.ae_id, app.display_name(pl.ae_id),
         pl.submitted_at, null::uuid, '/execution/plan/' || pl.id, null
  from public.exec_plans pl where pl.status = 'submitted' and app.has_role('senior_elec_engineer')
$$;
