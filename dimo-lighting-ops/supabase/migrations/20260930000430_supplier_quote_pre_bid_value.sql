-- Supplier quotes: savings against Pre Bid. A package's Post Bid prices are measured against the value our bid was built on:
-- the supplier chosen at Pre Bid (packages that went through the system), else a Pre Bid value entered for packages started at Post Bid
-- (jobs tendered before the system), else the lowest Pre Bid quote. "Our quotation valid until" only matters at Pre Bid.
alter table public.sq_packages add column if not exists pre_bid_value numeric(16, 2) check (pre_bid_value is null or pre_bid_value >= 0);
alter table public.sq_packages add column if not exists pre_bid_note text;
