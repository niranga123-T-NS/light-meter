import { actualPct, plannedPct, type Activity } from './programme';
import {
  addMonths,
  findLine,
  fmtMonth,
  fyLabel,
  fyMonths,
  fyOf,
  isIncomeLine,
  LINES,
  pnlGroups,
  thisMonth,
  type Allocation,
  type BudgetInvoice,
  type BudgetProject,
  type InvoiceLine,
  type OrUpload,
  type PnlLine,
  type SecuredProject,
} from './finance';
import { todayISO } from './format';
import { supabase } from './supabase';

// Management report (GM / DGM): the whole business for a month and the year to date, built from the data in the app.
// Figures only – the highlights and exceptions come from fixed rules (THRESHOLDS), not from AI.

export const THRESHOLDS = {
  invoicingBelowBudget: 0.9, // invoicing under 90% of budget
  salesBelowTarget: 0.8, // sales person under 80% of the secured / invoice target (YTD)
  profitBelowBudget: 0.1, // profit more than 10% under the YTD budget → red (any shortfall → amber)
  debtorsOver90Share: 0.2, // more than 20% of debtors older than 90 days
  behindProgramme: 10, // % points of work behind the plan
  costOverBudget: 1.0, // committed + actual above the cost budget
};

export type Level = 'red' | 'amber' | 'green';
export type Flag = { area: string; level: Level; text: string };
type Money = number;
type ActBud = { act: Money | null; bud: Money | null };

export type MgmtReport = {
  month: string;
  fy: number;
  builtAt: string;
  usdRate: number;
  headlines: string[];
  flags: Flag[];
  status: Record<'pnl' | 'invoicing' | 'sales' | 'cash' | 'execution' | 'warranty', Level>;
  pnl: {
    month: string | null; // month of the OR file used
    lines: { label: string; m: ActBud; ytd: ActBud; fyBp: Money | null }[];
    gpPct: { m: number | null; mBud: number | null; ytd: number | null; ytdBud: number | null };
    worse: { label: string; value: Money }[];
    better: { label: string; value: Money }[];
  };
  invoicing: {
    month: { budget: Money; forecast: Money; invoiced: Money };
    ytd: { budget: Money; invoiced: Money };
    fyBudget: Money;
    outlook: Money;
    slipped: { count: number; value: Money };
    pending: number;
    byLine: { line: string; budget: Money; forecast: Money; invoiced: Money; ytdBudget: Money; ytdInvoiced: Money }[];
    ready: Money; // execution: ready to invoice, not yet invoiced
    noBudget: boolean;
  };
  sales: {
    secured: { month: Money; ytd: Money; count: number };
    byLine: { line: string; month: Money; ytd: Money }[];
    people: { name: string; securedYtd: Money; securedTarget: Money; invoicedYtd: Money; invoiceTarget: Money }[];
    orderBook: Money; // still to invoice on open secured projects
    quotes: { releasedYtd: number; releasedValue: Money; won: number; lost: number; winRate: number | null; openValue: Money; open: number };
  };
  cash: {
    debtors: Money;
    over90: Money;
    buckets: { bucket: string; value: Money }[];
    legal: number;
    top: { client: string; value: Money; days: number }[];
    retentions: { held: Money; overdue: Money; overdueCount: number };
    bonds: { active: Money; count: number; expiring30: number };
  };
  execution: {
    active: number;
    projects: { code: string; name: string; stage: number; planned: number | null; actual: number | null; late: number | null; costPct: number | null; hseOpen: number }[];
    behind: number;
    overCost: number;
    variations: { approvedValue: Money; pending: number };
    hse: { month: number; incidents: number; lostTime: number; open: number };
  };
  warranty: { open: number; loggedMonth: number; costYtd: Money; recoveredYtd: Money };
};

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const n = (v: unknown) => Number(v ?? 0) || 0;
const mn = (v: number) => `${(v / 1e6).toFixed(2)} Mn`;
const pctTxt = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export async function buildManagementReport(month: string): Promise<MgmtReport> {
  const fy = fyOf(month);
  const ym = fyMonths(fy);
  const ytdMonths = ym.filter((m) => m <= month);
  const today = todayISO();
  const now = thisMonth();

  const q = await Promise.all([
    supabase.from('or_uploads').select('*').lte('month', month).order('month', { ascending: false }).limit(1),
    supabase.from('invoice_line_status').select('*'),
    supabase.from('invoice_allocations').select('*'),
    supabase.from('budget_projects').select('*, budget_invoices(*)').eq('fy', fy),
    supabase.from('secured_projects').select('*'),
    supabase.from('sales_targets').select('*').eq('fy', fy),
    supabase.from('quotations').select('id, quoted_value, currency, released_at, result, validity_date, revision, quotation_no'),
    supabase.from('debts').select('*').neq('status', 'collected'),
    supabase.from('retentions').select('*').in('status', ['held', 'claimed']),
    supabase.from('bonds').select('*').eq('status', 'active'),
    supabase.from('exec_projects').select('*').eq('status', 'active'),
    supabase.from('exec_programmes').select('*'),
    supabase.from('exec_activities').select('exec_project_id, duration, pct, bl_start, bl_finish'),
    supabase.from('exec_cost_lines').select('exec_project_id, budget, committed, actual'),
    supabase.from('hse_reports').select('exec_project_id, kind, status, lost_time, occurred_at'),
    supabase.from('variations').select('status, value_lkr, smp_at, gm_at, raised_at'),
    supabase.from('exec_invoice_triggers').select('line_id, ready_at').not('ready_at', 'is', null),
    supabase.from('warranty_claims').select('status, logged_at, cost_amount, recovered_amount'),
    supabase.from('exchange_rates').select('usd_to_lkr, month').order('month', { ascending: false }).limit(1),
    supabase.from('profiles').select('id, full_name'),
  ]);
  const err = q.find((r) => r.error);
  if (err?.error) throw new Error(err.error.message);
  const [upR, linesR, allocR, budR, secR, tgtR, quoR, debtR, retR, bondR, exR, pgR, actR, costR, hseR, varR, trigR, wcR, rateR, peopleR] = q.map((r) => (r.data ?? []) as unknown[]);
  const usdRate = n((rateR[0] as { usd_to_lkr?: number } | undefined)?.usd_to_lkr);
  const lkr = (v: unknown, cur: unknown) => n(v) * (cur === 'USD' ? usdRate || 0 : 1);
  const name = Object.fromEntries((peopleR as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  // ---- P&L (OR file of the month, or the latest before it)
  const up = upR[0] as OrUpload | undefined;
  const pl = up ? (((await supabase.from('pnl_lines').select('*').eq('upload_id', up.id)).data ?? []) as PnlLine[]) : [];
  const L = (label: string) => findLine(pl, label, 'pnl');
  const pick: [string, PnlLine | null][] = [
    ['Turnover', L('Total Turnover') ?? L('Gross Proceeds from Sales')],
    ['Gross profit', L('Gross Profit')],
    ['Operating profit', L('Operating Profit 01')],
    ['Net profit', L('Net Profit')],
  ];
  const plLines = pick
    .filter(([, l]) => l)
    .map(([label, l]) => ({ label, m: { act: l!.m_act, bud: l!.m_bud }, ytd: { act: l!.c_act, bud: l!.c_bud }, fyBp: l!.fy_bp }));
  const g = (k: 'm_act' | 'm_bud' | 'c_act' | 'c_bud') => {
    const t = pick[0][1];
    const gp = pick[1][1];
    return t && gp && n(t[k]) ? (n(gp[k]) / n(t[k])) * 100 : null;
  };
  const impact = (l: PnlLine) => (isIncomeLine(l.label) ? 1 : -1) * (n(l.c_act) - n(l.c_bud));
  const groups = pnlGroups(pl)
    .filter((x) => x.detail.length && !/turnover|proceeds|profit|cost of sales/i.test(x.total.label))
    .map((x) => ({ label: x.total.label, value: impact(x.total) }))
    .filter((x) => Math.abs(x.value) >= 100_000);
  const pnl: MgmtReport['pnl'] = {
    month: up?.month ?? null,
    lines: plLines,
    gpPct: { m: g('m_act'), mBud: g('m_bud'), ytd: g('c_act'), ytdBud: g('c_bud') },
    worse: groups.filter((x) => x.value < 0).sort((a, b) => a.value - b.value).slice(0, 5),
    better: groups.filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 5),
  };

  // ---- Invoicing (as on the Invoicing screen)
  const allLines = linesR as InvoiceLine[];
  const lines = allLines.filter((l) => l.project_status === 'open' && l.schedule_status === 'approved');
  const allocs = allocR as Allocation[];
  const budget = budR as (BudgetProject & { budget_invoices: BudgetInvoice[] })[];
  const secLine = (sid: string) => (secR as SecuredProject[]).find((x) => x.id === sid)?.business_line ?? allLines.find((l) => l.secured_id === sid)?.business_line ?? null;
  const budFor = (ms: string[], bl?: string) => sum(budget.filter((b) => !bl || b.business_line === bl), (b) => sum(b.budget_invoices.filter((i) => ms.includes(i.month)), (i) => n(i.amount)));
  const invFor = (ms: string[], bl?: string) => sum(allocs.filter((a) => ms.includes(a.month) && (!bl || secLine(a.secured_id) === bl)), (a) => n(a.amount));
  const fcFor = (m: string, bl?: string) => sum(lines.filter((l) => l.forecast_month === m && (!bl || l.business_line === bl)), (l) => n(l.amount));
  const slippedL = lines.filter((l) => l.forecast_month < now && n(l.remaining) > 0.5);
  const ytdInvoiced = invFor(ytdMonths);
  const outlook = ytdInvoiced + sum(lines.filter((l) => l.forecast_month > month && l.forecast_month <= ym[11]), (l) => Math.max(0, n(l.remaining))) + sum(lines.filter((l) => l.forecast_month <= month), (l) => Math.max(0, n(l.remaining)));
  const readyIds = new Set((trigR as { line_id: string }[]).map((t) => t.line_id));
  const invoicing: MgmtReport['invoicing'] = {
    month: { budget: budFor([month]), forecast: fcFor(month), invoiced: invFor([month]) },
    ytd: { budget: budFor(ytdMonths), invoiced: ytdInvoiced },
    fyBudget: budFor(ym),
    outlook,
    slipped: { count: slippedL.length, value: sum(slippedL, (l) => n(l.remaining)) },
    pending: lines.filter((l) => l.pending_change_id).length,
    byLine: LINES.map((x) => ({
      line: x.label,
      budget: budFor([month], x.value),
      forecast: fcFor(month, x.value),
      invoiced: invFor([month], x.value),
      ytdBudget: budFor(ytdMonths, x.value),
      ytdInvoiced: invFor(ytdMonths, x.value),
    })),
    ready: sum(lines.filter((l) => readyIds.has(l.id) && n(l.remaining) > 0.5), (l) => n(l.remaining)),
    noBudget: !budget.some((b) => b.budget_invoices.some((i) => ym.includes(i.month) && n(i.amount) > 0)),
  };

  // ---- Sales
  const secured = (secR as SecuredProject[]).filter((s) => s.source === 'won' && s.status !== 'cancelled');
  const wonIn = (ms: string[], bl?: string) => secured.filter((s) => ms.includes(s.won_on.slice(0, 7) + '-01') && (!bl || s.business_line === bl));
  const tgts = tgtR as { sales_person_id: string; month: string; secured_target: number; invoice_target: number }[];
  const peopleIds = [...new Set([...tgts.map((t) => t.sales_person_id), ...wonIn(ytdMonths).map((s) => s.sales_person_id).filter(Boolean)])] as string[];
  const invBy = (pid: string) => sum(allocs.filter((a) => ytdMonths.includes(a.month) && (secR as SecuredProject[]).find((s) => s.id === a.secured_id)?.sales_person_id === pid), (a) => n(a.amount));
  const quotes = (quoR as { quoted_value: number; currency: string; released_at: string; result: string | null; validity_date: string; quotation_no: string; revision: number }[]).filter(
    // latest revision of each quotation
    (x, _, all) => !all.some((y) => y.quotation_no === x.quotation_no && y.revision > x.revision),
  );
  const qYtd = quotes.filter((x) => ytdMonths.includes(x.released_at.slice(0, 7) + '-01'));
  const won = qYtd.filter((x) => x.result === 'won').length;
  const lost = qYtd.filter((x) => x.result === 'lost').length;
  const openQ = quotes.filter((x) => !x.result && x.validity_date >= today);
  const sales: MgmtReport['sales'] = {
    secured: { month: sum(wonIn([month]), (s) => n(s.order_value)), ytd: sum(wonIn(ytdMonths), (s) => n(s.order_value)), count: wonIn(ytdMonths).length },
    byLine: LINES.map((x) => ({ line: x.label, month: sum(wonIn([month], x.value), (s) => n(s.order_value)), ytd: sum(wonIn(ytdMonths, x.value), (s) => n(s.order_value)) })),
    people: peopleIds
      .map((pid) => ({
        name: name[pid] ?? '—',
        securedYtd: sum(wonIn(ytdMonths).filter((s) => s.sales_person_id === pid), (s) => n(s.order_value)),
        securedTarget: sum(tgts.filter((t) => t.sales_person_id === pid && ytdMonths.includes(t.month)), (t) => n(t.secured_target)),
        invoicedYtd: invBy(pid),
        invoiceTarget: sum(tgts.filter((t) => t.sales_person_id === pid && ytdMonths.includes(t.month)), (t) => n(t.invoice_target)),
      }))
      .sort((a, b) => b.securedYtd - a.securedYtd),
    orderBook: sum(allLines.filter((l) => l.project_status === 'open'), (l) => Math.max(0, n(l.remaining))),
    quotes: {
      releasedYtd: qYtd.length,
      releasedValue: sum(qYtd, (x) => lkr(x.quoted_value, x.currency)),
      won,
      lost,
      winRate: won + lost ? (won / (won + lost)) * 100 : null,
      openValue: sum(openQ, (x) => lkr(x.quoted_value, x.currency)),
      open: openQ.length,
    },
  };

  // ---- Cash
  const debts = (debtR as { client_name: string | null; project_name: string | null; amount: number; collected_amount: number | null; currency: string; outstanding_days: number; ageing_bucket: string; is_legal: boolean }[]).map((d) => ({
    ...d,
    due: lkr(n(d.amount) - n(d.collected_amount), d.currency),
  }));
  const BUCKETS = ['1-30', '31-60', '61-90', '91-120', '121-150', '151-180', 'over-180', 'over-365'];
  const byClient = new Map<string, { value: number; days: number }>();
  debts.forEach((d) => {
    const k = d.client_name ?? d.project_name ?? '—';
    const c = byClient.get(k) ?? { value: 0, days: 0 };
    byClient.set(k, { value: c.value + d.due, days: Math.max(c.days, d.outstanding_days) });
  });
  const rets = retR as { retention_value: number; collected_amount: number | null; currency: string; due_date: string; status: string }[];
  const overdueR = rets.filter((r) => r.due_date < today && r.status === 'held');
  const bonds = bondR as { bond_value: number; currency: string; expiry_date: string }[];
  const cash: MgmtReport['cash'] = {
    debtors: sum(debts, (d) => d.due),
    over90: sum(debts.filter((d) => d.outstanding_days > 90), (d) => d.due),
    buckets: BUCKETS.map((b) => ({ bucket: b, value: sum(debts.filter((d) => d.ageing_bucket === b), (d) => d.due) })).filter((b) => b.value),
    legal: debts.filter((d) => d.is_legal).length,
    top: [...byClient.entries()].map(([client, v]) => ({ client, ...v })).sort((a, b) => b.value - a.value).slice(0, 5),
    retentions: { held: sum(rets, (r) => lkr(n(r.retention_value) - n(r.collected_amount), r.currency)), overdue: sum(overdueR, (r) => lkr(r.retention_value, r.currency)), overdueCount: overdueR.length },
    bonds: { active: sum(bonds, (b) => lkr(b.bond_value, b.currency)), count: bonds.length, expiring30: bonds.filter((b) => b.expiry_date >= today && days(today, b.expiry_date) <= 30).length },
  };

  // ---- Execution
  const ex = exR as { id: string; code: string | null; name: string; stage: number }[];
  const pgs = pgR as { exec_project_id: string; version: number; baseline_finish: string | null; forecast_finish: string | null }[];
  const acts = actR as Activity[];
  const costs = costR as { exec_project_id: string; budget: number; committed: number; actual: number }[];
  const hse = hseR as { exec_project_id: string; kind: string; status: string; lost_time: boolean; occurred_at: string }[];
  const monthEnd = addMonths(month, 1);
  const asOf = month === now ? today : addMonths(month, 1);
  const projects = ex.map((p) => {
    const pg = pgs.find((x) => x.exec_project_id === p.id);
    const a = acts.filter((x) => x.exec_project_id === p.id);
    const live = !!pg && pg.version > 0 && a.length > 0;
    const c = costs.filter((x) => x.exec_project_id === p.id);
    const cb = sum(c, (x) => n(x.budget));
    return {
      code: p.code ?? '',
      name: p.name,
      stage: p.stage,
      planned: live ? Math.round(plannedPct(a, asOf)) : null,
      actual: live ? Math.round(actualPct(a)) : null,
      late: pg?.baseline_finish && pg.forecast_finish ? days(pg.baseline_finish, pg.forecast_finish) : null,
      costPct: cb ? Math.round((sum(c, (x) => n(x.committed) + n(x.actual)) / cb) * 100) : null,
      hseOpen: hse.filter((h) => h.exec_project_id === p.id && h.status !== 'closed').length,
    };
  });
  const vars = varR as { status: string; value_lkr: number | null; smp_at: string | null; gm_at: string | null }[];
  const decidedIn = (v: { smp_at: string | null; gm_at: string | null }) => {
    const d = (v.gm_at ?? v.smp_at ?? '').slice(0, 7) + '-01';
    return ytdMonths.includes(d);
  };
  const hseMonth = hse.filter((h) => h.occurred_at >= month && h.occurred_at < monthEnd);
  const execution: MgmtReport['execution'] = {
    active: ex.length,
    projects,
    behind: projects.filter((p) => (p.planned != null && p.actual != null && p.planned - p.actual > THRESHOLDS.behindProgramme) || (p.late ?? 0) > 0).length,
    overCost: projects.filter((p) => (p.costPct ?? 0) > THRESHOLDS.costOverBudget * 100).length,
    variations: {
      approvedValue: sum(vars.filter((v) => ['approved', 'client_accepted'].includes(v.status) && decidedIn(v)), (v) => n(v.value_lkr)),
      pending: vars.filter((v) => ['raised', 'pricing', 'pending_smp', 'pending_gm'].includes(v.status)).length,
    },
    hse: { month: hseMonth.length, incidents: hseMonth.filter((h) => h.kind === 'incident').length, lostTime: hseMonth.filter((h) => h.lost_time).length, open: hse.filter((h) => h.status !== 'closed').length },
  };

  // ---- Warranty
  const wc = wcR as { status: string; logged_at: string; cost_amount: number; recovered_amount: number }[];
  const wcYtd = wc.filter((c) => ytdMonths.includes(c.logged_at.slice(0, 7) + '-01'));
  const warranty: MgmtReport['warranty'] = {
    open: wc.filter((c) => c.status === 'open').length,
    loggedMonth: wc.filter((c) => c.logged_at >= month && c.logged_at < monthEnd).length,
    costYtd: sum(wcYtd, (c) => n(c.cost_amount)),
    recoveredYtd: sum(wcYtd, (c) => n(c.recovered_amount)),
  };

  // ---- Rules: headlines, exceptions, status
  const flags: Flag[] = [];
  const headlines: string[] = [];
  const turn = plLines.find((l) => l.label === 'Turnover');
  const np = plLines.find((l) => l.label === 'Net profit');
  if (!up) flags.push({ area: 'P&L', level: 'amber', text: 'No OR file loaded – P&L figures are not available.' });
  else if (up.month !== month) flags.push({ area: 'P&L', level: 'amber', text: `The OR file for ${fmtMonth(month)} is not loaded yet – P&L figures are for ${fmtMonth(up.month)}.` });
  if (turn && turn.ytd.bud) headlines.push(`Turnover YTD ${mn(n(turn.ytd.act))} against a budget of ${mn(n(turn.ytd.bud))} (${pctTxt(n(turn.ytd.act), n(turn.ytd.bud))}).`);
  if (pnl.gpPct.ytd != null) headlines.push(`Gross profit YTD ${pnl.gpPct.ytd.toFixed(1)}%${pnl.gpPct.ytdBud != null ? ` against ${pnl.gpPct.ytdBud.toFixed(1)}% budget` : ''}.`);
  if (np && np.ytd.bud != null) {
    const gap = n(np.ytd.act) - n(np.ytd.bud);
    headlines.push(`Net profit YTD ${mn(n(np.ytd.act))}, ${gap >= 0 ? `${mn(gap)} ahead of` : `${mn(-gap)} behind`} budget.`);
    if (gap < 0) flags.push({ area: 'P&L', level: -gap > Math.abs(n(np.ytd.bud)) * THRESHOLDS.profitBelowBudget ? 'red' : 'amber', text: `Net profit YTD is ${mn(-gap)} below budget.` });
  }
  pnl.worse.slice(0, 3).forEach((w) => flags.push({ area: 'P&L', level: 'amber', text: `${w.label}: ${mn(-w.value)} worse than the YTD budget.` }));

  if (invoicing.noBudget) flags.push({ area: 'Invoicing', level: 'amber', text: `No budget invoicing for ${fyLabel(fy)} – the budget list has no invoice months / amounts.` });
  else {
    headlines.push(`Invoiced YTD ${mn(invoicing.ytd.invoiced)} against a budget of ${mn(invoicing.ytd.budget)} (${pctTxt(invoicing.ytd.invoiced, invoicing.ytd.budget)}); year-end outlook ${mn(invoicing.outlook)} against ${mn(invoicing.fyBudget)}.`);
    const mInv = month < now ? invoicing.month.invoiced : invoicing.month.forecast;
    if (invoicing.month.budget && mInv < invoicing.month.budget * THRESHOLDS.invoicingBelowBudget)
      flags.push({ area: 'Invoicing', level: 'red', text: `${fmtMonth(month)} ${month < now ? 'invoiced' : 'forecast'} ${mn(mInv)} is ${pctTxt(mInv, invoicing.month.budget)} of the ${mn(invoicing.month.budget)} budget.` });
    if (invoicing.outlook < invoicing.fyBudget * THRESHOLDS.invoicingBelowBudget)
      flags.push({ area: 'Invoicing', level: 'amber', text: `Year-end outlook ${mn(invoicing.outlook)} is ${mn(invoicing.fyBudget - invoicing.outlook)} short of the ${fyLabel(fy)} budget.` });
  }
  if (invoicing.slipped.count) flags.push({ area: 'Invoicing', level: 'red', text: `${invoicing.slipped.count} invoice(s) slipped – ${mn(invoicing.slipped.value)} not invoiced in the planned month.` });
  if (invoicing.ready > 0) flags.push({ area: 'Invoicing', level: 'amber', text: `${mn(invoicing.ready)} is ready to invoice from execution but not invoiced yet.` });

  headlines.push(`Secured ${mn(sales.secured.month)} in ${fmtMonth(month)} and ${mn(sales.secured.ytd)} YTD (${sales.secured.count} project(s)); order book to invoice ${mn(sales.orderBook)}.`);
  sales.people
    .filter((p) => p.securedTarget > 0 && p.securedYtd < p.securedTarget * THRESHOLDS.salesBelowTarget)
    .forEach((p) => flags.push({ area: 'Sales', level: 'amber', text: `${p.name}: secured ${mn(p.securedYtd)} YTD – ${pctTxt(p.securedYtd, p.securedTarget)} of target.` }));
  if (sales.quotes.winRate != null) headlines.push(`Quotation win rate YTD ${Math.round(sales.quotes.winRate)}% (${sales.quotes.won} won, ${sales.quotes.lost} lost); ${sales.quotes.open} open quotation(s) worth ${mn(sales.quotes.openValue)}.`);

  if (cash.debtors) {
    headlines.push(`Debtors ${mn(cash.debtors)}, of which ${mn(cash.over90)} (${pctTxt(cash.over90, cash.debtors)}) is over 90 days.`);
    if (cash.over90 > cash.debtors * THRESHOLDS.debtorsOver90Share) flags.push({ area: 'Cash', level: 'red', text: `${pctTxt(cash.over90, cash.debtors)} of debtors (${mn(cash.over90)}) are over 90 days.` });
  }
  if (cash.legal) flags.push({ area: 'Cash', level: 'amber', text: `${cash.legal} debtor invoice(s) in legal action.` });
  if (cash.retentions.overdueCount) flags.push({ area: 'Cash', level: 'amber', text: `${cash.retentions.overdueCount} retention(s) past the due date and not claimed – ${mn(cash.retentions.overdue)}.` });
  if (cash.bonds.expiring30) flags.push({ area: 'Cash', level: 'amber', text: `${cash.bonds.expiring30} bond(s) expire within 30 days.` });

  projects
    .filter((p) => p.planned != null && p.actual != null && p.planned - p.actual > THRESHOLDS.behindProgramme)
    .forEach((p) => flags.push({ area: 'Execution', level: 'red', text: `${p.code} ${p.name}: ${p.actual}% done against ${p.planned}% planned.` }));
  projects.filter((p) => (p.late ?? 0) > 0).forEach((p) => flags.push({ area: 'Execution', level: 'amber', text: `${p.code} ${p.name}: forecast finish ${p.late} day(s) after the baseline.` }));
  projects.filter((p) => (p.costPct ?? 0) > 100).forEach((p) => flags.push({ area: 'Execution', level: 'red', text: `${p.code} ${p.name}: committed + actual cost at ${p.costPct}% of budget.` }));
  if (execution.hse.lostTime) flags.push({ area: 'Execution', level: 'red', text: `${execution.hse.lostTime} lost-time HSE incident(s) in ${fmtMonth(month)}.` });
  if (execution.hse.open) flags.push({ area: 'Execution', level: 'amber', text: `${execution.hse.open} HSE report(s) still open.` });
  if (execution.active) headlines.push(`${execution.active} project(s) in execution; ${execution.behind} behind programme, ${execution.overCost} over the cost budget.`);

  if (warranty.open) flags.push({ area: 'Warranty', level: warranty.open > 10 ? 'amber' : 'green', text: `${warranty.open} warranty claim(s) open; ${warranty.loggedMonth} logged in ${fmtMonth(month)}.` });

  const lvl = (area: string): Level => (flags.some((f) => f.area === area && f.level === 'red') ? 'red' : flags.some((f) => f.area === area && f.level === 'amber') ? 'amber' : 'green');
  const order = { red: 0, amber: 1, green: 2 };
  return {
    month,
    fy,
    builtAt: new Date().toISOString(),
    usdRate,
    headlines,
    flags: flags.sort((a, b) => order[a.level] - order[b.level]),
    status: { pnl: lvl('P&L'), invoicing: lvl('Invoicing'), sales: lvl('Sales'), cash: lvl('Cash'), execution: lvl('Execution'), warranty: lvl('Warranty') },
    pnl,
    invoicing,
    sales,
    cash,
    execution,
    warranty,
  };
}

export const AREAS: { key: keyof MgmtReport['status']; label: string }[] = [
  { key: 'pnl', label: 'P&L' },
  { key: 'invoicing', label: 'Invoicing' },
  { key: 'sales', label: 'Sales' },
  { key: 'cash', label: 'Cash' },
  { key: 'execution', label: 'Execution' },
  { key: 'warranty', label: 'Warranty' },
];
