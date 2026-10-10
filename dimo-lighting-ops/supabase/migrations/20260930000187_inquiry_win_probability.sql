-- Win probability per inquiry; the project's % follows its inquiries.
--  * Before the project has an inquiry, its % is the sales person's own (entered when the project is created, by hand or with
--    the wizard). With one open inquiry the project % = that inquiry's %; with several it is their average weighted by value
--    (quoted value once released, else the value the sales person expects; equal weights while any value is missing).
--    Quotes of one tender (several contractors) count once. Each new inquiry asks for its %, and the project changes with it.
--  * A won inquiry closes only itself: its order goes into the order book (secured) at once; the project is won when no
--    inquiry is left open, and lost only when all were lost.

alter table public.inquiries add column if not exists win_probability int check (win_probability between 0 and 100);
alter table public.inquiries add column if not exists est_value numeric(16, 2) check (est_value is null or est_value >= 0);
alter table public.inquiries add column if not exists win_set_at timestamptz;
update public.inquiries i set win_probability = p.win_probability from public.projects p where p.id = i.project_id and i.win_probability is null;

create or replace function app.inquiry_open(s text) returns boolean language sql immutable as $$ select s not in ('won', 'lost', 'cancelled', 'rejected') $$;

-- Value of an inquiry in LKR: the released quotation, else the sales person's expected value
create or replace function app.inquiry_value_lkr(i public.inquiries) returns numeric
language sql stable security definer set search_path = public as $$
  select app.to_lkr(coalesce((select j.quoted_value from public.estimation_jobs j where j.inquiry_id = i.id and j.quoted_value is not null
                              order by j.created_at desc limit 1), i.est_value), i.currency)
$$;

-- The project's % from its open inquiries (null when it has none)
create or replace function app.project_inquiry_pct(p_project uuid) returns int
language sql stable security definer set search_path = public as $$
  with g as (
    select coalesce(i.tender_group_id, i.id) k, max(coalesce(i.win_probability, 0)) pct, max(app.inquiry_value_lkr(i)) val
    from public.inquiries i where i.project_id = p_project and app.inquiry_open(i.status) group by 1)
  select case when count(*) = 0 then null
              when bool_and(coalesce(val, 0) > 0) then round(sum(pct * val) / sum(val))::int
              else round(avg(pct))::int end
  from g
$$;

create or replace function app.sync_project_pct(p_project uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pct int := app.project_inquiry_pct(p_project);
begin
  if pct is null then return; end if;
  perform set_config('app.pct_sync', '1', true);
  update public.projects set win_probability = pct where id = p_project and milestone not in ('won', 'lost') and win_probability is distinct from pct;
  perform set_config('app.pct_sync', '', true);
end $$;

-- New inquiry: starts at the project's % (or its source inquiry's) until the sales person sets it
create or replace function app.inquiry_pct_default() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.win_probability is null then
    new.win_probability := coalesce((select win_probability from public.inquiries where id = new.copied_from_inquiry_id),
                                    (select win_probability from public.projects where id = new.project_id));
  else
    new.win_set_at := coalesce(new.win_set_at, now());
  end if;
  return new;
end $$;
drop trigger if exists inquiry_pct_default on public.inquiries;
create trigger inquiry_pct_default before insert on public.inquiries for each row execute function app.inquiry_pct_default();

create or replace function app.inquiry_pct_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.sync_project_pct(new.project_id);
  return null;
end $$;
drop trigger if exists inquiry_pct_sync on public.inquiries;
create trigger inquiry_pct_sync after insert or update of status, win_probability, est_value, tender_group_id on public.inquiries
  for each row execute function app.inquiry_pct_sync();
create or replace function app.quote_pct_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.quoted_value is distinct from old.quoted_value then
    perform app.sync_project_pct((select project_id from public.inquiries where id = new.inquiry_id));
  end if;
  return null;
end $$;
drop trigger if exists quote_pct_sync on public.estimation_jobs;
create trigger quote_pct_sync after update of quoted_value on public.estimation_jobs for each row execute function app.quote_pct_sync();

-- The sales person (or SM Projects / GM) sets an inquiry's % and expected value
create or replace function public.set_inquiry_probability(p_inquiry uuid, p_pct int, p_value numeric default null) returns int
language plpgsql security definer set search_path = public as $$
declare i public.inquiries;
begin
  select * into i from public.inquiries where id = p_inquiry for update;
  perform app.require(i.id is not null, 'Inquiry not found');
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm')
                      or exists (select 1 from public.projects where id = i.project_id and owner_id = auth.uid()), 'Only the sales person sets the win probability');
  perform app.require(app.inquiry_open(i.status), 'The result of this inquiry is already recorded');
  perform app.require(p_pct between 0 and 100, 'Win probability is 0 – 100');
  update public.inquiries set win_probability = p_pct, est_value = coalesce(p_value, est_value), win_set_at = now() where id = i.id;
  return (select win_probability from public.projects where id = i.project_id);
end $$;

-- A won inquiry goes into the order book at once: the first creates the secured project, later ones add to it
create or replace function app.secure_inquiry_win(p_inquiry uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.inquiries; s public.secured_projects; v numeric; sv uuid;
begin
  select * into i from public.inquiries where id = p_inquiry;
  select * into s from public.secured_projects where project_id = i.project_id;
  if s.id is null then return app.secure_project(i.project_id); end if;
  v := round(app.to_lkr(i.order_value, i.currency, i.order_date), 2);
  if coalesce(v, 0) = 0 or s.status <> 'open' then return s.id; end if;
  if s.schedule_status = 'approved' then
    insert into public.secured_variations (secured_id, vo_no, amount, month, reason, status, decided_by, decided_at, decision_note)
    values (s.id, i.code, v, app.month_of(coalesce(i.order_date, current_date)), 'Inquiry ' || i.code || ' won – ' || coalesce(i.inquiry_name, ''), 'approved',
            auth.uid(), now(), 'Another inquiry of the project won')
    returning id into sv;
    perform app.apply_variation(sv);
  else
    update public.secured_projects set order_value = coalesce(order_value, 0) + v where id = s.id;
  end if;
  insert into public.secured_log (secured_id, action, note) values (s.id, 'won', 'Inquiry ' || i.code || ' won · ' || app.fmt_money(v, 'LKR'));
  perform app.notify(s.sales_person_id, 'secured_schedule', 'Another inquiry won – update the invoice schedule',
    concat_ws(' · ', s.project_name, i.code, coalesce(i.inquiry_name, ''), app.fmt_money(v, 'LKR')), 'normal', 'secured_project', s.id, app.secured_url(s.id));
  return s.id;
end $$;


create or replace function app.projects_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  suggested text;
begin
  if tg_op = 'INSERT' then
    new.code := coalesce(new.code, app.next_code('PRJ'));
    if auth.uid() is not null then
      if app.is_sales_person() then
        if not (new.project_type = any (app.my_project_types())) then
          raise exception 'You can only create projects for your own project types';
        end if;
        new.owner_id := auth.uid();
      elsif app.has_role('sm_projects', 'gm') then
        if new.owner_id is null then raise exception 'Assign a sales person before saving the project'; end if;
        if not exists (select 1 from public.profiles where id = new.owner_id and role in ('asm_building', 'asm_infra') and active) then
          raise exception 'The project owner must be an active sales person';
        end if;
        new.first_visit_due := coalesce(new.first_visit_due, app.add_work_minutes(now(), 5 * app.working_minutes_per_day())::date);
      else
        raise exception 'Only sales people, SM Projects and GM / DGM can create projects';
      end if;
    end if;
    -- Exact duplicate on name + customer is blocked (5.6)
    if exists (select 1 from public.projects p where p.name_norm = app.normalize_name(new.name)
               and p.organization_id = new.organization_id and p.merged_into is null) then
      raise exception 'A project with this name already exists for this customer. Select the existing project instead.';
    end if;
    suggested := app.term_for_duration(new.expected_duration_months);
    if new.project_term is null then new.project_term := suggested;
    elsif new.project_term <> suggested and app.change_reason() is null then
      raise exception 'Project term differs from the suggested term (%): give a reason', suggested;
    end if;
    new.expected_award_date := coalesce(new.expected_award_date,
      (now() at time zone app.tz())::date + make_interval(months => new.expected_duration_months));
    -- The win probability is the sales person's own estimate (entered by hand or with the wizard), not set by the milestone
    if new.milestone = 'won' then new.win_probability := 100; end if;
    if new.milestone = 'lost' then new.win_probability := 0; end if;
    return new;
  end if;

  -- UPDATE
  if new.milestone is distinct from old.milestone then
    -- Only the outcome moves the probability: won = 100%, lost = 0%. Other milestones leave the sales person's % as it is.
    if new.milestone = 'won' then new.status := 'won'; new.win_probability := 100; end if;
    if new.milestone = 'lost' then new.status := 'lost'; new.win_probability := 0; end if;
  end if;
  if new.win_probability is distinct from old.win_probability then
    if coalesce(current_setting('app.pct_sync', true), '') <> '1' and new.milestone not in ('won', 'lost')
       and exists (select 1 from public.inquiries where project_id = new.id and app.inquiry_open(status)) then
      raise exception 'This project''s win probability comes from its inquiries – set the %% on each inquiry';
    end if;
    new.last_probability_review_at := now();
  end if;
  if new.expected_duration_months is distinct from old.expected_duration_months and new.project_term = old.project_term then
    new.project_term := app.term_for_duration(new.expected_duration_months);
  end if;
  if new.owner_id is distinct from old.owner_id and auth.uid() is not null and not app.has_role('sm_projects', 'gm') then
    raise exception 'Only SM Projects or GM / DGM can reassign a project';
  end if;
  if new.name is distinct from old.name and auth.uid() is not null and not app.has_role('sm_projects', 'gm')
     and old.owner_id <> auth.uid() then
    raise exception 'Only the owner, SM Projects or GM / DGM can rename a project';
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.record_inquiry_result(
  p_inquiry uuid, p_result text, p_lost_reason text default null, p_competitor bigint default null,
  p_order_value numeric default null, p_order_date date default null
) returns void language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry);
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person records the result');
  perform app.require(p_result in ('won', 'lost', 'on_hold', 'cancelled'), 'Invalid result');
  perform app.require(p_result <> 'lost' or p_lost_reason is not null, 'Select the lost reason');
  perform app.require(p_result <> 'won' or (p_order_value is not null and p_order_date is not null), 'Enter the order value and order date');
  perform app.stop_clocks('inquiry', i.id);
  perform set_config('app.workflow', '1', true);
  update public.inquiries set result = p_result, lost_reason = p_lost_reason, lost_to_competitor_id = p_competitor,
    order_value = p_order_value, order_date = p_order_date where id = i.id;
  update public.quotations set result = case when p_result = 'cancelled' then 'lost' else p_result end, lost_reason = p_lost_reason
   where inquiry_id = i.id and revision = i.revision;
  perform app.set_inquiry_status(i.id, p_result, p_lost_reason);
  perform set_config('app.reason', 'Inquiry ' || i.code || ' ' || p_result, true);
  if p_result = 'won' then
    perform app.secure_inquiry_win(i.id);
  end if;
  -- The project is decided when none of its inquiries is left open: won if any was won, lost if all were lost
  if not exists (select 1 from public.inquiries where project_id = i.project_id and id <> i.id and app.inquiry_open(status) and status <> 'draft') then
    if exists (select 1 from public.inquiries where project_id = i.project_id and result = 'won') then
      update public.projects set milestone = 'won', stage = 'Award' where id = i.project_id and milestone <> 'won';
    elsif p_result = 'lost' then
      update public.projects set milestone = 'lost', status_reason = p_lost_reason where id = i.project_id;
    end if;
  else
    perform app.sync_project_pct(i.project_id);
  end if;
  perform app.refresh_inquiry(i.id);
end $$;

create or replace function public.request_project_change(p_project uuid, p_changes jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.projects; k text; ch jsonb := '{}'; prev jsonb := '{}'; po jsonb; rid uuid;
begin
  select * into p from public.projects where id = p_project;
  perform app.require(p.id is not null, 'Project not found');
  perform app.require(p.owner_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the project''s sales person requests changes');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason for the change');
  perform app.require(p.status not in ('completed', 'cancelled'), 'This project is closed');
  perform app.require(not exists (select 1 from public.project_change_requests where project_id = p.id and status = 'pending'),
    'A change request for this project is already waiting for SM Projects – withdraw it first to send a new one');
  po := to_jsonb(p);
  for k in select jsonb_object_keys(coalesce(p_changes, '{}')) loop
    perform app.require(k = any (app.project_change_fields()), 'This detail cannot be changed here: ' || k);
    if (po -> k) is distinct from (p_changes -> k) and not ((po -> k) = 'null'::jsonb and (p_changes -> k) = '""'::jsonb) then
      ch := ch || jsonb_build_object(k, p_changes -> k);
      prev := prev || jsonb_build_object(k, po -> k);
    end if;
  end loop;
  perform app.require(ch <> '{}'::jsonb, 'Nothing was changed');
  if ch ? 'name' then perform app.require(coalesce(btrim(ch ->> 'name'), '') <> '', 'The project name cannot be empty'); end if;
  if ch ? 'organization_id' then perform app.require(exists (select 1 from public.organizations where id = (ch ->> 'organization_id')::uuid), 'Customer not found'); end if;
  if ch ? 'win_probability' then perform app.require((ch ->> 'win_probability')::int between 0 and 100, 'Win probability is 0 – 100'); end if;
  if ch ? 'win_probability' then
    perform app.require(not exists (select 1 from public.inquiries where project_id = p_project and app.inquiry_open(status)),
      'This project''s win probability comes from its inquiries – set the % on each inquiry');
  end if;
  insert into public.project_change_requests (project_id, changes, previous, reason) values (p.id, ch, prev, btrim(p_reason)) returning id into rid;
  perform app.notify_many(app.role_users('sm_projects'), 'project_change', format('Project change request – %s', p.code),
    format('%s · %s · %s', app.display_name(auth.uid()), (select string_agg(app.project_field_label(x), ', ') from jsonb_object_keys(ch) x), btrim(p_reason)),
    'normal', 'project', p.id, '/projects/' || p.id, null, true);
  return rid;
end $$;

-- Fix: the priced variation took its value from a column that does not exist
create or replace function app.variation_inquiry_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v public.variations; j public.estimation_jobs; mg numeric; rate numeric; val numeric;
begin
  if new.variation_id is null or new.status is not distinct from old.status then return new; end if;
  select * into v from public.variations where id = new.variation_id for update;
  if v.id is null then return new; end if;
  update public.variations set inquiry_status = new.status where id = v.id;
  if new.status = 'quotation_released' and v.status = 'pricing' then
    select * into j from public.estimation_jobs where inquiry_id = new.id and quoted_value is not null order by created_at desc limit 1;
    select margin_pct into mg from public.estimation_costing where estimation_job_id = j.id;
    select usd_to_lkr into rate from public.exchange_rates order by month desc limit 1;
    val := case when new.currency = 'USD' then j.quoted_value * coalesce(rate, 300) else j.quoted_value end;
    val := case when v.vtype = 'omission' then -abs(val) else abs(val) end;
    update public.variations set status = 'pending_smp', value_lkr = round(val, 2), margin_pct = mg where id = v.id;
    perform app.notify_many(app.role_users('sm_projects', 'senior_elec_engineer'), 'exec_variation', 'Variation priced – SM Projects to approve',
      format('%s · %s%s%s', app.variation_head(v), case when val > 0 then '+' else '−' end, app.fmt_money(abs(val), 'LKR'),
             coalesce(' · margin ' || mg || '%', '')), 'normal', 'variation', v.id, '/execution/variation/' || v.id, null, true);
  elsif new.status in ('cancelled', 'rejected') and v.status = 'pricing' then
    update public.variations set status = 'rejected', decision_note = 'Variation inquiry ' || new.status where id = v.id;
    perform app.notify_many(array[v.raised_by] || app.role_users('senior_elec_engineer'), 'exec_variation', 'Variation inquiry ' || new.status,
      app.variation_head(v), 'normal', 'variation', v.id, '/execution/variation/' || v.id);
  end if;
  return new;
end $$;
