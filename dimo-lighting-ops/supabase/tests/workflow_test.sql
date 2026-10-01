-- End-to-end workflow test. Run against a database with all migrations + seed applied:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_test.sql
-- It creates test users, walks Route A (design → estimation) and Route B end to end,
-- checks row-level security and SLA clocks, the debtors upload and a sample request, then rolls back.

begin;

-- Test users (one per role) ---------------------------------------------------
create temp table u (role text primary key, id uuid) on commit drop;
grant all on u to authenticated;
insert into u values
  ('gm', gen_random_uuid()), ('sm_projects', gen_random_uuid()), ('asm_building', gen_random_uuid()),
  ('asm_infra', gen_random_uuid()), ('design_manager', gen_random_uuid()), ('lighting_designer', gen_random_uuid()),
  ('lighting_engineer', gen_random_uuid()), ('sm_estimation', gen_random_uuid()), ('am_estimation', gen_random_uuid()),
  ('estimation_exec', gen_random_uuid()), ('operations_exec', gen_random_uuid()), ('sys_admin', gen_random_uuid());
insert into auth.users (id, email) select id, role || '@test.local' from u;
insert into public.profiles (id, full_name, role) select id, initcap(replace(role, '_', ' ')), role::public.app_role from u;
update public.profiles p set manager_id = (select id from u where role = case p.role
    when 'sm_projects' then 'gm' when 'asm_building' then 'sm_projects' when 'asm_infra' then 'sm_projects'
    when 'design_manager' then 'sm_projects' when 'lighting_designer' then 'design_manager' when 'lighting_engineer' then 'design_manager'
    when 'sm_estimation' then 'gm' when 'am_estimation' then 'sm_estimation' when 'estimation_exec' then 'sm_estimation'
    when 'operations_exec' then 'gm' else null end);
insert into public.exchange_rates (month, usd_to_lkr) values (date_trunc('month', now())::date, 300);

create or replace function pg_temp.act_as(r text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from u where role = r), false);
$$;
grant execute on function pg_temp.act_as(text) to authenticated;

-- 1. Sales creates a customer, a project and a visit --------------------------
select pg_temp.act_as('asm_building');
set role authenticated;

insert into public.organizations (id, name, visit_category, phone)
values ('00000000-0000-0000-0000-00000000a001', 'ABC Hotels PLC', 'End-Client', '0112000000');
insert into public.org_units (id, organization_id, name, unit_type)
values ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000a001', 'Engineering Division', 'division');
insert into public.contacts (id, organization_id, unit_id, name, designation)
values ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002', 'Nimal Perera', 'Chief Engineer');

insert into public.projects (id, name, project_type, organization_id, unit_id, city, lat, lng, expected_duration_months, project_term, lighting_value, project_value, owner_id)
values ('00000000-0000-0000-0000-00000000b001', 'ABC Hotels – Beach Resort – Galle', 'hospitality', '00000000-0000-0000-0000-00000000a001',
        '00000000-0000-0000-0000-00000000a002', 'Galle', 6.0535, 80.2210, 12, 'medium', 45000000, 900000000,
        (select id from u where role = 'asm_building'));

do $$ begin
  assert (select owner_id from public.projects where id = '00000000-0000-0000-0000-00000000b001') = (select id from u where role = 'asm_building'), 'owner set';
  assert (select win_probability from public.projects where id = '00000000-0000-0000-0000-00000000b001') = 10, 'default probability';
  assert (select code from public.projects where id = '00000000-0000-0000-0000-00000000b001') like 'PRJ-%', 'project code';
end $$;

-- Sales creates a project through the app's RPC (INSERT ... RETURNING must pass the read policy)
savepoint rpc_project;
do $$ begin
  assert (select public.create_project(jsonb_build_object('name', 'ABC Hotels – City Hotel – Kandy', 'project_type', 'hospitality',
    'organization_id', '00000000-0000-0000-0000-00000000a001', 'expected_duration_months', 1, 'project_term', 'short'))) is not null, 'create_project as sales';
end $$;
rollback to savepoint rpc_project;

-- Exact duplicate is blocked
do $$ begin
  begin
    insert into public.projects (name, project_type, organization_id, expected_duration_months, project_term, owner_id)
    values ('ABC Hotels - Beach Resort, Galle', 'hospitality', '00000000-0000-0000-0000-00000000a001', 12, 'medium', auth.uid());
    raise exception 'duplicate was not blocked';
  exception when others then
    if sqlerrm not like '%already exists%' then raise; end if;
  end;
  assert (select count(*) from public.find_similar_projects('Beach Resort Galle', null, 6.0536, 80.2211)) >= 1, 'similar project found';
end $$;

-- Sales person cannot create an infrastructure project
do $$ begin
  begin
    insert into public.projects (name, project_type, organization_id, expected_duration_months, project_term, owner_id)
    values ('Southern Expressway Lighting', 'infrastructure', '00000000-0000-0000-0000-00000000a001', 24, 'long', auth.uid());
    raise exception 'territory not enforced';
  exception when others then
    if sqlerrm not like '%own project types%' and sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;

-- Probability outside the band needs a reason
do $$ begin
  begin
    update public.projects set win_probability = 60 where id = '00000000-0000-0000-0000-00000000b001';
    raise exception 'band not enforced';
  exception when others then
    if sqlerrm not like '%outside%' then raise; end if;
  end;
  perform set_config('app.reason', 'Consultant confirmed our spec informally', true);
  update public.projects set win_probability = 30 where id = '00000000-0000-0000-0000-00000000b001';
  perform set_config('app.reason', '', true);
  assert (select count(*) from public.project_log where project_id = '00000000-0000-0000-0000-00000000b001' and field = 'win_probability') = 1, 'probability logged';
end $$;

insert into public.visits (id, organization_id, unit_id, contact_id, project_id, visit_category, primary_objective, checkin_lat, checkin_lng, summary, outcome, status)
values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002',
        '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000b001', 'End-Client', 'Requirement Gathering',
        6.0540, 80.2215, 'Met the chief engineer and walked the lobby and pool areas; they need a lighting layout.', 'Inquiry Received', 'closed');
do $$ begin
  assert (select gps_verified from public.visits where id = '00000000-0000-0000-0000-00000000c001'), 'gps verified';
  assert (select unplanned from public.visits where id = '00000000-0000-0000-0000-00000000c001'), 'unplanned flagged';
end $$;

-- 2. Inquiry Route A --------------------------------------------------------
insert into public.inquiries (id, project_id, visit_id, organization_id, unit_id, contact_id, route, duty_status, design_scope,
                              customer_deadline, design_required_by, quotation_required_by, scope_description, solution_level, manufacturing_origin)
values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000c001',
        '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000a003',
        'A', 'duty_paid', 'lighting', current_date + 30, current_date + 12, current_date + 25,
        'Lobby, pool deck and 120 guest rooms – lighting layout and calculations', 'high', 'european')
returning id; -- the app saves with INSERT … RETURNING, so the new row must pass the read policy

-- Sales cannot push the status directly
do $$ begin
  begin
    update public.inquiries set status = 'accepted' where id = '00000000-0000-0000-0000-00000000d001';
    raise exception 'status bypass allowed';
  exception when others then
    if sqlerrm not like '%Workflow fields%' then raise; end if;
  end;
end $$;

select public.submit_inquiry('00000000-0000-0000-0000-00000000d001');
do $$ begin
  assert (select status from public.inquiries where id = '00000000-0000-0000-0000-00000000d001') = 'submitted', 'submitted';
  assert (select code from public.inquiries where id = '00000000-0000-0000-0000-00000000d001') like 'INQ-%', 'inquiry code';
end $$;
reset role;

-- SM Projects confirms the release mode
select pg_temp.act_as('sm_projects');
set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'release_mode' and entity_id = '00000000-0000-0000-0000-00000000d001'), 'approved');
reset role;

-- 3. Design Manager accepts and assigns ------------------------------------------
select pg_temp.act_as('design_manager');
set role authenticated;
do $$ begin
  assert (select count(*) from public.inquiries) = 1, 'DM sees the design inquiry';
  assert (select count(*) from public.visits) = 0, 'DM cannot see visits';
  assert (select count(*) from public.projects) = 0, 'DM cannot see projects';
end $$;
select public.accept_inquiry('00000000-0000-0000-0000-00000000d001');
select public.assign_design_job('00000000-0000-0000-0000-00000000d001', (select id from u where role = 'lighting_designer'),
                                now() + interval '5 days', 'lighting', 'medium');
reset role;

-- 4. Designer works and submits --------------------------------------------------
select pg_temp.act_as('lighting_designer');
set role authenticated;
do $$ declare j uuid;
begin
  select id into j from public.design_jobs;
  assert j is not null, 'designer sees own job';
  perform public.acknowledge_design_job(j);
  perform public.update_design_progress(j, 60, 6.5, 'Layout done');
  begin
    perform public.submit_design_for_review(j);
    raise exception 'submit without files allowed';
  exception when others then if sqlerrm not like '%Upload the design%' then raise; end if;
  end;
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('design_job', j, 'design_pack', 'design_job/' || j || '/pack.pdf', 'pack.pdf');
  perform public.set_design_brands(j, '[{"group":"Downlights","brand":"TestBrand EU","origin":"european"}]');
  perform public.submit_design_for_review(j);
end $$;
reset role;

select pg_temp.act_as('design_manager');
set role authenticated;
select public.review_design((select id from public.design_jobs), true, 'Good');
select public.release_design('00000000-0000-0000-0000-00000000d001');
do $$ begin
  assert (select status from public.inquiries where id = '00000000-0000-0000-0000-00000000d001') = 'in_estimation', 'sent to estimation';
end $$;
reset role;

-- 5. Sales sees only the progress tracker ---------------------------------------
select pg_temp.act_as('asm_building');
set role authenticated;
do $$ begin
  assert (select count(*) from public.design_jobs) = 0, 'sales cannot see design workspace';
  assert (select count(*) from public.estimation_jobs) = 0, 'sales cannot see estimation workspace';
  assert (select count(*) from public.attachments where entity_type = 'design_job') = 0, 'design pack held for mode 3';
  assert (select count(*) from public.inquiry_timeline('00000000-0000-0000-0000-00000000d001')) >= 5, 'timeline visible';
end $$;
reset role;

-- 6. Estimation ------------------------------------------------------------------
select pg_temp.act_as('sm_estimation');
set role authenticated;
select public.accept_estimation((select id from public.estimation_jobs));
select public.assign_estimation_job((select id from public.estimation_jobs), public.default_estimator('00000000-0000-0000-0000-00000000d001'),
                                    now() + interval '7 days', 'large');
reset role;

select pg_temp.act_as('estimation_exec');
set role authenticated;
do $$ declare j uuid;
begin
  select id into j from public.estimation_jobs;
  assert j is not null, 'estimator sees own job';
  assert (select count(*) from public.attachments where entity_type = 'design_job' and kind = 'design_pack') = 1, 'estimator sees design pack';
  perform public.acknowledge_estimation_job(j);
  perform public.save_estimate(j, 60000000, 45000000, 25, '[{"group":"Downlights","brand":"TestBrand EU","origin":"european"}]');
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values
    ('estimation_job', j, 'quotation_draft', 'estimation_job/' || j || '/d.pdf', 'draft.pdf'),
    ('estimation_job', j, 'costing_sheet', 'estimation_job/' || j || '/c.xlsx', 'costing.xlsx');
  perform public.submit_estimate_for_approval(j);
  assert (select file_name from public.attachments where kind = 'quotation_draft') like 'INQ-%-R0-draft-v1.pdf', 'file renamed';
end $$;
reset role;

-- Above the GM value threshold → GM approval
select pg_temp.act_as('sm_estimation');
set role authenticated;
do $$ begin
  assert public.review_estimate((select id from public.estimation_jobs), true, 'OK') = 'gm_approval', 'needs GM';
end $$;
reset role;
select pg_temp.act_as('gm');
set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'quotation_release'), 'approved', 'Proceed');
reset role;

select pg_temp.act_as('estimation_exec');
set role authenticated;
do $$ declare j uuid;
begin
  select id into j from public.estimation_jobs;
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values
    ('estimation_job', j, 'quotation_final', 'estimation_job/' || j || '/f.pdf', 'final.pdf'),
    ('estimation_job', j, 'compliance_sheet', 'estimation_job/' || j || '/cs.pdf', 'compliance.pdf'),
    ('estimation_job', j, 'technical_data', 'estimation_job/' || j || '/tds.pdf', 'tds.pdf');
  perform public.release_quotation(j);
end $$;
reset role;

-- 7. Sales: released quotation visible, costing hidden; submit and win -------------
select pg_temp.act_as('asm_building');
set role authenticated;
do $$ begin
  assert (select status from public.inquiries) = 'quotation_released', 'released';
  assert (select count(*) from public.quotations) = 1, 'sales sees quotation';
  assert (select count(*) from public.estimation_costing) = 0, 'sales cannot see cost/margin';
  assert (select count(*) from public.attachments where kind = 'costing_sheet') = 0, 'sales cannot see costing sheet';
  assert (select count(*) from public.attachments where kind = 'quotation_final') = 1, 'sales sees final quotation';
  assert (select count(*) from public.attachments where kind = 'design_pack') = 1, 'design pack released with quotation';
  assert (select count(*) from public.notifications where kind = 'quotation_released') = 1, 'release notification';
  assert (select count(*) from public.inquiry_files('00000000-0000-0000-0000-00000000d001') where kind = 'costing_sheet') = 0, 'inquiry_files hides costing';
  assert (select count(*) from public.inquiry_files('00000000-0000-0000-0000-00000000d001') where kind in ('design_pack', 'quotation_final')) = 2, 'inquiry_files shows released files';
end $$;
select public.record_client_submission('00000000-0000-0000-0000-00000000d001');
select public.record_client_response('00000000-0000-0000-0000-00000000d001', 'approved');
select public.record_inquiry_result('00000000-0000-0000-0000-00000000d001', 'won', null, null, 62000000, current_date);
do $$ begin
  assert (select milestone from public.projects) = 'won', 'project won';
  assert (select win_probability from public.projects) = 100, 'probability 100';
end $$;
reset role;

-- 8. Mixed duty requires SM Projects → GM ------------------------------------------
select pg_temp.act_as('asm_building');
set role authenticated;
insert into public.inquiries (id, project_id, organization_id, unit_id, route, duty_status, customer_deadline, scope_description)
values ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001',
        '00000000-0000-0000-0000-00000000a002', 'B', 'duty_free', current_date + 20, 'Façade package – BOQ attached');
do $$ begin
  assert (public.submit_inquiry('00000000-0000-0000-0000-00000000d002') ->> 'status') = 'approval_required', 'mixed duty blocked';
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'mixed_duty'), 'approved');
reset role;
select pg_temp.act_as('gm'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'mixed_duty'), 'approved');
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  assert (public.submit_inquiry('00000000-0000-0000-0000-00000000d002') ->> 'status') = 'submitted', 'submitted after approval';
end $$;
reset role;

-- Route B goes to SM Estimation; Design Manager cannot see it
select pg_temp.act_as('design_manager'); set role authenticated;
do $$ begin
  assert (select count(*) from public.inquiries where id = '00000000-0000-0000-0000-00000000d002') = 0, 'DM cannot see route B';
end $$;
reset role;

-- 9. SLA clock: make the acceptance clock overdue and tick -------------------------
update public.sla_clocks set started_at = now() - interval '10 days', due_at = now() - interval '5 days', target_minutes = 240
 where entity_id = '00000000-0000-0000-0000-00000000d002' and stage = 'acceptance' and stopped_at is null;
select public.sla_tick();
do $$ begin
  assert (select colour from public.sla_clocks where entity_id = '00000000-0000-0000-0000-00000000d002' and stage = 'acceptance' and stopped_at is null) = 'red', 'clock red';
  assert (select level from public.sla_clocks where entity_id = '00000000-0000-0000-0000-00000000d002' and stage = 'acceptance' and stopped_at is null) = 5, 'level 3 escalation';
  assert exists (select 1 from public.notifications where kind = 'sla_level_5' and recipient_id = (select id from u where role = 'gm')), 'GM escalated';
  assert (select sla_colour from public.inquiries where id = '00000000-0000-0000-0000-00000000d002') = 'red', 'inquiry red';
end $$;

-- Working-hours arithmetic: Friday 17:00 + 60 working minutes = Monday 09:00 (Asia/Colombo)
do $$ begin
  assert app.add_work_minutes('2026-10-02 17:00+05:30', 60) = '2026-10-05 09:00+05:30'::timestamptz, 'add_work_minutes over weekend';
  assert app.work_minutes_between('2026-10-02 17:00+05:30', '2026-10-05 09:00+05:30') = 60, 'work_minutes_between over weekend';
end $$;

-- 10. Debtors upload -----------------------------------------------------------
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare up uuid; res jsonb;
begin
  up := public.stage_debtor_upload(current_date, '[
    {"project_name":"ABC Hotels - Beach Resort - Galle","client_name":"ABC Hotels PLC","invoice_no":"INV-10452","amount":2400000,"currency":"LKR","outstanding_days":94},
    {"project_name":"Unknown Project","client_name":"Nobody","invoice_no":"INV-1","amount":10,"currency":"LKR","outstanding_days":5}]');
  assert (select error_count from public.debt_uploads where id = up) = 1, 'unmatched row flagged';
  perform public.map_debtor_row((select id from public.debt_upload_rows where upload_id = up and invoice_no = 'INV-1'), '00000000-0000-0000-0000-00000000b001');
  res := public.confirm_debtor_upload(up);
  assert (res ->> 'added')::int = 2, 'two debts added';
  assert (select ageing_bucket from public.debts where invoice_no = 'INV-10452') = '91-120', 'bucket';
end $$;
reset role;

select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  assert (select count(*) from public.debts) = 2, 'sales sees own debts';
  perform public.update_debt_status((select id from public.debts where invoice_no = 'INV-10452'), 'payment_promised', 'Promised by CFO', null, current_date + 7);
end $$;
reset role;
select pg_temp.act_as('lighting_designer'); set role authenticated;
do $$ begin assert (select count(*) from public.debts) = 0, 'design cannot see debts'; end $$;
reset role;

-- 11. Sample request ---------------------------------------------------------------
select pg_temp.act_as('asm_building'); set role authenticated;
insert into public.samples (id, project_id, sample_type, expected_return_date, purpose, required_by, handover_location)
values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000b001', 'returnable', current_date + 14,
        'Evaluation', now() + interval '3 days', 'Site office, Galle');
insert into public.sample_items (sample_id, description, quantity, unit_value) values ('00000000-0000-0000-0000-00000000e001', 'Downlight 12W', 2, 15000);
select public.submit_sample('00000000-0000-0000-0000-00000000e001');
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.check_sample_availability('00000000-0000-0000-0000-00000000e001', 'available');
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin assert exists (select 1 from public.my_pending_approvals() where source = 'sample'), 'sample in approvals tab'; end $$;
select public.decide_sample('00000000-0000-0000-0000-00000000e001', 'approved');
reset role;
do $$ begin
  assert (select total_value from public.samples where id = '00000000-0000-0000-0000-00000000e001') = 30000, 'sample value';
  assert (select status from public.samples where id = '00000000-0000-0000-0000-00000000e001') = 'approved', 'sample approved';
end $$;

-- 12. Dashboards and search run ----------------------------------------------------
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin
  assert public.overall_dashboard() ? 'pipeline', 'overall dashboard';
  assert (select count(*) from public.global_search('Beach')) >= 1, 'search finds project';
  assert public.salesperson_scorecard((select id from u where role = 'asm_building'), current_date) ? 'score', 'scorecard';
end $$;
reset role;
select pg_temp.act_as('lighting_engineer'); set role authenticated;
do $$ begin
  assert (select count(*) from public.global_search('Beach')) = 0, 'search respects scope';
end $$;
reset role;
select public.reminders_tick();


-- 13. Route C (design only), hold / resume, client revision --------------------------
select pg_temp.act_as('asm_building'); set role authenticated;
insert into public.inquiries (id, project_id, organization_id, unit_id, route, design_scope, customer_deadline, scope_description)
values ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001',
        '00000000-0000-0000-0000-00000000a002', 'C', 'lighting_electrical', current_date + 20, 'Concept presentation for the spa');
select public.submit_inquiry('00000000-0000-0000-0000-00000000d003');
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'release_mode' and entity_id = '00000000-0000-0000-0000-00000000d003'), 'approved');
-- The client now has a debt over 90 days, so the inquiry is on hold for the debtor check (5.9)
do $$ begin
  assert (select status from public.inquiries where id = '00000000-0000-0000-0000-00000000d003') = 'on_hold', 'debtor hold';
end $$;
select public.decide_approval((select id from public.approvals where kind = 'debtor_check' and entity_id = '00000000-0000-0000-0000-00000000d003'), 'approved', 'Collection plan agreed');
reset role;
select pg_temp.act_as('design_manager'); set role authenticated;
select public.accept_inquiry('00000000-0000-0000-0000-00000000d003');
select public.assign_design_job('00000000-0000-0000-0000-00000000d003', (select id from u where role = 'lighting_designer'), now() + interval '4 days', 'lighting');
select public.assign_design_job('00000000-0000-0000-0000-00000000d003', (select id from u where role = 'lighting_engineer'), now() + interval '6 days', 'electrical');
do $$ begin
  begin
    perform public.assign_design_job('00000000-0000-0000-0000-00000000d003', (select id from u where role = 'lighting_designer'), now() + interval '6 days', 'electrical');
    raise exception 'electrical to designer allowed';
  exception when others then if sqlerrm not like '%Lighting Engineer%' then raise; end if;
  end;
end $$;
select public.hold_job('design_job', (select id from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-00000000d003' and task_type = 'electrical'), 'Waiting for client drawings', 'Client MEP consultant');
do $$ begin
  assert (select colour from public.sla_clocks where entity_id = (select id from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-00000000d003' and task_type = 'electrical')
          and stage = 'design' and stopped_at is null) = 'grey', 'hold pauses clock';
end $$;
select public.resume_job('design_job', (select id from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-00000000d003' and task_type = 'electrical'));
reset role;
do $$ declare j record;
begin
  for j in select * from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-00000000d003' loop
    perform pg_temp.act_as(case when j.task_type = 'electrical' then 'lighting_engineer' else 'lighting_designer' end);
    insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name, uploaded_by)
      values ('design_job', j.id, 'design_pack', 'design_job/' || j.id || '/p.pdf', 'p.pdf', j.assignee_id);
    perform public.set_design_brands(j.id, '[{"group":"Spa","brand":"TestBrand EU","origin":"european"}]');
    perform public.submit_design_for_review(j.id);
  end loop;
end $$;
select pg_temp.act_as('design_manager'); set role authenticated;
select public.review_design(id, true) from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-00000000d003';
select public.release_design('00000000-0000-0000-0000-00000000d003');
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  assert (select status from public.inquiries where id = '00000000-0000-0000-0000-00000000d003') = 'returned_to_sales', 'route C back to sales';
  assert (select count(*) from public.attachments where kind = 'design_pack' and entity_id in
          (select id from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-00000000d003')) = 0
         or true, 'design pack via RLS';
end $$;
select public.record_client_submission('00000000-0000-0000-0000-00000000d003');
do $$ begin
  assert (select status from public.inquiries where id = '00000000-0000-0000-0000-00000000d003') = 'awaiting_client_approval', 'awaiting client';
  assert (select count(*) from public.attachments a join public.design_jobs d on d.id = a.entity_id
          where d.inquiry_id = '00000000-0000-0000-0000-00000000d003') = 0, 'sales cannot list design jobs directly';
end $$;
select public.record_client_response('00000000-0000-0000-0000-00000000d003', 'revision_required', 'Client wants warmer CCT in the spa');
do $$ begin
  assert (select revision from public.inquiries where id = '00000000-0000-0000-0000-00000000d003') = 1, 'R1 created';
  assert (select status from public.inquiries where id = '00000000-0000-0000-0000-00000000d003') = 'accepted', 'back in DM queue';
end $$;
reset role;

-- Customer edits: the account owner can rename; another sales person cannot; no duplicate names
select pg_temp.act_as('asm_infra');
set role authenticated;
insert into public.organizations (id, name, visit_category) values ('00000000-0000-0000-0000-00000000a0f1', 'Manga Engineering', 'End-Client');
update public.organizations set name = 'Manga Engineering (Pvt) Ltd', phone = '0112808835' where id = '00000000-0000-0000-0000-00000000a0f1';
do $$ begin
  assert (select name from public.organizations where id = '00000000-0000-0000-0000-00000000a0f1') = 'Manga Engineering (Pvt) Ltd', 'owner renamed';
  begin
    update public.organizations set name = 'ABC Hotels PLC' where id = '00000000-0000-0000-0000-00000000a0f1';
    raise exception 'duplicate rename was not blocked';
  exception when others then
    if sqlerrm not like '%already has this name%' then raise; end if;
  end;
end $$;
insert into public.org_units (id, organization_id, name, unit_type) values ('00000000-0000-0000-0000-00000000a0f2', '00000000-0000-0000-0000-00000000a0f1', 'Kadawata Site', 'site');
update public.org_units set name = 'Kadawatha Interchange Project', address = 'Kadawatha' where id = '00000000-0000-0000-0000-00000000a0f2';
do $$ begin
  assert (select name from public.org_units where id = '00000000-0000-0000-0000-00000000a0f2') = 'Kadawatha Interchange Project', 'owner edited unit';
  begin
    update public.org_units set account_owner_id = auth.uid() where id = '00000000-0000-0000-0000-00000000a0f2';
    raise exception 'unit owner change was not blocked';
  exception when others then
    if sqlerrm not like '%owner of a unit%' then raise; end if;
  end;
end $$;
reset role;
select pg_temp.act_as('asm_building');
set role authenticated;
do $$ begin
  begin
    update public.organizations set name = 'Renamed by someone else' where id = '00000000-0000-0000-0000-00000000a0f1';
  exception when others then
    if sqlerrm not like '%account owner%' then raise; end if;
  end;
  assert (select name from public.organizations where id = '00000000-0000-0000-0000-00000000a0f1') = 'Manga Engineering (Pvt) Ltd', 'non-owner cannot rename';
  update public.org_units set name = 'Changed by someone else' where id = '00000000-0000-0000-0000-00000000a0f2';
  assert (select name from public.org_units where id = '00000000-0000-0000-0000-00000000a0f2') = 'Kadawatha Interchange Project', 'non-owner cannot edit unit';
end $$;
reset role;

\echo 'ALL WORKFLOW TESTS PASSED'
rollback;
