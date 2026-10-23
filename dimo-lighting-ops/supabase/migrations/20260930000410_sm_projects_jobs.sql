-- SM Projects sees the Jobs tab: every design job and estimation job (read only – the actions stay with Design / Estimation and the approvals)
create or replace function app.can_read_design_job(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); j record;
begin
  if r in ('gm', 'design_manager', 'sm_projects') then return true; end if;
  select assignee_id, inquiry_id into j from public.design_jobs where id = p_id;
  if r in ('lighting_designer', 'lighting_engineer') then return j.assignee_id = auth.uid(); end if;
  -- Estimation sees the design job of inquiries routed to it (approved design pack only – see attachments)
  if r in ('sm_estimation', 'am_estimation', 'estimation_exec') then return app.can_read_inquiry(j.inquiry_id); end if;
  return false;
end $$;

create or replace function app.can_read_estimation_job(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); j record;
begin
  if r in ('gm', 'sm_estimation', 'sm_projects') then return true; end if;
  select assignee_id, inquiry_id, revision into j from public.estimation_jobs where id = p_id;
  if r in ('am_estimation', 'estimation_exec') then
    return j.assignee_id = auth.uid()
        or exists (select 1 from public.estimation_jobs e where e.inquiry_id = j.inquiry_id and e.revision > j.revision and e.assignee_id = auth.uid());
  end if;
  return false;
end $$;
