-- Acceptance tests for the database layer (brief section 8), plus rule checks.
-- Run with scripts/test-db.sh. Each block raises an exception on failure.
\set ON_ERROR_STOP 1

create or replace function pg_temp.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

-- Handy ids
\set admin '''00000000-0000-4000-a000-000000000001'''
\set manager '''00000000-0000-4000-a000-000000000002'''
\set sales1 '''00000000-0000-4000-a000-000000000003'''
\set sales2 '''00000000-0000-4000-a000-000000000004'''
\set estimator '''00000000-0000-4000-a000-000000000005'''

-- ===========================================================================
-- 1. Concurrent entry: two salespeople create the same customer offline
-- ===========================================================================
select pg_temp.login(:sales1);
select public.submit_visit($j${
  "visit": {"id": "50000000-0000-4000-a000-000000000001", "customer_id": "60000000-0000-4000-a000-000000000001",
            "visit_type": "intro", "purpose": "Introduce lighting portfolio", "summary": "Met the GM",
            "outcome": "positive", "check_in_at": "2026-09-20T04:00:00Z", "device_created_at": "2026-09-20T04:00:00Z",
            "contact_unavailable_reason": "reception_only"},
  "new_customers": [{"id": "60000000-0000-4000-a000-000000000001", "legal_name": "Ocean View Hotels (Pvt) Ltd", "city": "Colombo"}],
  "actions": [{"id": "70000000-0000-4000-a000-000000000001", "description": "Send catalogue", "due_date": "2026-09-25"}],
  "submit": true}$j$::jsonb);
select pg_temp.logout();

select pg_temp.login(:sales2);
select public.submit_visit($j${
  "visit": {"id": "50000000-0000-4000-a000-000000000002", "customer_id": "60000000-0000-4000-a000-000000000002",
            "visit_type": "follow_up", "purpose": "Discuss garden lighting", "summary": "Met engineering",
            "outcome": "info_gathered", "check_in_at": "2026-09-21T05:00:00Z", "no_followup_reason": "courtesy",
            "contact_unavailable_reason": "site_only"},
  "new_customers": [{"id": "60000000-0000-4000-a000-000000000002", "legal_name": "OCEAN VIEW HOTELS LTD", "city": "colombo"}],
  "submit": true}$j$::jsonb);
select pg_temp.logout();

select pg_temp.check((select count(*) from public.customers where normalized_name = 'ocean view hotels') = 1,
  'concurrent entry: one customer record');
select pg_temp.check((select count(distinct customer_id) from public.visits
  where id in ('50000000-0000-4000-a000-000000000001', '50000000-0000-4000-a000-000000000002')) = 1,
  'concurrent entry: both visits linked to the same account');
select pg_temp.check((select count(*) from public.visits where status = 'submitted'
  and id in ('50000000-0000-4000-a000-000000000001', '50000000-0000-4000-a000-000000000002')) = 2,
  'concurrent entry: both visits submitted');

-- ===========================================================================
-- 2. Offline entry: retry of the same payload is safe; device time preserved
-- ===========================================================================
select pg_temp.login(:sales1);
create temporary table offline_payload as select $j${
  "visit": {"id": "50000000-0000-4000-a000-000000000003", "customer_id": "10000000-0000-4000-a000-000000000001",
            "visit_type": "site_survey", "purpose": "Measure lobby lux levels", "summary": "Lobby at 120 lux, target 300",
            "outcome": "quotation_requested", "check_in_at": "2026-09-22T03:15:00Z", "check_out_at": "2026-09-22T04:05:00Z",
            "device_created_at": "2026-09-22T03:14:00Z", "check_in_lat": 6.9147, "check_in_lng": 79.8563, "check_in_accuracy_m": 12,
            "estimated_value": 25000000, "currency": "LKR"},
  "contact_ids": ["20000000-0000-4000-a000-000000000001"],
  "project_ids": ["30000000-0000-4000-a000-000000000001"],
  "opportunity_ids": ["40000000-0000-4000-a000-000000000001"],
  "actions": [{"id": "70000000-0000-4000-a000-000000000002", "description": "Prepare lobby lighting proposal",
               "due_date": "2026-09-24", "project_id": "30000000-0000-4000-a000-000000000001", "priority": "high"}],
  "attachments": [{"id": "80000000-0000-4000-a000-000000000001", "storage_path": "00000000-0000-4000-a000-000000000003/visit/50000000-0000-4000-a000-000000000003/80000000-0000-4000-a000-000000000001/lobby.jpg",
                   "filename": "lobby.jpg", "mime_type": "image/jpeg", "size_bytes": 234567}],
  "submit": true}$j$::jsonb as p;
select public.submit_visit(p) ->> 'already_processed' as first_attempt from offline_payload;
select pg_temp.check((select public.submit_visit(p) ->> 'already_processed' from offline_payload) = 'true',
  'offline entry: retry is recognised as already processed');
select pg_temp.logout();

select pg_temp.check((select count(*) from public.actions where visit_id = '50000000-0000-4000-a000-000000000003') = 1,
  'offline entry: no duplicate actions after retry');
select pg_temp.check((select count(*) from public.attachments where entity_id = '50000000-0000-4000-a000-000000000003') = 1,
  'offline entry: photo attachment kept once');
select pg_temp.check((select check_in_at = '2026-09-22T03:15:00Z' and device_created_at = '2026-09-22T03:14:00Z'
  and duration_minutes = 50 and visit_date = date '2026-09-22' from public.visits where id = '50000000-0000-4000-a000-000000000003'),
  'offline entry: original visit time preserved');

-- ===========================================================================
-- 3. Project linking: visits + stakeholders on one project, independent packages
-- ===========================================================================
select pg_temp.login(:sales1);
-- A new project typed on the device under an alias of an existing project is matched, not duplicated
select public.submit_visit($j${
  "visit": {"id": "50000000-0000-4000-a000-000000000004", "customer_id": "10000000-0000-4000-a000-000000000002",
            "visit_type": "technical", "purpose": "Review facade concept", "summary": "Architect wants media facade",
            "outcome": "positive", "check_in_at": "2026-09-23T06:00:00Z"},
  "contact_ids": ["20000000-0000-4000-a000-000000000002"],
  "new_projects": [{"id": "30000000-0000-4000-a000-0000000000aa", "name": "Lanka Tower Two", "district": "Colombo"}],
  "project_ids": ["30000000-0000-4000-a000-0000000000aa"],
  "new_stakeholders": [{"project_id": "30000000-0000-4000-a000-0000000000aa", "customer_id": "10000000-0000-4000-a000-000000000002",
                        "contact_id": "20000000-0000-4000-a000-000000000002", "stakeholder_role": "architect"}],
  "actions": [{"id": "70000000-0000-4000-a000-000000000003", "description": "Send facade references", "due_date": "2026-10-10"}],
  "submit": true}$j$::jsonb);
update public.opportunities set stage_id = (select id from public.pipeline_stages where code = 'tender_open'),
  quotation_due_date = date '2026-10-15', expected_order_date = date '2026-12-01'
where id = '40000000-0000-4000-a000-000000000001';
select pg_temp.logout();

select pg_temp.check(not exists (select 1 from public.projects where id = '30000000-0000-4000-a000-0000000000aa'),
  'project linking: alias matched existing project (no duplicate)');
select pg_temp.check((select count(*) from public.visit_projects where project_id = '30000000-0000-4000-a000-000000000001') = 2,
  'project linking: several visits link to one project');
select pg_temp.check((select count(*) from public.project_stakeholders where project_id = '30000000-0000-4000-a000-000000000001') = 3,
  'project linking: stakeholder not duplicated');
select pg_temp.check((select s.code from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id
                      where o.id = '40000000-0000-4000-a000-000000000001') = 'tender_open'
  and (select s.code from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id
       where o.id = '40000000-0000-4000-a000-000000000002') = 'design_influence',
  'project linking: packages keep independent stages');
select pg_temp.check((select probability from public.opportunities where id = '40000000-0000-4000-a000-000000000001') = 40
  and (select weighted_value from public.opportunities where id = '40000000-0000-4000-a000-000000000001') = 48000000,
  'project linking: stage default probability and weighted value');
select pg_temp.check((select count(*) from public.opportunity_stage_history where opportunity_id = '40000000-0000-4000-a000-000000000001') = 2,
  'project linking: stage history recorded');

-- ===========================================================================
-- 4. Action control: overdue action visible to owner and manager; completion updates history
-- ===========================================================================
select pg_temp.login(:sales1);
select pg_temp.check((select count(*) from public.actions where owner_id = auth.uid() and status = 'open' and due_date < current_date) >= 2,
  'action control: owner sees overdue follow ups');
select pg_temp.logout();
select pg_temp.login(:manager);
select pg_temp.check((public.dashboard_summary('{}') #>> '{actions,overdue}')::int >= 2, 'action control: manager dashboard shows overdue');
select pg_temp.check(exists (select 1 from jsonb_array_elements(public.dashboard_summary('{}') #> '{actions,overdue_list}') a
                             where a ->> 'code' = (select code from public.actions where id = '70000000-0000-4000-a000-000000000002')),
  'action control: overdue item listed for manager');
select pg_temp.logout();
update public.projects set last_activity_at = now() - interval '40 days' where id = '30000000-0000-4000-a000-000000000001';
select pg_temp.login(:sales1);
update public.actions set status = 'done', result = 'Proposal sent' where id = '70000000-0000-4000-a000-000000000002';
select pg_temp.logout();
select pg_temp.check((select completed_at is not null from public.actions where id = '70000000-0000-4000-a000-000000000002'),
  'action control: completion time recorded');
select pg_temp.check((select last_activity_at > now() - interval '1 minute' from public.projects where id = '30000000-0000-4000-a000-000000000001'),
  'action control: completion updates project history');
select pg_temp.check(exists (select 1 from public.audit_log where record_id = '70000000-0000-4000-a000-000000000002'
                             and action = 'update' and 'status' = any (changed_fields) and changed_by = :sales1),
  'action control: completion is attributable in the audit log');

-- ===========================================================================
-- 5. Excel reconciliation: export rows match dashboard counts for the same filter
-- ===========================================================================
select pg_temp.login(:manager);
create temporary table recon as select public.export_dataset('{"from":"2026-09-01","to":"2026-09-30"}'::jsonb) as x;
select pg_temp.check(
  (select count(*) from recon, jsonb_array_elements(x #> '{sheets,visits}') v where v ->> 'status' = 'submitted')
  = (select (x #>> '{summary,visits,submitted}')::int from recon),
  'excel reconciliation: submitted visit count matches dashboard');
select pg_temp.check(
  (select count(*) from recon, jsonb_array_elements(x #> '{sheets,opportunities}') o where o ->> 'stage_outcome' = 'open')
  = (select (x #>> '{summary,pipeline,open_count}')::int from recon),
  'excel reconciliation: open opportunity count matches dashboard');
select pg_temp.check(
  (select sum((o ->> 'weighted_value_base')::numeric) from recon, jsonb_array_elements(x #> '{sheets,opportunities}') o where o ->> 'stage_outcome' = 'open')
  = (select (x #>> '{summary,pipeline,weighted_value}')::numeric from recon),
  'excel reconciliation: weighted pipeline value matches dashboard');
select pg_temp.check(
  (select bool_and(exists (select 1 from jsonb_array_elements(x #> '{sheets,customers}') c where c ->> 'id' = v ->> 'customer_id'))
   from recon, jsonb_array_elements(x #> '{sheets,visits}') v),
  'excel reconciliation: every visit joins to a customer row by ID');
select pg_temp.check((select (x #>> '{summary,pipeline,unconverted_count}')::int = 0 from recon),
  'excel reconciliation: USD package converted with exchange rate');
select pg_temp.logout();
select pg_temp.check(exists (select 1 from public.audit_log where action = 'export' and changed_by = :manager),
  'security and audit: export attributable to a user');

-- ===========================================================================
-- 6. Security: territories, restricted cost fields, estimator scope
-- ===========================================================================
-- quotation with confidential margin (entered by manager)
select pg_temp.login(:manager);
insert into public.quotations (id, opportunity_id, reference, revision, status, submission_date, amount, currency)
values ('90000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', 'DLS/Q/2026/101', 0, 'submitted', date '2026-09-24', 118000000, 'LKR');
insert into public.quotation_financials (quotation_id, cost_amount, gross_margin_pct) values ('90000000-0000-4000-a000-000000000001', 90000000, 23.7);
select pg_temp.check((select count(*) from public.quotation_financials) = 1, 'security: manager sees margin');
select pg_temp.logout();

select pg_temp.login(:sales1);
select pg_temp.check((select count(*) from public.quotations where id = '90000000-0000-4000-a000-000000000001') = 1, 'security: salesperson sees own quotation');
select pg_temp.check((select count(*) from public.quotation_financials) = 0, 'security: salesperson cannot see cost / margin');
select pg_temp.check(not ((public.export_dataset('{}') #> '{sheets,quotations,0}') ? 'gross_margin_pct'), 'security: margin excluded from salesperson export');
select pg_temp.check((select count(*) from public.customers where id = '10000000-0000-4000-a000-000000000003') = 0,
  'security: Western salesperson cannot see Central customer');
select pg_temp.check((select count(*) from public.projects where id = '30000000-0000-4000-a000-000000000002') = 0
  and (select count(*) from public.opportunities where id = '40000000-0000-4000-a000-000000000003') = 0,
  'security: salesperson cannot see other territory projects or packages');
select pg_temp.check((select count(*) from public.visits v where v.salesperson_id = :sales2
                      and v.territory_id <> (select id from public.territories where code = 'WESTERN')) = 0,
  'security: salesperson cannot see visits outside their territory');
select pg_temp.logout();

select pg_temp.login(:sales2);
select pg_temp.check((select count(*) from public.customers where id = '10000000-0000-4000-a000-000000000002') = 0,
  'security: Central salesperson cannot see Western customer');
select pg_temp.check((select count(*) from public.customers where normalized_name = 'ocean view hotels') = 1,
  'security: salesperson sees the account they visited');
select pg_temp.logout();

select pg_temp.login(:estimator);
select pg_temp.check((select count(*) from public.projects) = 1, 'security: estimator sees assigned project only');
select pg_temp.check((select count(*) from public.visits where id = '50000000-0000-4000-a000-000000000003') = 1,
  'security: estimator can read visits linked to assigned project');
update public.visits set summary = 'edited by estimator' where id = '50000000-0000-4000-a000-000000000003';
select pg_temp.check((select summary from public.visits where id = '50000000-0000-4000-a000-000000000003') <> 'edited by estimator',
  'security: estimator cannot edit sales visit history');
insert into public.technical_notes (project_id, body) values ('30000000-0000-4000-a000-000000000001', 'Lobby needs 300 lux at floor, UGR < 19');
insert into public.project_milestones (project_id, kind, title, planned_date) values ('30000000-0000-4000-a000-000000000001', 'lighting_calc', 'DIALux calculation', date '2026-10-05');
select pg_temp.check((select count(*) from public.technical_notes) = 1, 'security: estimator adds technical notes');
select pg_temp.logout();

-- Cross-territory project: calling ensure_project_access directly grants nothing,
-- but a visit linked to the project makes the salesperson a (audited) sales member
select pg_temp.login(:sales2);
select public.ensure_project_access('30000000-0000-4000-a000-000000000001');
select pg_temp.check((select count(*) from public.projects where id = '30000000-0000-4000-a000-000000000001') = 0,
  'security: no project access without a linked visit');
select public.submit_visit($j${
  "visit": {"id": "50000000-0000-4000-a000-000000000005", "customer_id": "10000000-0000-4000-a000-000000000003",
            "visit_type": "follow_up", "purpose": "Group-wide lighting standard", "summary": "Discussed Colombo tower", "outcome": "info_gathered",
            "contact_unavailable_reason": "site_only", "no_followup_reason": "courtesy", "check_in_at": "2026-09-24T05:00:00Z"},
  "new_projects": [{"id": "30000000-0000-4000-a000-0000000000bb", "name": "Lanka Towers Phase-2", "district": "Colombo"}],
  "project_ids": ["30000000-0000-4000-a000-0000000000bb"], "submit": true}$j$::jsonb);
select pg_temp.check((select count(*) from public.projects where id = '30000000-0000-4000-a000-000000000001') = 1,
  'security: visit to another territory''s project gives shared access (no duplicate project)');
select pg_temp.logout();
select pg_temp.check(exists (select 1 from public.audit_log where table_name = 'project_members' and changed_by = :sales2),
  'security: shared project access is audited');

-- A submitted visit is locked for its author
select pg_temp.login(:sales1);
update public.visits set summary = 'rewritten' where id = '50000000-0000-4000-a000-000000000003';
select pg_temp.logout();
select pg_temp.check((select summary from public.visits where id = '50000000-0000-4000-a000-000000000003') = 'Lobby at 120 lux, target 300',
  'security: submitted visit cannot be edited by salesperson');

-- ...but a correction can be requested and approved by a manager (audited)
select pg_temp.login(:sales1);
insert into public.correction_requests (visit_id, reason, changes)
values ('50000000-0000-4000-a000-000000000003', 'Typo in lux value', '{"summary": "Lobby at 150 lux, target 300", "salesperson_id": "00000000-0000-4000-a000-000000000004"}');
select pg_temp.logout();
select pg_temp.login(:manager);
select public.approve_correction((select id from public.correction_requests limit 1), 'OK');
select pg_temp.logout();
select pg_temp.check((select summary = 'Lobby at 150 lux, target 300' and salesperson_id = :sales1
                      from public.visits where id = '50000000-0000-4000-a000-000000000003'),
  'corrections: approved change applied, protected fields ignored');
select pg_temp.check(exists (select 1 from public.audit_log where record_id = '50000000-0000-4000-a000-000000000003'
                             and changed_by = :manager and 'summary' = any (changed_fields)),
  'corrections: change recorded in audit log');

-- ===========================================================================
-- 7. Rules: submission validation, stage requirements, deactivated users
-- ===========================================================================
select pg_temp.login(:sales1);
do $$
begin
  perform public.submit_visit('{"visit": {"id": "50000000-0000-4000-a000-000000000009", "customer_id": "10000000-0000-4000-a000-000000000001", "visit_type": "intro"}, "submit": true}');
  raise exception 'FAILED: incomplete visit was accepted';
exception when check_violation then
  raise notice 'ok: incomplete visit rejected (%)', sqlerrm;
end $$;
do $$
begin
  update public.opportunities set stage_id = (select id from public.pipeline_stages where code = 'won')
  where id = '40000000-0000-4000-a000-000000000001';
  raise exception 'FAILED: won without reason accepted';
exception when check_violation then
  raise notice 'ok: stage entry requirements enforced (%)', sqlerrm;
end $$;
-- draft save (submit=false) is allowed with missing fields
select pg_temp.check((public.submit_visit('{"visit": {"id": "50000000-0000-4000-a000-00000000000a", "visit_type": "intro"}, "submit": false}') ->> 'status') = 'draft',
  'rules: incomplete draft can be saved');
select pg_temp.logout();

select pg_temp.login(:admin);
update public.profiles set active = false where id = :sales2;
select pg_temp.check((public.reassign_owner(:sales2, :manager) ->> 'customers')::int >= 1, 'offboarding: records reassigned');
select pg_temp.logout();
select pg_temp.login(:sales2);
select pg_temp.check((select count(*) from public.customers) = 0, 'offboarding: deactivated user sees nothing');
select pg_temp.logout();

-- Non-admins cannot promote themselves
select pg_temp.login(:sales1);
do $$
begin
  update public.profiles set role = 'admin' where id = auth.uid();
  raise exception 'FAILED: self-promotion allowed';
exception when insufficient_privilege then
  raise notice 'ok: role change blocked for non-admin';
end $$;
select pg_temp.check((select count(*) from public.find_similar_customers('Lanka Tower')) >= 1, 'dedupe: similar customers found');
select pg_temp.check((select count(*) from public.find_similar_projects('Lanka Towers Phase II')) >= 1, 'dedupe: similar projects found');
select pg_temp.logout();

-- ===========================================================================
-- 8. Automated alerts (Release 2)
-- ===========================================================================
update public.actions set due_date = current_date - 10 where id = '70000000-0000-4000-a000-000000000001';
select pg_temp.check(public.escalate_overdue_actions() >= 1, 'alerts: long-overdue actions escalated');
select pg_temp.check((select escalated_to = :manager from public.actions where id = '70000000-0000-4000-a000-000000000001'),
  'alerts: escalated to a manager');
select pg_temp.check(exists (select 1 from jsonb_array_elements(public.alert_digests()) d
                             where d ->> 'user_id' = :manager and jsonb_array_length(d -> 'escalated') >= 1),
  'alerts: manager digest lists escalations');
select pg_temp.login(:sales1);
do $$
begin
  perform public.alert_digests();
  raise exception 'FAILED: salesperson could call alert_digests';
exception when insufficient_privilege then
  raise notice 'ok: alert digests restricted to the server';
end $$;
select pg_temp.logout();
