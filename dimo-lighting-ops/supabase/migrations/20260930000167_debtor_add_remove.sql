-- Debtors kept in the system by the Operations Executive: besides correcting a debt (edit_debt), a debtor can be added
-- directly (without an upload) and a wrong entry removed (kept in the history as cleared, with the reason). A debtor added
-- here is updated by the next upload when the file has its invoice number, and cleared when the file no longer has it.

alter table public.debts drop constraint if exists debts_source_check;
alter table public.debts add constraint debts_source_check check (source in ('upload', 'sample', 'manual'));

create or replace function public.add_debt(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare did uuid; inv text := nullif(btrim(p ->> 'invoice_no'), ''); o_id uuid; amt numeric; cur public.currency; days int; sp uuid := nullif(p ->> 'sales_person_id', '')::uuid;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive adds debtors');
  perform app.require(coalesce(btrim(p ->> 'client_name'), '') <> '', 'Client name is required');
  perform app.require(inv is not null, 'Invoice number is required');
  perform app.require(not exists (select 1 from public.debts where invoice_no = inv), 'A debt with invoice number ' || inv || ' already exists');
  amt := nullif(replace(p ->> 'amount', ',', ''), '')::numeric;
  perform app.require(amt is not null and amt > 0, 'Enter the outstanding amount');
  perform app.require(coalesce(p ->> 'currency', '') in ('LKR', 'USD'), 'Currency must be LKR or USD');
  cur := (p ->> 'currency')::public.currency;
  days := coalesce(nullif(p ->> 'outstanding_days', '')::int,
                   case when nullif(p ->> 'invoice_date', '') is not null then greatest(0, (now() at time zone app.tz())::date - (p ->> 'invoice_date')::date) end);
  perform app.require(days is not null and days >= 0, 'Enter the invoice date or the outstanding days');
  perform app.require(sp is null or exists (select 1 from public.profiles where id = sp and role in ('asm_building', 'asm_infra') and active), 'Choose an active sales person');
  select o.id into o_id from public.organizations o where o.merged_into is null and o.name_norm = app.normalize_name(btrim(p ->> 'client_name')) limit 1;
  insert into public.debts (invoice_no, project_name, organization_id, client_name, sales_person_id, invoice_date, amount, currency, outstanding_days, source)
  values (inv, nullif(btrim(p ->> 'project_name'), ''), o_id, btrim(p ->> 'client_name'), sp, nullif(p ->> 'invoice_date', '')::date, amt, cur, days, 'manual')
  returning id into did;
  insert into public.debt_log (debt_id, kind, note) values (did, 'edit', 'Added in the system by Operations' || coalesce(' · ' || nullif(btrim(p ->> 'note'), ''), ''));
  if sp is not null then
    perform app.notify(sp, 'debt_assigned', 'Debt assigned to you', format('%s · %s · %s', btrim(p ->> 'client_name'), inv, app.fmt_money(amt, cur)), 'normal', 'debt', did, '/debtors/' || did);
  end if;
  return did;
end $$;

-- Remove a wrong debtor entry: cleared with the reason (the history stays)
create or replace function public.remove_debt(p_debt uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.debts;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive removes debtors');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select * into d from public.debts where id = p_debt for update;
  perform app.require(d.id is not null, 'Debt not found');
  perform app.require(d.source <> 'sample', 'A sample sale debt is changed on the sample');
  perform app.require(d.status not in ('cleared', 'collected_confirmed'), 'Already cleared');
  update public.debts set status = 'cleared', status_note = 'Removed by Operations: ' || btrim(p_reason), cleared_at = now(), last_status_at = now() where id = d.id;
  insert into public.debt_log (debt_id, kind, from_status, to_status, note) values (d.id, 'edit', d.status, 'cleared', 'Removed: ' || btrim(p_reason));
  if d.sales_person_id is not null and d.sales_person_id <> auth.uid() then
    perform app.notify(d.sales_person_id, 'debt_edit', 'Debtor removed – ' || d.invoice_no, format('%s · %s', d.client_name, btrim(p_reason)), 'normal', 'debt', d.id, '/debtors/' || d.id);
  end if;
end $$;

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
  perform app.require(d.source in ('upload', 'manual'), 'A sample sale debt is changed on the sample');
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

revoke execute on function public.add_debt(jsonb), public.remove_debt(uuid, text) from public, anon;
grant execute on function public.add_debt(jsonb), public.remove_debt(uuid, text) to authenticated, service_role;
