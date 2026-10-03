import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { Button, Card, colors, Empty, ErrorBanner, Grid, Loading, Muted, Notice, Pill, Progress, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import {
  findLine,
  fmtMonth,
  fmtPct,
  isFinanceDesk,
  isIncomeLine,
  mn,
  pct,
  pnlGroups,
  seesPnl,
  type BudgetProject,
  type OrUpload,
  type PnlLine,
  type SecuredProject,
  type WbsActual,
} from '@/lib/finance';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Col = { k: 'm_act' | 'm_bud' | 'c_act' | 'c_bud' | 'var' | 'ly_cum' | 'fy_bp'; h: string };
const COLS: Col[] = [
  { k: 'm_act', h: 'Month act' },
  { k: 'm_bud', h: 'Month bud' },
  { k: 'c_act', h: 'YTD act' },
  { k: 'c_bud', h: 'YTD bud' },
  { k: 'var', h: 'Var YTD' },
  { k: 'ly_cum', h: 'Last yr YTD' },
  { k: 'fy_bp', h: 'FY BP' },
];

// Business health indicators from the same file (balance items: YTD column = end of month)
const HEALTH: { label: string; title: string; first?: boolean; abs?: boolean; days?: boolean; count?: boolean; lowerBetter?: boolean }[] = [
  { label: 'LOCAL DEBTORS AT END', title: 'Local debtors at end', lowerBetter: true },
  { label: 'Collections', title: 'Collections (local) · YTD', first: true, abs: true },
  { label: 'Trade Debtors - Over 60 Days', title: 'Trade debtors over 60 days', lowerBetter: true },
  { label: 'Debtors Collection Period (Days)', title: 'Debtor collection days', days: true, lowerBetter: true },
  { label: 'STOCK AT END', title: 'Stock at end', lowerBetter: true },
  { label: 'Stocks - Over 180 Days', title: 'Stock over 180 days', lowerBetter: true },
  { label: 'Stock Residency Period (Days)', title: 'Stock days', days: true, lowerBetter: true },
  { label: 'WIP- CLOSING', title: 'WIP closing' },
  { label: 'FOREIGN /LOCAL CREDITORS AT END', title: 'Creditors at end' },
  { label: 'CAPITAL EMPLOYED', title: 'Capital employed', lowerBetter: true },
  { label: 'MANPOWER AT END', title: 'Manpower', count: true },
  { label: 'Turnover per Employee', title: 'Turnover per employee · YTD' },
  { label: 'Net Profit Per Employee', title: 'Net profit per employee · YTD' },
  { label: 'Break-Even Turnover', title: 'Break-even turnover · YTD', lowerBetter: true },
];

/** P&L from the monthly OR file – GM / DGM, SM Projects and SM Estimation. */
export default function PnlScreen() {
  const me = useMe();
  const people = usePeople();
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const { data, error } = useLoad(async () => {
    const { data: ups, error: e } = await supabase.from('or_uploads').select('*').order('month', { ascending: false });
    if (e) throw new Error(e.message);
    const uploads = (ups ?? []) as OrUpload[];
    const u = uploads.find((x) => x.id === uploadId) ?? uploads[0];
    if (!u) return { uploads, upload: null, lines: [] as PnlLine[], wbs: [] as WbsActual[], wbsYtd: [] as WbsActual[], secured: [] as SecuredProject[], budget: [] as BudgetProject[] };
    const fyUploads = uploads.filter((x) => x.fy === u.fy && x.month <= u.month).map((x) => x.id);
    const [l, w, s, b] = await Promise.all([
      supabase.from('pnl_lines').select('*').eq('upload_id', u.id).order('seq'),
      supabase.from('wbs_actuals').select('*').in('upload_id', fyUploads),
      supabase.from('secured_projects').select('*'),
      supabase.from('budget_projects').select('*').eq('fy', u.fy),
    ]);
    const all = (w.data ?? []) as WbsActual[];
    return {
      uploads,
      upload: u,
      lines: (l.data ?? []) as PnlLine[],
      wbs: all.filter((x) => x.upload_id === u.id),
      wbsYtd: all,
      secured: (s.data ?? []) as SecuredProject[],
      budget: (b.data ?? []) as BudgetProject[],
    };
  }, [uploadId]);

  if (!seesPnl(me.role)) {
    return (
      <Screen>
        <Notice>The P&L is for GM / DGM, SM Projects and SM Estimation.</Notice>
      </Screen>
    );
  }
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { upload, lines } = data;
  if (!upload) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'P&L' }} />
        <Empty
          title="No OR file loaded yet"
          hint="Operations uploads Finance’s OR Excel each month."
          action={isFinanceDesk(me.role) ? <Button title="Upload OR file" onPress={() => router.push('/finance/upload')} /> : undefined}
        />
      </Screen>
    );
  }

  const L = (label: string) => findLine(lines, label, 'pnl');
  const turnover = L('Total Turnover') ?? L('Gross Proceeds from Sales');
  const gp = L('Gross Profit');
  const op = L('Operating Profit 01');
  const np = L('Net Profit');
  const n = (v: number | null | undefined) => Number(v ?? 0);
  const groups = pnlGroups(lines);
  const value = (l: PnlLine, k: Col['k']) => (k === 'var' ? n(l.c_act) - n(l.c_bud) : l[k]);
  // Positive variance = better for profit
  const impact = (l: PnlLine) => (isIncomeLine(l.label) ? 1 : -1) * (n(l.c_act) - n(l.c_bud));
  const watch = lines
    .filter((l) => l.section === 'pnl' && l.rank)
    .map((l) => ({ l, impact: impact(l) }))
    .filter((x) => x.impact < 0)
    .sort((a, b) => a.impact - b.impact)
    .slice(0, 5);

  // Project P&L by WBS: month and year to date
  const nameOf = (w: string) => data.secured.find((s) => s.wbs === w) ?? null;
  const budgetOf = (w: string, s: SecuredProject | null) => data.budget.find((b) => b.wbs === w || (s?.budget_id && b.id === s.budget_id)) ?? null;
  const ytdOf = (w: string) => data.wbsYtd.filter((x) => x.wbs === w);
  const projRows = [...new Set(data.wbsYtd.map((x) => x.wbs))]
    .map((w) => {
      const m = data.wbs.find((x) => x.wbs === w);
      const y = ytdOf(w);
      const s = nameOf(w);
      return {
        wbs: w,
        s,
        b: budgetOf(w, s),
        mRev: n(m?.revenue),
        mCost: n(m?.cost),
        yRev: y.reduce((a, x) => a + n(x.revenue), 0),
        yCost: y.reduce((a, x) => a + n(x.cost), 0),
      };
    })
    .filter((r) => r.yRev !== 0)
    .sort((a, b) => b.mRev - a.mRev || b.yRev - a.yRev);
  const costOnly = [...new Set(data.wbsYtd.map((x) => x.wbs))].filter((w) => !projRows.some((r) => r.wbs === w)).length;

  const tile = (title: string, act: number, bud: number, sub: string, profit = false) => {
    const p = pct(act, bud);
    const good = profit ? act >= bud : p >= 90;
    return (
      <Card>
        <Text style={{ fontSize: 11.5, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</Text>
        <Text style={{ fontSize: 22, fontWeight: '700', color: act < 0 ? colors.red : colors.ink }}>{mn(act)} Mn</Text>
        {!profit ? <Progress pct={p} colour={good ? colors.green : p >= 60 ? colors.amber : colors.red} /> : null}
        <Muted>{sub}</Muted>
      </Card>
    );
  };

  return (
    <Screen maxWidth={1200}>
      <Stack.Screen options={{ title: 'P&L' }} />
      <Row wrap gap={8} style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ width: 240, maxWidth: '100%' }}>
          <Select label="Month" value={upload.id} onChange={setUploadId} options={data.uploads.map((u) => ({ value: u.id, label: fmtMonth(u.month) }))} />
        </View>
        <Row gap={8} wrap>
          <Pill label={`From OR file · ${upload.file_name ?? ''}`} tone={colors.green} />
          {isFinanceDesk(me.role) ? <Button small variant="secondary" title="Upload OR file" onPress={() => router.push('/finance/upload')} /> : null}
        </Row>
      </Row>

      <Grid min={220}>
        {tile(`Turnover · ${fmtMonth(upload.month)}`, n(turnover?.m_act), n(turnover?.m_bud), `Budget ${mn(turnover?.m_bud)} · ${fmtPct(pct(n(turnover?.m_act), n(turnover?.m_bud)))}`)}
        {tile('Turnover · YTD', n(turnover?.c_act), n(turnover?.c_bud), `Budget ${mn(turnover?.c_bud)} · ${fmtPct(pct(n(turnover?.c_act), n(turnover?.c_bud)))} · last yr ${mn(turnover?.ly_cum)} · FY plan ${mn(turnover?.fy_bp)}`)}
        {tile('Gross profit · YTD', n(gp?.c_act), n(gp?.c_bud), `GP ${fmtPct(pct(n(gp?.c_act), n(turnover?.c_act)), 1)} vs budget ${fmtPct(pct(n(gp?.c_bud), n(turnover?.c_bud)), 1)} · month ${mn(gp?.m_act)}`)}
        {tile('Operating profit 01 · YTD', n(op?.c_act), n(op?.c_bud), `Budget ${mn(op?.c_bud)} · last yr ${mn(op?.ly_cum)}`, true)}
        {tile('Net profit · YTD', n(np?.c_act), n(np?.c_bud), `Budget ${mn(np?.c_bud)} · last yr ${mn(np?.ly_cum)} · month ${mn(np?.m_act)}`, true)}
      </Grid>

      <Section title="P&L (LKR Mn) – tap a line for its detail">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <ScrollView horizontal>
            <View>
              <Row gap={0} style={{ backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <Text style={[cell, { width: 290, fontWeight: '700', color: colors.muted }]}>Line</Text>
                {COLS.map((c) => (
                  <Text key={c.k} style={[cell, { width: 96, textAlign: 'right', fontWeight: '700', color: colors.muted }]}>
                    {c.h}
                  </Text>
                ))}
              </Row>
              {groups.map((g) => (
                <View key={g.total.seq}>
                  <Pressable onPress={() => setOpen((o) => ({ ...o, [g.total.seq]: !o[g.total.seq] }))}>
                    <Row gap={0} style={{ backgroundColor: colors.soft, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                      <Text style={[cell, { width: 290, fontWeight: '700', color: colors.ink }]}>
                        {g.detail.length ? (open[g.total.seq] ? '▾ ' : '▸ ') : '   '}
                        {g.total.label}
                      </Text>
                      {COLS.map((c) => {
                        const v = value(g.total, c.k);
                        const bad = c.k === 'var' && impact(g.total) < 0;
                        return (
                          <Text key={c.k} style={[cell, num, { width: 96, fontWeight: '700' }, bad ? { color: colors.red } : c.k === 'var' ? { color: colors.green } : n(v) < 0 ? { color: colors.red } : null]}>
                            {mn(v)}
                          </Text>
                        );
                      })}
                    </Row>
                  </Pressable>
                  {open[g.total.seq]
                    ? g.detail.map((d) => (
                        <Row key={d.seq} gap={0} style={{ borderBottomWidth: 1, borderBottomColor: colors.line }}>
                          <Text style={[cell, { width: 290, paddingLeft: 24 }]}>{d.label}</Text>
                          {COLS.map((c) => {
                            const v = value(d, c.k);
                            const bad = c.k === 'var' && impact(d) < 0;
                            return (
                              <Text key={c.k} style={[cell, num, { width: 96 }, bad ? { color: colors.red } : null]}>
                                {mn(v)}
                              </Text>
                            );
                          })}
                        </Row>
                      ))
                    : null}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
        <Muted>Var YTD = actual – budget; red = worse for profit. Last year = cumulative actual to the same month last year (from the file).</Muted>
      </Section>

      <Grid min={420}>
        <Section title="Business health">
          <DataTable
            rows={HEALTH.map((h) => ({ h, l: findLine(lines, h.label, undefined, h.first) })).filter((x) => x.l)}
            keyOf={(x) => x.h.label}
            columns={[
              { h: 'Indicator', w: 210, v: (x) => x.h.title },
              { h: 'Actual', w: 90, right: true, v: (x) => fmtH(x.l!.c_act, x.h), tone: (x) => (x.h.lowerBetter && n(x.l!.c_act) > n(x.l!.c_bud) ? colors.red : undefined) },
              { h: 'Budget', w: 90, right: true, v: (x) => fmtH(x.l!.c_bud, x.h) },
              { h: 'Last yr', w: 90, right: true, v: (x) => fmtH(x.l!.ly_cum, x.h) },
            ]}
          />
          <Muted>LKR Mn unless shown as days or people. Red = above budget where lower is better.</Muted>
        </Section>
        <Section title="Watch list – largest adverse items YTD">
          {watch.length ? (
            <DataTable
              rows={watch}
              keyOf={(x) => String(x.l.seq)}
              columns={[
                { h: 'Line', w: 220, v: (x) => x.l.label },
                { h: 'YTD act', w: 90, right: true, v: (x) => mn(x.l.c_act) },
                { h: 'YTD bud', w: 90, right: true, v: (x) => mn(x.l.c_bud) },
                { h: 'Worse by', w: 90, right: true, v: (x) => mn(-x.impact), tone: () => colors.red },
              ]}
            />
          ) : (
            <Card>
              <Muted>No line is worse than budget.</Muted>
            </Card>
          )}
        </Section>
      </Grid>

      <Section title={`Project P&L · invoicing and cost booked on the WBS`}>
        <DataTable
          rows={projRows}
          keyOf={(r) => r.wbs}
          onPress={(r) => (r.s ? router.push(`/finance/secured/${r.s.id}`) : undefined)}
          emptyTitle="No invoicing on WBS codes"
          columns={[
            { h: 'WBS', w: 100, v: (r) => r.wbs, bold: true },
            { h: 'Project', w: 230, v: (r) => (r.s ? r.s.project_name : <Pill label="Not linked" />) },
            { h: 'Sales person', w: 150, v: (r) => (r.s ? people[r.s.sales_person_id ?? '']?.full_name ?? '—' : '—') },
            { h: 'Invoiced (month)', w: 120, right: true, v: (r) => mn(r.mRev, 2) },
            { h: 'Cost (month)', w: 110, right: true, v: (r) => mn(r.mCost, 2) },
            { h: 'Invoiced YTD', w: 110, right: true, v: (r) => mn(r.yRev, 2) },
            { h: 'Cost YTD', w: 100, right: true, v: (r) => mn(r.yCost, 2) },
            { h: 'GP YTD', w: 100, right: true, v: (r) => mn(r.yRev - r.yCost, 2), tone: (r) => (r.yRev - r.yCost < 0 ? colors.red : undefined) },
            {
              h: 'GP %',
              w: 120,
              right: true,
              v: (r) => {
                const g = pct(r.yRev - r.yCost, r.yRev);
                return g > 60 ? (
                  <Row gap={4}>
                    <Text style={{ fontSize: 13 }}>{fmtPct(g, 1)}</Text>
                    <Pill label="check cost" tone={colors.amber} />
                  </Row>
                ) : (
                  fmtPct(g, 1)
                );
              },
            },
            { h: 'Budget GP %', w: 100, right: true, v: (r) => (r.b?.budget_gp_pct != null ? fmtPct(Number(r.b.budget_gp_pct), 1) : '—') },
          ]}
        />
        <Muted>
          Cost = everything booked on the WBS (WIP / RA cost, materials, SSCL). A very high GP % usually means cost is not booked yet. “Not linked” = the WBS is not on any
          secured project – Operations adds it on the project.{costOnly ? ` ${costOnly} WBS codes have cost but no invoicing this year.` : ''}
        </Muted>
      </Section>
    </Screen>
  );
}

function fmtH(v: number | null, h: { days?: boolean; count?: boolean; abs?: boolean }) {
  if (v == null) return '—';
  if (h.abs) v = Math.abs(v);
  if (h.days || h.count) return String(Math.round(v));
  return mn(v);
}

const cell = { paddingVertical: 7, paddingHorizontal: 8, fontSize: 13, color: colors.text } as const;
const num = { textAlign: 'right' as const, fontVariant: ['tabular-nums' as const] };
