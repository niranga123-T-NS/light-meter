-- Customer debtor profile: current outstanding by ageing bracket plus the customer's payment history
-- (every invoice that has been cleared, how many days it took, ageing at clearance, legal / disputes, outstanding trend per upload).
-- Runs with the caller's rights, so the normal debtor visibility applies (sales see only their own debts).

-- Days an invoice took to clear: invoice date → collection / clearing date when the invoice date is known,
-- otherwise the outstanding days in the last upload plus the days until it was cleared.
create or replace function app.debt_days_to_clear(d public.debts) returns int
language sql stable security definer set search_path = public as $$
  select case
    when d.status not in ('cleared', 'collected_confirmed') then null
    when d.invoice_date is not null then greatest(0, coalesce(d.collected_date, (d.cleared_at at time zone app.tz())::date) - d.invoice_date)
    else d.outstanding_days + greatest(0, coalesce(d.collected_date, (d.cleared_at at time zone app.tz())::date)
                                         - coalesce((select as_at from public.debt_uploads where id = d.last_upload_id), (d.cleared_at at time zone app.tz())::date))
  end
$$;

create or replace function public.customer_debt_profile(p_client text) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  k text := lower(btrim(p_client));
  res jsonb;
begin
  with mine as (
    select d.*, app.debt_days_to_clear(d) as days_to_clear,
           exists (select 1 from public.debt_log l where l.debt_id = d.id and l.to_status = 'disputed') as was_disputed,
           exists (select 1 from public.debt_log l where l.debt_id = d.id and l.kind = 'legal') or d.is_legal as was_legal
      from public.debts d where lower(btrim(d.client_name)) = k
  ),
  opn as (select * from mine where status not in ('cleared', 'collected_confirmed')),
  hist as (select * from mine where status in ('cleared', 'collected_confirmed'))
  select jsonb_build_object(
    'client', (select client_name from mine order by created_at desc limit 1),
    'first_seen', (select min(created_at) from mine),
    'sales_people', (select coalesce(jsonb_agg(distinct app.display_name(sales_person_id)), '[]') from mine where sales_person_id is not null),
    'open', jsonb_build_object(
      'n', (select count(*) from opn),
      'lkr', (select coalesce(sum(amount) filter (where currency = 'LKR'), 0) from opn),
      'usd', (select coalesce(sum(amount) filter (where currency = 'USD'), 0) from opn),
      'legal_n', (select count(*) from opn where is_legal),
      'legal_lkr', (select coalesce(sum(amount) filter (where currency = 'LKR'), 0) from opn where is_legal),
      'legal_usd', (select coalesce(sum(amount) filter (where currency = 'USD'), 0) from opn where is_legal),
      'oldest_days', (select max(outstanding_days) from opn),
      'by_bucket', (select coalesce(jsonb_agg(b), '[]') from (
          select ageing_bucket as bucket, count(*) as n,
                 coalesce(sum(amount) filter (where currency = 'LKR'), 0) as lkr, coalesce(sum(amount) filter (where currency = 'USD'), 0) as usd
            from opn group by 1) b),
      'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'invoice_no', invoice_no, 'project_name', project_name, 'amount', amount,
                     'currency', currency, 'days', outstanding_days, 'bucket', ageing_bucket, 'status', status, 'is_legal', is_legal,
                     'invoice_date', invoice_date) order by outstanding_days desc), '[]') from opn)),
    'history', jsonb_build_object(
      'n', (select count(*) from hist),
      'lkr', (select coalesce(sum(amount) filter (where currency = 'LKR'), 0) from hist),
      'usd', (select coalesce(sum(amount) filter (where currency = 'USD'), 0) from hist),
      'avg_days', (select round(avg(days_to_clear)) from hist),
      'median_days', (select percentile_cont(0.5) within group (order by days_to_clear) from hist where days_to_clear is not null),
      'max_days', (select max(days_to_clear) from hist),
      'min_days', (select min(days_to_clear) from hist),
      'within_30', (select count(*) from hist where days_to_clear <= 30),
      'within_60', (select count(*) from hist where days_to_clear between 31 and 60),
      'within_90', (select count(*) from hist where days_to_clear between 61 and 90),
      'within_180', (select count(*) from hist where days_to_clear between 91 and 180),
      'over_180', (select count(*) from hist where days_to_clear > 180),
      'legal_n', (select count(*) from mine where was_legal),
      'disputed_n', (select count(*) from mine where was_disputed),
      'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'invoice_no', invoice_no, 'project_name', project_name, 'amount', amount,
                     'currency', currency, 'invoice_date', invoice_date, 'closed_on', coalesce(collected_date, (cleared_at at time zone app.tz())::date),
                     'days_to_clear', days_to_clear, 'status', status, 'was_legal', was_legal, 'was_disputed', was_disputed)
                     order by coalesce(collected_date, (cleared_at at time zone app.tz())::date) desc nulls last), '[]') from hist)),
    'trend', (select coalesce(jsonb_agg(t order by t.as_at), '[]') from (
        select u.as_at, coalesce(sum(s.amount) filter (where m.currency = 'LKR'), 0) as lkr,
               coalesce(sum(s.amount) filter (where m.currency = 'USD'), 0) as usd, count(*) as n, max(s.outstanding_days) as oldest_days
          from public.debt_snapshots s join mine m on m.id = s.debt_id join public.debt_uploads u on u.id = s.upload_id
         where u.status = 'confirmed'
         group by u.as_at order by u.as_at desc limit 26) t)
  ) into res;
  return res;
end $$;

revoke execute on function public.customer_debt_profile(text) from public, anon;
grant execute on function public.customer_debt_profile(text) to authenticated, service_role;
revoke execute on function app.debt_days_to_clear(public.debts) from public, anon;
grant execute on function app.debt_days_to_clear(public.debts) to authenticated, service_role;
