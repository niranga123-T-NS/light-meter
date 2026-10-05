-- Debts already confirmed from the Excel upload can be corrected by the Operations Executive (with a reason).
-- Every change is written to the debt's history; the latest upload snapshot follows so ageing reports agree.
-- (The next upload still updates amount, days and names from the file – it stays the source of truth.)

alter table public.debt_log drop constraint if exists debt_log_kind_check;
alter table public.debt_log add constraint debt_log_kind_check check (kind in ('status', 'legal', 'upload', 'edit'));

-- p_data: any of {client_name, project_name, invoice_no, invoice_date, amount, currency, outstanding_days}
create or replace function public.edit_debt(p_debt uuid, p_data jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.debts;
  n public.debts;
  chg text[] := '{}';
  o_id uuid;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive edits the debtors');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason for the change');
  select * into d from public.debts where id = p_debt for update;
  perform app.require(d.id is not null, 'Debt not found');
  perform app.require(d.source = 'upload', 'A sample sale debt is changed on the sample');
  n := d;
  if p_data ? 'client_name' then n.client_name := nullif(btrim(p_data ->> 'client_name'), ''); end if;
  if p_data ? 'project_name' then n.project_name := nullif(btrim(p_data ->> 'project_name'), ''); end if;
  if p_data ? 'invoice_no' then n.invoice_no := nullif(btrim(p_data ->> 'invoice_no'), ''); end if;
  if p_data ? 'invoice_date' then n.invoice_date := nullif(p_data ->> 'invoice_date', '')::date; end if;
  if p_data ? 'amount' then n.amount := nullif(replace(p_data ->> 'amount', ',', ''), '')::numeric; end if;
  if p_data ? 'currency' then n.currency := nullif(p_data ->> 'currency', '')::public.currency; end if;
  if p_data ? 'outstanding_days' then n.outstanding_days := nullif(p_data ->> 'outstanding_days', '')::int; end if;
  perform app.require(n.client_name is not null, 'Client name is required');
  perform app.require(n.invoice_no is not null, 'Invoice number is required');
  perform app.require(n.amount is not null, 'Outstanding amount is required');
  perform app.require(n.currency is not null, 'Currency must be LKR or USD');
  perform app.require(n.outstanding_days is not null and n.outstanding_days >= 0, 'Outstanding days must be 0 or more');
  perform app.require(n.invoice_no = d.invoice_no or not exists (select 1 from public.debts where invoice_no = n.invoice_no and id <> d.id),
    'Another debt already has invoice number ' || coalesce(n.invoice_no, ''));

  if n.client_name is distinct from d.client_name then chg := chg || format('client %s → %s', d.client_name, n.client_name); end if;
  if n.project_name is distinct from d.project_name then chg := chg || format('project %s → %s', coalesce(d.project_name, '—'), coalesce(n.project_name, '—')); end if;
  if n.invoice_no is distinct from d.invoice_no then chg := chg || format('invoice %s → %s', d.invoice_no, n.invoice_no); end if;
  if n.invoice_date is distinct from d.invoice_date then
    chg := chg || format('invoice date %s → %s', coalesce(to_char(d.invoice_date, 'DD Mon YYYY'), '—'), coalesce(to_char(n.invoice_date, 'DD Mon YYYY'), '—'));
  end if;
  if n.amount is distinct from d.amount or n.currency is distinct from d.currency then
    chg := chg || format('amount %s → %s', app.fmt_money(d.amount, d.currency), app.fmt_money(n.amount, n.currency));
  end if;
  if n.outstanding_days is distinct from d.outstanding_days then chg := chg || format('days %s → %s', d.outstanding_days, n.outstanding_days); end if;
  perform app.require(cardinality(chg) > 0, 'Nothing was changed');

  -- A new client name is linked to the matching customer, if there is one
  if n.client_name is distinct from d.client_name then
    select o.id into o_id from public.organizations o where o.merged_into is null and o.name_norm = app.normalize_name(n.client_name) limit 1;
    n.organization_id := o_id;
    if o_id is distinct from d.organization_id then n.unit_id := null; end if;
  end if;

  update public.debts set client_name = n.client_name, project_name = n.project_name, invoice_no = n.invoice_no, invoice_date = n.invoice_date,
    amount = n.amount, currency = n.currency, outstanding_days = n.outstanding_days, organization_id = n.organization_id, unit_id = n.unit_id,
    last_amount_change_at = case when n.amount < d.amount then now() else last_amount_change_at end
   where id = d.id;
  if d.last_upload_id is not null then
    update public.debt_snapshots set amount = n.amount, outstanding_days = n.outstanding_days where upload_id = d.last_upload_id and debt_id = d.id;
  end if;
  insert into public.debt_log (debt_id, kind, note) values (d.id, 'edit', array_to_string(chg, '; ') || ' · ' || btrim(p_reason));
  if d.sales_person_id is not null and d.sales_person_id <> auth.uid() then
    perform app.notify(d.sales_person_id, 'debt_edit', 'Debtor details corrected – ' || n.invoice_no,
      format('%s · %s · %s', n.client_name, array_to_string(chg, '; '), btrim(p_reason)), 'normal', 'debt', d.id, '/debtors/' || d.id);
  end if;
end $$;

revoke execute on function public.edit_debt(uuid, jsonb, text) from public, anon;
grant execute on function public.edit_debt(uuid, jsonb, text) to authenticated, service_role;
