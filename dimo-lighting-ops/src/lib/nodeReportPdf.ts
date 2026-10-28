import { esc, printHtml, reportHtml } from './export';

// Node report PDF (orders, sales, estimation, design): the report as filtered on screen – where the items are now, the days each
// node takes, the hidden node, people, who to chase, the trend and the item picked. Hidden nodes are striped and the time we did
// not see exactly has lighter stripes, as on screen (SVG patterns, so they print everywhere).

export type PdfNode = { key: string; name: string; colour: string; who: string; hidden?: boolean };
/** A table cell: text, or text with the node's colour swatch in front (key with '~' = the hidden node, not seen) */
export type PdfCell = string | number | { node: string; text: string };
export type PdfTable = { title: string; head: string[]; right?: number[]; rows: PdfCell[][]; late?: boolean[]; note?: string; empty?: string };

export type NodeReportPdfInput = {
  key: string;
  title: string;
  intro: string;
  filters: string;
  period: string;
  generatedBy: string;
  nodes: PdfNode[];
  cardsTitle: string;
  cards: { key: string; name: string; holding: number; lines: string[]; warn?: string; who: string }[];
  legend: { node: string; text: string }[];
  barsTitle: string;
  bars: { cat: string; note: string; parts: { key: string; days: number }[]; total: number }[];
  hidden: { title: string; node: string; lines: { node?: string; text: string }[]; bins: { label: string; n: number; m: number }[]; binsLabel: string; labels: string[] };
  tables: PdfTable[];
};

const d1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const h2 = (t: string) => `<h2 style="background:#F2F2F2">${esc(t)}</h2>`;
const pid = (k: string) => `p_${k.replace(/[^A-Za-z0-9]/g, '_')}`;

function patterns(nodes: PdfNode[]) {
  return `<svg width="0" height="0" style="position:absolute"><defs>${nodes.filter((n) => n.hidden).map((n) => `
<pattern id="${pid(n.key)}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#CBD2DC"/><rect width="4" height="8" fill="${n.colour}"/></pattern>
<pattern id="${pid(n.key + '~')}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#EEF1F5"/><rect width="3" height="8" fill="${n.colour}" fill-opacity="0.55"/></pattern>`).join('')}</defs></svg>`;
}

export function nodeReportPdfHtml(i: NodeReportPdfInput) {
  const node = (k: string) => i.nodes.find((n) => n.key === k.replace('~', ''));
  const fill = (k: string) => (node(k)?.hidden ? `url(#${pid(k)})` : node(k)?.colour ?? '#9CA3AF');
  const sw = (k: string) => `<svg width="10" height="10" style="vertical-align:-1px;margin-right:4px"><rect width="10" height="10" rx="2" fill="${fill(k)}"/></svg>`;
  const nameOf = (k: string) => `${node(k)?.name ?? k}${k.endsWith('~') ? ' (not seen)' : ''}`;
  const cell = (c: PdfCell) => (typeof c === 'object' ? `${sw(c.node)}${esc(c.text)}` : esc(c));
  const table = (t: PdfTable) => {
    const r = new Set(t.right ?? []);
    const al = (k: number) => (r.has(k) ? 'right' : 'left');
    const body = t.rows.length
      ? `<table><thead><tr>${t.head.map((h, k) => `<th style="text-align:${al(k)}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows
          .map((row, n) => `<tr${t.late?.[n] ? ' class="late"' : ''}>${row.map((c, k) => `<td${String(typeof c === 'object' ? c.text : c).length <= 16 ? ' class="nw"' : ''} style="text-align:${al(k)}">${cell(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      : `<div class="note">${esc(t.empty ?? 'Nothing in this period.')}</div>`;
    return `${h2(t.title)}${body}${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}`;
  };

  // Stacked bars: average working days per item, by node
  const maxBar = Math.max(1, ...i.bars.map((b) => b.total));
  const BW = 700, BH = 22;
  const bars = i.bars.map((b) => {
    let x = 0;
    const w = (b.total / maxBar) * BW;
    const parts = b.parts.filter((p) => p.days > 0).map((p) => {
      const pw = (p.days / (b.total || 1)) * w;
      const s = `<rect x="${x}" y="0" width="${pw}" height="${BH}" fill="${fill(p.key)}"/>${p.days / (b.total || 1) > 0.08 ? `<text x="${x + pw / 2}" y="${BH / 2 + 3.5}" font-size="9" font-weight="bold" text-anchor="middle" fill="${node(p.key)?.hidden ? '#111' : '#fff'}">${d1(p.days)}</text>` : ''}`;
      x += pw;
      return s;
    }).join('');
    return `<div class="bar"><div class="bh"><b>${esc(b.cat)}</b><span>${esc(b.note)}</span></div><svg viewBox="0 0 ${BW} ${BH}" width="100%" height="${BH}" preserveAspectRatio="none"><rect width="${BW}" height="${BH}" rx="4" fill="#F4F5F7"/>${parts}</svg></div>`;
  }).join('');
  const legendKeys = [...i.nodes.map((n) => n.key), i.hidden.node + '~'];

  // Histogram of the hidden node's passes (seen exactly, and start or end not seen on top)
  const maxBin = Math.max(1, ...i.hidden.bins.map((b) => b.n + b.m));
  const HW = 360, HH = 110, gap = 6, bw = (HW - gap * (i.hidden.bins.length - 1)) / Math.max(1, i.hidden.bins.length);
  const hist = `<svg viewBox="0 0 ${HW} ${HH + 28}" width="100%" style="max-width:340px">${i.hidden.bins.map((b, k) => {
    const x = k * (bw + gap), hn = (b.n / maxBin) * (HH - 14), hm = (b.m / maxBin) * (HH - 14);
    return `<rect x="${x}" y="${HH - hn}" width="${bw}" height="${Math.max(1.5, hn)}" fill="${fill(i.hidden.node)}"/>${b.m ? `<rect x="${x}" y="${HH - hn - hm}" width="${bw}" height="${hm}" fill="${fill(i.hidden.node + '~')}"/>` : ''}
<text x="${x + bw / 2}" y="${HH - hn - hm - 3}" font-size="9" text-anchor="middle" fill="#333">${b.n + b.m}</text><text x="${x + bw / 2}" y="${HH + 12}" font-size="8.5" text-anchor="middle" fill="#555">${esc(b.label)}</text>`;
  }).join('')}<line x1="0" x2="${HW}" y1="${HH}" y2="${HH}" stroke="#CCC"/><text x="${HW / 2}" y="${HH + 26}" font-size="8.5" text-anchor="middle" fill="#555">${esc(i.hidden.binsLabel)}</text></svg>`;

  const extra = `
<style>
  .cards { display:grid; grid-template-columns: repeat(${Math.min(7, i.cards.length)}, 1fr); gap:6px; margin:4px 0 6px; }
  .cards > div { border:1px solid #E3E3E3; border-top-width:4px; padding:5px; page-break-inside: avoid; } .cards .hid { background:#F4F6F8; }
  .cards .n { font-weight:bold; font-size:18px; margin:2px 0; } .cards .l { font-size:8.5px; color:#333; } .cards .w { font-size:8.5px; color:#B45309; } .cards .who { font-size:7.5px; color:#666; margin-top:2px; }
  .legend { display:flex; gap:12px; flex-wrap:wrap; font-size:8.5px; margin:4px 0; } .lg { font-size:8.5px; color:#444; margin:3px 0; }
  .bar { margin:4px 0 7px; page-break-inside: avoid; } .bh { display:flex; justify-content:space-between; font-size:9.5px; margin-bottom:2px; } .bh span { color:#555; }
  .two { display:grid; grid-template-columns: 3fr 2fr; gap:14px; align-items:start; } td.nw { white-space:nowrap; }
  h2 { page-break-after: avoid; break-after: avoid; } .note { color:#555; font-size:8.5px; margin: 2px 0; } .intro { color:#333; font-size:9px; margin: 0 0 6px; }
  tr.late td { color:#C8102E; } tr.late td:first-child { border-left: 3px solid #C8102E; }
  ul { margin: 2px 0 6px 14px; padding: 0; } li { margin: 2px 0; }
</style>
${patterns(i.nodes)}
<div class="intro">${esc(i.intro)}</div>
${h2(i.cardsTitle)}
<div class="cards">${i.cards.map((c) => `<div class="${node(c.key)?.hidden ? 'hid' : ''}" style="border-top-color:${node(c.key)?.colour ?? '#999'}"><div>${sw(c.key)}<b>${esc(c.name)}</b></div><div class="n">${c.holding}</div>${c.lines.map((l) => `<div class="l">${esc(l)}</div>`).join('')}${c.warn ? `<div class="w">${esc(c.warn)}</div>` : ''}<div class="who">${esc(c.who)}</div></div>`).join('')}</div>
${i.legend.map((l) => `<div class="lg">${sw(l.node)}${esc(l.text)}</div>`).join('')}
<div class="two">
  <div>${h2(i.barsTitle)}${bars}<div class="legend">${legendKeys.map((k) => `<span>${sw(k)}${esc(nameOf(k))}</span>`).join('')}</div></div>
  <div>${h2(i.hidden.title)}${i.hidden.lines.map((l) => `<div class="lg">${l.node ? sw(l.node) : ''}${esc(l.text)}</div>`).join('')}${hist}${i.hidden.labels.length ? `<ul>${i.hidden.labels.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</div>
</div>
${i.tables.map(table).join('')}`;
  return reportHtml({ key: i.key, title: i.title, filters: i.filters, period: i.period, currencyNote: 'Working days (weekends and holidays not counted)', generatedBy: i.generatedBy, landscape: true }, [], [], extra);
}

export async function exportNodeReport(i: NodeReportPdfInput) {
  await printHtml(nodeReportPdfHtml(i), { key: i.key, filters: i.filters, title: i.title, landscape: true, by: i.generatedBy });
}

/** The trend table rows: average days per slice, month by month, and the change from the first month with data to the last */
export function trendRows(trend: { key: string; name: string; vals: (number | null)[] }[]): PdfCell[][] {
  return trend.map((r) => {
    const a = r.vals.find((x) => x != null), b = [...r.vals].reverse().find((x) => x != null);
    const ch = a == null || b == null ? '—' : `${b - a > 0 ? '+' : ''}${d1(b - a)} d`;
    return [{ node: r.key, text: r.name }, ...r.vals.map((v) => (v == null ? '—' : d1(v))), ch];
  });
}
export const pdfMonth = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
export const pdfD1 = d1;
