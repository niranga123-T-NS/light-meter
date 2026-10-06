-- Weekly plans linked to the programme
--  * Once the programme is approved, every plan item belongs to a programme activity (supervisor additions get
--    their activity when the Assistant Engineer accepts them).
--  * A plan cannot be submitted while a critical activity due that week is missing from it, unless the
--    Assistant Engineer gives the reason (shown to the SEE when approving).
--  * Site results update the activity automatically: actual start, % complete (from quantities when the activity has
--    a quantity, otherwise from the working days done, up to 95 %) and the actual finish when the quantity is complete.
--    The Assistant Engineer corrects it at any time; a later site result only raises the figure.

alter table public.exec_plan_items add column if not exists activity_id uuid references public.exec_activities (id) on delete set null;
create index if not exists exec_plan_items_activity on public.exec_plan_items (activity_id);
alter table public.exec_plans add column if not exists skip_reasons jsonb not null default '{}';
alter table public.exec_activities add column if not exists pct_auto numeric(5, 2);
alter table public.exec_activities add column if not exists auto_at timestamptz;

create or replace function app.programme_live(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.exec_programmes where exec_project_id = p_exec and version > 0)
$$;

create or replace function app.check_activity(p_exec uuid, p_activity uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_activity is null then
    perform app.require(not app.programme_live(p_exec), 'Choose the programme activity this work belongs to');
  else
    perform app.require(exists (select 1 from public.exec_activities where id = p_activity and exec_project_id = p_exec), 'Choose an activity of this project');
    perform app.require((select actual_finish from public.exec_activities where id = p_activity) is null, 'That activity is already finished');
  end if;
end $$;

-- Site results → activity progress
create or replace function app.auto_progress(p_activity uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.exec_activities; s date; f date; done_q numeric; days numeric; v numeric; fin date;
begin
  select * into a from public.exec_activities where id = p_activity for update;
  if a.id is null or not app.programme_live(a.exec_project_id) then return; end if;
  select min(day) filter (where status in ('done', 'partial')), max(day) filter (where status in ('done', 'partial')),
         sum(case status when 'done' then coalesce(done_qty, qty, 0) when 'partial' then coalesce(done_qty, 0) else 0 end),
         count(distinct day) filter (where status = 'done') + 0.5 * count(distinct day) filter (where status = 'partial')
  into s, f, done_q, days
  from public.exec_plan_items i
  where i.activity_id = a.id and (i.source = 'plan' or i.acceptance = 'accepted');
  if s is null then return; end if;
  if coalesce(a.qty, 0) > 0 then
    v := least(100, round(done_q / a.qty * 100, 2));
    fin := case when v >= 100 then f end;
  elsif a.duration > 0 then
    v := least(95, round(days / a.duration * 100, 2));
  else
    v := 100; fin := f;
  end if;
  update public.exec_activities set
    actual_start = coalesce(actual_start, s),
    pct = case when actual_finish is null then greatest(pct, v) else pct end,
    actual_finish = coalesce(actual_finish, fin),
    pct_auto = v, auto_at = now()
  where id = a.id;
  perform app.schedule(a.exec_project_id);
end $$;

-- Plan items carry the activity
create or replace function public.save_plan_item(p_exec uuid, p_week date, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare pl public.exec_plans; it public.exec_plan_items; dy date := (p ->> 'day')::date; sup uuid := nullif(p ->> 'supervisor_id', '')::uuid; iid uuid;
        act uuid := nullif(p ->> 'activity_id', '')::uuid;
begin
  pl := app.my_plan(p_exec, p_week);
  perform app.require(pl.status <> 'submitted', 'The plan is waiting for approval – it can change after the decision');
  perform app.require(dy between p_week and p_week + 6, 'Choose a day in this week');
  perform app.require(pl.status <> 'approved' or dy >= (now() at time zone app.tz())::date, 'Past days of an approved plan cannot change');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'Describe the work');
  perform app.check_activity(p_exec, act);
  perform app.require(sup is null or exists (select 1 from public.exec_members where exec_project_id = p_exec and user_id = sup and active and member_role = 'sub_supervisor'),
    'Choose a subcontractor supervisor of this project');
  if nullif(p ->> 'id', '') is not null then
    select * into it from public.exec_plan_items where id = (p ->> 'id')::uuid and plan_id = pl.id;
    perform app.require(it.id is not null and it.status = 'planned', 'Only planned items of your plan can be changed');
    update public.exec_plan_items set day = dy, kind = coalesce(p ->> 'kind', kind), title = btrim(p ->> 'title'), zone = nullif(btrim(p ->> 'zone'), ''),
      qty = nullif(p ->> 'qty', '')::numeric, unit = nullif(btrim(p ->> 'unit'), ''), supervisor_id = sup, activity_id = act, updated_by = auth.uid(), updated_at = now()
    where id = it.id;
    iid := it.id;
  else
    insert into public.exec_plan_items (plan_id, exec_project_id, day, kind, title, zone, qty, unit, supervisor_id, activity_id)
    values (pl.id, p_exec, dy, coalesce(p ->> 'kind', 'task'), btrim(p ->> 'title'), nullif(btrim(p ->> 'zone'), ''), nullif(p ->> 'qty', '')::numeric,
            nullif(btrim(p ->> 'unit'), ''), sup, act)
    returning id into iid;
    if pl.status = 'approved' and sup is not null then
      perform app.notify(sup, 'exec_plan', 'New task in your plan – ' || to_char(dy, 'Dy DD Mon'), btrim(p ->> 'title') || ' · ' || app.exec_head(p_exec),
        'normal', 'exec_project', p_exec, '/', null, true);
    end if;
  end if;
  if pl.status = 'returned' then update public.exec_plans set status = 'draft' where id = pl.id; end if;
  return iid;
end $$;

-- Critical activities due in the week of a plan that the plan does not cover
create or replace function public.plan_missing_critical(p_plan uuid) returns table (activity_id uuid, code text, name text, es date, ef date)
language sql stable security definer set search_path = public as $$
  select a.id, a.code, a.name, a.es, a.ef
  from public.exec_plans pl join public.exec_activities a on a.exec_project_id = pl.exec_project_id
  where pl.id = p_plan and app.programme_live(pl.exec_project_id) and a.critical and a.actual_finish is null and a.duration > 0
    and a.es <= pl.week_start + 6 and a.ef >= pl.week_start
    and (pl.ae_id = auth.uid() or app.has_role('senior_elec_engineer') or app.is_project_ae(pl.exec_project_id))
    and not exists (select 1 from public.exec_plan_items i where i.activity_id = a.id and i.day between pl.week_start and pl.week_start + 6)
  order by a.es, a.code
$$;

drop function if exists public.submit_plan(uuid);
create or replace function public.submit_plan(p_plan uuid, p_reasons jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare pl public.exec_plans; late boolean; m record; miss text[] := '{}'; reasons jsonb := '{}';
begin
  select * into pl from public.exec_plans where id = p_plan for update;
  perform app.require(pl.id is not null and pl.ae_id = auth.uid(), 'Not your plan');
  perform app.require(pl.status in ('draft', 'returned'), 'Already submitted');
  perform app.require(exists (select 1 from public.exec_plan_items where plan_id = pl.id), 'Add the planned work first');
  if app.programme_live(pl.exec_project_id) then
    perform app.require(not exists (select 1 from public.exec_plan_items where plan_id = pl.id and activity_id is null),
      'Link every planned item to its programme activity');
    for m in select * from public.plan_missing_critical(pl.id) loop
      if coalesce(btrim(p_reasons ->> m.activity_id::text), '') = '' then
        miss := miss || (m.code || ' ' || m.name);
      else
        reasons := reasons || jsonb_build_object(m.activity_id::text, btrim(p_reasons ->> m.activity_id::text));
      end if;
    end loop;
    perform app.require(cardinality(miss) = 0, 'Critical activities due this week are not planned – plan them or give the reason: ' || array_to_string(miss, ', '));
  end if;
  late := now() > app.exec_plan_deadline(pl.week_start);
  update public.exec_plans set status = 'submitted', submitted_at = now(), is_late = is_late or late, skip_reasons = reasons where id = pl.id;
  perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_plan',
    format('Weekly plan to approve – %s%s', app.display_name(auth.uid()), case when late then ' (late)' else '' end),
    format('%s · week of %s · %s items%s', app.exec_head(pl.exec_project_id), to_char(pl.week_start, 'DD Mon'),
           (select count(*) from public.exec_plan_items where plan_id = pl.id),
           case when reasons <> '{}' then format(' · %s critical activit%s not planned', (select count(*) from jsonb_object_keys(reasons)), case when (select count(*) from jsonb_object_keys(reasons)) = 1 then 'y' else 'ies' end) else '' end),
    'normal', 'exec_plan', pl.id, '/execution/plan/' || pl.id, null, true);
end $$;

drop function if exists public.decide_supervisor_item(uuid, boolean, text);
create or replace function public.decide_supervisor_item(p_id uuid, p_accept boolean, p_reason text default null, p_activity uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare it public.exec_plan_items;
begin
  select * into it from public.exec_plan_items where id = p_id for update;
  perform app.require(it.id is not null and it.source = 'supervisor' and it.acceptance = 'pending', 'Nothing to decide');
  perform app.require(app.is_project_ae(it.exec_project_id) or app.has_role('senior_elec_engineer'), 'Only an Assistant Engineer of the project decides');
  perform app.require(p_accept or coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  if p_accept then perform app.check_activity(it.exec_project_id, p_activity); end if;
  update public.exec_plan_items set acceptance = case when p_accept then 'accepted' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    reject_reason = case when p_accept then null else btrim(p_reason) end, activity_id = case when p_accept then p_activity else activity_id end where id = it.id;
  perform app.notify(it.supervisor_id, 'exec_plan', case when p_accept then 'Your added task is accepted – go ahead' else 'Your added task is not accepted' end,
    concat_ws(' · ', it.title, to_char(it.day, 'Dy DD Mon'), app.display_name(auth.uid()), nullif(btrim(p_reason), '')), 'normal', 'exec_project', it.exec_project_id, '/', null, true);
end $$;

-- Results update the linked activity
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
  if it.activity_id is not null then perform app.auto_progress(it.activity_id); end if;
end $$;

revoke execute on function public.save_plan_item(uuid, date, jsonb), public.submit_plan(uuid, jsonb), public.decide_supervisor_item(uuid, boolean, text, uuid),
  public.update_plan_item(uuid, text, numeric, text), public.plan_missing_critical(uuid) from public, anon;
grant execute on function public.save_plan_item(uuid, date, jsonb), public.submit_plan(uuid, jsonb), public.decide_supervisor_item(uuid, boolean, text, uuid),
  public.update_plan_item(uuid, text, numeric, text), public.plan_missing_critical(uuid) to authenticated;
