-- Foreign orders (TESTING) – adjustments after the first use:
--  * Optional steps: internal steps of other teams that Ops sees only sometimes (the TT / LC application from Procurement to
--    Finance, and Logistics' duty payment). Ops records them when known; they never hold up the next step, and the next step is
--    timed from the step before them. Ops can mark other steps optional (or not) in the SLA settings.
--  * Inland transport to the port applies to FOB orders only.

alter table public.fo_step_defs add column if not exists optional boolean not null default false;
update public.fo_step_defs set optional = true where key in ('pay_applied', 'duty_paid');

-- Inland transport only on FOB material orders
create or replace function app.fo_orders_inland() returns trigger
language plpgsql as $$
begin
  new.inland := new.inland and new.kind = 'material' and new.incoterm = 'FOB';
  return new;
end $$;
drop trigger if exists fo_orders_inland on public.fo_orders;
create trigger fo_orders_inland before insert or update on public.fo_orders for each row execute function app.fo_orders_inland();
update public.fo_orders set inland = false where inland and not (kind = 'material' and incoterm = 'FOB');

-- The steps a step really follows: an optional step that is not done is replaced by the steps it follows (again and again)
create or replace function app.fo_effective_after(p_handover uuid, p_order uuid, p_step text) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare todo text[] := coalesce((select after from public.fo_step_defs where key = p_step), '{}'); out text[] := '{}'; k text; a public.fo_step_defs; n int := 0;
begin
  while cardinality(todo) > 0 and n < 100 loop
    n := n + 1;
    k := todo[1];
    todo := todo[2:];
    select * into a from public.fo_step_defs where key = k;
    continue when a.key is null or k = any (out);
    if a.optional and not exists (select 1 from public.fo_steps where handover_id = p_handover and step = k
                                    and (case when a.scope = 'h' then order_id is null else order_id = p_order end)) then
      todo := todo || a.after;
    else
      out := out || k;
    end if;
  end loop;
  return out;
end $$;

create or replace function app.fo_step_start(p_handover uuid, p_order uuid, p_step text) returns date
language sql stable security definer set search_path = public as $$
  select max(s.done_on) from public.fo_steps s
   where s.handover_id = p_handover and s.step = any (app.fo_effective_after(p_handover, p_order, p_step))
     and (s.order_id is null or (p_order is null and exists (select 1 from public.fo_orders o where o.id = s.order_id and o.status <> 'cancelled'))
          or s.order_id = p_order)
$$;

create or replace function app.fo_missing_before(p_handover uuid, p_order uuid, p_step text) returns text
language plpgsql stable security definer set search_path = public as $$
declare h public.fo_handovers; o public.fo_orders; a public.fo_step_defs;
begin
  select * into h from public.fo_handovers where id = p_handover;
  if p_order is not null then select * into o from public.fo_orders where id = p_order; end if;
  for a in select * from public.fo_step_defs where key = any (app.fo_effective_after(p_handover, p_order, p_step)) order by seq loop
    if a.scope = 'h' then
      if app.fo_h_applies(a.conds, h) and not exists (select 1 from public.fo_steps where handover_id = p_handover and order_id is null and step = a.key) then
        return a.label;
      end if;
    elsif p_order is not null then
      if app.fo_applies(a.conds, o, h) and not exists (select 1 from public.fo_steps where order_id = p_order and step = a.key) then
        return a.label;
      end if;
    else
      if exists (select 1 from public.fo_orders x where x.handover_id = p_handover and x.status <> 'cancelled' and app.fo_applies(a.conds, x, h)
                   and not exists (select 1 from public.fo_steps where order_id = x.id and step = a.key)) then
        return a.label || ' (all import orders)';
      end if;
    end if;
  end loop;
  return null;
end $$;

-- Ops marks a step optional (or not)
create or replace function public.fo_set_optional(p_step text, p_optional boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fo_keeper() or app.has_role('sys_admin'), 'The Operations Executive sets this');
  perform app.require(p_step not in ('ho_received', 'delivered'), 'This step is always needed');
  update public.fo_step_defs set optional = coalesce(p_optional, false), sla_by = auth.uid(), sla_at = now() where key = p_step;
  perform app.require(found, 'Unknown step');
end $$;
grant execute on function public.fo_set_optional(text, boolean) to authenticated;

-- The daily check never flags an optional step as late
do $$
declare def text;
begin
  def := pg_get_functiondef('public.fo_tick(timestamptz)'::regprocedure);
  perform app.require(position('for d in select * from public.fo_step_defs where sla_days is not null order by seq loop' in def) > 0, 'fo_tick anchor not found');
  def := replace(def, 'for d in select * from public.fo_step_defs where sla_days is not null order by seq loop',
                      'for d in select * from public.fo_step_defs where sla_days is not null and not optional order by seq loop');
  execute def;
end $$;
