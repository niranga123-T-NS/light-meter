-- Estimation scope: Professional staff (engineers, supervisors, technicians supplied to the client) – priced by Estimation
alter table public.inquiries drop constraint if exists inquiries_estimation_scope_check;
alter table public.inquiries add constraint inquiries_estimation_scope_check
  check (estimation_scope <@ array['fixtures', 'electrical', 'controls', 'poles', 'staff']::text[]);
