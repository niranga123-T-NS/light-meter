-- SAP stock (Lighting, profit centre 2230): the monthly SAP stock ageing report uploaded by the Operations Executive.
--  * Upload → preview → confirm. One confirmed snapshot per month-end date and profit centre; uploading the same date again
--    replaces it with a reason. The original Excel file is kept with the snapshot.
--  * Only the columns that matter are kept: material, old material, manufacturer part no., description, UOM, category,
--    sub-category, class, sub-class, brand, closing stock, closing value, unit cost, currency, and the ageing merged from
--    SAP's 14 bands into 6: 0–90, 91–180, 181–360, 361–540, 541–720, over 720 days (quantity and value).
--  * SAP's classification is unreliable, so Operations can correct an item's category / brand once; the correction is kept
--    by material number and applies to every snapshot.
--  * Values (cost, closing value) are seen by GM / DGM, SM Projects and Operations; everyone else (not external) sees
--    quantities and ageing only.
--  * Alerts on confirming: items that moved past 360 or 720 days since the last snapshot, and a value change of more than 10%
--    → Operations and SM Projects; the new snapshot → GM / DGM. Not uploaded by the 5th of the month → Operations reminded.

create table public.stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  as_at date not null,
  profit_center text not null,
  company_code text,
  status text not null default 'preview' check (status in ('preview', 'confirmed', 'replaced', 'discarded')),
  item_count int not null default 0,
  total_qty numeric not null default 0,
  total_value numeric not null default 0,
  warnings jsonb not null default '{}',
  replace_reason text,
  uploaded_by uuid not null default auth.uid() references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create unique index stock_snapshots_one_confirmed on public.stock_snapshots (as_at, profit_center) where status = 'confirmed';

create table public.stock_items (
  snapshot_id uuid not null references public.stock_snapshots (id) on delete cascade,
  material text not null,
  old_material text,
  mpn text,
  description text,
  uom text,
  category text,
  sub_category text,
  class text,
  sub_class text,
  brand text,
  qty numeric not null default 0,
  value numeric not null default 0,
  unit_cost numeric,
  currency text,
  q1 numeric not null default 0, v1 numeric not null default 0,   -- 0–90 days
  q2 numeric not null default 0, v2 numeric not null default 0,   -- 91–180
  q3 numeric not null default 0, v3 numeric not null default 0,   -- 181–360
  q4 numeric not null default 0, v4 numeric not null default 0,   -- 361–540
  q5 numeric not null default 0, v5 numeric not null default 0,   -- 541–720
  q6 numeric not null default 0, v6 numeric not null default 0,   -- over 720
  flags text[] not null default '{}',
  primary key (snapshot_id, material)
);

create table public.stock_item_overrides (
  material text primary key,
  category text,
  sub_category text,
  class text,
  sub_class text,
  brand text,
  note text,
  updated_by uuid not null default auth.uid() references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.stock_snapshots enable row level security;
alter table public.stock_items enable row level security;
alter table public.stock_item_overrides enable row level security;
create or replace function app.stock_values_visible() returns boolean language sql stable as $$
  select app.has_role('gm', 'sm_projects', 'operations_exec')
$$;
-- Raw rows (with values) only for the roles that see values; everyone else reads through the functions below
create policy stock_snapshots_read on public.stock_snapshots for select to authenticated using (app.stock_values_visible());
create policy stock_items_read on public.stock_items for select to authenticated using (app.stock_values_visible());
create policy stock_item_overrides_read on public.stock_item_overrides for select to authenticated using (not app.is_external());
grant select on public.stock_snapshots, public.stock_items, public.stock_item_overrides to authenticated;

create or replace function app.stock_reader() returns boolean language sql stable as $$
  select app.my_role() is not null and not app.is_external()
$$;

-- Stage an upload. p_meta: {as_at, profit_center, company_code}; p_rows: [{material, old_material, mpn, description, uom,
-- category, sub_category, class, sub_class, brand, qty, value, unit_cost, currency, q1..q6, v1..v6, sap_na}]
create or replace function public.stage_stock_upload(p_meta jsonb, p_rows jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; r jsonb; n int := 0; unc int := 0; mism int := 0; na int := 0; dup int := 0; f text[]; q numeric; bands numeric;
        asat date := nullif(p_meta ->> 'as_at', '')::date; pc text := nullif(btrim(p_meta ->> 'profit_center'), '');
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive uploads the SAP stock report');
  perform app.require(asat is not null, 'The stock date (To Date) was not found in the file');
  perform app.require(pc is not null, 'The profit centre was not found in the file');
  perform app.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) > 0, 'No stock lines found in the file');
  -- An older unconfirmed preview of the same date is discarded
  update public.stock_snapshots set status = 'discarded' where status = 'preview' and as_at = asat and profit_center = pc;
  insert into public.stock_snapshots (as_at, profit_center, company_code) values (asat, pc, nullif(btrim(p_meta ->> 'company_code'), ''))
  returning id into sid;
  for r in select * from jsonb_array_elements(p_rows) loop
    continue when coalesce(btrim(r ->> 'material'), '') = '';
    if exists (select 1 from public.stock_items where snapshot_id = sid and material = btrim(r ->> 'material')) then dup := dup + 1; continue; end if;
    f := '{}';
    q := coalesce(nullif(r ->> 'qty', '')::numeric, 0);
    bands := coalesce((r ->> 'q1')::numeric, 0) + coalesce((r ->> 'q2')::numeric, 0) + coalesce((r ->> 'q3')::numeric, 0)
           + coalesce((r ->> 'q4')::numeric, 0) + coalesce((r ->> 'q5')::numeric, 0) + coalesce((r ->> 'q6')::numeric, 0);
    if coalesce(r ->> 'category', '') in ('', 'Other') or coalesce(r ->> 'sub_category', '') in ('', '<dummy>') then f := f || 'uncategorised'::text; unc := unc + 1; end if;
    if abs(bands - q) > 0.001 then f := f || 'ageing_mismatch'::text; mism := mism + 1; end if;
    if coalesce((r ->> 'sap_na')::boolean, false) then f := f || 'sap_na'::text; na := na + 1; end if;
    insert into public.stock_items (snapshot_id, material, old_material, mpn, description, uom, category, sub_category, class, sub_class, brand,
                                    qty, value, unit_cost, currency, q1, v1, q2, v2, q3, v3, q4, v4, q5, v5, q6, v6, flags)
    values (sid, btrim(r ->> 'material'), nullif(btrim(r ->> 'old_material'), ''), nullif(btrim(r ->> 'mpn'), ''), nullif(btrim(r ->> 'description'), ''),
            nullif(btrim(r ->> 'uom'), ''), nullif(btrim(r ->> 'category'), ''), nullif(nullif(btrim(r ->> 'sub_category'), ''), '<dummy>'),
            nullif(nullif(btrim(r ->> 'class'), ''), '<dummy>'), nullif(nullif(btrim(r ->> 'sub_class'), ''), '<dummy>'), nullif(btrim(r ->> 'brand'), ''),
            q, coalesce(nullif(r ->> 'value', '')::numeric, 0), nullif(r ->> 'unit_cost', '')::numeric, nullif(btrim(r ->> 'currency'), ''),
            coalesce((r ->> 'q1')::numeric, 0), coalesce((r ->> 'v1')::numeric, 0), coalesce((r ->> 'q2')::numeric, 0), coalesce((r ->> 'v2')::numeric, 0),
            coalesce((r ->> 'q3')::numeric, 0), coalesce((r ->> 'v3')::numeric, 0), coalesce((r ->> 'q4')::numeric, 0), coalesce((r ->> 'v4')::numeric, 0),
            coalesce((r ->> 'q5')::numeric, 0), coalesce((r ->> 'v5')::numeric, 0), coalesce((r ->> 'q6')::numeric, 0), coalesce((r ->> 'v6')::numeric, 0), f);
    n := n + 1;
  end loop;
  perform app.require(n > 0, 'No stock lines found in the file');
  update public.stock_snapshots s set item_count = n,
    total_qty = (select coalesce(sum(qty), 0) from public.stock_items where snapshot_id = sid),
    total_value = (select coalesce(sum(value), 0) from public.stock_items where snapshot_id = sid),
    warnings = jsonb_build_object('uncategorised', unc, 'ageing_mismatch', mism, 'sap_na', na, 'duplicates', dup)
  where s.id = sid;
  return sid;
end $$;

create or replace function public.discard_stock_upload(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive uploads the SAP stock report');
  update public.stock_snapshots set status = 'discarded' where id = p_id and status = 'preview';
  perform app.require(found, 'Upload not found');
end $$;

create or replace function public.confirm_stock_upload(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.stock_snapshots; old public.stock_snapshots; prev public.stock_snapshots; c360 int; v360 numeric; c720 int; v720 numeric; chg numeric;
        ops uuid[] := app.role_users('operations_exec') || app.role_users('sm_projects');
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive uploads the SAP stock report');
  select * into s from public.stock_snapshots where id = p_id for update;
  perform app.require(s.id is not null and s.status = 'preview', 'Upload not found or already confirmed');
  select * into old from public.stock_snapshots where as_at = s.as_at and profit_center = s.profit_center and status = 'confirmed';
  if old.id is not null then
    perform app.require(coalesce(btrim(p_reason), '') <> '', format('A stock report as at %s is already confirmed – give the reason for replacing it', to_char(s.as_at, 'DD Mon YYYY')));
    update public.stock_snapshots set status = 'replaced' where id = old.id;
  end if;
  update public.stock_snapshots set status = 'confirmed', confirmed_at = now(), replace_reason = nullif(btrim(p_reason), '') where id = s.id;
  -- The previous month for comparison
  select * into prev from public.stock_snapshots where profit_center = s.profit_center and status = 'confirmed' and as_at < s.as_at order by as_at desc limit 1;
  perform app.notify_many(app.role_users('gm') || app.role_users('sm_projects'), 'stock', 'SAP stock report uploaded',
    format('As at %s · %s items · LKR %s · %s%% older than 1 year', to_char(s.as_at, 'DD Mon YYYY'), s.item_count, to_char(s.total_value, 'FM999,999,999,990'),
      (select round(100 * coalesce(sum(v4 + v5 + v6), 0) / nullif(s.total_value, 0)) from public.stock_items where snapshot_id = s.id)),
    'normal', 'stock_snapshot', s.id, '/stock');
  if prev.id is not null then
    select count(*), coalesce(sum(i.v4 + i.v5 + i.v6 - coalesce(p.v4 + p.v5 + p.v6, 0)), 0) into c360, v360
      from public.stock_items i left join public.stock_items p on p.snapshot_id = prev.id and p.material = i.material
     where i.snapshot_id = s.id and (i.q4 + i.q5 + i.q6) > coalesce(p.q4 + p.q5 + p.q6, 0);
    select count(*), coalesce(sum(i.v6 - coalesce(p.v6, 0)), 0) into c720, v720
      from public.stock_items i left join public.stock_items p on p.snapshot_id = prev.id and p.material = i.material
     where i.snapshot_id = s.id and i.q6 > coalesce(p.q6, 0);
    if c360 > 0 or c720 > 0 then
      perform app.notify_many(ops, 'stock', 'Stock moved into older age bands',
        format('%s item(s) past 360 days (LKR %s) · %s item(s) past 720 days (LKR %s) since %s', c360, to_char(v360, 'FM999,999,999,990'), c720,
          to_char(v720, 'FM999,999,999,990'), to_char(prev.as_at, 'DD Mon YYYY')),
        'normal', 'stock_snapshot', s.id, '/stock');
    end if;
    chg := case when prev.total_value > 0 then 100 * (s.total_value - prev.total_value) / prev.total_value end;
    if abs(coalesce(chg, 0)) > 10 then
      perform app.notify_many(ops, 'stock', 'Stock value changed by more than 10%',
        format('LKR %s → LKR %s (%s%%) between %s and %s', to_char(prev.total_value, 'FM999,999,999,990'), to_char(s.total_value, 'FM999,999,999,990'),
          to_char(round(chg, 1), 'FMS990.0'), to_char(prev.as_at, 'DD Mon'), to_char(s.as_at, 'DD Mon YYYY')),
        'normal', 'stock_snapshot', s.id, '/stock');
    end if;
  end if;
end $$;

create or replace function public.set_stock_override(p_material text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive corrects stock categories');
  perform app.require(coalesce(btrim(p_material), '') <> '', 'Material not found');
  if coalesce(btrim(p ->> 'category'), '') = '' and coalesce(btrim(p ->> 'brand'), '') = '' and coalesce(btrim(p ->> 'sub_category'), '') = '' then
    delete from public.stock_item_overrides where material = btrim(p_material);
    return;
  end if;
  insert into public.stock_item_overrides (material, category, sub_category, class, sub_class, brand, note)
  values (btrim(p_material), nullif(btrim(p ->> 'category'), ''), nullif(btrim(p ->> 'sub_category'), ''), nullif(btrim(p ->> 'class'), ''),
          nullif(btrim(p ->> 'sub_class'), ''), nullif(btrim(p ->> 'brand'), ''), nullif(btrim(p ->> 'note'), ''))
  on conflict (material) do update set category = excluded.category, sub_category = excluded.sub_category, class = excluded.class,
    sub_class = excluded.sub_class, brand = excluded.brand, note = excluded.note, updated_by = auth.uid(), updated_at = now();
end $$;

-- Confirmed snapshots (values only for the roles that see them)
create or replace function public.stock_snapshot_list() returns table (id uuid, as_at date, profit_center text, item_count int, total_qty numeric,
  total_value numeric, aged_1y_value numeric, aged_2y_value numeric, confirmed_at timestamptz, replace_reason text)
language sql stable security definer set search_path = public as $$
  select s.id, s.as_at, s.profit_center, s.item_count, s.total_qty,
         case when app.stock_values_visible() then s.total_value end,
         case when app.stock_values_visible() then (select sum(v4 + v5 + v6) from public.stock_items i where i.snapshot_id = s.id) end,
         case when app.stock_values_visible() then (select sum(v6) from public.stock_items i where i.snapshot_id = s.id) end,
         s.confirmed_at, s.replace_reason
    from public.stock_snapshots s
   where s.status = 'confirmed' and app.stock_reader()
   order by s.as_at desc, s.profit_center
$$;

-- The lines of one snapshot with the corrected categories (values only for the roles that see them)
create or replace function public.stock_lines(p_snapshot uuid) returns table (material text, old_material text, mpn text, description text, uom text,
  category text, sub_category text, class text, sub_class text, brand text, corrected boolean, qty numeric, value numeric, unit_cost numeric,
  q1 numeric, q2 numeric, q3 numeric, q4 numeric, q5 numeric, q6 numeric, v1 numeric, v2 numeric, v3 numeric, v4 numeric, v5 numeric, v6 numeric,
  flags text[], prev_qty numeric, prev_value numeric)
language sql stable security definer set search_path = public as $$
  with s as (select * from public.stock_snapshots where id = p_snapshot and status in ('confirmed', 'preview', 'replaced')),
       prev as (select p.id from public.stock_snapshots p, s where p.profit_center = s.profit_center and p.status = 'confirmed' and p.as_at < s.as_at
                order by p.as_at desc limit 1)
  select i.material, i.old_material, i.mpn, i.description, i.uom,
         coalesce(o.category, i.category), coalesce(o.sub_category, i.sub_category), coalesce(o.class, i.class), coalesce(o.sub_class, i.sub_class),
         coalesce(o.brand, i.brand), o.material is not null, i.qty,
         case when app.stock_values_visible() then i.value end, case when app.stock_values_visible() then i.unit_cost end,
         i.q1, i.q2, i.q3, i.q4, i.q5, i.q6,
         case when app.stock_values_visible() then i.v1 end, case when app.stock_values_visible() then i.v2 end,
         case when app.stock_values_visible() then i.v3 end, case when app.stock_values_visible() then i.v4 end,
         case when app.stock_values_visible() then i.v5 end, case when app.stock_values_visible() then i.v6 end,
         i.flags, pi.qty, case when app.stock_values_visible() then pi.value end
    from public.stock_items i
    join s on s.id = i.snapshot_id
    left join public.stock_item_overrides o on o.material = i.material
    left join public.stock_items pi on pi.snapshot_id = (select id from prev) and pi.material = i.material
   where app.stock_reader() and (s.status = 'confirmed' or app.has_role('operations_exec'))
   order by i.v6 desc, i.value desc
$$;

-- One material across all confirmed snapshots
create or replace function public.stock_item_history(p_material text) returns table (as_at date, qty numeric, value numeric,
  q1 numeric, q2 numeric, q3 numeric, q4 numeric, q5 numeric, q6 numeric)
language sql stable security definer set search_path = public as $$
  select s.as_at, i.qty, case when app.stock_values_visible() then i.value end, i.q1, i.q2, i.q3, i.q4, i.q5, i.q6
    from public.stock_items i join public.stock_snapshots s on s.id = i.snapshot_id
   where i.material = p_material and s.status = 'confirmed' and app.stock_reader()
   order by s.as_at
$$;

-- Daily: the month's report not confirmed by the 5th → Operations reminded (once a day)
create or replace function public.stock_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare today date := (p_at at time zone app.tz())::date; month_end date := date_trunc('month', (p_at at time zone app.tz())::date)::date - 1;
begin
  if extract(day from today) < 5 then return 0; end if;
  if exists (select 1 from public.stock_snapshots where status = 'confirmed' and as_at = month_end) then return 0; end if;
  perform app.notify_many(app.role_users('operations_exec'), 'stock', 'SAP stock report not uploaded',
    format('Upload the SAP stock ageing report as at %s', to_char(month_end, 'DD Mon YYYY')), 'normal', null, null, '/stock/upload',
    format('stockdue:%s:%s', month_end, today));
  return 1;
end $$;

revoke execute on function public.stage_stock_upload(jsonb, jsonb), public.discard_stock_upload(uuid), public.confirm_stock_upload(uuid, text),
  public.set_stock_override(text, jsonb), public.stock_snapshot_list(), public.stock_lines(uuid), public.stock_item_history(text) from public, anon;
grant execute on function public.stage_stock_upload(jsonb, jsonb), public.discard_stock_upload(uuid), public.confirm_stock_upload(uuid, text),
  public.set_stock_override(text, jsonb), public.stock_snapshot_list(), public.stock_lines(uuid), public.stock_item_history(text) to authenticated;
revoke execute on function public.stock_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.stock_tick(timestamptz) to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('stock-tick', '20 8 * * *', 'select public.stock_tick()');
  end if;
end $$;

-- The original SAP Excel file is kept with the snapshot (attachment kind stock_file)
create or replace function app.can_write_attachment(p_entity_type text, p_entity_id uuid, p_kind text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role();
begin
  case p_entity_type
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
      or (r = 'sub_supervisor' and app.can_read_mr(p_entity_id) and (p_kind is null or p_kind in ('mr_doc', 'grn_photo')));
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
  else return false;
  end case;
end $$;

create or replace function app.can_read_attachment(a public.attachments) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); inq uuid; st text; mode int; released timestamptz;
begin
  if r is null then return false; end if;
  if a.uploaded_by = auth.uid() then return true; end if;
  case a.entity_type
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
    return exists (select 1 from public.exec_reports x where x.id = a.entity_id and (x.author_id = auth.uid() or app.is_exec_internal(x.exec_project_id)));
  when 'exec_worker' then
    return exists (select 1 from public.exec_workers x where x.id = a.entity_id and app.can_see_worker(x));
  when 'hse_record' then
    return exists (select 1 from public.hse_records x where x.id = a.entity_id and app.can_read_exec(x.exec_project_id));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = a.entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
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
      and (app.is_exec_internal(x.exec_project_id) or r in ('design_manager', 'lighting_designer', 'lighting_engineer')));
  when 'snag' then
    return exists (select 1 from public.snags x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
  when 'dossier_item' then
    return exists (select 1 from public.exec_dossier x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
  when 'test_record' then
    return exists (select 1 from public.test_records x where x.id = a.entity_id and app.is_exec_internal(x.exec_project_id));
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
  else
    return r = 'gm';
  end case;
end $$;
