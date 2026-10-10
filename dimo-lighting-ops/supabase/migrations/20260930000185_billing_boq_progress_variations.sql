-- Bill tab: progress on the BOQ items for SAP, the client's adjustments, variations in the BOQ and the variation pipeline.
--  * The IPA / IPC and the invoice are made in SAP – the app keeps the measured progress per BOQ item (the AE), the physical
--    IPA submitted to the client / consultant (the SEE) and their certification, where quantities and the amount may be adjusted.
--  * Non-BOQ items: a variation approved by the client / consultant is added by the SEE (description and amounts) – it shows in
--    the BOQ as a separate variation section, and the AE measures it separately.
--  * Pending variations (with Design, Estimation, DIMO approval, to submit, with the client / consultant) are tracked against an
--    agreed date: the SEE is reminded; past the agreed date SM Projects and DGM / GM are told.

alter table public.exec_ipcs drop constraint if exists exec_ipcs_status_check;
alter table public.exec_ipcs add constraint exec_ipcs_status_check check (status in ('prepared', 'submitted', 'certified', 'returned'));
alter table public.exec_ipcs add column if not exists submitted_on date;
alter table public.exec_ipcs add column if not exists submitted_ref text;
alter table public.exec_ipcs add column if not exists submitted_by uuid references public.profiles (id);
alter table public.exec_ipcs add column if not exists cert_date date;
alter table public.exec_ipcs add column if not exists cert_ref text;
alter table public.exec_ipcs add column if not exists adjusted boolean not null default false;
alter table public.exec_ipc_lines add column if not exists cert_qty numeric(16, 3) check (cert_qty is null or cert_qty >= 0);

alter table public.variations add column if not exists dimo_due date;
alter table public.variations add column if not exists client_due date;
alter table public.variations add column if not exists client_submitted_on date;
alter table public.variations add column if not exists client_submit_ref text;
alter table public.variations add column if not exists client_value_lkr numeric(16, 2);
alter table public.variations add column if not exists late_key text;
alter table public.variations add column if not exists direct boolean not null default false;

-- Where a pending variation is, and the date agreed for that step
create or replace function app.variation_stage(v public.variations) returns text
language sql stable as $$
  select case
    when v.status = 'raised' then 'screening'
    when v.status = 'pricing' and v.route = 'A' and coalesce(v.inquiry_status, 'submitted') in ('draft', 'submitted', 'accepted', 'returned_for_info', 'in_design', 'design_review') then 'design'
    when v.status = 'pricing' then 'estimation'
    when v.status in ('pending_smp', 'pending_gm') then 'dimo_approval'
    when v.status = 'approved' and v.client_submitted_on is null then 'to_submit'
    when v.status = 'approved' then 'with_client'
    else 'closed' end
$$;
create or replace function app.variation_due(v public.variations) returns date
language sql stable as $$
  select case app.variation_stage(v)
    when 'screening' then (v.raised_at at time zone app.tz())::date + 3
    when 'with_client' then v.client_due
    when 'closed' then null
    else v.dimo_due end
$$;
create or replace function app.variation_stage_label(p text) returns text
language sql immutable as $$
  select case p when 'screening' then 'SEE to screen' when 'design' then 'With Design (DIMO)' when 'estimation' then 'With Estimation (DIMO)'
    when 'dimo_approval' then 'DIMO approval (SM Projects / DGM)' when 'to_submit' then 'DIMO part done – submit to the client / consultant'
    when 'with_client' then 'With the client / consultant' else p end
$$;

-- The agreed date of DIMO's part: the date the price is needed by (variation inquiry), or a week from screening (contract rates)
create or replace function app.variation_due_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.dimo_due is null and new.inquiry_id is not null then
    select customer_deadline into new.dimo_due from public.inquiries where id = new.inquiry_id;
  end if;
  if new.dimo_due is null and new.route = 'C' and new.screened_at is not null then
    new.dimo_due := (new.screened_at at time zone app.tz())::date + 7;
  end if;
  return new;
end $$;
drop trigger if exists variation_due on public.variations;
create trigger variation_due before insert or update on public.variations for each row execute function app.variation_due_trg();
update public.variations set dimo_due = dimo_due where dimo_due is null and status in ('pricing', 'pending_smp', 'pending_gm', 'approved');

-- The project's variations with their stage, agreed date and next action
create or replace function public.project_variations(p_exec uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone app.tz())::date;
begin
  perform app.require(app.is_exec_internal(p_exec) or app.has_role('gm'), 'Not your project');
  return coalesce((select jsonb_agg(x order by x ->> 'sort', x ->> 'code') from (
    select jsonb_build_object('id', v.id, 'code', v.code, 'title', v.title, 'vtype', v.vtype, 'status', v.status, 'route', v.route, 'vo_no', v.vo_no,
      'value_lkr', case when app.sees_billing() then v.value_lkr end, 'client_value_lkr', case when app.sees_billing() then v.client_value_lkr end,
      'stage', st.s, 'stage_label', app.variation_stage_label(st.s), 'due', st.d, 'days_late', case when st.d is not null and today > st.d then today - st.d else 0 end,
      'inquiry_status', v.inquiry_status, 'dimo_due', v.dimo_due, 'client_due', v.client_due, 'client_submitted_on', v.client_submitted_on,
      'client_submit_ref', v.client_submit_ref, 'client_at', v.client_at, 'direct', v.direct, 'raised_at', v.raised_at,
      'design_done', v.route = 'A' and st.s not in ('screening', 'design'), 'estimation_done', st.s in ('dimo_approval', 'to_submit', 'with_client', 'closed') and v.route in ('A', 'B'),
      'sort', case st.s when 'closed' then '9' else '1' end) x
    from public.variations v cross join lateral (select app.variation_stage(v) s, app.variation_due(v) d) st
    where v.exec_project_id = p_exec) q), '[]');
end $$;

-- The SEE submitted the priced variation to the client / consultant, with the date agreed for their answer
create or replace function public.submit_variation_to_client(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v public.variations; d date; due date;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'The Senior Electrical Engineer submits variations to the client');
  select * into v from public.variations where id = p_id for update;
  perform app.require(v.id is not null and v.status = 'approved', 'Only a variation approved in DIMO goes to the client');
  d := coalesce(nullif(p ->> 'date', '')::date, (now() at time zone app.tz())::date);
  due := nullif(p ->> 'due', '')::date;
  perform app.require(due is not null and due >= d, 'Set the date agreed for the client / consultant''s answer');
  update public.variations set client_submitted_on = d, client_due = due, client_submit_ref = nullif(btrim(p ->> 'ref'), ''), late_key = null where id = v.id;
end $$;

-- The SEE moves the agreed date of the current step (with the reason; SM Projects is told)
create or replace function public.set_variation_due(p_id uuid, p_due date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.variations; st text;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'The Senior Electrical Engineer sets the agreed dates');
  select * into v from public.variations where id = p_id for update;
  st := app.variation_stage(v);
  perform app.require(st not in ('closed', 'screening'), 'This variation has no open step with an agreed date');
  perform app.require(p_due is not null and coalesce(btrim(p_reason), '') <> '', 'Give the new date and the reason');
  if st = 'with_client' then update public.variations set client_due = p_due, late_key = null where id = v.id;
  else update public.variations set dimo_due = p_due, late_key = null where id = v.id; end if;
  perform app.notify_many(array_remove(app.role_users('sm_projects'), auth.uid()), 'exec_variation', 'Variation date moved',
    format('%s · %s → %s · %s', app.variation_head(v), app.variation_stage_label(st), to_char(p_due, 'DD Mon YYYY'), btrim(p_reason)),
    'normal', 'variation', v.id, '/execution/variation/' || v.id);
end $$;

-- An accepted variation: order book (secured project) and the BOQ (a separate variation section, measured separately)
-- p_lines: [{description, unit, qty, rate, amount}] – none: the contract-rate items picked at screening, or one lump sum
create or replace function app.variation_accepted(p_id uuid, p_vo text, p_value numeric, p_lines jsonb, p_month date) returns text
language plpgsql security definer set search_path = public as $$
declare v public.variations; s public.secured_projects; sv uuid; msg text := 'recorded'; nxt int; sect text; x jsonb; q numeric; r numeric; a numeric; k int := 0;
begin
  select * into v from public.variations where id = p_id;
  select s2.* into s from public.secured_projects s2 join public.exec_projects e on e.secured_id = s2.id where e.id = v.exec_project_id;
  if s.id is not null and s.status = 'open' and s.schedule_status = 'approved' and coalesce(p_value, 0) <> 0 then
    insert into public.secured_variations (secured_id, vo_no, amount, month, reason, status, decided_by, decided_at, decision_note)
    values (s.id, p_vo, p_value, app.month_of(coalesce(p_month, current_date)), 'Execution variation ' || v.code || ' – ' || v.title, 'approved',
            coalesce(v.gm_by, v.smp_by, auth.uid()), now(), case when v.direct then 'Approved by the client – added by the SEE' else 'Approved in the execution module' end)
    returning id into sv;
    perform app.apply_variation(sv);
    update public.variations set secured_variation_id = sv where id = v.id;
    msg := 'secured_updated';
  end if;
  if exists (select 1 from public.exec_boqs where exec_project_id = v.exec_project_id and version > 0) and coalesce(p_value, 0) <> 0 then
    select coalesce(max(seq), 0) into nxt from public.exec_boq_items where exec_project_id = v.exec_project_id;
    sect := left('Variation ' || p_vo || ' – ' || v.title, 120);
    if jsonb_array_length(coalesce(p_lines, '[]')) > 0 then
      for x in select * from jsonb_array_elements(p_lines) loop
        k := k + 1;
        q := nullif(x ->> 'qty', '')::numeric; r := nullif(x ->> 'rate', '')::numeric; a := nullif(x ->> 'amount', '')::numeric;
        if q is not null and r is not null then a := round(q * r, 2); elsif a is not null then q := 1; r := a; end if;
        insert into public.exec_boq_items (exec_project_id, seq, section, item_no, description, unit, qty, rate, amount, source, variation_id)
        values (v.exec_project_id, nxt + k, sect, p_vo || '/' || k, btrim(x ->> 'description'), coalesce(nullif(btrim(x ->> 'unit'), ''), 'sum'),
                case when v.vtype = 'omission' then -abs(q) else q end, r, case when v.vtype = 'omission' then -abs(a) else a end, 'variation', v.id);
      end loop;
    elsif exists (select 1 from public.exec_variation_boq where variation_id = v.id) then
      insert into public.exec_boq_items (exec_project_id, seq, section, item_no, description, unit, qty, rate, amount, source, variation_id)
      select v.exec_project_id, nxt + row_number() over (order by i.seq), sect, p_vo || ' / ' || coalesce(i.item_no, ''),
             i.description, i.unit, case when v.vtype = 'omission' then -b.qty else b.qty end, b.rate,
             round(case when v.vtype = 'omission' then -b.qty else b.qty end * b.rate, 2), 'variation', v.id
      from public.exec_variation_boq b join public.exec_boq_items i on i.id = b.boq_item_id where b.variation_id = v.id;
    else
      insert into public.exec_boq_items (exec_project_id, seq, section, item_no, description, unit, qty, rate, amount, source, variation_id)
      values (v.exec_project_id, nxt + 1, sect, p_vo, v.title, 'sum', case when p_value < 0 then -1 else 1 end, abs(p_value), p_value, 'variation', v.id);
    end if;
    perform app.boq_total(v.exec_project_id);
  end if;
  perform app.notify_many(array_remove(app.role_users('sm_projects', 'operations_exec') || array[s.sales_person_id], auth.uid()), 'exec_variation', 'Variation approved by the client',
    concat_ws(' · ', app.variation_head(v), 'VO ' || p_vo, app.fmt_money(p_value, 'LKR'),
              case when msg = 'secured_updated' then 'order value and invoice schedule updated' else 'update the secured project / invoice schedule' end),
    'normal', 'variation', v.id, '/execution/variation/' || v.id);
  return msg;
end $$;

-- The client / consultant's answer; the value may be adjusted by them, and the SEE writes the BOQ lines (description, amounts)
create or replace function public.record_variation_client(p_id uuid, p_accepted boolean, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v public.variations; val numeric; ls jsonb := coalesce(p -> 'lines', '[]'); x jsonb; tot numeric := 0;
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'The Senior Electrical Engineer records the client''s answer');
  select * into v from public.variations where id = p_id for update;
  perform app.require(v.id is not null and v.status = 'approved', 'Only a variation approved in DIMO goes to the client');
  if not p_accepted then
    perform app.require(coalesce(btrim(p ->> 'note'), '') <> '', 'Give the client''s reason');
    update public.variations set status = 'client_rejected', client_at = coalesce(nullif(p ->> 'date', '')::date, current_date), client_note = btrim(p ->> 'note') where id = v.id;
    return 'client_rejected';
  end if;
  perform app.require(coalesce(btrim(p ->> 'vo_no'), '') <> '', 'Enter the variation order (VO) number');
  perform app.require(app.has_attachment('variation', v.id, 'var_doc'), 'Attach the signed variation order or the client''s letter');
  for x in select * from jsonb_array_elements(ls) loop
    perform app.require(coalesce(btrim(x ->> 'description'), '') <> '', 'Describe each line');
    tot := tot + coalesce(nullif(x ->> 'qty', '')::numeric * nullif(x ->> 'rate', '')::numeric, nullif(x ->> 'amount', '')::numeric, 0);
  end loop;
  val := coalesce(nullif(p ->> 'value', '')::numeric, case when jsonb_array_length(ls) > 0 then tot end, v.value_lkr);
  perform app.require(val is not null and val <> 0, 'Enter the value approved by the client / consultant');
  val := case when v.vtype = 'omission' then -abs(val) else abs(val) end;
  update public.variations set status = 'client_accepted', vo_no = btrim(p ->> 'vo_no'), client_at = coalesce(nullif(p ->> 'date', '')::date, current_date),
    client_note = nullif(btrim(p ->> 'note'), ''), client_value_lkr = val where id = v.id;
  return app.variation_accepted(v.id, btrim(p ->> 'vo_no'), val, ls, nullif(p ->> 'month', '')::date);
end $$;

-- A variation already approved by the client / consultant (not raised in the app): the SEE adds it with its lines
create or replace function public.add_approved_variation(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v public.variations; ls jsonb := coalesce(p -> 'lines', '[]'); x jsonb; tot numeric := 0; q numeric; r numeric; a numeric;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer adds approved variations');
  perform app.require(exists (select 1 from public.exec_boqs where exec_project_id = p_exec and version > 0), 'Upload the contract BOQ and have it approved first');
  perform app.require(coalesce(btrim(p ->> 'vo_no'), '') <> '' and coalesce(btrim(p ->> 'title'), '') <> '', 'Enter the VO number and the title');
  perform app.require(jsonb_array_length(ls) > 0, 'Add the lines – description and amount');
  perform app.require(not exists (select 1 from public.variations where exec_project_id = p_exec and vo_no = btrim(p ->> 'vo_no') and status = 'client_accepted'),
    'This VO number is already in the BOQ');
  for x in select * from jsonb_array_elements(ls) loop
    perform app.require(coalesce(btrim(x ->> 'description'), '') <> '', 'Describe each line');
    q := nullif(x ->> 'qty', '')::numeric; r := nullif(x ->> 'rate', '')::numeric; a := nullif(x ->> 'amount', '')::numeric;
    perform app.require((q is not null and r is not null) or a is not null, 'Give each line a quantity and rate, or an amount');
    tot := tot + coalesce(q * r, a);
  end loop;
  perform app.require(tot <> 0, 'The variation has no value');
  insert into public.variations (code, exec_project_id, vtype, reason, title, description, client_ref, status, vo_no, client_at, client_note, value_lkr, client_value_lkr, direct)
  values (app.next_code('VAR'), p_exec, case when coalesce(p ->> 'vtype', '') = 'omission' then 'omission' else 'addition' end, 'client_instruction',
          btrim(p ->> 'title'), coalesce(nullif(btrim(p ->> 'description'), ''), btrim(p ->> 'title')), nullif(btrim(p ->> 'client_ref'), ''), 'client_accepted',
          btrim(p ->> 'vo_no'), coalesce(nullif(p ->> 'date', '')::date, current_date), nullif(btrim(p ->> 'note'), ''),
          case when p ->> 'vtype' = 'omission' then -abs(tot) else abs(tot) end, case when p ->> 'vtype' = 'omission' then -abs(tot) else abs(tot) end, true)
  returning * into v;
  perform app.variation_accepted(v.id, v.vo_no, v.client_value_lkr, ls, nullif(p ->> 'month', '')::date);
  return v.id;
end $$;

-- Pending variations: a reminder to the SEE two days before the agreed date; past it, the SEE, SM Projects and DGM / GM
create or replace function public.variations_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare r record; today date := (p_at at time zone app.tz())::date; n int := 0; k text;
begin
  for r in select v.*, e.see_id, e.name pname, app.variation_stage(v) st, app.variation_due(v) due
           from public.variations v join public.exec_projects e on e.id = v.exec_project_id
           where e.status = 'active' and v.status in ('raised', 'pricing', 'pending_smp', 'pending_gm', 'approved') loop
    continue when r.due is null;
    if today > r.due then
      k := r.st || ':' || r.due;
      continue when r.late_key is not distinct from k;
      perform app.notify_many(array_remove(array[r.see_id] || app.role_users('sm_projects', 'gm'), null), 'exec_variation', 'Variation late – ' || app.variation_stage_label(r.st),
        format('%s · %s · %s · agreed %s, %s day(s) late', r.pname, r.code, r.title, to_char(r.due, 'DD Mon'), today - r.due), 'critical', 'variation', r.id,
        '/execution/variation/' || r.id, 'varlate:' || r.id || ':' || k, true);
      update public.variations set late_key = k where id = r.id;
      n := n + 1;
    elsif r.due - today <= 2 and r.see_id is not null then
      perform app.notify(r.see_id, 'exec_variation', 'Variation due – ' || app.variation_stage_label(r.st),
        format('%s · %s · %s · agreed %s', r.pname, r.code, r.title, to_char(r.due, 'DD Mon')), 'normal', 'variation', r.id,
        '/execution/variation/' || r.id, 'vardue:' || r.id || ':' || r.st || ':' || r.due);
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.variations_tick(timestamptz) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('variations-tick', '30 2 * * *', 'select public.variations_tick()');
  end if;
end $$;

-- IPA: the SEE records the physical IPA submitted to the client / consultant
create or replace function public.submit_ipc_to_client(p_id uuid, p_date date, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.exec_ipcs;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer submits the IPA');
  select * into c from public.exec_ipcs where id = p_id for update;
  perform app.require(c.id is not null and c.status = 'prepared', 'Not waiting to be submitted');
  update public.exec_ipcs set status = 'submitted', submitted_on = coalesce(p_date, (now() at time zone app.tz())::date), submitted_ref = nullif(btrim(p_ref), ''),
    submitted_by = auth.uid() where id = c.id;
end $$;

-- The client / consultant's certification: quantities adjusted per item and the amount certified
-- p: {date, ref, note, value, lines: [{boq_item_id, cert_qty}]}
create or replace function public.record_ipc_certification(p_id uuid, p jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare c public.exec_ipcs; e public.exec_projects; x jsonb; it public.exec_boq_items; gross numeric; mos numeric; prev numeric; val numeric; adj boolean := false; ln uuid;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer records the certification');
  select * into c from public.exec_ipcs where id = p_id for update;
  perform app.require(c.id is not null and c.status in ('prepared', 'submitted'), 'Not waiting for certification');
  for x in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    select * into it from public.exec_boq_items where id = (x ->> 'boq_item_id')::uuid and exec_project_id = c.exec_project_id and not heading;
    perform app.require(it.id is not null, 'Choose items of this project''s BOQ');
    perform app.require(coalesce((x ->> 'cert_qty')::numeric, -1) >= 0, format('Enter the certified quantity for %s', coalesce(it.item_no, it.description)));
    insert into public.exec_ipc_lines (ipc_id, boq_item_id, qty_to_date, cert_qty) values (c.id, it.id, 0, (x ->> 'cert_qty')::numeric)
    on conflict (ipc_id, boq_item_id) do update set cert_qty = excluded.cert_qty;
  end loop;
  select exists (select 1 from public.exec_ipc_lines where ipc_id = c.id and cert_qty is not null and cert_qty <> qty_to_date) into adj;
  select coalesce(sum(coalesce(l.cert_qty, l.qty_to_date) * coalesce(i.rate, 0)), 0) into gross from public.exec_ipc_lines l join public.exec_boq_items i on i.id = l.boq_item_id where l.ipc_id = c.id;
  select coalesce(mos_value, 0), coalesce(previous_certified, 0) into mos, prev from public.exec_ipc_values where ipc_id = c.id;
  val := nullif(replace(coalesce(p ->> 'value', ''), ',', ''), '')::numeric;
  if val is null then
    perform app.require(exists (select 1 from public.exec_ipc_lines where ipc_id = c.id), 'Enter the amount certified');
    val := round(gross + coalesce(mos, 0) - coalesce(prev, 0), 2);
  end if;
  update public.exec_ipcs set status = 'certified', certified_value = val, certified_at = now(), certified_by = auth.uid(), cert_date = coalesce(nullif(p ->> 'date', '')::date, current_date),
    cert_ref = nullif(btrim(p ->> 'ref'), ''), note = coalesce(nullif(btrim(p ->> 'note'), ''), note),
    adjusted = adj or (nullif(p ->> 'value', '') is not null and abs(val - round(gross + coalesce(mos, 0) - coalesce(prev, 0), 2)) >= 1)
  where id = c.id;
  -- The invoicing plan: the earliest open line invoiced on the progress claim is ready for the invoice in SAP
  select * into e from public.exec_projects where id = c.exec_project_id;
  select t.line_id into ln from public.exec_invoice_triggers t join public.invoice_lines l on l.id = t.line_id
   where t.exec_project_id = c.exec_project_id and t.kind = 'ipc' and t.ready_at is null and app.line_open(l.id) > 0 order by l.forecast_month, l.seq limit 1;
  if ln is not null then
    update public.exec_ipcs set line_id = ln where id = c.id;
    perform app.mark_invoice_ready(ln, format('%s certified %s', c.code, app.fmt_money(val, 'LKR')));
  end if;
  perform app.notify(c.prepared_by, 'exec_ipc', 'Progress claim certified' || case when adj then ' – quantities adjusted' else '' end,
    concat_ws(' · ', app.exec_head(c.exec_project_id), c.code, to_char(c.period, 'Mon YYYY')), 'normal', 'exec_project', c.exec_project_id, '/execution/claim/' || c.id);
  return val;
end $$;

-- Progress per BOQ item: contract quantity, measured to date (last measurement), the one before, certified to date
create or replace function public.boq_progress(p_exec uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare money boolean := app.sees_billing(); lastm uuid; prevm uuid; lastc uuid;
begin
  perform app.require(money or app.is_exec_internal(p_exec), 'Not your project');
  select id into lastm from public.exec_ipcs where exec_project_id = p_exec and status <> 'returned' order by prepared_at desc, code desc limit 1;
  select id into prevm from public.exec_ipcs where exec_project_id = p_exec and status <> 'returned' and id <> coalesce(lastm, gen_random_uuid()) order by prepared_at desc, code desc limit 1;
  select id into lastc from public.exec_ipcs where exec_project_id = p_exec and status = 'certified' order by prepared_at desc, code desc limit 1;
  return jsonb_build_object(
    'last', (select jsonb_build_object('id', id, 'code', code, 'period', period, 'status', status) from public.exec_ipcs where id = lastm),
    'certified', (select jsonb_build_object('id', id, 'code', code, 'period', period, 'cert_date', cert_date) from public.exec_ipcs where id = lastc),
    'certified_total', case when money then (select coalesce(sum(certified_value), 0) from public.exec_ipcs where exec_project_id = p_exec and status = 'certified') end,
    'items', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', i.id, 'section', i.section, 'item_no', i.item_no, 'description', i.description, 'unit', i.unit,
        'qty', i.qty, 'heading', i.heading, 'source', i.source, 'variation_id', i.variation_id,
        'to_date', (select qty_to_date from public.exec_ipc_lines where ipc_id = lastm and boq_item_id = i.id),
        'prev', (select qty_to_date from public.exec_ipc_lines where ipc_id = prevm and boq_item_id = i.id),
        'cert', (select coalesce(cert_qty, qty_to_date) from public.exec_ipc_lines where ipc_id = lastc and boq_item_id = i.id),
        'rate', case when money then i.rate end, 'amount', case when money then i.amount end)) order by i.seq)
      from public.exec_boq_items i where i.exec_project_id = p_exec and not i.removed
        and exists (select 1 from public.exec_boqs b where b.exec_project_id = p_exec and b.version > 0)), '[]'));
end $$;


create or replace function public.claim_context(p_exec uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b public.exec_boqs; last uuid;
begin
  perform app.require(app.is_exec_internal(p_exec), 'Not your project');
  select * into b from public.exec_boqs where exec_project_id = p_exec;
  select id into last from public.exec_ipcs where exec_project_id = p_exec and status <> 'returned' order by prepared_at desc, code desc limit 1;
  return jsonb_build_object(
    'boq', case when b.exec_project_id is null then null else jsonb_build_object('status', b.status, 'version', b.version, 'mos_pct', b.mos_pct) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'section', i.section, 'item_no', i.item_no, 'description', i.description, 'unit', i.unit,
                                                           'qty', i.qty, 'heading', i.heading, 'source', i.source,
                                                           'last_qty', (select qty_to_date from public.exec_ipc_lines where ipc_id = last and boq_item_id = i.id)) order by i.seq)
                       from public.exec_boq_items i where i.exec_project_id = p_exec and not i.removed and b.version > 0), '[]'),
    'store', coalesce((select jsonb_agg(jsonb_build_object('item', s.item, 'unit', s.unit, 'balance', s.bal) order by s.item)
                       from (select min(item) item, min(unit) unit, sum(case when kind in ('receipt', 'return', 'transfer_in') then qty else -qty end) bal
                             from public.store_moves where exec_project_id = p_exec group by lower(item)) s where s.bal > 0), '[]'),
    'last_mos', coalesce((select jsonb_agg(jsonb_build_object('item', m.item, 'unit', m.unit, 'qty', m.qty, 'boq_item_id', m.boq_item_id))
                          from public.exec_ipc_mos m where m.ipc_id = last), '[]'));
end $$;

create or replace function public.ipc_detail(p_ipc uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.exec_ipcs; money boolean := app.sees_billing(); prevc uuid; pct numeric;
begin
  select * into c from public.exec_ipcs where id = p_ipc;
  perform app.require(c.id is not null and (money or app.is_exec_internal(c.exec_project_id)), 'Not your project');
  select id into prevc from public.exec_ipcs where exec_project_id = c.exec_project_id and status = 'certified' and id <> c.id and prepared_at <= c.prepared_at order by prepared_at desc, code desc limit 1;
  select mos_pct into pct from public.exec_boqs where exec_project_id = c.exec_project_id;
  return jsonb_strip_nulls(jsonb_build_object(
    'lines', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('boq_item_id', i.id, 'section', i.section, 'item_no', i.item_no, 'description', i.description,
        'unit', i.unit, 'boq_qty', i.qty, 'qty_to_date', l.qty_to_date, 'cert_qty', l.cert_qty, 'source', i.source,
        'prev_qty', (select p.qty_to_date from public.exec_ipc_lines p where p.ipc_id = prevc and p.boq_item_id = i.id),
        'rate', case when money then i.rate end, 'value', case when money then round(l.qty_to_date * coalesce(i.rate, 0), 2) end)) order by i.seq)
      from public.exec_ipc_lines l join public.exec_boq_items i on i.id = l.boq_item_id where l.ipc_id = p_ipc), '[]'),
    'mos', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('item', m.item, 'unit', m.unit, 'qty', m.qty, 'boq_item_id', m.boq_item_id,
        'boq_item', concat_ws(' ', i.item_no, i.description), 'rate', case when money then i.rate end,
        'value', case when money then round(m.qty * coalesce(i.rate, 0) * coalesce(pct, 0) / 100, 2) end)) order by m.item)
      from public.exec_ipc_mos m join public.exec_boq_items i on i.id = m.boq_item_id where m.ipc_id = p_ipc), '[]'),
    'mos_pct', pct,
    'values', case when money then (select to_jsonb(v) - 'ipc_id' from public.exec_ipc_values v where v.ipc_id = p_ipc) end));
end $$;

create or replace function app.mark_invoice_ready(p_line uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.exec_invoice_triggers; l public.invoice_lines; s public.secured_projects;
begin
  select * into t from public.exec_invoice_triggers where line_id = p_line for update;
  if t.line_id is null or t.ready_at is not null or app.line_open(p_line) <= 0 then return; end if;
  update public.exec_invoice_triggers set claimable_at = coalesce(claimable_at, now()) where line_id = p_line;
  select * into l from public.invoice_lines where id = p_line;
  select * into s from public.secured_projects where id = l.secured_id;
  update public.exec_invoice_triggers set ready_at = now(), ready_note = p_note where line_id = p_line;
  insert into public.secured_log (secured_id, action, note) values (s.id, 'ready_to_invoice', concat_ws(' · ', coalesce(l.description, initcap(l.kind)), p_note));
  perform app.notify_many(app.role_users('operations_exec', 'sm_projects'), 'invoice_ready', 'Certified – raise the invoice in SAP – ' || s.project_name,
    concat_ws(' · ', coalesce(l.description, initcap(l.kind)), app.fmt_money(app.line_open(p_line), 'LKR'), p_note), 'normal', 'secured_project', s.id,
    app.secured_url(s.id), 'ready:' || p_line || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint, true);
end $$;

-- Invoice line certified by the client (the IPA itself is made in SAP): ready for the invoice
create or replace function public.confirm_line_certified(p_exec uuid, p_line uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer confirms the certification');
  perform app.require(exists (select 1 from public.exec_invoice_triggers t join public.exec_projects e on e.id = t.exec_project_id
                              join public.invoice_lines l on l.id = t.line_id and l.secured_id = e.secured_id
                              where t.line_id = p_line and t.exec_project_id = p_exec and t.claimable_at is not null), 'The work for this invoice is not done yet');
  perform app.mark_invoice_ready(p_line, coalesce(nullif(btrim(p_note), ''), 'Certified by the client / consultant'));
end $$;
