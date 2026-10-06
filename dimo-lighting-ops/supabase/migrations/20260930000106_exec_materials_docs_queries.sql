-- Execution step 7a: materials and site stores, the document register, design queries.
--  * Material request: Assistant Engineer (or SEE) raises items with quantities and the required date → the Senior
--    Electrical Engineer approves → SM Projects too above mr_smp_value_lkr → the Operations Executive places the order
--    (PO number, supplier, expected date) → deliveries received on site (quantities, damages / shortages, photos) go into
--    the site store; issues to work, returns and transfers are recorded; stock = receipts − issues + returns − transfers.
--  * Document register: drawings, specifications, method statements, submittals by number and revision; a new revision
--    supersedes the old one; field users see only "for construction"; supervisors only what is issued to them.
--  * Design queries: an Assistant Engineer or the SEE raises a query (drawing reference, photos); the SEE screens and
--    forwards it to the Design Manager (target date); the design team answers (revised drawings attached); overdue → alerts.

insert into public.settings (key, value, description) values
  ('mr_smp_value_lkr', '1000000', 'Material requests above this estimated value (LKR) also need SM Projects approval'),
  ('design_query_days', '3', 'Working days the design team has to answer a design query')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Material requests and site stores
-- ---------------------------------------------------------------------------
create table public.material_requests (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  requested_by uuid not null default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  required_date date not null,
  purpose text,
  est_value_lkr numeric(16, 2),
  status text not null default 'submitted' check (status in ('submitted', 'pending_smp', 'approved', 'ordered', 'part_received', 'received', 'rejected', 'cancelled')),
  see_by uuid references public.profiles (id),
  see_at timestamptz,
  smp_by uuid references public.profiles (id),
  smp_at timestamptz,
  decision_note text,
  po_no text,
  supplier text,
  expected_date date,
  ordered_by uuid references public.profiles (id),
  ordered_at timestamptz
);
create table public.material_request_lines (
  id uuid primary key default gen_random_uuid(),
  mr_id uuid not null references public.material_requests (id) on delete cascade,
  item text not null,
  unit text not null,
  qty numeric not null check (qty > 0),
  received_qty numeric not null default 0
);
create table public.store_moves (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  kind text not null check (kind in ('receipt', 'issue', 'return', 'transfer_out', 'transfer_in')),
  item text not null,
  unit text not null,
  qty numeric not null check (qty > 0),
  mr_id uuid references public.material_requests (id),
  ref text,
  note text,
  by_id uuid default auth.uid() references public.profiles (id),
  at timestamptz not null default now()
);
create index on public.store_moves (exec_project_id, item);

alter table public.material_requests enable row level security;
alter table public.material_request_lines enable row level security;
alter table public.store_moves enable row level security;
create policy material_requests_read on public.material_requests for select to authenticated using (app.is_exec_internal(exec_project_id));
create policy material_request_lines_read on public.material_request_lines for select to authenticated
  using (exists (select 1 from public.material_requests m where m.id = mr_id and app.is_exec_internal(m.exec_project_id)));
create policy store_moves_read on public.store_moves for select to authenticated using (app.is_exec_internal(exec_project_id));
grant select on public.material_requests, public.material_request_lines, public.store_moves to authenticated;

create or replace function app.mr_head(m public.material_requests) returns text language sql stable security definer set search_path = public as $$
  select concat_ws(' · ', m.code, app.exec_head(m.exec_project_id), 'needed ' || to_char(m.required_date, 'DD Mon'))
$$;

-- p: {required_date, purpose, est_value, lines: [{item, unit, qty}]}
create or replace function public.raise_material_request(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; l jsonb; n int := 0;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec), 'Assistant Engineers of the project or the Senior Electrical Engineer request materials');
  perform app.require(nullif(p ->> 'required_date', '') is not null, 'Set the date the material is needed on site');
  insert into public.material_requests (code, exec_project_id, required_date, purpose, est_value_lkr)
  values (app.next_code('MR'), p_exec, (p ->> 'required_date')::date, nullif(btrim(p ->> 'purpose'), ''), nullif(p ->> 'est_value', '')::numeric)
  returning * into m;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    continue when coalesce(btrim(l ->> 'item'), '') = '';
    perform app.require(nullif(l ->> 'qty', '')::numeric > 0 and coalesce(btrim(l ->> 'unit'), '') <> '', 'Each item needs a quantity and unit');
    insert into public.material_request_lines (mr_id, item, unit, qty) values (m.id, btrim(l ->> 'item'), btrim(l ->> 'unit'), (l ->> 'qty')::numeric);
    n := n + 1;
  end loop;
  perform app.require(n > 0, 'Add at least one item');
  if app.has_role('senior_elec_engineer') then
    -- Raised by the SEE: his approval is given
    perform public.decide_material_request(m.id, true, null);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_material', 'Material request to approve', app.mr_head(m) || ' · ' || app.display_name(auth.uid()),
      'normal', 'material_request', m.id, '/execution/material/' || m.id, null, true);
  end if;
  return m.id;
end $$;

create or replace function public.decide_material_request(p_id uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; nxt text;
begin
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(m.id is not null, 'Request not found');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  if m.status = 'submitted' then
    perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer approves material requests');
    nxt := case when not p_approve then 'rejected' when coalesce(m.est_value_lkr, 0) > app.setting_num('mr_smp_value_lkr', 1000000) then 'pending_smp' else 'approved' end;
    update public.material_requests set status = nxt, see_by = auth.uid(), see_at = now(), decision_note = nullif(btrim(p_note), '') where id = m.id;
    if nxt = 'pending_smp' then
      perform app.notify_many(app.role_users('sm_projects'), 'exec_material', 'Material request to approve (above limit)',
        app.mr_head(m) || ' · ' || app.fmt_money(m.est_value_lkr, 'LKR'), 'normal', 'material_request', m.id, '/execution/material/' || m.id, null, true);
    end if;
  elsif m.status = 'pending_smp' then
    perform app.require(app.has_role('sm_projects'), 'Waiting for SM Projects');
    nxt := case when p_approve then 'approved' else 'rejected' end;
    update public.material_requests set status = nxt, smp_by = auth.uid(), smp_at = now(), decision_note = coalesce(nullif(btrim(p_note), ''), decision_note) where id = m.id;
  else
    perform app.require(false, 'Not waiting for approval');
  end if;
  if nxt = 'approved' then
    perform app.notify_many(app.role_users('operations_exec'), 'exec_material', 'Material request approved – place the order', app.mr_head(m), 'normal',
      'material_request', m.id, '/execution/material/' || m.id, null, true);
  end if;
  if nxt in ('approved', 'rejected') then
    perform app.notify(m.requested_by, 'exec_material', 'Material request ' || nxt, concat_ws(' · ', app.mr_head(m), nullif(btrim(p_note), '')), 'normal',
      'material_request', m.id, '/execution/material/' || m.id);
  end if;
  return nxt;
end $$;

create or replace function public.order_material_request(p_id uuid, p_po text, p_supplier text, p_expected date) returns void
language plpgsql security definer set search_path = public as $$
declare m public.material_requests;
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive places the order');
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(m.id is not null and m.status = 'approved', 'The request is not approved');
  perform app.require(coalesce(btrim(p_po), '') <> '' and p_expected is not null, 'Enter the PO number and expected delivery date');
  update public.material_requests set status = 'ordered', po_no = btrim(p_po), supplier = nullif(btrim(p_supplier), ''), expected_date = p_expected,
    ordered_by = auth.uid(), ordered_at = now() where id = m.id;
  perform app.notify_many(app.project_aes(m.exec_project_id) || array[m.requested_by] || app.role_users('senior_elec_engineer'), 'exec_material', 'Material ordered',
    format('%s · PO %s · expected %s', app.mr_head(m), btrim(p_po), to_char(p_expected, 'DD Mon')), 'normal', 'material_request', m.id, '/execution/material/' || m.id);
end $$;

-- Delivery received on site: p_lines [{line_id, qty}]
create or replace function public.receive_material(p_id uuid, p_lines jsonb, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; l jsonb; ln public.material_request_lines; q numeric; mv uuid; open_n int;
begin
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(m.id is not null and m.status in ('ordered', 'part_received'), 'Nothing is on order for this request');
  perform app.require(app.is_exec_internal(m.exec_project_id) and not app.has_role('gm'), 'Only the project team or Operations records deliveries');
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    q := nullif(l ->> 'qty', '')::numeric;
    continue when coalesce(q, 0) <= 0;
    select * into ln from public.material_request_lines where id = (l ->> 'line_id')::uuid and mr_id = m.id for update;
    perform app.require(ln.id is not null, 'Unknown item');
    update public.material_request_lines set received_qty = received_qty + q where id = ln.id;
    insert into public.store_moves (exec_project_id, kind, item, unit, qty, mr_id, ref, note)
    values (m.exec_project_id, 'receipt', ln.item, ln.unit, q, m.id, m.po_no, nullif(btrim(p_note), '')) returning id into mv;
  end loop;
  perform app.require(mv is not null, 'Enter the quantities received');
  select count(*) into open_n from public.material_request_lines where mr_id = m.id and received_qty < qty;
  update public.material_requests set status = case when open_n = 0 then 'received' else 'part_received' end where id = m.id;
  if coalesce(btrim(p_note), '') <> '' then
    perform app.notify_many(app.role_users('operations_exec', 'senior_elec_engineer'), 'exec_material', 'Delivery note: damages / shortages',
      app.mr_head(m) || ' · ' || btrim(p_note), 'normal', 'material_request', m.id, '/execution/material/' || m.id);
  end if;
  return mv;
end $$;

-- Issue to work / return / transfer from the site store
create or replace function public.store_move(p_exec uuid, p_kind text, p_item text, p_unit text, p_qty numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare bal numeric; mid uuid;
begin
  perform app.require(app.is_exec_internal(p_exec) and not app.has_role('gm'), 'Only the project team or Operations records store movements');
  perform app.require(p_kind in ('issue', 'return', 'transfer_out', 'transfer_in'), 'Choose the movement');
  perform app.require(coalesce(btrim(p_item), '') <> '' and coalesce(p_qty, 0) > 0, 'Enter the item and quantity');
  if p_kind in ('issue', 'transfer_out') then
    select coalesce(sum(case when kind in ('receipt', 'return', 'transfer_in') then qty else -qty end), 0) into bal
    from public.store_moves where exec_project_id = p_exec and lower(item) = lower(btrim(p_item));
    perform app.require(p_qty <= bal, format('Only %s in the site store', bal));
  end if;
  insert into public.store_moves (exec_project_id, kind, item, unit, qty, note) values (p_exec, p_kind, btrim(p_item), btrim(p_unit), p_qty, nullif(btrim(p_note), ''))
  returning id into mid;
  return mid;
end $$;

-- ---------------------------------------------------------------------------
-- Document register
-- ---------------------------------------------------------------------------
create table public.exec_docs (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  doc_no text not null,
  title text not null,
  doc_type text not null check (doc_type in ('drawing', 'specification', 'method_statement', 'submittal', 'calculation', 'other')),
  revision text not null,
  status text not null default 'for_construction' check (status in ('for_construction', 'for_approval', 'superseded')),
  approval_code text check (approval_code in ('A', 'B', 'C', 'rejected')),
  issued_to_subs boolean not null default false,
  uploaded_by uuid default auth.uid() references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  note text
);
create index on public.exec_docs (exec_project_id, doc_no);
alter table public.exec_docs enable row level security;
create policy exec_docs_read on public.exec_docs for select to authenticated
  using (app.has_role('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec', 'design_manager', 'lighting_designer', 'lighting_engineer')
         or (app.is_exec_member(exec_project_id) and status = 'for_construction' and (issued_to_subs or not app.is_external())));
grant select on public.exec_docs to authenticated;

-- p: {doc_no, title, doc_type, revision, status, approval_code, issued_to_subs, note}
create or replace function public.register_doc(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare did uuid; st text := coalesce(nullif(p ->> 'status', ''), 'for_construction');
begin
  perform app.require(app.has_role('senior_elec_engineer', 'operations_exec', 'design_manager', 'lighting_designer', 'lighting_engineer') or app.is_project_ae(p_exec),
    'Not allowed to register documents');
  perform app.require(coalesce(btrim(p ->> 'doc_no'), '') <> '' and coalesce(btrim(p ->> 'title'), '') <> '' and coalesce(btrim(p ->> 'revision'), '') <> '',
    'Enter the document number, title and revision');
  perform app.require(not exists (select 1 from public.exec_docs where exec_project_id = p_exec and doc_no = btrim(p ->> 'doc_no') and revision = btrim(p ->> 'revision')),
    'This revision is already registered');
  -- A new "for construction" revision supersedes the earlier ones
  if st = 'for_construction' then
    update public.exec_docs set status = 'superseded' where exec_project_id = p_exec and doc_no = btrim(p ->> 'doc_no') and status = 'for_construction';
  end if;
  insert into public.exec_docs (exec_project_id, doc_no, title, doc_type, revision, status, approval_code, issued_to_subs, note)
  values (p_exec, btrim(p ->> 'doc_no'), btrim(p ->> 'title'), coalesce(nullif(p ->> 'doc_type', ''), 'drawing'), btrim(p ->> 'revision'), st,
          nullif(p ->> 'approval_code', ''), coalesce((p ->> 'issued_to_subs')::boolean, false), nullif(btrim(p ->> 'note'), ''))
  returning id into did;
  if st = 'for_construction' then
    perform app.notify_many(app.project_aes(p_exec) ||
      case when coalesce((p ->> 'issued_to_subs')::boolean, false)
           then array(select user_id from public.exec_members where exec_project_id = p_exec and active and member_role = 'sub_supervisor') else '{}'::uuid[] end,
      'exec_document', 'New revision for construction – ' || btrim(p ->> 'doc_no') || ' rev ' || btrim(p ->> 'revision'),
      btrim(p ->> 'title') || ' · ' || app.exec_head(p_exec), 'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=documents');
  end if;
  return did;
end $$;

-- ---------------------------------------------------------------------------
-- Design queries
-- ---------------------------------------------------------------------------
create table public.design_queries (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  question text not null,
  drawing_ref text,
  blocks text,
  raised_by uuid not null default auth.uid() references public.profiles (id),
  raised_at timestamptz not null default now(),
  status text not null default 'raised' check (status in ('raised', 'forwarded', 'answered', 'closed', 'rejected')),
  forwarded_by uuid references public.profiles (id),
  forwarded_at timestamptz,
  target_date date,
  assignee_id uuid references public.profiles (id),
  answer text,
  answered_by uuid references public.profiles (id),
  answered_at timestamptz,
  note text,
  overdue_alerted date
);
alter table public.design_queries enable row level security;
create policy design_queries_read on public.design_queries for select to authenticated
  using (app.is_exec_internal(exec_project_id) or (status <> 'raised' and app.has_role('design_manager', 'lighting_designer', 'lighting_engineer')));
grant select on public.design_queries to authenticated;

create or replace function public.raise_design_query(p_exec uuid, p_question text, p_drawing text, p_blocks text) returns uuid
language plpgsql security definer set search_path = public as $$
declare qid uuid; c text := app.next_code('DQ');
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec), 'Assistant Engineers of the project or the Senior Electrical Engineer raise design queries');
  perform app.require(coalesce(btrim(p_question), '') <> '', 'Write the question');
  insert into public.design_queries (code, exec_project_id, question, drawing_ref, blocks) values (c, p_exec, btrim(p_question), nullif(btrim(p_drawing), ''), nullif(btrim(p_blocks), ''))
  returning id into qid;
  if app.has_role('senior_elec_engineer') then
    perform public.forward_design_query(qid, true, null);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_design_query', 'Design query – screen and forward', c || ' · ' || app.exec_head(p_exec) || ' · ' || btrim(p_question),
      'normal', 'design_query', qid, '/execution/query/' || qid, null, true);
  end if;
  return qid;
end $$;

create or replace function public.forward_design_query(p_id uuid, p_forward boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare q public.design_queries; tgt date;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer screens design queries');
  select * into q from public.design_queries where id = p_id for update;
  perform app.require(q.id is not null and q.status = 'raised', 'Not waiting for screening');
  if not p_forward then
    perform app.require(coalesce(btrim(p_note), '') <> '', 'Give the answer or reason');
    update public.design_queries set status = 'rejected', note = btrim(p_note), forwarded_by = auth.uid(), forwarded_at = now() where id = q.id;
    perform app.notify(q.raised_by, 'exec_design_query', 'Design query answered by the Senior Electrical Engineer', q.code || ' · ' || btrim(p_note), 'normal',
      'design_query', q.id, '/execution/query/' || q.id);
    return;
  end if;
  tgt := (app.add_work_minutes(now(), app.setting_num('design_query_days', 3) * app.working_minutes_per_day()) at time zone app.tz())::date;
  update public.design_queries set status = 'forwarded', forwarded_by = auth.uid(), forwarded_at = now(), target_date = tgt, note = nullif(btrim(p_note), '') where id = q.id;
  perform app.notify_many(app.role_users('design_manager'), 'exec_design_query', 'Design query from site – answer by ' || to_char(tgt, 'DD Mon'),
    format('%s · %s · %s%s', q.code, app.exec_head(q.exec_project_id), q.question, coalesce(' · blocks: ' || q.blocks, '')), 'normal', 'design_query', q.id,
    '/execution/query/' || q.id, null, true);
end $$;

-- Design Manager may hand it to a designer; anyone of the design team answers
create or replace function public.assign_design_query(p_id uuid, p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('design_manager'), 'The Design Manager assigns design queries');
  perform app.require(exists (select 1 from public.profiles where id = p_person and active and role in ('design_manager', 'lighting_designer', 'lighting_engineer')), 'Choose a designer');
  update public.design_queries set assignee_id = p_person where id = p_id and status = 'forwarded';
  perform app.require(found, 'Not open');
  perform app.notify(p_person, 'exec_design_query', 'Design query assigned to you', (select code || ' · ' || question from public.design_queries where id = p_id), 'normal',
    'design_query', p_id, '/execution/query/' || p_id, null, true);
end $$;

create or replace function public.answer_design_query(p_id uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare q public.design_queries;
begin
  perform app.require(app.has_role('design_manager', 'lighting_designer', 'lighting_engineer'), 'The design team answers design queries');
  select * into q from public.design_queries where id = p_id for update;
  perform app.require(q.id is not null and q.status = 'forwarded', 'Not open');
  perform app.require(coalesce(btrim(p_answer), '') <> '', 'Write the answer');
  update public.design_queries set status = 'answered', answer = btrim(p_answer), answered_by = auth.uid(), answered_at = now() where id = q.id;
  perform app.notify_many(array[q.raised_by] || app.role_users('senior_elec_engineer') || app.project_aes(q.exec_project_id), 'exec_design_query',
    'Design query answered – ' || q.code, btrim(p_answer), 'normal', 'design_query', q.id, '/execution/query/' || q.id, null, true);
end $$;

create or replace function public.close_design_query(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.design_queries set status = 'closed' where id = p_id and status = 'answered'
    and (raised_by = auth.uid() or app.has_role('senior_elec_engineer'));
  perform app.require(found, 'Only an answered query can be closed by the person who raised it or the SEE');
end $$;

-- Daily: design queries past their target date → Design Manager and SEE
create or replace function public.design_query_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare d date := (p_at at time zone app.tz())::date; q record; n int := 0;
begin
  for q in select * from public.design_queries where status = 'forwarded' and target_date < d and (overdue_alerted is null or overdue_alerted < d) loop
    perform app.notify_many(app.role_users('design_manager', 'senior_elec_engineer') || array[q.assignee_id], 'exec_design_query', 'Design query overdue – ' || q.code,
      format('%s · due %s · %s', app.exec_head(q.exec_project_id), to_char(q.target_date, 'DD Mon'), q.question), 'normal', 'design_query', q.id, '/execution/query/' || q.id);
    update public.design_queries set overdue_alerted = d where id = q.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.design_query_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.design_query_tick(timestamptz) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('design-query-tick', '15 2 * * *', 'select public.design_query_tick()');
  end if;
end $$;

revoke execute on function public.raise_material_request(uuid, jsonb), public.decide_material_request(uuid, boolean, text), public.order_material_request(uuid, text, text, date),
  public.receive_material(uuid, jsonb, text), public.store_move(uuid, text, text, text, numeric, text), public.register_doc(uuid, jsonb),
  public.raise_design_query(uuid, text, text, text), public.forward_design_query(uuid, boolean, text), public.assign_design_query(uuid, uuid),
  public.answer_design_query(uuid, text), public.close_design_query(uuid) from public, anon;
grant execute on function public.raise_material_request(uuid, jsonb), public.decide_material_request(uuid, boolean, text), public.order_material_request(uuid, text, text, date),
  public.receive_material(uuid, jsonb, text), public.store_move(uuid, text, text, text, numeric, text), public.register_doc(uuid, jsonb),
  public.raise_design_query(uuid, text, text, text), public.forward_design_query(uuid, boolean, text), public.assign_design_query(uuid, uuid),
  public.answer_design_query(uuid, text), public.close_design_query(uuid) to authenticated;

-- Approvals tab (copied from the previous step)
create or replace function app.exec_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
  select 'access_request', r.id, 'exec_access',
         format('%s – %s', case r.kind when 'temp_add' then case r.role_type when 'trainee' then 'Trainee' else 'Temporary Assistant Engineer' end
                                       when 'temp_delete' then 'Delete temporary role' else 'Subcontractor supervisor' end, r.person_name),
         concat_ws(' · ', r.company, r.reason), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid,
         '/execution/access/' || r.id, case r.status when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.access_requests r
  where (r.status = 'pending_smp' and app.has_role('sm_projects')) or (r.status = 'pending_gm' and app.has_role('gm'))
  union all
  select 'exec_plan', pl.id, 'exec_plan', format('Weekly plan – %s – week of %s', app.display_name(pl.ae_id), to_char(pl.week_start, 'DD Mon')),
         concat_ws(' · ', app.exec_head(pl.exec_project_id), case when pl.is_late then 'submitted late' end), pl.ae_id, app.display_name(pl.ae_id),
         pl.submitted_at, null::uuid, '/execution/plan/' || pl.id, null
  from public.exec_plans pl where pl.status = 'submitted' and app.has_role('senior_elec_engineer')
  union all
  select 'variation', v.id, 'exec_variation',
         format('Variation %s – %s%s', v.code, v.title,
                case when v.value_lkr is not null then format(' (%s%s)', case when v.value_lkr > 0 then '+' else '−' end, app.fmt_money(abs(v.value_lkr), 'LKR')) else '' end),
         app.exec_head(v.exec_project_id), v.raised_by, app.display_name(v.raised_by), v.raised_at, null::uuid, '/execution/variation/' || v.id,
         case v.status when 'raised' then 'Screen' when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.variations v
  where (v.status = 'raised' and app.has_role('senior_elec_engineer')) or (v.status = 'pending_smp' and app.has_role('sm_projects'))
     or (v.status = 'pending_gm' and app.has_role('gm'))
  union all
  select 'material_request', m.id, 'exec_material', format('Material request %s', m.code), app.mr_head(m), m.requested_by, app.display_name(m.requested_by),
         m.requested_at, null::uuid, '/execution/material/' || m.id, case m.status when 'submitted' then 'Senior Electrical Engineer' else 'SM Projects' end
  from public.material_requests m
  where (m.status = 'submitted' and app.has_role('senior_elec_engineer')) or (m.status = 'pending_smp' and app.has_role('sm_projects'))
  union all
  select 'design_query', q.id, 'exec_design_query', format('Design query %s', q.code), concat_ws(' · ', app.exec_head(q.exec_project_id), q.question),
         q.raised_by, app.display_name(q.raised_by), q.raised_at, null::uuid, '/execution/query/' || q.id,
         case q.status when 'raised' then 'Screen' else 'Answer' end
  from public.design_queries q
  where (q.status = 'raised' and app.has_role('senior_elec_engineer')) or (q.status = 'forwarded' and app.has_role('design_manager'))
$$;

-- Variation inquiries are submitted by the Senior Electrical Engineer (copied from 20260930000006_workflow_rpcs.sql)


-- Attachments (copied from 20260930000105_exec_variations.sql with the new record types)
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
  when 'rma' then return app.is_warranty_desk() and exists (select 1 from public.manufacturer_claims where id = p_entity_id);
  when 'warranty_registration' then return app.is_warranty_desk() and exists (select 1 from public.warranty_registrations where id = p_entity_id);
  when 'eng_job' then
    return exists (select 1 from public.eng_jobs where id = p_entity_id and (assignee_id = auth.uid() or app.is_eng_lead()));
  when 'eng_job_update' then
    return exists (select 1 from public.eng_job_updates u join public.eng_jobs j on j.id = u.job_id
                   where u.id = p_entity_id and (j.assignee_id = auth.uid() or app.is_eng_lead()));
  when 'exec_report' then
    return exists (select 1 from public.exec_reports x where x.id = p_entity_id and x.author_id = auth.uid() and x.status in ('submitted', 'returned'));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = p_entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
      or exists (select 1 from public.hse_actions a where a.report_id = x.id and a.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = p_entity_id and (x.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects')));
  when 'material_request' then
    return exists (select 1 from public.material_requests x where x.id = p_entity_id and app.is_exec_internal(x.exec_project_id) and not app.has_role('gm'));
  when 'exec_doc' then
    return exists (select 1 from public.exec_docs x where x.id = p_entity_id and x.uploaded_by = auth.uid());
  when 'design_query' then
    return exists (select 1 from public.design_queries x where x.id = p_entity_id
      and (x.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'design_manager', 'lighting_designer', 'lighting_engineer')));
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
  when 'rma' then
    return exists (select 1 from public.manufacturer_claims where id = a.entity_id);
  when 'warranty_registration' then
    return exists (select 1 from public.warranty_registrations where id = a.entity_id);
  when 'eng_job' then
    return app.can_read_eng_job(a.entity_id);
  when 'eng_job_update' then
    return exists (select 1 from public.eng_job_updates u where u.id = a.entity_id and app.can_read_eng_job(u.job_id));
  when 'exec_report' then
    return exists (select 1 from public.exec_reports x where x.id = a.entity_id and (x.author_id = auth.uid() or app.is_exec_internal(x.exec_project_id)));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = a.entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
      or exists (select 1 from public.hse_actions y where y.report_id = x.id and y.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = a.entity_id and (app.is_exec_internal(x.exec_project_id) or r = 'gm'));
  when 'material_request' then
    return exists (select 1 from public.material_requests x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
  when 'exec_doc' then
    return exists (select 1 from public.exec_docs x where x.id = a.entity_id and (r in ('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec', 'design_manager', 'lighting_designer', 'lighting_engineer')
      or (app.is_exec_member(x.exec_project_id) and x.status = 'for_construction' and (x.issued_to_subs or r <> 'sub_supervisor'))));
  when 'design_query' then
    return exists (select 1 from public.design_queries x where x.id = a.entity_id
      and (app.is_exec_internal(x.exec_project_id) or r in ('design_manager', 'lighting_designer', 'lighting_engineer')));
  else
    return r = 'gm';
  end case;
end $$;
