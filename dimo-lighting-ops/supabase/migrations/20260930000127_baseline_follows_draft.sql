-- Programme baseline: follows the start / finish dates while the programme is a draft (being prepared or revised) and is
-- fixed when the SEE submits it; SM Projects' approval records it as the next baseline version.
-- (app.schedule copied from 20260930000112_programme_tracking.sql)

create or replace function app.schedule(p_exec uuid) returns date
language plpgsql security definer set search_path = public as $$
declare pg public.exec_programmes; cal date[]; tidx int; n int; i int; pf int; v_finish date; wd int[];
begin
  select * into pg from public.exec_programmes where exec_project_id = p_exec;
  if pg.exec_project_id is null then return null; end if;
  wd := coalesce((select array_agg(x::int) from jsonb_array_elements_text(app.setting('working_hours') -> 'days') x), array[1, 2, 3, 4, 5]);
  select array_agg(d order by d) into cal
  from (select g::date d from generate_series(pg.start_date, pg.start_date + 5000, interval '1 day') g) c
  where extract(isodow from d)::int = any (wd) and not exists (select 1 from public.holidays h where h.day = c.d);
  tidx := (select count(*) from unnest(cal) c where c < (now() at time zone app.tz())::date);

  create temp table if not exists _sch (id uuid primary key, d int, es int, ef int, ls int, lf int, fixed_es int, fin int, base int, rem int) on commit drop;
  delete from _sch where true;
  insert into _sch (id, d, fixed_es, fin, base, rem)
  select a.id, a.duration,
         case when a.actual_start is not null then (select count(*) from unnest(cal) c where c < a.actual_start) end,
         case when a.actual_finish is not null then (select count(*) from unnest(cal) c where c <= a.actual_finish) end,
         greatest(0, coalesce((select count(*) from unnest(cal) c where c < a.not_before), 0), case when a.actual_start is null then tidx else 0 end),
         ceil(a.duration * (1 - a.pct / 100.0))::int
  from public.exec_activities a where a.exec_project_id = p_exec;
  select count(*) into n from _sch;
  update _sch set es = coalesce(fixed_es, base) where true;
  update _sch set ef = case when fin is not null then greatest(fin, es) when fixed_es is not null then greatest(es + d, tidx + rem) else es + d end where true;
  -- forward pass (relaxation; the network has no loops)
  i := 0;
  loop
    i := i + 1;
    update _sch s set es = x.nes
    from (select s2.id, greatest(s2.base, max(case dp.dep_type when 'FS' then p.ef + dp.lag when 'SS' then p.es + dp.lag
                                                         when 'FF' then p.ef + dp.lag - s2.d else p.es + dp.lag - s2.d end)) nes
          from _sch s2 join public.exec_activity_deps dp on dp.succ_id = s2.id join _sch p on p.id = dp.pred_id
          where s2.fixed_es is null group by s2.id, s2.base) x
    where s.id = x.id and s.es <> x.nes;
    update _sch set ef = case when fin is not null then greatest(fin, es) when fixed_es is not null then greatest(es + d, tidx + rem) else es + d end
    where ef <> case when fin is not null then greatest(fin, es) when fixed_es is not null then greatest(es + d, tidx + rem) else es + d end;
    exit when not found or i > n + 2;
  end loop;
  select coalesce(max(ef), 0) into pf from _sch;
  -- backward pass
  update _sch set lf = pf, ls = pf - (ef - es) where true;
  i := 0;
  loop
    i := i + 1;
    update _sch p set lf = x.nlf, ls = x.nlf - (p.ef - p.es)
    from (select p2.id, least(pf, min(case dp.dep_type when 'FS' then s.ls - dp.lag when 'SS' then s.ls - dp.lag + (p2.ef - p2.es)
                                                   when 'FF' then s.lf - dp.lag else s.lf - dp.lag + (p2.ef - p2.es) end)) nlf
          from _sch p2 join public.exec_activity_deps dp on dp.pred_id = p2.id join _sch s on s.id = dp.succ_id group by p2.id, p2.ef, p2.es) x
    where p.id = x.id and p.lf <> x.nlf;
    exit when not found or i > n + 2;
  end loop;
  update public.exec_activities a set
    es = cal[least(s.es, cardinality(cal) - 1) + 1],
    ef = case when s.ef > s.es then cal[least(s.ef, cardinality(cal))] else cal[least(s.es, cardinality(cal) - 1) + 1] end,
    ls = cal[greatest(0, least(s.ls, cardinality(cal) - 1)) + 1],
    lf = case when s.lf > s.ls then cal[greatest(1, least(s.lf, cardinality(cal)))] else cal[greatest(0, least(s.ls, cardinality(cal) - 1)) + 1] end,
    total_float = s.ls - s.es,
    critical = a.actual_finish is null and s.ls - s.es <= 0
  from _sch s where s.id = a.id;
  v_finish := case when pf > 0 then cal[least(pf, cardinality(cal))] else pg.start_date end;
  update public.exec_programmes set forecast_finish = case when n > 0 then v_finish end, updated_at = now() where exec_project_id = p_exec;
  -- While the SEE edits (draft), the baseline follows the plan; it is fixed when the programme is submitted
  if pg.status = 'draft' then
    update public.exec_activities set bl_start = es, bl_finish = ef where exec_project_id = p_exec;
    update public.exec_programmes set baseline_finish = forecast_finish where exec_project_id = p_exec;
  end if;
  perform app.snapshot_progress(p_exec);
  return v_finish;
end $$;
-- Programmes being prepared or revised now: the baseline takes their current dates
update public.exec_activities a set bl_start = a.es, bl_finish = a.ef
  from public.exec_programmes pg where pg.exec_project_id = a.exec_project_id and pg.status = 'draft';
update public.exec_programmes set baseline_finish = forecast_finish where status = 'draft';
