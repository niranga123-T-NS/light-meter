-- Catalog brands: country of origin (one) and countries of manufacturing (one or several) replace the single category
-- (European / China / Local / Other). E.g. origin Europe, manufactured in China and India.
-- Values are country names (Europe, China, India, Singapore, Australia, Sri Lanka) or any other country typed in.

alter table public.fixture_brands add column if not exists origin text;
alter table public.fixture_brands add column if not exists made_in text[] not null default '{}';

-- From the old category: European → origin Europe; China → origin and manufacturing China; Local → Sri Lanka
update public.fixture_brands
set origin = case region when 'european' then 'Europe' when 'china' then 'China' when 'local' then 'Sri Lanka' end,
    made_in = case region when 'china' then array['China'] when 'local' then array['Sri Lanka'] else '{}' end
where origin is null and region is not null;
