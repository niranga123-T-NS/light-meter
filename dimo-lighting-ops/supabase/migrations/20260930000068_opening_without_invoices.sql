-- Opening secured list: rows without invoice months no longer fail ("invoiced before + invoices must equal the order
-- value"). They load with the schedule missing and the sales person enters the invoices; loading again without invoice
-- months keeps a schedule already entered. Amounts may carry commas. (Copied from 20260930000057.)
create or replace function public.check_opening_list(p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
  out jsonb := '[]';
  errs text[];
  warns text[];
  sp uuid;
  pid uuid;
  existing uuid;
  val numeric;
  before numeric;
  inv numeric;
  x jsonb;
begin
  perform app.require(app.is_finance_desk(), 'Only Operations, SM Projects or GM / DGM upload the secured list');
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    errs := '{}'; warns := '{}'; sp := null; pid := null; existing := null;
    if coalesce(btrim(r ->> 'project_name'), '') = '' then errs := errs || 'Project name missing'::text; end if;
    if app.norm_line(r ->> 'business_line') is null then
      errs := errs || ('Business line "' || coalesce(r ->> 'business_line', '') || '" – use Infrastructure, Building Lighting – LMS or Building Lighting – Indoor')::text;
    end if;
    if coalesce(btrim(r ->> 'sales_person'), '') = '' then errs := errs || 'Sales person missing'::text;
    else
      sp := app.find_person(r ->> 'sales_person');
      if sp is null then errs := errs || ('Sales person "' || (r ->> 'sales_person') || '" not found in the system')::text; end if;
    end if;
    val := app.to_num(r ->> 'order_value');
    before := case when coalesce(btrim(r ->> 'billed_before'), '') = '' then 0 else app.to_num(r ->> 'billed_before') end;
    if val is null or val <= 0 then errs := errs || 'Order value missing or not a number'::text; end if;
    if before is null or before < 0 then errs := errs || 'Invoiced before 1 April is not a number'::text; end if;
    if coalesce(r ->> 'won_on', '') = '' then errs := errs || 'Won (PO) date missing'::text;
    else
      begin perform (r ->> 'won_on')::date; exception when others then errs := errs || 'Won date is not a date'::text; end;
    end if;
    inv := 0;
    begin
      for x in select * from jsonb_array_elements(coalesce(r -> 'invoices', '[]')) loop
        perform (x ->> 'month')::date;
        if (x ->> 'amount')::numeric <= 0 then raise exception 'amount'; end if;
        inv := inv + (x ->> 'amount')::numeric;
      end loop;
    exception when others then errs := errs || 'An invoice month or amount is not valid'::text;
    end;
    if val is not null and before is not null and before > val + 1 then
      errs := errs || 'Invoiced before 1 April is more than the order value'::text;
    elsif jsonb_array_length(coalesce(r -> 'invoices', '[]')) = 0 then
      -- No invoice months in the file: loaded with the schedule missing – the sales person enters the invoices
      if val is not null and before is not null and val - before > 1 then
        warns := warns || format('No invoice months – loaded as “Schedule missing”; the sales person enters the invoices for the balance %s',
          to_char(val - before, 'FM999,999,999,990.00'))::text;
      end if;
    elsif val is not null and before is not null and abs(before + inv - val) > 1 then
      errs := errs || format('Invoiced before (%s) + invoices still to do (%s) must equal the order value (%s)',
        to_char(before, 'FM999,999,999,990.00'), to_char(inv, 'FM999,999,999,990.00'), to_char(val, 'FM999,999,999,990.00'))::text;
    end if;
    if coalesce(btrim(r ->> 'wbs'), '') = '' then warns := warns || 'No WBS – invoicing from the OR file cannot be matched until it is added'::text; end if;
    select id into pid from public.projects where name_norm = app.normalize_name(r ->> 'project_name') and status <> 'cancelled' limit 1;
    select id into existing from public.secured_projects
     where (nullif(r ->> 'wbs', '') is not null and app.wbs_base(wbs) = app.wbs_base(r ->> 'wbs'))
        or (pid is not null and project_id = pid)
        or (lower(project_name) = lower(btrim(r ->> 'project_name')) and lower(coalesce(customer, '')) = lower(coalesce(btrim(r ->> 'customer'), '')))
     limit 1;
    if existing is not null then
      if (select source from public.secured_projects where id = existing) = 'won' then
        errs := errs || 'Already secured in the system (won through the system) – not changed from the opening list'::text;
      else
        warns := warns || 'Already in the opening list – it will be updated'::text;
      end if;
    end if;
    out := out || jsonb_build_object('row_no', r -> 'row_no', 'errors', to_jsonb(errs), 'warnings', to_jsonb(warns),
      'sales_person_id', sp, 'project_id', pid, 'secured_id', existing, 'business_line', app.norm_line(r ->> 'business_line'));
  end loop;
  return out;
end $$;

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
        app.to_num(r ->> 'order_value'), (r ->> 'won_on')::date, 'opening', coalesce(app.to_num(r ->> 'billed_before'), 0),
        case when has_inv or app.to_num(r ->> 'order_value') - coalesce(app.to_num(r ->> 'billed_before'), 0) <= 1 then 'approved' else 'missing' end,
        case when has_inv then now() end, case when has_inv then auth.uid() end)
      returning id into sid;
      insert into public.secured_log (secured_id, action, note) values (sid, 'opening', 'Loaded from the opening secured list');
    else
      update public.secured_projects set project_id = coalesce(project_id, (c ->> 'project_id')::uuid), project_name = btrim(r ->> 'project_name'),
        customer = nullif(btrim(r ->> 'customer'), ''), business_line = c ->> 'business_line', sales_person_id = (c ->> 'sales_person_id')::uuid,
        wbs = app.wbs_base(nullif(r ->> 'wbs', '')), po_no = nullif(btrim(r ->> 'po_no'), ''), order_value = app.to_num(r ->> 'order_value'),
        won_on = (r ->> 'won_on')::date, billed_before = coalesce(app.to_num(r ->> 'billed_before'), 0), updated_at = now(),
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
