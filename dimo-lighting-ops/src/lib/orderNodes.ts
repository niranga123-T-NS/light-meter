import { Platform } from 'react-native';
import { route, type FoOrder, type Handover, type Step, type StepDef } from '@/lib/foreignOrders';
import { loRoute, type LoOrder, type LoRequest, type LoStep, type LoStepDef } from '@/lib/localOrders';

/** The nodes an import or local order passes through. Finance is hidden: we only see an order go in and come out. */
export type NodeKey = 'lt' | 'dir' | 'fbp' | 'pro' | 'fin' | 'log' | 'ext';
export const NODES: { key: NodeKey; name: string; colour: string; who: string; hidden?: boolean }[] = [
  { key: 'lt', name: 'Lighting Dept', colour: '#C8102E', who: 'Estimation, Operations, Sales, DGM' },
  { key: 'dir', name: 'Director', colour: '#6D28D9', who: 'DIC approvals' },
  { key: 'fbp', name: 'FBP', colour: '#0F766E', who: 'Project, import order, PR and selection approvals' },
  { key: 'pro', name: 'Procurement', colour: '#C2410C', who: 'Quotations, negotiation, PO / LOA, CI + PL' },
  { key: 'fin', name: 'Finance', colour: '#64748B', who: 'Hidden – TT, LC, advances, duty', hidden: true },
  { key: 'log', name: 'Logistics', colour: '#1D4ED8', who: 'Forwarder, clearing, release, delivery' },
  { key: 'ext', name: 'Outside DIMO', colour: '#9CA3AF', who: 'Manufacturer, supplier, bank, forwarder, Admin, MDM, Legal' },
];
export const nodeInfo = (k: NodeKey) => NODES.find((n) => n.key === k)!;

/** Which node a step's owner belongs to */
export function nodeOf(owner: string): NodeKey {
  const o = owner.toLowerCase();
  if (o.startsWith('finance')) return 'fin';
  if (o.startsWith('logistics')) return 'log';
  if (o === 'procurement') return 'pro';
  if (o === 'fbp') return 'fbp';
  if (o === 'dic') return 'dir';
  if (['estimation', 'operations', 'sales', 'dgm', 'requester', 'sales · operations', 'operations · sales'].includes(o)) return 'lt';
  return 'ext';
}

/** The fill of a node's bar – Finance striped on the web; 'finx' is Finance time whose start or end we did not see (lighter stripes) */
export function nodeFill(k: NodeKey | 'finx'): object {
  if (k === 'finx') return Platform.OS === 'web' ? { backgroundImage: 'repeating-linear-gradient(135deg, #94A3B8 0 3px, #EEF1F5 3px 8px)' } : { backgroundColor: '#CBD5E1' };
  if (k !== 'fin') return { backgroundColor: nodeInfo(k).colour };
  return Platform.OS === 'web' ? { backgroundImage: 'repeating-linear-gradient(135deg, #64748B 0 4px, #CBD2DC 4px 8px)' } : { backgroundColor: '#94A3B8' };
}

/**
 * est: Finance time we could not see exactly.
 *  'end' – the Finance step (TT sent, LC transmitted …) was not recorded; Finance's work only shows when the next step happens
 *          (Procurement shares the TT / LC with the manufacturer, the manufacturer accepts the LC …). The whole gap counts as
 *          Finance, and it includes that next team's hand-on.
 *  'start' – the hand-over to Finance was not recorded; the Finance time runs from the step before it, so it includes Procurement's preparation.
 */
export type NodeLine = { node: NodeKey; owner: string; label: string; start: string | null; end: string | null; days: number | null; sla: number | null; late: boolean; open: boolean; est?: 'end' | 'start'; via?: string };
export type NodeItem = {
  key: string;
  kind: 'import' | 'local';
  cat: string;
  code: string;
  title: string;
  project: string;
  open: boolean;
  href: string;
  lines: NodeLine[];
};

type RouteLine = { def: { key: string; after: string[]; node: string; label: string; sla_days: number | null; optional?: boolean }; done: { done_on: string } | null; ready: boolean; start: string | null; days: number | null; late: boolean };
const toLine = (l: RouteLine): NodeLine | null => {
  if (!l.done && !(l.ready && !l.def.optional)) return null;
  return { node: nodeOf(l.def.node), owner: l.def.node, label: l.def.label, start: l.start, end: l.done?.done_on ?? null, days: l.days, sla: l.def.sla_days, late: l.late, open: !l.done };
};
/** The optional steps not recorded that a step jumps over (it is then timed from the steps before them) */
function skipped(l: RouteLine, by: Map<string, RouteLine>) {
  const out: RouteLine[] = [];
  const seen = new Set<string>();
  const todo = [...l.def.after];
  while (todo.length) {
    const k = todo.shift()!;
    if (seen.has(k)) continue;
    seen.add(k);
    const a = by.get(k);
    if (!a || a.done || !a.def.optional) continue;
    out.push(a);
    todo.push(...a.def.after);
  }
  return out;
}
function lines(ls: RouteLine[]) {
  const by = new Map(ls.map((l) => [l.def.key, l]));
  const out: NodeLine[] = [];
  for (const l of ls) {
    const x = toLine(l);
    if (!x) continue;
    const sk = skipped(l, by);
    const fin = sk.filter((a) => nodeOf(a.def.node) === 'fin');
    if (fin.length && x.node !== 'fin') {
      const sla = fin[0].def.sla_days != null && l.def.sla_days != null ? fin[0].def.sla_days + l.def.sla_days : null;
      Object.assign(x, { node: 'fin', est: 'end', via: fin.map((a) => a.def.label).join(', '), sla, late: sla != null && (x.days ?? 0) > sla });
    } else if (x.node === 'fin' && sk.length) Object.assign(x, { est: 'start', via: sk.map((a) => a.def.label).join(', ') });
    out.push(x);
  }
  return out;
}

/** One item per import order (or import request still without orders) */
export function foreignItems(hos: Handover[], orders: FoOrder[], steps: Step[], defs: StepDef[], holidays: Set<string>): NodeItem[] {
  const out: NodeItem[] = [];
  for (const h of hos) {
    if (h.status === 'cancelled') continue;
    const os = orders.filter((o) => o.handover_id === h.id && o.status !== 'cancelled');
    const hs = steps.filter((s) => s.handover_id === h.id);
    if (!os.length) {
      out.push({ key: 'h' + h.id, kind: 'import', cat: 'Import – material', code: h.code ?? 'Import request', title: 'Import request – no order yet', project: h.project_name, open: h.status === 'open', href: `/orders/foreign/ho/${h.id}`, lines: lines(route(defs, h, null, hs, os, holidays)) });
      continue;
    }
    for (const o of os)
      out.push({ key: 'o' + o.id, kind: 'import', cat: o.kind === 'service' ? 'Import – service' : 'Import – material', code: o.code ?? 'Import order', title: o.title, project: h.project_name, open: o.status === 'open', href: `/orders/foreign/${o.id}`, lines: lines(route(defs, h, o, hs, os, holidays)) });
  }
  return out;
}

/** One item per local supplier order (or local request still without orders) */
export function localItems(reqs: LoRequest[], orders: LoOrder[], steps: LoStep[], defs: LoStepDef[], prv: Record<string, number | null>, ov: Record<string, number | null>, holidays: Set<string>): NodeItem[] {
  const out: NodeItem[] = [];
  for (const r of reqs) {
    if (r.status === 'cancelled') continue;
    const os = orders.filter((o) => o.request_id === r.id && o.status !== 'cancelled');
    const rs = steps.filter((s) => s.request_id === r.id);
    if (!os.length) {
      out.push({ key: 'r' + r.id, kind: 'local', cat: r.kind === 'service' ? 'Local – service' : 'Local – material', code: r.code ?? 'Request', title: r.title, project: r.project_name, open: r.status === 'open', href: `/orders/local/r/${r.id}`, lines: lines(loRoute(defs, prv[r.id] ?? null, null, null, rs, holidays)) });
      continue;
    }
    for (const o of os)
      out.push({ key: 'o' + o.id, kind: 'local', cat: o.kind === 'service' ? 'Local – service' : 'Local – material', code: o.code ?? 'Order', title: o.title, project: r.project_name, open: o.status === 'open', href: `/orders/local/${o.id}`, lines: lines(loRoute(defs, prv[r.id] ?? null, o, ov[o.id] ?? null, rs, holidays)) });
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0);
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const CATS = ['Import – material', 'Import – service', 'Local – material', 'Local – service'];
export const FIN_BINS: [string, number, number][] = [['0–2', 0, 2], ['3–5', 3, 5], ['6–8', 6, 8], ['9–10', 9, 10], ['11–15', 11, 15], ['16–20', 16, 20], ['20+', 21, Infinity]];

/** Everything the node report shows, for the items and a period (done steps from `from`) */
export function nodeReport(items: NodeItem[], from: string, today: string) {
  const doneIn = (l: NodeLine) => !l.open && l.end != null && l.end >= from && l.days != null;
  const perItem = items.map((it) => {
    const sums = new Map<NodeKey, number>();
    for (const l of it.lines) if (doneIn(l)) sums.set(l.node, (sums.get(l.node) ?? 0) + (l.days ?? 0));
    const xs = new Map<NodeKey | 'finx', number>();
    for (const l of it.lines) if (doneIn(l)) { const k = l.est ? 'finx' : l.node; xs.set(k, (xs.get(k) ?? 0) + (l.days ?? 0)); }
    return { it, sums, xs };
  });
  const nodes = NODES.map((n) => {
    const waiting = items.filter((it) => it.open).map((it) => ({ it, ls: it.lines.filter((l) => l.open && l.node === n.key) })).filter((x) => x.ls.length);
    const passes = perItem.filter((p) => p.sums.has(n.key)).map((p) => p.sums.get(n.key)!);
    const timed = items.flatMap((it) => it.lines.filter((l) => doneIn(l) && l.node === n.key));
    const withSla = timed.filter((l) => l.sla != null);
    return {
      ...n,
      holding: waiting.length,
      oldest: Math.max(0, ...waiting.flatMap((w) => w.ls.map((l) => l.days ?? 0))),
      avg: avg(passes),
      orders: passes.length,
      onTime: withSla.length ? withSla.filter((l) => (l.days ?? 0) <= l.sla!).length / withSla.length : null,
      est: timed.filter((l) => l.est).length,
      passesN: timed.length,
    };
  });
  const bars = CATS.map((cat) => {
    const ps = perItem.filter((p) => p.it.cat === cat && p.sums.size);
    const keys: (NodeKey | 'finx')[] = ['lt', 'dir', 'fbp', 'pro', 'fin', 'finx', 'log', 'ext'];
    const parts = keys.map((k) => ({ node: k, days: ps.length ? ps.reduce((t, p) => t + (p.xs.get(k) ?? 0), 0) / ps.length : 0 }));
    return { cat, orders: ps.length, parts, total: parts.reduce((t, p) => t + p.days, 0) };
  });
  const fin = items.flatMap((it) => it.lines.filter((l) => doneIn(l) && l.node === 'fin').map((l) => ({ l, it })));
  const finDays = fin.map((f) => f.l.days ?? 0);
  const finName = (l: NodeLine) => (l.est === 'end' ? `${l.via} – not seen, ended at “${l.label}”` : l.est === 'start' ? `${l.label} – hand-over to Finance not seen` : l.label);
  const finSteps = [...new Set(fin.map((f) => finName(f.l)))].map((label) => { const ds = fin.filter((f) => finName(f.l) === label).map((f) => f.l.days ?? 0); return { label, n: ds.length, median: median(ds), est: fin.some((f) => finName(f.l) === label && !!f.l.est) }; });
  const exact = fin.filter((f) => !f.l.est).map((f) => f.l.days ?? 0), guess = fin.filter((f) => f.l.est).map((f) => f.l.days ?? 0);
  const finance = {
    passes: fin.length,
    median: median(finDays),
    over: fin.filter((f) => f.l.sla != null && (f.l.days ?? 0) > f.l.sla).length,
    exact: { n: exact.length, median: median(exact) },
    guess: { n: guess.length, median: median(guess) },
    bins: FIN_BINS.map(([label, a, b]) => ({ label, n: exact.filter((d) => d >= a && d <= b).length, m: guess.filter((d) => d >= a && d <= b).length })),
    steps: finSteps,
    open: items.filter((it) => it.open && it.lines.some((l) => l.open && l.node === 'fin')).length,
  };
  const waiting = items
    .filter((it) => it.open)
    .flatMap((it) => it.lines.filter((l) => l.open).map((l) => {
      const last = it.lines.filter((x) => !x.open && x.end).sort((a, b) => (a.end! < b.end! ? 1 : -1))[0];
      return { it, l, last };
    }))
    .sort((a, b) => Number(b.l.late) - Number(a.l.late) || (b.l.days ?? 0) - (a.l.days ?? 0));
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const trend = NODES.map((n) => {
    const vals = months.map((m) => { const ds = items.flatMap((it) => it.lines.filter((l) => !l.open && l.node === n.key && l.end?.startsWith(m)).map((l) => l.days ?? 0)); return ds.length ? avg(ds) : null; });
    return { ...n, vals };
  });
  return { nodes, bars, finance, waiting, months, trend };
}
