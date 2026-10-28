import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { Card, colors, Grid, Muted, Pill, Row, Section, Segmented, Select } from '@/components/ui';
import { monthsAgo, todayIso } from '@/lib/foreignOrders';
import { fmtDate } from '@/lib/format';
import { processReport, type PItem, type PNode } from '@/lib/processNodes';

type Period = '3' | '6' | '12' | 'all';
const d1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });

/** Bar fill: a solid colour, striped for a hidden node, lighter stripes where its start or end was not seen */
export function fillOf(n: PNode | undefined, est?: boolean): object {
  const c = n?.colour ?? colors.grey;
  if (!n?.hidden) return { backgroundColor: c };
  if (Platform.OS !== 'web') return { backgroundColor: c, opacity: est ? 0.45 : 0.8 };
  return { backgroundImage: est ? `repeating-linear-gradient(135deg, ${c}88 0 3px, #EEF1F5 3px 8px)` : `repeating-linear-gradient(135deg, ${c} 0 4px, #CBD2DC 4px 8px)` };
}

const NDot = ({ nodes, k, est }: { nodes: PNode[]; k: string; est?: boolean }) => <View style={[{ width: 10, height: 10, borderRadius: 3 }, fillOf(nodes.find((n) => n.key === k), est)]} />;
const NName = ({ nodes, k, est }: { nodes: PNode[]; k: string; est?: boolean }) => (
  <Row gap={6} style={{ alignItems: 'center' }}>
    <NDot nodes={nodes} k={k} est={est} />
    <Text style={{ color: colors.text }}>{nodes.find((n) => n.key === k)?.name ?? k}{est ? ' (not seen)' : ''}</Text>
  </Row>
);

export type ProcessReportProps = {
  intro: string;
  nodes: PNode[];
  items: PItem[];
  cats: string[];
  hiddenKey: string;
  hidden: { title: string; goesIn: string; comesOut: string; unit: string; notSeen: string };
  bins: [string, number, number][];
  personLabel: string;
  personName: (id: string) => string;
  itemWord: string;
  holdingWord: string;
};

/** A node report: where the items are now, the days each node takes, the hidden node, people, who to chase, the trend, and one item through the nodes */
export function ProcessReport(p: ProcessReportProps) {
  const [cat, setCat] = useState('all');
  const [person, setPerson] = useState('all');
  const [period, setPeriod] = useState<Period>('3');
  const [pick, setPick] = useState<string | null>(null);
  const today = todayIso();
  const from = period === 'all' ? '0000' : monthsAgo(Number(period));
  const items = useMemo(() => p.items.filter((it) => (cat === 'all' || it.cat === cat) && (person === 'all' || it.person === person)), [p.items, cat, person]);
  const rep = useMemo(() => processReport(items, p.nodes, p.cats, p.hiddenKey, p.bins, from, today), [items, p.nodes, p.cats, p.hiddenKey, p.bins, from, today]);
  const node = (k: string) => p.nodes.find((n) => n.key === k);
  const hn = node(p.hiddenKey)!;
  const openCount = items.filter((it) => it.open).length;
  const maxBar = Math.max(1, ...rep.bars.map((b) => b.total));
  const maxBin = Math.max(1, ...rep.hidden.bins.map((b) => b.n + b.m));
  const people = [...new Set(p.items.map((it) => it.person).filter((x): x is string => !!x))];
  const chosen = items.find((it) => it.key === pick) ?? rep.waiting[0]?.it ?? null;
  const workNodes = p.nodes.filter((n) => !n.hidden);

  return (
    <>
      <Muted>{p.intro}</Muted>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Segmented value={cat} onChange={setCat} options={[{ value: 'all', label: 'All' }, ...p.cats.map((c) => ({ value: c, label: c }))]} />
        <Segmented value={period} onChange={setPeriod} options={[{ value: '3', label: '3 months' }, { value: '6', label: '6 months' }, { value: '12', label: '12 months' }, { value: 'all', label: 'All' }]} />
      </Row>
      {people.length > 1 ? (
        <View style={{ maxWidth: 360 }}>
          <Select label={p.personLabel} value={person} onChange={setPerson} options={[{ value: 'all', label: 'Everyone' }, ...people.map((x) => ({ value: x, label: p.personName(x) })).sort((a, b) => a.label.localeCompare(b.label))]} />
        </View>
      ) : null}

      <Section title={`Where the ${p.holdingWord} are now · ${openCount} open`}>
        <Grid min={150} max={7}>
          {rep.cards.map((n) => (
            <Card key={n.key} style={[{ borderTopWidth: 4, borderTopColor: n.colour, gap: 4 }, n.hidden ? { backgroundColor: colors.soft } : null]}>
              <Row gap={6} style={{ alignItems: 'center' }}>
                <NDot nodes={p.nodes} k={n.key} />
                <Text style={{ fontWeight: '700', color: colors.ink }}>{n.name}</Text>
              </Row>
              <Text style={{ fontSize: 28, fontWeight: '700', color: colors.ink }}>{n.holding}</Text>
              <Muted>holding now</Muted>
              <Text style={{ color: colors.text, fontSize: 13 }}>Avg {n.items ? d1(n.avg) : '—'} days each</Text>
              {n.work ? <Text style={{ color: n.onTime == null ? colors.muted : n.onTime < 0.7 ? colors.red : colors.green, fontSize: 13 }}>Released on time {n.onTime == null ? '—' : `${Math.round(n.onTime * 100)} %`}</Text> : null}
              <Text style={{ color: colors.text, fontSize: 13 }}>Oldest waiting {n.holding ? `${n.oldest} d` : '—'}</Text>
              {n.hidden && n.est ? <Text style={{ color: colors.amber, fontSize: 12 }}>{n.est} not seen exactly</Text> : null}
              <Muted style={{ fontSize: 11 }}>{n.who}</Muted>
            </Card>
          ))}
        </Grid>
        <Row gap={8} style={{ alignItems: 'center' }}>
          <View style={[{ width: 22, height: 12, borderRadius: 3 }, fillOf(hn)]} />
          <Muted>Hidden node – we see the {p.hidden.goesIn.toLowerCase()} and the {p.hidden.comesOut.toLowerCase()}, not the work in between; the days are one block.</Muted>
        </Row>
        <Row gap={8} style={{ alignItems: 'center' }}>
          <View style={[{ width: 22, height: 12, borderRadius: 3 }, fillOf(hn, true)]} />
          <Muted>{p.hidden.notSeen}</Muted>
        </Row>
      </Section>

      <Row wrap gap={12} style={{ alignItems: 'flex-start' }}>
        <View style={{ flexGrow: 3, flexBasis: 560, minWidth: 0 }}>
          <Section title={`Average working days per ${p.itemWord.toLowerCase()}, by node`}>
            <Card style={{ gap: 12 }}>
              {rep.bars.map((b) => (
                <View key={b.cat} style={{ gap: 4 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={{ fontWeight: '700', color: colors.ink }}>{b.cat}</Text>
                    <Muted>{b.items ? `${b.items} · ${d1(b.total)} days` : 'nothing in this period'}</Muted>
                  </Row>
                  <View style={{ flexDirection: 'row', height: 24, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.bg, width: `${Math.max(2, (b.total / maxBar) * 100)}%` }}>
                    {b.parts.filter((x) => x.days > 0).map((x) => {
                      const k = x.key.replace('~', ''), est = x.key.endsWith('~');
                      return (
                        <View key={x.key} style={[{ flexGrow: x.days, flexBasis: 0, justifyContent: 'center', alignItems: 'center' }, fillOf(node(k), est)]}>
                          {x.days / (b.total || 1) > 0.08 ? <Text style={{ fontSize: 11, fontWeight: '700', color: node(k)?.hidden ? colors.ink : '#fff' }}>{d1(x.days)}</Text> : null}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
              <Row wrap gap={12}>
                {p.nodes.map((n) => <NName nodes={p.nodes} key={n.key} k={n.key} />)}
                <NName nodes={p.nodes} k={p.hiddenKey} est />
              </Row>
            </Card>
          </Section>
        </View>
        <View style={{ flexGrow: 2, flexBasis: 360, minWidth: 0 }}>
          <Section title={p.hidden.title}>
            <Card style={{ gap: 10 }}>
              <Muted>Goes in: {p.hidden.goesIn}. Comes out: {p.hidden.comesOut}.</Muted>
              <Text style={{ color: colors.text }}>{rep.hidden.passes} {p.hidden.unit} in this period · {rep.hidden.open} open now</Text>
              <Row gap={6} style={{ alignItems: 'center' }}><NDot nodes={p.nodes} k={p.hiddenKey} /><Text style={{ color: colors.text, fontSize: 13 }}>Seen going in and out: {rep.hidden.exact.n} · median {d1(rep.hidden.exact.median)} d</Text></Row>
              <Row gap={6} style={{ alignItems: 'center' }}><NDot nodes={p.nodes} k={p.hiddenKey} est /><Text style={{ color: colors.text, fontSize: 13 }}>Start or end not seen: {rep.hidden.guess.n} · median {d1(rep.hidden.guess.median)} d</Text></Row>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 110, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                {rep.hidden.bins.map((b) => (
                  <View key={b.label} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                    <Text style={{ fontSize: 11, color: colors.text }}>{b.n + b.m}</Text>
                    {b.m ? <View style={[{ width: '100%', height: (b.m / maxBin) * 84, borderTopLeftRadius: 4, borderTopRightRadius: 4 }, fillOf(hn, true)]} /> : null}
                    <View style={[{ width: '100%', height: Math.max(2, (b.n / maxBin) * 84) }, b.m ? null : { borderTopLeftRadius: 4, borderTopRightRadius: 4 }, fillOf(hn)]} />
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {rep.hidden.bins.map((b) => <Text key={b.label} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: colors.muted }}>{b.label}</Text>)}
              </View>
              <Muted>Working days</Muted>
              {rep.hidden.labels.map((l) => <Text key={l.label} style={{ fontSize: 13, color: colors.text }} numberOfLines={2}>{l.label}: median {d1(l.median)} d ({l.n})</Text>)}
            </Card>
          </Section>
        </View>
      </Row>

      <Section title={`By ${p.personLabel.toLowerCase()}`}>
        <DataTable
          rows={rep.people}
          keyOf={(r) => r.person}
          onPress={(r) => setPerson(r.person)}
          emptyTitle="Nothing in this period"
          columns={[
            { h: p.personLabel, w: 180, grow: true, bold: true, v: (r) => p.personName(r.person) },
            { h: p.itemWord + 's', w: 70, right: true, v: (r) => String(r.items) },
            ...workNodes.map((n) => ({ h: n.name, w: 92, right: true, v: (r: (typeof rep.people)[number]) => (r.items ? d1(r.byNode[n.key]) : '—') })),
            { h: hn.name, w: 92, right: true, v: (r) => (r.items ? d1(r.byNode[p.hiddenKey]) : '—') },
            { h: 'Returned', w: 80, right: true, v: (r) => String(r.returned) },
            { h: 'On time', w: 80, right: true, v: (r) => (r.onTime == null ? '—' : <Text style={{ fontWeight: '700', color: r.onTime < 0.7 ? colors.red : colors.green }}>{`${Math.round(r.onTime * 100)} %`}</Text>) },
            { h: 'Open now', w: 80, right: true, v: (r) => String(r.holding) },
          ]}
        />
      </Section>

      <Section title="Waiting longest – who to chase">
        <DataTable
          rows={rep.waiting.slice(0, 30)}
          keyOf={(r, i) => r.it.key + i}
          onPress={(r) => setPick(r.it.key)}
          edge={(r) => (r.late ? colors.red : undefined)}
          emptyTitle="Nothing open"
          columns={[
            { h: p.itemWord, w: 170, v: (r) => <View><Text style={{ fontWeight: '700', color: colors.ink }}>{r.it.code}</Text><Muted>{r.it.cat}</Muted></View> },
            { h: 'Project', w: 200, grow: true, v: (r) => r.it.project },
            { h: 'With', w: 170, v: (r) => <NName nodes={p.nodes} k={r.s.node} est={!!r.s.est} /> },
            { h: 'Since', w: 100, v: (r) => fmtDate(r.s.start) },
            { h: 'Days', w: 60, right: true, bold: true, v: (r) => String(r.s.days) },
            { h: 'Due', w: 100, tone: (r) => (r.late ? colors.red : undefined), v: (r) => fmtDate(r.it.due) },
            { h: 'Last step we saw', w: 240, v: (r) => (r.last ? `${r.last.label} (${fmtDate(r.last.end)})` : '—') },
            { h: 'Now', w: 220, v: (r) => r.s.label },
          ]}
        />
      </Section>

      <Section title="Average working days per slice, month by month">
        <DataTable
          rows={rep.trend}
          keyOf={(r) => r.key}
          columns={[
            { h: 'Node', w: 170, grow: true, v: (r) => <NName nodes={p.nodes} k={r.key} /> },
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

      <Section title={`One ${p.itemWord.toLowerCase()} through the nodes`}>
        <Select label={p.itemWord} searchable value={chosen?.key ?? null} onChange={setPick} options={items.map((it) => ({ value: it.key, label: `${it.code} · ${it.project}` }))} />
        {chosen ? <Timeline it={chosen} nodes={p.nodes} today={today} /> : <Muted>Pick one.</Muted>}
      </Section>
    </>
  );
}

function Timeline({ it, nodes, today }: { it: PItem; nodes: PNode[]; today: string }) {
  if (!it.segs.length) return <Muted>No history yet.</Muted>;
  const t = (s: string) => new Date(s).getTime();
  const nowTs = new Date().toISOString();
  const a = Math.min(...it.segs.map((s) => t(s.start))), b = Math.max(t(nowTs), ...it.segs.map((s) => t(s.end ?? nowTs)));
  const span = Math.max(1, b - a);
  const total = (k: string) => it.segs.filter((s) => s.node === k).reduce((x, s) => x + s.days, 0);
  const segs = [...it.segs].sort((x, y) => (x.start < y.start ? -1 : 1));
  return (
    <View style={{ gap: 10 }}>
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>{it.code} · {it.title}</Text>
        <Pill label={it.cat} />
        <Pressable onPress={() => router.push(it.href as never)} accessibilityRole="link"><Text style={{ color: colors.brand, fontWeight: '600' }}>Open</Text></Pressable>
      </Row>
      <Card style={{ gap: 6 }}>
        <Row style={{ justifyContent: 'space-between', marginLeft: 150, marginRight: 70 }}>
          <Muted>{fmtDate(new Date(a).toISOString())}</Muted>
          <Muted>{fmtDate(today)}</Muted>
        </Row>
        {nodes.map((n) => (
          <Row key={n.key} gap={10} style={{ alignItems: 'center' }}>
            <Row gap={6} style={{ width: 140, alignItems: 'center' }}><View style={[{ width: 10, height: 10, borderRadius: 3 }, fillOf(n)]} /><Text style={{ color: colors.text }}>{n.name}</Text></Row>
            <View style={{ flex: 1, height: 26, backgroundColor: colors.bg, borderRadius: 5 }}>
              {it.segs.filter((s) => s.node === n.key).map((s, i) => {
                const x = t(s.start), y = t(s.end ?? nowTs);
                return <View key={i} style={[{ position: 'absolute', top: 4, bottom: 4, borderRadius: 4, left: `${((x - a) / span) * 100}%`, width: `${Math.max(0.8, ((y - x) / span) * 100)}%`, opacity: s.end ? 1 : 0.75 }, fillOf(n, !!s.est)]} />;
              })}
            </View>
            <Text style={{ width: 60, textAlign: 'right', fontWeight: '700', color: colors.ink }}>{total(n.key) || '—'}</Text>
          </Row>
        ))}
        <Muted>Working days per node. Faded bars are still open. Striped: hidden node; light stripes: its start or end was not seen.</Muted>
      </Card>
      <DataTable
        rows={segs}
        keyOf={(s, i) => s.start + i}
        columns={[
          { h: 'From', w: 110, v: (s) => fmtDate(s.start) },
          { h: 'To', w: 110, v: (s) => (s.end ? fmtDate(s.end) : 'now') },
          { h: 'Node', w: 170, v: (s) => <Row gap={6} style={{ alignItems: 'center' }}><View style={[{ width: 10, height: 10, borderRadius: 3 }, fillOf(nodes.find((n) => n.key === s.node), !!s.est)]} /><Text style={{ color: colors.text }}>{nodes.find((n) => n.key === s.node)?.name ?? s.node}{s.est ? ' (not seen)' : ''}</Text></Row> },
          { h: 'What', w: 320, grow: true, v: (s) => s.label },
          { h: 'Days', w: 60, right: true, bold: true, v: (s) => `${s.days}${s.end ? '' : '+'}` },
        ]}
      />
    </View>
  );
}

