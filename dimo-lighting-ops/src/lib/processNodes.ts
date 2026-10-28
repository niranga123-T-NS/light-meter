import { workdays } from '@/lib/foreignOrders';

/**
 * Node reports for Sales, Estimation and Design: each inquiry or job is cut into time slices from its status history, each slice
 * belongs to a node (a team, or a hidden party such as the client or a supplier). Hidden slices come from clarifications and
 * supplier quotes: we see the question or request go out and the answer come back, not the work in between.
 */
export type PNode = { key: string; name: string; colour: string; who: string; hidden?: boolean; work?: boolean };
export type Seg = { node: string; start: string; end: string | null; days: number; label: string; est?: 'start' | 'end' };
export type PItem = {
  key: string;
  code: string;
  title: string;
  project: string;
  cat: string;
  person: string | null;
  open: boolean;
  href: string;
  segs: Seg[];
  due: string | null;
  done: string | null;
  returned: number;
};
export type Hist = { entity_id: string; from_status: string | null; to_status: string; at: string };

/** Sri Lanka calendar day of a timestamp */
export const slDay = (ts: string) => new Date(new Date(ts).getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
export const wd = (a: string, b: string | null, holidays: Set<string>, now: string) => workdays(slDay(a), slDay(b ?? now), holidays) ?? 0;

/**
 * Slices from a status history. map: status → node (null = finished, the item leaves the report).
 * created: when the item started (first slice starts here if the history begins later). first: the status it was created in.
 */
export function fromHistory(hist: Hist[], first: string, created: string, map: (s: string, next?: string) => { node: string; label: string; est?: 'start' | 'end' } | null, holidays: Set<string>, now: string): Seg[] {
  const hs = [...hist].sort((a, b) => (a.at < b.at ? -1 : 1));
  const points: { status: string; at: string }[] = [{ status: hs[0]?.from_status ?? first, at: created }];
  for (const h of hs) points.push({ status: h.to_status, at: h.at < created ? created : h.at });
  const segs: Seg[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], next = points[i + 1];
    const m = map(p.status, next?.status);
    if (!m) continue;
    const end = next ? next.at : null;
    if (end && end <= p.at) continue;
    segs.push({ node: m.node, label: m.label, start: p.at, end, days: wd(p.at, end, holidays, now), est: m.est });
  }
  return segs;
}

/**
 * Moves the time of a hidden interval (a clarification, a supplier quote) out of the slices of the nodes that were waiting
 * (`from`, usually the person's own work) into the hidden node. Overlaps are cut, never counted twice.
 */
export function carve(segs: Seg[], iv: { start: string; end: string | null; node: string; label: string; est?: 'start' | 'end' }, from: string[], holidays: Set<string>, now: string): Seg[] {
  const out: Seg[] = [];
  const ivEnd = iv.end ?? '9999';
  for (const s of segs) {
    const sEnd = s.end ?? '9999';
    if (!from.includes(s.node) || sEnd <= iv.start || ivEnd <= s.start) { out.push(s); continue; }
    const a = s.start < iv.start ? iv.start : s.start;
    const b = sEnd < ivEnd ? sEnd : ivEnd;
    const mk = (start: string, end: string, node: string, label: string, est?: 'start' | 'end'): Seg => {
      const e = end === '9999' ? null : end;
      return { node, label, start, end: e, days: wd(start, e, holidays, now), est };
    };
    if (s.start < a) out.push(mk(s.start, a, s.node, s.label, s.est));
    out.push(mk(a, b, iv.node, iv.label, iv.est));
    if (b < sEnd) out.push(mk(b, sEnd, s.node, s.label, s.est));
  }
  return merge(out);
}

/** Joins back-to-back slices of the same node and reason (one wait cut across several statuses stays one wait) */
function merge(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of [...segs].sort((a, b) => (a.start < b.start ? -1 : 1))) {
    const prev = out.find((x) => x.node === s.node && x.label === s.label && x.est === s.est && x.end === s.start);
    if (prev) { prev.end = s.end; prev.days += s.days; } else out.push({ ...s });
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0);
export const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Everything a node report shows for the items in the period (slices ending from `from`) */
export function processReport(items: PItem[], nodes: PNode[], cats: string[], hiddenKey: string, bins: [string, number, number][], from: string, today: string) {
  const doneIn = (s: Seg) => s.end != null && slDay(s.end) >= from;
  const perItem = items.map((it) => {
    const sums = new Map<string, number>();
    for (const s of it.segs) if (doneIn(s)) { const k = s.est ? s.node + '~' : s.node; sums.set(k, (sums.get(k) ?? 0) + s.days); }
    return { it, sums };
  });
  const nodeSum = (p: (typeof perItem)[number], k: string) => (p.sums.get(k) ?? 0) + (p.sums.get(k + '~') ?? 0);
  const finished = items.filter((it) => it.done && slDay(it.done) >= from && it.due);
  const onTimeAll = finished.length ? finished.filter((it) => it.done! <= it.due!).length / finished.length : null;
  const cards = nodes.map((n) => {
    const waiting = items.filter((it) => it.open).map((it) => ({ it, ss: it.segs.filter((s) => s.end == null && s.node === n.key) })).filter((x) => x.ss.length);
    const passes = perItem.filter((p) => nodeSum(p, n.key) > 0 || p.it.segs.some((s) => doneIn(s) && s.node === n.key)).map((p) => nodeSum(p, n.key));
    const est = items.reduce((t, it) => t + it.segs.filter((s) => doneIn(s) && s.node === n.key && s.est).length, 0);
    return { ...n, holding: waiting.length, oldest: Math.max(0, ...waiting.flatMap((w) => w.ss.map((s) => s.days))), avg: avg(passes), items: passes.length, onTime: n.work ? onTimeAll : null, est };
  });
  const keys = nodes.flatMap((n) => (n.hidden ? [n.key, n.key + '~'] : [n.key]));
  const bars = cats.map((cat) => {
    const ps = perItem.filter((p) => p.it.cat === cat && p.sums.size);
    const parts = keys.map((k) => ({ key: k, days: ps.length ? ps.reduce((t, p) => t + (p.sums.get(k) ?? 0), 0) / ps.length : 0 }));
    return { cat, items: ps.length, parts, total: parts.reduce((t, p) => t + p.days, 0) };
  });
  const hid = items.flatMap((it) => it.segs.filter((s) => doneIn(s) && s.node === hiddenKey).map((s) => ({ s, it })));
  const exact = hid.filter((h) => !h.s.est).map((h) => h.s.days), guess = hid.filter((h) => h.s.est).map((h) => h.s.days);
  const labels = [...new Set(hid.map((h) => h.s.label))].map((label) => { const ds = hid.filter((h) => h.s.label === label).map((h) => h.s.days); return { label, n: ds.length, median: median(ds) }; }).sort((a, b) => b.n - a.n).slice(0, 6);
  const hidden = {
    passes: hid.length,
    exact: { n: exact.length, median: median(exact) },
    guess: { n: guess.length, median: median(guess) },
    bins: bins.map(([label, a, b]) => ({ label, n: exact.filter((d) => d >= a && d <= b).length, m: guess.filter((d) => d >= a && d <= b).length })),
    labels,
    open: items.filter((it) => it.open && it.segs.some((s) => s.end == null && s.node === hiddenKey)).length,
  };
  const people = [...new Set(items.map((it) => it.person ?? ''))].filter(Boolean).map((person) => {
    const ps = perItem.filter((p) => p.it.person === person && p.sums.size);
    const mine = items.filter((it) => it.person === person);
    const fin = mine.filter((it) => it.done && slDay(it.done) >= from && it.due);
    return {
      person,
      items: ps.length,
      byNode: Object.fromEntries(nodes.map((n) => [n.key, ps.length ? ps.reduce((t, p) => t + nodeSum(p, n.key), 0) / ps.length : 0])),
      returned: ps.reduce((t, p) => t + p.it.returned, 0),
      onTime: fin.length ? fin.filter((it) => it.done! <= it.due!).length / fin.length : null,
      holding: mine.filter((it) => it.open).length,
    };
  }).sort((a, b) => b.items - a.items);
  const waiting = items
    .filter((it) => it.open)
    .flatMap((it) => it.segs.filter((s) => s.end == null).map((s) => {
      const last = it.segs.filter((x) => x.end).sort((a, b) => (a.end! < b.end! ? 1 : -1))[0];
      return { it, s, last, late: !!(it.due && slDay(it.due) < today) };
    }))
    .sort((a, b) => Number(b.late) - Number(a.late) || b.s.days - a.s.days);
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const trend = nodes.map((n) => ({ ...n, vals: months.map((m) => { const ds = items.flatMap((it) => it.segs.filter((s) => s.node === n.key && s.end && slDay(s.end).startsWith(m)).map((s) => s.days)); return ds.length ? avg(ds) : null; }) }));
  return { cards, bars, hidden, people, waiting, months, trend };
}
