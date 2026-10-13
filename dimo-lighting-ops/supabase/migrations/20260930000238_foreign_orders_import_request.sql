-- Foreign orders (TESTING): "hand-over" is called "import request" (the Estimation Manager's PI and costing that Ops splits
-- into import orders). New codes start with IR-; existing HO- codes stay. Step label, messages and notifications follow.

update public.fo_step_defs set label = 'Import request received (PI + costing)' where key = 'ho_received';

do $$
declare r record; def text;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname in ('public', 'app') and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
              and (p.prosrc ~* 'hand-over' or p.prosrc like '%next_code(''HO'')%') and p.proname ~ '^fo_' loop
    def := pg_get_functiondef(r.fn);
    def := replace(replace(replace(replace(def, 'Hand-overs', 'Import requests'), 'hand-overs', 'import requests'), 'Hand-over', 'Import request'), 'hand-over', 'import request');
    def := replace(def, 'next_code(''HO'')', 'next_code(''IR'')');
    execute def;
    raise notice 'renamed in %', r.fn;
  end loop;
end $$;

select app.fix_function_owners();
