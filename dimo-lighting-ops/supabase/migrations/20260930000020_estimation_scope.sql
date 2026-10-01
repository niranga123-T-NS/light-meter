-- What Estimation must price (scope) and on what basis, set by sales with the inquiry (Routes A and B).
-- Shown on the design and estimation jobs; changed after submission through the client expectation change
-- approval (Design Manager → SM Estimation; SM Estimation only for Route B).

alter table public.inquiries
  add column if not exists estimation_scope text[] not null default '{}',
  add column if not exists estimation_basis text;
alter table public.inquiries drop constraint if exists inquiries_estimation_scope_check;
alter table public.inquiries add constraint inquiries_estimation_scope_check
  check (estimation_scope <@ array['fixtures', 'electrical', 'controls', 'poles']::text[]);
alter table public.inquiries drop constraint if exists inquiries_estimation_basis_check;
alter table public.inquiries add constraint inquiries_estimation_basis_check
  check (estimation_basis is null or estimation_basis in ('supply', 'supply_install', 'supply_install_commission'));

-- Submitting (or resubmitting) an inquiry that needs pricing requires the estimation scope and basis
create or replace function app.inquiries_scope_check() returns trigger
language plpgsql as $$
begin
  if new.status = 'submitted' and old.status in ('draft', 'returned_for_info') and new.route in ('A', 'B') then
    if coalesce(array_length(new.estimation_scope, 1), 0) = 0 then
      raise exception 'Select the estimation scope (what Estimation must price)';
    end if;
    if new.estimation_basis is null then
      raise exception 'Select the estimation basis (supply only, supply & install, or supply, install & commission)';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists inquiries_scope_check on public.inquiries;
create trigger inquiries_scope_check before update of status on public.inquiries
for each row execute function app.inquiries_scope_check();
revoke execute on function app.inquiries_scope_check() from public, anon;
grant execute on function app.inquiries_scope_check() to authenticated, service_role;

-- Client expectation change now also carries the design scope, estimation scope and basis
create or replace function app.apply_approval(a public.approvals, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries;
  approved boolean := a.status = 'approved';
begin
  perform set_config('app.workflow', '1', true);
  if a.inquiry_id is not null then select * into i from public.inquiries where id = a.inquiry_id; end if;

  case a.kind
  when 'mixed_duty' then
    if approved then
      update public.inquiries set mixed_duty_approved = true where id = a.inquiry_id;
      perform app.notify(i.sales_person_id, 'mixed_duty_approved', 'Mixed duty approved – you can submit',
        i.code, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'debtor_check' then
    if approved then
      perform public.resume_inquiry(a.inquiry_id);
    else
      perform app.notify(i.sales_person_id, 'debtor_hold', 'Inquiry held for debtor collection',
        coalesce(p_comment, ''), 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'release_mode' then
    if approved then
      update public.inquiries set release_mode = coalesce((a.payload ->> 'release_mode')::int, release_mode),
        release_mode_confirmed = true where id = a.inquiry_id;
    end if;
  when 'duty_change' then
    if approved then
      update public.inquiries set duty_status = (a.payload ->> 'duty_status')::public.duty_status where id = a.inquiry_id;
      perform app.notify_many(array[(select assignee_id from public.estimation_jobs where inquiry_id = i.id order by created_at desc limit 1)]
        || app.role_users('sm_estimation'), 'duty_changed', 'Duty status changed', format('%s is now %s – revise the quotation',
        i.code, a.payload ->> 'duty_status'), 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'expectation_change' then
    if approved then
      update public.inquiries set solution_level = coalesce(a.payload ->> 'solution_level', solution_level),
        manufacturing_origin = coalesce(a.payload ->> 'manufacturing_origin', manufacturing_origin),
        expectation_notes = coalesce(a.payload ->> 'expectation_notes', expectation_notes),
        estimation_scope = coalesce((select array_agg(x) from jsonb_array_elements_text(
                                       case when jsonb_typeof(a.payload -> 'estimation_scope') = 'array' then a.payload -> 'estimation_scope' end) x),
                                    estimation_scope),
        estimation_basis = coalesce(a.payload ->> 'estimation_basis', estimation_basis),
        design_scope = coalesce(a.payload ->> 'design_scope', design_scope)
      where id = a.inquiry_id;
      perform app.notify_many(
        array(select assignee_id from public.design_jobs where inquiry_id = i.id and status not in ('approved', 'released')
              union select assignee_id from public.estimation_jobs where inquiry_id = i.id and status not in ('released')),
        'expectation_changed', 'Client expectation changed – review your job', i.code, 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'early_design_release' then
    if approved then
      update public.inquiries set early_design_release_at = now(), design_released_to_sales_at = now() where id = a.inquiry_id;
      perform app.log_status('inquiry', i.id, i.id, i.status, i.status, 'Early design release approved');
      perform app.notify_many(array[i.sales_person_id] || app.role_users('sm_projects'), 'design_released',
        'Design released early for client approval', format('%s – %s', i.code, i.project_name),
        'normal', 'inquiry', i.id, app.inquiry_url(i.id));
    end if;
  when 'quotation_release' then
    update public.estimation_jobs set status = case when approved then 'approved' else 'returned' end,
      approved_at = case when approved then now() end, review_comment = p_comment
    where id = a.entity_id;
    perform app.notify((select assignee_id from public.estimation_jobs where id = a.entity_id),
      case when approved then 'quotation_approved' else 'quotation_returned' end,
      case when approved then 'GM approved the quotation – release it' else 'Quotation returned by GM / DGM' end,
      format('%s %s', i.code, coalesce(p_comment, '')), 'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  when 'estimation_hold' then
    if approved then
      update public.estimation_jobs set status_before_hold = status, status = 'on_hold', hold_reason = a.reason where id = a.entity_id;
      perform app.pause_clocks('estimation_job', a.entity_id, a.reason);
      perform app.refresh_inquiry(a.inquiry_id);
    end if;
  when 'weekly_plan' then
    null; -- handled by approve_visit_plan
  when 'sample_return_date' then
    if approved then
      update public.samples set expected_return_date = (a.payload ->> 'new_date')::date where id = a.entity_id;
    end if;
  when 'account_ownership' then
    if approved then
      if a.entity_type = 'organization' then
        update public.organizations set account_owner_id = (a.payload ->> 'owner_id')::uuid where id = a.entity_id;
      else
        update public.org_units set account_owner_id = (a.payload ->> 'owner_id')::uuid where id = a.entity_id;
      end if;
    end if;
  else
    null;
  end case;
end $$;
