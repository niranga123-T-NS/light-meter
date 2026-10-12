-- GM / DGM change the time of a high level access period (start not yet reached, or the end of one in force)
--  * Still one day at most, the end in the future, no overlap with the person's other periods.
--  * Once a period has started, its start stays; only the end can be moved (earlier or later).
--  * The person is told; a guest's login is switched on again if needed; logged.

create or replace function public.change_high_level(p_id uuid, p_starts timestamptz, p_ends timestamptz, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare g public.high_level_grants; s timestamptz; u public.profiles;
begin
  perform app.require(app.real_gm(), 'Only the GM / DGM changes high level access');
  select * into g from public.high_level_grants where id = p_id;
  perform app.require(found and g.cancelled_at is null and g.ends_at > now(), 'This access period has ended or was cancelled – give a new one');
  s := case when g.starts_at <= now() then g.starts_at else coalesce(p_starts, g.starts_at) end;
  perform app.require(s >= g.starts_at or s >= now() - interval '1 minute', 'The start cannot be moved into the past');
  perform app.require(p_ends > s and p_ends > now(), 'The end must be after the start and in the future');
  perform app.require(p_ends - s <= interval '24 hours', 'High level access is for one day at most');
  perform app.require(not exists (select 1 from public.high_level_grants o where o.user_id = g.user_id and o.id <> g.id and o.cancelled_at is null
    and o.ends_at > s and o.starts_at < p_ends), 'This person already has high level access in that period');
  update public.high_level_grants set starts_at = s, ends_at = p_ends, end_notified = false where id = p_id;
  select * into u from public.profiles where id = g.user_id;
  if u.role = 'guest' and not u.active then update public.profiles set active = true where id = u.id; end if;
  perform app.notify(g.user_id, 'access', 'High level access – time changed',
    format('Now from %s to %s%s', to_char(s at time zone app.tz(), 'DD Mon HH24:MI'), to_char(p_ends at time zone app.tz(), 'DD Mon HH24:MI'),
      coalesce(' – ' || nullif(btrim(p_reason), ''), '')),
    'normal', null, null, '/', 'hl_change:' || p_id || ':' || extract(epoch from now())::bigint, false);
  insert into public.audit_log (user_id, table_name, record_id, action, old_data, new_data)
  values (auth.uid(), 'high_level_grants', p_id, 'CHANGE', jsonb_build_object('starts', g.starts_at, 'ends', g.ends_at),
          jsonb_build_object('starts', s, 'ends', p_ends, 'reason', p_reason));
end $$;
revoke execute on function public.change_high_level(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.change_high_level(uuid, timestamptz, timestamptz, text) to authenticated;
