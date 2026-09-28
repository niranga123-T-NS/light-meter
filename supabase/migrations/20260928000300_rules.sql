-- DIMO Sales Visit & Project Tracking — business rules enforced in the database
-- (territory derivation, visit submission validation, stage rules, activity history)

-- ---------------------------------------------------------------------------
-- Territory and ownership defaults
-- ---------------------------------------------------------------------------
create or replace function public.tg_customer_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
    if new.territory_id is null then
      select territory_id into new.territory_id from public.profile_territories
      where user_id = new.owner_id order by territory_id limit 1;
    end if;
    if new.business_unit_id is null then
      select business_unit_id into new.business_unit_id from public.territories where id = new.territory_id;
    end if;
  end if;
  return new;
end $$;
create trigger customers_defaults before insert on public.customers for each row execute function public.tg_customer_defaults();

create or replace function public.tg_contact_defaults() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
  end if;
  return new;
end $$;
create trigger contacts_defaults before insert on public.contacts for each row execute function public.tg_contact_defaults();

create or replace function public.tg_project_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
    if new.territory_id is null and new.customer_id is not null then
      select territory_id into new.territory_id from public.customers where id = new.customer_id;
    end if;
    if new.territory_id is null then
      select territory_id into new.territory_id from public.profile_territories
      where user_id = new.owner_id order by territory_id limit 1;
    end if;
    if new.business_unit_id is null then
      select business_unit_id into new.business_unit_id from public.territories where id = new.territory_id;
    end if;
  end if;
  return new;
end $$;
create trigger projects_defaults before insert on public.projects for each row execute function public.tg_project_defaults();

create or replace function public.tg_visit_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is not null and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id) then
    select territory_id into new.territory_id from public.customers where id = new.customer_id;
  end if;
  if new.visit_date is null then
    new.visit_date := (coalesce(new.check_in_at, new.scheduled_at, new.device_created_at, now()) at time zone 'Asia/Colombo')::date;
  end if;
  return new;
end $$;
create trigger visits_defaults before insert or update on public.visits for each row execute function public.tg_visit_defaults();

create or replace function public.tg_action_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
    if new.customer_id is null and new.visit_id is not null then
      select customer_id into new.customer_id from public.visits where id = new.visit_id;
    end if;
  end if;
  if new.territory_id is null or tg_op = 'UPDATE' then
    new.territory_id := coalesce(
      (select territory_id from public.projects where id = new.project_id),
      (select territory_id from public.customers where id = new.customer_id),
      (select territory_id from public.visits where id = new.visit_id),
      new.territory_id);
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger actions_defaults before insert or update on public.actions for each row execute function public.tg_action_defaults();

-- ---------------------------------------------------------------------------
-- Visit submission rules (server side; the app checks the same list first)
-- Minimum at submission: salesperson, customer, contact or reason,
-- visit date and type, purpose, summary, outcome, and at least one next
-- action or a "no follow up" reason.
-- ---------------------------------------------------------------------------
create or replace function public.visit_missing_fields(v public.visits) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare missing text[] := '{}';
begin
  if v.salesperson_id is null then missing := array_append(missing, 'salesperson'); end if;
  if v.customer_id is null then missing := array_append(missing, 'customer'); end if;
  if nullif(trim(coalesce(v.contact_unavailable_reason, '')), '') is null
     and not exists (select 1 from public.visit_contacts where visit_id = v.id) then
    missing := array_append(missing, 'contact_or_reason');
  end if;
  if v.visit_date is null then missing := array_append(missing, 'visit_date'); end if;
  if nullif(trim(coalesce(v.visit_type, '')), '') is null then missing := array_append(missing, 'visit_type'); end if;
  if nullif(trim(coalesce(v.purpose, '')), '') is null then missing := array_append(missing, 'purpose'); end if;
  if nullif(trim(coalesce(v.summary, '')), '') is null then missing := array_append(missing, 'summary'); end if;
  if nullif(trim(coalesce(v.outcome, '')), '') is null then missing := array_append(missing, 'outcome'); end if;
  if nullif(trim(coalesce(v.no_followup_reason, '')), '') is null
     and not exists (select 1 from public.actions where visit_id = v.id and status <> 'cancelled') then
    missing := array_append(missing, 'next_action_or_reason');
  end if;
  if not v.is_remote and v.check_in_lat is null and nullif(trim(coalesce(v.location_unavailable_reason, '')), '') is null
     and coalesce((public.setting('gps_required') #>> '{}')::boolean, false) then
    missing := array_append(missing, 'location_or_reason');
  end if;
  return missing;
end $$;

create or replace function public.tg_visit_submit() returns trigger
language plpgsql as $$
declare missing text[];
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    missing := public.visit_missing_fields(new);
    if array_length(missing, 1) > 0 then
      raise exception 'Visit cannot be submitted. Missing: %', array_to_string(missing, ', ')
        using errcode = '23514', detail = array_to_string(missing, ',');
    end if;
    new.submitted_at := coalesce(new.submitted_at, now());
  end if;
  if tg_op = 'UPDATE' and old.status = 'submitted' and new.status in ('planned', 'draft') then
    raise exception 'A submitted visit cannot return to draft' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger visits_submit before insert or update on public.visits for each row execute function public.tg_visit_submit();

-- Keep account / project histories current when a visit is submitted.
create or replace function public.tg_visit_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare ts timestamptz;
begin
  if new.status = 'submitted' then
    ts := coalesce(new.check_in_at, new.submitted_at, now());
    update public.customers set last_visit_at = greatest(coalesce(last_visit_at, ts), ts) where id = new.customer_id;
    update public.projects p set last_activity_at = greatest(p.last_activity_at, ts)
    from public.visit_projects vp where vp.visit_id = new.id and vp.project_id = p.id;
    update public.opportunities o set last_activity_at = greatest(o.last_activity_at, ts)
    from public.visit_opportunities vo where vo.visit_id = new.id and vo.opportunity_id = o.id;
  end if;
  return null;
end $$;
create trigger visits_activity after insert or update of status on public.visits for each row execute function public.tg_visit_activity();

create or replace function public.tg_action_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is not null then
    update public.projects set last_activity_at = now() where id = new.project_id;
  end if;
  if new.opportunity_id is not null then
    update public.opportunities set last_activity_at = now() where id = new.opportunity_id;
  end if;
  return null;
end $$;
create trigger actions_activity after insert or update of status on public.actions for each row execute function public.tg_action_activity();

-- ---------------------------------------------------------------------------
-- Opportunity stage rules
-- ---------------------------------------------------------------------------
create or replace function public.tg_opportunity_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_stage public.pipeline_stages;
  new_stage public.pipeline_stages;
  f text;
  row_json jsonb := to_jsonb(new);
  missing text[] := '{}';
begin
  select * into new_stage from public.pipeline_stages where id = new.stage_id;
  if new.territory_id is null or tg_op = 'UPDATE' then
    select territory_id into new.territory_id from public.projects where id = new.project_id;
  end if;
  new.owner_id := coalesce(new.owner_id, auth.uid());

  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    if tg_op = 'UPDATE' then
      select * into old_stage from public.pipeline_stages where id = old.stage_id;
      foreach f in array old_stage.exit_required_fields loop
        if nullif(trim(coalesce(row_json ->> f, '')), '') is null then missing := missing || f; end if;
      end loop;
    end if;
    foreach f in array new_stage.entry_required_fields loop
      if nullif(trim(coalesce(row_json ->> f, '')), '') is null then missing := missing || f; end if;
    end loop;
    if array_length(missing, 1) > 0 then
      raise exception 'Stage change to "%" needs: %', new_stage.name, array_to_string(missing, ', ')
        using errcode = '23514', detail = array_to_string(missing, ',');
    end if;
    -- default probability follows the stage unless the user set it explicitly
    if new.probability is null or (tg_op = 'UPDATE' and new.probability is not distinct from old.probability) then
      new.probability := new_stage.default_probability;
    end if;
    if new_stage.outcome in ('won', 'lost', 'cancelled') then
      new.closed_at := coalesce(new.closed_at, now());
    else
      new.closed_at := null;
    end if;
    if new_stage.outcome = 'won' and new.final_award_value is null then
      new.final_award_value := new.estimated_value;
    end if;
  end if;
  return new;
end $$;
create trigger opportunities_stage before insert or update on public.opportunities for each row execute function public.tg_opportunity_stage();

create or replace function public.tg_opportunity_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    insert into public.opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, probability, estimated_value)
    values (new.id, case when tg_op = 'UPDATE' then old.stage_id end, new.stage_id, new.probability, new.estimated_value);
    update public.projects set last_activity_at = now() where id = new.project_id;
  end if;
  return null;
end $$;
create trigger opportunities_history after insert or update on public.opportunities for each row execute function public.tg_opportunity_history();

create or replace function public.tg_quotation_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.prepared_by := coalesce(new.prepared_by, auth.uid());
  update public.opportunities set last_activity_at = now() where id = new.opportunity_id;
  -- a newer revision supersedes the previous submitted one
  if tg_op = 'INSERT' then
    update public.quotations set status = 'superseded'
    where reference = new.reference and revision < new.revision and status in ('draft', 'submitted');
  end if;
  return new;
end $$;
create trigger quotations_activity before insert or update on public.quotations for each row execute function public.tg_quotation_activity();
