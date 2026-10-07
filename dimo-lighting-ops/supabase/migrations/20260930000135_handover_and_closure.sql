-- Execution stages without checkpoints to request: work starts by itself when SM Projects approves the programme (stage 1 → 2);
-- the SEE hands the project over to the client in the Handover tab (handover date, signed certificate; SM Projects approves,
-- stage 2 → 3, DLP starts) and closes it from the Overview after the DLP (SM Projects approves). Invoice triggers: programme
-- approved / handed over / project closed.
alter table public.exec_gates add column if not exists event_date date;

create or replace function app.start_after_programme() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.version > coalesce(old.version, 0) and exists (select 1 from public.exec_projects where id = new.exec_project_id and stage = 1 and status = 'active') then
    update public.exec_projects set stage = 2, updated_at = now() where id = new.exec_project_id;
    insert into public.exec_gates (exec_project_id, gate, status, note, decided_by, decided_at, event_date)
    values (new.exec_project_id, 1, 'approved', 'Programme approved – work started', auth.uid(), now(), (now() at time zone app.tz())::date);
    perform app.check_invoice_triggers(new.exec_project_id);
  end if;
  return new;
end $$;
create trigger exec_programmes_start after update of version on public.exec_programmes for each row execute function app.start_after_programme();

-- Projects already with an approved programme start now; a waiting "Ready to start" request is withdrawn
update public.exec_gates set status = 'rejected', note = concat_ws(' · ', note, 'Not needed – work starts with the approved programme'), decided_at = now()
 where status = 'pending' and gate = 1;
insert into public.exec_gates (exec_project_id, gate, status, note, decided_at, event_date)
select e.id, 1, 'approved', 'Programme approved – work started', now(), (now() at time zone app.tz())::date
  from public.exec_projects e where e.stage = 1 and e.status = 'active' and exists (select 1 from public.exec_programmes pg where pg.exec_project_id = e.id and pg.version > 0);
update public.exec_projects e set stage = 2, updated_at = now()
 where e.stage = 1 and e.status = 'active' and exists (select 1 from public.exec_programmes pg where pg.exec_project_id = e.id and pg.version > 0);

drop function if exists public.request_gate(uuid, jsonb, text);
-- (copied from 20260930000132_simple_checkpoints.sql)
create or replace function public.request_gate(p_exec uuid, p_checklist jsonb, p_note text, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.exec_projects; gid uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer requests the handover / closure');
  select * into e from public.exec_projects where id = p_exec;
  perform app.require(e.id is not null and e.status = 'active', 'Project not active');
  perform app.require(e.stage > 1, 'Work starts by itself when SM Projects approves the programme');
  perform app.require(not exists (select 1 from public.exec_gates where exec_project_id = p_exec and status = 'pending'), 'Already waiting for SM Projects');
  perform app.require(e.stage <> 2 or (p_date is not null and p_date <= (now() at time zone app.tz())::date), 'Enter the date the project was handed over to the client');
  insert into public.exec_gates (exec_project_id, gate, checklist, checks, note, event_date) values (p_exec, e.stage, coalesce(p_checklist, '{}'), app.gate_checks(p_exec, e.stage), nullif(btrim(p_note), ''), p_date)
  returning id into gid;
  perform app.notify_many(app.role_users('sm_projects'), 'exec_gate',
    format('%s to approve – %s', (array['Programme approved', 'Handover to the client', 'Project closure'])[e.stage], e.name), coalesce(btrim(p_note), ''), 'normal',
    'exec_project', p_exec, '/execution/' || p_exec, null, true);
  return gid;
end $$;
revoke execute on function public.request_gate(uuid, jsonb, text, date) from public, anon;
grant execute on function public.request_gate(uuid, jsonb, text, date) to authenticated;

-- (copied from 20260930000132_simple_checkpoints.sql)
create or replace function public.decide_gate(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare g public.exec_gates; fresh jsonb; open_items boolean; lbl text;
begin
  perform app.require(app.has_role('sm_projects'), 'SM Projects approves the handover and the closure');
  select * into g from public.exec_gates where id = p_id for update;
  perform app.require(g.id is not null and g.status = 'pending', 'Not waiting');
  lbl := (array['Programme approved', 'Handover to the client', 'Project closure'])[g.gate];
  fresh := app.gate_checks(g.exec_project_id, g.gate);
  select exists (select 1 from jsonb_array_elements(fresh) x where not (x ->> 'ok')::boolean) into open_items;
  perform app.require(not p_approve or not open_items or coalesce(btrim(p_note), '') <> '', 'Items are open – give the reason to approve anyway (override)');
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

-- (copied from 20260930000133_billing_driven_programme.sql)
create or replace function app.check_invoice_triggers(p_exec uuid) returns int
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in select x.*, a.code, a.name, a.actual_finish from public.exec_invoice_triggers x left join public.exec_activities a on a.id = x.activity_id
           where x.exec_project_id = p_exec and x.approved and x.ready_at is null and x.claimable_at is null loop
    if t.kind = 'gate' and exists (select 1 from public.exec_gates where exec_project_id = p_exec and gate >= t.gate and status = 'approved' and not legacy) then
      perform app.mark_claimable(t.line_id, (array['Programme approved', 'Handed over to the client', 'Project closed'])[t.gate]); n := n + 1;
    elsif t.kind = 'activity' and t.actual_finish is not null then
      perform app.mark_claimable(t.line_id, format('%s %s finished %s', t.code, t.name, to_char(t.actual_finish, 'DD Mon'))); n := n + 1;
    elsif t.kind = 'delivery' and not exists (select 1 from public.material_requests m where m.id = any (t.mr_ids) and m.status <> 'received') then
      perform app.mark_claimable(t.line_id, 'Delivered to site and acknowledged: ' ||
        (select string_agg(m.code, ', ' order by m.code) from public.material_requests m where m.id = any (t.mr_ids))); n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- (copied from 20260930000133_billing_driven_programme.sql)
create or replace function app.billing_rows(p_exec uuid default null)
returns table (exec_project_id uuid, project text, see_id uuid, line_id uuid, secured_id uuid, description text, amount numeric, open_amount numeric,
               original_month date, forecast_month date, kind text, trigger_label text, activity_id uuid, forecast_date date, deadline date,
               float_days int, stage text, status text, cert_id uuid, cert_code text, open_actions int, pending_move boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.see_id, l.id, l.secured_id, coalesce(l.description, initcap(l.kind)), l.amount, app.line_open(l.id),
         l.original_month, l.forecast_month, t.kind,
         case when t.line_id is null then 'No trigger'
              when t.kind = 'activity' then (select a.code || ' ' || a.name from public.exec_activities a where a.id = t.activity_id)
              when t.kind = 'gate' then (array['Programme approved', 'Handed over to the client', 'Project closed'])[t.gate]
              when t.kind = 'delivery' then 'Materials delivered'
              when t.kind = 'ipc' then 'Progress claim (IPC)' else 'SEE confirms the work' end,
         t.activity_id, x.f, app.invoice_deadline(l.forecast_month),
         case when x.f is not null and t.claimable_at is null then app.work_float(x.f, app.invoice_deadline(l.forecast_month)) end,
         case when t.ready_at is not null then 'invoice' when t.claimable_at is not null then 'certificate' else 'work' end,
         case when t.ready_at is not null then 'ready'
              when t.line_id is null then 'no_trigger'
              when t.claimable_at is not null and c.id is not null then
                case when app.work_float(x.today, app.month_wd_back(l.forecast_month, 0)) < 3 then 'red' else 'amber' end
              when t.claimable_at is not null then case when x.today > app.invoice_deadline(l.forecast_month) then 'red' else 'amber' end
              when x.f is null then 'no_date'
              when app.work_float(x.f, app.invoice_deadline(l.forecast_month)) >= app.billing_amber() then 'green'
              when app.work_float(x.f, app.invoice_deadline(l.forecast_month)) >= 0 then 'amber'
              else 'red' end,
         c.id, c.code,
         (select count(*)::int from public.exec_billing_actions b where b.line_id = l.id and b.status = 'open'),
         exists (select 1 from public.invoice_line_changes ch where ch.line_id = l.id and ch.status = 'pending')
  from public.exec_projects e
  join public.invoice_lines l on l.secured_id = e.secured_id
  left join public.exec_invoice_triggers t on t.line_id = l.id
  left join public.exec_payment_certs c on c.line_id = l.id and c.status = 'submitted'
  left join lateral (select app.trigger_forecast(t) f, (now() at time zone app.tz())::date today) x on true
  where e.status = 'active' and (p_exec is null or e.id = p_exec) and app.line_open(l.id) > 0
$$;

-- (copied from 20260930000133_billing_driven_programme.sql)
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
  select 'exec_gate', g.id, 'exec_gate', format('%s – %s', (array['Programme approved', 'Handover to the client', 'Project closure'])[g.gate], app.exec_head(g.exec_project_id)), g.note, g.requested_by,
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
