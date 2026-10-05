import { router, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { Card, colors, ErrorBanner, Grid, Loading, Muted, Notice, Pill, Screen, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Row = {
  id: number;
  project_id: string;
  scored_at: string;
  scored_by: string;
  wizard_pct: number;
  manual_pct: number | null;
  gut_pct: number | null;
  confidence: number | null;
  chosen_pct: number | null;
  applied: string;
  flags: string[];
  projects: { name: string; code: string; owner_id: string; status: string; milestone: string; win_probability: number } | null;
};
const BANDS: [string, number, number][] = [
  ['Under 40%', 0, 39],
  ['40 – 69%', 40, 69],
  ['70% and over', 70, 100],
];

/** Win Probability Wizard – trial comparison for GM / DGM and SM Projects: wizard vs manual, and later against results */
export default function WizardTrial() {
  const me = useMe();
  const people = usePeople();
  const allowed = me.role === 'gm' || me.role === 'sm_projects';
  const { data, error } = useLoad(async () => {
    const { data: rows, error: e } = await supabase
      .from('win_scores')
      .select('id, project_id, scored_at, scored_by, wizard_pct, manual_pct, gut_pct, confidence, chosen_pct, applied, flags, projects(name, code, owner_id, status, milestone, win_probability)')
      .order('scored_at', { ascending: false })
      .limit(1000);
    if (e) throw new Error(e.message);
    return (rows ?? []) as unknown as Row[];
  });
  if (!allowed)
    return (
      <Screen>
        <Notice>The wizard trial is reviewed by SM Projects and GM / DGM.</Notice>
      </Screen>
    );
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;

  // Latest score per project
  const latest = [...new Map(data.map((r) => [r.project_id, r])).values()];
  const gaps = latest.filter((r) => r.manual_pct != null).map((r) => Math.abs(r.wizard_pct - (r.manual_pct ?? 0)));
  const avgGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
  const decided = latest.filter((r) => r.projects && ['won', 'lost'].includes(r.projects.status));
  const won = (r: Row) => r.projects?.milestone === 'won' || r.projects?.status === 'won';
  const band = (v: number | null) => BANDS.findIndex(([, lo, hi]) => v != null && v >= lo && v <= hi);
  const calib = BANDS.map(([l], i) => {
    const w = decided.filter((r) => band(r.wizard_pct) === i);
    const m = decided.filter((r) => band(r.manual_pct) === i);
    return { l, wn: w.length, ww: w.filter(won).length, mn: m.length, mw: m.filter(won).length };
  });
  const rate = (wins: number, n: number) => (n ? `${Math.round((wins / n) * 100)}% won (${wins} of ${n})` : '—');

  return (
    <Screen maxWidth={1200}>
      <Stack.Screen options={{ title: 'Win probability wizard – trial' }} />
      <Notice>
        Testing stage: sales people choose per project to enter the win probability by hand or with the wizard. Both figures are kept here so they can be compared – and, once
        projects are won or lost, checked against the result.
      </Notice>
      <Grid min={200}>
        <Stat label="Projects scored with the wizard" value={latest.length} />
        <Stat label="Scores in total" value={data.length} />
        <Stat label="Average gap wizard vs manual (points)" value={avgGap ?? '—'} tone={avgGap != null && avgGap >= 20 ? 'amber' : undefined} />
        <Stat label="Scored projects now won or lost" value={decided.length} />
      </Grid>

      <Section title="Which was closer to the result">
        <Card style={{ gap: 6 }}>
          {decided.length < 10 ? <Muted>{`Reliable after about 30 decided projects – ${decided.length} so far. A good forecast wins about as often as its %.`}</Muted> : null}
          {calib.map((c) => (
            <View key={c.l} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 6 }}>
              <Text style={{ width: 130, fontWeight: '700', color: colors.ink }}>{c.l}</Text>
              <Text style={{ minWidth: 260, color: colors.text }}>{`Wizard: ${rate(c.ww, c.wn)}`}</Text>
              <Text style={{ minWidth: 260, color: colors.text }}>{`Manual: ${rate(c.mw, c.mn)}`}</Text>
            </View>
          ))}
        </Card>
      </Section>

      <Section title="Projects (latest score)">
        <DataTable
          rows={latest}
          keyOf={(r) => String(r.id)}
          onPress={(r) => router.push({ pathname: '/projects/wizard', params: { id: r.project_id } })}
          emptyTitle="No project scored with the wizard yet – sales people turn it on with the tick on a project"
          columns={[
            { h: 'Project', w: 240, v: (r) => `${r.projects?.code ?? ''} ${r.projects?.name ?? ''}`, bold: true },
            { h: 'Sales person', w: 150, v: (r) => people[r.projects?.owner_id ?? '']?.full_name ?? '—' },
            { h: 'Scored', w: 100, v: (r) => fmtDate(r.scored_at) },
            { h: 'Wizard', w: 80, right: true, v: (r) => `${r.wizard_pct}%`, bold: true },
            { h: 'Manual then', w: 100, right: true, v: (r) => (r.manual_pct == null ? '—' : `${r.manual_pct}%`) },
            { h: 'Gut', w: 70, right: true, v: (r) => (r.gut_pct == null ? '—' : `${r.gut_pct}%`) },
            { h: 'Confidence', w: 100, right: true, v: (r) => (r.confidence == null ? '—' : `${Math.round(Number(r.confidence))}%`) },
            { h: 'Now', w: 80, right: true, v: (r) => `${r.projects?.win_probability ?? '—'}%` },
            {
              h: 'Use',
              w: 150,
              v: (r) => <Pill label={r.applied === 'requested' ? 'Sent to SM Projects' : r.applied === 'set' ? 'Set' : 'Saved only'} tone={r.applied === 'saved' ? colors.grey : colors.blue} />,
            },
            { h: 'Status', w: 100, v: (r) => r.projects?.status ?? '—' },
            { h: 'For review', w: 340, v: (r) => (r.flags.length ? r.flags.join(' · ') : '—'), tone: (r) => (r.flags.length ? colors.amber : undefined) },
          ]}
        />
      </Section>
    </Screen>
  );
}
