-- Earlier award from an inquiry in the system: the value went into the order book twice. Marking the project won adds the order-book
-- entry with the won inquiries' value (projects_won_secured), and the award then added the inquiry's value to that entry again.
-- Now the entry made by the project win is used as it is; an entry the project had before still gets the inquiry added.
-- The entries already doubled are put right (the project-win and inquiry-win lines logged in the same transaction).
create or replace function pg_temp.fn_rep(p_src text, p_a text, p_b text, p_n int) returns text language plpgsql as $f$
declare n int := (length(p_src) - length(replace(p_src, p_a, ''))) / length(p_a);
begin
  if n <> p_n then raise exception 'earlier award value: expected % × "%", found %', p_n, p_a, n; end if;
  return replace(p_src, p_a, p_b);
end $f$;

do $$
declare src text;
begin
  src := pg_get_functiondef('public.send_earlier_award(jsonb)'::regprocedure);
  src := pg_temp.fn_rep(src, 'rid uuid; sid uuid;', 'rid uuid; sid uuid; pre uuid;', 1);
  src := pg_temp.fn_rep(src, 'perform app.require(nm is not null and cust is not null, ''Enter the project name and the customer'');',
    'perform app.require(nm is not null and cust is not null, ''Enter the project name and the customer'');
  -- the order-book entry of the inquiry''s project before this award (another inquiry of it won earlier)
  if i.id is not null then select id into pre from public.secured_projects where project_id = i.project_id; end if;', 1);
  src := pg_temp.fn_rep(src, '      sid := app.secure_inquiry_win(i.id);',
    '      select id into sid from public.secured_projects where project_id = i.project_id;
      -- made just now by the project win, with this inquiry''s value in it: not added again
      if sid is null or sid is not distinct from pre then sid := app.secure_inquiry_win(i.id); end if;', 1);
  execute src;
end $$;

-- put right the entries already doubled
do $$
declare r record;
begin
  for r in
    select s.id, s.order_value, l.id as log_id, l.note, round(app.to_lkr(i.order_value, i.currency, i.order_date), 2) as v
    from public.secured_projects s
    join public.secured_log l on l.secured_id = s.id and l.action = 'won' and l.note like 'Inquiry % won%'
    join public.secured_log w on w.secured_id = s.id and w.action = 'won' and w.note like 'Project won%' and w.at = l.at
    join public.inquiries i on i.project_id = s.project_id and l.note like 'Inquiry ' || i.code || ' won%'
    where i.order_value is not null
  loop
    update public.secured_projects set order_value = order_value - r.v where id = r.id;
    delete from public.secured_log where id = r.log_id;
    insert into public.secured_log (secured_id, action, note)
    values (r.id, 'corrected', 'Order value corrected – the earlier award had counted the inquiry twice · ' || app.fmt_money(r.v, 'LKR') || ' taken off');
  end loop;
end $$;
