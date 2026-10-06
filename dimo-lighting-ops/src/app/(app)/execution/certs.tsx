import { Stack } from 'expo-router';
import { useState } from 'react';
import { CertRows } from '@/components/exec/CertRows';
import { TestingBanner } from '@/components/Testing';
import { ErrorBanner, Grid, Loading, Screen, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject, SubCert } from '@/lib/execution';
import { fmtMoney } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** Subcontractor invoices / payment certificates across projects: verify → approve → pay. */
export default function Certs() {
  const me = useMe();
  const [tab, setTab] = useState<'action' | 'open' | 'paid'>('action');
  const { data, error, reload, loading } = useLoad(async () => {
    const [c, p] = await Promise.all([supabase.from('sub_certs').select('*').order('prepared_at', { ascending: false }), supabase.from('exec_projects').select('*')]);
    if (c.error) throw new Error(c.error.message);
    return { rows: (c.data ?? []) as SubCert[], projects: (p.data ?? []) as ExecProject[] };
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const pname = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '';
  const step: Partial<Record<string, SubCert['status']>> = { senior_elec_engineer: 'prepared', sm_projects: 'verified', operations_exec: 'approved' };
  const action = data.rows.filter((c) => c.status === step[me.role]);
  const open = data.rows.filter((c) => c.status !== 'paid');
  const paid = data.rows.filter((c) => c.status === 'paid');
  const toPay = data.rows.filter((c) => c.status === 'approved').reduce((a, c) => a + Number(c.net), 0);
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Subcontractor invoices' }} />
      <TestingBanner what="Subcontractor payment certificates" />
      <Grid min={150}>
        <Stat label="Waiting for you" value={action.length} tone={action.length ? 'amber' : undefined} />
        <Stat label="Approved – to pay" value={fmtMoney(toPay, 'LKR')} />
        <Stat label="Open" value={open.length} />
      </Grid>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'action', label: 'For me', badge: action.length },
          { value: 'open', label: 'Open' },
          { value: 'paid', label: 'Paid' },
        ]}
      />
      <CertRows rows={tab === 'action' ? action : tab === 'open' ? open : paid} projectName={pname} onChange={reload} />
    </Screen>
  );
}
