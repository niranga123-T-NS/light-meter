-- Finance: budgeted project list, secured projects (order book) with invoice schedules, the monthly OR file (P&L and
-- invoicing by WBS) and sales targets (secured and invoiced).
--
--   * Business lines: Infrastructure, Building Lighting – LMS, Building Lighting – Indoor.
--   * The Operations Executive uploads the budgeted project list for the financial year (April – March), the opening
--     secured list (orders won before the system) and the monthly OR file. SM Projects and GM / DGM can do the same.
--   * A project set to Won (inquiry result or tender award) joins the secured list automatically. The sales person enters
--     the invoice schedule (several invoices per project); SM Projects reviews it. On approval the original months are
--     fixed; the secured credit for the sales person = the part of the order due to invoice in the financial year it was won.
--   * Invoice dates move with a reason. Moves of an invoice due this month (or earlier) or out of the financial year wait
--     for SM Projects; other moves are recorded.
--   * Each OR upload gives invoicing by WBS. It is allocated to the project's invoice lines, oldest first.
--   * Targets per sales person and month (secured and invoicing) are set by SM Projects and approved by GM / DGM.
--     Score = 40 % secured + 60 % invoiced.
--   * P&L: GM / DGM, SM Projects and SM Estimation. Budget, secured and invoicing: also Operations; sales see their own.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function app.fy_of(d date) returns int
language sql immutable as $$ select case when extract(month from d) >= 4 then extract(year from d)::int else extract(year from d)::int - 1 end $$;
create or replace function app.fy_start(fy int) returns date language sql immutable as $$ select make_date(fy, 4, 1) $$;
create or replace function app.fy_end(fy int) returns date language sql immutable as $$ select make_date(fy + 1, 3, 31) $$;
create or replace function app.month_of(d date) returns date language sql immutable as $$ select date_trunc('month', d)::date $$;

-- 'Infrastructure', 'Building Lighting – LMS', 'LMS', 'Indoor' … → infrastructure / lms / indoor
create or replace function app.norm_line(t text) returns text
language sql immutable as $$
  select case
    when t is null or btrim(t) = '' then null
    when lower(t) ~ 'infra' then 'infrastructure'
    when lower(t) ~ '(^|[^a-z])lms([^a-z]|$)|control' then 'lms'
    when lower(t) ~ 'indoor' then 'indoor'
    else null end
$$;
create or replace function app.line_label(t text) returns text language sql immutable as $$
  select case t when 'infrastructure' then 'Infrastructure' when 'lms' then 'Building Lighting – LMS'
                when 'indoor' then 'Building Lighting – Indoor' else '—' end $$;
-- WBS LS-000116-01-04 → LS-000116
create or replace function app.wbs_base(t text) returns text language sql immutable as $$
  select nullif(upper(coalesce(substring(btrim(t) from '^([A-Za-z]+-[0-9]+)'), btrim(t))), '') $$;

create or replace function app.sees_finance() returns boolean
language sql stable security definer set search_path = public as $$ select app.has_role('gm', 'sm_projects', 'sm_estimation', 'operations_exec') $$;
create or replace function app.sees_pnl() returns boolean
language sql stable security definer set search_path = public as $$ select app.has_role('gm', 'sm_projects', 'sm_estimation') $$;
create or replace function app.is_finance_desk() returns boolean
language sql stable security definer set search_path = public as $$ select app.has_role('gm', 'sm_projects', 'operations_exec') $$;

create or replace function app.find_person(p_name text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles
   where active and lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g'))
   order by (role in ('asm_building', 'asm_infra')) desc limit 1
$$;

create or replace function app.secured_url(p uuid) returns text language sql immutable as $$ select '/finance/secured/' || p $$;

-- ---------------------------------------------------------------------------
-- Budgeted project list
-- ---------------------------------------------------------------------------
create table public.budget_projects (
  id uuid primary key default gen_random_uuid(),
  fy int not null,
  row_no int,
  business_line text not null check (business_line in ('infrastructure', 'lms', 'indoor')),
  project_id uuid references public.projects (id) on delete set null,
  project_name text not null,
  customer text,
  sales_person_id uuid references public.profiles (id),
  wbs text,
  budget_value numeric(16, 2) not null check (budget_value >= 0),
  budget_gp_pct numeric(6, 2),
  order_month date,
  notes text,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.budget_projects (fy, sales_person_id);
create index on public.budget_projects (fy, project_id);

create table public.budget_invoices (
  id bigint generated always as identity primary key,
  budget_id uuid not null references public.budget_projects (id) on delete cascade,
  month date not null,
  amount numeric(16, 2) not null check (amount >= 0)
);
create index on public.budget_invoices (budget_id);

-- ---------------------------------------------------------------------------
-- Secured projects (order book) and invoice schedules
-- ---------------------------------------------------------------------------
create table public.secured_projects (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  project_id uuid unique references public.projects (id) on delete set null,
  project_name text not null,
  customer text,
  business_line text check (business_line in ('infrastructure', 'lms', 'indoor')),
  sales_person_id uuid references public.profiles (id),
  wbs text,
  po_no text,
  order_value numeric(16, 2) check (order_value is null or order_value >= 0),   -- LKR
  won_on date not null,
  source text not null default 'won' check (source in ('won', 'opening')),
  billed_before numeric(16, 2) not null default 0,     -- opening list: invoiced before the financial year
  budget_id uuid references public.budget_projects (id) on delete set null,
  schedule_status text not null default 'missing' check (schedule_status in ('missing', 'review', 'approved')),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id),
  review_note text,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  notes text,
  schedule_alerted boolean not null default false,
  review_alerted boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index secured_projects_wbs on public.secured_projects (app.wbs_base(wbs)) where wbs is not null;
create index on public.secured_projects (sales_person_id, status);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  secured_id uuid not null references public.secured_projects (id) on delete cascade,
  seq int not null default 1,
  kind text not null default 'other'
    check (kind in ('advance', 'delivery', 'progress', 'tc', 'handover', 'retention', 'variation', 'other')),
  description text,
  trigger_note text,
  amount numeric(16, 2) not null check (amount > 0),
  original_month date not null,
  forecast_month date not null,
  moves int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.invoice_lines (secured_id, seq);
create index on public.invoice_lines (forecast_month);

create table public.invoice_line_changes (
  id bigint generated always as identity primary key,
  line_id uuid not null references public.invoice_lines (id) on delete cascade,
  from_month date not null,
  to_month date not null,
  reason text not null,
  note text,
  status text not null check (status in ('recorded', 'pending', 'approved', 'rejected')),
  requested_by uuid default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text
);
create index on public.invoice_line_changes (line_id);
create unique index invoice_line_changes_one_pending on public.invoice_line_changes (line_id) where status = 'pending';

create table public.secured_log (
  id bigint generated always as identity primary key,
  secured_id uuid not null references public.secured_projects (id) on delete cascade,
  action text not null,
  note text,
  by_user uuid default auth.uid() references public.profiles (id),
  at timestamptz not null default now()
);
create index on public.secured_log (secured_id);

-- ---------------------------------------------------------------------------
-- Monthly OR file
-- ---------------------------------------------------------------------------
create table public.or_uploads (
  id uuid primary key default gen_random_uuid(),
  month date not null unique,
  fy int not null,
  file_name text,
  net_turnover numeric(16, 2),
  net_profit numeric(16, 2),
  invoiced_wbs numeric(16, 2),
  uploaded_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.pnl_lines (
  upload_id uuid not null references public.or_uploads (id) on delete cascade,
  seq int not null,
  section text not null check (section in ('capital', 'kpi', 'shared', 'pnl')),
  label text not null,
  rank text,
  ly_cum numeric(18, 2),
  m_act numeric(18, 2),
  m_bud numeric(18, 2),
  c_act numeric(18, 2),
  c_bud numeric(18, 2),
  fy_bp numeric(18, 2),
  primary key (upload_id, seq)
);

create table public.wbs_actuals (
  upload_id uuid not null references public.or_uploads (id) on delete cascade,
  wbs text not null,
  revenue numeric(16, 2) not null default 0,
  cost numeric(16, 2) not null default 0,
  primary key (upload_id, wbs)
);

create table public.invoice_allocations (
  id bigint generated always as identity primary key,
  upload_id uuid not null references public.or_uploads (id) on delete cascade,
  month date not null,
  secured_id uuid not null references public.secured_projects (id) on delete cascade,
  line_id uuid references public.invoice_lines (id) on delete set null,
  amount numeric(16, 2) not null,
  manual boolean not null default false
);
create index on public.invoice_allocations (secured_id);
create index on public.invoice_allocations (line_id);

-- ---------------------------------------------------------------------------
-- Sales targets
-- ---------------------------------------------------------------------------
create table public.target_sets (
  fy int primary key,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'returned')),
  submitted_by uuid references public.profiles (id),
  submitted_at timestamptz,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  note text
);

create table public.sales_targets (
  fy int not null,
  sales_person_id uuid not null references public.profiles (id),
  month date not null,
  secured_target numeric(16, 2) not null default 0 check (secured_target >= 0),
  invoice_target numeric(16, 2) not null default 0 check (invoice_target >= 0),
  primary key (fy, sales_person_id, month)
);

-- ---------------------------------------------------------------------------
-- Row-level security (all writes go through the functions below)
-- ---------------------------------------------------------------------------
alter table public.budget_projects enable row level security;
alter table public.budget_invoices enable row level security;
alter table public.secured_projects enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_line_changes enable row level security;
alter table public.secured_log enable row level security;
alter table public.or_uploads enable row level security;
alter table public.pnl_lines enable row level security;
alter table public.wbs_actuals enable row level security;
alter table public.invoice_allocations enable row level security;
alter table public.target_sets enable row level security;
alter table public.sales_targets enable row level security;

create policy budget_read on public.budget_projects for select to authenticated
  using (app.sees_finance() or sales_person_id = auth.uid());
create policy budget_inv_read on public.budget_invoices for select to authenticated
  using (exists (select 1 from public.budget_projects b where b.id = budget_id));
create policy secured_read on public.secured_projects for select to authenticated
  using (app.sees_finance() or sales_person_id = auth.uid());
create policy inv_lines_read on public.invoice_lines for select to authenticated
  using (exists (select 1 from public.secured_projects s where s.id = secured_id));
create policy inv_changes_read on public.invoice_line_changes for select to authenticated
  using (exists (select 1 from public.invoice_lines l where l.id = line_id));
create policy secured_log_read on public.secured_log for select to authenticated
  using (exists (select 1 from public.secured_projects s where s.id = secured_id));
create policy or_uploads_read on public.or_uploads for select to authenticated using (app.sees_finance());
create policy pnl_read on public.pnl_lines for select to authenticated using (app.sees_pnl());
create policy wbs_read on public.wbs_actuals for select to authenticated using (app.sees_pnl());
create policy alloc_read on public.invoice_allocations for select to authenticated
  using (exists (select 1 from public.secured_projects s where s.id = secured_id));
create policy target_sets_read on public.target_sets for select to authenticated using (true);
create policy targets_read on public.sales_targets for select to authenticated
  using (app.has_role('gm', 'sm_projects', 'sm_estimation') or sales_person_id = auth.uid());

grant select on public.budget_projects, public.budget_invoices, public.secured_projects, public.invoice_lines,
  public.invoice_line_changes, public.secured_log, public.or_uploads, public.pnl_lines, public.wbs_actuals,
  public.invoice_allocations, public.target_sets, public.sales_targets to authenticated;

-- Invoice lines with what has been invoiced against them
create view public.invoice_line_status with (security_invoker = true) as
  select l.*, s.sales_person_id, s.project_name, s.customer, s.business_line, s.schedule_status, s.status as project_status,
         coalesce(a.invoiced, 0) as invoiced,
         l.amount - coalesce(a.invoiced, 0) as remaining,
         (select c.id from public.invoice_line_changes c where c.line_id = l.id and c.status = 'pending') as pending_change_id,
         (select c.to_month from public.invoice_line_changes c where c.line_id = l.id and c.status = 'pending') as pending_month
    from public.invoice_lines l
    join public.secured_projects s on s.id = l.secured_id
    left join (select line_id, sum(amount) as invoiced from public.invoice_allocations where line_id is not null group by line_id) a
      on a.line_id = l.id;
grant select on public.invoice_line_status to authenticated;

-- ---------------------------------------------------------------------------
-- Allocation of invoicing (OR file, by WBS) to invoice lines – oldest first
-- ---------------------------------------------------------------------------
create or replace function app.reallocate(p_secured uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.secured_projects;
  w record;
  l record;
  rest numeric;
  take numeric;
begin
  select * into s from public.secured_projects where id = p_secured;
  if s.id is null then return; end if;
  delete from public.invoice_allocations where secured_id = s.id and not manual;
  if s.wbs is null then return; end if;
  for w in
    select u.id as upload_id, u.month, a.revenue
           - coalesce((select sum(m.amount) from public.invoice_allocations m where m.upload_id = u.id and m.secured_id = s.id and m.manual), 0) as revenue
      from public.wbs_actuals a join public.or_uploads u on u.id = a.upload_id
     where a.wbs = app.wbs_base(s.wbs)
     order by u.month
  loop
    rest := w.revenue;
    if rest > 0 then
      for l in
        select il.id, il.amount - coalesce((select sum(x.amount) from public.invoice_allocations x where x.line_id = il.id), 0) as open_amt
          from public.invoice_lines il where il.secured_id = s.id
         order by il.forecast_month, il.original_month, il.seq
      loop
        exit when rest <= 0;
        if l.open_amt > 0 then
          take := least(l.open_amt, rest);
          insert into public.invoice_allocations (upload_id, month, secured_id, line_id, amount) values (w.upload_id, w.month, s.id, l.id, take);
          rest := rest - take;
        end if;
      end loop;
    end if;
    -- More than scheduled, or a credit note: kept against the project, not a line
    if rest <> 0 then
      insert into public.invoice_allocations (upload_id, month, secured_id, line_id, amount) values (w.upload_id, w.month, s.id, null, rest);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Budgeted project list: check, then save (replaces the year's list)
-- ---------------------------------------------------------------------------
-- p_rows: [{row_no, business_line, project_name, customer, sales_person, wbs, budget_value, budget_gp_pct, order_month,
--           invoices: [{month, amount}]}]
create or replace function public.check_budget_list(p_fy int, p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
  out jsonb := '[]';
  errs text[];
  warns text[];
  sp uuid;
  pid uuid;
  inv numeric;
  val numeric;
  m date;
  x jsonb;
begin
  perform app.require(app.is_finance_desk(), 'Only Operations, SM Projects or GM / DGM upload the budget list');
  perform app.require(p_fy between 2020 and 2100, 'Choose the financial year');
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    errs := '{}'; warns := '{}'; sp := null; pid := null;
    if coalesce(btrim(r ->> 'project_name'), '') = '' then errs := errs || 'Project name missing'::text; end if;
    if app.norm_line(r ->> 'business_line') is null then
      errs := errs || ('Business line "' || coalesce(r ->> 'business_line', '') || '" – use Infrastructure, Building Lighting – LMS or Building Lighting – Indoor')::text;
    end if;
    if coalesce(btrim(r ->> 'sales_person'), '') = '' then errs := errs || 'Sales person missing'::text;
    else
      sp := app.find_person(r ->> 'sales_person');
      if sp is null then errs := errs || ('Sales person "' || (r ->> 'sales_person') || '" not found in the system')::text; end if;
    end if;
    begin val := nullif(r ->> 'budget_value', '')::numeric; exception when others then val := null; end;
    if val is null or val < 0 then errs := errs || 'Budget value missing or not a number'::text; end if;
    inv := 0;
    for x in select * from jsonb_array_elements(coalesce(r -> 'invoices', '[]')) loop
      begin
        m := (x ->> 'month')::date;
        inv := inv + (x ->> 'amount')::numeric;
        if m < app.fy_start(p_fy) or m > app.fy_end(p_fy) + 366 then warns := warns || ('Invoice month ' || to_char(m, 'Mon YYYY') || ' is outside the year')::text; end if;
      exception when others then errs := errs || 'An invoice month or amount is not valid'::text;
      end;
    end loop;
    if val is not null and inv > val + 1 then errs := errs || 'Invoice amounts add up to more than the budget value'::text; end if;
    if val is not null and jsonb_array_length(coalesce(r -> 'invoices', '[]')) = 0 then warns := warns || 'No invoice months – invoicing target will be empty for this project'::text; end if;
    select id into pid from public.projects where name_norm = app.normalize_name(r ->> 'project_name') and status <> 'cancelled' limit 1;
    if pid is null then warns := warns || 'Not matched to a project in the system (kept as a name)'::text; end if;
    out := out || jsonb_build_object('row_no', r -> 'row_no', 'errors', to_jsonb(errs), 'warnings', to_jsonb(warns),
      'sales_person_id', sp, 'project_id', pid, 'business_line', app.norm_line(r ->> 'business_line'));
  end loop;
  return out;
end $$;

create or replace function public.save_budget_list(p_fy int, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  chk jsonb := public.check_budget_list(p_fy, p_rows);
  r jsonb;
  c jsonb;
  bid uuid;
  n int := 0;
  x jsonb;
begin
  perform app.require(not exists (select 1 from jsonb_array_elements(chk) e where jsonb_array_length(e -> 'errors') > 0),
    'Some rows have errors – fix them in the file and upload again');
  delete from public.budget_projects where fy = p_fy;
  for r, c in select a.value, b.value from jsonb_array_elements(p_rows) with ordinality a(value, i)
                join jsonb_array_elements(chk) with ordinality b(value, j) on a.i = b.j loop
    insert into public.budget_projects (fy, row_no, business_line, project_id, project_name, customer, sales_person_id, wbs,
      budget_value, budget_gp_pct, order_month, notes)
    values (p_fy, (r ->> 'row_no')::int, c ->> 'business_line', (c ->> 'project_id')::uuid, btrim(r ->> 'project_name'),
      nullif(btrim(r ->> 'customer'), ''), (c ->> 'sales_person_id')::uuid, app.wbs_base(nullif(r ->> 'wbs', '')),
      (r ->> 'budget_value')::numeric, nullif(r ->> 'budget_gp_pct', '')::numeric,
      app.month_of(nullif(r ->> 'order_month', '')::date), nullif(btrim(r ->> 'notes'), ''))
    returning id into bid;
    for x in select * from jsonb_array_elements(coalesce(r -> 'invoices', '[]')) loop
      insert into public.budget_invoices (budget_id, month, amount) values (bid, app.month_of((x ->> 'month')::date), (x ->> 'amount')::numeric);
    end loop;
    n := n + 1;
  end loop;
  -- Re-link secured projects of the year to their budget line
  update public.secured_projects s set budget_id = b.id
    from public.budget_projects b
   where b.fy = p_fy and s.budget_id is null and app.fy_of(s.won_on) >= p_fy - 1
     and ((b.project_id is not null and b.project_id = s.project_id) or (b.wbs is not null and b.wbs = app.wbs_base(s.wbs)));
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Opening secured list (orders won before the system) – check, then save (adds or updates by WBS / project name)
-- ---------------------------------------------------------------------------
-- p_rows: [{row_no, project_name, customer, business_line, sales_person, po_no, wbs, order_value, won_on, billed_before,
--           invoices: [{month, amount}]}]
create or replace function public.check_opening_list(p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
  out jsonb := '[]';
  errs text[];
  warns text[];
  sp uuid;
  pid uuid;
  existing uuid;
  val numeric;
  before numeric;
  inv numeric;
  x jsonb;
begin
  perform app.require(app.is_finance_desk(), 'Only Operations, SM Projects or GM / DGM upload the secured list');
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    errs := '{}'; warns := '{}'; sp := null; pid := null; existing := null;
    if coalesce(btrim(r ->> 'project_name'), '') = '' then errs := errs || 'Project name missing'::text; end if;
    if app.norm_line(r ->> 'business_line') is null then
      errs := errs || ('Business line "' || coalesce(r ->> 'business_line', '') || '" – use Infrastructure, Building Lighting – LMS or Building Lighting – Indoor')::text;
    end if;
    if coalesce(btrim(r ->> 'sales_person'), '') = '' then errs := errs || 'Sales person missing'::text;
    else
      sp := app.find_person(r ->> 'sales_person');
      if sp is null then errs := errs || ('Sales person "' || (r ->> 'sales_person') || '" not found in the system')::text; end if;
    end if;
    begin val := nullif(r ->> 'order_value', '')::numeric; exception when others then val := null; end;
    begin before := coalesce(nullif(r ->> 'billed_before', '')::numeric, 0); exception when others then before := null; end;
    if val is null or val <= 0 then errs := errs || 'Order value missing or not a number'::text; end if;
    if before is null or before < 0 then errs := errs || 'Invoiced before 1 April is not a number'::text; end if;
    if coalesce(r ->> 'won_on', '') = '' then errs := errs || 'Won (PO) date missing'::text;
    else
      begin perform (r ->> 'won_on')::date; exception when others then errs := errs || 'Won date is not a date'::text; end;
    end if;
    inv := 0;
    begin
      for x in select * from jsonb_array_elements(coalesce(r -> 'invoices', '[]')) loop
        perform (x ->> 'month')::date;
        if (x ->> 'amount')::numeric <= 0 then raise exception 'amount'; end if;
        inv := inv + (x ->> 'amount')::numeric;
      end loop;
    exception when others then errs := errs || 'An invoice month or amount is not valid'::text;
    end;
    if val is not null and before is not null and abs(before + inv - val) > 1 then
      errs := errs || format('Invoiced before (%s) + invoices still to do (%s) must equal the order value (%s)',
        to_char(before, 'FM999,999,999,990'), to_char(inv, 'FM999,999,999,990'), to_char(val, 'FM999,999,999,990'))::text;
    end if;
    if coalesce(btrim(r ->> 'wbs'), '') = '' then warns := warns || 'No WBS – invoicing from the OR file cannot be matched until it is added'::text; end if;
    select id into pid from public.projects where name_norm = app.normalize_name(r ->> 'project_name') and status <> 'cancelled' limit 1;
    select id into existing from public.secured_projects
     where (nullif(r ->> 'wbs', '') is not null and app.wbs_base(wbs) = app.wbs_base(r ->> 'wbs'))
        or (pid is not null and project_id = pid)
        or (lower(project_name) = lower(btrim(r ->> 'project_name')) and lower(coalesce(customer, '')) = lower(coalesce(btrim(r ->> 'customer'), '')))
     limit 1;
    if existing is not null then
      if (select source from public.secured_projects where id = existing) = 'won' then
        errs := errs || 'Already secured in the system (won through the system) – not changed from the opening list'::text;
      else
        warns := warns || 'Already in the opening list – it will be updated'::text;
      end if;
    end if;
    out := out || jsonb_build_object('row_no', r -> 'row_no', 'errors', to_jsonb(errs), 'warnings', to_jsonb(warns),
      'sales_person_id', sp, 'project_id', pid, 'secured_id', existing, 'business_line', app.norm_line(r ->> 'business_line'));
  end loop;
  return out;
end $$;

create or replace function public.save_opening_list(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  chk jsonb := public.check_opening_list(p_rows);
  r jsonb;
  c jsonb;
  sid uuid;
  n int := 0;
  x jsonb;
  i int;
begin
  perform app.require(not exists (select 1 from jsonb_array_elements(chk) e where jsonb_array_length(e -> 'errors') > 0),
    'Some rows have errors – fix them in the file and upload again');
  for r, c in select a.value, b.value from jsonb_array_elements(p_rows) with ordinality a(value, i)
                join jsonb_array_elements(chk) with ordinality b(value, j) on a.i = b.j loop
    sid := (c ->> 'secured_id')::uuid;
    if sid is null then
      insert into public.secured_projects (code, project_id, project_name, customer, business_line, sales_person_id, wbs, po_no,
        order_value, won_on, source, billed_before, schedule_status, approved_at, approved_by)
      values (app.next_code('SEC'), (c ->> 'project_id')::uuid, btrim(r ->> 'project_name'), nullif(btrim(r ->> 'customer'), ''),
        c ->> 'business_line', (c ->> 'sales_person_id')::uuid, app.wbs_base(nullif(r ->> 'wbs', '')), nullif(btrim(r ->> 'po_no'), ''),
        (r ->> 'order_value')::numeric, (r ->> 'won_on')::date, 'opening', coalesce(nullif(r ->> 'billed_before', '')::numeric, 0),
        'approved', now(), auth.uid())
      returning id into sid;
      insert into public.secured_log (secured_id, action, note) values (sid, 'opening', 'Loaded from the opening secured list');
    else
      update public.secured_projects set project_id = coalesce(project_id, (c ->> 'project_id')::uuid), project_name = btrim(r ->> 'project_name'),
        customer = nullif(btrim(r ->> 'customer'), ''), business_line = c ->> 'business_line', sales_person_id = (c ->> 'sales_person_id')::uuid,
        wbs = app.wbs_base(nullif(r ->> 'wbs', '')), po_no = nullif(btrim(r ->> 'po_no'), ''), order_value = (r ->> 'order_value')::numeric,
        won_on = (r ->> 'won_on')::date, billed_before = coalesce(nullif(r ->> 'billed_before', '')::numeric, 0), updated_at = now()
       where id = sid;
      delete from public.invoice_lines where secured_id = sid;
      insert into public.secured_log (secured_id, action, note) values (sid, 'opening', 'Updated from the opening secured list');
    end if;
    i := 0;
    for x in select * from jsonb_array_elements(coalesce(r -> 'invoices', '[]')) loop
      i := i + 1;
      insert into public.invoice_lines (secured_id, seq, kind, description, amount, original_month, forecast_month)
      values (sid, i, coalesce(nullif(x ->> 'kind', ''), 'other'), nullif(x ->> 'description', ''), (x ->> 'amount')::numeric,
        app.month_of((x ->> 'month')::date), app.month_of((x ->> 'month')::date));
    end loop;
    update public.secured_projects s set budget_id = b.id from public.budget_projects b
     where s.id = sid and s.budget_id is null and b.fy = app.fy_of(current_date)
       and ((b.project_id is not null and b.project_id = s.project_id) or (b.wbs is not null and b.wbs = s.wbs));
    perform app.reallocate(sid);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- A project set to Won joins the secured list
-- ---------------------------------------------------------------------------
create or replace function app.secure_project(p_project uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p public.projects;
  sid uuid;
  val numeric;
  won date;
  b public.budget_projects;
  line text;
  cust text;
begin
  select * into p from public.projects where id = p_project;
  if p.id is null then return null; end if;
  select id into sid from public.secured_projects where project_id = p.id;
  if sid is not null then return sid; end if;
  select sum(app.to_lkr(order_value, currency, order_date)), max(order_date) into val, won
    from public.inquiries where project_id = p.id and result = 'won' and order_value is not null;
  won := coalesce(won, current_date);
  select * into b from public.budget_projects
   where fy = app.fy_of(won) and (project_id = p.id or (project_id is null and lower(project_name) = lower(p.name)))
   order by (project_id = p.id) desc nulls last limit 1;
  line := coalesce(b.business_line, case when p.project_type in ('infrastructure', 'industrial') then 'infrastructure' end);
  select name into cust from public.organizations where id = p.organization_id;
  insert into public.secured_projects (code, project_id, project_name, customer, business_line, sales_person_id, wbs, order_value, won_on,
    source, budget_id)
  values (app.next_code('SEC'), p.id, p.name, cust, line, p.owner_id, b.wbs, round(val, 2), won, 'won', b.id)
  returning id into sid;
  insert into public.secured_log (secured_id, action, note)
  values (sid, 'won', 'Project won' || case when val is not null then ' · order value ' || app.fmt_money(val, 'LKR') else '' end);
  perform app.notify(p.owner_id, 'secured_schedule', 'Project won – enter the invoice schedule',
    p.name || ' · add the invoices (advance, delivery, progress bills, retention …) so they count toward your target',
    'normal', 'secured_project', sid, app.secured_url(sid));
  perform app.notify_many(app.role_users('sm_projects'), 'secured_new',
    case when b.id is null then 'Unbudgeted win' else 'Budgeted project won' end,
    p.name || ' · ' || coalesce(app.display_name(p.owner_id), '—') || coalesce(' · ' || app.fmt_money(val, 'LKR'), ''),
    'normal', 'secured_project', sid, app.secured_url(sid));
  return sid;
end $$;

create or replace function app.projects_won_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.milestone = 'won' and old.milestone is distinct from 'won' then
    perform app.secure_project(new.id);
  end if;
  return new;
end $$;
create trigger projects_won_secured after update of milestone on public.projects
  for each row execute function app.projects_won_trg();

-- ---------------------------------------------------------------------------
-- Invoice schedule: the sales person (or Operations / SM Projects) enters it, SM Projects approves
-- ---------------------------------------------------------------------------
create or replace function app.can_edit_secured(s public.secured_projects) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_finance_desk() or s.sales_person_id = auth.uid()
$$;

-- p_data: {business_line, order_value, wbs, po_no, notes}; p_lines: [{id?, kind, description, trigger_note, amount, month}]
create or replace function public.save_invoice_schedule(p_secured uuid, p_data jsonb, p_lines jsonb, p_submit boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.secured_projects;
  approved boolean;
  manager boolean := app.has_role('sm_projects', 'gm');
  x jsonb;
  i int := 0;
  keep uuid[] := '{}';
  lid uuid;
  total numeric := 0;
  m date;
begin
  select * into s from public.secured_projects where id = p_secured for update;
  perform app.require(s.id is not null, 'Secured project not found');
  perform app.require(app.can_edit_secured(s), 'Only the sales person, Operations or SM Projects edit the invoice schedule');
  perform app.require(s.status = 'open', 'The project is closed');
  approved := s.schedule_status = 'approved';
  perform app.require(not approved or app.is_finance_desk(),
    'The schedule is approved – move an invoice date with a reason, or ask SM Projects / Operations for a variation');
  if p_data ? 'business_line' then
    perform app.require(p_data ->> 'business_line' is null or app.norm_line(p_data ->> 'business_line') is not null, 'Choose the business line');
  end if;
  update public.secured_projects set
    business_line = case when p_data ? 'business_line' then app.norm_line(p_data ->> 'business_line') else business_line end,
    order_value = case when p_data ? 'order_value' then nullif(p_data ->> 'order_value', '')::numeric else order_value end,
    wbs = case when p_data ? 'wbs' then app.wbs_base(nullif(p_data ->> 'wbs', '')) else wbs end,
    po_no = case when p_data ? 'po_no' then nullif(btrim(p_data ->> 'po_no'), '') else po_no end,
    notes = case when p_data ? 'notes' then nullif(btrim(p_data ->> 'notes'), '') else notes end,
    updated_at = now()
   where id = s.id
  returning * into s;

  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    i := i + 1;
    begin m := app.month_of((x ->> 'month')::date); exception when others then m := null; end;
    perform app.require(nullif(x ->> 'amount', '')::numeric > 0, format('Invoice %s: enter the amount', i));
    lid := nullif(x ->> 'id', '')::uuid;
    if lid is not null and exists (select 1 from public.invoice_lines where id = lid and secured_id = s.id) then
      -- Once approved the months only move through move_invoice_line
      update public.invoice_lines set seq = i, kind = coalesce(nullif(x ->> 'kind', ''), kind), description = nullif(x ->> 'description', ''),
        trigger_note = nullif(x ->> 'trigger_note', ''), amount = (x ->> 'amount')::numeric,
        original_month = case when approved then original_month else coalesce(m, original_month) end,
        forecast_month = case when approved then forecast_month else coalesce(m, forecast_month) end
       where id = lid;
    else
      perform app.require(m is not null, format('Invoice %s: choose the month', i));
      insert into public.invoice_lines (secured_id, seq, kind, description, trigger_note, amount, original_month, forecast_month)
      values (s.id, i, coalesce(nullif(x ->> 'kind', ''), case when approved then 'variation' else 'other' end), nullif(x ->> 'description', ''),
        nullif(x ->> 'trigger_note', ''), (x ->> 'amount')::numeric, m, m)
      returning id into lid;
    end if;
    keep := keep || lid;
    total := total + (x ->> 'amount')::numeric;
  end loop;
  perform app.require(not exists (select 1 from public.invoice_lines l where l.secured_id = s.id and not (l.id = any (keep))
                                   and exists (select 1 from public.invoice_allocations a where a.line_id = l.id)),
    'An invoice that already has invoicing against it cannot be removed');
  delete from public.invoice_lines where secured_id = s.id and not (id = any (keep));

  if approved then
    -- Variation / scope change: the order value follows the schedule
    update public.secured_projects set order_value = billed_before + total where id = s.id;
    insert into public.secured_log (secured_id, action, note) values (s.id, 'schedule_changed',
      'Schedule changed · order value now ' || app.fmt_money(s.billed_before + total, 'LKR'));
  elsif p_submit then
    perform app.require(s.business_line is not null, 'Choose the business line');
    perform app.require(s.order_value is not null and s.order_value > 0, 'Enter the order value');
    perform app.require(i > 0, 'Add the invoices');
    perform app.require(abs(s.billed_before + total - s.order_value) <= 1,
      format('The invoices add up to %s – they must equal the order value %s', app.fmt_money(s.billed_before + total, 'LKR'),
        app.fmt_money(s.order_value, 'LKR')));
    if manager then
      update public.secured_projects set schedule_status = 'approved', submitted_at = now(), approved_at = now(), approved_by = auth.uid(),
        review_note = null where id = s.id;
      insert into public.secured_log (secured_id, action, note) values (s.id, 'approved', 'Schedule saved and approved');
    else
      update public.secured_projects set schedule_status = 'review', submitted_at = now(), review_alerted = false where id = s.id;
      insert into public.secured_log (secured_id, action, note) values (s.id, 'submitted', 'Invoice schedule sent to SM Projects');
      perform app.notify_many(app.role_users('sm_projects'), 'schedule_review', 'Invoice schedule to review',
        s.project_name || ' · ' || coalesce(app.display_name(s.sales_person_id), '—') || ' · ' || app.fmt_money(s.order_value, 'LKR'),
        'normal', 'secured_project', s.id, app.secured_url(s.id));
    end if;
  end if;
  perform app.reallocate(s.id);
end $$;

create or replace function public.review_invoice_schedule(p_secured uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.secured_projects;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'Only SM Projects or GM / DGM review invoice schedules');
  select * into s from public.secured_projects where id = p_secured for update;
  perform app.require(s.schedule_status = 'review', 'Nothing to review');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason for returning it');
  if p_approve then
    update public.secured_projects set schedule_status = 'approved', approved_at = now(), approved_by = auth.uid(), review_note = p_note where id = s.id;
    update public.invoice_lines set original_month = forecast_month where secured_id = s.id;
    insert into public.secured_log (secured_id, action, note) values (s.id, 'approved', coalesce('Approved · ' || p_note, 'Approved'));
    perform app.notify(s.sales_person_id, 'schedule_review', 'Invoice schedule approved', s.project_name || coalesce(' · ' || p_note, ''),
      'normal', 'secured_project', s.id, app.secured_url(s.id));
  else
    update public.secured_projects set schedule_status = 'missing', review_note = p_note where id = s.id;
    insert into public.secured_log (secured_id, action, note) values (s.id, 'returned', 'Returned · ' || p_note);
    perform app.notify(s.sales_person_id, 'schedule_review', 'Invoice schedule returned', s.project_name || ' · ' || p_note,
      'normal', 'secured_project', s.id, app.secured_url(s.id));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Invoice date changes
-- ---------------------------------------------------------------------------
create or replace function public.move_invoice_line(p_line uuid, p_month date, p_reason text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  l public.invoice_lines;
  s public.secured_projects;
  m date := app.month_of(p_month);
  this_month date := app.month_of((now() at time zone app.tz())::date);
  needs boolean;
  open_amt numeric;
begin
  select * into l from public.invoice_lines where id = p_line for update;
  perform app.require(l.id is not null, 'Invoice not found');
  select * into s from public.secured_projects where id = l.secured_id;
  perform app.require(app.can_edit_secured(s), 'Only the sales person, Operations or SM Projects move invoice dates');
  perform app.require(s.schedule_status = 'approved', 'The schedule is not approved yet – change the month in the schedule');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Choose the reason');
  perform app.require(m is not null and m <> l.forecast_month, 'Choose a different month');
  perform app.require(not exists (select 1 from public.invoice_line_changes where line_id = l.id and status = 'pending'),
    'A change for this invoice is waiting for SM Projects');
  select l.amount - coalesce(sum(amount), 0) into open_amt from public.invoice_allocations where line_id = l.id;
  perform app.require(open_amt > 0, 'This invoice is fully invoiced');
  needs := (l.forecast_month <= this_month or m > app.fy_end(app.fy_of(this_month))) and not app.has_role('sm_projects', 'gm');
  if needs then
    insert into public.invoice_line_changes (line_id, from_month, to_month, reason, note, status)
    values (l.id, l.forecast_month, m, p_reason, p_note, 'pending');
    perform app.notify_many(app.role_users('sm_projects'), 'invoice_move', 'Invoice date change to approve',
      s.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · ' || to_char(l.forecast_month, 'Mon YYYY') || ' → ' ||
      to_char(m, 'Mon YYYY') || ' · ' || p_reason, 'normal', 'secured_project', s.id, app.secured_url(s.id));
    return 'pending';
  end if;
  insert into public.invoice_line_changes (line_id, from_month, to_month, reason, note, status, decided_by, decided_at)
  values (l.id, l.forecast_month, m, p_reason, p_note, case when app.has_role('sm_projects', 'gm') then 'approved' else 'recorded' end,
    case when app.has_role('sm_projects', 'gm') then auth.uid() end, case when app.has_role('sm_projects', 'gm') then now() end);
  update public.invoice_lines set forecast_month = m, moves = moves + 1 where id = l.id;
  perform app.reallocate(s.id);
  return 'moved';
end $$;

create or replace function public.decide_invoice_move(p_change bigint, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.invoice_line_changes;
  l public.invoice_lines;
  s public.secured_projects;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'Only SM Projects or GM / DGM approve invoice date changes');
  select * into c from public.invoice_line_changes where id = p_change for update;
  perform app.require(c.status = 'pending', 'This change is already decided');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  select * into l from public.invoice_lines where id = c.line_id;
  select * into s from public.secured_projects where id = l.secured_id;
  update public.invoice_line_changes set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(),
    decided_at = now(), decision_note = p_note where id = c.id;
  if p_approve then
    update public.invoice_lines set forecast_month = c.to_month, moves = moves + 1 where id = l.id;
    perform app.reallocate(s.id);
  end if;
  perform app.notify(c.requested_by, 'invoice_move', case when p_approve then 'Invoice date change approved' else 'Invoice date change not approved' end,
    s.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · ' || to_char(c.from_month, 'Mon YYYY') || ' → ' ||
    to_char(c.to_month, 'Mon YYYY') || coalesce(' · ' || p_note, ''), 'normal', 'secured_project', s.id, app.secured_url(s.id));
end $$;

create or replace function public.close_secured_project(p_secured uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.secured_projects;
begin
  perform app.require(app.has_role('sm_projects', 'gm', 'operations_exec'), 'Only Operations, SM Projects or GM / DGM close a secured project');
  perform app.require(p_status in ('closed', 'cancelled', 'open'), 'Invalid status');
  perform app.require(p_status = 'open' or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  select * into s from public.secured_projects where id = p_secured for update;
  perform app.require(s.id is not null, 'Secured project not found');
  update public.secured_projects set status = p_status, updated_at = now() where id = s.id;
  insert into public.secured_log (secured_id, action, note) values (s.id, p_status, p_note);
end $$;

-- Details that change without touching the schedule: WBS (Operations adds it once SAP creates it), PO, notes, line, sales person
create or replace function public.set_secured_details(p_secured uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.secured_projects;
begin
  select * into s from public.secured_projects where id = p_secured for update;
  perform app.require(s.id is not null, 'Secured project not found');
  perform app.require(app.can_edit_secured(s), 'Only the sales person, Operations or SM Projects edit this project');
  perform app.require(not (p_data ? 'sales_person_id') or app.is_finance_desk(), 'Only Operations or SM Projects change the sales person');
  perform app.require(not (p_data ? 'business_line') or app.norm_line(p_data ->> 'business_line') is not null, 'Choose the business line');
  perform app.require(not (p_data ? 'wbs') or nullif(p_data ->> 'wbs', '') is null
    or not exists (select 1 from public.secured_projects o where o.id <> s.id and app.wbs_base(o.wbs) = app.wbs_base(p_data ->> 'wbs')),
    'This WBS is already on another secured project');
  update public.secured_projects set
    wbs = case when p_data ? 'wbs' then app.wbs_base(nullif(p_data ->> 'wbs', '')) else wbs end,
    po_no = case when p_data ? 'po_no' then nullif(btrim(p_data ->> 'po_no'), '') else po_no end,
    notes = case when p_data ? 'notes' then nullif(btrim(p_data ->> 'notes'), '') else notes end,
    customer = case when p_data ? 'customer' then nullif(btrim(p_data ->> 'customer'), '') else customer end,
    business_line = case when p_data ? 'business_line' then app.norm_line(p_data ->> 'business_line') else business_line end,
    sales_person_id = case when p_data ? 'sales_person_id' then (p_data ->> 'sales_person_id')::uuid else sales_person_id end,
    updated_at = now()
   where id = s.id;
  insert into public.secured_log (secured_id, action, note)
  values (s.id, 'details', 'Updated: ' || (select string_agg(k, ', ') from jsonb_object_keys(p_data) k));
  perform app.reallocate(s.id);
end $$;
revoke execute on function public.set_secured_details(uuid, jsonb) from public, anon;
grant execute on function public.set_secured_details(uuid, jsonb) to authenticated;

-- Operations moves an amount that was matched to the wrong invoice
create or replace function public.reassign_allocation(p_alloc bigint, p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.invoice_allocations;
begin
  perform app.require(app.is_finance_desk(), 'Only Operations, SM Projects or GM / DGM re-assign invoicing');
  select * into a from public.invoice_allocations where id = p_alloc for update;
  perform app.require(a.id is not null, 'Not found');
  perform app.require(p_line is null or exists (select 1 from public.invoice_lines where id = p_line and secured_id = a.secured_id),
    'Choose an invoice of the same project');
  update public.invoice_allocations set line_id = p_line, manual = true where id = a.id;
  perform app.reallocate(a.secured_id);
end $$;

-- ---------------------------------------------------------------------------
-- Monthly OR file
-- ---------------------------------------------------------------------------
-- p_pnl: [{seq, section, label, rank, ly_cum, m_act, m_bud, c_act, c_bud, fy_bp}]; p_wbs: [{wbs, revenue, cost}] (sub-codes rolled up)
create or replace function public.save_or_upload(p_month date, p_file_name text, p_pnl jsonb, p_wbs jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m date := app.month_of(p_month);
  uid uuid;
  x jsonb;
  s record;
  l record;
  latest boolean;
begin
  perform app.require(app.is_finance_desk(), 'Only Operations, SM Projects or GM / DGM upload the OR file');
  perform app.require(m is not null, 'Choose the month');
  perform app.require(jsonb_array_length(coalesce(p_pnl, '[]')) > 0, 'The P&L sheet was not found in the file');
  delete from public.or_uploads where month = m;
  insert into public.or_uploads (month, fy, file_name) values (m, app.fy_of(m), p_file_name) returning id into uid;
  insert into public.pnl_lines (upload_id, seq, section, label, rank, ly_cum, m_act, m_bud, c_act, c_bud, fy_bp)
  select uid, (e ->> 'seq')::int, e ->> 'section', e ->> 'label', nullif(e ->> 'rank', ''),
    nullif(e ->> 'ly_cum', '')::numeric, nullif(e ->> 'm_act', '')::numeric, nullif(e ->> 'm_bud', '')::numeric,
    nullif(e ->> 'c_act', '')::numeric, nullif(e ->> 'c_bud', '')::numeric, nullif(e ->> 'fy_bp', '')::numeric
    from jsonb_array_elements(p_pnl) e;
  insert into public.wbs_actuals (upload_id, wbs, revenue, cost)
  select uid, app.wbs_base(e ->> 'wbs'), sum(coalesce((e ->> 'revenue')::numeric, 0)), sum(coalesce((e ->> 'cost')::numeric, 0))
    from jsonb_array_elements(coalesce(p_wbs, '[]')) e where app.wbs_base(e ->> 'wbs') is not null group by 2;
  update public.or_uploads set
    net_turnover = (select m_act from public.pnl_lines where upload_id = uid and section = 'pnl' and lower(label) = 'net turnover' limit 1),
    net_profit = (select m_act from public.pnl_lines where upload_id = uid and section = 'pnl' and lower(label) = 'net profit' limit 1),
    invoiced_wbs = (select sum(revenue) from public.wbs_actuals where upload_id = uid)
   where id = uid;
  -- Allocate to every secured project whose WBS is in this or an earlier upload
  for s in select sp.id from public.secured_projects sp where sp.wbs is not null
             and exists (select 1 from public.wbs_actuals w where w.wbs = app.wbs_base(sp.wbs)) loop
    perform app.reallocate(s.id);
  end loop;
  -- Invoices planned up to this month and not (fully) invoiced → slipped
  latest := m >= (select max(month) from public.or_uploads);
  if latest then
    for l in select v.* from public.invoice_line_status v
              where v.forecast_month <= m and v.remaining > 0 and v.schedule_status = 'approved' and v.project_status = 'open' loop
      perform app.notify_many(array[l.sales_person_id] || app.role_users('sm_projects'), 'invoice_slipped',
        case when l.invoiced > 0 then 'Invoice part billed – balance slipped' else 'Invoice slipped' end,
        l.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · planned ' || to_char(l.forecast_month, 'Mon YYYY') ||
        ' · ' || app.fmt_money(l.remaining, 'LKR') || ' not invoiced · move it with a reason',
        'normal', 'secured_project', l.secured_id, app.secured_url(l.secured_id), format('slip:%s:%s', l.id, m));
    end loop;
  end if;
  return uid;
end $$;

-- ---------------------------------------------------------------------------
-- Sales targets
-- ---------------------------------------------------------------------------
create or replace function app.targets_editable(p_fy int) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status in ('draft', 'returned') from public.target_sets where fy = p_fy), true)
$$;

-- Invoicing target = budget invoice months (+ opening secured invoices of projects not in the budget list);
-- secured target = this-year value of each budgeted project not already secured before the year, in its order month.
create or replace function public.fill_targets_from_budget(p_fy int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'Only SM Projects or GM / DGM set targets');
  perform app.require(app.targets_editable(p_fy), 'Targets are submitted or approved – GM / DGM must return them first');
  insert into public.target_sets (fy) values (p_fy) on conflict (fy) do nothing;
  delete from public.sales_targets where fy = p_fy;
  with months as (
    select generate_series(app.fy_start(p_fy), app.fy_start(p_fy) + interval '11 months', interval '1 month')::date as month
  ), people as (
    select distinct sales_person_id from public.budget_projects where fy = p_fy and sales_person_id is not null
    union select distinct sales_person_id from public.secured_projects where source = 'opening' and status = 'open' and sales_person_id is not null
  ), inv as (
    select b.sales_person_id, app.month_of(i.month) as month, sum(i.amount) as amt
      from public.budget_projects b join public.budget_invoices i on i.budget_id = b.id
     where b.fy = p_fy and i.month between app.fy_start(p_fy) and app.fy_end(p_fy)
     group by 1, 2
    union all
    select s.sales_person_id, l.original_month, sum(l.amount)
      from public.secured_projects s join public.invoice_lines l on l.secured_id = s.id
     where s.source = 'opening' and s.status = 'open' and l.original_month between app.fy_start(p_fy) and app.fy_end(p_fy)
       and not exists (select 1 from public.budget_projects b where b.fy = p_fy and (b.id = s.budget_id or (b.wbs is not null and b.wbs = s.wbs)))
     group by 1, 2
  ), sec as (
    select b.sales_person_id, coalesce(b.order_month, app.fy_start(p_fy)) as month,
           sum((select coalesce(sum(i.amount), 0) from public.budget_invoices i where i.budget_id = b.id
                 and i.month between app.fy_start(p_fy) and app.fy_end(p_fy))) as amt
      from public.budget_projects b
     where b.fy = p_fy
       and not exists (select 1 from public.secured_projects s where s.source = 'opening'
                        and ((s.budget_id = b.id) or (b.wbs is not null and s.wbs = b.wbs)))
     group by 1, 2
  )
  insert into public.sales_targets (fy, sales_person_id, month, secured_target, invoice_target)
  select p_fy, p.sales_person_id, m.month,
         coalesce((select sum(amt) from sec where sec.sales_person_id = p.sales_person_id and app.month_of(sec.month) = m.month), 0),
         coalesce((select sum(amt) from inv where inv.sales_person_id = p.sales_person_id and inv.month = m.month), 0)
    from people p cross join months m;
  get diagnostics n = row_count;
  return n;
end $$;

-- p_rows: [{sales_person_id, month, secured_target, invoice_target}]
create or replace function public.save_targets(p_fy int, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'Only SM Projects or GM / DGM set targets');
  perform app.require(app.targets_editable(p_fy), 'Targets are submitted or approved – GM / DGM must return them first');
  insert into public.target_sets (fy) values (p_fy) on conflict (fy) do nothing;
  insert into public.sales_targets (fy, sales_person_id, month, secured_target, invoice_target)
  select p_fy, (e ->> 'sales_person_id')::uuid, app.month_of((e ->> 'month')::date),
         coalesce(nullif(e ->> 'secured_target', '')::numeric, 0), coalesce(nullif(e ->> 'invoice_target', '')::numeric, 0)
    from jsonb_array_elements(coalesce(p_rows, '[]')) e
  on conflict (fy, sales_person_id, month) do update set secured_target = excluded.secured_target, invoice_target = excluded.invoice_target;
end $$;

create or replace function public.submit_targets(p_fy int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'Only SM Projects or GM / DGM submit targets');
  perform app.require(app.targets_editable(p_fy), 'Already submitted');
  perform app.require(exists (select 1 from public.sales_targets where fy = p_fy), 'Enter the targets first');
  if app.has_role('gm') then
    insert into public.target_sets (fy, status, submitted_by, submitted_at, decided_by, decided_at)
    values (p_fy, 'approved', auth.uid(), now(), auth.uid(), now())
    on conflict (fy) do update set status = 'approved', submitted_by = auth.uid(), submitted_at = now(), decided_by = auth.uid(), decided_at = now(), note = null;
  else
    insert into public.target_sets (fy, status, submitted_by, submitted_at) values (p_fy, 'submitted', auth.uid(), now())
    on conflict (fy) do update set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), note = null;
    perform app.notify_many(app.role_users('gm'), 'targets', 'Sales targets to approve',
      format('FY %s/%s targets submitted by %s', p_fy, (p_fy + 1) % 100, coalesce(app.display_name(auth.uid()), '—')),
      'normal', null, null, '/finance/targets');
  end if;
end $$;

create or replace function public.decide_targets(p_fy int, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare ts public.target_sets;
begin
  perform app.require(app.has_role('gm'), 'Only GM / DGM approves targets');
  select * into ts from public.target_sets where fy = p_fy for update;
  perform app.require(ts.status in ('submitted', 'approved'), 'Nothing to decide');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  update public.target_sets set status = case when p_approve then 'approved' else 'returned' end, decided_by = auth.uid(), decided_at = now(),
    note = p_note where fy = p_fy;
  perform app.notify(ts.submitted_by, 'targets', case when p_approve then 'Sales targets approved' else 'Sales targets returned' end,
    format('FY %s/%s', p_fy, (p_fy + 1) % 100) || coalesce(' · ' || p_note, ''), 'normal', null, null, '/finance/targets');
  if p_approve then
    perform app.notify_many(array(select distinct sales_person_id from public.sales_targets where fy = p_fy), 'targets',
      'Your sales target is set', format('FY %s/%s – see My target', p_fy, (p_fy + 1) % 100), 'normal', null, null, '/finance/my');
  end if;
end $$;

-- Performance per sales person and month (sales see only themselves)
create or replace function public.finance_performance(p_fy int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  all_people boolean := app.has_role('gm', 'sm_projects', 'sm_estimation', 'operations_exec');
  fs date := app.fy_start(p_fy);
  fe date := app.fy_end(p_fy);
  latest date;
  people jsonb;
begin
  perform app.require(all_people or app.has_role('asm_building', 'asm_infra'), 'Not available for your role');
  select max(month) into latest from public.or_uploads where fy = p_fy;
  with persons as (
    select distinct x.pid from (
      select sales_person_id as pid from public.sales_targets where fy = p_fy
      union select sales_person_id from public.secured_projects where status <> 'cancelled'
      union select sales_person_id from public.budget_projects where fy = p_fy
    ) x where x.pid is not null and (all_people or x.pid = auth.uid())
  ), months as (
    select generate_series(fs, fs + interval '11 months', interval '1 month')::date as month
  ), credit as (
    -- secured credit: this-year part of each approved win, in the month it was won
    select s.sales_person_id as pid, app.month_of(s.won_on) as month,
           sum((select coalesce(sum(l.amount), 0) from public.invoice_lines l where l.secured_id = s.id and l.original_month between fs and fe)) as amt
      from public.secured_projects s
     where s.source = 'won' and s.schedule_status = 'approved' and s.status <> 'cancelled' and s.won_on between fs and fe
     group by 1, 2
  ), pending as (
    select s.sales_person_id as pid, count(*) as n, sum(s.order_value) as amt
      from public.secured_projects s
     where s.source = 'won' and s.schedule_status <> 'approved' and s.status = 'open' and s.won_on between fs and fe
     group by 1
  ), inv as (
    select s.sales_person_id as pid, a.month, sum(a.amount) as amt
      from public.invoice_allocations a join public.secured_projects s on s.id = a.secured_id
     where a.month between fs and fe group by 1, 2
  ), tobill as (
    select v.sales_person_id as pid, sum(greatest(v.remaining, 0)) as amt
      from public.invoice_line_status v
     where v.project_status = 'open' and v.forecast_month <= fe and v.remaining > 0 group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.pid, 'name', app.display_name(p.pid), 'role', (select role from public.profiles where id = p.pid),
      'lines', (select coalesce(jsonb_agg(distinct b.business_line), '[]') from public.budget_projects b where b.fy = p_fy and b.sales_person_id = p.pid),
      'to_bill_fy', coalesce((select amt from tobill where tobill.pid = p.pid), 0),
      'pending_n', coalesce((select n from pending where pending.pid = p.pid), 0),
      'pending_value', coalesce((select amt from pending where pending.pid = p.pid), 0),
      'months', (select jsonb_agg(jsonb_build_object('month', m.month,
          'secured_target', coalesce((select secured_target from public.sales_targets t where t.fy = p_fy and t.sales_person_id = p.pid and t.month = m.month), 0),
          'invoice_target', coalesce((select invoice_target from public.sales_targets t where t.fy = p_fy and t.sales_person_id = p.pid and t.month = m.month), 0),
          'secured', coalesce((select sum(amt) from credit c where c.pid = p.pid and c.month = m.month), 0),
          'invoiced', coalesce((select sum(amt) from inv i where i.pid = p.pid and i.month = m.month), 0)) order by m.month) from months m)
    ) order by app.display_name(p.pid)), '[]') into people
    from persons p;
  return jsonb_build_object('fy', p_fy, 'latest_month', latest, 'people', people,
    'targets_status', (select status from public.target_sets where fy = p_fy),
    'unlinked_invoiced', case when all_people then
      (select coalesce(sum(w.revenue), 0) from public.wbs_actuals w join public.or_uploads u on u.id = w.upload_id
        where u.fy = p_fy and not exists (select 1 from public.secured_projects s where app.wbs_base(s.wbs) = w.wbs)) end);
end $$;

-- ---------------------------------------------------------------------------
-- Reminders (daily from 08:00)
-- ---------------------------------------------------------------------------
create or replace function public.finance_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  s public.secured_projects;
  l record;
  n int := 0;
  smp uuid[] := app.role_users('sm_projects');
begin
  if loc::time < time '08:00' then return 0; end if;
  -- Won but no invoice schedule after 5 working days → sales person and SM Projects
  for s in select * from public.secured_projects where status = 'open' and schedule_status = 'missing' and not schedule_alerted
             and app.work_minutes_between(created_at, p_at) >= 5 * app.working_minutes_per_day() loop
    perform app.notify_many(array[s.sales_person_id] || smp, 'secured_schedule', 'Invoice schedule missing',
      s.project_name || ' · won ' || to_char(s.won_on, 'DD Mon YYYY') || ' · enter the invoices', 'normal', 'secured_project', s.id, app.secured_url(s.id));
    update public.secured_projects set schedule_alerted = true where id = s.id; n := n + 1;
  end loop;
  -- Schedule waiting for SM Projects for 2 working days
  for s in select * from public.secured_projects where status = 'open' and schedule_status = 'review' and not review_alerted
             and app.work_minutes_between(submitted_at, p_at) >= 2 * app.working_minutes_per_day() loop
    perform app.notify_many(smp, 'schedule_review', 'Invoice schedule waiting for review',
      s.project_name || ' · ' || coalesce(app.display_name(s.sales_person_id), '—'), 'normal', 'secured_project', s.id, app.secured_url(s.id));
    update public.secured_projects set review_alerted = true where id = s.id; n := n + 1;
  end loop;
  -- 20th: invoices planned this month – confirm or move them
  if extract(day from today) = 20 then
    for l in select v.* from public.invoice_line_status v
              where v.forecast_month = app.month_of(today) and v.remaining > 0 and v.project_status = 'open' and v.schedule_status = 'approved' loop
      perform app.notify(l.sales_person_id, 'invoice_due', 'Invoice planned this month',
        l.project_name || ' · ' || coalesce(l.description, initcap(l.kind)) || ' · ' || app.fmt_money(l.remaining, 'LKR') ||
        ' · confirm it will be billed or move it with a reason', 'normal', 'secured_project', l.secured_id, app.secured_url(l.secured_id),
        format('due:%s:%s', l.id, app.month_of(today)));
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;
revoke execute on function public.finance_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.finance_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('finance-tick', '20 * * * *', 'select public.finance_tick()');
  end if;
end $$;

revoke execute on function public.check_budget_list(int, jsonb), public.save_budget_list(int, jsonb), public.check_opening_list(jsonb),
  public.save_opening_list(jsonb), public.save_invoice_schedule(uuid, jsonb, jsonb, boolean), public.review_invoice_schedule(uuid, boolean, text),
  public.move_invoice_line(uuid, date, text, text), public.decide_invoice_move(bigint, boolean, text), public.close_secured_project(uuid, text, text),
  public.reassign_allocation(bigint, uuid), public.save_or_upload(date, text, jsonb, jsonb), public.fill_targets_from_budget(int),
  public.save_targets(int, jsonb), public.submit_targets(int), public.decide_targets(int, boolean, text), public.finance_performance(int)
  from public, anon;
grant execute on function public.check_budget_list(int, jsonb), public.save_budget_list(int, jsonb), public.check_opening_list(jsonb),
  public.save_opening_list(jsonb), public.save_invoice_schedule(uuid, jsonb, jsonb, boolean), public.review_invoice_schedule(uuid, boolean, text),
  public.move_invoice_line(uuid, date, text, text), public.decide_invoice_move(bigint, boolean, text), public.close_secured_project(uuid, text, text),
  public.reassign_allocation(bigint, uuid), public.save_or_upload(date, text, jsonb, jsonb), public.fill_targets_from_budget(int),
  public.save_targets(int, jsonb), public.submit_targets(int), public.decide_targets(int, boolean, text), public.finance_performance(int)
  to authenticated;
