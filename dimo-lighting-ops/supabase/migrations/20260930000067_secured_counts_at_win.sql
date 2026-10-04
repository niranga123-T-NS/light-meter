-- Sales targets = budget (from the budget list) vs secured (projects won / marked secured) vs invoiced (OR file).
-- Secured now counts as soon as a project is won or marked secured, not after the schedule approval; until a schedule is
-- entered the order value (less anything invoiced before) is taken as this year's part. (Copied from 20260930000057.)
create or replace function public.finance_performance(p_fy int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  all_people boolean := app.has_role('gm', 'sm_projects', 'sm_estimation', 'operations_exec');
  fs date := app.fy_start(p_fy);
  fe date := app.fy_end(p_fy);
  latest date;
  people jsonb;
begin
  perform app.require(all_people or app.has_role('asm_building', 'asm_infra'), 'Not available for your role');
  select max(month) into latest from public.or_uploads where fy = p_fy;
  with persons as (
    select distinct x.pid from (
      select sales_person_id as pid from public.sales_targets where fy = p_fy
      union select sales_person_id from public.secured_projects where status <> 'cancelled'
      union select sales_person_id from public.budget_projects where fy = p_fy
    ) x where x.pid is not null and (all_people or x.pid = auth.uid())
  ), months as (
    select generate_series(fs, fs + interval '11 months', interval '1 month')::date as month
  ), credit as (
    -- Secured: this-year part of each project won (sales) or marked secured (Operations) this year, in the month it was won,
    -- counted at once. With an invoice schedule (draft or approved) = its invoices due this year; without one yet = the
    -- order value not invoiced before (taken as all due this year until the schedule is entered).
    select s.sales_person_id as pid, app.month_of(s.won_on) as month,
           sum(case when exists (select 1 from public.invoice_lines l where l.secured_id = s.id)
                    then (select coalesce(sum(l.amount), 0) from public.invoice_lines l where l.secured_id = s.id and l.original_month between fs and fe)
                    else greatest(coalesce(s.order_value, 0) - s.billed_before, 0) end) as amt
      from public.secured_projects s
     where s.source = 'won' and s.status <> 'cancelled' and s.won_on between fs and fe
     group by 1, 2
  ), pending as (
    select s.sales_person_id as pid, count(*) as n, sum(s.order_value) as amt
      from public.secured_projects s
     where s.source = 'won' and s.schedule_status <> 'approved' and s.status = 'open' and s.won_on between fs and fe
     group by 1
  ), inv as (
    select s.sales_person_id as pid, a.month, sum(a.amount) as amt
      from public.invoice_allocations a join public.secured_projects s on s.id = a.secured_id
     where a.month between fs and fe group by 1, 2
  ), tobill as (
    select v.sales_person_id as pid, sum(greatest(v.remaining, 0)) as amt
      from public.invoice_line_status v
     where v.project_status = 'open' and v.forecast_month <= fe and v.remaining > 0 group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.pid, 'name', app.display_name(p.pid), 'role', (select role from public.profiles where id = p.pid),
      'lines', (select coalesce(jsonb_agg(distinct b.business_line), '[]') from public.budget_projects b where b.fy = p_fy and b.sales_person_id = p.pid),
      'to_bill_fy', coalesce((select amt from tobill where tobill.pid = p.pid), 0),
      'pending_n', coalesce((select n from pending where pending.pid = p.pid), 0),
      'pending_value', coalesce((select amt from pending where pending.pid = p.pid), 0),
      'months', (select jsonb_agg(jsonb_build_object('month', m.month,
          'secured_target', coalesce((select secured_target from public.sales_targets t where t.fy = p_fy and t.sales_person_id = p.pid and t.month = m.month), 0),
          'invoice_target', coalesce((select invoice_target from public.sales_targets t where t.fy = p_fy and t.sales_person_id = p.pid and t.month = m.month), 0),
          'secured', coalesce((select sum(amt) from credit c where c.pid = p.pid and c.month = m.month), 0),
          'invoiced', coalesce((select sum(amt) from inv i where i.pid = p.pid and i.month = m.month), 0)) order by m.month) from months m)
    ) order by app.display_name(p.pid)), '[]') into people
    from persons p;
  return jsonb_build_object('fy', p_fy, 'latest_month', latest, 'people', people,
    'targets_status', (select status from public.target_sets where fy = p_fy),
    'unlinked_invoiced', case when all_people then
      (select coalesce(sum(w.revenue), 0) from public.wbs_actuals w join public.or_uploads u on u.id = w.upload_id
        where u.fy = p_fy and not exists (select 1 from public.secured_projects s where app.wbs_base(s.wbs) = w.wbs)) end);
end $$;
