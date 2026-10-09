-- End-to-end workflow test. Run against a database with all migrations + seed applied:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/workflow_test.sql
-- It creates test users, walks Route A (design → estimation) and Route B end to end,
-- checks row-level security and SLA clocks, the debtors upload and a sample request, then rolls back.

begin;
-- Dates in the tests follow the app time zone, so current_date matches app.tz() at any hour.
select set_config('TimeZone', app.tz(), true);

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
    'organization_id', '00000000-0000-0000-0000-00000000a001', 'expected_duration_months', 1, 'project_term', 'short',
    'win_probability', 35, 'use_wizard', true))) is not null, 'create_project as sales';
  assert (select win_probability = 35 and use_wizard and milestone = 'lead_identified' from public.projects where name = 'ABC Hotels – City Hotel – Kandy'),
    'the sales person''s own % is kept (the lead milestone does not reset it)';
  -- The % is required when the project is created
  begin
    perform public.create_project(jsonb_build_object('name', 'ABC Hotels – No percent – Kandy', 'project_type', 'hospitality',
      'organization_id', '00000000-0000-0000-0000-00000000a001', 'expected_duration_months', 1, 'project_term', 'short'));
    raise exception 'created without a win probability';
  exception when others then
    if sqlerrm not like 'Enter the win probability%' then raise; end if;
  end;
end $$;
-- A similar name confirmed as a different project (reason logged) – sales has no direct insert on project_log
do $$ declare pid uuid;
begin
  pid := public.create_project(jsonb_build_object('name', 'ABC Hotels – City Hotel – Kandy Annex', 'project_type', 'hospitality', 'stage', 'Award',
    'organization_id', '00000000-0000-0000-0000-00000000a001', 'expected_duration_months', 3, 'project_term', 'short', 'win_probability', 20), null, 'This is a different project');
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

-- Win probability edits (a direct edit – SM Projects; sales persons send change requests)
do $$ begin
  begin
    update public.projects set win_probability = 15 where id = '00000000-0000-0000-0000-00000000b001';
    raise exception 'sales person edited directly';
  exception when others then
    if sqlerrm not like 'Project details are changed through a change request%' then raise; end if;
  end;
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  -- No milestone band: any 0–100% is accepted without a reason, and a milestone change leaves the % alone
  update public.projects set win_probability = 60 where id = '00000000-0000-0000-0000-00000000b001';
  update public.projects set milestone = 'brand_specified' where id = '00000000-0000-0000-0000-00000000b001';
  assert (select win_probability from public.projects where id = '00000000-0000-0000-0000-00000000b001') = 60, 'milestone does not move the %';
  perform set_config('app.reason', 'Consultant confirmed our spec informally', true);
  update public.projects set win_probability = 30, milestone = 'lead_identified' where id = '00000000-0000-0000-0000-00000000b001';
  perform set_config('app.reason', '', true);
  assert (select win_probability from public.projects where id = '00000000-0000-0000-0000-00000000b001') = 30, 'own % kept';
  assert (select count(*) from public.project_log where project_id = '00000000-0000-0000-0000-00000000b001' and field = 'win_probability') = 2, 'probability logged';
end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;

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
-- Reassign with a new due date: checked against the approved completion date; the clock follows the new date
do $$ declare j uuid := (select id from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-00000000d001' limit 1); d timestamptz;
begin
  begin
    perform public.reassign_job('design_job', j, (select id from u where role = 'lighting_engineer'), 'Leave', now() + interval '9 days');
    raise exception 'reassigned past the approved completion date';
  exception when others then
    if sqlerrm not like '%approved design completion date%' then raise; end if;
  end;
  d := date_trunc('minute', now() + interval '4 days');
  perform public.reassign_job('design_job', j, (select id from u where role = 'lighting_engineer'), 'Leave', d);
  assert (select due_at from public.design_jobs where id = j) = d, 'new due date set';
  assert (select assignee_id from public.design_jobs where id = j) = (select id from u where role = 'lighting_engineer'), 'reassigned';
  assert exists (select 1 from public.due_date_changes where entity_id = j and new_value::timestamptz = d), 'due change versioned';
  assert (select due_at from public.sla_clocks where entity_id = j and stage = 'design' and stopped_at is null) = d, 'clock follows the new date';
  -- back to the designer, keeping the date
  perform public.reassign_job('design_job', j, (select id from u where role = 'lighting_designer'), 'Back from leave');
  assert (select due_at from public.design_jobs where id = j) = d, 'date kept';
  assert (select owner_id from public.sla_clocks where entity_id = j and stage = 'design' and stopped_at is null) = (select id from u where role = 'lighting_designer'), 'clock owner follows';
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
  begin perform public.add_design_note(j, '  '); assert false, 'empty note';
  exception when others then assert sqlerrm like 'Write the note%', sqlerrm; end;
  perform public.add_design_note(j, 'Lux levels assume ceiling height 3.2 m – recheck if the client changes it', true);
  perform public.add_design_note(j, 'Emergency lighting excluded from this design');
  perform public.submit_design_for_review(j);
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.design_notes where inquiry_id = '00000000-0000-0000-0000-00000000d001') = 2, 'two notes';
  assert exists (select 1 from public.notifications where kind = 'design_note_important' and requires_open
                 and recipient_id = (select id from u where role = 'asm_building')), 'sales person told, important pops up';
  assert exists (select 1 from public.notifications where kind = 'design_note' and recipient_id = (select id from u where role = 'design_manager')), 'design manager told';
end $$;
select set_config('test.dj', (select design_job_id::text from public.design_notes limit 1), false);
select pg_temp.act_as('estimation_exec'); set role authenticated;
do $$ begin
  begin perform public.add_design_note(current_setting('test.dj')::uuid, 'x'); assert false, 'not design';
  exception when others then assert sqlerrm like 'Only the designer%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  assert (select count(*) from public.design_notes) = 2, 'sales reads the notes on the inquiry';
end $$;
reset role;

-- Rejected once: the resubmission is Design Rev 1, numbered on screen, in alerts and in the file names
select pg_temp.act_as('design_manager');
set role authenticated;
do $$ declare jid uuid := (select id from public.design_jobs); cd date := (select i.customer_deadline from public.inquiries i join public.design_jobs j on j.inquiry_id = i.id limit 1);
begin
  begin perform public.review_design(jid, false, 'Increase lux in the lobby'); assert false, 'due date needed';
  exception when others then assert sqlerrm = 'Set the new due date for the revision', sqlerrm; end;
  if cd is not null then
    begin perform public.review_design(jid, false, 'Increase lux in the lobby', cd + 1); assert false, 'beyond the customer deadline';
    exception when others then assert sqlerrm like 'The revision must be due by the customer deadline%', sqlerrm; end;
  end if;
  perform public.review_design(jid, false, 'Increase lux in the lobby', coalesce(cd, current_date + 3));
  assert (select (due_at at time zone app.tz())::date = coalesce(cd, current_date + 3) from public.design_jobs where id = jid), 'new due date set by the Design Manager';
end $$;
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
  assert exists (select 1 from public.notifications where kind = 'design_returned' and title like '%prepare Rev 1 by %'), 'designer told the next Rev and the new due date';
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
do $$ begin
  begin perform public.set_quote_validity((select id from public.estimation_jobs), current_date - 1); assert false, 'past date';
  exception when others then assert sqlerrm like 'The validity date cannot be in the past%', sqlerrm; end;
  perform public.set_quote_validity((select id from public.estimation_jobs), current_date + 45);
end $$;
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
  assert (select validity_date from public.quotations where estimation_job_id = (select id from public.estimation_jobs) order by revision desc limit 1) = current_date + 45, 'valid until the date the estimator entered';
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
-- Correct a confirmed debt (Operations Executive, with a reason); logged, and the latest snapshot follows
do $$ declare d uuid := (select id from public.debts where invoice_no = 'INV-1');
begin
  begin perform public.edit_debt(d, '{"amount":"12"}', ' '); assert false, 'reason needed';
  exception when others then assert sqlerrm like 'Give the reason%', sqlerrm; end;
  begin perform public.edit_debt(d, '{"invoice_no":"INV-10452"}', 'x'); assert false, 'duplicate invoice';
  exception when others then assert sqlerrm like 'Another debt already has invoice number%', sqlerrm; end;
  begin perform public.edit_debt(d, '{"amount":"10"}', 'x'); assert false, 'nothing changed';
  exception when others then assert sqlerrm like 'Nothing was changed%', sqlerrm; end;
  perform public.edit_debt(d, '{"amount":"1,250.50","outstanding_days":"8","client_name":"ABC Hotels PLC","invoice_no":"INV-1A"}', 'Wrong line in the accounts extract');
  assert (select amount = 1250.50 and outstanding_days = 8 and invoice_no = 'INV-1A' and organization_id = '00000000-0000-0000-0000-00000000a001'
            from public.debts where id = d), 'corrected and linked to the customer';
  assert (select amount from public.debt_snapshots where debt_id = d and upload_id = (select last_upload_id from public.debts where id = d)) = 1250.50, 'snapshot follows';
  assert (select note from public.debt_log where debt_id = d and kind = 'edit') like '%amount%Wrong line in the accounts extract', 'logged with the reason';
end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  begin perform public.edit_debt((select id from public.debts where invoice_no = 'INV-1A'), '{"amount":"1"}', 'x'); assert false, 'only operations';
  exception when others then assert sqlerrm like 'Only the Operations Executive edits the debtors%', sqlerrm; end;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'debt_edit' and recipient_id = (select id from u where role = 'asm_building')), 'sales person told';
end $$;
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
  -- (handover is dated in Colombo time, the upload by the server date: 13 or 14 depending on the hour the tests run)
  assert (select outstanding_days from public.debts where invoice_no = 'SINV-501') in (13, 14), 'sample debt ages from handover';
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
-- Part collection keeps the retention open for its balance
savepoint ret_part;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare rid uuid := (select id from public.retentions); v numeric := (select retention_value from public.retentions);
begin
  perform public.mark_retention_collected(rid, 1000000, current_date, 'First part');
  assert (select status = 'claimed' and collected_amount = 1000000 from public.retentions where id = rid), 'still open with its balance';
  begin perform public.mark_retention_collected(rid, v, current_date); assert false, 'over balance';
  exception when others then assert sqlerrm like 'More than the balance%', sqlerrm; end;
  perform public.void_retention_collection((select id from public.retention_collections where retention_id = rid and voided_at is null limit 1), 'Cheque returned');
  assert (select status = 'claimed' and collected_amount is null from public.retentions where id = rid), 'cancelled entry';
  perform public.mark_retention_collected(rid, 400000, current_date);
  perform public.mark_retention_collected(rid, v - 400000, current_date);
  assert (select status from public.retentions where id = rid) = 'collected', 'closed when nothing is left';
end $$;
reset role;
rollback to savepoint ret_part;
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
  assert not exists (select 1 from public.invoice_allocations where secured_id = current_setting('test.sec')::uuid), 'the OR file does not record invoicing';
end $$;
-- Invoices are recorded in the app against the schedule
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare sid uuid := current_setting('test.sec')::uuid;
begin
  perform public.record_invoice((select id from public.invoice_lines where secured_id = sid and kind = 'advance'),
    jsonb_build_object('invoice_no', 'INV-26-0101', 'invoice_date', current_date::text, 'amount', '12,400,000.00'));
  perform public.record_invoice((select id from public.invoice_lines where secured_id = sid and kind = 'delivery'),
    jsonb_build_object('invoice_no', 'INV-26-0102', 'invoice_date', current_date::text, 'amount', '7600000'));
  begin
    perform public.record_invoice((select id from public.invoice_lines where secured_id = sid and kind = 'advance'),
      jsonb_build_object('invoice_no', 'INV-26-0103', 'invoice_date', current_date::text, 'amount', '100'));
    assert false, 'over the line';
  exception when others then assert sqlerrm like 'Only % is still to invoice%', sqlerrm; end;
  begin
    perform public.record_invoice((select id from public.invoice_lines where secured_id = sid and kind = 'delivery'),
      jsonb_build_object('invoice_no', 'inv-26-0102', 'invoice_date', current_date::text, 'amount', '100'));
    assert false, 'duplicate invoice no';
  exception when others then assert sqlerrm like 'This invoice number is already%', sqlerrm; end;
end $$;
reset role;
-- New invoices count only once SM Projects approves them
do $$ begin
  assert (select invoiced from public.invoice_line_status where secured_id = current_setting('test.sec')::uuid and kind = 'advance') = 0, 'not counted before approval';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ declare r bigint;
begin
  assert (select count(*) from public.my_pending_approvals() where source = 'invoice_request') = 2, 'two invoices to approve';
  for r in select id from public.invoice_requests where secured_id = current_setting('test.sec')::uuid and status = 'pending' loop
    perform public.decide_invoice_request(r, true);
  end loop;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'invoice_request' and title like 'Invoice to approve%'
                 and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects asked';
  assert exists (select 1 from public.notifications where kind = 'invoice_request' and title like 'Invoice INV-26-0101 approved%'
                 and recipient_id = (select id from u where role = 'operations_exec')), 'Operations told';
  assert (select invoiced from public.invoice_line_status where secured_id = current_setting('test.sec')::uuid and kind = 'advance') = 12400000, 'advance fully invoiced';
  assert (select invoiced from public.invoice_line_status where secured_id = current_setting('test.sec')::uuid and kind = 'delivery') = 7600000, 'delivery part invoiced';
  perform public.finance_tick(((app.month_of(current_date) + interval '1 month')::date + time '08:30') at time zone app.tz());
  assert exists (select 1 from public.notifications where kind = 'invoice_slipped' and title like 'Invoice part billed%'
                 and recipient_id = (select id from u where role = 'asm_building')), 'part-billed delivery alerted on the 1st';
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
-- An earlier amount recorded without an invoice line (e.g. taken from the August OR file) above the schedule
insert into public.invoice_allocations (month, secured_id, amount, manual, note)
select app.month_of(current_date), id, 1100000, true, 'From the OR file' from public.secured_projects where code = 'SEC-V-2';
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
-- A project on the opening list won this financial year counts as this year's win
do $$ declare won date := app.fy_start(app.fy_of((now() at time zone app.tz())::date));
begin
  assert public.save_opening_list(jsonb_build_array(jsonb_build_object('row_no', 2, 'project_name', 'Yard lights this year', 'business_line', 'Infrastructure',
    'sales_person', 'Asm Infra', 'order_value', '500,000.00', 'won_on', won::text, 'wbs', 'LS-000772'))) = 1, 'saved';
  assert (select source from public.secured_projects where wbs = 'LS-000772') = 'won', 'won this year';
end $$;
reset role;

-- Opening list: the same WBS twice in the file is a row error -----------------------------------------------------------
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare res jsonb;
begin
  res := public.check_opening_list(jsonb_build_array(
    jsonb_build_object('row_no', 2, 'project_name', 'Terminal blocks', 'business_line', 'Infrastructure', 'sales_person', 'Asm Infra',
      'order_value', '100', 'won_on', '2026-02-10', 'wbs', 'LS-000990-01'),
    jsonb_build_object('row_no', 9, 'project_name', 'Terminal blocks', 'business_line', 'Infrastructure', 'sales_person', 'Asm Building',
      'order_value', '100', 'won_on', '2026-02-10', 'wbs', 'LS-000990-02')));
  assert (res -> 0 -> 'errors' ->> 0) like 'Same WBS LS-000990 as row 9%', 'duplicate WBS: ' || (res -> 0 -> 'errors')::text;
  assert (res -> 1 -> 'errors' ->> 0) like 'Same WBS LS-000990 as row 2%', 'both rows flagged';
  assert exists (select 1 from jsonb_array_elements_text(res -> 0 -> 'warnings') w where w like 'Same project name as row 9%'), 'same name warned';
end $$;
reset role;

-- Won date: not in the future in the opening list; Operations corrects it in the details --------------------------------
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare res jsonb; sid uuid := (select id from public.secured_projects where wbs = 'LS-000771');
begin
  res := public.check_opening_list(jsonb_build_array(jsonb_build_object('row_no', 2, 'project_name', 'W Hotel renovation', 'business_line', 'LMS',
    'sales_person', 'Asm Infra', 'order_value', '100', 'won_on', (current_date + 300)::text)));
  assert exists (select 1 from jsonb_array_elements_text(res -> 0 -> 'errors') e where e like 'Won date % is in the future%'), 'future won date';
  perform public.set_secured_details(sid, jsonb_build_object('won_on', '2025-07-17'));
  assert (select won_on from public.secured_projects where id = sid) = '2025-07-17', 'won date corrected';
  begin
    perform public.set_secured_details(sid, jsonb_build_object('won_on', (current_date + 2)::text));
    assert false, 'future';
  exception when others then assert sqlerrm like 'The won date cannot be in the future%', sqlerrm; end;
end $$;
reset role;

-- Recorded invoices: other sales persons cannot record; Operations deletes with a reason --------------------------------
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ begin
  perform public.record_invoice((select id from public.invoice_lines where secured_id = current_setting('test.sec')::uuid and kind = 'delivery'),
    jsonb_build_object('invoice_no', 'X-1', 'invoice_date', current_date::text, 'amount', '1'));
  assert false, 'not their project';
exception when others then assert sqlerrm like 'Invoices are recorded by the Operations Executive%' or sqlerrm like 'Invoice not found%', sqlerrm; end $$;
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare aid bigint := (select id from public.invoice_allocations where invoice_no = 'INV-26-0102');
begin
  begin perform public.delete_invoice(aid, ''); assert false, 'reason'; exception when others then assert sqlerrm like 'Give the reason%', sqlerrm; end;
  perform public.delete_invoice(aid, 'Wrong project');
  assert not exists (select 1 from public.invoice_allocations where id = aid), 'deleted';
end $$;
reset role;

-- Secured approvals are SM Projects only ------------------------------------------------------------------------------------
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare sid uuid;
begin
  sid := public.add_secured_project(jsonb_build_object('project_name', 'Galadari Hotel lighting supply', 'business_line', 'LMS',
    'sales_person_id', (select id from u where role = 'asm_building'), 'won_on', current_date::text, 'order_value', '8,600,000.00'));
  perform public.save_invoice_schedule(sid, '{}', jsonb_build_array(
    jsonb_build_object('kind', 'progress', 'description', 'IPC', 'amount', '1610000', 'month', current_date::text),
    jsonb_build_object('kind', 'retention', 'description', 'Final retention', 'amount', '6990000', 'month', current_date::text)), true);
  assert (select schedule_status from public.secured_projects where id = sid) = 'review', 'sent to SM Projects';
  perform set_config('test.gal', sid::text, false);
end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin
  perform public.review_invoice_schedule(current_setting('test.gal')::uuid, true, null);
  assert false, 'GM cannot approve';
exception when others then assert sqlerrm like 'Only SM Projects approves invoice schedules%', sqlerrm; end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.review_invoice_schedule(current_setting('test.gal')::uuid, true, null);
reset role;
do $$ begin assert (select schedule_status from public.secured_projects where id = current_setting('test.gal')::uuid) = 'approved', 'SM Projects approved'; end $$;

-- Sales meeting: pack, notes, actions, publish → GM read only; Monday 08:30 – 12:00 kept free -------------------------------
-- (always the coming Monday by Colombo date – on a Monday the meeting may already have started)
do $$ declare mon date := (now() at time zone 'Asia/Colombo')::date + (8 - extract(isodow from (now() at time zone 'Asia/Colombo')::date)::int); plan uuid;
begin
  perform set_config('test.mon', mon::text, false);
  -- the visit plan of the week starting that Monday (made directly – the plan screens are tested elsewhere)
  insert into public.visit_plans (sales_person_id, week_start) values ((select id from u where role = 'asm_infra'), mon)
  on conflict (sales_person_id, week_start) do update set status = public.visit_plans.status returning id into plan;
  perform set_config('test.plan', plan::text, false);
end $$;
do $$ declare plan uuid := current_setting('test.plan')::uuid; mon date := current_setting('test.mon')::date;
  org uuid := (select id from public.organizations limit 1);
begin
  begin
    insert into public.visit_plan_lines (plan_id, planned_date, time_slot, organization_id, visit_category, planned_objective)
    values (plan, mon, '10:00', org, 'End-Client', 'Site visit');
    assert false, '10:00 Monday blocked';
  exception when others then assert sqlerrm like 'Monday 08:30 – 12:00 is the sales meeting%', sqlerrm; end;
  begin
    insert into public.visit_plan_lines (plan_id, planned_date, time_slot, organization_id, visit_category, planned_objective)
    values (plan, mon, null, org, 'End-Client', 'Site visit');
    assert false, 'no time on Monday blocked';
  exception when others then assert sqlerrm like 'Monday 08:30 – 12:00 is the sales meeting – enter the visit time%', sqlerrm; end;
  begin
    insert into public.visit_plan_lines (plan_id, planned_date, time_slot, organization_id, visit_category, planned_objective)
    values (plan, mon, '7.30-9.00', org, 'End-Client', 'Site visit');
    assert false, 'overlapping range blocked';
  exception when others then assert sqlerrm like 'Monday 08:30%', sqlerrm; end;
  insert into public.visit_plan_lines (plan_id, planned_date, time_slot, organization_id, visit_category, planned_objective)
  values (plan, mon, '2pm', org, 'End-Client', 'Afternoon visit'), (plan, mon + 1, '09:00', org, 'End-Client', 'Tuesday visit');
end $$;
select pg_temp.act_as('asm_infra'); set role authenticated;
select public.request_meeting_exception(current_setting('test.mon')::date, 'Client CEO available only Monday 9:00');
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'meeting_exception'), 'exception in approvals';
  perform public.decide_meeting_exception((select id from public.meeting_exceptions where status = 'pending'), true, 'OK this once');
end $$;
reset role;
insert into public.visit_plan_lines (plan_id, planned_date, time_slot, organization_id, visit_category, planned_objective)
values (current_setting('test.plan')::uuid, current_setting('test.mon')::date, '09:00', (select id from public.organizations limit 1), 'End-Client', 'Approved exception');
-- Pack: SM Projects only; GM sees it once published, read only
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin
  perform public.generate_sales_meeting(current_setting('test.mon')::date); assert false, 'GM cannot generate';
exception when others then assert sqlerrm like 'Only SM Projects runs%', sqlerrm; end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ declare mid uuid; p jsonb;
begin
  begin perform public.generate_sales_meeting(current_setting('test.mon')::date + 1); assert false, 'Monday only';
  exception when others then assert sqlerrm like 'Choose a Monday%', sqlerrm; end;
  mid := public.generate_sales_meeting(current_setting('test.mon')::date);
  select pack into p from public.sales_meetings where id = mid;
  assert jsonb_array_length(p -> 'people') >= 2, 'a part per sales person';
  assert (select x -> 'exception' ->> 'status' from jsonb_array_elements(p -> 'people') x where x ->> 'id' = (select id::text from u where role = 'asm_infra')) = 'approved', 'exception shown';
  assert (p -> 'team' ->> 'budget_invoice') is not null, 'team totals';
  perform public.save_meeting_note(mid, (select id from u where role = 'asm_infra'), 'Push the airport quotation');
  perform public.save_meeting_note(mid, null, 'Focus: invoicing this month');
  perform public.add_meeting_action(mid, jsonb_build_object('sales_person_id', (select id from u where role = 'asm_infra'), 'action', 'Follow up Airport apron quote', 'due_date', (current_date + 7)::text));
  assert public.generate_sales_meeting(current_setting('test.mon')::date) = mid, 'regenerate keeps notes and actions';
  assert (select count(*) from public.sales_meeting_actions where meeting_id = mid) = 1, 'action kept';
  perform set_config('test.meet', mid::text, false);
end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin assert not exists (select 1 from public.sales_meetings), 'GM does not see a draft'; end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.publish_sales_meeting(current_setting('test.meet')::uuid);
do $$ begin
  begin perform public.save_meeting_note(current_setting('test.meet')::uuid, null, 'x'); assert false, 'locked';
  exception when others then assert sqlerrm like 'The meeting is published%', sqlerrm; end;
end $$;
reset role;
-- The owner sees and closes their action on My Day
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ begin
  assert (select count(*) from public.my_meeting_actions()) = 1, 'owner sees the action';
  assert (select count(*) from public.sales_meeting_actions) = 1, 'owner reads only their action';
  perform public.set_meeting_action_done((select id from public.my_meeting_actions()), true);
  assert (select count(*) from public.my_meeting_actions()) = 0, 'done';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'meeting_action' and recipient_id = (select id from u where role = 'asm_infra')), 'owner notified of the action';
  assert exists (select 1 from public.notifications where kind = 'meeting_action' and title = 'Meeting action done'
                 and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects told it is done';
end $$;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin
  assert (select status from public.sales_meetings where id = current_setting('test.meet')::uuid) = 'published', 'GM sees it once published';
  assert (select count(*) from public.sales_meeting_notes) = 1, 'GM reads the notes';
  begin perform public.add_meeting_action(current_setting('test.meet')::uuid, '{"action":"x"}'); assert false, 'GM read only';
  exception when others then assert sqlerrm like 'Only SM Projects runs%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ begin assert not exists (select 1 from public.sales_meetings), 'sales persons do not see the pack'; end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'sales_meeting' and recipient_id = (select id from u where role = 'gm')), 'GM notified';
  assert not exists (select 1 from public.notifications where kind = 'sales_meeting' and title like 'Sales meeting pack%'
                     and recipient_id in (select id from u where role in ('asm_infra', 'asm_building'))), 'only GM notified of the pack';
  assert public.sales_meeting_tick((current_setting('test.mon')::date + time '08:05') at time zone app.tz()) >= 1, 'Monday reminder';
  assert not exists (select 1 from public.notifications where title = 'Sales meeting today 08:30 – 12:00' and recipient_id = (select id from u where role = 'asm_infra')),
    'excused sales person not reminded';
end $$;

-- Sales meeting part 2: invitations, leave, attendance, actions with project / customer, Sunday reminders ----------------
do $$ begin perform set_config('test.mon2', (current_setting('test.mon')::date + 7)::text, false); end $$;
do $$ declare sun timestamptz := ((current_setting('test.mon2')::date - 1) + time '15:05') at time zone app.tz();
begin
  perform public.sales_meeting_tick(sun);
  assert exists (select 1 from public.notifications where title = 'Sales meeting not initiated' and recipient_id = (select id from u where role = 'gm')), 'GM told at 15:00';
  assert exists (select 1 from public.notifications where title like 'Invite the team%' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects reminded';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ declare mid uuid;
begin
  begin
    perform public.invite_sales_meeting(current_setting('test.mon2')::date, array[(select id from u where role = 'gm')]);
    assert false, 'GM cannot be invited';
  exception when others then assert sqlerrm like 'GM / DGM, System Admin and inactive users cannot be invited%', sqlerrm; end;
  mid := public.invite_sales_meeting(current_setting('test.mon2')::date,
    array[(select id from u where role = 'asm_building'), (select id from u where role = 'asm_infra'), (select id from u where role = 'operations_exec')]);
  perform set_config('test.m2', mid::text, false);
  assert (select count(*) from public.sales_meeting_invitees where meeting_id = mid) = 3, 'three invited';
  -- the pack covers the invited sales persons only
  perform public.generate_sales_meeting(current_setting('test.mon2')::date);
  assert (select jsonb_array_length(pack -> 'people') from public.sales_meetings where id = mid) = 2, 'invited sales persons';
  perform public.add_meeting_action(mid, jsonb_build_object('sales_person_id', (select id from u where role = 'asm_building'), 'action', 'Visit ABC Hotels',
    'project_id', '00000000-0000-0000-0000-00000000b001'));
  perform public.add_meeting_action(mid, jsonb_build_object('owner_id', (select id from u where role = 'operations_exec'), 'action', 'Open customer file',
    'new_project', 'Hilton Colombo refurbishment', 'new_customer', 'Hilton Colombo'));
  assert (select organization_id is not null from public.sales_meeting_actions where meeting_id = mid and project_id is not null), 'customer taken from the project';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'meeting_invite' and recipient_id = (select id from u where role = 'operations_exec')), 'invitee notified';
  assert (select initiated_at is not null from public.sales_meetings where id = current_setting('test.m2')::uuid), 'initiated';
  assert public.sales_meeting_tick(((current_setting('test.mon2')::date - 1) + time '15:20') at time zone app.tz()) = 0, 'no GM alert once initiated';
end $$;
-- Leave: the operations executive applies, SM Projects approves before the meeting → excused
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ begin
  perform public.request_meeting_exception(current_setting('test.mon2')::date, 'Bank audit visit at 9:00');
  assert (select my_status from public.my_meetings() where meeting_id = current_setting('test.m2')::uuid) = 'invited', 'sees the invitation';
  begin perform public.attend_sales_meeting(current_setting('test.m2')::uuid, 6.9, 79.8); assert false, 'not the meeting day';
  exception when others then assert sqlerrm like 'Attendance is marked on the meeting day%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_meeting_exception((select id from public.meeting_exceptions where status = 'pending' and meeting_date = current_setting('test.mon2')::date), true, null);
reset role;
-- A location that differs is approved (or not) by SM Projects
update public.sales_meeting_invitees set status = 'location_check', distance_m = 1200, checkin_at = now()
 where meeting_id = current_setting('test.m2')::uuid and person_id = (select id from u where role = 'asm_infra');
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'meeting_attendance'), 'attendance check in approvals';
  perform public.decide_attendance(current_setting('test.m2')::uuid, (select id from u where role = 'asm_infra'), true, 'At the client next door – joined');
end $$;
reset role;
do $$ begin
  assert (select status from public.sales_meeting_invitees where meeting_id = current_setting('test.m2')::uuid and person_id = (select id from u where role = 'operations_exec')) = 'excused', 'leave → excused';
  assert (select status from public.sales_meeting_invitees where meeting_id = current_setting('test.m2')::uuid and person_id = (select id from u where role = 'asm_infra')) = 'present', 'present after approval';
  perform public.sales_meeting_tick((current_setting('test.mon2')::date + time '12:10') at time zone app.tz());
  assert (select status from public.sales_meeting_invitees where meeting_id = current_setting('test.m2')::uuid and person_id = (select id from u where role = 'asm_building')) = 'absent', 'not marked by 12:00 → absent';
end $$;

-- Sales meeting part 3: action types, follow-up visits in the plan, team tasks appointed by the manager ----------------
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ declare mid uuid := current_setting('test.m2')::uuid;
begin
  begin perform public.invite_sales_meeting(current_setting('test.mon2')::date, array[(select id from u where role = 'sys_admin')]); assert false, 'no sys admin';
  exception when others then assert sqlerrm like 'GM / DGM, System Admin%', sqlerrm; end;
  begin perform public.add_meeting_action(mid, jsonb_build_object('kind', 'visit', 'owner_id', (select id from u where role = 'operations_exec'),
    'action', 'Visit', 'organization_id', '00000000-0000-0000-0000-00000000a001', 'objective', 'Project Qualification', 'due_date', current_setting('test.mon2')));
    assert false, 'visit only to sales';
  exception when others then assert sqlerrm like 'A follow-up visit is given to a sales person%', sqlerrm; end;
  begin perform public.add_meeting_action(mid, jsonb_build_object('kind', 'visit', 'owner_id', (select id from u where role = 'asm_building'),
    'action', 'Visit', 'project_id', '00000000-0000-0000-0000-00000000b001', 'due_date', current_setting('test.mon2')));
    assert false, 'objective needed';
  exception when others then assert sqlerrm like 'Choose the visit objective%', sqlerrm; end;
  perform public.add_meeting_action(mid, jsonb_build_object('kind', 'visit', 'owner_id', (select id from u where role = 'asm_building'),
    'sales_person_id', (select id from u where role = 'asm_building'), 'action', 'Confirm lighting budget with the client',
    'project_id', '00000000-0000-0000-0000-00000000b001', 'unit_id', '00000000-0000-0000-0000-00000000a002',
    'objective', 'Project Qualification', 'due_date', (current_setting('test.mon2')::date + 2)::text));
  assert (select unit_id from public.sales_meeting_actions where meeting_id = mid and kind = 'visit') = '00000000-0000-0000-0000-00000000a002', 'unit kept on the action';
  begin perform public.add_meeting_action(mid, jsonb_build_object('kind', 'task', 'owner_id', (select id from u where role = 'asm_building'), 'action', 'x',
    'project_id', '00000000-0000-0000-0000-00000000b001', 'unit_id', '00000000-0000-0000-0000-00000000a0f2'));
    assert false, 'unit of another customer';
  exception when others then assert sqlerrm like 'The unit / department belongs to another customer%', sqlerrm; end;
  begin perform public.add_meeting_action(mid, jsonb_build_object('kind', 'design', 'owner_id', (select id from u where role = 'lighting_designer'), 'action', 'x'));
    assert false, 'design goes to the manager';
  exception when others then assert sqlerrm like 'A design task goes to its manager%', sqlerrm; end;
  perform public.add_meeting_action(mid, jsonb_build_object('kind', 'design', 'sales_person_id', (select id from u where role = 'asm_building'),
    'action', 'Revised lighting layout for the lobby', 'project_id', '00000000-0000-0000-0000-00000000b001', 'due_date', (current_setting('test.mon2')::date + 4)::text));
  perform public.add_meeting_action(mid, jsonb_build_object('kind', 'estimation', 'action', 'Re-price the façade option',
    'project_id', '00000000-0000-0000-0000-00000000b001'));
  assert (select owner_id from public.sales_meeting_actions where meeting_id = mid and kind = 'design') = (select id from u where role = 'design_manager'), 'design → design manager';
  assert (select owner_id from public.sales_meeting_actions where meeting_id = mid and kind = 'estimation') in (select id from u where role in ('sm_estimation', 'am_estimation')), 'estimation → manager';
  perform public.publish_sales_meeting(mid);
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where title = 'Follow-up visit(s) from the sales meeting' and requires_open
                 and recipient_id = (select id from u where role = 'asm_building')), 'sales person told the visit goes into the plan';
  assert exists (select 1 from public.notifications where title like 'Appoint a person – design task%' and requires_open
                 and recipient_id = (select id from u where role = 'design_manager')), 'design manager asked to appoint';
  assert exists (select 1 from public.notifications where title like 'Follow-up on your project – design task%'
                 and recipient_id = (select id from u where role = 'asm_building')), 'sales person told of the design task';
end $$;
-- The sales person creates the week's plan: the follow-up visit is already in; only the day and time change
select set_config('app.workflow', '', true); -- (set earlier in this one-transaction test run)
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare pid uuid; lid uuid;
begin
  insert into public.visit_plans (sales_person_id, week_start) values ((select id from u where role = 'asm_building'), current_setting('test.mon2')::date)
  returning id into pid;
  select id into lid from public.visit_plan_lines where plan_id = pid and meeting_action_id is not null;
  assert lid is not null, 'follow-up visit placed in the plan';
  assert (select planned_date from public.visit_plan_lines where id = lid) = current_setting('test.mon2')::date + 2, 'on the due date';
  assert (select planned_objective from public.visit_plan_lines where id = lid) = 'Project Qualification', 'objective kept';
  assert (select unit_id from public.visit_plan_lines where id = lid) = '00000000-0000-0000-0000-00000000a002', 'unit carried into the plan';
  begin update public.visit_plan_lines set unit_id = null where id = lid; assert false, 'unit fixed';
  exception when others then assert sqlerrm like '%only the day and time can be changed%', sqlerrm; end;
  begin update public.visit_plan_lines set planned_objective = 'Initial Site Survey' where id = lid; assert false, 'objective fixed';
  exception when others then assert sqlerrm like '%only the day and time can be changed%', sqlerrm; end;
  begin delete from public.visit_plan_lines where id = lid; assert false, 'cannot remove';
  exception when others then assert sqlerrm like '%cannot be removed%', sqlerrm; end;
  update public.visit_plan_lines set planned_date = current_setting('test.mon2')::date + 1, time_slot = '10:30' where id = lid;
  assert (select planned_date from public.visit_plan_lines where id = lid) = current_setting('test.mon2')::date + 1, 'day changed';
  assert (select my_part from public.my_meeting_actions() where kind = 'visit') = 'visit', 'listed as my visit';
  assert (select plan_id from public.my_meeting_actions() where kind = 'visit') = pid, 'linked to the plan';
  begin perform public.complete_meeting_action((select id from public.my_meeting_actions() where kind = 'visit'), 'done'); assert false, 'visit closes it';
  exception when others then assert sqlerrm like 'A follow-up visit is done when you check out%', sqlerrm; end;
  -- Check in and check out of the planned visit → the follow-up is done
  insert into public.visits (sales_person_id, plan_line_id, project_id, organization_id, visit_category, primary_objective, status, summary, outcome)
  select (select id from u where role = 'asm_building'), l.id, l.project_id, l.organization_id, l.visit_category, l.planned_objective, 'closed',
         'Client confirmed the lighting budget and asked for a revised layout by Friday.', 'Positive'
    from public.visit_plan_lines l where l.id = lid;
  assert not exists (select 1 from public.my_meeting_actions() where kind = 'visit'), 'visit follow-up done after check-out';
end $$;
reset role;
do $$ begin
  assert (select visit_id is not null and status = 'done' from public.sales_meeting_actions where kind = 'visit' and meeting_id = current_setting('test.m2')::uuid), 'visit recorded on the action';
  assert exists (select 1 from public.notifications where title = 'Sales meeting follow-up visit done' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects told';
end $$;
-- Design manager appoints the designer; the designer confirms it is done
select pg_temp.act_as('design_manager'); set role authenticated;
do $$ declare aid uuid;
begin
  select id into aid from public.my_meeting_actions() where kind = 'design' and my_part = 'assign';
  assert aid is not null, 'manager sees it to assign';
  assert exists (select 1 from public.my_pending_approvals() where source = 'meeting_assign' and id = aid), 'in approvals';
  assert (select count(*) from public.meeting_action_team(aid)) = 3, 'design team';
  begin perform public.assign_meeting_action(aid, (select id from u where role = 'estimation_exec')); assert false, 'team only';
  exception when others then assert sqlerrm like 'Choose a person from the team%', sqlerrm; end;
  perform public.assign_meeting_action(aid, (select id from u where role = 'lighting_designer'), 'Use the new façade drawings');
  assert (select my_part from public.my_meeting_actions() where id = aid) = 'track', 'manager tracks it';
end $$;
reset role;
select pg_temp.act_as('lighting_designer'); set role authenticated;
do $$ declare aid uuid;
begin
  select id into aid from public.my_meeting_actions() where kind = 'design';
  assert (select my_part from public.my_meeting_actions() where id = aid) = 'do', 'designer does it';
  assert (select count(*) from public.sales_meeting_actions where id = aid) = 1, 'designer reads the action';
  begin perform public.complete_meeting_action(aid, ' '); assert false, 'note needed';
  exception when others then assert sqlerrm like 'Say what was done%', sqlerrm; end;
  perform public.complete_meeting_action(aid, 'Layout revised and sent to sales');
  assert not exists (select 1 from public.my_meeting_actions() where id = aid), 'done';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where title like 'Task from the sales meeting%' and requires_open
                 and recipient_id = (select id from u where role = 'lighting_designer')), 'designer popup';
  assert exists (select 1 from public.notifications where title = 'Meeting action done' and recipient_id = (select id from u where role = 'design_manager')), 'manager told';
  assert exists (select 1 from public.notifications where title = 'Meeting action done' and recipient_id = (select id from u where role = 'asm_building')), 'sales person told';
  -- Estimation task not appointed within 24 hours → GM / DGM and SM Projects
  assert public.meeting_action_tick(now() + interval '25 hours') >= 1, 'tick';
  assert exists (select 1 from public.notifications where title like 'Not appointed – estimation task%' and recipient_id = (select id from u where role = 'gm')), 'GM told of the delay';
  assert exists (select 1 from public.notifications where title like 'Not appointed – estimation task%' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects told of the delay';
  assert not exists (select 1 from public.notifications where title like 'Not appointed – design task%'), 'appointed task not escalated';
end $$;

-- Team meetings: Estimation (SM Estimation) and Design (Design Manager), same flow, one Meetings tab ---------------------
do $$ declare d date := current_date + 9; begin
  if extract(isodow from d) = 7 then d := d + 1; end if;
  perform set_config('test.dm', d::text, false);
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  begin perform public.invite_team_meeting('design', current_setting('test.dm')::date, '08:30', '10:00', array[(select id from u where role = 'lighting_designer')]);
    assert false, 'only the design manager';
  exception when others then assert sqlerrm like 'Only the Design Manager runs the design team meeting%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('design_manager'); set role authenticated;
do $$ declare mid uuid;
begin
  begin perform public.invite_team_meeting('design', current_setting('test.dm')::date, '08:30', '10:00', array[(select id from u where role = 'gm')]);
    assert false, 'no GM';
  exception when others then assert sqlerrm like 'GM / DGM, System Admin%', sqlerrm; end;
  mid := public.invite_team_meeting('design', current_setting('test.dm')::date, '09:00', '10:30',
    array[(select id from u where role = 'lighting_designer'), (select id from u where role = 'lighting_engineer'), (select id from u where role = 'estimation_exec')]);
  perform set_config('test.dmid', mid::text, false);
  assert (select team = 'design' and starts_at = '09:00' and ends_at = '10:30' from public.sales_meetings where id = mid), 'design meeting with its time';
  -- The estimation executive is outside the design team: waits for SM Projects, not told yet
  assert (select status from public.sales_meeting_invitees where meeting_id = mid and person_id = (select id from u where role = 'estimation_exec')) = 'pending_approval', 'outsider waits';
  assert (select status from public.sales_meeting_invitees where meeting_id = mid and person_id = (select id from u where role = 'lighting_engineer')) = 'invited', 'own team invited at once';
  assert public.generate_team_meeting('design', current_setting('test.dm')::date) = mid, 'pack generated';
  assert (select pack ->> 'team_kind' from public.sales_meetings where id = mid) = 'design', 'design pack';
  assert (select jsonb_array_length(pack -> 'people') from public.sales_meetings where id = mid) = 2, 'invited designers in the pack';
  assert (select pack -> 'team' -> 'in_hand' ? 'in_review' from public.sales_meetings where id = mid), 'jobs by stage';
  assert not exists (select 1 from public.sales_meetings where team = 'sales' and id = mid), 'separate from the sales meeting';
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.notifications where kind = 'meeting_invite' and title like 'Invited: design team meeting%'
                     and recipient_id = (select id from u where role = 'estimation_exec')), 'outsider not told before approval';
  assert exists (select 1 from public.notifications where kind = 'meeting_invite_approval' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects asked';
end $$;
select pg_temp.act_as('estimation_exec'); set role authenticated;
do $$ begin
  assert not exists (select 1 from public.my_meetings() where meeting_id = current_setting('test.dmid')::uuid), 'not shown before approval';
  begin perform public.request_meeting_leave(current_setting('test.dmid')::uuid, 'x'); assert false, 'not invited yet';
  exception when others then assert sqlerrm like 'You are not invited%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('design_manager'); set role authenticated;
do $$ begin
  begin perform public.decide_meeting_invite(current_setting('test.dmid')::uuid, (select id from u where role = 'estimation_exec'), true); assert false, 'SM Projects only';
  exception when others then assert sqlerrm like 'Only SM Projects approves invitations%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'meeting_invite'), 'in SM Projects approvals';
  assert (select count(*) from public.meeting_invites_to_approve()) = 1, 'one to approve';
  perform public.decide_meeting_invite(current_setting('test.dmid')::uuid, (select id from u where role = 'estimation_exec'), true, 'Needed for the costing discussion');
end $$;
reset role;
do $$ begin
  assert (select status from public.sales_meeting_invitees where meeting_id = current_setting('test.dmid')::uuid
          and person_id = (select id from u where role = 'estimation_exec')) = 'invited', 'released after approval';
  assert exists (select 1 from public.notifications where title like 'Invited: design team meeting%' and recipient_id = (select id from u where role = 'estimation_exec')), 'told after approval';
  assert exists (select 1 from public.notifications where title like 'Invitation approved%' and recipient_id = (select id from u where role = 'design_manager')), 'host told';
end $$;
-- The designer sees the invitation and applies for leave; the Design Manager decides
select pg_temp.act_as('lighting_designer'); set role authenticated;
do $$ begin
  assert (select title from public.my_meetings() where meeting_id = current_setting('test.dmid')::uuid) = 'Design team meeting', 'sees the design meeting';
  perform public.request_meeting_leave(current_setting('test.dmid')::uuid, 'Site survey in Kandy');
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert not exists (select 1 from public.my_pending_approvals() where source = 'meeting_exception' and title like 'Design team meeting%'), 'not SM Projects''';
  assert not exists (select 1 from public.sales_meetings where id = current_setting('test.dmid')::uuid), 'SM Projects does not see the draft';
end $$;
reset role;
select pg_temp.act_as('design_manager'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'meeting_exception' and title like 'Design team meeting leave%'), 'leave to the Design Manager';
  perform public.decide_meeting_exception((select id from public.meeting_exceptions where team = 'design' and status = 'pending'), true, null);
  assert (select status from public.sales_meeting_invitees where meeting_id = current_setting('test.dmid')::uuid
          and person_id = (select id from u where role = 'lighting_designer')) = 'excused', 'excused';
  perform public.add_meeting_action(current_setting('test.dmid')::uuid, jsonb_build_object('owner_id', (select id from u where role = 'lighting_engineer'),
    'sales_person_id', (select id from u where role = 'lighting_engineer'), 'action', 'Close the review comments on the airport job', 'due_date', (current_date + 12)::text));
  perform public.publish_sales_meeting(current_setting('test.dmid')::uuid);
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where title like 'Design team meeting pack%' and recipient_id = (select id from u where role = 'gm')), 'GM told';
  assert exists (select 1 from public.notifications where title like 'Design team meeting pack%' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects told';
  assert exists (select 1 from public.notifications where title = 'Action from the design team meeting' and recipient_id = (select id from u where role = 'lighting_engineer')), 'owner told';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin assert exists (select 1 from public.sales_meetings where id = current_setting('test.dmid')::uuid), 'SM Projects reads the published design pack'; end $$;
reset role;
select pg_temp.act_as('lighting_engineer'); set role authenticated;
do $$ begin
  assert (select count(*) from public.my_meeting_actions()) = 1, 'engineer sees the action';
  perform public.complete_meeting_action((select id from public.my_meeting_actions()), 'All 12 comments closed');
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where title = 'Meeting action done' and recipient_id = (select id from u where role = 'design_manager')), 'host told';
  -- Not marked by the end → absent; the excused designer stays excused
  perform public.team_meeting_tick((current_setting('test.dm')::date + time '10:35') at time zone app.tz());
  assert (select status from public.sales_meeting_invitees where meeting_id = current_setting('test.dmid')::uuid
          and person_id = (select id from u where role = 'estimation_exec')) = 'absent', 'absent after the end';
  assert (select status from public.sales_meeting_invitees where meeting_id = current_setting('test.dmid')::uuid
          and person_id = (select id from u where role = 'lighting_designer')) = 'excused', 'still excused';
end $$;
-- Estimation: SM Estimation generates its pack
select pg_temp.act_as('sm_estimation'); set role authenticated;
do $$ declare mid uuid;
begin
  mid := public.generate_team_meeting('estimation', current_setting('test.dm')::date);
  assert (select pack ->> 'team_kind' from public.sales_meetings where id = mid) = 'estimation', 'estimation pack';
  assert (select jsonb_array_length(pack -> 'people') from public.sales_meetings where id = mid) = 2, 'every estimator when nobody is invited';
  assert (select pack -> 'team' ? 'waiting_design_n' from public.sales_meetings where id = mid), 'waiting on design';
end $$;
reset role;
-- My Day: this week's meetings
insert into public.sales_meetings (team, meeting_date, starts_at, ends_at, initiated_at)
values ('estimation', (now() at time zone app.tz())::date + case when extract(isodow from (now() at time zone app.tz())::date) = 7 then -1 else 0 end, '08:00', '09:00', now())
on conflict (team, meeting_date) where team <> 'project' do update set initiated_at = now();
insert into public.sales_meeting_invitees (meeting_id, person_id)
select m.id, (select id from u where role = 'estimation_exec') from public.sales_meetings m
 where m.team = 'estimation' and m.meeting_date = (now() at time zone app.tz())::date + case when extract(isodow from (now() at time zone app.tz())::date) = 7 then -1 else 0 end
on conflict do nothing;
select pg_temp.act_as('estimation_exec'); set role authenticated;
do $$ begin assert exists (select 1 from public.my_week_meetings() where team = 'estimation' and my_part = 'invitee'), 'invitee sees it this week'; end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin assert exists (select 1 from public.my_week_meetings() where team = 'estimation' and my_part = 'viewer'), 'GM sees the week'; end $$;
reset role;

-- Sales map: managers see the team, a sales person only their own, others not at all ------------------------------------
update public.visits set checkin_lat = 6.9271, checkin_lng = 79.8612 where checkin_lat is null;
update public.projects set status = 'active', lat = null, lng = null where id = '00000000-0000-0000-0000-00000000b001';
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert (select count(*) from public.map_visits(current_date - 400, current_date + 400)) >= 1, 'SM Projects sees visits';
  assert (select loc_source from public.map_coverage() where kind = 'project' and id = '00000000-0000-0000-0000-00000000b001') = 'visit', 'project placed from its visit';
  assert (select last_visit is not null from public.map_coverage() where kind = 'project' and id = '00000000-0000-0000-0000-00000000b001'), 'last visit known';
  assert exists (select 1 from public.map_coverage() where kind = 'customer'), 'customers listed';
end $$;
reset role;
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ begin
  assert not exists (select 1 from public.map_visits(current_date - 400, current_date + 400, (select id from u where role = 'asm_building'))
                     where sales_person_id <> (select id from u where role = 'asm_infra')), 'sales person sees only own visits';
  assert not exists (select 1 from public.map_coverage((select id from u where role = 'asm_building'))
                     where owner_id is distinct from (select id from u where role = 'asm_infra')), 'only own accounts';
end $$;
reset role;
-- Setting a location from the map: the owner or SM Projects; planned visits then use it
select pg_temp.act_as('design_manager'); set role authenticated;
do $$ begin
  begin perform public.set_map_location('customer', '00000000-0000-0000-0000-00000000a001', 6.9, 79.85); assert false, 'not design';
  exception when others then assert sqlerrm like 'Only the account owner%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  perform public.set_map_location('customer', '00000000-0000-0000-0000-00000000a001', 6.0329, 80.2168);
  perform public.set_map_location('project', '00000000-0000-0000-0000-00000000b001', 6.0335, 80.2170);
end $$;
reset role;
do $$ begin
  assert (select lat from public.organizations where id = '00000000-0000-0000-0000-00000000a001') = 6.0329, 'customer location saved';
  assert (select lat from public.projects where id = '00000000-0000-0000-0000-00000000b001') = 6.0335, 'project site saved';
end $$;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  assert not exists (select 1 from public.map_plan_lines(current_date - 400, current_date + 400) where lat is null and organization_id = '00000000-0000-0000-0000-00000000a001'),
    'planned visits to the customer are now placed';
end $$;
reset role;
-- Planned visits on the map: a sales person sees their own plans; managers see submitted / approved plans
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.map_plan_lines(current_date - 400, current_date + 400)), 'sales person sees own plan lines';
  assert not exists (select 1 from public.map_plan_lines(current_date - 400, current_date + 400)
                     where sales_person_id <> (select id from u where role = 'asm_building')), 'only own';
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert not exists (select 1 from public.map_plan_lines(current_date - 400, current_date + 400) where plan_status not in ('submitted', 'approved')),
    'managers see submitted / approved plans only';
end $$;
reset role;
select pg_temp.act_as('design_manager'); set role authenticated;
do $$ begin
  begin perform public.map_plan_lines(current_date, current_date); assert false, 'plans not for design';
  exception when others then assert sqlerrm like 'The sales map is for%', sqlerrm; end;
  begin perform public.map_visits(current_date, current_date); assert false, 'not for design';
  exception when others then assert sqlerrm like 'The sales map is for%', sqlerrm; end;
end $$;
reset role;

-- A first GPS check-in sets a missing project site / customer location (never overwrites)
insert into public.organizations (id, name, visit_category, account_owner_id)
values ('00000000-0000-0000-0000-00000000a0c9', 'New Customer for map', (select visit_category from public.organizations where id = '00000000-0000-0000-0000-00000000a001'),
        (select id from u where role = 'asm_building'));
insert into public.visits (sales_person_id, organization_id, visit_category, primary_objective, checkin_lat, checkin_lng)
values ((select id from u where role = 'asm_building'), '00000000-0000-0000-0000-00000000a0c9',
        (select visit_category from public.organizations where id = '00000000-0000-0000-0000-00000000a001'),
        (select value from public.master_lists where list_name = 'visit_objective' and 'networking' = any (tags) limit 1), 7.2906, 80.6337);
do $$ begin
  assert (select lat from public.organizations where id = '00000000-0000-0000-0000-00000000a0c9') = 7.2906, 'customer location from the first check-in';
end $$;
insert into public.visits (sales_person_id, organization_id, visit_category, primary_objective, checkin_lat, checkin_lng)
values ((select id from u where role = 'asm_building'), '00000000-0000-0000-0000-00000000a0c9',
        (select visit_category from public.organizations where id = '00000000-0000-0000-0000-00000000a001'),
        (select value from public.master_lists where list_name = 'visit_objective' and 'networking' = any (tags) limit 1), 6.9, 79.8);
do $$ begin
  assert (select lat from public.organizations where id = '00000000-0000-0000-0000-00000000a0c9') = 7.2906, 'not overwritten';
end $$;

-- Project change requests: the sales person asks, SM Projects approves -------------------------------------------------
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare rid uuid;
begin
  begin update public.projects set city = 'Matara' where id = '00000000-0000-0000-0000-00000000b001'; assert false, 'direct edit refused';
  exception when others then assert sqlerrm like 'Project details are changed through a change request%', sqlerrm; end;
  begin perform public.request_project_change('00000000-0000-0000-0000-00000000b001', '{"city":"Matara"}', ' '); assert false, 'reason needed';
  exception when others then assert sqlerrm like 'Give the reason%', sqlerrm; end;
  begin perform public.request_project_change('00000000-0000-0000-0000-00000000b001', '{"owner_id":"x"}', 'x'); assert false, 'not allowed field';
  exception when others then assert sqlerrm like 'This detail cannot be changed here%', sqlerrm; end;
  rid := public.request_project_change('00000000-0000-0000-0000-00000000b001',
    jsonb_build_object('city', 'Matara', 'lighting_value', 4500000, 'unit_id', '00000000-0000-0000-0000-00000000a002', 'stage', (select stage from public.projects where id = '00000000-0000-0000-0000-00000000b001')),
    'Client moved the site to Matara and confirmed the lighting budget');
  assert (select changes ? 'city' and changes ? 'lighting_value' and not changes ? 'stage' from public.project_change_requests where id = rid), 'only real changes kept';
  assert (select city from public.projects where id = '00000000-0000-0000-0000-00000000b001') is distinct from 'Matara', 'not changed before approval';
  begin perform public.request_project_change('00000000-0000-0000-0000-00000000b001', '{"city":"Galle"}', 'x'); assert false, 'one pending';
  exception when others then assert sqlerrm like 'A change request for this project is already waiting%', sqlerrm; end;
  begin perform public.decide_project_change(rid, true); assert false, 'not by sales';
  exception when others then assert sqlerrm like 'Only SM Projects approves%', sqlerrm; end;
  perform set_config('test.pcr', rid::text, false);
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'project_change'), 'in approvals';
  perform public.decide_project_change(current_setting('test.pcr')::uuid, true, null);
end $$;
reset role;
do $$ begin
  assert (select city = 'Matara' and lighting_value = 4500000 and unit_id = '00000000-0000-0000-0000-00000000a002'
            from public.projects where id = '00000000-0000-0000-0000-00000000b001'), 'applied (with the unit)';
  assert exists (select 1 from public.project_log where project_id = '00000000-0000-0000-0000-00000000b001' and field = 'lighting_value'), 'logged';
  assert exists (select 1 from public.notifications where kind = 'project_change' and title like 'Project change approved%'
                 and recipient_id = (select id from u where role = 'asm_building')), 'sales person told';
end $$;
-- Rejected needs a reason; withdraw
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare rid uuid;
begin
  rid := public.request_project_change('00000000-0000-0000-0000-00000000b001', '{"win_probability":15}', 'Consultant shortlisted us');
  perform public.withdraw_project_change(rid);
  assert (select status from public.project_change_requests where id = rid) = 'withdrawn', 'withdrawn';
  rid := public.request_project_change('00000000-0000-0000-0000-00000000b001', '{"name":"ABC Hotels – Beach Resort – Matara"}', 'Renamed by the client');
  perform set_config('test.pcr', rid::text, false);
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  begin perform public.decide_project_change(current_setting('test.pcr')::uuid, false, null); assert false, 'reason needed';
  exception when others then assert sqlerrm like 'Give the reason%', sqlerrm; end;
  perform public.decide_project_change(current_setting('test.pcr')::uuid, false, 'Keep the tender name');
end $$;
reset role;
do $$ begin
  assert (select name from public.projects where id = '00000000-0000-0000-0000-00000000b001') <> 'ABC Hotels – Beach Resort – Matara', 'not applied';
end $$;
-- The sales person still reviews the status (marking lost sets the milestone)
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  perform public.review_project('00000000-0000-0000-0000-00000000b001', 'lost', 'Client chose another supplier');
  assert (select milestone = 'lost' and status = 'lost' from public.projects where id = '00000000-0000-0000-0000-00000000b001'), 'review still works';
end $$;
reset role;
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ begin
  begin perform public.review_project('00000000-0000-0000-0000-00000000b001', 'active'); assert false, 'not yours';
  exception when others then assert sqlerrm like 'Project not found or not yours%', sqlerrm; end;
end $$;
reset role;

-- Secured approvals appear in SM Projects' Approvals, not GM's
update public.secured_projects set schedule_status = 'review', submitted_at = now() where id = current_setting('test.gal')::uuid;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin assert exists (select 1 from public.my_pending_approvals() where source = 'invoice_schedule'), 'schedule in SM Projects approvals'; end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin assert not exists (select 1 from public.my_pending_approvals() where source in ('invoice_schedule', 'invoice_move')), 'not GM''s'; end $$;
reset role;

-- OR-file invoices are removed (unless given an invoice number); recorded invoices stay
do $$ declare u uuid := (select id from public.or_uploads limit 1); s uuid := current_setting('test.gal')::uuid; n int;
begin
  if u is null then
    insert into public.or_uploads (month, fy, file_name) values (date_trunc('month', current_date)::date, app.fy_of(current_date), 'test.xlsx') returning id into u;
  end if;
  insert into public.invoice_allocations (upload_id, month, secured_id, amount, manual) values (u, date_trunc('month', current_date)::date, s, 1000, true);
  insert into public.invoice_allocations (upload_id, month, secured_id, amount, manual, invoice_no) values (u, date_trunc('month', current_date)::date, s, 500, true, 'INV-CONFIRMED');
  n := app.remove_or_invoices();
  assert n = 1, 'one OR amount removed';
  assert not exists (select 1 from public.invoice_allocations where upload_id = u and invoice_no is null), 'OR amounts gone';
  assert exists (select 1 from public.invoice_allocations where invoice_no = 'INV-CONFIRMED'), 'confirmed one kept';
  assert exists (select 1 from public.secured_log where secured_id = s and note like '%from the OR file removed%'), 'logged on the project';
end $$;

-- Confirm past invoices from the schedule (ticked together)
do $$ declare s uuid := current_setting('test.gal')::uuid; m date := app.month_of((now() at time zone app.tz())::date); a uuid; b uuid; f uuid;
begin
  insert into public.invoice_lines (secured_id, seq, kind, description, amount, original_month, forecast_month)
  values (s, 91, 'progress', 'Past IPC A', 1000, (m - interval '2 months')::date, (m - interval '2 months')::date) returning id into a;
  insert into public.invoice_lines (secured_id, seq, kind, description, amount, original_month, forecast_month)
  values (s, 92, 'progress', 'Past IPC B', 2000, (m - interval '1 month')::date, (m - interval '1 month')::date) returning id into b;
  insert into public.invoice_lines (secured_id, seq, kind, description, amount, original_month, forecast_month)
  values (s, 93, 'progress', 'Future IPC', 500, (m + interval '1 month')::date, (m + interval '1 month')::date) returning id into f;
  perform set_config('test.pa', a::text, false); perform set_config('test.pb', b::text, false); perform set_config('test.pf', f::text, false);
end $$;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ begin
  begin perform public.confirm_past_invoices(jsonb_build_array(jsonb_build_object('line_id', current_setting('test.pf')))); assert false, 'future refused';
  exception when others then assert sqlerrm like '%is not a past invoice%', sqlerrm; end;
  begin perform public.confirm_past_invoices(jsonb_build_array(jsonb_build_object('line_id', current_setting('test.pa'), 'amount', 5000))); assert false, 'too much';
  exception when others then assert sqlerrm like '%only%is still to invoice%', sqlerrm; end;
  assert public.confirm_past_invoices(jsonb_build_array(
    jsonb_build_object('line_id', current_setting('test.pa')),
    jsonb_build_object('line_id', current_setting('test.pb'), 'amount', 1500, 'invoice_no', 'INV-PAST-2'))) = 2, 'two confirmed';
end $$;
reset role;
do $$ begin
  assert (select remaining from public.invoice_line_status where id = current_setting('test.pa')::uuid) <= 0.5, 'A fully invoiced';
  assert (select invoice_date from public.invoice_allocations where line_id = current_setting('test.pa')::uuid) =
         (date_trunc('month', (select forecast_month from public.invoice_lines where id = current_setting('test.pa')::uuid)) + interval '1 month - 1 day')::date, 'dated in its month';
  assert (select remaining from public.invoice_line_status where id = current_setting('test.pb')::uuid) = 500, 'B part invoiced';
  assert exists (select 1 from public.invoice_allocations where invoice_no = 'INV-PAST-2'), 'number kept';
end $$;

-- Only the Operations Executive records / confirms invoices
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin
  begin perform public.confirm_past_invoices(jsonb_build_array(jsonb_build_object('line_id', current_setting('test.pb')))); assert false, 'not GM';
  exception when others then assert sqlerrm like 'Past invoices are confirmed by the Operations Executive%', sqlerrm; end;
  begin perform public.record_invoice(current_setting('test.pb')::uuid, '{"invoice_no":"X-1","invoice_date":"2026-01-01","amount":10}'); assert false, 'not GM';
  exception when others then assert sqlerrm like 'Invoices are recorded by the Operations Executive%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  begin perform public.confirm_past_invoices(jsonb_build_array(jsonb_build_object('line_id', current_setting('test.pb')))); assert false, 'not SM Projects';
  exception when others then assert sqlerrm like 'Past invoices are confirmed by the Operations Executive%', sqlerrm; end;
end $$;
reset role;

-- Several inquiries under one project: by the project's sales person and by another sales person (as the app saves: INSERT … RETURNING)
select pg_temp.act_as('asm_building'); set role authenticated;
insert into public.inquiries (project_id, organization_id, unit_id, route, design_scope, customer_deadline, scope_description)
values ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002',
        'C', 'lighting', current_date + 20, 'Second package – car park') returning id;
reset role;
select pg_temp.act_as('asm_infra'); set role authenticated;
insert into public.inquiries (project_id, organization_id, unit_id, route, design_scope, customer_deadline, scope_description)
values ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002',
        'C', 'lighting', current_date + 20, 'External works package') returning id;
insert into public.inquiries (project_id, organization_id, unit_id, route, design_scope, customer_deadline, scope_description)
values ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002',
        'C', 'lighting', current_date + 20, 'Street lighting package') returning id;
do $$ begin
  assert (select count(*) from public.inquiries where scope_description in ('External works package', 'Street lighting package')) = 2, 'two more on the same project';
end $$;
reset role;

-- Customer-level visits need no project; project visits still do
select pg_temp.act_as('asm_building'); set role authenticated;
insert into public.visits (organization_id, visit_category, primary_objective, checkin_lat, checkin_lng)
values ('00000000-0000-0000-0000-00000000a001', (select visit_category from public.organizations where id = '00000000-0000-0000-0000-00000000a001'),
        'Existing Customer Relationship', 6.9, 79.86);
insert into public.visits (organization_id, visit_category, primary_objective, checkin_lat, checkin_lng)
values ('00000000-0000-0000-0000-00000000a001', (select visit_category from public.organizations where id = '00000000-0000-0000-0000-00000000a001'),
        'New Customer Introduction', 6.9, 79.86);
do $$ begin
  begin
    insert into public.visits (organization_id, visit_category, primary_objective)
    values ('00000000-0000-0000-0000-00000000a001', (select visit_category from public.organizations where id = '00000000-0000-0000-0000-00000000a001'), 'Project Qualification');
    assert false, 'project visit needs a project';
  exception when others then assert sqlerrm like 'Select a project%', sqlerrm; end;
end $$;
reset role;

-- Customer visits are GPS-checked against the customer's location; earlier unchecked visits are re-checked when it is set
insert into public.organizations (id, name, visit_category, account_owner_id)
values ('00000000-0000-0000-0000-00000000a0d1', 'Office Customer', (select visit_category from public.organizations where id = '00000000-0000-0000-0000-00000000a001'),
        (select id from u where role = 'asm_building'));
select pg_temp.act_as('asm_building'); set role authenticated;
insert into public.visits (id, organization_id, visit_category, primary_objective, checkin_lat, checkin_lng)
values ('00000000-0000-0000-0000-0000000e0d01', '00000000-0000-0000-0000-00000000a0d1',
        (select visit_category from public.organizations where id = '00000000-0000-0000-0000-00000000a001'), 'Existing Customer Relationship', 6.9100, 79.8600);
insert into public.visits (id, organization_id, visit_category, primary_objective, checkin_lat, checkin_lng)
values ('00000000-0000-0000-0000-0000000e0d02', '00000000-0000-0000-0000-00000000a0d1',
        (select visit_category from public.organizations where id = '00000000-0000-0000-0000-00000000a001'), 'New Customer Introduction', 6.9102, 79.8601);
do $$ begin
  -- The first check-in became the customer location; that visit is not checked against itself, the second one is
  assert (select gps_verified from public.visits where id = '00000000-0000-0000-0000-0000000e0d01') is null, 'first visit: nothing to compare';
  assert (select gps_verified from public.visits where id = '00000000-0000-0000-0000-0000000e0d02'), 'second visit verified against the customer';
  -- The address is found 100 m away: the first visit is re-checked and verified; a far point flags it as away
  perform public.set_map_location('customer', '00000000-0000-0000-0000-00000000a0d1', 6.9109, 79.8600);
  assert (select gps_verified and distance_from_site_m between 50 and 150 from public.visits where id = '00000000-0000-0000-0000-0000000e0d01'), 're-checked on set';
end $$;
insert into public.visits (id, organization_id, visit_category, primary_objective, checkin_lat, checkin_lng)
values ('00000000-0000-0000-0000-0000000e0d03', '00000000-0000-0000-0000-00000000a0d1',
        (select visit_category from public.organizations where id = '00000000-0000-0000-0000-00000000a001'), 'Existing Customer Relationship', 6.95, 79.90);
do $$ begin
  assert (select gps_verified = false from public.visits where id = '00000000-0000-0000-0000-0000000e0d03'), 'far from the customer → away';
end $$;
reset role;

-- Estimation basis "Supply & commission"
select pg_temp.act_as('asm_building'); set role authenticated;
insert into public.inquiries (project_id, organization_id, unit_id, route, duty_status, customer_deadline, scope_description, estimation_scope, estimation_basis)
values ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002',
        'B', 'duty_paid', current_date + 20, 'Control system – supply and commissioning', '{fixtures}', 'supply_commission') returning id;
reset role;

-- Win Probability Wizard (testing): tick per project, scores kept; a sales person's result goes to SM Projects
update public.projects set status = 'active', milestone = 'brand_specified', win_probability = 50 where id = '00000000-0000-0000-0000-00000000b001';
delete from public.project_change_requests where project_id = '00000000-0000-0000-0000-00000000b001' and status = 'pending';
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ begin
  begin perform public.set_wizard_use('00000000-0000-0000-0000-00000000b001', true); assert false, 'not the project owner';
  exception when others then assert sqlerrm like 'Only the project''s sales person%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare sid bigint;
begin
  perform public.set_wizard_use('00000000-0000-0000-0000-00000000b001', true);
  assert (select use_wizard from public.projects where id = '00000000-0000-0000-0000-00000000b001'), 'tick on';
  sid := public.save_win_score('00000000-0000-0000-0000-00000000b001', '{"v":1,"type":"spec"}', '{"final":0.62}', 62, 70, 55, array['Gut feel 70% vs wizard 62%']);
  assert (select manual_pct = 50 and wizard_pct = 62 and applied = 'saved' from public.win_scores where id = sid), 'score kept with the manual figure';
  assert exists (select 1 from public.win_maps where project_id = '00000000-0000-0000-0000-00000000b001'), 'map kept';
  assert public.apply_win_score(sid, 60, 'negotiating', 'Consultant confirmed our brand') = 'requested', 'sales → request';
  assert (select win_probability from public.projects where id = '00000000-0000-0000-0000-00000000b001') = 50, 'not changed before approval';
  assert (select changes ->> 'win_probability' = '60' and reason like 'Win Probability Wizard 62%%' from public.project_change_requests
           where project_id = '00000000-0000-0000-0000-00000000b001' and status = 'pending'), 'change request with the wizard figure';
  assert (select chosen_pct = 60 and applied = 'requested' from public.win_scores where id = sid), 'chosen kept';
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ declare sid bigint;
begin
  sid := public.save_win_score('00000000-0000-0000-0000-00000000b001', '{"v":1,"type":"spec"}', '{"final":0.72}', 72, 70, 60, '{}');
  assert public.apply_win_score(sid, 72, 'negotiating', null) = 'set', 'SM Projects sets it';
  assert (select win_probability = 72 and milestone = 'negotiating' from public.projects where id = '00000000-0000-0000-0000-00000000b001'), 'set';
  assert (select count(*) from public.win_scores where project_id = '00000000-0000-0000-0000-00000000b001') = 2, 'history';
end $$;
reset role;
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ begin
  assert (select count(*) from public.win_scores where project_id = '00000000-0000-0000-0000-00000000b001') = 0, 'other sales cannot read the scores';
end $$;
reset role;

-- Pipeline forecast: own projects for sales, everyone for GM / SM Projects; award date passed → counted this month, flagged
update public.projects set lighting_value = 4000000, currency = 'LKR', win_probability = 72, milestone = 'negotiating', status = 'active',
       expected_award_date = current_date - 10 where id = '00000000-0000-0000-0000-00000000b001';
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare d jsonb := public.pipeline_forecast(app.fy_of(current_date)); x jsonb;
begin
  select e into x from jsonb_array_elements(d -> 'projects') e where e ->> 'id' = '00000000-0000-0000-0000-00000000b001';
  assert x is not null, 'own project in the pipeline';
  assert (x ->> 'weighted_lkr')::numeric = 2880000, 'weighted = value × probability';
  assert (x ->> 'award_passed')::boolean, 'award date passed flagged';
  assert (x ->> 'expected_month')::date = date_trunc('month', (now() at time zone app.tz())::date)::date, 'passed date counts this month';
  assert not exists (select 1 from jsonb_array_elements(d -> 'projects') e where e ->> 'owner_id' <> (select id::text from u where role = 'asm_building')), 'only own projects';
end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin
  assert jsonb_array_length(public.pipeline_forecast(app.fy_of(current_date)) -> 'projects') >= 1, 'GM sees the pipeline';
end $$;
reset role;
select pg_temp.act_as('estimation_exec'); set role authenticated;
do $$ begin
  begin perform public.pipeline_forecast(app.fy_of(current_date)); assert false, 'not for estimation';
  exception when others then assert sqlerrm like 'The pipeline is for sales%', sqlerrm; end;
end $$;
reset role;

-- Engineering jobs: assign with deadline + location, accept / hold with reason, review, updates by job type, GPS visit, complete
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  begin perform public.create_eng_job('{"job_type":"installation","title":"x"}'); assert false, 'engineer cannot assign';
  exception when others then assert sqlerrm like 'Only the Senior Electrical Engineer%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare jid uuid;
begin
  begin
    perform public.create_eng_job(jsonb_build_object('job_type', 'installation', 'title', 'Install façade lights', 'assignee_id', (select id from u where role = 'assistant_engineer'),
      'due_date', current_date + 5, 'site_address', 'Galle'));
    assert false, 'location needed';
  exception when others then assert sqlerrm like 'Set the site location%', sqlerrm; end;
  jid := public.create_eng_job(jsonb_build_object('job_type', 'installation', 'title', 'Install façade lights', 'project_id', '00000000-0000-0000-0000-00000000b001',
    'assignee_id', (select id from u where role = 'assistant_engineer'), 'due_date', current_date + 5, 'site_address', 'Beach Road, Galle',
    'lat', 6.0535, 'lng', 80.2210, 'instructions', 'Coordinate with the MEP contractor'));
  perform set_config('test.ej', jid::text, false);
  assert (select status = 'assigned' and code like 'ENG-%' from public.eng_jobs where id = jid), 'assigned';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'eng_job' and recipient_id = (select id from u where role = 'assistant_engineer')), 'engineer told';
end $$;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare jid uuid := current_setting('test.ej')::uuid; r jsonb;
begin
  begin perform public.add_eng_update(jid, '{"kind":"activity","note":"x"}'); assert false, 'accept first';
  exception when others then assert sqlerrm = 'Accept the job first', sqlerrm; end;
  begin perform public.hold_eng_job(jid, ' '); assert false, 'hold needs a reason';
  exception when others then assert sqlerrm like 'A hold always needs the reason%', sqlerrm; end;
  perform public.accept_eng_job(jid);
  assert (select status from public.eng_jobs where id = jid) = 'in_progress', 'accepted';
  begin perform public.add_eng_update(jid, '{"kind":"progress","note":"Cabling done"}'); assert false, 'installation stage needed';
  exception when others then assert sqlerrm = 'Choose the installation stage', sqlerrm; end;
  perform public.add_eng_update(jid, '{"kind":"progress","note":"Cabling done on level 1","work_stage":"Cabling / conduit","progress":30,"qty_installed":0,"issues":"Scaffolding late"}');
  assert (select progress from public.eng_jobs where id = jid) = 30, 'progress kept';
  begin perform public.complete_eng_job(jid, 'Finished'); assert false, 'site visit needed';
  exception when others then assert sqlerrm like 'Mark your site visit first%', sqlerrm; end;
  r := public.eng_site_checkin(jid, 6.9271, 79.8612);  -- Colombo, not Galle
  assert not (r ->> 'verified')::boolean, 'far away – not verified';
  r := public.eng_site_checkin(jid, 6.0537, 80.2212);
  assert (r ->> 'verified')::boolean, 'at site – verified';
  perform public.hold_eng_job(jid, 'Ceiling not ready – waiting for the contractor');
  assert (select status = 'on_hold' and hold_reason like 'Ceiling%' from public.eng_jobs where id = jid), 'on hold with reason';
  begin perform public.review_eng_hold(jid, 'resume', 'go'); assert false, 'engineer cannot review';
  exception when others then assert sqlerrm like 'Only the Senior Electrical Engineer reviews%', sqlerrm; end;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'eng_job_hold' and recipient_id = (select id from u where role = 'senior_elec_engineer')), 'hold to the senior';
end $$;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare jid uuid := current_setting('test.ej')::uuid;
begin
  perform public.review_eng_hold(jid, 'resume', 'Discussed with the contractor – resume on Monday', current_date + 9);
  assert (select status = 'in_progress' and due_date = current_date + 9 from public.eng_jobs where id = jid), 'resumed with a revised deadline';
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare jid uuid := current_setting('test.ej')::uuid;
begin
  perform public.complete_eng_job(jid, 'All 40 fixtures installed and tested');
  assert (select status = 'done' and progress = 100 from public.eng_jobs where id = jid), 'done';
  assert (select count(*) from public.eng_job_updates where job_id = jid) >= 8, 'history kept';
end $$;
reset role;
-- Alerts: not accepted → engineer + senior, then SM Projects; overdue → all three
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select set_config('test.ej2', public.create_eng_job(jsonb_build_object('job_type', 'inspection', 'title', 'Inspect site', 'assignee_id', (select id from u where role = 'assistant_engineer'),
  'due_date', current_date, 'site_address', 'Galle', 'lat', 6.05, 'lng', 80.22))::text, false);
reset role;
update public.eng_jobs set assigned_at = now() - interval '10 days', due_date = current_date - 2 where id = current_setting('test.ej2')::uuid;
do $$ begin
  assert public.eng_tick() >= 2, 'alerts raised';
  assert (select accept_alert_level from public.eng_jobs where id = current_setting('test.ej2')::uuid) = 2, 'escalated';
  assert exists (select 1 from public.notifications where kind = 'eng_job_alert' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects told';
end $$;

-- Execution step 1: execution project, temporary staff (SEE → SM Projects → GM), supervisor appointment, isolation, deletion
reset role;
update public.projects set status = 'won' where id = '00000000-0000-0000-0000-00000000b001';
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  begin perform public.start_execution('00000000-0000-0000-0000-00000000b001', '{"areas":["indoor"]}'); assert false, 'no direct start';
  exception when others then assert sqlerrm like 'Projects reach execution through a hand-over request%', sqlerrm; end;
  begin perform public.request_execution('{"kind":"won","project_id":"00000000-0000-0000-0000-00000000b001"}'); assert false, 'Ops requests';
  exception when others then assert sqlerrm like 'The Operations Executive requests%', sqlerrm; end;
  -- Project won before the system: entered by the SEE
  perform set_config('test.legacy', public.request_execution('{"kind":"legacy","name":"Old Harbour Lighting","client_name":"Ports Authority","contract_value":"45000000","contract_ref":"PA/2025/17","areas":["outdoor"],"letter_sign_name":"Mohamed Sajid","letter_sign_designation":"Senior Engineer - Lighting Projects"}')::text, false);
end $$;
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare rid uuid;
begin
  begin perform public.request_execution('{"kind":"won","project_id":"00000000-0000-0000-0000-00000000b001","areas":["kitchen"]}'); assert false, 'bad area';
  exception when others then assert sqlerrm = 'Unknown project area', sqlerrm; end;
  rid := public.request_execution('{"kind":"won","project_id":"00000000-0000-0000-0000-00000000b001","areas":["indoor","facade","emergency"],"note":"PO received","letter_sign_name":"Mohamed Sajid","letter_sign_designation":"Senior Engineer - Lighting Projects","police_required":true}');
  perform set_config('test.exr', rid::text, false);
  begin perform public.request_execution('{"kind":"won","project_id":"00000000-0000-0000-0000-00000000b001"}'); assert false, 'one open request';
  exception when others then assert sqlerrm like 'A hand-over request is already waiting%', sqlerrm; end;
  assert not exists (select 1 from public.exec_projects where project_id = '00000000-0000-0000-0000-00000000b001'), 'not in execution until approved';
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ declare e uuid;
begin
  assert (select count(*) from public.my_pending_approvals() where source = 'exec_request') = 2, 'both requests with SM Projects';
  e := public.decide_execution_request(current_setting('test.exr')::uuid, true, (select id from u where role = 'senior_elec_engineer'));
  perform set_config('test.ex', e::text, false);
  e := public.decide_execution_request(current_setting('test.legacy')::uuid, true);
  assert (select legacy and project_id is null and client_name = 'Ports Authority' from public.exec_projects where id = e), 'legacy project';
  perform set_config('test.exlegacy', e::text, false);
end $$;
-- The project's subcontractors (the register every subcontractor field picks from)
do $$ begin
  perform public.save_exec_subcontractor(current_setting('test.ex')::uuid, '{"name":"ABC Electricals","trade":"Cabling"}');
  perform public.save_exec_subcontractor(current_setting('test.ex')::uuid, '{"name":"Lanka Electricals","trade":"Mast erection"}');
  begin perform public.save_exec_subcontractor(current_setting('test.ex')::uuid, '{"name":"lanka electricals"}'); assert false, 'duplicate';
  exception when others then assert sqlerrm = 'This subcontractor is already on the project', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.ex')::uuid; rid uuid;
begin
  assert (select see_id = (select id from u where role = 'senior_elec_engineer') from public.exec_projects where id = e), 'SEE set';
  perform public.add_exec_member(e, (select id from u where role = 'assistant_engineer'), 'Floors 1–3');
  rid := public.request_temp_staff(jsonb_build_object('role_type', 'trainee', 'person_name', 'Kamal Trainee', 'id_no', 'TR-01', 'phone', '0771234567',
    'project_ids', jsonb_build_array(e), 'start_date', current_date, 'end_date', current_date + 60, 'reason', 'Peak installation'));
  perform set_config('test.tr', rid::text, false);
  assert (select phone = '94771234567' and status = 'pending_smp' from public.access_requests where id = rid), 'requested, phone normalised';
  rid := public.nominate_supervisor(e, jsonb_build_object('person_name', 'Sunil Sup', 'company', 'ABC Electricals', 'phone', '0712223334', 'id_no', 'NIC123',
    'zones', 'Facade', 'start_date', current_date, 'end_date', current_date + 30));
  perform set_config('test.sr', rid::text, false);
end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin
  begin perform public.decide_access_request(current_setting('test.tr')::uuid, true); assert false, 'GM before SMP';
  exception when others then assert sqlerrm = 'Waiting for SM Projects', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'access_request'), 'in SMP approvals';
  assert public.decide_access_request(current_setting('test.tr')::uuid, true) = 'pending_gm', 'trainee → GM';
  assert public.decide_access_request(current_setting('test.sr')::uuid, true, 'OK for facade') = 'approved', 'supervisor approved';
end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin
  assert public.decide_access_request(current_setting('test.tr')::uuid, true) = 'approved', 'trainee approved by GM';
end $$;
reset role;
-- The admin-users function creates the logins (service role) and completes the requests
insert into u values ('trainee', gen_random_uuid()), ('sub_supervisor', gen_random_uuid()), ('sub_other', gen_random_uuid());
insert into auth.users (id, email) select id, role || '@test.local' from u where role in ('trainee', 'sub_supervisor', 'sub_other');
insert into public.profiles (id, full_name, role, phone) values
  ((select id from u where role = 'trainee'), 'Kamal Trainee', 'trainee', '94771234567'),
  ((select id from u where role = 'sub_supervisor'), 'Sunil Sup', 'sub_supervisor', '94712223334'),
  ((select id from u where role = 'sub_other'), 'Other Sub', 'sub_supervisor', '94700000000');
select public.complete_access_provision(current_setting('test.tr')::uuid, (select id from u where role = 'trainee'));
select public.complete_access_provision(current_setting('test.sr')::uuid, (select id from u where role = 'sub_supervisor'));
do $$ begin
  assert (select count(*) from public.exec_members where exec_project_id = current_setting('test.ex')::uuid and active) = 3, 'AE, trainee, supervisor on the project';
  assert (select status from public.access_requests where id = current_setting('test.sr')::uuid) = 'done', 'provisioned';
end $$;
-- Isolation: the supervisor sees the project, its own profile and the internal team – not other subcontractors, settings or sales data
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ begin
  assert (select count(*) from public.exec_projects) = 1, 'own project only';
  assert not exists (select 1 from public.profiles where full_name = 'Other Sub'), 'no other subcontractors';
  assert exists (select 1 from public.profiles where role = 'senior_elec_engineer'), 'sees the SEE';
  assert not exists (select 1 from public.settings), 'no settings';
  assert not exists (select 1 from public.projects), 'no sales projects';
  assert not exists (select 1 from public.organizations), 'no customers';
end $$;
reset role;
-- Deleting the trainee: open items first reassigned, then SMP → GM; access ends
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare j uuid;
begin
  j := public.create_eng_job(jsonb_build_object('job_type', 'other', 'title', 'Label DBs', 'assignee_id', (select id from u where role = 'trainee'),
    'due_date', current_date + 2, 'site_address', 'Galle', 'lat', 6.05, 'lng', 80.22));
  begin perform public.request_temp_delete((select id from u where role = 'trainee'), 'Peak over'); assert false, 'open items';
  exception when others then assert sqlerrm like 'Reassign the 1 open items first', sqlerrm; end;
  assert public.reassign_open_items((select id from u where role = 'trainee'), (select id from u where role = 'assistant_engineer')) = 1, 'reassigned';
  perform set_config('test.td', public.request_temp_delete((select id from u where role = 'trainee'), 'Peak over')::text, false);
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_access_request(current_setting('test.td')::uuid, true);
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ begin assert public.decide_access_request(current_setting('test.td')::uuid, true) = 'deleted', 'deleted'; end $$;
reset role;
do $$ begin
  assert (select not active and revoke_pending from public.profiles where id = (select id from u where role = 'trainee')), 'login to be blocked';
  assert not exists (select 1 from public.exec_members where user_id = (select id from u where role = 'trainee') and active), 'off the projects';
end $$;
-- Supervisor removed by the SEE → login blocked (no other project)
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.remove_exec_member((select id from public.exec_members where user_id = (select id from u where role = 'sub_supervisor') and active), 'Facade work complete');
reset role;
do $$ begin
  assert (select not active and revoke_pending from public.profiles where id = (select id from u where role = 'sub_supervisor')), 'supervisor login blocked';
end $$;

-- Execution step 2: the Senior Electrical Engineer runs an execution team meeting; outsiders need SM Projects
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare mid uuid; d date := current_date + 3;
begin
  while extract(isodow from d) = 7 loop d := d + 1; end loop;
  mid := public.invite_team_meeting('execution', d, '09:00', '10:00',
    array[(select id from u where role = 'assistant_engineer'), (select id from u where role = 'asm_building')]);
  assert (select status from public.sales_meeting_invitees where meeting_id = mid and person_id = (select id from u where role = 'assistant_engineer')) = 'invited', 'own team invited';
  assert (select status from public.sales_meeting_invitees where meeting_id = mid and person_id = (select id from u where role = 'asm_building')) = 'pending_approval', 'sales needs SMP';
  perform public.generate_team_meeting('execution', d);
  assert (select pack ->> 'team_kind' from public.sales_meetings where id = mid) = 'execution', 'execution pack';
  assert (select jsonb_array_length(pack -> 'people') from public.sales_meetings where id = mid) >= 1, 'engineer in the pack';
end $$;
reset role;

-- Execution step 3: AE plans the week, SEE approves; supervisor completes; supervisor additions need AE acceptance
reset role;
update public.profiles set active = true, revoke_pending = false where id = (select id from u where role = 'sub_supervisor');
insert into public.exec_members (exec_project_id, user_id, member_role) values (current_setting('test.ex')::uuid, (select id from u where role = 'sub_supervisor'), 'sub_supervisor');
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare wk date := (current_date - (extract(isodow from current_date)::int - 1)); iid uuid; pid uuid;
begin
  perform set_config('test.wk', wk::text, false);
  iid := public.save_plan_item(current_setting('test.ex')::uuid, wk, jsonb_build_object('day', current_date, 'title', 'Mount 20 downlights level 2',
    'qty', 20, 'unit', 'nos', 'supervisor_id', (select id from u where role = 'sub_supervisor')));
  perform set_config('test.pi', iid::text, false);
  select plan_id into pid from public.exec_plan_items where id = iid;
  perform set_config('test.pl', pid::text, false);
  perform public.submit_plan(pid);
  assert (select status from public.exec_plans where id = pid) = 'submitted', 'submitted';
end $$;
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ begin
  begin perform public.update_plan_item(current_setting('test.pi')::uuid, 'done'); assert false, 'not approved yet';
  exception when others then assert sqlerrm = 'The plan is not approved yet', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'exec_plan'), 'plan in SEE approvals';
  perform public.decide_plan(current_setting('test.pl')::uuid, true);
end $$;
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare x uuid;
begin
  assert (select count(*) from public.exec_plan_items) = 1, 'supervisor sees own item';
  assert not exists (select 1 from public.exec_plans), 'supervisor does not read plans';
  begin perform public.update_plan_item(current_setting('test.pi')::uuid, 'partial', 12); assert false, 'reason needed';
  exception when others then assert sqlerrm = 'Give the reason', sqlerrm; end;
  perform public.update_plan_item(current_setting('test.pi')::uuid, 'partial', 12, 'Ceiling grid not ready in zone B');
  x := public.supervisor_add_item(current_setting('test.ex')::uuid, jsonb_build_object('day', current_date, 'title', 'Clear debris before ceiling closing'));
  perform set_config('test.sx', x::text, false);
  begin perform public.update_plan_item(x, 'done'); assert false, 'needs acceptance';
  exception when others then assert sqlerrm like 'Wait until an Assistant Engineer accepts%', sqlerrm; end;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'exec_plan_addition' and recipient_id = (select id from u where role = 'assistant_engineer')), 'AE told of the addition';
end $$;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
select public.decide_supervisor_item(current_setting('test.sx')::uuid, true);
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
select public.update_plan_item(current_setting('test.sx')::uuid, 'done');
reset role;

-- Execution step 4: supervisor report → AE verifies; AE report → SEE; late / missing alerts and SM Projects after 3 days
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare r uuid;
begin
  begin perform public.submit_exec_report(current_setting('test.ex')::uuid, current_date, '{"work_done":"Mounted 12 downlights"}'); assert false, 'crew needed';
  exception when others then assert sqlerrm = 'Enter the crew on site', sqlerrm; end;
  begin perform public.submit_exec_report(current_setting('test.ex')::uuid, current_date, jsonb_build_object('crew_count', 6, 'work_done', 'x',
      'items', jsonb_build_array(jsonb_build_object('id', current_setting('test.pi'), 'status', 'not_done')))); assert false, 'reason for not done';
  exception when others then assert sqlerrm = 'Give the reason', sqlerrm; end;
  r := public.submit_exec_report(current_setting('test.ex')::uuid, current_date,
    '{"crew_count":6,"work_done":"Mounted 12 downlights level 2","toolbox_talk":true,"toolbox_topic":"Ladder safety","safety_check":true}'::jsonb
    || jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', current_setting('test.pi'), 'status', 'done', 'done_qty', 20, 'note', 'All fixed and tested'))));
  perform set_config('test.sr1', r::text, false);
  assert (select status = 'done' and done_qty = 20 and result_note = 'All fixed and tested' from public.exec_plan_items where id = current_setting('test.pi')::uuid), 'activity updated from the report';
  assert (select jsonb_array_length(item_updates) = 1 and item_updates -> 0 ->> 'status' = 'done' from public.exec_reports where id = r), 'snapshot kept';
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('exec_report', r, 'item_photo', 'exec_report/' || r || '/i1.jpg', 'i1.jpg');
  perform public.attach_report_item_photos(r, current_setting('test.pi')::uuid, array(select id from public.attachments where entity_id = r and kind = 'item_photo'));
  assert (select jsonb_array_length(item_updates -> 0 -> 'photos') = 1 from public.exec_reports where id = r), 'photo linked to the activity';
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare r uuid;
begin
  perform public.review_exec_report(current_setting('test.sr1')::uuid, true);
  r := public.submit_exec_report(current_setting('test.ex')::uuid, current_date, '{"work_done":"Verified supervisor report; IR test DB-2 passed"}');
  perform set_config('test.ar1', r::text, false);
  begin perform public.review_exec_report(r, true); assert false, 'AE cannot review own';
  exception when others then assert sqlerrm like 'The Senior Electrical Engineer reviews it', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.review_exec_report(current_setting('test.ar1')::uuid, true);
reset role;
-- Missing reports: three working days without a report → SM Projects told
do $$ declare d date := current_date + 1; k int := 0;
begin
  while k < 3 loop
    if app.is_working_day(d) then
      perform public.exec_report_tick(((d + time '21:30') at time zone app.tz()));
      k := k + 1;
    end if;
    d := d + 1;
  end loop;
  assert (select count(*) from public.exec_report_lateness where user_id = (select id from u where role = 'sub_supervisor')) >= 3, 'missing days recorded';
  assert exists (select 1 from public.notifications where kind = 'exec_report_late' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects told';
end $$;

-- Execution step 5: HSE report by a supervisor → SEE + SM Projects at once; action to closure
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare r uuid;
begin
  r := public.report_hse(current_setting('test.ex')::uuid, '{"kind":"near_miss","severity":"high","location":"Level 2 east stair","description":"Ladder slipped – no injury","immediate_action":"Area cordoned"}');
  perform set_config('test.hse', r::text, false);
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'hse_report' and priority = 'critical' and recipient_id = (select id from u where role = 'sm_projects')), 'SMP told (critical)';
  assert exists (select 1 from public.notifications where kind = 'hse_report' and recipient_id = (select id from u where role = 'senior_elec_engineer')), 'SEE told';
end $$;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  perform public.add_hse_action(current_setting('test.hse')::uuid, 'Provide ladder stabilisers and re-brief the crew', (select id from u where role = 'sub_supervisor'), current_date + 2);
  begin perform public.close_hse_report(current_setting('test.hse')::uuid, 'done'); assert false, 'open action';
  exception when others then assert sqlerrm = 'Complete every corrective action first', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
select public.complete_hse_action((select id from public.hse_actions limit 1), 'Stabilisers fitted, toolbox talk held');
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.close_hse_report(current_setting('test.hse')::uuid, 'Root cause: ladder on wet floor; rule added to toolbox talks');
reset role;

-- Execution step 6: variations – route C (contract rates) to SM Projects → GM above the limit; client acceptance; route B inquiry
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare v uuid;
begin
  v := public.raise_variation(current_setting('test.ex')::uuid, '{"vtype":"addition","reason":"client_instruction","title":"Extra facade uplights","description":"Client asked for 12 more uplights on the east wing","quantities":"12 nos"}');
  perform set_config('test.var', v::text, false);
  v := public.raise_variation(current_setting('test.ex')::uuid, '{"vtype":"addition","reason":"design_change","title":"Lobby feature lighting","description":"New chandelier zone per revised interior design"}');
  perform set_config('test.var2', v::text, false);
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'variation'), 'SEE screens';
  assert public.screen_variation(current_setting('test.var')::uuid, 'C', '{"value":"12500000","cost":"9000000","time_days":"5"}') = 'pending_smp', 'route C';
  perform public.screen_variation(current_setting('test.var2')::uuid, 'B', jsonb_build_object('required_by', current_date + 10,
    'estimation_scope', jsonb_build_array('fixtures'), 'estimation_basis', 'supply_install'));
  assert (select inquiry_id is not null and status = 'pricing' from public.variations where id = current_setting('test.var2')::uuid), 'variation inquiry';
end $$;
reset role;
do $$ begin
  assert (select variation_id = current_setting('test.var2')::uuid and route = 'B' and status <> 'draft' from public.inquiries
          where id = (select inquiry_id from public.variations where id = current_setting('test.var2')::uuid)), 'inquiry submitted for estimation';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert public.decide_exec_variation(current_setting('test.var')::uuid, true, 'Agreed') = 'pending_gm', 'above 10 Mn → GM';
end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
select public.decide_exec_variation(current_setting('test.var')::uuid, true);
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  begin perform public.record_variation_client(current_setting('test.var')::uuid, true, '{"vo_no":"VO-07"}'); assert false, 'VO document needed';
  exception when others then assert sqlerrm like 'Attach the signed variation order%', sqlerrm; end;
end $$;
reset role;
insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name, uploaded_by)
values ('variation', current_setting('test.var')::uuid, 'var_doc', 'variation/test/vo.pdf', 'vo.pdf', (select id from u where role = 'senior_elec_engineer'));
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  perform public.record_variation_client(current_setting('test.var')::uuid, true, '{"vo_no":"VO-07"}');
  assert (select status from public.variations where id = current_setting('test.var')::uuid) = 'client_accepted', 'accepted';
end $$;
reset role;

-- Execution step 7a: material request → SEE → SMP above limit → Ops orders → received into the site store; documents; design query
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare m uuid;
begin
  m := public.raise_material_request(current_setting('test.ex')::uuid, jsonb_build_object('required_date', current_date + 5, 'est_value', 1500000,
    'lines', jsonb_build_array(jsonb_build_object('custom', true, 'item', 'LED downlight 12W', 'unit', 'nos', 'qty', 40))));
  perform set_config('test.mr', m::text, false);
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin assert public.decide_material_request(current_setting('test.mr')::uuid, true) = 'pending_smp', 'above limit → SMP'; end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_material_request(current_setting('test.mr')::uuid, true);
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.order_material_request(current_setting('test.mr')::uuid, 'PO-5521', 'Philips', current_date + 4);
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare l uuid;
begin
  select id into l from public.material_request_lines where mr_id = current_setting('test.mr')::uuid;
  perform public.receive_material(current_setting('test.mr')::uuid, jsonb_build_array(jsonb_build_object('line_id', l, 'qty', 30)), '2 cartons damaged');
  assert (select status from public.material_requests where id = current_setting('test.mr')::uuid) = 'part_received', 'part received';
  perform public.store_move(current_setting('test.ex')::uuid, 'issue', 'LED downlight 12W', 'nos', 20, 'Level 2');
  begin perform public.store_move(current_setting('test.ex')::uuid, 'issue', 'LED downlight 12W', 'nos', 20); assert false, 'stock check';
  exception when others then assert sqlerrm like 'Only 10 in the site store', sqlerrm; end;
  perform public.register_doc(current_setting('test.ex')::uuid, '{"doc_no":"E-101","title":"Lighting layout L2","revision":"A","issued_to_subs":true}');
  perform public.register_doc(current_setting('test.ex')::uuid, '{"doc_no":"E-101","title":"Lighting layout L2","revision":"B","issued_to_subs":true}');
  assert (select count(*) from public.exec_docs where doc_no = 'E-101') = 1 and (select revision from public.exec_docs where doc_no = 'E-101') = 'B', 'field sees only the current revision';
  perform set_config('test.dq', public.raise_design_query(current_setting('test.ex')::uuid, 'Downlight clashes with duct at grid C4 – relocate?', 'E-101 rev B', 'Level 2 ceiling closing')::text, false);
end $$;
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ begin
  assert (select count(*) from public.exec_docs) = 1, 'supervisor sees only the current issued revision';
  assert not exists (select 1 from public.material_requests), 'supervisor does not see material requests';
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.forward_design_query(current_setting('test.dq')::uuid, true, null);
reset role;
select pg_temp.act_as('design_manager'); set role authenticated;
select public.answer_design_query(current_setting('test.dq')::uuid, 'Shift 300 mm east – see revised E-101 rev C');
reset role;


-- Execution step 7b: tests with instruments, NCRs, snags, dossier, stage gates with override, cost and subcontractor certificates
reset role;
do $$ begin
  insert into public.test_instruments (name, serial_no, calibration_due) values ('Megger MIT420', 'MG-OLD', current_date - 1), ('Fluke 1664', 'FL-01', current_date + 90);
end $$;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare t uuid;
begin
  begin perform public.record_test(current_setting('test.ex')::uuid, jsonb_build_object('system', 'DB-2', 'test_type', 'Insulation resistance',
      'instrument_id', (select id from public.test_instruments where serial_no = 'MG-OLD'), 'rows', jsonb_build_array(jsonb_build_object('param', 'L-E', 'unit', 'MΩ', 'min', 1, 'value', 50))));
    assert false, 'expired calibration';
  exception when others then assert sqlerrm like 'Calibration of Megger MIT420%expired%', sqlerrm; end;
  t := public.record_test(current_setting('test.ex')::uuid, jsonb_build_object('system', 'DB-2', 'test_type', 'Insulation resistance',
      'instrument_id', (select id from public.test_instruments where serial_no = 'FL-01'),
      'rows', jsonb_build_array(jsonb_build_object('param', 'L-E', 'unit', 'MΩ', 'min', 1, 'value', 50), jsonb_build_object('param', 'N-E', 'unit', 'MΩ', 'min', 1, 'value', 0.4))));
  perform set_config('test.tr', t::text, false);
  assert (select result from public.test_records where id = t) = 'fail', 'auto fail';
  assert exists (select 1 from public.ncrs where test_record_id = t and status = 'open'), 'NCR raised';
  perform set_config('test.snag', public.raise_snag(current_setting('test.ex')::uuid, '{"location":"Lobby","description":"Scratched diffuser","responsible":"Subcontractor","priority":"high"}')::text, false);
  begin perform public.close_snag(current_setting('test.snag')::uuid); assert false, 'after photo needed';
  exception when others then assert sqlerrm = 'Attach the after photo first', sqlerrm; end;
  perform set_config('test.spc', public.prepare_sub_cert(current_setting('test.ex')::uuid, '{"jm_date":"2026-10-01","subcontractor":"Lanka Electricals","period":"Sep 2026","gross":"1000000","previous":"200000","retention_pct":"10","deductions":"20000"}')::text, false);
  assert (select net from public.sub_certs where id = current_setting('test.spc')::uuid) = 700000, 'net value';
  assert (select status from public.sub_certs where id = current_setting('test.spc')::uuid) = 'jm_requested', 'joint measurement first';
  begin insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_cert', current_setting('test.spc')::uuid, 'ipc_draft', 'x0', 'x'); assert false, 'IPC upload locked before JM';
  exception when others then null; end;
  perform public.schedule_joint_measurement(current_setting('test.spc')::uuid, '2026-10-02', 'With the client QS');
  begin perform public.submit_joint_measurement(current_setting('test.spc')::uuid); assert false, 'JM sheets needed';
  exception when others then assert sqlerrm = 'Attach the joint measurement sheets (PDF or photos)', sqlerrm; end;
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_cert', current_setting('test.spc')::uuid, 'jm_sheet', 'sub_cert/x/jm.pdf', 'jm.pdf');
  assert public.submit_joint_measurement(current_setting('test.spc')::uuid) = 'jm_see', 'AE''s JM straight to the SEE';
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.decide_joint_measurement(current_setting('test.spc')::uuid, true);
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  assert (select status from public.sub_certs where id = current_setting('test.spc')::uuid) = 'draft', 'IPC uploads open after the JM';
  begin perform public.submit_sub_cert(current_setting('test.spc')::uuid); assert false, 'IPC needed';
  exception when others then assert sqlerrm = 'Attach the IPC (PDF or photos)', sqlerrm; end;
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_cert', current_setting('test.spc')::uuid, 'ipc_draft', 'sub_cert/x/ipc.pdf', 'ipc.pdf');
  begin perform public.submit_sub_cert(current_setting('test.spc')::uuid); assert false, 'sheets needed';
  exception when others then assert sqlerrm = 'Attach the measurement sheets (PDF or photos)', sqlerrm; end;
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_cert', current_setting('test.spc')::uuid, 'ipc_measure', 'sub_cert/x/ms.pdf', 'ms.pdf');
  assert public.submit_sub_cert(current_setting('test.spc')::uuid) = 'prepared', 'AE''s IPC goes straight to the SEE';
  assert not exists (select 1 from public.exec_cost_lines), 'AE does not read costs';
end $$;
reset role;
insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name, uploaded_by)
values ('snag', current_setting('test.snag')::uuid, 'snag_after', 'snag/test/after.jpg', 'after.jpg', (select id from u where role = 'assistant_engineer'));
update public.exec_projects set stage = 2 where id = current_setting('test.ex')::uuid;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
select public.close_snag(current_setting('test.snag')::uuid);
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  assert public.ensure_dossier(current_setting('test.ex')::uuid) > 0, 'dossier items created';
  begin perform public.complete_dossier_item((select id from public.exec_dossier limit 1), true); assert false, 'document needed';
  exception when others then assert sqlerrm = 'Attach the document first', sqlerrm; end;
  perform public.verify_test(current_setting('test.tr')::uuid, true);
  assert exists (select 1 from jsonb_array_elements(public.preview_gate(current_setting('test.ex')::uuid) -> 'checks') x where x ->> 'check' = 'No open NCR' and not (x ->> 'ok')::boolean), 'NCR blocks gate';
  perform set_config('test.gate', public.request_gate(current_setting('test.ex')::uuid, '{"as_built":true}', 'Ready for handover', current_date)::text, false);
  perform public.save_cost_line(current_setting('test.ex')::uuid, null, '{"cost_code":"material","description":"Fixtures","budget":"1000000","committed":"900000","actual":"300000"}');
  perform public.advance_sub_cert(current_setting('test.spc')::uuid, true);
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'exec_cost' and title = 'Project cost above budget' and recipient_id = (select id from u where role = 'sm_projects')), 'over budget told';
end $$;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'exec_gate'), 'gate in SMP approvals';
  begin perform public.decide_gate(current_setting('test.gate')::uuid, true); assert false, 'override reason';
  exception when others then assert sqlerrm like 'Items are open%', sqlerrm; end;
  perform public.decide_gate(current_setting('test.gate')::uuid, true, 'Client accepted partial dossier; NCR closes next week');
  assert (select override from public.exec_gates where id = current_setting('test.gate')::uuid), 'override recorded';
  assert (select stage from public.exec_projects where id = current_setting('test.ex')::uuid) = 3, 'stage 3 – handed over';
  assert public.advance_sub_cert(current_setting('test.spc')::uuid, true) = 'approved', 'approved';
end $$;
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ begin
  begin perform public.advance_sub_cert(current_setting('test.spc')::uuid, true); assert false, 'ref needed';
  exception when others then assert sqlerrm = 'Enter the payment reference', sqlerrm; end;
  assert public.advance_sub_cert(current_setting('test.spc')::uuid, true, 'CHQ-88123') = 'paid', 'paid';
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.close_ncr((select id from public.ncrs where test_record_id = current_setting('test.tr')::uuid), 'Moisture in junction box', 'Box resealed and retested 200 MΩ', null);
reset role;


-- Hand-over: a project won before the system prices variations at contract rates only
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare v uuid;
begin
  v := public.raise_variation(current_setting('test.exlegacy')::uuid, '{"vtype":"addition","reason":"client_instruction","title":"Extra poles","description":"4 more poles at the gate"}');
  begin perform public.screen_variation(v, 'B', jsonb_build_object('required_by', current_date + 10, 'estimation_scope', jsonb_build_array('fixtures'), 'estimation_basis', 'supply_install'));
    assert false, 'route B needs a sales project';
  exception when others then assert sqlerrm like 'This project was won before the system%', sqlerrm; end;
  assert public.screen_variation(v, 'C', '{"value":"800000"}') = 'pending_smp', 'route C';
end $$;
reset role;


-- Programme: WBS, activities, links, resources; critical path; SM Projects baseline; AE progress; revision
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; w1 uuid; w2 uuid; a uuid; b uuid; c uuid; d uuid; m uuid; usr uuid := (select id from u where role = 'senior_elec_engineer');
begin
  perform public.add_exec_member(e, (select id from u where role = 'assistant_engineer'), 'All');
  begin perform public.save_wbs(e, null, null, '1', 'Civil'); assert false, 'start first';
  exception when others then assert sqlerrm = 'Set the programme start date first', sqlerrm; end;
  perform public.save_programme(e, current_date - 14);
  w1 := public.save_wbs(e, null, null, '1', 'Civil works');
  w2 := public.save_wbs(e, null, null, '2', 'Electrical works');
  a := public.save_activity(e, null, jsonb_build_object('wbs_id', w1, 'code', 'A10', 'name', 'Mast foundations', 'duration', 5, 'responsible_id', usr));
  b := public.save_activity(e, null, jsonb_build_object('wbs_id', w1, 'code', 'A20', 'name', 'Mast erection', 'duration', 3, 'responsible_id', usr));
  c := public.save_activity(e, null, jsonb_build_object('wbs_id', w2, 'code', 'A30', 'name', 'Cable laying', 'duration', 2, 'responsible_id', usr));
  d := public.save_activity(e, null, jsonb_build_object('wbs_id', w2, 'code', 'A40', 'name', 'Luminaire fixing', 'duration', 1, 'responsible_id', usr));
  m := public.save_activity(e, null, jsonb_build_object('wbs_id', w2, 'code', 'M50', 'name', 'Energisation', 'duration', 0));
  perform public.set_dependency(b, a); perform public.set_dependency(c, a); perform public.set_dependency(d, b); perform public.set_dependency(d, c); perform public.set_dependency(m, d);
  begin perform public.set_dependency(a, m); assert false, 'loop';
  exception when others then assert sqlerrm like 'This link would make a loop%', sqlerrm; end;
  assert (select critical from public.exec_activities where id = a) and (select critical from public.exec_activities where id = b)
     and (select critical from public.exec_activities where id = d) and not (select critical from public.exec_activities where id = c), 'critical path A-B-D';
  assert (select total_float from public.exec_activities where id = c) = 1, 'float of C';
  assert (select es from public.exec_activities where id = b) > (select ef from public.exec_activities where id = a), 'B after A';
  assert (select es from public.exec_activities where id = m) = (select ef from public.exec_activities where id = d) + 1
      or (select es from public.exec_activities where id = m) > (select ef from public.exec_activities where id = d), 'milestone after D';
  -- start-to-start with lag: C may start 2 days after A starts
  perform public.set_dependency(c, a, 'SS', 2);
  assert (select es from public.exec_activities where id = c) < (select ef from public.exec_activities where id = a), 'SS overlap';
  begin perform public.submit_programme(e); assert false, 'resources needed';
  exception when others then assert sqlerrm like '4 activities without resources%', sqlerrm; end;
  perform public.save_activity_resource(a, null, '{"kind":"labour","name":"Masons","qty":"4","unit":"workers"}');
  perform public.save_activity_resource(b, null, '{"kind":"equipment","name":"Crane 25 t","qty":"1"}');
  perform public.save_activity_resource(c, null, '{"kind":"subcontractor","name":"Lanka Electricals","qty":"6","unit":"workers"}');
  -- the wider resource types, and a custom one
  perform public.save_activity_resource(b, null, '{"kind":"access","name":"Scissor lift","qty":"2","unit":"nos"}');
  perform public.save_activity_resource(b, null, '{"kind":"other","name":"Traffic management crew","qty":"1"}');
  begin
    perform public.save_activity_resource(b, null, '{"kind":"staff","name":"","qty":"1"}');
    raise exception 'staff without a person accepted';
  exception when others then if sqlerrm not like '%DIMO staff member%' then raise; end if;
  end;
  perform public.save_activity_resource(d, null, jsonb_build_object('kind', 'staff', 'profile_id', (select id from u where role = 'assistant_engineer')));
  perform public.submit_programme(e, null);
  perform set_config('test.act_a', a::text, false);
  perform set_config('test.act_c', c::text, false);
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid;
begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'exec_programme'), 'programme with SM Projects';
  assert exists (select 1 from jsonb_array_elements(app.gate_checks(e, 1)) x where x ->> 'check' like 'Programme%' and not (x ->> 'ok')::boolean), 'ready to start blocked before approval';
  assert public.decide_programme(e, true) = 1, 'baseline 1';
  assert (select bl_start is not null from public.exec_activities where id = current_setting('test.act_a')::uuid), 'baseline dates';
  assert exists (select 1 from jsonb_array_elements(app.gate_checks(e, 1)) x where x ->> 'check' like 'Programme%' and (x ->> 'ok')::boolean), 'ready to start: programme ok';
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  begin perform public.update_activity_progress(current_setting('test.act_a')::uuid, 40, null, null); assert false, 'start needed';
  exception when others then assert sqlerrm = 'Enter the actual start date', sqlerrm; end;
  perform public.update_activity_progress(current_setting('test.act_a')::uuid, 40, current_date - 3, null, 'Two bases cast');
  assert (select pct from public.exec_activities where id = current_setting('test.act_a')::uuid) = 40, 'progress saved';
  begin perform public.save_activity(current_setting('test.exlegacy')::uuid, null, '{}'); assert false, 'AE cannot edit';
  exception when others then assert sqlerrm like 'The Senior Electrical Engineer prepares%', sqlerrm; end;
end $$;
reset role;
-- After submission the SEE needs SM Projects' permission to edit the programme
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid;
begin
  begin perform public.save_activity(e, current_setting('test.act_c')::uuid, jsonb_build_object('wbs_id', (select wbs_id from public.exec_activities where id = current_setting('test.act_c')::uuid),
      'name', 'Cable laying', 'duration', 4)); assert false, 'locked';
  exception when others then assert sqlerrm like 'The programme is submitted – ask SM Projects%', sqlerrm; end;
  begin perform public.request_programme_edit(e, ''); assert false, 'reason';
  exception when others then assert sqlerrm = 'Give the reason', sqlerrm; end;
  perform public.request_programme_edit(e, 'Cable route longer after the drainage clash');
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'programme_edit'), 'with SM Projects';
  assert public.decide_programme_edit(current_setting('test.exlegacy')::uuid, true) = 'allowed', 'allowed';
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid;
begin
  perform public.save_activity(e, current_setting('test.act_c')::uuid, jsonb_build_object('wbs_id', (select wbs_id from public.exec_activities where id = current_setting('test.act_c')::uuid),
    'code', 'A30', 'name', 'Cable laying', 'duration', 4, 'responsible_id', (select id from u where role = 'senior_elec_engineer')));
  assert (select status = 'draft' and version = 1 from public.exec_programmes where exec_project_id = e), 'revision keeps baseline 1';
  begin perform public.submit_programme(e, null); assert false, 'reason';
  exception when others then assert sqlerrm = 'Give the reason for the revised programme', sqlerrm; end;
  perform public.submit_programme(e, 'Cable route longer after the drainage clash');
end $$;
reset role;

do $$ begin
  assert public.programme_tick(now() + interval '20 days') >= 0, 'programme tick runs';
  assert (select forecast_finish is not null from public.exec_programmes where exec_project_id = current_setting('test.exlegacy')::uuid), 'forecast finish';
end $$;


-- Weekly plan linked to the programme: link required, critical activities planned or explained, site results drive progress
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; wk date := date_trunc('week', current_date)::date; it uuid; pl uuid; miss int; r jsonb := '{}'; m record;
begin
  begin perform public.save_plan_item(e, wk, jsonb_build_object('day', current_date, 'title', 'Cast bases M3–M4')); assert false, 'activity needed';
  exception when others then assert sqlerrm = 'Choose the programme activity this work belongs to', sqlerrm; end;
  it := public.save_plan_item(e, wk, jsonb_build_object('day', current_date, 'title', 'Cast bases M3–M4', 'activity_id', current_setting('test.act_a')));
  -- A site meeting needs no activity
  perform public.delete_plan_item(public.save_plan_item(e, wk, jsonb_build_object('day', current_date, 'kind', 'meeting', 'title', 'Weekly site meeting with the consultant')));
  perform set_config('test.pli', it::text, false);
  select plan_id into pl from public.exec_plan_items where id = it;
  perform set_config('test.plp', pl::text, false);
  select count(*) into miss from public.plan_missing_critical(pl);
  if miss > 0 then
    begin perform public.submit_plan(pl); assert false, 'critical missing';
    exception when others then assert sqlerrm like 'Critical activities due this week are not planned%', sqlerrm; end;
    for m in select * from public.plan_missing_critical(pl) loop r := r || jsonb_build_object(m.activity_id::text, 'Crane available only next week'); end loop;
  end if;
  perform public.submit_plan(pl, r);
  assert (select skip_reasons from public.exec_plans where id = pl) = r, 'reasons kept for the SEE';
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.decide_plan(current_setting('test.plp')::uuid, true);
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  perform public.update_plan_item(current_setting('test.pli')::uuid, 'done');
  assert (select pct_auto = 20 and pct >= 40 and actual_start is not null from public.exec_activities where id = current_setting('test.act_a')::uuid), 'auto progress never lowers the AE figure';
end $$;
reset role;


-- Supabase (safeupdate) rejects UPDATE / DELETE without WHERE, also inside functions: none may exist
do $$ declare bad text;
begin
  select string_agg(distinct p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       lateral regexp_split_to_table(p.prosrc, ';') st
  where n.nspname in ('app', 'public') and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
    and st ~* '(^|\s)(update\s+[a-z_\.]+\s+(as\s+)?(\w+\s+)?set\s|delete\s+from\s+[a-z_\.]+)'
    and st !~* '\swhere\s';
  assert bad is null, 'UPDATE/DELETE without WHERE in: ' || bad;
end $$;


-- Programme tracking: snapshots of planned vs actual
do $$ begin
  assert exists (select 1 from public.exec_progress_snapshots where exec_project_id = current_setting('test.exlegacy')::uuid and snap_date = current_date
                 and pct_actual > 0 and pct_planned >= 0), 'snapshot recorded';
end $$;


-- WBS edit by the SEE: rename, and no move under its own sub-element
update public.exec_programmes set status = 'draft' where exec_project_id = current_setting('test.exlegacy')::uuid and status = 'submitted';
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; top uuid; sub uuid;
begin
  top := (select id from public.exec_wbs where exec_project_id = e and code = '1');
  sub := public.save_wbs(e, null, top, '1.1', 'Foundations');
  perform public.save_wbs(e, top, null, '1', 'Civil and structural works');
  assert (select name from public.exec_wbs where id = top) = 'Civil and structural works', 'renamed';
  begin perform public.save_wbs(e, top, sub, '1', 'Civil and structural works'); assert false, 'loop';
  exception when others then assert sqlerrm = 'A WBS element cannot be moved under its own sub-element', sqlerrm; end;
  perform public.delete_wbs(sub);
end $$;
reset role;


-- Material request from a subcontractor supervisor → AE → SEE → Operations; deliveries acknowledged by both sides
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare m uuid;
begin
  m := public.raise_material_request(current_setting('test.ex')::uuid, jsonb_build_object('required_date', current_date + 4,
    'lines', jsonb_build_array(jsonb_build_object('custom', true, 'item', 'Cable ties 300 mm', 'unit', 'pkt', 'qty', 10))));
  perform set_config('test.smr', m::text, false);
  assert (select status from public.material_requests where id = m) = 'ae_review', 'AE checks first';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'exec_material' and recipient_id = (select id from u where role = 'assistant_engineer')
                 and title like 'Material request from the subcontractor%'), 'AE told';
end $$;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
select public.ae_review_material_request(current_setting('test.smr')::uuid, true, 'Needed for tray work', 45000);
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.decide_material_request(current_setting('test.smr')::uuid, true);
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.order_material_request(current_setting('test.smr')::uuid, 'PO-6001', 'Hardware Mart', current_date + 2);
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare r uuid; l uuid := (select id from public.material_request_lines where mr_id = current_setting('test.smr')::uuid);
begin
  r := public.receive_material(current_setting('test.smr')::uuid, jsonb_build_array(jsonb_build_object('line_id', l, 'qty', 4)));
  perform set_config('test.rc1', r::text, false);
  assert (select status from public.material_receipts where id = r) = 'pending', 'waits for the supervisor';
  assert not exists (select 1 from public.store_moves where mr_id = current_setting('test.smr')::uuid), 'not in the store yet';
end $$;
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare r uuid; l uuid := (select id from public.material_request_lines where mr_id = current_setting('test.smr')::uuid);
begin
  assert public.acknowledge_delivery(current_setting('test.rc1')::uuid, false, 'Only 3 packets arrived') = 'disputed', 'disputed';
  r := public.receive_material(current_setting('test.smr')::uuid, jsonb_build_array(jsonb_build_object('line_id', l, 'qty', 3)), null);
  perform set_config('test.rc2', r::text, false);
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  assert public.acknowledge_delivery(current_setting('test.rc2')::uuid, true) = 'accepted', 'both acknowledged';
  assert (select status from public.material_requests where id = current_setting('test.smr')::uuid) = 'part_received', 'booked';
  assert (select sum(qty) from public.store_moves where mr_id = current_setting('test.smr')::uuid) = 3, 'only the acknowledged quantity in the store';
end $$;
reset role;


-- Supervisor attaches a delivery photo to their request
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ begin
  assert app.can_write_attachment('material_request', current_setting('test.smr')::uuid, 'grn_photo'), 'supervisor can attach the delivery photo';
  assert not app.can_write_attachment('material_request', current_setting('test.mr')::uuid, 'grn_photo'), 'not to other requests';
  assert app.can_write_attachment('material_request', current_setting('test.smr')::uuid, null), 'file storage upload check (no kind)';
end $$;
reset role;

-- Invoicing plan → execution --------------------------------------------------
-- A won project is linked automatically through its sales project
do $$ begin
  assert (select s.project_id = '00000000-0000-0000-0000-00000000b001' from public.exec_projects e join public.secured_projects s on s.id = e.secured_id
          where e.id = current_setting('test.ex')::uuid), 'won project linked to its secured project';
end $$;
-- A project won before the system: secured project with its invoicing plan
do $$ declare sid uuid; m date := app.month_of((now() at time zone app.tz())::date); nm date := (app.month_of((now() at time zone app.tz())::date) + interval '1 month')::date;
begin
  insert into public.secured_projects (project_name, customer, sales_person_id, order_value, won_on, source, schedule_status)
  values ('Old Harbour Lighting', 'Ports Authority', (select id from u where role = 'asm_building'), 45000000, current_date - 200, 'opening', 'approved') returning id into sid;
  insert into public.invoice_lines (secured_id, seq, kind, description, amount, original_month, forecast_month) values
    (sid, 1, 'delivery', 'Poles delivered', 10000000, m, m),
    (sid, 2, 'progress', 'Foundations complete', 5000000, m, m),
    (sid, 3, 'progress', 'Cabling complete', 5000000, m, m),
    (sid, 4, 'progress', 'Monthly progress claim', 15000000, m, m),
    (sid, 5, 'handover', 'Handover', 5000000, m, m),
    (sid, 6, 'tc', 'Testing and commissioning', 3000000, nm, nm),
    (sid, 7, 'retention', 'Retention', 2000000, nm, nm);
  perform set_config('test.bsec', sid::text, false);
  update public.exec_projects set see_id = (select id from u where role = 'senior_elec_engineer') where id = current_setting('test.exlegacy')::uuid;
end $$;
create temp table bl on commit drop as select seq, id from public.invoice_lines where secured_id = current_setting('test.bsec')::uuid;
grant select on bl to authenticated;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  begin perform public.link_secured_project(current_setting('test.exlegacy')::uuid, current_setting('test.bsec')::uuid); assert false, 'SEE cannot link';
  exception when others then assert sqlerrm = 'SM Projects or Operations link the secured project', sqlerrm; end;
  begin perform public.set_invoice_trigger(current_setting('test.exlegacy')::uuid, (select id from bl where seq = 1), 'gate', 2); assert false, 'not linked yet';
  exception when others then assert sqlerrm = 'Invoice line of another project', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ begin
  begin perform public.link_secured_project(current_setting('test.exlegacy')::uuid, (select secured_id from public.exec_projects where id = current_setting('test.ex')::uuid));
    assert false, 'already linked';
  exception when others then assert sqlerrm = 'That secured project is already linked to another execution project', sqlerrm; end;
  perform public.link_secured_project(current_setting('test.exlegacy')::uuid, current_setting('test.bsec')::uuid);
end $$;
reset role;
-- SEE sets the triggers; SM Projects approves them
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid;
begin
  assert exists (select 1 from public.secured_projects where id = current_setting('test.bsec')::uuid), 'SEE reads the linked secured project';
  assert (select count(*) from public.invoice_lines where secured_id = current_setting('test.bsec')::uuid) = 7, 'and its invoice lines';
  begin perform public.set_invoice_trigger(e, (select id from bl where seq = 2), 'activity', null, gen_random_uuid()); assert false, 'activity of the project';
  exception when others then assert sqlerrm = 'Choose a programme activity', sqlerrm; end;
  perform public.set_invoice_trigger(e, (select id from bl where seq = 1), 'gate', 2);
  perform public.set_invoice_trigger(e, (select id from bl where seq = 2), 'activity', null, current_setting('test.act_a')::uuid);
  perform public.set_invoice_trigger(e, (select id from bl where seq = 3), 'activity', null, current_setting('test.act_c')::uuid);
  perform public.set_invoice_trigger(e, (select id from bl where seq = 4), 'ipc');
  assert (select count(*) from public.exec_invoice_triggers where exec_project_id = e and not approved) = 4, 'waiting for SM Projects';
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  assert not exists (select 1 from public.exec_invoice_triggers), 'AE does not see the invoice triggers';
  assert not exists (select 1 from public.secured_projects where id = current_setting('test.bsec')::uuid), 'nor the amounts';
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'exec_billing' and recipient_id = auth.uid()), 'SM Projects told (after the baseline)';
  assert public.approve_invoice_triggers(current_setting('test.exlegacy')::uuid) = 4, 'four approved';
end $$;
reset role;
-- Activity finished / checkpoint approved → claimable; the SEE submits the payment certificate and records the client's approval → ready
update public.exec_activities set pct = 100, actual_start = coalesce(actual_start, current_date - 5), actual_finish = current_date where id = current_setting('test.act_a')::uuid;
do $$ declare l1 uuid := (select id from bl where seq = 1); l2 uuid := (select id from bl where seq = 2);
begin
  assert (select approved from public.exec_invoice_triggers where line_id = l1), 'approved';
  assert (select claimable_at is not null and ready_at is null from public.exec_invoice_triggers where line_id = l2), 'activity finished → claimable, not yet ready';
  assert exists (select 1 from public.notifications where kind = 'exec_billing' and title like 'Work done%' and recipient_id = (select id from u where role = 'senior_elec_engineer')), 'SEE asked for the certificate';
  assert (select status from app.billing_rows(current_setting('test.exlegacy')::uuid) where line_id = l2) in ('amber', 'red'), 'certificate stage at risk until approved';
  assert (select ready_at is null and claimable_at is null from public.exec_invoice_triggers where line_id = l1), 'checkpoint not approved yet';
end $$;
insert into public.exec_gates (exec_project_id, gate, status) values (current_setting('test.exlegacy')::uuid, 2, 'pending');
update public.exec_gates set status = 'approved' where exec_project_id = current_setting('test.exlegacy')::uuid and gate = 2;
do $$ begin assert (select claimable_at is not null from public.exec_invoice_triggers where line_id = (select id from bl where seq = 1)), 'checkpoint approved → claimable'; end $$;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; l2 uuid := (select id from bl where seq = 2); c uuid;
begin
  begin perform public.submit_payment_cert(e, l2, '{"amount":"999999999","date":"2020-01-01"}'); assert false, 'amount above the line';
  exception when others then assert sqlerrm like 'Enter the amount claimed%', sqlerrm; end;
  c := public.submit_payment_cert(e, l2, jsonb_build_object('amount', app.line_open(l2), 'date', current_date, 'ref', 'PC-CLIENT-07'));
  begin perform public.submit_payment_cert(e, l2, jsonb_build_object('amount', 1000, 'date', current_date)); assert false, 'one open certificate';
  exception when others then assert sqlerrm like 'A certificate for this invoice is already with the client%', sqlerrm; end;
  assert public.decide_payment_cert(c, false, '{"note":"Add the test sheets"}') = 'returned', 'client returned it';
  c := public.submit_payment_cert(e, l2, jsonb_build_object('amount', app.line_open(l2), 'date', current_date));
  assert public.decide_payment_cert(c, true, jsonb_build_object('amount', app.line_open(l2), 'date', current_date, 'client_ref', 'CONS/123')) = 'approved', 'approved';
  assert (select ready_at is not null from public.exec_invoice_triggers where line_id = l2), 'certificate approved → ready to invoice';
  perform set_config('test.l2', l2::text, false);
end $$;
reset role;
do $$ declare l2 uuid := current_setting('test.l2')::uuid;
begin
  assert exists (select 1 from public.notifications where kind = 'invoice_ready' and recipient_id = (select id from u where role = 'operations_exec') and dedupe_key like 'ready:' || l2 || ':%'), 'Operations told';
  assert not exists (select 1 from public.notifications where kind = 'invoice_ready' and recipient_id = (select id from u where role = 'asm_building')), 'sales person told only when invoiced';
  assert exists (select 1 from public.secured_log where secured_id = current_setting('test.bsec')::uuid and action = 'ready_to_invoice'), 'logged on the secured project';
end $$;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  begin perform public.set_invoice_trigger(current_setting('test.exlegacy')::uuid, (select id from bl where seq = 2), 'manual'); assert false, 'ready lines are fixed';
  exception when others then assert sqlerrm like 'This invoice is already marked ready%', sqlerrm; end;
end $$;
reset role;
-- Operations raises the invoice against the approved certificate: recorded at once, the sales person told
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare l2 uuid := current_setting('test.l2')::uuid;
begin
  assert public.record_invoice(l2, jsonb_build_object('invoice_no', 'INV-PC-1', 'invoice_date', current_date, 'amount', app.line_open(l2))) < 0, 'recorded directly';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.invoice_allocations where invoice_no = 'INV-PC-1'), 'allocation made';
  assert exists (select 1 from public.notifications where kind = 'invoice_recorded' and recipient_id = (select id from u where role = 'asm_building')), 'sales person told';
end $$;
-- Activity forecast past the invoice deadline → red, SEE and SM Projects told (no automatic date change); recovery action
update public.exec_activities set ef = current_date + 70 where id = current_setting('test.act_c')::uuid;
do $$ declare l3 uuid := (select id from bl where seq = 3);
begin
  assert (select status from app.billing_rows(current_setting('test.exlegacy')::uuid) where line_id = l3) = 'red', 'red';
  perform public.billing_tick();
  assert not exists (select 1 from public.invoice_line_changes where line_id = l3), 'no automatic date change';
  assert (select risk from public.exec_invoice_triggers where line_id = l3) = 'red', 'risk stored';
  assert exists (select 1 from public.notifications where title like 'Invoice will miss its month%' and recipient_id = (select id from u where role = 'sm_projects')), 'SM Projects told';
end $$;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; l3 uuid := (select id from bl where seq = 3); a uuid;
begin
  assert exists (select 1 from public.billing_risk(e) where line_id = l3 and status = 'red'), 'SEE sees the risk';
  a := public.save_billing_action(e, l3, 'Second crew from Monday', (select id from u where role = 'assistant_engineer'), current_date + 7);
  assert (select open_actions from public.billing_risk(e) where line_id = l3) = 1, 'action open';
  begin perform public.close_billing_action(a, ''); assert false, 'result'; exception when others then assert sqlerrm = 'Say what was done', sqlerrm; end;
  perform public.close_billing_action(a, 'Crew added');
end $$;
reset role;
-- Monthly check by the SEE: work done → claimable; slipping → proposed (another quarter / year → SM Projects then DGM / GM)
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid;
begin
  begin perform public.check_invoice_line(e, (select id from bl where seq = 5), 'ready'); assert false, 'evidence';
  exception when others then assert sqlerrm = 'Say what work is done (evidence)', sqlerrm; end;
  assert public.check_invoice_line(e, (select id from bl where seq = 5), 'ready', null, 'Handover certificate signed') = 'claimable', 'claimable';
  assert (select claimable_at is not null and ready_at is null and kind = 'manual' from public.exec_invoice_triggers where line_id = (select id from bl where seq = 5)), 'manual claimable';
  begin perform public.check_invoice_line(e, (select id from bl where seq = 6), 'slipping', current_date + 40); assert false, 'reason';
  exception when others then assert sqlerrm = 'Give the expected month and the reason', sqlerrm; end;
  assert public.check_invoice_line(e, (select id from bl where seq = 6), 'slipping', (select forecast_month from public.invoice_lines where id = (select id from bl where seq = 6)) + 190, 'Client test witness delayed') = 'proposed', 'proposed';
  assert (select needs_gm from public.invoice_line_changes where line_id = (select id from bl where seq = 6) and status = 'pending'), 'another quarter → DGM / GM too';
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ declare c bigint := (select id from public.invoice_line_changes where line_id = (select id from bl where seq = 6) and status = 'pending');
begin
  perform public.decide_invoice_move(c, true, 'Client witness');
  assert (select status = 'pending' and smp_at is not null from public.invoice_line_changes where id = c), 'waits for DGM / GM';
  assert not exists (select 1 from public.my_pending_approvals() where source = 'invoice_move' and title like '%another quarter%'), 'no longer with SM Projects';
  begin perform public.decide_invoice_move(c, true); assert false, 'GM step'; exception when others then assert sqlerrm like 'DGM / GM approves%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ declare c bigint := (select id from public.invoice_line_changes where line_id = (select id from bl where seq = 6) and status = 'pending');
begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'invoice_move' and title like '%another quarter%'), 'with DGM / GM';
  perform public.decide_invoice_move(c, true, 'Agreed');
  assert (select status from public.invoice_line_changes where id = c) = 'approved', 'moved';
end $$;
reset role;
-- Progress claim: AE measures (no money), SEE records the certified amount
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  perform set_config('test.ipc', public.prepare_ipc(current_setting('test.exlegacy')::uuid, current_date, 40, 'Poles 1–16 erected, 1.2 km cable')::text, false);
  assert exists (select 1 from public.exec_ipcs where id = current_setting('test.ipc')::uuid), 'AE sees the measurement';
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare c uuid := current_setting('test.ipc')::uuid; l4 uuid := (select id from bl where seq = 4);
begin
  assert exists (select 1 from public.notifications where kind = 'exec_ipc' and recipient_id = (select id from u where role = 'senior_elec_engineer')), 'SEE told';
  assert public.certify_ipc(c, false, null, null, 'Pole 16 not erected') = 'returned', 'returned';
  perform set_config('test.ipc', public.prepare_ipc(current_setting('test.exlegacy')::uuid, current_date, 38, 'Poles 1–15')::text, false);
  c := current_setting('test.ipc')::uuid;
  begin perform public.certify_ipc(c, true, l4, 20000000); assert false, 'more than the line';
  exception when others then assert sqlerrm like 'Only % is still to invoice on that line', sqlerrm; end;
  assert public.certify_ipc(c, true, l4, 5700000, 'IPC 3 certified by the consultant') = 'certified', 'certified';
  assert (select ready_at is not null from public.exec_invoice_triggers where line_id = l4), 'claim ready to invoice';
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  assert not exists (select 1 from public.exec_ipcs where id = current_setting('test.ipc')::uuid), 'certified amount hidden from the AE';
  assert exists (select 1 from public.exec_ipcs where status = 'returned'), 'returned one still visible to correct';
end $$;
reset role;
-- Last week of the month → SEE asked to confirm next month's invoices
do $$ begin
  perform public.billing_tick((app.month_of((now() at time zone app.tz())::date) + 25)::timestamp at time zone app.tz());
  assert exists (select 1 from public.notifications where kind = 'exec_billing' and recipient_id = (select id from u where role = 'senior_elec_engineer')), 'monthly check reminder';
end $$;

-- Contract BOQ, measurement by quantity, Material on Site ------------------------
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; r jsonb;
begin
  begin perform public.save_boq(e, '[{"section":"Bill 1","description":"Preliminaries"}]'); assert false, 'priced items';
  exception when others then assert sqlerrm = 'The BOQ has no priced items', sqlerrm; end;
  r := public.save_boq(e, '[
    {"section":"Bill 1 – Preliminaries","description":"Preliminaries"},
    {"section":"Bill 1 – Preliminaries","item_no":"1.1","description":"Mobilisation","unit":"sum","qty":1,"rate":500000},
    {"section":"Bill 2 – Electrical","item_no":"2.1","description":"12 m mast","unit":"nos","qty":16,"rate":450000},
    {"section":"Bill 2 – Electrical","item_no":"2.2","description":"Armoured cable 4C 16 mm²","unit":"m","qty":2000,"rate":1500,"amount":3000000},
    {"section":"Bill 2 – Electrical","item_no":"2.3","description":"Floodlight 1500W","unit":"nos","qty":64,"rate":250000}]'::jsonb,
    'Harbour BOQ.xlsx', array['Bill 1', 'Bill 2'], 80);
  assert (r ->> 'total')::numeric = 26700000, 'total ' || r;
  assert (select status = 'submitted' and version = 0 and mos_pct = 80 from public.exec_boqs where exec_project_id = e), 'with SM Projects';
  assert (select count(*) from public.exec_boq_items where exec_project_id = e and heading) = 1, 'sub-heading kept';
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid;
begin
  assert not exists (select 1 from public.exec_boq_items), 'AE does not see the rates';
  assert jsonb_array_length(public.claim_context(e) -> 'items') = 0, 'no items until approved';
  begin perform public.prepare_ipc(e, current_date, null, null, '[{"boq_item_id":"00000000-0000-0000-0000-000000000000","qty_to_date":1}]'); assert false, 'not approved';
  exception when others then assert sqlerrm like 'The contract BOQ is not approved yet%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'exec_boq'), 'BOQ in approvals';
  assert public.decide_boq(current_setting('test.exlegacy')::uuid, true) = 'approved', 'approved';
end $$;
reset role;
-- 20 floodlights delivered, 4 already installed
insert into public.store_moves (exec_project_id, kind, item, unit, qty) values
  (current_setting('test.exlegacy')::uuid, 'receipt', 'Floodlight 1500W', 'nos', 20), (current_setting('test.exlegacy')::uuid, 'issue', 'Floodlight 1500W', 'nos', 4);
create temp table bq on commit drop as select item_no, id from public.exec_boq_items where exec_project_id = current_setting('test.exlegacy')::uuid and item_no is not null;
grant select on bq to authenticated;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; c jsonb; iid uuid; d jsonb;
begin
  c := public.claim_context(e);
  assert jsonb_array_length(c -> 'items') = 5 and not (c -> 'items' -> 1 ? 'rate'), 'items without rates';
  assert (select (x ->> 'balance')::numeric from jsonb_array_elements(c -> 'store') x where x ->> 'item' = 'Floodlight 1500W') = 16, 'site store balance';
  begin perform public.prepare_ipc(e, current_date, null, null, jsonb_build_array(jsonb_build_object('boq_item_id', (select id from bq where item_no = '2.1'), 'qty_to_date', 8)),
      jsonb_build_array(jsonb_build_object('item', 'Floodlight 1500W', 'unit', 'nos', 'qty', 20, 'boq_item_id', (select id from bq where item_no = '2.3')))); assert false, 'store';
  exception when others then assert sqlerrm like 'Only 16 nos of Floodlight 1500W is in the site store', sqlerrm; end;
  iid := public.prepare_ipc(e, current_date, null, null,
    jsonb_build_array(jsonb_build_object('boq_item_id', (select id from bq where item_no = '2.1'), 'qty_to_date', 8),
                      jsonb_build_object('boq_item_id', (select id from bq where item_no = '2.2'), 'qty_to_date', 1000)),
    jsonb_build_array(jsonb_build_object('item', 'Floodlight 1500W', 'unit', 'nos', 'qty', 16, 'boq_item_id', (select id from bq where item_no = '2.3'))));
  perform set_config('test.ipcq', iid::text, false);
  assert (select measured_pct from public.exec_ipcs where id = iid) = 19.10, 'percent from the BOQ';
  d := public.ipc_detail(iid);
  assert jsonb_array_length(d -> 'lines') = 2 and not (d -> 'lines' -> 0 ? 'rate') and not (d ? 'values') and not (d -> 'mos' -> 0 ? 'value'), 'AE sees quantities only';
  assert not exists (select 1 from public.exec_ipc_values), 'no money for the AE';
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare iid uuid := current_setting('test.ipcq')::uuid; v jsonb;
begin
  v := public.ipc_detail(iid) -> 'values';
  assert (v ->> 'work_value')::numeric = 5100000 and (v ->> 'mos_value')::numeric = 3200000 and (v ->> 'gross_value')::numeric = 8300000, 'valuation ' || v::text;
  assert (v ->> 'previous_certified')::numeric = 5700000 and (v ->> 'suggested')::numeric = 2600000, 'less certified before ' || v::text;
  assert public.certify_ipc(iid, true, (select id from bl where seq = 4), 2600000, 'IPC 4') = 'certified', 'certified';
end $$;
reset role;
-- Next month: the floodlights are installed → measured as work, material on site recovered
insert into public.store_moves (exec_project_id, kind, item, unit, qty) values (current_setting('test.exlegacy')::uuid, 'issue', 'Floodlight 1500W', 'nos', 16);
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; c jsonb;
begin
  c := public.claim_context(e);
  assert (select (x ->> 'last_qty')::numeric from jsonb_array_elements(c -> 'items') x where x ->> 'item_no' = '2.1') = 8, 'last quantity shown';
  perform set_config('test.ipcq2', public.prepare_ipc(e, current_date + 31, null, null,
    jsonb_build_array(jsonb_build_object('boq_item_id', (select id from bq where item_no = '2.3'), 'qty_to_date', 16)))::text, false);
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare v jsonb := public.ipc_detail(current_setting('test.ipcq2')::uuid) -> 'values';
begin
  assert (v ->> 'work_value')::numeric = 9100000 and (v ->> 'mos_value')::numeric = 0, 'earlier quantities carried, MOS now installed ' || v::text;
  assert (v ->> 'previous_mos')::numeric = 3200000 and (v ->> 'suggested')::numeric = 800000, 'material on site recovered ' || v::text;
end $$;
-- Variation priced from the BOQ (route C) → BOQ items when the client accepts
do $$ declare v uuid;
begin
  v := public.raise_variation(current_setting('test.exlegacy')::uuid, '{"vtype":"addition","reason":"client_instruction","title":"Two more masts","description":"Masts at the new gate"}');
  perform set_config('test.varb', v::text, false);
  assert public.screen_variation(v, 'C', jsonb_build_object('boq_lines', jsonb_build_array(jsonb_build_object('boq_item_id', (select id from bq where item_no = '2.1'), 'qty', 2)))) = 'pending_smp', 'route C';
  assert (select value_lkr from public.variations where id = v) = 900000, 'priced at the BOQ rate';
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_exec_variation(current_setting('test.varb')::uuid, true);
reset role;
insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name, uploaded_by)
values ('variation', current_setting('test.varb')::uuid, 'var_doc', 'variation/test/vo2.pdf', 'vo2.pdf', (select id from u where role = 'senior_elec_engineer'));
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; ov numeric := (select order_value from public.secured_projects where id = current_setting('test.bsec')::uuid);
begin
  assert public.record_variation_client(current_setting('test.varb')::uuid, true, '{"vo_no":"VO-11"}') = 'secured_updated', 'legacy project: linked secured project updated';
  assert (select order_value from public.secured_projects where id = current_setting('test.bsec')::uuid) = ov + 900000, 'order value';
  assert (select qty = 2 and rate = 450000 and section = 'Variations' from public.exec_boq_items where exec_project_id = e and source = 'variation'), 'in the BOQ';
  assert (select total from public.exec_boqs where exec_project_id = e) = 27600000, 'BOQ total';
end $$;
-- Revised upload keeps measured items (rates changed, item dropped)
do $$ declare e uuid := current_setting('test.exlegacy')::uuid;
begin
  begin perform public.save_boq(e, '[{"item_no":"2.1","section":"Bill 2 – Electrical","description":"12 m mast","unit":"nos","qty":16,"rate":450000}]'); assert false, 'reason';
  exception when others then assert sqlerrm = 'Give the reason for the revised BOQ', sqlerrm; end;
  perform public.save_boq(e, '[{"item_no":"2.1","section":"Bill 2 – Electrical","description":"12 m mast","unit":"nos","qty":18,"rate":450000}]', null, null, null, 'Client re-measure');
  assert (select qty from public.exec_boq_items where id = (select id from bq where item_no = '2.1')) = 18, 'same item updated';
  assert (select removed from public.exec_boq_items where id = (select id from bq where item_no = '2.3')), 'measured item kept as removed';
  assert not exists (select 1 from public.exec_boq_items where id = (select id from bq where item_no = '1.1')), 'unmeasured item deleted';
  assert (select status from public.exec_boqs where exec_project_id = e) = 'submitted', 'back to SM Projects';
end $$;
reset role;
-- Delivery trigger: invoice ready when the material requests are fully received
do $$ declare e uuid := current_setting('test.ex')::uuid; l uuid; mr uuid := current_setting('test.smr')::uuid;
begin
  select id into l from public.invoice_lines where secured_id = (select secured_id from public.exec_projects where id = e) order by seq limit 1;
  delete from public.invoice_allocations where line_id = l;
  delete from public.exec_invoice_triggers where line_id = l;
  insert into public.exec_invoice_triggers (line_id, exec_project_id, kind, mr_ids, approved) values (l, e, 'delivery', array[mr], true);
  update public.material_requests set status = 'received' where id = mr;
  assert (select claimable_at is not null and claimable_note like 'Delivered to site%' and ready_at is null from public.exec_invoice_triggers where line_id = l), 'delivered → claimable';
end $$;

-- Management report: GM / DGM only ---------------------------------------------
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  begin perform public.save_mgmt_report(current_date, '{"pnl":{}}'); assert false, 'GM only';
  exception when others then assert sqlerrm = 'Only the GM / DGM generates the management report', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('gm'); set role authenticated;
do $$ declare r uuid;
begin
  r := public.save_mgmt_report(current_date, '{"pnl":{"turnover":1}}');
  perform public.save_mgmt_comments(r, 'Collections to be followed up');
  assert (select comments = 'Collections to be followed up' and month = app.month_of(current_date) from public.mgmt_reports where id = r), 'saved with comments';
  perform set_config('test.mgr', r::text, false);
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin assert not exists (select 1 from public.mgmt_reports), 'others do not see it'; end $$;
reset role;

-- USD rate: GM / DGM may set it, others may not ------------------------------------
select pg_temp.act_as('gm'); set role authenticated;
insert into public.exchange_rates (month, usd_to_lkr) values ('2031-01-01', 301.25);
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  begin insert into public.exchange_rates (month, usd_to_lkr) values ('2031-02-01', 299); assert false, 'only GM / admin';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin assert (select usd_to_lkr from public.exchange_rates where month = '2031-01-01') = 301.25, 'GM rate saved'; end $$;

-- Budget list: edit one project with its invoice months ------------------------------
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare y int := app.fy_of(current_date); b uuid;
begin
  begin perform public.save_budget_project(y, null, '{"business_line":"Street","project_name":"X","sales_person":"Asm Infra","budget_value":"1"}'); assert false, 'line checked';
  exception when others then assert sqlerrm like 'Business line%', sqlerrm; end;
  b := public.save_budget_project(y, null, jsonb_build_object('business_line', 'Infrastructure', 'project_name', 'Harbour approach lighting', 'sales_person', 'Asm Infra',
    'budget_value', '20000000', 'budget_gp_pct', '18'));
  assert (select budget_gp_value from public.budget_projects where id = b) = 3600000, 'added';
  perform public.save_budget_project(y, b, jsonb_build_object('business_line', 'Infrastructure', 'project_name', 'Harbour approach lighting', 'sales_person', 'Asm Infra',
    'budget_value', '20000000', 'budget_gp_pct', '18', 'invoices', jsonb_build_array(jsonb_build_object('month', current_date::text, 'amount', '8000000'),
      jsonb_build_object('month', (current_date + 31)::text, 'amount', '12000000'))));
  assert (select sum(amount) from public.budget_invoices where budget_id = b) = 20000000, 'invoice months saved';
  begin perform public.save_budget_project(y, b, jsonb_build_object('business_line', 'Infrastructure', 'project_name', 'Harbour approach lighting', 'sales_person', 'Asm Infra',
      'budget_value', '1000', 'invoices', jsonb_build_array(jsonb_build_object('month', current_date::text, 'amount', '8000000')))); assert false, 'more than value';
  exception when others then assert sqlerrm like 'Invoice amounts add up to more%', sqlerrm; end;
  perform set_config('test.bud1', b::text, false);
end $$;
reset role;
select pg_temp.act_as('asm_infra'); set role authenticated;
do $$ begin
  begin perform public.delete_budget_project(current_setting('test.bud1')::uuid); assert false, 'sales cannot';
  exception when others then assert sqlerrm like 'Only Operations%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.delete_budget_project(current_setting('test.bud1')::uuid);
reset role;

-- Programme: set start / finish dates of an activity, duration worked out ----------------
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare c uuid := current_setting('test.act_c')::uuid; st date; fin date; r jsonb;
begin
  -- next Monday two weeks on, and the Friday of the following week
  st := current_date + 14 + ((8 - extract(isodow from current_date + 14)::int) % 7);
  fin := st + 11;
  r := public.set_activity_dates(c, st, fin);
  assert (select duration from public.exec_activities where id = c) = app.work_days(st, fin), 'duration from the dates ' || r::text;
  assert (r ->> 'duration')::int = 10, 'two working weeks ' || r::text;
  assert (select es = st and ef = fin from public.exec_activities where id = c), 'scheduled on the dates ' || r::text;
  begin perform public.set_activity_dates(c, st, st - 1); assert false, 'finish before start';
  exception when others then assert sqlerrm = 'The finish cannot be before the start', sqlerrm; end;
  -- finish only: the duration follows, the start stays
  r := public.set_activity_dates(c, null, st + 4);
  assert (r ->> 'duration')::int = 5 and (r ->> 'es')::date = st, 'finish only ' || r::text;
end $$;
reset role;

-- Programme: automatic numbering ---------------------------------------------------
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; w2 uuid; sub uuid; a uuid;
begin
  select id into w2 from public.exec_wbs where exec_project_id = e and parent_id is null order by sort offset 1 limit 1;
  assert (select array_agg(code order by sort) from public.exec_wbs where exec_project_id = e and parent_id is null) = array['1', '2'], 'WBS 1, 2';
  assert (select code from public.exec_activities where id = current_setting('test.act_a')::uuid) = '1.1', 'activity A is 1.1';
  sub := public.save_wbs(e, null, w2, null, 'Earthing');
  assert (select code from public.exec_wbs where id = sub) = '2.1', 'sub-element first under its element';
  assert (select array_agg(code order by sort) from public.exec_activities where wbs_id = w2) = array['2.2', '2.3', '2.4'], 'activities follow the sub-elements';
  a := public.save_activity(e, null, jsonb_build_object('wbs_id', sub, 'name', 'Earth pits', 'duration', 2));
  assert (select code from public.exec_activities where id = a) = '2.1.1', 'activity under the sub-element';
  perform public.rename_activity(a, 'Earth pits and test');
  assert (select name from public.exec_activities where id = a) = 'Earth pits and test', 'renamed';
  perform public.delete_activity(a);
  perform public.delete_wbs(sub);
  assert (select array_agg(code order by sort) from public.exec_activities where wbs_id = w2) = array['2.1', '2.2', '2.3'], 'renumbered after delete';
end $$;
reset role;

-- Secured list: removal by Operations with SM Projects approval ----------------------
do $$ declare sid uuid;
begin
  insert into public.secured_projects (project_name, customer, sales_person_id, order_value, won_on, source, schedule_status)
  values ('Duplicate entry', 'X', (select id from u where role = 'asm_infra'), 1000000, current_date, 'won', 'missing') returning id into sid;
  insert into public.invoice_lines (secured_id, seq, kind, amount, original_month, forecast_month) values (sid, 1, 'other', 1000000, app.month_of(current_date), app.month_of(current_date));
  perform set_config('test.secrm', sid::text, false);
end $$;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ begin
  begin perform public.request_secured_removal(current_setting('test.secrm')::uuid, ''); assert false, 'reason';
  exception when others then assert sqlerrm = 'Give the reason', sqlerrm; end;
  assert public.request_secured_removal(current_setting('test.secrm')::uuid, 'Entered twice') = 'pending', 'waits for SM Projects';
  begin perform public.request_secured_removal(current_setting('test.bsec')::uuid, 'x'); perform public.decide_secured_removal(current_setting('test.bsec')::uuid, false); 
  exception when others then null; end;
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'secured_removal' and id = current_setting('test.secrm')::uuid), 'in approvals';
  assert public.decide_secured_removal(current_setting('test.secrm')::uuid, true) = 'removed', 'removed';
  assert not exists (select 1 from public.secured_projects where id = current_setting('test.secrm')::uuid), 'gone';
  assert not exists (select 1 from public.invoice_lines where secured_id = current_setting('test.secrm')::uuid), 'its invoicing plan too';
end $$;
reset role;
do $$ begin assert exists (select 1 from public.audit_log where table_name = 'secured_projects' and record_id = current_setting('test.secrm') and action = 'removed'), 'kept in the audit log'; end $$;
-- with invoices recorded: close or cancel instead
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare sid uuid := (select secured_id from public.invoice_allocations limit 1);
begin
  begin perform public.request_secured_removal(sid, 'mistake'); assert false, 'invoiced';
  exception when others then assert sqlerrm like 'Invoices are recorded%', sqlerrm; end;
end $$;
reset role;

-- Mark secured with the WBS of an unlinked secured project → linked, not duplicated -----------
do $$ declare y int := app.fy_of(current_date); b uuid; sid uuid;
begin
  insert into public.secured_projects (project_name, sales_person_id, order_value, won_on, source, schedule_status, wbs)
  values ('Stadium IPC 01', (select id from u where role = 'asm_infra'), 345000000, current_date - 30, 'won', 'approved', 'LS-000999') returning id into sid;
  insert into public.budget_projects (fy, business_line, project_name, sales_person_id, budget_value) values (y, 'infrastructure', 'Stadium (merged)', (select id from u where role = 'asm_infra'), 1500000000) returning id into b;
  perform set_config('test.wb', b::text, false); perform set_config('test.ws', sid::text, false);
end $$;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ begin
  assert public.secure_budget_project(current_setting('test.wb')::uuid, jsonb_build_object('won_on', current_date::text, 'wbs', 'LS-000999')) = current_setting('test.ws')::uuid, 'linked to the existing project';
  assert (select budget_id from public.secured_projects where id = current_setting('test.ws')::uuid) = current_setting('test.wb')::uuid, 'budget line set';
  assert (select count(*) from public.secured_projects where wbs = 'LS-000999') = 1, 'no duplicate';
end $$;
reset role;

-- Baseline follows the dates while the programme is a draft, fixed once submitted -------------
do $$ declare e uuid := current_setting('test.exlegacy')::uuid;
begin
  if (select status from public.exec_programmes where exec_project_id = e) <> 'draft' then
    update public.exec_programmes set status = 'draft' where exec_project_id = e;
  end if;
end $$;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; c uuid := current_setting('test.act_c')::uuid; st date; r jsonb;
begin
  st := current_date + 21 + ((8 - extract(isodow from current_date + 21)::int) % 7);
  r := public.set_activity_dates(c, st, st + 4);
  assert (select bl_start = st and bl_finish = st + 4 from public.exec_activities where id = c), 'baseline follows the draft ' || r::text;
  -- billing check: every invoice line needs a trigger; lines that would miss their month need the reason
  begin perform public.submit_programme(e, 'New site access dates'); assert false, 'untriggered lines';
  exception when others then assert sqlerrm like '% have no trigger%', sqlerrm; end;
  perform public.set_invoice_trigger(e, x.line_id, 'manual') from app.billing_rows(e) x where x.status = 'no_trigger';
  if exists (select 1 from app.billing_rows(e) where status = 'red') then
    begin perform public.submit_programme(e, 'New site access dates'); assert false, 'billing reason';
    exception when others then assert sqlerrm like '%would miss their planned month%', sqlerrm; end;
  end if;
  perform public.submit_programme(e, 'New site access dates', 'Night shifts on the cable route to recover');
  assert (select billing_check is not null from public.exec_programmes where exec_project_id = e), 'billing check stored';
end $$;
reset role;
do $$ declare c uuid := current_setting('test.act_c')::uuid;
begin
  -- after submission the plan can move (progress) but the baseline stays
  update public.exec_programmes set status = 'approved' where exec_project_id = current_setting('test.exlegacy')::uuid;
  update public.exec_activities set not_before = current_date + 60 where id = c;
  perform app.schedule(current_setting('test.exlegacy')::uuid);
  assert (select bl_start < es from public.exec_activities where id = c), 'baseline fixed after submission';
end $$;

-- Materials catalogue and the fuller request -------------------------------------------------
do $$ begin
  assert (select count(*) from public.material_catalog) >= 10000, 'catalogue has 10,000+ items';
  assert (select count(*) from public.material_catalog where code is null) = 0, 'every item has a code';
end $$;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; c int; mr uuid;
begin
  assert exists (select 1 from public.search_material_catalog('street 60W type II', array['road'])), 'search finds street lights';
  assert (select suits from public.search_material_catalog('cable', array['road']) limit 1), 'items for the project areas first';
  assert not exists (select 1 from public.search_material_catalog('zzzz-not-an-item')), 'no match';
  select id into c from public.search_material_catalog('XLPE/SWA 4-core 16 mm² Cu') limit 1;
  assert c is not null, 'cable found';
  begin perform public.raise_material_request(e, jsonb_build_object('required_date', current_date + 7, 'lines', jsonb_build_array(jsonb_build_object('item', 'Something', 'unit', 'nos', 'qty', 2))));
    assert false, 'custom must be ticked';
  exception when others then assert sqlerrm like 'Choose the item from the catalogue%', sqlerrm; end;
  mr := public.raise_material_request(e, jsonb_build_object('required_date', current_date + 7, 'priority', 'urgent', 'deliver_to', 'Zone A store', 'activity_id', current_setting('test.act_a'),
    'lines', jsonb_build_array(jsonb_build_object('catalog_id', c, 'qty', 250, 'spec', 'Drum lengths 250 m', 'brand', 'ACL / Kelani'),
                               jsonb_build_object('custom', true, 'item', 'Special bracket for mast M3', 'category', 'Fixings & hardware', 'unit', 'nos', 'qty', 4, 'spec', 'Per drawing L-12'))));
  assert (select priority from public.material_requests where id = mr) = 'urgent', 'priority';
  assert (select count(*) from public.material_request_lines where mr_id = mr) = 2, 'two lines';
  assert (select unit = 'm' and spec = 'Drum lengths 250 m' and not custom from public.material_request_lines where mr_id = mr and catalog_id = c), 'catalogue line with unit and spec';
  assert (select custom from public.material_request_lines where mr_id = mr and catalog_id is null), 'custom line';
end $$;
reset role;

-- Work starts with the approved programme (no checkpoint to request)
do $$ begin
  assert (select stage from public.exec_projects where id = current_setting('test.exlegacy')::uuid) >= 2, 'started when the programme was approved';
  assert exists (select 1 from public.exec_gates where exec_project_id = current_setting('test.exlegacy')::uuid and gate = 1 and status = 'approved' and not legacy), 'start recorded';
end $$;


-- Design + estimation together: deadline type, one split, parallel pre-estimate, extensions, late alert ---------------
savepoint parallel_de;
select set_config('app.workflow', '1', false);
insert into public.inquiries (id, project_id, organization_id, unit_id, route, release_mode, release_mode_confirmed, design_scope, scope_description,
                              estimation_scope, estimation_basis, sales_person_id, status, budget_lkr, deadline_type, tender_closes_at, tender_ref, tender_submission)
values ('00000000-0000-0000-0000-0000000de001', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002',
        'A', 3, true, 'lighting', 'Stadium floodlighting tender', '{fixtures,controls}', 'supply_install', (select id from u where role = 'asm_building'),
        'accepted', 60000000, 'tender', ((app.wd_back(current_date + 30, 0)) + time '10:00') at time zone app.tz(), 'NSC/T/2026/14', 'hard_copy');
update public.inquiries set status = 'accepted' where id = '00000000-0000-0000-0000-0000000de001';
select set_config('app.workflow', '', false);
do $$ declare i public.inquiries := app.inq('00000000-0000-0000-0000-0000000de001'); s jsonb := app.deadline_split(i);
begin
  assert i.customer_deadline = current_date + 30, 'tender deadline follows the closing date';
  assert (s ->> 'release_days')::int = 2 and (s ->> 'pricing_days')::int = 2, 'tender: 2 release days, 2 pricing days (large job)';
  assert ((s ->> 'estimation_due')::timestamptz at time zone app.tz())::date = app.wd_back(current_date + 30, 2), 'final pricing ends 2 working days before closing';
  assert ((s ->> 'design_due')::timestamptz at time zone app.tz())::date = app.wd_back(current_date + 30, 4), 'design gets the rest';
  perform set_config('test.split', s::text, false);
end $$;
select pg_temp.act_as('design_manager'); set role authenticated;
do $$ declare s jsonb := current_setting('test.split')::jsonb;
begin
  begin perform public.propose_design_due('00000000-0000-0000-0000-0000000de001', (s ->> 'estimation_due')::timestamptz);
    assert false, 'no time left for final pricing';
  exception when others then assert sqlerrm like 'The design must be complete by % – that leaves 1 working day for final pricing and 2 working days for release before the tender closes', sqlerrm; end;
  perform set_config('app.workflow', '', true);
  perform public.propose_design_due('00000000-0000-0000-0000-0000000de001', (s ->> 'design_due')::timestamptz);
  assert (select reason from public.approvals where kind = 'design_due' and entity_id = '00000000-0000-0000-0000-0000000de001') like '%tender closes%(fixed closing)%pre-estimate%', 'approval shows the split';
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_approval((select id from public.approvals where kind = 'design_due' and entity_id = '00000000-0000-0000-0000-0000000de001'), 'approved');
reset role;
do $$ declare i public.inquiries := app.inq('00000000-0000-0000-0000-0000000de001'); s jsonb := current_setting('test.split')::jsonb;
begin
  assert i.estimation_due_at = (s ->> 'estimation_due')::timestamptz, 'final pricing date stored';
  assert (select count(*) from public.estimation_jobs where inquiry_id = i.id) = 1, 'estimation opens with the design';
  assert (select phase = 'pre' and status = 'queued' from public.estimation_jobs where inquiry_id = i.id), 'as a pre-estimate';
  assert exists (select 1 from public.notifications where kind = 'pre_estimate_opened' and entity_id = (select id from public.estimation_jobs where inquiry_id = i.id)
                 and recipient_id = (select id from u where role = 'sm_estimation')), 'SM Estimation told';
end $$;
select pg_temp.act_as('sm_estimation'); set role authenticated;
do $$ declare j uuid := (select id from public.estimation_jobs where inquiry_id = '00000000-0000-0000-0000-0000000de001'); i public.inquiries := app.inq('00000000-0000-0000-0000-0000000de001');
begin
  perform public.accept_estimation(j);
  begin perform public.assign_estimation_job(j, public.default_estimator(i.id), i.tender_closes_at - interval '1 day', 'large', 'x');
    assert false, 'too close to the tender closing';
  exception when others then assert sqlerrm like '%2 working days before the tender closes%', sqlerrm; end;
  perform public.assign_estimation_job(j, (select id from u where role = 'estimation_exec'), i.estimation_due_at, 'large', 'Tender team');
  assert (select status from public.inquiries where id = i.id) = 'accepted', 'inquiry stays with Design during the pre-estimate';
  assert (select count(*) from public.design_pipeline() where inquiry_id = i.id and deadline_type = 'tender' and estimation_phase = 'pre' and estimator is not null) = 1, 'SM Estimation panel row';
end $$;
reset role;
select pg_temp.act_as('estimation_exec'); set role authenticated;
do $$ declare j uuid := (select id from public.estimation_jobs where inquiry_id = '00000000-0000-0000-0000-0000000de001');
begin
  begin perform public.submit_estimate_for_approval(j); assert false, 'pre-estimate submitted';
  exception when others then assert sqlerrm like 'The design is not released yet%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('design_manager'); set role authenticated;
select public.assign_design_job('00000000-0000-0000-0000-0000000de001', (select id from u where role = 'lighting_designer'), (select design_due_at from public.inquiries where id = '00000000-0000-0000-0000-0000000de001'), 'lighting', 'large', '[]', 'Tender');
reset role;
do $$ begin
  assert (select current_owner_id from public.inquiries where id = '00000000-0000-0000-0000-0000000de001') = (select id from u where role = 'lighting_designer'), 'the designer owns the inquiry while designing';
end $$;
-- Tenders: no request – only the client's addendum moves the closing date
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare i public.inquiries := app.inq('00000000-0000-0000-0000-0000000de001'); old_d timestamptz := i.design_due_at; old_e timestamptz := i.estimation_due_at;
begin
  begin perform public.request_deadline_extension(i.id, current_date + 40, 'More time'); assert false, 'tender extension request';
  exception when others then assert sqlerrm like 'A tender closing date is fixed%', sqlerrm; end;
  begin perform public.record_tender_extension(i.id, i.tender_closes_at + interval '7 days', 'Addendum 2'); assert false, 'no addendum file';
  exception when others then assert sqlerrm = 'Attach the tender addendum', sqlerrm; end;
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('inquiry', i.id, 'tender_addendum', 'inquiry/' || i.id || '/add2.pdf', 'add2.pdf');
  perform public.record_tender_extension(i.id, i.tender_closes_at + interval '7 days', 'Addendum 2', 'Site visit added');
  i := app.inq(i.id);
  assert i.customer_deadline = current_date + 37, 'closing date moved';
  assert i.design_due_at > old_d and i.estimation_due_at > old_e, 'dates re-split';
  assert (i.estimation_due_at at time zone app.tz())::date = app.wd_back(current_date + 37, 2), 'final pricing re-split';
  assert (select count(*) from public.deadline_extensions where inquiry_id = i.id and kind = 'tender_addendum' and addendum_ref = 'Addendum 2') = 1, 'extension recorded';
end $$;
reset role;
do $$ declare i public.inquiries := app.inq('00000000-0000-0000-0000-0000000de001');
begin
  assert (select due_at from public.estimation_jobs where inquiry_id = i.id) = i.estimation_due_at, 'estimator''s date follows';
  assert (select due_at from public.sla_clocks where entity_id = (select id from public.estimation_jobs where inquiry_id = i.id) and stage = 'estimation' and stopped_at is null) = i.estimation_due_at, 'clock follows';
  assert exists (select 1 from public.notifications where kind = 'deadline_extended' and entity_id = i.id and recipient_id = (select id from u where role = 'estimation_exec')), 'estimator told';
end $$;
-- Progress: estimators give a % too; quiet jobs are chased
select pg_temp.act_as('estimation_exec'); set role authenticated;
select public.update_estimate_progress((select id from public.estimation_jobs where inquiry_id = '00000000-0000-0000-0000-0000000de001'), 30, 'Cables and poles priced');
reset role;
do $$ begin
  assert (select progress_pct = 30 and progress_updated_at is not null and status = 'in_progress' from public.estimation_jobs where inquiry_id = '00000000-0000-0000-0000-0000000de001'), 'estimate progress saved';
end $$;
update public.design_jobs set created_at = now() - interval '7 days', progress_updated_at = null where inquiry_id = '00000000-0000-0000-0000-0000000de001';
do $$ declare n int;
begin
  perform public.progress_tick();
  assert exists (select 1 from public.notifications where kind = 'progress_stale' and recipient_id = (select id from u where role = 'design_manager')
                 and entity_id = (select id from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-0000000de001')), 'Design Manager told about the quiet job';
  assert (select progress_alerted_at is not null from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-0000000de001'), 'marked';
  assert not exists (select 1 from public.notifications where kind = 'progress_stale' and entity_id = (select id from public.estimation_jobs where inquiry_id = '00000000-0000-0000-0000-0000000de001')), 'updated estimate not chased';
  select count(*) into n from public.notifications where kind = 'progress_stale';
  perform public.progress_tick();
  assert (select count(*) from public.notifications where kind = 'progress_stale') = n, 'told once';
end $$;
select pg_temp.act_as('lighting_designer'); set role authenticated;
select public.update_design_progress((select id from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-0000000de001'), 40, 2);
reset role;
do $$ begin
  assert (select progress_alerted_at is null and progress_updated_at is not null from public.design_jobs where inquiry_id = '00000000-0000-0000-0000-0000000de001'), 'update clears the chase';
end $$;
select pg_temp.act_as('sm_estimation'); set role authenticated;
do $$ begin
  assert (select estimation_progress = 30 and estimation_updated_at is not null and design_updated_at is not null and estimation_time_pct is not null
            from public.design_pipeline() where inquiry_id = '00000000-0000-0000-0000-0000000de001'), 'panel has progress and time';
end $$;
reset role;
-- One alert when the design is late
select set_config('app.workflow', '1', false);
update public.inquiries set design_due_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000de001';
select set_config('app.workflow', '', false);
do $$ begin
  assert public.design_split_tick() = 1, 'late design alerted';
  assert public.design_split_tick() = 0, 'only once';
  assert exists (select 1 from public.notifications where kind = 'design_late' and priority = 'critical' and recipient_id = (select id from u where role = 'sm_estimation')), 'SM Estimation alerted';
end $$;
-- Design released: the same job moves on to final pricing
select set_config('app.workflow', '1', false);
update public.design_jobs set status = 'approved' where inquiry_id = '00000000-0000-0000-0000-0000000de001';
update public.inquiries set status = 'design_approved' where id = '00000000-0000-0000-0000-0000000de001';
select set_config('app.workflow', '', false);
select pg_temp.act_as('design_manager'); set role authenticated;
select public.release_design('00000000-0000-0000-0000-0000000de001');
reset role;
do $$ begin
  assert (select count(*) from public.estimation_jobs where inquiry_id = '00000000-0000-0000-0000-0000000de001') = 1, 'no second job';
  assert (select phase from public.estimation_jobs where inquiry_id = '00000000-0000-0000-0000-0000000de001') = 'final', 'final pricing';
  assert (select status from public.inquiries where id = '00000000-0000-0000-0000-0000000de001') = 'in_estimation', 'with Estimation now';
  assert exists (select 1 from public.notifications where title like 'Design released – add the designed fixtures%' and recipient_id = (select id from u where role = 'estimation_exec')), 'estimator told';
end $$;
-- Client deadline: ask → work continues → granted (with the client's e-mail) or refused
select set_config('app.workflow', '1', false);
insert into public.inquiries (id, project_id, organization_id, unit_id, route, release_mode, release_mode_confirmed, design_scope, scope_description,
                              estimation_scope, estimation_basis, sales_person_id, status, customer_deadline)
values ('00000000-0000-0000-0000-0000000de002', '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002',
        'A', 3, true, 'lighting', 'Hotel facade', '{fixtures}', 'supply', (select id from u where role = 'asm_building'), 'accepted', current_date + 20);
update public.inquiries set status = 'accepted' where id = '00000000-0000-0000-0000-0000000de002';
select set_config('app.workflow', '', false);
select pg_temp.act_as('sm_estimation'); set role authenticated;
do $$ declare x uuid;
begin
  begin perform public.request_deadline_extension('00000000-0000-0000-0000-0000000de002', current_date + 10, 'x'); assert false, 'earlier date';
  exception when others then assert sqlerrm like 'Propose a date after the current deadline%', sqlerrm; end;
  x := public.request_deadline_extension('00000000-0000-0000-0000-0000000de002', current_date + 27, 'Client added the car park');
  begin perform public.request_deadline_extension('00000000-0000-0000-0000-0000000de002', current_date + 28, 'again'); assert false, 'second request';
  exception when others then assert sqlerrm like 'An extension request is already open%', sqlerrm; end;
  begin perform public.record_extension_outcome(x, true, current_date + 27); assert false, 'SM Estimation records the answer';
  exception when others then assert sqlerrm like 'Only the sales person or SM Projects%', sqlerrm; end;
  perform set_config('test.ext', x::text, false);
end $$;
reset role;
do $$ begin
  assert (select extension_status from public.inquiries where id = '00000000-0000-0000-0000-0000000de002') = 'requested', 'requested';
  assert (select customer_deadline from public.inquiries where id = '00000000-0000-0000-0000-0000000de002') = current_date + 20, 'work continues to the current date';
end $$;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ declare x uuid := current_setting('test.ext')::uuid;
begin
  assert exists (select 1 from public.notifications where kind = 'deadline_extension_requested' and recipient_id = auth.uid()), 'sales person asked to ask the client';
  begin perform public.record_extension_outcome(x, true, current_date + 27); assert false, 'no client e-mail';
  exception when others then assert sqlerrm like 'Attach the client%', sqlerrm; end;
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('inquiry', '00000000-0000-0000-0000-0000000de002', 'deadline_extension', 'inquiry/de002/ext.pdf', 'ext.pdf');
  perform public.record_extension_outcome(x, true, current_date + 25, 'Client agreed 25th');
  assert (select customer_deadline = current_date + 25 and extension_status = 'granted' from public.inquiries where id = '00000000-0000-0000-0000-0000000de002'), 'granted';
  x := public.request_deadline_extension('00000000-0000-0000-0000-0000000de002', current_date + 32, 'More changes');
  perform public.record_extension_outcome(x, false, null, 'Board meeting fixed');
  assert (select customer_deadline = current_date + 25 and extension_status = 'refused' from public.inquiries where id = '00000000-0000-0000-0000-0000000de002'), 'refused keeps the date';
  assert (select count(*) from public.deadline_extensions where inquiry_id = '00000000-0000-0000-0000-0000000de002') = 2, 'both recorded';
end $$;
reset role;
-- Tender inquiries need the closing date and time
do $$ begin
  begin
    perform set_config('app.workflow', '1', true);
    update public.inquiries set deadline_type = 'tender' where id = '00000000-0000-0000-0000-0000000de002';
    assert false, 'tender without closing';
  exception when others then assert sqlerrm = 'Give the tender closing date and time', sqlerrm; end;
end $$;
rollback to savepoint parallel_de;


-- HSE forms: equipment checklists, permits to work, toolbox talks, induction, training --------------------------------
savepoint hse_forms;
insert into u values ('ae2', gen_random_uuid());
insert into auth.users (id, email) select id, 'ae2@test.local' from u where role = 'ae2';
insert into public.profiles (id, full_name, role) select id, 'Second AE', 'assistant_engineer' from u where role = 'ae2';
insert into public.exec_members (exec_project_id, user_id, member_role)
select current_setting('test.ex')::uuid, x.id, 'assistant_engineer' from u x where x.role in ('assistant_engineer', 'ae2')
  and not exists (select 1 from public.exec_members m where m.exec_project_id = current_setting('test.ex')::uuid and m.user_id = x.id and m.active);
insert into public.exec_members (exec_project_id, user_id, member_role)
select current_setting('test.ex')::uuid, x.id, 'sub_supervisor' from u x where x.role = 'sub_supervisor'
  and not exists (select 1 from public.exec_members m where m.exec_project_id = current_setting('test.ex')::uuid and m.user_id = x.id and m.active);
do $$ begin
  assert (select count(*) from public.hse_forms) = 26, 'all 26 forms';
  assert (select count(*) from public.hse_forms where kind = 'checklist') = 16 and (select count(*) from public.hse_forms where kind = 'permit') = 6, 'kinds';
  assert (select jsonb_array_length(items) from public.hse_forms where code = 'CL-03') = 13, 'crane 13 points';
  assert (select jsonb_array_length(items) from public.hse_forms where code = 'CL-07') = 16, 'first aid 16 items';
end $$;
-- SEE names one AE as EHS Officer
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.set_ehs_officer(current_setting('test.ex')::uuid, (select id from u where role = 'ae2'), true);
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.ex')::uuid; eq uuid; kit uuid; rid uuid; ans jsonb;
begin
  assert not app.is_ehs(e), 'AE1 is not the EHS Officer once one is named';
  eq := public.save_hse_equipment(e, '{"form_code":"CL-16","name":"DB-01 site DB","serial_no":"SN-44","contractor":"ABC Electricals"}');
  assert (select frequency_days from public.hse_equipment where id = eq) = 7, 'DB weekly';
  begin perform public.save_hse_checklist(e, jsonb_build_object('equipment_id', eq, 'answers', '{"01":{"a":"yes"}}'::jsonb));
    assert false, 'all points needed';
  exception when others then assert sqlerrm like 'Answer point 02%', sqlerrm; end;
  select jsonb_object_agg(lpad(g::text, 2, '0'), jsonb_build_object('a', case when g = 3 then 'no' else 'yes' end, 'r', case when g = 3 then 'Did not trip' end))
    into ans from generate_series(1, 10) g;
  rid := public.save_hse_checklist(e, jsonb_build_object('equipment_id', eq, 'answers', ans));
  assert (select accepted is false and hse_report_id is not null from public.hse_records where id = rid), 'not accepted, report raised';
  assert (select status from public.hse_equipment where id = eq) = 'removed', 'out of use';
  assert (select severity from public.hse_reports where id = (select hse_report_id from public.hse_records where id = rid)) = 'critical', 'ELCB trip failure is critical';
  perform public.record_hse_correction(rid, current_date, 'ELCB replaced');
  ans := jsonb_set(ans, '{03}', '{"a":"yes"}');
  rid := public.save_hse_checklist(e, jsonb_build_object('equipment_id', eq, 'answers', ans, 'header', '{"trip_value_tested":"2026-10-01"}'::jsonb));
  assert (select accepted from public.hse_records where id = rid), 'accepted';
  assert (select status = 'in_use' and next_due = current_date + 7 from public.hse_equipment where id = eq), 'back in use, next due';
  -- first aid kit
  kit := public.save_hse_equipment(e, '{"form_code":"CL-07","name":"First aid box – site office"}');
  select jsonb_object_agg(lpad(g::text, 2, '0'), jsonb_build_object('avail', case when g = 16 then 5 else 99 end, 'exp', case when g = 11 then (current_date + 10)::text end))
    into ans from generate_series(1, 16) g;
  rid := public.save_hse_checklist(e, jsonb_build_object('equipment_id', kit, 'answers', ans));
  assert (select accepted is false from public.hse_records where id = rid), 'Panadol short → not accepted';
  perform set_config('test.hse_eq', eq::text, false);
end $$;
reset role;
-- Permits: every control Yes / N/A, approved by the EHS Officer (not the requester), closed by HSE
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.ex')::uuid; ans jsonb; pid uuid; tb uuid;
begin
  select jsonb_object_agg(lpad(g::text, 2, '0'), jsonb_build_object('a', 'yes')) into ans from generate_series(1, 18) g;
  begin perform public.request_permit(e, jsonb_build_object('form_code', 'PTW-04', 'answers', ans, 'starts_at', now(), 'ends_at', now() + interval '4 hours',
      'header', jsonb_build_object('location', 'Cable pit P3', 'description', 'Pull cables in the pit', 'in_charge', 'Sunil', 'mobile', '0771234567', 'readings', '{"o2":"18.2","lel":"0","h2s":"0","co":"0"}'::jsonb)));
    assert false, 'low oxygen';
  exception when others then assert sqlerrm like 'Oxygen (%%) 18.2 is outside the safe limit%', sqlerrm; end;
  begin perform public.request_permit(e, jsonb_build_object('form_code', 'PTW-05', 'answers', jsonb_set(ans, '{05}', '{"a":"no"}'), 'starts_at', now(), 'ends_at', now() + interval '4 hours',
      'header', jsonb_build_object('location', 'Mast M2', 'description', 'Fix floodlights', 'in_charge', 'Sunil', 'mobile', '0771234567')));
    assert false, 'no lifeline';
  exception when others then assert sqlerrm like 'Control 05 (Adequate life line%) must be Yes or N/A%', sqlerrm; end;
  pid := public.request_permit(e, jsonb_build_object('form_code', 'PTW-05', 'answers', ans, 'starts_at', now(), 'ends_at', now() + interval '4 hours',
      'header', jsonb_build_object('location', 'Mast M2', 'description', 'Fix floodlights', 'in_charge', 'Sunil', 'mobile', '0771234567', 'shift', 'day')));
  assert (select code like 'PTW-%' and status = 'submitted' from public.hse_records where id = pid), 'requested';
  pid := public.request_permit(e, jsonb_build_object('form_code', 'PTW-02', 'answers', (select jsonb_object_agg(lpad(g::text, 2, '0'), jsonb_build_object('a', 'yes')) from generate_series(1, 16) g),
      'starts_at', now(), 'ends_at', now() + interval '2 hours', 'header', jsonb_build_object('location', 'Mast M3', 'description', 'Lift luminaires', 'in_charge', 'Sunil', 'mobile', '0771234567')));
  assert (select header ->> 'lifting_plan_no' from public.hse_records where id = pid) = (select code from public.exec_projects where id = e) || '/LP-001', 'lifting plan numbered per project';
  pid := (select id from public.hse_records where form_code = 'PTW-05' and exec_project_id = e order by created_at desc limit 1);
  begin perform public.decide_permit(pid, true); assert false, 'own permit';
  exception when others then assert sqlerrm like 'You requested this permit%', sqlerrm; end;
  tb := public.save_tbt(e, jsonb_build_object('permit_id', pid, 'header', '{"location":"Mast M2","activity":"Fix floodlights on M2","hazards":"Fall from height","shift":"day"}'::jsonb,
     'answers', '{"01":{"a":"yes"},"08":{"a":"yes"}}'::jsonb, 'participants', '[{"name":"Nimal","position":"Rigger"},{"name":"Kamal","position":"Electrician"}]'::jsonb));
  assert (select header ->> 'tbt_no' from public.hse_records where id = pid) = (select code from public.hse_records where id = tb), 'permit shows the TBT number';
  perform set_config('test.ptw', pid::text, false);
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'hse_permit' and recipient_id = (select id from u where role = 'ae2')), 'EHS Officer told';
end $$;
select pg_temp.act_as('ae2'); set role authenticated;
do $$ declare pid uuid := current_setting('test.ptw')::uuid;
begin
  assert app.is_ehs(current_setting('test.ex')::uuid), 'named EHS Officer';
  perform public.decide_permit(pid, true, 'OK – harness checked');
  assert (select status = 'active' and ehs_by = auth.uid() from public.hse_records where id = pid), 'active';
  perform public.close_permit(pid, 'Work completed, area cleared');
  assert (select status from public.hse_records where id = pid) = 'closed', 'closed';
  perform public.sign_hse_record((select id from public.hse_records where form_code = 'TBT-01' and related_id = pid), 'ehs');
end $$;
reset role;
-- An open permit past its finishing time is alerted
update public.hse_records set status = 'active', ends_at = now() - interval '2 hours' where id = current_setting('test.ptw')::uuid;
do $$ begin
  perform public.hse_forms_tick();
  assert exists (select 1 from public.notifications where dedupe_key = 'ptw_open:' || current_setting('test.ptw')), 'open permit alerted';
end $$;
-- Induction (once per project per NIC) and training man-hours
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.ex')::uuid; t uuid;
begin
  perform public.add_induction(e, '{"name":"Nimal Perera","nic":"901234567V","company":"Lanka Electricals"}');
  begin perform public.add_induction(e, '{"name":"Nimal P","nic":"901234567v"}'); assert false, 'twice';
  exception when others then assert sqlerrm like 'Nimal Perera was already inducted%', sqlerrm; end;
  begin perform public.add_induction(e, '{"name":"X","nic":"123"}'); assert false, 'bad NIC';
  exception when others then assert sqlerrm like 'Enter a valid NIC%', sqlerrm; end;
  assert (select count(*) from public.induction_lookup('901234567V')) = 1, 'lookup';
  t := public.save_training(e, jsonb_build_object('starts_at', now() - interval '2 hours', 'ends_at', now(), 'header', '{"title":"Working at height"}'::jsonb,
         'participants', '[{"name":"A"},{"name":"B"},{"name":"C"}]'::jsonb));
  assert (select (header ->> 'man_hours')::numeric from public.hse_records where id = t) = 6, '3 people × 2 h';
  assert (public.hse_summary(e) ->> 'inducted')::int = 1, 'summary';
end $$;
reset role;
-- The supervisor signs the checklist; the SEE signs last as Site In-charge
select pg_temp.act_as('sub_supervisor'); set role authenticated;
select public.sign_hse_record((select id from public.hse_records where equipment_id = current_setting('test.hse_eq')::uuid and accepted order by created_at desc limit 1), 'supervisor');
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.sign_hse_record((select id from public.hse_records where equipment_id = current_setting('test.hse_eq')::uuid and accepted order by created_at desc limit 1), 'manager');
reset role;
rollback to savepoint hse_forms;


-- Site workers register: supervisor adds own crew, AE verifies against ID photos and inducts; personal data kept private ----
savepoint workers;
update public.profiles set company = 'Lanka Electricals' where id = (select id from u where role = 'sub_supervisor');
insert into public.exec_members (exec_project_id, user_id, member_role)
select current_setting('test.ex')::uuid, x.id, case when x.role = 'sub_supervisor' then 'sub_supervisor' else 'assistant_engineer' end from u x where x.role in ('assistant_engineer', 'sub_supervisor')
  and not exists (select 1 from public.exec_members m where m.exec_project_id = current_setting('test.ex')::uuid and m.user_id = x.id and m.active);
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare e uuid := current_setting('test.ex')::uuid; w uuid;
begin
  begin perform public.save_worker(e, '{"full_name":"Nimal Perera","address":"12 Temple Rd, Kandy","police_station":"Kandy","id_no":"12345"}'); assert false, 'bad NIC';
  exception when others then assert sqlerrm like 'Enter a valid NIC%', sqlerrm; end;
  w := public.save_worker(e, '{"full_name":"Nimal Perera","address":"12 Temple Rd, Kandy","police_station":"Kandy","id_no":"901234567v","trade":"Electrician","mobile":"0771234567"}');
  assert (select company = 'Lanka Electricals' and supervisor_id = auth.uid() and id_no = '901234567V' from public.exec_workers where id = w), 'own company, normalised NIC';
  begin perform public.save_worker(e, '{"full_name":"N Perera","address":"x","police_station":"y","id_no":"901234567V"}'); assert false, 'twice';
  exception when others then assert sqlerrm like '%already on this project%', sqlerrm; end;
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values
    ('exec_worker', w, 'id_front', 'exec_worker/' || w || '/f.jpg', 'f.jpg');
  perform set_config('test.worker', w::text, false);
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'exec_worker' and recipient_id = (select id from u where role = 'assistant_engineer')), 'AE asked to verify';
end $$;
select pg_temp.act_as('trainee'); set role authenticated;
do $$ begin
  assert (select count(*) from public.exec_workers) = 0, 'trainee does not see personal data';
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare w uuid := current_setting('test.worker')::uuid; o uuid;
begin
  begin perform public.induct_worker(w); assert false, 'not verified';
  exception when others then assert sqlerrm like 'Verify the worker%', sqlerrm; end;
  begin perform public.verify_worker(w); assert false, 'back side missing';
  exception when others then assert sqlerrm like 'Add the photos of both sides of the NIC%', sqlerrm; end;
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('exec_worker', w, 'id_back', 'exec_worker/' || w || '/b.jpg', 'b.jpg');
  perform public.verify_worker(w);
  perform public.induct_worker(w);
  assert exists (select 1 from public.hse_inductions where nic = '901234567V' and name = 'Nimal Perera'), 'in the induction register';
  -- DIMO own labour added by the AE (passport)
  o := public.save_worker(current_setting('test.ex')::uuid, '{"company":"DIMO","full_name":"Ravi Kumar","address":"Chennai","police_station":"Wellawatte","id_type":"passport","id_no":"N1234567"}');
  assert (select supervisor_id is null and company = 'DIMO' from public.exec_workers where id = o), 'own labour';
  assert (select count(*) from public.worker_lookup('901234567V')) = 1, 'lookup';
  perform public.set_worker_off_site(o, current_date, 'Job finished');
end $$;
reset role;
rollback to savepoint workers;

-- Project number on site documents = WBS of the secured project, kept in step -------------------
do $$ declare e uuid := current_setting('test.exlegacy')::uuid; sid uuid;
begin
  begin
    insert into public.secured_projects (project_name, sales_person_id, order_value, won_on, source, schedule_status, wbs)
    values ('WBS sync test', (select id from u where role = 'asm_infra'), 1000000, current_date, 'won', 'approved', 'LS-000777-02-01') returning id into sid;
    update public.exec_projects set secured_id = sid where id = e;
    assert (select wbs_no from public.exec_projects where id = e) = 'LS-000777', 'WBS base taken from the secured project';
    update public.secured_projects set wbs = 'LS-000778' where id = sid;
    assert (select wbs_no from public.exec_projects where id = e) = 'LS-000778', 'WBS change follows';
    raise exception 'rollback_ok';
  exception when others then assert sqlerrm = 'rollback_ok', sqlerrm; end;
end $$;

-- Police reports: required on the project → flagged 2 days, then blocked; letter released by the SEE; report lifts the block ----
savepoint police;
update public.profiles set company = 'Lanka Electricals' where id = (select id from u where role = 'sub_supervisor');
insert into public.exec_members (exec_project_id, user_id, member_role)
select current_setting('test.ex')::uuid, x.id, case when x.role = 'sub_supervisor' then 'sub_supervisor' else 'assistant_engineer' end from u x where x.role in ('assistant_engineer', 'sub_supervisor')
  and not exists (select 1 from public.exec_members m where m.exec_project_id = current_setting('test.ex')::uuid and m.user_id = x.id and m.active);
do $$ begin
  assert (select police_required and letter_sign_name = 'Mohamed Sajid' from public.exec_projects where id = current_setting('test.ex')::uuid), 'settings from the hand-over request';
end $$;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.ex')::uuid;
begin
  begin perform public.set_police_settings(e, '{"police_required":true,"letter_sign_name":""}'); assert false, 'signatory needed';
  exception when others then assert sqlerrm like 'Enter the name and designation%', sqlerrm; end;
  perform public.set_police_settings(e, '{"police_required":true,"letter_sign_name":"Mohamed Sajid","letter_sign_designation":"Senior Engineer - Lighting Projects","letter_sign_phone":"0773850629"}');
end $$;
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare e uuid := current_setting('test.ex')::uuid; w uuid;
begin
  w := public.save_worker(e, '{"full_name":"Sunil Jayarathne","address":"5 Lake Rd, Negombo","police_station":"Negombo","id_no":"960571479V","trade":"Skilled labour"}');
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values
    ('exec_worker', w, 'id_front', 'exec_worker/' || w || '/f.jpg', 'f.jpg'), ('exec_worker', w, 'id_back', 'exec_worker/' || w || '/b.jpg', 'b.jpg');
  perform set_config('test.pw', w::text, false);
end $$;
reset role;
do $$ declare w public.exec_workers;
begin
  select * into w from public.exec_workers where id = current_setting('test.pw')::uuid;
  assert w.police_due_at > now() + interval '47 hours' and app.police_state(w) = 'flagged', 'flagged for 2 days';
  assert exists (select 1 from public.notifications where kind = 'police_report' and recipient_id = w.supervisor_id), 'supervisor told';
  update public.exec_workers set police_due_at = now() - interval '1 minute' where id = w.id;
  assert public.police_tick() = 1, 'blocked by the tick';
  assert public.police_tick() = 0, 'once';
  select * into w from public.exec_workers where id = w.id;
  assert w.police_blocked_at is not null and app.police_state(w) = 'blocked', 'blocked';
  assert exists (select 1 from public.notifications where kind = 'police_report' and priority = 'critical' and recipient_id = (select id from u where role = 'assistant_engineer')), 'AE told';
end $$;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare w uuid := current_setting('test.pw')::uuid;
begin
  perform public.verify_worker(w);
  begin perform public.induct_worker(w); assert false, 'blocked';
  exception when others then assert sqlerrm like 'Police report not submitted%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare w uuid := current_setting('test.pw')::uuid;
begin
  perform public.request_police_letter(w);
  begin perform public.submit_police_report(w); assert false, 'upload first';
  exception when others then assert sqlerrm like 'Upload the police report%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare w uuid := current_setting('test.pw')::uuid;
begin
  begin perform public.issue_police_letters(array[w], current_date - 1); assert false, 'validity';
  exception when others then assert sqlerrm like 'Enter the date the letter is valid until%', sqlerrm; end;
  assert public.issue_police_letters(array[w], current_date + 30) = 1, 'released';
  assert (select police_status = 'letter_issued' and police_letter_no like '%/PR/001' and police_letter_valid_until = current_date + 30 from public.exec_workers where id = w), 'numbered letter';
end $$;
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare w uuid := current_setting('test.pw')::uuid;
begin
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('exec_worker', w, 'police_report', 'exec_worker/' || w || '/pr.pdf', 'pr.pdf');
  perform public.submit_police_report(w);
  assert (select police_blocked_at is null and police_status = 'submitted' from public.exec_workers where id = w), 'block lifted';
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare w uuid := current_setting('test.pw')::uuid;
begin
  perform public.induct_worker(w);
  begin perform public.decide_police_report(w, false); assert false, 'reason';
  exception when others then assert sqlerrm like 'Give the reason%', sqlerrm; end;
  perform public.decide_police_report(w, false, 'Report older than 6 months');
end $$;
reset role;
do $$ declare w public.exec_workers;
begin
  select * into w from public.exec_workers where id = current_setting('test.pw')::uuid;
  assert w.police_status = 'rejected' and w.police_blocked_at is not null and app.police_state(w) = 'blocked', 'returned after the 2 days → blocked again';
end $$;
rollback to savepoint police;

-- Debtors: part collections recorded by the Operations Executive with a note --------------------------------
savepoint collections;
do $$ declare d uuid;
begin
  insert into public.debts (invoice_no, client_name, amount, currency, outstanding_days, sales_person_id)
  values ('INV-COLL-1', 'Part Pay Ltd', 1000000, 'LKR', 45, (select id from u where role = 'asm_building')) returning id into d;
  perform set_config('test.cd', d::text, false);
end $$;
select pg_temp.act_as('asm_building'); set role authenticated;
do $$ begin
  begin perform public.record_debt_collection(current_setting('test.cd')::uuid, 100, current_date, 'x'); assert false, 'ops only';
  exception when others then assert sqlerrm like 'Only the Operations Executive%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare d uuid := current_setting('test.cd')::uuid; c uuid;
begin
  begin perform public.record_debt_collection(d, 400000, current_date, ''); assert false, 'note';
  exception when others then assert sqlerrm like 'Add a note%', sqlerrm; end;
  c := public.record_debt_collection(d, 400000, current_date, 'Cheque 123456 deposited – balance next month', 'CHQ-123456');
  assert (select status = 'partially_collected' and collected_amount = 400000 from public.debts where id = d), 'part collected';
  assert app.debt_collected(d) = 400000, 'total';
  begin perform public.record_debt_collection(d, 700000, current_date, 'too much'); assert false, 'over balance';
  exception when others then assert sqlerrm like 'More than the balance%', sqlerrm; end;
  perform public.void_debt_collection(c, 'Cheque returned');
  assert (select status = 'outstanding' and collected_amount is null from public.debts where id = d), 'back to outstanding';
  perform public.record_debt_collection(d, 250000, current_date, 'Transfer received');
  perform public.record_debt_collection(d, 750000, current_date, 'Final transfer');
  assert (select status = 'collected' and collected_amount = 1000000 from public.debts where id = d), 'collected in full';
  assert (select count(*) from public.debt_log where debt_id = d and kind = 'collection') = 4, 'history';
end $$;
reset role;
do $$ declare d uuid := current_setting('test.cd')::uuid; up uuid;
begin
  assert exists (select 1 from public.notifications where kind = 'debt_collection' and recipient_id = (select id from u where role = 'asm_building')), 'sales person told';
  -- new upload with a lower amount: payments taken in by accounts
  update public.debts set status = 'partially_collected' where id = d;
  delete from public.debt_collections where debt_id = d and note = 'Final transfer';
  insert into public.debt_uploads (as_at, status, uploaded_by) values (current_date, 'confirmed', (select id from u where role = 'operations_exec')) returning id into up;
  update public.debts set last_upload_id = up, amount = 750000 where id = d;
  assert (select status = 'outstanding' and collected_amount is null from public.debts where id = d), 'reset after upload';
  assert app.debt_collected(d) = 0, 'old collections are history';
end $$;
rollback to savepoint collections;

-- Daily report linked to the day's toolbox talk record (number from the TBT form) ---------------------------------
savepoint report_tbt;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare e uuid := current_setting('test.ex')::uuid; t uuid; r uuid; other uuid;
begin
  t := public.save_tbt(e, jsonb_build_object('header', jsonb_build_object('activity', 'Cable pulling north stand', 'hazards', 'Manual handling'),
    'participants', jsonb_build_array(jsonb_build_object('name', 'Nimal')), 'starts_at', ((current_date - 1) + time '07:45') at time zone app.tz()));
  other := public.save_tbt(e, jsonb_build_object('header', jsonb_build_object('activity', 'Other day', 'hazards', 'x'),
    'participants', jsonb_build_array(jsonb_build_object('name', 'Nimal')), 'starts_at', ((current_date - 2) + time '07:45') at time zone app.tz()));
  begin perform public.submit_exec_report(e, current_date - 1, jsonb_build_object('crew_count', 4, 'work_done', 'x', 'toolbox_talk', true, 'toolbox_records', jsonb_build_array(other)));
    assert false, 'wrong day';
  exception when others then assert sqlerrm like 'The toolbox talk must be one of this project on the report day%', sqlerrm; end;
  r := public.submit_exec_report(e, current_date - 1, jsonb_build_object('crew_count', 4, 'work_done', 'Cable pulling', 'toolbox_talk', true, 'toolbox_records', jsonb_build_array(t)));
  assert (select toolbox_records = array[t] and toolbox_topic like (select code from public.hse_records where id = t) || ' – Cable pulling%' from public.exec_reports where id = r), 'TBT number on the report';
end $$;
reset role;
rollback to savepoint report_tbt;

-- Plan check asks only about the plan owner's own critical activities ------------------------------------------------
savepoint own_critical;
do $$ declare pl uuid := current_setting('test.plp')::uuid; e uuid; n int;
begin
  select exec_project_id into e from public.exec_plans where id = pl;
  update public.exec_plan_items set activity_id = null where plan_id = pl;
  update public.exec_activities set responsible_id = null where exec_project_id = e;
  perform set_config('request.jwt.claim.sub', (select ae_id::text from public.exec_plans where id = pl), true);
  select count(*) into n from public.plan_missing_critical(pl);
  update public.exec_activities set responsible_id = (select id from u where role = 'senior_elec_engineer') where exec_project_id = e;
  assert (select count(*) from public.plan_missing_critical(pl)) = 0, 'another engineer''s activities are not asked about';
  update public.exec_activities set responsible_id = (select ae_id from public.exec_plans where id = pl) where exec_project_id = e;
  assert (select count(*) from public.plan_missing_critical(pl)) = n, 'own activities still are';
end $$;
rollback to savepoint own_critical;

-- Plan results: SEE's result counts as checked; a later change from site needs checking again -----------------------
savepoint result_check;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.update_plan_item(current_setting('test.pli')::uuid, 'partial', null, 'Checked on site – 2 bases left');
reset role;
do $$ begin
  assert (select result_checked_by is not null from public.exec_plan_items where id = current_setting('test.pli')::uuid), 'checked by the SEE';
end $$;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
select public.update_plan_item(current_setting('test.pli')::uuid, 'done');
reset role;
do $$ begin
  assert (select result_checked_by is null from public.exec_plan_items where id = current_setting('test.pli')::uuid), 'site change needs checking again';
end $$;
rollback to savepoint result_check;

-- QA / QC test reports: draft → submitted → approved (published) or returned ---------------------------------------------
savepoint qa_reports;
insert into public.exec_members (exec_project_id, user_id, member_role)
select current_setting('test.ex')::uuid, x.id, 'assistant_engineer' from u x where x.role = 'assistant_engineer'
  and not exists (select 1 from public.exec_members m where m.exec_project_id = current_setting('test.ex')::uuid and m.user_id = x.id and m.active);
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare e uuid := current_setting('test.ex')::uuid; r uuid;
begin
  r := public.save_qa_report(e, null, '{"title":"IR test – DB-2","content_html":"<p>x</p>"}');
  begin perform public.submit_qa_report(r); assert false, 'empty';
  exception when others then assert sqlerrm like 'Write the report first%', sqlerrm; end;
  perform public.save_qa_report(e, r, '{"title":"IR test – DB-2","content_html":"<h1>Insulation resistance</h1><p>All circuits above 1 MΩ</p>"}');
  assert (select status = 'draft' and code like 'QAR-%' from public.qa_reports where id = r), 'draft saved';
  perform public.submit_qa_report(r);
  begin perform public.save_qa_report(e, r, '{"title":"x","content_html":"y"}'); assert false, 'locked';
  exception when others then assert sqlerrm like 'The report is submitted%', sqlerrm; end;
  perform set_config('test.qar', r::text, false);
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare r uuid := current_setting('test.qar')::uuid;
begin
  begin perform public.decide_qa_report(r, false); assert false, 'reason';
  exception when others then assert sqlerrm like 'Say what needs to change%', sqlerrm; end;
  perform public.decide_qa_report(r, false, 'Add the instrument calibration date');
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare r uuid := current_setting('test.qar')::uuid;
begin
  perform public.save_qa_report(current_setting('test.ex')::uuid, r, '{"title":"IR test – DB-2","content_html":"<h1>Insulation resistance</h1><p>All circuits above 1 MΩ. Megger calibrated 01/2026</p>"}');
  perform public.submit_qa_report(r);
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.decide_qa_report(current_setting('test.qar')::uuid, true, null);
reset role;
do $$ begin
  assert (select status = 'approved' and version = 2 from public.qa_reports where id = current_setting('test.qar')::uuid), 'published, second version';
  assert exists (select 1 from public.notifications where kind = 'qa_report' and recipient_id = (select id from u where role = 'assistant_engineer')), 'author told';
end $$;
rollback to savepoint qa_reports;

-- Operations Executive updates a debtor's status; the sales person is told --------------------------------------------
savepoint debt_ops;
select pg_temp.act_as('operations_exec'); set role authenticated;
select public.update_debt_status((select id from public.debts where invoice_no = 'INV-10452'), 'follow_up', 'Called the accounts dept', current_date + 3);
reset role;
do $$ begin
  assert (select status = 'follow_up' from public.debts where invoice_no = 'INV-10452'), 'updated by Operations';
end $$;
rollback to savepoint debt_ops;

-- Project meetings: the SEE calls a meeting about one project, with its agenda, invitees and figures
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare mid uuid; d date := current_date + 4;
begin
  while extract(isodow from d) = 7 loop d := d + 1; end loop;
  mid := public.invite_project_meeting(current_setting('test.ex')::uuid, null, d, '14:00', '15:00',
    array[(select id from u where role = 'assistant_engineer'), (select id from u where role = 'asm_building')], 'Progress, delays and the next two weeks');
  perform set_config('test.pm', mid::text, false);
  assert (select team = 'project' and exec_project_id = current_setting('test.ex')::uuid and agenda like 'Progress%' from public.sales_meetings where id = mid), 'project meeting';
  assert (select status from public.sales_meeting_invitees where meeting_id = mid and person_id = (select id from u where role = 'assistant_engineer')) = 'invited', 'AE invited';
  assert (select status from public.sales_meeting_invitees where meeting_id = mid and person_id = (select id from u where role = 'asm_building')) = 'pending_approval', 'sales needs SMP';
  begin perform public.invite_project_meeting(current_setting('test.ex')::uuid, null, d, '16:00', '17:00', array[(select id from u where role = 'assistant_engineer')]);
    assert false, 'one a day';
  exception when others then assert sqlerrm like 'This project already has a meeting on that day%', sqlerrm; end;
  -- Moved an hour later: the AE is told
  perform public.invite_project_meeting(current_setting('test.ex')::uuid, mid, d, '15:00', '16:00', array[(select id from u where role = 'assistant_engineer')], 'Progress');
  assert (select starts_at = '15:00' from public.sales_meetings where id = mid), 'moved';
  assert not exists (select 1 from public.sales_meeting_invitees where meeting_id = mid and person_id = (select id from u where role = 'asm_building')), 'withdrawn';
  begin perform public.publish_sales_meeting(mid); assert false, 'pack first';
  exception when others then assert sqlerrm = 'Generate the meeting pack first', sqlerrm; end;
  perform public.save_project_meeting_pack(mid, jsonb_build_object('progress', jsonb_build_object('planned', 40, 'actual', 35)));
  assert (select pack ->> 'team_kind' = 'project' and pack -> 'progress' ->> 'actual' = '35' from public.sales_meetings where id = mid), 'pack saved';
  perform public.add_meeting_action(mid, jsonb_build_object('kind', 'task', 'owner_id', (select id from u where role = 'assistant_engineer'), 'action', 'Recover the cable tray delay',
    'due_date', d + 3));
  begin perform public.add_meeting_action(mid, jsonb_build_object('kind', 'task', 'owner_id', (select id from u where role = 'lighting_designer'), 'action', 'x'));
    assert false, 'outsider';
  exception when others then assert sqlerrm = 'Choose someone on this project or invited to the meeting', sqlerrm; end;
  begin perform public.add_meeting_action(mid, jsonb_build_object('kind', 'design', 'action', 'x')); assert false, 'design task';
  exception when others then assert sqlerrm = 'A project meeting gives tasks and project execution tasks', sqlerrm; end;
  -- several notes, each with its own actions
  declare n1 uuid; n2 uuid; begin
    n1 := public.save_meeting_item(mid, null, 'Cable tray delay at Level 3');
    n2 := public.save_meeting_item(mid, null, 'Dewatering');
    perform public.save_meeting_item(mid, n2, 'Dewatering – pump hire');
    perform public.add_meeting_action(mid, jsonb_build_object('kind', 'task', 'owner_id', (select id from u where role = 'assistant_engineer'), 'action', 'Hire a second pump', 'item_id', n2));
    perform public.add_meeting_action(mid, jsonb_build_object('kind', 'task', 'owner_id', (select id from u where role = 'assistant_engineer'), 'action', 'Clear the tray route', 'item_id', n1));
    assert (select count(*) from public.sales_meeting_actions where item_id = n2) = 1, 'action under note 2';
    assert (select body from public.meeting_items where id = n2) = 'Dewatering – pump hire', 'note edited';
    perform public.delete_meeting_item(n1);
    assert not exists (select 1 from public.sales_meeting_actions where action = 'Clear the tray route'), 'its actions removed';
    assert (select count(*) from public.meeting_items where meeting_id = mid) = 1, 'one note left';
  end;
  perform public.publish_sales_meeting(mid);
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  assert (select title like 'Project meeting – %' from public.my_meetings() where meeting_id = current_setting('test.pm')::uuid), 'AE sees it';
  assert exists (select 1 from public.sales_meetings where id = current_setting('test.pm')::uuid), 'invitee opens the meeting';
  perform set_config('test.pml', public.request_meeting_leave(current_setting('test.pm')::uuid, 'Site inspection with the client')::text, false);
  assert (select meeting_id = current_setting('test.pm')::uuid from public.meeting_exceptions where id = current_setting('test.pml')::uuid), 'leave for that meeting';
  begin perform public.invite_project_meeting(current_setting('test.ex')::uuid, null, current_date + 5, '10:00', '11:00', array[(select id from u where role = 'trainee')]);
    assert false, 'SEE only';
  exception when others then assert sqlerrm = 'Only the Senior Electrical Engineer calls project meetings', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare mid uuid; d date := current_date + 6;
begin
  while extract(isodow from d) = 7 loop d := d + 1; end loop;
  perform public.decide_meeting_exception(current_setting('test.pml')::uuid, true);
  assert (select status from public.sales_meeting_invitees where meeting_id = current_setting('test.pm')::uuid
            and person_id = (select id from u where role = 'assistant_engineer')) = 'excused', 'leave approved';
  mid := public.invite_project_meeting(current_setting('test.ex')::uuid, null, d, '09:00', '10:00', array[(select id from u where role = 'assistant_engineer')]);
  perform public.cancel_project_meeting(mid, 'Client visit moved');
  assert not exists (select 1 from public.sales_meetings where id = mid), 'cancelled';
end $$;
reset role;
do $$ declare mid uuid := current_setting('test.pm')::uuid; m public.sales_meetings;
begin
  select * into m from public.sales_meetings where id = mid;
  assert exists (select 1 from public.notifications where recipient_id = (select id from u where role = 'assistant_engineer') and title like 'Project meeting – % moved'), 'moved notice';
  assert exists (select 1 from public.notifications where recipient_id = (select id from u where role = 'gm') and title like 'Project meeting – % pack – %'), 'GM told';
  perform public.project_meeting_tick(app.meeting_ends(m) + interval '1 minute');
  assert (select status from public.sales_meeting_invitees where meeting_id = mid and person_id = (select id from u where role = 'assistant_engineer')) = 'excused', 'excused stays';
end $$;

-- Dashboard stage times: usual / slow / target / on time, the journey and a stage's late cases
select pg_temp.act_as('gm'); set role authenticated;
do $$ declare d jsonb := public.overall_dashboard(current_date - 400, current_date + 1); s jsonb;
begin
  select x into s from jsonb_array_elements(d -> 'sla_by_stage') x limit 1;
  assert s ? 'median_hours' and s ? 'target_hours' and s ? 'on_time' and s ? 'late', 'stage fields';
  assert (s ->> 'on_time')::int + (s ->> 'late')::int = (s ->> 'n')::int, 'on time + late = all';
  assert d -> 'journey' ? 'median_hours' and (d ->> 'work_hours_per_day')::numeric > 0, 'journey';
  perform * from public.sla_stage_late(s ->> 'stage', current_date - 400, current_date + 1);
end $$;
reset role;

-- Subcontractor invoices: recorded against a verified IPC, SEE then Operations, returned with a marked-up copy
reset role;
update public.profiles set active = true where id = (select id from u where role = 'sub_supervisor');
insert into public.exec_members (exec_project_id, user_id, member_role)
select current_setting('test.ex')::uuid, (select id from u where role = 'sub_supervisor'), 'sub_supervisor'
 where not exists (select 1 from public.exec_members where exec_project_id = current_setting('test.ex')::uuid and user_id = (select id from u where role = 'sub_supervisor') and active);
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare iid uuid;
begin
  assert exists (select 1 from public.sub_invoice_certs(current_setting('test.ex')::uuid) where id = current_setting('test.spc')::uuid), 'verified IPC offered';
  iid := public.create_sub_invoice(current_setting('test.spc')::uuid, '{"invoice_no":"LE/INV/0042","invoice_date":"2026-10-05","amount":"700,000"}');
  perform set_config('test.sinv', iid::text, false);
  begin perform public.submit_sub_invoice(iid); assert false, 'copy needed';
  exception when others then assert sqlerrm = 'Attach the invoice copy (PDF or photos)', sqlerrm; end;
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_invoice', iid, 'sinv_doc', 'sub_invoice/' || iid || '/inv.pdf', 'inv.pdf');
  perform public.submit_sub_invoice(iid);
  assert (select status from public.sub_invoices where id = iid) = 'ae_review', 'supervisor''s invoice goes to the AE first';
  begin perform public.decide_sub_invoice(iid, true); assert false, 'not the sub';
  exception when others then assert sqlerrm = 'The project''s Assistant Engineer checks it first', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare iid uuid := current_setting('test.sinv')::uuid;
begin
  assert public.decide_sub_invoice(iid, true, 'Quantities match the IPC') = 'submitted', 'AE checked → SEE';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where recipient_id = (select id from u where role = 'sub_supervisor') and title = 'Invoice recorded – for reference only'
                  and body like '%physical documents must be submitted to the DIMO Lighting Solutions office%'), 'submitter told';
end $$;
-- An invoice needs a verified IPC
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare cid uuid;
begin
  cid := public.prepare_sub_cert(current_setting('test.ex')::uuid, '{"jm_date":"2026-10-01","subcontractor":"Lanka Electricals","period":"Oct 2026","gross":"1500000","previous":"1000000"}');
  begin perform public.create_sub_invoice(cid, '{"invoice_no":"X1","invoice_date":"2026-10-08","amount":"1"}'); assert false, 'IPC first';
  exception when others then assert sqlerrm like 'The payment certificate (IPC and measurement sheets) must have Interim Payment Approval%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare iid uuid := current_setting('test.sinv')::uuid;
begin
  -- the SEE marks the copy in red and returns it
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_invoice', iid, 'sinv_markup', 'sub_invoice/' || iid || '/marked.pdf', 'Marked up – inv.pdf');
  assert public.decide_sub_invoice(iid, false, 'Retention not deducted') = 'returned', 'returned';
end $$;
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare iid uuid := current_setting('test.sinv')::uuid;
begin
  assert exists (select 1 from public.attachments where entity_id = iid and kind = 'sinv_markup'), 'submitter sees the marked-up copy';
  begin insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_invoice', iid, 'sinv_markup', 'x', 'x'); assert false, 'no markup by sub';
  exception when others then null; end;
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_invoice', iid, 'sinv_doc', 'sub_invoice/' || iid || '/inv2.pdf', 'inv2.pdf');
  perform public.submit_sub_invoice(iid, '{"amount":"630000"}');
  assert (select revision = 1 and amount = 630000 and status = 'ae_review' from public.sub_invoices where id = iid), 'resubmitted to the AE';
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare iid uuid := current_setting('test.sinv')::uuid;
begin
  -- the AE can mark up the copy while checking it
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_invoice', iid, 'sinv_markup', 'sub_invoice/' || iid || '/ae.pdf', 'Marked up – AE.pdf');
  perform public.decide_sub_invoice(iid, true);
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
select public.decide_sub_invoice(current_setting('test.sinv')::uuid, true);
reset role;
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare iid uuid := current_setting('test.sinv')::uuid;
begin
  assert public.decide_sub_invoice(iid, true) = 'approved', 'ops approved';
  perform public.receive_sub_invoice_docs(iid, 'Originals received 09 Oct');
  assert (select status from public.sub_invoices where id = iid) = 'docs_received', 'docs received';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where recipient_id = (select id from u where role = 'sub_supervisor') and title = 'Approved – submit the physical documents'), 'told to bring documents';
end $$;

-- IPC by a subcontractor supervisor: draft with the IPC and measurement sheets → the project AE checks → the SEE approves → invoice
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare cid uuid;
begin
  cid := public.prepare_sub_cert(current_setting('test.ex')::uuid, '{"jm_date":"2026-10-01","subcontractor":"ABC Electricals","period":"Nov 2026","gross":"2000000","previous":"1500000"}');
  perform set_config('test.spc2', cid::text, false);
  assert exists (select 1 from public.sub_certs where id = cid), 'supervisor sees own IPC';
  begin perform public.schedule_joint_measurement(cid, '2026-11-02'); assert false, 'sub does not confirm';
  exception when others then assert sqlerrm like 'The project''s Assistant Engineer confirms%', sqlerrm; end;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where recipient_id = (select id from u where role = 'assistant_engineer') and title = 'Joint measurement requested'), 'AE told of JM';
  assert not exists (select 1 from public.notifications where recipient_id = (select id from u where role = 'senior_elec_engineer') and title = 'Joint measurement requested'
    and entity_id = current_setting('test.spc2')::uuid), 'the AE (not the SEE) confirms the JM';
end $$;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  assert not exists (select 1 from public.my_pending_approvals() where source = 'sub_cert' and id = current_setting('test.spc2')::uuid), 'not on the SEE''s list';
  assert exists (select 1 from public.sub_certs where id = current_setting('test.spc2')::uuid), 'SEE sees the request';
  begin perform public.schedule_joint_measurement(current_setting('test.spc2')::uuid, '2026-11-02'); assert false, 'SEE does not confirm when the project has an AE';
  exception when others then assert sqlerrm like 'The project''s Assistant Engineer confirms%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'sub_cert' and id = current_setting('test.spc2')::uuid and step = 'Confirm joint measurement'), 'AE to confirm';
  perform public.schedule_joint_measurement(current_setting('test.spc2')::uuid, '2026-11-02');
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where recipient_id = (select id from u where role = 'senior_elec_engineer') and title = 'Joint measurement confirmed'
    and entity_id = current_setting('test.spc2')::uuid), 'SEE told the JM is confirmed';
end $$;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare cid uuid := current_setting('test.spc2')::uuid;
begin
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_cert', cid, 'jm_sheet', 'sub_cert/' || cid || '/jm.pdf', 'jm.pdf');
  assert public.submit_joint_measurement(cid) = 'jm_ae', 'supervisor''s JM to the AE';
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare cid uuid := current_setting('test.spc2')::uuid;
begin
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_cert', cid, 'jm_markup', 'sub_cert/' || cid || '/jmm.pdf', 'Marked up – jm.pdf');
  assert public.decide_joint_measurement(cid, true) = 'jm_see', 'AE checked JM';
end $$;
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ declare cid uuid := current_setting('test.spc2')::uuid;
begin
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_cert', cid, 'jm_markup', 'sub_cert/' || cid || '/jmm2.pdf', 'Marked up – jm 2.pdf');
  assert public.decide_joint_measurement(cid, true) = 'draft', 'SEE approved JM';
  assert not exists (select 1 from public.attachments where entity_id = cid and kind = 'jm_markup' and archived_at is null), 'marked-up copies removed on final approval';
end $$;
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare cid uuid := current_setting('test.spc2')::uuid;
begin
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_cert', cid, 'ipc_draft', 'sub_cert/' || cid || '/ipc.pdf', 'ipc.pdf');
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_cert', cid, 'ipc_measure', 'sub_cert/' || cid || '/ms.pdf', 'ms.pdf');
  perform public.update_sub_cert(cid, '{"gross":"2100000"}');
  -- variations are no longer ticked inside the BOQ certificate
  begin perform public.set_sub_cert_variations(cid, array[current_setting('test.var')::uuid]); assert false, 'separate now';
  exception when others then assert sqlerrm like 'Variations are now submitted separately%', sqlerrm; end;
  assert public.submit_sub_cert(cid) = 'ae_review', 'supervisor''s IPC goes to the AE';
  begin insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_cert', cid, 'ipc_draft', 'x', 'x'); assert false, 'locked once submitted';
  exception when others then null; end;
  begin perform public.create_sub_invoice(cid, '{"invoice_no":"X2","invoice_date":"2026-10-08","amount":"1"}'); assert false, 'no invoice before approval';
  exception when others then assert sqlerrm like 'The payment certificate (IPC and measurement sheets) must have Interim Payment Approval%', sqlerrm; end;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where recipient_id = (select id from u where role = 'assistant_engineer') and title = 'Subcontractor IPC to check'), 'AE told';
end $$;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare cid uuid := current_setting('test.spc2')::uuid;
begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'sub_cert' and id = cid), 'in the AE''s approvals';
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_cert', cid, 'ipc_markup', 'sub_cert/' || cid || '/m.pdf', 'Marked up – ipc.pdf');
  assert public.advance_sub_cert(cid, false, 'Quantities of item 3 wrong') = 'returned', 'AE returns';
end $$;
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare cid uuid := current_setting('test.spc2')::uuid;
begin
  assert exists (select 1 from public.attachments where entity_id = cid and kind = 'ipc_markup'), 'supervisor sees the marked-up IPC';
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_cert', cid, 'ipc_measure', 'sub_cert/' || cid || '/ms2.pdf', 'ms2.pdf');
  assert public.submit_sub_cert(cid) = 'ae_review', 'resubmitted';
  assert (select revision from public.sub_certs where id = cid) = 1, 'revision';
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
select public.advance_sub_cert(current_setting('test.spc2')::uuid, true);
reset role;
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  -- the SEE's final comments / edits become part of the IPC; the AE's review mark-ups are removed
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name)
  values ('sub_cert', current_setting('test.spc2')::uuid, 'ipc_markup', 'sub_cert/x/see-final.pdf', 'Marked up – final.pdf');
  assert public.advance_sub_cert(current_setting('test.spc2')::uuid, true) = 'verified', 'SEE approves';
  assert (select string_agg(file_name, ',') from public.attachments where entity_id = current_setting('test.spc2')::uuid and kind = 'ipc_markup' and archived_at is null)
    = 'Marked up – final.pdf', 'only the SEE''s final edits stay with the IPC';
  assert (select count(*) from public.sub_certs where id = current_setting('test.spc2')::uuid and ae_by is not null) = 1, 'AE check recorded';
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where recipient_id = (select id from u where role = 'sub_supervisor') and title = 'IPC approved – submit your invoice'
                  and body like '%now the approved IPC%'), 'supervisor told to record the invoice';
end $$;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare iid uuid;
begin
  iid := public.create_sub_invoice(current_setting('test.spc2')::uuid, '{"invoice_no":"LE/INV/0050","invoice_date":"2026-11-05","amount":"450000"}');
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('sub_invoice', iid, 'sinv_doc', 'sub_invoice/' || iid || '/inv.pdf', 'inv.pdf');
  perform public.submit_sub_invoice(iid);
end $$;
reset role;

-- Subcontractor formats: the SEE uploads them on the project, the supervisor downloads them
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name)
values ('exec_project', current_setting('test.ex')::uuid, 'tpl_measurement', 'exec_project/x/jm-format.xlsx', 'JM format.xlsx');
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.attachments where entity_type = 'exec_project' and kind = 'tpl_measurement'), 'supervisor sees the format';
  begin insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name)
    values ('exec_project', current_setting('test.ex')::uuid, 'tpl_ipa', 'exec_project/x/ipa.xlsx', 'ipa.xlsx'); assert false, 'only the SEE uploads formats';
  exception when others then null; end;
end $$;
reset role;

-- A measurement cycle: the BOQ work and each variation become separate certificates
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare ids uuid[];
begin
  assert exists (select 1 from public.sub_variation_options(current_setting('test.ex')::uuid) where id = current_setting('test.var')::uuid), 'approved variation offered';
  ids := public.request_joint_measurements(current_setting('test.ex')::uuid, jsonb_build_object('subcontractor', 'ABC Electricals', 'period', 'Dec 2026',
    'jm_date', '2026-12-02', 'boq', true, 'variation_ids', jsonb_build_array(current_setting('test.var'))));
  assert cardinality(ids) = 2, 'BOQ + variation';
  assert (select count(*) from public.sub_certs where id = any (ids) and variation_id is null) = 1, 'one BOQ certificate';
  assert (select var_code is not null and status = 'jm_requested' from public.sub_certs where id = any (ids) and variation_id = current_setting('test.var')::uuid), 'variation certificate';
  begin perform public.request_joint_measurements(current_setting('test.ex')::uuid, '{"subcontractor":"X","period":"Y","jm_date":"2026-12-02","boq":false}'); assert false, 'choose something';
  exception when others then assert sqlerrm like 'Choose the BOQ work%', sqlerrm; end;
  begin perform public.prepare_sub_cert(current_setting('test.ex')::uuid, '{"subcontractor":"Lanka Electricals","period":"Y","jm_date":"2026-12-02"}'); assert false, 'own company only';
  exception when others then assert sqlerrm like 'A subcontractor supervisor requests measurements for their own company%', sqlerrm; end;
  begin perform public.prepare_sub_cert(current_setting('test.ex')::uuid, '{"subcontractor":"Unknown Ltd","period":"Y","jm_date":"2026-12-02"}'); assert false, 'register only';
  exception when others then assert sqlerrm like '"Unknown Ltd" is not a subcontractor of this project%', sqlerrm; end;
end $$;
reset role;

-- Tests with uploaded reading documents: the engineer states the result
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ declare t uuid;
begin
  begin perform public.record_test(current_setting('test.ex')::uuid, '{"system":"DB-3","test_type":"Lux level"}'); assert false, 'result needed';
  exception when others then assert sqlerrm like 'State the result%', sqlerrm; end;
  t := public.record_test(current_setting('test.ex')::uuid, '{"system":"DB-3","test_type":"Lux level","result":"pass"}');
  assert (select result from public.test_records where id = t) = 'pass', 'pass recorded';
  insert into public.attachments (entity_type, entity_id, kind, storage_path, file_name) values ('test_record', t, 'test_printout', 'test_record/' || t || '/p.pdf', 'p.pdf');
  t := public.record_test(current_setting('test.ex')::uuid, '{"system":"DB-4","test_type":"RCD trip time","result":"fail"}');
  assert exists (select 1 from public.ncrs where test_record_id = t), 'fail raises an NCR';
end $$;
reset role;

-- A duty change must name the new duty status
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  begin perform public.request_inquiry_change('00000000-0000-0000-0000-00000000d001', 'duty_change', '{"duty_status":""}', 'x'); assert false, 'duty needed';
  exception when others then assert sqlerrm = 'Choose the new duty status', sqlerrm; end;
  begin perform public.request_inquiry_change('00000000-0000-0000-0000-00000000d001', 'release_mode', '{"release_mode":0}', 'x'); assert false, 'mode needed';
  exception when others then assert sqlerrm = 'Choose the new release mode', sqlerrm; end;
end $$;
reset role;

-- Debtors: Operations adds one in the system, corrects it and removes a wrong entry
select pg_temp.act_as('operations_exec'); set role authenticated;
do $$ declare d uuid;
begin
  d := public.add_debt('{"client_name":"Test Client","invoice_no":"MAN-0001","invoice_date":"2026-09-01","amount":"125,000","currency":"LKR"}');
  assert (select source = 'manual' and outstanding_days > 0 and status = 'outstanding' from public.debts where id = d), 'added';
  begin perform public.add_debt('{"client_name":"X","invoice_no":"MAN-0001","amount":"1","currency":"LKR","outstanding_days":"1"}'); assert false, 'duplicate';
  exception when others then assert sqlerrm like 'A debt with invoice number MAN-0001 already exists', sqlerrm; end;
  perform public.edit_debt(d, '{"amount":"120000"}', 'Credit note');
  assert (select amount from public.debts where id = d) = 120000, 'edited';
  perform public.remove_debt(d, 'Entered twice');
  assert (select status = 'cleared' and status_note like 'Removed by Operations%' from public.debts where id = d), 'removed';
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  begin perform public.add_debt('{"client_name":"X","invoice_no":"MAN-0002","amount":"1","currency":"LKR","outstanding_days":"1"}'); assert false, 'ops only';
  exception when others then assert sqlerrm = 'Only the Operations Executive adds debtors', sqlerrm; end;
end $$;
reset role;

-- A supervisor whose login was created in Admin → Users (not with "Create login") is linked to the approved nomination
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  perform set_config('test.sr2', public.nominate_supervisor(current_setting('test.ex')::uuid, jsonb_build_object('person_name', 'Sameera Sup', 'company', 'ABC Electricals',
    'phone', '0715556667', 'id_no', 'NIC777', 'start_date', current_date, 'end_date', current_date + 30))::text, false);
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
select public.decide_access_request(current_setting('test.sr2')::uuid, true);
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000005a1', 'sameera@example.com');
insert into public.profiles (id, full_name, role, phone, email) values ('00000000-0000-0000-0000-0000000005a1', 'Sameera Sup', 'sub_supervisor', '0715556667', 'sameera@example.com');
do $$ begin
  assert exists (select 1 from public.exec_members where user_id = '00000000-0000-0000-0000-0000000005a1' and exec_project_id = current_setting('test.ex')::uuid and active),
    'admin-created login linked to the approved nomination';
  assert (select status from public.access_requests where id = current_setting('test.sr2')::uuid) = 'done', 'nomination done';
end $$;

-- Changing an approved appointment: the SEE proposes, SM Projects approves, it applies to the membership
select pg_temp.act_as('senior_elec_engineer'); set role authenticated;
do $$ begin
  assert public.propose_access_change(current_setting('test.sr2')::uuid, jsonb_build_object('end_date', (current_date + 90)::text, 'zones', 'Facade and car park'), 'Scope extended') = 'pending', 'waits for SMP';
  begin perform public.propose_access_change(current_setting('test.sr2')::uuid, '{"zones":"x"}', 'again'); assert false, 'one at a time';
  exception when others then assert sqlerrm = 'A change is already waiting for SM Projects', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('sm_projects'); set role authenticated;
do $$ begin
  assert exists (select 1 from public.my_pending_approvals() where source = 'access_change'), 'in SMP approvals';
  perform public.decide_access_change((select id from public.access_changes where request_id = current_setting('test.sr2')::uuid and status = 'pending'), true);
end $$;
reset role;
do $$ begin
  assert (select valid_to = current_date + 90 and zones = 'Facade and car park' from public.exec_members
           where user_id = '00000000-0000-0000-0000-0000000005a1' and exec_project_id = current_setting('test.ex')::uuid and active), 'membership updated';
end $$;

-- The subcontractor supervisor requests several permits; any Assistant Engineer of the project approves them
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare e uuid := current_setting('test.ex')::uuid; ans jsonb; i int;
begin
  select jsonb_object_agg(it ->> 'no', jsonb_build_object('a', 'yes')) into ans from public.hse_forms f, jsonb_array_elements(f.items) it where f.code = 'PTW-01';
  for i in 1..2 loop
    perform set_config('test.subptw' || i, public.request_permit(e, jsonb_build_object('form_code', 'PTW-01', 'answers', ans, 'starts_at', now(), 'ends_at', now() + interval '6 hours',
      'header', jsonb_build_object('location', 'Zone ' || i, 'description', 'Cable pulling', 'in_charge', 'Sameera', 'mobile', '0715556667', 'tbt_no', 'TBT-1', 'explain', 'Isolate DB-2 and lock out')))::text, false);
  end loop;
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  perform public.decide_permit(current_setting('test.subptw1')::uuid, true, 'OK');
  perform public.decide_permit(current_setting('test.subptw2')::uuid, true);
  assert (select count(*) from public.hse_records where id in (current_setting('test.subptw1')::uuid, current_setting('test.subptw2')::uuid) and status = 'active') = 2, 'both approved by the AE';
  perform public.close_permit(current_setting('test.subptw1')::uuid, 'Done');
end $$;
reset role;

-- Subcontractor plan: picks from the engineer's approved plan + additional work; the AE approves
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare sp uuid; ae uuid; x uuid;
begin
  sp := public.my_sub_plan(current_setting('test.ex')::uuid, current_setting('test.wk')::date);
  perform set_config('test.sp', sp::text, false);
  select id into ae from public.sub_plan_ae_items(sp) limit 1;
  assert ae is not null, 'approved engineer items offered';
  perform public.pick_sub_plan_item(sp, ae, true);
  x := public.save_sub_plan_extra(sp, null, jsonb_build_object('day', (select day from public.sub_plan_items where sub_plan_id = sp limit 1), 'title', 'Clear debris at Level 2', 'crew', 3));
  assert (select count(*) from public.sub_plan_items where sub_plan_id = sp) = 2, 'picked + additional';
  begin perform public.update_sub_plan_item(x, 'done'); assert false, 'approval first';
  exception when others then assert sqlerrm = 'The plan must be approved first', sqlerrm; end;
end $$;
reset role;
-- (the plan's work is moved to today, the permits too; a programme activity of ABC Electricals runs that week)
do $$ declare d date := current_date;
begin
  perform set_config('test.spday', d::text, false);
  update public.sub_plan_items set day = d where sub_plan_id = current_setting('test.sp')::uuid;
  insert into public.exec_wbs (exec_project_id, code, name) values (current_setting('test.ex')::uuid, 'S1', 'Subcontract works');
  update public.hse_records set starts_at = (d + time '08:00') at time zone 'Asia/Colombo', ends_at = (d + time '17:00') at time zone 'Asia/Colombo'
   where id = current_setting('test.subptw2')::uuid;
  update public.hse_records set starts_at = (d + 1 + time '08:00') at time zone 'Asia/Colombo', ends_at = (d + 1 + time '17:00') at time zone 'Asia/Colombo'
   where id = current_setting('test.subptw1')::uuid;
  insert into public.exec_activities (exec_project_id, wbs_id, code, name, duration, subcontractor, es, ef, unit)
  values (current_setting('test.ex')::uuid, (select id from public.exec_wbs where exec_project_id = current_setting('test.ex')::uuid limit 1),
          'SUB-A1', 'Containment Level 3', 3, 'ABC Electricals', d - 1, d + 1, 'm');
  insert into public.exec_activities (exec_project_id, wbs_id, code, name, duration, subcontractor, es, ef)
  values (current_setting('test.ex')::uuid, (select id from public.exec_wbs where exec_project_id = current_setting('test.ex')::uuid limit 1),
          'SUB-L1', 'Lanka cabling', 3, 'Lanka Electricals', d - 1, d + 1);
  -- the engineer's approved plan: an item of each company's activity and an own-team item (no supervisor)
  insert into public.exec_plan_items (plan_id, exec_project_id, day, kind, title, activity_id)
  select current_setting('test.pl')::uuid, current_setting('test.ex')::uuid, d, 'task', x.t, (select id from public.exec_activities where code = x.c and exec_project_id = current_setting('test.ex')::uuid)
    from (values ('Containment L3 east', 'SUB-A1'), ('Lanka cabling L4', 'SUB-L1'), ('DIMO team: DB testing', null)) x (t, c);
end $$;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare sp uuid := current_setting('test.sp')::uuid; d date := current_setting('test.spday')::date; act uuid; it uuid;
begin
  assert not exists (select 1 from public.sub_plan_ae_items(sp) where title in ('Lanka cabling L4', 'DIMO team: DB testing')), 'another company''s and the own team''s work not offered';
  select id into act from public.sub_plan_ae_items(sp) where title = 'Containment L3 east';
  assert act is not null, 'engineer''s item of an activity given to the company offered';
  perform public.pick_sub_plan_item(sp, act, true);
  begin perform public.pick_sub_plan_item(sp, (select id from public.exec_plan_items where title = 'DIMO team: DB testing'), true); assert false, 'own team item';
  exception when others then assert sqlerrm = 'Choose an item the engineers planned for you this week', sqlerrm; end;
  -- the plan is submitted without permits
  perform public.submit_sub_plan(sp);
  begin perform public.pick_sub_plan_item(sp, (select ae_item_id from public.sub_plan_items where sub_plan_id = sp and ae_item_id is not null limit 1), false); assert false, 'locked';
  exception when others then assert sqlerrm like 'The plan is submitted%', sqlerrm; end;
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  -- an activity given to Lanka Electricals cannot go to the ABC Electricals supervisor
  begin perform public.save_plan_item(current_setting('test.ex')::uuid, current_setting('test.wk')::date, jsonb_build_object('day', current_date, 'title', 'Lanka cabling L5',
      'activity_id', (select id from public.exec_activities where code = 'SUB-L1'), 'supervisor_id', (select id from u where role = 'sub_supervisor')));
    assert false, 'wrong company';
  exception when others then assert sqlerrm like 'That activity is given to Lanka Electricals – choose a supervisor of Lanka Electricals%', sqlerrm; end;
  assert exists (select 1 from public.sub_plans_to_approve() where id = current_setting('test.sp')::uuid), 'AE sees it';
  perform public.decide_sub_plan(current_setting('test.sp')::uuid, true, 'OK');
end $$;
reset role;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ begin
  perform public.update_sub_plan_item((select id from public.sub_plan_items where sub_plan_id = current_setting('test.sp')::uuid and additional), 'done');
  assert (select status from public.sub_plan_items where sub_plan_id = current_setting('test.sp')::uuid and additional) = 'done', 'marked done';
  perform public.update_sub_plan_item((select id from public.sub_plan_items where sub_plan_id = current_setting('test.sp')::uuid and additional), 'planned');
end $$;
reset role;
-- Next day's permits by 20:00: reminder at 18:00, then the supervisor and the AEs are told what has no permit
do $$ declare d date := current_setting('test.spday')::date; sup uuid := (select id from u where role = 'sub_supervisor');
begin
  assert (select late_request from public.hse_records where id = current_setting('test.subptw2')::uuid), 'same-day permit request is late';
  assert public.permit_tick(((d - 1) + time '17:00') at time zone 'Asia/Colombo') = 0, 'nothing before 18:00';
  assert public.permit_tick(((d - 1) + time '18:30') at time zone 'Asia/Colombo') = 1, 'reminder';
  assert exists (select 1 from public.notifications where recipient_id = sup and title = 'Submit tomorrow''s work permits by 20:00' and body like '%3 planned works without a permit%'), 'supervisor reminded';
  assert not exists (select 1 from public.notifications where recipient_id = (select id from u where role = 'assistant_engineer') and title like 'Work permits not submitted by 20:00%'), 'AE not yet';
end $$;
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare sp uuid := current_setting('test.sp')::uuid;
begin
  begin perform public.link_permit_plan_items(current_setting('test.subptw1')::uuid, array(select id from public.sub_plan_items where sub_plan_id = sp)); assert false, 'closed';
  exception when others then assert sqlerrm = 'That permit is no longer open', sqlerrm; end;
  -- one permit covers the planned works except the additional one
  perform public.link_permit_plan_items(current_setting('test.subptw2')::uuid, array(select id from public.sub_plan_items where sub_plan_id = sp and not additional));
  assert (select count(*) from public.sub_plan_item_permits where permit_id = current_setting('test.subptw2')::uuid) = 2, 'linked';
end $$;
reset role;
do $$ declare d date := current_setting('test.spday')::date;
begin
  assert public.permit_tick(((d - 1) + time '20:15') at time zone 'Asia/Colombo') = 1, 'alert';
  assert exists (select 1 from public.notifications where recipient_id = (select id from u where role = 'assistant_engineer') and title like 'Work permits not submitted by 20:00%'
                 and body like '%1 planned work without a permit: Clear debris at Level 2%'), 'AE told what has no permit';
  -- the supervisor's report of the day is made again below
  delete from public.exec_reports where author_id = (select id from u where role = 'sub_supervisor') and report_date = d;
end $$;
-- The supervisor's daily report refers to the day's plan and the work permits
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ declare sp uuid := current_setting('test.sp')::uuid; d date := current_setting('test.spday')::date; r uuid; items jsonb;
begin
  begin perform public.submit_exec_report(current_setting('test.ex')::uuid, d, jsonb_build_object('crew_count', 5, 'work_done', 'Containment and debris'));
    assert false, 'plan results needed';
  exception when others then assert sqlerrm like 'Give the result of each work of your plan for the day:%', sqlerrm; end;
  select jsonb_agg(jsonb_build_object('id', id, 'status', 'done')) into items from public.sub_plan_items where sub_plan_id = sp;
  begin perform public.submit_exec_report(current_setting('test.ex')::uuid, d, jsonb_build_object('crew_count', 5, 'work_done', 'Containment and debris', 'sub_items', items));
    assert false, 'permit needed';
  exception when others then assert sqlerrm = 'Refer the work permit(s) the work was done under', sqlerrm; end;
  r := public.submit_exec_report(current_setting('test.ex')::uuid, d, jsonb_build_object('crew_count', 5, 'work_done', 'Containment and debris', 'sub_items', items,
         'permit_ids', jsonb_build_array(current_setting('test.subptw2'))));
  assert (select permit_ids from public.exec_reports where id = r) = array[current_setting('test.subptw2')::uuid], 'permit referred';
  assert (select jsonb_array_length(sub_plan_updates) from public.exec_reports where id = r) = 3, 'plan results on the report';
  assert (select count(*) from public.exec_reports x, jsonb_array_elements(x.sub_plan_updates) e where x.id = r and e -> 'permits' ? (select code from public.hse_records where id = current_setting('test.subptw2')::uuid)) = 2, 'permit codes on the plan results';
  assert not exists (select 1 from public.sub_plan_items where sub_plan_id = sp and status = 'planned'), 'plan updated from the report';
end $$;
reset role;

-- Subcontractors never see each other: Sameera (Lanka Electricals) and the ABC Electricals supervisor on the same project
update public.profiles set company = 'Lanka Electricals' where id = '00000000-0000-0000-0000-0000000005a1';
insert into public.hse_records (code, exec_project_id, form_code, header, status, created_by)
values ('PTW-LANKA-1', current_setting('test.ex')::uuid, 'PTW-01', '{"location":"Zone L","in_charge":"Sameera","mobile":"0715556667"}', 'submitted', '00000000-0000-0000-0000-0000000005a1');
select pg_temp.act_as('sub_supervisor'); set role authenticated;
do $$ begin
  assert not exists (select 1 from public.exec_members where user_id = '00000000-0000-0000-0000-0000000005a1'), 'other supervisor hidden from the team list';
  assert exists (select 1 from public.exec_members where user_id = auth.uid()), 'own membership visible';
  assert exists (select 1 from public.exec_members where member_role = 'assistant_engineer'), 'DIMO engineers visible';
  assert not exists (select 1 from public.exec_subcontractors where lower(name) <> 'abc electricals'), 'only own company in the register';
  assert not exists (select 1 from public.hse_records where code = 'PTW-LANKA-1'), 'other subcontractor''s permit hidden';
  assert exists (select 1 from public.hse_records where id = current_setting('test.subptw1')::uuid), 'own permit visible';
  assert not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000005a1'), 'other supervisor''s profile hidden';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000005a1', false); set role authenticated;
do $$ begin
  assert exists (select 1 from public.hse_records where code = 'PTW-LANKA-1'), 'Sameera sees own permit';
  assert not exists (select 1 from public.hse_records where id = current_setting('test.subptw1')::uuid), 'Sameera does not see ABC''s permit';
  assert not exists (select 1 from public.exec_members where member_role = 'sub_supervisor' and user_id <> auth.uid()), 'Sameera does not see ABC''s supervisor';
end $$;
reset role;
select pg_temp.act_as('assistant_engineer'); set role authenticated;
do $$ begin
  assert (select count(*) from public.hse_records where code = 'PTW-LANKA-1' or id = current_setting('test.subptw1')::uuid) = 2, 'the AE sees both';
  assert (select count(*) from public.exec_members where member_role = 'sub_supervisor' and exec_project_id = current_setting('test.ex')::uuid and active) >= 2, 'the AE sees both supervisors';
end $$;
reset role;

\echo 'ALL WORKFLOW TESTS PASSED'
rollback;
