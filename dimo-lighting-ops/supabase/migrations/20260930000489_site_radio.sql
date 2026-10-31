-- Site radio (walkie-talkie) for each execution project's crew.
--  * One channel per execution project. Everyone who can open the project talks on it: its Assistant Engineers,
--    Trainees and subcontractor supervisors, plus the Senior Electrical Engineer, SM Projects, GM and the
--    Operations Executive (app.can_read_exec).
--  * A voice message is a short clip (up to 2 minutes) in the private "radio" bucket at <project id>/<sender id>/<file>;
--    a text message is up to 500 characters. Messages arrive live (realtime) and play on the crew's phones.
--  * An emergency call also sends a critical notification (and push) to the whole crew, so phones not on the
--    channel screen ring too.

create table if not exists public.radio_messages (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id),
  kind text not null check (kind in ('voice', 'text')),
  storage_path text,
  duration_ms integer check (duration_ms between 300 and 120000),
  body text check (char_length(body) <= 500),
  urgent boolean not null default false,
  sent_at timestamptz not null default now(),
  check ((kind = 'voice' and storage_path is not null and duration_ms is not null)
      or (kind = 'text' and coalesce(btrim(body), '') <> ''))
);
create index if not exists radio_messages_channel on public.radio_messages (exec_project_id, sent_at desc);

alter table public.radio_messages enable row level security;
drop policy if exists radio_messages_read on public.radio_messages;
create policy radio_messages_read on public.radio_messages for select to authenticated using (app.can_read_exec(exec_project_id));
-- writes only through radio_send (no direct insert / update / delete)
revoke insert, update, delete on public.radio_messages from authenticated, anon;
grant select on public.radio_messages to authenticated;

-- <project id>/<sender id>/<file> → the project / the sender
create or replace function app.radio_path_project(p_name text) returns uuid
language sql immutable as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end
$$;

create or replace function public.radio_send(
  p_exec uuid,
  p_kind text,
  p_path text default null,
  p_duration_ms integer default null,
  p_body text default null,
  p_urgent boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rid uuid; me uuid := auth.uid(); who text; proj text; crew uuid[];
begin
  perform app.require(me is not null and app.can_read_exec(p_exec), 'You are not on this project''s crew');
  perform app.require(p_kind in ('voice', 'text'), 'Unknown message type');
  if p_kind = 'voice' then
    perform app.require(p_path is not null and app.radio_path_project(p_path) = p_exec
      and split_part(p_path, '/', 2) = me::text, 'The voice clip is not in this channel');
    perform app.require(coalesce(p_duration_ms, 0) between 300 and 120000, 'Voice messages are 0.3 seconds to 2 minutes');
  else
    perform app.require(coalesce(btrim(p_body), '') <> '', 'Type a message');
    perform app.require(char_length(btrim(p_body)) <= 500, 'Messages are up to 500 characters');
  end if;

  insert into public.radio_messages (exec_project_id, sender_id, kind, storage_path, duration_ms, body, urgent)
  values (p_exec, me, p_kind,
          case when p_kind = 'voice' then p_path end,
          case when p_kind = 'voice' then p_duration_ms end,
          nullif(btrim(coalesce(p_body, '')), ''),
          coalesce(p_urgent, false))
  returning id into rid;

  if coalesce(p_urgent, false) then
    select full_name into who from public.profiles where id = me;
    select coalesce(code || ' – ', '') || name into proj from public.exec_projects where id = p_exec;
    select coalesce(array_agg(distinct m.user_id), '{}') into crew
      from public.exec_members m
     where m.exec_project_id = p_exec and m.active and m.user_id <> me
       and m.valid_from <= (now() at time zone app.tz())::date and (m.valid_to is null or m.valid_to >= (now() at time zone app.tz())::date);
    crew := crew || array(select x from unnest(app.role_users('senior_elec_engineer')) x where x <> me);
    perform app.notify_many(crew, 'radio_emergency',
      format('EMERGENCY call – %s', coalesce(proj, 'site')),
      format('%s: %s', coalesce(who, 'Crew'), case when p_kind = 'voice' then 'voice message – open the site radio' else btrim(p_body) end),
      'critical', 'exec_project', p_exec, format('/execution/%s?tab=radio', p_exec), 'radio:' || rid::text);
  end if;
  return rid;
end $$;
revoke execute on function public.radio_send(uuid, text, text, integer, text, boolean) from public, anon;
grant execute on function public.radio_send(uuid, text, text, integer, text, boolean) to authenticated;

-- Private bucket for the voice clips (5 MB each, audio only)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('radio', 'radio', false, 5242880, array['audio/*'])
    on conflict (id) do nothing;
    execute 'drop policy if exists radio_read on storage.objects';
    execute 'drop policy if exists radio_insert on storage.objects';
    execute $p$create policy radio_read on storage.objects for select to authenticated using (
      bucket_id = 'radio' and app.can_read_exec(app.radio_path_project(name)))$p$;
    execute $p$create policy radio_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'radio' and split_part(name, '/', 2) = auth.uid()::text and app.can_read_exec(app.radio_path_project(name)))$p$;
  end if;
end $$;

-- New messages arrive live
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'radio_messages') then
    alter publication supabase_realtime add table public.radio_messages;
  end if;
end $$;
