-- Modules 2–4 – Inquiries, design jobs, estimation jobs, quotations, clarifications (SRS Sections 5–7).
-- Workflow tables are written only through the RPCs in the workflow migration; clients get read access via RLS.

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  project_id uuid not null references public.projects (id),
  visit_id uuid references public.visits (id),
  sales_person_id uuid not null default auth.uid() references public.profiles (id),
  -- Snapshots so Design / Estimation can see names without access to projects or customers (Section 2)
  project_name text,
  customer_name text,
  project_type public.project_type,
  organization_id uuid not null references public.organizations (id),
  unit_id uuid references public.org_units (id),
  contact_id uuid references public.contacts (id),
  consultant_organization_id uuid references public.organizations (id),
  route text not null check (route in ('A', 'B', 'C')),        -- A design→estimation, B estimation only, C design only
  release_mode int check (release_mode in (1, 2, 3)),          -- 6.5; proposed by sales, confirmed by SM Projects
  release_mode_confirmed boolean not null default false,
  duty_status public.duty_status,
  currency public.currency generated always as (case when duty_status = 'duty_free' then 'USD'::public.currency else 'LKR'::public.currency end) stored,
  design_scope text check (design_scope in ('lighting', 'electrical', 'lighting_electrical')),
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  submission_type text,
  customer_deadline date,
  design_required_by date,
  quotation_required_by date,
  scope_description text,
  areas text,
  preferred_brands text,
  budget_lkr numeric(16, 2),
  approved_makes text,
  checklist jsonb not null default '{}'::jsonb,   -- {"drawings":true,"boq":false,"spec":true,"lux":false}
  checklist_incomplete boolean generated always as (
    not (coalesce((checklist ->> 'drawings')::boolean, false) and coalesce((checklist ->> 'boq')::boolean, false)
         and coalesce((checklist ->> 'spec')::boolean, false) and coalesce((checklist ->> 'lux')::boolean, false))) stored,
  solution_level text check (solution_level in ('high', 'medium', 'low')),
  manufacturing_origin text check (manufacturing_origin in ('european', 'chinese', 'no_preference')),
  expectation_notes text,
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'returned_for_info', 'rejected', 'accepted', 'in_design', 'design_review', 'design_approved',
    'in_estimation', 'estimation_review', 'quotation_released', 'returned_to_sales', 'submitted_to_client',
    'awaiting_client_approval', 'client_approved', 'won', 'lost', 'on_hold', 'cancelled')),
  status_before_hold text,
  hold_reason text,
  revision int not null default 0,                 -- R0, R1, …
  current_owner_id uuid references public.profiles (id),
  current_team public.team,
  current_due_at timestamptz,
  progress_pct int not null default 0,
  sla_colour text not null default 'green' check (sla_colour in ('green', 'amber', 'red', 'grey')),
  delay_reason text,
  revised_due_at timestamptz,
  early_design_release_at timestamptz,
  design_released_to_sales_at timestamptz,
  quotation_released_at timestamptz,
  submitted_to_client_at timestamptz,
  client_response text check (client_response in ('approved', 'approved_with_comments', 'revision_required')),
  client_response_at timestamptz,
  result text check (result in ('won', 'lost', 'on_hold', 'cancelled')),
  lost_reason text,
  lost_to_competitor_id bigint references public.competitors (id),
  order_value numeric(16, 2),
  order_date date,
  debtor_flag boolean not null default false,
  mixed_duty_approved boolean not null default false,
  deadline_critical_sent boolean not null default false,
  deadline_missed_sent boolean not null default false,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.inquiries (sales_person_id, status);
create index on public.inquiries (project_id);
create index on public.inquiries (status, customer_deadline);
create trigger no_delete_inquiries before delete on public.inquiries for each row execute function app.prevent_delete();
create trigger audit_inquiries after insert or update on public.inquiries for each row execute function app.audit();

-- Customer deadline history (5.8) and due-date versions (6.3)
create table public.due_date_changes (
  id bigint generated always as identity primary key,
  entity_type text not null,        -- inquiry (customer_deadline), design_job, estimation_job
  entity_id uuid not null,
  inquiry_id uuid,
  field text not null,
  old_value timestamptz,
  new_value timestamptz,
  reason text not null,
  user_id uuid default auth.uid(),
  at timestamptz not null default now()
);

create or replace function app.inquiries_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.code := coalesce(new.code, app.next_code('INQ'));
    if auth.uid() is not null and app.is_sales_person() then new.sales_person_id := auth.uid(); end if;
    if auth.uid() is not null then new.status := 'draft'; end if;
    -- Raised by SM Projects / GM on behalf of the project's sales person
    if auth.uid() is not null and not app.is_sales_person() then
      new.sales_person_id := (select owner_id from public.projects where id = new.project_id);
    end if;
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and current_setting('app.workflow', true) is distinct from '1'
     and (new.status, new.revision, new.release_mode_confirmed, new.mixed_duty_approved, new.current_owner_id, new.result)
         is distinct from (old.status, old.revision, old.release_mode_confirmed, old.mixed_duty_approved, old.current_owner_id, old.result) then
    raise exception 'Workflow fields change only through workflow actions';
  end if;
  select p.name, o.name, p.project_type into new.project_name, new.customer_name, new.project_type
  from public.projects p join public.organizations o on o.id = p.organization_id where p.id = new.project_id;
  if new.route = 'C' then new.release_mode := coalesce(new.release_mode, 1); end if;
  if new.route = 'B' then new.release_mode := coalesce(new.release_mode, 2); end if;
  if new.route = 'A' then new.release_mode := coalesce(new.release_mode, 3); end if;
  -- After submission, sales cannot edit the request (5.2); changes go through revision requests.
  if tg_op = 'UPDATE' and old.status not in ('draft', 'returned_for_info') and auth.uid() is not null
     and current_setting('app.workflow', true) is distinct from '1' then
    raise exception 'This inquiry has been submitted. Use a revision request to change it.';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger inquiries_before before insert or update on public.inquiries
for each row execute function app.inquiries_before();

-- ---------------------------------------------------------------------------
-- Design jobs (Section 6)
-- ---------------------------------------------------------------------------
create table public.design_jobs (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries (id),
  revision int not null default 0,
  task_type text not null default 'lighting' check (task_type in ('lighting', 'electrical')),
  job_size text not null default 'medium' check (job_size in ('small', 'medium', 'large')),
  assignee_id uuid references public.profiles (id),
  status text not null default 'assigned' check (status in (
    'assigned', 'acknowledged', 'date_change_requested', 'in_progress', 'on_hold', 'in_review', 'returned', 'approved', 'released')),
  status_before_hold text,
  due_at timestamptz not null,
  original_due_at timestamptz not null,
  depends_on_job_id uuid references public.design_jobs (id),
  milestones jsonb not null default '[]'::jsonb,  -- [{"name":"Concept","due":"2026-10-03","done":false}]
  progress_pct int not null default 0 check (progress_pct between 0 and 100),
  hours_logged numeric(8, 2) not null default 0,
  review_cycles int not null default 0,
  brands_specified jsonb not null default '[]'::jsonb, -- [{"group":"Downlights","brand":"X","origin":"european"}]
  brand_justification text,
  hold_reason text,
  hold_waiting_on text,
  requested_due_at timestamptz,
  late_reason text,
  delay_reason text,
  revised_due_at timestamptz,
  review_comment text,
  assigned_by uuid references public.profiles (id),
  assigned_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.design_jobs (assignee_id, status);
create index on public.design_jobs (inquiry_id);
create trigger audit_design_jobs after insert or update on public.design_jobs for each row execute function app.audit();

create table public.design_hours (
  id bigint generated always as identity primary key,
  design_job_id uuid not null references public.design_jobs (id),
  user_id uuid not null default auth.uid() references public.profiles (id),
  work_date date not null default current_date,
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  note text
);

-- ---------------------------------------------------------------------------
-- Estimation jobs (Section 7). Cost and margin live in estimation_costing (restricted).
-- ---------------------------------------------------------------------------
create table public.estimation_jobs (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries (id),
  revision int not null default 0,
  source text not null check (source in ('design', 'direct')),
  status text not null default 'queued' check (status in (
    'queued', 'accepted', 'assigned', 'acknowledged', 'date_change_requested', 'in_progress', 'on_hold',
    'submitted_for_approval', 'returned', 'gm_approval', 'approved', 'released')),
  status_before_hold text,
  assignee_id uuid references public.profiles (id),
  value_band text check (value_band in ('small', 'medium', 'large')),
  due_at timestamptz,
  original_due_at timestamptz,
  quotation_no text,
  quoted_value numeric(16, 2),
  validity_days int not null default 30,
  brands_offered jsonb not null default '[]'::jsonb,  -- [{"group":"Floodlights","brand":"X","origin":"european"}]
  brand_justification text,
  alternatives text,
  supplier_waits jsonb not null default '[]'::jsonb,  -- [{"supplier":"...","requested":"...","expected":"...","received":null}]
  design_version_used text,
  hold_reason text,
  requested_due_at timestamptz,
  assignment_reason text,
  delay_reason text,
  revised_due_at timestamptz,
  review_comment text,
  assigned_by uuid references public.profiles (id),
  assigned_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.estimation_jobs (assignee_id, status);
create index on public.estimation_jobs (inquiry_id);
create trigger audit_estimation_jobs after insert or update on public.estimation_jobs for each row execute function app.audit();

create table public.estimation_costing (
  estimation_job_id uuid primary key references public.estimation_jobs (id),
  cost numeric(16, 2),
  margin_pct numeric(6, 2),
  updated_at timestamptz not null default now()
);
create trigger audit_estimation_costing after insert or update on public.estimation_costing for each row execute function app.audit();

-- Released quotations (price only – visible to the requesting sales person)
create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries (id),
  estimation_job_id uuid not null references public.estimation_jobs (id),
  quotation_no text not null,            -- QTN-2026-00001
  revision int not null default 0,
  full_no text generated always as (quotation_no || '-R' || revision) stored,
  quoted_value numeric(16, 2) not null,
  currency public.currency not null,
  brands_offered jsonb not null default '[]'::jsonb,
  released_at timestamptz not null default now(),
  validity_date date not null,
  submitted_to_client_at timestamptz,
  result text check (result in ('won', 'lost', 'on_hold')),
  lost_reason text,
  revalidation_requested_at timestamptz,
  validity_warning_sent boolean not null default false,
  unique (quotation_no, revision)
);
create index on public.quotations (inquiry_id);

-- Design ↔ Estimation clarifications (7.5)
create table public.clarifications (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries (id),
  estimation_job_id uuid not null references public.estimation_jobs (id),
  design_job_id uuid references public.design_jobs (id),
  question text not null,
  asked_by uuid not null default auth.uid() references public.profiles (id),
  asked_at timestamptz not null default now(),
  answer text,
  answered_by uuid references public.profiles (id),
  answered_at timestamptz,
  overdue_flagged boolean not null default false
);

-- Brand check against the client's expectation (5.7)
create or replace function app.brands_match_expectation(p_brands jsonb, p_level text, p_origin text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from jsonb_array_elements(coalesce(p_brands, '[]')) e
    join public.brands b on b.name = e ->> 'brand'
    where (p_level is not null and b.level <> p_level)
       or (p_origin in ('european', 'chinese') and b.origin <> p_origin))
$$;

-- Designer / Design Manager records the brands specified in the design (5.7)
create or replace function public.set_design_brands(p_job uuid, p_brands jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.design_jobs where id = p_job
                 and (assignee_id = auth.uid() or app.has_role('design_manager'))) then
    raise exception 'Only the assignee or the Design Manager can set brands';
  end if;
  update public.design_jobs set brands_specified = coalesce(p_brands, '[]') where id = p_job;
end $$;
