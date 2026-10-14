-- Requests from site are for materials or services. A service request lists the scope (what, quantity, unit) instead of
-- store / catalogue items, is bought locally or imported (not SAP), becomes a local (or import) service request on
-- approval, and is completed when the service provider's work is completed – nothing is received into the store.

alter table public.material_requests add column if not exists kind text not null default 'material';
alter table public.material_requests drop constraint if exists material_requests_kind_check;
alter table public.material_requests add constraint material_requests_kind_check check (kind in ('material', 'service'));

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
  perform app.require(coalesce(nullif(p ->> 'kind', ''), 'material') in ('material', 'service'), 'Materials or services?');
  perform app.require(coalesce(nullif(p ->> 'kind', ''), 'material') = 'material' or coalesce(nullif(p ->> 'route', ''), 'sap') <> 'sap', 'A service is bought locally or imported');
  insert into public.material_requests (code, exec_project_id, required_date, purpose, est_value_lkr, status, priority, activity_id, deliver_to, site_contact, route, route_by, kind)
  values (app.next_code('MR'), p_exec, (p ->> 'required_date')::date, nullif(btrim(p ->> 'purpose'), ''),
          null::numeric, case when sub then 'ae_review' else 'submitted' end,
          case when p ->> 'priority' = 'urgent' then 'urgent' else 'normal' end, act, nullif(btrim(p ->> 'deliver_to'), ''), nullif(btrim(p ->> 'site_contact'), ''),
          coalesce(nullif(p ->> 'route', ''), 'sap'), auth.uid(), coalesce(nullif(p ->> 'kind', ''), 'material'))
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
    k := coalesce(m.kind, 'material');
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

create or replace function app.mr_sync(p_mr uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; n int; n_po int; n_del int; exp date; pos text; sups text; people uuid[];
begin
  if p_mr is null or current_setting('app.purging', true) = 'on' then return; end if;
  select * into m from public.material_requests where id = p_mr for update;
  if not found or m.status in ('rejected', 'cancelled', 'received') then return; end if;
  select count(*), count(*) filter (where po is not null), count(*) filter (where delivered), max(expected), string_agg(distinct po, ', '), string_agg(distinct supplier, ', ')
    into n, n_po, n_del, exp, pos, sups from app.mr_orders(p_mr);
  if n = 0 then return; end if;
  people := app.project_aes(m.exec_project_id) || array[m.requested_by] || array(select see_id from public.exec_projects where id = m.exec_project_id and see_id is not null);
  -- a service has nothing to receive into the store: done when every order's work is completed
  if m.kind = 'service' and n_del = n and n_po = n then
    update public.material_requests set status = 'received', po_no = left(pos, 300), supplier = left(sups, 300), ordered_at = coalesce(ordered_at, now()) where id = m.id;
    perform app.notify_many(people, 'exec_material', 'Service completed', concat_ws(' · ', app.mr_head(m), sups), 'normal', 'material_request', m.id, '/execution/material/' || m.id);
    return;
  end if;
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

select app.purge_guard_triggers();
select app.fix_function_owners();
