-- Smart drawings on or off per project. The Senior Electrical Engineer chooses it in the execution details (a choice has to
-- be made); it can be switched on at any time. Switching it off once it is in use needs SM Projects' approval with a reason.
-- When it is off, nothing on the drawings can be added or changed (what was recorded is kept and can be read).

alter table public.exec_projects add column if not exists smart_drawings boolean; -- null: not chosen yet
update public.exec_projects p set smart_drawings = true where smart_drawings is null and exists (select 1 from public.exec_drawings d where d.exec_project_id = p.id);

create table public.exec_drawing_switches (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  reason text not null check (btrim(reason) <> ''),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by uuid references public.profiles (id) default auth.uid(),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text
);
create unique index exec_drawing_switches_one_pending on public.exec_drawing_switches (exec_project_id) where status = 'pending';
alter table public.exec_drawing_switches enable row level security;
create policy exec_drawing_switches_read on public.exec_drawing_switches for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.exec_drawing_switches to authenticated;

create or replace function app.drawings_on(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select smart_drawings from public.exec_projects where id = p_exec), false)
$$;

-- every change on the drawings goes through these two: off means read-only
create or replace function app.drawing_can_edit(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.drawings_on(p_exec) and (app.has_role('senior_elec_engineer', 'sm_projects') or (app.has_role('assistant_engineer') and app.is_exec_member(p_exec)))
$$;
create or replace function app.drawing_can_update(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.drawing_can_edit(p_exec) or (app.drawings_on(p_exec) and app.has_role('trainee', 'sub_supervisor') and app.is_exec_member(p_exec))
$$;

-- the execution details now carry the choice
create or replace function public.update_exec_project(p_id uuid, p jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare ar text[]; cur boolean; want boolean := nullif(p ->> 'smart_drawings', '')::boolean;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'Only the Senior Electrical Engineer or SM Projects edits execution details');
  perform app.require(exists (select 1 from public.exec_projects where id = p_id and status = 'active'), 'Execution project not found or closed');
  select coalesce(array_agg(x), '{}') into ar from jsonb_array_elements_text(coalesce(p -> 'areas', '[]')) x;
  perform app.require(cardinality(ar) > 0 and ar <@ app.exec_areas(), 'Choose at least one valid project area');
  select smart_drawings into cur from public.exec_projects where id = p_id;
  perform app.require(want is not null or cur is not null, 'Choose whether the project uses smart drawings');
  perform app.require(not (cur is true and want is false), 'Smart drawings are in use – stopping them needs SM Projects'' approval (request it with a reason)');
  update public.exec_projects set areas = ar, site_address = nullif(btrim(p ->> 'site_address'), ''),
    lat = nullif(p ->> 'lat', '')::float8, lng = nullif(p ->> 'lng', '')::float8,
    start_date = nullif(p ->> 'start_date', '')::date, end_date = nullif(p ->> 'end_date', '')::date,
    see_id = coalesce(nullif(p ->> 'see_id', '')::uuid, see_id), smart_drawings = coalesce(want, smart_drawings), updated_at = now()
  where id = p_id;
end $function$;

create or replace function public.request_drawings_off(p_exec uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer asks to stop smart drawings');
  perform app.require(app.drawings_on(p_exec), 'Smart drawings are not in use on this project');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Say why the project stops using smart drawings');
  perform app.require(not exists (select 1 from public.exec_drawing_switches where exec_project_id = p_exec and status = 'pending'), 'A request is already with SM Projects');
  insert into public.exec_drawing_switches (exec_project_id, reason) values (p_exec, btrim(p_reason)) returning id into rid;
  perform app.notify_many(app.role_users('sm_projects'), 'drawings_off', 'Approve: stop smart drawings',
    app.exec_head(p_exec) || ' · ' || btrim(p_reason) || ' · ' || app.display_name(auth.uid()), 'normal', 'exec_project', p_exec, '/execution/start?id=' || p_exec, null, true);
  return rid;
end $$;

create or replace function public.withdraw_drawings_off(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.exec_drawing_switches;
begin
  select * into r from public.exec_drawing_switches where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'pending', 'Nothing to withdraw');
  perform app.require(r.requested_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Only the Senior Electrical Engineer withdraws it');
  update public.exec_drawing_switches set status = 'withdrawn', decided_by = auth.uid(), decided_at = now() where id = p_id;
end $$;

create or replace function public.decide_drawings_off(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.exec_drawing_switches;
begin
  select * into r from public.exec_drawing_switches where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'pending', 'This request is no longer waiting');
  perform app.require(app.has_role('sm_projects'), 'SM Projects decides');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Say why it stays on');
  update public.exec_drawing_switches set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(p_note), '') where id = p_id;
  if p_approve then update public.exec_projects set smart_drawings = false, updated_at = now() where id = r.exec_project_id; end if;
  perform app.notify_many(array[r.requested_by], 'drawings_off',
    case when p_approve then 'Smart drawings stopped' else 'Smart drawings stay in use' end,
    app.exec_head(r.exec_project_id) || coalesce(' · ' || nullif(btrim(p_note), ''), ''), 'normal', 'exec_project', r.exec_project_id, '/execution/' || r.exec_project_id, null, true);
end $$;

create or replace function app.exec_pending_approvals()
 RETURNS TABLE(source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text, requested_at timestamp with time zone, inquiry_id uuid, url text, step text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  union all
  select 'scrap', x.id, 'scrap_disposal', format('Scrap disposal %s – %s', x.code, coalesce(app.exec_head(x.exec_project_id), x.location)),
         concat_ws(' · ', case x.method when 'sell' then 'Sell' || coalesce(' – ' || (select q.buyer || ' ' || app.fmt_money(q.amount_lkr, 'LKR') from public.scrap_quotes q where q.id = x.selected_quote_id), '')
                                         else 'Free of charge – ' || x.foc_to end, x.scrap_reason),
         x.requested_by, app.display_name(x.requested_by), coalesce(case when x.status = 'pending_dgm' then x.smp_at end, x.submitted_at), null::uuid,
         '/execution/scrap/' || x.id, case x.status when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.scrap_disposals x
  where (x.status = 'pending_smp' and app.has_role('sm_projects')) or (x.status = 'pending_dgm' and app.has_role('gm'))
  union all
  select 'drawings_off', r.id, 'drawings_off', 'Stop using smart drawings – ' || app.exec_head(r.exec_project_id), r.reason, r.requested_by,
         app.display_name(r.requested_by), r.requested_at, null::uuid, '/execution/start?id=' || r.exec_project_id, 'SM Projects'
  from public.exec_drawing_switches r
  where r.status = 'pending' and app.has_role('sm_projects')
$function$;

revoke execute on function public.request_drawings_off(uuid, text), public.withdraw_drawings_off(uuid), public.decide_drawings_off(uuid, boolean, text) from public, anon;
grant execute on function public.request_drawings_off(uuid, text), public.withdraw_drawings_off(uuid), public.decide_drawings_off(uuid, boolean, text) to authenticated;
