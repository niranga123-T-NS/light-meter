-- Project details: a sales person's changes go to SM Projects for approval.
--  * The sales person (project owner) sends a change request: the new values of any details (name, customer, type,
--    location, stage, milestone / win probability, specification, duty status / currency, values, tender / award dates,
--    duration / term) with a reason. Nothing changes until SM Projects approves; rejected requests need a reason.
--  * One pending request per project; the requester can withdraw it. SM Projects is notified (popup) and sees it in
--    Approvals and on the project; the sales person is told of the decision. Approved changes are logged against the
--    project with the request's reason.
--  * SM Projects and GM / DGM still edit directly. Direct edits of these details by a sales person are refused; the
--    system's own updates (won / lost from inquiries, visit outcomes, quotations) and status reviews are unchanged.

create table public.project_change_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  requested_by uuid not null default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  changes jsonb not null,          -- {field: new value}
  previous jsonb not null,         -- {field: value when requested}
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text
);
create unique index project_change_one_pending on public.project_change_requests (project_id) where status = 'pending';
create index on public.project_change_requests (requested_by, status);
alter table public.project_change_requests enable row level security;
create policy project_change_read on public.project_change_requests for select to authenticated
  using (requested_by = auth.uid() or app.has_role('gm', 'sm_projects')
         or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
grant select on public.project_change_requests to authenticated;

-- Details a sales person changes only through a request
create or replace function app.project_change_fields() returns text[] language sql immutable as $$
  select array['name', 'organization_id', 'project_type', 'city', 'location', 'stage', 'milestone', 'win_probability', 'spec_status',
               'duty_status', 'currency', 'project_value', 'lighting_value', 'expected_tender_date', 'expected_award_date',
               'expected_duration_months', 'project_term']
$$;
create or replace function app.project_field_label(p_field text) returns text language sql immutable as $$
  select case p_field when 'name' then 'Name' when 'organization_id' then 'Customer' when 'project_type' then 'Project type'
    when 'city' then 'City' when 'location' then 'Location' when 'stage' then 'Stage' when 'milestone' then 'Milestone'
    when 'win_probability' then 'Win probability' when 'spec_status' then 'Specification' when 'duty_status' then 'Duty status'
    when 'currency' then 'Currency' when 'project_value' then 'Project value' when 'lighting_value' then 'Lighting value'
    when 'expected_tender_date' then 'Tender date' when 'expected_award_date' then 'Award date'
    when 'expected_duration_months' then 'Duration' when 'project_term' then 'Term' else p_field end
$$;

-- Direct edits by a sales person are refused (system updates run inside the workflows' own functions and pass)
create or replace function app.projects_sales_edit_guard() returns trigger
language plpgsql as $$
declare f text; o jsonb; n jsonb;
begin
  if current_user <> 'authenticated' or auth.uid() is null or app.has_role('sm_projects', 'gm') then return new; end if;
  o := to_jsonb(old); n := to_jsonb(new);
  foreach f in array app.project_change_fields() loop
    if (o -> f) is distinct from (n -> f) then
      raise exception 'Project details are changed through a change request to SM Projects (Request changes on the project)';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists projects_sales_edit_guard on public.projects;
create trigger projects_sales_edit_guard before update on public.projects
  for each row execute function app.projects_sales_edit_guard();

create or replace function public.request_project_change(p_project uuid, p_changes jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.projects; k text; ch jsonb := '{}'; prev jsonb := '{}'; po jsonb; rid uuid;
begin
  select * into p from public.projects where id = p_project;
  perform app.require(p.id is not null, 'Project not found');
  perform app.require(p.owner_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the project''s sales person requests changes');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason for the change');
  perform app.require(p.status not in ('completed', 'cancelled'), 'This project is closed');
  perform app.require(not exists (select 1 from public.project_change_requests where project_id = p.id and status = 'pending'),
    'A change request for this project is already waiting for SM Projects – withdraw it first to send a new one');
  po := to_jsonb(p);
  for k in select jsonb_object_keys(coalesce(p_changes, '{}')) loop
    perform app.require(k = any (app.project_change_fields()), 'This detail cannot be changed here: ' || k);
    if (po -> k) is distinct from (p_changes -> k) and not ((po -> k) = 'null'::jsonb and (p_changes -> k) = '""'::jsonb) then
      ch := ch || jsonb_build_object(k, p_changes -> k);
      prev := prev || jsonb_build_object(k, po -> k);
    end if;
  end loop;
  perform app.require(ch <> '{}'::jsonb, 'Nothing was changed');
  if ch ? 'name' then perform app.require(coalesce(btrim(ch ->> 'name'), '') <> '', 'The project name cannot be empty'); end if;
  if ch ? 'organization_id' then perform app.require(exists (select 1 from public.organizations where id = (ch ->> 'organization_id')::uuid), 'Customer not found'); end if;
  if ch ? 'win_probability' then perform app.require((ch ->> 'win_probability')::int between 0 and 100, 'Win probability is 0 – 100'); end if;
  insert into public.project_change_requests (project_id, changes, previous, reason) values (p.id, ch, prev, btrim(p_reason)) returning id into rid;
  perform app.notify_many(app.role_users('sm_projects'), 'project_change', format('Project change request – %s', p.code),
    format('%s · %s · %s', app.display_name(auth.uid()), (select string_agg(app.project_field_label(x), ', ') from jsonb_object_keys(ch) x), btrim(p_reason)),
    'normal', 'project', p.id, '/projects/' || p.id, null, true);
  return rid;
end $$;

create or replace function public.withdraw_project_change(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.project_change_requests;
begin
  select * into r from public.project_change_requests where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'pending', 'Not pending');
  perform app.require(r.requested_by = auth.uid(), 'Only the person who sent it withdraws it');
  update public.project_change_requests set status = 'withdrawn', decided_at = now() where id = r.id;
end $$;

-- SM Projects approves (applied, logged with the reason) or rejects (with a reason)
create or replace function public.decide_project_change(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.project_change_requests; c jsonb; p public.projects;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects approves project changes');
  select * into r from public.project_change_requests where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'pending', 'Already decided');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  select * into p from public.projects where id = r.project_id;
  if p_approve then
    c := r.changes;
    perform set_config('app.reason', 'Change request approved: ' || r.reason, true);
    update public.projects set
      name = case when c ? 'name' then c ->> 'name' else name end,
      organization_id = case when c ? 'organization_id' then (c ->> 'organization_id')::uuid else organization_id end,
      project_type = case when c ? 'project_type' then (c ->> 'project_type')::public.project_type else project_type end,
      city = case when c ? 'city' then nullif(c ->> 'city', '') else city end,
      location = case when c ? 'location' then nullif(c ->> 'location', '') else location end,
      stage = case when c ? 'stage' then c ->> 'stage' else stage end,
      milestone = case when c ? 'milestone' then (c ->> 'milestone')::public.pipeline_milestone else milestone end,
      win_probability = case when c ? 'win_probability' then (c ->> 'win_probability')::int else win_probability end,
      last_probability_review_at = case when c ? 'win_probability' or c ? 'milestone' then now() else last_probability_review_at end,
      spec_status = case when c ? 'spec_status' then c ->> 'spec_status' else spec_status end,
      duty_status = case when c ? 'duty_status' then nullif(c ->> 'duty_status', '')::public.duty_status else duty_status end,
      currency = case when c ? 'currency' then (c ->> 'currency')::public.currency
                      when c ? 'duty_status' then (case when c ->> 'duty_status' = 'duty_free' then 'USD' else 'LKR' end)::public.currency else currency end,
      project_value = case when c ? 'project_value' then nullif(c ->> 'project_value', '')::numeric else project_value end,
      lighting_value = case when c ? 'lighting_value' then nullif(c ->> 'lighting_value', '')::numeric else lighting_value end,
      expected_tender_date = case when c ? 'expected_tender_date' then nullif(c ->> 'expected_tender_date', '')::date else expected_tender_date end,
      expected_award_date = case when c ? 'expected_award_date' then nullif(c ->> 'expected_award_date', '')::date else expected_award_date end,
      expected_duration_months = case when c ? 'expected_duration_months' then (c ->> 'expected_duration_months')::int else expected_duration_months end,
      project_term = case when c ? 'project_term' then c ->> 'project_term' else project_term end
     where id = r.project_id;
  end if;
  update public.project_change_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(),
    decided_at = now(), decision_note = nullif(btrim(p_note), '') where id = r.id;
  perform app.notify(r.requested_by, 'project_change', format('Project change %s – %s', case when p_approve then 'approved' else 'not approved' end, p.code),
    coalesce(nullif(btrim(p_note), ''), p.name), 'normal', 'project', p.id, '/projects/' || p.id, null, true);
end $$;

revoke execute on function public.request_project_change(uuid, jsonb, text), public.withdraw_project_change(uuid),
  public.decide_project_change(uuid, boolean, text) from public, anon;
grant execute on function public.request_project_change(uuid, jsonb, text), public.withdraw_project_change(uuid),
  public.decide_project_change(uuid, boolean, text) to authenticated, service_role;

-- Change requests in SM Projects' approvals (copied from 20260930000078)
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
         r.requested_by, app.display_name(r.requested_by), r.requested_at, null, '/projects/' || p.id,
         (select string_agg(app.project_field_label(k), ', ') from jsonb_object_keys(r.changes) k)
  from public.project_change_requests r join public.projects p on p.id = r.project_id
  where r.status = 'pending' and app.has_role('sm_projects')
  order by 8
$$;

-- Status reviews (active / on hold / lost / cancelled / completed) stay with the sales person; marking lost also sets the
-- milestone, so the review runs as the system with its own check (copied from 20260930000011, now security definer)
create or replace function public.review_project(
  p_project uuid, p_action text, p_reason text default null, p_review_date date default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_action not in ('active', 'on_hold', 'lost', 'cancelled', 'completed') then raise exception 'Invalid action'; end if;
  if p_action in ('on_hold', 'lost', 'cancelled') and coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  if p_action = 'on_hold' and p_review_date is null then raise exception 'Set the review date'; end if;
  if not (app.has_role('gm', 'sm_projects') or exists (select 1 from public.projects where id = p_project and owner_id = auth.uid())) then
    raise exception 'Project not found or not yours';
  end if;
  perform set_config('app.reason', coalesce(p_reason, 'Reviewed'), true);
  update public.projects set
    status = p_action,
    milestone = case when p_action = 'lost' then 'lost'::public.pipeline_milestone else milestone end,
    status_reason = p_reason,
    on_hold_review_date = case when p_action = 'on_hold' then p_review_date end,
    dormant_since = null,
    last_activity_at = now()
  where id = p_project;
  if not found then raise exception 'Project not found or not yours'; end if;
end $$;
