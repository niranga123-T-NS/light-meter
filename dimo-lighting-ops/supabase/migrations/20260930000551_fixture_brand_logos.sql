-- Brand logos for the catalog: a small image (data URL) on the brand row, uploaded in the catalog supervisor mode (DGM and SM Estimation).
-- Brands without one show their initials. The write policy of fixture_brands already limits changes to the supervisors.
alter table public.fixture_brands add column if not exists logo text;
alter table public.fixture_brands drop constraint if exists fixture_brands_logo_size;
alter table public.fixture_brands add constraint fixture_brands_logo_size check (logo is null or (logo like 'data:image/%' and length(logo) < 400000));
