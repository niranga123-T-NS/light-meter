-- Execution tasks from a team meeting can be appointed to temporary staff too: a Trainee joins the Senior Electrical Engineer and the
-- Assistant Engineers (permanent or temporary) in the execution team. Project meetings already offer everyone on the project.
create or replace function app.action_members(p_kind text) returns public.app_role[] language sql immutable as $$
  select case p_kind when 'design' then array['design_manager', 'lighting_designer', 'lighting_engineer']::public.app_role[]
                     when 'estimation' then array['sm_estimation', 'am_estimation', 'estimation_exec']::public.app_role[]
                     when 'execution' then array['senior_elec_engineer', 'assistant_engineer', 'trainee']::public.app_role[] end
$$;
