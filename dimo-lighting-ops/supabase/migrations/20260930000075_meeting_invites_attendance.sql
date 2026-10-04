-- Sales meeting, part 2
--  * Invitations: every Sunday SM Projects selects who is invited to Monday's meeting (anyone except GM / DGM);
--    reminders Sunday 08:00 and 10:00; not done by 15:00 → GM / DGM notified. Invitees get the invitation, updates and
--    requests in their "Internal meetings" tab. The pack covers the invited sales persons.
--  * Attendance through the system: SM Projects starts the meeting (its location becomes the meeting location); each
--    invitee marks present with their location. More than 200 m away (or no location) → SM Projects notified and
--    approves before the person is marked present. Not marked by 12:00 → absent.
--  * Leave from the meeting: any invitee applies with a reason (the Monday visit exception is the same request);
--    SM Projects decides before the meeting starts. Approved → excused.
--  * Actions can name a project and / or customer from the lists, or a new project / customer by name.
--  * Indexes for the pack.

create index if not exists debts_sales_person on public.debts (sales_person_id);
create index if not exists retentions_sales_person on public.retentions (sales_person_id);
create index if not exists visits_next_action on public.visits (sales_person_id, next_action_date) where status = 'open' and next_action_done_at is null;

alter table public.sales_meetings
  add column if not exists initiated_at timestamptz,
  add column if not exists initiated_by uuid references public.profiles (id),
  add column if not exists started_at timestamptz,
  add column if not exists loc_lat double precision,
  add column if not exists loc_lng double precision;

alter table public.sales_meeting_actions
  add column if not exists project_id uuid references public.projects (id),
  add column if not exists organization_id uuid references public.organizations (id),
  add column if not exists new_project text,
  add column if not exists new_customer text;

create table public.sales_meeting_invitees (
  meeting_id uuid not null references public.sales_meetings (id) on delete cascade,
  person_id uuid not null references public.profiles (id),
  status text not null default 'invited' check (status in ('invited', 'present', 'location_check', 'absent', 'excused')),
  invited_at timestamptz not null default now(),
  checkin_at timestamptz,
  lat double precision,
  lng double precision,
  distance_m double precision,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  note text,
  primary key (meeting_id, person_id)
);
alter table public.sales_meeting_invitees enable row level security;
create policy sales_meeting_invitees_read on public.sales_meeting_invitees for select to authenticated
  using (person_id = auth.uid() or exists (select 1 from public.sales_meetings m where m.id = meeting_id));
grant select on public.sales_meeting_invitees to authenticated;

create or replace function app.meeting_start_at(p_date date) returns timestamptz language sql immutable as $$
  select (p_date + time '08:30') at time zone 'Asia/Colombo'
$$;

-- ---------------------------------------------------------------------------
-- Sunday: SM Projects invites (anyone but GM / DGM); can change the list until the meeting starts
-- ---------------------------------------------------------------------------
create or replace function public.invite_sales_meeting(p_date date, p_people uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; mid uuid; p uuid; added int := 0;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects runs the sales meeting');
  perform app.require(p_date is not null and extract(isodow from p_date) = 1, 'Choose a Monday');
  perform app.require(now() < app.meeting_start_at(p_date), 'The meeting has started – invitations can no longer change');
  perform app.require(coalesce(cardinality(p_people), 0) > 0, 'Select who is invited');
  perform app.require(not exists (select 1 from public.profiles x where x.id = any (p_people) and (x.role = 'gm' or not x.active)),
    'GM / DGM and inactive users cannot be invited');
  select * into m from public.sales_meetings where meeting_date = p_date for update;
  perform app.require(m.id is null or m.status = 'draft', 'This meeting is published');
  if m.id is null then
    insert into public.sales_meetings (meeting_date) values (p_date) returning id into mid;
  else
    mid := m.id;
  end if;
  -- Withdrawn invitations
  for p in select person_id from public.sales_meeting_invitees where meeting_id = mid and not (person_id = any (p_people)) loop
    delete from public.sales_meeting_invitees where meeting_id = mid and person_id = p;
    perform app.notify(p, 'meeting_invite', 'Sales meeting invitation withdrawn', format('Monday %s', to_char(p_date, 'DD Mon YYYY')),
      'normal', 'sales_meeting', mid, '/meetings');
  end loop;
  foreach p in array p_people loop
    continue when p = auth.uid();
    insert into public.sales_meeting_invitees (meeting_id, person_id, status)
    values (mid, p, case when exists (select 1 from public.meeting_exceptions e where e.sales_person_id = p and e.meeting_date = p_date and e.status = 'approved')
                         then 'excused' else 'invited' end)
    on conflict (meeting_id, person_id) do nothing;
    if found then
      added := added + 1;
      perform app.notify(p, 'meeting_invite', 'Invited: sales meeting Monday ' || to_char(p_date, 'DD Mon') || ' 08:30 – 12:00',
        'Mark your attendance in Internal meetings when you arrive, or apply for leave before the meeting', 'normal', 'sales_meeting', mid, '/meetings');
    end if;
  end loop;
  update public.sales_meetings set initiated_at = coalesce(initiated_at, now()), initiated_by = coalesce(initiated_by, auth.uid()) where id = mid;
  return mid;
end $$;

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
create or replace function public.start_sales_meeting(p_id uuid, p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_id);
begin
  perform app.require((now() at time zone app.tz())::date = m.meeting_date, 'The meeting can be started on its day only');
  perform app.require(p_lat is not null and p_lng is not null, 'Allow location access – the meeting location is where you start it');
  update public.sales_meetings set started_at = coalesce(started_at, now()), loc_lat = p_lat, loc_lng = p_lng where id = m.id;
  -- Invitees who marked present before the location was set are checked now
  update public.sales_meeting_invitees i set distance_m = app.distance_m(i.lat, i.lng, p_lat, p_lng),
    status = case when i.lat is not null and app.distance_m(i.lat, i.lng, p_lat, p_lng) <= 200 then 'present' else 'location_check' end
   where i.meeting_id = m.id and i.status = 'location_check' and i.decided_at is null;
end $$;

create or replace function public.attend_sales_meeting(p_meeting uuid, p_lat double precision, p_lng double precision) returns text
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; i public.sales_meeting_invitees; d double precision; st text;
begin
  select * into m from public.sales_meetings where id = p_meeting;
  select * into i from public.sales_meeting_invitees where meeting_id = p_meeting and person_id = auth.uid() for update;
  perform app.require(i.person_id is not null, 'You are not invited to this meeting');
  perform app.require(i.status in ('invited', 'location_check'), case i.status when 'excused' then 'You are on approved leave for this meeting'
    when 'present' then 'Already marked present' else 'Attendance is closed' end);
  perform app.require((now() at time zone app.tz())::date = m.meeting_date and (now() at time zone app.tz())::time < time '12:00',
    'Attendance is marked on the meeting day before 12:00');
  d := case when p_lat is not null and m.loc_lat is not null then app.distance_m(p_lat, p_lng, m.loc_lat, m.loc_lng) end;
  st := case when d is not null and d <= 200 then 'present' else 'location_check' end;
  update public.sales_meeting_invitees set checkin_at = now(), lat = p_lat, lng = p_lng, distance_m = d, status = st
   where meeting_id = p_meeting and person_id = auth.uid();
  if st = 'location_check' and m.loc_lat is not null then
    perform app.notify_many(app.role_users('sm_projects'), 'meeting_attendance', 'Meeting attendance – location differs',
      format('%s · %s', app.display_name(auth.uid()), case when d is null then 'no location' else round(d) || ' m from the meeting' end),
      'normal', 'sales_meeting', m.id, '/meeting/' || m.id, null, true);
  end if;
  return st;
end $$;

create or replace function public.decide_attendance(p_meeting uuid, p_person uuid, p_present boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.sales_meeting_invitees;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects approves attendance');
  select * into i from public.sales_meeting_invitees where meeting_id = p_meeting and person_id = p_person for update;
  perform app.require(i.person_id is not null, 'Not invited');
  perform app.require(p_present or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.sales_meeting_invitees set status = case when p_present then 'present' else 'absent' end, decided_by = auth.uid(),
    decided_at = now(), note = nullif(btrim(p_note), '') where meeting_id = p_meeting and person_id = p_person;
  perform app.notify(p_person, 'meeting_attendance', case when p_present then 'Attendance accepted' else 'Marked absent from the sales meeting' end,
    coalesce(nullif(btrim(p_note), ''), ''), 'normal', 'sales_meeting', p_meeting, '/meetings');
end $$;

-- ---------------------------------------------------------------------------
-- Leave from the meeting (also frees Monday 08:30 – 12:00 for visits): any invitee or sales person; decided before it starts
-- ---------------------------------------------------------------------------
create or replace function public.request_meeting_exception(p_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare eid uuid; mid uuid;
begin
  perform app.require(not app.has_role('gm', 'sm_projects'), 'Not needed for your role');
  perform app.require(p_date is not null and extract(isodow from p_date) = 1, 'Choose the Monday');
  perform app.require(now() < app.meeting_start_at(p_date), 'Leave must be applied before the meeting starts');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(not exists (select 1 from public.meeting_exceptions where sales_person_id = auth.uid() and meeting_date = p_date and status <> 'rejected'),
    'Leave for this meeting is already requested');
  delete from public.meeting_exceptions where sales_person_id = auth.uid() and meeting_date = p_date and status = 'rejected';
  insert into public.meeting_exceptions (sales_person_id, meeting_date, reason) values (auth.uid(), p_date, btrim(p_reason)) returning id into eid;
  select id into mid from public.sales_meetings where meeting_date = p_date;
  perform app.notify_many(app.role_users('sm_projects'), 'meeting_exception', 'Leave requested for the sales meeting',
    format('%s · Monday %s · %s', app.display_name(auth.uid()), to_char(p_date, 'DD Mon YYYY'), btrim(p_reason)),
    'normal', 'meeting_exception', eid, '/meeting', null, true);
  return eid;
end $$;

create or replace function public.decide_meeting_exception(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.meeting_exceptions;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects approves leave from the sales meeting');
  select * into e from public.meeting_exceptions where id = p_id for update;
  perform app.require(e.id is not null and e.status = 'pending', 'Already decided');
  perform app.require(now() < app.meeting_start_at(e.meeting_date), 'The meeting has started – leave can only be decided before it');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.meeting_exceptions set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(),
    decided_at = now(), decision_note = nullif(btrim(p_note), '') where id = e.id;
  if p_approve then
    update public.sales_meeting_invitees i set status = 'excused' from public.sales_meetings m
     where m.id = i.meeting_id and m.meeting_date = e.meeting_date and i.person_id = e.sales_person_id;
  end if;
  perform app.notify(e.sales_person_id, 'meeting_exception',
    case when p_approve then 'Leave from the sales meeting approved' else 'Leave from the sales meeting not approved' end,
    format('Monday %s%s', to_char(e.meeting_date, 'DD Mon YYYY'), coalesce(' · ' || nullif(btrim(p_note), ''), '')),
    'normal', 'meeting_exception', e.id, '/meetings');
end $$;

-- ---------------------------------------------------------------------------
-- Actions: a project / customer from the lists, or a new one by name
-- p_data: {sales_person_id, owner_id, action, due_date, project_id, organization_id, new_project, new_customer}
-- ---------------------------------------------------------------------------
create or replace function public.add_meeting_action(p_meeting uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_meeting); aid uuid; owner uuid; pid uuid; oid uuid;
begin
  owner := coalesce(nullif(p_data ->> 'owner_id', '')::uuid, nullif(p_data ->> 'sales_person_id', '')::uuid);
  pid := nullif(p_data ->> 'project_id', '')::uuid;
  oid := nullif(p_data ->> 'organization_id', '')::uuid;
  perform app.require(coalesce(btrim(p_data ->> 'action'), '') <> '', 'Enter the action');
  perform app.require(owner is not null and exists (select 1 from public.profiles where id = owner and active and role <> 'gm'), 'Choose who does it');
  perform app.require(pid is null or exists (select 1 from public.projects where id = pid), 'Project not found');
  perform app.require(oid is null or exists (select 1 from public.organizations where id = oid), 'Customer not found');
  if pid is not null and oid is null then select organization_id into oid from public.projects where id = pid; end if;
  insert into public.sales_meeting_actions (meeting_id, sales_person_id, owner_id, action, due_date, project_id, organization_id, new_project, new_customer)
  values (m.id, nullif(p_data ->> 'sales_person_id', '')::uuid, owner, btrim(p_data ->> 'action'), nullif(p_data ->> 'due_date', '')::date,
    pid, oid, case when pid is null then nullif(btrim(p_data ->> 'new_project'), '') end,
    case when oid is null then nullif(btrim(p_data ->> 'new_customer'), '') end)
  returning id into aid;
  return aid;
end $$;

-- My Day / Internal meetings: my open actions, with the project / customer
drop function if exists public.my_meeting_actions();
create or replace function public.my_meeting_actions() returns table (id uuid, action text, due_date date, meeting_date date, status text,
  project text, customer text, project_id uuid)
language sql stable security definer set search_path = public as $$
  select a.id, a.action, a.due_date, m.meeting_date, a.status,
         coalesce(p.name, a.new_project), coalesce(o.name, a.new_customer), a.project_id
    from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
    left join public.projects p on p.id = a.project_id
    left join public.organizations o on o.id = a.organization_id
   where a.owner_id = auth.uid() and m.status = 'published' and a.status = 'open'
   order by a.due_date nulls last, m.meeting_date
$$;
revoke execute on function public.my_meeting_actions() from public, anon;
grant execute on function public.my_meeting_actions() to authenticated;

-- Internal meetings tab: my invitations (and leave requests)
create or replace function public.my_meetings() returns table (meeting_id uuid, meeting_date date, started boolean, my_status text,
  checkin_at timestamptz, distance_m double precision, leave_status text, leave_reason text, leave_note text, host text)
language sql stable security definer set search_path = public as $$
  select m.id, m.meeting_date, m.started_at is not null, i.status, i.checkin_at, i.distance_m, e.status, e.reason, e.decision_note,
         app.display_name(coalesce(m.initiated_by, (select id from public.profiles where role = 'sm_projects' and active limit 1)))
    from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id
    left join public.meeting_exceptions e on e.sales_person_id = i.person_id and e.meeting_date = m.meeting_date
   where i.person_id = auth.uid() and m.meeting_date >= (now() at time zone app.tz())::date - 56
   order by m.meeting_date desc
$$;
revoke execute on function public.my_meetings() from public, anon;
grant execute on function public.my_meetings() to authenticated;

revoke execute on function public.invite_sales_meeting(date, uuid[]), public.start_sales_meeting(uuid, double precision, double precision),
  public.attend_sales_meeting(uuid, double precision, double precision), public.decide_attendance(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.invite_sales_meeting(date, uuid[]), public.start_sales_meeting(uuid, double precision, double precision),
  public.attend_sales_meeting(uuid, double precision, double precision), public.decide_attendance(uuid, uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Sunday invitations reminders, GM / DGM at 15:00; Monday reminders; absent after 12:00
-- ---------------------------------------------------------------------------
create or replace function public.sales_meeting_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  monday date;
  m public.sales_meetings;
  n int := 0;
  away uuid[];
begin
  if extract(isodow from today) = 7 then
    monday := today + 1;
    select * into m from public.sales_meetings where meeting_date = monday;
    if m.initiated_at is null then
      if loc::time >= time '08:00' then
        perform app.notify_many(app.role_users('sm_projects'), 'sales_meeting', 'Invite the team for tomorrow''s sales meeting by 10:00',
          'Open Sales meeting → Invite for Monday ' || to_char(monday, 'DD Mon'), 'normal', null, null, '/meeting', format('meetinv1:%s', monday), false);
        n := n + 1;
      end if;
      if loc::time >= time '10:00' then
        perform app.notify_many(app.role_users('sm_projects'), 'sales_meeting', 'Sales meeting invitations are overdue (due 10:00)',
          'Invite the team for Monday ' || to_char(monday, 'DD Mon'), 'critical', null, null, '/meeting', format('meetinv2:%s', monday), false);
        n := n + 1;
      end if;
      if loc::time >= time '15:00' then
        perform app.notify_many(app.role_users('gm'), 'sales_meeting', 'Sales meeting not initiated',
          format('SM Projects has not invited the team for Monday %s''s sales meeting', to_char(monday, 'DD Mon')),
          'critical', null, null, '/meeting', format('meetinv3:%s', monday), false);
        n := n + 1;
      end if;
    end if;
    return n;
  end if;

  if extract(isodow from today) <> 1 or loc::time < time '08:00' then return 0; end if;
  select * into m from public.sales_meetings where meeting_date = today;
  if loc::time < time '12:00' then
    if m.initiated_at is not null then
      perform app.notify_many(array(select person_id from public.sales_meeting_invitees where meeting_id = m.id and status = 'invited') || app.role_users('sm_projects'),
        'sales_meeting', 'Sales meeting today 08:30 – 12:00', 'Mark your attendance in Internal meetings when you arrive', 'normal', null, null, '/meetings',
        format('meet:%s', today), false);
    else
      select coalesce(array_agg(sales_person_id), '{}') into away from public.meeting_exceptions where meeting_date = today and status = 'approved';
      perform app.notify_many(array(select x from unnest(app.role_users('asm_building', 'asm_infra')) x where not (x = any (away))) || app.role_users('sm_projects'),
        'sales_meeting', 'Sales meeting today 08:30 – 12:00', 'Weekly sales meeting with SM Projects', 'normal', null, null, '/', format('meet:%s', today), false);
    end if;
    n := n + 1;
    if m.pack is null then
      perform app.notify_many(app.role_users('sm_projects'), 'sales_meeting', 'Generate today''s sales meeting pack',
        'Open Sales meeting and press Generate pack', 'normal', null, null, '/meeting', format('meetpack:%s', today), false);
      n := n + 1;
    end if;
  elsif m.id is not null then
    -- Not marked by 12:00 → absent
    update public.sales_meeting_invitees set status = 'absent', note = coalesce(note, 'Not marked by 12:00')
     where meeting_id = m.id and status = 'invited';
    get diagnostics n = row_count;
  end if;
  return n;
end $$;
revoke execute on function public.sales_meeting_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.sales_meeting_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sales-meeting-tick', '*/15 * * * 0,1', 'select public.sales_meeting_tick()');
  end if;
end $$;

-- The pack covers the invited sales persons (copied from 20260930000073)
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
  mid uuid;
  invited boolean;
begin
  -- Invited sales persons (all active sales persons when nobody was invited)
  select id into mid from public.sales_meetings where meeting_date = p_date;
  invited := exists (select 1 from public.sales_meeting_invitees where meeting_id = mid);
  for sp in select p.id, p.full_name from public.profiles p where p.active and p.role in ('asm_building', 'asm_infra')
               and (not invited or exists (select 1 from public.sales_meeting_invitees i where i.meeting_id = mid and i.person_id = p.id))
             order by p.full_name loop
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

-- Leave and attendance checks in SM Projects' approvals (copied from 20260930000073)
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
  select 'meeting_exception', e.id, 'meeting_exception', format('Sales meeting leave – %s – Monday %s', app.display_name(e.sales_person_id),
         to_char(e.meeting_date, 'DD Mon')), e.reason, e.sales_person_id, app.display_name(e.sales_person_id), e.requested_at, null, '/meeting', null
  from public.meeting_exceptions e
  where e.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'meeting_attendance', m.id, 'meeting_attendance', format('Meeting attendance – %s – location differs', app.display_name(i.person_id)),
         case when i.distance_m is null then 'No location' else round(i.distance_m) || ' m from the meeting' end, i.person_id,
         app.display_name(i.person_id), i.checkin_at, null, '/meeting/' || m.id, null
  from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id
  where i.status = 'location_check' and app.has_role('sm_projects')
  order by 8
$$;
