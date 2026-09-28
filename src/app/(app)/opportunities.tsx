// Drill-down list of packages / bids (from dashboard charts).
import { router, Stack, useLocalSearchParams } from 'expo-router';

import { Badge, Banner, Button, Card, EmptyState, ListItem, Loading, Muted, Screen } from '@/components/ui';
import { cacheStore, profileName, stageById } from '@/lib/cache';
import { fmtDate, fmtMoney } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { Opportunity } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function OpportunitiesList() {
  const f = useLocalSearchParams<{ stage_id?: string; owner_id?: string; territory_id?: string; segment?: string; month?: string; outcome?: string; from?: string; to?: string }>();
  const { data, error, loading, reload } = useAsync(async () => {
    let q = supabase.from('opportunities').select('*').is('deleted_at', null).order('expected_order_date', { ascending: true, nullsFirst: false }).limit(1000);
    if (f.stage_id) q = q.eq('stage_id', f.stage_id);
    if (f.owner_id) q = q.eq('owner_id', f.owner_id);
    if (f.territory_id) q = q.eq('territory_id', f.territory_id);
    if (f.segment) q = f.segment === 'unspecified' ? q.is('segment', null) : q.eq('segment', f.segment);
    if (f.month === 'unscheduled') q = q.is('expected_order_date', null);
    else if (f.month) q = q.gte('expected_order_date', `${f.month}-01`).lte('expected_order_date', `${f.month}-31`);
    if (f.outcome) {
      const ids = cacheStore.get().stages.filter((s) => s.outcome === f.outcome).map((s) => s.id);
      q = q.in('stage_id', ids);
    }
    return unwrap(await q) as Opportunity[];
  }, [JSON.stringify(f)]);

  const total = (data ?? []).reduce((acc, o) => {
    acc[o.currency ?? 'LKR'] = (acc[o.currency ?? 'LKR'] ?? 0) + Number(o.estimated_value ?? 0);
    return acc;
  }, {} as Record<string, number>);

  return (
    <Screen onRefresh={reload} refreshing={loading} padded={false}>
      <Stack.Screen options={{ title: f.stage_id ? stageById(f.stage_id)?.name ?? 'Packages' : 'Packages' }} />
      <Card style={{ margin: 12 }}>
        <Muted>{(data ?? []).length} packages · {Object.entries(total).map(([c, v]) => fmtMoney(v, c)).join(' + ') || '–'}</Muted>
        <Muted>Totals per currency; see the dashboard for base-currency totals.</Muted>
        <Button small variant="secondary" title="Export to Excel" onPress={() => router.push({ pathname: '/export', params: { ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}),
          ...(f.owner_id ? { owner_id: f.owner_id } : {}), ...(f.territory_id ? { territory_id: f.territory_id } : {}), ...(f.stage_id ? { stage_id: f.stage_id } : {}) } })} />
      </Card>
      {error ? <Banner tone="danger" message={error} /> : null}
      {loading && !data ? <Loading /> : (data ?? []).length === 0 ? <EmptyState title="No packages" /> : data!.map((o) => {
        const st = stageById(o.stage_id);
        return (
          <ListItem key={o.id} title={o.name}
            subtitle={`${cacheStore.get().projects.find((p) => p.id === o.project_id)?.name ?? ''} · ${profileName(o.owner_id)}`}
            meta={`${st?.name ?? ''} · ${o.probability ?? 0}% · ${fmtMoney(o.estimated_value, o.currency)} · order ${fmtDate(o.expected_order_date)}`}
            right={st && st.outcome !== 'open' ? <Badge label={st.name} tone={st.outcome === 'won' ? 'success' : 'danger'} /> : undefined}
            onPress={() => router.push(`/opportunity/${o.id}`)} />
        );
      })}
    </Screen>
  );
}
