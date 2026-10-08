-- Plan items: only work ("Task") must be linked to a programme activity once the programme is approved.
-- Site meetings, inspections, tests, deliveries and other items may be linked but do not have to be.

drop function if exists app.check_activity(uuid, uuid);
create or replace function app.check_activity(p_exec uuid, p_activity uuid, p_kind text default 'task') returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_activity is null then
    perform app.require(coalesce(p_kind, 'task') <> 'task' or not app.programme_live(p_exec), 'Choose the programme activity this work belongs to');
  else
    perform app.require(exists (select 1 from public.exec_activities where id = p_activity and exec_project_id = p_exec), 'Choose an activity of this project');
    perform app.require((select actual_finish from public.exec_activities where id = p_activity) is null, 'That activity is already finished');
  end if;
end $$;

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
  perform app.check_activity(p_exec, act, coalesce(nullif(p ->> 'kind', ''), 'task'));
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

create or replace function public.decide_supervisor_item(p_id uuid, p_accept boolean, p_reason text default null, p_activity uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare it public.exec_plan_items;
begin
  select * into it from public.exec_plan_items where id = p_id for update;
  perform app.require(it.id is not null and it.source = 'supervisor' and it.acceptance = 'pending', 'Nothing to decide');
  perform app.require(app.is_project_ae(it.exec_project_id) or app.has_role('senior_elec_engineer'), 'Only an Assistant Engineer of the project decides');
  perform app.require(p_accept or coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  if p_accept then perform app.check_activity(it.exec_project_id, p_activity, it.kind); end if;
  update public.exec_plan_items set acceptance = case when p_accept then 'accepted' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    reject_reason = case when p_accept then null else btrim(p_reason) end, activity_id = case when p_accept then p_activity else activity_id end where id = it.id;
  perform app.notify(it.supervisor_id, 'exec_plan', case when p_accept then 'Your added task is accepted – go ahead' else 'Your added task is not accepted' end,
    concat_ws(' · ', it.title, to_char(it.day, 'Dy DD Mon'), app.display_name(auth.uid()), nullif(btrim(p_reason), '')), 'normal', 'exec_project', it.exec_project_id, '/', null, true);
end $$;
