-- Foreign and local orders (TESTING): expected dates that move, with the first date kept as the committed baseline.
--  * Foreign: the expected ready date at the factory (from the PO acknowledgement). Expected at site = the shipment ETA once there
--    is one, else ready date + transit by the planned freight (sea 25, air 4, courier 5 days), plus clearing and delivery
--    (7 days). Local: the expected delivery / completion date (from the lead time).
--  * Ops changes a date with a reason (manufacturer / supplier, raw material, payment, documents, shipping line / airline, customs,
--    other) and who caused it; every change is kept. A shipment ETA change (by Ops or the flight check) is kept the same way for
--    each order on the shipment, against the shipping line / airline.
--  * The requester's side (sales person, SEE, requester) is told of every change; SM Projects and the GM / DGM only when the
--    order now arrives after its required date.

alter table public.fo_orders add column if not exists expected_ready date;
alter table public.fo_orders add column if not exists committed_ready date;
alter table public.lo_orders add column if not exists expected_on date;
alter table public.lo_orders add column if not exists committed_on date;

create table public.order_date_changes (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in ('fo', 'lo')),
  order_id uuid not null,
  kind text not null check (kind in ('ready', 'eta', 'delivery')),
  old_date date,
  new_date date not null,
  reason text not null check (reason in ('first', 'supplier', 'material', 'payment', 'documents', 'carrier', 'customs', 'other')),
  party text,
  note text,
  changed_by uuid default auth.uid() references public.profiles (id),
  changed_at timestamptz not null default now()
);
create index on public.order_date_changes (module, order_id);

alter table public.order_date_changes enable row level security;
create policy order_date_changes_read on public.order_date_changes for select to authenticated using (
  case module when 'fo' then app.fo_can_read(app.fo_order_handover(order_id)) else app.lo_can_read(app.lo_order_request(order_id)) end);
grant select on public.order_date_changes to authenticated;

create or replace function app.order_reason_label(r text) returns text language sql immutable as $$
  select case r when 'supplier' then 'Manufacturer / supplier delay' when 'material' then 'Raw material' when 'payment' then 'Payment delay'
    when 'documents' then 'Documents' when 'carrier' then 'Shipping line / airline' when 'customs' then 'Customs' when 'first' then 'First date' else 'Other' end
$$;

-- Expected at site for an import order: the latest shipment's ETA, else the ready date plus transit by the planned freight; plus clearing and delivery
create or replace function app.fo_expected_site(p_order uuid) returns date
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.eta from public.fo_shipment_orders so join public.fo_shipments s on s.id = so.shipment_id
      where so.order_id = p_order and s.eta is not null order by s.eta desc limit 1),
    (select o.expected_ready + case coalesce(o.planned_mode, 'sea') when 'air' then 4 when 'courier' then 5 else 25 end from public.fo_orders o where o.id = p_order)
  ) + 7
$$;

-- The managers hear only when the order now arrives after the date it is required
create or replace function app.order_date_alert(p_module text, p_order uuid, p_head text, p_new date, p_required date, p_msg text, p_url text, p_people uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.notify_many(p_people, case p_module when 'fo' then 'foreign_order' else 'local_order' end, 'Expected date changed', p_head || ' · ' || p_msg,
    'normal', case p_module when 'fo' then 'fo_order' else 'lo_order' end, p_order, p_url, format('%s_date:%s:%s', p_module, p_order, p_new));
  if p_required is not null and p_new > p_required then
    perform app.notify_many(app.role_users('sm_projects', 'gm'), case p_module when 'fo' then 'foreign_order' else 'local_order' end,
      'Order now after its required date', p_head || ' · ' || p_msg || ' · required ' || to_char(p_required, 'DD Mon YYYY'),
      'critical', case p_module when 'fo' then 'fo_order' else 'lo_order' end, p_order, p_url, format('%s_late:%s:%s', p_module, p_order, p_new));
  end if;
end $$;

-- Ops sets or changes the expected ready date (foreign) – the first one is the committed date
create or replace function public.fo_set_expected(p_order uuid, p_date date, p_reason text default null, p_party text default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.fo_orders; site date; first boolean;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records the dates');
  select * into o from public.fo_orders where id = p_order for update;
  perform app.require(found and o.status = 'open', 'Import order not found or closed');
  perform app.require(o.kind = 'material', 'The ready date is for material orders');
  perform app.require(p_date is not null, 'Enter the date');
  first := o.expected_ready is null;
  perform app.require(first or p_date is distinct from o.expected_ready, 'The date is the same');
  perform app.require(first or p_reason in ('supplier', 'material', 'payment', 'documents', 'carrier', 'customs', 'other'), 'Choose the reason for the change');
  update public.fo_orders set expected_ready = p_date, committed_ready = coalesce(committed_ready, p_date), updated_at = now() where id = p_order;
  insert into public.order_date_changes (module, order_id, kind, old_date, new_date, reason, party, note)
  values ('fo', p_order, 'ready', o.expected_ready, p_date, case when first then 'first' else p_reason end, nullif(btrim(p_party), ''), nullif(btrim(p_note), ''));
  if not first then
    site := app.fo_expected_site(p_order);
    perform app.order_date_alert('fo', p_order, app.fo_order_head(o), site, o.required_on,
      format('ready at the factory %s (was %s, committed %s) – %s · expected at site about %s', to_char(p_date, 'DD Mon'), to_char(o.expected_ready, 'DD Mon'),
             to_char(o.committed_ready, 'DD Mon'), app.order_reason_label(p_reason), to_char(site, 'DD Mon YYYY')),
      '/orders/foreign/' || p_order, app.fo_followers(o.handover_id));
  end if;
end $$;

-- Ops sets or changes the expected delivery / completion date (local)
create or replace function public.lo_set_expected(p_order uuid, p_date date, p_reason text default null, p_party text default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; r public.lo_requests; first boolean;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records the dates');
  select * into o from public.lo_orders where id = p_order for update;
  perform app.require(found and o.status = 'open', 'Order not found or closed');
  select * into r from public.lo_requests where id = o.request_id;
  perform app.require(p_date is not null, 'Enter the date');
  first := o.expected_on is null;
  perform app.require(first or p_date is distinct from o.expected_on, 'The date is the same');
  perform app.require(first or p_reason in ('supplier', 'material', 'payment', 'documents', 'carrier', 'customs', 'other'), 'Choose the reason for the change');
  update public.lo_orders set expected_on = p_date, committed_on = coalesce(committed_on, p_date), updated_at = now() where id = p_order;
  insert into public.order_date_changes (module, order_id, kind, old_date, new_date, reason, party, note)
  values ('lo', p_order, 'delivery', o.expected_on, p_date, case when first then 'first' else p_reason end, nullif(btrim(p_party), ''), nullif(btrim(p_note), ''));
  if not first then
    perform app.order_date_alert('lo', p_order, app.lo_order_head(o), p_date, r.required_on,
      format('%s now %s (was %s, committed %s) – %s', case when o.kind = 'service' then 'completion' else 'delivery' end, to_char(p_date, 'DD Mon YYYY'),
             to_char(o.expected_on, 'DD Mon'), to_char(o.committed_on, 'DD Mon'), app.order_reason_label(p_reason)),
      '/orders/local/' || p_order, app.lo_followers(r.id));
  end if;
end $$;

-- A shipment ETA change (Ops or the flight check): kept for each open order on it, against the shipping line / airline;
-- the managers hear when an order now arrives after its required date (the owners already hear of ETA changes)
create or replace function app.fo_eta_logged() returns trigger
language plpgsql security definer set search_path = public as $$
declare prev date; o public.fo_orders; s public.fo_shipments; site date;
begin
  select eta into prev from public.fo_eta_log where shipment_id = new.shipment_id and id <> new.id and changed_at <= new.changed_at order by changed_at desc limit 1;
  select * into s from public.fo_shipments where id = new.shipment_id;
  for o in select x.* from public.fo_shipment_orders so join public.fo_orders x on x.id = so.order_id where so.shipment_id = new.shipment_id and x.status = 'open' loop
    insert into public.order_date_changes (module, order_id, kind, old_date, new_date, reason, party, note)
    values ('fo', o.id, 'eta', prev, new.eta, case when prev is null then 'first' else 'carrier' end, coalesce(s.carrier, case s.mode when 'air' then 'Airline' else 'Shipping line' end), new.note);
    site := new.eta + 7;
    if prev is not null and new.eta > prev and o.required_on is not null and site > o.required_on then
      perform app.notify_many(app.role_users('sm_projects', 'gm'), 'foreign_order', 'Order now after its required date',
        app.fo_order_head(o) || format(' · ETA %s (was %s), at site about %s · required %s', to_char(new.eta, 'DD Mon'), to_char(prev, 'DD Mon'),
                                       to_char(site, 'DD Mon YYYY'), to_char(o.required_on, 'DD Mon YYYY')),
        'critical', 'fo_order', o.id, '/orders/foreign/' || o.id, format('fo_late:%s:%s', o.id, site));
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists fo_eta_logged on public.fo_eta_log;
create trigger fo_eta_logged after insert on public.fo_eta_log for each row when (new.eta is not null) execute function app.fo_eta_logged();

grant execute on function public.fo_set_expected(uuid, date, text, text, text), public.lo_set_expected(uuid, date, text, text, text) to authenticated;

select app.fix_function_owners();
