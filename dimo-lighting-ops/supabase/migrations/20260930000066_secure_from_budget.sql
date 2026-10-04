-- Secured projects can now be added three ways besides "Won" in the system and the opening-list upload:
--  * Mark a budget-list project as secured (the budget row's sales person, Operations, SM Projects, GM / DGM). Its budget
--    invoice months become the draft invoice schedule. Won before the budget year → counted as an earlier order (opening).
--  * Add one secured project by hand (Operations, SM Projects, GM / DGM) – e.g. won before the system and not budgeted.
-- Won in the current or a later year → source 'won' (counts toward the secured target once SM Projects approves the
-- schedule); won before → 'opening' (already secured, counts only for invoicing).

create or replace function app.create_secured(p jsonb, p_budget uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
  won date;
  val numeric := app.to_num(p ->> 'order_value');
  billed numeric := coalesce(app.to_num(p ->> 'billed_before'), 0);
  pid uuid := nullif(p ->> 'project_id', '')::uuid;
  sp uuid := nullif(p ->> 'sales_person_id', '')::uuid;
  v_wbs text := app.wbs_base(nullif(btrim(p ->> 'wbs'), ''));
  src text;
begin
  begin won := (p ->> 'won_on')::date; exception when others then won := null; end;
  perform app.require(coalesce(btrim(p ->> 'project_name'), '') <> '', 'Enter the project name');
  perform app.require(app.norm_line(p ->> 'business_line') is not null, 'Choose the business line');
  perform app.require(sp is not null and exists (select 1 from public.profiles where id = sp and active), 'Choose the sales person');
  perform app.require(won is not null and won <= (now() at time zone app.tz())::date, 'Enter the won (PO) date – not in the future');
  perform app.require(coalesce(val, 0) > 0, 'Enter the order value');
  perform app.require(billed >= 0 and billed <= val, 'Invoiced before cannot be more than the order value');
  perform app.require(pid is null or not exists (select 1 from public.secured_projects where project_id = pid),
    'This project is already on the secured list');
  perform app.require(v_wbs is null or not exists (select 1 from public.secured_projects s where app.wbs_base(s.wbs) = v_wbs),
    'This WBS is already on another secured project');
  src := case when won < app.fy_start(app.fy_of((now() at time zone app.tz())::date)) then 'opening' else 'won' end;
  insert into public.secured_projects (code, project_id, project_name, customer, business_line, sales_person_id, wbs, po_no,
    order_value, won_on, source, billed_before, budget_id, notes)
  values (app.next_code('SEC'), pid, btrim(p ->> 'project_name'), nullif(btrim(p ->> 'customer'), ''), app.norm_line(p ->> 'business_line'),
    sp, v_wbs, nullif(btrim(p ->> 'po_no'), ''), round(val, 2), won, src, round(billed, 2), p_budget, nullif(btrim(p ->> 'notes'), ''))
  returning id into sid;
  insert into public.secured_log (secured_id, action, note)
  values (sid, 'added', concat_ws(' · ', case when p_budget is not null then 'Marked secured from the budget list' else 'Added to the secured list' end,
    case when src = 'opening' then 'won before this year' end, 'order value ' || app.fmt_money(val, 'LKR')));
  if sp is distinct from auth.uid() then
    perform app.notify(sp, 'secured_schedule', 'Secured project added – enter the invoice schedule',
      btrim(p ->> 'project_name') || ' · ' || app.fmt_money(val, 'LKR'), 'normal', 'secured_project', sid, app.secured_url(sid));
  end if;
  perform app.notify_many(app.role_users('sm_projects'), 'secured_new',
    case when p_budget is not null then 'Budgeted project secured' else 'Secured project added' end,
    btrim(p ->> 'project_name') || ' · ' || coalesce(app.display_name(sp), '—') || ' · ' || app.fmt_money(val, 'LKR'),
    'normal', 'secured_project', sid, app.secured_url(sid));
  perform app.reallocate(sid);
  return sid;
end $$;

-- p_data: {won_on, order_value, po_no, wbs, billed_before}
create or replace function public.secure_budget_project(p_budget uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b public.budget_projects;
  sid uuid;
  x record;
  i int := 0;
begin
  select * into b from public.budget_projects where id = p_budget;
  perform app.require(b.id is not null, 'Budget project not found');
  perform app.require(app.is_finance_desk() or b.sales_person_id = auth.uid(),
    'Only the sales person, Operations, SM Projects or GM / DGM mark a budgeted project as secured');
  perform app.require(not exists (select 1 from public.secured_projects where budget_id = b.id), 'This budget project is already secured');
  -- Already secured through "Won" in the system: just link it to the budget line
  if b.project_id is not null then
    select id into sid from public.secured_projects where project_id = b.project_id;
    if sid is not null then
      update public.secured_projects set budget_id = b.id where id = sid;
      insert into public.secured_log (secured_id, action, note) values (sid, 'budget', 'Linked to the budget list');
      return sid;
    end if;
  end if;
  sid := app.create_secured(jsonb_build_object('project_name', b.project_name, 'customer', b.customer, 'business_line', b.business_line,
    'sales_person_id', b.sales_person_id, 'project_id', b.project_id,
    'won_on', p_data ->> 'won_on', 'order_value', coalesce(nullif(p_data ->> 'order_value', ''), b.budget_value::text),
    'billed_before', p_data ->> 'billed_before', 'po_no', p_data ->> 'po_no',
    'wbs', coalesce(nullif(btrim(p_data ->> 'wbs'), ''), b.wbs)), b.id);
  -- The budget invoice months become the draft schedule (the sales person adjusts it and sends it to SM Projects)
  for x in select month, amount from public.budget_invoices where budget_id = b.id order by month loop
    i := i + 1;
    insert into public.invoice_lines (secured_id, seq, kind, description, amount, original_month, forecast_month)
    values (sid, i, 'other', 'Budget invoice ' || i, x.amount, app.month_of(x.month), app.month_of(x.month));
  end loop;
  perform app.reallocate(sid);
  return sid;
end $$;

-- p_data: {project_name, customer, business_line, sales_person_id, won_on, order_value, billed_before, wbs, po_no, notes}
create or replace function public.add_secured_project(p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.is_finance_desk(), 'Only Operations, SM Projects or GM / DGM add secured projects');
  return app.create_secured(p_data - 'project_id', null);
end $$;

revoke execute on function public.secure_budget_project(uuid, jsonb), public.add_secured_project(jsonb) from public, anon;
grant execute on function public.secure_budget_project(uuid, jsonb), public.add_secured_project(jsonb) to authenticated, service_role;
