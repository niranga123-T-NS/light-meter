-- Project securities and the advance payment, when an execution project is awarded.
--  * The SEE checks what applies and submits it: the Performance Bond (% of the contract value and the value) and the Advance Payment
--    (% and amount), which needs an Advance Payment Bond. SM Projects, the GM / DGM and Operations are told.
--  * The SEE enters the project's bonds by choosing the project and the bond (Performance / Advance Payment): they are ordinary bonds,
--    linked to the project, and show in the Bonds tab with all the usual expiry alerts.
--  * Advance Payment Bond first, then the advance payment invoice. The SEE coordinates with the client and records each receipt (part
--    payments allowed) until it is fully received → "Received".
--  * The advance is kept apart from invoicing: it is not in the invoice schedules, the invoiced figures or the budget list – it shows
--    only on the project overview.
--  * Not fully received 14 days after the advance invoice → SM Projects and the GM / DGM are alerted every morning. They can block the
--    project (no new material requests, approvals or orders, no programme approval, no new subcontractor certificates) or extend the
--    date. Full receipt lifts a block by itself.

create table public.exec_securities (
  exec_project_id uuid primary key references public.exec_projects (id) on delete cascade,
  pb_applicable boolean not null default true,
  pb_pct numeric check (pb_pct is null or (pb_pct > 0 and pb_pct <= 100)),
  pb_value numeric check (pb_value is null or pb_value > 0),
  ap_applicable boolean not null default true,
  ap_pct numeric check (ap_pct is null or (ap_pct > 0 and ap_pct <= 100)),
  ap_value numeric check (ap_value is null or ap_value > 0),
  note text,
  submitted_by uuid references public.profiles (id),
  submitted_at timestamptz,
  adv_invoice_no text,
  adv_invoice_date date,
  adv_invoice_amount numeric,
  adv_due_date date,
  adv_received_at timestamptz,
  blocked boolean not null default false,
  blocked_by uuid references public.profiles (id),
  blocked_at timestamptz,
  block_reason text,
  extensions int not null default 0,
  last_extension_reason text,
  updated_at timestamptz not null default now()
);
create table public.exec_advance_receipts (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  amount numeric not null check (amount > 0),
  received_on date not null,
  ref text,
  note text,
  by_id uuid not null default auth.uid() references public.profiles (id),
  at timestamptz not null default now()
);
create index on public.exec_advance_receipts (exec_project_id);

-- Bonds can belong to an execution project
alter table public.bonds add column if not exists exec_project_id uuid references public.exec_projects (id) on delete set null;
create index if not exists bonds_exec_project_idx on public.bonds (exec_project_id);

-- Who sees the securities and the advance: the SEE, SM Projects, GM / DGM and Operations (not engineers or supervisors)
create or replace function app.sees_securities() returns boolean
language sql stable security definer set search_path = public as $$ select app.has_role('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec') $$;

alter table public.exec_securities enable row level security;
alter table public.exec_advance_receipts enable row level security;
create policy exec_securities_read on public.exec_securities for select to authenticated using (app.sees_securities());
create policy exec_advance_receipts_read on public.exec_advance_receipts for select to authenticated using (app.sees_securities());
grant select on public.exec_securities, public.exec_advance_receipts to authenticated;

-- The SEE also sees the bonds of execution projects in the Bonds tab
drop policy if exists bonds_read on public.bonds;
create policy bonds_read on public.bonds for select to authenticated
  using (app.has_role('gm', 'sm_projects', 'operations_exec') or owner_id = auth.uid()
         or (app.is_sales_person() and category = any (app.my_project_types()))
         or (exec_project_id is not null and app.has_role('senior_elec_engineer')));

create or replace function app.advance_received(p_exec uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.exec_advance_receipts where exec_project_id = p_exec
$$;
create or replace function app.exec_blocked(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select blocked from public.exec_securities where exec_project_id = p_exec), false)
$$;
create or replace function app.exec_people_money(p_exec uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select array(select unnest(app.role_users('sm_projects', 'gm', 'operations_exec'))
               union select see_id from public.exec_projects where id = p_exec and see_id is not null)
$$;

-- Overview data: the terms, the bonds, the advance and its receipts
create or replace function public.exec_securities_view(p_exec uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.exec_securities; e public.exec_projects; rec numeric;
begin
  perform app.require(app.sees_securities(), 'Not allowed');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(found, 'Project not found');
  select * into s from public.exec_securities where exec_project_id = p_exec;
  rec := app.advance_received(p_exec);
  return jsonb_build_object(
    'contract_value', e.contract_value_lkr,
    'terms', to_jsonb(s),
    'received', rec,
    'status', case when s.exec_project_id is null or s.submitted_at is null then 'to_submit'
                   when not s.ap_applicable then 'not_applicable'
                   when s.adv_invoice_date is null then case when exists (select 1 from public.bonds b where b.exec_project_id = p_exec and b.bond_type = 'advance_payment' and b.status = 'active') then 'to_invoice' else 'bond_pending' end
                   when rec >= s.adv_invoice_amount then 'received'
                   when rec > 0 then 'part_received' else 'awaiting' end,
    'overdue_days', case when s.adv_due_date is not null and rec < coalesce(s.adv_invoice_amount, 0) then greatest(0, (now() at time zone app.tz())::date - s.adv_due_date) end,
    'bonds', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'code', b.code, 'bond_type', b.bond_type, 'bond_no', b.bond_no, 'bank', b.bank,
                         'bond_value', b.bond_value, 'currency', b.currency, 'issue_date', b.issue_date, 'expiry_date', b.expiry_date, 'status', b.status) order by b.bond_type, b.issue_date)
                         from public.bonds b where b.exec_project_id = p_exec), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(to_jsonb(r) order by r.received_on, r.at) from public.exec_advance_receipts r where r.exec_project_id = p_exec), '[]'::jsonb)
  );
end $$;

-- The SEE checks what applies and submits the rates and values (and can correct them until the advance is invoiced)
create or replace function public.submit_securities(p_exec uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; s public.exec_securities; pb boolean := coalesce((p ->> 'pb_applicable')::boolean, true); ap boolean := coalesce((p ->> 'ap_applicable')::boolean, true);
        pbv numeric := nullif(p ->> 'pb_value', '')::numeric; apv numeric := nullif(p ->> 'ap_value', '')::numeric;
        pbp numeric := nullif(p ->> 'pb_pct', '')::numeric; app_ numeric := nullif(p ->> 'ap_pct', '')::numeric;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer submits the bonds and the advance');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(found and e.status = 'active', 'Project not active');
  select * into s from public.exec_securities where exec_project_id = p_exec;
  perform app.require(s.adv_invoice_date is null, 'The advance is already invoiced – the terms cannot change');
  if pb then
    pbv := coalesce(pbv, round(e.contract_value_lkr * pbp / 100, 2));
    perform app.require(pbv is not null and pbv > 0, 'Performance bond: enter the % of the contract value or the value');
  end if;
  if ap then
    apv := coalesce(apv, round(e.contract_value_lkr * app_ / 100, 2));
    perform app.require(apv is not null and apv > 0, 'Advance payment: enter the % of the contract value or the amount');
  end if;
  perform app.require(pb or ap or coalesce(btrim(p ->> 'note'), '') <> '', 'Neither applies – give the reason in the note');
  insert into public.exec_securities (exec_project_id, pb_applicable, pb_pct, pb_value, ap_applicable, ap_pct, ap_value, note, submitted_by, submitted_at)
  values (p_exec, pb, case when pb then pbp end, case when pb then pbv end, ap, case when ap then app_ end, case when ap then apv end, nullif(btrim(p ->> 'note'), ''), auth.uid(), now())
  on conflict (exec_project_id) do update set pb_applicable = excluded.pb_applicable, pb_pct = excluded.pb_pct, pb_value = excluded.pb_value,
    ap_applicable = excluded.ap_applicable, ap_pct = excluded.ap_pct, ap_value = excluded.ap_value, note = excluded.note,
    submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at, updated_at = now();
  perform app.notify_many(array(select x from unnest(app.exec_people_money(p_exec)) x where x <> auth.uid()), 'exec_securities', 'Bonds and advance submitted',
    concat_ws(' · ', app.exec_head(p_exec), case when pb then 'Performance bond ' || app.fmt_money(pbv, 'LKR') else 'no performance bond' end,
              case when ap then 'Advance ' || app.fmt_money(apv, 'LKR') else 'no advance' end),
    'normal', 'exec_project', p_exec, '/execution/' || p_exec);
end $$;

-- The SEE enters a project bond: choose the project and the bond (performance / advance payment); it is a normal bond in the Bonds tab
create or replace function public.save_project_bond(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; pr public.projects; s public.exec_securities; t text := p ->> 'bond_type'; cat public.project_type; own uuid; b public.bonds;
        iss date := nullif(p ->> 'issue_date', '')::date; exp date := nullif(p ->> 'expiry_date', '')::date; val numeric := nullif(p ->> 'bond_value', '')::numeric;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer enters the project bonds');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(found, 'Project not found');
  select * into s from public.exec_securities where exec_project_id = p_exec;
  perform app.require(s.submitted_at is not null, 'Submit the bonds and advance terms first');
  perform app.require(t in ('performance', 'advance_payment'), 'Choose the bond: performance or advance payment');
  perform app.require(t <> 'performance' or s.pb_applicable, 'The performance bond was submitted as not applicable');
  perform app.require(t <> 'advance_payment' or s.ap_applicable, 'The advance was submitted as not applicable');
  perform app.require(not exists (select 1 from public.bonds where exec_project_id = p_exec and bond_type = t and status = 'active'),
    'This bond is already recorded for the project – extend or close it in the Bonds tab');
  perform app.require(coalesce(btrim(p ->> 'bond_no'), '') <> '', 'Bond number is required');
  perform app.require(coalesce(btrim(p ->> 'bank'), '') <> '', 'Bank is required');
  perform app.require(iss is not null and exp is not null and exp >= iss, 'Enter the issue date and the validity (expiry) date');
  val := coalesce(val, case when t = 'performance' then s.pb_value else s.ap_value end);
  perform app.require(val is not null and val > 0, 'Enter the bond value');
  select * into pr from public.projects where id = e.project_id;
  cat := coalesce(pr.project_type, nullif(p ->> 'category', '')::public.project_type);
  perform app.require(cat is not null, 'Choose the category');
  own := case when pr.owner_id is not null and exists (select 1 from public.profiles where id = pr.owner_id and active and role in ('asm_building', 'asm_infra'))
              then pr.owner_id else app.bond_owner_for(cat) end;
  perform app.require(own is not null, format('No sales person handles the %s category – set it under Team & lists', cat));
  insert into public.bonds (bond_type, bond_no, bank, bank_branch, category, owner_id, project_name, contract_no, customer, currency, bond_value,
                            contract_value, bond_pct, advance_amount, issue_date, expiry_date, completion_date, notes, exec_project_id)
  values (t, btrim(p ->> 'bond_no'), btrim(p ->> 'bank'), nullif(btrim(p ->> 'bank_branch'), ''), cat, own, coalesce(e.code || ' ', '') || e.name,
          e.contract_ref, coalesce(e.client_name, (select name from public.organizations where id = pr.organization_id), e.name), 'LKR', val,
          e.contract_value_lkr, case when t = 'performance' then s.pb_pct else s.ap_pct end, case when t = 'advance_payment' then s.ap_value end,
          iss, exp, e.end_date, nullif(btrim(p ->> 'notes'), ''), p_exec)
  returning * into b;
  insert into public.bond_log (bond_id, kind, note) values (b.id, 'created', 'Recorded by the SEE for ' || app.exec_head(p_exec));
  perform app.notify_many(array(select x from unnest(app.role_users('operations_exec', 'sm_projects') || own) x where x <> auth.uid()), 'bond_assigned',
    case t when 'performance' then 'Performance bond recorded' else 'Advance payment bond recorded' end, app.bond_head(b), 'normal', 'bond', b.id, app.bond_url(b.id));
  return b.id;
end $$;

-- After the advance payment bond: the advance payment invoice (kept apart from invoicing)
create or replace function public.record_advance_invoice(p_exec uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.exec_securities; d date := nullif(p ->> 'date', '')::date; amt numeric := nullif(p ->> 'amount', '')::numeric;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer records the advance invoice');
  select * into s from public.exec_securities where exec_project_id = p_exec for update;
  perform app.require(s.submitted_at is not null and s.ap_applicable, 'No advance payment applies to this project');
  perform app.require(s.adv_invoice_date is null, 'The advance is already invoiced');
  perform app.require(exists (select 1 from public.bonds where exec_project_id = p_exec and bond_type = 'advance_payment' and status = 'active'),
    'Enter the advance payment bond first');
  perform app.require(coalesce(btrim(p ->> 'invoice_no'), '') <> '', 'Enter the invoice number');
  perform app.require(d is not null and d <= (now() at time zone app.tz())::date, 'Enter the invoice date');
  amt := coalesce(amt, s.ap_value);
  perform app.require(amt > 0, 'Enter the invoice amount');
  update public.exec_securities set adv_invoice_no = btrim(p ->> 'invoice_no'), adv_invoice_date = d, adv_invoice_amount = amt, adv_due_date = d + 14, updated_at = now()
   where exec_project_id = p_exec;
  perform app.notify_many(array(select x from unnest(app.exec_people_money(p_exec)) x where x <> auth.uid()), 'exec_securities', 'Advance payment invoiced',
    concat_ws(' · ', app.exec_head(p_exec), btrim(p ->> 'invoice_no'), app.fmt_money(amt, 'LKR'), 'to be received by ' || to_char(d + 14, 'DD Mon')),
    'normal', 'exec_project', p_exec, '/execution/' || p_exec);
end $$;

-- Each receipt from the client (part payments allowed); fully received → Received, and any block is lifted
create or replace function public.record_advance_receipt(p_exec uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.exec_securities; d date := nullif(p ->> 'date', '')::date; amt numeric := nullif(p ->> 'amount', '')::numeric; tot numeric;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer records the advance received');
  select * into s from public.exec_securities where exec_project_id = p_exec for update;
  perform app.require(s.adv_invoice_date is not null, 'Record the advance invoice first');
  perform app.require(amt is not null and amt > 0, 'Enter the amount received');
  perform app.require(d is not null and d >= s.adv_invoice_date and d <= (now() at time zone app.tz())::date, 'Enter the date received (not before the invoice)');
  tot := app.advance_received(p_exec);
  perform app.require(tot + amt <= s.adv_invoice_amount, format('Only %s is still due', app.fmt_money(s.adv_invoice_amount - tot, 'LKR')));
  insert into public.exec_advance_receipts (exec_project_id, amount, received_on, ref, note) values (p_exec, amt, d, nullif(btrim(p ->> 'ref'), ''), nullif(btrim(p ->> 'note'), ''));
  if tot + amt >= s.adv_invoice_amount then
    update public.exec_securities set adv_received_at = now(), blocked = false, updated_at = now() where exec_project_id = p_exec;
    perform app.notify_many(array(select x from unnest(app.exec_people_money(p_exec)) x where x <> auth.uid()), 'exec_securities',
      case when s.blocked then 'Advance received – project unblocked' else 'Advance payment received' end,
      app.exec_head(p_exec) || ' · ' || app.fmt_money(s.adv_invoice_amount, 'LKR'), 'normal', 'exec_project', p_exec, '/execution/' || p_exec);
  else
    perform app.notify_many(array(select x from unnest(app.exec_people_money(p_exec)) x where x <> auth.uid()), 'exec_securities', 'Advance part payment received',
      concat_ws(' · ', app.exec_head(p_exec), app.fmt_money(amt, 'LKR') || ' received', app.fmt_money(s.adv_invoice_amount - tot - amt, 'LKR') || ' still due'),
      'normal', 'exec_project', p_exec, '/execution/' || p_exec);
  end if;
end $$;

-- SM Projects or the GM / DGM: block the project until the advance is received, or extend the date (which lifts a block)
create or replace function public.decide_advance_delay(p_exec uuid, p_action text, p_reason text, p_date date default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.exec_securities; e public.exec_projects; team uuid[];
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'SM Projects or the GM / DGM decide');
  perform app.require(p_action in ('block', 'extend', 'unblock'), 'Block, extend or unblock');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select * into s from public.exec_securities where exec_project_id = p_exec for update;
  perform app.require(s.adv_invoice_date is not null and s.adv_received_at is null, 'No advance is outstanding');
  select * into e from public.exec_projects where id = p_exec;
  team := array(select x from unnest(array[e.see_id] || app.project_aes(p_exec) || app.role_users('sm_projects', 'gm', 'operations_exec')) x where x is not null and x <> auth.uid());
  if p_action = 'block' then
    perform app.require(not s.blocked, 'Already blocked');
    update public.exec_securities set blocked = true, blocked_by = auth.uid(), blocked_at = now(), block_reason = btrim(p_reason), updated_at = now() where exec_project_id = p_exec;
    perform app.notify_many(team, 'exec_securities', 'Project blocked – advance payment not received',
      app.exec_head(p_exec) || ' · ' || btrim(p_reason) || ' · no new material requests, orders, programme approval or subcontractor certificates until the advance is received',
      'critical', 'exec_project', p_exec, '/execution/' || p_exec);
  elsif p_action = 'extend' then
    perform app.require(p_date is not null and p_date > (now() at time zone app.tz())::date, 'Choose a new date after today');
    update public.exec_securities set adv_due_date = p_date, extensions = extensions + 1, last_extension_reason = btrim(p_reason), blocked = false, updated_at = now()
     where exec_project_id = p_exec;
    perform app.notify_many(team, 'exec_securities', 'Advance payment date extended',
      app.exec_head(p_exec) || ' · to ' || to_char(p_date, 'DD Mon YYYY') || ' · ' || btrim(p_reason), 'normal', 'exec_project', p_exec, '/execution/' || p_exec);
  else
    perform app.require(s.blocked, 'Not blocked');
    update public.exec_securities set blocked = false, last_extension_reason = btrim(p_reason), updated_at = now() where exec_project_id = p_exec;
    perform app.notify_many(team, 'exec_securities', 'Project unblocked', app.exec_head(p_exec) || ' · ' || btrim(p_reason), 'normal', 'exec_project', p_exec, '/execution/' || p_exec);
  end if;
end $$;

-- A blocked project: no new material requests / approvals / orders, no programme approval, no new subcontractor certificates
create or replace function app.block_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare ex uuid;
begin
  if tg_table_name = 'exec_projects' then
    if not (new.stage > old.stage) then return new; end if;
    ex := new.id;
  else
    if tg_table_name = 'material_requests' and tg_op = 'UPDATE' then
      if new.status is not distinct from old.status or new.status not in ('submitted', 'pending_smp', 'approved', 'ordered') then return new; end if;
    end if;
    ex := new.exec_project_id;
  end if;
  if app.exec_blocked(ex) then
    raise exception 'This project is blocked by SM Projects / GM until the advance payment is received';
  end if;
  return new;
end $$;
create trigger material_requests_block_guard before insert or update of status on public.material_requests for each row execute function app.block_guard();
create trigger exec_projects_block_guard before update of stage on public.exec_projects for each row execute function app.block_guard();
create trigger sub_certs_block_guard before insert on public.sub_certs for each row execute function app.block_guard();

-- Every morning: the advance not fully received after its date → SM Projects and the GM / DGM (and the SEE); terms not submitted after 7 days → the SEE
create or replace function public.securities_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; r record; n int := 0; due numeric;
begin
  for r in select s.*, e.see_id from public.exec_securities s join public.exec_projects e on e.id = s.exec_project_id and e.status = 'active'
            where s.adv_invoice_date is not null and s.adv_received_at is null and s.adv_due_date < today loop
    due := r.adv_invoice_amount - app.advance_received(r.exec_project_id);
    perform app.notify_many(app.role_users('sm_projects', 'gm') || r.see_id, 'exec_securities',
      format('Advance payment not received – %s day(s) late', today - r.adv_due_date),
      concat_ws(' · ', app.exec_head(r.exec_project_id), app.fmt_money(due, 'LKR') || ' still due', 'invoiced ' || to_char(r.adv_invoice_date, 'DD Mon'),
                case when r.blocked then 'project blocked' else 'block the project or extend the date' end),
      'critical', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id, format('adv_late:%s:%s', r.exec_project_id, today));
    n := n + 1;
  end loop;
  for r in select e.id, e.see_id from public.exec_projects e left join public.exec_securities s on s.exec_project_id = e.id
            where e.status = 'active' and s.submitted_at is null and e.created_at < p_at - interval '7 days' and e.see_id is not null loop
    perform app.notify(r.see_id, 'exec_securities', 'Submit the bonds and advance for the project', app.exec_head(r.id) || ' · performance bond and advance payment – what applies',
      'normal', 'exec_project', r.id, '/execution/' || r.id, format('sec_submit:%s:%s', r.id, to_char(today, 'IYYY-IW')));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.securities_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.securities_tick(timestamptz) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('securities-tick', '25 3 * * *', 'select public.securities_tick()');   -- 08:55 Sri Lanka time
  end if;
end $$;

-- Anyone on the project sees that it is blocked (not the amounts)
create or replace function public.exec_block_state(p_exec uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when app.can_read_exec(p_exec) then
    (select jsonb_build_object('blocked', s.blocked, 'reason', s.block_reason, 'at', s.blocked_at) from public.exec_securities s where s.exec_project_id = p_exec and s.blocked)
  end
$$;
