-- Scheduled reminders (8.4, 8.7, 12, 13), dashboards (9, 9.1), scorecard (9.2) and global search (Section 2).

create or replace function app.to_lkr(amount numeric, cur public.currency, at_date date default null) returns numeric
language sql stable security definer set search_path = public as $$
  select case when cur = 'LKR' or amount is null then amount else amount * coalesce(
    (select usd_to_lkr from public.exchange_rates where month <= coalesce(at_date, current_date) order by month desc limit 1),
    (select usd_to_lkr from public.exchange_rates order by month limit 1), 300) end
$$;

-- ---------------------------------------------------------------------------
-- reminders_tick(): runs every 15 minutes; each reminder fires once thanks to dedupe keys
-- ---------------------------------------------------------------------------
create or replace function public.reminders_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tz text := app.tz();
  loc timestamp := now() at time zone tz;
  today date := loc::date;
  t time := loc::time;
  dow int := extract(isodow from today)::int;
  next_week date := today + (8 - dow);   -- Monday of next week
  this_week date := today - (dow - 1);
  wd boolean := app.is_working_day(today);
  r record;
  u uuid;
  n int := 0;
begin
  -- Weekly plan reminders: Friday 16:00 and Saturday 10:00; late alert Saturday 13:00 (4.4)
  if (dow = 5 and t >= time '16:00') or (dow = 6 and t >= time '10:00') then
    for u in select id from public.profiles where role in ('asm_building', 'asm_infra') and active
             and not exists (select 1 from public.visit_plans p where p.sales_person_id = profiles.id and p.week_start = next_week
                             and p.status in ('submitted', 'approved')) loop
      perform app.notify(u, 'plan_reminder', 'Submit next week''s visit plan', 'Deadline Saturday 13:00',
        'normal', null, null, '/plan', format('planrem:%s:%s', next_week, dow));
      n := n + 1;
    end loop;
  end if;
  if dow = 6 and t >= time '13:00' then
    for u in select id from public.profiles where role in ('asm_building', 'asm_infra') and active
             and not exists (select 1 from public.visit_plans p where p.sales_person_id = profiles.id and p.week_start = next_week
                             and p.status in ('submitted', 'approved')) loop
      perform app.notify_many(app.role_users('sm_projects'), 'plan_late', 'Weekly plan not submitted',
        format('%s has not submitted the plan for the week of %s', app.display_name(u), to_char(next_week, 'DD Mon')),
        'normal', null, null, '/plan', format('planlate:%s:%s', next_week, u));
    end loop;
  end if;
  if dow = 1 and t >= time '09:00' then
    for r in select * from public.visit_plans where week_start = this_week and status = 'submitted' loop
      perform app.notify_many(app.role_users('sm_projects'), 'plan_awaiting', 'Plan awaiting approval',
        app.display_name(r.sales_person_id), 'normal', 'visit_plan', r.id, '/plan/' || r.id, format('planwait:%s', r.id), true);
    end loop;
  end if;

  -- Planned visit not checked in by end of day
  if wd and t >= app.work_end() then
    for r in select l.*, p.sales_person_id, o.name as org from public.visit_plan_lines l
             join public.visit_plans p on p.id = l.plan_id join public.organizations o on o.id = l.organization_id
             where l.planned_date = today and l.status = 'planned' loop
      perform app.notify(r.sales_person_id, 'visit_not_checked_in', 'Planned visit not checked in',
        format('%s (%s)', r.org, coalesce(r.time_slot, 'today')), 'normal', 'visit_plan', r.plan_id, '/plan/' || r.plan_id,
        format('nocheckin:%s', r.id));
    end loop;
  end if;

  -- Visit report / tender result not saved by 20:00; SM Projects next working day 09:00 (8.1, 4.8)
  if t >= time '20:00' then
    for r in select * from public.visits where status = 'open' and (checkin_at at time zone tz)::date = today loop
      perform app.notify(r.sales_person_id, 'visit_report_due',
        case when r.visit_type = 'tender' then 'Save the tender result' else 'Save today''s visit report' end,
        r.code, 'normal', 'visit', r.id, '/visits/' || r.id, format('visitrep:%s', r.id));
    end loop;
  end if;
  if wd and t >= time '09:00' then
    for r in select * from public.visits where status = 'open' and (checkin_at at time zone tz)::date < today loop
      perform app.notify_many(app.role_users('sm_projects'), 'visit_report_missing',
        case when r.visit_type = 'tender' then 'Tender result not recorded' else 'Visit report not saved' end,
        format('%s – %s', app.display_name(r.sales_person_id), r.code), 'normal', 'visit', r.id, '/visits/' || r.id,
        format('visitrepsm:%s', r.id));
    end loop;
  end if;

  -- Next action date reached (visits and tenders)
  if t >= time '08:30' then
    for r in select * from public.visits where next_action_date = today and next_action_done_at is null loop
      perform app.notify(r.sales_person_id, 'next_action', 'Next action due today', coalesce(r.next_action, r.code),
        'normal', 'visit', r.id, '/visits/' || r.id, format('nextact:%s:%s', r.id, today));
    end loop;
  end if;

  -- Dormant projects (4.10): no activity for 60 days → flag; not reviewed in 5 working days → SM Projects
  if t >= time '07:00' then
    for r in update public.projects set status = 'dormant', dormant_since = today
             where status = 'active' and last_activity_at < now() - make_interval(days => app.setting_num('dormant_days', 60)::int)
             returning * loop
      perform app.notify(r.owner_id, 'project_dormant', 'Project marked dormant – review it',
        format('%s: confirm active, put on hold, or close within 5 working days', r.name), 'normal', 'project', r.id, '/projects/' || r.id,
        format('dormant:%s:%s', r.id, today));
    end loop;
    for r in select * from public.projects where status = 'dormant'
             and app.add_work_minutes((dormant_since + app.work_start()) at time zone tz, 5 * app.working_minutes_per_day()) < now() loop
      perform app.notify_many(app.role_users('sm_projects'), 'project_dormant_unreviewed', 'Dormant project not reviewed',
        format('%s – %s', r.name, app.display_name(r.owner_id)), 'normal', 'project', r.id, '/projects/' || r.id,
        format('dormantsm:%s:%s', r.id, r.dormant_since));
    end loop;
    for r in select * from public.projects where status = 'on_hold' and on_hold_review_date <= today loop
      perform app.notify(r.owner_id, 'project_hold_review', 'On-hold project due for review', r.name,
        'normal', 'project', r.id, '/projects/' || r.id, format('holdrev:%s:%s', r.id, r.on_hold_review_date));
    end loop;
  end if;

  -- Quotation validity: 7 days before expiry with no result (7.4)
  for r in select q.*, i.sales_person_id, i.code as inq_code, i.project_name from public.quotations q join public.inquiries i on i.id = q.inquiry_id
           where q.result is null and not q.validity_warning_sent and q.validity_date <= today + 7 loop
    perform app.notify(r.sales_person_id, 'quotation_expiring', 'Quotation validity ends in 7 days',
      format('%s-R%s – %s. Valid until %s', r.quotation_no, r.revision, r.project_name, to_char(r.validity_date, 'DD Mon')),
      'normal', 'inquiry', r.inquiry_id, '/inquiries/' || r.inquiry_id);
    update public.quotations set validity_warning_sent = true where id = r.id;
  end loop;

  -- Quotation follow-up every 7 days after submission; client approval follow-up every 5 working days
  if wd and t >= time '09:00' then
    for r in select * from public.inquiries where status = 'submitted_to_client' and submitted_to_client_at is not null
             and (today - (submitted_to_client_at at time zone tz)::date) > 0
             and (today - (submitted_to_client_at at time zone tz)::date) % 7 = 0 loop
      perform app.notify(r.sales_person_id, 'quotation_follow_up', 'Follow up the quotation', format('%s – %s', r.code, r.project_name),
        'normal', 'inquiry', r.id, '/inquiries/' || r.id, format('qfu:%s:%s', r.id, today));
    end loop;
    for r in select * from public.inquiries where status = 'awaiting_client_approval' and submitted_to_client_at is not null
             and floor(app.work_minutes_between(submitted_to_client_at, now()) / app.working_minutes_per_day())::int % 5 = 0
             and app.work_minutes_between(submitted_to_client_at, now()) >= app.working_minutes_per_day() loop
      perform app.notify(r.sales_person_id, 'client_approval_follow_up', 'Follow up the client''s design approval',
        format('%s – %s', r.code, r.project_name), 'normal', 'inquiry', r.id, '/inquiries/' || r.id, format('cafu:%s:%s', r.id, today));
    end loop;
  end if;

  -- Debt reminders every other day at 09:00, one per open debt (12.5)
  if t >= time '09:00' then
    for r in select * from public.debts
             where status in ('outstanding', 'follow_up', 'partially_collected')
                or (status = 'payment_promised' and promised_date < today) loop
      continue when r.is_legal or coalesce(r.last_reminder_on, date '1900-01-01') > today - 2;
      perform app.notify(r.sales_person_id, 'debt_reminder', format('%s · %s', r.client_name, r.invoice_no),
        format('%s – %s · %s · %s days', r.client_name, r.project_name, app.fmt_money(r.amount, r.currency), r.outstanding_days),
        'normal', 'debt', r.id, '/debtors/' || r.id, format('debtrem:%s:%s', r.id, today));
      update public.debts set last_reminder_on = today where id = r.id;
    end loop;
    -- Non-moving debt: no status update and no reduction for 14 days → SM Projects, GM (weekly)
    for r in select * from public.debts where not is_legal and status not in ('collected', 'collected_confirmed', 'cleared', 'disputed')
             and last_status_at < now() - make_interval(days => app.setting_num('non_moving_days', 14)::int)
             and last_amount_change_at < now() - make_interval(days => app.setting_num('non_moving_days', 14)::int)
             and coalesce(non_moving_alerted_on, date '1900-01-01') <= today - 7 loop
      perform app.notify_many(app.role_users('sm_projects') || app.role_users('gm'), 'debt_non_moving', 'Non-moving debt',
        format('%s · %s · %s · %s days · %s', r.client_name, r.invoice_no, app.fmt_money(r.amount, r.currency), r.outstanding_days,
               app.display_name(r.sales_person_id)), 'normal', 'debt', r.id, '/debtors/' || r.id, format('debtnm:%s:%s', r.id, today));
      update public.debts set non_moving_alerted_on = today where id = r.id;
    end loop;
    -- Legal hearing in 2 days (Critical); outcome prompts after the hearing (12.8)
    for r in select * from public.debts where is_legal and next_hearing_date = today + 2
             and hearing_alerted_for is distinct from next_hearing_date loop
      perform app.notify_many(app.role_users('gm') || app.role_users('sm_projects') || app.role_users('operations_exec'),
        'legal_hearing', 'Legal hearing in 2 days',
        format('%s – %s · %s · %s · %s days · hearing %s. %s', r.client_name, r.project_name, r.invoice_no,
               app.fmt_money(r.amount, r.currency), r.outstanding_days, to_char(r.next_hearing_date, 'DD Mon'), r.legal_description),
        'critical', 'debt', r.id, '/debtors/' || r.id, format('hearing:%s:%s', r.id, r.next_hearing_date));
      update public.debts set hearing_alerted_for = next_hearing_date where id = r.id;
    end loop;
    for r in select * from public.debts where is_legal and next_hearing_date = today - 1 loop
      perform app.notify_many(app.role_users('operations_exec'), 'legal_outcome_due', 'Enter the hearing outcome',
        format('%s · %s', r.client_name, r.invoice_no), 'normal', 'debt', r.id, '/debtors/' || r.id, format('outcome:%s:%s', r.id, r.next_hearing_date));
    end loop;
    for r in select * from public.debts where is_legal and next_hearing_date < today
             and app.work_minutes_between((next_hearing_date + 1 + app.work_start()) at time zone tz, now()) >= 2 * app.working_minutes_per_day() loop
      perform app.notify_many(app.role_users('sm_projects') || app.role_users('gm'), 'legal_outcome_missing', 'Legal outcome not updated',
        format('%s · %s · hearing %s', r.client_name, r.invoice_no, to_char(r.next_hearing_date, 'DD Mon')),
        'normal', 'debt', r.id, '/debtors/' || r.id, format('outcomemiss:%s:%s', r.id, r.next_hearing_date));
    end loop;
  end if;

  -- Debtors upload reminder Saturday 16:00; missed by Saturday 22:00 → SM Projects and GM on Monday 09:00 (12.2)
  if dow = 6 and t >= time '16:00' and not exists (select 1 from public.debt_uploads where status = 'confirmed' and as_at >= today - 1) then
    perform app.notify_many(app.role_users('operations_exec'), 'debtors_upload_reminder', 'Upload this week''s debtors list',
      'Due Saturday evening', 'normal', null, null, '/debtors/upload', format('debtup:%s', today));
  end if;
  if dow = 1 and t >= time '09:00' and not exists (select 1 from public.debt_uploads where status = 'confirmed'
                                                   and confirmed_at <= ((today - 2) + time '22:00') at time zone tz
                                                   and confirmed_at >= ((today - 3)) at time zone tz) then
    perform app.notify_many(app.role_users('sm_projects') || app.role_users('gm'), 'debtors_upload_missed', 'Debtors list not uploaded',
      'The Saturday debtors upload was missed', 'normal', null, null, '/debtors', format('debtupmiss:%s', today));
  end if;

  -- Samples overdue: every other working day to sales; SM Projects at 7 days (13.3)
  if wd and t >= time '09:00' then
    for r in select * from public.samples where status = 'out' and expected_return_date < today loop
      if coalesce(r.last_overdue_notice, date '1900-01-01') <= today - 2 then
        perform app.notify(r.sales_person_id, 'sample_overdue', 'Sample overdue for return',
          format('%s – %s · due %s', r.code, r.client_name, to_char(r.expected_return_date, 'DD Mon')),
          'normal', 'sample', r.id, '/samples/' || r.id, format('smpod:%s:%s', r.id, today));
        update public.samples set last_overdue_notice = today where id = r.id;
      end if;
      if not r.sm_overdue_alerted and r.expected_return_date <= today - app.setting_num('sample_sm_overdue_days', 7)::int then
        perform app.notify_many(app.role_users('sm_projects'), 'sample_overdue', 'Sample 7 days overdue',
          format('%s – %s (%s) · %s', r.code, r.client_name, app.display_name(r.sales_person_id), app.fmt_money(r.total_value, r.currency)),
          'normal', 'sample', r.id, '/samples/' || r.id);
        update public.samples set sm_overdue_alerted = true where id = r.id;
      end if;
    end loop;
  end if;

  -- Daily 08:30 digest per user: due today and overdue (8.4)
  if wd and t >= time '08:30' then
    for r in select owner_id, count(*) filter (where (due_at at time zone tz)::date = today) as due_today,
                    count(*) filter (where due_at < now()) as overdue
             from public.sla_clocks where stopped_at is null and owner_id is not null group by owner_id loop
      continue when r.due_today = 0 and r.overdue = 0;
      perform app.notify(r.owner_id, 'daily_digest', 'Your day', format('%s due today · %s overdue', r.due_today, r.overdue),
        'normal', null, null, '/', format('digest:%s', today));
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'plan_reminders', n);
end $$;
revoke execute on function public.reminders_tick() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- My Day (sales app home, Section 9)
-- ---------------------------------------------------------------------------
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
        'lkr', coalesce(sum(amount) filter (where currency = 'LKR'), 0), 'usd', coalesce(sum(amount) filter (where currency = 'USD'), 0))
      from public.debts where sales_person_id = me and status not in ('collected_confirmed', 'cleared')),
    'samples_overdue', (select count(*) from public.samples where sales_person_id = me and status = 'out' and expected_return_date < today)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Overall Dashboard (GM / DGM) and Sales Management (SM Projects) – Section 9.1
-- ---------------------------------------------------------------------------
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
               round(avg(app.work_minutes_between(started_at, stopped_at) - paused_minutes) / 60, 1) as avg_hours,
               round((percentile_cont(0.9) within group (order by app.work_minutes_between(started_at, stopped_at) - paused_minutes) / 60)::numeric, 1) as p90_hours
        from public.sla_clocks where stopped_at between d_from and d_to + 1 group by stage order by 3 desc) x),
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

-- ---------------------------------------------------------------------------
-- Salesperson KPI targets and monthly scorecard (9.2)
-- ---------------------------------------------------------------------------
create table public.kpi_targets (
  user_id uuid not null references public.profiles (id),
  month date not null check (extract(day from month) = 1),
  targets jsonb not null default '{}'::jsonb,   -- {"visits_per_week":13,"order_intake_lkr":20000000,...}
  weights jsonb not null default '{"order_intake":40,"pipeline":20,"activity":15,"win_margin":15,"coverage":10}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved')),
  approved_by uuid references public.profiles (id),
  primary key (user_id, month)
);
alter table public.kpi_targets enable row level security;
create policy kpi_targets_read on public.kpi_targets for select to authenticated
  using (user_id = auth.uid() or app.has_role('gm', 'sm_projects'));
create policy kpi_targets_write on public.kpi_targets for all to authenticated
  using (app.has_role('gm', 'sm_projects')) with check (app.has_role('gm', 'sm_projects'));

create table public.scorecard_reviews (
  user_id uuid not null references public.profiles (id),
  month date not null,
  comment text,
  agreed_actions text,
  reviewed_by uuid references public.profiles (id),
  acknowledged_at timestamptz,
  locked_at timestamptz,
  primary key (user_id, month)
);
alter table public.scorecard_reviews enable row level security;
create policy scorecard_reviews_read on public.scorecard_reviews for select to authenticated
  using (user_id = auth.uid() or app.has_role('gm', 'sm_projects'));
create policy scorecard_reviews_write on public.scorecard_reviews for all to authenticated
  using (app.has_role('gm', 'sm_projects') or user_id = auth.uid())
  with check (app.has_role('gm', 'sm_projects') or user_id = auth.uid());

create or replace function public.salesperson_scorecard(p_user uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := app.tz();
  m_start date := date_trunc('month', p_month)::date;
  m_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  weeks numeric := greatest((m_end - m_start + 1) / 7.0, 1);
  tg jsonb;
  w jsonb;
  k jsonb;
  s_order numeric; s_pipe numeric; s_act numeric; s_win numeric; s_cov numeric;
  cap numeric := 1.2;
begin
  if not (p_user = auth.uid() or app.has_role('gm', 'sm_projects')) then raise exception 'Not allowed'; end if;
  select targets, weights into tg, w from public.kpi_targets where user_id = p_user and month = m_start;
  tg := coalesce(tg, '{}'); w := coalesce(w, '{"order_intake":40,"pipeline":20,"activity":15,"win_margin":15,"coverage":10}');

  with v as (select * from public.visits where sales_person_id = p_user and (checkin_at at time zone tz)::date between m_start and m_end),
       i as (select * from public.inquiries where sales_person_id = p_user),
       lines as (select l.* from public.visit_plan_lines l join public.visit_plans p on p.id = l.plan_id
                 where p.sales_person_id = p_user and l.planned_date between m_start and m_end and not l.added_after_approval)
  select jsonb_build_object(
    'visits_per_week', round((select count(*) from v) / weeks, 1),
    'plans_on_time_pct', (select round(100.0 * count(*) filter (where not is_late and submitted_at is not null) / nullif(count(*), 0), 1)
                          from public.visit_plans where sales_person_id = p_user and week_start between m_start and m_end),
    'plan_completion_pct', (select round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*), 0), 1) from lines),
    'unplanned_share_pct', (select round(100.0 * count(*) filter (where unplanned) / nullif(count(*), 0), 1) from v),
    'gps_verified_pct', (select round(100.0 * count(*) filter (where gps_verified) / nullif(count(*) filter (where gps_verified is not null), 0), 1) from v),
    'same_day_reports_pct', (select round(100.0 * count(*) filter (where closed_at is not null and (closed_at at time zone tz)::date = (checkin_at at time zone tz)::date
                                                                  and (closed_at at time zone tz)::time <= time '20:00') / nullif(count(*), 0), 1) from v),
    'next_actions_on_time_pct', (select round(100.0 * count(*) filter (where next_action_done_at is not null and (next_action_done_at at time zone tz)::date <= next_action_date)
                                              / nullif(count(*), 0), 1) from public.visits where sales_person_id = p_user and next_action_date between m_start and m_end),
    'consultant_share_pct', (select round(100.0 * count(*) filter (where visit_category in ('Architect', 'Electrical Consultant', 'MEP Consultant', 'Interior Designer'))
                                          / nullif(count(*), 0), 1) from v),
    'new_organizations', (select count(*) from public.organizations where created_by = p_user and created_at::date between m_start and m_end),
    'new_projects', (select count(*) from public.projects where created_by = p_user and created_at::date between m_start and m_end),
    'inquiries_raised', (select count(*) from i where submitted_at::date between m_start and m_end),
    'visit_to_inquiry_pct', (select round(100.0 * (select count(*) from i where submitted_at::date between m_start and m_end) / nullif(count(*), 0), 1) from v),
    'pipeline_lkr', (select round(sum(app.to_lkr(lighting_value, currency))) from public.projects where owner_id = p_user and status = 'active'),
    'weighted_pipeline_lkr', (select round(sum(app.to_lkr(lighting_value, currency) * win_probability / 100.0)) from public.projects where owner_id = p_user and status = 'active'),
    'specification_wins', (select count(*) from public.projects where owner_id = p_user and spec_status = 'our_brand'),
    'returned_inquiries_pct', (select round(100.0 * count(*) filter (where exists (select 1 from public.status_history h where h.entity_id = i.id and h.to_status = 'returned_for_info'))
                                             / nullif(count(*), 0), 1) from i where submitted_at::date between m_start and m_end),
    'quotations_submitted', (select count(*) from i where submitted_to_client_at::date between m_start and m_end),
    'win_rate_count_pct', (select round(100.0 * count(*) filter (where status = 'won') / nullif(count(*) filter (where status in ('won', 'lost')), 0), 1) from i
                           where updated_at::date between m_start - 90 and m_end),
    'win_rate_value_pct', (select round(100.0 * sum(app.to_lkr(order_value, currency)) filter (where status = 'won')
                                        / nullif(sum(app.to_lkr(coalesce(order_value, (select max(quoted_value) from public.quotations q where q.inquiry_id = i.id)), currency))
                                                 filter (where status in ('won', 'lost')), 0), 1) from i where updated_at::date between m_start - 90 and m_end),
    'order_intake_lkr', (select round(coalesce(sum(app.to_lkr(order_value, currency, order_date)), 0)) from i where status = 'won' and order_date between m_start and m_end),
    'avg_margin_won_pct', (select round(avg(c.margin_pct), 1) from i join public.estimation_jobs e on e.inquiry_id = i.id and e.status = 'released'
                           join public.estimation_costing c on c.estimation_job_id = e.id where i.status = 'won' and i.order_date between m_start and m_end),
    'submission_speed_pct', (select round(100.0 * count(*) filter (where app.work_minutes_between(quotation_released_at, submitted_to_client_at) <= app.working_minutes_per_day())
                                          / nullif(count(*), 0), 1) from i where quotation_released_at::date between m_start and m_end and submitted_to_client_at is not null)
  ) into k;

  -- Area scores: actual ÷ target capped at 120%
  s_order := least(coalesce((k ->> 'order_intake_lkr')::numeric / nullif((tg ->> 'order_intake_lkr')::numeric, 0), 0), cap);
  s_pipe := least(coalesce(((k ->> 'weighted_pipeline_lkr')::numeric / nullif((tg ->> 'weighted_pipeline_lkr')::numeric, 0)
                 + (k ->> 'specification_wins')::numeric / nullif((tg ->> 'specification_wins')::numeric, 0)) / 2, 0), cap);
  s_act := least(coalesce(((k ->> 'visits_per_week')::numeric / nullif(coalesce((tg ->> 'visits_per_week')::numeric, 13), 0)
                 + coalesce((k ->> 'plan_completion_pct')::numeric, 0) / 80
                 + coalesce((k ->> 'gps_verified_pct')::numeric, 0) / 95) / 3, 0), cap);
  s_win := least(coalesce((coalesce((k ->> 'win_rate_value_pct')::numeric, 0) / 30
                 + coalesce((k ->> 'avg_margin_won_pct')::numeric / nullif((tg ->> 'margin_floor_pct')::numeric, 0), 1)) / 2, 0), cap);
  s_cov := least(coalesce((coalesce((k ->> 'consultant_share_pct')::numeric, 0) / 35
                 + coalesce((k ->> 'submission_speed_pct')::numeric, 0) / 95
                 + (100 - coalesce((k ->> 'returned_inquiries_pct')::numeric, 0)) / 90) / 3, 0), cap);

  return jsonb_build_object(
    'month', m_start, 'kpis', k, 'targets', tg, 'weights', w,
    'area_scores', jsonb_build_object('order_intake', round(s_order * 100, 1), 'pipeline', round(s_pipe * 100, 1),
      'activity', round(s_act * 100, 1), 'win_margin', round(s_win * 100, 1), 'coverage', round(s_cov * 100, 1)),
    'score', round(s_order * (w ->> 'order_intake')::numeric + s_pipe * (w ->> 'pipeline')::numeric + s_act * (w ->> 'activity')::numeric
                   + s_win * (w ->> 'win_margin')::numeric + s_cov * (w ->> 'coverage')::numeric, 1),
    'review', (select to_jsonb(r) from public.scorecard_reviews r where r.user_id = p_user and r.month = m_start));
end $$;

-- ---------------------------------------------------------------------------
-- Global search (Section 2): only records inside the caller's scope ever appear
-- ---------------------------------------------------------------------------
create or replace function public.global_search(p_query text)
returns table (kind text, id uuid, title text, subtitle text, url text)
language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || trim(p_query) || '%';
begin
  if length(trim(coalesce(p_query, ''))) < 2 then return; end if;
  return query
  (select 'customer', o.id, o.name, o.visit_category, '/customers/' || o.id from public.organizations o
    where o.merged_into is null and o.name ilike q
      and app.has_role('gm', 'sm_projects', 'asm_building', 'asm_infra', 'sm_estimation') limit 8)
  union all
  (select 'unit', u.id, u.name, o.name, '/customers/' || o.id from public.org_units u join public.organizations o on o.id = u.organization_id
    where u.name ilike q and app.has_role('gm', 'sm_projects', 'asm_building', 'asm_infra', 'sm_estimation') limit 5)
  union all
  (select 'contact', c.id, c.name, coalesce(c.designation, '') || ' · ' || o.name, '/customers/' || o.id
    from public.contacts c join public.organizations o on o.id = c.organization_id
    where (c.name ilike q or c.phone ilike q or c.email ilike q)
      and app.has_role('gm', 'sm_projects', 'asm_building', 'asm_infra', 'sm_estimation') limit 5)
  union all
  (select 'project', p.id, p.name, p.code || ' · ' || p.stage, '/projects/' || p.id from public.projects p
    where (p.name ilike q or p.code ilike q or p.city ilike q) and app.can_read_project(p.id) limit 8)
  union all
  (select 'inquiry', i.id, i.code, i.project_name || ' · ' || replace(i.status, '_', ' '), '/inquiries/' || i.id from public.inquiries i
    where (i.code ilike q or i.project_name ilike q or i.customer_name ilike q) and app.can_read_inquiry(i.id) limit 8)
  union all
  (select 'quotation', q2.inquiry_id, q2.full_no, i.project_name, '/inquiries/' || i.id from public.quotations q2 join public.inquiries i on i.id = q2.inquiry_id
    where q2.full_no ilike q and app.can_read_inquiry(i.id) and not app.has_role('design_manager', 'lighting_designer', 'lighting_engineer') limit 5)
  union all
  (select 'tender', t.id, t.tender_no || ' – ' || t.tender_name, 'Tender', '/visits/' || t.visit_id from public.tenders t
    where (t.tender_no ilike q or t.tender_name ilike q)
      and (t.sales_person_id = auth.uid() or app.has_role('gm', 'sm_projects', 'sm_estimation')) limit 5)
  union all
  (select 'invoice', d.id, d.invoice_no, d.client_name || ' · ' || app.fmt_money(d.amount, d.currency), '/debtors/' || d.id from public.debts d
    where d.invoice_no ilike q and (d.sales_person_id = auth.uid() or app.has_role('gm', 'sm_projects', 'operations_exec')) limit 5);
end $$;

-- Design / Estimation team performance (9.6)
create or replace function public.team_performance(p_team text, p_from date, p_to date)
returns table (user_id uuid, full_name text, jobs_completed bigint, on_time_pct numeric, avg_working_days numeric,
               overdue_open bigint, review_cycles numeric, hours_logged numeric, open_jobs bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_team = 'design' then
    if not app.has_role('gm', 'design_manager', 'lighting_designer', 'lighting_engineer') then return; end if;
    return query
    select p.id, p.full_name,
      count(d.id) filter (where d.approved_at::date between p_from and p_to),
      round(100.0 * count(d.id) filter (where d.approved_at::date between p_from and p_to and d.submitted_at <= d.due_at)
            / nullif(count(d.id) filter (where d.approved_at::date between p_from and p_to), 0), 1),
      round(avg(app.work_minutes_between(d.assigned_at, d.approved_at) / app.working_minutes_per_day()) filter (where d.approved_at::date between p_from and p_to), 1),
      count(d.id) filter (where d.status not in ('approved', 'released') and d.due_at < now()),
      round(avg(d.review_cycles) filter (where d.approved_at::date between p_from and p_to), 2),
      coalesce((select sum(h.hours) from public.design_hours h where h.user_id = p.id and h.work_date between p_from and p_to), 0),
      count(d.id) filter (where d.status not in ('approved', 'released'))
    from public.profiles p left join public.design_jobs d on d.assignee_id = p.id
    where p.role in ('lighting_designer', 'lighting_engineer') and p.active
      and (app.has_role('gm', 'design_manager') or p.id = auth.uid())
    group by p.id, p.full_name;
  else
    if not app.has_role('gm', 'sm_estimation', 'am_estimation', 'estimation_exec') then return; end if;
    return query
    select p.id, p.full_name,
      count(e.id) filter (where e.released_at::date between p_from and p_to),
      round(100.0 * count(e.id) filter (where e.released_at::date between p_from and p_to and e.released_at <= e.due_at)
            / nullif(count(e.id) filter (where e.released_at::date between p_from and p_to), 0), 1),
      round(avg(app.work_minutes_between(e.assigned_at, e.released_at) / app.working_minutes_per_day()) filter (where e.released_at::date between p_from and p_to), 1),
      count(e.id) filter (where e.status not in ('released') and e.due_at < now()),
      round(avg((select count(*) from public.status_history h where h.entity_id = e.id and h.to_status = 'returned')), 2),
      0::numeric,
      count(e.id) filter (where e.status not in ('released'))
    from public.profiles p left join public.estimation_jobs e on e.assignee_id = p.id
    where p.role in ('am_estimation', 'estimation_exec') and p.active
      and (app.has_role('gm', 'sm_estimation') or p.id = auth.uid())
    group by p.id, p.full_name;
  end if;
end $$;
