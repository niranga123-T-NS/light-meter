-- Foreign orders (TESTING): duty-free orders – after the goods are delivered, the final original CUSDEC is delivered to the
-- client. An order now closes when every step that applies to it is done (not at delivery).

insert into public.fo_step_defs (key, scope, stage, seq, label, node, conds, after, ref_label) values
  ('cusdec_to_client', 'o', 9, 92, 'Final original CUSDEC delivered to the client', 'Operations · Sales', '{material,duty_free}', '{delivered}', 'CUSDEC no.')
on conflict (key) do nothing;

-- Every required step of the order (and the hand-over steps before it) is done
create or replace function app.fo_order_complete(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.fo_orders o join public.fo_handovers h on h.id = o.handover_id
      join public.fo_step_defs d on d.scope = 'o' and not d.optional and app.fo_applies(d.conds, o, h)
     where o.id = p_order and not exists (select 1 from public.fo_steps s where s.order_id = o.id and s.step = d.key))
$$;

do $$
declare def text;
begin
  -- recording: delivery no longer closes the order by itself; the last required step does
  def := pg_get_functiondef('public.fo_record_step(uuid, uuid, text, date, text, text)'::regprocedure);
  perform app.require(position('    update public.fo_orders set status = ''delivered'', updated_at = now() where id = p_order;' in def) > 0, 'record anchor 1');
  def := replace(def, '    update public.fo_orders set status = ''delivered'', updated_at = now() where id = p_order;' || chr(10), '');
  perform app.require(position('    perform public.fo_close_if_done(h.id);' || chr(10) || '  end if;' || chr(10) || '  return sid;' in def) > 0, 'record anchor 2');
  def := replace(def, '    perform public.fo_close_if_done(h.id);' || chr(10) || '  end if;' || chr(10) || '  return sid;',
    '  elsif p_step = ''cusdec_to_client'' then' || chr(10) ||
    '    perform app.notify_many(app.fo_followers(h.id), ''foreign_order'', ''Original CUSDEC delivered to the client'', head || coalesce('' · CUSDEC '' || ref, ''''), ''normal'', ''fo_order'', o.id, ''/orders/foreign/'' || o.id);' || chr(10) ||
    '  end if;' || chr(10) ||
    '  -- the order closes when every step that applies to it is done' || chr(10) ||
    '  if p_order is not null and app.fo_order_complete(p_order) then' || chr(10) ||
    '    update public.fo_orders set status = ''delivered'', updated_at = now() where id = p_order and status = ''open'';' || chr(10) ||
    '    perform public.fo_close_if_done(h.id);' || chr(10) ||
    '  end if;' || chr(10) || '  return sid;');
  execute def;
  -- clearing any step of a closed order opens it again
  def := pg_get_functiondef('public.fo_clear_step(uuid)'::regprocedure);
  perform app.require(position('if s.step = ''delivered'' then' in def) > 0, 'clear anchor');
  def := replace(def, 'if s.step = ''delivered'' then', 'if o.status = ''delivered'' then');
  execute def;
end $$;
