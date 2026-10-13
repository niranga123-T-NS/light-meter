-- Local orders (TESTING): materials and services bought in Sri Lanka, from the request to payment.
--  * A local request (LR-) comes from an execution project (the SEE, or a site material request the store cannot cover) or a
--    supply project (the sales person). The Operations Executive checks the technical details, quantity and specifications
--    (or returns the request), raises the PR and takes it through DGM → FBP → DIC (DIC above LKR 2 mn on the PR value), and sends
--    the approved PR to Procurement for quotations and negotiation.
--  * Procurement's selection may split the request into several local orders (LO-), one per supplier: each confirmed by Ops
--    (lead time, delivery arrangement, payment term) and approved DGM → FBP → DIC (above LKR 2 mn on the selected value).
--  * Material: PO, advance guarantee / advance (when the term has an advance), LC (LC term), deliveries with signed delivery notes
--    (partial deliveries recorded one by one). Service: PO / LOA, bonds, LOA to commence, the agreement through Legal, work.
--  * Invoices (or IPC-based invoices) are approved by the project owner – SEE → SM Projects → DGM on execution projects, DGM on
--    other projects – then verified by Procurement and approved and paid by Finance. Service IPCs on execution projects link to
--    the subcontractor invoice recorded in the execution module.
--  * Ops records every step from e-mail and SAP; working days are counted per step and Ops can set an SLA per step.
--  * Seen by Ops, SM Projects, SM Estimation, the GM / DGM, the requester, the sales person and the project's SEE; values (PR value,
--    order values, invoice amounts) are not shown to the SEE.

create table public.lo_requests (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid references public.exec_projects (id) on delete set null,
  secured_id uuid references public.secured_projects (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  project_name text not null,
  client text,
  sales_person_id uuid references public.profiles (id),
  requested_by uuid references public.profiles (id),
  mr_id uuid references public.material_requests (id) on delete set null,
  title text not null,
  kind text not null default 'material' check (kind in ('material', 'service', 'both')),
  details text,
  quantity text,
  specs text,
  required_on date,
  delivery_location text not null,
  received_on date not null,
  pr_nos text,
  status text not null default 'open' check (status in ('open', 'returned', 'closed', 'cancelled')),
  return_reason text,
  cancel_reason text,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.lo_requests (status);
create index on public.lo_requests (exec_project_id);
create index on public.lo_requests (requested_by);
create index on public.lo_requests (sales_person_id);
create unique index lo_requests_one_per_mr on public.lo_requests (mr_id) where mr_id is not null and status <> 'cancelled';

create table public.lo_request_values (
  request_id uuid primary key references public.lo_requests (id) on delete cascade,
  pr_value numeric(16, 2) check (pr_value is null or pr_value >= 0),
  updated_at timestamptz not null default now()
);

create table public.lo_orders (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  request_id uuid not null references public.lo_requests (id) on delete cascade,
  seq_no int not null default 1,
  title text not null,
  kind text not null check (kind in ('material', 'service')),
  supplier text not null,
  supplier_new boolean not null default false,
  payment_term text not null check (payment_term in ('advance_balance', 'after_delivery', 'before_delivery', 'lc')),
  advance_pct numeric(5, 2) check (advance_pct is null or (advance_pct > 0 and advance_pct < 100)),
  advance_security boolean not null default false,
  lead_time text,
  delivery_arrangement text,
  po_no text,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  notes text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lo_orders_advance check (payment_term <> 'advance_balance' or advance_pct is not null)
);
create index on public.lo_orders (request_id);
create index on public.lo_orders (status);

create table public.lo_order_values (
  order_id uuid primary key references public.lo_orders (id) on delete cascade,
  value numeric(16, 2) check (value is null or value >= 0),
  updated_at timestamptz not null default now()
);

create table public.lo_step_defs (
  key text primary key,
  scope text not null check (scope in ('r', 'o')),
  stage int not null check (stage between 1 and 7),
  seq int not null unique,
  label text not null,
  node text not null,
  conds text[] not null default '{}',
  after text[] not null default '{}',
  ref_label text,
  sla_days int check (sla_days is null or sla_days > 0),
  sla_by uuid references public.profiles (id),
  sla_at timestamptz,
  optional boolean not null default false
);

insert into public.lo_step_defs (key, scope, stage, seq, label, node, conds, after, ref_label) values
  ('lr_received',      'r', 1, 10, 'Request received',                                         'Requester',           '{}', '{}', null),
  ('lr_checked',       'r', 2, 20, 'Technical details, quantity and specifications confirmed', 'Operations',          '{}', '{lr_received}', null),
  ('pr_raised',        'r', 3, 30, 'PR raised',                                                'Operations',          '{}', '{lr_checked}', 'PR no.'),
  ('pr_dgm',           'r', 3, 31, 'PR approved by DGM',                                       'DGM',                 '{}', '{pr_raised}', null),
  ('pr_fbp',           'r', 3, 32, 'PR approved by FBP',                                       'FBP',                 '{}', '{pr_dgm}', null),
  ('pr_dic',           'r', 3, 33, 'PR approved by DIC',                                       'DIC',                 '{dic_pr}', '{pr_fbp}', null),
  ('pr_to_proc',       'r', 3, 34, 'Approved PR sent to Procurement',                          'Operations',          '{}', '{pr_fbp,pr_dic}', null),
  ('quotes_called',    'r', 4, 40, 'Quotations called',                                        'Procurement',         '{}', '{pr_to_proc}', 'Quotations received'),
  ('negotiated',       'r', 4, 41, 'Negotiation completed',                                    'Procurement',         '{}', '{quotes_called}', null),
  ('supplier_reg',     'o', 4, 45, 'Supplier registered',                                      'Procurement',         '{supplier_new}', '{negotiated}', 'SAP vendor no.'),
  ('selection_received','o', 5, 50, 'Final selection received from Procurement',               'Procurement',         '{}', '{negotiated}', null),
  ('terms_confirmed',  'o', 5, 51, 'Lead time, delivery arrangement and payment term confirmed', 'Operations',        '{}', '{selection_received}', null),
  ('sel_dgm',          'o', 5, 52, 'Selection approved by DGM',                                'DGM',                 '{}', '{terms_confirmed}', null),
  ('sel_fbp',          'o', 5, 53, 'Selection approved by FBP',                                'FBP',                 '{}', '{sel_dgm}', null),
  ('sel_dic',          'o', 5, 54, 'Selection approved by DIC',                                'DIC',                 '{dic_sel}', '{sel_fbp}', null),
  ('po_issued',        'o', 6, 60, 'PO released to the supplier',                              'Procurement',         '{material}', '{sel_fbp,sel_dic,supplier_reg}', 'PO no.'),
  ('loa_issued',       'o', 6, 61, 'PO / LOA issued to the service provider',                  'Procurement',         '{service}', '{sel_fbp,sel_dic,supplier_reg}', 'PO / LOA no.'),
  ('advance_security', 'o', 6, 62, 'Advance payment guarantee / bond received',                'Supplier',            '{advance_security}', '{po_issued,loa_issued}', 'Guarantee no.'),
  ('perf_bond',        'o', 6, 63, 'Performance bond received',                                'Service provider',    '{service}', '{loa_issued}', 'Bond no.'),
  ('commence',         'o', 6, 64, 'LOA to commence the work issued',                          'Procurement',         '{service}', '{loa_issued}', null),
  ('draft_sent',       'o', 6, 65, 'Draft agreement sent to the provider',                     'Procurement',         '{service}', '{loa_issued}', null),
  ('draft_confirmed',  'o', 6, 66, 'Draft agreement confirmed by the provider',                'Service provider',    '{service}', '{draft_sent}', null),
  ('legal_approved',   'o', 6, 67, 'Final draft approved by Legal',                            'Legal',               '{service}', '{draft_confirmed}', null),
  ('agreement_signed', 'o', 6, 68, 'Signed agreement issued to the provider',                  'Procurement',         '{service}', '{legal_approved}', null),
  ('lc_opened',        'o', 6, 69, 'LC opened',                                                'Finance · bank',      '{lc}', '{po_issued,loa_issued}', 'LC no.'),
  ('advance_paid',     'o', 6, 70, 'Advance paid',                                             'Finance',             '{advance}', '{advance_security,po_issued,loa_issued}', null),
  ('delivered',        'o', 6, 71, 'Delivered in full – delivery notes signed by the site',    'Supplier · site',     '{material}', '{po_issued,advance_paid,lc_opened}', null),
  ('work_done',        'o', 6, 72, 'Work completed',                                           'Service provider',    '{service}', '{commence,perf_bond,advance_paid}', null),
  ('closed',           'o', 7, 80, 'All invoices paid – order closed',                         'Operations',          '{}', '{delivered,work_done,agreement_signed}', null);

create table public.lo_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.lo_requests (id) on delete cascade,
  order_id uuid references public.lo_orders (id) on delete cascade,
  step text not null references public.lo_step_defs (key),
  done_on date not null,
  ref text,
  note text,
  recorded_by uuid not null default auth.uid() references public.profiles (id),
  recorded_at timestamptz not null default now()
);
create unique index lo_steps_one on public.lo_steps (request_id, coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid), step);
create index on public.lo_steps (order_id);

-- Deliveries (material): partial deliveries one by one, each with its signed delivery note
create table public.lo_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.lo_orders (id) on delete cascade,
  delivered_on date not null,
  dn_no text not null,
  items text,
  signed_by text,
  note text,
  added_by uuid not null default auth.uid() references public.profiles (id),
  added_at timestamptz not null default now()
);
create index on public.lo_deliveries (order_id);

-- Invoices: the owner's approvals, Procurement's verification, Finance's approval and the payment, each with its date
create table public.lo_invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.lo_orders (id) on delete cascade,
  kind text not null default 'invoice' check (kind in ('invoice', 'ipc', 'advance')),
  invoice_no text not null,
  invoice_date date not null,
  amount numeric(16, 2) not null check (amount > 0),
  dn_nos text,
  sub_invoice_id uuid references public.sub_invoices (id) on delete set null,
  received_on date not null,
  see_on date,
  smp_on date,
  dgm_on date,
  proc_on date,
  finance_on date,
  paid_on date,
  pay_ref text,
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  note text,
  added_by uuid not null default auth.uid() references public.profiles (id),
  added_at timestamptz not null default now()
);
create index on public.lo_invoices (order_id);

-- Mistakes, delays, complaints and notices against a stage (or some of its steps), as for foreign orders
create table public.lo_notes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.lo_requests (id) on delete cascade,
  order_id uuid references public.lo_orders (id) on delete cascade,
  stage int not null check (stage between 1 and 7),
  steps text[] not null default '{}',
  kind text not null check (kind in ('mistake', 'delay', 'complaint', 'notice')),
  party text,
  title text not null,
  details text,
  occurred_on date not null,
  delay_days int check (delay_days is null or delay_days between 1 and 365),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  resolution text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.lo_notes (request_id);

-- ---------------------------------------------------------------------------
-- Access

create or replace function app.lo_keeper() returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('operations_exec')
$$;
create or replace function app.lo_office() returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('operations_exec', 'sm_projects', 'sm_estimation', 'gm', 'sys_admin')
$$;
create or replace function app.lo_see_of(p_request uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select e.see_id from public.lo_requests r join public.exec_projects e on e.id = r.exec_project_id where r.id = p_request
$$;
create or replace function app.lo_can_read(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.lo_office() or exists (select 1 from public.lo_requests r where r.id = p_request and auth.uid() in (r.requested_by, r.sales_person_id, r.created_by))
      or app.lo_see_of(p_request) = auth.uid()
$$;
-- Values: everyone who reads the request except the SEE (and the site team who requested it)
create or replace function app.lo_can_see_values(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.lo_office() or exists (select 1 from public.lo_requests r where r.id = p_request and r.sales_person_id = auth.uid())
$$;
create or replace function app.lo_order_request(p_order uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select request_id from public.lo_orders where id = p_order
$$;

alter table public.lo_requests enable row level security;
alter table public.lo_request_values enable row level security;
alter table public.lo_orders enable row level security;
alter table public.lo_order_values enable row level security;
alter table public.lo_step_defs enable row level security;
alter table public.lo_steps enable row level security;
alter table public.lo_deliveries enable row level security;
alter table public.lo_invoices enable row level security;
alter table public.lo_notes enable row level security;
create policy lo_requests_read on public.lo_requests for select to authenticated using (app.lo_can_read(id));
create policy lo_request_values_read on public.lo_request_values for select to authenticated using (app.lo_can_see_values(request_id));
create policy lo_orders_read on public.lo_orders for select to authenticated using (app.lo_can_read(request_id));
create policy lo_order_values_read on public.lo_order_values for select to authenticated using (app.lo_can_see_values(app.lo_order_request(order_id)));
create policy lo_step_defs_read on public.lo_step_defs for select to authenticated using (true);
create policy lo_steps_read on public.lo_steps for select to authenticated using (app.lo_can_read(request_id));
create policy lo_deliveries_read on public.lo_deliveries for select to authenticated using (app.lo_can_read(app.lo_order_request(order_id)));
create policy lo_invoices_read on public.lo_invoices for select to authenticated using (app.lo_can_see_values(app.lo_order_request(order_id)));
create policy lo_notes_read on public.lo_notes for select to authenticated using (app.lo_can_read(request_id));
grant select on public.lo_requests, public.lo_request_values, public.lo_orders, public.lo_order_values, public.lo_step_defs, public.lo_steps,
  public.lo_deliveries, public.lo_invoices, public.lo_notes to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers

create or replace function app.lo_dic_limit() returns numeric language sql immutable as $$ select 2000000::numeric $$;

create or replace function app.lo_r_applies(p_conds text[], r public.lo_requests) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(bool_and(case c
      when 'dic_pr' then coalesce((select pr_value from public.lo_request_values where request_id = r.id), 0) > app.lo_dic_limit()
      else false end), true)
    from unnest(p_conds) c
$$;

create or replace function app.lo_applies(p_conds text[], o public.lo_orders) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(bool_and(case c
      when 'material' then o.kind = 'material'
      when 'service' then o.kind = 'service'
      when 'supplier_new' then o.supplier_new
      when 'dic_sel' then coalesce((select value from public.lo_order_values where order_id = o.id), 0) > app.lo_dic_limit()
      when 'advance' then o.payment_term in ('advance_balance', 'before_delivery')
      when 'advance_security' then o.advance_security and o.payment_term in ('advance_balance', 'before_delivery')
      when 'lc' then o.payment_term = 'lc'
      else false end), true)
    from unnest(p_conds) c
$$;

-- The steps a step really follows: an optional step that is not done is replaced by the steps it follows
create or replace function app.lo_effective_after(p_request uuid, p_order uuid, p_step text) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare todo text[] := coalesce((select after from public.lo_step_defs where key = p_step), '{}'); out text[] := '{}'; k text; a public.lo_step_defs; n int := 0;
begin
  while cardinality(todo) > 0 and n < 100 loop
    n := n + 1;
    k := todo[1];
    todo := todo[2:];
    select * into a from public.lo_step_defs where key = k;
    continue when a.key is null or k = any (out);
    if a.optional and not exists (select 1 from public.lo_steps where request_id = p_request and step = k
                                    and (case when a.scope = 'r' then order_id is null else order_id = p_order end)) then
      todo := todo || a.after;
    else
      out := out || k;
    end if;
  end loop;
  return out;
end $$;

-- The first step it follows that applies and is not done (label), or null. A request step after order steps is not used.
create or replace function app.lo_missing_before(p_request uuid, p_order uuid, p_step text) returns text
language plpgsql stable security definer set search_path = public as $$
declare r public.lo_requests; o public.lo_orders; a public.lo_step_defs;
begin
  select * into r from public.lo_requests where id = p_request;
  if p_order is not null then select * into o from public.lo_orders where id = p_order; end if;
  for a in select * from public.lo_step_defs where key = any (app.lo_effective_after(p_request, p_order, p_step)) order by seq loop
    if a.scope = 'r' then
      if app.lo_r_applies(a.conds, r) and not exists (select 1 from public.lo_steps where request_id = p_request and order_id is null and step = a.key) then
        return a.label;
      end if;
    elsif p_order is not null then
      if app.lo_applies(a.conds, o) and not exists (select 1 from public.lo_steps where order_id = p_order and step = a.key) then
        return a.label;
      end if;
    end if;
  end loop;
  return null;
end $$;

create or replace function app.lo_step_start(p_request uuid, p_order uuid, p_step text) returns date
language sql stable security definer set search_path = public as $$
  select max(s.done_on) from public.lo_steps s
   where s.request_id = p_request and s.step = any (app.lo_effective_after(p_request, p_order, p_step))
     and (s.order_id is null or s.order_id = p_order)
$$;

create or replace function app.lo_head(r public.lo_requests) returns text
language sql stable as $$
  select concat_ws(' · ', r.code, r.title, r.project_name)
$$;
create or replace function app.lo_order_head(o public.lo_orders) returns text
language sql stable security definer set search_path = public as $$
  select concat_ws(' · ', o.code, o.title, o.supplier, (select project_name from public.lo_requests where id = o.request_id))
$$;
-- Who hears about progress: the requester, the sales person and the project's SEE
create or replace function app.lo_followers(p_request uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array(select distinct x from unnest(array[(select requested_by from public.lo_requests where id = p_request),
                                                   (select sales_person_id from public.lo_requests where id = p_request), app.lo_see_of(p_request)]) x where x is not null)
$$;
-- Can this user raise a request for this project? Ops, SM Projects, the GM / DGM; the project's SEE; a sales person (supply projects)
create or replace function app.lo_can_request(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('operations_exec', 'sm_projects', 'gm')
      or (p_exec is not null and exists (select 1 from public.exec_projects e where e.id = p_exec and e.see_id = auth.uid()))
      or (p_exec is null and app.has_role('asm_building', 'asm_infra'))
$$;

-- ---------------------------------------------------------------------------
-- Requests

-- p: {exec_project_id | secured_id | project_name+client, sales_person_id, mr_id, title, kind, details, quantity, specs, required_on,
--     delivery_location, received_on, pr_value, notes}
create or replace function public.lo_save_request(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.lo_requests; rid uuid; e public.exec_projects; sp public.secured_projects; m public.material_requests;
        rec date := coalesce(nullif(p ->> 'received_on', '')::date, (now() at time zone app.tz())::date); k text := coalesce(nullif(p ->> 'kind', ''), 'material');
        lines text;
begin
  if nullif(p ->> 'mr_id', '') is not null then
    select * into m from public.material_requests where id = (p ->> 'mr_id')::uuid;
    perform app.require(found, 'Material request not found');
    perform app.require(m.status = 'approved', 'Only an approved material request can be bought locally');
    select string_agg(format('%s – %s %s', l.item, trim(to_char(l.qty, 'FM999999990.###')), l.unit), E'\n' order by l.item) into lines
      from public.material_request_lines l where l.mr_id = m.id;
    p := p || jsonb_build_object('exec_project_id', m.exec_project_id::text,
                                 'title', coalesce(nullif(btrim(p ->> 'title'), ''), coalesce(m.code, 'Material request') || ' – ' || coalesce(m.purpose, 'site materials')),
                                 'quantity', coalesce(nullif(btrim(p ->> 'quantity'), ''), lines),
                                 'required_on', coalesce(nullif(p ->> 'required_on', ''), m.required_date::text));
    k := 'material';
  end if;
  if nullif(p ->> 'secured_id', '') is not null then
    select * into sp from public.secured_projects where id = (p ->> 'secured_id')::uuid;
    perform app.require(found, 'Won order not found');
    p := p || jsonb_build_object('project_name', coalesce(nullif(btrim(p ->> 'project_name'), ''), sp.project_name),
                                 'client', coalesce(nullif(btrim(p ->> 'client'), ''), sp.customer, ''),
                                 'sales_person_id', coalesce(nullif(p ->> 'sales_person_id', ''), sp.sales_person_id::text, ''),
                                 'project_id', coalesce(nullif(p ->> 'project_id', ''), sp.project_id::text, ''));
  end if;
  if nullif(p ->> 'exec_project_id', '') is not null then
    select * into e from public.exec_projects where id = (p ->> 'exec_project_id')::uuid;
    perform app.require(found, 'Execution project not found');
    p := p || jsonb_build_object('project_name', coalesce(nullif(btrim(p ->> 'project_name'), ''), coalesce(e.code || ' ', '') || e.name),
                                 'client', coalesce(nullif(btrim(p ->> 'client'), ''), e.client_name, ''),
                                 'project_id', coalesce(nullif(p ->> 'project_id', ''), e.project_id::text, ''),
                                 'delivery_location', coalesce(nullif(btrim(p ->> 'delivery_location'), ''), e.site_address, ''));
  end if;
  perform app.require(app.lo_can_request(e.id), 'Only Operations, SM Projects, the DGM, the project''s SEE or the sales person raise local requests');
  perform app.require(coalesce(btrim(p ->> 'project_name'), '') <> '', 'Choose the project');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'What is needed? (a short title)');
  perform app.require(k in ('material', 'service', 'both'), 'Material, service or both?');
  perform app.require(coalesce(btrim(p ->> 'delivery_location'), '') <> '', 'Enter the delivery / work location');
  perform app.require(rec <= (now() at time zone app.tz())::date, 'The request date cannot be in the future');
  if p_id is null then
    insert into public.lo_requests (code, exec_project_id, secured_id, project_id, project_name, client, sales_person_id, requested_by, mr_id, title, kind,
                                    details, quantity, specs, required_on, delivery_location, received_on, notes)
    values (app.next_code('LR'), e.id, sp.id, nullif(p ->> 'project_id', '')::uuid, btrim(p ->> 'project_name'), nullif(btrim(p ->> 'client'), ''),
            nullif(p ->> 'sales_person_id', '')::uuid, coalesce(nullif(p ->> 'requested_by', '')::uuid, case when app.lo_keeper() then null else auth.uid() end, m.requested_by),
            m.id, btrim(p ->> 'title'), k, nullif(btrim(p ->> 'details'), ''), nullif(btrim(p ->> 'quantity'), ''), nullif(btrim(p ->> 'specs'), ''),
            nullif(p ->> 'required_on', '')::date, btrim(p ->> 'delivery_location'), rec, nullif(btrim(p ->> 'notes'), ''))
    returning id into rid;
    insert into public.lo_steps (request_id, step, done_on) values (rid, 'lr_received', rec);
    if app.lo_can_see_values(rid) and nullif(p ->> 'pr_value', '') is not null then
      insert into public.lo_request_values (request_id, pr_value) values (rid, (p ->> 'pr_value')::numeric);
    end if;
    select * into r from public.lo_requests where id = rid;
    if not app.lo_keeper() then
      perform app.notify_many(app.role_users('operations_exec'), 'local_order', 'New local request', app.lo_head(r)
        || coalesce(' · needed by ' || to_char(r.required_on, 'DD Mon'), ''), 'normal', 'lo_request', rid, '/orders/local/r/' || rid);
    end if;
    return rid;
  end if;
  select * into r from public.lo_requests where id = p_id for update;
  perform app.require(found, 'Request not found');
  perform app.require(r.status in ('open', 'returned'), 'The request is closed');
  perform app.require(app.lo_keeper() or auth.uid() in (r.requested_by, r.created_by), 'Only Operations or the requester change the request');
  update public.lo_requests set exec_project_id = e.id, secured_id = sp.id, project_id = nullif(p ->> 'project_id', '')::uuid, project_name = btrim(p ->> 'project_name'),
         client = nullif(btrim(p ->> 'client'), ''), sales_person_id = nullif(p ->> 'sales_person_id', '')::uuid, title = btrim(p ->> 'title'), kind = k,
         details = nullif(btrim(p ->> 'details'), ''), quantity = nullif(btrim(p ->> 'quantity'), ''), specs = nullif(btrim(p ->> 'specs'), ''),
         required_on = nullif(p ->> 'required_on', '')::date, delivery_location = btrim(p ->> 'delivery_location'), notes = nullif(btrim(p ->> 'notes'), ''),
         status = 'open', updated_at = now()
   where id = p_id;
  if app.lo_can_see_values(p_id) and p ? 'pr_value' then
    insert into public.lo_request_values (request_id, pr_value) values (p_id, nullif(p ->> 'pr_value', '')::numeric)
    on conflict (request_id) do update set pr_value = excluded.pr_value, updated_at = now();
  end if;
  -- a returned request sent again: Ops is told
  if r.status = 'returned' then
    perform app.notify_many(app.role_users('operations_exec'), 'local_order', 'Local request sent again', app.lo_head(r) || ' · ' || coalesce(r.return_reason, ''),
      'normal', 'lo_request', p_id, '/orders/local/r/' || p_id);
  end if;
  return p_id;
end $$;

-- Ops: details, quantity or specifications missing – back to the requester
create or replace function public.lo_return_request(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.lo_requests;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive checks the requests');
  select * into r from public.lo_requests where id = p_id for update;
  perform app.require(found and r.status = 'open', 'Request not found or not open');
  perform app.require(not exists (select 1 from public.lo_steps where request_id = p_id and step = 'lr_checked'), 'Already checked');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'What is missing?');
  update public.lo_requests set status = 'returned', return_reason = btrim(p_reason), updated_at = now() where id = p_id;
  perform app.notify_many(app.lo_followers(p_id), 'local_order', 'Local request returned – details needed', app.lo_head(r) || ' · ' || btrim(p_reason),
    'critical', 'lo_request', p_id, '/orders/local/r/' || p_id);
end $$;

create or replace function public.lo_cancel_request(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records local orders');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  update public.lo_requests set status = 'cancelled', cancel_reason = btrim(p_reason), updated_at = now() where id = p_id and status in ('open', 'returned');
  perform app.require(found, 'Only an open request can be cancelled');
  update public.lo_orders set status = 'cancelled', cancel_reason = 'Request cancelled: ' || btrim(p_reason), updated_at = now() where request_id = p_id and status = 'open';
end $$;

create or replace function public.lo_set_pr(p_id uuid, p_pr_nos text, p_value numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records local orders');
  perform app.require(p_value is null or p_value >= 0, 'Enter the PR value');
  update public.lo_requests set pr_nos = nullif(btrim(p_pr_nos), ''), updated_at = now() where id = p_id;
  perform app.require(found, 'Request not found');
  insert into public.lo_request_values (request_id, pr_value) values (p_id, p_value)
  on conflict (request_id) do update set pr_value = excluded.pr_value, updated_at = now();
end $$;

-- Closes the request when every order is closed or cancelled (and at least one was closed)
create or replace function public.lo_close_if_done(p_request uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.lo_orders where request_id = p_request and status = 'completed')
     and not exists (select 1 from public.lo_orders where request_id = p_request and status = 'open') then
    update public.lo_requests set status = 'closed', updated_at = now() where id = p_request and status = 'open';
    return found;
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- Orders (one per supplier) – Ops, from Procurement's final selection

-- p: {request_id, title, kind, supplier, supplier_new, payment_term, advance_pct, advance_security, lead_time, delivery_arrangement, value, notes}
create or replace function public.lo_save_order(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.lo_requests; o public.lo_orders; oid uuid; k text := p ->> 'kind'; t text := p ->> 'payment_term'; pct numeric := nullif(p ->> 'advance_pct', '')::numeric;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records local orders');
  if p_id is not null then
    select * into o from public.lo_orders where id = p_id for update;
    perform app.require(found, 'Order not found');
    perform app.require(o.status = 'open', 'The order is closed');
    select * into r from public.lo_requests where id = o.request_id;
  else
    select * into r from public.lo_requests where id = nullif(p ->> 'request_id', '')::uuid;
    perform app.require(found, 'Request not found');
  end if;
  perform app.require(r.status = 'open', 'The request is not open');
  perform app.require(k in ('material', 'service'), 'Material or service?');
  perform app.require(r.kind = 'both' or r.kind = k, format('This request is for %s', case r.kind when 'material' then 'materials' else 'services' end));
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'What is ordered from this supplier?');
  perform app.require(coalesce(btrim(p ->> 'supplier'), '') <> '', 'Enter the supplier / service provider');
  perform app.require(t in ('advance_balance', 'after_delivery', 'before_delivery', 'lc'), 'Choose the payment term');
  perform app.require(t <> 'advance_balance' or (pct > 0 and pct < 100), 'Enter the advance % (balance after delivery)');
  if p_id is null then
    insert into public.lo_orders (code, request_id, seq_no, title, kind, supplier, supplier_new, payment_term, advance_pct, advance_security, lead_time, delivery_arrangement, notes)
    values (app.next_code('LO'), r.id, coalesce((select max(seq_no) from public.lo_orders where request_id = r.id), 0) + 1, btrim(p ->> 'title'), k, btrim(p ->> 'supplier'),
            coalesce((p ->> 'supplier_new')::boolean, false), t, case when t = 'advance_balance' then pct end, coalesce((p ->> 'advance_security')::boolean, false),
            nullif(btrim(p ->> 'lead_time'), ''), nullif(btrim(p ->> 'delivery_arrangement'), ''), nullif(btrim(p ->> 'notes'), ''))
    returning id into oid;
  else
    oid := p_id;
    update public.lo_orders set title = btrim(p ->> 'title'), kind = k, supplier = btrim(p ->> 'supplier'), supplier_new = coalesce((p ->> 'supplier_new')::boolean, false),
           payment_term = t, advance_pct = case when t = 'advance_balance' then pct end, advance_security = coalesce((p ->> 'advance_security')::boolean, false),
           lead_time = nullif(btrim(p ->> 'lead_time'), ''), delivery_arrangement = nullif(btrim(p ->> 'delivery_arrangement'), ''),
           notes = nullif(btrim(p ->> 'notes'), ''), updated_at = now()
     where id = oid;
    select * into o from public.lo_orders where id = oid;
    perform app.require(not exists (select 1 from public.lo_steps st join public.lo_step_defs d on d.key = st.step
                                     where st.order_id = oid and not app.lo_applies(d.conds, o)),
      'Steps already recorded no longer apply to these terms – clear them first');
  end if;
  if p ? 'value' then
    insert into public.lo_order_values (order_id, value) values (oid, nullif(p ->> 'value', '')::numeric)
    on conflict (order_id) do update set value = excluded.value, updated_at = now();
  end if;
  return oid;
end $$;

create or replace function public.lo_cancel_order(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records local orders');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  update public.lo_orders set status = 'cancelled', cancel_reason = btrim(p_reason), updated_at = now() where id = p_id and status = 'open' returning * into o;
  perform app.require(o.id is not null, 'Only an open order can be cancelled');
  perform public.lo_close_if_done(o.request_id);
end $$;

-- ---------------------------------------------------------------------------
-- Steps (Ops)

create or replace function public.lo_record_step(p_request uuid, p_order uuid, p_step text, p_date date, p_ref text default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.lo_requests; o public.lo_orders; d public.lo_step_defs; miss text; st date; sid uuid; ref text := nullif(btrim(p_ref), ''); head text;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records the steps');
  select * into d from public.lo_step_defs where key = p_step;
  perform app.require(found, 'Unknown step');
  perform app.require(p_step <> 'lr_received', 'The request date is changed on the request');
  if d.scope = 'o' then
    select * into o from public.lo_orders where id = p_order;
    perform app.require(found, 'Order not found');
    perform app.require(o.status = 'open', 'The order is closed');
    p_request := o.request_id;
  else
    p_order := null;
  end if;
  select * into r from public.lo_requests where id = p_request;
  perform app.require(found, 'Request not found');
  perform app.require(r.status = 'open', case when r.status = 'returned' then 'The request is back with the requester' else 'The request is closed' end);
  perform app.require(case when d.scope = 'o' then app.lo_applies(d.conds, o) else app.lo_r_applies(d.conds, r) end, 'This step does not apply to this order');
  perform app.require(p_date is not null and p_date <= (now() at time zone app.tz())::date, 'Enter the date it was done (not in the future)');
  miss := app.lo_missing_before(p_request, p_order, p_step);
  perform app.require(miss is null, format('Record "%s" first', miss));
  st := app.lo_step_start(p_request, p_order, p_step);
  perform app.require(st is null or p_date >= st, format('The date cannot be before the step it follows (%s)', to_char(st, 'DD Mon YYYY')));
  if p_step in ('pr_raised', 'po_issued', 'loa_issued') then
    perform app.require(ref is not null, format('Enter the %s', d.ref_label));
  end if;
  if p_step = 'pr_raised' then
    perform app.require((select pr_value from public.lo_request_values where request_id = p_request) is not null, 'Enter the PR value first (it decides the DIC approval)');
  end if;
  if p_step = 'sel_dgm' then
    perform app.require((select value from public.lo_order_values where order_id = p_order) is not null, 'Enter the selected value first (it decides the DIC approval)');
  end if;
  if p_step = 'delivered' then
    perform app.require(exists (select 1 from public.lo_deliveries where order_id = p_order), 'Record the delivery (delivery note) first');
  end if;
  if p_step = 'closed' then
    perform app.require(exists (select 1 from public.lo_invoices where order_id = p_order and status = 'paid'), 'No paid invoice yet');
    perform app.require(not exists (select 1 from public.lo_invoices where order_id = p_order and status = 'open'), 'An invoice is still being processed');
  end if;
  insert into public.lo_steps (request_id, order_id, step, done_on, ref, note)
  values (p_request, p_order, p_step, p_date, ref, nullif(btrim(p_note), ''))
  on conflict (request_id, coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid), step)
  do update set done_on = excluded.done_on, ref = excluded.ref, note = excluded.note, recorded_by = auth.uid(), recorded_at = now()
  returning id into sid;

  if p_step = 'pr_raised' then update public.lo_requests set pr_nos = coalesce(pr_nos, ref), updated_at = now() where id = p_request; end if;
  if p_step in ('po_issued', 'loa_issued') then
    update public.lo_orders set po_no = ref, updated_at = now() where id = p_order;
    -- the site material request it came from is on order now
    if r.mr_id is not null then
      update public.material_requests set status = 'ordered', po_no = coalesce(po_no, ref), supplier = coalesce(supplier, o.supplier),
             expected_date = coalesce(expected_date, r.required_on), ordered_by = coalesce(ordered_by, auth.uid()), ordered_at = coalesce(ordered_at, now())
       where id = r.mr_id and status = 'approved';
    end if;
  end if;

  head := case when p_order is not null then app.lo_order_head(o) else app.lo_head(r) end;
  if p_step = 'lr_checked' then
    perform app.notify_many(app.lo_followers(r.id), 'local_order', 'Local request accepted', head || ' · Operations is raising the PR', 'normal', 'lo_request', r.id, '/orders/local/r/' || r.id);
  elsif p_step = 'pr_to_proc' then
    perform app.notify_many(app.lo_followers(r.id), 'local_order', 'PR approved – with Procurement', head, 'normal', 'lo_request', r.id, '/orders/local/r/' || r.id);
  elsif p_step in ('po_issued', 'loa_issued') then
    perform app.notify_many(app.lo_followers(r.id), 'local_order', case when p_step = 'po_issued' then 'PO issued' else 'PO / LOA issued' end,
      head || ' · ' || ref || coalesce(' · lead time ' || o.lead_time, ''), 'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  elsif p_step = 'commence' then
    perform app.notify_many(app.lo_followers(r.id), 'local_order', 'Service provider can start the work', head, 'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  elsif p_step = 'delivered' then
    perform app.notify_many(app.lo_followers(r.id), 'local_order', 'Delivered in full', head || ' · ' || r.delivery_location, 'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  elsif p_step = 'closed' then
    update public.lo_orders set status = 'completed', updated_at = now() where id = p_order;
    perform public.lo_close_if_done(r.id);
  end if;
  return sid;
end $$;

create or replace function public.lo_clear_step(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.lo_steps;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records the steps');
  select * into s from public.lo_steps where id = p_id;
  perform app.require(found, 'Step not found');
  perform app.require(s.step <> 'lr_received', 'The request date is changed on the request');
  perform app.require(not exists (select 1 from public.lo_steps x join public.lo_step_defs d on d.key = x.step
                                   where x.request_id = s.request_id and s.step = any (d.after)
                                     and (s.order_id is null or x.order_id = s.order_id)),
    'Clear the steps recorded after it first');
  if s.step = 'closed' then
    update public.lo_orders set status = 'open', updated_at = now() where id = s.order_id;
    update public.lo_requests set status = 'open', updated_at = now() where id = s.request_id and status = 'closed';
  end if;
  delete from public.lo_steps where id = p_id;
end $$;

create or replace function public.lo_set_sla(p_step text, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.lo_keeper() or app.has_role('sys_admin'), 'The Operations Executive sets the SLAs');
  perform app.require(p_days is null or p_days between 1 and 365, 'Enter the working days, or leave empty for no SLA');
  update public.lo_step_defs set sla_days = p_days, sla_by = auth.uid(), sla_at = now() where key = p_step;
  perform app.require(found, 'Unknown step');
end $$;

create or replace function public.lo_set_optional(p_step text, p_optional boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.lo_keeper() or app.has_role('sys_admin'), 'The Operations Executive sets this');
  perform app.require(p_step not in ('lr_received', 'lr_checked', 'closed'), 'This step is always required');
  update public.lo_step_defs set optional = coalesce(p_optional, false) where key = p_step;
  perform app.require(found, 'Unknown step');
end $$;

-- ---------------------------------------------------------------------------
-- Deliveries and invoices (Ops)

create or replace function public.lo_add_delivery(p_order uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; did uuid; d date := nullif(p ->> 'delivered_on', '')::date;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records deliveries');
  select * into o from public.lo_orders where id = p_order;
  perform app.require(found and o.status = 'open', 'Order not found or closed');
  perform app.require(o.kind = 'material', 'Deliveries are for material orders');
  perform app.require(exists (select 1 from public.lo_steps where order_id = p_order and step = 'po_issued'), 'Record the PO first');
  perform app.require(d is not null and d <= (now() at time zone app.tz())::date, 'Enter the delivery date');
  perform app.require(coalesce(btrim(p ->> 'dn_no'), '') <> '', 'Enter the delivery note no.');
  insert into public.lo_deliveries (order_id, delivered_on, dn_no, items, signed_by, note)
  values (p_order, d, btrim(p ->> 'dn_no'), nullif(btrim(p ->> 'items'), ''), nullif(btrim(p ->> 'signed_by'), ''), nullif(btrim(p ->> 'note'), ''))
  returning id into did;
  perform app.notify_many(app.lo_followers(o.request_id), 'local_order', 'Delivery received', app.lo_order_head(o) || ' · DN ' || btrim(p ->> 'dn_no')
    || coalesce(' · ' || nullif(btrim(p ->> 'items'), ''), ''), 'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  return did;
end $$;

create or replace function public.lo_remove_delivery(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare oid uuid;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records deliveries');
  select order_id into oid from public.lo_deliveries where id = p_id;
  perform app.require(oid is not null, 'Delivery not found');
  perform app.require(not exists (select 1 from public.lo_steps where order_id = oid and step = 'delivered')
                      or (select count(*) from public.lo_deliveries where order_id = oid) > 1, 'Clear "Delivered in full" first');
  delete from public.lo_deliveries where id = p_id;
end $$;

-- The approval chain of an invoice: execution projects SEE → SM Projects → DGM, others DGM; then Procurement, Finance, paid
create or replace function app.lo_invoice_chain(p_order uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select case when (select r.exec_project_id from public.lo_orders o join public.lo_requests r on r.id = o.request_id where o.id = p_order) is not null
              then array['see', 'smp', 'dgm', 'proc', 'finance', 'paid'] else array['dgm', 'proc', 'finance', 'paid'] end
$$;

-- p: {kind, invoice_no, invoice_date, amount, dn_nos, sub_invoice_id, received_on, note}
create or replace function public.lo_add_invoice(p_order uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; r public.lo_requests; iid uuid; k text := coalesce(nullif(p ->> 'kind', ''), 'invoice'); rec date := coalesce(nullif(p ->> 'received_on', '')::date, (now() at time zone app.tz())::date);
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records invoices');
  select * into o from public.lo_orders where id = p_order;
  perform app.require(found and o.status = 'open', 'Order not found or closed');
  select * into r from public.lo_requests where id = o.request_id;
  perform app.require(k in ('invoice', 'ipc', 'advance'), 'Invoice, IPC invoice or advance invoice?');
  perform app.require(k <> 'ipc' or o.kind = 'service', 'IPC invoices are for services');
  perform app.require(coalesce(btrim(p ->> 'invoice_no'), '') <> '', 'Enter the invoice no.');
  perform app.require(nullif(p ->> 'invoice_date', '')::date is not null, 'Enter the invoice date');
  perform app.require(nullif(p ->> 'amount', '')::numeric > 0, 'Enter the amount');
  perform app.require(rec <= (now() at time zone app.tz())::date, 'The received date cannot be in the future');
  -- material: against signed delivery notes (an advance invoice excepted)
  perform app.require(k = 'advance' or o.kind = 'service' or coalesce(btrim(p ->> 'dn_nos'), '') <> '', 'Enter the signed delivery note no(s). the invoice covers');
  if nullif(p ->> 'sub_invoice_id', '') is not null then
    perform app.require(exists (select 1 from public.sub_invoices where id = (p ->> 'sub_invoice_id')::uuid and exec_project_id = r.exec_project_id),
      'That subcontractor invoice is not on this project');
  end if;
  insert into public.lo_invoices (order_id, kind, invoice_no, invoice_date, amount, dn_nos, sub_invoice_id, received_on, note)
  values (p_order, k, btrim(p ->> 'invoice_no'), (p ->> 'invoice_date')::date, (p ->> 'amount')::numeric, nullif(btrim(p ->> 'dn_nos'), ''),
          nullif(p ->> 'sub_invoice_id', '')::uuid, rec, nullif(btrim(p ->> 'note'), ''))
  returning id into iid;
  return iid;
end $$;

-- Record (or clear, with a null date) one point of an invoice's chain, in order
create or replace function public.lo_invoice_step(p_id uuid, p_step text, p_date date, p_ref text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.lo_invoices; chain text[]; pos int; prev date; nxt date; o public.lo_orders;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records invoices');
  select * into i from public.lo_invoices where id = p_id for update;
  perform app.require(found and i.status <> 'cancelled', 'Invoice not found');
  chain := app.lo_invoice_chain(i.order_id);
  pos := array_position(chain, p_step);
  perform app.require(pos is not null, 'This approval does not apply to this project');
  prev := case when pos = 1 then i.received_on else (to_jsonb(i) ->> (chain[pos - 1] || '_on'))::date end;
  nxt := case when pos = cardinality(chain) then null else (to_jsonb(i) ->> (chain[pos + 1] || '_on'))::date end;
  if p_date is null then
    perform app.require(nxt is null, 'Clear the later approvals first');
  else
    perform app.require(prev is not null, 'Record the approvals before it first');
    perform app.require(p_date >= prev and p_date <= (now() at time zone app.tz())::date, format('Enter a date from %s to today', to_char(prev, 'DD Mon YYYY')));
  end if;
  execute format('update public.lo_invoices set %I = $1 where id = $2', p_step || '_on') using p_date, p_id;
  if p_step = 'paid' then
    update public.lo_invoices set status = case when p_date is null then 'open' else 'paid' end, pay_ref = case when p_date is null then null else nullif(btrim(p_ref), '') end where id = p_id;
    if p_date is not null then
      select * into o from public.lo_orders where id = i.order_id;
      perform app.notify_many(app.lo_followers(o.request_id), 'local_order', 'Invoice paid', app.lo_order_head(o) || ' · ' || i.invoice_no,
        'normal', 'lo_order', o.id, '/orders/local/' || o.id);
    end if;
  end if;
end $$;

create or replace function public.lo_cancel_invoice(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records invoices');
  update public.lo_invoices set status = 'cancelled' where id = p_id and status = 'open';
  perform app.require(found, 'Only an unpaid invoice can be cancelled');
end $$;

-- ---------------------------------------------------------------------------
-- Notes (Ops): mistakes, delays, complaints, notices – SM Projects, the GM / DGM, SM Estimation and the requester's side are told

create or replace function app.lo_note_people(p_request uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select app.role_users('sm_projects', 'gm', 'sm_estimation') || app.lo_followers(p_request)
$$;

create or replace function public.lo_add_note(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.lo_requests; o public.lo_orders; st int := nullif(p ->> 'stage', '')::int; k text := p ->> 'kind'; nid uuid;
        steps text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'steps', '[]'))), '{}'); bad text; dd int := nullif(p ->> 'delay_days', '')::int;
        occ date := nullif(p ->> 'occurred_on', '')::date; head text;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records these');
  if nullif(p ->> 'order_id', '') is not null then
    select * into o from public.lo_orders where id = (p ->> 'order_id')::uuid;
    perform app.require(found, 'Order not found');
    select * into r from public.lo_requests where id = o.request_id;
  else
    select * into r from public.lo_requests where id = nullif(p ->> 'request_id', '')::uuid;
    perform app.require(found, 'Request not found');
  end if;
  perform app.require(k in ('mistake', 'delay', 'complaint', 'notice'), 'Mistake, delay, complaint or notice?');
  perform app.require(st between 1 and 7, 'Choose the stage');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'What happened? (a short title)');
  perform app.require(occ is not null and occ <= (now() at time zone app.tz())::date, 'Enter the date (not in the future)');
  perform app.require(k <> 'delay' or dd is not null, 'A delay: how many working days?');
  select string_agg(x, ', ') into bad from unnest(steps) x where not exists (select 1 from public.lo_step_defs d where d.key = x and d.stage = st);
  perform app.require(bad is null, format('These steps are not in stage %s: %s', st, bad));
  insert into public.lo_notes (request_id, order_id, stage, steps, kind, party, title, details, occurred_on, delay_days)
  values (r.id, o.id, st, steps, k, nullif(btrim(p ->> 'party'), ''), btrim(p ->> 'title'), nullif(btrim(p ->> 'details'), ''), occ, case when k = 'delay' then dd end)
  returning id into nid;
  head := case when o.id is not null then app.lo_order_head(o) else app.lo_head(r) end;
  perform app.notify_many(app.lo_note_people(r.id), 'local_order', format('%s – %s', initcap(k), btrim(p ->> 'title')),
    format('%s · stage %s%s%s', head, st, case when nullif(btrim(p ->> 'party'), '') is not null then ' · ' || btrim(p ->> 'party') else '' end,
           case when k = 'delay' then format(' · %s working days', dd) else '' end),
    case when k in ('mistake', 'complaint') then 'critical'::public.priority else 'normal'::public.priority end,
    case when o.id is not null then 'lo_order' else 'lo_request' end, coalesce(o.id, r.id),
    case when o.id is not null then '/orders/local/' || o.id else '/orders/local/r/' || r.id end);
  return nid;
end $$;

create or replace function public.lo_resolve_note(p_id uuid, p_resolution text) returns void
language plpgsql security definer set search_path = public as $$
declare n public.lo_notes;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records these');
  select * into n from public.lo_notes where id = p_id for update;
  perform app.require(found and n.status = 'open', 'Not open');
  perform app.require(coalesce(btrim(p_resolution), '') <> '', 'How was it resolved?');
  update public.lo_notes set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution = btrim(p_resolution) where id = p_id;
  perform app.notify_many(app.lo_note_people(n.request_id), 'local_order', format('Resolved – %s', n.title), btrim(p_resolution), 'normal',
    case when n.order_id is not null then 'lo_order' else 'lo_request' end, coalesce(n.order_id, n.request_id),
    case when n.order_id is not null then '/orders/local/' || n.order_id else '/orders/local/r/' || n.request_id end);
end $$;

-- ---------------------------------------------------------------------------
-- Every morning: steps past their SLA, and orders past the required date without full delivery (Ops)
create or replace function public.lo_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; r public.lo_requests; o public.lo_orders; d public.lo_step_defs; n int := 0; st date; late text[];
begin
  for r in select * from public.lo_requests where status = 'open' loop
    late := '{}';
    for d in select * from public.lo_step_defs where sla_days is not null and scope = 'r' and not optional order by seq loop
      continue when not app.lo_r_applies(d.conds, r);
      continue when exists (select 1 from public.lo_steps where request_id = r.id and order_id is null and step = d.key);
      continue when app.lo_missing_before(r.id, null, d.key) is not null;
      st := app.lo_step_start(r.id, null, d.key);
      if st is not null and app.fo_workdays(st, today) > d.sla_days then late := late || format('%s (%s of %s days)', d.label, app.fo_workdays(st, today), d.sla_days); end if;
    end loop;
    for o in select * from public.lo_orders where request_id = r.id and status = 'open' loop
      for d in select * from public.lo_step_defs where sla_days is not null and scope = 'o' and not optional order by seq loop
        continue when not app.lo_applies(d.conds, o);
        continue when exists (select 1 from public.lo_steps where order_id = o.id and step = d.key);
        continue when app.lo_missing_before(r.id, o.id, d.key) is not null;
        st := app.lo_step_start(r.id, o.id, d.key);
        if st is not null and app.fo_workdays(st, today) > d.sla_days then late := late || format('%s %s (%s of %s days)', o.code, d.label, app.fo_workdays(st, today), d.sla_days); end if;
      end loop;
      if o.kind = 'material' and r.required_on is not null and r.required_on < today and extract(isodow from today) = 1
         and not exists (select 1 from public.lo_steps where order_id = o.id and step = 'delivered') then
        perform app.notify_many(app.role_users('operations_exec') || app.lo_followers(r.id), 'local_order', 'Past the required date',
          app.lo_order_head(o) || ' · needed by ' || to_char(r.required_on, 'DD Mon') || ', not fully delivered', 'normal', 'lo_order', o.id, '/orders/local/' || o.id,
          format('lo_due:%s:%s', o.id, today));
      end if;
    end loop;
    if cardinality(late) > 0 then
      perform app.notify_many(app.role_users('operations_exec'), 'local_order', 'Steps past their SLA', app.lo_head(r) || ' · ' || array_to_string(late, '; '),
        'normal', 'lo_request', r.id, '/orders/local/r/' || r.id, format('lo_sla:%s:%s', r.id, today));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.lo_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.lo_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('lo-tick', '25 3 * * *', 'select public.lo_tick()');   -- 08:55 Sri Lanka time
  end if;
end $$;

-- Reference files on a note (Ops attaches, everyone who reads the request reads them)
do $$
declare def text;
begin
  def := pg_get_functiondef('app.can_read_attachment(public.attachments)'::regprocedure);
  perform app.require(position('  case a.entity_type' || chr(10) || '  when ''fo_note'' then' in def) > 0, 'can_read_attachment anchor not found');
  def := replace(def, '  case a.entity_type' || chr(10) || '  when ''fo_note'' then',
    '  case a.entity_type' || chr(10) || '  when ''lo_note'' then' || chr(10) ||
    '    return exists (select 1 from public.lo_notes n where n.id = a.entity_id and app.lo_can_read(n.request_id));' || chr(10) || '  when ''fo_note'' then');
  execute def;
  def := pg_get_functiondef('app.can_write_attachment(text, uuid, text)'::regprocedure);
  perform app.require(position('  case p_entity_type' || chr(10) || '  when ''fo_note'' then' in def) > 0, 'can_write_attachment anchor not found');
  def := replace(def, '  case p_entity_type' || chr(10) || '  when ''fo_note'' then',
    '  case p_entity_type' || chr(10) || '  when ''lo_note'' then return p_kind = ''lo_reference'' and app.lo_keeper() and exists (select 1 from public.lo_notes where id = p_entity_id);' || chr(10) || '  when ''fo_note'' then');
  execute def;
end $$;

grant execute on function public.lo_save_request(uuid, jsonb), public.lo_return_request(uuid, text), public.lo_cancel_request(uuid, text),
  public.lo_set_pr(uuid, text, numeric), public.lo_close_if_done(uuid), public.lo_save_order(uuid, jsonb), public.lo_cancel_order(uuid, text),
  public.lo_record_step(uuid, uuid, text, date, text, text), public.lo_clear_step(uuid), public.lo_set_sla(text, int), public.lo_set_optional(text, boolean),
  public.lo_add_delivery(uuid, jsonb), public.lo_remove_delivery(uuid), public.lo_add_invoice(uuid, jsonb), public.lo_invoice_step(uuid, text, date, text),
  public.lo_cancel_invoice(uuid), public.lo_add_note(jsonb), public.lo_resolve_note(uuid, text) to authenticated;

select app.fix_function_owners();
