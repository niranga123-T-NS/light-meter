-- SM Projects reads every meeting of every team – sales, estimation, design, execution and project meetings, drafts as well as the published minutes
-- (GM / DGM still see a meeting once its host publishes it); notes, items, actions and invitees follow the meeting
drop policy if exists sales_meetings_read on public.sales_meetings;
create policy sales_meetings_read on public.sales_meetings for select to authenticated
  using (app.is_meeting_host(team) or app.has_role('sm_projects') or (status = 'published' and app.has_role('gm')));
