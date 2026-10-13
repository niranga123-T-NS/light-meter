-- Foreign orders (TESTING): the flight and vessel check functions report where an error happened (role and context), so a
-- failure shows its cause on the GitHub run page (messages raised on purpose, e.g. Not allowed, stay as they are).
do $$
declare f text; def text;
begin
  foreach f in array array['public.fo_flights_due(text)', 'public.fo_flight_ingest(text, jsonb)', 'public.fo_vessels_due(text)', 'public.fo_vessel_ingest(text, jsonb)'] loop
    def := pg_get_functiondef(f::regprocedure);
    perform app.require(def ~ '\ndeclare ' and def ~ 'end\s*\$function\$\s*$', f || ': layout not found');
    def := regexp_replace(def, '\ndeclare ', E'\ndeclare diag_ctx text; ');
    def := regexp_replace(def, 'end\s*\$function\$\s*$',
      E'exception when others then\n  if sqlstate = ''P0001'' then raise; end if;\n  get stacked diagnostics diag_ctx = pg_exception_context;\n'
      || E'  raise exception ''% [role %, %]'', sqlerrm, current_user, left(replace(diag_ctx, E''\\n'', '' / ''), 400) using errcode = sqlstate;\nend\n$function$');
    execute def;
  end loop;
end $$;
