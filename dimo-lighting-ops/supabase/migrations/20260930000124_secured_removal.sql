-- Secured list: Operations asks to remove a secured project entered by mistake (duplicate, never won …); SM Projects
-- approves (the project, its invoicing plan and history are removed) or rejects. SM Projects removes directly.
-- A project with invoices recorded cannot be removed – close or cancel it instead.

alter table public.secured_projects add column if not exists removal_reason text;
alter table public.secured_projects add column if not exists removal_requested_by uuid references public.profiles (id);
alter table public.secured_projects add column if not exists removal_requested_at timestamptz;

create or replace function app.remove_secured(s public.secured_projects, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (table_name, record_id, action, old_data, new_data)
  values ('secured_projects', s.id::text, 'removed', to_jsonb(s), jsonb_build_object('note', p_note,
    'invoice_lines', (select coalesce(jsonb_agg(to_jsonb(l)), '[]') from public.invoice_lines l where l.secured_id = s.id)));
  delete from public.secured_projects where id = s.id;
end $$;

create or replace function public.request_secured_removal(p_secured uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare s public.secured_projects;
begin
  perform app.require(app.has_role('operations_exec', 'sm_projects'), 'Operations or SM Projects remove a secured project');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select * into s from public.secured_projects where id = p_secured for update;
  perform app.require(s.id is not null, 'Secured project not found');
  perform app.require(not exists (select 1 from public.invoice_allocations where secured_id = s.id),
    'Invoices are recorded on this project – close or cancel it instead of removing it');
  perform app.require(s.removal_requested_at is null, 'Removal is already waiting for SM Projects');
  if app.has_role('sm_projects') then
    perform app.notify(s.sales_person_id, 'secured', 'Removed from the secured list', s.project_name || ' · ' || btrim(p_reason), 'normal', null, null, '/finance/secured');
    perform app.remove_secured(s, btrim(p_reason));
    return 'removed';
  end if;
  update public.secured_projects set removal_reason = btrim(p_reason), removal_requested_by = auth.uid(), removal_requested_at = now() where id = s.id;
  insert into public.secured_log (secured_id, action, note) values (s.id, 'removal_requested', btrim(p_reason));
  perform app.notify_many(app.role_users('sm_projects'), 'secured', 'Remove from the secured list?',
    concat_ws(' · ', s.project_name, app.fmt_money(s.order_value, 'LKR'), btrim(p_reason), 'asked by ' || app.display_name(auth.uid())),
    'normal', 'secured_project', s.id, app.secured_url(s.id), null, true);
  return 'pending';
end $$;

create or replace function public.decide_secured_removal(p_secured uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare s public.secured_projects;
begin
  select * into s from public.secured_projects where id = p_secured for update;
  perform app.require(s.id is not null and s.removal_requested_at is not null, 'No removal is waiting for this project');
  -- the person who asked may withdraw; SM Projects decides
  if not p_approve and s.removal_requested_by = auth.uid() and not app.has_role('sm_projects') then
    update public.secured_projects set removal_reason = null, removal_requested_by = null, removal_requested_at = null where id = s.id;
    insert into public.secured_log (secured_id, action, note) values (s.id, 'removal_withdrawn', null);
    return 'withdrawn';
  end if;
  perform app.require(app.has_role('sm_projects'), 'SM Projects approves the removal');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  if p_approve then
    perform app.require(not exists (select 1 from public.invoice_allocations where secured_id = s.id),
      'Invoices have been recorded on this project since – close or cancel it instead');
    perform app.notify_many(array[s.removal_requested_by, s.sales_person_id], 'secured', 'Removed from the secured list',
      concat_ws(' · ', s.project_name, s.removal_reason, nullif(btrim(p_note), '')), 'normal', null, null, '/finance/secured');
    perform app.remove_secured(s, concat_ws(' · ', s.removal_reason, nullif(btrim(p_note), '')));
    return 'removed';
  end if;
  update public.secured_projects set removal_reason = null, removal_requested_by = null, removal_requested_at = null where id = s.id;
  insert into public.secured_log (secured_id, action, note) values (s.id, 'removal_rejected', btrim(p_note));
  perform app.notify(s.removal_requested_by, 'secured', 'Removal not approved', s.project_name || ' · ' || btrim(p_note), 'normal',
    'secured_project', s.id, app.secured_url(s.id));
  return 'rejected';
end $$;

revoke execute on function public.request_secured_removal(uuid, text), public.decide_secured_removal(uuid, boolean, text) from public, anon;
grant execute on function public.request_secured_removal(uuid, text), public.decide_secured_removal(uuid, boolean, text) to authenticated;

-- Approvals: removal requests (copied from 20260930000100_exec_team_access.sql)
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
  select 'meeting_exception', e.id, 'meeting_exception', format('%s leave – %s – %s', app.meeting_label(e.team), app.display_name(e.sales_person_id),
         to_char(e.meeting_date, 'Dy DD Mon')), e.reason, e.sales_person_id, app.display_name(e.sales_person_id), e.requested_at, null,
         '/meetings?team=' || e.team, null
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
         format('Invoice date change – %s · %s → %s', s.project_name, to_char(c.from_month, 'Mon YYYY'), to_char(c.to_month, 'Mon YYYY')),
         concat_ws(' · ', app.fmt_money(l.amount, 'LKR'), c.reason, c.note), c.requested_by, app.display_name(c.requested_by), c.requested_at,
         null, app.secured_url(s.id), null
  from public.invoice_line_changes c join public.invoice_lines l on l.id = c.line_id join public.secured_projects s on s.id = l.secured_id
  where c.status = 'pending' and app.has_role('sm_projects')
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
