-- Materials catalogue for material requests (lighting, electrical, infrastructure and airport projects): ~13,000 items generated
-- from product families x specifications, tagged with the project areas they suit. Search by words (all must match), project
-- areas first. Items not in the catalogue are entered as custom lines (ticked). Requests get priority, programme activity,
-- delivery point and per-line specification / preferred make / estimated rate.
create table public.material_catalog (
  id serial primary key,
  code text unique,
  category text not null,
  subcategory text not null,
  name text not null,
  unit text not null,
  areas text[] not null default '{}',
  active boolean not null default true,
  search text generated always as (lower(coalesce(code, '') || ' ' || category || ' ' || subcategory || ' ' || name)) stored
);
create index on public.material_catalog (category, subcategory);
alter table public.material_catalog enable row level security;
create policy material_catalog_read on public.material_catalog for select to authenticated using (true);
grant select on public.material_catalog to authenticated;

insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Indoor luminaires', 'LED panel', format('LED panel light %s mm, %sW, %s, %s', d0, d1, d2, d3), 'nos', '{indoor}'::text[]
from unnest(array['300x300', '600x600', '300x1200', '600x1200']::text[]) d0 cross join unnest(array['18', '24', '36', '40', '48', '60']::text[]) d1 cross join unnest(array['3000K', '4000K', '5700K']::text[]) d2 cross join unnest(array['non-dimmable', 'DALI dimmable', '0-10V dimmable', 'emergency 3 h']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Indoor luminaires', 'Downlight', format('LED downlight %s mm cut-out, %sW, %s, %s, %s', d0, d1, d2, d3, d4), 'nos', '{indoor}'::text[]
from unnest(array['75', '90', '100', '125', '150', '200', '225']::text[]) d0 cross join unnest(array['5', '7', '9', '12', '15', '18', '24', '30', '40']::text[]) d1 cross join unnest(array['2700K', '3000K', '4000K', '6500K']::text[]) d2 cross join unnest(array['IP20', 'IP44', 'IP65']::text[]) d3 cross join unnest(array['white', 'black']::text[]) d4;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Indoor luminaires', 'Spot / track light', format('LED track spotlight %sW, %s beam, %s, %s, %s track', d0, d1, d2, d3, d4), 'nos', '{indoor,facade}'::text[]
from unnest(array['10', '15', '20', '25', '30', '35', '40']::text[]) d0 cross join unnest(array['15°', '24°', '36°', '60°']::text[]) d1 cross join unnest(array['3000K', '4000K', '5700K']::text[]) d2 cross join unnest(array['white', 'black']::text[]) d3 cross join unnest(array['3-circuit', '1-circuit', 'DALI']::text[]) d4;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Indoor luminaires', 'Linear batten', format('LED batten %s mm, %sW, %s, %s', d0, d1, d2, d3), 'nos', '{indoor,electrical}'::text[]
from unnest(array['600', '1200', '1500']::text[]) d0 cross join unnest(array['9', '18', '24', '36', '40', '50', '60']::text[]) d1 cross join unnest(array['3000K', '4000K', '5700K']::text[]) d2 cross join unnest(array['IP20', 'IP65 vapour-tight', 'emergency 3 h']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Indoor luminaires', 'LED tube', format('LED tube T8 %s mm, %sW, %s, %s', d0, d1, d2, d3), 'nos', '{indoor}'::text[]
from unnest(array['600', '1200', '1500']::text[]) d0 cross join unnest(array['9', '18', '22', '24']::text[]) d1 cross join unnest(array['3000K', '4000K', '5700K']::text[]) d2 cross join unnest(array['single-end feed', 'double-end feed']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Indoor luminaires', 'High bay', format('LED high bay %s %sW, %s optic, %s, %s', d0, d1, d2, d3, d4), 'nos', '{indoor,port}'::text[]
from unnest(array['UFO', 'linear']::text[]) d0 cross join unnest(array['100', '150', '200', '240', '300']::text[]) d1 cross join unnest(array['60°', '90°', '120°']::text[]) d2 cross join unnest(array['4000K', '5000K', '5700K']::text[]) d3 cross join unnest(array['non-dimmable', '1-10V dimmable']::text[]) d4;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Indoor luminaires', 'Linear suspended / trunking', format('LED linear %s, %s m, %sW, %s, %s', d0, d1, d2, d3, d4), 'nos', '{indoor}'::text[]
from unnest(array['suspended', 'surface', 'recessed', 'trunking insert']::text[]) d0 cross join unnest(array['1.2', '1.5', '2.4', '3.0']::text[]) d1 cross join unnest(array['30', '40', '60']::text[]) d2 cross join unnest(array['3000K', '4000K', '5700K']::text[]) d3 cross join unnest(array['opal diffuser', 'micro-prismatic UGR<19']::text[]) d4;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Indoor luminaires', 'LED strip', format('LED strip %sW/m, %s, %s, %s, 5 m reel', d0, d1, d2, d3), 'reel', '{indoor,facade}'::text[]
from unnest(array['4.8', '9.6', '14.4', '19.2']::text[]) d0 cross join unnest(array['12V', '24V']::text[]) d1 cross join unnest(array['2700K', '3000K', '4000K', '6500K', 'RGB', 'RGBW']::text[]) d2 cross join unnest(array['IP20', 'IP65', 'IP67']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Indoor luminaires', 'LED profile', format('Aluminium LED profile %s, %s m, %s diffuser, with end caps and clips', d0, d1, d2), 'nos', '{indoor,facade}'::text[]
from unnest(array['surface', 'recessed', 'corner', 'suspended', 'plaster-in']::text[]) d0 cross join unnest(array['1', '2', '3']::text[]) d1 cross join unnest(array['opal', 'clear', 'frosted']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Indoor luminaires', 'Wall / step light', format('LED %s %sW, %s, %s', d0, d1, d2, d3), 'nos', '{indoor,outdoor,facade}'::text[]
from unnest(array['wall light up/down', 'step light recessed', 'bulkhead round', 'bulkhead oval', 'mirror light']::text[]) d0 cross join unnest(array['3', '6', '10', '12', '18']::text[]) d1 cross join unnest(array['3000K', '4000K']::text[]) d2 cross join unnest(array['IP44', 'IP65']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Emergency lighting', 'Exit sign', format('Exit sign %s, %s, %s, %s', d0, d1, d2, d3), 'nos', '{emergency,indoor}'::text[]
from unnest(array['maintained', 'non-maintained']::text[]) d0 cross join unnest(array['EXIT', 'arrow left', 'arrow right', 'arrow down', 'running man']::text[]) d1 cross join unnest(array['1 h battery', '3 h battery', 'central battery']::text[]) d2 cross join unnest(array['ceiling', 'wall', 'recessed', 'blade suspended']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Emergency lighting', 'Emergency luminaire', format('Emergency %s, %s, %s, %s', d0, d1, d2, d3), 'nos', '{emergency,indoor}'::text[]
from unnest(array['downlight escape route', 'downlight open area', 'bulkhead', 'twin spot', 'high bay emergency']::text[]) d0 cross join unnest(array['3W', '5W', '10W']::text[]) d1 cross join unnest(array['1 h', '3 h']::text[]) d2 cross join unnest(array['self-test', 'addressable DALI', 'central battery 24V DC']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Emergency lighting', 'Emergency conversion kit', format('Emergency conversion kit %s, %s output, %s, %s battery', d0, d1, d2, d3), 'nos', '{emergency}'::text[]
from unnest(array['LED module', 'LED driver']::text[]) d0 cross join unnest(array['3W', '5W', '10W', '15W']::text[]) d1 cross join unnest(array['1 h', '3 h']::text[]) d2 cross join unnest(array['NiCd', 'LiFePO4']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Central battery systems', 'Central battery unit', format('Central battery system %s, %s, %s circuits, %s', d0, d1, d2, d3), 'set', '{central_battery,emergency}'::text[]
from unnest(array['1 kW', '2 kW', '3 kW', '5 kW', '8 kW']::text[]) d0 cross join unnest(array['1 h', '3 h']::text[]) d1 cross join unnest(array['4', '8', '16', '24']::text[]) d2 cross join unnest(array['220V DC', '24V DC']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Central battery systems', 'Sub-station / circuit module', format('Central battery %s, %s', d0, d1), 'nos', '{central_battery}'::text[]
from unnest(array['sub-station', 'circuit module', 'monitoring module', 'changeover module']::text[]) d0 cross join unnest(array['4 circuits', '8 circuits', '16 circuits']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Road lighting', 'Street light', format('LED street light %sW, %s optic, %s, %s, %s', d0, d1, d2, d3, d4), 'nos', '{road,outdoor,port}'::text[]
from unnest(array['20', '30', '40', '50', '60', '70', '80', '90', '100', '120', '150', '180', '200', '240']::text[]) d0 cross join unnest(array['Type II', 'Type III', 'Type IV', 'Type V']::text[]) d1 cross join unnest(array['3000K', '4000K', '5700K']::text[]) d2 cross join unnest(array['NEMA 7-pin', 'Zhaga D4i', 'no socket']::text[]) d3 cross join unnest(array['side-entry 60 mm', 'post-top 76 mm']::text[]) d4;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Road lighting', 'Street light pole', format('Galvanised %s pole %s m, %s, %s', d0, d1, d2, d3), 'nos', '{road,outdoor,port}'::text[]
from unnest(array['octagonal', 'conical', 'stepped tubular']::text[]) d0 cross join unnest(array['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '14', '16']::text[]) d1 cross join unnest(array['no bracket', 'single arm 1.5 m', 'single arm 2.5 m', 'double arm 1.5 m']::text[]) d2 cross join unnest(array['base plate', 'planted (root)']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Road lighting', 'Pole accessory', format('%s for %s m pole', d0, d1), 'nos', '{road,outdoor}'::text[]
from unnest(array['foundation bolt cage', 'cable junction box with fuse', 'door gasket and lock', 'base cover', 'pole cap']::text[]) d0 cross join unnest(array['4', '6', '8', '10', '12', '14', '16']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Floodlighting', 'Floodlight', format('LED floodlight %sW, %s beam, %s, IP66, %s', d0, d1, d2, d3), 'nos', '{outdoor,facade,port,sports}'::text[]
from unnest(array['30', '50', '100', '150', '200', '300', '400', '500', '600', '800', '1000', '1200', '1500']::text[]) d0 cross join unnest(array['10°', '15°', '25°', '40°', '60°', '90°', 'asymmetric']::text[]) d1 cross join unnest(array['3000K', '4000K', '5000K', '5700K']::text[]) d2 cross join unnest(array['grey', 'black']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Sports lighting', 'Sports floodlight', format('LED sports floodlight %sW, %s beam, %s, %s, %s', d0, d1, d2, d3, d4), 'nos', '{sports,port,apron}'::text[]
from unnest(array['400', '600', '800', '1000', '1200', '1500', '2000']::text[]) d0 cross join unnest(array['8°', '12°', '15°', '25°', '40°', '60°']::text[]) d1 cross join unnest(array['5000K', '5700K']::text[]) d2 cross join unnest(array['standard', 'TV broadcast flicker-free']::text[]) d3 cross join unnest(array['DMX control', 'DALI control', 'no control']::text[]) d4;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Sports lighting', 'High mast', format('High mast %s m, %s, %s luminaires, %s', d0, d1, d2, d3), 'set', '{sports,port,road,apron}'::text[]
from unnest(array['16', '18', '20', '25', '30', '35', '40']::text[]) d0 cross join unnest(array['raising/lowering ring', 'fixed head with platform']::text[]) d1 cross join unnest(array['4', '6', '8', '10', '12']::text[]) d2 cross join unnest(array['motor drive', 'manual winch']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Outdoor luminaires', 'Bollard / garden', format('LED %s %s, %sW, %s, IP65', d0, d1, d2, d3), 'nos', '{outdoor,facade}'::text[]
from unnest(array['bollard', 'garden spike', 'post-top lantern', 'pathway light']::text[]) d0 cross join unnest(array['600 mm', '800 mm', '1000 mm', 'short']::text[]) d1 cross join unnest(array['5', '7', '10', '15', '20']::text[]) d2 cross join unnest(array['3000K', '4000K']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Outdoor luminaires', 'In-ground uplight', format('LED in-ground uplight %sW, %s beam, %s, IP67, %s', d0, d1, d2, d3), 'nos', '{outdoor,facade}'::text[]
from unnest(array['3', '6', '9', '12', '18', '24', '36']::text[]) d0 cross join unnest(array['10°', '25°', '40°', 'asymmetric']::text[]) d1 cross join unnest(array['3000K', '4000K', 'RGBW DMX']::text[]) d2 cross join unnest(array['drive-over', 'walk-over']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Tunnel lighting', 'Tunnel luminaire', format('LED tunnel luminaire %sW, %s, %s, %s', d0, d1, d2, d3), 'nos', '{tunnel}'::text[]
from unnest(array['40', '60', '80', '100', '150', '200', '250', '300']::text[]) d0 cross join unnest(array['counter-beam', 'symmetric', 'pro-beam']::text[]) d1 cross join unnest(array['4000K', '5000K', '5700K']::text[]) d2 cross join unnest(array['DALI dimmable', '1-10V dimmable']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Facade lighting', 'Wall washer', format('LED wall washer %s mm, %sW, %s beam, %s', d0, d1, d2, d3), 'nos', '{facade}'::text[]
from unnest(array['300', '600', '900', '1200']::text[]) d0 cross join unnest(array['12', '18', '24', '36', '48']::text[]) d1 cross join unnest(array['10x60°', '30x60°', '45°']::text[]) d2 cross join unnest(array['3000K', '4000K', 'RGB DMX', 'RGBW DMX', 'tunable white DALI']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Facade lighting', 'Linear grazer / pixel', format('LED %s %s, %s, %s', d0, d1, d2, d3), 'nos', '{facade}'::text[]
from unnest(array['linear grazer 1 m', 'linear grazer 0.5 m', 'pixel dot 40 mm', 'pixel dot 60 mm', 'media tube 1 m']::text[]) d0 cross join unnest(array['IP66', 'IP67']::text[]) d1 cross join unnest(array['3000K', '4000K', 'RGB', 'RGBW']::text[]) d2 cross join unnest(array['DMX512', 'SPI', 'DALI']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Airport systems (AGL)', 'Edge light', format('%s %s light, %s, %s', d0, d1, d2, d3), 'nos', '{agl,smgcs}'::text[]
from unnest(array['runway edge', 'taxiway edge', 'runway threshold/end', 'runway end']::text[]) d0 cross join unnest(array['elevated', 'inset']::text[]) d1 cross join unnest(array['white/white', 'white/yellow', 'red/green', 'blue', 'yellow', 'green']::text[]) d2 cross join unnest(array['LED', 'halogen']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Airport systems (AGL)', 'Inset light', format('Inset %s light, %s, %s, %s', d0, d1, d2, d3), 'nos', '{agl,smgcs}'::text[]
from unnest(array['runway centreline', 'touchdown zone', 'taxiway centreline', 'stop bar', 'rapid exit taxiway']::text[]) d0 cross join unnest(array['8 inch', '12 inch']::text[]) d1 cross join unnest(array['white', 'green', 'yellow', 'red', 'green/yellow alternating']::text[]) d2 cross join unnest(array['LED', 'halogen']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Airport systems (AGL)', 'Approach / PAPI', format('%s, %s', d0, d1), 'nos', '{agl}'::text[]
from unnest(array['PAPI unit', 'approach crossbar light', 'sequenced flashing light', 'runway end identifier light', 'obstruction light low intensity', 'obstruction light medium intensity']::text[]) d0 cross join unnest(array['LED', 'halogen']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Airport systems (AGL)', 'Guidance sign', format('Taxiway guidance sign size %s, %s, %s modules, %s', d0, d1, d2, d3), 'nos', '{agl,smgcs}'::text[]
from unnest(array['1', '2', '3', '4', '5']::text[]) d0 cross join unnest(array['mandatory', 'location', 'direction', 'information']::text[]) d1 cross join unnest(array['1', '2', '3', '4']::text[]) d2 cross join unnest(array['LED', 'fluorescent']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Airport systems (AGL)', 'Constant current regulator', format('Constant current regulator %s kVA, %s steps, %s', d0, d1, d2), 'nos', '{agl,alcms}'::text[]
from unnest(array['2.5', '4', '5', '7.5', '10', '15', '20', '25', '30']::text[]) d0 cross join unnest(array['3', '5']::text[]) d1 cross join unnest(array['with remote control (ALCMS)', 'local control']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Airport systems (AGL)', 'Isolating transformer / connector', format('%s %s', d0, d1), 'nos', '{agl}'::text[]
from unnest(array['isolating transformer', 'secondary connector kit', 'primary connector kit']::text[]) d0 cross join unnest(array['45W', '65W', '100W', '150W', '200W', '300W']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Airport systems (AGL)', 'Primary cable', format('Series circuit cable %s kV, %s mm², %s', d0, d1, d2), 'm', '{agl}'::text[]
from unnest(array['5', '6']::text[]) d0 cross join unnest(array['6', '10', '16']::text[]) d1 cross join unnest(array['single-core shielded', 'unshielded']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Airport systems', 'VDGS / ALCMS equipment', format('%s, %s', d0, d1), 'set', '{vdgs,alcms,smgcs,apron}'::text[]
from unnest(array['VDGS display unit', 'VDGS laser scanner', 'operator panel', 'ALCMS PLC cabinet', 'ALCMS workstation', 'ALCMS individual lamp control module', 'SMGCS sensor', 'apron floodlight controller']::text[]) d0 cross join unnest(array['standard', 'with redundancy']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cables', 'LV power cable', format('%s %s-core %s mm² %s cable, 0.6/1 kV', d0, d1, d2, d3), 'm', '{electrical,underground_cabling,road}'::text[]
from unnest(array['Cu', 'Al']::text[]) d0 cross join unnest(array['1', '2', '3', '3.5', '4']::text[]) d1 cross join unnest(array['1.5', '2.5', '4', '6', '10', '16', '25', '35', '50', '70', '95', '120', '150', '185', '240', '300']::text[]) d2 cross join unnest(array['PVC/PVC', 'XLPE/PVC', 'XLPE/SWA/PVC', 'XLPE/STA/PVC', 'LSZH', 'fire resistant FR']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cables', 'Building wire', format('Building wire %s mm² Cu, 450/750 V, %s, %s, 100 m coil', d0, d1, d2), 'coil', '{electrical}'::text[]
from unnest(array['1.0', '1.5', '2.5', '4', '6', '10', '16', '25', '35', '50', '70', '95', '120']::text[]) d0 cross join unnest(array['red', 'yellow', 'blue', 'black', 'green/yellow', 'grey']::text[]) d1 cross join unnest(array['PVC', 'LSZH']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cables', 'Flexible cord', format('Flexible cord %s-core %s mm², %s', d0, d1, d2), 'm', '{electrical,indoor}'::text[]
from unnest(array['2', '3', '4', '5']::text[]) d0 cross join unnest(array['0.75', '1.0', '1.5', '2.5', '4']::text[]) d1 cross join unnest(array['PVC', 'rubber H07RN-F', 'silicone heat-resistant']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cables', 'MV cable', format('%s kV %s-core %s mm² %s XLPE cable', d0, d1, d2, d3), 'm', '{electrical,underground_cabling}'::text[]
from unnest(array['11', '33']::text[]) d0 cross join unnest(array['1', '3']::text[]) d1 cross join unnest(array['50', '70', '95', '120', '150', '185', '240', '300']::text[]) d2 cross join unnest(array['Cu', 'Al']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cables', 'Control / data cable', format('%s %s-core %s mm², %s', d0, d1, d2, d3), 'm', '{lighting_control,electrical,vdgs,alcms}'::text[]
from unnest(array['control cable', 'instrument cable']::text[]) d0 cross join unnest(array['2', '4', '7', '12', '19', '24']::text[]) d1 cross join unnest(array['0.75', '1.0', '1.5', '2.5']::text[]) d2 cross join unnest(array['screened', 'unscreened']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cables', 'Communication cable', format('%s', d0), 'm', '{lighting_control,alcms,vdgs}'::text[]
from unnest(array['CAT6 UTP', 'CAT6 SFTP', 'CAT6A SFTP', 'fibre 4-core single-mode', 'fibre 8-core single-mode', 'fibre 12-core single-mode', 'fibre 24-core single-mode', 'fibre 12-core multi-mode', 'DALI 2-core 1.5 mm²', 'KNX bus cable', 'DMX 2-pair 120 ohm']::text[]) d0;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cable accessories', 'Cable gland', format('Brass cable gland %s, %s type, %s', d0, d1, d2), 'nos', '{electrical}'::text[]
from unnest(array['M16', 'M20S', 'M20', 'M25', 'M32', 'M40', 'M50S', 'M50', 'M63S', 'M63', 'M75']::text[]) d0 cross join unnest(array['A2 (unarmoured)', 'CW (armoured)', 'BW (armoured)', 'E1W (armoured, outdoor)']::text[]) d1 cross join unnest(array['with PVC shroud', 'without shroud']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cable accessories', 'Cable lug', format('Copper tube lug %s mm², %s hole, %s', d0, d1, d2), 'nos', '{electrical}'::text[]
from unnest(array['1.5', '2.5', '4', '6', '10', '16', '25', '35', '50', '70', '95', '120', '150', '185', '240', '300', '400']::text[]) d0 cross join unnest(array['M5', 'M6', 'M8', 'M10', 'M12', 'M16']::text[]) d1 cross join unnest(array['standard', 'bell-mouth']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cable accessories', 'Cable joint / termination', format('%s %s %s-core %s mm²', d0, d1, d2, d3), 'kit', '{electrical,underground_cabling}'::text[]
from unnest(array['LV heat-shrink straight joint', 'LV resin joint', 'LV heat-shrink termination']::text[]) d0 cross join unnest(array['XLPE/SWA', 'PVC/SWA']::text[]) d1 cross join unnest(array['2', '3', '4']::text[]) d2 cross join unnest(array['1.5-6', '10-25', '35-70', '95-150', '185-300']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cable accessories', 'MV joint / termination', format('%s kV %s, %s mm²', d0, d1, d2), 'kit', '{electrical,underground_cabling}'::text[]
from unnest(array['11', '33']::text[]) d0 cross join unnest(array['heat-shrink straight joint', 'heat-shrink indoor termination', 'heat-shrink outdoor termination', 'cold-shrink termination', 'separable elbow connector']::text[]) d1 cross join unnest(array['50-95', '120-185', '240-300']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cable accessories', 'Connectors & terminals', format('%s %s', d0, d1), 'nos', '{electrical}'::text[]
from unnest(array['insulated pin terminal', 'insulated ring terminal', 'insulated fork terminal', 'bootlace ferrule', 'butt connector', 'DIN rail terminal block', 'IP68 inline connector']::text[]) d0 cross join unnest(array['0.5-1.5 mm²', '1.5-2.5 mm²', '4-6 mm²', '10 mm²', '16 mm²']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cable accessories', 'Cable ties & markers', format('%s %s', d0, d1), 'pkt', '{electrical}'::text[]
from unnest(array['nylon cable tie black UV', 'nylon cable tie white', 'stainless-steel cable tie', 'cable marker sleeve', 'cable identification tag']::text[]) d0 cross join unnest(array['100 mm', '200 mm', '300 mm', '400 mm', '500 mm', '750 mm']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Cable accessories', 'Heat-shrink sleeve & tape', format('%s %s', d0, d1), 'nos', '{electrical}'::text[]
from unnest(array['heat-shrink sleeve', 'PVC insulation tape', 'self-amalgamating tape']::text[]) d0 cross join unnest(array['red', 'yellow', 'blue', 'black', 'green/yellow', 'clear']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Containment', 'Conduit', format('%s conduit %s mm, %s', d0, d1, d2), 'm', '{electrical,indoor,underground_cabling}'::text[]
from unnest(array['PVC heavy-gauge', 'PVC medium-gauge', 'GI', 'flexible PVC', 'flexible metallic PVC-covered']::text[]) d0 cross join unnest(array['20', '25', '32', '40', '50']::text[]) d1 cross join unnest(array['3 m length', 'per metre']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Containment', 'Conduit fitting', format('%s %s mm %s', d0, d1, d2), 'nos', '{electrical,indoor}'::text[]
from unnest(array['PVC', 'GI']::text[]) d0 cross join unnest(array['20', '25', '32', '40', '50']::text[]) d1 cross join unnest(array['coupling', '90° bend', 'inspection elbow', 'tee box', '1-way box', '2-way box', '3-way box', '4-way box', 'saddle', 'adaptable box 100x100', 'male bush']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Containment', 'Cable tray / ladder', format('%s %s mm wide, %s mm side, %s, 3 m', d0, d1, d2, d3), 'nos', '{electrical,indoor,port}'::text[]
from unnest(array['perforated cable tray', 'cable ladder', 'wire-mesh tray']::text[]) d0 cross join unnest(array['50', '100', '150', '200', '300', '450', '600']::text[]) d1 cross join unnest(array['25', '50', '75', '100']::text[]) d2 cross join unnest(array['hot-dip galvanised', 'pre-galvanised', 'stainless steel 316']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Containment', 'Tray / ladder fitting', format('%s %s for %s mm %s', d0, d1, d2, d3), 'nos', '{electrical,indoor}'::text[]
from unnest(array['perforated tray', 'ladder']::text[]) d0 cross join unnest(array['90° flat bend', 'tee', 'cross', 'reducer', 'riser bend', 'coupler set', 'cantilever arm', 'end cap']::text[]) d1 cross join unnest(array['50', '100', '150', '200', '300', '450', '600']::text[]) d2 cross join unnest(array['HDG', 'pre-galvanised']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Containment', 'Trunking', format('%s trunking %s mm, %s', d0, d1, d2), 'nos', '{electrical,indoor}'::text[]
from unnest(array['PVC', 'GI', 'dado']::text[]) d0 cross join unnest(array['25x16', '40x25', '50x50', '75x75', '100x50', '100x100', '150x100', '150x150']::text[]) d1 cross join unnest(array['3 m length', '90° bend', 'tee', 'end cap']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Containment', 'Support & fixing', format('%s %s', d0, d1), 'nos', '{electrical}'::text[]
from unnest(array['unistrut channel 41x41', 'unistrut channel 41x21', 'threaded rod', 'beam clamp', 'spring nut', 'pipe clamp']::text[]) d0 cross join unnest(array['M8', 'M10', 'M12', '3 m', '6 m']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'MCB', format('MCB %sP, %s A, %s curve, %s kA', d0, d1, d2, d3), 'nos', '{electrical,indoor}'::text[]
from unnest(array['1', '2', '3', '4']::text[]) d0 cross join unnest(array['2', '4', '6', '10', '16', '20', '25', '32', '40', '50', '63']::text[]) d1 cross join unnest(array['B', 'C', 'D']::text[]) d2 cross join unnest(array['6', '10']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'RCCB', format('RCCB %sP, %s A, %s mA, type %s', d0, d1, d2, d3), 'nos', '{electrical,indoor}'::text[]
from unnest(array['2', '4']::text[]) d0 cross join unnest(array['25', '40', '63', '80', '100']::text[]) d1 cross join unnest(array['30', '100', '300']::text[]) d2 cross join unnest(array['AC', 'A']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'RCBO', format('RCBO 1P+N, %s A, %s curve, %s mA, %s', d0, d1, d2, d3), 'nos', '{electrical,indoor}'::text[]
from unnest(array['6', '10', '16', '20', '25', '32', '40']::text[]) d0 cross join unnest(array['B', 'C']::text[]) d1 cross join unnest(array['30', '100']::text[]) d2 cross join unnest(array['type AC', 'type A']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'MCCB', format('MCCB %s A frame, %sP, %s trip, %s kA', d0, d1, d2, d3), 'nos', '{electrical}'::text[]
from unnest(array['100', '160', '250', '400', '630', '800', '1000', '1250', '1600']::text[]) d0 cross join unnest(array['3', '4']::text[]) d1 cross join unnest(array['thermal-magnetic', 'electronic']::text[]) d2 cross join unnest(array['25', '36', '50', '70']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'ACB', format('ACB %s A, %sP, %s, %s kA', d0, d1, d2, d3), 'nos', '{electrical}'::text[]
from unnest(array['800', '1000', '1250', '1600', '2000', '2500', '3200', '4000']::text[]) d0 cross join unnest(array['3', '4']::text[]) d1 cross join unnest(array['fixed', 'draw-out']::text[]) d2 cross join unnest(array['50', '65']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'Contactor', format('Contactor %s A AC-3, coil %s, %s', d0, d1, d2), 'nos', '{electrical,lighting_control}'::text[]
from unnest(array['9', '12', '18', '25', '32', '40', '50', '65', '80', '95', '115', '150']::text[]) d0 cross join unnest(array['24V AC', '230V AC', '24V DC']::text[]) d1 cross join unnest(array['1NO+1NC aux', 'modular DIN']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'Control device', format('%s %s', d0, d1), 'nos', '{electrical,lighting_control,road}'::text[]
from unnest(array['photocell', 'astronomical time switch', 'digital time switch', 'modular relay', 'impulse relay', 'push button', 'selector switch', 'indicator lamp', 'phase failure relay', 'surge protective device']::text[]) d0 cross join unnest(array['230V', '24V', 'DIN rail', 'panel mount']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'Isolator / changeover', format('%s %s A %sP', d0, d1, d2), 'nos', '{electrical}'::text[]
from unnest(array['switch disconnector', 'rotary isolator', 'manual changeover switch', 'automatic transfer switch', 'fuse switch disconnector']::text[]) d0 cross join unnest(array['32', '63', '100', '125', '160', '250', '400', '630']::text[]) d1 cross join unnest(array['2', '3', '4']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'Distribution board', format('%s distribution board %s-way, %s, %s', d0, d1, d2, d3), 'nos', '{electrical,indoor}'::text[]
from unnest(array['SP&N', 'TP&N']::text[]) d0 cross join unnest(array['4', '6', '8', '12', '16', '24', '36', '48']::text[]) d1 cross join unnest(array['surface', 'flush']::text[]) d2 cross join unnest(array['IP40', 'IP65']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'Feeder pillar / panel', format('%s %s, %s', d0, d1, d2), 'nos', '{road,electrical,outdoor}'::text[]
from unnest(array['street lighting feeder pillar', 'lighting control panel', 'sub-main panel', 'MDB']::text[]) d0 cross join unnest(array['63 A', '100 A', '160 A', '250 A', '400 A', '630 A']::text[]) d1 cross join unnest(array['with energy meter and photocell', 'with ALCMS/CMS interface', 'standard']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'Metering & CT', format('%s %s', d0, d1), 'nos', '{electrical}'::text[]
from unnest(array['current transformer class 0.5', 'current transformer class 1']::text[]) d0 cross join unnest(array['50/5', '100/5', '150/5', '200/5', '300/5', '400/5', '600/5', '800/5', '1000/5', '1500/5', '2000/5', '3000/5']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'Meter', format('%s, %s', d0, d1), 'nos', '{electrical}'::text[]
from unnest(array['kWh meter single-phase', 'kWh meter three-phase direct', 'kWh meter CT-operated', 'multifunction power meter', 'ammeter', 'voltmeter']::text[]) d0 cross join unnest(array['standard', 'with Modbus RS485', 'with pulse output']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'Surge protection', format('SPD type %s, %sP, %s kA', d0, d1, d2), 'nos', '{electrical}'::text[]
from unnest(array['1', '1+2', '2', '3']::text[]) d0 cross join unnest(array['1', '2', '3', '4']::text[]) d1 cross join unnest(array['10', '20', '40', '65']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Switchgear', 'Fuse', format('%s fuse %s A, %s', d0, d1, d2), 'nos', '{electrical}'::text[]
from unnest(array['HRC NH', 'cartridge', 'street light cut-out']::text[]) d0 cross join unnest(array['2', '4', '6', '10', '16', '20', '25', '32', '40', '63', '80', '100', '125', '160', '200', '250']::text[]) d1 cross join unnest(array['size 00', 'size 1', '10x38', '14x51']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Earthing & lightning protection', 'Earth rod', format('Copper-bonded earth rod %s mm x %s m, %s', d0, d1, d2), 'nos', '{electrical,road,sports,agl}'::text[]
from unnest(array['14.2', '16', '20']::text[]) d0 cross join unnest(array['1.2', '1.5', '2.4', '3.0']::text[]) d1 cross join unnest(array['with coupler', 'with driving stud']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Earthing & lightning protection', 'Earth conductor', format('%s %s', d0, d1), 'm', '{electrical,road,sports,agl}'::text[]
from unnest(array['bare copper tape', 'PVC-covered copper tape', 'GI strip', 'bare copper stranded']::text[]) d0 cross join unnest(array['25x3 mm', '25x4 mm', '40x4 mm', '50x6 mm', '35 mm²', '50 mm²', '70 mm²', '95 mm²']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Earthing & lightning protection', 'Earthing accessory', format('%s %s', d0, d1), 'nos', '{electrical}'::text[]
from unnest(array['earth pit with cover', 'earth test link', 'rod-to-tape clamp', 'tape clamp', 'exothermic weld mould', 'exothermic weld powder', 'earth bar', 'bonding clamp']::text[]) d0 cross join unnest(array['standard', 'heavy duty', '16 mm', '20 mm']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Earthing & lightning protection', 'Lightning protection', format('%s %s', d0, d1), 'nos', '{electrical,sports}'::text[]
from unnest(array['air terminal', 'ESE air terminal', 'down conductor fixing', 'lightning event counter', 'strike counter', 'mast for air terminal']::text[]) d0 cross join unnest(array['300 mm', '500 mm', '1 m', '2 m', 'standard']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Underground cabling', 'HDPE / PVC duct', format('%s duct %s mm, %s', d0, d1, d2), 'm', '{underground_cabling,road,electrical}'::text[]
from unnest(array['HDPE double-wall corrugated', 'HDPE smooth', 'PVC']::text[]) d0 cross join unnest(array['40', '50', '63', '75', '90', '110', '125', '160', '200']::text[]) d1 cross join unnest(array['coil', '6 m length']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Underground cabling', 'Duct accessory', format('%s for %s mm duct', d0, d1), 'nos', '{underground_cabling,road,electrical}'::text[]
from unnest(array['coupler', 'end cap', 'bend 90°', 'duct seal', 'draw rope']::text[]) d0 cross join unnest(array['50', '63', '75', '90', '110', '160']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Underground cabling', 'Draw pit / hand hole', format('%s %s, %s cover', d0, d1, d2), 'nos', '{underground_cabling,road,electrical}'::text[]
from unnest(array['precast concrete draw pit', 'polymer hand hole', 'brick draw pit']::text[]) d0 cross join unnest(array['300x300', '450x450', '600x600', '900x600', '1200x900']::text[]) d1 cross join unnest(array['heavy duty', 'medium duty', 'light duty']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Underground cabling', 'Cable protection', format('%s %s', d0, d1), 'nos', '{underground_cabling,road,electrical}'::text[]
from unnest(array['cable warning tape', 'cable cover tile', 'cable route marker', 'cable marker post', 'slab marker']::text[]) d0 cross join unnest(array['150 mm', '300 mm', 'LV', 'MV', 'fibre']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Lighting control & drivers', 'LED driver', format('LED driver constant current %s mA, %sW, %s, %s', d0, d1, d2, d3), 'nos', '{lighting_control,indoor,outdoor}'::text[]
from unnest(array['350', '500', '700', '1050', '1400', '2100']::text[]) d0 cross join unnest(array['10', '20', '30', '40', '60', '80', '100', '150']::text[]) d1 cross join unnest(array['non-dimmable', 'DALI-2', '1-10V', 'phase-cut']::text[]) d2 cross join unnest(array['IP20', 'IP67']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Lighting control & drivers', 'Constant voltage power supply', format('LED power supply %s, %sW, %s', d0, d1, d2), 'nos', '{lighting_control,indoor,facade}'::text[]
from unnest(array['12V', '24V']::text[]) d0 cross join unnest(array['30', '60', '100', '150', '200', '320', '480']::text[]) d1 cross join unnest(array['IP20', 'IP67', 'DALI dimmable IP20']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Lighting control & drivers', 'Sensor', format('%s, %s, %s', d0, d1, d2), 'nos', '{lighting_control,indoor}'::text[]
from unnest(array['PIR presence sensor ceiling', 'microwave sensor', 'high bay sensor', 'corridor sensor', 'daylight sensor', 'outdoor PIR sensor']::text[]) d0 cross join unnest(array['DALI-2', 'on/off relay', 'KNX']::text[]) d1 cross join unnest(array['flush mount', 'surface mount']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Lighting control & drivers', 'Control device', format('%s, %s', d0, d1), 'nos', '{lighting_control}'::text[]
from unnest(array['DALI gateway', 'DALI power supply', 'DALI push-button coupler', 'DALI relay module', 'DALI scene panel', 'KNX switch actuator', 'KNX dimming actuator', 'DMX512 controller', 'DMX decoder', 'Art-Net node', 'lighting control PLC', 'touch panel 7 inch']::text[]) d0 cross join unnest(array['4 channel', '8 channel', '16 channel', '64 addresses']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Lighting control & drivers', 'Street-light CMS', format('%s, %s', d0, d1), 'nos', '{lighting_control,road}'::text[]
from unnest(array['CMS node NEMA 7-pin', 'CMS node Zhaga', 'CMS gateway', 'segment controller']::text[]) d0 cross join unnest(array['LoRaWAN', 'NB-IoT', 'RF mesh', 'PLC']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Measurement & testing', 'Instrument', format('%s, %s', d0, d1), 'nos', '{lighting_measurement,electrical}'::text[]
from unnest(array['lux meter', 'luminance meter', 'spectrometer', 'goniophotometer hire', 'insulation tester', 'earth resistance tester', 'loop impedance tester', 'RCD tester', 'multifunction installation tester', 'clamp meter', 'power quality analyser', 'thermal camera', 'cable fault locator', 'phase rotation meter']::text[]) d0 cross join unnest(array['calibrated', 'with calibration certificate', 'rental per day']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Fixings & hardware', 'Bolt / nut / washer', format('%s %s x %s mm, %s', d0, d1, d2, d3), 'nos', '{electrical,road,sports,outdoor}'::text[]
from unnest(array['hex bolt with nut and washer', 'anchor bolt J-type', 'chemical anchor stud', 'sleeve anchor', 'drop-in anchor']::text[]) d0 cross join unnest(array['M8', 'M10', 'M12', 'M16', 'M20', 'M24', 'M30']::text[]) d1 cross join unnest(array['50', '75', '100', '150', '300', '600']::text[]) d2 cross join unnest(array['hot-dip galvanised', 'stainless steel 304']::text[]) d3;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Fixings & hardware', 'Fixing', format('%s %s', d0, d1), 'pkt', '{electrical,indoor}'::text[]
from unnest(array['wall plug', 'self-drilling screw', 'machine screw', 'rivet']::text[]) d0 cross join unnest(array['5 mm', '6 mm', '8 mm', '10 mm']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Civil for lighting', 'Foundation & concrete', format('%s %s', d0, d1), 'nos', '{road,sports,outdoor,port}'::text[]
from unnest(array['pole foundation (cast in situ)', 'precast pole foundation', 'high mast foundation']::text[]) d0 cross join unnest(array['4 m pole', '6 m pole', '8 m pole', '10 m pole', '12 m pole', '16 m mast', '20 m mast', '30 m mast']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Civil for lighting', 'Civil material', format('%s %s', d0, d1), 'm3', '{road,sports,outdoor,underground_cabling}'::text[]
from unnest(array['concrete grade', 'sand for cable bed', 'aggregate']::text[]) d0 cross join unnest(array['15', '20', '25', '30', 'fine', 'coarse']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Civil for lighting', 'Reinforcement', format('Reinforcement bar %s mm %s', d0, d1), 'kg', '{road,sports}'::text[]
from unnest(array['8', '10', '12', '16', '20', '25']::text[]) d0 cross join unnest(array['high-tensile', 'mild steel']::text[]) d1;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Batteries & spares', 'Battery pack', format('%s battery pack %s, %s mAh', d0, d1, d2), 'nos', '{emergency,central_battery}'::text[]
from unnest(array['NiCd', 'NiMH', 'LiFePO4']::text[]) d0 cross join unnest(array['3.6V', '4.8V', '6V', '7.2V']::text[]) d1 cross join unnest(array['1800', '2500', '4000', '4500']::text[]) d2;
insert into public.material_catalog (category, subcategory, name, unit, areas)
select 'Batteries & spares', 'VRLA battery', format('VRLA battery 12V %s Ah, %s', d0, d1), 'nos', '{central_battery,agl}'::text[]
from unnest(array['7', '12', '17', '26', '40', '65', '100', '150', '200']::text[]) d0 cross join unnest(array['standard', 'long life']::text[]) d1;
update public.material_catalog c set code = x.code
from (select id, (case category when 'Indoor luminaires' then 'IND' when 'Emergency lighting' then 'EML' when 'Central battery systems' then 'CBS' when 'Road lighting' then 'RDL' when 'Floodlighting' then 'FLD' when 'Sports lighting' then 'SPL' when 'Outdoor luminaires' then 'OUT' when 'Tunnel lighting' then 'TNL' when 'Facade lighting' then 'FAC' when 'Airport systems (AGL)' then 'AGL' when 'Airport systems' then 'APS' when 'Cables' then 'CBL' when 'Cable accessories' then 'CBA' when 'Containment' then 'CNT' when 'Switchgear' then 'SWG' when 'Earthing & lightning protection' then 'ERT' when 'Underground cabling' then 'UGC' when 'Lighting control & drivers' then 'CTL' when 'Measurement & testing' then 'MST' when 'Fixings & hardware' then 'FIX' when 'Civil for lighting' then 'CIV' when 'Batteries & spares' then 'BAT' else 'GEN' end) || '-' || lpad(row_number() over (partition by category order by id)::text, 5, '0') code from public.material_catalog) x
where x.id = c.id;

-- Search: every word must appear (code, category, subcategory or name); items for the project's areas first
create or replace function public.search_material_catalog(p_q text default null, p_areas text[] default null, p_category text default null, p_limit int default 60)
returns table (id int, code text, category text, subcategory text, name text, unit text, areas text[], suits boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.code, c.category, c.subcategory, c.name, c.unit, c.areas, coalesce(c.areas && p_areas, false)
  from public.material_catalog c
  where c.active and (p_category is null or c.category = p_category)
    and not exists (select 1 from unnest(regexp_split_to_array(lower(btrim(coalesce(p_q, ''))), '\s+')) t where t <> '' and position(t in c.search) = 0)
  order by coalesce(c.areas && p_areas, false) desc, c.category, c.subcategory, c.id
  limit least(greatest(coalesce(p_limit, 60), 1), 200)
$$;

create or replace function public.material_categories(p_areas text[] default null)
returns table (category text, items int, suits boolean)
language sql stable security definer set search_path = public as $$
  select category, count(*)::int, bool_or(coalesce(areas && p_areas, false)) from public.material_catalog where active group by category
  order by bool_or(coalesce(areas && p_areas, false)) desc, category
$$;

alter table public.material_requests add column if not exists priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  add column if not exists activity_id uuid references public.exec_activities (id) on delete set null,
  add column if not exists deliver_to text, add column if not exists site_contact text;
alter table public.material_request_lines add column if not exists catalog_id int references public.material_catalog (id),
  add column if not exists category text, add column if not exists spec text, add column if not exists brand text,
  add column if not exists custom boolean not null default false, add column if not exists est_rate numeric(16, 2), add column if not exists note text;

-- Request with the catalogue (copied from 20260930000115_material_supervisor_ack.sql): each line is a catalogue item or a ticked custom item
create or replace function public.raise_material_request(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; l jsonb; n int := 0; sub boolean := app.has_role('sub_supervisor'); c public.material_catalog; cid int; nm text;
        act uuid := nullif(p ->> 'activity_id', '')::uuid; est numeric := 0; rate numeric;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec) or (sub and app.is_exec_member(p_exec)),
    'The project''s Assistant Engineers, its subcontractor supervisors or the Senior Electrical Engineer request materials');
  perform app.require(nullif(p ->> 'required_date', '') is not null, 'Set the date the material is needed on site');
  perform app.require(act is null or exists (select 1 from public.exec_activities where id = act and exec_project_id = p_exec), 'Choose an activity of this project');
  insert into public.material_requests (code, exec_project_id, required_date, purpose, est_value_lkr, status, priority, activity_id, deliver_to, site_contact)
  values (app.next_code('MR'), p_exec, (p ->> 'required_date')::date, nullif(btrim(p ->> 'purpose'), ''),
          case when sub then null else nullif(p ->> 'est_value', '')::numeric end, case when sub then 'ae_review' else 'submitted' end,
          case when p ->> 'priority' = 'urgent' then 'urgent' else 'normal' end, act, nullif(btrim(p ->> 'deliver_to'), ''), nullif(btrim(p ->> 'site_contact'), ''))
  returning * into m;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    cid := nullif(l ->> 'catalog_id', '')::int;
    continue when cid is null and coalesce(btrim(l ->> 'item'), '') = '';
    c := null;
    if cid is not null then
      select * into c from public.material_catalog where id = cid and active;
      perform app.require(c.id is not null, 'Catalogue item not found – choose it again');
      nm := c.name;
    else
      perform app.require(coalesce((l ->> 'custom')::boolean, false), 'Choose the item from the catalogue, or tick “not in the catalogue” and describe it');
      nm := btrim(l ->> 'item');
    end if;
    perform app.require(nullif(l ->> 'qty', '')::numeric > 0 and coalesce(btrim(coalesce(l ->> 'unit', c.unit)), '') <> '', 'Each item needs a quantity and unit');
    rate := case when sub then null else nullif(l ->> 'est_rate', '')::numeric end;
    insert into public.material_request_lines (mr_id, item, unit, qty, catalog_id, category, spec, brand, custom, est_rate, note)
    values (m.id, nm, coalesce(nullif(btrim(l ->> 'unit'), ''), c.unit), (l ->> 'qty')::numeric, c.id, coalesce(c.category, nullif(btrim(l ->> 'category'), '')),
            nullif(btrim(l ->> 'spec'), ''), nullif(btrim(l ->> 'brand'), ''), c.id is null, rate, nullif(btrim(l ->> 'note'), ''));
    est := est + coalesce(rate, 0) * (l ->> 'qty')::numeric;
    n := n + 1;
  end loop;
  perform app.require(n > 0, 'Add at least one item');
  if not sub and m.est_value_lkr is null and est > 0 then
    update public.material_requests set est_value_lkr = est where id = m.id returning * into m;
  end if;
  if sub then
    perform app.notify_many(app.project_aes(p_exec), 'exec_material', 'Material request from the subcontractor – check and forward',
      app.mr_head(m) || ' · ' || app.display_name(auth.uid()), case when m.priority = 'urgent' then 'critical' else 'normal' end::public.priority,
      'material_request', m.id, '/execution/material/' || m.id, null, true);
  elsif app.has_role('senior_elec_engineer') then
    perform public.decide_material_request(m.id, true, null);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_material', case when m.priority = 'urgent' then 'URGENT material request to approve' else 'Material request to approve' end,
      app.mr_head(m) || ' · ' || app.display_name(auth.uid()), case when m.priority = 'urgent' then 'critical' else 'normal' end::public.priority,
      'material_request', m.id, '/execution/material/' || m.id, null, true);
  end if;
  return m.id;
end $$;

revoke execute on function public.search_material_catalog(text, text[], text, int), public.material_categories(text[]) from public, anon;
grant execute on function public.search_material_catalog(text, text[], text, int), public.material_categories(text[]) to authenticated;
