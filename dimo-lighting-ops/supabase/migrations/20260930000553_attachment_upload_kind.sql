-- PI and costing files could not be attached to a supply order ("new row violates row-level security policy"): the file store asks
-- app.can_write_attachment without the kind of file (null), and the supply PI rule allowed only the PI and costing kinds, so null was
-- refused. The foreign- and local-order notes had the same gap. The kind is still checked when the attachment row is written.
create or replace function pg_temp.fn_rep(p_src text, p_a text, p_b text, p_n int) returns text language plpgsql as $f$
declare n int := (length(p_src) - length(replace(p_src, p_a, ''))) / length(p_a);
begin
  if n <> p_n then raise exception 'attachment kind: expected % × "%", found %', p_n, p_a, n; end if;
  return replace(p_src, p_a, p_b);
end $f$;

do $$
declare src text;
begin
  src := pg_get_functiondef('app.can_write_attachment(text, uuid, text)'::regprocedure);
  src := pg_temp.fn_rep(src, 'when ''supply_pi'' then return p_kind in (''supply_pi'', ''supply_costing'') and', 'when ''supply_pi'' then return coalesce(p_kind in (''supply_pi'', ''supply_costing''), true) and', 1);
  src := pg_temp.fn_rep(src, 'when ''fo_note'' then return p_kind = ''fo_reference'' and', 'when ''fo_note'' then return coalesce(p_kind = ''fo_reference'', true) and', 1);
  src := pg_temp.fn_rep(src, 'when ''lo_note'' then return p_kind = ''lo_reference'' and', 'when ''lo_note'' then return coalesce(p_kind = ''lo_reference'', true) and', 1);
  execute src;
end $$;
