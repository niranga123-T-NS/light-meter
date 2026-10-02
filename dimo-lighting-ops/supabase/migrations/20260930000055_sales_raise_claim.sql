-- Sales persons and SM Projects can raise warranty claims directly (e.g. a complaint received by them). Such a claim starts as
-- "To verify": the Operations Executive (back end and coordination) or the Senior Electrical Engineer confirm it (invoice /
-- contract number, our supply). Sales persons raise claims only on warranties of their own projects / categories.
-- Only the Senior Electrical Engineer assigns the engineer for the site inspection (assigning also verifies the claim).

alter table public.warranty_claims add column if not exists needs_verification boolean not null default false;
alter table public.warranty_claims add column if not exists verified_at timestamptz;
alter table public.warranty_claims add column if not exists verified_by uuid references public.profiles (id);

create or replace function public.log_warranty_claim(p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  w public.warranties;
  ln public.warranty_lines;
  r public.warranty_reports;
  c public.warranty_claims;
  today date := (now() at time zone app.tz())::date;
  inw boolean;
  via text := coalesce(nullif(p_data ->> 'reported_via', ''), 'customer_call');
  asg uuid := nullif(p_data ->> 'assignee_id', '')::uuid;
  desk boolean := app.is_warranty_desk();
begin
  perform app.require(desk or app.is_sales_person() or app.has_role('sm_projects'),
    'Only Operations, the Senior Electrical Engineer, sales persons and SM Projects raise warranty claims');
  select * into w from public.warranties where id = nullif(p_data ->> 'warranty_id', '')::uuid;
  perform app.require(w.id is not null and w.status = 'active', 'Choose the warranty (find it by invoice / contract number, customer or project)');
  perform app.require(desk or app.can_read_warranty(w.id), 'You can raise claims only on warranties of your own projects or categories');
  -- Raised by sales / SM Projects: Operations or the Senior Electrical Engineer verify it and assign the engineer
  if not desk then
    perform app.require(nullif(p_data ->> 'report_id', '') is null, 'Operations or the Senior Electrical Engineer convert reported issues');
  end if;
  if not app.has_role('senior_elec_engineer') then asg := null; end if;  -- only the Senior Electrical Engineer assigns engineers
  if nullif(p_data ->> 'line_id', '') is not null then
    select * into ln from public.warranty_lines where id = (p_data ->> 'line_id')::uuid and warranty_id = w.id;
    perform app.require(ln.id is not null, 'The line does not belong to this warranty');
    inw := ln.end_date >= today;
  else
    inw := exists (select 1 from public.warranty_lines where warranty_id = w.id and end_date >= today);
  end if;
  if nullif(p_data ->> 'report_id', '') is not null then
    select * into r from public.warranty_reports where id = (p_data ->> 'report_id')::uuid for update;
    perform app.require(r.id is not null and r.status = 'reported', 'This reported issue is already handled');
    via := 'sales_visit';
  end if;
  perform app.require(via in ('customer_call', 'customer_email', 'customer_letter', 'sales_visit', 'site_inspection', 'other'), 'Choose how it was reported');
  perform app.require(coalesce(nullif(btrim(p_data ->> 'description'), ''), r.description, '') <> '', 'Describe the failure');
  perform app.check_engineer(asg);
  insert into public.warranty_claims (warranty_id, line_id, reported_via, report_id, reported_by, description, quantity, location, in_warranty,
    assignee_id, assigned_at, needs_verification)
  values (w.id, ln.id, via, r.id, coalesce(r.sales_person_id, case when not desk then auth.uid() end),
    coalesce(nullif(btrim(p_data ->> 'description'), ''), r.description),
    coalesce(nullif(p_data ->> 'quantity', '')::numeric, r.quantity), coalesce(nullif(btrim(p_data ->> 'location'), ''), r.location), inw,
    asg, case when asg is not null then now() end, not desk)
  returning * into c;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (w.id, c.id, 'claim_logged', format('Claim %s logged (%s)%s', c.code, case when inw then 'in warranty' else 'out of warranty' end,
          coalesce(' · assigned to ' || app.display_name(asg), '')));
  if r.id is not null then
    update public.warranty_reports set status = 'converted', claim_id = c.id, handled_by = auth.uid(), handled_at = now() where id = r.id;
    perform app.notify(r.sales_person_id, 'warranty_claim_opened', 'Claim opened from your visit report', app.claim_head(c),
      'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  end if;
  perform app.notify_many(array[w.owner_id] || app.role_users('operations_exec', 'senior_elec_engineer', 'sm_projects'), 'warranty_claim_logged',
    case when desk then 'Warranty claim logged' else format('Warranty claim raised by %s – verify and assign', coalesce(app.display_name(auth.uid()), 'sales')) end
      || case when inw then '' else ' – out of warranty' end, app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id), null, not desk);
  if asg is null then
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'warranty_claim_to_assign', 'Assign an engineer to warranty claim ' || c.code,
      app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id), null, true);
  end if;
  if asg is not null then
    perform app.notify(asg, 'warranty_claim_assigned', 'Warranty claim assigned to you – inspect the site', app.claim_head(c),
      'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  end if;
  return c.id;
end $$;


-- Assigning the engineer also verifies a claim raised by sales / SM Projects
create or replace function public.assign_warranty_claim(p_id uuid, p_assignee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'Only the Senior Electrical Engineer assigns engineers');
  c := app.claim_for_update(p_id);
  perform app.require(p_assignee is not null, 'Choose the engineer');
  perform app.check_engineer(p_assignee);
  update public.warranty_claims set assignee_id = p_assignee, assigned_at = now(), inspect_alert_level = 0,
    verified_at = case when needs_verification and verified_at is null then now() else verified_at end,
    verified_by = case when needs_verification and verified_at is null then auth.uid() else verified_by end
  where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'assigned', case when c.needs_verification and c.verified_at is null then 'Verified and assigned to ' else 'Assigned to ' end
          || app.display_name(p_assignee));
  perform app.notify(p_assignee, 'warranty_claim_assigned', 'Warranty claim assigned to you – inspect the site', app.claim_head(c),
    'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  if c.needs_verification and c.verified_at is null and c.reported_by is not null then
    perform app.notify(c.reported_by, 'warranty_claim_opened', 'Your warranty claim was verified', app.claim_head(c) || ' · engineer ' || app.display_name(p_assignee),
      'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  end if;
end $$;

-- Operations Executive (or the Senior Electrical Engineer) verifies a claim raised by sales / SM Projects
create or replace function public.verify_warranty_claim(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.warranty_claims;
begin
  perform app.require(app.is_warranty_desk(), 'Only the Operations Executive or the Senior Electrical Engineer verify claims');
  c := app.claim_for_update(p_id);
  perform app.require(c.needs_verification and c.verified_at is null, 'This claim does not need verification');
  update public.warranty_claims set verified_at = now(), verified_by = auth.uid() where id = c.id;
  insert into public.warranty_log (warranty_id, claim_id, kind, note)
  values (c.warranty_id, c.id, 'verified', concat_ws(' · ', 'Verified (invoice / contract no., our supply)', nullif(btrim(p_note), '')));
  if c.reported_by is not null then
    perform app.notify(c.reported_by, 'warranty_claim_opened', 'Your warranty claim was verified', app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id));
  end if;
  if c.assignee_id is null then
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'warranty_claim_to_assign', 'Assign an engineer to warranty claim ' || c.code,
      app.claim_head(c), 'normal', 'warranty_claim', c.id, app.claim_url(c.id), null, true);
  end if;
end $$;
revoke execute on function public.verify_warranty_claim(uuid, text) from public, anon;
grant execute on function public.verify_warranty_claim(uuid, text) to authenticated;
