-- Estimation basis: add "Supply & commission" (supply plus testing / commissioning, installation by others)
alter table public.inquiries drop constraint if exists inquiries_estimation_basis_check;
alter table public.inquiries add constraint inquiries_estimation_basis_check
  check (estimation_basis is null or estimation_basis in ('supply', 'supply_commission', 'supply_install', 'supply_install_commission'));
