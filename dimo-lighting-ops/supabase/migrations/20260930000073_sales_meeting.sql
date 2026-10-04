-- Weekly sales meeting (every Monday 08:30 – 12:00), run by SM Projects.
--  * SM Projects generates the meeting pack with a button: a snapshot per sales person (target vs secured vs invoiced,
--    wins / losses of the last week, quotations waiting, follow-ups overdue, visits planned vs done, active projects not
--    visited in 30 days, slipped invoices, debtors over 90 days, retentions due, open actions of earlier meetings).
--    Regenerate while it is a draft; add notes and actions; publish. Published → GM / DGM notified and can view it
--    (read only); nothing changes after publishing except marking actions done.
--  * Sales persons cannot plan visits on Monday between 08:30 and 12:00 unless SM Projects approved an exception
--    (requested with a reason).
--  * Monday 08:00: reminder to sales persons and SM Projects; SM Projects also if the pack is not generated.

create table public.sales_meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null unique check (extract(isodow from meeting_date) = 1),
  status text not null default 'draft' check (status in ('draft', 'published')),
  pack jsonb,
  notes text,
  generated_at timestamptz,
  generated_by uuid references public.profiles (id),
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.sales_meeting_notes (
  meeting_id uuid not null references public.sales_meetings (id) on delete cascade,
  sales_person_id uuid not null references public.profiles (id),
  note text not null,
  updated_at timestamptz not null default now(),
  primary key (meeting_id, sales_person_id)
);

create table public.sales_meeting_actions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.sales_meetings (id) on delete cascade,
  sales_person_id uuid references public.profiles (id),      -- whose part of the meeting it belongs to (null = general)
  owner_id uuid not null references public.profiles (id),     -- who must do it
  action text not null,
  due_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  done_at timestamptz,
  done_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.sales_meeting_actions (sales_person_id, status);

create table public.meeting_exceptions (
  id uuid primary key default gen_random_uuid(),
  sales_person_id uuid not null default auth.uid() references public.profiles (id),
  meeting_date date not null check (extract(isodow from meeting_date) = 1),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  unique (sales_person_id, meeting_date)
);

alter table public.sales_meetings enable row level security;
alter table public.sales_meeting_notes enable row level security;
alter table public.sales_meeting_actions enable row level security;
alter table public.meeting_exceptions enable row level security;
-- SM Projects sees every meeting; GM / DGM only published ones; sales persons none (they see their exceptions only)
create policy sales_meetings_read on public.sales_meetings for select to authenticated
  using (app.has_role('sm_projects') or (app.has_role('gm') and status = 'published'));
create policy sales_meeting_notes_read on public.sales_meeting_notes for select to authenticated
  using (exists (select 1 from public.sales_meetings m where m.id = meeting_id));
create policy sales_meeting_actions_read on public.sales_meeting_actions for select to authenticated
  using (exists (select 1 from public.sales_meetings m where m.id = meeting_id));
create policy meeting_exceptions_read on public.meeting_exceptions for select to authenticated
  using (sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'));
grant select on public.sales_meetings, public.sales_meeting_notes, public.sales_meeting_actions, public.meeting_exceptions to authenticated;

create or replace function app.meeting_for_edit(p_id uuid) returns public.sales_meetings
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects runs the sales meeting');
  select * into m from public.sales_meetings where id = p_id for update;
  perform app.require(m.id is not null, 'Meeting not found');
  perform app.require(m.status = 'draft', 'The meeting is published – it can no longer be changed');
  return m;
end $$;

-- ---------------------------------------------------------------------------
-- The pack: a snapshot for the meeting date (last week = the 7 days before it)
-- ---------------------------------------------------------------------------
create or replace function app.sales_meeting_pack(p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fy int := app.fy_of(p_date);
  mon date := app.month_of(p_date);
  wk date := p_date - 7;
  perf jsonb := public.finance_performance(app.fy_of(p_date));
  people jsonb := '[]';
  sp record;
  pp jsonb;
  t record;
  o jsonb;
  team jsonb;
begin
  for sp in select p.id, p.full_name from public.profiles p where p.active and p.role in ('asm_building', 'asm_infra') order by p.full_name loop
    select x into pp from jsonb_array_elements(perf -> 'people') x where x ->> 'id' = sp.id::text;
    select coalesce(sum(m.secured_target), 0) st, coalesce(sum(m.secured), 0) s, coalesce(sum(m.invoice_target), 0) it, coalesce(sum(m.invoiced), 0) i
      into t from jsonb_to_recordset(coalesce(pp -> 'months', '[]')) m(month date, secured_target numeric, secured numeric, invoice_target numeric, invoiced numeric)
     where m.month <= mon;
    o := jsonb_build_object(
      'id', sp.id, 'name', sp.full_name,
      'target', jsonb_build_object('budget_secure', t.st, 'secured', t.s, 'budget_invoice', t.it, 'invoiced', t.i,
        'secured_pct', case when t.st > 0 then round(t.s / t.st * 100, 2) else 0 end,
        'invoiced_pct', case when t.it > 0 then round(t.i / t.it * 100, 2) else 0 end,
        'score', round(0.4 * case when t.st > 0 then t.s / t.st * 100 else 0 end + 0.6 * case when t.it > 0 then t.i / t.it * 100 else 0 end, 2)),
      'wins', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'customer', i.customer_name,
          'value', round(coalesce(app.to_lkr(i.order_value, i.currency, i.order_date), 0), 2)) order by i.order_date)
        from public.inquiries i where i.sales_person_id = sp.id and i.result = 'won'
         and coalesce(i.order_date, i.updated_at::date) >= wk and coalesce(i.order_date, i.updated_at::date) < p_date), '[]'),
      'losses', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'customer', i.customer_name,
          'reason', i.lost_reason))
        from public.inquiries i where i.sales_person_id = sp.id and i.result = 'lost' and i.updated_at::date >= wk and i.updated_at::date < p_date), '[]'),
      'quotes_waiting_n', (select count(*) from public.inquiries i where i.sales_person_id = sp.id
         and i.status in ('submitted_to_client', 'awaiting_client_approval')),
      'quotes_waiting', coalesce((select jsonb_agg(q) from (
          select jsonb_build_object('code', i.code, 'project', coalesce(i.project_name, ''), 'customer', i.customer_name,
                 'days', p_date - coalesce(i.submitted_to_client_at, i.quotation_released_at, i.updated_at)::date) q
            from public.inquiries i where i.sales_person_id = sp.id and i.status in ('submitted_to_client', 'awaiting_client_approval')
           order by coalesce(i.submitted_to_client_at, i.quotation_released_at, i.updated_at) limit 10) z), '[]'),
      'followups_overdue_n', (select count(*) from public.visits v where v.sales_person_id = sp.id and v.status = 'open'
         and v.next_action_date < p_date and v.next_action_done_at is null),
      'followups_overdue', coalesce((select jsonb_agg(f) from (
          select jsonb_build_object('date', v.next_action_date, 'customer', o2.name, 'action', v.next_action) f
            from public.visits v join public.organizations o2 on o2.id = v.organization_id
           where v.sales_person_id = sp.id and v.status = 'open' and v.next_action_date < p_date and v.next_action_done_at is null
           order by v.next_action_date limit 10) z), '[]'),
      'visits', jsonb_build_object(
        'planned', (select count(*) from public.visit_plan_lines l join public.visit_plans vp on vp.id = l.plan_id
                     where vp.sales_person_id = sp.id and l.planned_date >= wk and l.planned_date < p_date and l.status <> 'cancelled'),
        'completed', (select count(*) from public.visit_plan_lines l join public.visit_plans vp on vp.id = l.plan_id
                     where vp.sales_person_id = sp.id and l.planned_date >= wk and l.planned_date < p_date and l.status = 'completed'),
        'missed', (select count(*) from public.visit_plan_lines l join public.visit_plans vp on vp.id = l.plan_id
                     where vp.sales_person_id = sp.id and l.planned_date >= wk and l.planned_date < p_date and l.status = 'missed'),
        'done', (select count(*) from public.visits v where v.sales_person_id = sp.id
                  and (v.checkin_at at time zone app.tz())::date >= wk and (v.checkin_at at time zone app.tz())::date < p_date)),
      'not_visited_n', (select count(*) from public.projects pr where pr.owner_id = sp.id and pr.status = 'active'
         and coalesce((select max(v.checkin_at) from public.visits v where v.project_id = pr.id), pr.created_at) < p_date - 30),
      'not_visited', coalesce((select jsonb_agg(n) from (
          select jsonb_build_object('project', pr.name, 'value', round(coalesce(app.to_lkr(pr.lighting_value, case when pr.duty_status = 'duty_free' then 'USD'::public.currency else 'LKR'::public.currency end, p_date), 0), 2),
                 'last_visit', (select max(v.checkin_at)::date from public.visits v where v.project_id = pr.id)) n
            from public.projects pr where pr.owner_id = sp.id and pr.status = 'active'
             and coalesce((select max(v.checkin_at) from public.visits v where v.project_id = pr.id), pr.created_at) < p_date - 30
           order by pr.lighting_value desc nulls last limit 5) z), '[]'),
      'invoices', (select jsonb_build_object(
          'slipped_n', count(*) filter (where v.forecast_month < mon),
          'slipped', coalesce(sum(v.remaining) filter (where v.forecast_month < mon), 0),
          'due_month', coalesce(sum(v.remaining) filter (where v.forecast_month = mon), 0))
        from public.invoice_line_status v where v.sales_person_id = sp.id and v.project_status = 'open' and v.remaining > 0.5),
      'debtors_90', (select jsonb_build_object('n', count(*), 'lkr', round(coalesce(sum(app.to_lkr(d.amount, d.currency, p_date)), 0), 2))
        from public.debts d where d.sales_person_id = sp.id and d.outstanding_days > 90
         and d.status not in ('collected', 'collected_confirmed', 'cleared')),
      'retentions_due', (select jsonb_build_object('n', count(*), 'lkr', round(coalesce(sum(app.to_lkr(r.retention_value, r.currency, p_date)), 0), 2))
        from public.retentions r where r.sales_person_id = sp.id and r.status = 'held' and r.due_date <= p_date + 30),
      'open_actions', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'due', a.due_date, 'meeting', m.meeting_date,
          'owner', app.display_name(a.owner_id)) order by m.meeting_date)
        from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
         where a.sales_person_id = sp.id and a.status = 'open' and m.meeting_date < p_date), '[]'),
      'exception', (select jsonb_build_object('status', e.status, 'reason', e.reason) from public.meeting_exceptions e
        where e.sales_person_id = sp.id and e.meeting_date = p_date)
    );
    people := people || o;
  end loop;
  select jsonb_build_object(
      'budget_secure', coalesce(sum((x -> 'target' ->> 'budget_secure')::numeric), 0), 'secured', coalesce(sum((x -> 'target' ->> 'secured')::numeric), 0),
      'budget_invoice', coalesce(sum((x -> 'target' ->> 'budget_invoice')::numeric), 0), 'invoiced', coalesce(sum((x -> 'target' ->> 'invoiced')::numeric), 0),
      'wins_n', coalesce(sum(jsonb_array_length(x -> 'wins')), 0), 'losses_n', coalesce(sum(jsonb_array_length(x -> 'losses')), 0),
      'wins_value', coalesce(sum((select sum((w ->> 'value')::numeric) from jsonb_array_elements(x -> 'wins') w)), 0),
      'quotes_waiting_n', coalesce(sum((x ->> 'quotes_waiting_n')::int), 0), 'followups_overdue_n', coalesce(sum((x ->> 'followups_overdue_n')::int), 0),
      'slipped_n', coalesce(sum((x -> 'invoices' ->> 'slipped_n')::int), 0), 'slipped', coalesce(sum((x -> 'invoices' ->> 'slipped')::numeric), 0),
      'debtors_90', coalesce(sum((x -> 'debtors_90' ->> 'lkr')::numeric), 0))
    into team from jsonb_array_elements(people) x;
  return jsonb_build_object('meeting_date', p_date, 'fy', fy, 'month', mon, 'week_from', wk, 'week_to', p_date - 1,
    'generated_at', now(), 'team', team, 'people', people);
end $$;

create or replace function public.generate_sales_meeting(p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; mid uuid;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects runs the sales meeting');
  perform app.require(p_date is not null and extract(isodow from p_date) = 1, 'Choose a Monday');
  select * into m from public.sales_meetings where meeting_date = p_date for update;
  perform app.require(m.id is null or m.status = 'draft', 'This meeting is published – it can no longer be regenerated');
  if m.id is null then
    insert into public.sales_meetings (meeting_date) values (p_date) returning id into mid;
  else
    mid := m.id;
  end if;
  update public.sales_meetings set pack = app.sales_meeting_pack(p_date), generated_at = now(), generated_by = auth.uid() where id = mid;
  return mid;
end $$;

-- p_sales_person null = general meeting notes
create or replace function public.save_meeting_note(p_meeting uuid, p_sales_person uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_meeting);
begin
  if p_sales_person is null then
    update public.sales_meetings set notes = nullif(btrim(p_note), '') where id = m.id;
  elsif coalesce(btrim(p_note), '') = '' then
    delete from public.sales_meeting_notes where meeting_id = m.id and sales_person_id = p_sales_person;
  else
    insert into public.sales_meeting_notes (meeting_id, sales_person_id, note) values (m.id, p_sales_person, btrim(p_note))
    on conflict (meeting_id, sales_person_id) do update set note = excluded.note, updated_at = now();
  end if;
end $$;

-- p_data: {sales_person_id, owner_id, action, due_date}
create or replace function public.add_meeting_action(p_meeting uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_meeting); aid uuid; owner uuid;
begin
  owner := coalesce(nullif(p_data ->> 'owner_id', '')::uuid, nullif(p_data ->> 'sales_person_id', '')::uuid);
  perform app.require(coalesce(btrim(p_data ->> 'action'), '') <> '', 'Enter the action');
  perform app.require(owner is not null and exists (select 1 from public.profiles where id = owner and active), 'Choose who does it');
  insert into public.sales_meeting_actions (meeting_id, sales_person_id, owner_id, action, due_date)
  values (m.id, nullif(p_data ->> 'sales_person_id', '')::uuid, owner, btrim(p_data ->> 'action'), nullif(p_data ->> 'due_date', '')::date)
  returning id into aid;
  return aid;
end $$;

create or replace function public.delete_meeting_action(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions;
begin
  select * into a from public.sales_meeting_actions where id = p_id;
  perform app.require(a.id is not null, 'Not found');
  perform app.meeting_for_edit(a.meeting_id);
  delete from public.sales_meeting_actions where id = a.id;
end $$;

-- Follow-up: SM Projects marks actions done (also after the meeting is published)
create or replace function public.set_meeting_action_done(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects updates meeting actions');
  update public.sales_meeting_actions set status = case when p_done then 'done' else 'open' end,
    done_at = case when p_done then now() end, done_by = case when p_done then auth.uid() end where id = p_id;
end $$;

create or replace function public.publish_sales_meeting(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_id);
begin
  perform app.require(m.pack is not null, 'Generate the meeting pack first');
  update public.sales_meetings set status = 'published', published_at = now(), published_by = auth.uid() where id = m.id;
  perform app.notify_many(app.role_users('gm'), 'sales_meeting', 'Sales meeting pack – ' || to_char(m.meeting_date, 'DD Mon YYYY'),
    format('%s actions · published by %s', (select count(*) from public.sales_meeting_actions where meeting_id = m.id), app.display_name(auth.uid())),
    'normal', 'sales_meeting', m.id, '/meeting/' || m.id);
end $$;

-- ---------------------------------------------------------------------------
-- Monday 08:30 – 12:00 is kept free: no visit planned in it without SM Projects' exception
-- ---------------------------------------------------------------------------
create or replace function public.request_meeting_exception(p_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  perform app.require(app.is_sales_person(), 'Sales persons request meeting exceptions');
  perform app.require(p_date is not null and extract(isodow from p_date) = 1, 'Choose the Monday');
  perform app.require(p_date >= (now() at time zone app.tz())::date, 'That Monday has passed');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason (e.g. client meeting only possible on Monday morning)');
  perform app.require(not exists (select 1 from public.meeting_exceptions where sales_person_id = auth.uid() and meeting_date = p_date and status <> 'rejected'),
    'An exception for this Monday is already requested');
  delete from public.meeting_exceptions where sales_person_id = auth.uid() and meeting_date = p_date and status = 'rejected';
  insert into public.meeting_exceptions (sales_person_id, meeting_date, reason) values (auth.uid(), p_date, btrim(p_reason)) returning id into eid;
  perform app.notify_many(app.role_users('sm_projects'), 'meeting_exception', 'Sales meeting exception requested',
    format('%s · Monday %s · %s', app.display_name(auth.uid()), to_char(p_date, 'DD Mon YYYY'), btrim(p_reason)),
    'normal', 'meeting_exception', eid, '/meeting', null, true);
  return eid;
end $$;

create or replace function public.decide_meeting_exception(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.meeting_exceptions;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects approves sales meeting exceptions');
  select * into e from public.meeting_exceptions where id = p_id for update;
  perform app.require(e.id is not null and e.status = 'pending', 'Already decided');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.meeting_exceptions set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(),
    decided_at = now(), decision_note = nullif(btrim(p_note), '') where id = e.id;
  perform app.notify(e.sales_person_id, 'meeting_exception',
    case when p_approve then 'Sales meeting exception approved' else 'Sales meeting exception not approved' end,
    format('Monday %s%s', to_char(e.meeting_date, 'DD Mon YYYY'), coalesce(' · ' || nullif(btrim(p_note), ''), '')),
    'normal', 'meeting_exception', e.id, '/plan');
end $$;

-- Start / end time of a free-text time slot ("10:00", "9.30-11:00", "2pm", "afternoon"); null when it cannot be read
create or replace function app.slot_times(p text, out t1 time, out t2 time)
language plpgsql immutable as $$
declare m text[]; i int := 0; h int; mi int; t time;
begin
  for m in select regexp_matches(lower(coalesce(p, '')), '(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?', 'g') loop
    h := m[1]::int; mi := coalesce(m[2], '0')::int;
    if m[3] = 'pm' and h < 12 then h := h + 12; elsif m[3] = 'am' and h = 12 then h := 0; end if;
    continue when h > 23 or mi > 59;
    t := make_time(h, mi, 0);
    i := i + 1;
    if i = 1 then t1 := t; elsif i = 2 then t2 := t; end if;
  end loop;
  if t1 is null then
    if p ~* 'afternoon|evening|after\s*lunch' then t1 := time '13:00'; end if;
  end if;
end $$;

create or replace function app.visit_line_meeting_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare sp uuid; s time; e time;
begin
  if extract(isodow from new.planned_date) <> 1 or new.status in ('cancelled', 'rescheduled', 'missed') then return new; end if;
  -- Only when a visit is planned or moved (status changes such as completed / missed are never blocked)
  if tg_op = 'UPDATE' and new.planned_date = old.planned_date and new.time_slot is not distinct from old.time_slot then
    return new;
  end if;
  select vp.sales_person_id into sp from public.visit_plans vp where vp.id = new.plan_id;
  if not exists (select 1 from public.profiles where id = sp and role in ('asm_building', 'asm_infra')) then return new; end if;
  if exists (select 1 from public.meeting_exceptions where sales_person_id = sp and meeting_date = new.planned_date and status = 'approved') then
    return new;
  end if;
  select t1, t2 into s, e from app.slot_times(new.time_slot);
  perform app.require(s is not null,
    'Monday 08:30 – 12:00 is the sales meeting – enter the visit time (e.g. 13:30), or ask SM Projects for an exception');
  perform app.require(not (s < time '12:00' and coalesce(e, s + interval '1 minute') > time '08:30'),
    'Monday 08:30 – 12:00 is the sales meeting – plan the visit from 12:00, or ask SM Projects for an exception with the reason');
  return new;
end $$;
drop trigger if exists visit_line_meeting_check on public.visit_plan_lines;
create trigger visit_line_meeting_check before insert or update on public.visit_plan_lines
  for each row execute function app.visit_line_meeting_check();

revoke execute on function public.generate_sales_meeting(date), public.save_meeting_note(uuid, uuid, text), public.add_meeting_action(uuid, jsonb),
  public.delete_meeting_action(uuid), public.set_meeting_action_done(uuid, boolean), public.publish_sales_meeting(uuid),
  public.request_meeting_exception(date, text), public.decide_meeting_exception(uuid, boolean, text) from public, anon;
grant execute on function public.generate_sales_meeting(date), public.save_meeting_note(uuid, uuid, text), public.add_meeting_action(uuid, jsonb),
  public.delete_meeting_action(uuid), public.set_meeting_action_done(uuid, boolean), public.publish_sales_meeting(uuid),
  public.request_meeting_exception(date, text), public.decide_meeting_exception(uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Monday 08:00 reminders
-- ---------------------------------------------------------------------------
create or replace function public.sales_meeting_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  n int := 0;
  away uuid[];
begin
  if extract(isodow from today) <> 1 or loc::time < time '08:00' or loc::time >= time '12:00' then return 0; end if;
  select coalesce(array_agg(sales_person_id), '{}') into away from public.meeting_exceptions where meeting_date = today and status = 'approved';
  perform app.notify_many(array(select x from unnest(app.role_users('asm_building', 'asm_infra')) x where not (x = any (away))) || app.role_users('sm_projects'),
    'sales_meeting', 'Sales meeting today 08:30 – 12:00', 'Weekly sales meeting with SM Projects', 'normal', null, null, '/', format('meet:%s', today), false);
  n := n + 1;
  if not exists (select 1 from public.sales_meetings where meeting_date = today and pack is not null) then
    perform app.notify_many(app.role_users('sm_projects'), 'sales_meeting', 'Generate today''s sales meeting pack',
      'Open Sales meeting and press Generate pack', 'normal', null, null, '/meeting', format('meetpack:%s', today), false);
    n := n + 1;
  end if;
  return n;
end $$;
revoke execute on function public.sales_meeting_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.sales_meeting_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sales-meeting-tick', '*/15 * * * 1', 'select public.sales_meeting_tick()');
  end if;
end $$;

-- Exceptions in SM Projects' approvals (copied from 20260930000062)
create or replace function public.my_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
  select 'approval', a.id, a.kind::text, a.title, a.reason, a.requested_by, app.display_name(a.requested_by), a.requested_at,
         a.inquiry_id, case when a.inquiry_id is not null then app.inquiry_url(a.inquiry_id) else '/approvals' end,
         format('Step %s of %s', a.current_step, (select count(*) from public.approval_steps x where x.approval_id = a.id))
  from public.approvals a
  join public.approval_steps s on s.approval_id = a.id and s.step_no = a.current_step
  where a.status = 'pending' and (s.approver_role = app.my_role() or (app.my_role() = 'gm' and s.approver_role = 'gm'))
  union all
  select 'visit_plan', p.id, 'weekly_plan', format('Weekly plan – %s – week of %s', app.display_name(p.sales_person_id), to_char(p.week_start, 'DD Mon')),
         case when p.is_late then 'Submitted late' end, p.sales_person_id, app.display_name(p.sales_person_id), p.submitted_at,
         null, '/plan/' || p.id, null
  from public.visit_plans p where p.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'design_review', d.id, 'design_release', format('Design review – %s (%s)', i.code, d.task_type), i.project_name,
         d.assignee_id, app.display_name(d.assignee_id), d.submitted_at, i.id, '/design/' || d.id, null
  from public.design_jobs d join public.inquiries i on i.id = d.inquiry_id
  where d.status = 'in_review' and app.has_role('design_manager')
  union all
  select 'quotation_review', e.id, 'quotation_release', format('Quotation approval – %s', i.code), i.project_name,
         e.assignee_id, app.display_name(e.assignee_id), e.submitted_at, i.id, '/estimation/' || e.id, null
  from public.estimation_jobs e join public.inquiries i on i.id = e.inquiry_id
  where e.status = 'submitted_for_approval' and app.has_role('sm_estimation')
  union all
  select 'sample', sm.id, 'sample_request', format('Sample request %s', sm.code), sm.purpose,
         sm.sales_person_id, app.display_name(sm.sales_person_id), sm.submitted_at, null, '/samples/' || sm.id, sm.status
  from public.samples sm
  where (sm.status = 'submitted' and app.has_role('operations_exec'))
     or (sm.status = 'availability_confirmed' and app.has_role('sm_projects'))
     or (sm.status = 'gm_approval' and app.has_role('gm'))
  union all
  select 'claim_dispute', c.id, 'warranty_dispute', format('Warranty dispute – %s – %s', c.code, w.customer), c.dispute_reason,
         c.disputed_by, app.display_name(c.disputed_by), c.disputed_at, null, app.claim_url(c.id), app.fault_cause_label(c.fault_cause)
  from public.warranty_claims c join public.warranties w on w.id = c.warranty_id
  where c.dispute_status = 'pending' and app.has_role('sm_projects', 'gm')
  union all
  select 'variation', v.id, 'secured_variation',
         format('Variation %s%s – %s', case when v.amount > 0 then '+' else '−' end, app.fmt_money(abs(v.amount), 'LKR'), s.project_name),
         concat_ws(' · ', v.vo_no, v.reason), v.requested_by, app.display_name(v.requested_by), v.requested_at, null, app.secured_url(s.id), null
  from public.secured_variations v join public.secured_projects s on s.id = v.secured_id
  where v.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'meeting_exception', e.id, 'meeting_exception', format('Sales meeting exception – %s – Monday %s', app.display_name(e.sales_person_id),
         to_char(e.meeting_date, 'DD Mon')), e.reason, e.sales_person_id, app.display_name(e.sales_person_id), e.requested_at, null, '/meeting', null
  from public.meeting_exceptions e
  where e.status = 'pending' and app.has_role('sm_projects')
  order by 8
$$;
