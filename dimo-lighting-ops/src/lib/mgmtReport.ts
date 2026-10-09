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
  type Performance,
  type SecuredProject,
} from './finance';
import { todayISO } from './format';
import { rpc, supabase } from './supabase';

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
    /** Invoices moved to a later month this year, by cause (DIMO execution vs external) */
    moves?: { count: number; value: Money; dimoValue: Money; byReason: { reason: string; count: number; value: Money }[] };
    byLine: { line: string; budget: Money; forecast: Money; invoiced: Money; ytdBudget: Money; ytdInvoiced: Money }[];
    ready: Money; // execution: ready to invoice, not yet invoiced
    noBudget: boolean;
  };
  sales: {
    secured: { month: Money; ytd: Money; count: number; orderValueYtd: Money }; // secured as on Targets: this year's part of each win
    byLine: { line: string; month: Money; ytd: Money }[]; // orders won (full order value)
    people: { name: string; securedYtd: Money; securedTarget: Money; invoicedYtd: Money; invoiceTarget: Money }[];
    orderBook: Money; // still to invoice on open secured projects
    quotes: { won: number; lost: number; winRate: number | null; openValue: Money; open: number };
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

/** Every row of a query – the server returns at most 1,000 rows per request, so read page by page. */
export async function fetchAll(table: string, select: string, order: string, filter?: (q: any) => any): Promise<{ data: unknown[]; error: { message: string } | null }> {
  const out: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(select);
    if (filter) q = filter(q);
    const { data, error } = await q.order(order).range(from, from + 999);
    if (error) return { data: [], error };
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return { data: out, error: null };
  }
}

export async function buildManagementReport(month: string): Promise<MgmtReport> {
  const fy = fyOf(month);
  const ym = fyMonths(fy);
  const ytdMonths = ym.filter((m) => m <= month);
  const today = todayISO();
  const now = thisMonth();

  const q = await Promise.all([
    supabase.from('or_uploads').select('*').lte('month', month).order('month', { ascending: false }).limit(1),
    fetchAll('invoice_line_status', '*', 'id'),
    fetchAll('invoice_allocations', '*', 'id'),
    fetchAll('budget_projects', '*, budget_invoices(*)', 'id', (x) => x.eq('fy', fy)),
    fetchAll('secured_projects', '*', 'id'),
    // won / lost and open quotations follow the inquiries (as on the dashboards); a tender group counts once
    fetchAll('inquiries', 'id, status, order_value, currency, order_date, updated_at, tender_group_id, variation_id, quotations(quoted_value, currency, revision)', 'id', (x) =>
      x.in('status', ['won', 'lost', 'quotation_released', 'returned_to_sales', 'submitted_to_client', 'awaiting_client_approval', 'client_approved']).is('variation_id', null),
    ),
    // open debtors – as on the Debtors screen (amount = outstanding as per the latest upload)
    fetchAll('debts', '*', 'id', (x) => x.not('status', 'in', '(collected_confirmed,cleared)')),
    fetchAll('retentions', '*', 'id', (x) => x.in('status', ['held', 'claimed'])),
    fetchAll('bonds', '*', 'id', (x) => x.eq('status', 'active')),
    fetchAll('exec_projects', '*', 'id', (x) => x.eq('status', 'active')),
    fetchAll('exec_programmes', '*', 'exec_project_id'),
    fetchAll('exec_activities', 'id, exec_project_id, duration, pct, bl_start, bl_finish', 'id'),
    fetchAll('exec_cost_lines', 'exec_project_id, budget, committed, actual', 'id'),
    fetchAll('hse_reports', 'exec_project_id, kind, status, lost_time, occurred_at', 'id'),
    fetchAll('variations', 'status, value_lkr, smp_at, gm_at, raised_at', 'id'),
    fetchAll('exec_invoice_triggers', 'line_id, ready_at', 'line_id', (x) => x.not('ready_at', 'is', null)),
    fetchAll('warranty_claims', 'status, logged_at, cost_amount, recovered_amount', 'id'),
    fetchAll('invoice_line_changes', 'id, line_id, from_month, to_month, reason, status, requested_at, decided_at', 'id', (x) => x.in('status', ['approved', 'recorded'])),
    supabase.from('exchange_rates').select('usd_to_lkr, month').order('month', { ascending: false }).limit(1),
  ]);
  // Sales people: the same figures as Finance → Targets (secured = this year's part of each win, invoiced = recorded invoices)
  const perf = await rpc<Performance>('finance_performance', { p_fy: fy });
  const err = q.find((r) => r.error);
  if (err?.error) throw new Error(err.error.message);
  const [upR, linesR, allocR, budR, secR, quoR, debtR, retR, bondR, exR, pgR, actR, costR, hseR, varR, trigR, wcR, movR, rateR] = q.map((r) => (r.data ?? []) as unknown[]);
  const usdRate = n((rateR[0] as { usd_to_lkr?: number } | undefined)?.usd_to_lkr);
  let usdMissing = false;
  const lkr = (v: unknown, cur: unknown) => {
    if (cur === 'USD' && !usdRate && n(v)) usdMissing = true;
    return n(v) * (cur === 'USD' ? usdRate || 0 : 1);
  };

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
  // Invoices moved to a later month this year (approved or recorded), by cause
  const lineById = new Map(allLines.map((l) => [l.id, l]));
  const movedYtd = (movR as { line_id: string; from_month: string; to_month: string; reason: string; requested_at: string; decided_at: string | null }[]).filter((c) => {
    const d = (c.decided_at ?? c.requested_at).slice(0, 10);
    return c.to_month > c.from_month && d >= ym[0] && d.slice(0, 7) <= month.slice(0, 7);
  });
  const dimo = (r: string) => r === 'DIMO execution delay' || r.startsWith('Execution');
  const mvVal = (c: { line_id: string }) => n(lineById.get(c.line_id)?.amount);
  const moves = {
    count: movedYtd.length,
    value: sum(movedYtd, mvVal),
    dimoValue: sum(movedYtd.filter((c) => dimo(c.reason)), mvVal),
    byReason: [...new Set(movedYtd.map((c) => c.reason))]
      .map((reason) => ({ reason, count: movedYtd.filter((c) => c.reason === reason).length, value: sum(movedYtd.filter((c) => c.reason === reason), mvVal) }))
      .sort((a, b) => b.value - a.value),
  };
  const readyIds = new Set((trigR as { line_id: string }[]).map((t) => t.line_id));
  const invoicing: MgmtReport['invoicing'] = {
    month: { budget: budFor([month]), forecast: fcFor(month), invoiced: invFor([month]) },
    ytd: { budget: budFor(ytdMonths), invoiced: ytdInvoiced },
    fyBudget: budFor(ym),
    outlook,
    slipped: { count: slippedL.length, value: sum(slippedL, (l) => n(l.remaining)) },
    pending: lines.filter((l) => l.pending_change_id).length,
    moves,
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
  const ytdOf = (p: Performance['people'][number], k: 'secured' | 'secured_target' | 'invoiced' | 'invoice_target', ms = ytdMonths) =>
    sum(p.months.filter((m) => ms.includes(m.month)), (m) => n(m[k]));
  type Inq = { id: string; status: string; order_value: number | null; currency: string; order_date: string | null; updated_at: string; tender_group_id: string | null;
    quotations: { quoted_value: number; currency: string; revision: number }[] };
  // a tender group (one tender sent to several contractors) counts once
  const inqs = [...new Map((quoR as Inq[]).map((x) => [x.tender_group_id ?? x.id, x])).values()];
  const inYtd = (d: string | null) => !!d && ytdMonths.includes(d.slice(0, 7) + '-01');
  const won = inqs.filter((x) => x.status === 'won' && inYtd(x.order_date ?? x.updated_at)).length;
  const lost = inqs.filter((x) => x.status === 'lost' && inYtd(x.updated_at)).length;
  const quoted = (x: Inq) => {
    const q = [...(x.quotations ?? [])].sort((a, b) => b.revision - a.revision)[0];
    return q ? lkr(q.quoted_value, q.currency) : 0;
  };
  const openQ = inqs.filter((x) => !['won', 'lost'].includes(x.status));
  const sales: MgmtReport['sales'] = {
    secured: {
      month: sum(perf.people, (p) => ytdOf(p, 'secured', [month])),
      ytd: sum(perf.people, (p) => ytdOf(p, 'secured')),
      count: wonIn(ytdMonths).length,
      orderValueYtd: sum(wonIn(ytdMonths), (s) => n(s.order_value)),
    },
    byLine: LINES.map((x) => ({ line: x.label, month: sum(wonIn([month], x.value), (s) => n(s.order_value)), ytd: sum(wonIn(ytdMonths, x.value), (s) => n(s.order_value)) })),
    people: perf.people
      .map((p) => ({
        name: p.name,
        securedYtd: ytdOf(p, 'secured'),
        securedTarget: ytdOf(p, 'secured_target'),
        invoicedYtd: ytdOf(p, 'invoiced'),
        invoiceTarget: ytdOf(p, 'invoice_target'),
      }))
      .filter((p) => p.securedYtd || p.securedTarget || p.invoicedYtd || p.invoiceTarget)
      .sort((a, b) => b.securedYtd - a.securedYtd),
    orderBook: sum(allLines.filter((l) => l.project_status === 'open'), (l) => Math.max(0, n(l.remaining))),
    quotes: {
      won,
      lost,
      winRate: won + lost ? (won / (won + lost)) * 100 : null,
      openValue: sum(openQ, quoted),
      open: openQ.length,
    },
  };

  // ---- Cash
  const debts = (debtR as { client_name: string | null; project_name: string | null; amount: number; collected_amount: number | null; currency: string; outstanding_days: number; ageing_bucket: string; is_legal: boolean }[]).map((d) => ({
    ...d,
    due: lkr(d.amount, d.currency),
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
    retentions: { held: sum(rets, (r) => lkr(n(r.retention_value) - n(r.collected_amount), r.currency)), overdue: sum(overdueR, (r) => lkr(n(r.retention_value) - n(r.collected_amount), r.currency)), overdueCount: overdueR.length },
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
  if (invoicing.moves?.dimoValue) flags.push({ area: 'Invoicing', level: 'amber', text: `${mn(invoicing.moves.dimoValue)} of invoices moved to a later month this year because of DIMO execution delays.` });
  if (invoicing.slipped.count) flags.push({ area: 'Invoicing', level: 'red', text: `${invoicing.slipped.count} invoice(s) slipped – ${mn(invoicing.slipped.value)} not invoiced in the planned month.` });
  if (invoicing.ready > 0) flags.push({ area: 'Invoicing', level: 'amber', text: `${mn(invoicing.ready)} is ready to invoice from execution but not invoiced yet.` });

  headlines.push(`Secured ${mn(sales.secured.month)} in ${fmtMonth(month)} and ${mn(sales.secured.ytd)} YTD for this year's invoicing (${sales.secured.count} project(s) won, order value ${mn(sales.secured.orderValueYtd)}); order book to invoice ${mn(sales.orderBook)}.`);
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

  if (usdMissing) flags.push({ area: 'Cash', level: 'red', text: 'No USD exchange rate is set – USD debtors, retentions, bonds and quotations are left out. Set the rate in Settings.' });
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
