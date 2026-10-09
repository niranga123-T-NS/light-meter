import { Stack } from 'expo-router';
import { useState } from 'react';
import { CertRows, certForMe } from '@/components/exec/CertRows';
import { SubInvoiceRows } from '@/components/exec/SubInvoiceRows';
import { TestingBanner } from '@/components/Testing';
import { ErrorBanner, Grid, Loading, Screen, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject, SubCert, SubInvoice } from '@/lib/execution';
import { fmtMoney } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** Subcontractor invoices / payment certificates across projects: verify → approve → pay. */
export default function Certs() {
  const me = useMe();
  const [tab, setTab] = useState<'invoices' | 'action' | 'open' | 'paid'>('invoices');
  const { data, error, reload, loading } = useLoad(async () => {
    const [c, p, v] = await Promise.all([
      supabase.from('sub_certs').select('*').neq('status', 'cancelled').order('prepared_at', { ascending: false }),
      supabase.from('exec_projects').select('*'),
      supabase.from('sub_invoices').select('*').neq('status', 'cancelled').order('created_at', { ascending: false }).limit(300),
    ]);
    if (c.error) throw new Error(c.error.message);
    return { rows: (c.data ?? []) as SubCert[], projects: (p.data ?? []) as ExecProject[], invoices: (v.data ?? []) as SubInvoice[] };
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const pname = (id: string) => data.projects.find((p) => p.id === id)?.name ?? '';
  const action = data.rows.filter((c) => certForMe(c, me));
  const open = data.rows.filter((c) => c.status !== 'paid');
  const paid = data.rows.filter((c) => c.status === 'paid');
  // Invoices: the project AE checks a supervisor's invoice, the SEE approves, then Operations; Operations then records the physical documents
  const invMine = data.invoices.filter((v) => (me.role === 'assistant_engineer' && v.status === 'ae_review') || (me.role === 'senior_elec_engineer' && v.status === 'submitted') || (me.role === 'operations_exec' && (v.status === 'see_approved' || v.status === 'approved')));
  const invOpen = data.invoices.filter((v) => v.status !== 'docs_received');
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
          { value: 'invoices', label: 'Invoices', badge: invMine.length },
          { value: 'action', label: 'IPC for me', badge: action.length },
          { value: 'open', label: 'Open' },
          { value: 'paid', label: 'Paid' },
        ]}
      />
      {tab === 'invoices' ? (
        <>
          {invMine.length ? (
            <Section title={`Waiting for you (${invMine.length})`}>
              <SubInvoiceRows rows={invMine} projectName={pname} />
            </Section>
          ) : null}
          <Section title="All open invoices">
            <SubInvoiceRows rows={invOpen} projectName={pname} empty="No open invoices" />
          </Section>
        </>
      ) : (
        <CertRows rows={tab === 'action' ? action : tab === 'open' ? open : paid} projectName={pname} />
      )}
    </Screen>
  );
}
