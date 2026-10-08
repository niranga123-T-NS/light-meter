// Charts for QA / QC test reports, drawn as SVG so they print sharply: bar, stacked bar, horizontal bar, line, area,
// pie, doughnut and scatter, with title, axis labels, legend, data labels and colours chosen by the author.

export type ChartType = 'bar' | 'stacked' | 'hbar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter';
export type ChartSeries = { name: string; color: string; values: (number | null)[] };
export type ChartSpec = {
  type: ChartType;
  title: string;
  xLabel: string;
  yLabel: string;
  categories: string[];
  series: ChartSeries[];
  /** Pie / doughnut: one colour per category */
  catColors?: string[];
  legend: boolean;
  showValues: boolean;
  yMin?: number | null;
  yMax?: number | null;
  w: number;
  h: number;
};

export const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'bar', label: 'Column (bars)' },
  { value: 'stacked', label: 'Stacked column' },
  { value: 'hbar', label: 'Horizontal bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' },
  { value: 'doughnut', label: 'Doughnut' },
  { value: 'scatter', label: 'Scatter (X–Y)' },
];
export const PALETTE = ['#1D4ED8', '#C8102E', '#16A34A', '#D97706', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#475569', '#EA580C'];

export function defaultChart(): ChartSpec {
  return {
    type: 'bar',
    title: 'Chart title',
    xLabel: 'Category',
    yLabel: 'Value',
    categories: ['C1', 'C2', 'C3', 'C4'],
    series: [
      { name: 'L-E (MΩ)', color: PALETTE[0], values: [520, 610, 480, 700] },
      { name: 'N-E (MΩ)', color: PALETTE[1], values: [480, 590, 450, 650] },
    ],
    legend: true,
    showValues: false,
    w: 520,
    h: 300,
  };
}

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : String(Math.round(v * 100) / 100));

function niceTicks(lo: number, hi: number, count = 5) {
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.round(v * 1e9) / 1e9);
  return out;
}

/** The chart as an SVG string (fills its box; keeps proportions when printed) */
export function renderChartSvg(c: ChartSpec) {
  const W = Math.max(160, c.w);
  const H = Math.max(120, c.h);
  const font = 'font-family="Arial, Helvetica, sans-serif"';
  const parts: string[] = [];
  let top = 10;
  if (c.title) {
    parts.push(`<text x="${W / 2}" y="18" text-anchor="middle" font-size="13" font-weight="700" fill="#111" ${font}>${x(c.title)}</text>`);
    top = 28;
  }
  const pieLike = c.type === 'pie' || c.type === 'doughnut';
  const legendItems = pieLike ? c.categories.map((n, i) => ({ n, col: c.catColors?.[i] ?? PALETTE[i % PALETTE.length] })) : c.series.map((s) => ({ n: s.name, col: s.color }));
  let bottom = H - 8;
  if (c.legend && legendItems.length) {
    // legend row(s) at the bottom
    let lx = 10;
    let ly = H - 10;
    const rows: string[] = [];
    const widths = legendItems.map((it) => 18 + Math.min(160, it.n.length * 6.2) + 12);
    const lines = Math.max(1, Math.ceil(widths.reduce((a, b) => a + b, 0) / (W - 20)));
    ly = H - 10 - (lines - 1) * 15;
    legendItems.forEach((it, i) => {
      if (lx + widths[i] > W - 10 && lx > 10) {
        lx = 10;
        ly += 15;
      }
      rows.push(`<rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="2" fill="${x(it.col)}"/><text x="${lx + 14}" y="${ly}" font-size="10.5" fill="#333" ${font}>${x(it.n.slice(0, 26))}</text>`);
      lx += widths[i];
    });
    parts.push(...rows);
    bottom = H - 10 - lines * 15 - 4;
  }

  if (pieLike) {
    const vals = (c.series[0]?.values ?? []).map((v) => Math.max(0, Number(v) || 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2;
    const cy = (top + bottom) / 2;
    const r = Math.max(20, Math.min(W / 2 - 20, (bottom - top) / 2 - 6));
    const inner = c.type === 'doughnut' ? r * 0.55 : 0;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const col = c.catColors?.[i] ?? PALETTE[i % PALETTE.length];
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, rad: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
      if (v / total >= 0.9999) {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${x(col)}"/>${inner ? `<circle cx="${cx}" cy="${cy}" r="${inner}" fill="#fff"/>` : ''}`);
      } else if (v > 0) {
        const d = inner
          ? `M${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(a1, r)} L${p(a1, inner)} A${inner},${inner} 0 ${large} 0 ${p(a0, inner)} Z`
          : `M${cx},${cy} L${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(a1, r)} Z`;
        parts.push(`<path d="${d}" fill="${x(col)}" stroke="#fff" stroke-width="1.5"/>`);
      }
      if (c.showValues && v > 0) {
        const am = (a0 + a1) / 2;
        const lr = inner ? (r + inner) / 2 : r * 0.62;
        parts.push(`<text x="${cx + lr * Math.cos(am)}" y="${cy + lr * Math.sin(am) + 4}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#fff" ${font}>${Math.round((v / total) * 100)}%</text>`);
      }
      a0 = a1;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:100%;height:auto;display:block">${parts.join('')}</svg>`;
  }

  // Cartesian charts
  const hbar = c.type === 'hbar';
  const stacked = c.type === 'stacked';
  const scatter = c.type === 'scatter';
  const nCat = c.categories.length;
  const allVals = c.series.flatMap((s) => s.values.filter((v): v is number => v != null && !Number.isNaN(Number(v))).map(Number));
  let lo = Math.min(0, ...(allVals.length ? allVals : [0]));
  let hi = stacked ? Math.max(0, ...c.categories.map((_, i) => c.series.reduce((a, s) => a + Math.max(0, Number(s.values[i]) || 0), 0))) : Math.max(1, ...(allVals.length ? allVals : [1]));
  if (c.yMin != null && !Number.isNaN(c.yMin)) lo = c.yMin;
  if (c.yMax != null && !Number.isNaN(c.yMax)) hi = c.yMax;
  const ticks = niceTicks(lo, hi);
  const vMin = ticks[0];
  const vMax = ticks[ticks.length - 1];
  const left = (hbar ? Math.min(140, 12 + Math.max(...c.categories.map((s) => s.length), 1) * 6) : 14 + Math.max(...ticks.map((t) => num(t).length)) * 6.2) + (c.yLabel ? 16 : 0);
  const right = W - 12;
  const plotBottom = bottom - (c.xLabel ? 18 : 0) - (hbar ? 16 : 18);
  const plotTop = top + 6;
  const pw = right - left;
  const ph = plotBottom - plotTop;
  const vy = (v: number) => plotBottom - ((v - vMin) / (vMax - vMin || 1)) * ph; // value → y (vertical charts)
  const vx = (v: number) => left + ((v - vMin) / (vMax - vMin || 1)) * pw; // value → x (horizontal bars)

  // grid and value axis
  for (const t of ticks) {
    if (hbar) {
      parts.push(`<line x1="${vx(t)}" y1="${plotTop}" x2="${vx(t)}" y2="${plotBottom}" stroke="#E5E7EB"/><text x="${vx(t)}" y="${plotBottom + 13}" text-anchor="middle" font-size="10" fill="#555" ${font}>${num(t)}</text>`);
    } else {
      parts.push(`<line x1="${left}" y1="${vy(t)}" x2="${right}" y2="${vy(t)}" stroke="#E5E7EB"/><text x="${left - 5}" y="${vy(t) + 3.5}" text-anchor="end" font-size="10" fill="#555" ${font}>${num(t)}</text>`);
    }
  }
  parts.push(`<line x1="${left}" y1="${plotBottom}" x2="${right}" y2="${plotBottom}" stroke="#555"/><line x1="${left}" y1="${plotTop}" x2="${left}" y2="${plotBottom}" stroke="#555"/>`);
  if (c.xLabel) parts.push(`<text x="${left + pw / 2}" y="${bottom - 2}" text-anchor="middle" font-size="11" fill="#333" ${font}>${x(c.xLabel)}</text>`);
  if (c.yLabel) parts.push(`<text transform="translate(12 ${plotTop + ph / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="#333" ${font}>${x(c.yLabel)}</text>`);

  if (scatter) {
    const xsNum = c.categories.map((s) => Number(s));
    const numericX = xsNum.every((v) => !Number.isNaN(v)) && nCat > 0;
    const xt = numericX ? niceTicks(Math.min(...xsNum), Math.max(...xsNum)) : [];
    const sx = (i: number) => (numericX ? left + ((xsNum[i] - xt[0]) / (xt[xt.length - 1] - xt[0] || 1)) * pw : left + ((i + 0.5) / Math.max(1, nCat)) * pw);
    if (numericX) xt.forEach((t) => parts.push(`<text x="${left + ((t - xt[0]) / (xt[xt.length - 1] - xt[0] || 1)) * pw}" y="${plotBottom + 13}" text-anchor="middle" font-size="10" fill="#555" ${font}>${num(t)}</text>`));
    else c.categories.forEach((s, i) => parts.push(`<text x="${sx(i)}" y="${plotBottom + 13}" text-anchor="middle" font-size="10" fill="#555" ${font}>${x(s.slice(0, 14))}</text>`));
    c.series.forEach((s) =>
      s.values.forEach((v, i) => {
        if (v == null || Number.isNaN(Number(v))) return;
        parts.push(`<circle cx="${sx(i)}" cy="${vy(Number(v))}" r="4" fill="${x(s.color)}" fill-opacity="0.85"/>`);
        if (c.showValues) parts.push(`<text x="${sx(i)}" y="${vy(Number(v)) - 7}" text-anchor="middle" font-size="9.5" fill="#333" ${font}>${num(Number(v))}</text>`);
      }),
    );
  } else if (hbar) {
    const band = ph / Math.max(1, nCat);
    const bw = (band * 0.72) / Math.max(1, c.series.length);
    c.categories.forEach((cat, i) => {
      parts.push(`<text x="${left - 5}" y="${plotTop + band * i + band / 2 + 3.5}" text-anchor="end" font-size="10" fill="#333" ${font}>${x(cat.slice(0, 22))}</text>`);
      c.series.forEach((s, k) => {
        const v = Number(s.values[i]) || 0;
        const y0 = plotTop + band * i + band * 0.14 + bw * k;
        const a = vx(Math.min(0, v) < vMin ? vMin : Math.min(0, v));
        const b = vx(Math.max(0, v));
        parts.push(`<rect x="${Math.min(a, vx(v))}" y="${y0}" width="${Math.abs(b - a) || Math.abs(vx(v) - vx(0))}" height="${bw}" fill="${x(s.color)}"/>`);
        if (c.showValues) parts.push(`<text x="${vx(v) + 4}" y="${y0 + bw / 2 + 3.5}" font-size="9.5" fill="#333" ${font}>${num(v)}</text>`);
      });
    });
  } else {
    const band = pw / Math.max(1, nCat);
    c.categories.forEach((cat, i) => parts.push(`<text x="${left + band * i + band / 2}" y="${plotBottom + 13}" text-anchor="middle" font-size="10" fill="#333" ${font}>${x(cat.slice(0, 16))}</text>`));
    const zero = vy(Math.max(vMin, Math.min(0, vMax)));
    if (c.type === 'bar' || stacked) {
      const groups = stacked ? 1 : Math.max(1, c.series.length);
      const bw = (band * 0.7) / groups;
      c.categories.forEach((_, i) => {
        let acc = 0;
        c.series.forEach((s, k) => {
          const v = Number(s.values[i]) || 0;
          const bx = left + band * i + band * 0.15 + (stacked ? 0 : bw * k);
          const yTop = stacked ? vy(acc + Math.max(0, v)) : vy(Math.max(0, v));
          const yBot = stacked ? vy(acc) : vy(Math.min(0, v));
          parts.push(`<rect x="${bx}" y="${Math.min(yTop, yBot)}" width="${bw}" height="${Math.abs(yBot - yTop)}" fill="${x(s.color)}"/>`);
          if (c.showValues && v) parts.push(`<text x="${bx + bw / 2}" y="${stacked ? (yTop + yBot) / 2 + 3.5 : yTop - 4}" text-anchor="middle" font-size="9.5" fill="${stacked ? '#fff' : '#333'}" ${font}>${num(v)}</text>`);
          if (stacked) acc += Math.max(0, v);
        });
      });
    } else {
      // line / area
      c.series.forEach((s) => {
        const pts = s.values.map((v, i) => (v == null || Number.isNaN(Number(v)) ? null : [left + band * i + band / 2, vy(Number(v))] as [number, number])).filter((p): p is [number, number] => !!p);
        if (!pts.length) return;
        const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
        if (c.type === 'area') parts.push(`<path d="${path} L${pts[pts.length - 1][0]},${zero} L${pts[0][0]},${zero} Z" fill="${x(s.color)}" fill-opacity="0.25"/>`);
        parts.push(`<path d="${path}" fill="none" stroke="${x(s.color)}" stroke-width="2.2"/>`);
        pts.forEach((p, i) => {
          parts.push(`<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#fff" stroke="${x(s.color)}" stroke-width="2"/>`);
          if (c.showValues) parts.push(`<text x="${p[0]}" y="${p[1] - 7}" text-anchor="middle" font-size="9.5" fill="#333" ${font}>${num(Number(s.values.filter((v) => v != null && !Number.isNaN(Number(v)))[i]))}</text>`);
        });
      });
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:100%;height:auto;display:block">${parts.join('')}</svg>`;
}
