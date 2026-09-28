// Manager dashboard. Figures come from dashboard_summary (same filters and
// definitions as the Excel export, so the workbook reconciles). Updates live
// when visits, actions, packages or projects change.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { BarList } from '@/components/BarList';
import { presetRange, ReportFilterBar } from '@/components/ReportFilters';
import { Badge, Banner, Button, Card, ListItem, Loading, Muted, Row, Screen, SectionTitle, Stat } from '@/components/ui';
import { fmtDate, fmtDateTime, fmtMoney, relativeDue } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { ReportFilters } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

type Summary = Record<string, any>;

function clean(f: ReportFilters) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => !!v));
}

export default function Dashboard() {
  const [filters, setFilters] = useState<ReportFilters>(presetRange('month'));
  const [live, setLive] = useState(false);
  const { data, error, loading, reload } = useAsync(
    async () => unwrap(await supabase.rpc('dashboard_summary', { f: clean(filters) })) as Summary,
    [JSON.stringify(filters)],
  );

  // Real-time refresh (debounced) when records change
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const channel = supabase.channel('dashboard');
    for (const table of ['visits', 'actions', 'opportunities', 'projects']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void reload(), 1500);
      });
    }
    channel.subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [reload]);

  const d = data;
  const cur = d?.base_currency ?? 'LKR';
  const withFilters = (extra: Record<string, string>) => ({ ...clean(filters), ...extra }) as Record<string, string>;

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Card>
        <ReportFilterBar value={filters} onChange={setFilters} />
      </Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Muted>{d ? `Updated ${fmtDateTime(d.generated_at)}` : ''}{live ? ' · live' : ''}</Muted>
        <Button small variant="secondary" title="Export to Excel" onPress={() => router.push({ pathname: '/export', params: clean(filters) as Record<string, string> })} />
      </Row>
      {error ? <Banner tone="danger" message={error} /> : null}
      {!d ? <Loading /> : (
        <>
          <Row wrap>
            <Stat label="Visits completed" value={d.visits.submitted} onPress={() => router.push({ pathname: '/visits', params: withFilters({}) })} />
            <Stat label="Planned visits completed" value={`${d.visits.planned_completed}/${d.visits.planned}`} tone="info" />
            <Stat label="Accounts visited" value={`${d.accounts.visited}/${d.accounts.total}`} tone="success" />
            <Stat label="Overdue actions" value={d.actions.overdue} tone={d.actions.overdue ? 'danger' : 'success'} onPress={() => router.push('/actions')} />
          </Row>
          <Row wrap>
            <Stat label={`Open pipeline (${cur})`} value={fmtMoney(d.pipeline.open_value)} hint={`${d.pipeline.open_count} packages`}
              onPress={() => router.push({ pathname: '/opportunities', params: withFilters({ outcome: 'open' }) })} />
            <Stat label={`Weighted pipeline (${cur})`} value={fmtMoney(d.pipeline.weighted_value)} tone="info" />
            <Stat label="Quotation conversion" value={d.quotations.conversion_pct == null ? '–' : `${d.quotations.conversion_pct}%`}
              hint={`${d.quotations.accepted} won of ${d.quotations.submitted} submitted`} tone="warning" />
            <Stat label={`Won (${cur})`} value={fmtMoney(d.results.won_value)} hint={`${d.results.won} won · ${d.results.lost} lost`} tone="success" />
          </Row>
          {d.pipeline.unconverted_count > 0 ? (
            <Banner tone="warning" message={`${d.pipeline.unconverted_count} package(s) are in a currency without an exchange rate and are excluded from ${cur} totals. Add a rate under Admin > Settings.`} />
          ) : null}
          <Row wrap>
            <Stat label="Visits leading to projects" value={d.visits.leading_to_projects} tone="neutral" />
            <Stat label="Visits leading to quotations" value={d.visits.leading_to_quotations} tone="neutral" />
            <Stat label="Actions due in 7 days" value={d.actions.due_7_days} tone="neutral" />
            <Stat label="Actions completed" value={d.actions.completed_in_range} tone="neutral" />
          </Row>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Card style={{ flexGrow: 1, flexBasis: 320 }}>
              <SectionTitle>Visits by person</SectionTitle>
              <BarList bars={(d.visits_by_person as any[]).map((p) => ({
                key: p.user_id, label: p.name, value: p.submitted, display: `${p.submitted} (${p.planned_completed}/${p.planned} planned)`,
                onPress: () => router.push({ pathname: '/visits', params: withFilters({ owner_id: p.user_id }) }),
              }))} />
            </Card>
            <Card style={{ flexGrow: 1, flexBasis: 320 }}>
              <SectionTitle>Visits by week</SectionTitle>
              <BarList bars={(d.visits_by_week as any[]).map((w) => ({ key: w.week, label: `Week of ${fmtDate(w.week)}`, value: w.count }))} />
              <SectionTitle>By month</SectionTitle>
              <BarList bars={(d.visits_by_month as any[]).map((m) => ({ key: m.month, label: m.month, value: m.count }))} />
            </Card>
            <Card style={{ flexGrow: 1, flexBasis: 320 }}>
              <SectionTitle>Pipeline by stage ({cur})</SectionTitle>
              <Muted>Light bar = value, dark bar = weighted</Muted>
              <BarList bars={(d.pipeline.by_stage as any[]).filter((s) => s.count > 0).map((s) => ({
                key: s.stage_id, label: `${s.stage} (${s.count})`, value: Number(s.value ?? 0), secondary: Number(s.weighted ?? 0), display: fmtMoney(s.value),
                onPress: () => router.push({ pathname: '/opportunities', params: withFilters({ stage_id: s.stage_id }) }),
              }))} />
            </Card>
            <Card style={{ flexGrow: 1, flexBasis: 320 }}>
              <SectionTitle>Open pipeline by owner</SectionTitle>
              <BarList bars={(d.pipeline.by_owner as any[]).map((s) => ({
                key: s.owner_id ?? 'none', label: `${s.owner ?? 'Unassigned'} (${s.count})`, value: Number(s.value ?? 0), secondary: Number(s.weighted ?? 0), display: fmtMoney(s.value),
                onPress: s.owner_id ? () => router.push({ pathname: '/opportunities', params: withFilters({ owner_id: s.owner_id, outcome: 'open' }) }) : undefined,
              }))} />
              <SectionTitle>By segment</SectionTitle>
              <BarList bars={(d.pipeline.by_segment as any[]).map((s) => ({
                key: s.segment, label: `${s.segment} (${s.count})`, value: Number(s.value ?? 0), secondary: Number(s.weighted ?? 0), display: fmtMoney(s.value),
                onPress: () => router.push({ pathname: '/opportunities', params: withFilters({ segment: s.segment, outcome: 'open' }) }),
              }))} />
            </Card>
            <Card style={{ flexGrow: 1, flexBasis: 320 }}>
              <SectionTitle>Expected orders by month</SectionTitle>
              <BarList bars={(d.pipeline.by_order_month as any[]).map((s) => ({
                key: s.month, label: `${s.month} (${s.count})`, value: Number(s.value ?? 0), secondary: Number(s.weighted ?? 0), display: fmtMoney(s.weighted),
                onPress: () => router.push({ pathname: '/opportunities', params: withFilters({ month: s.month, outcome: 'open' }) }),
              }))} />
            </Card>
            <Card style={{ flexGrow: 1, flexBasis: 320 }}>
              <SectionTitle>Wins and losses</SectionTitle>
              <BarList bars={(d.results.reasons as any[]).map((r) => ({ key: `${r.outcome}-${r.reason}`, label: `${r.outcome === 'won' ? 'Won' : 'Lost'} – ${r.reason}`, value: r.count }))}
                emptyText="No packages closed in this period" />
            </Card>
          </View>

          <SectionTitle>Tender and quotation deadlines (30 days)</SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {(d.tender_deadlines as any[]).length === 0 ? <Muted style={{ padding: 16 }}>None</Muted> : (d.tender_deadlines as any[]).map((t, i) => (
              <ListItem key={`${t.project_id}-${t.kind}-${i}`} title={t.name} subtitle={`${t.code} · ${t.kind.replace(/_/g, ' ')}`}
                right={<Badge label={relativeDue(t.date).label} tone="warning" />} onPress={() => router.push(`/project/${t.project_id}`)} />
            ))}
          </Card>

          <SectionTitle>Overdue actions</SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {(d.actions.overdue_list as any[]).length === 0 ? <Muted style={{ padding: 16 }}>None</Muted> : (d.actions.overdue_list as any[]).slice(0, 20).map((a) => (
              <ListItem key={a.id} title={a.description} subtitle={`${a.owner} · ${a.code}`}
                right={<Badge label={relativeDue(a.due_date).label} tone="danger" />} onPress={() => router.push(`/action/${a.id}`)} />
            ))}
          </Card>

          <SectionTitle>{`Projects with no activity for ${d.stale_days}+ days`}</SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {(d.stale_projects as any[]).length === 0 ? <Muted style={{ padding: 16 }}>None</Muted> : (d.stale_projects as any[]).map((p) => (
              <ListItem key={p.id} title={p.name} subtitle={`${p.code} · ${p.owner ?? ''}`} meta={`Last activity ${fmtDate(p.last_activity_at)}`}
                onPress={() => router.push(`/project/${p.id}`)} />
            ))}
          </Card>

          <SectionTitle>{`Accounts not visited in period (${d.accounts.not_visited})`}</SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {(d.accounts.not_visited_list as any[]).map((c) => (
              <ListItem key={c.id} title={c.name} subtitle={c.code} meta={c.last_visit_at ? `Last visit ${fmtDate(c.last_visit_at)}` : 'Never visited'}
                onPress={() => router.push(`/customer/${c.id}`)} />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
