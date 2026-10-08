-- Project number on HSE forms, worker lists and other site documents = the project's SAP WBS number (e.g. LS-000116),
-- taken from the secured project (order book). Kept in step when the WBS or the secured-project link changes.

alter table public.exec_projects add column if not exists wbs_no text;

create or replace function app.exec_wbs_for(p_secured uuid, p_project uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select app.wbs_base(s.wbs) from public.secured_projects s where s.id = p_secured and s.wbs is not null),
    (select app.wbs_base(s.wbs) from public.secured_projects s where s.project_id = p_project and s.wbs is not null order by s.created_at desc limit 1)) $$;

create or replace function app.exec_projects_wbs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.wbs_no := coalesce(app.exec_wbs_for(new.secured_id, new.project_id), new.wbs_no);
  return new;
end $$;

drop trigger if exists exec_projects_wbs on public.exec_projects;
create trigger exec_projects_wbs before insert or update of secured_id, project_id on public.exec_projects
  for each row execute function app.exec_projects_wbs();

create or replace function app.secured_projects_wbs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.exec_projects e set wbs_no = app.exec_wbs_for(e.secured_id, e.project_id)
   where (e.secured_id = new.id or (e.secured_id is null and e.project_id = new.project_id))
     and e.wbs_no is distinct from app.exec_wbs_for(e.secured_id, e.project_id)
     and app.exec_wbs_for(e.secured_id, e.project_id) is not null;
  return null;
end $$;

drop trigger if exists secured_projects_wbs on public.secured_projects;
create trigger secured_projects_wbs after insert or update of wbs, project_id on public.secured_projects
  for each row execute function app.secured_projects_wbs();

update public.exec_projects e set wbs_no = app.exec_wbs_for(e.secured_id, e.project_id)
 where app.exec_wbs_for(e.secured_id, e.project_id) is not null;
