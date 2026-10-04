-- Won date: the opening list rejects a won date in the future (a typo in the file), and Operations / SM Projects can
-- correct the won date of a secured project in "Edit details". (Copied from 20260930000069 and 20260930000057.)
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
  dup text;
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
      begin
        if (r ->> 'won_on')::date > (now() at time zone app.tz())::date then
          errs := errs || ('Won date ' || to_char((r ->> 'won_on')::date, 'DD Mon YYYY') || ' is in the future – check the date in the file')::text;
        end if;
      exception when others then errs := errs || 'Won date is not a date'::text; end;
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
    -- The same WBS (or the same project and customer) twice in the file
    select string_agg(o ->> 'row_no', ', ') into dup from jsonb_array_elements(p_rows) o
     where o ->> 'row_no' is distinct from r ->> 'row_no' and coalesce(btrim(r ->> 'wbs'), '') <> ''
       and app.wbs_base(nullif(btrim(o ->> 'wbs'), '')) = app.wbs_base(btrim(r ->> 'wbs'));
    if dup is not null then
      errs := errs || ('Same WBS ' || app.wbs_base(btrim(r ->> 'wbs')) || ' as row ' || dup ||
        ' – one secured project per WBS: combine the rows (add the order values) or correct the WBS')::text;
    end if;
    select string_agg(o ->> 'row_no', ', ') into dup from jsonb_array_elements(p_rows) o
     where o ->> 'row_no' is distinct from r ->> 'row_no'
       and lower(btrim(o ->> 'project_name')) = lower(btrim(r ->> 'project_name'))
       and lower(coalesce(btrim(o ->> 'customer'), '')) = lower(coalesce(btrim(r ->> 'customer'), ''));
    if dup is not null then
      warns := warns || ('Same project name as row ' || dup || ' – loaded as separate projects; check it is not entered twice')::text;
    end if;
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

create or replace function public.set_secured_details(p_secured uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.secured_projects;
begin
  select * into s from public.secured_projects where id = p_secured for update;
  perform app.require(s.id is not null, 'Secured project not found');
  perform app.require(app.can_edit_secured(s), 'Only the sales person, Operations or SM Projects edit this project');
  perform app.require(not (p_data ? 'sales_person_id') or app.is_finance_desk(), 'Only Operations or SM Projects change the sales person');
  perform app.require(not (p_data ? 'won_on') or app.is_finance_desk(), 'Only Operations or SM Projects change the won date');
  perform app.require(not (p_data ? 'won_on') or ((p_data ->> 'won_on')::date <= (now() at time zone app.tz())::date),
    'The won date cannot be in the future');
  perform app.require(not (p_data ? 'business_line') or app.norm_line(p_data ->> 'business_line') is not null, 'Choose the business line');
  perform app.require(not (p_data ? 'wbs') or nullif(p_data ->> 'wbs', '') is null
    or not exists (select 1 from public.secured_projects o where o.id <> s.id and app.wbs_base(o.wbs) = app.wbs_base(p_data ->> 'wbs')),
    'This WBS is already on another secured project');
  update public.secured_projects set
    wbs = case when p_data ? 'wbs' then app.wbs_base(nullif(p_data ->> 'wbs', '')) else wbs end,
    po_no = case when p_data ? 'po_no' then nullif(btrim(p_data ->> 'po_no'), '') else po_no end,
    notes = case when p_data ? 'notes' then nullif(btrim(p_data ->> 'notes'), '') else notes end,
    customer = case when p_data ? 'customer' then nullif(btrim(p_data ->> 'customer'), '') else customer end,
    business_line = case when p_data ? 'business_line' then app.norm_line(p_data ->> 'business_line') else business_line end,
    sales_person_id = case when p_data ? 'sales_person_id' then (p_data ->> 'sales_person_id')::uuid else sales_person_id end,
    won_on = case when p_data ? 'won_on' then (p_data ->> 'won_on')::date else won_on end,
    updated_at = now()
   where id = s.id;
  insert into public.secured_log (secured_id, action, note)
  values (s.id, 'details', 'Updated: ' || (select string_agg(k, ', ') from jsonb_object_keys(p_data) k));
  perform app.reallocate(s.id);
end $$;
