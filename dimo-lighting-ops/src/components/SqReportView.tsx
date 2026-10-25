import { router } from 'expo-router';
import { Text, View, useWindowDimensions } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { DataTable, type Column } from '@/components/DataTable';
import { Card, colors, Grid, Muted, Stat } from '@/components/ui';
import { renderChartSvg } from '@/lib/charts';
import { esc, exportExcel, exportPdf, type ReportMeta } from '@/lib/export';
import type { RCell, Report } from '@/lib/supplierReports';

// One supplier-quotes report on screen and as PDF / Excel: summary tiles, charts, tables and a note.
// Used by the supplier reports, the project summary, the package analysis and the supplier profile.

const TONE = { good: { bg: '#E4F3EA', fg: '#1A6B41' }, warn: { bg: '#FDF0DC', fg: '#8A4B0F' }, bad: { bg: '#FBE6E4', fg: '#A1281C' } };

export function ReportBody({ rep }: { rep: Report }) {
  const { width } = useWindowDimensions();
  const charts = rep.charts ?? [];
  // two charts side by side on a wide screen
  const two = charts.length > 1 && width >= 1100;
  const cw = Math.max(280, Math.min(two ? (Math.min(width, 1400) - 120) / 2 : width - 80, 1200));
  return (
    <View style={{ gap: 10 }}>
      {rep.tiles.length ? <Grid min={190} max={4}>{rep.tiles.map((t) => <Stat key={t.label} label={t.label} value={t.value} tone={t.tone} sub={t.sub} />)}</Grid> : null}
      {charts.length ? (
        <View style={{ flexDirection: two ? 'row' : 'column', gap: 10 }}>
          {charts.map((c) => (
            <Card key={c.title} style={{ flex: two ? 1 : undefined, gap: 6 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{c.title}</Text>
              <SvgXml xml={renderChartSvg({ ...c.spec, w: cw - 28 })} width={cw - 28} height={c.spec.h} />
            </Card>
          ))}
        </View>
      ) : null}
      {rep.tables.map((t, ti) => {
        const cols: Column<(typeof t.rows)[number]>[] = t.head.map((h, i) => ({
          h: h.h, w: h.w, grow: h.grow, right: h.right,
          v: (r) => {
            const c = r.cells[i];
            if (!c) return '';
            const tn = c.tone ? TONE[c.tone] : null;
            return (
              <View style={{ backgroundColor: tn?.bg, borderRadius: 6, padding: tn ? 4 : 0, alignSelf: h.right ? 'flex-end' : 'stretch' }}>
                <Text style={{ color: tn?.fg ?? colors.ink, fontWeight: i === 0 ? '600' : '500', textAlign: h.right ? 'right' : 'left' }}>{c.t}</Text>
                {c.sub ? <Muted>{c.sub}</Muted> : null}
              </View>
            );
          },
        }));
        return (
          <View key={ti} style={{ gap: 4 }}>
            {t.title ? <Text style={{ fontWeight: '700', color: colors.ink, marginTop: 6 }}>{t.title}</Text> : null}
            <DataTable rows={t.rows} keyOf={(r) => r.key} columns={cols} emptyTitle={t.empty} onPress={(r) => (r.href ? router.push(r.href as never) : undefined)} />
          </View>
        );
      })}
      {rep.note ? <Muted>{rep.note}</Muted> : null}
    </View>
  );
}

const cellText = (c: RCell) => (c.sub ? `${c.t} (${c.sub})` : c.t);

/** The report as a branded PDF: intro line, tiles, charts, every table and the note */
/** One report as HTML: tiles, charts, every table and the note */
function reportHtmlBody(rep: Report) {
  const tiles = rep.tiles.length ? `<table style="margin-bottom:10px"><tr>${rep.tiles.map((t) => `<td style="border:1px solid #ddd;padding:6px;vertical-align:top"><b style="font-size:13px">${esc(t.value)}</b><br/>${esc(t.label)}${t.sub ? `<br/><span style="color:#666">${esc(t.sub)}</span>` : ''}</td>`).join('')}</tr></table>` : '';
  const charts = (rep.charts ?? []).map((c) => `<h2 style="background:#F2F2F2">${esc(c.title)}</h2><div style="margin:4px 0 8px;page-break-inside:avoid">${renderChartSvg({ ...c.spec, w: 900 })}</div>`).join('');
  const tables = rep.tables.map((t) => `${t.title ? `<h2 style="background:#F2F2F2">${esc(t.title)}</h2>` : ''}<table><thead><tr>${t.head.map((h) => `<th style="text-align:${h.right ? 'right' : 'left'}">${esc(h.h)}</th>`).join('')}</tr></thead><tbody>${
    t.rows.length ? t.rows.map((r) => `<tr>${r.cells.map((c, i) => `<td style="text-align:${t.head[i]?.right ? 'right' : 'left'}">${esc(c.t)}${c.sub ? `<br/><span style="color:#666">${esc(c.sub)}</span>` : ''}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${t.head.length}">${esc(t.empty)}</td></tr>`}</tbody></table>`).join('');
  const note = rep.note ? `<p style="color:#555">${esc(rep.note)}</p>` : '';
  return `${tiles}${charts}${tables}${note}`;
}

/** The report as a branded PDF: intro line, tiles, charts, every table and the note */
export function reportPdf(rep: Report, meta: ReportMeta, intro?: string) {
  return exportPdf(meta, [], [], `${intro ? `<p>${esc(intro)}</p>` : ''}${reportHtmlBody(rep)}`);
}

/** Several reports in one PDF, each section on a new page under its heading (e.g. the project summary, then every package) */
export function reportPdfSections(sections: { heading: string; rep: Report }[], meta: ReportMeta, intro?: string) {
  const body = sections.map((x, i) => `<div style="${i ? 'page-break-before:always;' : ''}"><h1 style="font-size:15px;margin:6px 0 8px;border-bottom:2px solid #C8102E;padding-bottom:4px">${esc(x.heading)}</h1>${reportHtmlBody(x.rep)}</div>`).join('');
  return exportPdf(meta, [], [], `${intro ? `<p>${esc(intro)}</p>` : ''}${body}`);
}

/** Several reports in one Excel sheet, each table under its section heading */
export function reportExcelSections(sections: { heading: string; rep: Report }[], meta: ReportMeta) {
  const n = Math.max(3, ...sections.flatMap((x) => x.rep.tables.map((t) => t.head.length)));
  const cols = Array.from({ length: n }, (_, i) => ({ header: '', value: (r: string[]) => r[i] ?? '', width: i ? 18 : 40 }));
  const out = sections.flatMap((x) => [
    ...(x.rep.tiles.length ? [{ heading: `${x.heading} – summary`, rows: x.rep.tiles.map((t) => [t.label, t.value, t.sub ?? '']) }] : []),
    ...x.rep.tables.map((t) => ({ heading: `${x.heading} – ${t.title ?? 'table'}`, rows: [t.head.map((h) => h.h), ...t.rows.map((r) => r.cells.map(cellText))] })),
  ]);
  return exportExcel(meta, cols, out);
}

/** The report's tiles and tables in one Excel sheet */
export function reportExcel(rep: Report, meta: ReportMeta) {
  const n = Math.max(2, ...rep.tables.map((t) => t.head.length));
  const cols = Array.from({ length: n }, (_, i) => ({ header: '', value: (r: string[]) => r[i] ?? '', width: i ? 18 : 40 }));
  const sections = [
    ...(rep.tiles.length ? [{ heading: 'Summary', rows: rep.tiles.map((t) => [t.label, t.value, t.sub ?? '']) }] : []),
    ...rep.tables.map((t) => ({ heading: t.title ?? meta.title, rows: [t.head.map((h) => h.h), ...t.rows.map((r) => r.cells.map(cellText))] })),
  ];
  return exportExcel(meta, cols, sections);
}
