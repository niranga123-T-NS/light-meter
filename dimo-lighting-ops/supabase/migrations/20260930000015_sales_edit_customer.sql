-- The account owner (sales person) can also correct the name and type of their own customer.
-- Merging and changing the account owner stay with SM Projects and GM / DGM.
-- A rename may not duplicate another customer's name.
create or replace function app.organizations_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.account_owner_id is null and app.is_sales_person() then new.account_owner_id := auth.uid(); end if;
    return new;
  end if;
  if new.merged_into is distinct from old.merged_into or new.account_owner_id is distinct from old.account_owner_id then
    if not app.has_role('sm_projects', 'gm') then
      raise exception 'Only SM Projects or GM / DGM can merge or change the owner of an organization';
    end if;
  end if;
  if (new.name, new.visit_category) is distinct from (old.name, old.visit_category) then
    if not (app.has_role('sm_projects', 'gm') or (app.is_sales_person() and old.account_owner_id = auth.uid())) then
      raise exception 'Only the account owner, SM Projects or GM / DGM can rename or re-type this customer';
    end if;
    if app.normalize_name(new.name) is distinct from app.normalize_name(old.name) and exists (
      select 1 from public.organizations o
      where o.id <> new.id and o.merged_into is null and o.name_norm = app.normalize_name(new.name)) then
      raise exception 'Another customer already has this name – ask SM Projects to merge them instead';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
