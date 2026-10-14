-- Clean-up for the GM / DGM: delete test (dummy) projects, inquiries, secured and execution projects, invoices and users
-- for good, with everything that
-- hangs off them, so they leave every list (sales, design, estimation, execution, finance, orders, approvals, alerts).
--  * One engine follows the database's own links from the record being deleted. A row that cannot exist without it (a
--    required link) is deleted, and the rows hanging off that row too. A row that only optionally points at it keeps
--    living with the link cleared (unless the link is declared to delete with it, or clearing it would repeat another row)
--    – except anything pointing at a project, inquiry, secured or execution project, which
--    belongs to that project and goes with it.
--  * Attachments, approvals, alerts, SLA clocks, status history and date changes of the deleted rows go too; the files of
--    the attachments are returned so the server removes them from storage.
--  * A user: their optional links are cleared and everything that needs them (what they created, own or are a member of)
--    is deleted; then the login is removed. GM / DGM and System Administrator logins cannot be deleted here.
--  * The workflow rules and the audit triggers are paused inside the clean-up transaction only; the engine does the
--    deletes and link clearing itself.
--  * admin_purge(kind, id, false) is a preview: it does the whole delete, reports what it took and rolls it back.
--    admin_purge(kind, id, true) deletes and writes the clean-up log.

create sequence if not exists app.purge_seq;

create table if not exists public.purge_log (
  id bigint generated always as identity primary key,
  kind text not null,
  target text not null,
  label text,
  counts jsonb not null,
  files int not null default 0,
  done_by uuid references public.profiles (id) on delete set null,
  done_at timestamptz not null default now()
);
alter table public.purge_log enable row level security;
drop policy if exists purge_log_read on public.purge_log;
create policy purge_log_read on public.purge_log for select to authenticated using (app.has_role('gm', 'sys_admin'));
grant select on public.purge_log to authenticated;

-- records that are never deleted (archived instead) can be deleted by the clean-up only
create or replace function app.prevent_delete() returns trigger
language plpgsql as $$
begin
  if current_setting('app.purging', true) = 'on' then return old; end if;
  raise exception '% records cannot be deleted; archive them instead', tg_table_name;
end $$;

/** Deletes the rows of p_tbl matching p_where and, first, every row that needs them */
create or replace function app.purge_rows(p_tbl regclass, p_where text, p_depth int default 0) returns void
language plpgsql security definer set search_path = public as $$
declare
  d text := '_purge_' || nextval('app.purge_seq');
  rel text := (select relname from pg_class where oid = p_tbl);
  roots text[] := array['projects', 'inquiries', 'exec_projects', 'secured_projects'];
  fk record; ccols text; pcols text; nulls text; cond text; pk text; n bigint; required boolean;
begin
  if p_depth > 30 then raise exception 'Clean-up went too deep at %', rel; end if;
  execute format('create temp table %I on commit drop as select * from %s where %s', d, p_tbl, p_where);
  get diagnostics n = row_count;
  if n = 0 then
    execute format('drop table %I', d);
    return;
  end if;
  for fk in
    select c.conrelid::regclass as child, c.conkey, c.confkey, c.conrelid = c.confrelid as self, c.confdeltype as rule
      from pg_constraint c where c.contype = 'f' and c.confrelid = p_tbl and c.connamespace = 'public'::regnamespace
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.i), string_agg(format('%I = null', a.attname), ', '), bool_or(a.attnotnull)
      into ccols, nulls, required
      from unnest(fk.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = fk.child and a.attnum = k.n;
    select string_agg(quote_ident(a.attname), ', ' order by k.i) into pcols
      from unnest(fk.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = p_tbl and a.attnum = k.n;
    cond := format('(%s) in (select %s from %I)', ccols, pcols, d);
    if required or fk.rule = 'c' or (not fk.self and rel = any(roots)) then
      perform app.purge_rows(fk.child, cond, p_depth + 1);
    else
      begin
        execute format('update %s set %s where %s', fk.child, nulls, cond);
      exception when unique_violation then
        -- cleared, it would repeat another row: it was only meaningful with the deleted row
        perform app.purge_rows(fk.child, cond, p_depth + 1);
      end;
    end if;
  end loop;
  -- what else to clear: the ids (for attachments, alerts, approvals …), the files, names for the preview
  if exists (select 1 from pg_attribute where attrelid = p_tbl and attname = 'id' and atttypid = 'uuid'::regtype and not attisdropped) then
    execute format('insert into _purge_ids select id from %I', d);
  end if;
  if rel = 'attachments' then execute format('insert into _purge_files select storage_path from %I', d); end if;
  if rel = any(roots || array['profiles']) then
    execute format($q$insert into _purge_labels select %L, coalesce(nullif(concat_ws(' – ', j->>'code', coalesce(j->>'name', j->>'project_name', j->>'full_name')), ''), j->>'id') from (select to_jsonb(x) j from %I x) s$q$, rel, d);
  end if;
  select string_agg(format('%I', a.attname), ', ' order by k.i) into pk
    from pg_constraint c, unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = p_tbl and a.attnum = k.n
   where c.conrelid = p_tbl and c.contype = 'p';
  execute format('delete from %s where (%s) in (select %s from %I)', p_tbl, pk, pk, d);
  get diagnostics n = row_count;
  insert into _purge_counts (tbl, n) values (rel, n);
  execute format('drop table %I', d);
end $$;

/** Deletes one record and all that hangs off it; returns what went (table → rows), the names and the files */
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
  perform set_config('app.purging', 'on', true);
  -- the workflow rules (submitted records cannot change, totals, audit …) do not apply to a clean-up: the engine itself
  -- deletes or clears every link, in this transaction only
  perform set_config('session_replication_role', 'replica', true);
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
  perform set_config('session_replication_role', 'origin', true);
  perform set_config('app.purging', 'off', true);
  select jsonb_build_object(
    'counts', coalesce((select jsonb_agg(jsonb_build_object('table', c.tbl, 'rows', c.s) order by c.s desc) from (select x.tbl, sum(x.n) s from _purge_counts x group by x.tbl) c), '[]'),
    'labels', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'label', l.label)) from (select distinct y.kind, y.label from _purge_labels y) l), '[]'),
    'files', coalesce((select jsonb_agg(path) from _purge_files), '[]'),
    'total', coalesce((select sum(n) from _purge_counts), 0))
  into r;
  return r;
end $$;

/** GM / DGM: preview (p_confirm false – nothing is changed) or delete a test project, inquiry, invoice or user */
create or replace function public.admin_purge(p_kind text, p_id text, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; p public.profiles; lbl text;
begin
  perform app.require(app.has_role('gm'), 'Only the GM / DGM can delete records');
  if p_kind = 'user' then
    select * into p from public.profiles where id = p_id::uuid;
    perform app.require(found, 'User not found');
    perform app.require(p.id <> auth.uid(), 'You cannot delete your own login');
    perform app.require(p.role::text not in ('gm', 'sys_admin'), 'GM / DGM and System Administrator logins cannot be deleted here – change the role first');
  end if;
  if not p_confirm then
    begin
      r := app.purge_target(p_kind, p_id);
      raise exception using errcode = 'P0099', message = 'preview';
    exception when sqlstate 'P0099' then
      return r - 'files' || jsonb_build_object('files', jsonb_array_length(r->'files'), 'preview', true);
    end;
  end if;
  r := app.purge_target(p_kind, p_id);
  perform app.require((r->>'total')::bigint > 0, 'Nothing found to delete');
  lbl := coalesce((select string_agg(x->>'label', ', ') from jsonb_array_elements(r->'labels') x
                    where x->>'kind' = case p_kind when 'project' then 'projects' when 'inquiry' then 'inquiries' when 'secured' then 'secured_projects' when 'exec' then 'exec_projects' when 'user' then 'profiles' else '' end), p_kind || ' ' || p_id);
  insert into public.purge_log (kind, target, label, counts, files, done_by)
  values (p_kind, p_id, left(lbl, 500), r->'counts', jsonb_array_length(r->'files'), auth.uid());
  return r;
end $$;
revoke execute on function public.admin_purge(text, text, boolean) from public, anon;
grant execute on function public.admin_purge(text, text, boolean) to authenticated;
revoke execute on function app.purge_rows(regclass, text, int), app.purge_target(text, text) from public, anon, authenticated;

select app.fix_function_owners();
