-- The debtors list is the accounts system's list, independent of the project register.
-- Rows upload even when the project, customer or sales person cannot be matched: those are warnings, not errors.
-- The Operations Executive (or SM Projects / GM / DGM) can link a debt to a project and/or sales person later.

alter table public.debt_upload_rows add column if not exists warnings text[] not null default '{}';

create or replace function public.stage_debtor_upload(p_as_at date, p_rows jsonb, p_file_path text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  up uuid;
  r jsonb;
  n int := 0;
  errs text[];
  warns text[];
  p_id uuid; p_owner uuid; p_org uuid; p_unit uuid;
  o_id uuid; o_owner uuid;
  sp uuid;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive uploads the debtors list');
  insert into public.debt_uploads (as_at, file_path) values (p_as_at, p_file_path) returning id into up;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    errs := '{}'; warns := '{}';
    p_id := null; p_owner := null; p_org := null; p_unit := null; o_id := null; o_owner := null; sp := null;
    -- Only what the debt itself needs is mandatory
    if coalesce(r ->> 'invoice_no', '') = '' then errs := errs || 'Invoice number missing'::text; end if;
    if coalesce(r ->> 'client_name', '') = '' then errs := errs || 'Client name missing'::text; end if;
    if (r ->> 'amount') is null then errs := errs || 'Outstanding amount missing'::text; end if;
    if (r ->> 'currency') not in ('LKR', 'USD') then errs := errs || 'Currency must be LKR or USD'::text; end if;
    if (r ->> 'outstanding_days') is null then errs := errs || 'Outstanding days missing'::text; end if;
    -- Optional links to the system (project, customer, sales person)
    if coalesce(r ->> 'project_name', '') <> '' then
      select p.id, p.owner_id, p.organization_id, p.unit_id into p_id, p_owner, p_org, p_unit from public.projects p
       where p.merged_into is null and p.name_norm = app.normalize_name(r ->> 'project_name') limit 1;
      if p_id is null then
        select p.id, p.owner_id, p.organization_id, p.unit_id into p_id, p_owner, p_org, p_unit from public.projects p
         where p.merged_into is null and extensions.similarity(p.name_norm, app.normalize_name(r ->> 'project_name')) > 0.6
         order by extensions.similarity(p.name_norm, app.normalize_name(r ->> 'project_name')) desc limit 1;
      end if;
    end if;
    select o.id, o.account_owner_id into o_id, o_owner from public.organizations o
     where o.merged_into is null and o.name_norm = app.normalize_name(r ->> 'client_name') limit 1;
    if coalesce(r ->> 'sales_person', '') <> '' then
      select id into sp from public.profiles where role in ('asm_building', 'asm_infra') and lower(full_name) = lower(btrim(r ->> 'sales_person'));
    end if;
    sp := coalesce(sp, p_owner, o_owner);
    if p_id is null and coalesce(r ->> 'project_name', '') <> '' then warns := warns || 'Project not linked'::text; end if;
    if o_id is null and p_id is null then warns := warns || 'Customer not linked'::text; end if;
    if sp is null then warns := warns || 'No sales person'::text; end if;
    insert into public.debt_upload_rows (upload_id, row_no, project_name, client_name, invoice_no, invoice_date, amount, currency,
      outstanding_days, sales_person_hint, project_id, organization_id, unit_id, sales_person_id, errors, warnings)
    values (up, n, nullif(r ->> 'project_name', ''), r ->> 'client_name', r ->> 'invoice_no', nullif(r ->> 'invoice_date', '')::date,
      (r ->> 'amount')::numeric, case when (r ->> 'currency') in ('LKR', 'USD') then (r ->> 'currency')::public.currency end,
      (r ->> 'outstanding_days')::int, r ->> 'sales_person', p_id, coalesce(p_org, o_id), p_unit,
      sp, errs, warns);
  end loop;
  update public.debt_upload_rows d set errors = errors || 'Duplicate invoice number in file'::text
   where upload_id = up and invoice_no in (select invoice_no from public.debt_upload_rows where upload_id = up
                                           group by invoice_no having count(*) > 1);
  perform app.refresh_upload_totals(up);
  return up;
end $$;

-- Optional linking of a preview row: project and / or sales person
create or replace function public.map_debtor_row(p_row bigint, p_project uuid, p_sales_person uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid; porg uuid; punit uuid; powner uuid;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive maps rows');
  perform app.require(p_project is not null or p_sales_person is not null, 'Choose a project or a sales person');
  if p_project is not null then
    select id, organization_id, unit_id, owner_id into pid, porg, punit, powner from public.projects where id = p_project;
  end if;
  update public.debt_upload_rows set
    project_id = coalesce(pid, project_id),
    organization_id = coalesce(porg, organization_id),
    unit_id = coalesce(punit, unit_id),
    sales_person_id = coalesce(p_sales_person, powner, sales_person_id),
    warnings = array(select w from unnest(warnings) w
                     where not (pid is not null and w in ('Project not linked', 'Customer not linked'))
                       and not (coalesce(p_sales_person, powner) is not null and w = 'No sales person'))
  where id = p_row;
  perform app.refresh_upload_totals((select upload_id from public.debt_upload_rows where id = p_row));
end $$;

-- Link an existing debt to a project and / or sales person (after upload)
create or replace function public.link_debt(p_debt uuid, p_project uuid default null, p_sales_person uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid; porg uuid; punit uuid; powner uuid; d public.debts;
begin
  perform app.require(app.has_role('operations_exec', 'sm_projects', 'gm'), 'Only Operations, SM Projects or GM / DGM can link debts');
  perform app.require(p_project is not null or p_sales_person is not null, 'Choose a project or a sales person');
  perform app.require(p_sales_person is null or exists (select 1 from public.profiles where id = p_sales_person and role in ('asm_building', 'asm_infra') and active),
    'Choose an active sales person');
  select * into d from public.debts where id = p_debt;
  perform app.require(d.id is not null, 'Debt not found');
  if p_project is not null then
    select id, organization_id, unit_id, owner_id into pid, porg, punit, powner from public.projects where id = p_project;
  end if;
  update public.debts set
    project_id = coalesce(pid, project_id),
    organization_id = coalesce(porg, organization_id),
    unit_id = coalesce(punit, unit_id),
    sales_person_id = coalesce(p_sales_person, powner, sales_person_id)
  where id = d.id;
  insert into public.debt_log (debt_id, kind, note)
  values (d.id, 'status', 'Linked' || case when pid is not null then ' to project ' || (select name from public.projects where id = pid) else '' end
           || case when p_sales_person is not null then ' · sales person ' || app.display_name(p_sales_person) else '' end);
end $$;

revoke execute on function public.link_debt(uuid, uuid, uuid) from public, anon;
grant execute on function public.link_debt(uuid, uuid, uuid) to authenticated, service_role;
