-- Functions created by recent deploys can belong to the deploy tool's temporary login role instead of postgres. A
-- security-definer function runs as its owner, so such a function fails with "permission denied for schema app".
-- app.fix_function_owners() gives every function in public / app that is not owned by postgres (or a Supabase system role)
-- back to postgres; migrations that create functions call it at the end.
create or replace function app.fix_function_owners() returns int
language plpgsql as $$
declare r record; n int := 0;
begin
  for r in select p.oid::regprocedure as fn, pg_get_userbyid(p.proowner) as owner
             from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname in ('public', 'app') and pg_get_userbyid(p.proowner) <> 'postgres'
              and pg_get_userbyid(p.proowner) not like 'supabase%' and pg_get_userbyid(p.proowner) not like 'pg\_%'
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    raise notice 'owner of % was %', r.fn, r.owner;
    execute format('alter function %s owner to postgres', r.fn);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function app.fix_function_owners() from public, anon, authenticated;

select app.fix_function_owners();
