-- Foreign orders (TESTING): tracking of foreign material and service orders from the Estimation Manager's hand-over to delivery.
--  * The work happens in company e-mail and SAP. The Operations Executive records every step here: a date, a reference number where
--    there is one, and a short note. No documents are attached.
--  * A hand-over (HO-) carries the client, the sales person, the SAP project and the final delivery location. Ops splits it into
--    import orders (IMP-): each with its own vendor, kind (material / service), Incoterm (EXW / FOB / CIF), payment (TT / LC),
--    duty (paid / free), and route of steps. A shipment (SHP-) can carry several import orders, even across hand-overs.
--  * Steps come from a catalogue (fo_step_defs): stage, order, the steps they follow and the conditions they apply under. The days
--    a step took are working days from the latest of the steps it follows. Ops can set an SLA per step; there are no standard dates.
--  * Seen by Ops, SM Estimation, SM Projects, the GM / DGM, the hand-over's sales person, and the project's SEE (without values).
--  * The delivery location is changed only with both SM Projects' and SM Estimation's approval; the sales person is told.
--  * Sales (and the SEE) are notified: shipped with the ETA, ETA changes, at clearing, customer signature needed (duty free),
--    released and delivered.

create table public.fo_handovers (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  project_id uuid references public.projects (id) on delete set null,
  project_name text not null,
  client text not null,
  sales_person_id uuid references public.profiles (id),
  received_on date not null,
  pi_ref text,
  client_new boolean not null default false,
  sap_project_no text,
  delivery_location text not null,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  notes text,
  cancel_reason text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.fo_handovers (status);
create index on public.fo_handovers (sales_person_id);
create index on public.fo_handovers (project_id);

create table public.fo_orders (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  handover_id uuid not null references public.fo_handovers (id) on delete cascade,
  seq_no int not null default 1,
  title text not null,
  kind text not null default 'material' check (kind in ('material', 'service')),
  vendor text not null,
  vendor_new boolean not null default false,
  codes_new boolean not null default false,
  incoterm text check (incoterm in ('EXW', 'FOB', 'CIF')),
  payment text not null default 'TT' check (payment in ('TT', 'LC')),
  duty text check (duty in ('paid', 'free')),
  inland boolean not null default false,
  required_on date,
  pr_nos text,
  po_no text,
  lc_no text,
  cipl_rounds int not null default 0 check (cipl_rounds >= 0),
  status text not null default 'open' check (status in ('open', 'delivered', 'cancelled')),
  notes text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fo_orders_material_terms check (kind = 'service' or (incoterm is not null and duty is not null))
);
create index on public.fo_orders (handover_id);
create index on public.fo_orders (status);

-- Values: seen by Ops, the sales person, SM Estimation, SM Projects and the GM / DGM – not by the SEE
create table public.fo_order_values (
  order_id uuid primary key references public.fo_orders (id) on delete cascade,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  pi_value numeric(16, 2) check (pi_value is null or pi_value >= 0),
  lc_amount numeric(16, 2) check (lc_amount is null or lc_amount >= 0),
  duty_lkr numeric(16, 2) check (duty_lkr is null or duty_lkr >= 0),
  updated_at timestamptz not null default now()
);

-- Payments: TT, or an LC with advance / part payments
create table public.fo_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.fo_orders (id) on delete cascade,
  kind text not null check (kind in ('advance', 'part', 'balance', 'full')),
  amount numeric(16, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  paid_on date not null,
  ref text,
  note text,
  added_by uuid not null default auth.uid() references public.profiles (id),
  added_at timestamptz not null default now()
);
create index on public.fo_payments (order_id);

create table public.fo_shipments (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  mode text not null default 'sea' check (mode in ('sea', 'air', 'courier')),
  carrier text,
  vessel_flight text,
  voyage text,
  bl_awb text,
  containers text,
  forwarder text,
  clearing_agent text,
  pol text,
  pod text,
  via text,
  onboard_at timestamptz,
  etd date,
  eta date,
  arrived_on date,
  last_checked_on date,
  last_check_note text,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fo_shipment_orders (
  shipment_id uuid not null references public.fo_shipments (id) on delete cascade,
  order_id uuid not null references public.fo_orders (id) on delete cascade,
  primary key (shipment_id, order_id)
);
create index on public.fo_shipment_orders (order_id);

create table public.fo_eta_log (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.fo_shipments (id) on delete cascade,
  eta date,
  note text,
  changed_by uuid default auth.uid() references public.profiles (id),
  changed_at timestamptz not null default now()
);
create index on public.fo_eta_log (shipment_id);

-- The step catalogue. scope: h = hand-over, o = import order. conds: all must hold (material, service, exw_fob, cif, tt, lc,
-- duty_paid, duty_free, client_new, vendor_new, codes_new, inland). after: the steps it follows (those that apply and are done).
create table public.fo_step_defs (
  key text primary key,
  scope text not null check (scope in ('h', 'o')),
  stage int not null check (stage between 1 and 9),
  seq int not null unique,
  label text not null,
  node text not null,
  conds text[] not null default '{}',
  after text[] not null default '{}',
  ref_label text,
  sla_days int check (sla_days is null or sla_days > 0),
  sla_by uuid references public.profiles (id),
  sla_at timestamptz
);

insert into public.fo_step_defs (key, scope, stage, seq, label, node, conds, after, ref_label) values
  ('ho_received',       'h', 1, 10, 'Hand-over received (PI + costing)',            'Estimation',            '{}', '{}', 'PI no.'),
  ('sap_checked',       'h', 2, 20, 'SAP checks done (client, vendors, codes)',     'Operations',            '{}', '{ho_received}', null),
  ('client_requested',  'h', 2, 21, 'Client details requested from Sales',         'Operations',            '{client_new}', '{sap_checked}', null),
  ('client_ready',      'h', 2, 22, 'Client registered in SAP',                    'Sales',                 '{client_new}', '{client_requested}', 'SAP client no.'),
  ('vendor_requested',  'o', 2, 23, 'Vendor registration request sent',            'Operations',            '{vendor_new}', '{sap_checked}', null),
  ('vendor_ready',      'o', 2, 24, 'Vendor registered in SAP',                    'Vendor registration',   '{vendor_new}', '{vendor_requested}', 'SAP vendor no.'),
  ('codes_requested',   'o', 2, 25, 'Material code request sent to MDM',           'Operations',            '{material,codes_new}', '{sap_checked}', 'MDM request'),
  ('codes_ready',       'o', 2, 26, 'Material codes created',                      'MDM',                   '{material,codes_new}', '{codes_requested}', null),
  ('project_requested', 'h', 3, 30, 'Project creation request raised',             'Operations',            '{}', '{sap_checked,client_ready,vendor_ready,codes_ready}', null),
  ('project_approved',  'h', 3, 31, 'DGM + FBP approval received',                 'Approvers',             '{}', '{project_requested}', null),
  ('sap_requested',     'h', 3, 32, 'SAP project request sent to Admin',           'Operations',            '{}', '{project_approved}', null),
  ('sap_created',       'h', 3, 33, 'SAP project no. and PR nos. received',        'Admin',                 '{}', '{sap_requested}', 'SAP project no.'),
  ('io_created',        'o', 4, 40, 'Import order created',                        'Operations',            '{}', '{sap_created}', null),
  ('io_approved',       'o', 4, 41, 'Import order approved (DGM → FBP → DIC)',     'Approvers',             '{}', '{io_created}', null),
  ('io_handed',         'o', 4, 42, 'Handed over to Procurement',                  'Operations',            '{}', '{io_approved}', null),
  ('po_issued',         'o', 5, 50, 'PO issued to the manufacturer',               'Procurement',           '{}', '{io_handed}', 'PO no.'),
  ('po_ack',            'o', 5, 51, 'PO acknowledged by the manufacturer',         'Manufacturer',          '{}', '{po_issued}', null),
  ('pay_applied',       'o', 5, 52, 'TT / LC application sent to Finance',         'Procurement',           '{}', '{po_issued}', null),
  ('tt_sent',           'o', 5, 53, 'TT sent by the bank',                         'Finance · bank',        '{tt}', '{pay_applied}', 'TT ref.'),
  ('lc_draft',          'o', 5, 54, 'Draft LC received from the bank',             'Finance · bank',        '{lc}', '{pay_applied}', null),
  ('lc_accepted',       'o', 5, 55, 'Draft LC accepted by the manufacturer',       'Manufacturer',          '{lc}', '{lc_draft}', null),
  ('lc_final',          'o', 5, 56, 'Final LC transmitted to the manufacturer',    'Finance · bank',        '{lc}', '{lc_accepted}', 'LC no.'),
  ('mfg_done',          'o', 6, 60, 'Manufacturing completed',                     'Manufacturer',          '{material}', '{po_ack,tt_sent,lc_final}', null),
  ('service_done',      'o', 6, 61, 'Service completed',                           'Service provider',      '{service}', '{po_ack,tt_sent,lc_final}', null),
  ('cipl_confirmed',    'o', 6, 62, 'Commercial invoice + packing list confirmed', 'Procurement',           '{material}', '{mfg_done}', 'CI no.'),
  ('forwarder_set',     'o', 6, 63, 'Forwarder appointed',                         'Logistics',             '{material,exw_fob}', '{cipl_confirmed}', 'Forwarder'),
  ('agent_set',         'o', 6, 64, 'Local clearing agent appointed',              'Logistics',             '{material,cif}', '{cipl_confirmed}', 'Clearing agent'),
  ('collected',         'o', 7, 70, 'Goods collected by the forwarder',            'Forwarder',             '{material,exw_fob}', '{forwarder_set}', null),
  ('inland_done',       'o', 7, 71, 'Inland transport to the port',                'Forwarder',             '{material,inland}', '{collected,cipl_confirmed}', null),
  ('docs_to_agent',     'o', 7, 72, 'CI + PL shared with the agent',               'Logistics',             '{material}', '{forwarder_set,agent_set}', null),
  ('shipped',           'o', 7, 73, 'Shipped – booking and sailing / flight confirmed', 'Forwarder',        '{material}', '{docs_to_agent,collected,inland_done}', 'B/L or AWB'),
  ('arrived',           'o', 8, 80, 'Arrival notice – at clearing',                'Logistics',             '{material}', '{shipped}', null),
  ('lc_endorsed',       'o', 8, 81, 'LC documents endorsed at the bank',           'Logistics · bank',      '{material,lc}', '{arrived}', null),
  ('duty_paid',         'o', 8, 82, 'Duty and charges paid',                       'Finance',               '{material,duty_paid}', '{arrived}', null),
  ('exbond_cusdec',     'o', 8, 83, 'Ex-bond CUSDEC received',                     'Logistics',             '{material,duty_free}', '{arrived}', 'CUSDEC no.'),
  ('exbond_invoice',    'o', 8, 84, 'Ex-bond invoice handed to Logistics',         'Operations',            '{material,duty_free}', '{exbond_cusdec}', 'Invoice no.'),
  ('tobond_cusdec',     'o', 8, 85, 'To-bond CUSDEC received – customer signature needed', 'Logistics',    '{material,duty_free}', '{exbond_invoice}', 'CUSDEC no.'),
  ('customer_signed',   'o', 8, 86, 'Customer signature collected, originals to Logistics', 'Sales · Operations', '{material,duty_free}', '{tobond_cusdec}', null),
  ('released',          'o', 8, 87, 'Cleared and released – delivery location confirmed', 'Logistics',      '{material}', '{arrived,lc_endorsed,duty_paid,customer_signed}', null),
  ('delivered',         'o', 9, 90, 'Delivered to the final location',            'Logistics',             '{}', '{released,service_done}', null);

create table public.fo_steps (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.fo_handovers (id) on delete cascade,
  order_id uuid references public.fo_orders (id) on delete cascade,
  step text not null references public.fo_step_defs (key),
  done_on date not null,
  ref text,
  note text,
  recorded_by uuid not null default auth.uid() references public.profiles (id),
  recorded_at timestamptz not null default now()
);
create unique index fo_steps_one on public.fo_steps (handover_id, coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid), step);
create index on public.fo_steps (order_id);

create table public.fo_location_changes (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.fo_handovers (id) on delete cascade,
  old_location text not null,
  new_location text not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  smp_by uuid references public.profiles (id),
  smp_at timestamptz,
  est_by uuid references public.profiles (id),
  est_at timestamptz,
  decision_note text,
  requested_by uuid not null default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now()
);
create index on public.fo_location_changes (handover_id);
create unique index fo_location_one_pending on public.fo_location_changes (handover_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Access

create or replace function app.fo_office() returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('operations_exec', 'sm_estimation', 'sm_projects', 'gm', 'sys_admin')
$$;
create or replace function app.fo_keeper() returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('operations_exec')
$$;
-- The project's SEE (execution project of the same CRM project)
create or replace function app.fo_see_of(p_handover uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select e.see_id from public.fo_handovers h join public.exec_projects e on e.project_id = h.project_id where h.id = p_handover limit 1
$$;
create or replace function app.fo_can_read(p_handover uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.fo_office() or exists (select 1 from public.fo_handovers h where h.id = p_handover and h.sales_person_id = auth.uid())
      or app.fo_see_of(p_handover) = auth.uid()
$$;
create or replace function app.fo_can_see_values(p_handover uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.fo_office() or exists (select 1 from public.fo_handovers h where h.id = p_handover and h.sales_person_id = auth.uid())
$$;
create or replace function app.fo_order_handover(p_order uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select handover_id from public.fo_orders where id = p_order
$$;
create or replace function app.fo_can_read_shipment(p_shipment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.fo_office() or exists (select 1 from public.fo_shipment_orders so join public.fo_orders o on o.id = so.order_id
                                     where so.shipment_id = p_shipment and app.fo_can_read(o.handover_id))
$$;

alter table public.fo_handovers enable row level security;
alter table public.fo_orders enable row level security;
alter table public.fo_order_values enable row level security;
alter table public.fo_payments enable row level security;
alter table public.fo_shipments enable row level security;
alter table public.fo_shipment_orders enable row level security;
alter table public.fo_eta_log enable row level security;
alter table public.fo_step_defs enable row level security;
alter table public.fo_steps enable row level security;
alter table public.fo_location_changes enable row level security;
create policy fo_handovers_read on public.fo_handovers for select to authenticated using (app.fo_can_read(id));
create policy fo_orders_read on public.fo_orders for select to authenticated using (app.fo_can_read(handover_id));
create policy fo_order_values_read on public.fo_order_values for select to authenticated using (app.fo_can_see_values(app.fo_order_handover(order_id)));
create policy fo_payments_read on public.fo_payments for select to authenticated using (app.fo_can_see_values(app.fo_order_handover(order_id)));
create policy fo_shipments_read on public.fo_shipments for select to authenticated using (app.fo_can_read_shipment(id));
create policy fo_shipment_orders_read on public.fo_shipment_orders for select to authenticated using (app.fo_can_read(app.fo_order_handover(order_id)));
create policy fo_eta_log_read on public.fo_eta_log for select to authenticated using (app.fo_can_read_shipment(shipment_id));
create policy fo_step_defs_read on public.fo_step_defs for select to authenticated using (true);
create policy fo_steps_read on public.fo_steps for select to authenticated using (app.fo_can_read(handover_id));
create policy fo_location_changes_read on public.fo_location_changes for select to authenticated using (app.fo_can_read(handover_id));
grant select on public.fo_handovers, public.fo_orders, public.fo_order_values, public.fo_payments, public.fo_shipments, public.fo_shipment_orders,
  public.fo_eta_log, public.fo_step_defs, public.fo_steps, public.fo_location_changes to authenticated;

-- Ops keeps the holiday list as well (clearing never counts weekends or public / mercantile holidays)
create policy holidays_write_ops on public.holidays for all to authenticated using (app.has_role('operations_exec')) with check (app.has_role('operations_exec'));

-- ---------------------------------------------------------------------------
-- Helpers

-- Working days from a to b (a not counted, b counted): Monday to Friday without public and mercantile holidays
create or replace function app.fo_workdays(a date, b date) returns int
language sql stable security definer set search_path = public as $$
  select case when a is null or b is null then null when b <= a then 0 else
    (select count(*)::int from generate_series(a + 1, b, interval '1 day') g(d)
      where extract(isodow from g.d) < 6 and not exists (select 1 from public.holidays h where h.day = g.d::date)) end
$$;

create or replace function app.fo_applies(p_conds text[], o public.fo_orders, h public.fo_handovers) returns boolean
language sql stable as $$
  select coalesce(bool_and(case c
      when 'material' then o.kind = 'material'
      when 'service' then o.kind = 'service'
      when 'exw_fob' then o.kind = 'material' and o.incoterm in ('EXW', 'FOB')
      when 'cif' then o.kind = 'material' and o.incoterm = 'CIF'
      when 'tt' then o.payment = 'TT'
      when 'lc' then o.payment = 'LC'
      when 'duty_paid' then o.kind = 'material' and o.duty = 'paid'
      when 'duty_free' then o.kind = 'material' and o.duty = 'free'
      when 'client_new' then h.client_new
      when 'vendor_new' then o.vendor_new
      when 'codes_new' then o.codes_new
      when 'inland' then o.inland
      else false end), true)
    from unnest(p_conds) c
$$;

-- Does a hand-over step apply? (only client_new is a hand-over condition)
create or replace function app.fo_h_applies(p_conds text[], h public.fo_handovers) returns boolean
language sql stable as $$
  select coalesce(bool_and(case c when 'client_new' then h.client_new else false end), true) from unnest(p_conds) c
$$;

-- The date a step starts: the latest done date of the steps it follows that apply. For a hand-over step, order steps count
-- across all its open orders; for an order step, its own order's steps and the hand-over's steps.
create or replace function app.fo_step_start(p_handover uuid, p_order uuid, p_step text) returns date
language sql stable security definer set search_path = public as $$
  select max(s.done_on) from public.fo_steps s join public.fo_step_defs d on d.key = s.step
   where s.handover_id = p_handover and s.step = any (coalesce((select after from public.fo_step_defs where key = p_step), '{}'::text[]))
     and (s.order_id is null or (p_order is null and exists (select 1 from public.fo_orders o where o.id = s.order_id and o.status <> 'cancelled'))
          or s.order_id = p_order)
$$;

-- Is every step it follows (that applies) done? Returns the label of the first missing one, or null
create or replace function app.fo_missing_before(p_handover uuid, p_order uuid, p_step text) returns text
language plpgsql stable security definer set search_path = public as $$
declare h public.fo_handovers; o public.fo_orders; d public.fo_step_defs; a public.fo_step_defs;
begin
  select * into h from public.fo_handovers where id = p_handover;
  select * into d from public.fo_step_defs where key = p_step;
  if p_order is not null then select * into o from public.fo_orders where id = p_order; end if;
  for a in select * from public.fo_step_defs where key = any (d.after) order by seq loop
    if a.scope = 'h' then
      if app.fo_h_applies(a.conds, h) and not exists (select 1 from public.fo_steps where handover_id = p_handover and order_id is null and step = a.key) then
        return a.label;
      end if;
    elsif p_order is not null then
      if app.fo_applies(a.conds, o, h) and not exists (select 1 from public.fo_steps where order_id = p_order and step = a.key) then
        return a.label;
      end if;
    else
      -- a hand-over step after order steps: every open order where it applies
      if exists (select 1 from public.fo_orders x where x.handover_id = p_handover and x.status <> 'cancelled' and app.fo_applies(a.conds, x, h)
                   and not exists (select 1 from public.fo_steps where order_id = x.id and step = a.key)) then
        return a.label || ' (all import orders)';
      end if;
    end if;
  end loop;
  return null;
end $$;

create or replace function app.fo_head(h public.fo_handovers) returns text
language sql stable as $$
  select concat_ws(' · ', h.code, h.project_name, h.client)
$$;
create or replace function app.fo_order_head(o public.fo_orders) returns text
language sql stable security definer set search_path = public as $$
  select concat_ws(' · ', o.code, o.title, (select project_name from public.fo_handovers where id = o.handover_id))
$$;
-- Who hears about an order's progress: the sales person and the project's SEE
create or replace function app.fo_followers(p_handover uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[(select sales_person_id from public.fo_handovers where id = p_handover), app.fo_see_of(p_handover)], null)
$$;

-- ---------------------------------------------------------------------------
-- Hand-overs and import orders (Ops)

-- p: {project_id, project_name, client, sales_person_id, received_on, pi_ref, client_new, delivery_location (new only), notes}
create or replace function public.fo_save_handover(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare h public.fo_handovers; hid uuid; rec date := nullif(p ->> 'received_on', '')::date;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records foreign orders');
  perform app.require(coalesce(btrim(p ->> 'project_name'), '') <> '', 'Enter the project');
  perform app.require(coalesce(btrim(p ->> 'client'), '') <> '', 'Enter the client');
  perform app.require(rec is not null and rec <= (now() at time zone app.tz())::date, 'Enter the date the hand-over was received');
  perform app.require(nullif(p ->> 'sales_person_id', '') is not null, 'Choose the sales person');
  if p_id is null then
    perform app.require(coalesce(btrim(p ->> 'delivery_location'), '') <> '', 'Enter the final delivery location');
    insert into public.fo_handovers (code, project_id, project_name, client, sales_person_id, received_on, pi_ref, client_new, delivery_location, notes)
    values (app.next_code('HO'), nullif(p ->> 'project_id', '')::uuid, btrim(p ->> 'project_name'), btrim(p ->> 'client'),
            (p ->> 'sales_person_id')::uuid, rec, nullif(btrim(p ->> 'pi_ref'), ''), coalesce((p ->> 'client_new')::boolean, false),
            btrim(p ->> 'delivery_location'), nullif(btrim(p ->> 'notes'), ''))
    returning id into hid;
    insert into public.fo_steps (handover_id, step, done_on, ref) values (hid, 'ho_received', rec, nullif(btrim(p ->> 'pi_ref'), ''));
    return hid;
  end if;
  select * into h from public.fo_handovers where id = p_id for update;
  perform app.require(found, 'Hand-over not found');
  perform app.require(h.status = 'open', 'The hand-over is closed');
  update public.fo_handovers set project_id = nullif(p ->> 'project_id', '')::uuid, project_name = btrim(p ->> 'project_name'), client = btrim(p ->> 'client'),
         sales_person_id = (p ->> 'sales_person_id')::uuid, received_on = rec, pi_ref = nullif(btrim(p ->> 'pi_ref'), ''),
         client_new = coalesce((p ->> 'client_new')::boolean, false), notes = nullif(btrim(p ->> 'notes'), ''), updated_at = now()
   where id = p_id;
  update public.fo_steps set done_on = rec, ref = nullif(btrim(p ->> 'pi_ref'), '') where handover_id = p_id and order_id is null and step = 'ho_received';
  select * into h from public.fo_handovers where id = p_id;
  perform app.require(not exists (select 1 from public.fo_steps st join public.fo_step_defs d on d.key = st.step
                                   where st.handover_id = p_id and st.order_id is null and not app.fo_h_applies(d.conds, h)),
    'Client steps are already recorded – clear them first');
  return p_id;
end $$;

-- p: {handover_id (new), title, kind, vendor, vendor_new, codes_new, incoterm, payment, duty, inland, required_on, pr_nos, notes,
--     currency, pi_value, lc_amount, duty_lkr}
create or replace function public.fo_save_order(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.fo_orders; h public.fo_handovers; oid uuid; k text := coalesce(p ->> 'kind', 'material');
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records foreign orders');
  if p_id is not null then
    select * into o from public.fo_orders where id = p_id for update;
    perform app.require(found, 'Import order not found');
    perform app.require(o.status = 'open', 'The import order is closed');
    select * into h from public.fo_handovers where id = o.handover_id;
  else
    select * into h from public.fo_handovers where id = nullif(p ->> 'handover_id', '')::uuid;
    perform app.require(h.id is not null, 'Hand-over not found');
    perform app.require(h.status = 'open', 'The hand-over is closed');
  end if;
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'What is ordered?');
  perform app.require(coalesce(btrim(p ->> 'vendor'), '') <> '', 'Enter the vendor / manufacturer');
  perform app.require(k in ('material', 'service'), 'Material or service?');
  perform app.require(coalesce(p ->> 'payment', '') in ('TT', 'LC'), 'Payment: TT or LC');
  if k = 'material' then
    perform app.require(coalesce(p ->> 'incoterm', '') in ('EXW', 'FOB', 'CIF'), 'Incoterm: EXW, FOB or CIF');
    perform app.require(coalesce(p ->> 'duty', '') in ('paid', 'free'), 'Duty paid or duty free?');
  end if;
  if p_id is null then
    insert into public.fo_orders (code, handover_id, seq_no, title, kind, vendor, payment, incoterm, duty)
    values (app.next_code('IMP'), h.id, coalesce((select max(seq_no) from public.fo_orders where handover_id = h.id), 0) + 1,
            btrim(p ->> 'title'), k, btrim(p ->> 'vendor'), p ->> 'payment', case when k = 'material' then p ->> 'incoterm' end,
            case when k = 'material' then p ->> 'duty' end)
    returning id into oid;
  else
    oid := p_id;
  end if;
  update public.fo_orders set title = btrim(p ->> 'title'), kind = k, vendor = btrim(p ->> 'vendor'),
         vendor_new = coalesce((p ->> 'vendor_new')::boolean, false), codes_new = coalesce((p ->> 'codes_new')::boolean, false),
         incoterm = case when k = 'material' then p ->> 'incoterm' end, payment = p ->> 'payment',
         duty = case when k = 'material' then p ->> 'duty' end, inland = k = 'material' and coalesce((p ->> 'inland')::boolean, false),
         required_on = nullif(p ->> 'required_on', '')::date, pr_nos = nullif(btrim(p ->> 'pr_nos'), ''), notes = nullif(btrim(p ->> 'notes'), ''),
         updated_at = now()
   where id = oid;
  -- a change of terms must not leave steps recorded that no longer apply
  perform app.require(not exists (select 1 from public.fo_steps st join public.fo_step_defs d on d.key = st.step join public.fo_orders x on x.id = st.order_id
                                   where st.order_id = oid and not app.fo_applies(d.conds, x, h)),
    'Steps already recorded no longer fit these terms – clear them first');
  insert into public.fo_order_values (order_id, currency, pi_value, lc_amount, duty_lkr)
  values (oid, coalesce(nullif(upper(btrim(p ->> 'currency')), ''), 'USD'), nullif(p ->> 'pi_value', '')::numeric, nullif(p ->> 'lc_amount', '')::numeric,
          nullif(p ->> 'duty_lkr', '')::numeric)
  on conflict (order_id) do update set currency = excluded.currency, pi_value = excluded.pi_value, lc_amount = excluded.lc_amount,
         duty_lkr = excluded.duty_lkr, updated_at = now();
  return oid;
end $$;

create or replace function public.fo_cancel_order(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records foreign orders');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  update public.fo_orders set status = 'cancelled', cancel_reason = btrim(p_reason), updated_at = now() where id = p_id and status = 'open';
  perform app.require(found, 'Only an open import order can be cancelled');
  perform public.fo_close_if_done((select handover_id from public.fo_orders where id = p_id));
end $$;

create or replace function public.fo_cancel_handover(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records foreign orders');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(not exists (select 1 from public.fo_orders where handover_id = p_id and status = 'delivered'), 'Some orders are already delivered');
  update public.fo_handovers set status = 'cancelled', cancel_reason = btrim(p_reason), updated_at = now() where id = p_id and status = 'open';
  perform app.require(found, 'Only an open hand-over can be cancelled');
  update public.fo_orders set status = 'cancelled', cancel_reason = btrim(p_reason), updated_at = now() where handover_id = p_id and status = 'open';
end $$;

-- A hand-over closes when every import order is delivered or cancelled (and at least one was delivered)
create or replace function public.fo_close_if_done(p_handover uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.fo_handovers h set status = 'closed', updated_at = now()
   where h.id = p_handover and h.status = 'open'
     and exists (select 1 from public.fo_orders where handover_id = h.id and status = 'delivered')
     and not exists (select 1 from public.fo_orders where handover_id = h.id and status = 'open');
end $$;
revoke execute on function public.fo_close_if_done(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Steps (Ops)

create or replace function public.fo_record_step(p_handover uuid, p_order uuid, p_step text, p_date date, p_ref text default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare h public.fo_handovers; o public.fo_orders; d public.fo_step_defs; miss text; st date; sid uuid; head text; ref text := nullif(btrim(p_ref), '');
        loc_note text;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records the steps');
  select * into d from public.fo_step_defs where key = p_step;
  perform app.require(found, 'Unknown step');
  if d.scope = 'o' then
    select * into o from public.fo_orders where id = p_order;
    perform app.require(found, 'Import order not found');
    perform app.require(o.status = 'open', 'The import order is closed');
    p_handover := o.handover_id;
  else
    p_order := null;
  end if;
  select * into h from public.fo_handovers where id = p_handover;
  perform app.require(found, 'Hand-over not found');
  perform app.require(h.status = 'open', 'The hand-over is closed');
  perform app.require(case when d.scope = 'o' then app.fo_applies(d.conds, o, h) else app.fo_h_applies(d.conds, h) end, 'This step does not apply to these terms');
  perform app.require(p_date is not null and p_date <= (now() at time zone app.tz())::date, 'Enter the date it was done (not in the future)');
  miss := app.fo_missing_before(p_handover, p_order, p_step);
  perform app.require(miss is null, format('Record "%s" first', miss));
  st := app.fo_step_start(p_handover, p_order, p_step);
  perform app.require(st is null or p_date >= st, format('The date cannot be before the step it follows (%s)', to_char(st, 'DD Mon YYYY')));
  if p_step in ('po_issued', 'lc_final', 'sap_created') then
    perform app.require(ref is not null, format('Enter the %s', d.ref_label));
  end if;
  insert into public.fo_steps (handover_id, order_id, step, done_on, ref, note)
  values (p_handover, p_order, p_step, p_date, ref, nullif(btrim(p_note), ''))
  on conflict (handover_id, coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid), step)
  do update set done_on = excluded.done_on, ref = excluded.ref, note = excluded.note, recorded_by = auth.uid(), recorded_at = now()
  returning id into sid;

  -- numbers kept on the record
  if p_step = 'sap_created' then update public.fo_handovers set sap_project_no = ref, updated_at = now() where id = p_handover; end if;
  if p_step = 'po_issued' then update public.fo_orders set po_no = ref, updated_at = now() where id = p_order; end if;
  if p_step = 'lc_final' then update public.fo_orders set lc_no = ref, updated_at = now() where id = p_order; end if;

  -- notifications
  if p_order is not null then head := app.fo_order_head(o); end if;
  if p_step = 'client_requested' then
    perform app.notify_many(array_remove(array[h.sales_person_id], null) || app.role_users('sm_estimation'), 'foreign_order',
      'Client not in SAP – send the client details', app.fo_head(h) || ' · Operations needs the client details to register the client in SAP.',
      'normal', 'fo_handover', h.id, '/orders/foreign/ho/' || h.id);
  elsif p_step = 'arrived' then
    perform app.notify_many(app.fo_followers(h.id), 'foreign_order', 'Order at clearing', head || ' · arrived ' || to_char(p_date, 'DD Mon') || ', clearing started',
      'normal', 'fo_order', o.id, '/orders/foreign/' || o.id);
    -- clearing cannot start on a weekend or holiday
    if not app.fo_workdays(p_date - 1, p_date) = 1 then
      perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', 'Arrived on a weekend or holiday',
        head || ' · clearing starts on the next working day', 'normal', 'fo_order', o.id, '/orders/foreign/' || o.id);
    end if;
  elsif p_step = 'tobond_cusdec' then
    perform app.notify_many(array_remove(array[h.sales_person_id], null), 'foreign_order', 'Customer signature needed – to-bond CUSDEC',
      head || ' · please arrange the customer''s signature; Operations will collect the signed document.', 'critical', 'fo_order', o.id,
      '/orders/foreign/' || o.id, format('fo_sign:%s:%s', o.id, p_date));
  elsif p_step = 'released' then
    perform app.notify_many(app.fo_followers(h.id), 'foreign_order', 'Order released from customs',
      head || ' · delivering to ' || h.delivery_location, 'normal', 'fo_order', o.id, '/orders/foreign/' || o.id);
  elsif p_step = 'delivered' then
    update public.fo_orders set status = 'delivered', updated_at = now() where id = p_order;
    perform app.notify_many(app.fo_followers(h.id), 'foreign_order', case when o.kind = 'service' then 'Service completed' else 'Order delivered' end,
      head || case when o.kind = 'material' then ' · delivered to ' || h.delivery_location else '' end, 'normal', 'fo_order', o.id, '/orders/foreign/' || o.id);
    perform public.fo_close_if_done(h.id);
  end if;
  return sid;
end $$;

-- Clear a step recorded by mistake (only if nothing recorded after it depends on it)
create or replace function public.fo_clear_step(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.fo_steps; o public.fo_orders;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records the steps');
  select * into s from public.fo_steps where id = p_id;
  perform app.require(found, 'Step not found');
  perform app.require(s.step <> 'ho_received', 'The hand-over date is changed on the hand-over');
  perform app.require(not exists (select 1 from public.fo_steps x join public.fo_step_defs d on d.key = x.step
                                   where x.handover_id = s.handover_id and s.step = any (d.after)
                                     and (s.order_id is null or x.order_id = s.order_id or x.order_id is null)),
    'Clear the steps recorded after it first');
  if s.order_id is not null then
    select * into o from public.fo_orders where id = s.order_id;
    perform app.require(o.status <> 'cancelled', 'The import order is cancelled');
    if s.step = 'delivered' then
      update public.fo_orders set status = 'open', updated_at = now() where id = s.order_id;
      update public.fo_handovers set status = 'open', updated_at = now() where id = s.handover_id and status = 'closed';
    end if;
  end if;
  delete from public.fo_steps where id = p_id;
end $$;

-- CI / PL correction rounds (kept on the board)
create or replace function public.fo_set_cipl_rounds(p_order uuid, p_rounds int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records the steps');
  perform app.require(p_rounds between 0 and 50, 'Enter the number of correction rounds');
  update public.fo_orders set cipl_rounds = p_rounds, updated_at = now() where id = p_order and status = 'open';
  perform app.require(found, 'Import order not found or closed');
end $$;

-- ---------------------------------------------------------------------------
-- Payments and values (Ops)

create or replace function public.fo_add_payment(p_order uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records foreign orders');
  perform app.require(exists (select 1 from public.fo_orders where id = p_order and status <> 'cancelled'), 'Import order not found');
  perform app.require(coalesce(p ->> 'kind', '') in ('advance', 'part', 'balance', 'full'), 'Which payment: advance, part, balance or full?');
  perform app.require(nullif(p ->> 'amount', '')::numeric > 0, 'Enter the amount');
  perform app.require(nullif(p ->> 'paid_on', '')::date is not null and (p ->> 'paid_on')::date <= (now() at time zone app.tz())::date, 'Enter the payment date');
  insert into public.fo_payments (order_id, kind, amount, currency, paid_on, ref, note)
  values (p_order, p ->> 'kind', (p ->> 'amount')::numeric, coalesce(nullif(upper(btrim(p ->> 'currency')), ''), 'USD'), (p ->> 'paid_on')::date,
          nullif(btrim(p ->> 'ref'), ''), nullif(btrim(p ->> 'note'), ''))
  returning id into pid;
  return pid;
end $$;

create or replace function public.fo_remove_payment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records foreign orders');
  delete from public.fo_payments where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Shipments (Ops). p: {mode, carrier, vessel_flight, voyage, bl_awb, containers, forwarder, clearing_agent, pol, pod, via, onboard_at,
--   etd, eta, notes, order_ids[]}. Sailing (ETD) records "Shipped" on each order; arrival records "Arrival notice".
create or replace function public.fo_save_shipment(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.fo_shipments; sid uuid; oid uuid; o public.fo_orders; new_eta date := nullif(p ->> 'eta', '')::date; is_new boolean := p_id is null;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records shipments');
  perform app.require(jsonb_array_length(coalesce(p -> 'order_ids', '[]')) > 0, 'Choose the import orders on this shipment');
  for oid in select (x #>> '{}')::uuid from jsonb_array_elements(p -> 'order_ids') x loop
    perform app.require(exists (select 1 from public.fo_orders where id = oid and kind = 'material' and status <> 'cancelled'), 'Only open material orders go on a shipment');
  end loop;
  perform app.require(coalesce(p ->> 'mode', 'sea') in ('sea', 'air', 'courier'), 'Sea, air or courier?');
  if p_id is null then
    insert into public.fo_shipments (code) values (app.next_code('SHP')) returning id into sid;
  else
    select * into s from public.fo_shipments where id = p_id for update;
    perform app.require(found, 'Shipment not found');
    sid := p_id;
  end if;
  update public.fo_shipments set mode = coalesce(p ->> 'mode', 'sea'), carrier = nullif(btrim(p ->> 'carrier'), ''),
         vessel_flight = nullif(btrim(p ->> 'vessel_flight'), ''), voyage = nullif(btrim(p ->> 'voyage'), ''), bl_awb = nullif(btrim(p ->> 'bl_awb'), ''),
         containers = nullif(btrim(p ->> 'containers'), ''), forwarder = nullif(btrim(p ->> 'forwarder'), ''),
         clearing_agent = nullif(btrim(p ->> 'clearing_agent'), ''), pol = nullif(btrim(p ->> 'pol'), ''), pod = nullif(btrim(p ->> 'pod'), ''),
         via = nullif(btrim(p ->> 'via'), ''), onboard_at = nullif(p ->> 'onboard_at', '')::timestamptz, etd = nullif(p ->> 'etd', '')::date,
         eta = new_eta, notes = nullif(btrim(p ->> 'notes'), ''), updated_at = now()
   where id = sid;
  delete from public.fo_shipment_orders where shipment_id = sid;
  insert into public.fo_shipment_orders (shipment_id, order_id) select sid, (x #>> '{}')::uuid from jsonb_array_elements(p -> 'order_ids') x on conflict do nothing;
  -- ETA changes are logged and told to the sales person and the SEE (once the shipment has sailed)
  if new_eta is distinct from s.eta and new_eta is not null then
    insert into public.fo_eta_log (shipment_id, eta, note) values (sid, new_eta, case when is_new or s.eta is null then 'First ETA' else 'Changed from ' || to_char(s.eta, 'DD Mon YYYY') end);
    if not is_new and s.eta is not null then
      for o in select x.* from public.fo_orders x join public.fo_shipment_orders so on so.order_id = x.id where so.shipment_id = sid and x.status = 'open'
                and exists (select 1 from public.fo_steps where order_id = x.id and step = 'shipped') loop
        perform app.notify_many(app.fo_followers(o.handover_id), 'foreign_order', 'ETA changed',
          app.fo_order_head(o) || format(' · ETA %s (was %s)', to_char(new_eta, 'DD Mon'), to_char(s.eta, 'DD Mon')), 'normal', 'fo_order', o.id,
          '/orders/foreign/' || o.id, format('fo_eta:%s:%s', o.id, new_eta));
      end loop;
    end if;
  end if;
  return sid;
end $$;

-- Sailing confirmed: records "Shipped" on every order on the shipment that has reached that point, and tells Sales and the SEE
create or replace function public.fo_ship(p_shipment uuid, p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare s public.fo_shipments; o public.fo_orders; n int := 0;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records shipments');
  select * into s from public.fo_shipments where id = p_shipment;
  perform app.require(found, 'Shipment not found');
  perform app.require(s.eta is not null, 'Enter the ETA first');
  for o in select x.* from public.fo_orders x join public.fo_shipment_orders so on so.order_id = x.id
            where so.shipment_id = p_shipment and x.status = 'open' and not exists (select 1 from public.fo_steps where order_id = x.id and step = 'shipped') loop
    perform public.fo_record_step(o.handover_id, o.id, 'shipped', p_date, coalesce(s.bl_awb, s.vessel_flight), null);
    perform app.notify_many(app.fo_followers(o.handover_id), 'foreign_order', 'Order shipped',
      app.fo_order_head(o) || format(' · %s from %s, ETA %s %s', coalesce(s.vessel_flight, s.mode), coalesce(s.pol, '—'), coalesce(s.pod, ''), to_char(s.eta, 'DD Mon YYYY')),
      'normal', 'fo_order', o.id, '/orders/foreign/' || o.id);
    n := n + 1;
  end loop;
  update public.fo_shipments set etd = coalesce(etd, p_date), updated_at = now() where id = p_shipment;
  return n;
end $$;

-- Arrival notice: records "Arrival notice" on every order on the shipment
create or replace function public.fo_arrive(p_shipment uuid, p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare o public.fo_orders; n int := 0;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records shipments');
  for o in select x.* from public.fo_orders x join public.fo_shipment_orders so on so.order_id = x.id
            where so.shipment_id = p_shipment and x.status = 'open' and not exists (select 1 from public.fo_steps where order_id = x.id and step = 'arrived') loop
    perform public.fo_record_step(o.handover_id, o.id, 'arrived', p_date, null, null);
    n := n + 1;
  end loop;
  update public.fo_shipments set arrived_on = p_date, updated_at = now() where id = p_shipment;
  return n;
end $$;

-- Ops checked the tracking online (or heard from Logistics)
create or replace function public.fo_check_shipment(p_shipment uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records shipments');
  update public.fo_shipments set last_checked_on = (now() at time zone app.tz())::date, last_check_note = nullif(btrim(p_note), ''), updated_at = now()
   where id = p_shipment;
  perform app.require(found, 'Shipment not found');
end $$;

-- ---------------------------------------------------------------------------
-- Delivery location: Ops requests, SM Projects and SM Estimation both approve, Sales is told

create or replace function public.fo_request_location(p_handover uuid, p_location text, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare h public.fo_handovers; cid uuid;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive requests the change');
  select * into h from public.fo_handovers where id = p_handover;
  perform app.require(found and h.status = 'open', 'Hand-over not found or closed');
  perform app.require(coalesce(btrim(p_location), '') <> '' and btrim(p_location) <> h.delivery_location, 'Enter the new delivery location');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(not exists (select 1 from public.fo_location_changes where handover_id = p_handover and status = 'pending'), 'A change is already waiting for approval');
  insert into public.fo_location_changes (handover_id, old_location, new_location, reason) values (p_handover, h.delivery_location, btrim(p_location), btrim(p_reason))
  returning id into cid;
  perform app.notify_many(app.role_users('sm_projects', 'sm_estimation'), 'foreign_order', 'Delivery location change to approve',
    app.fo_head(h) || ' · ' || btrim(p_location), 'normal', 'fo_handover', h.id, '/orders/foreign/ho/' || h.id, null, true);
  return cid;
end $$;

create or replace function public.fo_decide_location(p_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.fo_location_changes; h public.fo_handovers;
begin
  select * into c from public.fo_location_changes where id = p_id for update;
  perform app.require(found and c.status = 'pending', 'Not waiting for approval');
  select * into h from public.fo_handovers where id = c.handover_id;
  if p_action = 'withdraw' then
    perform app.require(app.fo_keeper(), 'The Operations Executive withdraws it');
    update public.fo_location_changes set status = 'withdrawn' where id = p_id;
    return;
  end if;
  perform app.require(p_action in ('approve', 'reject'), 'Approve or reject');
  perform app.require(app.has_role('sm_projects', 'sm_estimation'), 'SM Projects and SM Estimation approve delivery location changes');
  if p_action = 'reject' then
    perform app.require(coalesce(btrim(p_note), '') <> '', 'Give the reason');
    update public.fo_location_changes set status = 'rejected', decision_note = btrim(p_note),
           smp_by = case when app.has_role('sm_projects') then auth.uid() else smp_by end, smp_at = case when app.has_role('sm_projects') then now() else smp_at end,
           est_by = case when app.has_role('sm_estimation') then auth.uid() else est_by end, est_at = case when app.has_role('sm_estimation') then now() else est_at end
     where id = p_id;
    perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', 'Delivery location change rejected', app.fo_head(h) || ' · ' || btrim(p_note),
      'normal', 'fo_handover', h.id, '/orders/foreign/ho/' || h.id);
    return;
  end if;
  if app.has_role('sm_projects') then
    perform app.require(c.smp_by is null, 'Already approved by SM Projects');
    update public.fo_location_changes set smp_by = auth.uid(), smp_at = now() where id = p_id returning * into c;
  else
    perform app.require(c.est_by is null, 'Already approved by SM Estimation');
    update public.fo_location_changes set est_by = auth.uid(), est_at = now() where id = p_id returning * into c;
  end if;
  if c.smp_by is not null and c.est_by is not null then
    update public.fo_location_changes set status = 'approved', decision_note = nullif(btrim(p_note), '') where id = p_id;
    update public.fo_handovers set delivery_location = c.new_location, updated_at = now() where id = c.handover_id;
    perform app.notify_many(app.fo_followers(h.id) || app.role_users('operations_exec'), 'foreign_order', 'Delivery location changed',
      app.fo_head(h) || ' · now ' || c.new_location, 'normal', 'fo_handover', h.id, '/orders/foreign/ho/' || h.id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SLA per step (Ops; optional)

create or replace function public.fo_set_sla(p_step text, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fo_keeper() or app.has_role('sys_admin'), 'The Operations Executive sets the SLAs');
  perform app.require(p_days is null or p_days between 1 and 365, 'Enter the working days, or leave empty for no SLA');
  update public.fo_step_defs set sla_days = p_days, sla_by = auth.uid(), sla_at = now() where key = p_step;
  perform app.require(found, 'Unknown step');
end $$;

-- ---------------------------------------------------------------------------
-- Every morning: steps past their SLA (Ops), customer signature still outstanding (Sales and Ops), ETA after the required date
create or replace function public.fo_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; o public.fo_orders; h public.fo_handovers; d public.fo_step_defs; n int := 0; st date;
        late text[] := '{}'; eta date; r record;
begin
  for o in select * from public.fo_orders where status = 'open' loop
    select * into h from public.fo_handovers where id = o.handover_id;
    continue when h.status <> 'open';
    late := '{}';
    -- current steps: apply, not done, and everything they follow is done
    for d in select * from public.fo_step_defs where sla_days is not null order by seq loop
      continue when (d.scope = 'o' and not app.fo_applies(d.conds, o, h)) or (d.scope = 'h' and not app.fo_h_applies(d.conds, h));
      continue when exists (select 1 from public.fo_steps where handover_id = h.id and step = d.key and (order_id = o.id or (d.scope = 'h' and order_id is null)));
      continue when app.fo_missing_before(h.id, case when d.scope = 'o' then o.id end, d.key) is not null;
      st := app.fo_step_start(h.id, case when d.scope = 'o' then o.id end, d.key);
      if st is not null and app.fo_workdays(st, today) > d.sla_days then
        late := late || format('%s (%s of %s days)', d.label, app.fo_workdays(st, today), d.sla_days);
      end if;
    end loop;
    if cardinality(late) > 0 then
      perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', 'Steps past their SLA', app.fo_order_head(o) || ' · ' || array_to_string(late, '; '),
        'normal', 'fo_order', o.id, '/orders/foreign/' || o.id, format('fo_sla:%s:%s', o.id, today));
      n := n + 1;
    end if;
    -- customer signature on the to-bond CUSDEC still outstanding
    if exists (select 1 from public.fo_steps where order_id = o.id and step = 'tobond_cusdec')
       and not exists (select 1 from public.fo_steps where order_id = o.id and step = 'customer_signed') then
      perform app.notify_many(array_remove(array[h.sales_person_id], null) || app.role_users('operations_exec'), 'foreign_order', 'Customer signature still needed',
        app.fo_order_head(o) || ' · to-bond CUSDEC waiting for the customer''s signature', 'critical', 'fo_order', o.id, '/orders/foreign/' || o.id,
        format('fo_sign:%s:%s', o.id, today));
      n := n + 1;
    end if;
    -- ETA after the site's required date (once per ETA)
    select max(sh.eta) into eta from public.fo_shipments sh join public.fo_shipment_orders so on so.shipment_id = sh.id where so.order_id = o.id and sh.arrived_on is null;
    if o.required_on is not null and eta is not null and eta > o.required_on then
      perform app.notify_many(app.role_users('operations_exec', 'sm_projects', 'gm') || app.fo_followers(h.id), 'foreign_order', 'ETA after the required date',
        app.fo_order_head(o) || format(' · ETA %s, needed by %s', to_char(eta, 'DD Mon'), to_char(o.required_on, 'DD Mon')), 'normal', 'fo_order', o.id,
        '/orders/foreign/' || o.id, format('fo_late:%s:%s', o.id, eta));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.fo_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.fo_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('fo-tick', '20 3 * * *', 'select public.fo_tick()');   -- 08:50 Sri Lanka time
  end if;
end $$;

grant execute on function public.fo_save_handover(uuid, jsonb), public.fo_save_order(uuid, jsonb), public.fo_cancel_order(uuid, text),
  public.fo_cancel_handover(uuid, text), public.fo_record_step(uuid, uuid, text, date, text, text), public.fo_clear_step(uuid),
  public.fo_set_cipl_rounds(uuid, int), public.fo_add_payment(uuid, jsonb), public.fo_remove_payment(uuid), public.fo_save_shipment(uuid, jsonb),
  public.fo_ship(uuid, date), public.fo_arrive(uuid, date), public.fo_check_shipment(uuid, text), public.fo_request_location(uuid, text, text),
  public.fo_decide_location(uuid, text, text), public.fo_set_sla(text, int) to authenticated;
