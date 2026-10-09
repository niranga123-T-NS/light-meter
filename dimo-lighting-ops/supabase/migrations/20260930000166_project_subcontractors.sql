-- Subcontractors of a project: a register (several per project) kept by the SEE / project AEs; everywhere a subcontractor
-- is named (activities, joint measurements / IPC, supervisor nomination, workers) it is chosen from this register.
-- A subcontractor supervisor's requests are for their own company.

create table if not exists public.exec_subcontractors (
  id uuid primary key default gen_random_uuid(),
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  name text not null,
  trade text,
  contact_name text,
  phone text,
  email text,
  active boolean not null default true,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create unique index if not exists exec_subcontractors_name on public.exec_subcontractors (exec_project_id, lower(name));
alter table public.exec_subcontractors enable row level security;
drop policy if exists exec_subcontractors_read on public.exec_subcontractors;
create policy exec_subcontractors_read on public.exec_subcontractors for select to authenticated using (app.can_read_exec(exec_project_id));
grant select on public.exec_subcontractors to authenticated;

-- Existing names become the first register entries
insert into public.exec_subcontractors (exec_project_id, name, created_by)
select distinct on (x.exec_project_id, lower(x.name)) x.exec_project_id, x.name, null::uuid from (
  select m.exec_project_id, btrim(p.company) as name from public.exec_members m join public.profiles p on p.id = m.user_id
   where m.member_role = 'sub_supervisor' and coalesce(btrim(p.company), '') <> ''
  union all select exec_project_id, btrim(subcontractor) from public.exec_activities where coalesce(btrim(subcontractor), '') <> ''
  union all select exec_project_id, btrim(subcontractor) from public.sub_certs where coalesce(btrim(subcontractor), '') <> ''
  union all select exec_project_id, btrim(company) from public.exec_workers where coalesce(btrim(company), '') not in ('', 'DIMO')
  union all select unnest(r.project_ids), btrim(r.company) from public.access_requests r where r.kind = 'sub_appoint' and coalesce(btrim(r.company), '') <> ''
) x
where exists (select 1 from public.exec_projects e where e.id = x.exec_project_id)
on conflict do nothing;

-- The register name for a typed / chosen name (null when empty); refuses names not on the project's register
create or replace function app.sub_name(p_exec uuid, p_name text) returns text
language plpgsql stable security definer set search_path = public as $$
declare n text;
begin
  if coalesce(btrim(p_name), '') = '' then return null; end if;
  select name into n from public.exec_subcontractors where exec_project_id = p_exec and lower(name) = lower(btrim(p_name)) and active;
  perform app.require(n is not null, format('"%s" is not a subcontractor of this project – choose one from the list (Team → Subcontractors)', btrim(p_name)));
  return n;
end $$;

-- Add / edit / deactivate a project subcontractor
create or replace function public.save_exec_subcontractor(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid := nullif(p ->> 'id', '')::uuid; nm text := btrim(coalesce(p ->> 'name', ''));
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects') or app.is_project_ae(p_exec), 'The SEE or the project''s Assistant Engineers keep the subcontractor list');
  perform app.require(nm <> '', 'Enter the subcontractor name');
  perform app.require(not exists (select 1 from public.exec_subcontractors where exec_project_id = p_exec and lower(name) = lower(nm) and id is distinct from sid),
    'This subcontractor is already on the project');
  if sid is null then
    insert into public.exec_subcontractors (exec_project_id, name, trade, contact_name, phone, email)
    values (p_exec, nm, nullif(btrim(p ->> 'trade'), ''), nullif(btrim(p ->> 'contact_name'), ''), nullif(btrim(p ->> 'phone'), ''), nullif(lower(btrim(p ->> 'email')), ''))
    returning id into sid;
  else
    update public.exec_subcontractors set name = nm, trade = nullif(btrim(p ->> 'trade'), ''), contact_name = nullif(btrim(p ->> 'contact_name'), ''),
      phone = nullif(btrim(p ->> 'phone'), ''), email = nullif(lower(btrim(p ->> 'email')), ''), active = coalesce((p ->> 'active')::boolean, active)
    where id = sid and exec_project_id = p_exec;
    perform app.require(found, 'Not found');
  end if;
  return sid;
end $$;

create or replace function public.prepare_sub_cert(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; c public.sub_certs; v public.variations; sname text; own text;
begin
  perform app.require(app.can_record_sub_invoice(p_exec), 'The project''s subcontractor supervisor or Assistant Engineer requests the joint measurement');
  perform app.require(coalesce(btrim(p ->> 'subcontractor'), '') <> '' and coalesce(btrim(p ->> 'period'), '') <> '', 'Enter the subcontractor and the period');
  perform app.require(nullif(p ->> 'jm_date', '') is not null, 'Enter the proposed date for the joint measurement');
  sname := app.sub_name(p_exec, p ->> 'subcontractor');
  if app.has_role('sub_supervisor') then
    own := (select company from public.profiles where id = auth.uid());
    perform app.require(own is null or lower(btrim(own)) = lower(sname), 'A subcontractor supervisor requests measurements for their own company (' || coalesce(own, '') || ')');
  end if;
  if nullif(p ->> 'variation_id', '') is not null then
    select * into v from public.variations where id = (p ->> 'variation_id')::uuid;
    perform app.require(v.id is not null and v.exec_project_id = p_exec and v.status in ('approved', 'client_accepted'), 'Only approved variations of this project');
  end if;
  insert into public.sub_certs (code, exec_project_id, subcontractor, period, gross, previous, retention_pct, deductions, note, status, jm_requested_date, jm_scope, variation_id, var_code, var_title)
  values (app.next_code('SPC'), p_exec, sname, btrim(p ->> 'period'), coalesce(nullif(replace(p ->> 'gross', ',', ''), '')::numeric, 0),
          coalesce(nullif(replace(p ->> 'previous', ',', ''), '')::numeric, 0), coalesce(nullif(p ->> 'retention_pct', '')::numeric, 0),
          coalesce(nullif(replace(p ->> 'deductions', ',', ''), '')::numeric, 0), nullif(btrim(p ->> 'note'), ''), 'jm_requested',
          (p ->> 'jm_date')::date, nullif(btrim(p ->> 'jm_scope'), ''), v.id, coalesce(nullif(v.vo_no, ''), v.code), v.title)
  returning * into c;
  perform app.notify_many(array(select unnest(app.project_aes(p_exec)) union select unnest(app.role_users('senior_elec_engineer'))), 'exec_cost',
    'Joint measurement requested', format('%s · %s · %s · %s · proposed %s%s · %s', c.code, coalesce('Variation ' || c.var_code, 'BOQ work'), c.subcontractor, c.period, to_char(c.jm_requested_date, 'DD Mon YYYY'),
      coalesce(' · ' || c.jm_scope, ''), app.exec_head(p_exec)), 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  return c.id;
end $$;

create or replace function public.update_sub_cert(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(c.status in ('draft', 'returned'), 'Only a draft or returned certificate can be changed');
  perform app.require(c.prepared_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Only who prepared it changes it');
  update public.sub_certs set
    subcontractor = coalesce(app.sub_name(c.exec_project_id, p ->> 'subcontractor'), subcontractor),
    period = coalesce(nullif(btrim(p ->> 'period'), ''), period),
    gross = coalesce(nullif(replace(p ->> 'gross', ',', ''), '')::numeric, gross),
    previous = coalesce(nullif(replace(p ->> 'previous', ',', ''), '')::numeric, previous),
    retention_pct = coalesce(nullif(p ->> 'retention_pct', '')::numeric, retention_pct),
    deductions = coalesce(nullif(replace(p ->> 'deductions', ',', ''), '')::numeric, deductions),
    note = case when p ? 'note' then nullif(btrim(p ->> 'note'), '') else note end
  where id = c.id;
end $$;

create or replace function public.save_activity(p_exec uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare aid uuid; d int; nxt int;
begin
  perform app.programme_edit(p_exec);
  perform app.require(coalesce(btrim(p ->> 'name'), '') <> '', 'Enter the activity name');
  perform app.require(exists (select 1 from public.exec_wbs where id = nullif(p ->> 'wbs_id', '')::uuid and exec_project_id = p_exec), 'Choose the WBS element');
  begin d := (p ->> 'duration')::int; exception when others then d := null; end;
  perform app.require(d is not null and d >= 0, 'Enter the duration in working days (0 for a milestone)');
  nxt := coalesce((select max(sort) + 1 from public.exec_activities where exec_project_id = p_exec), 1);
  if p_id is null then
    insert into public.exec_activities (exec_project_id, wbs_id, code, name, duration, not_before, responsible_id, subcontractor, qty, unit, sort)
    values (p_exec, (p ->> 'wbs_id')::uuid, '', btrim(p ->> 'name'), d, nullif(p ->> 'not_before', '')::date, nullif(p ->> 'responsible_id', '')::uuid,
            app.sub_name(p_exec, p ->> 'subcontractor'), nullif(p ->> 'qty', '')::numeric, nullif(btrim(p ->> 'unit'), ''), nxt)
    returning id into aid;
  else
    update public.exec_activities set
      sort = case when wbs_id is distinct from (p ->> 'wbs_id')::uuid then nxt else sort end,
      wbs_id = (p ->> 'wbs_id')::uuid, name = btrim(p ->> 'name'), duration = d,
      not_before = nullif(p ->> 'not_before', '')::date, responsible_id = nullif(p ->> 'responsible_id', '')::uuid, subcontractor = app.sub_name(p_exec, p ->> 'subcontractor'),
      qty = nullif(p ->> 'qty', '')::numeric, unit = nullif(btrim(p ->> 'unit'), '')
    where id = p_id and exec_project_id = p_exec returning id into aid;
  end if;
  perform app.require(aid is not null, 'Activity not found');
  perform app.renumber_programme(p_exec);
  perform app.schedule(p_exec);
  return aid;
end $$;

create or replace function public.nominate_supervisor(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid; ph text := app.norm_phone(p ->> 'phone'); existing uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'Only the Senior Electrical Engineer nominates subcontractor supervisors');
  perform app.require(exists (select 1 from public.exec_projects where id = p_exec and status = 'active'), 'Execution project not found or closed');
  perform app.require(coalesce(btrim(p ->> 'person_name'), '') <> '' and coalesce(btrim(p ->> 'company'), '') <> '', 'Enter the name and the subcontractor company');
  perform app.require(length(ph) >= 9, 'Enter the mobile number – it is the supervisor''s login');
  perform app.require(coalesce(btrim(p ->> 'id_no'), '') <> '', 'Enter the ID or site pass number');
  perform app.require(nullif(p ->> 'start_date', '') is not null and nullif(p ->> 'end_date', '') is not null
    and (p ->> 'end_date')::date >= (p ->> 'start_date')::date, 'Enter the access validity dates');
  select id into existing from public.profiles where role = 'sub_supervisor' and app.norm_phone(phone) = ph limit 1;
  perform app.require(existing is null or not exists (select 1 from public.exec_members where exec_project_id = p_exec and user_id = existing and active),
    'This supervisor is already on the project');
  perform app.require(not exists (select 1 from public.access_requests where kind = 'sub_appoint' and phone = ph and p_exec = any (project_ids)
    and status in ('pending_smp', 'approved')), 'A nomination for this supervisor is already pending');
  insert into public.access_requests (code, kind, role_type, person_name, company, phone, email, id_no, user_id, project_ids, zones, start_date, end_date, reason)
  values (app.next_code('ACR'), 'sub_appoint', 'sub_supervisor', btrim(p ->> 'person_name'), app.sub_name(p_exec, p ->> 'company'), ph, nullif(lower(btrim(p ->> 'email')), ''),
          btrim(p ->> 'id_no'), existing, array[p_exec], nullif(btrim(p ->> 'zones'), ''), (p ->> 'start_date')::date, (p ->> 'end_date')::date,
          nullif(btrim(p ->> 'reason'), ''))
  returning id into rid;
  insert into public.access_log (request_id, exec_project_id, event, note) values (rid, p_exec, 'nominated', btrim(p ->> 'person_name') || ' · ' || btrim(p ->> 'company'));
  perform app.notify_many(app.role_users('sm_projects'), 'exec_access', 'Subcontractor supervisor nomination – approve',
    format('%s (%s) · %s · %s to %s', btrim(p ->> 'person_name'), btrim(p ->> 'company'), app.exec_head(p_exec), p ->> 'start_date', p ->> 'end_date'),
    'normal', 'access_request', rid, '/execution/access/' || rid, null, true);
  return rid;
end $$;

create or replace function public.save_worker(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  w public.exec_workers; wid uuid := nullif(p ->> 'id', '')::uuid; t text := coalesce(nullif(p ->> 'id_type', ''), 'nic');
  idn text := app.norm_id(p ->> 'id_no'); sup boolean := app.has_role('sub_supervisor'); co text; sv uuid; prev public.exec_workers;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec) or (sup and app.is_exec_member(p_exec)),
    'Only the subcontractor supervisor or an Assistant Engineer of the project adds workers');
  perform app.require(coalesce(btrim(p ->> 'full_name'), '') <> '', 'Enter the full name');
  perform app.require(coalesce(btrim(p ->> 'address'), '') <> '', 'Enter the address');
  perform app.require(coalesce(btrim(p ->> 'police_station'), '') <> '', 'Enter the nearest police station');
  perform app.require(t in ('nic', 'passport'), 'Choose NIC or passport');
  if t = 'nic' then
    perform app.require(idn ~ '^([0-9]{9}[VX]|[0-9]{12})$', 'Enter a valid NIC number (9 digits + V/X, or 12 digits)');
  else
    perform app.require(idn ~ '^[A-Z0-9]{6,12}$', 'Enter the passport number (6–12 letters and digits)');
  end if;
  if sup then
    co := coalesce((select company from public.profiles where id = auth.uid()), btrim(p ->> 'company'));
    sv := auth.uid();
  else
    co := btrim(p ->> 'company');
    sv := nullif(p ->> 'supervisor_id', '')::uuid;
    perform app.require(sv is null or exists (select 1 from public.exec_members m where m.exec_project_id = p_exec and m.user_id = sv and m.active and m.member_role = 'sub_supervisor'),
      'Choose a subcontractor supervisor of this project');
    if sv is not null then co := coalesce(nullif(co, ''), (select company from public.profiles where id = sv)); end if;
  end if;
  perform app.require(coalesce(co, '') <> '', 'Enter the company (subcontractor, or DIMO for own labour)');
  if upper(btrim(co)) <> 'DIMO' and not sup then co := app.sub_name(p_exec, co); end if;
  select * into prev from public.exec_workers x where x.exec_project_id = p_exec and x.id_no = idn and (wid is null or x.id <> wid);
  perform app.require(prev.id is null, format('%s (%s) is already on this project''s worker list', prev.full_name, idn));
  if wid is null then
    insert into public.exec_workers (exec_project_id, company, supervisor_id, full_name, address, police_station, id_type, id_no, mobile, trade, emergency_name, emergency_phone)
    values (p_exec, co, sv, btrim(p ->> 'full_name'), btrim(p ->> 'address'), btrim(p ->> 'police_station'), t, idn, nullif(btrim(p ->> 'mobile'), ''),
            nullif(btrim(p ->> 'trade'), ''), nullif(btrim(p ->> 'emergency_name'), ''), nullif(btrim(p ->> 'emergency_phone'), ''))
    returning id into wid;
    if sup then
      perform app.notify_many(app.project_aes(p_exec), 'exec_worker', 'New worker to verify – ' || btrim(p ->> 'full_name'),
        format('%s · %s · added by %s · check the ID photos and induct', co, app.exec_head(p_exec), app.display_name(auth.uid())),
        'normal', 'exec_project', p_exec, '/execution/worker/' || wid);
    end if;
  else
    select * into w from public.exec_workers where id = wid and exec_project_id = p_exec for update;
    perform app.require(w.id is not null, 'Worker not found');
    perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec) or (w.added_by = auth.uid() and w.verified_at is null),
      'Once verified, only an Assistant Engineer or the Senior Electrical Engineer changes the details');
    update public.exec_workers set company = co, supervisor_id = sv, full_name = btrim(p ->> 'full_name'), address = btrim(p ->> 'address'),
      police_station = btrim(p ->> 'police_station'), id_type = t, id_no = idn, mobile = nullif(btrim(p ->> 'mobile'), ''), trade = nullif(btrim(p ->> 'trade'), ''),
      emergency_name = nullif(btrim(p ->> 'emergency_name'), ''), emergency_phone = nullif(btrim(p ->> 'emergency_phone'), ''),
      verified_by = case when idn <> w.id_no then null else verified_by end, verified_at = case when idn <> w.id_no then null else verified_at end
    where id = w.id;
  end if;
  return wid;
end $$;

revoke execute on function public.save_exec_subcontractor(uuid, jsonb) from public, anon;
grant execute on function public.save_exec_subcontractor(uuid, jsonb) to authenticated, service_role;
