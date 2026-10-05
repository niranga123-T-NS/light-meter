-- Invoicing is never based on the OR file's transactions: the OR file gives the P&L only (from now on it may contain only
-- the P&L sheet). The amounts taken from the August OR file before that change are removed; invoices count only when
-- recorded on the secured project (an OR amount someone already gave an invoice number to is kept – it was confirmed).
create or replace function app.remove_or_invoices() returns int
language plpgsql security definer set search_path = public as $$
declare a record; n int := 0;
begin
  for a in select x.secured_id, count(*) as k, sum(x.amount) as amt from public.invoice_allocations x
            where x.upload_id is not null and x.invoice_no is null group by x.secured_id loop
    insert into public.secured_log (secured_id, action, note)
    values (a.secured_id, 'invoice', format('%s amount(s) from the OR file removed (%s) – record the actual invoice(s)', a.k, app.fmt_money(a.amt, 'LKR')));
    n := n + a.k;
  end loop;
  delete from public.invoice_allocations where upload_id is not null and invoice_no is null;
  return n;
end $$;
revoke execute on function app.remove_or_invoices() from public, anon, authenticated;

select app.remove_or_invoices();
