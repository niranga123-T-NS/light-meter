-- Local orders – services in stages: the planned completion of each work stage is the agreement's work programme. It is
-- set until the agreement is signed ("Signed agreement issued to the provider") – and a stage without a date can get its
-- first one any time; after that it is fixed and changes
-- only through a request approved by the project's SEE and then SM Projects (the history is kept).

create or replace function app.lo_agreement_signed(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.lo_steps where order_id = p_order and step = 'agreement_signed')
$$;

create or replace function public.lo_save_work_stage(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.lo_orders; w public.lo_work_stages; wid uuid; done date := nullif(p ->> 'done_on', '')::date; plan date := nullif(p ->> 'planned_on', '')::date;
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
  perform app.require(done is null or done <= (now() at time zone app.tz())::date, '“Done / certified on” is the date the stage was actually done – leave it empty until then (the planned date can be in the future)');
  -- the planned dates are the agreement's: fixed once it is signed (a change goes to the SEE and SM Projects)
  if app.lo_agreement_signed(o.id) and w.planned_on is not null and plan is distinct from w.planned_on then
    perform app.require(false, 'The planned date is fixed by the signed agreement – request a change (the SEE and SM Projects approve it)');
  end if;
  if p_id is null then
    insert into public.lo_work_stages (order_id, seq, title, pct, planned_on, done_on, cert_ref, note)
    values (o.id, coalesce((select max(seq) from public.lo_work_stages where order_id = o.id), 0) + 1, btrim(p ->> 'title'), nullif(p ->> 'pct', '')::numeric,
            plan, done, nullif(btrim(p ->> 'cert_ref'), ''), nullif(btrim(p ->> 'note'), ''))
    returning id into wid;
  else
    update public.lo_work_stages set title = btrim(p ->> 'title'), pct = nullif(p ->> 'pct', '')::numeric, planned_on = plan,
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

create table if not exists public.lo_work_stage_changes (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.lo_work_stages (id) on delete cascade,
  old_date date,
  new_date date not null,
  reason text not null,
  status text not null default 'pending_see' check (status in ('pending_see', 'pending_smp', 'approved', 'rejected')),
  requested_by uuid default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  see_by uuid references public.profiles (id),
  see_at timestamptz,
  smp_by uuid references public.profiles (id),
  smp_at timestamptz,
  decision_note text
);
create index if not exists lo_work_stage_changes_stage on public.lo_work_stage_changes (stage_id, requested_at desc);
alter table public.lo_work_stage_changes enable row level security;
drop policy if exists lo_work_stage_changes_read on public.lo_work_stage_changes;
create policy lo_work_stage_changes_read on public.lo_work_stage_changes for select to authenticated
  using (app.lo_can_read(app.lo_order_request((select order_id from public.lo_work_stages w where w.id = stage_id))));
grant select on public.lo_work_stage_changes to authenticated;

/** Operations or the SEE ask to move a work stage's planned date after the agreement is signed */
create or replace function public.lo_request_stage_date(p_stage uuid, p_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare w public.lo_work_stages; o public.lo_orders; cid uuid; see boolean;
begin
  select * into w from public.lo_work_stages where id = p_stage;
  perform app.require(found, 'Work stage not found');
  select * into o from public.lo_orders where id = w.order_id;
  see := app.lo_see_of(o.request_id) = auth.uid();
  perform app.require(app.lo_keeper() or see, 'Operations or the project''s SEE ask for the change');
  perform app.require(app.lo_agreement_signed(o.id), 'Before the agreement is signed, edit the stage directly');
  perform app.require(w.done_on is null, 'The stage is done');
  perform app.require(p_date is not null and p_date is distinct from w.planned_on, 'Choose the new date');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(not exists (select 1 from public.lo_work_stage_changes where stage_id = w.id and status in ('pending_see', 'pending_smp')), 'A change is already waiting for approval');
  -- the SEE asking is the SEE's approval
  insert into public.lo_work_stage_changes (stage_id, old_date, new_date, reason, status, see_by, see_at)
  values (w.id, w.planned_on, p_date, btrim(p_reason), case when see then 'pending_smp' else 'pending_see' end, case when see then auth.uid() end, case when see then now() end)
  returning id into cid;
  if see then
    perform app.notify_many(app.role_users('sm_projects'), 'local_order', 'Work stage date change to approve',
      concat_ws(' · ', app.lo_order_head(o), w.title, to_char(w.planned_on, 'DD Mon') || ' → ' || to_char(p_date, 'DD Mon YYYY'), btrim(p_reason)), 'normal', 'lo_order', o.id, '/orders/local/' || o.id, null, true);
  else
    perform app.notify(app.lo_see_of(o.request_id), 'local_order', 'Work stage date change to approve',
      concat_ws(' · ', app.lo_order_head(o), w.title, to_char(w.planned_on, 'DD Mon') || ' → ' || to_char(p_date, 'DD Mon YYYY'), btrim(p_reason)), 'normal', 'lo_order', o.id, '/orders/local/' || o.id, null, true);
  end if;
  return cid;
end $$;

/** The SEE, then SM Projects: approve or reject the date change; on the last approval the planned date moves */
create or replace function public.lo_decide_stage_date(p_change uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.lo_work_stage_changes; w public.lo_work_stages; o public.lo_orders; head text;
begin
  select * into c from public.lo_work_stage_changes where id = p_change for update;
  perform app.require(found, 'Change not found');
  select * into w from public.lo_work_stages where id = c.stage_id;
  select * into o from public.lo_orders where id = w.order_id;
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  head := concat_ws(' · ', app.lo_order_head(o), w.title, to_char(c.old_date, 'DD Mon') || ' → ' || to_char(c.new_date, 'DD Mon YYYY'));
  if c.status = 'pending_see' then
    perform app.require(app.lo_see_of(o.request_id) = auth.uid() or app.has_role('senior_elec_engineer'), 'The project''s SEE approves first');
    update public.lo_work_stage_changes set status = case when p_approve then 'pending_smp' else 'rejected' end, see_by = auth.uid(), see_at = now(),
           decision_note = nullif(btrim(p_note), '') where id = c.id;
    if p_approve then
      perform app.notify_many(app.role_users('sm_projects'), 'local_order', 'Work stage date change to approve', head || ' · ' || c.reason, 'normal', 'lo_order', o.id, '/orders/local/' || o.id, null, true);
    end if;
  elsif c.status = 'pending_smp' then
    perform app.require(app.has_role('sm_projects'), 'SM Projects approves after the SEE');
    update public.lo_work_stage_changes set status = case when p_approve then 'approved' else 'rejected' end, smp_by = auth.uid(), smp_at = now(),
           decision_note = coalesce(nullif(btrim(p_note), ''), decision_note) where id = c.id;
    if p_approve then update public.lo_work_stages set planned_on = c.new_date where id = w.id; end if;
  else
    perform app.require(false, 'Already decided');
  end if;
  if not p_approve or c.status = 'pending_smp' then
    perform app.notify_many(array[c.requested_by] || app.role_users('operations_exec'), 'local_order', case when p_approve then 'Work stage date changed' else 'Work stage date change rejected' end,
      concat_ws(' · ', head, nullif(btrim(p_note), '')), 'normal', 'lo_order', o.id, '/orders/local/' || o.id);
  end if;
end $$;
grant execute on function public.lo_request_stage_date(uuid, date, text), public.lo_decide_stage_date(uuid, boolean, text) to authenticated;

select app.purge_guard_triggers();
select app.fix_function_owners();
