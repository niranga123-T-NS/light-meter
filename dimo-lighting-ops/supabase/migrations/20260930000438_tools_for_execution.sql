-- Sales Tools (Standards, Catalogs, Lux meter, DLux, References and Dacademy) for the execution team too: the Senior
-- Electrical Engineer, the Assistant Engineers and the trainees (until now Dacademy only).
create or replace function app.sees_sales_tools() returns boolean
language sql stable as $$ select app.has_role('asm_building', 'asm_infra', 'sm_projects', 'gm', 'design_manager', 'lighting_designer', 'lighting_engineer', 'sys_admin', 'senior_elec_engineer', 'assistant_engineer', 'trainee') $$;
