import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Muted, Pill, Row, Screen, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { sampleOverdue } from '@/lib/constants';
import { fmtDate, fmtMoney, human } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Sample } from '@/lib/types';

type Tab = 'all' | 'check' | 'approve' | 'dispatch' | 'out' | 'closed';

/** Samples tab (Section 13.4): sales requests, Operations queue, SM Projects approvals. */
export default function Samples() {
  const me = useMe();
  const people = usePeople();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const ops = me.role === 'operations_exec';
  const [tab, setTab] = useState<Tab>(params.tab ?? (ops ? 'check' : me.role === 'sm_projects' ? 'approve' : 'all'));
  const { data, error, loading, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('samples').select('*').order('created_at', { ascending: false }).limit(500);
    if (e) throw new Error(e.message);
    return rows as Sample[];
  });
  const all = data ?? [];
  const filters: Record<Tab, (s: Sample) => boolean> = {
    all: (s) => !['closed', 'returned', 'rejected'].includes(s.status),
    check: (s) => s.status === 'submitted',
    approve: (s) => s.status === 'availability_confirmed',
    dispatch: (s) => s.status === 'approved',
    out: (s) => s.status === 'out',
    closed: (s) => ['closed', 'returned', 'rejected', 'not_available', 'damaged_lost'].includes(s.status),
  };
  const rows = all.filter(filters[tab]).sort((a, b) => Number(sampleOverdue(b)) - Number(sampleOverdue(a)));
  const outValue = (cur: 'LKR' | 'USD') => all.filter((s) => s.status === 'out' && s.currency === cur).reduce((a, s) => a + Number(s.total_value), 0);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Samples' }} />
      <Row wrap style={{ justifyContent: 'space-between' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'Open' },
            { value: 'check', label: 'Availability check', badge: all.filter(filters.check).length },
            { value: 'approve', label: 'Approval', badge: all.filter(filters.approve).length },
            { value: 'dispatch', label: 'To dispatch', badge: all.filter(filters.dispatch).length },
            { value: 'out', label: 'Out / overdue', badge: all.filter(sampleOverdue).length },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        {isSales(me.role) ? <Button title="+ Request sample" onPress={() => router.push('/samples/new')} /> : null}
      </Row>
      <Muted style={{ marginVertical: 6 }}>
        Value out: {fmtMoney(outValue('LKR'), 'LKR')} · {fmtMoney(outValue('USD'), 'USD')} · {all.filter(sampleOverdue).length} overdue
      </Muted>
      <ErrorBanner message={error} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((s) => (
          <ListRow
            key={s.id}
            title={`${s.code} · ${s.client_name ?? ''}`}
            subtitle={`${s.project_name ?? ''} · ${s.purpose} · ${s.sample_type === 'returnable' ? `return by ${fmtDate(s.expected_return_date)}` : 'non-returnable'}${isSales(me.role) ? '' : ` · ${people[s.sales_person_id]?.full_name ?? ''}`}`}
            highlight={sampleOverdue(s) ? colors.red : undefined}
            right={
              <Row gap={4}>
                <Muted>{fmtMoney(s.total_value, s.currency)}</Muted>
                <Pill label={sampleOverdue(s) ? 'Overdue' : human(s.status)} tone={sampleOverdue(s) ? colors.red : colors.blue} />
              </Row>
            }
            onPress={() => router.push(`/samples/${s.id}`)}
          />
        ))}
        {data && !rows.length ? <Empty title="No samples here" /> : null}
      </Card>
    </Screen>
  );
}
