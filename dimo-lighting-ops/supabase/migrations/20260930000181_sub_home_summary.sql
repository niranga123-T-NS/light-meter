-- Subcontractor supervisor's home: a progress summary of each project they are appointed to – their company's programme
-- activities, this week's plan, today's check-in / toolbox meeting / permits / daily report, payment certificates and workers.

create or replace function public.sub_home_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); co text := app.company_of(auth.uid()); today date := (now() at time zone app.tz())::date;
        wk date := (now() at time zone app.tz())::date - (extract(isodow from (now() at time zone app.tz())::date)::int - 1);
begin
  perform app.require(app.has_role('sub_supervisor'), 'For subcontractor supervisors');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'code', e.code, 'name', e.name, 'client', e.client_name, 'company', (select company from public.profiles where id = me),
      'activities', (select jsonb_build_object(
          'n', count(*), 'done', count(*) filter (where a.pct >= 100 or a.actual_finish is not null),
          'behind', count(*) filter (where a.pct < 100 and a.actual_finish is null and a.ef < today),
          'progress', round(coalesce(sum(a.duration * a.pct) / nullif(sum(a.duration * 100), 0) * 100, 0), 1),
          'running', count(*) filter (where a.pct < 100 and a.actual_finish is null and coalesce(a.actual_start, a.es) <= today))
        from public.exec_activities a
        where a.exec_project_id = e.id and a.duration > 0 and co is not null and lower(btrim(coalesce(a.subcontractor, ''))) = co),
      'week', (select jsonb_build_object('status', s.status, 'items', count(i.id),
          'done', count(i.id) filter (where i.status = 'done'), 'partial', count(i.id) filter (where i.status = 'partial'),
          'not_done', count(i.id) filter (where i.status = 'not_done'),
          'no_result', count(i.id) filter (where i.status = 'planned' and i.day < today), 'today', count(i.id) filter (where i.day = today))
        from public.sub_plans s left join public.sub_plan_items i on i.sub_plan_id = s.id
        where s.exec_project_id = e.id and s.supervisor_id = me and s.week_start = wk group by s.id, s.status),
      'today', jsonb_build_object(
          'checked_in', (select min(c.at) from public.site_checkins c where c.exec_project_id = e.id and c.user_id = me and c.day = today and c.within),
          'tbt', (select jsonb_build_object('id', t.id, 'code', t.code, 'at', t.starts_at, 'late', t.tbt_late) from public.hse_records t
                   where t.exec_project_id = e.id and t.created_by = me and t.form_code = 'TBT-01' and (t.starts_at at time zone app.tz())::date = today
                   order by t.starts_at limit 1),
          'permits_ok', (select count(*) from public.hse_records r where r.exec_project_id = e.id and r.created_by = me and r.status in ('active', 'closed') and app.permit_covers(r, today)),
          'permits_waiting', (select count(*) from public.hse_records r where r.exec_project_id = e.id and r.created_by = me and r.status = 'submitted' and app.permit_covers(r, today)),
          'permits_tomorrow', (select count(*) from public.hse_records r where r.exec_project_id = e.id and r.created_by = me and r.status in ('submitted', 'active') and app.permit_covers(r, today + 1)),
          'report', (select x.status from public.exec_reports x where x.exec_project_id = e.id and x.author_id = me and x.report_date = today limit 1)),
      'certs', (select jsonb_build_object('open', count(*) filter (where c.status not in ('paid', 'cancelled')),
          'paid', count(*) filter (where c.status = 'paid'), 'paid_value', coalesce(sum(c.net) filter (where c.status = 'paid'), 0))
        from public.sub_certs c where c.exec_project_id = e.id and co is not null and lower(btrim(c.subcontractor)) = co),
      'workers', (select count(*) from public.exec_workers w where w.exec_project_id = e.id and w.status = 'active' and co is not null and lower(btrim(w.company)) = co)
    ) order by e.name)
    from public.exec_projects e
    where e.status = 'active' and exists (select 1 from public.exec_members m where m.exec_project_id = e.id and m.user_id = me and m.member_role = 'sub_supervisor' and m.active)
  ), '[]');
end $$;
revoke execute on function public.sub_home_summary() from public, anon;
grant execute on function public.sub_home_summary() to authenticated, service_role;
