import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { Button, Card, colors, ErrorBanner, Grid, Loading, Muted, Pill, Row, Screen, Section, Segmented, Stat } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

type Proj = {
  project_id: string;
  name: string;
  stage: string;
  milestone: string;
  status: string;
  roles: string[];
  appointed: boolean;
  replaced: boolean;
  last_met_at: string | null;
  last_activity_at: string | null;
  won: number;
  lost: number;
  open: number;
  won_value: number;
  brands_asked: string | null;
  owner_id: string;
};
type Overview = { organization: { id: string; name: string; visit_category: string; phone: string | null; email: string | null; address: string | null } | null; projects: Proj[] };
type Filter = 'all' | 'live' | 'stale';
const STALE_DAYS = 60;

/** A consultant's (or any organisation's) projects: the role they hold, our results there, brands asked for, and where we have not met them lately */
export default function ConsultantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const people = usePeople();
  const [filter, setFilter] = useState<Filter>('all');
  const { data, error, loading, reload } = useLoad(async () => ({ ...(await rpc<Overview>('consultant_overview', { p_org: id })), at: Date.now() }), [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const o = data.organization;
  const live = (p: Proj) => !p.replaced && !['won', 'lost', 'cancelled', 'dormant'].includes(p.status) && p.milestone !== 'won' && p.milestone !== 'lost';
  const stale = (p: Proj) => live(p) && (!p.last_met_at || data.at - Date.parse(p.last_met_at) > STALE_DAYS * 864e5);
  const ps = data.projects;
  const shown = ps.filter((p) => filter === 'all' || (filter === 'live' && live(p)) || (filter === 'stale' && stale(p)));
  const won = ps.reduce((s, p) => s + p.won, 0);
  const lost = ps.reduce((s, p) => s + p.lost, 0);
  const brands = [...new Set(ps.flatMap((p) => (p.brands_asked ?? '').split(/[;,/]/).map((b) => b.trim()).filter(Boolean)))];
  return (
    <Screen maxWidth={1100} refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: o?.name ?? 'Consultant' }} />
      <Card style={{ gap: 4 }}>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Muted>{[o?.visit_category, o?.phone, o?.email, o?.address].filter(Boolean).join(' · ')}</Muted>
          <Button small variant="ghost" title="Customer record" onPress={() => router.push(`/customers/${id}`)} />
        </Row>
        <Muted>Projects this organisation is on – as architect, consultant, contractor or client – that you can see.</Muted>
      </Card>
      <Grid min={200} max={4}>
        <Stat label="Projects" value={String(ps.length)} sub={`${ps.filter((p) => p.appointed).length} appointed · ${ps.filter(live).length} live`} />
        <Stat label="Our results on their projects" value={won + lost ? `${Math.round((100 * won) / (won + lost))}% won` : '—'} tone={won + lost ? (won >= lost ? 'green' : 'red') : undefined} sub={`${won} won · ${lost} lost inquiries`} />
        <Stat label="Order value won" value={fmtMoney(ps.reduce((s, p) => s + Number(p.won_value), 0), 'LKR')} />
        <Stat label={`Live, not met for ${STALE_DAYS} days`} value={String(ps.filter(stale).length)} tone={ps.some(stale) ? 'amber' : undefined} onPress={() => setFilter('stale')} />
      </Grid>
      {brands.length ? (
        <Section title="Brands / makes asked for on their projects">
          <Card>
            <Row wrap gap={6}>
              {brands.slice(0, 30).map((b) => (
                <Pill key={b} label={b} tone={colors.blue} />
              ))}
            </Row>
            <Muted style={{ marginTop: 6 }}>From the approved makes and preferred brands on the inquiries of these projects.</Muted>
          </Card>
        </Section>
      ) : null}
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All projects' },
          { value: 'live', label: 'Live' },
          { value: 'stale', label: `Not met for ${STALE_DAYS} days`, badge: ps.filter(stale).length },
        ]}
      />
      <DataTable
        rows={shown}
        keyOf={(p) => p.project_id}
        onPress={(p) => router.push(`/projects/${p.project_id}`)}
        edge={(p) => (stale(p) ? colors.amber : p.appointed ? colors.green : undefined)}
        emptyTitle="No projects"
        columns={[
          { h: 'Project', w: 240, grow: true, v: (p) => `${p.name}\n${people[p.owner_id]?.full_name ?? ''}` },
          { h: 'Their role', w: 160, v: (p) => (p.roles ?? []).join(', ') },
          { h: 'Status', w: 130, v: (p) => <Pill label={p.replaced ? 'Replaced' : p.appointed ? 'Appointed' : 'Met'} tone={p.replaced ? colors.grey : p.appointed ? colors.green : colors.blue} /> },
          { h: 'Stage', w: 110, v: (p) => p.stage },
          { h: 'Inquiries', w: 160, v: (p) => `${p.won} won · ${p.lost} lost${p.open ? ` · ${p.open} open` : ''}` },
          { h: 'Last met them', w: 110, v: (p) => (p.last_met_at ? fmtDate(p.last_met_at) : 'Never'), tone: (p) => (stale(p) ? colors.amber : undefined) },
        ]}
      />
    </Screen>
  );
}
