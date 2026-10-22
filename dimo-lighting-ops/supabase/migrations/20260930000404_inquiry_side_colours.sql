-- Inquiry colour per side: the design team sees the design's stages, Estimation the estimation's, Sales / SM Projects / GM the worst of all.
-- On the inquiry page the late stages are named for everyone who can open the inquiry (an estimation timer is not readable by the design team).

alter table public.inquiries add column if not exists design_sla_colour text check (design_sla_colour in ('green', 'amber', 'red', 'grey'));
alter table public.inquiries add column if not exists estimation_sla_colour text check (estimation_sla_colour in ('green', 'amber', 'red', 'grey'));

-- Which side a timer belongs to: estimation jobs and estimation-team owners → estimation; design jobs and design-team owners → design; the rest (sales, management) only in the overall colour
create or replace function app.clock_side(p_entity text, p_team public.team) returns text
language sql immutable as $$
  select case when p_entity = 'estimation_job' or p_team = 'estimation' then 'estimation'
              when p_entity = 'design_job' or p_team = 'design' then 'design'
              else 'other' end
$$;

create or replace function app.refresh_inquiry(p_inquiry uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c record;
  worst text;
  worst_d text;
  worst_e text;
  pct int;
  i public.inquiries;
begin
  select * into i from public.inquiries where id = p_inquiry;
  if not found then return; end if;
  select owner_id, owner_team, due_at, revised_due_at, delay_reason into c from public.sla_clocks
   where inquiry_id = p_inquiry and stopped_at is null and entity_type <> 'approval'
   -- While the design runs, the design (not the parallel pre-estimate) owns the inquiry
   order by (entity_type = 'estimation_job' and i.status in ('accepted', 'in_design', 'design_review', 'design_approved')), due_at desc limit 1;
  select case
      when bool_or(colour = 'red') then 'red'
      when bool_and(colour = 'grey') then 'grey'
      when bool_or(colour = 'amber') then 'amber'
      else 'green' end
    into worst from public.sla_clocks where inquiry_id = p_inquiry and stopped_at is null and entity_type <> 'approval';
  -- Each side's own colour: the design team is not shown an estimation delay as theirs, and the other way round
  select case when bool_or(colour = 'red') then 'red' when bool_and(colour = 'grey') then 'grey' when bool_or(colour = 'amber') then 'amber' else 'green' end
    into worst_d from public.sla_clocks where inquiry_id = p_inquiry and stopped_at is null and entity_type <> 'approval' and app.clock_side(entity_type, owner_team) = 'design';
  select case when bool_or(colour = 'red') then 'red' when bool_and(colour = 'grey') then 'grey' when bool_or(colour = 'amber') then 'amber' else 'green' end
    into worst_e from public.sla_clocks where inquiry_id = p_inquiry and stopped_at is null and entity_type <> 'approval' and app.clock_side(entity_type, owner_team) = 'estimation';

  pct := case i.status
    when 'draft' then 0 when 'returned_for_info' then 5 when 'submitted' then 5 when 'accepted' then 10
    when 'in_design' then 15 + coalesce((select avg(progress_pct) from public.design_jobs
                                         where inquiry_id = p_inquiry and revision = i.revision), 0)::int * (case when i.route = 'A' then 35 else 70 end) / 100
    when 'design_review' then case when i.route = 'A' then 45 else 85 end
    when 'design_approved' then case when i.route = 'A' then 50 else 95 end
    when 'in_estimation' then case when i.route = 'A' then 60 else 30 end
    when 'estimation_review' then 85
    when 'quotation_released' then 100 when 'returned_to_sales' then 100
    when 'submitted_to_client' then 100 when 'awaiting_client_approval' then 100 when 'client_approved' then 100
    when 'won' then 100 when 'lost' then 100 else i.progress_pct end;

  perform set_config('app.workflow', '1', true);
  update public.inquiries set
    current_owner_id = coalesce(c.owner_id, case when status in ('quotation_released', 'returned_to_sales', 'submitted_to_client',
                                                                 'awaiting_client_approval', 'client_approved', 'draft', 'returned_for_info')
                                                 then sales_person_id else current_owner_id end),
    current_team = coalesce(c.owner_team, current_team),
    current_due_at = c.due_at,
    revised_due_at = c.revised_due_at,
    delay_reason = c.delay_reason,
    sla_colour = coalesce(worst, case when status = 'on_hold' then 'grey' else 'green' end),
    design_sla_colour = coalesce(worst_d, case when status = 'on_hold' then 'grey' else 'green' end),
    estimation_sla_colour = coalesce(worst_e, case when status = 'on_hold' then 'grey' else 'green' end),
    progress_pct = pct
  where id = p_inquiry;
end $$;


-- The overdue stages of an inquiry with their side, owner and due time – for the banner on the inquiry page
create or replace function public.inquiry_late_stages(p_inquiry uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.can_read_inquiry(p_inquiry), 'Not allowed');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'label', c.label, 'side', app.clock_side(c.entity_type, c.owner_team), 'owner', app.display_name(c.owner_id), 'owner_id', c.owner_id, 'team', c.owner_team,
      'due_at', coalesce(c.revised_due_at, c.due_at), 'delay_reason', c.delay_reason) order by coalesce(c.revised_due_at, c.due_at))
    from public.sla_clocks c where c.inquiry_id = p_inquiry and c.stopped_at is null and c.entity_type <> 'approval' and c.colour = 'red'), '[]'::jsonb);
end $$;
revoke execute on function public.inquiry_late_stages(uuid) from public, anon;
grant execute on function public.inquiry_late_stages(uuid) to authenticated, service_role;

-- Fill the new colours for the open inquiries
do $$ declare r record; begin
  perform set_config('app.workflow', '1', true);
  for r in select id from public.inquiries where status not in ('won', 'lost', 'cancelled') loop perform app.refresh_inquiry(r.id); end loop;
end $$;

select app.fix_function_owners();
