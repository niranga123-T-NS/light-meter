import type { BillingRow } from './billing';
import { projectNo, stageLabel, type ExecProject } from './execution';
import { addDaysISO, fmtDate } from './format';
import { actualPct, plannedPct, type Activity } from './programme';
import { rpc, supabase } from './supabase';

// Project meeting pack: the figures of one execution project, gathered when the Senior Electrical Engineer presses
// Generate and kept with the meeting as they were then. Shown on the meeting page and in the minutes PDF.

type Item = { code: string; name: string; note: string };
export type ProjectPack = {
  team_kind?: 'project';
  generated_at: string;
  week_from: string;
  week_to: string;
  project: { no: string; name: string; client: string | null; site: string | null; stage: string; start: string | null; end: string | null; contract: number | null };
  progress: {
    live: boolean;
    status: string | null;
    planned: number | null;
    actual: number | null;
    baseline_finish: string | null;
    forecast_finish: string | null;
    late_days: number | null;
    critical_open: number;
  };
  behind: Item[];
  coming: Item[];
  plan: { items: number; done: number; partial: number; open: number; not_done: number; no_result: number };
  reports: { week: number; late: number; returned: number; last: string | null; days_missing: number };
  hse: { open: number; incidents_week: number; lost_time: number; actions_open: number; actions_overdue: number };
  qa: { tests_waiting: number; tests_returned: number; reports_waiting: number; ncrs_open: number; snags_open: number };
  materials: { approval: number; on_order: number; late: Item[] };
  variations: { open: number; open_value: number; approved_value: number };
  queries: { open: number; overdue: Item[] };
  billing: { at_risk: number; red: number; lines: Item[] };
  cost: { budget: number; spent: number; pct: number | null };
  actions: { action: string; owner: string | null; due: string | null; meeting: string }[];
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const workdays = (from: string, to: string) => {
  let c = 0;
  for (let d = from; d <= to; d = addDaysISO(d, 1)) if (new Date(`${d}T00:00:00`).getDay() !== 0) c++;
  return c;
};

/** The project's figures as at the meeting day: last week = the seven days before the meeting. */
export async function buildProjectPack(p: ExecProject, meetingDate: string): Promise<ProjectPack> {
  const on = meetingDate;
  const from = addDaysISO(on, -7);
  const to = addDaysISO(on, -1);
  const ex = p.id;
  const q = await Promise.all([
    supabase.from('exec_programmes').select('*').eq('exec_project_id', ex).maybeSingle(),
    supabase.from('exec_activities').select('*').eq('exec_project_id', ex).order('sort'),
    supabase.from('exec_plan_items').select('status, result_note').eq('exec_project_id', ex).gte('day', from).lte('day', to),
    supabase.from('exec_reports').select('report_date, status, is_late, level').eq('exec_project_id', ex).gte('report_date', from).lte('report_date', to),
    supabase.from('hse_reports').select('kind, status, lost_time, occurred_at').eq('exec_project_id', ex),
    supabase.from('hse_actions').select('status, due_date, hse_reports!inner(exec_project_id)').eq('hse_reports.exec_project_id', ex).eq('status', 'open'),
    supabase.from('test_records').select('status').eq('exec_project_id', ex).in('status', ['submitted', 'returned']),
    supabase.from('qa_reports').select('status').eq('exec_project_id', ex).eq('status', 'submitted'),
    supabase.from('ncrs').select('id').eq('exec_project_id', ex).eq('status', 'open'),
    supabase.from('snags').select('id').eq('exec_project_id', ex).eq('status', 'open'),
    supabase.from('material_requests').select('code, purpose, status, expected_date, required_date, supplier').eq('exec_project_id', ex).in('status', ['ae_review', 'submitted', 'pending_smp', 'approved', 'ordered', 'part_received']),
    supabase.from('variations').select('status, value_lkr').eq('exec_project_id', ex).not('status', 'in', '(rejected,cancelled,client_rejected)'),
    supabase.from('design_queries').select('code, question, status, target_date, raised_at').eq('exec_project_id', ex).in('status', ['raised', 'forwarded']),
    supabase.from('exec_cost_lines').select('budget, committed, actual').eq('exec_project_id', ex),
    supabase.from('sales_meetings').select('id, meeting_date').eq('team', 'project').eq('exec_project_id', ex).eq('status', 'published').lt('meeting_date', on),
    rpc<BillingRow[]>('billing_risk', { p_exec: ex }).catch(() => [] as BillingRow[]),
  ]);
  const [pgR, actR, planR, repR, hseR, hseActR, testR, qaR, ncrR, snagR, mrR, varR, dqR, costR, prevR] = q;
  const billing = q[15] as BillingRow[];
  for (const r of q.slice(0, 15) as { error: { message: string } | null }[]) if (r.error) throw new Error(r.error.message);

  const pg = pgR.data as { status: string; version: number; baseline_finish: string | null; forecast_finish: string | null } | null;
  const acts = (actR.data ?? []) as Activity[];
  const live = !!pg && pg.version > 0 && acts.length > 0;
  const behind = acts
    .filter((a) => a.bl_finish && a.bl_finish < on && Number(a.pct) < 100)
    .sort((a, b) => (a.bl_finish ?? '').localeCompare(b.bl_finish ?? ''))
    .map((a) => ({ code: a.code, name: a.name, note: `${Math.round(Number(a.pct))}% · due ${fmtDate(a.bl_finish!)} · ${days(a.bl_finish!, on)} days late${a.critical ? ' · critical' : ''}` }));
  const horizon = addDaysISO(on, 14);
  const coming = acts
    .filter((a) => Number(a.pct) < 100 && !a.actual_start && (a.es ?? a.bl_start) && (a.es ?? a.bl_start)! >= on && (a.es ?? a.bl_start)! <= horizon)
    .sort((a, b) => (a.es ?? a.bl_start ?? '').localeCompare(b.es ?? b.bl_start ?? ''))
    .map((a) => ({ code: a.code, name: a.name, note: `starts ${fmtDate((a.es ?? a.bl_start)!)}${a.critical ? ' · critical' : ''}` }));

  const items = (planR.data ?? []) as { status: string; result_note: string | null }[];
  const reps = (repR.data ?? []) as { report_date: string; status: string; is_late: boolean }[];
  const reportDays = new Set(reps.map((r) => r.report_date));
  const projStart = p.start_date && p.start_date > from ? p.start_date : from;
  const hse = (hseR.data ?? []) as { kind: string; status: string; lost_time: boolean; occurred_at: string }[];
  const hseActs = (hseActR.data ?? []) as { due_date: string | null }[];
  const tests = (testR.data ?? []) as { status: string }[];
  const mrs = (mrR.data ?? []) as { code: string; purpose: string | null; status: string; expected_date: string | null; required_date: string | null; supplier: string | null }[];
  const vars = (varR.data ?? []) as { status: string; value_lkr: number | null }[];
  const approvedVar = ['approved', 'client_accepted'];
  const dqs = (dqR.data ?? []) as { code: string; question: string; target_date: string | null }[];
  const costs = (costR.data ?? []) as { budget: number; committed: number; actual: number }[];
  const budget = costs.reduce((t, c) => t + n(c.budget), 0);
  const spent = costs.reduce((t, c) => t + n(c.committed) + n(c.actual), 0);

  // Open actions from this project's earlier meetings
  const prev = (prevR.data ?? []) as { id: string; meeting_date: string }[];
  let actions: ProjectPack['actions'] = [];
  if (prev.length) {
    const { data: a } = await supabase
      .from('sales_meeting_actions')
      .select('action, owner_id, due_date, meeting_id, profiles!sales_meeting_actions_owner_id_fkey(full_name)')
      .in(
        'meeting_id',
        prev.map((x) => x.id),
      )
      .eq('status', 'open');
    actions = ((a ?? []) as unknown as { action: string; due_date: string | null; meeting_id: string; profiles: { full_name: string } | null }[]).map((x) => ({
      action: x.action,
      owner: x.profiles?.full_name ?? null,
      due: x.due_date,
      meeting: prev.find((m) => m.id === x.meeting_id)?.meeting_date ?? '',
    }));
  }

  const risky = billing.filter((b) => b.status === 'amber' || b.status === 'red' || b.status === 'no_trigger');
  return {
    team_kind: 'project',
    generated_at: new Date().toISOString(),
    week_from: from,
    week_to: to,
    project: {
      no: projectNo(p),
      name: p.name,
      client: p.client_name,
      site: p.site_address,
      stage: stageLabel(p),
      start: p.start_date,
      end: p.end_date,
      contract: p.contract_value_lkr,
    },
    progress: {
      live,
      status: pg?.status ?? null,
      planned: live ? Math.round(plannedPct(acts, on)) : null,
      actual: live ? Math.round(actualPct(acts)) : null,
      baseline_finish: pg?.baseline_finish ?? null,
      forecast_finish: pg?.forecast_finish ?? null,
      late_days: pg?.baseline_finish && pg.forecast_finish ? days(pg.baseline_finish, pg.forecast_finish) : null,
      critical_open: acts.filter((a) => a.critical && Number(a.pct) < 100).length,
    },
    behind,
    coming,
    plan: {
      items: items.length,
      done: items.filter((i) => i.status === 'done').length,
      partial: items.filter((i) => i.status === 'partial').length,
      open: items.filter((i) => i.status === 'planned').length,
      not_done: items.filter((i) => i.status === 'not_done').length,
      no_result: items.filter((i) => i.status !== 'planned' && !i.result_note).length,
    },
    reports: {
      week: reps.length,
      late: reps.filter((r) => r.is_late).length,
      returned: reps.filter((r) => r.status === 'returned').length,
      last: reps.map((r) => r.report_date).sort().pop() ?? null,
      days_missing: projStart <= to ? Math.max(workdays(projStart, to) - reportDays.size, 0) : 0,
    },
    hse: {
      open: hse.filter((h) => h.status === 'open').length,
      incidents_week: hse.filter((h) => h.occurred_at.slice(0, 10) >= from && h.occurred_at.slice(0, 10) <= to).length,
      lost_time: hse.filter((h) => h.lost_time && h.occurred_at.slice(0, 10) >= from && h.occurred_at.slice(0, 10) <= to).length,
      actions_open: hseActs.length,
      actions_overdue: hseActs.filter((a) => a.due_date && a.due_date < on).length,
    },
    qa: {
      tests_waiting: tests.filter((t) => t.status === 'submitted').length,
      tests_returned: tests.filter((t) => t.status === 'returned').length,
      reports_waiting: (qaR.data ?? []).length,
      ncrs_open: (ncrR.data ?? []).length,
      snags_open: (snagR.data ?? []).length,
    },
    materials: {
      approval: mrs.filter((m) => ['ae_review', 'submitted', 'pending_smp'].includes(m.status)).length,
      on_order: mrs.filter((m) => ['approved', 'ordered', 'part_received'].includes(m.status)).length,
      late: mrs
        .filter((m) => {
          const due = m.expected_date ?? m.required_date;
          return !!due && due < on;
        })
        .map((m) => ({
          code: m.code,
          name: m.purpose ?? '',
          note: `${m.status.replace(/_/g, ' ')} · ${m.expected_date ? `expected ${fmtDate(m.expected_date)}` : `required ${fmtDate(m.required_date!)}`}${m.supplier ? ` · ${m.supplier}` : ''}`,
        })),
    },
    variations: {
      open: vars.filter((v) => !approvedVar.includes(v.status)).length,
      open_value: vars.filter((v) => !approvedVar.includes(v.status)).reduce((t, v) => t + n(v.value_lkr), 0),
      approved_value: vars.filter((v) => approvedVar.includes(v.status)).reduce((t, v) => t + n(v.value_lkr), 0),
    },
    queries: {
      open: dqs.length,
      overdue: dqs.filter((d) => d.target_date && d.target_date < on).map((d) => ({ code: d.code, name: d.question, note: `answer due ${fmtDate(d.target_date!)}` })),
    },
    billing: {
      at_risk: risky.length,
      red: billing.filter((b) => b.status === 'red').length,
      lines: risky.map((b) => ({ code: '', name: b.description, note: `${b.status === 'red' ? 'will miss the month' : b.status === 'no_trigger' ? 'no trigger' : 'at risk'} · deadline ${fmtDate(b.deadline)}` })),
    },
    cost: { budget, spent, pct: budget ? Math.round((spent / budget) * 100) : null },
    actions,
  };
}

type Facts = [string, string][];
type List = { title: string; items: string[]; tone?: 'red' | 'amber' };
const mn = (v: number) => `${(v / 1e6).toFixed(2)} Mn`;
const dt = (v: string | null) => (v ? fmtDate(v) : '—');

/** The pack as label / value pairs and lists – the same on the meeting page and in the minutes. */
export function projectFacts(pk: ProjectPack): { facts: Facts; lists: List[] } {
  const g = pk.progress;
  const facts: Facts = [
    ['Project', `${pk.project.no} · ${pk.project.name}`],
    ['Client', pk.project.client ?? '—'],
    ['Stage', pk.project.stage],
    ['Contract period', `${dt(pk.project.start)} – ${dt(pk.project.end)}`],
    ['Progress (planned / actual)', g.live ? `${g.planned}% / ${g.actual}%${g.planned != null && g.actual != null ? ` (${g.actual - g.planned >= 0 ? '+' : ''}${g.actual - g.planned} pts)` : ''}` : 'Programme not approved yet'],
    ['Finish (baseline → forecast)', g.baseline_finish ? `${dt(g.baseline_finish)} → ${dt(g.forecast_finish)}${g.late_days ? ` · ${g.late_days > 0 ? `${g.late_days} days late` : `${-g.late_days} days early`}` : ''}` : '—'],
    ['Critical activities open', String(g.critical_open)],
    ['Plan last week', pk.plan.items ? `${pk.plan.done} of ${pk.plan.items} done · ${pk.plan.partial} partly · ${pk.plan.not_done} not done · ${pk.plan.open} not updated${pk.plan.no_result ? ` · ${pk.plan.no_result} without result` : ''}` : 'No plan items'],
    ['Daily reports last week', `${pk.reports.week} submitted · ${pk.reports.late} late · ${pk.reports.days_missing} days missing${pk.reports.returned ? ` · ${pk.reports.returned} returned` : ''}`],
    ['HSE', `${pk.hse.open} open reports · ${pk.hse.incidents_week} last week${pk.hse.lost_time ? ` (${pk.hse.lost_time} lost time)` : ''} · ${pk.hse.actions_open} actions open (${pk.hse.actions_overdue} overdue)`],
    ['QA', `${pk.qa.tests_waiting} tests to verify · ${pk.qa.tests_returned} returned · ${pk.qa.reports_waiting} reports to approve · ${pk.qa.ncrs_open} NCRs · ${pk.qa.snags_open} snags`],
    ['Materials', `${pk.materials.approval} awaiting approval · ${pk.materials.on_order} on order · ${pk.materials.late.length} late`],
    ['Variations', `${pk.variations.open} open (LKR ${mn(pk.variations.open_value)}) · approved LKR ${mn(pk.variations.approved_value)}`],
    ['Design queries', `${pk.queries.open} open · ${pk.queries.overdue.length} overdue`],
    ['Billing', `${pk.billing.at_risk} invoice lines at risk${pk.billing.red ? ` (${pk.billing.red} will miss the month)` : ''}`],
    ['Cost', pk.cost.budget ? `LKR ${mn(pk.cost.spent)} of ${mn(pk.cost.budget)} budget (${pk.cost.pct}%)` : 'No cost budget'],
  ];
  const it = (x: Item) => `${x.code ? `${x.code} ` : ''}${x.name} – ${x.note}`;
  const lists: List[] = [
    { title: 'Activities behind the baseline', items: pk.behind.map(it), tone: 'red' as const },
    { title: 'Activities starting in the next 14 days', items: pk.coming.map(it) },
    { title: 'Late materials', items: pk.materials.late.map(it), tone: 'amber' as const },
    { title: 'Overdue design queries', items: pk.queries.overdue.map(it), tone: 'amber' as const },
    { title: 'Invoice lines at risk', items: pk.billing.lines.map(it), tone: 'red' as const },
    {
      title: 'Open actions from earlier project meetings',
      items: pk.actions.map((a) => `${a.action}${a.owner ? ` – ${a.owner}` : ''}${a.due ? ` · by ${fmtDate(a.due)}` : ''} (meeting ${fmtDate(a.meeting)})`),
      tone: 'amber' as const,
    },
  ].filter((l) => l.items.length);
  return { facts, lists };
}
