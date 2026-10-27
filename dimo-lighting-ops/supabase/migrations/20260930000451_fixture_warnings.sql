-- Warnings on brands and products (catalog supervisor mode: DGM and SM Estimation), shown to everyone as small blinking tags
-- e.g. MOQ, Not suitable for coastal areas, or a custom text; a product shows its brand's warnings and its own
alter table public.fixture_brands add column if not exists warnings jsonb not null default '[]'::jsonb;
alter table public.fixture_edits add column if not exists warnings jsonb not null default '[]'::jsonb;
