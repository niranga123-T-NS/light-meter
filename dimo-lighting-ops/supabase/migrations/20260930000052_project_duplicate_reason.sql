-- Fix: creating a project with "This is a different project – reason" failed with "You do not have permission to do that".
-- create_project runs with the caller's rights and wrote the reason straight into project_log, which has no insert
-- policy. The reason is now logged through a security-definer helper (only for a project the caller can read).

create or replace function app.log_project_duplicate(p_project uuid, p_name text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.can_read_project(p_project), 'Project not found');
  insert into public.project_log (project_id, field, new_value, reason) values (p_project, 'duplicate_override', p_name, p_reason);
end $$;
revoke execute on function app.log_project_duplicate(uuid, text, text) from public, anon;
grant execute on function app.log_project_duplicate(uuid, text, text) to authenticated;

create or replace function public.create_project(p jsonb, p_reason text default null, p_duplicate_reason text default null) returns uuid
language plpgsql as $$
declare new_id uuid;
begin
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  insert into public.projects (name, project_type, organization_id, unit_id, location, city, lat, lng, stage, duty_status, currency,
                               project_value, lighting_value, expected_duration_months, project_term, expected_tender_date,
                               expected_award_date, owner_id, first_visit_due, duplicate_override_reason)
  values (p ->> 'name', (p ->> 'project_type')::public.project_type, (p ->> 'organization_id')::uuid, nullif(p ->> 'unit_id', '')::uuid,
          p ->> 'location', p ->> 'city', nullif(p ->> 'lat', '')::float8, nullif(p ->> 'lng', '')::float8, coalesce(p ->> 'stage', 'Concept'),
          nullif(p ->> 'duty_status', '')::public.duty_status,
          case when p ->> 'duty_status' = 'duty_free' then 'USD'::public.currency else 'LKR'::public.currency end,
          nullif(p ->> 'project_value', '')::numeric, nullif(p ->> 'lighting_value', '')::numeric,
          (p ->> 'expected_duration_months')::int, nullif(p ->> 'project_term', ''),
          nullif(p ->> 'expected_tender_date', '')::date, nullif(p ->> 'expected_award_date', '')::date,
          coalesce(nullif(p ->> 'owner_id', '')::uuid, auth.uid()), nullif(p ->> 'first_visit_due', '')::date, nullif(btrim(p_duplicate_reason), ''))
  returning id into new_id;
  -- Duplicate-name project created with a "different project" reason is logged (8.6 #5)
  if nullif(btrim(p_duplicate_reason), '') is not null then
    perform app.log_project_duplicate(new_id, p ->> 'name', btrim(p_duplicate_reason));
  end if;
  return new_id;
end $$;
