-- The required date belongs to whoever raised the need (the site or sales), not Operations.
--  * Local requests: only the requester, its creator, the sales person or the SEE change it; from a site material request
--    it is the material request's date (the SEE changes it there).
--  * Import orders made from a site material request take the material request's date and keep it.

create or replace function app.lo_required_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.purging', true) = 'on' or auth.uid() is null or new.required_on is not distinct from old.required_on then return new; end if;
  if old.mr_id is not null then
    raise exception 'The required date comes from the site material request – the SEE changes it there';
  end if;
  if not (auth.uid() in (old.requested_by, old.created_by, old.sales_person_id) or app.lo_see_of(old.id) = auth.uid()) then
    raise exception 'The required date is set by the project / sales team – ask them to change it';
  end if;
  return new;
end $$;
drop trigger if exists lo_required_owner on public.lo_requests;
create trigger lo_required_owner before update of required_on on public.lo_requests for each row execute function app.lo_required_owner();

create or replace function app.fo_required_from_mr() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if current_setting('app.purging', true) = 'on' then return new; end if;
  select m.required_date into d from public.fo_handovers h join public.material_requests m on m.id = h.mr_id where h.id = new.handover_id;
  if d is not null then new.required_on := d; end if;
  return new;
end $$;
drop trigger if exists fo_required_from_mr on public.fo_orders;
create trigger fo_required_from_mr before insert or update of required_on on public.fo_orders for each row execute function app.fo_required_from_mr();

select app.purge_guard_triggers();
select app.fix_function_owners();
