-- Local orders – services done in stages (e.g. subcontract work): the work is recorded stage by stage (what, % of the
-- work, planned date, done / certified date and the IPC reference). Each IPC-based invoice is linked to the work stage it
-- claims and goes through its own approval chain (stage 7). "Work completed" needs every work stage done; the order
-- closes when every invoice is paid.

create table if not exists public.lo_work_stages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.lo_orders (id) on delete cascade,
  seq int not null default 1,
  title text not null,
  pct numeric check (pct is null or (pct > 0 and pct <= 100)),
  planned_on date,
  done_on date,
  cert_ref text,
  note text,
  added_by uuid default auth.uid() references public.profiles (id),
  added_at timestamptz not null default now()
);
create index if not exists lo_work_stages_order on public.lo_work_stages (order_id, seq);
alter table public.lo_work_stages enable row level security;
drop policy if exists lo_work_stages_read on public.lo_work_stages;
create policy lo_work_stages_read on public.lo_work_stages for select to authenticated using (app.lo_can_read(app.lo_order_request(order_id)));
grant select on public.lo_work_stages to authenticated;

alter table public.lo_invoices add column if not exists work_stage_id uuid references public.lo_work_stages (id) on delete set null;

/** Operations or the project's SEE: add / change a work stage; p: {order_id (new), title, pct, planned_on, done_on, cert_ref, note} */
create or replace function public.lo_save_work_stage(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; w public.lo_work_stages; wid uuid; done date := nullif(p ->> 'done_on', '')::date;
begin
  if p_id is not null then
    select * into w from public.lo_work_stages where id = p_id for update;
    perform app.require(found, 'Work stage not found');
  end if;
  select * into o from public.lo_orders where id = coalesce(w.order_id, nullif(p ->> 'order_id', '')::uuid);
  perform app.require(o.id is not null, 'Order not found');
  perform app.require(o.kind = 'service', 'Work stages are for services');
  perform app.require(o.status = 'open', 'The order is closed');
  perform app.require(app.lo_keeper() or app.lo_see_of(o.request_id) = auth.uid(), 'Operations or the project''s SEE record the work');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'What is this stage of the work?');
  perform app.require(done is null or done <= (now() at time zone app.tz())::date, 'The done date cannot be in the future');
  if p_id is null then
    insert into public.lo_work_stages (order_id, seq, title, pct, planned_on, done_on, cert_ref, note)
    values (o.id, coalesce((select max(seq) from public.lo_work_stages where order_id = o.id), 0) + 1, btrim(p ->> 'title'), nullif(p ->> 'pct', '')::numeric,
            nullif(p ->> 'planned_on', '')::date, done, nullif(btrim(p ->> 'cert_ref'), ''), nullif(btrim(p ->> 'note'), ''))
    returning id into wid;
  else
    update public.lo_work_stages set title = btrim(p ->> 'title'), pct = nullif(p ->> 'pct', '')::numeric, planned_on = nullif(p ->> 'planned_on', '')::date,
           done_on = done, cert_ref = nullif(btrim(p ->> 'cert_ref'), ''), note = nullif(btrim(p ->> 'note'), '')
     where id = p_id returning id into wid;
  end if;
  perform app.require((select coalesce(sum(pct), 0) from public.lo_work_stages where order_id = o.id) <= 100, 'The stages add up to more than 100%');
  if done is not null and (w.id is null or w.done_on is null) then
    perform app.notify_many(app.lo_followers(o.request_id), 'local_order', 'Work stage done',
      concat_ws(' · ', app.lo_order_head(o), btrim(p ->> 'title'), 'IPC ' || nullif(btrim(p ->> 'cert_ref'), '')), 'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  end if;
  return wid;
end $$;

create or replace function public.lo_remove_work_stage(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w public.lo_work_stages; o public.lo_orders;
begin
  select * into w from public.lo_work_stages where id = p_id;
  perform app.require(found, 'Work stage not found');
  select * into o from public.lo_orders where id = w.order_id;
  perform app.require(app.lo_keeper() or app.lo_see_of(o.request_id) = auth.uid(), 'Operations or the project''s SEE record the work');
  perform app.require(not exists (select 1 from public.lo_invoices where work_stage_id = p_id and status <> 'cancelled'), 'An invoice claims this stage – cancel or relink it first');
  delete from public.lo_work_stages where id = p_id;
end $$;

/** Operations: the work stage an (IPC-based) invoice claims */
create or replace function public.lo_link_invoice_stage(p_invoice uuid, p_stage uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.lo_invoices;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records invoices');
  select * into i from public.lo_invoices where id = p_invoice;
  perform app.require(found, 'Invoice not found');
  perform app.require(p_stage is null or exists (select 1 from public.lo_work_stages where id = p_stage and order_id = i.order_id), 'Choose a work stage of this order');
  update public.lo_invoices set work_stage_id = p_stage where id = p_invoice;
end $$;
grant execute on function public.lo_save_work_stage(uuid, jsonb), public.lo_remove_work_stage(uuid), public.lo_link_invoice_stage(uuid, uuid) to authenticated;

-- "Work completed" only when every work stage is done
create or replace function app.lo_work_done_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare open_n int;
begin
  if current_setting('app.purging', true) = 'on' or new.step <> 'work_done' or new.order_id is null then return new; end if;
  select count(*) into open_n from public.lo_work_stages where order_id = new.order_id and done_on is null;
  if open_n > 0 then raise exception '% work stage(s) not done yet – record them first', open_n; end if;
  return new;
end $$;
drop trigger if exists lo_work_done_check on public.lo_steps;
create trigger lo_work_done_check before insert on public.lo_steps for each row execute function app.lo_work_done_check();

select app.purge_guard_triggers();
select app.fix_function_owners();
