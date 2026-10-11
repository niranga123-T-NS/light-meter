-- Exchange rates on the Home dashboards of the GM / DGM, SM Projects, the Estimation team and the Operations Executive. Only USD, EUR and GBP.
--  * Central Bank (CBSL) daily indicative rates – fetched automatically every working day (GitHub workflow, through the
--    open Frankfurter service that carries the CBSL series; the CBSL website itself refuses servers outside Sri Lanka).
--  * Commercial Bank of Ceylon – the Operations Executive uploads (web or phone) the bank's daily "Indicative Exchange Rates" report (Monday – Friday):
--    TT buying / selling, LC, 1 / 2 / 3 months forward selling, discounted (forward) buying and the cross rates.
--  * Sri Lanka Customs – the weekly schedule (effective from / to) read from the Customs website automatically; the
--    Operations Executive can enter or correct it when the automatic reading fails.
--  Cross rates (EUR/USD, GBP/USD, EUR/GBP) are worked out from each source.

create table public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('cbsl', 'combank', 'customs')),
  rate_date date not null,                 -- as at (CBSL, Commercial Bank) or effective from (Customs)
  valid_to date,                           -- Customs: the last day of the schedule
  currency text not null check (currency in ('USD', 'EUR', 'GBP')),
  mid numeric(14, 4) check (mid is null or mid > 0),            -- LKR per unit: CBSL indicative, Customs rate, Commercial Bank middle (USD)
  cross_usd numeric(12, 6) check (cross_usd is null or cross_usd > 0), -- Commercial Bank cross (USD per EUR / GBP)
  tt_buy numeric(14, 4) check (tt_buy is null or tt_buy > 0),
  tt_sell numeric(14, 4) check (tt_sell is null or tt_sell > 0),
  lc_sell numeric(14, 4),
  sell_1m numeric(14, 4),
  sell_2m numeric(14, 4),
  sell_3m numeric(14, 4),
  buy_7d numeric(14, 4),
  buy_1m numeric(14, 4),
  buy_2m numeric(14, 4),
  buy_3m numeric(14, 4),
  doc_id uuid,                             -- the uploaded report (attachments, entity fx_report)
  ref text,                                -- where it came from (file name, web address)
  entered_by uuid references public.profiles (id),
  at timestamptz not null default now(),
  unique (source, rate_date, currency)
);
create index on public.fx_rates (source, currency, rate_date desc);

create or replace function app.sees_fx() returns boolean
language sql stable as $$ select app.has_role('gm', 'sm_projects', 'sm_estimation', 'am_estimation', 'estimation_exec', 'operations_exec', 'sys_admin') $$;
create or replace function app.fx_uploader() returns boolean
language sql stable as $$ select app.has_role('operations_exec') $$;

alter table public.fx_rates enable row level security;
create policy fx_rates_read on public.fx_rates for select to authenticated using (app.sees_fx());
grant select on public.fx_rates to authenticated;

create or replace function app.fx_num(v jsonb) returns numeric
language sql immutable as $$ select nullif(replace(btrim(v #>> '{}'), ',', ''), '')::numeric $$;

-- The Operations Executive: the Commercial Bank report of a day. p: {date, doc_id, ref, rates: {USD: {mid, tt_buy, tt_sell, lc_sell, sell_1m, sell_2m, sell_3m,
-- buy_7d, buy_1m, buy_2m, buy_3m}, EUR: {cross_usd, ...}, GBP: {...}}}
create or replace function public.save_combank_rates(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d date := nullif(p ->> 'date', '')::date; c text; r jsonb; n int := 0;
begin
  perform app.require(app.fx_uploader(), 'The Operations Executive uploads the Commercial Bank rates');
  perform app.require(d is not null and d <= (now() at time zone app.tz())::date, 'Enter the date of the report (not a future date)');
  foreach c in array array['USD', 'EUR', 'GBP'] loop
    r := p -> 'rates' -> c;
    perform app.require(r is not null and app.fx_num(r -> 'tt_buy') > 0 and app.fx_num(r -> 'tt_sell') > 0 and app.fx_num(r -> 'sell_3m') > 0,
      format('%s: the TT buying, TT selling and 3 months rates are needed', c));
    perform app.require(app.fx_num(r -> 'tt_sell') >= app.fx_num(r -> 'tt_buy'), format('%s: the selling rate is below the buying rate – check the columns', c));
    insert into public.fx_rates (source, rate_date, currency, mid, cross_usd, tt_buy, tt_sell, lc_sell, sell_1m, sell_2m, sell_3m, buy_7d, buy_1m, buy_2m, buy_3m, doc_id, ref, entered_by)
    values ('combank', d, c, case when c = 'USD' then app.fx_num(r -> 'mid') end, case when c <> 'USD' then app.fx_num(r -> 'cross_usd') end,
            app.fx_num(r -> 'tt_buy'), app.fx_num(r -> 'tt_sell'), app.fx_num(r -> 'lc_sell'), app.fx_num(r -> 'sell_1m'), app.fx_num(r -> 'sell_2m'),
            app.fx_num(r -> 'sell_3m'), app.fx_num(r -> 'buy_7d'), app.fx_num(r -> 'buy_1m'), app.fx_num(r -> 'buy_2m'), app.fx_num(r -> 'buy_3m'),
            nullif(p ->> 'doc_id', '')::uuid, nullif(btrim(p ->> 'ref'), ''), auth.uid())
    on conflict (source, rate_date, currency) do update set mid = excluded.mid, cross_usd = excluded.cross_usd, tt_buy = excluded.tt_buy, tt_sell = excluded.tt_sell,
      lc_sell = excluded.lc_sell, sell_1m = excluded.sell_1m, sell_2m = excluded.sell_2m, sell_3m = excluded.sell_3m, buy_7d = excluded.buy_7d,
      buy_1m = excluded.buy_1m, buy_2m = excluded.buy_2m, buy_3m = excluded.buy_3m, doc_id = coalesce(excluded.doc_id, fx_rates.doc_id),
      ref = coalesce(excluded.ref, fx_rates.ref), entered_by = excluded.entered_by, at = now();
    n := n + 1;
  end loop;
  -- today's reminder no longer applies
  update public.notifications set read_at = coalesce(read_at, now()) where dedupe_key = 'fx_combank:' || d;
end $$;

-- The Operations Executive: the Customs schedule when the automatic reading failed or was wrong. p: {from, to, USD, EUR, GBP, ref}
create or replace function public.save_customs_rates(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare f date := nullif(p ->> 'from', '')::date; t date := nullif(p ->> 'to', '')::date; c text;
begin
  perform app.require(app.fx_uploader(), 'The Operations Executive enters the Customs rates');
  perform app.require(f is not null and t is not null and t >= f, 'Enter the effective from and to dates');
  foreach c in array array['USD', 'EUR', 'GBP'] loop
    perform app.require(app.fx_num(p -> c) > 0, format('Enter the %s rate', c));
    insert into public.fx_rates (source, rate_date, valid_to, currency, mid, ref, entered_by)
    values ('customs', f, t, c, app.fx_num(p -> c), nullif(btrim(p ->> 'ref'), ''), auth.uid())
    on conflict (source, rate_date, currency) do update set valid_to = excluded.valid_to, mid = excluded.mid, ref = coalesce(excluded.ref, fx_rates.ref),
      entered_by = excluded.entered_by, at = now();
  end loop;
end $$;

-- The fetch workflow (GitHub) calls this with the shared secret (the same value as the 'dispatch_secret' in Vault).
-- p: {cbsl: [{date, USD, EUR, GBP}], customs: {from, to, USD, EUR, GBP, ref}}
create or replace function app.fx_secret() returns text
language plpgsql stable security definer set search_path = public as $$
declare s text;
begin
  execute 'select decrypted_secret from vault.decrypted_secrets where name = ''dispatch_secret''' into s;
  return s;
exception when others then return null;
end $$;

create or replace function public.fx_ingest(p_secret text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; c text; d date; f date; t date; n_cbsl int := 0; n_customs int := 0; ref_usd numeric; v numeric;
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  for r in select * from jsonb_array_elements(coalesce(p -> 'cbsl', '[]')) loop
    d := (r ->> 'date')::date;
    foreach c in array array['USD', 'EUR', 'GBP'] loop
      v := app.fx_num(r -> c);
      continue when v is null or v <= 0;
      insert into public.fx_rates (source, rate_date, currency, mid, ref)
      values ('cbsl', d, c, v, 'CBSL indicative rate')
      on conflict (source, rate_date, currency) do update set mid = excluded.mid, at = now();
      n_cbsl := n_cbsl + 1;
    end loop;
  end loop;
  if p ? 'customs' and p -> 'customs' <> 'null'::jsonb then
    f := (p #>> '{customs,from}')::date; t := (p #>> '{customs,to}')::date;
    perform app.require(f is not null and t >= f, 'Customs: dates missing');
    -- a reading far from the Central Bank rate is refused (the Operations Executive enters it instead)
    foreach c in array array['USD', 'EUR', 'GBP'] loop
      v := app.fx_num(p -> 'customs' -> c);
      perform app.require(v > 0, 'Customs: ' || c || ' missing');
      select mid into ref_usd from public.fx_rates where source = 'cbsl' and currency = c and rate_date <= t order by rate_date desc limit 1;
      if ref_usd is not null then
        perform app.require(abs(v / ref_usd - 1) < 0.08, format('Customs: %s %s is too far from the Central Bank rate %s', c, v, ref_usd));
      end if;
    end loop;
    -- a schedule already entered by a person is not overwritten
    if not exists (select 1 from public.fx_rates where source = 'customs' and rate_date = f and entered_by is not null) then
      foreach c in array array['USD', 'EUR', 'GBP'] loop
        insert into public.fx_rates (source, rate_date, valid_to, currency, mid, ref)
        values ('customs', f, t, c, app.fx_num(p -> 'customs' -> c), nullif(p #>> '{customs,ref}', ''))
        on conflict (source, rate_date, currency) do update set valid_to = excluded.valid_to, mid = excluded.mid, ref = excluded.ref, at = now();
        n_customs := n_customs + 1;
      end loop;
    end if;
  end if;
  return jsonb_build_object('cbsl', n_cbsl, 'customs', n_customs);
end $$;
revoke all on function public.fx_ingest(text, jsonb) from public;
grant execute on function public.fx_ingest(text, jsonb) to anon, authenticated;

-- Last date the workflow needs to fetch from (to fill gaps after a missed run)
create or replace function public.fx_last_dates(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.fx_secret() is not null and p_secret = app.fx_secret(), 'Not allowed');
  return jsonb_build_object('cbsl', (select max(rate_date) from public.fx_rates where source = 'cbsl'),
                            'customs', (select max(rate_date) from public.fx_rates where source = 'customs'));
end $$;
revoke all on function public.fx_last_dates(text) from public;
grant execute on function public.fx_last_dates(text) to anon, authenticated;

-- The board: latest of each source with the previous value (change), the Customs schedule in force, and the history for the trend
create or replace function public.fx_board(p_days int default 90) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone app.tz())::date; res jsonb := '{}'; s text; d date;
begin
  perform app.require(app.sees_fx(), 'Not allowed');
  foreach s in array array['cbsl', 'combank'] loop
    select max(rate_date) into d from public.fx_rates where source = s and rate_date <= today;
    res := res || jsonb_build_object(s, jsonb_build_object('date', d,
      'rows', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('prev',
          (select to_jsonb(y) from public.fx_rates y where y.source = s and y.currency = x.currency and y.rate_date < d order by y.rate_date desc limit 1)))
        from public.fx_rates x where x.source = s and x.rate_date = d), '[]')));
  end loop;
  select max(rate_date) into d from public.fx_rates where source = 'customs' and rate_date <= today;
  res := res || jsonb_build_object('customs', jsonb_build_object('date', d,
    'rows', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('prev',
        (select to_jsonb(y) from public.fx_rates y where y.source = 'customs' and y.currency = x.currency and y.rate_date < d order by y.rate_date desc limit 1)))
      from public.fx_rates x where x.source = 'customs' and x.rate_date = d), '[]'),
    'next', (select jsonb_agg(to_jsonb(x)) from public.fx_rates x where x.source = 'customs' and x.rate_date > today)));
  res := res || jsonb_build_object('today', today,
    'history', coalesce((select jsonb_agg(jsonb_build_object('s', source, 'd', rate_date, 'c', currency, 'mid', mid, 'sell', tt_sell, 'buy', tt_buy, 'f3', sell_3m) order by rate_date)
      from public.fx_rates where rate_date > today - greatest(p_days, 7) and rate_date <= today), '[]'));
  return res;
end $$;

-- Working days 09:00: remind the Operations Executive when today's Commercial Bank report is not in yet
create or replace function public.fx_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; n int := 0;
begin
  if extract(isodow from today) <= 5 and not exists (select 1 from public.fx_rates where source = 'combank' and rate_date = today) then
    perform app.notify_many(app.role_users('operations_exec'), 'fx', 'Upload today''s exchange rates',
      'The Commercial Bank indicative exchange rate report of ' || to_char(today, 'DD Mon YYYY') || ' is not uploaded yet (skip on bank holidays).',
      'normal', null, null, '/fx', 'fx_combank:' || today, false);
    n := n + 1;
  end if;
  -- no Customs schedule in force (the automatic reading failed): ask the Operations Executive to enter it
  if not exists (select 1 from public.fx_rates where source = 'customs' and rate_date <= today and coalesce(valid_to, rate_date + 6) >= today) then
    perform app.notify_many(app.role_users('operations_exec'), 'fx', 'Enter this week''s Customs exchange rates',
      'The Sri Lanka Customs rates in force today could not be read from the Customs website – enter USD, EUR and GBP with the effective dates.',
      'normal', null, null, '/fx', 'fx_customs:' || today, false);
    n := n + 1;
  end if;
  return n;
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('fx-tick', '30 3 * * *', 'select public.fx_tick()');
  end if;
end $$;

-- The uploaded reports are attachments of entity 'fx_report': read by everyone who sees the rates, uploaded by the Operations Executive
CREATE OR REPLACE FUNCTION app.can_read_attachment(a attachments)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.app_role := app.my_role(); inq uuid; st text; mode int; released timestamptz;
begin
  if r is null then return false; end if;
  if a.uploaded_by = auth.uid() then return true; end if;
  case a.entity_type
  when 'fx_report' then
    return app.sees_fx();
  when 'instrument' then
    return not app.is_sub();
  when 'visit' then
    return r in ('gm', 'sm_projects') or exists (select 1 from public.visits where id = a.entity_id and sales_person_id = auth.uid());
  when 'tender' then
    return r in ('gm', 'sm_projects', 'sm_estimation') or exists (select 1 from public.tenders where id = a.entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return app.can_read_inquiry(a.entity_id);
  when 'design_job' then
    select inquiry_id into inq from public.design_jobs where id = a.entity_id;
    if r in ('gm', 'design_manager') or app.can_read_design_job(a.entity_id) and r in ('lighting_designer', 'lighting_engineer') then return true; end if;
    -- Released design pack: Estimation (on release) and Sales (Route C / mode 3 release / early release)
    if a.kind = 'design_pack' then
      if r in ('sm_estimation', 'am_estimation', 'estimation_exec') then return app.can_read_inquiry(inq); end if;
      select status, release_mode, design_released_to_sales_at into st, mode, released from public.inquiries where id = inq;
      if r in ('sm_projects') or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)) then
        return released is not null;
      end if;
    end if;
    return false;
  when 'estimation_job' then
    select inquiry_id into inq from public.estimation_jobs where id = a.entity_id;
    if a.kind = 'costing_sheet' then return app.can_read_costing(a.entity_id); end if;
    if r in ('gm', 'sm_estimation') or app.can_read_estimation_job(a.entity_id) then return true; end if;
    if r = 'sm_projects' and a.kind in ('quotation_draft', 'quotation_final', 'compliance_sheet', 'technical_data')
       and exists (select 1 from public.estimation_jobs where id = a.entity_id and needs_sm_projects) then
      return true;
    end if;
    -- Sales download only the released quotation and supporting sheets – never the costing sheet
    if a.kind in ('quotation_final', 'compliance_sheet', 'technical_data') then
      return exists (select 1 from public.estimation_jobs where id = a.entity_id and status = 'released')
             and (r = 'sm_projects' or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)));
    end if;
    return false;
  when 'clarification' then
    select inquiry_id into inq from public.clarifications where id = a.entity_id;
    return r in ('gm', 'design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec')
           and app.can_read_inquiry(inq);
  when 'sample' then
    return r in ('gm', 'sm_projects', 'operations_exec') or exists (select 1 from public.samples where id = a.entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then
    return r in ('gm', 'sm_projects', 'operations_exec');
  when 'stock_snapshot' then
    return r in ('gm', 'sm_projects', 'operations_exec');
  when 'retention' then
    return exists (select 1 from public.retentions where id = a.entity_id);
  when 'bond' then
    return exists (select 1 from public.bonds where id = a.entity_id);
  when 'warranty' then
    return app.can_read_warranty(a.entity_id);
  when 'warranty_claim' then
    return exists (select 1 from public.warranty_claims where id = a.entity_id);
  when 'warranty_report' then
    return exists (select 1 from public.warranty_reports where id = a.entity_id);
  when 'rma' then
    return exists (select 1 from public.manufacturer_claims where id = a.entity_id);
  when 'warranty_registration' then
    return exists (select 1 from public.warranty_registrations where id = a.entity_id);
  when 'eng_job' then
    return app.can_read_eng_job(a.entity_id);
  when 'eng_job_update' then
    return exists (select 1 from public.eng_job_updates u where u.id = a.entity_id and app.can_read_eng_job(u.job_id));
  when 'exec_report' then
    return exists (select 1 from public.exec_reports x where x.id = a.entity_id and (x.author_id = auth.uid() or app.is_exec_team(x.exec_project_id)));
  when 'exec_worker' then
    return exists (select 1 from public.exec_workers x where x.id = a.entity_id and app.can_see_worker(x));
  when 'hse_record' then
    return exists (select 1 from public.hse_records x where x.id = a.entity_id and app.can_read_exec_team(x.exec_project_id));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = a.entity_id and (x.reported_by = auth.uid() or app.is_exec_team(x.exec_project_id)
      or exists (select 1 from public.hse_actions y where y.report_id = x.id and y.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = a.entity_id and (app.is_exec_internal(x.exec_project_id) or r = 'gm'));
  when 'material_request' then
    return app.can_read_mr(a.entity_id);
  when 'exec_doc' then
    return exists (select 1 from public.exec_docs x where x.id = a.entity_id and (r in ('senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec', 'design_manager', 'lighting_designer', 'lighting_engineer')
      or (app.is_exec_member(x.exec_project_id) and x.status = 'for_construction' and (x.issued_to_subs or r <> 'sub_supervisor'))));
  when 'design_query' then
    return exists (select 1 from public.design_queries x where x.id = a.entity_id
      and (app.is_exec_team(x.exec_project_id) or r in ('design_manager', 'lighting_designer', 'lighting_engineer')));
  when 'snag' then
    return exists (select 1 from public.snags x where x.id = a.entity_id and app.is_exec_team(x.exec_project_id));
  when 'dossier_item' then
    return exists (select 1 from public.exec_dossier x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
  when 'test_record' then
    return exists (select 1 from public.test_records x where x.id = a.entity_id and app.is_exec_team(x.exec_project_id));
  when 'instrument' then
    return r <> 'sub_supervisor';
  when 'sub_invoice' then
    return app.can_read_sub_invoice(a.entity_id);
  when 'sub_cert_var' then
    return exists (select 1 from public.sub_cert_variations x where x.id = a.entity_id and app.can_read_sub_cert(x.sub_cert_id));
  when 'sub_invoice_var' then
    return exists (select 1 from public.sub_invoice_variations x where x.id = a.entity_id and app.can_read_sub_invoice(x.invoice_id));
  when 'exec_project' then
    return a.kind in ('tpl_measurement', 'tpl_ipa', 'tpl_ipc') and app.can_read_exec(a.entity_id);
  when 'sub_cert' then
    return app.can_read_sub_cert(a.entity_id);
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = a.entity_id
      and (r in ('sm_projects', 'gm', 'operations_exec', 'senior_elec_engineer') or x.requested_by = auth.uid() or (x.exec_project_id is not null and app.is_exec_internal(x.exec_project_id))));
  when 'scrap_disposal' then
    return app.can_read_scrap(a.entity_id);
  when 'scrap_quote' then
    return exists (select 1 from public.scrap_quotes q where q.id = a.entity_id and app.can_read_scrap(q.disposal_id));
  when 'project_defect' then
    return app.can_read_defect(a.entity_id);
  else
    return r = 'gm';
  end case;
end $function$;

CREATE OR REPLACE FUNCTION app.can_write_attachment(p_entity_type text, p_entity_id uuid, p_kind text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.app_role := app.my_role();
begin
  case p_entity_type
  when 'fx_report' then return app.fx_uploader();
  when 'instrument' then return r = 'operations_exec' and exists (select 1 from public.instruments where id = p_entity_id);
  when 'visit' then return exists (select 1 from public.visits where id = p_entity_id and sales_person_id = auth.uid()) or r = 'sm_projects';
  when 'tender' then return exists (select 1 from public.tenders where id = p_entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return exists (select 1 from public.inquiries where id = p_entity_id and (sales_person_id = auth.uid() or r in ('sm_projects', 'gm')));
  when 'design_job' then
    return r = 'design_manager' or exists (select 1 from public.design_jobs where id = p_entity_id and assignee_id = auth.uid());
  when 'estimation_job' then
    return r = 'sm_estimation' or exists (select 1 from public.estimation_jobs where id = p_entity_id and assignee_id = auth.uid());
  when 'clarification' then
    return r in ('design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec');
  when 'sample' then
    return r = 'operations_exec' or exists (select 1 from public.samples where id = p_entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then return r = 'operations_exec';
  when 'stock_snapshot' then return r = 'operations_exec' and exists (select 1 from public.stock_snapshots where id = p_entity_id);
  when 'retention' then return app.can_edit_retention(p_entity_id);
  when 'bond' then return r = 'operations_exec' and exists (select 1 from public.bonds where id = p_entity_id);
  when 'warranty' then return app.is_warranty_desk() and exists (select 1 from public.warranties where id = p_entity_id);
  when 'warranty_claim' then
    return exists (select 1 from public.warranty_claims c where c.id = p_entity_id and (app.is_warranty_desk() or c.assignee_id = auth.uid()));
  when 'warranty_report' then
    return exists (select 1 from public.warranty_reports x where x.id = p_entity_id and (x.sales_person_id = auth.uid() or app.is_warranty_desk()));
  when 'rma' then return app.is_warranty_desk() and exists (select 1 from public.manufacturer_claims where id = p_entity_id);
  when 'warranty_registration' then return app.is_warranty_desk() and exists (select 1 from public.warranty_registrations where id = p_entity_id);
  when 'eng_job' then
    return exists (select 1 from public.eng_jobs where id = p_entity_id and (assignee_id = auth.uid() or app.is_eng_lead()));
  when 'eng_job_update' then
    return exists (select 1 from public.eng_job_updates u join public.eng_jobs j on j.id = u.job_id
                   where u.id = p_entity_id and (j.assignee_id = auth.uid() or app.is_eng_lead()));
  when 'exec_report' then
    return exists (select 1 from public.exec_reports x where x.id = p_entity_id and x.author_id = auth.uid() and x.status in ('submitted', 'returned'));
  when 'exec_worker' then
    return exists (select 1 from public.exec_workers x where x.id = p_entity_id and (app.has_role('senior_elec_engineer') or app.is_project_ae(x.exec_project_id)
      or (x.added_by = auth.uid() and x.verified_at is null)
      -- the crew's supervisor uploads the police report (storage checks without a kind)
      or ((p_kind is null or p_kind = 'police_report') and (x.supervisor_id = auth.uid() or x.added_by = auth.uid()))));
  when 'hse_record' then
    return exists (select 1 from public.hse_records x where x.id = p_entity_id and (app.is_exec_member(x.exec_project_id) or app.has_role('senior_elec_engineer')));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = p_entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
      or exists (select 1 from public.hse_actions a where a.report_id = x.id and a.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = p_entity_id and (x.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects')));
  when 'material_request' then
    return exists (select 1 from public.material_requests x where x.id = p_entity_id and app.is_exec_internal(x.exec_project_id) and not app.has_role('gm'))
      -- the supervisor who raised the request or acknowledges its delivery: delivery notes and photos
      or (r = 'sub_supervisor' and app.can_read_mr(p_entity_id) and (p_kind is null or p_kind in ('mr_doc', 'grn_photo', 'datasheet')));
  when 'exec_doc' then
    return exists (select 1 from public.exec_docs x where x.id = p_entity_id and x.uploaded_by = auth.uid());
  when 'design_query' then
    return exists (select 1 from public.design_queries x where x.id = p_entity_id
      and (x.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'design_manager', 'lighting_designer', 'lighting_engineer')));
  when 'snag' then
    return exists (select 1 from public.snags x where x.id = p_entity_id and (app.has_role('senior_elec_engineer') or app.is_project_ae(x.exec_project_id)));
  when 'dossier_item' then
    return exists (select 1 from public.exec_dossier x where x.id = p_entity_id and (app.has_role('senior_elec_engineer', 'operations_exec') or app.is_project_ae(x.exec_project_id)));
  when 'test_record' then
    return exists (select 1 from public.test_records x where x.id = p_entity_id and (x.performed_by = auth.uid() or app.has_role('senior_elec_engineer')));
  when 'instrument' then
    return app.has_role('senior_elec_engineer', 'operations_exec', 'sm_projects');
  when 'sub_invoice' then
    -- the copy: who recorded it, while a draft or returned · the marked-up copy: the SEE / Operations while it waits for them
    return exists (select 1 from public.sub_invoices x where x.id = p_entity_id and (
      ((p_kind is null or p_kind in ('sinv_doc', 'ipc_signed', 'measure_final')) and x.status in ('draft', 'returned')
        and (x.created_by = auth.uid() or (app.can_record_sub_invoice(x.exec_project_id) and not app.has_role('sub_supervisor'))))
      or ((p_kind is null or p_kind = 'sinv_markup') and ((x.status = 'ae_review' and app.is_project_ae(x.exec_project_id))
                                                          or (x.status = 'submitted' and app.has_role('senior_elec_engineer'))
                                                          or (x.status = 'see_approved' and app.has_role('operations_exec'))))));
  when 'sub_cert_var' then
    -- a ticked variation's IPC / sheets: as the IPC's own documents
    return exists (select 1 from public.sub_cert_variations v join public.sub_certs x on x.id = v.sub_cert_id where v.id = p_entity_id
      and (p_kind is null or p_kind = 'ipc_var') and x.status in ('draft', 'returned') and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')));
  when 'sub_invoice_var' then
    return exists (select 1 from public.sub_invoice_variations v join public.sub_invoices x on x.id = v.invoice_id where v.id = p_entity_id
      and (p_kind is null or p_kind = 'var_final') and x.status in ('draft', 'returned')
      and (x.created_by = auth.uid() or (app.can_record_sub_invoice(x.exec_project_id) and not app.has_role('sub_supervisor'))));
  when 'exec_project' then
    return (p_kind is null or p_kind in ('tpl_measurement', 'tpl_ipa', 'tpl_ipc')) and app.has_role('senior_elec_engineer')
      and exists (select 1 from public.exec_projects where id = p_entity_id);
  when 'sub_cert' then
    -- the IPC and measurement sheets: who prepared it, while a draft or returned · the marked-up copy: the AE / SEE while it waits for them
    return exists (select 1 from public.sub_certs x where x.id = p_entity_id and (
      ((p_kind is null or p_kind in ('ipc_draft', 'ipc_measure')) and x.status in ('draft', 'returned')
        and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')))
      or ((p_kind is null or p_kind = 'jm_sheet') and x.status in ('jm_scheduled', 'jm_returned')
        and (x.prepared_by = auth.uid() or app.has_role('senior_elec_engineer')))
      or ((p_kind is null or p_kind = 'jm_markup') and ((x.status = 'jm_ae' and app.is_project_ae(x.exec_project_id))
                                                        or (x.status = 'jm_see' and app.has_role('senior_elec_engineer'))))
      or ((p_kind is null or p_kind = 'ipc_markup') and ((x.status = 'ae_review' and app.is_project_ae(x.exec_project_id))
                                                         or (x.status = 'prepared' and app.has_role('senior_elec_engineer'))))));
  when 'exec_request' then
    return exists (select 1 from public.exec_requests x where x.id = p_entity_id and ((x.requested_by = auth.uid() and x.status = 'pending_smp') or app.has_role('sm_projects')));
  when 'scrap_disposal' then
    return exists (select 1 from public.scrap_disposals x where x.id = p_entity_id and (x.requested_by = auth.uid() or app.can_raise_scrap(x.exec_project_id))
                   and ((p_kind = 'scrap_photo' and x.status in ('draft', 'returned')) or (p_kind = 'scrap_evidence' and x.status = 'approved')));
  when 'scrap_quote' then
    return p_kind = 'scrap_quote' and exists (select 1 from public.scrap_quotes q join public.scrap_disposals x on x.id = q.disposal_id where q.id = p_entity_id
                   and x.status in ('draft', 'returned') and (x.requested_by = auth.uid() or app.can_raise_scrap(x.exec_project_id)));
  when 'project_defect' then
    return exists (select 1 from public.project_defects x where x.id = p_entity_id and app.can_read_defect(x.id)
                   and ((p_kind = 'defect_photo' and x.status in ('reported', 'open', 'assigned', 'rectified'))
                        or (p_kind = 'defect_after' and x.status in ('assigned', 'rectified')
                            and (x.assignee_id = auth.uid() or app.defect_manager() or (x.exec_project_id is not null and app.is_project_ae(x.exec_project_id))))));
  else return false;
  end case;
end $function$;
