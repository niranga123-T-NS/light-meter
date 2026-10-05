-- Sales map: planned visits (weekly plan lines) on the map.
--  * Position: the plan line's location, else the project's site, else the customer's latest visit check-in.
--  * Completed lines carry the actual check-in, so the map can join planned → actual.
--  * GM / DGM and SM Projects see submitted and approved plans (whole team or one person); a sales person sees all
--    their own plans, drafts included.

create or replace function public.map_plan_lines(p_from date, p_to date, p_person uuid default null)
returns table (id uuid, plan_id uuid, plan_status text, sales_person_id uuid, person text, planned_date date, time_slot text,
  status text, customer text, project text, project_id uuid, objective text, category text, lat double precision, lng double precision,
  loc_source text, visit_id uuid, visit_lat double precision, visit_lng double precision, gps_verified boolean, from_meeting boolean,
  change_reason text, missed_reason text)
language plpgsql stable security definer set search_path = public as $$
declare who uuid := app.map_scope(p_person);   -- checks access first, always
begin
  return query
  select l.id, l.plan_id, vp.status, vp.sales_person_id, app.display_name(vp.sales_person_id), l.planned_date, l.time_slot,
         l.status, o.name, p.name, l.project_id, l.planned_objective, l.visit_category,
         coalesce(l.lat, p.lat, ov.lat), coalesce(l.lng, p.lng, ov.lng),
         (case when l.lat is not null then 'plan' when p.lat is not null then 'site' when ov.lat is not null then 'visit' end)::text,
         v.id, v.checkin_lat, v.checkin_lng, v.gps_verified, l.meeting_action_id is not null, l.change_reason, l.missed_reason
    from public.visit_plan_lines l
    join public.visit_plans vp on vp.id = l.plan_id
    join public.organizations o on o.id = l.organization_id
    left join public.projects p on p.id = l.project_id
    left join lateral (select x.checkin_lat as lat, x.checkin_lng as lng from public.visits x
                        where x.organization_id = l.organization_id and x.checkin_lat is not null
                        order by x.checkin_at desc limit 1) ov on true
    left join lateral (select x.id, x.checkin_lat, x.checkin_lng, x.gps_verified from public.visits x
                        where x.plan_line_id = l.id order by x.checkin_at limit 1) v on true
   where l.planned_date between p_from and p_to
     and (who is null or vp.sales_person_id = who)
     and (vp.status in ('submitted', 'approved') or vp.sales_person_id = auth.uid())
   order by l.planned_date, l.time_slot nulls last
   limit 5000;
end $$;

revoke execute on function public.map_plan_lines(date, date, uuid) from public, anon;
grant execute on function public.map_plan_lines(date, date, uuid) to authenticated;
