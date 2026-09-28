-- DIMO Sales Visit & Project Tracking — API functions (called via supabase.rpc)
--   submit_visit          idempotent offline sync of a visit and everything created with it
--   find_similar_*        duplicate matching before creating customers / projects
--   dashboard_summary     manager dashboard measures
--   export_dataset        rows for the Excel workbook (same filters as the dashboard)
--   approve/reject_correction, reassign_owner, purge_expired

-- ---------------------------------------------------------------------------
-- Duplicate matching
-- ---------------------------------------------------------------------------
-- Exact key match (normalised name + city). Returns only an id so a salesperson
-- links to an existing customer in another territory instead of duplicating it.
create or replace function public.match_customer(p_name text, p_city text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare r uuid; n int;
begin
  select id into r from public.customers
  where normalized_name = public.normalize_name(p_name) and lower(coalesce(city, '')) = lower(coalesce(p_city, '')) and deleted_at is null
  limit 1;
  if r is null and nullif(trim(coalesce(p_city, '')), '') is null then
    select count(*), min(id::text)::uuid into n, r from public.customers
    where normalized_name = public.normalize_name(p_name) and deleted_at is null;
    if n <> 1 then r := null; end if;
  end if;
  return r;
end $$;

create or replace function public.match_project(p_name text, p_district text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare r uuid; n int;
begin
  select id into r from public.projects
  where (normalized_name = public.normalize_name(p_name)
         or public.normalize_name(p_name) = any (select public.normalize_name(a) from unnest(aliases) a))
    and lower(coalesce(district, '')) = lower(coalesce(p_district, '')) and deleted_at is null
  limit 1;
  if r is null and nullif(trim(coalesce(p_district, '')), '') is null then
    select count(*), min(id::text)::uuid into n, r from public.projects
    where normalized_name = public.normalize_name(p_name) and deleted_at is null;
    if n <> 1 then r := null; end if;
  end if;
  return r;
end $$;

-- Fuzzy candidates shown before creating a record. Deliberately limited to
-- identifying columns; "visible" says whether the caller can open the record.
create or replace function public.find_similar_customers(q text, p_city text default null)
returns table (id uuid, code text, legal_name text, trading_name text, city text, owner_name text, score real, visible boolean)
language sql stable security definer set search_path = public, extensions as $$
  select c.id, c.code, c.legal_name, c.trading_name, c.city, p.full_name,
         greatest(similarity(c.legal_name, q), similarity(coalesce(c.trading_name, ''), q),
                  case when c.normalized_name = public.normalize_name(q) then 1 else 0 end)::real as score,
         public.can_read_customer(c.id)
  from public.customers c left join public.profiles p on p.id = c.owner_id
  where public.current_app_role() is not null and c.deleted_at is null and length(trim(q)) >= 2
    and (c.normalized_name = public.normalize_name(q)
         or similarity(c.legal_name, q) > 0.3 or similarity(coalesce(c.trading_name, ''), q) > 0.3
         or c.legal_name ilike '%' || q || '%' or c.trading_name ilike '%' || q || '%')
  order by (p_city is not null and lower(c.city) = lower(p_city)) desc, score desc
  limit 10
$$;

create or replace function public.find_similar_projects(q text, p_district text default null)
returns table (id uuid, code text, name text, district text, owner_name text, customer_name text, score real, visible boolean)
language sql stable security definer set search_path = public, extensions as $$
  select pr.id, pr.code, pr.name, pr.district, p.full_name, c.legal_name,
         greatest(similarity(pr.name, q), similarity(array_to_string(pr.aliases, ' '), q),
                  case when pr.normalized_name = public.normalize_name(q) then 1 else 0 end)::real as score,
         public.can_read_project(pr.id)
  from public.projects pr
  left join public.profiles p on p.id = pr.owner_id
  left join public.customers c on c.id = pr.customer_id
  where public.current_app_role() is not null and pr.deleted_at is null and length(trim(q)) >= 2
    and (pr.normalized_name = public.normalize_name(q) or similarity(pr.name, q) > 0.3
         or pr.name ilike '%' || q || '%' or array_to_string(pr.aliases, ' ') ilike '%' || q || '%')
  order by (p_district is not null and lower(pr.district) = lower(p_district)) desc, score desc
  limit 10
$$;

-- When a salesperson links a visit to an existing project they cannot yet see,
-- they are added as a sales member so the project history stays complete.
-- Only for projects linked to one of the caller's own visits; the membership is audited.
create or replace function public.ensure_project_access(p uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.has_role('{salesperson}') and not public.can_read_project(p)
     and exists (select 1 from public.visit_projects vp join public.visits v on v.id = vp.visit_id
                 where vp.project_id = p and v.salesperson_id = auth.uid()) then
    insert into public.project_members (project_id, user_id, member_role, added_by)
    values (p, auth.uid(), 'sales', auth.uid()) on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- submit_visit: one transaction, safe to retry (all ids are generated on the
-- device). Payload:
-- {
--   "visit": {...visit columns incl. id},
--   "base_version": 3 | null,         -- server version the device last saw
--   "submit": true,                    -- false = save to server as draft
--   "new_customers": [...], "new_contacts": [...], "new_projects": [...],
--   "new_opportunities": [...], "new_stakeholders": [...],
--   "contact_ids": [...], "project_ids": [...], "opportunity_ids": [...],
--   "actions": [...], "attachments": [...]
-- }
-- Returns { visit_id, code, status, version, id_map, already_processed }
-- id_map maps device ids to existing server ids when a duplicate was matched.
-- ---------------------------------------------------------------------------
create or replace function public.submit_visit(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v jsonb := p -> 'visit';
  vid uuid := (v ->> 'id')::uuid;
  existing public.visits;
  result public.visits;
  id_map jsonb := '{}'::jsonb;
  rec jsonb;
  new_id uuid;
  matched uuid;
  ids uuid[];
  stage uuid;
  do_submit boolean := coalesce((p ->> 'submit')::boolean, true);
  base_version int := (p ->> 'base_version')::int;
  visit_fields text[] := array[
    'customer_id', 'contact_unavailable_reason', 'visit_type', 'scheduled_at', 'visit_date', 'check_in_at', 'check_out_at',
    'device_created_at', 'meeting_place', 'is_remote', 'check_in_lat', 'check_in_lng', 'check_in_accuracy_m',
    'check_out_lat', 'check_out_lng', 'check_out_accuracy_m', 'location_consent', 'location_unavailable_reason',
    'purpose', 'products_discussed', 'requirements', 'pain_points', 'decision_process', 'budget_indication',
    'funding_status', 'purchase_timeline', 'estimated_value', 'currency', 'confidence', 'competitor', 'incumbent',
    'spec_position', 'differentiator', 'risks', 'summary', 'commitments', 'documents_shared', 'documents_requested',
    'outcome', 'next_meeting_at', 'no_followup_reason'];
  cols text;
begin
  if public.current_app_role() is null then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;
  if vid is null then
    raise exception 'visit.id is required' using errcode = '22023';
  end if;

  select * into existing from public.visits where id = vid;
  if found and existing.status in ('submitted', 'cancelled') then
    -- Retry of a visit that already reached the server: return the stored result.
    return jsonb_build_object('visit_id', existing.id, 'code', existing.code, 'status', existing.status,
                              'version', existing.version, 'id_map', '{}'::jsonb, 'already_processed', true);
  end if;
  if found and base_version is not null and existing.version <> base_version
     and existing.updated_by is distinct from auth.uid() then
    raise exception 'This visit was changed on the server by someone else. Review it before submitting again.'
      using errcode = 'PT409', detail = 'conflict';
  end if;

  -- 1. Customers created on the device (matched to an existing record when the key matches)
  for rec in select * from jsonb_array_elements(coalesce(p -> 'new_customers', '[]'::jsonb)) loop
    new_id := (rec ->> 'id')::uuid;
    matched := coalesce(
      (select id from public.customers where id = new_id),
      public.match_customer(rec ->> 'legal_name', rec ->> 'city'));
    if matched is null then
      insert into public.customers (id, legal_name, trading_name, category, industry, address, district, city, country,
                                    website, phone, email, strategic_priority, status, source, notes, parent_customer_id)
      values (new_id, rec ->> 'legal_name', rec ->> 'trading_name', rec ->> 'category', rec ->> 'industry', rec ->> 'address',
              rec ->> 'district', rec ->> 'city', coalesce(rec ->> 'country', 'Sri Lanka'), rec ->> 'website', rec ->> 'phone',
              rec ->> 'email', rec ->> 'strategic_priority', coalesce(rec ->> 'status', 'provisional'), rec ->> 'source',
              rec ->> 'notes', (rec ->> 'parent_customer_id')::uuid);
      matched := new_id;
    end if;
    id_map := id_map || jsonb_build_object(new_id::text, matched);
  end loop;

  -- 2. Projects created on the device (deduplicated by name + district)
  for rec in select * from jsonb_array_elements(coalesce(p -> 'new_projects', '[]'::jsonb)) loop
    new_id := (rec ->> 'id')::uuid;
    matched := coalesce(
      (select id from public.projects where id = new_id),
      public.match_project(rec ->> 'name', rec ->> 'district'));
    if matched is null then
      insert into public.projects (id, name, aliases, site_location, district, city, latitude, longitude, customer_id,
                                   developer_id, end_user_id, project_type, description, segments, systems_products,
                                   total_estimate, addressable_value, currency, design_stage, tender_closing_date,
                                   expected_award_date, lead_source, info_source, tender_reference)
      values (new_id, rec ->> 'name',
              coalesce(array(select jsonb_array_elements_text(rec -> 'aliases')), '{}'),
              rec ->> 'site_location', rec ->> 'district', rec ->> 'city',
              (rec ->> 'latitude')::double precision, (rec ->> 'longitude')::double precision,
              coalesce((id_map ->> (rec ->> 'customer_id'))::uuid, (rec ->> 'customer_id')::uuid),
              coalesce((id_map ->> (rec ->> 'developer_id'))::uuid, (rec ->> 'developer_id')::uuid),
              coalesce((id_map ->> (rec ->> 'end_user_id'))::uuid, (rec ->> 'end_user_id')::uuid),
              rec ->> 'project_type', rec ->> 'description',
              coalesce(array(select jsonb_array_elements_text(rec -> 'segments')), '{}'),
              rec ->> 'systems_products', (rec ->> 'total_estimate')::numeric, (rec ->> 'addressable_value')::numeric,
              coalesce(rec ->> 'currency', 'LKR'), rec ->> 'design_stage', (rec ->> 'tender_closing_date')::date,
              (rec ->> 'expected_award_date')::date, rec ->> 'lead_source', rec ->> 'info_source', rec ->> 'tender_reference');
      matched := new_id;
    end if;
    id_map := id_map || jsonb_build_object(new_id::text, matched);
  end loop;

  -- 3. The visit itself (kept as draft until links and actions exist)
  v := v || jsonb_build_object(
    'customer_id', coalesce(id_map ->> (v ->> 'customer_id'), v ->> 'customer_id'),
    'is_remote', coalesce((v ->> 'is_remote')::boolean, false),
    'currency', coalesce(v ->> 'currency', public.base_currency()));
  select string_agg(quote_ident(f), ', ') into cols from unnest(visit_fields) f;
  if existing.id is null then
    execute format(
      'insert into public.visits (id, salesperson_id, status, %1$s)
       select $2, coalesce(($1 ->> ''salesperson_id'')::uuid, auth.uid()), ''draft'', %1$s
       from jsonb_populate_record(null::public.visits, $1)', cols)
      using v, vid;
  else
    execute format(
      'update public.visits set (%1$s) = (select %1$s from jsonb_populate_record(null::public.visits, $1)),
         status = case when status = ''planned'' then ''draft'' else status end
       where id = $2', cols)
      using v, vid;
    if not found then
      raise exception 'You cannot edit this visit' using errcode = '42501';
    end if;
  end if;

  -- 4. Contacts created on the device (same customer + same name/email = same person)
  for rec in select * from jsonb_array_elements(coalesce(p -> 'new_contacts', '[]'::jsonb)) loop
    new_id := (rec ->> 'id')::uuid;
    matched := null;
    select c.id into matched from public.contacts c
    where c.id = new_id
       or (c.customer_id = coalesce((id_map ->> (rec ->> 'customer_id'))::uuid, (rec ->> 'customer_id')::uuid)
           and c.deleted_at is null
           and (c.normalized_name = public.normalize_name(rec ->> 'full_name')
                or (rec ->> 'email' is not null and lower(c.email) = lower(rec ->> 'email'))))
    limit 1;
    if matched is null then
      insert into public.contacts (id, customer_id, full_name, designation, department, work_phone, mobile_phone, email,
                                   decision_role, preferred_contact_method, consent_status, communication_preference, notes)
      values (new_id, coalesce((id_map ->> (rec ->> 'customer_id'))::uuid, (rec ->> 'customer_id')::uuid),
              rec ->> 'full_name', rec ->> 'designation', rec ->> 'department', rec ->> 'work_phone', rec ->> 'mobile_phone',
              rec ->> 'email', rec ->> 'decision_role', rec ->> 'preferred_contact_method',
              coalesce(rec ->> 'consent_status', 'unknown'), rec ->> 'communication_preference', rec ->> 'notes');
      matched := new_id;
    end if;
    id_map := id_map || jsonb_build_object(new_id::text, matched);
  end loop;

  -- 5. Opportunities (bid packages) created on the device
  for rec in select * from jsonb_array_elements(coalesce(p -> 'new_opportunities', '[]'::jsonb)) loop
    new_id := (rec ->> 'id')::uuid;
    if not exists (select 1 from public.opportunities where id = new_id) then
      stage := coalesce((rec ->> 'stage_id')::uuid,
                        (select id from public.pipeline_stages where code = rec ->> 'stage_code'),
                        (select id from public.pipeline_stages where active and outcome = 'open' order by sort_order limit 1));
      insert into public.opportunities (id, project_id, name, segment, systems_products, stage_id, probability, estimated_value,
                                        currency, expected_order_date, competitors, incumbent, spec_status, next_milestone)
      values (new_id, coalesce((id_map ->> (rec ->> 'project_id'))::uuid, (rec ->> 'project_id')::uuid), rec ->> 'name',
              rec ->> 'segment', rec ->> 'systems_products', stage, (rec ->> 'probability')::numeric,
              (rec ->> 'estimated_value')::numeric, coalesce(rec ->> 'currency', 'LKR'), (rec ->> 'expected_order_date')::date,
              rec ->> 'competitors', rec ->> 'incumbent', rec ->> 'spec_status', rec ->> 'next_milestone');
    end if;
    id_map := id_map || jsonb_build_object(new_id::text, new_id);
  end loop;

  -- 6. Stakeholders for new or existing projects
  for rec in select * from jsonb_array_elements(coalesce(p -> 'new_stakeholders', '[]'::jsonb)) loop
    insert into public.project_stakeholders (id, project_id, customer_id, contact_id, stakeholder_role, influence_stage, is_decision_maker)
    values (coalesce((rec ->> 'id')::uuid, gen_random_uuid()),
            coalesce((id_map ->> (rec ->> 'project_id'))::uuid, (rec ->> 'project_id')::uuid),
            coalesce((id_map ->> (rec ->> 'customer_id'))::uuid, (rec ->> 'customer_id')::uuid),
            coalesce((id_map ->> (rec ->> 'contact_id'))::uuid, (rec ->> 'contact_id')::uuid),
            rec ->> 'stakeholder_role', rec ->> 'influence_stage', coalesce((rec ->> 'is_decision_maker')::boolean, false))
    on conflict do nothing;
  end loop;

  -- 7. Links (replace with the device's list)
  select coalesce(array_agg(coalesce((id_map ->> x)::uuid, x::uuid)), '{}') into ids
  from jsonb_array_elements_text(coalesce(p -> 'contact_ids', '[]'::jsonb)) x;
  delete from public.visit_contacts where visit_id = vid and not (contact_id = any (ids));
  insert into public.visit_contacts (visit_id, contact_id) select vid, unnest(ids) on conflict do nothing;

  select coalesce(array_agg(coalesce((id_map ->> x)::uuid, x::uuid)), '{}') into ids
  from jsonb_array_elements_text(coalesce(p -> 'project_ids', '[]'::jsonb)) x;
  delete from public.visit_projects where visit_id = vid and not (project_id = any (ids));
  insert into public.visit_projects (visit_id, project_id) select vid, unnest(ids) on conflict do nothing;
  perform public.ensure_project_access(x) from unnest(ids) x;

  select coalesce(array_agg(coalesce((id_map ->> x)::uuid, x::uuid)), '{}') into ids
  from jsonb_array_elements_text(coalesce(p -> 'opportunity_ids', '[]'::jsonb)) x;
  delete from public.visit_opportunities where visit_id = vid and not (opportunity_id = any (ids));
  insert into public.visit_opportunities (visit_id, opportunity_id) select vid, unnest(ids) on conflict do nothing;

  -- 8. Next actions
  for rec in select * from jsonb_array_elements(coalesce(p -> 'actions', '[]'::jsonb)) loop
    insert into public.actions (id, visit_id, customer_id, project_id, opportunity_id, description, owner_id, priority, due_date, status)
    values ((rec ->> 'id')::uuid, vid,
            coalesce((id_map ->> (rec ->> 'customer_id'))::uuid, (rec ->> 'customer_id')::uuid, (v ->> 'customer_id')::uuid),
            coalesce((id_map ->> (rec ->> 'project_id'))::uuid, (rec ->> 'project_id')::uuid),
            coalesce((id_map ->> (rec ->> 'opportunity_id'))::uuid, (rec ->> 'opportunity_id')::uuid),
            rec ->> 'description', coalesce((rec ->> 'owner_id')::uuid, auth.uid()),
            coalesce(rec ->> 'priority', 'normal'), (rec ->> 'due_date')::date, coalesce(rec ->> 'status', 'open'))
    on conflict (id) do nothing;
  end loop;

  -- 9. Attachments already uploaded to storage
  for rec in select * from jsonb_array_elements(coalesce(p -> 'attachments', '[]'::jsonb)) loop
    insert into public.attachments (id, entity_type, entity_id, storage_path, filename, mime_type, size_bytes, caption)
    values ((rec ->> 'id')::uuid, coalesce(rec ->> 'entity_type', 'visit'),
            coalesce((id_map ->> (rec ->> 'entity_id'))::uuid, (rec ->> 'entity_id')::uuid, vid),
            rec ->> 'storage_path', rec ->> 'filename', rec ->> 'mime_type', (rec ->> 'size_bytes')::bigint, rec ->> 'caption')
    on conflict (id) do nothing;
  end loop;

  -- 10. Submit (validation runs in the visits_submit trigger)
  if do_submit then
    update public.visits set status = 'submitted' where id = vid;
  end if;

  select * into result from public.visits where id = vid;
  return jsonb_build_object('visit_id', result.id, 'code', result.code, 'status', result.status,
                            'version', result.version, 'id_map', id_map, 'already_processed', false);
end $$;

-- ---------------------------------------------------------------------------
-- Corrections to submitted visits
-- ---------------------------------------------------------------------------
create or replace function public.correctable_visit_fields() returns text[]
language sql immutable as $$
  select array['customer_id', 'contact_unavailable_reason', 'visit_type', 'visit_date', 'check_in_at', 'check_out_at',
    'meeting_place', 'is_remote', 'location_unavailable_reason', 'purpose', 'products_discussed', 'requirements',
    'pain_points', 'decision_process', 'budget_indication', 'funding_status', 'purchase_timeline', 'estimated_value',
    'currency', 'confidence', 'competitor', 'incumbent', 'spec_position', 'differentiator', 'risks', 'summary',
    'commitments', 'documents_shared', 'documents_requested', 'outcome', 'next_meeting_at', 'no_followup_reason']
$$;

create or replace function public.approve_correction(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  cr public.correction_requests;
  keys text[];
  cols text;
begin
  if not public.is_manager() then raise exception 'Only a manager can approve corrections' using errcode = '42501'; end if;
  select * into cr from public.correction_requests where id = p_id for update;
  if not found or cr.status <> 'pending' then raise exception 'Correction request is not pending' using errcode = '22023'; end if;
  select array_agg(k) into keys from jsonb_object_keys(cr.changes) k where k = any (public.correctable_visit_fields());
  if keys is not null then
    select string_agg(quote_ident(k), ', ') into cols from unnest(keys) k;
    execute format('update public.visits set (%1$s) = (select %1$s from jsonb_populate_record(null::public.visits, $1)) where id = $2', cols)
      using cr.changes, cr.visit_id;
  end if;
  update public.correction_requests set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note where id = p_id;
end $$;

create or replace function public.reject_correction(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Only a manager can reject corrections' using errcode = '42501'; end if;
  update public.correction_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
  where id = p_id and status = 'pending';
  if not found then raise exception 'Correction request is not pending' using errcode = '22023'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Offboarding: move a user's records to another owner
-- ---------------------------------------------------------------------------
create or replace function public.reassign_owner(p_from uuid, p_to uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c1 int; c2 int; c3 int; c4 int; c5 int;
begin
  if not public.is_admin() then raise exception 'Only an administrator can reassign records' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_to and active) then
    raise exception 'The new owner must be an active user' using errcode = '22023';
  end if;
  update public.customers set owner_id = p_to where owner_id = p_from; get diagnostics c1 = row_count;
  update public.contacts set owner_id = p_to where owner_id = p_from; get diagnostics c2 = row_count;
  update public.projects set owner_id = p_to where owner_id = p_from; get diagnostics c3 = row_count;
  update public.opportunities set owner_id = p_to where owner_id = p_from and closed_at is null; get diagnostics c4 = row_count;
  update public.actions set owner_id = p_to where owner_id = p_from and status in ('open', 'in_progress'); get diagnostics c5 = row_count;
  return jsonb_build_object('customers', c1, 'contacts', c2, 'projects', c3, 'opportunities', c4, 'actions', c5);
end $$;

-- ---------------------------------------------------------------------------
-- Shared report filter. Filters JSON (all optional):
--   { "from": "2026-09-01", "to": "2026-09-30", "owner_id": uuid, "territory_id": uuid, "stage_id": uuid }
-- Date range applies to activity (visit date, action created/due, quotation
-- submission, stage closure, audit time). Masters and the open pipeline are
-- filtered by owner / territory / stage only.
-- ---------------------------------------------------------------------------
create or replace function public.filter_from(f jsonb) returns date language sql immutable as $$
  select coalesce((f ->> 'from')::date, date '1900-01-01') $$;
create or replace function public.filter_to(f jsonb) returns date language sql immutable as $$
  select coalesce((f ->> 'to')::date, date '2999-12-31') $$;

create or replace function public.dashboard_summary(f jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  d_from date := public.filter_from(f);
  d_to date := public.filter_to(f);
  f_owner uuid := (f ->> 'owner_id')::uuid;
  f_terr uuid := (f ->> 'territory_id')::uuid;
  f_stage uuid := (f ->> 'stage_id')::uuid;
  today date := (now() at time zone 'Asia/Colombo')::date;
  stale_days int := coalesce((public.setting('stale_project_days') #>> '{}')::int, 30);
  out jsonb;
begin
  if public.current_app_role() is null then raise exception 'Not authorised' using errcode = '42501'; end if;

  with
  vis as (
    select v.* from public.visits v
    where v.visit_date between d_from and d_to and v.status <> 'draft'
      and (f_owner is null or v.salesperson_id = f_owner) and (f_terr is null or v.territory_id = f_terr)),
  cust as (
    select c.* from public.customers c
    where c.deleted_at is null and c.status in ('active', 'prospect', 'provisional')
      and (f_owner is null or c.owner_id = f_owner) and (f_terr is null or c.territory_id = f_terr)),
  opp as (
    select o.*, s.name as stage_name, s.sort_order, s.outcome as stage_outcome,
           public.to_base(o.estimated_value, o.currency) as value_base,
           public.to_base(o.weighted_value, o.currency) as weighted_base
    from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id
    where o.deleted_at is null
      and (f_owner is null or o.owner_id = f_owner) and (f_terr is null or o.territory_id = f_terr)
      and (f_stage is null or o.stage_id = f_stage)),
  act as (
    select a.* from public.actions a
    where (f_owner is null or a.owner_id = f_owner) and (f_terr is null or a.territory_id = f_terr)),
  quo as (
    select q.* from public.quotations q join opp on opp.id = q.opportunity_id
    where q.submission_date between d_from and d_to)
  select jsonb_build_object(
    'generated_at', now(),
    'base_currency', public.base_currency(),
    'filters', f,
    'visits', jsonb_build_object(
      'submitted', (select count(*) from vis where status = 'submitted'),
      'planned', (select count(*) from vis where scheduled_at is not null and status <> 'cancelled'),
      'planned_completed', (select count(*) from vis where scheduled_at is not null and status = 'submitted'),
      'unplanned_completed', (select count(*) from vis where scheduled_at is null and status = 'submitted'),
      'cancelled', (select count(*) from vis where status = 'cancelled'),
      'leading_to_projects', (select count(*) from vis where status = 'submitted'
                                and exists (select 1 from public.visit_projects vp where vp.visit_id = vis.id)),
      'leading_to_quotations', (select count(*) from vis where status = 'submitted' and exists (
          select 1 from public.quotations q join public.opportunities o on o.id = q.opportunity_id
          where q.submission_date >= vis.visit_date
            and (o.id in (select opportunity_id from public.visit_opportunities where visit_id = vis.id)
                 or o.project_id in (select project_id from public.visit_projects where visit_id = vis.id))))),
    'visits_by_person', coalesce((select jsonb_agg(x order by x ->> 'name') from (
        select jsonb_build_object('user_id', p.id, 'name', p.full_name,
          'submitted', count(*) filter (where vis.status = 'submitted'),
          'planned', count(*) filter (where vis.scheduled_at is not null and vis.status <> 'cancelled'),
          'planned_completed', count(*) filter (where vis.scheduled_at is not null and vis.status = 'submitted')) x
        from vis join public.profiles p on p.id = vis.salesperson_id group by p.id, p.full_name) t), '[]'),
    'visits_by_week', coalesce((select jsonb_agg(jsonb_build_object('week', wk, 'count', n) order by wk) from (
        select to_char(date_trunc('week', visit_date), 'YYYY-MM-DD') wk, count(*) n from vis where status = 'submitted' group by 1) t), '[]'),
    'visits_by_month', coalesce((select jsonb_agg(jsonb_build_object('month', mo, 'count', n) order by mo) from (
        select to_char(visit_date, 'YYYY-MM') mo, count(*) n from vis where status = 'submitted' group by 1) t), '[]'),
    'accounts', jsonb_build_object(
      'total', (select count(*) from cust),
      'visited', (select count(*) from cust where exists (select 1 from vis where vis.customer_id = cust.id and vis.status = 'submitted')),
      'not_visited', (select count(*) from cust where not exists (select 1 from vis where vis.customer_id = cust.id and vis.status = 'submitted')),
      'not_visited_list', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', legal_name, 'last_visit_at', last_visit_at)
                                     order by last_visit_at nulls first) from (
          select * from cust where not exists (select 1 from vis where vis.customer_id = cust.id and vis.status = 'submitted')
          order by last_visit_at nulls first limit 50) t), '[]')),
    'actions', jsonb_build_object(
      'open', (select count(*) from act where status in ('open', 'in_progress')),
      'overdue', (select count(*) from act where status in ('open', 'in_progress') and due_date < today),
      'due_7_days', (select count(*) from act where status in ('open', 'in_progress') and due_date between today and today + 7),
      'completed_in_range', (select count(*) from act where status = 'done' and (completed_at at time zone 'Asia/Colombo')::date between d_from and d_to),
      'overdue_list', coalesce((select jsonb_agg(x order by x ->> 'due_date') from (
          select jsonb_build_object('id', a.id, 'code', a.code, 'description', a.description, 'due_date', a.due_date,
                                    'owner', p.full_name, 'owner_id', a.owner_id, 'priority', a.priority, 'escalated', a.escalated) x
          from act a left join public.profiles p on p.id = a.owner_id
          where a.status in ('open', 'in_progress') and a.due_date < today order by a.due_date limit 100) t), '[]')),
    'pipeline', jsonb_build_object(
      'open_count', (select count(*) from opp where stage_outcome = 'open'),
      'open_value', (select sum(value_base) from opp where stage_outcome = 'open'),
      'weighted_value', (select sum(weighted_base) from opp where stage_outcome = 'open'),
      'unconverted_count', (select count(*) from opp where stage_outcome = 'open' and estimated_value is not null and value_base is null),
      'by_stage', coalesce((select jsonb_agg(x order by (x ->> 'sort_order')::int) from (
          select jsonb_build_object('stage_id', s.id, 'stage', s.name, 'sort_order', s.sort_order, 'outcome', s.outcome,
                                    'count', count(opp.id), 'value', sum(opp.value_base), 'weighted', sum(opp.weighted_base)) x
          from public.pipeline_stages s left join opp on opp.stage_id = s.id
          where s.active group by s.id) t), '[]'),
      'by_owner', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('owner_id', opp.owner_id, 'owner', p.full_name, 'count', count(*),
                                    'value', sum(value_base), 'weighted', sum(weighted_base)) x
          from opp left join public.profiles p on p.id = opp.owner_id where stage_outcome = 'open' group by opp.owner_id, p.full_name) t), '[]'),
      'by_segment', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('segment', coalesce(segment, 'unspecified'), 'count', count(*),
                                    'value', sum(value_base), 'weighted', sum(weighted_base)) x
          from opp where stage_outcome = 'open' group by coalesce(segment, 'unspecified')) t), '[]'),
      'by_order_month', coalesce((select jsonb_agg(x order by x ->> 'month') from (
          select jsonb_build_object('month', coalesce(to_char(expected_order_date, 'YYYY-MM'), 'unscheduled'), 'count', count(*),
                                    'value', sum(value_base), 'weighted', sum(weighted_base)) x
          from opp where stage_outcome = 'open' group by coalesce(to_char(expected_order_date, 'YYYY-MM'), 'unscheduled')) t), '[]')),
    'results', jsonb_build_object(
      'won', (select count(*) from opp where stage_outcome = 'won' and (closed_at at time zone 'Asia/Colombo')::date between d_from and d_to),
      'won_value', (select sum(public.to_base(coalesce(final_award_value, estimated_value), currency)) from opp
                    where stage_outcome = 'won' and (closed_at at time zone 'Asia/Colombo')::date between d_from and d_to),
      'lost', (select count(*) from opp where stage_outcome = 'lost' and (closed_at at time zone 'Asia/Colombo')::date between d_from and d_to),
      'reasons', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('outcome', stage_outcome, 'reason', coalesce(win_loss_reason, 'unspecified'), 'count', count(*)) x
          from opp where stage_outcome in ('won', 'lost') and (closed_at at time zone 'Asia/Colombo')::date between d_from and d_to
          group by stage_outcome, coalesce(win_loss_reason, 'unspecified')) t), '[]')),
    'quotations', jsonb_build_object(
      'submitted', (select count(*) from quo where status <> 'draft'),
      'accepted', (select count(*) from quo where status = 'accepted'),
      'rejected', (select count(*) from quo where status = 'rejected'),
      'submitted_value', (select sum(public.to_base(amount, currency, submission_date)) from quo where status <> 'draft'),
      'conversion_pct', (select round(100.0 * count(*) filter (where status = 'accepted')
                                       / nullif(count(*) filter (where status in ('accepted', 'rejected')), 0), 1) from quo)),
    'tender_deadlines', coalesce((select jsonb_agg(x order by x ->> 'date') from (
        select jsonb_build_object('project_id', pr.id, 'code', pr.code, 'name', pr.name, 'kind', k.kind, 'date', k.d) x
        from public.projects pr
        cross join lateral (values ('tender_closing', pr.tender_closing_date), ('quotation_due', pr.quotation_due_date)) k(kind, d)
        where pr.deleted_at is null and pr.status = 'active' and k.d between today and today + 30
          and (f_owner is null or pr.owner_id = f_owner) and (f_terr is null or pr.territory_id = f_terr)
        union all
        select jsonb_build_object('project_id', opp.project_id, 'code', opp.code, 'name', opp.name, 'kind', 'package_quotation_due', 'date', opp.quotation_due_date)
        from opp where stage_outcome = 'open' and opp.quotation_due_date between today and today + 30) t), '[]'),
    'stale_projects', coalesce((select jsonb_agg(x order by x ->> 'last_activity_at') from (
        select jsonb_build_object('id', pr.id, 'code', pr.code, 'name', pr.name, 'last_activity_at', pr.last_activity_at, 'owner', p.full_name) x
        from public.projects pr left join public.profiles p on p.id = pr.owner_id
        where pr.deleted_at is null and pr.status = 'active' and pr.last_activity_at < now() - make_interval(days => stale_days)
          and (f_owner is null or pr.owner_id = f_owner) and (f_terr is null or pr.territory_id = f_terr)
        order by pr.last_activity_at limit 50) t), '[]'),
    'stale_days', stale_days
  ) into out;
  return out;
end $$;

-- ---------------------------------------------------------------------------
-- Export dataset: one JSON array per workbook sheet, RLS applies (invoker).
-- Cost and margin columns are only included when the caller may see them.
-- ---------------------------------------------------------------------------
create or replace function public.export_dataset(f jsonb default '{}'::jsonb, p_channel text default 'download')
returns jsonb language plpgsql volatile set search_path = public as $$
declare
  d_from date := public.filter_from(f);
  d_to date := public.filter_to(f);
  f_owner uuid := (f ->> 'owner_id')::uuid;
  f_terr uuid := (f ->> 'territory_id')::uuid;
  f_stage uuid := (f ->> 'stage_id')::uuid;
  margin boolean := public.can_see_margin();
  sheets jsonb;
  counts jsonb;
begin
  if public.current_app_role() is null then raise exception 'Not authorised' using errcode = '42501'; end if;

  create temporary table if not exists x_customers (id uuid primary key) on commit drop;
  create temporary table if not exists x_projects (id uuid primary key) on commit drop;
  create temporary table if not exists x_opps (id uuid primary key) on commit drop;
  create temporary table if not exists x_visits (id uuid primary key) on commit drop;
  truncate x_customers, x_projects, x_opps, x_visits;

  insert into x_customers select id from public.customers
  where deleted_at is null and (f_owner is null or owner_id = f_owner) and (f_terr is null or territory_id = f_terr);

  insert into x_opps select id from public.opportunities
  where deleted_at is null and (f_owner is null or owner_id = f_owner) and (f_terr is null or territory_id = f_terr)
    and (f_stage is null or stage_id = f_stage);

  insert into x_projects select id from public.projects pr
  where deleted_at is null and (f_terr is null or territory_id = f_terr)
    and (f_owner is null or owner_id = f_owner or exists (select 1 from public.opportunities o join x_opps using (id) where o.project_id = pr.id))
    and (f_stage is null or exists (select 1 from public.opportunities o join x_opps using (id) where o.project_id = pr.id));

  insert into x_visits select id from public.visits
  where status <> 'draft' and visit_date between d_from and d_to
    and (f_owner is null or salesperson_id = f_owner) and (f_terr is null or territory_id = f_terr);

  select jsonb_build_object(
    'customers', coalesce((select jsonb_agg(to_jsonb(c) - 'normalized_name' - 'version' || jsonb_build_object(
        'owner_name', o.full_name, 'territory', t.name, 'parent_customer_code', pc.code) order by c.code)
      from public.customers c join x_customers using (id)
      left join public.profiles o on o.id = c.owner_id left join public.territories t on t.id = c.territory_id
      left join public.customers pc on pc.id = c.parent_customer_id), '[]'),
    'contacts', coalesce((select jsonb_agg(to_jsonb(ct) - 'normalized_name' - 'version' || jsonb_build_object(
        'customer_code', c.code, 'customer_name', c.legal_name, 'owner_name', o.full_name) order by ct.code)
      from public.contacts ct join public.customers c on c.id = ct.customer_id join x_customers x on x.id = c.id
      left join public.profiles o on o.id = ct.owner_id where ct.deleted_at is null), '[]'),
    'visits', coalesce((select jsonb_agg(to_jsonb(v) - 'version' || jsonb_build_object(
        'customer_code', c.code, 'customer_name', c.legal_name, 'salesperson_name', s.full_name, 'territory', t.name,
        'project_codes', (select string_agg(p.code, ', ' order by p.code) from public.visit_projects vp join public.projects p on p.id = vp.project_id where vp.visit_id = v.id),
        'action_count', (select count(*) from public.actions a where a.visit_id = v.id)) order by v.visit_date, v.code)
      from public.visits v join x_visits using (id)
      left join public.customers c on c.id = v.customer_id left join public.profiles s on s.id = v.salesperson_id
      left join public.territories t on t.id = v.territory_id), '[]'),
    'visit_contacts', coalesce((select jsonb_agg(jsonb_build_object('visit_id', vc.visit_id, 'visit_code', v.code,
        'contact_id', vc.contact_id, 'contact_code', ct.code, 'contact_name', ct.full_name, 'customer_id', ct.customer_id) order by v.code, ct.code)
      from public.visit_contacts vc join x_visits x on x.id = vc.visit_id join public.visits v on v.id = vc.visit_id
      join public.contacts ct on ct.id = vc.contact_id), '[]'),
    'projects', coalesce((select jsonb_agg(to_jsonb(p) - 'normalized_name' - 'version' || jsonb_build_object(
        'customer_code', c.code, 'customer_name', c.legal_name, 'developer_name', d.legal_name, 'end_user_name', e.legal_name,
        'owner_name', o.full_name, 'territory', t.name,
        'aliases', array_to_string(p.aliases, '; '), 'segments', array_to_string(p.segments, '; '),
        'drawing_links', array_to_string(p.drawing_links, ' ')) order by p.code)
      from public.projects p join x_projects using (id)
      left join public.customers c on c.id = p.customer_id left join public.customers d on d.id = p.developer_id
      left join public.customers e on e.id = p.end_user_id left join public.profiles o on o.id = p.owner_id
      left join public.territories t on t.id = p.territory_id), '[]'),
    'opportunities', coalesce((select jsonb_agg(to_jsonb(o) - 'version' || jsonb_build_object(
        'project_code', p.code, 'project_name', p.name, 'stage', s.name, 'stage_outcome', s.outcome, 'owner_name', u.full_name,
        'base_currency', public.base_currency(),
        'estimated_value_base', public.to_base(o.estimated_value, o.currency),
        'weighted_value_base', public.to_base(o.weighted_value, o.currency)) order by o.code)
      from public.opportunities o join x_opps using (id) join public.projects p on p.id = o.project_id
      join public.pipeline_stages s on s.id = o.stage_id left join public.profiles u on u.id = o.owner_id), '[]'),
    'project_stakeholders', coalesce((select jsonb_agg(to_jsonb(ps) - 'version' || jsonb_build_object(
        'project_code', p.code, 'customer_code', c.code, 'customer_name', c.legal_name, 'contact_code', ct.code, 'contact_name', ct.full_name)
        order by p.code, ps.stakeholder_role)
      from public.project_stakeholders ps join x_projects x on x.id = ps.project_id join public.projects p on p.id = ps.project_id
      left join public.customers c on c.id = ps.customer_id left join public.contacts ct on ct.id = ps.contact_id), '[]'),
    'actions', coalesce((select jsonb_agg(to_jsonb(a) - 'version' || jsonb_build_object(
        'owner_name', u.full_name, 'customer_code', c.code, 'project_code', p.code, 'visit_code', v.code, 'opportunity_code', o.code,
        'parent_type', case when a.visit_id is not null then 'visit' when a.opportunity_id is not null then 'opportunity'
                            when a.project_id is not null then 'project' else 'customer' end,
        'parent_id', coalesce(a.visit_id, a.opportunity_id, a.project_id, a.customer_id)) order by a.code)
      from public.actions a
      left join public.profiles u on u.id = a.owner_id left join public.customers c on c.id = a.customer_id
      left join public.projects p on p.id = a.project_id left join public.visits v on v.id = a.visit_id
      left join public.opportunities o on o.id = a.opportunity_id
      where (f_owner is null or a.owner_id = f_owner) and (f_terr is null or a.territory_id = f_terr)
        and (a.status in ('open', 'in_progress') or (a.created_at at time zone 'Asia/Colombo')::date between d_from and d_to
             or a.due_date between d_from and d_to)), '[]'),
    'quotations', coalesce((select jsonb_agg(to_jsonb(q) - 'version' || jsonb_build_object(
        'opportunity_code', o.code, 'project_code', p.code, 'recipient_name', coalesce(ct.full_name, c.legal_name),
        'prepared_by_name', u.full_name, 'amount_base', public.to_base(q.amount, q.currency, q.submission_date))
        || case when margin then jsonb_build_object('cost_amount', qf.cost_amount, 'gross_margin_pct', qf.gross_margin_pct) else '{}'::jsonb end
        order by q.reference, q.revision)
      from public.quotations q join x_opps x on x.id = q.opportunity_id join public.opportunities o on o.id = q.opportunity_id
      join public.projects p on p.id = o.project_id
      left join public.quotation_financials qf on margin and qf.quotation_id = q.id
      left join public.contacts ct on ct.id = q.recipient_contact_id left join public.customers c on c.id = q.recipient_customer_id
      left join public.profiles u on u.id = q.prepared_by), '[]'),
    'audit_log', case when public.is_manager() then coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'table_name', l.table_name, 'record_id', l.record_id, 'record_code', l.record_code, 'action', l.action,
        'changed_by', l.changed_by, 'changed_by_name', u.full_name, 'changed_at', l.changed_at,
        'changed_fields', array_to_string(l.changed_fields, ', '), 'note', l.note) order by l.changed_at)
      from (select * from public.audit_log
            where (changed_at at time zone 'Asia/Colombo')::date between d_from and d_to
              and action <> 'insert' and table_name in ('customers', 'contacts', 'projects', 'opportunities', 'visits', 'actions', 'quotations', 'project_stakeholders', 'correction_requests', 'export_log')
            order by changed_at desc limit 20000) l
      left join public.profiles u on u.id = l.changed_by), '[]') else '[]'::jsonb end
  ) into sheets;

  select jsonb_object_agg(k, jsonb_array_length(sheets -> k)) into counts from jsonb_object_keys(sheets) k;
  return jsonb_build_object(
    'export_id', public.record_export(f, counts, p_channel, null),
    'generated_at', now(), 'generated_by', auth.uid(), 'filters', f, 'base_currency', public.base_currency(),
    'can_see_margin', margin, 'row_counts', counts, 'sheets', sheets, 'summary', public.dashboard_summary(f));
end $$;

create or replace function public.record_export(f jsonb, counts jsonb, p_channel text, p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.export_log (user_id, channel, filters, row_counts, storage_path)
  values (auth.uid(), coalesce(p_channel, 'download'), f, counts, p_path) returning id into new_id;
  insert into public.audit_log (table_name, record_id, action, changed_by, new_data, note)
  values ('export_log', new_id, 'export', auth.uid(), jsonb_build_object('filters', f, 'row_counts', counts), p_channel);
  return new_id;
end $$;

-- ---------------------------------------------------------------------------
-- Retention (run daily by pg_cron; see docs/DEPLOYMENT.md)
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int; e int;
begin
  delete from public.audit_log
  where changed_at < now() - make_interval(days => coalesce((public.setting('audit_retention_days') #>> '{}')::int, 2555));
  get diagnostics a = row_count;
  delete from public.export_log
  where created_at < now() - make_interval(days => coalesce((public.setting('export_log_retention_days') #>> '{}')::int, 730));
  get diagnostics e = row_count;
  return jsonb_build_object('audit_log', a, 'export_log', e);
end $$;
revoke execute on function public.purge_expired() from public, anon, authenticated;
revoke execute on function public.match_customer(text, text), public.match_project(text, text) from anon;

-- Real-time dashboard: publish the tables the dashboard listens to.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.visits, public.actions, public.opportunities, public.projects;
  end if;
end $$;
