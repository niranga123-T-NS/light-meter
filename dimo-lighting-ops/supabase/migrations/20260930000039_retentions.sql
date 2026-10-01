-- Retentions: money held back by the client / main contractor until the retention due date.
-- Recorded by the Operations Executive (or SM Projects / GM); the sales person follows up, claims and confirms collection.
-- Due dates move only through an extension approved by GM / DGM. Alerts: 60 and 30 days before the due date, daily once
-- due and not claimed (SM Projects after 7 days), claimed but not collected after 30 / 60 / 90 days, bank guarantee expiry.

create table public.retentions (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  project_name text not null,
  project_id uuid references public.projects (id),
  end_client text not null,
  organization_id uuid references public.organizations (id),
  main_contractor text,
  contract_no text,                       -- contract or PO number
  contract_value numeric(16, 2),
  retention_pct numeric(5, 2) check (retention_pct is null or (retention_pct > 0 and retention_pct <= 100)),
  retention_value numeric(16, 2) not null check (retention_value >= 0),
  currency public.currency not null default 'LKR',
  retention_form text not null default 'cash_withheld' check (retention_form in ('cash_withheld', 'bank_guarantee')),
  bg_expiry date,
  start_date date not null,
  due_date date not null,
  original_due_date date,
  extensions int not null default 0,
  sales_person_id uuid references public.profiles (id),
  status text not null default 'held' check (status in ('held', 'claimed', 'collected', 'cancelled')),
  claimed_on date,
  claim_ref text,
  collected_amount numeric(16, 2),
  collected_on date,
  notes text,
  -- alert bookkeeping
  alerted_60 boolean not null default false,
  alerted_30 boolean not null default false,
  sm_overdue_alerted boolean not null default false,
  claim_alert_level int not null default 0,
  bg_alerted boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retention_dates check (due_date >= start_date)
);
create index on public.retentions (sales_person_id, status);
create index on public.retentions (lower(end_client));

create table public.retention_log (
  id bigint generated always as identity primary key,
  retention_id uuid not null references public.retentions (id) on delete cascade,
  at timestamptz not null default now(),
  user_id uuid default auth.uid() references public.profiles (id),
  kind text not null,
  note text
);

create or replace function app.retentions_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.code := coalesce(new.code, app.next_code('RET'));
    new.original_due_date := coalesce(new.original_due_date, new.due_date);
  end if;
  if new.organization_id is null then
    select id into new.organization_id from public.organizations
     where merged_into is null and name_norm = app.normalize_name(new.end_client) limit 1;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger retentions_before before insert or update on public.retentions for each row execute function app.retentions_before();
create trigger audit_retentions after insert or update on public.retentions for each row execute function app.audit();

alter table public.retentions enable row level security;
alter table public.retention_log enable row level security;
create policy retentions_read on public.retentions for select to authenticated
  using (sales_person_id = auth.uid() or app.has_role('gm', 'sm_projects', 'operations_exec'));
create policy retention_log_read on public.retention_log for select to authenticated
  using (exists (select 1 from public.retentions r where r.id = retention_id));
grant select on public.retentions, public.retention_log to authenticated;

create or replace function app.can_edit_retention(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('operations_exec', 'sm_projects', 'gm')
      or exists (select 1 from public.retentions where id = p_id and sales_person_id = auth.uid())
$$;

-- Create / edit (Operations Executive, SM Projects, GM). The due date of an existing record changes only by extension.
create or replace function public.save_retention(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.retentions; rid uuid; val numeric; cv numeric; pct numeric; due date;
begin
  perform app.require(app.has_role('operations_exec', 'sm_projects', 'gm'), 'Only Operations, SM Projects or GM / DGM record retentions');
  perform app.require(coalesce(btrim(p_data ->> 'project_name'), '') <> '', 'Project name is required');
  perform app.require(coalesce(btrim(p_data ->> 'end_client'), '') <> '', 'End client is required');
  perform app.require(p_data ->> 'start_date' is not null, 'Retention start date is required');
  perform app.require(p_data ->> 'currency' in ('LKR', 'USD'), 'Currency must be LKR or USD');
  perform app.require(p_data ->> 'retention_form' in ('cash_withheld', 'bank_guarantee'), 'Choose the retention form');
  cv := nullif(p_data ->> 'contract_value', '')::numeric;
  pct := nullif(p_data ->> 'retention_pct', '')::numeric;
  val := coalesce(nullif(p_data ->> 'retention_value', '')::numeric, round(cv * pct / 100, 2));
  perform app.require(val is not null and val >= 0, 'Enter the retention value (or the contract value and retention %)');
  perform app.require(p_data ->> 'retention_form' <> 'bank_guarantee' or nullif(p_data ->> 'bg_expiry', '') is not null,
    'Enter the bank guarantee expiry date');
  if p_id is null then
    due := (p_data ->> 'due_date')::date;
    perform app.require(due is not null, 'Due date is required');
    perform app.require(due >= (p_data ->> 'start_date')::date, 'The due date must be after the start date');
    insert into public.retentions (project_name, project_id, end_client, main_contractor, contract_no, contract_value, retention_pct,
      retention_value, currency, retention_form, bg_expiry, start_date, due_date, sales_person_id, notes)
    values (btrim(p_data ->> 'project_name'), nullif(p_data ->> 'project_id', '')::uuid, btrim(p_data ->> 'end_client'),
      nullif(btrim(p_data ->> 'main_contractor'), ''), nullif(btrim(p_data ->> 'contract_no'), ''), cv, pct, val,
      (p_data ->> 'currency')::public.currency, p_data ->> 'retention_form', nullif(p_data ->> 'bg_expiry', '')::date,
      (p_data ->> 'start_date')::date, due, nullif(p_data ->> 'sales_person_id', '')::uuid, nullif(btrim(p_data ->> 'notes'), ''))
    returning id into rid;
    insert into public.retention_log (retention_id, kind, note) values (rid, 'created', 'Recorded');
    perform app.notify((select sales_person_id from public.retentions where id = rid), 'retention_assigned', 'Retention recorded for you',
      format('%s – %s · %s · due %s', btrim(p_data ->> 'project_name'), btrim(p_data ->> 'end_client'),
             app.fmt_money(val, (p_data ->> 'currency')::public.currency), to_char(due, 'DD Mon YYYY')),
      'normal', 'retention', rid, '/retentions/' || rid);
    return rid;
  end if;
  select * into r from public.retentions where id = p_id for update;
  perform app.require(r.id is not null, 'Retention not found');
  perform app.require(nullif(p_data ->> 'due_date', '') is null or (p_data ->> 'due_date')::date = r.due_date,
    'The due date changes only through an extension approved by GM / DGM');
  update public.retentions set project_name = btrim(p_data ->> 'project_name'), project_id = nullif(p_data ->> 'project_id', '')::uuid,
    end_client = btrim(p_data ->> 'end_client'), organization_id = case when lower(btrim(p_data ->> 'end_client')) = lower(r.end_client) then organization_id end,
    main_contractor = nullif(btrim(p_data ->> 'main_contractor'), ''),
    contract_no = nullif(btrim(p_data ->> 'contract_no'), ''), contract_value = cv, retention_pct = pct, retention_value = val,
    currency = (p_data ->> 'currency')::public.currency, retention_form = p_data ->> 'retention_form',
    bg_expiry = nullif(p_data ->> 'bg_expiry', '')::date, start_date = (p_data ->> 'start_date')::date,
    sales_person_id = nullif(p_data ->> 'sales_person_id', '')::uuid, notes = nullif(btrim(p_data ->> 'notes'), ''),
    bg_alerted = case when nullif(p_data ->> 'bg_expiry', '')::date is distinct from r.bg_expiry then false else bg_alerted end
  where id = r.id;
  insert into public.retention_log (retention_id, kind, note) values (r.id, 'edited', 'Details updated');
  return r.id;
end $$;

-- Due date extension → GM / DGM approval
create or replace function public.request_retention_extension(p_id uuid, p_new_due date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.retentions;
begin
  select * into r from public.retentions where id = p_id;
  perform app.require(r.id is not null and app.can_edit_retention(r.id), 'Not allowed');
  perform app.require(r.status in ('held', 'claimed'), 'This retention is already closed');
  perform app.require(p_new_due > r.due_date, 'The new due date must be after the current due date');
  perform app.require(coalesce(trim(p_reason), '') <> '', 'Give the reason for the extension');
  insert into public.retention_log (retention_id, kind, note)
  values (r.id, 'extension_requested', format('New due date %s requested: %s', to_char(p_new_due, 'DD Mon YYYY'), p_reason));
  return app.create_approval('retention_extension', 'retention', r.id, null,
    format('Retention due date extension – %s (%s)', r.project_name, r.code),
    format('%s · %s · due %s → %s · %s', r.end_client, app.fmt_money(r.retention_value, r.currency),
           to_char(r.due_date, 'DD Mon YYYY'), to_char(p_new_due, 'DD Mon YYYY'), p_reason),
    array['gm']::public.app_role[], jsonb_build_object('new_date', p_new_due, 'old_date', r.due_date));
end $$;

create or replace function public.mark_retention_claimed(p_id uuid, p_on date, p_ref text default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.retentions;
begin
  select * into r from public.retentions where id = p_id for update;
  perform app.require(r.id is not null and app.can_edit_retention(r.id), 'Not allowed');
  perform app.require(r.status = 'held', 'Only a held retention can be claimed');
  perform app.require(p_on is not null and p_on <= (now() at time zone app.tz())::date, 'Enter the claim date (not in the future)');
  update public.retentions set status = 'claimed', claimed_on = p_on, claim_ref = nullif(btrim(p_ref), ''), claim_alert_level = 0 where id = r.id;
  insert into public.retention_log (retention_id, kind, note)
  values (r.id, 'claimed', concat_ws(' · ', 'Claimed ' || to_char(p_on, 'DD Mon YYYY'), nullif(btrim(p_ref), ''), nullif(btrim(p_note), '')));
end $$;

create or replace function public.mark_retention_collected(p_id uuid, p_amount numeric, p_on date, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.retentions;
begin
  select * into r from public.retentions where id = p_id for update;
  perform app.require(r.id is not null and app.can_edit_retention(r.id), 'Not allowed');
  perform app.require(r.status in ('held', 'claimed'), 'This retention is already closed');
  perform app.require(p_amount is not null and p_amount > 0, 'Enter the amount collected');
  perform app.require(p_on is not null, 'Enter the collection date');
  update public.retentions set status = 'collected', collected_amount = p_amount, collected_on = p_on,
    claimed_on = coalesce(claimed_on, p_on) where id = r.id;
  insert into public.retention_log (retention_id, kind, note)
  values (r.id, 'collected', concat_ws(' · ', format('Collected %s on %s', app.fmt_money(p_amount, r.currency), to_char(p_on, 'DD Mon YYYY')),
          case when p_amount < r.retention_value then format('short by %s', app.fmt_money(r.retention_value - p_amount, r.currency)) end,
          nullif(btrim(p_note), '')));
  perform app.notify_many(app.role_users('operations_exec') || r.sales_person_id, 'retention_collected', 'Retention collected: ' || r.project_name,
    format('%s · %s', r.end_client, app.fmt_money(p_amount, r.currency)), 'normal', 'retention', r.id, '/retentions/' || r.id);
end $$;

create or replace function public.cancel_retention(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('operations_exec', 'sm_projects', 'gm'), 'Not allowed');
  perform app.require(coalesce(trim(p_reason), '') <> '', 'Give the reason');
  update public.retentions set status = 'cancelled' where id = p_id and status in ('held', 'claimed');
  insert into public.retention_log (retention_id, kind, note) values (p_id, 'cancelled', p_reason);
end $$;

-- Alerts (run every 15 minutes, each alert once per day / once per stage)
create or replace function public.retention_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  r public.retentions;
  n int := 0;
  lvl int;
  ops uuid[] := app.role_users('operations_exec');
  head text;
begin
  if loc::time < time '08:00' then return 0; end if;
  for r in select * from public.retentions where status in ('held', 'claimed') loop
    head := format('%s – %s · %s · %s', r.project_name, r.end_client, app.fmt_money(r.retention_value, r.currency), r.code);
    -- 60 / 30 days before the due date
    if r.status = 'held' and not r.alerted_60 and r.due_date - today between 31 and 60 then
      perform app.notify_many(ops || r.sales_person_id, 'retention_due_soon', 'Retention due in ' || (r.due_date - today) || ' days',
        head || ' · prepare the certificates and the claim', 'normal', 'retention', r.id, '/retentions/' || r.id);
      update public.retentions set alerted_60 = true where id = r.id; n := n + 1;
    end if;
    if r.status = 'held' and not r.alerted_30 and r.due_date - today between 1 and 30 then
      perform app.notify_many(ops || r.sales_person_id, 'retention_due_soon', 'Retention due in ' || (r.due_date - today) || ' days',
        head || ' · claim it on the due date', 'normal', 'retention', r.id, '/retentions/' || r.id);
      update public.retentions set alerted_60 = true, alerted_30 = true where id = r.id; n := n + 1;
    end if;
    -- Due and not claimed: every day to the sales person and Operations; SM Projects once after 7 days
    if r.status = 'held' and r.due_date <= today then
      perform app.notify_many(ops || r.sales_person_id, 'retention_due', 'Retention due – claim it now',
        head || format(' · due %s (%s days ago)', to_char(r.due_date, 'DD Mon YYYY'), today - r.due_date),
        'normal', 'retention', r.id, '/retentions/' || r.id, format('retdue:%s:%s', r.id, today), true);
      n := n + 1;
      if not r.sm_overdue_alerted and today - r.due_date >= 7 then
        perform app.notify_many(app.role_users('sm_projects'), 'retention_due', 'Retention not claimed 7 days after due date',
          head || ' · sales person ' || coalesce(app.display_name(r.sales_person_id), '—'), 'normal', 'retention', r.id, '/retentions/' || r.id);
        update public.retentions set sm_overdue_alerted = true where id = r.id;
      end if;
    end if;
    -- Claimed but not collected: 30 → sales person, 60 → + SM Projects, 90 → + GM / DGM
    if r.status = 'claimed' and r.claimed_on is not null then
      lvl := case when today - r.claimed_on >= 90 then 3 when today - r.claimed_on >= 60 then 2 when today - r.claimed_on >= 30 then 1 else 0 end;
      if lvl > r.claim_alert_level then
        perform app.notify_many(
          array[r.sales_person_id] || ops || case when lvl >= 2 then app.role_users('sm_projects') else '{}'::uuid[] end
            || case when lvl >= 3 then app.role_users('gm') else '{}'::uuid[] end,
          'retention_claim_overdue', format('Retention claimed %s days ago – not collected', today - r.claimed_on),
          head || ' · claimed ' || to_char(r.claimed_on, 'DD Mon YYYY'),
          case when lvl >= 3 then 'critical'::public.priority else 'normal'::public.priority end, 'retention', r.id, '/retentions/' || r.id);
        update public.retentions set claim_alert_level = lvl where id = r.id; n := n + 1;
      end if;
    end if;
    -- Bank guarantee given in place of retention expiring within 30 days
    if r.retention_form = 'bank_guarantee' and r.bg_expiry is not null and not r.bg_alerted and r.bg_expiry - today <= 30 then
      perform app.notify_many(ops || r.sales_person_id, 'retention_bg_expiry', 'Retention bank guarantee expiring ' || to_char(r.bg_expiry, 'DD Mon YYYY'),
        head || ' · renew or release it', 'normal', 'retention', r.id, '/retentions/' || r.id);
      update public.retentions set bg_alerted = true where id = r.id; n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.retention_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.retention_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('retention-tick', '*/15 * * * *', 'select public.retention_tick()');
  end if;
end $$;

revoke execute on function public.save_retention(uuid, jsonb), public.request_retention_extension(uuid, date, text),
  public.mark_retention_claimed(uuid, date, text, text), public.mark_retention_collected(uuid, numeric, date, text),
  public.cancel_retention(uuid, text), app.can_edit_retention(uuid) from public, anon;
grant execute on function public.save_retention(uuid, jsonb), public.request_retention_extension(uuid, date, text),
  public.mark_retention_claimed(uuid, date, text, text), public.mark_retention_collected(uuid, numeric, date, text),
  public.cancel_retention(uuid, text), app.can_edit_retention(uuid) to authenticated, service_role;

-- Files on a retention (contract clause, certificates, claim letter, bank guarantee, payment proof)
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
  else return false;
  end case;
end $$;


create or replace function app.can_read_attachment(a public.attachments) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); inq uuid; st text; mode int; released timestamptz;
begin
  if r is null then return false; end if;
  if a.uploaded_by = auth.uid() then return true; end if;
  case a.entity_type
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
  else
    return r = 'gm';
  end case;
end $$;

-- GM / DGM decision on a retention due date extension
create or replace function app.apply_approval(a public.approvals, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries;
  approved boolean := a.status = 'approved';
  decider public.app_role;
  who text;
begin
  perform set_config('app.workflow', '1', true);
  if a.inquiry_id is not null then select * into i from public.inquiries where id = a.inquiry_id; end if;

  case a.kind
  when 'mixed_duty' then
    if approved then
      update public.inquiries set mixed_duty_approved = true where id = a.inquiry_id;
      perform app.notify(i.sales_person_id, 'mixed_duty_approved', 'Mixed duty approved – you can submit',
        i.code, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'debtor_check' then
    if approved then
      perform public.resume_inquiry(a.inquiry_id);
    else
      perform app.notify(i.sales_person_id, 'debtor_hold', 'Inquiry held for debtor collection',
        coalesce(p_comment, ''), 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'release_mode' then
    if approved then
      update public.inquiries set release_mode = coalesce((a.payload ->> 'release_mode')::int, release_mode),
        release_mode_confirmed = true where id = a.inquiry_id;
    end if;
  when 'duty_change' then
    if approved then
      update public.inquiries set duty_status = (a.payload ->> 'duty_status')::public.duty_status where id = a.inquiry_id;
      perform app.notify_many(array[(select assignee_id from public.estimation_jobs where inquiry_id = i.id order by created_at desc limit 1)]
        || app.role_users('sm_estimation'), 'duty_changed', 'Duty status changed', format('%s is now %s – revise the quotation',
        i.code, a.payload ->> 'duty_status'), 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'expectation_change' then
    if approved then
      update public.inquiries set solution_level = coalesce(a.payload ->> 'solution_level', solution_level),
        manufacturing_origin = coalesce(a.payload ->> 'manufacturing_origin', manufacturing_origin),
        expectation_notes = coalesce(a.payload ->> 'expectation_notes', expectation_notes),
        estimation_scope = coalesce((select array_agg(x) from jsonb_array_elements_text(
                                       case when jsonb_typeof(a.payload -> 'estimation_scope') = 'array' then a.payload -> 'estimation_scope' end) x),
                                    estimation_scope),
        estimation_basis = coalesce(a.payload ->> 'estimation_basis', estimation_basis),
        design_scope = coalesce(a.payload ->> 'design_scope', design_scope)
      where id = a.inquiry_id;
      perform app.notify_many(
        array(select assignee_id from public.design_jobs where inquiry_id = i.id and status not in ('approved', 'released')
              union select assignee_id from public.estimation_jobs where inquiry_id = i.id and status not in ('released')),
        'expectation_changed', 'Client expectation changed – review your job', i.code, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'early_design_release' then
    if approved then
      update public.inquiries set early_design_release_at = now(), design_released_to_sales_at = now() where id = a.inquiry_id;
      perform app.log_status('inquiry', i.id, i.id, i.status, i.status, 'Early design release approved');
      perform app.notify_many(array[i.sales_person_id] || app.role_users('sm_projects'), 'design_released',
        'Design released early for client approval', format('%s – %s', i.code, i.project_name),
        'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'quotation_release' then
    if approved then
      update public.estimation_jobs set status = 'approved', approved_at = now(), needs_sm_projects = true, review_comment = p_comment
       where id = a.entity_id;
      perform app.notify_many(app.role_users('sm_estimation') || (select assignee_id from public.estimation_jobs where id = a.entity_id),
        'quotation_approved', 'GM / DGM approved the quotation – release it: ' || i.code, coalesce(p_comment, ''),
        'normal', 'estimation_job', a.entity_id, '/estimation/' || a.entity_id);
    else
      perform app.quotation_send_back(a.entity_id, i.id, p_comment, true);
    end if;
  when 'estimation_hold' then
    if approved then
      update public.estimation_jobs set status_before_hold = status, status = 'on_hold', hold_reason = a.reason where id = a.entity_id;
      perform app.pause_clocks('estimation_job', a.entity_id, a.reason);
      perform app.refresh_inquiry(a.inquiry_id);
    end if;
  when 'weekly_plan' then
    null; -- handled by approve_visit_plan
  when 'sample_return_date' then
    if approved then
      update public.samples set expected_return_date = (a.payload ->> 'new_date')::date where id = a.entity_id;
    end if;
  when 'account_ownership' then
    if approved then
      if a.entity_type = 'organization' then
        update public.organizations set account_owner_id = (a.payload ->> 'owner_id')::uuid where id = a.entity_id;
      else
        update public.org_units set account_owner_id = (a.payload ->> 'owner_id')::uuid where id = a.entity_id;
      end if;
    end if;
  when 'design_due' then
    if approved then
      update public.inquiries set design_due_at = (a.payload ->> 'due')::timestamptz, design_due_status = 'approved' where id = a.inquiry_id;
    else
      update public.inquiries set design_due_status = 'returned' where id = a.inquiry_id;
    end if;
  when 'quotation_sm_projects' then
    if approved then
      update public.estimation_jobs set status = 'approved', approved_at = now(), review_comment = coalesce(p_comment, review_comment)
       where id = a.entity_id;
      perform app.log_status('estimation_job', a.entity_id, i.id, 'sm_projects_approval', 'approved', p_comment);
      perform app.notify_many(app.role_users('sm_estimation') || (select assignee_id from public.estimation_jobs where id = a.entity_id),
        'quotation_approved', 'Quotation approved – release it: ' || i.code, coalesce(p_comment, ''),
        'normal', 'estimation_job', a.entity_id, '/estimation/' || a.entity_id);
    else
      decider := (select s.approver_role from public.approval_steps s where s.approval_id = a.id and s.decision is not null
                   order by s.step_no desc limit 1);
      perform app.quotation_send_back(a.entity_id, i.id, p_comment, decider = 'gm' or app.my_role() = 'gm');
    end if;
    perform app.refresh_inquiry(i.id);
  when 'retention_extension' then
    if approved then
      update public.retentions set due_date = (a.payload ->> 'new_date')::date, extensions = extensions + 1,
        alerted_60 = false, alerted_30 = false, sm_overdue_alerted = false
       where id = a.entity_id;
    end if;
    insert into public.retention_log (retention_id, kind, note)
    values (a.entity_id, case when approved then 'extended' else 'extension_' || a.status end,
            format('Due date %s → %s %s by GM / DGM%s', to_char((a.payload ->> 'old_date')::date, 'DD Mon YYYY'),
                   to_char((a.payload ->> 'new_date')::date, 'DD Mon YYYY'), case when approved then 'approved' else a.status end,
                   coalesce(' · ' || p_comment, '')));
    perform app.notify_many(app.role_users('operations_exec') || (select sales_person_id from public.retentions where id = a.entity_id),
      'retention_extension', format('Retention extension %s', case when approved then 'approved' else a.status end),
      coalesce(a.title, '') || coalesce(' · ' || p_comment, ''), 'normal', 'retention', a.entity_id, '/retentions/' || a.entity_id);
  else
    null;
  end case;
end $$;
