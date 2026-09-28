// Drill-down list of visits for the dashboard filters (same definition as the dashboard: non-draft visits by visit date).
import { router, Stack, useLocalSearchParams } from 'expo-router';

import { Badge, Banner, Button, Card, EmptyState, ListItem, Loading, Muted, Screen } from '@/components/ui';
import { customerName, lookupLabel, profileName } from '@/lib/cache';
import { fmtDate } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import type { Visit } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function VisitsList() {
  const f = useLocalSearchParams<{ from?: string; to?: string; owner_id?: string; territory_id?: string }>();
  const { data, error, loading, reload } = useAsync(async () => {
    let q = supabase.from('visits').select('id,code,visit_date,visit_type,status,summary,customer_id,salesperson_id,outcome').neq('status', 'draft')
      .order('visit_date', { ascending: false }).limit(1000);
    if (f.from) q = q.gte('visit_date', f.from);
    if (f.to) q = q.lte('visit_date', f.to);
    if (f.owner_id) q = q.eq('salesperson_id', f.owner_id);
    if (f.territory_id) q = q.eq('territory_id', f.territory_id);
    return unwrap(await q) as Visit[];
  }, [f.from, f.to, f.owner_id, f.territory_id]);

  return (
    <Screen onRefresh={reload} refreshing={loading} padded={false}>
      <Stack.Screen options={{ title: 'Visits' }} />
      <Card style={{ margin: 12 }}>
        <Muted>{[f.from && `From ${fmtDate(f.from)}`, f.to && `to ${fmtDate(f.to)}`, f.owner_id && profileName(f.owner_id)].filter(Boolean).join(' ')}</Muted>
        <Muted>{data ? `${data.filter((v) => v.status === 'submitted').length} submitted · ${data.length} total` : ''}</Muted>
        <Button small variant="secondary" title="Export this view to Excel" onPress={() => router.push({ pathname: '/export', params: f as Record<string, string> })} />
      </Card>
      {error ? <Banner tone="danger" message={error} /> : null}
      {loading && !data ? <Loading /> : (data ?? []).length === 0 ? <EmptyState title="No visits" /> : data!.map((v) => (
        <ListItem key={v.id} title={`${customerName(v.customer_id)}`} subtitle={`${fmtDate(v.visit_date)} · ${lookupLabel('visit_type', v.visit_type)} · ${profileName(v.salesperson_id)}`}
          meta={v.summary ?? v.code} right={v.status !== 'submitted' ? <Badge label={v.status ?? ''} /> : undefined}
          onPress={() => router.push(v.status === 'planned' ? `/visit/${v.id}` : `/visit/view/${v.id}`)} />
      ))}
    </Screen>
  );
}
