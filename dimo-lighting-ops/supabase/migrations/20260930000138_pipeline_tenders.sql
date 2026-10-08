-- Designs waiting for estimation: design + estimation inquiries, and every tender that needs a design.

create or replace function public.design_pipeline() returns table (
  inquiry_id uuid, code text, title text, customer_name text, deadline_type text, deadline_at timestamptz, tender_ref text,
  design_due_at timestamptz, design_due_status text, designers text, design_progress int, inquiry_status text,
  estimation_job_id uuid, estimation_status text, estimation_phase text, estimator text, estimation_due_at timestamptz,
  estimation_days numeric, late boolean, extension_status text,
  design_time_pct numeric, design_paused boolean, design_updated_at timestamptz,
  estimation_progress int, estimation_time_pct numeric, estimation_paused boolean, estimation_updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.has_role('sm_estimation', 'am_estimation', 'design_manager', 'sm_projects', 'gm'), 'Not allowed');
  return query
  select i.id, i.code, coalesce(i.inquiry_name, i.project_name), i.customer_name, i.deadline_type, app.deadline_end(i), i.tender_ref,
         i.design_due_at, i.design_due_status,
         (select string_agg(distinct app.display_name(d.assignee_id), ', ') from public.design_jobs d where d.inquiry_id = i.id and d.revision = i.revision),
         coalesce((select avg(case when d.status in ('in_review', 'approved', 'released') then 100 else d.progress_pct end)
                     from public.design_jobs d where d.inquiry_id = i.id and d.revision = i.revision), 0)::int,
         i.status, e.id, e.status, e.phase, app.display_name(e.assignee_id), i.estimation_due_at,
         case when i.design_due_at is not null and i.estimation_due_at is not null
              then round(app.work_minutes_between(greatest(i.design_due_at, now()), i.estimation_due_at) / app.working_minutes_per_day(), 1) end,
         i.status in ('accepted', 'in_design') and i.design_due_at is not null and now() > i.design_due_at,
         i.extension_status,
         (select max(c.used_pct) from public.sla_clocks c join public.design_jobs d on d.id = c.entity_id
           where c.entity_type = 'design_job' and c.stage = 'design' and c.stopped_at is null and d.inquiry_id = i.id and d.revision = i.revision),
         coalesce((select bool_and(c.paused_at is not null) from public.sla_clocks c join public.design_jobs d on d.id = c.entity_id
           where c.entity_type = 'design_job' and c.stage = 'design' and c.stopped_at is null and d.inquiry_id = i.id and d.revision = i.revision), false),
         (select min(coalesce(d.progress_updated_at, d.created_at)) from public.design_jobs d
           where d.inquiry_id = i.id and d.revision = i.revision and d.status in ('assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested')),
         e.progress_pct,
         (select c.used_pct from public.sla_clocks c where c.entity_type = 'estimation_job' and c.entity_id = e.id and c.stage = 'estimation' and c.stopped_at is null limit 1),
         coalesce((select c.paused_at is not null from public.sla_clocks c where c.entity_type = 'estimation_job' and c.entity_id = e.id and c.stage = 'estimation' and c.stopped_at is null limit 1), false),
         case when e.assignee_id is not null then coalesce(e.progress_updated_at, e.assigned_at) end
    from public.inquiries i
    left join lateral (select * from public.estimation_jobs x where x.inquiry_id = i.id and x.revision = i.revision order by x.created_at desc limit 1) e on true
   -- Only inquiries the sales person sent for design + estimation, or as a tender
   where i.route = 'A' and (coalesce(i.release_mode, 3) <> 1 or i.deadline_type = 'tender')
     and i.status in ('accepted', 'in_design', 'design_review', 'design_approved')
   order by app.deadline_end(i) nulls last;
end $$;
