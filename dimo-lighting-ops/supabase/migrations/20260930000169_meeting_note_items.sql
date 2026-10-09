-- Meeting notes as separate points: the host adds, edits and removes any number of notes (discussion points) in a meeting;
-- each note can carry any number of actions. Removing a note removes its actions (only while the meeting is a draft).

create table if not exists public.meeting_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.sales_meetings (id) on delete cascade,
  sort int not null default 0,
  body text not null,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meeting_items_meeting on public.meeting_items (meeting_id, sort);
alter table public.meeting_items enable row level security;
drop policy if exists meeting_items_read on public.meeting_items;
create policy meeting_items_read on public.meeting_items for select to authenticated
  using (exists (select 1 from public.sales_meetings m where m.id = meeting_id));
grant select on public.meeting_items to authenticated;
alter table public.sales_meeting_actions add column if not exists item_id uuid references public.meeting_items (id) on delete set null;

create or replace function public.save_meeting_item(p_meeting uuid, p_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_meeting); iid uuid := p_id;
begin
  perform app.require(coalesce(btrim(p_body), '') <> '', 'Write the note');
  if iid is null then
    insert into public.meeting_items (meeting_id, sort, body)
    values (m.id, coalesce((select max(sort) from public.meeting_items where meeting_id = m.id), 0) + 1, btrim(p_body))
    returning id into iid;
  else
    update public.meeting_items set body = btrim(p_body), updated_at = now() where id = iid and meeting_id = m.id;
    perform app.require(found, 'Note not found');
  end if;
  return iid;
end $$;

create or replace function public.delete_meeting_item(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it public.meeting_items; m public.sales_meetings;
begin
  select * into it from public.meeting_items where id = p_id;
  perform app.require(it.id is not null, 'Note not found');
  m := app.meeting_for_edit(it.meeting_id);
  delete from public.sales_meeting_actions where item_id = it.id;
  delete from public.meeting_items where id = it.id;
end $$;

create or replace function public.add_meeting_action(p_meeting uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m public.sales_meetings := app.meeting_for_edit(p_meeting);
  aid uuid; owner uuid; pid uuid; oid uuid; uid uuid;
  k text := coalesce(nullif(p_data ->> 'kind', ''), 'task');
  obj text := nullif(btrim(p_data ->> 'objective'), '');
  orole public.app_role;
begin
  perform app.require(k in ('task', 'visit', 'design', 'estimation', 'execution'), 'Unknown action type');
  owner := nullif(p_data ->> 'owner_id', '')::uuid;
  if owner is null and k in ('task', 'visit') then owner := nullif(p_data ->> 'sales_person_id', '')::uuid; end if;
  pid := nullif(p_data ->> 'project_id', '')::uuid;
  oid := nullif(p_data ->> 'organization_id', '')::uuid;
  uid := nullif(p_data ->> 'unit_id', '')::uuid;
  if owner is null and k in ('design', 'estimation', 'execution') then
    select id into owner from public.profiles where role = any (app.action_managers(k)) and active order by role, full_name limit 1;
  end if;
  perform app.require(coalesce(btrim(p_data ->> 'action'), '') <> '', 'Enter the action');
  select role into orole from public.profiles where id = owner and active;
  perform app.require(orole is not null and orole not in ('gm', 'sys_admin'), 'Choose who does it');
  if m.team = 'project' then
    perform app.require(k in ('task', 'execution'), 'A project meeting gives tasks and project execution tasks');
    perform app.require(owner = any (app.project_meeting_people(m.id)), 'Choose someone on this project or invited to the meeting');
  end if;
  perform app.require(pid is null or exists (select 1 from public.projects where id = pid), 'Project not found');
  perform app.require(oid is null or exists (select 1 from public.organizations where id = oid), 'Customer not found');
  if pid is not null and oid is null then select organization_id into oid from public.projects where id = pid; end if;
  if uid is not null and oid is null then select organization_id into oid from public.org_units where id = uid; end if;
  perform app.require(uid is null or exists (select 1 from public.org_units where id = uid and organization_id = oid),
    'The unit / department belongs to another customer');
  if k = 'visit' then
    perform app.require(orole in ('asm_building', 'asm_infra'), 'A follow-up visit is given to a sales person');
    perform app.require(oid is not null, 'Choose the customer (and project) to visit from the lists – a new customer is added in Customers first');
    perform app.require(obj is not null and exists (select 1 from public.master_lists where list_name = 'visit_objective' and value = obj),
      'Choose the visit objective');
    perform app.require(pid is not null or exists (select 1 from public.master_lists where list_name = 'visit_objective' and value = obj and 'networking' = any (tags)),
      'Choose the project – only networking visits can be made without one');
    perform app.require(nullif(p_data ->> 'due_date', '') is not null, 'Enter the date the visit is due by');
  elsif k in ('design', 'estimation', 'execution') then
    perform app.require(orole = any (app.action_managers(k)),
      format('A %s goes to its manager (%s), who appoints the person', lower(app.action_kind_label(k)),
        case k when 'design' then 'Design Manager' when 'estimation' then 'SM / AM Estimation' else 'Senior Electrical Engineer' end));
  end if;
  insert into public.sales_meeting_actions (meeting_id, sales_person_id, owner_id, action, due_date, project_id, organization_id, new_project,
    new_customer, kind, objective, unit_id)
  values (m.id, nullif(p_data ->> 'sales_person_id', '')::uuid, owner, btrim(p_data ->> 'action'), nullif(p_data ->> 'due_date', '')::date,
    pid, oid, case when pid is null and k <> 'visit' then nullif(btrim(p_data ->> 'new_project'), '') end,
    case when oid is null and k <> 'visit' then nullif(btrim(p_data ->> 'new_customer'), '') end,
    k, case when k = 'visit' then obj end, uid)
  returning id into aid;
  -- an action under a meeting note
  if nullif(p_data ->> 'item_id', '') is not null then
    perform app.require(exists (select 1 from public.meeting_items where id = (p_data ->> 'item_id')::uuid and meeting_id = m.id), 'Note not found');
    update public.sales_meeting_actions set item_id = (p_data ->> 'item_id')::uuid where id = aid;
  end if;
  return aid;
end $$;

revoke execute on function public.save_meeting_item(uuid, uuid, text), public.delete_meeting_item(uuid) from public, anon;
grant execute on function public.save_meeting_item(uuid, uuid, text), public.delete_meeting_item(uuid) to authenticated, service_role;
