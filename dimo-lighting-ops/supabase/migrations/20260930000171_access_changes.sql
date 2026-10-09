-- Changing an appointment (subcontractor supervisor / temporary staff) after it was approved: the SEE proposes the change
-- (name, company, mobile / email, ID, zones, period) with a reason; SM Projects approves it, then it applies to the request,
-- the person's project memberships (period, zones) and their profile. A change while still waiting for SM Projects applies at once.

create table if not exists public.access_changes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.access_requests (id) on delete cascade,
  proposed jsonb not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text
);
create unique index if not exists access_changes_one_pending on public.access_changes (request_id) where status = 'pending';
alter table public.access_changes enable row level security;
drop policy if exists access_changes_read on public.access_changes;
create policy access_changes_read on public.access_changes for select to authenticated using (app.has_role('senior_elec_engineer', 'sm_projects', 'gm'));
grant select on public.access_changes to authenticated;

-- Apply a change to the request, the memberships and the profile
create or replace function app.apply_access_change(p_request uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.access_requests; uid uuid;
begin
  select * into r from public.access_requests where id = p_request for update;
  update public.access_requests set
    person_name = coalesce(nullif(btrim(p ->> 'person_name'), ''), person_name),
    company = case when p ? 'company' then coalesce(case when r.kind = 'sub_appoint' then app.sub_name(r.project_ids[1], p ->> 'company') end, nullif(btrim(p ->> 'company'), ''), company) else company end,
    phone = coalesce(app.digits(p ->> 'phone'), phone),
    email = case when p ? 'email' then nullif(lower(btrim(p ->> 'email')), '') else email end,
    id_no = coalesce(nullif(btrim(p ->> 'id_no'), ''), id_no),
    zones = case when p ? 'zones' then nullif(btrim(p ->> 'zones'), '') else zones end,
    start_date = coalesce(nullif(p ->> 'start_date', '')::date, start_date),
    end_date = coalesce(nullif(p ->> 'end_date', '')::date, end_date)
  where id = r.id returning * into r;
  uid := coalesce(r.created_user_id, r.user_id);
  if uid is not null then
    update public.exec_members set valid_from = coalesce(r.start_date, valid_from), valid_to = r.end_date, zones = r.zones
     where user_id = uid and exec_project_id = any (r.project_ids) and active;
    perform set_config('app.exec_access', 'on', true);
    update public.profiles set company = coalesce(r.company, company), access_until = r.end_date, id_no = coalesce(r.id_no, id_no),
      full_name = coalesce(nullif(btrim(p ->> 'person_name'), ''), full_name) where id = uid;
  end if;
end $$;

create or replace function public.propose_access_change(p_request uuid, p jsonb, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare r public.access_requests;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer changes appointments');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason for the change');
  select * into r from public.access_requests where id = p_request;
  perform app.require(r.id is not null and r.kind in ('sub_appoint', 'temp_add'), 'Request not found');
  perform app.require(r.status in ('pending_smp', 'approved', 'done'), 'This request can no longer be changed');
  perform app.require(nullif(p ->> 'start_date', '') is null or nullif(p ->> 'end_date', '') is null or (p ->> 'end_date')::date >= (p ->> 'start_date')::date,
    'The end date is before the start date');
  if r.status = 'pending_smp' then
    -- not decided yet: SM Projects sees the corrected request
    perform app.apply_access_change(r.id, p);
    insert into public.access_log (request_id, event, note) values (r.id, 'changed', btrim(p_reason));
    return 'applied';
  end if;
  perform app.require(not exists (select 1 from public.access_changes where request_id = r.id and status = 'pending'), 'A change is already waiting for SM Projects');
  insert into public.access_changes (request_id, proposed, reason) values (r.id, p, btrim(p_reason));
  perform app.notify_many(app.role_users('sm_projects'), 'exec_access', 'Appointment change to approve – ' || r.person_name,
    format('%s · %s', r.code, btrim(p_reason)), 'normal', 'access_request', r.id, '/execution/access/' || r.id, null, true);
  return 'pending';
end $$;

create or replace function public.decide_access_change(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.access_changes; r public.access_requests;
begin
  perform app.require(app.has_role('sm_projects'), 'SM Projects approves appointment changes');
  select * into c from public.access_changes where id = p_id for update;
  perform app.require(c.id is not null and c.status = 'pending', 'Not waiting for approval');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  if p_approve then perform app.apply_access_change(c.request_id, c.proposed); end if;
  update public.access_changes set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(p_note), '') where id = c.id;
  select * into r from public.access_requests where id = c.request_id;
  insert into public.access_log (request_id, event, note) values (r.id, case when p_approve then 'changed' else 'change_rejected' end, c.reason);
  perform app.notify(c.requested_by, 'exec_access', case when p_approve then 'Appointment change approved – ' else 'Appointment change rejected – ' end || r.person_name,
    coalesce(nullif(btrim(p_note), ''), c.reason), 'normal', 'access_request', r.id, '/execution/access/' || r.id);
  if p_approve and coalesce(r.created_user_id, r.user_id) is not null then
    perform app.notify(coalesce(r.created_user_id, r.user_id), 'exec_project', 'Your appointment was updated',
      format('%s → %s%s', to_char(r.start_date, 'DD Mon YYYY'), coalesce(to_char(r.end_date, 'DD Mon YYYY'), '—'), coalesce(' · ' || r.zones, '')), 'normal');
  end if;
end $$;

create or replace function app.exec_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
  select 'access_change', c.id, 'exec_access', 'Appointment change – ' || r.person_name, c.reason, c.requested_by, app.display_name(c.requested_by),
         c.requested_at, null::uuid, '/execution/access/' || r.id, 'SM Projects'
  from public.access_changes c join public.access_requests r on r.id = c.request_id
  where c.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'access_request', r.id, 'exec_access',
         format('%s – %s', case r.kind when 'temp_add' then case r.role_type when 'trainee' then 'Trainee' else 'Temporary Assistant Engineer' end
                                       when 'temp_delete' then 'Delete temporary role' else 'Subcontractor supervisor' end, r.person_name),
         concat_ws(' · ', r.company, r.reason), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid,
         '/execution/access/' || r.id, case r.status when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.access_requests r
  where (r.status = 'pending_smp' and app.has_role('sm_projects')) or (r.status = 'pending_gm' and app.has_role('gm'))
  union all
  select 'exec_plan', pl.id, 'exec_plan', format('Weekly plan – %s – week of %s', app.display_name(pl.ae_id), to_char(pl.week_start, 'DD Mon')),
         concat_ws(' · ', app.exec_head(pl.exec_project_id), case when pl.is_late then 'submitted late' end), pl.ae_id, app.display_name(pl.ae_id),
         pl.submitted_at, null::uuid, '/execution/plan/' || pl.id, null
  from public.exec_plans pl where pl.status = 'submitted' and app.has_role('senior_elec_engineer')
  union all
  select 'variation', v.id, 'exec_variation',
         format('Variation %s – %s%s', v.code, v.title,
                case when v.value_lkr is not null then format(' (%s%s)', case when v.value_lkr > 0 then '+' else '−' end, app.fmt_money(abs(v.value_lkr), 'LKR')) else '' end),
         app.exec_head(v.exec_project_id), v.raised_by, app.display_name(v.raised_by), v.raised_at, null::uuid, '/execution/variation/' || v.id,
         case v.status when 'raised' then 'Screen' when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.variations v
  where (v.status = 'raised' and app.has_role('senior_elec_engineer')) or (v.status = 'pending_smp' and app.has_role('sm_projects'))
     or (v.status = 'pending_gm' and app.has_role('gm'))
  union all
  select 'material_request', m.id, 'exec_material', format('Material request %s', m.code), app.mr_head(m), m.requested_by, app.display_name(m.requested_by),
         m.requested_at, null::uuid, '/execution/material/' || m.id, case m.status when 'submitted' then 'Senior Electrical Engineer' else 'SM Projects' end
  from public.material_requests m
  where (m.status = 'submitted' and app.has_role('senior_elec_engineer')) or (m.status = 'pending_smp' and app.has_role('sm_projects'))
  union all
  select 'design_query', q.id, 'exec_design_query', format('Design query %s', q.code), concat_ws(' · ', app.exec_head(q.exec_project_id), q.question),
         q.raised_by, app.display_name(q.raised_by), q.raised_at, null::uuid, '/execution/query/' || q.id,
         case q.status when 'raised' then 'Screen' else 'Answer' end
  from public.design_queries q
  where (q.status = 'raised' and app.has_role('senior_elec_engineer')) or (q.status = 'forwarded' and app.has_role('design_manager'))
  union all
  select 'exec_gate', g.id, 'exec_gate', format('%s – %s', (array['Programme approved', 'Handover to the client', 'Project closure'])[g.gate], app.exec_head(g.exec_project_id)), g.note, g.requested_by,
         app.display_name(g.requested_by), g.requested_at, null::uuid, '/execution/' || g.exec_project_id, null
  from public.exec_gates g where g.status = 'pending' and not g.legacy and app.has_role('sm_projects')
  union all
  select 'sub_cert', c.id, 'exec_sub_cert', format('Subcontractor payment %s – %s', c.code, c.subcontractor), app.exec_head(c.exec_project_id) || ' · ' || app.fmt_money(c.net, 'LKR'),
         c.prepared_by, app.display_name(c.prepared_by), coalesce(c.submitted_at, c.prepared_at), null::uuid, '/execution/sub-cert/' || c.id,
         case c.status when 'jm_requested' then 'Confirm joint measurement' when 'jm_ae' then 'JM – AE check' when 'jm_see' then 'JM – SEE approval' when 'ae_review' then 'AE check' when 'prepared' then 'SEE approval' when 'verified' then 'SM Projects' else 'Pay' end
  from public.sub_certs c
  where (c.status = 'ae_review' and app.is_project_ae(c.exec_project_id)) or (c.status = 'jm_ae' and app.is_project_ae(c.exec_project_id))
     or (c.status = 'jm_see' and app.has_role('senior_elec_engineer'))
     or (c.status = 'jm_requested' and (app.has_role('senior_elec_engineer') or app.is_project_ae(c.exec_project_id))) or (c.status = 'prepared' and app.has_role('senior_elec_engineer')) or (c.status = 'verified' and app.has_role('sm_projects'))
     or (c.status = 'approved' and app.has_role('operations_exec'))
  union all
  select 'test_record', t.id, 'exec_test', format('Test record %s – %s', t.code, t.system), app.exec_head(t.exec_project_id) || ' · ' || t.result, t.performed_by,
         app.display_name(t.performed_by), t.performed_at, null::uuid, '/execution/' || t.exec_project_id || '?tab=qa', 'Verify'
  from public.test_records t where t.status = 'submitted' and app.has_role('senior_elec_engineer')
  union all
  select 'exec_request', r.id, 'exec_request', format('%s – %s', case r.kind when 'won' then 'Hand over to execution' else 'Project won before the system' end, r.name),
         concat_ws(' · ', r.client_name, r.note), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid, '/execution/handover/' || r.id, 'SM Projects'
  from public.exec_requests r where r.status = 'pending_smp' and app.has_role('sm_projects')
  union all
  select 'exec_programme', pg.exec_project_id, 'exec_programme', case when pg.version = 0 then 'Programme – ' else 'Revised programme – ' end || app.exec_head(pg.exec_project_id),
         concat_ws(' · ', 'finish ' || to_char(pg.forecast_finish, 'DD Mon YYYY'), pg.submit_note, case when (pg.billing_check ->> 'red')::int > 0 then format('%s invoice(s) %s would miss their month: %s', pg.billing_check ->> 'red', app.fmt_money((pg.billing_check ->> 'red_amount')::numeric, 'LKR'), pg.billing_note) end), pg.submitted_by, app.display_name(pg.submitted_by), pg.submitted_at, null::uuid,
         '/execution/' || pg.exec_project_id || '?tab=programme', 'SM Projects'
  from public.exec_programmes pg where pg.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'exec_boq', b.exec_project_id, 'exec_billing', case when b.version = 0 then 'Contract BOQ – ' else 'Revised contract BOQ – ' end || app.exec_head(b.exec_project_id),
         concat_ws(' · ', app.fmt_money(b.total, 'LKR'), b.submit_note), b.uploaded_by, app.display_name(b.uploaded_by), b.uploaded_at, null::uuid,
         '/execution/boq/' || b.exec_project_id, 'SM Projects'
  from public.exec_boqs b where b.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'programme_edit', pg.exec_project_id, 'exec_programme', 'Permission to edit the programme – ' || app.exec_head(pg.exec_project_id),
         pg.edit_reason, pg.edit_requested_by, app.display_name(pg.edit_requested_by), pg.edit_requested_at, null::uuid,
         '/execution/' || pg.exec_project_id || '?tab=programme', 'SM Projects'
  from public.exec_programmes pg where pg.edit_requested_at is not null and app.has_role('sm_projects')
$$;

revoke execute on function public.propose_access_change(uuid, jsonb, text), public.decide_access_change(uuid, boolean, text) from public, anon;
grant execute on function public.propose_access_change(uuid, jsonb, text), public.decide_access_change(uuid, boolean, text) to authenticated, service_role;
