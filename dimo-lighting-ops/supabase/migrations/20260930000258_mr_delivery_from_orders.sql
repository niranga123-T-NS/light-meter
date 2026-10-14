-- Material deliveries follow the orders: no separate delivery appointment. The day-before reminder and the late alerts
-- (SEE after 2 days, SM Projects after 4) run on the expected date – the local / import orders' (kept by Operations on the
-- order pages, with the reason for every change), or for the SAP route the date Operations gives when ordering in SAP and
-- moves on the request with a reason. Services are not delivered: their timing is their order's.

/** Operations: the expected delivery of a request ordered in SAP (no local / import order) – a change needs the reason */
create or replace function public.set_mr_expected(p_id uuid, p_date date, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; later boolean;
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive sets the expected date');
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(m.id is not null and m.status in ('ordered', 'part_received'), 'Only an ordered request');
  perform app.require(not exists (select 1 from public.lo_requests where mr_id = m.id and status <> 'cancelled')
                      and not exists (select 1 from public.fo_handovers where mr_id = m.id and status <> 'cancelled'),
    'This request follows its local / import order – change the expected date on the order');
  perform app.require(p_date is not null and p_date is distinct from m.expected_date, 'Choose the new date');
  later := m.expected_date is not null and p_date > m.expected_date;
  perform app.require(m.expected_date is null or coalesce(btrim(p_reason), '') <> '', 'Give the reason for the change');
  update public.material_requests set expected_date = p_date, reschedules = reschedules + case when later then 1 else 0 end, near_alerted_for = null where id = m.id;
  perform app.notify_many(array(select unnest(app.project_aes(m.exec_project_id)) union select unnest(app.role_users('senior_elec_engineer')) union select m.requested_by),
    'exec_material', case when later then 'Material delivery moved' else 'Material expected' end,
    concat_ws(' · ', app.mr_head(m), to_char(p_date, 'Dy DD Mon YYYY'), case when p_date > m.required_date then 'after the required date ' || to_char(m.required_date, 'DD Mon') end, nullif(btrim(p_reason), '')),
    'normal', 'material_request', m.id, '/execution/material/' || m.id);
  if later and m.delay_level >= 1 then
    perform app.notify_many(app.role_users('sm_projects'), 'exec_material', 'Material delivery delayed again',
      format('%s · now %s · %s', app.mr_head(m), to_char(p_date, 'DD Mon'), btrim(p_reason)), 'critical', 'material_request', m.id, '/execution/material/' || m.id);
  end if;
end $$;
grant execute on function public.set_mr_expected(uuid, date, text) to authenticated;

-- Ordered in SAP: the expected delivery date is given with it
create or replace function public.order_material_request(p_id uuid, p_po text, p_supplier text, p_expected date) returns void
language plpgsql security definer set search_path = public as $$
declare m public.material_requests;
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive places the order');
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(m.id is not null and m.status = 'approved', 'The request is not approved');
  perform app.require(p_expected is not null, 'Enter the expected delivery date');
  update public.material_requests set status = 'ordered', po_no = nullif(btrim(p_po), ''), supplier = nullif(btrim(p_supplier), ''), expected_date = p_expected,
    ordered_by = auth.uid(), ordered_at = now() where id = m.id;
  perform app.notify_many(app.project_aes(m.exec_project_id) || array[m.requested_by] || app.role_users('senior_elec_engineer'), 'exec_material', 'Material ordered',
    concat_ws(' · ', app.mr_head(m), 'SAP ' || nullif(btrim(p_po), ''), 'expected ' || to_char(p_expected, 'DD Mon'),
              case when p_expected > m.required_date then 'after the required date ' || to_char(m.required_date, 'DD Mon') end),
    'normal', 'material_request', m.id, '/execution/material/' || m.id);
end $$;

-- the delivery appointment is no longer set
revoke execute on function public.schedule_delivery(uuid, timestamptz, text) from authenticated;

create or replace function public.materials_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; m public.material_requests; r record; n int := 0; late int;
begin
  -- expected tomorrow (the order's expected date – the site gets ready to receive it); materials only
  for m in select * from public.material_requests where kind = 'material' and status in ('ordered', 'part_received') and expected_date = today + 1
             and near_alerted_for is distinct from ((expected_date::timestamp at time zone app.tz())) loop
    perform app.notify_many(array(select unnest(app.role_users('operations_exec')) union select unnest(app.role_users('senior_elec_engineer'))
                                  union select unnest(app.project_aes(m.exec_project_id)) union select m.requested_by), 'exec_material', 'Material expected tomorrow',
      concat_ws(' · ', app.mr_head(m), to_char(m.expected_date, 'Dy DD Mon'), nullif(m.supplier, ''), 'PO ' || nullif(m.po_no, '')), 'normal', 'material_request', m.id, '/execution/material/' || m.id);
    update public.material_requests set near_alerted_for = (m.expected_date::timestamp at time zone app.tz()) where id = m.id; n := n + 1;
  end loop;
  -- late: more than 2 days → the SEE; more than 4 days → SM Projects
  for m in select * from public.material_requests where kind = 'material' and status in ('approved', 'ordered', 'part_received') loop
    late := today - coalesce(m.expected_date, m.required_date);
    if late > 4 and m.delay_level < 2 then
      perform app.notify_many(app.role_users('sm_projects') || app.role_users('senior_elec_engineer'), 'exec_material', format('Material delivery %s days late', late),
        app.mr_head(m), 'critical', 'material_request', m.id, '/execution/material/' || m.id);
      update public.material_requests set delay_level = 2 where id = m.id; n := n + 1;
    elsif late > 2 and m.delay_level < 1 then
      perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_material', format('Material delivery %s days late', late),
        app.mr_head(m), 'critical', 'material_request', m.id, '/execution/material/' || m.id);
      update public.material_requests set delay_level = 1 where id = m.id; n := n + 1;
    end if;
  end loop;
  -- the same item ordered 3+ times in 14 days
  for r in select mr.exec_project_id, min(l.item) as item, count(distinct mr.id) as k from public.material_request_lines l join public.material_requests mr on mr.id = l.mr_id
            where mr.requested_at >= p_at - interval '14 days' and mr.status not in ('rejected', 'cancelled') group by mr.exec_project_id, lower(l.item) having count(distinct mr.id) >= 3 loop
    perform app.notify_many(array(select unnest(app.project_aes(r.exec_project_id)) union select unnest(app.role_users('senior_elec_engineer'))), 'material_warning',
      format('Frequent orders – %s', r.item), format('%s requests for %s in 14 days · %s', r.k, r.item, app.exec_head(r.exec_project_id)), 'normal', 'exec_project', r.exec_project_id,
      '/execution/' || r.exec_project_id || '?tab=materials', format('mr_freq:%s:%s:%s', r.exec_project_id, lower(r.item), to_char(today, 'IYYY-IW')));
    n := n + 1;
  end loop;
  -- excessive usage: today's use more than twice the daily average of the last 14 days
  for r in select t.exec_project_id, t.item, t.unit, t.used, a.avg_used from
             (select exec_project_id, min(item) as item, min(unit) as unit, lower(item) as k, sum(used_qty) as used from public.material_issues
               where day = today and used_qty is not null group by exec_project_id, lower(item)) t
             join lateral (select avg(d.u) as avg_used, count(*) as days from (select day, sum(used_qty) as u from public.material_issues
                            where exec_project_id = t.exec_project_id and lower(item) = t.k and day between today - 14 and today - 1 and used_qty is not null group by day) d) a on true
            where a.days >= 3 and t.used > 2 * a.avg_used loop
    perform app.notify_many(array(select unnest(app.project_aes(r.exec_project_id)) union select unnest(app.role_users('senior_elec_engineer'))), 'material_warning',
      format('Excessive material usage – %s', r.item), format('%s %s used today against %s a day on average · %s', r.used, r.unit, round(r.avg_used, 1), app.exec_head(r.exec_project_id)),
      'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=materials', format('mr_use:%s:%s:%s', r.exec_project_id, lower(r.item), today));
    n := n + 1;
  end loop;
  -- low stock (not ignored), once a day
  for r in select e.id as exec_project_id, b.* from public.exec_projects e cross join lateral public.store_balances_all(e.id) b where e.status = 'active' and b.low and not b.ignore_low loop
    perform app.notify_many(array(select unnest(app.project_aes(r.exec_project_id)) union select unnest(app.role_users('senior_elec_engineer'))), 'material_warning',
      format('Low stock – %s', r.item), format('%s %s left (%s) · %s', r.balance, r.unit, app.custody_label(r.custody), app.exec_head(r.exec_project_id)),
      'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=materials', format('mr_low:%s:%s:%s:%s', r.exec_project_id, lower(r.item), r.custody, today));
    n := n + 1;
  end loop;
  return n;
end $$;

select app.purge_guard_triggers();
select app.fix_function_owners();
