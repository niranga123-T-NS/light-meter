import { PALETTE, type ChartSpec } from './charts';
import { fmtDate } from './format';
import { supabase } from './supabase';
import { atStage, chains, KIND_LABEL, lkrM, normQuote, notLowest, originText, postBidSaving, quoteTotals, STAGE_LABEL, type SqPackage, type SqQuote, type Supplier } from './supplierQuotes';
import type { Report, Tone } from './supplierReports';

// Supplier quotes analysis on one page: the project summary (every package, who quoted, who was lowest and chosen, how far prices
// came down) and the package analysis (how each supplier moved from the first offer through every revision, ranks before and after).
// Prices are comparable totals – LKR delivered, discounts and priced-back exclusions included – as on the comparison page.

export type SqProject = {
  id: string; code: string; name: string; client: string | null; job_ref: string | null; source_kind: 'project' | 'inquiry' | 'exec' | null; source_id: string | null;
  our_validity: string | null; notes: string | null; status: 'open' | 'closed' | 'cancelled'; created_at: string; updated_at: string;
};

export async function loadProject(id: string) {
  const [p, pk, s] = await Promise.all([
    supabase.from('sq_projects').select('*').eq('id', id).maybeSingle(),
    supabase.from('sq_packages').select('*').eq('project_id', id).order('created_at'),
    supabase.from('sq_suppliers').select('*').order('name'),
  ]);
  const err = p.error ?? pk.error ?? s.error;
  if (err) throw new Error(err.message);
  if (!p.data) throw new Error('Project not found');
  const pkgs = (pk.data ?? []) as SqPackage[];
  const q = pkgs.length
    ? await supabase.from('sq_quotes').select('*, lines:sq_quote_lines(*), payments:sq_quote_payments(*), exclusions:sq_quote_exclusions(*)').in('package_id', pkgs.map((x) => x.id)).order('created_at')
    : { data: [], error: null };
  if (q.error) throw new Error(q.error.message);
  return { project: p.data as SqProject, pkgs, quotes: ((q.data ?? []) as SqQuote[]).map(normQuote), suppliers: (s.data ?? []) as Supplier[] };
}

const M = (v: number | null | undefined) => (v == null ? '—' : lkrM(v));
const sgn = (v: number, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)} %`;
const pctCh = (a: number, b: number) => (a ? ((b - a) / a) * 100 : 0);
const toM = (v: number | null) => (v == null ? null : Math.round(v / 1e4) / 100);
const short = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const moveTone = (v: number | null): Tone | undefined => (v == null ? undefined : v < -0.05 ? 'good' : v > 0.05 ? 'bad' : undefined);
const chart = (type: ChartSpec['type'], categories: string[], series: { name: string; values: (number | null)[] }[], yLabel: string, h = 280): ChartSpec => ({
  type, title: '', xLabel: '', yLabel, categories, legend: true, showValues: false, yMin: null, yMax: null, w: 760, h,
  series: series.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] })),
});

/** Per package: each supplier's versions, the quotes compared now, the lowest and the chosen */
function packageFacts(p: SqPackage, quotes: SqQuote[], total: (q: SqQuote) => number) {
  const all = quotes.filter((q) => q.package_id === p.id);
  const ch = chains(all);
  const set = atStage(all, p.stage ?? 'pre_bid');
  const low = set.length ? set.reduce((a, b) => (total(b) < total(a) ? b : a)) : null;
  const firsts = ch.map((c) => c[0]);
  const lowFirst = firsts.length ? Math.min(...firsts.map(total)) : null;
  const chosen = all.find((q) => q.id === p.selected_quote_id) ?? null;
  const moves = ch.filter((c) => c.length > 1).map((c) => pctCh(total(c[0]), total(c[c.length - 1])));
  return { all, ch, set, low, lowFirst, chosen, moves, avgMove: moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : null };
}

// ---------------------------------------------------------------- the project on one page
export function projectReport(pkgs: SqPackage[], quotes: SqQuote[], sups: Supplier[]): Report {
  const sup = new Map(sups.map((s) => [s.id, s]));
  const name = (id: string) => sup.get(id)?.name ?? '—';
  const cache = new Map<string, number>();
  const total = (q: SqQuote) => { let t = cache.get(q.id); if (t == null) { t = quoteTotals(q).total; cache.set(q.id, t); } return t; };
  const live = pkgs.filter((p) => p.status !== 'cancelled');
  const facts = live.map((p) => ({ p, ...packageFacts(p, quotes, total) }));
  const supIds = [...new Set(facts.flatMap((f) => f.all.map((q) => q.supplier_id)))];
  const lowSum = facts.reduce((a, f) => a + (f.low ? total(f.low) : 0), 0);
  const firstSum = facts.reduce((a, f) => a + (f.lowFirst ?? 0), 0);
  const chosenF = facts.filter((f) => f.chosen);
  const chosenSum = chosenF.reduce((a, f) => a + total(f.chosen!), 0);
  const prem = chosenF.reduce((a, f) => a + Math.max(0, total(f.chosen!) - (f.low ? total(f.low) : total(f.chosen!))), 0);
  const savs = facts.map((f) => postBidSaving(f.p, quotes, name)).filter((x): x is NonNullable<typeof x> => !!x && x.saving != null);
  const saved = savs.reduce((a, x) => a + x.saving!, 0), savBase = savs.reduce((a, x) => a + (x.basis?.value ?? 0), 0);
  const nls = facts.map((f) => ({ f, n: notLowest(f.p, quotes, name) })).filter((x) => x.n) as { f: (typeof facts)[number]; n: NonNullable<ReturnType<typeof notLowest>> }[];
  const missed = nls.filter((x) => x.n.stage === 'post_bid').reduce((a, x) => a + x.n.diff, 0), carried = nls.filter((x) => x.n.stage !== 'post_bid').reduce((a, x) => a + x.n.diff, 0);
  const versions = facts.reduce((a, f) => a + f.all.length, 0), offers = facts.reduce((a, f) => a + f.ch.length, 0);
  // supplier × package matrix: rank of each supplier's current price on each package
  const shown = facts.slice(0, 6);
  const rankOn = (f: (typeof facts)[number], id: string) => {
    const q = f.set.find((x) => x.supplier_id === id);
    if (!q) return null;
    const sorted = [...f.set].sort((a, b) => total(a) - total(b));
    return { q, rank: sorted.findIndex((x) => x.id === q.id) + 1, n: sorted.length };
  };
  const supRows = supIds.map((id) => {
    const on = facts.map((f) => rankOn(f, id));
    return { id, on, quoted: facts.filter((f) => f.all.some((q) => q.supplier_id === id)).length, lowest: on.filter((x) => x && x.rank === 1 && x.n > 1).length, won: facts.filter((f) => f.chosen?.supplier_id === id).length };
  }).sort((a, b) => b.won - a.won || b.lowest - a.lowest || b.quoted - a.quoted);
  return {
    tiles: [
      { label: 'Packages', value: String(live.length), sub: `${chosenF.length} chosen · ${live.filter((p) => p.stage === 'post_bid').length} at Post Bid` },
      { label: 'Suppliers and manufacturers', value: String(supIds.length), sub: `${offers} offers · ${versions} versions in all` },
      { label: 'Lowest on every package now', value: `LKR ${M(lowSum)}`, sub: firstSum ? `first offers were ${M(firstSum)}` : undefined },
      { label: 'Came down from the first offers', value: firstSum ? sgn(pctCh(firstSum, lowSum)) : '—', tone: firstSum && lowSum < firstSum ? 'green' : undefined, sub: firstSum ? `LKR ${M(firstSum - lowSum)}` : undefined },
      { label: 'Chosen so far', value: `LKR ${M(chosenSum)}`, sub: chosenF.length ? (prem > 0.5 ? `${M(prem)} above the lowest` : 'all at the lowest') : 'nothing chosen yet', tone: prem > 0.5 ? 'amber' : undefined },
      ...(savs.length ? [{ label: `Saving against Pre Bid – ${savs.length} Post Bid package(s)`, value: `LKR ${M(saved)}`, sub: savBase ? `${sgn(-(saved / savBase) * 100)} on the bid value of ${M(savBase)}` : undefined, tone: saved >= 0 ? ('green' as const) : ('red' as const) }] : []),
      ...(missed > 0.5 ? [{ label: 'Potential saving – lowest not chosen at Post Bid', value: `LKR ${M(missed)}`, sub: `${nls.filter((x) => x.n.stage === 'post_bid').length} package(s) – reasons below`, tone: 'red' as const }] : []),
      ...(carried > 0.5 ? [{ label: 'Above the lowest at Pre Bid (carried into our bid)', value: `LKR ${M(carried)}`, sub: `${nls.filter((x) => x.n.stage !== 'post_bid').length} package(s) – reasons below`, tone: 'amber' as const }] : []),
    ],
    charts: facts.length ? [
      { title: 'Each package – lowest first offer, lowest now and chosen (LKR M)', spec: chart('bar', facts.map((f) => short(f.p.title)), [
        { name: 'Lowest first offer', values: facts.map((f) => toM(f.lowFirst)) },
        { name: 'Lowest now', values: facts.map((f) => toM(f.low ? total(f.low) : null)) },
        { name: 'Chosen', values: facts.map((f) => toM(f.chosen ? total(f.chosen) : null)) },
      ], 'LKR M') },
      { title: 'Who quoted, who was lowest, who was chosen (packages)', spec: { ...chart('bar', supRows.slice(0, 10).map((r) => short(name(r.id))), [
        { name: 'Quoted', values: supRows.slice(0, 10).map((r) => r.quoted) },
        { name: 'Lowest', values: supRows.slice(0, 10).map((r) => r.lowest) },
        { name: 'Chosen', values: supRows.slice(0, 10).map((r) => r.won) },
      ], 'Packages'), yMin: 0, yMax: Math.max(4, ...supRows.map((r) => r.quoted)) } },
    ] : [],
    tables: [
      {
        title: 'Packages', empty: 'No package yet – add the first one.',
        head: [{ h: 'Package', w: 220, grow: true }, { h: 'Offers', w: 80, right: true }, { h: 'Lowest now', w: 150, right: true }, { h: 'Chosen', w: 160, right: true }, { h: 'Chosen vs lowest', w: 120, right: true }, { h: 'Came down', w: 100, right: true }, { h: 'Saving vs Pre Bid', w: 130, right: true }],
        rows: facts.map((f) => {
          const lt = f.low ? total(f.low) : null, ct = f.chosen ? total(f.chosen) : null;
          return {
            key: f.p.id, href: `/supplier-quotes/${f.p.id}`,
            cells: [
              { t: f.p.title, sub: `${f.p.code} · ${STAGE_LABEL[f.p.stage ?? 'pre_bid']} · ${f.p.status === 'selected' ? 'supplier chosen' : f.p.status === 'open' ? 'comparing' : f.p.status}` },
              { t: String(f.ch.length), sub: `${f.all.length} versions` },
              { t: M(lt), sub: f.low ? name(f.low.supplier_id) : undefined, tone: lt != null ? 'good' : undefined },
              { t: M(ct), sub: f.chosen ? name(f.chosen.supplier_id) : 'not chosen' },
              { t: ct != null && lt ? sgn(pctCh(lt, ct)) : '—', tone: ct != null && lt && ct > lt + 0.5 ? 'warn' : undefined },
              { t: f.avgMove == null ? '—' : sgn(f.avgMove), sub: f.avgMove == null ? 'no revisions' : 'average from first offer', tone: moveTone(f.avgMove) },
              (() => {
                const v = postBidSaving(f.p, quotes, name);
                if (!v) return { t: 'Pre Bid', sub: 'no saving yet' };
                if (v.saving == null) return { t: '—', sub: v.basis ? 'no Post Bid price yet' : 'enter the Pre Bid value', tone: v.basis ? undefined : ('warn' as Tone) };
                return { t: M(v.saving), sub: `${sgn(v.pct ?? 0)} on ${M(v.basis!.value)}`, tone: (v.saving >= 0 ? 'good' : 'bad') as Tone };
              })(),
            ],
          };
        }),
      },
      ...(nls.length ? [{
        title: 'Lowest not chosen – difference and reason', empty: '—',
        head: [{ h: 'Package', w: 200, grow: true }, { h: 'Chosen', w: 170 }, { h: 'Lowest', w: 170 }, { h: 'Difference', w: 130, right: true }, { h: 'Reason', w: 260, grow: true }],
        rows: nls.map((x) => ({
          key: x.f.p.id, href: `/supplier-quotes/${x.f.p.id}`,
          cells: [
            { t: x.f.p.title, sub: `${x.f.p.code} · ${x.n.stage === 'post_bid' ? 'Post Bid – potential saving' : 'Pre Bid – above the lowest'}` },
            { t: name(x.n.chosen.supplier_id), sub: M(total(x.n.chosen)) }, { t: name(x.n.low.supplier_id), sub: M(total(x.n.low)) },
            { t: M(x.n.diff), sub: sgn(x.n.pct), tone: (x.n.stage === 'post_bid' ? 'bad' : 'warn') as Tone },
            { t: x.n.reason ?? 'no reason given', tone: x.n.reason ? undefined : ('bad' as Tone) },
          ],
        })),
      }] : []),
      {
        title: shown.length < facts.length ? `Suppliers on each package (first ${shown.length} packages)` : 'Suppliers on each package', empty: 'No quotes yet.',
        head: [{ h: 'Supplier', w: 200, grow: true }, ...shown.map((f) => ({ h: short(f.p.title, 18), w: 120, right: true })), { h: 'Lowest · chosen', w: 120, right: true }],
        rows: supRows.map((r) => {
          const s = sup.get(r.id);
          return {
            key: r.id, href: `/supplier-quotes/supplier/${r.id}`,
            cells: [
              { t: name(r.id), sub: s ? `${KIND_LABEL[s.kind]} · ${originText(s)}` : undefined },
              ...shown.map((f, i) => {
                const x = r.on[i];
                if (!x) return { t: f.all.some((q) => q.supplier_id === r.id) ? 'Pre Bid only' : '—' };
                const ch = f.chosen?.supplier_id === r.id;
                return { t: M(total(x.q)), sub: `${x.rank} of ${x.n}${ch ? ' · chosen' : ''}`, tone: (x.rank === 1 && x.n > 1 ? 'good' : x.rank === x.n && x.n > 1 ? 'bad' : undefined) as Tone | undefined };
              }),
              { t: `${r.lowest} · ${r.won}`, sub: `of ${r.quoted} quoted` },
            ],
          };
        }),
      },
    ],
    note: 'Comparable totals: LKR delivered, freight, discounts and priced-back exclusions included. "Lowest now" uses each package\'s current stage (Post Bid quotes once the package has moved on). Tap a package or a supplier for the full detail.',
  };
}

// ---------------------------------------------------------------- one package: how everybody came down or up
export function packageReport(p: SqPackage, quotes: SqQuote[], sups: Supplier[]): Report {
  const sup = new Map(sups.map((s) => [s.id, s]));
  const name = (id: string) => sup.get(id)?.name ?? '—';
  const cache = new Map<string, number>();
  const total = (q: SqQuote) => { let t = cache.get(q.id); if (t == null) { t = quoteTotals(q).total; cache.set(q.id, t); } return t; };
  const f = packageFacts(p, quotes, total);
  if (!f.ch.length) return { tiles: [], tables: [] };
  const rows = f.ch.map((c) => {
    const first = c[0], last = c[c.length - 1];
    const pre = [...c].reverse().find((x) => (x.bid_stage ?? 'pre_bid') === 'pre_bid') ?? null;
    const now = f.set.find((x) => x.supplier_id === first.supplier_id && c.some((y) => y.id === x.id)) ?? null;
    return { c, first, last, pre, now, move: pctCh(total(first), total(last)) };
  });
  const byFirst = [...rows].sort((a, b) => total(a.first) - total(b.first));
  const byNow = rows.filter((r) => r.now).sort((a, b) => total(a.now!) - total(b.now!));
  const lowT = f.low ? total(f.low) : null;
  const hiT = byNow.length ? total(byNow[byNow.length - 1].now!) : null;
  const maxRev = Math.max(...rows.map((r) => r.c.length));
  const moved = rows.filter((r) => r.c.length > 1);
  const best = moved.length ? moved.reduce((a, b) => (b.move < a.move ? b : a)) : null;
  const post = p.stage === 'post_bid' ? rows.filter((r) => r.pre && r.now && r.now.id !== r.pre.id) : [];
  const sv = postBidSaving(p, quotes, name);
  const nl = notLowest(p, quotes, name);
  const versions = [...f.all].sort((a, b) => (a.quote_date ?? a.created_at).localeCompare(b.quote_date ?? b.created_at) || a.revision - b.revision);
  return {
    tiles: [
      { label: 'Suppliers quoting', value: String(rows.length), sub: `${f.all.length} versions in all` },
      { label: 'Lowest now', value: `LKR ${M(lowT)}`, sub: f.low ? name(f.low.supplier_id) : undefined, tone: 'green' },
      { label: 'Spread – highest above lowest', value: lowT && hiT ? sgn(pctCh(lowT, hiT)) : '—', sub: hiT != null && byNow.length > 1 ? `highest ${M(hiT)} · ${name(byNow[byNow.length - 1].first.supplier_id)}` : undefined },
      { label: 'Came down on average', value: moved.length ? sgn(moved.reduce((a, r) => a + r.move, 0) / moved.length) : '—', sub: best ? `most: ${name(best.first.supplier_id)} ${sgn(best.move)}` : 'no revised quotes yet', tone: moved.length ? 'green' : undefined },
      ...(nl ? [{ label: `${nl.label} – ${nl.stage === 'post_bid' ? 'Post Bid' : 'Pre Bid'}`, value: `LKR ${M(nl.diff)}`, sub: `${sgn(nl.pct)} vs ${nl.lowName} · reason: ${nl.reason ?? 'not given'}`, tone: nl.stage === 'post_bid' ? ('red' as const) : ('amber' as const) }] : []),
      ...(sv ? [
        { label: 'Pre Bid value (our bid)', value: sv.basis ? `LKR ${M(sv.basis.value)}` : 'not entered', sub: sv.basis ? sv.basis.how : 'enter it to see the saving', tone: sv.basis ? undefined : ('amber' as const) },
        { label: sv.chosen ? 'Saving against Pre Bid (chosen)' : 'Saving against Pre Bid (lowest now)', value: sv.saving == null ? '—' : `LKR ${M(sv.saving)}`, sub: sv.pct == null ? undefined : `${sgn(sv.pct)} · Post Bid ${M(sv.now)}`, tone: sv.saving == null ? undefined : sv.saving >= 0 ? ('green' as const) : ('red' as const) },
      ] : []),
    ],
    charts: [
      { title: 'How each supplier moved – comparable total per version (LKR M)', spec: chart('line', Array.from({ length: maxRev }, (_, i) => (i ? `R${i}` : 'First offer')), rows.map((r) => ({ name: name(r.first.supplier_id), values: Array.from({ length: maxRev }, (_, i) => { const q = r.c.find((x) => x.revision === i); return q ? toM(total(q)) : null; }) })), 'LKR M') },
      { title: 'First offer against latest (LKR M)', spec: chart('bar', rows.map((r) => short(name(r.first.supplier_id))), [
        { name: 'First offer', values: rows.map((r) => toM(total(r.first))) },
        ...(post.length ? [{ name: 'Last Pre Bid', values: rows.map((r) => toM(r.pre ? total(r.pre) : null)) }] : []),
        { name: 'Latest', values: rows.map((r) => toM(total(r.last))) },
      ], 'LKR M') },
    ],
    tables: [
      {
        title: 'Ranking and movement', empty: '—',
        head: [{ h: 'Supplier', w: 200, grow: true }, { h: 'First offer', w: 110, right: true }, ...(p.stage === 'post_bid' ? [{ h: 'Pre Bid', w: 110, right: true }] : []), { h: 'Latest', w: 110, right: true }, { h: 'Change', w: 90, right: true }, { h: 'Rank first → now', w: 120, right: true }, { h: 'Above lowest', w: 100, right: true }, { h: 'Versions', w: 80, right: true }],
        rows: [...rows].sort((a, b) => (a.now ? total(a.now) : Infinity) - (b.now ? total(b.now) : Infinity)).map((r) => {
          const s = sup.get(r.first.supplier_id);
          const rf = byFirst.indexOf(r) + 1, rn = r.now ? byNow.indexOf(r) + 1 : null;
          const chosen = f.chosen && r.c.some((x) => x.id === f.chosen!.id);
          return {
            key: r.first.id,
            href: `/supplier-quotes/supplier/${r.first.supplier_id}`,
            cells: [
              { t: name(r.first.supplier_id), sub: `${s ? `${KIND_LABEL[s.kind]} · ${originText(s)}` : ''}${chosen ? ' · chosen' : ''}` },
              { t: M(total(r.first)) },
              ...(p.stage === 'post_bid' ? [{ t: M(r.pre ? total(r.pre) : null) }] : []),
              { t: M(total(r.last)), sub: `${STAGE_LABEL[r.last.bid_stage ?? 'pre_bid']} · R${r.last.revision}` },
              { t: r.c.length > 1 ? sgn(r.move) : '—', tone: r.c.length > 1 ? moveTone(r.move) : undefined },
              { t: rn ? `${rf} → ${rn}` : `${rf} → out`, tone: rn && rn < rf ? 'good' : rn && rn > rf ? 'bad' : !rn ? 'warn' : undefined },
              { t: r.now && lowT ? (total(r.now) <= lowT + 0.5 ? 'lowest' : sgn(pctCh(lowT, total(r.now)))) : '—', tone: r.now && lowT && total(r.now) <= lowT + 0.5 ? 'good' : undefined },
              { t: String(r.c.length) },
            ],
          };
        }),
      },
      {
        title: 'Every version, in order', empty: '—',
        head: [{ h: 'Date', w: 100 }, { h: 'Supplier', w: 190, grow: true }, { h: 'Version', w: 110 }, { h: 'Comparable total', w: 130, right: true }, { h: 'From previous', w: 110, right: true }, { h: 'What changed', w: 260, grow: true }],
        rows: versions.map((q) => {
          const prev = q.revision ? f.all.find((x) => (x.first_id ?? x.id) === (q.first_id ?? q.id) && x.revision === q.revision - 1) : null;
          const d = prev ? pctCh(total(prev), total(q)) : null;
          return {
            key: q.id,
            cells: [
              { t: fmtDate(q.quote_date ?? q.created_at) }, { t: name(q.supplier_id) }, { t: `R${q.revision}`, sub: STAGE_LABEL[q.bid_stage ?? 'pre_bid'] },
              { t: M(total(q)), sub: q.currency === 'LKR' ? undefined : `${q.currency} at ${q.fx_rate}` }, { t: d == null ? 'first offer' : sgn(d), tone: moveTone(d) },
              { t: q.revision ? q.revision_note ?? '—' : (q.notes ?? '—') },
            ],
          };
        }),
      },
    ],
  };
}
