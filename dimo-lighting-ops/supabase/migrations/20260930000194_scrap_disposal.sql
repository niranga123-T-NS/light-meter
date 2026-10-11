-- Scrap disposal: scrap material from a project's site store, from the Project returns, or found on site (e.g. old fittings removed).
--  * Raised by the SEE (any project, or the central store) or the project's Assistant Engineers, with the items, quantities, condition,
--    where the scrap is kept, why it is scrap, and photos.
--  * Two ways to dispose: free of charge (FOC / no cost – who takes it and the reason) or sell (quotations attached; the best quote is
--    chosen, a lower one needs the reason).
--  * Approval: SM Projects, then the DGM / GM. Either can return it for changes or reject it (reason required).
--  * After approval the SEE / AE records the disposal with the evidence (gate pass, receipt, photo); for a sale the amount received and
--    the receipt / invoice reference. Store items are booked out of the site store, Project-returns items out of the returns stock.
--  * Alerts to the AEs and the SEE: material idle in the site store for 30+ days, offcuts building up (repeated part returns),
--    damaged Project-returns items, approved scrap not yet disposed, and requests waiting too long for approval.

create table public.scrap_disposals (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid references public.exec_projects (id) on delete set null,
  location text not null,
  scrap_reason text not null,
  method text not null check (method in ('foc', 'sell')),
  foc_to text,
  foc_reason text,
  selected_quote_id uuid,
  quote_reason text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_smp', 'pending_dgm', 'approved', 'returned', 'rejected', 'disposed', 'cancelled')),
  requested_by uuid not null default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  submitted_at timestamptz,
  smp_by uuid references public.profiles (id),
  smp_at timestamptz,
  smp_note text,
  dgm_by uuid references public.profiles (id),
  dgm_at timestamptz,
  dgm_note text,
  return_note text,
  returned_by uuid references public.profiles (id),
  returned_at timestamptz,
  disposed_on date,
  disposed_by uuid references public.profiles (id),
  disposed_at timestamptz,
  disposal_ref text,
  amount_received numeric,
  disposal_note text,
  cancel_reason text,
  updated_at timestamptz not null default now()
);
create index on public.scrap_disposals (exec_project_id);
create index on public.scrap_disposals (status);

create table public.scrap_lines (
  id uuid primary key default gen_random_uuid(),
  disposal_id uuid not null references public.scrap_disposals (id) on delete cascade,
  seq int not null default 0,
  source text not null check (source in ('store', 'returns', 'other')),
  return_item_id uuid references public.project_return_items (id),
  item text not null,
  unit text not null,
  qty numeric not null check (qty > 0),
  condition text not null check (condition in ('damaged', 'offcut', 'removed', 'obsolete', 'expired', 'other')),
  note text
);
create index on public.scrap_lines (disposal_id);

create table public.scrap_quotes (
  id uuid primary key default gen_random_uuid(),
  disposal_id uuid not null references public.scrap_disposals (id) on delete cascade,
  buyer text not null,
  amount_lkr numeric not null check (amount_lkr > 0),
  valid_until date,
  note text,
  added_by uuid not null default auth.uid() references public.profiles (id),
  added_at timestamptz not null default now()
);
create index on public.scrap_quotes (disposal_id);
alter table public.scrap_disposals add constraint scrap_disposals_selected_quote_fkey
  foreign key (selected_quote_id) references public.scrap_quotes (id) on delete set null;

-- Who sees a scrap request: the requester, the SEE, SM Projects, GM / DGM, Operations, and the project's team
create or replace function app.can_read_scrap(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.scrap_disposals d where d.id = p_id
                 and (d.requested_by = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec')
                      or (d.exec_project_id is not null and app.is_exec_team(d.exec_project_id))))
$$;
-- Who raises / edits / records: the SEE, or an AE of the project
create or replace function app.can_raise_scrap(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('senior_elec_engineer') or (p_exec is not null and app.is_project_ae(p_exec))
$$;

alter table public.scrap_disposals enable row level security;
alter table public.scrap_lines enable row level security;
alter table public.scrap_quotes enable row level security;
create policy scrap_disposals_read on public.scrap_disposals for select to authenticated using (app.can_read_scrap(id));
create policy scrap_lines_read on public.scrap_lines for select to authenticated using (app.can_read_scrap(disposal_id));
create policy scrap_quotes_read on public.scrap_quotes for select to authenticated using (app.can_read_scrap(disposal_id));
grant select on public.scrap_disposals, public.scrap_lines, public.scrap_quotes to authenticated;

create or replace function app.scrap_head(d public.scrap_disposals) returns text
language sql stable security definer set search_path = public as $$
  select concat_ws(' · ', d.code, case when d.exec_project_id is not null then app.exec_head(d.exec_project_id) else d.location end,
                   case d.method when 'sell' then 'sell' else 'free of charge' end)
$$;

-- Quantity of an item (DIMO custody) in the project's site store, less what other open scrap requests already hold
create or replace function app.scrap_store_free(p_exec uuid, p_item text, p_except uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(case when s.kind in ('receipt', 'return', 'transfer_in') then s.qty else -s.qty end)
                     from public.store_moves s where s.exec_project_id = p_exec and s.custody = 'dimo' and lower(btrim(s.item)) = lower(btrim(p_item))), 0)
       - coalesce((select sum(l.qty) from public.scrap_lines l join public.scrap_disposals d on d.id = l.disposal_id
                    where d.exec_project_id = p_exec and l.source = 'store' and lower(btrim(l.item)) = lower(btrim(p_item))
                      and d.id is distinct from p_except and d.status in ('draft', 'pending_smp', 'pending_dgm', 'approved', 'returned')), 0)
$$;
-- Project-returns quantity available for scrap: balance less material-request reservations and other open scrap requests
create or replace function app.scrap_returns_free(p_item uuid, p_except uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select app.return_available(p_item)
       - coalesce((select sum(l.qty) from public.scrap_lines l join public.scrap_disposals d on d.id = l.disposal_id
                    where l.return_item_id = p_item and d.id is distinct from p_except
                      and d.status in ('draft', 'pending_smp', 'pending_dgm', 'approved', 'returned')), 0)
$$;

-- Items that can be scrapped from a project's site store (DIMO custody)
create or replace function public.scrap_store_items(p_exec uuid)
returns table (item text, unit text, balance numeric, free numeric, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.can_raise_scrap(p_exec) or app.has_role('sm_projects', 'gm'), 'Not on this project');
  return query
    select min(s.item), min(s.unit), sum(case when s.kind in ('receipt', 'return', 'transfer_in') then s.qty else -s.qty end),
           app.scrap_store_free(p_exec, min(s.item), null), max(s.at)
      from public.store_moves s where s.exec_project_id = p_exec and s.custody = 'dimo'
     group by lower(btrim(s.item))
    having sum(case when s.kind in ('receipt', 'return', 'transfer_in') then s.qty else -s.qty end) > 0
     order by 1;
end $$;

-- Create or edit (draft or returned). p: {exec_project_id, location, scrap_reason, method, foc_to, foc_reason, quote_reason,
--   lines: [{source, return_item_id, item, unit, qty, condition, note}]}
create or replace function public.save_scrap_disposal(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.scrap_disposals; e uuid := nullif(p ->> 'exec_project_id', '')::uuid; l jsonb; k int := 0; q numeric; src text; ri public.project_return_items;
        did uuid;
begin
  if p_id is not null then
    select * into d from public.scrap_disposals where id = p_id for update;
    perform app.require(found, 'Scrap request not found');
    perform app.require(d.status in ('draft', 'returned'), 'Only a draft or a returned request can be changed');
    perform app.require(d.requested_by = auth.uid() or app.can_raise_scrap(d.exec_project_id), 'Not allowed');
    e := d.exec_project_id;   -- the project does not change
  else
    perform app.require(app.can_raise_scrap(e), 'The SEE or the project''s Assistant Engineers raise scrap disposals');
    perform app.require(e is null or exists (select 1 from public.exec_projects where id = e), 'Project not found');
  end if;
  perform app.require(coalesce(btrim(p ->> 'location'), '') <> '', 'Where is the scrap kept?');
  perform app.require(coalesce(btrim(p ->> 'scrap_reason'), '') <> '', 'Why is this material scrap?');
  perform app.require(p ->> 'method' in ('foc', 'sell'), 'Choose: free of charge (no cost) or sell');
  perform app.require(jsonb_array_length(coalesce(p -> 'lines', '[]')) > 0, 'Add the scrap items');
  if p_id is null then
    insert into public.scrap_disposals (code, exec_project_id, location, scrap_reason, method)
    values (app.next_code('SCR'), e, btrim(p ->> 'location'), btrim(p ->> 'scrap_reason'), p ->> 'method') returning id into did;
  else
    did := p_id;
  end if;
  update public.scrap_disposals set location = btrim(p ->> 'location'), scrap_reason = btrim(p ->> 'scrap_reason'), method = p ->> 'method',
         foc_to = case when p ->> 'method' = 'foc' then nullif(btrim(p ->> 'foc_to'), '') end,
         foc_reason = case when p ->> 'method' = 'foc' then nullif(btrim(p ->> 'foc_reason'), '') end,
         quote_reason = case when p ->> 'method' = 'sell' then nullif(btrim(p ->> 'quote_reason'), '') end,
         updated_at = now()
   where id = did;
  delete from public.scrap_lines where disposal_id = did;
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    k := k + 1;
    src := coalesce(l ->> 'source', 'other');
    q := nullif(l ->> 'qty', '')::numeric;
    perform app.require(src in ('store', 'returns', 'other'), format('Line %s: unknown source', k));
    perform app.require(q is not null and q > 0, format('Line %s: enter the quantity', k));
    perform app.require(coalesce(l ->> 'condition', '') in ('damaged', 'offcut', 'removed', 'obsolete', 'expired', 'other'), format('Line %s: choose the condition', k));
    if src = 'store' then
      perform app.require(e is not null, format('Line %s: site store items need the project', k));
      perform app.require(q <= app.scrap_store_free(e, l ->> 'item', did),
        format('Line %s: only %s %s of %s is free in the site store', k, greatest(app.scrap_store_free(e, l ->> 'item', did), 0), l ->> 'unit', l ->> 'item'));
      insert into public.scrap_lines (disposal_id, seq, source, item, unit, qty, condition, note)
      values (did, k, 'store', btrim(l ->> 'item'), btrim(l ->> 'unit'), q, l ->> 'condition', nullif(btrim(l ->> 'note'), ''));
    elsif src = 'returns' then
      perform app.require(app.has_role('senior_elec_engineer'), format('Line %s: the SEE scraps Project-returns items', k));
      select * into ri from public.project_return_items where id = nullif(l ->> 'return_item_id', '')::uuid and not removed;
      perform app.require(ri.id is not null, format('Line %s: Project-returns item not found', k));
      perform app.require(q <= app.scrap_returns_free(ri.id, did), format('Line %s: only %s %s of %s is free in the Project returns', k, greatest(app.scrap_returns_free(ri.id, did), 0), ri.unit, ri.item));
      insert into public.scrap_lines (disposal_id, seq, source, return_item_id, item, unit, qty, condition, note)
      values (did, k, 'returns', ri.id, ri.item, ri.unit, q, l ->> 'condition', nullif(btrim(l ->> 'note'), ''));
    else
      perform app.require(coalesce(btrim(l ->> 'item'), '') <> '', format('Line %s: describe the item', k));
      perform app.require(coalesce(btrim(l ->> 'unit'), '') <> '', format('Line %s: enter the unit', k));
      insert into public.scrap_lines (disposal_id, seq, source, item, unit, qty, condition, note)
      values (did, k, 'other', btrim(l ->> 'item'), btrim(l ->> 'unit'), q, l ->> 'condition', nullif(btrim(l ->> 'note'), ''));
    end if;
  end loop;
  return did;
end $$;

-- Quotations (sell): added while the request is a draft or returned
create or replace function public.add_scrap_quote(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.scrap_disposals; qid uuid;
begin
  select * into d from public.scrap_disposals where id = p_id;
  perform app.require(found, 'Scrap request not found');
  perform app.require(d.status in ('draft', 'returned'), 'Quotations are added before the request is submitted');
  perform app.require(d.requested_by = auth.uid() or app.can_raise_scrap(d.exec_project_id), 'Not allowed');
  perform app.require(coalesce(btrim(p ->> 'buyer'), '') <> '', 'Who is the buyer?');
  perform app.require(nullif(p ->> 'amount_lkr', '')::numeric > 0, 'Enter the quoted amount');
  insert into public.scrap_quotes (disposal_id, buyer, amount_lkr, valid_until, note)
  values (p_id, btrim(p ->> 'buyer'), (p ->> 'amount_lkr')::numeric, nullif(p ->> 'valid_until', '')::date, nullif(btrim(p ->> 'note'), ''))
  returning id into qid;
  return qid;
end $$;

create or replace function public.remove_scrap_quote(p_quote uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.scrap_disposals;
begin
  select x.* into d from public.scrap_disposals x join public.scrap_quotes q on q.disposal_id = x.id where q.id = p_quote;
  perform app.require(d.id is not null, 'Quotation not found');
  perform app.require(d.status in ('draft', 'returned'), 'The request is already submitted');
  perform app.require(d.requested_by = auth.uid() or app.can_raise_scrap(d.exec_project_id), 'Not allowed');
  update public.scrap_disposals set selected_quote_id = null where id = d.id and selected_quote_id = p_quote;
  delete from public.scrap_quotes where id = p_quote;
end $$;

-- Submit to SM Projects. p_quote: the chosen quotation (sell); p_reason: why, when it is not the highest
create or replace function public.submit_scrap_disposal(p_id uuid, p_quote uuid default null, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.scrap_disposals; l public.scrap_lines; best numeric; chosen numeric;
begin
  select * into d from public.scrap_disposals where id = p_id for update;
  perform app.require(found, 'Scrap request not found');
  perform app.require(d.status in ('draft', 'returned'), 'Already submitted');
  perform app.require(d.requested_by = auth.uid() or app.can_raise_scrap(d.exec_project_id), 'Not allowed');
  perform app.require(exists (select 1 from public.scrap_lines where disposal_id = p_id), 'Add the scrap items');
  perform app.require(exists (select 1 from public.attachments where entity_type = 'scrap_disposal' and entity_id = p_id and kind = 'scrap_photo' and archived_at is null),
    'Add at least one photo of the scrap');
  -- quantities are still free (the store may have moved since the draft)
  for l in select * from public.scrap_lines where disposal_id = p_id loop
    if l.source = 'store' then
      perform app.require(l.qty <= app.scrap_store_free(d.exec_project_id, l.item, p_id), format('Only %s %s of %s is free in the site store', greatest(app.scrap_store_free(d.exec_project_id, l.item, p_id), 0), l.unit, l.item));
    elsif l.source = 'returns' then
      perform app.require(l.qty <= app.scrap_returns_free(l.return_item_id, p_id), format('Only %s %s of %s is free in the Project returns', greatest(app.scrap_returns_free(l.return_item_id, p_id), 0), l.unit, l.item));
    end if;
  end loop;
  if d.method = 'foc' then
    perform app.require(coalesce(d.foc_to, '') <> '', 'Free of charge: who takes the scrap?');
    perform app.require(coalesce(d.foc_reason, '') <> '', 'Free of charge: give the reason it is not sold');
  else
    perform app.require(exists (select 1 from public.scrap_quotes where disposal_id = p_id), 'Sell: add the quotations');
    perform app.require(not exists (select 1 from public.scrap_quotes q where q.disposal_id = p_id
                                     and not exists (select 1 from public.attachments a where a.entity_type = 'scrap_quote' and a.entity_id = q.id and a.archived_at is null)),
      'Sell: attach the quotation document to every quotation');
    perform app.require(p_quote is not null and exists (select 1 from public.scrap_quotes where id = p_quote and disposal_id = p_id), 'Sell: choose the quotation to accept');
    select max(amount_lkr) into best from public.scrap_quotes where disposal_id = p_id;
    select amount_lkr into chosen from public.scrap_quotes where id = p_quote;
    d.quote_reason := coalesce(nullif(btrim(p_reason), ''), d.quote_reason);
    perform app.require(chosen >= best or coalesce(d.quote_reason, '') <> '', 'The chosen quotation is not the highest – give the reason');
  end if;
  update public.scrap_disposals set status = 'pending_smp', submitted_at = now(), selected_quote_id = case when d.method = 'sell' then p_quote end,
         quote_reason = case when d.method = 'sell' and chosen < best then d.quote_reason end,
         smp_by = null, smp_at = null, smp_note = null, dgm_by = null, dgm_at = null, dgm_note = null, updated_at = now()
   where id = p_id;
  perform app.notify_many(app.role_users('sm_projects'), 'scrap', 'Scrap disposal to approve', app.scrap_head(d), 'normal',
    'scrap_disposal', p_id, '/execution/scrap/' || p_id, null, true);
end $$;

-- SM Projects, then the DGM / GM: approve, return for changes, or reject (reason required to return or reject)
create or replace function public.decide_scrap_disposal(p_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.scrap_disposals; team uuid[];
begin
  select * into d from public.scrap_disposals where id = p_id for update;
  perform app.require(found, 'Scrap request not found');
  perform app.require(p_action in ('approve', 'return', 'reject'), 'Approve, return or reject');
  perform app.require((d.status = 'pending_smp' and app.has_role('sm_projects')) or (d.status = 'pending_dgm' and app.has_role('gm')),
    case d.status when 'pending_smp' then 'Waiting for SM Projects' when 'pending_dgm' then 'Waiting for the DGM / GM' else 'Not waiting for approval' end);
  perform app.require(p_action = 'approve' or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  team := array(select unnest(array[d.requested_by]) union select unnest(app.role_users('senior_elec_engineer'))
                union select unnest(case when d.exec_project_id is not null then app.project_aes(d.exec_project_id) else '{}'::uuid[] end));
  if p_action = 'approve' and d.status = 'pending_smp' then
    update public.scrap_disposals set status = 'pending_dgm', smp_by = auth.uid(), smp_at = now(), smp_note = nullif(btrim(p_note), ''), updated_at = now() where id = p_id;
    perform app.notify_many(app.role_users('gm'), 'scrap', 'Scrap disposal to approve', app.scrap_head(d) || ' · approved by SM Projects', 'normal',
      'scrap_disposal', p_id, '/execution/scrap/' || p_id, null, true);
  elsif p_action = 'approve' then
    update public.scrap_disposals set status = 'approved', dgm_by = auth.uid(), dgm_at = now(), dgm_note = nullif(btrim(p_note), ''), updated_at = now() where id = p_id;
    perform app.notify_many(team, 'scrap', 'Scrap disposal approved – dispose and record it', app.scrap_head(d), 'normal', 'scrap_disposal', p_id, '/execution/scrap/' || p_id);
    if d.method = 'sell' then
      perform app.notify_many(app.role_users('operations_exec'), 'scrap', 'Scrap sale approved – invoice the buyer',
        app.scrap_head(d) || ' · ' || coalesce((select buyer || ' · ' || app.fmt_money(amount_lkr, 'LKR') from public.scrap_quotes where id = d.selected_quote_id), ''),
        'normal', 'scrap_disposal', p_id, '/execution/scrap/' || p_id);
    end if;
  else
    update public.scrap_disposals set status = case p_action when 'return' then 'returned' else 'rejected' end,
           return_note = btrim(p_note), returned_by = auth.uid(), returned_at = now(),
           smp_by = case when d.status = 'pending_smp' then auth.uid() else smp_by end, smp_at = case when d.status = 'pending_smp' then now() else smp_at end,
           dgm_by = case when d.status = 'pending_dgm' then auth.uid() else dgm_by end, dgm_at = case when d.status = 'pending_dgm' then now() else dgm_at end,
           updated_at = now()
     where id = p_id;
    perform app.notify_many(team, 'scrap', case p_action when 'return' then 'Scrap disposal returned for changes' else 'Scrap disposal rejected' end,
      app.scrap_head(d) || ' · ' || btrim(p_note), 'normal', 'scrap_disposal', p_id, '/execution/scrap/' || p_id);
  end if;
end $$;

-- After approval: record the disposal. p: {date, ref, amount, note}. Evidence (gate pass, receipt, photo) must be attached first.
create or replace function public.record_scrap_disposal(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d public.scrap_disposals; l public.scrap_lines; dt date := nullif(p ->> 'date', '')::date; amt numeric := nullif(p ->> 'amount', '')::numeric;
begin
  select * into d from public.scrap_disposals where id = p_id for update;
  perform app.require(found, 'Scrap request not found');
  perform app.require(d.status = 'approved', 'Only an approved scrap disposal is recorded');
  perform app.require(d.requested_by = auth.uid() or app.can_raise_scrap(d.exec_project_id), 'The SEE or the project''s Assistant Engineers record the disposal');
  perform app.require(dt is not null and dt <= (now() at time zone app.tz())::date, 'Enter the date it was disposed');
  perform app.require(exists (select 1 from public.attachments where entity_type = 'scrap_disposal' and entity_id = p_id and kind = 'scrap_evidence' and archived_at is null),
    'Attach the evidence: gate pass, receipt or photo of the removal');
  if d.method = 'sell' then
    perform app.require(coalesce(btrim(p ->> 'ref'), '') <> '', 'Enter the receipt / invoice reference of the sale');
    perform app.require(amt is not null and amt > 0, 'Enter the amount received');
  end if;
  for l in select * from public.scrap_lines where disposal_id = p_id order by seq loop
    if l.source = 'store' then
      perform app.require(l.qty <= app.scrap_store_free(d.exec_project_id, l.item, p_id),
        format('Only %s %s of %s is left in the site store', greatest(app.scrap_store_free(d.exec_project_id, l.item, p_id), 0), l.unit, l.item));
      insert into public.store_moves (exec_project_id, kind, item, unit, qty, ref, note, custody)
      values (d.exec_project_id, 'transfer_out', l.item, l.unit, l.qty, d.code, 'Scrap disposal', 'dimo');
    elsif l.source = 'returns' then
      perform app.require(l.qty <= app.return_balance(l.return_item_id), format('Only %s %s of %s is left in the Project returns', app.return_balance(l.return_item_id), l.unit, l.item));
      insert into public.project_return_moves (item_id, kind, qty, exec_project_id, note)
      values (l.return_item_id, 'adjust', -l.qty, d.exec_project_id, 'Scrap disposal ' || d.code);
    end if;
  end loop;
  update public.scrap_disposals set status = 'disposed', disposed_on = dt, disposed_by = auth.uid(), disposed_at = now(),
         disposal_ref = nullif(btrim(p ->> 'ref'), ''), amount_received = case when d.method = 'sell' then amt end,
         disposal_note = nullif(btrim(p ->> 'note'), ''), updated_at = now()
   where id = p_id;
  perform app.notify_many(app.role_users('sm_projects') || app.role_users('gm') || case when d.method = 'sell' then app.role_users('operations_exec') else '{}'::uuid[] end,
    'scrap', 'Scrap disposed', app.scrap_head(d) || case when d.method = 'sell' then ' · ' || app.fmt_money(amt, 'LKR') || ' received' else '' end,
    'normal', 'scrap_disposal', p_id, '/execution/scrap/' || p_id);
end $$;

create or replace function public.cancel_scrap_disposal(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.scrap_disposals;
begin
  select * into d from public.scrap_disposals where id = p_id for update;
  perform app.require(found, 'Scrap request not found');
  perform app.require(d.status in ('draft', 'returned', 'pending_smp', 'pending_dgm', 'approved'), 'Already closed');
  perform app.require(d.requested_by = auth.uid() or app.has_role('senior_elec_engineer'), 'The requester or the SEE cancels it');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  update public.scrap_disposals set status = 'cancelled', cancel_reason = btrim(p_reason), updated_at = now() where id = p_id;
end $$;

-- Every morning: signs that scrap is building up, and scrap requests that are stuck
create or replace function public.scrap_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; wk text := to_char((p_at at time zone app.tz())::date, 'IYYY-IW'); r record; n int := 0;
        team uuid[]; d public.scrap_disposals;
begin
  -- 1. Material idle in the site store (DIMO custody) for 30+ days on an active project – once a week per project
  for r in
    with bal as (
      select s.exec_project_id, min(s.item) as item, min(s.unit) as unit, lower(btrim(s.item)) as k,
             sum(case when s.kind in ('receipt', 'return', 'transfer_in') then s.qty else -s.qty end) as balance, max(s.at) as last_store
        from public.store_moves s join public.exec_projects e on e.id = s.exec_project_id and e.status = 'active'
       where s.custody = 'dimo' group by s.exec_project_id, lower(btrim(s.item))
    ), idle as (
      select b.* from bal b
       where b.balance > 0 and b.last_store < p_at - interval '30 days'
         and not exists (select 1 from public.material_issues i where i.exec_project_id = b.exec_project_id and lower(btrim(i.item)) = b.k and i.issued_at >= p_at - interval '30 days')
         and not exists (select 1 from public.scrap_lines l join public.scrap_disposals x on x.id = l.disposal_id
                          where x.exec_project_id = b.exec_project_id and l.source = 'store' and lower(btrim(l.item)) = b.k
                            and x.status in ('draft', 'pending_smp', 'pending_dgm', 'approved', 'returned'))
    )
    select exec_project_id, count(*) as k, string_agg(format('%s %s %s', item, balance, unit), ', ' order by balance desc) as items from idle group by exec_project_id
  loop
    perform app.notify_many(array(select unnest(app.project_aes(r.exec_project_id)) union select unnest(app.role_users('senior_elec_engineer'))), 'material_warning',
      'Possible scrap building up – idle material',
      format('%s item(s) not moved for 30+ days in the site store: %s · %s. Use it, return it, or raise a scrap disposal.', r.k, left(r.items, 160), app.exec_head(r.exec_project_id)),
      'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=materials', format('scrap_idle:%s:%s', r.exec_project_id, wk));
    n := n + 1;
  end loop;
  -- 2. Offcuts building up: the same item came back to the store 3+ times in 30 days, and what came back is 10%+ of what was received
  for r in
    select s.exec_project_id, min(s.item) as item, min(s.unit) as unit, count(*) filter (where s.kind = 'return' and s.at >= p_at - interval '30 days') as backs,
           sum(s.qty) filter (where s.kind = 'return' and s.at >= p_at - interval '30 days') as back_qty,
           sum(s.qty) filter (where s.kind in ('receipt', 'transfer_in')) as received
      from public.store_moves s join public.exec_projects e on e.id = s.exec_project_id and e.status = 'active'
     where s.custody = 'dimo' group by s.exec_project_id, lower(btrim(s.item))
    having count(*) filter (where s.kind = 'return' and s.at >= p_at - interval '30 days') >= 3
       and sum(s.qty) filter (where s.kind = 'return' and s.at >= p_at - interval '30 days') >= 0.1 * nullif(sum(s.qty) filter (where s.kind in ('receipt', 'transfer_in')), 0)
  loop
    perform app.notify_many(array(select unnest(app.project_aes(r.exec_project_id)) union select unnest(app.role_users('senior_elec_engineer'))), 'material_warning',
      format('Offcuts building up – %s', r.item),
      format('%s returns to the store in 30 days (%s %s of %s received) · %s. Check for offcuts and scrap.', r.backs, r.back_qty, r.unit, r.received, app.exec_head(r.exec_project_id)),
      'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=materials', format('scrap_offcut:%s:%s:%s', r.exec_project_id, lower(r.item), wk));
    n := n + 1;
  end loop;
  -- 3. Damaged items in the Project returns for 60+ days – the SEE, once a week
  select count(*) as k, string_agg(i.item, ', ' order by i.created_at) as items into r
    from public.project_return_items i
   where not i.removed and i.condition = 'damaged' and i.created_at < p_at - interval '60 days' and app.return_balance(i.id) > 0
     and not exists (select 1 from public.scrap_lines l join public.scrap_disposals x on x.id = l.disposal_id
                      where l.return_item_id = i.id and x.status in ('draft', 'pending_smp', 'pending_dgm', 'approved', 'returned'));
  if r.k > 0 then
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'material_warning', 'Damaged items in the Project returns',
      format('%s damaged item(s) kept for 60+ days: %s. Raise a scrap disposal if they cannot be used.', r.k, left(r.items, 160)),
      'normal', null, null, '/stock?tab=returns', format('scrap_returns:%s', wk));
    n := n + 1;
  end if;
  -- 4. Approved but not disposed for 14+ days → the requester, the SEE and the AEs, once a week
  for d in select * from public.scrap_disposals where status = 'approved' and dgm_at < p_at - interval '14 days' loop
    team := array(select unnest(array[d.requested_by]) union select unnest(app.role_users('senior_elec_engineer'))
                  union select unnest(case when d.exec_project_id is not null then app.project_aes(d.exec_project_id) else '{}'::uuid[] end));
    perform app.notify_many(team, 'scrap', 'Approved scrap not yet disposed', app.scrap_head(d) || format(' · approved %s', to_char(d.dgm_at at time zone app.tz(), 'DD Mon')),
      'normal', 'scrap_disposal', d.id, '/execution/scrap/' || d.id, format('scrap_open:%s:%s', d.id, wk));
    n := n + 1;
  end loop;
  -- 5. Waiting for approval 3+ days → the approver again, once a day
  for d in select * from public.scrap_disposals where status in ('pending_smp', 'pending_dgm')
             and coalesce(case when status = 'pending_dgm' then smp_at end, submitted_at) < p_at - interval '3 days' loop
    perform app.notify_many(app.role_users(case when d.status = 'pending_smp' then 'sm_projects'::public.app_role else 'gm'::public.app_role end), 'scrap',
      'Scrap disposal waiting for your approval', app.scrap_head(d), 'normal', 'scrap_disposal', d.id, '/execution/scrap/' || d.id, format('scrap_wait:%s:%s', d.id, today));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.scrap_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.scrap_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('scrap-tick', '15 3 * * *', 'select public.scrap_tick()');   -- 08:45 Sri Lanka time
  end if;
end $$;

-- Scrap requests in the Approvals tab (SM Projects, then the DGM / GM)
CREATE OR REPLACE FUNCTION app.exec_pending_approvals()
 RETURNS TABLE(source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text, requested_at timestamp with time zone, inquiry_id uuid, url text, step text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'access_change', c.id, 'exec_access', 'Appointment change – ' || r.person_name, c.reason, c.requested_by, app.display_name(c.requested_by),
         c.requested_at, null::uuid, '/execution/access/' || r.id, 'SM Projects'
  from public.access_changes c join public.access_requests r on r.id = c.request_id
  where c.status = 'pending' and app.has_role('sm_projects')
  union all
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
  select 'exec_gate', g.id, 'exec_gate', format('%s – %s', (array['Programme approved', 'Handover to the client', 'Project closure'])[g.gate], app.exec_head(g.exec_project_id)), g.note, g.requested_by,
         app.display_name(g.requested_by), g.requested_at, null::uuid, '/execution/' || g.exec_project_id, null
  from public.exec_gates g where g.status = 'pending' and not g.legacy and app.has_role('sm_projects')
  union all
  select 'sub_cert', c.id, 'exec_sub_cert', format('Subcontractor payment %s – %s', c.code, c.subcontractor), app.exec_head(c.exec_project_id) || ' · ' || app.fmt_money(c.net, 'LKR'),
         c.prepared_by, app.display_name(c.prepared_by), coalesce(c.submitted_at, c.prepared_at), null::uuid, '/execution/sub-cert/' || c.id,
         case c.status when 'jm_requested' then 'Confirm joint measurement' when 'jm_ae' then 'JM – AE check' when 'jm_see' then 'JM – SEE approval' when 'ae_review' then 'AE check' when 'prepared' then 'SEE approval' when 'verified' then 'SM Projects' else 'Pay' end
  from public.sub_certs c
  where (c.status = 'ae_review' and app.is_project_ae(c.exec_project_id)) or (c.status = 'jm_ae' and app.is_project_ae(c.exec_project_id))
     or (c.status = 'jm_see' and app.has_role('senior_elec_engineer'))
     or (c.status = 'jm_requested' and app.can_confirm_jm(c.exec_project_id)) or (c.status = 'prepared' and app.has_role('senior_elec_engineer')) or (c.status = 'verified' and app.has_role('sm_projects'))
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
         concat_ws(' · ', 'finish ' || to_char(pg.forecast_finish, 'DD Mon YYYY'), pg.submit_note, case when (pg.billing_check ->> 'red')::int > 0 then format('%s invoice(s) %s would miss their month: %s', pg.billing_check ->> 'red', app.fmt_money((pg.billing_check ->> 'red_amount')::numeric, 'LKR'), pg.billing_note) end), pg.submitted_by, app.display_name(pg.submitted_by), pg.submitted_at, null::uuid,
         '/execution/' || pg.exec_project_id || '?tab=programme', 'SM Projects'
  from public.exec_programmes pg where pg.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'exec_boq', b.exec_project_id, 'exec_billing', case when b.version = 0 then 'Contract BOQ – ' else 'Revised contract BOQ – ' end || app.exec_head(b.exec_project_id),
         concat_ws(' · ', app.fmt_money(b.total, 'LKR'), b.submit_note), b.uploaded_by, app.display_name(b.uploaded_by), b.uploaded_at, null::uuid,
         '/execution/boq/' || b.exec_project_id, 'SM Projects'
  from public.exec_boqs b where b.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'programme_edit', pg.exec_project_id, 'exec_programme', 'Permission to edit the programme – ' || app.exec_head(pg.exec_project_id),
         pg.edit_reason, pg.edit_requested_by, app.display_name(pg.edit_requested_by), pg.edit_requested_at, null::uuid,
         '/execution/' || pg.exec_project_id || '?tab=programme', 'SM Projects'
  from public.exec_programmes pg where pg.edit_requested_at is not null and app.has_role('sm_projects')
  union all
  select 'scrap', x.id, 'scrap_disposal', format('Scrap disposal %s – %s', x.code, coalesce(app.exec_head(x.exec_project_id), x.location)),
         concat_ws(' · ', case x.method when 'sell' then 'Sell' || coalesce(' – ' || (select q.buyer || ' ' || app.fmt_money(q.amount_lkr, 'LKR') from public.scrap_quotes q where q.id = x.selected_quote_id), '')
                                         else 'Free of charge – ' || x.foc_to end, x.scrap_reason),
         x.requested_by, app.display_name(x.requested_by), coalesce(case when x.status = 'pending_dgm' then x.smp_at end, x.submitted_at), null::uuid,
         '/execution/scrap/' || x.id, case x.status when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.scrap_disposals x
  where (x.status = 'pending_smp' and app.has_role('sm_projects')) or (x.status = 'pending_dgm' and app.has_role('gm'))
$function$;

-- Photos, quotations and disposal evidence
CREATE OR REPLACE FUNCTION app.can_write_attachment(p_entity_type text, p_entity_id uuid, p_kind text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.app_role := app.my_role();
begin
  case p_entity_type
  when 'instrument' then return r = 'operations_exec' and exists (select 1 from public.instruments where id = p_entity_id);
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
  when 'stock_snapshot' then return r = 'operations_exec' and exists (select 1 from public.stock_snapshots where id = p_entity_id);
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
  when 'exec_worker' then
    return exists (select 1 from public.exec_workers x where x.id = p_entity_id and (app.has_role('senior_elec_engineer') or app.is_project_ae(x.exec_project_id)
      or (x.added_by = auth.uid() and x.verified_at is null)
      -- the crew's supervisor uploads the police report (storage checks without a kind)
      or ((p_kind is null or p_kind = 'police_report') and (x.supervisor_id = auth.uid() or x.added_by = auth.uid()))));
  when 'hse_record' then
    return exists (select 1 from public.hse_records x where x.id = p_entity_id and (app.is_exec_member(x.exec_project_id) or app.has_role('senior_elec_engineer')));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = p_entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
      or exists (select 1 from public.hse_actions a where a.report_id = x.id and a.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = p_entity_id and (x.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects')));
  when 'material_request' then
    return exists (select 1 from public.material_requests x where x.id = p_entity_id and app.is_exec_internal(x.exec_project_id) and not app.has_role('gm'))
      -- the supervisor who raised the request or acknowledges its delivery: delivery notes and photos
      or (r = 'sub_supervisor' and app.can_read_mr(p_entity_id) and (p_kind is null or p_kind in ('mr_doc', 'grn_photo', 'datasheet')));
  when 'exec_doc' then
    return exists (select 1 from public.exec_docs x where x.id = p_entity_id and x.uploaded_by = auth.uid());
  when 'design_query' then
    return exists (select 1 from public.design_queries x where x.id = p_entity_id
      and (x.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'design_manager', 'lighting_designer', 'lighting_engineer')));
  when 'snag' then
    return exists (select 1 from public.snags x where x.id = p_entity_id and (app.has_role('senior_elec_engineer') or app.is_project_ae(x.exec_project_id)));
  when 'dossier_item' then
    return exists (select 1 from public.exec_dossier x where x.id = p_entity_id and (app.has_role('senior_elec_engineer', 'operations_exec') or app.is_project_ae(x.exec_project_id)));
  when 'test_record' then
    return exists (select 1 from public.test_records x where x.id = p_entity_id and (x.performed_by = auth.uid() or app.has_role('senior_elec_engineer')));
  when 'instrument' then
    return app.has_role('senior_elec_engineer', 'operations_exec', 'sm_projects');
  when 'sub_invoice' then
    -- the copy: who recorded it, while a draft or returned · the marked-up copy: the SEE / Operations while it waits for them
    return exists (select 1 from public.sub_invoices x where x.id = p_entity_id and (
      ((p_kind is null or p_kind in ('sinv_doc', 'ipc_signed', 'measure_final')) and x.status in ('draft', 'returned')
        and (x.created_by = auth.uid() or (app.can_record_sub_invoice(x.exec_project_id) and not app.has_role('sub_supervisor'))))
      or ((p_kind is null or p_kind = 'sinv_markup') and ((x.status = 'ae_review' and app.is_project_ae(x.exec_project_id))
                                                          or (x.status = 'submitted' and app.has_role('senior_elec_engineer'))
                                                          or (x.status = 'see_approved' and app.has_role('operations_exec'))))));
  when 'sub_cert_var' then
    -- a ticked variation's IPC / sheets: as the IPC's own documents
    return exists (select 1 from public.sub_cert_variations v join public.sub_certs x on x.id = v.sub_cert_id where v.id = p_entity_id
      and (p_kind is null or p_kind = 'ipc_var') and x.status in ('draft', 'returned') and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')));
  when 'sub_invoice_var' then
    return exists (select 1 from public.sub_invoice_variations v join public.sub_invoices x on x.id = v.invoice_id where v.id = p_entity_id
      and (p_kind is null or p_kind = 'var_final') and x.status in ('draft', 'returned')
      and (x.created_by = auth.uid() or (app.can_record_sub_invoice(x.exec_project_id) and not app.has_role('sub_supervisor'))));
  when 'exec_project' then
    return (p_kind is null or p_kind in ('tpl_measurement', 'tpl_ipa', 'tpl_ipc')) and app.has_role('senior_elec_engineer')
      and exists (select 1 from public.exec_projects where id = p_entity_id);
  when 'sub_cert' then
    -- the IPC and measurement sheets: who prepared it, while a draft or returned · the marked-up copy: the AE / SEE while it waits for them
    return exists (select 1 from public.sub_certs x where x.id = p_entity_id and (
      ((p_kind is null or p_kind in ('ipc_draft', 'ipc_measure')) and x.status in ('draft', 'returned')
        and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')))
      or ((p_kind is null or p_kind = 'jm_sheet') and x.status in ('jm_scheduled', 'jm_returned')
        and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')))
      or ((p_kind is null or p_kind = 'jm_markup') and ((x.status = 'jm_ae' and app.is_project_ae(x.exec_project_id))
                                                        or (x.status = 'jm_see' and app.has_role('senior_elec_engineer'))))
      or ((p_kind is null or p_kind = 'ipc_markup') and ((x.status = 'ae_review' and app.is_project_ae(x.exec_project_id))
                                                         or (x.status = 'prepared' and app.has_role('senior_elec_engineer'))))));
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = p_entity_id and ((x.requested_by = auth.uid() and x.status = 'pending_smp') or app.has_role('sm_projects')));
  when 'scrap_disposal' then
    return exists (select 1 from public.scrap_disposals x where x.id = p_entity_id and (x.requested_by = auth.uid() or app.can_raise_scrap(x.exec_project_id))
                   and ((p_kind = 'scrap_photo' and x.status in ('draft', 'returned')) or (p_kind = 'scrap_evidence' and x.status = 'approved')));
  when 'scrap_quote' then
    return p_kind = 'scrap_quote' and exists (select 1 from public.scrap_quotes q join public.scrap_disposals x on x.id = q.disposal_id where q.id = p_entity_id
                   and x.status in ('draft', 'returned') and (x.requested_by = auth.uid() or app.can_raise_scrap(x.exec_project_id)));
  else return false;
  end case;
end $function$;

CREATE OR REPLACE FUNCTION app.can_read_attachment(a attachments)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.app_role := app.my_role(); inq uuid; st text; mode int; released timestamptz;
begin
  if r is null then return false; end if;
  if a.uploaded_by = auth.uid() then return true; end if;
  case a.entity_type
  when 'instrument' then
    return not app.is_sub();
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
  when 'stock_snapshot' then
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
    return exists (select 1 from public.exec_reports x where x.id = a.entity_id and (x.author_id = auth.uid() or app.is_exec_team(x.exec_project_id)));
  when 'exec_worker' then
    return exists (select 1 from public.exec_workers x where x.id = a.entity_id and app.can_see_worker(x));
  when 'hse_record' then
    return exists (select 1 from public.hse_records x where x.id = a.entity_id and app.can_read_exec_team(x.exec_project_id));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = a.entity_id and (x.reported_by = auth.uid() or app.is_exec_team(x.exec_project_id)
      or exists (select 1 from public.hse_actions y where y.report_id = x.id and y.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = a.entity_id and (app.is_exec_internal(x.exec_project_id) or r = 'gm'));
  when 'material_request' then
    return app.can_read_mr(a.entity_id);
  when 'exec_doc' then
    return exists (select 1 from public.exec_docs x where x.id = a.entity_id and (r in ('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec', 'design_manager', 'lighting_designer', 'lighting_engineer')
      or (app.is_exec_member(x.exec_project_id) and x.status = 'for_construction' and (x.issued_to_subs or r <> 'sub_supervisor'))));
  when 'design_query' then
    return exists (select 1 from public.design_queries x where x.id = a.entity_id
      and (app.is_exec_team(x.exec_project_id) or r in ('design_manager', 'lighting_designer', 'lighting_engineer')));
  when 'snag' then
    return exists (select 1 from public.snags x where x.id = a.entity_id and app.is_exec_team(x.exec_project_id));
  when 'dossier_item' then
    return exists (select 1 from public.exec_dossier x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
  when 'test_record' then
    return exists (select 1 from public.test_records x where x.id = a.entity_id and app.is_exec_team(x.exec_project_id));
  when 'instrument' then
    return r <> 'sub_supervisor';
  when 'sub_invoice' then
    return app.can_read_sub_invoice(a.entity_id);
  when 'sub_cert_var' then
    return exists (select 1 from public.sub_cert_variations x where x.id = a.entity_id and app.can_read_sub_cert(x.sub_cert_id));
  when 'sub_invoice_var' then
    return exists (select 1 from public.sub_invoice_variations x where x.id = a.entity_id and app.can_read_sub_invoice(x.invoice_id));
  when 'exec_project' then
    return a.kind in ('tpl_measurement', 'tpl_ipa', 'tpl_ipc') and app.can_read_exec(a.entity_id);
  when 'sub_cert' then
    return app.can_read_sub_cert(a.entity_id);
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = a.entity_id
      and (r in ('sm_projects', 'gm', 'operations_exec', 'senior_elec_engineer') or x.requested_by = auth.uid() or (x.exec_project_id is not null and app.is_exec_internal(x.exec_project_id))));
  when 'scrap_disposal' then
    return app.can_read_scrap(a.entity_id);
  when 'scrap_quote' then
    return exists (select 1 from public.scrap_quotes q where q.id = a.entity_id and app.can_read_scrap(q.disposal_id));
  else
    return r = 'gm';
  end case;
end $function$;
