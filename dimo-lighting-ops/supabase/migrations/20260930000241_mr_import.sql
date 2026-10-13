-- Site material requests that must be imported: the SEE (or Ops) sends an approved request to Operations as a foreign-orders
-- import request (IR-), with its items, the project, the client, the site and the required date. Operations splits it into import
-- orders as usual. When the PO of an import order is issued, the material request is marked ordered. A material request goes
-- one way only: SAP order, local order or import.

alter table public.fo_handovers add column if not exists mr_id uuid references public.material_requests (id) on delete set null;
create unique index if not exists fo_handovers_one_per_mr on public.fo_handovers (mr_id) where mr_id is not null and status <> 'cancelled';

create or replace function public.fo_request_from_mr(p_mr uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; e public.exec_projects; hid uuid; lines text; sp uuid; today date := (now() at time zone app.tz())::date;
begin
  select * into m from public.material_requests where id = p_mr for update;
  perform app.require(found, 'Material request not found');
  select * into e from public.exec_projects where id = m.exec_project_id;
  perform app.require(app.fo_keeper() or e.see_id = auth.uid(), 'The project''s SEE or Operations sends it for import');
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
grant execute on function public.fo_request_from_mr(uuid, text) to authenticated;

-- The other way round: a material request already sent for import cannot also be bought locally
create or replace function app.lo_mr_once() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mr_id is not null and exists (select 1 from public.fo_handovers where mr_id = new.mr_id and status <> 'cancelled') then
    raise exception 'This material request is already sent for import';
  end if;
  return new;
end $$;
drop trigger if exists lo_mr_once on public.lo_requests;
create trigger lo_mr_once before insert on public.lo_requests for each row execute function app.lo_mr_once();

-- PO issued on an import order of such a request: the material request is on order
create or replace function app.fo_po_marks_mr() returns trigger
language plpgsql security definer set search_path = public as $$
declare h public.fo_handovers; o public.fo_orders;
begin
  if new.step <> 'po_issued' then return new; end if;
  select * into h from public.fo_handovers where id = new.handover_id;
  if h.mr_id is null then return new; end if;
  select * into o from public.fo_orders where id = new.order_id;
  update public.material_requests set status = 'ordered', po_no = coalesce(po_no, new.ref), supplier = coalesce(supplier, o.vendor),
         expected_date = coalesce(expected_date, o.required_on), ordered_by = coalesce(ordered_by, new.recorded_by), ordered_at = coalesce(ordered_at, now())
   where id = h.mr_id and status = 'approved';
  return new;
end $$;
drop trigger if exists fo_po_marks_mr on public.fo_steps;
create trigger fo_po_marks_mr after insert on public.fo_steps for each row execute function app.fo_po_marks_mr();

select app.fix_function_owners();
