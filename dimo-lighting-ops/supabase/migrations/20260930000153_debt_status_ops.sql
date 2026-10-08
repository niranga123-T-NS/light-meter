-- Debtors: the Operations Executive can update the status of any debtor record (as well as edit its details);
-- the sales person following it up is told.

create or replace function public.update_debt_status(
  p_debt uuid, p_status text, p_note text default null, p_next_follow_up date default null, p_promised_date date default null,
  p_collected_amount numeric default null, p_collected_date date default null, p_ref text default null
) returns void language plpgsql security definer set search_path = public as $$
declare d public.debts;
begin
  select * into d from public.debts where id = p_debt for update;
  perform app.require(d.id is not null, 'Debt not found');
  perform app.require(d.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm', 'operations_exec'), 'Only the sales person, Operations, SM Projects or GM / DGM update this debt');
  perform app.require(p_status in ('follow_up', 'payment_promised', 'partially_collected', 'collected', 'disputed', 'outstanding'), 'Invalid status');
  perform app.require(p_status <> 'follow_up' or (p_note is not null and p_next_follow_up is not null), 'Add a note and the next follow-up date');
  perform app.require(p_status <> 'payment_promised' or p_promised_date is not null, 'Add the promised date');
  perform app.require(p_status <> 'partially_collected' or p_collected_amount is not null, 'Enter the amount collected');
  perform app.require(p_status <> 'collected' or p_collected_date is not null, 'Enter the collection date');
  perform app.require(p_status <> 'disputed' or p_note is not null, 'Give the dispute reason');
  update public.debts set status = p_status, status_note = p_note, next_follow_up_date = p_next_follow_up,
    promised_date = p_promised_date, collected_amount = coalesce(p_collected_amount, collected_amount),
    collected_date = p_collected_date, collected_ref = p_ref,
    dispute_reason = case when p_status = 'disputed' then p_note else dispute_reason end,
    last_status_at = now()
  where id = d.id;
  insert into public.debt_log (debt_id, kind, from_status, to_status, note) values (d.id, 'status', d.status, p_status, p_note);
  -- the sales person following the invoice up is told when someone else updates it
  if d.sales_person_id is not null and d.sales_person_id <> auth.uid() then
    perform app.notify(d.sales_person_id, 'debt_update', 'Debtor status updated – ' || d.invoice_no,
      format('%s · %s → %s%s · by %s', d.client_name, replace(d.status, '_', ' '), replace(p_status, '_', ' '), coalesce(' · ' || nullif(btrim(p_note), ''), ''), app.display_name(auth.uid())),
      'normal', 'debt', d.id, '/debtors/' || d.id);
  end if;
end $$;
