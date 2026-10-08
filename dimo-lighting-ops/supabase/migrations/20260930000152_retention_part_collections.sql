-- Retentions: part collections. A collection less than the balance keeps the retention open (held / claimed as it was) –
-- it stays in the due / overdue lists and alerts with its balance – and it closes as collected only when the balance is
-- nil. Each collection is kept with its date and note; a wrong entry is cancelled with the reason.
-- Retentions closed earlier with a short collection are reopened for their balance.

create table if not exists public.retention_collections (
  id uuid primary key default gen_random_uuid(),
  retention_id uuid not null references public.retentions (id) on delete cascade,
  amount numeric(16, 2) not null check (amount > 0),
  collected_on date not null,
  note text,
  recorded_by uuid default auth.uid() references public.profiles (id),
  recorded_at timestamptz not null default now(),
  voided_by uuid references public.profiles (id),
  voided_at timestamptz,
  void_reason text
);
create index if not exists retention_collections_ret on public.retention_collections (retention_id);
alter table public.retention_collections enable row level security;
drop policy if exists retention_collections_read on public.retention_collections;
create policy retention_collections_read on public.retention_collections for select to authenticated
  using (exists (select 1 from public.retentions r where r.id = retention_id));
grant select on public.retention_collections to authenticated;

-- Existing collections become entries; short ones are reopened
insert into public.retention_collections (retention_id, amount, collected_on, note, recorded_by, recorded_at)
select r.id, r.collected_amount, coalesce(r.collected_on, r.updated_at::date), 'Recorded before part collections', r.created_by, r.updated_at
  from public.retentions r
 where r.status = 'collected' and coalesce(r.collected_amount, 0) > 0
   and not exists (select 1 from public.retention_collections c where c.retention_id = r.id);
update public.retentions set status = case when claimed_on is not null then 'claimed' else 'held' end
 where status = 'collected' and coalesce(collected_amount, 0) < retention_value;

create or replace function app.retention_after_collection(p_id uuid, p_on date) returns text
language plpgsql security definer set search_path = public as $$
declare r public.retentions; tot numeric; st text;
begin
  select * into r from public.retentions where id = p_id;
  select coalesce(sum(amount), 0) into tot from public.retention_collections where retention_id = r.id and voided_at is null;
  st := case when tot >= r.retention_value and tot > 0 then 'collected'
             when r.status = 'collected' then case when r.claimed_on is not null then 'claimed' else 'held' end
             else r.status end;
  update public.retentions set status = st, collected_amount = nullif(tot, 0),
    collected_on = (select max(collected_on) from public.retention_collections where retention_id = r.id and voided_at is null)
  where id = r.id;
  return st;
end $$;

-- Amount collected (part or full); the retention closes when nothing is left
create or replace function public.mark_retention_collected(p_id uuid, p_amount numeric, p_on date, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.retentions; bal numeric; st text;
begin
  select * into r from public.retentions where id = p_id for update;
  perform app.require(r.id is not null and app.can_edit_retention(r.id), 'Not allowed');
  perform app.require(r.status in ('held', 'claimed'), 'This retention is already closed');
  perform app.require(p_amount is not null and p_amount > 0, 'Enter the amount collected');
  perform app.require(p_on is not null, 'Enter the collection date');
  bal := r.retention_value - coalesce((select sum(amount) from public.retention_collections where retention_id = r.id and voided_at is null), 0);
  perform app.require(p_amount <= bal, format('More than the balance of %s', app.fmt_money(bal, r.currency)));
  insert into public.retention_collections (retention_id, amount, collected_on, note) values (r.id, p_amount, p_on, nullif(btrim(p_note), ''));
  st := app.retention_after_collection(r.id, p_on);
  insert into public.retention_log (retention_id, kind, note)
  values (r.id, case when st = 'collected' then 'collected' else 'part_collected' end,
          concat_ws(' · ', format('Collected %s on %s', app.fmt_money(p_amount, r.currency), to_char(p_on, 'DD Mon YYYY')),
            case when st <> 'collected' then format('balance %s', app.fmt_money(bal - p_amount, r.currency)) end, nullif(btrim(p_note), '')));
  perform app.notify_many(app.role_users('operations_exec') || r.sales_person_id, 'retention_collected',
    case when st = 'collected' then 'Retention collected: ' else 'Retention part collected: ' end || r.project_name,
    format('%s · %s%s', r.end_client, app.fmt_money(p_amount, r.currency), case when st <> 'collected' then ' · balance ' || app.fmt_money(bal - p_amount, r.currency) else '' end),
    'normal', 'retention', r.id, '/retentions/' || r.id);
end $$;

create or replace function public.void_retention_collection(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.retention_collections; r public.retentions;
begin
  select * into c from public.retention_collections where id = p_id for update;
  perform app.require(c.id is not null and c.voided_at is null, 'Collection not found or already cancelled');
  select * into r from public.retentions where id = c.retention_id for update;
  perform app.require(app.can_edit_retention(r.id) and app.has_role('operations_exec', 'sm_projects', 'gm'), 'Only Operations, SM Projects or GM / DGM correct collections');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  update public.retention_collections set voided_by = auth.uid(), voided_at = now(), void_reason = btrim(p_reason) where id = c.id;
  perform app.retention_after_collection(r.id, null);
  insert into public.retention_log (retention_id, kind, note)
  values (r.id, 'collection_cancelled', format('Collection of %s on %s cancelled · %s', app.fmt_money(c.amount, r.currency), to_char(c.collected_on, 'DD Mon YYYY'), btrim(p_reason)));
end $$;

revoke execute on function public.void_retention_collection(uuid, text) from public, anon;
grant execute on function public.void_retention_collection(uuid, text) to authenticated, service_role;
