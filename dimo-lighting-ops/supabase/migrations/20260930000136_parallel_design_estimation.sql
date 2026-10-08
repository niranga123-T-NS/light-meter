-- Design + estimation inquiries: one deadline, both teams start together.
--  * Deadline type: a client deadline (can be extended on request) or a tender closing date (fixed unless the client
--    issues an addendum). Tenders keep the closing date and time, the tender reference and how the bid is submitted.
--  * The deadline is split once: release (1 working day, 2 for tenders), final pricing (1–2 days by size) and the rest
--    for design. SM Projects approves the design date as before; on approval the estimation job opens straight away as a
--    pre-estimate, and turns into final pricing when the design is released.
--  * Extension record: ask the client (work continues to the current date) → granted (new date, client's e-mail
--    attached, dates re-split) or refused. Tenders: "extended by the client" with the addendum.
--  * One alert when the design is late (tenders: at 70 % of the design time if the design is behind).
--  * design_pipeline(): the "Design in progress" panel for SM Estimation and its mirror for the Design Manager.

alter table public.inquiries
  add column if not exists deadline_type text not null default 'client' check (deadline_type in ('client', 'tender')),
  add column if not exists tender_closes_at timestamptz,
  add column if not exists tender_ref text,
  add column if not exists tender_submission text check (tender_submission in ('online', 'hard_copy', 'email')),
  add column if not exists estimation_due_at timestamptz,
  add column if not exists design_due_approved_at timestamptz,
  add column if not exists design_late_alerted_at timestamptz,
  add column if not exists extension_status text check (extension_status in ('requested', 'granted', 'refused'));

alter table public.estimation_jobs
  add column if not exists phase text not null default 'final' check (phase in ('pre', 'final'));

-- A tender's deadline is its closing date; the closing time is kept separately
create or replace function app.inquiry_tender_deadline() returns trigger
language plpgsql as $$
begin
  if new.deadline_type = 'tender' then
    if new.tender_closes_at is not null then
      new.customer_deadline := (new.tender_closes_at at time zone app.tz())::date;
    elsif new.status not in ('draft', 'returned_for_info') then
      raise exception 'Give the tender closing date and time';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists inquiry_tender_deadline on public.inquiries;
create trigger inquiry_tender_deadline before insert or update of deadline_type, tender_closes_at, status on public.inquiries
for each row execute function app.inquiry_tender_deadline();

-- ---------------------------------------------------------------------------
-- The split
-- ---------------------------------------------------------------------------
create or replace function app.wd_back(d date, n int) returns date
language plpgsql stable as $$
declare x date := d; k int := 0;
begin
  while k < n loop
    x := x - 1;
    if app.is_working_day(x) then k := k + 1; end if;
  end loop;
  return x;
end $$;

create or replace function app.deadline_end(i public.inquiries) returns timestamptz
language sql stable as $$
  select case when i.deadline_type = 'tender' and i.tender_closes_at is not null then i.tender_closes_at
              when i.customer_deadline is not null then (i.customer_deadline + app.work_end()) at time zone app.tz() end
$$;

-- Working days kept for checking and sending: 1 for a client deadline, 2 for a tender (sealing, uploads, couriers)
create or replace function app.release_days(i public.inquiries) returns int
language sql immutable as $$ select case when i.deadline_type = 'tender' then 2 else 1 end $$;

-- Final pricing after the design: 1 working day for small jobs (budget up to LKR 25 Mn), otherwise 2
create or replace function app.pricing_days(i public.inquiries) returns int
language sql immutable as $$ select case when coalesce(i.budget_lkr, 0) between 1 and 25000000 then 1 else 2 end $$;

create or replace function app.deadline_split(i public.inquiries) returns jsonb
language plpgsql stable as $$
declare
  e timestamptz := app.deadline_end(i);
  d date;
  r int := app.release_days(i);
  p int := app.pricing_days(i);
  est timestamptz; des timestamptz; mx timestamptz;
begin
  if e is null then return null; end if;
  d := (e at time zone app.tz())::date;
  est := (app.wd_back(d, r) + app.work_end()) at time zone app.tz();
  des := (app.wd_back(d, r + p) + app.work_end()) at time zone app.tz();
  mx := (app.wd_back(d, r + 1) + app.work_end()) at time zone app.tz();
  return jsonb_build_object(
    'deadline_type', i.deadline_type, 'deadline', e, 'release_days', r, 'pricing_days', p,
    'design_due', des, 'design_latest', mx, 'estimation_due', est,
    'design_days', round(app.work_minutes_between(greatest(now(), coalesce(i.design_due_approved_at, now())), des) / app.working_minutes_per_day(), 1),
    'tight', des <= now());
end $$;

create or replace function public.deadline_split(p_inquiry uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.can_read_inquiry(p_inquiry), 'Not allowed');
  return app.deadline_split(app.inq(p_inquiry));
end $$;
revoke execute on function public.deadline_split(uuid) from public, anon;
grant execute on function public.deadline_split(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Approved design date → the estimation job opens now as a pre-estimate
-- ---------------------------------------------------------------------------
create or replace function app.start_parallel_estimate(p_inquiry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); ej uuid;
begin
  if i.route <> 'A' or coalesce(i.release_mode, 3) = 1 or i.status not in ('accepted', 'in_design', 'design_review', 'design_approved') then
    return;
  end if;
  select id into ej from public.estimation_jobs where inquiry_id = i.id and revision = i.revision order by created_at desc limit 1;
  if ej is not null then
    update public.estimation_jobs set phase = 'pre'
     where id = ej and status not in ('submitted_for_approval', 'gm_approval', 'approved', 'released');
    return;
  end if;
  insert into public.estimation_jobs (inquiry_id, revision, source, status, phase) values (i.id, i.revision, 'design', 'queued', 'pre') returning id into ej;
  perform app.log_status('estimation_job', ej, i.id, null, 'queued', 'Opened with the design (pre-estimate)');
  perform app.start_clock(i.id, 'estimation_job', ej, 'acceptance', (app.role_users('sm_estimation'))[1], null, 'Estimation acceptance');
  perform app.notify_many(app.role_users('sm_estimation'), 'pre_estimate_opened', 'Estimate starts with the design: ' || i.code,
    format('%s – %s. Design by %s · final pricing by %s · %s %s. Price everything that does not depend on the design now; add the designed fixtures when the design is released.',
      coalesce(i.inquiry_name, i.project_name), i.customer_name, to_char(i.design_due_at at time zone app.tz(), 'DD Mon'),
      to_char(i.estimation_due_at at time zone app.tz(), 'DD Mon'),
      case when i.deadline_type = 'tender' then 'tender closes' else 'client deadline' end,
      to_char(app.deadline_end(i) at time zone app.tz(), 'DD Mon HH24:MI')),
    'normal', 'estimation_job', ej, '/estimation/' || ej);
end $$;

create or replace function app.inquiry_design_due_approved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.design_due_status = 'approved' and old.design_due_status is distinct from 'approved' then
    perform set_config('app.workflow', '1', true);
    update public.inquiries set design_due_approved_at = now(), design_late_alerted_at = null,
      estimation_due_at = (app.deadline_split(new) ->> 'estimation_due')::timestamptz
     where id = new.id;
    perform app.start_parallel_estimate(new.id);
  end if;
  return new;
end $$;
drop trigger if exists inquiry_design_due_approved on public.inquiries;
create trigger inquiry_design_due_approved after update of design_due_status on public.inquiries
for each row execute function app.inquiry_design_due_approved();

-- ---------------------------------------------------------------------------
-- Deadline extensions
-- ---------------------------------------------------------------------------
create table if not exists public.deadline_extensions (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries (id),
  kind text not null check (kind in ('client_request', 'tender_addendum', 'direct')),
  old_deadline timestamptz,
  proposed_deadline date,
  new_deadline timestamptz,
  reason text,
  addendum_ref text,
  status text not null check (status in ('requested', 'granted', 'refused')),
  decision_note text,
  requested_by uuid default auth.uid() references public.profiles (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz
);
create index if not exists deadline_extensions_inquiry on public.deadline_extensions (inquiry_id, requested_at);
alter table public.deadline_extensions enable row level security;
drop policy if exists deadline_extensions_read on public.deadline_extensions;
create policy deadline_extensions_read on public.deadline_extensions for select to authenticated using (app.can_read_inquiry(inquiry_id));
grant select on public.deadline_extensions to authenticated;

create or replace function app.design_team_of(i public.inquiries) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select assignee_id x from public.design_jobs where inquiry_id = i.id and revision = i.revision and status not in ('released')
    union all
    select assignee_id from public.estimation_jobs where inquiry_id = i.id and revision = i.revision and status not in ('released')) s
  where x is not null
$$;

-- Moves the deadline and re-splits the dates: the design date only ever moves later; the open estimate follows the new
-- final-pricing date. Designers keep their own task dates (the Design Manager can move them up to the new design date).
create or replace function app.apply_deadline(p_inquiry uuid, p_date date, p_closes timestamptz, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  n public.inquiries;
  s jsonb;
  j record;
  new_est timestamptz;
  old_end timestamptz := app.deadline_end(i);
begin
  perform set_config('app.workflow', '1', true);
  update public.inquiries set
    tender_closes_at = case when deadline_type = 'tender' then coalesce(p_closes, tender_closes_at) else tender_closes_at end,
    customer_deadline = case when deadline_type = 'tender' and p_closes is not null then (p_closes at time zone app.tz())::date else coalesce(p_date, customer_deadline) end,
    deadline_critical_sent = false, deadline_missed_sent = false
  where id = i.id;
  n := app.inq(i.id);
  insert into public.due_date_changes (entity_type, entity_id, inquiry_id, field, old_value, new_value, reason)
  values ('inquiry', i.id, i.id, case when n.deadline_type = 'tender' then 'tender_closes_at' else 'customer_deadline' end,
          old_end, app.deadline_end(n), p_reason);
  if n.route = 'A' and n.design_due_status = 'approved' then
    s := app.deadline_split(n);
    new_est := (s ->> 'estimation_due')::timestamptz;
    update public.inquiries set
      design_due_at = case when status in ('accepted', 'in_design', 'design_review') then greatest(design_due_at, (s ->> 'design_due')::timestamptz) else design_due_at end,
      estimation_due_at = new_est,
      design_late_alerted_at = null
    where id = n.id;
    for j in select * from public.estimation_jobs
              where inquiry_id = n.id and revision = n.revision and due_at is not null and due_at < new_est
                and status in ('assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested') loop
      insert into public.due_date_changes (entity_type, entity_id, inquiry_id, field, old_value, new_value, reason)
      values ('estimation_job', j.id, n.id, 'due_at', j.due_at, new_est, 'Deadline extended: ' || p_reason);
      update public.estimation_jobs set due_at = new_est where id = j.id;
      if exists (select 1 from public.sla_clocks where entity_type = 'estimation_job' and entity_id = j.id and stage = 'estimation' and stopped_at is null) then
        perform app.start_clock(n.id, 'estimation_job', j.id, 'estimation', j.assignee_id, new_est, 'Estimation');
      end if;
    end loop;
    n := app.inq(n.id);
  end if;
  perform app.notify_many(array[n.sales_person_id] || app.role_users('design_manager') || app.role_users('sm_estimation')
                          || app.role_users('sm_projects') || app.design_team_of(n),
    'deadline_extended', case when n.deadline_type = 'tender' then 'Tender closing extended: ' else 'Client deadline extended: ' end || n.code,
    format('%s → %s.%s %s', to_char(old_end at time zone app.tz(), 'DD Mon HH24:MI'), to_char(app.deadline_end(n) at time zone app.tz(), 'DD Mon HH24:MI'),
      case when n.estimation_due_at is not null then format(' Design by %s · final pricing by %s.',
        to_char(n.design_due_at at time zone app.tz(), 'DD Mon'), to_char(n.estimation_due_at at time zone app.tz(), 'DD Mon')) else '' end,
      p_reason),
    'normal', 'inquiry', n.id, app.inquiry_url(n.id));
  perform app.refresh_inquiry(n.id);
end $$;

create or replace function app.inquiry_open(i public.inquiries) returns boolean
language sql immutable as $$
  select i.status not in ('draft', 'won', 'lost', 'cancelled', 'rejected', 'quotation_released', 'returned_to_sales',
                          'submitted_to_client', 'awaiting_client_approval', 'client_approved')
$$;

create or replace function public.request_deadline_extension(p_inquiry uuid, p_proposed date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); xid uuid;
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm', 'design_manager', 'sm_estimation'),
    'Only the sales person, SM Projects, the Design Manager or SM Estimation can ask for an extension');
  perform app.require(i.deadline_type = 'client', 'A tender closing date is fixed – record it only if the client extends the tender');
  perform app.require(app.inquiry_open(i), 'This inquiry is not in progress');
  perform app.require(p_proposed > i.customer_deadline, format('Propose a date after the current deadline (%s)', to_char(i.customer_deadline, 'DD Mon')));
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason for the extension');
  perform app.require(not exists (select 1 from public.deadline_extensions where inquiry_id = i.id and status = 'requested'),
    'An extension request is already open – record the client''s answer first');
  insert into public.deadline_extensions (inquiry_id, kind, old_deadline, proposed_deadline, reason, status)
  values (i.id, 'client_request', app.deadline_end(i), p_proposed, btrim(p_reason), 'requested') returning id into xid;
  perform set_config('app.workflow', '1', true);
  update public.inquiries set extension_status = 'requested' where id = i.id;
  perform app.notify_many(array[i.sales_person_id] || app.role_users('design_manager') || app.role_users('sm_estimation') || app.role_users('sm_projects'),
    'deadline_extension_requested', 'Extension to ask the client: ' || i.code,
    format('Asking to move %s → %s. %s. Everyone keeps working to %s until the client agrees.',
      to_char(i.customer_deadline, 'DD Mon'), to_char(p_proposed, 'DD Mon'), btrim(p_reason), to_char(i.customer_deadline, 'DD Mon')),
    'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  return xid;
end $$;

create or replace function public.record_extension_outcome(p_ext uuid, p_granted boolean, p_new_deadline date default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare x public.deadline_extensions; i public.inquiries; late boolean;
begin
  select * into x from public.deadline_extensions where id = p_ext for update;
  perform app.require(x.id is not null, 'Extension request not found');
  i := app.inq(x.inquiry_id);
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person or SM Projects records the client''s answer');
  perform app.require(x.status = 'requested', 'The client''s answer is already recorded');
  perform set_config('app.workflow', '1', true);
  if p_granted then
    perform app.require(p_new_deadline is not null and p_new_deadline > i.customer_deadline,
      format('Give the new deadline the client agreed (after %s)', to_char(i.customer_deadline, 'DD Mon')));
    perform app.require(exists (select 1 from public.attachments where entity_type = 'inquiry' and entity_id = i.id and kind = 'deadline_extension'
                                  and archived_at is null and uploaded_at >= x.requested_at),
      'Attach the client''s e-mail or letter granting the extension');
    update public.deadline_extensions set status = 'granted', new_deadline = (p_new_deadline + app.work_end()) at time zone app.tz(),
      decision_note = nullif(btrim(p_note), ''), decided_by = auth.uid(), decided_at = now() where id = x.id;
    update public.inquiries set extension_status = 'granted' where id = i.id;
    perform app.apply_deadline(i.id, p_new_deadline, null, 'Client granted the extension' || coalesce(' – ' || nullif(btrim(p_note), ''), ''));
  else
    update public.deadline_extensions set status = 'refused', decision_note = nullif(btrim(p_note), ''), decided_by = auth.uid(), decided_at = now() where id = x.id;
    update public.inquiries set extension_status = 'refused' where id = i.id;
    late := i.route = 'A' and i.status in ('accepted', 'in_design') and i.design_due_at is not null and now() > i.design_due_at;
    perform app.notify_many(app.role_users('design_manager') || app.role_users('sm_estimation') || app.role_users('sm_projects') || app.design_team_of(i),
      'deadline_extension_refused', 'Extension refused: ' || i.code,
      format('The deadline stays %s.%s%s', to_char(i.customer_deadline, 'DD Mon'),
        case when late then ' The design is already past its date – plan to finish on time.' else '' end,
        coalesce(' ' || nullif(btrim(p_note), ''), '')),
      case when late then 'critical' else 'normal' end::public.priority, 'inquiry', i.id, app.inquiry_url(i.id));
  end if;
end $$;

create or replace function public.record_tender_extension(p_inquiry uuid, p_new_closes timestamptz, p_addendum text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry); xid uuid; since timestamptz;
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person or SM Projects records a tender extension');
  perform app.require(i.deadline_type = 'tender', 'This is not a tender – use “Ask client for extension”');
  perform app.require(app.inquiry_open(i), 'This inquiry is not in progress');
  perform app.require(p_new_closes > i.tender_closes_at,
    format('The new closing must be after the current one (%s)', to_char(i.tender_closes_at at time zone app.tz(), 'DD Mon HH24:MI')));
  perform app.require(coalesce(btrim(p_addendum), '') <> '', 'Give the addendum number or reference');
  since := coalesce((select max(decided_at) from public.deadline_extensions where inquiry_id = i.id and kind = 'tender_addendum'), i.created_at);
  perform app.require(exists (select 1 from public.attachments where entity_type = 'inquiry' and entity_id = i.id and kind = 'tender_addendum'
                                and archived_at is null and uploaded_at >= since),
    'Attach the tender addendum');
  insert into public.deadline_extensions (inquiry_id, kind, old_deadline, new_deadline, reason, addendum_ref, status, decided_by, decided_at)
  values (i.id, 'tender_addendum', i.tender_closes_at, p_new_closes, nullif(btrim(p_note), ''), btrim(p_addendum), 'granted', auth.uid(), now())
  returning id into xid;
  perform app.apply_deadline(i.id, null, p_new_closes, 'Tender extended – ' || btrim(p_addendum) || coalesce(' – ' || nullif(btrim(p_note), ''), ''));
  return xid;
end $$;

create or replace function public.extend_customer_deadline(p_inquiry uuid, p_new_deadline date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry);
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person can extend the deadline');
  perform app.require(i.deadline_type = 'client', 'Tender closing dates change only by addendum – use “Tender extended by the client”');
  perform app.require(coalesce(trim(p_reason), '') <> '', 'Give the reason for the extension');
  insert into public.deadline_extensions (inquiry_id, kind, old_deadline, new_deadline, reason, status, decided_by, decided_at)
  values (i.id, 'direct', app.deadline_end(i), (p_new_deadline + app.work_end()) at time zone app.tz(), p_reason, 'granted', auth.uid(), now());
  perform app.apply_deadline(i.id, p_new_deadline, null, p_reason);
end $$;

-- ---------------------------------------------------------------------------
-- One alert when the design is late
-- ---------------------------------------------------------------------------
create or replace function public.design_split_tick() returns int
language plpgsql security definer set search_path = public as $$
declare r public.inquiries; prog int; late boolean; behind boolean; n int := 0;
begin
  for r in select * from public.inquiries
            where route = 'A' and design_due_status = 'approved' and design_due_at is not null and design_late_alerted_at is null
              and status in ('accepted', 'in_design') loop
    select coalesce(avg(progress_pct), 0)::int into prog from public.design_jobs where inquiry_id = r.id and revision = r.revision;
    late := now() > r.design_due_at;
    behind := r.deadline_type = 'tender' and r.design_due_approved_at is not null and prog < 70
              and app.work_minutes_between(r.design_due_approved_at, now()) >= 0.7 * app.work_minutes_between(r.design_due_approved_at, r.design_due_at);
    if late or behind then
      perform app.notify_many(app.role_users('design_manager') || app.role_users('sm_estimation') || app.role_users('sm_projects'),
        'design_late', case when late then 'Design late: ' else 'Tender design behind: ' end || r.code,
        format('%s – %s. Design due %s, %s%% done. Final pricing by %s · %s %s. Add a designer, cut scope, or ask for more time.',
          coalesce(r.inquiry_name, r.project_name), r.customer_name, to_char(r.design_due_at at time zone app.tz(), 'DD Mon HH24:MI'), prog,
          to_char(r.estimation_due_at at time zone app.tz(), 'DD Mon'),
          case when r.deadline_type = 'tender' then 'tender closes (fixed)' else 'client deadline' end,
          to_char(app.deadline_end(r) at time zone app.tz(), 'DD Mon HH24:MI')),
        'critical', 'inquiry', r.id, app.inquiry_url(r.id), 'design_late:' || r.id || ':' || r.design_due_at);
      perform set_config('app.workflow', '1', true);
      update public.inquiries set design_late_alerted_at = now() where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.design_split_tick() from public, anon, authenticated;
grant execute on function public.design_split_tick() to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('design-split-tick', '*/15 * * * *', 'select public.design_split_tick()');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- "Design in progress" – SM Estimation's panel and the Design Manager's mirror
-- ---------------------------------------------------------------------------
create or replace function public.design_pipeline() returns table (
  inquiry_id uuid, code text, title text, customer_name text, deadline_type text, deadline_at timestamptz, tender_ref text,
  design_due_at timestamptz, design_due_status text, designers text, design_progress int, inquiry_status text,
  estimation_job_id uuid, estimation_status text, estimation_phase text, estimator text, estimation_due_at timestamptz,
  estimation_days numeric, late boolean, extension_status text
) language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.has_role('sm_estimation', 'am_estimation', 'design_manager', 'sm_projects', 'gm'), 'Not allowed');
  return query
  select i.id, i.code, coalesce(i.inquiry_name, i.project_name), i.customer_name, i.deadline_type, app.deadline_end(i), i.tender_ref,
         i.design_due_at, i.design_due_status,
         (select string_agg(distinct app.display_name(d.assignee_id), ', ') from public.design_jobs d where d.inquiry_id = i.id and d.revision = i.revision),
         coalesce((select avg(case when d.status in ('in_review', 'approved', 'released') then 100 else d.progress_pct end)
                     from public.design_jobs d where d.inquiry_id = i.id and d.revision = i.revision), 0)::int,
         i.status, e.id, e.status, e.phase, app.display_name(e.assignee_id), i.estimation_due_at,
         case when i.design_due_at is not null and i.estimation_due_at is not null
              then round(app.work_minutes_between(greatest(i.design_due_at, now()), i.estimation_due_at) / app.working_minutes_per_day(), 1) end,
         i.status in ('accepted', 'in_design') and i.design_due_at is not null and now() > i.design_due_at,
         i.extension_status
    from public.inquiries i
    left join lateral (select * from public.estimation_jobs x where x.inquiry_id = i.id and x.revision = i.revision order by x.created_at desc limit 1) e on true
   where i.route = 'A' and coalesce(i.release_mode, 3) <> 1
     and i.status in ('accepted', 'in_design', 'design_review', 'design_approved')
   order by app.deadline_end(i) nulls last;
end $$;
revoke execute on function public.design_pipeline() from public, anon;
grant execute on function public.design_pipeline() to authenticated, service_role;


create or replace function public.propose_design_due(p_inquiry uuid, p_due timestamptz, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  deadline timestamptz;
  wpd numeric := app.working_minutes_per_day();
  est_days numeric;
  std_days numeric := round(app.sla_target('estimation_medium') / app.working_minutes_per_day(), 1);
  s jsonb := app.deadline_split(app.inq(p_inquiry));
begin
  perform set_config('app.workflow', '1', true);
  perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager sets the design completion date');
  perform app.require(i.route = 'A', 'Only design → estimation inquiries need an approved design completion date');
  perform app.require(i.status in ('accepted', 'in_design', 'design_review'), 'Accept the inquiry first');
  perform app.require(p_due > now(), 'The completion date must be in the future');
  deadline := app.deadline_end(i);
  perform app.require(p_due < deadline, 'The design must be complete before the customer deadline');
  -- At least 1 working day of final pricing, then the release days (1, or 2 for a tender)
  perform app.require(p_due <= (s ->> 'design_latest')::timestamptz,
    format('The design must be complete by %s – that leaves 1 working day for final pricing and %s for release before the %s',
      to_char((s ->> 'design_latest')::timestamptz at time zone app.tz(), 'DD Mon'), app.release_days(i) || ' working day' || case when app.release_days(i) > 1 then 's' else '' end,
      case when i.deadline_type = 'tender' then 'tender closes' else 'client deadline' end));
  est_days := round(app.work_minutes_between(p_due, (s ->> 'estimation_due')::timestamptz) / wpd, 1);
  update public.inquiries set design_due_proposed_at = p_due, design_due_status = 'pending' where id = i.id;
  return app.create_approval('design_due', 'inquiry', i.id, i.id, 'Design completion date – ' || i.code,
    format('Design complete by %s · leaves %s working days for estimation (final pricing by %s; standard %s) · %s %s · release %s day(s)%s · estimation starts now with a pre-estimate%s%s',
      to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI'), est_days, to_char((s ->> 'estimation_due')::timestamptz at time zone app.tz(), 'DD Mon'), std_days,
      case when i.deadline_type = 'tender' then 'tender closes' else 'client deadline' end, to_char(deadline at time zone app.tz(), 'DD Mon HH24:MI'),
      app.release_days(i), case when i.deadline_type = 'tender' then ' (fixed closing)' else '' end,
      case when est_days < std_days then ' · SHORTER THAN STANDARD' else '' end,
      case when coalesce(trim(p_note), '') <> '' then ' · ' || p_note else '' end),
    array['sm_projects']::public.app_role[],
    jsonb_build_object('due', p_due, 'estimation_days', est_days, 'standard_days', std_days, 'estimation_due', s ->> 'estimation_due'));
end $$;

create or replace function public.release_design(p_inquiry uuid, p_justification text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  brands jsonb;
  ej uuid;
begin
  perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager releases designs');
  perform app.require(i.status = 'design_approved', 'Every design task must be approved before release');
  perform app.require(i.release_mode_confirmed, 'SM Projects has not confirmed the release mode yet');
  update public.design_jobs set status = 'released', released_at = now()
   where inquiry_id = i.id and revision = i.revision and status = 'approved';

  if i.release_mode = 1 then
    select coalesce(jsonb_agg(b), '[]') into brands from public.design_jobs d, jsonb_array_elements(d.brands_specified) b
     where d.inquiry_id = i.id and d.revision = i.revision;
    perform app.require(jsonb_array_length(brands) > 0, 'Enter the brands specified in the design before release');
    if not app.brands_match_expectation(brands, i.solution_level, i.manufacturing_origin) then
      perform app.require(coalesce(trim(p_justification), '') <> '', 'Brands do not match the client expectation: give a justification');
      update public.design_jobs set brand_justification = p_justification where inquiry_id = i.id and revision = i.revision;
    end if;
    perform set_config('app.workflow', '1', true);
    update public.inquiries set design_released_to_sales_at = now() where id = i.id;
    perform app.set_inquiry_status(i.id, 'returned_to_sales', 'Design released to sales');
    perform app.start_clock(i.id, 'inquiry', i.id, 'sales_submission', i.sales_person_id, null, 'Submit design to client');
    perform app.notify_many(array[i.sales_person_id] || app.role_users('sm_projects'), 'design_released',
      'Design released: ' || i.code, format('%s – %s. Ready for the client.', i.project_name, i.customer_name),
      'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  else
    -- Started in parallel as a pre-estimate: the same job moves on to final pricing
    select id into ej from public.estimation_jobs where inquiry_id = i.id and revision = i.revision and phase = 'pre' order by created_at desc limit 1;
    if ej is null then
      insert into public.estimation_jobs (inquiry_id, revision, source, status) values (i.id, i.revision, 'design', 'queued') returning id into ej;
      perform app.start_clock(i.id, 'estimation_job', ej, 'acceptance', (app.role_users('sm_estimation'))[1], null, 'Estimation acceptance');
    else
      update public.estimation_jobs set phase = 'final' where id = ej;
      perform app.log_status('estimation_job', ej, i.id, 'pre-estimate', 'final pricing', 'Design released');
      perform app.notify((select assignee_id from public.estimation_jobs where id = ej), 'design_to_estimation',
        'Design released – add the designed fixtures: ' || i.code,
        format('%s – %s. Final pricing by %s.', coalesce(i.inquiry_name, i.project_name), i.customer_name,
          coalesce(to_char((select due_at from public.estimation_jobs where id = ej) at time zone app.tz(), 'DD Mon HH24:MI'), '—')),
        'normal', 'estimation_job', ej, '/estimation/' || ej);
    end if;
    perform app.set_inquiry_status(i.id, 'in_estimation', 'Design released to Estimation');
    perform app.notify_many(array[i.sales_person_id] || app.role_users('sm_projects') || app.role_users('sm_estimation'),
      'design_to_estimation', 'Design completed and sent to Estimation: ' || i.code,
      format('%s – %s', i.project_name, i.customer_name), 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    update public.projects set milestone = 'design_involvement'
     where id = i.project_id and milestone = 'lead_identified';
  end if;
  perform app.refresh_inquiry(i.id);
end $$;

create or replace function public.assign_estimation_job(
  p_job uuid, p_assignee uuid, p_due timestamptz, p_value_band text default 'medium', p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  j public.estimation_jobs := app.est_job(p_job);
  i public.inquiries := app.inq(j.inquiry_id);
  r public.app_role;
begin
  perform app.require(app.has_role('sm_estimation', 'gm'), 'Only SM Estimation assigns estimators');
  perform app.require(j.status in ('accepted', 'assigned', 'acknowledged', 'in_progress', 'date_change_requested', 'returned', 'revision_requested'), 'Accept the job first');
  select role into r from public.profiles where id = p_assignee and active;
  perform app.require(r in ('am_estimation', 'estimation_exec'), 'Assign the Assistant Manager – Estimation or the Estimation Executive');
  if p_assignee is distinct from public.default_estimator(i.id) then
    perform app.require(coalesce(trim(p_reason), '') <> '', 'This estimator does not normally handle this project type: give a reason');
  end if;
  if j.assignee_id is not null and j.assignee_id <> p_assignee then
    perform app.require(coalesce(trim(p_reason), '') <> '', 'Hand-over requires a reason');
  end if;
  -- Must leave at least 1 working day before the customer deadline for approval and submission
  if p_due is not distinct from j.due_at and j.status <> 'revision_requested' then
    null;  -- same due date as before: only the estimator changes
  elsif j.status = 'revision_requested' then
    perform app.require(i.customer_deadline is null or p_due <= (i.customer_deadline + app.work_end()) at time zone app.tz(),
      format('The revision must be due by the customer deadline (%s)', i.customer_deadline));
  elsif i.customer_deadline is not null and
     p_due > (app.deadline_split(i) ->> 'estimation_due')::timestamptz then
    if i.deadline_type = 'tender' then
      raise exception 'Estimation due date must leave at least 2 working days before the tender closes (%)', to_char(app.deadline_end(i) at time zone app.tz(), 'DD Mon HH24:MI');
    end if;
    raise exception 'Estimation due date must leave at least 1 working day before the customer deadline (%)', i.customer_deadline;
  end if;

  update public.estimation_jobs set assignee_id = p_assignee, due_at = p_due, original_due_at = coalesce(original_due_at, p_due),
    value_band = p_value_band, assignment_reason = p_reason, assigned_by = auth.uid(), assigned_at = now(),
    status = case when j.assignee_id is null or j.assignee_id <> p_assignee then 'assigned'
                  when j.status = 'revision_requested' then 'returned' else j.status end
  where id = j.id;
  perform app.stop_clocks('estimation_job', j.id, 'assignment');
  perform app.stop_clocks('estimation_job', j.id, 'estimation');
  if j.assignee_id is null or j.assignee_id <> p_assignee then
    perform app.start_clock(i.id, 'estimation_job', j.id, 'ack', p_assignee, null, 'Estimator acknowledgement');
  end if;
  perform app.start_clock(i.id, 'estimation_job', j.id, 'estimation', p_assignee, p_due, 'Estimation');
  perform app.log_status('estimation_job', j.id, i.id, j.status, 'assigned', p_reason);
  -- A pre-estimate runs alongside the design: the inquiry stays with Design until the design is released
  if i.status in ('accepted', 'design_approved', 'estimation_review') and j.phase <> 'pre' then perform app.set_inquiry_status(i.id, 'in_estimation'); end if;
  if j.status = 'revision_requested' then
    perform app.notify(p_assignee, 'quotation_returned', 'Revise the quotation: ' || i.code,
      format('Revision requested: %s. Due %s', coalesce(j.review_comment, ''), to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI')),
      'normal', 'estimation_job', j.id, '/estimation/' || j.id);
  else
  perform app.notify(p_assignee, 'work_assigned', 'Estimate assigned: ' || i.code,
    format('%s – %s. Duty %s (%s). Due %s', i.project_name, i.customer_name, i.duty_status, i.currency,
           to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI')),
    'normal', 'estimation_job', j.id, '/estimation/' || j.id);
  end if;
  perform app.refresh_inquiry(i.id);
end $$;

create or replace function public.submit_estimate_for_approval(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j public.estimation_jobs := app.est_job(p_job); code text;
begin
  perform app.require(j.assignee_id = auth.uid(), 'Only the assigned estimator can submit');
  perform app.require(j.status in ('in_progress', 'acknowledged', 'returned', 'assigned'), 'Estimate is not in progress');
  perform app.require(j.phase <> 'pre', 'The design is not released yet – add the designed fixtures once it is released, then submit');
  perform app.require(j.quoted_value is not null, 'Enter the quoted value');
  perform app.require(j.price_currency is null or j.price_currency = (select currency from public.inquiries where id = j.inquiry_id),
    format('The duty status changed – re-price the estimate in %s and save it before submitting',
           (select currency from public.inquiries where id = j.inquiry_id)));
  perform app.require(jsonb_array_length(coalesce(j.brands_offered, '[]')) > 0, 'Enter the brands and origin offered for each main product group');
  perform app.require(app.has_attachment('estimation_job', j.id, 'quotation_draft'), 'Upload the draft quotation (PDF)');
  perform app.require(app.has_attachment('estimation_job', j.id, 'costing_sheet'), 'Upload the costing sheet (Excel)');
  update public.estimation_jobs set status = 'submitted_for_approval', submitted_at = now() where id = j.id;
  perform app.stop_clocks('estimation_job', j.id);
  perform app.start_clock(j.inquiry_id, 'estimation_job', j.id, 'quotation_approval', (app.role_users('sm_estimation'))[1], null, 'Quotation approval');
  perform app.log_status('estimation_job', j.id, j.inquiry_id, j.status, 'submitted_for_approval');
  perform app.set_inquiry_status(j.inquiry_id, 'estimation_review');
  select i.code into code from public.inquiries i where id = j.inquiry_id;
  perform app.notify_many(app.role_users('sm_estimation'), 'estimate_submitted', 'Quotation for approval: ' || code,
    app.display_name(auth.uid()), 'normal', 'estimation_job', j.id, '/estimation/' || j.id, null, true);
  perform app.refresh_inquiry(j.inquiry_id);
end $$;

create or replace function app.refresh_inquiry(p_inquiry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c record;
  worst text;
  pct int;
  i public.inquiries;
begin
  select * into i from public.inquiries where id = p_inquiry;
  if not found then return; end if;
  select owner_id, owner_team, due_at, revised_due_at, delay_reason into c from public.sla_clocks
   where inquiry_id = p_inquiry and stopped_at is null and entity_type <> 'approval'
   -- While the design runs, the design (not the parallel pre-estimate) owns the inquiry
   order by (entity_type = 'estimation_job' and i.status in ('accepted', 'in_design', 'design_review', 'design_approved')), due_at desc limit 1;
  select case
      when bool_or(colour = 'red') then 'red'
      when bool_and(colour = 'grey') then 'grey'
      when bool_or(colour = 'amber') then 'amber'
      else 'green' end
    into worst from public.sla_clocks where inquiry_id = p_inquiry and stopped_at is null and entity_type <> 'approval';

  pct := case i.status
    when 'draft' then 0 when 'returned_for_info' then 5 when 'submitted' then 5 when 'accepted' then 10
    when 'in_design' then 15 + coalesce((select avg(progress_pct) from public.design_jobs
                                         where inquiry_id = p_inquiry and revision = i.revision), 0)::int * (case when i.route = 'A' then 35 else 70 end) / 100
    when 'design_review' then case when i.route = 'A' then 45 else 85 end
    when 'design_approved' then case when i.route = 'A' then 50 else 95 end
    when 'in_estimation' then case when i.route = 'A' then 60 else 30 end
    when 'estimation_review' then 85
    when 'quotation_released' then 100 when 'returned_to_sales' then 100
    when 'submitted_to_client' then 100 when 'awaiting_client_approval' then 100 when 'client_approved' then 100
    when 'won' then 100 when 'lost' then 100 else i.progress_pct end;

  perform set_config('app.workflow', '1', true);
  update public.inquiries set
    current_owner_id = coalesce(c.owner_id, case when status in ('quotation_released', 'returned_to_sales', 'submitted_to_client',
                                                                 'awaiting_client_approval', 'client_approved', 'draft', 'returned_for_info')
                                                 then sales_person_id else current_owner_id end),
    current_team = coalesce(c.owner_team, current_team),
    current_due_at = c.due_at,
    revised_due_at = c.revised_due_at,
    delay_reason = c.delay_reason,
    sla_colour = coalesce(worst, case when status = 'on_hold' then 'grey' else 'green' end),
    progress_pct = pct
  where id = p_inquiry;
end $$;


revoke execute on function public.request_deadline_extension(uuid, date, text) from public, anon;
grant execute on function public.request_deadline_extension(uuid, date, text) to authenticated, service_role;
revoke execute on function public.record_extension_outcome(uuid, boolean, date, text) from public, anon;
grant execute on function public.record_extension_outcome(uuid, boolean, date, text) to authenticated, service_role;
revoke execute on function public.record_tender_extension(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.record_tender_extension(uuid, timestamptz, text, text) to authenticated, service_role;

