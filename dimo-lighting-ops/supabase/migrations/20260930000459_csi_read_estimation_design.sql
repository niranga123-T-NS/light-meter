-- CSI surveys: SM Estimation and the Design Manager see all surveys (read only), alongside SM Projects / GM / sys admin
create or replace function app.csi_manager() returns boolean
language sql stable security definer set search_path = public as $$ select app.has_role('sm_projects', 'gm', 'sys_admin', 'sm_estimation', 'design_manager') $$;

select app.fix_function_owners();
