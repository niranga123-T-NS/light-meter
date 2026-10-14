-- Clean-up fix: the hosted database does not allow pausing triggers with session_replication_role. Instead every trigger
-- function on the app's tables steps aside while a clean-up runs (app.purging = 'on', set only inside admin_purge's
-- transaction): its first statement returns at once. Foreign keys are still checked by the database. A trigger function
-- recreated by a later migration loses the guard; admin_purge adds it back before it runs (app.purge_guard_triggers).

create or replace function app.purge_guard_triggers() returns int
language plpgsql security definer set search_path = public as $$
declare f record; def text; body text; n int := 0;
  guard text := E'\n  if current_setting(''app.purging'', true) = ''on'' then return coalesce(new, old); end if; -- clean-up\n';
begin
  for f in
    select distinct p.oid, p.prosrc
      from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_language l on l.oid = p.prolang
      join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = p.pronamespace
     where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and l.lanname = 'plpgsql'
       and s.nspname in ('public', 'app') and p.prosrc not like '%app.purging%'
  loop
    begin
      def := pg_get_functiondef(f.oid);
      body := regexp_replace(f.prosrc, '\mbegin\M', 'begin' || guard, 'i');
      execute replace(def, f.prosrc, body);
      n := n + 1;
    exception when others then
      raise notice 'clean-up guard not added to %: %', f.oid::regproc, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke execute on function app.purge_guard_triggers() from public, anon, authenticated;

create or replace function app.purge_target(p_kind text, p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare root regclass; w text; ids uuid[]; r jsonb; t text;
begin
  case p_kind
    when 'project' then root := 'public.projects';
    when 'inquiry' then root := 'public.inquiries';
    when 'secured' then root := 'public.secured_projects';
    when 'exec' then root := 'public.exec_projects';
    when 'invoice' then root := 'public.invoice_allocations';
    when 'sub_invoice' then root := 'public.sub_invoices';
    when 'lo_invoice' then root := 'public.lo_invoices';
    when 'user' then root := 'public.profiles';
    else raise exception 'Unknown kind %', p_kind;
  end case;
  w := case when p_kind = 'invoice' then format('id = %s', p_id::bigint) else format('id = %L::uuid', p_id) end;
  if to_regclass('pg_temp._purge_counts') is null then
    create temp table _purge_counts (tbl text, n bigint) on commit drop;
    create temp table _purge_ids (id uuid) on commit drop;
    create temp table _purge_files (path text) on commit drop;
    create temp table _purge_labels (kind text, label text) on commit drop;
  end if;
  truncate _purge_counts, _purge_ids, _purge_files, _purge_labels;
  perform app.purge_guard_triggers();
  -- the workflow rules, totals and audit triggers step aside in this transaction only
  perform set_config('app.purging', 'on', true);
  perform app.purge_rows(root, w);
  -- the alerts, approvals, attachments, clocks and history of everything deleted (repeated: an attachment's own alerts)
  for i in 1..3 loop
    ids := array(select distinct id from _purge_ids);
    truncate _purge_ids;
    exit when cardinality(ids) = 0;
    foreach t in array array['attachments', 'approvals', 'notifications', 'sla_clocks', 'status_history', 'due_date_changes'] loop
      perform app.purge_rows(('public.' || t)::regclass, format('entity_id = any(%L::uuid[])', ids));
    end loop;
  end loop;
  perform set_config('app.purging', 'off', true);
  select jsonb_build_object(
    'counts', coalesce((select jsonb_agg(jsonb_build_object('table', c.tbl, 'rows', c.s) order by c.s desc) from (select x.tbl, sum(x.n) s from _purge_counts x group by x.tbl) c), '[]'),
    'labels', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'label', l.label)) from (select distinct y.kind, y.label from _purge_labels y) l), '[]'),
    'files', coalesce((select jsonb_agg(path) from _purge_files), '[]'),
    'total', coalesce((select sum(n) from _purge_counts), 0))
  into r;
  return r;
end $$;
revoke execute on function app.purge_target(text, text) from public, anon, authenticated;

select app.purge_guard_triggers();
select app.fix_function_owners();
