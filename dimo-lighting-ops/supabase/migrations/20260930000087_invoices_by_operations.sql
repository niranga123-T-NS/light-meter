-- Invoices are the Operations Executive's: only Operations records, confirms (past invoices), re-assigns and deletes
-- invoices. GM / DGM, SM Projects and sales persons see them read-only. (Copied from 20260930000071 / 057 / 086.)

create or replace function public.record_invoice(p_line uuid, p_data jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  l public.invoice_line_status;
  s public.secured_projects;
  d date;
  amt numeric := round(app.to_num(p_data ->> 'amount'), 2);
  aid bigint;
begin
  select * into l from public.invoice_line_status where id = p_line;
  perform app.require(l.id is not null, 'Invoice not found');
  select * into s from public.secured_projects where id = l.secured_id;
  perform app.require(app.has_role('operations_exec'), 'Invoices are recorded by the Operations Executive');
  perform app.require(s.status <> 'cancelled', 'The project is cancelled');
  perform app.require(coalesce(btrim(p_data ->> 'invoice_no'), '') <> '', 'Enter the invoice number');
  begin d := (p_data ->> 'invoice_date')::date; exception when others then d := null; end;
  perform app.require(d is not null and d <= (now() at time zone app.tz())::date, 'Enter the invoice date (not in the future)');
  perform app.require(coalesce(amt, 0) > 0, 'Enter the invoice amount');
  perform app.require(amt <= l.remaining + 1,
    format('Only %s is still to invoice on this line – record a variation first, or split the amount over the next invoice', app.fmt_money(l.remaining, 'LKR')));
  perform app.require(not exists (select 1 from public.invoice_allocations a where a.secured_id = s.id and lower(a.invoice_no) = lower(btrim(p_data ->> 'invoice_no'))),
    'This invoice number is already recorded on this project');
  insert into public.invoice_allocations (upload_id, month, secured_id, line_id, amount, manual, invoice_no, invoice_date, note, created_by)
  values (null, app.month_of(d), s.id, l.id, amt, true, btrim(p_data ->> 'invoice_no'), d, nullif(btrim(p_data ->> 'note'), ''), auth.uid())
  returning id into aid;
  insert into public.secured_log (secured_id, action, note)
  values (s.id, 'invoiced', concat_ws(' · ', 'Invoice ' || btrim(p_data ->> 'invoice_no') || ' recorded', to_char(d, 'DD Mon YYYY'),
          app.fmt_money(amt, 'LKR'), coalesce(l.description, initcap(l.kind))));
  if s.sales_person_id is distinct from auth.uid() then
    perform app.notify(s.sales_person_id, 'invoice_recorded', 'Invoice recorded on your project',
      s.project_name || ' · ' || btrim(p_data ->> 'invoice_no') || ' · ' || app.fmt_money(amt, 'LKR'), 'normal', 'secured_project', s.id, app.secured_url(s.id));
  end if;
  return aid;
end $$;

create or replace function public.delete_invoice(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.invoice_allocations;
begin
  select * into a from public.invoice_allocations where id = p_id for update;
  perform app.require(a.id is not null, 'Not found');
  perform app.require(app.has_role('operations_exec'), 'Invoices are deleted by the Operations Executive');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  delete from public.invoice_allocations where id = a.id;
  insert into public.secured_log (secured_id, action, note)
  values (a.secured_id, 'invoice_deleted', concat_ws(' · ', 'Invoice ' || coalesce(a.invoice_no, 'from the OR file') || ' deleted',
          app.fmt_money(a.amount, 'LKR'), btrim(p_reason)));
end $$;

create or replace function public.reassign_allocation(p_alloc bigint, p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.invoice_allocations;
begin
  perform app.require(app.has_role('operations_exec'), 'Invoices are re-assigned by the Operations Executive');
  select * into a from public.invoice_allocations where id = p_alloc for update;
  perform app.require(a.id is not null, 'Not found');
  perform app.require(p_line is null or exists (select 1 from public.invoice_lines where id = p_line and secured_id = a.secured_id),
    'Choose an invoice of the same project');
  update public.invoice_allocations set line_id = p_line, manual = true where id = a.id;
  perform app.reallocate(a.secured_id);
end $$;

create or replace function public.confirm_past_invoices(p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  x jsonb;
  l public.invoice_line_status;
  s public.secured_projects;
  amt numeric;
  d date;
  no text;
  this_month date := app.month_of((now() at time zone app.tz())::date);
  n int := 0;
  told jsonb := '{}';
  sp text;
begin
  perform app.require(app.has_role('operations_exec'), 'Past invoices are confirmed by the Operations Executive');
  perform app.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0, 'Tick the invoices that were raised');
  for x in select * from jsonb_array_elements(p_items) loop
    select * into l from public.invoice_line_status where id = (x ->> 'line_id')::uuid;
    perform app.require(l.id is not null, 'Invoice not found');
    select * into s from public.secured_projects where id = l.secured_id;
    perform app.require(s.status <> 'cancelled', format('%s is cancelled', s.project_name));
    perform app.require(l.forecast_month < this_month, format('%s · %s is not a past invoice', s.project_name, coalesce(l.description, l.kind)));
    amt := round(coalesce(nullif(app.to_num(x ->> 'amount'), 0), l.remaining), 2);
    perform app.require(amt > 0 and amt <= l.remaining + 1,
      format('%s · %s: only %s is still to invoice', s.project_name, coalesce(l.description, l.kind), app.fmt_money(l.remaining, 'LKR')));
    begin d := nullif(x ->> 'invoice_date', '')::date; exception when others then d := null; end;
    d := coalesce(d, (l.forecast_month + interval '1 month' - interval '1 day')::date);
    perform app.require(d <= (now() at time zone app.tz())::date, 'An invoice date cannot be in the future');
    no := nullif(btrim(x ->> 'invoice_no'), '');
    perform app.require(no is null or not exists (select 1 from public.invoice_allocations a where a.secured_id = s.id and lower(a.invoice_no) = lower(no)),
      format('Invoice %s is already recorded on %s', no, s.project_name));
    insert into public.invoice_allocations (upload_id, month, secured_id, line_id, amount, manual, invoice_no, invoice_date, note, created_by)
    values (null, app.month_of(d), s.id, l.id, amt, true, no, d,
            case when no is null then 'Confirmed from the schedule – add the invoice number' else 'Confirmed from the schedule' end, auth.uid());
    insert into public.secured_log (secured_id, action, note)
    values (s.id, 'invoiced', concat_ws(' · ', 'Invoice confirmed from the schedule', coalesce(no, 'no number yet'), to_char(d, 'DD Mon YYYY'),
            app.fmt_money(amt, 'LKR'), coalesce(l.description, initcap(l.kind))));
    n := n + 1;
    if s.sales_person_id is not null and s.sales_person_id is distinct from auth.uid() then
      sp := s.sales_person_id::text;
      told := jsonb_set(told, array[sp], to_jsonb(coalesce((told ->> sp)::int, 0) + 1));
    end if;
  end loop;
  for sp in select jsonb_object_keys(told) loop
    perform app.notify(sp::uuid, 'invoice_recorded', format('%s past invoice(s) confirmed on your projects', told ->> sp),
      'Confirmed from the invoice schedules by ' || app.display_name(auth.uid()), 'normal', null, null, '/finance/invoicing');
  end loop;
  return n;
end $$;
