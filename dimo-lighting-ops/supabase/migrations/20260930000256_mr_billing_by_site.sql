-- How a service the site asks for is paid (single invoice, IPC, per deliverable, hire) is chosen with the request by the
-- requester / AEs and corrected by the SEE (or SM Projects); it carries over to the local orders, where Operations cannot
-- change it. Operations keeps the payment term (advance %, bond, LC) – it is agreed with the provider.

alter table public.material_requests add column if not exists billing text check (billing in ('single', 'ipc', 'milestone', 'hire'));
alter table public.material_requests add column if not exists billing_by uuid references public.profiles (id) on delete set null;
-- the services asked for so far: a single invoice unless their orders already say otherwise
update public.material_requests m set billing = coalesce((select o.billing from public.lo_orders o join public.lo_requests r on r.id = o.request_id
                                                          where r.mr_id = m.id and o.kind = 'service' and o.status <> 'cancelled' order by o.created_at limit 1), 'single')
 where m.kind = 'service' and m.billing is null;

create or replace function app.billing_label(p text) returns text language sql immutable as $$
  select case p when 'single' then 'Single invoice' when 'ipc' then 'Paid by IPC' when 'milestone' then 'Per deliverable (work basis)' when 'hire' then 'Hire – per period' else p end
$$;

/** The requester / the project's AEs (before approval) or the SEE / SM Projects: how the service is paid. Its open local
 *  orders follow (their payment term moves to the nearest that fits). */
create or replace function public.set_mr_billing(p_id uuid, p_billing text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; lead boolean := app.has_role('senior_elec_engineer', 'sm_projects'); o public.lo_orders; t text; n int := 0;
begin
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(found, 'Request not found');
  perform app.require(m.kind = 'service', 'Only a service is paid this way');
  perform app.require(p_billing in ('single', 'ipc', 'milestone', 'hire'), 'Single invoice, IPC, per deliverable or hire?');
  if m.status in ('ae_review', 'submitted', 'pending_smp') then
    perform app.require(lead or m.requested_by = auth.uid() or app.is_project_ae(m.exec_project_id), 'The requester, the project''s AEs or the SEE choose how it is paid');
  elsif m.status in ('approved', 'ordered') then
    perform app.require(lead, 'After approval only the SEE changes how it is paid');
  else
    perform app.require(false, 'This request can no longer change');
  end if;
  if m.billing is not distinct from p_billing then return; end if;
  for o in select x.* from public.lo_orders x join public.lo_requests r on r.id = x.request_id
            where r.mr_id = m.id and x.kind = 'service' and x.status = 'open' for update of x loop
    perform app.require(p_billing = 'milestone' or not exists (select 1 from public.lo_work_stages where order_id = o.id),
      format('%s has deliverables recorded – Operations removes them first', o.code));
    perform app.require(p_billing = 'hire' or not exists (select 1 from public.lo_invoices where order_id = o.id and period_from is not null and status <> 'cancelled'),
      format('%s has hire invoices – it stays a hire', o.code));
    t := app.lo_map_term(o.payment_term, p_billing);
    update public.lo_orders set billing = p_billing, payment_term = t, advance_pct = case when t like 'advance%' then coalesce(advance_pct, 10) end,
           hire_unit = case when p_billing = 'hire' then coalesce(hire_unit, 'day') end, updated_at = now() where id = o.id;
    n := n + 1;
    perform app.notify_many(app.role_users('operations_exec'), 'local_order', 'How the service is paid changed',
      concat_ws(' · ', app.lo_order_head(o), app.billing_label(o.billing) || ' → ' || app.billing_label(p_billing), 'check the payment term'),
      'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  end loop;
  update public.material_requests set billing = p_billing, billing_by = auth.uid() where id = m.id;
end $$;
grant execute on function public.set_mr_billing(uuid, text) to authenticated;

-- Operations cannot change how a site's service is paid
create or replace function public.lo_set_billing(p_order uuid, p_billing text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; t text; site_b text;
begin
  perform app.require(app.lo_keeper(), 'Operations records local orders');
  select * into o from public.lo_orders where id = p_order for update;
  perform app.require(found, 'Order not found');
  perform app.require(p_billing in ('single', 'ipc', 'hire', 'milestone'), 'Single invoice, IPC, work basis or hire?');
  perform app.require(o.kind = 'service' or p_billing = 'single', 'Materials are billed by invoice');
  select m.billing into site_b from public.lo_requests r join public.material_requests m on m.id = r.mr_id where r.id = o.request_id and m.kind = 'service';
  perform app.require(site_b is null or site_b = p_billing, format('The site chose "%s" on the service request – ask the SEE to change it there', app.billing_label(site_b)));
  perform app.require(p_billing = 'milestone' or not exists (select 1 from public.lo_work_stages where order_id = o.id), 'This order has work stages – remove them first');
  t := app.lo_map_term(o.payment_term, p_billing);
  update public.lo_orders set billing = p_billing, payment_term = t, advance_pct = case when t like 'advance%' then coalesce(advance_pct, 10) end,
         hire_unit = case when p_billing = 'hire' then coalesce(hire_unit, 'day') end, updated_at = now() where id = o.id;
end $$;

create or replace function public.lo_save_order(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.lo_requests; o public.lo_orders; oid uuid; k text := p ->> 'kind'; t text := p ->> 'payment_term'; pct numeric := nullif(p ->> 'advance_pct', '')::numeric;
        b text; adv boolean; unit text := nullif(p ->> 'hire_unit', ''); site_b text;
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
  b := case when k = 'material' then 'single' else coalesce(nullif(p ->> 'billing', ''), o.billing, 'single') end;
  -- a service the site asked for: how it is paid is the site's choice (the SEE changes it on the request)
  select m.billing into site_b from public.material_requests m where m.id = r.mr_id and m.kind = 'service';
  if k = 'service' and site_b is not null then
    perform app.require(nullif(p ->> 'billing', '') is null or p ->> 'billing' = site_b,
      format('The site chose "%s" on the service request – ask the SEE to change it there', app.billing_label(site_b)));
    b := site_b;
  end if;
  perform app.require(b in ('single', 'ipc', 'hire', 'milestone'), 'Single invoice, IPC, work basis or hire?');
  perform app.require(b = 'milestone' or o.id is null or not exists (select 1 from public.lo_work_stages where order_id = o.id), 'This order has work stages – remove them first');
  perform app.require(b = 'hire' or o.id is null or not exists (select 1 from public.lo_invoices where order_id = o.id and period_from is not null and status <> 'cancelled'), 'This order has hire invoices – it stays a hire');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'What is ordered from this supplier?');
  perform app.require(coalesce(btrim(p ->> 'supplier'), '') <> '', 'Enter the supplier / service provider');
  perform app.require(t is not null and app.lo_term_fits(k, b, t), case b when 'ipc' then 'Choose the payment term – % advance and the balance by IPC, or by IPC with no advance'
                                                                      when 'hire' then 'Choose the payment term – per period against the hire / time sheets, with or without an advance'
                                                                      when 'milestone' then 'Choose the payment term – per deliverable on acceptance, with or without an advance'
                                                                      else 'Choose the payment term' end);
  adv := t in ('advance_balance', 'advance_ipc', 'advance_periodic', 'advance_milestone');
  perform app.require(not adv or (pct > 0 and pct < 100), 'Enter the advance %');
  perform app.require(b <> 'hire' or unit in ('hour', 'day', 'week', 'month'), 'Hired by the hour, day, week or month?');
  if p_id is null then
    insert into public.lo_orders (code, request_id, seq_no, title, kind, billing, supplier, supplier_new, payment_term, advance_pct, advance_security, lead_time, delivery_arrangement, hire_unit, notes)
    values (app.next_code('LO'), r.id, coalesce((select max(seq_no) from public.lo_orders where request_id = r.id), 0) + 1, btrim(p ->> 'title'), k, b, btrim(p ->> 'supplier'),
            coalesce((p ->> 'supplier_new')::boolean, false), t, case when adv then pct end, coalesce((p ->> 'advance_security')::boolean, false),
            nullif(btrim(p ->> 'lead_time'), ''), nullif(btrim(p ->> 'delivery_arrangement'), ''), case when b = 'hire' then unit end, nullif(btrim(p ->> 'notes'), ''))
    returning id into oid;
  else
    oid := p_id;
    update public.lo_orders set title = btrim(p ->> 'title'), kind = k, billing = b, supplier = btrim(p ->> 'supplier'), supplier_new = coalesce((p ->> 'supplier_new')::boolean, false),
           payment_term = t, advance_pct = case when adv then pct end, advance_security = coalesce((p ->> 'advance_security')::boolean, false),
           lead_time = nullif(btrim(p ->> 'lead_time'), ''), delivery_arrangement = nullif(btrim(p ->> 'delivery_arrangement'), ''),
           hire_unit = case when b = 'hire' then unit end, notes = nullif(btrim(p ->> 'notes'), ''), updated_at = now()
     where id = oid;
    select * into o from public.lo_orders where id = oid;
    perform app.require(not exists (select 1 from public.lo_steps st join public.lo_step_defs d on d.key = st.step
                                     where st.order_id = oid and not app.lo_applies(d.conds, o)),
      'Steps already recorded no longer apply to these terms – clear them first');
  end if;
  if p ? 'value' or p ? 'hire_rate' then
    insert into public.lo_order_values (order_id, value, hire_rate)
    values (oid, nullif(p ->> 'value', '')::numeric, case when b = 'hire' then nullif(p ->> 'hire_rate', '')::numeric end)
    on conflict (order_id) do update set value = case when p ? 'value' then excluded.value else lo_order_values.value end,
                                         hire_rate = case when b = 'hire' then excluded.hire_rate end, updated_at = now();
  end if;
  return oid;
end $$;

select app.purge_guard_triggers();
select app.fix_function_owners();
