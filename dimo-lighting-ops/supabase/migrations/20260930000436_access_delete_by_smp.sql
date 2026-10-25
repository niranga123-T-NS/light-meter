-- Execution access: the SEE requests the deletion of an appointment – a subcontractor supervisor, temporary staff, or an approved
-- request whose login was never created – with a reason; SM Projects approves it (no DGM step, also for temporary staff).
-- On approval the person's access to the request's projects ends (all projects for temporary staff), the login is blocked when
-- nothing else is left, and the request is marked deleted. Open items are reassigned first; the history stays under the name.
alter table public.access_requests add column if not exists target_request_id uuid references public.access_requests (id);
alter table public.access_requests drop constraint if exists access_requests_status_check;
alter table public.access_requests add constraint access_requests_status_check
  check (status in ('pending_smp', 'pending_gm', 'approved', 'done', 'rejected', 'cancelled', 'deleted'));

-- Carry out an approved deletion
create or replace function app.do_access_delete(r public.access_requests) returns void
language plpgsql security definer set search_path = public as $$
declare temp boolean := r.role_type in ('assistant_engineer', 'trainee');
begin
  if r.user_id is not null then
    perform app.require((select count(*) from app.open_items(r.user_id)) = 0, 'Open items were given to this person – reassign them first');
    perform app.end_membership(m.id, 'Access deleted') from public.exec_members m
     where m.user_id = r.user_id and m.active and (temp or r.target_request_id is null or m.exec_project_id = any (r.project_ids));
    if temp or not exists (select 1 from public.exec_members where user_id = r.user_id and active) then
      perform set_config('app.exec_access', 'on', true);
      update public.profiles set active = false, revoke_pending = true where id = r.user_id;
    end if;
  end if;
  if r.target_request_id is not null then
    update public.access_requests set status = 'deleted' where id = r.target_request_id;
  end if;
  insert into public.access_log (request_id, user_id, event, note) values (r.id, r.user_id, 'access_deleted', r.reason);
end $$;

-- The SEE asks for an appointment to be deleted
create or replace function public.request_access_delete(p_request uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.access_requests; uid uuid; rid uuid; n int;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'Only the Senior Electrical Engineer requests the deletion');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select * into t from public.access_requests where id = p_request;
  perform app.require(t.id is not null and t.kind in ('temp_add', 'sub_appoint') and t.status in ('approved', 'done'), 'Only an approved appointment can be deleted');
  uid := coalesce(t.created_user_id, case when t.status = 'done' then t.user_id end);
  if uid is not null then
    select count(*) into n from app.open_items(uid);
    perform app.require(n = 0, format('Reassign the %s open items first', n));
  end if;
  perform app.require(not exists (select 1 from public.access_requests where kind = 'temp_delete' and status in ('pending_smp', 'pending_gm')
    and (target_request_id = t.id or (uid is not null and user_id = uid))), 'A deletion request is already pending');
  insert into public.access_requests (code, kind, role_type, person_name, company, email, phone, id_no, user_id, project_ids, reason, target_request_id)
  values (app.next_code('ACR'), 'temp_delete', t.role_type, t.person_name, t.company, t.email, t.phone, t.id_no, uid, t.project_ids, btrim(p_reason), t.id)
  returning id into rid;
  insert into public.access_log (request_id, user_id, event, note) values (rid, uid, 'delete_requested', btrim(p_reason));
  perform app.notify_many(app.role_users('sm_projects'), 'exec_access', 'Delete access – approve',
    format('%s%s · %s', t.person_name, coalesce(' · ' || t.company, ''), btrim(p_reason)), 'normal', 'access_request', rid, '/execution/access/' || rid, null, true);
  return rid;
end $$;
grant execute on function public.request_access_delete(uuid, text) to authenticated;

create or replace function public.decide_access_request(p_id uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r public.access_requests; nxt text;
begin
  select * into r from public.access_requests where id = p_id for update;
  perform app.require(r.id is not null, 'Request not found');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  if r.status = 'pending_smp' then
    perform app.require(app.has_role('sm_projects'), 'Waiting for SM Projects');
    if not p_approve then
      update public.access_requests set status = 'rejected', smp_by = auth.uid(), smp_at = now(), smp_note = btrim(p_note) where id = r.id;
      nxt := 'rejected';
    elsif r.kind = 'temp_delete' then
      -- Deleting access: SM Projects' approval is enough
      perform app.do_access_delete(r);
      update public.access_requests set status = 'done', smp_by = auth.uid(), smp_at = now(), smp_note = nullif(btrim(p_note), '') where id = r.id;
      nxt := 'deleted';
    elsif r.kind = 'sub_appoint' then
      update public.access_requests set status = case when r.user_id is null then 'approved' else 'done' end, smp_by = auth.uid(), smp_at = now(),
        smp_note = nullif(btrim(p_note), '') where id = r.id;
      if r.user_id is not null then
        perform set_config('app.exec_access', 'on', true);
        update public.profiles set active = true, revoke_pending = false, company = coalesce(r.company, company) where id = r.user_id;
        perform app.grant_request_memberships(r, r.user_id);
        perform app.notify(r.user_id, 'exec_project', 'You are appointed to a new project', app.exec_head(r.project_ids[1]), 'normal');
      end if;
      nxt := 'approved';
    else
      update public.access_requests set status = 'pending_gm', smp_by = auth.uid(), smp_at = now(), smp_note = nullif(btrim(p_note), '') where id = r.id;
      perform app.notify_many(app.role_users('gm'), 'exec_access',
        case r.kind when 'temp_add' then 'Temporary staff request – approve' else 'Delete temporary role – approve' end,
        format('%s · approved by SM Projects %s', r.person_name, app.display_name(auth.uid())), 'normal', 'access_request', r.id, '/execution/access/' || r.id, null, true);
      nxt := 'pending_gm';
    end if;
  elsif r.status = 'pending_gm' then
    perform app.require(app.has_role('gm'), 'Waiting for DGM');
    if not p_approve then
      update public.access_requests set status = 'rejected', gm_by = auth.uid(), gm_at = now(), gm_note = btrim(p_note) where id = r.id;
      nxt := 'rejected';
    elsif r.kind = 'temp_add' then
      update public.access_requests set status = 'approved', gm_by = auth.uid(), gm_at = now(), gm_note = nullif(btrim(p_note), '') where id = r.id;
      nxt := 'approved';
    else
      -- a deletion sent to the DGM before SM Projects alone approved deletions
      perform app.do_access_delete(r);
      update public.access_requests set status = 'done', gm_by = auth.uid(), gm_at = now(), gm_note = nullif(btrim(p_note), '') where id = r.id;
      nxt := 'deleted';
    end if;
  else
    perform app.require(false, 'This request is already decided');
  end if;
  insert into public.access_log (request_id, user_id, event, note) values (r.id, r.user_id, 'decision_' || nxt, nullif(btrim(p_note), ''));
  perform app.notify(r.requested_by, 'exec_access',
    format('%s – %s', case r.kind when 'temp_add' then 'Temporary staff request' when 'temp_delete' then 'Access deletion' else 'Supervisor nomination' end,
           case nxt when 'rejected' then 'rejected' when 'pending_gm' then 'approved by SM Projects, now with DGM'
                    when 'approved' then case when r.kind = 'sub_appoint' and r.user_id is not null then 'approved – added to the project'
                                              else 'approved – create the login' end
                    else 'approved by SM Projects – access ended' end),
    concat_ws(' · ', r.person_name, nullif(btrim(p_note), '')), 'normal', 'access_request', r.id, '/execution/access/' || r.id, null, true);
  return nxt;
end $$;

-- the deletion request's name in lists and approvals
do $$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'app') and p.prokind = 'f' and p.prosrc like '%Delete temporary role%' loop
    execute replace(pg_get_functiondef(r.oid), 'Delete temporary role', 'Delete access');
  end loop;
end $$;
