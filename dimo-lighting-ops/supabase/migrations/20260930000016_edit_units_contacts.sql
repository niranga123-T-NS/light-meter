-- Units / departments and contacts can be corrected by the customer's account owner (sales person)
-- as well as SM Projects and GM / DGM. The unit owner override stays with SM Projects / GM / DGM.

create or replace function app.owns_organization(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organizations where id = p_org and account_owner_id = auth.uid())
$$;

drop policy if exists units_update on public.org_units;
create policy units_update on public.org_units for update to authenticated
  using (app.has_role('gm', 'sm_projects') or (app.is_sales_person() and app.owns_organization(organization_id)));

create or replace function app.org_units_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if new.account_owner_id is distinct from old.account_owner_id and not app.has_role('sm_projects', 'gm') then
    raise exception 'Only SM Projects or GM / DGM can change the owner of a unit';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A unit cannot be moved to another organization';
  end if;
  if new.parent_unit_id = new.id then
    raise exception 'A unit cannot be its own parent';
  end if;
  return new;
end $$;
drop trigger if exists org_units_guard on public.org_units;
create trigger org_units_guard before update on public.org_units
for each row execute function app.org_units_guard();

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts for update to authenticated
  using (app.has_role('gm', 'sm_projects') or created_by = auth.uid()
         or (app.is_sales_person() and app.owns_organization(organization_id)));
