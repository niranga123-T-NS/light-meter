-- Dashboard: time per stage, readable. Each stage gets its usual time (median), slow cases (90th percentile), its target,
-- how many finished on time (by the agreed date, as the SLA tiles) and how many went over; plus the whole journey from
-- submission to the quotation reaching the client. A stage's late cases can be listed with who had them and the reason.

create or replace function public.overall_dashboard(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := app.tz();
  today date := (now() at time zone tz)::date;
  d_from date := coalesce(p_from, date_trunc('month', today)::date);
  d_to date := coalesce(p_to, today);
  sales_only boolean := app.has_role('sm_projects');
begin
  if not app.has_role('gm', 'sm_projects') then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'generated_at', now(),
    'delay_control', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(owner_team::text, 'unassigned') as team, colour, count(*) as n,
               max(case when colour = 'red' then round(app.work_minutes_between(due_at, now()) / app.working_minutes_per_day(), 1) end) as max_days_overdue,
               max(level) as max_level
        from public.sla_clocks where stopped_at is null and colour in ('red', 'amber', 'grey')
        group by 1, 2 order by 1, 2) x),
    'deadlines_at_risk', (select coalesce(jsonb_agg(x order by x.customer_deadline), '[]') from (
        select i.id, i.code, i.project_name, i.customer_name, i.customer_deadline, i.status, i.sla_colour,
               i.customer_deadline - today as days_left, app.display_name(i.current_owner_id) as owner
        from public.inquiries i
        where i.status in ('submitted', 'accepted', 'in_design', 'design_review', 'design_approved', 'in_estimation', 'estimation_review')
          and i.customer_deadline <= today + 7 limit 25) x),
    'delay_reasons', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(owner_team::text, '-') as team, coalesce(delay_reason, hold_reason) as reason, count(*) as n
        from public.sla_clocks where coalesce(delay_reason, hold_reason) is not null and started_at >= d_from - 90
        group by 1, 2 order by 3 desc limit 15) x),
    'sla_performance', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(owner_team::text, '-') as team, count(*) as closed,
               round(100.0 * count(*) filter (where stopped_at <= coalesce(revised_due_at, due_at) + interval '1 minute') / nullif(count(*), 0), 1) as on_time_pct,
               round(avg(app.work_minutes_between(started_at, stopped_at) - paused_minutes) / 60, 1) as avg_hours
        from public.sla_clocks where stopped_at between d_from and d_to + 1 and entity_type in ('design_job', 'estimation_job', 'inquiry')
          and stage not in ('ack')
        group by 1) x),
    'sla_by_stage', (select coalesce(jsonb_agg(x), '[]') from (
        select stage, count(*) as n,
               round(avg(used) / 60, 1) as avg_hours,
               round((percentile_cont(0.5) within group (order by used) / 60)::numeric, 1) as median_hours,
               round((percentile_cont(0.9) within group (order by used) / 60)::numeric, 1) as p90_hours,
               round(avg(target_minutes) / 60, 1) as target_hours,
               count(*) filter (where on_time) as on_time,
               count(*) filter (where not on_time) as late
        from (select c.stage, c.target_minutes, greatest(app.work_minutes_between(c.started_at, c.stopped_at) - c.paused_minutes, 0) as used,
                     c.stopped_at <= coalesce(c.revised_due_at, c.due_at) + interval '1 minute' as on_time
                from public.sla_clocks c where c.stopped_at between d_from and d_to + 1) s
        group by stage order by 3 desc) x),
    'journey', (select jsonb_build_object('n', count(*),
          'median_hours', round((percentile_cont(0.5) within group (order by used) / 60)::numeric, 1),
          'p90_hours', round((percentile_cont(0.9) within group (order by used) / 60)::numeric, 1))
        from (select app.work_minutes_between(i.submitted_at, i.submitted_to_client_at) as used from public.inquiries i
               where i.submitted_to_client_at between d_from and d_to + 1 and i.submitted_at is not null
                 and i.submitted_to_client_at > i.submitted_at) j),
    'work_hours_per_day', round(app.working_minutes_per_day() / 60.0, 2),
    'sales_activity', (select coalesce(jsonb_agg(x), '[]') from (
        select p.id, p.full_name, p.avatar_path,
               (select count(*) from public.visits v where v.sales_person_id = p.id and (v.checkin_at at time zone tz)::date between d_from and d_to) as visits,
               (select count(*) from public.visits v where v.sales_person_id = p.id and v.unplanned and (v.checkin_at at time zone tz)::date between d_from and d_to) as unplanned,
               (select round(100.0 * count(*) filter (where gps_verified) / nullif(count(*) filter (where gps_verified is not null), 0), 1)
                  from public.visits v where v.sales_person_id = p.id and (v.checkin_at at time zone tz)::date between d_from and d_to) as gps_pct,
               (select count(*) from public.visit_plans vp where vp.sales_person_id = p.id and vp.week_start between d_from - 7 and d_to and not vp.is_late and vp.submitted_at is not null) as plans_on_time,
               (select count(*) from public.inquiries i where i.sales_person_id = p.id and i.submitted_at::date between d_from and d_to) as inquiries,
               (select count(*) from public.notifications n where n.kind = 'duplicate_visit' and n.body like p.full_name || '%' and n.created_at::date between d_from and d_to) as duplicate_alerts
        from public.profiles p where p.role in ('asm_building', 'asm_infra') and p.active) x),
    'visits_by_type_category', (select coalesce(jsonb_agg(x), '[]') from (
        select project_type, visit_category, count(*) as n from public.visits
        where (checkin_at at time zone tz)::date between d_from and d_to group by 1, 2) x),
    'pipeline', (select coalesce(jsonb_agg(x), '[]') from (
        select project_type,
               count(*) filter (where status in ('active')) as active_projects,
               round(sum(app.to_lkr(lighting_value, currency)) filter (where status = 'active')) as lighting_value_lkr,
               round(sum(app.to_lkr(lighting_value, currency) * win_probability / 100.0) filter (where status = 'active')) as weighted_lkr,
               round(sum(app.to_lkr(lighting_value, currency)) filter (where status in ('dormant', 'on_hold'))) as dormant_on_hold_lkr,
               round(sum(lighting_value) filter (where status = 'active' and currency = 'USD')) as active_usd,
               round(sum(lighting_value) filter (where status = 'active' and currency = 'LKR')) as active_lkr
        from public.projects where merged_into is null group by 1) x),
    'funnel', (select jsonb_build_object(
        'received', count(*) filter (where submitted_at::date between d_from and d_to),
        'in_design', count(*) filter (where status in ('accepted', 'in_design', 'design_review', 'design_approved') and route <> 'B'),
        'in_estimation', count(*) filter (where status in ('in_estimation', 'estimation_review')),
        'quoted', count(*) filter (where quotation_released_at::date between d_from and d_to),
        'won', count(*) filter (where status = 'won' and order_date between d_from and d_to),
        'lost', count(*) filter (where status = 'lost' and updated_at::date between d_from and d_to),
        'won_value_lkr', round(sum(app.to_lkr(order_value, currency)) filter (where status = 'won' and order_date between d_from and d_to)),
        'lost_reasons', (select coalesce(jsonb_object_agg(coalesce(lost_reason, '-'), n), '{}') from (
             select lost_reason, count(*) n from public.inquiries where status = 'lost' group by 1) lr))
      from public.inquiries),
    'workload', case when sales_only then null else (select coalesce(jsonb_agg(x), '[]') from (
        select p.id, p.full_name, p.role, p.avatar_path,
               count(c.id) filter (where c.stage in ('design', 'estimation')) as open_jobs,
               count(c.id) filter (where c.colour = 'red') as overdue,
               jsonb_object_agg(coalesce(to_char(c.due_at at time zone tz, 'IYYY-IW'), 'none'), 1) filter (where c.id is not null) as weeks
        from public.profiles p left join public.sla_clocks c on c.owner_id = p.id and c.stopped_at is null
        where p.role in ('lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec') and p.active
        group by p.id) x) end,
    'top_overdue', (select coalesce(jsonb_agg(x), '[]') from (
        select c.id, c.label, c.inquiry_id, i.code, i.project_name, app.display_name(c.owner_id) as owner, c.owner_team,
               round(app.work_minutes_between(c.due_at, now()) / app.working_minutes_per_day(), 1) as days_overdue, c.level, c.delay_reason
        from public.sla_clocks c left join public.inquiries i on i.id = c.inquiry_id
        where c.stopped_at is null and c.colour = 'red' order by c.due_at limit 10) x),
    'largest_open', (select coalesce(jsonb_agg(x), '[]') from (
        select i.id, i.code, i.project_name, i.customer_name, i.status, p.lighting_value, p.currency
        from public.inquiries i join public.projects p on p.id = i.project_id
        where i.status not in ('won', 'lost', 'cancelled', 'rejected', 'draft')
        order by app.to_lkr(p.lighting_value, p.currency) desc nulls last limit 10) x),
    'oldest_on_hold', (select coalesce(jsonb_agg(x), '[]') from (
        select c.inquiry_id, i.code, c.label, c.hold_reason, (today - (c.paused_at at time zone tz)::date) as days
        from public.sla_clocks c join public.inquiries i on i.id = c.inquiry_id
        where c.stopped_at is null and c.paused_at is not null order by c.paused_at limit 10) x),
    'debtors', (select jsonb_build_object(
        'by_bucket', (select coalesce(jsonb_agg(b order by b.bucket), '[]') from (
            select ageing_bucket as bucket, count(*) as n,
                   coalesce(sum(amount) filter (where currency = 'LKR'), 0) as lkr, coalesce(sum(amount) filter (where currency = 'USD'), 0) as usd
            from public.debts where status not in ('collected_confirmed', 'cleared') group by 1) b),
        'legal', (select count(*) from public.debts where is_legal),
        'non_moving', (select count(*) from public.debts where not is_legal and status not in ('collected', 'collected_confirmed', 'cleared', 'disputed')
                       and last_status_at < now() - interval '14 days' and last_amount_change_at < now() - interval '14 days'),
        'last_upload', (select max(as_at) from public.debt_uploads where status = 'confirmed')))
  );
end $$;

-- The cases of one stage that finished after their (agreed) due date in the period
create or replace function public.sla_stage_late(p_stage text, p_from date, p_to date)
returns table (inquiry_id uuid, code text, project text, owner text, due_at timestamptz, stopped_at timestamptz, used_hours numeric,
               target_hours numeric, delay_reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.has_role('gm', 'sm_projects'), 'Not allowed');
  return query
  select c.inquiry_id, i.code || case when i.revision > 0 then '-R' || i.revision else '' end, coalesce(i.project_name, i.inquiry_name, c.label),
         app.display_name(c.owner_id), coalesce(c.revised_due_at, c.due_at), c.stopped_at,
         round(greatest(app.work_minutes_between(c.started_at, c.stopped_at) - c.paused_minutes, 0) / 60, 1), round(c.target_minutes / 60, 1),
         coalesce(c.delay_reason, c.hold_reason)
    from public.sla_clocks c left join public.inquiries i on i.id = c.inquiry_id
   where c.stage = p_stage and c.stopped_at between p_from and p_to + 1
     and c.stopped_at > coalesce(c.revised_due_at, c.due_at) + interval '1 minute'
   order by c.stopped_at desc
   limit 50;
end $$;
revoke execute on function public.sla_stage_late(text, date, date) from public, anon;
grant execute on function public.sla_stage_late(text, date, date) to authenticated, service_role;
