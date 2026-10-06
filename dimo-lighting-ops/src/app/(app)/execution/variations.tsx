import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { VariationRows } from '@/components/exec/VariationRows';
import { TestingBanner } from '@/components/Testing';
import { Button, ErrorBanner, Grid, Loading, Row, Screen, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject, Variation } from '@/lib/execution';
import { fmtMoney } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** Variations: raised from site, screened by the SEE, priced (Design / Estimation or contract rates), approved by value, accepted by the client. */
export default function Variations() {
  const me = useMe();
  const [tab, setTab] = useState<'open' | 'approved' | 'closed'>('open');
  const { data, error, reload, loading } = useLoad(async () => {
    const [v, p] = await Promise.all([supabase.from('variations').select('*').order('raised_at', { ascending: false }), supabase.from('exec_projects').select('*')]);
    if (v.error) throw new Error(v.error.message);
    return { rows: (v.data ?? []) as Variation[], projects: (p.data ?? []) as ExecProject[] };
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const pname = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '';
  const open = data.rows.filter((v) => ['raised', 'pricing', 'pending_smp', 'pending_gm'].includes(v.status));
  const approved = data.rows.filter((v) => v.status === 'approved');
  const closed = data.rows.filter((v) => !open.includes(v) && !approved.includes(v));
  const accepted = data.rows.filter((v) => v.status === 'client_accepted').reduce((a, v) => a + Number(v.value_lkr ?? 0), 0);
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Variations' }} />
      <TestingBanner what="Variations" />
      <Grid min={150}>
        <Stat label="Being screened / priced / approved" value={open.length} tone={open.length ? 'amber' : undefined} />
        <Stat label="Approved – with the client" value={approved.length} />
        <Stat label="Accepted by clients (net)" value={fmtMoney(accepted, 'LKR')} tone="green" />
      </Grid>
      <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'open', label: 'In progress', badge: open.length },
            { value: 'approved', label: 'With client', badge: approved.length },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        {me.role === 'assistant_engineer' || me.role === 'senior_elec_engineer' ? <Button title="+ Raise a variation" onPress={() => router.push('/execution/variation/new')} /> : null}
      </Row>
      <VariationRows rows={tab === 'open' ? open : tab === 'approved' ? approved : closed} projectName={pname} />
    </Screen>
  );
}
