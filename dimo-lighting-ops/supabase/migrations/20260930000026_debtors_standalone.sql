-- The debtors list is the accounts system's list and stands on its own: project and client are kept as the text in the file.
-- Uploads no longer look up the project register, so there are no "Project / Customer not linked" warnings.
-- The only optional step is the sales person who follows the debt up (from the file, the customer's account owner, or chosen).
-- A client whose name exactly matches a customer is still tied to it silently, so the debtor check on new inquiries (5.9) keeps working.

-- Sales person: the name in the file, else the account owner of a customer with exactly the same name
create or replace function app.debtor_sales_person(p_name text, p_client text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.profiles where role in ('asm_building', 'asm_infra') and active
       and coalesce(btrim(p_name), '') <> '' and lower(full_name) = lower(btrim(p_name)) limit 1),
    (select o.account_owner_id from public.organizations o
      where o.merged_into is null and coalesce(p_client, '') <> '' and o.name_norm = app.normalize_name(p_client) limit 1));
$$;

create or replace function public.stage_debtor_upload(p_as_at date, p_rows jsonb, p_file_path text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  up uuid;
  r jsonb;
  n int := 0;
  rid bigint;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive uploads the debtors list');
  insert into public.debt_uploads (as_at, file_path) values (p_as_at, p_file_path) returning id into up;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    insert into public.debt_upload_rows (upload_id, row_no, project_name, client_name, invoice_no, invoice_date, amount, currency,
      outstanding_days, sales_person_hint, sales_person_id, errors, warnings)
    values (up, n, nullif(btrim(r ->> 'project_name'), ''), nullif(btrim(r ->> 'client_name'), ''), nullif(btrim(r ->> 'invoice_no'), ''),
      case when coalesce(r ->> 'invoice_date', '') ~ '^\d{4}-\d{2}-\d{2}' then (r ->> 'invoice_date')::date end,
      case when coalesce(r ->> 'amount', '') ~ '^-?\d+(\.\d+)?$' then (r ->> 'amount')::numeric end,
      case when upper(btrim(r ->> 'currency')) in ('LKR', 'USD') then upper(btrim(r ->> 'currency'))::public.currency end,
      case when coalesce(r ->> 'outstanding_days', '') ~ '^\d+(\.0+)?$' then (r ->> 'outstanding_days')::numeric::int end,
      r ->> 'sales_person', app.debtor_sales_person(r ->> 'sales_person', r ->> 'client_name'), '{}', '{}')
    returning id into rid;
    perform app.check_debtor_row(rid);
  end loop;
  perform app.check_debtor_duplicates(up);
  perform app.refresh_upload_totals(up);
  return up;
end $$;

-- Re-check one staged row: the invoice fields are required; a missing sales person is only a reminder
create or replace function app.check_debtor_row(p_row bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.debt_upload_rows;
  errs text[] := '{}';
  warns text[] := '{}';
begin
  select * into r from public.debt_upload_rows where id = p_row;
  if coalesce(r.invoice_no, '') = '' then errs := errs || 'Invoice number missing'::text; end if;
  if coalesce(r.client_name, '') = '' then errs := errs || 'Client name missing'::text; end if;
  if r.amount is null then errs := errs || 'Outstanding amount missing or not a number'::text; end if;
  if r.currency is null then errs := errs || 'Currency must be LKR or USD'::text; end if;
  if r.outstanding_days is null then errs := errs || 'Outstanding days missing or not a whole number'::text; end if;
  if r.organization_id is null and coalesce(r.client_name, '') <> '' then
    select o.id into r.organization_id from public.organizations o
     where o.merged_into is null and o.name_norm = app.normalize_name(r.client_name) limit 1;
  end if;
  if r.sales_person_id is null then
    r.sales_person_id := app.debtor_sales_person(r.sales_person_hint, r.client_name);
  end if;
  if r.sales_person_id is null then warns := warns || 'No sales person'::text; end if;
  update public.debt_upload_rows set organization_id = r.organization_id, sales_person_id = r.sales_person_id, errors = errs, warnings = warns where id = p_row;
end $$;

-- Preview rows already staged: drop the old project / customer warnings
update public.debt_upload_rows d set warnings = array_remove(array_remove(warnings, 'Project not linked'), 'Customer not linked')
  from public.debt_uploads u where u.id = d.upload_id and u.status = 'preview';

-- Choose the sales person for a preview row
create or replace function public.set_debtor_row_sales_person(p_row bigint, p_sales_person uuid) returns void
language plpgsql security definer set search_path = public as $$
declare up uuid;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive edits the debtors upload');
  perform app.require(exists (select 1 from public.profiles where id = p_sales_person and role in ('asm_building', 'asm_infra') and active),
    'Choose an active sales person');
  select upload_id into up from public.debt_upload_rows where id = p_row;
  perform app.require((select status from public.debt_uploads where id = up) = 'preview', 'This upload is already confirmed');
  update public.debt_upload_rows set sales_person_id = p_sales_person, warnings = array_remove(warnings, 'No sales person') where id = p_row;
end $$;

-- Choose or change the sales person on a debt
create or replace function public.set_debt_sales_person(p_debt uuid, p_sales_person uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.debts;
begin
  perform app.require(app.has_role('operations_exec', 'sm_projects', 'gm'), 'Only Operations, SM Projects or GM / DGM assign debts');
  perform app.require(exists (select 1 from public.profiles where id = p_sales_person and role in ('asm_building', 'asm_infra') and active),
    'Choose an active sales person');
  select * into d from public.debts where id = p_debt;
  perform app.require(d.id is not null, 'Debt not found');
  update public.debts set sales_person_id = p_sales_person where id = d.id;
  insert into public.debt_log (debt_id, kind, note) values (d.id, 'status', 'Sales person: ' || app.display_name(p_sales_person));
  perform app.notify(p_sales_person, 'debt_assigned', 'Debt assigned to you',
    format('%s · %s · %s', d.client_name, d.invoice_no, app.fmt_money(d.amount, d.currency)), 'normal', 'debt', d.id, '/debtors/' || d.id);
end $$;

revoke execute on function app.debtor_sales_person(text, text), public.set_debtor_row_sales_person(bigint, uuid),
  public.set_debt_sales_person(uuid, uuid) from public, anon;
grant execute on function app.debtor_sales_person(text, text), public.set_debtor_row_sales_person(bigint, uuid),
  public.set_debt_sales_person(uuid, uuid) to authenticated, service_role;

-- Confirm: the file is the source of truth for project and client text on existing debts too
create or replace function public.confirm_debtor_upload(p_upload uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u public.debt_uploads;
  r public.debt_upload_rows;
  d public.debts;
  added int := 0; updated int := 0; cleared int := 0; mismatches int := 0;
  t int;
  prev_days int;
  mgmt uuid[] := app.role_users('sm_projects') || app.role_users('gm');
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive confirms uploads');
  select * into u from public.debt_uploads where id = p_upload for update;
  perform app.require(u.status = 'preview', 'Upload already processed');
  perform app.require(not exists (select 1 from public.debt_upload_rows where upload_id = u.id and cardinality(errors) > 0),
    'Fix or remove every row with errors before confirming');

  for r in select * from public.debt_upload_rows where upload_id = u.id loop
    select * into d from public.debts where invoice_no = r.invoice_no for update;
    prev_days := d.outstanding_days;
    if not found then
      prev_days := null;
      insert into public.debts (invoice_no, project_id, project_name, organization_id, unit_id, client_name, sales_person_id,
        invoice_date, amount, currency, outstanding_days, last_upload_id)
      values (r.invoice_no, r.project_id, r.project_name, r.organization_id, r.unit_id, r.client_name, r.sales_person_id,
        r.invoice_date, r.amount, r.currency, r.outstanding_days, u.id)
      returning * into d;
      added := added + 1;
      insert into public.debt_log (debt_id, kind, to_status, note) values (d.id, 'upload', 'outstanding', 'New in upload ' || u.as_at);
    else
      -- Collected but still in the file → mismatch (12.4)
      if d.status = 'collected' and r.amount > 0 then
        mismatches := mismatches + 1;
        update public.debts set collection_mismatch = true where id = d.id;
        perform app.notify_many(array[d.sales_person_id] || app.role_users('operations_exec') || app.role_users('sm_projects'),
          'collection_mismatch', 'Collected debt still in the debtors list',
          format('%s · %s · %s', d.client_name, d.invoice_no, app.fmt_money(r.amount, r.currency)), 'normal', 'debt', d.id, '/debtors/' || d.id);
      end if;
      update public.debts set amount = r.amount, outstanding_days = r.outstanding_days, last_upload_id = u.id,
        last_amount_change_at = case when r.amount < d.amount then now() else last_amount_change_at end,
        project_name = r.project_name, client_name = r.client_name, invoice_date = coalesce(r.invoice_date, invoice_date),
        organization_id = coalesce(r.organization_id, organization_id),
        sales_person_id = coalesce(r.sales_person_id, sales_person_id),
        status = case when status = 'cleared' then 'outstanding' else status end
      where id = d.id;
      updated := updated + 1;
    end if;
    insert into public.debt_snapshots (upload_id, debt_id, amount, outstanding_days) values (u.id, d.id, r.amount, r.outstanding_days)
    on conflict do nothing;

    -- Ageing crossings 60 / 120 / 180 (12.6)
    foreach t in array array[60, 120, 180] loop
      if prev_days is not null and app.debt_crossed(prev_days, r.outstanding_days, t) then
        perform app.notify_many(array[r.sales_person_id] || mgmt, 'debt_crossed_' || t,
          format('Debt crossed %s days', t),
          format('%s – %s · %s · %s · %s days', r.client_name, r.project_name, r.invoice_no, app.fmt_money(r.amount, r.currency), r.outstanding_days),
          case when t = 180 then 'critical'::public.priority else 'normal'::public.priority end,
          'debt', d.id, '/debtors/' || d.id, format('debt:%s:%s', d.id, t));
      end if;
    end loop;
  end loop;

  -- Invoices no longer in the file
  for d in select * from public.debts
           where status not in ('cleared', 'collected_confirmed')
             and invoice_no not in (select invoice_no from public.debt_upload_rows where upload_id = u.id) loop
    update public.debts set status = case when d.status = 'collected' then 'collected_confirmed' else 'cleared' end,
      cleared_at = now(), last_status_at = now(), collection_mismatch = false where id = d.id;
    insert into public.debt_log (debt_id, kind, from_status, to_status, note)
    values (d.id, 'upload', d.status, case when d.status = 'collected' then 'collected_confirmed' else 'cleared' end, 'Cleared by upload ' || u.as_at);
    cleared := cleared + 1;
  end loop;

  update public.debt_uploads set status = 'confirmed', confirmed_at = now() where id = u.id;
  return jsonb_build_object('added', added, 'updated', updated, 'cleared', cleared, 'mismatches', mismatches);
end $$;
