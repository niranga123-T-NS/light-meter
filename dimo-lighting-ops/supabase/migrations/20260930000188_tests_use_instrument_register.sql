-- QA test records use the Instruments register (migration 186) instead of the old test_instruments list.
--  * The old list is copied into the register once (matched by serial number), and existing test records point to the register.
--  * An instrument that is not calibrated (or whose calibration expired) can be used for a test, but the engineer must confirm it;
--    the test is marked "uncalibrated", and the engineer, the Operations Executive and the SEE are alerted. Out of order or removed
--    instruments cannot be used.
--  * The old list is no longer edited (its save function is removed); the table is kept for history.

-- 1. Copy the old list into the register
create temporary table _ins_map (old_id uuid primary key, new_id uuid);

do $$
declare o record; nid uuid;
begin
  for o in select * from public.test_instruments order by name loop
    select id into nid from public.instruments
     where not removed and serial_no is not null and lower(btrim(serial_no)) = lower(btrim(o.serial_no))
     order by created_at limit 1;
    if nid is null then
      insert into public.instruments (code, name, model, serial_no, cal_status, cal_expiry, removed, removed_reason, notes)
      values (app.next_code('INS'), o.name, o.model, nullif(btrim(o.serial_no), ''),
              case when o.calibration_due is not null then 'calibrated' else 'not_calibrated' end, o.calibration_due,
              not o.active, case when not o.active then 'Not in use in the old test instrument list' end,
              'Moved from the old test instrument list')
      returning id into nid;
    end if;
    insert into _ins_map values (o.id, nid);
  end loop;
end $$;

-- 2. Test records point to the register
alter table public.test_records drop constraint if exists test_records_instrument_id_fkey;
update public.test_records t set instrument_id = m.new_id from _ins_map m where t.instrument_id = m.old_id;
update public.test_records set instrument_id = null
 where instrument_id is not null and not exists (select 1 from public.instruments i where i.id = instrument_id);
alter table public.test_records add constraint test_records_instrument_id_fkey foreign key (instrument_id) references public.instruments (id);
alter table public.test_records add column if not exists uncalibrated boolean not null default false;
drop table _ins_map;
comment on table public.test_instruments is 'Replaced by public.instruments (migration 188) – kept for history only';

-- 3. The old list is no longer edited
drop function if exists public.save_instrument(uuid, text, text, text, date, boolean);

-- 4. Record a test with an instrument from the register
-- p: {area, system, test_type, instrument_id, accept_uncalibrated, witness, note, result, rows: [{param, unit, min, max, value}]}
create or replace function public.record_test(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare ins public.instruments; r jsonb; v numeric; mn numeric; mx numeric; rows_out jsonb := '[]'; fail boolean := false; tid uuid; ok boolean; c text;
        unc boolean := false;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec), 'Assistant Engineers of the project record tests');
  perform app.require(coalesce(btrim(p ->> 'system'), '') <> '' and coalesce(btrim(p ->> 'test_type'), '') <> '', 'Enter the system and the test');
  if nullif(p ->> 'instrument_id', '') is not null then
    select * into ins from public.instruments where id = (p ->> 'instrument_id')::uuid and not removed;
    perform app.require(ins.id is not null, 'Unknown instrument');
    perform app.require(ins.condition = 'ok', format('%s is out of order – choose another instrument', ins.name));
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
end $$;
