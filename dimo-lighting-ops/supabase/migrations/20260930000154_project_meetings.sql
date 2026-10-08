-- Project meetings: the Senior Electrical Engineer calls a meeting about one execution project (Meetings tab of the
-- project). Same machinery as the team meetings – invitations (own execution team at once, anyone else after SM Projects
-- approves), reminders, location-checked attendance, leave, notes, typed actions, publish to GM / DGM and SM Projects,
-- minutes PDF – with the agenda and a pack of that project's figures (programme progress, plan, reports, HSE, QA,
-- materials, variations, design queries, billing, cost) taken when the SEE generates it.

alter table public.sales_meetings add column if not exists exec_project_id uuid references public.exec_projects (id) on delete cascade;
alter table public.sales_meetings add column if not exists agenda text;
alter table public.sales_meetings drop constraint if exists sales_meetings_team_check;
alter table public.sales_meetings add constraint sales_meetings_team_check check (team in ('sales', 'estimation', 'design', 'execution', 'project'));
alter table public.sales_meetings drop constraint if exists sales_meetings_project_check;
alter table public.sales_meetings add constraint sales_meetings_project_check check ((team = 'project') = (exec_project_id is not null));
alter table public.meeting_exceptions drop constraint if exists meeting_exceptions_team_check;
alter table public.meeting_exceptions add constraint meeting_exceptions_team_check check (team in ('sales', 'estimation', 'design', 'execution', 'project'));
-- Leave from a project meeting belongs to that meeting (two projects can meet the same day)
alter table public.meeting_exceptions add column if not exists meeting_id uuid references public.sales_meetings (id) on delete cascade;
alter table public.meeting_exceptions drop constraint if exists meeting_exceptions_person_team_date;
create unique index if not exists meeting_exceptions_person_team_date on public.meeting_exceptions (sales_person_id, team, meeting_date) where team <> 'project';
create unique index if not exists meeting_exceptions_person_meeting on public.meeting_exceptions (sales_person_id, meeting_id) where team = 'project';
-- One team meeting a day per team; one meeting a day per project
alter table public.sales_meetings drop constraint if exists sales_meetings_team_date;
create unique index if not exists sales_meetings_team_date on public.sales_meetings (team, meeting_date) where team <> 'project';
create unique index if not exists sales_meetings_project_date on public.sales_meetings (exec_project_id, meeting_date) where team = 'project';

-- The people invited to a project meeting (not subcontractor supervisors) open it too
create or replace function app.is_meeting_invitee(p_meeting uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sales_meeting_invitees i where i.meeting_id = p_meeting and i.person_id = auth.uid() and i.status <> 'pending_approval')
$$;
drop policy if exists sales_meetings_project_invitee_read on public.sales_meetings;
create policy sales_meetings_project_invitee_read on public.sales_meetings for select to authenticated
  using (team = 'project' and not app.has_role('sub_supervisor') and app.is_meeting_invitee(id));

create or replace function app.meeting_host_role(p_team text) returns public.app_role language sql immutable as $$
  select case p_team when 'estimation' then 'sm_estimation' when 'design' then 'design_manager' when 'execution' then 'senior_elec_engineer'
                     when 'project' then 'senior_elec_engineer' else 'sm_projects' end::public.app_role
$$;
create or replace function app.meeting_host_label(p_team text) returns text language sql immutable as $$
  select case p_team when 'estimation' then 'SM Estimation' when 'design' then 'the Design Manager'
                     when 'execution' then 'the Senior Electrical Engineer' when 'project' then 'the Senior Electrical Engineer' else 'SM Projects' end
$$;
create or replace function app.meeting_label(p_team text) returns text language sql immutable as $$
  select case p_team when 'estimation' then 'Estimation team meeting' when 'design' then 'Design team meeting'
                     when 'execution' then 'Execution team meeting' when 'project' then 'Project meeting' else 'Sales meeting' end
$$;
create or replace function app.meeting_members(p_team text) returns public.app_role[] language sql immutable as $$
  select case p_team when 'estimation' then array['am_estimation', 'estimation_exec']::public.app_role[]
                     when 'design' then array['lighting_designer', 'lighting_engineer']::public.app_role[]
                     when 'execution' then array['assistant_engineer', 'trainee', 'sub_supervisor']::public.app_role[]
                     when 'project' then array['assistant_engineer', 'trainee', 'sub_supervisor']::public.app_role[]
                     else array['asm_building', 'asm_infra']::public.app_role[] end
$$;
-- "Project meeting – E-0012 Hilton lobby"
create or replace function app.meeting_title(p_team text, p_project uuid) returns text language sql stable security definer set search_path = public as $$
  select app.meeting_label(p_team) || coalesce(' – ' || (select concat_ws(' ', p.code, p.name) from public.exec_projects p where p.id = p_project), '')
$$;

-- Call (or change) a project meeting: date, time, agenda and invitees
create or replace function public.invite_project_meeting(p_project uuid, p_meeting uuid, p_date date, p_starts time, p_ends time, p_people uuid[],
  p_agenda text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare ep public.exec_projects; m public.sales_meetings; mid uuid; p uuid; s time; e time; lbl text; prole public.app_role; held text[] := '{}';
  moved boolean := false; ag text := nullif(btrim(p_agenda), '');
begin
  select * into ep from public.exec_projects where id = p_project;
  perform app.require(ep.id is not null, 'Project not found');
  perform app.require(app.has_role('senior_elec_engineer'), 'Only the Senior Electrical Engineer calls project meetings');
  perform app.require(p_date is not null, 'Choose the date');
  perform app.require(extract(isodow from p_date) <> 7, 'Choose a working day');
  s := coalesce(p_starts, time '10:00'); e := coalesce(p_ends, s + interval '60 minutes');
  perform app.require(e > s, 'The meeting must end after it starts');
  perform app.require(now() < (p_date + s) at time zone app.tz(), 'Choose a time that is still to come');
  perform app.require(coalesce(cardinality(p_people), 0) > 0, 'Select who is invited');
  perform app.require(not exists (select 1 from public.profiles x where x.id = any (p_people) and (x.role in ('gm', 'sys_admin') or not x.active)),
    'GM / DGM, System Admin and inactive users cannot be invited');
  perform app.require(not exists (select 1 from public.sales_meetings x where x.team = 'project' and x.exec_project_id = ep.id and x.meeting_date = p_date
                                   and x.id is distinct from p_meeting),
    'This project already has a meeting on that day – open it to change the invitees');
  lbl := app.meeting_title('project', ep.id);
  if p_meeting is not null then
    select * into m from public.sales_meetings where id = p_meeting for update;
    perform app.require(m.id is not null and m.team = 'project' and m.exec_project_id = ep.id, 'Meeting not found');
    perform app.require(m.status = 'draft' and m.started_at is null and now() < app.meeting_starts(m), 'The meeting has started – invitations can no longer change');
    mid := m.id;
    moved := (m.meeting_date, m.starts_at, m.ends_at) is distinct from (p_date, s, e);
    update public.sales_meetings set meeting_date = p_date, starts_at = s, ends_at = e, agenda = ag where id = mid;
  else
    insert into public.sales_meetings (team, exec_project_id, meeting_date, starts_at, ends_at, agenda)
    values ('project', ep.id, p_date, s, e, ag) returning id into mid;
  end if;
  if moved then
    perform app.notify_many(array(select person_id from public.sales_meeting_invitees where meeting_id = mid and person_id = any (p_people) and status <> 'pending_approval'),
      'meeting_invite', lbl || ' moved', format('Now %s · %s – %s', to_char(p_date, 'Dy DD Mon'), to_char(s, 'HH24:MI'), to_char(e, 'HH24:MI')),
      'normal', 'sales_meeting', mid, '/meetings', null, true);
  end if;
  -- (requests still waiting for SM Projects are withdrawn quietly – the person was never told)
  delete from public.sales_meeting_invitees where meeting_id = mid and status = 'pending_approval' and not (person_id = any (p_people));
  for p in select person_id from public.sales_meeting_invitees where meeting_id = mid and not (person_id = any (p_people)) loop
    delete from public.sales_meeting_invitees where meeting_id = mid and person_id = p;
    perform app.notify(p, 'meeting_invite', lbl || ' – invitation withdrawn', to_char(p_date, 'Dy DD Mon YYYY'), 'normal', 'sales_meeting', mid, '/meetings');
  end loop;
  foreach p in array p_people loop
    continue when p = auth.uid();
    select role into prole from public.profiles where id = p;
    -- The execution team is invited at once; anyone else waits for SM Projects
    if not (prole = any (app.meeting_own_team('project'))) then
      insert into public.sales_meeting_invitees (meeting_id, person_id, status, requested_by) values (mid, p, 'pending_approval', auth.uid())
      on conflict (meeting_id, person_id) do nothing;
      if found then held := held || app.display_name(p); end if;
      continue;
    end if;
    insert into public.sales_meeting_invitees (meeting_id, person_id, status)
    values (mid, p, case when exists (select 1 from public.meeting_exceptions x where x.sales_person_id = p and x.meeting_id = mid
                                       and x.status = 'approved') then 'excused' else 'invited' end)
    on conflict (meeting_id, person_id) do nothing;
    if found then
      perform app.notify(p, 'meeting_invite', format('Invited: %s · %s %s – %s', lbl, to_char(p_date, 'Dy DD Mon'), to_char(s, 'HH24:MI'), to_char(e, 'HH24:MI')),
        concat_ws(E'\n', 'Agenda: ' || ag, 'Mark your attendance in Meetings when you arrive, or apply for leave before the meeting'),
        'normal', 'sales_meeting', mid, '/meetings', null, true);
    end if;
  end loop;
  if cardinality(held) > 0 then
    perform app.notify_many(app.role_users('sm_projects'), 'meeting_invite_approval', format('Approve invitations – %s %s', lbl, to_char(p_date, 'Dy DD Mon')),
      format('%s asks to invite %s (outside the execution team)', app.display_name(auth.uid()), array_to_string(held, ', ')),
      'normal', 'sales_meeting', mid, '/meeting/' || mid, null, true);
  end if;
  update public.sales_meetings set initiated_at = coalesce(initiated_at, now()), initiated_by = coalesce(initiated_by, auth.uid()) where id = mid;
  return mid;
end $$;

-- The project's figures, gathered by the app when the SEE presses Generate (kept as they were at that time)
create or replace function public.save_project_meeting_pack(p_id uuid, p_pack jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_id);
begin
  perform app.require(m.team = 'project', 'Not a project meeting');
  perform app.require(jsonb_typeof(p_pack) = 'object', 'The project figures are missing');
  update public.sales_meetings set pack = p_pack || jsonb_build_object('team_kind', 'project', 'generated_at', now()),
    generated_at = now(), generated_by = auth.uid() where id = m.id;
end $$;

-- Cancel a project meeting that has not started; the invitees are told
create or replace function public.cancel_project_meeting(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_id); lbl text := app.meeting_title(m.team, m.exec_project_id);
begin
  perform app.require(m.team = 'project', 'Not a project meeting');
  perform app.require(m.started_at is null, 'The meeting has started – publish it instead');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.notify_many(array(select person_id from public.sales_meeting_invitees where meeting_id = m.id and status <> 'pending_approval'),
    'meeting_invite', lbl || ' cancelled', format('%s %s · %s', to_char(m.meeting_date, 'Dy DD Mon'), to_char(m.starts_at, 'HH24:MI'), btrim(p_reason)),
    'normal', null, null, '/meetings', null, true);
  delete from public.sales_meetings where id = m.id;
end $$;

-- Meeting day for project meetings: reminder, pack reminder, invitations not approved in time, absent when not marked
create or replace function public.project_meeting_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; m public.sales_meetings; n int := 0; k int; lbl text;
begin
  for m in select * from public.sales_meetings where team = 'project' and meeting_date = today loop
    lbl := app.meeting_title(m.team, m.exec_project_id);
    if p_at >= app.meeting_starts(m) and exists (select 1 from public.sales_meeting_invitees where meeting_id = m.id and status = 'pending_approval') then
      perform app.notify_many(app.role_users('senior_elec_engineer'), 'meeting_invite', 'Invitations not approved in time – ' || lbl,
        (select string_agg(app.display_name(person_id), ', ') from public.sales_meeting_invitees where meeting_id = m.id and status = 'pending_approval'),
        'normal', 'sales_meeting', m.id, '/meeting/' || m.id);
      delete from public.sales_meeting_invitees where meeting_id = m.id and status = 'pending_approval';
    end if;
    if p_at >= app.meeting_starts(m) - interval '60 minutes' and p_at < app.meeting_ends(m) then
      perform app.notify_many(array(select person_id from public.sales_meeting_invitees where meeting_id = m.id and status = 'invited'),
        'team_meeting', format('%s today %s – %s', lbl, to_char(m.starts_at, 'HH24:MI'), to_char(m.ends_at, 'HH24:MI')),
        'Mark your attendance in Meetings when you arrive', 'normal', 'sales_meeting', m.id, '/meetings', format('tmeet:%s', m.id), false);
      n := n + 1;
    end if;
    if m.pack is null and p_at >= app.meeting_starts(m) - interval '30 minutes' and p_at < app.meeting_ends(m) then
      perform app.notify_many(array_remove(array[m.initiated_by], null), 'team_meeting', 'Generate the project figures – ' || lbl,
        'Open the meeting and press Generate project figures', 'normal', 'sales_meeting', m.id, '/meeting/' || m.id, format('tmeetpack:%s', m.id), false);
      n := n + 1;
    end if;
    if p_at >= app.meeting_ends(m) then
      update public.sales_meeting_invitees set status = 'absent', note = coalesce(note, 'Not marked by ' || to_char(m.ends_at, 'HH24:MI'))
       where meeting_id = m.id and status = 'invited';
      get diagnostics k = row_count;
      n := n + k;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.request_meeting_leave(p_meeting uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings; eid uuid;
begin
  select * into m from public.sales_meetings where id = p_meeting;
  perform app.require(m.id is not null, 'Meeting not found');
  if m.team = 'sales' then return public.request_meeting_exception(m.meeting_date, p_reason); end if;
  perform app.require(exists (select 1 from public.sales_meeting_invitees where meeting_id = m.id and person_id = auth.uid() and status <> 'pending_approval'), 'You are not invited to this meeting');
  perform app.require(now() < app.meeting_starts(m), 'Leave must be applied before the meeting starts');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(not exists (select 1 from public.meeting_exceptions where sales_person_id = auth.uid() and team = m.team and meeting_date = m.meeting_date
                                   and (m.team <> 'project' or meeting_id = m.id) and status <> 'rejected'), 'Leave for this meeting is already requested');
  delete from public.meeting_exceptions where sales_person_id = auth.uid() and team = m.team and meeting_date = m.meeting_date
     and (m.team <> 'project' or meeting_id = m.id) and status = 'rejected';
  insert into public.meeting_exceptions (sales_person_id, team, meeting_date, reason, meeting_id)
  values (auth.uid(), m.team, m.meeting_date, btrim(p_reason), case when m.team = 'project' then m.id end)
  returning id into eid;
  perform app.notify_many(app.role_users(app.meeting_host_role(m.team)), 'meeting_exception', 'Leave requested – ' || case when m.team = 'project' then app.meeting_title(m.team, m.exec_project_id) else lower(app.meeting_label(m.team)) end,
    format('%s · %s · %s', app.display_name(auth.uid()), to_char(m.meeting_date, 'Dy DD Mon'), btrim(p_reason)),
    'normal', 'meeting_exception', eid, case when m.team = 'project' then '/meeting/' || m.id else '/meetings?team=' || m.team end, null, true);
  return eid;
end $$;

create or replace function public.decide_meeting_exception(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.meeting_exceptions; m public.sales_meetings; starts timestamptz;
begin
  select * into e from public.meeting_exceptions where id = p_id for update;
  perform app.require(e.id is not null, 'Not found');
  perform app.require(app.is_meeting_host(e.team), format('Only %s approves leave from the %s', app.meeting_host_label(e.team), lower(app.meeting_label(e.team))));
  perform app.require(e.status = 'pending', 'Already decided');
  select * into m from public.sales_meetings where case when e.meeting_id is not null then id = e.meeting_id else team = e.team and meeting_date = e.meeting_date end;
  starts := case when m.id is not null then app.meeting_starts(m) else app.meeting_start_at(e.meeting_date) end;
  perform app.require(now() < starts, 'The meeting has started – leave can only be decided before it');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.meeting_exceptions set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(),
    decided_at = now(), decision_note = nullif(btrim(p_note), '') where id = e.id;
  if p_approve and m.id is not null then
    update public.sales_meeting_invitees set status = 'excused' where meeting_id = m.id and person_id = e.sales_person_id;
  end if;
  perform app.notify(e.sales_person_id, 'meeting_exception',
    format('Leave from the %s %s', lower(app.meeting_label(e.team)), case when p_approve then 'approved' else 'not approved' end),
    format('%s%s', to_char(e.meeting_date, 'Dy DD Mon YYYY'), coalesce(' · ' || nullif(btrim(p_note), ''), '')),
    'normal', 'meeting_exception', e.id, '/meetings', null, true);
end $$;

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
  select 'meeting_exception', e.id, 'meeting_exception', format('%s leave – %s – %s', app.meeting_title(e.team, (select x.exec_project_id from public.sales_meetings x where x.id = e.meeting_id)), app.display_name(e.sales_person_id),
         to_char(e.meeting_date, 'Dy DD Mon')), e.reason, e.sales_person_id, app.display_name(e.sales_person_id), e.requested_at, null,
         coalesce('/meeting/' || e.meeting_id, '/meetings?team=' || e.team), null
  from public.meeting_exceptions e
  where e.status = 'pending' and app.is_meeting_host(e.team)
  union all
  select 'meeting_attendance', m.id, 'meeting_attendance', format('Meeting attendance – %s – location differs', app.display_name(i.person_id)),
         case when i.distance_m is null then 'No location' else round(i.distance_m) || ' m from the meeting' end, i.person_id,
         app.display_name(i.person_id), i.checkin_at, null, '/meeting/' || m.id, null
  from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id
  where i.status = 'location_check' and app.is_meeting_host(m.team)
  union all
  select 'meeting_assign', a.id, 'meeting_assign', format('Assign: %s', a.action),
         concat_ws(' · ', coalesce(p.name, a.new_project), coalesce(o.name, a.new_customer), app.meeting_label(m.team) || ' ' || to_char(m.meeting_date, 'DD Mon')),
         m.published_by, app.display_name(m.published_by), m.published_at, null, '/meetings', app.action_kind_label(a.kind)
  from public.sales_meeting_actions a join public.sales_meetings m on m.id = a.meeting_id
  left join public.projects p on p.id = a.project_id left join public.organizations o on o.id = a.organization_id
  where m.status = 'published' and a.status = 'open' and a.kind in ('design', 'estimation', 'execution') and a.assignee_id is null
    and a.owner_id = auth.uid()
  union all
  select 'meeting_invite', i.meeting_id, 'meeting_invite', format('Invite %s to the %s – %s', app.display_name(i.person_id), lower(app.meeting_label(m.team)),
         to_char(m.meeting_date, 'Dy DD Mon')), 'Outside the team – requested by ' || app.display_name(coalesce(i.requested_by, m.initiated_by)),
         coalesce(i.requested_by, m.initiated_by), app.display_name(coalesce(i.requested_by, m.initiated_by)), i.invited_at, null, '/meetings?team=' || m.team, null
  from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id
  where i.status = 'pending_approval' and app.has_role('sm_projects') and now() < app.meeting_starts(m)
  union all
  select 'project_change', r.id, 'project_change', format('Project change – %s – %s', p.code, p.name), r.reason,
         r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid, '/projects/' || p.id,
         (select string_agg(app.project_field_label(k), ', ') from jsonb_object_keys(r.changes) k)
  from public.project_change_requests r join public.projects p on p.id = r.project_id
  where r.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'invoice_schedule', s.id, 'invoice_schedule', format('Invoice schedule – %s', s.project_name),
         concat_ws(' · ', s.customer, 'order value ' || app.fmt_money(s.order_value, 'LKR')),
         s.sales_person_id, app.display_name(s.sales_person_id), coalesce(s.submitted_at, s.created_at), null, app.secured_url(s.id), null
  from public.secured_projects s
  where s.status = 'open' and s.schedule_status = 'review' and app.has_role('sm_projects')
  union all
  select 'invoice_move', s.id, 'invoice_move',
         format('Invoice date change%s – %s · %s → %s', case when c.needs_gm then ' (another quarter / year)' else '' end, s.project_name, to_char(c.from_month, 'Mon YYYY'), to_char(c.to_month, 'Mon YYYY')),
         concat_ws(' · ', app.fmt_money(l.amount, 'LKR'), c.reason, c.note), c.requested_by, app.display_name(c.requested_by), c.requested_at,
         null, app.secured_url(s.id), null
  from public.invoice_line_changes c join public.invoice_lines l on l.id = c.line_id join public.secured_projects s on s.id = l.secured_id
  where c.status = 'pending' and ((app.has_role('sm_projects') and (not c.needs_gm or c.smp_at is null))
                                 or (app.has_role('gm') and c.needs_gm and c.smp_at is not null))
  union all
  select 'invoice_request', s.id, 'invoice_request', format('Invoice to approve – %s – %s', s.project_name, r.invoice_no),
         concat_ws(' · ', app.fmt_money(r.amount, 'LKR'), to_char(r.invoice_date, 'DD Mon YYYY'), r.note), r.requested_by,
         app.display_name(r.requested_by), r.requested_at, null, app.secured_url(s.id), null
  from public.invoice_requests r join public.secured_projects s on s.id = r.secured_id
  where r.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'secured_removal', s.id, 'secured_removal', format('Remove from the secured list – %s', s.project_name),
         concat_ws(' · ', app.fmt_money(s.order_value, 'LKR'), s.removal_reason), s.removal_requested_by,
         app.display_name(s.removal_requested_by), s.removal_requested_at, null, app.secured_url(s.id), 'SM Projects'
  from public.secured_projects s
  where s.removal_requested_at is not null and app.has_role('sm_projects')
  union all
  select * from app.exec_pending_approvals()
  order by 8
$$;

create or replace function public.my_meetings() returns table (meeting_id uuid, meeting_date date, started boolean, my_status text,
  checkin_at timestamptz, distance_m double precision, leave_status text, leave_reason text, leave_note text, host text,
  team text, title text, starts_at time, ends_at time)
language sql stable security definer set search_path = public as $$
  select m.id, m.meeting_date, m.started_at is not null, i.status, i.checkin_at, i.distance_m, e.status, e.reason, e.decision_note,
         app.display_name(coalesce(m.initiated_by, (select id from public.profiles where role = app.meeting_host_role(m.team) and active limit 1))),
         m.team, app.meeting_title(m.team, m.exec_project_id), m.starts_at, m.ends_at
    from public.sales_meeting_invitees i join public.sales_meetings m on m.id = i.meeting_id
    left join public.meeting_exceptions e on e.sales_person_id = i.person_id and e.team = m.team and e.meeting_date = m.meeting_date and (e.meeting_id is null or e.meeting_id = m.id)
   where i.person_id = auth.uid() and i.status <> 'pending_approval' and m.meeting_date >= (now() at time zone app.tz())::date - 56
   order by m.meeting_date desc, m.starts_at
$$;

create or replace function public.my_week_meetings() returns table (meeting_id uuid, team text, title text, meeting_date date, starts_at time,
  ends_at time, my_part text, my_status text, status text, started boolean, generated boolean)
language sql stable security definer set search_path = public as $$
  with w as (select (now() at time zone app.tz())::date as today),
  wk as (select today - (extract(isodow from today)::int - 1) as mon, today from w),
  mine as (
    select m.id, m.team, m.exec_project_id, m.meeting_date, m.starts_at, m.ends_at, m.status, m.started_at, m.generated_at,
           case when app.is_meeting_host(m.team) then 'host'
                when i.person_id is not null then 'invitee' else 'viewer' end as part, i.status as my_status
      from public.sales_meetings m cross join wk
      left join public.sales_meeting_invitees i on i.meeting_id = m.id and i.person_id = auth.uid() and i.status <> 'pending_approval'
     where m.meeting_date between wk.mon and wk.mon + 6
       and (app.is_meeting_host(m.team) or i.person_id is not null
            or (m.initiated_at is not null and (app.has_role('gm') or (m.team <> 'sales' and app.has_role('sm_projects'))))))
  select id, team, app.meeting_title(team, exec_project_id), meeting_date, starts_at, ends_at, part, my_status, status, started_at is not null, generated_at is not null
    from mine
  union all
  select null, t.team, app.meeting_label(t.team), app.meeting_default_date(t.team, wk.today), case when t.team = 'sales' then time '08:30' else time '08:30' end,
         case when t.team = 'sales' then time '12:00' else time '10:00' end, 'host', null, 'not_set_up', false, false
    from (values ('sales'), ('estimation'), ('design')) t(team) cross join wk
   where app.is_meeting_host(t.team) and app.meeting_default_date(t.team, wk.today) >= wk.today
     and not exists (select 1 from public.sales_meetings m where m.team = t.team and m.meeting_date between wk.mon and wk.mon + 6)
  order by 4, 5
$$;

create or replace function public.publish_sales_meeting(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_id); a public.sales_meeting_actions; p uuid;
begin
  perform app.require(m.pack is not null, 'Generate the meeting pack first');
  update public.sales_meetings set status = 'published', published_at = now(), published_by = auth.uid() where id = m.id;
  perform app.notify_many(app.meeting_viewers(m.team), 'sales_meeting', app.meeting_title(m.team, m.exec_project_id) || ' pack – ' || to_char(m.meeting_date, 'DD Mon YYYY'),
    format('%s actions · published by %s', (select count(*) from public.sales_meeting_actions where meeting_id = m.id), app.display_name(auth.uid())),
    'normal', 'sales_meeting', m.id, '/meeting/' || m.id);
  for a in select * from public.sales_meeting_actions where meeting_id = m.id and status = 'open' order by created_at loop
    if a.kind in ('design', 'estimation', 'execution') then
      perform app.notify(a.owner_id, 'meeting_action', 'Appoint a person – ' || lower(app.action_kind_label(a.kind)) || ' from the ' || lower(app.meeting_label(m.team)),
        format('%s%s. Appoint within %s hours (GM / DGM and SM Projects are told if not)', app.action_subject(a),
          coalesce(' · due ' || to_char(a.due_date, 'DD Mon'), ''), app.setting_num('meeting_assign_hours', 24)),
        'normal', 'sales_meeting', m.id, '/meetings', null, true);
    elsif a.kind = 'task' and a.owner_id <> auth.uid() then
      perform app.notify(a.owner_id, 'meeting_action', 'Action from the ' || lower(app.meeting_label(m.team)),
        app.action_subject(a) || coalesce(' · due ' || to_char(a.due_date, 'DD Mon'), ''), 'normal', 'sales_meeting', m.id, '/meetings', null, true);
    end if;
    if a.sales_person_id is not null and a.sales_person_id <> a.owner_id then
      perform app.notify(a.sales_person_id, 'meeting_action', 'Follow-up on your project – ' || lower(app.action_kind_label(a.kind)),
        format('%s · with %s', app.action_subject(a), app.display_name(a.owner_id)), 'normal', 'sales_meeting', m.id, '/meetings', null, true);
    end if;
  end loop;
  for p in select distinct owner_id from public.sales_meeting_actions where meeting_id = m.id and kind = 'visit' and status = 'open' loop
    perform app.place_meeting_visits(p);
    -- Not placed (no plan for that week yet): tell the sales person it will be in the plan
    perform app.notify(p, 'meeting_action', 'Follow-up visit(s) from the ' || lower(app.meeting_label(m.team)),
      (select string_agg(app.action_subject(x) || ' · by ' || to_char(x.due_date, 'DD Mon'), E'\n')
         from public.sales_meeting_actions x where x.meeting_id = m.id and x.kind = 'visit' and x.owner_id = p
          and not exists (select 1 from public.visit_plan_lines l where l.meeting_action_id = x.id))
        || E'\nThey are added to your weekly plan when you create it – you set the day and time.',
      'normal', 'sales_meeting', m.id, '/meetings', format('meetvisitwait:%s:%s', m.id, p), true)
     where exists (select 1 from public.sales_meeting_actions x where x.meeting_id = m.id and x.kind = 'visit' and x.owner_id = p
                    and not exists (select 1 from public.visit_plan_lines l where l.meeting_action_id = x.id));
  end loop;
end $$;

revoke execute on function public.invite_project_meeting(uuid, uuid, date, time, time, uuid[], text), public.save_project_meeting_pack(uuid, jsonb),
  public.cancel_project_meeting(uuid, text) from public, anon;
grant execute on function public.invite_project_meeting(uuid, uuid, date, time, time, uuid[], text), public.save_project_meeting_pack(uuid, jsonb),
  public.cancel_project_meeting(uuid, text) to authenticated, service_role;
revoke execute on function public.project_meeting_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.project_meeting_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('project-meeting-tick', '*/15 * * * 1-6', 'select public.project_meeting_tick()');
  end if;
end $$;
