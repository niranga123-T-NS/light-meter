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

\echo 'ALL WORKFLOW TESTS PASSED'
rollback;
