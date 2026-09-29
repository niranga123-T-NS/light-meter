-- Demo data for LOCAL development and acceptance testing only
-- (`npx supabase db reset` runs this after the migrations).
-- Never run against production.
--
-- Demo sign-ins (password for all: Dimo#2026)
--   admin@dimo.test      Administrator
--   manager@dimo.test    Sales manager
--   sales1@dimo.test     Salesperson – Western
--   sales2@dimo.test     Salesperson – Central
--   estimator@dimo.test  Estimation team
--   designer@dimo.test   Design team

do $$
declare
  u record;
begin
  for u in select * from (values
    ('00000000-0000-4000-a000-000000000001'::uuid, 'admin@dimo.test', 'Asha Admin', 'admin'),
    ('00000000-0000-4000-a000-000000000002'::uuid, 'manager@dimo.test', 'Mahesh Manager', 'manager'),
    ('00000000-0000-4000-a000-000000000003'::uuid, 'sales1@dimo.test', 'Sanjeewa Perera', 'salesperson'),
    ('00000000-0000-4000-a000-000000000004'::uuid, 'sales2@dimo.test', 'Dilani Fernando', 'salesperson'),
    ('00000000-0000-4000-a000-000000000005'::uuid, 'estimator@dimo.test', 'Eshan Estimator', 'estimator'),
    ('00000000-0000-4000-a000-000000000006'::uuid, 'designer@dimo.test', 'Dinesh Designer', 'designer')
  ) t(id, email, name, role) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
            extensions.crypt('Dimo#2026', extensions.gen_salt('bf')), now(), '', '', '', '',
            jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', u.role, 'active', true),
            jsonb_build_object('full_name', u.name), now(), now())
    on conflict (id) do nothing;
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (u.id, u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now())
    on conflict do nothing;
  end loop;
end $$;

insert into public.profile_territories (user_id, territory_id)
select '00000000-0000-4000-a000-000000000003'::uuid, id from public.territories where code = 'WESTERN'
union all
select '00000000-0000-4000-a000-000000000004'::uuid, id from public.territories where code = 'CENTRAL'
on conflict do nothing;

insert into public.exchange_rates (currency, rate_to_base, effective_date, source) values
  ('USD', 300.00, date '2026-09-01', 'Demo rate'),
  ('EUR', 330.00, date '2026-09-01', 'Demo rate')
on conflict do nothing;

-- Customers
insert into public.customers (id, legal_name, trading_name, category, industry, district, city, owner_id, territory_id, strategic_priority, status, source)
values
  ('10000000-0000-4000-a000-000000000001', 'Lanka Towers Development (Pvt) Ltd', 'Lanka Towers', 'developer', 'commercial', 'Colombo', 'Colombo',
   '00000000-0000-4000-a000-000000000003', (select id from public.territories where code = 'WESTERN'), 'A', 'active', 'field_visit'),
  ('10000000-0000-4000-a000-000000000002', 'Design Partners Architects', null, 'architect', 'commercial', 'Colombo', 'Colombo',
   '00000000-0000-4000-a000-000000000003', (select id from public.territories where code = 'WESTERN'), 'B', 'active', 'referral'),
  ('10000000-0000-4000-a000-000000000003', 'Hill Country Hotels PLC', 'Hill Country Hotels', 'end_user', 'hospitality', 'Kandy', 'Kandy',
   '00000000-0000-4000-a000-000000000004', (select id from public.territories where code = 'CENTRAL'), 'A', 'active', 'existing_customer'),
  ('10000000-0000-4000-a000-000000000004', 'Metro Electrical Engineering', null, 'contractor', 'infrastructure', 'Gampaha', 'Negombo',
   '00000000-0000-4000-a000-000000000003', (select id from public.territories where code = 'WESTERN'), 'B', 'active', 'field_visit')
on conflict do nothing;

insert into public.contacts (id, customer_id, full_name, designation, work_phone, email, decision_role, owner_id)
values
  ('20000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'Nimal Jayasinghe', 'Project Director', '+94 11 200 0001', 'nimal@lankatowers.test', 'decision_maker', '00000000-0000-4000-a000-000000000003'),
  ('20000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000002', 'Kavya Silva', 'Principal Architect', '+94 11 200 0002', 'kavya@designpartners.test', 'influencer', '00000000-0000-4000-a000-000000000003'),
  ('20000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000003', 'Ruwan Bandara', 'Chief Engineer', '+94 81 200 0003', 'ruwan@hillcountry.test', 'technical_evaluator', '00000000-0000-4000-a000-000000000004'),
  ('20000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000004', 'Chamara Wickramasinghe', 'Procurement Manager', '+94 31 200 0004', 'chamara@metroelec.test', 'procurement', '00000000-0000-4000-a000-000000000003')
on conflict do nothing;

-- Projects and packages
insert into public.projects (id, name, aliases, site_location, district, city, customer_id, developer_id, project_type, description, segments,
                             total_estimate, addressable_value, currency, design_stage, tender_closing_date, expected_award_date, owner_id, lead_source)
values
  ('30000000-0000-4000-a000-000000000001', 'Lanka Towers Phase 2', '{LT2,"Lanka Tower Two"}', 'Union Place', 'Colombo', 'Colombo',
   '10000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'new_build', '42-storey mixed-use tower',
   '{indoor,facade,smart_controls}', 4500000000, 180000000, 'LKR', 'detailed', current_date + 20, current_date + 60,
   '00000000-0000-4000-a000-000000000003', 'field_visit'),
  ('30000000-0000-4000-a000-000000000002', 'Kandy Lake Resort Refurbishment', '{}', 'Kandy lake front', 'Kandy', 'Kandy',
   '10000000-0000-4000-a000-000000000003', null, 'refurbishment', 'Lighting upgrade of 120 rooms and gardens',
   '{indoor,outdoor}', 300000000, 45000000, 'LKR', 'schematic', null, current_date + 90,
   '00000000-0000-4000-a000-000000000004', 'existing_customer')
on conflict do nothing;

insert into public.project_stakeholders (project_id, customer_id, contact_id, stakeholder_role, influence_stage, is_decision_maker) values
  ('30000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', 'developer', 'engaged', true),
  ('30000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000002', 'architect', 'specifying', false),
  ('30000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000004', null, 'electrical_contractor', 'aware', false)
on conflict do nothing;

insert into public.project_members (project_id, user_id, member_role) values
  ('30000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000005', 'estimator')
on conflict do nothing;

insert into public.opportunities (id, project_id, name, segment, owner_id, stage_id, estimated_value, currency, expected_order_date, quotation_due_date)
values
  ('40000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000001', 'Office floors indoor lighting', 'indoor',
   '00000000-0000-4000-a000-000000000003', (select id from public.pipeline_stages where code = 'tender_expected'), 120000000, 'LKR', current_date + 75, current_date + 25),
  ('40000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000001', 'Facade media lighting', 'facade',
   '00000000-0000-4000-a000-000000000003', (select id from public.pipeline_stages where code = 'design_influence'), 150000, 'USD', current_date + 120, null),
  ('40000000-0000-4000-a000-000000000003', '30000000-0000-4000-a000-000000000002', 'Guest room retrofit', 'indoor',
   '00000000-0000-4000-a000-000000000004', (select id from public.pipeline_stages where code = 'qualification'), 30000000, 'LKR', current_date + 100, null)
on conflict do nothing;
