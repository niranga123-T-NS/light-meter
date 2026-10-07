-- Secured projects won this financial year count as this year's wins even when they came in through the opening
-- secured list (the list was loaded part-way through the year). 'opening' now means won before this financial year –
-- the same rule as "Mark secured" / "Add secured project". Projects already loaded are corrected once.
create or replace function app.secured_source(p_won date) returns text language sql stable as $$
  select case when p_won < app.fy_start(app.fy_of((now() at time zone app.tz())::date)) then 'opening' else 'won' end
$$;

update public.secured_projects set source = 'won', updated_at = now()
 where source = 'opening' and won_on >= app.fy_start(app.fy_of((now() at time zone app.tz())::date));

-- Opening list upload: source follows the won date (copied from 20260930000068_opening_without_invoices.sql)
create or replace function public.save_opening_list(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  chk jsonb := public.check_opening_list(p_rows);
  r jsonb;
  c jsonb;
  sid uuid;
  n int := 0;
  x jsonb;
  i int;
  has_inv boolean;
begin
  perform app.require(not exists (select 1 from jsonb_array_elements(chk) e where jsonb_array_length(e -> 'errors') > 0),
    'Some rows have errors – fix them in the file and upload again');
  for r, c in select a.value, b.value from jsonb_array_elements(p_rows) with ordinality a(value, i)
                join jsonb_array_elements(chk) with ordinality b(value, j) on a.i = b.j loop
    sid := (c ->> 'secured_id')::uuid;
    has_inv := jsonb_array_length(coalesce(r -> 'invoices', '[]')) > 0;
    if sid is null then
      insert into public.secured_projects (code, project_id, project_name, customer, business_line, sales_person_id, wbs, po_no,
        order_value, won_on, source, billed_before, schedule_status, approved_at, approved_by)
      values (app.next_code('SEC'), (c ->> 'project_id')::uuid, btrim(r ->> 'project_name'), nullif(btrim(r ->> 'customer'), ''),
        c ->> 'business_line', (c ->> 'sales_person_id')::uuid, app.wbs_base(nullif(r ->> 'wbs', '')), nullif(btrim(r ->> 'po_no'), ''),
        app.to_num(r ->> 'order_value'), (r ->> 'won_on')::date, app.secured_source((r ->> 'won_on')::date), coalesce(app.to_num(r ->> 'billed_before'), 0),
        case when has_inv or app.to_num(r ->> 'order_value') - coalesce(app.to_num(r ->> 'billed_before'), 0) <= 1 then 'approved' else 'missing' end,
        case when has_inv then now() end, case when has_inv then auth.uid() end)
      returning id into sid;
      insert into public.secured_log (secured_id, action, note) values (sid, 'opening', 'Loaded from the opening secured list');
    else
      update public.secured_projects set project_id = coalesce(project_id, (c ->> 'project_id')::uuid), project_name = btrim(r ->> 'project_name'),
        customer = nullif(btrim(r ->> 'customer'), ''), business_line = c ->> 'business_line', sales_person_id = (c ->> 'sales_person_id')::uuid,
        wbs = app.wbs_base(nullif(r ->> 'wbs', '')), po_no = nullif(btrim(r ->> 'po_no'), ''), order_value = app.to_num(r ->> 'order_value'),
        won_on = (r ->> 'won_on')::date, source = app.secured_source((r ->> 'won_on')::date), billed_before = coalesce(app.to_num(r ->> 'billed_before'), 0), updated_at = now(),
        schedule_status = case when has_inv then 'approved' else schedule_status end
       where id = sid;
      -- A file without invoice months keeps the schedule already entered
      if has_inv then delete from public.invoice_lines where secured_id = sid; end if;
      insert into public.secured_log (secured_id, action, note) values (sid, 'opening', 'Updated from the opening secured list');
    end if;
    i := 0;
    for x in select * from jsonb_array_elements(coalesce(r -> 'invoices', '[]')) loop
      i := i + 1;
      insert into public.invoice_lines (secured_id, seq, kind, description, amount, original_month, forecast_month)
      values (sid, i, coalesce(nullif(x ->> 'kind', ''), 'other'), nullif(x ->> 'description', ''), (x ->> 'amount')::numeric,
        app.month_of((x ->> 'month')::date), app.month_of((x ->> 'month')::date));
    end loop;
    update public.secured_projects s set budget_id = b.id from public.budget_projects b
     where s.id = sid and s.budget_id is null and b.fy = app.fy_of(current_date)
       and ((b.project_id is not null and b.project_id = s.project_id) or (b.wbs is not null and b.wbs = s.wbs));
    perform app.reallocate(sid);
    n := n + 1;
  end loop;
  return n;
end $$;
