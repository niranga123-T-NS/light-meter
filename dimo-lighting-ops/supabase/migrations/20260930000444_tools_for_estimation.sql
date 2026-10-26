-- Sales Tools (Standards, Catalogs, Lux meter, DLux, References and Dacademy) for the estimation team too: SM Estimation,
-- AM Estimation and the estimation executives (until now Dacademy only).
create or replace function app.sees_sales_tools() returns boolean
language sql stable as $$ select app.has_role('asm_building', 'asm_infra', 'sm_projects', 'gm', 'design_manager', 'lighting_designer', 'lighting_engineer', 'sys_admin', 'senior_elec_engineer', 'assistant_engineer', 'trainee', 'sm_estimation', 'am_estimation', 'estimation_exec') $$;
