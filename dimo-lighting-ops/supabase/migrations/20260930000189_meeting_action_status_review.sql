-- Status review of the actions assigned in a meeting, before the next meeting of the same team starts.
--  * The person doing an open action posts a status update: on track, delayed or blocked, with a note (done is confirmed as before).
--    The owner, the appointed person, the meeting host or SM Projects can post. Delayed / blocked → the host and the sales person.
--  * The "Status review" button on a published meeting line shows every action of that meeting: status, due date, who does it,
--    the latest update and whether it was updated since the meeting, against the start of the next meeting.
--  * 24 hours before the next meeting starts: the people with open actions not updated since the meeting are reminded.
--    1 hour before: the host gets the list of actions still without an update.

create table public.meeting_action_reviews (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.sales_meeting_actions (id) on delete cascade,
  state text not null check (state in ('on_track', 'delayed', 'blocked')),
  note text not null,
  by_id uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.meeting_action_reviews (action_id, created_at desc);
alter table public.meeting_action_reviews enable row level security;
create policy meeting_action_reviews_read on public.meeting_action_reviews for select to authenticated
  using (exists (select 1 from public.sales_meeting_actions a where a.id = action_id));
grant select on public.meeting_action_reviews to authenticated;

-- When the next meeting of the same team (and the same project, for project meetings) starts; a week later if none is set yet
create or replace function app.next_meeting_starts(m public.sales_meetings) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select app.meeting_starts(n) from public.sales_meetings n
      where n.team = m.team and n.exec_project_id is not distinct from m.exec_project_id and n.meeting_date > m.meeting_date
      order by n.meeting_date limit 1),
    ((m.meeting_date + 7) + m.starts_at) at time zone app.tz())
$$;

-- The person who reports on an action: the appointed person for team tasks, otherwise the owner
create or replace function app.action_doer(a public.sales_meeting_actions) returns uuid language sql immutable as $$
  select coalesce(a.assignee_id, a.owner_id)
$$;

create or replace function public.review_meeting_action(p_id uuid, p_state text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions; m public.sales_meetings;
begin
  select * into a from public.sales_meeting_actions where id = p_id;
  perform app.require(a.id is not null and app.meeting_published(a.meeting_id), 'Action not found');
  select * into m from public.sales_meetings where id = a.meeting_id;
  perform app.require(auth.uid() in (a.owner_id, a.assignee_id) or app.is_meeting_host(m.team) or app.has_role('sm_projects'),
    'Only the person doing it, the owner or the meeting host can update it');
  perform app.require(a.status = 'open', 'Already done');
  perform app.require(p_state in ('on_track', 'delayed', 'blocked'), 'Choose the status');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Write a short status note');
  insert into public.meeting_action_reviews (action_id, state, note) values (a.id, p_state, btrim(p_note));
  if p_state <> 'on_track' then
    perform app.notify_many(array_remove(app.action_people(a), auth.uid()), 'meeting_action',
      case p_state when 'blocked' then 'Meeting action blocked' else 'Meeting action delayed' end,
      format('%s · %s · %s', app.display_name(auth.uid()), app.action_subject(a), btrim(p_note)),
      case p_state when 'blocked' then 'critical' else 'normal' end::public.priority, 'sales_meeting', a.meeting_id, '/meeting/review/' || a.meeting_id, null, true);
  end if;
end $$;
revoke execute on function public.review_meeting_action(uuid, text, text) from public, anon;
grant execute on function public.review_meeting_action(uuid, text, text) to authenticated;

-- The status review of one meeting (read with the caller's rights: whoever can open the meeting)
create or replace function public.meeting_status_review(p_meeting uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'meeting', jsonb_build_object('id', m.id, 'team', m.team, 'meeting_date', m.meeting_date, 'published_at', m.published_at,
                                  'title', app.meeting_label(m.team)),
    'next_starts', app.next_meeting_starts(m),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'action', a.action, 'kind', a.kind, 'status', a.status, 'due_date', a.due_date,
               'owner', app.display_name(a.owner_id), 'assignee', app.display_name(a.assignee_id),
               'doer', app.display_name(app.action_doer(a)), 'sales_person', app.display_name(a.sales_person_id),
               'project', coalesce(p.name, a.new_project), 'customer', coalesce(o.name, a.new_customer),
               'done_at', a.done_at, 'done_note', a.done_note, 'unappointed', a.kind in ('design', 'estimation', 'execution') and a.assignee_id is null,
               'visit', (select jsonb_build_object('date', l.planned_date, 'status', l.status) from public.visit_plan_lines l
                          where l.meeting_action_id = a.id order by (l.status = 'planned') desc, l.created_at desc limit 1),
               'last', (select jsonb_build_object('state', r.state, 'note', r.note, 'by', app.display_name(r.by_id), 'at', r.created_at)
                          from public.meeting_action_reviews r where r.action_id = a.id order by r.created_at desc limit 1),
               'updated', a.status = 'done' or exists (select 1 from public.meeting_action_reviews r where r.action_id = a.id and r.created_at >= m.published_at))
             order by (a.status = 'done'), a.due_date nulls last, a.created_at)
        from public.sales_meeting_actions a
        left join public.projects p on p.id = a.project_id
        left join public.organizations o on o.id = a.organization_id
       where a.meeting_id = m.id), '[]'::jsonb))
    from public.sales_meetings m
   where m.id = p_meeting and m.status = 'published'
$$;
revoke execute on function public.meeting_status_review(uuid) from public, anon;
grant execute on function public.meeting_status_review(uuid) to authenticated;

-- My actions now carry the latest status update and when the review is due
drop function if exists public.my_meeting_actions();
create function public.my_meeting_actions() returns table (id uuid, action text, due_date date, meeting_date date, status text,
  project text, customer text, project_id uuid, kind text, my_part text, owner text, assignee text, assignee_id uuid, sales_person text,
  objective text, plan_id uuid, planned_date date, time_slot text, line_status text, assign_by timestamptz, meeting_id uuid,
  review_state text, review_note text, review_at timestamptz, review_due timestamptz, reviewed boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.action, a.due_date, m.meeting_date, a.status,
         coalesce(p.name, a.new_project), coalesce(o.name, a.new_customer), a.project_id, a.kind,
         case when a.assignee_id = auth.uid() then 'do'
              when a.kind = 'visit' then 'visit'
              when a.kind in ('design', 'estimation', 'execution') and a.assignee_id is null then 'assign'
              when a.kind in ('design', 'estimation', 'execution') then 'track'
              else 'do' end,
         app.display_name(a.owner_id), app.display_name(a.assignee_id), a.assignee_id, app.display_name(a.sales_person_id),
         a.objective, l.plan_id, l.planned_date, l.time_slot, l.status,
         m.published_at + make_interval(hours => app.setting_num('meeting_assign_hours', 24)::int), m.id,
         r.state, r.note, r.created_at, app.next_meeting_starts(m), coalesce(r.created_at >= m.published_at, false)
    from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
    left join public.projects p on p.id = a.project_id
    left join public.organizations o on o.id = a.organization_id
    left join lateral (select x.plan_id, x.planned_date, x.time_slot, x.status from public.visit_plan_lines x
                        where x.meeting_action_id = a.id order by (x.status = 'planned') desc, x.created_at desc limit 1) l on true
    left join lateral (select y.state, y.note, y.created_at from public.meeting_action_reviews y
                        where y.action_id = a.id order by y.created_at desc limit 1) r on true
   where (a.owner_id = auth.uid() or a.assignee_id = auth.uid()) and m.status = 'published' and a.status = 'open'
   order by a.due_date nulls last, m.meeting_date
$$;
revoke execute on function public.my_meeting_actions() from public, anon;
grant execute on function public.my_meeting_actions() to authenticated;

-- Reminders before the next meeting (run from the hourly meeting tick)
create or replace function public.meeting_review_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; a public.sales_meeting_actions; nxt timestamptz; n int := 0; missing int; host uuid[];
begin
  for m in select * from public.sales_meetings where status = 'published' and meeting_date >= (p_at at time zone app.tz())::date - 60 loop
    nxt := app.next_meeting_starts(m);
    continue when nxt <= p_at or nxt > p_at + interval '24 hours';
    missing := 0;
    for a in select x.* from public.sales_meeting_actions x
              where x.meeting_id = m.id and x.status = 'open'
                and not exists (select 1 from public.meeting_action_reviews r where r.action_id = x.id and r.created_at >= m.published_at) loop
      missing := missing + 1;
      perform app.notify(app.action_doer(a), 'meeting_action', 'Status update needed before the next meeting',
        format('%s · next meeting %s', app.action_subject(a), to_char(nxt at time zone app.tz(), 'DD Mon HH24:MI')),
        'normal', 'sales_meeting', m.id, '/meetings', format('meetreview:%s:%s', a.id, to_char(nxt, 'YYYYMMDD')), true);
      n := n + 1;
    end loop;
    if missing > 0 and nxt <= p_at + interval '1 hour' then
      host := app.role_users(app.meeting_host_role(m.team));
      perform app.notify_many(host, 'meeting_action', 'Actions without a status update',
        format('%s of %s · %s action(s) not updated since the meeting', app.meeting_label(m.team), to_char(m.meeting_date, 'DD Mon'), missing),
        'normal', 'sales_meeting', m.id, '/meeting/review/' || m.id, format('meetreviewhost:%s:%s', m.id, to_char(nxt, 'YYYYMMDD')), true);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.meeting_review_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.meeting_review_tick(timestamptz) to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('meeting-review-tick', '12 * * * *', 'select public.meeting_review_tick()');
  end if;
end $$;
