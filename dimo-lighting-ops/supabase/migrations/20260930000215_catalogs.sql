-- Catalogs (Sales Tools): brand catalogues, and the luminaire library with IES files and data sheets
--  * brand_catalogs: for each brand, the manufacturer's online catalogue / product finder and its downloads page (IES,
--    data sheets) – opened from the app – and notes.
--  * catalog_files: PDF catalogues and brochures kept in the private "catalog" bucket – uploaded, or fetched by the
--    server from the manufacturer's link (Edge Function catalog-fetch). Shared with clients with the DIMO watermark.
--  * luminaires: individual luminaires with their specification, IES file (ies_files) and data sheet – used in DLux
--    and road lighting. Six generic samples with IES curves are included for simulations.
--  * Seen by everyone with Sales Tools; kept by the Design team, SM Projects, GM / DGM and the System Administrator.

alter table public.ies_files alter column uploaded_by drop not null;

create table if not exists public.brand_catalogs (
  brand_id bigint primary key references public.brands (id),
  website text,
  catalogue_url text,
  downloads_url text,
  notes text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create table if not exists public.catalog_files (
  id uuid primary key default gen_random_uuid(),
  brand_id bigint references public.brands (id),
  title text not null,
  kind text not null default 'catalogue' check (kind in ('catalogue', 'brochure', 'price_list', 'other')),
  storage_path text not null unique,
  file_name text not null,
  size_bytes bigint,
  source_url text,
  year int,
  active boolean not null default true,
  uploaded_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists catalog_files_brand on public.catalog_files (brand_id, created_at desc);
create table if not exists public.luminaires (
  id uuid primary key default gen_random_uuid(),
  brand_id bigint references public.brands (id),
  name text not null,
  code text,
  family text not null default 'Other',
  fitting_type text not null default 'panel',
  watts numeric(10, 2),
  lumens numeric(12, 1),
  cct int,
  cri int,
  ip text,
  ik text,
  ugr numeric(4, 1),
  beam int,
  lit_l numeric(10, 1),
  lit_w numeric(10, 1),
  ies_id uuid references public.ies_files (id),
  datasheet_path text,
  datasheet_name text,
  datasheet_url text,
  stock text check (stock in ('in', 'out')),
  sample boolean not null default false,
  notes text,
  sort int not null default 0,
  active boolean not null default true,
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists luminaires_brand on public.luminaires (brand_id, family);

alter table public.brand_catalogs enable row level security;
alter table public.catalog_files enable row level security;
alter table public.luminaires enable row level security;
drop policy if exists bc_read on public.brand_catalogs;
drop policy if exists bc_write on public.brand_catalogs;
drop policy if exists cf_read on public.catalog_files;
drop policy if exists cf_write on public.catalog_files;
drop policy if exists lum_read on public.luminaires;
drop policy if exists lum_write on public.luminaires;
create policy bc_read on public.brand_catalogs for select to authenticated using (app.sees_sales_tools());
create policy bc_write on public.brand_catalogs for all to authenticated using (app.keeps_ies_library()) with check (app.keeps_ies_library());
create policy cf_read on public.catalog_files for select to authenticated using (app.sees_sales_tools() and (active or app.keeps_ies_library()));
create policy cf_write on public.catalog_files for all to authenticated using (app.keeps_ies_library()) with check (app.keeps_ies_library());
create policy lum_read on public.luminaires for select to authenticated using (app.sees_sales_tools() and (active or app.keeps_ies_library()));
create policy lum_write on public.luminaires for all to authenticated using (app.keeps_ies_library()) with check (app.keeps_ies_library());
grant select, insert, update, delete on public.brand_catalogs, public.catalog_files, public.luminaires to authenticated;
drop trigger if exists audit_brand_catalogs on public.brand_catalogs;
create trigger audit_brand_catalogs after insert or update on public.brand_catalogs for each row execute function app.audit();
drop trigger if exists audit_luminaires on public.luminaires;
create trigger audit_luminaires after insert or update on public.luminaires for each row execute function app.audit();

-- The IES file of a library luminaire is seen by everyone with Sales Tools
drop policy if exists ies_read on public.ies_files;
create policy ies_read on public.ies_files for select to authenticated using (
  app.sees_sales_tools() and (
    (scope = 'library' and (active or app.keeps_ies_library()))
    or uploaded_by = auth.uid()
    or exists (select 1 from public.quick_calcs q where q.inputs ->> 'ies_id' = ies_files.id::text)
    or exists (select 1 from public.luminaires l where l.ies_id = ies_files.id and l.active)));

-- Private bucket for catalogues and data sheets (50 MB a file)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('catalog', 'catalog', false, 52428800, null)
    on conflict (id) do nothing;
    execute 'drop policy if exists catalog_read on storage.objects';
    execute 'drop policy if exists catalog_insert on storage.objects';
    execute 'drop policy if exists catalog_update on storage.objects';
    execute 'drop policy if exists catalog_delete on storage.objects';
    execute $p$create policy catalog_read on storage.objects for select to authenticated using (bucket_id = 'catalog' and app.sees_sales_tools())$p$;
    execute $p$create policy catalog_insert on storage.objects for insert to authenticated with check (bucket_id = 'catalog' and app.keeps_ies_library())$p$;
    execute $p$create policy catalog_update on storage.objects for update to authenticated using (bucket_id = 'catalog' and app.keeps_ies_library())$p$;
    execute $p$create policy catalog_delete on storage.objects for delete to authenticated using (bucket_id = 'catalog' and app.keeps_ies_library())$p$;
  end if;
end $$;

-- Generic samples: IES curves and luminaires for simulations
insert into public.ies_files (id, scope, name, manufacturer, product_code, file_name, lumens, watts, len_mm, wid_mm, beam, up_share, content)
values
  ('d17c0000-0000-0000-0000-000000000001', 'library', 'Panel 600×600 – 36 W (sample)', 'DIMO sample (generic)', 'SAMPLE-1', 'sample-1.ies', 4000, 36, 597, 597, 120, 0, 'IESNA:LM-63-2002
[TEST] DIMO sample (generic) – for DLux simulations
[MANUFAC] DIMO sample (generic)
[LUMCAT] SAMPLE-1
[LUMINAIRE] Panel 600×600 – 36 W (sample)
[OTHER] Generic sample curve made for DLux – not a manufacturer''s measurement
TILT=NONE
1 -1 1 73 2 1 2 0.597 0.597 0.05
1 1 36
0 2.5 5 7.5 10 12.5 15 17.5 20 22.5 25 27.5 30 32.5 35 37.5 40 42.5 45 47.5 50 52.5 55 57.5 60 62.5 65 67.5 70 72.5 75 77.5 80 82.5 85 87.5 90 92.5 95 97.5 100 102.5 105 107.5 110 112.5 115 117.5 120 122.5 125 127.5 130 132.5 135 137.5 140 142.5 145 147.5 150 152.5 155 157.5 160 162.5 165 167.5 170 172.5 175 177.5 180
0 90
1273.0 1271.8 1268.1 1262.1 1253.6 1242.8 1229.6 1214.1 1196.2 1176.1 1153.7 1129.1 1102.4 1073.6 1042.8 1009.9 975.2 938.5 900.1 860.0 818.3 774.9 730.2 684.0 636.5 587.8 538.0 487.1 435.4 382.8 329.5 275.5 221.1 166.2 110.9 55.5 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
1273.0 1271.8 1268.1 1262.1 1253.6 1242.8 1229.6 1214.1 1196.2 1176.1 1153.7 1129.1 1102.4 1073.6 1042.8 1009.9 975.2 938.5 900.1 860.0 818.3 774.9 730.2 684.0 636.5 587.8 538.0 487.1 435.4 382.8 329.5 275.5 221.1 166.2 110.9 55.5 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
'),
  ('d17c0000-0000-0000-0000-000000000002', 'library', 'Downlight 150 mm – 18 W (sample)', 'DIMO sample (generic)', 'SAMPLE-2', 'sample-2.ies', 1800, 18, 150, 150, 90, 0, 'IESNA:LM-63-2002
[TEST] DIMO sample (generic) – for DLux simulations
[MANUFAC] DIMO sample (generic)
[LUMCAT] SAMPLE-2
[LUMINAIRE] Downlight 150 mm – 18 W (sample)
[OTHER] Generic sample curve made for DLux – not a manufacturer''s measurement
TILT=NONE
1 -1 1 73 1 1 2 0.150 0.150 0.05
1 1 18
0 2.5 5 7.5 10 12.5 15 17.5 20 22.5 25 27.5 30 32.5 35 37.5 40 42.5 45 47.5 50 52.5 55 57.5 60 62.5 65 67.5 70 72.5 75 77.5 80 82.5 85 87.5 90 92.5 95 97.5 100 102.5 105 107.5 110 112.5 115 117.5 120 122.5 125 127.5 130 132.5 135 137.5 140 142.5 145 147.5 150 152.5 155 157.5 160 162.5 165 167.5 170 172.5 175 177.5 180
0
859.3 857.7 852.8 844.7 833.4 819.1 801.7 781.6 758.8 733.5 705.8 676.1 644.5 611.2 576.6 540.9 504.3 467.1 429.7 392.2 355.0 318.5 282.7 248.1 214.8 183.2 153.5 125.8 100.5 77.7 57.6 40.3 25.9 14.6 6.5 1.6 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
'),
  ('d17c0000-0000-0000-0000-000000000003', 'library', 'Linear batten 1200 mm – 36 W (sample)', 'DIMO sample (generic)', 'SAMPLE-3', 'sample-3.ies', 4200, 36, 1200, 50, 120, 0.150, 'IESNA:LM-63-2002
[TEST] DIMO sample (generic) – for DLux simulations
[MANUFAC] DIMO sample (generic)
[LUMCAT] SAMPLE-3
[LUMINAIRE] Linear batten 1200 mm – 36 W (sample)
[OTHER] Generic sample curve made for DLux – not a manufacturer''s measurement
TILT=NONE
1 -1 1 73 5 1 2 0.050 1.200 0.05
1 1 36
0 2.5 5 7.5 10 12.5 15 17.5 20 22.5 25 27.5 30 32.5 35 37.5 40 42.5 45 47.5 50 52.5 55 57.5 60 62.5 65 67.5 70 72.5 75 77.5 80 82.5 85 87.5 90 92.5 95 97.5 100 102.5 105 107.5 110 112.5 115 117.5 120 122.5 125 127.5 130 132.5 135 137.5 140 142.5 145 147.5 150 152.5 155 157.5 160 162.5 165 167.5 170 172.5 175 177.5 180
0 45 90 135 180
1168.7 1167.6 1164.3 1158.7 1151.0 1141.0 1128.9 1114.6 1098.2 1079.7 1059.2 1036.7 1012.1 985.7 957.3 927.2 895.3 861.7 826.4 789.6 751.2 711.5 670.3 627.9 584.4 539.6 493.9 447.2 399.7 351.4 302.5 253.0 202.9 152.5 101.9 51.0 0.0 9.2 18.3 27.5 36.5 45.5 54.4 63.3 71.9 80.5 88.9 97.1 105.2 113.0 120.7 128.1 135.2 142.1 148.8 155.1 161.2 166.9 172.3 177.4 182.2 186.6 190.7 194.4 197.7 200.6 203.2 205.4 207.2 208.6 209.6 210.2 210.4
1134.5 1133.4 1130.2 1124.8 1117.2 1107.6 1095.8 1082.0 1066.1 1048.1 1028.2 1006.3 982.5 956.8 929.3 900.0 869.1 836.4 802.2 766.4 729.2 690.6 650.7 609.6 567.2 523.8 479.5 434.1 388.0 341.1 293.6 245.5 197.0 148.1 98.9 49.5 0.0 9.2 18.3 27.5 36.5 45.5 54.4 63.3 71.9 80.5 88.9 97.1 105.2 113.0 120.7 128.1 135.2 142.1 148.8 155.1 161.2 166.9 172.3 177.4 182.2 186.6 190.7 194.4 197.7 200.6 203.2 205.4 207.2 208.6 209.6 210.2 210.4
1051.8 1050.8 1047.8 1042.8 1035.9 1026.9 1016.0 1003.2 988.4 971.8 953.3 933.0 910.9 887.1 861.6 834.5 805.8 775.5 743.8 710.6 676.1 640.3 603.3 565.2 525.9 485.7 444.5 402.5 359.7 316.3 272.2 227.7 182.6 137.3 91.7 45.9 0.0 9.2 18.3 27.5 36.5 45.5 54.4 63.3 71.9 80.5 88.9 97.1 105.2 113.0 120.7 128.1 135.2 142.1 148.8 155.1 161.2 166.9 172.3 177.4 182.2 186.6 190.7 194.4 197.7 200.6 203.2 205.4 207.2 208.6 209.6 210.2 210.4
1134.5 1133.4 1130.2 1124.8 1117.2 1107.6 1095.8 1082.0 1066.1 1048.1 1028.2 1006.3 982.5 956.8 929.3 900.0 869.1 836.4 802.2 766.4 729.2 690.6 650.7 609.6 567.2 523.8 479.5 434.1 388.0 341.1 293.6 245.5 197.0 148.1 98.9 49.5 0.0 9.2 18.3 27.5 36.5 45.5 54.4 63.3 71.9 80.5 88.9 97.1 105.2 113.0 120.7 128.1 135.2 142.1 148.8 155.1 161.2 166.9 172.3 177.4 182.2 186.6 190.7 194.4 197.7 200.6 203.2 205.4 207.2 208.6 209.6 210.2 210.4
1168.7 1167.6 1164.3 1158.7 1151.0 1141.0 1128.9 1114.6 1098.2 1079.7 1059.2 1036.7 1012.1 985.7 957.3 927.2 895.3 861.7 826.4 789.6 751.2 711.5 670.3 627.9 584.4 539.6 493.9 447.2 399.7 351.4 302.5 253.0 202.9 152.5 101.9 51.0 0.0 9.2 18.3 27.5 36.5 45.5 54.4 63.3 71.9 80.5 88.9 97.1 105.2 113.0 120.7 128.1 135.2 142.1 148.8 155.1 161.2 166.9 172.3 177.4 182.2 186.6 190.7 194.4 197.7 200.6 203.2 205.4 207.2 208.6 209.6 210.2 210.4
'),
  ('d17c0000-0000-0000-0000-000000000004', 'library', 'High-bay 150 W – 90° (sample)', 'DIMO sample (generic)', 'SAMPLE-4', 'sample-4.ies', 22000, 150, 320, 320, 90, 0, 'IESNA:LM-63-2002
[TEST] DIMO sample (generic) – for DLux simulations
[MANUFAC] DIMO sample (generic)
[LUMCAT] SAMPLE-4
[LUMINAIRE] High-bay 150 W – 90° (sample)
[OTHER] Generic sample curve made for DLux – not a manufacturer''s measurement
TILT=NONE
1 -1 1 73 1 1 2 0.320 0.320 0.05
1 1 150
0 2.5 5 7.5 10 12.5 15 17.5 20 22.5 25 27.5 30 32.5 35 37.5 40 42.5 45 47.5 50 52.5 55 57.5 60 62.5 65 67.5 70 72.5 75 77.5 80 82.5 85 87.5 90 92.5 95 97.5 100 102.5 105 107.5 110 112.5 115 117.5 120 122.5 125 127.5 130 132.5 135 137.5 140 142.5 145 147.5 150 152.5 155 157.5 160 162.5 165 167.5 170 172.5 175 177.5 180
0
10502.6 10482.6 10422.8 10323.7 10185.9 10010.6 9799.1 9552.9 9274.1 8964.6 8626.8 8263.3 7877.0 7470.6 7047.4 6610.5 6163.2 5709.0 5251.3 4793.6 4339.4 3892.2 3455.3 3032.0 2625.7 2239.3 1875.8 1538.1 1228.6 949.7 703.5 492.0 316.7 178.9 79.8 20.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
'),
  ('d17c0000-0000-0000-0000-000000000005', 'library', 'Floodlight 200 W – 40° (sample)', 'DIMO sample (generic)', 'SAMPLE-5', 'sample-5.ies', 26000, 200, 400, 300, 40, 0, 'IESNA:LM-63-2002
[TEST] DIMO sample (generic) – for DLux simulations
[MANUFAC] DIMO sample (generic)
[LUMCAT] SAMPLE-5
[LUMINAIRE] Floodlight 200 W – 40° (sample)
[OTHER] Generic sample curve made for DLux – not a manufacturer''s measurement
TILT=NONE
1 -1 1 73 1 1 2 0.300 0.400 0.05
1 1 200
0 2.5 5 7.5 10 12.5 15 17.5 20 22.5 25 27.5 30 32.5 35 37.5 40 42.5 45 47.5 50 52.5 55 57.5 60 62.5 65 67.5 70 72.5 75 77.5 80 82.5 85 87.5 90 92.5 95 97.5 100 102.5 105 107.5 110 112.5 115 117.5 120 122.5 125 127.5 130 132.5 135 137.5 140 142.5 145 147.5 150 152.5 155 157.5 160 162.5 165 167.5 170 172.5 175 177.5 180
0
45492.9 45061.7 43791.1 41747.4 39035.3 35789.7 32164.8 28322.9 24423.1 20610.9 17009.9 13716.2 10795.7 8283.9 6188.5 4493.8 3165.8 2159.0 1421.7 901.1 547.8 318.0 175.3 91.2 44.4 20.0 8.3 3.1 1.0 0.3 0.1 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
'),
  ('d17c0000-0000-0000-0000-000000000006', 'library', 'Street light 100 W – type II (sample)', 'DIMO sample (generic)', 'SAMPLE-6', 'sample-6.ies', 13000, 100, 600, 250, 140, 0, 'IESNA:LM-63-2002
[TEST] DIMO sample (generic) – for DLux simulations
[MANUFAC] DIMO sample (generic)
[LUMCAT] SAMPLE-6
[LUMINAIRE] Street light 100 W – type II (sample)
[OTHER] Generic sample curve made for DLux – not a manufacturer''s measurement
TILT=NONE
1 -1 1 73 25 1 2 0.250 0.600 0.05
1 1 100
0 2.5 5 7.5 10 12.5 15 17.5 20 22.5 25 27.5 30 32.5 35 37.5 40 42.5 45 47.5 50 52.5 55 57.5 60 62.5 65 67.5 70 72.5 75 77.5 80 82.5 85 87.5 90 92.5 95 97.5 100 102.5 105 107.5 110 112.5 115 117.5 120 122.5 125 127.5 130 132.5 135 137.5 140 142.5 145 147.5 150 152.5 155 157.5 160 162.5 165 167.5 170 172.5 175 177.5 180
0 15 30 45 60 75 90 105 120 135 150 165 180 195 210 225 240 255 270 285 300 315 330 345 360
2401.6 2400.4 2397.0 2391.4 2383.6 2373.7 2362.0 2348.9 2335.4 2322.9 2313.8 2311.9 2322.5 2353.0 2412.5 2511.4 2660.2 2867.5 3137.5 3467.1 3844.2 4246.1 4640.9 4990.4 5255.3 5401.0 5403.7 5254.7 4961.6 4262.8 2527.4 1123.1 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2401.6 2400.4 2397.1 2391.5 2383.9 2374.3 2363.3 2351.5 2340.3 2331.7 2329.1 2337.3 2362.9 2414.4 2501.6 2634.6 2822.3 3069.6 3375.3 3729.4 4112.4 4495.1 4841.9 5114.9 5279.5 5310.8 5197.2 4943.2 4568.0 3845.5 2237.9 982.5 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2401.7 2400.7 2397.6 2392.7 2386.3 2379.2 2372.6 2368.5 2370.3 2382.3 2410.7 2463.4 2549.0 2676.5 2853.1 3082.4 3361.8 3681.0 4021.1 4355.1 4650.8 4875.1 4999.0 5002.4 4878.3 4633.2 4286.6 3866.8 3406.1 2752.4 1551.0 676.6 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2402.7 2402.9 2402.1 2401.3 2402.2 2407.3 2420.5 2446.7 2492.3 2564.3 2670.1 2815.5 3003.5 3232.0 3492.7 3770.0 4042.1 4282.8 4465.0 4565.2 4567.1 4465.0 4264.3 3981.0 3638.3 3262.9 2880.4 2512.2 2173.1 1753.7 1003.5 461.8 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2409.3 2415.0 2423.6 2437.8 2461.6 2499.8 2558.1 2641.9 2755.9 2902.3 3079.5 3281.1 3495.2 3704.7 3889.5 4028.8 4104.2 4103.4 4021.8 3863.7 3641.4 3373.0 3079.1 2779.7 2491.4 2225.8 1989.1 1782.2 1602.3 1353.6 812.6 396.3 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2424.9 2441.0 2464.8 2500.2 2551.8 2623.7 2719.4 2840.1 2983.8 3144.7 3312.6 3473.5 3611.3 3709.8 3755.5 3739.7 3660.1 3521.6 3334.8 3114.4 2876.9 2637.5 2408.7 2198.7 2011.6 1847.5 1703.9 1576.5 1460.2 1265.4 775.2 385.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2434.4 2455.7 2486.6 2530.9 2592.6 2674.9 2779.5 2905.2 3047.5 3197.9 3344.6 3473.1 3568.8 3618.9 3614.5 3552.5 3435.9 3273.4 3077.7 2863.5 2644.9 2433.7 2238.1 2062.4 1907.5 1771.5 1650.8 1540.9 1437.3 1252.2 770.1 383.5 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2424.9 2441.0 2464.8 2500.2 2551.8 2623.7 2719.4 2840.1 2983.8 3144.7 3312.6 3473.5 3611.3 3709.8 3755.5 3739.7 3660.1 3521.6 3334.8 3114.4 2876.9 2637.5 2408.7 2198.7 2011.6 1847.5 1703.9 1576.5 1460.2 1265.4 775.2 385.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2409.3 2415.0 2423.6 2437.8 2461.6 2499.8 2558.1 2641.9 2755.9 2902.3 3079.5 3281.1 3495.2 3704.7 3889.5 4028.8 4104.2 4103.4 4021.8 3863.7 3641.4 3373.0 3079.1 2779.7 2491.4 2225.8 1989.1 1782.2 1602.3 1353.6 812.6 396.3 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2402.7 2402.9 2402.1 2401.3 2402.2 2407.3 2420.5 2446.7 2492.3 2564.3 2670.1 2815.5 3003.5 3232.0 3492.7 3770.0 4042.1 4282.8 4465.0 4565.2 4567.1 4465.0 4264.3 3981.0 3638.3 3262.9 2880.4 2512.2 2173.1 1753.7 1003.5 461.8 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2401.7 2400.7 2397.6 2392.7 2386.3 2379.2 2372.6 2368.5 2370.3 2382.3 2410.7 2463.4 2549.0 2676.5 2853.1 3082.4 3361.8 3681.0 4021.1 4355.1 4650.8 4875.1 4999.0 5002.4 4878.3 4633.2 4286.6 3866.8 3406.1 2752.4 1551.0 676.6 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2401.6 2400.4 2397.1 2391.5 2383.9 2374.3 2363.3 2351.5 2340.3 2331.7 2329.1 2337.3 2362.9 2414.4 2501.6 2634.6 2822.3 3069.6 3375.3 3729.4 4112.4 4495.1 4841.9 5114.9 5279.5 5310.8 5197.2 4943.2 4568.0 3845.5 2237.9 982.5 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2401.6 2400.4 2397.0 2391.4 2383.6 2373.7 2362.0 2348.9 2335.4 2322.9 2313.8 2311.9 2322.5 2353.0 2412.5 2511.4 2660.2 2867.5 3137.5 3467.1 3844.2 4246.1 4640.9 4990.4 5255.3 5401.0 5403.7 5254.7 4961.6 4262.8 2527.4 1123.1 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2305.0 2304.0 2300.8 2295.6 2288.4 2279.6 2269.7 2259.8 2251.4 2247.2 2251.1 2268.9 2307.9 2377.1 2486.6 2645.6 2861.1 3135.1 3461.9 3827.0 4206.1 4567.0 4873.3 5089.0 5184.9 5143.4 4961.5 4651.7 4239.1 3522.2 2025.6 882.4 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2041.9 2041.6 2040.2 2038.1 2036.7 2037.6 2043.8 2059.2 2089.4 2141.3 2222.6 2341.2 2503.7 2713.2 2967.4 3257.3 3565.9 3869.3 4139.1 4345.7 4463.4 4474.6 4372.8 4164.1 3866.0 3503.7 3106.3 2701.8 2313.7 1835.5 1026.6 455.4 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
1694.9 1705.3 1721.7 1747.6 1787.7 1847.2 1931.3 2044.4 2188.6 2362.4 2559.8 2769.4 2975.5 3158.9 3300.1 3381.9 3392.6 3328.0 3192.2 2996.8 2758.8 2497.8 2232.5 1978.8 1747.7 1545.0 1372.0 1226.1 1102.6 933.4 561.9 275.1 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
1413.9 1459.8 1519.7 1594.7 1684.1 1784.8 1891.2 1995.4 2087.9 2158.9 2199.7 2204.6 2171.5 2102.3 2003.0 1882.0 1749.1 1613.8 1484.0 1365.2 1260.3 1170.1 1093.4 1027.9 970.9 919.4 871.2 824.0 776.1 680.8 420.6 210.1 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
1148.2 1175.2 1203.6 1231.6 1256.6 1276.1 1287.6 1289.2 1280.0 1260.2 1231.0 1194.4 1153.1 1109.6 1066.2 1024.6 985.8 950.3 917.7 887.6 859.2 831.9 804.7 777.2 748.7 719.0 687.5 654.1 618.3 543.5 336.1 168.1 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
960.6 960.2 958.8 956.5 953.3 949.2 944.1 938.1 931.2 923.3 914.5 904.7 894.0 882.2 869.4 855.6 840.8 824.8 807.8 789.6 770.2 749.5 727.5 704.1 679.3 652.8 624.5 594.3 561.8 493.8 305.4 152.7 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
1148.2 1175.2 1203.6 1231.6 1256.6 1276.1 1287.6 1289.2 1280.0 1260.2 1231.0 1194.4 1153.1 1109.6 1066.2 1024.6 985.8 950.3 917.7 887.6 859.2 831.9 804.7 777.2 748.7 719.0 687.5 654.1 618.3 543.5 336.1 168.1 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
1413.9 1459.8 1519.7 1594.7 1684.1 1784.8 1891.2 1995.4 2087.9 2158.9 2199.7 2204.6 2171.5 2102.3 2003.0 1882.0 1749.1 1613.8 1484.0 1365.2 1260.3 1170.1 1093.4 1027.9 970.9 919.4 871.2 824.0 776.1 680.8 420.6 210.1 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
1694.9 1705.3 1721.7 1747.6 1787.7 1847.2 1931.3 2044.4 2188.6 2362.4 2559.8 2769.4 2975.5 3158.9 3300.1 3381.9 3392.6 3328.0 3192.2 2996.8 2758.8 2497.8 2232.5 1978.8 1747.7 1545.0 1372.0 1226.1 1102.6 933.4 561.9 275.1 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2041.9 2041.6 2040.2 2038.1 2036.7 2037.6 2043.8 2059.2 2089.4 2141.3 2222.6 2341.2 2503.7 2713.2 2967.4 3257.3 3565.9 3869.3 4139.1 4345.7 4463.4 4474.6 4372.8 4164.1 3866.0 3503.7 3106.3 2701.8 2313.7 1835.5 1026.6 455.4 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2305.0 2304.0 2300.8 2295.6 2288.4 2279.6 2269.7 2259.8 2251.4 2247.2 2251.1 2268.9 2307.9 2377.1 2486.6 2645.6 2861.1 3135.1 3461.9 3827.0 4206.1 4567.0 4873.3 5089.0 5184.9 5143.4 4961.5 4651.7 4239.1 3522.2 2025.6 882.4 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
2401.6 2400.4 2397.0 2391.4 2383.6 2373.7 2362.0 2348.9 2335.4 2322.9 2313.8 2311.9 2322.5 2353.0 2412.5 2511.4 2660.2 2867.5 3137.5 3467.1 3844.2 4246.1 4640.9 4990.4 5255.3 5401.0 5403.7 5254.7 4961.6 4262.8 2527.4 1123.1 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0
')
on conflict (id) do nothing;

insert into public.luminaires (id, brand_id, name, code, family, fitting_type, watts, lumens, cct, cri, ip, ugr, beam, lit_l, lit_w, ies_id, sample, notes, sort)
values
  ('d17c1000-0000-0000-0000-000000000001', null, 'Panel 600×600 – 36 W (sample)', 'SAMPLE-1', 'Panel', 'panel', 36, 4000, 4000, 80, 'IP20', '19', 120, 597, 597, 'd17c0000-0000-0000-0000-000000000001', true, 'Generic sample for DLux – not a real product. Use the manufacturer''s IES file and data sheet for offers.', 1),
  ('d17c1000-0000-0000-0000-000000000002', null, 'Downlight 150 mm – 18 W (sample)', 'SAMPLE-2', 'Downlight', 'downlight', 18, 1800, 4000, 80, 'IP44', '19', 90, 150, 150, 'd17c0000-0000-0000-0000-000000000002', true, 'Generic sample for DLux – not a real product. Use the manufacturer''s IES file and data sheet for offers.', 2),
  ('d17c1000-0000-0000-0000-000000000003', null, 'Linear batten 1200 mm – 36 W (sample)', 'SAMPLE-3', 'Linear / batten', 'batten', 36, 4200, 4000, 80, 'IP20', null, 120, 1200, 50, 'd17c0000-0000-0000-0000-000000000003', true, 'Generic sample for DLux – not a real product. Use the manufacturer''s IES file and data sheet for offers.', 3),
  ('d17c1000-0000-0000-0000-000000000004', null, 'High-bay 150 W – 90° (sample)', 'SAMPLE-4', 'High-bay', 'highbay_med', 150, 22000, 5000, 80, 'IP65', '22', 90, 320, 320, 'd17c0000-0000-0000-0000-000000000004', true, 'Generic sample for DLux – not a real product. Use the manufacturer''s IES file and data sheet for offers.', 4),
  ('d17c1000-0000-0000-0000-000000000005', null, 'Floodlight 200 W – 40° (sample)', 'SAMPLE-5', 'Floodlight', 'downlight_narrow', 200, 26000, 5000, 70, 'IP66', null, 40, 400, 300, 'd17c0000-0000-0000-0000-000000000005', true, 'Generic sample for DLux – not a real product. Use the manufacturer''s IES file and data sheet for offers.', 5),
  ('d17c1000-0000-0000-0000-000000000006', null, 'Street light 100 W – type II (sample)', 'SAMPLE-6', 'Street light', 'panel', 100, 13000, 4000, 70, 'IP66', null, 140, 600, 250, 'd17c0000-0000-0000-0000-000000000006', true, 'Generic sample for DLux – not a real product. Use the manufacturer''s IES file and data sheet for offers.', 6)
on conflict (id) do nothing;
