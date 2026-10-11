import { Platform } from 'react-native';
import type { ProjectType, Role } from './types';

export const ROLE_LABELS: Record<Role, string> = {
  gm: 'GM / DGM – Lighting Solutions',
  sm_projects: 'Senior Manager – Building & Infrastructure Projects',
  asm_building: 'Assistant Sales Manager – Building Lighting',
  asm_infra: 'Assistant Sales Manager – Infrastructure Lighting',
  design_manager: 'Design Manager',
  lighting_designer: 'Lighting Designer',
  lighting_engineer: 'Lighting Engineer',
  sm_estimation: 'Senior Manager – Estimation',
  am_estimation: 'Assistant Manager – Estimation (Infrastructure)',
  estimation_exec: 'Estimation Executive (Building)',
  operations_exec: 'Operations Executive',
  senior_elec_engineer: 'Senior Electrical Engineer – Project Execution',
  assistant_engineer: 'Assistant Engineer – Project Execution',
  trainee: 'Trainee – Project Execution',
  sub_supervisor: 'Subcontractor Supervisor',
  sys_admin: 'System Administrator',
};

export const ROLE_SHORT: Record<Role, string> = {
  gm: 'GM / DGM',
  sm_projects: 'SM Projects',
  asm_building: 'ASM Building',
  asm_infra: 'ASM Infrastructure',
  design_manager: 'Design Manager',
  lighting_designer: 'Lighting Designer',
  lighting_engineer: 'Lighting Engineer',
  sm_estimation: 'SM Estimation',
  am_estimation: 'AM Estimation',
  estimation_exec: 'Estimation Exec.',
  operations_exec: 'Operations Exec.',
  senior_elec_engineer: 'Senior Elec. Engineer',
  assistant_engineer: 'Asst. Engineer',
  trainee: 'Trainee',
  sub_supervisor: 'Sub. Supervisor',
  sys_admin: 'System Admin',
};

export const PROJECT_TYPES: { value: ProjectType; label: string; line: 'Building' | 'Infrastructure' }[] = [
  { value: 'hospitality', label: 'Hospitality', line: 'Building' },
  { value: 'retail', label: 'Retail', line: 'Building' },
  { value: 'institutions', label: 'Institutions', line: 'Building' },
  { value: 'commercial', label: 'Commercial', line: 'Building' },
  { value: 'infrastructure', label: 'Infrastructure', line: 'Infrastructure' },
  { value: 'industrial', label: 'Industrial', line: 'Infrastructure' },
];

export const projectTypeLabel = (t: string | null | undefined) => PROJECT_TYPES.find((p) => p.value === t)?.label ?? t ?? '—';

export const isSales = (r?: Role | null) => r === 'asm_building' || r === 'asm_infra';
export const isDesigner = (r?: Role | null) => r === 'lighting_designer' || r === 'lighting_engineer';
export const isEstimator = (r?: Role | null) => r === 'am_estimation' || r === 'estimation_exec';
export const isManager = (r?: Role | null) =>
  r === 'gm' || r === 'sm_projects' || r === 'design_manager' || r === 'sm_estimation';

export type NavItem = { href: string; label: string; icon: string; badgeKey?: 'approvals' | 'notifications' | 'delayed'; testing?: boolean };

/** Execution-module menu items – marked Testing until confirmed */
export const EXEC_NAV = {
  portfolio: { href: '/execution', label: 'Execution portfolio', icon: '◧', testing: true } as NavItem,
  projects: { href: '/execution', label: 'Execution projects', icon: '◧', testing: true } as NavItem,
  mine: { href: '/execution', label: 'My projects', icon: '◧', testing: true } as NavItem,
  myWork: { href: '/execution', label: 'My work', icon: '◧', testing: true } as NavItem,
  team: { href: '/execution/team', label: 'Team & access', icon: '☺', testing: true } as NavItem,
  plans: { href: '/execution/plans', label: 'Plans', icon: '▦', testing: true } as NavItem,
  reports: { href: '/execution/reports', label: 'Daily reports', icon: '✎', testing: true } as NavItem,
  report: { href: '/execution/reports', label: 'Daily report', icon: '✎', testing: true } as NavItem,
  hse: { href: '/execution/hse', label: 'HSE', icon: '⚠', testing: true } as NavItem,
  variations: { href: '/execution/variations', label: 'Variations', icon: '±', testing: true } as NavItem,
  access: { href: '/execution/team', label: 'Execution access', icon: '☺', testing: true } as NavItem,
  materials: { href: '/execution/materials', label: 'Materials & stores', icon: '⛟', testing: true } as NavItem,
  documents: { href: '/execution/documents', label: 'Documents', icon: '❏', testing: true } as NavItem,
  queries: { href: '/execution/queries', label: 'Design queries', icon: '?', testing: true } as NavItem,
  certs: { href: '/execution/certs', label: 'Subcontractor invoices', icon: '⧉', testing: true } as NavItem,
};


/** Navigation per role (Section 2 visibility rule and Section 10.2 dashboards). Everyone gets Meetings: the sales,
 * estimation and design meetings in one place (invitations, attendance, leave, packs and actions). */
export function navFor(role: Role): NavItem[] {
  const items = baseNav(role);
  const meetings: NavItem = { href: '/meetings', label: 'Meetings', icon: '◴' };
  // Sales map: web app only, for GM / DGM, SM Projects and sales – placed after Visits
  if (Platform.OS === 'web' && (role === 'gm' || role === 'sm_projects' || isSales(role))) {
    const at = items.findIndex((i) => i.href === '/visits');
    items.splice(at < 0 ? items.length : at + 1, 0, { href: '/map', label: 'Map', icon: '⌖' });
  }
  // Instruments: everyone except the project teams (under each project's QA tab) and subcontractors
  if (!['sub_supervisor', 'senior_elec_engineer', 'assistant_engineer', 'trainee', 'sys_admin'].includes(role)) {
    const at = items.findIndex((i) => i.href === '/reports');
    items.splice(at < 0 ? items.length : at, 0, { href: '/instruments', label: 'Instruments', icon: '⚖', testing: true });
  }
  // SAP stock: Operations uploads; GM / DGM and SM Projects see values; other office roles see quantities and ageing
  if (!['sub_supervisor', 'trainee', 'sys_admin'].includes(role)) {
    const at = items.findIndex((i) => i.href === '/reports');
    items.splice(at < 0 ? items.length : at, 0, { href: '/stock', label: 'Stock (SAP)', icon: '▤' });
  }
  return [...items.slice(0, 1), meetings, ...items.slice(1)];
}

function baseNav(role: Role): NavItem[] {
  const home: NavItem = { href: '/', label: 'Home', icon: '⌂' };
  const approvals: NavItem = { href: '/approvals', label: 'Approvals', icon: '✓', badgeKey: 'approvals' };
  const reports: NavItem = { href: '/reports', label: 'Reports', icon: '▤' };
  const brands: NavItem = { href: '/brands', label: 'Brands', icon: '◈' };
  switch (role) {
    case 'asm_building':
    case 'asm_infra':
      return [
        { href: '/', label: 'My Day', icon: '⌂' },
        { href: '/visits', label: 'Visits', icon: '◎' },
        { href: '/plan', label: 'Plan', icon: '▦' },
        { href: '/projects', label: 'Projects', icon: '◆' },
        { href: '/inquiries', label: 'Pending', icon: '⧗', badgeKey: 'delayed' },
        { href: '/customers', label: 'Customers', icon: '☷' },
        { href: '/debtors', label: 'My Debtors', icon: '₨' },
        { href: '/retentions', label: 'Retentions', icon: '⛁' },
        { href: '/bonds', label: 'Bonds', icon: '⛨' },
        { href: '/warranty', label: 'Warranty', icon: '⛉' },
        { href: '/samples', label: 'Samples', icon: '⬚' },
        { href: '/finance/my', label: 'My Target', icon: '◉' },
        { href: '/finance/secured', label: 'Secured', icon: '◇' },
        { href: '/finance/invoicing', label: 'Invoicing', icon: '⧉' },
        { href: '/scorecard', label: 'Scorecard', icon: '★' },
        reports,
      ];
    case 'sm_projects':
      return [
        home,
        approvals,
        { href: '/dashboard', label: 'Dashboard', icon: '◔' },
        { href: '/plan', label: 'Plans', icon: '▦' },
        { href: '/visits', label: 'Visits', icon: '◎' },
        { href: '/projects', label: 'Projects', icon: '◆' },
        { href: '/inquiries', label: 'Inquiries', icon: '⧗', badgeKey: 'delayed' },
        { href: '/customers', label: 'Customers', icon: '☷' },
        { href: '/debtors', label: 'Debtors', icon: '₨' },
        { href: '/retentions', label: 'Retentions', icon: '⛁' },
        { href: '/bonds', label: 'Bonds', icon: '⛨' },
        { href: '/warranty', label: 'Warranty', icon: '⛉' },
        { href: '/engineering', label: 'Engineering jobs', icon: '▣' },
        EXEC_NAV.portfolio,
        EXEC_NAV.hse,
        EXEC_NAV.materials,
        EXEC_NAV.certs,
        EXEC_NAV.access,
        { href: '/samples', label: 'Samples', icon: '⬚' },
        { href: '/finance/pnl', label: 'P&L', icon: '▥' },
        { href: '/finance/invoicing', label: 'Invoicing', icon: '⧉' },
        { href: '/finance/secured', label: 'Secured', icon: '◇' },
        { href: '/finance/budget', label: 'Budget list', icon: '◫' },
        { href: '/finance/targets', label: 'Targets', icon: '◉' },
        { href: '/scorecard', label: 'Scorecards', icon: '★' },
        reports,
        { href: '/admin', label: 'Team & lists', icon: '⚙' },
      ];
    case 'gm':
      return [
        home,
        approvals,
        { href: '/dashboard', label: 'Overall', icon: '◔' },
        { href: '/inquiries', label: 'Inquiries', icon: '⧗' },
        { href: '/projects', label: 'Projects', icon: '◆' },
        { href: '/jobs', label: 'Jobs', icon: '▣' },
        { href: '/visits', label: 'Visits', icon: '◎' },
        { href: '/customers', label: 'Customers', icon: '☷' },
        { href: '/debtors', label: 'Debtors', icon: '₨' },
        { href: '/retentions', label: 'Retentions', icon: '⛁' },
        { href: '/bonds', label: 'Bonds', icon: '⛨' },
        { href: '/warranty', label: 'Warranty', icon: '⛉' },
        { href: '/engineering', label: 'Engineering jobs', icon: '▣' },
        EXEC_NAV.portfolio,
        EXEC_NAV.access,
        { href: '/samples', label: 'Samples', icon: '⬚' },
        { href: '/finance/pnl', label: 'P&L', icon: '▥' },
        { href: '/finance/invoicing', label: 'Invoicing', icon: '⧉' },
        { href: '/finance/secured', label: 'Secured', icon: '◇' },
        { href: '/finance/budget', label: 'Budget list', icon: '◫' },
        { href: '/finance/targets', label: 'Targets', icon: '◉' },
        { href: '/scorecard', label: 'Scorecards', icon: '★' },
        reports,
        { href: '/admin', label: 'Settings', icon: '⚙' },
      ];
    case 'design_manager':
      return [
        { href: '/', label: 'Design Board', icon: '⌂' },
        approvals,
        { href: '/inquiries', label: 'Inquiries', icon: '⧗' },
        { href: '/jobs', label: 'Jobs', icon: '▣' },
        EXEC_NAV.queries,
        EXEC_NAV.documents,
        brands,
        reports,
      ];
    case 'lighting_designer':
    case 'lighting_engineer':
      return [{ href: '/', label: 'My Jobs', icon: '⌂' }, { href: '/jobs', label: 'All my jobs', icon: '▣' }, EXEC_NAV.queries, brands, reports];
    case 'sm_estimation':
      return [
        { href: '/', label: 'Estimation Board', icon: '⌂' },
        approvals,
        { href: '/inquiries', label: 'Inquiries', icon: '⧗' },
        { href: '/jobs', label: 'Jobs', icon: '▣' },
        { href: '/customers', label: 'Customers', icon: '☷' },
        { href: '/finance/pnl', label: 'P&L', icon: '▥' },
        { href: '/finance/invoicing', label: 'Invoicing', icon: '⧉' },
        { href: '/finance/secured', label: 'Secured', icon: '◇' },
        { href: '/finance/budget', label: 'Budget list', icon: '◫' },
        { href: '/finance/targets', label: 'Targets', icon: '◉' },
        brands,
        reports,
      ];
    case 'am_estimation':
    case 'estimation_exec':
      return [{ href: '/', label: 'My Estimates', icon: '⌂' }, { href: '/jobs', label: 'All my jobs', icon: '▣' }, brands, reports];
    case 'operations_exec':
      return [
        { href: '/', label: 'Home', icon: '⌂' },
        { href: '/debtors/upload', label: 'Debtors Upload', icon: '⇪' },
        { href: '/debtors', label: 'All Debtors', icon: '₨' },
        { href: '/retentions', label: 'Retentions', icon: '⛁' },
        { href: '/bonds', label: 'Bonds', icon: '⛨' },
        { href: '/warranty', label: 'Warranty', icon: '⛉' },
        { href: '/samples', label: 'Samples', icon: '⬚' },
        { href: '/finance/upload', label: 'OR Upload', icon: '⇪' },
        { href: '/finance/budget', label: 'Budget list', icon: '◫' },
        { href: '/finance/secured', label: 'Secured', icon: '◇' },
        { href: '/finance/invoicing', label: 'Invoicing', icon: '⧉' },
        EXEC_NAV.portfolio,
        EXEC_NAV.materials,
        EXEC_NAV.documents,
        EXEC_NAV.certs,
        approvals,
        reports,
      ];
    case 'senior_elec_engineer':
      return [
        { href: '/', label: 'My Day', icon: '⌂' },
        EXEC_NAV.projects,
        { href: '/engineering', label: 'Tasks & instructions', icon: '▣' },
        EXEC_NAV.plans,
        EXEC_NAV.reports,
        EXEC_NAV.variations,
        EXEC_NAV.hse,
        EXEC_NAV.materials,
        EXEC_NAV.queries,
        EXEC_NAV.certs,
        approvals,
        EXEC_NAV.team,
        { href: '/warranty', label: 'Warranty', icon: '⛉' },
        { href: '/projects', label: 'Projects', icon: '◆' },
        reports,
      ];
    case 'assistant_engineer':
      return [
        { href: '/', label: 'My Day', icon: '⌂' },
        EXEC_NAV.mine,
        { href: '/engineering', label: 'Tasks & instructions', icon: '▣' },
        EXEC_NAV.plans,
        EXEC_NAV.reports,
        EXEC_NAV.variations,
        EXEC_NAV.hse,
        EXEC_NAV.materials,
        EXEC_NAV.queries,
        { href: '/warranty', label: 'Warranty', icon: '⛉' },
      ];
    case 'trainee':
      return [{ href: '/', label: 'My Day', icon: '⌂' }, EXEC_NAV.mine, { href: '/engineering', label: 'Tasks & instructions', icon: '▣' }, EXEC_NAV.hse];
    case 'sub_supervisor':
      return [{ href: '/', label: 'My Day', icon: '⌂' }, EXEC_NAV.myWork, { href: '/execution/sub-plan', label: 'My plan', icon: '▦', testing: true } as NavItem, EXEC_NAV.report, EXEC_NAV.materials, EXEC_NAV.hse];
    case 'sys_admin':
      return [{ href: '/', label: 'Home', icon: '⌂' }, { href: '/admin', label: 'Administration', icon: '⚙' }];
  }
}

// ---------------------------------------------------------------------------
// Report catalogue (Section 9.7) – "Own", "Team", "All" or null (hidden)
// ---------------------------------------------------------------------------
export type Scope = 'Own' | 'Team' | 'All' | null;
type Col = 'asm' | 'smp' | 'dm' | 'des' | 'sme' | 'est' | 'gm' | 'ops';

export type ReportDef = { key: string; title: string; area: 'Sales' | 'Projects' | 'Design' | 'Estimation' | 'Management'; access: Partial<Record<Col, Scope>> };

export const REPORTS: ReportDef[] = [
  { key: 'visits', title: 'Visit report and plan-vs-actual', area: 'Sales', access: { asm: 'Own', smp: 'Team', gm: 'All' } },
  { key: 'scorecard', title: 'Salesperson KPI scorecard', area: 'Sales', access: { asm: 'Own', smp: 'Team', gm: 'All' } },
  { key: 'inquiries_by_category', title: 'Visits and inquiries by sales person and category', area: 'Sales', access: { asm: 'Own', smp: 'Team', gm: 'All' } },
  { key: 'pipeline', title: 'Project pipeline and stage movement', area: 'Projects', access: { asm: 'Own', smp: 'Team', gm: 'All' } },
  { key: 'win_probability', title: 'Win-probability project list', area: 'Projects', access: { smp: 'Team', gm: 'All' } },
  { key: 'project_term', title: 'Short / medium / long term project lists', area: 'Projects', access: { gm: 'All' } },
  { key: 'client_view', title: 'Client view and category view', area: 'Projects', access: { smp: 'Team', gm: 'All' } },
  { key: 'tenders', title: 'Tender and competitor report', area: 'Sales', access: { asm: 'Own', smp: 'Team', sme: 'All', gm: 'All' } },
  { key: 'quotations', title: 'Quotation register', area: 'Estimation', access: { asm: 'Own', smp: 'Team', sme: 'Team', est: 'Own', gm: 'All' } },
  { key: 'turnaround', title: 'Inquiry turnaround and SLA compliance', area: 'Management', access: { asm: 'Own', smp: 'Team', dm: 'Team', sme: 'Team', gm: 'All' } },
  { key: 'delay_reasons', title: 'Delay and hold reason analysis', area: 'Management', access: { smp: 'Team', dm: 'Team', sme: 'Team', gm: 'All' } },
  { key: 'stakeholders', title: 'Stakeholder engagement', area: 'Sales', access: { asm: 'Own', smp: 'Team', gm: 'All' } },
  { key: 'design_performance', title: 'Design team performance', area: 'Design', access: { dm: 'Team', des: 'Own', gm: 'All' } },
  { key: 'estimation_performance', title: 'Estimation team performance', area: 'Estimation', access: { sme: 'Team', est: 'Own', gm: 'All' } },
  { key: 'team_map', title: 'Team structure map', area: 'Management', access: { smp: 'Team', dm: 'Team', sme: 'Team', gm: 'All' } },
  { key: 'debtors', title: 'Debtors ageing report', area: 'Management', access: { asm: 'Own', smp: 'All', gm: 'All', ops: 'All' } },
  { key: 'samples', title: 'Samples status report', area: 'Sales', access: { asm: 'Own', smp: 'All', gm: 'All' } },
];

const COL: Record<Role, Col | null> = {
  asm_building: 'asm',
  asm_infra: 'asm',
  sm_projects: 'smp',
  design_manager: 'dm',
  lighting_designer: 'des',
  lighting_engineer: 'des',
  sm_estimation: 'sme',
  am_estimation: 'est',
  estimation_exec: 'est',
  gm: 'gm',
  operations_exec: 'ops',
  senior_elec_engineer: null,
  assistant_engineer: null,
  trainee: null,
  sub_supervisor: null,
  sys_admin: null,
};

export function reportsFor(role: Role): (ReportDef & { scope: Scope })[] {
  const c = COL[role];
  if (!c) return [];
  return REPORTS.filter((r) => r.access[c]).map((r) => ({ ...r, scope: r.access[c] ?? null }));
}
