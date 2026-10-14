-- Local orders – services on execution projects: the IPCs come from the execution team. When an IPC is approved there
-- (Subcontractor invoices: AE → SEE → Operations) it can be taken under a work stage of the order; the invoice then
-- follows its approvals in stage 7 (the SEE's approval is already given). Each IPC records the advance recovered and,
-- when ticked, a variation amount kept apart from the stage's work. The advance invoice is one per order, is not
-- progress and is never under a work stage.

alter table public.lo_invoices add column if not exists advance_recovered numeric(16, 2) check (advance_recovered is null or advance_recovered >= 0);
alter table public.lo_invoices add column if not exists variation_amount numeric(16, 2) check (variation_amount is null or variation_amount > 0);
alter table public.lo_invoices add column if not exists variation_note text;
create unique index if not exists lo_invoices_one_advance on public.lo_invoices (order_id) where kind = 'advance' and status <> 'cancelled';
create unique index if not exists lo_invoices_one_per_ipc on public.lo_invoices (sub_invoice_id) where sub_invoice_id is not null and status <> 'cancelled';

-- an execution project's IPC invoice only from an approved IPC (under a work stage); an advance is not progress
create or replace function app.lo_invoice_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare exec uuid;
begin
  if current_setting('app.purging', true) = 'on' then return new; end if;
  if new.kind = 'advance' and new.work_stage_id is not null then
    raise exception 'The advance is not progress – it is not under a work stage';
  end if;
  if tg_op = 'INSERT' and new.kind = 'ipc' and new.sub_invoice_id is null then
    select r.exec_project_id into exec from public.lo_orders o join public.lo_requests r on r.id = o.request_id where o.id = new.order_id;
    if exec is not null then
      raise exception 'IPC invoices of an execution project come from the execution team''s approved IPCs – add it under the work stage';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists lo_invoice_rules on public.lo_invoices;
create trigger lo_invoice_rules before insert or update of kind, work_stage_id on public.lo_invoices for each row execute function app.lo_invoice_rules();

/** Operations: take an approved IPC under a work stage. p: {received_on, advance_recovered, has_variation, variation_amount, variation_note, note} */
create or replace function public.lo_add_stage_ipc(p_stage uuid, p_sub uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare w public.lo_work_stages; o public.lo_orders; r public.lo_requests; v public.sub_invoices; iid uuid;
        rec date := coalesce(nullif(p ->> 'received_on', '')::date, (now() at time zone app.tz())::date);
        adv numeric := coalesce(nullif(p ->> 'advance_recovered', '')::numeric, 0);
        var_on boolean := coalesce(p ->> 'has_variation', '') in ('yes', 'true');
        var_amt numeric := nullif(p ->> 'variation_amount', '')::numeric;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records invoices');
  select * into w from public.lo_work_stages where id = p_stage;
  perform app.require(found, 'Work stage not found');
  select * into o from public.lo_orders where id = w.order_id;
  select * into r from public.lo_requests where id = o.request_id;
  perform app.require(o.status = 'open', 'The order is closed');
  select * into v from public.sub_invoices where id = p_sub;
  perform app.require(found and v.exec_project_id = r.exec_project_id, 'Choose an IPC of this project');
  perform app.require(v.status in ('approved', 'docs_received'), 'Only an approved IPC');
  perform app.require(not exists (select 1 from public.lo_invoices where sub_invoice_id = v.id and status <> 'cancelled'), 'This IPC is already taken');
  perform app.require(adv <= v.amount, 'The advance recovered is more than the IPC');
  perform app.require(not var_on or coalesce(var_amt, 0) > 0, 'Enter the variation amount');
  perform app.require(rec <= (now() at time zone app.tz())::date, 'The received date cannot be in the future');
  insert into public.lo_invoices (order_id, kind, invoice_no, invoice_date, amount, sub_invoice_id, work_stage_id, received_on, see_on,
                                  advance_recovered, variation_amount, variation_note, note)
  values (o.id, 'ipc', coalesce(v.invoice_no, v.code), coalesce(v.invoice_date, rec), v.amount, v.id, w.id, rec,
          -- the SEE approved it in the IPC flow
          coalesce((v.see_at at time zone app.tz())::date, rec),
          nullif(adv, 0), case when var_on then var_amt end, case when var_on then nullif(btrim(p ->> 'variation_note'), '') end, nullif(btrim(p ->> 'note'), ''))
  returning id into iid;
  perform app.notify_many(app.role_users('sm_projects'), 'local_order', 'IPC invoice to approve',
    concat_ws(' · ', app.lo_order_head(o), w.title, coalesce(v.invoice_no, v.code), app.fmt_money(v.amount, 'LKR')), 'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  return iid;
end $$;
grant execute on function public.lo_add_stage_ipc(uuid, uuid, jsonb) to authenticated;

-- the advance is never under a work stage
create or replace function public.lo_link_invoice_stage(p_invoice uuid, p_stage uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.lo_invoices;
begin
  perform app.require(app.lo_keeper(), 'The Operations Executive records invoices');
  select * into i from public.lo_invoices where id = p_invoice;
  perform app.require(found, 'Invoice not found');
  perform app.require(p_stage is null or i.kind <> 'advance', 'The advance is not progress – it is not under a work stage');
  perform app.require(p_stage is null or exists (select 1 from public.lo_work_stages where id = p_stage and order_id = i.order_id), 'Choose a work stage of this order');
  update public.lo_invoices set work_stage_id = p_stage where id = p_invoice;
end $$;

select app.purge_guard_triggers();
select app.fix_function_owners();
