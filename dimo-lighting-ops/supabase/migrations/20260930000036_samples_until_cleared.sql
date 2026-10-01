-- Samples stay on record until they are cleared:
--  * Returnable: the sales person reports it returned → the Operations Executive confirms (condition) → cleared.
--  * Non-returnable: Sell or FOC.  FOC → recorded and cleared at handover.
--    Sell → at handover a debt is added to the debtors list (sales person, client, value); the sample stays "sold – unpaid"
--    until that debt is cleared the normal way (the sales person marks it collected, the next weekly upload confirms it).

alter table public.samples drop constraint if exists samples_status_check;
alter table public.samples add constraint samples_status_check check (status in (
  'draft', 'submitted', 'availability_confirmed', 'not_available', 'approved', 'rejected', 'returned_for_changes',
  'handed_over', 'out', 'return_reported', 'returned', 'sold_unpaid', 'closed', 'damaged_lost', 'cleared'));
alter table public.samples add column if not exists nr_disposition text check (nr_disposition in ('sell', 'foc'));
alter table public.samples add column if not exists return_reported_at timestamptz;
alter table public.samples add column if not exists return_report_note text;
alter table public.samples add column if not exists cleared_at timestamptz;
alter table public.samples add column if not exists clear_note text;
alter table public.samples add column if not exists debt_id uuid references public.debts (id);

-- Earlier finished samples count as cleared
update public.samples set status = 'cleared', cleared_at = coalesce(returned_at, handed_over_at, now()) where status in ('returned', 'closed');

-- Debts raised from a sample sale are not in the accounts file: the weekly upload does not clear them
alter table public.debts add column if not exists source text not null default 'upload' check (source in ('upload', 'sample'));
alter table public.debts add column if not exists sample_id uuid references public.samples (id);

create or replace function public.submit_sample(p_sample uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.sales_person_id = auth.uid(), 'Only the requester can submit');
  perform app.require(s.status in ('draft', 'returned_for_changes'), 'Already submitted');
  perform app.require(exists (select 1 from public.sample_items where sample_id = s.id), 'Add at least one item');
  perform app.require(s.sample_type = 'returnable' or s.nr_disposition is not null, 'Non-returnable samples: choose Sell or FOC');
  perform set_config('app.workflow', '1', true);
  update public.samples set status = 'submitted', submitted_at = now() where id = s.id;
  perform app.notify_many(app.role_users('operations_exec'), 'sample_request', 'Sample request ' || s.code,
    format('%s – %s. Needed %s', s.project_name, s.client_name, to_char(s.required_by at time zone app.tz(), 'DD Mon HH24:MI')),
    'normal', 'sample', s.id, '/samples/' || s.id, null, true);
end $$;

drop function if exists public.record_sample_handover(uuid, text, text, timestamptz);
create or replace function public.record_sample_handover(p_sample uuid, p_handed_over_by text, p_received_by text,
                                                         p_at timestamptz default now(), p_invoice_no text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.samples; did uuid; inv text;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive records the handover');
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.status = 'approved', 'Sample must be approved first');
  perform app.require(app.has_attachment('sample', s.id, 'delivery_note'), 'Attach a photo or the signed delivery note');
  perform app.require(s.sample_type = 'returnable' or s.nr_disposition is not null, 'Non-returnable samples: choose Sell or FOC first');
  perform set_config('app.workflow', '1', true);
  if s.sample_type = 'non_returnable' and s.nr_disposition = 'sell' then
    inv := coalesce(nullif(btrim(p_invoice_no), ''), s.code);
    perform app.require(not exists (select 1 from public.debts where invoice_no = inv), 'This invoice number is already in the debtors list');
    insert into public.debts (invoice_no, project_id, project_name, organization_id, unit_id, client_name, sales_person_id,
      invoice_date, amount, currency, outstanding_days, source, sample_id)
    values (inv, s.project_id, s.project_name, s.organization_id, s.unit_id, s.client_name, s.sales_person_id,
      (p_at at time zone app.tz())::date, s.total_value, s.currency, 0, 'sample', s.id)
    returning id into did;
    insert into public.debt_log (debt_id, kind, to_status, note) values (did, 'upload', 'outstanding', 'Sample sold: ' || s.code);
  end if;
  update public.samples set handed_over_at = p_at, handed_over_by = p_handed_over_by, received_by = p_received_by, debt_id = coalesce(did, debt_id),
    status = case when sample_type = 'returnable' then 'out'
                  when nr_disposition = 'sell' then 'sold_unpaid' else 'cleared' end,
    cleared_at = case when sample_type = 'non_returnable' and nr_disposition = 'foc' then p_at end
  where id = s.id;
  perform app.notify_many(array[s.sales_person_id] || app.role_users('sm_projects'), 'sample_step', 'Sample handed over: ' || s.code,
    format('Received by %s%s', p_received_by,
      case when did is not null then format(' · sold – %s added to your debtors (%s)', inv, app.fmt_money(s.total_value, s.currency))
           when s.sample_type = 'non_returnable' then ' · free of charge – cleared' else '' end),
    'normal', 'sample', s.id, '/samples/' || s.id);
end $$;

-- Sales person: the returnable sample is back
create or replace function public.report_sample_returned(p_sample uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person reports the return');
  perform app.require(s.status = 'out', 'Sample is not out');
  perform set_config('app.workflow', '1', true);
  update public.samples set status = 'return_reported', return_reported_at = now(), return_report_note = p_note where id = s.id;
  perform app.notify_many(app.role_users('operations_exec'), 'sample_return_reported', 'Sample returned – confirm: ' || s.code,
    format('%s – %s · reported by %s%s', s.client_name, s.project_name, app.display_name(auth.uid()), coalesce(' · ' || p_note, '')),
    'normal', 'sample', s.id, '/samples/' || s.id, null, true);
end $$;

-- Operations Executive confirms the return (approval) – good condition clears the sample
create or replace function public.record_sample_return(p_sample uuid, p_condition text, p_at timestamptz default now(), p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive confirms returns');
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.status in ('out', 'return_reported'), 'Sample is not out');
  perform app.require(p_condition in ('good', 'damaged', 'incomplete'), 'Choose the condition');
  perform app.require(p_condition = 'good' or coalesce(trim(p_note), '') <> '', 'Describe the damage / missing items');
  perform set_config('app.workflow', '1', true);
  update public.samples set returned_at = p_at, return_condition = p_condition,
    status = case when p_condition = 'good' then 'cleared' else 'damaged_lost' end,
    cleared_at = case when p_condition = 'good' then now() end,
    clear_note = case when p_condition = 'good' then p_note end, notes = coalesce(p_note, notes) where id = s.id;
  if p_condition <> 'good' then
    perform app.notify_many(app.role_users('sm_projects'), 'sample_damaged', 'Sample returned ' || p_condition || ': ' || s.code,
      coalesce(p_note, ''), 'normal', 'sample', s.id, '/samples/' || s.id);
  end if;
  perform app.notify(s.sales_person_id, 'sample_step',
    case when p_condition = 'good' then 'Sample return confirmed – cleared: ' else 'Sample returned ' || p_condition || ': ' end || s.code,
    coalesce(p_note, ''), 'normal', 'sample', s.id, '/samples/' || s.id);
end $$;

-- Damaged / incomplete returns stay open until the Operations Executive clears them (recovered, charged, written off …)
create or replace function public.clear_sample(p_sample uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive clears samples');
  perform app.require(coalesce(trim(p_note), '') <> '', 'Say how it was settled');
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.status = 'damaged_lost', 'Only damaged / incomplete returns are cleared this way');
  perform set_config('app.workflow', '1', true);
  update public.samples set status = 'cleared', cleared_at = now(), clear_note = p_note where id = s.id;
  perform app.notify(s.sales_person_id, 'sample_step', 'Sample cleared: ' || s.code, p_note, 'normal', 'sample', s.id, '/samples/' || s.id);
end $$;

-- Sold sample: cleared when its debt is collected / cleared
create or replace function app.debts_sample_cleared() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sample_id is not null and new.status in ('collected_confirmed', 'cleared') and old.status is distinct from new.status then
    perform set_config('app.workflow', '1', true);
    update public.samples set status = 'cleared', cleared_at = now(),
      clear_note = case when new.status = 'collected_confirmed' then 'Payment collected' else 'Debt cleared' end
     where id = new.sample_id and status = 'sold_unpaid';
  end if;
  return new;
end $$;
drop trigger if exists debts_sample_cleared on public.debts;
create trigger debts_sample_cleared after update of status on public.debts
for each row execute function app.debts_sample_cleared();

revoke execute on function public.record_sample_handover(uuid, text, text, timestamptz, text), public.report_sample_returned(uuid, text),
  public.clear_sample(uuid, text) from public, anon;
grant execute on function public.record_sample_handover(uuid, text, text, timestamptz, text), public.report_sample_returned(uuid, text),
  public.clear_sample(uuid, text) to authenticated, service_role;

-- Weekly upload: sample-sale debts are not in the accounts file – they age from the handover date and are confirmed
-- (collected → collected_confirmed) instead of being cleared for being absent
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

  -- Sample sales not in the file: keep ageing; a collected one is confirmed
  update public.debts set outstanding_days = greatest(0, u.as_at - invoice_date), last_upload_id = u.id
   where source = 'sample' and status not in ('cleared', 'collected_confirmed', 'collected')
     and invoice_no not in (select invoice_no from public.debt_upload_rows where upload_id = u.id);

  -- Invoices no longer in the file
  for d in select * from public.debts
           where status not in ('cleared', 'collected_confirmed')
             and (source <> 'sample' or status = 'collected')
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
