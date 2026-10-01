-- Fix: setting the design completion date was blocked by the 'submitted inquiry' guard.
-- The proposal is a workflow action, so it flags itself as one before updating the inquiry.
create or replace function public.propose_design_due(p_inquiry uuid, p_due timestamptz, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  deadline timestamptz;
  wpd numeric := app.working_minutes_per_day();
  est_days numeric;
  std_days numeric := round(app.sla_target('estimation_medium') / app.working_minutes_per_day(), 1);
begin
  perform set_config('app.workflow', '1', true);
  perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager sets the design completion date');
  perform app.require(i.route = 'A', 'Only design → estimation inquiries need an approved design completion date');
  perform app.require(i.status in ('accepted', 'in_design', 'design_review'), 'Accept the inquiry first');
  perform app.require(p_due > now(), 'The completion date must be in the future');
  deadline := (i.customer_deadline + app.work_end()) at time zone app.tz();
  perform app.require(p_due < deadline, 'The design must be complete before the customer deadline');
  est_days := round(app.work_minutes_between(p_due, deadline) / wpd, 1);
  update public.inquiries set design_due_proposed_at = p_due, design_due_status = 'pending' where id = i.id;
  return app.create_approval('design_due', 'inquiry', i.id, i.id, 'Design completion date – ' || i.code,
    format('Design complete by %s · leaves %s working days for estimation (standard %s) · customer deadline %s%s%s',
      to_char(p_due at time zone app.tz(), 'DD Mon HH24:MI'), est_days, std_days, to_char(i.customer_deadline, 'DD Mon'),
      case when est_days < std_days then ' · SHORTER THAN STANDARD' else '' end,
      case when coalesce(trim(p_note), '') <> '' then ' · ' || p_note else '' end),
    array['sm_projects']::public.app_role[],
    jsonb_build_object('due', p_due, 'estimation_days', est_days, 'standard_days', std_days));
end $$;
