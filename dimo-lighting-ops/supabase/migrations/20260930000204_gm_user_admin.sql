-- GM / DGM add and maintain system users (with the System Administrator)
--  * New logins and activation go through the admin-users function (GM / DGM allowed, except System Administrator logins).
--  * Profiles: GM / DGM may change name, role, reporting line and project types, but not make anyone a System
--    Administrator nor change a System Administrator's profile. A high level user (view only) can never do this:
--    their requests run read-only.

create or replace function app.profiles_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null or app.has_role('sys_admin') or current_setting('app.exec_access', true) = 'on' then
    return new;
  end if;
  if app.has_role('gm') then
    if new.id <> auth.uid() and (old.role = 'sys_admin' or new.role = 'sys_admin') then
      raise exception 'Only the System Administrator creates or changes System Administrator logins';
    end if;
    if new.id = auth.uid() and new.role is distinct from old.role then
      raise exception 'You cannot change your own role';
    end if;
    return new;
  end if;
  if new.id <> auth.uid() then
    raise exception 'You can only edit your own profile';
  end if;
  if (new.full_name, new.role, new.manager_id, new.active, new.project_types, new.can_see_commercial)
     is distinct from (old.full_name, old.role, old.manager_id, old.active, old.project_types, old.can_see_commercial) then
    raise exception 'Name, role and reporting line are maintained by the System Administrator or GM / DGM';
  end if;
  return new;
end $$;
