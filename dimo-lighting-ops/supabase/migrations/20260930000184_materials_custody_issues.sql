-- Materials without money: requests, information and acknowledgements only (prices and values are in SAP).
--  * The SEE approves; Operations orders (SAP reference) and sets the delivery date and time. A day before the delivery the
--    Operations Executive, the SEE and the AEs are reminded; delivery more than 2 days late → the SEE; any further delay → SM Projects.
--  * Deliveries come into the site store under DIMO's, the client's or a subcontractor's custody; balances per item and custody,
--    low stock warned (the SEE / AE can set a minimum or ignore the warning).
--  * The subcontractor supervisor (or the AE where no subcontractor) issues materials to the staff against the day's task. Material
--    not related to the task is blocked (the AE and the SEE are alerted); a special release needs the AE (DIMO / subcontractor
--    custody) or the AE and then the SEE (client custody). Unused material comes back to the store when the day's usage is recorded –
--    mandatory before the daily report.
--  * Warnings to the SEE and the AEs: excessive usage, frequent orders of the same item, low stock.

-- Custody of what comes into the store
alter table public.material_receipts add column if not exists custody text not null default 'dimo';
alter table public.material_receipts drop constraint if exists material_receipts_custody_check;
alter table public.material_receipts add constraint material_receipts_custody_check check (custody in ('dimo', 'client', 'subcontractor'));
alter table public.material_receipts add column if not exists custody_company text;
alter table public.store_moves add column if not exists custody text not null default 'dimo';
alter table public.store_moves drop constraint if exists store_moves_custody_check;
alter table public.store_moves add constraint store_moves_custody_check check (custody in ('dimo', 'client', 'subcontractor'));
alter table public.store_moves add column if not exists custody_company text;
alter table public.store_moves add column if not exists issue_id uuid;

-- Delivery date and time set by Operations
alter table public.material_requests add column if not exists delivery_at timestamptz;
alter table public.material_requests add column if not exists delivery_note text;
alter table public.material_requests add column if not exists delivery_set_by uuid references public.profiles (id);
alter table public.material_requests add column if not exists delivery_set_at timestamptz;
alter table public.material_requests add column if not exists reschedules int not null default 0;
alter table public.material_requests add column if not exists near_alerted_for timestamptz;
alter table public.material_requests add column if not exists delay_level int not null default 0;

-- Minimum / ignored low-stock warning per store item
create table if not exists public.store_item_settings (
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  item_key text not null,
  custody text not null,
  min_qty numeric,
  ignore_low boolean not null default false,
  note text,
  set_by uuid references public.profiles (id) default auth.uid(),
  set_at timestamptz not null default now(),
  primary key (exec_project_id, item_key, custody)
);
alter table public.store_item_settings enable row level security;
drop policy if exists store_item_settings_read on public.store_item_settings;
create policy store_item_settings_read on public.store_item_settings for select to authenticated using (app.is_exec_internal(exec_project_id));
grant select on public.store_item_settings to authenticated;

-- Materials issued to the staff against the day's task
create table if not exists public.material_issues (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  day date not null,
  item text not null,
  unit text not null,
  custody text not null check (custody in ('dimo', 'client', 'subcontractor')),
  custody_company text,
  qty numeric not null check (qty > 0),
  task_kind text not null check (task_kind in ('sub', 'ae')),
  task_id uuid not null,
  task_title text,
  issued_to text,
  note text,
  issued_by uuid not null default auth.uid() references public.profiles (id),
  issued_at timestamptz not null default now(),
  related boolean not null,
  status text not null check (status in ('issued', 'blocked', 'pending_ae', 'pending_see', 'rejected')),
  release_reason text,
  ae_by uuid references public.profiles (id), ae_at timestamptz,
  see_by uuid references public.profiles (id), see_at timestamptz,
  decision_note text,
  used_qty numeric,
  used_note text,
  usage_at timestamptz
);
create index if not exists material_issues_project on public.material_issues (exec_project_id, day);
alter table public.material_issues enable row level security;
drop policy if exists material_issues_read on public.material_issues;
create policy material_issues_read on public.material_issues for select to authenticated using (issued_by = auth.uid() or app.is_exec_internal(exec_project_id));
grant select on public.material_issues to authenticated;

create or replace function app.custody_label(p text) returns text language sql immutable as $$
  select case p when 'dimo' then 'DIMO custody' when 'client' then 'Client custody' else 'Subcontractor custody' end
$$;

-- Store balance of one item under one custody
create or replace function app.custody_balance(p_exec uuid, p_item text, p_custody text, p_company text default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when kind in ('receipt', 'return', 'transfer_in') then qty else -qty end), 0)
  from public.store_moves where exec_project_id = p_exec and lower(item) = lower(btrim(p_item)) and custody = p_custody
    and (p_custody <> 'subcontractor' or lower(coalesce(custody_company, '')) = lower(coalesce(p_company, '')))
$$;

-- Balances of the project's store (a subcontractor supervisor sees DIMO's, the client's and their own company's material)
create or replace function public.store_balances(p_exec uuid)
returns table (item text, unit text, custody text, custody_company text, received numeric, issued numeric, returned numeric, other_out numeric,
               balance numeric, used numeric, min_qty numeric, ignore_low boolean, low boolean, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare co text := app.company_of(auth.uid());
begin
  perform app.require(app.is_exec_internal(p_exec) or app.is_exec_member(p_exec), 'Not on this project');
  return query
  with mv as (
    select min(s.item) as item, min(s.unit) as unit, s.custody, min(s.custody_company) as custody_company, lower(s.item) as k,
           coalesce(sum(s.qty) filter (where s.kind in ('receipt', 'transfer_in')), 0) as received,
           coalesce(sum(s.qty) filter (where s.kind = 'issue'), 0) as issued,
           coalesce(sum(s.qty) filter (where s.kind = 'return'), 0) as returned,
           coalesce(sum(s.qty) filter (where s.kind = 'transfer_out'), 0) as other_out,
           max(s.at) as last_at
      from public.store_moves s
     where s.exec_project_id = p_exec
       and (not app.is_sub() or s.custody <> 'subcontractor' or lower(coalesce(s.custody_company, '')) = co)
     group by lower(s.item), s.custody, lower(coalesce(s.custody_company, ''))
  )
  select mv.item, mv.unit, mv.custody, mv.custody_company, mv.received, mv.issued, mv.returned, mv.other_out,
         mv.received + mv.returned - mv.issued - mv.other_out,
         coalesce((select sum(i.used_qty) from public.material_issues i where i.exec_project_id = p_exec and lower(i.item) = mv.k and i.custody = mv.custody), 0),
         st.min_qty, coalesce(st.ignore_low, false),
         (mv.received + mv.returned - mv.issued - mv.other_out) <= coalesce(st.min_qty, mv.received * 0.2) and mv.received > 0,
         mv.last_at
    from mv left join public.store_item_settings st on st.exec_project_id = p_exec and st.item_key = mv.k and st.custody = mv.custody
   order by mv.item, mv.custody;
end $$;

-- The SEE / AE sets a minimum stock or ignores the low-stock warning (no further order needed)
create or replace function public.set_store_item(p_exec uuid, p_item text, p_custody text, p_min numeric, p_ignore boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec), 'The SEE or an Assistant Engineer of the project sets this');
  perform app.require(not coalesce(p_ignore, false) or coalesce(btrim(p_note), '') <> '', 'Say why no further order is needed');
  insert into public.store_item_settings (exec_project_id, item_key, custody, min_qty, ignore_low, note)
  values (p_exec, lower(btrim(p_item)), p_custody, p_min, coalesce(p_ignore, false), nullif(btrim(p_note), ''))
  on conflict (exec_project_id, item_key, custody) do update set min_qty = excluded.min_qty, ignore_low = excluded.ignore_low, note = excluded.note,
    set_by = auth.uid(), set_at = now();
end $$;

-- Is the material related to the task's work? (requested for the same programme activity, or for general use)
create or replace function app.issue_related(p_exec uuid, p_item text, p_activity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.material_request_lines l join public.material_requests m on m.id = l.mr_id
                      where m.exec_project_id = p_exec and lower(l.item) = lower(btrim(p_item)) and m.status not in ('rejected', 'cancelled'))
      or exists (select 1 from public.material_request_lines l join public.material_requests m on m.id = l.mr_id
                  where m.exec_project_id = p_exec and lower(l.item) = lower(btrim(p_item)) and m.status not in ('rejected', 'cancelled')
                    and (m.activity_id is null or m.activity_id = p_activity))
$$;

create or replace function app.release_issue(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.material_issues;
begin
  select * into i from public.material_issues where id = p_id for update;
  perform app.require(app.custody_balance(i.exec_project_id, i.item, i.custody, i.custody_company) >= i.qty,
    format('Only %s %s of %s in the store (%s)', app.custody_balance(i.exec_project_id, i.item, i.custody, i.custody_company), i.unit, i.item, app.custody_label(i.custody)));
  update public.material_issues set status = 'issued' where id = i.id;
  insert into public.store_moves (exec_project_id, kind, item, unit, qty, ref, note, by_id, custody, custody_company, issue_id)
  values (i.exec_project_id, 'issue', i.item, i.unit, i.qty, i.code, concat_ws(' · ', i.task_title, i.issued_to), i.issued_by, i.custody, i.custody_company, i.id);
end $$;

-- Issue material to the staff for the day's task
create or replace function public.issue_material(p_exec uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone app.tz())::date; kind text := p ->> 'task_kind'; tid uuid := nullif(p ->> 'task_id', '')::uuid;
        act uuid; title text; ok boolean; q numeric := nullif(p ->> 'qty', '')::numeric; cust text := coalesce(nullif(p ->> 'custody', ''), 'dimo');
        comp text := nullif(btrim(p ->> 'custody_company'), ''); unit text; rid uuid; c text; sub boolean := app.has_role('sub_supervisor');
begin
  perform app.require((sub and app.is_exec_member(p_exec)) or app.is_project_ae(p_exec),
    'The subcontractor supervisor (or the Assistant Engineer where there is no subcontractor) issues materials');
  perform app.require(coalesce(btrim(p ->> 'item'), '') <> '' and coalesce(q, 0) > 0, 'Choose the item and the quantity');
  perform app.require(cust in ('dimo', 'client', 'subcontractor'), 'Choose the custody');
  if cust = 'subcontractor' and sub then comp := coalesce(comp, (select company from public.profiles where id = auth.uid())); end if;
  perform app.require(not sub or cust <> 'subcontractor' or lower(coalesce(comp, '')) = coalesce(app.company_of(auth.uid()), ''), 'Only your own company''s material');
  -- the day's task
  if kind = 'sub' then
    select i.activity_id, i.title, coalesce(i.activity_id, (select x.activity_id from public.exec_plan_items x where x.id = i.ae_item_id)) into act, title, act
      from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
     where i.id = tid and s.exec_project_id = p_exec and s.status = 'approved' and i.day = today and (s.supervisor_id = auth.uid() or not sub);
  elsif kind = 'ae' then
    select x.activity_id, x.title into act, title from public.exec_plan_items x
     where x.id = tid and x.exec_project_id = p_exec and x.day = today and (not sub or x.supervisor_id = auth.uid() or app.ae_item_for_sup(x, auth.uid()));
  end if;
  perform app.require(title is not null, 'Choose one of today''s tasks');
  select s.unit into unit from public.store_moves s where s.exec_project_id = p_exec and lower(s.item) = lower(btrim(p ->> 'item')) limit 1;
  perform app.require(unit is not null, 'That item is not in the site store');
  perform app.require(app.custody_balance(p_exec, p ->> 'item', cust, comp) >= q,
    format('Only %s %s in the store (%s)', app.custody_balance(p_exec, p ->> 'item', cust, comp), unit, app.custody_label(cust)));
  ok := app.issue_related(p_exec, p ->> 'item', act);
  c := app.next_code('MI');
  insert into public.material_issues (code, exec_project_id, day, item, unit, custody, custody_company, qty, task_kind, task_id, task_title, issued_to, note, related, status)
  values (c, p_exec, today, (select min(s.item) from public.store_moves s where s.exec_project_id = p_exec and lower(s.item) = lower(btrim(p ->> 'item'))), unit,
          cust, comp, q, kind, tid, title, nullif(btrim(p ->> 'issued_to'), ''), nullif(btrim(p ->> 'note'), ''), ok, case when ok then 'issued' else 'blocked' end)
  returning id into rid;
  if ok then
    perform app.release_issue(rid);
  else
    perform app.notify_many(array(select unnest(app.project_aes(p_exec)) union select unnest(app.role_users('senior_elec_engineer'))), 'material_issue',
      format('Material issue blocked – not for today''s task · %s', app.display_name(auth.uid())),
      format('%s · %s %s %s (%s) for "%s" · %s', c, q, unit, btrim(p ->> 'item'), app.custody_label(cust), title, app.exec_head(p_exec)),
      'critical', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=materials');
  end if;
  return jsonb_build_object('id', rid, 'code', c, 'status', case when ok then 'issued' else 'blocked' end);
end $$;

-- Special release of blocked material: asked by the issuer; the AE clears it (DIMO / subcontractor custody), then the SEE too (client custody)
create or replace function public.request_issue_release(p_id uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare i public.material_issues; nxt text;
begin
  select * into i from public.material_issues where id = p_id for update;
  perform app.require(i.id is not null and i.status = 'blocked', 'Not blocked');
  perform app.require(i.issued_by = auth.uid(), 'Only the person who issued it asks');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Explain why the material is needed for today''s work');
  nxt := case when app.is_project_ae(i.exec_project_id) then 'pending_see' else 'pending_ae' end;
  update public.material_issues set status = nxt, release_reason = btrim(p_reason),
    ae_by = case when nxt = 'pending_see' then auth.uid() end, ae_at = case when nxt = 'pending_see' then now() end where id = i.id;
  perform app.notify_many(case when nxt = 'pending_ae' then app.project_aes(i.exec_project_id) else app.role_users('senior_elec_engineer') end, 'material_issue',
    'Special material release to clear', format('%s · %s %s %s (%s) for "%s" · %s', i.code, i.qty, i.unit, i.item, app.custody_label(i.custody), i.task_title, btrim(p_reason)),
    'critical', 'exec_project', i.exec_project_id, '/execution/' || i.exec_project_id || '?tab=materials', null, true);
  return nxt;
end $$;

create or replace function public.decide_issue_release(p_id uuid, p_ok boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare i public.material_issues; nxt text;
begin
  select * into i from public.material_issues where id = p_id for update;
  perform app.require(i.id is not null and i.status in ('pending_ae', 'pending_see'), 'Not waiting for a decision');
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  if i.status = 'pending_ae' then
    perform app.require(app.is_project_ae(i.exec_project_id), 'An Assistant Engineer of the project clears it');
    nxt := case when not p_ok then 'rejected' when i.custody = 'client' then 'pending_see' else 'issued' end;
    update public.material_issues set ae_by = auth.uid(), ae_at = now(), decision_note = nullif(btrim(p_note), '') where id = i.id;
  else
    perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer clears it');
    nxt := case when p_ok then 'issued' else 'rejected' end;
    update public.material_issues set see_by = auth.uid(), see_at = now(), decision_note = coalesce(nullif(btrim(p_note), ''), decision_note) where id = i.id;
  end if;
  if nxt = 'issued' then
    perform app.release_issue(i.id);
  else
    update public.material_issues set status = nxt where id = i.id;
  end if;
  if nxt = 'pending_see' then
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'material_issue', 'Special material release to clear (client custody)',
      format('%s · %s %s %s for "%s" · cleared by %s', i.code, i.qty, i.unit, i.item, i.task_title, app.display_name(auth.uid())),
      'critical', 'exec_project', i.exec_project_id, '/execution/' || i.exec_project_id || '?tab=materials', null, true);
  else
    perform app.notify(i.issued_by, 'material_issue', case when nxt = 'issued' then 'Material release cleared – issue it' else 'Material release not cleared' end,
      format('%s · %s %s %s%s', i.code, i.qty, i.unit, i.item, coalesce(' · ' || nullif(btrim(p_note), ''), '')), 'normal', 'exec_project', i.exec_project_id,
      '/execution/' || i.exec_project_id || '?tab=materials');
  end if;
  return nxt;
end $$;

-- The day's usage: what was used of each issue; the rest comes back to the store
create or replace function public.report_material_usage(p_id uuid, p_used numeric, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.material_issues;
begin
  select * into i from public.material_issues where id = p_id for update;
  perform app.require(i.id is not null and i.status = 'issued', 'Not issued');
  perform app.require(i.issued_by = auth.uid() or app.is_project_ae(i.exec_project_id), 'The person who issued it records the usage');
  perform app.require(i.used_qty is null, 'Usage already recorded');
  perform app.require(p_used is not null and p_used >= 0 and p_used <= i.qty, format('Used is 0 – %s %s', i.qty, i.unit));
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Describe what it was used for');
  update public.material_issues set used_qty = p_used, used_note = btrim(p_note), usage_at = now() where id = i.id;
  if i.qty - p_used > 0 then
    insert into public.store_moves (exec_project_id, kind, item, unit, qty, ref, note, by_id, custody, custody_company, issue_id)
    values (i.exec_project_id, 'return', i.item, i.unit, i.qty - p_used, i.code, 'Not used – back to the store', auth.uid(), i.custody, i.custody_company, i.id);
  end if;
end $$;

-- Operations sets (or moves) the delivery date and time
create or replace function public.schedule_delivery(p_id uuid, p_at timestamptz, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; later boolean;
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive sets the delivery');
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(m.id is not null and m.status in ('approved', 'ordered', 'part_received'), 'The request is not approved');
  perform app.require(p_at is not null, 'Set the delivery date and time');
  later := m.delivery_at is not null and p_at > m.delivery_at;
  perform app.require(not later or coalesce(btrim(p_note), '') <> '', 'Give the reason for the later delivery');
  update public.material_requests set status = case when status = 'approved' then 'ordered' else status end,
    ordered_by = coalesce(ordered_by, auth.uid()), ordered_at = coalesce(ordered_at, now()), expected_date = (p_at at time zone app.tz())::date,
    delivery_at = p_at, delivery_note = nullif(btrim(p_note), ''), delivery_set_by = auth.uid(), delivery_set_at = now(),
    reschedules = reschedules + case when later then 1 else 0 end, near_alerted_for = null where id = m.id;
  perform app.notify_many(array(select unnest(app.project_aes(m.exec_project_id)) union select unnest(app.role_users('senior_elec_engineer')) union select m.requested_by),
    'exec_material', case when later then 'Material delivery moved' else 'Material delivery scheduled' end,
    format('%s · %s%s', app.mr_head(m), to_char(p_at at time zone app.tz(), 'Dy DD Mon HH24:MI'), coalesce(' · ' || nullif(btrim(p_note), ''), '')),
    'normal', 'material_request', m.id, '/execution/material/' || m.id);
  -- a further delay after the SEE was told goes to SM Projects
  if later and m.delay_level >= 1 then
    perform app.notify_many(app.role_users('sm_projects'), 'exec_material', 'Material delivery delayed again',
      format('%s · now %s · %s', app.mr_head(m), to_char(p_at at time zone app.tz(), 'DD Mon HH24:MI'), btrim(p_note)), 'critical', 'material_request', m.id, '/execution/material/' || m.id);
  end if;
end $$;

-- Every 30 minutes: delivery reminders, delays, frequent orders, excessive usage and low stock
create or replace function public.materials_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; m public.material_requests; r record; n int := 0; late int;
begin
  -- delivery tomorrow / within a day
  for m in select * from public.material_requests where status in ('ordered', 'part_received') and delivery_at is not null
             and delivery_at between p_at and p_at + interval '24 hours' and near_alerted_for is distinct from delivery_at loop
    perform app.notify_many(array(select unnest(app.role_users('operations_exec')) union select unnest(app.role_users('senior_elec_engineer'))
                                  union select unnest(app.project_aes(m.exec_project_id))), 'exec_material', 'Material delivery coming',
      format('%s · %s', app.mr_head(m), to_char(m.delivery_at at time zone app.tz(), 'Dy DD Mon HH24:MI')), 'normal', 'material_request', m.id, '/execution/material/' || m.id);
    update public.material_requests set near_alerted_for = m.delivery_at where id = m.id; n := n + 1;
  end loop;
  -- late: more than 2 days → the SEE; more than 4 days → SM Projects
  for m in select * from public.material_requests where status in ('approved', 'ordered', 'part_received') loop
    late := today - coalesce((m.delivery_at at time zone app.tz())::date, m.required_date);
    if late > 4 and m.delay_level < 2 then
      perform app.notify_many(app.role_users('sm_projects') || app.role_users('senior_elec_engineer'), 'exec_material', format('Material delivery %s days late', late),
        app.mr_head(m), 'critical', 'material_request', m.id, '/execution/material/' || m.id);
      update public.material_requests set delay_level = 2 where id = m.id; n := n + 1;
    elsif late > 2 and m.delay_level < 1 then
      perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_material', format('Material delivery %s days late', late),
        app.mr_head(m), 'critical', 'material_request', m.id, '/execution/material/' || m.id);
      update public.material_requests set delay_level = 1 where id = m.id; n := n + 1;
    end if;
  end loop;
  -- the same item ordered 3+ times in 14 days
  for r in select mr.exec_project_id, min(l.item) as item, count(distinct mr.id) as k from public.material_request_lines l join public.material_requests mr on mr.id = l.mr_id
            where mr.requested_at >= p_at - interval '14 days' and mr.status not in ('rejected', 'cancelled') group by mr.exec_project_id, lower(l.item) having count(distinct mr.id) >= 3 loop
    perform app.notify_many(array(select unnest(app.project_aes(r.exec_project_id)) union select unnest(app.role_users('senior_elec_engineer'))), 'material_warning',
      format('Frequent orders – %s', r.item), format('%s requests for %s in 14 days · %s', r.k, r.item, app.exec_head(r.exec_project_id)), 'normal', 'exec_project', r.exec_project_id,
      '/execution/' || r.exec_project_id || '?tab=materials', format('mr_freq:%s:%s:%s', r.exec_project_id, lower(r.item), to_char(today, 'IYYY-IW')));
    n := n + 1;
  end loop;
  -- excessive usage: today's use more than twice the daily average of the last 14 days
  for r in select t.exec_project_id, t.item, t.unit, t.used, a.avg_used from
             (select exec_project_id, min(item) as item, min(unit) as unit, lower(item) as k, sum(used_qty) as used from public.material_issues
               where day = today and used_qty is not null group by exec_project_id, lower(item)) t
             join lateral (select avg(d.u) as avg_used, count(*) as days from (select day, sum(used_qty) as u from public.material_issues
                            where exec_project_id = t.exec_project_id and lower(item) = t.k and day between today - 14 and today - 1 and used_qty is not null group by day) d) a on true
            where a.days >= 3 and t.used > 2 * a.avg_used loop
    perform app.notify_many(array(select unnest(app.project_aes(r.exec_project_id)) union select unnest(app.role_users('senior_elec_engineer'))), 'material_warning',
      format('Excessive material usage – %s', r.item), format('%s %s used today against %s a day on average · %s', r.used, r.unit, round(r.avg_used, 1), app.exec_head(r.exec_project_id)),
      'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=materials', format('mr_use:%s:%s:%s', r.exec_project_id, lower(r.item), today));
    n := n + 1;
  end loop;
  -- low stock (not ignored), once a day
  for r in select e.id as exec_project_id, b.* from public.exec_projects e cross join lateral public.store_balances_all(e.id) b where e.status = 'active' and b.low and not b.ignore_low loop
    perform app.notify_many(array(select unnest(app.project_aes(r.exec_project_id)) union select unnest(app.role_users('senior_elec_engineer'))), 'material_warning',
      format('Low stock – %s', r.item), format('%s %s left (%s) · %s', r.balance, r.unit, app.custody_label(r.custody), app.exec_head(r.exec_project_id)),
      'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id || '?tab=materials', format('mr_low:%s:%s:%s:%s', r.exec_project_id, lower(r.item), r.custody, today));
    n := n + 1;
  end loop;
  return n;
end $$;


create or replace function public.store_balances_all(p_exec uuid)
returns table (item text, unit text, custody text, balance numeric, min_qty numeric, ignore_low boolean, low boolean)
language sql stable security definer set search_path = public as $$
  with mv as (
    select min(s.item) as item, min(s.unit) as unit, s.custody, lower(s.item) as k,
           coalesce(sum(s.qty) filter (where s.kind in ('receipt', 'transfer_in')), 0) as received,
           coalesce(sum(case when s.kind in ('receipt', 'return', 'transfer_in') then s.qty else -s.qty end), 0) as bal
      from public.store_moves s where s.exec_project_id = p_exec group by lower(s.item), s.custody
  )
  select mv.item, mv.unit, mv.custody, mv.bal, st.min_qty, coalesce(st.ignore_low, false), mv.bal <= coalesce(st.min_qty, mv.received * 0.2) and mv.received > 0
    from mv left join public.store_item_settings st on st.exec_project_id = p_exec and st.item_key = mv.k and st.custody = mv.custody
$$;


create or replace function public.raise_material_request(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; l jsonb; n int := 0; sub boolean := app.has_role('sub_supervisor'); c public.material_catalog; cid int; nm text;
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
    continue when cid is null and coalesce(btrim(l ->> 'item'), '') = '';
    c := null;
    if cid is not null then
      select * into c from public.material_catalog where id = cid and active;
      perform app.require(c.id is not null, 'Catalogue item not found – choose it again');
      nm := c.name;
    else
      perform app.require(coalesce((l ->> 'custom')::boolean, false), 'Choose the item from the catalogue, or tick “not in the catalogue” and describe it');
      nm := btrim(l ->> 'item');
    end if;
    perform app.require(nullif(l ->> 'qty', '')::numeric > 0 and coalesce(btrim(coalesce(l ->> 'unit', c.unit)), '') <> '', 'Each item needs a quantity and unit');
    rate := null;
    insert into public.material_request_lines (mr_id, item, unit, qty, catalog_id, category, spec, brand, custom, est_rate, note)
    values (m.id, nm, coalesce(nullif(btrim(l ->> 'unit'), ''), c.unit), (l ->> 'qty')::numeric, c.id, coalesce(c.category, nullif(btrim(l ->> 'category'), '')),
            nullif(btrim(l ->> 'spec'), ''), nullif(btrim(l ->> 'brand'), ''), c.id is null, rate, nullif(btrim(l ->> 'note'), ''));
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

create or replace function public.decide_material_request(p_id uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; nxt text;
begin
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(m.id is not null, 'Request not found');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  if m.status = 'submitted' then
    perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer approves material requests');
    nxt := case when p_approve then 'approved' else 'rejected' end;
    update public.material_requests set status = nxt, see_by = auth.uid(), see_at = now(), decision_note = nullif(btrim(p_note), '') where id = m.id;
    if nxt = 'pending_smp' then
      perform app.notify_many(app.role_users('sm_projects'), 'exec_material', 'Material request to approve (above limit)',
        app.mr_head(m) || ' · ' || app.fmt_money(m.est_value_lkr, 'LKR'), 'normal', 'material_request', m.id, '/execution/material/' || m.id, null, true);
    end if;
  elsif m.status = 'pending_smp' then
    perform app.require(app.has_role('sm_projects'), 'Waiting for SM Projects');
    nxt := case when p_approve then 'approved' else 'rejected' end;
    update public.material_requests set status = nxt, smp_by = auth.uid(), smp_at = now(), decision_note = coalesce(nullif(btrim(p_note), ''), decision_note) where id = m.id;
  else
    perform app.require(false, 'Not waiting for approval');
  end if;
  if nxt = 'approved' then
    perform app.notify_many(app.role_users('operations_exec'), 'exec_material', 'Material request approved – order it and set the delivery', app.mr_head(m), 'normal',
      'material_request', m.id, '/execution/material/' || m.id, null, true);
  end if;
  if nxt in ('approved', 'rejected') then
    perform app.notify(m.requested_by, 'exec_material', 'Material request ' || nxt, concat_ws(' · ', app.mr_head(m), nullif(btrim(p_note), '')), 'normal',
      'material_request', m.id, '/execution/material/' || m.id);
  end if;
  return nxt;
end $$;

create or replace function public.order_material_request(p_id uuid, p_po text, p_supplier text, p_expected date) returns void
language plpgsql security definer set search_path = public as $$
declare m public.material_requests;
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive places the order');
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(m.id is not null and m.status = 'approved', 'The request is not approved');
  update public.material_requests set status = 'ordered', po_no = nullif(btrim(p_po), ''), supplier = nullif(btrim(p_supplier), ''), expected_date = p_expected,
    ordered_by = auth.uid(), ordered_at = now() where id = m.id;
  perform app.notify_many(app.project_aes(m.exec_project_id) || array[m.requested_by] || app.role_users('senior_elec_engineer'), 'exec_material', 'Material ordered',
    concat_ws(' · ', app.mr_head(m), 'SAP ' || nullif(btrim(p_po), ''), 'expected ' || to_char(p_expected, 'DD Mon')), 'normal', 'material_request', m.id, '/execution/material/' || m.id);
end $$;

drop function if exists public.receive_material(uuid, jsonb, text, uuid);
create or replace function public.receive_material(p_id uuid, p_lines jsonb, p_note text default null, p_supervisor uuid default null,
  p_custody text default 'dimo', p_company text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; l jsonb; ln public.material_request_lines; q numeric; out_lines jsonb := '[]'; rid uuid; sub uuid; by_sub boolean := app.has_role('sub_supervisor');
begin
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(m.id is not null and m.status in ('ordered', 'part_received'), 'Nothing is on order for this request');
  perform app.require((app.is_exec_internal(m.exec_project_id) and not app.has_role('gm', 'sm_projects')) or (by_sub and app.is_exec_member(m.exec_project_id)),
    'Only the project team records deliveries');
  perform app.require(not exists (select 1 from public.material_receipts where mr_id = m.id and status = 'pending'), 'The last delivery is still waiting for acknowledgement');
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    q := nullif(l ->> 'qty', '')::numeric;
    continue when coalesce(q, 0) <= 0;
    select * into ln from public.material_request_lines where id = (l ->> 'line_id')::uuid and mr_id = m.id;
    perform app.require(ln.id is not null, 'Unknown item');
    out_lines := out_lines || jsonb_build_array(jsonb_build_object('line_id', ln.id, 'item', ln.item, 'unit', ln.unit, 'qty', q));
  end loop;
  perform app.require(jsonb_array_length(out_lines) > 0, 'Enter the quantities received');
  perform app.require(coalesce(p_custody, 'dimo') in ('dimo', 'client', 'subcontractor'), 'Choose the custody');
  perform app.require(coalesce(p_custody, 'dimo') <> 'subcontractor' or coalesce(btrim(p_company), '') <> '' or by_sub, 'Choose the subcontractor');
  if by_sub then
    sub := auth.uid();
  else
    sub := coalesce(p_supervisor, case when (select role from public.profiles where id = m.requested_by) = 'sub_supervisor' then m.requested_by end);
    perform app.require(sub is null or exists (select 1 from public.exec_members where exec_project_id = m.exec_project_id and user_id = sub and active and member_role = 'sub_supervisor'),
      'Choose a subcontractor supervisor of this project');
  end if;
  insert into public.material_receipts (mr_id, lines, note, supervisor_id, ae_ack_by, ae_ack_at, sub_ack_at, custody, custody_company)
  values (m.id, out_lines, nullif(btrim(p_note), ''), sub, case when by_sub then null else auth.uid() end, case when by_sub then null else now() end,
          case when by_sub then now() end, coalesce(p_custody, 'dimo'),
          case when coalesce(p_custody, 'dimo') = 'subcontractor' then coalesce(nullif(btrim(p_company), ''), (select company from public.profiles where id = auth.uid())) end)
  returning id into rid;
  if by_sub then
    perform app.notify_many(app.project_aes(m.exec_project_id), 'exec_material', 'Delivery to acknowledge', app.mr_head(m) || ' · recorded by ' || app.display_name(auth.uid()),
      'normal', 'material_request', m.id, '/execution/material/' || m.id, null, true);
  elsif sub is not null then
    perform app.notify(sub, 'exec_material', 'Delivery to acknowledge', app.mr_head(m) || ' · recorded by ' || app.display_name(auth.uid()), 'normal', 'material_request', m.id,
      '/execution/material/' || m.id, null, true);
  else
    perform app.book_receipt(rid);  -- no subcontractor involved: the engineer's record is enough
  end if;
  if coalesce(btrim(p_note), '') <> '' then
    perform app.notify_many(app.role_users('operations_exec', 'senior_elec_engineer'), 'exec_material', 'Delivery note: damages / shortages',
      app.mr_head(m) || ' · ' || btrim(p_note), 'normal', 'material_request', m.id, '/execution/material/' || m.id);
  end if;
  return rid;
end $$;

create or replace function app.book_receipt(p_receipt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.material_receipts; m public.material_requests; l jsonb; open_n int;
begin
  select * into r from public.material_receipts where id = p_receipt for update;
  select * into m from public.material_requests where id = r.mr_id for update;
  for l in select * from jsonb_array_elements(r.lines) loop
    update public.material_request_lines set received_qty = received_qty + (l ->> 'qty')::numeric where id = (l ->> 'line_id')::uuid;
    insert into public.store_moves (exec_project_id, kind, item, unit, qty, mr_id, ref, note, by_id, custody, custody_company)
    values (m.exec_project_id, 'receipt', l ->> 'item', l ->> 'unit', (l ->> 'qty')::numeric, m.id, m.po_no, r.note, r.recorded_by, r.custody, r.custody_company);
  end loop;
  update public.material_receipts set status = 'accepted' where id = r.id;
  select count(*) into open_n from public.material_request_lines where mr_id = m.id and received_qty < qty;
  update public.material_requests set status = case when open_n = 0 then 'received' else 'part_received' end where id = m.id;
end $$;

create or replace function public.submit_exec_report(p_exec uuid, p_date date, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare tb uuid[]; lvl text; x public.exec_reports; rid uuid; late boolean; today date := (now() at time zone app.tz())::date; u jsonb; it public.exec_plan_items; snap jsonb := '[]'; si public.sub_plan_items; pids uuid[] := '{}'; ssnap jsonb := '[]'; miss text;
begin
  perform app.require(app.is_exec_member(p_exec), 'You are not on this project');
  lvl := case app.my_role() when 'sub_supervisor' then 'supervisor' when 'assistant_engineer' then 'ae' end;
  perform app.require(lvl is not null, 'Daily reports are written by subcontractor supervisors and Assistant Engineers');
  perform app.require(p_date is not null and p_date <= today and p_date >= today - 3, 'Report for today or the last three days');
  perform app.require(coalesce(btrim(p ->> 'work_done'), '') <> '', 'Describe the work done');
  perform app.require(lvl <> 'supervisor' or nullif(p ->> 'crew_count', '') is not null, 'Enter the crew on site');
  select coalesce(array_agg(tv::uuid), '{}') into tb from jsonb_array_elements_text(case when jsonb_typeof(p -> 'toolbox_records') = 'array' then p -> 'toolbox_records' else '[]' end) tv;
  perform app.require(not coalesce((p ->> 'toolbox_talk')::boolean, false) or cardinality(tb) > 0 or coalesce(btrim(p ->> 'toolbox_topic'), '') <> '',
    'Choose the toolbox meeting record (or enter the topic)');
  perform app.require(not exists (select 1 from unnest(tb) t where not exists (select 1 from public.hse_records r
      where r.id = t and r.exec_project_id = p_exec and r.form_code = 'TBT-01' and (r.starts_at at time zone app.tz())::date = p_date)),
    'The toolbox meeting must be one of this project on the report day');
  perform app.require(lvl <> 'supervisor' or exists (select 1 from public.hse_records r where r.exec_project_id = p_exec and r.created_by = auth.uid()
      and r.form_code = 'TBT-01' and (r.starts_at at time zone app.tz())::date = p_date),
    'Hold and record the day''s toolbox meeting first – no daily report without it');
  if lvl = 'supervisor' then
    tb := array(select distinct tid from unnest(tb || array(select r.id from public.hse_records r where r.exec_project_id = p_exec and r.created_by = auth.uid()
      and r.form_code = 'TBT-01' and (r.starts_at at time zone app.tz())::date = p_date)) tid);
    p := p || '{"toolbox_talk": true}';
  end if;
  -- the day's material usage first
  perform app.require(not exists (select 1 from public.material_issues mi where mi.exec_project_id = p_exec and mi.issued_by = auth.uid() and mi.status = 'issued'
      and mi.used_qty is null and mi.day <= p_date),
    'Record the material usage of the day first (Materials – what was used of each issue; the rest goes back to the store)');
  late := now() > app.report_due(lvl, p_date);
  select * into x from public.exec_reports where exec_project_id = p_exec and report_date = p_date and author_id = auth.uid() for update;
  perform app.require(x.id is null or x.status = 'returned', 'Already submitted for this day');
  if x.id is null then
    insert into public.exec_reports (exec_project_id, report_date, level, crew_count, crew, work_done, work_next, delays, inspections, issues, hse_notes,
                                     toolbox_talk, toolbox_topic, safety_check, weather, visitors, is_late)
    values (p_exec, p_date, lvl, nullif(p ->> 'crew_count', '')::int, nullif(btrim(p ->> 'crew'), ''), btrim(p ->> 'work_done'), nullif(btrim(p ->> 'work_next'), ''),
            nullif(btrim(p ->> 'delays'), ''), nullif(btrim(p ->> 'inspections'), ''), nullif(btrim(p ->> 'issues'), ''), nullif(btrim(p ->> 'hse_notes'), ''),
            coalesce((p ->> 'toolbox_talk')::boolean, false), nullif(btrim(p ->> 'toolbox_topic'), ''), coalesce((p ->> 'safety_check')::boolean, false),
            nullif(btrim(p ->> 'weather'), ''), nullif(btrim(p ->> 'visitors'), ''), late)
    returning id into rid;
  else
    update public.exec_reports set status = 'submitted', submitted_at = now(), crew_count = nullif(p ->> 'crew_count', '')::int, crew = nullif(btrim(p ->> 'crew'), ''),
      work_done = btrim(p ->> 'work_done'), work_next = nullif(btrim(p ->> 'work_next'), ''), delays = nullif(btrim(p ->> 'delays'), ''),
      inspections = nullif(btrim(p ->> 'inspections'), ''), issues = nullif(btrim(p ->> 'issues'), ''), hse_notes = nullif(btrim(p ->> 'hse_notes'), ''),
      toolbox_talk = coalesce((p ->> 'toolbox_talk')::boolean, false), toolbox_topic = nullif(btrim(p ->> 'toolbox_topic'), ''),
      safety_check = coalesce((p ->> 'safety_check')::boolean, false), weather = nullif(btrim(p ->> 'weather'), ''), visitors = nullif(btrim(p ->> 'visitors'), '')
    where id = x.id;
    rid := x.id;
  end if;
  -- Planned activities updated from the report: [{id, status, done_qty, note}]
  for u in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'items') = 'array' then p -> 'items' else '[]' end) loop
    select * into it from public.exec_plan_items where id = nullif(u ->> 'id', '')::uuid;
    perform app.require(it.id is not null and it.exec_project_id = p_exec, 'Planned activity not found on this project');
    perform public.update_plan_item(it.id, u ->> 'status', nullif(u ->> 'done_qty', '')::numeric, nullif(btrim(u ->> 'note'), ''));
    select * into it from public.exec_plan_items where id = it.id;
    snap := snap || jsonb_build_array(jsonb_build_object('id', it.id, 'day', it.day, 'kind', it.kind, 'title', it.title, 'zone', it.zone, 'qty', it.qty, 'unit', it.unit,
      'supervisor_id', it.supervisor_id, 'status', it.status, 'done_qty', it.done_qty, 'note', it.result_note, 'photos', '[]'::jsonb));
  end loop;
  -- Supervisor: results of the day's planned works (own approved plan) and the work permits of the day
  if lvl = 'supervisor' then
    for u in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'sub_items') = 'array' then p -> 'sub_items' else '[]' end) loop
      select i.* into si from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
       where i.id = nullif(u ->> 'id', '')::uuid and s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved' and i.day <= p_date;
      perform app.require(si.id is not null, 'Planned work not found in your approved plan');
      perform public.update_sub_plan_item(si.id, u ->> 'status', nullif(u ->> 'done_qty', '')::numeric, nullif(btrim(u ->> 'note'), ''));
    end loop;
    -- planned works taken from the engineers' plan that were reported in section A carry that result
    update public.sub_plan_items i set status = pi.status, done_qty = pi.done_qty, result_note = pi.result_note, updated_at = now()
      from public.exec_plan_items pi, public.sub_plans s
     where i.ae_item_id = pi.id and s.id = i.sub_plan_id and s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved'
       and i.day = p_date and i.status = 'planned' and pi.status <> 'planned';
    select string_agg(i.title, ', ' order by i.title) into miss from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
     where s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved' and i.day = p_date and i.status = 'planned';
    perform app.require(miss is null, 'Give the result of each work of your plan for the day: ' || coalesce(miss, ''));
    select coalesce(array_agg(distinct tv::uuid), '{}') into pids from jsonb_array_elements_text(case when jsonb_typeof(p -> 'permit_ids') = 'array' then p -> 'permit_ids' else '[]' end) tv;
    perform app.require(not exists (select 1 from unnest(pids) t where not exists (select 1 from public.hse_records r
        where r.id = t and r.exec_project_id = p_exec and r.created_by = auth.uid() and r.status in ('active', 'closed') and app.permit_covers(r, p_date))),
      'Refer only your approved work permits of the report day');
    perform app.require(cardinality(pids) > 0 or not exists (select 1 from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
        where s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved' and i.day = p_date and i.status in ('done', 'partial')),
      'Refer the work permit(s) the work was done under');
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'zone', i.zone, 'qty', i.qty, 'unit', i.unit, 'additional', i.additional,
             'status', i.status, 'done_qty', i.done_qty, 'note', i.result_note,
             'permits', (select coalesce(jsonb_agg(r.code order by r.code), '[]') from public.sub_plan_item_permits l join public.hse_records r on r.id = l.permit_id where l.item_id = i.id))
             order by i.created_at), '[]') into ssnap
      from public.sub_plan_items i join public.sub_plans s on s.id = i.sub_plan_id
     where s.supervisor_id = auth.uid() and s.exec_project_id = p_exec and s.status = 'approved' and i.day = p_date;
  end if;
  update public.exec_reports set item_updates = snap, permit_ids = pids, sub_plan_updates = ssnap,
    toolbox_records = case when coalesce((p ->> 'toolbox_talk')::boolean, false) then tb else '{}' end,
    toolbox_topic = case when coalesce((p ->> 'toolbox_talk')::boolean, false) and coalesce(btrim(p ->> 'toolbox_topic'), '') = '' and cardinality(tb) > 0
      then (select string_agg(r.code || ' – ' || left(coalesce(r.header ->> 'activity', ''), 80), ' · ' order by r.starts_at) from public.hse_records r where r.id = any (tb))
      else toolbox_topic end
  where id = rid;
  if late and x.id is null then
    insert into public.exec_report_lateness (exec_project_id, user_id, report_date, level, kind) values (p_exec, auth.uid(), p_date, lvl, 'late')
    on conflict (exec_project_id, user_id, report_date) do update set kind = 'late';
  end if;
  if lvl = 'supervisor' then
    perform app.notify_many(app.project_aes(p_exec), 'exec_report', format('Daily report to verify – %s%s', app.display_name(auth.uid()), case when late then ' (late)' else '' end),
      format('%s · %s', app.exec_head(p_exec), to_char(p_date, 'Dy DD Mon')), 'normal', 'exec_report', rid, '/execution/report/' || rid);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_report', format('Daily report – %s%s', app.display_name(auth.uid()), case when late then ' (late)' else '' end),
      format('%s · %s', app.exec_head(p_exec), to_char(p_date, 'Dy DD Mon')), 'normal', 'exec_report', rid, '/execution/report/' || rid);
  end if;
  return rid;
end $$;

revoke execute on function public.store_balances(uuid), public.set_store_item(uuid, text, text, numeric, boolean, text), public.issue_material(uuid, jsonb),
  public.request_issue_release(uuid, text), public.decide_issue_release(uuid, boolean, text), public.report_material_usage(uuid, numeric, text),
  public.schedule_delivery(uuid, timestamptz, text), public.receive_material(uuid, jsonb, text, uuid, text, text) from public, anon;
grant execute on function public.store_balances(uuid), public.set_store_item(uuid, text, text, numeric, boolean, text), public.issue_material(uuid, jsonb),
  public.request_issue_release(uuid, text), public.decide_issue_release(uuid, boolean, text), public.report_material_usage(uuid, numeric, text),
  public.schedule_delivery(uuid, timestamptz, text), public.receive_material(uuid, jsonb, text, uuid, text, text) to authenticated, service_role;
revoke execute on function public.materials_tick(timestamptz), public.store_balances_all(uuid) from public, anon, authenticated;
grant execute on function public.materials_tick(timestamptz), public.store_balances_all(uuid) to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('materials-tick', '*/30 * * * *', 'select public.materials_tick()');
  end if;
end $$;
