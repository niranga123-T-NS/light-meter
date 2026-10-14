-- Site material requests and the local / foreign orders made for them, kept in step (app.mr_sync):
--  1. Ordered when every order made for the request has its PO / LOA – one request split across several suppliers or
--     import orders stays "partly ordered" until the last one. The POs and suppliers are listed on the request.
--  2. Expected date: the latest expected date of its orders (local: expected / committed delivery; import: expected at
--     site). When it moves later, the requester, the project's AEs and the SEE are told.
--  3. Delivery: Operations recording a delivery (local) or "delivered" (import) tells the site to confirm the receipt in
--     the material request. The site's full receipt in the material request records "delivered" on its orders that are
--     still open – the delivery is entered once.
--  4. Operations sees the route (SAP / local / import) and the order's progress in Materials & stores (app side).

create or replace function app.mr_orders(p_mr uuid)
returns table (module text, order_id uuid, request_id uuid, code text, supplier text, po text, expected date, delivered boolean)
language sql stable security definer set search_path = public as $$
  select 'lo', o.id, r.id, coalesce(o.code, r.code), o.supplier,
         coalesce(o.po_no, (select s.ref from public.lo_steps s where s.order_id = o.id and s.step in ('po_issued', 'loa_issued') order by s.done_on desc limit 1)),
         coalesce(o.expected_on, o.committed_on),
         exists (select 1 from public.lo_steps s where s.order_id = o.id and s.step in ('delivered', 'work_done'))
    from public.lo_orders o join public.lo_requests r on r.id = o.request_id
   where r.mr_id = p_mr and r.status <> 'cancelled' and o.status <> 'cancelled'
  union all
  select 'fo', o.id, h.id, coalesce(o.code, h.code), o.vendor,
         coalesce(o.po_no, (select s.ref from public.fo_steps s where s.order_id = o.id and s.step = 'po_issued' limit 1)),
         app.fo_expected_site(o.id),
         exists (select 1 from public.fo_steps s where s.order_id = o.id and s.step = 'delivered')
    from public.fo_orders o join public.fo_handovers h on h.id = o.handover_id
   where h.mr_id = p_mr and h.status <> 'cancelled' and o.status <> 'cancelled'
$$;

create or replace function app.mr_sync(p_mr uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; n int; n_po int; exp date; pos text; sups text; people uuid[];
begin
  if p_mr is null or current_setting('app.purging', true) = 'on' then return; end if;
  select * into m from public.material_requests where id = p_mr for update;
  if not found or m.status in ('rejected', 'cancelled', 'received') then return; end if;
  select count(*), count(*) filter (where po is not null), max(expected), string_agg(distinct po, ', '), string_agg(distinct supplier, ', ')
    into n, n_po, exp, pos, sups from app.mr_orders(p_mr);
  if n = 0 then return; end if;
  people := app.project_aes(m.exec_project_id) || array[m.requested_by] || array(select see_id from public.exec_projects where id = m.exec_project_id and see_id is not null);
  if m.status = 'approved' and n_po = n then
    update public.material_requests set status = 'ordered', po_no = left(pos, 300), supplier = left(sups, 300), expected_date = coalesce(exp, expected_date, required_date),
           ordered_by = coalesce(ordered_by, auth.uid()), ordered_at = coalesce(ordered_at, now())
     where id = m.id;
    perform app.notify_many(people, 'exec_material', 'Material ordered',
      concat_ws(' · ', app.mr_head(m), 'PO ' || pos, 'expected ' || to_char(exp, 'DD Mon')), 'normal', 'material_request', m.id, '/execution/material/' || m.id);
    return;
  end if;
  if m.status = 'approved' then
    -- partly ordered: keep the POs so far on the request
    update public.material_requests set po_no = left(pos, 300), supplier = left(sups, 300) where id = m.id and (po_no is distinct from left(pos, 300) or supplier is distinct from left(sups, 300));
  end if;
  if exp is not null and exp is distinct from m.expected_date then
    update public.material_requests set expected_date = exp where id = m.id;
    if m.status in ('ordered', 'part_received') and m.expected_date is not null and exp > m.expected_date then
      perform app.notify_many(people, 'exec_material', 'Delivery date moved',
        concat_ws(' · ', app.mr_head(m), 'now expected ' || to_char(exp, 'DD Mon YYYY'), 'was ' || to_char(m.expected_date, 'DD Mon'),
                  case when m.required_date is not null and exp > m.required_date then 'required ' || to_char(m.required_date, 'DD Mon') end),
        case when m.required_date is not null and exp > m.required_date then 'critical' else 'normal' end::public.priority,
        'material_request', m.id, '/execution/material/' || m.id, format('mr_date:%s:%s', m.id, exp));
    end if;
  end if;
end $$;

-- what moves the request: orders, their steps and dates, shipments
create or replace function app.mr_sync_lo() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid := coalesce(new.request_id, old.request_id);
begin
  perform app.mr_sync((select mr_id from public.lo_requests where id = rid));
  return null;
end $$;
drop trigger if exists mr_sync on public.lo_orders;
create trigger mr_sync after insert or update of expected_on, committed_on, status, po_no on public.lo_orders for each row execute function app.mr_sync_lo();
create or replace function app.mr_sync_lo_req() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.mr_sync(coalesce(new.mr_id, old.mr_id));
  return null;
end $$;
drop trigger if exists mr_sync on public.lo_requests;
create trigger mr_sync after update of status on public.lo_requests for each row execute function app.mr_sync_lo_req();
create or replace function app.mr_sync_lo_step() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.mr_sync((select mr_id from public.lo_requests where id = coalesce(new.request_id, old.request_id)));
  return null;
end $$;
drop trigger if exists mr_sync on public.lo_steps;
create trigger mr_sync after insert or update or delete on public.lo_steps for each row execute function app.mr_sync_lo_step();

create or replace function app.mr_sync_fo() returns trigger
language plpgsql security definer set search_path = public as $$
declare hid uuid := coalesce(new.handover_id, old.handover_id);
begin
  perform app.mr_sync((select mr_id from public.fo_handovers where id = hid));
  return null;
end $$;
drop trigger if exists mr_sync on public.fo_orders;
create trigger mr_sync after insert or update of expected_ready, planned_mode, status, po_no on public.fo_orders for each row execute function app.mr_sync_fo();
drop trigger if exists fo_po_marks_mr on public.fo_steps;
drop function if exists app.fo_po_marks_mr();
drop trigger if exists mr_sync on public.fo_steps;
create trigger mr_sync after insert or update or delete on public.fo_steps for each row execute function app.mr_sync_fo();

create or replace function app.mr_sync_ship() returns trigger
language plpgsql security definer set search_path = public as $$
declare x uuid;
begin
  for x in select distinct h.mr_id from public.fo_shipment_orders so join public.fo_orders o on o.id = so.order_id join public.fo_handovers h on h.id = o.handover_id
            where so.shipment_id = coalesce(new.id, old.id) and h.mr_id is not null loop
    perform app.mr_sync(x);
  end loop;
  return null;
end $$;
drop trigger if exists mr_sync on public.fo_shipments;
create trigger mr_sync after update of eta on public.fo_shipments for each row execute function app.mr_sync_ship();
create or replace function app.mr_sync_ship_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.mr_sync((select h.mr_id from public.fo_orders o join public.fo_handovers h on h.id = o.handover_id where o.id = coalesce(new.order_id, old.order_id)));
  return null;
end $$;
drop trigger if exists mr_sync on public.fo_shipment_orders;
create trigger mr_sync after insert or delete on public.fo_shipment_orders for each row execute function app.mr_sync_ship_link();

-- 3. Operations records a delivery: the site is asked to confirm the receipt
create or replace function app.mr_delivery_notice() returns trigger
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; what text;
begin
  if current_setting('app.purging', true) = 'on' then return null; end if;
  if tg_table_name = 'lo_deliveries' then
    select mr.* into m from public.lo_orders o join public.lo_requests r on r.id = o.request_id join public.material_requests mr on mr.id = r.mr_id where o.id = new.order_id;
    what := concat_ws(' · ', 'DN ' || new.dn_no, to_char(new.delivered_on, 'DD Mon'));
  else
    if new.step <> 'delivered' or new.order_id is null then return null; end if;
    select mr.* into m from public.fo_handovers h join public.material_requests mr on mr.id = h.mr_id where h.id = new.handover_id;
    what := 'import delivered ' || to_char(new.done_on, 'DD Mon');
  end if;
  if m.id is null or m.status not in ('approved', 'ordered', 'part_received') then return null; end if;
  perform app.notify_many(app.project_aes(m.exec_project_id) || array[m.requested_by], 'exec_material', 'Delivered to site – confirm the receipt',
    concat_ws(' · ', app.mr_head(m), what), 'normal', 'material_request', m.id, '/execution/material/' || m.id, format('mr_dn:%s:%s', m.id, coalesce(new.id::text, '')), true);
  return null;
end $$;
drop trigger if exists mr_delivery_notice on public.lo_deliveries;
create trigger mr_delivery_notice after insert on public.lo_deliveries for each row execute function app.mr_delivery_notice();
drop trigger if exists mr_delivery_notice on public.fo_steps;
create trigger mr_delivery_notice after insert on public.fo_steps for each row execute function app.mr_delivery_notice();

-- 3. The site has received everything: the orders still open are marked delivered (entered once)
create or replace function app.mr_received_to_orders() returns trigger
language plpgsql security definer set search_path = public as $$
declare x record; today date := (now() at time zone app.tz())::date; note text;
begin
  if current_setting('app.purging', true) = 'on' or new.status <> 'received' or old.status = 'received' then return null; end if;
  note := 'Received at site – material request ' || coalesce(new.code, '');
  for x in select * from app.mr_orders(new.id) where not delivered loop
    if x.module = 'lo' then
      insert into public.lo_deliveries (order_id, delivered_on, dn_no, items, note, added_by)
      select x.order_id, today, 'Site receipt ' || coalesce(new.code, ''), 'All items received at site', note, coalesce(auth.uid(), new.requested_by)
       where not exists (select 1 from public.lo_deliveries d where d.order_id = x.order_id)
         and (select kind from public.lo_orders where id = x.order_id) = 'material';
      insert into public.lo_steps (request_id, order_id, step, done_on, note, recorded_by)
      select x.request_id, x.order_id, case when o.kind = 'service' then 'work_done' else 'delivered' end, today, note, coalesce(auth.uid(), new.requested_by)
        from public.lo_orders o where o.id = x.order_id
         and not exists (select 1 from public.lo_steps s where s.order_id = x.order_id and s.step in ('delivered', 'work_done'));
    else
      insert into public.fo_steps (handover_id, order_id, step, done_on, ref, recorded_by)
      select x.request_id, x.order_id, 'delivered', today, note, coalesce(auth.uid(), new.requested_by)
       where not exists (select 1 from public.fo_steps s where s.order_id = x.order_id and s.step = 'delivered');
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists mr_received_to_orders on public.material_requests;
create trigger mr_received_to_orders after update of status on public.material_requests for each row execute function app.mr_received_to_orders();


-- 4. For the app: the route each request took and how far its orders are (Materials & stores, the request page)
create or replace function public.mr_routes(p_ids uuid[])
returns table (mr_id uuid, module text, ref_id uuid, code text, orders int, ordered int, delivered int, expected date)
language sql stable security definer set search_path = public as $$
  select m.id, x.module, x.ref_id, x.code,
         (select count(*) from app.mr_orders(m.id))::int,
         (select count(*) from app.mr_orders(m.id) where po is not null)::int,
         (select count(*) from app.mr_orders(m.id) where delivered)::int,
         (select max(expected) from app.mr_orders(m.id))
    from public.material_requests m
    join lateral (
      select 'lo' as module, r.id as ref_id, r.code from public.lo_requests r where r.mr_id = m.id and r.status <> 'cancelled'
      union all
      select 'fo', h.id, h.code from public.fo_handovers h where h.mr_id = m.id and h.status <> 'cancelled'
    ) x on true
   where m.id = any(p_ids) and auth.uid() is not null
$$;
grant execute on function public.mr_routes(uuid[]) to authenticated;

create or replace function public.mr_route_orders(p_mr uuid)
returns table (module text, order_id uuid, ref_id uuid, code text, supplier text, po text, expected date, delivered boolean)
language sql stable security definer set search_path = public as $$
  select module, order_id, request_id, code, supplier, po, expected, delivered from app.mr_orders(p_mr) where auth.uid() is not null
$$;
grant execute on function public.mr_route_orders(uuid) to authenticated;

-- Local orders: the request is no longer marked ordered on the first PO (app.mr_sync decides)
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
    -- the site material request it came from: ordered once every order of it has its PO / LOA (app.mr_sync)
  end if;

  if r.mr_id is not null then perform app.mr_sync(r.mr_id); end if;

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

select app.purge_guard_triggers();
select app.fix_function_owners();
