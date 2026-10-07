-- More resource types for the programme: access (lifts / scaffolding), vehicles, tools & test instruments and other (custom)
alter table public.exec_activity_resources drop constraint if exists exec_activity_resources_kind_check;
alter table public.exec_activity_resources add constraint exec_activity_resources_kind_check
  check (kind in ('staff', 'labour', 'equipment', 'access', 'vehicle', 'tools', 'subcontractor', 'other'));

-- (copied from 20260930000109_exec_programme.sql with the new types)
create or replace function public.save_activity_resource(p_activity uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.exec_activities; rid uuid; nm text;
begin
  select * into a from public.exec_activities where id = p_activity;
  perform app.require(a.id is not null, 'Activity not found');
  perform app.programme_edit(a.exec_project_id);
  perform app.require(p ->> 'kind' in ('staff', 'labour', 'equipment', 'access', 'vehicle', 'tools', 'subcontractor', 'other'), 'Choose the resource type');
  perform app.require(p ->> 'kind' <> 'staff' or nullif(p ->> 'profile_id', '') is not null, 'Choose the DIMO staff member');
  nm := coalesce(nullif(btrim(p ->> 'name'), ''), (select full_name from public.profiles where id = nullif(p ->> 'profile_id', '')::uuid));
  perform app.require(nm is not null, 'Name the resource');
  perform app.require(coalesce(nullif(p ->> 'qty', '')::numeric, 1) > 0, 'The quantity must be more than 0');
  if p_id is null then
    insert into public.exec_activity_resources (activity_id, kind, profile_id, name, qty, unit)
    values (a.id, p ->> 'kind', nullif(p ->> 'profile_id', '')::uuid, nm, coalesce(nullif(p ->> 'qty', '')::numeric, 1), nullif(btrim(p ->> 'unit'), ''))
    returning id into rid;
  else
    update public.exec_activity_resources set kind = p ->> 'kind', profile_id = nullif(p ->> 'profile_id', '')::uuid, name = nm,
      qty = coalesce(nullif(p ->> 'qty', '')::numeric, 1), unit = nullif(btrim(p ->> 'unit'), '')
    where id = p_id and activity_id = a.id returning id into rid;
  end if;
  return rid;
end $$;
