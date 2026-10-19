-- Warranty claims and project defects can be assigned to approved trainees (active trainee accounts, provisioned after SMP / GM approval) as well as
-- Assistant Engineers and the Senior Electrical Engineer; a trainee sees only the claims assigned to them and the warranty they belong to

create or replace function app.check_engineer(p_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(p_id is null or exists (select 1 from public.profiles where id = p_id and active and role in ('assistant_engineer', 'senior_elec_engineer', 'trainee')),
    'Assign it to an Assistant Engineer, an approved Trainee or the Senior Electrical Engineer');
end $$;

-- who sees a whole warranty with all its claims (unchanged rule)
create or replace function app.sees_warranty(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.sees_all_warranties() or exists (
    select 1 from public.warranties w where w.id = p_id
       and (w.owner_id = auth.uid() or (app.is_sales_person() and w.category = any (app.my_project_types()))))
$$;
-- the warranty header and lines are also readable by the engineer or trainee a claim on it is assigned to
create or replace function app.can_read_warranty(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.sees_warranty(p_id) or exists (select 1 from public.warranty_claims c where c.warranty_id = p_id and c.assignee_id = auth.uid())
$$;

drop policy if exists warranty_claims_read on public.warranty_claims;
create policy warranty_claims_read on public.warranty_claims for select to authenticated
  using (app.sees_warranty(warranty_id) or reported_by = auth.uid() or assignee_id = auth.uid());
drop policy if exists warranty_log_read on public.warranty_log;
create policy warranty_log_read on public.warranty_log for select to authenticated
  using ((claim_id is null and warranty_id is not null and app.sees_warranty(warranty_id))
      or (claim_id is not null and exists (select 1 from public.warranty_claims c where c.id = claim_id)));
grant execute on function app.sees_warranty(uuid) to authenticated;
