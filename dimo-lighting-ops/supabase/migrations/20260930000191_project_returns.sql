-- Project returns: balance material left over from projects, kept as a second stock beside the SAP stock.
--  * Operations (or the SEE / SM Projects) adds items one by one or by an Excel upload; each item has its own balance, condition,
--    location and source project, and a history of movements (in, out to a project, adjustments).
--  * Before a project is handed over (DLP), every item still in the site store under DIMO's custody must be returned – either to
--    SAP (with the SAP return reference) or to the Project returns stock. Until then the handover cannot be requested, and SM
--    Projects cannot approve it with an override.
--  * When material is requested, matching items in the SAP stock and the Project returns are shown. Choosing a Project-returns
--    item reserves it; it is booked out of the returns stock when it is received on site.

create table public.project_return_items (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  item text not null,
  mpn text,
  unit text not null,
  category text,
  condition text not null default 'good' check (condition in ('new', 'good', 'used', 'damaged')),
  location text,
  source_exec_project_id uuid references public.exec_projects (id) on delete set null,
  source_text text,
  note text,
  origin text not null default 'manual' check (origin in ('manual', 'upload', 'dlp')),
  removed boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create table public.project_return_moves (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.project_return_items (id) on delete cascade,
  kind text not null check (kind in ('in', 'out', 'adjust')),
  qty numeric not null,                                  -- in > 0, out < 0, adjust ±
  exec_project_id uuid references public.exec_projects (id) on delete set null,
  mr_line_id uuid references public.material_request_lines (id) on delete set null,
  note text,
  by_id uuid default auth.uid() references public.profiles (id),
  at timestamptz not null default now()
);
create index on public.project_return_moves (item_id);

alter table public.material_request_lines add column if not exists return_item_id uuid references public.project_return_items (id);
alter table public.material_request_lines add column if not exists sap_material text;

alter table public.project_return_items enable row level security;
alter table public.project_return_moves enable row level security;
create policy project_return_items_read on public.project_return_items for select to authenticated using (app.my_role() is not null and not app.is_external());
create policy project_return_moves_read on public.project_return_moves for select to authenticated using (app.my_role() is not null and not app.is_external());
grant select on public.project_return_items, public.project_return_moves to authenticated;

create or replace function app.return_balance(p_item uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0) from public.project_return_moves where item_id = p_item
$$;
-- Reserved by open material requests (not yet received)
create or replace function app.return_reserved(p_item uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.qty - l.received_qty), 0) from public.material_request_lines l join public.material_requests m on m.id = l.mr_id
   where l.return_item_id = p_item and l.received_qty < l.qty and m.status not in ('rejected', 'cancelled', 'received')
$$;
create or replace function app.return_available(p_item uuid) returns numeric language sql stable as $$
  select app.return_balance(p_item) - app.return_reserved(p_item)
$$;
create or replace function app.can_manage_returns() returns boolean language sql stable as $$
  select app.has_role('operations_exec', 'senior_elec_engineer', 'sm_projects')
$$;

-- Add items (one or many – the Excel upload sends many).
-- p_rows: [{item, mpn, unit, qty, category, condition, location, source_exec_project_id | source_text, note}]
create or replace function public.add_project_returns(p_rows jsonb, p_origin text default 'manual') returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; iid uuid; n int := 0; q numeric; k int := 0;
begin
  perform app.require(app.can_manage_returns(), 'Operations, the SEE or SM Projects add project returns');
  perform app.require(coalesce(p_origin, 'manual') in ('manual', 'upload'), 'Unknown source');
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    k := k + 1;
    continue when coalesce(btrim(r ->> 'item'), '') = '' and nullif(r ->> 'qty', '') is null;
    q := nullif(replace(r ->> 'qty', ',', ''), '')::numeric;
    perform app.require(coalesce(btrim(r ->> 'item'), '') <> '', format('Line %s: describe the item', k));
    perform app.require(q is not null and q > 0, format('Line %s (%s): enter the quantity', k, btrim(r ->> 'item')));
    perform app.require(coalesce(btrim(r ->> 'unit'), '') <> '', format('Line %s (%s): enter the unit', k, btrim(r ->> 'item')));
    perform app.require(coalesce(nullif(lower(btrim(r ->> 'condition')), ''), 'good') in ('new', 'good', 'used', 'damaged'), format('Line %s: condition is new, good, used or damaged', k));
    insert into public.project_return_items (code, item, mpn, unit, category, condition, location, source_exec_project_id, source_text, note, origin)
    values (app.next_code('PRT'), btrim(r ->> 'item'), nullif(btrim(r ->> 'mpn'), ''), btrim(r ->> 'unit'), nullif(btrim(r ->> 'category'), ''),
            coalesce(nullif(lower(btrim(r ->> 'condition')), ''), 'good'), nullif(btrim(r ->> 'location'), ''),
            nullif(r ->> 'source_exec_project_id', '')::uuid, nullif(btrim(r ->> 'source_text'), ''), nullif(btrim(r ->> 'note'), ''), coalesce(p_origin, 'manual'))
    returning id into iid;
    insert into public.project_return_moves (item_id, kind, qty, exec_project_id, note) values (iid, 'in', q, nullif(r ->> 'source_exec_project_id', '')::uuid,
      case when p_origin = 'upload' then 'Excel upload' else 'Added' end);
    n := n + 1;
  end loop;
  perform app.require(n > 0, 'No items to add');
  return n;
end $$;

create or replace function public.update_project_return(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.can_manage_returns(), 'Operations, the SEE or SM Projects manage project returns');
  perform app.require(coalesce(nullif(lower(btrim(p ->> 'condition')), ''), 'good') in ('new', 'good', 'used', 'damaged'), 'Condition is new, good, used or damaged');
  update public.project_return_items set item = coalesce(nullif(btrim(p ->> 'item'), ''), item), mpn = nullif(btrim(p ->> 'mpn'), ''),
    category = nullif(btrim(p ->> 'category'), ''), condition = coalesce(nullif(lower(btrim(p ->> 'condition')), ''), condition), location = nullif(btrim(p ->> 'location'), ''),
    note = nullif(btrim(p ->> 'note'), '')
  where id = p_id and not removed;
  perform app.require(found, 'Item not found');
end $$;

-- Correct the balance (counted, damaged, written off …) – always with a reason
create or replace function public.adjust_project_return(p_id uuid, p_change numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive adjusts the returns stock');
  perform app.require(coalesce(p_change, 0) <> 0, 'Enter the change (+ or −)');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(exists (select 1 from public.project_return_items where id = p_id and not removed), 'Item not found');
  perform app.require(app.return_balance(p_id) + p_change >= app.return_reserved(p_id), 'The balance cannot go below what is reserved by open material requests');
  insert into public.project_return_moves (item_id, kind, qty, note) values (p_id, 'adjust', p_change, btrim(p_reason));
end $$;

-- The returns stock with balances
create or replace function public.project_returns() returns table (id uuid, code text, item text, mpn text, unit text, category text, condition text,
  location text, source text, source_exec_project_id uuid, note text, origin text, created_at timestamptz, received numeric, balance numeric, reserved numeric, available numeric,
  last_move timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.code, i.item, i.mpn, i.unit, i.category, i.condition, i.location,
         coalesce(e.code || ' ' || e.name, i.source_text), i.source_exec_project_id, i.note, i.origin, i.created_at,
         coalesce((select sum(qty) from public.project_return_moves m where m.item_id = i.id and m.kind = 'in'), 0),
         app.return_balance(i.id), app.return_reserved(i.id), app.return_available(i.id),
         (select max(at) from public.project_return_moves m where m.item_id = i.id)
    from public.project_return_items i left join public.exec_projects e on e.id = i.source_exec_project_id
   where not i.removed and app.my_role() is not null and not app.is_external()
   order by i.created_at desc
$$;

-- Leftover material of a project: what is still in the site store under DIMO's custody
create or replace function public.project_leftovers(p_exec uuid) returns table (item text, unit text, balance numeric)
language sql stable security definer set search_path = public as $$
  select min(s.item), min(s.unit), sum(case when s.kind in ('receipt', 'return', 'transfer_in') then s.qty else -s.qty end)
    from public.store_moves s where s.exec_project_id = p_exec and s.custody = 'dimo'
   group by lower(btrim(s.item))
  having sum(case when s.kind in ('receipt', 'return', 'transfer_in') then s.qty else -s.qty end) > 0
   order by 1
$$;

-- Return leftover material: to SAP (with the SAP return reference) or into the Project returns stock.
-- p_lines: [{item, qty, dest: 'sap' | 'returns', sap_ref, condition, location, mpn, note}]
create or replace function public.return_leftovers(p_exec uuid, p_lines jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare l jsonb; lo record; q numeric; n int := 0; iid uuid; to_returns int := 0; to_sap int := 0;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec), 'The SEE or the project''s Assistant Engineers return leftover material');
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    q := nullif(l ->> 'qty', '')::numeric;
    continue when coalesce(q, 0) <= 0;
    select * into lo from public.project_leftovers(p_exec) x where lower(btrim(x.item)) = lower(btrim(l ->> 'item'));
    perform app.require(lo.item is not null, format('%s is not in the site store', l ->> 'item'));
    perform app.require(q <= lo.balance, format('Only %s %s of %s is in the site store', lo.balance, lo.unit, lo.item));
    perform app.require(l ->> 'dest' in ('sap', 'returns'), format('%s: return it to SAP or to Project returns', lo.item));
    if l ->> 'dest' = 'sap' then
      perform app.require(coalesce(btrim(l ->> 'sap_ref'), '') <> '', format('%s: enter the SAP return reference', lo.item));
      insert into public.store_moves (exec_project_id, kind, item, unit, qty, ref, note, custody)
      values (p_exec, 'transfer_out', lo.item, lo.unit, q, 'SAP return ' || btrim(l ->> 'sap_ref'), coalesce(nullif(btrim(l ->> 'note'), ''), 'Returned to SAP'), 'dimo');
      to_sap := to_sap + 1;
    else
      perform app.require(coalesce(nullif(lower(btrim(l ->> 'condition')), ''), 'good') in ('new', 'good', 'used', 'damaged'), format('%s: condition is new, good, used or damaged', lo.item));
      insert into public.project_return_items (code, item, mpn, unit, condition, location, source_exec_project_id, note, origin)
      values (app.next_code('PRT'), lo.item, nullif(btrim(l ->> 'mpn'), ''), lo.unit, coalesce(nullif(lower(btrim(l ->> 'condition')), ''), 'good'),
              nullif(btrim(l ->> 'location'), ''), p_exec, nullif(btrim(l ->> 'note'), ''), 'dlp')
      returning id into iid;
      insert into public.project_return_moves (item_id, kind, qty, exec_project_id, note) values (iid, 'in', q, p_exec, 'Leftover from the project');
      insert into public.store_moves (exec_project_id, kind, item, unit, qty, ref, note, custody)
      values (p_exec, 'transfer_out', lo.item, lo.unit, q, 'Project returns ' || (select code from public.project_return_items where id = iid), 'Moved to Project returns', 'dimo');
      to_returns := to_returns + 1;
    end if;
    n := n + 1;
  end loop;
  perform app.require(n > 0, 'Enter the quantities to return');
  perform app.notify_many(app.role_users('operations_exec'), 'exec_material', 'Leftover material returned',
    format('%s · %s item(s) to Project returns, %s to SAP · by %s', app.exec_head(p_exec), to_returns, to_sap, app.display_name(auth.uid())),
    'normal', 'exec_project', p_exec, '/stock?tab=returns');
  return n;
end $$;

-- Items received on site that came from the Project returns stock are booked out of it
create or replace function app.book_return_out() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.return_item_id is not null and new.received_qty > coalesce(old.received_qty, 0) then
    insert into public.project_return_moves (item_id, kind, qty, exec_project_id, mr_line_id, note)
    values (new.return_item_id, 'out', -(new.received_qty - coalesce(old.received_qty, 0)),
            (select exec_project_id from public.material_requests where id = new.mr_id), new.id,
            'Issued to ' || (select concat_ws(' · ', m.code, app.exec_head(m.exec_project_id)) from public.material_requests m where m.id = new.mr_id));
  end if;
  return new;
end $$;
create trigger material_request_lines_return_out after update of received_qty on public.material_request_lines
  for each row execute function app.book_return_out();

-- Similar items in the SAP stock (latest report, quantity on hand) and the Project returns (available), for choosing materials
create or replace function public.stock_matches(p_text text, p_mpn text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare words text[]; res jsonb;
begin
  if app.my_role() is null or app.is_external() then return '[]'; end if;
  select coalesce(array_agg(distinct w), '{}') into words
    from regexp_split_to_table(lower(coalesce(p_text, '')), '[^a-z0-9.]+') w
   where length(w) >= 3 and w not in ('the', 'and', 'with', 'for', 'led', 'nos', 'set', 'type');
  if cardinality(words) = 0 and coalesce(btrim(p_mpn), '') = '' then return '[]'; end if;
  with sap as (
    select distinct on (i.material) 'sap' as source, i.material as ref, i.description as item, i.mpn, i.uom as unit, i.qty as available,
           s.as_at, null::text as location, null::text as condition,
           (select count(*) from unnest(words) w where lower(coalesce(i.description, '')) like '%' || w || '%') +
           case when coalesce(btrim(p_mpn), '') <> '' and lower(coalesce(i.mpn, '')) = lower(btrim(p_mpn)) then 10 else 0 end as score,
           case when i.q6 > 0 then 'Over 720 days' when i.q5 > 0 then '541–720 days' when i.q4 > 0 then '361–540 days' else null end as age
      from public.stock_items i join public.stock_snapshots s on s.id = i.snapshot_id
     where s.status = 'confirmed' and i.qty > 0
       and s.as_at = (select max(as_at) from public.stock_snapshots x where x.status = 'confirmed' and x.profit_center = s.profit_center)
     order by i.material
  ), ret as (
    select 'returns' as source, r.id::text as ref, r.item, r.mpn, r.unit, app.return_available(r.id) as available, null::date as as_at, r.location, r.condition,
           (select count(*) from unnest(words) w where lower(r.item) like '%' || w || '%') +
           case when coalesce(btrim(p_mpn), '') <> '' and lower(coalesce(r.mpn, '')) = lower(btrim(p_mpn)) then 10 else 0 end as score,
           null::text as age
      from public.project_return_items r where not r.removed
  ), allm as (
    select * from sap where score > 0 union all select * from ret where score > 0 and available > 0
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc, x.available desc), '[]') into res
    from (select * from allm where score >= greatest(1, least(2, cardinality(words))) order by score desc, available desc limit 12) x;
  return res;
end $$;

revoke execute on function public.add_project_returns(jsonb, text), public.update_project_return(uuid, jsonb), public.adjust_project_return(uuid, numeric, text),
  public.project_returns(), public.project_leftovers(uuid), public.return_leftovers(uuid, jsonb), public.stock_matches(text, text) from public, anon;
grant execute on function public.add_project_returns(jsonb, text), public.update_project_return(uuid, jsonb), public.adjust_project_return(uuid, numeric, text),
  public.project_returns(), public.project_leftovers(uuid), public.return_leftovers(uuid, jsonb), public.stock_matches(text, text) to authenticated;

-- Handover (DLP) checks: leftover material (copied from 20260930000183 with the new check)
create or replace function app.gate_checks(p_exec uuid, p_gate int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb := '[]'; n int;
begin
  if p_gate = 1 then
    select count(*) into n from public.exec_members where exec_project_id = p_exec and active and member_role <> 'sub_supervisor';
    c := c || jsonb_build_array(jsonb_build_object('check', 'Engineer(s) on the project', 'ok', n > 0, 'detail', n || ' on the team'));
    select count(*) into n from public.exec_programmes where exec_project_id = p_exec and version > 0;
    c := c || jsonb_build_array(jsonb_build_object('check', 'Programme approved by SM Projects', 'ok', n > 0, 'detail', case when n > 0 then 'approved' else 'not approved' end));
  elsif p_gate = 2 then
    select count(*) into n from public.ncrs where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open NCR', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.test_records where exec_project_id = p_exec and status <> 'verified';
    c := c || jsonb_build_array(jsonb_build_object('check', 'All test records verified', 'ok', n = 0, 'detail', n || ' not verified'));
    select count(*) into n from public.snags where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'All snags closed', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.exec_dossier where exec_project_id = p_exec and mandatory and not done and not removed;
    c := c || jsonb_build_array(jsonb_build_object('check', 'Mandatory dossier items present', 'ok', n = 0 and exists (select 1 from public.exec_dossier where exec_project_id = p_exec and not removed), 'detail', n || ' missing'));
    -- Leftover DIMO material must go back to SAP or to the Project returns stock before the DLP (cannot be overridden)
    select count(*) into n from public.project_leftovers(p_exec);
    c := c || jsonb_build_array(jsonb_build_object('check', 'Leftover material returned to SAP or Project returns', 'ok', n = 0, 'detail', n || ' item(s) still in the site store', 'hard', true));
  elsif p_gate = 3 then
    select count(*) into n from public.material_requests where exec_project_id = p_exec and status in ('submitted', 'pending_smp', 'approved', 'ordered', 'part_received');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open material requests / orders', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.hse_reports where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open HSE reports', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.variations where exec_project_id = p_exec and status in ('raised', 'pricing', 'pending_smp', 'pending_gm', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No variation still open', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.sub_certs where exec_project_id = p_exec and status in ('jm_requested', 'jm_scheduled', 'jm_ae', 'jm_see', 'jm_returned', 'draft', 'ae_review', 'returned', 'prepared', 'verified', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'Subcontractors finally certified and paid', 'ok', n = 0, 'detail', n || ' open'));
  end if;
  return c;
end $$;


-- Handover cannot be requested, nor approved with an override, while leftover material is in the site store (copied from 20260930000135)
create or replace function public.request_gate(p_exec uuid, p_checklist jsonb, p_note text, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; gid uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer requests the handover / closure');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(e.id is not null and e.status = 'active', 'Project not active');
  perform app.require(e.stage > 1, 'Work starts by itself when SM Projects approves the programme');
  perform app.require(not exists (select 1 from public.exec_gates where exec_project_id = p_exec and status = 'pending'), 'Already waiting for SM Projects');
  perform app.require(e.stage <> 2 or (p_date is not null and p_date <= (now() at time zone app.tz())::date), 'Enter the date the project was handed over to the client');
  perform app.require(e.stage <> 2 or not exists (select 1 from public.project_leftovers(p_exec)),
    'Return the leftover material in the site store to SAP or to the Project returns stock first (Handover tab → Leftover material)');
  insert into public.exec_gates (exec_project_id, gate, checklist, checks, note, event_date) values (p_exec, e.stage, coalesce(p_checklist, '{}'), app.gate_checks(p_exec, e.stage), nullif(btrim(p_note), ''), p_date)
  returning id into gid;
  perform app.notify_many(app.role_users('sm_projects'), 'exec_gate',
    format('%s to approve – %s', (array['Programme approved', 'Handover to the client', 'Project closure'])[e.stage], e.name), coalesce(btrim(p_note), ''), 'normal',
    'exec_project', p_exec, '/execution/' || p_exec, null, true);
  return gid;
end $$;
create or replace function public.decide_gate(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare g public.exec_gates; fresh jsonb; open_items boolean; lbl text;
begin
  perform app.require(app.has_role('sm_projects'), 'SM Projects approves the handover and the closure');
  select * into g from public.exec_gates where id = p_id for update;
  perform app.require(g.id is not null and g.status = 'pending', 'Not waiting');
  lbl := (array['Programme approved', 'Handover to the client', 'Project closure'])[g.gate];
  fresh := app.gate_checks(g.exec_project_id, g.gate);
  select exists (select 1 from jsonb_array_elements(fresh) x where not (x ->> 'ok')::boolean) into open_items;
  perform app.require(not p_approve or not exists (select 1 from jsonb_array_elements(fresh) x where coalesce((x ->> 'hard')::boolean, false) and not (x ->> 'ok')::boolean),
    'Leftover material is still in the site store – it must be returned to SAP or Project returns before the DLP (no override)');
  perform app.require(not p_approve or not open_items or coalesce(btrim(p_note), '') <> '', 'Items are open – give the reason to approve anyway (override)');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.exec_gates set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    checks = fresh, override = p_approve and open_items, note = concat_ws(' · ', note, nullif(btrim(p_note), '')) where id = g.id;
  if p_approve then
    update public.exec_projects set stage = least(3, g.gate + 1), status = case when g.gate = 3 then 'closed' else status end, updated_at = now() where id = g.exec_project_id;
  end if;
  perform app.notify_many(app.role_users('senior_elec_engineer') || app.project_aes(g.exec_project_id), 'exec_gate',
    format('%s %s%s', lbl, case when p_approve then 'approved' else 'not approved' end, case when p_approve and open_items then ' (override)' else '' end),
    concat_ws(' · ', app.exec_head(g.exec_project_id), nullif(btrim(p_note), '')), 'normal', 'exec_project', g.exec_project_id, '/execution/' || g.exec_project_id);
end $$;


-- Material requests may take an item from the Project returns stock (reserved) or name an SAP stock item (copied from 20260930000184)
create or replace function public.raise_material_request(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; l jsonb; n int := 0; ri public.project_return_items; rid uuid; avail numeric; sapm text; sub boolean := app.has_role('sub_supervisor'); c public.material_catalog; cid int; nm text;
        act uuid := nullif(p ->> 'activity_id', '')::uuid; est numeric := 0; rate numeric;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec) or (sub and app.is_exec_member(p_exec)),
    'The project''s Assistant Engineers, its subcontractor supervisors or the Senior Electrical Engineer request materials');
  perform app.require(nullif(p ->> 'required_date', '') is not null, 'Set the date the material is needed on site');
  perform app.require(act is null or exists (select 1 from public.exec_activities where id = act and exec_project_id = p_exec), 'Choose an activity of this project');
  insert into public.material_requests (code, exec_project_id, required_date, purpose, est_value_lkr, status, priority, activity_id, deliver_to, site_contact)
  values (app.next_code('MR'), p_exec, (p ->> 'required_date')::date, nullif(btrim(p ->> 'purpose'), ''),
          null::numeric, case when sub then 'ae_review' else 'submitted' end,
          case when p ->> 'priority' = 'urgent' then 'urgent' else 'normal' end, act, nullif(btrim(p ->> 'deliver_to'), ''), nullif(btrim(p ->> 'site_contact'), ''))
  returning * into m;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    cid := nullif(l ->> 'catalog_id', '')::int;
    rid := nullif(l ->> 'return_item_id', '')::uuid;
    sapm := nullif(btrim(l ->> 'sap_material'), '');
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
    perform app.require(nullif(l ->> 'qty', '')::numeric > 0 and coalesce(btrim(coalesce(nullif(l ->> 'unit', ''), ri.unit, c.unit)), '') <> '', 'Each item needs a quantity and unit');
    rate := null;
    insert into public.material_request_lines (mr_id, item, unit, qty, catalog_id, category, spec, brand, custom, est_rate, note, return_item_id, sap_material)
    values (m.id, nm, coalesce(nullif(btrim(l ->> 'unit'), ''), ri.unit, c.unit), (l ->> 'qty')::numeric, c.id, coalesce(c.category, ri.category, nullif(btrim(l ->> 'category'), '')),
            nullif(btrim(l ->> 'spec'), ''), nullif(btrim(l ->> 'brand'), ''), c.id is null and ri.id is null, rate, nullif(btrim(l ->> 'note'), ''), ri.id, sapm);
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

