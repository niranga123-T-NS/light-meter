-- Win Predictor use: SM Estimation sees the usage (report and logs) alongside DGM / GM and SM Projects
create or replace function app.can_see_win_use(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or app.has_role('gm', 'sm_projects', 'sm_estimation') or exists (select 1 from public.profiles where id = p_user and manager_id = auth.uid())
$$;

do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.win_wizard_report(date, date)'::regprocedure);
  before := def;
  def := replace(def, $k$app.require(app.has_role('gm', 'sm_projects'), 'Win Predictor use is reported to DGM / GM and SM Projects')$k$,
    $k$app.require(app.has_role('gm', 'sm_projects', 'sm_estimation'), 'Win Predictor use is reported to DGM / GM, SM Projects and SM Estimation')$k$);
  perform app.require(def <> before, 'win_wizard_report: role check not found');
  execute def;
end $$;

select app.fix_function_owners();
