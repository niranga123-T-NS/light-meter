-- Execution step 6: variations.
--  * An Assistant Engineer or the Senior Electrical Engineer raises a variation (addition, omission or substitution) with
--    the reason, description, quantities, client instruction reference, photos and documents.
--  * The Senior Electrical Engineer screens it: reject, or route it –
--      A  design + estimation  → a variation inquiry on the project goes to the Design Manager, then Estimation
--      B  estimation only      → a variation inquiry goes straight to Estimation
--      C  contract rates       → the SEE prices it from the BOQ rates
--    Routes A / B use the normal inquiry, design and estimation boards (marked "Variation"); when the quotation is released
--    the price comes back to the variation.
--  * Approval by value (LKR, absolute – omissions too): SM Projects approves; above variation_gm_value_lkr, below the
--    margin floor or more than variation_gm_days days of time impact, SM Projects recommends and DGM / GM approves.
--  * Client acceptance (signed variation order) is recorded by the SEE; an approved, accepted variation updates the secured
--    project's order value and invoice schedule.

insert into public.settings (key, value, description) values
  ('variation_gm_value_lkr', '10000000', 'Variations above this value (LKR, absolute) need DGM / GM approval after SM Projects'),
  ('variation_gm_days', '14', 'Variations with more time impact (days) need DGM / GM approval')
on conflict (key) do nothing;

create table public.variations (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  vtype text not null check (vtype in ('addition', 'omission', 'substitution')),
  reason text not null check (reason in ('client_instruction', 'site_condition', 'design_change', 'missed_item', 'other')),
  title text not null,
  description text not null,
  quantities text,
  client_ref text,
  raised_by uuid not null default auth.uid() references public.profiles (id),
  raised_at timestamptz not null default now(),
  status text not null default 'raised' check (status in ('raised', 'pricing', 'pending_smp', 'pending_gm', 'approved', 'rejected',
                                                       'client_accepted', 'client_rejected', 'cancelled')),
  route text check (route in ('A', 'B', 'C')),
  screened_by uuid references public.profiles (id),
  screened_at timestamptz,
  inquiry_id uuid references public.inquiries (id),
  inquiry_status text,
  value_lkr numeric(16, 2),
  cost_lkr numeric(16, 2),
  margin_pct numeric(6, 2),
  time_days int,
  smp_by uuid references public.profiles (id),
  smp_at timestamptz,
  smp_note text,
  gm_by uuid references public.profiles (id),
  gm_at timestamptz,
  gm_note text,
  decision_note text,
  vo_no text,
  client_at date,
  client_note text,
  secured_variation_id uuid references public.secured_variations (id)
);
create index on public.variations (exec_project_id, status);

alter table public.inquiries add column if not exists variation_id uuid references public.variations (id);

alter table public.variations enable row level security;
create policy variations_read on public.variations for select to authenticated using (app.is_exec_internal(exec_project_id) or app.has_role('gm'));
grant select on public.variations to authenticated;

create or replace function app.variation_head(v public.variations) returns text
language sql stable security definer set search_path = public as $$
  select concat_ws(' · ', v.code, v.title, app.exec_head(v.exec_project_id))
$$;

-- p: {vtype, reason, title, description, quantities, client_ref}
create or replace function public.raise_variation(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare vid uuid; v public.variations;
begin
  perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec), 'Assistant Engineers of the project or the Senior Electrical Engineer raise variations');
  perform app.require(coalesce(p ->> 'vtype', '') in ('addition', 'omission', 'substitution'), 'Choose addition, omission or substitution');
  perform app.require(coalesce(p ->> 'reason', '') in ('client_instruction', 'site_condition', 'design_change', 'missed_item', 'other'), 'Choose the reason');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '' and coalesce(btrim(p ->> 'description'), '') <> '', 'Describe the variation');
  insert into public.variations (code, exec_project_id, vtype, reason, title, description, quantities, client_ref)
  values (app.next_code('VAR'), p_exec, p ->> 'vtype', p ->> 'reason', btrim(p ->> 'title'), btrim(p ->> 'description'),
          nullif(btrim(p ->> 'quantities'), ''), nullif(btrim(p ->> 'client_ref'), ''))
  returning * into v;
  vid := v.id;
  perform app.notify_many(array_remove(app.role_users('senior_elec_engineer'), auth.uid()), 'exec_variation', 'Variation raised – screen it',
    app.variation_head(v) || ' · ' || app.display_name(auth.uid()), 'normal', 'variation', vid, '/execution/variation/' || vid, null, true);
  return vid;
end $$;

-- SEE screens: reject, or route A / B (variation inquiry) / C (priced from contract rates)
-- p (A/B): {required_by, design_scope, estimation_scope[], estimation_basis, priority}
-- p (C):   {value, cost, time_days, note}
create or replace function public.screen_variation(p_id uuid, p_decision text, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v public.variations; e public.exec_projects; pr public.projects; iid uuid; sc text[]; val numeric; res jsonb;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer screens variations');
  select * into v from public.variations where id = p_id for update;
  perform app.require(v.id is not null and v.status = 'raised', 'This variation is not waiting for screening');
  perform app.require(p_decision in ('reject', 'A', 'B', 'C'), 'Choose how to handle it');
  if p_decision = 'reject' then
    perform app.require(coalesce(btrim(p ->> 'note'), '') <> '', 'Give the reason');
    update public.variations set status = 'rejected', screened_by = auth.uid(), screened_at = now(), decision_note = btrim(p ->> 'note') where id = v.id;
    perform app.notify(v.raised_by, 'exec_variation', 'Variation not taken forward', app.variation_head(v) || ' · ' || btrim(p ->> 'note'), 'normal',
      'variation', v.id, '/execution/variation/' || v.id);
    return 'rejected';
  end if;
  if p_decision = 'C' then
    begin val := round(nullif(p ->> 'value', '')::numeric, 2); exception when others then val := null; end;
    perform app.require(val is not null and val <> 0, 'Enter the value from the contract rates');
    val := case when v.vtype = 'omission' then -abs(val) else abs(val) end;
    update public.variations set route = 'C', status = 'pending_smp', screened_by = auth.uid(), screened_at = now(), value_lkr = val,
      cost_lkr = nullif(p ->> 'cost', '')::numeric, time_days = nullif(p ->> 'time_days', '')::int,
      margin_pct = case when nullif(p ->> 'cost', '')::numeric is not null and val <> 0 then round((abs(val) - (p ->> 'cost')::numeric) / abs(val) * 100, 2) end,
      decision_note = nullif(btrim(p ->> 'note'), '')
    where id = v.id returning * into v;
    perform app.notify_many(app.role_users('sm_projects'), 'exec_variation', 'Variation to approve',
      format('%s · %s%s', app.variation_head(v), case when val > 0 then '+' else '−' end, app.fmt_money(abs(val), 'LKR')), 'normal', 'variation', v.id,
      '/execution/variation/' || v.id, null, true);
    return 'pending_smp';
  end if;
  -- A / B: a variation inquiry through Design and / or Estimation
  select * into e from public.exec_projects where id = v.exec_project_id;
  select * into pr from public.projects where id = e.project_id;
  perform app.require(nullif(p ->> 'required_by', '') is not null and (p ->> 'required_by')::date > (now() at time zone app.tz())::date, 'Set the date the price is needed by');
  select coalesce(array_agg(x), '{}') into sc from jsonb_array_elements_text(coalesce(p -> 'estimation_scope', '[]')) x;
  perform app.require(cardinality(sc) > 0, 'Select what Estimation must price');
  perform app.require(nullif(p ->> 'estimation_basis', '') is not null, 'Select the estimation basis');
  perform app.require(p_decision = 'B' or nullif(p ->> 'design_scope', '') is not null, 'Select the design scope');
  perform set_config('app.workflow', '1', true);
  insert into public.inquiries (project_id, organization_id, unit_id, route, duty_status, design_scope, priority, customer_deadline,
                                scope_description, estimation_scope, estimation_basis, variation_id, mixed_duty_approved)
  values (pr.id, pr.organization_id, pr.unit_id, p_decision,
          coalesce((select duty_status from public.inquiries where project_id = pr.id and duty_status is not null and status not in ('draft', 'cancelled', 'rejected')
                    order by created_at desc limit 1), pr.duty_status, 'duty_paid'), case when p_decision = 'A' then p ->> 'design_scope' end,
          coalesce(nullif(p ->> 'priority', ''), 'high'), (p ->> 'required_by')::date,
          format('VARIATION %s (%s) – %s%s%s', v.code, v.vtype, v.title, E'\n' || v.description, coalesce(E'\nQuantities: ' || v.quantities, '')),
          sc, p ->> 'estimation_basis', v.id, true)
  returning id into iid;
  update public.inquiries set code = coalesce(code, app.next_code('INQ')) where id = iid;
  update public.variations set route = p_decision, status = 'pricing', screened_by = auth.uid(), screened_at = now(), inquiry_id = iid,
    decision_note = nullif(btrim(p ->> 'note'), '') where id = v.id;
  res := public.submit_inquiry(iid);
  perform app.notify(v.raised_by, 'exec_variation', 'Variation sent for ' || case p_decision when 'A' then 'design and pricing' else 'pricing' end,
    app.variation_head(v), 'normal', 'variation', v.id, '/execution/variation/' || v.id);
  return coalesce(res ->> 'status', 'pricing');
end $$;

-- The variation inquiry moves on: the price comes back when the quotation is released
create or replace function app.variation_inquiry_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v public.variations; j public.estimation_jobs; mg numeric; rate numeric; val numeric;
begin
  if new.variation_id is null or new.status is not distinct from old.status then return new; end if;
  select * into v from public.variations where id = new.variation_id for update;
  if v.id is null then return new; end if;
  update public.variations set inquiry_status = new.status where id = v.id;
  if new.status = 'quotation_released' and v.status = 'pricing' then
    select * into j from public.estimation_jobs where inquiry_id = new.id and quoted_value is not null order by updated_at desc nulls last limit 1;
    select margin_pct into mg from public.estimation_costing where estimation_job_id = j.id;
    select usd_to_lkr into rate from public.exchange_rates order by month desc limit 1;
    val := case when new.currency = 'USD' then j.quoted_value * coalesce(rate, 300) else j.quoted_value end;
    val := case when v.vtype = 'omission' then -abs(val) else abs(val) end;
    update public.variations set status = 'pending_smp', value_lkr = round(val, 2), margin_pct = mg where id = v.id;
    perform app.notify_many(app.role_users('sm_projects', 'senior_elec_engineer'), 'exec_variation', 'Variation priced – SM Projects to approve',
      format('%s · %s%s%s', app.variation_head(v), case when val > 0 then '+' else '−' end, app.fmt_money(abs(val), 'LKR'),
             coalesce(' · margin ' || mg || '%', '')), 'normal', 'variation', v.id, '/execution/variation/' || v.id, null, true);
  elsif new.status in ('cancelled', 'rejected') and v.status = 'pricing' then
    update public.variations set status = 'rejected', decision_note = 'Variation inquiry ' || new.status where id = v.id;
    perform app.notify_many(array[v.raised_by] || app.role_users('senior_elec_engineer'), 'exec_variation', 'Variation inquiry ' || new.status,
      app.variation_head(v), 'normal', 'variation', v.id, '/execution/variation/' || v.id);
  end if;
  return new;
end $$;
drop trigger if exists inquiries_variation on public.inquiries;
create trigger inquiries_variation after update of status on public.inquiries for each row execute function app.variation_inquiry_trg();

-- SM Projects, then DGM / GM above the limits
create or replace function public.decide_exec_variation(p_id uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v public.variations; gm_needed boolean; nxt text; pr uuid;
begin
  select * into v from public.variations where id = p_id for update;
  perform app.require(v.id is not null, 'Variation not found');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  if v.status = 'pending_smp' then
    perform app.require(app.has_role('sm_projects'), 'Waiting for SM Projects');
    gm_needed := abs(coalesce(v.value_lkr, 0)) > app.setting_num('variation_gm_value_lkr', 10000000)
                 or coalesce(v.margin_pct, 100) < app.setting_num('gm_approval_margin_floor_pct', 15)
                 or coalesce(v.time_days, 0) > app.setting_num('variation_gm_days', 14);
    nxt := case when not p_approve then 'rejected' when gm_needed then 'pending_gm' else 'approved' end;
    update public.variations set status = nxt, smp_by = auth.uid(), smp_at = now(), smp_note = nullif(btrim(p_note), '') where id = v.id;
    if nxt = 'pending_gm' then
      perform app.notify_many(app.role_users('gm'), 'exec_variation', 'Variation to approve (above SM Projects limit)',
        format('%s · %s%s · recommended by %s', app.variation_head(v), case when v.value_lkr > 0 then '+' else '−' end, app.fmt_money(abs(v.value_lkr), 'LKR'),
               app.display_name(auth.uid())), 'normal', 'variation', v.id, '/execution/variation/' || v.id, null, true);
    end if;
  elsif v.status = 'pending_gm' then
    perform app.require(app.has_role('gm'), 'Waiting for DGM / GM');
    nxt := case when p_approve then 'approved' else 'rejected' end;
    update public.variations set status = nxt, gm_by = auth.uid(), gm_at = now(), gm_note = nullif(btrim(p_note), '') where id = v.id;
  else
    perform app.require(false, 'This variation is not waiting for approval');
  end if;
  if nxt in ('approved', 'rejected') then
    select p.owner_id into pr from public.exec_projects e join public.projects p on p.id = e.project_id where e.id = v.exec_project_id;
    perform app.notify_many(array[v.raised_by, pr] || app.role_users('senior_elec_engineer'), 'exec_variation',
      case nxt when 'approved' then 'Variation approved – send to the client' else 'Variation rejected' end,
      concat_ws(' · ', app.variation_head(v), nullif(btrim(p_note), '')), 'normal', 'variation', v.id, '/execution/variation/' || v.id, null, true);
  end if;
  return nxt;
end $$;

-- Client's answer, recorded by the SEE (or SM Projects); accepted → secured project value and invoice schedule
-- p: {vo_no, date, month, note}
create or replace function public.record_variation_client(p_id uuid, p_accepted boolean, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v public.variations; s public.secured_projects; sv uuid; m date; msg text := 'recorded';
begin
  perform app.require(app.has_role('senior_elec_engineer', 'sm_projects'), 'The Senior Electrical Engineer records the client''s answer');
  select * into v from public.variations where id = p_id for update;
  perform app.require(v.id is not null and v.status = 'approved', 'Only an approved variation goes to the client');
  if not p_accepted then
    perform app.require(coalesce(btrim(p ->> 'note'), '') <> '', 'Give the client''s reason');
    update public.variations set status = 'client_rejected', client_at = coalesce(nullif(p ->> 'date', '')::date, current_date), client_note = btrim(p ->> 'note') where id = v.id;
    return 'client_rejected';
  end if;
  perform app.require(coalesce(btrim(p ->> 'vo_no'), '') <> '', 'Enter the variation order (VO) number');
  perform app.require(app.has_attachment('variation', v.id, 'var_doc'), 'Attach the signed variation order or the client''s letter');
  update public.variations set status = 'client_accepted', vo_no = btrim(p ->> 'vo_no'), client_at = coalesce(nullif(p ->> 'date', '')::date, current_date),
    client_note = nullif(btrim(p ->> 'note'), '') where id = v.id;
  -- Secured project (order book): applied as approved – SM Projects (and GM) already approved the variation
  select s2.* into s from public.secured_projects s2 join public.exec_projects e on e.project_id = s2.project_id where e.id = v.exec_project_id;
  if s.id is not null and s.status = 'open' and s.schedule_status = 'approved' and coalesce(v.value_lkr, 0) <> 0 then
    begin m := app.month_of(coalesce(nullif(p ->> 'month', '')::date, current_date)); exception when others then m := app.month_of(current_date); end;
    insert into public.secured_variations (secured_id, vo_no, amount, month, reason, status, decided_by, decided_at, decision_note)
    values (s.id, btrim(p ->> 'vo_no'), v.value_lkr, m, 'Execution variation ' || v.code || ' – ' || v.title, 'approved', coalesce(v.gm_by, v.smp_by), now(),
            'Approved in the execution module')
    returning id into sv;
    perform app.apply_variation(sv);
    update public.variations set secured_variation_id = sv where id = v.id;
    msg := 'secured_updated';
  end if;
  perform app.notify_many(app.role_users('sm_projects', 'operations_exec') || array[s.sales_person_id], 'exec_variation', 'Variation accepted by the client',
    concat_ws(' · ', app.variation_head(v), 'VO ' || btrim(p ->> 'vo_no'), case when msg = 'secured_updated' then 'order value and invoice schedule updated'
                                                                                 else 'update the secured project / invoice schedule' end),
    'normal', 'variation', v.id, '/execution/variation/' || v.id);
  return msg;
end $$;

create or replace function public.cancel_exec_variation(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.variations;
begin
  select * into v from public.variations where id = p_id for update;
  perform app.require(v.id is not null and v.status in ('raised', 'pending_smp', 'pending_gm', 'approved'), 'This variation can no longer be cancelled');
  perform app.require(v.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects'), 'Not allowed');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the reason');
  update public.variations set status = 'cancelled', decision_note = btrim(p_reason) where id = v.id;
end $$;

revoke execute on function public.raise_variation(uuid, jsonb), public.screen_variation(uuid, text, jsonb), public.decide_exec_variation(uuid, boolean, text),
  public.record_variation_client(uuid, boolean, jsonb), public.cancel_exec_variation(uuid, text) from public, anon;
grant execute on function public.raise_variation(uuid, jsonb), public.screen_variation(uuid, text, jsonb), public.decide_exec_variation(uuid, boolean, text),
  public.record_variation_client(uuid, boolean, jsonb), public.cancel_exec_variation(uuid, text) to authenticated;

-- Approvals tab
create or replace function app.exec_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
  select 'access_request', r.id, 'exec_access',
         format('%s – %s', case r.kind when 'temp_add' then case r.role_type when 'trainee' then 'Trainee' else 'Temporary Assistant Engineer' end
                                       when 'temp_delete' then 'Delete temporary role' else 'Subcontractor supervisor' end, r.person_name),
         concat_ws(' · ', r.company, r.reason), r.requested_by, app.display_name(r.requested_by), r.requested_at, null::uuid,
         '/execution/access/' || r.id, case r.status when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.access_requests r
  where (r.status = 'pending_smp' and app.has_role('sm_projects')) or (r.status = 'pending_gm' and app.has_role('gm'))
  union all
  select 'exec_plan', pl.id, 'exec_plan', format('Weekly plan – %s – week of %s', app.display_name(pl.ae_id), to_char(pl.week_start, 'DD Mon')),
         concat_ws(' · ', app.exec_head(pl.exec_project_id), case when pl.is_late then 'submitted late' end), pl.ae_id, app.display_name(pl.ae_id),
         pl.submitted_at, null::uuid, '/execution/plan/' || pl.id, null
  from public.exec_plans pl where pl.status = 'submitted' and app.has_role('senior_elec_engineer')
  union all
  select 'variation', v.id, 'exec_variation',
         format('Variation %s – %s%s', v.code, v.title,
                case when v.value_lkr is not null then format(' (%s%s)', case when v.value_lkr > 0 then '+' else '−' end, app.fmt_money(abs(v.value_lkr), 'LKR')) else '' end),
         app.exec_head(v.exec_project_id), v.raised_by, app.display_name(v.raised_by), v.raised_at, null::uuid, '/execution/variation/' || v.id,
         case v.status when 'raised' then 'Screen' when 'pending_smp' then 'SM Projects' else 'DGM / GM' end
  from public.variations v
  where (v.status = 'raised' and app.has_role('senior_elec_engineer')) or (v.status = 'pending_smp' and app.has_role('sm_projects'))
     or (v.status = 'pending_gm' and app.has_role('gm'))
$$;

-- Variation inquiries are submitted by the Senior Electrical Engineer (copied from 20260930000006_workflow_rpcs.sql)
create or replace function public.submit_inquiry(p_inquiry uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  other_duty public.duty_status;
  receiver public.app_role;
  bad_debt record;
  has_units boolean;
  std_minutes numeric;
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm') or (i.variation_id is not null and app.has_role('senior_elec_engineer')),
    'Only the requesting sales person can submit');
  perform app.require(i.status in ('draft', 'returned_for_info'), 'Inquiry is already submitted');
  perform app.require(i.customer_deadline is not null, 'Customer deadline is required');
  perform app.require(coalesce(length(trim(i.scope_description)), 0) > 0 or app.has_attachment('inquiry', i.id, 'inquiry_doc'),
    'Attach at least one document or write the scope');
  perform app.require(i.route = 'C' or i.duty_status is not null, 'Duty status (Duty Free / Duty Paid) is required when estimation is in scope');
  perform app.require(i.route = 'B' or i.design_scope is not null, 'Select the design scope');
  perform app.require(i.design_required_by is null or i.design_required_by < i.customer_deadline, 'Design required-by date must be before the customer deadline');
  perform app.require(i.quotation_required_by is null or i.quotation_required_by < i.customer_deadline, 'Quotation required-by date must be before the customer deadline');
  select exists (select 1 from public.org_units where organization_id = i.organization_id) into has_units;
  perform app.require(not has_units or i.unit_id is not null, 'Select the unit / department for this customer');

  -- Mixed Duty Free / Duty Paid on one project needs SM Projects → GM approval (5.5)
  if i.duty_status is not null and not i.mixed_duty_approved then
    select duty_status into other_duty from public.inquiries
     where project_id = i.project_id and id <> i.id and duty_status is not null and duty_status <> i.duty_status
       and status not in ('draft', 'cancelled', 'rejected') limit 1;
    if other_duty is not null then
      if not exists (select 1 from public.approvals where kind = 'mixed_duty' and entity_id = i.id and status = 'pending') then
        perform app.create_approval('mixed_duty', 'inquiry', i.id, i.id, format('Mixed duty offer – %s', i.project_name),
          format('%s requested while the project already has a %s offer', i.duty_status, other_duty),
          array['sm_projects', 'gm']::public.app_role[]);
      end if;
      return jsonb_build_object('status', 'approval_required', 'message',
        'This project already has an offer with a different duty status. A mixed duty approval request was sent to SM Projects and GM / DGM.');
    end if;
  end if;

  perform set_config('app.workflow', '1', true);
  update public.inquiries set submitted_at = coalesce(submitted_at, now()) where id = i.id;
  perform app.set_inquiry_status(i.id, 'submitted', case when i.status = 'returned_for_info' then 'Resubmitted' end);
  update public.projects set last_activity_at = now() where id = i.project_id;

  -- Release mode: proposed by sales, confirmed by SM Projects (6.5)
  perform app.create_approval('release_mode', 'inquiry', i.id, i.id, format('Release mode – %s', i.code),
    format('Proposed mode %s (%s)', i.release_mode,
      case i.release_mode when 1 then 'design only' when 2 then 'estimation only' else 'design + estimation' end),
    array['sm_projects']::public.app_role[], jsonb_build_object('release_mode', i.release_mode));

  -- Debtor check (5.9): debts over 90 days or under Legal
  select count(*) as n, sum(amount) filter (where currency = 'LKR') as lkr, sum(amount) filter (where currency = 'USD') as usd
    into bad_debt from public.debts d
   where d.organization_id = i.organization_id and (i.unit_id is null or d.unit_id is null or d.unit_id = i.unit_id)
     and d.status not in ('collected_confirmed', 'cleared') and (d.outstanding_days > 90 or d.is_legal);
  if bad_debt.n > 0 then
    update public.inquiries set debtor_flag = true, status_before_hold = 'submitted', hold_reason = 'Debtor check' where id = i.id;
    perform app.set_inquiry_status(i.id, 'on_hold', 'Debtor check');
    perform app.create_approval('debtor_check', 'inquiry', i.id, i.id, format('Debtor check – %s', i.customer_name),
      format('%s debts over 90 days or under Legal: LKR %s, USD %s', bad_debt.n, coalesce(bad_debt.lkr, 0), coalesce(bad_debt.usd, 0)),
      array['sm_projects']::public.app_role[]);
    return jsonb_build_object('status', 'debtor_hold', 'message',
      format('This client has %s overdue or legal debts. SM Projects has been asked to allow the inquiry.', bad_debt.n));
  end if;

  perform app.route_inquiry(i.id);

  -- Warn when design + estimation time left is less than the standard SLA (5.2)
  std_minutes := case i.route when 'A' then app.sla_target('design_medium') + app.sla_target('estimation_medium')
                              when 'B' then app.sla_target('estimation_medium') else app.sla_target('design_medium') end;
  if app.add_work_minutes(now(), std_minutes) > (i.customer_deadline + time '17:30') at time zone app.tz() then
    return jsonb_build_object('status', 'submitted', 'warning', 'Time to the customer deadline is shorter than the standard SLA.');
  end if;
  return jsonb_build_object('status', 'submitted');
end $$;

-- Attachments (copied from 20260930000104_exec_hse.sql with the new record types)
create or replace function app.can_write_attachment(p_entity_type text, p_entity_id uuid, p_kind text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role();
begin
  case p_entity_type
  when 'visit' then return exists (select 1 from public.visits where id = p_entity_id and sales_person_id = auth.uid()) or r = 'sm_projects';
  when 'tender' then return exists (select 1 from public.tenders where id = p_entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return exists (select 1 from public.inquiries where id = p_entity_id and (sales_person_id = auth.uid() or r in ('sm_projects', 'gm')));
  when 'design_job' then
    return r = 'design_manager' or exists (select 1 from public.design_jobs where id = p_entity_id and assignee_id = auth.uid());
  when 'estimation_job' then
    return r = 'sm_estimation' or exists (select 1 from public.estimation_jobs where id = p_entity_id and assignee_id = auth.uid());
  when 'clarification' then
    return r in ('design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec');
  when 'sample' then
    return r = 'operations_exec' or exists (select 1 from public.samples where id = p_entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then return r = 'operations_exec';
  when 'retention' then return app.can_edit_retention(p_entity_id);
  when 'bond' then return r = 'operations_exec' and exists (select 1 from public.bonds where id = p_entity_id);
  when 'warranty' then return app.is_warranty_desk() and exists (select 1 from public.warranties where id = p_entity_id);
  when 'warranty_claim' then
    return exists (select 1 from public.warranty_claims c where c.id = p_entity_id and (app.is_warranty_desk() or c.assignee_id = auth.uid()));
  when 'warranty_report' then
    return exists (select 1 from public.warranty_reports x where x.id = p_entity_id and (x.sales_person_id = auth.uid() or app.is_warranty_desk()));
  when 'rma' then return app.is_warranty_desk() and exists (select 1 from public.manufacturer_claims where id = p_entity_id);
  when 'warranty_registration' then return app.is_warranty_desk() and exists (select 1 from public.warranty_registrations where id = p_entity_id);
  when 'eng_job' then
    return exists (select 1 from public.eng_jobs where id = p_entity_id and (assignee_id = auth.uid() or app.is_eng_lead()));
  when 'eng_job_update' then
    return exists (select 1 from public.eng_job_updates u join public.eng_jobs j on j.id = u.job_id
                   where u.id = p_entity_id and (j.assignee_id = auth.uid() or app.is_eng_lead()));
  when 'exec_report' then
    return exists (select 1 from public.exec_reports x where x.id = p_entity_id and x.author_id = auth.uid() and x.status in ('submitted', 'returned'));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = p_entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
      or exists (select 1 from public.hse_actions a where a.report_id = x.id and a.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = p_entity_id and (x.raised_by = auth.uid() or app.has_role('senior_elec_engineer', 'sm_projects')));
  else return false;
  end case;
end $$;

create or replace function app.can_read_attachment(a public.attachments) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r public.app_role := app.my_role(); inq uuid; st text; mode int; released timestamptz;
begin
  if r is null then return false; end if;
  if a.uploaded_by = auth.uid() then return true; end if;
  case a.entity_type
  when 'visit' then
    return r in ('gm', 'sm_projects') or exists (select 1 from public.visits where id = a.entity_id and sales_person_id = auth.uid());
  when 'tender' then
    return r in ('gm', 'sm_projects', 'sm_estimation') or exists (select 1 from public.tenders where id = a.entity_id and sales_person_id = auth.uid());
  when 'inquiry' then
    return app.can_read_inquiry(a.entity_id);
  when 'design_job' then
    select inquiry_id into inq from public.design_jobs where id = a.entity_id;
    if r in ('gm', 'design_manager') or app.can_read_design_job(a.entity_id) and r in ('lighting_designer', 'lighting_engineer') then return true; end if;
    -- Released design pack: Estimation (on release) and Sales (Route C / mode 3 release / early release)
    if a.kind = 'design_pack' then
      if r in ('sm_estimation', 'am_estimation', 'estimation_exec') then return app.can_read_inquiry(inq); end if;
      select status, release_mode, design_released_to_sales_at into st, mode, released from public.inquiries where id = inq;
      if r in ('sm_projects') or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)) then
        return released is not null;
      end if;
    end if;
    return false;
  when 'estimation_job' then
    select inquiry_id into inq from public.estimation_jobs where id = a.entity_id;
    if a.kind = 'costing_sheet' then return app.can_read_costing(a.entity_id); end if;
    if r in ('gm', 'sm_estimation') or app.can_read_estimation_job(a.entity_id) then return true; end if;
    if r = 'sm_projects' and a.kind in ('quotation_draft', 'quotation_final', 'compliance_sheet', 'technical_data')
       and exists (select 1 from public.estimation_jobs where id = a.entity_id and needs_sm_projects) then
      return true;
    end if;
    -- Sales download only the released quotation and supporting sheets – never the costing sheet
    if a.kind in ('quotation_final', 'compliance_sheet', 'technical_data') then
      return exists (select 1 from public.estimation_jobs where id = a.entity_id and status = 'released')
             and (r = 'sm_projects' or (r in ('asm_building', 'asm_infra') and app.can_read_inquiry(inq)));
    end if;
    return false;
  when 'clarification' then
    select inquiry_id into inq from public.clarifications where id = a.entity_id;
    return r in ('gm', 'design_manager', 'sm_estimation', 'lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec')
           and app.can_read_inquiry(inq);
  when 'sample' then
    return r in ('gm', 'sm_projects', 'operations_exec') or exists (select 1 from public.samples where id = a.entity_id and sales_person_id = auth.uid());
  when 'debt_upload' then
    return r in ('gm', 'sm_projects', 'operations_exec');
  when 'retention' then
    return exists (select 1 from public.retentions where id = a.entity_id);
  when 'bond' then
    return exists (select 1 from public.bonds where id = a.entity_id);
  when 'warranty' then
    return app.can_read_warranty(a.entity_id);
  when 'warranty_claim' then
    return exists (select 1 from public.warranty_claims where id = a.entity_id);
  when 'warranty_report' then
    return exists (select 1 from public.warranty_reports where id = a.entity_id);
  when 'rma' then
    return exists (select 1 from public.manufacturer_claims where id = a.entity_id);
  when 'warranty_registration' then
    return exists (select 1 from public.warranty_registrations where id = a.entity_id);
  when 'eng_job' then
    return app.can_read_eng_job(a.entity_id);
  when 'eng_job_update' then
    return exists (select 1 from public.eng_job_updates u where u.id = a.entity_id and app.can_read_eng_job(u.job_id));
  when 'exec_report' then
    return exists (select 1 from public.exec_reports x where x.id = a.entity_id and (x.author_id = auth.uid() or app.is_exec_internal(x.exec_project_id)));
  when 'hse_report' then
    return exists (select 1 from public.hse_reports x where x.id = a.entity_id and (x.reported_by = auth.uid() or app.is_exec_internal(x.exec_project_id)
      or exists (select 1 from public.hse_actions y where y.report_id = x.id and y.assignee_id = auth.uid())));
  when 'variation' then
    return exists (select 1 from public.variations x where x.id = a.entity_id and (app.is_exec_internal(x.exec_project_id) or r = 'gm'));
  else
    return r = 'gm';
  end case;
end $$;
