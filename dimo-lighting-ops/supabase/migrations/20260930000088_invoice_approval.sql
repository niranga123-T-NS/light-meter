-- New invoices: the Operations Executive records the invoice, SM Projects approves it before it counts as invoiced.
--  * record_invoice now creates a request (same checks; the balance and invoice numbers also count invoices waiting).
--    SM Projects is notified (popup) and sees it in Approvals and on the project; approve → the invoice is recorded (and
--    counts); reject → with a reason, Operations is told. The sales person is told when it is approved.
--  * Past invoices confirmed from the schedule (confirm_past_invoices) are a one-off catch-up and stay immediate.

create table public.invoice_requests (
  id bigint generated always as identity primary key,
  secured_id uuid not null references public.secured_projects (id) on delete cascade,
  line_id uuid not null references public.invoice_lines (id) on delete cascade,
  amount numeric(16, 2) not null check (amount > 0),
  invoice_no text not null,
  invoice_date date not null,
  note text,
  requested_by uuid not null default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  allocation_id bigint references public.invoice_allocations (id) on delete set null
);
create index on public.invoice_requests (secured_id, status);
create index on public.invoice_requests (line_id) where status = 'pending';
alter table public.invoice_requests enable row level security;
create policy invoice_requests_read on public.invoice_requests for select to authenticated
  using (app.is_finance_desk() or exists (select 1 from public.secured_projects s where s.id = secured_id and s.sales_person_id = auth.uid()));
grant select on public.invoice_requests to authenticated;

-- p_data: {invoice_no, invoice_date, amount, note} → a request to SM Projects (returns the request id)
create or replace function public.record_invoice(p_line uuid, p_data jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  l public.invoice_line_status;
  s public.secured_projects;
  d date;
  amt numeric := round(app.to_num(p_data ->> 'amount'), 2);
  waiting numeric;
  no text := btrim(p_data ->> 'invoice_no');
  rid bigint;
begin
  perform app.require(app.has_role('operations_exec'), 'Invoices are recorded by the Operations Executive');
  select * into l from public.invoice_line_status where id = p_line;
  perform app.require(l.id is not null, 'Invoice not found');
  select * into s from public.secured_projects where id = l.secured_id;
  perform app.require(s.status <> 'cancelled', 'The project is cancelled');
  perform app.require(coalesce(no, '') <> '', 'Enter the invoice number');
  begin d := (p_data ->> 'invoice_date')::date; exception when others then d := null; end;
  perform app.require(d is not null and d <= (now() at time zone app.tz())::date, 'Enter the invoice date (not in the future)');
  perform app.require(coalesce(amt, 0) > 0, 'Enter the invoice amount');
  select coalesce(sum(amount), 0) into waiting from public.invoice_requests where line_id = l.id and status = 'pending';
  perform app.require(amt <= l.remaining - waiting + 1,
    format('Only %s is still to invoice on this line%s – record a variation first, or split the amount over the next invoice',
      app.fmt_money(l.remaining - waiting, 'LKR'), case when waiting > 0 then ' (after invoices waiting for SM Projects)' else '' end));
  perform app.require(not exists (select 1 from public.invoice_allocations a where a.secured_id = s.id and lower(a.invoice_no) = lower(no))
                      and not exists (select 1 from public.invoice_requests r where r.secured_id = s.id and r.status = 'pending' and lower(r.invoice_no) = lower(no)),
    'This invoice number is already recorded (or waiting) on this project');
  insert into public.invoice_requests (secured_id, line_id, amount, invoice_no, invoice_date, note)
  values (s.id, l.id, amt, no, d, nullif(btrim(p_data ->> 'note'), '')) returning id into rid;
  insert into public.secured_log (secured_id, action, note)
  values (s.id, 'invoice_requested', concat_ws(' · ', 'Invoice ' || no || ' sent to SM Projects', to_char(d, 'DD Mon YYYY'),
          app.fmt_money(amt, 'LKR'), coalesce(l.description, initcap(l.kind))));
  perform app.notify_many(app.role_users('sm_projects'), 'invoice_request', 'Invoice to approve – ' || s.project_name,
    format('%s · %s · %s · by %s', no, app.fmt_money(amt, 'LKR'), to_char(d, 'DD Mon YYYY'), app.display_name(auth.uid())),
    'normal', 'secured_project', s.id, app.secured_url(s.id), null, true);
  return rid;
end $$;

create or replace function public.decide_invoice_request(p_id bigint, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.invoice_requests; l public.invoice_line_status; s public.secured_projects; aid bigint;
begin
  perform app.require(app.has_role('sm_projects'), 'Only SM Projects approves invoices');
  select * into r from public.invoice_requests where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'pending', 'Already decided');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  select * into s from public.secured_projects where id = r.secured_id;
  if p_approve then
    select * into l from public.invoice_line_status where id = r.line_id;
    perform app.require(r.amount <= l.remaining + 1, format('Only %s is still to invoice on this line now', app.fmt_money(l.remaining, 'LKR')));
    insert into public.invoice_allocations (upload_id, month, secured_id, line_id, amount, manual, invoice_no, invoice_date, note, created_by)
    values (null, app.month_of(r.invoice_date), r.secured_id, r.line_id, r.amount, true, r.invoice_no, r.invoice_date, r.note, r.requested_by)
    returning id into aid;
    insert into public.secured_log (secured_id, action, note)
    values (s.id, 'invoiced', concat_ws(' · ', 'Invoice ' || r.invoice_no || ' approved by SM Projects', to_char(r.invoice_date, 'DD Mon YYYY'),
            app.fmt_money(r.amount, 'LKR'), nullif(btrim(p_note), '')));
    if s.sales_person_id is not null then
      perform app.notify(s.sales_person_id, 'invoice_recorded', 'Invoice recorded on your project',
        s.project_name || ' · ' || r.invoice_no || ' · ' || app.fmt_money(r.amount, 'LKR'), 'normal', 'secured_project', s.id, app.secured_url(s.id));
    end if;
  else
    insert into public.secured_log (secured_id, action, note)
    values (s.id, 'invoice_rejected', concat_ws(' · ', 'Invoice ' || r.invoice_no || ' not approved', btrim(p_note)));
  end if;
  update public.invoice_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(),
    decided_at = now(), decision_note = nullif(btrim(p_note), ''), allocation_id = aid where id = r.id;
  perform app.notify(r.requested_by, 'invoice_request', format('Invoice %s %s', r.invoice_no, case when p_approve then 'approved' else 'not approved' end),
    s.project_name || coalesce(' · ' || nullif(btrim(p_note), ''), ''), 'normal', 'secured_project', s.id, app.secured_url(s.id), null, true);
end $$;

create or replace function public.withdraw_invoice_request(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r public.invoice_requests;
begin
  select * into r from public.invoice_requests where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'pending', 'Not pending');
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive withdraws it');
  delete from public.invoice_requests where id = r.id;
  insert into public.secured_log (secured_id, action, note) values (r.secured_id, 'invoice_withdrawn', 'Invoice ' || r.invoice_no || ' withdrawn before approval');
end $$;

revoke execute on function public.decide_invoice_request(bigint, boolean, text), public.withdraw_invoice_request(bigint) from public, anon;
grant execute on function public.decide_invoice_request(bigint, boolean, text), public.withdraw_invoice_request(bigint) to authenticated, service_role;

-- Invoices to approve in SM Projects' approvals (copied from 20260930000084)
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
  order by 8
$$;
