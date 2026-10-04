-- Warranty claims that are not covered because of the nature of the fault.
--  * Fault cause recorded with every decision. Covering a fault other than a manufacturing defect (even within the warranty
--    period) is goodwill and needs SM Projects approval, like an out-of-warranty claim. A manufacturing defect within the
--    warranty period cannot be rejected or charged.
--  * Rejected / chargeable decisions need evidence: a photo or inspection report attached to the claim (or the visit report).
--  * Chargeable claims: the sales person records the repair quote, then the customer's answer. Accepted → repair → close;
--    declined → the claim closes as "Declined by customer". Reminders when no quote / no answer.
--  * Customer disputes: on a rejected (or chargeable, not accepted) claim the sales person records the customer's dispute;
--    SM Projects (or GM / DGM) upholds the decision or approves goodwill cover, which reopens the claim.
--  * Every step of a claim (and of its manufacturer claim) is notified to the sales persons involved – the person who reported
--    or raised it and the project's sales person – except the person who made the step.
--  * Monday summary of not-covered claims by fault cause.

alter table public.warranty_claims
  add column if not exists fault_cause text check (fault_cause in ('manufacturing_defect', 'power_surge', 'misuse_damage', 'water_ingress',
    'installation_by_others', 'not_dimo_supply', 'wear_tear', 'other')),
  add column if not exists quote_amount numeric(16, 2),
  add column if not exists quote_ref text,
  add column if not exists quoted_on date,
  add column if not exists quoted_by uuid references public.profiles (id),
  add column if not exists customer_response text check (customer_response in ('accepted', 'declined')),
  add column if not exists responded_on date,
  add column if not exists response_note text,
  add column if not exists quote_alert_level int not null default 0,      -- 1 = no quote 5 working days, 2 = 10 (SM Projects), 3 = no answer 14 days
  add column if not exists dispute_status text check (dispute_status in ('pending', 'upheld', 'goodwill')),
  add column if not exists dispute_reason text,
  add column if not exists disputed_at timestamptz,
  add column if not exists disputed_by uuid references public.profiles (id),
  add column if not exists dispute_note text,
  add column if not exists dispute_decided_at timestamptz,
  add column if not exists dispute_decided_by uuid references public.profiles (id),
  add column if not exists dispute_alerted boolean not null default false;

create or replace function app.fault_cause_label(p text) returns text language sql immutable as $$
  select case p
    when 'manufacturing_defect' then 'Manufacturing defect'
    when 'power_surge' then 'Power surge / voltage fluctuation'
    when 'misuse_damage' then 'Misuse / physical damage'
    when 'water_ingress' then 'Water ingress (installation / sealing)'
    when 'installation_by_others' then 'Installation / wiring by others'
    when 'not_dimo_supply' then 'Not DIMO supply'
    when 'wear_tear' then 'Normal wear / consumables'
    when 'other' then 'Other'
  end
$$;

create or replace function app.claim_has_evidence(c public.warranty_claims) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.attachments a where a.archived_at is null
                    and ((a.entity_type = 'warranty_claim' and a.entity_id = c.id)
                      or (c.report_id is not null and a.entity_type = 'warranty_report' and a.entity_id = c.report_id)))
$$;

-- Sales persons involved in a claim: who reported / raised it and the project's sales person
create or replace function app.claim_sales(c public.warranty_claims) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct p.id), '{}') from public.profiles p
   where p.active and p.role in ('asm_building', 'asm_infra')
     and p.id in (c.reported_by, c.logged_by, (select w.owner_id from public.warranties w where w.id = c.warranty_id))
$$;

-- Sales person (or SM Projects / the warranty desk) acting on the customer side of a claim
create or replace function app.can_act_for_customer(c public.warranty_claims) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_warranty_desk() or app.has_role('sm_projects') or auth.uid() = any (app.claim_sales(c))
      or (app.is_sales_person() and app.can_read_warranty(c.warranty_id))
$$;

-- ---------------------------------------------------------------------------
-- Decision with the fault cause
-- ---------------------------------------------------------------------------
drop function if exists public.decide_warranty_claim(uuid, text, text);
create or replace function public.decide_warranty_claim(p_id uuid, p_decision text, p_note text, p_cause text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims; w public.warranties; goodwill boolean; why text;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer decides warranty claims');
  c := app.claim_for_update(p_id);
  perform app.require(p_decision in ('covered', 'chargeable', 'rejected'), 'Choose covered, chargeable or rejected');
  perform app.require(app.fault_cause_label(p_cause) is not null, 'Choose the cause of the fault');
  perform app.require(c.inspected_on is not null or p_decision = 'rejected', 'Record the site inspection first');
  perform app.require(p_decision = 'covered' or coalesce(btrim(p_note), '') <> '', 'Give the reason');
  perform app.require(c.goodwill_status is distinct from 'pending', 'Waiting for SM Projects on the goodwill request');
  perform app.require(p_decision = 'covered' or p_cause <> 'manufacturing_defect' or not c.in_warranty,
    'A manufacturing defect within the warranty period is covered – choose Covered or change the cause');
  perform app.require(p_decision = 'covered' or app.claim_has_evidence(c),
    'Attach a photo or the inspection report to the claim first – the customer is shown why it is not covered');
  select * into w from public.warranties where id = c.warranty_id;
  goodwill := p_decision = 'covered' and (not c.in_warranty or p_cause <> 'manufacturing_defect');
  why := case when not c.in_warranty then 'out of warranty' else 'not a manufacturing defect – ' || lower(app.fault_cause_label(p_cause)) end;
  update public.warranty_claims set decision = p_decision, fault_cause = p_cause, decision_note = nullif(btrim(p_note), ''), decided_at = now(),
    decided_by = auth.uid(), goodwill_status = case when goodwill then 'pending' end,
    status = case when p_decision = 'rejected' then 'closed' else status end,
    closed_on = case when p_decision = 'rejected' then (now() at time zone app.tz())::date end,
    close_note = case when p_decision = 'rejected' then 'Rejected: ' || btrim(p_note) end,
    quote_alert_level = 0
  where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'decided', concat_ws(' · ', initcap(p_decision) || case when goodwill then ' (goodwill – SM Projects approval)' else '' end,
          'cause: ' || app.fault_cause_label(p_cause), nullif(btrim(p_note), '')));
  if goodwill then
    perform app.create_approval('warranty_goodwill', 'warranty_claim', c.id, null,
      format('Goodwill warranty cover – %s (%s)', w.project_name, c.code),
      format('%s · %s · %s%s', w.customer, why, left(c.description, 160), coalesce(' · ' || btrim(p_note), '')),
      array['sm_projects']::public.app_role[], '{}'::jsonb);
  end if;
  perform app.notify_many(array[w.owner_id, c.reported_by] || app.claim_sales(c) || app.role_users('operations_exec'), 'warranty_claim_decided',
    format('Warranty claim %s', case p_decision when 'covered' then case when goodwill then 'to be covered as goodwill (SM Projects approval)' else 'covered by warranty' end
                                 when 'chargeable' then 'not covered (' || lower(app.fault_cause_label(p_cause)) || ') – chargeable, quote the repair'
                                 else 'rejected – ' || lower(app.fault_cause_label(p_cause)) end),
    app.claim_head(c) || coalesce(' · ' || btrim(p_note), ''), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;
revoke execute on function public.decide_warranty_claim(uuid, text, text, text) from public, anon;
grant execute on function public.decide_warranty_claim(uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Chargeable: quote, then the customer's answer
-- ---------------------------------------------------------------------------
create or replace function public.record_claim_quote(p_id uuid, p_amount numeric, p_ref text, p_on date) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims; w public.warranties;
begin
  c := app.claim_for_update(p_id);
  perform app.require(app.can_act_for_customer(c), 'Only the sales person, SM Projects or the warranty desk record the quote');
  perform app.require(c.decision = 'chargeable' and c.goodwill_status is distinct from 'pending', 'The claim is not chargeable');
  perform app.require(c.customer_response is null, 'The customer has already answered the quote');
  perform app.require(c.dispute_status is distinct from 'pending', 'Waiting for SM Projects on the customer''s dispute');
  perform app.require(coalesce(p_amount, 0) > 0, 'Enter the quoted amount');
  perform app.require(p_on is not null and p_on <= (now() at time zone app.tz())::date, 'Enter the quote date (not in the future)');
  select * into w from public.warranties where id = c.warranty_id;
  update public.warranty_claims set quote_amount = round(p_amount, 2), quote_ref = nullif(btrim(p_ref), ''), quoted_on = p_on, quoted_by = auth.uid(),
    quote_alert_level = greatest(quote_alert_level, 2)
   where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'quoted', concat_ws(' · ', case when c.quoted_on is null then 'Repair quoted ' else 'Quote revised ' end || app.fmt_money(p_amount, w.currency),
          nullif(btrim(p_ref), ''), to_char(p_on, 'DD Mon YYYY')));
  perform app.notify_many(app.role_users('operations_exec', 'senior_elec_engineer'), 'warranty_claim_quoted', 'Chargeable repair quoted – waiting for the customer',
    app.claim_head(c) || ' · ' || app.fmt_money(p_amount, w.currency), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;

create or replace function public.record_quote_response(p_id uuid, p_response text, p_on date, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims;
begin
  c := app.claim_for_update(p_id);
  perform app.require(app.can_act_for_customer(c), 'Only the sales person, SM Projects or the warranty desk record the customer''s answer');
  perform app.require(c.decision = 'chargeable' and c.quoted_on is not null, 'Record the quote first');
  perform app.require(c.customer_response is null, 'The customer''s answer is already recorded');
  perform app.require(c.dispute_status is distinct from 'pending', 'Waiting for SM Projects on the customer''s dispute');
  perform app.require(p_response in ('accepted', 'declined'), 'Choose accepted or declined');
  perform app.require(p_on is not null and p_on <= (now() at time zone app.tz())::date, 'Enter the date (not in the future)');
  perform app.require(p_response = 'accepted' or coalesce(btrim(p_note), '') <> '', 'Give the customer''s reason');
  update public.warranty_claims set customer_response = p_response, responded_on = p_on, response_note = nullif(btrim(p_note), ''),
    status = case when p_response = 'declined' then 'closed' else status end,
    closed_on = case when p_response = 'declined' then p_on end,
    close_note = case when p_response = 'declined' then 'Declined by customer: ' || btrim(p_note) end
   where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'quote_' || p_response,
          concat_ws(' · ', case p_response when 'accepted' then 'Customer accepted the repair quote' else 'Customer declined the repair quote – claim closed' end,
                    nullif(btrim(p_note), '')));
  perform app.notify_many(app.role_users('operations_exec', 'senior_elec_engineer') || c.assignee_id, 'warranty_claim_quote_' || p_response,
    case p_response when 'accepted' then 'Customer accepted the repair quote – schedule the repair' else 'Customer declined the repair quote – claim closed' end,
    app.claim_head(c) || coalesce(' · ' || nullif(btrim(p_note), ''), ''), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;

-- Rectification: a chargeable repair only after the customer accepts the quote (copied from 20260930000056)
create or replace function public.record_claim_rectified(p_id uuid, p_on date, p_cost numeric, p_note text default null, p_from text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims; w public.warranties;
begin
  c := app.claim_for_update(p_id);
  perform app.require(app.can_work_claim(c), 'Only the assigned engineer, Operations or the Senior Electrical Engineer update this claim');
  perform app.require(c.decision in ('covered', 'chargeable'), 'The claim must be decided (covered or chargeable) first');
  perform app.require(c.goodwill_status is distinct from 'pending', 'Waiting for SM Projects on the goodwill request');
  perform app.require(c.decision = 'covered' or c.customer_response = 'accepted', 'Chargeable – the customer must accept the repair quote first');
  perform app.require(c.dispute_status is distinct from 'pending', 'Waiting for SM Projects on the customer''s dispute');
  perform app.require(p_on is not null and p_on <= (now() at time zone app.tz())::date, 'Enter the date (not in the future)');
  perform app.require(coalesce(p_cost, 0) >= 0, 'The cost cannot be negative');
  perform app.require(p_from is null or p_from in ('dimo_stock', 'manufacturer'), 'Choose where the replacement came from');
  select * into w from public.warranties where id = c.warranty_id;
  update public.warranty_claims set rectified_on = p_on, cost_amount = coalesce(p_cost, 0), rectification_note = nullif(btrim(p_note), ''),
    repaired_from = p_from where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'rectified', concat_ws(' · ', 'Rectified ' || to_char(p_on, 'DD Mon YYYY'),
          case p_from when 'dimo_stock' then 'from DIMO stock' when 'manufacturer' then 'with the manufacturer''s replacement' end,
          case when coalesce(p_cost, 0) > 0 then 'cost ' || app.fmt_money(p_cost, w.currency) end, nullif(btrim(p_note), '')));
  perform app.notify_many(app.role_users('operations_exec', 'senior_elec_engineer'), 'warranty_claim_rectified', 'Claim rectified – confirm with the customer and close',
    app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;

-- ---------------------------------------------------------------------------
-- Customer disputes a rejected / chargeable decision → SM Projects (or GM / DGM)
-- ---------------------------------------------------------------------------
create or replace function public.dispute_warranty_claim(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims;
begin
  select * into c from public.warranty_claims where id = p_id for update;
  perform app.require(c.id is not null, 'Claim not found');
  perform app.require(app.is_sales_person() and app.can_act_for_customer(c) or app.has_role('sm_projects'),
    'The sales person records the customer''s dispute');
  perform app.require(c.decision = 'rejected' or (c.decision = 'chargeable' and c.customer_response is distinct from 'accepted' and c.rectified_on is null),
    'Only a rejected claim, or a chargeable one the customer has not accepted, can be disputed');
  perform app.require(c.status <> 'cancelled', 'This claim is cancelled');
  perform app.require(c.goodwill_status is distinct from 'pending', 'Goodwill cover is already with SM Projects');
  perform app.require(c.dispute_status is null, 'The customer''s dispute has already been recorded');
  perform app.require(coalesce(btrim(p_reason), '') <> '', 'Give the customer''s reason');
  update public.warranty_claims set dispute_status = 'pending', dispute_reason = btrim(p_reason), disputed_at = now(), disputed_by = auth.uid(),
    dispute_alerted = false where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'disputed', 'Customer disputes the decision – with SM Projects · ' || btrim(p_reason));
  perform app.notify_many(app.role_users('sm_projects') || app.role_users('senior_elec_engineer'), 'warranty_claim_disputed',
    'Customer disputes the warranty decision – uphold or cover as goodwill?',
    app.claim_head(c) || ' · ' || coalesce(app.fault_cause_label(c.fault_cause), '') || ' · ' || btrim(p_reason),
    'normal', 'warranty_claim', c.id, app.claim_url(c.id), null, true);
end $$;

create or replace function public.decide_claim_dispute(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims;
begin
  perform app.require(app.has_role('sm_projects', 'gm'), 'SM Projects decides on the customer''s dispute');
  select * into c from public.warranty_claims where id = p_id for update;
  perform app.require(c.id is not null, 'Claim not found');
  perform app.require(c.dispute_status = 'pending', 'No dispute waiting on this claim');
  perform app.require(p_decision in ('uphold', 'goodwill'), 'Choose uphold or goodwill');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Give the reason');
  if p_decision = 'uphold' then
    update public.warranty_claims set dispute_status = 'upheld', dispute_note = btrim(p_note), dispute_decided_at = now(), dispute_decided_by = auth.uid()
     where id = c.id;
  else
    -- Cover as goodwill: reopens a rejected / declined claim for the repair
    update public.warranty_claims set dispute_status = 'goodwill', dispute_note = btrim(p_note), dispute_decided_at = now(), dispute_decided_by = auth.uid(),
      decision = 'covered', goodwill_status = 'approved', status = 'open', closed_on = null, close_note = null,
      customer_response = null, responded_on = null, response_note = null
     where id = c.id;
  end if;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'dispute_' || case p_decision when 'uphold' then 'upheld' else 'goodwill' end,
          case p_decision when 'uphold' then 'SM Projects upheld the decision' else 'SM Projects: cover as goodwill – claim reopened for the repair' end
          || ' · ' || btrim(p_note));
  perform app.notify_many(app.role_users('senior_elec_engineer', 'operations_exec') || c.assignee_id, 'warranty_dispute_decided',
    case p_decision when 'uphold' then 'Dispute: SM Projects upheld the decision' else 'Dispute: covered as goodwill – arrange the repair' end,
    app.claim_head(c) || ' · ' || btrim(p_note), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;

revoke execute on function public.record_claim_quote(uuid, numeric, text, date), public.record_quote_response(uuid, text, date, text),
  public.dispute_warranty_claim(uuid, text), public.decide_claim_dispute(uuid, text, text) from public, anon;
grant execute on function public.record_claim_quote(uuid, numeric, text, date), public.record_quote_response(uuid, text, date, text),
  public.dispute_warranty_claim(uuid, text), public.decide_claim_dispute(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Every step → the sales persons involved (not the person who made the step)
-- ---------------------------------------------------------------------------
create or replace function app.claim_step_to_sales(p_claim uuid, p_kind text, p_title text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims; w public.warranties; who uuid[];
begin
  select * into c from public.warranty_claims where id = p_claim;
  -- the decision notifies every sales person involved directly
  if c.id is null or p_kind = 'decided' then return; end if;
  select * into w from public.warranties where id = c.warranty_id;
  select coalesce(array_agg(x), '{}') into who from unnest(app.claim_sales(c)) x
   where x is distinct from auth.uid()
     -- these steps already notify the project's sales person and the reporter directly
     and not (p_kind in ('goodwill_approved', 'goodwill_rejected', 'closed', 'cancelled') and x in (w.owner_id, c.reported_by));
  if cardinality(who) = 0 then return; end if;
  perform app.notify_many(who, 'warranty_claim_step', p_title, app.claim_head(c) || coalesce(' · ' || nullif(p_note, ''), ''),
    'normal', 'warranty_claim', c.id, app.claim_url(c.id));
end $$;

create or replace function app.warranty_log_to_sales() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.claim_id is null or new.kind in ('edited') then return new; end if;
  perform app.claim_step_to_sales(new.claim_id, new.kind,
    case new.kind
      when 'claim_logged' then 'Warranty claim opened'
      when 'verified' then 'Warranty claim verified'
      when 'assigned' then 'Engineer assigned for the site inspection'
      when 'inspected' then 'Site inspection done – decision next'
      when 'decided' then 'Warranty claim decided'
      when 'goodwill_approved' then 'Goodwill cover approved'
      when 'goodwill_rejected' then 'Goodwill not approved – chargeable'
      when 'supplier_raised' then 'Claim raised with the supplier'
      when 'rma' then 'Claim raised with the manufacturer'
      when 'resolved' then 'Supplier answered the claim'
      when 'rma_closed' then 'Manufacturer claim finished'
      when 'rectified' then 'Repaired / replaced at site – the customer will be asked to confirm'
      when 'quoted' then 'Repair quote recorded – waiting for the customer'
      when 'quote_accepted' then 'Customer accepted the quote – repair to be scheduled'
      when 'quote_declined' then 'Customer declined the quote – claim closed'
      when 'disputed' then 'Customer dispute sent to SM Projects'
      when 'dispute_upheld' then 'Dispute: SM Projects upheld the decision – inform the customer'
      when 'dispute_goodwill' then 'Dispute: covered as goodwill – repair to be arranged'
      when 'closed' then 'Warranty claim closed'
      when 'cancelled' then 'Warranty claim cancelled'
      else 'Warranty claim update'
    end, new.note);
  return new;
end $$;
drop trigger if exists warranty_log_to_sales on public.warranty_log;
create trigger warranty_log_to_sales after insert on public.warranty_log for each row execute function app.warranty_log_to_sales();

-- Manufacturer claim steps → sales persons of each linked customer claim (stage only, no values)
create or replace function app.rma_log_to_sales() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.manufacturer_claims; t text; cl uuid;
begin
  select * into r from public.manufacturer_claims where id = new.rma_id;
  t := case new.kind
    when 'contacted' then 'Manufacturer contacted about the claim'
    when 'acknowledged' then 'Manufacturer accepted the return (RMA ' || coalesce(r.rma_no, '') || ')'
    when 'returned' then 'Faulty items sent back to the manufacturer'
    when 'decision' then case r.decision when 'accepted' then 'Manufacturer accepted the claim' when 'partly' then 'Manufacturer partly accepted the claim'
                                          else 'Manufacturer rejected the claim – DIMO is reviewing' end
    when 'received' then 'Replacement / credit received from the manufacturer'
    when 'smp_escalate' then 'Claim escalated with the manufacturer'
  end;
  if t is null then return new; end if;
  for cl in select distinct claim_id from public.manufacturer_claim_items where rma_id = r.id and claim_id is not null loop
    perform app.claim_step_to_sales(cl, 'rma_' || new.kind, t, 'manufacturer claim ' || r.code);
  end loop;
  return new;
end $$;
drop trigger if exists rma_log_to_sales on public.manufacturer_claim_log;
create trigger rma_log_to_sales after insert on public.manufacturer_claim_log for each row execute function app.rma_log_to_sales();

-- ---------------------------------------------------------------------------
-- Disputes in SM Projects' / GM's approvals (copied from 20260930000058)
-- ---------------------------------------------------------------------------
create or replace function public.my_pending_approvals()
returns table (source text, id uuid, kind text, title text, reason text, requested_by uuid, requester text,
               requested_at timestamptz, inquiry_id uuid, url text, step text)
language sql stable security definer set search_path = public as $$
  select 'approval', a.id, a.kind::text, a.title, a.reason, a.requested_by, app.display_name(a.requested_by), a.requested_at,
         a.inquiry_id, case when a.inquiry_id is not null then app.inquiry_url(a.inquiry_id) else '/approvals' end,
         format('Step %s of %s', a.current_step, (select count(*) from public.approval_steps x where x.approval_id = a.id))
  from public.approvals a
  join public.approval_steps s on s.approval_id = a.id and s.step_no = a.current_step
  where a.status = 'pending' and (s.approver_role = app.my_role() or (app.my_role() = 'gm' and s.approver_role = 'gm'))
  union all
  select 'visit_plan', p.id, 'weekly_plan', format('Weekly plan – %s – week of %s', app.display_name(p.sales_person_id), to_char(p.week_start, 'DD Mon')),
         case when p.is_late then 'Submitted late' end, p.sales_person_id, app.display_name(p.sales_person_id), p.submitted_at,
         null, '/plan/' || p.id, null
  from public.visit_plans p where p.status = 'submitted' and app.has_role('sm_projects')
  union all
  select 'design_review', d.id, 'design_release', format('Design review – %s (%s)', i.code, d.task_type), i.project_name,
         d.assignee_id, app.display_name(d.assignee_id), d.submitted_at, i.id, '/design/' || d.id, null
  from public.design_jobs d join public.inquiries i on i.id = d.inquiry_id
  where d.status = 'in_review' and app.has_role('design_manager')
  union all
  select 'quotation_review', e.id, 'quotation_release', format('Quotation approval – %s', i.code), i.project_name,
         e.assignee_id, app.display_name(e.assignee_id), e.submitted_at, i.id, '/estimation/' || e.id, null
  from public.estimation_jobs e join public.inquiries i on i.id = e.inquiry_id
  where e.status = 'submitted_for_approval' and app.has_role('sm_estimation')
  union all
  select 'sample', sm.id, 'sample_request', format('Sample request %s', sm.code), sm.purpose,
         sm.sales_person_id, app.display_name(sm.sales_person_id), sm.submitted_at, null, '/samples/' || sm.id, sm.status
  from public.samples sm
  where (sm.status = 'submitted' and app.has_role('operations_exec'))
     or (sm.status = 'availability_confirmed' and app.has_role('sm_projects'))
     or (sm.status = 'gm_approval' and app.has_role('gm'))
  union all
  select 'claim_dispute', c.id, 'warranty_dispute', format('Warranty dispute – %s – %s', c.code, w.customer), c.dispute_reason,
         c.disputed_by, app.display_name(c.disputed_by), c.disputed_at, null, app.claim_url(c.id), app.fault_cause_label(c.fault_cause)
  from public.warranty_claims c join public.warranties w on w.id = c.warranty_id
  where c.dispute_status = 'pending' and app.has_role('sm_projects', 'gm')
  order by 8
$$;

-- ---------------------------------------------------------------------------
-- Reminders (every 15 minutes from 08:00)
--   * chargeable, no quote 5 working days after the decision → sales persons, Operations; 10 → + SM Projects
--   * quoted, no customer answer in 14 days → sales persons, Operations
--   * dispute waiting 3 working days → SM Projects, GM / DGM
--   * Monday: not-covered claims of the last 4 weeks by fault cause → SM Projects, GM / DGM, Senior Elec. Engineer
-- ---------------------------------------------------------------------------
create or replace function public.claim_followup_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  n int := 0;
  ops uuid[] := app.role_users('operations_exec');
  smp uuid[] := app.role_users('sm_projects');
  cl public.warranty_claims;
  wd numeric;
  lvl int;
  summary text;
begin
  if loc::time < time '08:00' then return 0; end if;

  for cl in select * from public.warranty_claims where status = 'open' and decision = 'chargeable' and goodwill_status is distinct from 'pending'
                                                   and customer_response is null and dispute_status is distinct from 'pending' loop
    if cl.quoted_on is null then
      wd := app.work_minutes_between(cl.decided_at, p_at) / app.working_minutes_per_day();
      lvl := case when wd >= 10 then 2 when wd >= 5 then 1 else 0 end;
      if lvl > cl.quote_alert_level then
        perform app.notify_many(app.claim_sales(cl) || ops || case when lvl >= 2 then smp else '{}'::uuid[] end, 'warranty_quote_due',
          format('Chargeable warranty claim not quoted after %s working days', floor(wd)), app.claim_head(cl), 'normal', 'warranty_claim', cl.id, app.claim_url(cl.id));
        update public.warranty_claims set quote_alert_level = lvl where id = cl.id; n := n + 1;
      end if;
    elsif cl.quote_alert_level < 3 and today - cl.quoted_on >= 14 then
      perform app.notify_many(app.claim_sales(cl) || ops, 'warranty_quote_followup', 'No answer from the customer 14 days after the repair quote',
        app.claim_head(cl), 'normal', 'warranty_claim', cl.id, app.claim_url(cl.id));
      update public.warranty_claims set quote_alert_level = 3 where id = cl.id; n := n + 1;
    end if;
  end loop;

  for cl in select * from public.warranty_claims where dispute_status = 'pending' and not dispute_alerted loop
    if app.work_minutes_between(cl.disputed_at, p_at) / app.working_minutes_per_day() >= 3 then
      perform app.notify_many(smp || app.role_users('gm'), 'warranty_dispute_overdue', 'Customer''s warranty dispute waiting 3 working days',
        app.claim_head(cl) || coalesce(' · ' || cl.dispute_reason, ''), 'critical', 'warranty_claim', cl.id, app.claim_url(cl.id));
      update public.warranty_claims set dispute_alerted = true where id = cl.id; n := n + 1;
    end if;
  end loop;

  if extract(isodow from loc) = 1 then
    select string_agg(format('%s %s', k, app.fault_cause_label(fault_cause)), ' · ' order by k desc) into summary
      from (select fault_cause, count(*) k from public.warranty_claims
             where decision in ('chargeable', 'rejected') and fault_cause is not null and decided_at >= p_at - interval '28 days'
             group by fault_cause) s;
    if summary is not null then
      perform app.notify_many(smp || app.role_users('gm', 'senior_elec_engineer'), 'warranty_causes_weekly', 'Not-covered warranty claims – last 4 weeks by cause',
        summary || coalesce(format(' · %s disputes waiting', nullif((select count(*) from public.warranty_claims where dispute_status = 'pending'), 0)), ''),
        'normal', null, null, '/warranty', format('warrantycauses:%s', today), false);
      n := n + 1;
    end if;
  end if;
  return n;
end $$;
revoke execute on function public.claim_followup_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_followup_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('claim-followup-tick', '*/15 * * * *', 'select public.claim_followup_tick()');
  end if;
end $$;
