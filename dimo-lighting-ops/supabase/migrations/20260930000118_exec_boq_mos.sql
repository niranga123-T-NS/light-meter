-- Contract BOQ, measurement by quantity and Material on Site
--  * The SEE or Operations uploads the priced BOQ (Excel – one sheet or split into bills / sections). The total is checked
--    against the order value; SM Projects approves it as the contract baseline (with the Material on Site % the contract allows).
--  * Monthly progress claims: the AE enters the quantity done to date per BOQ item (quantities only – no rates) and the
--    material on site to claim (from the site store: delivered and acknowledged, not yet issued). The valuation
--    (work done × BOQ rates + material on site × rate × allowed %, less what was certified before) is seen by the SEE,
--    SM Projects, GM and Operations only. Valuations are cumulative, so material claimed earlier and since installed is
--    recovered automatically.
--  * Variations priced from contract rates (route C) pick BOQ items; an accepted variation becomes BOQ items.

create table public.exec_boqs (
  exec_project_id uuid primary key references public.exec_projects (id) on delete cascade,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'returned')),
  version int not null default 0,                  -- approvals so far (0 = never approved)
  file_name text,
  sheets text[],
  total numeric(16, 2) not null default 0,
  mos_pct numeric(5, 2) not null default 0 check (mos_pct between 0 and 100),   -- 0 = material on site not paid
  uploaded_by uuid default auth.uid() references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  submit_note text,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text
);
create table public.exec_boq_items (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  seq int not null,
  section text,                                    -- bill / section (sheet name or bill heading)
  item_no text,
  description text not null,
  unit text,
  qty numeric(16, 3),
  rate numeric(16, 2),
  amount numeric(16, 2) not null default 0,
  heading boolean not null default false,          -- sub-heading rows without quantity
  source text not null default 'boq' check (source in ('boq', 'variation')),
  variation_id uuid references public.variations (id) on delete set null,
  removed boolean not null default false           -- dropped by a revised upload but already measured
);
create index on public.exec_boq_items (exec_project_id, seq);

create table public.exec_ipc_lines (
  ipc_id uuid not null references public.exec_ipcs (id) on delete cascade,
  boq_item_id uuid not null references public.exec_boq_items (id),
  qty_to_date numeric(16, 3) not null check (qty_to_date >= 0),
  primary key (ipc_id, boq_item_id)
);
create table public.exec_ipc_mos (
  id uuid primary key default gen_random_uuid(),
  ipc_id uuid not null references public.exec_ipcs (id) on delete cascade,
  item text not null,
  unit text not null,
  qty numeric(16, 3) not null check (qty > 0),
  boq_item_id uuid not null references public.exec_boq_items (id)
);
-- Money of a claim (billing roles only)
create table public.exec_ipc_values (
  ipc_id uuid primary key references public.exec_ipcs (id) on delete cascade,
  work_value numeric(16, 2) not null default 0,
  mos_value numeric(16, 2) not null default 0,
  gross_value numeric(16, 2) not null default 0,   -- work done + material on site, to date
  previous_certified numeric(16, 2) not null default 0,
  previous_mos numeric(16, 2) not null default 0,
  suggested numeric(16, 2) not null default 0      -- gross − previously certified
);
create table public.exec_variation_boq (
  variation_id uuid not null references public.variations (id) on delete cascade,
  boq_item_id uuid not null references public.exec_boq_items (id),
  qty numeric(16, 3) not null check (qty > 0),
  rate numeric(16, 2) not null,
  primary key (variation_id, boq_item_id)
);

alter table public.exec_boqs enable row level security;
alter table public.exec_boq_items enable row level security;
alter table public.exec_ipc_lines enable row level security;
alter table public.exec_ipc_mos enable row level security;
alter table public.exec_ipc_values enable row level security;
alter table public.exec_variation_boq enable row level security;
create policy exec_boqs_read on public.exec_boqs for select to authenticated using (app.sees_billing());
create policy exec_boq_items_read on public.exec_boq_items for select to authenticated using (app.sees_billing());
-- quantities only: whoever sees the claim
create policy exec_ipc_lines_read on public.exec_ipc_lines for select to authenticated using (exists (select 1 from public.exec_ipcs c where c.id = ipc_id));
create policy exec_ipc_mos_read on public.exec_ipc_mos for select to authenticated using (exists (select 1 from public.exec_ipcs c where c.id = ipc_id));
create policy exec_ipc_values_read on public.exec_ipc_values for select to authenticated using (app.sees_billing());
create policy exec_variation_boq_read on public.exec_variation_boq for select to authenticated using (app.sees_billing());
grant select on public.exec_boqs, public.exec_boq_items, public.exec_ipc_lines, public.exec_ipc_mos, public.exec_ipc_values, public.exec_variation_boq to authenticated;

create or replace function app.boq_total(p_exec uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare t numeric;
begin
  select coalesce(sum(amount), 0) into t from public.exec_boq_items where exec_project_id = p_exec and not heading and not removed;
  update public.exec_boqs set total = t where exec_project_id = p_exec;
  return t;
end $$;

create or replace function app.boq_order_value(p_exec uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select s.order_value from public.exec_projects e join public.secured_projects s on s.id = e.secured_id where e.id = p_exec),
                  (select contract_value_lkr from public.exec_projects where id = p_exec))
$$;

-- Upload (or re-upload) the priced BOQ. p_items: [{section, item_no, description, unit, qty, rate, amount}]
-- Rows without quantity and rate are sub-headings. Items already measured are kept (marked removed) if a revision drops them.
create or replace function public.save_boq(p_exec uuid, p_items jsonb, p_file text default null, p_sheets text[] default null,
                                           p_mos_pct numeric default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.exec_boqs; x jsonb; i int := 0; q numeric; r numeric; a numeric; hd boolean; d text; keep uuid[] := '{}'; hit uuid; t numeric; ov numeric;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'operations_exec'), 'The Senior Electrical Engineer or Operations uploads the BOQ');
  perform app.require(exists (select 1 from public.exec_projects where id = p_exec), 'Project not found');
  perform app.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0, 'The BOQ has no items');
  perform app.require(p_mos_pct is null or p_mos_pct between 0 and 100, 'Material on Site % must be between 0 and 100');
  select * into b from public.exec_boqs where exec_project_id = p_exec for update;
  perform app.require(b.exec_project_id is null or b.version = 0 or coalesce(btrim(p_note), '') <> '', 'Give the reason for the revised BOQ');
  if b.exec_project_id is null then
    insert into public.exec_boqs (exec_project_id) values (p_exec) returning * into b;
  end if;
  for x in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    d := btrim(x ->> 'description');
    perform app.require(coalesce(d, '') <> '', format('Row %s has no description', i));
    begin q := nullif(x ->> 'qty', '')::numeric; r := nullif(x ->> 'rate', '')::numeric; a := nullif(x ->> 'amount', '')::numeric;
    exception when others then perform app.require(false, format('Row %s: quantity, rate and amount must be numbers', i)); end;
    hd := q is null and r is null and a is null;
    a := round(coalesce(a, q * r, 0), 2);
    select id into hit from public.exec_boq_items
     where exec_project_id = p_exec and source = 'boq' and id <> all (keep)
       and coalesce(section, '') = coalesce(btrim(x ->> 'section'), '') and coalesce(item_no, '') = coalesce(btrim(x ->> 'item_no'), '') and description = d
     order by seq limit 1;
    if hit is null then
      insert into public.exec_boq_items (exec_project_id, seq, section, item_no, description, unit, qty, rate, amount, heading)
      values (p_exec, i, nullif(btrim(x ->> 'section'), ''), nullif(btrim(x ->> 'item_no'), ''), d, nullif(btrim(x ->> 'unit'), ''), q, r, a, hd)
      returning id into hit;
    else
      update public.exec_boq_items set seq = i, unit = nullif(btrim(x ->> 'unit'), ''), qty = q, rate = r, amount = a, heading = hd, removed = false where id = hit;
    end if;
    keep := keep || hit;
  end loop;
  -- dropped items: delete, or keep as removed when already measured or priced into a variation
  update public.exec_boq_items set removed = true
   where exec_project_id = p_exec and source = 'boq' and id <> all (keep)
     and (exists (select 1 from public.exec_ipc_lines where boq_item_id = exec_boq_items.id) or exists (select 1 from public.exec_ipc_mos where boq_item_id = exec_boq_items.id)
          or exists (select 1 from public.exec_variation_boq where boq_item_id = exec_boq_items.id));
  delete from public.exec_boq_items where exec_project_id = p_exec and source = 'boq' and id <> all (keep) and not removed;
  -- variation items after the contract items
  update public.exec_boq_items set seq = i + seq where exec_project_id = p_exec and source = 'variation';
  perform app.require(exists (select 1 from public.exec_boq_items where exec_project_id = p_exec and not heading and not removed and amount <> 0), 'The BOQ has no priced items');
  t := app.boq_total(p_exec);
  ov := app.boq_order_value(p_exec);
  update public.exec_boqs set status = 'submitted', file_name = nullif(btrim(p_file), ''), sheets = p_sheets, mos_pct = coalesce(p_mos_pct, mos_pct),
    uploaded_by = auth.uid(), uploaded_at = now(), submit_note = nullif(btrim(p_note), ''), decision_note = null
  where exec_project_id = p_exec;
  perform app.notify_many(app.role_users('sm_projects'), 'exec_billing', case when b.version = 0 then 'Contract BOQ to approve' else 'Revised contract BOQ to approve' end,
    concat_ws(' · ', app.exec_head(p_exec), app.fmt_money(t, 'LKR'),
              case when ov is not null and abs(t - ov) > 1 then 'order value ' || app.fmt_money(ov, 'LKR') || ' – difference ' || app.fmt_money(t - ov, 'LKR') end,
              nullif(btrim(p_note), '')),
    'normal', 'exec_project', p_exec, '/execution/boq/' || p_exec, null, true);
  return jsonb_build_object('items', i, 'total', t, 'order_value', ov);
end $$;

-- Material on Site % (contract allowance); a change after approval goes back to SM Projects
create or replace function public.set_boq_mos(p_exec uuid, p_pct numeric, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.exec_boqs;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'operations_exec'), 'The Senior Electrical Engineer or Operations sets it');
  perform app.require(p_pct between 0 and 100, 'Material on Site % must be between 0 and 100');
  select * into b from public.exec_boqs where exec_project_id = p_exec for update;
  perform app.require(b.exec_project_id is not null, 'Upload the BOQ first');
  perform app.require(b.version = 0 or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.exec_boqs set mos_pct = p_pct, status = 'submitted', uploaded_by = auth.uid(), uploaded_at = now(),
    submit_note = coalesce(nullif(btrim(p_note), ''), submit_note) where exec_project_id = p_exec;
  perform app.notify_many(app.role_users('sm_projects'), 'exec_billing', 'Contract BOQ to approve',
    concat_ws(' · ', app.exec_head(p_exec), format('Material on Site %s%%', p_pct), nullif(btrim(p_note), '')), 'normal', 'exec_project', p_exec, '/execution/boq/' || p_exec, null, true);
end $$;

create or replace function public.decide_boq(p_exec uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare b public.exec_boqs;
begin
  perform app.require(app.has_role('sm_projects'), 'SM Projects approves the contract BOQ');
  select * into b from public.exec_boqs where exec_project_id = p_exec for update;
  perform app.require(b.exec_project_id is not null and b.status = 'submitted', 'The BOQ is not waiting for approval');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.exec_boqs set status = case when p_approve then 'approved' else 'returned' end, version = version + case when p_approve then 1 else 0 end,
    decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '') where exec_project_id = p_exec;
  perform app.notify(b.uploaded_by, 'exec_billing', case when p_approve then 'Contract BOQ approved' else 'Contract BOQ returned' end,
    concat_ws(' · ', app.exec_head(p_exec), nullif(btrim(p_note), '')), 'normal', 'exec_project', p_exec, '/execution/boq/' || p_exec);
  return case when p_approve then 'approved' else 'returned' end;
end $$;

-- Site store balance of an item (delivered and acknowledged, less issued / transferred)
create or replace function app.store_balance(p_exec uuid, p_item text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when kind in ('receipt', 'return', 'transfer_in') then qty else -qty end), 0)
  from public.store_moves where exec_project_id = p_exec and lower(item) = lower(btrim(p_item))
$$;

-- What the AE needs to measure: BOQ items (no rates), the last quantities, the site store
create or replace function public.claim_context(p_exec uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b public.exec_boqs; last uuid;
begin
  perform app.require(app.is_exec_internal(p_exec), 'Not your project');
  select * into b from public.exec_boqs where exec_project_id = p_exec;
  select id into last from public.exec_ipcs where exec_project_id = p_exec and status <> 'returned' order by prepared_at desc, code desc limit 1;
  return jsonb_build_object(
    'boq', case when b.exec_project_id is null then null else jsonb_build_object('status', b.status, 'version', b.version, 'mos_pct', b.mos_pct) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'section', i.section, 'item_no', i.item_no, 'description', i.description, 'unit', i.unit,
                                                           'qty', i.qty, 'heading', i.heading,
                                                           'last_qty', (select qty_to_date from public.exec_ipc_lines where ipc_id = last and boq_item_id = i.id)) order by i.seq)
                       from public.exec_boq_items i where i.exec_project_id = p_exec and not i.removed and b.version > 0), '[]'),
    'store', coalesce((select jsonb_agg(jsonb_build_object('item', s.item, 'unit', s.unit, 'balance', s.bal) order by s.item)
                       from (select min(item) item, min(unit) unit, sum(case when kind in ('receipt', 'return', 'transfer_in') then qty else -qty end) bal
                             from public.store_moves where exec_project_id = p_exec group by lower(item)) s where s.bal > 0), '[]'),
    'last_mos', coalesce((select jsonb_agg(jsonb_build_object('item', m.item, 'unit', m.unit, 'qty', m.qty, 'boq_item_id', m.boq_item_id))
                          from public.exec_ipc_mos m where m.ipc_id = last), '[]'));
end $$;

-- Valuation of a claim (cumulative): work done × rates + material on site × rate × allowed %, less certified before
create or replace function app.value_ipc(p_ipc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.exec_ipcs; w numeric; m numeric; prev numeric; pm numeric; pct numeric;
begin
  select * into c from public.exec_ipcs where id = p_ipc;
  select coalesce(mos_pct, 0) into pct from public.exec_boqs where exec_project_id = c.exec_project_id;
  select coalesce(sum(l.qty_to_date * coalesce(i.rate, 0)), 0) into w from public.exec_ipc_lines l join public.exec_boq_items i on i.id = l.boq_item_id where l.ipc_id = p_ipc;
  select coalesce(sum(x.qty * coalesce(i.rate, 0) * coalesce(pct, 0) / 100), 0) into m from public.exec_ipc_mos x join public.exec_boq_items i on i.id = x.boq_item_id where x.ipc_id = p_ipc;
  select coalesce(sum(certified_value), 0) into prev from public.exec_ipcs where exec_project_id = c.exec_project_id and status = 'certified' and id <> c.id and prepared_at <= c.prepared_at;
  select v.mos_value into pm from public.exec_ipcs p join public.exec_ipc_values v on v.ipc_id = p.id
   where p.exec_project_id = c.exec_project_id and p.status = 'certified' and p.id <> c.id and p.prepared_at <= c.prepared_at order by p.prepared_at desc, p.code desc limit 1;
  insert into public.exec_ipc_values (ipc_id, work_value, mos_value, gross_value, previous_certified, previous_mos, suggested)
  values (p_ipc, round(w, 2), round(m, 2), round(w + m, 2), prev, coalesce(pm, 0), round(w + m - prev, 2))
  on conflict (ipc_id) do update set work_value = excluded.work_value, mos_value = excluded.mos_value, gross_value = excluded.gross_value,
    previous_certified = excluded.previous_certified, previous_mos = excluded.previous_mos, suggested = excluded.suggested;
end $$;

-- Progress claim measurement. With an approved BOQ: p_lines [{boq_item_id, qty_to_date}] (items left out keep the last quantity)
-- and p_mos [{item, unit, qty, boq_item_id}]; without one: the % done (as before).
drop function if exists public.prepare_ipc(uuid, date, numeric, text);
create or replace function public.prepare_ipc(p_exec uuid, p_period date, p_pct numeric default null, p_measurement text default null,
                                              p_lines jsonb default null, p_mos jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare iid uuid; b public.exec_boqs; live boolean; last uuid; x jsonb; it public.exec_boq_items; tot numeric; w numeric; pct numeric := p_pct; bal numeric;
begin
  perform app.require(app.is_project_ae(p_exec) or app.has_role('senior_elec_engineer'), 'Assistant Engineers of the project prepare the measurement');
  perform app.require(p_period is not null, 'Enter the month of the claim');
  select * into b from public.exec_boqs where exec_project_id = p_exec;
  live := coalesce(b.version, 0) > 0;
  p_lines := coalesce(p_lines, '[]'); p_mos := coalesce(p_mos, '[]');
  if live then
    perform app.require(jsonb_array_length(p_lines) > 0 or jsonb_array_length(p_mos) > 0, 'Enter the quantities done to date');
  else
    perform app.require(jsonb_array_length(p_lines) = 0 and jsonb_array_length(p_mos) = 0, 'The contract BOQ is not approved yet – enter the % done');
    perform app.require(pct between 0 and 100, 'Enter the month and the % measured');
    perform app.require(coalesce(btrim(p_measurement), '') <> '', 'Describe the measured work (or attach the measurement sheet)');
  end if;
  perform app.require(jsonb_array_length(p_mos) = 0 or coalesce(b.mos_pct, 0) > 0, 'Material on Site is not paid under this contract (no % set on the BOQ)');
  select id into last from public.exec_ipcs where exec_project_id = p_exec and status <> 'returned' order by prepared_at desc, code desc limit 1;
  insert into public.exec_ipcs (code, exec_project_id, period, measured_pct, measurement)
  values (app.next_code('IPC'), p_exec, app.month_of(p_period), coalesce(pct, 0), nullif(btrim(p_measurement), ''))
  returning id into iid;
  if live then
    for x in select * from jsonb_array_elements(p_lines) loop
      select * into it from public.exec_boq_items where id = (x ->> 'boq_item_id')::uuid and exec_project_id = p_exec and not heading;
      perform app.require(it.id is not null, 'Choose items of this project''s BOQ');
      perform app.require(coalesce((x ->> 'qty_to_date')::numeric, -1) >= 0, format('Enter the quantity done to date for %s', coalesce(it.item_no, it.description)));
      insert into public.exec_ipc_lines (ipc_id, boq_item_id, qty_to_date) values (iid, it.id, (x ->> 'qty_to_date')::numeric)
      on conflict (ipc_id, boq_item_id) do update set qty_to_date = excluded.qty_to_date;
    end loop;
    -- items not entered keep the last measured quantity
    insert into public.exec_ipc_lines (ipc_id, boq_item_id, qty_to_date)
    select iid, l.boq_item_id, l.qty_to_date from public.exec_ipc_lines l where l.ipc_id = last on conflict do nothing;
    delete from public.exec_ipc_lines where ipc_id = iid and qty_to_date = 0;
    for x in select * from jsonb_array_elements(p_mos) loop
      select * into it from public.exec_boq_items where id = (x ->> 'boq_item_id')::uuid and exec_project_id = p_exec and not heading;
      perform app.require(it.id is not null, format('Choose the BOQ item for %s', x ->> 'item'));
      bal := app.store_balance(p_exec, x ->> 'item');
      perform app.require(coalesce((x ->> 'qty')::numeric, 0) > 0 and (x ->> 'qty')::numeric <= bal,
        format('Only %s %s of %s is in the site store', bal, coalesce(x ->> 'unit', ''), x ->> 'item'));
      insert into public.exec_ipc_mos (ipc_id, item, unit, qty, boq_item_id) values (iid, btrim(x ->> 'item'), coalesce(nullif(btrim(x ->> 'unit'), ''), 'nos'), (x ->> 'qty')::numeric, it.id);
    end loop;
    -- % done = work measured / BOQ total
    select coalesce(sum(l.qty_to_date * coalesce(i.rate, 0)), 0) into w from public.exec_ipc_lines l join public.exec_boq_items i on i.id = l.boq_item_id where l.ipc_id = iid;
    tot := nullif(b.total, 0);
    update public.exec_ipcs set measured_pct = least(100, round(coalesce(w / tot * 100, 0), 2)),
      measurement = coalesce(measurement, format('%s BOQ items measured%s', (select count(*) from public.exec_ipc_lines where ipc_id = iid),
                                                 case when jsonb_array_length(p_mos) > 0 then format(' · %s material on site', jsonb_array_length(p_mos)) else '' end))
    where id = iid;
  end if;
  perform app.value_ipc(iid);
  select measured_pct into pct from public.exec_ipcs where id = iid;
  perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_ipc', 'Progress claim measurement to check', app.exec_head(p_exec) || ' · ' || to_char(p_period, 'Mon YYYY') ||
    ' · ' || pct || '%', 'normal', 'exec_project', p_exec, '/execution/claim/' || iid, null, true);
  return iid;
end $$;

-- Detail of a claim: quantities for the project team; rates and values for the billing roles only
create or replace function public.ipc_detail(p_ipc uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.exec_ipcs; money boolean := app.sees_billing(); prevc uuid; pct numeric;
begin
  select * into c from public.exec_ipcs where id = p_ipc;
  perform app.require(c.id is not null and (money or app.is_exec_internal(c.exec_project_id)), 'Not your project');
  select id into prevc from public.exec_ipcs where exec_project_id = c.exec_project_id and status = 'certified' and id <> c.id and prepared_at <= c.prepared_at order by prepared_at desc, code desc limit 1;
  select mos_pct into pct from public.exec_boqs where exec_project_id = c.exec_project_id;
  return jsonb_strip_nulls(jsonb_build_object(
    'lines', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('boq_item_id', i.id, 'section', i.section, 'item_no', i.item_no, 'description', i.description,
        'unit', i.unit, 'boq_qty', i.qty, 'qty_to_date', l.qty_to_date,
        'prev_qty', (select p.qty_to_date from public.exec_ipc_lines p where p.ipc_id = prevc and p.boq_item_id = i.id),
        'rate', case when money then i.rate end, 'value', case when money then round(l.qty_to_date * coalesce(i.rate, 0), 2) end)) order by i.seq)
      from public.exec_ipc_lines l join public.exec_boq_items i on i.id = l.boq_item_id where l.ipc_id = p_ipc), '[]'),
    'mos', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('item', m.item, 'unit', m.unit, 'qty', m.qty, 'boq_item_id', m.boq_item_id,
        'boq_item', concat_ws(' ', i.item_no, i.description), 'rate', case when money then i.rate end,
        'value', case when money then round(m.qty * coalesce(i.rate, 0) * coalesce(pct, 0) / 100, 2) end)) order by m.item)
      from public.exec_ipc_mos m join public.exec_boq_items i on i.id = m.boq_item_id where m.ipc_id = p_ipc), '[]'),
    'mos_pct', pct,
    'values', case when money then (select to_jsonb(v) - 'ipc_id' from public.exec_ipc_values v where v.ipc_id = p_ipc) end));
end $$;

-- Variations priced from the BOQ (copied from 105_exec_variations.sql, route C with BOQ items)
create or replace function public.screen_variation(p_id uuid, p_decision text, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v public.variations; e public.exec_projects; pr public.projects; iid uuid; sc text[]; val numeric; res jsonb; bl jsonb := coalesce(p -> 'boq_lines', '[]'); bx jsonb; it public.exec_boq_items;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer screens variations');
  select * into v from public.variations where id = p_id for update;
  perform app.require(v.id is not null and v.status = 'raised', 'This variation is not waiting for screening');
  perform app.require(p_decision in ('reject', 'A', 'B', 'C'), 'Choose how to handle it');
  if p_decision = 'reject' then
    perform app.require(coalesce(btrim(p ->> 'note'), '') <> '', 'Give the reason');
    update public.variations set status = 'rejected', screened_by = auth.uid(), screened_at = now(), decision_note = btrim(p ->> 'note') where id = v.id;
    perform app.notify(v.raised_by, 'exec_variation', 'Variation not taken forward', app.variation_head(v) || ' · ' || btrim(p ->> 'note'), 'normal',
      'variation', v.id, '/execution/variation/' || v.id);
    return 'rejected';
  end if;
  if p_decision = 'C' then
    delete from public.exec_variation_boq where variation_id = v.id;
    if jsonb_array_length(bl) > 0 then
      -- priced from the contract BOQ: quantity × BOQ rate per item
      val := 0;
      for bx in select * from jsonb_array_elements(bl) loop
        select * into it from public.exec_boq_items where id = (bx ->> 'boq_item_id')::uuid and exec_project_id = v.exec_project_id and not heading and rate is not null;
        perform app.require(it.id is not null, 'Choose priced items of this project''s BOQ');
        perform app.require(coalesce((bx ->> 'qty')::numeric, 0) > 0, 'Enter the quantity of each BOQ item');
        insert into public.exec_variation_boq (variation_id, boq_item_id, qty, rate) values (v.id, it.id, (bx ->> 'qty')::numeric, it.rate);
        val := val + (bx ->> 'qty')::numeric * it.rate;
      end loop;
      val := round(val, 2);
    else
      begin val := round(nullif(p ->> 'value', '')::numeric, 2); exception when others then val := null; end;
    end if;
    perform app.require(val is not null and val <> 0, 'Enter the value from the contract rates');
    val := case when v.vtype = 'omission' then -abs(val) else abs(val) end;
    update public.variations set route = 'C', status = 'pending_smp', screened_by = auth.uid(), screened_at = now(), value_lkr = val,
      cost_lkr = nullif(p ->> 'cost', '')::numeric, time_days = nullif(p ->> 'time_days', '')::int,
      margin_pct = case when nullif(p ->> 'cost', '')::numeric is not null and val <> 0 then round((abs(val) - (p ->> 'cost')::numeric) / abs(val) * 100, 2) end,
      decision_note = nullif(btrim(p ->> 'note'), '')
    where id = v.id returning * into v;
    perform app.notify_many(app.role_users('sm_projects'), 'exec_variation', 'Variation to approve',
      format('%s · %s%s', app.variation_head(v), case when val > 0 then '+' else '−' end, app.fmt_money(abs(val), 'LKR')), 'normal', 'variation', v.id,
      '/execution/variation/' || v.id, null, true);
    return 'pending_smp';
  end if;
  -- A / B: a variation inquiry through Design and / or Estimation
  select * into e from public.exec_projects where id = v.exec_project_id;
  select * into pr from public.projects where id = e.project_id;
  perform app.require(nullif(p ->> 'required_by', '') is not null and (p ->> 'required_by')::date > (now() at time zone app.tz())::date, 'Set the date the price is needed by');
  select coalesce(array_agg(x), '{}') into sc from jsonb_array_elements_text(coalesce(p -> 'estimation_scope', '[]')) x;
  perform app.require(cardinality(sc) > 0, 'Select what Estimation must price');
  perform app.require(nullif(p ->> 'estimation_basis', '') is not null, 'Select the estimation basis');
  perform app.require(p_decision = 'B' or nullif(p ->> 'design_scope', '') is not null, 'Select the design scope');
  perform set_config('app.workflow', '1', true);
  insert into public.inquiries (project_id, organization_id, unit_id, route, duty_status, design_scope, priority, customer_deadline,
                                scope_description, estimation_scope, estimation_basis, variation_id, mixed_duty_approved)
  values (pr.id, pr.organization_id, pr.unit_id, p_decision,
          coalesce((select duty_status from public.inquiries where project_id = pr.id and duty_status is not null and status not in ('draft', 'cancelled', 'rejected')
                    order by created_at desc limit 1), pr.duty_status, 'duty_paid'), case when p_decision = 'A' then p ->> 'design_scope' end,
          coalesce(nullif(p ->> 'priority', ''), 'high'), (p ->> 'required_by')::date,
          format('VARIATION %s (%s) – %s%s%s', v.code, v.vtype, v.title, E'\n' || v.description, coalesce(E'\nQuantities: ' || v.quantities, '')),
          sc, p ->> 'estimation_basis', v.id, true)
  returning id into iid;
  update public.inquiries set code = coalesce(code, app.next_code('INQ')) where id = iid;
  update public.variations set route = p_decision, status = 'pricing', screened_by = auth.uid(), screened_at = now(), inquiry_id = iid,
    decision_note = nullif(btrim(p ->> 'note'), '') where id = v.id;
  res := public.submit_inquiry(iid);
  perform app.notify(v.raised_by, 'exec_variation', 'Variation sent for ' || case p_decision when 'A' then 'design and pricing' else 'pricing' end,
    app.variation_head(v), 'normal', 'variation', v.id, '/execution/variation/' || v.id);
  return coalesce(res ->> 'status', 'pricing');
end $$;

-- Client acceptance: the linked secured project (legacy projects too) and BOQ items (copied from 105_exec_variations.sql)
create or replace function public.record_variation_client(p_id uuid, p_accepted boolean, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v public.variations; s public.secured_projects; sv uuid; m date; msg text := 'recorded'; nxt int;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'The Senior Electrical Engineer records the client''s answer');
  select * into v from public.variations where id = p_id for update;
  perform app.require(v.id is not null and v.status = 'approved', 'Only an approved variation goes to the client');
  if not p_accepted then
    perform app.require(coalesce(btrim(p ->> 'note'), '') <> '', 'Give the client''s reason');
    update public.variations set status = 'client_rejected', client_at = coalesce(nullif(p ->> 'date', '')::date, current_date), client_note = btrim(p ->> 'note') where id = v.id;
    return 'client_rejected';
  end if;
  perform app.require(coalesce(btrim(p ->> 'vo_no'), '') <> '', 'Enter the variation order (VO) number');
  perform app.require(app.has_attachment('variation', v.id, 'var_doc'), 'Attach the signed variation order or the client''s letter');
  update public.variations set status = 'client_accepted', vo_no = btrim(p ->> 'vo_no'), client_at = coalesce(nullif(p ->> 'date', '')::date, current_date),
    client_note = nullif(btrim(p ->> 'note'), '') where id = v.id;
  -- Secured project (order book): applied as approved – SM Projects (and GM) already approved the variation
  select s2.* into s from public.secured_projects s2 join public.exec_projects e on e.secured_id = s2.id where e.id = v.exec_project_id;
  if s.id is not null and s.status = 'open' and s.schedule_status = 'approved' and coalesce(v.value_lkr, 0) <> 0 then
    begin m := app.month_of(coalesce(nullif(p ->> 'month', '')::date, current_date)); exception when others then m := app.month_of(current_date); end;
    insert into public.secured_variations (secured_id, vo_no, amount, month, reason, status, decided_by, decided_at, decision_note)
    values (s.id, btrim(p ->> 'vo_no'), v.value_lkr, m, 'Execution variation ' || v.code || ' – ' || v.title, 'approved', coalesce(v.gm_by, v.smp_by), now(),
            'Approved in the execution module')
    returning id into sv;
    perform app.apply_variation(sv);
    update public.variations set secured_variation_id = sv where id = v.id;
    msg := 'secured_updated';
  end if;
  -- Contract BOQ: the accepted variation becomes BOQ items, so it can be measured and claimed
  if exists (select 1 from public.exec_boqs where exec_project_id = v.exec_project_id and version > 0) and coalesce(v.value_lkr, 0) <> 0 then
    select coalesce(max(seq), 0) into nxt from public.exec_boq_items where exec_project_id = v.exec_project_id;
    if exists (select 1 from public.exec_variation_boq where variation_id = v.id) then
      insert into public.exec_boq_items (exec_project_id, seq, section, item_no, description, unit, qty, rate, amount, source, variation_id)
      select v.exec_project_id, nxt + row_number() over (order by i.seq), 'Variations', btrim(p ->> 'vo_no') || ' / ' || coalesce(i.item_no, ''),
             i.description, i.unit, case when v.vtype = 'omission' then -b.qty else b.qty end, b.rate,
             round(case when v.vtype = 'omission' then -b.qty else b.qty end * b.rate, 2), 'variation', v.id
      from public.exec_variation_boq b join public.exec_boq_items i on i.id = b.boq_item_id where b.variation_id = v.id;
    else
      insert into public.exec_boq_items (exec_project_id, seq, section, item_no, description, unit, qty, rate, amount, source, variation_id)
      values (v.exec_project_id, nxt + 1, 'Variations', btrim(p ->> 'vo_no'), v.title, 'sum', case when v.value_lkr < 0 then -1 else 1 end, abs(v.value_lkr), v.value_lkr,
              'variation', v.id);
    end if;
    perform app.boq_total(v.exec_project_id);
  end if;
  perform app.notify_many(app.role_users('sm_projects', 'operations_exec') || array[s.sales_person_id], 'exec_variation', 'Variation accepted by the client',
    concat_ws(' · ', app.variation_head(v), 'VO ' || btrim(p ->> 'vo_no'), case when msg = 'secured_updated' then 'order value and invoice schedule updated'
                                                                                 else 'update the secured project / invoice schedule' end),
    'normal', 'variation', v.id, '/execution/variation/' || v.id);
  return msg;
end $$;

-- Approvals: the contract BOQ (copied from 109_exec_programme.sql)
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
  union all
  select 'exec_gate', g.id, 'exec_gate', format('Stage gate %s – %s', g.gate, app.exec_head(g.exec_project_id)), g.note, g.requested_by,
         app.display_name(g.requested_by), g.requested_at, null::uuid, '/execution/' || g.exec_project_id, null
  from public.exec_gates g where g.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'sub_cert', c.id, 'exec_sub_cert', format('Subcontractor payment %s – %s', c.code, c.subcontractor), app.exec_head(c.exec_project_id) || ' · ' || app.fmt_money(c.net, 'LKR'),
         c.prepared_by, app.display_name(c.prepared_by), c.prepared_at, null::uuid, '/execution/' || c.exec_project_id || '?tab=cost',
         case c.status when 'prepared' then 'Verify' when 'verified' then 'Approve' else 'Pay' end
  from public.sub_certs c
  where (c.status = 'prepared' and app.has_role('senior_elec_engineer')) or (c.status = 'verified' and app.has_role('sm_projects'))
     or (c.status = 'approved' and app.has_role('operations_exec'))
  union all
  select 'test_record', t.id, 'exec_test', format('Test record %s – %s', t.code, t.system), app.exec_head(t.exec_project_id) || ' · ' || t.result, t.performed_by,
         app.display_name(t.performed_by), t.performed_at, null::uuid, '/execution/' || t.exec_project_id || '?tab=qa', 'Verify'
  from public.test_records t where t.status = 'submitted' and app.has_role('senior_elec_engineer')
  union all
  select 'exec_request', r.id, 'exec_request', format('%s – %s', case r.kind when 'won' then 'Hand over to execution' else 'Project won before the system' end, r.name),
         concat_ws(' · ', r.client_name, r.note), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid, '/execution/handover/' || r.id, 'SM Projects'
  from public.exec_requests r where r.status = 'pending_smp' and app.has_role('sm_projects')
  union all
  select 'exec_programme', pg.exec_project_id, 'exec_programme', case when pg.version = 0 then 'Programme – ' else 'Revised programme – ' end || app.exec_head(pg.exec_project_id),
         concat_ws(' · ', 'finish ' || to_char(pg.forecast_finish, 'DD Mon YYYY'), pg.submit_note), pg.submitted_by, app.display_name(pg.submitted_by), pg.submitted_at, null::uuid,
         '/execution/' || pg.exec_project_id || '?tab=programme', 'SM Projects'
  from public.exec_programmes pg where pg.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'exec_boq', b.exec_project_id, 'exec_billing', case when b.version = 0 then 'Contract BOQ – ' else 'Revised contract BOQ – ' end || app.exec_head(b.exec_project_id),
         concat_ws(' · ', app.fmt_money(b.total, 'LKR'), b.submit_note), b.uploaded_by, app.display_name(b.uploaded_by), b.uploaded_at, null::uuid,
         '/execution/boq/' || b.exec_project_id, 'SM Projects'
  from public.exec_boqs b where b.status = 'submitted' and app.has_role('sm_projects')
$$;

-- Certifying a claim refreshes its valuation (the previous certified amounts may have changed)
create or replace function app.ipc_after_certify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'certified' and old.status is distinct from 'certified' then perform app.value_ipc(new.id); end if;
  return new;
end $$;
create trigger exec_ipcs_value after update of status on public.exec_ipcs for each row execute function app.ipc_after_certify();

revoke execute on function public.save_boq(uuid, jsonb, text, text[], numeric, text), public.set_boq_mos(uuid, numeric, text), public.decide_boq(uuid, boolean, text),
  public.claim_context(uuid), public.prepare_ipc(uuid, date, numeric, text, jsonb, jsonb), public.ipc_detail(uuid) from public, anon;
grant execute on function public.save_boq(uuid, jsonb, text, text[], numeric, text), public.set_boq_mos(uuid, numeric, text), public.decide_boq(uuid, boolean, text),
  public.claim_context(uuid), public.prepare_ipc(uuid, date, numeric, text, jsonb, jsonb), public.ipc_detail(uuid) to authenticated;
