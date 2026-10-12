-- High level access for a completely new person (from outside the user list)
--  * GM / DGM create the person in the High level users screen: the admin-users function makes a login with the
--    role 'guest' (no access of its own) and a temporary password shown once; the grant is then given as usual.
--  * A guest sees the app only through the high level view (view only) during the period; outside it, nothing.
--  * When the period ends (or is cancelled) and no other period is in force or coming, the guest's login is
--    switched off automatically; a new grant switches it on again.

-- An inactive guest can be given a new period (it reactivates the login)
create or replace function public.grant_high_level(p_user uuid, p_starts timestamptz, p_ends timestamptz, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u public.profiles; gid uuid; s timestamptz := coalesce(p_starts, now());
begin
  perform app.require(app.real_gm(), 'Only the GM / DGM gives high level access');
  select * into u from public.profiles where id = p_user;
  perform app.require(found and (u.active or u.role = 'guest'), 'Choose an active user');
  perform app.require(u.role not in ('gm', 'sys_admin'), 'This person already has full access');
  perform app.require(u.id <> auth.uid(), 'Not to yourself');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(p_ends > s and p_ends > now(), 'The end must be after the start and in the future');
  perform app.require(p_ends - s <= interval '24 hours', 'High level access is for one day at most');
  perform app.require(not exists (select 1 from public.high_level_grants g where g.user_id = p_user and g.cancelled_at is null and g.ends_at > s and g.starts_at < p_ends),
    'This person already has high level access in that period');
  if u.role = 'guest' and not u.active then
    update public.profiles set active = true where id = p_user;
  end if;
  insert into public.high_level_grants (user_id, starts_at, ends_at, reason) values (p_user, s, p_ends, btrim(p_reason)) returning id into gid;
  perform app.notify(p_user, 'access', 'High level access (view only)',
    format('From %s to %s you can view everything the GM / DGM sees%s. Reason: %s',
      to_char(s at time zone app.tz(), 'DD Mon HH24:MI'), to_char(p_ends at time zone app.tz(), 'DD Mon HH24:MI'),
      case when u.role = 'guest' then '' else ' – switch to "View as high level user"' end, btrim(p_reason)),
    'normal', null, null, '/', 'hl_grant:' || gid, false);
  insert into public.audit_log (user_id, table_name, record_id, action, new_data)
  values (auth.uid(), 'high_level_grants', gid, 'GRANT', jsonb_build_object('user', p_user, 'starts', s, 'ends', p_ends, 'reason', p_reason, 'guest', u.role = 'guest'));
  return gid;
end $$;

-- Switch off a guest's login when nothing is in force or coming
create or replace function app.guest_wrapup(p_user uuid, p_at timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = p_user and role = 'guest' and active)
     and not exists (select 1 from public.high_level_grants g where g.user_id = p_user and g.cancelled_at is null and g.ends_at > p_at) then
    update public.profiles set active = false where id = p_user;
    insert into public.audit_log (user_id, table_name, record_id, action, new_data) values (null, 'users', p_user, 'DEACTIVATE', jsonb_build_object('reason', 'High level access ended'));
  end if;
end $$;

create or replace function public.cancel_high_level(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare g public.high_level_grants;
begin
  perform app.require(app.real_gm(), 'Only the GM / DGM cancels high level access');
  select * into g from public.high_level_grants where id = p_id;
  perform app.require(found and g.cancelled_at is null and g.ends_at > now(), 'Not in force');
  update public.high_level_grants set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = nullif(btrim(p_reason), ''), end_notified = true where id = p_id;
  perform app.notify(g.user_id, 'access', 'High level access cancelled', coalesce(nullif(btrim(p_reason), ''), 'Cancelled by the GM / DGM'), 'normal', null, null, '/', 'hl_cancel:' || p_id, false);
  insert into public.audit_log (user_id, table_name, record_id, action, new_data) values (auth.uid(), 'high_level_grants', p_id, 'CANCEL', jsonb_build_object('reason', p_reason));
  perform app.guest_wrapup(g.user_id);
end $$;

create or replace function public.high_level_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare g record; n int := 0;
begin
  for g in select * from public.high_level_grants where cancelled_at is null and not end_notified and ends_at <= p_at loop
    perform app.notify_many(array[g.user_id, g.granted_by], 'access', 'High level access ended',
      format('%s · ended %s', (select full_name from public.profiles where id = g.user_id), to_char(g.ends_at at time zone app.tz(), 'DD Mon HH24:MI')),
      'normal', null, null, '/', 'hl_end:' || g.id, false);
    update public.high_level_grants set end_notified = true where id = g.id;
    insert into public.audit_log (user_id, table_name, record_id, action, new_data) values (g.granted_by, 'high_level_grants', g.id, 'ENDED', jsonb_build_object('ends', g.ends_at));
    perform app.guest_wrapup(g.user_id, p_at);
    n := n + 1;
  end loop;
  return n;
end $$;
