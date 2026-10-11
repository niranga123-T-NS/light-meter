-- Invoicing forecast for the financial year: what potential (not yet won) projects should add to invoicing by 31 March,
-- on top of what is already invoiced and what secured orders still have to invoice this year.
--  * Each open project: lighting value × win % (weighted), from the expected award date (today if it has passed).
--  * Delivery = award + manufacturing + sea freight + clearing, by the manufacturing origin:
--      European 6–8 weeks (7) + 4–5 weeks (4.5); Chinese 3–6 weeks (4.5) + 3 weeks; clearing and delivery 1 week.
--    Origin from the quotation's brands (any European brand → European), else the inquiry's manufacturing origin, else European.
--  * Supply (and commissioning): 100% invoiced on delivery.
--    Supply and installation: 70% on delivery (material), 20% spread over the rest of the project duration (installation),
--    10% retention after the defects liability period (12 months).
--    Basis from the inquiry's estimation basis, else short-term projects are taken as supply, others as supply and installation.
--  * The weeks and percentages are settings that SM Projects and the GM / DGM can change.

insert into public.settings (key, value, description) values
  ('invoice_forecast', jsonb_build_object(
     'eu_mfg_weeks', 7, 'eu_sea_weeks', 4.5, 'cn_mfg_weeks', 4.5, 'cn_sea_weeks', 3, 'clearing_weeks', 1, 'unknown_origin', 'european',
     'material_pct', 70, 'install_pct', 20, 'retention_pct', 10, 'dlp_months', 12),
   'Invoicing forecast: manufacturing and sea-freight weeks by origin, clearing weeks, and the supply & installation invoicing split')
on conflict (key) do nothing;

-- Weeks from award to delivery on site
create or replace function app.forecast_lead_days(p_origin text) returns int
language sql stable security definer set search_path = public as $$
  with s as (select coalesce(app.setting('invoice_forecast'), '{}'::jsonb) v)
  select round(7 * (case when coalesce(nullif(p_origin, 'unknown'), s.v ->> 'unknown_origin', 'european') = 'chinese'
                         then coalesce((s.v ->> 'cn_mfg_weeks')::numeric, 4.5) + coalesce((s.v ->> 'cn_sea_weeks')::numeric, 3)
                         else coalesce((s.v ->> 'eu_mfg_weeks')::numeric, 7) + coalesce((s.v ->> 'eu_sea_weeks')::numeric, 4.5) end
                    + coalesce((s.v ->> 'clearing_weeks')::numeric, 1)))::int
    from s
$$;

-- The invoicing months of one project: [{month, pct, kind}]
create or replace function app.forecast_schedule(p_award date, p_origin text, p_basis text, p_duration_months int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := coalesce(app.setting('invoice_forecast'), '{}'::jsonb); delivery date; mat numeric; inst numeric; ret numeric; n int; out jsonb := '[]'; i int;
begin
  if p_award is null then return out; end if;
  delivery := p_award + app.forecast_lead_days(p_origin);
  if p_basis = 'supply' then
    return jsonb_build_array(jsonb_build_object('month', date_trunc('month', delivery)::date, 'pct', 100, 'kind', 'delivery'));
  end if;
  mat := coalesce((v ->> 'material_pct')::numeric, 70);
  ret := coalesce((v ->> 'retention_pct')::numeric, 10);
  inst := greatest(100 - mat - ret, 0);
  -- installation over the rest of the project's duration after delivery (at least one month)
  n := greatest(1, coalesce(p_duration_months, 6) - ceil(app.forecast_lead_days(p_origin) / 30.0)::int);
  out := jsonb_build_array(jsonb_build_object('month', date_trunc('month', delivery)::date, 'pct', mat, 'kind', 'delivery'));
  for i in 1 .. n loop
    out := out || jsonb_build_array(jsonb_build_object('month', (date_trunc('month', delivery) + make_interval(months => i))::date, 'pct', case when i = n then inst - round(inst / n, 4) * (n - 1) else round(inst / n, 4) end, 'kind', 'progress'));
  end loop;
  out := out || jsonb_build_array(jsonb_build_object('month', (date_trunc('month', delivery) + make_interval(months => n + coalesce((v ->> 'dlp_months')::int, 12)))::date,
                                                     'pct', ret, 'kind', 'retention'));
  return out;
end $$;

create or replace function public.invoicing_forecast(p_fy integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  everyone boolean := app.has_role('gm', 'sm_projects');
  fs date := app.fy_start(p_fy);
  fe date := app.fy_end(p_fy);
  today date := (now() at time zone app.tz())::date;
  this_month date := date_trunc('month', (now() at time zone app.tz())::date)::date;
begin
  perform app.require(everyone or app.is_sales_person(), 'The invoicing forecast is for sales, SM Projects and GM / DGM');
  return jsonb_build_object(
    'fy', p_fy, 'today', today, 'this_month', this_month,
    'settings', coalesce(app.setting('invoice_forecast'), '{}'::jsonb),
    -- Potential projects (not won / lost / on hold) with their invoicing months
    'projects', coalesce((
      select jsonb_agg(row_to_json(x) order by x.award_used nulls last, x.weighted_lkr desc) from (
        select y.*, app.forecast_lead_days(y.origin) as lead_days, (y.award_used + app.forecast_lead_days(y.origin)) as delivery_date,
               app.forecast_schedule(y.award_used, y.origin, y.basis, y.duration_months) as schedule
          from (
            select p.id, p.code, p.name, o.name as customer, p.owner_id, p.project_type, p.project_term as term, p.milestone, p.win_probability,
                   coalesce(bl.business_line, case when p.project_type in ('infrastructure', 'industrial') then 'infrastructure' end) as line,
                   round(coalesce(app.to_lkr(p.lighting_value, p.currency), 0), 2) as value_lkr,
                   round(coalesce(app.to_lkr(p.lighting_value, p.currency), 0) * p.win_probability / 100.0, 2) as weighted_lkr,
                   p.expected_award_date, p.expected_duration_months as duration_months,
                   greatest(today, coalesce(p.expected_award_date, p.expected_tender_date + 30)) as award_used,
                   case when p.expected_award_date is null and p.expected_tender_date is null then 'none'
                        when p.expected_award_date is null then 'tender'
                        when p.expected_award_date < today then 'passed' else 'award' end as award_from,
                   coalesce(q.origin, iq.origin, 'unknown') as origin,
                   case when q.origin is not null then 'quotation' when iq.origin is not null then 'inquiry' else 'default' end as origin_from,
                   coalesce(iq.basis, case when p.project_term = 'short' then 'supply' else 'supply_install' end) as basis,
                   case when iq.basis is not null then 'inquiry' else 'assumed' end as basis_from,
                   iq.code as inquiry_code,
                   (p.lighting_value is null or p.lighting_value = 0) as no_value
              from public.projects p
              join public.organizations o on o.id = p.organization_id
              left join lateral (select b.business_line from public.budget_projects b where b.project_id = p.id order by b.fy desc limit 1) bl on true
              -- the main open inquiry: its basis and the origin it asked for
              left join lateral (
                select i.id, i.code,
                       case when i.estimation_basis in ('supply', 'supply_commission') then 'supply' when i.estimation_basis like 'supply_install%' then 'supply_install' end as basis,
                       case when i.manufacturing_origin in ('european', 'chinese') then i.manufacturing_origin end as origin
                  from public.inquiries i
                 where i.project_id = p.id and i.status not in ('won', 'lost', 'cancelled', 'rejected', 'draft')
                 order by coalesce(i.est_value, i.order_value, 0) desc, i.created_at desc limit 1) iq on true
              -- the brands quoted: any European brand → European, else Chinese
              left join lateral (
                select case when bool_or(b ->> 'origin' = 'european') then 'european' when bool_or(b ->> 'origin' = 'chinese') then 'chinese' end as origin
                  from public.estimation_jobs e cross join lateral jsonb_array_elements(e.brands_offered) b
                 where e.inquiry_id = iq.id) q on true
             where p.status in ('active', 'dormant') and p.milestone not in ('won', 'lost')
               and (everyone or p.owner_id = me)
          ) y
      ) x), '[]'::jsonb),
    -- Invoiced so far this year (invoices recorded in the app)
    'invoiced', coalesce((
      select jsonb_agg(jsonb_build_object('month', date_trunc('month', a.month)::date, 'amount', a.amount, 'line', s.business_line, 'owner_id', s.sales_person_id))
        from public.invoice_allocations a join public.secured_projects s on s.id = a.secured_id
       where a.month between fs and fe and (everyone or s.sales_person_id = me)), '[]'::jsonb),
    -- Secured orders still to invoice this year (overdue lines counted in the current month)
    'secured', coalesce((
      select jsonb_agg(jsonb_build_object('month', greatest(this_month, date_trunc('month', l.forecast_month)::date), 'amount', l.remaining, 'line', l.business_line,
                                          'owner_id', l.sales_person_id, 'project', l.project_name))
        from public.invoice_line_status l
       where l.remaining > 0 and l.forecast_month <= fe and coalesce(l.project_status, 'open') not in ('cancelled', 'closed')
         and (everyone or l.sales_person_id = me)), '[]'::jsonb),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object('owner_id', t.sales_person_id, 'month', t.month, 'target', t.invoice_target))
        from public.sales_targets t where t.fy = p_fy and (everyone or t.sales_person_id = me)), '[]'::jsonb)
  );
end $$;

-- SM Projects and the GM / DGM change the lead times and the invoicing split
create or replace function public.save_forecast_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; n numeric;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'SM Projects or the GM / DGM change the forecast settings');
  foreach k in array array['eu_mfg_weeks', 'eu_sea_weeks', 'cn_mfg_weeks', 'cn_sea_weeks', 'clearing_weeks', 'material_pct', 'install_pct', 'retention_pct', 'dlp_months'] loop
    n := nullif(p ->> k, '')::numeric;
    perform app.require(n is not null and n >= 0 and n <= 120, format('Enter %s', replace(k, '_', ' ')));
  end loop;
  perform app.require((p ->> 'material_pct')::numeric + (p ->> 'install_pct')::numeric + (p ->> 'retention_pct')::numeric = 100, 'Material + installation + retention must add up to 100%');
  perform app.require(coalesce(p ->> 'unknown_origin', 'european') in ('european', 'chinese'), 'Unknown origin is European or Chinese');
  update public.settings set value = jsonb_build_object(
      'eu_mfg_weeks', (p ->> 'eu_mfg_weeks')::numeric, 'eu_sea_weeks', (p ->> 'eu_sea_weeks')::numeric, 'cn_mfg_weeks', (p ->> 'cn_mfg_weeks')::numeric,
      'cn_sea_weeks', (p ->> 'cn_sea_weeks')::numeric, 'clearing_weeks', (p ->> 'clearing_weeks')::numeric, 'unknown_origin', coalesce(p ->> 'unknown_origin', 'european'),
      'material_pct', (p ->> 'material_pct')::numeric, 'install_pct', (p ->> 'install_pct')::numeric, 'retention_pct', (p ->> 'retention_pct')::numeric,
      'dlp_months', (p ->> 'dlp_months')::int),
    updated_by = auth.uid(), updated_at = now()
   where key = 'invoice_forecast';
end $$;
