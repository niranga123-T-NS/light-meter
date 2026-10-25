import { PALETTE, type ChartSpec } from './charts';
import { fmtDate } from './format';
import { supabase } from './supabase';
import { atStage, cashOf, chains, discFactor, KIND_LABEL, lkr0, lkrM, normQuote, originText, quoteTotals, stageDay, STAGE_LABEL, unitLkr, type SqItem, type SqPackage, type SqQuote, type Supplier } from './supplierQuotes';

// Supplier base reports for the GM / DGM, worked out from the supplier quotes on the same basis as the comparison page
// (LKR delivered, freight, discounts and priced-back exclusions): scorecard, awards, negotiation savings, not the lowest,
// competition & gaps, price trends, terms & cash and one supplier. Every report is tiles + tables of plain values, so the
// screen, the PDF and the Excel export show the same thing.

export type Weights = { price: number; spec: number; lead: number; response: number; terms: number };
export const DEFAULT_WEIGHTS: Weights = { price: 40, spec: 20, lead: 15, response: 15, terms: 10 };
export const WEIGHT_LABEL: Record<keyof Weights, string> = { price: 'Price (how far above the lowest)', spec: 'Meets the specification', lead: 'Lead time within what the job needs', response: 'Quotes when asked', terms: 'Payment terms (credit, little advance)' };

export type ReportKey = 'scorecard' | 'awards' | 'savings' | 'exceptions' | 'competition' | 'prices' | 'terms' | 'profile';
export const REPORTS: { key: ReportKey; title: string; q: string }[] = [
  { key: 'scorecard', title: 'Supplier scorecard', q: 'Who are our best suppliers, and who only quotes high, late or off-spec?' },
  { key: 'awards', title: 'Awards & concentration', q: 'Where does the money go, and do we depend too much on a few suppliers?' },
  { key: 'savings', title: 'Negotiation savings', q: 'How much did we save from the first offer to Pre Bid to the final price?' },
  { key: 'exceptions', title: 'Not the lowest', q: 'Where did we choose a supplier who was not the lowest, why, and what did it cost?' },
  { key: 'competition', title: 'Competition & gaps', q: 'Which trades have too few suppliers, and which packages went without competition?' },
  { key: 'prices', title: 'Price trends', q: 'Is a material getting cheaper or dearer, and who is out of line with the market?' },
  { key: 'terms', title: 'Terms & cash', q: 'How much cash do suppliers ask before delivery, and what does it cost us?' },
  { key: 'profile', title: 'One supplier', q: 'Everything about one supplier on one page, for a supplier meeting.' },
];

export type Who = 'all' | 'supply' | 'manufacturer' | 'subcontract' | 'local' | 'foreign';
export type Prices = 'final' | 'pre_bid' | 'post_bid';
export type RFilters = { from: string; to: string; type: 'all' | 'supply' | 'subcontract'; who: Who; prices: Prices; item?: string; supplier?: string };
export const WHO_LABEL: Record<Who, string> = { all: 'All suppliers', supply: 'Local and foreign suppliers', manufacturer: 'Manufacturers', subcontract: 'Subcontractors', local: 'Local only', foreign: 'Foreign only' };
export const PRICES_LABEL: Record<Prices, string> = { final: 'Final prices (each package\'s current stage)', pre_bid: 'Pre Bid prices', post_bid: 'Post Bid prices' };

export type Tone = 'good' | 'warn' | 'bad';
export type RCell = { t: string; sub?: string; tone?: Tone };
export type RTable = { title?: string; head: { h: string; w: number; grow?: boolean; right?: boolean }[]; rows: { key: string; cells: RCell[]; href?: string }[]; empty: string };
export type RTile = { label: string; value: string; tone?: 'green' | 'amber' | 'red'; sub?: string };
export type Report = { tiles: RTile[]; tables: RTable[]; chart?: ChartSpec; note?: string };

type Invite = { package_id: string; supplier_id: string; asked_at: string };
export type ReportData = { pkgs: SqPackage[]; quotes: SqQuote[]; sups: Supplier[]; items: SqItem[]; invites: Invite[]; costPct: number; weights: Weights; people: Record<string, string> };

export async function loadReportData(): Promise<ReportData> {
  const [p, q, s, i, inv, st, pe] = await Promise.all([
    supabase.from('sq_packages').select('*').limit(5000),
    supabase.from('sq_quotes').select('*, lines:sq_quote_lines(*), payments:sq_quote_payments(*), exclusions:sq_quote_exclusions(*)').order('created_at').limit(10000),
    supabase.from('sq_suppliers').select('*').order('name'),
    supabase.from('sq_items').select('*').order('code'),
    supabase.from('sq_package_invites').select('package_id, supplier_id, asked_at').limit(20000),
    supabase.from('sq_settings').select('cost_of_money_pct, score_weights').maybeSingle(),
    supabase.from('profiles').select('id, full_name'),
  ]);
  const err = p.error ?? q.error ?? s.error ?? i.error ?? inv.error;
  if (err) throw new Error(err.message);
  const w = (st.data?.score_weights ?? {}) as Partial<Weights>;
  return {
    pkgs: (p.data ?? []) as SqPackage[], quotes: ((q.data ?? []) as SqQuote[]).map(normQuote), sups: (s.data ?? []) as Supplier[], items: (i.data ?? []) as SqItem[],
    invites: (inv.data ?? []) as Invite[], costPct: Number(st.data?.cost_of_money_pct ?? 12),
    weights: { price: Number(w.price ?? DEFAULT_WEIGHTS.price), spec: Number(w.spec ?? DEFAULT_WEIGHTS.spec), lead: Number(w.lead ?? DEFAULT_WEIGHTS.lead), response: Number(w.response ?? DEFAULT_WEIGHTS.response), terms: Number(w.terms ?? DEFAULT_WEIGHTS.terms) },
    people: Object.fromEntries(((pe.data ?? []) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name])),
  };
}

// ---------------------------------------------------------------- helpers
const clamp = (v: number) => Math.max(0, Math.min(100, v));
const pct = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)} %`);
const sgn = (v: number, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)} %`;
const M = (v: number | null | undefined) => (v == null ? '—' : lkrM(v));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const day = (s: string | null | undefined) => (s ?? '').slice(0, 10);
const gradeOf = (s: number | null) => (s == null ? '—' : s >= 85 ? 'A' : s >= 72 ? 'B' : s >= 58 ? 'C' : 'D');
const gradeTone = (g: string): Tone | undefined => (g === 'A' ? 'good' : g === 'C' ? 'warn' : g === 'D' ? 'bad' : undefined);
/** Share of the money paid before delivery, and the average days after delivery the money goes out (advances count as 0) */
export function termsOf(q: SqQuote) {
  if (!q.payments.length) return null;
  let adv = 0, days = 0;
  for (const p of q.payments) {
    const d = stageDay(p, q.lead_weeks);
    if (d < 0) adv += p.pct;
    else days += (p.pct * d) / 100;
  }
  return { adv, days };
}
const termsScore = (adv: number, days: number) => clamp((days / 60) * 100 - adv * 0.6 + 40);

export const filterText = (d: ReportData, f: RFilters) =>
  [`${fmtDate(f.from)} – ${fmtDate(f.to)}`, f.type === 'all' ? 'Supply and subcontract' : f.type === 'supply' ? 'Supply' : 'Subcontract', WHO_LABEL[f.who], PRICES_LABEL[f.prices]].join(' · ');

// ---------------------------------------------------------------- the packages and quotes in the filters
function context(d: ReportData, f: RFilters) {
  const sup = new Map(d.sups.map((s) => [s.id, s]));
  const name = (id: string | null | undefined) => sup.get(id ?? '')?.name ?? '—';
  const whoOk = (id: string) => {
    const s = sup.get(id);
    if (!s || f.who === 'all') return !!s;
    if (f.who === 'local') return s.origin !== 'foreign';
    if (f.who === 'foreign') return s.origin === 'foreign';
    if (f.who === 'supply') return s.kind === 'supply' || s.kind === 'both';
    if (f.who === 'subcontract') return s.kind === 'subcontract' || s.kind === 'both';
    return s.kind === f.who;
  };
  const pkgs = d.pkgs.filter((p) => p.status !== 'cancelled' && (f.type === 'all' || p.kind === f.type) && day(p.created_at) >= f.from && day(p.created_at) <= f.to);
  const tot = new Map<string, number>();
  const total = (q: SqQuote) => { let t = tot.get(q.id); if (t == null) { t = quoteTotals(q).total; tot.set(q.id, t); } return t; };
  const byPkg = new Map<string, SqQuote[]>();
  for (const q of d.quotes) byPkg.set(q.package_id, [...(byPkg.get(q.package_id) ?? []), q]);
  // the quotes compared on each package: each supplier's latest version at the stage asked for
  const sets = new Map<string, SqQuote[]>();
  for (const p of pkgs) {
    const all = byPkg.get(p.id) ?? [];
    sets.set(p.id, atStage(all, f.prices === 'final' ? (p.stage ?? 'pre_bid') : f.prices));
  }
  const quoteById = new Map(d.quotes.map((q) => [q.id, q]));
  const chosen = pkgs.filter((p) => p.selected_quote_id && quoteById.get(p.selected_quote_id)).map((p) => ({ p, q: quoteById.get(p.selected_quote_id!)!, t: total(quoteById.get(p.selected_quote_id!)!) }));
  return { sup, name, whoOk, pkgs, total, byPkg, sets, chosen, quoteById };
}
type Ctx = ReturnType<typeof context>;

// ---------------------------------------------------------------- 1. scorecard
export type ScoreRow = { s: Supplier; asked: number; quoted: number; resp: number | null; won: number; low: number; compared: number; gap: number | null; drop: number | null; spec: number | null; lead: number | null; adv: number | null; days: number | null; value: number; score: number | null; grade: string; parts: Partial<Record<keyof Weights, number | null>> };
export function scoreRows(d: ReportData, c: Ctx): ScoreRow[] {
  const ids = new Set(c.pkgs.map((p) => p.id));
  const out: ScoreRow[] = [];
  for (const s of d.sups) {
    if (!c.whoOk(s.id)) continue;
    const asked = new Set(d.invites.filter((x) => x.supplier_id === s.id && ids.has(x.package_id)).map((x) => x.package_id));
    const quotedPk = new Set(d.quotes.filter((q) => q.supplier_id === s.id && ids.has(q.package_id)).map((q) => q.package_id));
    quotedPk.forEach((p) => asked.add(p));
    if (!asked.size) continue;
    const gaps: number[] = [], specs: number[] = [], leads: number[] = [], advs: number[] = [], dayss: number[] = [], drops: number[] = [];
    let low = 0, compared = 0;
    for (const p of c.pkgs) {
      const set = c.sets.get(p.id) ?? [];
      const mine = set.find((q) => q.supplier_id === s.id);
      if (!mine) continue;
      if (set.length > 1) {
        const lo = Math.min(...set.map(c.total)), t = c.total(mine);
        compared++;
        if (t <= lo + 0.5) low++;
        gaps.push(lo ? ((t - lo) / lo) * 100 : 0);
      }
      if (mine.meets_spec !== 'unknown') specs.push(mine.meets_spec === 'yes' ? 100 : 0);
      if (p.needed_weeks && mine.lead_weeks != null) leads.push(mine.lead_weeks <= p.needed_weeks ? 100 : 0);
      const tm = termsOf(mine);
      if (tm) { advs.push(tm.adv); dayss.push(tm.days); }
      const ch = chains(c.byPkg.get(p.id) ?? []).find((x) => x.some((y) => y.id === mine.id));
      if (ch && ch.length > 1 && c.total(ch[0])) drops.push(((c.total(mine) - c.total(ch[0])) / c.total(ch[0])) * 100);
    }
    const won = c.chosen.filter((x) => x.q.supplier_id === s.id);
    const gap = avg(gaps), spec = avg(specs), lead = avg(leads), adv = avg(advs), days = avg(dayss);
    const resp = (quotedPk.size / asked.size) * 100;
    const parts = { price: gap == null ? null : clamp(100 - gap * 7), spec, lead, response: resp, terms: adv == null || days == null ? null : termsScore(adv, days) };
    let num = 0, den = 0;
    (Object.keys(d.weights) as (keyof Weights)[]).forEach((k) => { const v = parts[k]; if (v != null && d.weights[k] > 0) { num += v * d.weights[k]; den += d.weights[k]; } });
    // no score until the price has been compared with another quote – one bidder's specification alone says little
    const score = den && parts.price != null ? Math.round(num / den) : null;
    out.push({ s, asked: asked.size, quoted: quotedPk.size, resp, won: won.length, low, compared, gap, drop: avg(drops), spec, lead, adv, days, value: won.reduce((a, x) => a + x.t, 0), score, grade: gradeOf(score), parts });
  }
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.value - a.value);
}
const toneHi = (v: number | null, good: number, warn: number): Tone | undefined => (v == null ? undefined : v >= good ? 'good' : v >= warn ? 'warn' : 'bad');

function scorecard(d: ReportData, c: Ctx): Report {
  const rows = scoreRows(d, c);
  const w = d.weights;
  return {
    tiles: [
      { label: 'Suppliers who were asked or quoted', value: String(rows.length) },
      { label: 'Grade A – first to ask', value: String(rows.filter((r) => r.grade === 'A').length), tone: 'green' },
      { label: 'Grade D – review or drop', value: String(rows.filter((r) => r.grade === 'D').length), tone: 'red' },
      { label: 'Quoted when asked (average)', value: pct(avg(rows.map((r) => r.resp ?? 0))) },
    ],
    tables: [{
      empty: 'No supplier was asked or quoted in this period.',
      head: [{ h: 'Supplier', w: 220, grow: true }, { h: 'Score', w: 80, right: true }, { h: 'Quoted / asked', w: 100, right: true }, { h: 'Chosen', w: 90, right: true }, { h: 'Lowest', w: 80, right: true }, { h: 'Above lowest', w: 100, right: true }, { h: 'Came down', w: 90, right: true }, { h: 'Meets spec', w: 90, right: true }, { h: 'Lead time OK', w: 100, right: true }, { h: 'Advance · days to pay', w: 130, right: true }],
      rows: rows.map((r) => ({
        key: r.s.id,
        cells: [
          { t: r.s.name, sub: `${KIND_LABEL[r.s.kind]} · ${originText(r.s)}${r.s.trades ? ` · ${r.s.trades}` : ''}` },
          { t: r.score == null ? '—' : `${r.grade} ${r.score}`, tone: gradeTone(r.grade) },
          { t: `${r.quoted} / ${r.asked}`, sub: pct(r.resp) },
          { t: String(r.won), sub: r.value ? M(r.value) : undefined },
          { t: r.compared ? `${r.low} of ${r.compared}` : '—' },
          { t: r.gap == null ? '—' : sgn(r.gap), tone: r.gap == null ? undefined : r.gap <= 3 ? 'good' : r.gap <= 6 ? 'warn' : 'bad' },
          { t: r.drop == null ? '—' : sgn(r.drop) },
          { t: pct(r.spec), tone: toneHi(r.spec, 95, 80) },
          { t: pct(r.lead), tone: toneHi(r.lead, 90, 70) },
          { t: r.adv == null ? '—' : `${r.adv.toFixed(0)} % · ${r.days!.toFixed(0)} d` },
        ],
      })),
    }],
    note: `Score out of 100 with the GM / DGM's weights: price ${w.price}, specification ${w.spec}, lead time ${w.lead}, quoting when asked ${w.response}, terms ${w.terms}. Price: every 1 % above the lowest comparable total on average takes 7 points off. Terms: credit after delivery adds, money before delivery takes off. A part with no data (e.g. no lead time needed) is left out and the others are weighted up; a supplier never compared with another quote gets no score yet. A 85+, B 72+, C 58+, D below.`,
  };
}

// ---------------------------------------------------------------- 2. awards & concentration
function awards(d: ReportData, c: Ctx): Report {
  const ch = c.chosen.filter((x) => c.whoOk(x.q.supplier_id));
  const by = new Map<string, { v: number; n: number }>();
  for (const x of ch) { const o = by.get(x.q.supplier_id) ?? { v: 0, n: 0 }; by.set(x.q.supplier_id, { v: o.v + x.t, n: o.n + 1 }); }
  const rows = [...by.entries()].map(([id, o]) => ({ s: c.sup.get(id)!, ...o })).sort((a, b) => b.v - a.v);
  const total = rows.reduce((a, r) => a + r.v, 0);
  const top3 = rows.slice(0, 3).reduce((a, r) => a + r.v, 0);
  const group = (key: (s: Supplier) => string) => { const m = new Map<string, number>(); rows.forEach((r) => m.set(key(r.s), (m.get(key(r.s)) ?? 0) + r.v)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const kinds = group((s) => KIND_LABEL[s.kind]), origins = group((s) => (s.origin === 'foreign' ? 'Foreign' : 'Local'));
  return {
    tiles: [
      { label: `Chosen value, ${ch.length} package(s)`, value: `LKR ${M(total)}` },
      { label: 'Share of the top 3 suppliers', value: total ? pct((top3 / total) * 100) : '—', tone: total && top3 / total > 0.6 ? 'amber' : undefined },
      { label: rows[0] ? `Largest: ${rows[0].s.name}` : 'Largest supplier', value: rows[0] && total ? pct((rows[0].v / total) * 100) : '—' },
      { label: 'Foreign share', value: total ? pct(((origins.find((o) => o[0] === 'Foreign')?.[1] ?? 0) / total) * 100) : '—' },
    ],
    tables: [
      { empty: 'No supplier chosen in this period.', head: [{ h: 'Supplier', w: 240, grow: true }, { h: 'Packages', w: 90, right: true }, { h: 'Chosen value (LKR)', w: 150, right: true }, { h: 'Share', w: 90, right: true }],
        rows: rows.map((r) => ({ key: r.s.id, cells: [{ t: r.s.name, sub: `${KIND_LABEL[r.s.kind]} · ${originText(r.s)}` }, { t: String(r.n) }, { t: M(r.v) }, { t: total ? pct((r.v / total) * 100, 1) : '—', tone: total && r.v / total > 0.35 ? 'warn' : undefined }] })) },
      { title: 'By type and origin', empty: '—', head: [{ h: 'Group', w: 240, grow: true }, { h: 'Chosen value (LKR)', w: 150, right: true }, { h: 'Share', w: 90, right: true }],
        rows: [...kinds, ...origins].map(([k, v], i) => ({ key: `${i}`, cells: [{ t: k }, { t: M(v) }, { t: total ? pct((v / total) * 100, 1) : '—' }] })) },
    ],
    note: 'Value is the chosen quote\'s comparable total (LKR delivered, discounts and priced-back exclusions) for packages created in the period.',
  };
}

// ---------------------------------------------------------------- 3. negotiation savings
function savings(d: ReportData, c: Ctx): Report {
  const rows = c.chosen.filter((x) => c.whoOk(x.q.supplier_id)).map((x) => {
    const ch = chains(c.byPkg.get(x.p.id) ?? []).find((k) => k.some((y) => y.id === x.q.id)) ?? [x.q];
    const upto = ch.filter((y) => y.revision <= x.q.revision);
    const pre = [...upto].reverse().find((y) => (y.bid_stage ?? 'pre_bid') === 'pre_bid');
    return { p: x.p, q: x.q, first: c.total(upto[0]), pre: pre ? c.total(pre) : null, fin: x.t, n: upto.length };
  });
  const f = rows.reduce((a, r) => a + r.first, 0), fin = rows.reduce((a, r) => a + r.fin, 0);
  const post = rows.filter((r) => r.p.stage === 'post_bid' && r.pre != null);
  const preSum = post.reduce((a, r) => a + (r.pre ?? 0), 0), postSum = post.reduce((a, r) => a + r.fin, 0);
  return {
    tiles: [
      { label: 'Saved from the first offers', value: `LKR ${M(f - fin)}`, tone: f - fin > 0 ? 'green' : undefined },
      { label: 'First offer → final', value: f ? sgn(((fin - f) / f) * 100) : '—' },
      { label: 'Saved after the tender (Pre Bid → Post Bid)', value: `LKR ${M(preSum - postSum)}`, tone: preSum - postSum > 0 ? 'green' : undefined },
      { label: 'Pre Bid → Post Bid', value: preSum ? sgn(((postSum - preSum) / preSum) * 100) : '—' },
    ],
    tables: [{
      empty: 'No supplier chosen in this period.',
      head: [{ h: 'Package', w: 240, grow: true }, { h: 'Chosen', w: 170 }, { h: 'First offer', w: 110, right: true }, { h: 'Pre Bid', w: 110, right: true }, { h: 'Final', w: 110, right: true }, { h: 'Saved', w: 110, right: true }],
      rows: rows.sort((a, b) => b.first - b.fin - (a.first - a.fin)).map((r) => ({
        key: r.p.id, href: `/supplier-quotes/${r.p.id}`,
        cells: [{ t: r.p.title, sub: `${r.p.code} · ${STAGE_LABEL[r.p.stage ?? 'pre_bid']} · ${r.n} version(s)` }, { t: c.name(r.q.supplier_id) }, { t: M(r.first) }, { t: M(r.pre) }, { t: M(r.fin) },
          { t: M(r.first - r.fin), sub: r.first ? sgn(((r.fin - r.first) / r.first) * 100) : undefined, tone: r.first - r.fin > 0 ? 'good' : undefined }],
      })),
    }],
    note: 'First offer is the chosen supplier\'s first version on the package; Pre Bid is its last Pre Bid version; final is the chosen version.',
  };
}

// ---------------------------------------------------------------- 4. not the lowest
function exceptions(d: ReportData, c: Ctx): Report {
  const rows = c.chosen.filter((x) => c.whoOk(x.q.supplier_id)).map((x) => {
    const set = atStage(c.byPkg.get(x.p.id) ?? [], x.q.bid_stage ?? 'pre_bid');
    const lo = set.length > 1 ? set.reduce((a, b) => (c.total(b) < c.total(a) ? b : a)) : null;
    return { ...x, lo, prem: lo ? x.t - c.total(lo) : 0 };
  }).filter((r) => r.lo && r.prem > 0.5).sort((a, b) => b.prem - a.prem);
  const prem = rows.reduce((a, r) => a + r.prem, 0);
  return {
    tiles: [
      { label: `Packages, of ${c.chosen.length} chosen`, value: String(rows.length) },
      { label: 'Paid above the lowest', value: `LKR ${M(prem)}`, tone: prem ? 'amber' : undefined },
      { label: 'Share of the chosen value', value: c.chosen.length ? pct((prem / Math.max(1, c.chosen.reduce((a, x) => a + x.t, 0))) * 100, 1) : '—' },
    ],
    tables: [{
      empty: 'Every package went to the lowest comparable total.',
      head: [{ h: 'Package', w: 220, grow: true }, { h: 'Chosen · lowest', w: 200 }, { h: 'Paid above', w: 110, right: true }, { h: 'Reason given', w: 280, grow: true }, { h: 'Chosen by', w: 150 }],
      rows: rows.map((r) => ({
        key: r.p.id, href: `/supplier-quotes/${r.p.id}`,
        cells: [{ t: r.p.title, sub: r.p.code }, { t: c.name(r.q.supplier_id), sub: `lowest: ${c.name(r.lo!.supplier_id)} ${M(c.total(r.lo!))}` }, { t: M(r.prem), sub: sgn((r.prem / c.total(r.lo!)) * 100), tone: 'warn' },
          { t: r.p.selection_reason ?? '—' }, { t: d.people[r.p.selected_by ?? ''] ?? '—', sub: r.p.selected_at ? fmtDate(r.p.selected_at) : undefined }],
      })),
    }],
  };
}

// ---------------------------------------------------------------- 5. competition & gaps
function competition(d: ReportData, c: Ctx): Report {
  const pk = c.pkgs.map((p) => ({ p, n: new Set((c.byPkg.get(p.id) ?? []).map((q) => q.supplier_id)).size, asked: d.invites.filter((x) => x.package_id === p.id).length }));
  const single = pk.filter((x) => x.n === 1);
  const trades = new Map<string, { sups: Set<string>; label: string }>();
  for (const s of d.sups.filter((x) => x.active && c.whoOk(x.id))) for (const t of (s.trades ?? '').split(/[,;/]| and /)) {
    const k = t.trim().toLowerCase();
    if (!k) continue;
    const o = trades.get(k) ?? { sups: new Set<string>(), label: t.trim() };
    o.sups.add(s.id); trades.set(k, o);
  }
  const since = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
  const last = new Map<string, string>();
  d.quotes.forEach((q) => { const dt = day(q.quote_date ?? q.created_at); if ((last.get(q.supplier_id) ?? '') < dt) last.set(q.supplier_id, dt); });
  const dormant = d.sups.filter((s) => s.active && c.whoOk(s.id) && (last.get(s.id) ?? '') < since);
  const tr = [...trades.values()].sort((a, b) => a.sups.size - b.sups.size || a.label.localeCompare(b.label));
  return {
    tiles: [
      { label: 'Quotes per package on average', value: pk.length ? (avg(pk.map((x) => x.n)) ?? 0).toFixed(1) : '—' },
      { label: 'Packages with a single quote', value: String(single.length), tone: single.length ? 'red' : 'green' },
      { label: 'Trades with only one supplier', value: String(tr.filter((t) => t.sups.size === 1).length), tone: tr.some((t) => t.sups.size === 1) ? 'amber' : undefined },
      { label: 'Suppliers not quoting for 6 months', value: String(dormant.length) },
    ],
    tables: [
      { title: 'Packages without competition (one supplier quoted)', empty: 'Every package had two or more quotes.', head: [{ h: 'Package', w: 260, grow: true }, { h: 'Supplier', w: 200 }, { h: 'Asked', w: 80, right: true }, { h: 'Created', w: 110 }],
        rows: single.map((x) => ({ key: x.p.id, href: `/supplier-quotes/${x.p.id}`, cells: [{ t: x.p.title, sub: [x.p.code, x.p.project_name].filter(Boolean).join(' · ') }, { t: c.name((c.byPkg.get(x.p.id) ?? [])[0]?.supplier_id) }, { t: String(x.asked), tone: x.asked <= 1 ? 'bad' : undefined }, { t: fmtDate(x.p.created_at) }] })) },
      { title: 'Suppliers per trade ("What they supply" in the supplier list)', empty: 'Fill in "What they supply" for the suppliers to see the trades.', head: [{ h: 'Trade', w: 240, grow: true }, { h: 'Active suppliers', w: 120, right: true }, { h: 'Who', w: 300, grow: true }],
        rows: tr.map((t) => ({ key: t.label, cells: [{ t: t.label }, { t: String(t.sups.size), tone: t.sups.size >= 3 ? 'good' : t.sups.size === 2 ? 'warn' : 'bad' }, { t: [...t.sups].map((id) => c.name(id)).join(', ') }] })) },
      { title: 'Not quoting for 6 months', empty: 'Every active supplier quoted in the last 6 months.', head: [{ h: 'Supplier', w: 240, grow: true }, { h: 'Last quote', w: 120 }],
        rows: dormant.map((s) => ({ key: s.id, cells: [{ t: s.name, sub: `${KIND_LABEL[s.kind]} · ${originText(s)}` }, { t: last.get(s.id) ? fmtDate(last.get(s.id)) : 'never' }] })) },
    ],
  };
}

// ---------------------------------------------------------------- 6. price trends
export function monthsOf(from: string, to: string) {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7));
  while ((y < ey || (y === ey && m <= em)) && out.length < 36) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out.slice(-24);
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monLabel = (k: string) => `${MON[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
/** Each supplier's latest price of an item per month (LKR per unit delivered), and the median of all quotes per month */
export function itemPrices(d: ReportData, c: Ctx, item: string, from: string, to: string) {
  const months = monthsOf(from, to);
  const pts: { s: string; m: string; dt: string; v: number }[] = [];
  for (const q of d.quotes) {
    if (!c.whoOk(q.supplier_id)) continue;
    const dt = day(q.quote_date ?? q.created_at);
    if (dt < from || dt > to) continue;
    const f = discFactor(q);
    for (const l of q.lines) if (l.item_id === item) { const v = unitLkr({ ...q, _f: f }, l); if (v != null) pts.push({ s: q.supplier_id, m: dt.slice(0, 7), dt, v }); }
  }
  const sups = [...new Set(pts.map((p) => p.s))].sort((a, b) => pts.filter((p) => p.s === b).length - pts.filter((p) => p.s === a).length);
  const series = sups.map((s) => ({ s, values: months.map((m) => { const x = pts.filter((p) => p.s === s && p.m === m).sort((a, b) => b.dt.localeCompare(a.dt))[0]; return x ? x.v : null; }) }));
  const median = months.map((m) => { const v = pts.filter((p) => p.m === m).map((p) => p.v).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; });
  return { months, series, median, pts };
}
function priceChart(months: string[], series: { name: string; values: (number | null)[] }[], median: (number | null)[]): ChartSpec {
  return {
    type: 'line', title: '', xLabel: '', yLabel: 'LKR per unit', categories: months.map(monLabel), legend: true, showValues: false, yMin: null, yMax: null, w: 760, h: 300,
    series: [...series.slice(0, 6).map((s, i) => ({ name: s.name, color: PALETTE[i % PALETTE.length], values: s.values })), { name: 'Median of all quotes', color: '#8A9099', values: median }],
  };
}
function prices(d: ReportData, c: Ctx, f: RFilters): Report {
  const item = d.items.find((i) => i.id === f.item) ?? null;
  if (!item) return { tiles: [], tables: [], note: d.items.length ? 'Choose an item.' : 'No items yet – items are made when quote lines are matched.' };
  const r = itemPrices(d, c, item.id, f.from, f.to);
  const lastMed = [...r.median].reverse().find((v) => v != null) ?? null, firstMed = r.median.find((v) => v != null) ?? null;
  const latest = r.series.map((s) => ({ s: s.s, v: [...s.values].reverse().find((v) => v != null) ?? null })).filter((x) => x.v != null) as { s: string; v: number }[];
  const lo = latest.length ? latest.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  return {
    tiles: [
      { label: 'Typical price, latest month (median)', value: lastMed ? `LKR ${lkr0(lastMed)}` : '—' },
      { label: 'Change over the period', value: firstMed && lastMed ? sgn(((lastMed - firstMed) / firstMed) * 100) : '—', tone: firstMed && lastMed ? (lastMed < firstMed ? 'green' : lastMed > firstMed ? 'red' : undefined) : undefined },
      { label: lo ? `Lowest latest: ${c.name(lo.s)}` : 'Lowest latest', value: lo ? `LKR ${lkr0(lo.v)}` : '—' },
      { label: 'Prices in the period', value: String(r.pts.length) },
    ],
    chart: r.pts.length ? priceChart(r.months, r.series.map((s) => ({ name: c.name(s.s), values: s.values })), r.median) : undefined,
    tables: [{
      empty: 'No price for this item in the period.',
      head: [{ h: 'Supplier', w: 220, grow: true }, { h: 'Latest (LKR / unit)', w: 140, right: true }, { h: 'Against the median', w: 140, right: true }, { h: 'Prices', w: 80, right: true }],
      rows: latest.sort((a, b) => a.v - b.v).map((x) => {
        const dv = lastMed ? ((x.v - lastMed) / lastMed) * 100 : null;
        return { key: x.s, cells: [{ t: c.name(x.s) }, { t: lkr0(x.v) }, { t: dv == null ? '—' : sgn(dv), tone: dv == null ? undefined : dv <= 0 ? 'good' : dv > 3 ? 'bad' : 'warn' }, { t: String(r.pts.filter((p) => p.s === x.s).length) }] };
      }),
    }],
    note: `${item.code} · ${item.name}. LKR per unit delivered (exchange rate of the quote, freight and discount included), every version on every package.`,
  };
}

// ---------------------------------------------------------------- 7. terms & cash
function terms(d: ReportData, c: Ctx): Report {
  const by = new Map<string, { v: number; before: number; cost: number; adv: number[]; days: number[] }>();
  for (const x of c.chosen) {
    if (!c.whoOk(x.q.supplier_id)) continue;
    const o = by.get(x.q.supplier_id) ?? { v: 0, before: 0, cost: 0, adv: [], days: [] };
    const cash = cashOf(x.q, x.t, d.costPct), tm = termsOf(x.q);
    o.v += x.t; o.before += cash?.before ?? 0; o.cost += cash?.cost ?? 0;
    if (tm) { o.adv.push(tm.adv); o.days.push(tm.days); }
    by.set(x.q.supplier_id, o);
  }
  const rows = [...by.entries()].map(([id, o]) => ({ s: c.sup.get(id)!, ...o, a: avg(o.adv), dd: avg(o.days) })).sort((a, b) => b.before - a.before);
  const before = rows.reduce((a, r) => a + r.before, 0), cost = rows.reduce((a, r) => a + r.cost, 0);
  return {
    tiles: [
      { label: 'Paid before delivery (chosen quotes)', value: `LKR ${M(before)}`, tone: before ? 'amber' : undefined },
      { label: `Cost of the payment timing at ${d.costPct} % a year`, value: cost >= 0 ? `≈ LKR ${M(cost)}` : `saves ≈ LKR ${M(-cost)}` },
      { label: 'Average days to pay after delivery', value: rows.length ? `${(avg(rows.map((r) => r.dd ?? 0)) ?? 0).toFixed(0)} days` : '—' },
      { label: 'Suppliers asking 50 % or more up front', value: String(rows.filter((r) => (r.a ?? 0) >= 50).length), tone: rows.some((r) => (r.a ?? 0) >= 50) ? 'red' : undefined },
    ],
    tables: [{
      empty: 'No supplier chosen in this period.',
      head: [{ h: 'Supplier', w: 220, grow: true }, { h: 'Chosen value', w: 120, right: true }, { h: 'Before delivery', w: 120, right: true }, { h: 'Days to pay', w: 100, right: true }, { h: 'Cash out early', w: 120, right: true }, { h: 'Cost of money', w: 130, right: true }],
      rows: rows.map((r) => ({ key: r.s.id, cells: [{ t: r.s.name, sub: `${KIND_LABEL[r.s.kind]} · ${originText(r.s)}` }, { t: M(r.v) }, { t: pct(r.a), tone: r.a == null ? undefined : r.a >= 50 ? 'bad' : r.a >= 30 ? 'warn' : 'good' }, { t: r.dd == null ? '—' : `${r.dd.toFixed(0)} d` }, { t: M(r.before) }, { t: r.cost >= 0 ? `≈ ${M(r.cost)}` : `saves ≈ ${M(-r.cost)}`, tone: r.cost > 0 ? 'warn' : 'good' }] })),
    }],
    note: 'Same rules as the comparison page: advances are paid at order (lead time before delivery; 8 weeks when not given), commissioning and handover 30 and 60 days after delivery.',
  };
}

// ---------------------------------------------------------------- 8. one supplier
function profile(d: ReportData, c: Ctx, f: RFilters): Report {
  const all = scoreRows(d, { ...c, whoOk: () => true });
  const r = all.find((x) => x.s.id === f.supplier) ?? null;
  if (!r) return { tiles: [], tables: [], note: 'Choose a supplier who was asked or quoted in the period.' };
  const rank = all.findIndex((x) => x.s.id === r.s.id) + 1;
  const mine = c.pkgs.filter((p) => (c.byPkg.get(p.id) ?? []).some((q) => q.supplier_id === r.s.id));
  const excl = new Set<string>(), late: string[] = [];
  for (const p of mine) {
    const q = [...(c.byPkg.get(p.id) ?? [])].filter((x) => x.supplier_id === r.s.id && !x.superseded_by)[0];
    q?.exclusions.forEach((x) => excl.add(x.text));
    if (q?.valid_until && p.our_validity && q.valid_until < p.our_validity) late.push(p.code);
  }
  const points = [
    ['Price', r.gap == null ? 'Not compared with another quote yet' : `${r.gap.toFixed(1)} % above the lowest on average · lowest ${r.low} of ${r.compared} times`],
    ['Negotiation', r.drop == null ? 'No revised quote' : `${r.drop.toFixed(1)} % from first offer to latest on average`],
    ['Specification', r.spec == null ? 'Not checked' : `${r.spec.toFixed(0)} % of quotes meet the specification`],
    ['Lead time', r.lead == null ? 'No needed date on the packages' : `${r.lead.toFixed(0)} % within what the job needs`],
    ['Terms', r.adv == null ? 'No payment stages entered' : `${r.adv.toFixed(0)} % before delivery · pays on average ${r.days!.toFixed(0)} days after delivery`],
    ['Excludes', excl.size ? [...excl].slice(0, 6).join(', ') : 'Nothing excluded'],
    ['Validity', late.length ? `Ended before our quotation on ${late.join(', ')}` : 'Valid as long as our quotations'],
  ];
  const item = (() => { const m = new Map<string, number>(); d.quotes.filter((q) => q.supplier_id === r.s.id).forEach((q) => q.lines.forEach((l) => l.item_id && m.set(l.item_id, (m.get(l.item_id) ?? 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; })();
  const pr = item ? itemPrices(d, { ...c, whoOk: () => true }, item, f.from, f.to) : null;
  const own = pr?.series.find((s) => s.s === r.s.id);
  return {
    tiles: [
      { label: `Score – ${rank} of ${all.length}`, value: r.score == null ? '—' : `${r.grade} ${r.score}`, tone: r.grade === 'A' ? 'green' : r.grade === 'D' ? 'red' : r.grade === 'C' ? 'amber' : undefined },
      { label: `Chosen value · ${r.won} package(s)`, value: `LKR ${M(r.value)}` },
      { label: 'Quoted when asked', value: `${r.quoted} of ${r.asked}` },
      { label: 'Lowest price', value: r.compared ? `${r.low} of ${r.compared}` : '—' },
    ],
    chart: pr && own ? priceChart(pr.months, [{ name: r.s.name, values: own.values }], pr.median) : undefined,
    tables: [
      { title: 'Strengths and points to raise', empty: '—', head: [{ h: 'Point', w: 150 }, { h: 'What the quotes show', w: 420, grow: true }], rows: points.map(([a, b]) => ({ key: a, cells: [{ t: a }, { t: b }] })) },
      { title: 'Packages', empty: 'No package in the period.', head: [{ h: 'Package', w: 260, grow: true }, { h: 'Stage', w: 90 }, { h: 'Latest (LKR)', w: 120, right: true }, { h: 'Result', w: 110 }],
        rows: mine.map((p) => {
          const q = atStage(c.byPkg.get(p.id) ?? [], p.stage ?? 'pre_bid').find((x) => x.supplier_id === r.s.id) ?? [...(c.byPkg.get(p.id) ?? [])].reverse().find((x) => x.supplier_id === r.s.id)!;
          const won = c.chosen.some((x) => x.p.id === p.id && x.q.supplier_id === r.s.id);
          return { key: p.id, href: `/supplier-quotes/${p.id}`, cells: [{ t: p.title, sub: `${p.code} · R${q.revision}` }, { t: STAGE_LABEL[q.bid_stage ?? 'pre_bid'] }, { t: M(c.total(q)) }, { t: won ? 'Chosen' : p.selected_quote_id ? 'Not chosen' : 'Comparing', tone: won ? 'good' : undefined }] };
        }) },
    ],
    note: item && pr ? `Price chart: ${d.items.find((i) => i.id === item)?.name ?? ''} – this supplier against the median of all quotes.` : undefined,
  };
}

export function runReport(key: ReportKey, d: ReportData, f: RFilters): Report {
  const c = context(d, f);
  switch (key) {
    case 'scorecard': return scorecard(d, c);
    case 'awards': return awards(d, c);
    case 'savings': return savings(d, c);
    case 'exceptions': return exceptions(d, c);
    case 'competition': return competition(d, c);
    case 'prices': return prices(d, c, f);
    case 'terms': return terms(d, c);
    case 'profile': return profile(d, c, f);
  }
}
