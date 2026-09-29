-- UPDATE 2026-09-29 – Design & Estimation teams (for a database already set up).
-- In the Supabase SQL Editor run STEP 1 on its own first, then STEP 2.

-- STEP 1 (run alone):
--   alter type public.app_role add value if not exists 'designer';

-- STEP 2: everything below
-- DIMO Sales – design & estimation workflow
-- * Separate Design (role 'designer') and Estimation (role 'estimator') teams
-- * Work requests per package: inquiry received → design / estimation → submitted,
--   with a full event timeline, SLA due dates and late tracking
-- * Revision requests from sales based on submitted designs / offers and client feedback
-- * Dashboard overview, Excel sheet and late alerts (push + e-mail)

insert into public.app_settings (key, value, description) values
  ('design_sla_days', '5', 'Default working time (calendar days) for a design request when no due date is given'),
  ('estimation_sla_days', '3', 'Default working time (calendar days) for an estimation request when no due date is given'),
  ('work_due_soon_days', '1', 'Design / estimation requests due within this many days are included in reminders')
on conflict (key) do nothing;

insert into public.lookup_values (list_key, code, label, sort_order)
select list_key, code, label, row_number() over (partition by list_key order by ord) * 10
from (values
  ('design_task_type', 'lighting_layout', 'Lighting layout', 1), ('design_task_type', 'lighting_calc', 'Lighting calculation (DIALux / Relux)', 2),
  ('design_task_type', 'product_selection', 'Product selection / schedule', 3), ('design_task_type', 'render', '3D render / visualisation', 4),
  ('design_task_type', 'controls_design', 'Controls / DALI design', 5), ('design_task_type', 'shop_drawings', 'Shop drawings / submittal', 6),
  ('design_task_type', 'other', 'Other design work', 7),
  ('estimation_task_type', 'boq_pricing', 'BOQ pricing', 1), ('estimation_task_type', 'costing', 'Costing & margin', 2),
  ('estimation_task_type', 'tender_submission', 'Tender submission pack', 3), ('estimation_task_type', 'value_engineering', 'Value engineering / alternatives', 4),
  ('estimation_task_type', 'budgetary', 'Budgetary quotation', 5), ('estimation_task_type', 'other', 'Other estimation work', 6),
  ('revision_reason', 'client_feedback', 'Client feedback', 1), ('revision_reason', 'spec_change', 'Specification change', 2),
  ('revision_reason', 'scope_change', 'Scope / quantity change', 3), ('revision_reason', 'price_high', 'Price too high', 4),
  ('revision_reason', 'alternative', 'Alternative products requested', 5), ('revision_reason', 'consultant_comments', 'Consultant comments', 6),
  ('revision_reason', 'other', 'Other', 7)
) v(list_key, code, label, ord)
on conflict (list_key, code) do nothing;

-- Inquiry date on each package (start of the inquiry → quotation timeline)
alter table public.opportunities add column if not exists inquiry_received_at date;
update public.opportunities set inquiry_received_at = (created_at at time zone 'Asia/Colombo')::date where inquiry_received_at is null;
alter table public.opportunities alter column inquiry_received_at set default ((now() at time zone 'Asia/Colombo')::date);

-- ---------------------------------------------------------------------------
-- Work requests
-- ---------------------------------------------------------------------------
create sequence if not exists public.work_request_code_seq;

create table public.work_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.next_code('WR', 'public.work_request_code_seq'),
  kind text not null check (kind in ('design', 'estimation')),
  opportunity_id uuid not null references public.opportunities (id),
  project_id uuid references public.projects (id),
  task_type text,                     -- lookup: design_task_type / estimation_task_type
  title text not null check (length(trim(title)) > 0),
  description text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'new' check (status in ('new', 'in_progress', 'on_hold', 'submitted', 'cancelled')),
  received_at timestamptz not null default now(),   -- inquiry / request received
  due_date date,                                    -- target submission date (defaults from SLA)
  started_at timestamptz,
  completed_at timestamptz,                         -- submitted to sales
  completed_late boolean,
  requested_by uuid references public.profiles (id) default auth.uid(),
  assigned_to uuid references public.profiles (id),
  revision int not null default 0 check (revision >= 0),
  parent_request_id uuid references public.work_requests (id),
  quotation_id uuid references public.quotations (id),
  revision_reason text,                             -- lookup: revision_reason
  client_feedback text,
  deliverable_note text,
  deliverable_link text,
  last_late_alert_on date,
  version int not null default 1,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create index work_requests_opp_idx on public.work_requests (opportunity_id, kind, revision);
create index work_requests_assignee_idx on public.work_requests (assigned_to, status, due_date);
create index work_requests_kind_status_idx on public.work_requests (kind, status, due_date);
create index work_requests_project_idx on public.work_requests (project_id);

create table public.work_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.work_requests (id) on delete cascade,
  event text not null check (event in ('created', 'assigned', 'started', 'on_hold', 'resumed', 'submitted', 'cancelled',
                                       'reopened', 'due_changed', 'revision_requested', 'note')),
  note text,
  from_value text,
  to_value text,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index work_request_events_req_idx on public.work_request_events (request_id, created_at);

create trigger work_requests_stamp before insert or update on public.work_requests for each row execute function public.tg_stamp();
create trigger work_requests_audit after insert or update or delete on public.work_requests for each row execute function public.tg_audit();

-- Defaults, revision numbering, SLA due date, status time stamps, field guard
create or replace function public.tg_work_request_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent public.work_requests;
  sla int;
  is_team boolean;
begin
  if tg_op = 'INSERT' then
    select project_id into new.project_id from public.opportunities where id = new.opportunity_id;
    if new.parent_request_id is not null then
      select * into parent from public.work_requests where id = new.parent_request_id;
      new.kind := parent.kind;
      new.assigned_to := coalesce(new.assigned_to, parent.assigned_to);
      new.task_type := coalesce(new.task_type, parent.task_type);
    end if;
    new.revision := coalesce((select max(revision) + 1 from public.work_requests
                              where opportunity_id = new.opportunity_id and kind = new.kind), 0);
    new.status := coalesce(new.status, 'new');
    if new.due_date is null then
      sla := coalesce((public.setting(new.kind || '_sla_days') #>> '{}')::int, case when new.kind = 'design' then 5 else 3 end);
      new.due_date := (new.received_at at time zone 'Asia/Colombo')::date + sla;
    end if;
    if new.status = 'in_progress' then new.started_at := coalesce(new.started_at, now()); end if;
    return new;
  end if;

  -- UPDATE: only managers may move a request to another package / kind
  if auth.uid() is not null and not public.is_manager() then
    if new.kind is distinct from old.kind or new.opportunity_id is distinct from old.opportunity_id
       or new.revision is distinct from old.revision or new.parent_request_id is distinct from old.parent_request_id
       or new.requested_by is distinct from old.requested_by then
      raise exception 'Only a manager can move a request to another package' using errcode = '42501';
    end if;
    is_team := (old.kind = 'design' and public.has_role('{designer}')) or (old.kind = 'estimation' and public.has_role('{estimator}'));
    if not is_team then
      -- the requesting salesperson may edit the brief or cancel while it is still new
      if old.status <> 'new' or new.status not in ('new', 'cancelled')
         or new.assigned_to is distinct from old.assigned_to
         or new.deliverable_note is distinct from old.deliverable_note or new.deliverable_link is distinct from old.deliverable_link then
        raise exception 'Only the % team can update this request', old.kind using errcode = '42501';
      end if;
    end if;
  end if;
  new.project_id := old.project_id;
  if new.status = 'in_progress' and old.status <> 'in_progress' then
    new.started_at := coalesce(old.started_at, now());
  end if;
  if new.status = 'submitted' and old.status <> 'submitted' then
    new.completed_at := now();
    new.completed_late := new.due_date is not null and (now() at time zone 'Asia/Colombo')::date > new.due_date;
  elsif new.status <> 'submitted' then
    new.completed_at := null;
    new.completed_late := null;
  end if;
  return new;
end $$;
create trigger work_requests_rules before insert or update on public.work_requests for each row execute function public.tg_work_request_rules();

-- Timeline events, team membership of the project, activity stamps
create or replace function public.tg_work_request_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.work_request_events (request_id, event, note, to_value, created_by)
    values (new.id, case when new.revision > 0 then 'revision_requested' else 'created' end,
            coalesce(new.client_feedback, new.description), new.status, auth.uid());
    if new.assigned_to is not null then
      insert into public.work_request_events (request_id, event, to_value, created_by) values (new.id, 'assigned', new.assigned_to::text, auth.uid());
    end if;
  else
    if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
      insert into public.work_request_events (request_id, event, from_value, to_value, created_by)
      values (new.id, 'assigned', old.assigned_to::text, new.assigned_to::text, auth.uid());
    end if;
    if new.status is distinct from old.status then
      insert into public.work_request_events (request_id, event, from_value, to_value, note, created_by)
      values (new.id,
              case new.status
                when 'in_progress' then case when old.status = 'on_hold' then 'resumed' when old.status in ('submitted', 'cancelled') then 'reopened' else 'started' end
                when 'on_hold' then 'on_hold' when 'submitted' then 'submitted' when 'cancelled' then 'cancelled'
                else 'reopened' end,
              old.status, new.status,
              case when new.status = 'submitted' then coalesce(new.deliverable_note, new.deliverable_link) end, auth.uid());
    end if;
    if new.due_date is distinct from old.due_date then
      insert into public.work_request_events (request_id, event, from_value, to_value, created_by)
      values (new.id, 'due_changed', old.due_date::text, new.due_date::text, auth.uid());
    end if;
  end if;
  if new.assigned_to is not null and new.project_id is not null then
    insert into public.project_members (project_id, user_id, member_role, added_by)
    values (new.project_id, new.assigned_to, case when new.kind = 'design' then 'designer' else 'estimator' end, auth.uid())
    on conflict do nothing;
  end if;
  update public.opportunities set last_activity_at = now() where id = new.opportunity_id;
  update public.projects set last_activity_at = now() where id = new.project_id;
  return null;
end $$;
create trigger work_requests_events after insert or update on public.work_requests for each row execute function public.tg_work_request_events();

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
-- Design / estimation team members can see the projects (and so the packages,
-- customers and contacts) that have requests for their team.
create or replace function public.can_read_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
    or public.is_project_member(p)
    or (public.has_role('{salesperson}') and exists (
      select 1 from public.projects pr where pr.id = p and (
        pr.owner_id = auth.uid() or public.in_my_territory(pr.territory_id)
        or exists (select 1 from public.opportunities o where o.project_id = pr.id and o.owner_id = auth.uid()))))
    or (public.has_role('{designer}') and exists (select 1 from public.work_requests w where w.project_id = p and w.kind = 'design'))
    or (public.has_role('{estimator}') and exists (select 1 from public.work_requests w where w.project_id = p and w.kind = 'estimation'))
$$;

create or replace function public.team_of_kind(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select (k = 'design' and public.has_role('{designer}')) or (k = 'estimation' and public.has_role('{estimator}'))
$$;

create or replace function public.can_read_work_request(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.work_requests w where w.id = r and (
    public.is_manager() or public.team_of_kind(w.kind) or w.requested_by = auth.uid() or w.assigned_to = auth.uid()
    or public.can_read_project(w.project_id)))
$$;

alter table public.work_requests enable row level security;
alter table public.work_request_events enable row level security;
revoke all on public.work_requests, public.work_request_events from anon;
create policy active_users_only on public.work_requests as restrictive for all to authenticated
  using (public.current_app_role() is not null) with check (public.current_app_role() is not null);
create policy active_users_only on public.work_request_events as restrictive for all to authenticated
  using (public.current_app_role() is not null) with check (public.current_app_role() is not null);

create policy read_work on public.work_requests for select to authenticated
  using (public.is_manager() or public.team_of_kind(kind) or requested_by = auth.uid() or assigned_to = auth.uid()
         or created_by = auth.uid() or public.can_read_project(project_id));
create policy insert_work on public.work_requests for insert to authenticated
  with check (public.is_manager() or public.team_of_kind(kind)
              or (public.has_role('{salesperson}') and public.can_read_opportunity(opportunity_id)));
create policy update_work on public.work_requests for update to authenticated
  using (public.is_manager() or public.team_of_kind(kind) or requested_by = auth.uid())
  with check (public.is_manager() or public.team_of_kind(kind) or requested_by = auth.uid());

create policy read_work_events on public.work_request_events for select to authenticated
  using (public.can_read_work_request(request_id));
create policy add_work_notes on public.work_request_events for insert to authenticated
  with check (event = 'note' and created_by = auth.uid() and public.can_read_work_request(request_id));

-- Attachments on work requests (designs, offers, drawings)
alter table public.attachments drop constraint if exists attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check
  check (entity_type in ('customer', 'contact', 'project', 'opportunity', 'visit', 'action', 'quotation', 'milestone', 'work_request'));

create or replace function public.can_read_entity(t text, e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case t
    when 'customer' then public.can_read_customer(e)
    when 'contact' then exists (select 1 from public.contacts c where c.id = e and public.can_read_customer(c.customer_id))
    when 'project' then public.can_read_project(e)
    when 'opportunity' then public.can_read_opportunity(e)
    when 'visit' then public.can_read_visit(e)
    when 'action' then exists (select 1 from public.actions a where a.id = e and (a.owner_id = auth.uid() or a.created_by = auth.uid()
      or public.is_manager() or (a.visit_id is not null and public.can_read_visit(a.visit_id))
      or (a.project_id is not null and public.can_read_project(a.project_id))))
    when 'quotation' then exists (select 1 from public.quotations q where q.id = e and public.can_read_opportunity(q.opportunity_id))
    when 'milestone' then exists (select 1 from public.project_milestones m where m.id = e and public.can_read_project(m.project_id))
    when 'work_request' then public.can_read_work_request(e)
    else false end
$$;

-- ---------------------------------------------------------------------------
-- Dashboard: design & estimation overview (added to dashboard_summary)
-- ---------------------------------------------------------------------------
create or replace function public.work_summary(f jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  d_from date := public.filter_from(f);
  d_to date := public.filter_to(f);
  f_owner uuid := (f ->> 'owner_id')::uuid;
  f_terr uuid := (f ->> 'territory_id')::uuid;
  today date := (now() at time zone 'Asia/Colombo')::date;
  out jsonb;
begin
  with w as (
    select w.*, pr.name as project_name, pr.territory_id,
           (w.status in ('new', 'in_progress', 'on_hold') and w.due_date < today) as late_open,
           (w.completed_at at time zone 'Asia/Colombo')::date as done_on
    from public.work_requests w left join public.projects pr on pr.id = w.project_id
    where w.status <> 'cancelled'
      and (f_owner is null or w.requested_by = f_owner or w.assigned_to = f_owner)
      and (f_terr is null or pr.territory_id = f_terr)),
  k as (select unnest(array['design', 'estimation']) as kind)
  select jsonb_build_object(
    'teams', (select jsonb_object_agg(k.kind, jsonb_build_object(
        'open', (select count(*) from w where w.kind = k.kind and w.status in ('new', 'in_progress', 'on_hold')),
        'unassigned', (select count(*) from w where w.kind = k.kind and w.status in ('new', 'in_progress', 'on_hold') and w.assigned_to is null),
        'in_progress', (select count(*) from w where w.kind = k.kind and w.status = 'in_progress'),
        'on_hold', (select count(*) from w where w.kind = k.kind and w.status = 'on_hold'),
        'late', (select count(*) from w where w.kind = k.kind and w.late_open),
        'received_in_range', (select count(*) from w where w.kind = k.kind and (w.received_at at time zone 'Asia/Colombo')::date between d_from and d_to),
        'submitted_in_range', (select count(*) from w where w.kind = k.kind and w.done_on between d_from and d_to),
        'submitted_late_in_range', (select count(*) from w where w.kind = k.kind and w.done_on between d_from and d_to and w.completed_late),
        'on_time_pct', (select round(100.0 * count(*) filter (where not coalesce(w.completed_late, false)) / nullif(count(*), 0), 0)
                        from w where w.kind = k.kind and w.done_on between d_from and d_to),
        'avg_turnaround_days', (select round(avg(extract(epoch from (w.completed_at - w.received_at)) / 86400)::numeric, 1)
                                from w where w.kind = k.kind and w.done_on between d_from and d_to),
        'revisions_in_range', (select count(*) from w where w.kind = k.kind and w.revision > 0
                               and (w.received_at at time zone 'Asia/Colombo')::date between d_from and d_to)))
      from k),
    'by_person', coalesce((select jsonb_agg(x order by x ->> 'kind', x ->> 'name') from (
        select jsonb_build_object('user_id', w.assigned_to, 'name', coalesce(p.full_name, 'Unassigned'), 'kind', w.kind,
          'open', count(*) filter (where w.status in ('new', 'in_progress', 'on_hold')),
          'late', count(*) filter (where w.late_open),
          'submitted_in_range', count(*) filter (where w.done_on between d_from and d_to)) x
        from w left join public.profiles p on p.id = w.assigned_to
        group by w.assigned_to, p.full_name, w.kind) t
      where (x ->> 'open')::int + (x ->> 'submitted_in_range')::int > 0), '[]'),
    'late_list', coalesce((select jsonb_agg(x order by x ->> 'due_date') from (
        select jsonb_build_object('id', w.id, 'code', w.code, 'kind', w.kind, 'title', w.title, 'due_date', w.due_date,
          'days_late', today - w.due_date, 'assigned', coalesce(a.full_name, 'Unassigned'), 'requested_by', r.full_name,
          'project', w.project_name, 'revision', w.revision) x
        from w left join public.profiles a on a.id = w.assigned_to left join public.profiles r on r.id = w.requested_by
        where w.late_open order by w.due_date limit 100) t), '[]'),
    'inquiry_to_quotation', (
      select jsonb_build_object('count', count(*), 'avg_days', round(avg(q.first_sub - o.inquiry_received_at)::numeric, 1))
      from public.opportunities o
      join lateral (select min(q.submission_date) as first_sub from public.quotations q
                    where q.opportunity_id = o.id and q.status <> 'draft' and q.submission_date is not null) q on true
      where q.first_sub between d_from and d_to and o.deleted_at is null
        and (f_owner is null or o.owner_id = f_owner) and (f_terr is null or o.territory_id = f_terr))
  ) into out;
  return out;
end $$;

alter function public.dashboard_summary(jsonb) rename to dashboard_summary_base;
create or replace function public.dashboard_summary(f jsonb default '{}'::jsonb) returns jsonb
language sql stable set search_path = public as $$
  select public.dashboard_summary_base(f) || jsonb_build_object('work', public.work_summary(f))
$$;

-- Excel: add a "Design & Estimation" sheet
alter function public.export_dataset(jsonb, text) rename to export_dataset_base;
create or replace function public.export_dataset(f jsonb default '{}'::jsonb, p_channel text default 'download')
returns jsonb language plpgsql volatile set search_path = public as $$
declare
  base jsonb := public.export_dataset_base(f, p_channel);
  d_from date := public.filter_from(f);
  d_to date := public.filter_to(f);
  f_owner uuid := (f ->> 'owner_id')::uuid;
  f_terr uuid := (f ->> 'territory_id')::uuid;
  rows jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(w) - 'version' - 'last_late_alert_on' || jsonb_build_object(
      'opportunity_code', o.code, 'opportunity_name', o.name, 'project_code', p.code, 'project_name', p.name,
      'requested_by_name', r.full_name, 'assigned_to_name', a.full_name,
      'turnaround_days', case when w.completed_at is not null then round((extract(epoch from (w.completed_at - w.received_at)) / 86400)::numeric, 1) end,
      'is_late_open', w.status in ('new', 'in_progress', 'on_hold') and w.due_date < (now() at time zone 'Asia/Colombo')::date,
      'inquiry_received_at', o.inquiry_received_at) order by w.code), '[]')
  into rows
  from public.work_requests w
  join public.opportunities o on o.id = w.opportunity_id
  left join public.projects p on p.id = w.project_id
  left join public.profiles r on r.id = w.requested_by
  left join public.profiles a on a.id = w.assigned_to
  where (f_owner is null or w.requested_by = f_owner or w.assigned_to = f_owner)
    and (f_terr is null or p.territory_id = f_terr)
    and (w.status in ('new', 'in_progress', 'on_hold')
         or (w.received_at at time zone 'Asia/Colombo')::date between d_from and d_to
         or (w.completed_at at time zone 'Asia/Colombo')::date between d_from and d_to);
  return jsonb_set(jsonb_set(base, '{sheets,work_requests}', rows), '{row_counts,work_requests}', to_jsonb(jsonb_array_length(rows)));
end $$;

-- ---------------------------------------------------------------------------
-- Alerts: late / due-soon design & estimation work (push + e-mail via daily-alerts)
-- ---------------------------------------------------------------------------
create or replace function public.alert_digests() returns jsonb
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Colombo')::date d),
  open_work as (
    select w.*, pr.name as project_name, a.full_name as assignee_name
    from public.work_requests w left join public.projects pr on pr.id = w.project_id
    left join public.profiles a on a.id = w.assigned_to
    where w.status in ('new', 'in_progress', 'on_hold'))
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object(
      'user_id', p.id, 'email', p.email, 'name', p.full_name, 'role', p.role,
      'push_tokens', coalesce((select jsonb_agg(token) from public.device_push_tokens t where t.user_id = p.id), '[]'),
      'overdue', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'description', a.description, 'due_date', a.due_date) order by a.due_date)
                  from public.actions a, today where a.owner_id = p.id and a.status in ('open', 'in_progress') and a.due_date < today.d), '[]'),
      'due_soon', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'description', a.description, 'due_date', a.due_date) order by a.due_date)
                  from public.actions a, today where a.owner_id = p.id and a.status in ('open', 'in_progress')
                    and a.due_date between today.d and today.d + coalesce((public.setting('reminder_days_before') #>> '{}')::int, 1)), '[]'),
      'escalated', case when p.role in ('manager', 'admin') then coalesce((
                  select jsonb_agg(jsonb_build_object('code', a.code, 'description', a.description, 'due_date', a.due_date, 'owner', o.full_name) order by a.due_date)
                  from public.actions a left join public.profiles o on o.id = a.owner_id
                  where a.escalated and a.status in ('open', 'in_progress') and (a.escalated_to = p.id or p.role = 'admin')), '[]') else '[]' end,
      'deadlines', case when p.role in ('manager', 'admin') then coalesce((
                  select jsonb_agg(jsonb_build_object('code', pr.code, 'name', pr.name, 'tender_closing_date', pr.tender_closing_date,
                                                      'quotation_due_date', pr.quotation_due_date))
                  from public.projects pr, today where pr.status = 'active' and pr.deleted_at is null
                    and (pr.tender_closing_date between today.d and today.d + 7 or pr.quotation_due_date between today.d and today.d + 7)), '[]') else '[]' end,
      'pending_corrections', case when p.role in ('manager', 'admin')
                  then (select count(*) from public.correction_requests where status = 'pending') else 0 end,
      -- late design / estimation work: the assignee, plus the whole team for unassigned requests
      'late_work', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'kind', w.kind, 'title', w.title,
                    'due_date', w.due_date, 'project', w.project_name, 'assigned', w.assignee_name) order by w.due_date)
                  from open_work w, today where w.due_date < today.d and (
                    w.assigned_to = p.id
                    or (w.assigned_to is null and ((w.kind = 'design' and p.role = 'designer') or (w.kind = 'estimation' and p.role = 'estimator'))))), '[]'),
      'work_due_soon', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'kind', w.kind, 'title', w.title,
                    'due_date', w.due_date, 'project', w.project_name) order by w.due_date)
                  from open_work w, today where w.assigned_to = p.id
                    and w.due_date between today.d and today.d + coalesce((public.setting('work_due_soon_days') #>> '{}')::int, 1)), '[]'),
      -- managers: every late request; salespeople: late requests they are waiting for
      'team_late_work', case when p.role in ('manager', 'admin') then coalesce((
                  select jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'kind', w.kind, 'title', w.title, 'due_date', w.due_date,
                    'project', w.project_name, 'assigned', coalesce(w.assignee_name, 'Unassigned')) order by w.due_date)
                  from open_work w, today where w.due_date < today.d), '[]')
                  when p.role = 'salesperson' then coalesce((
                  select jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'kind', w.kind, 'title', w.title, 'due_date', w.due_date,
                    'project', w.project_name, 'assigned', coalesce(w.assignee_name, 'Unassigned')) order by w.due_date)
                  from open_work w, today where w.due_date < today.d and w.requested_by = p.id), '[]')
                  else '[]' end
    ) x
    from public.profiles p where p.active
  ) t
  where jsonb_array_length(x -> 'overdue') + jsonb_array_length(x -> 'due_soon') + jsonb_array_length(x -> 'escalated')
        + jsonb_array_length(x -> 'deadlines') + (x ->> 'pending_corrections')::int
        + jsonb_array_length(x -> 'late_work') + jsonb_array_length(x -> 'work_due_soon') + jsonb_array_length(x -> 'team_late_work') > 0
$$;
revoke execute on function public.alert_digests() from public, anon, authenticated;

-- Record which late items were alerted today (called by daily-alerts)
create or replace function public.mark_late_work_alerted() returns int
language sql volatile security definer set search_path = public as $$
  with u as (
    update public.work_requests set last_late_alert_on = (now() at time zone 'Asia/Colombo')::date
    where status in ('new', 'in_progress', 'on_hold') and due_date < (now() at time zone 'Asia/Colombo')::date
    returning 1)
  select count(*)::int from u
$$;
revoke execute on function public.mark_late_work_alerted() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.work_requests;
  end if;
end $$;
