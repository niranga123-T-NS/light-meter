-- The joint measurement date is confirmed by the project's AE (the SEE only when the project has no AE). The SEE is told
-- once it is confirmed and sees it on the certificate.

-- Who confirms a joint measurement date of a project
create or replace function app.can_confirm_jm(p_exec uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.is_project_ae(p_exec) or (app.has_role('senior_elec_engineer') and cardinality(app.project_aes(p_exec)) = 0)
$$;

create or replace function public.prepare_sub_cert(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; c public.sub_certs; v public.variations; sname text; own text;
begin
  perform app.require(app.can_record_sub_invoice(p_exec), 'The project''s subcontractor supervisor or Assistant Engineer requests the joint measurement');
  perform app.require(coalesce(btrim(p ->> 'subcontractor'), '') <> '' and coalesce(btrim(p ->> 'period'), '') <> '', 'Enter the subcontractor and the period');
  perform app.require(nullif(p ->> 'jm_date', '') is not null, 'Enter the proposed date for the joint measurement');
  sname := app.sub_name(p_exec, p ->> 'subcontractor');
  if app.has_role('sub_supervisor') then
    own := (select company from public.profiles where id = auth.uid());
    perform app.require(own is null or lower(btrim(own)) = lower(sname), 'A subcontractor supervisor requests measurements for their own company (' || coalesce(own, '') || ')');
  end if;
  if nullif(p ->> 'variation_id', '') is not null then
    select * into v from public.variations where id = (p ->> 'variation_id')::uuid;
    perform app.require(v.id is not null and v.exec_project_id = p_exec and v.status in ('approved', 'client_accepted'), 'Only approved variations of this project');
  end if;
  insert into public.sub_certs (code, exec_project_id, subcontractor, period, gross, previous, retention_pct, deductions, note, status, jm_requested_date, jm_scope, variation_id, var_code, var_title)
  values (app.next_code('SPC'), p_exec, sname, btrim(p ->> 'period'), coalesce(nullif(replace(p ->> 'gross', ',', ''), '')::numeric, 0),
          coalesce(nullif(replace(p ->> 'previous', ',', ''), '')::numeric, 0), coalesce(nullif(p ->> 'retention_pct', '')::numeric, 0),
          coalesce(nullif(replace(p ->> 'deductions', ',', ''), '')::numeric, 0), nullif(btrim(p ->> 'note'), ''), 'jm_requested',
          (p ->> 'jm_date')::date, nullif(btrim(p ->> 'jm_scope'), ''), v.id, coalesce(nullif(v.vo_no, ''), v.code), v.title)
  returning * into c;
  perform app.notify_many(case when cardinality(app.project_aes(p_exec)) > 0 then app.project_aes(p_exec) else app.role_users('senior_elec_engineer') end, 'exec_cost',
    'Joint measurement requested', format('%s · %s · %s · %s · proposed %s%s · %s', c.code, coalesce('Variation ' || c.var_code, 'BOQ work'), c.subcontractor, c.period, to_char(c.jm_requested_date, 'DD Mon YYYY'),
      coalesce(' · ' || c.jm_scope, ''), app.exec_head(p_exec)), 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  return c.id;
end $$;

create or replace function public.schedule_joint_measurement(p_id uuid, p_date date, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(app.can_confirm_jm(c.exec_project_id), 'The project''s Assistant Engineer confirms the joint measurement');
  perform app.require(c.status in ('jm_requested', 'jm_scheduled'), 'The joint measurement is already done');
  perform app.require(p_date is not null, 'Enter the date');
  update public.sub_certs set status = 'jm_scheduled', jm_date = p_date, jm_scheduled_by = auth.uid(), jm_note = nullif(btrim(p_note), '') where id = c.id;
  perform app.notify(c.prepared_by, 'exec_cost', 'Joint measurement confirmed',
    format('%s · %s – joint measurement on %s with %s%s. After it, upload the joint measurement sheets here.', c.code, c.subcontractor, to_char(p_date, 'DD Mon YYYY'),
      app.display_name(auth.uid()), coalesce(' · ' || nullif(btrim(p_note), ''), '')), 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  perform app.notify_many(array(select unnest(app.role_users('senior_elec_engineer')) except select auth.uid()), 'exec_cost', 'Joint measurement confirmed',
    format('%s · %s · %s · %s – joint measurement on %s, confirmed by %s%s · %s', c.code, coalesce('Variation ' || c.var_code, 'BOQ work'), c.subcontractor, c.period,
      to_char(p_date, 'DD Mon YYYY'), app.display_name(auth.uid()), coalesce(' · ' || nullif(btrim(p_note), ''), ''), app.exec_head(c.exec_project_id)),
    'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
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
     or (c.status = 'jm_requested' and app.can_confirm_jm(c.exec_project_id)) or (c.status = 'prepared' and app.has_role('senior_elec_engineer')) or (c.status = 'verified' and app.has_role('sm_projects'))
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
