import { supabase } from './supabase';

// Project programme: WBS, activities, links, resources (dates and float come from the server's critical-path scheduling)
export type Programme = {
  exec_project_id: string;
  start_date: string;
  status: 'draft' | 'submitted' | 'approved';
  version: number;
  submitted_by: string | null;
  submitted_at: string | null;
  submit_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  baseline_finish: string | null;
  forecast_finish: string | null;
  edit_reason?: string | null;
  edit_requested_by?: string | null;
  edit_requested_at?: string | null;
};
export type Wbs = { id: string; exec_project_id: string; parent_id: string | null; code: string; name: string; sort: number };
export type Activity = {
  id: string;
  exec_project_id: string;
  wbs_id: string;
  code: string;
  name: string;
  duration: number;
  not_before: string | null;
  responsible_id: string | null;
  subcontractor: string | null;
  qty: number | null;
  unit: string | null;
  sort: number;
  pct: number;
  actual_start: string | null;
  actual_finish: string | null;
  progress_note: string | null;
  progress_by: string | null;
  progress_at: string | null;
  es: string | null;
  ef: string | null;
  ls: string | null;
  lf: string | null;
  total_float: number | null;
  critical: boolean;
  bl_start: string | null;
  bl_finish: string | null;
  pct_auto: number | null;
  auto_at: string | null;
};
export type Dep = { id: string; pred_id: string; succ_id: string; dep_type: 'FS' | 'SS' | 'FF' | 'SF'; lag: number };
export type Resource = { id: string; activity_id: string; kind: 'staff' | 'labour' | 'equipment' | 'subcontractor'; profile_id: string | null; name: string; qty: number; unit: string | null };

export const DEP_TYPES = [
  { value: 'FS', label: 'Finish → start (after it finishes)' },
  { value: 'SS', label: 'Start → start (after it starts)' },
  { value: 'FF', label: 'Finish → finish (finish together)' },
  { value: 'SF', label: 'Start → finish' },
];
export const RES_KINDS = [
  { value: 'staff', label: 'DIMO staff' },
  { value: 'labour', label: 'Labour / crew' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'subcontractor', label: 'Subcontractor' },
];
export const PROG_STATUS: Record<Programme['status'], string> = { draft: 'Draft', submitted: 'With SM Projects', approved: 'Approved' };

/** Natural sort for codes like 1, 1.2, 1.10, A10 */
export const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });

export type Row = { kind: 'wbs'; wbs: Wbs; depth: number } | { kind: 'act'; act: Activity; depth: number };

/** WBS tree with its activities, in display order */
export function programmeRows(wbs: Wbs[], acts: Activity[]): Row[] {
  const out: Row[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const w of wbs.filter((x) => x.parent_id === parent).sort(byCode)) {
      out.push({ kind: 'wbs', wbs: w, depth });
      walk(w.id, depth + 1);
      for (const a of acts.filter((x) => x.wbs_id === w.id).sort(byCode)) out.push({ kind: 'act', act: a, depth: depth + 1 });
    }
  };
  walk(null, 0);
  return out;
}

export const dayMs = 864e5;
export const toDay = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / dayMs);
export const fromDay = (n: number) => new Date(n * dayMs).toISOString().slice(0, 10);

/** WBS roll-up: earliest start, latest finish and duration-weighted % complete */
export function wbsSummary(w: Wbs, wbs: Wbs[], acts: Activity[]) {
  const ids = new Set<string>([w.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const x of wbs) {
      if (x.parent_id && ids.has(x.parent_id) && !ids.has(x.id)) {
        ids.add(x.id);
        grew = true;
      }
    }
  }
  const mine = acts.filter((a) => ids.has(a.wbs_id) && a.es && a.ef);
  if (!mine.length) return null;
  const start = mine.map((a) => a.es!).sort()[0];
  const finish = mine.map((a) => a.ef!).sort().slice(-1)[0];
  const w8 = mine.reduce((s, a) => s + Math.max(a.duration, 1), 0);
  const pct = mine.reduce((s, a) => s + Math.max(a.duration, 1) * Number(a.pct), 0) / w8;
  return { start, finish, pct, critical: mine.some((a) => a.critical) };
}

/** Resource loading per week (Monday): the quantity of each resource on the activities running that week */
export function weeklyLoading(acts: Activity[], res: Resource[]) {
  const cells = new Map<string, Map<string, number>>();
  const names = new Map<string, { name: string; unit: string | null; kind: string }>();
  for (const r of res) {
    const a = acts.find((x) => x.id === r.activity_id);
    if (!a?.es || !a.ef) continue;
    const key = `${r.kind}|${r.name.toLowerCase()}`;
    names.set(key, { name: r.name, unit: r.unit, kind: r.kind });
    const seen = new Set<string>();
    for (let d = toDay(a.es); d <= toDay(a.ef); d++) {
      const monday = fromDay(d - ((new Date(d * dayMs).getUTCDay() + 6) % 7));
      if (seen.has(monday)) continue;
      seen.add(monday);
      const m = cells.get(monday) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + Number(r.qty));
      cells.set(monday, m);
    }
  }
  return { weeks: [...cells.keys()].sort(), cells, names };
}

/** Activities offered when planning a week: those running or due in the week first (critical marked), finished ones left out */
export function activityOptions(acts: Activity[], week: string) {
  const end = fromDay(toDay(week) + 6);
  const open = acts.filter((a) => !a.actual_finish).sort(byCode);
  const due = (a: Activity) => !!a.es && !!a.ef && a.es <= end && a.ef >= week;
  const label = (a: Activity) => `${a.critical ? '⚠ ' : ''}${a.code} ${a.name}`;
  return [
    ...open.filter(due).map((a) => ({ value: a.id, label: label(a), group: 'Due this week' })),
    ...open.filter((a) => !due(a)).map((a) => ({ value: a.id, label: label(a), group: 'Other activities' })),
  ];
}

/** The project's programme activities, and whether the programme is approved (plan items must then be linked) */
export async function loadProgramme(project: string) {
  const [pg, a] = await Promise.all([
    supabase.from('exec_programmes').select('version').eq('exec_project_id', project).maybeSingle(),
    supabase.from('exec_activities').select('*').eq('exec_project_id', project),
  ]);
  return { live: ((pg.data as { version: number } | null)?.version ?? 0) > 0, acts: (a.data ?? []) as Activity[] };
}

// ---- Tracking ----
export type Snapshot = { exec_project_id: string; snap_date: string; pct_planned: number; pct_actual: number; forecast_finish: string | null; critical_open: number };

const dd = (a: string | null, b: string | null) => (a && b ? toDay(a) - toDay(b) : null);

/** Per activity: baseline vs actual / forecast, with start and finish variance in calendar days (+ = later than baseline) */
export function trackingRow(a: Activity, today: string) {
  const start = a.actual_start ?? a.es;
  const finish = a.actual_finish ?? a.ef;
  const startVar = dd(start, a.bl_start);
  const finishVar = dd(finish, a.bl_finish);
  const status = a.actual_finish
    ? 'Done'
    : a.actual_start
      ? (finishVar ?? 0) > 0
        ? 'In progress – behind'
        : 'In progress'
      : a.bl_start && a.bl_start < today
        ? 'Late to start'
        : 'Not started';
  return { start, finish, startVar, finishVar, status };
}
export const varText = (v: number | null) => (v == null ? '—' : v === 0 ? '0' : v > 0 ? `+${v} d` : `${v} d`);

/** Planned % on a date from the baseline (same rule as the server's app.planned_pct) */
export function plannedPct(acts: Activity[], on: string) {
  let w = 0;
  let s = 0;
  for (const a of acts) {
    const wt = Math.max(a.duration, 1);
    w += wt;
    if (!a.bl_start || !a.bl_finish) continue;
    const f = on >= a.bl_finish ? 1 : on < a.bl_start ? 0 : (toDay(on) - toDay(a.bl_start) + 1) / Math.max(toDay(a.bl_finish) - toDay(a.bl_start) + 1, 1);
    s += wt * f;
  }
  return w ? (s / w) * 100 : 0;
}
export function actualPct(acts: Activity[]) {
  const w = acts.reduce((t, a) => t + Math.max(a.duration, 1), 0);
  return w ? acts.reduce((t, a) => t + Math.max(a.duration, 1) * Number(a.pct), 0) / w : 0;
}
