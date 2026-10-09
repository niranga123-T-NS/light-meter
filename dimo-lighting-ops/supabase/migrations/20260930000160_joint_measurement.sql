-- Joint measurement before the IPC: the subcontractor (supervisor) requests a joint measurement first; the project's AE
-- (or the SEE) confirms the date; after it is done the subcontractor uploads the joint measurement sheets, which the AE
-- checks (when a supervisor submitted them and the project has an AE) and the SEE approves – either may return them with
-- comments marked in red on the copy. Only then are the IPC uploads enabled. The red-marked copies are removed (archived)
-- once the SEE gives the final approval – of the joint measurement, and of the IPC (IPA).

alter table public.sub_certs drop constraint if exists sub_certs_status_check;
alter table public.sub_certs add constraint sub_certs_status_check
  check (status in ('jm_requested', 'jm_scheduled', 'jm_ae', 'jm_see', 'jm_returned',
                    'draft', 'ae_review', 'prepared', 'verified', 'approved', 'paid', 'returned', 'cancelled'));
alter table public.sub_certs alter column status set default 'jm_requested';
alter table public.sub_certs add column if not exists jm_requested_date date;
alter table public.sub_certs add column if not exists jm_scope text;
alter table public.sub_certs add column if not exists jm_date date;
alter table public.sub_certs add column if not exists jm_scheduled_by uuid references public.profiles (id);
alter table public.sub_certs add column if not exists jm_note text;
alter table public.sub_certs add column if not exists jm_submitted_at timestamptz;
alter table public.sub_certs add column if not exists jm_ae_by uuid references public.profiles (id);
alter table public.sub_certs add column if not exists jm_ae_at timestamptz;
alter table public.sub_certs add column if not exists jm_see_by uuid references public.profiles (id);
alter table public.sub_certs add column if not exists jm_see_at timestamptz;
alter table public.sub_certs add column if not exists jm_revision int not null default 0;

-- Who checks a project's measurement / IPC first: its active Assistant Engineers
create or replace function app.project_aes(p_exec uuid) returns uuid[] language sql stable security definer set search_path = public as $$
  select array(select m.user_id from public.exec_members m join public.profiles p on p.id = m.user_id
                where m.exec_project_id = p_exec and m.member_role = 'assistant_engineer' and m.active and p.active)
$$;

-- Request a joint measurement – the start of every payment certificate
create or replace function public.prepare_sub_cert(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; c public.sub_certs;
begin
  perform app.require(app.can_record_sub_invoice(p_exec), 'The project''s subcontractor supervisor or Assistant Engineer requests the joint measurement');
  perform app.require(coalesce(btrim(p ->> 'subcontractor'), '') <> '' and coalesce(btrim(p ->> 'period'), '') <> '', 'Enter the subcontractor and the period');
  perform app.require(nullif(p ->> 'jm_date', '') is not null, 'Enter the proposed date for the joint measurement');
  insert into public.sub_certs (code, exec_project_id, subcontractor, period, gross, previous, retention_pct, deductions, note, status, jm_requested_date, jm_scope)
  values (app.next_code('SPC'), p_exec, btrim(p ->> 'subcontractor'), btrim(p ->> 'period'), coalesce(nullif(replace(p ->> 'gross', ',', ''), '')::numeric, 0),
          coalesce(nullif(replace(p ->> 'previous', ',', ''), '')::numeric, 0), coalesce(nullif(p ->> 'retention_pct', '')::numeric, 0),
          coalesce(nullif(replace(p ->> 'deductions', ',', ''), '')::numeric, 0), nullif(btrim(p ->> 'note'), ''), 'jm_requested',
          (p ->> 'jm_date')::date, nullif(btrim(p ->> 'jm_scope'), ''))
  returning * into c;
  perform app.notify_many(array(select unnest(app.project_aes(p_exec)) union select unnest(app.role_users('senior_elec_engineer'))), 'exec_cost',
    'Joint measurement requested', format('%s · %s · %s · proposed %s%s · %s', c.code, c.subcontractor, c.period, to_char(c.jm_requested_date, 'DD Mon YYYY'),
      coalesce(' · ' || c.jm_scope, ''), app.exec_head(p_exec)), 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  return c.id;
end $$;

-- The AE / SEE confirms the joint measurement date
create or replace function public.schedule_joint_measurement(p_id uuid, p_date date, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(c.exec_project_id), 'The project''s Assistant Engineer or the SEE confirms the joint measurement');
  perform app.require(c.status in ('jm_requested', 'jm_scheduled'), 'The joint measurement is already done');
  perform app.require(p_date is not null, 'Enter the date');
  update public.sub_certs set status = 'jm_scheduled', jm_date = p_date, jm_scheduled_by = auth.uid(), jm_note = nullif(btrim(p_note), '') where id = c.id;
  perform app.notify(c.prepared_by, 'exec_cost', 'Joint measurement confirmed',
    format('%s · %s – joint measurement on %s with %s%s. After it, upload the joint measurement sheets here.', c.code, c.subcontractor, to_char(p_date, 'DD Mon YYYY'),
      app.display_name(auth.uid()), coalesce(' · ' || nullif(btrim(p_note), ''), '')), 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
end $$;

-- Submit the joint measurement sheets: the AE checks a supervisor's (if the project has one), then the SEE approves
create or replace function public.submit_joint_measurement(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; aes uuid[]; by_sub boolean; head text;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(c.status in ('jm_scheduled', 'jm_returned'), case when c.status = 'jm_requested' then 'The joint measurement is not confirmed yet' else 'Already submitted' end);
  perform app.require(c.prepared_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Only who requested it submits the sheets');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_cert' and a.entity_id = c.id and a.kind = 'jm_sheet' and a.archived_at is null),
    'Attach the joint measurement sheets (PDF or photos)');
  by_sub := exists (select 1 from public.profiles where id = c.prepared_by and role = 'sub_supervisor');
  aes := app.project_aes(c.exec_project_id);
  update public.sub_certs set status = case when by_sub and cardinality(aes) > 0 then 'jm_ae' else 'jm_see' end, jm_submitted_at = now(),
    jm_revision = jm_revision + case when status = 'jm_returned' then 1 else 0 end, return_note = null
  where id = c.id returning * into c;
  head := format('%s · %s · %s · %s', c.code, c.subcontractor, c.period, app.exec_head(c.exec_project_id));
  perform app.notify_many(case when c.status = 'jm_ae' then aes else app.role_users('senior_elec_engineer') end, 'exec_cost',
    case when c.status = 'jm_ae' then 'Joint measurement sheets to check' else 'Joint measurement sheets to approve' end, head,
    'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  return c.status;
end $$;

-- AE check → SEE approval of the joint measurement sheets (or return with comments marked on the copy)
create or replace function public.decide_joint_measurement(p_id uuid, p_ok boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; nxt text; head text;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Give the reason – and mark the comments on the copy');
  head := format('%s · %s · %s', c.code, c.subcontractor, c.period);
  if c.status = 'jm_ae' then
    perform app.require(app.is_project_ae(c.exec_project_id), 'The project''s Assistant Engineer checks it first');
    nxt := case when p_ok then 'jm_see' else 'jm_returned' end;
    update public.sub_certs set status = nxt, jm_ae_by = auth.uid(), jm_ae_at = now() where id = c.id;
    if p_ok then perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_cost', 'Joint measurement sheets to approve',
      head || ' · checked by ' || app.display_name(auth.uid()) || ' · ' || app.exec_head(c.exec_project_id), 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true); end if;
  elsif c.status = 'jm_see' then
    perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer approves');
    nxt := case when p_ok then 'draft' else 'jm_returned' end;
    update public.sub_certs set status = nxt, jm_see_by = auth.uid(), jm_see_at = now() where id = c.id;
    if p_ok then
      -- final approval: the red-marked copies are removed
      update public.attachments set archived_at = now() where entity_type = 'sub_cert' and entity_id = c.id and kind = 'jm_markup' and archived_at is null;
      perform app.notify(c.prepared_by, 'exec_cost', 'Joint measurement approved – prepare the IPC',
        head || E'\nThe joint measurement sheets are approved. Now enter the IPC figures and upload the IPC and measurement sheets (and any variations) for Interim Payment Approval (IPA).',
        'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
    end if;
  else
    perform app.require(false, 'Not waiting for approval');
  end if;
  if not p_ok then
    update public.sub_certs set returned_by = auth.uid(), return_note = btrim(p_note) where id = c.id;
    perform app.notify(c.prepared_by, 'exec_cost', 'Joint measurement sheets returned with comments', head || E'\n' || btrim(p_note) || E'\nSee the marked-up copy, correct and submit again.',
      'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  end if;
  return nxt;
end $$;

create or replace function public.submit_sub_cert(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; aes uuid[]; by_sub boolean; head text;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(c.status in ('draft', 'returned'), 'Already submitted');
  perform app.require(c.prepared_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Only who prepared it submits it');
  perform app.require(c.gross > 0, 'Enter the IPC figures (gross value of work done to date)');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_cert' and a.entity_id = c.id and a.kind = 'ipc_draft'),
    'Attach the IPC (PDF or photos)');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_cert' and a.entity_id = c.id and a.kind = 'ipc_measure'),
    'Attach the measurement sheets (PDF or photos)');
  perform app.require(not exists (select 1 from public.sub_cert_variations x where x.sub_cert_id = c.id
    and not exists (select 1 from public.attachments a where a.entity_type = 'sub_cert_var' and a.entity_id = x.id)),
    'Attach the IPC / measurement sheets of each ticked variation separately: ' ||
    coalesce((select string_agg(x.var_code, ', ' order by x.var_code) from public.sub_cert_variations x where x.sub_cert_id = c.id
      and not exists (select 1 from public.attachments a where a.entity_type = 'sub_cert_var' and a.entity_id = x.id)), ''));
  -- prepared by a subcontractor supervisor: the project's Assistant Engineer checks it first (if the project has one)
  by_sub := exists (select 1 from public.profiles where id = c.prepared_by and role = 'sub_supervisor');
  aes := array(select m.user_id from public.exec_members m join public.profiles p on p.id = m.user_id
                where m.exec_project_id = c.exec_project_id and m.member_role = 'assistant_engineer' and m.active and p.active);
  update public.sub_certs set status = case when by_sub and cardinality(aes) > 0 then 'ae_review' else 'prepared' end, submitted_at = now(),
    revision = revision + case when status = 'returned' then 1 else 0 end, return_note = null
  where id = c.id returning * into c;
  head := format('%s · %s · %s · net %s · %s', c.code, c.subcontractor, c.period, app.fmt_money(c.net, 'LKR'), app.exec_head(c.exec_project_id));
  if c.status = 'ae_review' then
    perform app.notify_many(aes, 'exec_cost', 'Subcontractor IPC to check', head, 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_cost', 'Subcontractor IPC – IPA pending', head, 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  end if;
  return c.status;
end $$;

create or replace function public.advance_sub_cert(p_id uuid, p_ok boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; nxt text; head text;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(c.status not like 'jm\_%', 'The joint measurement comes first');
  if c.status in ('draft', 'returned') then
    return public.submit_sub_cert(c.id);
  end if;
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Give the reason – and mark the comments on the copy');
  head := format('%s · %s · %s · net %s', c.code, c.subcontractor, c.period, app.fmt_money(c.net, 'LKR'));
  if c.status = 'ae_review' then
    perform app.require(app.is_project_ae(c.exec_project_id), 'The project''s Assistant Engineer checks it first');
    nxt := case when p_ok then 'prepared' else 'returned' end;
    update public.sub_certs set status = nxt, ae_by = auth.uid(), ae_at = now() where id = c.id;
    if p_ok then perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_cost', 'Subcontractor IPC – IPA pending',
      head || ' · checked by ' || app.display_name(auth.uid()) || ' · ' || app.exec_head(c.exec_project_id), 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true); end if;
  elsif c.status = 'prepared' then
    perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer approves');
    nxt := case when p_ok then 'verified' else 'returned' end;
    update public.sub_certs set status = nxt, verified_by = auth.uid(), verified_at = now() where id = c.id;
    if p_ok then
      -- IPA given: the red-marked copies are removed
      update public.attachments set archived_at = now() where entity_type = 'sub_cert' and entity_id = c.id and kind = 'ipc_markup' and archived_at is null;
      perform app.notify(c.prepared_by, 'exec_cost', 'IPA approved – record the invoice',
        head || E'\nInterim Payment Approval (IPA) given by the Senior Electrical Engineer. Now record the subcontractor invoice with the IPA-approved IPC with signatures and the corrected (final) measurement sheets.'
          || coalesce(E'\nNote: ' || nullif(btrim(p_note), ''), ''),
        'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
      perform app.notify_many(app.role_users('sm_projects'), 'exec_cost', 'Subcontractor payment certificate to approve', head || ' · ' || app.exec_head(c.exec_project_id),
        'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
    end if;
  elsif c.status = 'verified' then
    perform app.require(app.has_role('sm_projects'), 'SM Projects approves');
    nxt := case when p_ok then 'approved' else 'returned' end;
    update public.sub_certs set status = nxt, approved_by = auth.uid(), approved_at = now() where id = c.id;
    if p_ok then perform app.notify_many(app.role_users('operations_exec'), 'exec_cost', 'Subcontractor payment approved – process the payment', head,
      'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id); end if;
  elsif c.status = 'approved' then
    perform app.require(app.has_role('operations_exec'), 'Operations records the payment');
    perform app.require(p_ok and coalesce(btrim(p_note), '') <> '', 'Enter the payment reference');
    nxt := 'paid';
    update public.sub_certs set status = 'paid', paid_ref = btrim(p_note), paid_at = now() where id = c.id;
  else
    perform app.require(false, case c.status when 'paid' then 'Already paid' else 'Withdrawn' end);
  end if;
  if not p_ok then
    update public.sub_certs set returned_by = auth.uid(), return_note = btrim(p_note) where id = c.id;
    perform app.notify(c.prepared_by, 'exec_cost', 'IPC returned with comments', head || E'\n' || btrim(p_note) || E'\nSee the marked-up copy, correct and submit again.',
      'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  end if;
  return nxt;
end $$;

create or replace function public.cancel_sub_cert(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null and c.status in ('jm_requested', 'jm_scheduled', 'jm_returned', 'draft', 'returned'), 'Only a certificate not waiting for approval can be withdrawn');
  perform app.require(c.prepared_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Not allowed');
  update public.sub_certs set status = 'cancelled' where id = c.id;
end $$;

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
    select count(*) into n from public.sub_certs where exec_project_id = p_exec and status in ('jm_requested', 'jm_scheduled', 'jm_ae', 'jm_see', 'jm_returned', 'draft', 'ae_review', 'returned', 'prepared', 'verified', 'approved');
    c := c || jsonb_build_array(jsonb_build_object('check', 'Subcontractors finally certified and paid', 'ok', n = 0, 'detail', n || ' open'));
  end if;
  return c;
end $$;

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

create or replace function app.can_write_attachment(p_entity_type text, p_entity_id uuid, p_kind text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role();
begin
  case p_entity_type
  when 'visit' then return exists (select 1 from public.visits where id = p_entity_id and sales_person_id = auth.uid()) or r = 'sm_projects';
  when 'tender' then return exists (select 1 from public.tenders where id = p_entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return exists (select 1 from public.inquiries where id = p_entity_id and (sales_person_id = auth.uid() or r in ('sm_projects', 'gm')));
  when 'design_job' then
    return r = 'design_manager' or exists (select 1 from public.design_jobs where id = p_entity_id and assignee_id = auth.uid());
  when 'estimation_job' then
    return r = 'sm_estimation' or exists (select 1 from public.estimation_jobs where id = p_entity_id and assignee_id = auth.uid());
  when 'clarification' then
    return r in ('design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec');
  when 'sample' then
    return r = 'operations_exec' or exists (select 1 from public.samples where id = p_entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then return r = 'operations_exec';
  when 'retention' then return app.can_edit_retention(p_entity_id);
  when 'bond' then return r = 'operations_exec' and exists (select 1 from public.bonds where id = p_entity_id);
  when 'warranty' then return app.is_warranty_desk() and exists (select 1 from public.warranties where id = p_entity_id);
  when 'warranty_claim' then
    return exists (select 1 from public.warranty_claims c where c.id = p_entity_id and (app.is_warranty_desk() or c.assignee_id = auth.uid()));
  when 'warranty_report' then
    return exists (select 1 from public.warranty_reports x where x.id = p_entity_id and (x.sales_person_id = auth.uid() or app.is_warranty_desk()));
  when 'rma' then return app.is_warranty_desk() and exists (select 1 from public.manufacturer_claims where id = p_entity_id);
  when 'warranty_registration' then return app.is_warranty_desk() and exists (select 1 from public.warranty_registrations where id = p_entity_id);
  when 'eng_job' then
    return exists (select 1 from public.eng_jobs where id = p_entity_id and (assignee_id = auth.uid() or app.is_eng_lead()));
  when 'eng_job_update' then
    return exists (select 1 from public.eng_job_updates u join public.eng_jobs j on j.id = u.job_id
                   where u.id = p_entity_id and (j.assignee_id = auth.uid() or app.is_eng_lead()));
  when 'exec_report' then
    return exists (select 1 from public.exec_reports x where x.id = p_entity_id and x.author_id = auth.uid() and x.status in ('submitted', 'returned'));
  when 'exec_worker' then
    return exists (select 1 from public.exec_workers x where x.id = p_entity_id and (app.has_role('senior_elec_engineer') or app.is_project_ae(x.exec_project_id)
      or (x.added_by = auth.uid() and x.verified_at is null)
      -- the crew's supervisor uploads the police report (storage checks without a kind)
      or ((p_kind is null or p_kind = 'police_report') and (x.supervisor_id = auth.uid() or x.added_by = auth.uid()))));
  when 'hse_record' then
    return exists (select 1 from public.hse_records x where x.id = p_entity_id and (app.is_exec_member(x.exec_project_id) or app.has_role('senior_elec_engineer')));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = p_entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
      or exists (select 1 from public.hse_actions a where a.report_id = x.id and a.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = p_entity_id and (x.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects')));
  when 'material_request' then
    return exists (select 1 from public.material_requests x where x.id = p_entity_id and app.is_exec_internal(x.exec_project_id) and not app.has_role('gm'))
      -- the supervisor who raised the request or acknowledges its delivery: delivery notes and photos
      or (r = 'sub_supervisor' and app.can_read_mr(p_entity_id) and (p_kind is null or p_kind in ('mr_doc', 'grn_photo')));
  when 'exec_doc' then
    return exists (select 1 from public.exec_docs x where x.id = p_entity_id and x.uploaded_by = auth.uid());
  when 'design_query' then
    return exists (select 1 from public.design_queries x where x.id = p_entity_id
      and (x.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'design_manager', 'lighting_designer', 'lighting_engineer')));
  when 'snag' then
    return exists (select 1 from public.snags x where x.id = p_entity_id and (app.has_role('senior_elec_engineer') or app.is_project_ae(x.exec_project_id)));
  when 'dossier_item' then
    return exists (select 1 from public.exec_dossier x where x.id = p_entity_id and (app.has_role('senior_elec_engineer', 'operations_exec') or app.is_project_ae(x.exec_project_id)));
  when 'test_record' then
    return exists (select 1 from public.test_records x where x.id = p_entity_id and (x.performed_by = auth.uid() or app.has_role('senior_elec_engineer')));
  when 'instrument' then
    return app.has_role('senior_elec_engineer', 'operations_exec', 'sm_projects');
  when 'sub_invoice' then
    -- the copy: who recorded it, while a draft or returned · the marked-up copy: the SEE / Operations while it waits for them
    return exists (select 1 from public.sub_invoices x where x.id = p_entity_id and (
      ((p_kind is null or p_kind in ('sinv_doc', 'ipc_signed', 'measure_final')) and x.status in ('draft', 'returned')
        and (x.created_by = auth.uid() or (app.can_record_sub_invoice(x.exec_project_id) and not app.has_role('sub_supervisor'))))
      or ((p_kind is null or p_kind = 'sinv_markup') and ((x.status = 'ae_review' and app.is_project_ae(x.exec_project_id))
                                                          or (x.status = 'submitted' and app.has_role('senior_elec_engineer'))
                                                          or (x.status = 'see_approved' and app.has_role('operations_exec'))))));
  when 'sub_cert_var' then
    -- a ticked variation's IPC / sheets: as the IPC's own documents
    return exists (select 1 from public.sub_cert_variations v join public.sub_certs x on x.id = v.sub_cert_id where v.id = p_entity_id
      and (p_kind is null or p_kind = 'ipc_var') and x.status in ('draft', 'returned') and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')));
  when 'sub_invoice_var' then
    return exists (select 1 from public.sub_invoice_variations v join public.sub_invoices x on x.id = v.invoice_id where v.id = p_entity_id
      and (p_kind is null or p_kind = 'var_final') and x.status in ('draft', 'returned')
      and (x.created_by = auth.uid() or (app.can_record_sub_invoice(x.exec_project_id) and not app.has_role('sub_supervisor'))));
  when 'sub_cert' then
    -- the IPC and measurement sheets: who prepared it, while a draft or returned · the marked-up copy: the AE / SEE while it waits for them
    return exists (select 1 from public.sub_certs x where x.id = p_entity_id and (
      ((p_kind is null or p_kind in ('ipc_draft', 'ipc_measure')) and x.status in ('draft', 'returned')
        and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')))
      or ((p_kind is null or p_kind = 'jm_sheet') and x.status in ('jm_scheduled', 'jm_returned')
        and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')))
      or ((p_kind is null or p_kind = 'jm_markup') and ((x.status = 'jm_ae' and app.is_project_ae(x.exec_project_id))
                                                        or (x.status = 'jm_see' and app.has_role('senior_elec_engineer'))))
      or ((p_kind is null or p_kind = 'ipc_markup') and ((x.status = 'ae_review' and app.is_project_ae(x.exec_project_id))
                                                         or (x.status = 'prepared' and app.has_role('senior_elec_engineer'))))));
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = p_entity_id and ((x.requested_by = auth.uid() and x.status = 'pending_smp') or app.has_role('sm_projects')));
  else return false;
  end case;
end $$;

revoke execute on function public.schedule_joint_measurement(uuid, date, text), public.submit_joint_measurement(uuid), public.decide_joint_measurement(uuid, boolean, text) from public, anon;
grant execute on function public.schedule_joint_measurement(uuid, date, text), public.submit_joint_measurement(uuid), public.decide_joint_measurement(uuid, boolean, text) to authenticated, service_role;
