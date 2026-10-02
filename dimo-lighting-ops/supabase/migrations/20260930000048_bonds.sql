-- Bonds & guarantees: Bid Bonds, Performance Bonds and Advance Payment Bonds.
-- The Operations Executive records and updates bonds; everyone else views them. The owner is the sales person who handles
-- the bond's category (project type). Alerts go to the owner and the Operations Executive, and from 30 days before expiry
-- also to SM Projects and GM / DGM:
--   * 60, 30, 14 and 7 days before expiry; daily from 7 days before expiry until it is returned, extended or claimed
--   * expired and not returned: daily to the owner and Operations, SM Projects and GM / DGM once and then every Monday
--   * bid bond for a lost / cancelled tender not returned 14 days after the result
--   * performance bond whose defects liability period has ended / advance payment bond fully recovered: release it
--   * claim (encashment) recorded: immediately, critical, to all
--   * every Monday 08:00: summary of bonds expiring in the next 30 days and expired bonds to SM Projects, GM / DGM and Operations

create table public.bonds (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  bond_type text not null check (bond_type in ('bid', 'performance', 'advance_payment')),
  bond_no text not null,                      -- bank reference
  bank text not null,
  bank_branch text,
  category public.project_type not null,      -- decides the owner
  owner_id uuid references public.profiles (id),
  project_name text not null,                 -- tender name for a bid bond
  tender_no text,
  contract_no text,                           -- contract / PO number
  customer text not null,                     -- beneficiary
  organization_id uuid references public.organizations (id),
  currency public.currency not null default 'LKR',
  bond_value numeric(16, 2) not null check (bond_value > 0),
  contract_value numeric(16, 2),              -- tender / contract value
  bond_pct numeric(5, 2) check (bond_pct is null or (bond_pct > 0 and bond_pct <= 100)),
  advance_amount numeric(16, 2),              -- advance payment bond: advance received
  recovered_amount numeric(16, 2) not null default 0,
  issue_date date not null,
  expiry_date date not null,
  original_expiry date,
  extensions int not null default 0,
  tender_closing_date date,
  tender_result text not null default 'pending' check (tender_result in ('pending', 'won', 'lost', 'cancelled')),
  result_on date,
  completion_date date,
  dlp_end_date date,                          -- defects liability period end
  status text not null default 'active' check (status in ('active', 'returned', 'claimed', 'cancelled')),
  closed_on date,
  close_note text,
  notes text,
  -- alert bookkeeping
  alert_level int not null default 0,         -- 1 = 60 days, 2 = 30, 3 = 14, 4 = 7
  expired_alerted boolean not null default false,
  return_alerted boolean not null default false,
  release_alerted boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bond_dates check (expiry_date >= issue_date)
);
create index on public.bonds (bond_type, status);
create index on public.bonds (owner_id);
create index on public.bonds (lower(customer));

create table public.bond_log (
  id bigint generated always as identity primary key,
  bond_id uuid not null references public.bonds (id) on delete cascade,
  at timestamptz not null default now(),
  user_id uuid default auth.uid() references public.profiles (id),
  kind text not null,
  note text
);

-- Owner = the active sales person who handles the category (Assistant Sales Manager first)
create or replace function app.bond_owner_for(p_category public.project_type) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles
   where active and role in ('asm_building', 'asm_infra') and p_category = any (project_types)
   order by created_at limit 1
$$;

create or replace function app.bonds_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.code := coalesce(new.code, app.next_code('BND'));
    new.original_expiry := coalesce(new.original_expiry, new.expiry_date);
  end if;
  if new.organization_id is null then
    select id into new.organization_id from public.organizations
     where merged_into is null and name_norm = app.normalize_name(new.customer) limit 1;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger bonds_before before insert or update on public.bonds for each row execute function app.bonds_before();
create trigger audit_bonds after insert or update on public.bonds for each row execute function app.audit();

alter table public.bonds enable row level security;
alter table public.bond_log enable row level security;
-- Operations, SM Projects and GM / DGM see all bonds; a sales person sees the bonds they own or of the categories they handle
create policy bonds_read on public.bonds for select to authenticated
  using (app.has_role('gm', 'sm_projects', 'operations_exec') or owner_id = auth.uid()
         or (app.is_sales_person() and category = any (app.my_project_types())));
create policy bond_log_read on public.bond_log for select to authenticated
  using (exists (select 1 from public.bonds b where b.id = bond_id));
grant select on public.bonds, public.bond_log to authenticated;

create or replace function app.bond_url(p_id uuid) returns text language sql immutable as $$ select '/bonds/' || p_id $$;

create or replace function app.bond_head(b public.bonds) returns text language sql stable as $$
  select format('%s %s – %s · %s · %s · %s', case b.bond_type when 'bid' then 'Bid bond' when 'performance' then 'Performance bond'
                else 'Advance payment bond' end, b.bond_no, b.project_name, b.customer, app.fmt_money(b.bond_value, b.currency), b.bank)
$$;

-- Create / edit – Operations Executive only. The expiry of an existing bond changes only through "Extend validity".
create or replace function public.save_bond(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b public.bonds;
  bid uuid;
  t text := p_data ->> 'bond_type';
  cat public.project_type;
  own uuid;
  cv numeric := nullif(p_data ->> 'contract_value', '')::numeric;
  pct numeric := nullif(p_data ->> 'bond_pct', '')::numeric;
  val numeric;
  iss date := nullif(p_data ->> 'issue_date', '')::date;
  exp date := nullif(p_data ->> 'expiry_date', '')::date;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive records bonds');
  perform app.require(t in ('bid', 'performance', 'advance_payment'), 'Choose the bond type');
  perform app.require(coalesce(btrim(p_data ->> 'bond_no'), '') <> '', 'Bond number is required');
  perform app.require(coalesce(btrim(p_data ->> 'bank'), '') <> '', 'Bank is required');
  perform app.require(coalesce(btrim(p_data ->> 'project_name'), '') <> '',
    case when t = 'bid' then 'Tender / project name is required' else 'Project name is required' end);
  perform app.require(coalesce(btrim(p_data ->> 'customer'), '') <> '', 'Customer (beneficiary) is required');
  perform app.require(t <> 'bid' or coalesce(btrim(p_data ->> 'tender_no'), '') <> '', 'Tender number is required');
  perform app.require(p_data ->> 'currency' in ('LKR', 'USD'), 'Currency must be LKR or USD');
  perform app.require(nullif(p_data ->> 'category', '') is not null, 'Choose the category – it decides the owner');
  cat := (p_data ->> 'category')::public.project_type;
  perform app.require(iss is not null, 'Issue date is required');
  val := coalesce(nullif(p_data ->> 'bond_value', '')::numeric, round(cv * pct / 100, 2));
  perform app.require(val is not null and val > 0, 'Enter the bond value (or the contract value and bond %)');
  own := coalesce(nullif(p_data ->> 'owner_id', '')::uuid, app.bond_owner_for(cat));
  perform app.require(own is not null, format('No sales person handles the %s category – set it under Team & lists', cat));
  perform app.require(exists (select 1 from public.profiles where id = own and active and role in ('asm_building', 'asm_infra')),
    'The owner must be an active sales person');

  if p_id is null then
    perform app.require(exp is not null, 'Validity (expiry) date is required');
    perform app.require(exp >= iss, 'The expiry date must be on or after the issue date');
    perform app.require(not exists (select 1 from public.bonds where lower(bond_no) = lower(btrim(p_data ->> 'bond_no'))
                                    and lower(bank) = lower(btrim(p_data ->> 'bank')) and status <> 'cancelled'),
      'This bond number is already recorded for this bank');
    insert into public.bonds (bond_type, bond_no, bank, bank_branch, category, owner_id, project_name, tender_no, contract_no, customer,
      currency, bond_value, contract_value, bond_pct, advance_amount, issue_date, expiry_date, tender_closing_date, completion_date,
      dlp_end_date, notes)
    values (t, btrim(p_data ->> 'bond_no'), btrim(p_data ->> 'bank'), nullif(btrim(p_data ->> 'bank_branch'), ''), cat, own,
      btrim(p_data ->> 'project_name'), nullif(btrim(p_data ->> 'tender_no'), ''), nullif(btrim(p_data ->> 'contract_no'), ''),
      btrim(p_data ->> 'customer'), (p_data ->> 'currency')::public.currency, val, cv, pct,
      nullif(p_data ->> 'advance_amount', '')::numeric, iss, exp, nullif(p_data ->> 'tender_closing_date', '')::date,
      nullif(p_data ->> 'completion_date', '')::date, nullif(p_data ->> 'dlp_end_date', '')::date, nullif(btrim(p_data ->> 'notes'), ''))
    returning * into b;
    insert into public.bond_log (bond_id, kind, note) values (b.id, 'created', 'Recorded');
    perform app.notify(b.owner_id, 'bond_assigned', 'Bond recorded for you', app.bond_head(b) || ' · expires ' || to_char(b.expiry_date, 'DD Mon YYYY'),
      'normal', 'bond', b.id, app.bond_url(b.id));
    return b.id;
  end if;

  select * into b from public.bonds where id = p_id for update;
  perform app.require(b.id is not null, 'Bond not found');
  perform app.require(b.status = 'active', 'This bond is closed');
  perform app.require(exp is null or exp = b.expiry_date, 'Change the expiry date with “Extend validity”');
  update public.bonds set bond_type = t, bond_no = btrim(p_data ->> 'bond_no'), bank = btrim(p_data ->> 'bank'),
    bank_branch = nullif(btrim(p_data ->> 'bank_branch'), ''), category = cat, owner_id = own,
    project_name = btrim(p_data ->> 'project_name'), tender_no = nullif(btrim(p_data ->> 'tender_no'), ''),
    contract_no = nullif(btrim(p_data ->> 'contract_no'), ''), customer = btrim(p_data ->> 'customer'),
    organization_id = case when lower(btrim(p_data ->> 'customer')) = lower(b.customer) then organization_id end,
    currency = (p_data ->> 'currency')::public.currency, bond_value = val, contract_value = cv, bond_pct = pct,
    advance_amount = nullif(p_data ->> 'advance_amount', '')::numeric, issue_date = iss,
    tender_closing_date = nullif(p_data ->> 'tender_closing_date', '')::date, completion_date = nullif(p_data ->> 'completion_date', '')::date,
    dlp_end_date = nullif(p_data ->> 'dlp_end_date', '')::date, notes = nullif(btrim(p_data ->> 'notes'), ''),
    release_alerted = case when nullif(p_data ->> 'dlp_end_date', '')::date is distinct from b.dlp_end_date then false else release_alerted end
  where id = b.id;
  insert into public.bond_log (bond_id, kind, note) values (b.id, 'edited', 'Details updated');
  if own is distinct from b.owner_id then
    perform app.notify(own, 'bond_assigned', 'Bond assigned to you', app.bond_head(b), 'normal', 'bond', b.id, app.bond_url(b.id));
  end if;
  return b.id;
end $$;

-- Validity extended by the bank
create or replace function public.extend_bond(p_id uuid, p_new_expiry date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bonds;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive updates bonds');
  select * into b from public.bonds where id = p_id for update;
  perform app.require(b.id is not null and b.status = 'active', 'Only an active bond can be extended');
  perform app.require(p_new_expiry > b.expiry_date, 'The new expiry date must be after the current one');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason / bank reference for the extension');
  update public.bonds set expiry_date = p_new_expiry, extensions = extensions + 1, alert_level = 0, expired_alerted = false where id = b.id;
  insert into public.bond_log (bond_id, kind, note)
  values (b.id, 'extended', format('Validity %s → %s · %s', to_char(b.expiry_date, 'DD Mon YYYY'), to_char(p_new_expiry, 'DD Mon YYYY'), btrim(p_reason)));
  perform app.notify(b.owner_id, 'bond_extended', 'Bond validity extended', app.bond_head(b) || ' · now expires ' || to_char(p_new_expiry, 'DD Mon YYYY'),
    'normal', 'bond', b.id, app.bond_url(b.id));
end $$;

-- Bid bond: tender result
create or replace function public.record_bond_tender_result(p_id uuid, p_result text, p_on date, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bonds;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive updates bonds');
  select * into b from public.bonds where id = p_id for update;
  perform app.require(b.id is not null and b.bond_type = 'bid', 'Only a bid bond has a tender result');
  perform app.require(p_result in ('pending', 'won', 'lost', 'cancelled'), 'Choose the tender result');
  perform app.require(p_result = 'pending' or p_on is not null, 'Enter the result date');
  update public.bonds set tender_result = p_result, result_on = case when p_result = 'pending' then null else p_on end, return_alerted = false
   where id = b.id;
  insert into public.bond_log (bond_id, kind, note)
  values (b.id, 'tender_result', concat_ws(' · ', 'Tender ' || p_result || coalesce(' on ' || to_char(p_on, 'DD Mon YYYY'), ''), nullif(btrim(p_note), '')));
  if p_result = 'won' then
    perform app.notify_many(app.role_users('operations_exec') || b.owner_id, 'bond_tender_won', 'Tender won – arrange the performance bond',
      app.bond_head(b) || ' · get the bid bond back and record the performance / advance payment bonds', 'normal', 'bond', b.id, app.bond_url(b.id));
  elsif p_result in ('lost', 'cancelled') then
    perform app.notify_many(app.role_users('operations_exec') || b.owner_id, 'bond_return_due', 'Tender ' || p_result || ' – collect the bid bond',
      app.bond_head(b) || ' · collect the original from the customer and return it to the bank', 'normal', 'bond', b.id, app.bond_url(b.id));
  end if;
end $$;

-- Advance payment bond: advance recovered so far (deducted from invoices)
create or replace function public.update_bond_recovery(p_id uuid, p_recovered numeric, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bonds; target numeric;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive updates bonds');
  select * into b from public.bonds where id = p_id for update;
  perform app.require(b.id is not null and b.bond_type = 'advance_payment', 'Only an advance payment bond has a recovery');
  target := coalesce(b.advance_amount, b.bond_value);
  perform app.require(p_recovered is not null and p_recovered >= 0 and p_recovered <= target,
    'The recovered amount must be between 0 and ' || app.fmt_money(target, b.currency));
  update public.bonds set recovered_amount = p_recovered where id = b.id;
  insert into public.bond_log (bond_id, kind, note)
  values (b.id, 'recovery', concat_ws(' · ', format('Recovered %s of %s', app.fmt_money(p_recovered, b.currency), app.fmt_money(target, b.currency)),
          nullif(btrim(p_note), '')));
  if p_recovered >= target and b.status = 'active' then
    perform app.notify_many(app.role_users('operations_exec') || b.owner_id, 'bond_release_due', 'Advance fully recovered – release the bond',
      app.bond_head(b) || ' · ask the customer to release it and return it to the bank', 'normal', 'bond', b.id, app.bond_url(b.id));
  end if;
end $$;

-- Close: returned to the bank, claimed (encashed) or cancelled
create or replace function public.close_bond(p_id uuid, p_status text, p_on date, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bonds;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive updates bonds');
  select * into b from public.bonds where id = p_id for update;
  perform app.require(b.id is not null and b.status = 'active', 'This bond is already closed');
  perform app.require(p_status in ('returned', 'claimed', 'cancelled'), 'Choose how the bond was closed');
  perform app.require(p_on is not null and p_on <= (now() at time zone app.tz())::date, 'Enter the date (not in the future)');
  perform app.require(p_status = 'returned' or coalesce(btrim(p_note), '') <> '', 'Give the details');
  update public.bonds set status = p_status, closed_on = p_on, close_note = nullif(btrim(p_note), '') where id = b.id;
  insert into public.bond_log (bond_id, kind, note)
  values (b.id, p_status, concat_ws(' · ', case p_status when 'returned' then 'Returned to the bank' when 'claimed' then 'Claimed / encashed'
          else 'Cancelled' end || ' on ' || to_char(p_on, 'DD Mon YYYY'), nullif(btrim(p_note), '')));
  if p_status = 'claimed' then
    perform app.notify_many(app.role_users('operations_exec', 'sm_projects', 'gm') || b.owner_id, 'bond_claimed', 'Bond claimed (encashed) by the customer',
      app.bond_head(b) || coalesce(' · ' || btrim(p_note), ''), 'critical', 'bond', b.id, app.bond_url(b.id));
  end if;
end $$;

-- Alerts (every 15 minutes from 08:00; each stage once, daily reminders deduplicated per day)
create or replace function public.bond_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  monday boolean := extract(isodow from loc) = 1;
  b public.bonds;
  n int := 0;
  lvl int;
  left_days int;
  alerted boolean;
  ops uuid[] := app.role_users('operations_exec');
  mgmt uuid[] := app.role_users('sm_projects', 'gm');
  soon int; soon_lkr numeric; soon_usd numeric; gone int; gone_lkr numeric; gone_usd numeric;
begin
  if loc::time < time '08:00' then return 0; end if;
  for b in select * from public.bonds where status = 'active' loop
    left_days := b.expiry_date - today;
    -- Upcoming expiry: 60 → owner + Operations; 30 / 14 / 7 → + SM Projects and GM / DGM
    lvl := case when left_days < 0 then 0 when left_days <= 7 then 4 when left_days <= 14 then 3 when left_days <= 30 then 2
                when left_days <= 60 then 1 else 0 end;
    alerted := lvl > b.alert_level;
    if alerted then
      perform app.notify_many(array[b.owner_id] || ops || case when lvl >= 2 then mgmt else '{}'::uuid[] end,
        'bond_expiring', format('Bond expires in %s days', left_days),
        app.bond_head(b) || ' · expires ' || to_char(b.expiry_date, 'DD Mon YYYY') || ' · extend it or get it returned',
        case when lvl >= 4 then 'critical'::public.priority else 'normal'::public.priority end, 'bond', b.id, app.bond_url(b.id));
      update public.bonds set alert_level = lvl where id = b.id; n := n + 1;
    end if;
    -- Last 7 days and after expiry: every day to the owner and Operations until it is returned, extended or claimed
    if left_days <= 7 and not alerted then
      perform app.notify_many(array[b.owner_id] || ops, case when left_days < 0 then 'bond_expired' else 'bond_expiring' end,
        case when left_days < 0 then format('Bond expired %s days ago – not returned', -left_days)
             when left_days = 0 then 'Bond expires today' else format('Bond expires in %s days', left_days) end,
        app.bond_head(b) || ' · expires ' || to_char(b.expiry_date, 'DD Mon YYYY'),
        'normal', 'bond', b.id, app.bond_url(b.id), format('bonddaily:%s:%s', b.id, today), true);
      n := n + 1;
    end if;
    -- Expired: SM Projects and GM / DGM once (then in the Monday summary)
    if left_days < 0 and not b.expired_alerted then
      perform app.notify_many(mgmt, 'bond_expired', 'Bond expired and not returned',
        app.bond_head(b) || ' · expired ' || to_char(b.expiry_date, 'DD Mon YYYY') || ' · owner ' || coalesce(app.display_name(b.owner_id), '—'),
        'normal', 'bond', b.id, app.bond_url(b.id));
      update public.bonds set expired_alerted = true where id = b.id; n := n + 1;
    end if;
    -- Bid bond for a lost / cancelled tender still not returned 14 days after the result
    if b.bond_type = 'bid' and b.tender_result in ('lost', 'cancelled') and not b.return_alerted and today - b.result_on >= 14 then
      perform app.notify_many(array[b.owner_id] || ops || mgmt, 'bond_return_due', 'Bid bond not returned 14 days after the tender result',
        app.bond_head(b) || ' · tender ' || b.tender_result || ' on ' || to_char(b.result_on, 'DD Mon YYYY'), 'normal', 'bond', b.id, app.bond_url(b.id));
      update public.bonds set return_alerted = true where id = b.id; n := n + 1;
    end if;
    -- Performance bond: defects liability period over → release
    if b.bond_type = 'performance' and b.dlp_end_date is not null and b.dlp_end_date <= today and not b.release_alerted then
      perform app.notify_many(array[b.owner_id] || ops || mgmt, 'bond_release_due', 'Defects liability period ended – release the performance bond',
        app.bond_head(b) || ' · DLP ended ' || to_char(b.dlp_end_date, 'DD Mon YYYY'), 'normal', 'bond', b.id, app.bond_url(b.id));
      update public.bonds set release_alerted = true where id = b.id; n := n + 1;
    end if;
  end loop;

  -- Monday summary to SM Projects, GM / DGM and Operations
  if monday then
    select count(*), sum(bond_value) filter (where currency = 'LKR'), sum(bond_value) filter (where currency = 'USD')
      into soon, soon_lkr, soon_usd from public.bonds where status = 'active' and expiry_date between today and today + 30;
    select count(*), sum(bond_value) filter (where currency = 'LKR'), sum(bond_value) filter (where currency = 'USD')
      into gone, gone_lkr, gone_usd from public.bonds where status = 'active' and expiry_date < today;
    if soon + gone > 0 then
      perform app.notify_many(mgmt || ops, 'bond_weekly', 'Bonds: weekly summary',
        concat_ws(' · ',
          case when soon > 0 then format('%s expiring in 30 days (%s)', soon,
            concat_ws(' + ', case when soon_lkr > 0 then app.fmt_money(soon_lkr, 'LKR') end, case when soon_usd > 0 then app.fmt_money(soon_usd, 'USD') end)) end,
          case when gone > 0 then format('%s expired and not returned (%s)', gone,
            concat_ws(' + ', case when gone_lkr > 0 then app.fmt_money(gone_lkr, 'LKR') end, case when gone_usd > 0 then app.fmt_money(gone_usd, 'USD') end)) end),
        'normal', null, null, '/bonds', format('bondweek:%s', today), false);
      n := n + 1;
    end if;
  end if;
  return n;
end $$;
revoke execute on function public.bond_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.bond_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('bond-tick', '*/15 * * * *', 'select public.bond_tick()');
  end if;
end $$;

revoke execute on function public.save_bond(uuid, jsonb), public.extend_bond(uuid, date, text),
  public.record_bond_tender_result(uuid, text, date, text), public.update_bond_recovery(uuid, numeric, text),
  public.close_bond(uuid, text, date, text), app.bond_owner_for(public.project_type) from public, anon;
grant execute on function public.save_bond(uuid, jsonb), public.extend_bond(uuid, date, text),
  public.record_bond_tender_result(uuid, text, date, text), public.update_bond_recovery(uuid, numeric, text),
  public.close_bond(uuid, text, date, text), app.bond_owner_for(public.project_type) to authenticated, service_role;

-- Owner preview for the form
create or replace function public.bond_owner_for(p_category public.project_type) returns uuid
language sql stable security definer set search_path = public as $$ select app.bond_owner_for(p_category) $$;
revoke execute on function public.bond_owner_for(public.project_type) from public, anon;
grant execute on function public.bond_owner_for(public.project_type) to authenticated;

-- Bond copies and bank letters: the Operations Executive uploads, everyone who can see the bond can open them
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
  else
    return r = 'gm';
  end case;
end $$;
