import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { QueryRows } from '@/components/exec/QueryRows';
import { TestingBanner } from '@/components/Testing';
import { Button, ErrorBanner, Grid, Loading, Row, Screen, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { DesignQuery, ExecProject } from '@/lib/execution';
import { todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** Design queries (RFIs) from site: screened by the SEE, answered by the design team by the target date. */
export default function Queries() {
  const me = useMe();
  const [tab, setTab] = useState<'open' | 'answered' | 'all'>('open');
  const { data, error, reload, loading } = useLoad(async () => {
    const [q, p] = await Promise.all([supabase.from('design_queries').select('*').order('raised_at', { ascending: false }), supabase.from('exec_projects').select('*').order('name')]);
    if (q.error) throw new Error(q.error.message);
    return { rows: (q.data ?? []) as DesignQuery[], projects: (p.data ?? []) as ExecProject[] };
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const pname = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '';
  const open = data.rows.filter((q) => q.status === 'raised' || q.status === 'forwarded');
  const answered = data.rows.filter((q) => q.status === 'answered');
  const overdue = open.filter((q) => q.target_date && q.target_date < todayISO());
  const canRaise = me.role === 'senior_elec_engineer' || me.role === 'assistant_engineer';
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Design queries' }} />
      <TestingBanner what="Design queries" />
      <Grid min={150}>
        <Stat label="Open" value={open.length} tone={open.length ? 'amber' : undefined} />
        <Stat label="Past the target date" value={overdue.length} tone={overdue.length ? 'red' : undefined} />
        <Stat label="Answered – to close" value={answered.length} />
      </Grid>
      <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'open', label: 'Open', badge: open.length },
            { value: 'answered', label: 'Answered', badge: answered.length },
            { value: 'all', label: 'All' },
          ]}
        />
        {canRaise ? (
          <Button title="+ Design query" onPress={() => router.push('/execution/query/new')} />
        ) : null}
      </Row>
      <QueryRows rows={tab === 'open' ? open : tab === 'answered' ? answered : data.rows} projectName={pname} />
    </Screen>
  );
}
