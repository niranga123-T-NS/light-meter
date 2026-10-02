-- Warranty: completion records (warranties with lines), warranty claims and warranty issues reported by sales persons.
--
-- * The Operations Executive or the Senior Electrical Engineer – Project Execution enter completion records / warranties
--   (for a project in the system or outside it – invoice or contract number required) and warranty claims.
-- * Claims are assigned to an Assistant Engineer, who records the inspection and the rectification.
-- * The Senior Electrical Engineer decides covered / chargeable / rejected; covering an out-of-warranty claim
--   (goodwill) needs SM Projects approval.
-- * Sales persons report warranty issues found on visits, follow their customers' warranties and claims (read only),
--   quote chargeable repairs and are alerted 90 days before a warranty ends (extended warranty / maintenance contract).
-- Alerts: see public.warranty_tick.

create or replace function app.team_for_role(r public.app_role) returns public.team
language sql immutable as $$
  select case
    when r = 'gm' then 'management'
    when r in ('sm_projects','asm_building','asm_infra') then 'sales'
    when r in ('design_manager','lighting_designer','lighting_engineer') then 'design'
    when r in ('sm_estimation','am_estimation','estimation_exec') then 'estimation'
    when r = 'operations_exec' then 'operations'
    when r in ('senior_elec_engineer','assistant_engineer') then 'execution'
    else 'it' end::public.team
$$;

-- Who records warranties and claims
create or replace function app.is_warranty_desk() returns boolean
language sql stable as $$ select app.has_role('operations_exec', 'senior_elec_engineer') $$;
-- Who sees every warranty
create or replace function app.sees_all_warranties() returns boolean
language sql stable as $$ select app.has_role('gm', 'sm_projects', 'operations_exec', 'senior_elec_engineer', 'assistant_engineer') $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.warranties (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  source text not null check (source in ('system', 'outside')),
  project_id uuid references public.projects (id),
  project_name text not null,
  customer text not null,
  organization_id uuid references public.organizations (id),
  site text,
  site_contact text,
  category public.project_type not null,
  owner_id uuid references public.profiles (id),
  invoice_no text,
  contract_no text,
  currency public.currency not null default 'LKR',
  contract_value numeric(16, 2),
  start_basis text not null default 'handover' check (start_basis in ('delivery', 'tc', 'handover', 'invoice')),
  delivery_date date,
  tc_date date,
  handover_date date,
  invoice_date date,
  start_date date not null,
  project_engineer_id uuid references public.profiles (id),
  notes text,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warranty_ref check (coalesce(invoice_no, contract_no) is not null),
  constraint warranty_project check (source = 'outside' or project_id is not null)
);
create index on public.warranties (project_id);
create index on public.warranties (owner_id);
create index on public.warranties (lower(customer));

create table public.warranty_lines (
  id uuid primary key default gen_random_uuid(),
  warranty_id uuid not null references public.warranties (id) on delete cascade,
  sort_order int not null default 0,
  product_group text not null,
  brand text,
  quantity numeric(12, 2),
  months int not null check (months > 0 and months <= 360),
  end_date date not null,
  supplier_end date,
  alerted_90 boolean not null default false,
  alerted_30 boolean not null default false
);
create index on public.warranty_lines (warranty_id);

create table public.warranty_reports (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  sales_person_id uuid not null default auth.uid() references public.profiles (id),
  visit_id uuid references public.visits (id),
  organization_id uuid references public.organizations (id),
  customer text not null,
  project_id uuid references public.projects (id),
  project_name text,
  description text not null,
  quantity numeric(12, 2),
  location text,
  site_contact text,
  status text not null default 'reported' check (status in ('reported', 'converted', 'dismissed')),
  claim_id uuid,
  handled_by uuid references public.profiles (id),
  handled_at timestamptz,
  dismiss_reason text,
  reminded boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.warranty_reports (status, created_at);

create table public.warranty_claims (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  warranty_id uuid not null references public.warranties (id),
  line_id uuid references public.warranty_lines (id) on delete set null,
  reported_via text not null check (reported_via in ('customer_call', 'customer_email', 'customer_letter', 'sales_visit', 'site_inspection', 'other')),
  report_id uuid references public.warranty_reports (id),
  reported_by uuid references public.profiles (id),          -- sales person who reported it from a visit
  description text not null,
  quantity numeric(12, 2),
  location text,
  logged_at timestamptz not null default now(),
  logged_by uuid default auth.uid() references public.profiles (id),
  in_warranty boolean not null,
  assignee_id uuid references public.profiles (id),
  assigned_at timestamptz,
  inspected_on date,
  inspection_findings text,
  decision text check (decision in ('covered', 'chargeable', 'rejected')),
  decision_note text,
  decided_at timestamptz,
  decided_by uuid references public.profiles (id),
  goodwill_status text check (goodwill_status in ('pending', 'approved', 'rejected')),
  supplier_status text not null default 'none' check (supplier_status in ('none', 'raised', 'resolved', 'rejected')),
  supplier_ref text,
  supplier_raised_on date,
  supplier_resolved_on date,
  recovered_amount numeric(16, 2) not null default 0,
  cost_amount numeric(16, 2) not null default 0,
  rectified_on date,
  rectification_note text,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  closed_on date,
  close_note text,
  inspect_alert_level int not null default 0,
  age_alert_level int not null default 0,
  supplier_alerted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.warranty_claims (warranty_id);
create index on public.warranty_claims (status, assignee_id);
alter table public.warranty_reports add constraint warranty_reports_claim_fk foreign key (claim_id) references public.warranty_claims (id);

create table public.warranty_log (
  id bigint generated always as identity primary key,
  warranty_id uuid references public.warranties (id) on delete cascade,
  claim_id uuid references public.warranty_claims (id) on delete cascade,
  at timestamptz not null default now(),
  user_id uuid default auth.uid() references public.profiles (id),
  kind text not null,
  note text
);
create index on public.warranty_log (warranty_id);
create index on public.warranty_log (claim_id);

-- When a project is marked completed – a completion record is expected within 7 days
create table public.project_completions (
  project_id uuid primary key references public.projects (id),
  completed_at timestamptz not null default now(),
  alerted boolean not null default false
);

create or replace function app.projects_completed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.project_completions (project_id) values (new.id)
    on conflict (project_id) do update set completed_at = now(), alerted = false;
  end if;
  return new;
end $$;
create trigger projects_completed after update of status on public.projects for each row execute function app.projects_completed();

create or replace function app.warranties_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.code := coalesce(new.code, app.next_code('WAR')); end if;
  if new.organization_id is null then
    select id into new.organization_id from public.organizations
     where merged_into is null and name_norm = app.normalize_name(new.customer) limit 1;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger warranties_before before insert or update on public.warranties for each row execute function app.warranties_before();
create trigger audit_warranties after insert or update on public.warranties for each row execute function app.audit();

create or replace function app.warranty_claims_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.code := coalesce(new.code, app.next_code('WCL')); end if;
  new.updated_at := now();
  return new;
end $$;
create trigger warranty_claims_before before insert or update on public.warranty_claims for each row execute function app.warranty_claims_before();
create trigger audit_warranty_claims after insert or update on public.warranty_claims for each row execute function app.audit();

create or replace function app.warranty_reports_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.code := coalesce(new.code, app.next_code('WIR')); end if;
  return new;
end $$;
create trigger warranty_reports_before before insert on public.warranty_reports for each row execute function app.warranty_reports_before();

-- ---------------------------------------------------------------------------
-- Visibility: Operations, Senior Electrical Engineer, Assistant Engineers, SM Projects and GM / DGM see all;
-- a sales person sees the warranties they own or of the categories they handle, and the issues they reported.
-- ---------------------------------------------------------------------------
create or replace function app.can_read_warranty(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.sees_all_warranties() or exists (
    select 1 from public.warranties w where w.id = p_id
       and (w.owner_id = auth.uid() or (app.is_sales_person() and w.category = any (app.my_project_types()))))
$$;

alter table public.warranties enable row level security;
alter table public.warranty_lines enable row level security;
alter table public.warranty_claims enable row level security;
alter table public.warranty_reports enable row level security;
alter table public.warranty_log enable row level security;
alter table public.project_completions enable row level security;
create policy warranties_read on public.warranties for select to authenticated using (app.can_read_warranty(id));
create policy warranty_lines_read on public.warranty_lines for select to authenticated using (app.can_read_warranty(warranty_id));
create policy warranty_claims_read on public.warranty_claims for select to authenticated
  using (app.can_read_warranty(warranty_id) or reported_by = auth.uid());
create policy warranty_reports_read on public.warranty_reports for select to authenticated
  using (sales_person_id = auth.uid() or app.sees_all_warranties());
create policy warranty_log_read on public.warranty_log for select to authenticated
  using ((warranty_id is not null and app.can_read_warranty(warranty_id))
      or (claim_id is not null and exists (select 1 from public.warranty_claims c where c.id = claim_id)));
create policy project_completions_read on public.project_completions for select to authenticated using (app.sees_all_warranties());
grant select on public.warranties, public.warranty_lines, public.warranty_claims, public.warranty_reports, public.warranty_log,
  public.project_completions to authenticated;

create or replace function app.warranty_url(p_id uuid) returns text language sql immutable as $$ select '/warranty/' || p_id $$;
create or replace function app.claim_url(p_id uuid) returns text language sql immutable as $$ select '/warranty/claims/' || p_id $$;

create or replace function app.claim_head(c public.warranty_claims) returns text language sql stable as $$
  select format('%s – %s · %s · %s', c.code, w.project_name, w.customer, left(c.description, 120))
    from public.warranties w where w.id = c.warranty_id
$$;

-- ---------------------------------------------------------------------------
-- Completion record / warranty (Operations Executive, Senior Electrical Engineer)
-- p_data: source, project_id, project_name, customer, site, site_contact, category, owner_id, invoice_no, contract_no,
--         currency, contract_value, start_basis, delivery_date, tc_date, handover_date, invoice_date, project_engineer_id, notes
-- p_lines: [{id?, product_group, brand, quantity, months, supplier_end}]
-- ---------------------------------------------------------------------------
create or replace function public.save_warranty(p_id uuid, p_data jsonb, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  w public.warranties;
  p public.projects;
  wid uuid;
  src text := p_data ->> 'source';
  basis text := coalesce(nullif(p_data ->> 'start_basis', ''), 'handover');
  d_del date := nullif(p_data ->> 'delivery_date', '')::date;
  d_tc date := nullif(p_data ->> 'tc_date', '')::date;
  d_ho date := nullif(p_data ->> 'handover_date', '')::date;
  d_inv date := nullif(p_data ->> 'invoice_date', '')::date;
  st date;
  cat public.project_type;
  own uuid;
  pname text;
  cust text;
  eng uuid := nullif(p_data ->> 'project_engineer_id', '')::uuid;
  l jsonb;
  keep uuid[] := '{}';
  lid uuid;
  n int := 0;
begin
  perform app.require(app.is_warranty_desk(), 'Only the Operations Executive or the Senior Electrical Engineer record warranties');
  perform app.require(src in ('system', 'outside'), 'Choose whether the project is in the system');
  perform app.require(coalesce(btrim(p_data ->> 'invoice_no'), '') <> '' or coalesce(btrim(p_data ->> 'contract_no'), '') <> '',
    'Enter the invoice number or the contract number');
  perform app.require(basis in ('delivery', 'tc', 'handover', 'invoice'), 'Choose the warranty start basis');
  st := case basis when 'delivery' then d_del when 'tc' then d_tc when 'handover' then d_ho else d_inv end;
  perform app.require(st is not null, format('Enter the %s date – the warranty starts from it',
    case basis when 'delivery' then 'delivery' when 'tc' then 'testing & commissioning' when 'handover' then 'handover' else 'invoice' end));
  perform app.require(p_data ->> 'currency' is null or p_data ->> 'currency' in ('LKR', 'USD'), 'Currency must be LKR or USD');
  if src = 'system' then
    select * into p from public.projects where id = nullif(p_data ->> 'project_id', '')::uuid;
    perform app.require(p.id is not null, 'Choose the project');
    cat := p.project_type;
    pname := p.name;
    cust := coalesce(nullif(btrim(p_data ->> 'customer'), ''), (select name from public.organizations where id = p.organization_id));
    own := coalesce(nullif(p_data ->> 'owner_id', '')::uuid, p.owner_id);
  else
    perform app.require(coalesce(btrim(p_data ->> 'project_name'), '') <> '', 'Project name is required');
    perform app.require(coalesce(btrim(p_data ->> 'customer'), '') <> '', 'Customer is required');
    perform app.require(nullif(p_data ->> 'category', '') is not null, 'Choose the category – it decides the owner');
    cat := (p_data ->> 'category')::public.project_type;
    pname := btrim(p_data ->> 'project_name');
    cust := btrim(p_data ->> 'customer');
    own := coalesce(nullif(p_data ->> 'owner_id', '')::uuid, app.bond_owner_for(cat));
  end if;
  perform app.require(jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) > 0, 'Add at least one warranty line');
  perform app.require(eng is null or exists (select 1 from public.profiles where id = eng and role in ('assistant_engineer', 'senior_elec_engineer')),
    'The project engineer must be an Assistant Engineer or the Senior Electrical Engineer');

  if p_id is null then
    insert into public.warranties (source, project_id, project_name, customer, site, site_contact, category, owner_id, invoice_no, contract_no,
      currency, contract_value, start_basis, delivery_date, tc_date, handover_date, invoice_date, start_date, project_engineer_id, notes)
    values (src, case when src = 'system' then p.id end, pname, cust, nullif(btrim(p_data ->> 'site'), ''), nullif(btrim(p_data ->> 'site_contact'), ''),
      cat, own, nullif(btrim(p_data ->> 'invoice_no'), ''), nullif(btrim(p_data ->> 'contract_no'), ''),
      coalesce(nullif(p_data ->> 'currency', ''), 'LKR')::public.currency, nullif(p_data ->> 'contract_value', '')::numeric, basis,
      d_del, d_tc, d_ho, d_inv, st, eng, nullif(btrim(p_data ->> 'notes'), ''))
    returning * into w;
    insert into public.warranty_log (warranty_id, kind, note) values (w.id, 'created', 'Completion record entered');
    perform app.notify(own, 'warranty_recorded', 'Warranty recorded for your project',
      format('%s – %s · %s · starts %s', pname, cust, w.code, to_char(st, 'DD Mon YYYY')), 'normal', 'warranty', w.id, app.warranty_url(w.id));
  else
    select * into w from public.warranties where id = p_id for update;
    perform app.require(w.id is not null and w.status = 'active', 'Warranty not found or cancelled');
    update public.warranties set source = src, project_id = case when src = 'system' then p.id end, project_name = pname, customer = cust,
      organization_id = case when lower(cust) = lower(w.customer) and src = w.source then organization_id end,
      site = nullif(btrim(p_data ->> 'site'), ''), site_contact = nullif(btrim(p_data ->> 'site_contact'), ''), category = cat, owner_id = own,
      invoice_no = nullif(btrim(p_data ->> 'invoice_no'), ''), contract_no = nullif(btrim(p_data ->> 'contract_no'), ''),
      currency = coalesce(nullif(p_data ->> 'currency', ''), 'LKR')::public.currency, contract_value = nullif(p_data ->> 'contract_value', '')::numeric,
      start_basis = basis, delivery_date = d_del, tc_date = d_tc, handover_date = d_ho, invoice_date = d_inv, start_date = st,
      project_engineer_id = eng, notes = nullif(btrim(p_data ->> 'notes'), '')
    where id = w.id returning * into w;
    insert into public.warranty_log (warranty_id, kind, note) values (w.id, 'edited', 'Details updated');
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    perform app.require(coalesce(btrim(l ->> 'product_group'), '') <> '', format('Line %s: enter the product group', n));
    perform app.require(coalesce((l ->> 'months')::int, 0) > 0, format('Line %s: enter the warranty period', n));
    lid := nullif(l ->> 'id', '')::uuid;
    if lid is not null and exists (select 1 from public.warranty_lines where id = lid and warranty_id = w.id) then
      update public.warranty_lines set sort_order = n, product_group = btrim(l ->> 'product_group'), brand = nullif(btrim(l ->> 'brand'), ''),
        quantity = nullif(l ->> 'quantity', '')::numeric, months = (l ->> 'months')::int,
        end_date = (w.start_date + make_interval(months => (l ->> 'months')::int))::date,
        supplier_end = nullif(l ->> 'supplier_end', '')::date,
        alerted_90 = case when end_date = (w.start_date + make_interval(months => (l ->> 'months')::int))::date then alerted_90 else false end,
        alerted_30 = case when end_date = (w.start_date + make_interval(months => (l ->> 'months')::int))::date then alerted_30 else false end
      where id = lid;
    else
      insert into public.warranty_lines (warranty_id, sort_order, product_group, brand, quantity, months, end_date, supplier_end)
      values (w.id, n, btrim(l ->> 'product_group'), nullif(btrim(l ->> 'brand'), ''), nullif(l ->> 'quantity', '')::numeric,
        (l ->> 'months')::int, (w.start_date + make_interval(months => (l ->> 'months')::int))::date, nullif(l ->> 'supplier_end', '')::date)
      returning id into lid;
    end if;
    keep := keep || lid;
  end loop;
  delete from public.warranty_lines where warranty_id = w.id and not (id = any (keep));
  return w.id;
end $$;

create or replace function public.cancel_warranty(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.is_warranty_desk(), 'Not allowed');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(not exists (select 1 from public.warranty_claims where warranty_id = p_id and status = 'open'), 'Close its open claims first');
  update public.warranties set status = 'cancelled' where id = p_id and status = 'active';
  insert into public.warranty_log (warranty_id, kind, note) values (p_id, 'cancelled', btrim(p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Sales person reports a warranty issue found on a visit
-- ---------------------------------------------------------------------------
create or replace function public.report_warranty_issue(p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v public.visits; rid uuid; cust text; org uuid; prj uuid;
begin
  perform app.require(app.is_sales_person() or app.has_role('sm_projects'), 'Only sales report warranty issues from visits');
  perform app.require(coalesce(btrim(p_data ->> 'description'), '') <> '', 'Describe what you saw');
  if nullif(p_data ->> 'visit_id', '') is not null then
    select * into v from public.visits where id = (p_data ->> 'visit_id')::uuid;
    perform app.require(v.id is not null and v.sales_person_id = auth.uid(), 'Report it from your own visit');
    org := v.organization_id; prj := v.project_id;
  end if;
  org := coalesce(org, nullif(p_data ->> 'organization_id', '')::uuid);
  prj := coalesce(prj, nullif(p_data ->> 'project_id', '')::uuid);
  cust := coalesce(nullif(btrim(p_data ->> 'customer'), ''), (select name from public.organizations where id = org));
  perform app.require(cust is not null, 'Enter the customer');
  insert into public.warranty_reports (visit_id, organization_id, customer, project_id, project_name, description, quantity, location, site_contact)
  values (v.id, org, cust, prj, coalesce(nullif(btrim(p_data ->> 'project_name'), ''), (select name from public.projects where id = prj)),
    btrim(p_data ->> 'description'), nullif(p_data ->> 'quantity', '')::numeric, nullif(btrim(p_data ->> 'location'), ''),
    nullif(btrim(p_data ->> 'site_contact'), ''))
  returning id into rid;
  perform app.notify_many(app.role_users('operations_exec', 'senior_elec_engineer'), 'warranty_issue_reported',
    'Warranty issue reported from a visit – enter the claim',
    format('%s%s · %s · reported by %s', cust, coalesce(' – ' || (select project_name from public.warranty_reports where id = rid), ''),
           left(btrim(p_data ->> 'description'), 140), coalesce(app.display_name(auth.uid()), '—')),
    'normal', 'warranty_report', rid, '/warranty?tab=reports');
  return rid;
end $$;

create or replace function public.dismiss_warranty_report(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.warranty_reports;
begin
  perform app.require(app.is_warranty_desk(), 'Not allowed');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select * into r from public.warranty_reports where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'reported', 'This report is already handled');
  update public.warranty_reports set status = 'dismissed', dismiss_reason = btrim(p_reason), handled_by = auth.uid(), handled_at = now() where id = r.id;
  perform app.notify(r.sales_person_id, 'warranty_issue_closed', 'Your warranty issue report was closed',
    format('%s · %s', r.customer, btrim(p_reason)), 'normal', 'warranty_report', r.id, '/warranty');
end $$;

-- ---------------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------------
create or replace function app.check_engineer(p_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(p_id is null or exists (select 1 from public.profiles where id = p_id and active and role in ('assistant_engineer', 'senior_elec_engineer')),
    'Assign it to an Assistant Engineer or the Senior Electrical Engineer');
end $$;

-- p_data: warranty_id, line_id, reported_via, report_id, description, quantity, location, assignee_id
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
begin
  perform app.require(app.is_warranty_desk(), 'Only the Operations Executive or the Senior Electrical Engineer enter warranty claims');
  select * into w from public.warranties where id = nullif(p_data ->> 'warranty_id', '')::uuid;
  perform app.require(w.id is not null and w.status = 'active', 'Choose the warranty (find it by invoice / contract number, customer or project)');
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
    assignee_id, assigned_at)
  values (w.id, ln.id, via, r.id, r.sales_person_id, coalesce(nullif(btrim(p_data ->> 'description'), ''), r.description),
    coalesce(nullif(p_data ->> 'quantity', '')::numeric, r.quantity), coalesce(nullif(btrim(p_data ->> 'location'), ''), r.location), inw,
    asg, case when asg is not null then now() end)
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
    'Warranty claim logged' || case when inw then '' else ' – out of warranty' end, app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  if asg is not null then
    perform app.notify(asg, 'warranty_claim_assigned', 'Warranty claim assigned to you – inspect the site', app.claim_head(c),
      'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  end if;
  return c.id;
end $$;

create or replace function app.claim_for_update(p_id uuid) returns public.warranty_claims
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims;
begin
  select * into c from public.warranty_claims where id = p_id for update;
  perform app.require(c.id is not null, 'Claim not found');
  perform app.require(c.status = 'open', 'This claim is closed');
  return c;
end $$;

create or replace function public.assign_warranty_claim(p_id uuid, p_assignee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims;
begin
  perform app.require(app.is_warranty_desk(), 'Only the Operations Executive or the Senior Electrical Engineer assign claims');
  c := app.claim_for_update(p_id);
  perform app.require(p_assignee is not null, 'Choose the engineer');
  perform app.check_engineer(p_assignee);
  update public.warranty_claims set assignee_id = p_assignee, assigned_at = now(), inspect_alert_level = 0 where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note) values (c.warranty_id, c.id, 'assigned', 'Assigned to ' || app.display_name(p_assignee));
  perform app.notify(p_assignee, 'warranty_claim_assigned', 'Warranty claim assigned to you – inspect the site', app.claim_head(c),
    'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;

create or replace function app.can_work_claim(c public.warranty_claims) returns boolean
language sql stable as $$ select app.is_warranty_desk() or c.assignee_id = auth.uid() $$;

create or replace function public.record_claim_inspection(p_id uuid, p_on date, p_findings text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims;
begin
  c := app.claim_for_update(p_id);
  perform app.require(app.can_work_claim(c), 'Only the assigned engineer, Operations or the Senior Electrical Engineer update this claim');
  perform app.require(p_on is not null and p_on <= (now() at time zone app.tz())::date, 'Enter the inspection date (not in the future)');
  perform app.require(coalesce(btrim(p_findings), '') <> '', 'Enter the findings');
  update public.warranty_claims set inspected_on = p_on, inspection_findings = btrim(p_findings) where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'inspected', format('Inspected %s: %s', to_char(p_on, 'DD Mon YYYY'), btrim(p_findings)));
  perform app.notify_many(app.role_users('senior_elec_engineer'), 'warranty_claim_inspected', 'Claim inspected – decide covered / chargeable / rejected',
    app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;

-- Senior Electrical Engineer decides. Covering an out-of-warranty claim (goodwill) needs SM Projects approval.
create or replace function public.decide_warranty_claim(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims; w public.warranties; goodwill boolean;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer decides warranty claims');
  c := app.claim_for_update(p_id);
  perform app.require(p_decision in ('covered', 'chargeable', 'rejected'), 'Choose covered, chargeable or rejected');
  perform app.require(c.inspected_on is not null or p_decision = 'rejected', 'Record the site inspection first');
  perform app.require(p_decision = 'covered' or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  perform app.require(c.goodwill_status is distinct from 'pending', 'Waiting for SM Projects on the goodwill request');
  select * into w from public.warranties where id = c.warranty_id;
  goodwill := p_decision = 'covered' and not c.in_warranty;
  update public.warranty_claims set decision = p_decision, decision_note = nullif(btrim(p_note), ''), decided_at = now(), decided_by = auth.uid(),
    goodwill_status = case when goodwill then 'pending' end,
    status = case when p_decision = 'rejected' then 'closed' else status end,
    closed_on = case when p_decision = 'rejected' then (now() at time zone app.tz())::date end,
    close_note = case when p_decision = 'rejected' then 'Rejected: ' || btrim(p_note) end
  where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'decided', concat_ws(' · ', initcap(p_decision) || case when goodwill then ' (goodwill – SM Projects approval)' else '' end,
          nullif(btrim(p_note), '')));
  if goodwill then
    perform app.create_approval('warranty_goodwill', 'warranty_claim', c.id, null,
      format('Goodwill warranty cover – %s (%s)', w.project_name, c.code),
      format('%s · out of warranty · %s%s', w.customer, left(c.description, 160), coalesce(' · ' || btrim(p_note), '')),
      array['sm_projects']::public.app_role[], '{}'::jsonb);
  end if;
  perform app.notify_many(array[w.owner_id, c.reported_by] || app.role_users('operations_exec'), 'warranty_claim_decided',
    format('Warranty claim %s', case p_decision when 'covered' then case when goodwill then 'to be covered as goodwill (SM Projects approval)' else 'covered by warranty' end
                                 when 'chargeable' then 'chargeable – quote the repair' else 'rejected' end),
    app.claim_head(c) || coalesce(' · ' || btrim(p_note), ''), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;

create or replace function public.raise_supplier_claim(p_id uuid, p_ref text, p_on date) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims;
begin
  perform app.require(app.is_warranty_desk(), 'Not allowed');
  c := app.claim_for_update(p_id);
  perform app.require(c.supplier_status in ('none', 'rejected'), 'A supplier claim is already open');
  perform app.require(p_on is not null, 'Enter the date raised');
  update public.warranty_claims set supplier_status = 'raised', supplier_ref = nullif(btrim(p_ref), ''), supplier_raised_on = p_on,
    supplier_resolved_on = null, supplier_alerted = false where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'supplier_raised', concat_ws(' · ', 'Supplier claim raised ' || to_char(p_on, 'DD Mon YYYY'), nullif(btrim(p_ref), '')));
end $$;

create or replace function public.resolve_supplier_claim(p_id uuid, p_result text, p_recovered numeric, p_on date, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims; w public.warranties;
begin
  perform app.require(app.is_warranty_desk(), 'Not allowed');
  select * into c from public.warranty_claims where id = p_id for update;
  perform app.require(c.id is not null and c.supplier_status = 'raised', 'No open supplier claim');
  perform app.require(p_result in ('resolved', 'rejected'), 'Choose resolved or rejected');
  perform app.require(p_on is not null, 'Enter the date');
  perform app.require(coalesce(p_recovered, 0) >= 0, 'The recovered amount cannot be negative');
  select * into w from public.warranties where id = c.warranty_id;
  update public.warranty_claims set supplier_status = p_result, supplier_resolved_on = p_on,
    recovered_amount = case when p_result = 'resolved' then coalesce(p_recovered, 0) else recovered_amount end where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'supplier_' || p_result, concat_ws(' · ', 'Supplier claim ' || p_result || ' ' || to_char(p_on, 'DD Mon YYYY'),
          case when p_result = 'resolved' and coalesce(p_recovered, 0) > 0 then 'recovered ' || app.fmt_money(p_recovered, w.currency) end,
          nullif(btrim(p_note), '')));
end $$;

create or replace function public.record_claim_rectified(p_id uuid, p_on date, p_cost numeric, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims; w public.warranties;
begin
  c := app.claim_for_update(p_id);
  perform app.require(app.can_work_claim(c), 'Only the assigned engineer, Operations or the Senior Electrical Engineer update this claim');
  perform app.require(c.decision in ('covered', 'chargeable'), 'The claim must be decided (covered or chargeable) first');
  perform app.require(c.goodwill_status is distinct from 'pending', 'Waiting for SM Projects on the goodwill request');
  perform app.require(p_on is not null and p_on <= (now() at time zone app.tz())::date, 'Enter the date (not in the future)');
  perform app.require(coalesce(p_cost, 0) >= 0, 'The cost cannot be negative');
  select * into w from public.warranties where id = c.warranty_id;
  update public.warranty_claims set rectified_on = p_on, cost_amount = coalesce(p_cost, 0), rectification_note = nullif(btrim(p_note), '') where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'rectified', concat_ws(' · ', 'Rectified ' || to_char(p_on, 'DD Mon YYYY'),
          case when coalesce(p_cost, 0) > 0 then 'cost ' || app.fmt_money(p_cost, w.currency) end, nullif(btrim(p_note), '')));
  perform app.notify_many(app.role_users('operations_exec', 'senior_elec_engineer'), 'warranty_claim_rectified', 'Claim rectified – confirm with the customer and close',
    app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;

create or replace function public.close_warranty_claim(p_id uuid, p_status text, p_on date, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims; w public.warranties;
begin
  perform app.require(app.is_warranty_desk(), 'Only the Operations Executive or the Senior Electrical Engineer close claims');
  c := app.claim_for_update(p_id);
  perform app.require(p_status in ('closed', 'cancelled'), 'Choose closed or cancelled');
  perform app.require(p_status = 'cancelled' or c.rectified_on is not null, 'Record the rectification first');
  perform app.require(p_status = 'closed' or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  perform app.require(c.supplier_status <> 'raised' or p_status = 'cancelled', 'The supplier claim is still open – resolve it first');
  perform app.require(p_on is not null, 'Enter the date');
  select * into w from public.warranties where id = c.warranty_id;
  update public.warranty_claims set status = p_status, closed_on = p_on, close_note = nullif(btrim(p_note), '') where id = c.id;
  if p_status = 'cancelled' then
    update public.approvals set status = 'cancelled', decided_at = now()
     where kind = 'warranty_goodwill' and entity_id = c.id and status = 'pending';
  end if;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, p_status, concat_ws(' · ', initcap(p_status) || ' ' || to_char(p_on, 'DD Mon YYYY'), nullif(btrim(p_note), '')));
  perform app.notify_many(array[w.owner_id, c.reported_by], 'warranty_claim_closed', 'Warranty claim ' || p_status || ' – follow up with the customer',
    app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;

-- ---------------------------------------------------------------------------
-- Alerts (every 15 minutes from 08:00)
--   * line ends in 90 days → owner (offer extended warranty / maintenance contract); 30 days → owner, Operations, Senior Elec. Engineer
--   * no inspection 3 working days after logging / assignment → engineer, Senior Elec. Engineer, Operations; 5 → + SM Projects
--   * claim open 14 days → SM Projects; 30 days → GM / DGM
--   * supplier claim with no answer in 30 days → Operations, Senior Elec. Engineer, SM Projects
--   * issue reported from a visit not handled in 2 working days → Operations, Senior Elec. Engineer
--   * project marked completed with no completion record in 7 days → Operations, Senior Elec. Engineer
--   * Monday summary → SM Projects, GM / DGM, Senior Elec. Engineer
-- ---------------------------------------------------------------------------
create or replace function public.warranty_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  n int := 0;
  desk uuid[] := app.role_users('operations_exec', 'senior_elec_engineer');
  smp uuid[] := app.role_users('sm_projects');
  r record;
  cl public.warranty_claims;
  wd numeric;
  lvl int;
  open_n int; overdue_n int; expiring_n int; gap_n int; reported_n int;
begin
  if loc::time < time '08:00' then return 0; end if;

  for r in select l.*, w.owner_id, w.project_name, w.customer, w.code from public.warranty_lines l
             join public.warranties w on w.id = l.warranty_id
            where w.status = 'active' and l.end_date >= today and l.end_date - today <= 90 and not (l.alerted_90 and l.alerted_30) loop
    if r.end_date - today <= 30 and not r.alerted_30 then
      perform app.notify_many(array[r.owner_id] || desk, 'warranty_expiring', format('Warranty ends in %s days', r.end_date - today),
        format('%s – %s · %s%s ends %s · offer an extended warranty or a maintenance contract', r.project_name, r.customer, r.product_group,
               coalesce(' (' || r.brand || ')', ''), to_char(r.end_date, 'DD Mon YYYY')), 'normal', 'warranty', r.warranty_id, app.warranty_url(r.warranty_id));
      update public.warranty_lines set alerted_90 = true, alerted_30 = true where id = r.id; n := n + 1;
    elsif r.end_date - today > 30 and not r.alerted_90 then
      perform app.notify(r.owner_id, 'warranty_expiring', format('Warranty ends in %s days – sales opportunity', r.end_date - today),
        format('%s – %s · %s%s ends %s · offer an extended warranty or a maintenance contract', r.project_name, r.customer, r.product_group,
               coalesce(' (' || r.brand || ')', ''), to_char(r.end_date, 'DD Mon YYYY')), 'normal', 'warranty', r.warranty_id, app.warranty_url(r.warranty_id));
      update public.warranty_lines set alerted_90 = true where id = r.id; n := n + 1;
    end if;
  end loop;

  for cl in select * from public.warranty_claims where status = 'open' loop
    -- Site inspection
    if cl.inspected_on is null then
      wd := app.work_minutes_between(coalesce(cl.assigned_at, cl.logged_at), p_at) / app.working_minutes_per_day();
      lvl := case when wd >= 5 then 2 when wd >= 3 then 1 else 0 end;
      if lvl > cl.inspect_alert_level then
        perform app.notify_many(array[cl.assignee_id] || desk || case when lvl >= 2 then smp else '{}'::uuid[] end, 'warranty_inspection_overdue',
          format('Warranty claim not inspected after %s working days', floor(wd)), app.claim_head(cl)
            || coalesce(' · engineer ' || app.display_name(cl.assignee_id), ' · not assigned'),
          'normal', 'warranty_claim', cl.id, app.claim_url(cl.id));
        update public.warranty_claims set inspect_alert_level = lvl where id = cl.id; n := n + 1;
      end if;
    end if;
    -- Age
    lvl := case when today - (cl.logged_at at time zone app.tz())::date >= 30 then 2 when today - (cl.logged_at at time zone app.tz())::date >= 14 then 1 else 0 end;
    if lvl > cl.age_alert_level then
      perform app.notify_many(smp || desk || case when lvl >= 2 then app.role_users('gm') else '{}'::uuid[] end, 'warranty_claim_overdue',
        format('Warranty claim open %s days', today - (cl.logged_at at time zone app.tz())::date), app.claim_head(cl),
        case when lvl >= 2 then 'critical'::public.priority else 'normal'::public.priority end, 'warranty_claim', cl.id, app.claim_url(cl.id));
      update public.warranty_claims set age_alert_level = lvl where id = cl.id; n := n + 1;
    end if;
    -- Supplier claim
    if cl.supplier_status = 'raised' and not cl.supplier_alerted and today - cl.supplier_raised_on >= 30 then
      perform app.notify_many(desk || smp, 'warranty_supplier_overdue', 'Supplier has not answered the warranty claim in 30 days',
        app.claim_head(cl) || coalesce(' · ref ' || cl.supplier_ref, ''), 'normal', 'warranty_claim', cl.id, app.claim_url(cl.id));
      update public.warranty_claims set supplier_alerted = true where id = cl.id; n := n + 1;
    end if;
  end loop;

  -- Issues reported from visits not yet handled
  for r in select * from public.warranty_reports where status = 'reported' and not reminded loop
    if app.work_minutes_between(r.created_at, p_at) / app.working_minutes_per_day() >= 2 then
      perform app.notify_many(desk, 'warranty_issue_reported', 'Reported warranty issue waiting 2 working days – enter the claim',
        format('%s · %s · reported by %s', r.customer, left(r.description, 140), coalesce(app.display_name(r.sales_person_id), '—')),
        'normal', 'warranty_report', r.id, '/warranty?tab=reports');
      update public.warranty_reports set reminded = true where id = r.id; n := n + 1;
    end if;
  end loop;

  -- Completed projects without a completion record
  for r in select pc.project_id, p.name, p.code from public.project_completions pc join public.projects p on p.id = pc.project_id
            where not pc.alerted and pc.completed_at <= p_at - interval '7 days'
              and not exists (select 1 from public.warranties w where w.project_id = pc.project_id and w.status = 'active') loop
    perform app.notify_many(desk, 'warranty_completion_due', 'Project completed – enter its completion record',
      format('%s (%s) was marked completed 7 days ago and has no completion record / warranty yet', r.name, r.code),
      'normal', 'project', r.project_id, '/warranty/edit?project=' || r.project_id);
    update public.project_completions set alerted = true where project_id = r.project_id; n := n + 1;
  end loop;

  -- Monday summary
  if extract(isodow from loc) = 1 then
    select count(*), count(*) filter (where today - (logged_at at time zone app.tz())::date >= 14) into open_n, overdue_n
      from public.warranty_claims where status = 'open';
    select count(distinct l.warranty_id) into expiring_n from public.warranty_lines l join public.warranties w on w.id = l.warranty_id
     where w.status = 'active' and l.end_date between today and today + 90;
    select count(*) into gap_n from public.warranty_lines l join public.warranties w on w.id = l.warranty_id
     where w.status = 'active' and l.supplier_end is not null and l.supplier_end < l.end_date and l.end_date >= today;
    select count(*) into reported_n from public.warranty_reports where status = 'reported';
    if open_n + expiring_n + gap_n + reported_n > 0 then
      perform app.notify_many(smp || app.role_users('gm', 'senior_elec_engineer'), 'warranty_weekly', 'Warranty: weekly summary',
        format('%s open claims (%s over 14 days) · %s warranties ending in 90 days · %s lines where the supplier warranty ends first · %s reported issues waiting',
               open_n, overdue_n, expiring_n, gap_n, reported_n), 'normal', null, null, '/warranty', format('warrantyweek:%s', today), false);
      n := n + 1;
    end if;
  end if;
  return n;
end $$;
revoke execute on function public.warranty_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.warranty_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('warranty-tick', '*/15 * * * *', 'select public.warranty_tick()');
  end if;
end $$;

revoke execute on function public.save_warranty(uuid, jsonb, jsonb), public.cancel_warranty(uuid, text), public.report_warranty_issue(jsonb),
  public.dismiss_warranty_report(uuid, text), public.log_warranty_claim(jsonb), public.assign_warranty_claim(uuid, uuid),
  public.record_claim_inspection(uuid, date, text), public.decide_warranty_claim(uuid, text, text), public.raise_supplier_claim(uuid, text, date),
  public.resolve_supplier_claim(uuid, text, numeric, date, text), public.record_claim_rectified(uuid, date, numeric, text),
  public.close_warranty_claim(uuid, text, date, text) from public, anon;
grant execute on function public.save_warranty(uuid, jsonb, jsonb), public.cancel_warranty(uuid, text), public.report_warranty_issue(jsonb),
  public.dismiss_warranty_report(uuid, text), public.log_warranty_claim(jsonb), public.assign_warranty_claim(uuid, uuid),
  public.record_claim_inspection(uuid, date, text), public.decide_warranty_claim(uuid, text, text), public.raise_supplier_claim(uuid, text, date),
  public.resolve_supplier_claim(uuid, text, numeric, date, text), public.record_claim_rectified(uuid, date, numeric, text),
  public.close_warranty_claim(uuid, text, date, text) to authenticated, service_role;

-- Warranty documents, claim photos and reported-issue photos
create or replace function app.can_write_attachment(p_entity_type text, p_entity_id uuid, p_kind text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role();
begin
  case p_entity_type
  when 'visit' then return exists (select 1 from public.visits where id = p_entity_id and sales_person_id = auth.uid()) or r = 'sm_projects';
  when 'tender' then return exists (select 1 from public.tenders where id = p_entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return exists (select 1 from public.inquiries where id = p_entity_id and (sales_person_id = auth.uid() or r in ('sm_projects', 'gm')));
  when 'design_job' then
    return r = 'design_manager' or exists (select 1 from public.design_jobs where id = p_entity_id and assignee_id = auth.uid());
  when 'estimation_job' then
    return r = 'sm_estimation' or exists (select 1 from public.estimation_jobs where id = p_entity_id and assignee_id = auth.uid());
  when 'clarification' then
    return r in ('design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec');
  when 'sample' then
    return r = 'operations_exec' or exists (select 1 from public.samples where id = p_entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then return r = 'operations_exec';
  when 'retention' then return app.can_edit_retention(p_entity_id);
  when 'bond' then return r = 'operations_exec' and exists (select 1 from public.bonds where id = p_entity_id);
  when 'warranty' then return app.is_warranty_desk() and exists (select 1 from public.warranties where id = p_entity_id);
  when 'warranty_claim' then
    return exists (select 1 from public.warranty_claims c where c.id = p_entity_id and (app.is_warranty_desk() or c.assignee_id = auth.uid()));
  when 'warranty_report' then
    return exists (select 1 from public.warranty_reports x where x.id = p_entity_id and (x.sales_person_id = auth.uid() or app.is_warranty_desk()));
  else return false;
  end case;
end $$;

create or replace function app.can_read_attachment(a public.attachments) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); inq uuid; st text; mode int; released timestamptz;
begin
  if r is null then return false; end if;
  if a.uploaded_by = auth.uid() then return true; end if;
  case a.entity_type
  when 'visit' then
    return r in ('gm', 'sm_projects') or exists (select 1 from public.visits where id = a.entity_id and sales_person_id = auth.uid());
  when 'tender' then
    return r in ('gm', 'sm_projects', 'sm_estimation') or exists (select 1 from public.tenders where id = a.entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return app.can_read_inquiry(a.entity_id);
  when 'design_job' then
    select inquiry_id into inq from public.design_jobs where id = a.entity_id;
    if r in ('gm', 'design_manager') or app.can_read_design_job(a.entity_id) and r in ('lighting_designer', 'lighting_engineer') then return true; end if;
    -- Released design pack: Estimation (on release) and Sales (Route C / mode 3 release / early release)
    if a.kind = 'design_pack' then
      if r in ('sm_estimation', 'am_estimation', 'estimation_exec') then return app.can_read_inquiry(inq); end if;
      select status, release_mode, design_released_to_sales_at into st, mode, released from public.inquiries where id = inq;
      if r in ('sm_projects') or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)) then
        return released is not null;
      end if;
    end if;
    return false;
  when 'estimation_job' then
    select inquiry_id into inq from public.estimation_jobs where id = a.entity_id;
    if a.kind = 'costing_sheet' then return app.can_read_costing(a.entity_id); end if;
    if r in ('gm', 'sm_estimation') or app.can_read_estimation_job(a.entity_id) then return true; end if;
    if r = 'sm_projects' and a.kind in ('quotation_draft', 'quotation_final', 'compliance_sheet', 'technical_data')
       and exists (select 1 from public.estimation_jobs where id = a.entity_id and needs_sm_projects) then
      return true;
    end if;
    -- Sales download only the released quotation and supporting sheets – never the costing sheet
    if a.kind in ('quotation_final', 'compliance_sheet', 'technical_data') then
      return exists (select 1 from public.estimation_jobs where id = a.entity_id and status = 'released')
             and (r = 'sm_projects' or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)));
    end if;
    return false;
  when 'clarification' then
    select inquiry_id into inq from public.clarifications where id = a.entity_id;
    return r in ('gm', 'design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec')
           and app.can_read_inquiry(inq);
  when 'sample' then
    return r in ('gm', 'sm_projects', 'operations_exec') or exists (select 1 from public.samples where id = a.entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then
    return r in ('gm', 'sm_projects', 'operations_exec');
  when 'retention' then
    return exists (select 1 from public.retentions where id = a.entity_id);
  when 'bond' then
    return exists (select 1 from public.bonds where id = a.entity_id);
  when 'warranty' then
    return app.can_read_warranty(a.entity_id);
  when 'warranty_claim' then
    return exists (select 1 from public.warranty_claims where id = a.entity_id);
  when 'warranty_report' then
    return exists (select 1 from public.warranty_reports where id = a.entity_id);
  else
    return r = 'gm';
  end case;
end $$;

-- SM Projects decision on goodwill cover (copied from 20260930000045 with the warranty_goodwill branch)
create or replace function app.apply_approval(a public.approvals, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries;
  approved boolean := a.status = 'approved';
  decider public.app_role;
  who text;
begin
  perform set_config('app.workflow', '1', true);
  if a.inquiry_id is not null then select * into i from public.inquiries where id = a.inquiry_id; end if;

  case a.kind
  when 'mixed_duty' then
    if approved then
      update public.inquiries set mixed_duty_approved = true where id = a.inquiry_id;
      perform app.notify(i.sales_person_id, 'mixed_duty_approved', 'Mixed duty approved – you can submit',
        i.code, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'debtor_check' then
    if approved then
      perform public.resume_inquiry(a.inquiry_id);
    else
      perform app.notify(i.sales_person_id, 'debtor_hold', 'Inquiry held for debtor collection',
        coalesce(p_comment, ''), 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'release_mode' then
    if approved then
      update public.inquiries set release_mode = coalesce((a.payload ->> 'release_mode')::int, release_mode),
        release_mode_confirmed = true where id = a.inquiry_id;
    end if;
  when 'duty_change' then
    if approved then
      update public.inquiries set duty_status = (a.payload ->> 'duty_status')::public.duty_status where id = a.inquiry_id;
      perform app.duty_change_rework(a.inquiry_id, a.payload ->> 'duty_status', a.reason);
    end if;
  when 'expectation_change' then
    if approved then
      update public.inquiries set solution_level = coalesce(a.payload ->> 'solution_level', solution_level),
        manufacturing_origin = coalesce(a.payload ->> 'manufacturing_origin', manufacturing_origin),
        expectation_notes = coalesce(a.payload ->> 'expectation_notes', expectation_notes),
        estimation_scope = coalesce((select array_agg(x) from jsonb_array_elements_text(
                                       case when jsonb_typeof(a.payload -> 'estimation_scope') = 'array' then a.payload -> 'estimation_scope' end) x),
                                    estimation_scope),
        estimation_basis = coalesce(a.payload ->> 'estimation_basis', estimation_basis),
        design_scope = coalesce(a.payload ->> 'design_scope', design_scope)
      where id = a.inquiry_id;
      perform app.notify_many(
        array(select assignee_id from public.design_jobs where inquiry_id = i.id and status not in ('approved', 'released')
              union select assignee_id from public.estimation_jobs where inquiry_id = i.id and status not in ('released')),
        'expectation_changed', 'Client expectation changed – review your job', i.code, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'early_design_release' then
    if approved then
      update public.inquiries set early_design_release_at = now(), design_released_to_sales_at = now() where id = a.inquiry_id;
      perform app.log_status('inquiry', i.id, i.id, i.status, i.status, 'Early design release approved');
      perform app.notify_many(array[i.sales_person_id] || app.role_users('sm_projects'), 'design_released',
        'Design released early for client approval', format('%s – %s', i.code, i.project_name),
        'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'quotation_release' then
    if approved then
      update public.estimation_jobs set status = 'approved', approved_at = now(), needs_sm_projects = true, review_comment = p_comment
       where id = a.entity_id;
      perform app.notify_many(app.role_users('sm_estimation') || (select assignee_id from public.estimation_jobs where id = a.entity_id),
        'quotation_approved', 'GM / DGM approved the quotation – release it: ' || i.code, coalesce(p_comment, ''),
        'normal', 'estimation_job', a.entity_id, '/estimation/' || a.entity_id);
    else
      perform app.quotation_send_back(a.entity_id, i.id, p_comment, true);
    end if;
  when 'estimation_hold' then
    if approved then
      update public.estimation_jobs set status_before_hold = status, status = 'on_hold', hold_reason = a.reason where id = a.entity_id;
      perform app.pause_clocks('estimation_job', a.entity_id, a.reason);
      perform app.refresh_inquiry(a.inquiry_id);
    end if;
  when 'weekly_plan' then
    null; -- handled by approve_visit_plan
  when 'sample_return_date' then
    if approved then
      update public.samples set expected_return_date = (a.payload ->> 'new_date')::date where id = a.entity_id;
    end if;
  when 'account_ownership' then
    if approved then
      if a.entity_type = 'organization' then
        update public.organizations set account_owner_id = (a.payload ->> 'owner_id')::uuid where id = a.entity_id;
      else
        update public.org_units set account_owner_id = (a.payload ->> 'owner_id')::uuid where id = a.entity_id;
      end if;
    end if;
  when 'design_due' then
    if approved then
      update public.inquiries set design_due_at = (a.payload ->> 'due')::timestamptz, design_due_status = 'approved' where id = a.inquiry_id;
    else
      update public.inquiries set design_due_status = 'returned' where id = a.inquiry_id;
    end if;
  when 'quotation_sm_projects' then
    if approved then
      update public.estimation_jobs set status = 'approved', approved_at = now(), review_comment = coalesce(p_comment, review_comment)
       where id = a.entity_id;
      perform app.log_status('estimation_job', a.entity_id, i.id, 'sm_projects_approval', 'approved', p_comment);
      perform app.notify_many(app.role_users('sm_estimation') || (select assignee_id from public.estimation_jobs where id = a.entity_id),
        'quotation_approved', 'Quotation approved – release it: ' || i.code, coalesce(p_comment, ''),
        'normal', 'estimation_job', a.entity_id, '/estimation/' || a.entity_id);
    else
      decider := (select s.approver_role from public.approval_steps s where s.approval_id = a.id and s.decision is not null
                   order by s.step_no desc limit 1);
      perform app.quotation_send_back(a.entity_id, i.id, p_comment, decider = 'gm' or app.my_role() = 'gm');
    end if;
    perform app.refresh_inquiry(i.id);
  when 'retention_extension' then
    if approved then
      update public.retentions set due_date = (a.payload ->> 'new_date')::date, extensions = extensions + 1,
        alerted_60 = false, alerted_30 = false, sm_overdue_alerted = false
       where id = a.entity_id;
    end if;
    insert into public.retention_log (retention_id, kind, note)
    values (a.entity_id, case when approved then 'extended' else 'extension_' || a.status end,
            format('Due date %s → %s %s by GM / DGM%s', to_char((a.payload ->> 'old_date')::date, 'DD Mon YYYY'),
                   to_char((a.payload ->> 'new_date')::date, 'DD Mon YYYY'), case when approved then 'approved' else a.status end,
                   coalesce(' · ' || p_comment, '')));
    perform app.notify_many(app.role_users('operations_exec') || (select sales_person_id from public.retentions where id = a.entity_id),
      'retention_extension', format('Retention extension %s', case when approved then 'approved' else a.status end),
      coalesce(a.title, '') || coalesce(' · ' || p_comment, ''), 'normal', 'retention', a.entity_id, '/retentions/' || a.entity_id);
  when 'warranty_goodwill' then
    update public.warranty_claims set goodwill_status = case when approved then 'approved' else 'rejected' end,
      decision = case when approved then decision else 'chargeable' end
     where id = a.entity_id and goodwill_status = 'pending';
    insert into public.warranty_log (warranty_id, claim_id, kind, note)
    select c.warranty_id, c.id, 'goodwill_' || a.status,
           case when approved then 'Goodwill cover approved by SM Projects' else 'Goodwill cover not approved – chargeable' end || coalesce(' · ' || p_comment, '')
      from public.warranty_claims c where c.id = a.entity_id;
    perform app.notify_many(
      (select array[w.owner_id, c.reported_by] from public.warranty_claims c join public.warranties w on w.id = c.warranty_id where c.id = a.entity_id)
        || app.role_users('operations_exec', 'senior_elec_engineer'),
      'warranty_goodwill', case when approved then 'Goodwill warranty cover approved' else 'Goodwill cover not approved – claim is chargeable' end,
      coalesce(a.title, '') || coalesce(' · ' || p_comment, ''), 'normal', 'warranty_claim', a.entity_id, app.claim_url(a.entity_id));
  else
    null;
  end case;
end $$;

-- The warranty desk and engineers read projects (to pick the project of a completion record / see its warranties)
create policy projects_read_execution on public.projects for select to authenticated
  using (app.has_role('operations_exec', 'senior_elec_engineer', 'assistant_engineer'));
create policy orgs_read_execution on public.organizations for select to authenticated
  using (app.has_role('senior_elec_engineer', 'assistant_engineer'));
