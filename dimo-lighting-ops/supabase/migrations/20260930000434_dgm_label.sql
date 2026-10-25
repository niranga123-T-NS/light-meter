-- "GM / DGM" is now "DGM" everywhere: in every message, notification and check the database functions give, and in the
-- setting descriptions. The functions are re-created from their own definitions with only the wording changed.
do $$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'app') and p.prokind in ('f', 'p') and p.prosrc ~ '(GM ?/ ?DGM|DGM ?/ ?GM)' loop
    execute regexp_replace(pg_get_functiondef(r.oid), '(GM ?/ ?DGM|DGM ?/ ?GM)', 'DGM', 'g');
  end loop;
end $$;
update public.settings set description = regexp_replace(description, '(GM ?/ ?DGM|DGM ?/ ?GM)', 'DGM', 'g') where description ~ '(GM ?/ ?DGM|DGM ?/ ?GM)';
