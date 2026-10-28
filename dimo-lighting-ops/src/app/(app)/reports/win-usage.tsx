import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Grid, Loading, Muted, Notice, Pill, Row, Screen, Section, Segmented, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { exportExcel, exportPdf, type Column } from '@/lib/export';
import { fyLabel, fyOf } from '@/lib/finance';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_SHORT } from '@/lib/roles';
import { rpc } from '@/lib/supabase';

type Person = {
  id: string;
  name: string;
  role: 'asm_building' | 'asm_infra';
  scores: number;
  opens: number;
  applied: number;
  projects_scored: number;
  open_projects: number;
  open_scored: number;
  followups: number;
  followed: number;
  late: number;
  last_used: string | null;
  weeks: number[];
};
type Use = {
  id: number;
  user_id: string;
  at: string;
  action: 'opened' | 'scored' | 'applied';
  project_id: string;
  project: string;
  project_code: string | null;
  inquiry_code: string | null;
  inquiry_name: string | null;
  wizard_pct: number | null;
  before_pct: number | null;
  after_pct: number | null;
  after_visit: boolean;
};
type Late = { id: number; user_id: string; project: string; inquiry_code: string | null; created_at: string; escalated_at: string };
type Report = { people: Person[]; uses: Use[]; late: Late[] };

type Period = '30' | '90' | 'fy';
const UNIT: Record<string, string> = { asm_building: 'Building', asm_infra: 'Infrastructure' };
const ACTION: Record<Use['action'], string> = { opened: 'Opened only', scored: 'Scored', applied: 'Applied' };

const share = (p: Person) => (p.open_projects ? Math.round((p.open_scored / p.open_projects) * 100) : null);
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);
/** Green ≥ 70% of open projects scored · amber 40–69% · red below 40% or not used for 30 days */
function tone(p: Person) {
  const s = share(p);
  const d = daysSince(p.last_used);
  if (d == null || d >= 30 || (s != null && s < 40)) return colors.red;
  return s == null || s >= 70 ? colors.green : colors.amber;
}
const BARS = '▁▂▃▄▅▆▇█';
const spark = (w: number[]) => {
  const m = Math.max(1, ...w);
  return w.map((n) => (n ? BARS[Math.min(7, Math.round((n / m) * 7))] : '·')).join('');
};

function fromDate(p: Period) {
  const t = todayISO();
  if (p === 'fy') return `${fyOf(t)}-04-01`;
  const d = new Date();
  d.setDate(d.getDate() - Number(p));
  return d.toISOString().slice(0, 10);
}

/** Reports › Win Predictor use – DGM / GM and SM Projects: who uses the wizard, on what and how often */
export default function WinUsage() {
  const me = useMe();
  const dialog = useDialog();
  const [period, setPeriod] = useState<Period>('90');
  const [person, setPerson] = useState('');
  const [unit, setUnit] = useState('');
  const allowed = me.role === 'gm' || me.role === 'sm_projects';
  const from = fromDate(period);
  const { data, error, loading, reload } = useLoad(() => (allowed ? rpc<Report>('win_wizard_report', { p_from: from, p_to: todayISO() }) : Promise.resolve(null)), [from, allowed]);
  if (!allowed) return <Screen><Notice tone={colors.amber}>Win Predictor use is reported to DGM / GM and SM Projects.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;

  const people = data.people.filter((p) => (!unit || p.role === unit) && (!person || p.id === person));
  const ids = new Set(people.map((p) => p.id));
  const uses = data.uses.filter((u) => ids.has(u.user_id));
  const name = (uid: string) => data.people.find((p) => p.id === uid)?.name ?? '—';
  const sum = (k: keyof Person) => people.reduce((t, p) => t + (p[k] as number), 0);
  const openAll = sum('open_projects');
  const fups = sum('followups');
  const periodText = period === 'fy' ? fyLabel(fyOf(todayISO())) : `Last ${period} days`;
  const filters = [periodText, unit ? UNIT[unit] : 'All units', person ? name(person) : 'All sales people'].join(' · ');
  const chosen = person ? data.people.find((p) => p.id === person) : null;

  const peopleCols: Column<Person>[] = [
    { header: 'Sales person', value: (p) => p.name },
    { header: 'Unit', value: (p) => UNIT[p.role] },
    { header: 'Scores', value: (p) => p.scores, align: 'right' },
    { header: 'Opens', value: (p) => p.opens, align: 'right' },
    { header: 'Applied', value: (p) => p.applied, align: 'right' },
    { header: 'Projects scored', value: (p) => p.projects_scored, align: 'right' },
    { header: 'Open projects scored (30 days)', value: (p) => `${p.open_scored} / ${p.open_projects}${share(p) != null ? ` (${share(p)}%)` : ''}`, align: 'right' },
    { header: 'Visits followed up', value: (p) => `${p.followed} / ${p.followups}`, align: 'right' },
    { header: 'Not updated > 3 days', value: (p) => p.late, align: 'right' },
    { header: 'Last used', value: (p) => (p.last_used ? fmtDate(p.last_used) : 'Never') },
  ];
  const useCols: Column<Use>[] = [
    { header: 'Date', value: (u) => fmtDateTime(u.at) },
    { header: 'Sales person', value: (u) => name(u.user_id) },
    { header: 'Project', value: (u) => [u.project_code, u.project].filter(Boolean).join(' ') },
    { header: 'Inquiry', value: (u) => [u.inquiry_code, u.inquiry_name].filter(Boolean).join(' ') },
    { header: 'What', value: (u) => ACTION[u.action] },
    { header: 'Wizard %', value: (u) => u.wizard_pct ?? '', align: 'right' },
    { header: 'Before → after', value: (u) => (u.before_pct == null ? '' : u.after_pct == null ? `${u.before_pct}%` : `${u.before_pct}% → ${u.after_pct}%`) },
    { header: 'After a visit', value: (u) => (u.after_visit ? 'Yes' : 'No') },
  ];
  const meta = (title: string) => ({ key: 'win_usage', title, filters, generatedBy: `${me.full_name} – ${ROLE_SHORT[me.role]}`, landscape: true });
  const exportIt = (kind: 'pdf' | 'excel') =>
    dialog.run(async () => {
      if (kind === 'excel') await exportExcel(meta('Win Predictor use – every use'), useCols, [{ heading: 'Uses', rows: uses }]);
      else await exportPdf(meta('Win Predictor use'), peopleCols, [{ heading: 'By sales person', rows: people }]);
    });

  return (
    <Screen maxWidth={1300} refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Win Predictor use' }} />
      <Muted>How each sales person uses the Win Probability Wizard: scores, opens, projects scored, and whether visits were followed by an update of the win probability.</Muted>
      <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
        <Segmented<Period> value={period} onChange={setPeriod} options={[{ value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: 'fy', label: 'This FY' }]} />
        <View style={{ minWidth: 200 }}>
          <Select label="Unit" value={unit} onChange={setUnit} options={[{ value: '', label: 'All units' }, { value: 'asm_building', label: 'Building' }, { value: 'asm_infra', label: 'Infrastructure' }]} />
        </View>
        <View style={{ minWidth: 220 }}>
          <Select label="Sales person" value={person} onChange={setPerson} options={[{ value: '', label: 'All sales people' }, ...data.people.map((p) => ({ value: p.id, label: p.name }))]} />
        </View>
        <Button small variant="secondary" title="PDF" onPress={() => exportIt('pdf')} />
        <Button small variant="secondary" title="Excel" onPress={() => exportIt('excel')} />
      </Row>
      <Grid min={180}>
        <Stat label={`Wizard scores (${sum('opens')} opens)`} value={sum('scores')} />
        <Stat label="Open projects scored in 30 days" value={openAll ? `${Math.round((sum('open_scored') / openAll) * 100)}%` : '—'} />
        <Stat label="Visits followed by an update" value={fups ? `${Math.round((sum('followed') / fups) * 100)}%` : '—'} tone={fups && sum('followed') / fups < 0.7 ? 'amber' : undefined} />
        <Stat label="Not updated more than 3 working days" value={sum('late')} tone={sum('late') ? 'red' : undefined} />
      </Grid>

      <Section title="By sales person">
        <DataTable
          rows={people}
          keyOf={(p) => p.id}
          edge={tone}
          onPress={(p) => setPerson(person === p.id ? '' : p.id)}
          emptyTitle="No sales people in this selection"
          columns={[
            { h: 'Sales person', w: 170, bold: true, v: (p) => p.name },
            { h: 'Unit', w: 100, v: (p) => UNIT[p.role] },
            { h: 'Scores', w: 70, right: true, v: (p) => p.scores },
            { h: 'Opens', w: 70, right: true, v: (p) => p.opens },
            { h: 'Projects scored', w: 90, right: true, v: (p) => p.projects_scored },
            { h: 'Open projects scored', w: 120, right: true, tone: (p) => tone(p), v: (p) => `${p.open_scored} / ${p.open_projects}${share(p) != null ? ` · ${share(p)}%` : ''}` },
            { h: 'Visits followed up', w: 110, right: true, tone: (p) => (p.followups && p.followed / p.followups < 0.7 ? colors.amber : undefined), v: (p) => `${p.followed} / ${p.followups}` },
            { h: 'Not updated', w: 90, right: true, tone: (p) => (p.late ? colors.red : undefined), v: (p) => p.late },
            { h: 'Last used', w: 100, v: (p) => (p.last_used ? fmtDate(p.last_used) : 'Never') },
            { h: '12 weeks', w: 130, grow: true, v: (p) => <Text style={{ color: colors.blue, letterSpacing: 1 }}>{spark(p.weeks)}</Text> },
          ]}
        />
        <Muted style={{ fontSize: 12 }}>Green: 70% or more of open projects scored in the last 30 days · amber 40–69% · red below 40% or not used for 30 days. Tap a sales person for every use.</Muted>
      </Section>

      <Section title={chosen ? `${chosen.name} – what it was used on` : 'Every use'} right={chosen ? <Button small variant="ghost" title="All sales people" onPress={() => setPerson('')} /> : null}>
        <DataTable
          rows={uses.slice(0, 300)}
          keyOf={(u) => String(u.id)}
          onPress={(u) => router.push(`/projects/${u.project_id}`)}
          emptyTitle="The wizard was not used in this period"
          columns={[
            { h: 'Date', w: 130, v: (u) => fmtDateTime(u.at) },
            ...(chosen ? [] : [{ h: 'Sales person', w: 150, v: (u: Use) => name(u.user_id) }]),
            { h: 'Project / inquiry', w: 260, grow: true, v: (u) => [u.project, [u.inquiry_code, u.inquiry_name].filter(Boolean).join(' ')].filter(Boolean).join(' · ') },
            { h: 'What', w: 100, v: (u) => <Pill label={ACTION[u.action]} tone={u.action === 'opened' ? colors.grey : u.action === 'applied' ? colors.green : colors.blue} /> },
            { h: 'Wizard', w: 70, right: true, v: (u) => (u.wizard_pct == null ? '—' : `${u.wizard_pct}%`) },
            { h: 'Before → after', w: 110, right: true, v: (u) => (u.before_pct == null ? '—' : u.after_pct == null ? `${u.before_pct}%` : `${u.before_pct}% → ${u.after_pct}%`) },
            { h: 'After a visit', w: 90, v: (u) => (u.after_visit ? 'Yes' : 'No') },
          ]}
        />
        {uses.length > 300 ? <Muted>{`Showing the latest 300 of ${uses.length} – Excel has them all.`}</Muted> : null}
      </Section>

      {data.late.filter((l) => ids.has(l.user_id)).length ? (
        <Section title="Visits not followed by an update (more than 3 working days)">
          <Card style={{ gap: 4 }}>
            {data.late
              .filter((l) => ids.has(l.user_id))
              .map((l) => (
                <Text key={l.id} style={{ color: colors.text }}>{`${name(l.user_id)} · ${l.project}${l.inquiry_code ? ` · ${l.inquiry_code}` : ''} · visit ${fmtDate(l.created_at)}`}</Text>
              ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
