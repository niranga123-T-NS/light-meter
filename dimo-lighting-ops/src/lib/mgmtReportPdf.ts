import { EXEC_STAGES } from '@/lib/execution';
import { esc, printHtml, reportHtml } from './export';
import { fmtMonth, fyLabel } from './finance';
import type { MgmtReport } from './mgmtReport';
import { AREAS } from './mgmtReport';

// Management report as a branded PDF (same header, watermark and footer as the other reports)

const mn = (v: number | null | undefined) => (v == null ? '—' : (Number(v) / 1e6).toFixed(2));
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const COL = { red: '#C8102E', amber: '#B45309', green: '#15803D' };

function table(head: string[], rows: (string | number)[][], right = new Set<number>()) {
  return `<table><thead><tr>${head.map((h, i) => `<th style="text-align:${right.has(i) ? 'right' : 'left'}">${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${right.has(i) ? 'right' : 'left'}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const kv = (items: [string, string][]) =>
  `<div class="kv">${items.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>`;
const h2 = (t: string) => `<h2 style="background:#F2F2F2">${esc(t)}</h2>`;

export async function exportMgmtReport(r: MgmtReport, comments: string | null, generatedBy: string, logoUrl?: string | null) {
  const right = (...i: number[]) => new Set(i);
  const html = `
<style>
  .rag { display:flex; gap:6px; flex-wrap:wrap; margin: 4px 0 8px; } .rag span { color:#fff; padding:2px 8px; border-radius:8px; font-weight:bold; font-size:9px; }
  .kv { display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; margin:4px 0 6px; } .kv .k { color:#555; font-size:8.5px; } .kv .v { font-weight:bold; font-size:11px; }
  ul { margin: 2px 0 6px 14px; padding: 0; } li { margin: 2px 0; }
  .flag { border-left: 4px solid; padding: 2px 6px; margin: 2px 0; } .comments { white-space: pre-wrap; border:1px solid #DDD; padding:6px; background:#FAFAFA; }
  .note { color:#555; font-size:8.5px; margin: 2px 0; }
</style>
<div class="rag">${AREAS.map((a) => `<span style="background:${COL[r.status[a.key]]}">${esc(a.label)}</span>`).join('')}</div>
${h2('Highlights')}
<ul>${r.headlines.map((h) => `<li>${esc(h)}</li>`).join('') || '<li>No figures for this month yet.</li>'}</ul>
${h2(`Exceptions (${r.flags.length})`)}
${r.flags.map((f) => `<div class="flag" style="border-color:${COL[f.level]}"><b style="color:${COL[f.level]}">${esc(f.area)}</b> · ${esc(f.text)}</div>`).join('') || '<div class="note">Nothing outside the limits this month.</div>'}
${comments ? `${h2('Management comments')}<div class="comments">${esc(comments)}</div>` : ''}
${h2(`P&L${r.pnl.month ? ` – OR file ${fmtMonth(r.pnl.month)}` : ''} (LKR Mn)`)}
${
  r.pnl.lines.length
    ? table(
        ['', 'Month', 'Budget', 'YTD', 'YTD budget', 'YTD %', 'FY plan'],
        r.pnl.lines.map((l) => [l.label, mn(l.m.act), mn(l.m.bud), mn(l.ytd.act), mn(l.ytd.bud), pct(Number(l.ytd.act), Number(l.ytd.bud)), mn(l.fyBp)]),
        right(1, 2, 3, 4, 5, 6),
      ) +
      `<div class="note">GP % – month ${r.pnl.gpPct.m?.toFixed(1) ?? '—'}% (budget ${r.pnl.gpPct.mBud?.toFixed(1) ?? '—'}%) · YTD ${r.pnl.gpPct.ytd?.toFixed(1) ?? '—'}% (budget ${r.pnl.gpPct.ytdBud?.toFixed(1) ?? '—'}%)</div>` +
      (r.pnl.worse.length ? `<div class="note"><b>Worse than YTD budget:</b> ${r.pnl.worse.map((x) => `${esc(x.label)} −${mn(-x.value)}`).join(' · ')}</div>` : '') +
      (r.pnl.better.length ? `<div class="note"><b>Better than YTD budget:</b> ${r.pnl.better.map((x) => `${esc(x.label)} +${mn(x.value)}`).join(' · ')}</div>` : '')
    : '<div class="note">No OR file loaded.</div>'
}
${h2(`Invoicing – ${fmtMonth(r.month)} and ${fyLabel(r.fy)} YTD (LKR Mn)`)}
${kv([
  [`Budget ${fmtMonth(r.month)}`, mn(r.invoicing.month.budget)],
  ['Forecast (schedules)', mn(r.invoicing.month.forecast)],
  ['Invoiced', mn(r.invoicing.month.invoiced)],
  [`Year-end outlook (budget ${mn(r.invoicing.fyBudget)})`, mn(r.invoicing.outlook)],
  [`Slipped (${r.invoicing.slipped.count})`, mn(r.invoicing.slipped.value)],
  ['Waiting for SM Projects (date changes)', String(r.invoicing.pending)],
  ['Certificate approved – to invoice', mn(r.invoicing.ready)],
  ['YTD invoiced / budget', `${mn(r.invoicing.ytd.invoiced)} / ${mn(r.invoicing.ytd.budget)}`],
])}
${table(
  ['Business line', 'Budget', 'Forecast', 'Invoiced', 'YTD budget', 'YTD invoiced'],
  r.invoicing.byLine.map((x) => [x.line, mn(x.budget), mn(x.forecast), mn(x.invoiced), mn(x.ytdBudget), mn(x.ytdInvoiced)]),
  right(1, 2, 3, 4, 5),
)}
${r.invoicing.moves?.byReason.length ? `<div class="note"><b>Moved to a later month YTD (${r.invoicing.moves.count}, ${mn(r.invoicing.moves.value)} Mn; DIMO execution ${mn(r.invoicing.moves.dimoValue)} Mn):</b> ${r.invoicing.moves.byReason.map((x) => `${esc(x.reason)} ${mn(x.value)} (${x.count})`).join(' · ')}</div>` : ''}
${h2('Sales (LKR Mn)')}
${kv([
  [`Secured ${fmtMonth(r.month)} (this FY's part)`, mn(r.sales.secured.month)],
  ["Secured YTD (this FY's part)", mn(r.sales.secured.ytd)],
  [`Orders won YTD (${r.sales.secured.count}) – order value`, mn(r.sales.secured.orderValueYtd ?? r.sales.secured.ytd)],
  ['Order book to invoice', mn(r.sales.orderBook)],
  ['Win rate YTD', r.sales.quotes.winRate == null ? '—' : `${Math.round(r.sales.quotes.winRate)}% (${r.sales.quotes.won} won / ${r.sales.quotes.lost} lost)`],
  [`Open quotations (${r.sales.quotes.open})`, mn(r.sales.quotes.openValue)],
])}
${table(
  ['Business line – orders won (order value)', fmtMonth(r.month), 'YTD'],
  r.sales.byLine.map((x) => [x.line, mn(x.month), mn(x.ytd)]),
  right(1, 2),
)}
${
  r.sales.people.length
    ? table(
        ['Sales person', 'Secured YTD', 'Target', '%', 'Invoiced YTD', 'Target', '%'],
        r.sales.people.map((x) => [x.name, mn(x.securedYtd), mn(x.securedTarget), pct(x.securedYtd, x.securedTarget), mn(x.invoicedYtd), mn(x.invoiceTarget), pct(x.invoicedYtd, x.invoiceTarget)]),
        right(1, 2, 3, 4, 5, 6),
      )
    : ''
}
${h2('Cash (LKR Mn)')}
${kv([
  ['Debtors', mn(r.cash.debtors)],
  [`Over 90 days (${pct(r.cash.over90, r.cash.debtors)})`, mn(r.cash.over90)],
  [`Retentions held (${r.cash.retentions.overdueCount} overdue)`, mn(r.cash.retentions.held)],
  [`Bonds active (${r.cash.bonds.count}; ${r.cash.bonds.expiring30} expire in 30 days)`, mn(r.cash.bonds.active)],
])}
${r.cash.buckets.length ? table(['Ageing', ...r.cash.buckets.map((b) => b.bucket)], [['Outstanding', ...r.cash.buckets.map((b) => mn(b.value))]], right(...r.cash.buckets.map((_, i) => i + 1))) : ''}
${r.cash.top.length ? table(['Largest debtors', 'Outstanding', 'Oldest (days)'], r.cash.top.map((x) => [x.client, mn(x.value), x.days]), right(1, 2)) : ''}
${r.usdRate ? `<div class="note">USD converted at 1 USD = ${r.usdRate} LKR</div>` : ''}
${h2('Execution')}
${kv([
  ['Projects in execution', String(r.execution.active)],
  ['Behind programme', String(r.execution.behind)],
  ['Over cost budget', String(r.execution.overCost)],
  [`Variations approved YTD (${r.execution.variations.pending} pending)`, `${mn(r.execution.variations.approvedValue)} Mn`],
  [`HSE reports ${fmtMonth(r.month)}`, `${r.execution.hse.month} (${r.execution.hse.incidents} incidents, ${r.execution.hse.lostTime} lost time)`],
  ['HSE reports open', String(r.execution.hse.open)],
])}
${
  r.execution.projects.length
    ? table(
        ['Project', 'Stage', 'Planned', 'Done', 'Finish vs baseline', 'Cost vs budget', 'HSE open'],
        r.execution.projects.map((x) => [
          `${x.code} ${x.name}`,
          EXEC_STAGES[x.stage - 1] ?? String(x.stage),
          x.planned == null ? '—' : `${x.planned}%`,
          x.actual == null ? '—' : `${x.actual}%`,
          x.late == null ? '—' : x.late > 0 ? `${x.late} days late` : 'On time',
          x.costPct == null ? '—' : `${x.costPct}%`,
          x.hseOpen,
        ]),
        right(2, 3, 4, 5, 6),
      )
    : ''
}
${h2('Warranty')}
${kv([
  ['Claims open', String(r.warranty.open)],
  [`Logged in ${fmtMonth(r.month)}`, String(r.warranty.loggedMonth)],
  ['Cost YTD (Mn)', mn(r.warranty.costYtd)],
  ['Recovered from suppliers YTD (Mn)', mn(r.warranty.recoveredYtd)],
])}
<div class="note">Figures from the app as at ${esc(new Date(r.builtAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' }))}. Highlights and exceptions follow fixed rules.</div>`;
  const title = `Management report – ${fmtMonth(r.month)}`;
  const doc = reportHtml(
    { key: 'management_report', title, filters: `Whole business · ${fmtMonth(r.month)} and ${fyLabel(r.fy)} year to date`, period: `${fmtMonth(r.month)} · ${fyLabel(r.fy)} YTD`, currencyNote: 'LKR millions', generatedBy, logoUrl },
    [],
    [],
    html,
  );
  await printHtml(doc, { key: 'management_report', filters: fmtMonth(r.month), title });
}
