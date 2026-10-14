-- Site requests (under Foreign & local orders): the stage each request's supplier orders have reached, for the list –
-- the stage after the last one with a step done (local orders: 7 stages, import orders: 9).

create or replace function public.mr_order_stage(p_ids uuid[])
returns table (mr_id uuid, module text, order_id uuid, code text, stage int, stages int, delivered boolean)
language sql stable security definer set search_path = public as $$
  select m.id, o.module, o.order_id, o.code,
         case when o.delivered then s.n
              else least(coalesce(case o.module
                when 'lo' then (select max(d.stage) from public.lo_steps x join public.lo_step_defs d on d.key = x.step
                                 where x.request_id = o.request_id and (x.order_id = o.order_id or x.order_id is null))
                else (select max(d.stage) from public.fo_steps x join public.fo_step_defs d on d.key = x.step
                       where x.handover_id = o.request_id and (x.order_id = o.order_id or x.order_id is null)) end, 0) + 1, s.n) end,
         s.n, o.delivered
    from public.material_requests m
    cross join lateral app.mr_orders(m.id) o
    cross join lateral (select case o.module when 'lo' then 7 else 9 end as n) s
   where m.id = any(p_ids) and auth.uid() is not null
$$;
grant execute on function public.mr_order_stage(uuid[]) to authenticated;

select app.fix_function_owners();
