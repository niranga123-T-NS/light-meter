// API smoke test: runs the app's PostgREST queries and RPCs as real users
// against a local database served by PostgREST (see docs/TESTING.md).
//   node --experimental-strip-types scripts/api-smoke-test.mts http://localhost:3099 <jwt-secret> [out-dir]
import { createHmac, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { PostgrestClient } from '@supabase/postgrest-js';

import { buildExportWorkbook, exportFileName } from '../supabase/functions/_shared/workbook.ts';

const [url = 'http://localhost:3099', secret = 'super-secret-jwt-token-with-at-least-32-characters-long', outDir] = process.argv.slice(2);
const USERS = {
  sales1: '00000000-0000-4000-a000-000000000003',
  manager: '00000000-0000-4000-a000-000000000002',
  estimator: '00000000-0000-4000-a000-000000000005',
};

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub: string) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const client = (sub: string) => new PostgrestClient(url, { headers: { Authorization: `Bearer ${jwt(sub)}` } });

let failures = 0;
function check(ok: unknown, msg: string, extra?: unknown) {
  if (ok) console.log(`ok: ${msg}`);
  else {
    failures++;
    console.log(`FAILED: ${msg}`, extra ?? '');
  }
}
function must<T>(res: { data: T; error: unknown }, msg: string): T {
  check(!res.error, msg, res.error);
  return res.data;
}

const sales = client(USERS.sales1);
const manager = client(USERS.manager);
const estimator = client(USERS.estimator);
const userId = USERS.sales1;
const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

// --- Offline cache refresh (same queries as src/lib/cache.ts) ---------------
const cache = await Promise.all([
  sales.from('lookup_values').select('id,list_key,code,label,sort_order,active').order('list_key').order('sort_order'),
  sales.from('pipeline_stages').select('*').order('sort_order'),
  sales.from('territories').select('id,code,name,active').order('name'),
  sales.from('profiles').select('id,email,full_name,role,active').order('full_name'),
  sales.from('profile_territories').select('user_id,territory_id'),
  sales.from('customers').select('id,code,legal_name,trading_name,category,industry,district,city,phone,email,owner_id,territory_id,status,strategic_priority,parent_customer_id,last_visit_at,version').is('deleted_at', null).order('legal_name').limit(5000),
  sales.from('contacts').select('id,code,customer_id,full_name,designation,department,work_phone,mobile_phone,email,decision_role,active,version').is('deleted_at', null).eq('active', true).order('full_name').limit(10000),
  sales.from('projects').select('id,code,name,aliases,district,city,customer_id,developer_id,end_user_id,segments,owner_id,territory_id,status,tender_closing_date,quotation_due_date,last_activity_at,currency,version').is('deleted_at', null).order('last_activity_at', { ascending: false }).limit(3000),
  sales.from('opportunities').select('id,code,project_id,name,segment,owner_id,stage_id,probability,estimated_value,currency,weighted_value,expected_order_date,quotation_due_date,closed_at,version').is('deleted_at', null).limit(5000),
  sales.from('actions').select('*').or(`owner_id.eq.${userId},created_by.eq.${userId}`).in('status', ['open', 'in_progress']).order('due_date', { ascending: true, nullsFirst: false }).limit(1000),
  sales.from('visits').select('*').eq('salesperson_id', userId).or(`status.eq.planned,and(status.eq.submitted,visit_date.gte.${since})`).order('scheduled_at', { ascending: true }).limit(500),
  sales.from('app_settings').select('key,value'),
]);
cache.forEach((r, i) => check(!r.error, `cache query ${i + 1}`, r.error));
const customers = cache[5].data as { id: string; legal_name: string }[];
check(customers.length === 3, `salesperson sees own-territory customers (${customers.length})`);
check((cache[0].data as unknown[]).length > 100, 'lookup lists downloaded');

// --- Plan a visit (online insert returning the row) --------------------------
const plannedId = randomUUID();
const planned = must(await sales.from('visits').insert({ id: plannedId, status: 'planned', customer_id: customers[0].id, salesperson_id: userId,
  scheduled_at: new Date(Date.now() + 86400000).toISOString(), visit_type: 'follow_up', purpose: 'Planned follow-up' }).select().single(), 'plan a visit');
check((planned as { code: string }).code?.startsWith('VIS-'), 'planned visit gets a reference');

// --- Offline visit submission from the planned visit, with new records ------
const newCustomer = randomUUID();
const newContact = randomUUID();
const newProject = randomUUID();
const newPkg = randomUUID();
const payload = {
  visit: { ...(planned as object), id: plannedId, customer_id: newCustomer, visit_date: new Date().toISOString().slice(0, 10), check_in_at: new Date().toISOString(),
    purpose: 'Site survey', summary: 'Discussed warehouse high-bay retrofit', outcome: 'quotation_requested', is_remote: false, currency: 'LKR' },
  base_version: (planned as { version: number }).version,
  new_customers: [{ id: newCustomer, legal_name: 'Harbour Logistics (Pvt) Ltd', city: 'Colombo', category: 'end_user' }],
  new_contacts: [{ id: newContact, customer_id: newCustomer, full_name: 'Priya Gunawardena', designation: 'Facilities Manager' }],
  new_projects: [{ id: newProject, name: 'Harbour Warehouse Retrofit', district: 'Colombo', customer_id: newCustomer, segments: ['indoor'] }],
  new_opportunities: [{ id: newPkg, project_id: newProject, name: 'High-bay LED', estimated_value: 18000000, currency: 'LKR' }],
  new_stakeholders: [{ id: randomUUID(), project_id: newProject, customer_id: newCustomer, contact_id: newContact, stakeholder_role: 'owner' }],
  contact_ids: [newContact], project_ids: [newProject], opportunity_ids: [newPkg],
  actions: [{ id: randomUUID(), description: 'Send high-bay proposal', due_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), priority: 'high' }],
  attachments: [], submit: true,
};
const res = must(await sales.rpc('submit_visit', { p: payload }), 'submit_visit via REST') as { status: string; code: string };
check(res?.status === 'submitted', `visit submitted as ${res?.code}`);
const retry = must(await sales.rpc('submit_visit', { p: payload }), 'retry submit_visit') as { already_processed: boolean };
check(retry?.already_processed, 'retry is idempotent');

// --- Screens' embedded queries ----------------------------------------------
must(await sales.from('visit_contacts').select('contact:contacts(id,full_name,designation)').eq('visit_id', plannedId), 'visit view: contacts embed');
must(await sales.from('visit_projects').select('project:projects(id,code,name)').eq('visit_id', plannedId), 'visit view: projects embed');
must(await sales.from('project_stakeholders').select('stakeholder_role, project:projects(id,code,name,status,district)').eq('customer_id', newCustomer), 'customer: stakeholder embed');
must(await sales.from('projects').select('id,code,name,status,district').or(`customer_id.eq.${newCustomer},developer_id.eq.${newCustomer},end_user_id.eq.${newCustomer}`), 'customer: projects or-filter');
must(await manager.from('correction_requests').select('*, visit:visits(code)').order('status'), 'corrections embed');

// --- Optimistic concurrency (records.ts) -------------------------------------
const cust = must(await sales.from('customers').select('*').eq('id', newCustomer).single(), 'load new customer') as { version: number };
const upd = await sales.from('customers').update({ phone: '+94 11 555 0000' }).eq('id', newCustomer).eq('version', cust.version).select();
check(!upd.error && upd.data?.length === 1, 'update with matching version');
const stale = await sales.from('customers').update({ phone: '+94 11 555 9999' }).eq('id', newCustomer).eq('version', cust.version).select();
check(!stale.error && stale.data?.length === 0, 'stale version update is rejected (0 rows)');

// --- Duplicate search ----------------------------------------------------------
const sim = must(await sales.rpc('find_similar_customers', { q: 'Harbour Logistics', p_city: 'Colombo' }), 'find_similar_customers') as unknown[];
check(sim.length >= 1, 'similar customer found');

// --- Stage change with rules -----------------------------------------------------
const stages = cache[1].data as { id: string; code: string }[];
const won = stages.find((s) => s.code === 'won')!.id;
const bad = await sales.from('opportunities').update({ stage_id: won }).eq('id', newPkg).select();
check(!!bad.error && bad.error.code === '23514', 'stage entry rule enforced via REST', bad.error);

// --- Estimator scope ----------------------------------------------------------------
const estProjects = must(await estimator.from('projects').select('id'), 'estimator projects') as unknown[];
check(estProjects.length === 1, 'estimator sees only assigned project');
const estFin = await estimator.from('quotation_financials').select('*');
check(!estFin.error && (estFin.data ?? []).length === 0, 'estimator cannot read margin');

// --- Manager dashboard + export -------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const dash = must(await manager.rpc('dashboard_summary', { f: { from: `${today.slice(0, 7)}-01`, to: today } }), 'dashboard_summary') as { visits: { submitted: number } };
check(dash?.visits.submitted >= 1, `dashboard shows ${dash?.visits.submitted} submitted visit(s)`);
const data = must(await manager.rpc('export_dataset', { f: { from: `${today.slice(0, 7)}-01`, to: today }, p_channel: 'download' }), 'export_dataset') as Parameters<typeof buildExportWorkbook>[0];
const bytes = buildExportWorkbook(data, { generatedByName: 'Mahesh Manager' });
check(bytes.length > 10000, `workbook built (${bytes.length} bytes)`);
if (outDir) writeFileSync(`${outDir}/${exportFileName(data)}`, bytes);
const log = must(await manager.from('export_log').select('*').order('created_at', { ascending: false }).limit(1), 'export log') as { user_id: string }[];
check(log[0]?.user_id === USERS.manager, 'export attributed to the manager');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll API smoke checks passed.');
process.exit(failures ? 1 : 0);
