-- Targets from the budget list: a budget project without invoice months used to give zero targets. It is now taken as
-- invoiced this year, spread evenly from its order month (April if none) to March (copied from 20260930000057).
create or replace function public.fill_targets_from_budget(p_fy int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'Only SM Projects or GM / DGM set targets');
  perform app.require(app.targets_editable(p_fy), 'Targets are submitted or approved – GM / DGM must return them first');
  insert into public.target_sets (fy) values (p_fy) on conflict (fy) do nothing;
  delete from public.sales_targets where fy = p_fy;
  with binv as (
    -- Invoice months of the budget list; a project listed without them is taken as invoiced this year,
    -- spread evenly from its order month (April if none) to March
    select b.id as budget_id, b.sales_person_id, app.month_of(i.month) as month, i.amount
      from public.budget_projects b join public.budget_invoices i on i.budget_id = b.id
     where b.fy = p_fy and i.month between app.fy_start(p_fy) and app.fy_end(p_fy)
    union all
    select b.id, b.sales_person_id, g.month::date, round(b.budget_value / (extract(year from age(app.fy_start(p_fy) + interval '11 months',
             greatest(app.month_of(coalesce(b.order_month, app.fy_start(p_fy))), app.fy_start(p_fy)))) * 12
           + extract(month from age(app.fy_start(p_fy) + interval '11 months',
             greatest(app.month_of(coalesce(b.order_month, app.fy_start(p_fy))), app.fy_start(p_fy)))) + 1), 2)
      from public.budget_projects b
      cross join lateral generate_series(greatest(app.month_of(coalesce(b.order_month, app.fy_start(p_fy))), app.fy_start(p_fy)),
                                         app.fy_start(p_fy) + interval '11 months', interval '1 month') g(month)
     where b.fy = p_fy and b.budget_value > 0
       and not exists (select 1 from public.budget_invoices i where i.budget_id = b.id)
       and coalesce(b.order_month, app.fy_start(p_fy)) <= app.fy_end(p_fy)
  ), months as (
    select generate_series(app.fy_start(p_fy), app.fy_start(p_fy) + interval '11 months', interval '1 month')::date as month
  ), people as (
    select distinct sales_person_id from public.budget_projects where fy = p_fy and sales_person_id is not null
    union select distinct sales_person_id from public.secured_projects where source = 'opening' and status = 'open' and sales_person_id is not null
  ), inv as (
    select sales_person_id, month, sum(amount) as amt from binv group by 1, 2
    union all
    select s.sales_person_id, l.original_month, sum(l.amount)
      from public.secured_projects s join public.invoice_lines l on l.secured_id = s.id
     where s.source = 'opening' and s.status = 'open' and l.original_month between app.fy_start(p_fy) and app.fy_end(p_fy)
       and not exists (select 1 from public.budget_projects b where b.fy = p_fy and (b.id = s.budget_id or (b.wbs is not null and b.wbs = s.wbs)))
     group by 1, 2
  ), sec as (
    select b.sales_person_id, greatest(coalesce(b.order_month, app.fy_start(p_fy)), app.fy_start(p_fy)) as month,
           sum((select coalesce(sum(x.amount), 0) from binv x where x.budget_id = b.id)) as amt
      from public.budget_projects b
     where b.fy = p_fy
       and not exists (select 1 from public.secured_projects s where s.source = 'opening'
                        and ((s.budget_id = b.id) or (b.wbs is not null and s.wbs = b.wbs)))
     group by 1, 2
  )
  insert into public.sales_targets (fy, sales_person_id, month, secured_target, invoice_target)
  select p_fy, p.sales_person_id, m.month,
         coalesce((select sum(amt) from sec where sec.sales_person_id = p.sales_person_id and app.month_of(sec.month) = m.month), 0),
         coalesce((select sum(amt) from inv where inv.sales_person_id = p.sales_person_id and inv.month = m.month), 0)
    from people p cross join months m;
  get diagnostics n = row_count;
  return n;
end $$;

-- Upload check: the warning now says how a project without invoice months counts (copied from 20260930000064)
create or replace function public.check_budget_list(p_fy int, p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
  out jsonb := '[]';
  errs text[];
  warns text[];
  sp uuid;
  pid uuid;
  inv numeric;
  val numeric;
  m date;
  x jsonb;
  gv numeric;
begin
  perform app.require(app.is_finance_desk(), 'Only Operations, SM Projects or GM / DGM upload the budget list');
  perform app.require(p_fy between 2020 and 2100, 'Choose the financial year');
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    errs := '{}'; warns := '{}'; sp := null; pid := null;
    if coalesce(btrim(r ->> 'project_name'), '') = '' then errs := errs || 'Project name missing'::text; end if;
    if app.norm_line(r ->> 'business_line') is null then
      errs := errs || ('Business line "' || coalesce(r ->> 'business_line', '') || '" – use Infrastructure, Building Lighting – LMS or Building Lighting – Indoor')::text;
    end if;
    if coalesce(btrim(r ->> 'sales_person'), '') = '' then errs := errs || 'Sales person missing'::text;
    else
      sp := app.find_person(r ->> 'sales_person');
      if sp is null then errs := errs || ('Sales person "' || (r ->> 'sales_person') || '" not found in the system')::text; end if;
    end if;
    val := app.to_num(r ->> 'budget_value');
    if val is null or val < 0 then errs := errs || 'Budget value missing or not a number'::text; end if;
    if coalesce(btrim(r ->> 'budget_gp_pct'), '') <> '' and app.budget_gp(r ->> 'budget_gp_pct', val) is null then
      errs := errs || ('Budget GP % "' || (r ->> 'budget_gp_pct') || '" is not a valid % – enter e.g. 22.50')::text;
    elsif coalesce(btrim(r ->> 'budget_gp_pct'), '') <> '' and app.budget_gp(r ->> 'budget_gp_pct', null) is null then
      warns := warns || ('Budget GP % looks like an amount (' || (r ->> 'budget_gp_pct') || ') – saved as ' ||
        to_char(app.budget_gp(r ->> 'budget_gp_pct', val), 'FM999,990.00') || '% of the budget value')::text;
    end if;
    if coalesce(btrim(r ->> 'budget_gp_value'), '') <> '' then
      gv := app.to_num(r ->> 'budget_gp_value');
      if gv is null then errs := errs || ('Budget GP value "' || (r ->> 'budget_gp_value') || '" is not a number')::text;
      elsif val is not null and abs(gv) > val then errs := errs || 'Budget GP value is more than the budget value'::text;
      elsif val > 0 and app.budget_gp(r ->> 'budget_gp_pct', val) is not null
            and abs(app.budget_gp(r ->> 'budget_gp_pct', val) - gv / val * 100) > 0.5 then
        warns := warns || ('GP % and GP value do not agree – ' || to_char(app.budget_gp(r ->> 'budget_gp_pct', val), 'FM999,990.00') || '% vs ' ||
          to_char(gv / val * 100, 'FM999,990.00') || '% (both kept as given)')::text;
      end if;
    end if;
    inv := 0;
    for x in select * from jsonb_array_elements(coalesce(r -> 'invoices', '[]')) loop
      begin
        m := (x ->> 'month')::date;
        inv := inv + (x ->> 'amount')::numeric;
        if m < app.fy_start(p_fy) or m > app.fy_end(p_fy) + 366 then warns := warns || ('Invoice month ' || to_char(m, 'Mon YYYY') || ' is outside the year')::text; end if;
      exception when others then errs := errs || 'An invoice month or amount is not valid'::text;
      end;
    end loop;
    if val is not null and inv > val + 1 then errs := errs || 'Invoice amounts add up to more than the budget value'::text; end if;
    if val is not null and jsonb_array_length(coalesce(r -> 'invoices', '[]')) = 0 then warns := warns || 'No invoice months – for the targets the budget value is spread evenly from the order month (April if none) to March'::text; end if;
    select id into pid from public.projects where name_norm = app.normalize_name(r ->> 'project_name') and status <> 'cancelled' limit 1;
    if pid is null then warns := warns || 'Not matched to a project in the system (kept as a name)'::text; end if;
    out := out || jsonb_build_object('row_no', r -> 'row_no', 'errors', to_jsonb(errs), 'warnings', to_jsonb(warns),
      'sales_person_id', sp, 'project_id', pid, 'business_line', app.norm_line(r ->> 'business_line'));
  end loop;
  return out;
end $$;
