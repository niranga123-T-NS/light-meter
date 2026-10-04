-- Approvals on a secured project are SM Projects only (GM / DGM no longer approve): the invoice schedule (and a schedule
-- saved by SM Projects is approved at once), invoice date changes, and variations. (Copied from 20260930000057 / 062.)


create or replace function public.save_invoice_schedule(p_secured uuid, p_data jsonb, p_lines jsonb, p_submit boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.secured_projects;
  approved boolean;
  manager boolean := app.has_role('sm_projects');
  x jsonb;
  i int := 0;
  keep uuid[] := '{}';
  lid uuid;
  total numeric := 0;
  m date;
begin
  select * into s from public.secured_projects where id = p_secured for update;
  perform app.require(s.id is not null, 'Secured project not found');
  perform app.require(app.can_edit_secured(s), 'Only the sales person, Operations or SM Projects edit the invoice schedule');
  perform app.require(s.status = 'open', 'The project is closed');
  approved := s.schedule_status = 'approved';
  perform app.require(not approved or app.is_finance_desk(),
    'The schedule is approved – move an invoice date with a reason, or ask SM Projects / Operations for a variation');
  if p_data ? 'business_line' then
    perform app.require(p_data ->> 'business_line' is null or app.norm_line(p_data ->> 'business_line') is not null, 'Choose the business line');
  end if;
  update public.secured_projects set
    business_line = case when p_data ? 'business_line' then app.norm_line(p_data ->> 'business_line') else business_line end,
    order_value = case when p_data ? 'order_value' then nullif(p_data ->> 'order_value', '')::numeric else order_value end,
    wbs = case when p_data ? 'wbs' then app.wbs_base(nullif(p_data ->> 'wbs', '')) else wbs end,
    po_no = case when p_data ? 'po_no' then nullif(btrim(p_data ->> 'po_no'), '') else po_no end,
    notes = case when p_data ? 'notes' then nullif(btrim(p_data ->> 'notes'), '') else notes end,
    updated_at = now()
   where id = s.id
  returning * into s;

  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    i := i + 1;
    begin m := app.month_of((x ->> 'month')::date); exception when others then m := null; end;
    perform app.require(nullif(x ->> 'amount', '')::numeric > 0, format('Invoice %s: enter the amount', i));
    lid := nullif(x ->> 'id', '')::uuid;
    if lid is not null and exists (select 1 from public.invoice_lines where id = lid and secured_id = s.id) then
      -- Once approved the months only move through move_invoice_line
      update public.invoice_lines set seq = i, kind = coalesce(nullif(x ->> 'kind', ''), kind), description = nullif(x ->> 'description', ''),
        trigger_note = nullif(x ->> 'trigger_note', ''), amount = (x ->> 'amount')::numeric,
        original_month = case when approved then original_month else coalesce(m, original_month) end,
        forecast_month = case when approved then forecast_month else coalesce(m, forecast_month) end
       where id = lid;
    else
      perform app.require(m is not null, format('Invoice %s: choose the month', i));
      insert into public.invoice_lines (secured_id, seq, kind, description, trigger_note, amount, original_month, forecast_month)
      values (s.id, i, coalesce(nullif(x ->> 'kind', ''), case when approved then 'variation' else 'other' end), nullif(x ->> 'description', ''),
        nullif(x ->> 'trigger_note', ''), (x ->> 'amount')::numeric, m, m)
      returning id into lid;
    end if;
    keep := keep || lid;
    total := total + (x ->> 'amount')::numeric;
  end loop;
  perform app.require(not exists (select 1 from public.invoice_lines l where l.secured_id = s.id and not (l.id = any (keep))
                                   and exists (select 1 from public.invoice_allocations a where a.line_id = l.id)),
    'An invoice that already has invoicing against it cannot be removed');
  delete from public.invoice_lines where secured_id = s.id and not (id = any (keep));

  if approved then
    -- Variation / scope change: the order value follows the schedule
    update public.secured_projects set order_value = billed_before + total where id = s.id;
    insert into public.secured_log (secured_id, action, note) values (s.id, 'schedule_changed',
      'Schedule changed · order value now ' || app.fmt_money(s.billed_before + total, 'LKR'));
  elsif p_submit then
    perform app.require(s.business_line is not null, 'Choose the business line');
    perform app.require(s.order_value is not null and s.order_value > 0, 'Enter the order value');
    perform app.require(i > 0, 'Add the invoices');
    perform app.require(abs(s.billed_before + total - s.order_value) <= 1,
      format('The invoices add up to %s – they must equal the order value %s', app.fmt_money(s.billed_before + total, 'LKR'),
        app.fmt_money(s.order_value, 'LKR')));
    if manager then
      update public.secured_projects set schedule_status = 'approved', submitted_at = now(), approved_at = now(), approved_by = auth.uid(),
        review_note = null where id = s.id;
      insert into public.secured_log (secured_id, action, note) values (s.id, 'approved', 'Schedule saved and approved');
    else
      update public.secured_projects set schedule_status = 'review', submitted_at = now(), review_alerted = false where id = s.id;
      insert into public.secured_log (secured_id, action, note) values (s.id, 'submitted', 'Invoice schedule sent to SM Projects');
      perform app.notify_many(app.role_users('sm_projects'), 'schedule_review', 'Invoice schedule to review',
        s.project_name || ' · ' || coalesce(app.display_name(s.sales_person_id), '—') || ' · ' || app.fmt_money(s.order_value, 'LKR'),
        'normal', 'secured_project', s.id, app.secured_url(s.id));
    end if;
  end if;
  perform app.reallocate(s.id);
end $$;

create or replace function public.review_invoice_schedule(p_secured uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.secured_projects;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects approves invoice schedules');
  select * into s from public.secured_projects where id = p_secured for update;
  perform app.require(s.schedule_status = 'review', 'Nothing to review');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason for returning it');
  if p_approve then
    update public.secured_projects set schedule_status = 'approved', approved_at = now(), approved_by = auth.uid(), review_note = p_note where id = s.id;
    update public.invoice_lines set original_month = forecast_month where secured_id = s.id;
    insert into public.secured_log (secured_id, action, note) values (s.id, 'approved', coalesce('Approved · ' || p_note, 'Approved'));
    perform app.notify(s.sales_person_id, 'schedule_review', 'Invoice schedule approved', s.project_name || coalesce(' · ' || p_note, ''),
      'normal', 'secured_project', s.id, app.secured_url(s.id));
  else
    update public.secured_projects set schedule_status = 'missing', review_note = p_note where id = s.id;
    insert into public.secured_log (secured_id, action, note) values (s.id, 'returned', 'Returned · ' || p_note);
    perform app.notify(s.sales_person_id, 'schedule_review', 'Invoice schedule returned', s.project_name || ' · ' || p_note,
      'normal', 'secured_project', s.id, app.secured_url(s.id));
  end if;
end $$;

create or replace function public.move_invoice_line(p_line uuid, p_month date, p_reason text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  l public.invoice_lines;
  s public.secured_projects;
  m date := app.month_of(p_month);
  this_month date := app.month_of((now() at time zone app.tz())::date);
  needs boolean;
  open_amt numeric;
begin
  select * into l from public.invoice_lines where id = p_line for update;
  perform app.require(l.id is not null, 'Invoice not found');
  select * into s from public.secured_projects where id = l.secured_id;
  perform app.require(app.can_edit_secured(s), 'Only the sales person, Operations or SM Projects move invoice dates');
  perform app.require(s.schedule_status = 'approved', 'The schedule is not approved yet – change the month in the schedule');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Choose the reason');
  perform app.require(m is not null and m <> l.forecast_month, 'Choose a different month');
  perform app.require(not exists (select 1 from public.invoice_line_changes where line_id = l.id and status = 'pending'),
    'A change for this invoice is waiting for SM Projects');
  select l.amount - coalesce(sum(amount), 0) into open_amt from public.invoice_allocations where line_id = l.id;
  perform app.require(open_amt > 0, 'This invoice is fully invoiced');
  needs := (l.forecast_month <= this_month or m > app.fy_end(app.fy_of(this_month))) and not app.has_role('sm_projects');
  if needs then
    insert into public.invoice_line_changes (line_id, from_month, to_month, reason, note, status)
    values (l.id, l.forecast_month, m, p_reason, p_note, 'pending');
    perform app.notify_many(app.role_users('sm_projects'), 'invoice_move', 'Invoice date change to approve',
      s.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · ' || to_char(l.forecast_month, 'Mon YYYY') || ' → ' ||
      to_char(m, 'Mon YYYY') || ' · ' || p_reason, 'normal', 'secured_project', s.id, app.secured_url(s.id));
    return 'pending';
  end if;
  insert into public.invoice_line_changes (line_id, from_month, to_month, reason, note, status, decided_by, decided_at)
  values (l.id, l.forecast_month, m, p_reason, p_note, case when app.has_role('sm_projects') then 'approved' else 'recorded' end,
    case when app.has_role('sm_projects') then auth.uid() end, case when app.has_role('sm_projects') then now() end);
  update public.invoice_lines set forecast_month = m, moves = moves + 1 where id = l.id;
  perform app.reallocate(s.id);
  return 'moved';
end $$;

create or replace function public.decide_invoice_move(p_change bigint, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.invoice_line_changes;
  l public.invoice_lines;
  s public.secured_projects;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects approves invoice date changes');
  select * into c from public.invoice_line_changes where id = p_change for update;
  perform app.require(c.status = 'pending', 'This change is already decided');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  select * into l from public.invoice_lines where id = c.line_id;
  select * into s from public.secured_projects where id = l.secured_id;
  update public.invoice_line_changes set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(),
    decided_at = now(), decision_note = p_note where id = c.id;
  if p_approve then
    update public.invoice_lines set forecast_month = c.to_month, moves = moves + 1 where id = l.id;
    perform app.reallocate(s.id);
  end if;
  perform app.notify(c.requested_by, 'invoice_move', case when p_approve then 'Invoice date change approved' else 'Invoice date change not approved' end,
    s.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · ' || to_char(c.from_month, 'Mon YYYY') || ' → ' ||
    to_char(c.to_month, 'Mon YYYY') || coalesce(' · ' || p_note, ''), 'normal', 'secured_project', s.id, app.secured_url(s.id));
end $$;

create or replace function public.request_variation(p_secured uuid, p_data jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  s public.secured_projects;
  amt numeric;
  m date;
  vid uuid;
  manager boolean := app.has_role('sm_projects');
begin
  select * into s from public.secured_projects where id = p_secured;
  perform app.require(s.id is not null, 'Secured project not found');
  perform app.require(app.can_edit_secured(s), 'Only the sales person, Operations or SM Projects raise variations');
  perform app.require(s.status = 'open', 'The project is closed');
  perform app.require(s.schedule_status = 'approved', 'The schedule is not approved yet – change the order value and invoices in the schedule');
  begin amt := round(nullif(p_data ->> 'amount', '')::numeric, 2); exception when others then amt := null; end;
  perform app.require(coalesce(amt, 0) <> 0, 'Enter the variation amount (minus for an omission)');
  perform app.require(coalesce(btrim(p_data ->> 'reason'), '') <> '', 'Give the reason');
  begin m := app.month_of(nullif(p_data ->> 'month', '')::date); exception when others then m := null; end;
  perform app.require(amt < 0 or m is not null, 'Choose the month it will be invoiced');
  perform app.require(not exists (select 1 from public.secured_variations where secured_id = s.id and status = 'pending'),
    'A variation is already waiting for SM Projects');
  insert into public.secured_variations (secured_id, vo_no, amount, month, reason, status, decided_by, decided_at)
  values (s.id, nullif(btrim(p_data ->> 'vo_no'), ''), amt, m, btrim(p_data ->> 'reason'),
    case when manager then 'approved' else 'pending' end, case when manager then auth.uid() end, case when manager then now() end)
  returning id into vid;
  if manager then
    perform app.apply_variation(vid);
    perform app.notify(s.sales_person_id, 'secured_variation', 'Variation recorded on your project',
      s.project_name || ' · ' || case when amt > 0 then '+' else '−' end || app.fmt_money(abs(amt), 'LKR') || ' · ' || btrim(p_data ->> 'reason'),
      'normal', 'secured_project', s.id, app.secured_url(s.id));
    return 'approved';
  end if;
  insert into public.secured_log (secured_id, action, note)
  values (s.id, 'variation_requested', concat_ws(' · ', 'Variation ' || case when amt > 0 then '+' else '−' end || app.fmt_money(abs(amt), 'LKR') || ' sent to SM Projects',
          nullif(btrim(p_data ->> 'vo_no'), ''), btrim(p_data ->> 'reason')));
  perform app.notify_many(app.role_users('sm_projects'), 'secured_variation', 'Variation to approve',
    s.project_name || ' · ' || coalesce(app.display_name(s.sales_person_id), '—') || ' · ' || case when amt > 0 then '+' else '−' end ||
    app.fmt_money(abs(amt), 'LKR') || ' · ' || btrim(p_data ->> 'reason'), 'normal', 'secured_project', s.id, app.secured_url(s.id), null, true);
  return 'pending';
end $$;

create or replace function public.decide_variation(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.secured_variations; s public.secured_projects;
begin
  perform app.require(app.has_role('sm_projects'), 'SM Projects approves variations');
  select * into v from public.secured_variations where id = p_id for update;
  perform app.require(v.id is not null and v.status = 'pending', 'This variation is already decided');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  select * into s from public.secured_projects where id = v.secured_id;
  perform app.require(s.status = 'open', 'The project is closed');
  update public.secured_variations set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(p_note), '') where id = v.id;
  if p_approve then
    perform app.apply_variation(v.id);
  else
    insert into public.secured_log (secured_id, action, note) values (s.id, 'variation_rejected', 'Variation not approved · ' || btrim(p_note));
  end if;
  perform app.notify_many(array[v.requested_by, s.sales_person_id], 'secured_variation',
    case when p_approve then 'Variation approved' else 'Variation not approved' end,
    s.project_name || ' · ' || case when v.amount > 0 then '+' else '−' end || app.fmt_money(abs(v.amount), 'LKR') || coalesce(' · ' || nullif(btrim(p_note), ''), ''),
    'normal', 'secured_project', s.id, app.secured_url(s.id));
end $$;
