-- Sales people and SM Projects can also add brands (recorded as pending until the Design Manager / SM Estimation approve)
create or replace function app.can_add_brand() returns boolean
language sql stable as $$
  select app.is_brand_manager()
      or app.has_role('lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec', 'asm_building', 'asm_infra', 'sm_projects')
$$;
