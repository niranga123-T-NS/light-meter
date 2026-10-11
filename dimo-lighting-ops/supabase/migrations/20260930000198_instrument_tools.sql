-- Instruments and tools: the Operations Executive marks each item of the register as a measuring instrument or a tool.
-- Tools have no calibration: no calibration status or certificate, no "uncalibrated" alerts when requested or issued,
-- and they are not offered for test records. Everything else (requests, queue, issue, return, extension) is the same.

alter table public.instruments add column if not exists kind text not null default 'instrument' check (kind in ('instrument', 'tool'));

-- A tool counts as "fine" – the uncalibrated checks and alerts only apply to instruments
create or replace function app.instrument_calibrated(i public.instruments) returns boolean
language sql stable as $$ select i.kind = 'tool' or (i.cal_status = 'calibrated' and i.cal_expiry is not null and i.cal_expiry >= (now() at time zone app.tz())::date) $$;

-- Operations: add / edit (kind: instrument | tool; a tool's calibration details are cleared)
create or replace function public.save_instrument(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare iid uuid := nullif(p ->> 'id', '')::uuid; k text := coalesce(nullif(p ->> 'kind', ''), 'instrument');
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive keeps the instrument and tool list');
  perform app.require(k in ('instrument', 'tool'), 'Choose instrument or tool');
  perform app.require(coalesce(btrim(p ->> 'name'), '') <> '', 'Enter the name');
  if iid is null then
    insert into public.instruments (code, kind, name, category, make, model, serial_no, asset_no, range_spec, home, notes)
    values (app.next_code(case when k = 'tool' then 'TOL' else 'INS' end), k, btrim(p ->> 'name'), nullif(btrim(p ->> 'category'), ''), nullif(btrim(p ->> 'make'), ''),
            nullif(btrim(p ->> 'model'), ''), nullif(btrim(p ->> 'serial_no'), ''), nullif(btrim(p ->> 'asset_no'), ''), nullif(btrim(p ->> 'range_spec'), ''),
            nullif(btrim(p ->> 'home'), ''), nullif(btrim(p ->> 'notes'), ''))
    returning id into iid;
  else
    update public.instruments set kind = k, name = btrim(p ->> 'name'), category = nullif(btrim(p ->> 'category'), ''), make = nullif(btrim(p ->> 'make'), ''),
      model = nullif(btrim(p ->> 'model'), ''), serial_no = nullif(btrim(p ->> 'serial_no'), ''), asset_no = nullif(btrim(p ->> 'asset_no'), ''),
      range_spec = nullif(btrim(p ->> 'range_spec'), ''), home = nullif(btrim(p ->> 'home'), ''), notes = nullif(btrim(p ->> 'notes'), ''), updated_at = now()
    where id = iid and not removed;
    perform app.require(found, 'Not found');
  end if;
  if k = 'tool' then
    update public.instruments set cal_status = 'not_calibrated', cal_date = null, cal_expiry = null, cal_cert_no = null, cal_lab = null where id = iid;
  end if;
  return iid;
end $$;

-- Operations: calibration – instruments only
create or replace function public.set_instrument_calibration(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare st text := coalesce(p ->> 'status', 'calibrated'); ex date := nullif(p ->> 'expiry', '')::date;
begin
  perform app.require(app.has_role('operations_exec'), 'The Operations Executive records the calibration');
  perform app.require(exists (select 1 from public.instruments where id = p_id and kind = 'instrument'), 'Tools have no calibration');
  perform app.require(st in ('calibrated', 'not_calibrated'), 'Choose the calibration status');
  perform app.require(st = 'not_calibrated' or ex is not null, 'Enter the calibration expiry date');
  update public.instruments set cal_status = st, cal_date = case when st = 'calibrated' then nullif(p ->> 'date', '')::date end,
    cal_expiry = case when st = 'calibrated' then ex end, cal_cert_no = case when st = 'calibrated' then nullif(btrim(p ->> 'cert_no'), '') end,
    cal_lab = case when st = 'calibrated' then nullif(btrim(p ->> 'lab'), '') end, updated_at = now()
  where id = p_id and not removed;
  perform app.require(found, 'Instrument not found');
end $$;

-- Tests are recorded with a measuring instrument, not a tool
CREATE OR REPLACE FUNCTION public.record_test(p_exec uuid, p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ins public.instruments; r jsonb; v numeric; mn numeric; mx numeric; rows_out jsonb := '[]'; fail boolean := false; tid uuid; ok boolean; c text;
        unc boolean := false;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec), 'Assistant Engineers of the project record tests');
  perform app.require(coalesce(btrim(p ->> 'system'), '') <> '' and coalesce(btrim(p ->> 'test_type'), '') <> '', 'Enter the system and the test');
  if nullif(p ->> 'instrument_id', '') is not null then
    select * into ins from public.instruments where id = (p ->> 'instrument_id')::uuid and not removed;
    perform app.require(ins.id is not null, 'Unknown instrument');
    perform app.require(ins.condition = 'ok', format('%s is out of order – choose another instrument', ins.name));
    perform app.require(ins.kind = 'instrument', format('%s is a tool – choose a measuring instrument for the test', ins.name));
    unc := not app.instrument_calibrated(ins);
    perform app.require(not unc or coalesce((p ->> 'accept_uncalibrated')::boolean, false),
      format('%s is not calibrated%s – confirm that the test was done with an uncalibrated instrument', ins.name,
             case when ins.cal_expiry is not null then ' (expired ' || to_char(ins.cal_expiry, 'DD Mon YYYY') || ')' else '' end));
  end if;
  for r in select * from jsonb_array_elements(coalesce(p -> 'rows', '[]')) loop
    continue when coalesce(btrim(r ->> 'param'), '') = '';
    v := nullif(r ->> 'value', '')::numeric; mn := nullif(r ->> 'min', '')::numeric; mx := nullif(r ->> 'max', '')::numeric;
    perform app.require(v is not null, 'Enter the value for ' || (r ->> 'param'));
    ok := (mn is null or v >= mn) and (mx is null or v <= mx);
    fail := fail or not ok;
    rows_out := rows_out || jsonb_build_array(jsonb_build_object('param', btrim(r ->> 'param'), 'unit', r ->> 'unit', 'min', mn, 'max', mx, 'value', v, 'pass', ok));
  end loop;
  perform app.require(jsonb_array_length(rows_out) > 0 or coalesce(p ->> 'result', '') in ('pass', 'fail'), 'State the result (pass / fail) and upload the reading documents');
  fail := fail or coalesce(p ->> 'result', '') = 'fail';
  c := app.next_code('TST');
  insert into public.test_records (code, exec_project_id, area, system, test_type, instrument_id, uncalibrated, rows, result, witness, note)
  values (c, p_exec, nullif(p ->> 'area', ''), btrim(p ->> 'system'), btrim(p ->> 'test_type'), ins.id, unc, rows_out, case when fail then 'fail' else 'pass' end,
          nullif(btrim(p ->> 'witness'), ''), nullif(btrim(p ->> 'note'), ''))
  returning id into tid;
  if fail then
    insert into public.ncrs (code, exec_project_id, test_record_id, description, severity, owner_id, due_date)
    values (app.next_code('NCR'), p_exec, tid, format('Failed %s – %s (%s)', btrim(p ->> 'test_type'), btrim(p ->> 'system'), c), 'major', auth.uid(),
            (now() at time zone app.tz())::date + 7);
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_qa', 'Test failed – NCR raised', format('%s · %s · %s', c, btrim(p ->> 'system'), app.exec_head(p_exec)),
      'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=qa', null, true);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_qa', 'Test record to verify', format('%s · %s · %s', c, btrim(p ->> 'system'), app.exec_head(p_exec)),
      'normal', 'exec_project', p_exec, '/execution/' || p_exec || '?tab=qa');
  end if;
  if unc then
    perform app.notify_many(app.role_users('senior_elec_engineer') || app.role_users('operations_exec'), 'instrument', 'Test done with an uncalibrated instrument',
      format('%s · %s %s · %s · %s', c, btrim(p ->> 'test_type'), btrim(p ->> 'system'), app.instrument_head(ins), app.exec_head(p_exec)),
      'critical', 'instrument', ins.id, app.instrument_url(ins.id), null, true);
    perform app.notify(auth.uid(), 'instrument', 'You recorded a test with an uncalibrated instrument',
      format('%s · %s – the readings may not be accepted', c, app.instrument_head(ins)), 'critical', 'instrument', ins.id, app.instrument_url(ins.id));
  end if;
  return tid;
end $function$;
