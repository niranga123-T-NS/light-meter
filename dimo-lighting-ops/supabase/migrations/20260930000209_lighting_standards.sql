-- Sales Tools · Standards: recommended lighting levels by space, kept by the Design Manager
--  * Six groups: indoor workplaces (EN 12464-1), outdoor work areas (EN 12464-2), roads (EN 13201-2), sports
--    (EN 12193), emergency lighting (EN 1838 / BS 5266-1) and energy (SLSEA Code for Energy Efficient Buildings).
--  * Only the key values are stored (not the standards' text). Each group carries its source, edition and when
--    the Design Manager last reviewed it; until then the app marks the values "awaiting Design Manager review".
--  * Read by sales, SM Projects, GM / DGM and the Design team; changed by the Design Manager (and System Administrator).

create table if not exists public.lighting_standard_groups (
  grp text primary key check (grp in ('indoor', 'outdoor', 'road', 'sports', 'emergency', 'energy')),
  title text not null,
  source text not null,
  sort int not null default 0,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  note text
);

create table if not exists public.lighting_standards (
  id uuid primary key default gen_random_uuid(),
  grp text not null references public.lighting_standard_groups (grp),
  category text not null,
  space text not null,
  ref text,
  vals jsonb not null default '{}'::jsonb,
  notes text,
  sort int not null default 0,
  active boolean not null default true,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create index if not exists lighting_standards_grp on public.lighting_standards (grp, category, sort);

create or replace function app.sees_sales_tools() returns boolean
language sql stable as $$ select app.has_role('asm_building', 'asm_infra', 'sm_projects', 'gm', 'design_manager', 'lighting_designer', 'lighting_engineer', 'sys_admin') $$;
create or replace function app.edits_standards() returns boolean
language sql stable as $$ select app.has_role('design_manager', 'sys_admin') $$;

alter table public.lighting_standard_groups enable row level security;
alter table public.lighting_standards enable row level security;
drop policy if exists lsg_read on public.lighting_standard_groups;
drop policy if exists lsg_write on public.lighting_standard_groups;
drop policy if exists ls_read on public.lighting_standards;
drop policy if exists ls_write on public.lighting_standards;
create policy lsg_read on public.lighting_standard_groups for select to authenticated using (app.sees_sales_tools());
create policy lsg_write on public.lighting_standard_groups for update to authenticated using (app.edits_standards()) with check (app.edits_standards());
create policy ls_read on public.lighting_standards for select to authenticated using (app.sees_sales_tools());
create policy ls_write on public.lighting_standards for all to authenticated using (app.edits_standards()) with check (app.edits_standards());
grant select, update on public.lighting_standard_groups to authenticated;
grant select, insert, update, delete on public.lighting_standards to authenticated;
drop trigger if exists audit_lighting_standards on public.lighting_standards;
create trigger audit_lighting_standards after insert or update on public.lighting_standards for each row execute function app.audit();
drop trigger if exists audit_lighting_standard_groups on public.lighting_standard_groups;
create trigger audit_lighting_standard_groups after update on public.lighting_standard_groups for each row execute function app.audit();

insert into public.lighting_standard_groups (grp, title, source, sort) values
  ('indoor', 'Indoor workplaces', 'EN 12464-1:2021', 1),
  ('outdoor', 'Outdoor work areas', 'EN 12464-2:2014', 2),
  ('road', 'Roads and streets', 'EN 13201-2:2015', 3),
  ('sports', 'Sports', 'EN 12193:2018', 4),
  ('emergency', 'Emergency lighting', 'EN 1838:2013 / BS 5266-1:2016', 5),
  ('energy', 'Energy (lighting power density)', 'SLSEA – Code for Energy Efficient Buildings in Sri Lanka', 6)
on conflict (grp) do nothing;

-- First load only (the Design Manager maintains the values from here)
insert into public.lighting_standards (grp, category, space, ref, vals, notes, sort)
select * from (values
  ('indoor', 'Offices', 'Writing, typing, reading, data processing', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, null, 1),
  ('indoor', 'Offices', 'Technical drawing', null, '{"em": 750, "uo": 0.7, "ugr": 16, "ra": 80}'::jsonb, null, 2),
  ('indoor', 'Offices', 'CAD work stations', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, null, 3),
  ('indoor', 'Offices', 'Conference and meeting rooms', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, 'Lighting should be controllable', 4),
  ('indoor', 'Offices', 'Reception desk', null, '{"em": 300, "uo": 0.6, "ugr": 22, "ra": 80}'::jsonb, null, 5),
  ('indoor', 'Offices', 'Filing, copying', null, '{"em": 300, "uo": 0.4, "ugr": 19, "ra": 80}'::jsonb, null, 6),
  ('indoor', 'Offices', 'Archives', null, '{"em": 200, "uo": 0.4, "ugr": 25, "ra": 80}'::jsonb, null, 7),
  ('indoor', 'Education', 'Classrooms', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, 'Lighting should be controllable', 8),
  ('indoor', 'Education', 'Classrooms for evening classes and adult education', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, null, 9),
  ('indoor', 'Education', 'Lecture halls', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, 'Lighting should be controllable', 10),
  ('indoor', 'Education', 'Black, green and white boards', null, '{"em": 500, "uo": 0.7, "ugr": 19, "ra": 80}'::jsonb, 'Vertical illuminance on the board; avoid specular reflections', 11),
  ('indoor', 'Education', 'Art rooms', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, null, 12),
  ('indoor', 'Education', 'Art rooms in art schools', null, '{"em": 750, "uo": 0.7, "ugr": 19, "ra": 90}'::jsonb, 'Colour temperature 5000 K or higher recommended', 13),
  ('indoor', 'Education', 'Practical rooms and laboratories', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, null, 14),
  ('indoor', 'Education', 'Computer practice rooms (menu driven)', null, '{"em": 300, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, null, 15),
  ('indoor', 'Education', 'Library – bookshelves', null, '{"em": 200, "uo": 0.4, "ugr": 19, "ra": 80}'::jsonb, null, 16),
  ('indoor', 'Education', 'Library – reading areas', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, null, 17),
  ('indoor', 'Education', 'Sports halls, gymnasiums, swimming pools (general use)', null, '{"em": 300, "uo": 0.6, "ugr": 22, "ra": 80}'::jsonb, 'For competition see the Sports group', 18),
  ('indoor', 'Education', 'School canteens', null, '{"em": 200, "uo": 0.4, "ugr": 22, "ra": 80}'::jsonb, null, 19),
  ('indoor', 'Health care', 'Waiting rooms', null, '{"em": 200, "uo": 0.4, "ugr": 22, "ra": 80}'::jsonb, null, 20),
  ('indoor', 'Health care', 'Corridors – during the day', null, '{"em": 200, "uo": 0.4, "ugr": 22, "ra": 80}'::jsonb, null, 21),
  ('indoor', 'Health care', 'Corridors – at night', null, '{"em": 50, "uo": 0.4, "ugr": 22, "ra": 80}'::jsonb, null, 22),
  ('indoor', 'Health care', 'Wards – general lighting', null, '{"em": 100, "uo": 0.4, "ugr": 19, "ra": 80}'::jsonb, 'Illuminance at floor level', 23),
  ('indoor', 'Health care', 'Wards – reading lighting', null, '{"em": 300, "uo": 0.7, "ugr": 19, "ra": 80}'::jsonb, null, 24),
  ('indoor', 'Health care', 'Examination rooms – general', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 90}'::jsonb, null, 25),
  ('indoor', 'Health care', 'Examination and treatment', null, '{"em": 1000, "uo": 0.7, "ugr": 19, "ra": 90}'::jsonb, null, 26),
  ('indoor', 'Health care', 'Operating theatres – general', null, '{"em": 1000, "uo": 0.6, "ugr": 19, "ra": 90}'::jsonb, 'Operating field lighting is separate (EN 60601-2-41)', 27),
  ('indoor', 'Health care', 'Nurses'' stations', null, '{"em": 300, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, null, 28),
  ('indoor', 'Retail', 'Sales area', null, '{"em": 300, "uo": 0.4, "ugr": 22, "ra": 80}'::jsonb, 'Accent lighting on displays is usually 3–5 × general level', 29),
  ('indoor', 'Retail', 'Till area', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, null, 30),
  ('indoor', 'Retail', 'Wrapping table', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, null, 31),
  ('indoor', 'Hotels and restaurants', 'Reception, cashier desk, porter desk', null, '{"em": 300, "uo": 0.6, "ugr": 22, "ra": 80}'::jsonb, null, 32),
  ('indoor', 'Hotels and restaurants', 'Kitchen', null, '{"em": 500, "uo": 0.6, "ugr": 22, "ra": 80}'::jsonb, null, 33),
  ('indoor', 'Hotels and restaurants', 'Restaurant, dining room, function room', null, '{"em": null, "uo": null, "ugr": null, "ra": 80}'::jsonb, 'Designed to create the required atmosphere – no fixed level', 34),
  ('indoor', 'Hotels and restaurants', 'Self-service restaurant', null, '{"em": 200, "uo": 0.4, "ugr": 22, "ra": 80}'::jsonb, null, 35),
  ('indoor', 'Hotels and restaurants', 'Buffet', null, '{"em": 300, "uo": 0.6, "ugr": 22, "ra": 80}'::jsonb, null, 36),
  ('indoor', 'Hotels and restaurants', 'Conference rooms', null, '{"em": 500, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, 'Lighting should be controllable', 37),
  ('indoor', 'Hotels and restaurants', 'Corridors', null, '{"em": 100, "uo": 0.4, "ugr": 25, "ra": 80}'::jsonb, 'Lower levels acceptable at night', 38),
  ('indoor', 'Industry and warehouses', 'Store and stockrooms', null, '{"em": 100, "uo": 0.4, "ugr": 25, "ra": 60}'::jsonb, '200 lx if continuously occupied', 39),
  ('indoor', 'Industry and warehouses', 'Dispatch packing handling areas', null, '{"em": 300, "uo": 0.6, "ugr": 25, "ra": 60}'::jsonb, null, 40),
  ('indoor', 'Industry and warehouses', 'Rough assembly', null, '{"em": 200, "uo": 0.6, "ugr": 25, "ra": 80}'::jsonb, null, 41),
  ('indoor', 'Industry and warehouses', 'Medium assembly', null, '{"em": 300, "uo": 0.6, "ugr": 25, "ra": 80}'::jsonb, null, 42),
  ('indoor', 'Industry and warehouses', 'Fine assembly', null, '{"em": 500, "uo": 0.6, "ugr": 22, "ra": 80}'::jsonb, null, 43),
  ('indoor', 'Industry and warehouses', 'Electrical and electronics – fine work', null, '{"em": 1000, "uo": 0.7, "ugr": 19, "ra": 80}'::jsonb, null, 44),
  ('indoor', 'Industry and warehouses', 'Control rooms', null, '{"em": 500, "uo": 0.6, "ugr": 16, "ra": 80}'::jsonb, null, 45),
  ('indoor', 'Industry and warehouses', 'Workshops – general', null, '{"em": 300, "uo": 0.6, "ugr": 22, "ra": 80}'::jsonb, null, 46),
  ('indoor', 'Circulation and common areas', 'Corridors and circulation areas', null, '{"em": 100, "uo": 0.4, "ugr": 28, "ra": 40}'::jsonb, 'Illuminance at floor level; 150 lx if vehicles use them', 47),
  ('indoor', 'Circulation and common areas', 'Stairs, escalators, travelators', null, '{"em": 100, "uo": 0.4, "ugr": 25, "ra": 40}'::jsonb, 'Contrast on steps required', 48),
  ('indoor', 'Circulation and common areas', 'Lifts', null, '{"em": 100, "uo": 0.4, "ugr": 25, "ra": 40}'::jsonb, null, 49),
  ('indoor', 'Circulation and common areas', 'Toilets, washrooms, bathrooms', null, '{"em": 200, "uo": 0.4, "ugr": 25, "ra": 80}'::jsonb, null, 50),
  ('indoor', 'Circulation and common areas', 'Canteens, pantries', null, '{"em": 200, "uo": 0.4, "ugr": 22, "ra": 80}'::jsonb, null, 51),
  ('indoor', 'Circulation and common areas', 'Rest rooms', null, '{"em": 100, "uo": 0.4, "ugr": 22, "ra": 80}'::jsonb, null, 52),
  ('indoor', 'Circulation and common areas', 'Plant rooms, switch gear rooms', null, '{"em": 200, "uo": 0.4, "ugr": 25, "ra": 60}'::jsonb, null, 53),
  ('indoor', 'Car parks (indoor)', 'Traffic lanes', null, '{"em": 75, "uo": 0.4, "ugr": 25, "ra": 40}'::jsonb, 'Illuminance at floor level', 54),
  ('indoor', 'Car parks (indoor)', 'Parking areas', null, '{"em": 75, "uo": 0.4, "ugr": 25, "ra": 40}'::jsonb, null, 55),
  ('indoor', 'Car parks (indoor)', 'In and out ramps – during the day', null, '{"em": 300, "uo": 0.4, "ugr": 25, "ra": 40}'::jsonb, null, 56),
  ('indoor', 'Car parks (indoor)', 'In and out ramps – at night', null, '{"em": 75, "uo": 0.4, "ugr": 25, "ra": 40}'::jsonb, null, 57),
  ('indoor', 'Car parks (indoor)', 'Ticket office', null, '{"em": 300, "uo": 0.6, "ugr": 19, "ra": 80}'::jsonb, null, 58),
  ('outdoor', 'Parking areas', 'Light traffic (e.g. shops, terraced houses)', null, '{"em": 5, "uo": 0.25, "gr": 55, "ra": 20}'::jsonb, null, 59),
  ('outdoor', 'Parking areas', 'Medium traffic (e.g. department stores, office buildings, sports halls)', null, '{"em": 10, "uo": 0.25, "gr": 50, "ra": 20}'::jsonb, null, 60),
  ('outdoor', 'Parking areas', 'Heavy traffic (e.g. large shopping centres, sports and multipurpose venues)', null, '{"em": 20, "uo": 0.25, "gr": 50, "ra": 20}'::jsonb, null, 61),
  ('outdoor', 'Petrol stations', 'Vehicle parking and storage areas', null, '{"em": 5, "uo": 0.25, "gr": 50, "ra": 20}'::jsonb, null, 62),
  ('outdoor', 'Petrol stations', 'Entry and exit driveways', null, '{"em": 20, "uo": 0.4, "gr": 45, "ra": 20}'::jsonb, null, 63),
  ('outdoor', 'Petrol stations', 'Pump islands', null, '{"em": 150, "uo": 0.4, "gr": 45, "ra": 20}'::jsonb, null, 64),
  ('outdoor', 'Industrial sites and storage areas', 'Short term handling of large units and raw materials', null, '{"em": 20, "uo": 0.25, "gr": 55, "ra": 20}'::jsonb, null, 65),
  ('outdoor', 'Industrial sites and storage areas', 'Continuous handling of large units and raw materials', null, '{"em": 50, "uo": 0.4, "gr": 50, "ra": 20}'::jsonb, null, 66),
  ('outdoor', 'Industrial sites and storage areas', 'Reading of addresses, loading and unloading', null, '{"em": 100, "uo": 0.4, "gr": 45, "ra": 20}'::jsonb, null, 67),
  ('outdoor', 'Ports and docks', 'General areas (traffic zones)', null, '{"em": 20, "uo": 0.25, "gr": 55, "ra": 20}'::jsonb, null, 68),
  ('outdoor', 'Ports and docks', 'Loading and unloading of goods', null, '{"em": 50, "uo": 0.4, "gr": 50, "ra": 20}'::jsonb, null, 69),
  ('outdoor', 'Building sites', 'Clearance, excavation and loading', null, '{"em": 20, "uo": 0.25, "gr": 55, "ra": 20}'::jsonb, null, 70),
  ('outdoor', 'Building sites', 'Construction areas, drain pipes mounting, transport', null, '{"em": 50, "uo": 0.4, "gr": 50, "ra": 20}'::jsonb, null, 71),
  ('outdoor', 'Building sites', 'Framework element mounting, light reinforcement work', null, '{"em": 100, "uo": 0.4, "gr": 45, "ra": 40}'::jsonb, null, 72),
  ('outdoor', 'Walkways', 'Walkways exclusively for pedestrians', null, '{"em": 5, "uo": 0.25, "gr": 50, "ra": 20}'::jsonb, null, 73),
  ('road', 'M classes – motorised traffic (luminance)', 'M1 – roads for motorised traffic', null, '{"cls": "M1", "measure": "L cd/m\u00b2", "val": 2.0, "uo": 0.4, "ul": 0.7, "ti": 10, "rei": 0.35, "emin": null}'::jsonb, 'Average road surface luminance (dry). Class chosen from speed, traffic volume and layout (EN 13201-1)', 74),
  ('road', 'M classes – motorised traffic (luminance)', 'M2 – roads for motorised traffic', null, '{"cls": "M2", "measure": "L cd/m\u00b2", "val": 1.5, "uo": 0.4, "ul": 0.7, "ti": 10, "rei": 0.35, "emin": null}'::jsonb, 'Average road surface luminance (dry). Class chosen from speed, traffic volume and layout (EN 13201-1)', 75),
  ('road', 'M classes – motorised traffic (luminance)', 'M3 – roads for motorised traffic', null, '{"cls": "M3", "measure": "L cd/m\u00b2", "val": 1.0, "uo": 0.4, "ul": 0.6, "ti": 15, "rei": 0.3, "emin": null}'::jsonb, 'Average road surface luminance (dry). Class chosen from speed, traffic volume and layout (EN 13201-1)', 76),
  ('road', 'M classes – motorised traffic (luminance)', 'M4 – roads for motorised traffic', null, '{"cls": "M4", "measure": "L cd/m\u00b2", "val": 0.75, "uo": 0.4, "ul": 0.6, "ti": 15, "rei": 0.3, "emin": null}'::jsonb, 'Average road surface luminance (dry). Class chosen from speed, traffic volume and layout (EN 13201-1)', 77),
  ('road', 'M classes – motorised traffic (luminance)', 'M5 – roads for motorised traffic', null, '{"cls": "M5", "measure": "L cd/m\u00b2", "val": 0.5, "uo": 0.35, "ul": 0.4, "ti": 15, "rei": 0.3, "emin": null}'::jsonb, 'Average road surface luminance (dry). Class chosen from speed, traffic volume and layout (EN 13201-1)', 78),
  ('road', 'M classes – motorised traffic (luminance)', 'M6 – roads for motorised traffic', null, '{"cls": "M6", "measure": "L cd/m\u00b2", "val": 0.3, "uo": 0.35, "ul": 0.4, "ti": 20, "rei": 0.3, "emin": null}'::jsonb, 'Average road surface luminance (dry). Class chosen from speed, traffic volume and layout (EN 13201-1)', 79),
  ('road', 'C classes – conflict areas (illuminance)', 'C0 – junctions, roundabouts, conflict areas', null, '{"cls": "C0", "measure": "E lx", "val": 50, "uo": 0.4, "ul": null, "ti": null, "rei": null, "emin": null}'::jsonb, 'Average horizontal illuminance on the conflict area', 80),
  ('road', 'C classes – conflict areas (illuminance)', 'C1 – junctions, roundabouts, conflict areas', null, '{"cls": "C1", "measure": "E lx", "val": 30, "uo": 0.4, "ul": null, "ti": null, "rei": null, "emin": null}'::jsonb, 'Average horizontal illuminance on the conflict area', 81),
  ('road', 'C classes – conflict areas (illuminance)', 'C2 – junctions, roundabouts, conflict areas', null, '{"cls": "C2", "measure": "E lx", "val": 20, "uo": 0.4, "ul": null, "ti": null, "rei": null, "emin": null}'::jsonb, 'Average horizontal illuminance on the conflict area', 82),
  ('road', 'C classes – conflict areas (illuminance)', 'C3 – junctions, roundabouts, conflict areas', null, '{"cls": "C3", "measure": "E lx", "val": 15, "uo": 0.4, "ul": null, "ti": null, "rei": null, "emin": null}'::jsonb, 'Average horizontal illuminance on the conflict area', 83),
  ('road', 'C classes – conflict areas (illuminance)', 'C4 – junctions, roundabouts, conflict areas', null, '{"cls": "C4", "measure": "E lx", "val": 10, "uo": 0.4, "ul": null, "ti": null, "rei": null, "emin": null}'::jsonb, 'Average horizontal illuminance on the conflict area', 84),
  ('road', 'C classes – conflict areas (illuminance)', 'C5 – junctions, roundabouts, conflict areas', null, '{"cls": "C5", "measure": "E lx", "val": 7.5, "uo": 0.4, "ul": null, "ti": null, "rei": null, "emin": null}'::jsonb, 'Average horizontal illuminance on the conflict area', 85),
  ('road', 'P classes – pedestrians and low speed (illuminance)', 'P1 – footways, cycle tracks, residential streets', null, '{"cls": "P1", "measure": "E lx", "val": 15, "uo": null, "ul": null, "ti": null, "rei": null, "emin": 3.0}'::jsonb, 'Average and minimum maintained horizontal illuminance', 86),
  ('road', 'P classes – pedestrians and low speed (illuminance)', 'P2 – footways, cycle tracks, residential streets', null, '{"cls": "P2", "measure": "E lx", "val": 10, "uo": null, "ul": null, "ti": null, "rei": null, "emin": 2.0}'::jsonb, 'Average and minimum maintained horizontal illuminance', 87),
  ('road', 'P classes – pedestrians and low speed (illuminance)', 'P3 – footways, cycle tracks, residential streets', null, '{"cls": "P3", "measure": "E lx", "val": 7.5, "uo": null, "ul": null, "ti": null, "rei": null, "emin": 1.5}'::jsonb, 'Average and minimum maintained horizontal illuminance', 88),
  ('road', 'P classes – pedestrians and low speed (illuminance)', 'P4 – footways, cycle tracks, residential streets', null, '{"cls": "P4", "measure": "E lx", "val": 5.0, "uo": null, "ul": null, "ti": null, "rei": null, "emin": 1.0}'::jsonb, 'Average and minimum maintained horizontal illuminance', 89),
  ('road', 'P classes – pedestrians and low speed (illuminance)', 'P5 – footways, cycle tracks, residential streets', null, '{"cls": "P5", "measure": "E lx", "val": 3.0, "uo": null, "ul": null, "ti": null, "rei": null, "emin": 0.6}'::jsonb, 'Average and minimum maintained horizontal illuminance', 90),
  ('road', 'P classes – pedestrians and low speed (illuminance)', 'P6 – footways, cycle tracks, residential streets', null, '{"cls": "P6", "measure": "E lx", "val": 2.0, "uo": null, "ul": null, "ti": null, "rei": null, "emin": 0.4}'::jsonb, 'Average and minimum maintained horizontal illuminance', 91),
  ('sports', 'Football (outdoor)', 'Football (outdoor) – Class I', null, '{"cls": "I", "em": 500, "uo": 0.7, "ra": 60}'::jsonb, 'Class I: international / national competition; II: regional, club; III: training, recreation. TV broadcast needs vertical levels set by the broadcaster', 92),
  ('sports', 'Football (outdoor)', 'Football (outdoor) – Class II', null, '{"cls": "II", "em": 200, "uo": 0.6, "ra": 60}'::jsonb, 'Class I: international / national competition; II: regional, club; III: training, recreation. TV broadcast needs vertical levels set by the broadcaster', 93),
  ('sports', 'Football (outdoor)', 'Football (outdoor) – Class III', null, '{"cls": "III", "em": 75, "uo": 0.5, "ra": 20}'::jsonb, 'Class I: international / national competition; II: regional, club; III: training, recreation. TV broadcast needs vertical levels set by the broadcaster', 94),
  ('sports', 'Tennis (outdoor)', 'Tennis (outdoor) – Class I', null, '{"cls": "I", "em": 500, "uo": 0.7, "ra": 60}'::jsonb, null, 95),
  ('sports', 'Tennis (outdoor)', 'Tennis (outdoor) – Class II', null, '{"cls": "II", "em": 300, "uo": 0.7, "ra": 60}'::jsonb, null, 96),
  ('sports', 'Tennis (outdoor)', 'Tennis (outdoor) – Class III', null, '{"cls": "III", "em": 200, "uo": 0.6, "ra": 20}'::jsonb, null, 97),
  ('sports', 'Multi-sport hall (basketball, volleyball, netball)', 'Multi-sport hall (basketball, volleyball, netball) – Class I', null, '{"cls": "I", "em": 750, "uo": 0.7, "ra": 60}'::jsonb, null, 98),
  ('sports', 'Multi-sport hall (basketball, volleyball, netball)', 'Multi-sport hall (basketball, volleyball, netball) – Class II', null, '{"cls": "II", "em": 500, "uo": 0.7, "ra": 60}'::jsonb, null, 99),
  ('sports', 'Multi-sport hall (basketball, volleyball, netball)', 'Multi-sport hall (basketball, volleyball, netball) – Class III', null, '{"cls": "III", "em": 200, "uo": 0.5, "ra": 20}'::jsonb, null, 100),
  ('sports', 'Badminton (indoor)', 'Badminton (indoor) – Class I', null, '{"cls": "I", "em": 750, "uo": 0.7, "ra": 60}'::jsonb, null, 101),
  ('sports', 'Badminton (indoor)', 'Badminton (indoor) – Class II', null, '{"cls": "II", "em": 500, "uo": 0.7, "ra": 60}'::jsonb, null, 102),
  ('sports', 'Badminton (indoor)', 'Badminton (indoor) – Class III', null, '{"cls": "III", "em": 300, "uo": 0.7, "ra": 20}'::jsonb, null, 103),
  ('sports', 'Swimming pool (indoor)', 'Swimming pool (indoor) – Class I', null, '{"cls": "I", "em": 500, "uo": 0.7, "ra": 60}'::jsonb, null, 104),
  ('sports', 'Swimming pool (indoor)', 'Swimming pool (indoor) – Class II', null, '{"cls": "II", "em": 300, "uo": 0.7, "ra": 60}'::jsonb, null, 105),
  ('sports', 'Swimming pool (indoor)', 'Swimming pool (indoor) – Class III', null, '{"cls": "III", "em": 200, "uo": 0.5, "ra": 20}'::jsonb, null, 106),
  ('emergency', 'Escape lighting', 'Escape routes (up to 2 m wide)', null, '{"em": 1, "ratio": "40 : 1", "dur": "1 h minimum (3 h typical in BS 5266 premises)", "resp": "50% in 5 s, 100% in 60 s"}'::jsonb, 'Minimum illuminance on the centre line at floor level; central band at least half the route width ≥ 50% of that', 107),
  ('emergency', 'Escape lighting', 'Open areas / anti-panic (larger than 60 m²)', null, '{"em": 0.5, "ratio": "40 : 1", "dur": "1 h minimum (3 h typical)", "resp": "50% in 5 s, 100% in 60 s"}'::jsonb, 'Excluding a 0.5 m border at the walls', 108),
  ('emergency', 'Escape lighting', 'High risk task areas', null, '{"em": null, "ratio": "10 : 1", "dur": "As long as the risk exists", "resp": "0.5 s"}'::jsonb, 'At least 10% of the normal maintained illuminance and not less than 15 lx', 109),
  ('emergency', 'Escape lighting', 'Safety equipment, fire fighting points, first aid points', null, '{"em": 5, "ratio": null, "dur": "As escape routes", "resp": "As escape routes"}'::jsonb, 'Vertical illuminance at the equipment', 110),
  ('emergency', 'Standby lighting', 'Areas that must keep working on mains failure', null, '{"em": null, "ratio": null, "dur": "As required", "resp": "As required"}'::jsonb, 'Level set by the activity; often the normal level or a stated share of it', 111),
  ('energy', 'Building area method', 'Office buildings', null, '{"lpd": null}'::jsonb, 'Maximum lighting power density from the SLSEA Code for Energy Efficient Buildings – value to be entered by the Design Manager', 112),
  ('energy', 'Building area method', 'Hotels', null, '{"lpd": null}'::jsonb, 'Maximum lighting power density from the SLSEA Code for Energy Efficient Buildings – value to be entered by the Design Manager', 113),
  ('energy', 'Building area method', 'Hospitals and health care', null, '{"lpd": null}'::jsonb, 'Maximum lighting power density from the SLSEA Code for Energy Efficient Buildings – value to be entered by the Design Manager', 114),
  ('energy', 'Building area method', 'Retail and shopping', null, '{"lpd": null}'::jsonb, 'Maximum lighting power density from the SLSEA Code for Energy Efficient Buildings – value to be entered by the Design Manager', 115),
  ('energy', 'Building area method', 'Educational buildings', null, '{"lpd": null}'::jsonb, 'Maximum lighting power density from the SLSEA Code for Energy Efficient Buildings – value to be entered by the Design Manager', 116),
  ('energy', 'Building area method', 'Warehouses', null, '{"lpd": null}'::jsonb, 'Maximum lighting power density from the SLSEA Code for Energy Efficient Buildings – value to be entered by the Design Manager', 117),
  ('energy', 'Building area method', 'Industrial buildings', null, '{"lpd": null}'::jsonb, 'Maximum lighting power density from the SLSEA Code for Energy Efficient Buildings – value to be entered by the Design Manager', 118),
  ('energy', 'Building area method', 'Car parks', null, '{"lpd": null}'::jsonb, 'Maximum lighting power density from the SLSEA Code for Energy Efficient Buildings – value to be entered by the Design Manager', 119)
) v(grp, category, space, ref, vals, notes, sort)
where not exists (select 1 from public.lighting_standards);
