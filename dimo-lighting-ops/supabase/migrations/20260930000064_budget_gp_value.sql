-- Budget list: GP value (LKR) as well as GP %. Either can be given; the other is worked out from the budget value.
-- Both given and not agreeing → a warning, both kept as given.
alter table public.budget_projects add column if not exists budget_gp_value numeric(16, 2);
update public.budget_projects set budget_gp_value = round(budget_value * budget_gp_pct / 100, 2)
 where budget_gp_value is null and budget_gp_pct is not null;

create or replace function app.to_num(p text) returns numeric language plpgsql immutable as $$
begin
  return nullif(replace(replace(btrim(coalesce(p, '')), ',', ''), ' ', ''), '')::numeric;
exception when others then return null;
end $$;

-- Copied from 20260930000063 with the GP value
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
    if val is not null and jsonb_array_length(coalesce(r -> 'invoices', '[]')) = 0 then warns := warns || 'No invoice months – invoicing target will be empty for this project'::text; end if;
    select id into pid from public.projects where name_norm = app.normalize_name(r ->> 'project_name') and status <> 'cancelled' limit 1;
    if pid is null then warns := warns || 'Not matched to a project in the system (kept as a name)'::text; end if;
    out := out || jsonb_build_object('row_no', r -> 'row_no', 'errors', to_jsonb(errs), 'warnings', to_jsonb(warns),
      'sales_person_id', sp, 'project_id', pid, 'business_line', app.norm_line(r ->> 'business_line'));
  end loop;
  return out;
end $$;

create or replace function public.save_budget_list(p_fy int, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  chk jsonb := public.check_budget_list(p_fy, p_rows);
  r jsonb;
  c jsonb;
  bid uuid;
  n int := 0;
  x jsonb;
begin
  perform app.require(not exists (select 1 from jsonb_array_elements(chk) e where jsonb_array_length(e -> 'errors') > 0),
    'Some rows have errors – fix them in the file and upload again');
  delete from public.budget_projects where fy = p_fy;
  for r, c in select a.value, b.value from jsonb_array_elements(p_rows) with ordinality a(value, i)
                join jsonb_array_elements(chk) with ordinality b(value, j) on a.i = b.j loop
    insert into public.budget_projects (fy, row_no, business_line, project_id, project_name, customer, sales_person_id, wbs,
      budget_value, budget_gp_pct, budget_gp_value, order_month, notes)
    values (p_fy, (r ->> 'row_no')::int, c ->> 'business_line', (c ->> 'project_id')::uuid, btrim(r ->> 'project_name'),
      nullif(btrim(r ->> 'customer'), ''), (c ->> 'sales_person_id')::uuid, app.wbs_base(nullif(r ->> 'wbs', '')),
      app.to_num(r ->> 'budget_value'),
      coalesce(app.budget_gp(r ->> 'budget_gp_pct', app.to_num(r ->> 'budget_value')),
               round(app.to_num(r ->> 'budget_gp_value') / nullif(app.to_num(r ->> 'budget_value'), 0) * 100, 2)),
      coalesce(round(app.to_num(r ->> 'budget_gp_value'), 2),
               round(app.to_num(r ->> 'budget_value') * app.budget_gp(r ->> 'budget_gp_pct', app.to_num(r ->> 'budget_value')) / 100, 2)),
      app.month_of(nullif(r ->> 'order_month', '')::date), nullif(btrim(r ->> 'notes'), ''))
    returning id into bid;
    for x in select * from jsonb_array_elements(coalesce(r -> 'invoices', '[]')) loop
      insert into public.budget_invoices (budget_id, month, amount) values (bid, app.month_of((x ->> 'month')::date), (x ->> 'amount')::numeric);
    end loop;
    n := n + 1;
  end loop;
  -- Re-link secured projects of the year to their budget line
  update public.secured_projects s set budget_id = b.id
    from public.budget_projects b
   where b.fy = p_fy and s.budget_id is null and app.fy_of(s.won_on) >= p_fy - 1
     and ((b.project_id is not null and b.project_id = s.project_id) or (b.wbs is not null and b.wbs = app.wbs_base(s.wbs)));
  return n;
end $$;
