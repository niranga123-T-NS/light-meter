-- Warranty claims for older projects: when the warranty is not in the list, the claim form takes the project and
-- invoice / contract details by hand (from a project in the system, or a project not in the system). A warranty record with
-- one item is created from them and the claim is logged against it. The record is marked to be completed by Operations.

create or replace function app.quick_warranty(m jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.projects;
  src text := 'outside';
  pname text;
  cust text;
  cat public.project_type;
  own uuid;
  inv text := nullif(btrim(m ->> 'invoice_no'), '');
  con text := nullif(btrim(m ->> 'contract_no'), '');
  st date;
  basis text := case when coalesce(m ->> 'start_basis', '') in ('delivery', 'tc', 'handover', 'invoice') then m ->> 'start_basis' else 'handover' end;
  months int;
  w public.warranties;
  lid uuid;
begin
  if nullif(m ->> 'project_id', '') is not null then
    select * into p from public.projects where id = (m ->> 'project_id')::uuid;
    perform app.require(p.id is not null, 'Project not found');
    src := 'system';
    pname := p.name;
    cust := coalesce(nullif(btrim(m ->> 'customer'), ''), (select name from public.organizations where id = p.organization_id));
    cat := p.project_type;
    own := p.owner_id;
  else
    pname := nullif(btrim(m ->> 'project_name'), '');
    cust := nullif(btrim(m ->> 'customer'), '');
    perform app.require(pname is not null, 'Enter the project name');
    perform app.require(cust is not null, 'Enter the customer');
    perform app.require(nullif(m ->> 'category', '') is not null, 'Choose the category – it decides the owner');
    cat := (m ->> 'category')::public.project_type;
    own := app.bond_owner_for(cat);
  end if;
  -- Sales persons enter older projects of their own territory only
  perform app.require(app.is_warranty_desk() or app.has_role('sm_projects') or own = auth.uid() or cat = any (app.my_project_types()),
    'This project is outside your territory');
  perform app.require(coalesce(inv, con) is not null, 'Enter the invoice number or the contract number');
  perform app.require(not exists (select 1 from public.warranties x where x.status = 'active'
      and ((inv is not null and lower(x.invoice_no) = lower(inv)) or (con is not null and lower(x.contract_no) = lower(con)))),
    'A warranty with this invoice / contract number is already in the system – choose it from the list');
  begin st := (m ->> 'start_date')::date; exception when others then st := null; end;
  perform app.require(st is not null, 'Enter the date the warranty started (handover or invoice date)');
  perform app.require(st <= (now() at time zone app.tz())::date, 'The warranty start date cannot be in the future');
  begin months := (m ->> 'months')::int; exception when others then months := null; end;
  perform app.require(months between 1 and 360, 'Enter the warranty period in months');
  perform app.require(coalesce(nullif(btrim(m ->> 'product_group'), ''), '') <> '', 'Enter the item (product group)');
  insert into public.warranties (source, project_id, project_name, customer, category, owner_id, invoice_no, contract_no, start_basis,
    handover_date, invoice_date, delivery_date, tc_date, start_date, notes)
  values (src, p.id, pname, cust, cat, own, inv, con, basis,
    case when basis = 'handover' then st end, case when basis = 'invoice' then st end, case when basis = 'delivery' then st end,
    case when basis = 'tc' then st end, st, 'Entered with a warranty claim (older project) – Operations to complete the record')
  returning * into w;
  insert into public.warranty_lines (warranty_id, sort_order, product_group, brand, quantity, months, end_date)
  values (w.id, 1, btrim(m ->> 'product_group'), nullif(btrim(m ->> 'brand'), ''), nullif(m ->> 'quantity', '')::numeric, months,
    (st + make_interval(months => months))::date)
  returning id into lid;
  insert into public.warranty_log (warranty_id, kind, note)
  values (w.id, 'created', format('Warranty record created with a claim (older project) · %s · starts %s · %s months', coalesce(inv, con), to_char(st, 'DD Mon YYYY'), months));
  return jsonb_build_object('warranty_id', w.id, 'line_id', lid);
end $$;
revoke execute on function app.quick_warranty(jsonb) from public, anon, authenticated;

create or replace function public.log_warranty_claim(p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  w public.warranties;
  ln public.warranty_lines;
  r public.warranty_reports;
  c public.warranty_claims;
  today date := (now() at time zone app.tz())::date;
  inw boolean;
  via text := coalesce(nullif(p_data ->> 'reported_via', ''), 'customer_call');
  asg uuid := nullif(p_data ->> 'assignee_id', '')::uuid;
  desk boolean := app.is_warranty_desk();
begin
  perform app.require(desk or app.is_sales_person() or app.has_role('sm_projects'),
    'Only Operations, the Senior Electrical Engineer, sales persons and SM Projects raise warranty claims');
  -- Older project with no warranty record yet: the details entered with the claim create it (and its item)
  if nullif(p_data ->> 'warranty_id', '') is null and jsonb_typeof(p_data -> 'manual') = 'object' then
    p_data := p_data || app.quick_warranty(p_data -> 'manual');
  end if;
  select * into w from public.warranties where id = nullif(p_data ->> 'warranty_id', '')::uuid;
  perform app.require(w.id is not null and w.status = 'active', 'Choose the warranty (find it by invoice / contract number, customer or project)');
  perform app.require(desk or app.can_read_warranty(w.id), 'You can raise claims only on warranties of your own projects or categories');
  -- Raised by sales / SM Projects: Operations or the Senior Electrical Engineer verify it and assign the engineer
  if not desk then
    perform app.require(nullif(p_data ->> 'report_id', '') is null, 'Operations or the Senior Electrical Engineer convert reported issues');
  end if;
  if not app.has_role('senior_elec_engineer') then asg := null; end if;  -- only the Senior Electrical Engineer assigns engineers
  if nullif(p_data ->> 'line_id', '') is not null then
    select * into ln from public.warranty_lines where id = (p_data ->> 'line_id')::uuid and warranty_id = w.id;
    perform app.require(ln.id is not null, 'The line does not belong to this warranty');
    inw := ln.end_date >= today;
  else
    inw := exists (select 1 from public.warranty_lines where warranty_id = w.id and end_date >= today);
  end if;
  if nullif(p_data ->> 'report_id', '') is not null then
    select * into r from public.warranty_reports where id = (p_data ->> 'report_id')::uuid for update;
    perform app.require(r.id is not null and r.status = 'reported', 'This reported issue is already handled');
    via := 'sales_visit';
  end if;
  perform app.require(via in ('customer_call', 'customer_email', 'customer_letter', 'sales_visit', 'site_inspection', 'other'), 'Choose how it was reported');
  perform app.require(coalesce(nullif(btrim(p_data ->> 'description'), ''), r.description, '') <> '', 'Describe the failure');
  perform app.check_engineer(asg);
  insert into public.warranty_claims (warranty_id, line_id, reported_via, report_id, reported_by, description, quantity, location, in_warranty,
    assignee_id, assigned_at, needs_verification)
  values (w.id, ln.id, via, r.id, coalesce(r.sales_person_id, case when not desk then auth.uid() end),
    coalesce(nullif(btrim(p_data ->> 'description'), ''), r.description),
    coalesce(nullif(p_data ->> 'quantity', '')::numeric, r.quantity), coalesce(nullif(btrim(p_data ->> 'location'), ''), r.location), inw,
    asg, case when asg is not null then now() end, not desk)
  returning * into c;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (w.id, c.id, 'claim_logged', format('Claim %s logged (%s)%s', c.code, case when inw then 'in warranty' else 'out of warranty' end,
          coalesce(' · assigned to ' || app.display_name(asg), '')));
  if r.id is not null then
    update public.warranty_reports set status = 'converted', claim_id = c.id, handled_by = auth.uid(), handled_at = now() where id = r.id;
    perform app.notify(r.sales_person_id, 'warranty_claim_opened', 'Claim opened from your visit report', app.claim_head(c),
      'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  end if;
  perform app.notify_many(array[w.owner_id] || app.role_users('operations_exec', 'senior_elec_engineer', 'sm_projects'), 'warranty_claim_logged',
    case when desk then 'Warranty claim logged' else format('Warranty claim raised by %s – verify and assign', coalesce(app.display_name(auth.uid()), 'sales')) end
      || case when inw then '' else ' – out of warranty' end, app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id), null, not desk);
  if asg is null then
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'warranty_claim_to_assign', 'Assign an engineer to warranty claim ' || c.code,
      app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id), null, true);
  end if;
  if asg is not null then
    perform app.notify(asg, 'warranty_claim_assigned', 'Warranty claim assigned to you – inspect the site', app.claim_head(c),
      'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  end if;
  return c.id;
end $$;
