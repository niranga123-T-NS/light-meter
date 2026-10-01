-- Debtors upload preview: fix a row in place or remove it (e.g. a totals line), instead of re-uploading the file.

-- Re-check one staged row: required fields are errors; missing links are warnings
create or replace function app.check_debtor_row(p_row bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.debt_upload_rows;
  errs text[] := '{}';
  warns text[] := '{}';
  o_id uuid; o_owner uuid;
begin
  select * into r from public.debt_upload_rows where id = p_row;
  if coalesce(r.invoice_no, '') = '' then errs := errs || 'Invoice number missing'::text; end if;
  if coalesce(r.client_name, '') = '' then errs := errs || 'Client name missing'::text; end if;
  if r.amount is null then errs := errs || 'Outstanding amount missing'::text; end if;
  if r.currency is null then errs := errs || 'Currency must be LKR or USD'::text; end if;
  if r.outstanding_days is null then errs := errs || 'Outstanding days missing'::text; end if;
  if r.organization_id is null and coalesce(r.client_name, '') <> '' then
    select o.id, o.account_owner_id into o_id, o_owner from public.organizations o
     where o.merged_into is null and o.name_norm = app.normalize_name(r.client_name) limit 1;
    if o_id is not null then
      update public.debt_upload_rows set organization_id = o_id, sales_person_id = coalesce(sales_person_id, o_owner) where id = p_row;
      select * into r from public.debt_upload_rows where id = p_row;
    end if;
  end if;
  if r.project_id is null and coalesce(r.project_name, '') <> '' then warns := warns || 'Project not linked'::text; end if;
  if r.organization_id is null then warns := warns || 'Customer not linked'::text; end if;
  if r.sales_person_id is null then warns := warns || 'No sales person'::text; end if;
  update public.debt_upload_rows set errors = errs, warnings = warns where id = p_row;
end $$;

-- Duplicate invoice numbers within one upload
create or replace function app.check_debtor_duplicates(p_upload uuid) returns void
language sql security definer set search_path = public as $$
  update public.debt_upload_rows d set errors = array_remove(errors, 'Duplicate invoice number in file')
   where upload_id = p_upload;
  update public.debt_upload_rows d set errors = errors || 'Duplicate invoice number in file'::text
   where upload_id = p_upload and coalesce(invoice_no, '') <> ''
     and invoice_no in (select invoice_no from public.debt_upload_rows where upload_id = p_upload
                        group by invoice_no having count(*) > 1);
$$;

create or replace function public.edit_debtor_row(p_row bigint, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.debt_upload_rows; st text;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive edits the debtors upload');
  select * into r from public.debt_upload_rows where id = p_row;
  select status into st from public.debt_uploads where id = r.upload_id;
  perform app.require(st = 'preview', 'This upload is already confirmed');
  perform app.require(coalesce(p_data ->> 'currency', 'LKR') in ('LKR', 'USD'), 'Currency must be LKR or USD');
  update public.debt_upload_rows set
    client_name = coalesce(nullif(btrim(p_data ->> 'client_name'), ''), client_name),
    project_name = case when p_data ? 'project_name' then nullif(btrim(p_data ->> 'project_name'), '') else project_name end,
    invoice_no = coalesce(nullif(btrim(p_data ->> 'invoice_no'), ''), invoice_no),
    invoice_date = case when p_data ? 'invoice_date' then nullif(p_data ->> 'invoice_date', '')::date else invoice_date end,
    amount = coalesce(nullif(p_data ->> 'amount', '')::numeric, amount),
    currency = coalesce(nullif(p_data ->> 'currency', '')::public.currency, currency),
    outstanding_days = coalesce(nullif(p_data ->> 'outstanding_days', '')::int, outstanding_days),
    organization_id = case when coalesce(nullif(btrim(p_data ->> 'client_name'), ''), client_name) is distinct from client_name then null else organization_id end
  where id = p_row;
  perform app.check_debtor_row(p_row);
  perform app.check_debtor_duplicates(r.upload_id);
  perform app.refresh_upload_totals(r.upload_id);
end $$;

create or replace function public.remove_debtor_row(p_row bigint) returns void
language plpgsql security definer set search_path = public as $$
declare up uuid; st text;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive edits the debtors upload');
  select upload_id into up from public.debt_upload_rows where id = p_row;
  select status into st from public.debt_uploads where id = up;
  perform app.require(st = 'preview', 'This upload is already confirmed');
  delete from public.debt_upload_rows where id = p_row;
  perform app.check_debtor_duplicates(up);
  perform app.refresh_upload_totals(up);
end $$;

revoke execute on function app.check_debtor_row(bigint), app.check_debtor_duplicates(uuid),
  public.edit_debtor_row(bigint, jsonb), public.remove_debtor_row(bigint) from public, anon;
grant execute on function app.check_debtor_row(bigint), app.check_debtor_duplicates(uuid),
  public.edit_debtor_row(bigint, jsonb), public.remove_debtor_row(bigint) to authenticated, service_role;
