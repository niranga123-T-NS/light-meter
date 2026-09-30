-- Weekly plan workflow (4.4), Debtors (Section 12) and Samples (Section 13).

-- ---------------------------------------------------------------------------
-- Weekly plan: submit, approve, change after approval, evaluate
-- ---------------------------------------------------------------------------
create or replace function app.plan_deadline(p_week_start date) returns timestamptz
language sql stable as $$
  -- Saturday 13:00 before the planned week
  select ((p_week_start - 2) + coalesce(app.setting('plan_deadline') #>> '{}', '13:00')::time) at time zone app.tz()
$$;

create or replace function public.submit_visit_plan(p_plan uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.visit_plans;
  clash record;
  n int;
begin
  select * into p from public.visit_plans where id = p_plan for update;
  perform app.require(p.sales_person_id = auth.uid(), 'Only the owner can submit this plan');
  perform app.require(p.status in ('draft', 'returned'), 'Plan is already submitted');
  select count(*) into n from public.visit_plan_lines where plan_id = p.id;
  perform app.require(n > 0, 'Add at least one planned visit');
  perform set_config('app.workflow', '1', true);
  update public.visit_plans set status = 'submitted', submitted_at = now(),
    is_late = is_late or now() > app.plan_deadline(p.week_start),
    version = case when p.status = 'returned' then version + 1 else version end
  where id = p.id;

  -- Same organization in both sales people's plans for the same week (4.5)
  for clash in
    select distinct o.name, l.organization_id, op.sales_person_id as other_person
    from public.visit_plan_lines l
    join public.organizations o on o.id = l.organization_id
    join public.visit_plan_lines ol on ol.organization_id = l.organization_id
    join public.visit_plans op on op.id = ol.plan_id and op.week_start = p.week_start and op.sales_person_id <> p.sales_person_id
    where l.plan_id = p.id
  loop
    perform app.notify_many(app.role_users('sm_projects'), 'duplicate_visit', 'Same customer in two plans',
      format('%s is planned by %s and %s for the week of %s', clash.name, app.display_name(p.sales_person_id),
             app.display_name(clash.other_person), to_char(p.week_start, 'DD Mon')),
      'normal', 'visit_plan', p.id, '/plan/' || p.id, format('planclash:%s:%s', p.week_start, clash.organization_id));
  end loop;
  -- Planned visit to another sales person's customer
  for clash in
    select o.name, app.account_owner(l.organization_id, l.unit_id) as owner
    from public.visit_plan_lines l join public.organizations o on o.id = l.organization_id
    where l.plan_id = p.id and not l.joint_visit_approved
      and app.account_owner(l.organization_id, l.unit_id) is not null
      and app.account_owner(l.organization_id, l.unit_id) <> p.sales_person_id
  loop
    perform app.notify_many(app.role_users('sm_projects'), 'duplicate_visit', 'Planned visit to another sales person''s customer',
      format('%s plans to visit %s (owner: %s)', app.display_name(p.sales_person_id), clash.name, app.display_name(clash.owner)),
      'normal', 'visit_plan', p.id, '/plan/' || p.id);
  end loop;

  perform app.notify_many(app.role_users('sm_projects'), 'plan_submitted', 'Weekly plan submitted',
    format('%s – week of %s%s', app.display_name(p.sales_person_id), to_char(p.week_start, 'DD Mon'),
           case when now() > app.plan_deadline(p.week_start) then ' (late)' else '' end),
    'normal', 'visit_plan', p.id, '/plan/' || p.id, null, true);
  return jsonb_build_object('late', now() > app.plan_deadline(p.week_start));
end $$;

create or replace function public.decide_visit_plan(p_plan uuid, p_decision text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.visit_plans;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'Only SM Projects approves weekly plans');
  select * into p from public.visit_plans where id = p_plan for update;
  perform app.require(p.status = 'submitted', 'Plan is not waiting for approval');
  perform app.require(p_decision in ('approved', 'returned'), 'Invalid decision');
  perform app.require(p_decision = 'approved' or coalesce(trim(p_comment), '') <> '', 'Give a reason when returning the plan');
  perform set_config('app.workflow', '1', true);
  update public.visit_plans set status = p_decision, approved_by = auth.uid(), approved_at = now(), manager_comment = p_comment where id = p.id;
  perform app.notify(p.sales_person_id, 'plan_' || p_decision,
    case when p_decision = 'approved' then 'Weekly plan approved' else 'Weekly plan returned – resubmit today' end,
    coalesce(p_comment, ''), 'normal', 'visit_plan', p.id, '/plan/' || p.id);
end $$;

-- SM Projects decides a duplicate-visit alert: joint visit, reassign the account, or reject (4.5)
create or replace function public.resolve_duplicate_line(p_line uuid, p_decision text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare l public.visit_plan_lines; sp uuid;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'Only SM Projects can decide');
  select * into l from public.visit_plan_lines where id = p_line;
  select sales_person_id into sp from public.visit_plans where id = l.plan_id;
  if p_decision = 'joint' then
    update public.visit_plan_lines set joint_visit_approved = true where id = p_line;
  elsif p_decision = 'reassign' then
    if l.unit_id is not null then update public.org_units set account_owner_id = sp where id = l.unit_id;
    else update public.organizations set account_owner_id = sp where id = l.organization_id; end if;
  elsif p_decision = 'reject' then
    update public.visit_plan_lines set status = 'cancelled', change_reason = coalesce(p_comment, 'Rejected – another sales person''s customer') where id = p_line;
  else raise exception 'Invalid decision';
  end if;
  insert into public.audit_log (table_name, record_id, action, new_data)
  values ('duplicate_visit_decision', p_line::text, p_decision, jsonb_build_object('comment', p_comment));
  perform app.notify(sp, 'duplicate_decision', 'Duplicate visit decision: ' || p_decision, coalesce(p_comment, ''),
    'normal', 'visit_plan', l.plan_id, '/plan/' || l.plan_id);
end $$;

-- Sales people cannot set approval fields on their own plan
create or replace function app.visit_plans_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() = old.sales_person_id and current_setting('app.workflow', true) is distinct from '1'
     and (new.status, new.approved_by, new.approved_at, new.rating, new.evaluation_comment, new.is_late, new.submitted_at, new.manager_comment)
         is distinct from (old.status, old.approved_by, old.approved_at, old.rating, old.evaluation_comment, old.is_late, old.submitted_at, old.manager_comment) then
    raise exception 'Use Submit to send the plan for approval';
  end if;
  return new;
end $$;
create trigger visit_plans_guard before update on public.visit_plans for each row execute function app.visit_plans_guard();

-- Changes during the week need a reason (every change is logged against the approved version)
create or replace function app.plan_lines_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.visit_plans;
begin
  select * into p from public.visit_plans where id = coalesce(new.plan_id, old.plan_id);
  if tg_op = 'DELETE' then
    if p.status in ('submitted', 'approved') then raise exception 'Cancel the visit with a reason instead of deleting it'; end if;
    return old;
  end if;
  if p.status = 'approved' then
    if tg_op = 'INSERT' then new.added_after_approval := true;
    elsif new.status in ('rescheduled', 'cancelled') and old.status <> new.status and coalesce(trim(new.change_reason), '') = '' then
      raise exception 'Give a reason for rescheduling or cancelling';
    elsif new.status = 'missed' and new.missed_reason is null then
      raise exception 'Select the missed-visit reason';
    end if;
  elsif p.status = 'submitted' and auth.uid() = p.sales_person_id then
    raise exception 'Plan is waiting for approval and cannot be changed';
  end if;
  return new;
end $$;
create trigger plan_lines_guard before insert or update or delete on public.visit_plan_lines
for each row execute function app.plan_lines_guard();

create or replace function public.evaluate_visit_plan(p_plan uuid, p_rating int, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.visit_plans;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'Only SM Projects evaluates plans');
  select * into p from public.visit_plans where id = p_plan;
  update public.visit_plans set rating = p_rating, evaluation_comment = p_comment, evaluated_at = now() where id = p_plan;
  perform app.notify(p.sales_person_id, 'plan_evaluated', 'Weekly evaluation added', coalesce(p_comment, ''),
    'normal', 'visit_plan', p_plan, '/plan/' || p_plan);
end $$;

-- Plan-vs-actual measures per person per week (4.4)
create or replace function public.plan_vs_actual(p_sales_person uuid, p_week_start date)
returns table (planned int, completed_as_planned int, rescheduled int, missed int, cancelled int, unplanned_added int,
               plan_completion_pct numeric, objective_match_pct numeric, gps_verified_pct numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (p_sales_person = auth.uid() or app.has_role('sm_projects', 'gm')) then return; end if;
  return query
  with lines as (
    select l.*, v.primary_objective as actual_objective, v.gps_verified
    from public.visit_plan_lines l
    join public.visit_plans p on p.id = l.plan_id
    left join public.visits v on v.plan_line_id = l.id
    where p.sales_person_id = p_sales_person and p.week_start = p_week_start and not l.added_after_approval
  ), vis as (
    select * from public.visits v
    where v.sales_person_id = p_sales_person
      and (v.checkin_at at time zone app.tz())::date between p_week_start and p_week_start + 6
  )
  select count(*)::int,
         count(*) filter (where status = 'completed')::int,
         count(*) filter (where status = 'rescheduled')::int,
         count(*) filter (where status = 'missed' or (status = 'planned' and planned_date < (now() at time zone app.tz())::date))::int,
         count(*) filter (where status = 'cancelled')::int,
         (select count(*) from vis where vis.unplanned)::int,
         round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*), 0), 1),
         round(100.0 * count(*) filter (where status = 'completed' and actual_objective = planned_objective)
               / nullif(count(*) filter (where status = 'completed'), 0), 1),
         (select round(100.0 * count(*) filter (where vis.gps_verified) / nullif(count(*) filter (where vis.gps_verified is not null), 0), 1) from vis)
  from lines;
end $$;

-- ---------------------------------------------------------------------------
-- Debtors (Section 12)
-- ---------------------------------------------------------------------------
create table public.debt_uploads (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null default auth.uid() references public.profiles (id),
  as_at date not null,
  file_path text,
  status text not null default 'preview' check (status in ('preview', 'confirmed', 'cancelled')),
  row_count int not null default 0,
  error_count int not null default 0,
  totals jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table public.debt_upload_rows (
  id bigint generated always as identity primary key,
  upload_id uuid not null references public.debt_uploads (id) on delete cascade,
  row_no int not null,
  project_name text,
  client_name text,
  invoice_no text,
  invoice_date date,
  amount numeric(16, 2),
  currency public.currency,
  outstanding_days int,
  sales_person_hint text,
  project_id uuid references public.projects (id),
  organization_id uuid references public.organizations (id),
  unit_id uuid references public.org_units (id),
  sales_person_id uuid references public.profiles (id),
  errors text[] not null default '{}'
);
create index on public.debt_upload_rows (upload_id);

create table public.debts (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  project_id uuid references public.projects (id),
  project_name text,
  organization_id uuid references public.organizations (id),
  unit_id uuid references public.org_units (id),
  client_name text,
  sales_person_id uuid references public.profiles (id),
  invoice_date date,
  amount numeric(16, 2) not null,
  currency public.currency not null,
  outstanding_days int not null,
  ageing_bucket text generated always as (case
    when outstanding_days <= 30 then '1-30' when outstanding_days <= 60 then '31-60'
    when outstanding_days <= 90 then '61-90' when outstanding_days <= 120 then '91-120'
    when outstanding_days <= 150 then '121-150' when outstanding_days <= 180 then '151-180'
    when outstanding_days <= 365 then 'over-180' else 'over-365' end) stored,
  status text not null default 'outstanding' check (status in (
    'outstanding', 'follow_up', 'payment_promised', 'partially_collected', 'collected', 'collected_confirmed', 'disputed', 'cleared')),
  status_note text,
  next_follow_up_date date,
  promised_date date,
  collected_amount numeric(16, 2),
  collected_date date,
  collected_ref text,
  dispute_reason text,
  is_legal boolean not null default false,
  legal_description text check (char_length(legal_description) <= 180),
  next_hearing_date date,
  legal_outcome text,
  collection_mismatch boolean not null default false,
  last_status_at timestamptz not null default now(),
  last_amount_change_at timestamptz not null default now(),
  last_upload_id uuid references public.debt_uploads (id),
  cleared_at timestamptz,
  last_reminder_on date,
  non_moving_alerted_on date,
  hearing_alerted_for date,
  created_at timestamptz not null default now()
);
create index on public.debts (sales_person_id, status);
create index on public.debts (organization_id);

create table public.debt_snapshots (
  upload_id uuid not null references public.debt_uploads (id),
  debt_id uuid not null references public.debts (id),
  amount numeric(16, 2) not null,
  outstanding_days int not null,
  primary key (upload_id, debt_id)
);

create table public.debt_log (
  id bigint generated always as identity primary key,
  debt_id uuid not null references public.debts (id),
  kind text not null check (kind in ('status', 'legal', 'upload')),
  from_status text,
  to_status text,
  note text,
  legal_description text,
  next_hearing_date date,
  user_id uuid default auth.uid(),
  at timestamptz not null default now()
);

-- Stage an upload: the app parses the Excel template and sends rows as JSON; the server matches and validates.
create or replace function public.stage_debtor_upload(p_as_at date, p_rows jsonb, p_file_path text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  up uuid;
  r jsonb;
  n int := 0;
  errs text[];
  proj record;
  org record;
  sp uuid;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive uploads the debtors list');
  insert into public.debt_uploads (as_at, file_path) values (p_as_at, p_file_path) returning id into up;
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    errs := '{}';
    proj := null; org := null; sp := null;
    if coalesce(r ->> 'invoice_no', '') = '' then errs := errs || 'Invoice number missing'::text; end if;
    if (r ->> 'amount') is null then errs := errs || 'Outstanding amount missing'::text; end if;
    if (r ->> 'currency') not in ('LKR', 'USD') then errs := errs || 'Currency must be LKR or USD'::text; end if;
    if (r ->> 'outstanding_days') is null then errs := errs || 'Outstanding days missing'::text; end if;
    select p.id, p.owner_id, p.organization_id, p.unit_id into proj from public.projects p
     where p.merged_into is null and p.name_norm = app.normalize_name(r ->> 'project_name') limit 1;
    if proj.id is null then
      select p.id, p.owner_id, p.organization_id, p.unit_id into proj from public.projects p
       where p.merged_into is null and extensions.similarity(p.name_norm, app.normalize_name(r ->> 'project_name')) > 0.6
       order by extensions.similarity(p.name_norm, app.normalize_name(r ->> 'project_name')) desc limit 1;
    end if;
    select o.id into org from public.organizations o where o.merged_into is null and o.name_norm = app.normalize_name(r ->> 'client_name') limit 1;
    if proj.id is null then errs := errs || 'Project not matched'::text; end if;
    if org.id is null and proj.id is null then errs := errs || 'Client not matched'::text; end if;
    if coalesce(r ->> 'sales_person', '') <> '' then
      select id into sp from public.profiles where role in ('asm_building', 'asm_infra') and lower(full_name) = lower(r ->> 'sales_person');
    end if;
    insert into public.debt_upload_rows (upload_id, row_no, project_name, client_name, invoice_no, invoice_date, amount, currency,
      outstanding_days, sales_person_hint, project_id, organization_id, unit_id, sales_person_id, errors)
    values (up, n, r ->> 'project_name', r ->> 'client_name', r ->> 'invoice_no', nullif(r ->> 'invoice_date', '')::date,
      (r ->> 'amount')::numeric, case when (r ->> 'currency') in ('LKR', 'USD') then (r ->> 'currency')::public.currency end,
      (r ->> 'outstanding_days')::int, r ->> 'sales_person', proj.id, coalesce(org.id, proj.organization_id), proj.unit_id,
      coalesce(sp, proj.owner_id), errs);
  end loop;
  -- Duplicate invoice numbers in the file
  update public.debt_upload_rows d set errors = errors || 'Duplicate invoice number in file'::text
   where upload_id = up and invoice_no in (select invoice_no from public.debt_upload_rows where upload_id = up
                                           group by invoice_no having count(*) > 1);
  perform app.refresh_upload_totals(up);
  return up;
end $$;

create or replace function app.refresh_upload_totals(p_upload uuid) returns void
language sql security definer set search_path = public as $$
  update public.debt_uploads u set
    row_count = (select count(*) from public.debt_upload_rows where upload_id = u.id),
    error_count = (select count(*) from public.debt_upload_rows where upload_id = u.id and cardinality(errors) > 0),
    totals = (select jsonb_build_object(
      'LKR', coalesce(sum(amount) filter (where currency = 'LKR'), 0),
      'USD', coalesce(sum(amount) filter (where currency = 'USD'), 0))
      from public.debt_upload_rows where upload_id = u.id)
  where u.id = p_upload;
$$;

-- Operations Executive maps an unmatched row
create or replace function public.map_debtor_row(p_row bigint, p_project uuid, p_sales_person uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive maps rows');
  select id, organization_id, unit_id, owner_id into p from public.projects where id = p_project;
  update public.debt_upload_rows set project_id = p.id, organization_id = p.organization_id, unit_id = p.unit_id,
    sales_person_id = coalesce(p_sales_person, p.owner_id),
    errors = array(select e from unnest(errors) e where e not in ('Project not matched', 'Client not matched'))
  where id = p_row;
  perform app.refresh_upload_totals((select upload_id from public.debt_upload_rows where id = p_row));
end $$;

-- Project names for mapping (Operations cannot read the project register directly)
create or replace function public.lookup_projects_basic(p_query text)
returns table (id uuid, name text, customer text, owner text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.has_role('operations_exec', 'sm_projects', 'gm', 'asm_building', 'asm_infra') then return; end if;
  return query select p.id, p.name, o.name, app.display_name(p.owner_id)
  from public.projects p join public.organizations o on o.id = p.organization_id
  where p.merged_into is null and (p.name ilike '%' || p_query || '%' or o.name ilike '%' || p_query || '%')
  order by p.name limit 20;
end $$;

create or replace function app.debt_crossed(old_days int, new_days int, threshold int) returns boolean
language sql immutable as $$ select coalesce(old_days, 0) <= threshold and new_days > threshold $$;

create or replace function public.confirm_debtor_upload(p_upload uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u public.debt_uploads;
  r public.debt_upload_rows;
  d public.debts;
  added int := 0; updated int := 0; cleared int := 0; mismatches int := 0;
  t int;
  prev_days int;
  mgmt uuid[] := app.role_users('sm_projects') || app.role_users('gm');
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive confirms uploads');
  select * into u from public.debt_uploads where id = p_upload for update;
  perform app.require(u.status = 'preview', 'Upload already processed');
  perform app.require(not exists (select 1 from public.debt_upload_rows where upload_id = u.id and cardinality(errors) > 0),
    'Fix or map every row with errors before confirming');

  for r in select * from public.debt_upload_rows where upload_id = u.id loop
    select * into d from public.debts where invoice_no = r.invoice_no for update;
    prev_days := d.outstanding_days;
    if not found then
      prev_days := null;
      insert into public.debts (invoice_no, project_id, project_name, organization_id, unit_id, client_name, sales_person_id,
        invoice_date, amount, currency, outstanding_days, last_upload_id)
      values (r.invoice_no, r.project_id, r.project_name, r.organization_id, r.unit_id, r.client_name, r.sales_person_id,
        r.invoice_date, r.amount, r.currency, r.outstanding_days, u.id)
      returning * into d;
      added := added + 1;
      insert into public.debt_log (debt_id, kind, to_status, note) values (d.id, 'upload', 'outstanding', 'New in upload ' || u.as_at);
    else
      -- Collected but still in the file → mismatch (12.4)
      if d.status = 'collected' and r.amount > 0 then
        mismatches := mismatches + 1;
        update public.debts set collection_mismatch = true where id = d.id;
        perform app.notify_many(array[d.sales_person_id] || app.role_users('operations_exec') || app.role_users('sm_projects'),
          'collection_mismatch', 'Collected debt still in the debtors list',
          format('%s · %s · %s', d.client_name, d.invoice_no, app.fmt_money(r.amount, r.currency)), 'normal', 'debt', d.id, '/debtors/' || d.id);
      end if;
      update public.debts set amount = r.amount, outstanding_days = r.outstanding_days, last_upload_id = u.id,
        last_amount_change_at = case when r.amount < d.amount then now() else last_amount_change_at end,
        project_id = coalesce(r.project_id, project_id), sales_person_id = coalesce(r.sales_person_id, sales_person_id),
        status = case when status = 'cleared' then 'outstanding' else status end
      where id = d.id;
      updated := updated + 1;
    end if;
    insert into public.debt_snapshots (upload_id, debt_id, amount, outstanding_days) values (u.id, d.id, r.amount, r.outstanding_days)
    on conflict do nothing;

    -- Ageing crossings 60 / 120 / 180 (12.6)
    foreach t in array array[60, 120, 180] loop
      if prev_days is not null and app.debt_crossed(prev_days, r.outstanding_days, t) then
        perform app.notify_many(array[r.sales_person_id] || mgmt, 'debt_crossed_' || t,
          format('Debt crossed %s days', t),
          format('%s – %s · %s · %s · %s days', r.client_name, r.project_name, r.invoice_no, app.fmt_money(r.amount, r.currency), r.outstanding_days),
          case when t = 180 then 'critical'::public.priority else 'normal'::public.priority end,
          'debt', d.id, '/debtors/' || d.id, format('debt:%s:%s', d.id, t));
      end if;
    end loop;
  end loop;

  -- Invoices no longer in the file
  for d in select * from public.debts
           where status not in ('cleared', 'collected_confirmed')
             and invoice_no not in (select invoice_no from public.debt_upload_rows where upload_id = u.id) loop
    update public.debts set status = case when d.status = 'collected' then 'collected_confirmed' else 'cleared' end,
      cleared_at = now(), last_status_at = now(), collection_mismatch = false where id = d.id;
    insert into public.debt_log (debt_id, kind, from_status, to_status, note)
    values (d.id, 'upload', d.status, case when d.status = 'collected' then 'collected_confirmed' else 'cleared' end, 'Cleared by upload ' || u.as_at);
    cleared := cleared + 1;
  end loop;

  update public.debt_uploads set status = 'confirmed', confirmed_at = now() where id = u.id;
  return jsonb_build_object('added', added, 'updated', updated, 'cleared', cleared, 'mismatches', mismatches);
end $$;

-- Sales person updates the status of one debt (12.4)
create or replace function public.update_debt_status(
  p_debt uuid, p_status text, p_note text default null, p_next_follow_up date default null, p_promised_date date default null,
  p_collected_amount numeric default null, p_collected_date date default null, p_ref text default null
) returns void language plpgsql security definer set search_path = public as $$
declare d public.debts;
begin
  select * into d from public.debts where id = p_debt for update;
  perform app.require(d.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person can update this debt');
  perform app.require(p_status in ('follow_up', 'payment_promised', 'partially_collected', 'collected', 'disputed', 'outstanding'), 'Invalid status');
  perform app.require(p_status <> 'follow_up' or (p_note is not null and p_next_follow_up is not null), 'Add a note and the next follow-up date');
  perform app.require(p_status <> 'payment_promised' or p_promised_date is not null, 'Add the promised date');
  perform app.require(p_status <> 'partially_collected' or p_collected_amount is not null, 'Enter the amount collected');
  perform app.require(p_status <> 'collected' or p_collected_date is not null, 'Enter the collection date');
  perform app.require(p_status <> 'disputed' or p_note is not null, 'Give the dispute reason');
  update public.debts set status = p_status, status_note = p_note, next_follow_up_date = p_next_follow_up,
    promised_date = p_promised_date, collected_amount = coalesce(p_collected_amount, collected_amount),
    collected_date = p_collected_date, collected_ref = p_ref,
    dispute_reason = case when p_status = 'disputed' then p_note else dispute_reason end,
    last_status_at = now()
  where id = d.id;
  insert into public.debt_log (debt_id, kind, from_status, to_status, note) values (d.id, 'status', d.status, p_status, p_note);
end $$;

-- Legal status: Operations Executive only (12.8)
create or replace function public.set_debt_legal(
  p_debt uuid, p_is_legal boolean, p_description text, p_next_hearing date default null, p_outcome text default null
) returns void language plpgsql security definer set search_path = public as $$
declare d public.debts;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive can set Legal status');
  perform app.require(char_length(coalesce(p_description, '')) between 1 and 180, 'Short description is required (max 180 characters)');
  perform app.require(not p_is_legal or p_next_hearing is not null or p_outcome is not null, 'Next hearing date is required while under Legal');
  select * into d from public.debts where id = p_debt for update;
  update public.debts set is_legal = p_is_legal and p_outcome is null, legal_description = p_description,
    next_hearing_date = case when p_outcome is null then p_next_hearing end,
    legal_outcome = p_outcome, hearing_alerted_for = null, last_status_at = now()
  where id = d.id;
  insert into public.debt_log (debt_id, kind, note, legal_description, next_hearing_date)
  values (d.id, 'legal', coalesce(p_outcome, case when p_is_legal then 'Legal' else 'Legal removed' end), p_description, p_next_hearing);
end $$;

-- ---------------------------------------------------------------------------
-- Samples (Section 13)
-- ---------------------------------------------------------------------------
create table public.samples (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  sales_person_id uuid not null default auth.uid() references public.profiles (id),
  project_id uuid not null references public.projects (id),
  organization_id uuid references public.organizations (id),
  unit_id uuid references public.org_units (id),
  project_name text,
  client_name text,
  sample_type text not null check (sample_type in ('returnable', 'non_returnable')),
  expected_return_date date,
  purpose text not null,
  required_by timestamptz not null,
  handover_location text not null,
  handover_lat double precision,
  handover_lng double precision,
  handover_person jsonb not null default '{}'::jsonb,   -- {name, designation, organization, phone}
  notes text,
  currency public.currency not null default 'LKR',
  total_value numeric(16, 2) not null default 0,
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'availability_confirmed', 'not_available', 'approved', 'rejected', 'returned_for_changes',
    'handed_over', 'out', 'returned', 'closed', 'damaged_lost')),
  availability text check (availability in ('available', 'partly_available', 'not_available')),
  availability_note text,
  availability_checked_at timestamptz,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  approval_comment text,
  handed_over_at timestamptz,
  handed_over_by text,
  received_by text,
  returned_at timestamptz,
  return_condition text check (return_condition in ('good', 'damaged', 'incomplete')),
  submitted_at timestamptz,
  last_overdue_notice date,
  sm_overdue_alerted boolean not null default false,
  created_at timestamptz not null default now(),
  constraint returnable_needs_date check (sample_type <> 'returnable' or expected_return_date is not null)
);
create index on public.samples (sales_person_id, status);
create trigger audit_samples after insert or update on public.samples for each row execute function app.audit();

create table public.sample_items (
  id uuid primary key default gen_random_uuid(),
  sample_id uuid not null references public.samples (id) on delete cascade,
  description text not null,
  product_code text,
  brand text,
  quantity numeric(10, 2) not null check (quantity > 0),
  quantity_available numeric(10, 2),
  unit_value numeric(16, 2) not null default 0,
  total_value numeric(16, 2) generated always as (quantity * unit_value) stored
);

create or replace function app.samples_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform app.require(auth.uid() is null or app.is_sales_person(), 'Only sales people can request samples');
    new.code := coalesce(new.code, app.next_code('SMP'));
    new.sales_person_id := coalesce(auth.uid(), new.sales_person_id);
    if auth.uid() is not null then new.status := 'draft'; end if;
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and current_setting('app.workflow', true) is distinct from '1'
     and new.status is distinct from old.status then
    raise exception 'Sample status changes only through workflow actions';
  end if;
  select p.name, o.name, p.organization_id into new.project_name, new.client_name, new.organization_id
  from public.projects p join public.organizations o on o.id = p.organization_id where p.id = new.project_id;
  if tg_op = 'UPDATE' and auth.uid() = old.sales_person_id and old.status not in ('draft', 'returned_for_changes')
     and current_setting('app.workflow', true) is distinct from '1' then
    raise exception 'Submitted sample requests cannot be edited';
  end if;
  return new;
end $$;
create trigger samples_before before insert or update on public.samples for each row execute function app.samples_before();

create or replace function app.sample_total() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.samples set total_value = (select coalesce(sum(total_value), 0) from public.sample_items where sample_id = coalesce(new.sample_id, old.sample_id))
  where id = coalesce(new.sample_id, old.sample_id);
  return null;
end $$;
create trigger sample_items_total after insert or update or delete on public.sample_items for each row execute function app.sample_total();

create or replace function public.submit_sample(p_sample uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.sales_person_id = auth.uid(), 'Only the requester can submit');
  perform app.require(s.status in ('draft', 'returned_for_changes'), 'Already submitted');
  perform app.require(exists (select 1 from public.sample_items where sample_id = s.id), 'Add at least one item');
  perform set_config('app.workflow', '1', true);
  update public.samples set status = 'submitted', submitted_at = now() where id = s.id;
  perform app.notify_many(app.role_users('operations_exec'), 'sample_request', 'Sample request ' || s.code,
    format('%s – %s. Needed %s', s.project_name, s.client_name, to_char(s.required_by at time zone app.tz(), 'DD Mon HH24:MI')),
    'normal', 'sample', s.id, '/samples/' || s.id, null, true);
end $$;

create or replace function public.check_sample_availability(p_sample uuid, p_availability text, p_note text default null,
                                                            p_quantities jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.samples; q record;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive checks availability');
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.status = 'submitted', 'Request is not waiting for an availability check');
  perform app.require(p_availability <> 'not_available' or p_note is not null, 'Give the reason / expected date');
  if p_quantities is not null then
    for q in select key::uuid as item, value::numeric as qty from jsonb_each_text(p_quantities) loop
      update public.sample_items set quantity_available = q.qty where id = q.item and sample_id = s.id;
    end loop;
  end if;
  perform set_config('app.workflow', '1', true);
  update public.samples set availability = p_availability, availability_note = p_note, availability_checked_at = now(),
    status = case when p_availability = 'not_available' then 'not_available' else 'availability_confirmed' end
  where id = s.id;
  if p_availability <> 'not_available' then
    perform app.notify_many(app.role_users('sm_projects'), 'sample_request', 'Approve sample request ' || s.code,
      format('%s – %s (%s)', s.project_name, s.client_name, replace(p_availability, '_', ' ')), 'normal', 'sample', s.id, '/samples/' || s.id, null, true);
  end if;
  perform app.notify(s.sales_person_id, 'sample_step', 'Sample availability: ' || replace(p_availability, '_', ' '),
    coalesce(p_note, s.code), 'normal', 'sample', s.id, '/samples/' || s.id);
end $$;

create or replace function public.decide_sample(p_sample uuid, p_decision text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'Only SM Projects approves sample requests');
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.status = 'availability_confirmed', 'Request is not waiting for approval');
  perform app.require(p_decision in ('approved', 'rejected', 'returned_for_changes'), 'Invalid decision');
  perform app.require(p_decision = 'approved' or coalesce(trim(p_comment), '') <> '', 'A reason is required');
  perform set_config('app.workflow', '1', true);
  update public.samples set status = p_decision, approved_by = auth.uid(), approved_at = now(), approval_comment = p_comment where id = s.id;
  perform app.notify_many(array[s.sales_person_id] || app.role_users('operations_exec'), 'sample_step',
    format('Sample request %s %s', s.code, replace(p_decision, '_', ' ')), coalesce(p_comment, ''), 'normal', 'sample', s.id, '/samples/' || s.id);
end $$;

create or replace function public.record_sample_handover(p_sample uuid, p_handed_over_by text, p_received_by text, p_at timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive records the handover');
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.status = 'approved', 'Sample must be approved first');
  perform app.require(app.has_attachment('sample', s.id, 'delivery_note'), 'Attach a photo or the signed delivery note');
  perform set_config('app.workflow', '1', true);
  update public.samples set handed_over_at = p_at, handed_over_by = p_handed_over_by, received_by = p_received_by,
    status = case when sample_type = 'returnable' then 'out' else 'closed' end where id = s.id;
  perform app.notify_many(array[s.sales_person_id] || app.role_users('sm_projects'), 'sample_step', 'Sample handed over: ' || s.code,
    format('Received by %s', p_received_by), 'normal', 'sample', s.id, '/samples/' || s.id);
end $$;

create or replace function public.record_sample_return(p_sample uuid, p_condition text, p_at timestamptz default now(), p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive records returns');
  select * into s from public.samples where id = p_sample for update;
  perform app.require(s.status = 'out', 'Sample is not out');
  perform set_config('app.workflow', '1', true);
  update public.samples set returned_at = p_at, return_condition = p_condition,
    status = case when p_condition = 'good' then 'returned' else 'damaged_lost' end, notes = coalesce(p_note, notes) where id = s.id;
  if p_condition <> 'good' then
    perform app.notify_many(app.role_users('sm_projects'), 'sample_damaged', 'Sample returned ' || p_condition || ': ' || s.code,
      coalesce(p_note, ''), 'normal', 'sample', s.id, '/samples/' || s.id);
  end if;
  perform app.notify(s.sales_person_id, 'sample_step', 'Sample returned: ' || s.code, p_condition, 'normal', 'sample', s.id, '/samples/' || s.id);
end $$;

create or replace function public.request_sample_return_date(p_sample uuid, p_new_date date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.samples;
begin
  select * into s from public.samples where id = p_sample;
  perform app.require(s.sales_person_id = auth.uid(), 'Only the requester can ask for a new return date');
  perform app.require(s.status = 'out', 'Sample is not out');
  return app.create_approval('sample_return_date', 'sample', s.id, null, format('New return date – %s', s.code), p_reason,
    array['sm_projects']::public.app_role[], jsonb_build_object('new_date', p_new_date, 'old_date', s.expected_return_date));
end $$;

-- Pending approvals for the current user (all kinds, one list – "Approvals tab")
create or replace function public.my_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
  select 'approval', a.id, a.kind::text, a.title, a.reason, a.requested_by, app.display_name(a.requested_by), a.requested_at,
         a.inquiry_id, case when a.inquiry_id is not null then app.inquiry_url(a.inquiry_id) else '/approvals' end,
         format('Step %s of %s', a.current_step, (select count(*) from public.approval_steps x where x.approval_id = a.id))
  from public.approvals a
  join public.approval_steps s on s.approval_id = a.id and s.step_no = a.current_step
  where a.status = 'pending' and (s.approver_role = app.my_role() or (app.my_role() = 'gm' and s.approver_role = 'gm'))
  union all
  select 'visit_plan', p.id, 'weekly_plan', format('Weekly plan – %s – week of %s', app.display_name(p.sales_person_id), to_char(p.week_start, 'DD Mon')),
         case when p.is_late then 'Submitted late' end, p.sales_person_id, app.display_name(p.sales_person_id), p.submitted_at,
         null, '/plan/' || p.id, null
  from public.visit_plans p where p.status = 'submitted' and app.has_role('sm_projects', 'gm')
  union all
  select 'design_review', d.id, 'design_release', format('Design review – %s (%s)', i.code, d.task_type), i.project_name,
         d.assignee_id, app.display_name(d.assignee_id), d.submitted_at, i.id, '/design/' || d.id, null
  from public.design_jobs d join public.inquiries i on i.id = d.inquiry_id
  where d.status = 'in_review' and app.has_role('design_manager')
  union all
  select 'quotation_review', e.id, 'quotation_release', format('Quotation approval – %s', i.code), i.project_name,
         e.assignee_id, app.display_name(e.assignee_id), e.submitted_at, i.id, '/estimation/' || e.id, null
  from public.estimation_jobs e join public.inquiries i on i.id = e.inquiry_id
  where e.status = 'submitted_for_approval' and app.has_role('sm_estimation')
  union all
  select 'sample', sm.id, 'sample_request', format('Sample request %s', sm.code), sm.purpose,
         sm.sales_person_id, app.display_name(sm.sales_person_id), sm.submitted_at, null, '/samples/' || sm.id, sm.status
  from public.samples sm
  where (sm.status = 'submitted' and app.has_role('operations_exec'))
     or (sm.status = 'availability_confirmed' and app.has_role('sm_projects'))
  order by 8
$$;
