-- Material requests from subcontractor supervisors, and delivery acknowledgement
--  * A subcontractor supervisor of the project can raise a material request: it goes to the project's Assistant
--    Engineers first (check and forward to the SEE, or return with the reason), then the usual SEE → SM Projects → Operations.
--  * A delivery is recorded by the AE or the supervisor; the other one acknowledges it (or disputes it with the reason).
--    Only an acknowledged delivery goes into the site store. Disputes go to the SEE and Operations.
--    The supervisor who acknowledges is the one who raised the request, or the one the AE names when recording.

alter table public.material_requests drop constraint if exists material_requests_status_check;
alter table public.material_requests add constraint material_requests_status_check
  check (status in ('ae_review', 'submitted', 'pending_smp', 'approved', 'ordered', 'part_received', 'received', 'rejected', 'cancelled'));
alter table public.material_requests add column if not exists ae_by uuid references public.profiles (id);
alter table public.material_requests add column if not exists ae_at timestamptz;

create table public.material_receipts (
  id uuid primary key default gen_random_uuid(),
  mr_id uuid not null references public.material_requests (id) on delete cascade,
  lines jsonb not null,                   -- [{line_id, item, unit, qty}]
  note text,
  recorded_by uuid not null default auth.uid() references public.profiles (id),
  recorded_at timestamptz not null default now(),
  supervisor_id uuid references public.profiles (id),
  ae_ack_by uuid references public.profiles (id),
  ae_ack_at timestamptz,
  sub_ack_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'disputed')),
  dispute_by uuid references public.profiles (id),
  dispute_note text
);
alter table public.material_receipts enable row level security;

-- Visibility through security-definer helpers (policies on requests and receipts would otherwise refer to each other)
create or replace function app.can_read_mr(p_mr uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.material_requests m where m.id = p_mr
                 and (app.is_exec_internal(m.exec_project_id) or m.requested_by = auth.uid()
                      or exists (select 1 from public.material_receipts r where r.mr_id = m.id and r.supervisor_id = auth.uid())))
$$;
create policy material_receipts_read on public.material_receipts for select to authenticated using (app.can_read_mr(mr_id));
grant select on public.material_receipts to authenticated;

-- Supervisors see their own requests and the ones whose delivery they acknowledge
drop policy if exists material_requests_read on public.material_requests;
create policy material_requests_read on public.material_requests for select to authenticated using (app.can_read_mr(id));
drop policy if exists material_request_lines_read on public.material_request_lines;
create policy material_request_lines_read on public.material_request_lines for select to authenticated using (app.can_read_mr(mr_id));

-- p: {required_date, purpose, est_value, lines: [{item, unit, qty}]}
create or replace function public.raise_material_request(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; l jsonb; n int := 0; sub boolean := app.has_role('sub_supervisor');
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec) or (sub and app.is_exec_member(p_exec)),
    'The project''s Assistant Engineers, its subcontractor supervisors or the Senior Electrical Engineer request materials');
  perform app.require(nullif(p ->> 'required_date', '') is not null, 'Set the date the material is needed on site');
  insert into public.material_requests (code, exec_project_id, required_date, purpose, est_value_lkr, status)
  values (app.next_code('MR'), p_exec, (p ->> 'required_date')::date, nullif(btrim(p ->> 'purpose'), ''),
          case when sub then null else nullif(p ->> 'est_value', '')::numeric end, case when sub then 'ae_review' else 'submitted' end)
  returning * into m;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    continue when coalesce(btrim(l ->> 'item'), '') = '';
    perform app.require(nullif(l ->> 'qty', '')::numeric > 0 and coalesce(btrim(l ->> 'unit'), '') <> '', 'Each item needs a quantity and unit');
    insert into public.material_request_lines (mr_id, item, unit, qty) values (m.id, btrim(l ->> 'item'), btrim(l ->> 'unit'), (l ->> 'qty')::numeric);
    n := n + 1;
  end loop;
  perform app.require(n > 0, 'Add at least one item');
  if sub then
    perform app.notify_many(app.project_aes(p_exec), 'exec_material', 'Material request from the subcontractor – check and forward',
      app.mr_head(m) || ' · ' || app.display_name(auth.uid()), 'normal', 'material_request', m.id, '/execution/material/' || m.id, null, true);
  elsif app.has_role('senior_elec_engineer') then
    perform public.decide_material_request(m.id, true, null);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_material', 'Material request to approve', app.mr_head(m) || ' · ' || app.display_name(auth.uid()),
      'normal', 'material_request', m.id, '/execution/material/' || m.id, null, true);
  end if;
  return m.id;
end $$;

-- AE checks a supervisor's request: forward to the SEE (with the estimated value) or return it with the reason
create or replace function public.ae_review_material_request(p_id uuid, p_forward boolean, p_note text default null, p_est_value numeric default null) returns text
language plpgsql security definer set search_path = public as $$
declare m public.material_requests;
begin
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(m.id is not null and m.status = 'ae_review', 'Not waiting for the Assistant Engineer');
  perform app.require(app.is_project_ae(m.exec_project_id) or app.has_role('senior_elec_engineer'), 'An Assistant Engineer of the project checks it');
  if not p_forward then
    perform app.require(coalesce(btrim(p_note), '') <> '', 'Give the reason');
    update public.material_requests set status = 'rejected', ae_by = auth.uid(), ae_at = now(), decision_note = btrim(p_note) where id = m.id;
    perform app.notify(m.requested_by, 'exec_material', 'Material request returned by the engineer', app.mr_head(m) || ' · ' || btrim(p_note), 'normal',
      'material_request', m.id, '/execution/material/' || m.id);
    return 'rejected';
  end if;
  update public.material_requests set status = 'submitted', ae_by = auth.uid(), ae_at = now(), est_value_lkr = coalesce(p_est_value, est_value_lkr),
    decision_note = nullif(btrim(p_note), '') where id = m.id;
  perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_material', 'Material request to approve',
    app.mr_head(m) || ' · from ' || app.display_name(m.requested_by) || ', checked by ' || app.display_name(auth.uid()), 'normal', 'material_request', m.id,
    '/execution/material/' || m.id, null, true);
  perform app.notify(m.requested_by, 'exec_material', 'Material request forwarded for approval', app.mr_head(m), 'normal', 'material_request', m.id, '/execution/material/' || m.id);
  return 'submitted';
end $$;

-- Book an acknowledged delivery into the request and the site store
create or replace function app.book_receipt(p_receipt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.material_receipts; m public.material_requests; l jsonb; open_n int;
begin
  select * into r from public.material_receipts where id = p_receipt for update;
  select * into m from public.material_requests where id = r.mr_id for update;
  for l in select * from jsonb_array_elements(r.lines) loop
    update public.material_request_lines set received_qty = received_qty + (l ->> 'qty')::numeric where id = (l ->> 'line_id')::uuid;
    insert into public.store_moves (exec_project_id, kind, item, unit, qty, mr_id, ref, note, by_id)
    values (m.exec_project_id, 'receipt', l ->> 'item', l ->> 'unit', (l ->> 'qty')::numeric, m.id, m.po_no, r.note, r.recorded_by);
  end loop;
  update public.material_receipts set status = 'accepted' where id = r.id;
  select count(*) into open_n from public.material_request_lines where mr_id = m.id and received_qty < qty;
  update public.material_requests set status = case when open_n = 0 then 'received' else 'part_received' end where id = m.id;
end $$;

-- Delivery recorded on site (AE or supervisor); p_lines [{line_id, qty}]; p_supervisor: who acknowledges for the subcontractor
drop function if exists public.receive_material(uuid, jsonb, text);
create or replace function public.receive_material(p_id uuid, p_lines jsonb, p_note text default null, p_supervisor uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; l jsonb; ln public.material_request_lines; q numeric; out_lines jsonb := '[]'; rid uuid; sub uuid; by_sub boolean := app.has_role('sub_supervisor');
begin
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(m.id is not null and m.status in ('ordered', 'part_received'), 'Nothing is on order for this request');
  perform app.require((app.is_exec_internal(m.exec_project_id) and not app.has_role('gm', 'sm_projects')) or (by_sub and app.is_exec_member(m.exec_project_id)),
    'Only the project team records deliveries');
  perform app.require(not exists (select 1 from public.material_receipts where mr_id = m.id and status = 'pending'), 'The last delivery is still waiting for acknowledgement');
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    q := nullif(l ->> 'qty', '')::numeric;
    continue when coalesce(q, 0) <= 0;
    select * into ln from public.material_request_lines where id = (l ->> 'line_id')::uuid and mr_id = m.id;
    perform app.require(ln.id is not null, 'Unknown item');
    out_lines := out_lines || jsonb_build_array(jsonb_build_object('line_id', ln.id, 'item', ln.item, 'unit', ln.unit, 'qty', q));
  end loop;
  perform app.require(jsonb_array_length(out_lines) > 0, 'Enter the quantities received');
  if by_sub then
    sub := auth.uid();
  else
    sub := coalesce(p_supervisor, case when (select role from public.profiles where id = m.requested_by) = 'sub_supervisor' then m.requested_by end);
    perform app.require(sub is null or exists (select 1 from public.exec_members where exec_project_id = m.exec_project_id and user_id = sub and active and member_role = 'sub_supervisor'),
      'Choose a subcontractor supervisor of this project');
  end if;
  insert into public.material_receipts (mr_id, lines, note, supervisor_id, ae_ack_by, ae_ack_at, sub_ack_at)
  values (m.id, out_lines, nullif(btrim(p_note), ''), sub, case when by_sub then null else auth.uid() end, case when by_sub then null else now() end,
          case when by_sub then now() end)
  returning id into rid;
  if by_sub then
    perform app.notify_many(app.project_aes(m.exec_project_id), 'exec_material', 'Delivery to acknowledge', app.mr_head(m) || ' · recorded by ' || app.display_name(auth.uid()),
      'normal', 'material_request', m.id, '/execution/material/' || m.id, null, true);
  elsif sub is not null then
    perform app.notify(sub, 'exec_material', 'Delivery to acknowledge', app.mr_head(m) || ' · recorded by ' || app.display_name(auth.uid()), 'normal', 'material_request', m.id,
      '/execution/material/' || m.id, null, true);
  else
    perform app.book_receipt(rid);  -- no subcontractor involved: the engineer's record is enough
  end if;
  if coalesce(btrim(p_note), '') <> '' then
    perform app.notify_many(app.role_users('operations_exec', 'senior_elec_engineer'), 'exec_material', 'Delivery note: damages / shortages',
      app.mr_head(m) || ' · ' || btrim(p_note), 'normal', 'material_request', m.id, '/execution/material/' || m.id);
  end if;
  return rid;
end $$;

create or replace function public.acknowledge_delivery(p_receipt uuid, p_ok boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r public.material_receipts; m public.material_requests; side text;
begin
  select * into r from public.material_receipts where id = p_receipt for update;
  perform app.require(r.id is not null and r.status = 'pending', 'Nothing to acknowledge');
  select * into m from public.material_requests where id = r.mr_id;
  if r.ae_ack_at is null and (app.is_project_ae(m.exec_project_id) or app.has_role('senior_elec_engineer')) then side := 'ae';
  elsif r.sub_ack_at is null and r.supervisor_id = auth.uid() then side := 'sub';
  else perform app.require(false, 'This delivery is not waiting for you'); end if;
  if not p_ok then
    perform app.require(coalesce(btrim(p_note), '') <> '', 'Say what is wrong with the delivery');
    update public.material_receipts set status = 'disputed', dispute_by = auth.uid(), dispute_note = btrim(p_note) where id = r.id;
    perform app.notify_many(app.role_users('senior_elec_engineer', 'operations_exec') || array[r.recorded_by], 'exec_material', 'Delivery disputed',
      app.mr_head(m) || ' · ' || app.display_name(auth.uid()) || ': ' || btrim(p_note), 'normal', 'material_request', m.id, '/execution/material/' || m.id, null, true);
    return 'disputed';
  end if;
  if side = 'ae' then update public.material_receipts set ae_ack_by = auth.uid(), ae_ack_at = now() where id = r.id;
  else update public.material_receipts set sub_ack_at = now() where id = r.id; end if;
  select * into r from public.material_receipts where id = r.id;
  if r.ae_ack_at is not null and (r.supervisor_id is null or r.sub_ack_at is not null) then
    perform app.book_receipt(r.id);
    perform app.notify(r.recorded_by, 'exec_material', 'Delivery acknowledged – in the site store', app.mr_head(m), 'normal', 'material_request', m.id, '/execution/material/' || m.id);
    return 'accepted';
  end if;
  return 'pending';
end $$;

revoke execute on function public.raise_material_request(uuid, jsonb), public.ae_review_material_request(uuid, boolean, text, numeric),
  public.receive_material(uuid, jsonb, text, uuid), public.acknowledge_delivery(uuid, boolean, text) from public, anon;
grant execute on function public.raise_material_request(uuid, jsonb), public.ae_review_material_request(uuid, boolean, text, numeric),
  public.receive_material(uuid, jsonb, text, uuid), public.acknowledge_delivery(uuid, boolean, text) to authenticated;
