-- Manufacturer side of warranty: master list, project registration and back-to-back manufacturer claims (RMA).
--  * Manufacturer master list (Operations Executive, Senior Electrical Engineer, SM Projects): warranty terms, whether a project
--    must be registered and within how many days of the warranty start, evidence needed for a claim.
--  * Registration: when a warranty is saved, a registration is due for each manufacturer on it that requires one. The
--    Operations Executive registers manually and records the date and reference.
--  * Manufacturer claim (RMA): the warranty officer (Senior Electrical Engineer; Operations as back-up) raises it for one or more
--    covered customer claims, contacts the manufacturer manually and records each step: contact, RMA number, goods returned
--    (Operations), decision, replacement / credit note received (Operations), close. A rejection goes to SM Projects:
--    absorb the cost or escalate. Recovered value flows back to the customer claims.
--  * A customer claim can now be closed while its manufacturer claim is still running (recovery is recorded later).
--  * Rectification records whether the customer was repaired from DIMO stock now or with the manufacturer's replacement.

create table public.manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  local_agent text,
  contact text,                               -- reference only – contact is made manually
  warranty_terms text,                        -- e.g. luminaires 5 yrs, drivers 3 yrs
  registration_required boolean not null default false,
  registration_days int check (registration_days is null or registration_days > 0),
  evidence_required text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index manufacturers_name on public.manufacturers (lower(name));

alter table public.warranty_lines add column if not exists manufacturer_id uuid references public.manufacturers (id);
alter table public.warranty_claims add column if not exists repaired_from text check (repaired_from in ('dimo_stock', 'manufacturer'));
alter table public.warranty_claims add column if not exists rma_alerted boolean not null default false;

create table public.warranty_registrations (
  id uuid primary key default gen_random_uuid(),
  warranty_id uuid not null references public.warranties (id) on delete cascade,
  manufacturer_id uuid not null references public.manufacturers (id),
  due_date date not null,
  registered_on date,
  reference text,
  note text,
  alert_level int not null default 0,         -- 1 = 14 days before, 2 = due, 3 = overdue (SM Projects)
  unique (warranty_id, manufacturer_id)
);

create table public.manufacturer_claims (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  manufacturer_id uuid not null references public.manufacturers (id),
  currency public.currency not null default 'LKR',
  evidence text,                              -- what was collected (photos, failure report, batch codes, invoice copy)
  contacted_on date,
  contact_note text,
  rma_no text,
  acknowledged_on date,
  returned_on date,
  courier text,
  tracking_no text,
  freight_cost numeric(16, 2) not null default 0,
  decision text check (decision in ('accepted', 'partly', 'rejected')),
  decided_on date,
  decision_note text,
  outcome text check (outcome in ('replacement', 'credit_note', 'repair')),
  received_on date,
  grn_no text,
  credit_note_no text,
  value_recovered numeric(16, 2) not null default 0,
  smp_decision text check (smp_decision in ('absorb', 'escalate')),
  escalations int not null default 0,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  closed_on date,
  close_note text,
  ack_alerted boolean not null default false,
  decision_alerted boolean not null default false,
  receipt_alerted boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.manufacturer_claims (manufacturer_id, status);

create table public.manufacturer_claim_items (
  id uuid primary key default gen_random_uuid(),
  rma_id uuid not null references public.manufacturer_claims (id) on delete cascade,
  claim_id uuid references public.warranty_claims (id),
  product text not null,
  quantity numeric(12, 2) not null check (quantity > 0),
  batch_code text,
  value_claimed numeric(16, 2) not null default 0 check (value_claimed >= 0)
);
create index on public.manufacturer_claim_items (rma_id);
create index on public.manufacturer_claim_items (claim_id);

create table public.manufacturer_claim_log (
  id bigint generated always as identity primary key,
  rma_id uuid not null references public.manufacturer_claims (id) on delete cascade,
  at timestamptz not null default now(),
  user_id uuid default auth.uid() references public.profiles (id),
  kind text not null,
  note text
);

create or replace function app.manufacturer_claims_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.code := coalesce(new.code, app.next_code('RMA')); end if;
  new.updated_at := now();
  return new;
end $$;
create trigger manufacturer_claims_before before insert or update on public.manufacturer_claims for each row execute function app.manufacturer_claims_before();
create trigger audit_manufacturer_claims after insert or update on public.manufacturer_claims for each row execute function app.audit();

alter table public.manufacturers enable row level security;
alter table public.warranty_registrations enable row level security;
alter table public.manufacturer_claims enable row level security;
alter table public.manufacturer_claim_items enable row level security;
alter table public.manufacturer_claim_log enable row level security;
create policy manufacturers_read on public.manufacturers for select to authenticated using (true);
create policy warranty_registrations_read on public.warranty_registrations for select to authenticated using (app.can_read_warranty(warranty_id));
-- Manufacturer claims: warranty desk, engineers, SM Projects and GM / DGM (sales see the recovery on their claims)
create policy manufacturer_claims_read on public.manufacturer_claims for select to authenticated using (app.sees_all_warranties());
create policy manufacturer_claim_items_read on public.manufacturer_claim_items for select to authenticated using (app.sees_all_warranties());
create policy manufacturer_claim_log_read on public.manufacturer_claim_log for select to authenticated using (app.sees_all_warranties());
grant select on public.manufacturers, public.warranty_registrations, public.manufacturer_claims, public.manufacturer_claim_items,
  public.manufacturer_claim_log to authenticated;

create or replace function app.rma_url(p_id uuid) returns text language sql immutable as $$ select '/warranty/rma/' || p_id $$;
create or replace function app.rma_head(r public.manufacturer_claims) returns text language sql stable as $$
  select format('%s – %s%s', r.code, (select name from public.manufacturers where id = r.manufacturer_id), coalesce(' · RMA ' || r.rma_no, ''))
$$;

-- ---------------------------------------------------------------------------
-- Manufacturer master list
-- ---------------------------------------------------------------------------
create or replace function public.save_manufacturer(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid; days int := nullif(p_data ->> 'registration_days', '')::int;
begin
  perform app.require(app.has_role('operations_exec', 'senior_elec_engineer', 'sm_projects'), 'Only Operations, the Senior Electrical Engineer or SM Projects edit manufacturers');
  perform app.require(coalesce(btrim(p_data ->> 'name'), '') <> '', 'Enter the manufacturer name');
  perform app.require(coalesce((p_data ->> 'registration_required')::boolean, false) is false or days is not null,
    'Enter within how many days the project must be registered');
  if p_id is null then
    insert into public.manufacturers (name, local_agent, contact, warranty_terms, registration_required, registration_days, evidence_required)
    values (btrim(p_data ->> 'name'), nullif(btrim(p_data ->> 'local_agent'), ''), nullif(btrim(p_data ->> 'contact'), ''),
      nullif(btrim(p_data ->> 'warranty_terms'), ''), coalesce((p_data ->> 'registration_required')::boolean, false), days,
      nullif(btrim(p_data ->> 'evidence_required'), ''))
    returning id into mid;
  else
    update public.manufacturers set name = btrim(p_data ->> 'name'), local_agent = nullif(btrim(p_data ->> 'local_agent'), ''),
      contact = nullif(btrim(p_data ->> 'contact'), ''), warranty_terms = nullif(btrim(p_data ->> 'warranty_terms'), ''),
      registration_required = coalesce((p_data ->> 'registration_required')::boolean, false), registration_days = days,
      evidence_required = nullif(btrim(p_data ->> 'evidence_required'), ''),
      active = coalesce((p_data ->> 'active')::boolean, active)
    where id = p_id returning id into mid;
    perform app.require(mid is not null, 'Manufacturer not found');
  end if;
  -- Lines with this brand get the manufacturer; registrations open where required
  perform app.sync_warranty_manufacturers(x.warranty_id)
     from (select distinct warranty_id from public.warranty_lines where lower(btrim(brand)) = lower(btrim(p_data ->> 'name'))) x;
  return mid;
end $$;

-- Link warranty lines to manufacturers by brand name and open the registrations that are due
create or replace function app.sync_warranty_manufacturers(p_warranty uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w public.warranties;
begin
  select * into w from public.warranties where id = p_warranty;
  update public.warranty_lines l set manufacturer_id = m.id
    from public.manufacturers m
   where l.warranty_id = p_warranty and l.manufacturer_id is null and m.active and lower(btrim(l.brand)) = lower(m.name);
  insert into public.warranty_registrations (warranty_id, manufacturer_id, due_date)
  select distinct w.id, m.id, w.start_date + m.registration_days
    from public.warranty_lines l join public.manufacturers m on m.id = l.manufacturer_id
   where l.warranty_id = w.id and m.registration_required and m.registration_days is not null
  on conflict (warranty_id, manufacturer_id) do update set due_date = excluded.due_date
   where public.warranty_registrations.registered_on is null;
end $$;

create or replace function app.warranty_lines_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.sync_warranty_manufacturers(coalesce(new.warranty_id, old.warranty_id));
  return null;
end $$;
create trigger warranty_lines_sync after insert or update of brand, manufacturer_id on public.warranty_lines
for each row when (pg_trigger_depth() = 0) execute function app.warranty_lines_sync();

create or replace function public.set_line_manufacturer(p_line uuid, p_manufacturer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.warranty_lines;
begin
  perform app.require(app.is_warranty_desk(), 'Not allowed');
  update public.warranty_lines set manufacturer_id = p_manufacturer where id = p_line returning * into l;
  perform app.require(l.id is not null, 'Line not found');
end $$;

create or replace function public.record_registration(p_id uuid, p_on date, p_reference text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.warranty_registrations;
begin
  perform app.require(app.is_warranty_desk(), 'Only the Operations Executive or the Senior Electrical Engineer record registrations');
  perform app.require(p_on is not null and p_on <= (now() at time zone app.tz())::date, 'Enter the registration date (not in the future)');
  update public.warranty_registrations set registered_on = p_on, reference = nullif(btrim(p_reference), ''), note = nullif(btrim(p_note), '')
   where id = p_id returning * into r;
  perform app.require(r.id is not null, 'Registration not found');
  insert into public.warranty_log (warranty_id, kind, note)
  values (r.warranty_id, 'registered', format('Registered with %s on %s%s', (select name from public.manufacturers where id = r.manufacturer_id),
          to_char(p_on, 'DD Mon YYYY'), coalesce(' · ref ' || nullif(btrim(p_reference), ''), '')));
end $$;

-- ---------------------------------------------------------------------------
-- Manufacturer claims (RMA)
-- p_items: [{claim_id?, product, quantity, batch_code, value_claimed}]
-- ---------------------------------------------------------------------------
create or replace function public.create_manufacturer_claim(p_manufacturer uuid, p_items jsonb, p_evidence text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.manufacturer_claims; it jsonb; c public.warranty_claims; n int := 0; cur public.currency;
begin
  perform app.require(app.is_warranty_desk(), 'Only the warranty officer (Senior Electrical Engineer) or Operations raise manufacturer claims');
  perform app.require(exists (select 1 from public.manufacturers where id = p_manufacturer and active), 'Choose the manufacturer');
  perform app.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0, 'Add at least one item');
  select w.currency into cur from public.warranty_claims wc join public.warranties w on w.id = wc.warranty_id
   where wc.id = (select nullif(x ->> 'claim_id', '')::uuid from jsonb_array_elements(p_items) x where nullif(x ->> 'claim_id', '') is not null limit 1);
  insert into public.manufacturer_claims (manufacturer_id, currency, evidence) values (p_manufacturer, coalesce(cur, 'LKR'), nullif(btrim(p_evidence), ''))
  returning * into r;
  for it in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    perform app.require(coalesce(btrim(it ->> 'product'), '') <> '', format('Item %s: enter the product', n));
    perform app.require(coalesce(nullif(it ->> 'quantity', '')::numeric, 0) > 0, format('Item %s: enter the quantity', n));
    c := null;
    if nullif(it ->> 'claim_id', '') is not null then
      select * into c from public.warranty_claims where id = (it ->> 'claim_id')::uuid;
      perform app.require(c.id is not null and c.decision = 'covered', format('Item %s: the customer claim must be decided as covered', n));
    end if;
    insert into public.manufacturer_claim_items (rma_id, claim_id, product, quantity, batch_code, value_claimed)
    values (r.id, c.id, btrim(it ->> 'product'), (it ->> 'quantity')::numeric, nullif(btrim(it ->> 'batch_code'), ''),
      coalesce(nullif(it ->> 'value_claimed', '')::numeric, 0));
    if c.id is not null then
      update public.warranty_claims set supplier_status = 'raised', supplier_ref = r.code, supplier_raised_on = (now() at time zone app.tz())::date
       where id = c.id and supplier_status in ('none', 'rejected');
      insert into public.warranty_log (warranty_id, claim_id, kind, note) values (c.warranty_id, c.id, 'rma', 'Manufacturer claim ' || r.code || ' raised');
    end if;
  end loop;
  insert into public.manufacturer_claim_log (rma_id, kind, note) values (r.id, 'created', format('Raised with %s item(s)', n));
  return r.id;
end $$;

create or replace function app.rma_for_update(p_id uuid) returns public.manufacturer_claims
language plpgsql security definer set search_path = public as $$
declare r public.manufacturer_claims;
begin
  select * into r from public.manufacturer_claims where id = p_id for update;
  perform app.require(r.id is not null, 'Manufacturer claim not found');
  perform app.require(r.status = 'open', 'This manufacturer claim is closed');
  return r;
end $$;

-- One step at a time: contacted, acknowledged, returned, decision, received
create or replace function public.update_manufacturer_claim(p_id uuid, p_step text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.manufacturer_claims;
  d date := nullif(p_data ->> 'date', '')::date;
  today date := (now() at time zone app.tz())::date;
  note text;
begin
  perform app.require(app.is_warranty_desk(), 'Only the warranty officer (Senior Electrical Engineer) or Operations update manufacturer claims');
  r := app.rma_for_update(p_id);
  perform app.require(d is not null and d <= today, 'Enter the date (not in the future)');
  case p_step
  when 'contacted' then
    update public.manufacturer_claims set contacted_on = d, contact_note = nullif(btrim(p_data ->> 'note'), '') where id = r.id;
    note := 'Manufacturer contacted ' || to_char(d, 'DD Mon YYYY');
  when 'acknowledged' then
    perform app.require(coalesce(btrim(p_data ->> 'rma_no'), '') <> '', 'Enter the RMA number');
    update public.manufacturer_claims set acknowledged_on = d, rma_no = btrim(p_data ->> 'rma_no'), contacted_on = coalesce(contacted_on, d) where id = r.id;
    note := 'RMA number ' || btrim(p_data ->> 'rma_no');
  when 'returned' then
    update public.manufacturer_claims set returned_on = d, courier = nullif(btrim(p_data ->> 'courier'), ''),
      tracking_no = nullif(btrim(p_data ->> 'tracking_no'), ''), freight_cost = coalesce(nullif(p_data ->> 'freight_cost', '')::numeric, freight_cost)
     where id = r.id;
    note := concat_ws(' · ', 'Goods returned ' || to_char(d, 'DD Mon YYYY'), nullif(btrim(p_data ->> 'courier'), ''), nullif(btrim(p_data ->> 'tracking_no'), ''));
  when 'decision' then
    perform app.require(p_data ->> 'decision' in ('accepted', 'partly', 'rejected'), 'Choose the manufacturer decision');
    perform app.require(p_data ->> 'decision' = 'rejected' or p_data ->> 'outcome' in ('replacement', 'credit_note', 'repair'), 'Choose replacement, credit note or repair');
    update public.manufacturer_claims set decision = p_data ->> 'decision', decided_on = d, decision_note = nullif(btrim(p_data ->> 'note'), ''),
      outcome = case when p_data ->> 'decision' = 'rejected' then null else p_data ->> 'outcome' end, smp_decision = null, receipt_alerted = false
     where id = r.id;
    note := concat_ws(' · ', 'Manufacturer decision: ' || (p_data ->> 'decision'), nullif(btrim(p_data ->> 'note'), ''));
    if p_data ->> 'decision' = 'rejected' then
      perform app.notify_many(app.role_users('sm_projects', 'senior_elec_engineer'), 'rma_rejected', 'Manufacturer rejected the warranty claim – absorb or escalate?',
        app.rma_head(r) || coalesce(' · ' || nullif(btrim(p_data ->> 'note'), ''), ''), 'normal', 'rma', r.id, app.rma_url(r.id), null, true);
    end if;
  when 'received' then
    perform app.require(r.decision in ('accepted', 'partly'), 'Record the manufacturer decision first');
    perform app.require(coalesce(btrim(p_data ->> 'grn_no'), '') <> '' or coalesce(btrim(p_data ->> 'credit_note_no'), '') <> '',
      'Enter the GRN number or the credit note number');
    update public.manufacturer_claims set received_on = d, grn_no = nullif(btrim(p_data ->> 'grn_no'), ''),
      credit_note_no = nullif(btrim(p_data ->> 'credit_note_no'), ''), value_recovered = coalesce(nullif(p_data ->> 'value_recovered', '')::numeric, 0)
     where id = r.id;
    note := concat_ws(' · ', 'Received ' || to_char(d, 'DD Mon YYYY'), 'GRN ' || nullif(btrim(p_data ->> 'grn_no'), ''),
      'credit note ' || nullif(btrim(p_data ->> 'credit_note_no'), ''), 'value ' || app.fmt_money(coalesce(nullif(p_data ->> 'value_recovered', '')::numeric, 0), r.currency));
  else
    raise exception 'Unknown step';
  end case;
  insert into public.manufacturer_claim_log (rma_id, kind, note) values (r.id, p_step, note);
end $$;

-- SM Projects on a rejected manufacturer claim
create or replace function public.decide_rejected_rma(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.manufacturer_claims;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'SM Projects decides on a rejected manufacturer claim');
  r := app.rma_for_update(p_id);
  perform app.require(r.decision = 'rejected', 'The manufacturer has not rejected this claim');
  perform app.require(p_decision in ('absorb', 'escalate'), 'Choose absorb or escalate');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.manufacturer_claims set smp_decision = p_decision,
    escalations = escalations + case when p_decision = 'escalate' then 1 else 0 end,
    decision = case when p_decision = 'escalate' then null else decision end,
    decision_alerted = case when p_decision = 'escalate' then false else decision_alerted end
  where id = r.id;
  insert into public.manufacturer_claim_log (rma_id, kind, note)
  values (r.id, 'smp_' || p_decision, case p_decision when 'absorb' then 'SM Projects: absorb the cost' else 'SM Projects: escalate to the manufacturer' end || ' · ' || btrim(p_note));
  perform app.notify_many(app.role_users('senior_elec_engineer', 'operations_exec'), 'rma_smp_decision',
    case p_decision when 'absorb' then 'Rejected manufacturer claim: cost absorbed – close it' else 'Escalate the manufacturer claim' end,
    app.rma_head(r) || ' · ' || btrim(p_note), 'normal', 'rma', r.id, app.rma_url(r.id));
end $$;

-- Close: recovered value is shared over the linked customer claims in proportion to the value claimed
create or replace function public.close_manufacturer_claim(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.manufacturer_claims; total numeric; it record;
begin
  perform app.require(app.is_warranty_desk(), 'Only the warranty officer (Senior Electrical Engineer) or Operations close manufacturer claims');
  r := app.rma_for_update(p_id);
  perform app.require(p_status in ('closed', 'cancelled'), 'Choose closed or cancelled');
  perform app.require(p_status = 'cancelled' or r.received_on is not null or r.smp_decision = 'absorb',
    'Record the replacement / credit note received, or get SM Projects to absorb a rejected claim');
  perform app.require(p_status = 'closed' or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.manufacturer_claims set status = p_status, closed_on = (now() at time zone app.tz())::date, close_note = nullif(btrim(p_note), '') where id = r.id;
  select sum(value_claimed) into total from public.manufacturer_claim_items where rma_id = r.id and claim_id is not null;
  for it in select claim_id, sum(value_claimed) as v, count(*) over () as k from public.manufacturer_claim_items
             where rma_id = r.id and claim_id is not null group by claim_id loop
    update public.warranty_claims set
      supplier_status = case when p_status = 'cancelled' then 'none' when r.received_on is not null then 'resolved' else 'rejected' end,
      supplier_resolved_on = (now() at time zone app.tz())::date,
      recovered_amount = recovered_amount + case when p_status = 'closed' and r.received_on is not null
        then round(r.value_recovered * coalesce(it.v / nullif(total, 0), 1.0 / it.k), 2) else 0 end
     where id = it.claim_id;
    insert into public.warranty_log (warranty_id, claim_id, kind, note)
    select c.warranty_id, c.id, 'rma_closed', format('Manufacturer claim %s %s', r.code,
      case when p_status = 'cancelled' then 'cancelled' when r.received_on is not null then 'settled' else 'rejected – cost absorbed' end)
      from public.warranty_claims c where c.id = it.claim_id;
  end loop;
  insert into public.manufacturer_claim_log (rma_id, kind, note) values (r.id, p_status, coalesce(nullif(btrim(p_note), ''), initcap(p_status)));
end $$;

-- Rectification also records where the replacement came from
drop function if exists public.record_claim_rectified(uuid, date, numeric, text);
create or replace function public.record_claim_rectified(p_id uuid, p_on date, p_cost numeric, p_note text default null, p_from text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims; w public.warranties;
begin
  c := app.claim_for_update(p_id);
  perform app.require(app.can_work_claim(c), 'Only the assigned engineer, Operations or the Senior Electrical Engineer update this claim');
  perform app.require(c.decision in ('covered', 'chargeable'), 'The claim must be decided (covered or chargeable) first');
  perform app.require(c.goodwill_status is distinct from 'pending', 'Waiting for SM Projects on the goodwill request');
  perform app.require(p_on is not null and p_on <= (now() at time zone app.tz())::date, 'Enter the date (not in the future)');
  perform app.require(coalesce(p_cost, 0) >= 0, 'The cost cannot be negative');
  perform app.require(p_from is null or p_from in ('dimo_stock', 'manufacturer'), 'Choose where the replacement came from');
  select * into w from public.warranties where id = c.warranty_id;
  update public.warranty_claims set rectified_on = p_on, cost_amount = coalesce(p_cost, 0), rectification_note = nullif(btrim(p_note), ''),
    repaired_from = p_from where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'rectified', concat_ws(' · ', 'Rectified ' || to_char(p_on, 'DD Mon YYYY'),
          case p_from when 'dimo_stock' then 'from DIMO stock' when 'manufacturer' then 'with the manufacturer''s replacement' end,
          case when coalesce(p_cost, 0) > 0 then 'cost ' || app.fmt_money(p_cost, w.currency) end, nullif(btrim(p_note), '')));
  perform app.notify_many(app.role_users('operations_exec', 'senior_elec_engineer'), 'warranty_claim_rectified', 'Claim rectified – confirm with the customer and close',
    app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;
revoke execute on function public.record_claim_rectified(uuid, date, numeric, text, text) from public, anon;
grant execute on function public.record_claim_rectified(uuid, date, numeric, text, text) to authenticated, service_role;

-- A customer claim can be closed while its manufacturer claim is still running
create or replace function public.close_warranty_claim(p_id uuid, p_status text, p_on date, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims; w public.warranties;
begin
  perform app.require(app.is_warranty_desk(), 'Only the Operations Executive or the Senior Electrical Engineer close claims');
  c := app.claim_for_update(p_id);
  perform app.require(p_status in ('closed', 'cancelled'), 'Choose closed or cancelled');
  perform app.require(p_status = 'cancelled' or c.rectified_on is not null, 'Record the rectification first');
  perform app.require(p_status = 'closed' or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  perform app.require(p_on is not null, 'Enter the date');
  select * into w from public.warranties where id = c.warranty_id;
  update public.warranty_claims set status = p_status, closed_on = p_on, close_note = nullif(btrim(p_note), '') where id = c.id;
  if p_status = 'cancelled' then
    update public.approvals set status = 'cancelled', decided_at = now()
     where kind = 'warranty_goodwill' and entity_id = c.id and status = 'pending';
  end if;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, p_status, concat_ws(' · ', initcap(p_status) || ' ' || to_char(p_on, 'DD Mon YYYY'),
          case when c.supplier_status = 'raised' then 'manufacturer claim ' || c.supplier_ref || ' still open – recovery recorded when settled' end,
          nullif(btrim(p_note), '')));
  perform app.notify_many(array[w.owner_id, c.reported_by], 'warranty_claim_closed', 'Warranty claim ' || p_status || ' – follow up with the customer',
    app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;

-- ---------------------------------------------------------------------------
-- Alerts (every 15 minutes from 08:00)
-- ---------------------------------------------------------------------------
create or replace function public.manufacturer_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  n int := 0;
  officer uuid[] := app.role_users('senior_elec_engineer');
  ops uuid[] := app.role_users('operations_exec');
  smp uuid[] := app.role_users('sm_projects');
  r record;
  rm public.manufacturer_claims;
  lvl int;
  open_n int; to_recover numeric;
begin
  if loc::time < time '08:00' then return 0; end if;

  -- Registration with the manufacturer: 14 days before, on the day, overdue (+ SM Projects)
  for r in select g.*, m.name as mname, w.project_name, w.customer from public.warranty_registrations g
             join public.manufacturers m on m.id = g.manufacturer_id join public.warranties w on w.id = g.warranty_id
            where g.registered_on is null and w.status = 'active' and g.due_date - today <= 14 loop
    lvl := case when r.due_date < today then 3 when r.due_date = today then 2 else 1 end;
    if lvl > r.alert_level then
      perform app.notify_many(ops || officer || case when lvl = 3 then smp else '{}'::uuid[] end, 'warranty_registration',
        case lvl when 3 then 'Manufacturer registration overdue' when 2 then 'Register the project with the manufacturer today' else 'Manufacturer registration due' end
          || ' – ' || r.mname,
        format('%s – %s · due %s · DIMO may lose the manufacturer''s warranty if not registered', r.project_name, r.customer, to_char(r.due_date, 'DD Mon YYYY')),
        'normal', 'warranty', r.warranty_id, app.warranty_url(r.warranty_id));
      update public.warranty_registrations set alert_level = lvl where id = r.id; n := n + 1;
    end if;
  end loop;

  -- Covered claim still under the supplier's warranty with no manufacturer claim after 5 working days
  for r in select c.id, c.warranty_id, c.code, c.decided_at from public.warranty_claims c
             join public.warranty_lines l on l.id = c.line_id
            where c.decision = 'covered' and c.goodwill_status is distinct from 'pending' and c.supplier_status = 'none' and not c.rma_alerted
              and c.status <> 'cancelled' and l.supplier_end is not null and l.supplier_end >= (c.logged_at at time zone app.tz())::date loop
    if app.work_minutes_between(r.decided_at, p_at) / app.working_minutes_per_day() >= 5 then
      perform app.notify_many(officer, 'rma_due', 'Raise the manufacturer claim – item is under the supplier''s warranty',
        app.claim_head((select c from public.warranty_claims c where c.id = r.id)), 'normal', 'warranty_claim', r.id, app.claim_url(r.id));
      update public.warranty_claims set rma_alerted = true where id = r.id; n := n + 1;
    end if;
  end loop;

  for rm in select * from public.manufacturer_claims where status = 'open' loop
    if rm.contacted_on is not null and rm.rma_no is null and not rm.ack_alerted and today - rm.contacted_on >= 7 then
      perform app.notify_many(officer, 'rma_followup', 'No RMA number 7 days after contacting the manufacturer', app.rma_head(rm), 'normal', 'rma', rm.id, app.rma_url(rm.id));
      update public.manufacturer_claims set ack_alerted = true where id = rm.id; n := n + 1;
    end if;
    if rm.returned_on is not null and rm.decision is null and not rm.decision_alerted and today - rm.returned_on >= 30 then
      perform app.notify_many(officer || smp, 'rma_followup', 'No manufacturer decision 30 days after the goods were returned', app.rma_head(rm),
        'normal', 'rma', rm.id, app.rma_url(rm.id));
      update public.manufacturer_claims set decision_alerted = true where id = rm.id; n := n + 1;
    end if;
    if rm.decision in ('accepted', 'partly') and rm.received_on is null and not rm.receipt_alerted and today - rm.decided_on >= 30 then
      perform app.notify_many(ops || officer || smp, 'rma_followup', 'Replacement / credit note not received 30 days after acceptance', app.rma_head(rm),
        'normal', 'rma', rm.id, app.rma_url(rm.id));
      update public.manufacturer_claims set receipt_alerted = true where id = rm.id; n := n + 1;
    end if;
  end loop;

  -- Monday: open manufacturer claims and value still to recover
  if extract(isodow from loc) = 1 then
    select count(*), coalesce(sum(i.v), 0) into open_n, to_recover
      from public.manufacturer_claims m
      left join lateral (select sum(value_claimed) as v from public.manufacturer_claim_items where rma_id = m.id) i on true
     where m.status = 'open';
    if open_n > 0 then
      perform app.notify_many(smp || officer || app.role_users('gm'), 'rma_weekly', 'Manufacturer claims: weekly summary',
        format('%s open manufacturer claims · %s claimed and not yet recovered', open_n, app.fmt_money(to_recover, 'LKR')),
        'normal', null, null, '/warranty?tab=rma', format('rmaweek:%s', today), false);
      n := n + 1;
    end if;
  end if;
  return n;
end $$;
revoke execute on function public.manufacturer_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.manufacturer_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('manufacturer-tick', '*/15 * * * *', 'select public.manufacturer_tick()');
  end if;
end $$;

revoke execute on function public.save_manufacturer(uuid, jsonb), public.set_line_manufacturer(uuid, uuid), public.record_registration(uuid, date, text, text),
  public.create_manufacturer_claim(uuid, jsonb, text), public.update_manufacturer_claim(uuid, text, jsonb), public.decide_rejected_rma(uuid, text, text),
  public.close_manufacturer_claim(uuid, text, text) from public, anon;
grant execute on function public.save_manufacturer(uuid, jsonb), public.set_line_manufacturer(uuid, uuid), public.record_registration(uuid, date, text, text),
  public.create_manufacturer_claim(uuid, jsonb, text), public.update_manufacturer_claim(uuid, text, jsonb), public.decide_rejected_rma(uuid, text, text),
  public.close_manufacturer_claim(uuid, text, text) to authenticated;

-- Manufacturer claim documents and registration certificates (copied from 20260930000051)
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
  else
    return r = 'gm';
  end case;
end $$;
