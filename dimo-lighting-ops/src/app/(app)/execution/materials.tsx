import { Stack } from 'expo-router';
import { useState } from 'react';
import { MaterialRows } from '@/components/exec/MaterialRows';
import { TestingBanner } from '@/components/Testing';
import { ErrorBanner, Grid, Loading, Screen, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject, MaterialRequest } from '@/lib/execution';
import { todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** Materials across execution projects: what to approve, what Operations must order, and deliveries outstanding. */
export default function Materials() {
  const me = useMe();
  const [tab, setTab] = useState<'action' | 'transit' | 'all'>('action');
  const { data, error, reload, loading } = useLoad(async () => {
    const [m, p] = await Promise.all([supabase.from('material_requests').select('*').order('required_date'), supabase.from('exec_projects').select('*')]);
    if (m.error) throw new Error(m.error.message);
    return { rows: (m.data ?? []) as MaterialRequest[], projects: (p.data ?? []) as ExecProject[] };
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const pname = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '';
  const mine = (m: MaterialRequest) =>
    (m.status === 'submitted' && me.role === 'senior_elec_engineer') || (m.status === 'pending_smp' && me.role === 'sm_projects') || (m.status === 'approved' && me.role === 'operations_exec');
  const action = data.rows.filter(mine);
  const transit = data.rows.filter((m) => m.status === 'ordered' || m.status === 'part_received');
  const late = transit.filter((m) => (m.expected_date ?? m.required_date) < todayISO());
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Materials & stores' }} />
      <TestingBanner what="Materials and stores" />
      <Grid min={150}>
        <Stat label="Waiting for you" value={action.length} tone={action.length ? 'amber' : undefined} />
        <Stat label="On order" value={transit.length} />
        <Stat label="Deliveries late" value={late.length} tone={late.length ? 'red' : undefined} />
      </Grid>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'action', label: 'For me', badge: action.length },
          { value: 'transit', label: 'On order', badge: transit.length },
          { value: 'all', label: 'All' },
        ]}
      />
      <MaterialRows rows={tab === 'action' ? action : tab === 'transit' ? transit : data.rows} projectName={pname} />
    </Screen>
  );
}
