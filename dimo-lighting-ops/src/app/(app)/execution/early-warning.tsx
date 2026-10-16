import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, Grid, Loading, Muted, Row, Screen, Section, Segmented, Stat, styles, useWide } from '@/components/ui';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

type Light = 'red' | 'amber' | 'green' | 'na';
type Signal = { k: string; c: Light; v: string; why: string; link: string | null; spark?: number[]; risk?: number; value?: number; overdue?: number; permits?: number };
type Project = { id: string; code: string | null; name: string; client: string | null; stage: number; see_id: string | null; overall: Exclude<Light, 'na'>; reds: number; ambers: number; signals: Signal[] };
type Data = { limits: Record<string, number>; defaults: Record<string, number>; can_edit: boolean; today: string; projects: Project[] };

const COLS: { k: string; label: string }[] = [
  { k: 'finish', label: 'Finish forecast' },
  { k: 'plan', label: 'Plan vs done' },
  { k: 'block', label: 'Critical path' },
  { k: 'mat', label: 'Materials' },
  { k: 'bill', label: 'Billing' },
  { k: 'vari', label: 'Variations' },
  { k: 'sub', label: 'Subcontractor' },
  { k: 'hse', label: 'HSE' },
  { k: 'rep', label: 'Daily reports' },
  { k: 'def', label: 'Defects & snags' },
  { k: 'ho', label: 'Handover' },
  { k: 'dwg', label: 'Smart drawings' },
];
const label = (k: string) => COLS.find((c) => c.k === k)?.label ?? k;
const TONE: Record<Light, string> = { red: colors.red, amber: colors.amber, green: colors.green, na: colors.line };
const WORD = { red: 'At risk', amber: 'Watch', green: 'On track' } as const;
const RANK: Record<Light, number> = { red: 0, amber: 1, green: 2, na: 3 };
const rs = (n: number) => (n >= 1e6 ? `Rs ${(n / 1e6).toFixed(1)} M` : `Rs ${Math.round(n / 1e3)} k`);

/** The limits SM Projects sets: label and unit */
const LIMITS: [string, string, string][] = [
  ['slipRed', 'Finish forecast – red when late by more than', 'days'], ['slipAmber', 'Finish forecast – amber when late by more than', 'days'],
  ['planRed', 'Plan vs done – red below', '%'], ['planAmber', 'Plan vs done – amber below', '%'], ['fallWeeks', 'Plan vs done – red when falling for', 'weeks'],
  ['blockRed', 'Critical activity – red when late by more than', 'days'], ['blockAmber', 'Critical activity – amber when late by more than', 'days'],
  ['leadSap', 'Usual delivery – SAP', 'days'], ['leadLocal', 'Usual delivery – local order', 'days'], ['leadImport', 'Usual delivery – import', 'days'],
  ['matAmber', 'Materials – amber when the time left to order is under', 'days'],
  ['billRed', 'Billing – red when not invoiced exceeds', 'Rs'], ['billAmber', 'Billing – amber when not invoiced exceeds', 'Rs'], ['billAgeRed', 'Billing – red when ready but not invoiced for', 'days'],
  ['varRed', 'Variations – red when not submitted for', 'days'], ['varAmber', 'Variations – amber when not submitted for', 'days'],
  ['subRed', 'Subcontractor – red when invoiced ahead of certified by', '%'], ['subAmber', 'Subcontractor – amber when ahead by', '%'],
  ['repRed', 'Daily reports – red when missing (last 7 days)', 'reports'],
  ['snagAmber', 'Defects – amber when open snags + defects exceed', ''], ['dlpRed', 'Defects – red when the liability period ends within', 'days'],
  ['hoRed', 'Handover – red below', '%'], ['hoAmber', 'Handover – amber below', '%'], ['hoWeeks', 'Handover – checked from', 'weeks before'],
  ['dwgRed', 'Smart drawings – red above (failed items / circuits)', 'failed'],
  ['ambersForAmber', 'Project is amber when this many lights are amber', 'lights'],
];

function Dot({ c, size = 11 }: { c: Light; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: TONE[c] }} />;
}

function Spark({ v }: { v: number[] }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 16 }}>
      {v.map((x, i) => (
        <View key={i} style={{ width: 4, height: Math.max(3, x * 0.16), borderRadius: 1, backgroundColor: colors.muted, opacity: i === v.length - 1 ? 1 : 0.5 }} />
      ))}
    </View>
  );
}

/** Execution early warning: one row per live project with 12 lights, worst first; tap a light or a project for the reasons */
export default function EarlyWarning() {
  const wide = useWide();
  const people = usePeople();
  const dialog = useDialog();
  const [filter, setFilter] = useState<'all' | 'red' | 'amber'>('all');
  const [open, setOpen] = useState<{ id: string; k?: string } | null>(null);
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const { data, error, reload } = useLoad(async () => rpc<Data>('exec_early_warning'), []);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;

  const all = data.projects;
  const list = filter === 'all' ? all : all.filter((p) => p.overall === filter);
  const sig = (p: Project, k: string) => (p.signals.find((s) => s.k === k) ?? { k, c: 'na', v: '—', why: '' }) as Signal;
  const count = (c: string) => all.filter((p) => p.overall === c).length;
  const billing = all.reduce((t, p) => t + (sig(p, 'bill').c !== 'green' ? sig(p, 'bill').value ?? 0 : 0), 0);
  const mats = all.reduce((t, p) => t + (sig(p, 'mat').risk ?? 0), 0);
  const hse = all.reduce((t, p) => t + (sig(p, 'hse').overdue ?? 0), 0);
  const permits = all.reduce((t, p) => t + (sig(p, 'hse').permits ?? 0), 0);
  const choose = (id: string, k?: string) => setOpen(open && open.id === id && open.k === k ? null : { id, k });

  const saveLimits = () =>
    dialog.run(async () => {
      const out: Record<string, number> = {};
      for (const [k] of LIMITS) {
        const v = Number((edit ?? {})[k] ?? data.limits[k]);
        if (!Number.isFinite(v) || v < 0) throw new Error(`${LIMITS.find((x) => x[0] === k)?.[1]}: enter a number of 0 or more`);
        if (v !== data.defaults[k]) out[k] = v;
      }
      await rpc('exec_ew_set_limits', { p: out });
      setEdit(null);
      await reload();
    }, 'Limits saved – the lights are updated');

  const Detail = ({ p }: { p: Project }) => {
    const order = open?.k ? [open.k, ...COLS.map((c) => c.k).filter((k) => k !== open.k)] : [...COLS.map((c) => c.k)].sort((a, b) => RANK[sig(p, a).c] - RANK[sig(p, b).c]);
    return (
      <View style={{ gap: 2, paddingTop: 6 }}>
        {order.map((k) => {
          const s = sig(p, k);
          return (
            <View key={k} style={{ flexDirection: 'row', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.line }}>
              <View style={{ paddingTop: 4 }}><Dot c={s.c} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>{`${label(k)}${open?.k === k ? '  ←' : ''}`}</Text>
                <Muted>{s.why}</Muted>
                {s.link && (s.c === 'red' || s.c === 'amber') ? (
                  <View style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                    <Button small variant="secondary" title="Open" onPress={() => router.push(s.link as never)} />
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
        <View style={{ alignSelf: 'flex-start', marginTop: 4 }}>
          <Button small variant="ghost" title="Open the project" onPress={() => router.push(`/execution/${p.id}` as never)} />
        </View>
      </View>
    );
  };

  const Head = ({ p }: { p: Project }) => (
    <Pressable onPress={() => choose(p.id)} accessibilityRole="button" accessibilityLabel={`${p.name}: ${WORD[p.overall]}`} style={{ gap: 1 }}>
      <Row gap={6} style={{ alignItems: 'center' }}>
        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: TONE[p.overall] }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{WORD[p.overall]}</Text>
        </View>
        <Muted>{p.code ?? ''}</Muted>
      </Row>
      <Text style={{ fontWeight: '700', color: colors.ink }} numberOfLines={2}>{p.name}</Text>
      <Muted numberOfLines={1}>{[p.client, p.see_id ? `SEE ${people[p.see_id]?.full_name ?? ''}` : null].filter(Boolean).join(' · ')}</Muted>
    </Pressable>
  );

  const Cell = ({ p, k }: { p: Project; k: string }) => {
    const s = sig(p, k);
    const on = open?.id === p.id && open?.k === k;
    return (
      <Pressable onPress={() => choose(p.id, k)} accessibilityRole="button" accessibilityLabel={`${label(k)}: ${s.c === 'na' ? 'not relevant' : WORD[s.c]} – ${s.v}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 8, backgroundColor: on ? colors.soft : 'transparent' }}>
        <Dot c={s.c} />
        {s.spark ? <Spark v={s.spark} /> : null}
        <Text style={{ fontSize: 12.5, color: s.c === 'na' ? colors.faint : colors.ink }} numberOfLines={1}>{s.v}</Text>
      </Pressable>
    );
  };

  return (
    <Screen maxWidth={1400}>
      <Stack.Screen options={{ title: 'Early warning' }} />
      <Muted>{`Live execution projects, worst first – from what the app already records (${data.today}). Tap a light for the reason, or a project for all twelve.`}</Muted>
      <Grid min={170} max={6}>
        <Stat label="At risk" value={String(count('red'))} tone={count('red') ? 'red' : undefined} onPress={() => setFilter('red')} />
        <Stat label="To watch" value={String(count('amber'))} tone={count('amber') ? 'amber' : undefined} onPress={() => setFilter('amber')} />
        <Stat label="On track" value={String(count('green'))} tone="green" onPress={() => setFilter('all')} />
        <Stat label="Billing at risk" value={billing ? rs(billing) : '—'} tone={billing ? 'amber' : undefined} sub="ready, not invoiced" />
        <Stat label="Materials at risk" value={String(mats)} tone={mats ? 'red' : undefined} sub="not ordered in time" />
        <Stat label="HSE overdue · permits" value={`${hse} · ${permits}`} tone={hse ? 'red' : undefined} sub="actions overdue · permits expiring" />
      </Grid>
      <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: `All (${all.length})` }, { value: 'red', label: `At risk (${count('red')})` }, { value: 'amber', label: `To watch (${count('amber')})` }]} />

      {!list.length ? (
        <Empty title={all.length ? 'No project in this group' : 'No live execution projects'} hint={all.length ? 'Choose All to see every project.' : undefined} />
      ) : wide ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <ScrollView horizontal>
            <View style={{ minWidth: 1250 }}>
              <View style={{ flexDirection: 'row', backgroundColor: colors.soft, paddingVertical: 8 }}>
                <Text style={{ width: 270, paddingLeft: 14, fontSize: 11, fontWeight: '700', color: colors.muted }}>PROJECT</Text>
                {COLS.map((c) => (
                  <Text key={c.k} style={{ width: 88, fontSize: 11, fontWeight: '700', color: colors.muted }} numberOfLines={2}>{c.label.toUpperCase()}</Text>
                ))}
              </View>
              {list.map((p) => (
                <View key={p.id} style={{ borderTopWidth: 1, borderTopColor: colors.line, borderLeftWidth: 5, borderLeftColor: TONE[p.overall] }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
                    <View style={{ width: 265, paddingLeft: 9, paddingRight: 8 }}><Head p={p} /></View>
                    {COLS.map((c) => <View key={c.k} style={{ width: 88 }}><Cell p={p} k={c.k} /></View>)}
                  </View>
                  {open?.id === p.id ? <View style={{ paddingHorizontal: 14, paddingBottom: 10, maxWidth: 900 }}><Detail p={p} /></View> : null}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          {list.map((p) => (
            <Card key={p.id} style={{ gap: 8, borderLeftWidth: 5, borderLeftColor: TONE[p.overall] }}>
              <Head p={p} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {COLS.map((c) => (
                  <View key={c.k} style={{ width: '48%' }}>
                    <Muted style={{ fontSize: 11 }}>{c.label}</Muted>
                    <Cell p={p} k={c.k} />
                  </View>
                ))}
              </View>
              {open?.id === p.id ? <Detail p={p} /> : null}
            </Card>
          ))}
        </View>
      )}
      <Row gap={14} wrap>
        {(['red', 'amber', 'green', 'na'] as Light[]).map((c) => (
          <Row key={c} gap={6} style={{ alignItems: 'center' }}><Dot c={c} /><Muted>{c === 'na' ? 'Not relevant yet' : c === 'red' ? 'Act now' : c === 'amber' ? 'Watch' : 'On track'}</Muted></Row>
        ))}
        <Muted>{`A project is red when any light is red, amber when ${data.limits.ambersForAmber} or more are amber.`}</Muted>
      </Row>

      <Section title="Limits" right={data.can_edit ? (edit ? <Row gap={6}><Button small variant="secondary" title="Cancel" onPress={() => setEdit(null)} /><Button small title="Save" onPress={saveLimits} /></Row> : <Button small variant="secondary" title="Change limits" onPress={() => setEdit({})} />) : undefined}>
        <Card>
          <Muted>{data.can_edit ? 'SM Projects sets these for every project. Alerts: an immediate alert when a project turns red, and a summary every Monday at 08:00.' : 'Set by SM Projects. Alerts: an immediate alert when a project turns red, and a summary every Monday at 08:00.'}</Muted>
          <Grid min={300} max={3}>
            {LIMITS.map(([k, text, unit]) => {
              const v = edit ? edit[k] ?? String(data.limits[k]) : String(data.limits[k]);
              const changed = Number(v) !== data.defaults[k];
              return (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.ink, fontSize: 13 }}>{text}</Text>
                    {changed ? <Muted style={{ fontSize: 11 }}>{`suggested ${unit === 'Rs' ? rs(data.defaults[k]) : data.defaults[k]}`}</Muted> : null}
                  </View>
                  {edit ? (
                    <TextInput value={v} onChangeText={(t) => setEdit({ ...edit, [k]: t.replace(/[^0-9]/g, '') })} keyboardType="number-pad" style={[styles.input, { width: 110, textAlign: 'right', marginBottom: 0 }]} accessibilityLabel={text} />
                  ) : (
                    <Text style={{ fontWeight: '700', color: colors.ink, minWidth: 80, textAlign: 'right' }}>{unit === 'Rs' ? rs(Number(v)) : `${v} ${unit}`}</Text>
                  )}
                </View>
              );
            })}
          </Grid>
        </Card>
      </Section>
    </Screen>
  );
}
