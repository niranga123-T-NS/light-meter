-- Debtors: what is still owed, and the weekly list as the truth.
--  * balance = what is still owed on an invoice: nothing once it is marked collected (until the next list confirms it), the amount
--    less the part collections when part collected, else the amount. Every total, age bracket, dashboard, customer profile and the
--    debtor check of a new inquiry use it, so a collected invoice no longer counts as outstanding.
--  * Each confirmed debtors list updates every invoice in it in full: an invoice still in the list is outstanding again at the list's
--    amount (a "collected" one keeps the mismatch flag for follow-up); the earlier collection entries stay in the history
--    (invoice log, collections, customer profile) and no longer count against it. Invoices not in the list are cleared as before.

alter table public.debts add column if not exists balance numeric(16, 2) generated always as (
  case when status in ('collected', 'collected_confirmed', 'cleared') then 0
       when status = 'partially_collected' then greatest(amount - coalesce(collected_amount, 0), 0)
       else amount end) stored;

create or replace function app.debts_collections_on_upload() returns trigger
language plpgsql security definer set search_path = public as $$
declare as_at date;
begin
  if new.last_upload_id is distinct from old.last_upload_id and new.status in ('partially_collected', 'collected')
     and exists (select 1 from public.debt_upload_rows r where r.upload_id = new.last_upload_id and r.invoice_no = new.invoice_no) then
    select u.as_at into as_at from public.debt_uploads u where u.id = new.last_upload_id;
    new.status := 'outstanding';
    new.collected_amount := null;
    new.collected_date := null;
    new.last_status_at := now();
    insert into public.debt_log (debt_id, kind, from_status, to_status, note)
    values (new.id, 'upload', old.status, 'outstanding', format('Still in the debtors list of %s: outstanding %s – the earlier collection entries are kept in the history', to_char(as_at, 'DD Mon YYYY'), app.fmt_money(new.amount, new.currency)));
  end if;
  return new;
end $$;

-- The totals use the balance. Each function is changed in its current definition (later migrations edited them in place).
create or replace function pg_temp.fn_rep(p_src text, p_a text, p_b text, p_n int) returns text language plpgsql as $f$
declare n int := (length(p_src) - length(replace(p_src, p_a, ''))) / length(p_a);
begin
  if n <> p_n then raise exception 'debtors balance: expected % × "%", found %', p_n, p_a, n; end if;
  return replace(p_src, p_a, p_b);
end $f$;

do $$
declare src text;
begin
  -- My Day: the sales person's debts
  src := pg_get_functiondef('public.my_day'::regproc);
  src := pg_temp.fn_rep(src, 'sum(amount)', 'sum(balance)', 2);
  execute src;
  -- Overall dashboard: debtors by age bracket
  src := pg_get_functiondef('public.overall_dashboard(date, date)'::regprocedure);
  src := pg_temp.fn_rep(src, 'sum(amount)', 'sum(balance)', 2);
  execute src;
  -- Customer profile: what is open now (the payment history keeps the invoice amounts)
  src := pg_get_functiondef('public.customer_debt_profile'::regproc);
  src := pg_temp.fn_rep(src, 'sum(amount) filter (where currency = ''LKR''), 0) from opn', 'sum(balance) filter (where currency = ''LKR''), 0) from opn', 2);
  src := pg_temp.fn_rep(src, 'sum(amount) filter (where currency = ''USD''), 0) from opn', 'sum(balance) filter (where currency = ''USD''), 0) from opn', 2);
  src := pg_temp.fn_rep(src, 'sum(amount) filter (where currency = ''LKR''), 0) as lkr', 'sum(balance) filter (where currency = ''LKR''), 0) as lkr', 1);
  src := pg_temp.fn_rep(src, 'sum(amount) filter (where currency = ''USD''), 0) as usd', 'sum(balance) filter (where currency = ''USD''), 0) as usd', 1);
  execute src;
  -- Debtor check of a new inquiry: a collected invoice is not a bad debt
  src := pg_get_functiondef('public.submit_inquiry'::regproc);
  src := pg_temp.fn_rep(src, 'select count(*) as n, sum(amount) filter (where currency = ''LKR'') as lkr, sum(amount) filter (where currency = ''USD'') as usd',
                             'select count(*) as n, sum(balance) filter (where currency = ''LKR'') as lkr, sum(balance) filter (where currency = ''USD'') as usd', 1);
  src := pg_temp.fn_rep(src, 'and d.status not in (''collected_confirmed'', ''cleared'') and (d.outstanding_days > 90 or d.is_legal)',
                             'and d.status not in (''collected_confirmed'', ''cleared'', ''collected'') and (d.outstanding_days > 90 or d.is_legal)', 1);
  execute src;
end $$;
