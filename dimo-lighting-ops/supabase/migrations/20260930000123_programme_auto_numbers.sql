-- Programme: WBS elements, sub-elements and activities are numbered automatically, in order:
--   WBS 1, 2, 3 … · sub-elements 2.1, 2.2 … · activities after the sub-elements of their element (e.g. 2.3, 2.1.1).
-- Every add / move / delete renumbers the programme; existing programmes are renumbered once in their current order.

create or replace function app.code_key(p_code text) returns int[] language sql immutable as $$
  select coalesce(array(select x::int from unnest(string_to_array(regexp_replace(coalesce(p_code, ''), '[^0-9.]', '', 'g'), '.')) x where x ~ '^\d{1,9}$'), '{}')
$$;

create or replace function app.renumber_node(p_exec uuid, p_parent uuid, p_prefix text, p_by_code boolean) returns void
language plpgsql security definer set search_path = public as $$
declare w record; a record; n int := 0;
begin
  for w in select id from public.exec_wbs where exec_project_id = p_exec and parent_id is not distinct from p_parent
           order by case when p_by_code then 0 else sort end, app.code_key(code), code, sort loop
    n := n + 1;
    update public.exec_wbs set code = p_prefix || n, sort = n where id = w.id;
    perform app.renumber_node(p_exec, w.id, p_prefix || n || '.', p_by_code);
  end loop;
  if p_parent is not null then
    for a in select id from public.exec_activities where exec_project_id = p_exec and wbs_id = p_parent
             order by case when p_by_code then 0 else sort end, app.code_key(code), code, sort loop
      n := n + 1;
      update public.exec_activities set code = p_prefix || n, sort = n where id = a.id;
    end loop;
  end if;
end $$;

create or replace function app.renumber_programme(p_exec uuid, p_by_code boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.renumber_node(p_exec, null, '', p_by_code);
end $$;

-- WBS element: the code is given automatically (p_code is ignored); a moved element goes last under its new parent
create or replace function public.save_wbs(p_exec uuid, p_id uuid, p_parent uuid, p_code text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare wid uuid; nxt int;
begin
  perform app.programme_edit(p_exec);
  perform app.require(coalesce(btrim(p_name), '') <> '', 'Enter the WBS name');
  perform app.require(p_parent is null or exists (select 1 from public.exec_wbs where id = p_parent and exec_project_id = p_exec), 'Unknown parent');
  nxt := coalesce((select max(sort) + 1 from public.exec_wbs where exec_project_id = p_exec), 1);
  if p_id is null then
    insert into public.exec_wbs (exec_project_id, parent_id, code, name, sort) values (p_exec, p_parent, '', btrim(p_name), nxt) returning id into wid;
  else
    perform app.require(p_parent is distinct from p_id, 'A WBS element cannot be its own parent');
    perform app.require(p_parent is null or not exists (
      with recursive sub(id) as (select id from public.exec_wbs where parent_id = p_id union select w.id from public.exec_wbs w join sub on w.parent_id = sub.id)
      select 1 from sub where id = p_parent), 'A WBS element cannot be moved under its own sub-element');
    update public.exec_wbs set name = btrim(p_name),
      sort = case when parent_id is distinct from p_parent then nxt else sort end, parent_id = p_parent
    where id = p_id and exec_project_id = p_exec returning id into wid;
  end if;
  perform app.require(wid is not null, 'WBS element not found');
  perform app.renumber_programme(p_exec);
  return wid;
end $$;

create or replace function public.delete_wbs(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w public.exec_wbs;
begin
  select * into w from public.exec_wbs where id = p_id;
  perform app.require(w.id is not null, 'Not found');
  perform app.programme_edit(w.exec_project_id);
  perform app.require(not exists (select 1 from public.exec_activities where wbs_id = p_id) and not exists (select 1 from public.exec_wbs where parent_id = p_id),
    'Move or delete its activities and sub-elements first');
  delete from public.exec_wbs where id = p_id;
  perform app.renumber_programme(w.exec_project_id);
end $$;

-- Activity: the code is given automatically; a new or moved activity goes last under its WBS element
create or replace function public.save_activity(p_exec uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare aid uuid; d int; nxt int;
begin
  perform app.programme_edit(p_exec);
  perform app.require(coalesce(btrim(p ->> 'name'), '') <> '', 'Enter the activity name');
  perform app.require(exists (select 1 from public.exec_wbs where id = nullif(p ->> 'wbs_id', '')::uuid and exec_project_id = p_exec), 'Choose the WBS element');
  begin d := (p ->> 'duration')::int; exception when others then d := null; end;
  perform app.require(d is not null and d >= 0, 'Enter the duration in working days (0 for a milestone)');
  nxt := coalesce((select max(sort) + 1 from public.exec_activities where exec_project_id = p_exec), 1);
  if p_id is null then
    insert into public.exec_activities (exec_project_id, wbs_id, code, name, duration, not_before, responsible_id, subcontractor, qty, unit, sort)
    values (p_exec, (p ->> 'wbs_id')::uuid, '', btrim(p ->> 'name'), d, nullif(p ->> 'not_before', '')::date, nullif(p ->> 'responsible_id', '')::uuid,
            nullif(btrim(p ->> 'subcontractor'), ''), nullif(p ->> 'qty', '')::numeric, nullif(btrim(p ->> 'unit'), ''), nxt)
    returning id into aid;
  else
    update public.exec_activities set
      sort = case when wbs_id is distinct from (p ->> 'wbs_id')::uuid then nxt else sort end,
      wbs_id = (p ->> 'wbs_id')::uuid, name = btrim(p ->> 'name'), duration = d,
      not_before = nullif(p ->> 'not_before', '')::date, responsible_id = nullif(p ->> 'responsible_id', '')::uuid, subcontractor = nullif(btrim(p ->> 'subcontractor'), ''),
      qty = nullif(p ->> 'qty', '')::numeric, unit = nullif(btrim(p ->> 'unit'), '')
    where id = p_id and exec_project_id = p_exec returning id into aid;
  end if;
  perform app.require(aid is not null, 'Activity not found');
  perform app.renumber_programme(p_exec);
  perform app.schedule(p_exec);
  return aid;
end $$;

-- Rename an activity from the Gantt
create or replace function public.rename_activity(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.exec_activities;
begin
  select * into a from public.exec_activities where id = p_id;
  perform app.require(a.id is not null, 'Activity not found');
  perform app.programme_edit(a.exec_project_id);
  perform app.require(coalesce(btrim(p_name), '') <> '', 'Enter the activity name');
  update public.exec_activities set name = btrim(p_name) where id = p_id;
end $$;

create or replace function public.delete_activity(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.exec_activities;
begin
  select * into a from public.exec_activities where id = p_id;
  perform app.require(a.id is not null, 'Not found');
  perform app.programme_edit(a.exec_project_id);
  perform app.require(a.actual_start is null, 'Work has started on this activity – it cannot be deleted');
  delete from public.exec_activities where id = p_id;
  perform app.renumber_programme(a.exec_project_id);
  perform app.schedule(a.exec_project_id);
end $$;

revoke execute on function public.rename_activity(uuid, text) from public, anon;
grant execute on function public.rename_activity(uuid, text) to authenticated;

-- Existing programmes: renumber once in their current (code) order
do $$
declare p uuid;
begin
  for p in select exec_project_id from public.exec_programmes loop
    perform app.renumber_programme(p, true);
  end loop;
end $$;
