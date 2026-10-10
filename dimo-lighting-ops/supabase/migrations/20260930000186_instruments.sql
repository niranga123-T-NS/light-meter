-- Testing / site instruments: the register kept by the Operations Executive, requests from any member (not subcontractors)
-- for a project with the location of use, a queue per instrument, issue to an owner with a return date, return, extension.
--  * Operations adds / edits / removes instruments, sets them out of order, records the calibration (expiry, certificate) and
--    uploads the calibration / test report for the members to download.
--  * An instrument that is not calibrated (or whose calibration expired) can be used, but the requester and Operations are alerted.
--  * When an instrument comes back, the next person in the queue and Operations are alerted; when Operations has it ready to
--    release, the requester is alerted. Overdue returns: the holder and Operations, daily.
--  * An extension is asked in the app; when Operations accepts it, the later requests in the queue move by the same days.

create table public.instruments (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  category text,
  make text,
  model text,
  serial_no text,
  asset_no text,
  range_spec text,
  home text,                                         -- where it is kept
  notes text,
  condition text not null default 'ok' check (condition in ('ok', 'out_of_order')),
  fault_note text,
  cal_status text not null default 'not_calibrated' check (cal_status in ('calibrated', 'not_calibrated')),
  cal_date date,
  cal_expiry date,
  cal_cert_no text,
  cal_lab text,
  removed boolean not null default false,
  removed_reason text,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.instrument_requests (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  instrument_id uuid not null references public.instruments (id) on delete cascade,
  requested_by uuid not null default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  exec_project_id uuid references public.exec_projects (id) on delete set null,
  project_text text,
  purpose text,
  need_from date not null,
  need_to date not null,
  site_lat double precision,
  site_lng double precision,
  site_address text,
  uncalibrated boolean not null default false,
  status text not null default 'waiting' check (status in ('waiting', 'ready', 'issued', 'returned', 'cancelled')),
  ready_at timestamptz,
  owner_id uuid references public.profiles (id),
  issued_at timestamptz,
  issued_by uuid references public.profiles (id),
  due_back date,
  returned_at timestamptz,
  returned_to uuid references public.profiles (id),
  return_condition text,
  return_note text,
  ext_to date,
  ext_reason text,
  ext_status text check (ext_status in ('pending', 'approved', 'rejected')),
  ext_by uuid references public.profiles (id),
  ext_at timestamptz,
  ext_note text,
  cancel_note text
);
create index on public.instrument_requests (instrument_id, status, need_from);
create unique index instrument_one_issue on public.instrument_requests (instrument_id) where status = 'issued';

alter table public.instruments enable row level security;
alter table public.instrument_requests enable row level security;
create policy instruments_read on public.instruments for select to authenticated using (not app.is_sub());
create policy instrument_requests_read on public.instrument_requests for select to authenticated using (not app.is_sub());
grant select on public.instruments, public.instrument_requests to authenticated;

create or replace function app.instrument_head(i public.instruments) returns text
language sql stable as $$ select concat_ws(' · ', i.code, i.name, nullif(concat_ws(' ', i.make, i.model), ''), 'S/N ' || i.serial_no) $$;
create or replace function app.instrument_calibrated(i public.instruments) returns boolean
language sql stable as $$ select i.cal_status = 'calibrated' and i.cal_expiry is not null and i.cal_expiry >= (now() at time zone app.tz())::date $$;
create or replace function app.instrument_url(p uuid) returns text language sql immutable as $$ select '/instruments/' || p $$;

-- Operations: add / edit
create or replace function public.save_instrument(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare iid uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive keeps the instrument list');
  perform app.require(coalesce(btrim(p ->> 'name'), '') <> '', 'Enter the instrument name');
  if iid is null then
    insert into public.instruments (code, name, category, make, model, serial_no, asset_no, range_spec, home, notes)
    values (app.next_code('INS'), btrim(p ->> 'name'), nullif(btrim(p ->> 'category'), ''), nullif(btrim(p ->> 'make'), ''), nullif(btrim(p ->> 'model'), ''),
            nullif(btrim(p ->> 'serial_no'), ''), nullif(btrim(p ->> 'asset_no'), ''), nullif(btrim(p ->> 'range_spec'), ''), nullif(btrim(p ->> 'home'), ''),
            nullif(btrim(p ->> 'notes'), ''))
    returning id into iid;
  else
    update public.instruments set name = btrim(p ->> 'name'), category = nullif(btrim(p ->> 'category'), ''), make = nullif(btrim(p ->> 'make'), ''),
      model = nullif(btrim(p ->> 'model'), ''), serial_no = nullif(btrim(p ->> 'serial_no'), ''), asset_no = nullif(btrim(p ->> 'asset_no'), ''),
      range_spec = nullif(btrim(p ->> 'range_spec'), ''), home = nullif(btrim(p ->> 'home'), ''), notes = nullif(btrim(p ->> 'notes'), ''), updated_at = now()
    where id = iid and not removed;
    perform app.require(found, 'Instrument not found');
  end if;
  return iid;
end $$;

-- Operations: remove (not while someone has it); the waiting requests are cancelled and told
create or replace function public.remove_instrument(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.instruments; r record;
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive keeps the instrument list');
  select * into i from public.instruments where id = p_id and not removed for update;
  perform app.require(i.id is not null, 'Instrument not found');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  perform app.require(not exists (select 1 from public.instrument_requests where instrument_id = i.id and status = 'issued'), 'It is out with someone – record the return first');
  update public.instruments set removed = true, removed_reason = btrim(p_reason), updated_at = now() where id = i.id;
  for r in update public.instrument_requests set status = 'cancelled', cancel_note = 'Instrument removed – ' || btrim(p_reason)
           where instrument_id = i.id and status in ('waiting', 'ready') returning * loop
    perform app.notify(r.requested_by, 'instrument', 'Instrument request cancelled', app.instrument_head(i) || ' · removed from the list – ' || btrim(p_reason),
      'normal', 'instrument', i.id, '/instruments');
  end loop;
end $$;

-- Operations: out of order / back in service
create or replace function public.set_instrument_condition(p_id uuid, p_condition text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.instruments; r record;
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive sets the condition');
  perform app.require(p_condition in ('ok', 'out_of_order'), 'Choose the condition');
  perform app.require(p_condition = 'ok' or coalesce(btrim(p_note), '') <> '', 'Say what is wrong');
  update public.instruments set condition = p_condition, fault_note = case when p_condition = 'out_of_order' then btrim(p_note) end, updated_at = now()
  where id = p_id and not removed returning * into i;
  perform app.require(i.id is not null, 'Instrument not found');
  for r in select distinct requested_by from public.instrument_requests where instrument_id = i.id and status in ('waiting', 'ready') loop
    perform app.notify(r.requested_by, 'instrument', case when p_condition = 'ok' then 'Instrument back in service' else 'Instrument out of order' end,
      concat_ws(' · ', app.instrument_head(i), nullif(btrim(p_note), '')), 'normal', 'instrument', i.id, app.instrument_url(i.id));
  end loop;
end $$;

-- Operations: calibration (status, date, expiry, certificate); the report is uploaded as an attachment (kind cal_report)
create or replace function public.set_instrument_calibration(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare st text := coalesce(p ->> 'status', 'calibrated'); ex date := nullif(p ->> 'expiry', '')::date;
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive records the calibration');
  perform app.require(st in ('calibrated', 'not_calibrated'), 'Choose the calibration status');
  perform app.require(st = 'not_calibrated' or ex is not null, 'Enter the calibration expiry date');
  update public.instruments set cal_status = st, cal_date = case when st = 'calibrated' then nullif(p ->> 'date', '')::date end,
    cal_expiry = case when st = 'calibrated' then ex end, cal_cert_no = case when st = 'calibrated' then nullif(btrim(p ->> 'cert_no'), '') end,
    cal_lab = case when st = 'calibrated' then nullif(btrim(p ->> 'lab'), '') end, updated_at = now()
  where id = p_id and not removed;
  perform app.require(found, 'Instrument not found');
end $$;

-- Any member (not subcontractors): request for a project (or a project not listed) and the location of use
-- p: {exec_project_id | project_text, purpose, need_from, need_to, lat, lng, address, accept_uncalibrated}
create or replace function public.request_instrument(p_instrument uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.instruments; rid uuid; f date := nullif(p ->> 'need_from', '')::date; t date := nullif(p ->> 'need_to', '')::date;
        today date := (now() at time zone app.tz())::date; unc boolean; busy boolean; ops uuid[] := app.role_users('operations_exec');
begin
  perform app.require(app.my_role() is not null and not app.is_sub(), 'Instruments are requested by DIMO staff');
  select * into i from public.instruments where id = p_instrument and not removed;
  perform app.require(i.id is not null, 'Instrument not found');
  perform app.require(i.condition = 'ok', 'This instrument is out of order');
  perform app.require(nullif(p ->> 'exec_project_id', '') is not null or coalesce(btrim(p ->> 'project_text'), '') <> '', 'Choose the project, or enter it if it is not listed');
  perform app.require(f is not null and t is not null and f >= today and t >= f, 'Enter the dates you need it from and to');
  perform app.require(nullif(p ->> 'lat', '') is not null and nullif(p ->> 'lng', '') is not null, 'Pin the location where it will be used');
  unc := not app.instrument_calibrated(i);
  perform app.require(not unc or coalesce((p ->> 'accept_uncalibrated')::boolean, false), 'This instrument is not calibrated – confirm that you will use it uncalibrated');
  perform app.require(not exists (select 1 from public.instrument_requests where instrument_id = i.id and requested_by = auth.uid() and status in ('waiting', 'ready', 'issued')),
    'You already have a request for this instrument');
  insert into public.instrument_requests (code, instrument_id, exec_project_id, project_text, purpose, need_from, need_to, site_lat, site_lng, site_address, uncalibrated)
  values (app.next_code('INR'), i.id, nullif(p ->> 'exec_project_id', '')::uuid, nullif(btrim(p ->> 'project_text'), ''), nullif(btrim(p ->> 'purpose'), ''), f, t,
          (p ->> 'lat')::double precision, (p ->> 'lng')::double precision, nullif(btrim(p ->> 'address'), ''), unc)
  returning id into rid;
  busy := exists (select 1 from public.instrument_requests where instrument_id = i.id and id <> rid and status in ('issued', 'ready', 'waiting'));
  perform app.notify_many(ops, 'instrument', case when busy then 'Instrument requested – in use / queued' else 'Instrument requested' end,
    format('%s · %s · %s to %s%s', app.instrument_head(i), app.display_name(auth.uid()), to_char(f, 'DD Mon'), to_char(t, 'DD Mon'),
           case when unc then ' · NOT CALIBRATED' else '' end), case when unc then 'critical' else 'normal' end::public.priority, 'instrument', i.id, app.instrument_url(i.id), null, true);
  if unc then
    perform app.notify(auth.uid(), 'instrument', 'You requested an uncalibrated instrument',
      app.instrument_head(i) || case when i.cal_expiry is not null then ' · calibration expired ' || to_char(i.cal_expiry, 'DD Mon YYYY') else ' · not calibrated' end ||
      ' – readings may not be accepted', 'critical', 'instrument', i.id, app.instrument_url(i.id));
  end if;
  return rid;
end $$;

create or replace function public.cancel_instrument_request(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.instrument_requests;
begin
  select * into r from public.instrument_requests where id = p_id for update;
  perform app.require(r.id is not null and r.status in ('waiting', 'ready'), 'This request cannot be cancelled');
  perform app.require(r.requested_by = auth.uid() or app.has_role('operations_exec'), 'Only the requester or Operations cancels');
  perform app.require(r.requested_by = auth.uid() or coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  update public.instrument_requests set status = 'cancelled', cancel_note = nullif(btrim(p_reason), '') where id = r.id;
  if r.requested_by <> auth.uid() then
    perform app.notify(r.requested_by, 'instrument', 'Instrument request cancelled by Operations', concat_ws(' · ', r.code, btrim(p_reason)), 'normal', 'instrument', r.instrument_id,
      app.instrument_url(r.instrument_id));
  end if;
end $$;

-- Operations: ready to release → the requester is told
create or replace function public.ready_instrument(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.instrument_requests; i public.instruments;
begin
  perform app.require(app.has_role('operations_exec'), 'Operations releases instruments');
  select * into r from public.instrument_requests where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'waiting', 'Not waiting');
  select * into i from public.instruments where id = r.instrument_id;
  perform app.require(i.condition = 'ok' and not i.removed, 'The instrument is out of order');
  perform app.require(not exists (select 1 from public.instrument_requests where instrument_id = i.id and status = 'issued'), 'The instrument is still out – record its return first');
  update public.instrument_requests set status = 'ready', ready_at = now() where id = r.id;
  perform app.notify(r.requested_by, 'instrument', 'Instrument ready to collect', concat_ws(' · ', app.instrument_head(i), 'from Operations', nullif(btrim(p_note), '')),
    'normal', 'instrument', i.id, app.instrument_url(i.id), 'insready:' || r.id, true);
end $$;

-- Operations: issue, assigning the owner (who is responsible) and the return date
create or replace function public.issue_instrument(p_id uuid, p_owner uuid, p_due date) returns void
language plpgsql security definer set search_path = public as $$
declare r public.instrument_requests; i public.instruments;
begin
  perform app.require(app.has_role('operations_exec'), 'Operations issues instruments');
  select * into r from public.instrument_requests where id = p_id for update;
  perform app.require(r.id is not null and r.status in ('waiting', 'ready'), 'Not waiting to be issued');
  select * into i from public.instruments where id = r.instrument_id for update;
  perform app.require(i.condition = 'ok' and not i.removed, 'The instrument is out of order');
  perform app.require(not exists (select 1 from public.instrument_requests where instrument_id = i.id and status = 'issued'), 'The instrument is still out – record its return first');
  perform app.require(p_owner is not null and exists (select 1 from public.profiles where id = p_owner and active), 'Choose the owner');
  perform app.require(p_due is not null and p_due >= (now() at time zone app.tz())::date, 'Set the return date');
  update public.instrument_requests set status = 'issued', owner_id = p_owner, issued_at = now(), issued_by = auth.uid(), due_back = p_due, ready_at = coalesce(ready_at, now())
  where id = r.id;
  perform app.notify_many(array_remove(array[p_owner, r.requested_by], null), 'instrument', 'Instrument issued to you',
    format('%s · return by %s%s', app.instrument_head(i), to_char(p_due, 'DD Mon YYYY'), case when not app.instrument_calibrated(i) then ' · NOT CALIBRATED' else '' end),
    'normal', 'instrument', i.id, app.instrument_url(i.id));
end $$;

-- Operations: received back; the next in the queue and Operations are told
create or replace function public.return_instrument(p_id uuid, p_condition text default 'ok', p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.instrument_requests; i public.instruments; nx public.instrument_requests;
begin
  perform app.require(app.has_role('operations_exec'), 'Operations receives instruments');
  select * into r from public.instrument_requests where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'issued', 'Not out');
  perform app.require(coalesce(p_condition, 'ok') in ('ok', 'out_of_order'), 'Choose the condition');
  perform app.require(coalesce(p_condition, 'ok') = 'ok' or coalesce(btrim(p_note), '') <> '', 'Say what is wrong');
  update public.instrument_requests set status = 'returned', returned_at = now(), returned_to = auth.uid(), return_condition = coalesce(p_condition, 'ok'),
    return_note = nullif(btrim(p_note), ''), ext_status = case when ext_status = 'pending' then 'rejected' else ext_status end where id = r.id;
  if p_condition = 'out_of_order' then
    update public.instruments set condition = 'out_of_order', fault_note = btrim(p_note), updated_at = now() where id = r.instrument_id;
  end if;
  select * into i from public.instruments where id = r.instrument_id;
  select * into nx from public.instrument_requests where instrument_id = i.id and status = 'waiting' order by need_from, requested_at limit 1;
  if nx.id is not null then
    perform app.notify(nx.requested_by, 'instrument', 'Instrument you requested is back',
      app.instrument_head(i) || case when i.condition = 'ok' then ' · Operations prepares it for you' else ' · but it is out of order – ' || coalesce(i.fault_note, '') end,
      'normal', 'instrument', i.id, app.instrument_url(i.id));
    perform app.notify_many(app.role_users('operations_exec'), 'instrument', 'Instrument back – next request waiting',
      format('%s · next: %s (%s, from %s)', app.instrument_head(i), app.display_name(nx.requested_by), nx.code, to_char(nx.need_from, 'DD Mon')),
      'normal', 'instrument', i.id, app.instrument_url(i.id), null, true);
  end if;
  return nx.id;
end $$;

-- The holder asks to keep it longer; Operations decides, and the later requests move by the same days
create or replace function public.request_instrument_extension(p_id uuid, p_to date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.instrument_requests; i public.instruments; nxt public.instrument_requests;
begin
  select * into r from public.instrument_requests where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'issued', 'Not out with you');
  perform app.require(auth.uid() in (r.owner_id, r.requested_by), 'Only the holder asks for an extension');
  perform app.require(coalesce(r.ext_status, '') <> 'pending', 'An extension is already waiting for Operations');
  perform app.require(p_to is not null and p_to > r.due_back, 'Choose a date after the return date');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  update public.instrument_requests set ext_to = p_to, ext_reason = btrim(p_reason), ext_status = 'pending', ext_by = null, ext_at = null, ext_note = null where id = r.id;
  select * into i from public.instruments where id = r.instrument_id;
  select * into nxt from public.instrument_requests where instrument_id = i.id and status in ('waiting', 'ready') order by need_from, requested_at limit 1;
  perform app.notify_many(app.role_users('operations_exec'), 'instrument', 'Instrument extension requested',
    format('%s · %s · %s → %s · %s%s', app.instrument_head(i), app.display_name(auth.uid()), to_char(r.due_back, 'DD Mon'), to_char(p_to, 'DD Mon'), btrim(p_reason),
           case when nxt.id is not null then ' · next request: ' || app.display_name(nxt.requested_by) || ' from ' || to_char(nxt.need_from, 'DD Mon') else '' end),
    'normal', 'instrument', i.id, app.instrument_url(i.id), null, true);
end $$;

create or replace function public.decide_instrument_extension(p_id uuid, p_ok boolean, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare r public.instrument_requests; i public.instruments; d int; x record; n int := 0;
begin
  perform app.require(app.has_role('operations_exec'), 'Operations decides extensions');
  select * into r from public.instrument_requests where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'issued' and r.ext_status = 'pending', 'No extension waiting');
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  select * into i from public.instruments where id = r.instrument_id;
  update public.instrument_requests set ext_status = case when p_ok then 'approved' else 'rejected' end, ext_by = auth.uid(), ext_at = now(), ext_note = nullif(btrim(p_note), ''),
    due_back = case when p_ok then ext_to else due_back end where id = r.id;
  perform app.notify_many(array_remove(array[r.owner_id, r.requested_by], null), 'instrument', case when p_ok then 'Extension accepted' else 'Extension not accepted' end,
    format('%s · return by %s%s', app.instrument_head(i), to_char(case when p_ok then r.ext_to else r.due_back end, 'DD Mon YYYY'), coalesce(' · ' || nullif(btrim(p_note), ''), '')),
    'normal', 'instrument', i.id, app.instrument_url(i.id));
  if p_ok then
    d := r.ext_to - r.due_back;
    -- the requests waiting behind move by the same days when they start before the new return date
    for x in update public.instrument_requests set need_from = need_from + d, need_to = need_to + d
             where instrument_id = i.id and status in ('waiting', 'ready') and need_from <= r.ext_to returning * loop
      n := n + 1;
      perform app.notify(x.requested_by, 'instrument', 'Your instrument dates moved',
        format('%s · now %s to %s (the current holder keeps it until %s)', app.instrument_head(i), to_char(x.need_from, 'DD Mon'), to_char(x.need_to, 'DD Mon'), to_char(r.ext_to, 'DD Mon')),
        'normal', 'instrument', i.id, app.instrument_url(i.id));
    end loop;
  end if;
  return n;
end $$;

-- Daily: overdue returns (holder + Operations), calibration expiring within 30 days (Operations)
create or replace function public.instruments_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; r record; n int := 0; ops uuid[] := app.role_users('operations_exec');
begin
  for r in select q.*, i.name, i.code icode from public.instrument_requests q join public.instruments i on i.id = q.instrument_id
           where q.status = 'issued' and q.due_back < today loop
    perform app.notify_many(array_remove(array[r.owner_id] || ops, null), 'instrument', 'Instrument overdue',
      format('%s %s · with %s · due %s, %s day(s) overdue', r.icode, r.name, app.display_name(r.owner_id), to_char(r.due_back, 'DD Mon'), today - r.due_back),
      'critical', 'instrument', r.instrument_id, app.instrument_url(r.instrument_id), 'insdue:' || r.id || ':' || today);
    n := n + 1;
  end loop;
  for r in select * from public.instruments where not removed and cal_status = 'calibrated' and cal_expiry between today and today + 30 loop
    perform app.notify_many(ops, 'instrument', 'Calibration expiring',
      format('%s %s · calibration expires %s', r.code, r.name, to_char(r.cal_expiry, 'DD Mon YYYY')), 'normal', 'instrument', r.id, app.instrument_url(r.id),
      'inscal:' || r.id || ':' || r.cal_expiry);
  end loop;
  return n;
end $$;
revoke execute on function public.instruments_tick(timestamptz) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('instruments-tick', '15 2 * * *', 'select public.instruments_tick()');
  end if;
end $$;


create or replace function app.can_read_attachment(a public.attachments) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); inq uuid; st text; mode int; released timestamptz;
begin
  if r is null then return false; end if;
  if a.uploaded_by = auth.uid() then return true; end if;
  case a.entity_type
  when 'instrument' then
    return not app.is_sub();
  when 'visit' then
    return r in ('gm', 'sm_projects') or exists (select 1 from public.visits where id = a.entity_id and sales_person_id = auth.uid());
  when 'tender' then
    return r in ('gm', 'sm_projects', 'sm_estimation') or exists (select 1 from public.tenders where id = a.entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return app.can_read_inquiry(a.entity_id);
  when 'design_job' then
    select inquiry_id into inq from public.design_jobs where id = a.entity_id;
    if r in ('gm', 'design_manager') or app.can_read_design_job(a.entity_id) and r in ('lighting_designer', 'lighting_engineer') then return true; end if;
    -- Released design pack: Estimation (on release) and Sales (Route C / mode 3 release / early release)
    if a.kind = 'design_pack' then
      if r in ('sm_estimation', 'am_estimation', 'estimation_exec') then return app.can_read_inquiry(inq); end if;
      select status, release_mode, design_released_to_sales_at into st, mode, released from public.inquiries where id = inq;
      if r in ('sm_projects') or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)) then
        return released is not null;
      end if;
    end if;
    return false;
  when 'estimation_job' then
    select inquiry_id into inq from public.estimation_jobs where id = a.entity_id;
    if a.kind = 'costing_sheet' then return app.can_read_costing(a.entity_id); end if;
    if r in ('gm', 'sm_estimation') or app.can_read_estimation_job(a.entity_id) then return true; end if;
    if r = 'sm_projects' and a.kind in ('quotation_draft', 'quotation_final', 'compliance_sheet', 'technical_data')
       and exists (select 1 from public.estimation_jobs where id = a.entity_id and needs_sm_projects) then
      return true;
    end if;
    -- Sales download only the released quotation and supporting sheets – never the costing sheet
    if a.kind in ('quotation_final', 'compliance_sheet', 'technical_data') then
      return exists (select 1 from public.estimation_jobs where id = a.entity_id and status = 'released')
             and (r = 'sm_projects' or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)));
    end if;
    return false;
  when 'clarification' then
    select inquiry_id into inq from public.clarifications where id = a.entity_id;
    return r in ('gm', 'design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec')
           and app.can_read_inquiry(inq);
  when 'sample' then
    return r in ('gm', 'sm_projects', 'operations_exec') or exists (select 1 from public.samples where id = a.entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then
    return r in ('gm', 'sm_projects', 'operations_exec');
  when 'retention' then
    return exists (select 1 from public.retentions where id = a.entity_id);
  when 'bond' then
    return exists (select 1 from public.bonds where id = a.entity_id);
  when 'warranty' then
    return app.can_read_warranty(a.entity_id);
  when 'warranty_claim' then
    return exists (select 1 from public.warranty_claims where id = a.entity_id);
  when 'warranty_report' then
    return exists (select 1 from public.warranty_reports where id = a.entity_id);
  when 'rma' then
    return exists (select 1 from public.manufacturer_claims where id = a.entity_id);
  when 'warranty_registration' then
    return exists (select 1 from public.warranty_registrations where id = a.entity_id);
  when 'eng_job' then
    return app.can_read_eng_job(a.entity_id);
  when 'eng_job_update' then
    return exists (select 1 from public.eng_job_updates u where u.id = a.entity_id and app.can_read_eng_job(u.job_id));
  when 'exec_report' then
    return exists (select 1 from public.exec_reports x where x.id = a.entity_id and (x.author_id = auth.uid() or app.is_exec_internal(x.exec_project_id)));
  when 'exec_worker' then
    return exists (select 1 from public.exec_workers x where x.id = a.entity_id and app.can_see_worker(x));
  when 'hse_record' then
    return exists (select 1 from public.hse_records x where x.id = a.entity_id and app.can_read_exec(x.exec_project_id));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = a.entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
      or exists (select 1 from public.hse_actions y where y.report_id = x.id and y.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = a.entity_id and (app.is_exec_internal(x.exec_project_id) or r = 'gm'));
  when 'material_request' then
    return app.can_read_mr(a.entity_id);
  when 'exec_doc' then
    return exists (select 1 from public.exec_docs x where x.id = a.entity_id and (r in ('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec', 'design_manager', 'lighting_designer', 'lighting_engineer')
      or (app.is_exec_member(x.exec_project_id) and x.status = 'for_construction' and (x.issued_to_subs or r <> 'sub_supervisor'))));
  when 'design_query' then
    return exists (select 1 from public.design_queries x where x.id = a.entity_id
      and (app.is_exec_internal(x.exec_project_id) or r in ('design_manager', 'lighting_designer', 'lighting_engineer')));
  when 'snag' then
    return exists (select 1 from public.snags x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
  when 'dossier_item' then
    return exists (select 1 from public.exec_dossier x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
  when 'test_record' then
    return exists (select 1 from public.test_records x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
  when 'instrument' then
    return r <> 'sub_supervisor';
  when 'sub_invoice' then
    return app.can_read_sub_invoice(a.entity_id);
  when 'sub_cert_var' then
    return exists (select 1 from public.sub_cert_variations x where x.id = a.entity_id and app.can_read_sub_cert(x.sub_cert_id));
  when 'sub_invoice_var' then
    return exists (select 1 from public.sub_invoice_variations x where x.id = a.entity_id and app.can_read_sub_invoice(x.invoice_id));
  when 'exec_project' then
    return a.kind in ('tpl_measurement', 'tpl_ipa', 'tpl_ipc') and app.can_read_exec(a.entity_id);
  when 'sub_cert' then
    return app.can_read_sub_cert(a.entity_id);
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = a.entity_id
      and (r in ('sm_projects', 'gm', 'operations_exec', 'senior_elec_engineer') or x.requested_by = auth.uid() or (x.exec_project_id is not null and app.is_exec_internal(x.exec_project_id))));
  else
    return r = 'gm';
  end case;
end $$;

create or replace function app.can_write_attachment(p_entity_type text, p_entity_id uuid, p_kind text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role();
begin
  case p_entity_type
  when 'instrument' then return r = 'operations_exec' and exists (select 1 from public.instruments where id = p_entity_id);
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
  when 'exec_project' then
    return (p_kind is null or p_kind in ('tpl_measurement', 'tpl_ipa', 'tpl_ipc')) and app.has_role('senior_elec_engineer')
      and exists (select 1 from public.exec_projects where id = p_entity_id);
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
