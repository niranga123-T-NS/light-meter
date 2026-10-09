-- Subcontractor plan follows the AEs' plans: a supervisor plans only the work the AEs planned for them – items given to
-- them, or items of a programme activity given to their company – plus their own additional work (programme activities
-- are no longer offered directly). With several subcontractors on a project, the programme activity's subcontractor
-- decides whose work it is: an AE can give such an item only to a supervisor of that company.

drop function if exists public.pick_sub_plan_activity(uuid, uuid, date, boolean);
drop function if exists public.sub_plan_activities(uuid);

-- A supervisor's company (lower case)
create or replace function app.company_of(p_user uuid) returns text language sql stable security definer set search_path = public as $$
  select nullif(lower(btrim(company)), '') from public.profiles where id = p_user
$$;
-- The engineers' plan item is the supervisor's work
create or replace function app.ae_item_for_sup(i public.exec_plan_items, p_sup uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select i.supervisor_id = p_sup
      or (i.supervisor_id is null and i.activity_id is not null
          and exists (select 1 from public.exec_activities a where a.id = i.activity_id
                       and nullif(lower(btrim(a.subcontractor)), '') = app.company_of(p_sup)))
$$;


create or replace function public.sub_plan_ae_items(p_plan uuid)
returns table (id uuid, day date, kind text, title text, zone text, qty numeric, unit text, engineer text, mine boolean, picked boolean, activity text)
language plpgsql stable security definer set search_path = public as $$
declare s public.sub_plans;
begin
  select * into s from public.sub_plans where sub_plans.id = p_plan;
  perform app.require(s.id is not null and app.can_read_sub_plan(s.id), 'Not found');
  return query
    select i.id, i.day, i.kind, i.title, i.zone, i.qty, i.unit, app.display_name(p.ae_id), i.supervisor_id = s.supervisor_id,
           exists (select 1 from public.sub_plan_items x where x.sub_plan_id = s.id and x.ae_item_id = i.id),
           (select trim(both ' ' from a.code || ' ' || a.name) from public.exec_activities a where a.id = i.activity_id)
      from public.exec_plan_items i join public.exec_plans p on p.id = i.plan_id
     where p.exec_project_id = s.exec_project_id and p.status = 'approved' and i.day between s.week_start and s.week_start + 6
       and i.source = 'plan'
       -- only the supervisor's work: given to them, or of a programme activity of their company
       and app.ae_item_for_sup(i, s.supervisor_id)
     order by i.day, i.title;
end $$;

create or replace function public.pick_sub_plan_item(p_plan uuid, p_ae_item uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sub_plans := app.sub_plan_for_edit(p_plan); i public.exec_plan_items;
begin
  select x.* into i from public.exec_plan_items x join public.exec_plans p on p.id = x.plan_id
   where x.id = p_ae_item and p.exec_project_id = s.exec_project_id and p.status = 'approved' and x.day between s.week_start and s.week_start + 6
     and app.ae_item_for_sup(x, s.supervisor_id);
  perform app.require(i.id is not null, 'Choose an item the engineers planned for you this week');
  if p_on then
    insert into public.sub_plan_items (sub_plan_id, day, ae_item_id, title, zone, qty, unit)
    values (s.id, i.day, i.id, i.title, i.zone, i.qty, i.unit) on conflict (sub_plan_id, ae_item_id) do nothing;
  else
    delete from public.sub_plan_items where sub_plan_id = s.id and ae_item_id = i.id;
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
  -- a programme activity given to a subcontractor goes only to a supervisor of that company
  perform app.require(sup is null or act is null or coalesce((select nullif(lower(btrim(subcontractor)), '') from public.exec_activities where id = act), app.company_of(sup)) = app.company_of(sup),
    format('That activity is given to %s – choose a supervisor of %s (or change the activity''s subcontractor in the programme)',
      (select subcontractor from public.exec_activities where id = act), (select subcontractor from public.exec_activities where id = act)));
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
