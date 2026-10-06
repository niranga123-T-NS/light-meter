import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Loading, Pill, Row, Screen, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { EXR_STATUS, type ExecRequest } from '@/lib/execution';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** Hand-over requests: won projects (Operations) and projects won before the system (SEE), approved by SM Projects. */
export default function Handovers() {
  const me = useMe();
  const people = usePeople();
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const { data, error, reload, loading } = useLoad(async () => {
    const { data: r, error: e } = await supabase.from('exec_requests').select('*').order('requested_at', { ascending: false });
    if (e) throw new Error(e.message);
    return (r ?? []) as ExecRequest[];
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const pending = data.filter((r) => r.status === 'pending_smp');
  const rows = tab === 'pending' ? pending : data.filter((r) => r.status !== 'pending_smp');
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Hand-over to execution' }} />
      <TestingBanner what="Hand-over to execution" />
      <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pending', label: 'Waiting for SM Projects', badge: pending.length },
            { value: 'done', label: 'Decided' },
          ]}
        />
        <Row gap={6}>
          {me.role === 'operations_exec' ? <Button title="+ Hand over a won project" onPress={() => router.push('/execution/handover/new')} /> : null}
          {me.role === 'senior_elec_engineer' ? (
            <Button title="+ Project won before the system" onPress={() => router.push({ pathname: '/execution/handover/new', params: { kind: 'legacy' } })} />
          ) : null}
        </Row>
      </Row>
      {rows.length ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {rows.map((r) => (
            <ListRow
              key={r.id}
              wrapRight
              onPress={() => router.push(`/execution/handover/${r.id}`)}
              title={r.name}
              subtitle={[r.code, r.kind === 'won' ? 'won in the system' : 'won before the system', r.client_name, people[r.requested_by]?.full_name, fmtDateTime(r.requested_at)]
                .filter(Boolean)
                .join(' · ')}
              right={<Pill label={EXR_STATUS[r.status]} tone={r.status === 'approved' ? colors.green : r.status === 'pending_smp' ? colors.amber : colors.grey} />}
            />
          ))}
        </Card>
      ) : (
        <Empty title={tab === 'pending' ? 'Nothing waiting' : 'No decided requests'} />
      )}
    </Screen>
  );
}
