-- A subcontractor supervisor (or temporary staff member) whose login was created outside the nomination – e.g. by the System
-- Administrator in Admin → Users – was never added to the project team, so the project stayed invisible. An approved nomination
-- is now linked to the account with the same mobile number or email: for existing accounts now, and whenever an account is
-- created or its mobile / email changes. People without a project see why (waiting for approval, starts on a date…).

create or replace function app.digits(p text) returns text language sql immutable as $$ select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') $$;

-- Link the approved, not yet provisioned requests that match this account (same role, same mobile or email)
create or replace function app.link_approved_access(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare pr public.profiles; r public.access_requests; n int := 0;
begin
  select * into pr from public.profiles where id = p_user;
  if pr.id is null or pr.role::text not in ('sub_supervisor', 'assistant_engineer', 'trainee') then return 0; end if;
  for r in select * from public.access_requests x
            where x.status = 'approved' and x.kind in ('sub_appoint', 'temp_add') and x.role_type = pr.role::text
              and ((x.email is not null and lower(x.email) = lower(pr.email))
                or (app.digits(x.phone) is not null and right(app.digits(x.phone), 9) = right(coalesce(app.digits(pr.phone), app.digits(split_part(pr.email, '@', 1)), ''), 9)))
  loop
    perform set_config('app.exec_access', 'on', true);
    update public.profiles set is_temporary = r.kind = 'temp_add' and r.role_type = 'assistant_engineer', access_until = r.end_date,
      company = coalesce(r.company, company), id_no = coalesce(r.id_no, id_no), phone = coalesce(phone, r.phone), active = true where id = pr.id;
    perform app.grant_request_memberships(r, pr.id);
    update public.access_requests set status = 'done', created_user_id = pr.id, provisioned_at = now() where id = r.id;
    insert into public.access_log (request_id, user_id, event, note) values (r.id, pr.id, 'login_created', 'Linked to the existing account');
    perform app.notify_many(app.role_users('sm_projects') || array[r.requested_by], 'exec_access', 'Account linked – ' || r.person_name,
      'The approved appointment was linked to the existing login', 'normal', 'access_request', r.id, '/execution/access/' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function app.profiles_link_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.link_approved_access(new.id);
  return null;
end $$;
drop trigger if exists profiles_link_access on public.profiles;
create trigger profiles_link_access after insert or update of email, phone, role on public.profiles
  for each row when (pg_trigger_depth() = 0) execute function app.profiles_link_access();

-- Existing accounts: link now
do $$ declare p uuid; begin
  for p in select id from public.profiles where role in ('sub_supervisor', 'assistant_engineer', 'trainee') loop
    perform app.link_approved_access(p);
  end loop;
end $$;

-- For the "My work" page: why a person has no project yet
create or replace function public.my_exec_access() returns table (project text, state text, since date)
language sql stable security definer set search_path = public as $$
  select e.code || ' ' || e.name,
         case when not m.active then 'removed from the project'
              when m.valid_from > (now() at time zone app.tz())::date then 'starts'
              when m.valid_to < (now() at time zone app.tz())::date then 'ended'
              else 'active' end,
         case when m.valid_from > (now() at time zone app.tz())::date then m.valid_from else m.valid_to end
    from public.exec_members m join public.exec_projects e on e.id = m.exec_project_id where m.user_id = auth.uid()
  union all
  select (select string_agg(e.code || ' ' || e.name, ', ') from public.exec_projects e where e.id = any (r.project_ids)),
         case r.status when 'pending_smp' then 'waiting for SM Projects to approve' when 'pending_gm' then 'waiting for DGM / GM to approve' else 'approved – login being linked' end,
         r.start_date
    from public.access_requests r join public.profiles p on p.id = auth.uid()
   where r.status in ('pending_smp', 'pending_gm', 'approved') and r.kind in ('sub_appoint', 'temp_add')
     and (r.user_id = p.id or (r.email is not null and lower(r.email) = lower(p.email))
          or (app.digits(r.phone) is not null and right(app.digits(r.phone), 9) = right(coalesce(app.digits(p.phone), ''), 9)))
$$;
revoke execute on function public.my_exec_access() from public, anon;
grant execute on function public.my_exec_access() to authenticated, service_role;

-- Creating the login from the nomination: the account may already have been linked by the trigger above
create or replace function public.complete_access_provision(p_request uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.access_requests;
begin
  select * into r from public.access_requests where id = p_request for update;
  -- already linked when the account was created (same mobile / email): nothing more to do
  if r.status = 'done' and r.created_user_id = p_user then return; end if;
  perform app.require(r.id is not null and r.status = 'approved' and r.kind in ('temp_add', 'sub_appoint'), 'Request not ready');
  update public.profiles set is_temporary = r.kind = 'temp_add' and r.role_type = 'assistant_engineer',
    access_until = r.end_date, company = r.company, id_no = r.id_no, phone = coalesce(r.phone, phone) where id = p_user;
  perform app.grant_request_memberships(r, p_user);
  update public.access_requests set status = 'done', created_user_id = p_user, provisioned_at = now() where id = r.id;
  insert into public.access_log (request_id, user_id, event) values (r.id, p_user, 'login_created');
  perform app.notify_many(app.role_users('sm_projects') || array[r.requested_by], 'exec_access', 'Login created – ' || r.person_name,
    case r.kind when 'sub_appoint' then 'Subcontractor supervisor · ' || coalesce(r.company, '') else 'Temporary staff' end, 'normal',
    'access_request', r.id, '/execution/access/' || r.id);
end $$;
