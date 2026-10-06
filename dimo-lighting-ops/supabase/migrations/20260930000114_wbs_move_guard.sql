-- WBS elements can be renamed and moved by the SEE: never under their own sub-elements (copied from 20260930000109_exec_programme.sql)
create or replace function public.save_wbs(p_exec uuid, p_id uuid, p_parent uuid, p_code text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare wid uuid;
begin
  perform app.programme_edit(p_exec);
  perform app.require(coalesce(btrim(p_code), '') <> '' and coalesce(btrim(p_name), '') <> '', 'Enter the WBS code and name');
  perform app.require(p_parent is null or exists (select 1 from public.exec_wbs where id = p_parent and exec_project_id = p_exec), 'Unknown parent');
  if p_id is null then
    insert into public.exec_wbs (exec_project_id, parent_id, code, name, sort)
    values (p_exec, p_parent, btrim(p_code), btrim(p_name), coalesce((select max(sort) + 1 from public.exec_wbs where exec_project_id = p_exec), 0)) returning id into wid;
  else
    perform app.require(p_parent is distinct from p_id, 'A WBS element cannot be its own parent');
    -- Not under one of its own sub-elements
    perform app.require(p_parent is null or not exists (
      with recursive sub(id) as (select id from public.exec_wbs where parent_id = p_id union select w.id from public.exec_wbs w join sub on w.parent_id = sub.id)
      select 1 from sub where id = p_parent), 'A WBS element cannot be moved under its own sub-element');
    update public.exec_wbs set parent_id = p_parent, code = btrim(p_code), name = btrim(p_name) where id = p_id and exec_project_id = p_exec returning id into wid;
  end if;
  return wid;
end $$;
