-- Test readings are uploaded as documents (readings sheet, instrument printout, photos, witness-signed sheet …) instead of
-- typed in: the engineer states the result (pass / fail); a fail still raises an NCR. Typed readings remain possible.

create or replace function public.record_test(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare ins public.test_instruments; r jsonb; v numeric; mn numeric; mx numeric; rows_out jsonb := '[]'; fail boolean := false; tid uuid; ok boolean; c text;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec), 'Assistant Engineers of the project record tests');
  perform app.require(coalesce(btrim(p ->> 'system'), '') <> '' and coalesce(btrim(p ->> 'test_type'), '') <> '', 'Enter the system and the test');
  if nullif(p ->> 'instrument_id', '') is not null then
    select * into ins from public.test_instruments where id = (p ->> 'instrument_id')::uuid;
    perform app.require(ins.id is not null and ins.active, 'Unknown instrument');
    perform app.require(ins.calibration_due >= (now() at time zone app.tz())::date,
      format('Calibration of %s (%s) expired on %s – the test cannot be saved', ins.name, ins.serial_no, to_char(ins.calibration_due, 'DD Mon YYYY')));
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
  insert into public.test_records (code, exec_project_id, area, system, test_type, instrument_id, rows, result, witness, note)
  values (c, p_exec, nullif(p ->> 'area', ''), btrim(p ->> 'system'), btrim(p ->> 'test_type'), ins.id, rows_out, case when fail then 'fail' else 'pass' end,
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
  return tid;
end $$;
