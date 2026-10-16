-- One-time clean-up: the dummy foreign orders, shipments and site requests created while testing the system
-- (marked by the business on 16 Oct 2026), with everything that hangs off them (order lines, values, payments, steps,
-- ETA changes, approvals, alerts, attachments, history), through the same engine as the GM / DGM clean-up.
--  * Import requests IR-2026-00001, IR-2026-00002 (Causeway Paint Factory) and HO-2026-00001 (Galadari),
--    HO-2026-00002 (RDA), HO-2026-00003 (Road Development Authority) – and their import orders IMP-2026-00001 … 00004.
--  * Shipments SHP-2026-00001 … 00003 (once none of their orders is left).
--  * Site requests MR-2026-00001 … 00005 of EXP-2026-00002 (Causeway Paint Factory) and the local order requests made
--    from them. The execution project itself is kept.
-- Each record is deleted only when its code AND its project / client match, so nothing else can be touched. Running it
-- again does nothing. The clean-up is written to the clean-up log.

do $$
declare ids uuid[]; t text; r jsonb; files int;
begin
  create temp table if not exists _purge_counts (tbl text, n bigint) on commit drop;
  create temp table if not exists _purge_ids (id uuid) on commit drop;
  create temp table if not exists _purge_files (path text) on commit drop;
  create temp table if not exists _purge_labels (kind text, label text) on commit drop;
  truncate _purge_counts, _purge_ids, _purge_files, _purge_labels;
  perform app.purge_guard_triggers();
  perform set_config('app.purging', 'on', true);

  -- local order requests made from the test site requests (before the site requests, which they point to)
  perform app.purge_rows('public.lo_requests', $w$mr_id in (select m.id from public.material_requests m join public.exec_projects e on e.id = m.exec_project_id
      where e.code = 'EXP-2026-00002' and m.code in ('MR-2026-00001', 'MR-2026-00002', 'MR-2026-00003', 'MR-2026-00004', 'MR-2026-00005'))$w$);

  -- import requests (their import orders, lines, values, payments, steps and shipment links go with them)
  perform app.purge_rows('public.fo_handovers', $w$
       (code in ('IR-2026-00001', 'IR-2026-00002') and (project_name ilike '%Causeway%' or client ilike '%Causeway%'))
    or (code = 'HO-2026-00001' and (client ilike '%GALADARI%' or project_name ilike '%LS-000111%'))
    or (code = 'HO-2026-00002' and (client ilike 'RDA%' or project_name ilike 'LS22%'))
    or (code = 'HO-2026-00003' and (client ilike '%Road Development%' or project_name ilike '%CGHW%'))$w$);

  -- shipments with no order left
  perform app.purge_rows('public.fo_shipments', $w$code in ('SHP-2026-00001', 'SHP-2026-00002', 'SHP-2026-00003')
      and not exists (select 1 from public.fo_shipment_orders so where so.shipment_id = fo_shipments.id)$w$);

  -- site requests of the Causeway Paint Factory test
  perform app.purge_rows('public.material_requests', $w$code in ('MR-2026-00001', 'MR-2026-00002', 'MR-2026-00003', 'MR-2026-00004', 'MR-2026-00005')
      and exec_project_id in (select id from public.exec_projects where code = 'EXP-2026-00002')$w$);

  -- their alerts, approvals, attachments, clocks and history
  for i in 1..3 loop
    ids := array(select distinct id from _purge_ids);
    truncate _purge_ids;
    exit when cardinality(ids) = 0;
    foreach t in array array['attachments', 'approvals', 'notifications', 'sla_clocks', 'status_history', 'due_date_changes'] loop
      perform app.purge_rows(('public.' || t)::regclass, format('entity_id = any(%L::uuid[])', ids));
    end loop;
  end loop;
  perform set_config('app.purging', 'off', true);

  select coalesce(jsonb_agg(jsonb_build_object('table', c.tbl, 'rows', c.s) order by c.s desc), '[]') into r
    from (select x.tbl, sum(x.n) s from _purge_counts x group by x.tbl) c;
  select count(*) into files from _purge_files;
  if (select coalesce(sum(n), 0) from _purge_counts) > 0 then
    insert into public.purge_log (kind, target, label, counts, files)
    values ('test_orders', 'IR-2026-00001/2, HO-2026-00001/2/3, SHP-2026-00001/2/3, MR-2026-00001…5',
            'Dummy foreign orders, shipments and site requests created while testing', r, files);
  end if;
  raise notice 'Removed test orders: %', r;
end $$;
