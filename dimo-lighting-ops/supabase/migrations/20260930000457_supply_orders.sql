-- Project type on the order book: Supply only or Supply & installation, chosen by the sales person with the invoice plan.
--  * Pre-filled from the won inquiries' estimation basis (any inquiry with installation → Supply & installation); the plan cannot be
--    sent (or saved as approved) without it. A project with both kinds of inquiry is Supply & installation.
--  * When the invoice plan is approved:
--      Supply & installation → Operations is told to raise the execution hand-over (the existing path).
--      Supply only → a supply order (SO-) opens for SM Estimation: the manufacturers involved, each one's PI and costing, submitted
--      one by one or together as they arrive; each submitted PI goes straight to Operations, who handles it by e-mail and sets its
--      status: OK, Revision requested (back to SM Estimation with a note) or On hold.
--  * A supply-only project cannot be handed over to execution.

alter table public.secured_projects add column if not exists project_type text check (project_type in ('supply', 'supply_install'));

-- The type from the won inquiries of the project (null when none says)
create or replace function app.type_from_inquiries(p_project uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when bool_or(estimation_basis in ('supply_install', 'supply_install_commission')) then 'supply_install'
              when bool_or(estimation_basis is not null) then 'supply' end
  from public.inquiries where project_id = p_project and result = 'won'
$$;

update public.secured_projects s set project_type = app.type_from_inquiries(s.project_id)
where s.project_type is null and s.project_id is not null;

create or replace function app.secured_type_default() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_type is null and new.project_id is not null then new.project_type := app.type_from_inquiries(new.project_id); end if;
  -- The plan goes for approval (or is approved) only with the type chosen (the opening list of earlier wins comes in approved)
  if tg_op = 'UPDATE' and new.schedule_status in ('review', 'approved') and old.schedule_status is distinct from new.schedule_status and new.project_type is null then
    raise exception 'Choose the project type – Supply only or Supply & installation';
  end if;
  return new;
end $$;
drop trigger if exists secured_type_default on public.secured_projects;
create trigger secured_type_default before insert or update on public.secured_projects for each row execute function app.secured_type_default();

-- A later won inquiry with installation makes the project Supply & installation (while the plan is not approved)
create or replace function app.inquiry_won_type() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.result = 'won' and old.result is distinct from 'won' and new.estimation_basis in ('supply_install', 'supply_install_commission') then
    update public.secured_projects set project_type = 'supply_install'
     where project_id = new.project_id and project_type = 'supply' and schedule_status <> 'approved';
  end if;
  return new;
end $$;
drop trigger if exists inquiry_won_type on public.inquiries;
create trigger inquiry_won_type after update of result on public.inquiries for each row execute function app.inquiry_won_type();

-- The sales person (or Operations / SM Projects, who edit the plan) sets the type; it is fixed once a supply order or execution project exists
create or replace function public.set_project_type(p_secured uuid, p_type text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.secured_projects;
begin
  select * into s from public.secured_projects where id = p_secured for update;
  perform app.require(s.id is not null, 'Secured project not found');
  perform app.require(app.can_edit_secured(s), 'Only the sales person, Operations or SM Projects set the project type');
  perform app.require(p_type in ('supply', 'supply_install'), 'Choose Supply only or Supply & installation');
  perform app.require(not exists (select 1 from public.supply_orders where secured_id = s.id), 'The supply order is already with SM Estimation');
  perform app.require(p_type = 'supply_install' or not exists (select 1 from public.exec_projects where project_id = s.project_id),
    'The project is already with the execution team');
  update public.secured_projects set project_type = p_type where id = s.id;
  insert into public.secured_log (secured_id, action, note) values (s.id, 'type', case p_type when 'supply' then 'Project type: Supply only' else 'Project type: Supply & installation' end);
end $$;
grant execute on function public.set_project_type(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Supply orders
-- ---------------------------------------------------------------------------
create table if not exists public.supply_orders (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  secured_id uuid not null unique references public.secured_projects (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  mfr_count int not null default 1 check (mfr_count between 1 and 50),
  created_at timestamptz not null default now(),
  flagged_at timestamptz
);

-- One row per manufacturer: its PI (with the costing) and Operations' status
create table if not exists public.supply_pis (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.supply_orders (id) on delete cascade,
  seq int not null default 1,
  manufacturer text not null,
  country text,
  notes text,
  pi_no text,
  pi_date date,
  pi_value numeric(16, 2) check (pi_value is null or pi_value > 0),
  currency text,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles (id),
  revision int not null default 0,
  ops_status text check (ops_status in ('pending', 'ok', 'revision', 'on_hold')),
  ops_note text,
  ops_by uuid references public.profiles (id),
  ops_at timestamptz,
  updated_at timestamptz not null default now(),
  flagged_at timestamptz
);
create index if not exists supply_pis_order on public.supply_pis (order_id, seq);

alter table public.supply_orders enable row level security;
alter table public.supply_pis enable row level security;

create or replace function app.so_can_read(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('gm', 'sm_estimation', 'operations_exec', 'sm_projects')
      or exists (select 1 from public.supply_orders o join public.secured_projects s on s.id = o.secured_id where o.id = p_order and s.sales_person_id = auth.uid())
$$;
create or replace function app.so_estimator() returns boolean language sql stable as $$ select app.has_role('sm_estimation', 'gm') $$;
create or replace function app.so_ops() returns boolean language sql stable as $$ select app.has_role('operations_exec', 'gm') $$;

drop policy if exists supply_orders_read on public.supply_orders;
create policy supply_orders_read on public.supply_orders for select to authenticated using (app.so_can_read(id));
drop policy if exists supply_pis_read on public.supply_pis;
create policy supply_pis_read on public.supply_pis for select to authenticated using (app.so_can_read(order_id));
grant select on public.supply_orders, public.supply_pis to authenticated;

-- Plan approved: Supply only → a supply order for SM Estimation; Supply & installation → Operations raises the hand-over
create or replace function app.secured_plan_approved() returns trigger
language plpgsql security definer set search_path = public as $$
declare oid uuid; c text;
begin
  if new.schedule_status <> 'approved' or old.schedule_status = 'approved' then return new; end if;
  if new.project_type = 'supply' then
    if not exists (select 1 from public.supply_orders where secured_id = new.id) then
      c := app.next_code('SO');
      insert into public.supply_orders (code, secured_id, project_id) values (c, new.id, new.project_id) returning id into oid;
      insert into public.secured_log (secured_id, action, note) values (new.id, 'supply_order', 'Supply only – ' || c || ' to SM Estimation for the manufacturers'' PIs');
      perform app.notify_many(app.role_users('sm_estimation'), 'supply_order', 'Supply-only project – get the manufacturers'' PIs',
        format('%s · %s · %s', c, new.project_name, coalesce(app.display_name(new.sales_person_id), '—')), 'normal', 'supply_order', oid, '/supply-orders/' || oid);
      perform app.notify(new.sales_person_id, 'supply_order', 'Supply only – with SM Estimation for the PIs', c || ' · ' || new.project_name,
        'normal', 'supply_order', oid, '/supply-orders/' || oid);
    end if;
  elsif new.project_type = 'supply_install' and new.project_id is not null
        and not exists (select 1 from public.exec_projects where project_id = new.project_id)
        and not exists (select 1 from public.exec_requests where project_id = new.project_id and status = 'pending_smp') then
    perform app.notify_many(app.role_users('operations_exec'), 'exec_handover_due', 'Supply & installation project won – raise the execution hand-over',
      new.project_name || ' · ' || coalesce(app.display_name(new.sales_person_id), '—'), 'normal', 'secured_project', new.id, app.secured_url(new.id));
  end if;
  return new;
end $$;
drop trigger if exists secured_plan_approved on public.secured_projects;
create trigger secured_plan_approved after update of schedule_status on public.secured_projects for each row execute function app.secured_plan_approved();

-- A supply-only project does not go to execution
create or replace function app.exec_request_not_supply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is not null and exists (select 1 from public.secured_projects where project_id = new.project_id and project_type = 'supply') then
    raise exception 'This is a supply-only project – it goes to SM Estimation for the manufacturers'' PIs, not to execution';
  end if;
  return new;
end $$;
drop trigger if exists exec_request_not_supply on public.exec_requests;
create trigger exec_request_not_supply before insert on public.exec_requests for each row execute function app.exec_request_not_supply();

-- ---------------------------------------------------------------------------
-- SM Estimation: the number of manufacturers, each one's details and PI, submitted as they arrive
-- ---------------------------------------------------------------------------
create or replace function public.so_set_count(p_order uuid, p_n int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.so_estimator(), 'SM Estimation sets the manufacturers');
  perform app.require(p_n between 1 and 50, 'Between 1 and 50 manufacturers');
  perform app.require(p_n >= (select count(*) from public.supply_pis where order_id = p_order),
    'There are more manufacturers entered – remove the ones not needed first');
  update public.supply_orders set mfr_count = p_n, flagged_at = null where id = p_order;
end $$;

create or replace function public.so_save_pi(p_id uuid, p_order uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.supply_pis; o public.supply_orders; nid uuid;
begin
  perform app.require(app.so_estimator(), 'SM Estimation enters the manufacturers and PIs');
  perform app.require(coalesce(btrim(p ->> 'manufacturer'), '') <> '', 'Enter the manufacturer');
  if p_id is null then
    select * into o from public.supply_orders where id = p_order;
    perform app.require(o.id is not null, 'Supply order not found');
    perform app.require((select count(*) from public.supply_pis where order_id = o.id) < o.mfr_count,
      format('All %s manufacturers are entered – raise the number first', o.mfr_count));
    insert into public.supply_pis (order_id, seq, manufacturer) values (o.id, coalesce((select max(seq) from public.supply_pis where order_id = o.id), 0) + 1, btrim(p ->> 'manufacturer'))
    returning id into nid;
    select * into r from public.supply_pis where id = nid;
  else
    select * into r from public.supply_pis where id = p_id for update;
    perform app.require(r.id is not null, 'Manufacturer not found');
  end if;
  -- Once submitted the PI is Operations'; it opens again when they ask for a revision
  perform app.require(r.submitted_at is null or r.ops_status = 'revision', 'This PI is submitted – Operations asks for a revision if it must change');
  update public.supply_pis set
    manufacturer = btrim(p ->> 'manufacturer'),
    country = nullif(btrim(p ->> 'country'), ''),
    notes = nullif(btrim(p ->> 'notes'), ''),
    pi_no = nullif(btrim(p ->> 'pi_no'), ''),
    pi_date = nullif(p ->> 'pi_date', '')::date,
    pi_value = nullif(p ->> 'pi_value', '')::numeric,
    currency = nullif(upper(btrim(p ->> 'currency')), ''),
    updated_at = now(), flagged_at = null
  where id = r.id;
  return r.id;
end $$;

create or replace function public.so_delete_pi(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.so_estimator(), 'SM Estimation removes manufacturers');
  perform app.require(exists (select 1 from public.supply_pis where id = p_id and submitted_at is null), 'A submitted PI stays on the order');
  delete from public.supply_pis where id = p_id;
end $$;

-- Submit one or several manufacturers' PIs to Operations
create or replace function public.so_submit(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare r public.supply_pis; o public.supply_orders; s public.secured_projects; n int := 0; done int; names text[] := '{}';
begin
  perform app.require(app.so_estimator(), 'SM Estimation submits the PIs');
  perform app.require(cardinality(p_ids) > 0, 'Choose the PIs to submit');
  for r in select * from public.supply_pis where id = any (p_ids) for update loop
    perform app.require(r.submitted_at is null or r.ops_status = 'revision', format('%s is already submitted', r.manufacturer));
    perform app.require(r.pi_no is not null and r.pi_date is not null and r.pi_value is not null and r.currency is not null,
      format('%s: enter the PI number, date, value and currency', r.manufacturer));
    perform app.require(exists (select 1 from public.attachments where entity_type = 'supply_pi' and entity_id = r.id and kind = 'supply_pi' and archived_at is null),
      format('%s: attach the PI', r.manufacturer));
    update public.supply_pis set submitted_at = now(), submitted_by = auth.uid(), ops_status = 'pending', ops_note = null, ops_by = null, ops_at = null,
      revision = case when r.ops_status = 'revision' then r.revision + 1 else r.revision end, updated_at = now(), flagged_at = null
     where id = r.id;
    names := names || r.manufacturer;
    n := n + 1;
    o.id := r.order_id;
  end loop;
  perform app.require(n > 0, 'Nothing to submit');
  select * into o from public.supply_orders where id = o.id;
  select * into s from public.secured_projects where id = o.secured_id;
  select count(*) into done from public.supply_pis where order_id = o.id and submitted_at is not null;
  perform app.notify_many(app.role_users('operations_exec'), 'supply_pi', format('PI submitted – %s (%s of %s)', s.project_name, done, o.mfr_count),
    format('%s · %s', o.code, array_to_string(names, ', ')), 'normal', 'supply_order', o.id, '/supply-orders/' || o.id);
  if done >= o.mfr_count then
    perform app.notify(s.sales_person_id, 'supply_pi', 'All PIs submitted to Operations', o.code || ' · ' || s.project_name, 'normal', 'supply_order', o.id, '/supply-orders/' || o.id);
  end if;
  return n;
end $$;

-- Operations: the status of a submitted PI
create or replace function public.so_set_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.supply_pis; o public.supply_orders; s public.secured_projects;
begin
  perform app.require(app.so_ops(), 'Operations sets the PI status');
  perform app.require(p_status in ('ok', 'revision', 'on_hold'), 'Choose OK, Revision requested or On hold');
  perform app.require(p_status = 'ok' or coalesce(btrim(p_note), '') <> '', 'Write what is needed (or why it is on hold)');
  select * into r from public.supply_pis where id = p_id for update;
  perform app.require(r.submitted_at is not null, 'The PI is not submitted yet');
  update public.supply_pis set ops_status = p_status, ops_note = nullif(btrim(p_note), ''), ops_by = auth.uid(), ops_at = now(), updated_at = now(), flagged_at = null
   where id = r.id;
  select * into o from public.supply_orders where id = r.order_id;
  select * into s from public.secured_projects where id = o.secured_id;
  if p_status = 'revision' then
    perform app.notify_many(app.role_users('sm_estimation'), 'supply_pi', 'PI revision requested – ' || r.manufacturer,
      format('%s · %s · %s', o.code, s.project_name, btrim(p_note)), 'normal', 'supply_order', o.id, '/supply-orders/' || o.id);
  elsif p_status = 'on_hold' then
    perform app.notify_many(app.role_users('sm_estimation') || s.sales_person_id, 'supply_pi', 'PI on hold – ' || r.manufacturer,
      format('%s · %s · %s', o.code, s.project_name, btrim(p_note)), 'normal', 'supply_order', o.id, '/supply-orders/' || o.id);
  else
    perform app.notify(s.sales_person_id, 'supply_pi', 'PI OK with Operations – ' || r.manufacturer, o.code || ' · ' || s.project_name,
      'normal', 'supply_order', o.id, '/supply-orders/' || o.id);
  end if;
end $$;

-- The list for SM Estimation, Operations, SM Projects, the DGM and the sales person (their own)
create or replace function public.so_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]') from (
    select jsonb_build_object('id', o.id, 'code', o.code, 'created_at', o.created_at, 'mfr_count', o.mfr_count, 'secured_id', o.secured_id,
      'project', s.project_name, 'customer', s.customer, 'sales_person_id', s.sales_person_id, 'order_value', s.order_value,
      'submitted', (select count(*) from public.supply_pis p where p.order_id = o.id and p.submitted_at is not null),
      'pis', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'seq', p.seq, 'manufacturer', p.manufacturer, 'country', p.country, 'pi_no', p.pi_no,
                'pi_value', p.pi_value, 'currency', p.currency, 'submitted_at', p.submitted_at, 'ops_status', p.ops_status, 'ops_note', p.ops_note) order by p.seq), '[]')
              from public.supply_pis p where p.order_id = o.id)) x
    from public.supply_orders o join public.secured_projects s on s.id = o.secured_id
    where app.so_can_read(o.id)) t
$$;

-- Nothing moving for 5 working days: SM Estimation (PIs to enter or revise) or Operations (PIs to handle) and the DGM are told once
create or replace function public.so_tick() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; wd int := app.working_minutes_per_day();
begin
  for r in
    select o.id, o.code, s.project_name, o.mfr_count - (select count(*) from public.supply_pis p where p.order_id = o.id and p.submitted_at is not null) missing
    from public.supply_orders o join public.secured_projects s on s.id = o.secured_id
    where o.flagged_at is null and s.status = 'open'
      and o.mfr_count > (select count(*) from public.supply_pis p where p.order_id = o.id and p.submitted_at is not null)
      and app.work_minutes_between(greatest(o.created_at, coalesce((select max(updated_at) from public.supply_pis p where p.order_id = o.id), o.created_at)), now()) >= 5 * wd
  loop
    perform app.notify_many(app.role_users('sm_estimation') || app.role_users('gm'), 'supply_late', 'PIs still pending – ' || r.project_name,
      format('%s · %s manufacturer(s) not submitted for 5 working days', r.code, r.missing), 'normal', 'supply_order', r.id, '/supply-orders/' || r.id);
    update public.supply_orders set flagged_at = now() where id = r.id;
    n := n + 1;
  end loop;
  for r in
    select p.id, p.order_id, p.manufacturer, p.ops_status, o.code, s.project_name
    from public.supply_pis p join public.supply_orders o on o.id = p.order_id join public.secured_projects s on s.id = o.secured_id
    where p.flagged_at is null and p.submitted_at is not null and p.ops_status in ('pending', 'revision', 'on_hold')
      and app.work_minutes_between(p.updated_at, now()) >= 5 * wd
  loop
    perform app.notify_many((case when r.ops_status = 'revision' then app.role_users('sm_estimation') else app.role_users('operations_exec') end) || app.role_users('gm'),
      'supply_late', format('PI %s for 5 working days – %s', case r.ops_status when 'pending' then 'not handled' when 'revision' then 'revision not sent' else 'on hold' end, r.manufacturer),
      r.code || ' · ' || r.project_name, 'normal', 'supply_order', r.order_id, '/supply-orders/' || r.order_id);
    update public.supply_pis set flagged_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.so_tick() from public, anon, authenticated;
grant execute on function public.so_tick() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('so-tick', '35 3 * * 1-6', 'select public.so_tick()');   -- 09:05 Sri Lanka time
  end if;
end $$;

-- PI and costing files on a manufacturer's row: SM Estimation attaches while the PI is open, everyone on the order reads them
do $$
declare def text;
begin
  def := pg_get_functiondef('app.can_read_attachment(public.attachments)'::regprocedure);
  perform app.require(position('  case a.entity_type' || chr(10) in def) > 0, 'can_read_attachment anchor not found');
  def := replace(def, '  case a.entity_type' || chr(10),
    '  case a.entity_type' || chr(10) || '  when ''supply_pi'' then' || chr(10) ||
    '    return exists (select 1 from public.supply_pis p where p.id = a.entity_id and app.so_can_read(p.order_id));' || chr(10));
  execute def;
  def := pg_get_functiondef('app.can_write_attachment(text, uuid, text)'::regprocedure);
  perform app.require(position('  case p_entity_type' || chr(10) in def) > 0, 'can_write_attachment anchor not found');
  def := replace(def, '  case p_entity_type' || chr(10),
    '  case p_entity_type' || chr(10) || '  when ''supply_pi'' then return p_kind in (''supply_pi'', ''supply_costing'') and app.so_estimator()' ||
    ' and exists (select 1 from public.supply_pis where id = p_entity_id and (submitted_at is null or ops_status = ''revision''));' || chr(10));
  execute def;
end $$;

grant execute on function public.so_set_count(uuid, int), public.so_save_pi(uuid, uuid, jsonb), public.so_delete_pi(uuid), public.so_submit(uuid[]),
  public.so_set_status(uuid, text, text), public.so_list() to authenticated;

select app.fix_function_owners();
