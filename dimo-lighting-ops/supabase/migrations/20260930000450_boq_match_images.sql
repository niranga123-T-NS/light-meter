-- BOQ match: the client's pictures of the lines (small JPEG thumbnails by sheet row), read from the Excel or PDF BOQ
alter table public.boq_matches add column if not exists images jsonb not null default '{}'::jsonb;
