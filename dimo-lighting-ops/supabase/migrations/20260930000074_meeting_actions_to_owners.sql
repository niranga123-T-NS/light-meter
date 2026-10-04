-- Sales meeting actions reach their owners: when the meeting is published each owner is notified of their action(s)
-- (not the pack) and sees them on My Day; the owner (or SM Projects) marks them done.

-- (the owner cannot read the meeting itself, so its status is checked through a security-definer helper)
create or replace function app.meeting_published(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sales_meetings where id = p_id and status = 'published')
$$;
create policy sales_meeting_actions_owner_read on public.sales_meeting_actions for select to authenticated
  using (owner_id = auth.uid() and app.meeting_published(meeting_id));

create or replace function public.set_meeting_action_done(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a public.sales_meeting_actions;
begin
  select * into a from public.sales_meeting_actions where id = p_id for update;
  perform app.require(a.id is not null, 'Not found');
  perform app.require(app.has_role('sm_projects') or a.owner_id = auth.uid(), 'Only the owner or SM Projects updates this action');
  perform app.require(app.has_role('sm_projects') or exists (select 1 from public.sales_meetings m where m.id = a.meeting_id and m.status = 'published'),
    'The meeting is not published yet');
  update public.sales_meeting_actions set status = case when p_done then 'done' else 'open' end,
    done_at = case when p_done then now() end, done_by = case when p_done then auth.uid() end where id = a.id;
  if p_done and a.owner_id = auth.uid() and not app.has_role('sm_projects') then
    perform app.notify_many(app.role_users('sm_projects'), 'sales_meeting_action', 'Meeting action done',
      app.display_name(auth.uid()) || ' · ' || a.action, 'normal', 'sales_meeting', a.meeting_id, '/meeting/' || a.meeting_id);
  end if;
end $$;

create or replace function public.publish_sales_meeting(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_id); a record;
begin
  perform app.require(m.pack is not null, 'Generate the meeting pack first');
  update public.sales_meetings set status = 'published', published_at = now(), published_by = auth.uid() where id = m.id;
  perform app.notify_many(app.role_users('gm'), 'sales_meeting', 'Sales meeting pack – ' || to_char(m.meeting_date, 'DD Mon YYYY'),
    format('%s actions · published by %s', (select count(*) from public.sales_meeting_actions where meeting_id = m.id), app.display_name(auth.uid())),
    'normal', 'sales_meeting', m.id, '/meeting/' || m.id);
  -- Each owner gets their own action(s) – shown on My Day
  for a in select owner_id, string_agg(action || coalesce(' (by ' || to_char(due_date, 'DD Mon') || ')', ''), ' · ' order by created_at) as txt, count(*) as n
             from public.sales_meeting_actions where meeting_id = m.id and status = 'open' and owner_id is distinct from auth.uid()
            group by owner_id loop
    perform app.notify(a.owner_id, 'sales_meeting_action',
      case when a.n = 1 then 'Action from the sales meeting' else format('%s actions from the sales meeting', a.n) end,
      a.txt, 'normal', 'sales_meeting', m.id, '/');
  end loop;
end $$;

-- Owner's open actions for My Day
create or replace function public.my_meeting_actions() returns table (id uuid, action text, due_date date, meeting_date date, status text)
language sql stable security definer set search_path = public as $$
  select a.id, a.action, a.due_date, m.meeting_date, a.status
    from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
   where a.owner_id = auth.uid() and m.status = 'published' and a.status = 'open'
   order by a.due_date nulls last, m.meeting_date
$$;
revoke execute on function public.my_meeting_actions() from public, anon;
grant execute on function public.my_meeting_actions() to authenticated;
