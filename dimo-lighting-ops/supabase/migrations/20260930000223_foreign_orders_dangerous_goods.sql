-- Foreign orders (TESTING): dangerous goods. Set by Ops on the import order when the PR is created (a Yes / No choice, with the
-- class or UN number), then flagged at every stage: the board, the order, the hand-over, the shipment and every notification.

alter table public.fo_orders add column if not exists dangerous boolean;
alter table public.fo_orders add column if not exists dg_details text;

create or replace function public.fo_set_dangerous(p_order uuid, p_dangerous boolean, p_details text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.fo_orders;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records foreign orders');
  select * into o from public.fo_orders where id = p_order for update;
  perform app.require(found, 'Import order not found');
  perform app.require(p_dangerous is not null, 'Does the order contain dangerous goods? Choose Yes or No');
  perform app.require(not p_dangerous or coalesce(btrim(p_details), '') <> '', 'Dangerous goods: enter the class / UN number and what it is');
  update public.fo_orders set dangerous = p_dangerous, dg_details = case when p_dangerous then btrim(p_details) end, updated_at = now() where id = p_order;
  if p_dangerous and not coalesce(o.dangerous, false) and o.status = 'open' then
    perform app.notify_many(app.role_users('operations_exec', 'sm_projects') || app.fo_followers(o.handover_id), 'foreign_order', 'Dangerous goods on an import order',
      app.fo_order_head(o) || ' · ' || btrim(p_details), 'critical', 'fo_order', o.id, '/orders/foreign/' || o.id);
  end if;
end $$;
grant execute on function public.fo_set_dangerous(uuid, boolean, text) to authenticated;

-- Every notification about the order carries the flag
create or replace function app.fo_order_head(o public.fo_orders) returns text
language sql stable security definer set search_path = public as $$
  select concat_ws(' · ', case when (select dangerous from public.fo_orders where id = o.id) then '⚠ DANGEROUS GOODS' end,
                   o.code, o.title, (select project_name from public.fo_handovers where id = o.handover_id))
$$;
