import { MILESTONES } from './constants';
import { esc, printHtml, reportHtml } from './export';
import { fmtMonth, fyLabel, LINES, lineShort } from './finance';
import { projectTypeLabel } from './roles';

// Pipeline management report: a branded PDF of the pipeline forecast exactly as filtered on screen – headline figures,
// orders by month (chart and table), stage funnel, sales people, business lines and categories, risks, and the project lists.

export type PipeProject = {
  id: string;
  code: string;
  name: string;
  customer: string;
  owner_id: string;
  project_type: string;
  term: string;
  line: string | null;
  milestone: string;
  win_probability: number;
  value_lkr: number;
  weighted_lkr: number;
  expected_month: string;
  award_passed: boolean;
};
export type PipeSecured = { id: string; name: string; customer: string | null; owner_id: string; line: string | null; value_lkr: number; month: string; project_type: string | null };
export type PipeBand = { value: string; label: string; color: string };
export type PipeFlag = { key: string; label: string; n: number };

export type PipelineReportInput<T extends PipeProject = PipeProject> = {
  fy: number;
  today: string;
  filters: string;
  generatedBy: string;
  bands: PipeBand[];
  bandOf: (p: number) => string;
  flagOf: (p: T) => string[];
  flags: PipeFlag[];
  months: string[];
  monthly: Record<string, number>[];
  cum: { a: number; t: number }[];
  projects: T[];
  inYear: T[];
  later: T[];
  secured: PipeSecured[];
  targets: { owner_id: string; month: string; target: number }[];
  targetApplies: boolean;
  totals: { secured: number; weighted: number; unweighted: number; expected: number; target: number | null; stillNeeded: number | null };
  onHold: { n: number; value_lkr: number };
  name: (id: string) => string;
  byPerson: boolean;
};

const mn = (v: number | null | undefined, d = 2) => (v == null ? '—' : (Number(v) / 1e6).toFixed(d));
const pct = (a: number, b: number | null | undefined) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const sum = <T,>(xs: T[], g: (x: T) => number) => xs.reduce((a, x) => a + Number(g(x) || 0), 0);
const h2 = (t: string) => `<h2 style="background:#F2F2F2">${esc(t)}</h2>`;
function table(head: string[], rows: (string | number)[][], right: number[] = [], total?: (string | number)[]) {
  const r = new Set(right);
  const td = (c: string | number, i: number) => `<td style="text-align:${r.has(i) ? 'right' : 'left'}">${esc(c)}</td>`;
  return `<table><thead><tr>${head.map((h, i) => `<th style="text-align:${r.has(i) ? 'right' : 'left'}">${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((x) => `<tr>${x.map(td).join('')}</tr>`).join('')}${total ? `<tr class="total">${total.map(td).join('')}</tr>` : ''}</tbody></table>`;
}
const kv = (items: [string, string, string?][]) =>
  `<div class="kv">${items.map(([k, v, c]) => `<div><div class="k">${esc(k)}</div><div class="v" style="color:${c ?? '#111'}">${esc(v)}</div></div>`).join('')}</div>`;

/** Stacked monthly bars (secured + weighted bands) with the target as a marker – plain SVG so it prints everywhere. */
function monthChart<T extends PipeProject>(i: PipelineReportInput<T>) {
  const W = 760, H = 220, L = 46, B = 24, TOP = 10;
  const series = [{ key: 'secured', label: 'Secured', color: '#2a78d6' }, ...i.bands.map((b) => ({ key: b.value, label: b.label, color: b.color }))];
  const stack = i.monthly.map((m) => series.reduce((a, s) => a + (m[s.key] || 0), 0));
  const max = Math.max(1, ...stack, ...(i.targetApplies ? i.monthly.map((m) => m.target || 0) : [0])) * 1.1;
  const bw = (W - L - 10) / i.months.length;
  const y = (v: number) => TOP + (H - TOP - B) * (1 - v / max);
  let svg = '';
  for (let g = 0; g <= 4; g++) {
    const v = (max / 4) * g;
    svg += `<line x1="${L}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" stroke="#E5E5E5"/><text x="${L - 4}" y="${y(v) + 3}" font-size="8" text-anchor="end" fill="#555">${mn(v, 0)}</text>`;
  }
  i.monthly.forEach((m, k) => {
    let base = 0;
    const x = L + k * bw + bw * 0.18;
    for (const s of series) {
      const v = m[s.key] || 0;
      if (v > 0) svg += `<rect x="${x}" y="${y(base + v)}" width="${bw * 0.64}" height="${y(base) - y(base + v)}" fill="${s.color}"/>`;
      base += v;
    }
    if (i.targetApplies && m.target) svg += `<line x1="${x - 3}" x2="${x + bw * 0.64 + 3}" y1="${y(m.target)}" y2="${y(m.target)}" stroke="#111" stroke-width="2"/>`;
    svg += `<text x="${x + bw * 0.32}" y="${H - 8}" font-size="8" text-anchor="middle" fill="#333">${esc(fmtMonth(i.months[k]).slice(0, 3))}</text>`;
  });
  const legend = [...series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`), ...(i.targetApplies ? ['<span><i style="background:#111;height:2px"></i>Target</span>'] : [])].join('');
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg><div class="legend">${legend}</div>`;
}

export async function exportPipelineReport<T extends PipeProject>(i: PipelineReportInput<T>) {
  const stage = (m: string) => MILESTONES.find((x) => x.value === m)?.label ?? m;
  const t = i.totals;
  const coverage = t.stillNeeded ? t.weighted / t.stillNeeded : null;
  const gap = t.target == null ? null : Math.max(0, t.target - t.expected);
  const tone = (ok: boolean | null) => (ok == null ? undefined : ok ? '#15803D' : '#C8102E');

  // Monthly table
  const monthRows = i.months.map((m, k) => {
    const x = i.monthly[k];
    const pipe = i.bands.reduce((a, b) => a + (x[b.value] || 0), 0);
    return [fmtMonth(m), mn(x.secured), ...i.bands.map((b) => mn(x[b.value])), mn(x.secured + pipe), ...(i.targetApplies ? [mn(x.target), mn(i.cum[k].a), mn(i.cum[k].t), pct(i.cum[k].a, i.cum[k].t)] : [mn(i.cum[k].a)])];
  });
  const monthHead = ['Month', 'Secured', ...i.bands.map((b) => b.label), 'Total', ...(i.targetApplies ? ['Target', 'Cumulative', 'Cum. target', 'Cum. %'] : ['Cumulative'])];
  const monthTotal = ['Total', mn(sum(i.monthly, (x) => x.secured)), ...i.bands.map((b) => mn(sum(i.monthly, (x) => x[b.value]))), mn(t.expected),
    ...(i.targetApplies ? [mn(t.target), '', '', pct(t.expected, t.target)] : [''])];

  // Stage funnel (open projects, all months)
  const stages = MILESTONES.filter((m) => m.value !== 'won' && m.value !== 'lost').map((m) => {
    const ps = i.projects.filter((p) => p.milestone === m.value);
    return [m.label, ps.length, mn(sum(ps, (p) => p.value_lkr)), mn(sum(ps, (p) => p.weighted_lkr)), ps.length ? `${Math.round(sum(ps, (p) => p.win_probability) / ps.length)}%` : '—'];
  }).filter((r) => Number(r[1]) > 0);

  // Sales people
  const owners = [...new Set([...i.inYear.map((p) => p.owner_id), ...i.secured.map((s) => s.owner_id), ...i.targets.map((x) => x.owner_id)])].filter(Boolean);
  const people = owners
    .map((o) => {
      const sec = sum(i.secured.filter((s) => s.owner_id === o), (s) => s.value_lkr);
      const w = sum(i.inYear.filter((p) => p.owner_id === o), (p) => p.weighted_lkr);
      const tg = i.targetApplies ? sum(i.targets.filter((x) => x.owner_id === o), (x) => x.target) : null;
      const need = tg == null ? null : Math.max(0, tg - sec);
      return { o, sec, w, exp: sec + w, tg, n: i.inYear.filter((p) => p.owner_id === o).length, cov: need ? w / need : null };
    })
    .sort((a, b) => b.exp - a.exp);

  // Business lines and categories (secured + weighted in the year)
  const group = (key: (x: { line: string | null; project_type: string | null }) => string, label: (k: string) => string) => {
    const keys = [...new Set([...i.inYear.map(key), ...i.secured.map(key)])];
    return keys
      .map((k) => {
        const sec = sum(i.secured.filter((s) => key(s) === k), (s) => s.value_lkr);
        const ps = i.inYear.filter((p) => key(p) === k);
        return [label(k), mn(sec), ps.length, mn(sum(ps, (p) => p.value_lkr)), mn(sum(ps, (p) => p.weighted_lkr)), mn(sec + sum(ps, (p) => p.weighted_lkr))];
      })
      .sort((a, b) => Number(b[5]) - Number(a[5]));
  };
  const lines = group((x) => x.line ?? 'none', (k) => (k === 'none' ? 'Building – line not set' : LINES.find((l) => l.value === k)?.label ?? k));
  const cats = group((x) => x.project_type ?? '—', (k) => (k === '—' ? '—' : projectTypeLabel(k)));

  const projRow = (p: T) => [
    `${p.code} ${p.name}`, p.customer, ...(i.byPerson ? [i.name(p.owner_id)] : []), `${projectTypeLabel(p.project_type)} · ${p.line ? lineShort(p.line) : '—'}`, stage(p.milestone),
    `${p.win_probability}%`, mn(p.value_lkr), mn(p.weighted_lkr), `${fmtMonth(p.expected_month)}${p.award_passed ? ' (passed)' : ''}`,
    i.flagOf(p).map((k) => i.flags.find((f) => f.key === k)?.label ?? k).join('; ') || '—',
  ];
  const projHead = ['Project', 'Customer', ...(i.byPerson ? ['Sales person'] : []), 'Category · line', 'Stage', 'Win %', 'Value', 'Weighted', 'Expected order', 'Needs attention'];
  const projRight = i.byPerson ? [5, 6, 7] : [4, 5, 6];
  const byWeighted = (xs: T[]) => [...xs].sort((a, b) => b.weighted_lkr - a.weighted_lkr);
  const top = byWeighted(i.inYear).slice(0, 15);
  const risky = i.projects.filter((p) => i.flagOf(p).length);

  const headline: string[] = [];
  headline.push(`Secured ${mn(t.secured)} Mn and a weighted pipeline of ${mn(t.weighted)} Mn to March give an expected ${mn(t.expected)} Mn${t.target != null ? ` – ${pct(t.expected, t.target)} of the ${mn(t.target)} Mn target` : ''}.`);
  if (gap) headline.push(`${mn(gap)} Mn still to find beyond the weighted pipeline.`);
  if (coverage != null) headline.push(`Coverage ${coverage.toFixed(1)}× (weighted pipeline ÷ still to secure) – ${coverage >= 1.5 ? 'healthy' : coverage >= 1 ? 'thin' : 'not enough to reach the target'}.`);
  const likely = i.bands[0] ? sum(i.inYear.filter((p) => i.bandOf(p.win_probability) === i.bands[0].value), (p) => p.weighted_lkr) : 0;
  headline.push(`${mn(likely)} Mn of the weighted pipeline is likely (70% +); ${top.length ? `the largest is ${top[0].name} (${mn(top[0].weighted_lkr)} Mn weighted, ${fmtMonth(top[0].expected_month)})` : 'no projects in the year'}.`);
  const passed = i.projects.filter((p) => p.award_passed).length;
  if (passed) headline.push(`${passed} project${passed === 1 ? ' has' : 's have'} an award date already passed – their dates need updating.`);
  if (i.onHold.n) headline.push(`${i.onHold.n} project${i.onHold.n === 1 ? '' : 's'} on hold (${mn(i.onHold.value_lkr)} Mn) not counted.`);

  const extra = `
<style>
  .kv { display:grid; grid-template-columns: repeat(5, 1fr); gap:6px; margin:4px 0 6px; } .kv > div { border:1px solid #E3E3E3; padding:5px; }
  .kv .k { color:#555; font-size:8.5px; } .kv .v { font-weight:bold; font-size:13px; }
  .legend { display:flex; gap:12px; flex-wrap:wrap; font-size:8.5px; margin:2px 0 4px; } .legend i { display:inline-block; width:10px; height:8px; margin-right:4px; vertical-align:middle; }
  ul { margin: 2px 0 6px 14px; padding: 0; } li { margin: 2px 0; } .note { color:#555; font-size:8.5px; margin: 2px 0; }
  .brk { page-break-before: always; }
  .foot { display: none; }
</style>
${h2('Summary')}
<ul>${headline.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
${kv([
  [`Secured · ${fyLabel(i.fy)}`, mn(t.secured)],
  [`Weighted pipeline to Mar (${i.inYear.length})`, mn(t.weighted)],
  ['Expected year-end', mn(t.expected), tone(t.target == null ? null : t.expected >= t.target)],
  [i.targetApplies ? 'Secured-order target' : 'Target (not split by filters)', mn(t.target)],
  ['Expected vs target', pct(t.expected, t.target), tone(t.target == null ? null : t.expected >= t.target)],
  ['Gap still to find', mn(gap), tone(gap == null ? null : gap <= 0)],
  ['Coverage', coverage == null ? '—' : `${coverage.toFixed(1)}×`, tone(coverage == null ? null : coverage >= 1)],
  ['Unweighted pipeline to Mar', mn(t.unweighted)],
  [`Beyond ${fyLabel(i.fy)} (${i.later.length}, weighted)`, mn(sum(i.later, (p) => p.weighted_lkr))],
  [`On hold · ${i.onHold.n} (not counted)`, mn(i.onHold.value_lkr)],
])}
${h2(`Orders by month · ${fyLabel(i.fy)} (LKR Mn)`)}
${monthChart(i)}
${table(monthHead, monthRows, monthHead.map((_, k) => k).slice(1), monthTotal)}
<div class="note">Secured = orders won. Pipeline = lighting value × win probability, in its expected award month; a passed award date counts in the current month.</div>
${h2('Pipeline by stage (open projects, all months · LKR Mn)')}
${table(['Stage', 'Projects', 'Value', 'Weighted', 'Average win %'], stages, [1, 2, 3, 4], ['Total', i.projects.length, mn(sum(i.projects, (p) => p.value_lkr)), mn(sum(i.projects, (p) => p.weighted_lkr)), ''])}
${i.byPerson && people.length ? `${h2('By sales person (LKR Mn)')}${table(
    ['Sales person', 'Secured', 'Projects to Mar', 'Weighted', 'Expected', ...(i.targetApplies ? ['Target', 'Expected vs target', 'Coverage'] : [])],
    people.map((x) => [i.name(x.o), mn(x.sec), x.n, mn(x.w), mn(x.exp), ...(i.targetApplies ? [mn(x.tg), pct(x.exp, x.tg), x.cov == null ? '—' : `${x.cov.toFixed(1)}×`] : [])]),
    i.targetApplies ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4],
  )}` : ''}
${h2('By business line (LKR Mn)')}
${table(['Business line', 'Secured', 'Projects to Mar', 'Value', 'Weighted', 'Expected'], lines, [1, 2, 3, 4, 5])}
${h2('By category (LKR Mn)')}
${table(['Category', 'Secured', 'Projects to Mar', 'Value', 'Weighted', 'Expected'], cats, [1, 2, 3, 4, 5])}
${h2('Needs attention')}
${table(['Check', 'Projects'], i.flags.map((f) => [f.label, f.n]), [1])}
<div class="brk"></div>
${h2(`Top ${top.length} opportunities to March by weighted value (LKR Mn)`)}
${top.length ? table(projHead, top.map(projRow), projRight) : '<div class="note">None.</div>'}
${h2(`Secured orders · ${fyLabel(i.fy)} (${i.secured.length} · LKR Mn)`)}
${i.secured.length ? table(['Project', 'Customer', ...(i.byPerson ? ['Sales person'] : []), 'Line', 'Month', 'Value'],
    [...i.secured].sort((a, b) => a.month.localeCompare(b.month)).map((s) => [s.name, s.customer ?? '—', ...(i.byPerson ? [i.name(s.owner_id)] : []), s.line ? lineShort(s.line) : '—', fmtMonth(s.month), mn(s.value_lkr)]),
    [i.byPerson ? 5 : 4], ['Total', '', ...(i.byPerson ? [''] : []), '', '', mn(t.secured)]) : '<div class="note">No secured orders for these filters.</div>'}
${risky.length ? `${h2(`Projects needing attention (${risky.length})`)}${table(projHead, byWeighted(risky).map(projRow), projRight)}` : ''}
${h2(`All open projects (${i.projects.length} · LKR Mn)`)}
${table(projHead, byWeighted(i.projects).map(projRow), projRight, ['Total', '', ...(i.byPerson ? [''] : []), '', '', '', mn(sum(i.projects, (p) => p.value_lkr)), mn(sum(i.projects, (p) => p.weighted_lkr)), '', ''])}
<div class="note">Figures as of ${esc(i.today)} · LKR Mn · USD at the monthly rate.</div>`;

  const html = reportHtml({ key: 'pipeline_report', title: `Pipeline management report · ${fyLabel(i.fy)}`, filters: i.filters, period: fyLabel(i.fy),
    currencyNote: 'LKR Mn – USD converted at the monthly rate', generatedBy: i.generatedBy, landscape: true }, [], [], extra);
  await printHtml(html, { key: 'pipeline_report', filters: i.filters, title: 'Pipeline management report', landscape: true });
}
