-- Plan submission check: critical activities due in the week are asked about only in the plan of their responsible
-- engineer (or every AE's plan when no engineer is set).

create or replace function public.plan_missing_critical(p_plan uuid) returns table (activity_id uuid, code text, name text, es date, ef date)
language sql stable security definer set search_path = public as $$
  select a.id, a.code, a.name, a.es, a.ef
  from public.exec_plans pl join public.exec_activities a on a.exec_project_id = pl.exec_project_id
  where pl.id = p_plan and app.programme_live(pl.exec_project_id) and (a.critical or exists (select 1 from public.exec_invoice_triggers t where t.activity_id = a.id and t.ready_at is null and t.claimable_at is null and t.risk in ('amber', 'red'))) and a.actual_finish is null and a.duration > 0
    and a.es <= pl.week_start + 6 and a.ef >= pl.week_start
    and (pl.ae_id = auth.uid() or app.has_role('senior_elec_engineer') or app.is_project_ae(pl.exec_project_id))
    -- only the plan owner's own activities (or ones without a responsible engineer)
    and (a.responsible_id is null or a.responsible_id = pl.ae_id)
    and not exists (select 1 from public.exec_plan_items i where i.activity_id = a.id and i.day between pl.week_start and pl.week_start + 6)
  order by a.es, a.code
$$;
