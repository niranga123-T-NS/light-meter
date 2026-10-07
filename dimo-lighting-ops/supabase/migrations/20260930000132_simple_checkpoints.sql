-- Simpler execution stages: three checkpoints instead of six stage gates. Progress in between comes from the programme.
--   Stage 1 Mobilising  → checkpoint 1 "Ready to start"  (team in place, programme approved)         → Stage 2 In progress
--   Stage 2 In progress → checkpoint 2 "Handover"         (tests, NCRs, snags, dossier, client sign-off) → Stage 3 Handed over (DLP)
--   Stage 3 Handed over → checkpoint 3 "Close-out"        (materials, HSE, variations, subcontractors)   → closed
-- Old gates are kept as history (legacy); old stages and invoice triggers are mapped to the nearest new ones.
alter table public.exec_gates add column if not exists legacy boolean not null default false;
update public.exec_gates set legacy = true;
update public.exec_gates set status = 'rejected', note = concat_ws(' · ', note, 'Stages simplified – request the new checkpoint again'), decided_at = now()
 where status = 'pending';

alter table public.exec_projects drop constraint if exists exec_projects_stage_check;
update public.exec_projects set stage = case when stage <= 2 then 1 when stage <= 5 then 2 else 3 end, updated_at = now();
update public.exec_projects set stage = 3 where status = 'closed';
alter table public.exec_projects add constraint exec_projects_stage_check check (stage between 1 and 3);

-- Checkpoints already passed under the old stages, carried over (inserted, so no billing fires again)
insert into public.exec_gates (exec_project_id, gate, status, note, decided_at)
select e.id, g, 'approved', 'Carried over from the earlier stage gates', now()
  from public.exec_projects e cross join generate_series(1, 3) g
 where g < e.stage or (g = 3 and e.status = 'closed');

alter table public.exec_invoice_triggers drop constraint if exists exec_invoice_triggers_gate_check;
update public.exec_invoice_triggers set gate = case when gate <= 2 then 1 when gate <= 5 then 2 else 3 end where gate is not null;
alter table public.exec_invoice_triggers add constraint exec_invoice_triggers_gate_check check (gate between 1 and 3);

create or replace function app.gate_checks(p_exec uuid, p_gate int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb := '[]'; n int;
begin
  if p_gate = 1 then
    select count(*) into n from public.exec_members where exec_project_id = p_exec and active and member_role <> 'sub_supervisor';
    c := c || jsonb_build_array(jsonb_build_object('check', 'Engineer(s) on the project', 'ok', n > 0, 'detail', n || ' on the team'));
    select count(*) into n from public.exec_programmes where exec_project_id = p_exec and version > 0;
    c := c || jsonb_build_array(jsonb_build_object('check', 'Programme approved by SM Projects', 'ok', n > 0, 'detail', case when n > 0 then 'approved' else 'not approved' end));
  elsif p_gate = 2 then
    select count(*) into n from public.ncrs where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open NCR', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.test_records where exec_project_id = p_exec and status <> 'verified';
    c := c || jsonb_build_array(jsonb_build_object('check', 'All test records verified', 'ok', n = 0, 'detail', n || ' not verified'));
    select count(*) into n from public.snags where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'All snags closed', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.exec_dossier where exec_project_id = p_exec and mandatory and not done;
    c := c || jsonb_build_array(jsonb_build_object('check', 'Mandatory dossier items present', 'ok', n = 0 and exists (select 1 from public.exec_dossier where exec_project_id = p_exec), 'detail', n || ' missing'));
  elsif p_gate = 3 then
    select count(*) into n from public.material_requests where exec_project_id = p_exec and status in ('submitted', 'pending_smp', 'approved', 'ordered', 'part_received');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open material requests / orders', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.hse_reports where exec_project_id = p_exec and status = 'open';
    c := c || jsonb_build_array(jsonb_build_object('check', 'No open HSE reports', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.variations where exec_project_id = p_exec and status in ('raised', 'pricing', 'pending_smp', 'pending_gm', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'No variation still open', 'ok', n = 0, 'detail', n || ' open'));
    select count(*) into n from public.sub_certs where exec_project_id = p_exec and status in ('prepared', 'verified', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'Subcontractors finally certified and paid', 'ok', n = 0, 'detail', n || ' open'));
  end if;
  return c;
end $$;

create or replace function public.request_gate(p_exec uuid, p_checklist jsonb, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; gid uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer requests the checkpoint');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(e.id is not null and e.status = 'active', 'Project not active');
  perform app.require(not exists (select 1 from public.exec_gates where exec_project_id = p_exec and status = 'pending'), 'A checkpoint is already waiting for SM Projects');
  insert into public.exec_gates (exec_project_id, gate, checklist, checks, note) values (p_exec, e.stage, coalesce(p_checklist, '{}'), app.gate_checks(p_exec, e.stage), nullif(btrim(p_note), ''))
  returning id into gid;
  perform app.notify_many(app.role_users('sm_projects'), 'exec_gate',
    format('%s to approve – %s', (array['Ready to start', 'Handover', 'Close-out'])[e.stage], e.name), coalesce(btrim(p_note), ''), 'normal',
    'exec_project', p_exec, '/execution/' || p_exec, null, true);
  return gid;
end $$;

create or replace function public.decide_gate(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare g public.exec_gates; fresh jsonb; open_items boolean; lbl text;
begin
  perform app.require(app.has_role('sm_projects'), 'SM Projects approves the checkpoints');
  select * into g from public.exec_gates where id = p_id for update;
  perform app.require(g.id is not null and g.status = 'pending', 'Not waiting');
  lbl := (array['Ready to start', 'Handover', 'Close-out'])[g.gate];
  fresh := app.gate_checks(g.exec_project_id, g.gate);
  select exists (select 1 from jsonb_array_elements(fresh) x where not (x ->> 'ok')::boolean) into open_items;
  perform app.require(not p_approve or not open_items or coalesce(btrim(p_note), '') <> '', 'Items are open – give the reason to pass the checkpoint anyway (override)');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.exec_gates set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    checks = fresh, override = p_approve and open_items, note = concat_ws(' · ', note, nullif(btrim(p_note), '')) where id = g.id;
  if p_approve then
    update public.exec_projects set stage = least(3, g.gate + 1), status = case when g.gate = 3 then 'closed' else status end, updated_at = now() where id = g.exec_project_id;
  end if;
  perform app.notify_many(app.role_users('senior_elec_engineer') || app.project_aes(g.exec_project_id), 'exec_gate',
    format('%s %s%s', lbl, case when p_approve then 'approved' else 'not approved' end, case when p_approve and open_items then ' (override)' else '' end),
    concat_ws(' · ', app.exec_head(g.exec_project_id), nullif(btrim(p_note), '')), 'normal', 'exec_project', g.exec_project_id, '/execution/' || g.exec_project_id);
end $$;

-- Invoice triggers on the new checkpoints (copied from 20260930000117_exec_billing_link.sql)
create or replace function public.set_invoice_trigger(p_exec uuid, p_line uuid, p_kind text, p_gate int default null, p_activity uuid default null,
                                                      p_mrs uuid[] default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer sets the invoice triggers');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(e.secured_id is not null and exists (select 1 from public.invoice_lines where id = p_line and secured_id = e.secured_id), 'Invoice line of another project');
  perform app.require(p_kind in ('gate', 'activity', 'delivery', 'ipc', 'manual'), 'Choose the trigger');
  perform app.require(p_kind <> 'gate' or p_gate between 1 and 3, 'Choose the checkpoint');
  perform app.require(p_kind <> 'activity' or exists (select 1 from public.exec_activities where id = p_activity and exec_project_id = p_exec), 'Choose a programme activity');
  perform app.require(p_kind <> 'delivery' or (cardinality(p_mrs) > 0 and not exists (select 1 from unnest(p_mrs) x where not exists (
    select 1 from public.material_requests m where m.id = x and m.exec_project_id = p_exec and m.status not in ('rejected', 'cancelled')))),
    'Choose the material requests of this project');
  insert into public.exec_invoice_triggers (line_id, exec_project_id, kind, gate, activity_id, mr_ids)
  values (p_line, p_exec, p_kind, case when p_kind = 'gate' then p_gate end, case when p_kind = 'activity' then p_activity end,
          case when p_kind = 'delivery' then p_mrs end)
  on conflict (line_id) do update set kind = excluded.kind, gate = excluded.gate, activity_id = excluded.activity_id, mr_ids = excluded.mr_ids, approved = false,
    set_by = auth.uid(), set_at = now()
  where exec_invoice_triggers.ready_at is null;
  perform app.require(found, 'This invoice is already marked ready – the trigger cannot change');
  -- After the baseline the change waits for SM Projects (once a day per project)
  if exists (select 1 from public.exec_programmes where exec_project_id = p_exec and version > 0) then
    perform app.notify_many(app.role_users('sm_projects'), 'exec_billing', 'Invoice triggers to approve', app.exec_head(p_exec), 'normal', 'exec_project', p_exec,
      '/execution/' || p_exec || '?tab=billing', format('billtrig:%s:%s', p_exec, (now() at time zone app.tz())::date), true);
  end if;
  perform app.check_invoice_triggers(p_exec);
end $$;

create or replace function app.check_invoice_triggers(p_exec uuid) returns int
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in select x.*, a.code, a.name, a.actual_finish from public.exec_invoice_triggers x left join public.exec_activities a on a.id = x.activity_id
           where x.exec_project_id = p_exec and x.approved and x.ready_at is null loop
    if t.kind = 'gate' and exists (select 1 from public.exec_gates where exec_project_id = p_exec and gate >= t.gate and status = 'approved' and not legacy) then
      perform app.mark_invoice_ready(t.line_id, format('Checkpoint %s passed', t.gate)); n := n + 1;
    elsif t.kind = 'activity' and t.actual_finish is not null then
      perform app.mark_invoice_ready(t.line_id, format('%s %s finished %s', t.code, t.name, to_char(t.actual_finish, 'DD Mon'))); n := n + 1;
    elsif t.kind = 'delivery' and not exists (select 1 from public.material_requests m where m.id = any (t.mr_ids) and m.status <> 'received') then
      perform app.mark_invoice_ready(t.line_id, 'Delivered to site and acknowledged: ' ||
        (select string_agg(m.code, ', ' order by m.code) from public.material_requests m where m.id = any (t.mr_ids))); n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Approvals list names the checkpoint (copied from 20260930000125_programme_edit_permission.sql)
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
  select 'exec_gate', g.id, 'exec_gate', format('%s – %s', (array['Ready to start', 'Handover', 'Close-out'])[g.gate], app.exec_head(g.exec_project_id)), g.note, g.requested_by,
         app.display_name(g.requested_by), g.requested_at, null::uuid, '/execution/' || g.exec_project_id, null
  from public.exec_gates g where g.status = 'pending' and not g.legacy and app.has_role('sm_projects')
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
