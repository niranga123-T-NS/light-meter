-- Confirm past invoices from the schedules: tick the scheduled invoices (month before this one, not fully invoiced) that
-- were actually raised and confirm them together. Each one is recorded as an invoice in its scheduled month for its
-- balance (or the amount given), with the invoice number and date when known – otherwise it is marked to add the number.
-- p_items: [{line_id, amount?, invoice_no?, invoice_date?}]
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
  perform app.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0, 'Tick the invoices that were raised');
  for x in select * from jsonb_array_elements(p_items) loop
    select * into l from public.invoice_line_status where id = (x ->> 'line_id')::uuid;
    perform app.require(l.id is not null, 'Invoice not found');
    select * into s from public.secured_projects where id = l.secured_id;
    perform app.require(app.can_edit_secured(s), 'Only the sales person, Operations, SM Projects or GM / DGM record invoices');
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
revoke execute on function public.confirm_past_invoices(jsonb) from public, anon;
grant execute on function public.confirm_past_invoices(jsonb) to authenticated, service_role;
