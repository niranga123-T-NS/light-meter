-- Brands specified in a design: the assignee or the Design Manager / GM / DGM can set them until the design
-- is released, so a design approved without brands can still be completed before release.
create or replace function public.set_design_brands(p_job uuid, p_brands jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare j public.design_jobs;
begin
  select * into j from public.design_jobs where id = p_job;
  if not found or not (j.assignee_id = auth.uid() or app.has_role('design_manager', 'gm')) then
    raise exception 'Only the assignee or the Design Manager can set brands';
  end if;
  if j.status = 'released' then raise exception 'The design is already released – brands can no longer be changed'; end if;
  update public.design_jobs set brands_specified = coalesce(p_brands, '[]') where id = p_job;
end $$;
