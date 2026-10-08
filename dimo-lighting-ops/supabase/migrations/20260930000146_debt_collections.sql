-- Part collections of a debtor invoice, recorded by the Operations Executive with a note.
--  * Each collection: amount, date, reference and a note; counted against the outstanding amount of the latest upload.
--  * Total collected and balance kept on the debt; status partially collected, or collected once the balance is nil.
--  * A wrong entry is cancelled with the reason (kept in the history).
--  * Next upload: if the outstanding amount went down (the accounts system took the payments in) the part collections
--    are history and the debt is outstanding again at the new amount; otherwise they still count against it.

alter table public.debt_log drop constraint if exists debt_log_kind_check;
alter table public.debt_log add constraint debt_log_kind_check check (kind in ('status', 'legal', 'upload', 'edit', 'collection'));

create table if not exists public.debt_collections (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts (id) on delete cascade,
  amount numeric(16, 2) not null check (amount > 0),
  collected_on date not null,
  ref text,
  note text not null,
  against_upload_id uuid references public.debt_uploads (id),
  outstanding_before numeric(16, 2) not null,
  recorded_by uuid not null default auth.uid() references public.profiles (id),
  recorded_at timestamptz not null default now(),
  voided_by uuid references public.profiles (id),
  voided_at timestamptz,
  void_reason text
);
create index if not exists debt_collections_debt on public.debt_collections (debt_id, recorded_at);
alter table public.debt_collections enable row level security;
drop policy if exists debt_collections_read on public.debt_collections;
create policy debt_collections_read on public.debt_collections for select to authenticated using (exists (select 1 from public.debts d where d.id = debt_id));
grant select on public.debt_collections to authenticated;

-- Collected so far against the outstanding amount of the latest upload
create or replace function app.debt_collected(p_debt uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.amount), 0) from public.debt_collections c join public.debts d on d.id = c.debt_id
   where c.debt_id = p_debt and c.voided_at is null and c.against_upload_id is not distinct from d.last_upload_id
$$;

create or replace function app.debt_after_collection(p_debt uuid, p_note text, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.debts; tot numeric; st text;
begin
  select * into d from public.debts where id = p_debt;
  tot := app.debt_collected(d.id);
  st := case when tot <= 0 then case when d.status in ('partially_collected', 'collected') then 'outstanding' else d.status end
             when tot >= d.amount then 'collected' else 'partially_collected' end;
  update public.debts set collected_amount = nullif(tot, 0),
    collected_date = (select max(collected_on) from public.debt_collections c where c.debt_id = d.id and c.voided_at is null and c.against_upload_id is not distinct from d.last_upload_id),
    collected_ref = (select c.ref from public.debt_collections c where c.debt_id = d.id and c.voided_at is null and c.ref is not null order by c.recorded_at desc limit 1),
    status = st, status_note = p_note, last_status_at = now()
  where id = d.id;
  insert into public.debt_log (debt_id, kind, from_status, to_status, note) values (d.id, 'collection', d.status, st, p_note);
  if d.sales_person_id is not null then
    perform app.notify(d.sales_person_id, 'debt_collection', p_kind || ' – ' || d.invoice_no,
      format('%s · %s', d.client_name, p_note), 'normal', 'debt', d.id, '/debtors/' || d.id);
  end if;
end $$;

-- Operations Executive: amount collected (part or full) with a note
create or replace function public.record_debt_collection(p_debt uuid, p_amount numeric, p_date date, p_note text, p_ref text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.debts; done numeric; cid uuid; bal numeric;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive records collections');
  select * into d from public.debts where id = p_debt for update;
  perform app.require(d.id is not null, 'Debt not found');
  perform app.require(d.status not in ('cleared', 'collected_confirmed'), 'This invoice is already cleared');
  perform app.require(p_amount is not null and p_amount > 0, 'Enter the amount collected');
  perform app.require(p_date is not null and p_date <= (now() at time zone app.tz())::date, 'Enter the collection date (today or earlier)');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Add a note (how it was paid, cheque / transfer, what remains)');
  done := app.debt_collected(d.id);
  bal := d.amount - done;
  perform app.require(p_amount <= bal, format('More than the balance of %s', app.fmt_money(bal, d.currency)));
  insert into public.debt_collections (debt_id, amount, collected_on, ref, note, against_upload_id, outstanding_before)
  values (d.id, p_amount, p_date, nullif(btrim(p_ref), ''), btrim(p_note), d.last_upload_id, bal)
  returning id into cid;
  perform app.debt_after_collection(d.id,
    format('%s collected on %s%s · balance %s · %s', app.fmt_money(p_amount, d.currency), to_char(p_date, 'DD Mon YYYY'),
      case when nullif(btrim(p_ref), '') is not null then ' (ref ' || btrim(p_ref) || ')' else '' end, app.fmt_money(bal - p_amount, d.currency), btrim(p_note)),
    case when p_amount >= bal then 'Debt collected in full' else 'Part payment collected' end);
  return cid;
end $$;

-- Operations Executive: cancel a wrong entry
create or replace function public.void_debt_collection(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.debt_collections; d public.debts;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive corrects collections');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select * into c from public.debt_collections where id = p_id for update;
  perform app.require(c.id is not null and c.voided_at is null, 'Collection not found or already cancelled');
  select * into d from public.debts where id = c.debt_id for update;
  update public.debt_collections set voided_by = auth.uid(), voided_at = now(), void_reason = btrim(p_reason) where id = c.id;
  perform app.debt_after_collection(d.id, format('Collection of %s on %s cancelled · %s', app.fmt_money(c.amount, d.currency), to_char(c.collected_on, 'DD Mon YYYY'), btrim(p_reason)),
    'Collection entry cancelled');
end $$;

-- New upload of the debt
create or replace function app.debts_collections_on_upload() returns trigger
language plpgsql security definer set search_path = public as $$
declare tot numeric;
begin
  if new.last_upload_id is distinct from old.last_upload_id then
    select coalesce(sum(amount), 0) into tot from public.debt_collections
     where debt_id = new.id and voided_at is null and against_upload_id is not distinct from old.last_upload_id;
    if tot > 0 then
      if new.amount < old.amount then
        -- the accounts system took the payments in: start again from the new outstanding amount
        if new.status in ('partially_collected', 'collected') and new.amount > 0 then
          new.status := 'outstanding';
          new.collected_amount := null;
        end if;
      else
        -- not yet in the accounts system: the part collections still count
        update public.debt_collections set against_upload_id = new.last_upload_id
         where debt_id = new.id and voided_at is null and against_upload_id is not distinct from old.last_upload_id;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists debts_collections_on_upload on public.debts;
create trigger debts_collections_on_upload before update of last_upload_id on public.debts for each row execute function app.debts_collections_on_upload();

revoke execute on function public.record_debt_collection(uuid, numeric, date, text, text) from public, anon;
grant execute on function public.record_debt_collection(uuid, numeric, date, text, text) to authenticated, service_role;
revoke execute on function public.void_debt_collection(uuid, text) from public, anon;
grant execute on function public.void_debt_collection(uuid, text) to authenticated, service_role;
