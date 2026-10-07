-- Mark secured: a secured project with the same SAP WBS is linked to the budget line instead of failing with
-- "This WBS is already on another secured project" (copied from 20260930000066_secure_from_budget.sql)

create or replace function public.secure_budget_project(p_budget uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b public.budget_projects;
  sid uuid;
  w text;
  o public.secured_projects;
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
  -- Same SAP WBS as a secured project already in the list: link that project instead of a duplicate (e.g. the budget
  -- list was re-uploaded with rows merged); if it already belongs to another budget line, say which project has it
  w := app.wbs_base(nullif(coalesce(nullif(btrim(p_data ->> 'wbs'), ''), b.wbs), ''));
  if w is not null then
    select * into o from public.secured_projects where app.wbs_base(wbs) = w order by won_on limit 1;
    if o.id is not null then
      perform app.require(o.budget_id is null or not exists (select 1 from public.budget_projects where id = o.budget_id and fy = b.fy),
        format('WBS %s is already on the secured project "%s" (budget line "%s") – check the WBS', w, o.project_name,
               (select project_name from public.budget_projects where id = o.budget_id)));
      update public.secured_projects set budget_id = b.id where id = o.id;
      insert into public.secured_log (secured_id, action, note) values (o.id, 'budget', 'Linked to the budget line ' || b.project_name || ' (same WBS ' || w || ')');
      return o.id;
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
