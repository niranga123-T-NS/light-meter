-- Subcontractor planning: each planned work of a subcontractor's weekly plan names an approved work permit (PTW) covering its
-- day before the plan can be submitted; the supervisor plans from the engineers' approved plans, from the programme
-- activities given to their company, and additional works.

alter table public.sub_plan_items add column if not exists permit_id uuid references public.hse_records (id) on delete set null;
alter table public.sub_plan_items add column if not exists activity_id uuid references public.exec_activities (id) on delete set null;
create unique index if not exists sub_plan_items_activity on public.sub_plan_items (sub_plan_id, activity_id, day) where activity_id is not null;

-- The day a permit covers (Sri Lanka time)
create or replace function app.permit_covers(r public.hse_records, p_day date) returns boolean language sql stable as $$
  select r.code like 'PTW-%' and p_day between (r.starts_at at time zone 'Asia/Colombo')::date and (r.ends_at at time zone 'Asia/Colombo')::date
$$;
create or replace function app.permit_ok(r public.hse_records, p_day date) returns boolean language sql stable as $$
  select app.permit_covers(r, p_day) and r.status in ('active', 'closed')
$$;

-- Link (or unlink) the work permit of a planned work
create or replace function public.set_sub_plan_permit(p_item uuid, p_permit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it public.sub_plan_items; s public.sub_plans; r public.hse_records;
begin
  select * into it from public.sub_plan_items where id = p_item;
  perform app.require(it.id is not null, 'Not found');
  s := app.sub_plan_for_edit(it.sub_plan_id);
  if p_permit is not null then
    select * into r from public.hse_records where id = p_permit;
    perform app.require(r.id is not null and r.exec_project_id = s.exec_project_id and r.code like 'PTW-%' and app.can_see_hse_record(r), 'Choose a work permit of this project');
    perform app.require(r.status in ('submitted', 'active', 'closed'), 'That permit was not approved');
    perform app.require(app.permit_covers(r, it.day), format('Permit %s does not cover %s', r.code, to_char(it.day, 'DD Mon')));
  end if;
  update public.sub_plan_items set permit_id = p_permit where id = it.id;
end $$;

-- Programme activities given to the supervisor's company that run in the plan's week (to pick from)
create or replace function public.sub_plan_activities(p_plan uuid)
returns table (id uuid, code text, name text, start_on date, finish_on date, pct numeric, qty numeric, unit text, picked date[])
language plpgsql stable security definer set search_path = public as $$
declare s public.sub_plans; co text;
begin
  select * into s from public.sub_plans where sub_plans.id = p_plan;
  perform app.require(s.id is not null and app.can_read_sub_plan(s.id), 'Not found');
  co := (select nullif(lower(btrim(company)), '') from public.profiles where profiles.id = s.supervisor_id);
  return query
    select a.id, a.code, a.name, coalesce(a.actual_start, a.es), coalesce(a.actual_finish, a.ef), a.pct, a.qty, a.unit,
           array(select x.day from public.sub_plan_items x where x.sub_plan_id = s.id and x.activity_id = a.id order by x.day)
      from public.exec_activities a
     where a.exec_project_id = s.exec_project_id and a.pct < 100 and a.duration > 0
       and lower(btrim(coalesce(a.subcontractor, ''))) = co
       and coalesce(a.actual_start, a.es) <= s.week_start + 6 and coalesce(a.actual_finish, a.ef, a.es) >= s.week_start
     order by coalesce(a.actual_start, a.es), a.code;
end $$;

-- Tick / untick a programme activity for a day
create or replace function public.pick_sub_plan_activity(p_plan uuid, p_activity uuid, p_day date, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sub_plans := app.sub_plan_for_edit(p_plan); a record;
begin
  select * into a from public.sub_plan_activities(p_plan) x where x.id = p_activity;
  perform app.require(a.id is not null, 'Choose a programme activity of your company running this week');
  perform app.require(p_day between s.week_start and s.week_start + 6, 'Choose a day of this week');
  if p_on then
    insert into public.sub_plan_items (sub_plan_id, day, activity_id, title, qty, unit)
    values (s.id, p_day, a.id, trim(both ' ' from coalesce(a.code, '') || ' ' || a.name), null, a.unit)
    on conflict (sub_plan_id, activity_id, day) where activity_id is not null do nothing;
  else
    delete from public.sub_plan_items where sub_plan_id = s.id and activity_id = a.id and day = p_day;
  end if;
end $$;


drop function if exists public.sub_plan_ae_items(uuid);
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
       -- a supervisor never sees what was given to another supervisor
       and (not app.is_sub() or i.supervisor_id is null or i.supervisor_id = s.supervisor_id)
     order by i.day, i.title;
end $$;

create or replace function public.submit_sub_plan(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sub_plans := app.sub_plan_for_edit(p_plan); bad text;
begin
  perform app.require(exists (select 1 from public.sub_plan_items where sub_plan_id = s.id), 'Pick or add the work for the week first');
  -- every planned work needs an approved work permit covering its day
  select string_agg(format('%s (%s)', i.title, to_char(i.day, 'Dy DD Mon')), ', ' order by i.day, i.title) into bad
    from public.sub_plan_items i left join public.hse_records r on r.id = i.permit_id
   where i.sub_plan_id = s.id and (r.id is null or not app.permit_ok(r, i.day));
  perform app.require(bad is null, 'Each planned work needs an approved work permit for its day – not yet: ' || coalesce(bad, ''));
  update public.sub_plans set status = 'submitted', submitted_at = now() where id = s.id;
  perform app.notify_many(app.project_aes(s.exec_project_id), 'exec_plan', 'Subcontractor plan to approve',
    format('%s · week of %s · %s', app.display_name(s.supervisor_id), to_char(s.week_start, 'DD Mon'), app.exec_head(s.exec_project_id)),
    'normal', 'exec_project', s.exec_project_id, '/execution/sub-plan?plan=' || s.id, null, true);
end $$;

revoke execute on function public.set_sub_plan_permit(uuid, uuid), public.sub_plan_activities(uuid), public.pick_sub_plan_activity(uuid, uuid, date, boolean),
  public.sub_plan_ae_items(uuid) from public, anon;
grant execute on function public.set_sub_plan_permit(uuid, uuid), public.sub_plan_activities(uuid), public.pick_sub_plan_activity(uuid, uuid, date, boolean),
  public.sub_plan_ae_items(uuid) to authenticated, service_role;
