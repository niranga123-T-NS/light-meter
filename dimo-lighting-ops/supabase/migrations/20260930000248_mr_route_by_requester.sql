-- Material requests: the person raising it decides how it is sourced – SAP (Operations orders it or issues stock), a local
-- purchase or an import – not Operations. If an AE or a subcontractor supervisor chose, the SEE can change it until it is
-- on its way. On approval a local or import request is created by itself (LR- / IR-) with the items, project, site and
-- required date, and Operations is told. The project team (SEE, its AEs) sees the progress of those orders (stages and
-- the invoice approvals, without values).

alter table public.material_requests add column if not exists route text not null default 'sap';
alter table public.material_requests drop constraint if exists material_requests_route_check;
alter table public.material_requests add constraint material_requests_route_check check (route in ('sap', 'local', 'import'));
alter table public.material_requests add column if not exists route_by uuid references public.profiles (id) on delete set null;
-- requests already sent to local or import orders
update public.material_requests m set route = 'local' where route = 'sap' and exists (select 1 from public.lo_requests r where r.mr_id = m.id and r.status <> 'cancelled');
update public.material_requests m set route = 'import' where route = 'sap' and exists (select 1 from public.fo_handovers h where h.mr_id = m.id and h.status <> 'cancelled');

create or replace function public.raise_material_request(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; l jsonb; n int := 0; ri public.project_return_items; rid uuid; avail numeric; sapm text; onew boolean; why text; sub boolean := app.has_role('sub_supervisor'); c public.material_catalog; cid int; nm text;
        act uuid := nullif(p ->> 'activity_id', '')::uuid; est numeric := 0; rate numeric;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec) or (sub and app.is_exec_member(p_exec)),
    'The project''s Assistant Engineers, its subcontractor supervisors or the Senior Electrical Engineer request materials');
  perform app.require(nullif(p ->> 'required_date', '') is not null, 'Set the date the material is needed on site');
  perform app.require(act is null or exists (select 1 from public.exec_activities where id = act and exec_project_id = p_exec), 'Choose an activity of this project');
  perform app.require(coalesce(nullif(p ->> 'route', ''), 'sap') in ('sap', 'local', 'import'), 'Choose how it is sourced: SAP, local purchase or import');
  insert into public.material_requests (code, exec_project_id, required_date, purpose, est_value_lkr, status, priority, activity_id, deliver_to, site_contact, route, route_by)
  values (app.next_code('MR'), p_exec, (p ->> 'required_date')::date, nullif(btrim(p ->> 'purpose'), ''),
          null::numeric, case when sub then 'ae_review' else 'submitted' end,
          case when p ->> 'priority' = 'urgent' then 'urgent' else 'normal' end, act, nullif(btrim(p ->> 'deliver_to'), ''), nullif(btrim(p ->> 'site_contact'), ''),
          coalesce(nullif(p ->> 'route', ''), 'sap'), auth.uid())
  returning * into m;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    cid := nullif(l ->> 'catalog_id', '')::int;
    rid := nullif(l ->> 'return_item_id', '')::uuid;
    sapm := nullif(btrim(l ->> 'sap_material'), '');
    onew := coalesce((l ->> 'order_new')::boolean, false);
    why := nullif(btrim(l ->> 'order_new_reason'), '');
    continue when cid is null and rid is null and coalesce(btrim(l ->> 'item'), '') = '';
    c := null; ri := null;
    if rid is not null then
      -- Taken from the Project returns stock: reserved now, booked out when it is received on site
      select * into ri from public.project_return_items where id = rid and not removed for update;
      perform app.require(ri.id is not null, 'Project-return item not found – choose it again');
      avail := app.return_available(ri.id);
      perform app.require(nullif(l ->> 'qty', '')::numeric <= avail, format('Only %s %s of %s is available in Project returns', avail, ri.unit, ri.item));
      nm := ri.item;
      if cid is not null then select * into c from public.material_catalog where id = cid and active; end if;
    elsif cid is not null then
      select * into c from public.material_catalog where id = cid and active;
      perform app.require(c.id is not null, 'Catalogue item not found – choose it again');
      nm := c.name;
    else
      perform app.require(coalesce((l ->> 'custom')::boolean, false), 'Choose the item from the catalogue, or tick “not in the catalogue” and describe it');
      nm := btrim(l ->> 'item');
    end if;
    -- Stock first: when the same or a similar item is held, the engineer takes it, or orders new with the reason
    if ri.id is null and sapm is null and jsonb_array_length(public.stock_matches(nm)) > 0 then
      perform app.require(onew, format('%s is held in the SAP stock or Project returns – take it from there, or choose "Order new" with the reason', nm));
      perform app.require(why is not null, format('%s: give the reason for ordering new although it is in stock', nm));
    end if;
    perform app.require(nullif(l ->> 'qty', '')::numeric > 0 and coalesce(btrim(coalesce(nullif(l ->> 'unit', ''), ri.unit, c.unit)), '') <> '', 'Each item needs a quantity and unit');
    rate := null;
    insert into public.material_request_lines (mr_id, item, unit, qty, catalog_id, category, spec, brand, custom, est_rate, note, return_item_id, sap_material, source_choice, order_new_reason)
    values (m.id, nm, coalesce(nullif(btrim(l ->> 'unit'), ''), ri.unit, c.unit), (l ->> 'qty')::numeric, c.id, coalesce(c.category, ri.category, nullif(btrim(l ->> 'category'), '')),
            nullif(btrim(l ->> 'spec'), ''), nullif(btrim(l ->> 'brand'), ''), c.id is null and ri.id is null, rate, nullif(btrim(l ->> 'note'), ''), ri.id, sapm,
            case when ri.id is not null then 'returns' when sapm is not null then 'sap' when onew then 'new' end, case when ri.id is null and sapm is null then why end);
    est := est + coalesce(rate, 0) * (l ->> 'qty')::numeric;
    n := n + 1;
  end loop;
  perform app.require(n > 0, 'Add at least one item');
  if not sub and m.est_value_lkr is null and est > 0 then
    update public.material_requests set est_value_lkr = est where id = m.id returning * into m;
  end if;
  if sub then
    perform app.notify_many(app.project_aes(p_exec), 'exec_material', 'Material request from the subcontractor – check and forward',
      app.mr_head(m) || ' · ' || app.display_name(auth.uid()), case when m.priority = 'urgent' then 'critical' else 'normal' end::public.priority,
      'material_request', m.id, '/execution/material/' || m.id, null, true);
  elsif app.has_role('senior_elec_engineer') then
    perform public.decide_material_request(m.id, true, null);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_material', case when m.priority = 'urgent' then 'URGENT material request to approve' else 'Material request to approve' end,
      app.mr_head(m) || ' · ' || app.display_name(auth.uid()), case when m.priority = 'urgent' then 'critical' else 'normal' end::public.priority,
      'material_request', m.id, '/execution/material/' || m.id, null, true);
  end if;
  return m.id;
end $$;

-- the SEE (and SM Projects) may send it, not only Operations
create or replace function app.lo_can_request(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('operations_exec', 'sm_projects', 'gm')
      or (p_exec is not null and (exists (select 1 from public.exec_projects e where e.id = p_exec and e.see_id = auth.uid()) or app.has_role('senior_elec_engineer')))
      or (p_exec is null and app.has_role('asm_building', 'asm_infra'))
$$;
create or replace function public.fo_request_from_mr(p_mr uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; e public.exec_projects; hid uuid; lines text; sp uuid; today date := (now() at time zone app.tz())::date;
begin
  select * into m from public.material_requests where id = p_mr for update;
  perform app.require(found, 'Material request not found');
  select * into e from public.exec_projects where id = m.exec_project_id;
  perform app.require(app.fo_keeper() or e.see_id = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects', 'gm'), 'The SEE, SM Projects or Operations sends it for import');
  perform app.require(m.status = 'approved', 'Only an approved material request can be imported');
  perform app.require(not exists (select 1 from public.lo_requests where mr_id = m.id and status <> 'cancelled'), 'This request is already being bought locally');
  perform app.require(not exists (select 1 from public.fo_handovers where mr_id = m.id and status <> 'cancelled'), 'Already sent for import');
  select string_agg(format('%s – %s %s', l.item, trim(to_char(l.qty, 'FM999999990.###')), l.unit), E'\n' order by l.item) into lines
    from public.material_request_lines l where l.mr_id = m.id;
  sp := (select s.sales_person_id from public.secured_projects s where s.project_id = e.project_id and s.status <> 'cancelled' order by s.won_on desc nulls last limit 1);
  insert into public.fo_handovers (code, exec_project_id, project_id, project_name, client, sales_person_id, received_on, delivery_location, mr_id, notes)
  values (app.next_code('IR'), e.id, e.project_id, coalesce(e.code || ' ', '') || e.name, coalesce(e.client_name, '—'), sp, today,
          coalesce(nullif(btrim(e.site_address), ''), e.name),
          m.id, concat_ws(E'\n', format('From site material request %s%s – required at site %s', coalesce(m.code, ''), coalesce(' (' || m.purpose || ')', ''), to_char(m.required_date, 'DD Mon YYYY')),
                          lines, nullif(btrim(p_note), '')))
  returning id into hid;
  insert into public.fo_steps (handover_id, step, done_on, ref, recorded_by) values (hid, 'ho_received', today, m.code, auth.uid());
  perform app.notify_many(app.role_users('operations_exec'), 'foreign_order', 'Site material request to import',
    concat_ws(' · ', m.code, e.name, 'required ' || to_char(m.required_date, 'DD Mon')), 'normal', 'fo_handover', hid, '/orders/foreign/ho/' || hid);
  return hid;
end $$;

/** Sends an approved request the way it was chosen: a local request or an import request (once) */
create or replace function app.mr_dispatch(p_mr uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.material_requests;
begin
  select * into m from public.material_requests where id = p_mr;
  if m.status <> 'approved' or m.route = 'sap' then return; end if;
  if exists (select 1 from public.lo_requests where mr_id = m.id and status <> 'cancelled') or exists (select 1 from public.fo_handovers where mr_id = m.id and status <> 'cancelled') then return; end if;
  if m.route = 'local' then
    perform public.lo_save_request(null, jsonb_build_object('mr_id', m.id, 'delivery_location', coalesce(m.deliver_to, ''), 'notes', 'Sent by the site – material request ' || coalesce(m.code, '')));
  else
    perform public.fo_request_from_mr(m.id, null);
  end if;
end $$;

create or replace function app.mr_dispatch_on_approve() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.purging', true) = 'on' then return null; end if;
  if new.status = 'approved' and old.status is distinct from 'approved' and new.route <> 'sap' then perform app.mr_dispatch(new.id); end if;
  return null;
end $$;
drop trigger if exists mr_dispatch on public.material_requests;
create trigger mr_dispatch after update of status on public.material_requests for each row execute function app.mr_dispatch_on_approve();

/** Change the route: the requester or the SEE before approval; the SEE (or SM Projects) after, until it is ordered or sent */
create or replace function public.set_mr_route(p_id uuid, p_route text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; lead boolean := app.has_role('senior_elec_engineer', 'sm_projects');
begin
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(found, 'Material request not found');
  perform app.require(p_route in ('sap', 'local', 'import'), 'SAP, local purchase or import');
  if m.status in ('ae_review', 'submitted', 'pending_smp') then
    perform app.require(lead or m.requested_by = auth.uid() or app.is_project_ae(m.exec_project_id), 'The requester, the project''s AEs or the SEE choose the route');
  elsif m.status = 'approved' then
    perform app.require(lead, 'After approval only the SEE changes the route');
    perform app.require(m.po_no is null and not exists (select 1 from public.lo_requests where mr_id = m.id and status <> 'cancelled')
                        and not exists (select 1 from public.fo_handovers where mr_id = m.id and status <> 'cancelled'),
      'Already ordered or sent – cancel the local / import request first');
  else
    perform app.require(false, 'The route can no longer change');
  end if;
  update public.material_requests set route = p_route, route_by = auth.uid() where id = m.id;
  if m.status = 'approved' then perform app.mr_dispatch(m.id); end if;
end $$;
grant execute on function public.set_mr_route(uuid, text) to authenticated;

-- the project team follows the orders made for its project (values stay hidden – those policies are unchanged)
create or replace function app.lo_can_read(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.lo_office() or exists (select 1 from public.lo_requests r where r.id = p_request and auth.uid() in (r.requested_by, r.sales_person_id, r.created_by))
      or app.lo_see_of(p_request) = auth.uid()
      or exists (select 1 from public.lo_requests r where r.id = p_request and r.exec_project_id is not null and app.is_exec_internal(r.exec_project_id))
$$;
create or replace function app.fo_can_read(p_handover uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.fo_office() or exists (select 1 from public.fo_handovers h where h.id = p_handover and h.sales_person_id = auth.uid())
      or app.fo_see_of(p_handover) = auth.uid()
      or exists (select 1 from public.fo_handovers h where h.id = p_handover and h.exec_project_id is not null and app.is_exec_internal(h.exec_project_id))
$$;

/** For the material request page: what decides the local order's steps (DIC above 2 mn) and the invoice approvals, without values */
create or replace function public.mr_order_progress(p_mr uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'order_id', o.id,
           'dic_pr', coalesce((select v.pr_value > 2000000 from public.lo_request_values v where v.request_id = r.id), false),
           'dic_sel', coalesce((select v.value > 2000000 from public.lo_order_values v where v.order_id = o.id), false),
           'invoices', coalesce((select jsonb_agg(jsonb_build_object('invoice_no', i.invoice_no, 'kind', i.kind, 'status', i.status, 'received_on', i.received_on,
                        'see_on', i.see_on, 'smp_on', i.smp_on, 'dgm_on', i.dgm_on, 'proc_on', i.proc_on, 'finance_on', i.finance_on, 'paid_on', i.paid_on) order by i.received_on)
                        from public.lo_invoices i where i.order_id = o.id and i.status <> 'cancelled'), '[]'))), '[]')
    from public.lo_orders o join public.lo_requests r on r.id = o.request_id
   where r.mr_id = p_mr and r.status <> 'cancelled' and o.status <> 'cancelled' and app.lo_can_read(r.id)
$$;
grant execute on function public.mr_order_progress(uuid) to authenticated;

select app.purge_guard_triggers();
select app.fix_function_owners();
