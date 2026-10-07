-- Programme: the SEE changes the dates freely while the programme is a draft; submitting finalises it. After it is
-- submitted (waiting for SM Projects, or approved as the baseline) the SEE asks SM Projects for permission to edit again;
-- when allowed the programme goes back to draft (an approved baseline stays in force until the revision is approved).

alter table public.exec_programmes add column if not exists edit_reason text;
alter table public.exec_programmes add column if not exists edit_requested_by uuid references public.profiles (id);
alter table public.exec_programmes add column if not exists edit_requested_at timestamptz;

create or replace function app.programme_edit(p_exec uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer prepares the programme');
  perform app.require(exists (select 1 from public.exec_projects where id = p_exec and status = 'active'), 'Project not active');
  select status into st from public.exec_programmes where exec_project_id = p_exec;
  perform app.require(st is not null, 'Set the programme start date first');
  perform app.require(st = 'draft', 'The programme is submitted – ask SM Projects for permission to edit it');
end $$;

create or replace function public.request_programme_edit(p_exec uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare pg public.exec_programmes;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer asks to edit the programme');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select * into pg from public.exec_programmes where exec_project_id = p_exec for update;
  perform app.require(pg.exec_project_id is not null and pg.status in ('submitted', 'approved'), 'The programme can be edited already');
  perform app.require(pg.edit_requested_at is null, 'A request is already with SM Projects');
  update public.exec_programmes set edit_reason = btrim(p_reason), edit_requested_by = auth.uid(), edit_requested_at = now() where exec_project_id = p_exec;
  perform app.notify_many(app.role_users('sm_projects'), 'exec_programme', 'Permission to edit the programme',
    app.exec_head(p_exec) || ' · ' || btrim(p_reason) || ' · ' || app.display_name(auth.uid()), 'normal', 'exec_project', p_exec,
    '/execution/' || p_exec || '?tab=programme', null, true);
end $$;

create or replace function public.decide_programme_edit(p_exec uuid, p_allow boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare pg public.exec_programmes;
begin
  select * into pg from public.exec_programmes where exec_project_id = p_exec for update;
  perform app.require(pg.edit_requested_at is not null, 'No request to edit');
  if not p_allow and pg.edit_requested_by = auth.uid() and not app.has_role('sm_projects') then
    update public.exec_programmes set edit_reason = null, edit_requested_by = null, edit_requested_at = null where exec_project_id = p_exec;
    return 'withdrawn';
  end if;
  perform app.require(app.has_role('sm_projects'), 'SM Projects gives permission to edit the programme');
  perform app.require(p_allow or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.exec_programmes set status = case when p_allow then 'draft' else status end,
    edit_reason = null, edit_requested_by = null, edit_requested_at = null, updated_at = now()
  where exec_project_id = p_exec;
  perform app.notify(pg.edit_requested_by, 'exec_programme', case when p_allow then 'You can edit the programme' else 'Programme edit not allowed' end,
    concat_ws(' · ', app.exec_head(p_exec), case when p_allow and pg.version > 0 then 'submit the revision when done – the approved baseline stays until SM Projects approves it' end,
              nullif(btrim(p_note), '')),
    'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=programme');
  return case when p_allow then 'allowed' else 'refused' end;
end $$;

revoke execute on function public.request_programme_edit(uuid, text), public.decide_programme_edit(uuid, boolean, text) from public, anon;
grant execute on function public.request_programme_edit(uuid, text), public.decide_programme_edit(uuid, boolean, text) to authenticated;

-- Approvals: permission to edit (copied from 20260930000118_exec_boq_mos.sql)
create or replace function app.exec_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
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
  select 'exec_gate', g.id, 'exec_gate', format('Stage gate %s – %s', g.gate, app.exec_head(g.exec_project_id)), g.note, g.requested_by,
         app.display_name(g.requested_by), g.requested_at, null::uuid, '/execution/' || g.exec_project_id, null
  from public.exec_gates g where g.status = 'pending' and app.has_role('sm_projects')
  union all
  select 'sub_cert', c.id, 'exec_sub_cert', format('Subcontractor payment %s – %s', c.code, c.subcontractor), app.exec_head(c.exec_project_id) || ' · ' || app.fmt_money(c.net, 'LKR'),
         c.prepared_by, app.display_name(c.prepared_by), c.prepared_at, null::uuid, '/execution/' || c.exec_project_id || '?tab=cost',
         case c.status when 'prepared' then 'Verify' when 'verified' then 'Approve' else 'Pay' end
  from public.sub_certs c
  where (c.status = 'prepared' and app.has_role('senior_elec_engineer')) or (c.status = 'verified' and app.has_role('sm_projects'))
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
         concat_ws(' · ', 'finish ' || to_char(pg.forecast_finish, 'DD Mon YYYY'), pg.submit_note), pg.submitted_by, app.display_name(pg.submitted_by), pg.submitted_at, null::uuid,
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
