-- Pipeline forecast: open projects with their expected order month and weighted value (lighting value × win probability,
-- in LKR), the year's secured orders and the secured-order targets, for one financial year (April – March).
-- GM / DGM and SM Projects see everyone; a sales person sees their own. The app filters and totals, so every summary
-- follows the filters on screen. Hygiene flags travel with each project.
create or replace function public.pipeline_forecast(p_fy int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  everyone boolean := app.has_role('gm', 'sm_projects');
  fs date := app.fy_start(p_fy);
  fe date := app.fy_end(p_fy);
  today date := (now() at time zone app.tz())::date;
  this_month date := date_trunc('month', (now() at time zone app.tz())::date)::date;
begin
  perform app.require(everyone or app.is_sales_person(), 'The pipeline is for sales, SM Projects and GM / DGM');
  return jsonb_build_object(
    'fy', p_fy,
    'today', today,
    'projects', coalesce((
      select jsonb_agg(row_to_json(x) order by x.expected_month, x.weighted_lkr desc) from (
        select p.id, p.code, p.name, o.name as customer, p.owner_id, p.project_type, p.project_term as term, p.duty_status,
               p.currency, p.milestone, p.win_probability, p.status, p.use_wizard,
               coalesce(bl.business_line, case when p.project_type in ('infrastructure', 'industrial') then 'infrastructure' end) as line,
               round(coalesce(app.to_lkr(p.lighting_value, p.currency), 0), 2) as value_lkr,
               round(coalesce(app.to_lkr(p.lighting_value, p.currency), 0) * p.win_probability / 100.0, 2) as weighted_lkr,
               p.expected_award_date,
               case when p.expected_award_date is not null then 'award' when p.expected_tender_date is not null then 'tender' else 'duration' end as month_from,
               greatest(this_month, date_trunc('month', coalesce(p.expected_award_date, p.expected_tender_date + 30,
                 (today + make_interval(months => greatest(p.expected_duration_months, 0)))::date))::date) as expected_month,
               (p.expected_award_date is not null and p.expected_award_date < today) as award_passed,
               (p.lighting_value is null or p.lighting_value = 0) as no_value,
               (p.expected_award_date is null and p.milestone in ('brand_specified', 'quotation_submitted', 'negotiating', 'loa_expected')) as no_award_date,
               lv.last_visit,
               case when lv.last_visit is null then null else today - (lv.last_visit at time zone app.tz())::date end as days_since_visit,
               today - (p.last_probability_review_at at time zone app.tz())::date as prob_review_days,
               today - (coalesce(ms.at, p.created_at) at time zone app.tz())::date as stage_days,
               ws.wizard_pct
          from public.projects p
          join public.organizations o on o.id = p.organization_id
          left join lateral (select b.business_line from public.budget_projects b where b.project_id = p.id order by b.fy desc limit 1) bl on true
          left join lateral (select max(v.checkin_at) as last_visit from public.visits v where v.project_id = p.id) lv on true
          left join lateral (select l.at from public.project_log l where l.project_id = p.id and l.field = 'milestone' order by l.at desc limit 1) ms on true
          left join lateral (select w.wizard_pct from public.win_scores w where w.project_id = p.id order by w.scored_at desc limit 1) ws on true
         where p.status in ('active', 'dormant') and p.milestone not in ('won', 'lost')
           and (everyone or p.owner_id = me)
      ) x), '[]'::jsonb),
    'on_hold', (select jsonb_build_object('n', count(*), 'value_lkr', round(coalesce(sum(app.to_lkr(lighting_value, currency)), 0), 2))
                  from public.projects where status = 'on_hold' and (everyone or owner_id = me)),
    'secured', coalesce((
      select jsonb_agg(row_to_json(y) order by y.month) from (
        select s.id, s.project_name as name, s.customer, s.sales_person_id as owner_id, s.business_line as line,
               round(coalesce(s.order_value, 0), 2) as value_lkr, date_trunc('month', s.won_on)::date as month,
               p.project_type, p.project_term as term, p.duty_status
          from public.secured_projects s
          left join public.projects p on p.id = s.project_id
         where s.source = 'won' and s.status <> 'cancelled' and s.won_on between fs and fe
           and (everyone or s.sales_person_id = me)
      ) y), '[]'::jsonb),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object('owner_id', t.sales_person_id, 'month', t.month, 'target', t.secured_target))
        from public.sales_targets t
       where t.fy = p_fy and (everyone or t.sales_person_id = me)), '[]'::jsonb)
  );
end $$;

revoke execute on function public.pipeline_forecast(int) from public, anon;
grant execute on function public.pipeline_forecast(int) to authenticated, service_role;
