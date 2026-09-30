import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Pill, Row, Screen, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { useOfflineSync } from '@/lib/offline';
import { isSales } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Visit } from '@/lib/types';

type Filter = 'all' | 'open' | 'tender' | 'unplanned' | 'review';

export default function Visits() {
  const me = useMe();
  const people = usePeople();
  const offline = useOfflineSync();
  const [filter, setFilter] = useState<Filter>('all');
  const { data, error, loading, reload } = useLoad(async () => {
    let q = supabase.from('visits').select('*, organizations(name), projects(name)').order('checkin_at', { ascending: false }).limit(200);
    if (filter === 'open') q = q.eq('status', 'open');
    if (filter === 'tender') q = q.eq('visit_type', 'tender');
    if (filter === 'unplanned') q = q.eq('unplanned', true);
    if (filter === 'review') q = q.is('reviewed_at', null).eq('status', 'closed');
    const { data: rows, error: e } = await q;
    if (e) throw new Error(e.message);
    return rows as Visit[];
  }, [filter]);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Visits' }} />
      <Row wrap style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Report not saved' },
            { value: 'tender', label: 'Tender visits' },
            { value: 'unplanned', label: 'Unplanned' },
            ...(isSales(me.role) ? [] : [{ value: 'review' as const, label: 'To review' }]),
          ]}
        />
        {isSales(me.role) ? <Button title="Check in" icon="◎" onPress={() => router.push('/visits/new')} /> : null}
      </Row>
      {offline.pending ? <Pill label={`${offline.pending} waiting to sync`} tone={colors.amber} /> : null}
      <ErrorBanner message={error} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data ?? []).map((v) => (
          <ListRow
            key={v.id}
            title={`${v.organizations?.name ?? ''}${v.projects?.name ? ` · ${v.projects.name}` : ''}`}
            subtitle={`${v.code ?? 'Syncing…'} · ${fmtDateTime(v.checkin_at)} · ${v.primary_objective}${isSales(me.role) ? '' : ` · ${people[v.sales_person_id]?.full_name ?? ''}`}`}
            highlight={v.status === 'open' ? colors.amber : v.gps_verified === false ? colors.red : undefined}
            right={
              <Row gap={4}>
                {v.visit_type === 'tender' ? <Pill label="Tender" tone={colors.blue} /> : null}
                {v.unplanned ? <Pill label="Unplanned" /> : null}
                {v.gps_verified === false ? <Pill label="GPS review" tone={colors.red} /> : null}
                {v.status === 'open' ? <Pill label="Report due" tone={colors.amber} /> : v.outcome ? <Pill label={v.outcome} /> : null}
              </Row>
            }
            onPress={() => router.push(`/visits/${v.id}`)}
          />
        ))}
        {data && !data.length ? <Empty title="No visits" hint="Visits you check in to appear here." /> : null}
      </Card>
    </Screen>
  );
}
