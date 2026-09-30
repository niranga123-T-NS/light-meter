-- Fix: a sales person creating a project got "You do not have permission to do that".
-- The read policy looked the project up by id, but a row being inserted is not yet visible to
-- that lookup, so INSERT ... RETURNING failed. Check the row's own columns instead.
drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated
  using (app.has_role('gm', 'sm_projects')
         or (app.is_sales_person() and (owner_id = auth.uid() or project_type = any (app.my_project_types()))));
