import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { PERIOD_LABEL } from '@/components/ProcessReport';
import { Button, Card, colors, ErrorBanner, Grid, Loading, Muted, Pill, Row, Screen, Section, Segmented, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { monthsAgo, todayIso, type FoOrder, type Handover, type Step, type StepDef } from '@/lib/foreignOrders';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import type { LoOrder, LoRequest, LoStep, LoStepDef } from '@/lib/localOrders';
import { exportNodeReport, pdfMonth, trendRows, type PdfCell } from '@/lib/nodeReportPdf';
import { foreignItems, localItems, nodeFill, nodeInfo, nodeReport, NODES, type NodeItem, type NodeKey, type NodeLine } from '@/lib/orderNodes';
import { ROLE_LABELS } from '@/lib/roles';
import { supabase } from '@/lib/supabase';

type Kind = 'both' | 'import' | 'local';
type Period = '3' | '6' | '12' | 'all';

const Dot = ({ k, size = 10 }: { k: NodeKey | 'finx'; size?: number }) => <View style={[{ width: size, height: size, borderRadius: 3 }, nodeFill(k)]} />;
const NodeName = ({ k, est }: { k: NodeKey | 'finx'; est?: 'end' | 'start' }) => (
  <Row gap={6} style={{ alignItems: 'center' }}>
    <Dot k={est ? 'finx' : k} />
    <Text style={{ color: colors.text }}>{k === 'finx' ? 'Finance – start or end not seen' : nodeInfo(k).name}{est ? ' (not seen)' : ''}</Text>
  </Row>
);
const waitingFor = (l: NodeLine) => (l.est === 'end' ? `Finance: ${l.via} – we see it only when “${l.label}” is done` : l.label);
const INTRO = 'Where import and local orders spend their time. Each step recorded in Foreign and Local orders belongs to the team that does it; its working days (from the step it follows) count for that node. Finance is hidden – we only see an order go in (the TT / LC / payment request) and come out (TT sent, LC opened, advance or duty paid), so the time in between shows as one block. When the Finance step itself was not recorded, the time until the next step we saw still counts as Finance, marked “not seen”.';
const NOT_SEEN = 'Finance not seen – when the TT / LC step was not recorded, Finance\'s work only shows when the next step happens (Procurement shares the TT or LC with the manufacturer, or the manufacturer accepts the LC). That whole gap counts as Finance, but it also holds the next team\'s hand-on, so it is shown apart and never mixed into Procurement or the manufacturer.';
const KIND_LABEL: Record<Kind, string> = { both: 'Import + local orders', import: 'Import orders', local: 'Local orders' };
const pk = (k: NodeKey | 'finx') => (k === 'finx' ? 'fin~' : k);
const stepText = (l: NodeLine) => (l.est === 'end' ? `${l.label} – counted as Finance (${l.via} not seen)` : l.est === 'start' ? `${l.label} – timed from before the hand-over (${l.via} not seen)` : l.label);
const d1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });

/** Node report: where import and local orders spend their time – Lighting Dept, Director, FBP, Procurement, Finance (hidden), Logistics and outside parties */
export default function OrderNodes() {
  const [kind, setKind] = useState<Kind>('both');
  const [period, setPeriod] = useState<Period>('3');
  const [pick, setPick] = useState<string | null>(null);
  const dialog = useDialog();
  const me = useMe();
  const { data, error } = useLoad(async () => {
    const [h, o, s, d, r, lo, ls, ld, rv, ov, hol] = await Promise.all([
      supabase.from('fo_handovers').select('*'),
      supabase.from('fo_orders').select('*'),
      supabase.from('fo_steps').select('*'),
      supabase.from('fo_step_defs').select('*').order('seq'),
      supabase.from('lo_requests').select('*'),
      supabase.from('lo_orders').select('*'),
      supabase.from('lo_steps').select('*'),
      supabase.from('lo_step_defs').select('*').order('seq'),
      supabase.from('lo_request_values').select('request_id, pr_value'),
      supabase.from('lo_order_values').select('order_id, value'),
      supabase.from('holidays').select('day'),
    ]);
    const err = [h, o, s, d, r, lo, ls, ld].find((x) => x.error)?.error;
    if (err) throw new Error(err.message);
    const holidays = new Set(((hol.data ?? []) as { day: string }[]).map((x) => x.day));
    const fi = foreignItems((h.data ?? []) as Handover[], (o.data ?? []) as FoOrder[], (s.data ?? []) as Step[], (d.data ?? []) as StepDef[], holidays);
    const li = localItems(
      (r.data ?? []) as LoRequest[],
      (lo.data ?? []) as LoOrder[],
      (ls.data ?? []) as LoStep[],
      (ld.data ?? []) as LoStepDef[],
      Object.fromEntries(((rv.data ?? []) as { request_id: string; pr_value: number | null }[]).map((x) => [x.request_id, x.pr_value])),
      Object.fromEntries(((ov.data ?? []) as { order_id: string; value: number | null }[]).map((x) => [x.order_id, x.value])),
      holidays,
    );
    return [...fi, ...li];
  }, []);
  const items = useMemo(() => (data ?? []).filter((it) => kind === 'both' || it.kind === kind), [data, kind]);
  const today = todayIso();
  const from = period === 'all' ? '0000' : monthsAgo(Number(period));
  const rep = useMemo(() => nodeReport(items, from, today), [items, from, today]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const openCount = items.filter((it) => it.open).length;
  const chosen = items.find((it) => it.key === pick) ?? rep.waiting[0]?.it ?? null;
  const maxBar = Math.max(1, ...rep.bars.map((b) => b.total));
  const maxBin = Math.max(1, ...rep.finance.bins.map((b) => b.n + b.m));
  const pdf = () => {
    const nn = (k: NodeKey, est?: 'end' | 'start'): PdfCell => ({ node: est ? 'fin~' : k, text: `${nodeInfo(k).name}${est ? ' (not seen)' : ''}` });
    return exportNodeReport({
      key: 'node_report_orders',
      title: 'Orders node report',
      intro: INTRO,
      filters: KIND_LABEL[kind],
      period: `${PERIOD_LABEL[period]} (steps done ${period === 'all' ? 'at any time' : `from ${fmtDate(from)}`}) · as of ${fmtDate(today)}`,
      generatedBy: `${me.full_name} – ${ROLE_LABELS[me.role]}`,
      nodes: NODES,
      cardsTitle: `Where the orders are now · ${openCount} open`,
      cards: rep.nodes.map((n) => ({
        key: n.key,
        name: n.name,
        holding: n.holding,
        lines: ['orders holding now', `Avg ${n.orders ? d1(n.avg) : '—'} days an order`, `On time ${n.onTime == null ? '— (no SLA)' : `${Math.round(n.onTime * 100)} %`}`, `Oldest waiting ${n.holding ? `${n.oldest} d` : '—'}`],
        warn: n.key === 'fin' && n.est ? `${n.est} of ${n.passesN} passes not seen exactly` : undefined,
        who: n.who,
      })),
      legend: [
        { node: 'fin', text: 'Hidden node – the days between going in and coming out are one block. An order with two steps open at once counts at both nodes.' },
        { node: 'fin~', text: NOT_SEEN },
      ],
      barsTitle: 'Average working days per order, by node',
      bars: rep.bars.map((b) => ({ cat: b.cat, note: b.orders ? `${b.orders} order${b.orders > 1 ? 's' : ''} · ${d1(b.total)} days` : 'no steps in this period', parts: b.parts.map((x) => ({ key: pk(x.node), days: x.days })), total: b.total })),
      hidden: {
        title: 'Inside Finance (hidden)',
        node: 'fin',
        lines: [
          { text: 'Goes in: the TT / LC application or payment request sent to Finance. Comes out: TT sent, draft LC or LC opened, advance or duty paid.' },
          { text: `${rep.finance.passes} passes in this period · ${rep.finance.over} over SLA · ${rep.finance.open} with Finance now` },
          { node: 'fin', text: `Seen going in and out: ${rep.finance.exact.n} · median ${d1(rep.finance.exact.median)} d` },
          { node: 'fin~', text: `Start or end not seen: ${rep.finance.guess.n} · median ${d1(rep.finance.guess.median)} d (includes the next or previous team's hand-on)` },
        ],
        bins: rep.finance.bins,
        binsLabel: 'Working days inside Finance',
        labels: rep.finance.steps.map((s) => `${s.label}: median ${d1(s.median)} d (${s.n})`),
      },
      tables: [
        {
          title: `Waiting longest – who to chase (${rep.waiting.length})`,
          head: ['Order', 'Category', 'Project', 'With', 'Since', 'Days', 'SLA', 'Last step we saw', 'Waiting for'],
          right: [5, 6],
          rows: rep.waiting.map((r) => [r.it.code, r.it.cat, r.it.project, nn(r.l.node, r.l.est), fmtDate(r.l.start), r.l.days ?? '—', r.l.sla ?? '—', r.last ? `${r.last.label} (${fmtDate(r.last.end)})` : '—', waitingFor(r.l)]),
          late: rep.waiting.map((r) => r.l.late),
          note: 'Red: over the step\'s SLA.',
          empty: 'Nothing open.',
        },
        { title: 'Average working days per step, month by month', head: ['Node', ...rep.months.map(pdfMonth), 'Change'], right: [1, 2, 3, 4, 5, 6, 7], rows: trendRows(rep.trend) },
        ...(chosen
          ? [{
              title: `One order through the nodes: ${chosen.code} · ${chosen.title}`,
              head: ['Done', 'Node', 'Step', 'Who', 'Days', 'SLA'],
              right: [4, 5],
              rows: [...chosen.lines].sort((x, y) => ((x.end ?? '9999') < (y.end ?? '9999') ? -1 : 1)).map((l): PdfCell[] => [l.end ? fmtDate(l.end) : 'open', nn(l.node, l.est), stepText(l), l.owner, l.days == null ? '—' : `${l.days}${l.open ? '+' : ''}`, l.sla ?? '—']),
              late: chosen.lines.map((l) => l.late),
            }]
          : []),
      ],
    });
  };

  return (
    <Screen maxWidth={1300}>
      <Stack.Screen options={{ title: 'Node report' }} />
      <Muted>{INTRO}</Muted>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Segmented value={kind} onChange={setKind} options={[{ value: 'both', label: 'Import + local' }, { value: 'import', label: 'Import orders' }, { value: 'local', label: 'Local orders' }]} />
        <Row gap={8} style={{ alignItems: 'center' }}>
          <Segmented value={period} onChange={setPeriod} options={[{ value: '3', label: '3 months' }, { value: '6', label: '6 months' }, { value: '12', label: '12 months' }, { value: 'all', label: 'All' }]} />
          <Button variant="secondary" small title="Export PDF" onPress={() => dialog.run(pdf)} />
        </Row>
      </Row>

      <Section title={`Where the orders are now · ${openCount} open`}>
        <Grid min={150} max={7}>
          {rep.nodes.map((n) => (
            <Card key={n.key} style={[{ borderTopWidth: 4, borderTopColor: n.colour, gap: 4 }, n.hidden ? { backgroundColor: colors.soft } : null]}>
              <Row gap={6} style={{ alignItems: 'center' }}>
                <Dot k={n.key} />
                <Text style={{ fontWeight: '700', color: colors.ink }}>{n.name}</Text>
              </Row>
              <Text style={{ fontSize: 28, fontWeight: '700', color: colors.ink }}>{n.holding}</Text>
              <Muted>orders holding now</Muted>
              <Text style={{ color: colors.text, fontSize: 13 }}>Avg {n.orders ? d1(n.avg) : '—'} days an order</Text>
              <Text style={{ color: n.onTime == null ? colors.muted : n.onTime < 0.65 ? colors.red : colors.green, fontSize: 13 }}>On time {n.onTime == null ? '— (no SLA)' : `${Math.round(n.onTime * 100)} %`}</Text>
              <Text style={{ color: colors.text, fontSize: 13 }}>Oldest waiting {n.holding ? `${n.oldest} d` : '—'}</Text>
              {n.key === 'fin' && n.est ? <Text style={{ color: colors.amber, fontSize: 12 }}>{n.est} of {n.passesN} passes not seen exactly – see below</Text> : null}
              <Muted style={{ fontSize: 11 }}>{n.who}</Muted>
            </Card>
          ))}
        </Grid>
        <Row gap={8} style={{ alignItems: 'center' }}>
          <View style={[{ width: 22, height: 12, borderRadius: 3 }, nodeFill('fin')]} />
          <Muted>Hidden node – the days between going in and coming out are one block. An order with two steps open at once counts at both nodes.</Muted>
        </Row>
        <Row gap={8} style={{ alignItems: 'center' }}>
          <View style={[{ width: 22, height: 12, borderRadius: 3 }, nodeFill('finx')]} />
          <Muted>{NOT_SEEN}</Muted>
        </Row>
      </Section>

      <Row wrap gap={12} style={{ alignItems: 'flex-start' }}>
        <View style={{ flexGrow: 3, flexBasis: 560, minWidth: 0 }}>
          <Section title="Average working days per order, by node">
            <Card style={{ gap: 12 }}>
              {rep.bars.map((b) => (
                <View key={b.cat} style={{ gap: 4 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={{ fontWeight: '700', color: colors.ink }}>{b.cat}</Text>
                    <Muted>{b.orders ? `${b.orders} order${b.orders > 1 ? 's' : ''} · ${d1(b.total)} days` : 'no steps in this period'}</Muted>
                  </Row>
                  <View style={{ flexDirection: 'row', height: 24, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.bg, width: `${Math.max(2, (b.total / maxBar) * 100)}%` }}>
                    {b.parts.filter((p) => p.days > 0).map((p) => (
                      <View key={p.node} style={[{ flexGrow: p.days, flexBasis: 0, justifyContent: 'center', alignItems: 'center' }, nodeFill(p.node)]}>
                        {p.days / (b.total || 1) > 0.08 ? <Text style={{ fontSize: 11, fontWeight: '700', color: p.node === 'fin' || p.node === 'finx' ? colors.ink : '#fff' }}>{d1(p.days)}</Text> : null}
                      </View>
                    ))}
                  </View>
                </View>
              ))}
              <Row wrap gap={12}>
                {NODES.map((n) => <NodeName key={n.key} k={n.key} />)}
                <NodeName k="finx" />
              </Row>
            </Card>
          </Section>
        </View>
        <View style={{ flexGrow: 2, flexBasis: 360, minWidth: 0 }}>
          <Section title="Inside Finance (hidden)">
            <Card style={{ gap: 10 }}>
              <Muted>Goes in: the TT / LC application or payment request sent to Finance. Comes out: TT sent, draft LC or LC opened, advance or duty paid.</Muted>
              <Text style={{ color: colors.text }}>{rep.finance.passes} passes in this period · {rep.finance.over} over SLA · {rep.finance.open} with Finance now</Text>
              <Row gap={6} style={{ alignItems: 'center' }}><Dot k="fin" /><Text style={{ color: colors.text, fontSize: 13 }}>Seen going in and out: {rep.finance.exact.n} · median {d1(rep.finance.exact.median)} d</Text></Row>
              <Row gap={6} style={{ alignItems: 'center' }}><Dot k="finx" /><Text style={{ color: colors.text, fontSize: 13 }}>Start or end not seen: {rep.finance.guess.n} · median {d1(rep.finance.guess.median)} d (includes the next or previous team&apos;s hand-on)</Text></Row>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 110, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                {rep.finance.bins.map((b) => (
                  <View key={b.label} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                    <Text style={{ fontSize: 11, color: colors.text }}>{b.n + b.m}</Text>
                    {b.m ? <View style={[{ width: '100%', height: (b.m / maxBin) * 84, borderTopLeftRadius: 4, borderTopRightRadius: 4 }, nodeFill('finx')]} /> : null}
                    <View style={[{ width: '100%', height: Math.max(2, (b.n / maxBin) * 84) }, b.m ? null : { borderTopLeftRadius: 4, borderTopRightRadius: 4 }, nodeFill('fin')]} />
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {rep.finance.bins.map((b) => <Text key={b.label} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: colors.muted }}>{b.label}</Text>)}
              </View>
              <Muted>Working days inside Finance</Muted>
              {rep.finance.steps.map((s) => <Text key={s.label} style={{ fontSize: 13, color: s.est ? colors.muted : colors.text }}>{s.label}: median {d1(s.median)} d ({s.n})</Text>)}
            </Card>
          </Section>
        </View>
      </Row>

      <Section title="Waiting longest – who to chase">
        <DataTable
          rows={rep.waiting.slice(0, 30)}
          keyOf={(r, i) => r.it.key + i}
          onPress={(r) => setPick(r.it.key)}
          edge={(r) => (r.l.late ? colors.red : undefined)}
          emptyTitle="Nothing open"
          columns={[
            { h: 'Order', w: 170, v: (r) => <View><Text style={{ fontWeight: '700', color: colors.ink }}>{r.it.code}</Text><Muted>{r.it.cat}</Muted></View> },
            { h: 'Project', w: 200, grow: true, v: (r) => r.it.project },
            { h: 'With', w: 170, v: (r) => <NodeName k={r.l.node} est={r.l.est} /> },
            { h: 'Since', w: 100, v: (r) => fmtDate(r.l.start) },
            { h: 'Days', w: 60, right: true, bold: true, tone: (r) => (r.l.late ? colors.red : undefined), v: (r) => String(r.l.days ?? '—') },
            { h: 'SLA', w: 60, right: true, v: (r) => (r.l.sla != null ? String(r.l.sla) : '—') },
            { h: 'Last step we saw', w: 240, v: (r) => (r.last ? `${r.last.label} (${fmtDate(r.last.end)})` : '—') },
            { h: 'Waiting for', w: 280, v: (r) => waitingFor(r.l) },
          ]}
        />
      </Section>

      <Section title="Average working days per step, month by month">
        <DataTable
          rows={rep.trend}
          keyOf={(r) => r.key}
          columns={[
            { h: 'Node', w: 170, grow: true, v: (r) => <NodeName k={r.key} /> },
            ...rep.months.map((m, i) => ({ h: monthName(m), w: 70, right: true, bold: i === 5, v: (r: (typeof rep.trend)[number]) => (r.vals[i] == null ? '—' : d1(r.vals[i]!)) })),
            {
              h: 'Change',
              w: 90,
              right: true,
              v: (r) => {
                const a = r.vals.find((x) => x != null), b = [...r.vals].reverse().find((x) => x != null);
                if (a == null || b == null) return '—';
                const ch = b - a;
                return <Text style={{ fontWeight: '700', color: ch > 0.05 ? colors.red : ch < -0.05 ? colors.green : colors.muted }}>{`${ch > 0 ? '+' : ''}${d1(ch)} d`}</Text>;
              },
            },
          ]}
        />
      </Section>

      <Section title="One order through the nodes">
        <Select label="Order" searchable value={chosen?.key ?? null} onChange={setPick} options={items.map((it) => ({ value: it.key, label: `${it.code} · ${it.title} · ${it.project}` }))} />
        {chosen ? <Timeline it={chosen} today={today} /> : <Muted>Pick an order.</Muted>}
      </Section>
    </Screen>
  );
}

function Timeline({ it, today }: { it: NodeItem; today: string }) {
  const ls = it.lines.filter((l) => l.start || l.end);
  const t = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
  const starts = ls.map((l) => l.start ?? l.end!).filter(Boolean);
  const ends = ls.map((l) => l.end ?? today);
  if (!starts.length) return <Muted>No steps with dates yet.</Muted>;
  const a = Math.min(...starts.map(t)), b = Math.max(t(today), ...ends.map(t));
  const span = Math.max(1, b - a);
  const total = (k: NodeKey) => ls.filter((l) => l.node === k).reduce((s, l) => s + (l.days ?? 0), 0);
  const steps = [...it.lines].sort((x, y) => ((x.end ?? '9999') < (y.end ?? '9999') ? -1 : 1));
  return (
    <View style={{ gap: 10 }}>
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>{it.code} · {it.title}</Text>
        <Pill label={it.cat} />
        <Pressable onPress={() => router.push(it.href as never)} accessibilityRole="link"><Text style={{ color: colors.brand, fontWeight: '600' }}>Open the order</Text></Pressable>
      </Row>
      <Card style={{ gap: 6 }}>
        <Row style={{ justifyContent: 'space-between', marginLeft: 150, marginRight: 70 }}>
          <Muted>{fmtDate(new Date(a).toISOString().slice(0, 10))}</Muted>
          <Muted>{fmtDate(new Date(b).toISOString().slice(0, 10))}</Muted>
        </Row>
        {NODES.map((n) => (
          <Row key={n.key} gap={10} style={{ alignItems: 'center' }}>
            <View style={{ width: 140 }}><NodeName k={n.key} /></View>
            <View style={{ flex: 1, height: 26, backgroundColor: colors.bg, borderRadius: 5 }}>
              {ls.filter((l) => l.node === n.key).map((l, i) => {
                const s = t(l.start ?? l.end!), e = t(l.end ?? today);
                return <View key={i} style={[{ position: 'absolute', top: 4, bottom: 4, borderRadius: 4, left: `${((s - a) / span) * 100}%`, width: `${Math.max(0.8, ((e - s) / span) * 100)}%`, opacity: l.open ? 0.75 : 1 }, nodeFill(l.est ? 'finx' : n.key)]} />;
              })}
            </View>
            <Text style={{ width: 60, textAlign: 'right', fontWeight: '700', color: colors.ink }}>{total(n.key) || '—'}</Text>
          </Row>
        ))}
        <Muted>Days are working days per node. Faded bars are still open. Finance is striped: only going in and coming out are visible. Light stripes: Finance time whose start or end we did not see.</Muted>
      </Card>
      <DataTable
        rows={steps}
        keyOf={(l, i) => l.label + i}
        edge={(l) => (l.late ? colors.red : undefined)}
        columns={[
          { h: 'Done', w: 100, v: (l) => (l.end ? fmtDate(l.end) : 'open') },
          { h: 'Node', w: 170, v: (l) => <NodeName k={l.node} est={l.est} /> },
          { h: 'Step', w: 320, grow: true, v: (l) => (l.est === 'end' ? `${l.label} – counted as Finance (${l.via} not seen)` : l.est === 'start' ? `${l.label} – timed from before the hand-over (${l.via} not seen)` : l.label) },
          { h: 'Who', w: 140, v: (l) => l.owner },
          { h: 'Days', w: 60, right: true, bold: true, tone: (l) => (l.late ? colors.red : undefined), v: (l) => (l.days == null ? '—' : `${l.days}${l.open ? '+' : ''}`) },
          { h: 'SLA', w: 60, right: true, v: (l) => (l.sla != null ? String(l.sla) : '—') },
        ]}
      />
    </View>
  );
}
