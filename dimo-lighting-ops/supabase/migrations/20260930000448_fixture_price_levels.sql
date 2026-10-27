-- Price levels (Budget, Mid, Upper Mid, High, Top): a brand's level is the default for its products; a product can have its own.
-- When the brand level changes, the supervisor decides whether the products with their own level change too; the result is kept for highlighting.

alter table public.fixture_brands alter column region drop not null;
alter table public.fixture_brands add column price_level text check (price_level in ('budget', 'mid', 'upper_mid', 'high', 'top'));

alter table public.fixture_edits
  add column price_level text check (price_level in ('budget', 'mid', 'upper_mid', 'high', 'top')),
  -- after a brand level change: 'changed' = the product's own level was replaced by the brand level, 'kept' = it stayed
  add column level_review text check (level_review in ('changed', 'kept')),
  add column level_prev text,
  add column level_review_at timestamptz;
