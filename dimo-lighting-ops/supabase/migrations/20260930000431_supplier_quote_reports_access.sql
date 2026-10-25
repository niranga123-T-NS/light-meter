-- Supplier quotes:
--  * Fewer than three suppliers quoting at the package's stage: the reason for the limited competition is required before choosing.
--  * The supplier reports (and the project, package, item and supplier analyses) are open, read only, to the GM / DGM, the SM Estimation
--    and the people the GM / DGM allows for the reports (e.g. two estimators). Editing quotes stays with Operations, the GM / DGM and
--    the people allowed into supplier quotes.

alter table public.sq_packages add column if not exists few_quotes_reason text;
alter table public.sq_access_grants add column if not exists reports_only boolean not null default false;

-- full access: Operations, GM / DGM and people allowed into supplier quotes (not the report readers)
create or replace function app.sq_can() returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('operations_exec', 'gm')
      or exists (select 1 from public.sq_access_grants g join public.profiles p on p.id = g.user_id
                 where g.user_id = auth.uid() and g.cancelled_at is null and not g.reports_only and p.active and p.role <> 'guest')
$$;

-- the reports: GM / DGM, SM Estimation and the people allowed for the reports
create or replace function app.sq_reports_can() returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('gm', 'sm_estimation')
      or exists (select 1 from public.sq_access_grants g join public.profiles p on p.id = g.user_id
                 where g.user_id = auth.uid() and g.cancelled_at is null and g.reports_only and p.active and p.role <> 'guest')
$$;

create or replace function app.sq_read() returns boolean
language sql stable security definer set search_path = public as $$ select app.sq_can() or app.sq_reports_can() $$;

create or replace function public.sq_reports_me() returns boolean
language sql stable security definer set search_path = public as $$ select app.sq_reports_can() $$;
grant execute on function public.sq_reports_me() to authenticated;

-- report readers read every supplier-quote table
do $$
declare t text;
begin
  foreach t in array array['sq_settings', 'sq_suppliers', 'sq_items', 'sq_item_aliases', 'sq_packages', 'sq_quotes', 'sq_quote_lines', 'sq_quote_payments', 'sq_quote_exclusions', 'sq_projects', 'sq_package_invites'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.sq_read())', t || '_read', t);
  end loop;
end $$;

-- The GM / DGM allows a person into supplier quotes, or only into the reports (read only)
drop function if exists public.sq_grant(uuid, text);
create or replace function public.sq_grant(p_user uuid, p_reason text, p_reports_only boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; r public.app_role;
begin
  perform app.require(app.has_role('gm'), 'Only the GM / DGM can allow access to supplier quotes');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  select role into r from public.profiles where id = p_user and active;
  perform app.require(r is not null, 'Person not found');
  perform app.require(r not in ('guest', 'sub_supervisor'), 'Supplier prices cannot be shown to this person');
  perform app.require(r not in ('operations_exec', 'gm') and not (p_reports_only and r = 'sm_estimation'), 'This person already sees supplier quotes');
  perform app.require(not exists (select 1 from public.sq_access_grants where user_id = p_user and cancelled_at is null), 'This person already has access');
  insert into public.sq_access_grants (user_id, reason, reports_only) values (p_user, btrim(p_reason), coalesce(p_reports_only, false)) returning id into v;
  perform app.notify(p_user, 'sq_access', case when p_reports_only then 'Supplier reports: access given' else 'Supplier quotes: access given' end,
    case when p_reports_only
      then 'The GM / DGM has given you access to the supplier reports (read only). Reason: ' || btrim(p_reason)
      else 'The GM / DGM has given you access to Supplier quotes – you can add, edit and compare supplier and subcontractor quotes. Reason: ' || btrim(p_reason) end,
    'normal', 'sq_access', v, case when p_reports_only then '/supplier-quotes/reports' else '/supplier-quotes' end, 'sq_access_' || v);
  return v;
end $$;
grant execute on function public.sq_grant(uuid, text, boolean) to authenticated;

-- Choosing: reason always; with fewer than three suppliers quoting at the stage, the reason for that too
drop function if exists public.sq_select(uuid, uuid, text);
create or replace function public.sq_select(p_package uuid, p_quote uuid, p_reason text default null, p_few_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare n int; st text;
begin
  perform app.require(app.sq_can(), 'No access to supplier quotes');
  if p_quote is not null then
    perform app.require(exists (select 1 from public.sq_quotes where id = p_quote and package_id = p_package), 'That quote is not in this package');
    perform app.require(exists (select 1 from public.sq_quotes where id = p_quote and superseded_by is null), 'Choose the supplier''s latest version');
    perform app.require(exists (select 1 from public.sq_quotes q join public.sq_packages p on p.id = q.package_id where q.id = p_quote and q.bid_stage = p.stage),
      'The package is at Post Bid – carry this quote into Post Bid (revised quote) before choosing it');
    perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason for the choice');
    select stage into st from public.sq_packages where id = p_package;
    select count(distinct supplier_id) into n from public.sq_quotes where package_id = p_package and superseded_by is null and bid_stage = st;
    perform app.require(n >= 3 or coalesce(btrim(p_few_reason), '') <> '', format('Only %s supplier(s) quoted – give the reason there are fewer than three quotes', n));
  end if;
  perform set_config('app.sq_select', 'on', true);
  update public.sq_packages set selected_quote_id = p_quote, selection_reason = case when p_quote is null then null else btrim(p_reason) end,
         selected_by = case when p_quote is null then null else auth.uid() end, selected_at = case when p_quote is null then null else now() end,
         status = case when p_quote is null then 'open' else 'selected' end,
         few_quotes_reason = case when p_quote is null then few_quotes_reason else coalesce(nullif(btrim(p_few_reason), ''), few_quotes_reason) end
   where id = p_package and status in ('open', 'selected');
  perform app.require(found, 'The package is closed');
  perform set_config('app.sq_select', 'off', true);
end $$;
grant execute on function public.sq_select(uuid, uuid, text, text) to authenticated;
