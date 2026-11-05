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

create or replace function public.my_day() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tz text := app.tz();
  today date := (now() at time zone tz)::date;
  monday date := today - (extract(isodow from today)::int - 1);
begin
  return jsonb_build_object(
    'planned_today', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'plan_id', l.plan_id, 'time_slot', l.time_slot, 'organization', o.name, 'project', p.name,
        'objective', l.planned_objective, 'category', l.visit_category, 'status', l.status, 'visit_type', l.visit_type,
        'organization_id', l.organization_id, 'project_id', l.project_id, 'unit_id', l.unit_id, 'contact_id', l.contact_id)
        order by l.time_slot)
      from public.visit_plan_lines l join public.visit_plans vp on vp.id = l.plan_id
      join public.organizations o on o.id = l.organization_id left join public.projects p on p.id = l.project_id
      where vp.sales_person_id = me and l.planned_date = today and l.status in ('planned', 'completed')), '[]'),
    'next_actions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'code', v.code, 'next_action', v.next_action,
        'date', v.next_action_date, 'organization', o.name) order by v.next_action_date)
      from public.visits v join public.organizations o on o.id = v.organization_id
      where v.sales_person_id = me and v.next_action_date <= today + 1 and v.next_action_done_at is null), '[]'),
    'open_visits', (select count(*) from public.visits where sales_person_id = me and status = 'open'),
    'pending_design', (select count(*) from public.inquiries where sales_person_id = me
                       and status in ('submitted', 'accepted', 'in_design', 'design_review', 'design_approved') and route <> 'B'),
    'pending_estimation', (select count(*) from public.inquiries where sales_person_id = me and status in ('in_estimation', 'estimation_review')
                           or (sales_person_id = me and route = 'B' and status in ('submitted', 'accepted'))),
    'delayed', (select count(*) from public.inquiries where sales_person_id = me and sla_colour = 'red'),
    'awaiting_follow_up', (select count(*) from public.inquiries where sales_person_id = me
                           and status in ('quotation_released', 'returned_to_sales', 'submitted_to_client', 'awaiting_client_approval')),
    'dormant_projects', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'since', dormant_since))
      from public.projects where owner_id = me and status = 'dormant'), '[]'),
    'probability_review_due', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'probability', win_probability))
      from public.projects where owner_id = me and status = 'active' and last_probability_review_at < now() - interval '30 days'), '[]'),
    'first_visits_due', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'due', first_visit_due))
      from public.projects p where owner_id = me and first_visit_due is not null
        and not exists (select 1 from public.visits v where v.project_id = p.id)), '[]'),
    'plan_next_week', (select status from public.visit_plans where sales_person_id = me and week_start = monday + 7),
    'visits_this_week', (select count(*) from public.visits where sales_person_id = me and (checkin_at at time zone tz)::date >= monday),
    'debts', (select jsonb_build_object('count', count(*), 'over_90', count(*) filter (where outstanding_days > 90),
        'lkr', coalesce(sum(balance) filter (where currency = 'LKR'), 0), 'usd', coalesce(sum(balance) filter (where currency = 'USD'), 0))
      from public.debts where sales_person_id = me and status not in ('collected_confirmed', 'cleared')),
    'samples_overdue', (select count(*) from public.samples where sales_person_id = me and status = 'out' and expected_return_date < today)
  );
end $$;

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
                   coalesce(sum(balance) filter (where currency = 'LKR'), 0) as lkr, coalesce(sum(balance) filter (where currency = 'USD'), 0) as usd
            from public.debts where status not in ('collected_confirmed', 'cleared') group by 1) b),
        'legal', (select count(*) from public.debts where is_legal),
        'non_moving', (select count(*) from public.debts where not is_legal and status not in ('collected', 'collected_confirmed', 'cleared', 'disputed')
                       and last_status_at < now() - interval '14 days' and last_amount_change_at < now() - interval '14 days'),
        'last_upload', (select max(as_at) from public.debt_uploads where status = 'confirmed')))
  );
end $$;

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
      'lkr', (select coalesce(sum(balance) filter (where currency = 'LKR'), 0) from opn),
      'usd', (select coalesce(sum(balance) filter (where currency = 'USD'), 0) from opn),
      'legal_n', (select count(*) from opn where is_legal),
      'legal_lkr', (select coalesce(sum(balance) filter (where currency = 'LKR'), 0) from opn where is_legal),
      'legal_usd', (select coalesce(sum(balance) filter (where currency = 'USD'), 0) from opn where is_legal),
      'oldest_days', (select max(outstanding_days) from opn),
      'by_bucket', (select coalesce(jsonb_agg(b), '[]') from (
          select ageing_bucket as bucket, count(*) as n,
                 coalesce(sum(balance) filter (where currency = 'LKR'), 0) as lkr, coalesce(sum(balance) filter (where currency = 'USD'), 0) as usd
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

create or replace function public.submit_inquiry(p_inquiry uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  other_duty public.duty_status;
  receiver public.app_role;
  bad_debt record;
  has_units boolean;
  std_minutes numeric;
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm') or (i.variation_id is not null and app.has_role('senior_elec_engineer')),
    'Only the requesting sales person can submit');
  perform app.require(i.status in ('draft', 'returned_for_info'), 'Inquiry is already submitted');
  perform app.require(i.customer_deadline is not null, 'Customer deadline is required');
  perform app.require(coalesce(length(trim(i.scope_description)), 0) > 0 or app.has_attachment('inquiry', i.id, 'inquiry_doc'),
    'Attach at least one document or write the scope');
  perform app.require(i.route = 'C' or i.duty_status is not null, 'Duty status (Duty Free / Duty Paid) is required when estimation is in scope');
  perform app.require(i.route = 'B' or i.design_scope is not null, 'Select the design scope');
  perform app.require(i.design_required_by is null or i.design_required_by < i.customer_deadline, 'Design required-by date must be before the customer deadline');
  perform app.require(i.quotation_required_by is null or i.quotation_required_by < i.customer_deadline, 'Quotation required-by date must be before the customer deadline');
  select exists (select 1 from public.org_units where organization_id = i.organization_id) into has_units;
  perform app.require(not has_units or i.unit_id is not null, 'Select the unit / department for this customer');

  -- Mixed Duty Free / Duty Paid on one project needs SM Projects → GM approval (5.5)
  if i.duty_status is not null and not i.mixed_duty_approved then
    select duty_status into other_duty from public.inquiries
     where project_id = i.project_id and id <> i.id and duty_status is not null and duty_status <> i.duty_status
       and status not in ('draft', 'cancelled', 'rejected') limit 1;
    if other_duty is not null then
      if not exists (select 1 from public.approvals where kind = 'mixed_duty' and entity_id = i.id and status = 'pending') then
        perform app.create_approval('mixed_duty', 'inquiry', i.id, i.id, format('Mixed duty offer – %s', i.project_name),
          format('%s requested while the project already has a %s offer', i.duty_status, other_duty),
          array['sm_projects', 'gm']::public.app_role[]);
      end if;
      return jsonb_build_object('status', 'approval_required', 'message',
        'This project already has an offer with a different duty status. A mixed duty approval request was sent to SM Projects and GM / DGM.');
    end if;
  end if;

  perform set_config('app.workflow', '1', true);
  update public.inquiries set submitted_at = coalesce(submitted_at, now()) where id = i.id;
  perform app.set_inquiry_status(i.id, 'submitted', case when i.status = 'returned_for_info' then 'Resubmitted' end);
  update public.projects set last_activity_at = now() where id = i.project_id;

  -- Release mode: proposed by sales, confirmed by SM Projects (6.5)
  perform app.create_approval('release_mode', 'inquiry', i.id, i.id, format('Release mode – %s', i.code),
    format('Proposed mode %s (%s)', i.release_mode,
      case i.release_mode when 1 then 'design only' when 2 then 'estimation only' else 'design + estimation' end),
    array['sm_projects']::public.app_role[], jsonb_build_object('release_mode', i.release_mode));

  -- Debtor check (5.9): debts over 90 days or under Legal
  select count(*) as n, sum(balance) filter (where currency = 'LKR') as lkr, sum(balance) filter (where currency = 'USD') as usd
    into bad_debt from public.debts d
   where d.organization_id = i.organization_id and (i.unit_id is null or d.unit_id is null or d.unit_id = i.unit_id)
     and d.status not in ('collected_confirmed', 'cleared', 'collected') and (d.outstanding_days > 90 or d.is_legal);
  if bad_debt.n > 0 then
    update public.inquiries set debtor_flag = true, status_before_hold = 'submitted', hold_reason = 'Debtor check' where id = i.id;
    perform app.set_inquiry_status(i.id, 'on_hold', 'Debtor check');
    perform app.create_approval('debtor_check', 'inquiry', i.id, i.id, format('Debtor check – %s', i.customer_name),
      format('%s debts over 90 days or under Legal: LKR %s, USD %s', bad_debt.n, coalesce(bad_debt.lkr, 0), coalesce(bad_debt.usd, 0)),
      array['sm_projects']::public.app_role[]);
    return jsonb_build_object('status', 'debtor_hold', 'message',
      format('This client has %s overdue or legal debts. SM Projects has been asked to allow the inquiry.', bad_debt.n));
  end if;

  perform app.route_inquiry(i.id);

  -- Warn when design + estimation time left is less than the standard SLA (5.2)
  std_minutes := case i.route when 'A' then app.sla_target('design_medium') + app.sla_target('estimation_medium')
                              when 'B' then app.sla_target('estimation_medium') else app.sla_target('design_medium') end;
  if app.add_work_minutes(now(), std_minutes) > (i.customer_deadline + time '17:30') at time zone app.tz() then
    return jsonb_build_object('status', 'submitted', 'warning', 'Time to the customer deadline is shorter than the standard SLA.');
  end if;
  return jsonb_build_object('status', 'submitted');
end $$;
