-- Budget list: edit one project (details and invoice months / amounts), add one, or delete one – without re-uploading
-- the whole list. Operations, SM Projects and GM / DGM (the roles that upload the list). The same checks as the upload.

-- p: {business_line, project_name, customer, sales_person, wbs, budget_value, budget_gp_pct, budget_gp_value, order_month, notes,
--     invoices: [{month, amount}]}
create or replace function public.save_budget_project(p_fy int, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare chk jsonb; bid uuid := p_id; x jsonb; e text;
begin
  perform app.require(app.is_finance_desk(), 'Only Operations, SM Projects or GM / DGM edit the budget list');
  perform app.require(p_id is null or exists (select 1 from public.budget_projects where id = p_id and fy = p_fy), 'Budget project not found');
  chk := public.check_budget_list(p_fy, jsonb_build_array(p)) -> 0;
  select string_agg(v, ' · ') into e from jsonb_array_elements_text(chk -> 'errors') v;
  perform app.require(e is null, coalesce(e, ''));
  if bid is null then
    insert into public.budget_projects (fy, row_no, business_line, project_name, budget_value)
    values (p_fy, coalesce((select max(row_no) from public.budget_projects where fy = p_fy), 0) + 1, chk ->> 'business_line', btrim(p ->> 'project_name'), 0)
    returning id into bid;
  end if;
  update public.budget_projects set
    business_line = chk ->> 'business_line',
    project_id = (chk ->> 'project_id')::uuid,
    project_name = btrim(p ->> 'project_name'),
    customer = nullif(btrim(p ->> 'customer'), ''),
    sales_person_id = (chk ->> 'sales_person_id')::uuid,
    wbs = app.wbs_base(nullif(p ->> 'wbs', '')),
    budget_value = app.to_num(p ->> 'budget_value'),
    budget_gp_pct = coalesce(app.budget_gp(p ->> 'budget_gp_pct', app.to_num(p ->> 'budget_value')),
                             round(app.to_num(p ->> 'budget_gp_value') / nullif(app.to_num(p ->> 'budget_value'), 0) * 100, 2)),
    budget_gp_value = coalesce(round(app.to_num(p ->> 'budget_gp_value'), 2),
                               round(app.to_num(p ->> 'budget_value') * app.budget_gp(p ->> 'budget_gp_pct', app.to_num(p ->> 'budget_value')) / 100, 2)),
    order_month = app.month_of(nullif(p ->> 'order_month', '')::date),
    notes = nullif(btrim(p ->> 'notes'), '')
  where id = bid;
  delete from public.budget_invoices where budget_id = bid;
  for x in select * from jsonb_array_elements(coalesce(p -> 'invoices', '[]')) loop
    if nullif(x ->> 'month', '') is not null and coalesce((x ->> 'amount')::numeric, 0) <> 0 then
      insert into public.budget_invoices (budget_id, month, amount) values (bid, app.month_of((x ->> 'month')::date), (x ->> 'amount')::numeric);
    end if;
  end loop;
  -- link a secured project of the year to this budget line
  update public.secured_projects s set budget_id = b.id
    from public.budget_projects b
   where b.id = bid and s.budget_id is null and app.fy_of(s.won_on) >= p_fy - 1
     and ((b.project_id is not null and b.project_id = s.project_id) or (b.wbs is not null and b.wbs = app.wbs_base(s.wbs)));
  return bid;
end $$;

create or replace function public.delete_budget_project(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.is_finance_desk(), 'Only Operations, SM Projects or GM / DGM edit the budget list');
  delete from public.budget_projects where id = p_id;
  perform app.require(found, 'Budget project not found');
end $$;

revoke execute on function public.save_budget_project(int, uuid, jsonb), public.delete_budget_project(uuid) from public, anon;
grant execute on function public.save_budget_project(int, uuid, jsonb), public.delete_budget_project(uuid) to authenticated;
