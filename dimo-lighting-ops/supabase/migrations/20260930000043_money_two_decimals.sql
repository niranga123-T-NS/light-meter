-- Money in alerts and messages: full value, comma thousands separators, two decimals (LKR 2,400,000.00)
create or replace function app.fmt_money(amount numeric, cur public.currency) returns text
language sql immutable as $$
  select case when amount is null then '—'
              else format('%s %s', cur, btrim(to_char(amount, 'FM999,999,999,999,990.00'))) end
$$;

-- Limits written in full in the sample alerts
create or replace function public.decide_sample(p_sample uuid, p_decision text, p_comment text default null) returns text
language plpgsql security definer set search_path = public as $$
declare s public.samples; v numeric; next_status text;
begin
  select * into s from public.samples where id = p_sample for update;
  perform app.require(p_decision in ('approved', 'rejected', 'returned_for_changes'), 'Invalid decision');
  perform app.require(p_decision = 'approved' or coalesce(trim(p_comment), '') <> '', 'A reason is required');
  if s.status = 'availability_confirmed' then
    perform app.require(app.has_role('sm_projects'), 'SM Projects approves sample requests first');
  elsif s.status = 'gm_approval' then
    perform app.require(app.has_role('gm'), 'Only GM / DGM approves sample requests above the limit');
  else
    raise exception 'Request is not waiting for approval';
  end if;
  v := app.to_lkr(s.total_value, s.currency);
  next_status := case when p_decision = 'approved' and s.status = 'availability_confirmed'
                           and v > app.setting_num('sample_gm_approval_value_lkr', 100000) then 'gm_approval'
                      else p_decision end;
  perform set_config('app.workflow', '1', true);
  update public.samples set status = next_status, approved_by = auth.uid(), approved_at = now(),
    approval_comment = concat_ws(' · ', nullif(approval_comment, ''), nullif(trim(p_comment), '')) where id = s.id;
  if next_status = 'gm_approval' then
    perform app.notify_many(app.role_users('gm'), 'sample_request', 'Approve sample request ' || s.code || ' (above LKR 100,000.00)',
      format('%s – %s · %s · approved by SM Projects', s.project_name, s.client_name, app.fmt_money(s.total_value, s.currency)),
      'normal', 'sample', s.id, '/samples/' || s.id, null, true);
    perform app.notify(s.sales_person_id, 'sample_step', format('Sample request %s – SM Projects approved, now with GM / DGM', s.code),
      coalesce(p_comment, ''), 'normal', 'sample', s.id, '/samples/' || s.id);
  else
    perform app.notify_many(array[s.sales_person_id] || app.role_users('operations_exec'), 'sample_step',
      format('Sample request %s %s', s.code, replace(p_decision, '_', ' ')), coalesce(p_comment, ''), 'normal', 'sample', s.id, '/samples/' || s.id);
  end if;
  return next_status;
end $$;

create or replace function public.sample_outstanding_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  r record;
  n int := 0;
begin
  if extract(isodow from today) <> 1 or loc::time < time '08:00' then return 0; end if;
  for r in select * from public.sample_outstanding() where over_limit and sales_person_id is not null loop
    perform app.notify(r.sales_person_id, 'sample_outstanding', 'Samples outstanding over LKR 500,000.00 – collect them',
      format('Total %s: %s returnable out (%s overdue, %s) · %s sold not paid (%s). Collect the overdue samples and the money for sold samples.',
             app.fmt_money(r.total_lkr, 'LKR'), r.out_n, r.overdue_n, app.fmt_money(r.overdue_lkr, 'LKR'), r.sold_n, app.fmt_money(r.sold_lkr, 'LKR')),
      'normal', null, null, '/samples?tab=mine', format('smpout:%s:%s', r.sales_person_id, today), true);
    n := n + 1;
  end loop;
  return n;
end $$;

