-- 1. A sample that is not available can be ordered: the sales person asks SM Estimation, SM Estimation accepts (supplier, estimated cost,
--    lead time) or declines, SM Projects approves (it is not a sale), then a supply order (SO-) marked Sample opens with SM Estimation –
--    the PI goes to Operations as for any supply order. When the goods arrive Operations records them and the sample request continues
--    (available → SM Projects approves the sample → hand-over).
-- 2. Earlier awards (won before the system): SM Estimation sends them straight to order – Supply only → a supply order with SM Estimation,
--    Supply & installation → the hand-over of a pre-system project to SM Projects – without estimation, design or an offer. The order
--    book entry is linked (an earlier win already there) or added; an inquiry picked from the system is marked won.

-- ---------------------------------------------------------------------------
-- Supply orders for a sample, and for an earlier award
-- ---------------------------------------------------------------------------
alter table public.supply_orders alter column secured_id drop not null;
alter table public.supply_orders add column if not exists sample_id uuid unique references public.samples (id) on delete cascade;
alter table public.supply_orders add column if not exists kind text not null default 'project';
alter table public.supply_orders add column if not exists needed_by date;
alter table public.supply_orders drop constraint if exists supply_orders_kind_check;
alter table public.supply_orders add constraint supply_orders_kind_check check (kind in ('project', 'sample', 'earlier_award'));
alter table public.supply_orders drop constraint if exists supply_orders_owner;
alter table public.supply_orders add constraint supply_orders_owner check (secured_id is not null or sample_id is not null);

create or replace function pg_temp.fn_rep(p_src text, p_a text, p_b text, p_n int) returns text language plpgsql as $f$
declare n int := (length(p_src) - length(replace(p_src, p_a, ''))) / length(p_a);
begin
  if n <> p_n then raise exception 'sample orders: expected % × "%", found %', p_n, left(p_a, 80), n; end if;
  return replace(p_src, p_a, p_b);
end $f$;

do $$
declare src text;
  fill text := 'select * into s from public.secured_projects where id = o.secured_id;' || chr(10) ||
    '  if s.id is null and o.sample_id is not null then' || chr(10) ||
    '    select ''Sample '' || m.code || '' – '' || coalesce(m.project_name, ''''), m.sales_person_id into s.project_name, s.sales_person_id from public.samples m where m.id = o.sample_id;' || chr(10) ||
    '  end if;';
begin
  -- the sales person of the sample reads its supply order
  src := pg_get_functiondef('app.so_can_read(uuid)'::regprocedure);
  src := pg_temp.fn_rep(src, 's.sales_person_id = auth.uid())',
    's.sales_person_id = auth.uid())' || chr(10) || '      or exists (select 1 from public.supply_orders o join public.samples m on m.id = o.sample_id where o.id = p_order and m.sales_person_id = auth.uid())', 1);
  execute src;
  -- the list: the sample's name, client and sales person when there is no order-book entry
  src := pg_get_functiondef('public.so_list()'::regprocedure);
  src := pg_temp.fn_rep(src, 'from public.supply_orders o join public.secured_projects s on s.id = o.secured_id',
    'from public.supply_orders o left join public.secured_projects s on s.id = o.secured_id left join public.samples m on m.id = o.sample_id', 1);
  src := pg_temp.fn_rep(src, '''project'', s.project_name, ''customer'', s.customer, ''sales_person_id'', s.sales_person_id,',
    '''project'', coalesce(s.project_name, ''Sample '' || m.code || '' – '' || coalesce(m.project_name, '''')), ''customer'', coalesce(s.customer, m.client_name), ''sales_person_id'', coalesce(s.sales_person_id, m.sales_person_id), ''kind'', o.kind, ''sample_id'', o.sample_id, ''sample_code'', m.code, ''needed_by'', o.needed_by,', 1);
  execute src;
  src := pg_get_functiondef('public.so_submit(uuid[])'::regprocedure);
  src := pg_temp.fn_rep(src, 'select * into s from public.secured_projects where id = o.secured_id;', fill, 1);
  execute src;
  src := pg_get_functiondef('public.so_set_status(uuid, text, text)'::regprocedure);
  src := pg_temp.fn_rep(src, 'select * into s from public.secured_projects where id = o.secured_id;', fill, 1);
  execute src;
  -- the 5-day reminders also cover sample orders
  src := pg_get_functiondef('public.so_tick()'::regprocedure);
  src := pg_temp.fn_rep(src, 'join public.secured_projects s on s.id = o.secured_id', 'left join public.secured_projects s on s.id = o.secured_id left join public.samples m on m.id = o.sample_id', 2);
  src := pg_temp.fn_rep(src, 'select o.id, o.code, s.project_name,', 'select o.id, o.code, coalesce(s.project_name, ''Sample '' || m.code) as project_name,', 1);
  src := pg_temp.fn_rep(src, 'p.ops_status, o.code, s.project_name', 'p.ops_status, o.code, coalesce(s.project_name, ''Sample '' || m.code) as project_name', 1);
  src := pg_temp.fn_rep(src, 'and s.status = ''open''', 'and coalesce(s.status, ''open'') = ''open''', 1);
  execute src;
end $$;

-- ---------------------------------------------------------------------------
-- Ordering a sample
-- ---------------------------------------------------------------------------
alter table public.samples add column if not exists order_status text;
alter table public.samples drop constraint if exists samples_order_status_check;
alter table public.samples add constraint samples_order_status_check
  check (order_status in ('requested', 'accepted', 'approved', 'declined', 'rejected', 'arrived', 'cancelled'));
alter table public.samples add column if not exists order_reason text;
alter table public.samples add column if not exists order_needed_by date;
alter table public.samples add column if not exists order_requested_at timestamptz;
alter table public.samples add column if not exists order_supplier text;
alter table public.samples add column if not exists order_cost numeric(16, 2);
alter table public.samples add column if not exists order_currency text;
alter table public.samples add column if not exists order_lead text;
alter table public.samples add column if not exists order_accepted_by uuid references public.profiles (id);
alter table public.samples add column if not exists order_accepted_at timestamptz;
alter table public.samples add column if not exists order_decided_by uuid references public.profiles (id);
alter table public.samples add column if not exists order_decided_at timestamptz;
alter table public.samples add column if not exists order_note text;
alter table public.samples add column if not exists supply_order_id uuid references public.supply_orders (id) on delete set null;

-- SM Estimation sees the samples it is asked to order (and their items)
drop policy if exists samples_read on public.samples;
create policy samples_read on public.samples for select to authenticated
  using (sales_person_id = auth.uid() or app.has_role('gm', 'sm_projects', 'operations_exec') or (order_status is not null and app.has_role('sm_estimation')));

create or replace function app.sample_order_log(s public.samples, p_to text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.log_status('sample', s.id, null, coalesce(s.order_status, 'not_available'), 'order_' || p_to, p_note);
end $$;

-- Sales person: ask SM Estimation to order the items of a sample that is not available
create or replace function public.sample_order_request(p_sample uuid, p_reason text, p_needed_by date default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.id is not null, 'Sample request not found');
  perform app.require(s.sales_person_id = auth.uid(), 'The sales person of the sample asks for ordering');
  perform app.require(s.status = 'not_available', 'Ordering is asked for a sample that is not available');
  perform app.require(s.order_status is null or s.order_status in ('declined', 'rejected', 'cancelled'), 'Ordering is already asked for');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Say why the sample is needed');
  perform set_config('app.workflow', '1', true);
  update public.samples set order_status = 'requested', order_reason = btrim(p_reason), order_needed_by = p_needed_by, order_requested_at = now(),
    order_supplier = null, order_cost = null, order_currency = null, order_lead = null, order_accepted_by = null, order_accepted_at = null,
    order_decided_by = null, order_decided_at = null, order_note = null
   where id = s.id;
  perform app.sample_order_log(s, 'requested', btrim(p_reason));
  perform app.notify_many(app.role_users('sm_estimation'), 'sample_order', 'Sample to order – ' || s.code,
    format('%s – %s · %s', s.project_name, s.client_name, btrim(p_reason)), 'normal', 'sample', s.id, '/samples/' || s.id, null, true);
end $$;

create or replace function public.sample_order_cancel(p_sample uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.sales_person_id = auth.uid(), 'The sales person cancels the ordering request');
  perform app.require(s.order_status = 'requested', 'Only a request not yet accepted can be cancelled');
  perform set_config('app.workflow', '1', true);
  update public.samples set order_status = 'cancelled' where id = s.id;
  perform app.sample_order_log(s, 'cancelled', null);
end $$;

-- SM Estimation: accept (supplier, estimated cost, lead time) → SM Projects, or decline with the reason
create or replace function public.sample_order_accept(p_sample uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  perform app.require(app.has_role('sm_estimation', 'gm'), 'SM Estimation accepts the ordering');
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.order_status = 'requested', 'The ordering is not waiting for SM Estimation');
  perform app.require(coalesce(btrim(p ->> 'supplier'), '') <> '', 'Enter the supplier / manufacturer');
  perform app.require(coalesce(btrim(p ->> 'lead'), '') <> '', 'Enter the lead time');
  perform set_config('app.workflow', '1', true);
  update public.samples set order_status = 'accepted', order_supplier = btrim(p ->> 'supplier'), order_cost = nullif(p ->> 'cost', '')::numeric,
    order_currency = coalesce(nullif(p ->> 'currency', ''), 'USD'), order_lead = btrim(p ->> 'lead'), order_note = nullif(btrim(p ->> 'note'), ''),
    order_accepted_by = auth.uid(), order_accepted_at = now()
   where id = s.id;
  perform app.sample_order_log(s, 'accepted', concat_ws(' · ', btrim(p ->> 'supplier'), nullif(p ->> 'cost', ''), btrim(p ->> 'lead')));
  perform app.notify_many(app.role_users('sm_projects'), 'sample_order', 'Approve ordering sample items – ' || s.code,
    format('%s – %s · %s · %s', s.project_name, s.client_name, btrim(p ->> 'supplier'), btrim(p ->> 'lead')), 'normal', 'sample', s.id, '/samples/' || s.id, null, true);
  perform app.notify(s.sales_person_id, 'sample_step', 'Ordering accepted by SM Estimation – with SM Projects', s.code, 'normal', 'sample', s.id, '/samples/' || s.id);
end $$;

create or replace function public.sample_order_decline(p_sample uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  perform app.require(app.has_role('sm_estimation', 'gm'), 'SM Estimation declines the ordering');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.order_status = 'requested', 'The ordering is not waiting for SM Estimation');
  perform set_config('app.workflow', '1', true);
  update public.samples set order_status = 'declined', order_note = btrim(p_reason), order_decided_by = auth.uid(), order_decided_at = now() where id = s.id;
  perform app.sample_order_log(s, 'declined', btrim(p_reason));
  perform app.notify(s.sales_person_id, 'sample_step', 'Ordering declined by SM Estimation – ' || s.code, btrim(p_reason), 'normal', 'sample', s.id, '/samples/' || s.id);
end $$;

-- SM Projects: approve → the supply order (Sample) opens with SM Estimation; or reject with the reason
create or replace function public.sample_order_decide(p_sample uuid, p_approve boolean, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.samples; oid uuid; c text;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'SM Projects approves ordering for a sample');
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.order_status = 'accepted', 'The ordering is not waiting for SM Projects');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  perform set_config('app.workflow', '1', true);
  if not p_approve then
    update public.samples set order_status = 'rejected', order_note = btrim(p_note), order_decided_by = auth.uid(), order_decided_at = now() where id = s.id;
    perform app.sample_order_log(s, 'rejected', btrim(p_note));
    perform app.notify_many(array[s.sales_person_id] || app.role_users('sm_estimation'), 'sample_step', 'Ordering for sample ' || s.code || ' not approved',
      btrim(p_note), 'normal', 'sample', s.id, '/samples/' || s.id);
    return null;
  end if;
  c := app.next_code('SO');
  insert into public.supply_orders (code, sample_id, project_id, kind, mfr_count, needed_by) values (c, s.id, s.project_id, 'sample', 1, s.order_needed_by)
  returning id into oid;
  update public.samples set order_status = 'approved', order_decided_by = auth.uid(), order_decided_at = now(), supply_order_id = oid,
    order_note = coalesce(nullif(btrim(p_note), ''), order_note)
   where id = s.id;
  perform app.sample_order_log(s, 'approved', c);
  perform app.notify_many(app.role_users('sm_estimation'), 'supply_order', 'Sample order approved – get the PI',
    format('%s · sample %s · %s', c, s.code, coalesce(s.order_supplier, '')), 'normal', 'supply_order', oid, '/supply-orders/' || oid);
  perform app.notify(s.sales_person_id, 'sample_step', 'Ordering approved – ' || c, s.code || ' · ' || coalesce(s.order_lead, ''), 'normal', 'sample', s.id, '/samples/' || s.id);
  return oid;
end $$;

-- Operations: the ordered goods arrived → available; the sample request continues with SM Projects' approval
create or replace function public.sample_order_arrived(p_sample uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive records the arrival');
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.order_status = 'approved', 'The sample is not on order');
  perform set_config('app.workflow', '1', true);
  update public.samples set order_status = 'arrived', availability = 'available',
    availability_note = concat_ws(' · ', 'Arrived on order ' || (select code from public.supply_orders where id = s.supply_order_id), nullif(btrim(p_note), '')),
    availability_checked_at = now(), status = 'availability_confirmed'
   where id = s.id;
  perform app.sample_order_log(s, 'arrived', nullif(btrim(p_note), ''));
  perform app.notify_many(app.role_users('sm_projects'), 'sample_request', 'Approve sample request ' || s.code,
    format('%s – %s (ordered items arrived)', s.project_name, s.client_name), 'normal', 'sample', s.id, '/samples/' || s.id, null, true);
  perform app.notify(s.sales_person_id, 'sample_step', 'Sample items arrived – with SM Projects for approval', s.code, 'normal', 'sample', s.id, '/samples/' || s.id);
end $$;

-- SM Projects' approvals list: sample orders accepted by SM Estimation
do $$
declare src text;
begin
  src := pg_get_functiondef('app.exec_pending_approvals'::regproc);
  if position(chr(10) || '$function$' in src) = 0 then raise exception 'approvals list end not found'; end if;
  src := regexp_replace(src, '\n\$function\$\s*$',
    E'\n  union all\n  select ''sample_order'', s.id, ''sample_order'', format(''Order sample items – %s'', s.code),\n' ||
    E'         concat_ws('' · '', s.project_name, s.order_supplier, s.order_lead), s.order_accepted_by, app.display_name(s.order_accepted_by), s.order_accepted_at, null::uuid,\n' ||
    E'         ''/samples/'' || s.id, ''SM Projects''\n  from public.samples s where s.order_status = ''accepted'' and app.has_role(''sm_projects'')\n$function$\n');
  execute src;
end $$;

-- ---------------------------------------------------------------------------
-- Earlier awards straight to order (SM Estimation)
-- ---------------------------------------------------------------------------
-- SM Estimation may enter a pre-system project for execution (SM Projects still approves); the SEE is chosen by SM Projects then
do $$
declare src text;
begin
  src := pg_get_functiondef('public.request_execution(jsonb)'::regprocedure);
  src := pg_temp.fn_rep(src, 'perform app.require(app.has_role(''senior_elec_engineer''), ''The Senior Electrical Engineer enters projects won before the system'');',
    'perform app.require(app.has_role(''senior_elec_engineer'') or (app.has_role(''sm_estimation'', ''gm'') and current_setting(''app.earlier_award'', true) = ''1''), ''The Senior Electrical Engineer enters projects won before the system'');', 1);
  src := pg_temp.fn_rep(src, 'case when k = ''legacy'' then auth.uid() end', 'case when k = ''legacy'' and app.has_role(''senior_elec_engineer'') then auth.uid() end', 1);
  execute src;
end $$;

-- p: {inquiry_id, project_name, customer, sales_person_id, business_line, po_no, order_value, currency, won_on, type: supply | supply_install,
--     secured_id (link an order-book entry) | null (add one), mfr_count, needed_by, site_address, start_date, end_date, see_id, areas[], note}
create or replace function public.send_earlier_award(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries; s public.secured_projects; t text := p ->> 'type'; v numeric := nullif(p ->> 'order_value', '')::numeric;
  cur public.currency; won date := nullif(p ->> 'won_on', '')::date; nm text := nullif(btrim(p ->> 'project_name'), '');
  cust text := nullif(btrim(p ->> 'customer'), ''); sp uuid := nullif(p ->> 'sales_person_id', '')::uuid; oid uuid; c text; rid uuid; sid uuid;
begin
  perform app.require(app.has_role('sm_estimation', 'gm'), 'SM Estimation sends earlier awards to order');
  perform app.require(t in ('supply', 'supply_install'), 'Choose Supply only or Supply & installation');
  perform app.require(v is not null and v > 0, 'Enter the order value');
  perform app.require(won is not null and won <= (now() at time zone app.tz())::date, 'Enter the award date');
  perform app.require(coalesce(nullif(p ->> 'currency', ''), 'LKR') in ('LKR', 'USD'), 'Currency LKR or USD');
  cur := coalesce(nullif(p ->> 'currency', ''), 'LKR')::public.currency;
  if nullif(p ->> 'inquiry_id', '') is not null then
    select * into i from public.inquiries where id = (p ->> 'inquiry_id')::uuid;
    perform app.require(i.id is not null, 'Inquiry not found');
    nm := coalesce(nm, i.project_name, i.inquiry_name); cust := coalesce(cust, i.customer_name); sp := coalesce(sp, i.sales_person_id);
  end if;
  perform app.require(nm is not null and cust is not null, 'Enter the project name and the customer');

  -- the order-book entry: an earlier win already there, or a new one
  if nullif(p ->> 'secured_id', '') is not null then
    select * into s from public.secured_projects where id = (p ->> 'secured_id')::uuid for update;
    perform app.require(s.id is not null, 'Order-book entry not found');
    perform app.require(s.status = 'open', 'This order-book entry is closed');
    if i.id is not null and s.project_id is null and not exists (select 1 from public.secured_projects where project_id = i.project_id) then
      update public.secured_projects set project_id = i.project_id where id = s.id;
    end if;
  end if;
  -- the inquiry picked from the system is won (its order-book entry is the linked one, or made from the inquiry)
  if i.id is not null and i.result is distinct from 'won' then
    perform app.stop_clocks('inquiry', i.id);
    perform set_config('app.workflow', '1', true);
    update public.inquiries set result = 'won', order_value = v, order_date = won, lost_reason = null where id = i.id;
    update public.quotations set result = 'won' where inquiry_id = i.id and revision = i.revision;
    perform app.set_inquiry_status(i.id, 'won', 'Earlier award – sent to order by SM Estimation');
    if not exists (select 1 from public.inquiries where project_id = i.project_id and id <> i.id and app.inquiry_open(status) and status <> 'draft') then
      update public.projects set milestone = 'won', stage = 'Award' where id = i.project_id and milestone <> 'won';
    else
      perform app.sync_project_pct(i.project_id);
    end if;
    perform app.refresh_inquiry(i.id);
  end if;
  if s.id is null then
    if i.id is not null then
      sid := app.secure_inquiry_win(i.id);
      select * into s from public.secured_projects where id = sid for update;
    end if;
    if s.id is null then
      insert into public.secured_projects (code, project_id, project_name, customer, business_line, sales_person_id, po_no, order_value, won_on, source, notes)
      values (app.next_code('SEC'), i.project_id, nm, cust, nullif(p ->> 'business_line', ''), sp, nullif(btrim(p ->> 'po_no'), ''),
              round(app.to_lkr(v, cur, won), 2), won, 'won', 'Earlier award – entered by SM Estimation')
      returning * into s;
      insert into public.secured_log (secured_id, action, note) values (s.id, 'won', 'Earlier award added by SM Estimation · ' || app.fmt_money(v, cur));
    end if;
    update public.secured_projects set po_no = coalesce(po_no, nullif(btrim(p ->> 'po_no'), '')) where id = s.id;
    perform app.notify_many(app.role_users('sm_projects') || app.role_users('operations_exec') || array[s.sales_person_id], 'secured_new',
      'Earlier award added to the order book – check the value and add the invoice plan', concat_ws(' · ', s.project_name, s.customer, app.fmt_money(v, cur)),
      'normal', 'secured_project', s.id, app.secured_url(s.id));
  end if;

  -- the project type, then the order (once)
  perform app.require(not exists (select 1 from public.secured_log where secured_id = s.id and action in ('supply_order', 'handover') and note like 'Earlier award%'),
    'This earlier award was already sent to order');
  perform app.require(not exists (select 1 from public.supply_orders where secured_id = s.id), 'This project already has a supply order');
  perform app.require(t = 'supply_install' or s.project_id is null or not exists (select 1 from public.exec_projects where project_id = s.project_id),
    'The project is already with the execution team');
  update public.secured_projects set project_type = t where id = s.id;
  if t = 'supply' then
    c := app.next_code('SO');
    insert into public.supply_orders (code, secured_id, project_id, kind, mfr_count, needed_by)
    values (c, s.id, s.project_id, 'earlier_award', greatest(1, least(50, coalesce(nullif(p ->> 'mfr_count', '')::int, 1))), nullif(p ->> 'needed_by', '')::date)
    returning id into oid;
    insert into public.secured_log (secured_id, action, note) values (s.id, 'supply_order', 'Earlier award – ' || c || ' opened by SM Estimation, without estimation or an offer');
    perform app.notify_many(app.role_users('operations_exec') || array[s.sales_person_id], 'supply_order', 'Earlier award sent to order – supply only',
      format('%s · %s · PIs by SM Estimation', c, s.project_name), 'normal', 'supply_order', oid, '/supply-orders/' || oid);
    return jsonb_build_object('kind', 'supply_order', 'id', oid, 'code', c, 'secured_id', s.id);
  end if;
  perform set_config('app.earlier_award', '1', true);
  rid := public.request_execution(jsonb_build_object('kind', 'legacy', 'name', s.project_name, 'client_name', coalesce(s.customer, cust),
    'contract_value', round(app.to_lkr(v, cur, won), 2), 'contract_ref', coalesce(nullif(btrim(p ->> 'po_no'), ''), s.po_no),
    'site_address', p ->> 'site_address', 'start_date', p ->> 'start_date', 'end_date', p ->> 'end_date', 'areas', coalesce(p -> 'areas', '[]'),
    'see_id', p ->> 'see_id', 'note', concat_ws(' · ', 'Earlier award sent by SM Estimation', nullif(btrim(p ->> 'note'), '')),
    'letter_sign_name', p ->> 'letter_sign_name', 'letter_sign_designation', p ->> 'letter_sign_designation', 'letter_sign_phone', p ->> 'letter_sign_phone',
    'police_required', coalesce((p ->> 'police_required')::boolean, false)));
  perform set_config('app.earlier_award', '', true);
  update public.exec_requests set project_id = s.project_id where id = rid and s.project_id is not null;
  insert into public.secured_log (secured_id, action, note) values (s.id, 'handover', 'Earlier award – hand-over to execution requested by SM Estimation');
  if s.sales_person_id is not null then
    perform app.notify(s.sales_person_id, 'exec_request', 'Earlier award sent to execution – with SM Projects', s.project_name, 'normal', 'exec_request', rid, '/execution/handover/' || rid);
  end if;
  return jsonb_build_object('kind', 'exec_request', 'id', rid, 'secured_id', s.id);
end $$;

-- What SM Estimation picks from: inquiries not lost or cancelled, and open order-book entries without a supply order
create or replace function public.earlier_award_options() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.has_role('sm_estimation', 'gm'), 'SM Estimation sends earlier awards to order');
  return jsonb_build_object(
    'inquiries', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code, 'name', coalesce(i.project_name, i.inquiry_name), 'customer', i.customer_name,
        'sales_person_id', i.sales_person_id, 'currency', i.currency, 'result', i.result, 'status', i.status) order by i.created_at desc), '[]')
      from public.inquiries i where i.project_id is not null and i.status not in ('lost', 'cancelled', 'rejected') and coalesce(i.result, '') not in ('lost', 'cancelled')),
    'secured', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.project_name, 'customer', s.customer, 'order_value', s.order_value,
        'source', s.source, 'won_on', s.won_on, 'sales_person_id', s.sales_person_id, 'business_line', s.business_line, 'po_no', s.po_no) order by s.won_on desc), '[]')
      from public.secured_projects s where s.status = 'open' and not exists (select 1 from public.supply_orders o where o.secured_id = s.id)),
    'areas', to_jsonb(app.exec_areas()));
end $$;
revoke execute on function public.earlier_award_options() from public, anon;
grant execute on function public.earlier_award_options() to authenticated, service_role;

revoke execute on function public.sample_order_request(uuid, text, date), public.sample_order_cancel(uuid), public.sample_order_accept(uuid, jsonb),
  public.sample_order_decline(uuid, text), public.sample_order_decide(uuid, boolean, text), public.sample_order_arrived(uuid, text),
  public.send_earlier_award(jsonb) from public, anon;
grant execute on function public.sample_order_request(uuid, text, date), public.sample_order_cancel(uuid), public.sample_order_accept(uuid, jsonb),
  public.sample_order_decline(uuid, text), public.sample_order_decide(uuid, boolean, text), public.sample_order_arrived(uuid, text),
  public.send_earlier_award(jsonb) to authenticated, service_role;
