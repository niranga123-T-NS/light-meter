// Excel workbook definition for the DIMO sales export.
// Column names are stable snake_case keys so sheets can be joined by ID in
// Excel / Power Query / Power BI. Dates are ISO 8601; timestamps are ISO 8601
// with the Asia/Colombo offset (+05:30) so they are unambiguous.
import { buildXlsx, type Cell, type SheetData } from './xlsx.ts';

export type ColumnType = 'id' | 'text' | 'number' | 'money' | 'percent' | 'date' | 'datetime' | 'bool';

export interface ColumnDef {
  key: string;
  type: ColumnType;
  description: string;
  /** Only exported for roles allowed to see cost and margin. */
  restricted?: boolean;
}

export interface SheetDef {
  key: string;
  name: string;
  rowMeans: string;
  keyLinks: string;
  columns: ColumnDef[];
}

const c = (key: string, type: ColumnType, description: string, restricted = false): ColumnDef => ({ key, type, description, restricted });

const audit = [
  c('created_at', 'datetime', 'When the record was created'),
  c('created_by', 'id', 'User ID who created the record'),
  c('updated_at', 'datetime', 'When the record was last changed'),
  c('updated_by', 'id', 'User ID who last changed the record'),
];

export const SHEETS: SheetDef[] = [
  {
    key: 'customers', name: 'Customers', rowMeans: 'One customer (account)', keyLinks: 'id (Customer ID)',
    columns: [
      c('id', 'id', 'Customer ID (unique, permanent)'), c('code', 'text', 'Human-readable customer number, e.g. CUS-000123'),
      c('legal_name', 'text', 'Registered / legal name'), c('trading_name', 'text', 'Trading name if different'),
      c('category', 'text', 'Customer category: developer, architect, consultant, contractor, government, end_user, distributor, other'),
      c('industry', 'text', 'Industry code (configurable list)'), c('address', 'text', 'Postal address'),
      c('district', 'text', 'District'), c('city', 'text', 'City'), c('country', 'text', 'Country'),
      c('website', 'text', 'Website'), c('phone', 'text', 'Main phone'), c('email', 'text', 'General email'),
      c('owner_id', 'id', 'Account owner user ID'), c('owner_name', 'text', 'Account owner name'),
      c('territory_id', 'id', 'Territory ID'), c('territory', 'text', 'Territory name'),
      c('strategic_priority', 'text', 'Strategic priority (A/B/C)'),
      c('status', 'text', 'provisional (created in the field, not yet verified), prospect, active, inactive'),
      c('source', 'text', 'Lead source'), c('parent_customer_id', 'id', 'Parent company customer ID (group structure)'),
      c('parent_customer_code', 'text', 'Parent company code'), c('last_visit_at', 'datetime', 'Most recent submitted visit'),
      c('notes', 'text', 'Notes'), ...audit,
    ],
  },
  {
    key: 'contacts', name: 'Contacts', rowMeans: 'One person', keyLinks: 'id (Contact ID), customer_id',
    columns: [
      c('id', 'id', 'Contact ID'), c('code', 'text', 'Contact number, e.g. CON-000045'),
      c('customer_id', 'id', 'Customer ID the person works for'), c('customer_code', 'text', 'Customer number'),
      c('customer_name', 'text', 'Customer legal name'), c('full_name', 'text', 'Full name'),
      c('designation', 'text', 'Job title'), c('department', 'text', 'Department'),
      c('work_phone', 'text', 'Work phone'), c('mobile_phone', 'text', 'Mobile phone'), c('email', 'text', 'Email'),
      c('decision_role', 'text', 'decision_maker, influencer, technical_evaluator, procurement, user'),
      c('preferred_contact_method', 'text', 'phone, mobile, email, whatsapp, in_person, other'),
      c('owner_id', 'id', 'Owner user ID'), c('owner_name', 'text', 'Owner name'),
      c('active', 'bool', 'Still an active contact'), c('consent_status', 'text', 'Communication consent: unknown, granted, withdrawn'),
      c('communication_preference', 'text', 'Communication preference notes'), c('notes', 'text', 'Notes'), ...audit,
    ],
  },
  {
    key: 'visits', name: 'Visits', rowMeans: 'One visit', keyLinks: 'id (Visit ID), customer_id, salesperson_id',
    columns: [
      c('id', 'id', 'Visit ID'), c('code', 'text', 'Visit reference, e.g. VIS-000321'),
      c('salesperson_id', 'id', 'Salesperson user ID'), c('salesperson_name', 'text', 'Salesperson name'),
      c('customer_id', 'id', 'Customer ID'), c('customer_code', 'text', 'Customer number'), c('customer_name', 'text', 'Customer name'),
      c('territory', 'text', 'Territory of the customer at the time of the visit'),
      c('visit_type', 'text', 'Visit type (configurable list)'), c('status', 'text', 'planned, submitted, cancelled'),
      c('visit_date', 'date', 'Visit date (Asia/Colombo)'), c('scheduled_at', 'datetime', 'Planned date and time'),
      c('check_in_at', 'datetime', 'Check-in time (device time)'), c('check_out_at', 'datetime', 'Check-out time'),
      c('duration_minutes', 'number', 'check_out_at − check_in_at in minutes'),
      c('device_created_at', 'datetime', 'When the record was first created on the device'),
      c('submitted_at', 'datetime', 'When the server accepted the submission'),
      c('meeting_place', 'text', 'Meeting place'), c('is_remote', 'bool', 'Remote meeting (call / video)'),
      c('check_in_lat', 'number', 'GPS latitude at check-in (optional, with consent)'), c('check_in_lng', 'number', 'GPS longitude at check-in'),
      c('check_in_accuracy_m', 'number', 'GPS accuracy at check-in (metres)'),
      c('check_out_lat', 'number', 'GPS latitude at check-out'), c('check_out_lng', 'number', 'GPS longitude at check-out'),
      c('location_unavailable_reason', 'text', 'Why location was not captured'),
      c('contact_unavailable_reason', 'text', 'Why no contact is linked (see Visit Contacts)'),
      c('project_codes', 'text', 'Linked project numbers (comma separated)'),
      c('purpose', 'text', 'Purpose of the visit'), c('products_discussed', 'text', 'Products or systems discussed'),
      c('requirements', 'text', 'Requirements'), c('pain_points', 'text', 'Pain points'), c('decision_process', 'text', 'Decision process'),
      c('budget_indication', 'text', 'Budget indication'), c('funding_status', 'text', 'Funding status'),
      c('purchase_timeline', 'text', 'Expected purchase or tender timeline'),
      c('estimated_value', 'money', 'Estimated value (in currency)'), c('currency', 'text', 'ISO 4217 currency code'),
      c('confidence', 'text', 'low, medium, high'), c('competitor', 'text', 'Competitor'), c('incumbent', 'text', 'Incumbent supplier'),
      c('spec_position', 'text', 'Specification position'), c('differentiator', 'text', 'DIMO differentiator'),
      c('risks', 'text', 'Risks or blockers'), c('summary', 'text', 'Meeting summary'), c('commitments', 'text', 'Commitments made'),
      c('documents_shared', 'text', 'Documents shared'), c('documents_requested', 'text', 'Documents requested'),
      c('outcome', 'text', 'Visit outcome (configurable list)'), c('next_meeting_at', 'datetime', 'Next meeting'),
      c('no_followup_reason', 'text', 'Reason when no follow-up action was set'), c('action_count', 'number', 'Number of actions raised from this visit'),
      ...audit,
    ],
  },
  {
    key: 'visit_contacts', name: 'Visit Contacts', rowMeans: 'One visit-to-contact link', keyLinks: 'visit_id, contact_id',
    columns: [
      c('visit_id', 'id', 'Visit ID'), c('visit_code', 'text', 'Visit reference'), c('contact_id', 'id', 'Contact ID'),
      c('contact_code', 'text', 'Contact number'), c('contact_name', 'text', 'Contact name'), c('customer_id', 'id', 'Contact\'s customer ID'),
    ],
  },
  {
    key: 'projects', name: 'Projects', rowMeans: 'One project (physical project or tender)', keyLinks: 'id (Project ID)',
    columns: [
      c('id', 'id', 'Project ID'), c('code', 'text', 'Project number, e.g. PRJ-000012'), c('name', 'text', 'Project name'),
      c('aliases', 'text', 'Other names used for the project (semicolon separated)'),
      c('site_location', 'text', 'Site / location'), c('district', 'text', 'District'), c('city', 'text', 'City'),
      c('latitude', 'number', 'Site latitude'), c('longitude', 'number', 'Site longitude'),
      c('customer_id', 'id', 'Customer / project owner ID'), c('customer_code', 'text', 'Customer number'), c('customer_name', 'text', 'Customer name'),
      c('developer_id', 'id', 'Developer customer ID'), c('developer_name', 'text', 'Developer name'),
      c('end_user_id', 'id', 'End user customer ID'), c('end_user_name', 'text', 'End user name'),
      c('project_type', 'text', 'Project type'), c('description', 'text', 'Brief description'),
      c('segments', 'text', 'Lighting segments: indoor, outdoor, facade, sports, airport, port, smart_controls, other'),
      c('systems_products', 'text', 'Systems / products'), c('quantities', 'text', 'Quantities where known'),
      c('technical_standards', 'text', 'Technical standards'), c('lux_targets', 'text', 'Lux targets'),
      c('controls_requirements', 'text', 'Controls / integration requirements'), c('drawing_links', 'text', 'Drawing / specification links'),
      c('total_estimate', 'money', 'Total project estimate'), c('addressable_value', 'money', 'DIMO addressable value'),
      c('currency', 'text', 'Currency of the project values'), c('budget_status', 'text', 'Budget status'),
      c('funding_source', 'text', 'Funding source'), c('bid_strategy', 'text', 'Bid strategy'), c('partner_supplier', 'text', 'Partner or supplier'),
      c('competitors', 'text', 'Competitors'), c('incumbent', 'text', 'Incumbent'), c('spec_status', 'text', 'Specification status'),
      c('design_stage', 'text', 'Design stage'), c('tender_publication_date', 'date', 'Tender publication date'),
      c('tender_closing_date', 'date', 'Tender closing date'), c('quotation_due_date', 'date', 'Quotation due date'),
      c('expected_award_date', 'date', 'Expected award'), c('expected_delivery_date', 'date', 'Expected delivery'),
      c('installation_start_date', 'date', 'Installation window start'), c('installation_end_date', 'date', 'Installation window end'),
      c('date_confidence', 'text', 'Confidence in the dates'), c('info_source', 'text', 'Source of information'),
      c('tender_reference', 'text', 'Tender reference'), c('lead_source', 'text', 'Source of lead'), c('boq_reference', 'text', 'BOQ reference'),
      c('owner_id', 'id', 'Project owner user ID'), c('owner_name', 'text', 'Project owner name'), c('territory', 'text', 'Territory'),
      c('status', 'text', 'active, on_hold, won, lost, cancelled, closed'), c('last_activity_at', 'datetime', 'Latest visit, action or stage change'),
      ...audit,
    ],
  },
  {
    key: 'opportunities', name: 'Opportunities', rowMeans: 'One lighting package or bid', keyLinks: 'id (Opportunity ID), project_id',
    columns: [
      c('id', 'id', 'Opportunity ID'), c('code', 'text', 'Opportunity number, e.g. OPP-000034'),
      c('project_id', 'id', 'Project ID'), c('project_code', 'text', 'Project number'), c('project_name', 'text', 'Project name'),
      c('name', 'text', 'Package name'), c('segment', 'text', 'Lighting segment'), c('systems_products', 'text', 'Systems / products'),
      c('quantities', 'text', 'Quantities'), c('owner_id', 'id', 'Owner user ID'), c('owner_name', 'text', 'Owner name'),
      c('stage_id', 'id', 'Pipeline stage ID'), c('stage', 'text', 'Pipeline stage'), c('stage_outcome', 'text', 'open, won, lost, on_hold, cancelled'),
      c('probability', 'percent', 'Probability (0–100)'), c('estimated_value', 'money', 'Package estimate (in currency)'),
      c('currency', 'text', 'ISO 4217 currency code'), c('weighted_value', 'money', 'estimated_value × probability ÷ 100 (in currency)'),
      c('base_currency', 'text', 'Reporting currency'), c('estimated_value_base', 'money', 'estimated_value converted to base currency (blank if no rate)'),
      c('weighted_value_base', 'money', 'weighted_value converted to base currency (blank if no rate)'),
      c('expected_order_date', 'date', 'Expected order date'), c('quotation_due_date', 'date', 'Quotation due date for this package'),
      c('next_milestone', 'text', 'Next milestone'), c('next_milestone_date', 'date', 'Next milestone date'), c('blocker', 'text', 'Blocker'),
      c('bid_strategy', 'text', 'Bid strategy'), c('partner_supplier', 'text', 'Partner / supplier'), c('competitors', 'text', 'Competitors'),
      c('incumbent', 'text', 'Incumbent'), c('spec_status', 'text', 'Specification status'),
      c('win_loss_reason', 'text', 'Win / loss reason'), c('win_loss_notes', 'text', 'Win / loss notes'),
      c('final_award_value', 'money', 'Final award value'), c('award_date', 'date', 'Award date'), c('closed_at', 'datetime', 'When won/lost/cancelled'),
      c('last_activity_at', 'datetime', 'Latest activity'), ...audit,
    ],
  },
  {
    key: 'project_stakeholders', name: 'Project Stakeholders', rowMeans: 'One organisation or contact role on a project',
    keyLinks: 'project_id, customer_id / contact_id',
    columns: [
      c('id', 'id', 'Stakeholder link ID'), c('project_id', 'id', 'Project ID'), c('project_code', 'text', 'Project number'),
      c('customer_id', 'id', 'Organisation (customer) ID'), c('customer_code', 'text', 'Customer number'), c('customer_name', 'text', 'Organisation name'),
      c('contact_id', 'id', 'Contact ID'), c('contact_code', 'text', 'Contact number'), c('contact_name', 'text', 'Contact name'),
      c('stakeholder_role', 'text', 'architect, mep_consultant, electrical_contractor, main_contractor, procurement_authority, decision_maker, …'),
      c('influence_stage', 'text', 'Stage of influence'), c('is_decision_maker', 'bool', 'Decision maker on this project'), c('notes', 'text', 'Notes'),
      ...audit,
    ],
  },
  {
    key: 'actions', name: 'Actions', rowMeans: 'One follow-up task', keyLinks: 'id (Action ID), parent_id',
    columns: [
      c('id', 'id', 'Action ID'), c('code', 'text', 'Action number, e.g. ACT-000210'),
      c('parent_type', 'text', 'visit, opportunity, project or customer'), c('parent_id', 'id', 'ID of the parent record'),
      c('customer_id', 'id', 'Customer ID'), c('customer_code', 'text', 'Customer number'),
      c('project_id', 'id', 'Project ID'), c('project_code', 'text', 'Project number'),
      c('opportunity_id', 'id', 'Opportunity ID'), c('opportunity_code', 'text', 'Opportunity number'),
      c('visit_id', 'id', 'Visit ID'), c('visit_code', 'text', 'Visit reference'),
      c('description', 'text', 'Task description'), c('owner_id', 'id', 'Owner user ID'), c('owner_name', 'text', 'Owner name'),
      c('priority', 'text', 'low, normal, high, urgent'), c('due_date', 'date', 'Due date'),
      c('status', 'text', 'open, in_progress, done, cancelled'), c('completed_at', 'datetime', 'Completion time'), c('result', 'text', 'Result / outcome'),
      c('escalated', 'bool', 'Escalated to a manager'), c('escalated_to', 'id', 'Escalated to user ID'), c('escalation_note', 'text', 'Escalation note'),
      ...audit,
    ],
  },
  {
    key: 'quotations', name: 'Quotations', rowMeans: 'One quotation revision', keyLinks: 'id (Quote ID), opportunity_id',
    columns: [
      c('id', 'id', 'Quote ID'), c('code', 'text', 'Quote number, e.g. QUO-000019'),
      c('opportunity_id', 'id', 'Opportunity ID'), c('opportunity_code', 'text', 'Opportunity number'), c('project_code', 'text', 'Project number'),
      c('reference', 'text', 'Quotation reference'), c('revision', 'number', 'Revision number'),
      c('status', 'text', 'draft, submitted, accepted, rejected, superseded, expired, withdrawn'),
      c('submission_date', 'date', 'Submission date'), c('amount', 'money', 'Quoted amount (in currency)'), c('currency', 'text', 'ISO 4217 currency code'),
      c('amount_base', 'money', 'Amount in base currency at the submission-date rate'), c('validity_date', 'date', 'Valid until'),
      c('recipient_customer_id', 'id', 'Recipient organisation ID'), c('recipient_contact_id', 'id', 'Recipient contact ID'),
      c('recipient_name', 'text', 'Recipient'), c('prepared_by', 'id', 'Prepared by user ID'), c('prepared_by_name', 'text', 'Prepared by'),
      c('outcome_note', 'text', 'Outcome'), c('document_url', 'text', 'Link to the quotation document'),
      c('cost_amount', 'money', 'Cost (restricted)', true), c('gross_margin_pct', 'percent', 'Gross margin % (restricted)', true),
      ...audit,
    ],
  },
  {
    key: 'audit_log', name: 'Audit Log', rowMeans: 'One material change', keyLinks: 'record_id, changed_by, changed_at',
    columns: [
      c('id', 'number', 'Audit entry number'), c('changed_at', 'datetime', 'When'), c('changed_by', 'id', 'User ID'),
      c('changed_by_name', 'text', 'User name'), c('action', 'text', 'update, delete, export, approve, reject'),
      c('table_name', 'text', 'Record type'), c('record_id', 'id', 'Record ID'), c('record_code', 'text', 'Record number'),
      c('changed_fields', 'text', 'Fields changed'), c('note', 'text', 'Note'),
    ],
  },
];

export interface ExportDataset {
  generated_at: string;
  generated_by?: string | null;
  filters: Record<string, unknown>;
  base_currency: string;
  can_see_margin: boolean;
  row_counts: Record<string, number>;
  sheets: Record<string, Record<string, unknown>[]>;
  summary?: Record<string, any>;
}

export interface ExportContext {
  /** Labels for filter values, e.g. owner name instead of ID. */
  filterLabels?: Record<string, string>;
  generatedByName?: string;
  appName?: string;
}

const COLOMBO_OFFSET_MIN = 330; // Asia/Colombo, UTC+05:30, no daylight saving

/** ISO 8601 with +05:30, e.g. 2026-09-22T08:45:00+05:30 */
export function toColomboIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const local = new Date(d.getTime() + COLOMBO_OFFSET_MIN * 60000);
  return local.toISOString().replace(/\.\d{3}Z$/, '+05:30');
}

function toCell(value: unknown, type: ColumnType): Cell {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'number':
    case 'money':
    case 'percent': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : String(value);
    }
    case 'bool':
      return typeof value === 'boolean' ? value : String(value) === 'true';
    case 'datetime':
      return toColomboIso(value);
    case 'date':
      return String(value).slice(0, 10);
    default:
      if (Array.isArray(value)) return value.join('; ');
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
  }
}

function visibleColumns(def: SheetDef, canSeeMargin: boolean): ColumnDef[] {
  return def.columns.filter((col) => canSeeMargin || !col.restricted);
}

function summaryRows(summary: Record<string, any> | undefined): Cell[][] {
  if (!summary) return [];
  const rows: Cell[][] = [];
  const add = (section: string, item: string, count: unknown, value: unknown = null, weighted: unknown = null) =>
    rows.push([section, item, count as Cell, value === null || value === undefined ? null : Number(value),
               weighted === null || weighted === undefined ? null : Number(weighted)]);
  const v = summary.visits ?? {};
  add('Visits', 'Submitted visits', v.submitted);
  add('Visits', 'Planned visits', v.planned);
  add('Visits', 'Planned visits completed', v.planned_completed);
  add('Visits', 'Unplanned visits completed', v.unplanned_completed);
  add('Visits', 'Visits leading to projects', v.leading_to_projects);
  add('Visits', 'Visits leading to quotations', v.leading_to_quotations);
  for (const p of summary.visits_by_person ?? []) add('Visits by person', p.name, p.submitted);
  for (const w of summary.visits_by_week ?? []) add('Visits by week', w.week, w.count);
  for (const m of summary.visits_by_month ?? []) add('Visits by month', m.month, m.count);
  const a = summary.accounts ?? {};
  add('Accounts', 'Accounts in scope', a.total);
  add('Accounts', 'Accounts visited', a.visited);
  add('Accounts', 'Accounts not visited', a.not_visited);
  const act = summary.actions ?? {};
  add('Actions', 'Open actions', act.open);
  add('Actions', 'Overdue actions', act.overdue);
  add('Actions', 'Due in next 7 days', act.due_7_days);
  add('Actions', 'Completed in period', act.completed_in_range);
  const pl = summary.pipeline ?? {};
  add('Pipeline', 'Open opportunities', pl.open_count, pl.open_value, pl.weighted_value);
  add('Pipeline', 'Open opportunities without exchange rate (excluded from values)', pl.unconverted_count);
  for (const s of pl.by_stage ?? []) add('Pipeline by stage', s.stage, s.count, s.value, s.weighted);
  for (const s of pl.by_owner ?? []) add('Pipeline by owner', s.owner ?? 'Unassigned', s.count, s.value, s.weighted);
  for (const s of pl.by_segment ?? []) add('Pipeline by segment', s.segment, s.count, s.value, s.weighted);
  for (const s of pl.by_order_month ?? []) add('Pipeline by expected order month', s.month, s.count, s.value, s.weighted);
  const r = summary.results ?? {};
  add('Results', 'Won', r.won, r.won_value);
  add('Results', 'Lost', r.lost);
  for (const x of r.reasons ?? []) add(`Reasons (${x.outcome})`, x.reason, x.count);
  const q = summary.quotations ?? {};
  add('Quotations', 'Submitted', q.submitted, q.submitted_value);
  add('Quotations', 'Accepted', q.accepted);
  add('Quotations', 'Rejected', q.rejected);
  add('Quotations', 'Conversion % (accepted ÷ decided)', q.conversion_pct);
  add('Projects', `No activity for ${summary.stale_days ?? 30}+ days`, (summary.stale_projects ?? []).length);
  add('Projects', 'Tender / quotation deadlines in next 30 days', (summary.tender_deadlines ?? []).length);
  return rows;
}

/** Build the export workbook (Read Me, Summary and one flat sheet per table). */
export function buildExportWorkbook(data: ExportDataset, ctx: ExportContext = {}): Uint8Array {
  const margin = !!data.can_see_margin;
  const filters = data.filters ?? {};
  const label = (k: string) => ctx.filterLabels?.[k] ?? (filters[k] as string | undefined) ?? 'All';

  const readMe: Cell[][] = [
    ['Title', `${ctx.appName ?? 'DIMO Lighting'} – Sales visits and projects export`],
    ['Last refresh', toColomboIso(data.generated_at)],
    ['Generated by', ctx.generatedByName ?? data.generated_by ?? ''],
    ['Filter: date from', (filters.from as string) ?? 'Any'],
    ['Filter: date to', (filters.to as string) ?? 'Any'],
    ['Filter: owner', label('owner_id')],
    ['Filter: territory', label('territory_id')],
    ['Filter: stage', label('stage_id')],
    ['Base currency', data.base_currency],
    ['Time zone', 'Timestamps are ISO 8601 in Asia/Colombo time (+05:30); dates are YYYY-MM-DD'],
    ['Date filter rule', 'The date range applies to activity: visit date, action created/due date (open actions are always included), quotation submission, audit time. Customers, contacts, projects and opportunities are filtered by owner, territory and stage only.'],
    ['Formula rule', 'weighted_value = estimated_value × probability ÷ 100, in the record currency'],
    ['Formula rule', '*_base columns convert to the base currency using the latest exchange rate on or before the date; blank when no rate exists. Never add amounts in different currencies without using the *_base columns.'],
    ['Formula rule', 'duration_minutes = check_out_at − check_in_at'],
    ['Restricted fields', margin ? 'Included (your role may see cost and margin)' : 'Cost and margin columns are not included for your role'],
    ['Joins', 'Every sheet has unique IDs. Join Visits.customer_id → Customers.id, Contacts.customer_id → Customers.id, Visit Contacts.visit_id → Visits.id, Opportunities.project_id → Projects.id, Quotations.opportunity_id → Opportunities.id, Actions.parent_id → the parent sheet id.'],
    ['Attachments', 'Files are kept in secure storage and are not embedded in this workbook.'],
    [null, null],
    ['Sheet', 'One row represents', 'Key links', 'Rows'],
    ...SHEETS.map((s) => [s.name, s.rowMeans, s.keyLinks, (data.sheets[s.key] ?? []).length] as Cell[]),
    [null, null],
    ['Sheet', 'Column', 'Type', 'Definition'],
    ...SHEETS.flatMap((s) => visibleColumns(s, margin).map((col) => [s.name, col.key, col.type, col.description] as Cell[])),
  ];

  const sheets: SheetData[] = [
    { name: 'Read Me', headers: ['Item', 'Value', 'Detail', 'Rows'], rows: readMe, widths: [26, 60, 50, 60], table: false },
    { name: 'Summary', headers: ['section', 'item', 'count', `value_${data.base_currency}`, `weighted_${data.base_currency}`],
      rows: summaryRows(data.summary), widths: [34, 50, 10, 20, 20] },
  ];

  for (const def of SHEETS) {
    const cols = visibleColumns(def, margin);
    const rows = (data.sheets[def.key] ?? []).map((r) => cols.map((col) => toCell(r[col.key], col.type)));
    sheets.push({
      name: def.name,
      headers: cols.map((col) => col.key),
      rows,
      widths: cols.map((col) => (col.type === 'id' ? 38 : col.type === 'datetime' ? 26 : col.type === 'date' ? 12
        : ['summary', 'description', 'notes', 'requirements', 'purpose'].includes(col.key) ? 50 : Math.max(col.key.length + 2, 14))),
    });
  }

  return buildXlsx(sheets, { title: 'DIMO sales export', creator: ctx.generatedByName, created: new Date(data.generated_at) });
}

export function exportFileName(data: Pick<ExportDataset, 'generated_at' | 'filters'>): string {
  const stamp = (toColomboIso(data.generated_at) ?? '').slice(0, 16).replace(/[-:T]/g, '');
  const f = data.filters ?? {};
  const range = f.from || f.to ? `_${f.from ?? 'start'}_to_${f.to ?? 'today'}` : '';
  return `DIMO_Sales_Export${range}_${stamp}.xlsx`;
}
