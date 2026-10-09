-- Subcontractor weekly / daily plan: the subcontractor supervisor plans each week of a project day by day – picking items
-- from the Assistant Engineers' approved plans for that week, plus additional works of their own – and submits it; an
-- Assistant Engineer of the project approves it or returns it with comments. Each day the supervisor marks the items done /
-- partly done / not done.

create table if not exists public.sub_plans (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  supervisor_id uuid not null references public.profiles (id),
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'returned')),
  submitted_at timestamptz,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  unique (exec_project_id, supervisor_id, week_start)
);
create table if not exists public.sub_plan_items (
  id uuid primary key default gen_random_uuid(),
  sub_plan_id uuid not null references public.sub_plans (id) on delete cascade,
  day date not null,
  ae_item_id uuid references public.exec_plan_items (id) on delete set null,
  title text not null,
  zone text,
  qty numeric,
  unit text,
  crew int,
  additional boolean not null default false,
  status text not null default 'planned' check (status in ('planned', 'done', 'partial', 'not_done')),
  done_qty numeric,
  result_note text,
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (sub_plan_id, ae_item_id)
);
create index if not exists sub_plan_items_plan on public.sub_plan_items (sub_plan_id, day);

create or replace function app.can_read_sub_plan(p_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sub_plans s where s.id = p_id
    and (s.supervisor_id = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects', 'gm') or app.is_project_ae(s.exec_project_id)))
$$;
alter table public.sub_plans enable row level security;
alter table public.sub_plan_items enable row level security;
drop policy if exists sub_plans_read on public.sub_plans;
create policy sub_plans_read on public.sub_plans for select to authenticated using (app.can_read_sub_plan(id));
drop policy if exists sub_plan_items_read on public.sub_plan_items;
create policy sub_plan_items_read on public.sub_plan_items for select to authenticated using (app.can_read_sub_plan(sub_plan_id));
grant select on public.sub_plans, public.sub_plan_items to authenticated;

-- The supervisor's plan for a week (made on first use)
create or replace function public.my_sub_plan(p_exec uuid, p_week date) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; wk date := p_week - (extract(isodow from p_week)::int - 1);
begin
  perform app.require(app.has_role('sub_supervisor') and app.is_exec_member(p_exec), 'Only the project''s subcontractor supervisor plans here');
  select id into pid from public.sub_plans where exec_project_id = p_exec and supervisor_id = auth.uid() and week_start = wk;
  if pid is null then
    insert into public.sub_plans (exec_project_id, supervisor_id, week_start) values (p_exec, auth.uid(), wk) returning id into pid;
  end if;
  return pid;
end $$;

-- Items of the Assistant Engineers' approved plans for the week (to pick from), and whether this plan has them
create or replace function public.sub_plan_ae_items(p_plan uuid)
returns table (id uuid, day date, kind text, title text, zone text, qty numeric, unit text, engineer text, mine boolean, picked boolean)
language plpgsql stable security definer set search_path = public as $$
declare s public.sub_plans;
begin
  select * into s from public.sub_plans where sub_plans.id = p_plan;
  perform app.require(s.id is not null and app.can_read_sub_plan(s.id), 'Not found');
  return query
    select i.id, i.day, i.kind, i.title, i.zone, i.qty, i.unit, app.display_name(p.ae_id), i.supervisor_id = s.supervisor_id,
           exists (select 1 from public.sub_plan_items x where x.sub_plan_id = s.id and x.ae_item_id = i.id)
      from public.exec_plan_items i join public.exec_plans p on p.id = i.plan_id
     where p.exec_project_id = s.exec_project_id and p.status = 'approved' and i.day between s.week_start and s.week_start + 6
       and i.source = 'plan'
     order by i.day, i.title;
end $$;

create or replace function app.sub_plan_for_edit(p_plan uuid) returns public.sub_plans
language plpgsql security definer set search_path = public as $$
declare s public.sub_plans;
begin
  select * into s from public.sub_plans where id = p_plan for update;
  perform app.require(s.id is not null and s.supervisor_id = auth.uid(), 'Only the supervisor changes their plan');
  perform app.require(s.status in ('draft', 'returned'), 'The plan is submitted – it changes only if returned');
  return s;
end $$;

-- Tick / untick an item of the engineers' approved plan
create or replace function public.pick_sub_plan_item(p_plan uuid, p_ae_item uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sub_plans := app.sub_plan_for_edit(p_plan); i public.exec_plan_items;
begin
  select x.* into i from public.exec_plan_items x join public.exec_plans p on p.id = x.plan_id
   where x.id = p_ae_item and p.exec_project_id = s.exec_project_id and p.status = 'approved' and x.day between s.week_start and s.week_start + 6;
  perform app.require(i.id is not null, 'Choose an item of an approved engineer plan of this week');
  if p_on then
    insert into public.sub_plan_items (sub_plan_id, day, ae_item_id, title, zone, qty, unit)
    values (s.id, i.day, i.id, i.title, i.zone, i.qty, i.unit) on conflict (sub_plan_id, ae_item_id) do nothing;
  else
    delete from public.sub_plan_items where sub_plan_id = s.id and ae_item_id = i.id;
  end if;
end $$;

-- Additional work of the subcontractor (add / edit)
create or replace function public.save_sub_plan_extra(p_plan uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.sub_plans := app.sub_plan_for_edit(p_plan); iid uuid := p_id; d date := nullif(p ->> 'day', '')::date;
begin
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'Describe the work');
  perform app.require(d between s.week_start and s.week_start + 6, 'Choose a day of this week');
  if iid is null then
    insert into public.sub_plan_items (sub_plan_id, day, title, zone, qty, unit, crew, additional)
    values (s.id, d, btrim(p ->> 'title'), nullif(btrim(p ->> 'zone'), ''), nullif(p ->> 'qty', '')::numeric, nullif(btrim(p ->> 'unit'), ''), nullif(p ->> 'crew', '')::int, true)
    returning id into iid;
  else
    update public.sub_plan_items set day = d, title = btrim(p ->> 'title'), zone = nullif(btrim(p ->> 'zone'), ''), qty = nullif(p ->> 'qty', '')::numeric,
      unit = nullif(btrim(p ->> 'unit'), ''), crew = nullif(p ->> 'crew', '')::int where id = iid and sub_plan_id = s.id;
    perform app.require(found, 'Not found');
  end if;
  return iid;
end $$;

create or replace function public.delete_sub_plan_item(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it public.sub_plan_items; s public.sub_plans;
begin
  select * into it from public.sub_plan_items where id = p_id;
  perform app.require(it.id is not null, 'Not found');
  s := app.sub_plan_for_edit(it.sub_plan_id);
  delete from public.sub_plan_items where id = it.id;
end $$;

create or replace function public.submit_sub_plan(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sub_plans := app.sub_plan_for_edit(p_plan);
begin
  perform app.require(exists (select 1 from public.sub_plan_items where sub_plan_id = s.id), 'Pick or add the work for the week first');
  update public.sub_plans set status = 'submitted', submitted_at = now() where id = s.id;
  perform app.notify_many(app.project_aes(s.exec_project_id), 'exec_plan', 'Subcontractor plan to approve',
    format('%s · week of %s · %s', app.display_name(s.supervisor_id), to_char(s.week_start, 'DD Mon'), app.exec_head(s.exec_project_id)),
    'normal', 'exec_project', s.exec_project_id, '/execution/sub-plan?plan=' || s.id, null, true);
end $$;

create or replace function public.decide_sub_plan(p_plan uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sub_plans;
begin
  select * into s from public.sub_plans where id = p_plan for update;
  perform app.require(s.id is not null and s.status = 'submitted', 'Not waiting for approval');
  perform app.require(app.is_project_ae(s.exec_project_id) or app.has_role('senior_elec_engineer'), 'An Assistant Engineer of the project approves the plan');
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Give the comments');
  update public.sub_plans set status = case when p_ok then 'approved' else 'returned' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(p_note), '') where id = s.id;
  perform app.notify(s.supervisor_id, 'exec_plan', case when p_ok then 'Your plan is approved' else 'Your plan is returned with comments' end,
    format('Week of %s · %s%s', to_char(s.week_start, 'DD Mon'), app.exec_head(s.exec_project_id), coalesce(' · ' || nullif(btrim(p_note), ''), '')),
    'normal', 'exec_project', s.exec_project_id, '/execution/sub-plan?plan=' || s.id, null, true);
end $$;

-- Daily progress on the supervisor's own plan
create or replace function public.update_sub_plan_item(p_id uuid, p_status text, p_qty numeric default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare it public.sub_plan_items; s public.sub_plans;
begin
  select * into it from public.sub_plan_items where id = p_id for update;
  select * into s from public.sub_plans where id = it.sub_plan_id;
  perform app.require(s.id is not null and s.supervisor_id = auth.uid(), 'Only the supervisor updates their plan');
  perform app.require(s.status = 'approved', 'The plan must be approved first');
  perform app.require(p_status in ('planned', 'done', 'partial', 'not_done'), 'Choose the result');
  perform app.require(p_status not in ('partial', 'not_done') or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.sub_plan_items set status = p_status, done_qty = p_qty, result_note = nullif(btrim(p_note), ''), updated_at = now() where id = it.id;
end $$;

-- Waiting for the engineer
create or replace function public.sub_plans_to_approve()
returns table (id uuid, exec_project_id uuid, supervisor_id uuid, week_start date, submitted_at timestamptz, items int)
language sql stable security definer set search_path = public as $$
  select s.id, s.exec_project_id, s.supervisor_id, s.week_start, s.submitted_at, (select count(*)::int from public.sub_plan_items x where x.sub_plan_id = s.id)
    from public.sub_plans s where s.status = 'submitted' and (app.is_project_ae(s.exec_project_id) or app.has_role('senior_elec_engineer'))
   order by s.submitted_at
$$;

revoke execute on function public.my_sub_plan(uuid, date), public.sub_plan_ae_items(uuid), public.pick_sub_plan_item(uuid, uuid, boolean),
  public.save_sub_plan_extra(uuid, uuid, jsonb), public.delete_sub_plan_item(uuid), public.submit_sub_plan(uuid), public.decide_sub_plan(uuid, boolean, text),
  public.update_sub_plan_item(uuid, text, numeric, text), public.sub_plans_to_approve() from public, anon;
grant execute on function public.my_sub_plan(uuid, date), public.sub_plan_ae_items(uuid), public.pick_sub_plan_item(uuid, uuid, boolean),
  public.save_sub_plan_extra(uuid, uuid, jsonb), public.delete_sub_plan_item(uuid), public.submit_sub_plan(uuid), public.decide_sub_plan(uuid, boolean, text),
  public.update_sub_plan_item(uuid, text, numeric, text), public.sub_plans_to_approve() to authenticated, service_role;
