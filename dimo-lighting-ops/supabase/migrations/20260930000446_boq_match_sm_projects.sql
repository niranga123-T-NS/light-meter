-- BOQ match is in the new Estimation tab for the DGM, SM Projects and the estimation team: SM Projects can save matches too
create or replace function app.can_edit_boq_match(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.can_read_estimation_job(p_job) and app.has_role('gm', 'sm_projects', 'sm_estimation', 'am_estimation', 'estimation_exec')
$$;
