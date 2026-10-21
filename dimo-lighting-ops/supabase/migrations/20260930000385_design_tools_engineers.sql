-- Design Tools for the execution engineers too: the Senior Electrical Engineer and the Assistant Engineers join the GM / DGM, SM Projects
-- and the design team (checking a design stays with the Design Manager; returning it with the Design Manager, SM Projects or GM / DGM).
create or replace function app.design_tools_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active
                 and role in ('gm', 'sm_projects', 'design_manager', 'lighting_designer', 'lighting_engineer', 'senior_elec_engineer', 'assistant_engineer'))
$$;
