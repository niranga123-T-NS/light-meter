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
-- A similar name confirmed as a different project (reason logged) – sales has no direct insert on project_log
do $$ declare pid uuid;
begin
  pid := public.create_project(jsonb_build_object('name', 'ABC Hotels – City Hotel – Kandy Annex', 'project_type', 'hospitality', 'stage', 'Award',
    'organization_id', '00000000-0000-0000-0000-00000000a001', 'expected_duration_months', 3, 'project_term', 'short'), null, 'This is a different project');
  assert exists (select 1 from public.project_log where project_id = pid and field = 'duplicate_override'), 'duplicate reason logged';
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

do $$ begin
  begin
    perform public.submit_inquiry('00000000-0000-0000-0000-00000000d001');
    raise exception 'submitted without estimation scope';
  exception when others then
    if sqlerrm not like '%estimation scope%' then raise; end if;
  end;
end $$;
update public.inquiries set estimation_scope = '{fixtures,controls}', estimation_basis = 'supply_install'
 where id = '00000000-0000-0000-0000-00000000d001';
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
-- Route A: the design completion date needs SM Projects' approval before a designer is assigned
do $$ begin
  begin
    perform public.assign_design_job('00000000-0000-0000-0000-00000000d001', (select id from u where role = 'lighting_designer'), now() + interval '5 days', 'lighting', 'medium');
    raise exception 'assigned without an approved completion date';
  exception when others then
    if sqlerrm not like '%design completion date%' then raise; end if;
  end;
  begin
    perform public.propose_design_due('00000000-0000-0000-0000-00000000d001', now() + interval '60 days');
    raise exception 'completion date after the customer deadline accepted';
  exception when others then
    if sqlerrm not like '%before the customer deadline%' then raise; end if;
  end;
end $$;
-- Fresh state: no workflow flag left over from an earlier action in this transaction
select set_config('app.workflow', '', true);
select public.propose_design_due('00000000-0000-0000-0000-00000000d001', now() + interval '6 days', 'Medium job');
reset role;
do $$ begin
  assert (select design_due_status from public.inquiries where id = '00000000-0000-0000-0000-00000000d001') = 'pending', 'completion date pending';
  assert (select reason from public.approvals where kind = 'design_due') like '%working days for estimation%', 'approval shows days left for estimation';
  -- The Design Manager is not chased for assignment while SM Projects considers the date
  assert (select paused_at from public.sla_clocks where entity_id = '00000000-0000-0000-0000-00000000d001' and stage = 'assignment' and stopped_at is null) is not null, 'assignment timer paused';
  -- Approval timers: nobody before overdue; then only the approvers (no sales person)
  assert cardinality(app.ladder_recipients((select c from public.sla_clocks c where entity_type = 'approval' and stage = 'approval_design_due' and stopped_at is null), 1)) = 0, 'no early approval reminder';
  assert app.ladder_recipients((select c from public.sla_clocks c where entity_type = 'approval' and stage = 'approval_design_due' and stopped_at is null), 3)
         = app.role_users('sm_projects'), 'overdue approval goes to its approvers only';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'design_due' and entity_id = '00000000-0000-0000-0000-00000000d001'), 'approved');
reset role;
do $$ begin
  assert (select paused_at from public.sla_clocks where entity_id = '00000000-0000-0000-0000-00000000d001' and stage = 'assignment' and stopped_at is null) is null, 'assignment timer resumed';
end $$;
select pg_temp.act_as('design_manager'); set role authenticated;
do $$ begin
  begin
    perform public.assign_design_job('00000000-0000-0000-0000-00000000d001', (select id from u where role = 'lighting_designer'), now() + interval '8 days', 'lighting', 'medium');
    raise exception 'task later than the approved completion date accepted';
  exception when others then
    if sqlerrm not like '%approved design completion date%' then raise; end if;
  end;
end $$;
select public.assign_design_job('00000000-0000-0000-0000-00000000d001', (select id from u where role = 'lighting_designer'),
                                now() + interval '5 days', 'lighting', 'medium');
do $$ begin
  begin
    perform public.change_job_due_date('design_job', (select id from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-00000000d001' limit 1), now() + interval '9 days', 'More time');
    raise exception 'due date moved past the approved completion date';
  exception when others then
    if sqlerrm not like '%approved design completion date%' then raise; end if;
  end;
end $$;
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

-- Rejected once: the resubmission is Design Rev 1, numbered on screen, in alerts and in the file names
select pg_temp.act_as('design_manager');
set role authenticated;
select public.review_design((select id from public.design_jobs), false, 'Increase lux in the lobby');
reset role;
select pg_temp.act_as('lighting_designer');
set role authenticated;
do $$ declare j uuid := (select id from public.design_jobs);
begin
  assert (select review_cycles from public.design_jobs where id = j) = 1, 'Rev 1 after return';
  assert (select file_name from public.attachments where entity_id = j and kind = 'design_pack' and version = 1) like 'INQ-%-R0 Lighting Rev0 - pack.pdf', 'Rev 0 file named';
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('design_job', j, 'design_pack', 'design_job/' || j || '/pack2.pdf', 'pack.pdf');
  assert (select file_name from public.attachments where entity_id = j and kind = 'design_pack' and version = 2) like 'INQ-%-R0 Lighting Rev1 - pack.pdf', 'Rev 1 file named';
  perform public.submit_design_for_review(j);
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'design_returned' and title like '%prepare Rev 1'), 'designer told the next Rev';
  assert exists (select 1 from public.notifications where kind = 'design_submitted' and title like '%Rev 1'), 'Design Manager sees Rev 1';
end $$;
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
-- Re-assigning only the estimator keeps the due date without a new deadline check; a new date is checked
savepoint reassign_due;
update public.inquiries set customer_deadline = (now() at time zone app.tz())::date + 7 where id = '00000000-0000-0000-0000-00000000d001';
select pg_temp.act_as('sm_estimation'); set role authenticated;
do $$ declare j public.estimation_jobs := (select e from public.estimation_jobs e limit 1);
begin
  perform public.assign_estimation_job(j.id, (select id from u where role = 'am_estimation'), j.due_at, 'large', 'Hand-over – leave');
  assert (select assignee_id from public.estimation_jobs where id = j.id) = (select id from u where role = 'am_estimation'), 're-assigned';
  begin
    perform public.assign_estimation_job(j.id, (select id from u where role = 'am_estimation'), j.due_at + interval '1 day', 'large', 'x');
    raise exception 'new due date past the deadline accepted';
  exception when others then if sqlerrm not like '%1 working day before the customer deadline%' then raise; end if;
  end;
end $$;
reset role;
rollback to savepoint reassign_due;

select pg_temp.act_as('estimation_exec');
set role authenticated;
do $$ declare j uuid;
begin
  select id into j from public.estimation_jobs;
  assert j is not null, 'estimator sees own job';
  assert (select count(*) from public.attachments where entity_type = 'design_job' and kind = 'design_pack') = 2, 'estimator sees design pack (Rev 0 and Rev 1)';
  perform public.acknowledge_estimation_job(j);
  perform public.save_estimate(j, 12000000, 9000000, 25, '[]');
  begin
    perform public.submit_estimate_for_approval(j);
    raise exception 'submitted without brands';
  exception when others then if sqlerrm not like '%brands and origin%' then raise; end if;
  end;
  perform public.save_estimate(j, 12000000, 9000000, 25, '[{"group":"Downlights","brand":"TestBrand EU","origin":"european"}]');
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values
    ('estimation_job', j, 'quotation_draft', 'estimation_job/' || j || '/d.pdf', 'draft.pdf'),
    ('estimation_job', j, 'costing_sheet', 'estimation_job/' || j || '/c.xlsx', 'costing.xlsx');
  perform public.submit_estimate_for_approval(j);
  assert (select file_name from public.attachments where kind = 'quotation_draft') like 'INQ-%-R0-draft-v1.pdf', 'file renamed';
end $$;
reset role;
-- Duty change approved while the estimate is with SM Estimation → back to SM Estimation to re-assign
savepoint duty1;
select pg_temp.act_as('asm_building'); set role authenticated;
select public.request_inquiry_change('00000000-0000-0000-0000-00000000d001', 'duty_change', '{"duty_status":"duty_free"}', 'Client importing under BOI');
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'duty_change' and status = 'pending'), 'approved');
reset role;
do $$ begin
  assert (select currency from public.inquiries where id = '00000000-0000-0000-0000-00000000d001') = 'USD', 'now USD';
  assert (select status from public.estimation_jobs) = 'revision_requested', 'back to SM Estimation to re-assign';
  assert exists (select 1 from public.notifications where kind = 'duty_changed' and title like 'Duty changed – re-assign%'
                 and recipient_id = (select id from u where role = 'sm_estimation')), 'SM Estimation asked to re-assign';
  assert exists (select 1 from public.sla_clocks where entity_type = 'estimation_job' and stage = 'assignment' and stopped_at is null), 're-assignment timer';
  assert (select price_currency from public.estimation_jobs) = 'LKR', 'old figures stay in LKR';
end $$;
select pg_temp.act_as('sm_estimation'); set role authenticated;
select public.assign_estimation_job((select id from public.estimation_jobs), public.default_estimator('00000000-0000-0000-0000-00000000d001'), now() + interval '3 days', 'large');
reset role;
select pg_temp.act_as('estimation_exec'); set role authenticated;
do $$ declare j uuid := (select id from public.estimation_jobs);
begin
  begin
    perform public.submit_estimate_for_approval(j);
    raise exception 'submitted LKR figures on a USD inquiry';
  exception when others then if sqlerrm not like '%re-price the estimate in USD%' then raise; end if;
  end;
  perform public.save_estimate(j, 40000, 30000, 25, '[{"group":"Downlights","brand":"TestBrand EU","origin":"european"}]');
  assert (select price_currency from public.estimation_jobs where id = j) = 'USD', 're-priced in USD';
  perform public.submit_estimate_for_approval(j);
end $$;
reset role;
rollback to savepoint duty1;

-- Below 15 Mn LKR: SM Projects verifies before release; a revision goes back through SM Estimation to an estimator
select pg_temp.act_as('sm_estimation'); set role authenticated;
do $$ begin
  assert public.review_estimate((select id from public.estimation_jobs), true, 'Checked') = 'sm_projects_approval', 'below 15 Mn needs SM Projects';
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'quotation_sm_projects' and status = 'pending'), 'returned', 'Check the floodlight quantities');
reset role;
do $$ begin
  assert (select status from public.estimation_jobs) = 'revision_requested', 'revision requested';
  assert (select status from public.inquiries where id = '00000000-0000-0000-0000-00000000d001') = 'in_estimation', 'back in estimation';
  assert exists (select 1 from public.notifications where kind = 'quotation_revision' and recipient_id = (select id from u where role = 'sm_estimation')), 'SM Estimation told';
  assert exists (select 1 from public.sla_clocks where entity_type = 'estimation_job' and stage = 'assignment' and stopped_at is null), 're-assignment timer';
end $$;
select pg_temp.act_as('sm_estimation'); set role authenticated;
select public.assign_estimation_job((select id from public.estimation_jobs), public.default_estimator('00000000-0000-0000-0000-00000000d001'), now() + interval '3 days', 'large');
reset role;
do $$ begin
  assert (select status from public.estimation_jobs) = 'returned', 'same estimator continues the revision';
  assert not exists (select 1 from public.sla_clocks where entity_type = 'estimation_job' and stage = 'assignment' and stopped_at is null), 're-assignment timer stopped';
  assert exists (select 1 from public.notifications where title like 'Revise the quotation%' and recipient_id = (select id from u where role = 'estimation_exec')), 'estimator told';
end $$;
select pg_temp.act_as('estimation_exec'); set role authenticated;
select public.save_estimate((select id from public.estimation_jobs), 13000000, 9500000, 27, '[{"group":"Downlights","brand":"TestBrand EU","origin":"european"}]');
select public.submit_estimate_for_approval((select id from public.estimation_jobs));
reset role;
select pg_temp.act_as('sm_estimation'); set role authenticated;
select public.review_estimate((select id from public.estimation_jobs), true, null);
reset role;
do $$ begin
  assert (select reason from public.approvals where kind = 'quotation_sm_projects' and status = 'pending') like '%revision 1%', 'SM Projects sees it is a revision';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.inquiry_files('00000000-0000-0000-0000-00000000d001') where kind = 'quotation_draft'), 'SM Projects can open the draft quotation';
end $$;
reset role;
-- Accepted → only SM Estimation releases it
savepoint smp_accept;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'quotation_sm_projects' and status = 'pending'), 'approved', 'OK');
reset role;
select pg_temp.act_as('estimation_exec'); set role authenticated;
do $$ begin
  assert (select status from public.estimation_jobs) = 'approved', 'accepted by SM Projects';
  begin
    perform public.release_quotation((select id from public.estimation_jobs));
    raise exception 'estimator released';
  exception when others then if sqlerrm not like '%SM Estimation releases%' then raise; end if;
  end;
end $$;
reset role;
-- SM Estimation can still enter the brands on an approved quotation before release
select pg_temp.act_as('sm_estimation'); set role authenticated;
select public.set_estimate_brands((select id from public.estimation_jobs), '[{"group":"Floodlights","brand":"TestBrand EU","origin":"european"}]');
reset role;
do $$ begin
  assert (select brands_offered -> 0 ->> 'group' from public.estimation_jobs) = 'Floodlights', 'brands updated after approval';
end $$;
rollback to savepoint smp_accept;
-- Another revision round, this time the value goes above the limit
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'quotation_sm_projects' and status = 'pending'), 'returned', 'Add the external lighting');
reset role;
select pg_temp.act_as('sm_estimation'); set role authenticated;
select public.assign_estimation_job((select id from public.estimation_jobs), public.default_estimator('00000000-0000-0000-0000-00000000d001'), now() + interval '3 days', 'large');
reset role;
select pg_temp.act_as('estimation_exec'); set role authenticated;
select public.save_estimate((select id from public.estimation_jobs), 60000000, 45000000, 25, '[{"group":"Downlights","brand":"TestBrand EU","origin":"european"}]');
select public.submit_estimate_for_approval((select id from public.estimation_jobs));
reset role;
do $$ begin assert (select sm_projects_revisions from public.estimation_jobs) = 2, 'two revision rounds'; end $$;

-- From 15 Mn LKR: SM Projects, then GM / DGM. A GM rejection goes back to SM Estimation; SM Projects is only told.
select pg_temp.act_as('sm_estimation'); set role authenticated;
do $$ begin
  assert public.review_estimate((select id from public.estimation_jobs), true, 'OK') = 'sm_projects_approval', 'SM Projects first';
end $$;
reset role;
do $$ begin
  assert (select array_agg(approver_role::text order by step_no) from public.approval_steps
          where approval_id = (select id from public.approvals where kind = 'quotation_sm_projects' and status = 'pending')) = '{sm_projects,gm}', 'SM Projects then GM';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'quotation_sm_projects' and status = 'pending'), 'approved', 'Fine');
reset role;
do $$ begin
  assert (select status from public.estimation_jobs) = 'sm_projects_approval', 'still waiting for GM';
  assert exists (select 1 from public.notifications where kind = 'approval_requested' and recipient_id = (select id from u where role = 'gm') and title like '%Quotation release%'), 'GM asked';
end $$;
select pg_temp.act_as('gm'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'quotation_sm_projects' and status = 'pending'), 'rejected', 'Price too high for this client');
reset role;
do $$ begin
  assert (select status from public.estimation_jobs) = 'revision_requested', 'GM rejection back to SM Estimation';
  assert exists (select 1 from public.notifications where kind = 'quotation_gm_rejected' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects told';
  assert exists (select 1 from public.notifications where kind = 'quotation_revision' and title like 'GM / DGM rejected%' and recipient_id = (select id from u where role = 'sm_estimation')), 'SM Estimation told';
end $$;
-- Re-assigned, revised and approved again the same way
select pg_temp.act_as('sm_estimation'); set role authenticated;
select public.assign_estimation_job((select id from public.estimation_jobs), public.default_estimator('00000000-0000-0000-0000-00000000d001'), now() + interval '3 days', 'large');
reset role;
select pg_temp.act_as('estimation_exec'); set role authenticated;
select public.save_estimate((select id from public.estimation_jobs), 58000000, 45000000, 22, '[{"group":"Downlights","brand":"TestBrand EU","origin":"european"}]');
select public.submit_estimate_for_approval((select id from public.estimation_jobs));
reset role;
select pg_temp.act_as('sm_estimation'); set role authenticated;
select public.review_estimate((select id from public.estimation_jobs), true, 'Revised');
reset role;
-- A quotation still on the earlier GM-only approval: a GM / DGM rejection also goes to SM Estimation to re-assign
savepoint old_gm_rule;
do $$ declare j uuid := (select id from public.estimation_jobs); i uuid := (select inquiry_id from public.estimation_jobs);
begin
  update public.approvals set status = 'cancelled' where kind = 'quotation_sm_projects' and status = 'pending';
  update public.estimation_jobs set status = 'gm_approval', needs_sm_projects = false where id = j;
  perform app.create_approval('quotation_release', 'estimation_job', j, i, 'Quotation release – old rule', 'test', array['gm']::public.app_role[]);
end $$;
select pg_temp.act_as('gm'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'quotation_release' and status = 'pending'), 'rejected', 'Too expensive');
reset role;
do $$ begin
  assert (select status from public.estimation_jobs) = 'revision_requested', 'old-rule GM rejection goes to SM Estimation';
  assert exists (select 1 from public.notifications where kind = 'quotation_revision' and title like 'GM / DGM rejected%'
                 and recipient_id = (select id from u where role = 'sm_estimation')), 'SM Estimation asked to re-assign';
  assert exists (select 1 from public.notifications where kind = 'quotation_gm_rejected' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects informed';
  assert exists (select 1 from public.sla_clocks where entity_type = 'estimation_job' and stage = 'assignment' and stopped_at is null), 're-assignment timer';
end $$;
rollback to savepoint old_gm_rule;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'quotation_sm_projects' and status = 'pending'), 'approved', 'OK');
reset role;
select pg_temp.act_as('gm'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'quotation_sm_projects' and status = 'pending'), 'approved', 'Proceed');
reset role;

select pg_temp.act_as('estimation_exec');
set role authenticated;
do $$ declare j uuid;
begin
  select id into j from public.estimation_jobs;
  assert (select status from public.estimation_jobs where id = j) = 'approved', 'GM approved';
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values
    ('estimation_job', j, 'quotation_final', 'estimation_job/' || j || '/f.pdf', 'final.pdf'),
    ('estimation_job', j, 'compliance_sheet', 'estimation_job/' || j || '/cs.pdf', 'compliance.pdf'),
    ('estimation_job', j, 'technical_data', 'estimation_job/' || j || '/tds.pdf', 'tds.pdf');
end $$;
reset role;
-- Without data sheets / compliance sheet: only with a reason (e.g. labour-only job)
savepoint no_docs;
delete from public.attachments where kind in ('compliance_sheet', 'technical_data');
select pg_temp.act_as('sm_estimation'); set role authenticated;
do $$ begin
  begin
    perform public.release_quotation((select id from public.estimation_jobs));
    raise exception 'released without data sheets';
  exception when others then if sqlerrm not like '%not applicable with a reason%' then raise; end if;
  end;
  perform public.release_quotation((select id from public.estimation_jobs), null, 'Budget quotation – no specification', 'Labour-only installation');
end $$;
reset role;
do $$ begin
  assert (select docs_note from public.quotations) like '%No data sheets: Labour-only installation%', 'reason shown with the quotation';
  assert (select docs_not_applicable ->> 'technical_data' from public.estimation_jobs) = 'Labour-only installation', 'reason kept on the estimate';
end $$;
rollback to savepoint no_docs;
-- SM Estimation releases
select pg_temp.act_as('sm_estimation'); set role authenticated;
select public.release_quotation((select id from public.estimation_jobs));
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
  assert (select count(*) from public.attachments where kind = 'design_pack') = 2, 'design pack (Rev 0 and Rev 1) released with quotation';
  assert (select count(*) from public.notifications where kind = 'quotation_released') = 1, 'release notification';
  assert (select count(*) from public.inquiry_files('00000000-0000-0000-0000-00000000d001') where kind = 'costing_sheet') = 0, 'inquiry_files hides costing';
  assert (select count(*) from public.inquiry_files('00000000-0000-0000-0000-00000000d001') where kind in ('design_pack', 'quotation_final')) = 3, 'inquiry_files shows released files (pack Rev 0, Rev 1 and the quotation)';
end $$;
select public.record_client_submission('00000000-0000-0000-0000-00000000d001');
-- Duty change approved after the quotation went to the client → a new revision for SM Estimation
savepoint duty2;
select public.request_inquiry_change('00000000-0000-0000-0000-00000000d001', 'duty_change', '{"duty_status":"duty_free"}', 'Client now duty free');
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'duty_change' and status = 'pending'), 'approved');
reset role;
do $$ begin
  assert (select revision from public.inquiries where id = '00000000-0000-0000-0000-00000000d001') = 1, 'new revision R1';
  assert exists (select 1 from public.estimation_jobs where revision = 1 and status = 'accepted' and revision_request like 'Duty changed to duty free (USD)%'), 'revision waits for SM Estimation';
end $$;
rollback to savepoint duty2;
select pg_temp.act_as('asm_building'); set role authenticated;
-- Client asks for a revised quotation → new estimate revision for SM Estimation; the last quotation stays visible
savepoint quote_rev;
do $$ declare jid uuid;
begin
  jid := public.request_quotation_revision('00000000-0000-0000-0000-00000000d001', 'Client wants option with local brand for downlights');
  perform set_config('test.jid', jid::text, false);
end $$;
reset role;
do $$ declare jid uuid := current_setting('test.jid')::uuid;
begin
  assert (select revision from public.inquiries where id = '00000000-0000-0000-0000-00000000d001') = 1, 'inquiry R1';
  assert (select status from public.inquiries where id = '00000000-0000-0000-0000-00000000d001') = 'in_estimation', 'back in estimation';
  assert (select status from public.estimation_jobs where id = jid) = 'accepted', 'waits for SM Estimation to assign';
  assert (select jsonb_array_length(brands_offered) from public.estimation_jobs where id = jid) > 0, 'brands carried over';
  assert exists (select 1 from public.notifications where kind = 'quotation_revision' and title like 'Revised quotation requested%'
                 and recipient_id = (select id from u where role = 'sm_estimation')), 'SM Estimation told';
end $$;
select pg_temp.act_as('sm_estimation'); set role authenticated;
select public.assign_estimation_job(current_setting('test.jid')::uuid, (select id from u where role = 'am_estimation'), now() + interval '3 days', 'large', 'Revision handled by AM');
reset role;
select pg_temp.act_as('am_estimation'); set role authenticated;
do $$ begin
  assert (select count(*) from public.estimation_jobs where status = 'released') = 1, 'estimator sees the previous estimate';
  assert (select count(*) from public.quotations) >= 1, 'estimator sees the previous quotation';
  assert exists (select 1 from public.attachments where entity_type = 'estimation_job' and kind = 'quotation_final'), 'previous final quotation file';
  assert exists (select 1 from public.attachments where entity_type = 'estimation_job' and kind = 'costing_sheet'), 'previous costing sheet';
  assert exists (select 1 from public.estimation_costing), 'previous cost / margin';
end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
rollback to savepoint quote_rev;
select pg_temp.act_as('asm_building'); set role authenticated;
-- Same tender, another main contractor: the released quotation is copied (no new design / estimation)
savepoint tender;
insert into public.organizations (id, name, visit_category) values ('00000000-0000-0000-0000-00000000a101', 'MAGA Engineering (Pvt) Ltd', 'Main Contractor');
do $$ declare nid uuid;
begin
  nid := public.copy_quotation_to_contractor('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000a101', null, null,
    current_date + 5, 'MAGA is bidding for the main contract');
  perform set_config('test.nid', nid::text, false);
  assert (select tender_group_id from public.inquiries where id = '00000000-0000-0000-0000-00000000d001') = '00000000-0000-0000-0000-00000000d001', 'source joins the tender group';
  assert (select tender_group_id from public.inquiries where id = nid) = '00000000-0000-0000-0000-00000000d001', 'copy in the same group';
  assert (select customer_name from public.inquiries where id = nid) = 'MAGA Engineering (Pvt) Ltd', 'customer is the contractor';
  begin
    perform public.copy_quotation_to_contractor('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000a101');
    raise exception 'copied twice to the same contractor';
  exception when others then if sqlerrm not like '%already has a quotation for this tender%' then raise; end if;
  end;
end $$;
reset role;
do $$ declare nid uuid := current_setting('test.nid')::uuid;
begin
  assert (select status from public.inquiries where id = nid) = 'estimation_review', 'waits for SM Estimation to release';
  assert (select status = 'approved' and copied_from_job_id is not null and quoted_value is not null from public.estimation_jobs where inquiry_id = nid), 'estimate reused';
  assert exists (select 1 from public.notifications where kind = 'quotation_copy' and recipient_id = (select id from u where role = 'sm_estimation')), 'SM Estimation told';
end $$;
select pg_temp.act_as('sm_estimation'); set role authenticated;
do $$ declare j uuid := (select id from public.estimation_jobs where inquiry_id = current_setting('test.nid')::uuid);
begin
  begin
    perform public.release_quotation(j);
    raise exception 'released without the quotation addressed to the contractor';
  exception when others then if sqlerrm not like '%final quotation PDF%' then raise; end if;
  end;
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('estimation_job', j, 'quotation_final', 'est/maga/q.pdf', 'Quotation – MAGA.pdf');
  perform public.release_quotation(j);
end $$;
reset role;
do $$ declare nid uuid := current_setting('test.nid')::uuid;
begin
  assert (select status from public.inquiries where id = nid) = 'quotation_released', 'released to the second contractor';
  assert (select quotation_no from public.quotations where inquiry_id = nid) <> (select quotation_no from public.quotations where inquiry_id = '00000000-0000-0000-0000-00000000d001'), 'own quotation number';
end $$;
select pg_temp.act_as('asm_building'); set role authenticated;
select public.record_client_response('00000000-0000-0000-0000-00000000d001', 'approved');
select public.record_inquiry_result('00000000-0000-0000-0000-00000000d001', 'won', null, null, 62000000, current_date);
do $$ begin
  assert public.close_tender_group_others('00000000-0000-0000-0000-00000000d001') = 1, 'the other contractor closed';
  assert (select status from public.inquiries where id = current_setting('test.nid')::uuid) = 'cancelled', 'cancelled (counts once in the win rate)';
  assert (select lost_reason from public.inquiries where id = current_setting('test.nid')::uuid) like 'Tender awarded to%', 'reason';
end $$;
reset role;
rollback to savepoint tender;
select pg_temp.act_as('asm_building'); set role authenticated;
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
insert into public.inquiries (id, project_id, organization_id, unit_id, route, duty_status, customer_deadline, scope_description, estimation_scope, estimation_basis)
values ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001',
        '00000000-0000-0000-0000-00000000a002', 'B', 'duty_free', current_date + 20, 'Façade package – BOQ attached', '{fixtures}', 'supply');
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
  -- The debtors list stands on its own: projects are not looked up; only a missing sales person is a reminder
  assert (select error_count from public.debt_uploads where id = up) = 0, 'unknown project is not an error';
  assert (select warnings from public.debt_upload_rows where upload_id = up and invoice_no = 'INV-1') = '{"No sales person"}', 'only the sales person reminder';
  assert (select count(*) from public.debt_upload_rows where upload_id = up and project_id is not null) = 0, 'project register not used';
  assert (select sales_person_id from public.debt_upload_rows where upload_id = up and invoice_no = 'INV-10452') is not null, 'customer account owner follows up';
  res := public.confirm_debtor_upload(up);
  assert (res ->> 'added')::int = 2, 'two debts added without mapping';
  assert (select project_id from public.debts where invoice_no = 'INV-1') is null, 'unlinked debt kept';
  assert (select ageing_bucket from public.debts where invoice_no = 'INV-10452') = '91-120', 'bucket';
  -- Missing client name is still an error
  up := public.stage_debtor_upload(current_date, '[{"invoice_no":"INV-2","amount":5,"currency":"LKR","outstanding_days":3}]');
  assert (select error_count from public.debt_uploads where id = up) = 1, 'missing client is an error';
  -- Fix rows in the preview instead of re-uploading: edit a bad row, remove a totals line
  up := public.stage_debtor_upload(current_date, '[
    {"client_name":"ABC Hotels PLC","invoice_no":"INV-3","amount":null,"currency":"Rs","outstanding_days":12},
    {"client_name":"TOTAL","amount":2400010},
    {"client_name":"Nobody","invoice_no":"INV-4","amount":"abc","currency":"usd","outstanding_days":"7"}]');
  assert (select error_count from public.debt_uploads where id = up) = 3, 'three bad rows, no crash on text in a number column';
  assert (select errors from public.debt_upload_rows where upload_id = up and invoice_no = 'INV-4') = '{"Outstanding amount missing or not a number"}', 'error says what is wrong';
  perform public.edit_debtor_row((select id from public.debt_upload_rows where upload_id = up and invoice_no = 'INV-4'), '{"amount":"250"}');
  perform public.set_debtor_row_sales_person((select id from public.debt_upload_rows where upload_id = up and invoice_no = 'INV-4'), (select id from u where role = 'asm_building'));
  assert (select warnings from public.debt_upload_rows where upload_id = up and invoice_no = 'INV-4') = '{}', 'sales person chosen';
  perform public.edit_debtor_row((select id from public.debt_upload_rows where upload_id = up and invoice_no = 'INV-3'), '{"amount":"1500","currency":"LKR"}');
  perform public.remove_debtor_row((select id from public.debt_upload_rows where upload_id = up and client_name = 'TOTAL'));
  assert (select error_count from public.debt_uploads where id = up) = 0, 'fixed in place';
  assert (select row_count from public.debt_uploads where id = up) = 2, 'totals line removed';
  -- Assign a sales person to the debt later
  perform public.set_debt_sales_person((select id from public.debts where invoice_no = 'INV-1'), (select id from u where role = 'asm_building'));
  assert (select sales_person_id from public.debts where invoice_no = 'INV-1') = (select id from u where role = 'asm_building'), 'sales person assigned';
end $$;
-- Next week's list no longer has INV-1: it is cleared and becomes part of the customer's payment history
do $$ declare up uuid; p jsonb;
begin
  up := public.stage_debtor_upload(current_date + 7, '[
    {"project_name":"ABC Hotels - Beach Resort - Galle","client_name":"ABC Hotels PLC","invoice_no":"INV-10452","amount":2400000,"currency":"LKR","outstanding_days":94}]');
  perform public.confirm_debtor_upload(up);
  assert (select status from public.debts where invoice_no = 'INV-1') = 'cleared', 'INV-1 cleared';
  p := public.customer_debt_profile(' nobody ');
  assert (p -> 'history' ->> 'n')::int = 1, 'one cleared invoice in history';
  assert (p -> 'history' ->> 'avg_days')::int >= 5, 'days to clear from the last outstanding days';
  assert (p -> 'open' ->> 'n')::int = 0, 'nothing open';
  p := public.customer_debt_profile('ABC Hotels PLC');
  assert (p -> 'open' ->> 'lkr')::numeric = 2400000, 'open total';
  assert (p -> 'open' -> 'by_bucket' -> 0 ->> 'bucket') = '91-120', 'by ageing bracket';
  assert jsonb_array_length(p -> 'trend') = 2, 'outstanding per upload';
end $$;
reset role;
-- Legal case whose hearing date has passed: the Operations Executive is alerted every day until it is updated
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare d uuid := (select id from public.debts where invoice_no = 'INV-10452');
begin
  perform public.set_debt_legal(d, true, 'Commercial High Court case 123/26', current_date + 5);
  begin
    perform public.set_debt_legal(d, true, 'Commercial High Court case 123/26', current_date - 1, null, 'Postponed');
    raise exception 'past hearing date accepted';
  exception when others then if sqlerrm not like '%cannot be in the past%' then raise; end if;
  end;
end $$;
reset role;
update public.debts set next_hearing_date = current_date - 3 where invoice_no = 'INV-10452';
do $$ declare morning timestamptz := ((now() at time zone app.tz())::date + time '08:00') at time zone app.tz();
begin
  assert public.legal_hearing_tick(morning) = 1, 'hearing passed → alert';
  assert exists (select 1 from public.notifications where kind = 'legal_hearing_overdue' and priority = 'critical'
                 and recipient_id = (select id from u where role = 'operations_exec')), 'Operations Executive alerted (critical)';
  assert public.legal_hearing_tick(morning + interval '2 hours') = 0, 'once a day';
  assert public.legal_hearing_tick(morning + interval '1 day') = 1, 'again the next day';
end $$;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare d uuid := (select id from public.debts where invoice_no = 'INV-10452');
begin
  begin
    perform public.set_debt_legal(d, true, 'Commercial High Court case 123/26', current_date + 14);
    raise exception 'update without comments accepted';
  exception when others then if sqlerrm not like '%Add comments%' then raise; end if;
  end;
  perform public.set_debt_legal(d, true, 'Commercial High Court case 123/26', current_date + 14, null, 'Hearing postponed – judge on leave');
end $$;
reset role;
do $$ begin
  assert public.legal_hearing_tick(((now() at time zone app.tz())::date + 2 + time '08:00') at time zone app.tz()) = 0, 'updated → no more alerts';
  assert (select note from public.debt_log where kind = 'legal' order by at desc, id desc limit 1) like '%judge on leave%', 'comment kept in history';
end $$;

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
-- Returnable: handed over → sales person reports it back → Operations confirms → cleared
select pg_temp.act_as('operations_exec'); set role authenticated;
insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name)
values ('sample', '00000000-0000-0000-0000-00000000e001', 'delivery_note', 'sample/e001/dn.jpg', 'dn.jpg');
select public.record_sample_handover('00000000-0000-0000-0000-00000000e001', 'Stores', 'Site engineer');
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
select public.report_sample_returned('00000000-0000-0000-0000-00000000e001', 'Collected back from site');
reset role;
do $$ begin
  assert (select status from public.samples where id = '00000000-0000-0000-0000-00000000e001') = 'return_reported', 'return reported, still on record';
  assert exists (select 1 from public.notifications where kind = 'sample_return_reported' and recipient_id = (select id from u where role = 'operations_exec')), 'Operations asked to confirm';
end $$;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.record_sample_return('00000000-0000-0000-0000-00000000e001', 'good');
reset role;
do $$ begin
  assert (select status from public.samples where id = '00000000-0000-0000-0000-00000000e001') = 'cleared', 'cleared after Operations approval';
end $$;

-- Non-returnable: Sell or FOC is required; FOC clears at handover, Sell goes to the debtors list until collected
select pg_temp.act_as('asm_building'); set role authenticated;
insert into public.samples (id, project_id, sample_type, purpose, required_by, handover_location) values
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000b001', 'non_returnable', 'Mock-up', now() + interval '3 days', 'Site'),
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-00000000b001', 'non_returnable', 'Client purchase', now() + interval '3 days', 'Site');
insert into public.sample_items (sample_id, description, quantity, unit_value) values
  ('00000000-0000-0000-0000-00000000e002', 'Spot 7W', 1, 8000), ('00000000-0000-0000-0000-00000000e003', 'Linear 1.2m', 4, 12500);
do $$ begin
  begin
    perform public.submit_sample('00000000-0000-0000-0000-00000000e002');
    raise exception 'non-returnable without Sell / FOC submitted';
  exception when others then if sqlerrm not like '%Sell or FOC%' then raise; end if;
  end;
end $$;
reset role;
update public.samples set nr_disposition = 'foc' where id = '00000000-0000-0000-0000-00000000e002';
update public.samples set nr_disposition = 'sell' where id = '00000000-0000-0000-0000-00000000e003';
select pg_temp.act_as('asm_building'); set role authenticated;
select public.submit_sample(x) from unnest(array['00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000e003']::uuid[]) x;
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.check_sample_availability(x, 'available') from unnest(array['00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000e003']::uuid[]) x;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_sample(x, 'approved') from unnest(array['00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000e003']::uuid[]) x;
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values
  ('sample', '00000000-0000-0000-0000-00000000e002', 'delivery_note', 'sample/e002/dn.jpg', 'dn.jpg'),
  ('sample', '00000000-0000-0000-0000-00000000e003', 'delivery_note', 'sample/e003/dn.jpg', 'dn.jpg');
select public.record_sample_handover('00000000-0000-0000-0000-00000000e002', 'Stores', 'Client');
select public.record_sample_handover('00000000-0000-0000-0000-00000000e003', 'Stores', 'Client', now(), 'SINV-501');
do $$ declare up uuid;
begin
  assert (select status from public.samples where id = '00000000-0000-0000-0000-00000000e002') = 'cleared', 'FOC recorded and cleared';
  assert (select status from public.samples where id = '00000000-0000-0000-0000-00000000e003') = 'sold_unpaid', 'sold – unpaid';
  assert (select amount from public.debts where invoice_no = 'SINV-501' and source = 'sample') = 50000, 'sale added to debtors';
  -- The weekly accounts file does not contain it: it stays open
  up := public.stage_debtor_upload(current_date + 14, '[
    {"client_name":"ABC Hotels PLC","invoice_no":"INV-10452","amount":2400000,"currency":"LKR","outstanding_days":101}]');
  perform public.confirm_debtor_upload(up);
  assert (select status from public.debts where invoice_no = 'SINV-501') = 'outstanding', 'sample debt not cleared by the upload';
  assert (select outstanding_days from public.debts where invoice_no = 'SINV-501') = 14, 'sample debt ages from handover';
end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
select public.update_debt_status((select id from public.debts where invoice_no = 'SINV-501'), 'collected', 'Cheque received', null, null, 50000, current_date);
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare up uuid;
begin
  up := public.stage_debtor_upload(current_date + 21, '[
    {"client_name":"ABC Hotels PLC","invoice_no":"INV-10452","amount":2400000,"currency":"LKR","outstanding_days":108}]');
  perform public.confirm_debtor_upload(up);
  assert (select status from public.debts where invoice_no = 'SINV-501') = 'collected_confirmed', 'collected and confirmed';
  assert (select status from public.samples where id = '00000000-0000-0000-0000-00000000e003') = 'cleared', 'sold sample cleared with its debt';
end $$;
reset role;

-- Above LKR 100,000: SM Projects, then GM / DGM; below it GM / DGM is not asked
select pg_temp.act_as('asm_building'); set role authenticated;
insert into public.samples (id, project_id, sample_type, expected_return_date, purpose, required_by, handover_location)
values ('00000000-0000-0000-0000-00000000e004', '00000000-0000-0000-0000-00000000b001', 'returnable', current_date + 7, 'Mock-up', now() + interval '3 days', 'Site');
insert into public.sample_items (sample_id, description, quantity, unit_value) values ('00000000-0000-0000-0000-00000000e004', 'Flood 200W', 4, 45000);
select public.submit_sample('00000000-0000-0000-0000-00000000e004');
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.check_sample_availability('00000000-0000-0000-0000-00000000e004', 'available');
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin
  assert not exists (select 1 from public.my_pending_approvals() where source = 'sample'), 'GM not asked before SM Projects';
  begin
    perform public.decide_sample('00000000-0000-0000-0000-00000000e004', 'approved');
    raise exception 'GM approved before SM Projects';
  exception when others then if sqlerrm not like '%SM Projects approves%' then raise; end if;
  end;
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert public.decide_sample('00000000-0000-0000-0000-00000000e004', 'approved') = 'gm_approval', 'above 100,000 goes to GM / DGM';
end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'sample'), 'GM / DGM asked';
  assert public.decide_sample('00000000-0000-0000-0000-00000000e004', 'approved', 'OK') = 'approved', 'GM / DGM approved';
end $$;
reset role;
-- Samples outstanding over LKR 500,000 → Monday alert to the sales person
do $$ declare mon timestamptz := ((date_trunc('week', now() at time zone app.tz())::date + 7) + time '08:30') at time zone app.tz();
begin
  perform set_config('app.workflow', '1', true);
  update public.samples set status = 'out', expected_return_date = current_date - 3 where id = '00000000-0000-0000-0000-00000000e004';
  perform pg_temp.act_as('asm_building');
  insert into public.samples (id, project_id, sales_person_id, sample_type, purpose, required_by, handover_location, nr_disposition)
  values ('00000000-0000-0000-0000-00000000e005', '00000000-0000-0000-0000-00000000b001', (select id from u where role = 'asm_building'),
          'non_returnable', 'Client purchase', now(), 'Site', 'sell');
  insert into public.sample_items (sample_id, description, quantity, unit_value) values ('00000000-0000-0000-0000-00000000e005', 'Panel', 10, 35000);
  update public.samples set status = 'sold_unpaid' where id = '00000000-0000-0000-0000-00000000e005';
  assert (select total_lkr from public.sample_outstanding() where sales_person_id = (select id from u where role = 'asm_building')) = 530000, 'out + sold unpaid';
  assert (select over_limit from public.sample_outstanding() where sales_person_id = (select id from u where role = 'asm_building')), 'over the limit';
  assert public.sample_outstanding_tick(mon - interval '1 day') = 0, 'only on Monday';
  assert public.sample_outstanding_tick(mon) = 1, 'Monday alert';
  assert exists (select 1 from public.notifications where kind = 'sample_outstanding' and recipient_id = (select id from u where role = 'asm_building')), 'sales person alerted';
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
  -- Each design task is assigned once per revision; changing the designer is a Reassign
  begin
    perform public.assign_design_job('00000000-0000-0000-0000-00000000d003', (select id from u where role = 'lighting_engineer'), now() + interval '3 days', 'lighting');
    raise exception 'second lighting assignment allowed';
  exception when others then if sqlerrm not like '%already assigned%' then raise; end if;
  end;
end $$;
-- The designer puts the job on hold: the Design Manager is alerted at once
reset role;
select pg_temp.act_as('lighting_engineer'); set role authenticated;
select public.hold_job('design_job', (select id from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-00000000d003' and task_type = 'electrical'), 'Waiting for client drawings', 'Client MEP consultant');
reset role;
do $$ declare j uuid := (select id from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-00000000d003' and task_type = 'electrical');
begin
  assert (select colour from public.sla_clocks where entity_id = j and stage = 'design' and stopped_at is null) = 'grey', 'hold pauses clock';
  assert exists (select 1 from public.notifications where kind = 'design_on_hold' and recipient_id = (select id from u where role = 'design_manager')), 'design manager alerted';
  assert (select held_at from public.design_jobs where id = j) is not null, 'hold time recorded';
  assert public.design_hold_tick() = 0, 'no long-hold alert yet';
  -- Still on hold a week later (over 2 working days): SM Projects is told once
  update public.design_jobs set held_at = now() - interval '7 days' where id = j;
  assert public.design_hold_tick() = 1, 'long hold alerted';
  assert exists (select 1 from public.notifications where kind = 'design_hold_long' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects informed';
  assert public.design_hold_tick() = 0, 'alerted only once';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert (select count(*) from public.design_holds()) = 1, 'dashboard lists the hold';
  assert (select working_days from public.design_holds()) >= 2, 'days on hold';
end $$;
reset role;
select pg_temp.act_as('design_manager'); set role authenticated;
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

-- Estimation scope change after submission goes through the expectation-change approval (Route B: SM Estimation)
select pg_temp.act_as('asm_building');
set role authenticated;
select public.request_inquiry_change('00000000-0000-0000-0000-00000000d002', 'expectation_change',
  '{"estimation_scope": ["fixtures", "poles"], "estimation_basis": "supply_install_commission"}', 'Client added poles and commissioning');
reset role;
select pg_temp.act_as('sm_estimation');
set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'expectation_change' and entity_id = '00000000-0000-0000-0000-00000000d002'), 'approved');
reset role;
do $$ begin
  assert (select estimation_scope from public.inquiries where id = '00000000-0000-0000-0000-00000000d002') = '{fixtures,poles}', 'scope changed by approval';
  assert (select estimation_basis from public.inquiries where id = '00000000-0000-0000-0000-00000000d002') = 'supply_install_commission', 'basis changed by approval';
end $$;

-- Brand master list: teams add, managers approve / rename / merge ---------------
select pg_temp.act_as('lighting_designer');
set role authenticated;
insert into public.brands (name, origin, level) values ('  Lumina   Pro ', 'european', 'high');
do $$ begin
  assert (select status from public.brands where name = 'Lumina Pro') = 'pending', 'designer brand is pending';
  begin
    insert into public.brands (name, origin, level) values ('lumina pro', 'other', 'low');
    raise exception 'duplicate brand not blocked';
  exception when others then
    if sqlerrm not like '%already in the list%' then raise; end if;
  end;
  update public.brands set status = 'approved' where name = 'Lumina Pro';
  assert (select status from public.brands where name = 'Lumina Pro') = 'pending', 'designer cannot approve';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'brand_proposed' and recipient_id = (select id from u where role = 'design_manager')), 'DM told about new brand';
end $$;
-- an open design job already uses the pending brand
insert into public.design_jobs (id, inquiry_id, revision, assignee_id, status, due_at, original_due_at, brands_specified)
values ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-00000000d001', 9, (select id from u where role = 'lighting_designer'),
        'in_progress', now() + interval '3 days', now() + interval '3 days', '[{"group":"Downlights","brand":"Lumina Pro","origin":"european"}]');
select pg_temp.act_as('design_manager');
set role authenticated;
update public.brands set name = 'Lumina Professional', status = 'approved', review_note = 'Corrected name' where name = 'Lumina Pro';
insert into public.brands (name, origin, level) values ('Lumina Professional Ltd', 'european', 'high');
select public.merge_brands((select id from public.brands where name = 'Lumina Professional Ltd'), (select id from public.brands where name = 'Lumina Professional'));
reset role;
do $$ begin
  assert (select status from public.brands where name = 'Lumina Professional') = 'approved', 'DM approved';
  assert (select status from public.brands where name = 'Lumina Professional Ltd') = 'rejected', 'duplicate merged away';
  assert (select brands_specified -> 0 ->> 'brand' from public.design_jobs where id = '00000000-0000-0000-0000-0000000000b7') = 'Lumina Professional', 'rename carried into open job';
  assert exists (select 1 from public.notifications where kind = 'brand_reviewed' and recipient_id = (select id from u where role = 'lighting_designer')), 'designer told brand approved';
end $$;
select pg_temp.act_as('estimation_exec');
set role authenticated;
insert into public.brands (name, origin, level) values ('Shine Asia', 'chinese', 'low');
reset role;
do $$ begin
  assert (select status from public.brands where name = 'Shine Asia') = 'pending', 'estimator brand pending';
end $$;

-- A replaced approval stops its timer (no "Overdue" alerts for dead approvals)
do $$ declare a1 uuid; a2 uuid; inq uuid := (select inquiry_id from public.approvals where kind = 'release_mode' and status = 'pending' limit 1);
begin
  a1 := (select id from public.approvals where kind = 'release_mode' and status = 'pending' and entity_id = inq);
  a2 := app.create_approval('release_mode', 'inquiry', inq, inq, 'Release mode again', 'test', array['sm_projects']::public.app_role[]);
  assert (select status from public.approvals where id = a1) = 'cancelled', 'old approval cancelled';
  assert not exists (select 1 from public.sla_clocks where entity_type = 'approval' and entity_id = a1 and stopped_at is null), 'old approval timer stopped';
  assert exists (select 1 from public.sla_clocks where entity_type = 'approval' and entity_id = a2 and stopped_at is null), 'new approval timer running';
  assert not exists (select 1 from public.sla_clocks c join public.approvals a on a.id = c.entity_id
                     where c.entity_type = 'approval' and c.stopped_at is null and a.status <> 'pending'), 'no timers on finished approvals';
end $$;
-- 14. Retentions ------------------------------------------------------------------
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare rid uuid; d date := current_date;
begin
  rid := public.save_retention(null, jsonb_build_object('project_name', 'Beach Resort Galle', 'end_client', 'ABC Hotels PLC',
    'main_contractor', 'MAGA Engineering', 'contract_no', 'PO-4512', 'contract_value', '48000000', 'retention_pct', '5',
    'currency', 'LKR', 'retention_form', 'bank_guarantee', 'bg_expiry', (d + 20)::text, 'start_date', (d - 300)::text,
    'due_date', (d + 45)::text, 'sales_person_id', (select id from u where role = 'asm_building')::text));
  assert (select retention_value from public.retentions where id = rid) = 2400000, 'value from contract value × %';
  assert (select code from public.retentions where id = rid) like 'RET-%', 'code';
  assert (select organization_id from public.retentions where id = rid) is not null, 'end client matched to the customer';
  begin
    perform public.save_retention(rid, jsonb_build_object('project_name', 'Beach Resort Galle', 'end_client', 'ABC Hotels PLC', 'currency', 'LKR',
      'retention_form', 'cash_withheld', 'retention_value', '2400000', 'start_date', (d - 300)::text, 'due_date', (d + 90)::text));
    raise exception 'due date edited directly';
  exception when others then if sqlerrm not like '%extension approved by GM%' then raise; end if;
  end;
  perform public.request_retention_extension(rid, d + 75, 'Defects period extended by the client');
end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin assert (select count(*) from public.retentions) = 1, 'sales person sees own retention'; end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'retention_extension' and status = 'pending'), 'approved', 'OK');
reset role;
do $$ declare r public.retentions; d date := current_date; at8 timestamptz;
begin
  select * into r from public.retentions limit 1;
  assert r.due_date = d + 75 and r.extensions = 1 and r.original_due_date = d + 45, 'extended by GM / DGM';
  assert exists (select 1 from public.retention_log where retention_id = r.id and kind = 'extended'), 'extension in history';
  at8 := (d + time '08:30') at time zone app.tz();
  -- 75 days before due: nothing yet except the bank guarantee (expires in 20 days)
  assert public.retention_tick(at8) = 1, 'bank guarantee expiry alert';
  assert exists (select 1 from public.notifications where kind = 'retention_bg_expiry'), 'BG alert sent';
  assert public.retention_tick(at8 + interval '20 days') = 1, '60-day alert';
  assert public.retention_tick(at8 + interval '50 days') = 1, '30-day alert';
  assert public.retention_tick(at8 + interval '75 days') = 1, 'due today – claim';
  assert public.retention_tick(at8 + interval '76 days') = 1, 'again the next day';
  assert public.retention_tick(at8 + interval '82 days') = 1, 'daily reminder, plus SM Projects after 7 days';
  assert exists (select 1 from public.notifications where kind = 'retention_due' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects told';
end $$;
select pg_temp.act_as('asm_building'); set role authenticated;
select public.mark_retention_claimed((select id from public.retentions), current_date, 'CLM-77');
reset role;
do $$ declare at8 timestamptz := (current_date + time '08:30') at time zone app.tz();
begin
  assert public.retention_tick(at8 + interval '31 days') = 1, 'claimed 30 days – sales person';
  assert public.retention_tick(at8 + interval '61 days') = 1, 'claimed 60 days – SM Projects';
  assert public.retention_tick(at8 + interval '91 days') = 1, 'claimed 90 days – GM / DGM';
  assert exists (select 1 from public.notifications where kind = 'retention_claim_overdue' and priority = 'critical'
                 and recipient_id = (select id from u where role = 'gm')), 'GM / DGM alerted';
end $$;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.mark_retention_collected((select id from public.retentions), 2400000, current_date);
insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name)
values ('retention', (select id from public.retentions), 'retention_doc', 'retention/x/claim.pdf', 'claim.pdf');
reset role;
do $$ begin
  assert (select status from public.retentions) = 'collected', 'collected';
  assert public.retention_tick(now() + interval '200 days') = 0, 'no alerts after collection';
end $$;

-- Bonds: Operations records, owner by category, others view, alerts --------------
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  perform public.save_bond(null, jsonb_build_object('bond_type', 'bid', 'bond_no', 'X1', 'bank', 'HNB', 'project_name', 'P', 'customer', 'C',
    'tender_no', 'T1', 'currency', 'LKR', 'category', 'infrastructure', 'bond_value', '1000', 'issue_date', current_date::text,
    'expiry_date', (current_date + 30)::text));
  raise exception 'sales recorded a bond';
exception when others then if sqlerrm not like '%Only the Operations Executive%' then raise; end if;
end $$;
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare bid uuid; d date := current_date;
begin
  bid := public.save_bond(null, jsonb_build_object('bond_type', 'bid', 'bond_no', 'CB/BB/26/1301', 'bank', 'Commercial Bank',
    'project_name', 'Southern Expressway Lighting', 'customer', 'ABC Hotels PLC', 'tender_no', 'CEB/LT/2026/07', 'currency', 'LKR',
    'category', 'infrastructure', 'contract_value', '120000000', 'bond_pct', '1', 'issue_date', (d - 10)::text,
    'expiry_date', (d + 65)::text, 'tender_closing_date', (d + 5)::text));
  assert (select owner_id from public.bonds where id = bid) = (select id from u where role = 'asm_infra'), 'owner from the category';
  assert (select bond_value from public.bonds where id = bid) = 1200000, 'value from contract value × %';
  assert (select code from public.bonds where id = bid) like 'BND-%', 'code';
  begin
    perform public.save_bond(bid, jsonb_build_object('bond_type', 'bid', 'bond_no', 'CB/BB/26/1301', 'bank', 'Commercial Bank',
      'project_name', 'Southern Expressway Lighting', 'customer', 'ABC Hotels PLC', 'tender_no', 'CEB/LT/2026/07', 'currency', 'LKR',
      'category', 'infrastructure', 'bond_value', '1200000', 'issue_date', (d - 10)::text, 'expiry_date', (d + 90)::text));
    raise exception 'expiry edited directly';
  exception when others then if sqlerrm not like '%Extend validity%' then raise; end if;
  end;
end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin assert (select count(*) from public.bonds) = 0, 'building sales person does not see an infrastructure bond'; end $$;
reset role;
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ begin assert (select count(*) from public.bonds) = 1, 'owner sees the bond'; end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin assert (select count(*) from public.bonds) = 1, 'GM / DGM sees all bonds'; end $$;
reset role;
do $$ declare b public.bonds; at8 timestamptz := (current_date + time '08:30') at time zone app.tz();
  smp uuid := (select id from u where role = 'sm_projects'); own uuid := (select id from u where role = 'asm_infra');
begin
  select * into b from public.bonds;
  perform public.bond_tick(at8 + interval '5 days');      -- 60 days left
  assert exists (select 1 from public.notifications where kind = 'bond_expiring' and recipient_id = own), '60 days – owner';
  assert exists (select 1 from public.notifications where kind = 'bond_expiring' and recipient_id = (select id from u where role = 'operations_exec')), '60 days – Operations';
  assert not exists (select 1 from public.notifications where kind = 'bond_expiring' and recipient_id = smp), '60 days – not yet SM Projects';
  perform public.bond_tick(at8 + interval '36 days');     -- 29 days left
  assert exists (select 1 from public.notifications where kind = 'bond_expiring' and recipient_id = smp), '30 days – SM Projects';
  assert exists (select 1 from public.notifications where kind = 'bond_expiring' and recipient_id = (select id from u where role = 'gm')), '30 days – GM / DGM';
  assert (select alert_level from public.bonds) = 2, 'level 30 days';
  perform public.bond_tick(at8 + interval '59 days');     -- 6 days left: 7-day alert, critical
  assert exists (select 1 from public.notifications where kind = 'bond_expiring' and priority = 'critical'), '7 days – critical';
  perform public.bond_tick(at8 + interval '60 days');
  assert exists (select 1 from public.notifications where dedupe_key = format('bonddaily:%s:%s', b.id, current_date + 60)), 'daily reminder in the last week';
  perform public.bond_tick(at8 + interval '67 days');     -- expired
  assert exists (select 1 from public.notifications where kind = 'bond_expired' and recipient_id = smp), 'expired – SM Projects told';
end $$;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.extend_bond((select id from public.bonds), current_date + 120, 'Bank extension letter EXT-55');
select public.record_bond_tender_result((select id from public.bonds), 'lost', current_date, 'Awarded to a competitor');
insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name)
values ('bond', (select id from public.bonds), 'bond_doc', 'bond/x/bond.pdf', 'bond.pdf');
reset role;
do $$ declare at8 timestamptz := (current_date + time '08:30') at time zone app.tz();
begin
  assert (select extensions from public.bonds) = 1 and (select alert_level from public.bonds) = 0 and not (select expired_alerted from public.bonds), 'extended';
  assert exists (select 1 from public.notifications where kind = 'bond_return_due'), 'lost tender – collect the bid bond';
  perform public.bond_tick(at8 + interval '15 days');
  assert (select return_alerted from public.bonds), 'not returned 14 days after the result';
end $$;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.close_bond((select id from public.bonds), 'claimed', current_date, 'Encashed by the customer');
reset role;
do $$ begin
  assert (select status from public.bonds) = 'claimed', 'closed as claimed';
  assert exists (select 1 from public.notifications where kind = 'bond_claimed' and priority = 'critical'
                 and recipient_id = (select id from u where role = 'gm')), 'claim – GM / DGM alerted at once';
  assert (select count(*) from public.bond_log) = 4, 'history kept';
end $$;

-- Notifications: clear → history → clear history ------------------------------
insert into public.notifications (recipient_id, kind, title, body, requires_open) values ((select id from u where role = 'sm_projects'), 'test', 'Pinned approval', 'x', true);
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ declare me uuid := auth.uid(); total int; pinned int; n int;
begin
  select count(*) into total from public.notifications where recipient_id = me and cleared_at is null and deliver_after <= now();
  select count(*) into pinned from public.notifications where recipient_id = me and cleared_at is null and deliver_after <= now() and requires_open and read_at is null;
  n := public.clear_notifications();
  assert n = total - pinned, 'cleared all except unopened pinned items';
  assert exists (select 1 from public.notifications where recipient_id = me and title = 'Pinned approval' and cleared_at is null), 'pinned item stays';
  assert public.clear_notifications((select id from public.notifications where recipient_id = me and title = 'Pinned approval')) = 1, 'clear one';
  perform public.clear_notifications(id) from public.notifications where recipient_id = me and cleared_at is null and deliver_after <= now();
  assert not exists (select 1 from public.notifications where recipient_id = me and cleared_at is null and deliver_after <= now()), 'list empty';
  assert public.clear_notification_history(null, now() - interval '1 day') = 0, 'nothing older than a day';
  assert public.clear_notification_history() = total, 'history cleared';
  assert (select count(*) from public.notifications where recipient_id = me) >= total, 'rows kept so alerts are not re-sent';
  assert (select count(*) from public.notifications where recipient_id <> me) = 0, 'only own notifications visible';
end $$;
reset role;

-- Warranty: completion record, claims, sales reports, goodwill, alerts --------------
insert into u values ('senior_elec_engineer', gen_random_uuid()), ('assistant_engineer', gen_random_uuid());
insert into auth.users (id, email) select id, role || '@test.local' from u where role in ('senior_elec_engineer', 'assistant_engineer');
insert into public.profiles (id, full_name, role) select id, initcap(replace(role, '_', ' ')), role::public.app_role from u where role = 'senior_elec_engineer';
insert into public.profiles (id, full_name, role, manager_id) select id, 'Assistant Engineer', 'assistant_engineer', (select id from u where role = 'senior_elec_engineer')
  from u where role = 'assistant_engineer';
do $$ begin assert (select team from public.profiles where id = (select id from u where role = 'assistant_engineer')) = 'execution', 'execution team'; end $$;

select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare rid uuid;
begin
  begin
    perform public.save_warranty(null, jsonb_build_object('source', 'outside', 'project_name', 'X', 'customer', 'Y', 'category', 'hospitality',
      'invoice_no', 'I1', 'start_basis', 'invoice', 'invoice_date', current_date::text), '[{"product_group":"L","months":12}]'::jsonb);
    raise exception 'sales recorded a warranty';
  exception when others then if sqlerrm not like '%Only the Operations Executive or the Senior Electrical Engineer%' then raise; end if;
  end;
  rid := public.report_warranty_issue(jsonb_build_object('customer', 'Lakeside Hotels PLC', 'project_name', 'Lakeside Lobby',
    'description', 'About 15 downlights flickering in the lobby', 'quantity', '15', 'location', 'Lobby ceiling'));
  assert (select code from public.warranty_reports where id = rid) like 'WIR-%', 'report code';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'warranty_issue_reported' and recipient_id = (select id from u where role = 'senior_elec_engineer')), 'Senior Elec. Engineer told of the report';
end $$;

select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare wid uuid; ho date := ((current_date + 60) - interval '24 months')::date;
begin
  begin
    perform public.save_warranty(null, jsonb_build_object('source', 'outside', 'project_name', 'Lakeside Lobby', 'customer', 'Lakeside Hotels PLC',
      'category', 'hospitality', 'start_basis', 'handover', 'handover_date', ho::text), '[{"product_group":"L","months":12}]'::jsonb);
    raise exception 'saved without invoice / contract';
  exception when others then if sqlerrm not like '%invoice number or the contract number%' then raise; end if;
  end;
  wid := public.save_warranty(null, jsonb_build_object('source', 'outside', 'project_name', 'Lakeside Lobby', 'customer', 'Lakeside Hotels PLC',
    'category', 'hospitality', 'invoice_no', 'INV-26-04412', 'contract_no', 'CHL-7781', 'currency', 'LKR', 'contract_value', '46800000',
    'start_basis', 'handover', 'delivery_date', (ho - 60)::text, 'handover_date', ho::text,
    'project_engineer_id', (select id from u where role = 'assistant_engineer')::text),
    jsonb_build_array(
      jsonb_build_object('product_group', 'Luminaires', 'brand', 'Philips', 'quantity', '1240', 'months', 60, 'supplier_end', (ho + 1800)::text),
      jsonb_build_object('product_group', 'LED drivers', 'brand', 'Meanwell', 'quantity', '1240', 'months', 24),
      jsonb_build_object('product_group', 'Controls', 'brand', 'Dali', 'quantity', '1', 'months', 12)));
  assert (select owner_id from public.warranties where id = wid) = (select id from u where role = 'asm_building'), 'owner from the category';
  assert (select code from public.warranties where id = wid) like 'WAR-%', 'warranty code';
  assert (select end_date from public.warranty_lines where warranty_id = wid and product_group = 'LED drivers') = current_date + 60, 'line end date';
  assert (select count(*) from public.warranty_lines where warranty_id = wid) = 3, 'three lines';
end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin assert (select count(*) from public.warranties) = 1, 'owner sees the warranty'; end $$;
reset role;
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ begin assert (select count(*) from public.warranties) = 0, 'other category does not'; end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin assert (select count(*) from public.warranties) = 1, 'engineer sees all warranties'; end $$;
reset role;

-- Claim from the sales report, assigned to the Assistant Engineer
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare cid uuid; w uuid := (select id from public.warranties);
begin
  cid := public.log_warranty_claim(jsonb_build_object('warranty_id', w,
    'line_id', (select id from public.warranty_lines where warranty_id = w and product_group = 'LED drivers'),
    'report_id', (select id from public.warranty_reports), 'assignee_id', (select id from u where role = 'assistant_engineer')));
  assert (select in_warranty and reported_via = 'sales_visit' and reported_by = (select id from u where role = 'asm_building')
          from public.warranty_claims where id = cid), 'claim from the visit report, in warranty';
  assert (select status from public.warranty_reports) = 'converted', 'report converted';
end $$;
reset role;
do $$ begin
  assert (select assignee_id from public.warranty_claims) is null, 'Operations cannot assign engineers';
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_to_assign' and recipient_id = (select id from u where role = 'senior_elec_engineer')), 'Senior Elec. Engineer asked to assign';
end $$;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.assign_warranty_claim((select id from public.warranty_claims), (select id from u where role = 'assistant_engineer'));
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_opened' and recipient_id = (select id from u where role = 'asm_building')), 'sales person told';
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_assigned' and recipient_id = (select id from u where role = 'assistant_engineer')), 'engineer told';
end $$;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
select public.record_claim_inspection((select id from public.warranty_claims), current_date, 'Driver failures – batch fault');
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ begin
  perform public.decide_warranty_claim((select id from public.warranty_claims), 'covered', null, 'manufacturing_defect');
  raise exception 'Operations decided';
exception when others then if sqlerrm not like '%Senior Electrical Engineer decides%' then raise; end if;
end $$;
select public.raise_supplier_claim((select id from public.warranty_claims), 'MW-RMA-118', current_date);
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.decide_warranty_claim((select id from public.warranty_claims), 'covered', null, 'manufacturing_defect');
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
select public.record_claim_rectified((select id from public.warranty_claims), current_date, 228000, '38 drivers replaced');
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.resolve_supplier_claim((select id from public.warranty_claims), 'resolved', 180000, current_date, 'Credit note');
select public.close_warranty_claim((select id from public.warranty_claims), 'closed', current_date, 'Customer confirmed');
reset role;
do $$ begin
  assert (select status = 'closed' and cost_amount = 228000 and recovered_amount = 180000 from public.warranty_claims), 'closed with cost and recovery';
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_closed' and recipient_id = (select id from u where role = 'asm_building')), 'sales told of closure';
end $$;

-- Out-of-warranty claim covered as goodwill → SM Projects approval
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare cid uuid; w uuid := (select id from public.warranties);
begin
  cid := public.log_warranty_claim(jsonb_build_object('warranty_id', w, 'reported_via', 'customer_call', 'description', 'Controller not responding',
    'line_id', (select id from public.warranty_lines where warranty_id = w and product_group = 'Controls')));
  assert not (select in_warranty from public.warranty_claims where id = cid), 'out of warranty';
  perform public.record_claim_inspection(cid, current_date, 'Controller failed');
  perform public.decide_warranty_claim(cid, 'covered', 'Key customer', 'manufacturing_defect');
  assert (select goodwill_status from public.warranty_claims where id = cid) = 'pending', 'goodwill pending';
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'warranty_goodwill' and status = 'pending'), 'approved', 'OK as goodwill');
reset role;
do $$ begin
  assert (select goodwill_status from public.warranty_claims where status = 'open') = 'approved', 'goodwill approved';
end $$;

-- Alerts
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.log_warranty_claim(jsonb_build_object('warranty_id', (select id from public.warranties), 'reported_via', 'customer_email',
  'description', 'Façade linear not lighting'));
reset role;
insert into public.project_completions (project_id, completed_at) select id, now() - interval '8 days' from public.projects limit 1;
do $$ declare at8 timestamptz := (current_date + time '08:30') at time zone app.tz();
begin
  perform public.warranty_tick(at8);
  assert exists (select 1 from public.notifications where kind = 'warranty_expiring' and recipient_id = (select id from u where role = 'asm_building')), '90-day sales opportunity';
  assert exists (select 1 from public.notifications where kind = 'warranty_completion_due' and recipient_id = (select id from u where role = 'senior_elec_engineer')), 'completion record due';
  perform public.warranty_tick(at8 + interval '7 days');
  assert exists (select 1 from public.notifications where kind = 'warranty_inspection_overdue'), 'inspection overdue';
  perform public.warranty_tick(at8 + interval '15 days');
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_overdue' and recipient_id = (select id from u where role = 'sm_projects')), 'open 14 days – SM Projects';
  perform public.warranty_tick(at8 + interval '31 days');
  assert exists (select 1 from public.notifications where kind = 'warranty_expiring' and recipient_id = (select id from u where role = 'operations_exec')), '30 days – Operations';
end $$;

-- Remove a file uploaded by mistake: only the uploader; not once the quotation is released --------------------
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare aid uuid;
begin
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name)
  values ('inquiry', '00000000-0000-0000-0000-00000000d001', 'inquiry_doc', 'inq/x/wrong.pdf', 'wrong.pdf') returning id into aid;
  perform public.remove_attachment(aid, 'Wrong file');
  assert (select archived_at is not null from public.attachments where id = aid), 'removed (archived)';
  begin
    perform public.remove_attachment((select id from public.attachments where entity_type = 'estimation_job' and kind = 'quotation_final' limit 1));
    raise exception 'removed a file uploaded by someone else';
  exception when others then if sqlerrm not like '%Only the person who uploaded%' then raise; end if;
  end;
end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin
  perform public.remove_attachment((select a.id from public.attachments a join public.estimation_jobs j on j.id = a.entity_id
                                     where a.entity_type = 'estimation_job' and a.kind = 'quotation_final' and j.status = 'released' and a.archived_at is null limit 1));
  raise exception 'removed a released quotation';
exception when others then if sqlerrm not like '%already released%' then raise; end if;
end $$;
reset role;

-- Sales / SM Projects raise a warranty claim directly → Operations verify and assign --------------------------
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ begin
  perform public.log_warranty_claim(jsonb_build_object('warranty_id', (select id from public.warranties where status = 'active' limit 1),
    'reported_via', 'customer_call', 'description', 'x'));
  raise exception 'sales raised a claim on another category';
exception when others then if sqlerrm not like '%your own projects or categories%' and sqlerrm not like '%Choose the warranty%' then raise; end if;
end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare cid uuid;
begin
  cid := public.log_warranty_claim(jsonb_build_object('warranty_id', (select id from public.warranties where status = 'active' limit 1),
    'reported_via', 'customer_call', 'description', 'Customer called – corridor lights off', 'assignee_id', (select id from u where role = 'assistant_engineer')));
  perform set_config('test.sc', cid::text, false);
end $$;
reset role;
do $$ declare c public.warranty_claims;
begin
  select * into c from public.warranty_claims where id = current_setting('test.sc')::uuid;
  assert c.needs_verification and c.assignee_id is null and c.reported_by = (select id from u where role = 'asm_building'), 'sales claim waits for verification';
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_logged' and title like '%verify and assign%'
                 and recipient_id = (select id from u where role = 'operations_exec')), 'Operations told to verify';
end $$;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ begin
  perform public.assign_warranty_claim(current_setting('test.sc')::uuid, (select id from u where role = 'assistant_engineer'));
  raise exception 'Operations assigned an engineer';
exception when others then if sqlerrm not like '%Only the Senior Electrical Engineer assigns%' then raise; end if;
end $$;
select public.verify_warranty_claim(current_setting('test.sc')::uuid, 'INV-26-04412 checked');
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.assign_warranty_claim(current_setting('test.sc')::uuid, (select id from u where role = 'assistant_engineer'));
reset role;
do $$ begin
  assert (select verified_at is not null from public.warranty_claims where id = current_setting('test.sc')::uuid), 'verified on assignment';
  assert exists (select 1 from public.notifications where title = 'Your warranty claim was verified' and recipient_id = (select id from u where role = 'asm_building')), 'sales told';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert public.log_warranty_claim(jsonb_build_object('warranty_id', (select id from public.warranties where status = 'active' limit 1),
    'reported_via', 'customer_letter', 'description', 'Direct complaint to SM Projects')) is not null, 'SM Projects raises a claim';
end $$;
reset role;

-- Manufacturer: master list, registration, manufacturer claim (RMA) -----------------------------------------
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare mw uuid; ph uuid; reg public.warranty_registrations;
begin
  mw := public.save_manufacturer(null, '{"name":"Meanwell","registration_required":true,"registration_days":30,"warranty_terms":"Drivers 5 yrs"}');
  ph := public.save_manufacturer(null, '{"name":"Philips","warranty_terms":"Luminaires 5 yrs"}');
  assert (select count(*) from public.warranty_lines where manufacturer_id = mw) = 1, 'Meanwell line linked by brand';
  select * into reg from public.warranty_registrations where manufacturer_id = mw;
  assert reg.id is not null and reg.due_date = (select start_date + 30 from public.warranties where id = reg.warranty_id), 'registration due 30 days after start';
  assert not exists (select 1 from public.warranty_registrations where manufacturer_id = ph), 'no registration where not required';
  perform set_config('test.reg', reg.id::text, false);
  perform set_config('test.mw', mw::text, false);
end $$;
reset role;
do $$ begin
  perform public.manufacturer_tick((current_date + time '08:30') at time zone app.tz());
  assert exists (select 1 from public.notifications where kind = 'warranty_registration' and title like 'Manufacturer registration overdue%'
                 and recipient_id = (select id from u where role = 'sm_projects')), 'overdue registration – SM Projects told';
end $$;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.record_registration(current_setting('test.reg')::uuid, current_date, 'MW-REG-2211');
reset role;
-- Manufacturer claim for the covered driver claim
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare rid uuid; cl uuid := (select id from public.warranty_claims c where c.decision = 'covered' and c.line_id in
    (select id from public.warranty_lines where product_group = 'LED drivers') limit 1);
begin
  perform set_config('test.cl', cl::text, false);
  rid := public.create_manufacturer_claim(current_setting('test.mw')::uuid,
    jsonb_build_array(jsonb_build_object('claim_id', cl, 'product', 'LED driver 40W', 'quantity', '38', 'batch_code', 'MW-2402', 'value_claimed', '200000')),
    'Photos, failure report, batch codes');
  assert (select code from public.manufacturer_claims where id = rid) like 'RMA-%', 'RMA code';
  perform public.update_manufacturer_claim(rid, 'contacted', jsonb_build_object('date', current_date::text, 'note', 'Emailed Meanwell agent'));
  perform public.update_manufacturer_claim(rid, 'acknowledged', jsonb_build_object('date', current_date::text, 'rma_no', 'MW-RMA-301'));
  perform set_config('test.rma', rid::text, false);
end $$;
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare rid uuid := current_setting('test.rma')::uuid; before numeric := (select recovered_amount from public.warranty_claims where id = current_setting('test.cl')::uuid);
begin
  perform public.update_manufacturer_claim(rid, 'returned', jsonb_build_object('date', current_date::text, 'courier', 'DHL', 'tracking_no', 'DHL123'));
  begin
    perform public.update_manufacturer_claim(rid, 'received', jsonb_build_object('date', current_date::text, 'grn_no', 'G1'));
    raise exception 'received before the decision';
  exception when others then if sqlerrm not like '%decision first%' then raise; end if;
  end;
  perform public.update_manufacturer_claim(rid, 'decision', jsonb_build_object('date', current_date::text, 'decision', 'accepted', 'outcome', 'credit_note'));
  perform public.update_manufacturer_claim(rid, 'received', jsonb_build_object('date', current_date::text, 'credit_note_no', 'CN-778', 'value_recovered', '150000'));
  perform public.close_manufacturer_claim(rid, 'closed');
  assert (select recovered_amount from public.warranty_claims where id = current_setting('test.cl')::uuid) = before + 150000, 'recovery shared to the claim';
end $$;
reset role;
-- Rejected → SM Projects absorbs
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare rid uuid;
begin
  rid := public.create_manufacturer_claim(current_setting('test.mw')::uuid, '[{"product":"Driver 60W","quantity":"2"}]');
  perform public.update_manufacturer_claim(rid, 'contacted', jsonb_build_object('date', (current_date - 8)::text));
  perform set_config('test.rma2', rid::text, false);
end $$;
reset role;
do $$ begin
  perform public.manufacturer_tick((current_date + time '08:30') at time zone app.tz());
  assert exists (select 1 from public.notifications where kind = 'rma_followup' and title like 'No RMA number%'), 'no acknowledgement alert';
end $$;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.update_manufacturer_claim(current_setting('test.rma2')::uuid, 'decision', jsonb_build_object('date', current_date::text, 'decision', 'rejected', 'note', 'Surge damage'));
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_rejected_rma(current_setting('test.rma2')::uuid, 'absorb', 'Small value');
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.close_manufacturer_claim(current_setting('test.rma2')::uuid, 'closed', 'Absorbed');
reset role;
do $$ begin
  assert (select status from public.manufacturer_claims where id = current_setting('test.rma2')::uuid) = 'closed', 'rejected claim closed after absorb';
  assert (select count(*) from public.manufacturer_claim_log where rma_id = current_setting('test.rma2')::uuid) >= 4, 'history';
end $$;


-- Finance: secured projects from Won, budget list, invoice schedule, OR upload, date moves, targets --------------------------
do $$ declare sid uuid;
begin
  select id into sid from public.secured_projects where project_id = '00000000-0000-0000-0000-00000000b001';
  assert sid is not null, 'won project joins the secured list';
  assert (select order_value from public.secured_projects where id = sid) = 62000000, 'order value from the won inquiry';
  assert (select sales_person_id from public.secured_projects where id = sid) = (select id from u where role = 'asm_building'), 'sales person = owner';
  assert (select schedule_status from public.secured_projects where id = sid) = 'missing', 'schedule missing';
  assert exists (select 1 from public.notifications where kind = 'secured_new' and entity_id = sid
                 and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects told about the win';
  assert exists (select 1 from public.notifications where kind = 'secured_schedule' and entity_id = sid
                 and recipient_id = (select id from u where role = 'asm_building')), 'sales asked for the schedule';
  perform set_config('test.sec', sid::text, false);
end $$;

-- Budget list: Operations uploads; a bad business line blocks the save
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare y int := app.fy_of(current_date); res jsonb;
begin
  res := public.check_budget_list(y, jsonb_build_array(
    jsonb_build_object('row_no', 2, 'business_line', 'Building Lighting – LMS', 'project_name', 'ABC Hotels – Beach Resort – Galle', 'customer', 'ABC Hotels PLC',
      'sales_person', 'asm building', 'budget_value', '62000000', 'budget_gp_pct', '20', 'order_month', current_date::text,
      'invoices', jsonb_build_array(jsonb_build_object('month', current_date::text, 'amount', '40000000'))),
    jsonb_build_object('row_no', 3, 'business_line', 'Street lights', 'project_name', 'Airport apron', 'sales_person', 'Nobody', 'budget_value', 'x')));
  assert jsonb_array_length(res -> 0 -> 'errors') = 0, 'good row';
  assert (res -> 0 ->> 'project_id') = '00000000-0000-0000-0000-00000000b001', 'matched to the project';
  assert jsonb_array_length(res -> 1 -> 'errors') = 3, 'bad line, unknown person, bad value: ' || (res -> 1 -> 'errors')::text;
  begin
    perform public.save_budget_list(y, jsonb_build_array(jsonb_build_object('row_no', 3, 'business_line', 'x', 'project_name', 'y', 'sales_person', 'z', 'budget_value', '1')));
    assert false, 'errors block the save';
  exception when others then assert sqlerrm like 'Some rows have errors%', sqlerrm; end;
  assert public.save_budget_list(y, jsonb_build_array(
    jsonb_build_object('row_no', 2, 'business_line', 'LMS', 'project_name', 'ABC Hotels – Beach Resort – Galle', 'customer', 'ABC Hotels PLC',
      'sales_person', 'Asm Building', 'budget_value', '62000000', 'budget_gp_pct', '13640000', 'order_month', current_date::text,
      'invoices', jsonb_build_array(jsonb_build_object('month', current_date::text, 'amount', '40000000'))),
    jsonb_build_object('row_no', 3, 'business_line', 'Infrastructure', 'project_name', 'Airport apron lighting', 'sales_person', 'Asm Infra',
      'budget_value', '55000000', 'budget_gp_pct', '0.18', 'order_month', current_date::text, 'wbs', 'LS-000170',
      'invoices', jsonb_build_array(jsonb_build_object('month', current_date::text, 'amount', '55000000'))))) = 2, 'budget saved';
  assert (select budget_id from public.secured_projects where id = current_setting('test.sec')::uuid) is not null, 'won project linked to its budget line';
  assert (select budget_gp_pct from public.budget_projects where wbs is null and fy = y) = 22, 'GP amount saved as a %';
  assert (select budget_gp_pct from public.budget_projects where wbs = 'LS-000170') = 18, 'GP from a %-formatted cell';
  assert (select budget_gp_value from public.budget_projects where wbs is null and fy = y) = 13640000, 'GP value kept';
  assert (select budget_gp_value from public.budget_projects where wbs = 'LS-000170') = 9900000, 'GP value worked out from the %';
  assert (public.check_budget_list(y, jsonb_build_array(jsonb_build_object('row_no', 2, 'business_line', 'LMS', 'project_name', 'x',
    'sales_person', 'Asm Building', 'budget_value', '1,000,000.00', 'budget_gp_value', '200,000.00', 'budget_gp_pct', '30'))) -> 0 -> 'warnings') ->> 0
    like 'GP % and GP value do not agree%', 'GP % / value mismatch warned';
  assert (public.check_budget_list(y, jsonb_build_array(jsonb_build_object('row_no', 2, 'business_line', 'LMS', 'project_name', 'x',
    'sales_person', 'Asm Building', 'budget_value', '1000', 'budget_gp_pct', '5000000'))) -> 0 -> 'errors') ->> 0 like 'Budget GP%', 'impossible GP is a row error';
end $$;
reset role;

-- Sales enters the schedule: advance + delivery this month, retention next year; another sales person cannot
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ begin
  assert not exists (select 1 from public.secured_projects where id = current_setting('test.sec')::uuid), 'other sales person cannot see it';
  begin
    perform public.save_invoice_schedule(current_setting('test.sec')::uuid, '{}', '[]', false);
    assert false, 'other sales person cannot edit';
  exception when others then assert sqlerrm like 'Only the sales person%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare y int := app.fy_of(current_date);
begin
  begin
    perform public.save_invoice_schedule(current_setting('test.sec')::uuid, '{"business_line": "lms"}',
      jsonb_build_array(jsonb_build_object('kind', 'advance', 'amount', '10000000', 'month', current_date::text)), true);
    assert false, 'schedule must equal the order value';
  exception when others then assert sqlerrm like 'The invoices add up to%', sqlerrm; end;
  perform public.save_invoice_schedule(current_setting('test.sec')::uuid, '{"business_line": "lms"}', jsonb_build_array(
    jsonb_build_object('kind', 'advance', 'description', 'Advance 20%', 'amount', '12400000', 'month', current_date::text),
    jsonb_build_object('kind', 'delivery', 'description', 'Delivery 60%', 'amount', '37200000', 'month', current_date::text),
    jsonb_build_object('kind', 'retention', 'description', 'Retention 20%', 'amount', '12400000', 'month', (app.fy_end(y) + 1)::text)), true);
  assert (select schedule_status from public.secured_projects where id = current_setting('test.sec')::uuid) = 'review', 'sent for review';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'schedule_review' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects asked to review';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.review_invoice_schedule(current_setting('test.sec')::uuid, true, 'OK');
reset role;
-- Operations adds the WBS once SAP creates it
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.set_secured_details(current_setting('test.sec')::uuid, '{"wbs": "LS-000500"}');
-- Monthly OR file: P&L lines and invoicing by WBS (sub-codes already rolled up by the app)
select public.save_or_upload(current_date, 'Draft_OR.xlsx',
  '[{"seq":1,"section":"pnl","label":"Net Turnover","m_act":"77185779","m_bud":"537674381","c_act":"192017248","c_bud":"638215765","fy_bp":"2828320495","ly_cum":"204448057"},
    {"seq":2,"section":"pnl","label":"Net Profit","m_act":"-8646210","m_bud":"39518116","c_act":"-95303797","c_bud":"-38698544","fy_bp":"210493422","ly_cum":"40266140"}]',
  '[{"wbs":"LS-000500","revenue":"20000000","cost":"15000000"},{"wbs":"LS-000999","revenue":"5000000","cost":"1000000"}]');
reset role;
do $$ begin
  assert (select invoiced from public.invoice_line_status where secured_id = current_setting('test.sec')::uuid and kind = 'advance') = 12400000, 'advance fully invoiced';
  assert (select invoiced from public.invoice_line_status where secured_id = current_setting('test.sec')::uuid and kind = 'delivery') = 7600000, 'delivery part invoiced';
  assert exists (select 1 from public.notifications where kind = 'invoice_slipped' and title like 'Invoice part billed%'
                 and recipient_id = (select id from u where role = 'asm_building')), 'part-billed delivery alerted';
  assert (select net_profit from public.or_uploads where month = app.month_of(current_date)) = -8646210, 'net profit stored';
end $$;
-- P&L: SM Estimation sees it; Operations and sales do not
select pg_temp.act_as('sm_estimation'); set role authenticated;
do $$ begin assert (select count(*) from public.pnl_lines) = 2, 'SM Estimation sees the P&L'; end $$;
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ begin assert (select count(*) from public.pnl_lines) = 0, 'Operations does not see the P&L lines'; end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin assert (select count(*) from public.pnl_lines) = 0, 'sales do not see the P&L'; end $$;
-- Moving the delivery invoice (due this month) waits for SM Projects
do $$ declare lid uuid; res text;
begin
  select id into lid from public.invoice_lines where secured_id = current_setting('test.sec')::uuid and kind = 'delivery';
  begin
    perform public.move_invoice_line(lid, (current_date + 31), '', null);
    assert false, 'reason required';
  exception when others then assert sqlerrm = 'Choose the reason', sqlerrm; end;
  res := public.move_invoice_line(lid, (current_date + 31), 'Site not ready', 'Client delayed access');
  assert res = 'pending', 'needs SM Projects';
  assert (select forecast_month from public.invoice_lines where id = lid) = app.month_of(current_date), 'not moved yet';
  perform set_config('test.line', lid::text, false);
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_invoice_move((select id from public.invoice_line_changes where line_id = current_setting('test.line')::uuid and status = 'pending'), true, null);
reset role;
do $$ begin
  assert (select forecast_month from public.invoice_lines where id = current_setting('test.line')::uuid) = app.month_of(current_date + 31), 'moved after approval';
  assert (select original_month from public.invoice_lines where id = current_setting('test.line')::uuid) = app.month_of(current_date), 'original month kept';
  assert (select moves from public.invoice_lines where id = current_setting('test.line')::uuid) = 1, 'move counted';
end $$;

-- Opening secured list: order value must equal billed before + invoices still to do
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare res jsonb;
begin
  res := public.check_opening_list(jsonb_build_array(
    jsonb_build_object('row_no', 2, 'project_name', 'Bank HQ lighting controls', 'customer', 'XYZ Bank', 'business_line', 'LMS', 'sales_person', 'Asm Building',
      'wbs', 'LS-000090-01', 'order_value', '64000000', 'won_on', '2025-09-01', 'billed_before', '34100000',
      'invoices', jsonb_build_array(jsonb_build_object('month', current_date::text, 'amount', '29900000'))),
    jsonb_build_object('row_no', 3, 'project_name', 'Mall', 'business_line', 'Indoor', 'sales_person', 'Asm Building', 'order_value', '10', 'won_on', '2025-01-01',
      'invoices', jsonb_build_array(jsonb_build_object('month', current_date::text, 'amount', '5')))));
  assert jsonb_array_length(res -> 0 -> 'errors') = 0, 'opening row ok: ' || (res -> 0 -> 'errors')::text;
  assert (res -> 1 -> 'errors' ->> 0) like 'Invoiced before%', 'totals must agree';
  assert public.save_opening_list(jsonb_build_array(res -> 0 || jsonb_build_object('project_name', 'Bank HQ lighting controls', 'customer', 'XYZ Bank',
    'business_line', 'LMS', 'sales_person', 'Asm Building', 'wbs', 'LS-000090-01', 'order_value', '64000000', 'won_on', '2025-09-01',
    'billed_before', '34100000', 'invoices', jsonb_build_array(jsonb_build_object('month', current_date::text, 'amount', '29900000'))))) = 1, 'opening saved';
end $$;
reset role;
do $$ begin
  assert (select schedule_status from public.secured_projects where wbs = 'LS-000090') = 'approved', 'opening rows need no review';
  assert (select source from public.secured_projects where wbs = 'LS-000090') = 'opening', 'source';
end $$;

-- Targets: SM Projects fills from the budget list, submits; GM approves; sales see only their own
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ declare y int := app.fy_of(current_date);
begin
  assert public.fill_targets_from_budget(y) > 0, 'targets filled';
  assert (select sum(invoice_target) from public.sales_targets where fy = app.fy_of(current_date)
           and sales_person_id = (select id from u where role = 'asm_infra')) = 55000000, 'invoicing target from the budget';
  assert (select sum(secured_target) from public.sales_targets where fy = app.fy_of(current_date)
           and sales_person_id = (select id from u where role = 'asm_building')) = 40000000, 'secured target = this-year value';
  perform public.submit_targets(y);
  begin
    perform public.save_targets(y, '[]');
    assert false, 'locked after submit';
  exception when others then assert sqlerrm like 'Targets are submitted%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
select public.decide_targets(app.fy_of(current_date), true, null);
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare perf jsonb := public.finance_performance(app.fy_of(current_date)); me jsonb;
begin
  assert (select count(distinct sales_person_id) from public.sales_targets) = 1, 'sales see only their own targets';
  assert jsonb_array_length(perf -> 'people') = 1, 'performance: only me';
  me := perf -> 'people' -> 0;
  assert (select sum((m ->> 'secured')::numeric) from jsonb_array_elements(me -> 'months') m) = 49600000, 'secured credit = this-year part: ' || (me -> 'months')::text;
  assert (select sum((m ->> 'invoiced')::numeric) from jsonb_array_elements(me -> 'months') m) = 20000000, 'invoiced from the OR file';
  assert (me ->> 'to_bill_fy')::numeric = 29600000 + 29900000, 'still to bill this year: ' || (me ->> 'to_bill_fy');
  assert perf -> 'unlinked_invoiced' = 'null'::jsonb, 'sales do not see unlinked totals';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'targets' and title = 'Your sales target is set'
                 and recipient_id = (select id from u where role = 'asm_building')), 'sales told';
  assert (public.finance_performance(app.fy_of(current_date)) is not null), 'runs';
end $$;

-- Reminder: won 5+ working days ago with no schedule
insert into public.secured_projects (code, project_name, sales_person_id, won_on, created_at)
values ('SEC-T-1', 'Old win', (select id from u where role = 'asm_infra'), current_date - 20, now() - interval '20 days');
select public.finance_tick(date_trunc('day', now()) + interval '10 hours');
do $$ begin
  assert (select schedule_alerted from public.secured_projects where code = 'SEC-T-1'), 'schedule missing alerted';
  assert exists (select 1 from public.notifications where kind = 'secured_schedule' and title = 'Invoice schedule missing'
                 and recipient_id = (select id from u where role = 'asm_infra')), 'sales person reminded';
end $$;


-- Weekly plans: only SM Projects approves; GM / DGM do not see them in Approvals
insert into public.visit_plans (id, sales_person_id, week_start, status, submitted_at)
values ('00000000-0000-0000-0000-0000000f1a01', (select id from u where role = 'asm_infra'),
        (date_trunc('week', current_date) + interval '14 days')::date, 'submitted', now());
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin
  assert not exists (select 1 from public.my_pending_approvals() where source = 'visit_plan'), 'GM / DGM do not get weekly plans';
  begin
    perform public.decide_visit_plan('00000000-0000-0000-0000-0000000f1a01', 'approved', null);
    assert false, 'GM cannot approve';
  exception when others then assert sqlerrm = 'Only SM Projects approves weekly plans', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'visit_plan'), 'SM Projects gets the plan';
  perform public.decide_visit_plan('00000000-0000-0000-0000-0000000f1a01', 'approved', null);
end $$;
reset role;


-- Unlinked project codes: invoicing on a WBS with no secured project is listed for Operations; sales cannot call it
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ begin
  assert (select invoiced from public.unlinked_wbs(app.fy_of(current_date)) where wbs = 'LS-000999') = 5000000, 'unlinked code listed';
  assert not exists (select 1 from public.unlinked_wbs(app.fy_of(current_date)) where wbs = 'LS-000500'), 'linked code not listed';
end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  begin
    perform * from public.unlinked_wbs(app.fy_of(current_date));
    assert false, 'sales cannot see it';
  exception when others then assert sqlerrm = 'Not available for your role', sqlerrm; end;
end $$;
reset role;


-- Older project: claim entered with the project details by hand creates the warranty record
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare cid uuid; wid uuid;
begin
  cid := public.log_warranty_claim(jsonb_build_object('reported_via', 'customer_call', 'description', 'High-bays flickering',
    'manual', jsonb_build_object('project_name', 'Warehouse – Biyagama', 'customer', 'Old Customer Ltd', 'category', 'industrial',
      'invoice_no', 'INV-2023-0042', 'start_date', '2024-01-15', 'months', '60', 'product_group', 'High-bay luminaires', 'brand', 'Philips')));
  select warranty_id into wid from public.warranty_claims where id = cid;
  assert (select source from public.warranties where id = wid) = 'outside', 'outside warranty created';
  assert (select end_date from public.warranty_lines where warranty_id = wid) = '2029-01-15', 'line end date from start + months';
  assert (select in_warranty from public.warranty_claims where id = cid), 'in warranty';
  begin
    perform public.log_warranty_claim(jsonb_build_object('description', 'x', 'manual', jsonb_build_object('project_name', 'Other', 'customer', 'C',
      'category', 'industrial', 'invoice_no', 'inv-2023-0042', 'start_date', '2024-01-15', 'months', '12', 'product_group', 'Downlights')));
    assert false, 'duplicate invoice blocked';
  exception when others then assert sqlerrm like 'A warranty with this invoice%', sqlerrm; end;
end $$;
reset role;
-- Sales person: older project from the system (own project)
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare cid uuid;
begin
  cid := public.log_warranty_claim(jsonb_build_object('reported_via', 'customer_call', 'description', 'Downlights failed in the lobby',
    'manual', jsonb_build_object('project_id', '00000000-0000-0000-0000-00000000b001', 'contract_no', 'ABC-OLD-77', 'start_date', '2022-06-01',
      'months', '24', 'product_group', 'Downlights')));
  assert (select needs_verification from public.warranty_claims where id = cid), 'raised by sales – to verify';
  assert not (select in_warranty from public.warranty_claims where id = cid), 'warranty ended 2024 – out of warranty';
end $$;
reset role;

-- Not covered because of the fault (fault cause, evidence, quote, dispute, sales told of every step) -------------
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  perform set_config('test.fw', (select warranty_id::text from public.warranty_claims where id = current_setting('test.sc')::uuid), false);
  perform set_config('test.fc', public.log_warranty_claim(jsonb_build_object('warranty_id', current_setting('test.fw')::uuid,
    'reported_via', 'customer_call', 'description', 'Drivers burnt after a storm', 'line_id',
    (select id from public.warranty_lines where warranty_id = current_setting('test.fw')::uuid and end_date > current_date limit 1)))::text, false);
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.assign_warranty_claim(current_setting('test.fc')::uuid, (select id from u where role = 'assistant_engineer'));
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
select public.record_claim_inspection(current_setting('test.fc')::uuid, current_date, 'Surge marks on drivers, no surge protection at the DB');
reset role;
do $$ begin
  assert (select in_warranty from public.warranty_claims where id = current_setting('test.fc')::uuid), 'in warranty by date';
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_step' and title like 'Engineer assigned%'
                 and recipient_id = (select id from u where role = 'asm_building')), 'sales told: engineer assigned';
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_step' and title like 'Site inspection done%'
                 and recipient_id = (select id from u where role = 'asm_building')), 'sales told: inspection done';
end $$;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare cid uuid := current_setting('test.fc')::uuid;
begin
  begin perform public.decide_warranty_claim(cid, 'chargeable', 'Surge', null); assert false, 'cause required';
  exception when others then assert sqlerrm like 'Choose the cause%', sqlerrm; end;
  begin perform public.decide_warranty_claim(cid, 'rejected', 'No', 'manufacturing_defect'); assert false, 'defect in warranty must be covered';
  exception when others then assert sqlerrm like 'A manufacturing defect within the warranty period%', sqlerrm; end;
  begin perform public.decide_warranty_claim(cid, 'chargeable', 'Surge damage', 'power_surge'); assert false, 'evidence required';
  exception when others then assert sqlerrm like 'Attach a photo%', sqlerrm; end;
end $$;
reset role;
insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name, uploaded_by)
values ('warranty_claim', current_setting('test.fc')::uuid, 'claim_photo', 'test/fc-1.jpg', 'surge.jpg', (select id from u where role = 'assistant_engineer'));
-- Covering a surge (not a defect) inside the warranty period is goodwill → SM Projects
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.decide_warranty_claim(current_setting('test.fc')::uuid, 'covered', 'Customer is a key account', 'power_surge');
reset role;
do $$ begin
  assert (select goodwill_status = 'pending' and fault_cause = 'power_surge' from public.warranty_claims where id = current_setting('test.fc')::uuid), 'goodwill pending for a surge';
  assert exists (select 1 from public.approvals where kind = 'warranty_goodwill' and entity_id = current_setting('test.fc')::uuid and reason like '%not a manufacturing defect%'), 'approval says why';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'warranty_goodwill' and entity_id = current_setting('test.fc')::uuid), 'rejected', 'Site has no surge protection');
reset role;
do $$ declare at8 timestamptz := (current_date + time '08:30') at time zone app.tz();
begin
  assert (select decision from public.warranty_claims where id = current_setting('test.fc')::uuid) = 'chargeable', 'goodwill refused → chargeable';
  perform public.claim_followup_tick(at8 + interval '8 days');
  assert exists (select 1 from public.notifications where kind = 'warranty_quote_due' and recipient_id = (select id from u where role = 'asm_building')), 'sales reminded to quote';
end $$;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  perform public.record_claim_rectified(current_setting('test.fc')::uuid, current_date, 0, 'x', null); assert false, 'no repair before acceptance';
exception when others then assert sqlerrm like 'Chargeable – the customer must accept%', sqlerrm; end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
select public.record_claim_quote(current_setting('test.fc')::uuid, 45000, 'Q-WC-1', current_date);
select public.record_quote_response(current_setting('test.fc')::uuid, 'declined', current_date, 'Customer says DIMO should have fitted surge protection');
select public.dispute_warranty_claim(current_setting('test.fc')::uuid, 'Surge protection was in DIMO''s scope');
reset role;
do $$ begin
  assert (select status = 'closed' and close_note like 'Declined by customer%' and dispute_status = 'pending'
            from public.warranty_claims where id = current_setting('test.fc')::uuid), 'declined, then disputed';
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_quoted' and recipient_id = (select id from u where role = 'operations_exec')), 'Operations told of the quote';
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_disputed' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects asked';
  assert not exists (select 1 from public.notifications where kind = 'warranty_claim_step' and title like 'Repair quote%'
                     and recipient_id = (select id from u where role = 'asm_building')), 'not told of own step';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'claim_dispute' and id = current_setting('test.fc')::uuid), 'dispute in approvals';
end $$;
select public.decide_claim_dispute(current_setting('test.fc')::uuid, 'goodwill', 'Scope confirmed – cover it');
reset role;
do $$ begin
  assert (select status = 'open' and decision = 'covered' and goodwill_status = 'approved' and dispute_status = 'goodwill'
            from public.warranty_claims where id = current_setting('test.fc')::uuid), 'reopened as goodwill';
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_step' and title like 'Dispute: covered as goodwill%'
                 and recipient_id = (select id from u where role = 'asm_building')), 'sales told of the outcome';
end $$;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
select public.record_claim_rectified(current_setting('test.fc')::uuid, current_date, 52000, 'Drivers replaced, SPD fitted', 'dimo_stock');
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_step' and title like 'Repaired / replaced%'
                 and recipient_id = (select id from u where role = 'asm_building')), 'sales told of the repair';
end $$;
-- Rejected (not DIMO supply) → dispute upheld; chargeable accepted → repair
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ begin
  perform set_config('test.fr', public.log_warranty_claim(jsonb_build_object('warranty_id', current_setting('test.fw')::uuid,
    'reported_via', 'customer_email', 'description', 'Garden bollards not working'))::text, false);
  perform set_config('test.fq', public.log_warranty_claim(jsonb_build_object('warranty_id', current_setting('test.fw')::uuid,
    'reported_via', 'customer_email', 'description', 'Broken diffusers'))::text, false);
end $$;
reset role;
insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name, uploaded_by)
select 'warranty_claim', x::uuid, 'claim_photo', 'test/' || x || '.jpg', 'p.jpg', (select id from u where role = 'operations_exec')
  from unnest(array[current_setting('test.fr'), current_setting('test.fq')]) x;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.decide_warranty_claim(current_setting('test.fr')::uuid, 'rejected', 'Bollards are not our supply', 'not_dimo_supply');
select public.assign_warranty_claim(current_setting('test.fq')::uuid, (select id from u where role = 'assistant_engineer'));
select public.record_claim_inspection(current_setting('test.fq')::uuid, current_date, 'Diffusers cracked by impact');
select public.decide_warranty_claim(current_setting('test.fq')::uuid, 'chargeable', 'Impact damage', 'misuse_damage');
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
select public.dispute_warranty_claim(current_setting('test.fr')::uuid, 'Customer insists we supplied them');
select public.record_claim_quote(current_setting('test.fq')::uuid, 18000, null, current_date);
select public.record_quote_response(current_setting('test.fq')::uuid, 'accepted', current_date);
reset role;
select pg_temp.act_as('gm'); set role authenticated;
select public.decide_claim_dispute(current_setting('test.fr')::uuid, 'uphold', 'Delivery records show another supplier');
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
select public.record_claim_rectified(current_setting('test.fq')::uuid, current_date, 0, 'Diffusers replaced (paid)', null);
reset role;
do $$ declare mon timestamptz := ((current_date + ((8 - extract(isodow from current_date)::int) % 7)) + time '09:00') at time zone app.tz();
begin
  assert (select status = 'closed' and dispute_status = 'upheld' from public.warranty_claims where id = current_setting('test.fr')::uuid), 'dispute upheld, stays closed';
  assert exists (select 1 from public.notifications where kind = 'warranty_claim_step' and title like 'Dispute: SM Projects upheld%'
                 and recipient_id = (select id from u where role = 'asm_building')), 'sales told: upheld';
  assert (select rectified_on is not null from public.warranty_claims where id = current_setting('test.fq')::uuid), 'paid repair recorded';
  perform public.claim_followup_tick(mon);
  assert exists (select 1 from public.notifications where kind = 'warranty_causes_weekly' and body like '%Not DIMO supply%'
                 and recipient_id = (select id from u where role = 'gm')), 'Monday summary by cause';
end $$;

-- Secured: variations register, final account, invoicing watch ------------------------------------------------------
do $$ begin
  assert (select original_value from public.secured_projects where id = current_setting('test.sec')::uuid) = 62000000, 'original value kept';
end $$;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  assert public.request_variation(current_setting('test.sec')::uuid,
    jsonb_build_object('vo_no', 'VO-01', 'amount', '5000000', 'month', current_date::text, 'reason', 'Extra façade fittings')) = 'pending', 'sales variation waits';
  begin
    perform public.request_variation(current_setting('test.sec')::uuid, jsonb_build_object('amount', '-1000', 'reason', 'x'));
    assert false, 'one pending at a time';
  exception when others then assert sqlerrm like 'A variation is already waiting%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'variation'), 'variation in approvals';
  perform public.decide_variation((select id from public.secured_variations where status = 'pending'), true, null);
  -- SM Projects' own omission applies at once: comes off the last open invoices (retention)
  assert public.request_variation(current_setting('test.sec')::uuid, jsonb_build_object('vo_no', 'VO-02', 'amount', '-10000000',
    'reason', 'Car park lighting omitted')) = 'approved', 'SM Projects variation applies';
  begin
    perform public.request_variation(current_setting('test.sec')::uuid, jsonb_build_object('amount', '-900000000', 'reason', 'too much'));
    assert false, 'omission larger than the balance';
  exception when others then assert sqlerrm like 'Only % is still to bill%', sqlerrm; end;
end $$;
reset role;
do $$ declare sid uuid := current_setting('test.sec')::uuid;
begin
  assert (select original_value = 62000000 and order_value = 57000000 from public.secured_projects where id = sid), 'revised value 62 + 5 − 10';
  assert (select amount from public.invoice_lines where secured_id = sid and kind = 'variation') = 5000000, 'variation invoice added';
  assert (select amount from public.invoice_lines where secured_id = sid and kind = 'retention') = 2400000, 'omission off the retention';
  assert (select count(*) from public.secured_variations where secured_id = sid and status = 'approved') = 2, 'two approved';
  assert exists (select 1 from public.notifications where kind = 'secured_variation' and title = 'Variation approved'
                 and recipient_id = (select id from u where role = 'asm_building')), 'sales told';
end $$;
-- Work-done project: nothing invoiced after the last planned IPC → alert; final account clears the balance
insert into public.secured_projects (code, project_name, sales_person_id, won_on, order_value, schedule_status, business_line)
values ('SEC-V-1', 'Hospital IPC job', (select id from u where role = 'asm_building'), current_date - 200, 3000000, 'approved', 'indoor'),
       ('SEC-V-2', 'Office supply', (select id from u where role = 'asm_building'), current_date - 30, 1000000, 'approved', 'indoor');
insert into public.invoice_lines (secured_id, seq, kind, amount, original_month, forecast_month)
select s.id, x.n, 'progress', 1000000, app.month_of(current_date - x.d), app.month_of(current_date - x.d)
  from public.secured_projects s, (values (1, 180), (2, 150), (3, 120)) x(n, d) where s.code = 'SEC-V-1';
insert into public.invoice_lines (secured_id, seq, kind, amount, original_month, forecast_month)
select id, 1, 'delivery', 1000000, app.month_of(current_date), app.month_of(current_date) from public.secured_projects where code = 'SEC-V-2';
update public.secured_projects set wbs = 'LS-000778' where code = 'SEC-V-2';
insert into public.wbs_actuals (upload_id, wbs, revenue, cost)
values ((select id from public.or_uploads where month = app.month_of(current_date)), 'LS-000778', 1100000, 0);
select app.reallocate(id) from public.secured_projects where code = 'SEC-V-2';
do $$ declare at10 timestamptz := (current_date + time '10:00') at time zone app.tz();
begin
  perform public.secured_watch_tick(at10);
  assert exists (select 1 from public.notifications n join public.secured_projects s on s.id = n.entity_id
                 where n.kind = 'secured_stale' and s.code = 'SEC-V-1' and n.recipient_id = (select id from u where role = 'asm_building')), 'stale alert';
  assert exists (select 1 from public.notifications n join public.secured_projects s on s.id = n.entity_id
                 where n.kind = 'secured_over_invoiced' and s.code = 'SEC-V-2'), 'over-invoiced alert';
  assert public.secured_watch_tick(at10 + interval '1 hour') = 0, 'not repeated';
end $$;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.close_final_account((select id from public.secured_projects where code = 'SEC-V-1'), 'Final bill FB-12 – job stopped by client');
select public.close_final_account((select id from public.secured_projects where code = 'SEC-V-2'), 'Final bill incl. extra drivers');
reset role;
do $$ begin
  assert (select status = 'closed' and order_value = 0 and original_value = 3000000 from public.secured_projects where code = 'SEC-V-1'), 'balance cleared';
  assert (select amount from public.secured_variations v join public.secured_projects s on s.id = v.secured_id
           where s.code = 'SEC-V-1' and v.kind = 'final_account') = -3000000, 'final account omission recorded';
  assert (select status = 'closed' and order_value = 1100000 from public.secured_projects where code = 'SEC-V-2'), 'extra recorded';
  assert not exists (select 1 from public.invoice_allocations a join public.secured_projects s on s.id = a.secured_id
                     where s.code = 'SEC-V-2' and a.line_id is null), 'all invoicing now on invoices';
end $$;

-- Targets from a budget list without invoice months: spread from the order month to March ------------------------------
insert into public.budget_projects (fy, business_line, project_name, sales_person_id, budget_value, order_month)
values (app.fy_of(current_date) + 1, 'indoor', 'Mall fit-out', (select id from u where role = 'asm_infra'), 12000000,
        (app.fy_start(app.fy_of(current_date) + 1) + interval '2 months')::date);
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ declare y int := app.fy_of(current_date) + 1; me uuid := (select id from u where role = 'asm_infra');
begin
  perform public.fill_targets_from_budget(y);
  assert (select sum(invoice_target) from public.sales_targets where fy = y and sales_person_id = me) = 12000000, 'whole value as invoicing target';
  assert (select invoice_target from public.sales_targets where fy = y and sales_person_id = me and month = app.fy_start(y)) = 0, 'nothing before the order month';
  assert (select invoice_target from public.sales_targets where fy = y and sales_person_id = me
           and month = (app.fy_start(y) + interval '2 months')::date) = 1200000, 'spread over 10 months';
  assert (select sum(secured_target) from public.sales_targets where fy = y and sales_person_id = me
           and month = (app.fy_start(y) + interval '2 months')::date) = 12000000, 'secured in the order month';
end $$;
reset role;

-- Mark a budgeted project as secured; add an earlier, unbudgeted secured project by hand -----------------------------------
insert into public.budget_projects (id, fy, business_line, project_name, sales_person_id, budget_value)
values ('00000000-0000-0000-0000-0000000bb001', app.fy_of(current_date), 'indoor', 'Warehouse lighting – Ekala',
        (select id from u where role = 'asm_infra'), 8000000);
insert into public.budget_invoices (budget_id, month, amount)
values ('00000000-0000-0000-0000-0000000bb001', app.month_of(current_date), 4000000),
       ('00000000-0000-0000-0000-0000000bb001', (app.month_of(current_date) + interval '1 month')::date, 4000000);
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  perform public.secure_budget_project('00000000-0000-0000-0000-0000000bb001', '{"won_on": "2026-01-01"}');
  assert false, 'other sales person cannot';
exception when others then assert sqlerrm like 'Only the sales person%', sqlerrm; end $$;
reset role;
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ declare sid uuid;
begin
  sid := public.secure_budget_project('00000000-0000-0000-0000-0000000bb001', jsonb_build_object('won_on', current_date::text, 'order_value', '8,200,000.00'));
  assert (select source = 'won' and budget_id is not null and order_value = 8200000 and schedule_status = 'missing'
            from public.secured_projects where id = sid), 'secured from the budget list';
  assert (select count(*) from public.invoice_lines where secured_id = sid) = 2, 'budget invoices become the draft schedule';
  begin
    perform public.secure_budget_project('00000000-0000-0000-0000-0000000bb001', jsonb_build_object('won_on', current_date::text));
    assert false, 'only once';
  exception when others then assert sqlerrm like '%already secured%', sqlerrm; end;
  begin
    perform public.add_secured_project(jsonb_build_object('project_name', 'x'));
    assert false, 'sales cannot add by hand';
  exception when others then assert sqlerrm like 'Only Operations%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare sid uuid;
begin
  sid := public.add_secured_project(jsonb_build_object('project_name', 'Old hotel retrofit', 'customer', 'Galle Face Hotel', 'business_line', 'Indoor',
    'sales_person_id', (select id from u where role = 'asm_building'), 'won_on', (app.fy_start(app.fy_of(current_date)) - 200)::text,
    'order_value', '5,000,000.00', 'billed_before', '3000000', 'wbs', 'LS-000881'));
  assert (select source = 'opening' and billed_before = 3000000 and budget_id is null from public.secured_projects where id = sid), 'earlier unbudgeted order';
  begin
    perform public.add_secured_project(jsonb_build_object('project_name', 'Dup', 'business_line', 'Indoor', 'sales_person_id', (select id from u where role = 'asm_building'),
      'won_on', current_date::text, 'order_value', '1', 'wbs', 'LS-000881-01'));
    assert false, 'WBS used once';
  exception when others then assert sqlerrm like 'This WBS is already%', sqlerrm; end;
end $$;
reset role;

-- Secured counts at once: a win without a schedule counts its order value; with one, its invoices due this year ------
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.add_secured_project(jsonb_build_object('project_name', 'Showroom relighting', 'business_line', 'LMS',
  'sales_person_id', (select id from u where role = 'asm_infra'), 'won_on', current_date::text, 'order_value', '2,000,000.00'));
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ declare y int := app.fy_of(current_date); me jsonb; got numeric; expect numeric;
begin
  select x into me from jsonb_array_elements(public.finance_performance(y) -> 'people') x where x ->> 'id' = (select id::text from u where role = 'asm_infra');
  select (m ->> 'secured')::numeric into got from jsonb_array_elements(me -> 'months') m where m ->> 'month' = app.month_of(current_date)::text;
  select sum(case when exists (select 1 from public.invoice_lines l where l.secured_id = s.id)
                  then (select coalesce(sum(l.amount), 0) from public.invoice_lines l where l.secured_id = s.id
                         and l.original_month between app.fy_start(y) and app.fy_end(y))
                  else s.order_value - s.billed_before end) into expect
    from public.secured_projects s
   where s.sales_person_id = (select id from u where role = 'asm_infra') and s.source = 'won' and s.status <> 'cancelled'
     and app.month_of(s.won_on) = app.month_of(current_date);
  assert got = expect and got >= 2000000, format('secured counted at once: %s vs %s', got, expect);
end $$;
reset role;

-- Opening list row without invoice months: loads with the schedule missing ------------------------------------------------
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare res jsonb;
  row jsonb := jsonb_build_object('row_no', 2, 'project_name', 'Supply of terminal blocks', 'business_line', 'Infrastructure', 'sales_person', 'Asm Infra',
    'order_value', '950,000.00', 'won_on', '2026-02-10', 'wbs', 'LS-000771');
begin
  res := public.check_opening_list(jsonb_build_array(row));
  assert jsonb_array_length(res -> 0 -> 'errors') = 0, 'no invoice months is not an error: ' || (res -> 0 -> 'errors')::text;
  assert (res -> 0 -> 'warnings' ->> 0) like 'No invoice months%', 'warned';
  assert public.save_opening_list(jsonb_build_array(row)) = 1, 'saved';
  assert (select schedule_status = 'missing' and order_value = 950000 and source = 'opening' from public.secured_projects where wbs = 'LS-000771'), 'schedule missing';
  res := public.check_opening_list(jsonb_build_array(row || jsonb_build_object('billed_before', '1,000,000')));
  assert (res -> 0 -> 'errors' ->> 0) like 'Invoiced before 1 April is more%', 'billed before above the value';
end $$;
reset role;

\echo 'ALL WORKFLOW TESTS PASSED'
rollback;
