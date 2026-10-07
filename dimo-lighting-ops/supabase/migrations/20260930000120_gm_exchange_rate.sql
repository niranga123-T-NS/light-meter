-- The GM / DGM sets the monthly USD → LKR exchange rate (as well as the System Administrator).
drop policy if exists rates_write on public.exchange_rates;
create policy rates_write on public.exchange_rates for all to authenticated
  using (app.has_role('sys_admin', 'gm')) with check (app.has_role('sys_admin', 'gm'));
